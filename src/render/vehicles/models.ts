// Procedural vehicle models (local space: origin at the vehicle center on the
// road surface, front = +Z, up = +Y). Every model is a handful of extruded
// side profiles (body + greenhouse), boxes, wheels and light lenses, 80–400
// triangles, with material channels (see builder.ts) so one shared material
// renders paint, glass, chrome and all the lights. Each model also gets a
// far-LOD proxy and light anchors for the night glow sprites.
import type * as THREE from 'three';
import { Model, MODEL_COUNT, MODEL_HALF_W, MODEL_LEN } from '../../sim/traffic/types';
import { Ch, VB } from './builder';

const DARK = 0x1d1e21;
const TRIM = 0x2b2d31;
const GLASS = 0x1b2530;
const CHROME = 0xa4a9af;
const HEAD = 0xf6f2e4;
const TAIL = 0x9e1218;
const WHITE = 0xf1f2f0;
const GREY = 0x9aa0a6;
const AMBER = 0xf0a020;

export interface LightMeta {
  /** headlight anchors: y, half spacing x, z */
  hy: number;
  hx: number;
  hz: number;
  /** tail lights */
  ty: number;
  tx: number;
  tz: number;
  /** light bar / siren anchors (0 = none) */
  by: number;
  bx: number;
  bz: number;
  /** amber beacon / taxi sign anchor (0 = none) */
  ay: number;
  az: number;
  /** height of the model (shadow / bounds) */
  h: number;
}

export interface VehicleModel {
  geo: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  meta: LightMeta;
  tris: number;
}

type P = [number, number][];
const e = (ch: number, c: number): [number, number] => [ch, c];

function meta(p: Partial<LightMeta> & { h: number }): LightMeta {
  return { hy: 0, hx: 0, hz: 0, ty: 0, tx: 0, tz: 0, by: 0, bx: 0, bz: 0, ay: 0, az: 0, ...p };
}

/** side windows helper: a slanted quad lying on a tapered hull side */
function onSide(b: VB, hwB: number, hwT: number, yB: number, yT: number, y0: number, y1: number, z0: number, z1: number, ch: number, color: number, eps = 0.012): void {
  const hw = (y: number) => hwB + ((hwT - hwB) * (y - yB)) / Math.max(1e-6, yT - yB) + eps;
  for (const s of [1, -1]) b.quad([s * hw(y0), y0, z0], [s * hw(y0), y0, z1], [s * hw(y1), y1, z1], [s * hw(y1), y1, z0], ch, color, [s, 0, 0]);
}

function wheels(b: VB, x: number, r: number, w: number, zs: number[], segs = 8, archX = 0, bottom = 0.25): void {
  for (const z of zs) {
    if (archX) {
      b.arch(archX, z, r, r, bottom);
      b.arch(-archX, z, r, r, bottom);
    }
    b.wheel(x, r, z, r, w, segs);
    b.wheel(-x, r, z, r, w, segs);
  }
}

function lights(b: VB, m: LightMeta, hw: number, hh: number, tw: number, th: number): void {
  for (const s of [1, -1]) {
    if (m.hz) b.lens(s * m.hx, m.hy, m.hz, hw, hh, 1, Ch.Head, HEAD);
    if (m.tz) b.lens(s * m.tx, m.ty, m.tz, tw, th, -1, Ch.Tail, TAIL);
  }
}

// ── cars ──────────────────────────────────────────────────────────────────
interface CarSpec {
  body: P;
  bodyHw: [number, number];
  cabin: P;
  cabinHw: [number, number];
  /** edge index of the windshield / rear window in the cabin profile */
  wind: number[];
  wheelR: number;
  wheelX: number;
  wheelW: number;
  wheelZ: number[];
  grille?: number[];
  meta: LightMeta;
  pillarZ?: [number, number];
}

function car(spec: CarSpec, extra?: (b: VB) => void): VB {
  const b = new VB();
  const nb = spec.body.length;
  b.hull(spec.body, spec.bodyHw[0], spec.bodyHw[1], (k) => (k === 0 ? null : spec.grille?.includes(k) ? e(Ch.Fixed, TRIM) : k === nb - 1 ? e(Ch.Fixed, TRIM) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  const nc = spec.cabin.length;
  b.hull(spec.cabin, spec.cabinHw[0], spec.cabinHw[1], (k) => (k === nc - 1 ? null : spec.wind.includes(k) ? e(Ch.Glass, GLASS) : e(Ch.Paint, 0xffffff)), e(Ch.Glass, GLASS));
  // B-pillar on the tapered side windows
  let yB = Infinity, yT = -Infinity;
  for (const [, y] of spec.cabin) (yB = Math.min(yB, y)), (yT = Math.max(yT, y));
  const pz = spec.pillarZ ?? [-0.12, 0.06];
  onSide(b, spec.cabinHw[0], spec.cabinHw[1], yB, yT, yB + 0.02, yT - 0.05, pz[0], pz[1], Ch.Paint, 0xffffff);
  // sills, bumpers, wheel wells
  let zMin = Infinity, zMax = -Infinity, bMin = Infinity;
  for (const [z, y] of spec.body) (zMin = Math.min(zMin, z)), (zMax = Math.max(zMax, z)), (bMin = Math.min(bMin, y));
  const sideX = spec.bodyHw[0] + 0.004;
  for (const sgn of [1, -1]) b.sidePanel(sgn * sideX, bMin, bMin + 0.11, zMin + 0.25, zMax - 0.25, Ch.Fixed, TRIM);
  b.lens(0, bMin + 0.1, zMax + 0.02, spec.bodyHw[0] * 1.9, 0.16, 1, Ch.Fixed, TRIM);
  b.lens(0, bMin + 0.1, zMin - 0.02, spec.bodyHw[0] * 1.9, 0.16, -1, Ch.Fixed, TRIM);
  wheels(b, spec.wheelX, spec.wheelR, spec.wheelW, spec.wheelZ, 8, sideX + 0.002, bMin);
  lights(b, spec.meta, 0.4, 0.13, 0.36, 0.12);
  extra?.(b);
  return b;
}

function mirrors(b: VB, x: number, y: number, z: number): void {
  b.box(x, y, z, 0.12, 0.1, 0.14, Ch.Paint, 0xffffff);
  b.box(-x, y, z, 0.12, 0.1, 0.14, Ch.Paint, 0xffffff);
}

const SEDAN: CarSpec = {
  body: [[-2.28, 0.24], [2.25, 0.24], [2.32, 0.45], [2.28, 0.63], [2.05, 0.75], [1.05, 0.85], [-1.75, 0.89], [-2.22, 0.85], [-2.32, 0.64], [-2.33, 0.42]],
  bodyHw: [0.89, 0.86],
  cabin: [[1.12, 0.84], [0.24, 1.37], [-0.92, 1.39], [-1.74, 0.87]],
  cabinHw: [0.82, 0.64],
  wind: [0, 2],
  wheelR: 0.33,
  wheelX: 0.79,
  wheelW: 0.22,
  wheelZ: [1.42, -1.38],
  grille: [2],
  meta: meta({ hy: 0.6, hx: 0.6, hz: 2.33, ty: 0.72, tx: 0.62, tz: -2.34, h: 1.4 }),
};

function sedan(): VB {
  return car(SEDAN, (b) => mirrors(b, 0.93, 0.93, 0.98));
}

function hatchback(): VB {
  return car(
    {
      body: [[-1.95, 0.25], [1.95, 0.25], [2.01, 0.45], [1.96, 0.63], [1.72, 0.75], [0.85, 0.85], [-1.8, 0.9], [-2.0, 0.8], [-2.02, 0.45]],
      bodyHw: [0.86, 0.83],
      cabin: [[0.92, 0.84], [0.05, 1.39], [-1.52, 1.37], [-1.92, 0.88]],
      cabinHw: [0.8, 0.64],
      wind: [0, 2],
      wheelR: 0.31,
      wheelX: 0.76,
      wheelW: 0.2,
      wheelZ: [1.24, -1.26],
      grille: [2],
      meta: meta({ hy: 0.62, hx: 0.58, hz: 2.02, ty: 0.86, tx: 0.62, tz: -2.02, h: 1.4 }),
      pillarZ: [-0.35, -0.2],
    },
    (b) => mirrors(b, 0.9, 0.93, 0.8),
  );
}

function suv(): VB {
  return car(
    {
      body: [[-2.3, 0.38], [2.28, 0.38], [2.36, 0.62], [2.31, 0.88], [2.02, 1.0], [1.2, 1.06], [-2.2, 1.09], [-2.35, 0.96], [-2.37, 0.6]],
      bodyHw: [0.95, 0.93],
      cabin: [[1.26, 1.04], [0.45, 1.66], [-1.96, 1.68], [-2.3, 1.08]],
      cabinHw: [0.9, 0.76],
      wind: [0, 2],
      wheelR: 0.38,
      wheelX: 0.82,
      wheelW: 0.27,
      wheelZ: [1.45, -1.45],
      grille: [2],
      meta: meta({ hy: 0.8, hx: 0.63, hz: 2.37, ty: 0.95, tx: 0.7, tz: -2.36, h: 1.72 }),
      pillarZ: [-0.2, -0.02],
    },
    (b) => {
      mirrors(b, 1.0, 1.12, 1.05);
      // roof rails + lower cladding
      b.box(0.58, 1.68, -0.75, 0.06, 0.07, 2.2, Ch.Chrome, CHROME);
      b.box(-0.58, 1.68, -0.75, 0.06, 0.07, 2.2, Ch.Chrome, CHROME);
      for (const s of [1, -1]) b.sidePanel(s * 0.955, 0.38, 0.56, -2.2, 2.15, Ch.Fixed, TRIM);
    },
  );
}

function pickup(): VB {
  const b = new VB();
  const body: P = [[-2.65, 0.42], [2.6, 0.42], [2.67, 0.64], [2.63, 0.92], [2.3, 1.03], [1.35, 1.08], [-2.6, 1.08], [-2.67, 0.64]];
  b.hull(body, 0.97, 0.95, (k) => (k === 0 ? null : k === 2 ? e(Ch.Chrome, CHROME) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  // open bed
  b.quad([-0.84, 1.085, -2.5], [0.84, 1.085, -2.5], [0.84, 1.085, -0.45], [-0.84, 1.085, -0.45], Ch.Fixed, 0x24262a, [0, 1, 0]);
  const cab: P = [[1.36, 1.06], [0.62, 1.7], [-0.36, 1.72], [-0.44, 1.06]];
  b.hull(cab, 0.92, 0.8, (k) => (k === 3 ? null : k === 1 ? e(Ch.Paint, 0xffffff) : e(Ch.Glass, GLASS)), e(Ch.Glass, GLASS));
  onSide(b, 0.92, 0.8, 1.06, 1.72, 1.08, 1.67, 0.2, 0.36, Ch.Paint, 0xffffff);
  mirrors(b, 1.03, 1.15, 1.2);
  const m = meta({ hy: 0.82, hx: 0.66, hz: 2.66, ty: 0.86, tx: 0.78, tz: -2.68, h: 1.75 });
  for (const sgn of [1, -1]) b.sidePanel(sgn * 0.975, 0.42, 0.54, -2.4, 2.4, Ch.Fixed, TRIM);
  wheels(b, 0.83, 0.4, 0.28, [1.7, -1.6], 8, 0.977, 0.42);
  lights(b, m, 0.38, 0.16, 0.18, 0.3);
  return b;
}

function minivan(): VB {
  return car(
    {
      body: [[-2.4, 0.32], [2.4, 0.32], [2.46, 0.56], [2.4, 0.79], [2.1, 0.93], [-2.4, 1.01], [-2.46, 0.56]],
      bodyHw: [0.95, 0.93],
      cabin: [[2.08, 0.9], [0.9, 1.72], [-2.18, 1.75], [-2.42, 0.99]],
      cabinHw: [0.9, 0.78],
      wind: [0, 2],
      wheelR: 0.34,
      wheelX: 0.82,
      wheelW: 0.24,
      wheelZ: [1.55, -1.55],
      grille: [2],
      meta: meta({ hy: 0.66, hx: 0.64, hz: 2.46, ty: 0.95, tx: 0.72, tz: -2.47, h: 1.75 }),
      pillarZ: [0.35, 0.5],
    },
    (b) => {
      mirrors(b, 1.0, 1.05, 1.5);
      onSide(b, 0.9, 0.78, 0.9, 1.75, 0.95, 1.7, -0.9, -0.76, Ch.Paint, 0xffffff);
    },
  );
}

function sports(): VB {
  return car(
    {
      body: [[-2.2, 0.2], [2.15, 0.2], [2.25, 0.36], [2.1, 0.52], [0.7, 0.73], [-1.8, 0.79], [-2.2, 0.71], [-2.25, 0.4]],
      bodyHw: [0.96, 0.92],
      cabin: [[0.78, 0.71], [-0.15, 1.15], [-0.85, 1.17], [-1.95, 0.77]],
      cabinHw: [0.84, 0.6],
      wind: [0, 2],
      wheelR: 0.33,
      wheelX: 0.83,
      wheelW: 0.3,
      wheelZ: [1.36, -1.34],
      grille: [2],
      meta: meta({ hy: 0.46, hx: 0.66, hz: 2.2, ty: 0.64, tx: 0.66, tz: -2.26, h: 1.18 }),
      pillarZ: [-0.6, -0.45],
    },
    (b) => {
      b.box(0, 0.82, -2.02, 1.7, 0.05, 0.28, Ch.Shade, 0xffffff);
      b.box(0.62, 0.72, -2.02, 0.06, 0.1, 0.06, Ch.Fixed, DARK);
      b.box(-0.62, 0.72, -2.02, 0.06, 0.1, 0.06, Ch.Fixed, DARK);
    },
  );
}

function taxi(): VB {
  const b = sedan();
  b.box(0, 1.39, -0.3, 0.52, 0.2, 0.24, Ch.Amber, AMBER, { top: Ch.Fixed, topColor: 0x3a3b3e });
  for (const s of [1, -1]) b.sidePanel(s * 0.895, 0.58, 0.66, -1.9, 2.0, Ch.Fixed, 0x1a1a1a);
  return b;
}

function police(): VB {
  const b = sedan();
  for (const s of [1, -1]) b.sidePanel(s * 0.895, 0.3, 0.8, -1.15, 1.15, Ch.Fixed, 0x15161a);
  // light bar
  b.box(0, 1.39, -0.3, 1.2, 0.07, 0.3, Ch.Fixed, DARK);
  b.box(0.3, 1.46, -0.3, 0.56, 0.12, 0.26, Ch.SirenA, 0xa0181c);
  b.box(-0.3, 1.46, -0.3, 0.56, 0.12, 0.26, Ch.SirenB, 0x1a3aa0);
  b.box(0, 0.3, 2.36, 1.3, 0.34, 0.12, Ch.Fixed, DARK);
  return b;
}

function hearse(): VB {
  return car(
    {
      body: [[-2.78, 0.24], [2.75, 0.24], [2.82, 0.45], [2.78, 0.63], [2.55, 0.76], [1.45, 0.86], [-2.7, 0.9], [-2.82, 0.64], [-2.83, 0.42]],
      bodyHw: [0.95, 0.92],
      cabin: [[1.5, 0.85], [0.6, 1.45], [-2.55, 1.47], [-2.78, 0.9]],
      cabinHw: [0.88, 0.74],
      wind: [0, 2],
      wheelR: 0.35,
      wheelX: 0.83,
      wheelW: 0.23,
      wheelZ: [1.85, -1.75],
      grille: [2],
      meta: meta({ hy: 0.6, hx: 0.64, hz: 2.83, ty: 0.72, tx: 0.66, tz: -2.84, h: 1.48 }),
      pillarZ: [0.2, 0.36],
    },
    (b) => {
      onSide(b, 0.88, 0.74, 0.85, 1.47, 0.95, 1.4, -2.4, -0.4, Ch.Fixed, 0x2a1f24);
      for (const s of [1, -1]) b.sidePanel(s * 0.955, 0.55, 0.59, -2.7, 2.7, Ch.Chrome, CHROME);
      mirrors(b, 0.98, 0.95, 1.4);
    },
  );
}

// ── vans & trucks ─────────────────────────────────────────────────────────
function panelVan(post: boolean): VB {
  const b = new VB();
  const prof: P = [[-2.8, 0.3], [2.75, 0.3], [2.82, 0.58], [2.74, 0.92], [2.25, 1.2], [1.62, 2.18], [1.36, 2.3], [-2.66, 2.34], [-2.8, 2.2]];
  b.hull(prof, 1.0, 0.96, (k) => (k === 0 ? null : k === 4 ? e(Ch.Glass, GLASS) : k === 2 ? e(Ch.Fixed, TRIM) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  onSide(b, 1.0, 0.96, 0.3, 2.34, 1.25, 1.9, 1.1, 1.92, Ch.Glass, GLASS);
  onSide(b, 1.0, 0.96, 0.3, 2.34, 0.62, 2.05, 0.2, 0.24, Ch.Shade, 0xffffff, 0.016);
  onSide(b, 1.0, 0.96, 0.3, 2.34, 0.3, 0.44, -2.7, 2.7, Ch.Fixed, TRIM, 0.014);
  if (post) {
    onSide(b, 1.0, 0.96, 0.3, 2.34, 0.95, 1.12, -2.7, 1.0, Ch.Satin, 0x1d4fa0, 0.018);
    onSide(b, 1.0, 0.96, 0.3, 2.34, 1.12, 1.2, -2.7, 1.0, Ch.Satin, 0xd23b2a, 0.018);
  }
  b.lens(0, 1.3, -2.805, 1.7, 1.6, -1, Ch.Shade, 0xffffff);
  b.lens(0, 0.4, -2.81, 1.9, 0.2, -1, Ch.Fixed, TRIM);
  b.lens(0, 0.4, 2.83, 1.9, 0.2, 1, Ch.Fixed, TRIM);
  mirrors(b, 1.06, 1.4, 1.8);
  const m = meta({ hy: 0.78, hx: 0.7, hz: 2.8, ty: 0.9, tx: 0.86, tz: -2.81, h: 2.34 });
  wheels(b, 0.86, 0.38, 0.25, [1.95, -1.75], 8, 1.005, 0.3);
  lights(b, m, 0.34, 0.2, 0.14, 0.4);
  return b;
}

function cab(b: VB, zRear: number, zFront: number, top: number, hw: number, ch: number, color: number, bottom = 0.5): void {
  const len = zFront - zRear;
  const prof: P = [[zRear, bottom], [zFront - 0.05, bottom], [zFront, bottom + 0.3], [zFront - 0.04, bottom + 0.85], [zFront - 0.3, bottom + 1.0], [zFront - 0.6, top - 0.05], [zRear, top]];
  b.hull(prof, hw, hw - 0.06, (k) => (k === 0 ? null : k === 5 ? e(Ch.Glass, GLASS) : k === 2 ? e(Ch.Fixed, TRIM) : e(ch, color)), e(ch, color));
  onSide(b, hw, hw - 0.06, bottom, top, bottom + 1.05, top - 0.35, zRear + len * 0.25, zFront - 0.75, Ch.Glass, GLASS);
  mirrors(b, hw + 0.12, bottom + 1.2, zFront - 0.5);
}

function boxTruck(): VB {
  const b = new VB();
  cab(b, 1.9, 3.8, 2.65, 1.15, Ch.Paint, 0xffffff);
  b.box(0, 0.45, -0.9, 1.8, 0.5, 5.6, Ch.Fixed, DARK, { skip: 't' });
  b.box(0, 0.95, -0.95, 2.4, 2.5, 5.7, Ch.Satin, 0xeeeeea, { top: Ch.Satin, topColor: 0xd7d9d6 });
  for (const s of [1, -1]) b.sidePanel(s * 1.205, 1.35, 1.6, -3.7, 1.8, Ch.Paint, 0xffffff);
  b.lens(0, 2.15, -3.805, 2.2, 2.3, -1, Ch.Fixed, 0xc9cbc8);
  const m = meta({ hy: 0.95, hx: 0.82, hz: 3.81, ty: 0.75, tx: 1.0, tz: -3.82, h: 3.45 });
  wheels(b, 0.95, 0.48, 0.34, [2.95], 8, 1.155, 0.5);
  wheels(b, 0.9, 0.48, 0.44, [-2.4], 8);
  lights(b, m, 0.32, 0.22, 0.26, 0.16);
  return b;
}

function semiTractor(): VB {
  const b = new VB();
  const hood: P = [[1.1, 0.7], [3.0, 0.7], [3.1, 1.0], [3.05, 1.62], [2.7, 1.76], [1.1, 1.92]];
  b.hull(hood, 1.05, 0.95, (k) => (k === 0 ? null : k === 2 ? e(Ch.Chrome, CHROME) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  const cabp: P = [[-1.6, 0.92], [1.2, 0.92], [1.25, 1.92], [0.95, 3.0], [-1.6, 3.2]];
  b.hull(cabp, 1.25, 1.2, (k) => (k === 0 ? null : k === 2 ? e(Ch.Glass, GLASS) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  onSide(b, 1.25, 1.2, 0.92, 3.2, 2.05, 2.72, 0.2, 1.02, Ch.Glass, GLASS);
  b.box(0, 0.55, -1.0, 1.6, 0.45, 4.2, Ch.Fixed, DARK);
  b.box(0, 1.0, -2.2, 1.4, 0.08, 1.2, Ch.Fixed, 0x3a3c40);
  for (const s of [1, -1]) {
    b.box(s * 1.12, 1.0, -0.72, 0.13, 2.7, 0.13, Ch.Chrome, CHROME, { skip: 'b' });
    b.box(s * 1.05, 0.62, 0.3, 0.36, 0.42, 0.9, Ch.Chrome, CHROME);
  }
  mirrors(b, 1.38, 2.3, 1.1);
  const m = meta({ hy: 1.2, hx: 0.8, hz: 3.08, ty: 0.9, tx: 0.95, tz: -3.1, h: 3.6 });
  wheels(b, 0.98, 0.52, 0.32, [2.3], 8, 1.055, 0.7);
  wheels(b, 0.9, 0.52, 0.46, [-1.9, -2.9], 8);
  lights(b, m, 0.34, 0.2, 0.2, 0.12);
  return b;
}

function semiTrailer(): VB {
  const b = new VB();
  b.box(0, 1.28, 0, 2.5, 2.75, 12.4, Ch.Paint, 0xffffff, { top: Ch.Satin, topColor: 0xd9dbd8 });
  b.box(0, 0.95, -0.5, 1.2, 0.33, 11.2, Ch.Fixed, DARK, { skip: 't' });
  for (const s of [1, -1]) {
    b.box(s * 0.7, 0.2, 4.2, 0.12, 0.8, 0.12, Ch.Fixed, DARK);
    b.sidePanel(s * 1.255, 1.3, 1.45, -6.1, 6.1, Ch.Fixed, 0x3a3c40);
  }
  b.lens(0, 2.65, -6.205, 2.36, 2.6, -1, Ch.Satin, 0xcfd1ce);
  const m = meta({ ty: 1.15, tx: 1.05, tz: -6.21, h: 4.03 });
  wheels(b, 0.9, 0.52, 0.46, [-4.6, -5.8], 8);
  lights(b, m, 0, 0, 0.26, 0.14);
  return b;
}

// ── transit ───────────────────────────────────────────────────────────────
function bus(): VB {
  const b = new VB();
  const hw = 1.28;
  const prof: P = [[-6.0, 0.36], [5.95, 0.36], [6.02, 0.92], [5.98, 2.68], [5.72, 3.06], [-5.86, 3.06], [-6.0, 2.8]];
  b.hull(prof, hw, hw - 0.03, (k) => (k === 0 ? null : k === 1 ? e(Ch.Paint, 0xffffff) : k === 2 ? e(Ch.Glass, GLASS) : k === 3 ? e(Ch.Sign, 0x3a2a10) : e(Ch.Satin, WHITE)), e(Ch.Satin, WHITE));
  onSide(b, hw, hw - 0.03, 0.36, 3.06, 1.2, 2.58, -5.6, 5.3, Ch.Cabin, GLASS, 0.012);
  onSide(b, hw, hw - 0.03, 0.36, 3.06, 0.4, 1.0, -5.95, 5.95, Ch.Paint, 0xffffff, 0.014);
  // doors (curb side for right-hand traffic is local -X)
  for (const [z0, z1] of [[4.25, 5.35], [-0.6, 0.6]]) {
    b.sidePanel(-(hw + 0.02), 0.42, 2.6, z0, z1, Ch.Cabin, GLASS);
  }
  b.box(0, 3.06, -1.2, 1.7, 0.3, 3.2, Ch.Satin, 0xc9ccd0);
  mirrors(b, 1.42, 2.4, 5.7);
  const m = meta({ hy: 0.75, hx: 0.95, hz: 6.03, ty: 0.9, tx: 1.05, tz: -6.01, h: 3.36 });
  wheels(b, 1.02, 0.5, 0.36, [3.9, -2.4], 8, 1.288, 0.36);
  lights(b, m, 0.34, 0.2, 0.2, 0.34);
  return b;
}

function tramHead(): VB {
  const b = new VB();
  const hw = 1.2;
  const prof: P = [[-5.2, 0.4], [4.6, 0.4], [5.15, 0.92], [5.2, 1.3], [5.0, 2.62], [4.5, 3.22], [-5.2, 3.22]];
  b.hull(prof, hw, hw - 0.04, (k) => (k === 0 ? null : k === 1 || k === 2 ? e(Ch.Paint, 0xffffff) : k === 3 ? e(Ch.Glass, GLASS) : k === 4 ? e(Ch.Sign, 0x3a2a10) : k === 6 ? e(Ch.Fixed, 0x2d2f33) : e(Ch.Satin, WHITE)), e(Ch.Satin, WHITE));
  onSide(b, hw, hw - 0.04, 0.4, 3.22, 1.25, 2.72, -4.8, 4.1, Ch.Cabin, GLASS);
  onSide(b, hw, hw - 0.04, 0.4, 3.22, 0.45, 1.08, -5.15, 4.7, Ch.Paint, 0xffffff, 0.015);
  b.box(0, 3.22, -1.5, 1.2, 0.35, 2.6, Ch.Satin, 0xb7bbc0);
  pantograph(b, 1.0);
  for (const z of [3.3, -3.6]) b.box(0, 0.08, z, 1.9, 0.34, 2.0, Ch.Fixed, DARK, { skip: 't' });
  const m = meta({ hy: 0.85, hx: 0.8, hz: 5.19, ty: 1.0, tx: 0.95, tz: 5.18, h: 3.9 });
  lights(b, m, 0.3, 0.14, 0, 0);
  // rear-marker lenses on the nose (lit when this unit runs last)
  for (const s of [1, -1]) b.lens(s * 0.98, 1.08, 5.17, 0.16, 0.1, 1, Ch.Marker, TAIL);
  return b;
}

function pantograph(b: VB, z: number): void {
  b.box(0, 3.57, z, 0.9, 0.12, 0.7, Ch.Fixed, DARK);
  b.quad([-0.02, 3.69, z - 0.35], [0.02, 3.69, z - 0.35], [0.02, 4.4, z + 0.2], [-0.02, 4.4, z + 0.2], Ch.Chrome, GREY, [1, 0, 0]);
  b.quad([-0.02, 3.69, z - 0.35], [0.02, 3.69, z - 0.35], [0.02, 4.4, z + 0.2], [-0.02, 4.4, z + 0.2], Ch.Chrome, GREY, [-1, 0, 0]);
  b.box(0, 4.4, z + 0.2, 1.3, 0.04, 0.08, Ch.Chrome, GREY);
}

function tramMid(): VB {
  const b = new VB();
  const hw = 1.2;
  const prof: P = [[-4.3, 0.4], [4.3, 0.4], [4.3, 3.22], [-4.3, 3.22]];
  b.hull(prof, hw, hw - 0.04, (k) => (k === 0 ? null : k === 1 || k === 3 ? e(Ch.Fixed, 0x2d2f33) : e(Ch.Satin, WHITE)), e(Ch.Satin, WHITE));
  onSide(b, hw, hw - 0.04, 0.4, 3.22, 1.25, 2.72, -3.9, 3.9, Ch.Cabin, GLASS);
  onSide(b, hw, hw - 0.04, 0.4, 3.22, 0.45, 1.08, -4.25, 4.25, Ch.Paint, 0xffffff, 0.015);
  b.box(0, 3.22, 0.5, 1.3, 0.3, 3.0, Ch.Satin, 0xb7bbc0);
  b.box(0, 0.08, 0, 1.9, 0.34, 2.0, Ch.Fixed, DARK, { skip: 't' });
  return b;
}

function locomotive(): VB {
  const b = new VB();
  const hw = 1.5;
  const prof: P = [[-9.3, 0.95], [8.2, 0.95], [9.2, 1.3], [9.3, 1.85], [8.6, 3.0], [7.2, 3.86], [-9.3, 3.9]];
  b.hull(prof, hw, hw - 0.1, (k) => (k === 0 ? null : k === 1 || k === 2 ? e(Ch.Paint, 0xffffff) : k === 3 ? e(Ch.Glass, GLASS) : k === 4 ? e(Ch.Paint, 0xffffff) : k === 6 ? e(Ch.Fixed, 0x2d2f33) : e(Ch.Satin, 0xe6e9ec)), e(Ch.Satin, 0xe6e9ec));
  onSide(b, hw, hw - 0.1, 0.95, 3.9, 1.25, 1.75, -9.25, 8.3, Ch.Paint, 0xffffff, 0.015);
  onSide(b, hw, hw - 0.1, 0.95, 3.9, 2.05, 2.95, -8.0, 6.6, Ch.Cabin, GLASS);
  b.box(0, 3.9, -3.5, 1.5, 0.28, 5, Ch.Satin, 0xb7bbc0);
  for (const z of [6.1, -6.3]) b.box(0, 0.2, z, 2.4, 0.75, 3.0, Ch.Fixed, DARK, { skip: 't' });
  const m = meta({ hy: 1.55, hx: 0.85, hz: 9.27, ty: 1.55, tx: 1.15, tz: 9.26, h: 4.2 });
  lights(b, m, 0.34, 0.16, 0, 0);
  for (const s of [1, -1]) b.lens(s * 1.12, 1.55, 9.26, 0.16, 0.12, 1, Ch.Marker, TAIL);
  return b;
}

function carriage(len: number, doors: number, metro: boolean): VB {
  const b = new VB();
  const hw = metro ? 1.45 : 1.5, h = len / 2;
  const prof: P = [[-h, 0.95], [h, 0.95], [h, 3.5], [h - 0.3, 3.9], [-h + 0.3, 3.9], [-h, 3.5]];
  b.hull(prof, hw, hw - 0.1, (k) => (k === 0 ? null : k === 1 || k === 5 ? e(Ch.Fixed, 0x2d2f33) : k === 3 ? e(Ch.Satin, 0xb9bdc2) : e(Ch.Satin, 0xe6e9ec)), e(Ch.Satin, 0xe6e9ec));
  onSide(b, hw, hw - 0.1, 0.95, 3.9, 1.95, 2.95, -h + 0.8, h - 0.8, Ch.Cabin, GLASS);
  onSide(b, hw, hw - 0.1, 0.95, 3.9, 1.2, 1.62, -h + 0.05, h - 0.05, Ch.Paint, 0xffffff, 0.015);
  const dz = len / (doors + 1);
  for (let d = 1; d <= doors; d++) {
    const z = -h + dz * d;
    onSide(b, hw, hw - 0.1, 0.95, 3.9, 1.05, 3.15, z - 0.65, z + 0.65, Ch.Satin, 0x7d848c, 0.02);
  }
  for (const z of [h - 3, -h + 3]) b.box(0, 0.2, z, 2.4, 0.75, 2.8, Ch.Fixed, DARK, { skip: 't' });
  return b;
}

function cargoWagon(): VB {
  const b = new VB();
  b.box(0, 0.95, 0, 2.6, 0.35, 16, Ch.Fixed, 0x2b2d31);
  b.box(0, 1.3, 3.3, 2.44, 2.6, 6.06, Ch.Paint, 0xffffff, { top: Ch.Shade, topColor: 0xffffff });
  b.box(0, 1.3, -3.3, 2.44, 2.6, 6.06, Ch.Satin, 0x2f6b4a, { top: Ch.Satin, topColor: 0x2a5c40 });
  for (const s of [1, -1]) for (const z of [3.3, -3.3]) for (let r = -2; r <= 2; r++) b.sidePanel(s * 1.225, 1.35, 3.85, z + r * 1.2 - 0.05, z + r * 1.2 + 0.05, Ch.Fixed, 0x202020);
  for (const z of [5.5, -5.5]) b.box(0, 0.2, z, 2.3, 0.75, 2.6, Ch.Fixed, DARK, { skip: 't' });
  return b;
}

function monorail(head: boolean): VB {
  const b = new VB();
  const hw = 1.35;
  const h = head ? 5.5 : 4.5;
  const prof: P = head ? [[-h, -0.9], [4.8, -0.9], [5.5, 0.2], [5.42, 1.55], [4.5, 2.82], [-h, 2.9]] : [[-h, -0.9], [h, -0.9], [h, 2.9], [-h, 2.9]];
  b.hull(prof, hw, hw - 0.12, (k) => {
    if (k === 0) return null;
    if (head) return k === 1 || k === 2 ? e(Ch.Paint, 0xffffff) : k === 3 ? e(Ch.Glass, GLASS) : k === 5 ? e(Ch.Fixed, 0x2d2f33) : e(Ch.Satin, WHITE);
    return k === 1 || k === 3 ? e(Ch.Fixed, 0x2d2f33) : e(Ch.Satin, WHITE);
  }, e(Ch.Satin, WHITE));
  onSide(b, hw, hw - 0.12, -0.9, 2.9, 0.75, 2.05, -h + 0.5, head ? 3.9 : h - 0.5, Ch.Cabin, GLASS);
  onSide(b, hw, hw - 0.12, -0.9, 2.9, -0.85, 0.35, -h + 0.05, head ? 4.9 : h - 0.05, Ch.Paint, 0xffffff, 0.015);
  const m = head ? meta({ hy: 0.1, hx: 0.9, hz: 5.35, ty: 0.1, tx: 1.05, tz: 5.3, h: 3.0 }) : meta({ h: 3.0 });
  if (head) {
    lights(b, m, 0.3, 0.12, 0, 0);
    for (const s of [1, -1]) b.lens(s * 1.1, 0.35, 5.2, 0.14, 0.1, 1, Ch.Marker, TAIL);
  }
  return b;
}

function ferry(): VB {
  const b = new VB();
  const hull: P = [[-13, -1.4], [11, -1.4], [13.1, 0.6], [13.4, 1.6], [-13, 1.6], [-13.1, 0.2]];
  b.hull(hull, 4.0, 4.2, (k) => (k === 0 ? null : k === 3 ? e(Ch.Satin, 0xc7c9c6) : e(Ch.Satin, WHITE)), e(Ch.Satin, WHITE));
  onSide(b, 4.0, 4.2, -1.4, 1.6, -0.4, 0.35, -12.9, 12.2, Ch.Fixed, 0x1d2836, 0.02);
  b.box(0, 1.6, -1.2, 7.2, 2.4, 17, Ch.Satin, WHITE, { top: Ch.Satin, topColor: 0xd5d8da });
  for (const s of [1, -1]) b.sidePanel(s * 3.61, 2.2, 3.4, -9.3, 6.9, Ch.Cabin, GLASS);
  b.box(0, 4.0, 0.8, 6.2, 2.0, 9, Ch.Satin, WHITE, { top: Ch.Satin, topColor: 0xd5d8da });
  for (const s of [1, -1]) b.sidePanel(s * 3.11, 4.4, 5.4, -3.2, 4.8, Ch.Cabin, GLASS);
  b.lens(0, 4.95, 5.31, 5.8, 1.0, 1, Ch.Glass, GLASS);
  b.box(0, 6.0, -3.8, 1.5, 2.3, 2.1, Ch.Paint, 0xffffff, { topInset: 0.1 });
  b.box(0, 8.3, -3.8, 1.5, 0.25, 2.1, Ch.Fixed, DARK);
  b.lens(0, 2.2, 13.35, 0.4, 0.3, 1, Ch.Head, HEAD);
  return b;
}

// ── services ──────────────────────────────────────────────────────────────
function fireTruck(): VB {
  const b = new VB();
  cab(b, 2.55, 4.4, 3.0, 1.22, Ch.Paint, 0xffffff, 0.55);
  b.box(0, 0.55, -0.95, 2.45, 2.35, 7.0, Ch.Paint, 0xffffff, { top: Ch.Satin, topColor: 0xb8bcc1 });
  for (const s of [1, -1]) {
    b.sidePanel(s * 1.235, 1.55, 1.72, -4.4, 4.38, Ch.Satin, 0xf2f0e8);
    for (let k = 0; k < 3; k++) b.sidePanel(s * 1.24, 0.75, 1.45, -4.1 + k * 2.1, -2.3 + k * 2.1, Ch.Satin, 0xc2c5ca);
    b.box(s * 0.55, 2.92, -0.9, 0.08, 0.1, 7.6, Ch.Chrome, CHROME);
  }
  for (let k = 0; k < 9; k++) b.box(0, 2.95, -4.2 + k * 0.9, 1.1, 0.05, 0.06, Ch.Chrome, CHROME, { skip: 'lr' });
  b.box(0, 3.0, 3.35, 1.4, 0.07, 0.3, Ch.Fixed, DARK);
  b.box(0.36, 3.07, 3.35, 0.66, 0.13, 0.26, Ch.SirenA, 0xa0181c);
  b.box(-0.36, 3.07, 3.35, 0.66, 0.13, 0.26, Ch.SirenB, 0x1a3aa0);
  for (const s of [1, -1]) b.box(s * 1.1, 2.9, -4.35, 0.2, 0.18, 0.12, Ch.SirenA, 0xa0181c);
  const m = meta({ hy: 1.05, hx: 0.85, hz: 4.41, ty: 0.85, tx: 1.05, tz: -4.46, by: 3.14, bx: 0.36, bz: 3.35, h: 3.3 });
  wheels(b, 0.98, 0.5, 0.34, [3.4], 8, 1.228, 0.55);
  wheels(b, 0.94, 0.5, 0.42, [-2.2, -3.3], 8, 1.232, 0.55);
  lights(b, m, 0.3, 0.2, 0.2, 0.14);
  return b;
}

function ambulance(): VB {
  const b = new VB();
  const cabp: P = [[1.05, 0.45], [2.95, 0.45], [3.1, 0.72], [3.02, 1.0], [2.55, 1.25], [1.9, 2.3], [1.05, 2.35]];
  b.hull(cabp, 1.03, 0.98, (k) => (k === 0 ? null : k === 5 ? e(Ch.Glass, GLASS) : k === 2 ? e(Ch.Fixed, TRIM) : e(Ch.Paint, 0xffffff)), e(Ch.Paint, 0xffffff));
  onSide(b, 1.03, 0.98, 0.45, 2.35, 1.3, 1.95, 1.2, 2.05, Ch.Glass, GLASS);
  b.box(0, 0.45, -1.0, 2.2, 2.35, 4.2, Ch.Paint, 0xffffff);
  for (const s of [1, -1]) {
    b.sidePanel(s * 1.105, 1.25, 1.52, -3.1, 1.1, Ch.Satin, 0xc8201e);
    b.sidePanel(s * 1.045, 1.1, 1.3, 1.1, 3.0, Ch.Satin, 0xc8201e);
  }
  b.box(0, 2.8, 0.95, 1.3, 0.07, 0.28, Ch.Fixed, DARK);
  b.box(0.33, 2.87, 0.95, 0.6, 0.12, 0.24, Ch.SirenA, 0xa0181c);
  b.box(-0.33, 2.87, 0.95, 0.6, 0.12, 0.24, Ch.SirenB, 0x1a3aa0);
  for (const s of [1, -1]) b.box(s * 0.95, 2.66, -3.05, 0.18, 0.16, 0.12, Ch.SirenA, 0xa0181c);
  mirrors(b, 1.12, 1.45, 2.2);
  const m = meta({ hy: 0.82, hx: 0.72, hz: 3.08, ty: 0.9, tx: 0.95, tz: -3.11, by: 2.93, bx: 0.33, bz: 0.95, h: 3.0 });
  wheels(b, 0.88, 0.37, 0.26, [2.15], 8, 1.036, 0.45);
  wheels(b, 0.88, 0.37, 0.26, [-1.8], 8, 1.106, 0.45);
  lights(b, m, 0.32, 0.18, 0.16, 0.3);
  return b;
}

function garbage(): VB {
  const b = new VB();
  cab(b, 2.3, 4.2, 2.85, 1.2, Ch.Satin, WHITE, 0.55);
  b.box(0, 0.9, -0.85, 2.45, 2.55, 5.5, Ch.Paint, 0xffffff, { topInset: 0.12 });
  b.box(0, 0.7, -4.0, 2.3, 2.4, 0.9, Ch.Fixed, 0x3b3e42, { topInsetZ: 0.2 });
  b.box(0, 0.5, -0.8, 1.8, 0.4, 7, Ch.Fixed, DARK, { skip: 't' });
  b.box(0, 2.85, 3.0, 0.3, 0.2, 0.3, Ch.Amber, AMBER);
  for (const s of [1, -1]) b.sidePanel(s * 1.23, 1.2, 1.35, -3.5, 1.8, Ch.Satin, WHITE);
  const m = meta({ hy: 1.0, hx: 0.85, hz: 4.21, ty: 0.85, tx: 1.0, tz: -4.46, ay: 3.1, az: 3.0, h: 3.45 });
  wheels(b, 0.98, 0.5, 0.34, [3.1], 8, 1.205, 0.55);
  wheels(b, 0.94, 0.5, 0.42, [-1.6, -2.7], 8, 1.23, 0.9);
  lights(b, m, 0.3, 0.2, 0.2, 0.14);
  return b;
}

function utility(): VB {
  const b = new VB();
  cab(b, 0.9, 2.7, 1.85, 0.98, Ch.Paint, 0xffffff, 0.42);
  b.box(0, 0.55, -1.2, 2.0, 1.25, 3.0, Ch.Satin, WHITE, { top: Ch.Satin, topColor: 0xcfd2d4 });
  for (const s of [1, -1]) b.sidePanel(s * 1.005, 0.7, 1.7, -2.6, 0.2, Ch.Satin, 0xd5d8da);
  b.box(0, 1.85, 1.6, 1.0, 0.07, 0.25, Ch.Fixed, DARK);
  b.box(0.3, 1.92, 1.6, 0.35, 0.12, 0.2, Ch.Amber, AMBER);
  b.box(-0.3, 1.92, 1.6, 0.35, 0.12, 0.2, Ch.Amber, AMBER);
  const m = meta({ hy: 0.75, hx: 0.66, hz: 2.71, ty: 0.8, tx: 0.85, tz: -2.72, ay: 2.02, az: 1.6, h: 2.0 });
  wheels(b, 0.84, 0.38, 0.26, [1.8], 8, 0.985, 0.42);
  wheels(b, 0.84, 0.38, 0.26, [-1.5], 8, 1.006, 0.55);
  lights(b, m, 0.3, 0.16, 0.16, 0.24);
  return b;
}

function bicycle(): VB {
  const b = new VB();
  const F = 0x2d3035;
  for (const z of [0.52, -0.52]) {
    b.wheel(0.02, 0.34, z, 0.34, 0.04, 8, 0x8a9096, 0x18191b);
  }
  b.box(0, 0.5, 0, 0.05, 0.05, 0.9, Ch.Fixed, F);
  b.box(0, 0.5, -0.12, 0.05, 0.45, 0.05, Ch.Fixed, F);
  b.box(0, 0.5, 0.42, 0.05, 0.5, 0.05, Ch.Fixed, F);
  b.box(0, 0.98, 0.4, 0.5, 0.04, 0.05, Ch.Fixed, F);
  // rider
  b.box(0, 0.5, -0.05, 0.3, 0.45, 0.18, Ch.Fixed, 0x2b3a55);
  b.box(0, 0.93, -0.02, 0.36, 0.55, 0.24, Ch.Paint, 0xffffff, { topInset: 0.04 });
  b.box(0.2, 1.1, 0.2, 0.08, 0.08, 0.42, Ch.Paint, 0xffffff);
  b.box(-0.2, 1.1, 0.2, 0.08, 0.08, 0.42, Ch.Paint, 0xffffff);
  b.box(0, 1.47, 0.02, 0.18, 0.2, 0.2, Ch.Fixed, 0xd6a07c);
  b.box(0, 1.62, 0.0, 0.22, 0.1, 0.26, Ch.Shade, 0xffffff);
  b.lens(0, 0.95, 0.45, 0.06, 0.05, 1, Ch.Head, HEAD);
  b.lens(0, 0.7, -0.62, 0.06, 0.05, -1, Ch.Tail, TAIL);
  return b;
}

// ── registry ──────────────────────────────────────────────────────────────
function farProxy(model: Model, h: number): VB {
  const b = new VB();
  const L = MODEL_LEN[model], hw = MODEL_HALF_W[model];
  const small = L < 6 && model !== Model.Bicycle;
  if (model === Model.Bicycle) {
    b.box(0, 0.3, 0, 0.3, 1.4, 1.7, Ch.Paint, 0xffffff, { skip: 'b' });
    return b;
  }
  if (small) {
    const body = h * 0.58;
    b.box(0, 0.25, 0, hw * 2, body - 0.25, L, Ch.Paint, 0xffffff);
    b.box(0, body, -L * 0.05, hw * 1.7, h - body, L * 0.52, Ch.Glass, GLASS, { top: Ch.Paint, topColor: 0xffffff });
    return b;
  }
  if (model === Model.Ferry) {
    b.box(0, -1, 0, hw * 2, 2.6, L, Ch.Satin, WHITE);
    b.box(0, 1.6, -1, hw * 1.7, 4.4, L * 0.62, Ch.Satin, WHITE);
    return b;
  }
  const transit = model === Model.Bus || model === Model.TramHead || model === Model.TramMid || model === Model.Locomotive || model === Model.Carriage || model === Model.Metro || model === Model.MonorailHead || model === Model.MonorailMid;
  const base = model === Model.MonorailHead || model === Model.MonorailMid ? -0.9 : model === Model.Locomotive || model === Model.Carriage || model === Model.Metro ? 0.95 : 0.4;
  b.box(0, base, 0, hw * 2, h - base, L, transit ? Ch.Satin : Ch.Paint, transit ? WHITE : 0xffffff, { top: Ch.Satin, topColor: 0xc9ccd0 });
  return b;
}

const BUILDERS: Record<number, () => VB> = {
  [Model.Sedan]: sedan,
  [Model.Hatchback]: hatchback,
  [Model.SUV]: suv,
  [Model.Pickup]: pickup,
  [Model.Minivan]: minivan,
  [Model.Sports]: sports,
  [Model.Taxi]: taxi,
  [Model.DeliveryVan]: () => panelVan(false),
  [Model.PostVan]: () => panelVan(true),
  [Model.BoxTruck]: boxTruck,
  [Model.SemiTractor]: semiTractor,
  [Model.SemiTrailer]: semiTrailer,
  [Model.Bus]: bus,
  [Model.TramHead]: tramHead,
  [Model.TramMid]: tramMid,
  [Model.Locomotive]: locomotive,
  [Model.Carriage]: () => carriage(20, 2, false),
  [Model.Metro]: () => carriage(17, 3, true),
  [Model.CargoWagon]: cargoWagon,
  [Model.FireTruck]: fireTruck,
  [Model.Police]: police,
  [Model.Ambulance]: ambulance,
  [Model.Garbage]: garbage,
  [Model.Hearse]: hearse,
  [Model.Bicycle]: bicycle,
  [Model.Utility]: utility,
  [Model.Ferry]: ferry,
  [Model.MonorailHead]: () => monorail(true),
  [Model.MonorailMid]: () => monorail(false),
};

/** light anchors for models whose builder does not return them via car specs */
const META: Partial<Record<number, LightMeta>> = {
  [Model.Sedan]: SEDAN.meta,
  [Model.Taxi]: { ...SEDAN.meta, ay: 1.5, az: -0.3 },
  [Model.Police]: { ...SEDAN.meta, by: 1.52, bx: 0.3, bz: -0.3 },
  [Model.Hatchback]: meta({ hy: 0.62, hx: 0.58, hz: 2.02, ty: 0.86, tx: 0.62, tz: -2.02, h: 1.4 }),
  [Model.SUV]: meta({ hy: 0.8, hx: 0.63, hz: 2.37, ty: 0.95, tx: 0.7, tz: -2.36, h: 1.72 }),
  [Model.Pickup]: meta({ hy: 0.82, hx: 0.66, hz: 2.66, ty: 0.86, tx: 0.78, tz: -2.68, h: 1.75 }),
  [Model.Minivan]: meta({ hy: 0.66, hx: 0.64, hz: 2.46, ty: 0.95, tx: 0.72, tz: -2.47, h: 1.75 }),
  [Model.Sports]: meta({ hy: 0.46, hx: 0.66, hz: 2.2, ty: 0.64, tx: 0.66, tz: -2.26, h: 1.18 }),
  [Model.Hearse]: meta({ hy: 0.6, hx: 0.64, hz: 2.83, ty: 0.72, tx: 0.66, tz: -2.84, h: 1.48 }),
  [Model.DeliveryVan]: meta({ hy: 0.78, hx: 0.7, hz: 2.8, ty: 0.9, tx: 0.86, tz: -2.81, h: 2.34 }),
  [Model.PostVan]: meta({ hy: 0.78, hx: 0.7, hz: 2.8, ty: 0.9, tx: 0.86, tz: -2.81, h: 2.34 }),
  [Model.BoxTruck]: meta({ hy: 0.95, hx: 0.82, hz: 3.81, ty: 0.75, tx: 1.0, tz: -3.82, h: 3.45 }),
  [Model.SemiTractor]: meta({ hy: 1.2, hx: 0.8, hz: 3.08, ty: 0.9, tx: 0.95, tz: -3.1, h: 3.6 }),
  [Model.SemiTrailer]: meta({ ty: 1.15, tx: 1.05, tz: -6.21, h: 4.03 }),
  [Model.Bus]: meta({ hy: 0.75, hx: 0.95, hz: 6.03, ty: 0.9, tx: 1.05, tz: -6.01, h: 3.36 }),
  [Model.TramHead]: meta({ hy: 0.85, hx: 0.8, hz: 5.19, ty: 1.08, tx: 0.98, tz: 5.18, h: 3.9 }),
  [Model.TramMid]: meta({ h: 3.6 }),
  [Model.Locomotive]: meta({ hy: 1.55, hx: 0.85, hz: 9.27, ty: 1.55, tx: 1.12, tz: 9.26, h: 4.2 }),
  [Model.Carriage]: meta({ h: 3.9 }),
  [Model.Metro]: meta({ h: 3.9 }),
  [Model.CargoWagon]: meta({ h: 3.9 }),
  [Model.FireTruck]: meta({ hy: 1.05, hx: 0.85, hz: 4.41, ty: 0.85, tx: 1.05, tz: -4.46, by: 3.14, bx: 0.36, bz: 3.35, h: 3.3 }),
  [Model.Ambulance]: meta({ hy: 0.82, hx: 0.72, hz: 3.08, ty: 0.9, tx: 0.95, tz: -3.11, by: 2.93, bx: 0.33, bz: 0.95, h: 3.0 }),
  [Model.Garbage]: meta({ hy: 1.0, hx: 0.85, hz: 4.21, ty: 0.85, tx: 1.0, tz: -4.46, ay: 3.1, az: 3.0, h: 3.45 }),
  [Model.Utility]: meta({ hy: 0.75, hx: 0.66, hz: 2.71, ty: 0.8, tx: 0.85, tz: -2.72, ay: 2.02, az: 1.6, h: 2.0 }),
  [Model.Bicycle]: meta({ hy: 0.95, hx: 0.01, hz: 0.45, ty: 0.7, tx: 0.01, tz: -0.62, h: 1.75 }),
  [Model.Ferry]: meta({ hy: 2.2, hx: 0.01, hz: 13.3, ty: 3, tx: 3.9, tz: -9, h: 8.6 }),
  [Model.MonorailHead]: meta({ hy: 0.1, hx: 0.9, hz: 5.35, ty: 0.35, tx: 1.1, tz: 5.2, h: 3.0 }),
  [Model.MonorailMid]: meta({ h: 3.0 }),
};

let cache: VehicleModel[] | null = null;

/** build (once) every vehicle model */
export function vehicleModels(): VehicleModel[] {
  if (cache) return cache;
  const out: VehicleModel[] = [];
  for (let m = 0; m < MODEL_COUNT; m++) {
    const b = BUILDERS[m]();
    const mt = META[m] ?? meta({ h: 2 });
    out.push({ geo: b.build(), far: farProxy(m as Model, mt.h).build(), meta: mt, tris: b.triangles });
  }
  cache = out;
  return out;
}

/** release the cached geometries (world unload keeps them; call on full dispose) */
export function disposeVehicleModels(): void {
  if (!cache) return;
  for (const m of cache) {
    m.geo.dispose();
    m.far.dispose();
  }
  cache = null;
}
