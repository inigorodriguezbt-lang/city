// Reachability of the outside world through the road network. A BFS from the
// map's outside connections over road cells tells which buildings can receive
// commuters, tourists, imports and exports. Recomputed lazily after road edits.
import { DIR_DX, DIR_DY, RoadType, type Building } from '../core/types';
import type { World } from '../world/World';

export class OutsideReach {
  /** 1 = road cell connected to an outside connection */
  readonly reach: Uint8Array;
  dirty = true;
  /** number of reachable road cells */
  reachable = 0;
  /** map has at least one road/highway connection */
  hasConnections = false;
  private queue: Int32Array;

  constructor(private world: World) {
    this.reach = new Uint8Array(world.size * world.size);
    this.queue = new Int32Array(1024);
  }

  recompute(): void {
    const w = this.world;
    const s = w.size;
    this.reach.fill(0);
    this.reachable = 0;
    this.hasConnections = false;
    let head = 0, tail = 0;
    const push = (i: number) => {
      if (tail >= this.queue.length) {
        const g = new Int32Array(this.queue.length * 2);
        g.set(this.queue);
        this.queue = g;
      }
      this.queue[tail++] = i;
    };
    for (const c of w.connections) {
      if (c.kind !== 'highway') continue;
      if (!w.inBounds(c.x, c.y)) continue;
      const i = w.idx(c.x, c.y);
      const t = w.road[i];
      if (t === RoadType.None || t === RoadType.Rail) continue;
      this.hasConnections = true;
      if (!this.reach[i]) {
        this.reach[i] = 1;
        push(i);
      }
    }
    while (head < tail) {
      const i = this.queue[head++];
      this.reachable++;
      const x = i % s, y = (i / s) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const j = ny * s + nx;
        if (this.reach[j]) continue;
        const t = w.road[j];
        if (t === RoadType.None || t === RoadType.Rail) continue;
        this.reach[j] = 1;
        push(j);
      }
    }
    this.dirty = false;
  }

  /** true when any road cell touching the footprint reaches the outside */
  building(b: Building): boolean {
    if (!this.hasConnections) return false;
    const w = this.world, s = w.size, r = this.reach;
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
    for (let x = x0; x <= x1; x++) {
      if (y0 > 0 && r[(y0 - 1) * s + x]) return true;
      if (y1 < s - 1 && r[(y1 + 1) * s + x]) return true;
    }
    for (let y = y0; y <= y1; y++) {
      if (x0 > 0 && r[y * s + x0 - 1]) return true;
      if (x1 < s - 1 && r[y * s + x1 + 1]) return true;
    }
    return false;
  }
}
