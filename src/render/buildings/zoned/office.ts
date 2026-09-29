// Office generators: curtain-wall and punched-window towers up to ~60 floors
// with lobbies, plazas, setbacks and crowns — art deco stepped crowns and
// spires, modern slanted tops, rounded / tapered / twisted futuristic forms.
import type { RNG } from '../../../core/rng';
import type { MatKey } from '../types';
import { LodFacade, WF, WinKind, facCode } from './constants';
import { type Fab, type P2, ring, roundRect, xformPoly } from './fab';
import { floorBands, piers } from './blocks';
import { GROUND, antenna, cornice, flatRoof, greenRoof, helipad, hipRoof, lampPost, lotGround, pad, pagodaRoof, roofClutter, shrubs, sign, tree, withFace } from './parts';
import { artDecoCrown, treeKindFor } from './residential';
import { type StyleKit, lightTrim, pickWall, roofColor, styleKit, towerWindows, wallColor } from './style';
import { P, type Col, clamp, col, hueCol, shade } from './util';

type Shape = 'box' | 'round' | 'ellipse' | 'twist' | 'taper' | 'stepped';
type Crown = 'flat' | 'deco' | 'slant' | 'pyramid' | 'spire' | 'ledband' | 'pagoda' | 'garden' | 'helipad' | 'lantern';

function pickShape(k: StyleKit, rng: RNG, floors: number): Shape {
  switch (k.id) {
    case 'futuristic': return rng.pick(['twist', 'taper', 'ellipse', 'round'] as Shape[]);
    case 'artdeco': return floors > 12 ? 'stepped' : 'box';
    case 'modern': return rng.pick(['box', 'box', 'round', 'taper'] as Shape[]);
    case 'european': return rng.pick(['box', 'round', 'ellipse', 'box'] as Shape[]);
    case 'asian': return rng.pick(['box', 'stepped', 'round'] as Shape[]);
    default: return floors > 25 && rng.chance(0.4) ? 'stepped' : rng.chance(0.2) ? 'round' : 'box';
  }
}

function pickCrown(k: StyleKit, rng: RNG, floors: number, shape: Shape): Crown {
  if (shape === 'twist' || shape === 'taper') return rng.pick(['spire', 'garden', 'ledband'] as Crown[]);
  switch (k.id) {
    case 'artdeco': return 'deco';
    case 'modern': return rng.pick(['slant', 'lantern', 'garden', 'ledband'] as Crown[]);
    case 'asian': return floors > 15 ? rng.pick(['pagoda', 'ledband', 'spire'] as Crown[]) : 'flat';
    case 'american': return floors > 20 ? rng.pick(['pyramid', 'spire', 'lantern', 'helipad'] as Crown[]) : rng.pick(['flat', 'lantern'] as Crown[]);
    case 'european': return rng.pick(['lantern', 'slant', 'ledband', 'garden'] as Crown[]);
    case 'nordic': return rng.pick(['slant', 'flat', 'pyramid'] as Crown[]);
    case 'mediterranean': return rng.pick(['lantern', 'garden', 'ledband'] as Crown[]);
    default: return rng.pick(['spire', 'ledband', 'helipad'] as Crown[]);
  }
}

export function office(f: Fab): void {
  const { ctx, rng } = f;
  const k = styleKit(ctx.style);
  const W = ctx.width, D = ctx.depth, L = ctx.level;
  const lotCells = (W / 16) * (D / 16);
  const byLevel = [0, rng.int(4, 7), rng.int(8, 14), rng.int(14, 24), rng.int(22, 40), rng.int(35, 60)][L] ?? 6;
  const cap = lotCells <= 4 ? 30 : lotCells <= 6 ? 42 : 60;
  const floors = Math.min(byLevel, cap);
  const fh = rng.range(3.8, 4.2);
  lotGround(f, W, D, 'paving', col(rng.chance(0.5) ? P.pavingWarm : P.paving));

  const mat: MatKey = pickWall(k, 'office', rng);
  const wc = wallColor(k, mat, rng);
  const code = towerWindows(k, mat, rng, true);
  const lt = lightTrim(k, rng);
  const shape = floors <= 6 && k.id !== 'futuristic' ? 'box' : pickShape(k, rng, floors);
  const crown = floors <= 8 ? (k.id === 'modern' && rng.chance(0.5) ? 'garden' : 'flat') : pickCrown(k, rng, floors, shape);

  // footprint
  const tw = clamp(W * rng.range(0.58, 0.8), 14, W - 4);
  const td = clamp(D * rng.range(0.5, 0.72), 13, D - 8);
  const tx = (rng.next() - 0.5) * (W - tw - 4) * 0.5;
  const tz = D / 2 - rng.range(6, Math.max(7, D - td - 2)) - td / 2;
  const lobbyH = fh * 1.6;
  const H = lobbyH + (floors - 1) * fh;

  // lobby: recessed glazed double-height base with a colonnade
  const inset = 1.2;
  const basePts = shape === 'round' || shape === 'ellipse' || shape === 'twist' || shape === 'taper' ? footprint(shape, tx, tz, tw, td) : rectPoly(tx, tz, tw, td);
  const lobbyPts = xformPoly(basePts, tx, tz, 0, 1 - inset / Math.min(tw, td) * 2);
  f.fprism('wall_glass', facCode(WinKind.Auto, 0, 3.6, 0), lobbyPts, -1.5, lobbyH + 1.5, '#b6cfda', { fh: lobbyH, base: 0, top: false, continuous: shape !== 'box' && shape !== 'stepped', lod: LodFacade.Glass, lodRoof: wc });
  // columns under the overhang
  const B = f.m();
  const cols = shape === 'box' || shape === 'stepped' ? rectCols(tx, tz, tw, td, 6.5) : ringCols(basePts, 6.5);
  for (const [x, z] of cols) B.cylinder('concrete', x, GROUND, z, 0.38, 0.38, lobbyH, shade(lt, 0.95), 8, {});
  // soffit over the colonnade
  f.m().cap('plain', basePts, lobbyH, shade(lt, 0.8), true);

  // shaft
  let top = lobbyH;
  let topPts = basePts;
  const shaftCode = code;
  if (shape === 'twist' || shape === 'taper') {
    const segs = Math.max(5, Math.round(floors / 3));
    const twist = shape === 'twist' ? rng.range(0.6, 1.3) * (rng.chance(0.5) ? 1 : -1) : 0;
    const taper = shape === 'taper' ? rng.range(0.35, 0.55) : rng.range(0.1, 0.22);
    let prev = basePts;
    for (let s = 0; s < segs; s++) {
      const t1 = (s + 1) / segs;
      const next = xformPoly(basePts, tx, tz, twist * t1, 1 - taper * t1);
      f.loft('wall_glass', shaftCode, prev, lobbyH + (s / segs) * (H - lobbyH), next, lobbyH + t1 * (H - lobbyH), wc, { fh, base: lobbyH, vBase: 3.3 });
      prev = next;
    }
    topPts = prev;
    top = H;
    f.m().cap('roof_flat', topPts, H, '#4d555c');
    f.mass(tx, tz, tw * (1 - taper * 0.5) * 0.85, td * (1 - taper * 0.5) * 0.85, lobbyH, H - lobbyH, wc, '#4d555c', LodFacade.Glass);
    if (f.detail !== 'low') {
      // sky-garden rings every ~12 floors
      for (let s = 1; s < segs; s++) {
        if (s % 4 !== 0) continue;
        const t = s / segs;
        const r = xformPoly(basePts, tx, tz, twist * t, (1 - taper * t) * 1.04);
        const y = lobbyH + t * (H - lobbyH);
        f.m().cap('grass', r, y + 0.02, '#5f8f3e');
        f.m().prismWalls('neon', r, y - 0.18, y + 0.02, hueCol(rng.pick([0.5, 0.52, 0.85])));
      }
    }
  } else if (shape === 'stepped') {
    const tiers = floors > 30 ? 4 : 3;
    let w = tw, d = td, left = floors - 1, y = lobbyH;
    for (let t = 0; t < tiers; t++) {
      const fl = t === tiers - 1 ? left : Math.max(2, Math.round((floors - 1) * [0.45, 0.25, 0.15, 0.1][t]));
      left -= fl;
      f.fbox(mat, shaftCode, tx, y, tz, w, d, fl * fh, wc, { fh, base: lobbyH, vBase: 3.3, top: 'roof_flat', topColor: '#6f6c66' });
      if (k.id === 'artdeco') {
        for (const face of ['S', 'N', 'E', 'W'] as const) withFace(f, face, tx, tz, w, d, (len) => piers(f, -len / 2 + 0.3, len / 2 - 0.3, 0, y, y + fl * fh + 0.9, Math.max(3, Math.round(len / 3.2)), 0.4, lt, 0.3));
      }
      y += fl * fh;
      if (t < tiers - 1) {
        cornice(f, tx, tz, w, d, y - 0.3, 0.45, 0.25, lt);
        flatRoof(f, tx, tz, w, d, y, 1.1, mat, wc, '#6f6c66', lt);
        w *= 0.76;
        d *= 0.76;
      }
    }
    topPts = rectPoly(tx, tz, w, d);
    top = y;
  } else {
    const pts = shape === 'box' ? rectPoly(tx, tz, tw, td) : basePts;
    f.fprism(mat, shaftCode, pts, lobbyH, H - lobbyH, wc, { fh, base: lobbyH, vBase: 3.3, top: 'roof_flat', topColor: '#6f6c66', continuous: shape !== 'box' });
    topPts = pts;
    top = H;
    // vertical fins / mullion expression on punched & stone facades, spandrel bands on glass
    if (shape === 'box') {
      if (mat === 'wall_glass') floorBands(f, tx, tz, tw, td, lobbyH, floors - 1, fh, 0.14, 0.06, rng.chance(0.5) ? '#2e3338' : '#c9ccce', rng.chance(0.5) ? 1 : 2);
      else if (k.id === 'mediterranean' || k.id === 'modern' || (k.id === 'asian' && rng.chance(0.5))) {
        for (const face of ['S', 'E', 'N', 'W'] as const) withFace(f, face, tx, tz, tw, td, (len) => piers(f, -len / 2 + 0.2, len / 2 - 0.2, 0, lobbyH, H, Math.max(3, Math.round(len / 1.6)), 0.12, k.id === 'modern' ? '#8a6a4a' : lt, 0.6));
      }
    }
  }

  // crown
  const tb = bounds(topPts);
  const cw = tb[2] - tb[0], cd = tb[3] - tb[1], ccx = (tb[0] + tb[2]) / 2, ccz = (tb[1] + tb[3]) / 2;
  switch (crown) {
    case 'deco':
      flatRoof(f, ccx, ccz, cw, cd, top, 1.2, mat, wc, '#6f6c66', lt);
      artDecoCrown(f, ccx, ccz, cw * 0.9, cd * 0.9, top, lt, rng);
      break;
    case 'slant': {
      const rise = Math.min(cw, cd) * rng.range(0.35, 0.6);
      wedge(f, mat, shaftCode, ccx, ccz, cw, cd, top, rise, wc, fh, lobbyH, rng.chance(0.5));
      break;
    }
    case 'pyramid': {
      f.fbox(mat, shaftCode, ccx, top, ccz, cw * 0.8, cd * 0.8, fh * 2, wc, { fh, base: lobbyH, vBase: 3.3, top: false });
      cornice(f, ccx, ccz, cw, cd, top - 0.2, 0.4, 0.3, lt);
      hipRoof(f, { cx: ccx, cz: ccz, w: cw * 0.8, d: cd * 0.8, y: top + fh * 2, rise: Math.min(cw, cd) * 0.55, mat: k.id === 'nordic' ? 'roof_metal' : 'glass', color: k.id === 'nordic' ? '#2f3236' : '#8fb4c8', overhang: 0.3, trim: lt });
      antenna(f, ccx, top + fh * 2 + Math.min(cw, cd) * 0.55, ccz, 10, true);
      f.light(ccx, top + fh * 2 + 1, ccz, 0xfff2d0, Math.min(cw, cd) * 0.6, 'flood');
      break;
    }
    case 'spire': {
      flatRoof(f, ccx, ccz, cw, cd, top, 1.2, mat, wc, '#5a5f64', lt);
      const sh = clamp(H * rng.range(0.12, 0.22), 12, 60);
      const Bm = f.m();
      Bm.cylinder('metal', ccx, top, ccz, Math.min(cw, cd) * 0.18, 0.3, sh * 0.35, '#b8c0c8', 8);
      Bm.cylinder('metal', ccx, top + sh * 0.35, ccz, 0.35, 0.05, sh * 0.65, '#d8dde2', 6);
      f.light(ccx, top + sh, ccz, 0xff2a1a, 2.6, 'beacon', true);
      f.light(ccx, top + sh * 0.35, ccz, 0xeaf2ff, 3.5, 'flood');
      f.reach(top + sh);
      break;
    }
    case 'ledband': {
      const bandH = Math.min(6, fh * 1.5);
      const c = hueCol(rng.pick([0.52, 0.58, 0.6, 0.85, 0.12]), 0.7, 0.55);
      f.m().prismWalls('emissive', xformPoly(topPts, ccx, ccz, 0, 1.01), top - bandH, top - bandH + 0.5, c);
      f.m().prismWalls('emissive', xformPoly(topPts, ccx, ccz, 0, 1.01), top - 0.6, top, c);
      f.m().cap('roof_flat', topPts, top + 0.02, '#5a5f64');
      roofClutter(f, ccx, ccz, cw * 0.7, cd * 0.7, top, { hvac: 3, antenna: rng.chance(0.5) ? 12 : 0, beacon: true });
      break;
    }
    case 'pagoda': {
      flatRoof(f, ccx, ccz, cw, cd, top, 0.5, mat, wc, '#5a5f64', lt);
      pagodaRoof(f, { cx: ccx, cz: ccz, w: cw * 0.7, d: cd * 0.7, y: top + 0.5, rise: Math.min(cw, cd) * 0.3, mat: 'roof_tile', color: roofColor(k, 'roof_tile', rng), overhang: 1.6, wallMat: 'wall_glass', wallColor: wc }, 2);
      f.light(ccx, top + 4, ccz, 0xffd08a, Math.min(cw, cd) * 0.7, 'flood');
      break;
    }
    case 'garden':
      flatRoof(f, ccx, ccz, cw, cd, top, 1.1, mat, wc, '#6f6c66', lt);
      if (shape === 'box' || shape === 'stepped') greenRoof(f, ccx, top, ccz, cw - 2, cd - 2, 3);
      break;
    case 'helipad':
      flatRoof(f, ccx, ccz, cw, cd, top, 1.2, mat, wc, '#5a5f64', lt);
      helipad(f, ccx, top + 1.2, ccz, Math.min(cw, cd) * 0.8);
      break;
    case 'lantern': {
      // set-back glass lantern (plant room screen) with a lit crown band
      if (shape === 'box' || shape === 'stepped') flatRoof(f, ccx, ccz, cw, cd, top, 0.9, mat, wc, '#5a5f64', lt);
      else f.m().cap('roof_flat', topPts, top + 0.02, '#5a5f64');
      const lw = cw * 0.7, ld = cd * 0.7, lh = fh * rng.range(1.8, 2.8);
      f.fbox('wall_glass', facCode(WinKind.Ribbon, 0, Math.min(3.9, lh - 0.6), WF.DarkFrame), ccx, top, ccz, lw, ld, lh, rng.pick(['#9cc4d4', '#a9b8c0', '#b7c9b8']), { fh: lh, base: top, top: 'roof_flat', topColor: '#4a4f54' });
      f.m().prismWalls('emissive', rectPoly(ccx, ccz, lw + 0.16, ld + 0.16), top + lh - 0.55, top + lh + 0.05, rng.chance(0.6) ? '#f4f0e6' : hueCol(rng.pick([0.55, 0.6, 0.12]), 0.6, 0.6));
      f.light(ccx, top + lh * 0.6, ccz, 0xeaf6ff, Math.min(lw, ld) * 0.7, 'flood');
      if (floors > 30) antenna(f, ccx, top + lh, ccz, rng.range(8, 18), true);
      f.reach(top + lh);
      break;
    }
    default:
      if (shape === 'box' || shape === 'stepped') {
        flatRoof(f, ccx, ccz, cw, cd, top, 1.2, mat, wc, '#6f6c66', lt);
        roofClutter(f, ccx, ccz, cw, cd, top, { hvac: rng.int(2, 4), bulkhead: { mat, color: wc }, antenna: floors > 12 && rng.chance(0.5) ? rng.range(8, 16) : 0, beacon: true, solar: k.id === 'nordic' || k.id === 'modern' });
      } else f.m().cap('roof_flat', topPts, top + 0.02, '#5a5f64');
  }
  if (floors >= 16) {
    // aviation obstruction lights at the roof corners
    for (const [x, z] of [[tb[0], tb[1]], [tb[2], tb[3]]]) f.light(x, top + 1.4, z, 0xff2a1a, 2.2, 'beacon', true);
  }

  // corporate sign on the lobby canopy
  withFace(f, 'S', tx, tz, tw, td, (len) => {
    const Bm = f.m();
    Bm.box('plain', 0, lobbyH - 0.4, 1.8, Math.min(10, len * 0.4), 0.4, 3.6, lt, { bottom: true });
    Bm.box('emissive', 0, lobbyH - 0.42, 1.8, Math.min(9.4, len * 0.38), 0.02, 3.2, '#fff4e0', { top: false, bottom: true, sides: { n: false, e: false, s: false, w: false } });
    sign(f, 0, lobbyH + 0.2, 1.0, Math.min(8, len * 0.3), 0.9, rng.chance(0.5) ? '#f2f2f0' : hueCol(rng.next(), 0.6, 0.5), 'box');
    f.light(0, lobbyH - 0.8, 3, 0xfff0d6, 5, 'flood');
  });
  plaza(f, k, tx, tz, tw, td);
}

/** Plaza in front of the tower: paving, planters, trees, fountain, lamps. */
function plaza(f: Fab, k: StyleKit, tx: number, tz: number, tw: number, td: number): void {
  const { ctx, rng } = f;
  const W = ctx.width, D = ctx.depth;
  const z0 = tz + td / 2 + 2, z1 = D / 2 - 1;
  if (z1 - z0 > 4) {
    const pw = Math.min(W - 4, tw + 6);
    pad(f, 'paving', tx, (z0 + z1) / 2, pw, z1 - z0, k.id === 'artdeco' ? '#d8c9a8' : '#cfc9bd', 0.04);
    if (z1 - z0 > 9 && rng.chance(0.6)) {
      const fx = tx + (rng.chance(0.5) ? -1 : 1) * pw * 0.25, fz = (z0 + z1) / 2;
      const B = f.m();
      B.cylinder('concrete', fx, GROUND, fz, 3, 3, 0.5, '#d6d0c4', 16);
      B.cylinder('water', fx, GROUND + 0.4, fz, 2.7, 2.7, 0.12, P.pool, 16);
      B.cylinder('concrete', fx, GROUND, fz, 0.4, 0.3, 1.4, '#d6d0c4', 8);
      f.emitter('fountain', fx, GROUND + 1.4, fz, 0.8);
      f.light(fx, GROUND + 0.8, fz, 0x9fe8ff, 5, 'flood');
    }
    const nT = Math.max(2, Math.floor(pw / 8));
    for (let i = 0; i < nT; i++) {
      const x = tx - pw / 2 + (i + 0.5) * (pw / nT);
      const z = z1 - 1.5;
      f.m().box('concrete', x, GROUND, z, 1.8, 0.6, 1.8, '#b8b2a6', { top: 'dirt', topColor: '#4f3e2c' });
      f.pushTRS(0, 0.5, 0);
      tree(f, x, z, rng.range(6, 9), treeKindFor(ctx.theme, rng));
      f.pop();
    }
    if (f.detail !== 'low') shrubs(f, tx, z0 + 1, pw * 0.8, 1, Math.round(pw / 3));
    lampPost(f, tx - pw / 2 + 1, z1 - 3.5, 5);
    lampPost(f, tx + pw / 2 - 1, z1 - 3.5, 5);
  }
  // service / parking behind
  const back = tz - td / 2 - 1;
  if (back + D / 2 > 6) pad(f, 'asphalt', 0, (back - D / 2) / 2, W - 2, back + D / 2 - 1, P.asphalt, 0.02);
}

/** Wedge (slanted) roof volume: walls rising to an inclined glass top. */
function wedge(f: Fab, mat: MatKey, code: number, cx: number, cz: number, w: number, d: number, y: number, rise: number, color: Col, fh: number, base: number, alongX: boolean): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  // slope rises toward -Z (back) or +X
  const hAt = (x: number, z: number) => y + (alongX ? ((x - x0) / w) * rise : ((z1 - z) / d) * rise);
  const vs = 3.3 / fh;
  const W = f.m(code);
  const quadWall = (ax: number, az: number, bx: number, bz: number) => {
    const ha = hAt(ax, az), hb = hAt(bx, bz);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 3.2));
    const us = (n * 3.2) / len;
    const out = { x: -(bz - az), y: 0, z: bx - ax };
    W.quad(mat, { x: ax, y, z: az }, { x: bx, y, z: bz }, { x: bx, y: hb, z: bz }, { x: ax, y: ha, z: az }, [[0, (y - base) * vs + 3.3], [len * us, (y - base) * vs + 3.3], [len * us, (hb - base) * vs + 3.3], [0, (ha - base) * vs + 3.3]], color, out);
  };
  quadWall(x0, z1, x1, z1);
  quadWall(x1, z1, x1, z0);
  quadWall(x1, z0, x0, z0);
  quadWall(x0, z0, x0, z1);
  const B = f.m();
  const len = alongX ? Math.hypot(w, rise) : Math.hypot(d, rise);
  B.quad('glass', { x: x0, y: hAt(x0, z1), z: z1 }, { x: x1, y: hAt(x1, z1), z: z1 }, { x: x1, y: hAt(x1, z0), z: z0 }, { x: x0, y: hAt(x0, z0), z: z0 }, [[0, 0], [w, 0], [w, len], [0, len]], '#8fb4c8', { x: alongX ? -rise / w : 0, y: 1, z: alongX ? 0 : rise / d });
  f.mass(cx, cz, w, d, y, rise * 0.5, color, '#8fb4c8', LodFacade.Glass);
  f.light(alongX ? x1 - 1 : cx, y + rise + 0.5, alongX ? cz : z0 + 1, 0xff2a1a, 2.2, 'beacon', true);
  f.reach(y + rise);
}

function footprint(shape: Shape, cx: number, cz: number, w: number, d: number): P2[] {
  if (shape === 'ellipse') return ring(cx, cz, w / 2, d / 2, 20);
  const r = Math.min(w, d) * (shape === 'round' ? 0.22 : 0.3);
  return roundRect(cx, cz, w, d, r, 3);
}

function rectPoly(cx: number, cz: number, w: number, d: number): P2[] {
  return [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
}

function rectCols(cx: number, cz: number, w: number, d: number, sp: number): P2[] {
  const out: P2[] = [];
  const nx = Math.max(1, Math.round(w / sp)), nz = Math.max(1, Math.round(d / sp));
  for (let i = 0; i <= nx; i++) {
    const x = cx - w / 2 + 0.5 + (i / nx) * (w - 1);
    out.push([x, cz + d / 2 - 0.5], [x, cz - d / 2 + 0.5]);
  }
  for (let j = 1; j < nz; j++) {
    const z = cz - d / 2 + 0.5 + (j / nz) * (d - 1);
    out.push([cx - w / 2 + 0.5, z], [cx + w / 2 - 0.5, z]);
  }
  return out;
}

function ringCols(pts: P2[], sp: number): P2[] {
  const out: P2[] = [];
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc >= sp) {
      acc = 0;
      const dx = a[0] - c[0], dz = a[1] - c[1];
      const l = Math.hypot(dx, dz) || 1;
      out.push([a[0] - (dx / l) * 0.5, a[1] - (dz / l) * 0.5]);
    }
  }
  return out;
}

function bounds(pts: P2[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

