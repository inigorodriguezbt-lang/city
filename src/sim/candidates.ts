// Incremental set of growable cells: zoned, empty, dry, buildable cells that
// touch an access road. One dense list per demand category allows O(1) random
// sampling; membership updates are O(1). Changes are picked up by rescanning
// dirty chunks under a per-tick budget so big edits never stall a frame.
import { CHUNK, MAX_LOT_SLOPE } from '../core/constants';
import { DIR_DX, DIR_DY, RoadType, ZoneType, type Rect, type ZoneCategory } from '../core/types';
import type { RNG } from '../core/rng';
import { zoneDef } from '../data/zones';
import type { World } from '../world/World';

export const CATS: ZoneCategory[] = ['res', 'com', 'ind', 'off'];
const CAT_INDEX: Record<ZoneCategory, number> = { res: 0, com: 1, ind: 2, off: 3 };

/** zone type → category index (mixed use grows with residential demand) */
const ZONE_CAT = new Int8Array(16).fill(-1);
for (let z = 1; z < 16; z++) {
  const d = zoneDef(z as ZoneType);
  if (d) ZONE_CAT[z] = CAT_INDEX[d.category];
}

export function catIndex(c: ZoneCategory): number {
  return CAT_INDEX[c];
}

/** road usable as building access (cars or pedestrians, not rail / highway) */
export function isAccessRoad(t: number): boolean {
  return t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Highway;
}

export class CandidateSet {
  private readonly size: number;
  private readonly pos: Int32Array;
  private readonly cat: Int8Array;
  private lists: Int32Array[] = [new Int32Array(1024), new Int32Array(1024), new Int32Array(1024), new Int32Array(1024)];
  private lens = [0, 0, 0, 0];
  private readonly chunksX: number;
  private readonly dirty: Uint8Array;
  private queue: number[] = [];
  private qHead = 0;
  /** day until which a cell is known not to fit any lot (0 = unknown) */
  private readonly unfit: Int32Array;
  /** zone the cell had when it was found unfit (a repaint gives it a new chance) */
  private readonly unfitZone: Uint8Array;

  constructor(private world: World) {
    this.size = world.size;
    const n = this.size * this.size;
    this.pos = new Int32Array(n).fill(-1);
    this.cat = new Int8Array(n).fill(-1);
    this.chunksX = Math.ceil(this.size / CHUNK);
    this.dirty = new Uint8Array(this.chunksX * this.chunksX);
    this.unfit = new Int32Array(n);
    this.unfitZone = new Uint8Array(n);
  }

  private get today(): number {
    return Math.floor(this.world.time.day);
  }

  /**
   * No lot fits at cell i right now: drop it until something changes nearby
   * (see markRect) or `days` have passed, so growth stops re-sampling it.
   */
  markUnfit(i: number, days: number): void {
    this.remove(i);
    this.unfit[i] = this.today + days;
    this.unfitZone[i] = this.world.zone[i];
  }

  count(c: number): number {
    return this.lens[c];
  }

  /** cells currently waiting for a rescan */
  get pendingChunks(): number {
    return this.queue.length - this.qHead;
  }

  /** evaluate whether cell i can host (part of) a new zoned building */
  eligible(x: number, y: number, i: number): number {
    const w = this.world;
    const z = w.zone[i];
    if (!z || w.road[i] || w.bldg[i]) return -1;
    if (this.unfit[i] > this.today && this.unfitZone[i] === z) return -1;
    const c = ZONE_CAT[z];
    if (c < 0) return -1;
    let access = false;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
      if (isAccessRoad(w.road[ny * this.size + nx])) {
        access = true;
        break;
      }
    }
    if (!access) return -1;
    if (w.cellSlope(x, y) > MAX_LOT_SLOPE) return -1;
    if (w.isWater(x, y)) return -1;
    return c;
  }

  private add(i: number, c: number): void {
    const cur = this.cat[i];
    if (cur === c) return;
    if (cur >= 0) this.remove(i);
    let list = this.lists[c];
    if (this.lens[c] >= list.length) {
      const grown = new Int32Array(list.length * 2);
      grown.set(list);
      this.lists[c] = list = grown;
    }
    list[this.lens[c]] = i;
    this.pos[i] = this.lens[c]++;
    this.cat[i] = c;
  }

  remove(i: number): void {
    const c = this.cat[i];
    if (c < 0) return;
    const list = this.lists[c];
    const p = this.pos[i];
    const last = list[--this.lens[c]];
    list[p] = last;
    this.pos[last] = p;
    this.pos[i] = -1;
    this.cat[i] = -1;
  }

  refreshCell(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = y * this.size + x;
    const c = this.eligible(x, y, i);
    if (c < 0) this.remove(i);
    else this.add(i, c);
  }

  /** synchronous rescan of a rect (small rects only) */
  refreshRect(r: Rect): void {
    const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0);
    const x1 = Math.min(this.size - 1, r.x1), y1 = Math.min(this.size - 1, r.y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.refreshCell(x, y);
  }

  fullScan(): void {
    this.unfit.fill(0);
    for (let c = 0; c < 4; c++) this.lens[c] = 0;
    this.pos.fill(-1);
    this.cat.fill(-1);
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      const i = y * this.size + x;
      const c = this.eligible(x, y, i);
      if (c >= 0) this.add(i, c);
    }
    this.dirty.fill(0);
    this.queue = [];
    this.qHead = 0;
  }

  /**
   * Queue the chunks overlapping rect (padded) for a budgeted rescan. With
   * `retryUnfit`, cells within a lot's reach of the change (a demolished
   * building, a new road) get another chance to host a lot.
   */
  markRect(r: Rect, pad = 1, retryUnfit = false): void {
    if (retryUnfit) {
      const reach = 4;
      const ux0 = Math.max(0, r.x0 - reach), uy0 = Math.max(0, r.y0 - reach);
      const ux1 = Math.min(this.size - 1, r.x1 + reach), uy1 = Math.min(this.size - 1, r.y1 + reach);
      for (let y = uy0; y <= uy1; y++) this.unfit.fill(0, y * this.size + ux0, y * this.size + ux1 + 1);
    }
    const cx0 = Math.max(0, Math.floor((r.x0 - pad) / CHUNK));
    const cy0 = Math.max(0, Math.floor((r.y0 - pad) / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((r.x1 + pad) / CHUNK));
    const cy1 = Math.min(this.chunksX - 1, Math.floor((r.y1 + pad) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * this.chunksX + cx;
        if (!this.dirty[k]) {
          this.dirty[k] = 1;
          this.queue.push(k);
        }
      }
  }

  markAll(): void {
    this.markRect({ x0: 0, y0: 0, x1: this.size - 1, y1: this.size - 1 }, 0);
  }

  /** rescan up to `budget` dirty chunks */
  process(budget: number): void {
    while (budget-- > 0 && this.qHead < this.queue.length) {
      const k = this.queue[this.qHead++];
      this.dirty[k] = 0;
      const cx = k % this.chunksX, cy = (k / this.chunksX) | 0;
      const x0 = cx * CHUNK, y0 = cy * CHUNK;
      const x1 = Math.min(this.size, x0 + CHUNK), y1 = Math.min(this.size, y0 + CHUNK);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.refreshCell(x, y);
    }
    if (this.qHead >= this.queue.length && this.qHead > 0) {
      this.queue = [];
      this.qHead = 0;
    }
  }

  /** random candidate cell index of category c, or -1 */
  random(c: number, rng: RNG): number {
    const n = this.lens[c];
    if (!n) return -1;
    return this.lists[c][Math.floor(rng.next() * n)];
  }

  has(i: number): boolean {
    return this.cat[i] >= 0;
  }
}
