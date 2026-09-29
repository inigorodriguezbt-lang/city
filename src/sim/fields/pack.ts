// ─────────────────────────────────────────────────────────────────────────────
// Main-thread side of the field system: packs the world into transferable
// typed arrays for one worker job.
//
//  • Building records are two flat arrays (see protocol.ts). The catalog
//    lookup, role and packed meta of every building are cached and only
//    rebuilt when its def / zone / level / footprint change; the dynamic part
//    (flags, efficiency, occupants, utility use) is refreshed per job.
//  • Utility numbers are final: consumption × event multipliers, production ×
//    efficiency × weather (wind, sun, river flow) × intake water quality.
//  • Byte / float buffers come from a pool that the worker refills by handing
//    every buffer back with its result, so steady-state jobs allocate nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { WATER_EPS } from '../../core/constants';
import { calendar } from '../../core/time';
import { BFlag, type Building, type BuildingDef, type TransitMode, type WeatherState } from '../../core/types';
import { buildingDef } from '../../data/buildings';
import type { World } from '../../world/World';
import { powerUse, sewageUse, waterUse } from '../consumption';
import {
  REC_F, REC_I, RF_BUILT, RF_EFF, RF_JOBS, RF_POWER, RF_RESIDENTS, RF_SEWAGE, RF_WATER, RF_WORKERS,
  RI_DEF, RI_FLAGS, RI_H, RI_ID, RI_META, RI_W, RI_X, RI_Y, Role, STOP_STRIDE,
  defIndexOf, needsCable, packMeta, roleOf, type TerrainPacket, type WeatherPacket,
} from './protocol';

// ── buffer pool ──────────────────────────────────────────────────────────────
/** ArrayBuffers keyed by byte length. Detached (transferred) buffers are ignored. */
export class BufferPool {
  private map = new Map<number, ArrayBuffer[]>();
  constructor(private readonly maxPerSize = 48) {}

  take(bytes: number): ArrayBuffer {
    const l = this.map.get(bytes);
    return l?.pop() ?? new ArrayBuffer(bytes);
  }
  /** up to `max` pooled buffers of this size (never allocates) */
  takeUpTo(bytes: number, max: number): ArrayBuffer[] {
    const l = this.map.get(bytes);
    if (!l || !l.length) return [];
    return l.splice(Math.max(0, l.length - max), max);
  }
  put(b: ArrayBuffer | undefined | null): void {
    if (!b || b.byteLength === 0) return;
    let l = this.map.get(b.byteLength);
    if (!l) this.map.set(b.byteLength, (l = []));
    if (l.length < this.maxPerSize && !l.includes(b)) l.push(b);
  }
  clear(): void {
    this.map.clear();
  }
}

// ── event multipliers ────────────────────────────────────────────────────────
export interface UtilityMods {
  powerUseMult: number;
  waterUseMult: number;
  waterSupplyMult: number;
}

// ── weather-dependent production ─────────────────────────────────────────────
interface ProductionEnv {
  /** wind speed multiplier (before the site factor) */
  wind: number;
  pv: number;
  csp: number;
  updraft: number;
  hydro: number;
}

const CLOUD: Record<WeatherState['type'], number> = {
  clear: 1, cloudy: 0.55, rain: 0.35, storm: 0.2, snow: 0.3, fog: 0.6, heatwave: 1, blizzard: 0.1,
};

const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/** Production multipliers for weather-dependent roles at the current time. */
export function productionEnv(world: World, mods: UtilityMods): ProductionEnv {
  const wx = world.weather;
  const cal = calendar(world.time.day);
  const hour = ((world.time.hour % 24) + 24) % 24;
  // day length and sun strength follow the season (peak around the solstice)
  const seasonal = -Math.cos(2 * Math.PI * cal.yearProgress);
  const dayLen = 12 + 3.5 * seasonal;
  const rise = 12 - dayLen / 2, set = 12 + dayLen / 2;
  const sun = hour > rise && hour < set ? Math.sin((Math.PI * (hour - rise)) / dayLen) : 0;
  const peak = 0.72 + 0.28 * (seasonal + 1) * 0.5;
  const clouds = 1 - (1 - (CLOUD[wx.type] ?? 1)) * (0.4 + 0.6 * clamp01(wx.intensity));
  const snow = 1 - 0.7 * clamp01(wx.snowCover);
  const light = sun * peak * clouds * snow;
  // molten-salt storage carries the plant ~5 h past sunset
  const after = hour >= set ? hour - set : hour + 24 - set;
  const stored = after < 5 ? 0.75 * (1 - after / 5) * peak * clouds : 0;
  const ws = Math.max(0, wx.windSpeed);
  const wind = ws >= 25 ? 0.12 : Math.min(1.3, 0.45 + ws / 9);
  const seasonHydro = cal.season === 'spring' ? 1.1 : cal.season === 'summer' ? 0.95 : cal.season === 'autumn' ? 0.92 : 0.86;
  return {
    wind,
    // a small battery bank keeps a trickle flowing after dark
    pv: 0.06 + 0.94 * light,
    csp: 0.12 + 0.88 * Math.max(light, stored),
    updraft: (0.55 + 0.45 * sun * peak) * (0.8 + 0.2 * clouds),
    hydro: Math.max(0.3, Math.min(1.1, mods.waterSupplyMult)) * seasonHydro,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── building records ─────────────────────────────────────────────────────────
interface StaticRec {
  b: Building;
  defId: string;
  zone: number;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  def: BuildingDef | undefined;
  defIndex: number;
  role: Role;
  meta: number;
  /** 0..1 average of the static wind field over the footprint (wind roles) */
  site: number;
  gen: number;
}

export interface PackedRecords {
  recI: Int32Array;
  recF: Float32Array;
  count: number;
}

/** Records are allocated in blocks so pooled buffers keep matching sizes. */
const BLOCK = 1024;

export class BuildingPacker {
  private cache = new Map<number, StaticRec>();
  /** static records in last pack's iteration order (fast path: same building at the same slot) */
  private order: (StaticRec | undefined)[] = [];
  private gen = 0;

  clear(): void {
    this.cache.clear();
    this.order.length = 0;
  }

  forget(id: number): void {
    this.cache.delete(id);
  }

  private staticOf(world: World, b: Building): StaticRec {
    let st = this.cache.get(b.id);
    if (st && st.b === b && st.defId === b.defId && st.zone === b.zone && st.level === b.level && st.x === b.x && st.y === b.y && st.w === b.w && st.h === b.h) return st;
    const service = b.kind === 'service';
    const def = service ? buildingDef(b.defId) : undefined;
    const role = roleOf(def);
    let site = 0;
    if (role === Role.Wind) {
      const wf = world.fields.wind, s = world.size;
      let sum = 0, cnt = 0;
      for (let y = Math.max(0, b.y); y < Math.min(s, b.y + b.h); y++)
        for (let x = Math.max(0, b.x); x < Math.min(s, b.x + b.w); x++) {
          sum += wf[y * s + x];
          cnt++;
        }
      site = cnt ? sum / cnt / 255 : 0;
    }
    st = {
      b, defId: b.defId, zone: b.zone, level: b.level, x: b.x, y: b.y, w: b.w, h: b.h,
      def, defIndex: def ? defIndexOf(def.id) : -1, role,
      meta: packMeta(service, b.zone, b.level, role, needsCable(def)),
      site, gen: 0,
    };
    this.cache.set(b.id, st);
    return st;
  }

  pack(world: World, mods: UtilityMods, pool: BufferPool): PackedRecords {
    const gen = ++this.gen;
    const count = world.buildings.size;
    const cap = Math.max(BLOCK, Math.ceil(count / BLOCK) * BLOCK);
    const recI = new Int32Array(pool.take(cap * REC_I * 4));
    const recF = new Float32Array(pool.take(cap * REC_F * 4));
    const env = productionEnv(world, mods);
    const pUse = sane(mods.powerUseMult), wUse = sane(mods.waterUseMult), wSup = sane(mods.waterSupplyMult);
    const sewUse = 0.5 + 0.5 * wUse;
    const order = this.order;
    if (order.length < count) order.length = count;
    let r = 0;
    for (const b of world.buildings.values()) {
      if (r >= count) break;
      let st = order[r];
      if (!st || st.b !== b || st.level !== b.level || st.zone !== b.zone || st.defId !== b.defId) order[r] = st = this.staticOf(world, b);
      st.gen = gen;
      const oi = r * REC_I, of = r * REC_F;
      recI[oi + RI_X] = b.x;
      recI[oi + RI_Y] = b.y;
      recI[oi + RI_W] = b.w;
      recI[oi + RI_H] = b.h;
      recI[oi + RI_META] = st.meta;
      recI[oi + RI_FLAGS] = b.flags;
      recI[oi + RI_DEF] = st.defIndex;
      recI[oi + RI_ID] = b.id;
      const def = st.def;
      const service = b.kind === 'service';
      const eff = service ? (b.flags & BFlag.Disabled ? 0 : clampEff(b.efficiency)) : 1;
      const out = eff > 1.25 ? 1.25 : eff;
      recF[of + RF_EFF] = eff;
      recF[of + RF_RESIDENTS] = finite(b.residents);
      recF[of + RF_JOBS] = finite(b.jobs);
      recF[of + RF_WORKERS] = finite(b.workers);
      recF[of + RF_BUILT] = finite(b.built);
      // power
      const pu = finite(powerUse(b, def));
      if (def && (def.power ?? 0) > 0) recF[of + RF_POWER] = -Math.max(0, -pu) * out * this.powerFactor(st, env);
      else recF[of + RF_POWER] = Math.max(0, pu) * pUse;
      // water
      const wu = finite(waterUse(b, def));
      if (def && (def.water ?? 0) > 0) {
        const drought = st.role === Role.Desalination ? 1 : wSup;
        recF[of + RF_WATER] = -Math.max(0, -wu) * out * drought * intakeQuality(world, b, st.role);
      } else recF[of + RF_WATER] = Math.max(0, wu) * wUse;
      // sewage
      const su = finite(sewageUse(b, def));
      if (def && (def.sewage ?? 0) > 0) recF[of + RF_SEWAGE] = -Math.max(0, -su) * out;
      else recF[of + RF_SEWAGE] = Math.max(0, su) * sewUse;
      r++;
    }
    // drop cache entries of buildings that no longer exist
    if (this.cache.size > r) for (const [id, st] of this.cache) if (st.gen !== gen) this.cache.delete(id);
    if (order.length > r) order.length = r;
    return { recI, recF, count: r };
  }

  private powerFactor(st: StaticRec, env: ProductionEnv): number {
    switch (st.role) {
      case Role.Wind: {
        const tags = st.def?.tags;
        const offshore = !!tags && (tags.includes('sea') || st.def?.placement?.onWater === true);
        let site = offshore ? Math.max(st.site, 0.75) : st.site;
        if (st.def && st.def.h > 1) site += 0.1; // taller hub, steadier wind
        const siteF = Math.max(0.1, Math.min(1, 0.1 + 0.9 * site));
        return Math.min(1, siteF * env.wind);
      }
      case Role.SolarPV: return env.pv;
      case Role.SolarCSP: return env.csp;
      case Role.SolarUpdraft: return env.updraft;
      case Role.Hydro: return env.hydro;
      default: return 1;
    }
  }
}

function sane(v: number): number {
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 10) : 1;
}
function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
function clampEff(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1.5 ? 1.5 : v) : 1;
}

/**
 * 0..1 quality factor of a water producer's intake from last cycle's pollution
 * field: surface intakes read the water next to them, wells the ground they
 * stand on; purification filters most of it and desalination is immune.
 */
function intakeQuality(world: World, b: Building, role: Role): number {
  if (role === Role.Desalination) return 1;
  const s = world.size, P = world.fields.pollution;
  if (role === Role.Well) {
    let sum = 0, cnt = 0;
    for (let y = Math.max(0, b.y); y < Math.min(s, b.y + b.h); y++)
      for (let x = Math.max(0, b.x); x < Math.min(s, b.x + b.w); x++) {
        sum += P[y * s + x];
        cnt++;
      }
    const p = cnt ? sum / cnt : 0;
    return 1 - 0.7 * smooth(50, 220, p);
  }
  // surface water around the intake (1-cell ring and the footprint itself)
  let worst = -1;
  for (let y = Math.max(0, b.y - 1); y < Math.min(s, b.y + b.h + 1); y++)
    for (let x = Math.max(0, b.x - 1); x < Math.min(s, b.x + b.w + 1); x++) {
      if (world.waterDepth(x, y) <= WATER_EPS) continue;
      const p = P[y * s + x];
      if (p > worst) worst = p;
    }
  if (worst < 0) {
    // no water in reach: fall back to the ground under the building
    worst = P[Math.min(s - 1, Math.max(0, b.y)) * s + Math.min(s - 1, Math.max(0, b.x))];
  }
  return role === Role.WaterTreatment ? 1 - 0.3 * smooth(120, 255, worst) : 1 - 0.8 * smooth(35, 210, worst);
}

// ── terrain, stops, weather ─────────────────────────────────────────────────
export function packTerrain(world: World, pool: BufferPool): TerrainPacket {
  const s = world.size, n = s * s;
  const heights = new Float32Array(pool.take((s + 1) * (s + 1) * 4));
  heights.set(world.heights);
  const water = new Float32Array(pool.take(n * 4));
  water.set(world.water);
  const f = world.floodOffset;
  if (f !== 0) {
    const sl = world.seaLevel;
    for (let i = 0; i < n; i++) {
      const v = water[i];
      if (v > sl - 0.01 && v < sl + 0.01) water[i] = v + f;
    }
  }
  return { heights, water };
}

/** Walking catchment of a stop per mode: [amount 0..255, radius cells]. */
const STOP_REACH: Record<TransitMode, [number, number]> = {
  bus: [150, 5],
  tram: [170, 6],
  metro: [215, 8],
  train: [200, 9],
  ferry: [170, 7],
  monorail: [190, 7],
};

export function packStops(world: World, pool: BufferPool): { stops: Float32Array; stopCount: number } {
  let total = 0;
  for (const l of world.transitLines) if (l.active && l.vehicles > 0 && l.stops.length >= 2) total += l.stops.length;
  const cap = Math.max(256, Math.ceil(total / 256) * 256);
  const stops = new Float32Array(pool.take(cap * STOP_STRIDE * 4));
  let k = 0;
  for (const l of world.transitLines) {
    if (!l.active || l.vehicles <= 0 || l.stops.length < 2) continue;
    const [amount, radius] = STOP_REACH[l.mode] ?? STOP_REACH.bus;
    // frequency matters: a lone bus on a long loop is a poor service
    const freq = Math.min(1, 0.55 + (0.45 * l.vehicles) / Math.max(1, l.stops.length / 3));
    for (const c of l.stops) {
      const o = k * STOP_STRIDE;
      stops[o] = c.x;
      stops[o + 1] = c.y;
      stops[o + 2] = amount * freq;
      stops[o + 3] = radius;
      k++;
    }
  }
  return { stops, stopCount: k };
}

export function weatherPacket(world: World): WeatherPacket {
  const w = world.weather;
  const i = clamp01(w.intensity);
  const precipitation = w.type === 'rain' ? i : w.type === 'storm' ? Math.max(0.6, i) : w.type === 'snow' ? 0.5 * i : w.type === 'blizzard' ? 0.7 * i : 0;
  return {
    windDir: Number.isFinite(w.windDir) ? w.windDir : 0,
    windSpeed: Number.isFinite(w.windSpeed) ? Math.max(0, w.windSpeed) : 4,
    precipitation,
  };
}
