// Fire, police and disaster-response services.
import * as THREE from 'three';
import { Kit, type P2 } from './kit';
import { C, shade, mix, lawnColor, civicLook, dryGround } from './colors';
import { models } from './define';
import { bush, container, fence, fireTruck, flagpole, helicopter, parkedCars, policeCar, solarRow, tree, themeTree, truck, van, crowd, parkingLot } from './props';
import { antennaMast, bayDoors, civicBlock, hall, hangar, lampsAlong, radome, jetty, quay, rollDoors } from './arch';

// ── shared bits ────────────────────────────────────────────────────────────
/** hose-drying / training tower with windows and balconies */
function hoseTower(k: Kit, x: number, z: number, w: number, h: number, wall: 'wall_brick' | 'wall_concrete' | 'wall_plaster', color: number, roofColor: number): number {
  k.box(wall, x, 0, z, w, h, w, color, { top: false });
  k.hipRoof('roof_metal', x, h, z, w, w, w * 0.45, roofColor, 0.3);
  if (!k.lo) for (let y = 4; y < h - 2; y += 3.3) {
    k.box('concrete', x, y, z + w / 2 + 0.5, w * 0.8, 0.18, 1, 0xd8d4cc);
    k.box('metal', x, y + 0.9, z + w / 2 + 0.98, w * 0.8, 0.06, 0.06, 0x333333, { top: false });
  }
  k.light(x, h + w * 0.45 + 0.4, z, C.beaconRed, 2.4, 'beacon', true);
  return h + w * 0.45;
}

/** apron in front of vehicle bays */
function apron(k: Kit, x: number, z: number, w: number, d: number): void {
  k.slab('concrete', x, z, w, d, 0.09, 0xb9b5ad, 0.2);
  if (!k.lo) for (let i = 0; i <= Math.round(w / 5); i++) k.paint(x - w / 2 + i * 5, z - d / 2, x - w / 2 + i * 5, z + d / 2, 0.14, 0.11, C.paintYellow);
}

/** guard / watch tower with searchlight cabin */
function watchTower(k: Kit, x: number, z: number, h: number, color: number): void {
  k.box('concrete', x, 0, z, 2.6, h, 2.6, color);
  k.box('glass', x, h, z, 3.4, 2.2, 3.4, 0x2c3a46, { top: false });
  k.box('concrete', x, h + 2.2, z, 4, 0.4, 4, shade(color, 0.9));
  k.box('concrete', x, h - 0.3, z, 4, 0.3, 4, shade(color, 0.9));
  k.light(x + 1.8, h + 1.2, z + 1.8, 0xf6f8ff, 6, 'flood');
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  fire_station(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    const brick = look.wall === 'wall_brick' ? look.wallColor : mix(C.brick, look.wallColor, 0.2);
    // two-storey station with three apparatus bays
    k.box('wall_brick', -2, 0, -4, 22, 8.2, 14, brick, { top: 'roof_flat', topColor: 0x55585c });
    k.box('plain', -2, 7.6, 3.05, 22.2, 0.6, 0.2, 0xf2efe6);
    k.parapet(-2, 8.2, -4, 22, 14, 0.9, shade(brick, 0.9));
    bayDoors(k, -2, 3, 3, 5.8, 4.6, 0xf2efe6, C.fireRed);
    k.sign(-2, 5.3, 3.15, 8, 1.1, 0xf4f4f0, 0xfff0d0, C.fireRed);
    const top = hoseTower(k, 12, -8, 4.2, 14, 'wall_brick', brick, 0x4a4f57);
    apron(k, -2, 8, 20, 10);
    fireTruck(k, -7.8, 8, Math.PI / 2, true);
    fireTruck(k, -2, 8.5, Math.PI / 2, false);
    flagpole(k, 12, 5, 9, C.red, 0xf4f4f4);
    bush(k, 13, 0, 1);
    k.light(-2, 7.2, 3.8, C.lampWarm, 3, 'lamp');
    return top;
  },

  fire_station_large(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    const brick = look.wall === 'wall_brick' ? look.wallColor : mix(C.brick, look.wallColor, 0.25);
    k.box('wall_brick', -3, 0, -6, 34, 8.6, 18, brick, { top: 'roof_flat', topColor: 0x55585c });
    k.box('wall_brick', -3, 8.6, -10, 24, 3.4, 10, shade(brick, 1.05), { top: 'roof_flat', topColor: 0x55585c });
    k.box('plain', -3, 8, 3.06, 34.2, 0.6, 0.2, 0xf2efe6);
    k.parapet(-3, 8.6, -6, 34, 18, 0.9, shade(brick, 0.9));
    bayDoors(k, -3, 3, 5, 6, 4.8, 0xf2efe6, C.fireRed);
    k.sign(-3, 5.6, 3.15, 12, 1.2, 0xf4f4f0, 0xfff0d0, C.fireRed);
    const top = hoseTower(k, 18, -12, 5, 18, 'wall_brick', brick, 0x4a4f57);
    // training yard with a burn prop + hydrant
    k.slab('asphalt', 17, 4, 12, 10, 0.08, 0x55585c, 0.2);
    k.box('metal', 18, 0, 4, 3, 2.4, 2.4, 0x5a4a3a);
    k.cyl('plain', 13, 0, 8, 0.25, 0.25, 0.9, C.red, 8);
    apron(k, -3, 10, 32, 8);
    fireTruck(k, -12, 10, Math.PI / 2, true);
    fireTruck(k, -3, 10.5, Math.PI / 2, false);
    fireTruck(k, 6, 10, Math.PI / 2, true);
    flagpole(k, 21, 14, 10, C.red, 0xf4f4f4);
    return top;
  },

  fire_hq(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    // HQ office block (style) + large apparatus hall
    const top = civicBlock(k, look, -18, -12, 22, 26, 7, { roof: 'flat' });
    k.box('plain', -18, 3.9, 1.1, 22.4, 0.8, 0.3, C.fireRed);
    k.sign(-18, 20, 1.3, 12, 1.6, 0xf4f4f0, 0xfff0d0, C.fireRed);
    k.box('wall_brick', 12, 0, -6, 36, 9.5, 20, 0xb04a36, { top: 'roof_flat', topColor: 0x55585c });
    k.parapet(12, 9.5, -6, 36, 20, 0.9, 0x8a3a2a);
    bayDoors(k, 12, 4, 6, 5.8, 5, 0xf2efe6, C.fireRed);
    // training tower with balconies + aerial ladder deployed
    const tt = hoseTower(k, 26, -24, 6, 26, 'wall_concrete', 0xd8d4cc, 0x55585c);
    k.at(18, 0, -24, 0, () => {
      fireTruck(k, 0, 0, 0, true);
      k.beam('metal', [-0.3, 3.2, 0], [5.5, 18, 0], 0.9, 0.3, 0xc8ccd0);
    });
    apron(k, 12, 12, 34, 14);
    for (let i = 0; i < 3; i++) fireTruck(k, 0 + i * 9, 12, Math.PI / 2, i !== 1);
    van(k, 25, 12, Math.PI / 2, C.fireRed, 0xf4f4f0);
    flagpole(k, -26, D / 2 - 4, 12, C.red, 0xf4f4f4);
    flagpole(k, -22, D / 2 - 4, 12, 0x2f5fa8);
    lampsAlong(k, [[-W / 2 + 1, D / 2 - 1], [-8, D / 2 - 1]], 8, 4.5, 'modern', 0);
    return Math.max(top, tt);
  },

  fire_heli(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('asphalt', -6, -2, 30, 26, 0.07, 0x55585c, 0.2);
    k.helipad(-13, 0.1, -4, 6, true);
    k.helipad(1, 0.1, -4, 6, true);
    helicopter(k, -13, 0.35, -4, 0.3, C.fireRed, true);
    helicopter(k, 1, 0.35, -4, -0.2, C.fireRed, true);
    hangar(k, 16, -4, 14, 20, 8, 0xe2e4e0, C.fireRed);
    // water refill tank with pump + crew house
    k.cyl('metal', 16, 0, 11, 3.2, 3.2, 6, 0xc8322b, 14);
    k.box('wall_concrete', -14, 0, 11, 10, 3.6, 6, 0xe6e2da, { top: 'roof_flat' });
    k.sign(-14, 2.6, 14.1, 4, 0.8, 0xf4f4f0, 0xfff0d0, C.fireRed);
    k.cyl('metal', -8, 0, 12, 0.06, 0.06, 5, 0x777777, 5);
    k.rev('plain', -8, 4.4, 12.4, [[0.3, 0], [0.1, 1.6]], 0xf06a1a, 6, {});
    fireTruck(k, 2, 11, Math.PI / 2, false);
    return 12;
  },

  fire_watch(k) {
    k.lot('grass', lawnColor(k.ctx, 0.3), 0.2, 0.04);
    k.slab('dirt', 0, 0, 10, 10, 0.08, dryGround(k.ctx), 0.2);
    // timber lookout tower with cabin, zig-zag stairs, beacon
    const h = 16;
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]] as P2[]) k.beam('wood', [x * 1.3, 0, z * 1.3], [x * 0.7, h, z * 0.7], 0.35, 0.35, C.woodDark);
    for (let y = 4; y < h; y += 4) {
      const s = 2.2 * (1.3 - (y / h) * 0.6);
      k.box('wood', 0, y, 0, s * 2 + 0.3, 0.2, s * 2 + 0.3, C.wood, { top: false });
      if (!k.lo) {
        k.beam('wood', [-s, y - 4, s], [s, y, s], 0.12, 0.12, C.wood);
        k.beam('wood', [s, y - 4, -s], [-s, y, -s], 0.12, 0.12, C.wood);
      }
    }
    k.box('wood', 0, h, 0, 4.4, 0.3, 4.4, C.woodDark);
    k.box('glass', 0, h + 1.1, 0, 3.6, 1.6, 3.6, 0x2c3a46, { top: false });
    k.box('wood', 0, h + 0.3, 0, 3.8, 0.8, 3.8, C.wood, { top: false });
    k.hipRoof('roof_metal', 0, h + 2.7, 0, 3.8, 3.8, 1.6, 0xb8322b, 0.5);
    k.light(0, h + 4.5, 0, C.beaconRed, 2.4, 'beacon', true);
    k.light(0, h + 1.8, 0, C.lampWarm, 3, 'lamp');
    k.cyl('metal', 1.6, h + 2.7, 1.6, 0.04, 0.04, 3, 0x333333, 4);
    return h + 5;
  },

  police_station(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    const wc = mix(look.wallColor, 0xe8e8e4, 0.4);
    const top = civicBlock(k, look, -2, -5, 24, 14, 2, { color: wc, roof: 'flat' });
    k.box('plain', -2, 3.6, 2.35, 24.4, 0.8, 0.2, C.policeBlue, { top: false });
    k.box('wall_glass', -2, 0.1, 2.3, 8, 3.3, 0.1, 0xa8c4d8, { top: false });
    k.entrance(-2, 2.3, 3, 2.8, true, 0x1c2c4a, 0xe8eaee);
    k.sign(-2, 5.6, 2.45, 7, 1, 0x2a5aff, 0x6f9fff, 0x1c2c4a);
    k.box('emissive', 5, 4.8, 2.5, 0.8, 0.8, 0.4, 0x3f7fff);
    k.light(5, 5.2, 3, 0x3f7fff, 3, 'neon');
    antennaMast(k, 8, -8, 8, 0.6, 0xd8dade, 0xd8dade);
    // secure car park with cruisers
    k.slab('asphalt', 0, D / 2 - 4.5, W - 2, 8, 0.09, C.asphalt, 0.2);
    for (let i = 0; i < 4; i++) policeCar(k, -11 + i * 5, D / 2 - 4.5, Math.PI / 2, i === 3);
    flagpole(k, 12, 4, 9, 0x2f5fa8, 0xf4f4f4);
    return top + 8;
  },

  police_hq(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    const blueGlass = 0x6f93b8;
    // podium + blue glazed tower with rooftop heliport and mast
    k.box('wall_office', 0, 0, -6, 40, 8.2, 26, 0xe8e8e6, { top: 'roof_flat', topColor: 0x55585c });
    k.box('plain', 0, 3.8, 7.05, 40.2, 0.9, 0.2, C.policeBlue, { top: false });
    k.parapet(0, 8.2, -6, 40, 26, 0.9, 0xd8d8d6);
    const th = 8.2 + 8 * 3.3;
    k.box('wall_glass', -4, 8.2, -10, 22, th - 8.2, 16, blueGlass, { top: 'roof_flat', topColor: 0x55585c });
    for (let i = 0; i < 6; i++) k.box('plain', -14.6 + i * 4.3, 8.2, -1.9, 0.5, th - 8.2, 0.4, 0xeef0f2, { top: false });
    k.helipad(-4, th + 0.1, -10, 6, true);
    antennaMast(k, 12, -14, 16, 0.8);
    k.entrance(0, 7, 5, 3.4, true, 0x1c2c4a);
    k.sign(-4, th - 2.6, -1.8, 12, 1.4, 0x2a5aff, 0x6f9fff, 0x1c2c4a);
    k.light(-4, th - 1.9, -1.2, 0x6f9fff, 6, 'neon');
    parkingLot(k, 0, D / 2 - 5, W - 6, 9, 0);
    for (let i = 0; i < 7; i++) policeCar(k, -18 + i * 5.5, D / 2 - 3.5, Math.PI / 2, i % 3 === 2);
    van(k, 18, D / 2 - 7, 0, 0x1c2c4a, 0xf4f4f4);
    flagpole(k, -20, 9, 11, 0x2f5fa8, 0xf4f4f4);
    return th + 1;
  },

  prison(k) {
    const W = k.W, D = k.D;
    k.lot('grass', mix(lawnColor(k.ctx, 0.2), dryGround(k.ctx), 0.3), 0.2, 0.04);
    const wall = 0xb8b3a8;
    // perimeter wall with corner watchtowers and razor wire
    const m = 2;
    const x0 = -W / 2 + m, x1 = W / 2 - m, z0 = -D / 2 + m, z1 = D / 2 - 8;
    for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]] as [P2, P2][]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      k.pushTRS((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
      k.box('concrete', 0, 0, 0, len + 0.8, 6, 0.8, wall);
      k.pop();
    }
    if (!k.lo) {
      for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]] as [P2, P2][]) {
        const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.2);
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          pts.push([a[0] + (b[0] - a[0]) * t, 6.3 + (i % 2) * 0.35, a[1] + (b[1] - a[1]) * t]);
        }
        k.polyPipe('metal', pts, 0.06, 0x9a9ea2, 3);
      }
    }
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as P2[]) watchTower(k, x, z, 11, 0xc8c3b8);
    // cruciform cell blocks around a central hub
    const cb = 0xcfcac0;
    k.box('wall_concrete', 0, 0, -4, 12, 14, 12, cb, { top: 'roof_flat', topColor: 0x55585c });
    k.box('wall_concrete', 0, 0, -4, 44, 10, 9, cb, { top: 'roof_flat', topColor: 0x5a5d62 });
    k.box('wall_concrete', 0, 0, -4, 9, 10, 44, cb, { top: 'roof_flat', topColor: 0x5a5d62 });
    // exercise yards
    k.slab('asphalt', -16, 12, 14, 10, 0.08, 0x6a6c70, 0.1);
    k.paintRect(-16, 12, 10, 7, 0.14, 0.11, 0xf4f4f0);
    fence(k, [[-23, 7], [-9, 7], [-9, 17], [-23, 17]], 4, 0x8a9096, 2.5, 'metal', true);
    k.slab('grass', 16, 12, 14, 10, 0.08, lawnColor(k.ctx, 0.3), 0.1);
    crowd(k, -16, 12, 10, 7, 8);
    // admin block & sally port at the front
    k.box('wall_office', 0, 0, D / 2 - 4, 22, 7, 6, 0xe0dcd2, { top: 'roof_flat', topColor: 0x55585c });
    k.box('plain', 0, 5.8, D / 2 - 0.95, 22.2, 0.8, 0.1, C.policeBlue, { top: false });
    rollDoors(k, 14, z1 + 0.4, 5, 1, 5, 0x6a6e72);
    lampsAlong(k, [[x0 + 4, z1 - 2], [x1 - 4, z1 - 2]], 12, 8, 'modern', 0);
    lampsAlong(k, [[x0 + 4, z0 + 3], [x1 - 4, z0 + 3]], 12, 8, 'modern', 0);
    return 15;
  },

  police_heli(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('asphalt', -6, -2, 30, 26, 0.07, 0x4f5256, 0.2);
    k.helipad(-12, 0.1, -3, 6.5, true);
    helicopter(k, -12, 0.35, -3, 0.6, 0x1c2c4a, true);
    hangar(k, 12, -4, 16, 20, 8, 0xe2e4e8, C.policeBlue);
    k.box('wall_office', -14, 0, 11, 14, 4, 6, 0xe8e8e6, { top: 'roof_flat' });
    k.box('plain', -14, 3.2, 14.05, 14, 0.5, 0.1, C.policeBlue, { top: false });
    antennaMast(k, -5, 12, 10, 0.5);
    policeCar(k, 4, 11, Math.PI / 2);
    policeCar(k, 9, 11, Math.PI / 2, true);
    return 12;
  },

  intelligence_agency(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.5), 0.2, 0.04);
    // stepped ziggurat of dark green glass and cream stone (think Vauxhall Cross)
    const stone = 0xe6dcc6, glass = 0x3f6a5a;
    const tiers = [
      { w: 40, d: 30, h: 10 },
      { w: 34, d: 24, h: 9 },
      { w: 26, d: 18, h: 9 },
      { w: 18, d: 12, h: 8 },
    ];
    let y = 0;
    tiers.forEach((t, i) => {
      k.box('wall_stone', 0, y, -4, t.w, t.h, t.d, stone, { top: 'roof_flat', topColor: 0x5d6358 });
      k.box('wall_glass', 0, y + 1, -4 + t.d / 2 + 0.05, t.w * 0.7, t.h - 2, 0.12, glass, { top: false });
      for (const s of [-1, 1]) k.box('wall_glass', s * (t.w / 2 + 0.05), y + 1, -4, 0.12, t.h - 2, t.d * 0.6, glass, { top: false });
      if (i < tiers.length - 1) k.box('foliage', 0, y + t.h, -4 + t.d / 2 - 1.2, t.w - 1, 0.6, 1.4, 0x4a7a3a);
      y += t.h;
    });
    k.box('metal', 0, y, -4, 6, 3, 4, 0x5a5e62);
    radome(k, -8, -4, y - 8, 2.2);
    antennaMast(k, 8, -6, 12 + y - 8, 0.5, 0xd8dade, 0x3a3d42);
    // security fence, gatehouse, bollards
    fence(k, [[-W / 2 + 1, D / 2 - 1], [-W / 2 + 1, -D / 2 + 1], [W / 2 - 1, -D / 2 + 1], [W / 2 - 1, D / 2 - 1], [4, D / 2 - 1]], 3, 0x3a3d42, 2.4, 'metal');
    k.box('wall_glass', -8, 0, D / 2 - 4, 5, 3, 3, 0x3f6a5a, { top: 'roof_flat' });
    for (let i = 0; i < 6; i++) k.cyl('metal', -3 + i * 1.3, 0, D / 2 - 1.5, 0.2, 0.2, 1, 0x2a2a2a, 6);
    parkedCars(k, 10, D / 2 - 5, 22, D / 2 - 5, 2.8, Math.PI / 2, 0.8);
    for (const x of [-18, 18]) tree(k, themeTree(k.ctx, 'formal'), x, 14, 0.8, x);
    lampsAlong(k, [[-W / 2 + 3, -D / 2 + 3], [W / 2 - 3, -D / 2 + 3]], 10, 6, 'modern', 0);
    return y + 12;
  },

  emergency_shelter(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.45), 0.2, 0.04);
    // earth-bermed bunker with blast doors and vent stacks
    const bw = W - 8, bd = D - 12;
    k.box('concrete', 0, 0, -2, bw, 3.6, bd, 0xb8b4aa, { top: false });
    k.rev('grass', 0, 0, -2, [[1, 0], [0.92, 2.2], [0.72, 4.1], [0.5, 4.7], [0, 4.9]], lawnColor(k.ctx, 0.5), k.seg(16), { sx: bw * 0.62, sz: bd * 0.72, crease: 80 });
    k.box('concrete', 0, 0, bd / 2 - 1, 14, 5, 3, 0x9a968d, { top: 'concrete' });
    k.box('metal', -3, 0, bd / 2 + 0.52, 4, 3.4, 0.1, 0xf07a1a, { top: false });
    k.box('metal', 3, 0, bd / 2 + 0.52, 4, 3.4, 0.1, 0xf07a1a, { top: false });
    k.box('emissive', 0, 3.7, bd / 2 + 0.55, 6, 0.9, 0.06, 0x3fbf5a);
    k.light(0, 4.2, bd / 2 + 1.2, 0x3fdf6a, 4, 'neon');
    for (const [x, z] of [[-12, -8], [0, -12], [12, -8]] as P2[]) {
      k.cyl('metal', x, 0, z, 0.8, 0.8, 7.5, 0x8a8e92, 10);
      k.cyl('metal', x, 7.5, z, 1.1, 1.1, 0.5, 0x6a6e72, 10);
    }
    solarRow(k, -14, D / 2 - 4, 8, 2.4, 0.5, 0.6);
    k.box('metal', 14, 0, D / 2 - 5, 5, 2.6, 2.4, 0x3f6a3a);
    return 8.2;
  },

  disaster_response(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    // high-vis vehicle hall + command centre with antenna
    hall(k, -6, -8, 34, 18, 10, { roof: 'gable', color: 0xe8e6e0, roofColor: 0xf07a1a, doors: 4, doorColor: 0xf0a020 });
    k.box('plain', -6, 7.8, 1.06, 34, 0.9, 0.1, 0xf07a1a, { top: false });
    k.box('wall_office', 16, 0, 6, 12, 7, 12, 0xeeeeea, { top: 'roof_flat', topColor: 0x55585c });
    k.box('plain', 16, 5.8, 12.05, 12, 0.9, 0.1, 0xf07a1a, { top: false });
    antennaMast(k, 18, 2, 14, 0.6);
    k.helipad(16, 0.1, -16, 6, true);
    helicopter(k, 16, 0.35, -16, 0.5, 0xf07a1a, true);
    // heavy equipment + relief supplies
    truck(k, -14, 8, 0, 0xf07a1a, 0xe8e6e0, 'box', 11);
    truck(k, -14, 13, 0, 0xf07a1a, 0x3f6a3a, 'container', 12);
    k.at(0, 0, 10, 0.2, () => {
      k.box('plain', 0, 0.5, 0, 4.4, 1.8, 2.6, C.yellow);
      k.box('glass', -0.4, 2.3, 0, 1.6, 1.3, 1.6, 0x2c3a46, { top: 'plain', topColor: C.yellow });
      k.box('metal', 2.9, 0.2, 0, 0.5, 1.4, 3.2, 0x777777);
      k.box('plain', 0, 0, 0, 4, 0.7, 2.8, 0x2a2a2a);
    });
    for (let i = 0; i < 3; i++) container(k, 6 + i * 2.7, 0, 13, Math.PI / 2, [0x2f5f9e, 0xd8d8d8, 0x3d8a4a][i], 6);
    return 14;
  },

  early_warning(k) {
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('concrete', 0, 0, 6, 6, 0.1, 0xb8b4aa, 0.2);
    // siren mast with horn array, solar panel, battery box, strobe
    k.cyl('metal', 0, 0, 0, 0.35, 0.22, 18, 0x9aa0a6, 8);
    k.at(0, 18, 0, 0, () => {
      k.cyl('metal', 0, 0, 0, 0.9, 0.9, 1.4, 0xd8dade, 10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.pushTRS(Math.cos(a) * 0.8, 0.7, Math.sin(a) * 0.8, -a);
        k.push(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
        k.rev('metal', 0, 0, 0, [[0.25, 0], [0.5, 1.3], [0.62, 1.5]], 0xf2c230, 8, { crease: 60 });
        k.pop();
        k.pop();
      }
      k.cyl('emissive', 0, 1.4, 0, 0.25, 0.25, 0.4, 0xff6a1a, 8);
    });
    k.light(0, 19.6, 0, 0xff7a1a, 3, 'beacon', true);
    k.at(0.3, 10, 0, 0, () => {
      k.push(new THREE.Matrix4().makeRotationX(-0.7));
      k.box('solar', 0.9, 0, 0, 1.8, 0.08, 1.2, 0xffffff, { top: 'solar' });
      k.pop();
    });
    k.box('metal', 1.2, 0, 0, 1, 1.6, 0.8, 0xd8dade);
    fence(k, [[-2.8, -2.8], [2.8, -2.8], [2.8, 2.8], [-2.8, 2.8]], 1.8, 0x8a9096, 1.9, 'metal', true);
    return 20;
  },

  weather_radar(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('concrete', -2, -2, 18, 18, 0.08, 0xb8b4aa, 0.2);
    // concrete tower with radome, met office, anemometer mast
    k.box('wall_concrete', -2, 0, -2, 7, 20, 7, 0xe6e4de, { top: 'roof_flat' });
    k.box('concrete', -2, 20, -2, 9, 0.6, 9, 0xd8d6d0);
    const top = radome(k, -2, -2, 20.6, 5);
    k.box('wall_office', 8, 0, 8, 10, 4, 8, 0xeeeeea, { top: 'roof_flat' });
    k.cyl('metal', 10, 4, 5, 0.06, 0.06, 6, 0x777777, 4);
    k.box('metal', 10, 10, 5, 1.4, 0.08, 0.08, 0x777777);
    k.anim([10, 10.4, 5], [0, 1, 0], 3, (s) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        s.pipe('metal', [10, 10.4, 5], [10 + Math.cos(a) * 0.6, 10.4, 5 + Math.sin(a) * 0.6], 0.03, 0x777777, 3);
        s.ball('plain', 10 + Math.cos(a) * 0.6, 10.4, 5 + Math.sin(a) * 0.6, 0.14, 0xf4f4f4, 6, 4);
      }
    });
    k.box('plain', 3, 0, 12, 1.4, 1.2, 1.4, 0xf4f4f4);
    fence(k, [[-W / 2 + 1, -D / 2 + 1], [W / 2 - 1, -D / 2 + 1], [W / 2 - 1, D / 2 - 1], [-W / 2 + 1, D / 2 - 1]], 2, 0x8a9096, 2.6, 'metal', true);
    return top;
  },

  tsunami_buoys(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xc8c3b8, 0.2, 0.04);
    quay(k, 0, -D / 2 + 5, W - 1, 5, 0.3);
    jetty(k, 8, -D / 2 + 1, 2.4, 14, 0.8);
    // monitoring station with satellite uplink
    k.box('wall_office', -6, 0, 6, 14, 4, 9, 0xeeeeea, { top: 'roof_flat' });
    k.box('plain', -6, 3, 10.55, 14, 0.6, 0.1, 0xf07a1a, { top: false });
    antennaMast(k, -10, -2, 12, 0.5);
    k.at(0, 4, 6, 0, () => {
      k.push(new THREE.Matrix4().makeTranslation(0, 1, 0).multiply(new THREE.Matrix4().makeRotationX(-0.8)));
      k.rev('metal', 0, 0, 0, [[0.1, 0], [1.2, 0.3]], 0xf4f4f4, 12, { crease: 80 });
      k.pop();
    });
    // bright yellow DART buoys out on the water
    for (const [x, z] of [[-8, -D / 2 - 6], [4, -D / 2 - 12], [14, -D / 2 - 4]] as P2[]) {
      k.cyl('plain', x, -0.8, z, 1.4, 1.4, 1.4, C.yellow, 12);
      k.cyl('metal', x, 0.6, z, 0.2, 0.15, 3, 0xd8d8d8, 6);
      k.box('solar', x, 2.2, z, 1, 0.06, 1, 0xffffff, { top: 'solar' });
      k.light(x, 3.8, z, 0xffd23a, 2, 'beacon', true);
    }
    return 14;
  },
};

export const SAFETY_MODELS = models(M);
