// ─────────────────────────────────────────────────────────────────────────────
// Drainage routing on a regular grid: Priority-Flood depression handling
// (Barnes et al. 2014) that yields, in a single O(n log n) sweep,
//   • F      – the depression-filled surface,
//   • rec    – a receiver for every node (steepest descent on F, or the flood
//              parent inside flats/depressions), forming a forest rooted at outlets,
//   • order  – a topological order (every receiver precedes its donors).
// ─────────────────────────────────────────────────────────────────────────────
import { IntQueue, MinHeap, N8_DX, N8_DY, N8_LEN } from './grid';

export interface FlowGraph {
  w: number;
  h: number;
  /** filled surface */
  F: Float32Array;
  /** receiver index or -1 for outlets */
  rec: Int32Array;
  /** horizontal distance to the receiver (grid units) */
  recLen: Float32Array;
  /** node indices in flood order (receivers before donors) */
  order: Int32Array;
  /** position of each node in `order` */
  rank: Int32Array;
  /** 1 where the node was raised by depression filling */
  raised: Uint8Array;
}

export interface FloodOptions {
  /** extra outlet seeds (e.g. ocean) with their seed elevation */
  outlet?: Uint8Array | null;
  outletLevel?: number;
  /** treat every map-edge node as a potential outlet (default true) */
  edges?: boolean;
  /** edge nodes with a lower, earlier-flooded interior neighbour drain inward instead of off-map */
  redirectEdges?: boolean;
  /**
   * Priority-Flood+ε: filled cells rise by ε per step away from the spill
   * point so flats drain toward their outlet (0 = perfectly flat fill).
   */
  epsilon?: number;
}

const heapCache = { heap: new MinHeap(4096), queue: new IntQueue(4096) };

export function priorityFlood(z: Float32Array, w: number, h: number, opt: FloodOptions = {}): FlowGraph {
  const n = w * h;
  const F = new Float32Array(z);
  const rec = new Int32Array(n).fill(-1);
  const recLen = new Float32Array(n);
  const order = new Int32Array(n);
  const rank = new Int32Array(n);
  const raised = new Uint8Array(n);
  const closed = new Uint8Array(n);
  const heap = heapCache.heap, pit = heapCache.queue;
  heap.clear();
  pit.clear();
  const outlet = opt.outlet ?? null;
  const useEdges = opt.edges !== false;
  if (outlet) {
    const lvl = opt.outletLevel;
    for (let i = 0; i < n; i++) {
      if (!outlet[i]) continue;
      if (lvl !== undefined) F[i] = lvl;
      closed[i] = 1;
      heap.push(F[i], i);
    }
  }
  if (useEdges) {
    const seed = (i: number) => {
      if (closed[i]) return;
      closed[i] = 1;
      heap.push(F[i], i);
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      seed(y * w);
      seed(y * w + w - 1);
    }
  }
  const pending = -2;
  const eps = opt.epsilon ?? 0;
  let oc = 0;
  while (pit.length > 0 || heap.size > 0) {
    const c = pit.length > 0 ? pit.shift() : heap.pop();
    rank[c] = oc;
    order[oc++] = c;
    const cx = c % w, cy = (c / w) | 0;
    const fc = F[c];
    for (let k = 0; k < 8; k++) {
      const nx = cx + N8_DX[k], ny = cy + N8_DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (closed[j]) continue;
      closed[j] = 1;
      if (F[j] <= fc + eps) {
        if (F[j] < fc + eps) {
          if (F[j] < fc) raised[j] = 1;
          F[j] = fc + eps;
        }
        rec[j] = c;
        recLen[j] = N8_LEN[k];
        pit.push(j);
      } else {
        rec[j] = pending;
        heap.push(F[j], j);
      }
    }
  }
  // steepest descent receivers for nodes reached through the heap
  for (let i = 0; i < n; i++) {
    if (rec[i] !== pending) continue;
    const x = i % w, y = (i / w) | 0;
    const fi = F[i];
    let best = -1, bestS = 0, bestL = 1;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8_DX[k], ny = y + N8_DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const d = fi - F[j];
      if (d <= 0 || rank[j] > rank[i]) continue;
      const s = d / N8_LEN[k];
      if (s > bestS) {
        bestS = s;
        best = j;
        bestL = N8_LEN[k];
      }
    }
    rec[i] = best;
    recLen[i] = bestL;
  }
  if (opt.redirectEdges) {
    for (let i = 0; i < n; i++) {
      if (rec[i] !== -1) continue;
      if (outlet && outlet[i]) continue;
      const x = i % w, y = (i / w) | 0;
      if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue;
      const fi = F[i];
      let best = -1, bestS = 0, bestL = 1;
      for (let k = 0; k < 8; k++) {
        const nx = x + N8_DX[k], ny = y + N8_DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const d = fi - F[j];
        if (d <= 0 || rank[j] > rank[i]) continue;
        // only drain toward the interior (never along the edge into another edge node)
        if (nx === 0 || ny === 0 || nx === w - 1 || ny === h - 1) continue;
        const s = d / N8_LEN[k];
        if (s > bestS) {
          bestS = s;
          best = j;
          bestL = N8_LEN[k];
        }
      }
      if (best >= 0) {
        rec[i] = best;
        recLen[i] = bestL;
      }
    }
  }
  return { w, h, F, rec, recLen, order, rank, raised };
}

/** Accumulate `weight` (per-node contribution) downstream. Returns total flow per node. */
export function accumulate(g: FlowGraph, weight: Float32Array | number): Float32Array {
  const n = g.w * g.h;
  const A = typeof weight === 'number' ? new Float32Array(n).fill(weight) : new Float32Array(weight);
  const { order, rec } = g;
  for (let k = n - 1; k >= 0; k--) {
    const c = order[k];
    const r = rec[c];
    if (r >= 0) A[r] += A[c];
  }
  return A;
}
