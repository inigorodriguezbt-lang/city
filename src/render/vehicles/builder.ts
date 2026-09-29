// Compact geometry builder for vehicle / pedestrian models. Emits flat-shaded
// (or explicitly smooth) triangles with position, normal, color (linear) and a
// per-vertex material channel (`aMat`) read by the vehicle shader: body paint
// (tinted per instance), fixed colors, glass, chrome, head / tail / siren /
// beacon lights, transit cabin glow and destination signs.
import * as THREE from 'three';

/** material channels (aMat) */
export const enum Ch {
  Paint = 0, // × instance color
  Fixed = 1, // vertex color, matte plastic / rubber
  Glass = 2,
  Chrome = 3,
  Head = 4, // headlight lens
  Tail = 5, // tail / brake light
  SirenA = 6, // red flasher
  SirenB = 7, // blue flasher
  Cabin = 8, // transit window: glass by day, warm interior glow at night
  Amber = 9, // taxi sign (steady at night) / beacon (flashing)
  Shade = 10, // darker paint (× instance color × 0.55)
  Sign = 11, // destination sign (glows at night)
  Satin = 12, // semi-gloss fixed color (liveries, containers)
  Marker = 13, // red nose marker, lit only on a reversed (trailing) cab section
}

export type V3 = [number, number, number];

const _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

export class VB {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  mat: number[] = [];
  /** optional transform applied to subsequent primitives (translation + yaw) */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private cyaw = 1;
  private syaw = 0;
  private mirrorX = 1;

  /** set an offset / rotation (about Y) for subsequent primitives */
  at(x: number, y: number, z: number, yaw = 0, mirrorX = false): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.cyaw = Math.cos(yaw);
    this.syaw = Math.sin(yaw);
    this.mirrorX = mirrorX ? -1 : 1;
    return this;
  }
  reset(): this {
    return this.at(0, 0, 0, 0, false);
  }

  private xf(p: V3, out: THREE.Vector3): THREE.Vector3 {
    const x = p[0] * this.mirrorX, z = p[2];
    return out.set(this.ox + x * this.cyaw + z * this.syaw, this.oy + p[1], this.oz - x * this.syaw + z * this.cyaw);
  }
  private xfn(n: THREE.Vector3): THREE.Vector3 {
    const x = n.x * this.mirrorX, z = n.z;
    return n.set(x * this.cyaw + z * this.syaw, n.y, -x * this.syaw + z * this.cyaw).normalize();
  }

  private vert(p: THREE.Vector3, n: THREE.Vector3, ch: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(_c.r, _c.g, _c.b);
    this.mat.push(ch);
  }

  /** triangle; `out` = a direction the face should point to (fixes winding) */
  tri(a: V3, b: V3, c: V3, ch: number, color: number, out?: V3): this {
    _c.setHex(color);
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
    this.xf(a, pa);
    this.xf(b, pb);
    this.xf(c, pc);
    _a.subVectors(pb, pa);
    _b.subVectors(pc, pa);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-12) return this;
    _n.normalize();
    if (out) {
      _d.set(out[0], out[1], out[2]);
      this.xfn(_d);
      if (_n.dot(_d) < 0) {
        _n.negate();
        this.vert(pa, _n, ch);
        this.vert(pc, _n, ch);
        this.vert(pb, _n, ch);
        return this;
      }
    }
    this.vert(pa, _n, ch);
    this.vert(pb, _n, ch);
    this.vert(pc, _n, ch);
    return this;
  }

  quad(a: V3, b: V3, c: V3, d: V3, ch: number, color: number, out?: V3): this {
    this.tri(a, b, c, ch, color, out);
    this.tri(a, c, d, ch, color, out);
    return this;
  }

  /** axis-aligned box (local), centered at (cx, cz), from y0 to y0 + h. `topInset` narrows the top face (x) for a tapered look. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, ch: number, color: number, opts: { top?: number; topColor?: number; topInset?: number; topInsetZ?: number; bottom?: boolean; skip?: string } = {}): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const ti = opts.topInset ?? 0, tz = opts.topInsetZ ?? 0;
    const X0 = x0 + ti, X1 = x1 - ti, Z0 = z0 + tz, Z1 = z1 - tz;
    const sk = opts.skip ?? '';
    if (!sk.includes('f')) this.quad([x0, y0, z1], [x1, y0, z1], [X1, y1, Z1], [X0, y1, Z1], ch, color, [0, 0, 1]);
    if (!sk.includes('b')) this.quad([x1, y0, z0], [x0, y0, z0], [X0, y1, Z0], [X1, y1, Z0], ch, color, [0, 0, -1]);
    if (!sk.includes('r')) this.quad([x1, y0, z1], [x1, y0, z0], [X1, y1, Z0], [X1, y1, Z1], ch, color, [1, 0, 0]);
    if (!sk.includes('l')) this.quad([x0, y0, z0], [x0, y0, z1], [X0, y1, Z1], [X0, y1, Z0], ch, color, [-1, 0, 0]);
    if (!sk.includes('t')) this.quad([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], opts.top ?? ch, opts.topColor ?? color, [0, 1, 0]);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], ch, color, [0, -1, 0]);
    return this;
  }

  /**
   * Extrude a convex side profile (points [z, y], any winding) along X,
   * symmetric about x = 0. Half width tapers linearly from `hwBottom` at the
   * profile's lowest y to `hwTop` at its highest. `edge(k)` picks the channel /
   * color of perimeter face k (edge from point k to k+1); caps use capCh.
   */
  hull(profile: [number, number][], hwBottom: number, hwTop: number, edge: (k: number) => [number, number] | null, cap: [number, number] | null): this {
    let yMin = Infinity, yMax = -Infinity, cz = 0, cy = 0;
    for (const [z, y] of profile) {
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
      cz += z;
      cy += y;
    }
    cz /= profile.length;
    cy /= profile.length;
    const hw = (y: number) => (yMax - yMin < 1e-6 ? hwBottom : hwBottom + ((hwTop - hwBottom) * (y - yMin)) / (yMax - yMin));
    const n = profile.length;
    for (let k = 0; k < n; k++) {
      const e = edge(k);
      if (!e) continue;
      const [za, ya] = profile[k];
      const [zb, yb] = profile[(k + 1) % n];
      // outward normal of the edge in the z-y plane (away from the centroid)
      let nz = yb - ya, ny = -(zb - za);
      const mz = (za + zb) / 2 - cz, my = (ya + yb) / 2 - cy;
      if (nz * mz + ny * my < 0) (nz = -nz), (ny = -ny);
      this.quad([-hw(ya), ya, za], [hw(ya), ya, za], [hw(yb), yb, zb], [-hw(yb), yb, zb], e[0], e[1], [0, ny, nz]);
    }
    if (cap) {
      for (let k = 1; k < n - 1; k++) {
        const p0 = profile[0], p1 = profile[k], p2 = profile[k + 1];
        this.tri([hw(p0[1]), p0[1], p0[0]], [hw(p1[1]), p1[1], p1[0]], [hw(p2[1]), p2[1], p2[0]], cap[0], cap[1], [1, 0, 0]);
        this.tri([-hw(p0[1]), p0[1], p0[0]], [-hw(p1[1]), p1[1], p1[0]], [-hw(p2[1]), p2[1], p2[0]], cap[0], cap[1], [-1, 0, 0]);
      }
    }
    return this;
  }

  /** cylinder along X (wheel): tire tread with smooth normals, dark sidewall and a hub disc */
  wheel(x: number, y: number, z: number, r: number, width: number, segs = 8, hub = 0xb9bdc2, tire = 0x151517): this {
    const side = Math.sign(x) || 1;
    const xi = x - (side * width) / 2, xo = x + (side * width) / 2;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
    const na = new THREE.Vector3(), nb = new THREE.Vector3();
    const off = Math.PI / segs;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2 + off, a1 = ((s + 1) / segs) * Math.PI * 2 + off;
      const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      this.xf([xi, y + y0, z + z0], pa);
      this.xf([xo, y + y0, z + z0], pb);
      this.xf([xo, y + y1, z + z1], pc);
      this.xf([xi, y + y1, z + z1], pd);
      na.set(0, Math.cos(a0), Math.sin(a0));
      nb.set(0, Math.cos(a1), Math.sin(a1));
      this.xfn(na);
      this.xfn(nb);
      _a.subVectors(pb, pa);
      _b.subVectors(pc, pa);
      _n.crossVectors(_a, _b);
      _c.setHex(tire);
      if (_n.dot(na) >= 0) {
        this.vert(pa, na, Ch.Fixed);
        this.vert(pb, na, Ch.Fixed);
        this.vert(pc, nb, Ch.Fixed);
        this.vert(pa, na, Ch.Fixed);
        this.vert(pc, nb, Ch.Fixed);
        this.vert(pd, nb, Ch.Fixed);
      } else {
        this.vert(pa, na, Ch.Fixed);
        this.vert(pc, nb, Ch.Fixed);
        this.vert(pb, na, Ch.Fixed);
        this.vert(pa, na, Ch.Fixed);
        this.vert(pd, nb, Ch.Fixed);
        this.vert(pc, nb, Ch.Fixed);
      }
      // sidewall + hub
      const rh = r * 0.58;
      this.tri([xo, y, z], [xo, y + y0, z + z0], [xo, y + y1, z + z1], Ch.Fixed, tire, [side, 0, 0]);
      const c0 = Math.cos(a0) * rh, s0 = Math.sin(a0) * rh, c1 = Math.cos(a1) * rh, s1 = Math.sin(a1) * rh;
      this.tri([xo + side * 0.012, y, z], [xo + side * 0.012, y + c0, z + s0], [xo + side * 0.012, y + c1, z + s1], Ch.Chrome, hub, [side, 0, 0]);
    }
    return this;
  }

  /** dark wheel well on a body side plane (x = ±), around a wheel centered at (zc, cy) */
  arch(x: number, zc: number, cy: number, r: number, bottom: number, color = 0x0d0d0f, segs = 6): this {
    const s = Math.sign(x) || 1;
    const R = r + 0.09;
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI, a1 = ((k + 1) / segs) * Math.PI;
      this.tri([x, cy, zc], [x, cy + Math.sin(a0) * R, zc + Math.cos(a0) * R], [x, cy + Math.sin(a1) * R, zc + Math.cos(a1) * R], Ch.Fixed, color, [s, 0, 0]);
    }
    if (cy > bottom) this.quad([x, bottom, zc - R], [x, bottom, zc + R], [x, cy, zc + R], [x, cy, zc - R], Ch.Fixed, color, [s, 0, 0]);
    return this;
  }

  /** a flat light lens facing +Z (front) or -Z (rear) */
  lens(x: number, y: number, z: number, w: number, h: number, facing: 1 | -1, ch: number, color: number): this {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2;
    return this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], ch, color, [0, 0, facing]);
  }

  /** a flat panel on a side (x = ±) */
  sidePanel(x: number, y0: number, y1: number, z0: number, z1: number, ch: number, color: number): this {
    const s = Math.sign(x) || 1;
    return this.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], ch, color, [s, 0, 0]);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.computeBoundingSphere();
    return g;
  }
}
