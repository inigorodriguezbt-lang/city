// Generic industry: sawtooth-roofed factories with chimneys and tanks,
// warehouses with loading docks and trucks, process plants, and — at high
// levels — clean high-tech campuses with solar roofs and landscaping.
import type { MatKey } from '../types';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { BLANK, type Fab } from './fab';
import { block } from './blocks';
import {
  GROUND, container, crates, fence, flatRoof, gableRoof, greenRoof, hvac, lampPost, loadingDocks, lotGround, pad, parking, pipe, roofClutter, sawtoothRoof, sign, silo,
  solarArray, stack, tank, tree, truck, vaultRoof, withFace,
} from './parts';
import { lawnColor, treeKindFor } from './residential';
import { type StyleKit, lightTrim, styleKit, towerWindows, wallColor } from './style';
import { P, clamp, col, hueCol, pickCol, shade } from './util';

const IND_WALLS = ['#c9ccce', '#aeb4b8', '#d8d6cf', '#8fa1ad', '#b8bdb0', '#d1c7b5', '#7a8a96', '#9a3b2c', '#5f7f6a', '#3f5f7a'];
const IND_ROOFS = ['#8a9096', '#6f767d', '#9aa0a4', '#5c6166', '#7a6a5a'];

export function industry(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const L = ctx.level;
  const r = rng.next();
  if (L >= 4 && r < 0.65) hiTech(f, k);
  else if (r < 0.4) factory(f, k);
  else if (r < 0.75) warehouse(f, k);
  else processPlant(f, k);
}

/** Office annex with punched windows at the front of an industrial lot. */
function annex(f: Fab, k: StyleKit, cx: number, cz: number, w: number, d: number, floors: number): number {
  const rng = f.rng;
  const mat: MatKey = k.id === 'american' || k.id === 'european' || k.id === 'nordic' ? (rng.chance(0.6) ? 'wall_brick' : 'wall_concrete') : rng.chance(0.5) ? 'wall_office' : 'wall_concrete';
  const wc = wallColor(k, mat, rng);
  const out = block(f, { cx, cz, w, d, floors, fh: 3.4, mat, color: wc, code: facCode(WinKind.Single, 2.0, 1.6, WF.DarkFrame), roof: 'flat', parapet: 0.8, cornice: shade(wc, 0.85), flatColor: '#8a8680' });
  withFace(f, 'S', cx, cz, w, d, () => sign(f, 0, out.eave - 0.2, 0, Math.min(w * 0.6, 9), 1.0, hueCol(rng.next(), 0.6, 0.45), 'box'));
  return out.eave;
}

function yardDressing(f: Fab, x0: number, z0: number, x1: number, z1: number, dirty: boolean): void {
  const rng = f.rng;
  const w = x1 - x0, d = z1 - z0;
  if (w < 4 || d < 4) return;
  crates(f, (x0 + x1) / 2, (z0 + z1) / 2, w, d, Math.round((w * d) / (dirty ? 40 : 90)));
  if (dirty && w > 14 && d > 6 && rng.chance(0.6)) {
    const n = Math.min(3, Math.floor(w / 3));
    for (let i = 0; i < n; i++) container(f, x0 + 2 + i * 2.8, 0, (z0 + z1) / 2, 0, rng.pick(['#9a3b2c', '#2f5f8a', '#3f7a4a', '#c98a2c', '#7a7f84']), d > 13);
    if (rng.chance(0.5)) container(f, x0 + 2 + 1.4, 2.6, (z0 + z1) / 2, 0.05, rng.pick(['#9a3b2c', '#2f5f8a', '#c98a2c']), d > 13);
  }
}

/** Old factory: brick / corrugated hall under a sawtooth roof, stacks and tanks. */
function factory(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'concrete', col(P.concrete));
  const brick = L <= 2 && (k.id === 'american' || k.id === 'european' || k.id === 'nordic' || rng.chance(0.3));
  const mat: MatKey = brick ? 'wall_brick' : 'wall_industrial';
  const wc = brick ? wallColor(k, 'wall_brick', rng) : pickCol(rng, IND_WALLS, 0.03);
  const hw = W - rng.range(6, 10), hd = clamp(D * rng.range(0.5, 0.62), 18, D - 14);
  const hx = (rng.next() - 0.5) * 3, hz = -D / 2 + 3 + hd / 2 + rng.range(0, 3);
  const h = rng.range(7, 10);
  f.fbox(mat, brick ? facCode(WinKind.Single, 2.2, 3.2, WF.Arched | WF.Lites | WF.BlankGround) : 0, hx, -1.5, hz, hw, hd, h + 1.5, wc, { fh: brick ? h / 1.6 : 6, base: 0, top: false, lod: brick ? LodFacade.Punched : LodFacade.Industrial });
  const teeth = Math.max(3, Math.round(hd / 7));
  sawtoothRoof(f, hx, hz, hw, hd, h, teeth, pickCol(rng, IND_ROOFS, 0.03));
  // office annex at the front corner
  const aw = Math.min(hw * 0.4, 18);
  annex(f, k, hx - hw / 2 + aw / 2, hz + hd / 2 + 4, aw, 8, L >= 2 ? 3 : 2);
  // stacks + tanks behind
  const nS = L <= 2 ? rng.int(1, 3) : rng.int(0, 1);
  for (let i = 0; i < nS; i++) stack(f, hx + hw / 2 - 3 - i * 4.5, hz - hd / 2 + 2.5, rng.range(1.1, 1.8), rng.range(22, 38), rng.chance(0.6), L <= 2 ? 1 : 0.4);
  if (rng.chance(0.6)) tank(f, hx - hw / 2 + 4, hz - hd / 2 - 3, rng.range(2.5, 4), rng.range(6, 10), pickCol(rng, ['#d8d8d4', '#c9ccce', '#7a8a96', '#a9b4a0'], 0.02), 'cone');
  // yard in front: docks + trucks
  const yz0 = hz + hd / 2 + 1, yz1 = D / 2 - 1;
  withFace(f, 'S', hx + aw / 2, hz, hw - aw, hd, (len) => loadingDocks(f, len - 4, Math.max(1, Math.floor(len / 8)), '#8c949a'));
  const nT = Math.min(3, Math.floor((hw - aw) / 9));
  for (let i = 0; i < nT; i++) if (rng.chance(0.7)) truck(f, hx - hw / 2 + aw + 6 + i * 8, hz + hd / 2 + 9.5, Math.PI, undefined, true);
  yardDressing(f, hx + hw / 2 - 12, yz0 + 12, W / 2 - 2, yz1, true);
  pad(f, 'asphalt', 0, (yz0 + yz1) / 2, W - 2, yz1 - yz0, P.asphaltWorn, 0.02);
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [-2, D / 2 - 0.4]], 'chain', '#8a9096', 1.1);
  fence(f, [[6, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4]], 'chain', '#8a9096', 1.1);
  lampPost(f, W / 2 - 2, 0, 8);
  lampPost(f, -W / 2 + 2, D / 2 - 6, 8);
}

/** Warehouse / distribution centre. */
function warehouse(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'asphalt', col(P.asphaltWorn));
  const hw = W - rng.range(4, 8), hd = clamp(D * rng.range(0.45, 0.6), 16, D - 16);
  const hz = -D / 2 + 2 + hd / 2;
  const h = rng.range(8, 12) + (L >= 3 ? 2 : 0);
  const wc = pickCol(rng, IND_WALLS, 0.03);
  f.fbox('wall_industrial', facCode(WinKind.Auto, 0, 0, 0), 0, -1.5, hz, hw, hd, h + 1.5, wc, { fh: 6, base: 0, top: false, lod: LodFacade.Industrial });
  const roofC = pickCol(rng, IND_ROOFS, 0.03);
  if (rng.chance(0.5)) gableRoof(f, { cx: 0, cz: hz, w: hw, d: hd, y: h, rise: Math.min(hw, hd) * 0.08, mat: 'roof_metal', color: roofC, wallMat: 'wall_industrial', wallColor: wc, fh: 6, overhang: 0.4, trim: shade(wc, 0.8), attic: 0 });
  else if (rng.chance(0.4)) vaultRoof(f, 0, hz, hw, hd, h, Math.min(hd * 0.18, 5), 'roof_metal', roofC, 'wall_industrial', wc);
  else {
    flatRoof(f, 0, hz, hw, hd, h, 0.8, 'wall_industrial', wc, '#8a8e92', shade(wc, 0.9), 6);
    roofClutter(f, 0, hz, hw, hd, h, { hvac: rng.int(2, 5), solar: L >= 3 });
  }
  // colour band / branding stripe
  f.m().box('plain', 0, h - 1.4, hz, hw + 0.06, 0.9, hd + 0.06, hueCol(rng.next(), 0.55, 0.45), { top: false });
  withFace(f, 'S', 0, hz, hw, hd, (len) => {
    loadingDocks(f, len - 6, Math.max(2, Math.floor(len / 5)), shade(wc, 0.9));
    sign(f, len / 2 - 6, h - 3.2, 0.05, 8, 1.4, hueCol(rng.next(), 0.7, 0.45), 'box');
  });
  // trucks at docks + trailers in the yard
  const yz = hz + hd / 2;
  const nD = Math.max(2, Math.floor((hw - 6) / 5));
  for (let i = 0; i < nD; i++) {
    if (!rng.chance(0.55)) continue;
    truck(f, -hw / 2 + 3 + (i + 0.5) * ((hw - 6) / nD), yz + 9.5, Math.PI, undefined, true);
  }
  const pz0 = yz + 18, pz1 = D / 2 - 1;
  if (pz1 - pz0 > 5) parking(f, 0, (pz0 + pz1) / 2, W - 4, pz1 - pz0, true, 0.5, true);
  lampPost(f, -W / 2 + 2, yz + 4, 9);
  lampPost(f, W / 2 - 2, yz + 4, 9);
  fence(f, [[-W / 2 + 0.4, -D / 2 + 0.4], [W / 2 - 0.4, -D / 2 + 0.4]], 'chain', '#8a9096', 1.2);
  void k;
}

/** Chemical / process plant: tanks, silos, pipe racks, stacks. */
function processPlant(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'concrete', col(P.concreteDark));
  const hw = clamp(W * 0.45, 14, 30), hd = clamp(D * 0.35, 12, 22);
  const hx = -W / 2 + 3 + hw / 2, hz = -D / 2 + 3 + hd / 2;
  const wc = pickCol(rng, IND_WALLS, 0.03);
  f.fbox('wall_industrial', 0, hx, -1.5, hz, hw, hd, 13.5, wc, { fh: 6, base: 0, top: 'roof_metal', topColor: pickCol(rng, IND_ROOFS), lod: LodFacade.Industrial });
  roofClutter(f, hx, hz, hw, hd, 12, { hvac: 3 });
  // tank farm
  const tx0 = hx + hw / 2 + 4, tx1 = W / 2 - 3;
  const r = rng.range(3, 4.5);
  const cols = Math.max(1, Math.floor((tx1 - tx0) / (r * 2 + 2)));
  const rows = Math.max(1, Math.floor((D * 0.55) / (r * 2 + 2)));
  const tc = pickCol(rng, ['#e8e6e0', '#d0d4d6', '#b9c4c8', '#e6dccb'], 0.02);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) tank(f, tx0 + r + i * (r * 2 + 2), -D / 2 + 3 + r + j * (r * 2 + 2), r, rng.range(7, 12), tc, rng.chance(0.5) ? 'dome' : 'cone');
  // silos + stack
  for (let i = 0; i < rng.int(2, 4); i++) silo(f, hx - hw / 2 + 2.5 + i * 4.2, hz + hd / 2 + 4, 1.8, rng.range(14, 20), '#c9ccce');
  stack(f, hx + hw / 2 - 2, hz - hd / 2 + 2, 1.6, rng.range(28, 42), true, L <= 2 ? 1 : 0.5);
  if (L >= 2) f.emitter('steam', hx, 14, hz, 0.6);
  // pipe racks
  const py = 5.5;
  pipe(f, hx + hw / 2, hz, tx1, hz, py, 0.35, '#a8a29a');
  pipe(f, hx + hw / 2, hz + 1, tx1, hz + 1, py, 0.25, '#c49a3a');
  pipe(f, hx, hz + hd / 2, hx, D / 2 - 8, py - 1, 0.3, '#8a9096');
  // yard
  pad(f, 'asphalt', 0, D / 2 - 6, W - 2, 10, P.asphaltWorn, 0.02);
  truck(f, 4, D / 2 - 6, Math.PI / 2, '#e8e6e0', true);
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [0, D / 2 - 0.4]], 'chain', '#8a9096', 1.2);
  lampPost(f, 0, D / 2 - 11, 9);
  void k;
}

/** Clean high-tech campus: glass office + clean production hall, solar roofs, landscaping. */
function hiTech(f: Fab, k: StyleKit): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'grass', lawnColor(ctx.theme, rng));
  const hw = W - rng.range(8, 14), hd = clamp(D * 0.42, 16, D - 22);
  const hz = -D / 2 + 3 + hd / 2;
  const hallC = pickCol(rng, ['#e8eaec', '#d6dadd', '#f0f0ee', '#c9d2d8'], 0.02);
  const h = rng.range(8, 11);
  f.fbox('wall_industrial', facCode(WinKind.Blank), 0, -1.5, hz, hw, hd, h + 1.5, hallC, { fh: 6, base: 0, top: 'roof_flat', topColor: '#9a9ea0', lod: LodFacade.Industrial });
  // ribbon clerestory
  withFace(f, 'S', 0, hz, hw, hd, (len) => f.m().box('glass', 0, h - 2.6, 0.03, len - 1, 1.6, 0.06, '#7fa8c0', { sides: { n: false } }));
  flatRoof(f, 0, hz, hw, hd, h, 0.6, 'wall_industrial', hallC, '#8e9296', '#f0f0ee', 6);
  solarArray(f, 0, h, hz, hw - 3, hd - 3);
  // glass office wing in front
  const ow = Math.min(hw * 0.6, 34), od = 11;
  const oz = hz + hd / 2 + od / 2 + 3;
  const omat: MatKey = k.id === 'modern' || k.id === 'futuristic' || rng.chance(0.6) ? 'wall_glass' : 'wall_office';
  const oc = wallColor(k, omat, rng);
  const floors = L >= 5 ? 4 : 3;
  f.fbox(omat, towerWindows(k, omat, rng, true), -hw / 2 + ow / 2 + 1, -1.5, oz, ow, od, floors * 3.8 + 1.5, oc, { fh: 3.8, base: 0, top: 'roof_flat', topColor: '#6f7478' });
  flatRoof(f, -hw / 2 + ow / 2 + 1, oz, ow, od, floors * 3.8, 1.0, omat, oc, '#6f7478', lightTrim(k, rng));
  if (rng.chance(0.5)) greenRoof(f, -hw / 2 + ow / 2 + 1, floors * 3.8, oz, ow - 2, od - 2, 1);
  else roofClutter(f, -hw / 2 + ow / 2 + 1, oz, ow, od, floors * 3.8, { hvac: 2 });
  // bridge link
  f.fbox('wall_glass', BLANK, -hw / 2 + ow / 2 + 1, 4, (hz + hd / 2 + oz - od / 2) / 2, 4, oz - od / 2 - hz - hd / 2 + 0.4, 3.4, '#9ab8c6', { top: 'roof_flat', noMass: true });
  withFace(f, 'S', -hw / 2 + ow / 2 + 1, oz, ow, od, () => sign(f, 0, floors * 3.8 + 1.0, 0, Math.min(10, ow * 0.4), 1.4, hueCol(rng.pick([0.55, 0.6, 0.33, 0.0])), 'neon'));
  // cooling units + clean stacks (steam only)
  for (let i = 0; i < 3; i++) hvac(f, hw / 2 - 4 - i * 4, 0.1, hz + hd / 2 + 3, 3, 2.5, 2.2);
  if (rng.chance(0.4)) f.emitter('steam', hw / 2 - 8, 2.8, hz + hd / 2 + 3, 0.3);
  // car park + landscaping
  const pz0 = oz + od / 2 + 2, pz1 = D / 2 - 2;
  const px = hw / 2 - (hw - ow) / 2 + 1;
  if (pz1 - pz0 > 5) parking(f, 0, (pz0 + pz1) / 2, W - 6, pz1 - pz0, true, 0.6, true);
  else parking(f, px, oz, hw - ow - 4, od, false, 0.6, false);
  for (let x = -W / 2 + 3; x < W / 2 - 2; x += 8) tree(f, x, D / 2 - 1, rng.range(5.5, 7.5), treeKindFor(ctx.theme, rng));
  for (let z = -D / 2 + 4; z < hz + hd / 2; z += 9) tree(f, W / 2 - 2.5, z, rng.range(5.5, 7.5), treeKindFor(ctx.theme, rng));

}
