// Procedural low-poly tree & rock models (2 LODs per species).
// Vertex attributes beyond position/normal/color:
//   aCenter (vec3) – centre of the foliage clump the vertex belongs to; leaves
//                    collapse toward it in winter (bare deciduous trees)
//   aKind   (float) – 0 bark, 1 deciduous leaves, 2 conifer needles, 3 blossom
//                    tree leaves (cherry), 4 palm fronds, 5 cactus, 6 rock,
//                    7 evergreen broadleaf (olive, acacia)
//   aAlt    (vec3)  – seasonal alternative colour (autumn / blossom)
//   aSway   (float) – 0 at the base → 1 at the crown (wind bending weight)
import * as THREE from 'three';
import type { TreeSpecies } from '../../core/types';
import { RNG } from '../../core/rng';

export type PropKind = TreeSpecies | 'rock';
export const PROP_KINDS: PropKind[] = ['oak', 'maple', 'birch', 'pine', 'spruce', 'palm', 'cypress', 'olive', 'cactus', 'acacia', 'willow', 'cherry', 'rock'];

type V3 = [number, number, number];
type RGB = [number, number, number];

const K_BARK = 0, K_LEAF = 1, K_NEEDLE = 2, K_BLOSSOM = 3, K_FROND = 4, K_CACTUS = 5, K_ROCK = 6, K_EVERGREEN = 7;

function rgb(hex: string): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
function mul(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}
function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// icosahedron (+ one subdivision level)
const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V: V3[] = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
  [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
  [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1],
].map((v) => norm(v as V3));
const ICO_F: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
function icoSphere(detail: number): { v: V3[]; f: [number, number, number][] } {
  let v = ICO_V.slice(), f = ICO_F.slice();
  for (let d = 0; d < detail; d++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = cache.get(k);
      if (i === undefined) {
        i = v.length;
        v.push(norm(lerp3(v[a], v[b], 0.5)));
        cache.set(k, i);
      }
      return i;
    };
    const nf: [number, number, number][] = [];
    for (const [a, b, c] of f) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = nf;
  }
  return { v, f };
}
const ICO0 = icoSphere(0);
const ICO1 = icoSphere(1);

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  cen: number[] = [];
  kind: number[] = [];
  alt: number[] = [];
  constructor(readonly height: number, readonly rng: RNG) {}

  vtx(p: V3, n: V3, c: RGB, kind: number, center: V3, alt: RGB): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.cen.push(center[0], center[1], center[2]);
    this.kind.push(kind);
    this.alt.push(alt[0], alt[1], alt[2]);
  }

  /** tapered cylinder between two points (smooth radial normals) */
  cylinder(b: V3, t: V3, r0: number, r1: number, sides: number, c0: RGB, c1: RGB, kind = K_BARK, cap = false): void {
    const axis = norm(sub(t, b));
    const ref: V3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(axis, ref)), v = cross(axis, u);
    const ring = (center: V3, r: number, i: number): [V3, V3] => {
      const a = (i / sides) * Math.PI * 2;
      const n: V3 = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
      return [[center[0] + n[0] * r, center[1] + n[1] * r, center[2] + n[2] * r], n];
    };
    const z: RGB = [0, 0, 0];
    for (let i = 0; i < sides; i++) {
      const [p0, n0] = ring(b, r0, i), [p1, n1] = ring(b, r0, i + 1);
      const [p2, n2] = ring(t, r1, i), [p3, n3] = ring(t, r1, i + 1);
      this.vtx(p0, n0, c0, kind, b, z); this.vtx(p1, n1, c0, kind, b, z); this.vtx(p2, n2, c1, kind, t, z);
      this.vtx(p1, n1, c0, kind, b, z); this.vtx(p3, n3, c1, kind, t, z); this.vtx(p2, n2, c1, kind, t, z);
      if (cap) this.vtx(p2, axis, c1, kind, t, z), this.vtx(p3, axis, c1, kind, t, z), this.vtx(t, axis, c1, kind, t, z);
    }
  }

  /** noisy icosahedral foliage clump with soft (radial) normals and baked AO */
  blob(c: V3, r: V3, color: RGB, kind: number, alt: RGB, detail = 0, jitter = 0.28, aoBottom = 0.62): void {
    const ico = detail ? ICO1 : ICO0;
    const rng = this.rng;
    const disp = ico.v.map(() => 1 + (rng.next() - 0.5) * 2 * jitter);
    const P = ico.v.map((v, i) => [c[0] + v[0] * r[0] * disp[i], c[1] + v[1] * r[1] * disp[i], c[2] + v[2] * r[2] * disp[i]] as V3);
    const shade = ico.v.map((v) => {
      const k = 0.5 + 0.5 * v[1];
      return (aoBottom + (1.08 - aoBottom) * k) * (0.9 + rng.next() * 0.2);
    });
    const tint = 0.94 + rng.next() * 0.12;
    for (const [a, b, d] of ico.f) {
      const fn = norm(cross(sub(P[b], P[a]), sub(P[d], P[a])));
      for (const i of [a, b, d]) {
        const radial = norm([ico.v[i][0] / r[0], ico.v[i][1] / r[1], ico.v[i][2] / r[2]]);
        const n = norm(lerp3(fn, radial, 0.85));
        this.vtx(P[i], n, mul(color, shade[i] * tint), kind, c, mul(alt, shade[i]));
      }
    }
  }

  /** cone layer (conifers): side + darker underside */
  cone(base: V3, h: number, r: number, sides: number, color: RGB, kind: number, droop = 0.25): void {
    const apex: V3 = [base[0], base[1] + h, base[2]];
    const rng = this.rng;
    const z: RGB = [0, 0, 0];
    const rim: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + rng.next() * 0.2;
      const rr = r * (0.88 + rng.next() * 0.24);
      rim.push([base[0] + Math.cos(a) * rr, base[1] - droop * rr * 0.4, base[2] + Math.sin(a) * rr]);
    }
    const center: V3 = [base[0], base[1] + h * 0.35, base[2]];
    for (let i = 0; i < sides; i++) {
      const p0 = rim[i], p1 = rim[(i + 1) % sides];
      const fn = norm(cross(sub(p1, p0), sub(apex, p0)));
      const n0 = norm([p0[0] - base[0], r * 0.6, p0[2] - base[2]]);
      const n1 = norm([p1[0] - base[0], r * 0.6, p1[2] - base[2]]);
      const na = norm(lerp3(fn, [0, 1, 0], 0.5));
      const cb = mul(color, 0.8 + rng.next() * 0.1), ct = mul(color, 1.12);
      this.vtx(p0, norm(lerp3(n0, fn, 0.3)), cb, kind, center, z);
      this.vtx(apex, na, ct, kind, center, z);
      this.vtx(p1, norm(lerp3(n1, fn, 0.3)), cb, kind, center, z);
      // underside
      const dn: V3 = [0, -1, 0];
      const cu = mul(color, 0.45);
      this.vtx(p0, dn, cu, kind, center, z);
      this.vtx(p1, dn, cu, kind, center, z);
      this.vtx([base[0], base[1] + h * 0.12, base[2]], dn, cu, kind, center, z);
    }
  }

  /** drooping double-sided palm frond */
  frond(base: V3, yaw: number, length: number, width: number, droop: number, color: RGB, segs = 5): void {
    const n = segs;
    const dir: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
    const side: V3 = [-dir[2], 0, dir[0]];
    const z: RGB = [0, 0, 0];
    const pts: V3[] = [], lefts: V3[] = [], rights: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const along = length * t;
      const y = base[1] + length * 0.35 * t - droop * t * t * length;
      const p: V3 = [base[0] + dir[0] * along, y, base[2] + dir[2] * along];
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.3);
      pts.push(p);
      lefts.push([p[0] + side[0] * w, p[1] - w * 0.25, p[2] + side[2] * w]);
      rights.push([p[0] - side[0] * w, p[1] - w * 0.25, p[2] - side[2] * w]);
    }
    const center: V3 = [base[0] + dir[0] * length * 0.5, base[1], base[2] + dir[2] * length * 0.5];
    for (let i = 0; i < n; i++) {
      const cA = mul(color, 0.85 + 0.25 * (i / n)), cB = mul(color, 0.85 + 0.25 * ((i + 1) / n));
      for (const [a, b, c, ca, cb, cc] of [
        [pts[i], lefts[i], pts[i + 1], cA, cA, cB],
        [lefts[i], lefts[i + 1], pts[i + 1], cA, cB, cB],
        [pts[i], pts[i + 1], rights[i], cA, cB, cA],
        [rights[i], pts[i + 1], rights[i + 1], cA, cB, cB],
      ] as [V3, V3, V3, RGB, RGB, RGB][]) {
        const fn = norm(cross(sub(b, a), sub(c, a)));
        const up: V3 = fn[1] < 0 ? [-fn[0], -fn[1], -fn[2]] : fn;
        this.vtx(a, up, ca, K_FROND, center, z); this.vtx(b, up, cb, K_FROND, center, z); this.vtx(c, up, cc, K_FROND, center, z);
        // back face
        this.vtx(a, up, mul(ca, 0.7), K_FROND, center, z); this.vtx(c, up, mul(cc, 0.7), K_FROND, center, z); this.vtx(b, up, mul(cb, 0.7), K_FROND, center, z);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    const sway = new Float32Array(n);
    for (let i = 0; i < n; i++) sway[i] = Math.min(1, Math.max(0, this.pos[i * 3 + 1] / this.height));
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.cen, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute('aAlt', new THREE.Float32BufferAttribute(this.alt, 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ── species ─────────────────────────────────────────────────────────────────
interface SpeciesDef {
  /** nominal height (m) of the model at scale 1 */
  height: number;
  build: (b: Builder, lod: 0 | 1) => void;
}

const BARK = rgb('#5b4632');
const BARK_DARK = rgb('#3e3024');

function broadleaf(b: Builder, lod: 0 | 1, o: { H: number; trunkH: number; trunkR: number; crownR: number; crownY: number; blobs: number; leaf: RGB; alt: RGB; kind: number; squash?: number; bark?: RGB; spread?: number }): void {
  const bark = o.bark ?? BARK;
  const sq = o.squash ?? 1;
  if (lod === 1) {
    b.cylinder([0, 0, 0], [0, o.crownY, 0], o.trunkR, o.trunkR * 0.6, 3, mul(bark, 0.8), bark);
    b.blob([0, o.crownY + o.crownR * 0.1 * sq, 0], [o.crownR * 1.25, o.crownR * sq * 1.05, o.crownR * 1.25], o.leaf, o.kind, o.alt, 0, 0.15);
    return;
  }
  const rng = b.rng;
  b.cylinder([0, 0, 0], [0, o.trunkH, 0], o.trunkR, o.trunkR * 0.72, 6, mul(bark, 0.75), bark);
  const spread = o.spread ?? 0.55;
  const nb = 3;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rng.next() * 0.8;
    const top: V3 = [Math.cos(a) * o.crownR * spread, o.crownY + (rng.next() - 0.3) * o.crownR * 0.4, Math.sin(a) * o.crownR * spread];
    b.cylinder([0, o.trunkH * 0.92, 0], top, o.trunkR * 0.55, o.trunkR * 0.22, 5, bark, mul(bark, 1.1));
  }
  b.cylinder([0, o.trunkH * 0.9, 0], [0, o.crownY + o.crownR * 0.5 * sq, 0], o.trunkR * 0.6, o.trunkR * 0.2, 5, bark, bark);
  for (let i = 0; i < o.blobs; i++) {
    const a = (i / o.blobs) * Math.PI * 2 + rng.next() * 0.6;
    const rr = i === 0 ? 0 : o.crownR * (0.45 + rng.next() * 0.25);
    const cy = o.crownY + (i === 0 ? o.crownR * 0.35 * sq : (rng.next() - 0.35) * o.crownR * 0.55 * sq);
    const r = o.crownR * (i === 0 ? 0.78 : 0.55 + rng.next() * 0.2);
    b.blob([Math.cos(a) * rr, cy, Math.sin(a) * rr], [r * 1.05, r * 0.85 * sq, r * 1.05], o.leaf, o.kind, o.alt, 0, 0.26);
  }
}

const SPECIES: Record<PropKind, SpeciesDef> = {
  oak: {
    height: 13,
    build: (b, lod) => broadleaf(b, lod, { H: 13, trunkH: 4.5, trunkR: 0.5, crownR: 4.6, crownY: 8.6, blobs: 6, leaf: rgb('#3f6326'), alt: rgb('#b0662a'), kind: K_LEAF, squash: 0.85, spread: 0.6 }),
  },
  maple: {
    height: 12,
    build: (b, lod) => broadleaf(b, lod, { H: 12, trunkH: 3.8, trunkR: 0.42, crownR: 4.0, crownY: 8.0, blobs: 6, leaf: rgb('#447030'), alt: rgb('#c23a1c'), kind: K_LEAF, squash: 1.05, spread: 0.45 }),
  },
  birch: {
    height: 14,
    build: (b, lod) => {
      const bark = rgb('#ddd8cc');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0, 10, 0], 0.22, 0.12, 3, bark, bark);
        b.blob([0, 9.5, 0], [2.4, 4.2, 2.4], rgb('#5e8434'), K_LEAF, rgb('#d9b62a'), 0, 0.15);
        return;
      }
      const rng = b.rng;
      for (let s = 0; s < 4; s++) {
        const y0 = s * 3, y1 = (s + 1) * 3;
        const c = s % 2 ? mul(bark, 0.55) : bark;
        b.cylinder([0, y0, 0], [0, y1, 0], 0.24 - s * 0.03, 0.21 - s * 0.03, 5, c, bark);
      }
      for (let i = 0; i < 5; i++) {
        const a = rng.next() * Math.PI * 2;
        const rr = i === 0 ? 0 : 1.1 + rng.next() * 0.6;
        const y = 8 + i * 1.1;
        b.blob([Math.cos(a) * rr, y, Math.sin(a) * rr], [1.7, 2.3, 1.7], rgb('#5e8434'), K_LEAF, rgb('#d9b62a'), 0, 0.3);
      }
    },
  },
  willow: {
    height: 11,
    build: (b, lod) => {
      const leaf = rgb('#7a9a3c'), alt = rgb('#b9a538');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0, 5, 0], 0.5, 0.35, 3, BARK_DARK, BARK);
        b.blob([0, 6, 0], [5, 4.4, 5], leaf, K_LEAF, alt, 0, 0.12);
        return;
      }
      const rng = b.rng;
      b.cylinder([0, 0, 0], [0, 3.6, 0], 0.6, 0.45, 6, BARK_DARK, BARK);
      b.cylinder([0, 3.4, 0], [1.2, 7.5, 0.6], 0.35, 0.15, 5, BARK, BARK);
      b.cylinder([0, 3.4, 0], [-1.0, 7.8, -0.8], 0.35, 0.15, 5, BARK, BARK);
      b.blob([0, 8.2, 0], [4.2, 2.6, 4.2], leaf, K_LEAF, alt, 0, 0.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rng.next() * 0.3;
        b.blob([Math.cos(a) * 3.8, 5.2, Math.sin(a) * 3.8], [1.25, 3.3, 1.25], mul(leaf, 0.95), K_LEAF, alt, 0, 0.18, 0.5);
      }
    },
  },
  cherry: {
    height: 7,
    build: (b, lod) => broadleaf(b, lod, { H: 7, trunkH: 2.2, trunkR: 0.3, crownR: 3.2, crownY: 4.9, blobs: 5, leaf: rgb('#4c7a2c'), alt: rgb('#f3b3c8'), kind: K_BLOSSOM, squash: 0.75, bark: rgb('#4a3530'), spread: 0.7 }),
  },
  olive: {
    height: 6,
    build: (b, lod) => {
      const leaf = rgb('#7c8b5c');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0.3, 3, 0], 0.35, 0.25, 3, BARK_DARK, BARK);
        b.blob([0.3, 3.8, 0], [3.0, 2.0, 3.0], leaf, K_EVERGREEN, leaf, 0, 0.2);
        return;
      }
      const rng = b.rng;
      b.cylinder([0, 0, 0], [0.5, 1.6, 0.2], 0.45, 0.35, 6, BARK_DARK, rgb('#6b5b4a'));
      b.cylinder([0.5, 1.6, 0.2], [1.3, 3.0, -0.3], 0.3, 0.18, 5, rgb('#6b5b4a'), rgb('#6b5b4a'));
      b.cylinder([0.5, 1.6, 0.2], [-0.6, 3.2, 0.6], 0.3, 0.18, 5, rgb('#6b5b4a'), rgb('#6b5b4a'));
      for (let i = 0; i < 5; i++) {
        const a = rng.next() * Math.PI * 2;
        const rr = 0.6 + rng.next() * 1.3;
        b.blob([0.3 + Math.cos(a) * rr, 3.4 + rng.next() * 1.1, Math.sin(a) * rr], [1.6, 1.15, 1.6], mul(leaf, 0.9 + rng.next() * 0.2), K_EVERGREEN, leaf, 0, 0.35);
      }
    },
  },
  acacia: {
    height: 8,
    build: (b, lod) => {
      const leaf = rgb('#62772f');
      const bark = rgb('#5e4a38');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0, 6, 0], 0.3, 0.2, 3, bark, bark);
        b.blob([0, 6.9, 0], [4.8, 0.9, 4.8], leaf, K_EVERGREEN, leaf, 0, 0.1, 0.5);
        return;
      }
      const rng = b.rng;
      b.cylinder([0, 0, 0], [0.2, 3.2, 0], 0.32, 0.26, 6, bark, bark);
      const tops: V3[] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.next() * 0.5;
        const t: V3 = [Math.cos(a) * 2.6, 6.2 + rng.next() * 0.6, Math.sin(a) * 2.6];
        tops.push(t);
        b.cylinder([0.2, 3.0, 0], t, 0.22, 0.1, 5, bark, bark);
      }
      for (const t of tops) b.blob([t[0] * 0.9, t[1] + 0.5, t[2] * 0.9], [2.6, 0.75, 2.6], leaf, K_EVERGREEN, leaf, 0, 0.25, 0.45);
      b.blob([0, 7.0, 0], [3.0, 0.8, 3.0], mul(leaf, 1.05), K_EVERGREEN, leaf, 0, 0.2, 0.45);
    },
  },
  pine: {
    height: 19,
    build: (b, lod) => {
      const bark = rgb('#7a4f35'), needle = rgb('#3b5a2e');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0, 13, 0], 0.4, 0.25, 3, mul(bark, 0.8), bark);
        b.blob([0, 15, 0], [3.4, 3.0, 3.4], needle, K_NEEDLE, needle, 0, 0.18);
        return;
      }
      const rng = b.rng;
      b.cylinder([0, 0, 0], [0, 16.5, 0], 0.45, 0.18, 6, mul(bark, 0.75), bark);
      for (let i = 0; i < 5; i++) {
        const a = rng.next() * Math.PI * 2;
        const y = 11.5 + i * 1.3;
        const rr = i === 4 ? 0 : 1.4 + rng.next() * 0.9;
        if (i < 4) b.cylinder([0, y - 0.8, 0], [Math.cos(a) * rr, y, Math.sin(a) * rr], 0.18, 0.08, 4, bark, bark);
        b.blob([Math.cos(a) * rr, y + 0.4, Math.sin(a) * rr], [2.0 - i * 0.15, 1.3, 2.0 - i * 0.15], mul(needle, 0.9 + rng.next() * 0.2), K_NEEDLE, needle, 0, 0.3, 0.55);
      }
    },
  },
  spruce: {
    height: 17,
    build: (b, lod) => {
      const needle = rgb('#2f4f33');
      if (lod === 1) {
        b.cylinder([0, 0, 0], [0, 2, 0], 0.35, 0.3, 3, BARK_DARK, BARK_DARK);
        b.cone([0, 1.4, 0], 15.6, 3.4, 6, needle, K_NEEDLE, 0.1);
        return;
      }
      b.cylinder([0, 0, 0], [0, 3, 0], 0.4, 0.34, 6, BARK_DARK, BARK_DARK);
      const layers = 6;
      for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const y = 1.3 + t * 12.5;
        const r = 3.6 * (1 - t * 0.82);
        b.cone([0, y, 0], 4.6 - t * 1.4, r, 8, mul(needle, 0.9 + t * 0.25), K_NEEDLE, 0.35);
      }
    },
  },
  cypress: {
    height: 13,
    build: (b, lod) => {
      const needle = rgb('#3a5a2f');
      if (lod === 1) {
        b.blob([0, 6.5, 0], [1.3, 6.5, 1.3], needle, K_NEEDLE, needle, 0, 0.08);
        return;
      }
      b.cylinder([0, 0, 0], [0, 1.2, 0], 0.3, 0.25, 5, BARK_DARK, BARK_DARK);
      b.blob([0, 5.6, 0], [1.45, 5.0, 1.45], needle, K_NEEDLE, needle, 1, 0.12);
      b.blob([0.15, 9.8, 0.1], [0.95, 3.0, 0.95], mul(needle, 1.08), K_NEEDLE, needle, 0, 0.15);
    },
  },
  palm: {
    height: 11,
    build: (b, lod) => {
      const trunk = rgb('#8a7457'), frond = rgb('#4f7d2c');
      const rng = b.rng;
      const segs = lod === 0 ? 6 : 2;
      let prev: V3 = [0, 0, 0];
      const bend = 1.4;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const p: V3 = [bend * t * t, t * 10, 0];
        b.cylinder(prev, p, 0.34 - t * 0.1, 0.32 - t * 0.1, lod === 0 ? 6 : 3, mul(trunk, i % 2 ? 0.85 : 1), trunk);
        prev = p;
      }
      // distant palms: fewer, coarser fronds (the far model is drawn tens of thousands of times)
      const n = lod === 0 ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const yaw = (i / n) * Math.PI * 2 + rng.next() * 0.3;
        b.frond(prev, yaw, 4.8 + rng.next() * 1.2, lod === 0 ? 0.75 : 0.95, 0.9 + rng.next() * 0.4, mul(frond, 0.9 + rng.next() * 0.2), lod === 0 ? 5 : 2);
      }
      if (lod === 0) for (let i = 0; i < 3; i++) b.blob([prev[0] + Math.cos(i * 2.1) * 0.35, prev[1] - 0.35, Math.sin(i * 2.1) * 0.35], [0.22, 0.22, 0.22], rgb('#5a4a2a'), K_BARK, [0, 0, 0], 0, 0.1);
    },
  },
  cactus: {
    height: 6,
    build: (b, lod) => {
      const green = rgb('#557a3a');
      const sides = lod === 0 ? 8 : 5;
      b.cylinder([0, 0, 0], [0, 5.6, 0], 0.45, 0.4, sides, mul(green, 0.85), green, K_CACTUS, true);
      b.blob([0, 5.6, 0], [0.4, 0.3, 0.4], green, K_CACTUS, green, 0, 0.05);
      const arms = lod === 0 ? 2 : 1;
      for (let i = 0; i < arms; i++) {
        const s = i === 0 ? 1 : -1;
        const y = 2.2 + i * 0.9;
        b.cylinder([0, y, 0], [s * 1.3, y + 0.2, 0], 0.3, 0.28, sides, green, green, K_CACTUS);
        b.cylinder([s * 1.3, y + 0.1, 0], [s * 1.35, y + 2.2 - i * 0.4, 0], 0.29, 0.26, sides, green, green, K_CACTUS, true);
      }
    },
  },
  rock: {
    height: 2,
    build: (b, lod) => {
      const c = rgb('#8c877e');
      b.blob([0, 0.45, 0], [1.3, 0.85, 1.1], c, K_ROCK, c, lod === 0 ? 1 : 0, 0.3, 0.55);
    },
  },
};

/** nominal model height at scale 1 (m) */
export function propHeight(kind: PropKind): number {
  return SPECIES[kind].height;
}

/** Build both LODs of every prop kind. */
export function buildPropModels(): Record<PropKind, [THREE.BufferGeometry, THREE.BufferGeometry]> {
  const out = {} as Record<PropKind, [THREE.BufferGeometry, THREE.BufferGeometry]>;
  PROP_KINDS.forEach((k, i) => {
    const def = SPECIES[k];
    const g0 = new Builder(def.height, new RNG(1000 + i * 17));
    def.build(g0, 0);
    const g1 = new Builder(def.height, new RNG(1000 + i * 17));
    def.build(g1, 1);
    out[k] = [g0.build(), g1.build()];
  });
  return out;
}

export const PROP_KIND_CODES = { K_BARK, K_LEAF, K_NEEDLE, K_BLOSSOM, K_FROND, K_CACTUS, K_ROCK, K_EVERGREEN };
