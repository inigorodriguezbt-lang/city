// ─────────────────────────────────────────────────────────────────────────────
// Field engine: one compute run = utilities → coverage → environment.
// Runs inside fields.worker.ts (and on the main thread as a fallback when
// workers are unavailable). Keeps per-session state (terrain-derived layers,
// temporal smoothing) between runs; a new session token resets it.
// ─────────────────────────────────────────────────────────────────────────────
import { BFlag, type BuildingDef, type FieldId } from '../../core/types';
import { CoverageSolver, type Emitter } from './coverage';
import { EnvironmentSolver, U_POWER, U_SEWAGE, U_WATER, type CoverageSet, type EnvEmitters } from './environment';
import { BlurScratch } from './grid';
import {
  REC_F, REC_I, RF_BUILT, RF_EFF, RF_POWER, RF_SEWAGE, RF_WATER, RI_DEF, RI_FLAGS, RI_META, STOP_STRIDE,
  defAt, effluentShare, isAerial, metaRole, type FieldJob, type FieldResult, type NetworkStats,
} from './protocol';
import { Scene, TerrainState } from './scene';
import { NetworkGraph, UtilitySolver } from './utilities';

/** Road-distance services (vehicles drive the street network). */
type RoadField = 'police' | 'fire' | 'health' | 'education' | 'garbage' | 'deathcare';
const ROAD_FIELDS: RoadField[] = ['police', 'fire', 'health', 'education', 'garbage', 'deathcare'];

/** Building category whose effect on a road field travels by road. */
const ROAD_CATEGORY: Record<RoadField, string | null> = {
  police: 'police',
  education: 'education',
  // any building that fields trucks / ambulances / hearses serves by road
  fire: null,
  health: null,
  garbage: null,
  deathcare: null,
};

/** Attractiveness → happiness / tourism emitters. */
const ATTR_HAPPY_GAIN = 1.1;
const ATTR_TOURISM_GAIN = 1.4;

function isLookout(def: BuildingDef): boolean {
  const t = def.tags;
  return !!t && (t.includes('lookout') || t.includes('watch'));
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

class EmitterLists {
  road: Record<RoadField, Emitter[]> = { police: [], fire: [], health: [], education: [], garbage: [], deathcare: [] };
  radial: Record<RoadField | 'leisure' | 'transit' | 'tourism', Emitter[]> = {
    police: [], fire: [], health: [], education: [], garbage: [], deathcare: [], leisure: [], transit: [], tourism: [],
  };
  env: EnvEmitters = { landValue: [], happiness: [], pollution: [], noise: [], crime: [] };

  clear(): void {
    for (const k of ROAD_FIELDS) this.road[k].length = 0;
    for (const k of Object.keys(this.radial) as (keyof EmitterLists['radial'])[]) this.radial[k].length = 0;
    for (const k of Object.keys(this.env) as (keyof EnvEmitters)[]) this.env[k].length = 0;
  }
}

export class FieldEngine {
  private size = 0;
  private terrain!: TerrainState;
  private scene!: Scene;
  private blur!: BlurScratch;
  private graph!: NetworkGraph;
  private util!: UtilitySolver;
  private cov!: CoverageSolver;
  private env!: EnvironmentSolver;
  private token = Number.NaN;
  private terrainVersion = 0;
  private lists = new EmitterLists();
  // per-record scratch
  private cap = 0;
  private prodP = new Uint8Array(0);
  private prodW = new Uint8Array(0);
  private prodS = new Uint8Array(0);
  private supP = new Float32Array(0);
  private supW = new Float32Array(0);
  private supS = new Float32Array(0);
  private demP = new Float32Array(0);
  private demW = new Float32Array(0);
  private demS = new Float32Array(0);
  private srvP = new Uint8Array(0);
  private srvW = new Uint8Array(0);
  private srvS = new Uint8Array(0);
  private served = new Uint8Array(0);
  private needs = new Uint8Array(0);
  private effluent = new Float32Array(0);
  private rect = new Int32Array(4);
  /** trees of the last forest rebuild (skip the rebuild when unchanged) */
  private treesPrev = new Uint8Array(0);
  private treesValid = false;

  /** Drop all session state (a new world). */
  reset(): void {
    this.token = Number.NaN;
    this.env?.reset();
  }

  private allocate(size: number): void {
    this.size = size;
    const n = size * size;
    this.terrain = new TerrainState(size);
    this.scene = new Scene(size, this.terrain);
    this.blur = new BlurScratch(size, size);
    this.graph = new NetworkGraph(n);
    this.util = new UtilitySolver(n);
    this.cov = new CoverageSolver(size);
    this.env = new EnvironmentSolver(size);
    this.terrainVersion++;
  }

  private ensureRecords(count: number): void {
    if (count <= this.cap) return;
    const c = (this.cap = Math.max(count, this.cap * 2, 256));
    this.prodP = new Uint8Array(c);
    this.prodW = new Uint8Array(c);
    this.prodS = new Uint8Array(c);
    this.supP = new Float32Array(c);
    this.supW = new Float32Array(c);
    this.supS = new Float32Array(c);
    this.demP = new Float32Array(c);
    this.demW = new Float32Array(c);
    this.demS = new Float32Array(c);
    this.srvP = new Uint8Array(c);
    this.srvW = new Uint8Array(c);
    this.srvS = new Uint8Array(c);
    this.served = new Uint8Array(c);
    this.needs = new Uint8Array(c);
    this.effluent = new Float32Array(c);
  }

  run(job: FieldJob): FieldResult {
    const tStart = performance.now();
    const stages: Record<string, number> = {};
    let t0 = tStart;
    const lap = (name: string): void => {
      const t1 = performance.now();
      stages[name] = (stages[name] ?? 0) + (t1 - t0);
      t0 = t1;
    };
    const s = job.size, n = s * s;
    if (s !== this.size) this.allocate(s);
    if (job.token !== this.token) {
      this.token = job.token;
      this.env.reset();
      this.treesValid = false;
    }
    const recycle: ArrayBuffer[] = [];
    const seen = new Set<ArrayBuffer>();
    const giveBack = (b: ArrayBuffer | undefined): void => {
      if (b && !seen.has(b) && b.byteLength > 0) {
        seen.add(b);
        recycle.push(b);
      }
    };
    if (job.terrain) {
      this.terrain.apply(job.terrain, this.blur);
      this.terrainVersion++;
      giveBack(job.terrain.heights.buffer as ArrayBuffer);
      giveBack(job.terrain.water.buffer as ArrayBuffer);
    }
    lap('terrain');

    const sc = this.scene;
    sc.load(job);
    const count = sc.count;
    this.ensureRecords(count);

    // output buffers (reuse what the main thread handed back)
    const spare: ArrayBuffer[] = [];
    if (job.recycle) for (const b of job.recycle) if (b.byteLength === n && !seen.has(b)) { seen.add(b); spare.push(b); }
    const take = (): Uint8Array => {
      const b = spare.pop();
      return b ? new Uint8Array(b) : new Uint8Array(n);
    };
    const fields: Partial<Record<FieldId, Uint8Array>> = {};
    const out = (id: FieldId): Uint8Array => (fields[id] = take());

    // ── utilities ─────────────────────────────────────────────────────────
    const { recI, recF } = sc;
    const { prodP, prodW, prodS, supP, supW, supS, demP, demW, demS, needs } = this;
    for (let r = 0; r < count; r++) {
      const oi = r * REC_I, of = r * REC_F;
      const def = defAt(recI[oi + RI_DEF]);
      const p = recF[of + RF_POWER], w = recF[of + RF_WATER], q = recF[of + RF_SEWAGE];
      const pp = (def?.power ?? 0) > 0, pw = (def?.water ?? 0) > 0, ps = (def?.sewage ?? 0) > 0;
      prodP[r] = pp ? 1 : 0;
      prodW[r] = pw ? 1 : 0;
      prodS[r] = ps ? 1 : 0;
      supP[r] = pp && p < 0 ? -p : 0;
      supW[r] = pw && w < 0 ? -w : 0;
      supS[r] = ps && q < 0 ? -q : 0;
      demP[r] = !pp && p > 0 ? p : 0;
      demW[r] = !pw && w > 0 ? w : 0;
      demS[r] = !ps && q > 0 ? q : 0;
      needs[r] = (demP[r] > 0 ? U_POWER : 0) | (demW[r] > 0 ? U_WATER : 0) | (demS[r] > 0 ? U_SEWAGE : 0);
    }
    this.graph.build(sc);
    lap('util.graph');
    const power = stats(this.util.solve(sc, this.graph, prodP, supP, demP, out('power'), this.srvP));
    const water = stats(this.util.solve(sc, this.graph, prodW, supW, demW, out('water'), this.srvW));
    const sOut = this.util.solve(sc, this.graph, prodS, supS, demS, out('sewage'), this.srvS);
    const sewage = stats(sOut);
    // sewage actually handled by each processor → effluent released into the water
    const effluent = this.effluent, recComp = this.graph.recComp;
    for (let r = 0; r < count; r++) {
      effluent[r] = 0;
      if (!prodS[r] || supS[r] <= 0) continue;
      const c = recComp[r];
      if (c < 0 || sOut.compSupply[c] <= 0) continue;
      const load = (sOut.compServed[c] * supS[r]) / sOut.compSupply[c];
      effluent[r] = load * effluentShare(metaRole(recI[r * REC_I + RI_META]));
    }
    const served = this.served;
    for (let r = 0; r < count; r++) served[r] = (this.srvP[r] ? U_POWER : 0) | (this.srvW[r] ? U_WATER : 0) | (this.srvS[r] ? U_SEWAGE : 0);
    lap('util.solve');

    // ── emitters from the catalog ─────────────────────────────────────────
    this.collectEmitters(sc);
    const L = this.lists;
    for (let k = 0; k < sc.stopCount; k++) {
      const o = k * STOP_STRIDE;
      const x = Math.floor(sc.stops[o]), y = Math.floor(sc.stops[o + 1]);
      if (x < 0 || y < 0 || x >= s || y >= s) continue;
      L.radial.transit.push({ rec: -1, x0: x, y0: y, x1: x + 1, y1: y + 1, amount: sc.stops[o + 2], radius: sc.stops[o + 3] });
    }
    lap('emitters');

    // ── coverage ──────────────────────────────────────────────────────────
    const cov = this.cov;
    const set = {} as CoverageSet;
    for (const f of ROAD_FIELDS) {
      const o = out(f);
      cov.field(sc, L.road[f], L.radial[f], o);
      set[f] = o;
    }
    set.leisure = out('leisure');
    cov.field(sc, [], L.radial.leisure, set.leisure);
    set.transit = out('transit');
    cov.field(sc, [], L.radial.transit, set.transit);
    set.tourism = out('tourism');
    cov.field(sc, [], L.radial.tourism, set.tourism, (A) => this.env.scenic(this.terrain, A));
    lap('coverage');

    // ── environment ───────────────────────────────────────────────────────
    this.env.compute(sc, this.terrainVersion, { cov: set, emitters: L.env, served, needs, effluent }, {
      pollution: out('pollution'),
      noise: out('noise'),
      crime: out('crime'),
      landValue: out('landValue'),
      happiness: out('happiness'),
    }, stages);
    t0 = performance.now();
    // buildings clear trees constantly (Layer.Tree), so compare before rebuilding
    let forestDue = job.full || !this.treesValid || this.treesPrev.length !== n;
    if (!forestDue && job.treesChanged) forestDue = !sameBytes(this.treesPrev, sc.trees);
    if (forestDue) {
      this.env.forest(sc, out('forest'));
      if (this.treesPrev.length !== n) this.treesPrev = new Uint8Array(n);
      this.treesPrev.set(sc.trees);
      this.treesValid = true;
    }
    lap('forest');

    // hand every input buffer back for reuse
    giveBack(job.road.buffer as ArrayBuffer);
    giveBack(job.roadFlags.buffer as ArrayBuffer);
    giveBack(job.zone.buffer as ArrayBuffer);
    giveBack(job.trees.buffer as ArrayBuffer);
    giveBack(job.traffic.buffer as ArrayBuffer);
    giveBack(job.recI.buffer as ArrayBuffer);
    giveBack(job.recF.buffer as ArrayBuffer);
    giveBack(job.stops.buffer as ArrayBuffer);
    for (const b of spare) giveBack(b);
    return { token: job.token, fields, power, water, sewage, ms: performance.now() - tStart, stages, recycle };
  }

  /** Turn every active service building's catalog effects into emitters. */
  private collectEmitters(sc: Scene): void {
    const L = this.lists;
    L.clear();
    const { recI, recF, count } = sc;
    const rc = this.rect;
    for (let r = 0; r < count; r++) {
      const oi = r * REC_I, of = r * REC_F;
      const def = defAt(recI[oi + RI_DEF]);
      if (!def) continue;
      const flags = recI[oi + RI_FLAGS];
      if (flags & (BFlag.Collapsed | BFlag.Burned) || recF[of + RF_BUILT] < 1) continue;
      if (!sc.rect(r, rc)) continue;
      const x0 = rc[0], y0 = rc[1], x1 = rc[2], y1 = rc[3];
      const eff = clamp(recF[of + RF_EFF], 0, 1.5);
      const act = flags & BFlag.Disabled ? 0 : eff;
      const act1 = act > 1.25 ? 1.25 : act;
      const air = isAerial(def) || isLookout(def);
      const em = (radius: number, amount: number): Emitter => ({ rec: r, x0, y0, x1, y1, radius, amount });
      const effects = def.effects;
      if (effects) {
        for (const fx of effects) {
          const R = fx.radius, a = fx.amount;
          if (!(R > 0) || a === 0) continue;
          switch (fx.field) {
            case 'police':
            case 'fire':
            case 'health':
            case 'education':
            case 'garbage':
            case 'deathcare': {
              if (act <= 0 || a <= 0) break;
              const cat = ROAD_CATEGORY[fx.field];
              const byRoad = !air && (cat === null || def.category === cat);
              (byRoad ? L.road[fx.field] : L.radial[fx.field]).push(em(R, a * act));
              break;
            }
            case 'leisure':
            case 'transit':
            case 'tourism':
              if (act > 0 && a > 0) L.radial[fx.field].push(em(R, a * act));
              break;
            case 'landValue':
              // positive appeal fades with neglect; stigma of dumps and prisons does not
              L.env.landValue.push(em(R, a > 0 ? a * (0.5 + 0.5 * Math.min(1, act)) : a));
              break;
            case 'happiness':
              if (act > 0) L.env.happiness.push(em(R, a * act1));
              break;
            case 'pollution':
              if (a > 0 ? act > 0 : true) L.env.pollution.push(em(R, a > 0 ? a * act1 : a * Math.max(0.5, Math.min(1, act))));
              break;
            case 'noise':
              if (act > 0 && a > 0) L.env.noise.push(em(R, a * act1));
              break;
            case 'crime':
              if (a > 0) L.env.crime.push(em(R, a * Math.max(0.5, act1)));
              else if (act > 0) L.env.crime.push(em(R, a * act1));
              break;
            default:
              break;
          }
        }
      }
      const attr = def.attractiveness ?? 0;
      if (attr > 0 && act > 0) {
        const k = Math.min(1, act);
        L.env.happiness.push(em(clamp(6 + attr * 0.25, 6, 30), attr * ATTR_HAPPY_GAIN * k));
        L.radial.tourism.push(em(clamp(5 + attr * 0.2, 5, 28), attr * ATTR_TOURISM_GAIN * k));
      }
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const n = a.length;
  if ((a.byteOffset & 3) === 0 && (b.byteOffset & 3) === 0) {
    const m = n >> 2;
    const a4 = new Int32Array(a.buffer, a.byteOffset, m), b4 = new Int32Array(b.buffer, b.byteOffset, m);
    for (let i = 0; i < m; i++) if (a4[i] !== b4[i]) return false;
    for (let i = m << 2; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stats(o: NetworkStats): NetworkStats {
  return { produced: o.produced, consumed: o.consumed, connected: o.connected };
}
