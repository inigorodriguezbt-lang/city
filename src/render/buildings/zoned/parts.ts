// Architectural vocabulary for the zoned generators: lot grounds, roofs of
// every family (gable, hip, mansard, pagoda, dome, shed, flat w/ parapet),
// dormers, chimneys, cornices, balconies, porches, awnings, signs, rooftop
// plant, vegetation, fences, vehicles and industrial kit.
// All functions draw into a Fab in local model space (front = +Z).
import * as THREE from 'three';
import type { ColorLike, ModelBuilder } from '../ModelBuilder';
import type { MatKey } from '../types';
import { FLOOR, LodFacade, WinKind, facCode } from './constants';
import { BLANK, type Fab, type P2, matBay, matFloor } from './fab';
import { P, cl, col, hueCol, mix, shade } from './util';

/** height of the finished lot surface above the (flattened) terrain */
export const GROUND = 0.12;

const UP = { x: 0, y: 1, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };

// shared template geometries (cloned into builders via addGeometry)
let ICO: THREE.BufferGeometry | null = null;
let ICO_LOW: THREE.BufferGeometry | null = null;
function ico(low: boolean): THREE.BufferGeometry {
  if (low) return (ICO_LOW ??= new THREE.IcosahedronGeometry(1, 0));
  return (ICO ??= new THREE.IcosahedronGeometry(1, 1));
}
const _mat = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function trs(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): THREE.Matrix4 {
  _q.setFromAxisAngle(_v.set(0, 1, 0), rotY);
  return _mat.compose(new THREE.Vector3(x, y, z), _q, _s.set(sx, sy, sz));
}

// ── ground ────────────────────────────────────────────────────────────────
/** Whole-lot slab: surface at GROUND, skirt down to -3 m to hide slopes. */
export function lotGround(f: Fab, w: number, d: number, mat: MatKey, color: ColorLike, skirt: ColorLike = P.concreteDark): void {
  const B = f.m();
  B.box('concrete', 0, -3, 0, w, 3 + GROUND, d, skirt, { top: mat, topColor: color });
}

/** Flat surface patch just above the lot (driveways, patios, parking, lawns). */
export function pad(f: Fab, mat: MatKey, cx: number, cz: number, w: number, d: number, color: ColorLike, lift = 0.03): void {
  const y = GROUND + lift;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  f.m().quad(mat, { x: x0, y, z: z1 }, { x: x1, y, z: z1 }, { x: x1, y, z: z0 }, { x: x0, y, z: z0 }, [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], color, UP);
}

/** Painted parking bays (white stripes) + optional parked cars. */
export function parking(f: Fab, cx: number, cz: number, w: number, d: number, alongX: boolean, carChance: number, lamp = true): void {
  pad(f, 'asphalt', cx, cz, w, d, P.asphalt, 0.02);
  const B = f.m();
  const rng = f.rng;
  const bayW = 2.6, bayD = 5.2;
  const rowsSpan = alongX ? d : w;
  const len = alongX ? w : d;
  const nb = Math.floor((len - 1) / bayW);
  // two rows of bays facing a central aisle when deep enough, else one row
  const rows: number[] = rowsSpan >= bayD * 2 + 5.5 ? [-rowsSpan / 2 + bayD / 2 + 0.3, rowsSpan / 2 - bayD / 2 - 0.3] : [0];
  const y = GROUND + 0.05;
  for (const r of rows) {
    for (let i = 0; i <= nb; i++) {
      const t = -((nb * bayW) / 2) + i * bayW;
      const [sx, sz, sw, sd] = alongX ? [cx + t, cz + r, 0.12, bayD] : [cx + r, cz + t, bayD, 0.12];
      B.quad('plain', { x: sx - sw / 2, y, z: sz + sd / 2 }, { x: sx + sw / 2, y, z: sz + sd / 2 }, { x: sx + sw / 2, y, z: sz - sd / 2 }, { x: sx - sw / 2, y, z: sz - sd / 2 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xe8e8e2, UP);
      if (i < nb && rng.chance(carChance)) {
        const c = t + bayW / 2;
        const [px, pz] = alongX ? [cx + c, cz + r] : [cx + r, cz + c];
        car(f, px, pz, (alongX ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0) + (rng.next() - 0.5) * 0.06);
      }
    }
  }
  if (lamp && (w > 20 || d > 20)) {
    const nL = Math.max(1, Math.round(Math.max(w, d) / 22));
    for (let i = 0; i < nL; i++) {
      const t = ((i + 0.5) / nL - 0.5) * (alongX ? w : d);
      const [lx, lz] = alongX ? [cx + t, cz] : [cx, cz + t];
      lampPost(f, lx, lz, 7);
    }
  }
}

export function lampPost(f: Fab, x: number, z: number, h: number, color = 0xffc98a): void {
  const B = f.m();
  B.cylinder('metal', x, GROUND, z, 0.09, 0.07, h, P.gunmetal, 5, {});
  B.box('metal', x, GROUND + h - 0.12, z, 0.9, 0.16, 0.35, P.gunmetal);
  B.box('emissive', x, GROUND + h - 0.2, z, 0.7, 0.06, 0.26, 0xfff1d6, { top: false });
  f.light(x, GROUND + h - 0.35, z, color, 5, 'flood');
}

// ── vegetation ───────────────────────────────────────────────────────────
export type TreeKind = 'round' | 'cone' | 'palm' | 'column' | 'blossom';

export function tree(f: Fab, x: number, z: number, h: number, kind: TreeKind = 'round', leaf?: ColorLike): void {
  const B = f.m();
  const rng = f.rng;
  const low = f.detail === 'low';
  const lc = leaf ?? (kind === 'cone' ? '#2f5a33' : kind === 'blossom' ? '#e4a9c0' : rng.pick(['#4f7d37', '#5a8a3c', '#46723a', '#6b8f3e']));
  const y0 = GROUND;
  if (kind === 'palm') {
    const lean = (rng.next() - 0.5) * 0.6;
    B.cylinder('bark', x, y0, z, 0.2, 0.14, h, '#7a6245', 5, {});
    const tx = x + lean, ty = y0 + h;
    const fr = h * 0.45;
    const n = low ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next() * 0.4;
      const ex = tx + Math.cos(a) * fr, ez = z + Math.sin(a) * fr;
      const px = -Math.sin(a) * 0.5, pz = Math.cos(a) * 0.5;
      B.quad('foliage', { x: tx - px, y: ty, z: z - pz }, { x: tx + px, y: ty, z: z + pz }, { x: ex + px * 0.3, y: ty - fr * 0.45, z: ez + pz * 0.3 }, { x: ex - px * 0.3, y: ty - fr * 0.45, z: ez - pz * 0.3 }, [[0, 0], [1, 0], [1, 1], [0, 1]], lc, UP);
    }
    if (h > 5) f.mass(x, z, fr, fr, y0 + h - 1, 1.2, lc, lc, LodFacade.None);
    return;
  }
  const trunkH = kind === 'cone' ? h * 0.18 : kind === 'column' ? h * 0.15 : h * 0.38;
  B.cylinder('bark', x, y0, z, h * 0.035 + 0.06, h * 0.025 + 0.04, trunkH + 0.4, P.bark, low ? 4 : 5, {});
  if (kind === 'cone') {
    const r = h * 0.3;
    B.cylinder('foliage', x, y0 + trunkH, z, r, 0, (h - trunkH) * 0.62, lc, low ? 5 : 7, { bottom: true });
    B.cylinder('foliage', x, y0 + trunkH + (h - trunkH) * 0.38, z, r * 0.72, 0, (h - trunkH) * 0.62, shade(cl(lc), 1.08), low ? 5 : 7, { bottom: true });
  } else {
    const rw = kind === 'column' ? h * 0.18 : h * (0.3 + rng.next() * 0.08);
    const rh = kind === 'column' ? (h - trunkH) * 0.55 : (h - trunkH) * 0.52;
    B.addGeometry('foliage', ico(true), lc, trs(x, y0 + trunkH + rh, z, rw, rh, rw, rng.next() * 6));
    if (!low && kind !== 'column' && h > 5.5) B.addGeometry('foliage', ico(true), shade(cl(lc), 1.1), trs(x + rw * 0.3, y0 + trunkH + rh * 1.35, z - rw * 0.2, rw * 0.66, rh * 0.66, rw * 0.66, rng.next() * 6));
  }
  if (h > 5) f.mass(x, z, h * 0.4, h * 0.4, y0 + trunkH, h - trunkH, lc, lc, LodFacade.None);
}

/** Row of hedge boxes (foliage) between two points. */
export function hedge(f: Fab, x0: number, z0: number, x1: number, z1: number, h = 1.1, t = 0.8, color: ColorLike = P.hedge): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.3) return;
  f.pushTRS((x0 + x1) / 2, 0, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
  f.m().box('foliage', 0, GROUND, 0, len, h, t, color);
  f.pop();
}

export type FenceKind = 'picket' | 'rail' | 'wall' | 'chain' | 'iron';

/** Fence along a polyline. */
export function fence(f: Fab, pts: P2[], kind: FenceKind, color: ColorLike, h = 1.0): void {
  const B = f.m();
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.2) continue;
    f.pushTRS((ax + bx) / 2, 0, (az + bz) / 2, -Math.atan2(bz - az, bx - ax));
    const M = f.m();
    if (kind === 'wall') {
      f.m(BLANK).box('wall_stone', 0, GROUND, 0, len, h, 0.3, color, { top: 'concrete', topColor: shade(col(0xcfc8b8), 1) });
    } else if (kind === 'picket' || kind === 'iron' || kind === 'chain') {
      // slatted panel drawn as a thin double-sided plane + posts
      const mat: MatKey = kind === 'picket' ? 'wood' : 'metal';
      const hh = kind === 'chain' ? h * 1.8 : h;
      M.box(mat, 0, GROUND + hh * 0.72, 0, len, 0.07, 0.06, color);
      M.box(mat, 0, GROUND + hh * 0.25, 0, len, 0.07, 0.06, color);
      if (kind !== 'chain') {
        // pickets / balusters are painted by the wood / metal railing shaders
        // (a double-sided panel instead of hundreds of tiny boxes)
        const R = f.m(RAIL_CODE);
        const panelCol = kind === 'iron' ? shade(cl(0x5d6b4a), 0.5) : color;
        R.quad(mat, { x: -len / 2, y: GROUND, z: 0 }, { x: len / 2, y: GROUND, z: 0 }, { x: len / 2, y: GROUND + hh, z: 0 }, { x: -len / 2, y: GROUND + hh, z: 0 }, [[0, 0], [len, 0], [len, 1], [0, 1]], panelCol, { x: 0, y: 0, z: 1 });
        R.quad(mat, { x: len / 2, y: GROUND, z: 0 }, { x: -len / 2, y: GROUND, z: 0 }, { x: -len / 2, y: GROUND + hh, z: 0 }, { x: len / 2, y: GROUND + hh, z: 0 }, [[len, 0], [0, 0], [0, 1], [len, 1]], panelCol, { x: 0, y: 0, z: -1 });
      } else {
        M.quad(mat, { x: -len / 2, y: GROUND, z: 0 }, { x: len / 2, y: GROUND, z: 0 }, { x: len / 2, y: GROUND + hh, z: 0 }, { x: -len / 2, y: GROUND + hh, z: 0 }, [[0, 0], [len, 0], [len, hh], [0, hh]], shade(cl(color), 0.8), { x: 0, y: 0, z: 1 });
        M.quad(mat, { x: len / 2, y: GROUND, z: 0 }, { x: -len / 2, y: GROUND, z: 0 }, { x: -len / 2, y: GROUND + hh, z: 0 }, { x: len / 2, y: GROUND + hh, z: 0 }, [[0, 0], [len, 0], [len, hh], [0, hh]], shade(cl(color), 0.8), { x: 0, y: 0, z: -1 });
      }
      for (let k = 0; k <= Math.ceil(len / 2.5); k++) {
        const x = -len / 2 + Math.min(len, k * 2.5);
        M.box(mat, x, GROUND, 0, 0.1, hh + 0.08, 0.1, color);
      }
    } else {
      // rail (ranch fence)
      for (const y of [0.45, 0.9]) M.box('wood', 0, GROUND + y * h, 0, len, 0.1, 0.06, color, { top: false });
      for (let k = 0; k <= Math.ceil(len / 2.4); k++) M.box('wood', -len / 2 + Math.min(len, k * 2.4), GROUND, 0, 0.12, h, 0.12, color);
    }
    f.pop();
  }
}

/** Swimming pool with deck and coping. */
export function pool(f: Fab, cx: number, cz: number, w: number, d: number): void {
  const B = f.m();
  const y = GROUND;
  B.box('paving', cx, y - 0.05, cz, w + 2.4, 0.1, d + 2.4, P.pavingWarm, { sides: {} });
  const c = 0.28, h = 0.14;
  B.box('concrete', cx, y, cz + d / 2 + c / 2, w + 2 * c, h, c, '#eeeae2');
  B.box('concrete', cx, y, cz - d / 2 - c / 2, w + 2 * c, h, c, '#eeeae2');
  B.box('concrete', cx + w / 2 + c / 2, y, cz, c, h, d, '#eeeae2');
  B.box('concrete', cx - w / 2 - c / 2, y, cz, c, h, d, '#eeeae2');
  pad(f, 'water', cx, cz, w, d, P.pool, 0.02);
  f.light(cx, GROUND + 0.4, cz, 0x7fe3ff, Math.max(w, d) * 0.7, 'flood');
}

/** Low garden: lawn patch with flower beds / shrubs. */
export function shrubs(f: Fab, cx: number, cz: number, w: number, d: number, n: number): void {
  const B = f.m();
  const rng = f.rng;
  for (let i = 0; i < n; i++) {
    const x = cx + (rng.next() - 0.5) * w, z = cz + (rng.next() - 0.5) * d;
    const s = 0.5 + rng.next() * 0.7;
    const c = rng.chance(0.25) ? hueCol(rng.pick([0.95, 0.08, 0.13, 0.82]), 0.6, 0.55) : col(rng.pick(['#4d7a35', '#5b8a3f', '#3f6a30']));
    B.addGeometry('foliage', ico(true), c, trs(x, GROUND + s * 0.4, z, s, s * 0.7, s, rng.next() * 6));
  }
}

// ── roofs ─────────────────────────────────────────────────────────────────
export interface RoofSpec {
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** eave height */
  y: number;
  rise: number;
  mat: MatKey;
  color: ColorLike;
  overhang?: number;
  /** ridge parallel to X (default: along the longer side) */
  alongX?: boolean;
  /** gable end / cheek walls */
  wallMat?: MatKey;
  wallColor?: ColorLike;
  /** storey height used by the walls below (keeps texture rows aligned) */
  fh?: number;
  /** eave / fascia trim colour */
  trim?: ColorLike;
  /** attic window facade code on gable ends (0 = none) */
  attic?: number;
}

function roofQuad(B: ModelBuilder, mat: MatKey, pts: THREE.Vector3Like[], e0: THREE.Vector3Like, eDir: [number, number], inward: [number, number], slopeK: number, color: ColorLike, facing: THREE.Vector3Like): void {
  const uv = (p: THREE.Vector3Like): [number, number] => {
    const dx = p.x - e0.x, dz = p.z - e0.z;
    return [dx * eDir[0] + dz * eDir[1], (dx * inward[0] + dz * inward[1]) * slopeK];
  };
  if (pts.length === 4) B.quad(mat, pts[0], pts[1], pts[2], pts[3], [uv(pts[0]), uv(pts[1]), uv(pts[2]), uv(pts[3])], color, facing);
  else B.tri(mat, pts[0], pts[1], pts[2], uv(pts[0]), uv(pts[1]), uv(pts[2]), color, facing);
}

function fascia(B: ModelBuilder, ax: number, az: number, bx: number, bz: number, y: number, h: number, color: ColorLike, out: THREE.Vector3Like): void {
  B.quad('plain', { x: ax, y: y - h, z: az }, { x: bx, y: y - h, z: bz }, { x: bx, y, z: bz }, { x: ax, y, z: az }, [[0, 0], [1, 0], [1, 1], [0, 1]], color, out);
}

/** Gable roof with gable-end walls, fascia, soffits and optional attic windows. */
export function gableRoof(f: Fab, r: RoofSpec): void {
  const alongX = r.alongX ?? r.w >= r.d;
  if (!alongX) {
    f.pushTRS(r.cx, 0, r.cz, Math.PI / 2);
    gableRoof(f, { ...r, cx: 0, cz: 0, w: r.d, d: r.w, alongX: true });
    f.pop();
    return;
  }
  const B = f.m();
  const o = r.overhang ?? 0.45;
  const og = Math.min(o, 0.35);
  const hw = r.w / 2, hd = r.d / 2;
  const slope = r.rise / hd;
  const ye = r.y - o * slope, yr = r.y + r.rise;
  const x0 = r.cx - hw - og, x1 = r.cx + hw + og;
  const zf = r.cz + hd + o, zb = r.cz - hd - o;
  const k = Math.sqrt(1 + slope * slope);
  const trim = r.trim ?? P.trimWhite;
  roofQuad(B, r.mat, [{ x: x0, y: ye, z: zf }, { x: x1, y: ye, z: zf }, { x: x1, y: yr, z: r.cz }, { x: x0, y: yr, z: r.cz }], { x: x0, y: ye, z: zf }, [1, 0], [0, -1], k, r.color, { x: 0, y: 1, z: slope });
  roofQuad(B, r.mat, [{ x: x1, y: ye, z: zb }, { x: x0, y: ye, z: zb }, { x: x0, y: yr, z: r.cz }, { x: x1, y: yr, z: r.cz }], { x: x1, y: ye, z: zb }, [-1, 0], [0, 1], k, r.color, { x: 0, y: 1, z: -slope });
  // soffits
  const sc = shade(cl(trim), 0.72);
  B.quad('plain', { x: x0, y: ye, z: zf }, { x: x0, y: r.y, z: r.cz + hd }, { x: x1, y: r.y, z: r.cz + hd }, { x: x1, y: ye, z: zf }, [[0, 0], [0, 1], [1, 1], [1, 0]], sc, DOWN);
  B.quad('plain', { x: x1, y: ye, z: zb }, { x: x1, y: r.y, z: r.cz - hd }, { x: x0, y: r.y, z: r.cz - hd }, { x: x0, y: ye, z: zb }, [[0, 0], [0, 1], [1, 1], [1, 0]], sc, DOWN);
  // fascia boards along eaves and rakes
  if (f.detail !== 'low') {
    fascia(B, x0, zf, x1, zf, ye + 0.02, 0.2, trim, { x: 0, y: 0, z: 1 });
    fascia(B, x1, zb, x0, zb, ye + 0.02, 0.2, trim, { x: 0, y: 0, z: -1 });
    for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
      B.quad('plain', { x, y: ye - 0.18, z: zf }, { x, y: yr - 0.18, z: r.cz }, { x, y: yr + 0.02, z: r.cz }, { x, y: ye + 0.02, z: zf }, [[0, 0], [1, 0], [1, 1], [0, 1]], trim, { x: s, y: 0, z: 0 });
      B.quad('plain', { x, y: ye - 0.18, z: zb }, { x, y: yr - 0.18, z: r.cz }, { x, y: yr + 0.02, z: r.cz }, { x, y: ye + 0.02, z: zb }, [[0, 0], [1, 0], [1, 1], [0, 1]], trim, { x: s, y: 0, z: 0 });
    }
  }
  // gable-end walls (blank, texture rows continue from the storeys below)
  const wm = r.wallMat ?? 'plain';
  const wc = r.wallColor ?? r.color;
  const vs = matFloor(wm) / (r.fh ?? matFloor(wm));
  const W = f.m(BLANK);
  for (const [x, s] of [[r.cx - hw, -1], [r.cx + hw, 1]] as const) {
    W.tri(wm, { x, y: r.y, z: r.cz + hd }, { x, y: yr, z: r.cz }, { x, y: r.y, z: r.cz - hd }, [0, r.y * vs], [hd, yr * vs], [r.d, r.y * vs], wc, { x: s, y: 0, z: 0 });
    if (r.attic && r.rise > 2.3 && f.detail !== 'low') atticWindow(f, wm, r.attic, x + s * 0.02, r.cz, s, r.y + Math.min(1.9, r.rise * 0.42), wc);
  }
  f.mass(r.cx, r.cz, r.w + og * 2, r.d, r.y, r.rise, r.wallColor ?? r.color, r.color, LodFacade.None, 1);
  f.reach(yr);
}

/** Small window patch on a gable end facing ±X at (x, z), centred at height yc. */
export function atticWindow(f: Fab, wm: MatKey, code: number, x: number, z: number, side: number, yc: number, color: ColorLike): void {
  const w = 1.5, h = 1.5;
  const W = f.m(code);
  const mb = matBay(wm);
  // one shader bay spans the patch, one storey spans its height (window centred)
  const v0 = FLOOR * 2, v1 = FLOOR * 3;
  const za = z + side * (w / 2), zb = z - side * (w / 2);
  W.quad(wm, { x, y: yc - h / 2, z: za }, { x, y: yc - h / 2, z: zb }, { x, y: yc + h / 2, z: zb }, { x, y: yc + h / 2, z: za }, [[0, v0], [mb, v0], [mb, v1], [0, v1]], color, { x: side, y: 0, z: 0 });
}

/** Hip roof (pyramid when square) with proper tile UVs and fascia. */
export function hipRoof(f: Fab, r: RoofSpec): void {
  const B = f.m();
  const o = r.overhang ?? 0.45;
  const W = r.w + 2 * o, D = r.d + 2 * o;
  const slope = r.rise / (Math.min(r.w, r.d) / 2);
  const ye = r.y - o * slope;
  const yr = ye + slope * (Math.min(W, D) / 2);
  const x0 = r.cx - W / 2, x1 = r.cx + W / 2, z0 = r.cz - D / 2, z1 = r.cz + D / 2;
  const k = Math.sqrt(1 + slope * slope);
  let r0: THREE.Vector3Like, r1: THREE.Vector3Like;
  if (W >= D) {
    r0 = { x: x0 + D / 2, y: yr, z: r.cz };
    r1 = { x: x1 - D / 2, y: yr, z: r.cz };
  } else {
    r0 = { x: r.cx, y: yr, z: z1 - W / 2 };
    r1 = { x: r.cx, y: yr, z: z0 + W / 2 };
  }
  const A = { x: x0, y: ye, z: z1 }, Bp = { x: x1, y: ye, z: z1 }, C = { x: x1, y: ye, z: z0 }, Dp = { x: x0, y: ye, z: z0 };
  if (W >= D) {
    roofQuad(B, r.mat, [A, Bp, r1, r0], A, [1, 0], [0, -1], k, r.color, { x: 0, y: 1, z: slope });
    roofQuad(B, r.mat, [C, Dp, r0, r1], C, [-1, 0], [0, 1], k, r.color, { x: 0, y: 1, z: -slope });
    roofQuad(B, r.mat, [Bp, C, r1], Bp, [0, -1], [-1, 0], k, r.color, { x: slope, y: 1, z: 0 });
    roofQuad(B, r.mat, [Dp, A, r0], Dp, [0, 1], [1, 0], k, r.color, { x: -slope, y: 1, z: 0 });
  } else {
    roofQuad(B, r.mat, [A, Bp, r0], A, [1, 0], [0, -1], k, r.color, { x: 0, y: 1, z: slope });
    roofQuad(B, r.mat, [C, Dp, r1], C, [-1, 0], [0, 1], k, r.color, { x: 0, y: 1, z: -slope });
    roofQuad(B, r.mat, [Bp, C, r1, r0], Bp, [0, -1], [-1, 0], k, r.color, { x: slope, y: 1, z: 0 });
    roofQuad(B, r.mat, [Dp, A, r0, r1], Dp, [0, 1], [1, 0], k, r.color, { x: -slope, y: 1, z: 0 });
  }
  const trim = r.trim ?? P.trimWhite;
  const sc = shade(cl(trim), 0.72);
  // soffit (one quad per side, down-facing)
  const hx = r.w / 2, hz = r.d / 2;
  const sides: [THREE.Vector3Like, THREE.Vector3Like, THREE.Vector3Like, THREE.Vector3Like][] = [
    [A, { x: r.cx - hx, y: r.y, z: r.cz + hz }, { x: r.cx + hx, y: r.y, z: r.cz + hz }, Bp],
    [Bp, { x: r.cx + hx, y: r.y, z: r.cz + hz }, { x: r.cx + hx, y: r.y, z: r.cz - hz }, C],
    [C, { x: r.cx + hx, y: r.y, z: r.cz - hz }, { x: r.cx - hx, y: r.y, z: r.cz - hz }, Dp],
    [Dp, { x: r.cx - hx, y: r.y, z: r.cz - hz }, { x: r.cx - hx, y: r.y, z: r.cz + hz }, A],
  ];
  for (const s of sides) B.quad('plain', s[0], s[1], s[2], s[3], [[0, 0], [0, 1], [1, 1], [1, 0]], sc, DOWN);
  if (f.detail !== 'low') {
    fascia(B, x0, z1, x1, z1, ye + 0.02, 0.18, trim, { x: 0, y: 0, z: 1 });
    fascia(B, x1, z1, x1, z0, ye + 0.02, 0.18, trim, { x: 1, y: 0, z: 0 });
    fascia(B, x1, z0, x0, z0, ye + 0.02, 0.18, trim, { x: 0, y: 0, z: -1 });
    fascia(B, x0, z0, x0, z1, ye + 0.02, 0.18, trim, { x: -1, y: 0, z: 0 });
  }
  // LOD: hip prism with the ridge along the longer side
  if (W >= D) f.mass(r.cx, r.cz, W, D, ye, yr - ye, r.color, r.color, LodFacade.None, 2);
  else {
    f.pushTRS(r.cx, 0, r.cz, Math.PI / 2);
    f.mass(0, 0, D, W, ye, yr - ye, r.color, r.color, LodFacade.None, 2);
    f.pop();
  }
  f.reach(yr);
}

/** Pagoda / East-Asian roof: hip roof with flared, upturned eaves and ridge ends. */
export function pagodaRoof(f: Fab, r: RoofSpec, tiers = 1): void {
  const B = f.m();
  let { w, d, y } = r;
  for (let t = 0; t < tiers; t++) {
    const rise = t === tiers - 1 ? r.rise : r.rise * 0.45;
    const inner = { ...r, w, d, y: y + 0.35, rise, overhang: 0.2 };
    // skirt: flared eave ring from the wall line out and slightly up at corners
    const o = (r.overhang ?? 1.1) * (t === 0 ? 1 : 0.8);
    const yIn = y + 0.55, yOut = y + 0.05;
    const lift = 0.55;
    const ring = (dx: number, dz: number) => ({ x: r.cx + dx, z: r.cz + dz });
    const hw = w / 2, hd = d / 2;
    const segs: [number, number, number, number, number, number][] = [
      // x/z of inner start, inner end, outward normal
      [-hw, hd, hw, hd, 0, 1],
      [hw, hd, hw, -hd, 1, 0],
      [hw, -hd, -hw, -hd, 0, -1],
      [-hw, -hd, -hw, hd, -1, 0],
    ];
    for (const [ax, az, bx, bz, nx, nz] of segs) {
      const ia = ring(ax, az), ib = ring(bx, bz);
      const oa = ring(ax + (nx || Math.sign(ax)) * o + (nx ? 0 : 0), az + (nz || Math.sign(az)) * o);
      const ob = ring(bx + (nx || Math.sign(bx)) * o, bz + (nz || Math.sign(bz)) * o);
      // split outer edge into 3 spans with upturned corners
      const q1 = { x: oa.x + (ob.x - oa.x) * 0.22, z: oa.z + (ob.z - oa.z) * 0.22 };
      const q2 = { x: oa.x + (ob.x - oa.x) * 0.78, z: oa.z + (ob.z - oa.z) * 0.78 };
      const p1 = { x: ia.x + (ib.x - ia.x) * 0.22, z: ia.z + (ib.z - ia.z) * 0.22 };
      const p2 = { x: ia.x + (ib.x - ia.x) * 0.78, z: ia.z + (ib.z - ia.z) * 0.78 };
      const face = { x: nx, y: 1.5, z: nz };
      const V = (p: { x: number; z: number }, yy: number) => ({ x: p.x, y: yy, z: p.z });
      const uvq = (a: number, b: number): [number, number] => [a, b];
      B.quad(r.mat, V(oa, yOut + lift), V(q1, yOut), V(p1, yIn), V(ia, yIn), [uvq(0, 0), uvq(2, 0), uvq(2, o), uvq(0, o)], r.color, face);
      B.quad(r.mat, V(q1, yOut), V(q2, yOut), V(p2, yIn), V(p1, yIn), [uvq(0, 0), uvq(w, 0), uvq(w, o), uvq(0, o)], r.color, face);
      B.quad(r.mat, V(q2, yOut), V(ob, yOut + lift), V(ib, yIn), V(p2, yIn), [uvq(0, 0), uvq(2, 0), uvq(2, o), uvq(0, o)], r.color, face);
      // underside
      B.quad('plain', V(ia, yIn - 0.05), V(ib, yIn - 0.05), V(ob, yOut + lift - 0.12), V(oa, yOut + lift - 0.12), [[0, 0], [1, 0], [1, 1], [0, 1]], '#5a3a2a', DOWN);
    }
    hipRoof(f, { ...inner, overhang: 0.1 });
    if (t < tiers - 1) {
      // short drum between tiers
      const nw = w * 0.7, nd = d * 0.7;
      f.fbox(r.wallMat ?? 'wall_wood', BLANK, r.cx, y + 0.5, r.cz, nw, nd, 2.2, r.wallColor ?? '#8a3b2c', { top: false, noMass: true });
      y += 2.6;
      w = nw;
      d = nd;
    }
  }
  // ridge ornaments
  if (f.detail === 'high') {
    const top = y + 0.35 + r.rise;
    B.box('roof_tile', r.cx, top - 0.1, r.cz, Math.max(0.3, Math.abs(w - d)) + 0.3, 0.35, 0.3, shade(cl(r.color), 0.8));
  }
  f.mass(r.cx, r.cz, r.w + 1, r.d + 1, r.y, r.rise * 0.5 + 0.5, r.color, r.color, LodFacade.None);
  f.reach(y + r.rise + 0.5);
}

/** Mansard roof: steep lower slopes with dormers, shallow upper hip. Returns top height. */
export function mansardRoof(f: Fab, r: RoofSpec & { lowerH?: number; dormerFlags?: number; dormerColor?: ColorLike; upperMat?: MatKey; upperColor?: ColorLike }): number {
  const B = f.m();
  const h1 = r.lowerH ?? 2.9;
  const inset = h1 * 0.36;
  const o = 0.25;
  const x0 = r.cx - r.w / 2 - o, x1 = r.cx + r.w / 2 + o, z0 = r.cz - r.d / 2 - o, z1 = r.cz + r.d / 2 + o;
  const ix0 = r.cx - r.w / 2 + inset, ix1 = r.cx + r.w / 2 - inset, iz0 = r.cz - r.d / 2 + inset, iz1 = r.cz + r.d / 2 - inset;
  const ye = r.y, yt = r.y + h1;
  const k = Math.hypot(inset + o, h1) / (inset + o);
  const P0 = { x: x0, y: ye, z: z1 }, P1 = { x: x1, y: ye, z: z1 }, P2 = { x: x1, y: ye, z: z0 }, P3 = { x: x0, y: ye, z: z0 };
  const Q0 = { x: ix0, y: yt, z: iz1 }, Q1 = { x: ix1, y: yt, z: iz1 }, Q2 = { x: ix1, y: yt, z: iz0 }, Q3 = { x: ix0, y: yt, z: iz0 };
  const tilt = h1 / (inset + o);
  roofQuad(B, r.mat, [P0, P1, Q1, Q0], P0, [1, 0], [0, -1], k, r.color, { x: 0, y: 1 / tilt, z: 1 });
  roofQuad(B, r.mat, [P1, P2, Q2, Q1], P1, [0, -1], [-1, 0], k, r.color, { x: 1, y: 1 / tilt, z: 0 });
  roofQuad(B, r.mat, [P2, P3, Q3, Q2], P2, [-1, 0], [0, 1], k, r.color, { x: 0, y: 1 / tilt, z: -1 });
  roofQuad(B, r.mat, [P3, P0, Q0, Q3], P3, [0, 1], [1, 0], k, r.color, { x: -1, y: 1 / tilt, z: 0 });
  // cornice / gutter
  const trim = r.trim ?? P.trimWhite;
  B.box('plain', r.cx, ye - 0.35, r.cz, r.w + 0.6, 0.35, r.d + 0.6, trim, { bottom: true });
  // upper shallow roof
  const uw = ix1 - ix0, ud = iz1 - iz0;
  const upRise = Math.min(uw, ud) * 0.16;
  hipRoof(f, { cx: r.cx, cz: r.cz, w: uw, d: ud, y: yt, rise: upRise, mat: r.upperMat ?? r.mat, color: r.upperColor ?? shade(cl(r.color), 0.9), overhang: 0.05, trim: r.color });
  // dormers along front and back
  if (r.dormerFlags !== undefined && f.detail !== 'low') {
    const dw = 1.5;
    for (const side of [1, -1]) {
      const len = r.w - 1.2;
      const n = Math.max(1, Math.round(len / 3.2));
      for (let i = 0; i < n; i++) {
        const x = r.cx - len / 2 + ((i + 0.5) / n) * len;
        dormer(f, x, ye + 0.1, r.cz + side * (r.d / 2 + 0.12), side, dw, h1 * 0.78, r.wallMat ?? 'wall_plaster', r.dormerColor ?? r.wallColor ?? P.offWhite, r.dormerFlags, r.mat, r.color, 'arched');
      }
    }
  }
  f.mass(r.cx, r.cz, r.w, r.d, ye, h1 + upRise * 0.5, r.color, r.color, LodFacade.None);
  f.reach(yt + upRise);
  return yt + upRise;
}

/** Dormer: small front wall with a window patch and its own roof. front faces +Z*side. */
export function dormer(f: Fab, x: number, y: number, zFront: number, side: number, w: number, h: number, wm: MatKey, wc: ColorLike, flags: number, roofMat: MatKey, roofCol: ColorLike, roof: 'gable' | 'shed' | 'arched' = 'gable'): void {
  const depth = 1.8;
  f.pushTRS(x, y, zFront, side > 0 ? 0 : Math.PI);
  const B = f.m();
  // cheeks + front (front is the window patch)
  B.box('plain', 0, 0, -depth / 2, w, h, depth, wc, { top: false, sides: { s: false } });
  const W = f.m(facCode(WinKind.Single, 2.3, 1.55, flags));
  const mb = matBay(wm);
  W.quad(wm, { x: -w / 2, y: 0, z: 0.01 }, { x: w / 2, y: 0, z: 0.01 }, { x: w / 2, y: h, z: 0.01 }, { x: -w / 2, y: h, z: 0.01 }, [[0, FLOOR * 2 + 0.1], [mb, FLOOR * 2 + 0.1], [mb, FLOOR * 2 + 0.1 + (h * FLOOR) / 2.6], [0, FLOOR * 2 + 0.1 + (h * FLOOR) / 2.6]], wc, { x: 0, y: 0, z: 1 });
  if (roof === 'shed') {
    B.quad(roofMat, { x: -w / 2 - 0.15, y: h, z: 0.25 }, { x: w / 2 + 0.15, y: h, z: 0.25 }, { x: w / 2 + 0.15, y: h + 0.35, z: -depth }, { x: -w / 2 - 0.15, y: h + 0.35, z: -depth }, [[0, 0], [w, 0], [w, depth], [0, depth]], roofCol, UP);
  } else {
    const rr = roof === 'arched' ? w * 0.35 : w * 0.45;
    B.quad(roofMat, { x: -w / 2 - 0.15, y: h - 0.1, z: 0.3 }, { x: 0, y: h + rr, z: 0.3 }, { x: 0, y: h + rr, z: -depth }, { x: -w / 2 - 0.15, y: h - 0.1, z: -depth }, [[0, 0], [1.2, 0], [1.2, depth], [0, depth]], roofCol, { x: -1, y: 1, z: 0 });
    B.quad(roofMat, { x: 0, y: h + rr, z: 0.3 }, { x: w / 2 + 0.15, y: h - 0.1, z: 0.3 }, { x: w / 2 + 0.15, y: h - 0.1, z: -depth }, { x: 0, y: h + rr, z: -depth }, [[0, 0], [1.2, 0], [1.2, depth], [0, depth]], roofCol, { x: 1, y: 1, z: 0 });
    B.tri('plain', { x: -w / 2, y: h, z: 0.02 }, { x: w / 2, y: h, z: 0.02 }, { x: 0, y: h + rr - 0.05, z: 0.02 }, [0, 0], [1, 0], [0.5, 1], wc, { x: 0, y: 0, z: 1 });
  }
  f.pop();
}

/** Onion/round dome on a drum with lantern + finial. */
export function dome(f: Fab, cx: number, y: number, cz: number, r: number, mat: MatKey, color: ColorLike, drumColor: ColorLike, gold = P.gold): void {
  const B = f.m();
  const seg = f.detail === 'low' ? 10 : 16;
  B.cylinder('plain', cx, y, cz, r * 1.02, r * 1.02, r * 0.35, drumColor, seg);
  B.sphere(mat, cx, y + r * 0.35, cz, r, color, { hemi: true, wSeg: seg, hSeg: 6, scaleY: 1.1 });
  B.cylinder('plain', cx, y + r * 1.4, cz, r * 0.16, r * 0.16, r * 0.3, drumColor, 8);
  B.cylinder('metal', cx, y + r * 1.7, cz, r * 0.06, 0, r * 0.5, gold, 6);
  f.mass(cx, cz, r * 1.4, r * 1.4, y, r * 1.4, color, color, LodFacade.None);
  f.reach(y + r * 2.2);
}

/** Single-slope roof, high side at the back (-Z). Side walls continue the facade. */
export function shedRoof(f: Fab, r: RoofSpec & { highFront?: boolean }): void {
  if (r.highFront) {
    f.pushTRS(r.cx, 0, r.cz, Math.PI);
    shedRoof(f, { ...r, cx: 0, cz: 0, highFront: false });
    f.pop();
    return;
  }
  const B = f.m();
  const o = r.overhang ?? 0.5;
  const x0 = r.cx - r.w / 2 - o * 0.6, x1 = r.cx + r.w / 2 + o * 0.6, zf = r.cz + r.d / 2 + o, zb = r.cz - r.d / 2 - o * 0.4;
  const slope = r.rise / r.d;
  const yf = r.y - o * slope, yb = r.y + r.rise + o * 0.4 * slope;
  const k = Math.sqrt(1 + slope * slope);
  roofQuad(B, r.mat, [{ x: x0, y: yf, z: zf }, { x: x1, y: yf, z: zf }, { x: x1, y: yb, z: zb }, { x: x0, y: yb, z: zb }], { x: x0, y: yf, z: zf }, [1, 0], [0, -1], k, r.color, { x: 0, y: 1, z: slope });
  B.quad('plain', { x: x1, y: yf - 0.25, z: zf }, { x: x0, y: yf - 0.25, z: zf }, { x: x0, y: yb - 0.25, z: zb }, { x: x1, y: yb - 0.25, z: zb }, [[0, 0], [1, 0], [1, 1], [0, 1]], shade(cl(r.trim ?? P.trimWhite), 0.7), DOWN);
  const trim = r.trim ?? P.gunmetal;
  fascia(B, x0, zf, x1, zf, yf + 0.03, 0.25, trim, { x: 0, y: 0, z: 1 });
  fascia(B, x1, zb, x0, zb, yb + 0.03, 0.25, trim, { x: 0, y: 0, z: -1 });
  const wm = r.wallMat ?? 'plain';
  const wc = r.wallColor ?? r.color;
  const vs = matFloor(wm) / (r.fh ?? matFloor(wm));
  const W = f.m(BLANK);
  const gz0 = r.cz - r.d / 2, gz1 = r.cz + r.d / 2, top = r.y + r.rise;
  W.tri(wm, { x: r.cx - r.w / 2, y: r.y, z: gz1 }, { x: r.cx - r.w / 2, y: top, z: gz0 }, { x: r.cx - r.w / 2, y: r.y, z: gz0 }, [0, r.y * vs], [r.d, top * vs], [r.d, r.y * vs], wc, { x: -1, y: 0, z: 0 });
  W.tri(wm, { x: r.cx + r.w / 2, y: r.y, z: gz0 }, { x: r.cx + r.w / 2, y: top, z: gz0 }, { x: r.cx + r.w / 2, y: r.y, z: gz1 }, [0, r.y * vs], [0, top * vs], [r.d, r.y * vs], wc, { x: 1, y: 0, z: 0 });
  f.facade(wm, BLANK, r.cx + r.w / 2, gz0, r.cx - r.w / 2, gz0, r.y, top, wc, { fh: r.fh });
  f.mass(r.cx, r.cz, r.w, r.d, r.y, r.rise * 0.5, r.color, r.color, LodFacade.None);
  f.reach(yb);
}

/** Flat roof with parapet + coping (outer parapet faces blank in the wall material). */
export function flatRoof(f: Fab, cx: number, cz: number, w: number, d: number, y: number, parapet: number, wallMat: MatKey, wallColor: ColorLike, roofColor: ColorLike, coping: ColorLike = P.concreteLight, fh?: number): void {
  const B = f.m();
  const t = 0.3;
  B.box('roof_flat', cx, y, cz, w - 2 * t + 0.02, 0.05, d - 2 * t + 0.02, roofColor, { sides: { n: false, e: false, s: false, w: false } });
  if (parapet > 0.05) {
    f.fbox(wallMat, BLANK, cx, y, cz, w, d, parapet, wallColor, { top: false, noMass: true, fh });
    // inner faces (facing the roof)
    const ic = shade(cl(wallColor), 0.8);
    const ix0 = cx - w / 2 + t, ix1 = cx + w / 2 - t, iz0 = cz - d / 2 + t, iz1 = cz + d / 2 - t, y1 = y + parapet;
    B.quad('plain', { x: ix0, y, z: iz1 }, { x: ix1, y, z: iz1 }, { x: ix1, y: y1, z: iz1 }, { x: ix0, y: y1, z: iz1 }, [[0, 0], [1, 0], [1, 1], [0, 1]], ic, { x: 0, y: 0, z: -1 });
    B.quad('plain', { x: ix0, y, z: iz0 }, { x: ix1, y, z: iz0 }, { x: ix1, y: y1, z: iz0 }, { x: ix0, y: y1, z: iz0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], ic, { x: 0, y: 0, z: 1 });
    B.quad('plain', { x: ix0, y, z: iz0 }, { x: ix0, y, z: iz1 }, { x: ix0, y: y1, z: iz1 }, { x: ix0, y: y1, z: iz0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], ic, { x: 1, y: 0, z: 0 });
    B.quad('plain', { x: ix1, y, z: iz0 }, { x: ix1, y, z: iz1 }, { x: ix1, y: y1, z: iz1 }, { x: ix1, y: y1, z: iz0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], ic, { x: -1, y: 0, z: 0 });
    // coping ring
    B.box('concrete', cx, y + parapet, cz + d / 2 - t / 2, w + 0.1, 0.1, t + 0.1, coping);
    B.box('concrete', cx, y + parapet, cz - d / 2 + t / 2, w + 0.1, 0.1, t + 0.1, coping);
    B.box('concrete', cx + w / 2 - t / 2, y + parapet, cz, t + 0.1, 0.1, d - 2 * t, coping);
    B.box('concrete', cx - w / 2 + t / 2, y + parapet, cz, t + 0.1, 0.1, d - 2 * t, coping);
  }
  f.reach(y + parapet + 0.1);
}

// ── facade dressing ──────────────────────────────────────────────────────
/** Projecting cornice / string course band around a w×d box. */
export function cornice(f: Fab, cx: number, cz: number, w: number, d: number, y: number, h: number, proj: number, color: ColorLike, sides?: { n?: boolean; e?: boolean; s?: boolean; w?: boolean }): void {
  f.m().box('plain', cx, y, cz, w + 2 * proj, h, d + 2 * proj, color, { bottom: true, sides });
}

/** Stepped (dentil-like) cornice: two bands. */
export function richCornice(f: Fab, cx: number, cz: number, w: number, d: number, y: number, color: ColorLike, big = 1): void {
  cornice(f, cx, cz, w, d, y, 0.22 * big, 0.12 * big, shade(cl(color), 0.92));
  cornice(f, cx, cz, w, d, y + 0.22 * big, 0.3 * big, 0.3 * big, color);
  if (f.detail === 'high' && big >= 1) cornice(f, cx, cz, w, d, y + 0.52 * big, 0.12, 0.38 * big, shade(cl(color), 1.05));
}

export type Face = 'S' | 'N' | 'E' | 'W';

/** Transform to a box face: local x along the face (left→right seen from outside), +z outward, origin at face centre. */
export function withFace(f: Fab, face: Face, cx: number, cz: number, w: number, d: number, fn: (len: number) => void): void {
  const rot = face === 'S' ? 0 : face === 'E' ? Math.PI / 2 : face === 'N' ? Math.PI : -Math.PI / 2;
  const off = face === 'S' || face === 'N' ? d / 2 : w / 2;
  const dx = face === 'E' ? off : face === 'W' ? -off : 0;
  const dz = face === 'S' ? off : face === 'N' ? -off : 0;
  f.pushTRS(cx + dx, 0, cz + dz, rot);
  fn(face === 'S' || face === 'N' ? w : d);
  f.pop();
}

export type RailKind = 'glass' | 'metal' | 'solid' | 'iron';

/** facade code marking railing panels: the metal / glass shaders draw
 *  balusters + handrail (iron) or a frosted pane with a handrail (glass) */
export const RAIL_CODE = facCode(WinKind.Rail);

/** Flat railing panel in the plane z (x0..x1), height h above y, UV v normalized 0..1. */
function railPanel(B: ModelBuilder, mat: MatKey, x0: number, x1: number, z: number, y: number, h: number, color: ColorLike, back: boolean): void {
  B.quad(mat, { x: x0, y, z }, { x: x1, y, z }, { x: x1, y: y + h, z }, { x: x0, y: y + h, z }, [[x0, 0], [x1, 0], [x1, 1], [x0, 1]], color, { x: 0, y: 0, z: 1 });
  if (back) B.quad(mat, { x: x1, y, z }, { x: x0, y, z }, { x: x0, y: y + h, z }, { x: x1, y: y + h, z }, [[x1, 0], [x0, 0], [x0, 1], [x1, 1]], color, { x: 0, y: 0, z: -1 });
}

/** Side railing panel along z (z0..z1) in the plane x. */
function railSide(B: ModelBuilder, mat: MatKey, x: number, z0: number, z1: number, y: number, h: number, color: ColorLike): void {
  B.quad(mat, { x, y, z: z0 }, { x, y, z: z1 }, { x, y: y + h, z: z1 }, { x, y: y + h, z: z0 }, [[z0, 0], [z1, 0], [z1, 1], [z0, 1]], color, { x: 1, y: 0, z: 0 });
  B.quad(mat, { x, y, z: z1 }, { x, y, z: z0 }, { x, y: y + h, z: z0 }, { x, y: y + h, z: z1 }, [[z1, 0], [z0, 0], [z0, 1], [z1, 1]], color, { x: -1, y: 0, z: 0 });
}

/** Balconies on a face (use inside withFace): per bay or continuous bands.
 *  `wall` (the facade colour) tints the shadowed balcony seen through iron railings. */
export function balconies(f: Fab, len: number, floors: number[], opts: { bay: number; depth: number; width?: number; continuous?: boolean; rail: RailKind; slab: ColorLike; railColor: ColorLike; wall?: ColorLike; every?: number; offset?: number }): void {
  const B = f.m();
  const R = f.m(RAIL_CODE);
  const n = Math.max(1, Math.round(len / opts.bay));
  const bw = len / n;
  const dep = opts.depth;
  const railH = 1.05;
  const segs: [number, number][] = [];
  // too many individual balconies (towers) → continuous balcony bands
  const perBay = Math.ceil(n / (opts.every ?? 1));
  if (opts.continuous || floors.length * perBay > 70) segs.push([-len / 2, len / 2]);
  else {
    const width = Math.min(bw - 0.3, opts.width ?? bw * 0.8);
    const every = opts.every ?? 1;
    for (let i = opts.offset ?? 0; i < n; i += every) {
      const c = -len / 2 + (i + 0.5) * bw;
      segs.push([c - width / 2, c + width / 2]);
    }
  }
  // modelled balusters for small balcony counts (the per-model budget is shared
  // by every balcony run); otherwise the railing shader draws them
  let barCount = 0;
  for (const [a, b] of segs) barCount += Math.max(2, Math.round((b - a) / 0.5)) * floors.length;
  const ironish = opts.rail === 'iron' || opts.rail === 'metal';
  const bars = ironish && f.detail === 'high' && barCount <= f.barBudget;
  if (bars) f.barBudget -= barCount;
  // many balconies (towers, courtyard blocks): hidden faces are dropped
  const lean = floors.length * segs.length > 40;
  const see = mix(opts.wall !== undefined ? shade(cl(opts.wall), 0.3) : shade(cl(opts.slab), 0.28), col('#1c1d20'), 0.35);
  const panelMat: MatKey = opts.rail === 'glass' ? 'glass' : 'metal';
  const panelCol = opts.rail === 'glass' ? opts.railColor : see;
  for (const y of floors) {
    for (const [a, b] of segs) {
      const w = b - a, c = (a + b) / 2;
      B.box('concrete', c, y - 0.18, dep / 2, w, 0.18, dep, opts.slab, { bottom: true, sides: lean ? { n: false, e: false, w: false } : { n: false } });
      if (opts.rail === 'solid') {
        B.box('plain', c, y, dep - 0.04, w, railH, 0.06, opts.railColor, { sides: lean ? { n: false, e: false, w: false } : { n: false } });
        if (!lean) {
          B.box('plain', a + 0.03, y, dep / 2, 0.06, railH, dep - 0.08, opts.railColor, { sides: { n: false, s: false } });
          B.box('plain', b - 0.03, y, dep / 2, 0.06, railH, dep - 0.08, opts.railColor, { sides: { n: false, s: false } });
        }
        continue;
      }
      if (bars) {
        B.box('metal', c, y + railH - 0.05, dep - 0.03, w, 0.05, 0.05, opts.railColor);
        const nb = Math.max(2, Math.round(w / 0.5));
        for (let k = 0; k <= nb; k++) B.box('metal', a + (k / nb) * w, y, dep - 0.03, 0.035, railH, 0.035, opts.railColor, { top: false });
        B.box('metal', a + 0.02, y, dep / 2, 0.035, railH, dep, opts.railColor, { top: false, sides: { s: false, n: false } });
        B.box('metal', b - 0.02, y, dep / 2, 0.035, railH, dep, opts.railColor, { top: false, sides: { s: false, n: false } });
        continue;
      }
      railPanel(R, panelMat, a, b, dep - 0.03, y, railH, panelCol, !lean);
      if (!lean) {
        railSide(R, panelMat, a + 0.02, 0, dep - 0.03, y, railH, panelCol);
        railSide(R, panelMat, b - 0.02, 0, dep - 0.03, y, railH, panelCol);
      }
    }
  }
}

/** Front door (use inside withFace or with face at z). */
export function door(f: Fab, x: number, z: number, w: number, h: number, color: ColorLike, frame: ColorLike = P.trimWhite, lamp = true, canopy?: ColorLike): void {
  const B = f.m();
  B.box('plain', x, GROUND, z + 0.02, w + 0.3, h + 0.15, 0.1, frame, { sides: { n: false } });
  B.box('wood', x, GROUND, z + 0.07, w, h, 0.08, color, { sides: { n: false } });
  if (f.detail !== 'low') B.box('glass', x, GROUND + h * 0.62, z + 0.12, w * 0.5, h * 0.25, 0.02, P.glassDark, { sides: { n: false } });
  B.box('concrete', x, 0, z + 0.45, w + 1.0, GROUND + 0.16, 0.9, P.concreteLight);
  if (canopy) B.box('plain', x, GROUND + h + 0.25, z + 0.55, w + 0.9, 0.12, 1.1, canopy, { bottom: true });
  if (lamp) {
    B.box('emissive', x + w / 2 + 0.3, GROUND + h * 0.8, z + 0.1, 0.16, 0.26, 0.12, 0xffe2b0);
    f.light(x + w / 2 + 0.3, GROUND + h * 0.8, z + 0.3, 0xffc27a, 1.6, 'lamp');
  }
}

/** Awning over a storefront at the face plane z (inside withFace). */
export function awning(f: Fab, x0: number, x1: number, z: number, y: number, depth: number, color: ColorLike, striped: boolean, stripe: ColorLike = P.white): void {
  const B = f.m();
  const drop = depth * 0.45;
  if (striped && f.detail !== 'low') {
    const n = Math.max(2, Math.round((x1 - x0) / 0.5));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      const c = i % 2 ? stripe : color;
      B.quad('plain', { x: a, y, z }, { x: b, y, z }, { x: b, y: y - drop, z: z + depth }, { x: a, y: y - drop, z: z + depth }, [[0, 0], [1, 0], [1, 1], [0, 1]], c, { x: 0, y: 1, z: 0.5 });
      B.quad('plain', { x: a, y: y - drop, z: z + depth }, { x: b, y: y - drop, z: z + depth }, { x: b, y: y - drop - 0.3, z: z + depth }, { x: a, y: y - drop - 0.3, z: z + depth }, [[0, 0], [1, 0], [1, 1], [0, 1]], c, { x: 0, y: 0, z: 1 });
    }
  } else {
    B.quad('plain', { x: x0, y, z }, { x: x1, y, z }, { x: x1, y: y - drop, z: z + depth }, { x: x0, y: y - drop, z: z + depth }, [[0, 0], [1, 0], [1, 1], [0, 1]], color, { x: 0, y: 1, z: 0.5 });
    B.quad('plain', { x: x0, y: y - drop, z: z + depth }, { x: x1, y: y - drop, z: z + depth }, { x: x1, y: y - drop - 0.3, z: z + depth }, { x: x0, y: y - drop - 0.3, z: z + depth }, [[0, 0], [1, 0], [1, 1], [0, 1]], color, { x: 0, y: 0, z: 1 });
  }
  // underside (dark)
  B.quad('plain', { x: x0, y: y - 0.02, z }, { x: x0, y: y - drop - 0.02, z: z + depth }, { x: x1, y: y - drop - 0.02, z: z + depth }, { x: x1, y: y - 0.02, z }, [[0, 0], [0, 1], [1, 1], [1, 0]], shade(cl(color), 0.45), DOWN);
  // side cheeks
  B.tri('plain', { x: x0, y, z }, { x: x0, y: y - drop, z: z + depth }, { x: x0, y: y - drop - 0.3, z: z + depth }, [0, 0], [1, 0], [1, 1], color, { x: -1, y: 0, z: 0 });
  B.tri('plain', { x: x1, y, z }, { x: x1, y: y - drop - 0.3, z: z + depth }, { x: x1, y: y - drop, z: z + depth }, [0, 0], [1, 1], [1, 0], color, { x: 1, y: 0, z: 0 });
}

/** Illuminated sign box (fascia sign or blade sign). kind: 'box' flush panel, 'blade' perpendicular, 'neon' glowing letters. */
export function sign(f: Fab, x: number, y: number, z: number, w: number, h: number, color: ColorLike, kind: 'box' | 'blade' | 'neon' = 'box', light = true): void {
  const B = f.m();
  const c = cl(color);
  if (kind === 'blade') {
    B.box('metal', x, y + h, z + 0.35, 0.08, 0.08, 0.7, P.gunmetal);
    B.box('neon', x, y, z + 0.75, 0.2, h, Math.max(0.6, w), c, { bottom: true });
    if (light) for (const t of h > 5 ? [0.3, 0.7] : [0.5]) f.light(x, y + h * t, z + 0.75, c.getHex(), Math.min(3.2, 1.2 + h * 0.2), 'neon');
  } else if (kind === 'neon') {
    B.box('plain', x, y, z + 0.05, w + 0.2, h + 0.2, 0.1, '#1e2024', { sides: { n: false } });
    B.box('neon', x, y + h * 0.2, z + 0.12, w * 0.9, h * 0.6, 0.06, c, { sides: { n: false } });
    if (light) f.light(x, y + h / 2, z + 0.4, c.getHex(), Math.min(3.5, Math.max(1.4, w * 0.35)), 'neon');
  } else {
    B.box('emissive', x, y, z + 0.06, w, h, 0.12, c, { sides: { n: false } });
    if (light) f.light(x, y + h / 2, z + 0.5, c.getHex(), Math.min(3, Math.max(1.2, w * 0.3)), 'lamp');
  }
}

/** Rooftop billboard on a frame. */
export function billboard(f: Fab, x: number, y: number, z: number, w: number, h: number, rot: number, hue: number): void {
  f.pushTRS(x, y, z, rot);
  const B = f.m();
  for (const px of [-w * 0.35, w * 0.35]) B.box('metal', px, 0, 0, 0.2, h * 0.6 + 1.2, 0.2, P.steelDark);
  B.box('metal', 0, 1.2, -0.15, w, 0.15, 0.6, P.steelDark);
  B.box('plain', 0, 1.2 + h * 0.08, -0.05, w + 0.2, h + 0.2, 0.18, '#2a2c30');
  adPanel(f, 0, 1.3 + h * 0.08, 0.045, w, h, 'emissive', hue);
  // gooseneck floodlights along the top edge
  const nL = Math.max(2, Math.round(w / 6));
  for (let i = 0; i < nL; i++) {
    const lx = -w / 2 + (i + 0.5) * (w / nL);
    B.box('metal', lx, 1.3 + h * 1.08, 0.05, 0.08, 0.08, 0.9, P.gunmetal);
    B.box('emissive', lx, 1.3 + h * 1.08 - 0.12, 0.9, 0.35, 0.14, 0.22, 0xfff4e0);
    f.light(lx, 1.3 + h * 1.08 - 0.2, 1.0, 0xfff0d8, 0.9, 'lamp');
  }
  f.pop();
}

/** Advert panel / media screen facing +Z in the plane z (centre x, bottom y):
 *  the emissive / neon shaders paint procedural ad art on it (seeded per model;
 *  `hue` only tints the frame). Neon panels act as animated LED screens. */
export function adPanel(f: Fab, x: number, y: number, z: number, w: number, h: number, mat: 'emissive' | 'neon' = 'emissive', hue = 0): void {
  const hh = Math.min(15.9, h);
  // byte 1 = design variant so neighbouring panels show different ads
  const B = f.m(facCode(WinKind.Ad, f.rng.int(1, 255) / 64, hh / 4));
  const x0 = x - w / 2, x1 = x + w / 2;
  B.quad(mat, { x: x0, y, z }, { x: x1, y, z }, { x: x1, y: y + hh, z }, { x: x0, y: y + hh, z }, [[0, 0], [w, 0], [w, hh], [0, hh]], 0xffffff, { x: 0, y: 0, z: 1 });
  if (mat === 'neon') f.m().box('plain', x, y - 0.25, z - 0.12, w + 0.5, hh + 0.5, 0.1, hueCol(hue, 0.2, 0.12), { sides: { n: false } });
}

// ── rooftop plant ────────────────────────────────────────────────────────
export function hvac(f: Fab, x: number, y: number, z: number, w: number, d: number, h = 1.2): void {
  const B = f.m();
  B.box('metal', x, y, z, w, h, d, '#b6bcc2');
  if (f.detail !== 'low') {
    const n = Math.max(1, Math.floor(w / 1.6));
    for (let i = 0; i < n; i++) B.cylinder('metal', x - w / 2 + (i + 0.5) * (w / n), y + h, z, Math.min(0.6, d * 0.35), Math.min(0.6, d * 0.35), 0.12, '#50565c', 8);
  }
}

/** Classic wooden water tank on a steel stand. */
export function waterTower(f: Fab, x: number, y: number, z: number, r = 1.6): void {
  const B = f.m();
  const legH = 3.2;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('metal', x + dx * r * 0.62, y, z + dz * r * 0.62, 0.16, legH, 0.16, P.gunmetal, { top: false });
  B.box('metal', x, y + legH - 0.2, z, r * 1.7, 0.2, r * 1.7, P.gunmetal);
  B.cylinder('wood', x, y + legH, z, r, r, r * 2.1, '#8c6a48', 10);
  B.cylinder('roof_metal', x, y + legH + r * 2.1, z, r * 1.06, 0.1, r * 0.8, '#5c5850', 10);
  f.mass(x, z, r * 2, r * 2, y, legH + r * 2.9, '#8c6a48', '#5c5850', LodFacade.None);
}

export function antenna(f: Fab, x: number, y: number, z: number, h: number, beacon = true): void {
  const B = f.m();
  B.cylinder('metal', x, y, z, 0.12, 0.05, h, '#c8ccd0', 5, {});
  if (f.detail !== 'low') for (let i = 1; i <= 3; i++) B.box('metal', x, y + h * (0.25 * i), z, 1.2 - i * 0.25, 0.05, 0.05, '#c8ccd0');
  if (beacon) f.light(x, y + h + 0.2, z, 0xff2a1a, 2.4, 'beacon', true);
  f.reach(y + h);
}

/** Tilted solar panel array covering a rectangle. */
export function solarArray(f: Fab, cx: number, y: number, cz: number, w: number, d: number): void {
  const B = f.m();
  const rowD = 1.9;
  const n = Math.max(1, Math.floor(d / (rowD + 0.9)));
  for (let i = 0; i < n; i++) {
    const z = cz - d / 2 + (i + 0.5) * (d / n);
    const y0 = y + 0.3, y1 = y + 0.95;
    B.quad('solar', { x: cx - w / 2, y: y0, z: z + rowD / 2 }, { x: cx + w / 2, y: y0, z: z + rowD / 2 }, { x: cx + w / 2, y: y1, z: z - rowD / 2 }, { x: cx - w / 2, y: y1, z: z - rowD / 2 }, [[0, 0], [w, 0], [w, rowD], [0, rowD]], 0xffffff, { x: 0, y: 1, z: 0.35 });
    B.box('metal', cx, y, z - rowD / 2 + 0.1, w, 0.95, 0.08, P.steelDark, { top: false });
  }
}

/** Green roof: grass surface with shrubs and a few small trees. */
export function greenRoof(f: Fab, cx: number, y: number, cz: number, w: number, d: number, trees = 2): void {
  const B = f.m();
  B.box('dirt', cx, y, cz, w, 0.25, d, P.dirtDark, { top: 'grass', topColor: '#6d9a44' });
  const rng = f.rng;
  for (let i = 0; i < trees; i++) {
    const x = cx + (rng.next() - 0.5) * w * 0.7, z = cz + (rng.next() - 0.5) * d * 0.7;
    f.pushTRS(0, y + 0.25 - GROUND, 0);
    tree(f, x, z, 3 + rng.next() * 2.5, rng.chance(0.3) ? 'cone' : 'round');
    f.pop();
  }
  if (f.detail !== 'low') {
    f.pushTRS(0, y + 0.25 - GROUND, 0);
    shrubs(f, cx, cz, w * 0.85, d * 0.85, Math.round((w * d) / 30));
    f.pop();
  }
}

/** Rooftop helipad (circle marking on a raised deck). */
export function helipad(f: Fab, cx: number, y: number, cz: number, s: number): void {
  const B = f.m();
  B.box('concrete', cx, y, cz, s, 0.4, s, '#55595e', { top: 'asphalt', topColor: '#3d4044' });
  B.cylinder('plain', cx, y + 0.41, cz, s * 0.4, s * 0.4, 0.02, 0xf2c230, 16);
  B.cylinder('asphalt', cx, y + 0.42, cz, s * 0.36, s * 0.36, 0.02, '#3d4044', 16);
  B.box('plain', cx - s * 0.12, y + 0.44, cz, s * 0.05, 0.02, s * 0.36, 0xf4f4f0);
  B.box('plain', cx + s * 0.12, y + 0.44, cz, s * 0.05, 0.02, s * 0.36, 0xf4f4f0);
  B.box('plain', cx, y + 0.44, cz, s * 0.24, 0.02, s * 0.05, 0xf4f4f0);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) f.light(cx + dx * s * 0.45, y + 0.6, cz + dz * s * 0.45, 0x6cff7a, 1.2, 'beacon', false);
}

/** Generic roof clutter for flat roofs of mid/high-rise buildings. */
export function roofClutter(f: Fab, cx: number, cz: number, w: number, d: number, y: number, o: { tank?: boolean; hvac?: number; bulkhead?: { mat: MatKey; color: ColorLike }; antenna?: number; beacon?: boolean; solar?: boolean }): void {
  const rng = f.rng;
  const B = f.m();
  const usedX: number[] = [];
  if (o.bulkhead) {
    const bw = Math.min(w * 0.35, 7), bd = Math.min(d * 0.3, 5.5);
    const bx = cx + (rng.next() - 0.5) * (w - bw) * 0.5, bz = cz + (rng.next() - 0.5) * (d - bd) * 0.5;
    f.fbox(o.bulkhead.mat, BLANK, bx, y, bz, bw, bd, 3.2, o.bulkhead.color, { top: 'roof_flat', topColor: '#77787a', lod: LodFacade.None });
    usedX.push(bx);
  }
  const nh = o.hvac ?? 0;
  for (let i = 0; i < nh; i++) {
    const hw = 1.4 + rng.next() * 2.2, hd = 1.2 + rng.next() * 1.4;
    hvac(f, cx + (rng.next() - 0.5) * (w - hw - 1), y, cz + (rng.next() - 0.5) * (d - hd - 1), hw, hd, 0.9 + rng.next() * 0.9);
  }
  if (o.tank) waterTower(f, cx + (rng.chance(0.5) ? 1 : -1) * (w / 2 - 2.5), y, cz - d / 2 + 2.6, 1.3 + rng.next() * 0.6);
  if (o.solar && w > 8 && d > 8) solarArray(f, cx, y, cz + d * 0.15, w * 0.6, d * 0.45);
  if (o.antenna) antenna(f, cx + (rng.next() - 0.5) * w * 0.4, y, cz + (rng.next() - 0.5) * d * 0.4, o.antenna, o.beacon ?? true);
  void B;
}

// ── chimneys ─────────────────────────────────────────────────────────────
export function chimney(f: Fab, x: number, z: number, y0: number, h: number, mat: MatKey, color: ColorLike, w = 0.9): void {
  const B = f.m();
  (mat === 'wall_brick' ? f.m(BLANK) : B).box(mat === 'wall_brick' ? 'wall_brick' : 'plain', x, y0, z, w, h, w * 0.8, color, { top: 'concrete', topColor: '#6d6a66' });
  B.box('concrete', x, y0 + h, z, w + 0.2, 0.15, w * 0.8 + 0.2, '#8c8882');
  f.reach(y0 + h + 0.15);
}

// ── vehicles ─────────────────────────────────────────────────────────────
const CAR_COLS = ['#d8d8d4', '#1f2226', '#8e959c', '#9c1e1e', '#23406e', '#f2f2ee', '#4a5a4a', '#b89a5a', '#5c6b7a', '#c9c4b5'];

export function car(f: Fab, x: number, z: number, rot: number, color?: ColorLike): void {
  if (f.detail === 'low') return;
  f.pushTRS(x, GROUND, z, rot);
  const B = f.m();
  const c = color ?? f.rng.pick(CAR_COLS);
  B.box('plain', 0, 0.28, 0, 1.8, 0.62, 4.3, c);
  B.box('glass', 0, 0.9, -0.2, 1.62, 0.52, 2.2, '#2a3440', { topColor: c });
  B.box('plain', 0, 0.02, 0, 1.6, 0.28, 3.6, '#1a1a1c', { top: false });
  f.pop();
}

export function truck(f: Fab, x: number, z: number, rot: number, color?: ColorLike, trailer = true): void {
  if (f.detail === 'low') return;
  f.pushTRS(x, GROUND, z, rot);
  const B = f.m();
  const c = color ?? f.rng.pick(['#e8e6e0', '#c43a2f', '#2f64c0', '#f0c02f', '#3f8f4a', '#d8d8d4']);
  // cab faces +Z
  B.box('plain', 0, 0.5, trailer ? 5.2 : 2.2, 2.4, 2.4, 2.2, c);
  B.box('glass', 0, 2.0, (trailer ? 5.2 : 2.2) + 1.0, 2.2, 0.8, 0.25, '#28323c');
  B.box('plain', 0, 0.1, 0, 2.0, 0.45, trailer ? 12 : 6, '#222326', { top: false });
  if (trailer) B.box('metal', 0, 0.9, -1.2, 2.5, 2.9, 11.5, f.rng.pick(['#e9e9e6', '#b8bec4', '#9a3b2c', '#355c7d']));
  else B.box('metal', 0, 0.9, -0.8, 2.4, 2.4, 4.2, '#e6e6e2');
  f.pop();
}

// ── industrial kit ───────────────────────────────────────────────────────
/** Vertical storage tank with a shallow cone roof and a ladder. */
export function tank(f: Fab, x: number, z: number, r: number, h: number, color: ColorLike, roof: 'cone' | 'dome' | 'flat' = 'cone'): void {
  const B = f.m();
  const seg = f.detail === 'low' ? 10 : 16;
  B.cylinder('metal', x, GROUND, z, r, r, h, color, seg, { top: roof === 'flat' });
  if (roof === 'cone') B.cylinder('metal', x, GROUND + h, z, r * 1.01, r * 0.12, r * 0.25, shade(cl(color), 0.92), seg, { top: true });
  else if (roof === 'dome') B.sphere('metal', x, GROUND + h, z, r, shade(cl(color), 0.95), { hemi: true, wSeg: seg, hSeg: 5, scaleY: 0.35 });
  if (f.detail !== 'low') {
    B.box('metal', x + r + 0.12, GROUND, z, 0.08, h, 0.6, P.steelDark, { top: false });
    B.box('metal', x, GROUND + h * 0.5, z, r * 2 + 0.06, 0.12, r * 2 + 0.06, shade(cl(color), 0.8), { top: false });
  }
  f.mass(x, z, r * 1.8, r * 1.8, 0, h + r * 0.2, color, color, LodFacade.None);
}

/** Tall silo with domed cap. */
export function silo(f: Fab, x: number, z: number, r: number, h: number, color: ColorLike, cap: ColorLike = P.steel): void {
  const B = f.m();
  const seg = f.detail === 'low' ? 8 : 12;
  B.cylinder('metal', x, GROUND, z, r, r, h, color, seg, { top: false });
  if (f.detail !== 'low') for (let y = 2.5; y < h; y += 2.5) B.cylinder('metal', x, GROUND + y, z, r * 1.015, r * 1.015, 0.12, shade(cl(color), 0.85), seg, { top: false });
  B.sphere('metal', x, GROUND + h, z, r, cap, { hemi: true, wSeg: seg, hSeg: 5, scaleY: 0.6 });
  f.mass(x, z, r * 1.8, r * 1.8, 0, h + r * 0.5, color, cap, LodFacade.None);
}

/** Industrial chimney stack with red/white bands, smoke emitter and beacon. */
export function stack(f: Fab, x: number, z: number, r: number, h: number, bands = true, smoke = 1): void {
  const B = f.m();
  const seg = f.detail === 'low' ? 8 : 12;
  B.cylinder('concrete', x, GROUND, z, r, r * 0.72, h, '#b9b3aa', seg, { top: false });
  if (bands) {
    const rt = r * 0.72;
    for (let i = 0; i < 2; i++) {
      const y = h - 2.2 - i * 4.4;
      const t = y / h;
      const rr = r + (rt - r) * t;
      B.cylinder('plain', x, GROUND + y, z, rr + 0.02, rr - 0.02, 2.2, i % 2 ? '#f2f0ea' : '#c43a2f', seg, { top: false });
    }
  }
  B.cylinder('metal', x, GROUND + h, z, r * 0.74, r * 0.74, 0.3, '#2b2b2b', seg, { top: false });
  if (smoke > 0) f.emitter('smoke', x, GROUND + h + 0.5, z, smoke);
  if (h > 25) f.light(x, GROUND + h + 0.4, z, 0xff2a1a, 2.2, 'beacon', true);
  f.mass(x, z, r * 1.6, r * 1.6, 0, h, '#b9b3aa', '#2b2b2b', LodFacade.None);
}

/** Pipe run between two points at height y (horizontal) on small supports. */
export function pipe(f: Fab, ax: number, az: number, bx: number, bz: number, y: number, r: number, color: ColorLike): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.2) return;
  f.pushTRS((ax + bx) / 2, 0, (az + bz) / 2, -Math.atan2(bz - az, bx - ax));
  const B = f.m();
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1, true);
  B.addGeometry('metal', g, color, new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  g.dispose();
  for (let s = -len / 2 + 1; s < len / 2; s += 6) B.box('metal', s, GROUND, 0, 0.15, y - GROUND, 0.15, P.steelDark, { top: false });
  f.pop();
}

/** Pile of material (logs, ore, gravel) as a faceted cone. */
export function pile(f: Fab, x: number, z: number, r: number, h: number, mat: MatKey, color: ColorLike): void {
  f.m().cylinder(mat, x, GROUND, z, r, r * 0.12, h, color, 7, { top: true });
  f.mass(x, z, r * 1.4, r * 1.4, 0, h * 0.5, color, color, LodFacade.None);
}

/** Stack of logs lying along X: a bark-covered triangular pile with end-grain
 *  faces, plus a few individual logs on top at high detail. */
export function logStack(f: Fab, cx: number, cz: number, len: number, rows: number, cols: number, r = 0.32): void {
  const B = f.m();
  const rng = f.rng;
  const wBase = cols * r * 2.02, hPile = rows * r * 1.75;
  const x0 = cx - len / 2, x1 = cx + len / 2;
  const zb0 = cz - wBase / 2, zb1 = cz + wBase / 2, zt = wBase * 0.18;
  const y0 = GROUND, y1 = GROUND + hPile;
  const bark = rng.pick(['#6b4f34', '#7a5a3a', '#5e4630']);
  B.quad('bark', { x: x0, y: y0, z: zb1 }, { x: x1, y: y0, z: zb1 }, { x: x1, y: y1, z: cz + zt }, { x: x0, y: y1, z: cz + zt }, [[0, 0], [len, 0], [len, 2], [0, 2]], bark, { x: 0, y: 0.6, z: 1 });
  B.quad('bark', { x: x1, y: y0, z: zb0 }, { x: x0, y: y0, z: zb0 }, { x: x0, y: y1, z: cz - zt }, { x: x1, y: y1, z: cz - zt }, [[0, 0], [len, 0], [len, 2], [0, 2]], bark, { x: 0, y: 0.6, z: -1 });
  B.quad('bark', { x: x0, y: y1, z: cz + zt }, { x: x1, y: y1, z: cz + zt }, { x: x1, y: y1, z: cz - zt }, { x: x0, y: y1, z: cz - zt }, [[0, 0], [len, 0], [len, 1], [0, 1]], bark, UP);
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    B.quad('wood', { x, y: y0, z: zb0 }, { x, y: y0, z: zb1 }, { x, y: y1, z: cz + zt }, { x, y: y1, z: cz - zt }, [[0, 0], [1, 0], [1, 1], [0, 1]], '#c9a276', { x: s, y: 0, z: 0 });
  }
  if (f.detail === 'high') {
    const g = new THREE.CylinderGeometry(r, r, len * 0.95, 6, 1, false);
    for (let i = 0; i < 2; i++) B.addGeometry('bark', g, bark, new THREE.Matrix4().makeTranslation(cx + (rng.next() - 0.5) * 0.6, y1 + r * 0.7, cz + (i - 0.5) * r * 2.1).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
    g.dispose();
  }
  f.mass(cx, cz, len, wBase * 0.8, 0, hPile, bark, '#b08a5a', LodFacade.None);
}

/** Pallet stacks / crates (small boxes) — yard clutter. */
export function crates(f: Fab, cx: number, cz: number, w: number, d: number, n: number): void {
  const B = f.m();
  const rng = f.rng;
  for (let i = 0; i < n; i++) {
    const s = 1 + rng.next() * 0.6;
    const h = 0.8 + rng.int(0, 2) * 0.9;
    B.box(rng.chance(0.6) ? 'wood' : 'plain', cx + (rng.next() - 0.5) * (w - s), GROUND, cz + (rng.next() - 0.5) * (d - s), s, h, s, rng.pick(['#a57c52', '#8e6b45', '#3f6fa0', '#4a7a4a', '#b8b0a0']));
  }
}

/** Shipping container. */
export function container(f: Fab, x: number, y: number, z: number, rot: number, color: ColorLike, long = true): void {
  f.pushTRS(x, y, z, rot);
  f.m(BLANK).box('wall_industrial', 0, GROUND, 0, 2.44, 2.6, long ? 12.2 : 6.1, color, { top: 'roof_metal', topColor: color });
  f.pop();
}

/** Sawtooth north-light roof over a rectangle (teeth along X). */
export function sawtoothRoof(f: Fab, cx: number, cz: number, w: number, d: number, y: number, teeth: number, roofColor: ColorLike, glassColor: ColorLike = '#9cb8c8'): void {
  const B = f.m();
  const tw = d / teeth;
  const th = Math.min(3.2, tw * 0.55);
  for (let i = 0; i < teeth; i++) {
    const z0 = cz + d / 2 - i * tw, z1 = z0 - tw;
    // sloped roof from low (z0) to high (z1)
    roofQuad(B, 'roof_metal', [{ x: cx - w / 2, y, z: z0 }, { x: cx + w / 2, y, z: z0 }, { x: cx + w / 2, y: y + th, z: z1 }, { x: cx - w / 2, y: y + th, z: z1 }], { x: cx - w / 2, y, z: z0 }, [1, 0], [0, -1], Math.hypot(tw, th) / tw, roofColor, { x: 0, y: 1, z: th / tw });
    // vertical glazing facing -Z (north light)
    B.quad('glass', { x: cx + w / 2, y, z: z1 }, { x: cx - w / 2, y, z: z1 }, { x: cx - w / 2, y: y + th, z: z1 }, { x: cx + w / 2, y: y + th, z: z1 }, [[0, 0], [w, 0], [w, th], [0, th]], glassColor, { x: 0, y: 0, z: -1 });
    // triangle ends
    f.m(BLANK).tri('wall_industrial', { x: cx - w / 2, y, z: z0 }, { x: cx - w / 2, y: y + th, z: z1 }, { x: cx - w / 2, y, z: z1 }, [0, y], [tw, y + th], [tw, y], roofColor, { x: -1, y: 0, z: 0 });
    f.m(BLANK).tri('wall_industrial', { x: cx + w / 2, y, z: z1 }, { x: cx + w / 2, y: y + th, z: z1 }, { x: cx + w / 2, y, z: z0 }, [0, y], [0, y + th], [tw, y], roofColor, { x: 1, y: 0, z: 0 });
  }
  f.mass(cx, cz, w, d, y, th * 0.6, roofColor, roofColor, LodFacade.None);
  f.reach(y + th);
}

/** Barrel-vault roof (arched) along X. */
export function vaultRoof(f: Fab, cx: number, cz: number, w: number, d: number, y: number, rise: number, mat: MatKey, color: ColorLike, endMat: MatKey = 'wall_industrial', endColor?: ColorLike): void {
  const B = f.m();
  const n = f.detail === 'low' ? 5 : 9;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.PI * t;
    pts.push([cz + (d / 2) * Math.cos(a), y + rise * Math.sin(a)]);
  }
  let v = 0;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
    const sl = Math.hypot(z1 - z0, y1 - y0);
    const mid = { x: 0, y: (y0 + y1) / 2 - y + 0.01, z: (z0 + z1) / 2 - cz };
    B.quad(mat, { x: cx - w / 2, y: y0, z: z0 }, { x: cx + w / 2, y: y0, z: z0 }, { x: cx + w / 2, y: y1, z: z1 }, { x: cx - w / 2, y: y1, z: z1 }, [[cx - w / 2, v], [cx + w / 2, v], [cx + w / 2, v + sl], [cx - w / 2, v + sl]], color, mid);
    v += sl;
    // end caps
    f.m(BLANK).tri(endMat, { x: cx - w / 2, y, z: cz }, { x: cx - w / 2, y: y0, z: z0 }, { x: cx - w / 2, y: y1, z: z1 }, [d / 2, y], [z0 - cz + d / 2, y0], [z1 - cz + d / 2, y1], endColor ?? color, { x: -1, y: 0, z: 0 });
    f.m(BLANK).tri(endMat, { x: cx + w / 2, y, z: cz }, { x: cx + w / 2, y: y1, z: z1 }, { x: cx + w / 2, y: y0, z: z0 }, [d / 2, y], [z1 - cz + d / 2, y1], [z0 - cz + d / 2, y0], endColor ?? color, { x: 1, y: 0, z: 0 });
  }
  f.mass(cx, cz, w, d, y, rise * 0.6, color, color, LodFacade.None);
  f.reach(y + rise);
}

/** Loading dock doors + bumpers along a face (inside withFace). */
export function loadingDocks(f: Fab, len: number, n: number, color: ColorLike): void {
  const B = f.m();
  const sp = len / n;
  B.box('concrete', 0, 0, 1.2, len, GROUND + 1.1, 2.4, P.concrete, { sides: { n: false } });
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * sp;
    f.m(BLANK).box('wall_industrial', x, GROUND + 1.1, 0.02, 3, 3.2, 0.1, color, { sides: { n: false } });
    B.box('plain', x, GROUND + 1.1, 0.1, 2.6, 2.9, 0.05, '#3a3d42', { sides: { n: false } });
    B.box('plain', x, GROUND + 4.4, 0.8, 3.4, 0.12, 1.6, '#6a6e72', { bottom: true });
    f.light(x, GROUND + 4.2, 0.6, 0xffd9a0, 2.2, 'flood');
  }
}

/** Attic/gable facade code helper for styles. */
export const ROUND_ATTIC = facCode(WinKind.Round, 1.8, 1.8, 0);
