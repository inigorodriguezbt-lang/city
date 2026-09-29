// Government, tourism and special industry facilities.
import * as THREE from 'three';
import { Kit, type P2, type V3 } from './kit';
import { C, shade, mix, lawnColor, civicLook, dryGround } from './colors';
import { models } from './define';
import { bench, bus, car, chimney, container, containerStack, conveyor, crowd, fence, flagpole, flowerBed, hedge, lampPost, logPile, parkedCars, person, pile, sphereTank, tank, tractor, tree, themeTree, truck, umbrella, van } from './props';
import { antennaMast, archWindow, civicBlock, clockFace, hall, lampsAlong, pipeRack, portico, rollDoors, statueFigure } from './arch';

// ── shared bits ────────────────────────────────────────────────────────────
/** row of flagpoles with varied flags */
function flags(k: Kit, x0: number, x1: number, z: number, n: number, h = 9): void {
  const pal: [number, number][] = [[0xd8272f, 0xf4f4f4], [0x2f5fa8, 0xf2c230], [0x3fa05a, 0xf4f4f4], [0x1a1a1a, 0xd8272f], [0xf2c230, 0x2f5fa8], [0xf4f4f4, 0xd8272f], [0x2f9fd0, 0xf4f4f4]];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    const p = pal[(i * 3 + Math.floor(k.rnd() * 7)) % pal.length];
    flagpole(k, x, z, h, p[0], p[1]);
  }
}

/** truck loading docks on a +Z wall */
function docks(k: Kit, x: number, z: number, n: number, pitch: number, h = 4, color = 0x3a6fd8): void {
  for (let i = 0; i < n; i++) {
    const dx = x - ((n - 1) * pitch) / 2 + i * pitch;
    k.box('metal', dx, 1.2, z + 0.06, 3, h - 1.2, 0.1, 0xb8bcc0, { top: false });
    k.box('plain', dx, 1.1, z + 0.4, 3.4, 0.2, 0.8, 0x2a2a2a);
    k.box('plain', dx - 1.9, 0, z + 0.3, 0.3, 1.2, 0.6, 0xf2c230);
    k.box('plain', dx + 1.9, 0, z + 0.3, 0.3, 1.2, 0.6, 0xf2c230);
    k.box('metal', dx, h + 0.1, z + 0.6, 4, 0.2, 1.4, color);
    k.light(dx, h - 0.2, z + 0.8, C.lampWarm, 2, 'lamp');
  }
}

/** tall grain silo with conical cap */
function silo(k: Kit, x: number, z: number, r: number, h: number, color = 0xdcdcd6): void {
  k.cyl('metal', x, 0, z, r, r, h, color, k.seg(16), false);
  k.rev('metal', x, h, z, [[r * 1.02, 0], [r * 0.2, r * 0.65], [0.3, r * 0.7]], shade(color, 0.92), k.seg(16));
  if (!k.lo) for (let y = 3; y < h; y += 3) k.torus('metal', x, y, z, r + 0.03, 0.05, shade(color, 0.8), k.seg(16), 3);
}

/** distillation column with platforms */
function column(k: Kit, x: number, z: number, r: number, h: number, color = 0xd8d8d2): void {
  k.cyl('metal', x, 0, z, r, r, h, color, k.seg(12));
  k.dome('metal', x, h, z, r, color, k.seg(12), 0.5, 4);
  const plats = Math.floor(h / 8);
  for (let i = 1; i <= plats; i++) {
    k.ring('metal', x, i * 8, z, r, r + 1, 0x8a8e92, k.seg(12));
    if (!k.lo) k.torus('metal', x, i * 8 + 1, z, r + 0.95, 0.05, C.yellow, k.seg(12), 3);
  }
  k.beam('metal', [x + r + 0.5, 0, z], [x + r + 0.5, h, z], 0.1, 0.6, C.yellow);
  k.light(x, h + r * 0.5 + 0.4, z, C.beaconRed, 2.2, 'beacon', true);
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  city_hall(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['mansard', 'hip', 'dome', 'gable', 'pagoda', 'flat']);
    k.lot('paving', 0xd8d0c0, 0.2, 0.05);
    const stone = look.modern ? look.wallColor : mix(look.wallColor, 0xece2cc, 0.45);
    const wall = look.modern ? look.wall : look.wall === 'wall_brick' ? 'wall_brick' : 'wall_stone';
    const roof = look.roof === 'flat' && !look.modern ? 'mansard' : look.roof;
    // symmetrical wings + central pavilion with portico and tower
    for (const s of [-1, 1]) civicBlock(k, look, s * 14, -8, 16, 20, 3, { wall, color: stone, roof });
    const ct = civicBlock(k, look, 0, -8, 14, 24, 4, { wall, color: stone, roof: 'flat' });
    portico(k, 0, 5.4, 14, 3.8, 9.5, 6, look.modern ? 0xf2f2f0 : 0xf2ecde, 1.4, look.roofColor);
    let top = ct;
    if (look.modern) {
      k.box('wall_glass', 0, ct, -10, 10, 8, 10, 0xb8d4e4, { top: 'roof_flat' });
      top = ct + 8;
    } else {
      const tb = ct + 0.8;
      k.box(wall, 0, ct, -10, 8, 8, 8, stone, { top: false });
      for (let s = 0; s < 4; s++) k.at(0, 0, -10, (s * Math.PI) / 2, () => clockFace(k, 0, tb + 4, 4.05, 1.8, C.gold, 1.4 + s, -0.4 + s));
      k.box('plain', 0, ct + 8, -10, 9, 0.6, 9, 0xf2ecde);
      k.cyl(wall, 0, ct + 8.6, -10, 3.2, 3.2, 3.2, stone, 16);
      k.dome('roof_metal', 0, ct + 11.8, -10, 3.4, C.copper, 16, 1.25);
      k.cyl('metal', 0, ct + 16, -10, 0.3, 0.1, 3, C.gold, 6);
      top = ct + 19;
    }
    // forecourt: fountain, flags, lawns, lamps
    k.disc('water', 0, 0.35, 15, 3.4, 0x4fa8b8, 18);
    k.cyl('concrete', 0, 0, 15, 3.8, 3.8, 0.5, 0xe0d8c8, 18, false);
    k.ring('concrete', 0, 0.5, 15, 3.4, 3.8, 0xe8e0d0, 18);
    k.emitter('fountain', 0, 0.8, 15, 0.8);
    flags(k, -8, 8, 10.5, 3, 11);
    for (const s of [-1, 1]) {
      k.slab('grass', s * 15, 15, 12, 12, 0.08, lawnColor(k.ctx, 0.75), 0.1);
      flowerBed(k, s * 15, 15, 6, 2, [0xe0414f, 0xf5f0f0]);
      tree(k, themeTree(k.ctx, 'formal'), s * 20, 19, 0.7, s);
      tree(k, themeTree(k.ctx, 'formal'), s * 10, 19, 0.7, s + 2);
    }
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 8, 4.4, 'classic', 0);
    for (const s of [-1, 1]) k.light(s * 8, 0.5, 6, 0xfff0d0, 8, 'flood');
    crowd(k, 0, 17, 30, 8, 10);
    return top;
  },

  courthouse(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xd8d0c0, 0.2, 0.05);
    const stone = 0xe8e0cc;
    k.box('wall_stone', 0, 0, -4, 40, 2, 20, 0xcfc6b2, { top: 'paving', topColor: 0xd8d0c0 });
    k.box('wall_stone', 0, 2, -5, 38, 12, 18, stone, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('plain', 0, 13.4, -5, 39, 0.8, 19, 0xf0e8d6);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) archWindow(k, s * (8 + i * 4.4), 4, 4.05, 1.8, 5.5, 0xf0e8d6);
    const top = portico(k, 0, 7.2, 20, 5, 11, 8, 0xf2ecde, 2, look.roofColor);
    k.stairs(0, 9.6, 22, 2, 0xd8d0c0);
    // Lady Justice on a pedestal
    k.box('wall_stone', 0, 0, 13.2, 2.4, 2.6, 2.4, 0xb8b0a0, { top: 'concrete' });
    statueFigure(k, 0, 2.6, 13.2, 1.3, C.gold, 0, 'raise');
    k.box('metal', 0.6, 5.3, 13.2, 0.9, 0.04, 0.04, C.gold);
    flags(k, -16, -12, 13, 2, 10);
    for (const s of [-1, 1]) tree(k, themeTree(k.ctx, 'formal'), s * 20, 12, 0.75, s);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 8, 4.2, 'classic', 0);
    return top;
  },

  tax_office(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xd0cabd, 0.2, 0.05);
    const top = civicBlock(k, look, 0, -3, 26, 20, 5, { roof: 'flat', wall: 'wall_office', color: mix(look.wallColor, 0xe8e6e0, 0.4) });
    k.box('wall_glass', 0, 0, 7.3, 12, 4, 0.8, 0xb8d4e4, { top: 'roof_flat' });
    k.entrance(0, 7.7, 4, 3, true);
    // coin emblem sign
    k.push(new THREE.Matrix4().makeTranslation(9, 14, 7.2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.cylinder('emissive', 0, 0, 0, 1.6, 1.6, 0.25, C.gold, 20, { top: true });
    k.pop();
    k.box('emissive', 9, 13.2, 7.5, 0.3, 1.6, 0.1, 0x8a6a1a);
    k.light(9, 14, 8, 0xffe08a, 4, 'neon');
    k.sign(-5, 14.2, 7.25, 8, 1.1, 0x2f5fa8, 0x9fc4ff);
    parkedCars(k, -12, D / 2 - 2, 12, D / 2 - 2, 2.8, Math.PI / 2, 0.7);
    flagpole(k, -12, 9, 9, 0x2f5fa8, 0xf4f4f4);
    return top;
  },

  embassy(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['hip', 'mansard', 'gable']);
    k.lot('grass', lawnColor(k.ctx, 0.75), 0.2, 0.04);
    // elegant villa behind railings, flags of many nations
    const stone = mix(look.wallColor, 0xf2ece0, 0.5);
    const roof = look.roof === 'flat' ? 'hip' : look.roof;
    const top = civicBlock(k, look, 0, -5, 28, 14, 3, { color: stone, roof, wall: look.wall === 'wall_brick' ? 'wall_brick' : 'wall_stone' });
    k.colonnade(-5, 5, 2.8, 4, 0.35, 6.6, 0xf4f0e6, 0.9);
    k.box('plain', 0, 7.5, 3.4, 12, 0.5, 2.4, 0xf4f0e6);
    k.ribbon('paving', [[0, D / 2], [0, 4]], 4, 0.08, 0xd8d0c0);
    k.disc('paving', 0, 0.09, 8, 5, 0xd8d0c0, 20);
    k.disc('grass', 0, 0.1, 8, 2.6, lawnColor(k.ctx, 0.9), 16);
    flowerBed(k, 0, 8, 2, 2, [0xe0414f]);
    flags(k, -20, 20, 12.5, 7, 8);
    fence(k, [[-W / 2 + 0.6, D / 2 - 0.6], [-3, D / 2 - 0.6]], 2.4, 0x1e1e1e, 1.4);
    fence(k, [[3, D / 2 - 0.6], [W / 2 - 0.6, D / 2 - 0.6]], 2.4, 0x1e1e1e, 1.4);
    for (const s of [-1, 1]) {
      k.box('wall_stone', s * 3, 0, D / 2 - 0.6, 0.8, 3, 0.8, 0xcfc6b2);
      k.light(s * 3, 3.3, D / 2 - 0.6, C.lampWarm, 2.4, 'lamp');
    }
    k.box('glass', -18, 0, D / 2 - 4, 3, 2.8, 3, 0x2c3a46, { top: 'plain', topColor: 0xe8e8e4 });
    hedge(k, -18, -12, 8, 1, 1.4);
    hedge(k, 18, -12, 8, 1, 1.4);
    car(k, 8, 6, Math.PI / 2, 0x1a1a1a, 'suv');
    return top;
  },

  post_office(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xd0cabd, 0.2, 0.05);
    const top = civicBlock(k, look, 0, -4, 24, 16, 2, { roof: look.modern ? 'flat' : look.roof });
    k.box('plain', 0, 3.6, 4.35, 24.4, 0.9, 0.2, C.yellow, { top: false });
    k.sign(-4, 3.7, 4.5, 8, 0.7, 0x1f3f7a, 0xfff0a0, C.yellow);
    k.entrance(-4, 4.2, 3, 2.8, true, 0x1f3f7a, C.yellow);
    // loading dock at the side with mail vans, post box out front
    rollDoors(k, 7, 4.2, 6, 1, 3.2, 0xc8ccd0);
    for (let i = 0; i < 3; i++) van(k, 5 + i * 4.4, D / 2 - 4, Math.PI / 2, C.yellow, 0x1f3f7a);
    k.box('metal', -12, 0, 10, 0.6, 1.4, 0.5, 0xd8272f, { top: 'metal', topColor: 0xb81f27 });
    k.box('plain', -12, 1, 10.26, 0.4, 0.06, 0.02, 0x1a1a1a, { top: false });
    k.cyl('metal', -9, 0, 10.5, 0.35, 0.35, 1.3, C.yellow, 10);
    bench(k, -7, 11, Math.PI);
    tree(k, themeTree(k.ctx, 'shade'), -13, -13, 0.8);
    return top;
  },

  sorting_facility(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    hall(k, -2, -6, 52, 28, 11, { roof: 'flat', color: 0xe6e6e0, roofColor: 0x5a5e62 });
    k.box('plain', -2, 8.6, 8.06, 52, 1.4, 0.1, C.yellow, { top: false });
    k.box('plain', -2, 8.6, 8.12, 20, 1.4, 0.1, 0x1f3f7a, { top: false });
    k.sign(-2, 8.8, 8.2, 8, 1, 0xf4f4f4, 0xfff0a0, 0x1f3f7a);
    docks(k, -2, 8, 8, 5.8, 4.4, 0x1f3f7a);
    for (let i = 0; i < 4; i++) truck(k, -22 + i * 11.6, 16, Math.PI / 2 * 3, C.yellow, 0xf4f4f4, 'box', 11);
    for (let i = 0; i < 5; i++) van(k, 24, -18 + i * 4, 0, C.yellow, 0x1f3f7a);
    k.hvac(-2, 11, -6, 52, 28, 5);
    return 13;
  },

  radio_mast(k) {
    k.lot('grass', lawnColor(k.ctx, 0.35), 0.2, 0.04);
    k.slab('dirt', 0, 0, 13, 13, 0.08, dryGround(k.ctx), 0.2);
    // self-supporting broadcast tower: flared lattice legs in red/white bands
    const H = 104, bands = 8, tz = -1;
    const hw = (t: number) => 0.8 + 4.3 * Math.pow(1 - t, 2.4);
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands, t1 = (i + 1) / bands;
      k.lattice('metal', 0, tz, H * t0, H * t1, hw(t0), hw(t1), i % 2 ? 0xd8412f : 0xf2f2f0, Math.max(3, H / bands / 3), 0.34 - t0 * 0.18, 0.1);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as P2[]) k.box('concrete', sx * hw(0), 0, tz + sz * hw(0), 1.5, 0.6, 1.5, 0xb8b4aa);
    // service platforms with microwave dishes, panel antennas near the top
    for (const t of [0.42, 0.7]) {
      const y = H * t, w = hw(t) * 2 + 1.4;
      k.box('metal', 0, y, tz, w, 0.2, w, 0x8a8e92);
      for (let d = 0; d < 3; d++) {
        k.at(0, y + 0.9, tz, d * 2.1 + t * 3, () => {
          k.push(new THREE.Matrix4().makeTranslation(0, 0, w / 2 + 0.3).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
          k.cylinder('metal', 0, -0.2, 0, 0.85, 0.85, 0.45, 0xf4f4f4, 12, { top: true, bottom: true });
          k.pop();
        });
      }
    }
    for (let a = 0; a < 6; a++) k.at(0, H * 0.86, tz, (a * Math.PI) / 3, () => k.box('metal', 0, 0, hw(0.86) + 0.35, 0.45, 2.6, 0.18, 0xe8e8e4));
    k.cyl('metal', 0, H, tz, 0.35, 0.14, 14, 0xf2f2f0, 6);
    for (const t of [0.33, 0.66, 1]) for (const s of [-1, 1]) k.light(s * (hw(t) + 0.2), H * t, tz, C.beaconRed, 3 + t * 2.5, 'beacon', true);
    k.light(0, H + 14.2, tz, C.beaconRed, 5, 'beacon', true);
    // equipment hut + fence
    k.box('wall_concrete', 0, 0, tz, 3.6, 3, 3, 0xd8d6d0, { top: 'roof_flat' });
    k.box('metal', 0, 0.05, tz + 1.52, 1, 2.1, 0.06, 0x5a6168);
    k.light(0, 2.5, tz + 1.8, C.lampWarm, 2.4, 'lamp');
    fence(k, [[-7, -7], [7, -7], [7, 7], [-7, 7]], 2, 0x8a9096, 2.6, 'metal', true);
    return H + 14.4;
  },

  visitor_center(k) {
    const D = k.D;
    const lawn = lawnColor(k.ctx, 0.7);
    k.lot('grass', lawn, 0.2, 0.04);
    k.slab('paving', -1, 7, 28, 16, 0.08, 0xd8d0c0, 0.2);
    // timber-and-glass pavilion on a stone plinth
    const px = -3, pz = -6.5;
    k.box('wall_stone', px, 0, pz, 19, 0.35, 11, 0xb8ad98, { top: 'paving', topColor: 0xcfc6b4 });
    k.box('wall_glass', px, 0.35, pz, 18, 4.2, 10, 0xbcd6e4, { top: false });
    k.box('wall_stone', px, 0.35, pz - 4.75, 18.4, 4.2, 0.7, C.stone, { top: false });
    for (let i = 0; i < 10; i++) k.box('wood', px - 8.5 + i * 1.9, 0.35, pz + 5.15, 0.16, 4.2, 0.45, C.woodLight, { top: false });
    k.entrance(px, pz + 5.05, 3, 2.8, false, C.woodDark);
    // sweeping green roof: timber soffit, sedum top, thick fascia
    const x0 = -15, x1 = 9, z0 = -14, z1 = 2, t = 0.6;
    const yb = (u: number, v: number) => 4.8 + 1.5 * Math.sin(Math.PI * u) + 0.6 * v;
    const X = (u: number) => x0 + (x1 - x0) * u, Z = (v: number) => z0 + (z1 - z0) * v;
    const nu = k.seg(16);
    const sedum = mix(lawnColor(k.ctx, 0.9), 0x6b7a3a, 0.45);
    k.surface('grass', nu, 3, (u, v) => [X(u), yb(u, 1 - v) + t, Z(1 - v)], sedum);
    k.surface('wood', nu, 3, (u, v) => [X(u), yb(u, v), Z(v)], C.woodLight);
    k.surface('wood', nu, 1, (u, v) => [X(u), yb(u, 1) + v * t, Z(1)], C.wood);
    k.surface('wood', nu, 1, (u, v) => [X(u), yb(u, 0) + (1 - v) * t, Z(0)], C.wood);
    k.surface('wood', 1, 1, (a, b) => [x0, yb(0, a) + b * t, Z(a)], C.wood);
    k.surface('wood', 1, 1, (a, b) => [x1, yb(1, 1 - a) + b * t, Z(1 - a)], C.wood);
    // V-shaped timber struts under the overhangs
    for (const sx of [-12, -3, 6]) for (const sz of [0.8, -12.6]) {
      const y = yb((sx - x0) / (x1 - x0), (sz - z0) / (z1 - z0));
      k.pipe('wood', [sx, 0.05, sz], [sx - 1.5, y, sz], 0.15, C.wood, 6);
      k.pipe('wood', [sx, 0.05, sz], [sx + 1.5, y, sz], 0.15, C.wood, 6);
    }
    for (const sx of [-10, -3, 4]) k.light(sx, 5, 0.5, C.lampWarm, 3.4, 'lamp');
    // timber lookout tower with a shingled hat
    const tx = 11, tz = -9;
    k.lattice('wood', tx, tz, 0, 15, 2.2, 1.6, C.wood, 3.75, 0.32, 0.12);
    k.box('wood', tx, 15, tz, 4.6, 0.3, 4.6, C.woodLight);
    for (const [cx, cz] of [[-2.2, -2.2], [2.2, -2.2], [2.2, 2.2], [-2.2, 2.2]] as P2[]) k.box('wood', tx + cx, 15.3, tz + cz, 0.2, 2.9, 0.2, C.woodDark);
    for (const s of [-1, 1]) {
      k.box('wood', tx, 16.2, tz + s * 2.2, 4.4, 0.12, 0.1, C.woodDark);
      k.box('wood', tx + s * 2.2, 16.2, tz, 0.1, 0.12, 4.4, C.woodDark);
    }
    k.pyramid('roof_shingle', tx, 18.2, tz, 5.4, 5.4, 1.9, 0x5a4636);
    k.at(tx - 0.8, 15.3, tz + 1.2, 0.4, () => person(k, 0, 0, 0xd8412f));
    k.light(tx, 17.9, tz, C.lampWarm, 3, 'lamp');
    // big "i" totem, lit map boards, flags, tour bus
    k.box('metal', 10, 0, 9, 1.4, 5.5, 0.4, 0x2f7fd0);
    k.glyph('i', 10, 1.4, 9.22, 3.4, 0xf4f4f4, 'emissive', 0.06);
    k.light(10, 4, 9.8, 0x7fc0ff, 4, 'neon');
    for (const x of [-8.5, -5]) {
      k.box('metal', x, 0, 9.5, 0.1, 1, 0.1, 0x333333);
      k.box('plain', x, 1, 9.5, 2.4, 1.6, 0.12, 0x3a6a4a);
      k.box('emissive', x, 1.15, 9.57, 2.1, 1.3, 0.02, 0xe8e0c8);
    }
    flags(k, -14, -11, 13, 3, 8);
    flowerBed(k, -12, 7.5, 5, 2.5);
    bus(k, 1.5, D / 2 - 2.6, 0, 0xf2f2ee, 12);
    bench(k, -12, 4, 0);
    bench(k, 5, 4, 0);
    lampPost(k, -9.5, 12, 4.4);
    lampPost(k, 6.5, 4.6, 4.4);
    crowd(k, -2, 6, 18, 6, 10);
    tree(k, themeTree(k.ctx, 'shade'), -14, -13, 0.8);
    tree(k, themeTree(k.ctx, 'shade'), 13.5, 3, 0.75, 1, 1);
    tree(k, themeTree(k.ctx, 'shade'), 13.5, 14, 0.7, 2, 2);
    return 20.1;
  },

  hotel(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xd0cabd, 0.2, 0.05);
    // podium with lobby + slim tower, vertical neon "HOTEL" blade sign
    k.box('wall_glass', 0, 0, 2, 28, 5, 24, 0xc8dce8, { top: 'roof_flat', topColor: 0x5a5e62 });
    const floors = 10;
    const tw = 24, td = 14;
    const tc = mix(look.wallColor, 0xf0ece4, 0.3);
    k.box(look.modern ? 'wall_glass' : 'wall_office', 0, 5, -4, tw, floors * 3.3, td, tc, { top: 'roof_flat', topColor: 0x5a5e62 });
    if (!k.lo) for (let f = 1; f < floors; f++) for (let i = 0; i < 6; i++) {
      k.box('concrete', -10 + i * 4, 5 + f * 3.3, 3.6, 2.8, 0.15, 1.2, 0xe8e6e0);
      k.box('glass', -10 + i * 4, 5.15 + f * 3.3, 4.15, 2.8, 0.9, 0.05, 0x9ab8c8, { top: false });
    }
    const th = 5 + floors * 3.3;
    k.parapet(0, th, -4, tw, td, 1, shade(tc, 0.9));
    k.box('plain', 0, th + 1, -4, 12, 3, 8, 0x3a3d42, { top: 'roof_flat' });
    // rooftop pool
    k.box('concrete', 7, th, -4, 8, 0.8, 10, 0xe8e2d4, { top: 'water', topColor: 0x4fc0d8 });
    k.box('metal', 12.6, 6, 3.6, 1, 22, 0.8, 0x2a2d31);
    'HOTEL'.split('').forEach((ch, i) => {
      const y = 22 - i * 3.6;
      k.box('emissive', 12.6, 6 + y, 4.05, 0.8, 3, 0.1, 0xff4f7a);
      if (!k.lo) k.glyph(ch, 12.6, 6.3 + y, 4.14, 2.3, 0xfff0f4, 'emissive', 0.05);
    });
    k.light(12.6, 18, 5, 0xff4f7a, 10, 'neon');
    // entrance canopy with drop-off
    k.box('metal', 0, 4, 16, 14, 0.4, 7, 0xd8c8a0, { bottom: true, top: 'metal' });
    for (const s of [-1, 1]) k.cyl('metal', s * 6.5, 0, 19, 0.2, 0.2, 4, C.gold, 8);
    k.light(0, 3.8, 16, C.lampWarm, 5, 'lamp');
    taxi2(k, -3, 20);
    car(k, 4, 20, 0, 0x1a1a1a, 'sedan');
    for (const s of [-1, 1]) tree(k, themeTree(k.ctx, 'formal'), s * 12, 20, 0.7, s);
    return th + 4;
  },

  resort(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.75), 0.2, 0.04);
    const white = 0xf6f2ea;
    // terraced main building (stepping back each floor) wrapping a lagoon pool
    for (let f = 0; f < 6; f++) {
      k.box('wall_plaster', -18, f * 3.3, -14 + f * 1.6, 30, 3.3, 14 - f * 1.6, white, { top: 'roof_flat', topColor: 0xd8d0c0 });
      if (!k.lo) k.box('foliage', -18, (f + 1) * 3.3, -7 + f * 0.8 - 0.4 + (14 - f * 1.6) / 2 - 1.2, 29, 0.35, 0.6, 0x4a8a3a);
    }
    k.box('wall_plaster', 22, 0, -8, 14, 13.2, 26, white, { top: 'roof_flat', topColor: 0xd8d0c0 });
    k.hipRoof('roof_tile', 22, 13.2, -8, 14, 26, 3.2, C.terracotta, 0.6);
    // lagoon pool with island + swim-up bar + umbrellas + loungers
    k.blob('paving', 2, 12, 22, 10, 0.08, 0xe8e0cc, 18, 0.2, 5);
    k.blob('water', 2, 12, 19, 8, 0.12, 0x3fc0d0, 18, 0.2, 5);
    k.blob('sand', 6, 12, 3, 2, 0.14, k.ctx.theme.sand, 10, 0.2, 2);
    tree(k, k.ctx.theme.trees.includes('palm') ? 'palm' : themeTree(k.ctx, 'formal'), 6, 12, 0.7);
    const um = [0xf4f4f0, 0x2f9fd0, 0xf2a93b];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = 2 + Math.cos(a) * 21, z = 12 + Math.sin(a) * 9.5;
      if (z > D / 2 - 2) continue;
      umbrella(k, x, z, um[i % 3], 1.3, 2.3);
      k.box('plain', x + 1, 0.1, z, 0.7, 0.3, 1.9, 0xf4f4f4);
    }
    const tsp = k.ctx.theme.trees.includes('palm') ? 'palm' : themeTree(k.ctx, 'shade');
    for (let i = 0; i < 6; i++) tree(k, tsp, -32 + i * 12, D / 2 - 3, 0.8, i, i);
    k.sign(22, 10, 5.2, 8, 1.2, 0xf2a93b, 0xffd080);
    crowd(k, 2, 12, 34, 14, 14);
    return 21;
  },

  beach_resort(k) {
    const W = k.W, D = k.D;
    k.lot('sand', k.ctx.theme.sand, 0.2, 0.04);
    // main hotel along the road, bungalows, beach + overwater villas at the back
    k.box('wall_plaster', -10, 0, 12, 50, 13.2, 10, 0xf6f2ea, { top: 'roof_flat', topColor: 0xd8d0c0 });
    if (!k.lo) for (let f = 1; f < 4; f++) k.box('concrete', -10, f * 3.3, 17.6, 50, 0.2, 1.4, 0xf4f0e8);
    k.box('wood', -10, 13.2, 12, 52, 0.4, 12, C.woodLight, { top: 'roof_shingle', topColor: 0x8a6a4a });
    for (let i = 0; i < 6; i++) {
      const x = -32 + i * 11, z = -2;
      k.box('wall_wood', x, 0.4, z, 6, 3, 6, 0xe8dcc4, { top: false });
      k.pyramid('roof_shingle', x, 3.4, z, 7.4, 7.4, 3, 0x9a7a4a);
      k.box('wood', x, 0, z, 7, 0.4, 7, C.woodLight);
    }
    k.flat('water', 22, 0, 16, 8, 0.4, 0x3fc0d0);
    k.box('concrete', 22, 0, 0, 17, 0.35, 9, 0xe8e0cc, { top: false });
    // beach umbrellas
    for (let i = 0; i < 8; i++) umbrella(k, -34 + i * 9, -14, [0xf4f4f0, 0xf2a93b, 0x2f9fd0][i % 3], 1.4, 2.3);
    // overwater villas on stilts beyond the lot edge (over water)
    k.box('wood', 0, 0.6, -D / 2 - 8, 2.4, 0.3, 18, C.woodLight);
    for (let i = 0; i < 4; i++) {
      const x = -18 + i * 12, z = -D / 2 - 16;
      k.box('wood', x / 2, 0.6, -D / 2 - 16, Math.abs(x) + 2, 0.3, 2.2, C.woodLight);
      for (const [px, pz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]] as P2[]) k.cyl('wood', x + px, -3, z + pz, 0.15, 0.15, 3.6, C.woodDark, 5);
      k.box('wood', x, 0.6, z, 6, 0.3, 6, C.woodLight);
      k.box('wall_wood', x, 0.9, z, 5, 2.8, 5, 0xe8dcc4, { top: false });
      k.pyramid('roof_shingle', x, 3.7, z, 6.2, 6.2, 2.8, 0x9a7a4a);
      k.light(x, 2.4, z + 2.8, C.lampWarm, 2.6, 'lamp');
    }
    const tsp = k.ctx.theme.trees.includes('palm') ? 'palm' : themeTree(k.ctx, 'formal');
    for (let i = 0; i < 7; i++) tree(k, tsp, -36 + i * 12, 5, 0.8, i, i);
    crowd(k, 0, -12, 70, 6, 16);
    return 14;
  },

  theme_hotel(k) {
    const W = k.W, D = k.D;
    // A 1930s ocean liner, bow to the street, "afloat" in a reflecting basin
    k.lot('paving', 0xd8d2c4, 0.2, 0.05);
    const L = 68, B = 15, zs = -39, keel = -3, deck0 = 9;
    k.box('concrete', 0, -0.6, zs + L / 2 - 1, 24, 1, L + 6, 0xc8c2b4, { top: false });
    k.flat('water', 0, zs + L / 2 - 1, 23, L + 5, 0.3, 0x3f8fa8);
    const halfB = (u: number) => {
      if (u < 0.12) return (B / 2) * (0.62 + 0.38 * Math.sin((u / 0.12) * (Math.PI / 2)));
      if (u > 0.62) return (B / 2) * Math.pow(Math.cos(((u - 0.62) / 0.38) * (Math.PI / 2)), 0.75);
      return B / 2;
    };
    const deckY = (u: number) => deck0 + 2.2 * Math.pow(Math.max(0, u - 0.72) / 0.28, 1.6);
    const P = (u: number, v: number, sx: number): [number, number, number] => {
      const b = halfB(u), dy = deckY(u);
      const x = sx * b * Math.pow(Math.sin((v * Math.PI) / 2), 0.35);
      const y = keel + (dy - keel) * (1 - Math.cos((v * Math.PI) / 2));
      const rake = u > 0.9 ? ((u - 0.9) / 0.1) * 3.5 * v : 0;
      return [x, y, zs + u * L + rake];
    };
    const nu = k.seg(24), nv = k.seg(8);
    const vW = 0.52; // waterline split for the red boot-topping
    for (const sx of [-1, 1]) {
      const band = (v0: number, v1: number, col: number) => {
        if (sx > 0) k.surface('plain', Math.max(2, Math.round(nv * (v1 - v0))), nu, (a, b) => P(b, v0 + (v1 - v0) * a, sx), col);
        else k.surface('plain', nu, Math.max(2, Math.round(nv * (v1 - v0))), (a, b) => P(a, v0 + (v1 - v0) * b, sx), col);
      };
      band(0, vW, 0xa8281f);
      band(vW, 1, 0x1c1d20);
      // white sheer line + portholes
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 20; i++) { const q = P(i / 20, 1, sx); pts.push([q[0] + sx * 0.05, q[1] - 0.3, q[2]]); }
      k.polyPipe('plain', pts, 0.16, 0xf4f4f0, 4);
      if (!k.lo) for (const y of [4.2, 6.4]) for (let z = zs + 8; z < zs + L * 0.66; z += 2.3) k.box('emissive', sx * (B / 2 + 0.03), y, z, 0.06, 0.55, 0.55, 0xe8dca8, { top: false });
    }
    // stern closure + main deck
    const stern: [number, number][] = [];
    for (let i = 0; i <= nv; i++) stern.push([P(0, i / nv, 1)[0], P(0, i / nv, 1)[1]]);
    for (let i = 0; i < nv; i++) {
      k.tri('plain', { x: 0, y: keel, z: zs }, { x: stern[i][0], y: stern[i][1], z: zs }, { x: stern[i + 1][0], y: stern[i + 1][1], z: zs }, [0, 0], [1, 0], [1, 1], 0x1c1d20, { x: 0, y: 0, z: -1 });
      k.tri('plain', { x: 0, y: keel, z: zs }, { x: -stern[i][0], y: stern[i][1], z: zs }, { x: -stern[i + 1][0], y: stern[i + 1][1], z: zs }, [0, 0], [1, 0], [1, 1], 0x1c1d20, { x: 0, y: 0, z: -1 });
    }
    k.surface('wood', nu, 2, (u, v) => { const b = halfB(u); return [(v * 2 - 1) * b, deckY(u), zs + u * L + (u > 0.9 ? ((u - 0.9) / 0.1) * 3.5 : 0)]; }, 0xcdb68e);
    // stepped art-deco superstructure with rounded fronts
    const white = 0xf4f2ec;
    const tiers: [number, number, number, number][] = [[12.6, -30, 12, 3.3], [11.2, -26, 6, 3.3], [9.6, -20, 0, 3.3], [7.4, -12, -4, 2.6]];
    let y = deck0;
    tiers.forEach(([w, za, zb, h], i) => {
      const z0 = zs + L / 2 + za, z1 = zs + L / 2 + zb;
      k.box('wall_plaster', 0, y, (z0 + z1) / 2, w, h, z1 - z0, white, { top: 'wood', topColor: 0xcdb68e });
      k.rev('wall_plaster', 0, y, z1, [[w / 2, 0], [w / 2, h]], white, k.seg(12), { a0: 0, a1: Math.PI, top: true });
      k.box('metal', 0, y + h, (z0 + z1) / 2, w + 0.2, 0.9, z1 - z0, 0xf8f8f8, { top: false, sides: { n: false, s: false } });
      if (i === 3) {
        k.rev('glass', 0, y + 0.8, z1, [[w / 2 + 0.03, 0], [w / 2 + 0.03, 1.2]], 0x2a3440, k.seg(12), { a0: 0.15, a1: Math.PI - 0.15 });
        k.word('HOTEL', 0, y + h + 0.3, z1 - 1.2, 1.2, 0xffd878, 'neon', 0.1);
      }
      y += h;
    });
    // lifeboats on davits along the boat deck
    for (const sx of [-1, 1])
      for (let i = 0; i < 6; i++) {
        const z = zs + L / 2 - 28 + i * 5.2, x = sx * 6.6;
        k.box('plain', x, deck0 + 4.3, z, 1.5, 0.9, 4.2, 0xf4f4f0);
        k.box('plain', x, deck0 + 5.2, z, 1.3, 0.25, 3.9, 0xe07a2a);
        for (const dz of [-1.6, 1.6]) k.beam('metal', [sx * 5.8, deck0 + 3.3, z + dz], [x, deck0 + 6, z + dz], 0.14, 0.14, 0xf4f4f0);
      }
    // three raked funnels
    const fy = deck0 + 3.3 * 3;
    [-22, -13, -4].forEach((dz, i) => {
      const z = zs + L / 2 + dz;
      k.push(new THREE.Matrix4().makeTranslation(0, fy, z).multiply(new THREE.Matrix4().makeRotationX(-0.09)));
      k.rev('plain', 0, 0, 0, [[2.1, 0], [2.1, 8.8]], 0xc8322b, k.seg(16), { sz: 1.45 });
      k.rev('plain', 0, 8.8, 0, [[2.12, 0], [2.12, 2.2]], 0x1a1a1c, k.seg(16), { sz: 1.45, top: true });
      k.pop();
      if (i === 0) k.emitter('steam', 0, fy + 11.5, z - 1, 0.25);
    });
    // masts with dressing lines of string lights
    const foreZ = zs + L * 0.8, aftZ = zs + 5;
    k.cyl('metal', 0, deckY(0.8), foreZ, 0.25, 0.12, 24, 0xe8e2d0, 6);
    k.cyl('metal', 0, deck0, aftZ, 0.25, 0.12, 22, 0xe8e2d0, 6);
    const bowP: V3 = [0, deckY(1) + 0.5, zs + L + 3.4], sternP: V3 = [0, deck0 + 1, zs + 0.5];
    const foreTop: V3 = [0, deckY(0.8) + 24, foreZ], aftTop: V3 = [0, deck0 + 22, aftZ];
    for (const [a, b] of [[bowP, foreTop], [foreTop, aftTop], [aftTop, sternP]] as [V3, V3][]) {
      k.cable('metal', a, b, 1.2, 0.04, 0x333333, 8);
      for (let t = 0.1; t < 1; t += 0.13) k.light(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 1.2 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t, [0xffe0a0, 0xff9ab8, 0x9fd8ff][Math.round(t * 10) % 3], 1.6, 'lamp');
    }
    k.light(0, deckY(0.8) + 24.3, foreZ, C.beaconRed, 2.5, 'beacon', true);
    // gangway entrance pavilion with a neon marquee
    const gz = 14, gx = 16;
    k.box('wall_glass', gx, 0, gz, 10, 5, 8, 0x9ac4d8, { top: 'roof_flat' });
    k.box('metal', gx, 5, gz + 1, 11, 0.5, 10, 0xc8a040, { bottom: true });
    k.sign(gx, 5.6, gz + 5.1, 8, 1.4, 0x3fd0ff, 0x9fe8ff, 0x1a1a1a);
    k.beam('metal', [gx - 5, 4.2, gz - 1], [B / 2 + 0.2, deck0 - 1.4, gz - 1], 2.2, 0.3, 0xe8e8e4, true);
    for (const dz of [-2, 0]) k.beam('metal', [gx - 5, 5.2, gz - 1 + dz + 1], [B / 2 + 0.2, deck0 - 0.4, gz - 1 + dz + 1], 0.08, 0.08, 0x8a8e92);
    // quayside promenade: palms / trees, lamps, cars
    const tsp = k.ctx.theme.trees.includes('palm') ? 'palm' : themeTree(k.ctx, 'formal');
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) tree(k, tsp, sx * (W / 2 - 3), -32 + i * 16, 0.8, i + sx, i);
    lampsAlong(k, [[-12.5, -38], [-12.5, 30]], 10, 4.4, 'classic', 0);
    lampsAlong(k, [[12.5, 30], [12.5, -38]], 10, 4.4, 'classic', 0);
    parkedCars(k, -20, 20, -20, D / 2 - 2, 2.8, Math.PI / 2, 0.8);
    crowd(k, 8, 24, 12, 8, 8);
    return deckY(0.8) + 24.5;
  },

  farm_coop(k) {
    const W = k.W, D = k.D;
    k.lot('dirt', mix(dryGround(k.ctx), 0x8a7a5a, 0.3), 0.2, 0.04);
    // grain elevator: silos + headhouse + conveyor legs
    for (let i = 0; i < 4; i++) silo(k, -20 + (i % 2) * 9, -20 + Math.floor(i / 2) * 9, 4, 20);
    k.box('wall_industrial', -15, 0, -30, 6, 28, 5, 0xd8d8d0, { top: 'roof_flat' });
    k.box('wall_industrial', -15, 28, -30, 4, 3, 4, 0xc8c8c0, { top: 'roof_flat' });
    for (let i = 0; i < 4; i++) k.beam('metal', [-15, 26, -28], [-20 + (i % 2) * 9, 22, -20 + Math.floor(i / 2) * 9], 0.8, 0.8, 0xa8a8a0);
    // red barn with gambrel roof + machinery shed
    const bx = 14, bz = -12;
    k.box('wall_wood', bx, 0, bz, 16, 7, 22, 0xa83a2a, { top: false });
    const gw = 16, rise1 = 3.2, rise2 = 2.4;
    const hw = gw / 2;
    for (const s of [-1, 1]) {
      k.quad('roof_metal', { x: bx + s * hw, y: 7, z: bz + 11 }, { x: bx + s * hw * 0.6, y: 7 + rise1, z: bz + 11 }, { x: bx + s * hw * 0.6, y: 7 + rise1, z: bz - 11 }, { x: bx + s * hw, y: 7, z: bz - 11 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0x5a5e62, { x: s, y: 0.6, z: 0 });
      k.quad('roof_metal', { x: bx + s * hw * 0.6, y: 7 + rise1, z: bz + 11 }, { x: bx, y: 7 + rise1 + rise2, z: bz + 11 }, { x: bx, y: 7 + rise1 + rise2, z: bz - 11 }, { x: bx + s * hw * 0.6, y: 7 + rise1, z: bz - 11 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0x5a5e62, { x: s, y: 1.4, z: 0 });
    }
    for (const e of [-1, 1]) {
      const z = bz + e * 11;
      k.tri('wall_wood', { x: bx - hw, y: 7, z }, { x: bx + hw, y: 7, z }, { x: bx, y: 7 + rise1 + rise2, z }, [0, 7], [gw, 7], [hw, 12.6], 0xa83a2a, { x: 0, y: 0, z: e });
      k.tri('wall_wood', { x: bx - hw, y: 7, z }, { x: bx - hw * 0.6, y: 7 + rise1, z }, { x: bx, y: 7 + rise1 + rise2, z }, [0, 7], [3, 10], [hw, 12.6], 0xa83a2a, { x: 0, y: 0, z: e });
      k.tri('wall_wood', { x: bx + hw, y: 7, z }, { x: bx, y: 7 + rise1 + rise2, z }, { x: bx + hw * 0.6, y: 7 + rise1, z }, [gw, 7], [hw, 12.6], [13, 10], 0xa83a2a, { x: 0, y: 0, z: e });
    }
    k.box('wood', bx, 0, bz + 11.05, 6, 5, 0.1, 0xf4f0e6, { top: false });
    k.beam('wood', [bx - 3, 0, bz + 11.1], [bx + 3, 5, bz + 11.1], 0.2, 0.08, 0xf4f0e6);
    k.beam('wood', [bx + 3, 0, bz + 11.1], [bx - 3, 5, bz + 11.1], 0.2, 0.08, 0xf4f0e6);
    hall(k, -14, 16, 22, 12, 6, { roof: 'shed', color: 0xb8bcb0, roofColor: 0x5a6a4a });
    // crop plots, tractors, hay bales, cooperative office
    k.flat('crop', 18, 20, 20, 18, 0.09, 0xc8a84a);
    k.flat('crop', 18, 20 - 0.01, 20, 18, 0.085, 0x6a8a3a);
    tractor(k, 12, 6, 0.4);
    tractor(k, -4, 4, 2, 0xd8412f);
    for (let i = 0; i < 5; i++) {
      k.push(new THREE.Matrix4().makeTranslation(2 + i * 2.2, 0.8, -26).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      k.cylinder('crop', 0, -0.8, 0, 0.8, 0.8, 1.6, 0xd8c070, 10, { top: true, bottom: true });
      k.pop();
    }
    k.box('wall_wood', -2, 0, 26, 12, 3.6, 6, 0xf0ece0, { top: false });
    k.gableRoof('roof_metal', -2, 3.6, 26, 12, 6, 1.6, 0x3f6a3a, { wallMat: 'wall_wood', wallColor: 0xf0ece0 });
    truck(k, -22, 8, Math.PI / 2, 0x3f6a3a, 0xd8c070, 'box', 11);
    // yard lights, beacon on the headhouse
    k.light(bx, 6.2, bz + 11.6, C.lampWarm, 4, 'lamp');
    k.light(-14, 5, 22.6, C.lampWarm, 3.5, 'lamp');
    k.light(-2, 2.9, 29.4, C.lampWarm, 2.6, 'lamp');
    k.light(-15, 31.3, -30, C.beaconRed, 3, 'beacon', true);
    return 31;
  },

  lumber_yard(k) {
    const W = k.W, D = k.D;
    k.lot('dirt', mix(dryGround(k.ctx), 0x7a6040, 0.3), 0.2, 0.04);
    // log decks, sawmill shed with debarker conveyor, drying kilns, lumber stacks
    for (let i = 0; i < 3; i++) logPile(k, -18, -24 + i * 7, 14, 8 - i, 4, 0.42);
    logPile(k, -18, -3, 12, 6, 3, 0.38);
    hall(k, 8, -14, 22, 16, 9, { roof: 'gable', color: 0x8a6a4a, roofColor: 0x5a5e62, wall: 'wall_wood', doors: 1, doorColor: 0x6a5a4a });
    conveyor(k, [-10, 0.5, -14], [-3, 5, -14], 1.4, 0x8a6a4a);
    chimney(k, 18, -24, 16, 0.8, 0.6, { bands: false, emit: 'smoke', rate: 0.3, color: 0x6a6e72, beacon: false });
    for (let i = 0; i < 3; i++) {
      k.box('wall_industrial', 20, 0, 4 + i * 7, 10, 6, 6, 0xb8bcc0, { top: 'roof_metal', topColor: 0x6a6e72 });
      k.cyl('metal', 23, 6, 4 + i * 7, 0.4, 0.4, 3, 0x6a6e72, 6);
      k.emitter('steam', 23, 9.2, 4 + i * 7, 0.3);
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const x = -6 + i * 5, z = 8 + j * 8;
      k.box('wood', x, 0, z, 3.6, 2.2 + ((i + j) % 3) * 0.6, 5, 0xd8b884);
      if (!k.lo) for (let l = 1; l < 4; l++) k.box('wood', x, l * 0.7, z, 3.7, 0.1, 5.1, 0x8a6a4a, { top: false });
    }
    // log loader crane + log truck
    k.at(-6, 0, -26, 0, () => {
      k.box('plain', 0, 0.5, 0, 4, 2, 2.6, 0xf2c230);
      k.beam('metal', [0, 2.6, 0], [5, 7, 0], 0.5, 0.5, 0xf2c230);
      k.beam('metal', [5, 7, 0], [8, 3, 0], 0.4, 0.4, 0xf2c230);
    });
    truck(k, 4, D / 2 - 5, 0, 0x2f5f3a, 0x7a5a3a, 'box', 14);
    logPile(k, 2.5, D / 2 - 5, 9, 4, 2, 0.35);
    return 18;
  },

  ore_processing(k) {
    const W = k.W, D = k.D;
    k.lot('dirt', mix(dryGround(k.ctx), 0x6a5f55, 0.4), 0.2, 0.04);
    // headframe over the shaft with winding wheels
    const hx = -18, hz = -18;
    k.lattice('metal', hx, hz, 0, 30, 3, 1.6, 0x8a3a2a, 5, 0.4, 0.16);
    k.beam('metal', [hx + 12, 0, hz], [hx + 1.6, 28, hz], 0.8, 0.8, 0x8a3a2a);
    for (const s of [-1, 1]) {
      k.push(new THREE.Matrix4().makeTranslation(hx, 31, hz + s * 1).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      k.torus('metal', 0, 0, 0, 2.4, 0.18, 0x3a3d42, 16, 4);
      k.pop();
    }
    k.box('wall_brick', hx + 16, 0, hz, 10, 8, 8, 0x9a5a3a, { top: false });
    k.gableRoof('roof_metal', hx + 16, 8, hz, 10, 8, 2, 0x5a5e62, { wallMat: 'wall_brick', wallColor: 0x9a5a3a });
    k.cable('metal', [hx, 31, hz], [hx + 14, 8, hz], 1, 0.06, 0x222222, 4);
    // crusher + screening building, conveyor galleries, ore bins, piles
    k.box('wall_industrial', 10, 0, -8, 18, 20, 14, 0x9aa0a6, { top: 'roof_flat' });
    k.box('wall_industrial', 10, 20, -10, 10, 6, 8, 0x8a9096, { top: 'roof_flat' });
    conveyor(k, [hx + 3, 12, hz + 3], [4, 22, -10], 2.2, 0x9a8f7a);
    conveyor(k, [18, 16, -4], [22, 1, 18], 2, 0x9a8f7a);
    pile(k, 22, 20, 7, 6, 6, 0x6a5f55);
    pile(k, -14, 16, 9, 6, 5, 0x8a6a4a);
    for (let i = 0; i < 3; i++) {
      k.box('metal', -2 + i * 5, 6, 12, 4, 5, 4, 0x6a7078);
      k.pyramid('metal', -2 + i * 5, 6, 12, 4, 4, -3, 0x6a7078);
      for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]] as P2[]) k.box('metal', -2 + i * 5 + px, 0, 12 + pz, 0.3, 6, 0.3, 0x5a5e62);
    }
    // haul truck
    k.at(-4, 0, 24, 0.3, () => {
      k.box('plain', -1, 1.4, 0, 7, 3, 4.4, 0xf2c230);
      k.box('plain', 3.4, 1.4, 0, 2, 2.6, 4, 0xf2c230);
      for (const [x, s] of [[-2.5, 1], [-2.5, -1], [3, 1], [3, -1]] as P2[]) {
        k.push(new THREE.Matrix4().makeTranslation(x, 1.2, s * 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        k.cylinder('plain', 0, -0.5, 0, 1.2, 1.2, 1, 0x1a1a1a, 10, { top: true, bottom: true });
        k.pop();
      }
    });
    k.emitter('dust', 10, 22, -8, 0.6);
    k.light(hx, 30.5, hz, C.beaconRed, 3, 'beacon', true);
    return 32;
  },

  oil_refinery(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5a5c60, 0.2, 0.04);
    // distillation columns + cracker, tank farm, spheres, flare stack
    column(k, -6, -10, 2.6, 46);
    column(k, 0, -10, 2, 38);
    column(k, 6, -10, 1.6, 30);
    k.box('metal', 0, 0, -18, 22, 12, 6, 0x9aa0a6, { top: 'roof_flat' });
    for (let i = 0; i < 3; i++) k.cyl('metal', -8 + i * 8, 12, -18, 0.9, 0.9, 10, 0x8a8e92, 8);
    k.box('metal', -16, 0, -8, 8, 14, 10, 0xd0d0cc);
    chimney(k, -16, -14, 40, 1.4, 1.1, { emit: 'smoke', rate: 0.5, color: 0xb8b4ac, bands: true });
    for (let i = 0; i < 6; i++) tank(k, -30 + (i % 3) * 12, 14 + Math.floor(i / 3) * 12, 5, 10, i % 2 ? 0xe8e6de : 0xd8d8d0, 'dome');
    for (let i = 0; i < 3; i++) sphereTank(k, 14 + i * 10, 22, 4.2, 0xeeeeea);
    pipeRack(k, [-28, 4], [30, 4], 5, 4, [0xb8bcc0, C.yellow, 0x7a8a9a, 0x3a6fd8]);
    pipeRack(k, [12, 4], [12, -30], 5, 3);
    // flare stack with a burning tip
    const fx = W / 2 - 8, fz = -D / 2 + 8;
    k.lattice('metal', fx, fz, 0, 50, 1.4, 0.6, 0xa8adb2, 6, 0.22, 0.09);
    k.cyl('metal', fx, 0, fz, 0.5, 0.5, 52, 0xd8412f, 8);
    k.cyl('neon', fx, 52, fz, 0.5, 0.05, 3.2, 0xff8a2a, 8, false);
    k.light(fx, 53.6, fz, 0xff8a2a, 8, 'neon');
    k.emitter('smoke', fx, 55, fz, 0.4);
    // lights on columns at night
    for (const [x, y] of [[-6, 16], [-6, 32], [0, 24], [6, 18]] as P2[]) k.light(x + 2.8, y, -10, 0xffe8b0, 2.4, 'lamp');
    return 55;
  },

  industrial_hq(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd0cabd, 0.2, 0.05);
    // glass tower with a glowing logo crown + R&D wing and plaza
    const floors = 16;
    k.box('wall_glass', -4, 0, -6, 26, 5, 22, 0xb8d4e4, { top: 'roof_flat' });
    k.box('wall_glass', -4, 5, -6, 22, floors * 3.3, 18, 0x7f9fb8, { top: 'roof_flat', topColor: 0x5a5e62 });
    const th = 5 + floors * 3.3;
    for (let i = 0; i < 5; i++) k.box('metal', -14.8 + i * 5.4, 5, 3.1, 0.35, floors * 3.3, 0.35, 0xd8dcdf, { top: false });
    k.box('metal', -4, th, -6, 22.4, 3.6, 18.4, 0x2a2d31, { top: 'roof_flat' });
    k.box('emissive', -4, th + 0.6, 3.25, 14, 2.4, 0.1, 0xf2a93b);
    k.box('emissive', -4 + 11.25, th + 0.6, -6, 0.1, 2.4, 10, 0xf2a93b);
    k.light(-4, th + 1.8, 4, 0xffc070, 12, 'neon');
    antennaMast(k, 2, -12, 8, 0.4);
    k.box('wall_concrete', 16, 0, 2, 12, 9, 26, 0xe6e4de, { top: 'roof_flat' });
    k.hvac(16, 9, 2, 12, 26, 3);
    // plaza with water feature and art
    k.box('concrete', -4, 0, 14, 16, 0.4, 5, 0xb8b4aa, { top: 'water', topColor: 0x3f7a8a });
    k.torus('metal', -4, 2.4, 14, 2, 0.3, 0xf2a93b, 20, 6);
    k.box('concrete', -4, 0.4, 14, 1, 0.6, 1, 0x9a968d);
    parkedCars(k, 10, D / 2 - 2, 22, D / 2 - 2, 2.8, Math.PI / 2, 0.8);
    for (const x of [-20, -16]) tree(k, themeTree(k.ctx, 'formal'), x, 16, 0.7, x);
    return th + 12;
  },

  logistics_hub(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    // cross-dock warehouse: docks on the front, trailers parked at the back
    hall(k, 0, -4, W - 16, 30, 12, { roof: 'flat', color: 0xe8e8e2, roofColor: 0x6a6e72 });
    k.box('plain', 0, 9.6, 11.06, W - 16, 1.4, 0.1, 0x2f7fd0, { top: false });
    k.sign(-20, 9.8, 11.15, 12, 1, 0xf4f4f4, 0x9fd0ff, 0x2f7fd0);
    docks(k, 0, 11, 12, 6.2, 4.4, 0x2f7fd0);
    for (let i = 0; i < 6; i++) truck(k, -30 + i * 12.4, 20, Math.PI / 2 * 3, [0xd8412f, 0x2f7fd0, 0xf4f4f4, 0x3fa05a][i % 4], 0xe8e8e2, 'box', 14);
    for (let i = 0; i < 8; i++) container(k, -36 + i * 9.5, 0, -D / 2 + 4, Math.PI / 2, [0xb33a2e, 0x2f5f9e, 0x3d8a4a, 0xd9a32b, 0x8a8f96][i % 5], 12.2);
    containerStack(k, W / 2 - 5, -4, 2, 3, 3, Math.PI / 2);
    k.hvac(0, 12, -4, W - 16, 30, 6);
    for (const [x, z] of [[-W / 2 + 3, D / 2 - 3], [W / 2 - 3, D / 2 - 3], [-W / 2 + 3, -D / 2 + 10], [W / 2 - 3, -D / 2 + 10]] as P2[]) {
      k.cyl('metal', x, 0, z, 0.25, 0.18, 12, 0x9aa0a6, 6);
      k.light(x, 12, z, 0xfff4e0, 7, 'flood');
    }
    return 14;
  },
};

/** taxi helper (kept local to avoid a cyclic import of the transit module) */
function taxi2(k: Kit, x: number, z: number): void {
  car(k, x, z, 0, 0xf5c518);
  k.at(x, 0, z, 0, () => k.box('emissive', -0.2, 1.55, 0, 0.35, 0.22, 0.7, 0xfff2b0));
}

export const CIVIC_MODELS = models(M);
