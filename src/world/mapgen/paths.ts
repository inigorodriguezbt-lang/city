// ─────────────────────────────────────────────────────────────────────────────
// Designed-path helpers: map orientation, meandering centre lines (rivers,
// fjords, glacial valleys) and their distance fields on the vertex grid.
// ─────────────────────────────────────────────────────────────────────────────
import type { Noise } from '../../core/noise';
import type { RNG } from '../../core/rng';
import type { DesignedPath } from './context';
import { distanceTransform } from './grid';

/**
 * One of the 8 symmetries of the square. Theme shapers work in a canonical
 * frame (u right, v down, open sea at v = 1) and this maps it onto the map.
 */
export class Orientation {
  readonly rot: number;
  readonly flip: boolean;
  constructor(code: number) {
    this.rot = code & 3;
    this.flip = (code & 4) !== 0;
  }
  /** canonical (u, v) in [0,1]² → map normalised (x, y) */
  toMap(u: number, v: number): [number, number] {
    let x: number, y: number;
    switch (this.rot) {
      case 1: x = 1 - v; y = u; break;
      case 2: x = 1 - u; y = 1 - v; break;
      case 3: x = v; y = 1 - u; break;
      default: x = u; y = v;
    }
    if (this.flip) x = 1 - x;
    return [x, y];
  }
  /** map normalised (x, y) → canonical (u, v) */
  toCanon(x: number, y: number): [number, number] {
    if (this.flip) x = 1 - x;
    switch (this.rot) {
      case 1: return [y, 1 - x];
      case 2: return [1 - x, 1 - y];
      case 3: return [1 - y, x];
      default: return [x, y];
    }
  }
  /** Map edge (Dir: N0 E1 S2 W3) of a canonical edge (top0 right1 bottom2 left3). */
  edge(canonEdge: number): number {
    const mid: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    const [x, y] = this.toMap(mid[canonEdge][0], mid[canonEdge][1]);
    if (y < 0.01) return 0;
    if (x > 0.99) return 1;
    if (y > 0.99) return 2;
    return 3;
  }
}

export interface MeanderOpts {
  /** mean meander wavelength (m) */
  wavelength: number;
  /** meander swing amplitude (radians off the course heading) */
  amplitude: number;
  /** integration step (m) */
  step: number;
  /** extra low-frequency heading wander (radians) */
  wander: number;
}

/**
 * Sine-generated meandering curve from S to E (both in meters, any frame).
 * The heading oscillates around the bearing to the target with noise-modulated
 * wavelength/amplitude, straightening as it approaches E so it lands exactly.
 */
export function meanderLine(rng: RNG, noise: Noise, sx: number, sy: number, ex: number, ey: number, o: MeanderOpts): number[] {
  const out: number[] = [sx, sy];
  let px = sx, py = sy;
  let s = 0;
  let phase = rng.next() * Math.PI * 2;
  const salt = rng.next() * 1000;
  const straight = Math.hypot(ex - sx, ey - sy);
  const maxSteps = Math.ceil((straight * 3) / o.step) + 16;
  for (let it = 0; it < maxSteps; it++) {
    const tx = ex - px, ty = ey - py;
    const dist = Math.hypot(tx, ty);
    if (dist < o.step * 1.5) break;
    const bearing = Math.atan2(ty, tx);
    const taper = Math.min(1, dist / (o.wavelength * 0.75));
    const k = s / o.wavelength;
    const lambda = o.wavelength * (1 + 0.35 * noise.noise2(k * 0.7, salt));
    phase += (Math.PI * 2 * o.step) / Math.max(o.wavelength * 0.4, lambda);
    const amp = o.amplitude * (0.8 + 0.35 * noise.noise2(k * 0.45, salt + 31.7)) * taper;
    const heading = bearing + amp * Math.sin(phase) + o.wander * taper * noise.fbm2(k * 0.25, salt + 77.1, 2);
    px += Math.cos(heading) * o.step;
    py += Math.sin(heading) * o.step;
    s += o.step;
    out.push(px, py);
  }
  out.push(ex, ey);
  return out;
}

/** Chaikin corner cutting (keeps end points). */
export function chaikin(pts: number[], iterations: number): number[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const n = p.length / 2;
    if (n < 3) return p;
    const q: number[] = [p[0], p[1]];
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
      q.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    q.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
    p = q;
  }
  return p;
}

/** Build a DesignedPath from a cell-space polyline. */
export function makePath(kind: DesignedPath['kind'], cellPts: number[], inflow = 0): DesignedPath {
  const n = cellPts.length / 2;
  const pts = new Float32Array(cellPts);
  const arc = new Float32Array(n);
  let len = 0;
  for (let i = 1; i < n; i++) {
    len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    arc[i] = len;
  }
  return { kind, pts, arc, length: Math.max(len, 1e-6), inflow, lakeSpans: [] };
}

/** Point on a path at normalised arc parameter t ∈ [0,1] (cells). */
export function pointAt(p: DesignedPath, t: number): [number, number] {
  const target = Math.max(0, Math.min(1, t)) * p.length;
  const n = p.arc.length;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.arc[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = p.arc[hi] - p.arc[lo];
  const f = seg > 1e-9 ? (target - p.arc[lo]) / seg : 0;
  return [p.pts[lo * 2] + (p.pts[hi * 2] - p.pts[lo * 2]) * f, p.pts[lo * 2 + 1] + (p.pts[hi * 2 + 1] - p.pts[lo * 2 + 1]) * f];
}

/** Unit tangent of a path at normalised parameter t. */
export function tangentAt(p: DesignedPath, t: number): [number, number] {
  const e = Math.min(0.02, 4 / p.length);
  const a = pointAt(p, t - e), b = pointAt(p, t + e);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

export interface PathField {
  /** distance (cells) from each vertex to the nearest path(s) centre line */
  dist: Float32Array;
  /** normalised arc parameter of the nearest centre-line point */
  s: Float32Array;
  /** index into the path list of the nearest path (-1 if none) */
  id: Int16Array;
}

/**
 * Distance field on the (V×V) vertex grid to a set of polylines, with the
 * nearest arc parameter and path id. Exact EDT over densely rasterised seeds.
 */
export function pathField(paths: DesignedPath[], V: number): PathField {
  const n = V * V;
  const seed = new Uint8Array(n);
  const seedS = new Float32Array(n);
  const seedId = new Int16Array(n).fill(-1);
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi];
    const cnt = p.arc.length;
    for (let i = 0; i < cnt - 1; i++) {
      const ax = p.pts[i * 2], ay = p.pts[i * 2 + 1], bx = p.pts[i * 2 + 2], by = p.pts[i * 2 + 3];
      const segLen = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(segLen / 0.3));
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const x = Math.round(ax + (bx - ax) * f), y = Math.round(ay + (by - ay) * f);
        if (x < 0 || y < 0 || x >= V || y >= V) continue;
        const vi = y * V + x;
        if (seed[vi]) continue;
        seed[vi] = 1;
        seedS[vi] = (p.arc[i] + segLen * f) / p.length;
        seedId[vi] = pi;
      }
    }
  }
  const { dist, nearest } = distanceTransform(seed, V, V, true);
  const s = new Float32Array(n);
  const id = new Int16Array(n).fill(-1);
  if (nearest) {
    for (let i = 0; i < n; i++) {
      const j = nearest[i];
      if (j >= 0) {
        s[i] = seedS[j];
        id[i] = seedId[j];
      }
    }
  }
  return { dist, s, id };
}
