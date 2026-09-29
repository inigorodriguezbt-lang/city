// Movement kernel for road/rail vehicles.
//
// Per substep:
//  1. every driving vehicle is linked into a per-road-cell list (compact road
//     indices, frame-stamped so nothing is cleared) and junction occupancy is
//     tallied per axis (N-S / E-W; turning vehicles block both), including
//     vehicles already committed to a junction and the bodies of long vehicles;
//  2. each vehicle picks a desired speed (speed limit × type factor × weather,
//     cornering limits of this and the next cell), finds its leader in the same
//     lane up to five cells ahead, adds virtual obstacles (junction stop line
//     when the signal is red / the junction is occupied by crossing traffic /
//     the exit is full, transit stops, curbside destinations) and integrates
//     the Intelligent Driver Model; crossing the end of a cell trajectory
//     enters the next cell (new Bézier trajectory, lane choice by upcoming
//     turn, lane offsets by road type, right- or left-hand traffic).
// Unsignalized junctions alternate between axes by comparing how long the
// front vehicles have been waiting (read from the previous substep).
// Congestion samples (occupancy + speed ratio per road cell) are accumulated
// for the traffic field.
import { CELL } from '../../core/constants';
import { DIR_DX, DIR_DY, RoadType } from '../../core/types';
import { roadDef } from '../../data/roads';
import type { World } from '../../world/World';
import type { RoadGraph } from './graph';
import { CURVE_STRIDE, dirBetween, edgePoint, evalCurve, fitCurve, laneCount, laneOffset, RAIL_TRACK, ROAD_HALF_WIDTH, TRAM_TRACK, turnOf, type CurvePoint } from './lanes';
import { End, Start, type VehicleStore } from './VehicleStore';
import { DRIVE, VF, VS, VT, VTYPES } from './types';

export interface SignalSource {
  signalState?(x: number, y: number, fromDir: number): 'green' | 'yellow' | 'red' | null;
}

export interface MoverHooks {
  /** reached the end of a non-loop path (s at the end of the last curve) */
  arrive(i: number): void;
  /** remove (stuck, road removed, expired) */
  despawn(i: number): void;
  /** the path ahead became invalid (road removed); current cell is still valid */
  reroute(i: number): void;
  /** a transit stop was reached: return dwell seconds */
  stopReached(i: number): number;
  /** a transit vehicle has been stuck too long */
  transitStuck(i: number): void;
  /** path index of the next stop of a transit vehicle (-1 = none) */
  nextStopPi(i: number): number;
}

/** distance from the junction edge where vehicles stop (stop line / crosswalk) */
const STOP_BACK = 3.3;
const SPEED_MS = new Float32Array(16);
for (let t = 1; t <= 8; t++) SPEED_MS[t] = (roadDef(t as RoadType)?.speed ?? 30) / 3.6;
/** jam spacing: vehicles per lane per cell in queues */
const LANE_CAP = 2.2;
const T_HEADWAY = 1.15;
const S0 = 1.9;
const STUCK_LIMIT = 20;
/** vehicles queueing at traffic lights may wait through a few cycles */
const SIGNAL_STUCK = 60;
const TRANSIT_STUCK = 26;
const MAX_AGE = 1500;

export class Mover {
  /** +1 right-hand, -1 left-hand traffic */
  hand = 1;
  /** weather / event speed multiplier */
  speedMult = 1;
  signals: SignalSource | null = null;
  /** accumulated congestion samples per road index */
  occSum = new Float32Array(0);
  spdSum = new Float32Array(0);
  samples = 0;
  /** diagnostics */
  readonly stats = { stepMs: 0, waitingAtLights: 0, moving: 0 };

  private size: number;
  private head = new Int32Array(0);
  private hstamp = new Uint32Array(0);
  private next = new Int32Array(0);
  /** junction occupancy per entry direction (4 per road index) + left turners */
  private occ = new Uint16Array(0);
  private occL = new Uint16Array(0);
  private ostamp = new Uint32Array(0);
  private waitA = new Float32Array(0);
  private waitB = new Float32Array(0);
  private wsA = new Uint32Array(0);
  private wsB = new Uint32Array(0);
  private frame = 1;
  private graphVersion = -1;
  private readonly p: CurvePoint = { x: 0, z: 0, tx: 0, tz: 1 };
  private readonly e = { x: 0, z: 0 };
  // leader search results
  private lv = 0;

  constructor(private world: World, private graph: RoadGraph, private st: VehicleStore, private hooks: MoverHooks) {
    this.size = world.size;
  }

  private ensureArrays(): void {
    const g = this.graph;
    if (this.graphVersion === g.version && this.head.length >= g.count && this.next.length >= this.st.cap) return;
    const R = Math.max(1024, g.cells.length);
    if (this.head.length < R) {
      this.head = new Int32Array(R);
      this.hstamp = new Uint32Array(R);
      this.occ = new Uint16Array(R * 4);
      this.occL = new Uint16Array(R * 4);
      this.ostamp = new Uint32Array(R);
      this.waitA = new Float32Array(R * 2);
      this.waitB = new Float32Array(R * 2);
      this.wsA = new Uint32Array(R);
      this.wsB = new Uint32Array(R);
    }
    if (this.occSum.length !== R || this.graphVersion !== g.version) {
      // road indices changed: restart congestion accumulation
      this.occSum = new Float32Array(R);
      this.spdSum = new Float32Array(R);
      this.samples = 0;
      this.hstamp.fill(0);
      this.ostamp.fill(0);
      this.wsA.fill(0);
      this.wsB.fill(0);
    }
    if (this.next.length < this.st.cap) this.next = new Int32Array(this.st.cap);
    this.graphVersion = g.version;
  }

  // ── path helpers ─────────────────────────────────────────────────────────
  cellAt(i: number, k: number): number {
    const p = this.st.path[i]!;
    const n = p.length;
    if (this.st.loop[i]) return p[((k % n) + n) % n];
    return k >= 0 && k < n ? p[k] : -1;
  }

  private stepDir(i: number, k: number): number {
    const a = this.cellAt(i, k), b = this.cellAt(i, k + 1);
    if (a < 0 || b < 0 || a === b) return -1;
    return dirBetween(this.size, a, b);
  }

  dInAt(i: number, k: number): number {
    const st = this.st;
    if (k > 0 || st.loop[i]) {
      const prev = this.cellAt(i, k - 1), cur = this.cellAt(i, k);
      if (prev !== cur) {
        const d = dirBetween(this.size, prev, cur);
        return d < 0 ? 0 : d;
      }
      const d = this.stepDir(i, k);
      return d < 0 ? 0 : d;
    }
    switch (st.startMode[i]) {
      case Start.Building:
      case Start.Outside:
        return st.startDir[i];
      case Start.Pose:
        return yawDir(st.yaw[i]);
      default: {
        const d = this.stepDir(i, 0);
        return d >= 0 ? d : st.endDir[i] >= 0 ? st.endDir[i] : 0;
      }
    }
  }

  dOutAt(i: number, k: number): number {
    const st = this.st;
    const n = st.path[i]!.length;
    if (k < n - 1 || st.loop[i]) {
      const d = this.stepDir(i, k);
      if (d >= 0) return d;
      // reversal marker (same cell twice): leave straight through the far edge
      const prev = this.cellAt(i, k - 1), cur = this.cellAt(i, k);
      if ((k > 0 || st.loop[i]) && prev !== cur && prev >= 0) {
        const di = dirBetween(this.size, prev, cur);
        return di < 0 ? 0 : di;
      }
      return 0;
    }
    const em = st.endMode[i];
    if (em === End.Building || em === End.Outside) return st.endDir[i];
    return this.dInAt(i, k);
  }

  private roadTypeAt(cell: number): RoadType {
    return cell >= 0 ? (this.world.road[cell] as RoadType) : RoadType.None;
  }

  /** lane index used at the exit edge of path cell k */
  laneAt(i: number, k: number): number {
    const st = this.st;
    let nc = this.cellAt(i, k + 1);
    if (nc < 0) nc = this.cellAt(i, k);
    const nt = this.roadTypeAt(nc);
    const n = laneCount(nt);
    if (n <= 1) return 0;
    const vt = st.type[i];
    if (vt === VT.tram || vt === VT.train) return 0; // tracks share the inner lane
    if (vt === VT.bus || vt === VT.garbage || st.flags[i] & VF.Bike) return n - 1;
    const len = st.path[i]!.length;
    const center = -this.hand;
    for (let j = k + 1; j <= k + 3; j++) {
      if (!st.loop[i] && j >= len) break;
      const a = this.dInAt(i, j), b = this.dOutAt(i, j);
      const tr = turnOf(a, b);
      if (tr === 2) return 0;
      if (tr !== 0) return tr === center ? 0 : n - 1;
    }
    if (vt === VT.truck || vt === VT.hearse || vt === VT.service) return n - 1;
    return (st.seed[i] >>> 5) % n;
  }

  private offsetFor(i: number, rt: RoadType, lane: number): number {
    const st = this.st;
    if (rt === RoadType.Rail) return RAIL_TRACK;
    if (st.type[i] === VT.tram) return TRAM_TRACK;
    if (st.flags[i] & VF.Bike) return Math.max(laneOffset(rt, 99), ROAD_HALF_WIDTH[rt] - 0.6);
    return laneOffset(rt, lane);
  }

  /** set the lane / offset state as if the vehicle arrived from path cell k-1 (spawning mid-path) */
  primeEntry(i: number, k: number): void {
    const st = this.st;
    if (k <= 0 && !st.loop[i]) return;
    const lp = this.laneAt(i, k - 1);
    st.laneOut[i] = lp;
    st.offOut[i] = this.offsetFor(i, this.roadTypeAt(this.cellAt(i, k)), lp);
  }

  /** compute the trajectory of path cell k for vehicle i (entering that cell) */
  enterCell(i: number, k: number): void {
    const st = this.st, size = this.size, hand = this.hand;
    const c = this.cellAt(i, k);
    const x = c % size, y = (c / size) | 0;
    const n = st.path[i]!.length;
    const first = k === 0 && !st.loop[i];
    const last = k === n - 1 && !st.loop[i];
    const dIn = this.dInAt(i, k), dOut = this.dOutAt(i, k);
    const lane = this.laneAt(i, k);
    const rtHere = this.roadTypeAt(c);
    const e = this.e;
    let p0x: number, p0z: number, t0x: number, t0z: number;
    const sm = st.startMode[i];
    if (first && sm === Start.Pose) {
      p0x = st.x[i];
      p0z = st.z[i];
      t0x = Math.sin(st.yaw[i]);
      t0z = Math.cos(st.yaw[i]);
    } else if (first && sm === Start.Building) {
      edgePoint(x, y, (dIn + 2) & 3, dIn, 0, e);
      p0x = e.x;
      p0z = e.z;
      t0x = DIR_DX[dIn];
      t0z = DIR_DY[dIn];
    } else {
      const offIn = first ? this.offsetFor(i, rtHere, lane) : st.offOut[i];
      edgePoint(x, y, (dIn + 2) & 3, dIn, hand * offIn, e);
      p0x = e.x;
      p0z = e.z;
      t0x = DIR_DX[dIn];
      t0z = DIR_DY[dIn];
    }
    let p3x: number, p3z: number, offOut = 0;
    const em = st.endMode[i];
    if (last && em === End.Building) {
      edgePoint(x, y, dOut, dOut, 0, e);
      p3x = e.x;
      p3z = e.z;
    } else if (last && em === End.Mid) {
      offOut = st.flags[i] & VF.Service ? Math.max(laneOffset(rtHere, 99), ROAD_HALF_WIDTH[rtHere] - 0.35) : laneOffset(rtHere, 99);
      const r = (dIn + 1) & 3;
      p3x = (x + 0.5) * CELL + DIR_DX[dIn] * 2.5 + DIR_DX[r] * hand * offOut;
      p3z = (y + 0.5) * CELL + DIR_DY[dIn] * 2.5 + DIR_DY[r] * hand * offOut;
    } else {
      let nc = this.cellAt(i, k + 1);
      if (nc < 0 || nc === c) nc = c;
      offOut = this.offsetFor(i, this.roadTypeAt(nc), lane);
      edgePoint(x, y, dOut, dOut, hand * offOut, e);
      p3x = e.x;
      p3z = e.z;
    }
    const t3x = last && em === End.Mid ? DIR_DX[dIn] : DIR_DX[dOut];
    const t3z = last && em === End.Mid ? DIR_DY[dIn] : DIR_DY[dOut];
    fitCurve(st.curve, i * CURVE_STRIDE, p0x, p0z, t0x, t0z, p3x, p3z, t3x, t3z);
    st.laneIn[i] = first ? lane : st.laneOut[i];
    st.laneOut[i] = lane;
    st.offOut[i] = offOut;
    st.dIn[i] = dIn;
    st.dOut[i] = dOut;
  }

  /** update pose (x, z, yaw) from the current curve */
  pose(i: number): void {
    const st = this.st;
    const p = evalCurve(st.curve, i * CURVE_STRIDE, st.s[i], this.p);
    st.x[i] = p.x;
    st.z[i] = p.z;
    st.yaw[i] = Math.atan2(p.tx, p.tz);
  }

  /** speed limit (m/s) on a cell for vehicle i */
  private limit(i: number, cell: number): number {
    const st = this.st;
    const t = this.world.road[cell];
    const vt = VTYPES[st.type[i]];
    let v = SPEED_MS[t] * DRIVE[vt][2] * this.speedMult;
    if (st.flags[i] & VF.Bike) v = 5.2;
    else if (st.flags[i] & VF.Siren) v *= 1.22;
    if (t === RoadType.Rail) v = Math.min(v, 26);
    return Math.max(2, v);
  }

  // ── occupancy bookkeeping ────────────────────────────────────────────────
  /** register a vehicle inside / committed to junction r, entering in travel dir d (-1 = blocks all) */
  private addOcc(r: number, d: number, left: boolean): void {
    const f = this.frame, o = r * 4;
    if (this.ostamp[r] !== f) {
      this.ostamp[r] = f;
      this.occ[o] = this.occ[o + 1] = this.occ[o + 2] = this.occ[o + 3] = 0;
      this.occL[o] = this.occL[o + 1] = this.occL[o + 2] = this.occL[o + 3] = 0;
    }
    if (d < 0) {
      for (let k = 0; k < 4; k++) this.occ[o + k]++;
      return;
    }
    this.occ[o + d]++;
    if (left) this.occL[o + d]++;
  }
  private occDir(r: number, d: number): number {
    return this.ostamp[r] === this.frame ? this.occ[r * 4 + (d & 3)] : 0;
  }
  private occLeft(r: number, d: number): number {
    return this.ostamp[r] === this.frame ? this.occL[r * 4 + (d & 3)] : 0;
  }
  /** turning across oncoming traffic (left in right-hand traffic) or U-turn */
  private crosses(dIn: number, dOut: number): boolean {
    const t = turnOf(dIn, dOut);
    return t === 2 || t === -this.hand;
  }
  private waitPrev(r: number, axis: number): number {
    // previous substep's buffer
    const odd = this.frame & 1;
    const ws = odd ? this.wsB : this.wsA, w = odd ? this.waitB : this.waitA;
    return ws[r] === this.frame - 1 ? w[r * 2 + axis] : 0;
  }
  private writeWait(r: number, axis: number, t: number): void {
    const odd = this.frame & 1;
    const ws = odd ? this.wsA : this.wsB, w = odd ? this.waitA : this.waitB;
    if (ws[r] !== this.frame) {
      ws[r] = this.frame;
      w[r * 2] = 0;
      w[r * 2 + 1] = 0;
    }
    if (t > w[r * 2 + axis]) w[r * 2 + axis] = t;
  }

  // ── main update ──────────────────────────────────────────────────────────
  update(dt: number): void {
    if (dt <= 0) return;
    const t0 = performance.now();
    this.ensureArrays();
    if (dt > 0.36) {
      this.fastStep(dt);
    } else {
      const n = Math.max(1, Math.ceil(dt / 0.12));
      const h = dt / n;
      for (let k = 0; k < n; k++) this.step(h);
    }
    this.stats.stepMs = this.stats.stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private link(): void {
    const st = this.st, g = this.graph, rid = g.rid, f = this.frame;
    const act = st.active;
    for (let a = 0; a < st.activeN; a++) {
      const i = act[a];
      const s = st.state[i];
      if (s < VS.Drive || st.flags[i] & VF.Free) continue;
      const c = st.path[i]![st.pi[i]];
      const r = rid[c];
      if (r < 0) continue;
      if (this.hstamp[r] !== f) {
        this.hstamp[r] = f;
        this.head[r] = -1;
      }
      this.next[i] = this.head[r];
      this.head[r] = i;
      if (g.deg[c] >= 3) this.addOcc(r, st.dIn[i], this.crosses(st.dIn[i], st.dOut[i]));
      const cm = st.commit[i];
      if (cm >= 0 && cm !== c) {
        const rc = rid[cm];
        if (rc >= 0) this.addOcc(rc, st.dOut[i], this.crosses(st.dOut[i], this.dOutAt(i, st.pi[i] + 1)));
      }
      // bodies of long vehicles keep junctions they still straddle occupied
      if (st.flags[i] & VF.Long) {
        let back = st.len[i] - st.s[i] - st.half[i];
        for (let k = st.pi[i] - 1; back > 0 && k > st.pi[i] - 8; k--) {
          const bc = this.cellAt(i, k);
          if (bc < 0) break;
          if (g.deg[bc] >= 3 && rid[bc] >= 0) this.addOcc(rid[bc], -1, false);
          back -= CELL;
        }
      }
    }
  }

  /** leader gap in the vehicle's lane (sets this.lv to the leader speed); Infinity when none */
  private leader(i: number): number {
    const st = this.st, rid = this.graph.rid, f = this.frame;
    const pi = st.pi[i];
    const c = st.path[i]![pi];
    const myFront = st.s[i] + st.half[i];
    const bike = (st.flags[i] & VF.Bike) !== 0;
    let gap = Infinity;
    let r = rid[c];
    if (r >= 0 && this.hstamp[r] === f) {
      for (let j = this.head[r]; j >= 0; j = this.next[j]) {
        if (j === i || st.dIn[j] !== st.dIn[i] || st.laneOut[j] !== st.laneOut[i]) continue;
        if (st.flags[j] & VF.NoFollow && !bike) continue;
        const sj = st.s[j];
        if (sj < st.s[i] || (sj === st.s[i] && j > i)) continue;
        const g = sj + st.half[j] - st.len[j] - myFront;
        if (g < gap) {
          gap = g;
          this.lv = st.v[j];
        }
      }
    }
    if (gap < Infinity) return gap;
    const n = st.path[i]!.length;
    const loop = st.loop[i] !== 0;
    let dist = st.curve[i * CURVE_STRIDE + 8] - st.s[i];
    let expDir = st.dOut[i];
    let expLane = st.laneOut[i];
    const maxK = st.v[i] > 13 ? 5 : 3;
    for (let k = 1; k <= maxK; k++) {
      const idx = pi + k;
      if (!loop && idx >= n) break;
      const cc = this.cellAt(i, idx);
      if (cc === this.cellAt(i, idx - 1)) break; // reversal
      r = rid[cc];
      if (r >= 0 && this.hstamp[r] === f) {
        for (let j = this.head[r]; j >= 0; j = this.next[j]) {
          if (j === i || st.dIn[j] !== expDir || st.laneIn[j] !== expLane) continue;
          if (st.flags[j] & VF.NoFollow && !bike) continue;
          const g = dist + st.s[j] + st.half[j] - st.len[j] - st.half[i];
          if (g < gap) {
            gap = g;
            this.lv = st.v[j];
          }
        }
        if (gap < Infinity) return gap;
      }
      dist += CELL;
      if (dist > 70) break;
      expDir = this.dOutAt(i, idx);
      expLane = this.laneAt(i, idx);
    }
    return gap;
  }

  private step(h: number): void {
    this.frame++;
    this.link();
    const st = this.st, g = this.graph, rid = g.rid, w = this.world, size = this.size;
    const act = st.active;
    const signals = this.signals?.signalState ? this.signals : null;
    const occSum = this.occSum, spdSum = this.spdSum;
    let waitingLights = 0, moving = 0;
    this.samples++;
    // iterate over a snapshot count: despawns swap-remove from the active list,
    // so walk backwards to visit every vehicle exactly once
    for (let a = st.activeN - 1; a >= 0; a--) {
      const i = act[a];
      const state = st.state[i];
      if (state < VS.Drive || st.flags[i] & VF.Free) continue;
      st.age[i] += h;
      if (st.fade[i] < 1) st.fade[i] = Math.min(1, st.fade[i] + h * 2.5);
      if (state === VS.Dwell) {
        st.timer[i] -= h;
        st.v[i] = 0;
        st.acc[i] = 0;
        if (st.timer[i] <= 0) {
          st.state[i] = VS.Drive;
          st.stopI[i]++;
          st.stuck[i] = 0;
          this.afterDwell(i);
        }
        continue;
      }
      if (state !== VS.Drive) {
        st.v[i] = 0;
        st.acc[i] = 0;
        if (state === VS.OnScene) {
          st.timer[i] -= h;
          if (st.timer[i] <= 0) this.hooks.arrive(i);
        }
        continue;
      }
      const path = st.path[i]!;
      const pi = st.pi[i];
      const c = path[pi];
      const r = rid[c];
      if (r < 0) {
        this.hooks.despawn(i);
        continue;
      }
      const vt = VTYPES[st.type[i]];
      const [amax, bcomf] = DRIVE[vt];
      const o = i * CURVE_STRIDE;
      const clen = st.curve[o + 8];
      const s = st.s[i], v = st.v[i];
      const n = path.length;
      const loop = st.loop[i] !== 0;
      const transit = (st.flags[i] & VF.Transit) !== 0;
      // desired speed
      const lim = this.limit(i, c);
      let v0 = Math.min(lim, st.curve[o + 9]);
      const toEdge = clen - s - st.half[i];
      const nextIdx = pi + 1;
      const hasNext = loop || nextIdx < n;
      const nc = hasNext ? this.cellAt(i, nextIdx) : -1;
      if (hasNext && nc !== c) {
        // cornering limit of the next cell
        const dn = this.dOutAt(i, nextIdx);
        const tr = turnOf(st.dOut[i], dn);
        if (tr !== 0) {
          const vt2 = tr === 2 ? 3.2 : tr === -this.hand ? 6.2 : 4.6;
          const vv = Math.sqrt(vt2 * vt2 + 2 * bcomf * Math.max(0, toEdge));
          if (vv < v0) v0 = vv;
        }
        const nl = this.limit(i, nc);
        if (nl < v0) v0 = Math.min(v0, Math.sqrt(nl * nl + 2 * bcomf * Math.max(0, toEdge + st.half[i])));
      } else if (!hasNext && st.endMode[i] === End.Building) {
        v0 = Math.min(v0, 3 + Math.max(0, clen - s) * 0.6);
      }
      // leader
      let gap = this.leader(i);
      let vl = gap < Infinity ? this.lv : 0;
      // junction ahead
      if (hasNext && nc !== c && g.deg[nc] >= 3 && st.commit[i] !== nc && rid[nc] >= 0 && vt !== 'train') {
        const rj = rid[nc];
        const dInJ = st.dOut[i];
        const axis = dInJ & 1;
        const dOutJ = this.dOutAt(i, nextIdx);
        const left = this.crosses(dInJ, dOutJ);
        const jx = nc % size, jy = (nc / size) | 0;
        const sig = signals ? signals.signalState!(jx, jy, (dInJ + 2) & 3) : null;
        // crossing traffic inside the junction, and the oncoming flow for turns across it
        const perp = this.occDir(rj, dInJ + 1) + this.occDir(rj, dInJ + 3);
        const opp = this.occDir(rj, dInJ + 2), oppLeft = this.occLeft(rj, dInJ + 2);
        const clear = perp === 0 && (left ? opp - oppLeft === 0 : oppLeft === 0);
        let allowed: boolean;
        if (st.flags[i] & VF.Siren) allowed = perp === 0 || v > 3;
        else if (sig === 'red') allowed = false;
        else if (sig === 'yellow') allowed = left && clear && st.wait[i] > 2.5; // waiting left-turner clears on the change
        else if (sig === 'green') allowed = clear;
        else {
          const wo = this.waitPrev(rj, axis ^ 1);
          allowed = clear && !(wo > 1.2 && wo > st.wait[i] + 0.8);
        }
        if (allowed) {
          // do not block the box: the exit cell needs room
          const xc = this.cellAt(i, nextIdx + 1);
          if (xc >= 0 && xc !== nc && g.deg[xc] < 3) {
            const rx = rid[xc];
            if (rx >= 0 && this.hstamp[rx] === this.frame) {
              let cnt = 0;
              for (let j = this.head[rx]; j >= 0; j = this.next[j]) if (st.dIn[j] === dOutJ && !(st.flags[j] & VF.Bike)) cnt++;
              if (cnt >= laneCount(w.road[xc]) * LANE_CAP) allowed = false;
            }
          }
        }
        const stopDist = toEdge - STOP_BACK;
        if (allowed) {
          if (toEdge < 7 + v * 1.3) {
            st.commit[i] = nc;
            this.addOcc(rj, dInJ, left);
          }
          st.wait[i] = 0;
        } else if (stopDist < (v * v) / (2 * 6.5) - 0.3 || stopDist < -0.5) {
          // cannot stop before the line any more: go (runs the yellow)
          st.commit[i] = nc;
          this.addOcc(rj, dInJ, left);
        } else {
          if (stopDist < gap) {
            gap = stopDist;
            vl = 0;
          }
          if (v < 0.6 && stopDist < 6) {
            st.wait[i] += h;
            this.writeWait(rj, axis, st.wait[i]);
            if (sig === 'red' || sig === 'yellow') waitingLights++;
          }
        }
      }
      // next transit stop: brake for it from far enough ahead (trains need hundreds of meters)
      if (transit) {
        const sp = this.hooks.nextStopPi(i);
        if (sp >= 0) {
          const ahead = (((sp - pi) % n) + n) % n;
          if (ahead > n - 3 && n > 8) {
            // just passed it (pushed through / teleported): serve the next one
            st.stopI[i]++;
          } else {
            const long = (st.flags[i] & VF.Long) !== 0;
            // long vehicles pull their front up to the far end of the stop cell
            const stopAt = (lenOf: number) => (long ? Math.max(0.5, lenOf - 1.2 - st.half[i]) : lenOf * 0.55);
            const target = ahead === 0 ? stopAt(clen) - s : clen - s + (ahead - 1) * CELL + stopAt(CELL);
            if (ahead === 0 && target < 0.8 && target > -2.5 && v < 1.5) {
              // at the stop: dwell (snap the last centimeters)
              st.s[i] = Math.min(clen - 0.01, s + Math.max(0, target));
              const dwell = this.hooks.stopReached(i);
              st.state[i] = VS.Dwell;
              st.timer[i] = dwell;
              st.v[i] = 0;
              this.pose(i);
              continue;
            }
            if (ahead === 0 && target <= -2.5) st.stopI[i]++;
            else if (target >= 0 && target < 450) {
              const gstop = target + S0;
              if (gstop < gap) {
                gap = gstop;
                vl = 0;
              }
            }
          }
        }
      }
      // curbside destination
      if (!hasNext && st.endMode[i] === End.Mid) {
        const g2 = clen - s + S0 - 0.4;
        if (g2 < gap) {
          gap = g2;
          vl = 0;
        }
        if (clen - s < 0.7 && v < 0.4) {
          st.v[i] = 0;
          this.hooks.arrive(i);
          continue;
        }
      }
      // IDM
      let acc: number;
      const vr = v / Math.max(0.5, v0);
      const free = 1 - vr * vr * vr * vr;
      if (gap < Infinity) {
        const sStar = S0 + Math.max(0, v * T_HEADWAY + (v * (v - vl)) / (2 * Math.sqrt(amax * bcomf)));
        const gg = Math.max(0.12, gap);
        acc = amax * (free - (sStar / gg) * (sStar / gg));
        if (gap < 0.25 && vl < 0.5) acc = Math.min(acc, -v / Math.max(h, 0.05));
      } else acc = amax * free;
      if (acc < -9) acc = -9;
      let nv = v + acc * h;
      if (nv < 0) nv = 0;
      let ds = (v + nv) * 0.5 * h;
      if (gap < Infinity && ds > gap - 0.05 && gap > 0) ds = Math.max(0, Math.min(ds, gap - 0.05));
      else if (gap <= 0 && vl < 0.5) ds = 0;
      st.v[i] = nv;
      st.acc[i] = st.acc[i] * 0.7 + acc * 0.3;
      st.s[i] = s + ds;
      // stuck detection
      if (nv < 0.4) {
        st.stuck[i] += h;
        if (st.stuck[i] > (transit ? TRANSIT_STUCK : STUCK_LIMIT) && !(st.stuck[i] < SIGNAL_STUCK && this.queuedAtSignal(i))) {
          if (transit) this.hooks.transitStuck(i);
          else this.hooks.despawn(i);
          continue;
        }
      } else {
        moving++;
        st.stuck[i] = Math.max(0, st.stuck[i] - h * 3);
      }
      if (!transit && !(st.flags[i] & VF.Service) && st.age[i] > MAX_AGE) {
        this.hooks.despawn(i);
        continue;
      }
      // congestion sample
      occSum[r] += st.flags[i] & VF.Bike ? 0.35 : 1 + Math.min(2, st.len[i] / 12);
      spdSum[r] += Math.min(1, nv / Math.max(1, lim));
      // advance through cells
      if (!this.advanceWhile(i)) continue;
      this.pose(i);
      // arrival fade into lots / off the map
      if (!loop && st.pi[i] === n - 1 && (st.endMode[i] === End.Building || st.endMode[i] === End.Outside)) {
        const rem = st.curve[o + 8] - st.s[i];
        st.fade[i] = Math.min(st.fade[i], Math.max(0, rem / 2.5));
      }
    }
    this.stats.waitingAtLights = waitingLights;
    this.stats.moving = moving;
  }

  /** consume s beyond the end of the current curve; false if the vehicle left the simulation */
  advanceWhile(i: number): boolean {
    const st = this.st, g = this.graph;
    let guard = 0;
    while (st.s[i] >= st.curve[i * CURVE_STRIDE + 8]) {
      if (++guard > 64) {
        this.hooks.despawn(i);
        return false;
      }
      const path = st.path[i]!;
      const n = path.length;
      const pi = st.pi[i];
      const c = path[pi];
      if (st.commit[i] === c) st.commit[i] = -1;
      if (!st.loop[i] && pi >= n - 1) {
        st.s[i] = st.curve[i * CURVE_STRIDE + 8];
        this.pose(i);
        this.hooks.arrive(i);
        return false;
      }
      const np = st.loop[i] ? (pi + 1) % n : pi + 1;
      const nc = path[np];
      if (g.rid[nc] < 0 || !(g.kind[nc] & this.kindMaskFor(i))) {
        // road ahead removed: stop at the end of this cell and ask for a new path
        st.s[i] = st.curve[i * CURVE_STRIDE + 8] - 0.01;
        st.v[i] = 0;
        this.hooks.reroute(i);
        return st.state[i] !== VS.Free;
      }
      st.s[i] -= st.curve[i * CURVE_STRIDE + 8];
      st.pi[i] = np;
      this.enterCell(i, np);
      if (st.commit[i] >= 0 && st.commit[i] !== nc) st.commit[i] = -1;
    }
    return true;
  }

  private kindMaskFor(i: number): number {
    const vt = this.st.type[i];
    if (vt === VT.train) return 4; // K.Rail
    if (vt === VT.tram) return 8; // K.Tram
    return 1 | 2; // K.Car | K.Ped
  }

  /** is there a signalized junction within a few cells ahead (queue at a light)? */
  private queuedAtSignal(i: number): boolean {
    const sig = this.signals?.signalState;
    if (!sig) return false;
    const st = this.st, g = this.graph, size = this.size;
    const n = st.path[i]!.length;
    for (let k = st.pi[i] + 1; k <= st.pi[i] + 6; k++) {
      if (!st.loop[i] && k >= n) break;
      const c = this.cellAt(i, k);
      if (g.deg[c] >= 3) return sig.call(this.signals, c % size, (c / size) | 0, (this.dInAt(i, k) + 2) & 3) !== null;
    }
    return false;
  }

  /** after dwelling: long vehicles at a reversal marker swap ends (push-pull) */
  private afterDwell(i: number): void {
    const st = this.st;
    if (!(st.flags[i] & VF.Long)) return;
    const pi = st.pi[i];
    if (this.cellAt(i, pi + 1) !== this.cellAt(i, pi)) return;
    const q = st.s[i] + st.half[i];
    const n = st.path[i]!.length;
    const np = st.loop[i] ? (pi + 1) % n : pi + 1;
    st.pi[i] = np;
    this.enterCell(i, np);
    st.s[i] = st.curve[i * CURVE_STRIDE + 8] - q + st.len[i] - st.half[i];
    st.commit[i] = -1;
    if (this.advanceWhile(i)) this.pose(i);
  }

  /** cheap mode for very large steps (10x at low frame rates): no interactions */
  private fastStep(dt: number): void {
    this.frame++;
    const st = this.st, rid = this.graph.rid;
    const act = st.active;
    this.samples++;
    for (let a = st.activeN - 1; a >= 0; a--) {
      const i = act[a];
      const state = st.state[i];
      if (state < VS.Drive || st.flags[i] & VF.Free) continue;
      st.age[i] += dt;
      st.fade[i] = 1;
      if (state === VS.Dwell) {
        st.timer[i] -= dt;
        if (st.timer[i] <= 0) {
          st.state[i] = VS.Drive;
          st.stopI[i]++;
          this.afterDwell(i);
        }
        continue;
      }
      if (state === VS.OnScene) {
        st.timer[i] -= dt;
        if (st.timer[i] <= 0) this.hooks.arrive(i);
        continue;
      }
      if (state !== VS.Drive) continue;
      const c = st.path[i]![st.pi[i]];
      const r = rid[c];
      if (r < 0) {
        this.hooks.despawn(i);
        continue;
      }
      if (!(st.flags[i] & (VF.Transit | VF.Service)) && st.age[i] > MAX_AGE) {
        this.hooks.despawn(i);
        continue;
      }
      const lim = Math.min(this.limit(i, c), st.curve[i * CURVE_STRIDE + 9] + 2);
      const cg = this.world.fields.traffic[c] * (1 / 255);
      const v = lim * (1 - 0.7 * cg);
      st.v[i] = v;
      st.acc[i] = 0;
      if (st.flags[i] & VF.Transit) {
        const sp = this.hooks.nextStopPi(i);
        const cl = st.curve[i * CURVE_STRIDE + 8];
        const at = st.flags[i] & VF.Long ? Math.max(0.5, cl - 1.2 - st.half[i]) : cl * 0.55;
        if (sp === st.pi[i] && st.s[i] < at && st.s[i] + v * dt >= at) {
          st.s[i] = at;
          st.state[i] = VS.Dwell;
          st.timer[i] = this.hooks.stopReached(i);
          st.v[i] = 0;
          this.pose(i);
          continue;
        }
      }
      if (!(st.flags[i] & VF.Transit) && st.endMode[i] === End.Mid && st.pi[i] === st.path[i]!.length - 1 && st.s[i] + v * dt >= st.curve[i * CURVE_STRIDE + 8] - 0.7) {
        st.s[i] = st.curve[i * CURVE_STRIDE + 8] - 0.5;
        this.pose(i);
        this.hooks.arrive(i);
        continue;
      }
      this.occSum[r] += 1;
      this.spdSum[r] += 1 - 0.7 * cg;
      st.s[i] += v * dt;
      if (!this.advanceWhile(i)) continue;
      this.pose(i);
    }
  }

  /**
   * Points `backs[k]` meters (ascending) behind the head section's center
   * along vehicle i's path, written to out[k*4 .. k*4+3] as x, z, tx, tz.
   * Previous cells' trajectories are rebuilt on the fly (trailing sections of
   * trams, trains and semis), then the vehicle's own state is restored.
   */
  pointsBehind(i: number, backs: Float32Array, count: number, out: Float32Array): void {
    const st = this.st, p = this.p;
    const o = i * CURVE_STRIDE;
    let startDist = st.s[i];
    let q = 0;
    // requests on the current curve
    while (q < count && backs[q] <= startDist) {
      evalCurve(st.curve, o, startDist - backs[q], p);
      out[q * 4] = p.x;
      out[q * 4 + 1] = p.z;
      out[q * 4 + 2] = p.tx;
      out[q * 4 + 3] = p.tz;
      q++;
    }
    if (q >= count) return;
    const scratch = this.scratch;
    scratch.set(st.curve.subarray(o, o + CURVE_STRIDE), 0);
    const lIn = st.laneIn[i], lOut = st.laneOut[i], oo = st.offOut[i], di = st.dIn[i], dd = st.dOut[i];
    const n = st.path[i]!.length;
    const loop = st.loop[i] !== 0;
    let k = st.pi[i];
    for (let guard = 0; guard < 16 && q < count; guard++) {
      k--;
      if (k < 0 && !loop) break;
      const kk = loop ? ((k % n) + n) % n : k;
      if (loop || kk > 0) {
        const lp = this.laneAt(i, kk - 1);
        st.offOut[i] = this.offsetFor(i, this.roadTypeAt(this.cellAt(i, kk)), lp);
        st.laneOut[i] = lp;
      }
      this.enterCell(i, kk);
      startDist += st.curve[o + 8];
      while (q < count && backs[q] <= startDist) {
        evalCurve(st.curve, o, startDist - backs[q], p);
        out[q * 4] = p.x;
        out[q * 4 + 1] = p.z;
        out[q * 4 + 2] = p.tx;
        out[q * 4 + 3] = p.tz;
        q++;
      }
    }
    // beyond the start of the path: extend straight backwards from its first point
    if (q < count) {
      evalCurve(st.curve, o, 0, p);
      for (; q < count; q++) {
        const ex = startDist - backs[q];
        out[q * 4] = p.x + p.tx * ex;
        out[q * 4 + 1] = p.z + p.tz * ex;
        out[q * 4 + 2] = p.tx;
        out[q * 4 + 3] = p.tz;
      }
    }
    st.curve.set(scratch.subarray(0, CURVE_STRIDE), o);
    st.laneIn[i] = lIn;
    st.laneOut[i] = lOut;
    st.offOut[i] = oo;
    st.dIn[i] = di;
    st.dOut[i] = dd;
  }
  private scratch = new Float32Array(CURVE_STRIDE);

  /** approximate dwell / queue check used by stats: vehicles currently waiting at signals */
  get waitingAtLights(): number {
    return this.stats.waitingAtLights;
  }

  /** vehicles linked into a road cell during the last step (spawn throttling) */
  cellLoad(cell: number): number {
    const r = this.graph.rid[cell];
    if (r < 0 || r >= this.hstamp.length || this.hstamp[r] !== this.frame) return 0;
    let n = 0;
    for (let j = this.head[r]; j >= 0; j = this.next[j]) n++;
    return n;
  }

  /** junction cell? */
  isJunction(cell: number): boolean {
    return this.graph.deg[cell] >= 3;
  }
}

function yawDir(yaw: number): number {
  // yaw 0 = +Z (S), π/2 = +X (E), π = -Z (N), -π/2 = -X (W)
  const sx = Math.sin(yaw), cz = Math.cos(yaw);
  if (Math.abs(sx) > Math.abs(cz)) return sx > 0 ? 1 : 3;
  return cz > 0 ? 2 : 0;
}
export { yawDir };
