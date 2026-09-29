// Monuments: late-game wonders with city-wide effects. Spectacular, unique
// silhouettes that read from anywhere on the map, day and night.
import * as THREE from 'three';
import { Kit, type P2, type V3 } from './kit';
import { C, shade, jitter, lawnColor } from './colors';
import { models } from './define';
import { airplane, bench, bush, crowd, flagpole, flowerBed, foliageBlob, hedge, parkingLot, person, solarRow, tree, treeGrove, themeTree } from './props';
import { archWindow, coolingTower, geodesicDome, lampsAlong, portico, radarDish, statueFigure } from './arch';
import { path, pond } from './parks';
import { switchyard } from './power';
import { flood, plaza, revRibs } from './landmarks';

// ── shared bits ────────────────────────────────────────────────────────────
/** chamfered square outline (half-size s, chamfer c), counter-clockwise from +X */
function chamfer(s: number, c: number, cx = 0, cz = 0): P2[] {
  return [[s, -s + c], [s, s - c], [s - c, s], [-s + c, s], [-s, s - c], [-s, -s + c], [-s + c, -s], [s - c, -s]].map(([x, z]) => [cx + x, cz + z] as P2);
}

/** square obelisk with a gilded pyramidion */
function obelisk(k: Kit, x: number, z: number, h: number, stone: number): number {
  k.box('plain', x, 0, z, 3.2, 1.2, 3.2, shade(stone, 0.85), { top: 'paving', topColor: shade(stone, 0.9) });
  const b = h * 0.075;
  k.rev('plain', x, 1.2, z, [[b * Math.SQRT2, 0], [b * 0.66 * Math.SQRT2, h]], stone, 4, { a0: Math.PI / 4, a1: Math.PI / 4 + Math.PI * 2, crease: 30 });
  k.pyramid('metal', x, 1.2 + h, z, b * 1.32, b * 1.32, b * 1.2, C.gold);
  return 1.2 + h + b * 1.2;
}

/** reclining sphinx facing +Z (length along Z) */
function sphinx(k: Kit, x: number, z: number, s: number, stone: number): void {
  k.at(x, 0, z, 0, () => {
    k.box('plain', 0, 0, 0, 10, 1.2, 26, shade(stone, 0.85), { top: 'paving', topColor: shade(stone, 0.9) });
    k.box('plain', 0, 1.2, -3, 6 * s / 3, 5.4, 14, stone);
    k.ball('plain', 0, 4.4, -9, 3.4, stone, 10, 6, 0.8, 1);
    for (const sx of [-1, 1]) k.box('plain', sx * 1.9, 1.2, 7, 1.8, 1.4, 8, shade(stone, 0.96));
    k.box('plain', 0, 1.2, 3.5, 4.6, 7.2, 4.2, stone);
    k.box('plain', 0, 8.4, 3.8, 3, 3.4, 3.2, stone);
    k.box('plain', 0, 7.2, 3.3, 4.8, 4.8, 2.6, shade(stone, 0.93));
    if (!k.lo) for (let i = 0; i < 5; i++) k.box('plain', 0, 7.4 + i * 0.9, 2.02, 4.9, 0.3, 0.1, 0x3a5a8a);
    k.box('plain', 0, 9.2, 5.42, 1.4, 1.2, 0.1, shade(stone, 0.8));
  });
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  // ── Grand library (domed temple of knowledge) ───────────────────────────
  grand_library(k) {
    const W = k.W, D = k.D;
    const lime = 0xe4dac4, marble = C.marble, copper = C.copper, gilt = 0xd4a848;
    k.lot('grass', lawnColor(k.ctx, 0.75), 0.2, 0.05);
    k.slab('paving', 0, 0, 62, 62, 0.07, 0xd8d0c0, 0.1);
    k.slab('paving', 0, 34, 14, 12, 0.08, 0xd8d0c0, 0.1);
    for (const sx of [-1, 1]) {
      k.box('concrete', sx * 22, 0, 35, 16, 0.5, 8, 0xd0c8b8, { top: false });
      k.flat('water', sx * 22, 35, 15.2, 7.2, 0.4, 0x4f8f9a);
      if (!k.lo) for (let i = 0; i < 3; i++) k.emitter('fountain', sx * (16 + i * 6), 0.5, 35, 0.4);
    }
    // base block with corner pavilions
    const B = 25;
    k.box('plain', 0, 0, 0, B * 2 + 1.2, 1.2, B * 2 + 1.2, 0x9e988c, { top: 'paving', topColor: 0xcfc6b4 });
    k.box('wall_stone', 0, 1.2, 0, B * 2, 13.8, B * 2, lime, { top: 'roof_flat', topColor: 0x8a8578 });
    k.box('plain', 0, 15, 0, B * 2 + 1, 0.8, B * 2 + 1, marble);
    k.box('plain', 0, 15.8, 0, B * 2, 1.3, B * 2, lime, { top: false });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const px = sx * (B - 4), pz = sz * (B - 4);
        k.box('wall_stone', px, 1.2, pz, 9.4, 16.6, 9.4, shade(lime, 1.03), { top: 'roof_flat', topColor: 0x8a8578 });
        k.box('plain', px, 17.8, pz, 10, 0.6, 10, marble);
        k.cyl('plain', px, 18.4, pz, 3.6, 3.6, 1.6, marble, 16);
        k.dome('roof_metal', px, 20, pz, 3.7, copper, k.seg(16), 1.1);
        k.cyl('metal', px, 24, pz, 0.14, 0.06, 1.8, gilt, 5);
      }
    // four porticos (grand one at the front) with statues of thinkers
    for (let f = 0; f < 4; f++)
      k.at(0, 0, 0, (f * Math.PI) / 2, () => {
        const w = f === 0 ? 24 : 16;
        portico(k, 0, B + 6, w, 6, 12, f === 0 ? 8 : 6, marble, 1.2, copper);
        k.stairs(0, B + 8.6, w + 2, 1.2, 0xd8d0c0, 0.17, 0.34, 'concrete');
        if (f === 0) for (let i = 0; i < 4; i++) {
          const x = (i < 2 ? -1 : 1) * (15 + (i % 2) * 5);
          k.box('plain', x, 0, B + 5, 2, 2.6, 2, 0xcfc6b4, { top: 'plain', topColor: marble });
          statueFigure(k, x, 2.6, B + 5, 1.5, 0xd8d4cc, 0, i % 2 ? 'raise' : 'stand');
        }
      });
    // drum with colonnade
    const dy = 17.1;
    const s = k.seg(32);
    k.cyl('plain', 0, dy, 0, 16, 16, 1.2, marble, s);
    k.cyl('plain', 0, dy + 1.2, 0, 13.8, 13.8, 11, lime, s);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 24;
      k.at(Math.cos(a) * 13.82, 0, Math.sin(a) * 13.82, Math.PI / 2 - a, () => archWindow(k, 0, dy + 3.4, 0, 1.9, 5.8, marble, 0x2e3a48));
    }
    const cols = k.lo ? 16 : 28;
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      const x = Math.cos(a) * 15.2, z = Math.sin(a) * 15.2;
      k.cyl('plain', x, dy + 1.2, z, 0.62, 0.54, 9.8, marble, 8, false);
      k.box('plain', x, dy + 10.6, z, 1.5, 0.45, 1.5, marble);
    }
    k.cyl('plain', 0, dy + 11, 0, 16.2, 16.2, 1.7, marble, s);
    k.cyl('plain', 0, dy + 12.7, 0, 14.4, 14.4, 2.2, lime, s);
    // dome with gilded ribs
    const domeY = dy + 14.9, R = 14.2;
    const dp: P2[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); dp.push([Math.cos(a) * R, Math.sin(a) * R * 1.08]); }
    dp[10][0] = 0;
    k.rev('roof_metal', 0, domeY, 0, dp, copper, s, { crease: 80 });
    revRibs(k, 0, domeY, 0, dp.slice(0, 9), 1, 1, k.lo ? 8 : 16, [], gilt, 0.35, 0.06);
    // lantern + torch of learning
    const ly = domeY + R * 1.08 - 0.5;
    k.cyl('plain', 0, ly, 0, 3.3, 3.3, 0.6, marble, 12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.cyl('plain', Math.cos(a) * 2.8, ly + 0.6, Math.sin(a) * 2.8, 0.26, 0.22, 4, marble, 6, false);
    }
    k.cyl('emissive', 0, ly + 0.6, 0, 2.2, 2.2, 4, 0xffe2a8, 10);
    k.light(0, ly + 2.6, 0, 0xffe2a8, 8, 'lamp');
    k.cyl('plain', 0, ly + 4.6, 0, 3.4, 3.4, 0.6, marble, 12);
    k.dome('roof_metal', 0, ly + 5.2, 0, 3.2, copper, 12, 1.15);
    k.cyl('metal', 0, ly + 8.6, 0, 0.5, 0.32, 1.6, gilt, 8);
    k.rev('metal', 0, ly + 10.2, 0, [[0.3, 0], [0.9, 0.7]], gilt, 8, { top: true });
    k.rev('emissive', 0, ly + 10.9, 0, [[0.7, 0], [0.55, 0.9], [0.2, 2.0], [0, 2.6]], 0xffb040, 8);
    k.light(0, ly + 12, 0, 0xffb040, 7, 'lamp');
    // formal gardens, lamps, floodlights
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 4), -30 + i * 13, 0.8, i + sx);
      hedge(k, sx * 8, 30, 1.2, 10, 1.2);
      flowerBed(k, sx * 11, 30, 3, 8);
    }
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.6, 'classic', 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.light(sx * 13, domeY + 6, sz * 13, 0xffe6c0, 26, 'flood');
    for (const x of [-10, 0, 10]) flood(k, x, B + 11, 9, 20, 0xffe6c0);
    crowd(k, 0, B + 12, 30, 5, 14);
    return ly + 13;
  },

  // ── Expo tower (twisted helix) ──────────────────────────────────────────
  expo_tower(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    plaza(k, 0xd8dade, 0xb0b4b8);
    const H = 282, cz = -3;
    const sH = (y: number) => 12.5 - 5.2 * (y / H);
    const tw = (y: number) => (y / H) * Math.PI;
    const unit: P2[] = [[1, -0.42], [1, 0.42], [0.42, 1], [-0.42, 1], [-1, 0.42], [-1, -0.42], [-0.42, -1], [0.42, -1]];
    const ring = (y: number): P2[] => {
      const a = tw(y), s = sH(y), c = Math.cos(a), sn = Math.sin(a);
      return unit.map(([x, z]) => [(x * c - z * sn) * s, cz + (x * sn + z * c) * s] as P2);
    };
    const nL = k.lo ? 24 : 47;
    const glass = 0xc4e0f0;
    for (let i = 0; i < nL; i++) {
      const y0 = (H * i) / nL, y1 = (H * (i + 1)) / nL;
      const A = ring(y0), Bq = ring(y1);
      let u = 0;
      for (let j = 0; j < 8; j++) {
        const j2 = (j + 1) % 8;
        const len = Math.hypot(A[j2][0] - A[j][0], A[j2][1] - A[j][1]);
        const mx = (A[j][0] + A[j2][0] + Bq[j][0] + Bq[j2][0]) / 4, mz = (A[j][1] + A[j2][1] + Bq[j][1] + Bq[j2][1]) / 4 - cz;
        k.quad('wall_glass', { x: A[j][0], y: y0, z: A[j][1] }, { x: A[j2][0], y: y0, z: A[j2][1] }, { x: Bq[j2][0], y: y1, z: Bq[j2][1] }, { x: Bq[j][0], y: y1, z: Bq[j][1] }, [[u, y0], [u + len, y0], [u + len, y1], [u, y1]], j % 2 ? glass : shade(glass, 0.92), { x: mx, y: 0, z: mz });
        u += len;
      }
      // white fins on the eight twisting corners make the helix read from afar
      if (!k.lo) for (let j = 0; j < 8; j++) {
        const o = (v: P2, y: number): V3 => [v[0] * 1.02, y, cz + (v[1] - cz) * 1.02];
        k.beam('plain', o(A[j], y0), o(Bq[j], y1), j % 2 ? 0.35 : 0.6, 0.35, 0xf2f4f6);
      }
      if (i % 6 === 0 && i > 0) {
        const E = ring(y0).map(([x, z]) => [x * 1.04, cz + (z - cz) * 1.04] as P2);
        for (let j = 0; j < 8; j++) k.beam('plain', [E[j][0], y0, E[j][1]], [E[(j + 1) % 8][0], y0, E[(j + 1) % 8][1]], 0.5, 0.5, 0xf2f4f6);
      }
    }
    k.poly('roof_flat', ring(H), H, 0x5a5d62);
    // double-helix exoskeleton with neon
    const steps = k.lo ? 24 : 44;
    for (const ph of [0, Math.PI]) {
      const pts: V3[] = [];
      for (let i = 0; i <= steps; i++) {
        const y = 3 + ((H - 6) * i) / steps;
        const a = tw(y) * 1.6 + ph + Math.PI / 4;
        const rr = sH(y) * 1.5;
        pts.push([Math.cos(a) * rr, y, cz + Math.sin(a) * rr]);
      }
      for (let i = 0; i < steps; i++) k.beam('metal', pts[i], pts[i + 1], 0.9, 0.9, 0xf4f6f8);
      for (let i = 0; i <= steps; i += 4) {
        const [x, y, z] = pts[i];
        const l = Math.hypot(x, z - cz) || 1;
        k.beam('metal', pts[i], [(x / l) * sH(y) * 0.95, y, cz + ((z - cz) / l) * sH(y) * 0.95], 0.4, 0.4, 0xdadcde);
      }
      for (let i = 1; i <= steps; i += 3) k.light(pts[i][0], pts[i][1], pts[i][2], ph ? 0xff5ad0 : 0x3ae0ff, 4.5, 'neon');
    }
    // crown + spire
    k.rev('wall_glass', 0, H, cz, [[sH(H) * 0.9, 0], [sH(H) * 0.5, 6], [1.2, 9]], 0xb8d8e8, 8, { crease: 30 });
    k.cyl('metal', 0, H + 9, cz, 0.9, 0.15, 300 - H - 9, 0xdadcde, 8);
    k.light(0, 300, cz, C.beaconRed, 5, 'beacon', true);
    k.light(0, H + 5, cz, 0xbfe8ff, 16, 'neon');
    // Unisphere-style globe in a fountain pool
    const gx = -12, gz = 14, gy = 8, GR = 5;
    k.cyl('concrete', gx, 0, gz, 7.5, 7.5, 0.6, 0xd0ccc4, 24, false);
    k.disc('water', gx, 0.5, gz, 7.1, 0x4f9ab0, 24);
    k.cyl('metal', gx, 0.5, gz, 0.9, 0.5, gy - GR + 0.6, 0x8a8e92, 8);
    for (let m = 0; m < 6; m++) {
      k.push(new THREE.Matrix4().makeTranslation(gx, gy, gz).multiply(new THREE.Matrix4().makeRotationY((m * Math.PI) / 6)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      k.torus('metal', 0, 0, 0, GR, 0.12, 0xb8bec4, 24, 3);
      k.pop();
    }
    for (const lat of [-0.9, -0.45, 0, 0.45, 0.9]) k.torus('metal', gx, gy + Math.sin(lat) * GR, gz, Math.cos(lat) * GR, 0.1, 0xb8bec4, 22, 3);
    if (!k.lo) for (let i = 0; i < 9; i++) {
      const a = r.range(0, Math.PI * 2), b = r.range(-0.8, 0.9);
      foliageBlob(k, gx + Math.cos(a) * Math.cos(b) * GR, gy + Math.sin(b) * GR, gz + Math.sin(a) * Math.cos(b) * GR, 1.4, 0.9, 1.4, 0xa8b0b4, i, 0.2, 0);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.emitter('fountain', gx + Math.cos(a) * 6.2, 0.6, gz + Math.sin(a) * 6.2, 0.45);
    }
    // flags of nations, pavilions
    const pal = [0xd8272f, 0x2f5fa8, 0x3fa05a, 0xf2c230, 0x1a1a1a, 0xf4f4f4, 0xe07a2a, 0x7a3aa0];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.1 + (i / 9) * Math.PI * 0.8;
      flagpole(k, Math.cos(a) * 21, cz + Math.sin(a) * 19, 10, pal[i % pal.length], pal[(i + 3) % pal.length]);
    }
    k.dome('metal', 15, 0, 15, 5, 0xe8e2d0, 16, 0.8);
    k.rev('plain', 16, 0, -17, [[4.5, 0], [3, 7], [0, 12]], 0xd84a3a, 10);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 9, 4.6, 'modern', 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.light(Math.cos(a) * 16, 60 + i * 30, cz + Math.sin(a) * 16, 0xbfe0ff, 30, 'flood');
    }
    crowd(k, 2, 18, 30, 8, 14);
    return 300;
  },

  // ── The Colossus ────────────────────────────────────────────────────────
  colossus(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.05);
    const granite = 0xa6a198, stone = 0xc2baa8;
    // star fort base
    const star: P2[] = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.PI / 2;
      const rr = i % 2 ? 20 : 27;
      star.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    k.prism('plain', star, -1, 5.5, granite, 'paving', 0xcfc6b4);
    k.stairs(0, 32, 8, 5.5, 0xb4ac9c, 0.18, 0.34);
    // pedestal
    k.box('plain', 0, 5.5, 0, 20, 3, 20, shade(stone, 0.92), { top: 'paving', topColor: 0xcfc6b4 });
    k.box('plain', 0, 8.5, 0, 16, 20, 16, stone, { top: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('plain', sx * 7.6, 8.5, sz * 7.6, 1.6, 20, 1.6, shade(stone, 1.05));
    for (let f = 0; f < 4; f++)
      k.at(0, 0, 0, (f * Math.PI) / 2, () => {
        archWindow(k, 0, 10.5, 8.02, 3.2, 6.5, shade(stone, 1.08), 0x2a2e33, 'plain');
        for (const x of [-4.2, 4.2]) k.box('plain', x, 19, 8.05, 2.4, 2.4, 0.2, shade(stone, 1.08));
        k.box('plain', 0, 22.4, 8.05, 12, 0.5, 0.3, shade(stone, 1.1));
      });
    k.box('plain', 0, 28.5, 0, 18, 1.2, 18, shade(stone, 1.08));
    k.box('plain', 0, 29.7, 0, 15, 3.3, 15, stone, { top: 'paving', topColor: 0xcfc6b4 });
    // bronze figure
    const Y0 = 33, H = 64;
    const bronze = 0x9b7446, bronzeD = shade(bronze, 0.82);
    const s = k.seg(22);
    const robe: P2[] = [[0.115 * H, 0], [0.12 * H, 0.04 * H], [0.105 * H, 0.25 * H], [0.098 * H, 0.45 * H], [0.11 * H, 0.58 * H]];
    k.rev('metal', 0, Y0, 0, robe, bronze, s, { sz: 0.72, crease: 70 });
    if (!k.lo) for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pt = (f: number): V3 => {
        const idx = f * 4, j = Math.min(3, Math.floor(idx)), g = idx - j;
        const rr = robe[j][0] + (robe[j + 1][0] - robe[j][0]) * g + 0.25;
        return [Math.cos(a) * rr, Y0 + robe[j][1] + (robe[j + 1][1] - robe[j][1]) * g, Math.sin(a) * rr * 0.72];
      };
      k.polyPipe('metal', [pt(0.02), pt(0.3), pt(0.6), pt(0.85)], 0.45, bronzeD, 4);
    }
    const ty = Y0 + 0.58 * H;
    k.rev('metal', 0, ty, 0, [[0.11 * H, 0], [0.118 * H, 0.08 * H], [0.11 * H, 0.16 * H], [0.075 * H, 0.22 * H], [0.035 * H, 0.245 * H]], bronze, s, { sz: 0.62, crease: 70 });
    k.beam('metal', [0.1 * H, Y0 + 0.5 * H, 0.07 * H], [-0.085 * H, Y0 + 0.79 * H, 0.05 * H], 0.045 * H, 0.012 * H, bronzeD);
    k.cyl('metal', 0, Y0 + 0.82 * H, 0, 0.033 * H, 0.03 * H, 0.05 * H, bronze, 10);
    k.ball('metal', 0, Y0 + 0.905 * H, 0.004 * H, 0.055 * H, bronze, 14, 10, 1.15);
    k.torus('metal', 0, Y0 + 0.935 * H, 0, 0.056 * H, 0.009 * H, bronzeD, 16, 4);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.15 + (i / 6) * Math.PI * 1.3;
      const bx = Math.cos(a) * 0.05 * H, bz = Math.sin(a) * 0.05 * H;
      k.beam('metal', [bx, Y0 + 0.94 * H, bz], [bx * 2.6, Y0 + 1.0 * H, bz * 2.6], 0.012 * H, 0.012 * H, bronze);
    }
    // raised torch arm
    const S1: V3 = [0.1 * H, Y0 + 0.79 * H, 0], E1: V3 = [0.13 * H, Y0 + 0.96 * H, 0.01 * H], H1: V3 = [0.135 * H, Y0 + 1.1 * H, 0];
    k.pipe('metal', S1, E1, 0.036 * H, bronze, 10, true);
    k.pipe('metal', E1, H1, 0.028 * H, bronze, 10, true);
    k.cyl('metal', H1[0], H1[1], H1[2], 0.018 * H, 0.022 * H, 0.06 * H, bronzeD, 10);
    const cy = H1[1] + 0.06 * H;
    k.rev('metal', H1[0], cy, H1[2], [[0.022 * H, 0], [0.05 * H, 0.035 * H]], C.gold, 14, { top: true });
    k.rev('emissive', H1[0], cy + 0.035 * H, H1[2], [[0.042 * H, 0], [0.036 * H, 0.03 * H], [0.014 * H, 0.07 * H], [0, 0.085 * H]], 0xffb84a, 12);
    k.light(H1[0], cy + 0.07 * H, H1[2], 0xffb040, 16, 'flood');
    k.light(H1[0], cy + 0.06 * H, H1[2], 0xffe0a0, 6, 'lamp');
    // other arm cradling a tablet
    const S2: V3 = [-0.1 * H, Y0 + 0.79 * H, 0], E2: V3 = [-0.14 * H, Y0 + 0.66 * H, 0.05 * H], H2: V3 = [-0.07 * H, Y0 + 0.62 * H, 0.1 * H];
    k.pipe('metal', S2, E2, 0.034 * H, bronze, 10, true);
    k.pipe('metal', E2, H2, 0.028 * H, bronze, 10, true);
    k.at(-0.095 * H, Y0 + 0.55 * H, 0.1 * H, 0.35, () => k.box('metal', 0, 0, 0, 0.075 * H, 0.13 * H, 0.025 * H, bronzeD));
    k.box('metal', 0.035 * H, Y0, 0.075 * H, 0.04 * H, 0.02 * H, 0.05 * H, bronze);
    const top = cy + 0.035 * H + 0.085 * H;
    // island gardens, floodlights
    treeGrove(k, 0, 0, W - 4, D - 4, 18, 'shade', (x, z) => Math.hypot(x, z) < 30 || (Math.abs(x) < 6 && z > 20), [0.8, 1.2]);
    path(k, [[0, D / 2], [0, 32]], 5, 0xd8ccb0);
    const ring: P2[] = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; ring.push([Math.cos(a) * 29.5, Math.sin(a) * 29.5]); }
    k.ribbon('paving', ring, 3, 0.09, 0xd8ccb0);
    for (let i = 0; i < 8; i++) bench(k, Math.cos((i / 8) * Math.PI * 2) * 31.6, Math.sin((i / 8) * Math.PI * 2) * 31.6, -(i / 8) * Math.PI * 2 - Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
      k.light(Math.cos(a) * 16, Y0 + 24, Math.sin(a) * 12, 0xffe2b0, 34, 'flood');
    }
    crowd(k, 0, 27, 18, 5, 10);
    return top;
  },

  // ── Supercomputer center ────────────────────────────────────────────────
  supercomputer(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xc4c6c8, 0.2, 0.05);
    const cyan = 0x36d6ff, magenta = 0xd04aff;
    // cooling lake
    k.box('concrete', 0, -1.2, -23, 76, 1.4, 16, 0x9a9a96, { top: false });
    k.flat('water', 0, -23, 75, 15, 0.15, 0x2f6f88);
    for (let i = 0; i < 6; i++) {
      const x = -30 + i * 12;
      k.cyl('metal', x, -0.2, -24, 0.8, 0.8, 0.5, 0x9aa0a6, 8);
      k.emitter('fountain', x, 0.4, -24, 0.55);
      k.light(x, 0.6, -24, cyan, 3, 'neon');
    }
    // server halls with neon fins and rooftop fans
    for (const x of [-26, 0, 26]) {
      k.box('wall_industrial', x, 0, 6, 22, 10, 24, 0x3a3f46, { top: 'roof_flat', topColor: 0x4a4e54 });
      for (let j = 0; j < 5; j++) k.box('neon', x - 8 + j * 4, 0.6, 18.06, 0.3, 8.6, 0.1, cyan, { top: false });
      k.box('neon', x, 9.3, 18.07, 22, 0.25, 0.1, magenta, { top: false });
      for (const sx of [-1, 1]) {
        const fx = x + sx * 5.5;
        k.cyl('metal', fx, 10, 6, 2.6, 2.6, 1.3, 0x6a6e72, 16, false);
        k.torus('metal', fx, 11.3, 6, 2.5, 0.12, 0x8a8e92, 16, 3);
        k.disc('plain', fx, 10.4, 6, 2.5, 0x1a1c1e, 16);
        k.anim([fx, 11, 6], [0, 1, 0], 4, (a) => {
          for (let b = 0; b < 3; b++) a.rbox('metal', fx, 10.9, 6, 4.6, 0.08, 0.7, (b * Math.PI) / 3, 0xb8bcc0);
          a.cyl('metal', fx, 10.85, 6, 0.4, 0.4, 0.25, 0x4a4e52, 8);
        });
      }
      k.pipe('metal', [x - 4, 2, -6], [x - 4, 2, -15], 0.7, 0xe0e2e4, 10);
      k.pipe('metal', [x + 4, 2, -6], [x + 4, 2, -15], 0.7, 0xe0e2e4, 10);
      for (const zz of [-8, -12]) k.box('concrete', x, 0, zz, 10, 1.3, 0.6, 0x9a9a96);
    }
    // data towers on the shore
    const towers: [number, number, number, number][] = [[-34, -10, 44, cyan], [-12, -11, 36, magenta], [12, -10, 40, cyan], [34, -11, 30, magenta]];
    for (const [x, z, h, col] of towers) {
      k.box('wall_glass', x, 0, z, 6, h, 6, 0x1c2430, { top: 'roof_flat' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('neon', x + sx * 3, 0, z + sz * 3, 0.32, h, 0.32, col);
      k.box('neon', x, h, z, 6.3, 0.45, 6.3, col);
      k.light(x, h + 1, z, col, 9, 'neon');
      k.light(x + 3, h * 0.5, z + 3, col, 6, 'neon');
      k.cyl('metal', x, h + 0.45, z, 0.1, 0.06, 3, 0x333333, 4);
      k.light(x, h + 3.6, z, C.beaconRed, 2.6, 'beacon', true);
    }
    // mechanical cooling cells on a lake platform
    k.box('concrete', -30, -1, -26, 14, 1.4, 8, 0xb0aca4, { top: 'concrete' });
    for (let i = 0; i < 3; i++) {
      const x = -35 + i * 5;
      k.box('wall_industrial', x, 0.4, -26, 4.6, 4.2, 4.6, 0xd8dadc, { top: 'roof_flat' });
      k.cyl('metal', x, 4.6, -26, 1.8, 1.9, 1.6, 0xb8bcc0, 12, false);
      k.emitter('steam', x, 6.4, -26, 0.5);
    }
    // glass lobby + glowing ring sculpture
    k.box('wall_glass', 0, 0, 21.5, 14, 5, 6, 0x9ac4d8, { top: 'roof_flat' });
    k.box('concrete', 0, 5, 22.5, 16, 0.4, 8, 0xe8e8e4, { bottom: true });
    k.box('concrete', 22, 0, 25, 3, 1, 3, 0x6a6e72);
    k.push(new THREE.Matrix4().makeTranslation(22, 5, 25).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.torus('neon', 0, 0, 0, 3.6, 0.35, cyan, 24, 6);
    k.pop();
    k.light(22, 5, 25.6, cyan, 10, 'neon');
    parkingLot(k, -24, 26, 26, 10, 0.7);
    for (let i = 0; i < 4; i++) tree(k, themeTree(k.ctx, 'formal'), 10 + i * 7.5, D / 2 - 3, 0.7, i);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 5, 'modern', 0);
    crowd(k, 2, 26, 14, 4, 6);
    return 48;
  },

  // ── Hanging gardens (modern ziggurat) ───────────────────────────────────
  hanging_gardens(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    const lawn = lawnColor(k.ctx, 0.85);
    k.lot('grass', lawn, 0.2, 0.05);
    const sand = 0xdcc8a0, cz = -3, tiers = 6, th = 8.5, s0 = 31, ds = 4.8;
    const greens = [0x3f7a34, 0x4f8a3a, 0x5a9a44, 0x356a2e];
    for (let i = 0; i < tiers; i++) {
      const s = s0 - i * ds, y = i * th;
      k.box('wall_stone', 0, y, cz, s * 2, th, s * 2, i % 2 ? sand : shade(sand, 0.95), { top: 'grass', topColor: lawn });
      k.box('plain', 0, y + th - 0.5, cz, s * 2 + 0.4, 0.5, s * 2 + 0.4, 0xf0e6d0);
      const last = i === tiers - 1;
      for (let f = 0; f < 4; f++)
        k.at(0, 0, cz, (f * Math.PI) / 2, () => {
          // planter hedge on the ledge edge
          if (!last) k.at(0, y + th, 0, 0, () => hedge(k, 0, s - 0.6, s * 2 - 1.2, 1.0, 1.0, greens[(i + f) % 4]));
          // cascading vines
          const n = Math.floor((s * 2 - 2) / (k.lo ? 4 : 2.2));
          for (let j = 0; j < n; j++) {
            const x = -s + 1.5 + j * ((s * 2 - 3) / Math.max(1, n - 1));
            if (f === 0 && Math.abs(x) < 4) continue;
            const len = r.range(2, th - 1.5);
            k.box('foliage', x, y + th - len, s + 0.28, r.range(1.0, 1.8), len, 0.45, r.pick(greens));
            if (!k.lo && r.chance(0.3)) foliageBlob(k, x, y + th - len, s + 0.5, 0.6, 0.5, 0.4, r.pick([0xe0508a, 0xf2c230, 0xf4f4f0, 0xb05cc8]), j + i, 0.3, 0);
          }
        });
      // trees and flowering shrubs on the ledge above this tier
      if (!last) {
        const trees = k.lo ? 3 : 7;
        for (let t = 0; t < trees; t++) {
          const f = r.int(0, 3), along = r.range(-s + 3, s - 3);
          if (f === 0 && Math.abs(along) < 5) continue;
          const m = s - ds / 2;
          const [lx, lz] = [[along, m], [m, -along], [-along, -m], [-m, along]][f];
          k.at(0, y + th, cz, 0, () => {
            if (r.chance(0.6)) tree(k, themeTree(k.ctx, 'shade'), lx, lz, r.range(0.5, 0.7), r.range(0, 6), r.int(0, 2));
            else bush(k, lx, lz, 1.3, r.pick([0xd05080, 0x4f8a3a, 0xe0a030]), t + i);
          });
        }
        if (i % 2 === 0) for (const sx of [-1, 1]) k.light(sx * (s - 2), y + th + 1.5, cz + s - 1, C.lampWarm, 3, 'lamp');
      }
    }
    // cascading waterfalls down the front
    for (let i = 0; i < tiers; i++) {
      const s = s0 - i * ds, y = i * th;
      k.box('water', 0, y + 0.1, cz + s + 0.3, 4.4, th - 0.1, 0.35, 0x7ccce0, { top: false });
      k.emitter('fountain', 0, y + th, cz + s + 0.6, 0.5);
      if (i > 0) k.box('concrete', 0, y, cz + s + ds / 2, 7, 0.6, ds - 0.6, 0xe8dcc0, { top: 'water', topColor: 0x5fb8d0 });
      k.light(0, y + th * 0.5, cz + s + 1.2, 0x9fe0ff, 5, 'neon');
    }
    k.box('concrete', 0, 0, cz + s0 + 4, 14, 0.7, 7, 0xe8dcc0, { top: 'water', topColor: 0x4fb0c8 });
    k.emitter('steam', 0, 0.8, cz + s0 + 3, 0.5);
    // summit temple
    const ty = tiers * th;
    k.box('plain', 0, ty, cz, 12, 0.5, 12, 0xf0e6d0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.cyl('plain', Math.cos(a) * 5, ty + 0.5, cz + Math.sin(a) * 5, 0.3, 0.26, 3.8, 0xf4ecd8, 8, false);
    }
    k.cyl('plain', 0, ty + 4.3, cz, 5.8, 5.8, 0.7, 0xf0e6d0, 16);
    k.dome('grass', 0, ty + 5, cz, 5.6, lawn, 16, 0.55);
    foliageBlob(k, 0, ty + 8, cz, 2.2, 1.4, 2.2, 0x4f8a3a, 7, 0.3, 1);
    k.light(0, ty + 2, cz, C.lampWarm, 8, 'lamp');
    // ground gardens
    treeGrove(k, 0, 0, W - 4, D - 4, 14, 'shade', (x, z) => Math.abs(x) < s0 + 3 && Math.abs(z - cz) < s0 + 3 || (Math.abs(x) < 9 && z > cz + s0), [0.8, 1.2]);
    for (const sx of [-1, 1]) flowerBed(k, sx * 14, D / 2 - 4, 10, 2.4);
    path(k, [[0, D / 2], [0, cz + s0 + 8]], 5, 0xd8ccb0);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.4, 'classic', 0);
    for (const sx of [-1, 1]) k.light(sx * 20, 20, cz + 30, 0xffe8c0, 30, 'flood');
    crowd(k, 0, cz + s0 + 9, 20, 5, 10);
    return ty + 10.5;
  },

  // ── Eden biomes (geodesic domes) ────────────────────────────────────────
  eden_domes(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.05);
    // terraced crater planting behind the domes
    for (let i = 0; i < 4; i++) {
      const pts: P2[] = [];
      for (let j = 0; j <= 20; j++) {
        const a = Math.PI * 1.08 + (j / 20) * Math.PI * 0.84;
        pts.push([Math.cos(a) * (46 + i * 3.5) * 1.1, 10 + Math.sin(a) * (40 + i * 3) * 0.9]);
      }
      k.ribbon(i % 2 ? 'crop' : 'dirt', pts, 2.6, 0.1 + i * 0.01, i % 2 ? 0x9ab04a : 0x7a6247);
    }
    const etfe = 0xe6eef0, frame = 0xf6f8f8;
    const domes: [number, number, number, number][] = [[-28, -16, 16, 1.1], [-5, -20, 23, 1.25], [18, -16, 18, 1.15], [35, -6, 12, 1.1], [22, 22, 12, 1.1], [37, 27, 8, 1.1]];
    let top = 0;
    for (const [x, z, rr, sy] of domes) {
      geodesicDome(k, x, 0, z, rr, etfe, frame, rr > 15 ? 3 : 2, sy, 'plain');
      k.light(x, rr * sy * 0.45, z, 0xd8ffd0, rr * 1.6, 'lamp');
      top = Math.max(top, rr * sy);
    }
    k.emitter('steam', -5, 23 * 1.25 - 2, -20, 0.3);
    // link building with a sedum roof
    k.box('wall_glass', 8, 0, 6, 34, 5, 8, 0x9ac4d0, { top: 'grass', topColor: 0x8a9a4a });
    for (const sx of [-1, 1]) k.cyl('wall_glass', 8 + sx * 17, 0, 6, 4, 4, 5, 0x9ac4d0, 12, false);
    for (const sx of [-1, 1]) k.disc('grass', 8 + sx * 17, 5, 6, 4, 0x8a9a4a, 12);
    // lake, paths, gardens, visitors
    pond(k, -32, 26, 13, 8, 5, true);
    path(k, [[0, D / 2], [2, 24], [8, 11]], 3.4, 0xd8ccb0);
    path(k, [[2, 24], [-16, 16], [-30, 8]], 2.6, 0xd8ccb0);
    for (let i = 0; i < 4; i++) flowerBed(k, -10 + i * 7, 30, 5, 2.2);
    treeGrove(k, 0, 0, W - 4, D - 4, 18, 'any', (x, z) => domes.some(([dx, dz, rr]) => Math.hypot(x - dx, z - dz) < rr + 3) || (Math.abs(x - 8) < 22 && Math.abs(z - 6) < 7) || Math.hypot(x + 32, z - 26) < 15 || (Math.abs(x) < 6 && z > 14), [0.8, 1.2]);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 4.4, 'modern', 0);
    crowd(k, 2, 22, 24, 10, 16);
    return top;
  },

  // ── Arcology ────────────────────────────────────────────────────────────
  arcology(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    k.lot('paving', 0xc8c6c0, 0.2, 0.05);
    const n = 14, th = 24, s0 = 56;
    const lawn = lawnColor(k.ctx, 0.85);
    const greens = [0x3f7a34, 0x4f8a3a, 0x5a9a44, 0x6a9a3a];
    // concave, mountain-like flare: broad terraced foothills, slender summit
    const sOf = (i: number) => 11 + (s0 - 11) * Math.pow(1 - i / n, 1.7);
    for (let i = 0; i < n; i++) {
      const s = sOf(i), y = i * th, c = s * 0.3;
      const pts = chamfer(s, c);
      const glassTier = i % 3 === 2;
      k.prismWalls(glassTier ? 'wall_glass' : 'wall_office', pts, y, y + th - 0.8, glassTier ? 0xbcd8e4 : jitter(0xd6d8d4, () => r.next(), 0.04));
      k.prismWalls('plain', chamfer(s + 0.4, c + 0.15), y + th - 0.8, y + th, 0xf2f2ee);
      k.poly('grass', chamfer(s + 0.4, c + 0.15), y + th, lawn);
      // vertical gardens on the chamfered corners
      for (let q = 0; q < 4; q++) {
        const a = Math.PI / 4 + (q * Math.PI) / 2;
        const d = (s - c / 2) * Math.SQRT2 * 0.5 * Math.SQRT2;
        k.rbox('foliage', Math.cos(a) * (d + 0.1), y + 2, Math.sin(a) * (d + 0.1), c * 0.9, th - 5, 0.7, Math.PI / 2 - a + Math.PI / 2, r.pick(greens));
      }
      // terrace planting on the exposed ledge
      if (i < n - 1) {
        const ledge = (s + sOf(i + 1)) / 2;
        const count = k.lo ? 4 : 10;
        for (let t = 0; t < count; t++) {
          const f = r.int(0, 3), along = r.range(-ledge + c, ledge - c);
          const [lx, lz] = [[along, ledge], [ledge, -along], [-along, -ledge], [-ledge, along]][f];
          foliageBlob(k, lx, y + th + 1.1, lz, r.range(1.2, 2.2), r.range(1.0, 1.8), r.range(1.2, 2.2), r.pick(greens), t + i * 11, 0.3, 0);
        }
        if (i % 3 === 0) k.at(0, y + th, 0, 0, () => solarRow(k, 0, ledge + 0.2, (sOf(i + 1) - c) * 1.6, 2.2, 0.45, 0.35));
        if (i % 2 === 1) for (let q = 0; q < 4; q++) {
          const a = (q * Math.PI) / 2;
          k.light(Math.cos(a) * (s + 0.5), y + th + 0.5, Math.sin(a) * (s + 0.5), C.lampWarm, 5, 'lamp');
        }
      }
    }
    // grand portals at the base
    for (let f = 0; f < 4; f++) k.at(0, 0, 0, (f * Math.PI) / 2, () => archWindow(k, 0, 0.1, s0 + 0.08, 14, 19, 0xf2f2ee, 0x2e3e4e, 'glass'));
    // crown: garden dome + spire
    const cy = n * th;
    geodesicDome(k, 0, cy, 0, 9, 0xd8ecec, 0xf4f6f6, 2, 1, 'plain');
    k.light(0, cy + 4, 0, 0xd8ffd0, 14, 'lamp');
    k.cyl('metal', 0, cy + 8.5, 0, 1.1, 0.25, 360 - cy - 8.5, 0xdadcde, 8);
    k.light(0, 360, 0, C.beaconRed, 5, 'beacon', true);
    for (const y of [120, 240]) for (const sx of [-1, 1]) k.light(sx * sOf(y / th), y, 0, C.beaconRed, 4, 'beacon', true);
    // tree ring around the base, people
    for (let i = 0; i < (k.lo ? 8 : 20); i++) {
      const a = (i / 20) * Math.PI * 2 + 0.1;
      const rr = 60.5;
      const x = Math.max(-W / 2 + 3, Math.min(W / 2 - 3, Math.cos(a) * rr)), z = Math.max(-D / 2 + 3, Math.min(D / 2 - 3, Math.sin(a) * rr));
      tree(k, themeTree(k.ctx, 'shade'), x, z, 0.8, a, i % 3);
    }
    crowd(k, 0, s0 + 4, 40, 4, 14);
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      k.light(Math.cos(a) * 55, 40, Math.sin(a) * 55, 0xffe8c8, 40, 'flood');
    }
    return 361;
  },

  // ── Helios ignition facility (inertial fusion) ──────────────────────────
  fusion_megaproject(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xc6c8c8, 0.2, 0.05);
    // laser bays
    for (const sx of [-1, 1]) {
      k.box('wall_industrial', sx * 43, 0, 0, 38, 18, 36, 0xe4e6e8, { top: 'roof_flat', topColor: 0xb8bcc0 });
      for (let j = 0; j < 4; j++) k.box('glass', sx * 43, 18, -12 + j * 8, 34, 0.8, 2, 0x9fc4d8, { top: 'glass' });
      k.box('plain', sx * 43, 14, 18.05, 38, 1.2, 0.1, 0x2a6ad0, { top: false });
      for (let j = 0; j < 5; j++) k.light(sx * (27 + j * 8), 16, 18.4, 0x6aa8ff, 3, 'neon');
    }
    // round target hall
    const s = k.seg(32);
    k.cyl('wall_concrete', 0, 0, 0, 20, 20, 12, 0xf0f0ee, s);
    k.cyl('plain', 0, 12, 0, 20.6, 20.6, 0.9, 0xd8dade, s);
    k.box('metal', 0, 3.4, 20.8, 17, 3.4, 0.4, 0x1e2428);
    k.word('HELIOS', 0, 3.9, 21.02, 2.3, 0xffb040, 'emissive', 0.08);
    // target chamber sphere on a pedestal
    const cy = 34, R = 12;
    k.cyl('concrete', 0, 12.9, 0, 5.5, 4.2, 10, 0xd0d2d4, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.beam('metal', [Math.cos(a) * 13, 12.9, Math.sin(a) * 13], [Math.cos(a) * 7, cy - 8, Math.sin(a) * 7], 0.9, 0.9, 0x6a7078);
    }
    k.ball('metal', 0, cy, 0, R, 0xc8ccd0, k.seg(28), k.seg(18));
    k.torus('neon', 0, cy, 0, R + 0.08, 0.55, 0xffa040, s, 5);
    k.light(0, cy, 0, 0xffa040, 30, 'flood');
    // beamlines from the laser bays into ports on the sphere
    const C0 = new THREE.Vector3(0, cy, 0);
    for (const sx of [-1, 1])
      for (let yi = 0; yi < 3; yi++)
        for (let zi = 0; zi < 4; zi++) {
          const y = 12 + yi * 2.2, z = -9 + zi * 6;
          const start: V3 = [sx * 24, y, z];
          const mid: V3 = [sx * 17, y + 11 + yi * 2, z * 0.75];
          const dir = new THREE.Vector3(mid[0], mid[1], mid[2]).sub(C0).normalize();
          const port = C0.clone().addScaledVector(dir, R);
          const out = C0.clone().addScaledVector(dir, R + 1.4);
          k.polyPipe('metal', [start, mid, [out.x, out.y, out.z]], 0.45, 0xb8bcc2, 6);
          k.pipe('metal', [port.x, port.y, port.z], [out.x, out.y, out.z], 0.8, 0x8a9096, 8, true);
          k.light(out.x, out.y, out.z, 0xffc070, 1.8, 'lamp');
        }
    // gantry towers + ring truss
    const g = 15;
    for (const gx of [-1, 1]) for (const gz of [-1, 1]) {
      k.lattice('metal', gx * g, gz * g, 12.9, 52, 1.3, 1.0, 0x4a5058, 6, 0.32, 0.12);
      k.light(gx * g, 52.5, gz * g, C.beaconRed, 3, 'beacon', true);
    }
    for (const [a, b] of [[[-g, -g], [g, -g]], [[g, -g], [g, g]], [[g, g], [-g, g]], [[-g, g], [-g, -g]]] as [P2, P2][]) k.truss('metal', [a[0], 49, a[1]], [b[0], 49, b[1]], 2.6, 0x4a5058, 8, 0.3, 0.12);
    k.box('metal', 0, 51.2, -g, 3, 2, 3, C.yellow);
    // cooling towers, switchyard, visitor centre
    coolingTower(k, -36, -44, 90, 17, 0xdcd9d2, true, 0.8);
    coolingTower(k, 36, -44, 90, 17, 0xdcd9d2, true, 0.8);
    switchyard(k, 0, -48, 30, 24, 3);
    k.box('wall_glass', 40, 0, 40, 18, 6, 12, 0x9ac4d8, { top: 'roof_flat' });
    k.box('concrete', 40, 6, 41.5, 20, 0.4, 15, 0xe8e8e4, { bottom: true });
    parkingLot(k, 12, 44, 30, 16, 0.6);
    for (let i = 0; i < 5; i++) flagpole(k, -24 + i * 5, 30, 10, [0x2a6ad0, 0xf4f4f4, 0xffb040][i % 3], 0xf4f4f4);
    for (let i = 0; i < 5; i++) tree(k, themeTree(k.ctx, 'formal'), -W / 2 + 5 + i * 9, D / 2 - 4, 0.8, i);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 6, 'modern', 0);
    crowd(k, 30, 36, 20, 6, 10);
    return 90;
  },

  // ── Pyramid of light ────────────────────────────────────────────────────
  wonder_pyramid(k) {
    const W = k.W, D = k.D;
    const sandstone = 0xd8bc8a;
    plaza(k, 0xd8ccb0, 0xb8ac90);
    const S = 50, H = 128, cz = -4;
    const apex = { x: 0, y: H, z: cz };
    const corners: P2[] = [[S, S], [-S, S], [-S, -S], [S, -S]];
    const glass = 0xbcd2e4;
    // mirrored-glass faces (meter UVs so the curtain grid runs level)
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (ax + bx) / 2, nz = (az + bz) / 2;
      k.tri('wall_glass', { x: ax, y: 0, z: cz + az }, { x: bx, y: 0, z: cz + bz }, apex, [0, 0], [len, 0], [len / 2, H], f % 2 ? glass : shade(glass, 0.94), { x: nx, y: S * 0.4, z: nz });
    }
    // frame belts, glowing edges, capstone
    for (let y = 16; y < H - 8; y += 16) {
      const s = S * (1 - y / H) + 0.3;
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
        k.beam('metal', [(ax / S) * s, y, cz + (az / S) * s], [(bx / S) * s, y, cz + (bz / S) * s], 0.6, 0.6, 0x2a3038);
      }
    }
    for (const [x, z] of corners) k.beam('neon', [x * 1.005, 0, cz + z * 1.005], [0, H - 5.5, cz], 0.9, 0.9, 0xffd070);
    const cs = S * (6 / H) * 2;
    k.pyramid('metal', 0, H - 6, cz, cs, cs, 6.4, C.gold);
    k.ball('emissive', 0, H + 0.6, cz, 1.2, 0xffffff, 8, 5);
    // the beam of light: a column of glows into the night sky
    k.light(0, H + 2, cz, 0xffffff, 28, 'flood');
    for (let y = H + 5; y < H + 330; y += 6) k.light(0, y, cz, 0xe4ecff, 13 + (y - H) * 0.02, 'lamp');
    // entrance porch
    k.pyramid('glass', 0, 0, cz + S + 3, 12, 8, 7, 0xa8c4d4);
    // processional avenue: obelisks, sphinxes, palms, pools
    k.slab('paving', 0, cz + S + 10, 14, 22, 0.08, 0xe0d4b8, 0.1);
    for (const sx of [-1, 1]) {
      obelisk(k, sx * 9, 52, 20, 0xc8b89c);
      sphinx(k, sx * 20, 44, 3, sandstone);
      k.box('concrete', sx * 40, 0, 44, 18, 0.5, 26, 0xd0c4a8, { top: false });
      k.flat('water', sx * 40, 44, 17, 25, 0.4, 0x3f8fa8);
      for (let i = 0; i < 3; i++) tree(k, themeTree(k.ctx, 'formal'), sx * 7, cz + S + 6 + i * 6, 0.75, i + sx);
    }
    for (const [x, z] of corners) flood(k, x * 1.1, cz + z * 1.1, 30, 40, 0xffe2b8);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 5, 'modern', 0);
    crowd(k, 0, D / 2 - 6, 30, 6, 14);
    return 140;
  },

  // ── Space elevator ──────────────────────────────────────────────────────
  space_elevator(k) {
    const W = k.W, D = k.D;
    const blue = 0x4ab8ff;
    k.lot('paving', 0xcdd0d2, 0.2, 0.05);
    const s = k.seg(40);
    // circular anchor platform + ring terminal
    k.cyl('concrete', 0, 0, 0, 40, 40, 1.6, 0xb8bcc0, s);
    k.rev('wall_glass', 0, 1.6, 0, [[38, 0], [38, 9.4]], 0x9ab8cc, s);
    k.rev('wall_glass', 0, 1.6, 0, [[29, 0], [29, 9.4]], 0x9ab8cc, s, { inside: true });
    k.ring('roof_flat', 0, 11, 0, 29, 38.2, 0x6a6d70, s);
    k.rev('neon', 0, 10.4, 0, [[38.15, 0], [38.15, 0.6]], blue, s);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.at(Math.cos(a) * 38.1, 0, Math.sin(a) * 38.1, Math.PI / 2 - a, () => k.box('glass', 0, 1.6, 0, 5, 3.6, 0.3, 0x2e3e4e, { top: false }));
    }
    // anchor tower with arching buttresses
    const tp: P2[] = [[16, 0], [13.5, 14], [9, 34], [5.5, 52], [3.6, 62], [3.2, 66]];
    k.rev('concrete', 0, 1.6, 0, tp, 0xe4e6e8, k.seg(28), { crease: 60 });
    for (const [y, rr] of [[15.6, 13.3], [35.6, 8.9], [53.6, 5.4]] as P2[]) k.torus('neon', 0, y, 0, rr + 0.15, 0.3, blue, k.seg(28), 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pts: V3[] = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        const rr = 33 - 23.5 * t, y = 11 + 26 * Math.sin((t * Math.PI) / 2);
        pts.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
      }
      k.polyPipe('concrete', pts, 1.1, 0xdcdee0, 8);
    }
    k.cyl('metal', 0, 67.6, 0, 4.2, 3.4, 3, 0x6a7078, 12);
    // the tether with LED strips, beacons and climbers
    const t0 = 70.6, t1 = 820;
    k.cyl('metal', 0, t0, 0, 1.4, 0.45, t1 - t0, 0x30343a, 8, true);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.beam('neon', [Math.cos(a) * 1.45, t0, Math.sin(a) * 1.45], [Math.cos(a) * 0.5, t1, Math.sin(a) * 0.5], 0.18, 0.1, blue);
    }
    for (let y = 100, i = 0; y <= t1; y += 40, i++) k.light(1.6, y, 0, i % 2 ? C.beaconRed : 0xffffff, 3 + y / 180, 'beacon', true);
    k.light(0, t1 + 1, 0, 0xffffff, 8, 'beacon', true);
    for (const y of [190, 430, 680]) {
      k.rev('metal', 0, y, 0, [[1.6, 0], [4.2, 1.5], [4.4, 7], [3.6, 9], [1.6, 10]], 0xe8eaec, 14, { crease: 50 });
      k.rev('emissive', 0, y + 4, 0, [[4.46, 0], [4.46, 1.1]], 0xbfe4ff, 14);
      for (let q = 0; q < 4; q++) k.light(Math.cos((q * Math.PI) / 2) * 4.8, y + 4.5, Math.sin((q * Math.PI) / 2) * 4.8, 0xbfe4ff, 4, 'lamp');
    }
    // landing pads with a spaceplane, radar dishes, solar arrays
    for (const sx of [-1, 1]) k.helipad(sx * 40, 0.1, 40, 7, true);
    airplane(k, -40, 40, 0.6, 0.45, 0xf4f4f4, 0.35);
    for (const sx of [-1, 1]) {
      k.box('concrete', sx * 40, 0, -40, 6, 6, 6, 0xd8dadc);
      radarDish(k, sx * 40, 8.4, -40, 4, sx * 0.4);
    }
    for (let i = 0; i < 4; i++) solarRow(k, 40, 12 + i * 4, 12, 3, 0.45, 0.6);
    for (let i = 0; i < 4; i++) solarRow(k, -40, 12 + i * 4, 12, 3, 0.45, 0.6);
    for (let i = 0; i < 6; i++) flagpole(k, -12 + i * 5, 44, 10, [0x2a6ad0, 0xf4f4f4][i % 2], 0xf4f4f4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.light(Math.cos(a) * 20, 30, Math.sin(a) * 20, 0xdff0ff, 34, 'flood');
    }
    crowd(k, 0, 43, 26, 4, 12);
    person(k, -36, 34, 0xf4f4f4, 0.5);
    return 822;
  },
};

export const MONUMENT_MODELS = models(M);
