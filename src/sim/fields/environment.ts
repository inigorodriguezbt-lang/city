// ─────────────────────────────────────────────────────────────────────────────
// Environment fields: noise, air + water pollution, crime, land value,
// happiness and forest. Worker-safe (no DOM).
//
//  • Noise: roads (roadDef.noise × traffic), zoned industry / commerce,
//    construction sites → max-with-decay propagation (decibel-like: the
//    loudest source dominates), trees dampen, soft union with the radial noise
//    of special buildings (airports, stadiums, plants).
//  • Air pollution: zoned industry by type / level / activity, congested road
//    cells, plant / landfill stacks → two-scale blur (local + regional haze),
//    advected downwind with the weather, washed out by rain, absorbed by trees
//    and nature reserves, then eased in over in-game days.
//  • Water pollution: effluent of sewage outlets / treatment plants flows
//    through connected water cells (cheap downstream / along lakes, expensive
//    upstream) and adds to the pollution field on water and the shore.
//  • Land value: terrain (flatness, water view, elevation) + services + parks /
//    landmarks + transit + education − pollution − noise − crime − blight −
//    uncollected garbage, eased over days.
//  • Crime: poverty (low land value) × density, unemployment (residents vs
//    jobs nearby and city-wide), abandonment blight, minus police coverage.
//  • Happiness: overlay composite of coverage, land value and the negatives,
//    plus missing utilities on building footprints.
// ─────────────────────────────────────────────────────────────────────────────
import { BFlag, RoadType, ZoneType } from '../../core/types';
import { roadDef } from '../../data/roads';
import { stampSoft, type Emitter } from './coverage';
import { BlurScratch, BucketQueue, KernelShape, blurInPlace, chamferDecay, driftSmear, smoothFactor, stampAdd, toBytes } from './grid';
import {
  REC_F, REC_I, RF_BUILT, RF_JOBS, RF_RESIDENTS, RF_WORKERS, RI_FLAGS, RI_META, metaLevel, metaZone, META_SERVICE,
} from './protocol';
import type { Scene, TerrainState } from './scene';

// ── tuning ───────────────────────────────────────────────────────────────────
/** Pollution emitted per footprint cell at level 1 (0..255 scale, before blur). */
const ZONE_POLLUTION = new Float32Array(13);
ZONE_POLLUTION[ZoneType.Industry] = 62;
ZONE_POLLUTION[ZoneType.Farming] = 14;
ZONE_POLLUTION[ZoneType.Forestry] = 24;
ZONE_POLLUTION[ZoneType.Mining] = 78;
ZONE_POLLUTION[ZoneType.Oil] = 92;
ZONE_POLLUTION[ZoneType.ComLow] = 2;
ZONE_POLLUTION[ZoneType.ComHigh] = 5;
ZONE_POLLUTION[ZoneType.MixedUse] = 1;
/** Level multiplier: modern generic industry is much cleaner; resource extraction barely improves. */
const IND_LEVEL = [1, 1, 0.84, 0.7, 0.58, 0.48];
const OTHER_LEVEL = [1, 1, 0.95, 0.9, 0.85, 0.8];

/** Noise emitted per footprint cell (0..255 scale, before propagation). */
const ZONE_NOISE = new Float32Array(13);
ZONE_NOISE[ZoneType.Industry] = 80;
ZONE_NOISE[ZoneType.Farming] = 22;
ZONE_NOISE[ZoneType.Forestry] = 60;
ZONE_NOISE[ZoneType.Mining] = 90;
ZONE_NOISE[ZoneType.Oil] = 68;
ZONE_NOISE[ZoneType.ComLow] = 28;
ZONE_NOISE[ZoneType.ComHigh] = 50;
ZONE_NOISE[ZoneType.Office] = 18;
ZONE_NOISE[ZoneType.MixedUse] = 32;
ZONE_NOISE[ZoneType.ResHigh] = 16;
ZONE_NOISE[ZoneType.ResMed] = 9;
ZONE_NOISE[ZoneType.ResLow] = 4;
const CONSTRUCTION_NOISE = 58;
const CONSTRUCTION_DUST = 8;

/** Air pollution from traffic, per road type at full congestion. */
const ROAD_POLLUTION = new Float32Array(9);
ROAD_POLLUTION[RoadType.Dirt] = 30; // dust
ROAD_POLLUTION[RoadType.Street] = 30;
ROAD_POLLUTION[RoadType.Avenue] = 46;
ROAD_POLLUTION[RoadType.Boulevard] = 44;
ROAD_POLLUTION[RoadType.Highway] = 62;
ROAD_POLLUTION[RoadType.TramAvenue] = 38;
ROAD_POLLUTION[RoadType.Rail] = 10;

/** Road noise at 0..255: roadDef.noise × 255 × (NOISE_BASE + (1 − NOISE_BASE) × congestion). */
const NOISE_BASE = 0.3;
/** Land-value bonus next to pleasant road types (decays over ~2 cells). */
const ROAD_LV = new Float32Array(9);
ROAD_LV[RoadType.Boulevard] = 12;
ROAD_LV[RoadType.Pedestrian] = 14;
ROAD_LV[RoadType.TramAvenue] = 4;

/** How much pollution / noise depress land value, by the zone of the cell
 *  (industry barely cares about its own smoke; homes care the most). */
const LV_POLL_K = new Float32Array(13).fill(1);
const LV_NOISE_K = new Float32Array(13).fill(1);
for (const z of [ZoneType.Industry, ZoneType.Farming, ZoneType.Forestry, ZoneType.Mining, ZoneType.Oil]) {
  LV_POLL_K[z] = 0.35;
  LV_NOISE_K[z] = 0.3;
}
for (const z of [ZoneType.ComLow, ZoneType.ComHigh]) {
  LV_POLL_K[z] = 0.8;
  LV_NOISE_K[z] = 0.6;
}
LV_POLL_K[ZoneType.Office] = 0.9;
LV_NOISE_K[ZoneType.Office] = 0.8;
LV_NOISE_K[ZoneType.MixedUse] = 0.85;

/** Poverty drives crime where people live; job-only districts feel it less. */
const CRIME_POVERTY_K = new Float32Array(13).fill(1);
for (const z of [ZoneType.Industry, ZoneType.Farming, ZoneType.Forestry, ZoneType.Mining, ZoneType.Oil]) CRIME_POVERTY_K[z] = 0.45;
CRIME_POVERTY_K[ZoneType.ComLow] = 0.8;
CRIME_POVERTY_K[ZoneType.ComHigh] = 0.8;
CRIME_POVERTY_K[ZoneType.Office] = 0.6;

/** Per-day easing rates. */
const ALPHA_AIR_UP = 0.3;
const ALPHA_AIR_DOWN = 0.22;
const ALPHA_WATER_UP = 0.2;
const ALPHA_WATER_DOWN = 0.1;
const ALPHA_LV = 0.28;
const ALPHA_CRIME = 0.25;
const ALPHA_HAPPY = 0.45;
/** Forced recomputes while paused still move smoothed fields a little. */
const MIN_DAYS = 0.2;

/** Water pollution transport: cost units of 0.01 neper per cell. */
const WP_DOWN = 6;
const WP_UP = 24;
const WP_MAX = 470;

/** pow(v, 0.8) · 1.15 · 255 for v in [0, 1], 1024 steps */
const FOREST_LUT = new Uint8Array(1025);
for (let k = 0; k <= 1024; k++) FOREST_LUT[k] = Math.min(255, Math.round(Math.pow(k / 1024, 0.8) * 1.15 * 255));

const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/** Radial additive / union sources gathered from the building catalog by the engine. */
export interface EnvEmitters {
  /** additive land value (positive entries saturate, negative ones do not) */
  landValue: Emitter[];
  /** additive happiness (effects + attractiveness) */
  happiness: Emitter[];
  /** additive air pollution (negative = absorbers, applied after drift) */
  pollution: Emitter[];
  /** soft-union noise */
  noise: Emitter[];
  /** additive crime */
  crime: Emitter[];
}

/** Coverage fields the environment reads (0..255). */
export interface CoverageSet {
  police: Uint8Array;
  fire: Uint8Array;
  health: Uint8Array;
  education: Uint8Array;
  garbage: Uint8Array;
  deathcare: Uint8Array;
  leisure: Uint8Array;
  transit: Uint8Array;
  tourism: Uint8Array;
}

/** Utility service per record: bit0 power, bit1 water, bit2 sewage (served / needed). */
export const U_POWER = 1;
export const U_WATER = 2;
export const U_SEWAGE = 4;

export interface EnvInputs {
  cov: CoverageSet;
  emitters: EnvEmitters;
  /** per record utility bits actually delivered */
  served: Uint8Array;
  /** per record utility bits the building needs */
  needs: Uint8Array;
  /** raw sewage equivalents released per record (m³/day), 0 for non-processors */
  effluent: Float32Array;
}

export interface EnvOutputs {
  pollution: Uint8Array;
  noise: Uint8Array;
  crime: Uint8Array;
  landValue: Uint8Array;
  happiness: Uint8Array;
}

export class EnvironmentSolver {
  readonly n: number;
  private blur: BlurScratch;
  // per-run scratch
  private polE: Float32Array;
  private tmp: Float32Array;
  private noise: Float32Array;
  private people: Float32Array;
  // quarter-resolution residents / jobs balance (unemployment proxy)
  private cs: number;
  private cBlur: BlurScratch;
  private cRes: Float32Array;
  private cJobs: Float32Array;
  private cU: Float32Array;
  private blight: Float32Array;
  private lv: Float32Array;
  private lvPos: Float32Array;
  private crime: Float32Array;
  private happy: Float32Array;
  private water: Float32Array;
  private poll: Float32Array;
  private A: Float32Array;
  // terrain-derived land value base (rebuilt when terrain changes)
  private terrainLV: Float32Array;
  private terrainVersion = -1;
  // temporal state
  private airPrev: Float32Array;
  private waterPrev: Float32Array;
  private lvPrev: Float32Array;
  private crimePrev: Float32Array;
  private happyPrev: Float32Array;
  private hasPrev = false;
  // water transport
  private wDist: Int32Array;
  private wStamp: Int32Array;
  private wEpoch = 0;
  private bq = new BucketQueue(WP_MAX + 64);
  private rect = new Int32Array(4);

  constructor(readonly s: number) {
    const n = (this.n = s * s);
    this.blur = new BlurScratch(s, s);
    const f = () => new Float32Array(n);
    this.polE = f();
    this.tmp = f();
    this.noise = f();
    this.people = f();
    const cs = (this.cs = Math.ceil(s / 4));
    this.cBlur = new BlurScratch(cs, cs);
    this.cRes = new Float32Array(cs * cs);
    this.cJobs = new Float32Array(cs * cs);
    this.cU = new Float32Array(cs * cs);
    this.blight = f();
    this.lv = f();
    this.lvPos = f();
    this.crime = f();
    this.happy = f();
    this.water = f();
    this.poll = f();
    this.A = f();
    this.terrainLV = f();
    this.airPrev = f();
    this.waterPrev = f();
    this.lvPrev = f();
    this.crimePrev = f();
    this.happyPrev = f();
    this.wDist = new Int32Array(n);
    this.wStamp = new Int32Array(n);
  }

  /** Forget temporal state (new world session). */
  reset(): void {
    this.hasPrev = false;
    this.terrainVersion = -1;
  }

  /** Terrain part of land value: flat land, water views, hilltop views. */
  private buildTerrainLV(t: TerrainState, version: number): void {
    if (version === this.terrainVersion) return;
    this.terrainVersion = version;
    const L = this.terrainLV, n = this.n, wet = t.wet, slope = t.slope, shore = t.shoreDist, elev = t.elev;
    for (let i = 0; i < n; i++) {
      if (wet[i]) {
        L[i] = 0;
        continue;
      }
      const sl = slope[i];
      let v = 24 + 8 * (1 - smooth(0.03, 0.3, sl)) - 12 * smooth(0.3, 0.8, sl);
      const d = shore[i];
      if (d <= 6) {
        const k = 1 - (d - 1) / 6;
        v += 34 * Math.pow(k < 0 ? 0 : k, 1.3);
      }
      v += 22 * elev[i];
      L[i] = v;
    }
  }

  compute(sc: Scene, terrainVersion: number, inp: EnvInputs, out: EnvOutputs, stages: Record<string, number>): void {
    const s = this.s, n = this.n, t = sc.terrain;
    const full = sc.full || !this.hasPrev;
    const days = Math.max(MIN_DAYS, sc.days);
    let t0 = performance.now();
    const lap = (name: string): void => {
      const t1 = performance.now();
      stages[name] = (stages[name] ?? 0) + (t1 - t0);
      t0 = t1;
    };
    this.buildTerrainLV(t, terrainVersion);

    // ── sources from buildings ────────────────────────────────────────────
    const polE = this.polE, noise = this.noise, people = this.people, blight = this.blight;
    const cs = this.cs, cRes = this.cRes, cJobs = this.cJobs;
    polE.fill(0);
    noise.fill(0);
    people.fill(0);
    blight.fill(0);
    cRes.fill(0);
    cJobs.fill(0);
    let totalRes = 0, totalJobs = 0, anyBlight = false;
    const { recI, recF, count } = sc;
    const rc = this.rect;
    for (let r = 0; r < count; r++) {
      if (!sc.rect(r, rc)) continue;
      const oi = r * REC_I, of = r * REC_F;
      const meta = recI[oi + RI_META], flags = recI[oi + RI_FLAGS];
      if (flags & (BFlag.Collapsed | BFlag.Burned)) continue;
      const area = (rc[2] - rc[0]) * (rc[3] - rc[1]);
      const inv = 1 / area;
      const res = recF[of + RF_RESIDENTS], jb = recF[of + RF_JOBS], wk = recF[of + RF_WORKERS];
      totalRes += res;
      totalJobs += jb;
      const pp = (res + wk) * inv, rr = res * inv, jj = jb * inv;
      let pe = 0, ne = 0, bl = 0;
      const built = recF[of + RF_BUILT] >= 1;
      if (!built) {
        ne = CONSTRUCTION_NOISE;
        pe = CONSTRUCTION_DUST;
      } else if ((meta & META_SERVICE) === 0) {
        const z = metaZone(meta), lvl = metaLevel(meta);
        const lv = lvl < 1 ? 1 : lvl > 5 ? 5 : lvl;
        if (flags & BFlag.Abandoned) {
          pe = ZONE_POLLUTION[z] * 0.1;
          ne = ZONE_NOISE[z] * 0.15;
          bl = 150;
        } else {
          const op = jb > 0 ? 0.35 + 0.65 * Math.min(1, wk / jb) : 1;
          pe = ZONE_POLLUTION[z] * (z === ZoneType.Industry ? IND_LEVEL[lv] : OTHER_LEVEL[lv]) * op;
          ne = ZONE_NOISE[z] * (z === ZoneType.Industry ? 1 - 0.06 * (lv - 1) : z === ZoneType.ComHigh ? 1 + 0.08 * (lv - 1) : 1) * (0.5 + 0.5 * op);
        }
      }
      if (bl > 0) anyBlight = true;
      for (let y = rc[1]; y < rc[3]; y++) {
        const row = y * s, crow = (y >> 2) * cs;
        for (let x = rc[0]; x < rc[2]; x++) {
          const i = row + x;
          if (sc.bidx[i] !== r) continue;
          people[i] = pp;
          const ci = crow + (x >> 2);
          cRes[ci] += rr;
          cJobs[ci] += jj;
          if (pe > 0) polE[i] = pe;
          if (ne > noise[i]) noise[i] = ne;
          if (bl > 0) blight[i] = bl;
        }
      }
    }
    // roads: traffic exhaust + traffic noise
    const road = sc.road, rflags = sc.roadFlags, traffic = sc.traffic;
    const roadNoise = new Float32Array(9);
    for (let k = 1; k < 9; k++) roadNoise[k] = (roadDef(k as RoadType)?.noise ?? 0) * 255 * (k === RoadType.Boulevard ? 0.9 : 1);
    for (let i = 0; i < n; i++) {
      const rt = road[i];
      if (rt === 0) continue;
      const tunnel = (rflags[i] & 2) !== 0;
      const c = traffic[i] * (1 / 255);
      if (!tunnel) {
        const nv = roadNoise[rt] * (NOISE_BASE + (1 - NOISE_BASE) * c);
        if (nv > noise[i]) noise[i] = nv;
      }
      polE[i] += ROAD_POLLUTION[rt] * c * (tunnel ? 0.5 : 1);
    }
    lap('env.sources');

    // ── noise ─────────────────────────────────────────────────────────────
    const trees = sc.trees;
    chamferDecay(noise, s, s, 0.78);
    for (let i = 0; i < n; i++) if (trees[i]) noise[i] *= 1 - 0.09 * trees[i];
    blurInPlace(noise, this.blur, 1, 1);
    const A = this.A;
    A.fill(1);
    for (const e of inp.emitters.noise) stampSoft(A, s, e);
    for (let i = 0; i < n; i++) noise[i] = 255 - (255 - (noise[i] > 255 ? 255 : noise[i])) * A[i];
    toBytes(noise, out.noise);
    lap('env.noise');

    // ── air pollution ─────────────────────────────────────────────────────
    // local ground-level pollution (near) + regional haze (far) that the wind
    // carries; plant stacks feed the haze directly
    const near = this.tmp, drift = this.poll;
    near.set(polE);
    blurInPlace(near, this.blur, 2, 2);
    blurInPlace(polE, this.blur, 7, 2);
    for (const e of inp.emitters.pollution) if (e.amount > 0) stampAdd(polE, s, e.x0, e.y0, e.x1, e.y1, e.radius, e.amount, KernelShape.Bell);
    const wx = sc.weather;
    const ws = wx.windSpeed > 0 ? wx.windSpeed : 0;
    const step = Math.min(4, 0.3 + ws * 0.3);
    const mixDrift = Math.min(0.85, 0.3 + ws * 0.08);
    driftSmear(polE, drift, s, s, Math.cos(wx.windDir) * step, Math.sin(wx.windDir) * step, 3, 0.7);
    const wash = 1 - Math.min(0.5, 0.35 * wx.precipitation * (0.6 + 0.8 * sc.rainfall));
    for (let i = 0; i < n; i++) polE[i] = (near[i] * 0.8 + polE[i] * (1 - mixDrift) + drift[i] * mixDrift) * wash;
    for (const e of inp.emitters.pollution) if (e.amount < 0) stampAdd(polE, s, e.x0, e.y0, e.x1, e.y1, e.radius, e.amount, KernelShape.Plateau);
    for (let i = 0; i < n; i++) {
      let v = polE[i];
      if (trees[i]) v *= 1 - 0.1 * trees[i];
      polE[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    this.ease(this.airPrev, polE, ALPHA_AIR_UP, ALPHA_AIR_DOWN, days, full);
    lap('env.air');

    // ── water pollution ───────────────────────────────────────────────────
    const W = this.water;
    this.waterTransport(sc, inp.effluent, W);
    this.ease(this.waterPrev, W, ALPHA_WATER_UP, ALPHA_WATER_DOWN, days, full);
    const P = this.poll; // total pollution (air + water + shore smell)
    const wet = t.wet;
    const air = this.airPrev, wp = this.waterPrev;
    for (let i = 0; i < n; i++) {
      let v = air[i];
      if (wet[i]) v += wp[i];
      else if (t.shoreDist[i] === 1) {
        const x = i % s;
        let m = 0;
        if (x > 0 && wet[i - 1] && wp[i - 1] > m) m = wp[i - 1];
        if (x < s - 1 && wet[i + 1] && wp[i + 1] > m) m = wp[i + 1];
        if (i >= s && wet[i - s] && wp[i - s] > m) m = wp[i - s];
        if (i < n - s && wet[i + s] && wp[i + s] > m) m = wp[i + s];
        v += m * 0.4;
      }
      P[i] = v > 255 ? 255 : v;
    }
    toBytes(P, out.pollution);
    lap('env.water');

    // ── density, jobs balance, blight ─────────────────────────────────────
    blurInPlace(people, this.blur, 2, 2);
    if (anyBlight) blurInPlace(blight, this.blur, 3, 2);
    blurInPlace(cRes, this.cBlur, 5, 2);
    blurInPlace(cJobs, this.cBlur, 5, 2);
    const cU = this.cU;
    for (let k = 0; k < cU.length; k++) {
      const wf = cRes[k] * (0.55 / 16), jb = cJobs[k] / 16;
      const u = wf > 0.01 ? (wf - jb) / (wf + 3) : 0;
      cU[k] = u < 0 ? 0 : u > 1 ? 1 : u;
    }
    const workforce = totalRes * 0.55;
    const uCity = workforce > 1 ? Math.max(0, Math.min(1, (workforce - totalJobs) / workforce)) : 0;
    // big-city anonymity: dense districts of large cities breed more crime
    const citySize = smooth(2000, 200000, totalRes);
    lap('env.density');

    // ── land value (before crime) ─────────────────────────────────────────
    const { police, fire, health, education, garbage, deathcare, leisure, transit, tourism } = inp.cov;
    const lvPos = this.lvPos, lv = this.lv;
    lvPos.fill(0);
    lv.fill(0);
    for (const e of inp.emitters.landValue) stampAdd(e.amount > 0 ? lvPos : lv, s, e.x0, e.y0, e.x1, e.y1, e.radius, e.amount, KernelShape.Plateau);
    // pleasant road types lift their frontage
    const rb = this.tmp;
    rb.fill(0);
    let anyRoadBonus = false;
    for (let i = 0; i < n; i++) {
      const b = ROAD_LV[road[i]];
      if (b > 0) {
        rb[i] = b;
        anyRoadBonus = true;
      }
    }
    if (anyRoadBonus) chamferDecay(rb, s, s, 0.6);
    const TL = this.terrainLV, zone = sc.zone;
    const inv255 = 1 / 255;
    for (let i = 0; i < n; i++) {
      if (wet[i]) {
        lv[i] = 0;
        continue;
      }
      const pos = lvPos[i];
      const svc = (police[i] + fire[i] + health[i] + garbage[i] + deathcare[i]) * (7 * inv255) + education[i] * (10 * inv255) + leisure[i] * (22 * inv255) + transit[i] * (16 * inv255) + tourism[i] * (8 * inv255);
      const dn = people[i];
      const presence = smooth(0.05, 1.5, dn);
      const gb = garbage[i] < 40 ? (1 - garbage[i] / 40) * 5 * presence : 0;
      const nz = noise[i] - 50, zk = zone[i] < 13 ? zone[i] : 0;
      let v = TL[i] + rb[i] + svc + (pos > 0 ? 150 * (1 - Math.exp(-pos / 150)) : 0) + lv[i];
      v -= 0.6 * LV_POLL_K[zk] * P[i] + (nz > 0 ? 0.28 * LV_NOISE_K[zk] * nz : 0) + 0.35 * blight[i] + gb;
      lv[i] = v;
    }
    lap('env.landValue');

    // ── crime ─────────────────────────────────────────────────────────────
    const C = this.crime;
    C.fill(0);
    for (const e of inp.emitters.crime) stampAdd(C, s, e.x0, e.y0, e.x1, e.y1, e.radius, e.amount, KernelShape.Plateau);
    const lnMax = 1 / Math.log(51);
    for (let i = 0; i < n; i++) {
      if (wet[i]) {
        C[i] = 0;
        continue;
      }
      const d = people[i];
      const presence = smooth(0.05, 1.5, d);
      let v = C[i] + blight[i] * 0.9;
      if (presence > 0) {
        let dn = Math.log(1 + d) * lnMax;
        if (dn > 1) dn = 1;
        const zc = zone[i];
        const poverty = (1 - smooth(18, 125, lv[i])) * (zc < 13 ? CRIME_POVERTY_K[zc] : 1);
        // bilinear sample of the coarse unemployment grid
        const x = i % s, y = (i - x) / s;
        let gx = (x + 0.5) * 0.25 - 0.5, gy = (y + 0.5) * 0.25 - 0.5;
        gx = gx < 0 ? 0 : gx > cs - 1 ? cs - 1 : gx;
        gy = gy < 0 ? 0 : gy > cs - 1 ? cs - 1 : gy;
        const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
        const ix1 = ix + 1 < cs ? ix + 1 : ix, iy1 = iy + 1 < cs ? iy + 1 : iy;
        const uLocal = (cU[iy * cs + ix] * (1 - fx) + cU[iy * cs + ix1] * fx) * (1 - fy) + (cU[iy1 * cs + ix] * (1 - fx) + cU[iy1 * cs + ix1] * fx) * fy;
        const u = 0.35 * uLocal + 0.65 * uCity;
        v += presence * (22 + 38 * dn + 80 * poverty * (0.35 + 0.65 * dn) + 62 * u * (0.4 + 0.6 * dn) + 28 * citySize * dn);
      }
      const pc = police[i] / 190;
      v *= 1 - 0.8 * (pc > 1 ? 1 : pc);
      C[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    this.ease(this.crimePrev, C, ALPHA_CRIME, ALPHA_CRIME, days, full);
    toBytes(this.crimePrev, out.crime);
    lap('env.crime');

    // ── land value (final) ────────────────────────────────────────────────
    const cr = this.crimePrev;
    for (let i = 0; i < n; i++) {
      if (wet[i]) continue;
      const c = cr[i] - 60;
      const v = lv[i] - (c > 0 ? 0.32 * c : 0);
      lv[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    this.ease(this.lvPrev, lv, ALPHA_LV, ALPHA_LV, days, full);
    toBytes(this.lvPrev, out.landValue);
    lap('env.landValue2');

    // ── happiness ─────────────────────────────────────────────────────────
    const H = this.happy;
    H.fill(0);
    for (const e of inp.emitters.happiness) stampAdd(H, s, e.x0, e.y0, e.x1, e.y1, e.radius, e.amount, KernelShape.Plateau);
    const LV = this.lvPrev;
    for (let i = 0; i < n; i++) {
      if (wet[i]) {
        H[i] = 0;
        continue;
      }
      const cov6 = (police[i] + fire[i] + health[i] + education[i] + garbage[i] + deathcare[i]) * (42 / (6 * 255));
      const nz = noise[i] - 55, cz = cr[i] - 40;
      H[i] += 105 + cov6 + leisure[i] * (30 * inv255) + transit[i] * (10 * inv255) + 28 * smooth(25, 170, LV[i]) - 0.5 * P[i] - (nz > 0 ? 0.3 * nz : 0) - (cz > 0 ? 0.4 * cz : 0);
    }
    // footprints missing utilities
    const served = inp.served, needs = inp.needs;
    for (let r = 0; r < count; r++) {
      const miss = needs[r] & ~served[r];
      if (!miss || recF[r * REC_F + RF_BUILT] < 1) continue;
      if (!sc.rect(r, rc)) continue;
      const pen = (miss & U_POWER ? 45 : 0) + (miss & U_WATER ? 45 : 0) + (miss & U_SEWAGE ? 25 : 0);
      for (let y = rc[1]; y < rc[3]; y++) {
        const row = y * s;
        for (let x = rc[0]; x < rc[2]; x++) if (sc.bidx[row + x] === r) H[row + x] -= pen;
      }
    }
    for (let i = 0; i < n; i++) {
      const v = H[i];
      H[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    this.ease(this.happyPrev, H, ALPHA_HAPPY, ALPHA_HAPPY, days, full);
    toBytes(this.happyPrev, out.happiness);
    this.hasPrev = true;
    lap('env.happiness');
  }

  /**
   * Scenic tourism (shores, hilltops) folded into a coverage complement
   * product Π(1 − v/255). Only land cells.
   */
  scenic(t: TerrainState, A: Float32Array): void {
    const n = this.n, wet = t.wet, shore = t.shoreDist, elev = t.elev;
    for (let i = 0; i < n; i++) {
      if (wet[i]) continue;
      const d = shore[i];
      let v = d <= 3 ? 26 * (1 - (d - 1) / 3) : 0;
      v += 22 * elev[i];
      if (v > 0) A[i] *= 1 - v / 255;
    }
  }

  /** Forest resource from tree density (same shape as the map generator's). */
  forest(sc: Scene, out: Uint8Array): void {
    const n = this.n, f = this.tmp, trees = sc.trees, wet = sc.terrain.wet;
    for (let i = 0; i < n; i++) f[i] = trees[i] * (1 / 3);
    blurInPlace(f, this.blur, 2, 3);
    const lut = FOREST_LUT;
    const last = lut.length - 1;
    for (let i = 0; i < n; i++) {
      if (wet[i]) {
        out[i] = 0;
        continue;
      }
      const k = (f[i] * last + 0.5) | 0;
      out[i] = lut[k < 0 ? 0 : k > last ? last : k];
    }
  }

  /** Exponential easing of `target` into `prev` (in place); prev := target on full runs. */
  private ease(prev: Float32Array, target: Float32Array, up: number, down: number, days: number, full: boolean): void {
    const n = this.n;
    if (full) {
      prev.set(target);
      return;
    }
    const au = smoothFactor(up, days), ad = smoothFactor(down, days);
    for (let i = 0; i < n; i++) {
      const p = prev[i], d = target[i] - p;
      prev[i] = p + d * (d > 0 ? au : ad);
    }
  }

  /**
   * Effluent spreads through connected water cells. Strength decays with
   * transport cost (cheap going downstream or along a lake, expensive against
   * the current); overlapping plumes keep the strongest value.
   */
  private waterTransport(sc: Scene, effluent: Float32Array, W: Float32Array): void {
    W.fill(0);
    const s = this.s, n = this.n, t = sc.terrain, wet = t.wet, surf = t.surf;
    const { count } = sc;
    const bq = this.bq, dist = this.wDist, stamp = this.wStamp;
    const ep = ++this.wEpoch;
    bq.ensure(WP_MAX + 64);
    let any = false;
    const rc = this.rect;
    for (let r = 0; r < count; r++) {
      const e = effluent[r];
      if (!(e > 0) || !sc.rect(r, rc)) continue;
      const amount = 255 * (1 - Math.exp(-e / 380));
      if (amount < 2) continue;
      const d0 = Math.max(0, Math.round(-Math.log(amount / 255) * 100));
      // water cells within 2 cells of the footprint receive the discharge
      const x0 = Math.max(0, rc[0] - 2), y0 = Math.max(0, rc[1] - 2), x1 = Math.min(s - 1, rc[2] + 1), y1 = Math.min(s - 1, rc[3] + 1);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * s + x;
          if (!wet[i]) continue;
          if (stamp[i] === ep && dist[i] <= d0) continue;
          stamp[i] = ep;
          dist[i] = d0;
          bq.push(i, d0);
          any = true;
        }
    }
    if (!any) {
      bq.reset();
      return;
    }
    for (let d = 0; d <= WP_MAX && d <= bq.highest; d++) {
      let i: number;
      while ((i = bq.pop(d)) >= 0) {
        if (stamp[i] !== ep || dist[i] !== d) continue;
        W[i] = 255 * Math.exp(-d / 100);
        const x = i % s, si = surf[i] + 0.05;
        for (let k = 0; k < 4; k++) {
          let j: number;
          if (k === 0) { if (x === 0) continue; j = i - 1; }
          else if (k === 1) { if (x === s - 1) continue; j = i + 1; }
          else if (k === 2) { if (i < s) continue; j = i - s; }
          else { if (i >= n - s) continue; j = i + s; }
          if (!wet[j]) continue;
          const nd = d + (surf[j] > si ? WP_UP : WP_DOWN);
          if (nd > WP_MAX) continue;
          if (stamp[j] !== ep || nd < dist[j]) {
            stamp[j] = ep;
            dist[j] = nd;
            bq.push(j, nd);
          }
        }
      }
    }
    bq.reset();
  }
}
