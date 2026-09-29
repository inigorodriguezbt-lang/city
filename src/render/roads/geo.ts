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
  pos = new Float32Array(3 * 16384);
  /** quantized unit normals (written once in vtx: no conversion pass) */
  nor = new Int8Array(3 * 16384);
  road = new Float32Array(4 * 16384);
  idx = new Uint32Array(3 * 16384);
  nv = 0;
  ni = 0;
  private bmin = [0, 0, 0];
  private bmax = [0, 0, 0];

  reset(): void {
    this.nv = 0;
    this.ni = 0;
    this.bmin[0] = this.bmin[1] = this.bmin[2] = Infinity;
    this.bmax[0] = this.bmax[1] = this.bmax[2] = -Infinity;
  }

  private growV(): void {
    const n = this.pos.length * 2;
    const p = new Float32Array(n), q = new Int8Array(n), r = new Float32Array((n / 3) * 4);
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
    const P = this.pos;
    P[o] = x;
    P[o + 1] = y;
    P[o + 2] = z;
    const l = 127 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    const qx = nx * l, qy = ny * l, qz = nz * l;
    const N = this.nor;
    // round to nearest via int truncation of a positive value (fast path)
    N[o] = ((qx + 128.5) | 0) - 128;
    N[o + 1] = ((qy + 128.5) | 0) - 128;
    N[o + 2] = ((qz + 128.5) | 0) - 128;
    const r = i * 4;
    const R = this.road;
    R[r] = s;
    R[r + 1] = t;
    R[r + 2] = hw;
    R[r + 3] = c;
    const mn = this.bmin, mx = this.bmax;
    if (x < mn[0]) mn[0] = x;
    if (x > mx[0]) mx[0] = x;
    if (y < mn[1]) mn[1] = y;
    if (y > mx[1]) mx[1] = y;
    if (z < mn[2]) mn[2] = z;
    if (z > mx[2]) mx[2] = z;
    return i;
  }

  /** triangle oriented so its face normal points along (wx, wy, wz); degenerate ones are dropped */
  tri(a: number, b: number, c: number, wx: number, wy: number, wz: number): void {
    const P = this.pos;
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const ax = P[a3], ay = P[a3 + 1], az = P[a3 + 2];
    const ux = P[b3] - ax, uy = P[b3 + 1] - ay, uz = P[b3 + 2] - az;
    const vx = P[c3] - ax, vy = P[c3 + 1] - ay, vz = P[c3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-10) return;
    if (this.ni + 3 > this.idx.length) {
      const n = new Uint32Array(this.idx.length * 2);
      n.set(this.idx);
      this.idx = n;
    }
    const I = this.idx;
    I[this.ni++] = a;
    if (nx * wx + ny * wy + nz * wz >= 0) {
      I[this.ni++] = b;
      I[this.ni++] = c;
    } else {
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
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, nv * 3), 3, true));
    g.setAttribute('aRoad', new THREE.BufferAttribute(this.road.slice(0, nv * 4), 4));
    const idx = nv < 65535 ? new Uint16Array(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    // bounds tracked while emitting (no extra pass over the vertices)
    const mn = this.bmin, mx = this.bmax;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(mn[0], mn[1], mn[2]), new THREE.Vector3(mx[0], mx[1], mx[2]));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
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
  private pcx = -1;
  private pcy = -1;
  /** bilinear patch of a plain cell: h = h0 + ha·fx + hb·fz + hc·fx·fz */
  private h0 = 0;
  private ha = 0;
  private hb = 0;
  private hc = 0;

  constructor(readonly world: World, readonly hf: RoadHeightField) {}

  set(cx: number, cy: number, k: number): this {
    this.k = k & 3;
    if (cx === this.pcx && cy === this.pcy) return this;
    this.cx = this.pcx = cx;
    this.cy = this.pcy = cy;
    this.ox = cx * CELL;
    this.oz = cy * CELL;
    this.bridge = this.world.isBridge(cx, cy);
    this.raised = this.hf.isRaised(cx, cy);
    if (!this.raised) {
      // plain terrain-following cell: cache the bilinear patch (fast base/normal)
      const w = this.world;
      const h00 = w.vertexHeight(cx, cy), h10 = w.vertexHeight(cx + 1, cy), h01 = w.vertexHeight(cx, cy + 1), h11 = w.vertexHeight(cx + 1, cy + 1);
      this.h0 = h00;
      this.ha = h10 - h00;
      this.hb = h01 - h00;
      this.hc = h00 - h10 - h01 + h11;
    }
    return this;
  }

  /** forget the cached cell (call when heights / roads may have changed) */
  invalidate(): void {
    this.pcx = this.pcy = -1;
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
    if (!this.raised) {
      const fx = (wx - this.ox) / CELL, fz = (wz - this.oz) / CELL;
      if (fx >= 0 && fx <= 1 && fz >= 0 && fz <= 1) return this.h0 + this.ha * fx + this.hb * fz + this.hc * fx * fz;
    }
    return this.hf.cellSurface(this.cx, this.cy, wx, wz) - ROAD_LIFT;
  }

  terrain(wx: number, wz: number): number {
    return this.world.heightAt(wx, wz);
  }

  normal(wx: number, wz: number): V3 {
    if (!this.raised) {
      const fx = (wx - this.ox) / CELL, fz = (wz - this.oz) / CELL;
      if (fx >= 0 && fx <= 1 && fz >= 0 && fz <= 1) {
        const gx = (this.ha + this.hc * fz) / CELL, gz = (this.hb + this.hc * fx) / CELL;
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        const n = this.n;
        n.x = -gx * inv;
        n.y = inv;
        n.z = -gz * inv;
        return n;
      }
    }
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

// ── scratch storage (reused across calls: no per-cell garbage) ─────────────
let sbx = new Float64Array(256), sbz = new Float64Array(256), sbh = new Float64Array(256), sbn = new Float64Array(768);
let sRowA = new Int32Array(64), sRowB = new Int32Array(64);
const lat = [0, 0];

function ensureScratch(n: number): void {
  if (sbx.length >= n) return;
  const m = Math.max(n, sbx.length * 2);
  sbx = new Float64Array(m);
  sbz = new Float64Array(m);
  sbh = new Float64Array(m);
  sbn = new Float64Array(m * 3);
}

/** unit lateral direction (world x, z) of a mapper at (s, tau) → `lat` */
function latDir(fr: Frame, map: Mapper, s: number, tau: number): void {
  map(s - 0.05, tau, tmp);
  map(s + 0.05, tau, tmp2);
  const du = tmp2.u - tmp.u, dv = tmp2.v - tmp.v;
  let dx: number, dz: number;
  switch (fr.k) {
    case 0: dx = du; dz = dv; break;
    case 1: dx = -dv; dz = du; break;
    case 2: dx = -du; dz = -dv; break;
    default: dx = dv; dz = -du; break;
  }
  const l = Math.hypot(dx, dz) || 1;
  lat[0] = dx / l;
  lat[1] = dz / l;
}

/** vertices of one strip row of layer `li` (ns subdivisions) → out[0..ns] */
function stripRow(buf: GeoBuf, fr: Frame, rows: Row[], map: Mapper, nb: number, li: number, ns: number, j: number, c: number, out: Int32Array): void {
  const row = rows[j];
  const s0 = row.b[li], s1 = row.b[li + 1];
  const l0 = row.la[li], l1 = row.lb[li];
  const slope = s1 - s0 > 1e-4 ? (l1 - l0) / (s1 - s0) : 0;
  const tilted = Math.abs(slope) > 1e-3;
  if (tilted) latDir(fr, map, (s0 + s1) / 2, row.tau);
  const lx = lat[0], lz = lat[1];
  for (let f = 0; f <= ns; f++) {
    const a = f / ns;
    let x: number, z: number, h: number, nx: number, ny: number, nz: number;
    if (f === 0 || f === ns) {
      const o = j * nb + (f === 0 ? li : li + 1);
      x = sbx[o];
      z = sbz[o];
      h = sbh[o];
      nx = sbn[o * 3];
      ny = sbn[o * 3 + 1];
      nz = sbn[o * 3 + 2];
    } else {
      map(s0 + (s1 - s0) * a, row.tau, tmp);
      fr.w(tmp.u, tmp.v);
      x = fr.X;
      z = fr.Z;
      h = fr.base(x, z);
      const n = fr.normal(x, z);
      nx = n.x;
      ny = n.y;
      nz = n.z;
    }
    if (tilted) {
      nx -= lx * slope * ny;
      nz -= lz * slope * ny;
    }
    out[f] = buf.vtx(x, h + l0 + (l1 - l0) * a, z, nx, ny, nz, s0 + (s1 - s0) * a, row.tau, row.hw, c);
  }
}

/** Emit a row-based section: layer strips, walls between layers of different lift, skirts, deck bottom. */
export function emitRows(buf: GeoBuf, fr: Frame, sec: Section, rows: Row[], map: Mapper, opts: RowOpts): void {
  const R = rows.length;
  const L = sec.kind.length;
  if (R < 2) return;
  // boundary data per row: world x, z, base, normal
  const nb = L + 1;
  ensureScratch(R * nb);
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    for (let i = 0; i < nb; i++) {
      map(row.b[i], row.tau, tmp);
      fr.w(tmp.u, tmp.v);
      const o = j * nb + i;
      sbx[o] = fr.X;
      sbz[o] = fr.Z;
      sbh[o] = fr.base(fr.X, fr.Z);
      const n = fr.normal(fr.X, fr.Z);
      sbn[o * 3] = n.x;
      sbn[o * 3 + 1] = n.y;
      sbn[o * 3 + 2] = n.z;
    }
  }

  // ── layer strips ──
  for (let li = 0; li < L; li++) {
    let any = false;
    for (let j = 0; j < R; j++) if (rows[j].b[li + 1] - rows[j].b[li] > 1e-4) any = true;
    if (!any) continue;
    const ns = Math.max(1, sec.split[li]);
    if (sRowA.length <= ns) {
      sRowA = new Int32Array(ns * 2 + 2);
      sRowB = new Int32Array(ns * 2 + 2);
    }
    const kind = sec.kind[li], style = sec.style[li], flags = sec.flags[li];
    let prevCode = NaN;
    let prev = sRowA, next = sRowB;
    for (let j = 0; j < R - 1; j++) {
      const c = code(kind, style, flags & rows[j].mask);
      if (c !== prevCode) stripRow(buf, fr, rows, map, nb, li, ns, j, c, prev);
      stripRow(buf, fr, rows, map, nb, li, ns, j + 1, c, next);
      for (let f = 0; f < ns; f++) buf.quadUp(prev[f], prev[f + 1], next[f + 1], next[f]);
      const t = prev;
      prev = next;
      next = t;
      prevCode = c;
    }
  }

  // ── walls between layers of different lift ──
  for (let i = 1; i < L; i++) {
    let any = false;
    for (let j = 0; j < R; j++) if (Math.abs(rows[j].lb[i - 1] - rows[j].la[i]) > 0.004) any = true;
    if (!any) continue;
    const c = code(sec.wall[i], sec.style[i], 0);
    // a wall is only real where the raised layer has width (a zero-width median
    // must not leave a curb face in the middle of the road); rows next to a
    // row with width keep theirs so rounded tips close properly
    const hiW = (j: number): number => {
      const row = rows[j];
      const li = row.lb[i - 1] < row.la[i] ? i : i - 1;
      return row.b[li + 1] - row.b[li];
    };
    let pa = -1, pb = -1, pSign = 0;
    for (let j = 0; j < R; j++) {
      const row = rows[j];
      const o = j * nb + i;
      if (hiW(j) < 1e-3 && (j === 0 || hiW(j - 1) < 1e-3) && (j === R - 1 || hiW(j + 1) < 1e-3)) {
        pSign = 0;
        continue;
      }
      const lo = row.lb[i - 1], hi = row.la[i];
      // the wall faces the lower side: toward -s if the left layer is lower
      const sign = lo < hi ? -1 : 1;
      latDir(fr, map, row.b[i], row.tau);
      const nx = lat[0] * sign, nz = lat[1] * sign;
      const a = buf.vtx(sbx[o], sbh[o] + Math.min(lo, hi), sbz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      const b = buf.vtx(sbx[o], sbh[o] + Math.max(lo, hi), sbz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
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
      latDir(fr, map, row.b[i], row.tau);
      const nx = lat[0] * sign, nz = lat[1] * sign;
      const y1 = sbh[o] + row[top][li];
      const y0 = fr.skirt(sbx[o], sbz[o], sbh[o]);
      const a = buf.vtx(sbx[o], Math.min(y0, y1 - 0.02), sbz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
      const b = buf.vtx(sbx[o], y1, sbz[o], nx, 0, nz, row.b[i], row.tau, row.hw, c);
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
    let p0 = -1, p1 = -1;
    for (let j = 0; j < R; j++) {
      const oa = j * nb, ob = j * nb + L;
      const c0 = buf.vtx(sbx[oa], sbh[oa] - DECK_THICKNESS, sbz[oa], 0, -1, 0, 0, 0, 0, c);
      const c1 = buf.vtx(sbx[ob], sbh[ob] - DECK_THICKNESS, sbz[ob], 0, -1, 0, 0, 0, 0, c);
      if (j > 0) buf.quad(p0, p1, c1, c0, 0, -1, 0);
      p0 = c0;
      p1 = c1;
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
  if (sRowA.length < E * 2) {
    sRowA = new Int32Array(E * 4);
    sRowB = new Int32Array(E * 4);
  }
  let prev = sRowA, cur = sRowB;
  for (let j = 0; j <= seg; j++) {
    const tau = tau0 + ((tau1 - tau0) * j) / seg;
    latDir(fr, map, s0 + 0.05, tau);
    const Lx = lat[0], Lz = lat[1];
    map(s0, tau, tmp);
    fr.w(tmp.u, tmp.v);
    const cx = fr.X, cz = fr.Z;
    const base = fr.base(cx, cz) + lift;
    for (let e = 0; e < E; e++) {
      const p0 = prof[e], p1 = prof[(e + 1) % P];
      // edge normal in (lateral, up) space: rotate edge direction by -90°
      const ed = p1[0] - p0[0], eh = p1[1] - p0[1];
      const el = Math.hypot(ed, eh) || 1;
      const nd = eh / el, nh = -ed / el;
      cur[e * 2] = buf.vtx(cx + Lx * p0[0], base + p0[1], cz + Lz * p0[0], Lx * nd, nh, Lz * nd, s0 + p0[0], tau, 0, c);
      cur[e * 2 + 1] = buf.vtx(cx + Lx * p1[0], base + p1[1], cz + Lz * p1[0], Lx * nd, nh, Lz * nd, s0 + p1[0], tau, 0, c);
    }
    if (j > 0) {
      const N = buf.nor;
      for (let e = 0; e < E; e++) {
        const a = prev[e * 2], b = prev[e * 2 + 1], cc = cur[e * 2 + 1], d = cur[e * 2];
        // orientation from the stored normal of a
        buf.quad(a, b, cc, d, N[a * 3], N[a * 3 + 1], N[a * 3 + 2]);
      }
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
}

const BOX_A = [-1, 1, 1, -1];
const BOX_B = [-1, -1, 1, 1];
const boxTop = [0, 0, 0, 0];

/**
 * Axis-aligned box in a local frame: center (wx, wz) world, yaw (radians,
 * model +X → world (cos, −sin)), half sizes hx (along yaw) / hz, y range.
 * Emits top + sides (optionally bottom; `ends` = false skips the two short
 * ±X end faces, e.g. for sleepers whose ends are buried in ballast).
 */
export function box(buf: GeoBuf, wx: number, wz: number, yaw: number, hx: number, hz: number, y0: number, y1: number, kind: Kind, bottom = false, ends = true): void {
  const c = code(kind, 0, 0);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  // local axes in world: X' = (ca, -sa), Z' = (sa, ca)
  for (let k = 0; k < 4; k++) {
    const a = BOX_A[k] * hx, b = BOX_B[k] * hz;
    boxTop[k] = buf.vtx(wx + ca * a + sa * b, y1, wz - sa * a + ca * b, 0, 1, 0, 0, 0, 0, c);
  }
  buf.quad(boxTop[0], boxTop[1], boxTop[2], boxTop[3], 0, 1, 0);
  if (bottom) {
    const b0 = buf.nv;
    for (let k = 0; k < 4; k++) {
      const a = BOX_A[k] * hx, b = BOX_B[k] * hz;
      buf.vtx(wx + ca * a + sa * b, y0, wz - sa * a + ca * b, 0, -1, 0, 0, 0, 0, c);
    }
    buf.quad(b0, b0 + 1, b0 + 2, b0 + 3, 0, -1, 0);
  }
  for (let e = 0; e < 4; e++) {
    // faces: 0 = -Z', 1 = +X', 2 = +Z', 3 = -X'
    if (!ends && (e & 1)) continue;
    const e1 = (e + 1) & 3;
    const a0 = BOX_A[e] * hx, b0 = BOX_B[e] * hz, a1 = BOX_A[e1] * hx, b1 = BOX_B[e1] * hz;
    const ma = e === 1 ? 1 : e === 3 ? -1 : 0, mb = e === 0 ? -1 : e === 2 ? 1 : 0;
    const nx = ca * ma + sa * mb, nz = -sa * ma + ca * mb;
    const x0 = wx + ca * a0 + sa * b0, z0 = wz - sa * a0 + ca * b0;
    const x1 = wx + ca * a1 + sa * b1, z1 = wz - sa * a1 + ca * b1;
    const i0 = buf.vtx(x0, y0, z0, nx, 0, nz, 0, 0, 0, c);
    const i1 = buf.vtx(x1, y0, z1, nx, 0, nz, 0, 0, 0, c);
    const i2 = buf.vtx(x1, y1, z1, nx, 0, nz, 0, 0, 0, c);
    const i3 = buf.vtx(x0, y1, z0, nx, 0, nz, 0, 0, 0, c);
    buf.quad(i0, i1, i2, i3, nx, 0, nz);
  }
}

/** vertical n-gon prism (columns, piers) with smooth side normals and a top cap */
export function prism(buf: GeoBuf, wx: number, wz: number, r: number, y0: number, y1: number, sides: number, kind: Kind): void {
  const c = code(kind, 0, 0);
  const base = buf.nv;
  // per i: lo, hi (smooth side normals), then the cap ring
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const nx = Math.cos(a), nz = Math.sin(a);
    buf.vtx(wx + nx * r, y0, wz + nz * r, nx, 0, nz, 0, 0, 0, c);
    buf.vtx(wx + nx * r, y1, wz + nz * r, nx, 0, nz, 0, 0, 0, c);
  }
  const capBase = buf.nv;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    buf.vtx(wx + Math.cos(a) * r, y1, wz + Math.sin(a) * r, 0, 1, 0, 0, 0, 0, c);
  }
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    const lo = base + i * 2, lo1 = base + (i + 1) * 2;
    buf.quad(lo, lo1, lo1 + 1, lo + 1, Math.cos(a), 0, Math.sin(a));
  }
  for (let i = 1; i < sides - 1; i++) buf.tri(capBase, capBase + i, capBase + i + 1, 0, 1, 0);
}
