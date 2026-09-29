// ModelBuilder — shared low-level geometry toolkit for procedural models.
// Produces non-indexed geometry with position/normal/uv/color, bucketed by
// MatKey, ready for per-chunk merging. Wall UVs are in meters (u along the
// face, v = local height) so window textures line up across parts.
import * as THREE from 'three';
import type { MatKey, ModelEmitter, ModelLight, ModelPart } from './types';

export type ColorLike = number | string | THREE.Color | [number, number, number];

interface Bucket {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _col = new THREE.Color();

export function toColor(c: ColorLike, out = new THREE.Color()): THREE.Color {
  if (c instanceof THREE.Color) return out.copy(c);
  if (Array.isArray(c)) return out.setRGB(c[0], c[1], c[2]);
  return out.set(c as number | string);
}

export class ModelBuilder {
  private buckets = new Map<MatKey, Bucket>();
  private matrix = new THREE.Matrix4();
  private normalMatrix = new THREE.Matrix3();
  private identity = true;
  private stack: THREE.Matrix4[] = [];
  readonly lights: ModelLight[] = [];
  readonly emitters: ModelEmitter[] = [];

  // ── transform stack ────────────────────────────────────────────────────
  /** multiply current transform by m for subsequent primitives */
  push(m: THREE.Matrix4): this {
    this.stack.push(this.matrix.clone());
    this.matrix.multiply(m);
    this.normalMatrix.getNormalMatrix(this.matrix);
    this.identity = false;
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.matrix.copy(m);
    this.normalMatrix.getNormalMatrix(this.matrix);
    this.identity = this.stack.length === 0;
    return this;
  }
  /** convenience: translate + rotateY (+ uniform scale) */
  pushTRS(x: number, y: number, z: number, rotY = 0, scale = 1): this {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
    return this.push(m);
  }

  private bucket(mat: MatKey): Bucket {
    let b = this.buckets.get(mat);
    if (!b) this.buckets.set(mat, (b = { pos: [], nrm: [], uv: [], col: [] }));
    return b;
  }

  private emit(bk: Bucket, p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color): void {
    if (!this.identity) {
      _v.copy(p).applyMatrix4(this.matrix);
      _n.copy(n).applyMatrix3(this.normalMatrix).normalize();
      bk.pos.push(_v.x, _v.y, _v.z);
      bk.nrm.push(_n.x, _n.y, _n.z);
    } else {
      bk.pos.push(p.x, p.y, p.z);
      bk.nrm.push(n.x, n.y, n.z);
    }
    bk.uv.push(u, v);
    bk.col.push(c.r, c.g, c.b);
  }

  // ── primitives ─────────────────────────────────────────────────────────
  /** Triangle. If `facing` is given, winding is fixed so the normal points along it. */
  tri(mat: MatKey, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, uva: [number, number], uvb: [number, number], uvc: [number, number], color: ColorLike, facing?: THREE.Vector3Like): this {
    _a.copy(a as THREE.Vector3);
    _b.copy(b as THREE.Vector3);
    _c.copy(c as THREE.Vector3);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    const n = new THREE.Vector3().crossVectors(_ab, _ac);
    if (n.lengthSq() < 1e-12) return this;
    n.normalize();
    let A = _a.clone(), B = _b.clone(), C = _c.clone();
    let ua = uva, ub = uvb, uc = uvc;
    if (facing && n.dot(facing as THREE.Vector3) < 0) {
      [B, C] = [C, B];
      [ub, uc] = [uc, ub];
      n.negate();
    }
    const col = toColor(color, _col);
    const bk = this.bucket(mat);
    this.emit(bk, A, n, ua[0], ua[1], col);
    this.emit(bk, B, n, ub[0], ub[1], col);
    this.emit(bk, C, n, uc[0], uc[1], col);
    return this;
  }

  /** Quad a,b,c,d counter-clockwise as seen from the side it faces. */
  quad(mat: MatKey, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, uv: [[number, number], [number, number], [number, number], [number, number]], color: ColorLike, facing?: THREE.Vector3Like): this {
    this.tri(mat, a, b, c, uv[0], uv[1], uv[2], color, facing);
    this.tri(mat, a, c, d, uv[0], uv[2], uv[3], color, facing);
    return this;
  }

  /** Vertical wall quad from p→q (XZ), y0..y1. Faces the side given by `outward` (or the right-hand side of p→q). uOffset shifts window pattern. */
  wall(mat: MatKey, px: number, pz: number, qx: number, qz: number, y0: number, y1: number, color: ColorLike, uOffset = 0, outward?: THREE.Vector3Like): this {
    const len = Math.hypot(qx - px, qz - pz);
    const out = outward ?? { x: qz - pz, y: 0, z: -(qx - px) };
    this.quad(
      mat,
      { x: px, y: y0, z: pz }, { x: qx, y: y0, z: qz }, { x: qx, y: y1, z: qz }, { x: px, y: y1, z: pz },
      [[uOffset, y0], [uOffset + len, y0], [uOffset + len, y1], [uOffset, y1]],
      color, out,
    );
    return this;
  }

  /** Axis-aligned box centered at (cx, cz) from y0 to y0+h. Walls get meter UVs.
   *  opts.top: material for the top face (default same as walls, false = none);
   *  opts.bottom: include bottom face. */
  box(mat: MatKey, cx: number, y0: number, cz: number, w: number, h: number, d: number, color: ColorLike, opts: { top?: MatKey | false; topColor?: ColorLike; bottom?: boolean; sides?: { n?: boolean; e?: boolean; s?: boolean; w?: boolean } } = {}): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const s = opts.sides ?? {};
    if (s.s !== false) this.quad(mat, { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, [[0, y0], [w, y0], [w, y1], [0, y1]], color);
    if (s.n !== false) this.quad(mat, { x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z0 }, { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, [[0, y0], [w, y0], [w, y1], [0, y1]], color);
    if (s.e !== false) this.quad(mat, { x: x1, y: y0, z: z1 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, [[0, y0], [d, y0], [d, y1], [0, y1]], color);
    if (s.w !== false) this.quad(mat, { x: x0, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x0, y: y1, z: z1 }, { x: x0, y: y1, z: z0 }, [[0, y0], [d, y0], [d, y1], [0, y1]], color);
    if (opts.top !== false) {
      const tm = opts.top ?? mat;
      this.quad(tm, { x: x0, y: y1, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 }, [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], opts.topColor ?? color);
    }
    if (opts.bottom) this.quad(mat, { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 }, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], color);
    return this;
  }

  /** Extruded prism walls around a polygon (XZ points, any winding), y0..y1. */
  prismWalls(mat: MatKey, pts: [number, number][], y0: number, y1: number, color: ColorLike): this {
    const p = ensureCCW(pts);
    let u = 0;
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[(i + 1) % p.length];
      this.wall(mat, ax, az, bx, bz, y0, y1, color, u);
      u += Math.hypot(bx - ax, bz - az);
    }
    return this;
  }

  /** Flat polygon cap at height y (facing up, or down if `down`). */
  cap(mat: MatKey, pts: [number, number][], y: number, color: ColorLike, down = false): this {
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const facing = { x: 0, y: down ? -1 : 1, z: 0 };
    for (const [i, j, k] of tris) {
      const a = pts[i], b = pts[j], c = pts[k];
      this.tri(mat, { x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, { x: c[0], y, z: c[1] }, [a[0], -a[1]], [b[0], -b[1]], [c[0], -c[1]], color, facing);
    }
    return this;
  }

  /** Extruded polygon block with top cap. */
  prism(mat: MatKey, pts: [number, number][], y0: number, y1: number, color: ColorLike, topMat?: MatKey, topColor?: ColorLike): this {
    this.prismWalls(mat, pts, y0, y1, color);
    this.cap(topMat ?? mat, pts, y1, topColor ?? color);
    return this;
  }

  /** Gable roof over a w×d rectangle centered at (cx,cz), eaves at y0.
   *  ridgeAlongX: ridge parallel to X. Gable end triangles use `wallMat`. */
  gableRoof(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: ColorLike, opts: { overhang?: number; ridgeAlongX?: boolean; wallMat?: MatKey; wallColor?: ColorLike } = {}): this {
    const o = opts.overhang ?? 0.4;
    const alongX = opts.ridgeAlongX ?? w >= d;
    if (!alongX) {
      // rotate 90° about the center and reuse
      const m = new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
      this.push(m);
      this.gableRoof(mat, cx, y0, cz, d, w, rise, color, { ...opts, ridgeAlongX: true });
      this.pop();
      return this;
    }
    const hw = w / 2, hd = d / 2;
    const x0 = cx - hw - o, x1 = cx + hw + o;
    const slope = rise / hd;
    const ye = y0 - o * slope; // eave height with overhang
    const yr = y0 + rise;
    const zf = cz + hd + o, zb = cz - hd - o;
    const sl = Math.hypot(hd + o, rise + o * slope);
    // front slope (faces +Z/up)
    this.quad(mat, { x: x0, y: ye, z: zf }, { x: x1, y: ye, z: zf }, { x: x1, y: yr, z: cz }, { x: x0, y: yr, z: cz }, [[x0, 0], [x1, 0], [x1, sl], [x0, sl]], color, { x: 0, y: 1, z: 1 });
    // back slope
    this.quad(mat, { x: x1, y: ye, z: zb }, { x: x0, y: ye, z: zb }, { x: x0, y: yr, z: cz }, { x: x1, y: yr, z: cz }, [[x1, 0], [x0, 0], [x0, sl], [x1, sl]], color, { x: 0, y: 1, z: -1 });
    // undersides of overhang (so it is not see-through from below)
    if (o > 0) {
      this.quad(mat, { x: x0, y: ye, z: zf }, { x: x0, y: yr, z: cz }, { x: x1, y: yr, z: cz }, { x: x1, y: ye, z: zf }, [[0, 0], [0, 1], [1, 1], [1, 0]], color, { x: 0, y: -1, z: -1 });
      this.quad(mat, { x: x1, y: ye, z: zb }, { x: x1, y: yr, z: cz }, { x: x0, y: yr, z: cz }, { x: x0, y: ye, z: zb }, [[0, 0], [0, 1], [1, 1], [1, 0]], color, { x: 0, y: -1, z: 1 });
    }
    // gable ends
    const wm = opts.wallMat ?? 'plain';
    const wc = opts.wallColor ?? color;
    const gx0 = cx - hw, gx1 = cx + hw;
    this.tri(wm, { x: gx0, y: y0, z: cz + hd }, { x: gx0, y: yr, z: cz }, { x: gx0, y: y0, z: cz - hd }, [0, y0], [hd, yr], [d, y0], wc, { x: -1, y: 0, z: 0 });
    this.tri(wm, { x: gx1, y: y0, z: cz - hd }, { x: gx1, y: yr, z: cz }, { x: gx1, y: y0, z: cz + hd }, [0, y0], [hd, yr], [d, y0], wc, { x: 1, y: 0, z: 0 });
    return this;
  }

  /** Hip roof (pyramid when square) over a w×d rectangle, eaves at y0. */
  hipRoof(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: ColorLike, overhang = 0.4): this {
    const o = overhang;
    const W = w + 2 * o, D = d + 2 * o;
    const slope = rise / (Math.min(w, d) / 2);
    const ye = y0 - o * slope;
    const yr = ye + slope * (Math.min(W, D) / 2);
    const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
    let r0: THREE.Vector3Like, r1: THREE.Vector3Like;
    if (W >= D) {
      r0 = { x: x0 + D / 2, y: yr, z: cz };
      r1 = { x: x1 - D / 2, y: yr, z: cz };
    } else {
      r0 = { x: cx, y: yr, z: z0 + W / 2 };
      r1 = { x: cx, y: yr, z: z1 - W / 2 };
    }
    const A = { x: x0, y: ye, z: z1 }, B = { x: x1, y: ye, z: z1 }, C = { x: x1, y: ye, z: z0 }, Dp = { x: x0, y: ye, z: z0 };
    const uv = (p: THREE.Vector3Like): [number, number] => [p.x + p.z * 0.3, p.y * 1.4];
    if (W >= D) {
      this.quad(mat, A, B, r1, r0, [uv(A), uv(B), uv(r1), uv(r0)], color, { x: 0, y: 1, z: 1 });
      this.quad(mat, C, Dp, r0, r1, [uv(C), uv(Dp), uv(r0), uv(r1)], color, { x: 0, y: 1, z: -1 });
      this.tri(mat, B, C, r1, uv(B), uv(C), uv(r1), color, { x: 1, y: 1, z: 0 });
      this.tri(mat, Dp, A, r0, uv(Dp), uv(A), uv(r0), color, { x: -1, y: 1, z: 0 });
    } else {
      this.quad(mat, B, C, r0, r1, [uv(B), uv(C), uv(r0), uv(r1)], color, { x: 1, y: 1, z: 0 });
      this.quad(mat, Dp, A, r1, r0, [uv(Dp), uv(A), uv(r1), uv(r0)], color, { x: -1, y: 1, z: 0 });
      this.tri(mat, A, B, r1, uv(A), uv(B), uv(r1), color, { x: 0, y: 1, z: 1 });
      this.tri(mat, C, Dp, r0, uv(C), uv(Dp), uv(r0), color, { x: 0, y: 1, z: -1 });
    }
    return this;
  }

  /** Single-slope (shed) roof, high side at -Z (back). */
  shedRoof(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, rise: number, color: ColorLike, overhang = 0.3, wallMat: MatKey = 'plain', wallColor?: ColorLike): this {
    const o = overhang;
    const x0 = cx - w / 2 - o, x1 = cx + w / 2 + o, zf = cz + d / 2 + o, zb = cz - d / 2 - o;
    const yf = y0, yb = y0 + rise;
    this.quad(mat, { x: x0, y: yf, z: zf }, { x: x1, y: yf, z: zf }, { x: x1, y: yb, z: zb }, { x: x0, y: yb, z: zb }, [[x0, 0], [x1, 0], [x1, d], [x0, d]], color, { x: 0, y: 1, z: 0.2 });
    const wc = wallColor ?? color;
    const gx0 = cx - w / 2, gx1 = cx + w / 2, gz0 = cz - d / 2, gz1 = cz + d / 2;
    this.tri(wallMat, { x: gx0, y: y0, z: gz1 }, { x: gx0, y: yb, z: gz0 }, { x: gx0, y: y0, z: gz0 }, [0, y0], [d, yb], [d, y0], wc, { x: -1, y: 0, z: 0 });
    this.tri(wallMat, { x: gx1, y: y0, z: gz0 }, { x: gx1, y: yb, z: gz0 }, { x: gx1, y: y0, z: gz1 }, [0, y0], [0, yb], [d, y0], wc, { x: 1, y: 0, z: 0 });
    this.wall(wallMat, gx1, gz0, gx0, gz0, y0, yb, wc);
    return this;
  }

  /** Pyramid / spire. */
  pyramid(mat: MatKey, cx: number, y0: number, cz: number, w: number, d: number, h: number, color: ColorLike): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const apex = { x: cx, y: y0 + h, z: cz };
    const A = { x: x0, y: y0, z: z1 }, B = { x: x1, y: y0, z: z1 }, C = { x: x1, y: y0, z: z0 }, D = { x: x0, y: y0, z: z0 };
    this.tri(mat, A, B, apex, [0, 0], [w, 0], [w / 2, h], color, { x: 0, y: 0.5, z: 1 });
    this.tri(mat, B, C, apex, [0, 0], [d, 0], [d / 2, h], color, { x: 1, y: 0.5, z: 0 });
    this.tri(mat, C, D, apex, [0, 0], [w, 0], [w / 2, h], color, { x: 0, y: 0.5, z: -1 });
    this.tri(mat, D, A, apex, [0, 0], [d, 0], [d / 2, h], color, { x: -1, y: 0.5, z: 0 });
    return this;
  }

  /** Cylinder / cone frustum along Y. UVs: u = arc length (m), v = y. */
  cylinder(mat: MatKey, cx: number, y0: number, cz: number, rBottom: number, rTop: number, h: number, color: ColorLike, segments = 12, caps: { top?: boolean; bottom?: boolean } = { top: true }): this {
    const circ = Math.PI * 2 * Math.max(rBottom, rTop);
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = { x: cx + c0 * rBottom, y: y0, z: cz + s0 * rBottom };
      const p1 = { x: cx + c1 * rBottom, y: y0, z: cz + s1 * rBottom };
      const q1 = { x: cx + c1 * rTop, y: y0 + h, z: cz + s1 * rTop };
      const q0 = { x: cx + c0 * rTop, y: y0 + h, z: cz + s0 * rTop };
      const u0 = (i / segments) * circ, u1 = ((i + 1) / segments) * circ;
      const mid = { x: Math.cos((a0 + a1) / 2), y: 0, z: Math.sin((a0 + a1) / 2) };
      if (rTop > 1e-4) this.quad(mat, p0, q0, q1, p1, [[u0, y0], [u0, y0 + h], [u1, y0 + h], [u1, y0]], color, mid);
      else this.tri(mat, p0, q0, p1, [u0, y0], [(u0 + u1) / 2, y0 + h], [u1, y0], color, mid);
      if (caps.top && rTop > 1e-4) this.tri(mat, { x: cx, y: y0 + h, z: cz }, q0, q1, [cx, cz], [q0.x, q0.z], [q1.x, q1.z], color, { x: 0, y: 1, z: 0 });
      if (caps.bottom) this.tri(mat, { x: cx, y: y0, z: cz }, p1, p0, [cx, cz], [p1.x, p1.z], [p0.x, p0.z], color, { x: 0, y: -1, z: 0 });
    }
    return this;
  }

  /** Sphere or upper hemisphere (dome). */
  sphere(mat: MatKey, cx: number, cy: number, cz: number, r: number, color: ColorLike, opts: { hemi?: boolean; wSeg?: number; hSeg?: number; scaleY?: number } = {}): this {
    const geo = new THREE.SphereGeometry(r, opts.wSeg ?? 14, opts.hSeg ?? 10, 0, Math.PI * 2, 0, opts.hemi ? Math.PI / 2 : Math.PI);
    const m = new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(new THREE.Matrix4().makeScale(1, opts.scaleY ?? 1, 1));
    this.addGeometry(mat, geo, color, m);
    geo.dispose();
    return this;
  }

  /** Append an arbitrary THREE geometry (indexed or not). Missing uv/color are filled. */
  addGeometry(mat: MatKey, geometry: THREE.BufferGeometry, color: ColorLike, matrix?: THREE.Matrix4): this {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const colAttr = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    const col = toColor(color, new THREE.Color());
    const bk = this.bucket(mat);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      if (colAttr) c.setRGB(colAttr.getX(i) * col.r, colAttr.getY(i) * col.g, colAttr.getZ(i) * col.b);
      else c.copy(col);
      this.emit(bk, p, n, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c);
    }
    g.dispose();
    return this;
  }

  /** Night glow sprite (local coords, affected by the transform stack). */
  light(x: number, y: number, z: number, color: number, size: number, kind: ModelLight['kind'] = 'lamp', blink = false): this {
    const p = new THREE.Vector3(x, y, z);
    if (!this.identity) p.applyMatrix4(this.matrix);
    this.lights.push({ x: p.x, y: p.y, z: p.z, color, size, kind, blink });
    return this;
  }

  emitter(kind: ModelEmitter['kind'], x: number, y: number, z: number, rate = 1): this {
    const p = new THREE.Vector3(x, y, z);
    if (!this.identity) p.applyMatrix4(this.matrix);
    this.emitters.push({ kind, x: p.x, y: p.y, z: p.z, rate });
    return this;
  }

  /** Merge everything from another builder (its parts keep their materials). */
  merge(other: ModelBuilder): this {
    for (const [mat, src] of other.buckets) {
      const dst = this.bucket(mat);
      if (this.identity) {
        dst.pos.push(...src.pos);
        dst.nrm.push(...src.nrm);
      } else {
        for (let i = 0; i < src.pos.length; i += 3) {
          _v.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]).applyMatrix4(this.matrix);
          _n.set(src.nrm[i], src.nrm[i + 1], src.nrm[i + 2]).applyMatrix3(this.normalMatrix).normalize();
          dst.pos.push(_v.x, _v.y, _v.z);
          dst.nrm.push(_n.x, _n.y, _n.z);
        }
      }
      dst.uv.push(...src.uv);
      dst.col.push(...src.col);
    }
    this.lights.push(...other.lights);
    this.emitters.push(...other.emitters);
    return this;
  }

  get vertexCount(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 3;
    return n;
  }

  /** Finalize into ModelParts (one per material). */
  build(): ModelPart[] {
    const parts: ModelPart[] = [];
    for (const [mat, b] of this.buckets) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      parts.push({ geometry: g, mat });
    }
    return parts;
  }
}

/** Return a copy of the XZ polygon ordered so that edge (dx,dz) has outward normal (dz, -dx). */
export function ensureCCW(pts: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a < 0 ? pts.slice().reverse() : pts.slice();
}

/** Rectangle polygon helper (XZ), centered. */
export function rectPts(cx: number, cz: number, w: number, d: number): [number, number][] {
  return [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
}
