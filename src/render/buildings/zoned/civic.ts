// Generic civic fallback model: used for service / landmark buildings whose
// model key has no registered generator. Reads the BuildingDef category and
// height to pick a dignified public building, a utility compound or a park.
import type { ModelContext } from '../types';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { Fab, type ZModel } from './fab';
import { block } from './blocks';
import {
  GROUND, antenna, dome, fence, gableRoof, lampPost, lotGround, pad, parking, sawtoothRoof, shrubs, sign, stack, tank, tree, withFace,
} from './parts';
import { lawnColor, treeKindFor } from './residential';
import { lightTrim, styleKit, wallColor } from './style';
import { P, clamp, col, hueCol, shade } from './util';

const CAT_HUE: Record<string, number> = {
  power: 0.13, water: 0.55, garbage: 0.3, health: 0.0, deathcare: 0.75, fire: 0.02, police: 0.62, education: 0.08, parks: 0.33, plazas: 0.1,
  transit: 0.58, government: 0.6, disaster: 0.06, landmark: 0.12, monument: 0.12, tourism: 0.85, industry: 0.1,
};

export function civicFallback(ctx: ModelContext): ZModel {
  const f = new Fab(ctx);
  const cat = ctx.def?.category ?? 'government';
  if (cat === 'parks' || cat === 'plazas') park(f, cat === 'plazas');
  else if (cat === 'power' || cat === 'water' || cat === 'garbage' || cat === 'industry') utility(f, CAT_HUE[cat] ?? 0.1);
  else publicBuilding(f, CAT_HUE[cat] ?? 0.6);
  return f.finish(ctx.def?.height ?? 6);
}

function publicBuilding(f: Fab, hue: number): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, 'paving', col(P.pavingWarm));
  const hTarget = clamp(ctx.def?.height ?? 12, 5, 120);
  const classical = k.id === 'european' || k.id === 'american' || k.id === 'artdeco' || k.id === 'mediterranean';
  const mat = classical ? (k.id === 'mediterranean' ? 'wall_plaster' : 'wall_stone') : k.id === 'futuristic' || k.id === 'modern' ? 'wall_glass' : 'wall_concrete';
  const wc = wallColor(k, mat, rng);
  const lt = lightTrim(k, rng);
  const fh = 4.2;
  const floors = clamp(Math.round(hTarget / fh), 1, 24);
  const bw = W - rng.range(4, 8), bd = clamp(D * 0.6, 10, D - 8);
  const bz = D / 2 - 5 - bd / 2 - (D > 40 ? 3 : 0);
  const code = mat === 'wall_glass' ? facCode(WinKind.Auto, 0, 2.6, 0) : facCode(WinKind.Single, 1.3, 2.6, WF.Surround | WF.DarkFrame);
  f.m().box('wall_stone', 0, -1.5, bz, bw + 1.2, 2.2, bd + 1.2, shade(lt, 0.85), { top: 'paving', topColor: lt });
  const y0 = 0.7;
  const out = block(f, { cx: 0, cz: bz, w: bw, d: bd, y0, floors, fh, mat, color: wc, code, roof: 'flat', parapet: 1.2, cornice: lt, richCornice: classical, flatColor: '#7a776f', lod: LodFacade.Punched });
  // entrance: portico with pediment (classical) or glass canopy
  withFace(f, 'S', 0, bz, bw, bd, (len) => {
    const B = f.m();
    for (let s = 0; s < 4; s++) B.box('wall_stone', 0, 0, 0.9 + (3 - s) * 0.45 + 0.5, Math.min(len * 0.5, 14) + (3 - s) * 0.8, GROUND + 0.18 * (s + 1), 0.5, lt);
    if (classical) {
      const pw = Math.min(len * 0.5, 14), pd = 3.2;
      const colH = Math.min(out.eave - y0 - 0.8, fh * 2.2);
      const n = Math.max(4, Math.round(pw / 2.4));
      for (let i = 0; i < n; i++) B.cylinder('plain', -pw / 2 + 0.5 + (i / (n - 1)) * (pw - 1), y0, pd - 0.4, 0.38, 0.33, colH, lt, 10);
      B.box('plain', 0, y0 + colH, pd / 2, pw + 0.4, 0.9, pd + 0.2, lt, { bottom: true });
      f.pushTRS(0, 0, pd / 2, 0);
      gableRoof(f, { cx: 0, cz: 0, w: pw + 0.4, d: pd + 0.2, y: y0 + colH + 0.9, rise: Math.min(2.6, pw * 0.16), mat: 'roof_metal', color: shade(lt, 0.85), wallMat: 'plain', wallColor: lt, alongX: false, overhang: 0.2, trim: lt, attic: 0 });
      f.pop();
    } else {
      B.box('glass', 0, y0, 1.2, Math.min(len * 0.4, 12), 4.2, 2.4, '#9fc0cc');
      B.box('plain', 0, y0 + 4.2, 2.0, Math.min(len * 0.5, 15), 0.3, 4.2, '#e8e8e4', { bottom: true });
    }
    sign(f, 0, out.eave - 1.6, 0.2, Math.min(len * 0.4, 10), 0.9, hueCol(hue, 0.55, 0.45), 'box');
    f.light(0, y0 + 3.5, 4.5, 0xffe2b0, 6, 'flood');
  });
  // crown: dome / clock tower / antenna
  if (hTarget > 14 && classical) dome(f, 0, out.eave + 1.2, bz, Math.min(bw, bd) * 0.22, 'roof_metal', k.id === 'artdeco' ? P.gold : P.copper, lt);
  else if (hTarget > 14) antenna(f, 0, out.eave + 1.2, bz, 8, true);
  // flagpole + trees + lamps
  const B = f.m();
  B.cylinder('metal', W / 2 - 3, GROUND, D / 2 - 3, 0.07, 0.05, 11, '#d0d4d8', 5, {});
  B.box('plain', W / 2 - 3 + 1.1, GROUND + 9.2, D / 2 - 3, 2.2, 1.4, 0.03, hueCol(hue, 0.7, 0.45));
  for (const s of [-1, 1]) {
    tree(f, s * (W / 2 - 3), D / 2 - 7, rng.range(6, 9), treeKindFor(ctx.theme, rng));
    lampPost(f, s * 4.5, D / 2 - 2, 5);
  }
  if (bz - bd / 2 + D / 2 > 10) parking(f, 0, (bz - bd / 2 - D / 2) / 2, W - 3, bz - bd / 2 + D / 2 - 2, true, 0.5, false);
}

function utility(f: Fab, hue: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, 'concrete', col(P.concrete));
  const hw = clamp(W * 0.55, 12, 40), hd = clamp(D * 0.45, 10, 30);
  const hz = -D / 2 + 3 + hd / 2;
  const wc = col(rng.pick(['#c9ccce', '#b8bdc2', '#d8d6cf']));
  f.fbox('wall_industrial', 0, -W / 2 + 3 + hw / 2, -1.5, hz, hw, hd, 11.5, wc, { fh: 6, base: 0, top: false, lod: LodFacade.Industrial });
  sawtoothRoof(f, -W / 2 + 3 + hw / 2, hz, hw, hd, 10, Math.max(2, Math.round(hd / 7)), '#8a9096');
  const th = clamp(ctx.def?.height ?? 20, 8, 60);
  stack(f, W / 2 - 5, -D / 2 + 5, 1.4, th, true, 0.6);
  tank(f, W / 2 - 6, D / 2 - 8, Math.min(5, W * 0.1), 8, '#e0dcd2', 'dome');
  withFace(f, 'S', -W / 2 + 3 + hw / 2, hz, hw, hd, () => sign(f, 0, 8, 0.05, 6, 1.2, hueCol(hue, 0.6, 0.45), 'box'));
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4]], 'chain', '#8a9096', 1.3);
  lampPost(f, 0, D / 2 - 5, 8);
}

function park(f: Fab, plaza: boolean): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  lotGround(f, W, D, plaza ? 'paving' : 'grass', plaza ? col(P.pavingWarm) : lawnColor(ctx.theme, rng));
  pad(f, 'paving', 0, 0, W - 2, 2.4, '#d8cdb8');
  pad(f, 'paving', 0, 0, 2.4, D - 2, '#d8cdb8');
  const B = f.m();
  B.cylinder('concrete', 0, GROUND, 0, 3.2, 3.2, 0.5, '#d6d0c4', 16);
  B.cylinder('water', 0, GROUND + 0.42, 0, 2.9, 2.9, 0.1, P.pool, 16);
  f.emitter('fountain', 0, GROUND + 1.2, 0, 0.8);
  const n = Math.round((W * D) / 90);
  for (let i = 0; i < n; i++) {
    const x = (rng.next() - 0.5) * (W - 4), z = (rng.next() - 0.5) * (D - 4);
    if (Math.abs(x) < 3 || Math.abs(z) < 3) continue;
    tree(f, x, z, rng.range(5, 9), treeKindFor(ctx.theme, rng));
  }
  shrubs(f, 0, 0, W - 6, D - 6, Math.round(W / 2));
  for (const [x, z] of [[-4, -4], [4, 4], [-4, 4], [4, -4]]) lampPost(f, x, z, 4.5);
}
