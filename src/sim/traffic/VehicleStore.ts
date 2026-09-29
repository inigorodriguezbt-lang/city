// Structure-of-arrays storage for every simulated vehicle. Slots are reused
// through a free list; public ids pack a 16-bit generation with the slot so
// stale ids (a followed vehicle that despawned) never alias a new vehicle.
// A dense `active` list gives cache-friendly iteration for the movement
// kernel and the renderer.
import { CURVE_STRIDE } from './lanes';

/** how a path starts */
export const enum Start {
  Mid = 0, // virtual straight entry into the first cell
  Building = 1, // from a lot edge (dir = travel direction from the building into the road)
  Outside = 2, // from beyond the map edge (dir = inward travel direction)
  Pose = 3, // from the vehicle's current position and heading
}
/** how a path ends */
export const enum End {
  Mid = 0, // pull over at the curb in the last cell
  Building = 1, // drive into the lot (dir = from road into the building) and despawn
  Outside = 2, // leave the map (dir = outward)
  Loop = 3, // transit loop: wraps to the first cell
}

/** world-space polyline for free-path vehicles (metro, ferry, monorail) */
export interface FreePath {
  /** x, z pairs */
  pts: Float32Array;
  /** cumulative length at each point */
  cum: Float32Array;
  total: number;
}

type TA = Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array | Int8Array;

export class VehicleStore {
  cap = 0;
  // identity
  gen!: Uint16Array;
  state!: Uint8Array;
  type!: Uint8Array;
  model!: Uint8Array;
  comp!: Uint8Array;
  nsec!: Uint8Array;
  flags!: Uint16Array;
  purpose!: Uint8Array;
  /** paint color (0xRRGGBB) */
  color!: Uint32Array;
  seed!: Uint32Array;
  fromB!: Int32Array;
  toB!: Int32Array;
  line!: Int32Array;
  // path
  path: (Int32Array | null)[] = [];
  loop!: Uint8Array;
  pi!: Int32Array;
  startMode!: Uint8Array;
  startDir!: Int8Array;
  endMode!: Uint8Array;
  endDir!: Int8Array;
  stopI!: Int32Array;
  // current cell trajectory
  curve!: Float32Array;
  dIn!: Int8Array;
  dOut!: Int8Array;
  laneIn!: Uint8Array;
  laneOut!: Uint8Array;
  offOut!: Float32Array;
  // dynamics
  s!: Float32Array;
  v!: Float32Array;
  acc!: Float32Array;
  timer!: Float32Array;
  wait!: Float32Array;
  stuck!: Float32Array;
  age!: Float32Array;
  commit!: Int32Array;
  /** total composition length (m) */
  len!: Float32Array;
  /** half length of the head section (m) */
  half!: Float32Array;
  // pose (updated by the movement kernel, read by the renderer)
  x!: Float32Array;
  z!: Float32Array;
  yaw!: Float32Array;
  /** 0..1 spawn / despawn fade */
  fade!: Float32Array;
  // free-path vehicles
  free: (FreePath | null)[] = [];
  fs!: Float32Array;
  // dense active list
  active!: Int32Array;
  activeN = 0;
  private slot!: Int32Array;
  private freeList!: Int32Array;
  private freeN = 0;

  constructor(cap = 4096) {
    this.resize(cap);
  }

  private resize(cap: number): void {
    const old = this.cap;
    const grow = <T extends TA>(a: T | undefined, ctor: new (n: number) => T, stride = 1): T => {
      const b = new ctor(cap * stride);
      if (a) b.set(a as unknown as ArrayLike<number> & T);
      return b;
    };
    this.gen = grow(this.gen, Uint16Array);
    this.state = grow(this.state, Uint8Array);
    this.type = grow(this.type, Uint8Array);
    this.model = grow(this.model, Uint8Array);
    this.comp = grow(this.comp, Uint8Array);
    this.nsec = grow(this.nsec, Uint8Array);
    this.flags = grow(this.flags, Uint16Array);
    this.purpose = grow(this.purpose, Uint8Array);
    this.color = grow(this.color, Uint32Array);
    this.seed = grow(this.seed, Uint32Array);
    this.fromB = grow(this.fromB, Int32Array);
    this.toB = grow(this.toB, Int32Array);
    this.line = grow(this.line, Int32Array);
    this.loop = grow(this.loop, Uint8Array);
    this.pi = grow(this.pi, Int32Array);
    this.startMode = grow(this.startMode, Uint8Array);
    this.startDir = grow(this.startDir, Int8Array);
    this.endMode = grow(this.endMode, Uint8Array);
    this.endDir = grow(this.endDir, Int8Array);
    this.stopI = grow(this.stopI, Int32Array);
    this.curve = grow(this.curve, Float32Array, CURVE_STRIDE);
    this.dIn = grow(this.dIn, Int8Array);
    this.dOut = grow(this.dOut, Int8Array);
    this.laneIn = grow(this.laneIn, Uint8Array);
    this.laneOut = grow(this.laneOut, Uint8Array);
    this.offOut = grow(this.offOut, Float32Array);
    this.s = grow(this.s, Float32Array);
    this.v = grow(this.v, Float32Array);
    this.acc = grow(this.acc, Float32Array);
    this.timer = grow(this.timer, Float32Array);
    this.wait = grow(this.wait, Float32Array);
    this.stuck = grow(this.stuck, Float32Array);
    this.age = grow(this.age, Float32Array);
    this.commit = grow(this.commit, Int32Array);
    this.len = grow(this.len, Float32Array);
    this.half = grow(this.half, Float32Array);
    this.x = grow(this.x, Float32Array);
    this.z = grow(this.z, Float32Array);
    this.yaw = grow(this.yaw, Float32Array);
    this.fade = grow(this.fade, Float32Array);
    this.fs = grow(this.fs, Float32Array);
    this.active = grow(this.active, Int32Array);
    this.slot = grow(this.slot, Int32Array);
    this.freeList = grow(this.freeList, Int32Array);
    for (let i = old; i < cap; i++) {
      this.path.push(null);
      this.free.push(null);
    }
    // new slots go on the free list (highest first so low slots are used first)
    for (let i = cap - 1; i >= old; i--) this.freeList[this.freeN++] = i;
    this.cap = cap;
  }

  /** allocate a slot (state Pending, not yet in the active list) */
  alloc(): number {
    if (this.freeN === 0) this.resize(this.cap * 2);
    const i = this.freeList[--this.freeN];
    this.gen[i] = (this.gen[i] + 1) & 0x7fff;
    this.state[i] = 1;
    this.flags[i] = 0;
    this.path[i] = null;
    this.free[i] = null;
    this.slot[i] = -1;
    this.commit[i] = -1;
    this.s[i] = this.v[i] = this.acc[i] = this.timer[i] = this.wait[i] = this.stuck[i] = this.age[i] = this.fade[i] = this.fs[i] = 0;
    this.fromB[i] = this.toB[i] = this.line[i] = 0;
    this.stopI[i] = 0;
    this.loop[i] = 0;
    this.nsec[i] = 1;
    this.comp[i] = 0;
    return i;
  }

  /** put an allocated slot into the active (simulated + rendered) list */
  activate(i: number): void {
    if (this.slot[i] >= 0) return;
    this.slot[i] = this.activeN;
    this.active[this.activeN++] = i;
  }

  release(i: number): void {
    if (this.state[i] === 0) return;
    const k = this.slot[i];
    if (k >= 0) {
      const last = this.active[--this.activeN];
      this.active[k] = last;
      this.slot[last] = k;
    }
    this.slot[i] = -1;
    this.state[i] = 0;
    this.path[i] = null;
    this.free[i] = null;
    this.freeList[this.freeN++] = i;
  }

  isActive(i: number): boolean {
    return this.slot[i] >= 0;
  }

  /** public id of slot i */
  uid(i: number): number {
    return this.gen[i] * 65536 + i;
  }

  /** slot for a public id, or -1 if stale */
  indexOf(id: number): number {
    if (!Number.isFinite(id) || id < 0) return -1;
    const i = id % 65536, g = Math.floor(id / 65536);
    if (i >= this.cap || this.state[i] === 0 || this.gen[i] !== g) return -1;
    return i;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) if (this.state[i] !== 0) this.release(i);
    this.activeN = 0;
  }
}
