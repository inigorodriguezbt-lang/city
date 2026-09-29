// Residential generators: detached houses (low density), townhouses,
// walk-ups and perimeter blocks (medium density) and towers on podiums
// (high density). Deterministic from the building seed; front faces +Z.
import type { ThemeDef } from '../../../core/types';
import type { RNG } from '../../../core/rng';
import type { MatKey } from '../types';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { BLANK, type Fab, type P2, roundRect, ring, xformPoly } from './fab';
import { block, floorBands, plinth, piers } from './blocks';
import {
  GROUND, ROUND_ATTIC, antenna, awning, balconies, car, chimney, cornice, door, dormer, fence, flatRoof, gableRoof, greenRoof,
  hedge, helipad, hipRoof, lampPost, lotGround, pad, parking, pool, roofClutter, shrubs, sign, solarArray, tree, withFace,
  type TreeKind,
} from './parts';
import { type RoofShape, type StyleKit, aptWindows, houseWindows, lightTrim, pickRoof, pickWall, pitchedMat, roofColor, styleKit, towerWindows, trimColor, wallColor } from './style';
import { P, type Col, clamp, col, hueCol, jitter, mix, shade } from './util';

// ── shared helpers ─────────────────────────────────────────────────────────
export function lawnColor(theme: ThemeDef, rng: RNG): Col {
  const g = col(theme.grass), dry = col(theme.grassDry);
  return jitter(mix(g, dry, rng.next() * 0.35).multiplyScalar(1.12), rng, 0.04);
}

export function treeKindFor(theme: ThemeDef, rng: RNG): TreeKind {
  const sp = rng.pick(theme.trees);
  if (sp === 'palm') return 'palm';
  if (sp === 'pine' || sp === 'spruce') return 'cone';
  if (sp === 'cypress') return 'column';
  if (sp === 'cherry') return rng.chance(0.5) ? 'blossom' : 'round';
  return 'round';
}

/** Scatter garden trees inside a rectangle avoiding a keep-out box. */
export function gardenTrees(f: Fab, x0: number, z0: number, x1: number, z1: number, n: number, avoid?: [number, number, number, number]): void {
  const rng = f.rng;
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 6; t++) {
      const x = x0 + rng.next() * (x1 - x0), z = z0 + rng.next() * (z1 - z0);
      if (avoid && x > avoid[0] - 1.5 && x < avoid[2] + 1.5 && z > avoid[1] - 1.5 && z < avoid[3] + 1.5) continue;
      tree(f, x, z, rng.range(4.5, 8.5), treeKindFor(f.ctx.theme, rng));
      break;
    }
  }
}

function houseRoofShape(k: StyleKit, rng: RNG): RoofShape {
  if (k.id === 'asian') return rng.chance(0.65) ? 'pagoda' : 'hip';
  if (k.id === 'nordic') return rng.chance(0.8) ? 'gable' : 'shed';
  const s = pickRoof(k, rng, true);
  if (s === 'flat' && k.id !== 'mediterranean') return rng.chance(0.5) ? 'gable' : 'hip';
  return s === 'dome' ? 'hip' : s;
}

// ── low density: detached houses ─────────────────────────────────────────
export function resLow(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'grass', lawnColor(ctx.theme, rng));
  if (k.id === 'modern' || k.id === 'futuristic' || (k.id === 'mediterranean' && rng.chance(0.35)) || (k.id === 'artdeco' && rng.chance(0.45))) modernVilla(f, k);
  else classicHouse(f, k);
}

function classicHouse(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const front = rng.range(4.5, 7.5);
  const side = W <= 17 ? 1.7 : 2.6;
  const avail = W - 2 * side;
  const wantGarage = L >= 2 && avail >= 12 && rng.chance(0.7) && k.id !== 'mediterranean';
  const garageW = wantGarage ? (L >= 4 && avail >= 16 ? 6.4 : 3.8) : 0;
  const hw = clamp(rng.range(7.2, 9.5) + L * 1.2, 6.5, avail - garageW - (garageW ? 0.2 : 0));
  const hd = clamp(rng.range(7.5, 9.5) + L * 0.7, 6.5, D - front - 5);
  const garageLeft = rng.chance(0.5);
  const hx = garageW ? (garageLeft ? (garageW) / 2 : -(garageW) / 2) + (rng.next() - 0.5) * Math.max(0, avail - hw - garageW) * 0.5 : (rng.next() - 0.5) * Math.max(0, avail - hw);
  const hz = D / 2 - front - hd / 2;
  const floors = L === 1 ? (rng.chance(0.3) ? 2 : 1) : L === 2 ? (rng.chance(0.55) ? 2 : 1) : L === 5 ? (rng.chance(0.3) ? 3 : 2) : 2;
  const fh = k.fh * (L >= 4 ? 1.06 : 1);
  const mat = pickWall(k, 'house', rng);
  const wc = wallColor(k, mat, rng);
  const code = houseWindows(k, mat, rng);
  const shape = houseRoofShape(k, rng);
  const rmat: MatKey = shape === 'flat' ? 'roof_flat' : pitchedMat(k, rng);
  const rc = roofColor(k, rmat, rng);
  const trim = k.id === 'nordic' ? col('#f4f2ec') : trimColor(k, rng);
  const lt = lightTrim(k, rng);
  const steep = k.id === 'nordic' ? 0.62 : k.id === 'european' ? 0.5 : k.id === 'american' ? 0.4 : 0.3;
  const ridgeAlongX = rng.chance(k.id === 'nordic' || k.id === 'european' ? 0.75 : 0.6);
  const rise = (ridgeAlongX ? hd : hw) * 0.5 * steep * rng.range(0.9, 1.15);
  const eave = floors * fh;

  // base / foundation strip
  plinth(f, hx, hz, hw, hd, 0.45, shade(wc, k.id === 'nordic' ? 0.35 : 0.7), k.id === 'american' && mat === 'wall_wood' ? 'wall_brick' : 'wall_stone');
  const out = block(f, {
    cx: hx, cz: hz, w: hw, d: hd, floors, fh, mat, color: wc, code, roof: shape, roofMat: rmat, roofColor: rc, rise, ridgeAlongX,
    parapet: 0.6, trim, cornice: shape === 'flat' ? lt : null, overhang: k.id === 'asian' ? 1.1 : k.id === 'mediterranean' ? 0.35 : 0.5,
    dormerFlags: WF.Lites, attic: k.id === 'american' || k.id === 'european' || k.id === 'nordic' ? ROUND_ATTIC : 0,
    flatColor: '#a09a8e', lod: LodFacade.House,
  });
  let top = out.top;

  // side / rear wing (L-shape) on larger houses
  if (L >= 2 && rng.chance(0.55) && shape !== 'flat') {
    const ww = clamp(hw * rng.range(0.45, 0.6), 4, hw - 1);
    const wd = clamp(rng.range(4.5, 7), 3.5, D / 2 - (hz - hd / 2) - (-D / 2) - 3);
    if (wd > 3.4) {
      const wx = hx + (rng.chance(0.5) ? 1 : -1) * (hw - ww) / 2;
      const wz = hz - hd / 2 - wd / 2 + 0.05;
      const wf = floors > 1 && rng.chance(0.4) ? floors : 1;
      block(f, { cx: wx, cz: wz, w: ww, d: wd, floors: wf, fh, mat, color: wc, code, roof: shape === 'mansard' ? 'hip' : shape, roofMat: rmat, roofColor: rc, rise: ww * 0.5 * steep, ridgeAlongX: false, trim, overhang: 0.4, attic: 0, sides: { s: false }, lod: LodFacade.House });
    }
  }

  // garage with driveway
  const frontZ = hz + hd / 2;
  if (garageW) {
    const gx = hx + (garageLeft ? -1 : 1) * (hw / 2 + garageW / 2);
    const gd = Math.min(hd - 0.5, 6.5);
    const gz = frontZ - gd / 2 - (L >= 3 ? 0 : 0.8);
    block(f, { cx: gx, cz: gz, w: garageW, d: gd, floors: 1, fh: 2.9, mat, color: wc, code: BLANK, roof: shape === 'gable' || shape === 'hip' ? 'gable' : 'flat', roofMat: rmat, roofColor: rc, rise: gd * 0.5 * steep * 0.8, ridgeAlongX: true, trim, parapet: 0.4, flatColor: '#9a958a', attic: 0, lod: LodFacade.House, sides: { [garageLeft ? 'e' : 'w']: false } });
    withFace(f, 'S', gx, gz, garageW, gd, () => {
      const nD = garageW > 5 ? 2 : 1;
      for (let i = 0; i < nD; i++) {
        const x = -garageW / 2 + (i + 0.5) * (garageW / nD);
        f.m().box('wall_wood', x, GROUND, 0.03, garageW / nD - 0.7, 2.25, 0.06, rng.chance(0.6) ? P.trimWhite : shade(wc, 0.9), { sides: { n: false } });
      }
      f.light(0, 2.7, 0.3, 0xffd6a0, 1.3, 'lamp');
    });
    pad(f, 'concrete', gx, (gz + gd / 2 + D / 2) / 2, garageW - 0.4, D / 2 - (gz + gd / 2), '#b8b4aa');
    if (rng.chance(0.55)) car(f, gx + (garageW > 5 ? -1.4 : 0), D / 2 - (D / 2 - (gz + gd / 2)) / 2, 0);
  } else if (L >= 2 && avail - hw > 3) {
    const dx = hx + (hx > 0 ? -1 : 1) * (hw / 2 + 1.8);
    pad(f, 'paving', dx, (frontZ - 2 + D / 2) / 2, 2.8, D / 2 - frontZ + 2, P.pavingWarm);
    if (rng.chance(0.5)) car(f, dx, frontZ + 3, 0);
  }

  // porch / entrance
  const doorX = hx + (rng.next() - 0.5) * hw * 0.35;
  const porch = (k.id === 'american' || k.id === 'nordic' || k.id === 'european') && L >= 2 && rng.chance(k.id === 'american' ? 0.8 : 0.45);
  withFace(f, 'S', hx, hz, hw, hd, () => {
    door(f, doorX - hx, 0, 1.0, 2.15, rng.pick(['#5a3a28', '#23406e', '#7a1f1f', '#2d4a34', '#f2efe6', '#343a40']), trim, true, porch ? undefined : k.id === 'mediterranean' ? undefined : shade(trim, 0.95));
    if (porch) {
      const pw = Math.min(hw - 0.6, rng.range(4.5, hw));
      const px = rng.chance(0.5) ? 0 : (doorX - hx);
      const pdep = 2.2;
      const B = f.m();
      B.box('wood', px, 0, pdep / 2, pw, GROUND + 0.45, pdep, '#9c8a74', { top: 'wood', topColor: '#8a6a4c' });
      for (let i = 0; i <= Math.max(2, Math.round(pw / 2.2)); i++) {
        const cxp = px - pw / 2 + 0.15 + (i / Math.max(2, Math.round(pw / 2.2))) * (pw - 0.3);
        B.box('plain', cxp, GROUND + 0.45, pdep - 0.18, 0.2, 2.35, 0.2, trim);
      }
      if (f.detail !== 'low') B.box('plain', px, GROUND + 0.45 + 0.85, pdep - 0.12, pw, 0.08, 0.06, trim);
      // shed roof over the porch
      const pr = 0.7;
      B.quad(pitchedMat(k, rng), { x: px - pw / 2 - 0.2, y: GROUND + 2.85, z: pdep + 0.3 }, { x: px + pw / 2 + 0.2, y: GROUND + 2.85, z: pdep + 0.3 }, { x: px + pw / 2 + 0.2, y: GROUND + 2.85 + pr, z: 0 }, { x: px - pw / 2 - 0.2, y: GROUND + 2.85 + pr, z: 0 }, [[0, 0], [pw, 0], [pw, pdep], [0, pdep]], rc, { x: 0, y: 1, z: 0.3 });
      B.quad('plain', { x: px - pw / 2 - 0.2, y: GROUND + 2.83, z: pdep + 0.3 }, { x: px - pw / 2 - 0.2, y: GROUND + 2.83 + pr, z: 0 }, { x: px + pw / 2 + 0.2, y: GROUND + 2.83 + pr, z: 0 }, { x: px + pw / 2 + 0.2, y: GROUND + 2.83, z: pdep + 0.3 }, [[0, 0], [0, 1], [1, 1], [1, 0]], shade(trim, 0.75), { x: 0, y: -1, z: 0 });
      f.light(px, GROUND + 2.6, pdep * 0.6, 0xffc27a, 1.8, 'lamp');
    }
  });
  // front path
  pad(f, 'paving', doorX, (frontZ + D / 2) / 2 + 0.3, 1.3, D / 2 - frontZ - 0.6, '#c9c0ae');

  // dormers on pitched roofs of 1-2 storey houses
  if (shape === 'gable' && ridgeAlongX && rise > 2.4 && f.detail !== 'low' && (k.id === 'american' || k.id === 'european' || k.id === 'nordic') && rng.chance(L >= 3 ? 0.65 : 0.35)) {
    const n = hw > 10 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const x = hx + (n === 1 ? 0 : (i - 0.5) * hw * 0.45);
      dormer(f, x, eave + rise * 0.18, hz + hd * 0.2, 1, 1.5, 1.7, mat, wc, WF.Lites, rmat, rc, k.id === 'nordic' ? 'gable' : rng.chance(0.5) ? 'gable' : 'shed');
    }
  }
  // chimney
  if (shape !== 'flat' && rng.chance(k.id === 'mediterranean' || k.id === 'asian' ? 0.3 : 0.7)) {
    const cx = hx + (rng.chance(0.5) ? 1 : -1) * hw * rng.range(0.2, 0.38);
    chimney(f, cx, hz - hd * 0.15, eave - 1, rise + 1.9, k.id === 'american' || k.id === 'european' ? 'wall_brick' : 'plain', k.id === 'american' ? '#8c4533' : k.id === 'european' ? '#a9583f' : shade(wc, 0.9));
    top = Math.max(top, eave + rise + 1);
  }
  // mediterranean flat roof terrace details
  if (shape === 'flat' && k.id === 'mediterranean') {
    const B = f.m();
    B.box('wood', hx, eave + 0.02, hz, Math.min(4, hw * 0.5), 0.12, Math.min(3.5, hd * 0.5), '#9a7a5a');
    pergola(f, hx - hw * 0.2, eave, hz + hd * 0.15, Math.min(4.2, hw * 0.45), Math.min(3.2, hd * 0.4));
  }

  garden(f, k, hx, hz, hw, hd, garageW ? (garageLeft ? -1 : 1) : 0, garageW);
  f.top = Math.max(f.top, top);
}

/** Wooden pergola frame (roof terraces, gardens). */
function pergola(f: Fab, cx: number, y: number, cz: number, w: number, d: number): void {
  const B = f.m();
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('wood', cx + (dx * w) / 2, y, cz + (dz * d) / 2, 0.14, 2.4, 0.14, '#8a6a4a');
  const n = Math.max(3, Math.round(w / 0.6));
  for (let i = 0; i <= n; i++) B.box('wood', cx - w / 2 + (i / n) * w, y + 2.4, cz, 0.08, 0.14, d + 0.4, '#8a6a4a');
  B.box('wood', cx, y + 2.3, cz - d / 2, w + 0.3, 0.12, 0.12, '#7a5a3a');
  B.box('wood', cx, y + 2.3, cz + d / 2, w + 0.3, 0.12, 0.12, '#7a5a3a');
}

/** Garden dressing around a house footprint. */
function garden(f: Fab, k: StyleKit, hx: number, hz: number, hw: number, hd: number, garageSide: number, garageW: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const back0 = -D / 2 + 0.8, back1 = hz - hd / 2 - 0.6;
  // pool in the back yard (level 4+)
  if (L >= 4 && back1 - back0 > 8 && W > 14 && rng.chance(k.id === 'nordic' ? 0.25 : 0.7)) {
    const pw = Math.min(W - 5, rng.range(6, 10)), pdp = Math.min(back1 - back0 - 3, rng.range(3.5, 5));
    pool(f, (rng.next() - 0.5) * (W - pw - 4) * 0.6, (back0 + back1) / 2, pw, pdp);
  } else if (L >= 2 && back1 - back0 > 5 && rng.chance(0.5)) {
    pad(f, 'paving', hx, back1 - 1.6, Math.min(hw, 6), 3.2, P.pavingWarm);
  }
  // trees
  const nTrees = Math.round(((W * D) / 260) * rng.range(0.5, 1.2)) + (L >= 3 ? 1 : 0);
  gardenTrees(f, -W / 2 + 1.2, back0 + 0.5, W / 2 - 1.2, Math.max(back0 + 1, back1 - 1), Math.ceil(nTrees * 0.6));
  const fz0 = hz + hd / 2 + 1.5, fz1 = D / 2 - 1.2;
  if (fz1 - fz0 > 1.5) {
    const sideX = garageSide ? -garageSide * (W / 2 - 2) : (rng.chance(0.5) ? -1 : 1) * (W / 2 - 2);
    if (rng.chance(0.65)) tree(f, sideX, (fz0 + fz1) / 2, rng.range(5, 8), treeKindFor(ctx.theme, rng));
    if (f.detail !== 'low') shrubs(f, hx, hz + hd / 2 + 0.8, hw * 0.9, 1.0, Math.round(hw / 1.6));
  }
  // boundaries
  const fx = W / 2 - 0.3;
  const fence0 = D / 2 - 0.35;
  if (k.id === 'american' && rng.chance(0.55)) {
    const gapL = -1.2 + (garageW ? 0 : 0);
    fence(f, [[-fx, fence0], [gapL - 0.6 + hx * 0, fence0]], 'picket', P.trimWhite, 0.95);
    fence(f, [[hx + 1.2, fence0], [garageSide > 0 ? hx + hw / 2 : fx, fence0]], 'picket', P.trimWhite, 0.95);
  } else if (k.id === 'european' || k.id === 'nordic') {
    hedge(f, -fx, -D / 2 + 0.5, -fx, fence0, 1.2, 0.7);
    hedge(f, fx, -D / 2 + 0.5, fx, fence0, 1.2, 0.7);
    if (rng.chance(0.5)) hedge(f, -fx, fence0, -1.5, fence0, 0.9, 0.6);
  } else if (k.id === 'mediterranean' || k.id === 'artdeco') {
    fence(f, [[-fx, fence0], [-1.3, fence0]], 'wall', k.id === 'mediterranean' ? '#efe8da' : '#d9ccb0', 1.1);
    fence(f, [[1.3, fence0], [fx, fence0]], 'wall', k.id === 'mediterranean' ? '#efe8da' : '#d9ccb0', 1.1);
  } else if (k.id === 'asian') {
    fence(f, [[-fx, fence0], [fx * 0.3, fence0]], 'wall', '#cfc8b8', 1.6);
  }
  // back fence
  if (rng.chance(0.7)) fence(f, [[-fx, -D / 2 + 0.3], [fx, -D / 2 + 0.3]], k.id === 'american' ? 'rail' : k.id === 'nordic' ? 'picket' : 'wall', k.id === 'american' ? '#b8a07a' : k.id === 'nordic' ? '#f0ede6' : '#c9bfae', k.id === 'american' ? 1.4 : 1.2);
}

/** Flat-roofed modern / futuristic / streamline villa. */
function modernVilla(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const front = rng.range(4.5, 7);
  const side = W <= 17 ? 1.6 : 2.4;
  const avail = W - 2 * side;
  const hw = clamp(rng.range(8, 10) + L * 1.4, 7, avail);
  const hd = clamp(rng.range(8, 10) + L * 0.8, 7, D - front - 5);
  const hx = (rng.next() - 0.5) * (avail - hw) * 0.6;
  const hz = D / 2 - front - hd / 2;
  const fh = k.fh;
  const floors = L <= 2 ? (rng.chance(0.4) ? 2 : 1) : L >= 5 && rng.chance(0.4) ? 3 : 2;
  const mat = pickWall(k, 'house', rng);
  const wc = wallColor(k, mat, rng);
  const code = houseWindows(k, mat, rng);
  const accentMat: MatKey = k.id === 'futuristic' ? 'wall_glass' : rng.chance(0.6) ? 'wall_wood' : 'wall_concrete';
  const accent = wallColor(k, accentMat, rng);
  const accCode = accentMat === 'wall_glass' ? towerWindows(k, accentMat, rng) : facCode(WinKind.French, 2.5, 2.3, WF.DarkFrame | (accentMat === 'wall_wood' ? WF.AltBase : 0));
  const roofC = '#8f8b82';
  if (k.id === 'artdeco') {
    // streamline moderne: rounded corner, horizontal bands, porthole
    const pts = roundRect(hx, hz, hw, hd, Math.min(3, hw * 0.3), 4);
    f.fprism(mat, facCode(WinKind.Ribbon, 2.9, 1.3, WF.DarkFrame), pts, -1.5, floors * fh + 1.5, wc, { fh, continuous: true, top: 'roof_flat', topColor: roofC, lod: LodFacade.House });
    for (let i = 1; i <= floors; i++) f.m().cap('plain', roundRect(hx, hz, hw + 0.5, hd + 0.5, Math.min(3.2, hw * 0.32), 4), i * fh - 0.02, lightTrim(k, rng));
    for (let i = 1; i <= floors; i++) f.m().prismWalls('plain', roundRect(hx, hz, hw + 0.5, hd + 0.5, Math.min(3.2, hw * 0.32), 4), i * fh - 0.28, i * fh - 0.02, lightTrim(k, rng));
    flatRoof(f, hx, hz, hw, hd, floors * fh, 0.01, mat, wc, roofC);
  } else if (k.id === 'futuristic') {
    const pts = roundRect(hx, hz, hw, hd, Math.min(hw, hd) * 0.42, 5);
    f.fprism(mat, facCode(WinKind.Ribbon, 3.0, 1.9, WF.DarkFrame), pts, -1.5, fh + 1.5, wc, { fh, continuous: true, top: 'roof_flat', topColor: roofC, lod: LodFacade.House });
    if (floors >= 2) {
      const up = xformPoly(roundRect(hx, hz, hw * 0.92, hd * 0.8, Math.min(hw, hd) * 0.38, 5), hx, hz, rng.range(-0.25, 0.25), 1);
      const sh = xformPoly(up, hx, hz, 0, 1).map(([x, z]) => [x + hw * 0.12, z + hd * 0.12] as P2);
      f.fprism('wall_glass', towerWindows(k, 'wall_glass', rng), sh, fh, (floors - 1) * fh, wallColor(k, 'wall_glass', rng), { fh, base: 0, continuous: true, top: 'roof_flat', topColor: '#d8dde0' });
      f.m().cap('plain', sh, fh - 0.01, '#e8eef2', true);
      f.m().prismWalls('neon', xformPoly(sh, hx + hw * 0.12, hz + hd * 0.12, 0, 1.015), floors * fh - 0.2, floors * fh + 0.05, hueCol(rng.pick([0.52, 0.85, 0.2])));
      solarArray(f, hx + hw * 0.12, floors * fh, hz + hd * 0.12, hw * 0.5, hd * 0.4);
    }
    greenRoof(f, hx - hw * 0.2, fh, hz - hd * 0.2, hw * 0.35, hd * 0.35, 1);
  } else {
    // modern / mediterranean: two offset boxes, cantilevered upper volume
    plinth(f, hx, hz, hw, hd, 0.3, shade(wc, 0.6), 'wall_concrete');
    f.fbox(mat, code, hx, -1.5, hz, hw, hd, fh + 1.5, wc, { fh, top: 'roof_flat', topColor: roofC, lod: LodFacade.House });
    if (floors >= 2) {
      const uw = hw * rng.range(0.65, 0.9), ud = hd * rng.range(0.75, 0.95);
      const ux = hx + (rng.chance(0.5) ? 1 : -1) * rng.range(0.8, 2.2);
      const uz = hz + rng.range(0.4, 2.0);
      const um = k.id === 'mediterranean' ? mat : accentMat;
      const uc = k.id === 'mediterranean' ? wc : accent;
      f.fbox(um, k.id === 'mediterranean' ? code : accCode, ux, fh, uz, uw, ud, (floors - 1) * fh, uc, { fh, base: 0, top: 'roof_flat', topColor: roofC });
      f.m().box('plain', ux, fh - 0.25, uz, uw + 0.1, 0.25, ud + 0.1, shade(uc, 0.8), { top: false, bottom: true });
      flatRoof(f, ux, uz, uw, ud, floors * fh, 0.45, um, uc, roofC);
      if (k.id === 'modern' && rng.chance(0.5)) greenRoof(f, ux, floors * fh, uz, uw - 0.8, ud - 0.8, 0);
      else if (rng.chance(0.5)) solarArray(f, ux, floors * fh, uz, uw * 0.6, ud * 0.5);
      // terrace railing on the lower roof
      f.m().box('glass', hx, fh, hz + hd / 2 - 0.05, hw, 1.05, 0.05, '#9fb8c0');
    } else {
      flatRoof(f, hx, hz, hw, hd, fh, 0.5, mat, wc, roofC);
    }
    if (k.id === 'mediterranean') pergola(f, hx + hw * 0.25, fh, hz + hd * 0.2, Math.min(4, hw * 0.4), Math.min(3.5, hd * 0.35));
  }
  withFace(f, 'S', hx, hz, hw, hd, () => {
    door(f, (rng.next() - 0.5) * hw * 0.4, 0, 1.2, 2.3, rng.pick(['#3a3632', '#1f2226', '#8a6a4a']), '#2a2c30', true);
  });
  // carport / driveway
  const dx = hx + (hx > 0 ? -1 : 1) * (hw / 2 + 1.9);
  if (Math.abs(dx) < W / 2 - 1.5) {
    pad(f, 'concrete', dx, (hz + D / 2) / 2, 3.2, D / 2 - hz, '#c2beb4');
    if (rng.chance(0.6)) car(f, dx, hz + hd / 2 + 1, 0);
  }
  pad(f, 'paving', hx, (hz + hd / 2 + D / 2) / 2, 1.6, D / 2 - hz - hd / 2 - 0.4, '#d0cabf');
  garden(f, k, hx, hz, hw, hd, 0, 0);
}

// ── medium density ─────────────────────────────────────────────────────────
export function resMed(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const L = ctx.level;
  const W = ctx.width;
  // townhouses at low levels, apartments above; wide lots at level 5 → perimeter block
  if ((L <= 2 || (L === 3 && rng.chance(0.4))) && k.id !== 'futuristic' && k.id !== 'modern') townhouses(f, k);
  else if (L >= 4 && W >= 48 && ctx.depth >= 48) perimeterBlock(f, k, L >= 5 ? rng.int(6, 7) : rng.int(5, 6));
  else walkUp(f, k, clamp(2 + L + rng.int(0, 1), 3, 7));
}

/** Row of narrow townhouses across the frontage, each with its own colour and roof. */
function townhouses(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'grass', lawnColor(ctx.theme, rng));
  const n = Math.max(2, Math.round(W / rng.range(5.8, 7.8)));
  const uw = (W - 0.6) / n;
  const front = k.id === 'american' ? rng.range(3, 4.5) : k.id === 'nordic' ? rng.range(0.6, 1.5) : rng.range(1.2, 3.5);
  const hd = clamp(rng.range(10, 13), 8, D - front - 5);
  const hz = D / 2 - front - hd / 2;
  const baseFloors = L === 1 ? rng.int(2, 3) : rng.int(3, 4);
  const mat = pickWall(k, 'apt', rng);
  const sharedRoof = rng.chance(0.35);
  const frontGable = (k.id === 'nordic' || k.id === 'european') && !sharedRoof && rng.chance(0.6);
  const rmat = pitchedMat(k, rng);
  const shape: RoofShape = k.id === 'asian' ? 'pagoda' : k.id === 'mediterranean' || k.id === 'artdeco' ? 'flat' : sharedRoof ? 'gable' : frontGable ? 'gable' : rng.chance(0.4) ? 'mansard' : 'flat';
  const rcShared = roofColor(k, rmat, rng);
  const lt = lightTrim(k, rng);
  const stoop = k.id === 'american' && mat === 'wall_brick';
  for (let i = 0; i < n; i++) {
    const cx = -W / 2 + 0.3 + (i + 0.5) * uw;
    const floors = sharedRoof ? baseFloors : clamp(baseFloors + (rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0), 2, 5);
    const m: MatKey = rng.chance(0.8) ? mat : pickWall(k, 'apt', rng);
    const wc = wallColor(k, m, rng);
    const code = aptWindows(k, m, rng);
    const fh = k.fh;
    const gz = hz + (sharedRoof ? 0 : (rng.next() - 0.5) * 0.4);
    plinth(f, cx, gz, uw, hd, stoop ? 1.2 : 0.5, shade(wc, 0.62), m === 'wall_wood' ? 'wall_concrete' : 'wall_stone');
    const rc = sharedRoof ? rcShared : roofColor(k, rmat, rng);
    const out = block(f, {
      cx, cz: gz, w: uw, d: hd, floors, fh, mat: m, color: wc, code, roof: shape === 'gable' && frontGable ? 'gable' : shape, ridgeAlongX: !frontGable, roofMat: shape === 'flat' ? 'roof_flat' : rmat, roofColor: rc,
      rise: frontGable ? uw * 0.62 : hd * 0.32, cornice: shape === 'flat' || shape === 'mansard' ? lt : null, richCornice: k.ornate > 0.5 && shape === 'flat', parapet: 0.5, trim: lt,
      dormerFlags: WF.Lites, overhang: frontGable ? 0.25 : 0.35, sides: { e: i === n - 1, w: i === 0 }, attic: frontGable ? ROUND_ATTIC : 0, flatColor: '#8e8a82', lod: LodFacade.Punched,
    });
    // entrance
    withFace(f, 'S', cx, gz, uw, hd, () => {
      const dx = (i % 2 ? 1 : -1) * uw * 0.25;
      if (stoop) {
        const B = f.m();
        for (let s = 0; s < 5; s++) B.box('concrete', dx, 0, 0.35 + (4 - s) * 0.32, 1.6, GROUND + 0.25 * (s + 1), 0.34, '#b7ada0');
        door(f, dx, 0, 1.1, 2.4, rng.pick(['#3a2418', '#1f2a1f', '#2a1f1a']), lt, true);
        f.m().box('plain', dx, GROUND + 1.25 + 2.4, 0.3, 1.6, 0.25, 0.6, lt, { bottom: true });
      } else {
        door(f, dx, 0, 1.0, 2.25, rng.pick(['#5a3a28', '#23406e', '#7a1f1f', '#2d4a34', '#1d1f22']), lt, true, k.id === 'european' ? undefined : shade(lt, 0.9));
      }
      // bay window on the other half (american / european)
      if ((k.id === 'american' || k.id === 'european') && uw > 5.5 && rng.chance(0.5) && f.detail !== 'low') {
        const bx = -dx;
        const bw = Math.min(2.6, uw * 0.42);
        f.fbox(m, facCode(WinKind.Single, 1.0, 1.7, WF.Lites), bx, stoop ? 1.3 : 0.4, 0.5, bw, 1.0, Math.min(out.eave - 1, 2 * fh) - (stoop ? 1.3 : 0.4), wc, { fh, base: 0, bay: bw / 2, top: 'roof_metal', topColor: shade(wc, 0.7), noMass: true, sides: { n: false } });
      }
    });
    pad(f, 'paving', cx + (i % 2 ? 1 : -1) * uw * 0.25, (hz + hd / 2 + D / 2) / 2, 1.4, D / 2 - hz - hd / 2, '#bdb5a6');
    if (front > 2 && f.detail !== 'low') {
      hedge(f, cx - uw / 2 + 0.3, D / 2 - 0.4, cx + (i % 2 ? uw * 0.25 - 0.9 : -uw * 0.25 - 0.9), D / 2 - 0.4, 0.8, 0.5);
    }
    if (rng.chance(0.25) && L >= 2) chimney(f, cx + uw * 0.3, gz - hd * 0.2, out.eave - 0.5, 2.6 + (shape === 'flat' ? 0 : hd * 0.3), 'wall_brick', '#8c4533', 0.8);
  }
  // back gardens
  gardenTrees(f, -W / 2 + 1, -D / 2 + 1, W / 2 - 1, hz - hd / 2 - 1.5, Math.round(n * 0.7));
  fence(f, [[-W / 2 + 0.3, -D / 2 + 0.3], [W / 2 - 0.3, -D / 2 + 0.3]], 'wall', '#b8ad9c', 1.6);
}

/** Walk-up / mid-rise apartment block along the street. */
function walkUp(f: Fab, k: StyleKit, floors: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const asphaltYard = rng.chance(0.4);
  lotGround(f, W, D, asphaltYard ? 'paving' : 'grass', asphaltYard ? col(P.paving) : lawnColor(ctx.theme, rng));
  const front = k.id === 'modern' || k.id === 'futuristic' ? rng.range(3, 5) : rng.range(0.8, 2.5);
  const bw = W - (W > 20 ? rng.range(1.5, 4) : 1.2);
  const bd = clamp(rng.range(12, 15), 9, D - front - 4);
  const bz = D / 2 - front - bd / 2;
  const mat = pickWall(k, 'apt', rng);
  const wc = wallColor(k, mat, rng);
  const fh = k.fh;
  const balc = k.id !== 'artdeco' && rng.chance(k.id === 'mediterranean' || k.id === 'modern' || k.id === 'futuristic' || k.id === 'asian' ? 0.85 : 0.45);
  const code = aptWindows(k, mat, rng, false);
  const codeB = aptWindows(k, mat, rng, balc);
  const lt = lightTrim(k, rng);
  let shape = pickRoof(k, rng, true);
  if (shape === 'dome' || (shape === 'pagoda' && floors > 4)) shape = 'flat';
  if (shape === 'shed' && k.id !== 'modern' && k.id !== 'nordic') shape = 'flat';
  const rmat = shape === 'flat' ? 'roof_flat' : pitchedMat(k, rng);
  const rc = roofColor(k, rmat, rng);
  const shopGround = L >= 4 && rng.chance(0.25);
  plinth(f, 0, bz, bw, bd, 0.8, shade(wc, 0.65), mat === 'wall_wood' ? 'wall_concrete' : 'wall_stone');
  const out = block(f, {
    cx: 0, cz: bz, w: bw, d: bd, floors, fh, mat, color: wc, code: balc ? codeB : code, roof: shape, roofMat: rmat, roofColor: rc, rise: bd * 0.28,
    ground: shopGround ? { mat: 'wall_shop', color: shade(wc, 0.95), code: 0, h: 4.2 } : undefined,
    cornice: k.ornate >= 0.5 ? lt : k.id === 'modern' ? null : shade(wc, 0.85), richCornice: k.ornate >= 0.8, band: shopGround ? lt : k.ornate > 0.4 ? lt : null,
    parapet: 0.9, trim: lt, dormerFlags: WF.Lites | WF.Surround, overhang: 0.5, attic: 0, flatColor: '#86837c', ridgeAlongX: true,
  });
  // balconies (front + back)
  if (balc) {
    const floorsY: number[] = [];
    for (let i = 1; i < floors; i++) floorsY.push((shopGround ? 4.2 + (i - 1) * fh : i * fh) + 0.02);
    const rail = k.id === 'modern' || k.id === 'futuristic' ? 'glass' : k.id === 'european' || k.id === 'mediterranean' ? 'iron' : k.id === 'asian' ? 'solid' : 'metal';
    const cont = k.id === 'modern' || k.id === 'futuristic' || (k.id === 'asian' && rng.chance(0.5));
    for (const face of ['S', 'N'] as const)
      withFace(f, face, 0, bz, bw, bd, (len) => balconies(f, len, floorsY, { bay: 3.2 * (bw / (Math.max(1, Math.round(bw / 3.2)) * 3.2)), depth: cont ? 1.6 : 1.1, rail, slab: '#c8c4bc', railColor: rail === 'glass' ? '#a8c4cc' : rail === 'solid' ? shade(wc, 0.92) : '#2a2c30', continuous: cont, every: cont ? 1 : k.id === 'european' ? 1 : 2, offset: 0 }));
  }
  // art deco vertical piers
  if (k.id === 'artdeco') withFace(f, 'S', 0, bz, bw, bd, (len) => piers(f, -len / 2, len / 2, 0, 0.8, out.eave + 0.6, Math.max(2, Math.round(len / 3.2)), 0.35, lt));
  // fire escapes on american brick walk-ups
  if (k.id === 'american' && mat === 'wall_brick' && f.detail === 'high' && rng.chance(0.6)) {
    withFace(f, 'S', 0, bz, bw, bd, (len) => {
      const x = (rng.chance(0.5) ? -1 : 1) * len * 0.22;
      const ys: number[] = [];
      for (let i = 1; i < floors; i++) ys.push(i * fh + 0.02);
      const B = f.m();
      for (const y of ys) {
        B.box('metal', x, y - 0.08, 0.6, 3.6, 0.08, 1.2, '#26282b', { bottom: true });
        B.box('metal', x, y + 0.95, 1.18, 3.6, 0.05, 0.05, '#26282b');
        B.box('metal', x, y, 1.18, 3.6, 0.95, 0.02, '#26282b', { top: false });
      }
      B.box('metal', x + 1.4, fh, 0.9, 0.5, (floors - 1) * fh, 0.05, '#26282b', { top: false });
    });
  }
  // asian: AC units + blade signs at street level
  if (k.id === 'asian') asianDressing(f, bw, bz, bd, floors, fh);
  // entrance
  withFace(f, 'S', 0, bz, bw, bd, () => door(f, 0, 0, 1.6, 2.6, rng.pick(['#3a2a20', '#2a2c30', '#4a3a2a']), lt, true, shade(lt, 0.9)));
  pad(f, 'paving', 0, (bz + bd / 2 + D / 2) / 2, 2.2, D / 2 - bz - bd / 2, '#bdb5a6');
  // back yard: parking or garden
  const by1 = bz - bd / 2 - 1.5;
  if (by1 + D / 2 > 9 && rng.chance(0.55)) parking(f, 0, (-D / 2 + by1) / 2, W - 2, by1 + D / 2 - 1, true, 0.6, true);
  else gardenTrees(f, -W / 2 + 1, -D / 2 + 1, W / 2 - 1, by1, Math.round(W / 9));
  if (shape === 'flat') roofClutter(f, 0, bz, bw, bd, out.eave, { tank: k.id === 'american' && rng.chance(0.5), hvac: rng.int(0, 2), bulkhead: { mat, color: wc }, antenna: rng.chance(0.3) ? 4 : 0, beacon: false, solar: k.id === 'modern' && rng.chance(0.5) });
  if (front > 2.5) gardenTrees(f, -W / 2 + 1.2, bz + bd / 2 + 1.2, W / 2 - 1.2, D / 2 - 1, rng.int(0, 2), [-2, bz, 2, D / 2]);
}

/** U-shaped perimeter block with a green courtyard (large lots). */
function perimeterBlock(f: Fab, k: StyleKit, floors: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, 'grass', lawnColor(ctx.theme, rng));
  const mat = pickWall(k, 'apt', rng);
  const fh = k.fh;
  const depthB = rng.range(12, 14);
  const lt = lightTrim(k, rng);
  let shape = pickRoof(k, rng, true);
  if (shape === 'dome' || shape === 'pagoda' || shape === 'shed') shape = 'flat';
  const rmat = shape === 'flat' ? 'roof_flat' : pitchedMat(k, rng);
  const rc = roofColor(k, rmat, rng);
  const m = 0.8;
  const parts: [number, number, number, number, { n?: boolean; e?: boolean; s?: boolean; w?: boolean }][] = [
    [0, D / 2 - m - depthB / 2, W - 2 * m, depthB, {}],
    [-W / 2 + m + depthB / 2, -m * 0.5 - depthB * 0.25, depthB, D - 2 * m - depthB * 1.5, { s: false }],
    [W / 2 - m - depthB / 2, -m * 0.5 - depthB * 0.25, depthB, D - 2 * m - depthB * 1.5, { s: false }],
  ];
  const balc = k.id !== 'artdeco' && k.id !== 'american' && rng.chance(0.6);
  parts.forEach(([cx, cz, w, d, sides], i) => {
    const wc = i === 0 || rng.chance(0.5) ? wallColor(k, mat, rng) : wallColor(k, mat, rng);
    const out = block(f, {
      cx, cz, w, d, floors: floors - (i > 0 && rng.chance(0.3) ? 1 : 0), fh, mat, color: wc, code: aptWindows(k, mat, rng, balc), roof: shape, roofMat: rmat, roofColor: rc, rise: Math.min(w, d) * 0.28,
      cornice: lt, richCornice: k.ornate >= 0.8, parapet: 0.9, trim: lt, dormerFlags: WF.Lites, sides, attic: 0, flatColor: '#86837c', ridgeAlongX: w >= d,
      ground: i === 0 && ctx.level >= 5 && rng.chance(0.5) ? { mat: 'wall_shop', color: shade(wc, 0.95), code: 0, h: 4.4 } : undefined, band: lt,
    });
    if (balc) {
      const ys: number[] = [];
      for (let j = 1; j < floors - 1; j++) ys.push(j * fh + 0.02);
      const faces: ('S' | 'N' | 'E' | 'W')[] = i === 0 ? ['N'] : i === 1 ? ['E'] : ['W'];
      for (const face of faces) withFace(f, face, cx, cz, w, d, (len) => balconies(f, len - 2, ys, { bay: 3.3, depth: 1.3, rail: k.id === 'modern' || k.id === 'futuristic' ? 'glass' : 'iron', slab: '#c8c4bc', railColor: '#2a2c30', every: 1 }));
    }
    if (shape === 'flat') roofClutter(f, cx, cz, w, d, out.eave, { hvac: 1, bulkhead: { mat, color: wc } });
    if (i === 0) withFace(f, 'S', cx, cz, w, d, (len) => {
      door(f, -len * 0.25, 0, 1.6, 2.7, '#2f2a26', lt, true, shade(lt, 0.9));
      door(f, len * 0.25, 0, 1.6, 2.7, '#2f2a26', lt, true, shade(lt, 0.9));
    });
  });
  // courtyard: trees, paths, playground
  const cz0 = -D / 2 + 2, cz1 = D / 2 - m - depthB - 1.5;
  const cxw = W - 2 * (m + depthB) - 3;
  pad(f, 'paving', 0, (cz0 + cz1) / 2, 2, cz1 - cz0, '#cfc6b4');
  gardenTrees(f, -cxw / 2, cz0, cxw / 2, cz1, Math.round((cxw * (cz1 - cz0)) / 120));
  if (f.detail !== 'low') shrubs(f, 0, (cz0 + cz1) / 2, cxw, cz1 - cz0, Math.round(cxw / 2));
  fence(f, [[-W / 2 + m + depthB, -D / 2 + 0.4], [W / 2 - m - depthB, -D / 2 + 0.4]], 'iron', '#26282b', 1.5);
}

/** East-Asian street dressing: AC units, laundry poles, blade signs. */
function asianDressing(f: Fab, bw: number, bz: number, bd: number, floors: number, fh: number): void {
  const rng = f.rng;
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    const B = f.m();
    if (f.detail !== 'low') {
      const n = Math.round(len / 3.2);
      for (let fl = 1; fl < floors; fl++)
        for (let i = 0; i < n; i++) {
          if (!rng.chance(0.45)) continue;
          const x = -len / 2 + (i + 0.5) * (len / n) + (rng.chance(0.5) ? 1.15 : -1.15);
          B.box('metal', x, fl * fh + 0.3, 0.3, 0.8, 0.55, 0.55, '#d8d8d4');
        }
    }
    for (let i = 0; i < Math.min(3, Math.floor(len / 6)); i++) {
      const x = -len / 2 + 2 + i * (len - 4) / Math.max(1, Math.min(3, Math.floor(len / 6)) - 1 || 1);
      sign(f, x, fh * 0.9, 0, 0.9, Math.min(fh * 2.2, (floors - 1) * fh * 0.6), hueCol(rng.pick([0.0, 0.08, 0.55, 0.9, 0.15])), 'blade');
    }
  });
}

// ── high density ───────────────────────────────────────────────────────────
export function resHigh(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const floorsBy = [0, rng.int(8, 12), rng.int(12, 18), rng.int(16, 25), rng.int(22, 34), rng.int(30, 45)];
  const floors = floorsBy[L] ?? 10;
  const fh = k.fh;
  const plaza = rng.chance(0.5);
  lotGround(f, W, D, plaza ? 'paving' : 'grass', plaza ? col(P.pavingWarm) : lawnColor(ctx.theme, rng));
  // podium
  const podFloors = L >= 2 ? rng.int(1, 3) : 1;
  const podH = 4.6 + (podFloors - 1) * fh;
  const pw = W - 3, pd = D - rng.range(5, 8);
  const pz = D / 2 - 1.5 - pd / 2;
  const podMat = pickWall(k, 'apt', rng);
  const podC = wallColor(k, podMat, rng);
  const lt = lightTrim(k, rng);
  block(f, { cx: 0, cz: pz, w: pw, d: pd, floors: podFloors, fh, mat: podMat, color: podC, code: aptWindows(k, podMat, rng), roof: 'flat', parapet: 1.0, ground: { mat: 'wall_shop', color: shade(podC, 0.95), code: 0, h: 4.6 }, cornice: lt, flatColor: '#7d7a74' });
  // tower
  const mat = pickWall(k, 'tower', rng);
  const wc = wallColor(k, mat, rng);
  const tw = clamp(pw * rng.range(0.55, 0.75), 14, 34), td = clamp(pd * rng.range(0.5, 0.7), 12, 26);
  const tx = (rng.next() - 0.5) * (pw - tw) * 0.6, tz = pz + (rng.next() - 0.5) * (pd - td) * 0.5;
  const code = mat === 'wall_glass' ? towerWindows(k, mat, rng) : aptWindows(k, mat, rng, true);
  const y0 = podH;
  const H = floors * fh;
  if (k.id === 'futuristic') {
    // twisting rounded tower with sky gardens
    const segs = Math.max(4, Math.round(floors / 4));
    const base = roundRect(tx, tz, tw, td, Math.min(tw, td) * 0.35, 3);
    const twist = rng.range(0.5, 1.1) * (rng.chance(0.5) ? 1 : -1);
    let prev = base;
    for (let s = 0; s < segs; s++) {
      const t1 = (s + 1) / segs;
      const next = xformPoly(base, tx, tz, twist * t1, 1 - 0.18 * t1);
      f.loft('wall_glass', towerWindows(k, 'wall_glass', rng), prev, y0 + (s / segs) * H, next, y0 + t1 * H, wc, { fh, base: y0, vBase: 3.3 });
      if (s % 3 === 2 && s < segs - 1) {
        f.m().cap('plain', xformPoly(next, tx, tz, 0, 1.06), y0 + t1 * H, '#e8eef2');
        f.m().prismWalls('neon', xformPoly(next, tx, tz, 0, 1.06), y0 + t1 * H - 0.15, y0 + t1 * H, hueCol(rng.pick([0.52, 0.85])));
        f.pushTRS(0, y0 + t1 * H - GROUND, 0);
        tree(f, tx + tw * 0.25, tz, 3, 'round');
        f.pop();
      }
      prev = next;
    }
    f.m().cap('roof_flat', prev, y0 + H, '#50585e');
    f.mass(tx, tz, tw * 0.9, td * 0.9, y0, H, wc, '#50585e', LodFacade.Glass);
    antenna(f, tx, y0 + H, tz, rng.range(8, 16), true);
    f.top = Math.max(f.top, y0 + H + 16);
  } else {
    // setbacks for tall towers
    const tiers = floors > 24 && (k.id === 'artdeco' || rng.chance(0.4)) ? 3 : floors > 14 && rng.chance(0.4) ? 2 : 1;
    let cy = y0, cw = tw, cd = td, left = floors;
    let top = y0;
    for (let t = 0; t < tiers; t++) {
      const fl = t === tiers - 1 ? left : Math.round(floors * (t === 0 ? 0.6 : 0.25));
      left -= fl;
      const isTop = t === tiers - 1;
      f.fbox(mat, code, tx, cy, tz, cw, cd, fl * fh, wc, { fh, base: y0, vBase: 3.3, top: 'roof_flat', topColor: '#7d7a74' });
      // balcony bands
      if (mat !== 'wall_glass' || k.id === 'modern') {
        const ys: number[] = [];
        for (let i = 1; i <= fl; i++) ys.push(cy + i * fh - fh + 0.02);
        const rail = k.id === 'modern' || mat === 'wall_glass' ? 'glass' : k.id === 'american' || k.id === 'artdeco' ? 'solid' : k.id === 'asian' ? 'solid' : 'metal';
        const cont = k.id !== 'european' || rng.chance(0.4);
        const faces: ('S' | 'N' | 'E' | 'W')[] = cw > cd ? ['S', 'N'] : ['E', 'W'];
        if (k.id !== 'artdeco') for (const face of faces) withFace(f, face, tx, tz, cw, cd, (len) => balconies(f, len - 1, ys.slice(1), { bay: 3.4, depth: 1.4, rail, slab: '#cfccc4', railColor: rail === 'glass' ? '#9fbcc6' : shade(wc, 0.95), continuous: cont, every: 1 }));
      } else {
        floorBands(f, tx, tz, cw, cd, cy, fl, fh, 0.12, 0.08, '#6a7078', 1);
      }
      if (k.id === 'artdeco') withFace(f, 'S', tx, tz, cw, cd, (len) => piers(f, -len / 2, len / 2, 0, cy, cy + fl * fh + 0.8, Math.max(3, Math.round(len / 3.2)), 0.45, lt));
      cy += fl * fh;
      top = cy;
      if (!isTop) {
        cornice(f, tx, tz, cw, cd, cy - 0.25, 0.35, 0.2, lt);
        cw *= rng.range(0.72, 0.85);
        cd *= rng.range(0.72, 0.85);
      }
    }
    flatRoof(f, tx, tz, cw, cd, top, 1.1, mat, wc, '#6f6c66', lt);
    // crown / rooftop
    if (k.id === 'artdeco') {
      artDecoCrown(f, tx, tz, cw, cd, top, lt, rng);
    } else if (k.id === 'asian' && rng.chance(0.5)) {
      sign(f, tx, top + 1.1, tz + cd / 2 - 0.3, cw * 0.6, 2.2, hueCol(rng.pick([0.0, 0.55, 0.9])), 'neon');
      roofClutter(f, tx, tz, cw, cd, top, { hvac: 2, antenna: 10, beacon: true });
    } else if (k.id === 'modern' && rng.chance(0.5)) {
      greenRoof(f, tx, top, tz, cw - 1.5, cd - 1.5, 3);
    } else {
      roofClutter(f, tx, tz, cw, cd, top, { tank: k.id === 'american' && rng.chance(0.5), hvac: rng.int(1, 3), bulkhead: { mat, color: wc }, antenna: rng.chance(0.5) ? rng.range(6, 14) : 0, beacon: true });
    }
    if (floors >= 20 && !(k.id === 'artdeco')) f.light(tx + cw / 2 - 0.5, top + 1.3, tz + cd / 2 - 0.5, 0xff2a1a, 2.2, 'beacon', true);
  }
  // podium roof garden or pool (residents' amenity)
  if (L >= 3 && rng.chance(0.5)) {
    const gx = tx > 0 ? -pw / 4 : pw / 4;
    const gw = Math.min(pw / 2 - tw / 2 - 1, 12);
    if (gw > 5) {
      if (rng.chance(0.5)) {
        f.pushTRS(0, podH - GROUND, 0);
        pool(f, gx, pz, gw - 2, Math.min(pd - 6, 5));
        f.pop();
      } else greenRoof(f, gx, podH, pz, gw, pd * 0.6, 2);
    }
  }
  withFace(f, 'S', 0, pz, pw, pd, (len) => {
    f.m().box('glass', 0, GROUND, 0.02, Math.min(8, len * 0.3), 4.2, 0.06, '#8fb0bc', { sides: { n: false } });
    f.m().box('plain', 0, 4.4, 1.6, Math.min(10, len * 0.36), 0.3, 3.2, lt, { bottom: true });
    f.light(0, 4.2, 2.6, 0xffe0b0, 3, 'lamp');
    if (L >= 2) awning(f, -len / 2 + 1, -Math.min(5, len * 0.18) - 1, 0, 4.0, 1.6, hueCol(rng.next(), 0.5, 0.35), rng.chance(0.5));
  });
  // street trees + plaza
  const nT = Math.floor(W / 9);
  for (let i = 0; i < nT; i++) tree(f, -W / 2 + (i + 0.5) * (W / nT), D / 2 - 1.1, rng.range(6, 8.5), treeKindFor(ctx.theme, rng));
  if (D / 2 - pz - pd / 2 > 4) lampPost(f, W / 2 - 2, D / 2 - 1.5, 5.5);
  const back = pz - pd / 2;
  if (back + D / 2 > 3) gardenTrees(f, -W / 2 + 1, -D / 2 + 1, W / 2 - 1, back - 0.5, Math.round(W / 10));
}

/** Art deco stepped crown with gilded fins and a spire. */
export function artDecoCrown(f: Fab, cx: number, cz: number, w: number, d: number, y: number, trim: Col, rng: RNG): void {
  const gold = col(P.gold);
  let cw = w * 0.8, cd = d * 0.8, cy = y + 1.1;
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const h = 2.8 - i * 0.5;
    f.fbox('wall_stone', facCode(WinKind.Strip, 0.6, 1.8, WF.DarkFrame), cx, cy, cz, cw, cd, h, trim, { top: 'roof_metal', topColor: '#5a5448', noMass: false });
    cornice(f, cx, cz, cw, cd, cy + h - 0.2, 0.2, 0.15, gold);
    cy += h;
    cw *= 0.7;
    cd *= 0.7;
  }
  // gilded fins on the top step
  const B = f.m();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) B.box('metal', cx + dx * cw * 0.7, cy - 2, cz + dz * cd * 0.7, dz ? 0.3 : 0.12, 3.4, dx ? 0.3 : 0.12, gold);
  B.cylinder('metal', cx, cy, cz, Math.min(cw, cd) * 0.35, 0, rng.range(6, 12), gold, 8);
  f.light(cx, cy + 1.5, cz, 0xffd79a, 4.5, 'flood');
  f.light(cx, cy + 12, cz, 0xff2a1a, 2.2, 'beacon', true);
  f.reach(cy + 12);
}

