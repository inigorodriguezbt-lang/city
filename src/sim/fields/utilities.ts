// ─────────────────────────────────────────────────────────────────────────────
// Utility networks (power, water, sewage).
//
// Wires and pipes follow every road type (streets, highways, rail, footpaths)
// and pass through touching buildings: a building joins the network when any
// footprint cell is 4-adjacent to a network road cell or to another building
// on the network. Offshore buildings that need no road reach the nearest
// network cell with a submarine cable. Each connected component is its own
// grid: producers inject supply, and consumers are served in breadth-first
// order from the producers (closest first) while supply lasts, so a shortage
// darkens the fringe of the network first. Output per cell: 255 on served
// footprints and on road cells of networks that have any supply, else 0.
// ─────────────────────────────────────────────────────────────────────────────
import { REC_I, RI_H, RI_W, RI_X, RI_Y, metaCable, type NetworkStats } from './protocol';
import type { Scene } from './scene';

/** How far an offshore building may run a cable to the grid (cells). */
const CABLE_RANGE = 18;

export class NetworkGraph {
  /** component id per cell (-1 = not part of any network) */
  comp: Int32Array;
  /** component id per record (-1 = off-map) */
  recComp = new Int32Array(0);
  compCount = 0;
  /** extra bidirectional edges (cable links): cell → cells */
  links = new Map<number, number[]>();
  queue: Int32Array;

  constructor(readonly n: number) {
    this.comp = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  build(sc: Scene): void {
    const { s, n, road, bidx, count } = sc;
    const comp = this.comp, queue = this.queue;
    this.links.clear();
    this.linkCables(sc);
    const links = this.links, hasLinks = links.size > 0;
    comp.fill(-1);
    let cc = 0;
    for (let start = 0; start < n; start++) {
      if (comp[start] >= 0 || (road[start] === 0 && bidx[start] < 0)) continue;
      comp[start] = cc;
      let head = 0, tail = 0;
      queue[tail++] = start;
      while (head < tail) {
        const i = queue[head++];
        const x = i % s;
        let j: number;
        if (x > 0) { j = i - 1; if (comp[j] < 0 && (road[j] !== 0 || bidx[j] >= 0)) { comp[j] = cc; queue[tail++] = j; } }
        if (x < s - 1) { j = i + 1; if (comp[j] < 0 && (road[j] !== 0 || bidx[j] >= 0)) { comp[j] = cc; queue[tail++] = j; } }
        if (i >= s) { j = i - s; if (comp[j] < 0 && (road[j] !== 0 || bidx[j] >= 0)) { comp[j] = cc; queue[tail++] = j; } }
        if (i < n - s) { j = i + s; if (comp[j] < 0 && (road[j] !== 0 || bidx[j] >= 0)) { comp[j] = cc; queue[tail++] = j; } }
        if (hasLinks) {
          const extra = links.get(i);
          if (extra) for (const e of extra) if (comp[e] < 0) { comp[e] = cc; queue[tail++] = e; }
        }
      }
      cc++;
    }
    this.compCount = cc;
    if (this.recComp.length < count) this.recComp = new Int32Array(Math.max(count, this.recComp.length * 2, 64));
    const recI = sc.recI;
    for (let r = 0; r < count; r++) {
      const o = r * REC_I;
      const x = Math.min(s - 1, Math.max(0, recI[o + RI_X])), y = Math.min(s - 1, Math.max(0, recI[o + RI_Y]));
      const i = y * s + x;
      this.recComp[r] = bidx[i] === r ? comp[i] : -1;
    }
  }

  /** Offshore producers: link their footprint to the nearest network cell. */
  private linkCables(sc: Scene): void {
    const { s, road, bidx, count, recI } = sc;
    for (let r = 0; r < count; r++) {
      if (!metaCable(sc.meta(r))) continue;
      const o = r * REC_I;
      const bx = recI[o + RI_X], by = recI[o + RI_Y], bw = recI[o + RI_W], bh = recI[o + RI_H];
      const cx = Math.min(s - 1, Math.max(0, bx + (bw >> 1))), cy = Math.min(s - 1, Math.max(0, by + (bh >> 1)));
      if (bidx[cy * s + cx] !== r) continue;
      let best = -1, bestD = Infinity;
      for (let ring = 1; ring <= CABLE_RANGE; ring++) {
        // every cell on this ring is at least `ring` cells from the centre
        if (ring * ring > bestD) break;
        const x0 = cx - ring, x1 = cx + ring, y0 = cy - ring, y1 = cy + ring;
        for (let y = y0; y <= y1; y++) {
          if (y < 0 || y >= s) continue;
          const edgeRow = y === y0 || y === y1;
          for (let x = x0; x <= x1; x += edgeRow ? 1 : x1 - x0) {
            if (x < 0 || x >= s) continue;
            const i = y * s + x;
            if (bidx[i] === r || (road[i] === 0 && bidx[i] < 0)) continue;
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      if (best < 0) continue;
      const a = cy * s + cx;
      this.addLink(a, best);
      this.addLink(best, a);
    }
  }

  private addLink(a: number, b: number): void {
    const l = this.links.get(a);
    if (l) l.push(b);
    else this.links.set(a, [b]);
  }
}

/** Result of one utility solve, with per-component loads for effluent. */
export interface UtilityOutcome extends NetworkStats {
  /** total supply per component */
  compSupply: Float64Array;
  /** demand actually served per component */
  compServed: Float64Array;
}

export class UtilitySolver {
  private visit: Uint8Array;
  private seen = new Uint8Array(0);
  private compSupply = new Float64Array(0);
  private compServed = new Float64Array(0);
  private remaining = new Float64Array(0);

  constructor(readonly n: number) {
    this.visit = new Uint8Array(n);
  }

  /**
   * Solve one utility over the shared network graph.
   * @param supply per record supply (>= 0); `producer[r]` marks producers
   * @param demand per record demand (>= 0) for non-producers
   * @param out per-cell output (0 / 255), fully overwritten
   * @param served per-record served flag, fully overwritten
   */
  solve(sc: Scene, g: NetworkGraph, producer: Uint8Array, supply: Float32Array, demand: Float32Array, out: Uint8Array, served: Uint8Array): UtilityOutcome {
    const { s, n, road, bidx, count, recI } = sc;
    const cc = g.compCount;
    if (this.compSupply.length < cc) {
      const m = Math.max(cc, this.compSupply.length * 2, 64);
      this.compSupply = new Float64Array(m);
      this.compServed = new Float64Array(m);
      this.remaining = new Float64Array(m);
    }
    if (this.seen.length < count) this.seen = new Uint8Array(Math.max(count, this.seen.length * 2, 64));
    const compSupply = this.compSupply, compServed = this.compServed, remaining = this.remaining;
    compSupply.fill(0, 0, cc);
    compServed.fill(0, 0, cc);
    const recComp = g.recComp;
    let produced = 0;
    let hasProducer = false;
    for (let r = 0; r < count; r++) {
      served[r] = 0;
      if (!producer[r]) continue;
      hasProducer = true;
      produced += supply[r];
      const c = recComp[r];
      if (c >= 0) compSupply[c] += supply[r];
    }
    for (let c = 0; c < cc; c++) remaining[c] = compSupply[c];
    out.fill(0);
    const stats: UtilityOutcome = { produced, consumed: 0, connected: 0, compSupply, compServed };
    if (!hasProducer) return stats;

    // multi-source BFS from every producer footprint of a supplied network
    const comp = g.comp, queue = g.queue, visit = this.visit, seen = this.seen;
    visit.fill(0);
    seen.fill(0, 0, count);
    const links = g.links, hasLinks = links.size > 0;
    let tail = 0;
    for (let r = 0; r < count; r++) {
      if (!producer[r]) continue;
      const c = recComp[r];
      if (c < 0 || compSupply[c] <= 0) continue;
      const o = r * REC_I;
      const x0 = Math.max(0, recI[o + RI_X]), y0 = Math.max(0, recI[o + RI_Y]);
      const x1 = Math.min(s, recI[o + RI_X] + recI[o + RI_W]), y1 = Math.min(s, recI[o + RI_Y] + recI[o + RI_H]);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * s + x;
          if (bidx[i] !== r || visit[i]) continue;
          visit[i] = 1;
          queue[tail++] = i;
        }
    }
    let head = 0;
    while (head < tail) {
      const i = queue[head++];
      const r = bidx[i];
      if (r >= 0 && !seen[r]) {
        seen[r] = 1;
        if (producer[r]) served[r] = 1;
        else {
          const c = recComp[r];
          const d = demand[r];
          if (c >= 0 && remaining[c] + 1e-6 >= d) {
            remaining[c] -= d;
            compServed[c] += d;
            served[r] = 1;
          }
        }
      }
      const x = i % s;
      let j: number;
      if (x > 0) { j = i - 1; if (!visit[j] && (road[j] !== 0 || bidx[j] >= 0)) { visit[j] = 1; queue[tail++] = j; } }
      if (x < s - 1) { j = i + 1; if (!visit[j] && (road[j] !== 0 || bidx[j] >= 0)) { visit[j] = 1; queue[tail++] = j; } }
      if (i >= s) { j = i - s; if (!visit[j] && (road[j] !== 0 || bidx[j] >= 0)) { visit[j] = 1; queue[tail++] = j; } }
      if (i < n - s) { j = i + s; if (!visit[j] && (road[j] !== 0 || bidx[j] >= 0)) { visit[j] = 1; queue[tail++] = j; } }
      if (hasLinks) {
        const extra = links.get(i);
        if (extra) for (const e of extra) if (!visit[e]) { visit[e] = 1; queue[tail++] = e; }
      }
    }

    // road cells of supplied networks show the grid
    for (let i = 0; i < n; i++) {
      if (road[i] === 0) continue;
      const c = comp[i];
      if (c >= 0 && compSupply[c] > 0) out[i] = 255;
    }
    // served footprints; demand that the supplied networks see
    for (let r = 0; r < count; r++) {
      const c = recComp[r];
      if (!producer[r] && c >= 0 && compSupply[c] > 0) {
        stats.consumed += demand[r];
        if (served[r]) stats.connected++;
      }
      if (!served[r]) continue;
      const o = r * REC_I;
      const x0 = Math.max(0, recI[o + RI_X]), y0 = Math.max(0, recI[o + RI_Y]);
      const x1 = Math.min(s, recI[o + RI_X] + recI[o + RI_W]), y1 = Math.min(s, recI[o + RI_Y] + recI[o + RI_H]);
      for (let y = y0; y < y1; y++) {
        const row = y * s;
        for (let x = x0; x < x1; x++) if (bidx[row + x] === r) out[row + x] = 255;
      }
    }
    return stats;
  }
}
