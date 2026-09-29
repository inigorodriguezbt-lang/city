// Low-level geometry assembly for road chunks: a growable vertex/index buffer,
// a per-cell frame (canonical piece space → world, surface heights, normals)
// and generic emitters (row sections, extrusions along paths, boxes, prisms).
//
// Canonical piece space: (u, v) ∈ [0,16]², u → +X, v → +Z of the cell. A piece
// is built once in canonical orientation and rotated by k quarter turns
// clockwise seen from above (N → E → S → W): (u, v) → (16 − v, u).
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import { ROAD_LIFT } from '../../world/roadHeight';
import type { World } from '../../world/World';
import { Kind } from './profiles';
import { DECK_THICKNESS, type RoadHeightField } from './surface';

export const code = (kind: Kind, style: number, flags: number): number => kind + style * 16 + flags * 256;

export class GeoBuf {
  pos = new Float32Array(3 * 8192);
  nor = new Float32Array(3 * 8192);
  road = new Float32Array(4 * 8192);
  idx = new Uint32Array(3 * 8192);
  nv = 0;
  ni = 0;

  reset(): void {
    this.nv = 0;
    this.ni = 0;
  }

  private growV(): void {
    const n = this.pos.length * 2;
    const p = new Float32Array(n), q = new Float32Array(n), r = new Float32Array((n / 3) * 4);
    p.set(this.pos);
    q.set(this.nor);
    r.set(this.road);
    this.pos = p;
    this.nor = q;
    this.road = r;
  }

  vtx(x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number, t: number, hw: number, c: number): number {
    if ((this.nv + 1) * 3 > this.pos.length) this.growV();
    const i = this.nv++;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.nor[o] = nx;
    this.nor[o + 1] = ny;
    this.nor[o + 2] = nz;
    const r = i * 4;
    this.road[r] = s;
    this.road[r + 1] = t;
    this.road[r + 2] = hw;
    this.road[r + 3] = c;
    return i;
  }

  /** triangle oriented so its face normal points along (wx, wy, wz); degenerate ones are dropped */
  tri(a: number, b: number, c: number, wx: number, wy: number, wz: number): void {
    const P = this.pos;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len2 = nx * nx + ny * ny + nz * nz;
    if (len2 < 1e-10) return;
    if (this.ni + 3 > this.idx.length) {
      const n = new Uint32Array(this.idx.length * 2);
      n.set(this.idx);
      this.idx = n;
    }
    const I = this.idx;
    if (nx * wx + ny * wy + nz * wz >= 0) {
      I[this.ni++] = a;
      I[this.ni++] = b;
      I[this.ni++] = c;
    } else {
      I[this.ni++] = a;
      I[this.ni++] = c;
      I[this.ni++] = b;
    }
  }

  quad(a: number, b: number, c: number, d: number, wx: number, wy: number, wz: number): void {
    this.tri(a, b, c, wx, wy, wz);
    this.tri(a, c, d, wx, wy, wz);
  }

  /** upward-facing quad */
  quadUp(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c, 0, 1, 0);
    this.tri(a, c, d, 0, 1, 0);
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry();
    const nv = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, nv * 3), 3));
    const n8 = new Int8Array(nv * 3);
    const N = this.nor;
    for (let i = 0; i < nv; i++) {
      const o = i * 3;
      const x = N[o], y = N[o + 1], z = N[o + 2];
      const l = 127 / (Math.sqrt(x * x + y * y + z * z) || 1);
      n8[o] = Math.round(x * l);
      n8[o + 1] = Math.round(y * l);
      n8[o + 2] = Math.round(z * l);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n8, 3, true));
    g.setAttribute('aRoad', new THREE.BufferAttribute(this.road.slice(0, nv * 4), 4));
    const idx = nv < 65535 ? new Uint16Array(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export interface V2 {
  u: number;
  v: number;
}
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Cell frame: canonical → world transforms and surface heights of the cell. */
export class Frame {
  cx = 0;
  cy = 0;
  ox = 0;
  oz = 0;
  k = 0;
  bridge = false;
  raised = false;
  /** outputs of `w()` */
  X = 0;
  Z = 0;
  private n: V3 = { x: 0, y: 1, z: 0 };

  constructor(readonly world: World, readonly hf: RoadHeightField) {}

  set(cx: number, cy: number, k: number): this {
    this.cx = cx;
    this.cy = cy;
    this.ox = cx * CELL;
    this.oz = cy * CELL;
    this.k = k & 3;
    this.bridge = this.world.isBridge(cx, cy);
    this.raised = this.hf.isRaised(cx, cy);
    return this;
  }

  /** canonical (u, v) → world X/Z (stored in this.X / this.Z) */
  w(u: number, v: number): void {
    let x: number, z: number;
    switch (this.k) {
      case 0: x = u; z = v; break;
      case 1: x = CELL - v; z = u; break;
      case 2: x = CELL - u; z = CELL - v; break;
      default: x = v; z = CELL - u; break;
    }
    this.X = this.ox + x;
    this.Z = this.oz + z;
  }

  /** canonical direction → world direction (x, z) */
  dir(du: number, dv: number): [number, number] {
    switch (this.k) {
      case 0: return [du, dv];
      case 1: return [-dv, du];
      case 2: return [-du, -dv];
      default: return [dv, -du];
    }
  }

  /** canonical yaw (model +X toward canonical (cos, -sin)) → world yaw */
  yaw(a: number): number {
    return a - (this.k * Math.PI) / 2;
  }

  /** ground-equivalent height (road surface − ROAD_LIFT) at a world point */
  base(wx: number, wz: number): number {
    return this.hf.cellSurface(this.cx, this.cy, wx, wz) - ROAD_LIFT;
  }

  terrain(wx: number, wz: number): number {
    return this.world.heightAt(wx, wz);
  }

  normal(wx: number, wz: number): V3 {
    this.hf.cellNormal(this.cx, this.cy, wx, wz, this.n);
    return this.n;
  }

  /** bottom of vertical skirts at a world point */
  skirt(wx: number, wz: number, base: number): number {
    return this.bridge ? base - DECK_THICKNESS : Math.min(this.terrain(wx, wz), base) - 0.08;
  }
}

// ── row sections ────────────────────────────────────────────────────────────

/** Fixed per-piece description of the layers across a section (left → right). */
export interface Section {
  kind: Kind[];
  style: number[];
  flags: number[];
  /** lateral subdivisions per layer */
  split: number[];
  /** kind used for the wall at internal boundary i (between layer i-1 and i) */
  wall: Kind[];
}

/** One cross-section row. b has layers+1 boundaries; la/lb are per-layer lifts at their left/right boundary. */
export interface Row {
  tau: number;
  b: number[];
  la: number[];
  lb: number[];
  hw: number;
  /** AND-mask on layer flags for the band starting at this row */
  mask: number;
}

export type Mapper = (s: number, tau: number, out: V2) => void;

export interface RowOpts {
  /** vertical skirt on the leftmost / rightmost boundary */
  skirtL: boolean;
  skirtR: boolean;
  /** deck underside (bridges) */
  bottom: boolean;
  skirtKind: Kind;
}

const tmp: V2 = { u: 0, v: 0 };
const tmp2: V2 = { u: 0, v: 0 };

/** Emit a row-based section: layer strips, walls between layers of different lift, skirts, deck bottom. */
export function emitRows(buf: GeoBuf, fr: Frame, sec: Section, rows: Row[], map: Mapper, opts: RowOpts): void {
  const R = rows.length;
  const L = sec.kind.length;
  if (R < 2) return;
  // boundary data per row: world x, z, base, normal
  const nb = L + 1;
  const bx = new Float64Array(R * nb), bz = new Float64Array(R * nb), bh = new Float64Array(R * nb);
  const bn = new Float64Array(R * nb * 3);
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    for (let i = 0; i < nb; i++) {
      map(row.b[i], row.tau, tmp);
      fr.w(tmp.u, tmp.v);
      const o = j * nb + i;
      bx[o] = fr.X;
      bz[o] = fr.Z;
      bh[o] = fr.base(fr.X, fr.Z);
      const n = fr.normal(fr.X, fr.Z);
      bn[o * 3] = n.x;
      bn[o * 3 + 1] = n.y;
      bn[o * 3 + 2] = n.z;
    }
  }
  const latDir = (s: number, tau: number): [number, number] => {
    map(s - 0.05, tau, tmp);
    map(s + 0.05, tau, tmp2);
    const [dx, dz] = fr.dir(tmp2.u - tmp.u, tmp2.v - tmp.v);
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };

  // ── layer strips ──
  const rowIdx: number[] = [];
  for (let li = 0; li < L; li++) {
    let any = false;
    for (let j = 0; j < R; j++) if (rows[j].b[li + 1] - rows[j].b[li] > 1e-4) any = true;
    if (!any) continue;
    const ns = Math.max(1, sec.split[li]);
    const kind = sec.kind[li], style = sec.style[li], flags = sec.flags[li];
    let prevCode = NaN;
    let prev: number[] = [];
    for (let j = 0; j < R - 1; j++) {
      const c = code(kind, style, flags & rows[j].mask);
      if (c !== prevCode) prev = emitStripRow(j, c);
      const next = emitStripRow(j + 1, c);
      for (let f = 0; f < ns; f++) buf.quadUp(prev[f], prev[f + 1], next[f + 1], next[f]);
      prev = next;
      prevCode = c;
    }
    function emitStripRow(j: number, c: number): number[] {
      rowIdx.length = 0;
      const row = rows[j];
      const s0 = row.b[li], s1 = row.b[li + 1];
      const l0 = row.la[li], l1 = row.lb[li];
      const slope = s1 - s0 > 1e-4 ? (l1 - l0) / (s1 - s0) : 0;
      let lat: [number, number] | null = null;
      if (Math.abs(slope) > 1e-3) lat = latDir((s0 + s1) / 2, row.tau);
      for (let f = 0; f <= ns; f++) {
        const a = f / ns;
        const s = s0 + (s1 - s0) * a;
        let x: number, z: number, h: number, nx: number, ny: number, nz: number;
        if (f === 0 || f === ns) {
          const o = j * nb + (f === 0 ? li : li + 1);
          x = bx[o];
          z = bz[o];
          h = bh[o];
          nx = bn[o * 3];
          ny = bn[o * 3 + 1];
          nz = bn[o * 3 + 2];
        } else {
          map(s, row.tau, tmp);
          fr.w(tmp.u, tmp.v);
          x = fr.X;
          z = fr.Z;
          h = fr.base(x, z);
          const n = fr.normal(x, z);
          nx = n.x;
          ny = n.y;
          nz = n.z;
        }
        if (lat) {
          nx -= lat[0] * slope * ny;
          nz -= lat[1] * slope * ny;
        }
        rowIdx.push(buf.vtx(x, h + l0 + (l1 - l0) * a, z, nx, ny, nz, s, row.tau, row.hw, c));
      }
      return rowIdx.slice();
    }
  }

  // ── walls between layers of different lift ──
  for (let i = 1; i < L; i++) {
    let any = false;
    for (let j = 0; j < R; j++) if (Math.abs(rows[j].lb[i - 1] - rows[j].la[i]) > 0.004) any = true;
    if (!any) continue;
    const c = code(sec.wall[i], sec.style[i], 0);
    let pa = -1, pb = -1, pSign = 0;
    for (let j = 0; j < R; j++) {
      const row = rows[j];
      const o = j * nb + i;
      const lo = row.lb[i - 1], hi = row.la[i];
      // the wall faces the lower side: toward -s if the left layer is lower
      const sign = lo < hi ? -1 : 1;
      const [lx, lz] = latDir(row.b[i], row.tau);
      const nx = lx * sign, nz = lz * sign;
      const a = buf.vtx(bx[o], bh[o] + Math.min(lo, hi), bz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      const b = buf.vtx(bx[o], bh[o] + Math.max(lo, hi), bz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      if (j > 0 && pSign === sign) buf.quad(pa, a, b, pb, nx, 0, nz);
      pa = a;
      pb = b;
      pSign = sign;
    }
  }

  // ── skirts (outer walls down to terrain / deck bottom) ──
  const skirt = (i: number, li: number, sign: number, top: 'la' | 'lb') => {
    const c = code(opts.skirtKind, sec.style[li], 0);
    let pa = -1, pb = -1;
    for (let j = 0; j < R; j++) {
      const row = rows[j];
      const o = j * nb + i;
      const [lx, lz] = latDir(row.b[i], row.tau);
      const nx = lx * sign, nz = lz * sign;
      const y1 = bh[o] + row[top][li];
      const y0 = fr.skirt(bx[o], bz[o], bh[o]);
      const a = buf.vtx(bx[o], Math.min(y0, y1 - 0.02), bz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      const b = buf.vtx(bx[o], y1, bz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      if (j > 0) buf.quad(pa, a, b, pb, nx, 0, nz);
      pa = a;
      pb = b;
    }
  };
  if (opts.skirtL) skirt(0, 0, -1, 'la');
  if (opts.skirtR) skirt(L, L - 1, 1, 'lb');

  // ── deck underside ──
  if (opts.bottom) {
    const c = code(Kind.Concrete, 0, 0);
    let prev: number[] = [];
    for (let j = 0; j < R; j++) {
      const cur: number[] = [];
      for (const i of [0, L]) {
        const o = j * nb + i;
        cur.push(buf.vtx(bx[o], bh[o] - DECK_THICKNESS, bz[o], 0, -1, 0, 0, 0, 0, c));
      }
      if (j > 0) buf.quad(prev[0], prev[1], cur[1], cur[0], 0, -1, 0);
      prev = cur;
    }
  }
}

// ── extrusions & primitives ─────────────────────────────────────────────────

/**
 * Extrude a 2D profile (lateral offset d, height h above the lifted surface)
 * along the path s = s0 of a mapper, between tau0 and tau1 in `seg` segments.
 * Profile points are ordered so the outward normal is on the left of each
 * edge when walking the profile with +lateral to the right and +height up.
 */
export function extrude(
  buf: GeoBuf, fr: Frame, map: Mapper, s0: number, tau0: number, tau1: number, seg: number,
  prof: [number, number][], lift: number, kind: Kind, closed = false,
): void {
  const c = code(kind, 0, 0);
  const P = prof.length;
  const E = closed ? P : P - 1;
  let prev: number[] | null = null;
  for (let j = 0; j <= seg; j++) {
    const tau = tau0 + ((tau1 - tau0) * j) / seg;
    map(s0, tau, tmp);
    map(s0 + 0.05, tau, tmp2);
    const [lx, lz] = fr.dir(tmp2.u - tmp.u, tmp2.v - tmp.v);
    const ll = Math.hypot(lx, lz) || 1;
    const Lx = lx / ll, Lz = lz / ll;
    fr.w(tmp.u, tmp.v);
    const cx = fr.X, cz = fr.Z;
    const base = fr.base(cx, cz) + lift;
    const cur: number[] = [];
    for (let e = 0; e < E; e++) {
      const p0 = prof[e], p1 = prof[(e + 1) % P];
      // edge normal in (lateral, up) space: rotate edge direction by -90°
      const ed = p1[0] - p0[0], eh = p1[1] - p0[1];
      const el = Math.hypot(ed, eh) || 1;
      const nd = eh / el, nh = -ed / el;
      for (const p of [p0, p1]) {
        const wx = cx + Lx * p[0], wz = cz + Lz * p[0];
        cur.push(buf.vtx(wx, base + p[1], wz, Lx * nd, nh, Lz * nd, s0 + p[0], tau, 0, c));
      }
    }
    if (prev) {
      for (let e = 0; e < E; e++) {
        const a = prev[e * 2], b = prev[e * 2 + 1], cc = cur[e * 2 + 1], d = cur[e * 2];
        // orientation from the stored normal of a
        const N = buf.nor;
        buf.quad(a, b, cc, d, N[a * 3], N[a * 3 + 1], N[a * 3 + 2]);
      }
    }
    prev = cur;
  }
}

/**
 * Axis-aligned box in a local frame: center (wx, wz) world, yaw (radians,
 * model +X → world (cos, −sin)), half sizes hx (along yaw) / hz, y range.
 * Emits top + 4 sides (no bottom).
 */
export function box(buf: GeoBuf, wx: number, wz: number, yaw: number, hx: number, hz: number, y0: number, y1: number, kind: Kind, bottom = false): void {
  const c = code(kind, 0, 0);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  // local axes in world: X' = (ca, -sa), Z' = (sa, ca)
  const px = (a: number, b: number): number => wx + ca * a + sa * b;
  const pz = (a: number, b: number): number => wz - sa * a + ca * b;
  const corners: [number, number][] = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  // top
  const top = corners.map(([a, b]) => buf.vtx(px(a, b), y1, pz(a, b), 0, 1, 0, 0, 0, 0, c));
  buf.quad(top[0], top[1], top[2], top[3], 0, 1, 0);
  if (bottom) {
    const bot = corners.map(([a, b]) => buf.vtx(px(a, b), y0, pz(a, b), 0, -1, 0, 0, 0, 0, c));
    buf.quad(bot[0], bot[1], bot[2], bot[3], 0, -1, 0);
  }
  for (let e = 0; e < 4; e++) {
    const [a0, b0] = corners[e], [a1, b1] = corners[(e + 1) & 3];
    const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2;
    const l = Math.hypot(ma, mb) || 1;
    const nx = (ca * ma + sa * mb) / l, nz = (-sa * ma + ca * mb) / l;
    const i0 = buf.vtx(px(a0, b0), y0, pz(a0, b0), nx, 0, nz, 0, 0, 0, c);
    const i1 = buf.vtx(px(a1, b1), y0, pz(a1, b1), nx, 0, nz, 0, 0, 0, c);
    const i2 = buf.vtx(px(a1, b1), y1, pz(a1, b1), nx, 0, nz, 0, 0, 0, c);
    const i3 = buf.vtx(px(a0, b0), y1, pz(a0, b0), nx, 0, nz, 0, 0, 0, c);
    buf.quad(i0, i1, i2, i3, nx, 0, nz);
  }
}

/** vertical n-gon prism (columns, piers) with smooth side normals and a top cap */
export function prism(buf: GeoBuf, wx: number, wz: number, r: number, y0: number, y1: number, sides: number, kind: Kind): void {
  const c = code(kind, 0, 0);
  const lo: number[] = [], hi: number[] = [], cap: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const nx = Math.cos(a), nz = Math.sin(a);
    lo.push(buf.vtx(wx + nx * r, y0, wz + nz * r, nx, 0, nz, 0, 0, 0, c));
    hi.push(buf.vtx(wx + nx * r, y1, wz + nz * r, nx, 0, nz, 0, 0, 0, c));
    if (i < sides) cap.push(buf.vtx(wx + nx * r, y1, wz + nz * r, 0, 1, 0, 0, 0, 0, c));
  }
  for (let i = 0; i < sides; i++) {
    const a = (i + 0.5) / sides * Math.PI * 2;
    buf.quad(lo[i], lo[i + 1], hi[i + 1], hi[i], Math.cos(a), 0, Math.sin(a));
  }
  for (let i = 1; i < sides - 1; i++) buf.tri(cap[0], cap[i], cap[i + 1], 0, 1, 0);
}
