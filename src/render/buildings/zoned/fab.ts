// Fab — the zoned generators' construction kit on top of ModelBuilder.
//
// Adds what the procedural facade shaders need:
//  * per-part FACADE CODES (window kind / size / flags, see constants.ts),
//    emitted as the `aFac` vertex attribute (one ModelBuilder per code,
//    merged per material at the end);
//  * facade walls whose meter UVs are FITTED so an integer number of window
//    bays spans each wall and the shader's storey lines match the real floor
//    height of the building;
//  * LOD masses (simple boxes with wall/roof colour + facade type) recorded
//    while building, used by the renderer for far-away chunk impostors;
//  * vertex-animated parts (rotors, rocking beams) and the usual lights and
//    particle emitter hints.
import * as THREE from 'three';
import { ModelBuilder, ensureCCW, toColor, type ColorLike } from '../ModelBuilder';
import type { MatKey, ModelAnim, ModelContext, ModelEmitter, ModelLight, ModelPart, ModelResult } from '../types';
import { BAY, FLOOR, IND_BAY, IND_H, LodFacade, SHOP_BAY, SHOP_H, WinKind, facCode } from './constants';

/** facade code for walls too narrow for a window */
export const BLANK = facCode(WinKind.Blank);

export type V3 = [number, number, number];
export type P2 = [number, number];

/** Far-LOD box. Local model coordinates (before the building's world transform). */
export interface LodMass {
  cx: number;
  cz: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  /** rotation about Y (radians, local) */
  rot: number;
  /** linear rgb */
  wall: V3;
  roof: V3;
  fac: LodFacade;
  /** roof prism instead of a box: 1 = gable, 2 = hip (ridge along local X,
   *  eaves at y0, ridge at y0 + h); walls below are separate masses */
  ridge?: number;
}

/** Animated part with optional rocking (amplitude in radians; 0 = continuous spin). */
export interface ZAnim extends ModelAnim {
  rock?: number;
  phase?: number;
}

/** Result of a zoned generator: a ModelResult plus LOD masses. */
export interface ZModel extends ModelResult {
  masses: LodMass[];
  anims: ZAnim[];
  lights: ModelLight[];
  emitters: ModelEmitter[];
}

export interface FacadeOpts {
  /** real storey height (m) — v is scaled so shader floors line up */
  fh?: number;
  /** target bay width (m) — u is scaled so a whole number of bays fits each wall */
  bay?: number;
  /** y (m) where storey 0 begins (default 0) */
  base?: number;
  /** v offset in shader units added at `base` (e.g. FLOOR to start at storey 1) */
  vBase?: number;
  /** top cap material (false = none) */
  top?: MatKey | false;
  topColor?: ColorLike;
  /** which box sides to emit */
  sides?: { n?: boolean; e?: boolean; s?: boolean; w?: boolean };
  /** u continues across polygon edges without per-edge fitting (curved towers) */
  continuous?: boolean;
  /** skip LOD mass recording */
  noMass?: boolean;
  /** LOD facade override */
  lod?: LodFacade;
  /** LOD roof colour override */
  lodRoof?: ColorLike;
}

/** shader bay width for a wall material */
export function matBay(mat: MatKey): number {
  return mat === 'wall_shop' ? SHOP_BAY : mat === 'wall_industrial' ? IND_BAY : BAY;
}
/** shader storey height for a wall material */
export function matFloor(mat: MatKey): number {
  return mat === 'wall_shop' ? SHOP_H : mat === 'wall_industrial' ? IND_H : FLOOR;
}

export function lodFacadeOf(mat: MatKey): LodFacade {
  switch (mat) {
    case 'wall_glass': return LodFacade.Glass;
    case 'wall_office': return LodFacade.Office;
    case 'wall_shop': return LodFacade.Shop;
    case 'wall_industrial': return LodFacade.Industrial;
    case 'wall_wood': return LodFacade.House;
    case 'wall_plaster': case 'wall_brick': case 'wall_concrete': case 'wall_stone': return LodFacade.Punched;
    default: return LodFacade.None;
  }
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function rgb(c: ColorLike): V3 {
  toColor(c, _c);
  return [_c.r, _c.g, _c.b];
}

export class Fab {
  readonly rng;
  readonly masses: LodMass[] = [];
  readonly anims: ZAnim[] = [];
  private builders = new Map<number, ModelBuilder>();
  private stack: THREE.Matrix4[] = [];
  private cur = new THREE.Matrix4();
  /** highest point recorded (m) */
  top = 0;
  /** individual railing balusters still affordable in this model (triangle budget) */
  barBudget = 150;

  constructor(readonly ctx: ModelContext) {
    this.rng = ctx.rng;
  }

  get detail(): 'low' | 'medium' | 'high' {
    return this.ctx.detail;
  }

  /** builder for a facade code (0 = parts without windows / default) */
  m(code = 0): ModelBuilder {
    let b = this.builders.get(code);
    if (!b) {
      b = new ModelBuilder();
      for (const s of this.stack) b.push(s);
      this.builders.set(code, b);
    }
    return b;
  }

  // ── transform stack (applied to every facade builder) ──────────────────
  push(m: THREE.Matrix4): this {
    const c = m.clone();
    this.stack.push(c);
    this.cur.multiply(c);
    for (const b of this.builders.values()) b.push(c);
    return this;
  }
  pushTRS(x: number, y: number, z: number, rotY = 0, scale = 1): this {
    _q.setFromAxisAngle(_p.set(0, 1, 0), rotY);
    return this.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s.set(scale, scale, scale)));
  }
  pop(): this {
    if (!this.stack.length) return this;
    this.stack.pop();
    this.cur.identity();
    for (const s of this.stack) this.cur.multiply(s);
    for (const b of this.builders.values()) b.pop();
    return this;
  }

  /** track max height in the current transform */
  reach(y: number): void {
    _p.set(0, y, 0).applyMatrix4(this.cur);
    if (_p.y > this.top) this.top = _p.y;
  }

  // ── LOD masses ──────────────────────────────────────────────────────────
  mass(cx: number, cz: number, w: number, d: number, y0: number, h: number, wall: ColorLike, roof: ColorLike, fac: LodFacade, ridge = 0): void {
    if (w <= 0.2 || d <= 0.2 || h <= 0.05) return;
    _p.set(cx, y0, cz).applyMatrix4(this.cur);
    this.cur.decompose(new THREE.Vector3(), _q, _s);
    _e.setFromQuaternion(_q, 'YXZ');
    const sc = _s.x;
    const m: LodMass = { cx: _p.x, cz: _p.z, w: w * sc, d: d * sc, y0: _p.y, h: h * sc, rot: _e.y, wall: rgb(wall), roof: rgb(roof), fac };
    if (ridge) m.ridge = ridge;
    this.masses.push(m);
    this.reach(y0 + h);
  }

  // ── facade walls ────────────────────────────────────────────────────────
  /** One vertical facade quad from a to b (left → right as seen from outside).
   *  Returns the u coordinate at b (for continuing around a polygon). */
  facade(mat: MatKey, code: number, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: ColorLike, o: FacadeOpts = {}, u0 = 0, fit = true): number {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4 || y1 <= y0) return u0;
    const mb = matBay(mat), mf = matFloor(mat);
    let us = 1;
    if (fit) {
      const n = Math.max(1, Math.round(len / (o.bay ?? mb)));
      us = (n * mb) / len;
    }
    const vs = mf / (o.fh ?? mf);
    const base = o.base ?? 0, vb = o.vBase ?? 0;
    const v0 = (y0 - base) * vs + vb, v1 = (y1 - base) * vs + vb;
    const u1 = u0 + len * us;
    const out = { x: -(bz - az), y: 0, z: bx - ax };
    this.m(len < 1.3 && fit ? BLANK : code).quad(mat, { x: ax, y: y0, z: az }, { x: bx, y: y0, z: bz }, { x: bx, y: y1, z: bz }, { x: ax, y: y1, z: az }, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color, out);
    return u1;
  }

  /** Box with fitted facades. Records a LOD mass unless o.noMass. */
  fbox(mat: MatKey, code: number, cx: number, y0: number, cz: number, w: number, d: number, h: number, color: ColorLike, o: FacadeOpts = {}): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const s = o.sides ?? {};
    if (s.s !== false) this.facade(mat, code, x0, z1, x1, z1, y0, y1, color, o);
    if (s.e !== false) this.facade(mat, code, x1, z1, x1, z0, y0, y1, color, o);
    if (s.n !== false) this.facade(mat, code, x1, z0, x0, z0, y0, y1, color, o);
    if (s.w !== false) this.facade(mat, code, x0, z0, x0, z1, y0, y1, color, o);
    if (o.top !== false) {
      const tm = o.top ?? 'roof_flat';
      this.m().quad(tm, { x: x0, y: y1, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 }, [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], o.topColor ?? color, { x: 0, y: 1, z: 0 });
    }
    if (!o.noMass) this.mass(cx, cz, w, d, Math.max(y0, 0), y1 - Math.max(y0, 0), color, o.lodRoof ?? o.topColor ?? color, o.lod ?? lodFacadeOf(mat));
    this.reach(y1);
    return this;
  }

  /** Extruded polygon with fitted facades and a flat cap. */
  fprism(mat: MatKey, code: number, pts: P2[], y0: number, h: number, color: ColorLike, o: FacadeOpts = {}): this {
    const p = ensureCCW(pts).reverse(); // left→right edges with outward (-dz, dx)
    const y1 = y0 + h;
    let u = 0;
    if (o.continuous) {
      let per = 0;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        per += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      const mb = matBay(mat);
      const n = Math.max(1, Math.round(per / (o.bay ?? mb)));
      const us = (n * mb) / per;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.facadeScaled(mat, code, a, b, y0, y1, color, o, u, us);
        u += len * us;
      }
    } else {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        u = this.facade(mat, code, a[0], a[1], b[0], b[1], y0, y1, color, o, u);
      }
    }
    if (o.top !== false) this.m().cap(o.top ?? 'roof_flat', pts, y1, o.topColor ?? color);
    if (!o.noMass) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [x, z] of pts) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      // polygons are approximated by a slightly inset bounding box
      const area = Math.abs(polyArea(pts));
      const k = Math.sqrt(Math.min(1, area / Math.max(1e-3, (x1 - x0) * (z1 - z0))));
      this.mass((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) * k, (z1 - z0) * k, Math.max(0, y0), y1 - Math.max(0, y0), color, o.lodRoof ?? o.topColor ?? color, o.lod ?? lodFacadeOf(mat));
    }
    this.reach(y1);
    return this;
  }

  private facadeScaled(mat: MatKey, code: number, a: P2, b: P2, y0: number, y1: number, color: ColorLike, o: FacadeOpts, u0: number, us: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mf = matFloor(mat);
    const vs = mf / (o.fh ?? mf);
    const base = o.base ?? 0, vb = o.vBase ?? 0;
    const v0 = (y0 - base) * vs + vb, v1 = (y1 - base) * vs + vb;
    const u1 = u0 + len * us;
    const out = { x: -(b[1] - a[1]), y: 0, z: b[0] - a[0] };
    this.m(code).quad(mat, { x: a[0], y: y0, z: a[1] }, { x: b[0], y: y0, z: b[1] }, { x: b[0], y: y1, z: b[1] }, { x: a[0], y: y1, z: a[1] }, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color, out);
  }

  /** Walls between two rings with equal vertex counts (tapering / twisting towers). */
  loft(mat: MatKey, code: number, ringA: P2[], yA: number, ringB: P2[], yB: number, color: ColorLike, o: FacadeOpts = {}, uScale?: number): void {
    const A = ensureCCW(ringA).reverse();
    const B = ensureCCW(ringB).reverse();
    const n = A.length;
    let per = 0;
    for (let i = 0; i < n; i++) per += Math.hypot(A[(i + 1) % n][0] - A[i][0], A[(i + 1) % n][1] - A[i][1]);
    const mb = matBay(mat);
    const us = uScale ?? (Math.max(1, Math.round(per / (o.bay ?? mb))) * mb) / per;
    const mf = matFloor(mat);
    const vs = mf / (o.fh ?? mf);
    const base = o.base ?? 0, vb = o.vBase ?? 0;
    const vA = (yA - base) * vs + vb, vB = (yB - base) * vs + vb;
    let u = 0;
    const cA = centroid(A);
    for (let i = 0; i < n; i++) {
      const a0 = A[i], a1 = A[(i + 1) % n], b0 = B[i], b1 = B[(i + 1) % n];
      const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
      const mx = (a0[0] + a1[0]) / 2 - cA[0], mz = (a0[1] + a1[1]) / 2 - cA[1];
      this.m(code).quad(mat, { x: a0[0], y: yA, z: a0[1] }, { x: a1[0], y: yA, z: a1[1] }, { x: b1[0], y: yB, z: b1[1] }, { x: b0[0], y: yB, z: b0[1] }, [[u, vA], [u + len * us, vA], [u + len * us, vB], [u, vB]], color, { x: mx, y: 0, z: mz });
      u += len * us;
    }
    this.reach(yB);
  }

  // ── lights / emitters (main builder handles transforms) ────────────────
  light(x: number, y: number, z: number, color: number, size: number, kind: ModelLight['kind'] = 'lamp', blink = false): this {
    this.m().light(x, y, z, color, size, kind, blink);
    return this;
  }
  emitter(kind: ModelEmitter['kind'], x: number, y: number, z: number, rate = 1): this {
    this.m().emitter(kind, x, y, z, rate);
    return this;
  }

  /** Build an animated part: `draw` fills a fresh builder (current transform applied). */
  anim(draw: (b: ModelBuilder) => void, pivot: V3, axis: V3, speed: number, rock = 0, phase = 0): void {
    const b = new ModelBuilder();
    for (const s of this.stack) b.push(s);
    draw(b);
    const parts = b.build();
    const pv = new THREE.Vector3(...pivot).applyMatrix4(this.cur);
    const ax = new THREE.Vector3(...axis).transformDirection(this.cur);
    for (const part of parts) {
      addFac(part.geometry, 0);
      this.anims.push({ part, pivot: [pv.x, pv.y, pv.z], axis: [ax.x, ax.y, ax.z], speed, rock, phase });
    }
  }

  /** Finalize: merge every facade builder per material. */
  finish(minHeight = 0): ZModel {
    const byMat = new Map<MatKey, THREE.BufferGeometry[]>();
    const lights: ModelLight[] = [];
    const emitters: ModelEmitter[] = [];
    for (const [code, b] of this.builders) {
      lights.push(...b.lights);
      emitters.push(...b.emitters);
      for (const part of b.build()) {
        addFac(part.geometry, code);
        let l = byMat.get(part.mat);
        if (!l) byMat.set(part.mat, (l = []));
        l.push(part.geometry);
      }
    }
    const parts: ModelPart[] = [];
    for (const [mat, list] of byMat) parts.push({ mat, geometry: list.length === 1 ? list[0] : concatGeometries(list) });
    return { parts, lights, emitters, anims: this.anims, masses: this.masses, height: Math.max(minHeight, this.top) };
  }
}

/** Attach a constant facade-code attribute (u8×4 normalized) to a geometry. */
export function addFac(g: THREE.BufferGeometry, code: number): void {
  const n = g.getAttribute('position').count;
  const a = new Uint8Array(n * 4);
  const b0 = code & 255, b1 = (code >>> 8) & 255, b2 = (code >>> 16) & 255, b3 = (code >>> 24) & 255;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    a[o] = b0; a[o + 1] = b1; a[o + 2] = b2; a[o + 3] = b3;
  }
  g.setAttribute('aFac', new THREE.BufferAttribute(a, 4, true));
}

/** Concatenate non-indexed geometries sharing the same attribute layout (disposes inputs). */
export function concatGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const first = list[0];
  for (const name of Object.keys(first.attributes)) {
    const a0 = first.getAttribute(name) as THREE.BufferAttribute;
    let total = 0;
    for (const g of list) total += (g.getAttribute(name) as THREE.BufferAttribute).array.length;
    const Ctor = (a0.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
    const arr = new Ctor(total);
    let off = 0;
    for (const g of list) {
      const src = (g.getAttribute(name) as THREE.BufferAttribute).array as THREE.TypedArray;
      (arr as unknown as { set(a: ArrayLike<number>, o: number): void }).set(src, off);
      off += src.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  for (const g of list) g.dispose();
  out.computeBoundingSphere();
  return out;
}

export function polyArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function centroid(pts: P2[]): P2 {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}

/** regular polygon / ellipse ring */
export function ring(cx: number, cz: number, rx: number, rz: number, n: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return out;
}

/** rounded rectangle polygon */
export function roundRect(cx: number, cz: number, w: number, d: number, r: number, segs = 3): P2[] {
  r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
  const out: P2[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - r, cz + d / 2 - r, 0],
    [cx - w / 2 + r, cz + d / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cz - d / 2 + r, Math.PI],
    [cx + w / 2 - r, cz - d / 2 + r, Math.PI * 1.5],
  ];
  for (const [x, z, a0] of corners)
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
  return out;
}

/** rotate + scale polygon about a centre */
export function xformPoly(pts: P2[], cx: number, cz: number, rot: number, scale: number): P2[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([x, z]) => {
    const dx = (x - cx) * scale, dz = (z - cz) * scale;
    return [cx + dx * c - dz * s, cz + dx * s + dz * c] as P2;
  });
}
