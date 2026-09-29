// Lane geometry and per-cell trajectories.
//
// Every road cell a vehicle crosses is driven along ONE cubic Bézier from the
// point where it enters the cell to the point where it leaves it. End points
// sit on the shared cell edges, laterally offset to the vehicle's lane (right
// of travel for right-hand traffic), so consecutive curves join with C1
// continuity. Turns use the "corner" construction (control points at 0.5523 ×
// the distance to the intersection of entry and exit lines ≈ circular arcs),
// straights with different entry/exit offsets become gentle S-curves (lane
// changes) and dead ends become U-turns inside the cell.
//
// Lane offsets match the painted markings of the road renderer's profiles.
import { CELL } from '../../core/constants';
import { DIR_DX, DIR_DY, RoadType } from '../../core/types';

/** carriageway half width per road type (m) */
export const ROAD_HALF_WIDTH: number[] = [0, 3.3, 4.25, 5.75, 6.4, 7.7, 8, 5.3, 5.75];
/** sidewalk center offset from the road center line (m), 0 = no sidewalk */
export const SIDEWALK_OFFSET: number[] = [0, 0, 5.125, 6.875, 7.2, 0, 5.2, 0, 6.875];
/** tram track center offset (m) */
export const TRAM_TRACK = 1.53;
/** rail track center offset (m) */
export const RAIL_TRACK = 2.0;

/** Lane center offsets (m) for ONE direction, innermost (fast) lane first. */
export const LANE_OFFSETS: number[][] = (() => {
  const out: number[][] = [];
  out[RoadType.None] = [2];
  out[RoadType.Dirt] = [1.6];
  out[RoadType.Street] = [4.25 * 0.5 - 0.1];
  {
    const inner = 0.23, outer = 5.75 - 0.35, div = inner + (outer - inner) / 2;
    out[RoadType.Avenue] = out[RoadType.TramAvenue] = [(inner + div) / 2, (div + outer) / 2];
  }
  {
    const inner = 1.0 + 0.25, outer = 6.4 - 0.35, lw = (outer - inner) / 3;
    out[RoadType.Boulevard] = [inner + lw * 0.5, inner + lw * 1.5, inner + lw * 2.5];
  }
  {
    const inner = 0.8, outer = 7.7 - 0.7, lw = (outer - inner) / 3;
    out[RoadType.Highway] = [inner + lw * 0.5, inner + lw * 1.5, inner + lw * 2.5];
  }
  out[RoadType.Pedestrian] = [1.5];
  out[RoadType.Rail] = [RAIL_TRACK];
  return out;
})();

export function laneCount(t: number): number {
  return (LANE_OFFSETS[t] ?? LANE_OFFSETS[0]).length;
}
export function laneOffset(t: number, lane: number): number {
  const l = LANE_OFFSETS[t] ?? LANE_OFFSETS[0];
  return l[lane < l.length ? lane : l.length - 1];
}

/** stride of a curve record in a Float32Array */
export const CURVE_STRIDE = 10;
// record layout: p0x p0z p1x p1z p2x p2z p3x p3z length vmaxTurn

const K = 0.5523;

/**
 * Fit a cubic Bézier from (p0, tangent t0) to (p3, tangent t3) into f[o..o+9].
 * Tangents must be unit vectors. Stores the arc length and a comfortable
 * cornering speed limit (m/s; 99 for straight segments).
 */
export function fitCurve(f: Float32Array, o: number, p0x: number, p0z: number, t0x: number, t0z: number, p3x: number, p3z: number, t3x: number, t3z: number): void {
  const dx = p3x - p0x, dz = p3z - p0z;
  const cross = t0x * t3z - t0z * t3x;
  const dot = t0x * t3x + t0z * t3z;
  let a: number, b: number, vmax = 99;
  if (Math.abs(cross) < 1e-3) {
    if (dot > 0) {
      const d = Math.hypot(dx, dz) / 3;
      a = b = d;
    } else {
      // U-turn: loop into the cell
      a = b = 9.5;
      vmax = 3.2;
    }
  } else {
    // p0 + a·t0 = p3 − b·t3
    const ia = (dx * t3z - dz * t3x) / cross;
    const ib = (t0x * dz - t0z * dx) / cross;
    if (ia > 0.2 && ib > 0.2) {
      a = ia * K;
      b = ib * K;
      const r = Math.max(2.5, Math.min(ia, ib));
      vmax = Math.sqrt(2.6 * r) + 1.0;
    } else {
      const d = Math.hypot(dx, dz) / 3;
      a = b = d;
      vmax = 4;
    }
  }
  f[o] = p0x;
  f[o + 1] = p0z;
  f[o + 2] = p0x + t0x * a;
  f[o + 3] = p0z + t0z * a;
  f[o + 4] = p3x - t3x * b;
  f[o + 5] = p3z - t3z * b;
  f[o + 6] = p3x;
  f[o + 7] = p3z;
  f[o + 8] = curveLength(f, o);
  f[o + 9] = vmax;
}

function curveLength(f: Float32Array, o: number): number {
  let len = 0, px = f[o], pz = f[o + 1];
  const N = 8;
  for (let i = 1; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    const x = b0 * f[o] + b1 * f[o + 2] + b2 * f[o + 4] + b3 * f[o + 6];
    const z = b0 * f[o + 1] + b1 * f[o + 3] + b2 * f[o + 5] + b3 * f[o + 7];
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return Math.max(0.05, len);
}

/** evaluation result (reused, never allocate per call) */
export interface CurvePoint {
  x: number;
  z: number;
  /** unit tangent */
  tx: number;
  tz: number;
}

/** point + unit tangent at arc position s (0..len, clamped) */
export function evalCurve(f: Float32Array, o: number, s: number, out: CurvePoint): CurvePoint {
  const len = f[o + 8];
  let t = s / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  out.x = b0 * f[o] + b1 * f[o + 2] + b2 * f[o + 4] + b3 * f[o + 6];
  out.z = b0 * f[o + 1] + b1 * f[o + 3] + b2 * f[o + 5] + b3 * f[o + 7];
  // derivative
  const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
  let tx = d0 * (f[o + 2] - f[o]) + d1 * (f[o + 4] - f[o + 2]) + d2 * (f[o + 6] - f[o + 4]);
  let tz = d0 * (f[o + 3] - f[o + 1]) + d1 * (f[o + 5] - f[o + 3]) + d2 * (f[o + 7] - f[o + 5]);
  const l = Math.hypot(tx, tz);
  if (l > 1e-6) {
    tx /= l;
    tz /= l;
  } else {
    tx = f[o + 6] - f[o];
    tz = f[o + 7] - f[o + 1];
    const l2 = Math.hypot(tx, tz) || 1;
    tx /= l2;
    tz /= l2;
  }
  out.tx = tx;
  out.tz = tz;
  return out;
}

/** direction index (0..3) from cell a to 4-neighbour cell b, -1 if not adjacent */
export function dirBetween(size: number, a: number, b: number): number {
  const d = b - a;
  if (d === -size) return 0;
  if (d === 1) return 1;
  if (d === size) return 2;
  if (d === -1) return 3;
  return -1;
}

/** world-space point on the edge of cell (x, y) in direction d, shifted `lat` meters to the right of travel direction `travel` */
export function edgePoint(x: number, y: number, d: number, travel: number, lat: number, out: { x: number; z: number }): void {
  const r = (travel + 1) & 3;
  out.x = (x + 0.5) * CELL + DIR_DX[d] * (CELL / 2) + DIR_DX[r] * lat;
  out.z = (y + 0.5) * CELL + DIR_DY[d] * (CELL / 2) + DIR_DY[r] * lat;
}

/** turn classification from travel direction a to b: 0 straight, 1 right, -1 left, 2 U-turn */
export function turnOf(a: number, b: number): number {
  const d = (b - a) & 3;
  return d === 0 ? 0 : d === 1 ? 1 : d === 3 ? -1 : 2;
}
