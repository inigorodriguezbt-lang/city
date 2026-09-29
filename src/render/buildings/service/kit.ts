// Kit — higher-level procedural modelling toolkit for service/landmark models,
// built on the shared ModelBuilder. Adds smooth surfaces of revolution, pipes,
// beams, vaults, domes, flat paint/paths, lattice structures, building masses
// with style-aware roofs, and animated sub-parts.
import * as THREE from 'three';
import { ModelBuilder, ensureCCW, type ColorLike } from '../ModelBuilder';
import type { MatKey, ModelAnim, ModelContext, ModelResult } from '../types';
import type { RoofShape } from './colors';

export type V3 = [number, number, number];
export type P2 = [number, number];

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _r = new THREE.Vector3();

export interface RevOpts {
  /** cap the last profile point (top) / first (bottom) with a flat disc */
  top?: boolean;
  bottom?: boolean;
  /** elliptical scaling of the radius along X / Z */
  sx?: number;
  sz?: number;
  /** partial revolution (radians, 0 = +X, towards +Z) */
  a0?: number;
  a1?: number;
  /** angle (deg) above which neighbouring profile edges get a hard crease */
  crease?: number;
  /** profile is a closed loop (torus) */
  closed?: boolean;
  /** v = arc length along the profile instead of the local height */
  vArc?: boolean;
  /** flip faces to point inwards (inner walls of bowls, towers) */
  inside?: boolean;
}

export interface BlockOpts {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y0?: number;
  wall: MatKey;
  color: ColorLike;
  roof?: RoofShape | 'none';
  roofMat?: MatKey;
  roofColor?: ColorLike;
  /** roof rise for pitched roofs (default from footprint) */
  rise?: number;
  /** parapet height on flat roofs (0 = none) */
  parapet?: number;
  parapetColor?: ColorLike;
  /** cornice band colour (omit for none) */
  cornice?: ColorLike;
  /** add rooftop HVAC clutter on flat roofs */
  hvac?: boolean;
  overhang?: number;
}

export class Kit extends ModelBuilder {
  readonly anims: ModelAnim[] = [];
  /** accumulated transform, mirrored from ModelBuilder's private stack */
  readonly cur = new THREE.Matrix4();
  private curStack: THREE.Matrix4[] = [];

  constructor(readonly ctx: ModelContext) {
    super();
  }

  override push(m: THREE.Matrix4): this {
    this.curStack.push(this.cur.clone());
    this.cur.multiply(m);
    return super.push(m);
  }
  override pop(): this {
    const m = this.curStack.pop();
    if (m) this.cur.copy(m);
    return super.pop();
  }

  // ── detail helpers ─────────────────────────────────────────────────────
  get W(): number {
    return this.ctx.width;
  }
  get D(): number {
    return this.ctx.depth;
  }
  get lo(): boolean {
    return this.ctx.detail === 'low';
  }
  get hi(): boolean {
    return this.ctx.detail === 'high';
  }
  /** segment count scaled by detail level */
  seg(n: number): number {
    if (this.ctx.detail === 'high') return n;
    if (this.ctx.detail === 'medium') return Math.max(6, Math.round(n * 0.75));
    return Math.max(5, Math.round(n * 0.5));
  }
  rnd(): number {
    return this.ctx.rng.next();
  }
  range(a: number, b: number): number {
    return this.ctx.rng.range(a, b);
  }

  /** run `fn` with a translated/rotated frame */
  at(x: number, y: number, z: number, rotY: number, fn: () => void, scale = 1): this {
    this.pushTRS(x, y, z, rotY, scale);
    fn();
    this.pop();
    return this;
  }

  finish(height: number): ModelResult {
    return { parts: this.build(), lights: this.lights, anims: this.anims, emitters: this.emitters, height };
  }

  // ── animation ──────────────────────────────────────────────────────────
  /** Build an animated sub-part in the CURRENT frame. Geometry, pivot and
   *  axis are converted to model-local space. One ModelAnim per material. */
  anim(pivot: V3, axis: V3, speed: number, build: (k: Kit) => void): this {
    const sub = new Kit(this.ctx);
    build(sub);
    const m = this.cur;
    const piv = new THREE.Vector3(...pivot).applyMatrix4(m);
    const ax = new THREE.Vector3(...axis).transformDirection(m);
    for (const part of sub.build()) {
      part.geometry.applyMatrix4(m);
      part.geometry.computeBoundingSphere();
      this.anims.push({ part, pivot: [piv.x, piv.y, piv.z], axis: [ax.x, ax.y, ax.z], speed });
    }
    // lights/emitters of the sub-kit are static (placed at their rest pose)
    for (const l of sub.lights) {
      _p.set(l.x, l.y, l.z).applyMatrix4(m);
      this.lights.push({ ...l, x: _p.x, y: _p.y, z: _p.z });
    }
    return this;
  }

  // ── smooth surfaces ────────────────────────────────────────────────────
  /** Surface of revolution around the local Y axis through (cx, y0, cz).
   *  prof = [radius, height][] from bottom to top (outer surface). */
  rev(mat: MatKey, cx: number, y0: number, cz: number, prof: P2[], color: ColorLike, segs = 16, o: RevOpts = {}): this {
    const n = prof.length;
    if (n < 2) return this;
    const sx = o.sx ?? 1, sz = o.sz ?? 1;
    const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
    const creaseCos = Math.cos(((o.crease ?? 38) * Math.PI) / 180);
    const closed = !!o.closed;
    const flip = o.inside ? -1 : 1;
    const ne = n - 1;
    const en: P2[] = [];
    for (let j = 0; j < ne; j++) {
      const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1];
      const l = Math.hypot(dr, dy) || 1;
      en.push([(dy / l) * flip, (-dr / l) * flip]);
    }
    const blend = (a: P2, b: P2): P2 => {
      if (a[0] * b[0] + a[1] * b[1] < creaseCos) return b;
      const x = a[0] + b[0], y = a[1] + b[1];
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    const nS: P2[] = [], nE: P2[] = [];
    for (let j = 0; j < ne; j++) {
      const prev = j > 0 ? en[j - 1] : closed ? en[ne - 1] : null;
      const next = j < ne - 1 ? en[j + 1] : closed ? en[0] : null;
      nS.push(prev ? blend(prev, en[j]) : en[j]);
      const e = next ? blend(next, en[j]) : en[j];
      nE.push(e);
    }
    // arc-length v
    const arc: number[] = [0];
    for (let j = 1; j < n; j++) arc.push(arc[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));

    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [];
    const P = (t: number, r: number, y: number): V3 => [cx + Math.cos(t) * r * sx, y0 + y, cz + Math.sin(t) * r * sz];
    const N = (t: number, nn: P2): V3 => {
      const x = (Math.cos(t) * nn[0]) / sx, y = nn[1], z = (Math.sin(t) * nn[0]) / sz;
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    const pushTri = (a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, ua: P2, ub: P2, uc: P2): void => {
      _p.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _q.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _r.crossVectors(_p, _q);
      if (_r.lengthSq() < 1e-14) return;
      const dot = _r.x * (na[0] + nb[0] + nc[0]) + _r.y * (na[1] + nb[1] + nc[1]) + _r.z * (na[2] + nb[2] + nc[2]);
      if (dot < 0) {
        pos.push(...a, ...c, ...b);
        nrm.push(...na, ...nc, ...nb);
        uvs.push(...ua, ...uc, ...ub);
      } else {
        pos.push(...a, ...b, ...c);
        nrm.push(...na, ...nb, ...nc);
        uvs.push(...ua, ...ub, ...uc);
      }
    };
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segs, t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      for (let j = 0; j < ne; j++) {
        const [r0, h0] = prof[j], [r1, h1] = prof[j + 1];
        if (r0 < 1e-5 && r1 < 1e-5) continue;
        const p00 = P(t0, r0, h0), p10 = P(t1, r0, h0), p11 = P(t1, r1, h1), p01 = P(t0, r1, h1);
        const n00 = N(t0, nS[j]), n10 = N(t1, nS[j]), n11 = N(t1, nE[j]), n01 = N(t0, nE[j]);
        const v0 = o.vArc ? arc[j] : y0 + h0, v1 = o.vArc ? arc[j + 1] : y0 + h1;
        const u00 = (t0 - a0) * r0, u10 = (t1 - a0) * r0, u11 = (t1 - a0) * r1, u01 = (t0 - a0) * r1;
        if (r0 > 1e-5) pushTri(p00, p10, p11, n00, n10, n11, [u00, v0], [u10, v0], [u11, v1]);
        if (r1 > 1e-5) pushTri(p00, p11, p01, n00, n11, n01, [u00, v0], [u11, v1], [u01, v1]);
        else pushTri(p00, p10, p11, n00, n10, n11, [u00, v0], [u10, v0], [u11, v1]);
      }
      if (o.top && prof[n - 1][0] > 1e-5) {
        const [r, h] = prof[n - 1];
        const up: V3 = [0, flip, 0];
        pushTri([cx, y0 + h, cz], P(t0, r, h), P(t1, r, h), up, up, up, [cx, -cz], [cx + Math.cos(t0) * r, -cz - Math.sin(t0) * r], [cx + Math.cos(t1) * r, -cz - Math.sin(t1) * r]);
      }
      if (o.bottom && prof[0][0] > 1e-5) {
        const [r, h] = prof[0];
        const dn: V3 = [0, -flip, 0];
        pushTri([cx, y0 + h, cz], P(t0, r, h), P(t1, r, h), dn, dn, dn, [cx, cz], [cx + Math.cos(t0) * r, cz], [cx + Math.cos(t1) * r, cz]);
      }
    }
    return this.emitArrays(mat, pos, nrm, uvs, color);
  }

  /** push raw arrays through addGeometry (applies the transform stack) */
  emitArrays(mat: MatKey, pos: number[], nrm: number[], uvs: number[], color: ColorLike): this {
    if (!pos.length) return this;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.addGeometry(mat, g, color);
    g.dispose();
    return this;
  }

  /** smooth vertical cylinder (optionally tapered) */
  cyl(mat: MatKey, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, color: ColorLike, segs = 14, top = true, bottom = false): this {
    return this.rev(mat, cx, y0, cz, [[r0, 0], [r1, h]], color, segs, { top, bottom });
  }

  /** hemisphere / spherical cap dome (r, height scale hy) */
  dome(mat: MatKey, cx: number, y0: number, cz: number, r: number, color: ColorLike, segs = 18, hy = 1, rings = 7, frac = 1): this {
    const prof: P2[] = [];
    for (let i = 0; i <= rings; i++) {
      const a = (i / rings) * (Math.PI / 2) * frac;
      prof.push([Math.cos(a) * r, Math.sin(a) * r * hy]);
    }
    if (frac >= 0.999) prof[prof.length - 1][0] = 0;
    return this.rev(mat, cx, y0, cz, prof, color, segs, { top: frac < 0.999, crease: 80 });
  }

  /** full sphere / ellipsoid */
  ball(mat: MatKey, cx: number, cy: number, cz: number, r: number, color: ColorLike, segs = 14, rings = 9, sy = 1, sxz = 1): this {
    const prof: P2[] = [];
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (i / rings) * Math.PI;
      prof.push([Math.max(0, Math.cos(a) * r), Math.sin(a) * r * sy]);
    }
    prof[0][0] = 0;
    prof[rings][0] = 0;
    return this.rev(mat, cx, cy, cz, prof, color, segs, { crease: 89, sx: sxz, sz: sxz });
  }

  /** torus lying flat (axis = Y) */
  torus(mat: MatKey, cx: number, cy: number, cz: number, R: number, r: number, color: ColorLike, segs = 24, tube = 8): this {
    const prof: P2[] = [];
    for (let i = 0; i <= tube; i++) {
      const a = -Math.PI / 2 + (i / tube) * Math.PI * 2;
      prof.push([R + Math.cos(a) * r, Math.sin(a) * r]);
    }
    return this.rev(mat, cx, cy, cz, prof, color, segs, { closed: true, crease: 89, vArc: true });
  }

  // ── oriented primitives ────────────────────────────────────────────────
  /** frame whose +Y points from a to b, origin at a; returns length */
  private pushAxis(a: V3, b: V3): number {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-5) return 0;
    d.divideScalar(len);
    // keep a stable roll: X' horizontal where possible
    const x = new THREE.Vector3().crossVectors(d, UP);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, d).normalize();
    const m = new THREE.Matrix4().makeBasis(x, d, z).setPosition(a[0], a[1], a[2]);
    this.push(m);
    return len;
  }

  /** round pipe between two points */
  pipe(mat: MatKey, a: V3, b: V3, r: number, color: ColorLike, segs = 8, caps = false): this {
    const len = this.pushAxis(a, b);
    if (len > 0) {
      this.rev(mat, 0, 0, 0, [[r, 0], [r, len]], color, segs, { top: caps, bottom: caps, vArc: true, crease: 89 });
      this.pop();
    }
    return this;
  }

  /** square-section beam between two points (w across, t thick) */
  beam(mat: MatKey, a: V3, b: V3, w: number, t: number, color: ColorLike, ends = false): this {
    const len = this.pushAxis(a, b);
    if (len > 0) {
      this.box(mat, 0, 0, 0, w, len, t, color, { top: ends ? mat : false, bottom: ends });
      this.pop();
    }
    return this;
  }

  /** polyline of pipes / cables */
  polyPipe(mat: MatKey, pts: V3[], r: number, color: ColorLike, segs = 6): this {
    for (let i = 0; i < pts.length - 1; i++) this.pipe(mat, pts[i], pts[i + 1], r, color, segs);
    return this;
  }

  /** sagging cable between two points */
  cable(mat: MatKey, a: V3, b: V3, sag: number, r: number, color: ColorLike, n = 6): this {
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
    }
    return this.polyPipe(mat, pts, r, color, 4);
  }

  /** rotated box (about Y) */
  rbox(mat: MatKey, cx: number, y0: number, cz: number, w: number, h: number, d: number, rotY: number, color: ColorLike, top: MatKey | false = mat): this {
    this.pushTRS(cx, 0, cz, rotY);
    this.box(mat, 0, y0, 0, w, h, d, color, { top });
    this.pop();
    return this;
  }

  // ── flat ground shapes ─────────────────────────────────────────────────
  /** flat slab with a skirt down into the terrain (hides slopes) */
  slab(mat: MatKey, cx: number, cz: number, w: number, d: number, y: number, color: ColorLike, skirt = 1.5, skirtMat: MatKey = 'concrete', skirtColor: ColorLike = 0x9a968d): this {
    this.box(skirtMat, cx, y - skirt, cz, w, skirt, d, skirtColor, { top: false });
    this.quad(mat, { x: cx - w / 2, y, z: cz + d / 2 }, { x: cx + w / 2, y, z: cz + d / 2 }, { x: cx + w / 2, y, z: cz - d / 2 }, { x: cx - w / 2, y, z: cz - d / 2 }, [[cx - w / 2, -(cz + d / 2)], [cx + w / 2, -(cz + d / 2)], [cx + w / 2, -(cz - d / 2)], [cx - w / 2, -(cz - d / 2)]], color, { x: 0, y: 1, z: 0 });
    return this;
  }

  /** full-footprint lot pad (slightly inset) */
  lot(mat: MatKey, color: ColorLike, inset = 0.25, y = 0.05, skirt = 1.5): this {
    return this.slab(mat, 0, 0, this.W - inset * 2, this.D - inset * 2, y, color, skirt);
  }

  /** flat horizontal rectangle (paint, patches). rotY about its centre. */
  flat(mat: MatKey, cx: number, cz: number, w: number, d: number, y: number, color: ColorLike, rotY = 0): this {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const pt = (lx: number, lz: number): THREE.Vector3Like => ({ x: cx + lx * c + lz * s, y, z: cz - lx * s + lz * c });
    const a = pt(-w / 2, d / 2), b = pt(w / 2, d / 2), cc = pt(w / 2, -d / 2), dd = pt(-w / 2, -d / 2);
    this.quad(mat, a, b, cc, dd, [[a.x, -a.z], [b.x, -b.z], [cc.x, -cc.z], [dd.x, -dd.z]], color, { x: 0, y: 1, z: 0 });
    return this;
  }

  /** flat disc facing up */
  disc(mat: MatKey, cx: number, y: number, cz: number, r: number, color: ColorLike, segs = 20, sx = 1, sz = 1): this {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0 = { x: cx + Math.cos(a0) * r * sx, y, z: cz + Math.sin(a0) * r * sz };
      const p1 = { x: cx + Math.cos(a1) * r * sx, y, z: cz + Math.sin(a1) * r * sz };
      this.tri(mat, { x: cx, y, z: cz }, p0, p1, [cx, -cz], [p0.x, -p0.z], [p1.x, -p1.z], color, { x: 0, y: 1, z: 0 });
    }
    return this;
  }

  /** flat annulus facing up (optionally a partial arc) */
  ring(mat: MatKey, cx: number, y: number, cz: number, r0: number, r1: number, color: ColorLike, segs = 24, a0 = 0, a1 = Math.PI * 2, sx = 1, sz = 1): this {
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segs, t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const A = { x: cx + Math.cos(t0) * r0 * sx, y, z: cz + Math.sin(t0) * r0 * sz };
      const B = { x: cx + Math.cos(t0) * r1 * sx, y, z: cz + Math.sin(t0) * r1 * sz };
      const Cc = { x: cx + Math.cos(t1) * r1 * sx, y, z: cz + Math.sin(t1) * r1 * sz };
      const Dd = { x: cx + Math.cos(t1) * r0 * sx, y, z: cz + Math.sin(t1) * r0 * sz };
      this.quad(mat, A, B, Cc, Dd, [[A.x, -A.z], [B.x, -B.z], [Cc.x, -Cc.z], [Dd.x, -Dd.z]], color, { x: 0, y: 1, z: 0 });
    }
    return this;
  }

  /** polygon (XZ) filled flat at height y */
  poly(mat: MatKey, pts: P2[], y: number, color: ColorLike): this {
    return this.cap(mat, ensureCCW(pts), y, color);
  }

  /** irregular organic blob (ponds, flower beds, lawns) */
  blob(mat: MatKey, cx: number, cz: number, rx: number, rz: number, y: number, color: ColorLike, segs = 16, jit = 0.18, seed = 0): this {
    return this.poly(mat, blobPts(cx, cz, rx, rz, segs, jit, seed), y, color);
  }

  /** flat ribbon along a polyline (paths, painted lines, tracks) */
  ribbon(mat: MatKey, pts: P2[], width: number, y: number, color: ColorLike, closed = false): this {
    const n = pts.length;
    if (n < 2) return this;
    const hw = width / 2;
    const off: P2[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const cur = pts[i];
      let d0x = cur[0] - prev[0], d0z = cur[1] - prev[1];
      let d1x = next[0] - cur[0], d1z = next[1] - cur[1];
      const l0 = Math.hypot(d0x, d0z), l1 = Math.hypot(d1x, d1z);
      if (l0 < 1e-6) { d0x = d1x; d0z = d1z; } else { d0x /= l0; d0z /= l0; }
      if (l1 < 1e-6) { d1x = d0x; d1z = d0z; } else { d1x /= l1; d1z /= l1; }
      let tx = d0x + d1x, tz = d0z + d1z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      // normal (right side) and miter length
      const nx = -tz, nz = tx;
      const cosH = Math.max(0.35, nx * -d1z + nz * d1x);
      off.push([(nx * hw) / cosH, (nz * hw) / cosH]);
    }
    let v = 0;
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const a = pts[i], b = pts[j];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const L = { x: a[0] + off[i][0], y, z: a[1] + off[i][1] };
      const R = { x: a[0] - off[i][0], y, z: a[1] - off[i][1] };
      const L2 = { x: b[0] + off[j][0], y, z: b[1] + off[j][1] };
      const R2 = { x: b[0] - off[j][0], y, z: b[1] - off[j][1] };
      this.quad(mat, R, L, L2, R2, [[0, v], [width, v], [width, v + len], [0, v + len]], color, { x: 0, y: 1, z: 0 });
      v += len;
    }
    return this;
  }

  /** painted line segment on the ground */
  paint(x0: number, z0: number, x1: number, z1: number, w: number, y: number, color: ColorLike = 0xf4f4f0, mat: MatKey = 'plain'): this {
    return this.ribbon(mat, [[x0, z0], [x1, z1]], w, y, color);
  }

  /** painted rectangle outline */
  paintRect(cx: number, cz: number, w: number, d: number, lw: number, y: number, color: ColorLike = 0xf4f4f0): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    this.paint(x0 - lw / 2, z0, x1 + lw / 2, z0, lw, y, color);
    this.paint(x0 - lw / 2, z1, x1 + lw / 2, z1, lw, y, color);
    this.paint(x0, z0, x0, z1, lw, y, color);
    this.paint(x1, z0, x1, z1, lw, y, color);
    return this;
  }

  // ── vaults & shells ────────────────────────────────────────────────────
  /** barrel vault: half-ellipse cross-section of `span` (across) and `rise`,
   *  running `len` along X (alongX) or Z. Base at y0. Optional end walls. */
  barrel(mat: MatKey, cx: number, y0: number, cz: number, span: number, len: number, rise: number, color: ColorLike, segs = 12, alongX = true, ends: MatKey | null = null, endColor: ColorLike = color): this {
    this.pushTRS(cx, y0, cz, alongX ? 0 : Math.PI / 2);
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [];
    const a = span / 2, b = rise;
    let arcLen = 0;
    let prevX = -a, prevY = 0;
    for (let i = 0; i < segs; i++) {
      const t0 = Math.PI - (i / segs) * Math.PI, t1 = Math.PI - ((i + 1) / segs) * Math.PI;
      const x0 = Math.cos(t0) * a, y0_ = Math.sin(t0) * b, x1 = Math.cos(t1) * a, y1 = Math.sin(t1) * b;
      const n0 = normEll(x0, y0_, a, b), n1 = normEll(x1, y1, a, b);
      const s0 = arcLen;
      arcLen += Math.hypot(x1 - prevX, y1 - prevY);
      prevX = x1; prevY = y1;
      const hl = len / 2;
      // quad corners: (x, y, z) with the vault running along X → here cross-section in Z
      const A: V3 = [-hl, y0_, x0], B: V3 = [hl, y0_, x0], Cc: V3 = [hl, y1, x1], Dd: V3 = [-hl, y1, x1];
      const nA: V3 = [0, n0[1], n0[0]], nC: V3 = [0, n1[1], n1[0]];
      pos.push(...A, ...Cc, ...B, ...A, ...Dd, ...Cc);
      nrm.push(...nA, ...nC, ...nA, ...nA, ...nC, ...nC);
      uvs.push(-hl, s0, hl, arcLen, hl, s0, -hl, s0, -hl, arcLen, hl, arcLen);
    }
    fixWinding(pos, nrm, uvs);
    this.emitArrays(mat, pos, nrm, uvs, color);
    if (ends) {
      for (const sgn of [-1, 1]) {
        const pts: P2[] = [];
        for (let i = 0; i <= segs; i++) {
          const t = (i / segs) * Math.PI;
          pts.push([Math.cos(t) * a, Math.sin(t) * b]);
        }
        const x = (sgn * len) / 2;
        for (let i = 0; i < segs; i++) {
          this.tri(ends, { x, y: 0, z: 0 }, { x, y: pts[i][1], z: pts[i][0] }, { x, y: pts[i + 1][1], z: pts[i + 1][0] }, [0, 0], [pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]], endColor, { x: sgn, y: 0, z: 0 });
        }
      }
    }
    this.pop();
    return this;
  }

  /** mansard roof: steep lower slopes inset by `inset`, flat top */
  mansard(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, rise: number, inset: number, color: ColorLike, topMat: MatKey = 'roof_flat', topColor: ColorLike = 0x4a4d52): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const i = inset, y1 = y0 + rise;
    const a = { x: x0, y: y0, z: z1 }, b = { x: x1, y: y0, z: z1 }, c = { x: x1, y: y0, z: z0 }, dd = { x: x0, y: y0, z: z0 };
    const A = { x: x0 + i, y: y1, z: z1 - i }, B = { x: x1 - i, y: y1, z: z1 - i }, Cc = { x: x1 - i, y: y1, z: z0 + i }, Dd = { x: x0 + i, y: y1, z: z0 + i };
    const sl = Math.hypot(i, rise);
    this.quad(mat, a, b, B, A, [[x0, 0], [x1, 0], [x1 - i, sl], [x0 + i, sl]], color, { x: 0, y: 0.4, z: 1 });
    this.quad(mat, c, dd, Dd, Cc, [[x1, 0], [x0, 0], [x0 + i, sl], [x1 - i, sl]], color, { x: 0, y: 0.4, z: -1 });
    this.quad(mat, b, c, Cc, B, [[z1, 0], [z0, 0], [z0 + i, sl], [z1 - i, sl]], color, { x: 1, y: 0.4, z: 0 });
    this.quad(mat, dd, a, A, Dd, [[z0, 0], [z1, 0], [z1 - i, sl], [z0 + i, sl]], color, { x: -1, y: 0.4, z: 0 });
    this.quad(topMat, A, B, Cc, Dd, [[A.x, -A.z], [B.x, -B.z], [Cc.x, -Cc.z], [Dd.x, -Dd.z]], topColor, { x: 0, y: 1, z: 0 });
    return this;
  }

  /** pagoda-style roof: hip roof with flared, upturned eaves */
  pagodaRoof(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: ColorLike, flare = 1.6): this {
    // flared skirt
    const x0 = cx - w / 2 - flare, x1 = cx + w / 2 + flare, z0 = cz - d / 2 - flare, z1 = cz + d / 2 + flare;
    const up = flare * 0.35;
    const ix0 = cx - w / 2 + 0.3, ix1 = cx + w / 2 - 0.3, iz0 = cz - d / 2 + 0.3, iz1 = cz + d / 2 - 0.3;
    const yi = y0 + rise * 0.35;
    const o = [{ x: x0, y: y0 + up, z: z1 }, { x: x1, y: y0 + up, z: z1 }, { x: x1, y: y0 + up, z: z0 }, { x: x0, y: y0 + up, z: z0 }];
    const m = [{ x: cx - w / 2, y: y0, z: cz + d / 2 }, { x: cx + w / 2, y: y0, z: cz + d / 2 }, { x: cx + w / 2, y: y0, z: cz - d / 2 }, { x: cx - w / 2, y: y0, z: cz - d / 2 }];
    const inr = [{ x: ix0, y: yi, z: iz1 }, { x: ix1, y: yi, z: iz1 }, { x: ix1, y: yi, z: iz0 }, { x: ix0, y: yi, z: iz0 }];
    const faces = [{ x: 0, y: 1, z: 1 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: -1 }, { x: -1, y: 1, z: 0 }];
    for (let s = 0; s < 4; s++) {
      const a = s, b = (s + 1) % 4;
      this.quad(mat, o[a], o[b], m[b], m[a], [[0, 0], [1, 0], [1, 1], [0, 1]], color, faces[s]);
      this.quad(mat, m[a], m[b], inr[b], inr[a], [[0, 0], [1, 0], [1, 1], [0, 1]], color, faces[s]);
    }
    this.hipRoof(mat, cx, yi, cz, ix1 - ix0, iz1 - iz0, rise * 0.65, color, 0);
    return this;
  }

  // ── lattice structures ─────────────────────────────────────────────────
  /** square lattice tower (4 legs + X-bracing) from half-width b0 at y0 to b1 at y1 */
  lattice(mat: MatKey, cx: number, cz: number, y0: number, y1: number, b0: number, b1: number, color: ColorLike, step = 6, leg = 0.35, brace = 0.14): this {
    const levels = Math.max(1, Math.round((y1 - y0) / step));
    const hw = (t: number) => b0 + (b1 - b0) * t;
    const corner = (t: number, k: number): V3 => {
      const h = hw(t);
      const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1;
      return [cx + sx * h, y0 + (y1 - y0) * t, cz + sz * h];
    };
    for (let k = 0; k < 4; k++) this.beam(mat, corner(0, k), corner(1, k), leg, leg, color);
    for (let l = 0; l < levels; l++) {
      const t0 = l / levels, t1 = (l + 1) / levels;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        this.beam(mat, corner(t1, k), corner(t1, k2), brace, brace, color);
        if (!this.lo) {
          this.beam(mat, corner(t0, k), corner(t1, k2), brace, brace, color);
          this.beam(mat, corner(t0, k2), corner(t1, k), brace, brace, color);
        }
      }
    }
    return this;
  }

  /** straight truss girder between two points (two chords + zigzag) */
  truss(mat: MatKey, a: V3, b: V3, depth: number, color: ColorLike, panels = 6, chord = 0.3, web = 0.14): this {
    const top = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + depth, a[2] + (b[2] - a[2]) * t];
    const bot = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    this.beam(mat, top(0), top(1), chord, chord, color);
    this.beam(mat, bot(0), bot(1), chord, chord, color);
    for (let i = 0; i < panels; i++) {
      const t0 = i / panels, t1 = (i + 1) / panels;
      this.beam(mat, i % 2 ? top(t0) : bot(t0), i % 2 ? bot(t1) : top(t1), web, web, color);
      this.beam(mat, bot(t0), top(t0), web, web, color);
    }
    this.beam(mat, bot(1), top(1), web, web, color);
    return this;
  }

  // ── architecture ───────────────────────────────────────────────────────
  /** building mass with a roof. Returns the roof-top height. */
  block(o: BlockOpts): number {
    const y0 = o.y0 ?? 0;
    const roof = o.roof ?? 'flat';
    const top = y0 + o.h;
    const rc = o.roofColor ?? 0x4a4f57;
    const flatTop = roof === 'flat' || roof === 'none' || roof === 'dome';
    this.box(o.wall, o.x, y0, o.z, o.w, o.h, o.d, o.color, { top: flatTop ? (roof === 'none' ? false : 'roof_flat') : false, topColor: rc });
    let peak = top;
    if (o.cornice !== undefined) this.box('plain', o.x, top - 0.45, o.z, o.w + 0.5, 0.45, o.d + 0.5, o.cornice, { top: flatTop ? false : 'plain' });
    const rise = o.rise ?? Math.min(o.w, o.d) * 0.35;
    const rm = o.roofMat ?? (roof === 'flat' ? 'roof_flat' : 'roof_tile');
    switch (roof) {
      case 'flat':
      case 'dome': {
        const p = o.parapet ?? 0.9;
        if (p > 0) this.parapet(o.x, top, o.z, o.w, o.d, p, o.parapetColor ?? o.color);
        if (o.hvac && !this.lo) this.hvac(o.x, top, o.z, o.w, o.d);
        if (roof === 'dome') {
          const r = Math.min(o.w, o.d) * 0.3;
          this.cyl('plain', o.x, top, o.z, r * 1.05, r * 1.05, r * 0.35, o.cornice ?? o.color, 18);
          this.dome(o.roofMat ?? 'metal', o.x, top + r * 0.35, o.z, r, rc, 18, 1);
          peak = top + r * 1.35;
        }
        break;
      }
      case 'gable':
        this.gableRoof(rm, o.x, top, o.z, o.w, o.d, rise, rc, { overhang: o.overhang ?? 0.5, wallMat: o.wall, wallColor: o.color });
        peak = top + rise;
        break;
      case 'hip':
        this.hipRoof(rm, o.x, top, o.z, o.w, o.d, rise, rc, o.overhang ?? 0.5);
        peak = top + rise;
        break;
      case 'mansard':
        this.mansard(rm, o.x, top, o.z, o.w + 0.4, o.d + 0.4, Math.min(3.4, rise), Math.min(2.2, Math.min(o.w, o.d) * 0.18), rc);
        peak = top + Math.min(3.4, rise);
        break;
      case 'pagoda':
        this.pagodaRoof(rm, o.x, top, o.z, o.w, o.d, rise, rc, Math.min(2.2, Math.min(o.w, o.d) * 0.16));
        peak = top + rise;
        break;
      case 'shed':
        this.shedRoof(rm, o.x, top, o.z, o.w, o.d, Math.min(rise, 3), rc, o.overhang ?? 0.4, o.wall, o.color);
        peak = top + Math.min(rise, 3);
        break;
      case 'none':
        break;
    }
    return peak;
  }

  /** thin parapet wall around a flat roof */
  parapet(cx: number, y: number, cz: number, w: number, d: number, h: number, color: ColorLike, t = 0.3): this {
    const mat: MatKey = 'concrete';
    this.box(mat, cx, y, cz + d / 2 - t / 2, w, h, t, color);
    this.box(mat, cx, y, cz - d / 2 + t / 2, w, h, t, color);
    this.box(mat, cx - w / 2 + t / 2, y, cz, t, h, d - 2 * t, color);
    this.box(mat, cx + w / 2 - t / 2, y, cz, t, h, d - 2 * t, color);
    return this;
  }

  /** rooftop HVAC clutter */
  hvac(cx: number, y: number, cz: number, w: number, d: number, n = 0): this {
    const r = this.ctx.rng;
    const count = n || Math.max(1, Math.min(5, Math.floor((w * d) / 140)));
    for (let i = 0; i < count; i++) {
      const bw = r.range(1.6, 3.4), bd = r.range(1.4, 2.6), bh = r.range(0.9, 1.8);
      const x = cx + r.range(-w / 2 + bw / 2 + 1, w / 2 - bw / 2 - 1);
      const z = cz + r.range(-d / 2 + bd / 2 + 1, d / 2 - bd / 2 - 1);
      this.box('metal', x, y, z, bw, bh, bd, 0xb8bcc0);
      if (r.chance(0.6)) this.cyl('metal', x, y + bh, z, Math.min(bw, bd) * 0.3, Math.min(bw, bd) * 0.3, 0.25, 0x6c7176, 10);
    }
    return this;
  }

  /** glazed entrance on a +Z facing wall at z (door + canopy + step) */
  entrance(x: number, z: number, w: number, h = 3, canopy = true, color: ColorLike = 0x3a4550, canopyColor: ColorLike = 0xd8d8d4): this {
    this.box('glass', x, 0.05, z + 0.06, w, h, 0.14, 0x5d7a90);
    this.box('metal', x, h + 0.05, z + 0.06, w + 0.3, 0.25, 0.2, color);
    this.box('metal', x - w / 2 - 0.1, 0.05, z + 0.06, 0.2, h, 0.2, color);
    this.box('metal', x + w / 2 + 0.1, 0.05, z + 0.06, 0.2, h, 0.2, color);
    if (canopy) {
      this.box('concrete', x, h + 0.4, z + 1.2, w + 1.6, 0.3, 2.4, canopyColor, { bottom: true });
      this.light(x, h + 0.2, z + 1.8, 0xffe2b0, 3, 'lamp');
    }
    this.box('concrete', x, 0, z + 1.1, w + 1.2, 0.08, 2.2, 0xcac5bc);
    return this;
  }

  /** row of columns (colonnade) along X at z */
  colonnade(x0: number, x1: number, z: number, n: number, r: number, h: number, color: ColorLike, y0 = 0, mat: MatKey = 'plain'): this {
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
      this.cyl(mat, x, y0, z, r, r * 0.88, h, color, this.seg(10), false);
      this.box(mat, x, y0, z, r * 2.5, 0.35, r * 2.5, color);
      this.box(mat, x, y0 + h - 0.3, z, r * 2.4, 0.35, r * 2.4, color);
    }
    return this;
  }

  /** stair flight rising towards -Z, front edge at z (for +Z facing entrances) */
  stairs(cx: number, z: number, w: number, rise: number, color: ColorLike, stepH = 0.18, stepD = 0.32, mat: MatKey = 'concrete'): this {
    const n = Math.max(1, Math.round(rise / stepH));
    for (let i = 0; i < n; i++) {
      const d = stepD * (n - i);
      this.box(mat, cx, i * stepH, z - d / 2, w, stepH, d, color);
    }
    return this;
  }

  /** emissive sign panel facing +Z (in the current frame) with a lit glow */
  sign(x: number, y: number, z: number, w: number, h: number, color: ColorLike, glow = 0xffffff, back: ColorLike = 0x2a2d31): this {
    this.box('metal', x, y, z - 0.08, w + 0.2, h + 0.2, 0.16, back);
    this.box('emissive', x, y + 0.1, z + 0.02, w, h, 0.06, color);
    this.light(x, y + h / 2, z + 0.4, glow, Math.max(w, h) * 1.3, 'neon');
    return this;
  }

  /** medical cross glyph (on a plane facing +Z at z) */
  crossGlyph(x: number, y: number, z: number, s: number, color: ColorLike, mat: MatKey = 'emissive'): this {
    this.box(mat, x, y - s / 2, z, s / 3, s, 0.08, color);
    this.box(mat, x, y - s / 6, z, s, s / 3, 0.08, color);
    return this;
  }

  /** letter glyphs made from bars, on a plane facing +Z at z.
   *  Supports A C E H I L M N O P R S T U X i 7 and space. */
  glyph(ch: string, x: number, y: number, z: number, s: number, color: ColorLike, mat: MatKey = 'emissive', t = 0.08): this {
    const b = s * 0.16; // bar thickness
    const h = s, w = s * 0.72;
    const bar = (bx: number, by: number, bw: number, bh: number) => this.box(mat, x + bx, y + by, z, bw, bh, t, color);
    switch (ch) {
      case 'H':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h); bar(0, h / 2 - b / 2, w, b);
        break;
      case 'M':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h);
        this.beam(mat, [x - w / 2 + b, y + h - b * 0.3, z], [x, y + h * 0.3, z], t, b * 0.95, color);
        this.beam(mat, [x + w / 2 - b, y + h - b * 0.3, z], [x, y + h * 0.3, z], t, b * 0.95, color);
        break;
      case 'P':
        bar(-w / 2 + b / 2, 0, b, h); bar(0, h - b, w, b); bar(0, h * 0.45, w, b); bar(w / 2 - b / 2, h * 0.45, b, h * 0.55);
        break;
      case 'T':
        bar(0, 0, b, h); bar(0, h - b, w, b);
        break;
      case 'I':
        bar(0, 0, b, h);
        break;
      case 'i':
        bar(0, 0, b, h * 0.62); bar(0, h * 0.75, b, b);
        break;
      case 'S':
        bar(0, 0, w, b); bar(0, h / 2 - b / 2, w, b); bar(0, h - b, w, b); bar(-w / 2 + b / 2, h / 2, b, h / 2); bar(w / 2 - b / 2, 0, b, h / 2);
        break;
      case 'A':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h); bar(0, h - b, w, b); bar(0, h * 0.45, w, b);
        break;
      case 'E':
        bar(-w / 2 + b / 2, 0, b, h); bar(0, h - b, w, b); bar(-b * 0.4, h / 2 - b / 2, w - b * 0.8, b); bar(0, 0, w, b);
        break;
      case 'L':
        bar(-w / 2 + b / 2, 0, b, h); bar(0, 0, w, b);
        break;
      case 'O':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h); bar(0, h - b, w, b); bar(0, 0, w, b);
        break;
      case 'C':
        bar(-w / 2 + b / 2, 0, b, h); bar(0, h - b, w, b); bar(0, 0, w, b);
        break;
      case 'U':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h); bar(0, 0, w, b);
        break;
      case 'N':
        bar(-w / 2 + b / 2, 0, b, h); bar(w / 2 - b / 2, 0, b, h);
        this.beam(mat, [x - w / 2 + b, y + h - b * 0.4, z], [x + w / 2 - b, y + b * 0.4, z], t, b * 1.05, color);
        break;
      case 'R':
        bar(-w / 2 + b / 2, 0, b, h); bar(0, h - b, w, b); bar(0, h * 0.45, w, b); bar(w / 2 - b / 2, h * 0.45, b, h * 0.55);
        this.beam(mat, [x, y + h * 0.47, z], [x + w / 2 - b / 2, y, z], t, b, color);
        break;
      case 'X':
        this.beam(mat, [x - w / 2 + b / 2, y, z], [x + w / 2 - b / 2, y + h, z], t, b, color);
        this.beam(mat, [x + w / 2 - b / 2, y, z], [x - w / 2 + b / 2, y + h, z], t, b, color);
        break;
      case '7':
        bar(0, h - b, w, b);
        this.beam(mat, [x + w / 2 - b / 2, y + h - b, z], [x - w * 0.15, y, z], t, b * 1.1, color);
        break;
      case ' ':
        break;
      default:
        bar(0, 0, w, h);
    }
    return this;
  }

  /** A centred word of bar glyphs on a +Z facing plane. Returns its width. */
  word(text: string, x: number, y: number, z: number, s: number, color: ColorLike, mat: MatKey = 'emissive', t = 0.08): number {
    const pitch = s * 0.92;
    const total = pitch * text.length - s * 0.2;
    for (let i = 0; i < text.length; i++) this.glyph(text[i], x - total / 2 + s * 0.36 + i * pitch, y, z, s, color, mat, t);
    return total;
  }

  /** Smooth parametric surface P(u, v), u, v ∈ [0, 1] on an (nu × nv) grid.
   *  Normals follow ∂P/∂u × ∂P/∂v (swap the arguments to flip); `both` adds
   *  back faces (thin shells). UVs are in metres (arc length along u and v). */
  surface(mat: MatKey, nu: number, nv: number, fn: (u: number, v: number) => V3, color: ColorLike, both = false): this {
    const P: V3[][] = [];
    for (let i = 0; i <= nu; i++) {
      const row: V3[] = [];
      for (let j = 0; j <= nv; j++) row.push(fn(i / nu, j / nv));
      P.push(row);
    }
    const N: V3[][] = [];
    for (let i = 0; i <= nu; i++) {
      const row: V3[] = [];
      for (let j = 0; j <= nv; j++) {
        const a = P[Math.min(nu, i + 1)][j], b = P[Math.max(0, i - 1)][j];
        const c = P[i][Math.min(nv, j + 1)], d = P[i][Math.max(0, j - 1)];
        _p.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        _q.set(c[0] - d[0], c[1] - d[1], c[2] - d[2]);
        _r.crossVectors(_p, _q);
        if (_r.lengthSq() < 1e-12) _r.set(0, 1, 0);
        _r.normalize();
        row.push([_r.x, _r.y, _r.z]);
      }
      N.push(row);
    }
    // arc-length UVs
    const U: number[][] = [], Vv: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      U.push([]);
      Vv.push([]);
      for (let j = 0; j <= nv; j++) {
        U[i].push(i === 0 ? 0 : U[i - 1][j] + Math.hypot(P[i][j][0] - P[i - 1][j][0], P[i][j][1] - P[i - 1][j][1], P[i][j][2] - P[i - 1][j][2]));
        Vv[i].push(j === 0 ? 0 : Vv[i][j - 1] + Math.hypot(P[i][j][0] - P[i][j - 1][0], P[i][j][1] - P[i][j - 1][1], P[i][j][2] - P[i][j - 1][2]));
      }
    }
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [];
    const put = (i: number, j: number, flip: boolean) => {
      pos.push(...P[i][j]);
      const n = N[i][j];
      nrm.push(flip ? -n[0] : n[0], flip ? -n[1] : n[1], flip ? -n[2] : n[2]);
      uvs.push(U[i][j], Vv[i][j]);
    };
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        // front: (i,j) (i+1,j) (i+1,j+1) — CCW when normal = Pu × Pv
        put(i, j, false); put(i + 1, j, false); put(i + 1, j + 1, false);
        put(i, j, false); put(i + 1, j + 1, false); put(i, j + 1, false);
        if (both) {
          put(i, j, true); put(i + 1, j + 1, true); put(i + 1, j, true);
          put(i, j, true); put(i, j + 1, true); put(i + 1, j + 1, true);
        }
      }
    fixWinding(pos, nrm, uvs);
    return this.emitArrays(mat, pos, nrm, uvs, color);
  }

  /** Square-section lattice column between two arbitrary points (4 chords,
   *  panel rings and X-bracing), tapering from width w0 at a to w1 at b. */
  trussColumn(mat: MatKey, a: V3, b: V3, w0: number, w1: number, color: ColorLike, panels = 4, chord = 0.4, web = 0.16): this {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d.lengthSq() < 1e-8) return this;
    d.normalize();
    const x = new THREE.Vector3().crossVectors(d, UP);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, d).normalize();
    const corner = (t: number, c: number): V3 => {
      const w = (w0 + (w1 - w0) * t) / 2;
      const sx = c === 0 || c === 3 ? -1 : 1, sz = c < 2 ? -1 : 1;
      return [
        a[0] + (b[0] - a[0]) * t + (x.x * sx + z.x * sz) * w,
        a[1] + (b[1] - a[1]) * t + (x.y * sx + z.y * sz) * w,
        a[2] + (b[2] - a[2]) * t + (x.z * sx + z.z * sz) * w,
      ];
    };
    for (let c = 0; c < 4; c++) this.beam(mat, corner(0, c), corner(1, c), chord, chord, color);
    for (let p = 0; p < panels; p++) {
      const t0 = p / panels, t1 = (p + 1) / panels;
      for (let c = 0; c < 4; c++) {
        const c2 = (c + 1) % 4;
        this.beam(mat, corner(t1, c), corner(t1, c2), web, web, color);
        if (!this.lo) this.beam(mat, (p + c) % 2 ? corner(t0, c) : corner(t0, c2), (p + c) % 2 ? corner(t1, c2) : corner(t1, c), web, web, color);
      }
    }
    return this;
  }

  /** flat helipad disc with H marking (on ground or roof at y) */
  helipad(cx: number, y: number, cz: number, r: number, lights = true): this {
    this.cyl('concrete', cx, y, cz, r, r, 0.25, 0x5b5f64, this.seg(24));
    this.ring('plain', cx, y + 0.27, cz, r * 0.78, r * 0.86, 0xf4f4f0, this.seg(24));
    // H painted flat
    const s = r * 0.9, bw = s * 0.14;
    this.flat('emissive', cx - s * 0.28, cz, bw, s * 0.8, y + 0.28, 0xf4f4f0);
    this.flat('emissive', cx + s * 0.28, cz, bw, s * 0.8, y + 0.28, 0xf4f4f0);
    this.flat('emissive', cx, cz, s * 0.56, bw, y + 0.28, 0xf4f4f0);
    if (lights) {
      const n = this.lo ? 4 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.light(cx + Math.cos(a) * r * 0.97, y + 0.4, cz + Math.sin(a) * r * 0.97, 0x9fe86a, 1.2, 'beacon');
      }
    }
    return this;
  }
}

// ── free helpers ─────────────────────────────────────────────────────────
function normEll(x: number, y: number, a: number, b: number): P2 {
  const nx = x / (a * a), ny = y / (b * b);
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}

/** make every triangle's winding agree with its vertex normals (in place) */
function fixWinding(pos: number[], nrm: number[], uvs: number[]): void {
  for (let i = 0; i < pos.length; i += 9) {
    _p.set(pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]);
    _q.set(pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]);
    _r.crossVectors(_p, _q);
    const d = _r.x * (nrm[i] + nrm[i + 3] + nrm[i + 6]) + _r.y * (nrm[i + 1] + nrm[i + 4] + nrm[i + 7]) + _r.z * (nrm[i + 2] + nrm[i + 5] + nrm[i + 8]);
    if (d < 0) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t;
        const s = nrm[i + 3 + k]; nrm[i + 3 + k] = nrm[i + 6 + k]; nrm[i + 6 + k] = s;
      }
      const ui = (i / 9) * 6;
      for (let k = 0; k < 2; k++) {
        const t = uvs[ui + 2 + k]; uvs[ui + 2 + k] = uvs[ui + 4 + k]; uvs[ui + 4 + k] = t;
      }
    }
  }
}

/** deterministic organic outline */
export function blobPts(cx: number, cz: number, rx: number, rz: number, segs = 16, jit = 0.18, seed = 0): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const k = 1 + jit * (Math.sin(a * 3 + seed * 1.7) * 0.6 + Math.sin(a * 5 + seed * 3.1) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k]);
  }
  return pts;
}

/** Catmull-Rom smoothing of a polyline (open) */
export function smoothPath(pts: P2[], per = 6, closed = false): P2[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: P2[] = [];
  const get = (i: number): P2 => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** points on an ellipse */
export function ellipsePts(cx: number, cz: number, rx: number, rz: number, segs: number, a0 = 0, a1 = Math.PI * 2): P2[] {
  const pts: P2[] = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const n = full ? segs : segs + 1;
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

export { ONE };
