// Road graph for the traffic system: per-cell classification (car / pedestrian
// / rail / tram / highway / bridge), compact road indices for per-frame
// arrays, car degree (junction detection), lazily computed connected
// components per path mode (instant reachability checks) and building access
// cells. Rebuilt incrementally from 'world:changed' Road rects.
import { DIR_DX, DIR_DY, RoadType, type Building, type Rect } from '../../core/types';
import { roadDef } from '../../data/roads';
import type { World } from '../../world/World';
import { PMode, PMODE_COUNT } from './types';

export const enum K {
  Car = 1,
  Ped = 2,
  Rail = 4,
  Tram = 8,
  Hwy = 16,
  Bridge = 32,
  Walk = 64, // has sidewalks / walkable surface
}

const CAR_TYPES = new Uint8Array(16);
for (let t = 1; t <= 8; t++) if (roadDef(t as RoadType)?.cars) CAR_TYPES[t] = 1;

export function kindOf(t: RoadType, bridge: boolean): number {
  if (t === RoadType.None) return 0;
  let k = 0;
  if (CAR_TYPES[t]) k |= K.Car;
  if (t === RoadType.Pedestrian) k |= K.Ped | K.Walk;
  if (t === RoadType.Rail) k |= K.Rail;
  if (t === RoadType.TramAvenue) k |= K.Tram;
  if (t === RoadType.Highway) k |= K.Hwy;
  if (t === RoadType.Street || t === RoadType.Avenue || t === RoadType.Boulevard || t === RoadType.TramAvenue) k |= K.Walk;
  if (bridge) k |= K.Bridge;
  return k;
}

/** a car junction next to a tram avenue: trams may cross it */
export function tramCrossing(road: Uint8Array, s: number, x: number, y: number): boolean {
  const i = y * s + x;
  const t = road[i];
  if (t === RoadType.TramAvenue || !CAR_TYPES[t]) return false;
  let tram = 0, roads = 0;
  if (y > 0 && road[i - s]) (roads++, road[i - s] === RoadType.TramAvenue && tram++);
  if (x < s - 1 && road[i + 1]) (roads++, road[i + 1] === RoadType.TramAvenue && tram++);
  if (y < s - 1 && road[i + s]) (roads++, road[i + s] === RoadType.TramAvenue && tram++);
  if (x > 0 && road[i - 1]) (roads++, road[i - 1] === RoadType.TramAvenue && tram++);
  return tram >= 1 && roads >= 3;
}

/** kind bits a cell needs to be usable by a path mode */
export function modeMask(mode: PMode): number {
  switch (mode) {
    case PMode.Car:
    case PMode.Monorail:
      return K.Car;
    case PMode.Service:
      return K.Car | K.Ped;
    case PMode.Rail:
      return K.Rail;
    case PMode.Tram:
      return K.Tram;
    default:
      return 0;
  }
}

export class RoadGraph {
  readonly size: number;
  readonly n: number;
  /** K bits per cell */
  readonly kind: Uint8Array;
  /** road index per cell (-1 = not a road) */
  rid: Int32Array;
  /** cell of each road index */
  cells: Int32Array = new Int32Array(0);
  count = 0;
  /** number of car-drivable 4-neighbours */
  readonly deg: Uint8Array;
  /** 1 where the cell is open water */
  readonly water: Uint8Array;
  /** increments on every road change */
  version = 0;
  waterVersion = 0;
  private comps: (Int32Array | null)[] = [];
  private queue: Int32Array;
  private access = new Map<number, number>();
  private accessVersion = -1;

  constructor(readonly world: World) {
    this.size = world.size;
    this.n = world.size * world.size;
    this.kind = new Uint8Array(this.n);
    this.deg = new Uint8Array(this.n);
    this.water = new Uint8Array(this.n);
    this.rid = new Int32Array(this.n).fill(-1);
    this.queue = new Int32Array(this.n);
    this.rebuildAll();
    this.updateWater();
  }

  rebuildAll(): void {
    this.updateRect({ x0: 0, y0: 0, x1: this.size - 1, y1: this.size - 1 });
  }

  /** reclassify cells in a rect (plus a 1-cell margin for degrees) */
  updateRect(r: Rect): void {
    const w = this.world, s = this.size;
    const x0 = Math.max(0, r.x0 - 1), y0 = Math.max(0, r.y0 - 1), x1 = Math.min(s - 1, r.x1 + 1), y1 = Math.min(s - 1, r.y1 + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s + x;
        this.kind[i] = kindOf(w.road[i] as RoadType, (w.roadFlags[i] & 1) !== 0);
      }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s + x;
        if (!(this.kind[i] & K.Car)) {
          this.deg[i] = 0;
          continue;
        }
        let d = 0;
        if (y > 0 && this.kind[i - s] & K.Car) d++;
        if (x < s - 1 && this.kind[i + 1] & K.Car) d++;
        if (y < s - 1 && this.kind[i + s] & K.Car) d++;
        if (x > 0 && this.kind[i - 1] & K.Car) d++;
        this.deg[i] = d;
      }
    // trams run straight through junctions where other roads cross their avenue
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s + x;
        if (tramCrossing(w.road, s, x, y)) this.kind[i] |= K.Tram;
      }
    // compact road indices
    let count = 0;
    const kind = this.kind;
    for (let i = 0; i < this.n; i++) if (kind[i]) count++;
    if (this.cells.length < count) this.cells = new Int32Array(Math.max(1024, Math.ceil(count * 1.25)));
    const rid = this.rid;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (kind[i]) {
        rid[i] = k;
        this.cells[k++] = i;
      } else rid[i] = -1;
    }
    this.count = count;
    for (let m = 0; m < PMODE_COUNT; m++) if (m !== PMode.Water) this.comps[m] = null;
    this.version++;
  }

  updateWater(): void {
    const w = this.world, s = this.size;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) this.water[y * s + x] = w.isWater(x, y) ? 1 : 0;
    this.comps[PMode.Water] = null;
    this.waterVersion++;
  }

  isJunction(cell: number): boolean {
    return this.deg[cell] >= 3;
  }

  passable(mode: PMode, cell: number): boolean {
    if (cell < 0 || cell >= this.n) return false;
    if (mode === PMode.Water) return this.water[cell] !== 0;
    return (this.kind[cell] & modeMask(mode)) !== 0;
  }

  /** connected component label of a cell for a mode (-1 if impassable) */
  component(mode: PMode, cell: number): number {
    let c = this.comps[mode];
    if (!c) c = this.comps[mode] = this.label(mode);
    return cell >= 0 && cell < this.n ? c[cell] : -1;
  }

  reachable(mode: PMode, a: number, b: number): boolean {
    const ca = this.component(mode, a);
    return ca >= 0 && ca === this.component(mode, b);
  }

  private label(mode: PMode): Int32Array {
    const s = this.size, n = this.n;
    const out = new Int32Array(n).fill(-1);
    const q = this.queue;
    let label = 0;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0 || !this.passable(mode, i)) continue;
      let head = 0, tail = 0;
      q[tail++] = i;
      out[i] = label;
      while (head < tail) {
        const c = q[head++];
        const cx = c % s, cy = (c / s) | 0;
        if (cy > 0 && out[c - s] < 0 && this.passable(mode, c - s)) (out[c - s] = label), (q[tail++] = c - s);
        if (cx < s - 1 && out[c + 1] < 0 && this.passable(mode, c + 1)) (out[c + 1] = label), (q[tail++] = c + 1);
        if (cy < s - 1 && out[c + s] < 0 && this.passable(mode, c + s)) (out[c + s] = label), (q[tail++] = c + s);
        if (cx > 0 && out[c - 1] < 0 && this.passable(mode, c - 1)) (out[c - 1] = label), (q[tail++] = c - 1);
      }
      label++;
    }
    return out;
  }

  /** nearest cell usable by `mode` within `radius` (Chebyshev rings), -1 if none */
  nearest(x: number, y: number, mode: PMode, radius: number): number {
    const s = this.size;
    let best = -1, bd = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx, cy = y + dy;
          if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
          const i = cy * s + cx;
          if (!this.passable(mode, i)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * Road cell giving access to a building for cars (or service vehicles when
   * `service`), packed as cell * 4 + dir (dir = from the building toward the
   * road). -1 when the lot has no usable frontage.
   */
  accessOf(b: Building, service = false): number {
    if (this.accessVersion !== this.version) {
      this.access.clear();
      this.accessVersion = this.version;
    }
    const key = b.id * 2 + (service ? 1 : 0);
    const cached = this.access.get(key);
    if (cached !== undefined) return cached;
    const s = this.size;
    const want = service ? K.Car | K.Ped : K.Car;
    let res = -1;
    for (let k = 0; k < 4 && res < 0; k++) {
      const d = (b.rot + k) & 3;
      const along = d === 0 || d === 2 ? b.w : b.h;
      let bestScore = Infinity;
      for (let j = 0; j < along; j++) {
        let cx: number, cy: number;
        if (d === 0) (cx = b.x + j), (cy = b.y - 1);
        else if (d === 2) (cx = b.x + j), (cy = b.y + b.h);
        else if (d === 3) (cx = b.x - 1), (cy = b.y + j);
        else (cx = b.x + b.w), (cy = b.y + j);
        if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
        const i = cy * s + cx;
        const kd = this.kind[i];
        if (!(kd & want) || kd & K.Hwy) continue;
        const score = Math.abs(j - (along - 1) / 2);
        if (score < bestScore) {
          bestScore = score;
          res = i * 4 + d;
        }
      }
    }
    this.access.set(key, res);
    return res;
  }

  /** cell of an outside highway connection (the road cell at / next to it), -1 if none */
  connectionCell(cx: number, cy: number): number {
    const s = this.size;
    for (let r = 0; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= s || y >= s) continue;
          if (this.kind[y * s + x] & K.Car) return y * s + x;
        }
    return -1;
  }

  /** first 4-neighbour of `cell` in dir d, or -1 when off-map */
  step(cell: number, d: number): number {
    const s = this.size;
    const x = (cell % s) + DIR_DX[d], y = ((cell / s) | 0) + DIR_DY[d];
    return x < 0 || y < 0 || x >= s || y >= s ? -1 : y * s + x;
  }
}
