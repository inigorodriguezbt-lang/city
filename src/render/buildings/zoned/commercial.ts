// Commercial generators: corner shops, diners, cafés, gas stations,
// supermarkets and strip malls (low density); department stores, malls,
// hotels and retail towers with rooftop signage (high density); and mixed-use
// blocks (shops at street level, apartments above).
import type { RNG } from '../../../core/rng';
import type { MatKey } from '../types';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { BLANK, type Fab, roundRect } from './fab';
import { block, piers, plinth } from './blocks';
import { GROUND, awning, balconies, billboard, car, door, flatRoof, greenRoof, lampPost, lotGround, pad, parking, roofClutter, sign, tree, vaultRoof, withFace } from './parts';
import { artDecoCrown, gardenTrees, lawnColor, treeKindFor } from './residential';
import { type StyleKit, aptWindows, lightTrim, pickRoof, pickWall, pitchedMat, roofColor, styleKit, towerWindows, wallColor } from './style';
import { P, type Col, clamp, col, hueCol, shade } from './util';

/** Brand-ish saturated colour for signs / awnings. */
function brand(rng: RNG): Col {
  return hueCol(rng.pick([0.0, 0.02, 0.08, 0.12, 0.33, 0.55, 0.6, 0.75, 0.9]), rng.range(0.55, 0.8), rng.range(0.38, 0.5));
}

/** Storefront row across a face (use inside withFace): awnings, signs, doors. */
function storefronts(f: Fab, k: StyleKit, len: number, units: number, opts: { awnings?: boolean; signs?: boolean; y?: number; blade?: boolean } = {}): void {
  const rng = f.rng;
  const uw = len / units;
  for (let i = 0; i < units; i++) {
    const x0 = -len / 2 + i * uw + 0.25, x1 = x0 + uw - 0.5;
    const c = brand(rng);
    if (opts.awnings !== false && rng.chance(k.id === 'european' || k.id === 'mediterranean' || k.id === 'american' ? 0.75 : 0.4)) {
      awning(f, x0 + 0.2, x1 - 0.2, 0, (opts.y ?? 0) + 3.35, 1.5, c, rng.chance(0.5), P.white);
    }
    if (opts.blade || (k.id === 'asian' && rng.chance(0.7))) sign(f, x1 - 0.2, (opts.y ?? 0) + 4.8, 0, 0.8, 2.4, hueCol(rng.next(), 0.8, 0.55), 'blade');
    f.light((x0 + x1) / 2, (opts.y ?? 0) + 3.9, 0.5, c.getHex(), Math.min(4, uw * 0.6), 'neon');
  }
}

/** Café terrace: tables with parasols on the pavement. */
function terrace(f: Fab, x0: number, x1: number, z: number, depth: number, color: Col): void {
  const B = f.m();
  const rng = f.rng;
  const n = Math.max(1, Math.floor((x1 - x0) / 2.6));
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * ((x1 - x0) / n);
    const zz = z + depth * (0.35 + 0.3 * rng.next());
    B.cylinder('metal', x, GROUND, zz, 0.04, 0.04, 2.3, P.gunmetal, 4, {});
    B.cylinder('plain', x, GROUND + 2.0, zz, 1.25, 0.05, 0.45, i % 2 ? P.white : color, 8, { bottom: true });
    B.box('plain', x, GROUND + 0.7, zz, 0.8, 0.05, 0.8, '#f0ede6');
    B.box('metal', x, GROUND, zz, 0.08, 0.7, 0.08, P.gunmetal, { top: false });
  }
}

// ── low density commercial ────────────────────────────────────────────────
export function comLow(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const r = rng.next();
  if (W >= 32 && L <= 3 && r < (k.id === 'american' || k.id === 'modern' ? 0.3 : 0.14)) gasStation(f, k);
  else if (W >= 32 && L >= 2 && L <= 4 && r < 0.55) stripMall(f, k);
  else mainStreet(f, k, L <= 1 ? 1 : L === 2 ? rng.int(1, 2) : L === 3 ? 2 : L === 4 ? rng.int(2, 3) : 3);
}

/** Main-street shop: shopfront ground floor, optional upper storeys, parapet sign. */
function mainStreet(f: Fab, k: StyleKit, floors: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'paving', col(P.paving));
  const front = rng.range(0.3, 1.5);
  const bw = W - rng.range(0.6, 2.4);
  const bd = clamp(rng.range(12, 18) + L, 10, D - front - 3);
  const bz = D / 2 - front - bd / 2;
  const mat = pickWall(k, 'shop', rng);
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  const fh = k.fh + 0.1;
  const diner = k.id === 'american' && floors === 1 && rng.chance(0.35);
  if (diner) {
    // streamlined diner: stainless steel body, ribbon glazing, big roof sign
    const pts = roundRect(0, bz, bw * 0.85, Math.min(bd, 12), 3, 3);
    f.fprism('wall_glass', facCode(WinKind.Ribbon, 0, 1.6, 0), pts, -1.5, 5.0, '#c9d4da', { fh: 5, continuous: true, top: 'roof_metal', topColor: '#b9c0c6', lod: LodFacade.Shop });
    f.m().prismWalls('metal', roundRect(0, bz, bw * 0.85 + 0.1, Math.min(bd, 12) + 0.1, 3.05, 3), -1.5, 1.3, '#d9dde0');
    f.m().prismWalls('neon', roundRect(0, bz, bw * 0.85 + 0.12, Math.min(bd, 12) + 0.12, 3.06, 3), 1.3, 1.5, brand(rng));
    f.m().prismWalls('metal', roundRect(0, bz, bw * 0.85 + 0.1, Math.min(bd, 12) + 0.1, 3.05, 3), 4.1, 5.0, '#d9dde0');
    sign(f, 0, 5.1, bz, Math.min(8, bw * 0.6), 2.2, brand(rng), 'neon');
    parking(f, 0, (bz + Math.min(bd, 12) / 2 + D / 2) / 2 + 1, W - 2, Math.max(4, D / 2 - bz - 6), true, 0.5, false);
    lampPost(f, W / 2 - 1.5, D / 2 - 1.5, 6);
    return;
  }
  plinth(f, 0, bz, bw, bd, 0.3, shade(wc, 0.6), 'wall_stone');
  const upperMat: MatKey = floors > 1 ? (k.id === 'american' && rng.chance(0.7) ? 'wall_brick' : mat) : mat;
  const uc = upperMat === mat ? wc : wallColor(k, upperMat, rng);
  const shopH = 4.5;
  const roofShape = floors >= 2 && (k.id === 'european' || k.id === 'nordic') && rng.chance(0.5) ? (k.id === 'european' ? 'mansard' : 'gable') : k.id === 'asian' && floors === 1 && rng.chance(0.5) ? 'pagoda' : 'flat';
  const rm = roofShape === 'flat' ? 'roof_flat' : pitchedMat(k, rng);
  const out = block(f, {
    cx: 0, cz: bz, w: bw, d: bd, floors, fh, mat: upperMat, color: uc, code: aptWindows(k, upperMat, rng), roof: roofShape,
    roofMat: rm, roofColor: roofColor(k, rm, rng), rise: bd * 0.3, ridgeAlongX: true,
    ground: { mat: 'wall_shop', color: shade(wc, k.id === 'artdeco' ? 1 : 0.92), code: 0, h: shopH },
    parapet: floors === 1 ? rng.range(1.2, 2.2) : 0.9, cornice: k.ornate >= 0.4 ? lt : shade(uc, 0.85), richCornice: k.ornate >= 0.8 && floors >= 2, band: lt,
    trim: lt, dormerFlags: WF.Lites, attic: 0, flatColor: '#86837c', lod: floors === 1 ? LodFacade.Shop : LodFacade.Punched, overhang: 1.0,
  });
  const units = Math.max(1, Math.round(bw / rng.range(6, 9)));
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    storefronts(f, k, len, units, { blade: k.id === 'asian' || (k.id === 'american' && rng.chance(0.3)) });
    if (floors === 1 && roofShape === 'flat') sign(f, 0, shopH + 0.2, 0, Math.min(len * 0.7, 10), 1.1, brand(rng), rng.chance(0.4) ? 'neon' : 'box');
    if (k.id === 'artdeco') piers(f, -len / 2, len / 2, 0, shopH, out.eave + 0.8, Math.max(2, units * 2), 0.4, lt);
  });
  if ((k.id === 'european' || k.id === 'mediterranean' || k.id === 'nordic') && front + 0.5 < 2 && rng.chance(0.6)) {
    withFace(f, 'S', 0, bz, bw, bd, (len) => terrace(f, -len / 2 + 1, len * 0.1, 0.3, 2.2, brand(rng)));
  }
  if (floors === 1 && roofShape === 'flat') roofClutter(f, 0, bz, bw, bd, out.eave, { hvac: rng.int(1, 3) });
  else if (roofShape === 'flat') roofClutter(f, 0, bz, bw, bd, out.eave, { hvac: rng.int(0, 2), tank: k.id === 'american' && rng.chance(0.3), bulkhead: { mat: upperMat, color: uc } });
  // rear service yard
  const back = bz - bd / 2;
  if (back + D / 2 > 8) parking(f, 0, (back - D / 2) / 2, W - 2, back + D / 2 - 1.5, true, 0.5, true);
  if (rng.chance(0.5)) {
    const B = f.m();
    B.box('metal', -bw / 2 + 1.2, GROUND, back - 1.2, 1.6, 1.3, 1.1, '#3e6a44');
  }
}

/** Gas station: canopy with pumps, kiosk, price pylon. */
function gasStation(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, 'asphalt', col(P.asphaltWorn));
  const c = brand(rng);
  // kiosk at the back
  const kw = Math.min(W * 0.45, 16), kd = 9;
  const kz = -D / 2 + 2 + kd / 2;
  f.fbox('wall_shop', 0, 0, -1.5, kz, kw, kd, 4.6 + 1.5, '#e8e6e0', { fh: 4.5, base: 0, top: 'roof_flat', topColor: '#8a8a86', lod: LodFacade.Shop });
  flatRoof(f, 0, kz, kw, kd, 4.6, 0.9, 'wall_plaster', c, '#8a8a86', '#f4f4f0');
  withFace(f, 'S', 0, kz, kw, kd, () => sign(f, 0, 4.7, 0, kw * 0.7, 0.8, c, 'box'));
  // canopy
  const cw = Math.min(W - 6, 22), cd = Math.min(12, D / 2);
  const cz = kz + kd / 2 + 4 + cd / 2;
  const B = f.m();
  const ch = 5.4;
  B.box('plain', 0, ch, cz, cw, 0.9, cd, '#f2f2ee', { bottom: true });
  B.box('emissive', 0, ch - 0.02, cz, cw - 0.6, 0.02, cd - 0.6, '#fff6e6', { top: false, bottom: true, sides: { n: false, e: false, s: false, w: false } });
  B.box('neon', 0, ch + 0.3, cz + cd / 2 + 0.02, cw, 0.35, 0.04, c, { sides: { n: false } });
  B.box('neon', 0, ch + 0.3, cz - cd / 2 - 0.02, cw, 0.35, 0.04, c, { sides: { s: false } });
  const nP = Math.max(2, Math.round(cw / 7));
  for (let i = 0; i < nP; i++) {
    const x = -cw / 2 + (i + 0.5) * (cw / nP);
    B.box('plain', x, GROUND, cz, 0.4, ch, 0.4, '#d8d8d4', { top: false });
    B.box('concrete', x, 0, cz, 1.4, GROUND + 0.2, 5, '#cfcac0');
    B.box('plain', x, GROUND + 0.2, cz - 1.2, 0.7, 1.7, 0.5, c);
    B.box('plain', x, GROUND + 0.2, cz + 1.2, 0.7, 1.7, 0.5, c);
    f.light(x, ch - 0.3, cz, 0xf4f8ff, 5, 'flood');
    if (rng.chance(0.5)) car(f, x + 2.2, cz + (rng.chance(0.5) ? 1.4 : -1.4), Math.PI / 2 * (rng.chance(0.5) ? 1 : -1));
  }
  f.mass(0, cz, cw, cd, ch, 0.9, '#f2f2ee', '#f2f2ee', LodFacade.None);
  // price pylon
  const px = W / 2 - 2.5, pz = D / 2 - 2.5;
  B.box('plain', px, GROUND, pz, 0.5, 5.5, 0.5, '#d8d8d4');
  B.box('emissive', px, 5.5, pz, 2.4, 3.4, 0.5, c);
  B.box('emissive', px, 5.9, pz, 2.0, 1.6, 0.56, '#f4f2ea');
  f.light(px, 7.2, pz + 0.5, c.getHex(), 3, 'neon');
  // curb islands + trees
  tree(f, -W / 2 + 2, D / 2 - 2, 6, treeKindFor(ctx.theme, rng));
  pad(f, 'grass', -W / 2 + 2, D / 2 - 2, 3, 3, lawnColor(ctx.theme, rng), 0.12);
  void k;
}

/** Strip mall: one-storey row of units set back behind a parking lot. */
function stripMall(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'asphalt', col(P.asphalt));
  const bd = clamp(rng.range(13, 17), 10, D * 0.45);
  const bw = W - 3;
  const bz = -D / 2 + 1.5 + bd / 2;
  const mat = pickWall(k, 'shop', rng);
  const wc = wallColor(k, mat, rng);
  const units = Math.max(2, Math.round(bw / rng.range(7, 10)));
  const h = 5.2 + (L >= 4 ? 1 : 0);
  f.fbox('wall_shop', 0, 0, -1.5, bz, bw, bd, 4.5 + 1.5, shade(wc, 0.95), { fh: 4.5, base: 0, top: false, lod: LodFacade.Shop });
  f.fbox(mat, BLANK, 0, 4.5, bz, bw, bd, h - 4.5, wc, { fh: 3, base: 4.5, top: 'roof_flat', topColor: '#8a8680', noMass: true });
  // fascia with a raised centre pediment
  const B = f.m();
  const pw = bw * 0.28;
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    f.fbox(mat, BLANK, 0, h - 0.5, 0.4, pw, 0.8, 2.2, shade(wc, 1.05), { top: 'roof_metal', topColor: roofColor(k, 'roof_metal', rng), noMass: true });
    sign(f, 0, h + 0.1, 0.8, pw * 0.7, 1.1, brand(rng), 'neon');
    // covered walkway
    B.box('plain', 0, 4.1, 1.4, len, 0.35, 2.8, '#e8e6e0', { bottom: true });
    for (let i = 0; i <= units; i++) B.box('plain', -len / 2 + (i / units) * len, GROUND, 2.6, 0.3, 4.0, 0.3, '#d8d6d0', { top: false });
    for (let i = 0; i < units; i++) {
      const x = -len / 2 + (i + 0.5) * (len / units);
      sign(f, x, 4.5, 0.05, len / units * 0.6, 0.6, brand(rng), 'box', false);
      f.light(x, 3.9, 2.0, 0xffe6c0, 2.2, 'lamp');
    }
  });
  flatRoof(f, 0, bz, bw, bd, h, 0.6, mat, wc, '#8a8680');
  roofClutter(f, 0, bz, bw, bd, h, { hvac: units });
  // parking in front
  const pz0 = bz + bd / 2 + 3.2, pz1 = D / 2 - 1;
  parking(f, 0, (pz0 + pz1) / 2, W - 3, pz1 - pz0, true, 0.55, true);
  const tz = D / 2 - 1;
  for (let x = -W / 2 + 3; x < W / 2 - 2; x += 10) tree(f, x, tz, 5.5, treeKindFor(ctx.theme, rng));
  // pole sign
  B.box('metal', W / 2 - 2, GROUND, D / 2 - 2, 0.35, 7, 0.35, P.steelDark);
  B.box('emissive', W / 2 - 2, 7, D / 2 - 2, 3.2, 2.4, 0.5, brand(rng));
  f.light(W / 2 - 2, 8.2, D / 2 - 1.5, 0xfff0d0, 3, 'neon');
}

// ── high density commercial ───────────────────────────────────────────────
export function comHigh(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, L = ctx.level;
  const r = rng.next();
  if (L >= 3 && W >= 48 && r < 0.3) mall(f, k);
  else if (L >= 3 && r < 0.6) hotelTower(f, k);
  else departmentStore(f, k, clamp(2 + L + rng.int(0, 2), 3, 9));
}

/** Department store: big display windows, rich cornice, rooftop sign. */
function departmentStore(f: Fab, k: StyleKit, floors: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, 'paving', col(P.pavingWarm));
  const bw = W - 1.5, bd = D - rng.range(4, 8);
  const bz = D / 2 - 0.8 - bd / 2;
  const mat = pickWall(k, k.id === 'modern' || k.id === 'futuristic' ? 'office' : 'shop', rng);
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  const fh = 4.2;
  const code = mat === 'wall_glass' ? towerWindows(k, mat, rng, true) : facCode(WinKind.Single, rng.range(2.0, 2.6), 2.4, WF.DarkFrame | (k.ornate > 0.5 ? WF.Surround : 0));
  plinth(f, 0, bz, bw, bd, 0.5, shade(wc, 0.6), 'wall_stone');
  const out = block(f, {
    cx: 0, cz: bz, w: bw, d: bd, floors, fh, mat, color: wc, code, roof: k.id === 'artdeco' || (k.id === 'european' && rng.chance(0.4)) ? 'mansard' : 'flat', roofMat: 'roof_metal', roofColor: roofColor(k, 'roof_metal', rng),
    ground: { mat: 'wall_shop', color: shade(wc, 0.95), code: 0, h: 5.5 }, cornice: lt, richCornice: k.ornate >= 0.5, band: lt, parapet: 1.2, trim: lt, dormerFlags: WF.Surround, flatColor: '#7d7a74',
  });
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    storefronts(f, k, len, Math.max(2, Math.round(len / 8)), { awnings: k.id !== 'modern' && k.id !== 'futuristic' });
    // marquee entrance canopy
    const B = f.m();
    B.box('plain', 0, 5.0, 1.5, Math.min(12, len * 0.35), 0.5, 3, lt, { bottom: true });
    B.box('emissive', 0, 4.98, 1.5, Math.min(11, len * 0.33), 0.02, 2.8, '#fff2d8', { top: false, bottom: true, sides: { n: false, e: false, s: false, w: false } });
    f.light(0, 4.6, 2.2, 0xffe2b0, 6, 'flood');
    if (k.id === 'artdeco' || k.id === 'american') piers(f, -len / 2, len / 2, 0, 5.5, out.eave + 0.6, Math.max(3, Math.round(len / 4.2)), 0.5, lt);
    // big vertical sign on the corner
    sign(f, len / 2 - 1, 8, 0, 1.2, Math.min(out.eave - 10, 14), brand(rng), 'blade');
  });
  if (k.id !== 'artdeco' && rng.chance(0.6)) billboard(f, 0, out.eave, bz - bd * 0.1, Math.min(18, bw * 0.5), 5, 0, rng.next());
  else roofClutter(f, 0, bz, bw, bd, out.eave, { hvac: 3, bulkhead: { mat, color: wc } });
  const nT = Math.floor(W / 10);
  for (let i = 0; i < nT; i++) tree(f, -W / 2 + (i + 0.5) * (W / nT), D / 2 - 0.6, 6.5, treeKindFor(ctx.theme, rng));
}

/** Shopping mall: long low block with a glazed barrel-vault atrium and parking. */
function mall(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'asphalt', col(P.asphalt));
  const bw = W - 6, bd = D * 0.55;
  const bz = -D / 2 + 2 + bd / 2;
  const floors = L >= 5 ? 3 : 2;
  const h = floors * 5.2;
  const mat = pickWall(k, 'shop', rng);
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  f.fbox('wall_shop', 0, 0, -1.5, bz, bw, bd, 5.5 + 1.5, shade(wc, 0.95), { fh: 5.5, base: 0, top: false, lod: LodFacade.Shop });
  f.fbox(mat, facCode(WinKind.Ribbon, 0, 1.2, WF.DarkFrame), 0, 5.5, bz, bw, bd, h - 5.5, wc, { fh: 5.2, base: 5.5, vBase: 3.3, top: 'roof_flat', topColor: '#85827c' });
  flatRoof(f, 0, bz, bw, bd, h, 1.0, mat, wc, '#85827c', lt);
  // atrium vault along X
  vaultRoof(f, 0, bz, bw * 0.75, 10, h, 4.5, 'glass', '#9ec2d0', 'plain', '#dfe3e6');
  const B = f.m();
  for (let x = -bw * 0.36; x <= bw * 0.36; x += 4) B.box('metal', x, h, bz - 5.2, 0.12, 0.12, 10.4, '#e6e8ea');
  // entrance pavilion
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    f.fbox('wall_glass', towerWindows(k, 'wall_glass', rng, true), 0, 0, 2, 14, 4, 8, '#a9c6d4', { fh: 4, top: 'roof_metal', topColor: '#d8dadc', noMass: true, sides: { n: false } });
    sign(f, 0, 8.2, 4, 10, 1.6, brand(rng), 'neon');
    for (const x of [-len * 0.3, len * 0.3]) sign(f, x, 6.2, 0, 6, 1.4, brand(rng), 'box');
  });
  if (rng.chance(0.6)) billboard(f, bw * 0.3, h, bz + bd * 0.25, 14, 4.5, 0, rng.next());
  roofClutter(f, 0, bz, bw, bd, h, { hvac: 5 });
  const pz0 = bz + bd / 2 + 6, pz1 = D / 2 - 1.5;
  parking(f, 0, (pz0 + pz1) / 2, W - 4, pz1 - pz0, true, 0.6, true);
  for (let x = -W / 2 + 3; x < W / 2; x += 12) tree(f, x, D / 2 - 1, 6, treeKindFor(ctx.theme, rng));
}

/** Hotel: podium with lobby + slab tower with a lit rooftop sign. */
function hotelTower(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'paving', col(P.pavingWarm));
  const floors = [0, 6, 9, 14, rng.int(18, 24), rng.int(24, 32)][L] ?? 10;
  const fh = 3.2;
  const pw = W - 3, pd = D - 6;
  const pz = D / 2 - 1.5 - pd / 2;
  const mat = pickWall(k, 'tower', rng);
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  const podMat = pickWall(k, 'shop', rng);
  const podC = wallColor(k, podMat, rng);
  block(f, { cx: 0, cz: pz, w: pw, d: pd, floors: 2, fh: 4.4, mat: podMat, color: podC, code: facCode(WinKind.Single, 2.4, 2.6, WF.DarkFrame), roof: 'flat', ground: { mat: 'wall_shop', color: shade(podC, 0.95), code: 0, h: 5.2 }, cornice: lt, parapet: 1.0, flatColor: '#7d7a74' });
  const tw = clamp(pw * 0.8, 16, 44), td = clamp(pd * 0.42, 11, 16);
  const tz = pz - pd * 0.1;
  const y0 = 9.6;
  const code = mat === 'wall_glass' ? towerWindows(k, mat, rng) : facCode(WinKind.Single, 1.6, 1.9, WF.DarkFrame | WF.Balcony);
  f.fbox(mat, code, 0, y0, tz, tw, td, floors * fh, wc, { fh, base: y0, vBase: 3.3, top: 'roof_flat', topColor: '#6f6c66' });
  const top = y0 + floors * fh;
  if (mat !== 'wall_glass') withFace(f, 'S', 0, tz, tw, td, (len) => {
    const ys: number[] = [];
    for (let i = 1; i < floors; i++) ys.push(y0 + i * fh + 0.02);
    balconies(f, len - 1, ys, { bay: 3.6, depth: 1.2, rail: 'glass', wall: wc, slab: '#d0ccc4', railColor: '#9fbcc6', every: 1 });
  });
  flatRoof(f, 0, tz, tw, td, top, 1.2, mat, wc, '#6f6c66', lt);
  if (k.id === 'artdeco') artDecoCrown(f, 0, tz, tw * 0.6, td * 0.8, top, lt, rng);
  else {
    // rooftop hotel sign (letters as neon blocks on a frame)
    const B = f.m();
    const sw = Math.min(tw * 0.6, 20);
    B.box('metal', 0, top + 1.2, tz + td / 2 - 1, sw, 0.3, 0.3, P.steelDark);
    for (let i = 0; i < 2; i++) B.box('metal', (i ? 1 : -1) * sw * 0.4, top + 1.2, tz + td / 2 - 1, 0.25, 3.6, 0.25, P.steelDark);
    const letters = 5;
    const c = hueCol(rng.pick([0.0, 0.08, 0.55, 0.12]), 0.85, 0.55);
    for (let i = 0; i < letters; i++) B.box('neon', -sw / 2 + (i + 0.5) * (sw / letters), top + 1.6, tz + td / 2 - 0.8, sw / letters * 0.7, 2.6, 0.25, c);
    f.light(0, top + 2.8, tz + td / 2, c.getHex(), sw * 0.5, 'neon');
    roofClutter(f, 0, tz - 2, tw, td - 4, top, { hvac: 2, antenna: 8, beacon: true });
  }
  if (floors >= 18) f.light(tw / 2 - 0.5, top + 1.3, tz - td / 2 + 0.5, 0xff2a1a, 2.2, 'beacon', true);
  // porte-cochère + pool deck
  withFace(f, 'S', 0, pz, pw, pd, () => {
    const B = f.m();
    B.box('plain', 0, 5.4, 2.5, 12, 0.6, 5, lt, { bottom: true });
    B.box('emissive', 0, 5.38, 2.5, 11.4, 0.02, 4.6, '#fff2d8', { top: false, bottom: true, sides: { n: false, e: false, s: false, w: false } });
    for (const x of [-5.5, 5.5]) B.box('plain', x, GROUND, 4.6, 0.5, 5.3, 0.5, lt, { top: false });
    f.light(0, 5.0, 3, 0xffd9a0, 7, 'flood');
    car(f, -2, 3, Math.PI / 2, '#1f2226');
  });
  if (L >= 4) greenRoof(f, (pw / 2 - 6) * (rng.chance(0.5) ? 1 : -1), 9.6, pz + pd * 0.25, 9, 7, 2);
  for (let x = -W / 2 + 3; x < W / 2 - 2; x += 9) tree(f, x, D / 2 - 0.8, 7, treeKindFor(ctx.theme, rng));
}

// ── mixed use ─────────────────────────────────────────────────────────────
export function mixedUse(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'paving', col(P.paving));
  const floors = clamp([0, 3, 4, rng.int(5, 6), rng.int(6, 8), rng.int(8, 10)][L] ?? 4, 3, 10);
  const front = rng.range(0.3, 1.2);
  const bw = W - rng.range(0.5, 1.5);
  const bd = clamp(rng.range(14, 18), 10, D - front - 3);
  const bz = D / 2 - front - bd / 2;
  const mat = pickWall(k, 'apt', rng);
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  const fh = k.fh;
  const balc = k.id !== 'artdeco' && rng.chance(0.6);
  let shape = pickRoof(k, rng, true);
  if (shape === 'dome' || shape === 'pagoda' || shape === 'shed' || floors > 7) shape = floors > 7 || k.id !== 'european' ? 'flat' : 'mansard';
  if (shape === 'gable' || shape === 'hip') shape = k.id === 'european' && rng.chance(0.5) ? 'mansard' : 'flat';
  const rm = shape === 'flat' ? 'roof_flat' : pitchedMat(k, rng);
  plinth(f, 0, bz, bw, bd, 0.3, shade(wc, 0.6), 'wall_stone');
  const out = block(f, {
    cx: 0, cz: bz, w: bw, d: bd, floors, fh, mat, color: wc, code: aptWindows(k, mat, rng, balc), roof: shape, roofMat: rm, roofColor: roofColor(k, rm, rng),
    ground: { mat: 'wall_shop', color: shade(wc, 0.93), code: 0, h: 4.6 }, cornice: lt, richCornice: k.ornate >= 0.7, band: lt, parapet: 0.9, trim: lt, dormerFlags: WF.Lites | WF.Surround, flatColor: '#86837c',
  });
  if (balc) {
    const ys: number[] = [];
    for (let i = 1; i < floors - 1; i++) ys.push(4.6 + i * fh + 0.02);
    const rail = k.id === 'modern' || k.id === 'futuristic' ? 'glass' : k.id === 'asian' ? 'solid' : 'iron';
    withFace(f, 'S', 0, bz, bw, bd, (len) => balconies(f, len, ys, { bay: 3.2, depth: 1.1, rail, wall: wc, slab: '#cbc7bf', railColor: rail === 'glass' ? '#9fbcc6' : rail === 'solid' ? shade(wc, 0.92) : '#25272a', continuous: k.id === 'modern' || k.id === 'futuristic', every: k.id === 'european' ? 1 : 2 }));
  }
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    storefronts(f, k, len, Math.max(1, Math.round(len / 7)), { blade: k.id === 'asian' });
    door(f, len / 2 - 1.6, 0, 1.3, 2.6, '#2f2a26', lt, true);
    if (k.id === 'artdeco') piers(f, -len / 2, len / 2, 0, 4.6, out.eave + 0.6, Math.max(2, Math.round(len / 3.2)), 0.35, lt);
  });
  if (k.id === 'asian') {
    withFace(f, 'S', 0, bz, bw, bd, (len) => {
      for (let i = 0; i < Math.max(1, Math.floor(len / 8)); i++) sign(f, -len / 2 + 2 + i * 8, 6, 0, 0.9, Math.min(10, (floors - 2) * fh), hueCol(rng.next(), 0.85, 0.55), 'blade');
    });
  }
  if (shape === 'flat') {
    if (k.id === 'modern' && rng.chance(0.6)) greenRoof(f, 0, out.eave, bz, bw - 2, bd - 2, 3);
    else roofClutter(f, 0, bz, bw, bd, out.eave, { hvac: rng.int(1, 2), tank: k.id === 'american' && rng.chance(0.5), bulkhead: { mat, color: wc }, antenna: rng.chance(0.3) ? 5 : 0 });
  }
  const back = bz - bd / 2;
  if (back + D / 2 > 8) {
    if (rng.chance(0.5)) parking(f, 0, (back - D / 2) / 2, W - 2, back + D / 2 - 1.5, true, 0.6, true);
    else gardenTrees(f, -W / 2 + 1, -D / 2 + 1, W / 2 - 1, back - 1, Math.round(W / 10));
  }
}
