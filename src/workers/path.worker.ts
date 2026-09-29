// Path worker: batched A* over the road cell graph for the traffic system.
// Holds its own copy of road types, the water mask and a congestion snapshot
// (patched incrementally by the main thread). Results are returned as one
// concatenated Int32Array of linear cell indices plus offsets (transferred).
import { exposeWorker } from '../core/rpc';
import { GridPathfinder } from '../sim/traffic/astar';
import type { PMode } from '../sim/traffic/types';

let pf: GridPathfinder | null = null;

export interface PathInit {
  size: number;
  road: Uint8Array;
  water: Uint8Array;
}
export interface PathPatch {
  x0: number;
  y0: number;
  w: number;
  h: number;
  road: Uint8Array;
}
export interface PathBatch {
  /** triples (mode, source cell, target cell) */
  reqs: Int32Array;
  maxExpand: number;
}
export interface PathBatchResult {
  /** k+1 offsets into cells; empty range = unreachable */
  offsets: Int32Array;
  cells: Int32Array;
  ms: number;
}

exposeWorker({
  init(a: PathInit): boolean {
    pf = new GridPathfinder(a.size);
    pf.road.set(a.road);
    pf.water.set(a.water);
    return true;
  },
  patch(a: PathPatch): boolean {
    if (!pf) return false;
    const size = pf.size;
    for (let y = 0; y < a.h; y++) pf.road.set(a.road.subarray(y * a.w, (y + 1) * a.w), (a.y0 + y) * size + a.x0);
    return true;
  },
  water(a: { water: Uint8Array }): boolean {
    if (!pf) return false;
    pf.water.set(a.water);
    return true;
  },
  cong(a: { cong: Uint8Array }): boolean {
    if (!pf) return false;
    pf.cong.set(a.cong);
    return true;
  },
  find(a: PathBatch, ctx): PathBatchResult {
    const t0 = performance.now();
    const k = (a.reqs.length / 3) | 0;
    const offsets = new Int32Array(k + 1);
    const parts: (Int32Array | null)[] = [];
    let total = 0;
    for (let i = 0; i < k; i++) {
      const p = pf ? pf.find(a.reqs[i * 3] as PMode, a.reqs[i * 3 + 1], a.reqs[i * 3 + 2], a.maxExpand) : null;
      parts.push(p);
      offsets[i] = total;
      total += p ? p.length : 0;
    }
    offsets[k] = total;
    const cells = new Int32Array(total);
    for (let i = 0; i < k; i++) {
      const p = parts[i];
      if (p) cells.set(p, offsets[i]);
    }
    ctx.transfer.push(offsets.buffer, cells.buffer);
    return { offsets, cells, ms: performance.now() - t0 };
  },
});
