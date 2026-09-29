// ─────────────────────────────────────────────────────────────────────────────
// Service coverage fields (0..255).
//
// Road-based services (police, fire, health, education, garbage, deathcare)
// travel the car network: a Dijkstra (Dial buckets, integer costs by road
// class, so highways reach further than gravel lanes) runs from the
// building's access road cells up to its effect radius in road distance. The
// value on each reached road cell is amount × falloff; the road values then
// spread up to 4 cells into the adjacent lots (decaying), so every building
// on a covered street is covered. Aerial units and wide-area effects are
// radial (straight-line). Multiple emitters combine with a soft union:
// v = 255 · (1 − Π(1 − vᵢ/255)).
// ─────────────────────────────────────────────────────────────────────────────
import { RoadType } from '../../core/types';
import { BucketQueue } from './grid';
import type { Scene } from './scene';

/** Cost (in 1/8 cell) of driving into a road cell of each type; 0 = impassable. */
const STEP_COST = new Uint8Array(9);
STEP_COST[RoadType.Dirt] = 10;
STEP_COST[RoadType.Street] = 8;
STEP_COST[RoadType.Avenue] = 7;
STEP_COST[RoadType.Boulevard] = 7;
STEP_COST[RoadType.Highway] = 5;
STEP_COST[RoadType.Pedestrian] = 11; // service vehicles only, walking pace
STEP_COST[RoadType.TramAvenue] = 8;
const COST_UNIT = 8;

/** Road cells that serve lots (frontage): every car road but highways, plus footpaths. */
const FRONTAGE = new Uint8Array(9);
for (const t of [RoadType.Dirt, RoadType.Street, RoadType.Avenue, RoadType.Boulevard, RoadType.Pedestrian, RoadType.TramAvenue]) FRONTAGE[t] = 1;

/** How far road coverage reaches into lots, and the decay per cell. */
const LOT_REACH = 4;
const LOT_DECAY = 0.87;

/** A coverage source: footprint rectangle (cells, max exclusive) + reach. */
export interface Emitter {
  /** record index (road emitters use its footprint for access), -1 for points */
  rec: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** cells (road distance or straight line) */
  radius: number;
  /** value at the source on the 0..255 scale (may exceed 255 → saturates) */
  amount: number;
}

/** Plateau-then-fade coverage falloff for t = d / radius (takes t²). */
export function coverFalloff(t2: number): number {
  if (t2 >= 1) return 0;
  const v = 1.2 * (1 - t2);
  return v > 1 ? 1 : v;
}

export class CoverageSolver {
  /** complement product Π(1 − v/255) */
  private A: Float32Array;
  /** road coverage spread into lots (0..255) */
  private O: Float32Array;
  private sdist: Uint8Array;
  private dist: Int32Array;
  private stamp: Int32Array;
  private epoch = 0;
  private bq = new BucketQueue(512);
  private access: number[] = [];
  private bbox = [0, 0, 0, 0];

  constructor(readonly s: number) {
    const n = s * s;
    this.A = new Float32Array(n);
    this.O = new Float32Array(n);
    this.sdist = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.stamp = new Int32Array(n);
  }

  /**
   * Compute one coverage field into `out`.
   * @param extra optional hook that folds more sources into the complement
   *        product (Π(1 − v/255)) before the final combine.
   */
  field(sc: Scene, road: Emitter[], radial: Emitter[], out: Uint8Array, extra?: (A: Float32Array) => void): void {
    const A = this.A, O = this.O, n = O.length;
    const hasRadial = radial.length > 0 || !!extra;
    let haveRoad = false;
    if (road.length) {
      A.fill(1);
      const bb = this.bbox;
      bb[0] = this.s; bb[1] = this.s; bb[2] = -1; bb[3] = -1;
      for (const e of road) this.roadEmitter(sc, e);
      if (bb[2] >= 0) {
        O.fill(0);
        this.spread(sc);
        haveRoad = true;
      }
    }
    if (!haveRoad && !hasRadial) {
      out.fill(0);
      return;
    }
    if (hasRadial) {
      A.fill(1);
      for (const e of radial) stampSoft(A, this.s, e);
      extra?.(A);
    }
    // soft union of the road spread (O) and the radial complement product (A)
    if (!hasRadial) for (let i = 0; i < n; i++) out[i] = (O[i] + 0.5) | 0;
    else if (!haveRoad) for (let i = 0; i < n; i++) out[i] = (255.5 - 255 * A[i]) | 0;
    else for (let i = 0; i < n; i++) out[i] = (255.5 - (255 - O[i]) * A[i]) | 0;
  }

  /** Dijkstra along the road graph from the building's access cells. */
  private roadEmitter(sc: Scene, e: Emitter): void {
    const s = this.s, road = sc.road, bidx = sc.bidx;
    const maxCost = Math.max(COST_UNIT, Math.round(e.radius * COST_UNIT));
    const access = this.access;
    access.length = 0;
    const x0 = Math.max(0, e.x0), y0 = Math.max(0, e.y0), x1 = Math.min(s, e.x1), y1 = Math.min(s, e.y1);
    const tryCell = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= s || y >= s) return;
      const i = y * s + x;
      if (FRONTAGE[road[i]] && bidx[i] < 0) access.push(i);
    };
    for (let x = x0; x < x1; x++) { tryCell(x, y0 - 1); tryCell(x, y1); }
    for (let y = y0; y < y1; y++) { tryCell(x0 - 1, y); tryCell(x1, y); }
    if (!access.length) return;

    const ep = ++this.epoch;
    const dist = this.dist, stamp = this.stamp, bq = this.bq, A = this.A, bb = this.bbox;
    bq.ensure(maxCost + 16);
    for (const i of access) {
      if (stamp[i] === ep) continue;
      stamp[i] = ep;
      dist[i] = 0;
      bq.push(i, 0);
    }
    const inv = 1 / maxCost;
    const amt = e.amount / 255;
    const n = s * s;
    for (let d = 0; d <= maxCost && d <= bq.highest; d++) {
      let i: number;
      while ((i = bq.pop(d)) >= 0) {
        if (dist[i] !== d || stamp[i] !== ep) continue;
        const t = d * inv;
        let v = amt * coverFalloff(t * t);
        if (v > 1) v = 1;
        A[i] *= 1 - v;
        const x = i % s, y = (i - x) / s;
        if (x < bb[0]) bb[0] = x;
        if (y < bb[1]) bb[1] = y;
        if (x > bb[2]) bb[2] = x;
        if (y > bb[3]) bb[3] = y;
        // relax the 4 neighbours
        for (let k = 0; k < 4; k++) {
          let j: number;
          if (k === 0) { if (x === 0) continue; j = i - 1; }
          else if (k === 1) { if (x === s - 1) continue; j = i + 1; }
          else if (k === 2) { if (i < s) continue; j = i - s; }
          else { if (i >= n - s) continue; j = i + s; }
          const c = STEP_COST[road[j]];
          if (c === 0) continue;
          const nd = d + c;
          if (nd > maxCost) continue;
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

  /** Spread road-cell coverage into lots (≤ LOT_REACH cells, decaying). */
  private spread(sc: Scene): void {
    const s = this.s, road = sc.road, wet = sc.terrain.wet;
    const A = this.A, O = this.O, D = this.sdist, bb = this.bbox;
    const x0 = Math.max(0, bb[0] - LOT_REACH - 1), y0 = Math.max(0, bb[1] - LOT_REACH - 1);
    const x1 = Math.min(s - 1, bb[2] + LOT_REACH + 1), y1 = Math.min(s - 1, bb[3] + LOT_REACH + 1);
    const BLOCK = 254, UNSET = 255;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, i = y * s + x0; x <= x1; x++, i++) {
        const t = road[i];
        if (t !== RoadType.None) {
          const v = 255 * (1 - A[i]);
          O[i] = t === RoadType.Rail ? 0 : v;
          D[i] = FRONTAGE[t] && v > 0 ? 0 : BLOCK;
        } else {
          O[i] = 0;
          D[i] = wet[i] ? BLOCK : UNSET;
        }
      }
    }
    const K = LOT_DECAY;
    // forward: from W and N
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, i = y * s + x0; x <= x1; x++, i++) {
        const di = D[i];
        if (di === 0 || di === BLOCK) continue;
        let best = O[i], bd = di;
        if (x > x0) { const dn = D[i - 1]; if (dn < LOT_REACH) { const c = O[i - 1] * K; if (c > best) { best = c; bd = dn + 1; } } }
        if (y > y0) { const dn = D[i - s]; if (dn < LOT_REACH) { const c = O[i - s] * K; if (c > best) { best = c; bd = dn + 1; } } }
        O[i] = best;
        D[i] = bd;
      }
    }
    // backward: from E and S
    for (let y = y1; y >= y0; y--) {
      for (let x = x1, i = y * s + x1; x >= x0; x--, i--) {
        const di = D[i];
        if (di === 0 || di === BLOCK) continue;
        let best = O[i], bd = di;
        if (x < x1) { const dn = D[i + 1]; if (dn < LOT_REACH) { const c = O[i + 1] * K; if (c > best) { best = c; bd = dn + 1; } } }
        if (y < y1) { const dn = D[i + s]; if (dn < LOT_REACH) { const c = O[i + s] * K; if (c > best) { best = c; bd = dn + 1; } } }
        O[i] = best;
        D[i] = bd;
      }
    }
  }
}

/**
 * Multiply a radial source into a complement product: straight-line distance
 * measured from the footprint rectangle (0 inside), coverage falloff.
 */
export function stampSoft(A: Float32Array, s: number, e: Emitter): void {
  const R = e.radius;
  if (R <= 0 || e.amount <= 0) return;
  const amt = e.amount / 255;
  const bx0 = Math.max(0, Math.floor(e.x0 - R)), by0 = Math.max(0, Math.floor(e.y0 - R));
  const bx1 = Math.min(s - 1, Math.ceil(e.x1 + R)), by1 = Math.min(s - 1, Math.ceil(e.y1 + R));
  const invR2 = 1 / (R * R);
  for (let y = by0; y <= by1; y++) {
    const cy = y + 0.5;
    const dy = cy < e.y0 ? e.y0 - cy : cy > e.y1 ? cy - e.y1 : 0;
    const dy2 = dy * dy * invR2;
    if (dy2 >= 1) continue;
    const row = y * s;
    for (let x = bx0; x <= bx1; x++) {
      const cx = x + 0.5;
      const dx = cx < e.x0 ? e.x0 - cx : cx > e.x1 ? cx - e.x1 : 0;
      const t2 = dx * dx * invR2 + dy2;
      if (t2 >= 1) continue;
      let v = amt * coverFalloff(t2);
      if (v > 1) v = 1;
      A[row + x] *= 1 - v;
    }
  }
}
