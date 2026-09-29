// Props for service models: theme trees, shrubs, flowers, street furniture,
// people and vehicles. Everything is built in the Kit's current frame.
// Trees are cached as templates per species/variant/detail and merged in.
import * as THREE from 'three';
import { RNG } from '../../../core/rng';
import type { TreeSpecies } from '../../../core/types';
import type { ModelContext } from '../types';
import { ModelBuilder, type ColorLike } from '../ModelBuilder';
import { Kit, type P2, type V3 } from './kit';
import { C, jitter, mix, shade } from './colors';

// ── foliage blobs ─────────────────────────────────────────────────────────
const _ico = new Map<number, THREE.BufferGeometry>();
function icoBase(detail: number): THREE.BufferGeometry {
  let g = _ico.get(detail);
  if (!g) {
    g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
    _ico.set(detail, g);
  }
  return g;
}

/** Lumpy foliage clump with baked ambient-occlusion shading (darker below). */
export function foliageBlob(k: ModelBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: ColorLike, seed: number, lumpy = 0.22, detail = 1): void {
  const base = icoBase(detail);
  const src = base.getAttribute('position') as THREE.BufferAttribute;
  const n = src.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const c = new THREE.Color(color as THREE.ColorRepresentation);
  const s1 = seed * 1.37 + 0.3, s2 = seed * 2.11 + 1.1, s3 = seed * 0.73 + 2.4;
  for (let i = 0; i < n; i++) {
    const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    const bump = 1 + lumpy * (Math.sin(x * 3.1 + s1) * Math.sin(y * 2.7 + s2) * Math.sin(z * 3.3 + s3) * 1.6 + Math.sin(x * 5.3 + y * 4.1 + s3) * 0.35);
    pos[i * 3] = cx + x * rx * bump;
    pos[i * 3 + 1] = cy + y * ry * bump;
    pos[i * 3 + 2] = cz + z * rz * bump;
    const nx = x / rx, ny = y / ry, nz = z / rz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / l;
    nrm[i * 3 + 1] = ny / l;
    nrm[i * 3 + 2] = nz / l;
    const ao = 0.62 + 0.38 * (y * 0.5 + 0.5);
    col[i * 3] = ao;
    col[i * 3 + 1] = ao;
    col[i * 3 + 2] = ao * 0.96;
    uv[i * 2] = (Math.atan2(z, x) / Math.PI) * rx * 2;
    uv[i * 2 + 1] = y * ry * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  k.addGeometry('foliage', g, c);
  g.dispose();
}

// ── tree templates ────────────────────────────────────────────────────────
const treeCache = new Map<string, Kit>();

function tctx(ctx: ModelContext, seed: number): ModelContext {
  return { ...ctx, rng: new RNG(seed), b: null };
}

function buildTree(ctx: ModelContext, sp: TreeSpecies, variant: number): Kit {
  const k = new Kit(tctx(ctx, 1000 + variant * 97 + sp.length * 13));
  const r = k.ctx.rng;
  const lo = k.lo;
  const det = lo ? 0 : 1;
  const tseg = lo ? 5 : 7;
  const trunk = (h: number, r0: number, r1: number, col: ColorLike = C.bark) => k.cyl('bark', 0, -0.3, 0, r0, r1, h + 0.3, col, tseg, false);
  switch (sp) {
    case 'oak':
    case 'maple':
    case 'cherry': {
      const h = r.range(2.6, 3.4);
      trunk(h + 1.2, 0.38, 0.24, sp === 'cherry' ? 0x4b3326 : C.bark);
      const base = sp === 'cherry' ? mix(0xf3b6c8, 0xf7d3de, r.next() * 0.5) : sp === 'maple' ? mix(0x5d8a34, 0x7a8f2e, r.next()) : mix(0x4d7a30, 0x5f8a36, r.next());
      const R = r.range(2.8, 3.4);
      if (!lo) {
        k.pipe('bark', [0, h * 0.8, 0], [1.2, h + 1.4, 0.3], 0.14, C.bark, 5);
        k.pipe('bark', [0, h * 0.85, 0], [-0.9, h + 1.6, -0.6], 0.13, C.bark, 5);
      }
      foliageBlob(k, 0, h + R * 0.72, 0, R, R * 0.82, R, base, variant * 3 + 1, 0.2, det);
      if (!lo) {
        foliageBlob(k, R * 0.55, h + R * 0.45, R * 0.25, R * 0.62, R * 0.55, R * 0.62, jitter(base, () => r.next(), 0.08), variant * 3 + 2, 0.25, det);
        foliageBlob(k, -R * 0.5, h + R * 0.55, -R * 0.35, R * 0.6, R * 0.52, R * 0.6, jitter(base, () => r.next(), 0.08), variant * 3 + 3, 0.25, det);
      }
      break;
    }
    case 'birch': {
      const h = r.range(6.5, 8);
      trunk(h, 0.2, 0.1, 0xe8e4dc);
      if (!lo) for (let i = 0; i < 4; i++) k.cyl('plain', 0, 0.8 + i * 1.5 + r.next() * 0.5, 0, 0.205, 0.2, 0.18, 0x2d2a28, 6, false);
      const base = mix(0x7aa33c, 0x93b34a, r.next());
      foliageBlob(k, 0, h * 0.72, 0, 1.9, 3.2, 1.9, base, variant + 11, 0.24, det);
      if (!lo) foliageBlob(k, 0.6, h * 0.5, 0.3, 1.3, 1.8, 1.3, shade(base, 0.95), variant + 12, 0.25, det);
      break;
    }
    case 'pine': {
      const h = r.range(7, 9);
      trunk(h, 0.3, 0.16, 0x6a4a34);
      const base = mix(0x2f5a2c, 0x3b6630, r.next());
      const tiers = lo ? 2 : 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / Math.max(1, tiers - 1);
        const y = h * 0.45 + t * h * 0.55;
        const rr = 2.6 * (1 - t * 0.65);
        k.cyl('foliage', 0, y, 0, rr, 0.15, rr * 1.1, shade(base, 0.88 + t * 0.15), tseg + 2, false, true);
      }
      break;
    }
    case 'spruce': {
      const h = r.range(9, 12);
      trunk(h * 0.3, 0.28, 0.2, 0x5a3f2c);
      const base = mix(0x234a2a, 0x2c5530, r.next());
      const tiers = lo ? 3 : 6;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const y = 0.6 + t * h * 0.8;
        const rr = 2.5 * (1 - t * 0.82);
        k.cyl('foliage', 0, y, 0, rr, 0.05, h * 0.32 * (1 - t * 0.4), shade(base, 0.85 + t * 0.2), tseg + 1, false, true);
      }
      break;
    }
    case 'cypress': {
      const h = r.range(9, 12);
      trunk(1.2, 0.22, 0.18);
      const base = mix(0x2a4a28, 0x355530, r.next());
      foliageBlob(k, 0, h * 0.5, 0, 0.95, h * 0.5, 0.95, base, variant + 21, 0.12, det);
      k.cyl('foliage', 0, h * 0.82, 0, 0.55, 0.02, h * 0.28, shade(base, 1.05), tseg, false);
      break;
    }
    case 'olive': {
      const h = r.range(1.6, 2.2);
      k.pipe('bark', [0, -0.3, 0], [0.5, h, 0.2], 0.28, 0x6b5b4b, tseg);
      k.pipe('bark', [0, -0.3, 0], [-0.4, h + 0.3, -0.3], 0.24, 0x6b5b4b, tseg);
      const base = mix(0x7d8f5d, 0x93a06e, r.next());
      foliageBlob(k, 0.2, h + 1.6, 0, 2.8, 1.5, 2.6, base, variant + 31, 0.3, det);
      if (!lo) foliageBlob(k, -0.8, h + 1.2, -0.6, 1.8, 1.2, 1.7, shade(base, 0.92), variant + 32, 0.3, det);
      break;
    }
    case 'acacia': {
      const h = r.range(4, 5);
      k.pipe('bark', [0, -0.3, 0], [0.2, h * 0.55, 0], 0.26, 0x5e4a37, tseg);
      k.pipe('bark', [0.2, h * 0.55, 0], [1.6, h, 0.6], 0.16, 0x5e4a37, tseg);
      k.pipe('bark', [0.2, h * 0.55, 0], [-1.4, h + 0.2, -0.4], 0.16, 0x5e4a37, tseg);
      const base = mix(0x6a8a3a, 0x7d8f40, r.next());
      foliageBlob(k, 0, h + 0.7, 0, 4.2, 0.9, 3.8, base, variant + 41, 0.2, det);
      break;
    }
    case 'willow': {
      const h = r.range(2.6, 3.2);
      trunk(h + 1, 0.42, 0.3, 0x55463a);
      const base = mix(0x7c9e46, 0x8fae55, r.next());
      foliageBlob(k, 0, h + 2.2, 0, 3.4, 2.4, 3.4, base, variant + 51, 0.18, det);
      k.rev('foliage', 0, 0.9, 0, [[4.1, 0], [3.9, 1.6], [3.4, 3.4], [2.4, 4.4]], shade(base, 0.9), k.seg(14), { crease: 80 });
      k.rev('foliage', 0, 0.9, 0, [[4.0, 0], [3.8, 1.6], [3.3, 3.4], [2.3, 4.4]], shade(base, 0.7), k.seg(14), { crease: 80, inside: true });
      break;
    }
    case 'palm': {
      const h = r.range(8, 10.5);
      const lean = r.range(0.6, 1.6);
      const pts: V3[] = [];
      const n = lo ? 3 : 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([lean * t * t, -0.3 + t * (h + 0.3), 0]);
      }
      for (let i = 0; i < n; i++) k.pipe('bark', pts[i], pts[i + 1], 0.3 - 0.1 * (i / n), 0x8a7458, tseg);
      const top = pts[n];
      const base = mix(0x3f7a30, 0x4f8a36, r.next());
      const fronds = lo ? 6 : 9;
      for (let f = 0; f < fronds; f++) {
        const a = (f / fronds) * Math.PI * 2 + r.next() * 0.3;
        const len = r.range(4.2, 5.4);
        palmFrond(k, top, a, len, jitter(base, () => r.next(), 0.1), r.range(0.2, 0.6));
      }
      if (!lo) for (let i = 0; i < 3; i++) k.ball('plain', top[0] + Math.cos(i * 2.1) * 0.35, top[1] - 0.3, top[2] + Math.sin(i * 2.1) * 0.35, 0.22, 0x5a4a2a, 6, 4);
      break;
    }
    case 'cactus': {
      const h = r.range(4, 6);
      const col = mix(0x4f7d3e, 0x5f8a48, r.next());
      k.rev('foliage', 0, -0.2, 0, [[0.38, 0], [0.38, h - 0.35], [0.26, h - 0.08], [0.0, h]], col, tseg + 3, { crease: 70 });
      const arm = (side: number, y: number, len: number) => {
        k.pipe('foliage', [0, y, 0], [side * 0.95, y, 0], 0.24, col, tseg);
        k.rev('foliage', side * 1.0, y - 0.25, 0, [[0.25, 0], [0.25, len - 0.2], [0.16, len - 0.05], [0, len]], col, tseg, { crease: 70 });
      };
      arm(1, h * 0.45, h * 0.35);
      if (!lo) arm(-1, h * 0.6, h * 0.25);
      break;
    }
  }
  return k;
}

function palmFrond(k: Kit, top: V3, a: number, len: number, color: ColorLike, droop: number): void {
  const ca = Math.cos(a), sa = Math.sin(a);
  const segs = 4;
  const pts: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const d = t * len;
    pts.push([top[0] + ca * d, top[1] + 0.4 + Math.sin(t * Math.PI * 0.6) * 1.2 - t * t * (1.8 + droop * 2), top[2] + sa * d]);
  }
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const w0 = Math.sin(Math.max(0.15, t0) * Math.PI) * 0.9, w1 = Math.sin(Math.min(0.95, t1) * Math.PI) * 0.9;
    const p0 = pts[i], p1 = pts[i + 1];
    const A = { x: p0[0] - sa * w0, y: p0[1] - 0.15, z: p0[2] + ca * w0 };
    const B = { x: p0[0] + sa * w0, y: p0[1] - 0.15, z: p0[2] - ca * w0 };
    const Cc = { x: p1[0] + sa * w1, y: p1[1] - 0.15, z: p1[2] - ca * w1 };
    const Dd = { x: p1[0] - sa * w1, y: p1[1] - 0.15, z: p1[2] + ca * w1 };
    const M0 = { x: p0[0], y: p0[1], z: p0[2] }, M1 = { x: p1[0], y: p1[1], z: p1[2] };
    const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // two halves folded along the rib (V shape), both sides visible
    k.quad('foliage', A, M0, M1, Dd, uv, color, { x: 0, y: 1, z: 0 });
    k.quad('foliage', M0, B, Cc, M1, uv, color, { x: 0, y: 1, z: 0 });
    k.quad('foliage', A, M0, M1, Dd, uv, shade(color, 0.75), { x: 0, y: -1, z: 0 });
    k.quad('foliage', M0, B, Cc, M1, uv, shade(color, 0.75), { x: 0, y: -1, z: 0 });
  }
}

/** Add a theme tree at (x, z) in the current frame. */
export function tree(k: Kit, sp: TreeSpecies, x: number, z: number, scale = 1, rotY = 0, variant = 0): void {
  const key = `${sp}:${variant % 3}:${k.ctx.detail}`;
  let t = treeCache.get(key);
  if (!t) {
    t = buildTree(k.ctx, sp, variant % 3);
    treeCache.set(key, t);
  }
  k.pushTRS(x, 0, z, rotY, scale);
  k.merge(t);
  k.pop();
}

/** Pick a theme species (optionally restricted to broadleaf / conifer / decorative). */
export function themeTree(ctx: ModelContext, kind: 'any' | 'shade' | 'formal' | 'conifer' = 'any'): TreeSpecies {
  const trees = ctx.theme.trees;
  const shade: TreeSpecies[] = ['oak', 'maple', 'willow', 'cherry', 'acacia', 'olive', 'palm', 'birch'];
  const formal: TreeSpecies[] = ['cypress', 'palm', 'birch', 'cherry', 'maple', 'oak'];
  const conifer: TreeSpecies[] = ['spruce', 'pine', 'cypress'];
  const want = kind === 'shade' ? shade : kind === 'formal' ? formal : kind === 'conifer' ? conifer : null;
  const opts = want ? trees.filter((t) => want.includes(t) && t !== 'cactus') : trees.filter((t) => t !== 'cactus' || ctx.theme.id === 'desert');
  return ctx.rng.pick(opts.length ? opts : trees);
}

/** Scatter trees in a rectangle (in current frame), avoiding a keep-out test. */
export function treeGrove(k: Kit, cx: number, cz: number, w: number, d: number, count: number, kind: 'any' | 'shade' | 'formal' | 'conifer' = 'any', avoid?: (x: number, z: number) => boolean, scale: [number, number] = [0.8, 1.2]): void {
  const r = k.ctx.rng;
  const n = k.lo ? Math.ceil(count * 0.5) : count;
  let placed = 0;
  for (let tries = 0; tries < n * 6 && placed < n; tries++) {
    const x = cx + r.range(-w / 2, w / 2), z = cz + r.range(-d / 2, d / 2);
    if (avoid && avoid(x, z)) continue;
    tree(k, themeTree(k.ctx, kind), x, z, r.range(scale[0], scale[1]), r.range(0, Math.PI * 2), r.int(0, 2));
    placed++;
  }
}

/** small shrub */
export function bush(k: Kit, x: number, z: number, r = 0.9, color: ColorLike = 0x4a7a36, seed = 0): void {
  foliageBlob(k, x, r * 0.55, z, r, r * 0.7, r, color, seed + 7, 0.25, k.lo ? 0 : 1);
}

/** bed of flowers: soil patch + colourful dots */
export function flowerBed(k: Kit, cx: number, cz: number, w: number, d: number, palette: number[] = [0xe0414f, 0xf2c230, 0xb05cc8, 0xf5f0f0, 0xf07a3a], rows = 0): void {
  k.box('dirt', cx, 0, cz, w, 0.22, d, 0x5b4432, { top: 'dirt' });
  const r = k.ctx.rng;
  const nx = Math.max(1, Math.round(w / 0.9)), nz = rows || Math.max(1, Math.round(d / 0.9));
  if (k.lo) {
    k.box('foliage', cx, 0.22, cz, w - 0.2, 0.25, d - 0.2, palette[0]);
    return;
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const col = palette[(Math.floor(j * palette.length / nz) + (rows ? 0 : r.int(0, 1))) % palette.length];
      const x = cx - w / 2 + (i + 0.5) * (w / nx), z = cz - d / 2 + (j + 0.5) * (d / nz);
      foliageBlob(k, x, 0.38, z, 0.42, 0.26, 0.42, jitter(col, () => r.next(), 0.1), i * 7 + j, 0.3, 0);
    }
}

// ── street furniture ──────────────────────────────────────────────────────
export function lampPost(k: Kit, x: number, z: number, h = 4.6, color: ColorLike = 0x2a2e33, light = C.lampWarm, style: 'modern' | 'classic' = 'classic'): void {
  k.cyl('metal', x, 0, z, 0.1, 0.07, h, color, 6);
  if (style === 'classic') {
    k.cyl('metal', x, 0, z, 0.2, 0.14, 0.6, color, 6);
    k.cyl('emissive', x, h, z, 0.18, 0.26, 0.55, 0xfff1d0, 6);
    k.cyl('metal', x, h + 0.55, z, 0.32, 0.05, 0.3, color, 6);
    k.light(x, h + 0.3, z, light, 3.2, 'lamp');
  } else {
    k.box('metal', x + 0.5, h - 0.05, z, 1.2, 0.12, 0.14, color);
    k.box('emissive', x + 0.9, h - 0.14, z, 0.55, 0.1, 0.24, 0xfff6e4);
    k.light(x + 0.9, h - 0.25, z, light, 3.4, 'lamp');
  }
}

export function bench(k: Kit, x: number, z: number, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    k.box('wood', 0, 0.42, 0, 1.7, 0.07, 0.45, C.woodLight);
    k.box('wood', 0, 0.55, -0.24, 1.7, 0.4, 0.06, C.woodLight, { top: 'wood' });
    k.box('metal', -0.72, 0, 0, 0.06, 0.45, 0.45, 0x2b2b2b);
    k.box('metal', 0.72, 0, 0, 0.06, 0.45, 0.45, 0x2b2b2b);
  });
}

export function picnicTable(k: Kit, x: number, z: number, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    k.box('wood', 0, 0.72, 0, 1.9, 0.06, 0.8, C.wood);
    k.box('wood', 0, 0.42, 0.62, 1.9, 0.05, 0.3, C.wood);
    k.box('wood', 0, 0.42, -0.62, 1.9, 0.05, 0.3, C.wood);
    k.box('wood', -0.7, 0, 0, 0.08, 0.72, 1.5, C.woodDark, { top: false });
    k.box('wood', 0.7, 0, 0, 0.08, 0.72, 1.5, C.woodDark, { top: false });
  });
}

export function trashBin(k: Kit, x: number, z: number, color: ColorLike = 0x2f4a3a): void {
  k.cyl('metal', x, 0, z, 0.28, 0.3, 0.95, color, 7);
}

/** simple fence along a polyline: posts + two rails */
export function fence(k: Kit, pts: P2[], h = 1.8, color: ColorLike = 0x5d6166, step = 2.6, mat: 'metal' | 'wood' = 'metal', closed = false): void {
  const all = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < all.length - 1; i++) {
    const [ax, az] = all[i], [bx, bz] = all[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let s = 0; s <= n; s++) {
      if (s === n && i < all.length - 2) continue;
      const t = s / n;
      k.box(mat, ax + (bx - ax) * t, 0, az + (bz - az) * t, 0.1, h, 0.1, color);
    }
    k.beam(mat, [ax, h - 0.1, az], [bx, h - 0.1, bz], 0.06, 0.06, color);
    k.beam(mat, [ax, h * 0.45, az], [bx, h * 0.45, bz], 0.05, 0.05, color);
    if (!k.lo && mat === 'metal') k.beam('metal', [ax, 0.15, az], [bx, 0.15, bz], 0.04, 0.04, color);
  }
}

/** masonry / concrete wall along a polyline */
export function wallLine(k: Kit, pts: P2[], h: number, t: number, color: ColorLike, mat: 'concrete' | 'wall_stone' | 'plain' | 'wall_brick' = 'concrete', closed = false): void {
  const all = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < all.length - 1; i++) {
    const [ax, az] = all[i], [bx, bz] = all[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(-(bz - az), bx - ax);
    k.pushTRS((ax + bx) / 2, 0, (az + bz) / 2, ang);
    k.box(mat, 0, 0, 0, len + t, h, t, color);
    k.pop();
  }
}

export function hedge(k: Kit, cx: number, cz: number, w: number, d: number, h = 1.1, color: ColorLike = C.hedge): void {
  k.box('foliage', cx, 0, cz, w, h, d, color);
}

export function flagpole(k: Kit, x: number, z: number, h: number, flag: ColorLike, flag2?: ColorLike, rotY = 0): void {
  k.cyl('metal', x, 0, z, 0.09, 0.06, h, 0xd8dade, 6);
  k.ball('metal', x, h + 0.08, z, 0.12, C.gold, 6, 4);
  k.at(x, 0, z, rotY, () => {
    const fw = h * 0.22, fh = fw * 0.62;
    // slight wave: two panels
    k.quad('plain', { x: 0.05, y: h - fh, z: 0 }, { x: fw * 0.5, y: h - fh - 0.1, z: 0.12 }, { x: fw * 0.5, y: h - 0.1, z: 0.12 }, { x: 0.05, y: h, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], flag);
    k.quad('plain', { x: fw * 0.5, y: h - fh - 0.1, z: 0.12 }, { x: fw, y: h - fh - 0.25, z: -0.05 }, { x: fw, y: h - 0.25, z: -0.05 }, { x: fw * 0.5, y: h - 0.1, z: 0.12 }, [[0, 0], [1, 0], [1, 1], [0, 1]], flag2 ?? flag);
    k.quad('plain', { x: 0.05, y: h, z: 0 }, { x: fw * 0.5, y: h - 0.1, z: 0.12 }, { x: fw * 0.5, y: h - fh - 0.1, z: 0.12 }, { x: 0.05, y: h - fh, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], shade(flag, 0.8));
    k.quad('plain', { x: fw * 0.5, y: h - 0.1, z: 0.12 }, { x: fw, y: h - 0.25, z: -0.05 }, { x: fw, y: h - fh - 0.25, z: -0.05 }, { x: fw * 0.5, y: h - fh - 0.1, z: 0.12 }, [[0, 0], [1, 0], [1, 1], [0, 1]], shade(flag2 ?? flag, 0.8));
  });
}

/** tiny human figure (1.75 m) */
export function person(k: Kit, x: number, z: number, shirt: ColorLike, rotY = 0, sitting = false): void {
  const skin = [0xe8c4a0, 0xc68e62, 0x8d5a3b, 0xf0d2b6][Math.floor(Math.abs(x * 7.3 + z * 3.1)) % 4];
  const h = sitting ? 0.5 : 0;
  k.at(x, 0, z, rotY, () => {
    if (!sitting) {
      k.box('plain', -0.1, 0, 0, 0.14, 0.85, 0.2, 0x2e3440, { top: false });
      k.box('plain', 0.1, 0, 0, 0.14, 0.85, 0.2, 0x2e3440, { top: false });
    }
    k.box('plain', 0, 0.85 - h, 0, 0.44, 0.6, 0.26, shirt);
    k.ball('plain', 0, 1.6 - h, 0, 0.13, skin, 6, 4);
  });
}

/** crowd of people scattered in a rectangle */
export function crowd(k: Kit, cx: number, cz: number, w: number, d: number, n: number): void {
  if (k.lo) return;
  const r = k.ctx.rng;
  const shirts = [0xd04040, 0x3a6fd8, 0xf2c230, 0xf4f4f0, 0x2f9a5a, 0xe58ab0, 0x333333, 0xff8a3a];
  for (let i = 0; i < n; i++) person(k, cx + r.range(-w / 2, w / 2), cz + r.range(-d / 2, d / 2), r.pick(shirts), r.range(0, 6.28));
}

// ── vehicles (length along local +X, centred) ─────────────────────────────
function wheels(k: Kit, len: number, width: number, r: number, axles: number[] = [-0.33, 0.33]): void {
  if (k.lo) return;
  for (const ax of axles)
    for (const s of [-1, 1]) {
      k.push(new THREE.Matrix4().makeTranslation(ax * len, r, (s * width) / 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      k.cylinder('plain', 0, -0.13, 0, r, r, 0.26, 0x1c1c1e, 8, { top: true, bottom: true });
      k.pop();
    }
}

export function car(k: Kit, x: number, z: number, rotY: number, color: ColorLike, kind: 'sedan' | 'suv' | 'hatch' = 'sedan'): void {
  const L = kind === 'suv' ? 4.7 : kind === 'hatch' ? 3.9 : 4.5, Wd = 1.8;
  const H = kind === 'suv' ? 1.05 : 0.8;
  k.at(x, 0, z, rotY, () => {
    k.box('plain', 0, 0.28, 0, L, H - 0.28 + 0.2, Wd, color);
    const cl = kind === 'hatch' ? L * 0.6 : L * 0.52;
    const cx = kind === 'hatch' ? -L * 0.1 : -L * 0.04;
    k.box('glass', cx, H + 0.2, 0, cl, 0.55, Wd * 0.9, 0x2c3a46, { top: 'plain', topColor: color });
    wheels(k, L, Wd, 0.33);
  });
}

/** random parked cars along a line (rotated), with gaps */
export function parkedCars(k: Kit, x0: number, z0: number, x1: number, z1: number, spacing: number, rotY: number, fill = 0.7): void {
  const r = k.ctx.rng;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / spacing));
  const cols = [0xd8d8d8, 0x2a2a2e, 0x8a0f15, 0x1f3f7a, 0xb0b4b8, 0xf4f4f0, 0x3d5a3d, 0x7a6a50, 0x2e6f9e, 0xc9a13b];
  for (let i = 0; i < n; i++) {
    if (!r.chance(fill)) continue;
    const t = (i + 0.5) / n;
    car(k, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rotY, r.pick(cols), r.pick(['sedan', 'suv', 'hatch'] as const));
  }
}

/** parking lot with stalls (stalls face ±Z), rows along X */
export function parkingLot(k: Kit, cx: number, cz: number, w: number, d: number, fill = 0.65, y = 0.06): void {
  k.slab('asphalt', cx, cz, w, d, y, C.asphalt, 0.6);
  const stallW = 2.6, stallD = 5;
  const rows = Math.max(1, Math.floor(d / (stallD * 2 + 6)));
  const n = Math.max(1, Math.floor((w - 1) / stallW));
  const r = k.ctx.rng;
  const cols = [0xd8d8d8, 0x2a2a2e, 0x8a0f15, 0x1f3f7a, 0xb0b4b8, 0xf4f4f0, 0x3d5a3d, 0x2e6f9e, 0xc9a13b];
  for (let row = 0; row < rows; row++) {
    const zc = cz - d / 2 + (row + 0.5) * (d / rows);
    for (const side of [-1, 1]) {
      const zs = zc + side * (stallD / 2 + 3);
      for (let i = 0; i <= n; i++) {
        const x = cx - (n * stallW) / 2 + i * stallW;
        k.paint(x, zs - stallD / 2, x, zs + stallD / 2, 0.12, y + 0.02);
      }
      for (let i = 0; i < n; i++) {
        if (!r.chance(fill)) continue;
        const x = cx - (n * stallW) / 2 + (i + 0.5) * stallW;
        car(k, x, zs, side > 0 ? Math.PI / 2 : -Math.PI / 2, r.pick(cols), r.pick(['sedan', 'suv', 'hatch'] as const));
      }
    }
  }
}

export function van(k: Kit, x: number, z: number, rotY: number, color: ColorLike, stripe?: ColorLike): void {
  k.at(x, 0, z, rotY, () => {
    k.box('plain', -0.3, 0.35, 0, 4.2, 2.0, 1.95, color);
    k.box('plain', 2.1, 0.35, 0, 0.9, 1.2, 1.9, color);
    k.box('glass', 1.75, 1.35, 0, 0.7, 0.7, 1.8, 0x2c3a46, { top: false });
    if (stripe !== undefined) {
      k.box('plain', -0.3, 1.05, 0, 4.22, 0.28, 1.97, stripe, { top: false });
    }
    wheels(k, 5, 1.9, 0.36, [-0.3, 0.33]);
  });
}

export function ambulance(k: Kit, x: number, z: number, rotY: number): void {
  van(k, x, z, rotY, 0xf4f4f0, 0xd42a2a);
  k.at(x, 0, z, rotY, () => {
    k.box('emissive', 0.8, 2.35, 0, 0.3, 0.14, 1.4, 0xff3030);
    k.box('emissive', -0.3, 1.3, 0.99, 0.5, 0.5, 0.02, 0xd42a2a);
  });
}

export function policeCar(k: Kit, x: number, z: number, rotY: number, dark = false): void {
  car(k, x, z, rotY, dark ? 0x1b2330 : 0xf2f2f2);
  k.at(x, 0, z, rotY, () => {
    k.box('plain', 0.25, 0.5, 0, 1.6, 0.42, 1.82, dark ? 0xf2f2f2 : C.policeBlue, { top: false });
    k.box('emissive', -0.2, 1.57, -0.28, 0.25, 0.12, 0.5, 0x2a5aff);
    k.box('emissive', -0.2, 1.57, 0.28, 0.25, 0.12, 0.5, 0xff2a2a);
  });
}

export function fireTruck(k: Kit, x: number, z: number, rotY: number, ladder = true): void {
  k.at(x, 0, z, rotY, () => {
    k.box('plain', -0.6, 0.45, 0, 6.6, 2.3, 2.45, C.fireRed);
    k.box('plain', 3.3, 0.45, 0, 1.9, 2.4, 2.45, C.fireRed);
    k.box('glass', 3.9, 1.6, 0, 0.8, 0.9, 2.3, 0x2c3a46, { top: false });
    k.box('plain', -0.6, 1.2, 0, 6.62, 0.14, 2.47, 0xf2f2f2, { top: false });
    k.box('emissive', 3.3, 2.85, 0, 0.3, 0.16, 1.8, 0xff2a2a);
    if (ladder) {
      k.box('metal', -0.3, 2.85, 0, 7.4, 0.2, 0.9, 0xc8ccd0);
      k.box('metal', -0.3, 3.05, -0.4, 7.4, 0.14, 0.08, 0xc8ccd0);
      k.box('metal', -0.3, 3.05, 0.4, 7.4, 0.14, 0.08, 0xc8ccd0);
    } else k.box('metal', -0.6, 2.75, 0, 6, 0.3, 2.2, 0x9a9ea3);
    wheels(k, 9, 2.4, 0.5, [-0.33, -0.2, 0.36]);
  });
}

export function bus(k: Kit, x: number, z: number, rotY: number, color: ColorLike = 0x2d7fd0, len = 12): void {
  k.at(x, 0, z, rotY, () => {
    k.box('plain', 0, 0.35, 0, len, 1.0, 2.5, color);
    k.box('glass', 0, 1.35, 0, len - 0.2, 1.2, 2.46, 0x2a3844, { top: false });
    k.box('plain', 0, 2.55, 0, len, 0.4, 2.5, shade(color, 1.1), { top: 'plain', topColor: 0xe8e8e8 });
    k.box('plain', len / 2 - 0.02, 1.35, 0, 0.06, 1.2, 2.3, color, { top: false });
    wheels(k, len, 2.5, 0.5, [-0.3, 0.32]);
  });
}

export function truck(k: Kit, x: number, z: number, rotY: number, cab: ColorLike, cargo: ColorLike, kind: 'box' | 'container' | 'tanker' | 'garbage' = 'box', len = 14): void {
  k.at(x, 0, z, rotY, () => {
    const cabX = len / 2 - 1.3;
    k.box('plain', cabX, 0.5, 0, 2.4, 2.6, 2.5, cab);
    k.box('glass', cabX + 0.9, 1.9, 0, 0.7, 0.9, 2.4, 0x2c3a46, { top: false });
    const bl = len - 3.1, bx = -1.5;
    if (kind === 'tanker') {
      k.push(new THREE.Matrix4().makeTranslation(bx, 2.1, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      k.cyl('metal', 0, -bl / 2, 0, 1.25, 1.25, bl, cargo, 12, true, true);
      k.pop();
      k.box('metal', bx, 0.7, 0, bl, 0.2, 1.4, 0x3a3a3a);
    } else if (kind === 'garbage') {
      k.box('plain', bx + 1.2, 0.6, 0, bl - 2.4, 2.8, 2.5, cargo);
      k.box('plain', bx - bl / 2 + 1.2, 0.6, 0, 2.4, 2.4, 2.4, shade(cargo, 0.8));
    } else {
      k.box(kind === 'container' ? 'metal' : 'plain', bx, 1.05, 0, bl, 2.7, 2.5, cargo);
      k.box('metal', bx, 0.6, 0, bl, 0.45, 2.1, 0x2a2a2a, { top: false });
    }
    wheels(k, len, 2.5, 0.5, kind === 'garbage' ? [-0.3, 0.35] : [-0.4, -0.3, 0.1, 0.38]);
  });
}

export function garbageTruck(k: Kit, x: number, z: number, rotY: number): void {
  truck(k, x, z, rotY, 0xf2f2f2, 0x3d8a4a, 'garbage', 9);
}

export function taxi(k: Kit, x: number, z: number, rotY: number): void {
  car(k, x, z, rotY, 0xf5c518);
  k.at(x, 0, z, rotY, () => k.box('emissive', -0.2, 1.55, 0, 0.35, 0.22, 0.7, 0xfff2b0));
}

export function tractor(k: Kit, x: number, z: number, rotY: number, color: ColorLike = 0x3f8a3a): void {
  k.at(x, 0, z, rotY, () => {
    k.box('plain', 0.6, 0.7, 0, 2.2, 1.0, 1.2, color);
    k.box('glass', -0.5, 0.7, 0, 1.3, 1.9, 1.3, 0x3a4a55, { top: 'plain', topColor: color });
    k.cyl('metal', 1.2, 1.7, 0.3, 0.08, 0.08, 0.9, 0x333333, 5);
    k.push(new THREE.Matrix4().makeTranslation(-0.6, 0.85, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.cylinder('plain', 0, -1.0, 0, 0.85, 0.85, 2.0, 0x1c1c1c, 10, { top: true, bottom: true });
    k.pop();
    k.push(new THREE.Matrix4().makeTranslation(1.3, 0.5, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.cylinder('plain', 0, -0.8, 0, 0.5, 0.5, 1.6, 0x1c1c1c, 8, { top: true, bottom: true });
    k.pop();
  });
}

/** rail car / tram / locomotive body (on the current frame's ground) */
export function railCar(k: Kit, x: number, z: number, rotY: number, color: ColorLike, len = 20, kind: 'coach' | 'loco' | 'tram' | 'flat' | 'hopper' | 'tank' = 'coach', accent: ColorLike = 0xf2f2f2): void {
  k.at(x, 0, z, rotY, () => {
    const h0 = kind === 'tram' ? 0.45 : 1.1;
    k.box('metal', 0, h0 - 0.5, 0, len * 0.92, 0.5, 2.2, 0x2a2a2a, { top: false });
    switch (kind) {
      case 'coach':
      case 'tram':
        k.box('plain', 0, h0, 0, len, 1.1, 2.9, color);
        k.box('glass', 0, h0 + 1.1, 0, len - 0.4, 1.05, 2.86, 0x2a3844, { top: false });
        k.box('plain', 0, h0 + 2.15, 0, len, 0.45, 2.9, accent, { top: 'metal', topColor: 0xb8bcc0 });
        if (kind === 'tram') k.beam('metal', [0, h0 + 2.6, 0], [0.8, h0 + 3.6, 0], 0.08, 0.08, 0x222222);
        break;
      case 'loco':
        k.box('plain', -1, h0, 0, len - 2, 2.9, 2.9, color, { top: 'metal', topColor: 0x55595e });
        k.box('plain', len / 2 - 1, h0, 0, 2, 2.2, 2.9, color);
        k.box('glass', len / 2 - 1.4, h0 + 2.2, 0, 1.2, 0.9, 2.8, 0x2a3844, { top: 'plain', topColor: color });
        k.box('plain', 0, h0 + 0.6, 0, len, 0.35, 2.92, accent, { top: false });
        break;
      case 'flat':
        k.box('metal', 0, h0, 0, len, 0.3, 2.8, color);
        break;
      case 'hopper':
        k.box('metal', 0, h0, 0, len, 2.6, 2.9, color, { top: 'dirt', topColor: 0x3a3430 });
        break;
      case 'tank':
        k.push(new THREE.Matrix4().makeTranslation(0, h0 + 1.4, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
        k.cyl('metal', 0, -len / 2, 0, 1.4, 1.4, len, color, 12, true, true);
        k.pop();
        break;
    }
  });
}

/** shipping container */
export function container(k: Kit, x: number, y: number, z: number, rotY: number, color: ColorLike, len = 12.2): void {
  k.pushTRS(x, y, z, rotY);
  k.box('metal', 0, 0, 0, len, 2.6, 2.45, color, { top: 'metal', topColor: shade(color, 0.9) });
  k.pop();
}

const CONTAINER_COLORS = [0xb33a2e, 0x2f5f9e, 0x3d8a4a, 0xd9a32b, 0x8a8f96, 0xe06a2a, 0x2a7f8a, 0x6a3f8a, 0xd8d8d8, 0x7a2a2a];
export function containerStack(k: Kit, cx: number, cz: number, rows: number, cols: number, maxH: number, rotY = 0, len = 12.2): void {
  const r = k.ctx.rng;
  k.at(cx, 0, cz, rotY, () => {
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const h = r.int(1, maxH);
        for (let l = 0; l < h; l++) container(k, (i - (rows - 1) / 2) * (len + 0.6), l * 2.6, (j - (cols - 1) / 2) * 2.55, 0, r.pick(CONTAINER_COLORS), len);
      }
  });
}

/** airliner (length along +X). size 1 ≈ 38 m narrow-body. */
export function airplane(k: Kit, x: number, z: number, rotY: number, size = 1, livery: ColorLike = 0x2f6fd0, y = 0): void {
  k.at(x, y, z, rotY, () => {
    const L = 38 * size, R = 2.0 * size;
    const fy = 2.8 * size;
    k.push(new THREE.Matrix4().makeTranslation(0, fy, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)));
    // fuselage along +X after rotation (local Y → world +X)
    k.rev('plain', 0, -L / 2, 0, [[0.05, 0], [R * 0.55, L * 0.02], [R * 0.9, L * 0.07], [R, L * 0.16], [R, L * 0.72], [R * 0.75, L * 0.86], [R * 0.25, L * 0.99], [0, L]], 0xf4f4f4, k.seg(12), { crease: 60 });
    k.pop();
    // cockpit windows + livery stripe
    k.box('glass', L / 2 - L * 0.06, fy + R * 0.25, 0, L * 0.05, R * 0.35, R * 1.2, 0x223040, { top: false });
    k.box('plain', 0, fy - R * 0.35, 0, L * 0.7, R * 0.35, R * 2.02, livery, { top: false });
    // wings (swept)
    const wy = fy - R * 0.5, span = 17 * size, root = 6 * size, tip = 1.8 * size, sweep = 5 * size;
    for (const s of [-1, 1]) {
      const A = { x: root * 0.5 - 1, y: wy, z: 0 }, B = { x: -root * 0.5 - 1, y: wy, z: 0 };
      const Cc = { x: -root * 0.5 - sweep - 1 + (root - tip) * 0.2, y: wy + 0.8 * size, z: s * span }, Dd = { x: -sweep - 1 + tip * 0.5, y: wy + 0.8 * size, z: s * span };
      k.quad('metal', A, B, Cc, Dd, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xd8dce0, { x: 0, y: 1, z: 0 });
      k.quad('metal', A, B, Cc, Dd, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xb8bcc0, { x: 0, y: -1, z: 0 });
      // engine
      k.push(new THREE.Matrix4().makeTranslation(-1.5, wy - 1.1 * size, s * span * 0.35).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)));
      k.cyl('metal', 0, -2.2 * size, 0, 0.95 * size, 0.85 * size, 4.4 * size, 0xc8ccd0, 10, true, true);
      k.pop();
      // tailplane
      const tx = -L / 2 + 2.5 * size, ty = fy + R * 0.2;
      k.quad('metal', { x: tx + 3 * size, y: ty, z: 0 }, { x: tx, y: ty, z: 0 }, { x: tx - 1 * size, y: ty + 0.3, z: s * 6 * size }, { x: tx + 0.8 * size, y: ty + 0.3, z: s * 6 * size }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xe0e2e4, { x: 0, y: 1, z: 0 });
      k.quad('metal', { x: tx + 3 * size, y: ty, z: 0 }, { x: tx, y: ty, z: 0 }, { x: tx - 1 * size, y: ty + 0.3, z: s * 6 * size }, { x: tx + 0.8 * size, y: ty + 0.3, z: s * 6 * size }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xb8bcc0, { x: 0, y: -1, z: 0 });
    }
    // fin
    const fx0 = -L / 2 + 1 * size;
    for (const sd of [1, -1])
      k.quad('plain', { x: fx0 + 5.5 * size, y: fy + R * 0.8, z: 0 }, { x: fx0, y: fy + R * 0.8, z: 0 }, { x: fx0 - 1.2 * size, y: fy + 8 * size, z: 0 }, { x: fx0 + 1.6 * size, y: fy + 8 * size, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], livery, { x: 0, y: 0, z: sd });
    k.light(fx0 - 0.6 * size, fy + 8 * size, 0, 0xff3030, 1.4, 'beacon', true);
    // gear
    if (!k.lo) {
      k.box('plain', L * 0.36, 0, 0, 0.5, fy - R, 0.4, 0x333333, { top: false });
      k.box('plain', -2, 0, -2.5 * size, 0.8, fy - R, 0.6, 0x333333, { top: false });
      k.box('plain', -2, 0, 2.5 * size, 0.8, fy - R, 0.6, 0x333333, { top: false });
    }
  });
}

/** helicopter (nose +X); rotor animated when `animate` */
export function helicopter(k: Kit, x: number, y: number, z: number, rotY: number, color: ColorLike, animate = true): void {
  k.at(x, y, z, rotY, () => {
    k.ball('plain', 0.4, 1.55, 0, 1.4, color, 10, 7, 0.8, 1);
    k.box('glass', 1.3, 1.3, 0, 0.9, 0.9, 1.4, 0x223040, { top: false });
    k.beam('plain', [-0.8, 1.7, 0], [-6, 2.2, 0], 0.35, 0.45, color);
    k.box('plain', -6, 2.1, 0, 0.8, 1.4, 0.15, color);
    k.box('metal', 0.2, 0.0, -0.9, 3.4, 0.1, 0.1, 0x333333);
    k.box('metal', 0.2, 0.0, 0.9, 3.4, 0.1, 0.1, 0x333333);
    k.box('metal', 0.2, 0.1, -0.9, 0.1, 0.5, 0.1, 0x333333);
    k.box('metal', 0.2, 0.1, 0.9, 0.1, 0.5, 0.1, 0x333333);
    k.cyl('metal', 0.3, 2.6, 0, 0.12, 0.12, 0.45, 0x333333, 6);
    const rotor = (kk: Kit) => {
      kk.box('metal', 0.3, 3.05, 0, 11, 0.06, 0.35, 0x2a2a2a);
      kk.box('metal', 0.3, 3.05, 0, 0.35, 0.06, 11, 0x2a2a2a);
    };
    if (animate) k.anim([0.3, 3.05, 0], [0, 1, 0], 2.5, rotor);
    else rotor(k);
    k.light(-6, 2.9, 0, 0xff3030, 1.2, 'beacon', true);
  });
}

/** boat hull (bow towards +X) with optional cabin; kind picks proportions */
export function boat(k: Kit, x: number, z: number, rotY: number, kind: 'yacht' | 'sail' | 'ferry' | 'tug' | 'pedal' | 'fishing', color: ColorLike = 0xf4f4f4, y = 0): void {
  const dims = { yacht: [16, 4.4, 1.6], sail: [11, 3.4, 1.2], ferry: [40, 11, 3.2], tug: [22, 7.5, 2.6], pedal: [3, 1.6, 0.5], fishing: [14, 4.6, 1.8] }[kind];
  const [L, B, H] = dims;
  k.at(x, y, z, rotY, () => {
    hull(k, L, B, H, color, kind === 'tug' ? 0x2a2a2a : kind === 'ferry' ? 0x1f3f7a : 0x2a4a7a);
    switch (kind) {
      case 'yacht':
        k.box('plain', -1, H, 0, L * 0.45, 1.3, B * 0.72, 0xf4f4f4);
        k.box('glass', -0.6, H + 0.2, 0, L * 0.47, 0.8, B * 0.74, 0x2a3844, { top: false });
        k.box('plain', -1.8, H + 1.3, 0, L * 0.26, 1.0, B * 0.6, 0xf4f4f4);
        k.box('glass', -1.5, H + 1.45, 0, L * 0.27, 0.6, B * 0.62, 0x2a3844, { top: false });
        break;
      case 'sail':
        k.cyl('metal', 0.8, H, 0, 0.1, 0.07, L * 1.2, 0xe8e8e8, 5);
        k.box('wood', -1.5, H, 0, L * 0.3, 0.7, B * 0.55, C.woodLight);
        k.tri('plain', { x: 0.9, y: H + 1.2, z: 0 }, { x: 0.9, y: H + L * 1.15, z: 0 }, { x: -L * 0.38, y: H + 1.2, z: 0 }, [0, 0], [0, 1], [1, 0], 0xf6f4ee, { x: 0, y: 0, z: 1 });
        k.tri('plain', { x: 0.9, y: H + 1.2, z: 0 }, { x: 0.9, y: H + L * 1.15, z: 0 }, { x: -L * 0.38, y: H + 1.2, z: 0 }, [0, 0], [0, 1], [1, 0], 0xf6f4ee, { x: 0, y: 0, z: -1 });
        break;
      case 'ferry':
        k.box('wall_office', -2, H, 0, L * 0.7, 2.8, B * 0.86, 0xf4f4f4, { top: 'plain', topColor: 0xdddddd });
        k.box('wall_office', -3, H + 2.8, 0, L * 0.5, 2.6, B * 0.76, 0xf4f4f4, { top: 'plain', topColor: 0xdddddd });
        k.box('glass', L * 0.12, H + 5.4, 0, 3, 1.6, B * 0.5, 0x2a3844, { top: 'plain', topColor: 0xf4f4f4 });
        k.cyl('plain', -L * 0.2, H + 5.4, 0, 0.9, 0.9, 2.6, 0xd83a2a, 10);
        break;
      case 'tug':
        k.box('plain', 0, H, 0, L * 0.35, 2.4, B * 0.6, 0xf4f4f4);
        k.box('glass', 0.8, H + 2.4, 0, L * 0.18, 1.3, B * 0.55, 0x2a3844, { top: 'plain', topColor: 0xc83a2a });
        k.cyl('plain', -2.4, H + 2.4, 0, 0.6, 0.6, 2.6, 0xc83a2a, 8);
        break;
      case 'fishing':
        k.box('plain', 1.5, H, 0, L * 0.25, 2.2, B * 0.6, 0xf4f4f4);
        k.box('glass', 1.8, H + 1.2, 0, L * 0.26, 0.8, B * 0.62, 0x2a3844, { top: false });
        k.cyl('metal', -1, H, 0, 0.1, 0.1, 6, 0x777777, 5);
        k.beam('metal', [-1, H + 5.5, 0], [-5.5, H + 1.5, 0], 0.08, 0.08, 0x777777);
        break;
      case 'pedal':
        k.box('plain', -0.2, H, 0, 1.2, 0.5, 1.1, 0xf4f4f4);
        k.box('plain', -0.2, H + 1.0, 0, 1.3, 0.1, 1.3, color);
        break;
    }
  });
}

/** pointed hull: deck at y=H, waterline at 0 */
export function hull(k: Kit, L: number, B: number, H: number, deck: ColorLike, side: ColorLike): void {
  const hl = L / 2, hb = B / 2;
  const bow = hl, stern = -hl, shoulder = hl - L * 0.28;
  const deckPts: P2[] = [[stern, -hb], [shoulder, -hb], [bow, 0], [shoulder, hb], [stern, hb]];
  const keel = -H * 0.6;
  // sides
  for (let i = 0; i < deckPts.length; i++) {
    const a = deckPts[i], b = deckPts[(i + 1) % deckPts.length];
    const ka: P2 = [a[0] * 0.92, a[1] * 0.55], kb: P2 = [b[0] * 0.92, b[1] * 0.55];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    k.quad('plain', { x: ka[0], y: keel, z: ka[1] }, { x: kb[0], y: keel, z: kb[1] }, { x: b[0], y: H, z: b[1] }, { x: a[0], y: H, z: a[1] }, [[0, keel], [1, keel], [1, H], [0, H]], side, { x: mx, y: 0, z: mz * 3 });
  }
  k.cap('wood', deckPts, H, deck === 0xf4f4f4 ? 0xd9c7a2 : deck);
  k.cap('plain', deckPts.map(([x, z]) => [x * 0.92, z * 0.55] as P2), keel, side, true);
  // white rub rail
  k.ribbon('plain', [...deckPts, deckPts[0]], 0.25, H + 0.02, 0xf4f4f4);
}

/** container ship (bow +X), deck ~10 m above water */
export function containerShip(k: Kit, x: number, z: number, rotY: number, L = 150, y = 0): void {
  const B = L * 0.15;
  k.at(x, y, z, rotY, () => {
    hull(k, L, B, 9, 0x6a2a2a, 0x2a3a4a);
    k.box('plain', -L * 0.4, 9, 0, L * 0.08, 16, B * 0.8, 0xf4f4f4);
    k.box('glass', -L * 0.4 + L * 0.041, 21, 0, 0.2, 3, B * 0.7, 0x2a3844, { top: false });
    k.box('plain', -L * 0.4, 25, 0, L * 0.1, 1.2, B * 0.95, 0xf4f4f4);
    k.cyl('plain', -L * 0.46, 9, 0, 2.2, 2.2, 22, 0x2a2a2a, 10);
    const bays = Math.floor((L * 0.72) / 13);
    const r = k.ctx.rng;
    for (let i = 0; i < bays; i++) {
      const bx = -L * 0.32 + i * 13.2 + 6.6;
      const h = r.int(2, 5);
      const cols = Math.floor(B / 2.6) - 1;
      for (let c = 0; c < cols; c++) {
        const hh = Math.max(1, h - (c === 0 || c === cols - 1 ? 1 : 0));
        for (let l = 0; l < hh; l++) container(k, bx, 9 + l * 2.6, (c - (cols - 1) / 2) * 2.55, 0, r.pick(CONTAINER_COLORS));
      }
    }
    k.light(-L * 0.4, 26.5, 0, 0xffffff, 2, 'beacon', true);
  });
}

// ── misc ──────────────────────────────────────────────────────────────────
/** umbrella (beach / café) */
export function umbrella(k: Kit, x: number, z: number, color: ColorLike, r = 1.4, h = 2.4): void {
  k.cyl('metal', x, 0, z, 0.04, 0.04, h, 0xdddddd, 4);
  k.rev('plain', x, h - 0.45, z, [[r, 0], [0.02, 0.55]], color, k.seg(8), { bottom: true, crease: 80 });
}

/** round storage tank with roof and ladder */
export function tank(k: Kit, x: number, z: number, r: number, h: number, color: ColorLike = 0xe4e4e0, roof: 'cone' | 'dome' | 'flat' = 'cone'): void {
  k.cyl('metal', x, 0, z, r, r, h, color, k.seg(20), roof === 'flat');
  if (roof === 'cone') k.cyl('metal', x, h, z, r * 1.01, r * 0.08, r * 0.18, shade(color, 0.92), k.seg(20));
  if (roof === 'dome') k.dome('metal', x, h, z, r, shade(color, 0.95), k.seg(20), 0.3, 4);
  if (!k.lo) {
    k.ring('metal', x, h + 0.02, z, r - 0.4, r + 0.05, 0x8a8e92, k.seg(20));
    k.beam('metal', [x + r + 0.2, 0, z], [x + r + 0.2, h + 1, z], 0.08, 0.5, 0x6a6e72);
  }
}

/** industrial chimney with bands, light and smoke/steam emitter */
export function chimney(k: Kit, x: number, z: number, h: number, r0: number, r1: number, opts: { color?: ColorLike; bands?: boolean; emit?: 'smoke' | 'steam' | null; rate?: number; beacon?: boolean } = {}): void {
  const col = opts.color ?? C.concrete;
  k.cyl('concrete', x, 0, z, r0, r1, h, col, k.seg(14));
  if (opts.bands !== false) {
    k.cyl('plain', x, h - 4, z, r1 + (r0 - r1) * (4 / h) + 0.05, r1 + 0.05, 4, 0xc8322b, k.seg(14), false);
    k.cyl('plain', x, h - 9, z, r1 + (r0 - r1) * (9 / h) + 0.05, r1 + (r0 - r1) * (6 / h) + 0.05, 3, 0xf2f2f2, k.seg(14), false);
    k.cyl('plain', x, h - 12, z, r1 + (r0 - r1) * (12 / h) + 0.05, r1 + (r0 - r1) * (9 / h) + 0.05, 3, 0xc8322b, k.seg(14), false);
  }
  k.torus('metal', x, h - 0.2, z, r1 + 0.1, 0.18, 0x333333, k.seg(14), 4);
  if (opts.emit !== null) k.emitter(opts.emit ?? 'smoke', x, h + 0.5, z, opts.rate ?? 1);
  if (opts.beacon !== false) {
    k.light(x + r1 + 0.1, h - 1, z, C.beaconRed, 2.2, 'beacon', true);
    k.light(x - r1 - 0.1, h - 1, z, C.beaconRed, 2.2, 'beacon', true);
  }
}

export function sphereTank(k: Kit, x: number, z: number, r: number, color: ColorLike = 0xeeeeea): void {
  const legs = 6;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2;
    k.cyl('metal', x + Math.cos(a) * r * 0.85, 0, z + Math.sin(a) * r * 0.85, 0.25, 0.25, r * 1.05, 0x9a9ea2, 6);
  }
  k.ball('metal', x, r * 1.1, z, r, color, k.seg(16), 10);
}

/** conveyor gallery (enclosed box truss) between two points */
export function conveyor(k: Kit, a: V3, b: V3, w = 2, color: ColorLike = 0xb8a57a): void {
  k.beam('wall_industrial', a, b, w, 2.0, color, true);
  const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 12));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    if (p[1] > 2) {
      k.beam('metal', [p[0] - w * 0.4, 0, p[2]], [p[0] - w * 0.4, p[1] - 1, p[2]], 0.3, 0.3, 0x6a6e72);
      k.beam('metal', [p[0] + w * 0.4, 0, p[2]], [p[0] + w * 0.4, p[1] - 1, p[2]], 0.3, 0.3, 0x6a6e72);
    }
  }
}

/** material pile (coal, ore, gravel, wood chips) */
export function pile(k: Kit, x: number, z: number, rx: number, rz: number, h: number, color: ColorLike, seed = 0): void {
  const segs = k.seg(14);
  // the seed skews the shoulder of the heap so neighbouring piles differ
  const s = 0.7 + ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.2;
  const prof: P2[] = [[1, 0], [s, 0.35], [s * 0.62, 0.75], [0.2, 0.96], [0, 1]];
  k.rev('dirt', x, 0, z, prof.map(([r, y]) => [r, y * h] as P2), color, segs, { sx: rx, sz: rz, crease: 80, a0: seed, a1: seed + Math.PI * 2 });
}

/** log pile (logs along X) */
export function logPile(k: Kit, cx: number, cz: number, len: number, rows: number, layers: number, r = 0.35): void {
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < rows - l; i++) {
      const z = cz + (i - (rows - l - 1) / 2) * r * 2.05;
      k.push(new THREE.Matrix4().makeTranslation(cx, r + l * r * 1.75, z).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      k.cyl('bark', 0, -len / 2, 0, r, r, len, 0x7a5a3a, 6, true, true);
      k.pop();
    }
}

/** solar panel row (tilted towards +Z = south-ish in local space) */
export function solarRow(k: Kit, cx: number, cz: number, len: number, depth = 3.2, tilt = 0.5, h = 0.8): void {
  const hy = Math.sin(tilt) * depth, hz = Math.cos(tilt) * depth;
  const y0 = h, z0 = cz + hz / 2, z1 = cz - hz / 2;
  k.quad('solar', { x: cx - len / 2, y: y0, z: z0 }, { x: cx + len / 2, y: y0, z: z0 }, { x: cx + len / 2, y: y0 + hy, z: z1 }, { x: cx - len / 2, y: y0 + hy, z: z1 }, [[0, 0], [len, 0], [len, depth], [0, depth]], 0xffffff, { x: 0, y: 1, z: 1 });
  k.quad('metal', { x: cx - len / 2, y: y0, z: z0 }, { x: cx + len / 2, y: y0, z: z0 }, { x: cx + len / 2, y: y0 + hy, z: z1 }, { x: cx - len / 2, y: y0 + hy, z: z1 }, [[0, 0], [len, 0], [len, depth], [0, depth]], 0x8a8e92, { x: 0, y: -1, z: -1 });
  if (!k.lo) {
    const n = Math.max(2, Math.round(len / 6));
    for (let i = 0; i <= n; i++) {
      const x = cx - len / 2 + (len * i) / n;
      k.box('metal', x, 0, z0 - 0.3, 0.12, y0, 0.12, 0x7a7e82, { top: false });
      k.box('metal', x, 0, z1 + 0.3, 0.12, y0 + hy - 0.1, 0.12, 0x7a7e82, { top: false });
    }
  }
}

/** pylon (transmission tower) */
export function pylon(k: Kit, x: number, z: number, h = 28, color: ColorLike = 0x9aa0a6): void {
  k.lattice('metal', x, z, 0, h, 2.4, 0.5, color, 5, 0.25, 0.1);
  for (const [y, w] of [[h * 0.72, 6], [h * 0.86, 4.5]] as [number, number][]) {
    k.beam('metal', [x - w, y, z], [x + w, y, z], 0.25, 0.4, color);
    for (const s of [-1, 1]) k.cyl('plain', x + s * w * 0.9, y - 1.6, z, 0.12, 0.12, 1.6, 0x6a8a9a, 5);
  }
}

/** swing set, slide, climbing frame at (x,z) */
export function playEquipment(k: Kit, kind: 'swing' | 'slide' | 'climber' | 'seesaw' | 'carousel', x: number, z: number, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    switch (kind) {
      case 'swing': {
        const col = 0xd83a2a;
        for (const s of [-1, 1]) {
          k.beam('metal', [s * 1.8, 0, -0.9], [s * 1.8, 2.4, 0], 0.1, 0.1, col);
          k.beam('metal', [s * 1.8, 0, 0.9], [s * 1.8, 2.4, 0], 0.1, 0.1, col);
        }
        k.beam('metal', [-1.8, 2.4, 0], [1.8, 2.4, 0], 0.12, 0.12, col);
        for (const sx of [-0.8, 0.8]) {
          k.beam('metal', [sx - 0.2, 2.4, 0], [sx - 0.2, 0.55, 0], 0.03, 0.03, 0x333333);
          k.beam('metal', [sx + 0.2, 2.4, 0], [sx + 0.2, 0.55, 0], 0.03, 0.03, 0x333333);
          k.box('plain', sx, 0.5, 0, 0.5, 0.05, 0.25, 0x2a2a2a);
        }
        break;
      }
      case 'slide':
        k.box('wood', 0, 0, 0, 1.4, 1.8, 1.4, C.woodLight, { top: 'wood' });
        k.pyramid('plain', 0, 2.6, 0, 1.6, 1.6, 1.1, 0x2f6fd0);
        for (const [px, pz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) k.box('wood', px, 1.8, pz, 0.1, 0.8, 0.1, C.wood);
        k.quad('plain', { x: 0.7, y: 1.8, z: -0.4 }, { x: 0.7, y: 1.8, z: 0.4 }, { x: 3.4, y: 0.2, z: 0.4 }, { x: 3.4, y: 0.2, z: -0.4 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xf2c230, { x: 0.5, y: 1, z: 0 });
        k.quad('plain', { x: 0.7, y: 1.8, z: -0.4 }, { x: 0.7, y: 1.8, z: 0.4 }, { x: 3.4, y: 0.2, z: 0.4 }, { x: 3.4, y: 0.2, z: -0.4 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xc89a20, { x: -0.5, y: -1, z: 0 });
        k.beam('metal', [-0.7, 0, 0], [-1.8, 0, 0], 0.05, 0.6, 0x2f6fd0);
        break;
      case 'climber':
        k.rev('metal', 0, 0, 0, [[2, 0], [1.9, 0.8], [1.4, 1.7], [0.7, 2.25], [0, 2.4]], 0xe0402a, 8, { crease: 20 });
        break;
      case 'seesaw':
        k.box('metal', 0, 0, 0, 0.3, 0.5, 0.3, 0x333333);
        k.pushTRS(0, 0.55, 0, 0);
        k.push(new THREE.Matrix4().makeRotationZ(0.18));
        k.box('plain', 0, -0.05, 0, 3.4, 0.1, 0.35, 0x3a9a4a);
        k.pop(); k.pop();
        break;
      case 'carousel':
        k.cyl('metal', 0, 0, 0, 1.5, 1.5, 0.3, 0xf2c230, 12);
        k.cyl('metal', 0, 0.3, 0, 0.08, 0.08, 1, 0x333333, 5);
        break;
    }
  });
}

/** colourful low-poly animal (quadruped) for zoos/farms */
export function animal(k: Kit, x: number, z: number, rotY: number, kind: 'giraffe' | 'elephant' | 'zebra' | 'cow' | 'lion' | 'deer' | 'dog' | 'flamingo'): void {
  const spec = {
    giraffe: { L: 2.4, H: 2.2, W: 0.8, neck: 2.6, col: 0xd9a650 },
    elephant: { L: 3.2, H: 1.8, W: 1.6, neck: 0.6, col: 0x8a8a8e },
    zebra: { L: 2.0, H: 1.1, W: 0.6, neck: 0.8, col: 0xe8e8e8 },
    cow: { L: 2.2, H: 1.1, W: 0.8, neck: 0.4, col: 0x6a4a3a },
    lion: { L: 1.8, H: 0.9, W: 0.6, neck: 0.5, col: 0xc9953f },
    deer: { L: 1.6, H: 0.95, W: 0.45, neck: 0.8, col: 0x8a6040 },
    dog: { L: 0.8, H: 0.45, W: 0.3, neck: 0.3, col: 0x9a7040 },
    flamingo: { L: 0.5, H: 0.9, W: 0.3, neck: 0.7, col: 0xf29aa8 },
  }[kind];
  k.at(x, 0, z, rotY, () => {
    const { L, H, W, neck, col } = spec;
    const legH = kind === 'flamingo' ? 0.8 : H * 0.55;
    if (kind === 'flamingo') {
      k.box('plain', 0, 0, 0, 0.05, legH, 0.05, col);
    } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('plain', (sx * L) / 3, 0, (sz * W) / 3, W * 0.22, legH, W * 0.22, shade(col, 0.85), { top: false });
    k.box('plain', 0, legH, 0, L, H * 0.45, W, col);
    k.beam('plain', [L / 2 - 0.1, legH + H * 0.3, 0], [L / 2 + neck * 0.35, legH + H * 0.3 + neck, 0], W * 0.35, W * 0.35, col);
    k.box('plain', L / 2 + neck * 0.35 + L * 0.06, legH + H * 0.2 + neck, 0, L * 0.25, H * 0.25, W * 0.5, col);
    if (kind === 'elephant') k.beam('plain', [L / 2 + 0.6, legH + 0.5, 0], [L / 2 + 0.8, 0.2, 0], 0.25, 0.25, col);
    if (kind === 'zebra' && !k.lo) for (let i = 0; i < 3; i++) k.box('plain', -L / 3 + i * (L / 3), legH + 0.01, 0, 0.14, H * 0.46, W + 0.02, 0x222222, { top: false });
  });
}
