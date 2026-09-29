// Grid A* over the road cell graph. Shared by the path worker and the
// main-thread fallback (no DOM / THREE). Costs are travel times in seconds:
// cell length / mode speed, inflated by congestion, plus a small turn penalty
// so routes prefer fewer turns. The heuristic (Manhattan distance at the
// mode's top speed) is admissible, so paths are optimal for the cost model
// (the turn penalty is evaluated against the parent's arrival direction).
import { CELL } from '../../core/constants';
import { RoadType } from '../../core/types';
import { roadDef } from '../../data/roads';
import { tramCrossing } from './graph';
import { PMode } from './types';

const TURN_PENALTY = 1.6;
const MAX_TYPES = 16;

/** seconds to cross one cell, per mode × road type (Infinity = impassable) */
const COST = new Float32Array(8 * MAX_TYPES).fill(Infinity);
const VMAX = new Float32Array(8);
(() => {
  const ms = (kmh: number) => kmh / 3.6;
  for (let t = 1; t <= 8; t++) {
    const d = roadDef(t as RoadType);
    if (!d) continue;
    if (d.cars) {
      COST[PMode.Car * MAX_TYPES + t] = CELL / ms(d.speed);
      COST[PMode.Service * MAX_TYPES + t] = CELL / ms(d.speed);
      COST[PMode.Monorail * MAX_TYPES + t] = CELL / ms(70);
    }
    if (t === RoadType.Pedestrian) COST[PMode.Service * MAX_TYPES + t] = CELL / ms(12);
    if (t === RoadType.Rail) COST[PMode.Rail * MAX_TYPES + t] = CELL / ms(d.speed);
    if (t === RoadType.TramAvenue) COST[PMode.Tram * MAX_TYPES + t] = CELL / ms(d.speed);
  }
  VMAX[PMode.Car] = VMAX[PMode.Service] = ms(100);
  VMAX[PMode.Rail] = ms(140);
  VMAX[PMode.Tram] = ms(50);
  VMAX[PMode.Water] = 8;
  VMAX[PMode.Monorail] = ms(70);
})();

export class GridPathfinder {
  readonly n: number;
  road: Uint8Array;
  /** 1 where the cell is open water (ferries) */
  water: Uint8Array;
  /** congestion 0..255 per cell */
  cong: Uint8Array;
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heapI: Int32Array;
  private heapF: Float32Array;
  private heapN = 0;
  /** expansions performed by the last search (diagnostics) */
  lastExpanded = 0;

  constructor(readonly size: number) {
    const n = (this.n = size * size);
    this.road = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.cong = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heapI = new Int32Array(4096);
    this.heapF = new Float32Array(4096);
  }

  /** seconds to cross cell i in `mode` (Infinity if impassable) */
  cellCost(mode: PMode, i: number): number {
    if (mode === PMode.Water) return this.water[i] ? CELL / VMAX[PMode.Water] : Infinity;
    const c = COST[mode * MAX_TYPES + this.road[i]];
    if (c === Infinity) {
      if (mode === PMode.Tram && tramCrossing(this.road, this.size, i % this.size, (i / this.size) | 0)) return COST[PMode.Tram * MAX_TYPES + RoadType.TramAvenue];
      return c;
    }
    if (mode === PMode.Car || mode === PMode.Service) {
      const k = this.cong[i] * (1 / 255);
      return c * (1 + 2.4 * k * k);
    }
    return c;
  }

  passable(mode: PMode, i: number): boolean {
    return this.cellCost(mode, i) !== Infinity;
  }

  private push(i: number, f: number): void {
    if (this.heapN >= this.heapI.length) {
      const ni = new Int32Array(this.heapI.length * 2);
      ni.set(this.heapI);
      const nf = new Float32Array(this.heapF.length * 2);
      nf.set(this.heapF);
      this.heapI = ni;
      this.heapF = nf;
    }
    const hi = this.heapI, hf = this.heapF;
    let k = this.heapN++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      hi[k] = hi[p];
      hf[k] = hf[p];
      k = p;
    }
    hi[k] = i;
    hf[k] = f;
  }

  private pop(): number {
    const hi = this.heapI, hf = this.heapF;
    const top = hi[0];
    const n = --this.heapN;
    if (n > 0) {
      const li = hi[n], lf = hf[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hi[k] = hi[c];
        hf[k] = hf[c];
        k = c;
      }
      hi[k] = li;
      hf[k] = lf;
    }
    return top;
  }

  /**
   * Cheapest path from cell s to cell t (linear indices) as a cell list
   * (s first, t last), or null when unreachable within `maxExpand` nodes.
   */
  find(mode: PMode, s: number, t: number, maxExpand = 250_000): Int32Array | null {
    const size = this.size;
    if (s < 0 || t < 0 || s >= this.n || t >= this.n) return null;
    if (!this.passable(mode, s) || !this.passable(mode, t)) return null;
    if (s === t) return Int32Array.of(s);
    if (++this.gen === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const g = this.g, from = this.from, seen = this.seen, closed = this.closed;
    const inv = 1 / VMAX[mode];
    const tx = t % size, ty = (t / size) | 0;
    const h = (i: number): number => (Math.abs((i % size) - tx) + Math.abs(((i / size) | 0) - ty)) * CELL * inv;
    this.heapN = 0;
    g[s] = 0;
    from[s] = -1;
    seen[s] = gen;
    this.push(s, h(s));
    let expanded = 0;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === t) break;
      if (++expanded > maxExpand) {
        this.lastExpanded = expanded;
        return null;
      }
      const cx = cur % size, cy = (cur / size) | 0;
      const par = from[cur];
      const gc = g[cur];
      for (let d = 0; d < 4; d++) {
        let nx = cx, ny = cy;
        if (d === 0) ny--;
        else if (d === 1) nx++;
        else if (d === 2) ny++;
        else nx--;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (closed[ni] === gen) continue;
        const c = this.cellCost(mode, ni);
        if (c === Infinity) continue;
        let ng = gc + c;
        // turn penalty: compare the incoming step with this step
        if (par >= 0 && ni - cur !== cur - par) ng += TURN_PENALTY;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          from[ni] = cur;
          this.push(ni, ng + h(ni));
        }
      }
    }
    this.lastExpanded = expanded;
    if (closed[t] !== gen) return null;
    let len = 0;
    for (let i = t; i !== -1; i = from[i]) len++;
    const out = new Int32Array(len);
    let k = len - 1;
    for (let i = t; i !== -1; i = from[i]) out[k--] = i;
    return out;
  }
}
