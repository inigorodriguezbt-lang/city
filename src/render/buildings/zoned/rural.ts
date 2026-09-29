// Specialised industry: farms (fields, barns, silos, greenhouses, orchards,
// paddies, tractors), forestry (sawmills, log decks, timber yards), mining
// (terraced pits, headframes, conveyors, ore piles, dust) and oil (animated
// pumpjacks, tank farms, flare stacks, pipes, derricks).
import * as THREE from 'three';
import type { ModelBuilder } from '../ModelBuilder';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { BLANK, type Fab } from './fab';
import { block } from './blocks';
import { GROUND, fence, gableRoof, hedge, lampPost, logStack, lotGround, pad, pile, pipe, sign, silo, stack, tank, tree, truck, vaultRoof, withFace } from './parts';
import { lawnColor, treeKindFor } from './residential';
import { styleKit, wallColor } from './style';
import { P, clamp, col, jitter, mix, pickCol, shade } from './util';

// ── farming ───────────────────────────────────────────────────────────────
const CROPS: Record<string, string[]> = {
  temperate: ['#c9b458', '#7fa844', '#a9c25a', '#d8c070', '#5f8f3a', '#b89a4a'],
  boreal: ['#a9b85a', '#7f9a44', '#c9b870', '#6f8f4a'],
  desert: ['#b8a84a', '#8fa84a', '#d0b060'],
  tropical: ['#6fb04a', '#5f9a3a', '#8fc05a', '#4f8a3a'],
  alpine: ['#8fa84a', '#a9b860', '#7f9a44'],
  mediterranean: ['#8a7fb8', '#9a8fc0', '#b8a458', '#7f9a44', '#a8b060'],
};

export function farming(f: Fab): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const k = styleKit(ctx.style);
  lotGround(f, W, D, 'dirt', col(P.dirt));
  // farmyard strip at the front
  const yardD = clamp(D * 0.3, 14, 22);
  const fz1 = D / 2 - yardD;
  const crops = CROPS[ctx.theme.id] ?? CROPS.temperate;
  // fields: 2-4 parcels with different crops / orientations
  const nP = rng.int(2, L >= 3 ? 3 : 4);
  const paddy = k.id === 'asian' && rng.chance(0.6);
  let x = -W / 2 + 0.8;
  for (let i = 0; i < nP; i++) {
    const pw = i === nP - 1 ? W / 2 - 0.8 - x : (W - 1.6) / nP;
    const cx = x + pw / 2, cz = (-D / 2 + 0.8 + fz1 - 0.8) / 2, pd = fz1 - 0.8 - (-D / 2 + 0.8);
    const kind = rng.next();
    if (paddy && i % 2 === 0) {
      pad(f, 'water', cx, cz, pw - 1, pd - 1, '#6f9a8a', 0.05);
      for (let r = 0; r < Math.floor((pw - 2) / 1.2); r++) f.m().box('crop', cx - pw / 2 + 1.2 + r * 1.2, GROUND, cz, 0.35, 0.4, pd - 2, '#7fc050', { top: 'crop' });
      f.m().box('dirt', cx, GROUND, cz + pd / 2 - 0.3, pw, 0.3, 0.6, '#6a5a42');
    } else if (kind < 0.18 && L >= 2) {
      orchard(f, cx, cz, pw - 1.5, pd - 1.5, ctx.theme.id === 'mediterranean' || ctx.theme.id === 'desert');
    } else if (kind < 0.3 && ctx.theme.id === 'mediterranean') {
      vineyard(f, cx, cz, pw - 1, pd - 1);
    } else {
      const c = jitter(col(rng.pick(crops)), rng, 0.05);
      f.pushTRS(cx, 0, cz, rng.chance(0.5) ? 0 : Math.PI / 2);
      const B = f.m();
      const [aw, ad] = [pw - 1, pd - 1];
      // crop surface slightly raised; the crop shader draws furrows along u
      B.box('crop', 0, GROUND - 0.1, 0, aw, 0.35, ad, c, { top: 'crop', topColor: c });
      f.pop();
      f.mass(cx, cz, pw - 1, pd - 1, 0, 0.4, c, c, LodFacade.None);
    }
    // hedgerow / track between parcels
    if (i < nP - 1) {
      if (k.id === 'european' || k.id === 'nordic') hedge(f, x + pw, -D / 2 + 1, x + pw, fz1 - 1, 1.3, 0.9);
      else pad(f, 'dirt', x + pw, cz, 1.4, pd, '#8a7050', 0.3);
    }
    x += pw;
  }
  // farmyard: farmhouse, barn, silos, greenhouses
  pad(f, 'dirt', 0, fz1 + yardD / 2, W - 1, yardD - 1, '#8f7a5a', 0.03);
  const barnW = clamp(W * 0.28, 12, 20), barnD = 10;
  const bx = W / 2 - 2 - barnW / 2, bz = fz1 + yardD / 2 - 1;
  barn(f, bx, bz, barnW, barnD, k.id === 'american' || k.id === 'nordic' || rng.chance(0.4));
  const ns = L >= 3 ? rng.int(2, 3) : rng.int(1, 2);
  for (let i = 0; i < ns; i++) silo(f, bx - barnW / 2 - 3 - i * 4.4, bz - 2, 1.9, rng.range(10, 16), pickCol(rng, ['#c9ccce', '#b8bdc2', '#d8d4c8', '#7a8a96']), '#9aa0a6');
  // farmhouse
  const hx = -W / 2 + 8, hz = fz1 + yardD / 2 + 1;
  const hmat = k.id === 'nordic' || k.id === 'american' ? 'wall_wood' : 'wall_plaster';
  const hc = wallColor(k, hmat, rng);
  block(f, { cx: hx, cz: hz, w: 10, d: 8, floors: 2, fh: 2.9, mat: hmat, color: hc, code: facCode(WinKind.Single, 1.0, 1.4, WF.Lites | (hmat === 'wall_wood' && k.id === 'nordic' ? WF.AltBase : 0)), roof: 'gable', roofMat: k.id === 'nordic' ? 'roof_metal' : k.id === 'american' ? 'roof_shingle' : 'roof_tile', roofColor: k.id === 'nordic' ? '#2a2d31' : k.id === 'american' ? '#4a4f57' : '#a4452f', rise: 3.2, ridgeAlongX: true, trim: '#f2efe6', overhang: 0.5, lod: LodFacade.House });
  withFace(f, 'S', hx, hz, 10, 8, () => f.light(0, 2.4, 0.4, 0xffc27a, 1.6, 'lamp'));
  tree(f, hx - 6, hz + 3, 8, treeKindFor(ctx.theme, rng));
  if (L >= 3) {
    const ng = L >= 5 ? 3 : 2;
    for (let i = 0; i < ng; i++) greenhouse(f, -W / 2 + 18 + i * 7.5, fz1 + 4.5, 6, Math.min(yardD - 6, 14));
  }
  // tractor + trailer
  tractor(f, 2, fz1 + 3, rng.next() * Math.PI * 2, rng.pick(['#c43a2f', '#3f8f4a', '#2f64c0', '#e0a020']));
  if (L >= 2) truck(f, -2, fz1 + yardD - 5, Math.PI / 2, '#d8d4c8', false);
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [-3, D / 2 - 0.4]], 'rail', '#b8a07a', 1.2);
  fence(f, [[3, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4]], 'rail', '#b8a07a', 1.2);
  lampPost(f, 0, fz1 + yardD / 2, 6);
}

function barn(f: Fab, cx: number, cz: number, w: number, d: number, red: boolean): void {
  const rng = f.rng;
  const c = red ? pickCol(rng, ['#9a2f24', '#8a2a22', '#a8382a'], 0.03) : pickCol(rng, ['#8a7a64', '#6f6454', '#a8a090'], 0.03);
  const h = 4.8;
  f.fbox('wall_wood', facCode(WinKind.Blank, 0, 0, WF.AltBase), cx, -1, cz, w, d, h + 1, c, { fh: h, base: 0, top: false, lod: LodFacade.None });
  // gambrel roof: steep lower + shallow upper (gable ridge along X)
  const B = f.m();
  const rc = red ? '#4a4f55' : '#6a5a48';
  const x0 = cx - w / 2 - 0.3, x1 = cx + w / 2 + 0.3;
  const lowH = 2.6, lowIn = 1.1, upH = 1.8;
  for (const s of [1, -1]) {
    const ze = cz + s * (d / 2 + 0.3), zm = cz + s * (d / 2 - lowIn);
    B.quad('roof_metal', { x: x0, y: h, z: ze }, { x: x1, y: h, z: ze }, { x: x1, y: h + lowH, z: zm }, { x: x0, y: h + lowH, z: zm }, [[0, 0], [w, 0], [w, 3], [0, 3]], rc, { x: 0, y: 0.5, z: s });
    B.quad('roof_metal', { x: x0, y: h + lowH, z: zm }, { x: x1, y: h + lowH, z: zm }, { x: x1, y: h + lowH + upH, z: cz }, { x: x0, y: h + lowH + upH, z: cz }, [[0, 3], [w, 3], [w, 6], [0, 6]], rc, { x: 0, y: 1, z: s * 0.5 });
  }
  const W2 = f.m(BLANK);
  for (const s of [1, -1]) {
    const x = cx + s * w / 2;
    const pts: [number, number][] = [[cz + d / 2, h], [cz + d / 2 - lowIn, h + lowH], [cz, h + lowH + upH], [cz - d / 2 + lowIn, h + lowH], [cz - d / 2, h]];
    for (let i = 1; i < pts.length - 1; i++) W2.tri('wall_wood', { x, y: pts[0][1], z: pts[0][0] }, { x, y: pts[i][1], z: pts[i][0] }, { x, y: pts[i + 1][1], z: pts[i + 1][0] }, [0, pts[0][1]], [d / 2, pts[i][1]], [d, pts[i + 1][1]], c, { x: s, y: 0, z: 0 });
  }
  // big doors with white X trim
  withFace(f, 'S', cx, cz, w, d, () => {
    B.box('wood', 0, GROUND, 0.04, 4.2, 3.8, 0.08, shade(c, 0.85), { sides: { n: false } });
    B.box('plain', 0, GROUND + 3.8, 0.1, 4.4, 0.18, 0.06, '#f2efe6');
    B.box('plain', -2.1, GROUND, 0.1, 0.18, 3.9, 0.06, '#f2efe6');
    B.box('plain', 2.1, GROUND, 0.1, 0.18, 3.9, 0.06, '#f2efe6');
    f.light(0, 4.4, 0.5, 0xffd08a, 1.8, 'lamp');
  });
  f.mass(cx, cz, w, d, 0, h, c, rc, LodFacade.None);
  f.mass(cx, cz, w * 0.9, d * 0.6, h, lowH + upH * 0.5, rc, rc, LodFacade.None);
  f.reach(h + lowH + upH);
}

function greenhouse(f: Fab, cx: number, cz: number, w: number, d: number): void {
  const B = f.m();
  B.box('concrete', cx, GROUND, cz, w, 0.5, d, '#c9c4b8', { top: false });
  const g = new THREE.BoxGeometry(w - 0.1, 2.4, d - 0.1);
  B.addGeometry('glass', g, '#cfe4e8', new THREE.Matrix4().makeTranslation(cx, GROUND + 0.5 + 1.2, cz));
  g.dispose();
  vaultRoof(f, cx, cz, w, d, GROUND + 2.9, Math.min(d * 0.3, 2.2), 'glass', '#d8ecef', 'glass', '#d8ecef');
  f.light(cx, GROUND + 2, cz, 0xffb0e0, Math.max(w, d) * 0.5, 'flood');
  f.mass(cx, cz, w, d, 0, 3.6, '#d8ecef', '#d8ecef', LodFacade.None);
}

function orchard(f: Fab, cx: number, cz: number, w: number, d: number, olive: boolean): void {
  const rng = f.rng;
  pad(f, 'grass', cx, cz, w, d, olive ? '#a8a060' : '#6f9a48', 0.05);
  const sp = olive ? 5.5 : 4.5;
  const nx = Math.max(1, Math.floor(w / sp)), nz = Math.max(1, Math.floor(d / sp));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) tree(f, cx - w / 2 + (i + 0.5) * (w / nx), cz - d / 2 + (j + 0.5) * (d / nz), rng.range(3.2, 4.5), 'round', olive ? '#7a8a5a' : rng.chance(0.3) ? '#6f9a3a' : '#4f7d37');
}

function vineyard(f: Fab, cx: number, cz: number, w: number, d: number): void {
  pad(f, 'dirt', cx, cz, w, d, '#a08462', 0.05);
  const n = Math.floor(w / 2.2);
  for (let i = 0; i < n; i++) f.m().box('foliage', cx - w / 2 + 1.1 + i * 2.2, GROUND, cz, 0.6, 1.3, d - 1, '#5a7f3a');
}

function tractor(f: Fab, x: number, z: number, rot: number, color: string): void {
  if (f.detail === 'low') return;
  f.pushTRS(x, GROUND, z, rot);
  const B = f.m();
  B.box('plain', 0, 0.9, 0.5, 1.4, 1.1, 2.6, color);
  B.box('glass', 0, 2.0, -0.3, 1.4, 1.2, 1.4, '#2a3440');
  B.box('plain', 0, 3.2, -0.3, 1.5, 0.1, 1.5, color);
  const wheel = new THREE.CylinderGeometry(0.85, 0.85, 0.5, 10);
  const small = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 8);
  for (const s of [1, -1]) {
    B.addGeometry('plain', wheel, '#1c1c1e', new THREE.Matrix4().makeTranslation(s * 0.95, 0.85, -0.6).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
    B.addGeometry('plain', small, '#1c1c1e', new THREE.Matrix4().makeTranslation(s * 0.8, 0.5, 1.4).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  }
  wheel.dispose();
  small.dispose();
  f.pop();
}

// ── forestry ──────────────────────────────────────────────────────────────
export function forestry(f: Fab): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const k = styleKit(ctx.style);
  lotGround(f, W, D, 'dirt', col('#7a6448'));
  // sawmill hall
  const hw = clamp(W * 0.5, 16, 30), hd = clamp(D * 0.28, 11, 18);
  const hx = -W / 2 + 2 + hw / 2, hz = -D / 2 + 3 + hd / 2;
  const wood = k.id === 'nordic' || k.id === 'american' || rng.chance(0.5);
  const wc = wood ? pickCol(rng, ['#8a5a3a', '#9a3b2c', '#6f5a44', '#a88a64'], 0.03) : pickCol(rng, ['#b8bdc2', '#9aa4aa', '#c9c4b5']);
  f.fbox(wood ? 'wall_wood' : 'wall_industrial', wood ? facCode(WinKind.Small, 1.6, 0.8, WF.AltBase | WF.BlankGround) : 0, hx, -1.5, hz, hw, hd, 8.5, wc, { fh: wood ? 3.5 : 6, base: 0, top: false, lod: LodFacade.Industrial });
  gableRoof(f, { cx: hx, cz: hz, w: hw, d: hd, y: 7, rise: hd * 0.22, mat: 'roof_metal', color: pickCol(rng, ['#5f666e', '#4a4f57', '#7a3a2e']), wallMat: wood ? 'wall_wood' : 'wall_industrial', wallColor: wc, fh: wood ? 3.5 : 6, overhang: 0.6, trim: shade(wc, 0.8), attic: 0 });
  // conveyor from the log deck into the mill + kiln with steam
  const B = f.m();
  const cz = hz + hd / 2 + 6;
  f.pushTRS(hx + hw * 0.25, 0, (hz + hd / 2 + cz) / 2 + 1, 0);
  const len = cz - hz - hd / 2 + 2;
  const g = new THREE.BoxGeometry(1.2, 0.5, len);
  B.addGeometry('metal', g, '#8a9096', new THREE.Matrix4().makeTranslation(0, 3, 0).multiply(new THREE.Matrix4().makeRotationX(0.18)));
  g.dispose();
  f.pop();
  for (let z = hz + hd / 2 + 1; z < cz; z += 3) B.box('metal', hx + hw * 0.25, GROUND, z, 0.2, 2.6, 0.2, P.steelDark, { top: false });
  const kx = hx + hw / 2 + 6;
  if (kx + 4 < W / 2) {
    f.fbox('wall_concrete', BLANK, kx, -1, hz, 7, hd * 0.8, 7, '#b9b3aa', { fh: 3.5, top: 'roof_metal', topColor: '#6a6e72' });
    stack(f, kx + 2, hz - 2, 0.6, 12, false, 0);
    f.emitter('steam', kx, 6.5, hz, 0.7);
    f.emitter('smoke', kx + 2, 12.8, hz - 2, 0.5);
  }
  // log deck: stacks of logs
  const deckZ0 = hz + hd / 2 + 4, deckZ1 = D / 2 - 8;
  const nStacks = Math.max(2, Math.floor((W - 6) / 9));
  for (let i = 0; i < nStacks; i++) {
    const x = -W / 2 + 5 + i * ((W - 10) / Math.max(1, nStacks - 1));
    for (let z = deckZ0 + 3; z < deckZ1; z += 5) if (rng.chance(0.8)) logStack(f, x, z, rng.range(6, 8), rng.int(2, 4), rng.int(4, 6));
  }
  // lumber stacks (sawn timber)
  for (let i = 0; i < (L >= 3 ? 6 : 3); i++) {
    const x = hx - hw / 2 + 3 + (i % 3) * 5, z = -D / 2 + 3 + hd + 3 + Math.floor(i / 3) * 4;
    if (z > deckZ0) break;
    B.box('wood', x, GROUND, z, 4, rng.range(1.2, 2.4), 2.2, pickCol(rng, ['#c8a070', '#d0aa7a', '#b89060']));
  }
  // wood-chip pile + trucks
  pile(f, W / 2 - 7, -D / 2 + 7, 5, 4, 'dirt', '#a07a4a');
  truck(f, W / 2 - 6, D / 2 - 5, Math.PI / 2, '#3f6a3a', true);
  if (L >= 2) logStack(f, W / 2 - 6, D / 2 - 5.5, 10, 2, 4, 0.28);
  // edge of forest
  for (let i = 0; i < 6; i++) tree(f, -W / 2 + 1.5 + rng.next() * 3, -D / 2 + 2 + i * (D - 4) / 6, rng.range(8, 13), treeKindFor(ctx.theme, rng));
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [W / 2 - 12, D / 2 - 0.4]], 'rail', '#9a8060', 1.2);
  lampPost(f, 0, D / 2 - 10, 8);
  withFace(f, 'S', hx, hz, hw, hd, () => sign(f, 0, 7.2, 0.1, 6, 1.0, '#e6d8b0', 'box'));
}

// ── mining ────────────────────────────────────────────────────────────────
export function mining(f: Fab): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'dirt', col('#8a7a66'));
  // terraced pit: concentric raised terraces around a low floor
  const pw = W * 0.62, pd = D * 0.58;
  const px = -W / 2 + 2 + pw / 2, pz = -D / 2 + 2 + pd / 2;
  const tiers = 4;
  const B = f.m();
  const rock = col('#8f8272'), floor = col('#6f6456');
  for (let t = 0; t < tiers; t++) {
    const ow = pw - t * (pw / (tiers + 1)), od = pd - t * (pd / (tiers + 1));
    const iw = ow - pw / (tiers + 1), id = od - pd / (tiers + 1);
    const y = GROUND + (tiers - t) * 1.2;
    const c = mix(rock, floor, t / tiers).multiplyScalar(0.92 + (t % 2) * 0.1);
    // ring = 4 boxes (top face = bench, inner faces = rock walls)
    const ring = (cx: number, cz: number, w: number, d: number) => B.box('dirt', cx, 0, cz, w, y, d, c, { top: 'dirt', topColor: shade(c, 1.08) });
    ring(px, pz + (od + id) / 4, ow, (od - id) / 2);
    ring(px, pz - (od + id) / 4, ow, (od - id) / 2);
    ring(px + (ow + iw) / 4, pz, (ow - iw) / 2, id);
    ring(px - (ow + iw) / 4, pz, (ow - iw) / 2, id);
  }
  pad(f, 'dirt', px, pz, pw / (tiers + 1) * 1.2, pd / (tiers + 1) * 1.2, '#5f5548', 0.02);
  f.mass(px, pz, pw, pd, 0, tiers * 1.2, rock, rock, LodFacade.None);
  // haul road ramp + haul truck in the pit
  haulTruck(f, px + pw * 0.12, pz, rng.next() * 6);
  if (L >= 2) haulTruck(f, px - pw * 0.3, pz + pd * 0.33, 0.3);
  f.emitter('dust', px, GROUND + 2, pz, 0.8);
  // headframe with spinning sheave wheel (underground workings)
  const hx = W / 2 - 8, hz = -D / 2 + 9;
  headframe(f, hx, hz, L >= 3 ? 26 : 20);
  // processing plant + conveyor + ore piles
  const mx = W / 2 - 9, mz = D / 2 - 12;
  f.fbox('wall_industrial', 0, mx, -1.5, mz, 12, 10, 13.5, pickCol(rng, ['#b8a07a', '#9aa4aa', '#c9b89a']), { fh: 6, base: 0, top: 'roof_metal', topColor: '#6a6e72', lod: LodFacade.Industrial });
  conveyor(f, mx - 6, mz - 3, px + pw / 2 - 2, pz + pd * 0.2, 11, 2);
  for (let i = 0; i < 3; i++) pile(f, -W / 2 + 6 + i * 8, D / 2 - 7, rng.range(3.5, 5), rng.range(3, 5), 'dirt', pickCol(rng, ['#6a6a6e', '#8a6a4a', '#5a5048', '#a08a6a']));
  f.emitter('dust', mx - 8, 3, mz - 2, 0.5);
  silo(f, mx + 8, mz, 2.2, 14, '#9aa0a6');
  truck(f, 0, D / 2 - 6, Math.PI / 2, '#e0a020', true);
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4]], 'chain', '#8a9096', 1.2);
  lampPost(f, px, pz + pd / 2 + 2, 10);
  lampPost(f, mx - 8, mz + 6, 10);
}

function haulTruck(f: Fab, x: number, z: number, rot: number): void {
  if (f.detail === 'low') return;
  f.pushTRS(x, GROUND + 0.4, z, rot);
  const B = f.m();
  B.box('plain', 0, 1.2, 0, 4.2, 1.2, 7.5, '#e0a020');
  B.box('plain', 0, 2.4, -0.8, 4.4, 1.8, 5.5, '#d09018', { top: 'plain', topColor: '#6a5a3a' });
  B.box('glass', -1.2, 2.4, 3.0, 1.6, 1.2, 1.4, '#2a3440');
  const g = new THREE.CylinderGeometry(1.05, 1.05, 0.9, 10);
  for (const [dx, dz] of [[-1.9, 2.4], [1.9, 2.4], [-1.9, -2.2], [1.9, -2.2]]) B.addGeometry('plain', g, '#1c1c1e', new THREE.Matrix4().makeTranslation(dx, 1.05, dz).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  g.dispose();
  f.pop();
}

/** Steel lattice headframe with an animated sheave wheel. */
function headframe(f: Fab, x: number, z: number, h: number): void {
  const B = f.m();
  const c = '#8a3a2a';
  const s = 2.4;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('metal', x + dx * s, GROUND, z + dz * s, 0.35, h, 0.35, c, { top: false });
  if (f.detail !== 'low') for (let y = 3; y < h; y += 3.5) {
    B.box('metal', x, GROUND + y, z + s, s * 2, 0.22, 0.22, c);
    B.box('metal', x, GROUND + y, z - s, s * 2, 0.22, 0.22, c);
    B.box('metal', x + s, GROUND + y, z, 0.22, 0.22, s * 2, c);
    B.box('metal', x - s, GROUND + y, z, 0.22, 0.22, s * 2, c);
  }
  // back-stay leg toward the winder house
  const g = new THREE.BoxGeometry(0.4, h * 1.05, 0.4);
  B.addGeometry('metal', g, c, new THREE.Matrix4().makeTranslation(x - h * 0.25, GROUND + h * 0.48, z).multiply(new THREE.Matrix4().makeRotationZ(-0.5)));
  g.dispose();
  B.box('metal', x, GROUND + h, z, s * 2.6, 0.6, s * 2.6, c);
  f.fbox('wall_brick', facCode(WinKind.Single, 1.4, 2.2, WF.Arched), x - h * 0.55, -1, z, 8, 7, 7.5, '#9a4f3b', { fh: 3.6, top: 'roof_metal', topColor: '#5a5f64' });
  // sheave wheel (spins about X)
  f.anim((b: ModelBuilder) => {
    const w = new THREE.TorusGeometry(1.6, 0.14, 5, 14);
    b.addGeometry('metal', w, '#2a2c30', new THREE.Matrix4().makeTranslation(x, GROUND + h + 1.9, z).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
    w.dispose();
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.BoxGeometry(0.1, 3.1, 0.1);
      b.addGeometry('metal', sp, '#2a2c30', new THREE.Matrix4().makeTranslation(x, GROUND + h + 1.9, z).multiply(new THREE.Matrix4().makeRotationX((i * Math.PI) / 4)));
      sp.dispose();
    }
  }, [x, GROUND + h + 1.9, z], [1, 0, 0], 1.6);
  f.light(x, GROUND + h + 3.8, z, 0xff2a1a, 2, 'beacon', true);
  f.mass(x, z, s * 2, s * 2, 0, h, c, c, LodFacade.None);
  f.reach(h + 3.5);
}

function conveyor(f: Fab, ax: number, az: number, bx: number, bz: number, ha: number, hb: number): void {
  const len = Math.hypot(bx - ax, bz - az);
  const B = f.m();
  f.pushTRS((ax + bx) / 2, 0, (az + bz) / 2, -Math.atan2(bz - az, bx - ax));
  const slope = Math.atan2(ha - hb, len);
  const g = new THREE.BoxGeometry(Math.hypot(len, ha - hb), 1.1, 1.4);
  f.m().addGeometry('metal', g, '#9a9ea2', new THREE.Matrix4().makeTranslation(0, GROUND + (ha + hb) / 2, 0).multiply(new THREE.Matrix4().makeRotationZ(-slope)));
  g.dispose();
  f.pop();
  const n = Math.max(2, Math.floor(len / 7));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    B.box('metal', ax + (bx - ax) * t, GROUND, az + (bz - az) * t, 0.3, ha + (hb - ha) * t - 0.4, 0.3, P.steelDark, { top: false });
  }
}

// ── oil ───────────────────────────────────────────────────────────────────
export function oil(f: Fab): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  lotGround(f, W, D, 'dirt', col(ctx.theme.id === 'desert' ? '#b89a70' : '#8a7a62'));
  // pumpjacks on gravel pads
  const n = L >= 3 ? rng.int(3, 5) : rng.int(2, 3);
  const cols = Math.ceil(Math.sqrt(n * (W / D)));
  const rows = Math.ceil(n / cols);
  let placed = 0;
  for (let j = 0; j < rows && placed < n; j++)
    for (let i = 0; i < cols && placed < n; i++) {
      const x = -W / 2 + (i + 0.5) * (W / cols) + (rng.next() - 0.5) * 3;
      const z = -D / 2 + 4 + (j + 0.5) * ((D * 0.55) / rows);
      pad(f, 'dirt', x, z, 9, 6, '#a09a8c', 0.04);
      pumpjack(f, x, z, rng.chance(0.5) ? 0 : Math.PI, rng.next());
      placed++;
    }
  // tank farm
  const tz = D / 2 - 11;
  const nt = L >= 2 ? rng.int(2, 4) : rng.int(1, 2);
  const tc = pickCol(rng, ['#e8e6e0', '#d8d4c8', '#c9ccce'], 0.02);
  for (let i = 0; i < nt; i++) tank(f, -W / 2 + 7 + i * 10, tz, 4, rng.range(6, 9), tc, 'dome');
  // pipes from wells to tanks
  pipe(f, -W / 2 + 4, tz - 6, W / 2 - 4, tz - 6, 1.2, 0.25, '#8a8070');
  // flare stack with flame
  const fx = W / 2 - 5, fz = -D / 2 + 5;
  flare(f, fx, fz, L >= 3 ? 22 : 16);
  // derrick on higher levels
  if (L >= 3) derrick(f, W / 2 - 10, tz - 2, 24);
  // site office
  f.fbox('wall_industrial', facCode(WinKind.Single, 1.6, 1.2, 0), W / 2 - 8, -1, D / 2 - 5, 8, 4, 4, '#e8e6e0', { fh: 3, base: 0, top: 'roof_metal', topColor: '#9aa0a4' });
  truck(f, 0, D / 2 - 4, Math.PI / 2, '#d8d4c8', true);
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4]], 'chain', '#8a9096', 1.2);
  lampPost(f, 0, tz - 3, 9);
}

/** Animated pumpjack: walking beam + horse head rock, crank counterweights spin. */
function pumpjack(f: Fab, x: number, z: number, rot: number, phase: number): void {
  f.pushTRS(x, GROUND, z, rot);
  const B = f.m();
  const c = f.rng.pick(['#3f6a8a', '#c49a3a', '#6a6e72', '#8a3a2a']);
  B.box('concrete', 0, 0, 0, 2.6, 0.35, 7.5, '#a8a298');
  // samson post (A-frame)
  const g = new THREE.BoxGeometry(0.3, 4.4, 0.3);
  B.addGeometry('metal', g, c, new THREE.Matrix4().makeTranslation(-0.7, 2.4, 0.3).multiply(new THREE.Matrix4().makeRotationZ(-0.16)));
  B.addGeometry('metal', g, c, new THREE.Matrix4().makeTranslation(0.7, 2.4, 0.3).multiply(new THREE.Matrix4().makeRotationZ(0.16)));
  g.dispose();
  B.box('metal', 0, 0.35, -2.5, 1.4, 1.2, 1.6, '#4a4e52'); // gearbox
  B.box('metal', 0, 0.35, 3.0, 0.3, 0.9, 0.3, '#5a5e62'); // wellhead
  const pivotY = 4.6;
  // walking beam + horse head (rocks about X)
  f.anim((b) => {
    b.box('metal', 0, pivotY - 0.25, 0, 0.45, 0.5, 6.4, c);
    b.box('metal', 0, pivotY - 1.3, 3.0, 0.5, 1.9, 0.9, c);
    b.box('metal', 0, pivotY - 0.9, -3.1, 0.6, 0.6, 0.6, '#3a3d40');
  }, [0, pivotY, 0.3], [1, 0, 0], 1.3, 0.32, phase * 6.28);
  // crank with counterweights (spins about X)
  f.anim((b) => {
    b.box('metal', -0.85, 1.35 - 1.1, -2.5, 0.25, 2.2, 0.9, '#2e3134');
    b.box('metal', 0.85, 1.35 - 1.1, -2.5, 0.25, 2.2, 0.9, '#2e3134');
  }, [0, 1.35, -2.5], [1, 0, 0], 1.3, 0, phase * 6.28);
  f.pop();
  f.mass(x, z, 1.4, 6.5, 0, 4.8, c, c, LodFacade.None);
}

function flare(f: Fab, x: number, z: number, h: number): void {
  const B = f.m();
  B.cylinder('metal', x, GROUND, z, 0.45, 0.35, h, '#b8b2a8', 8, {});
  for (const [dx, dz] of [[-2, -2], [2, -2], [0, 2.5]]) {
    const g = new THREE.CylinderGeometry(0.04, 0.04, Math.hypot(h * 0.7, 2.8), 3, 1, true);
    const a = Math.atan2(Math.hypot(dx, dz), h * 0.7);
    const m = new THREE.Matrix4().makeTranslation(x + dx / 2, GROUND + h * 0.35, z + dz / 2).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(dz, 0, -dx).normalize(), -a));
    B.addGeometry('metal', g, '#6a6e72', m);
    g.dispose();
  }
  // flame (neon glows and flickers at night; emissive orange by day)
  B.cylinder('neon', x, GROUND + h, z, 0.45, 0.05, 2.8, '#ff7a1a', 6, { top: false });
  B.cylinder('neon', x + 0.2, GROUND + h + 0.5, z, 0.25, 0.02, 3.4, '#ffc040', 5, { top: false });
  f.light(x, GROUND + h + 1.6, z, 0xff8a2a, 9, 'flood');
  f.emitter('smoke', x, GROUND + h + 3.2, z, 0.5);
  f.mass(x, z, 1, 1, 0, h + 2, '#b8b2a8', '#ff7a1a', LodFacade.None);
  f.reach(h + 4);
}

function derrick(f: Fab, x: number, z: number, h: number): void {
  const B = f.m();
  const c = '#c9a040';
  const b0 = 3.2, b1 = 0.6;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const g = new THREE.BoxGeometry(0.28, Math.hypot(h, b0 - b1), 0.28);
    const lean = Math.atan2(b0 - b1, h);
    const m = new THREE.Matrix4().makeTranslation(x + dx * (b0 + b1) / 2, GROUND + h / 2, z + dz * (b0 + b1) / 2).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(dz, 0, -dx).normalize(), lean));
    B.addGeometry('metal', g, c, m);
    g.dispose();
  }
  if (f.detail !== 'low') for (let y = 3; y < h; y += 3) {
    const s = b0 - (b0 - b1) * (y / h);
    B.box('metal', x, GROUND + y, z + s, s * 2, 0.16, 0.16, c);
    B.box('metal', x, GROUND + y, z - s, s * 2, 0.16, 0.16, c);
    B.box('metal', x + s, GROUND + y, z, 0.16, 0.16, s * 2, c);
    B.box('metal', x - s, GROUND + y, z, 0.16, 0.16, s * 2, c);
  }
  B.box('metal', x, GROUND, z, 8, 1.2, 8, '#6a6e72');
  B.box('metal', x, GROUND + h, z, 2, 0.8, 2, c);
  f.light(x, GROUND + h + 1, z, 0xff2a1a, 2, 'beacon', true);
  f.mass(x, z, b0 * 1.4, b0 * 1.4, 0, h, c, c, LodFacade.None);
  f.reach(h + 1);
}

