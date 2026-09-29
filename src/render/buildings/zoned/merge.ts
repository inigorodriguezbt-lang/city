// Chunk geometry merging for the BuildingRenderer (and the sandbox).
//
// Every building model (zoned or service) is a list of per-material parts in
// local space. A chunk merges all of its buildings into ONE geometry drawn
// with the chunk "uber" material (materials.ts getChunkMaterial): the surface
// type travels per vertex in `aMat`, per-building data (seed / schedule /
// style / condition) in `aInfo`, window facade codes in `aFac`.
// Compact attribute formats keep memory low: int8 normals, uint16 colours.
import * as THREE from 'three';
import type { ModelPart } from '../types';
import { LOD_MAT_ID, matTypeId } from '../materials';
import type { LodMass, ZAnim } from './fab';

export interface MergeSource {
  parts: ModelPart[];
  anims?: ZAnim[];
}

export interface MergeItem {
  src: MergeSource;
  /** local → world (rotation about Y + translation) */
  matrix: THREE.Matrix4;
  /** packed aInfo (see constants.packInfo) */
  info: number;
}

export interface LodItem {
  masses: LodMass[];
  matrix: THREE.Matrix4;
  info: number;
}

interface Layout {
  pos: Float32Array;
  nrm: Int8Array;
  uv: Float32Array;
  col: Uint16Array;
  fac: Uint8Array;
  inf: Uint8Array;
  mat: Uint8Array;
}

function alloc(n: number): Layout {
  return {
    pos: new Float32Array(n * 3),
    nrm: new Int8Array(n * 3),
    uv: new Float32Array(n * 2),
    col: new Uint16Array(n * 3),
    fac: new Uint8Array(n * 4),
    inf: new Uint8Array(n * 4),
    mat: new Uint8Array(n),
  };
}

function toGeometry(L: Layout, extra?: Record<string, THREE.BufferAttribute>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(L.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(L.nrm, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(L.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(L.col, 3, true));
  g.setAttribute('aFac', new THREE.BufferAttribute(L.fac, 4, true));
  g.setAttribute('aInfo', new THREE.BufferAttribute(L.inf, 4, true));
  g.setAttribute('aMat', new THREE.BufferAttribute(L.mat, 1, false));
  if (extra) for (const k in extra) g.setAttribute(k, extra[k]);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Append one part (local geometry) transformed by m into L at vertex offset o. */
function writePart(L: Layout, o: number, g: THREE.BufferGeometry, mat: number, e: ArrayLike<number>, info: number): number {
  const P = (g.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>;
  const N = (g.getAttribute('normal') as THREE.BufferAttribute).array as ArrayLike<number>;
  const UVa = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const Ca = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const Fa = g.getAttribute('aFac') as THREE.BufferAttribute | undefined;
  const UV = UVa ? (UVa.array as ArrayLike<number>) : null;
  const C = Ca ? (Ca.array as ArrayLike<number>) : null;
  const cStride = Ca ? Ca.itemSize : 3;
  const F = Fa ? (Fa.array as ArrayLike<number>) : null;
  const n = P.length / 3;
  const i0 = info & 255, i1 = (info >>> 8) & 255, i2 = (info >>> 16) & 255, i3 = (info >>> 24) & 255;
  const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
  const { pos, nrm, uv, col, fac, inf, mat: mt } = L;
  for (let i = 0; i < n; i++) {
    const s3 = i * 3, d = o + i, d3 = d * 3;
    const x = P[s3], y = P[s3 + 1], z = P[s3 + 2];
    pos[d3] = e0 * x + e4 * y + e8 * z + e12;
    pos[d3 + 1] = e1 * x + e5 * y + e9 * z + e13;
    pos[d3 + 2] = e2 * x + e6 * y + e10 * z + e14;
    const nx = N[s3], ny = N[s3 + 1], nz = N[s3 + 2];
    nrm[d3] = Math.round((e0 * nx + e4 * ny + e8 * nz) * 127);
    nrm[d3 + 1] = Math.round((e1 * nx + e5 * ny + e9 * nz) * 127);
    nrm[d3 + 2] = Math.round((e2 * nx + e6 * ny + e10 * nz) * 127);
    if (UV) {
      uv[d * 2] = UV[i * 2];
      uv[d * 2 + 1] = UV[i * 2 + 1];
    }
    if (C) {
      const c = i * cStride;
      col[d3] = clampU16(C[c]);
      col[d3 + 1] = clampU16(C[c + 1]);
      col[d3 + 2] = clampU16(C[c + 2]);
    } else {
      col[d3] = col[d3 + 1] = col[d3 + 2] = 65535;
    }
    const d4 = d * 4;
    if (F) {
      fac[d4] = F[i * 4];
      fac[d4 + 1] = F[i * 4 + 1];
      fac[d4 + 2] = F[i * 4 + 2];
      fac[d4 + 3] = F[i * 4 + 3];
    }
    inf[d4] = i0;
    inf[d4 + 1] = i1;
    inf[d4 + 2] = i2;
    inf[d4 + 3] = i3;
    mt[d] = mat;
  }
  return n;
}

function clampU16(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535);
}

/** Merge detailed models. Returns the static geometry and (if any) animated parts geometry. */
export function mergeDetail(items: MergeItem[]): { geometry: THREE.BufferGeometry | null; anim: THREE.BufferGeometry | null; verts: number } {
  let n = 0, na = 0;
  for (const it of items) {
    for (const p of it.src.parts) n += p.geometry.getAttribute('position').count;
    if (it.src.anims) for (const a of it.src.anims) na += a.part.geometry.getAttribute('position').count;
  }
  let geometry: THREE.BufferGeometry | null = null;
  let anim: THREE.BufferGeometry | null = null;
  if (n > 0) {
    const L = alloc(n);
    let o = 0;
    for (const it of items) {
      const e = it.matrix.elements;
      for (const p of it.src.parts) o += writePart(L, o, p.geometry, matTypeId(p.mat), e, it.info);
    }
    geometry = toGeometry(L);
  }
  if (na > 0) {
    const L = alloc(na);
    const piv = new Float32Array(na * 3), axis = new Float32Array(na * 3), an = new Float32Array(na * 3);
    let o = 0;
    const v = new THREE.Vector3();
    for (const it of items) {
      if (!it.src.anims) continue;
      const e = it.matrix.elements;
      for (const a of it.src.anims) {
        const c = writePart(L, o, a.part.geometry, matTypeId(a.part.mat), e, it.info);
        v.set(a.pivot[0], a.pivot[1], a.pivot[2]).applyMatrix4(it.matrix);
        const px = v.x, py = v.y, pz = v.z;
        v.set(a.axis[0], a.axis[1], a.axis[2]).transformDirection(it.matrix);
        const rock = a.rock ?? 0;
        const phase = (a.phase ?? 0) + (it.info & 0xffff) * 0.0137;
        for (let i = 0; i < c; i++) {
          const d3 = (o + i) * 3;
          piv[d3] = px; piv[d3 + 1] = py; piv[d3 + 2] = pz;
          axis[d3] = v.x; axis[d3 + 1] = v.y; axis[d3 + 2] = v.z;
          an[d3] = a.speed; an[d3 + 1] = rock; an[d3 + 2] = phase;
        }
        o += c;
      }
    }
    anim = toGeometry(L, {
      aPivot: new THREE.BufferAttribute(piv, 3),
      aAxis: new THREE.BufferAttribute(axis, 3),
      aAnim: new THREE.BufferAttribute(an, 3),
    });
    // animated parts sweep beyond their rest pose: pad the bounds
    if (anim.boundingSphere) anim.boundingSphere.radius += 30;
  }
  return { geometry, anim, verts: n + na };
}

// ── far LOD boxes ──────────────────────────────────────────────────────────
const _p = new THREE.Vector3();

/** Merge LOD masses (boxes: 4 walls + top) of many buildings into one geometry. */
export function mergeLod(items: LodItem[]): THREE.BufferGeometry | null {
  let nm = 0;
  for (const it of items) nm += it.masses.length;
  if (!nm) return null;
  const L = alloc(nm * 30);
  let o = 0;
  const corners: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (const it of items) {
    const e = it.matrix.elements;
    const info = it.info;
    const i0 = info & 255, i1 = (info >>> 8) & 255, i2 = (info >>> 16) & 255, i3 = (info >>> 24) & 255;
    for (const m of it.masses) {
      const c = Math.cos(m.rot), s = Math.sin(m.rot);
      const hw = m.w / 2, hd = m.d / 2;
      // local corners (front-left, front-right, back-right, back-left), CCW seen from above
      const loc: [number, number][] = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
      for (let k = 0; k < 4; k++) {
        const [lx, lz] = loc[k];
        _p.set(m.cx + lx * c + lz * s, 0, m.cz - lx * s + lz * c).applyMatrix4(it.matrix);
        corners[k] = [_p.x, _p.z];
      }
      const ground = m.y0 <= 0.2;
      const y0w = e[13] + (ground ? -2 : m.y0);
      const y1w = e[13] + m.y0 + m.h;
      const vb = ground ? -2 : m.y0;
      const ccx = (corners[0][0] + corners[2][0]) / 2, ccz = (corners[0][1] + corners[2][1]) / 2;
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        let nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
        if (nx * ((a[0] + b[0]) / 2 - ccx) + nz * ((a[1] + b[1]) / 2 - ccz) < 0) {
          nx = -nx;
          nz = -nz;
        }
        const quad: [number, number, number, number, number][] = [
          [a[0], y0w, a[1], 0, vb],
          [b[0], y0w, b[1], len, vb],
          [b[0], y1w, b[1], len, m.y0 + m.h],
          [a[0], y1w, a[1], 0, m.y0 + m.h],
        ];
        o = writeQuad(L, o, quad, nx, 0, nz, m.wall, m.fac, i0, i1, i2, i3);
      }
      // roof
      const top: [number, number, number, number, number][] = corners.map(([x, z]) => [x, y1w, z, x, -z] as [number, number, number, number, number]);
      o = writeQuad(L, o, [top[0], top[1], top[2], top[3]], 0, 1, 0, m.roof, 0, i0, i1, i2, i3);
    }
  }
  return toGeometry(L);
}

/** Write a quad (4 verts: x,y,z,u,v) as 2 triangles with a fixed normal; winding made to face the normal. */
function writeQuad(L: Layout, o: number, q: [number, number, number, number, number][], nx: number, ny: number, nz: number, c: [number, number, number], fac: number, i0: number, i1: number, i2: number, i3: number): number {
  // check winding of (q0,q1,q2) against the normal
  const ax = q[1][0] - q[0][0], ay = q[1][1] - q[0][1], az = q[1][2] - q[0][2];
  const bx = q[2][0] - q[0][0], by = q[2][1] - q[0][1], bz = q[2][2] - q[0][2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const flip = cx * nx + cy * ny + cz * nz < 0;
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  const r = clampU16(c[0]), g = clampU16(c[1]), b = clampU16(c[2]);
  const n0 = Math.round(nx * 127), n1 = Math.round(ny * 127), n2 = Math.round(nz * 127);
  for (const k of order) {
    const v = q[k];
    const d3 = o * 3, d4 = o * 4;
    L.pos[d3] = v[0]; L.pos[d3 + 1] = v[1]; L.pos[d3 + 2] = v[2];
    L.nrm[d3] = n0; L.nrm[d3 + 1] = n1; L.nrm[d3 + 2] = n2;
    L.uv[o * 2] = v[3]; L.uv[o * 2 + 1] = v[4];
    L.col[d3] = r; L.col[d3 + 1] = g; L.col[d3 + 2] = b;
    L.fac[d4] = fac; L.fac[d4 + 1] = 0; L.fac[d4 + 2] = 0; L.fac[d4 + 3] = 0;
    L.inf[d4] = i0; L.inf[d4 + 1] = i1; L.inf[d4 + 2] = i2; L.inf[d4 + 3] = i3;
    L.mat[o] = LOD_MAT_ID;
    o++;
  }
  return o;
}
