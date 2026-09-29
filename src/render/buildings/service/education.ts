// Schools, colleges, universities, libraries, museums and research.
import * as THREE from 'three';
import { Kit, ellipsePts, type P2 } from './kit';
import { C, shade, mix, lawnColor, civicLook, type CivicLook } from './colors';
import { models } from './define';
import { bench, bus, bush, crowd, flagpole, flowerBed, hedge, parkedCars, parkingLot, person, playEquipment, tree, treeGrove, themeTree, solarRow, lampPost } from './props';
import { archWindow, civicBlock, clockFace, grandstand, hall, lampsAlong, portico, radarDish, statueFigure } from './arch';

// ── shared bits ────────────────────────────────────────────────────────────
/** stadium-shaped centreline (two straights + two semicircles) */
export function stadiumPts(cx: number, cz: number, straight: number, r: number, segs = 12, alongX = true): P2[] {
  const pts: P2[] = [];
  for (let s = 0; s < 2; s++) {
    const ox = (s === 0 ? 1 : -1) * straight / 2;
    for (let i = 0; i <= segs; i++) {
      const a = -Math.PI / 2 + (i / segs) * Math.PI + s * Math.PI;
      const x = ox + Math.cos(a) * r, z = Math.sin(a) * r;
      pts.push(alongX ? [cx + x, cz + z] : [cx + z, cz + x]);
    }
  }
  return pts;
}

/** running track with a grass football pitch inside */
export function runningTrack(k: Kit, cx: number, cz: number, straight: number, r: number, lanes = 1.1 * 6, alongX = true): void {
  const segs = k.seg(14);
  k.poly('grass', stadiumPts(cx, cz, straight, r + lanes / 2, segs, alongX), 0.07, C.track);
  k.ribbon('plain', stadiumPts(cx, cz, straight, r, segs, alongX), lanes, 0.1, C.track, true);
  if (!k.lo) for (let l = 1; l < 6; l++) k.ribbon('plain', stadiumPts(cx, cz, straight, r - lanes / 2 + (lanes * l) / 6, segs, alongX), 0.08, 0.12, 0xf2eee6, true);
  k.poly('grass', stadiumPts(cx, cz, straight, r - lanes / 2, segs, alongX), 0.11, 0x5e9a44);
  // pitch markings
  const pw = alongX ? straight + r * 0.6 : (r - lanes / 2) * 1.5, pd = alongX ? (r - lanes / 2) * 1.5 : straight + r * 0.6;
  k.paintRect(cx, cz, pw, pd, 0.14, 0.13);
  if (alongX) k.paint(cx, cz - pd / 2, cx, cz + pd / 2, 0.14, 0.13);
  else k.paint(cx - pw / 2, cz, cx + pw / 2, cz, 0.14, 0.13);
  k.ring('plain', cx, 0.13, cz, Math.min(pw, pd) * 0.16, Math.min(pw, pd) * 0.16 + 0.14, 0xf4f4f0, 20);
  for (const s of [-1, 1]) {
    const gx = alongX ? cx + (s * pw) / 2 : cx, gz = alongX ? cz : cz + (s * pd) / 2;
    k.at(gx, 0, gz, alongX ? Math.PI / 2 : 0, () => {
      k.box('plain', -3.66, 0, 0, 0.12, 2.44, 0.12, 0xf4f4f4);
      k.box('plain', 3.66, 0, 0, 0.12, 2.44, 0.12, 0xf4f4f4);
      k.box('plain', 0, 2.38, 0, 7.44, 0.12, 0.12, 0xf4f4f4);
    });
  }
}

/** school wing (floors, pitched roof in the city style) with a band of windows */
function schoolWing(k: Kit, look: CivicLook, x: number, z: number, w: number, d: number, floors: number, brick: number): number {
  const roof = look.modern ? 'flat' : look.roof === 'flat' ? 'gable' : look.roof;
  return civicBlock(k, look, x, z, w, d, floors, { wall: 'wall_brick', color: brick, roof, roofColor: look.modern ? undefined : look.roofColor });
}

/** gymnasium: tall hall with clerestory windows */
function gym(k: Kit, x: number, z: number, w: number, d: number, h: number, color: number, roofColor: number): number {
  k.box('wall_brick', x, 0, z, w, h, d, color, { top: false });
  k.box('glass', x, h - 2.4, z + d / 2 + 0.05, w - 2, 1.6, 0.08, 0x46607a, { top: false });
  k.barrel('roof_metal', x, h, z, d + 0.6, w + 0.6, Math.min(3.5, d * 0.14), roofColor, k.seg(10), true, 'wall_brick', color);
  return h + Math.min(3.5, d * 0.14);
}

/** basketball / multi-use hard court */
function court(k: Kit, x: number, z: number, w: number, d: number, color: number = C.courtBlue, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    k.slab('asphalt', 0, 0, w + 2, d + 2, 0.08, 0x3f6f5a, 0.1);
    k.flat('plain', 0, 0, w, d, 0.1, color);
    k.paintRect(0, 0, w, d, 0.1, 0.12);
    k.paint(0, -d / 2, 0, d / 2, 0.1, 0.12);
    k.ring('plain', 0, 0.12, 0, 1.7, 1.8, 0xf4f4f0, 16);
    for (const s of [-1, 1]) {
      k.cyl('metal', s * (w / 2 + 0.6), 0, 0, 0.08, 0.08, 3.4, 0x333333, 5);
      k.box('plain', s * (w / 2 + 0.3), 2.9, 0, 0.06, 1.1, 1.8, 0xf4f4f4);
      k.torus('metal', s * (w / 2 - 0.15), 3.05, 0, 0.23, 0.02, 0xe06a1a, 8, 3);
    }
  });
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  elementary_school(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const brick = look.wall === 'wall_brick' ? look.wallColor : mix(0xb86a4a, look.wallColor, 0.45);
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    k.slab('paving', 0, D / 2 - 5, W - 1, 8, 0.08, 0xcfc9bd, 0.2);
    // L-shaped classroom block + gym
    const t1 = schoolWing(k, look, -4, 11, 22, 10, 2, brick);
    schoolWing(k, look, -10, -2, 10, 18, 2, brick);
    const t2 = gym(k, 7, -1, 12, 14, 7.5, shade(brick, 0.92), 0x5a6f7a);
    k.entrance(-4, 16.4, 3, 2.8, true, 0x3a4a5a);
    k.sign(-4, 4.4, 16.5, 7, 0.8, 0xf2c230, 0xfff0a0);
    // colourful playground + painted play court at the back
    k.slab('asphalt', 3, -16, 24, 14, 0.08, 0x55585c, 0.2);
    k.paintRect(3, -16, 16, 9, 0.12, 0.11, C.paintYellow);
    for (let i = 0; i < 5; i++) k.flat('plain', -3 + i * 1.6, -20.5, 1.2, 1.2, 0.11, [0xd04040, 0x3a6fd8, 0xf2c230, 0x3f9a4a, 0xe58ab0][i]);
    k.slab('sand', -9, -18, 8, 9, 0.1, 0xe8d8a8, 0.1);
    playEquipment(k, 'swing', -9, -20, 0);
    playEquipment(k, 'slide', -9, -15, Math.PI);
    playEquipment(k, 'climber', 11, -18);
    flagpole(k, 8, 18, 8, 0x2f5fa8, 0xf4f4f4);
    bus(k, 4, D / 2 - 5, 0, C.yellow, 10);
    tree(k, themeTree(k.ctx, 'shade'), 12, 8, 0.9);
    tree(k, themeTree(k.ctx, 'shade'), -13, -20, 0.8, 1, 1);
    crowd(k, 2, -16, 14, 8, 10);
    return Math.max(t1, t2);
  },

  high_school(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const brick = look.wall === 'wall_brick' ? look.wallColor : mix(0xb0604a, look.wallColor, 0.4);
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    // main 3-storey block along the road + gym wing
    const t1 = schoolWing(k, look, -8, 12, 30, 12, 3, brick);
    const t2 = gym(k, 16, 10, 14, 16, 9, shade(brick, 0.9), 0x3a5a7a);
    k.entrance(-8, 18.4, 4, 3, true, 0x2a3a4a);
    k.box('wall_stone', -8, 0, 18.3, 8, 11, 0.6, 0xe6dfd0, { top: 'concrete' });
    clockFace(k, -8, 8.6, 18.7, 1.2);
    // running track + football field behind
    runningTrack(k, 0, -12, 18, 11, 4.2, true);
    grandstand(k, 0, -12 - 13.5, 18, 5, 0x2f5fa8, Math.PI, 0.2, 0.45, 0.8);
    flagpole(k, 6, 19.5, 9, 0x2f5fa8, 0xf4f4f4);
    parkedCars(k, -22, D / 2 - 1.8, -2, D / 2 - 1.8, 2.8, Math.PI / 2, 0.6);
    bus(k, 8, D / 2 - 2.2, 0, C.yellow, 11);
    tree(k, themeTree(k.ctx, 'shade'), -22, 2, 0.9);
    tree(k, themeTree(k.ctx, 'shade'), 22, -2, 0.85, 1, 1);
    return Math.max(t1, t2);
  },

  trade_school(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('asphalt', 0x5a5d60, 0.2, 0.04);
    // classroom block + sawtooth workshops + crane training yard
    const t1 = civicBlock(k, look, -10, 14, 24, 10, 3, { roof: 'flat' });
    k.entrance(-10, 19.4, 3, 2.8, true);
    k.sign(-10, 8.6, 19.5, 10, 1, 0xf07a1a, 0xffb060);
    hall(k, -4, -6, 36, 20, 8, { roof: 'saw', color: 0xd8dcd8, roofColor: 0x6a7a86, doors: 0 });
    k.box('metal', -4, 0, 4.1, 30, 4.4, 0.1, 0x8a929a, { top: false });
    for (let i = 0; i < 4; i++) k.box('metal', -16 + i * 8, 0, 4.2, 5.4, 4.2, 0.1, [0xf07a1a, 0x3a6fd8, 0x3f9a4a, C.yellow][i], { top: false });
    // training yard: tower crane, vehicles, materials
    const cx = 18, cz = -14;
    k.lattice('metal', cx, cz, 0, 22, 0.9, 0.9, C.yellow, 3, 0.2, 0.08);
    k.beam('metal', [cx - 6, 22.4, cz], [cx + 14, 22.4, cz], 1.1, 1.1, C.yellow);
    k.box('concrete', cx - 5, 21, cz, 2, 1.2, 1.6, 0x8a8e92);
    k.box('glass', cx + 1, 20, cz, 1.6, 1.8, 1.6, 0x2c3a46, { top: 'plain', topColor: C.yellow });
    k.cable('metal', [cx + 11, 22, cz], [cx + 11, 6, cz], 0, 0.04, 0x222222, 2);
    k.box('wood', cx + 11, 4, cz, 3, 1.2, 1.4, C.woodLight);
    k.at(14, 0, 8, 0.4, () => {
      k.box('plain', 0, 0.5, 0, 4.4, 1.8, 2.6, C.yellow);
      k.box('glass', -0.4, 2.3, 0, 1.6, 1.3, 1.6, 0x2c3a46, { top: 'plain', topColor: C.yellow });
      k.beam('metal', [1.8, 2.2, 0], [4.5, 3.8, 0], 0.4, 0.4, C.yellow);
      k.beam('metal', [4.5, 3.8, 0], [5.8, 0.8, 0], 0.35, 0.35, C.yellow);
    });
    for (let i = 0; i < 3; i++) k.box('wood', 12 + i * 2.2, 0, 16, 1.8, 0.9, 4, C.woodLight);
    crowd(k, 16, 2, 10, 6, 6);
    return Math.max(t1, 23.5);
  },

  community_college(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('grass', lawnColor(k.ctx, 0.65), 0.2, 0.04);
    // three modern buildings around a courtyard with a glass atrium link
    const wc = mix(look.wallColor, 0xe8e4dc, 0.5);
    const t1 = civicBlock(k, look, 0, 20, 36, 12, 4, { color: wc, roof: 'flat', wall: 'wall_office' });
    civicBlock(k, look, -15, -8, 12, 30, 3, { color: wc, roof: 'flat', wall: 'wall_office' });
    civicBlock(k, look, 15, -10, 12, 26, 3, { color: shade(wc, 0.95), roof: 'flat', wall: 'wall_glass' });
    k.box('wall_glass', 0, 0, 12, 12, 9, 5, 0xbcd6e4, { top: 'glass', topColor: 0xa8c8d8 });
    k.entrance(0, 26.2, 5, 3.2, true);
    k.sign(0, 11.2, 26.3, 12, 1.2, 0x2f6fd0, 0x9fc8ff);
    // courtyard: lawn, crossing paths, trees, benches, students
    k.slab('grass', 0, -6, 18, 26, 0.08, lawnColor(k.ctx, 0.75), 0.1);
    k.ribbon('paving', [[0, 10], [0, -19]], 3, 0.11, 0xd8d2c4);
    k.ribbon('paving', [[-9, -6], [9, -6]], 2.4, 0.11, 0xd8d2c4);
    k.disc('paving', 0, 0.12, -6, 3.2, 0xd8d2c4, 16);
    tree(k, themeTree(k.ctx, 'shade'), -5, 2, 0.8);
    tree(k, themeTree(k.ctx, 'shade'), 5, -14, 0.8, 1, 1);
    tree(k, themeTree(k.ctx, 'shade'), 5, 2, 0.75, 2, 2);
    for (const [x, z, r] of [[-3, -9, 0], [3, -3, Math.PI]] as [number, number, number][]) bench(k, x, z, r);
    crowd(k, 0, -6, 14, 20, 12);
    parkingLot(k, 0, -D / 2 + 6, W - 6, 10, 0.6);
    return t1;
  },

  university(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['hip', 'mansard', 'gable']);
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.04);
    const stone = look.wall === 'wall_brick' ? look.wallColor : mix(0xe2d6bc, look.wallColor, 0.3);
    const wall = look.wall === 'wall_brick' ? 'wall_brick' : 'wall_stone';
    const roof = look.roof === 'flat' ? 'hip' : look.roof;
    // quadrangle: faculty wings on three sides, great hall with dome at the back
    civicBlock(k, look, -30, -2, 14, 52, 3, { wall, color: stone, roof });
    civicBlock(k, look, 30, -2, 14, 52, 3, { wall, color: stone, roof });
    civicBlock(k, look, -20, 30, 26, 12, 3, { wall, color: stone, roof });
    civicBlock(k, look, 20, 30, 26, 12, 3, { wall, color: stone, roof });
    const hallTop = civicBlock(k, look, 0, -28, 46, 16, 4, { wall, color: stone, roof: 'flat' });
    const pz = -20 + 0.1;
    portico(k, 0, pz + 6, 18, 6, 10, 6, 0xf0ebe0, 1.2, look.roofColor);
    k.cyl('wall_stone', 0, hallTop, -28, 7, 7, 5, stone, k.seg(20));
    k.dome('roof_metal', 0, hallTop + 5, -28, 7.5, C.copper, k.seg(22), 1);
    k.cyl('plain', 0, hallTop + 12.4, -28, 1.2, 1.2, 3, 0xf0ebe0, 10);
    k.dome('roof_metal', 0, hallTop + 15.4, -28, 1.4, C.copper, 10, 1.2);
    // gate + clock tower in the front wing gap
    const tx = 0, tz = 30;
    k.box(wall, tx, 0, tz, 8, 32, 8, stone, { top: false });
    k.box('plain', tx, 32, tz, 9, 0.8, 9, 0xf0ebe0);
    k.box(wall, tx, 32.8, tz, 6.4, 7, 6.4, stone, { top: false });
    for (let s = 0; s < 4; s++) k.at(tx, 0, tz, (s * Math.PI) / 2, () => clockFace(k, 0, 36.3, 3.25, 2.2, C.gold, 0.9 + s, -1.2 + s));
    k.pyramid('roof_metal', tx, 39.8, tz, 7, 7, 8, C.copper);
    k.box('metal', tx, 47.8, tz, 0.15, 2, 0.15, C.gold);
    k.box('glass', tx, 0, tz + 4.05, 4, 6, 0.1, 0x4a3a2a, { top: false });
    archWindow(k, tx, 0, tz + 4.1, 4.2, 7, 0xf0ebe0, 0x3a2a1a, 'wood');
    // quad lawns with diagonal paths, central statue, trees
    k.ribbon('paving', [[0, 24], [0, -18]], 4, 0.1, 0xd8cdb4);
    k.ribbon('paving', [[-22, 20], [22, -16]], 2.6, 0.1, 0xd8cdb4);
    k.ribbon('paving', [[22, 20], [-22, -16]], 2.6, 0.1, 0xd8cdb4);
    k.disc('paving', 0, 0.12, 2, 6, 0xd8cdb4, 20);
    k.box('wall_stone', 0, 0, 2, 2.6, 2, 2.6, 0xd8d2c4);
    statueFigure(k, 0, 2, 2, 1.5, C.bronze, 0);
    for (const [x, z] of [[-14, -8], [14, -8], [-14, 14], [14, 14], [-20, 2], [20, 2]] as P2[]) tree(k, themeTree(k.ctx, 'shade'), x, z, 0.95, x + z, Math.abs(x + z));
    for (const [x, z, r] of [[-5, 8, 0], [5, -4, Math.PI], [-8, -10, 0.5]] as [number, number, number][]) bench(k, x, z, r);
    crowd(k, 0, 4, 34, 30, 22);
    lampsAlong(k, [[0, 24], [0, -18]], 9, 4, 'classic', 2.6);
    return 49;
  },

  campus_library(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.04);
    // glass reading-room box with a cantilevered stack floor
    k.box('wall_glass', 0, 0, -4, 30, 8, 22, 0xbcd6e4, { top: 'roof_flat' });
    k.box('wall_concrete', 2, 8, -2, 40, 9.5, 26, 0xece9e2, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let i = 0; i < 12; i++) k.box('plain', -17 + i * 3.1, 8, 11.05, 0.35, 9.5, 0.5, 0xd8d4c8, { top: false });
    k.box('glass', 2, 12, 11.1, 37, 3.4, 0.08, 0x4a6478, { top: false });
    k.parapet(2, 17.5, -2, 40, 26, 0.7, 0xdad6ce);
    for (const [x, z] of [[-17, 10], [21, 10], [-17, -14], [21, -14]] as P2[]) k.cyl('concrete', x, 0, z, 0.45, 0.45, 8, 0xdad6ce, 10);
    k.light(0, 7, 8, 0xfff0d0, 8, 'lamp');
    // amphitheatre steps + reading lawn
    for (let i = 0; i < 5; i++) k.box('concrete', 0, 0, 14 + i * 1.1, 24 - i * 2, 0.45 * (5 - i), 1.1, 0xd8d4c8);
    k.ribbon('paving', [[-W / 2 + 2, D / 2 - 2], [W / 2 - 2, D / 2 - 2]], 3, 0.1, 0xd8d2c4);
    tree(k, themeTree(k.ctx, 'shade'), -19, 18, 0.9);
    tree(k, themeTree(k.ctx, 'shade'), 19, 18, 0.85, 1, 1);
    crowd(k, 0, 16, 20, 5, 10);
    return 18.2;
  },

  library(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    k.slab('paving', 0, D / 2 - 5, W - 4, 9, 0.08, 0xd8d0c0, 0.2);
    const stone = 0xe6dcc6;
    // neoclassical reading hall with portico, steps and a shallow dome
    k.box('wall_stone', 0, 0, -5, 24, 1.4, 16, 0xcfc6b2, { top: 'paving', topColor: 0xd8d0c0 });
    k.box('wall_stone', 0, 1.4, -5, 22, 8.5, 14, stone, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('plain', 0, 9.6, -5, 23, 0.6, 15, 0xf0e8d6);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.at(s * 11.05, 0, -9 + i * 4, s * Math.PI / 2, () => archWindow(k, 0, 3, 0, 1.6, 4.6, 0xf0e8d6));
    const top = portico(k, 0, 5.6, 14, 3.6, 7.2, 6, 0xf2ecde, 1.4, look.roofColor);
    k.cyl('wall_stone', 0, 10.2, -6, 4.2, 4.2, 1.5, stone, 18);
    k.dome('roof_metal', 0, 11.7, -6, 4.4, C.copper, 18, 0.7);
    // lions / planters flanking the steps
    for (const s of [-1, 1]) {
      k.box('wall_stone', s * 8.2, 0, 7, 1.4, 1.2, 2.6, 0xcfc6b2);
      k.box('plain', s * 8.2, 1.2, 7, 0.9, 0.9, 2, 0xb8a888);
      k.ball('plain', s * 8.2, 2.3, 7.8, 0.5, 0xb8a888, 8, 5);
      lampPost(k, s * 10.5, 11, 4.2);
    }
    bench(k, -12, 12, 0);
    bench(k, 12, 12, 0);
    tree(k, themeTree(k.ctx, 'formal'), -13, -14, 0.8);
    tree(k, themeTree(k.ctx, 'formal'), 13, -14, 0.8, 1, 1);
    crowd(k, 0, 11, 10, 4, 4);
    return Math.max(top, 15);
  },

  science_museum(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd8d4cc, 0.2, 0.04);
    // steel-and-glass hall with a giant planet sphere in its atrium
    k.box('wall_glass', -6, 0, -6, 42, 16, 26, 0xbcd6e4, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let i = 0; i < 9; i++) k.beam('metal', [-26 + i * 5, 0, 7.2], [-26 + i * 5 + 1, 16, 7.2], 0.35, 0.35, 0xe8eaec);
    k.box('metal', -6, 16, -6, 43, 1, 27, 0xd8dcdf);
    k.ball('plain', -14, 16, -4, 10, 0x3f7fc8, k.seg(22), 14);
    k.torus('metal', -14, 16, -4, 14, 0.5, 0xe8e2c8, k.seg(30), 5);
    k.light(-14, 26, -4, 0x8fc8ff, 12, 'neon');
    k.box('wall_concrete', 14, 0, -10, 16, 22, 18, 0xe8e6e0, { top: 'roof_flat' });
    k.sign(14, 16, -0.9, 12, 1.6, 0xf2a93b, 0xffd080);
    k.entrance(-6, 7.1, 6, 4, true);
    // rocket on its launch stand + plaza
    const rx = 18, rz = 12;
    k.lattice('metal', rx - 4, rz, 0, 26, 1.1, 0.9, 0xd8412f, 4, 0.25, 0.1);
    k.rev('plain', rx, 0.5, rz, [[1.8, 0], [1.8, 18], [1.2, 24], [0.5, 27.5], [0, 29]], 0xf4f4f4, k.seg(14), { crease: 40 });
    k.cyl('plain', rx, 12, rz, 1.82, 1.82, 1.2, 0x1a1a1a, k.seg(14), false);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.pushTRS(rx + Math.cos(a) * 1.8, 0.5, rz + Math.sin(a) * 1.8, -a);
      k.tri('plain', { x: 0, y: 0, z: 0 }, { x: 2.2, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, [0, 0], [1, 0], [0, 1], 0xd8412f, { x: 0, y: 0, z: 1 });
      k.tri('plain', { x: 0, y: 0, z: 0 }, { x: 2.2, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, [0, 0], [1, 0], [0, 1], 0xd8412f, { x: 0, y: 0, z: -1 });
      k.pop();
    }
    k.light(rx, 29.5, rz, C.beaconRed, 2.5, 'beacon', true);
    k.light(rx, 8, rz + 3, 0xf6f8ff, 10, 'flood');
    for (let i = 0; i < 4; i++) tree(k, themeTree(k.ctx, 'formal'), -26 + i * 9, 17, 0.75, i, i);
    crowd(k, -4, 13, 24, 6, 14);
    return 30;
  },

  research_institute(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.65), 0.2, 0.04);
    // linked lab blocks with rooftop plant
    k.box('wall_glass', -12, 0, 12, 30, 14, 14, 0xa8c8dc, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let i = 0; i < 10; i++) k.box('plain', -26 + i * 3.1, 0, 19.05, 0.3, 14, 0.4, 0xe8e8e4, { top: false });
    k.box('wall_concrete', 14, 0, 4, 16, 20, 26, 0xe8e6e0, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.hvac(14, 20, 4, 16, 26, 4);
    k.box('wall_glass', 2, 6, 10, 8, 3.6, 4, 0xbcd6e4, { top: 'roof_flat' });
    k.parapet(-12, 14, 12, 30, 14, 0.7, 0xd8d8d4);
    for (let i = 0; i < 5; i++) solarRow(k, -12, 7 + i * 3, 26, 2, 0.4, 14.3);
    // radio telescope + greenhouses at the back
    const dx = -14, dz = -14;
    k.cyl('concrete', dx, 0, dz, 3, 2.6, 5, 0xd8d6d0, 12);
    radarDish(k, dx, 9, dz, 9, 0.08, 0xf2f2f0);
    for (let i = 0; i < 2; i++) {
      k.box('glass', 12 + i * 10, 0, -18, 8, 3, 14, 0xcfe6d8, { top: false });
      k.gableRoof('glass', 12 + i * 10, 3, -18, 8, 14, 2.2, 0xcfe6d8, { overhang: 0, ridgeAlongX: false, wallMat: 'glass', wallColor: 0xcfe6d8 });
      k.box('foliage', 12 + i * 10, 0, -18, 6, 1, 12, 0x4f8a3a);
    }
    k.entrance(-12, 19, 4, 3, true);
    k.sign(-12, 10, 19.3, 12, 1.2, 0x2aa6a0, 0x7fffea);
    parkedCars(k, 6, D / 2 - 2, 28, D / 2 - 2, 2.8, Math.PI / 2, 0.7);
    tree(k, themeTree(k.ctx, 'shade'), -28, -4, 0.9);
    tree(k, themeTree(k.ctx, 'shade'), 0, -24, 0.85, 1, 1);
    return 22;
  },
};

export const EDUCATION_MODELS = models(M);
