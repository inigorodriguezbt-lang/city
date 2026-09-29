// Public transport: depots, stations, ports and airports.
import * as THREE from 'three';
import { Kit, type P2 } from './kit';
import { C, shade, mix, lawnColor, civicLook } from './colors';
import { models } from './define';
import { airplane, bench, boat, bus, car, container, containerShip, containerStack, crowd, fence, helicopter, parkedCars, parkingLot, person, railCar, taxi, tree, themeTree, trashBin, truck, van } from './props';
import { antennaMast, clockFace, civicBlock, hall, hangar, lampsAlong, quay, rollDoors, archWindow } from './arch';

// ── shared transit parts ───────────────────────────────────────────────────
/** pair of rails with sleepers along X from x0 to x1 at z */
export function track(k: Kit, x0: number, x1: number, z: number, y = 0.08, ballast = true): void {
  if (ballast) k.box('dirt', (x0 + x1) / 2, y - 0.08, z, x1 - x0, 0.3, 3.4, 0x7a746a, { top: 'dirt', topColor: 0x8a847a });
  const n = Math.floor((x1 - x0) / 0.8);
  if (!k.lo) for (let i = 0; i < n; i++) k.box('wood', x0 + (i + 0.5) * ((x1 - x0) / n), y + 0.2, z, 0.28, 0.12, 2.6, 0x5a4a3a, { top: 'wood' });
  for (const s of [-0.72, 0.72]) k.box('metal', (x0 + x1) / 2, y + 0.3, z + s, x1 - x0, 0.14, 0.1, 0x8a8e92);
}

/** platform with canopy along X */
export function platform(k: Kit, x: number, z: number, len: number, w: number, h = 1.0, canopy: number = 0xdedcd6, lights = true): void {
  k.box('concrete', x, 0, z, len, h, w, 0xb8b4aa, { top: 'paving', topColor: 0xc8c2b4 });
  k.box('plain', x, h - 0.01, z + w / 2 - 0.3, len, 0.02, 0.4, C.paintYellow, { top: 'plain' });
  k.box('plain', x, h - 0.01, z - w / 2 + 0.3, len, 0.02, 0.4, C.paintYellow, { top: 'plain' });
  const posts = Math.max(2, Math.round(len / 10));
  for (let i = 0; i <= posts; i++) {
    const px = x - len / 2 + 2 + ((len - 4) * i) / posts;
    k.cyl('metal', px, h, z, 0.18, 0.18, 3.4, 0x5a6168, 6);
    if (lights) k.light(px, h + 3.1, z, C.lampCool, 3, 'lamp');
  }
  k.box('metal', x, h + 3.4, z, len - 2, 0.3, w + 1.2, canopy, { bottom: true, top: 'roof_metal', topColor: shade(canopy, 0.9) });
  if (!k.lo) for (let i = 0; i < Math.round(len / 14); i++) bench(k, x - len / 2 + 7 + i * 14, z, 0);
}

/** overhead catenary mast */
export function catenaryPole(k: Kit, x: number, z: number, span: number, h = 6.5): void {
  k.cyl('metal', x, 0, z - span / 2, 0.14, 0.12, h, 0x6a6e72, 6);
  k.beam('metal', [x, h - 0.2, z - span / 2], [x, h - 0.2, z + span / 2], 0.1, 0.12, 0x6a6e72);
}

/** simple control tower */
function controlTower(k: Kit, x: number, z: number, h: number, color: number = 0xeeeeea): number {
  k.cyl('concrete', x, 0, z, 2.4, 1.8, h, color, k.seg(12));
  k.rev('concrete', x, h, z, [[1.8, 0], [4.2, 1.6], [4.4, 2]], color, k.seg(12), { crease: 50 });
  k.cyl('glass', x, h + 2, z, 4.4, 4.8, 3.2, 0x3a5a70, k.seg(12), false);
  k.cyl('metal', x, h + 5.2, z, 5, 4.8, 0.6, 0x9aa0a6, k.seg(12));
  k.cyl('metal', x, h + 5.8, z, 0.12, 0.08, 4, 0x777777, 5);
  radomeSmall(k, x + 2.4, h + 5.8, z, 0.9);
  k.light(x, h + 3.6, z, 0x9fe0ff, 6, 'neon');
  k.light(x, h + 10, z, C.beaconRed, 2.6, 'beacon', true);
  return h + 10;
}

function radomeSmall(k: Kit, x: number, y: number, z: number, r: number): void {
  k.ball('plain', x, y + r, z, r, 0xf4f4f2, 10, 7);
}

/** runway along X with markings and edge lights */
function runway(k: Kit, x: number, z: number, len: number, w: number): void {
  k.slab('asphalt', x, z, len, w, 0.09, 0x3a3c40, 0.3);
  const y = 0.11;
  k.paint(x - len / 2 + 30, z, x + len / 2 - 30, z, 0.5, y, 0xf4f4f0);
  if (!k.lo) {
    for (let i = 0; i < Math.floor((len - 60) / 12); i++) k.flat('plain', x - len / 2 + 36 + i * 12, z, 6, 0.5, y + 0.005, 0x3a3c40);
    for (const s of [-1, 1]) {
      const ex = x + s * (len / 2 - 6);
      for (let j = 0; j < 6; j++) k.flat('plain', ex, z - w / 2 + 3 + j * ((w - 6) / 5), 18, 1.2, y, 0xf4f4f0);
      k.flat('plain', x + s * (len / 2 - 40), z - w * 0.25, 20, 2.4, y, 0xf4f4f0);
      k.flat('plain', x + s * (len / 2 - 40), z + w * 0.25, 20, 2.4, y, 0xf4f4f0);
    }
  }
  k.paint(x - len / 2, z - w / 2 + 0.6, x + len / 2, z - w / 2 + 0.6, 0.3, y, 0xf4f4f0);
  k.paint(x - len / 2, z + w / 2 - 0.6, x + len / 2, z + w / 2 - 0.6, 0.3, y, 0xf4f4f0);
  const n = Math.round(len / 20);
  for (let i = 0; i <= n; i++) {
    const lx = x - len / 2 + (len * i) / n;
    k.light(lx, 0.4, z - w / 2 - 0.4, 0xfff4d0, 1.6, 'lamp');
    k.light(lx, 0.4, z + w / 2 + 0.4, 0xfff4d0, 1.6, 'lamp');
  }
  for (const s of [-1, 1]) for (let j = 0; j < 5; j++) k.light(x + s * (len / 2 + 0.5), 0.4, z - w / 2 + 2 + j * ((w - 4) / 4), s > 0 ? 0xff3030 : 0x3fff6a, 1.6, 'lamp');
}

/** jet bridge from terminal face (z) out to a stand */
function jetBridge(k: Kit, x: number, z: number, len: number, y = 4.2): void {
  k.box('metal', x, y, z - len / 2, 3, 2.8, len, 0xd8dcdf, { top: 'metal' });
  k.box('glass', x, y + 0.8, z - len / 2, 3.04, 1.0, len - 1, 0x3a5a70, { top: false });
  k.cyl('metal', x, 0, z - len + 2, 0.4, 0.4, y, 0x6a6e72, 6);
  k.box('metal', x, 0, z - len + 2, 2.4, 0.8, 1.2, 0x3a3c40);
}

/** baggage tug + carts */
function baggageTrain(k: Kit, x: number, z: number, rotY: number): void {
  k.at(x, 0, z, rotY, () => {
    k.box('plain', 0, 0.3, 0, 2.4, 1.2, 1.5, C.yellow);
    for (let i = 1; i <= 3; i++) {
      k.box('metal', -i * 2.6, 0.4, 0, 2.2, 0.2, 1.4, 0x6a6e72);
      k.box('plain', -i * 2.6, 0.6, 0, 2, 0.9, 1.2, [0x3a6fd8, 0xd04040, 0x2f9a5a][i % 3]);
    }
  });
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  bus_depot(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    // maintenance hall with drive-through bays
    const top = hall(k, -6, -10, 32, 24, 9, { roof: 'saw', color: 0xe4e6e2, roofColor: 0x2f6f9e });
    rollDoors(k, -6, 2, 26, 5, 5.2, 0xc8ccd0);
    k.box('plain', -6, 7, 2.08, 32, 0.9, 0.1, 0x2f7fd0, { top: false });
    // parked fleet + wash bay + office
    for (let i = 0; i < 5; i++) bus(k, -18 + i * 5.2, 10, Math.PI / 2, [0x2d7fd0, 0x2d7fd0, 0xd8412f, 0x2d7fd0, 0x3fa05a][i], 12);
    k.box('metal', 17, 0, -4, 6, 5, 14, 0x9aa0a6, { top: 'metal', topColor: 0x2f7fd0, sides: { n: false, s: false } });
    bus(k, 17, -4, 0, 0x2d7fd0, 12);
    k.box('wall_office', 17, 0, 15, 10, 4, 7, 0xeeeeea, { top: 'roof_flat' });
    k.sign(17, 2.6, 18.6, 6, 0.8, 0x2f7fd0, 0x7fc0ff);
    k.cyl('metal', 20, 0, 6, 0.8, 0.8, 3, 0xe8e8e2, 10);
    lampsAlong(k, [[-W / 2 + 2, 20], [W / 2 - 14, 20]], 12, 6, 'modern', 0);
    return top;
  },

  taxi_depot(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    k.box('wall_office', -7, 0, -9, 14, 4, 10, 0xf2f0ea, { top: 'roof_flat' });
    k.box('plain', -7, 3, -3.95, 14, 1, 0.1, 0x1a1a1a, { top: false });
    if (!k.lo) for (let i = 0; i < 14; i++) k.box('plain', -13.5 + i, 3.25 + (i % 2) * 0.25, -3.88, 0.5, 0.25, 0.05, C.yellow, { top: false });
    k.sign(-7, 4.6, -3.9, 5, 1, C.yellow, 0xffe680, 0x1a1a1a);
    // canopy with taxis + queue
    k.box('metal', 6, 4, -2, 16, 0.3, 22, 0xe8e8e4, { bottom: true });
    for (const [x, z] of [[-1, -12], [13, -12], [-1, 8], [13, 8]] as P2[]) k.box('metal', x, 0, z, 0.3, 4, 0.3, 0x5a6168);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) taxi(k, 2 + j * 7, -9 + i * 5, Math.PI / 2 * (j ? -1 : 1));
    for (let i = 0; i < 3; i++) taxi(k, -10 + i * 5, 8, Math.PI / 2);
    k.light(6, 3.8, -2, C.lampCool, 6, 'lamp');
    k.cyl('metal', 0, 0, 13, 0.4, 0.4, 1.4, 0x3a3c40, 8);
    return 6;
  },

  bike_hub(k) {
    k.lot('paving', 0xcfc9bb, 0.2, 0.05);
    // docking stations with shared bikes under a solar canopy
    k.box('metal', 0, 2.6, -2, 12, 0.15, 5, 0x6a8a3a, { top: 'solar', bottom: true });
    for (const x of [-5.5, 5.5]) k.cyl('metal', x, 0, -2, 0.1, 0.1, 2.6, 0x3a3d42, 6);
    const cols = [0x3fa05a, 0x3fa05a, 0x2f7fd0];
    for (let i = 0; i < 9; i++) {
      const x = -5 + i * 1.25;
      k.box('metal', x, 0, -3.2, 0.2, 1.1, 0.3, 0x3a3d42);
      k.at(x, 0, -2.3, Math.PI / 2, () => {
        for (const s of [-0.55, 0.55]) {
          k.push(new THREE.Matrix4().makeTranslation(s, 0.35, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
          k.torus('metal', 0, 0, 0, 0.33, 0.035, 0x222222, 10, 3);
          k.pop();
        }
        k.beam('metal', [-0.55, 0.35, 0], [0.15, 0.85, 0], 0.06, 0.06, cols[i % 3]);
        k.beam('metal', [0.55, 0.35, 0], [0.15, 0.85, 0], 0.06, 0.06, cols[i % 3]);
        k.beam('metal', [0.15, 0.85, 0], [0.45, 1.0, 0], 0.05, 0.05, 0x222222);
      });
    }
    k.box('metal', 5.8, 0, 3, 1.2, 2.2, 0.6, 0x3fa05a);
    k.box('emissive', 5.8, 1.2, 3.31, 0.8, 0.6, 0.02, 0xbfe8ff);
    k.light(5.8, 1.6, 3.6, 0x9fe0ff, 1.8, 'neon');
    person(k, 3, 4, 0x3a6fd8, 1);
    tree(k, themeTree(k.ctx, 'shade'), -5.5, 5, 0.6);
    trashBin(k, 1, 5.5);
    return 4;
  },

  tram_depot(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585c, 0.2, 0.04);
    // long brick shed with arched entrances and rails running in from the front
    const brick = mix(C.brick, 0xb07050, 0.4);
    k.box('wall_brick', 0, 0, -8, W - 6, 10, 28, brick, { top: false });
    k.gableRoof('roof_metal', 0, 10, -8, W - 6, 28, 3.2, 0x4a4f57, { wallMat: 'wall_brick', wallColor: brick, ridgeAlongX: false });
    for (let i = 0; i < 4; i++) {
      const x = -21 + i * 14;
      k.box('plain', x, 0, 6.05, 7, 7.2, 0.1, 0x2a2d31, { top: false });
      archWindow(k, x, 0, 6.1, 7, 7.6, 0xe8dcc4, 0x3a4450);
      k.box('dirt', x, 0, 14, 3.6, 0.1, 16, 0x6a645a, { top: 'dirt' });
      for (const s of [-0.72, 0.72]) k.box('metal', x + s, 0.1, 14, 0.12, 0.12, 16, 0x9a9ea2);
      catenaryPole(k, x - 3, 10, 0.1);
    }
    for (let i = 0; i < 4; i++) catenaryPole(k, -26 + i * 18, 18, 0.1, 6.8);
    k.beam('metal', [-W / 2 + 3, 6.6, 10], [W / 2 - 3, 6.6, 10], 0.08, 0.08, 0x333333);
    railCar(k, -21, 14, Math.PI / 2, 0xd8412f, 16, 'tram', 0xf4f4f4);
    railCar(k, 7, 16, Math.PI / 2, 0x2f7fd0, 16, 'tram', 0xf4f4f4);
    k.sign(0, 8.4, 6.2, 12, 1.2, 0xf2c230, 0xffe080);
    return 13.2;
  },

  metro_station(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd0cabd, 0.2, 0.05);
    // glass entrance pavilion over the stairs, with the big "M" totem
    const px = -3, pz = 2;
    k.box('concrete', px, 0, pz, 14, 0.3, 10, 0xb8b4aa);
    k.box('plain', px, -0.5, pz + 0.5, 5, 0.6, 7, 0x1e2024, { top: 'plain', topColor: 0x2a2d31 });
    for (let i = 0; i < 8; i++) k.box('concrete', px, 0.3 - (i + 1) * 0.1, pz + 3.8 - i * 0.9, 4.4, 0.08, 0.9, 0x9a968d);
    k.box('glass', px, 0.3, pz - 3.5, 12, 3.8, 0.1, 0x9fc4d8, { top: false });
    for (const s of [-1, 1]) k.box('glass', px + s * 6, 0.3, pz, 0.1, 3.8, 7, 0x9fc4d8, { top: false });
    k.box('metal', px, 4.1, pz, 14.4, 0.35, 10.4, 0xd8dcdf, { bottom: true, top: 'roof_metal', topColor: 0xc8ccd0 });
    k.light(px, 3.6, pz, 0xeaf4ff, 7, 'lamp');
    // totem with M sign
    const tx = 8, tz = 9;
    k.box('metal', tx, 0, tz, 0.5, 5.2, 0.5, 0x3a3d42);
    k.box('emissive', tx, 5.2, tz, 2.2, 2.2, 0.5, 0xf4f4f4);
    k.box('emissive', tx, 5.2, tz, 2.3, 2.3, 0.45, 0xd8272f);
    k.glyph('M', tx, 5.55, tz + 0.27, 1.5, 0xf4f4f4, 'emissive');
    k.glyph('M', tx, 5.55, tz - 0.27, 1.5, 0xf4f4f4, 'emissive');
    k.light(tx, 6.3, tz + 0.6, 0xff4040, 4, 'neon');
    // vent shaft, bike racks, trees, benches
    k.box('concrete', 9, 0, -9, 5, 2.2, 4, 0xb8b4aa, { top: 'metal', topColor: 0x5a5e62 });
    for (let i = 0; i < 5; i++) k.torus('metal', -12 + i * 1.2, 0.5, -10, 0.45, 0.04, 0x666666, 8, 3);
    tree(k, themeTree(k.ctx, 'formal'), -11, 10, 0.7);
    tree(k, themeTree(k.ctx, 'formal'), -11, -3, 0.7, 1, 1);
    bench(k, 5, -2, -Math.PI / 2);
    crowd(k, 0, 6, 20, 8, 10);
    return 7.4;
  },

  train_station(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['hip', 'mansard', 'gable']);
    k.lot('paving', 0xcfc9bb, 0.2, 0.04);
    // tracks + platforms along the front (rail side), train at the platform
    track(k, -W / 2, W / 2, D / 2 - 4, 0.05);
    track(k, -W / 2, W / 2, D / 2 - 14, 0.05);
    platform(k, 0, D / 2 - 9, W - 8, 6, 1.0);
    railCar(k, -14, D / 2 - 4, 0, 0x2f5f9e, 20, 'coach', 0xf2f2f2);
    railCar(k, 7, D / 2 - 4, 0, 0x2f5f9e, 20, 'coach', 0xf2f2f2);
    railCar(k, 25, D / 2 - 4, 0, 0xd8412f, 12, 'loco', 0xf2f2f2);
    // station hall with arched glass roof and clock
    const hz = -12;
    const stone = look.wall === 'wall_brick' ? look.wallColor : mix(0xe6dcc6, look.wallColor, 0.3);
    const wall = look.wall === 'wall_brick' ? 'wall_brick' : 'wall_stone';
    k.box(wall, 0, 0, hz, 36, 10, 18, stone, { top: false });
    k.barrel('roof_metal', 0, 10, hz, 18.6, 36.6, 7, 0x6a7a86, k.seg(12), true, wall, stone);
    k.box(wall, 0, 0, hz + 9.3, 14, 15, 1.4, stone, { top: 'concrete' });
    archWindow(k, 0, 1.2, hz + 10.05, 10, 11, 0xe8e2d4, 0x5a7084);
    clockFace(k, 0, 13.2, hz + 10.1, 1.3);
    k.box('plain', 0, 10.8, hz + 10.05, 12, 0.8, 0.12, 0x2a2d31, { top: false });
    for (const s of [-1, 1]) civicBlock(k, look, s * 24, hz, 12, 14, 2, { wall, color: stone });
    k.sign(-8, 3.8, hz + 9.2, 6, 0.8, 0x2f5f9e, 0x7fb0ff);
    // canopy bridge from hall to the platform
    k.box('metal', 0, 4.2, hz + 13, 8, 0.3, 8, 0xdedcd6, { bottom: true });
    taxi(k, -20, hz + 12, 0);
    taxi(k, -14, hz + 12, 0);
    crowd(k, 0, D / 2 - 9, W - 12, 4, 16);
    return 17;
  },

  cargo_terminal(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5a5c60, 0.2, 0.04);
    // three loading tracks at the front with a freight train
    for (let i = 0; i < 3; i++) track(k, -W / 2, W / 2, D / 2 - 4 - i * 5, 0.05);
    railCar(k, -26, D / 2 - 4, 0, 0x2a5a3a, 16, 'loco', C.yellow);
    for (let i = 0; i < 4; i++) {
      railCar(k, -8 + i * 17, D / 2 - 4, 0, 0x5a5e62, 16, 'flat');
      container(k, -8 + i * 17, 1.4, D / 2 - 4, 0, [0xb33a2e, 0x2f5f9e, 0x3d8a4a, 0xd9a32b][i], 12.2);
    }
    for (let i = 0; i < 3; i++) railCar(k, -20 + i * 15, D / 2 - 14, 0, 0x8a5a3a, 14, 'hopper');
    // rail-mounted gantry crane spanning the tracks
    const gx = 6, gz = D / 2 - 12;
    for (const s of [-1, 1]) {
      k.box('metal', gx + s * 8, 0, gz, 1.2, 18, 1.2, C.yellow);
      k.box('metal', gx + s * 8, 0, gz, 1.6, 0.8, 26, C.yellow);
      k.box('metal', gx + s * 8, 0, gz - 10, 1.2, 18, 1.2, C.yellow);
    }
    k.box('metal', gx, 18, gz - 5, 17.2, 1.6, 1.6, C.yellow);
    k.box('metal', gx, 18, gz + 2, 17.2, 1.6, 1.6, C.yellow);
    k.box('metal', gx, 18, gz + 9, 17.2, 1.6, 1.6, C.yellow);
    k.box('glass', gx + 2, 15.4, gz + 1, 2.4, 2.4, 2.4, 0x2c3a46, { top: 'plain', topColor: C.yellow });
    k.cable('metal', [gx - 2, 18, gz + 2], [gx - 2, 6, gz + 2], 0, 0.05, 0x222222, 2);
    container(k, gx - 2, 3.4, gz + 2, 0, 0xe06a2a, 12.2);
    k.light(gx, 17.6, gz + 2, 0xf6f8ff, 10, 'flood');
    // container yard + trucks + office
    containerStack(k, -14, -16, 3, 5, 4, 0);
    containerStack(k, 22, -18, 2, 4, 3, 0);
    truck(k, 24, -2, 0, 0xd8412f, 0x2f5f9e, 'container', 15);
    truck(k, -24, -2, Math.PI, 0x2f5f9e, 0xd9a32b, 'container', 15);
    k.box('wall_office', 32, 0, -30, 12, 7, 8, 0xeeeeea, { top: 'roof_flat' });
    for (const [x, z] of [[-W / 2 + 3, -D / 2 + 3], [W / 2 - 3, -D / 2 + 3], [-W / 2 + 3, 8], [W / 2 - 3, 8]] as P2[]) {
      k.cyl('metal', x, 0, z, 0.3, 0.2, 20, 0x9aa0a6, 6);
      k.light(x, 20, z, 0xfff4e0, 8, 'flood');
    }
    return 22;
  },

  monorail_station(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd4d8dc, 0.2, 0.05);
    const y = 10;
    // sleek elevated station on sculpted piers, guideway beam passing through
    for (const x of [-10, 10]) k.rev('concrete', x, 0, -2, [[1.6, 0], [0.9, 3], [0.9, y - 2], [2.2, y - 0.4]], 0xeef0f2, 12, { sz: 2.2, crease: 50 });
    k.box('concrete', 0, y - 0.6, -2, W - 1, 0.8, 12, 0xeef0f2, { top: 'paving', topColor: 0xdfe4e8 });
    k.box('concrete', 0, y + 0.2, -2, W + 12, 1.2, 1.6, 0xd8dcdf);
    for (const x of [-W / 2 - 6, W / 2 + 6]) k.cyl('concrete', x, 0, -2, 0.8, 0.8, y + 0.2, 0xe0e4e8, 10);
    // monorail train on the beam
    k.at(0, y + 1.4, -2, 0, () => {
      for (let c = -1; c <= 1; c++) {
        k.box('plain', c * 9.4, 0, 0, 9, 2.8, 3, 0xf4f6f8);
        k.box('glass', c * 9.4, 1.1, 0, 8.6, 1.1, 3.04, 0x2a4458, { top: false });
        k.box('plain', c * 9.4, 0.25, 0, 9.02, 0.3, 3.02, 0x2aa6c9, { top: false });
      }
      k.rev('plain', 14, 0, 0, [[1.5, 0], [1.5, 2.2], [0.8, 2.8]], 0xf4f6f8, 8, { sz: 1, crease: 50, a0: -Math.PI / 2, a1: Math.PI / 2 });
    });
    // curved roof canopy + glass walls
    k.barrel('metal', 0, y + 4.6, -2, 12, W - 2, 2.6, 0xf4f6f8, k.seg(10), true);
    for (const s of [-1, 1]) k.box('wall_glass', 0, y + 0.2, -2 + s * 5.8, W - 4, 4.3, 0.1, 0xb8d4e4, { top: false });
    k.light(0, y + 4, -2, 0xeaf4ff, 8, 'lamp');
    // lift tower + stairs to street level
    k.box('wall_glass', 10, 0, 8, 3, y + 5, 3, 0xb8d4e4, { top: 'metal', topColor: 0xd8dcdf });
    for (let i = 0; i < 14; i++) k.box('concrete', -8, i * (y / 14), 5 + i * 0.35, 3, y / 14, 0.35, 0xdadee2);
    k.sign(-4, y - 2.4, 4.2, 6, 1, 0x2aa6c9, 0x7feaff);
    crowd(k, 0, 10, 20, 4, 6);
    return y + 7.5;
  },

  ferry_terminal(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xcfc9bb, 0.2, 0.04);
    quay(k, 0, -D / 2 + 4, W - 1, 4, 0.3);
    // waiting hall with wave-shaped roof
    k.box('wall_glass', -4, 0, 2, 30, 6, 12, 0xa8c8dc, { top: false });
    const n = 12;
    for (let i = 0; i < n; i++) {
      const x0 = -20 + (i / n) * 32, x1 = -20 + ((i + 1) / n) * 32;
      const y0 = 7.5 + Math.sin((i / n) * Math.PI * 2) * 1.2, y1 = 7.5 + Math.sin(((i + 1) / n) * Math.PI * 2) * 1.2;
      k.quad('roof_metal', { x: x0, y: y0, z: 9 }, { x: x1, y: y1, z: 9 }, { x: x1, y: y1, z: -5 }, { x: x0, y: y0, z: -5 }, [[x0, 0], [x1, 0], [x1, 14], [x0, 14]], 0xe8eaec, { x: 0, y: 1, z: 0 });
      k.quad('metal', { x: x0, y: y0 - 0.3, z: 9 }, { x: x1, y: y1 - 0.3, z: 9 }, { x: x1, y: y1 - 0.3, z: -5 }, { x: x0, y: y0 - 0.3, z: -5 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xb8bcc0, { x: 0, y: -1, z: 0 });
    }
    for (const [x, z] of [[-20, 9], [12, 9], [-20, -5], [12, -5]] as P2[]) k.box('metal', x, 0, z, 0.3, 7.5, 0.3, 0x5a6168);
    k.sign(-4, 4.4, 8.1, 10, 1.1, 0x2a8fd8, 0x7fcfff);
    // covered gangway + ferry moored over the water
    k.box('metal', 16, 3, -D / 2 - 2, 3, 2.6, 16, 0xd8dcdf, { top: 'metal' });
    k.box('glass', 16, 3.6, -D / 2 - 2, 3.04, 1.2, 15, 0x3a5a70, { top: false });
    k.box('metal', 16, 0, -D / 2 + 6, 1, 3, 1, 0x6a6e72);
    boat(k, 0, -D / 2 - 14, 0, 'ferry', 0xf4f4f4, -0.5);
    parkedCars(k, -W / 2 + 2, D / 2 - 3, 4, D / 2 - 3, 2.8, Math.PI / 2, 0.7);
    crowd(k, -4, 11, 20, 4, 8);
    return 14;
  },

  cargo_harbor(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5a5c60, 0.2, 0.04);
    quay(k, 0, -D / 2 + 8, W - 1, 8, 0.4);
    // container ship alongside the quay (over the water)
    containerShip(k, 0, -D / 2 - 14, 0, Math.min(150, W + 50), -0.5);
    // ship-to-shore gantry cranes on the quay
    for (const cx of [-28, 0, 28]) {
      const cz = -D / 2 + 6;
      for (const s of [-1, 1]) {
        k.box('metal', cx + s * 7, 0, cz, 1.2, 38, 1.2, 0x3a7fc8);
        k.box('metal', cx + s * 7, 0, cz - 14, 1.2, 38, 1.2, 0x3a7fc8);
        k.box('metal', cx + s * 7, 0, cz - 7, 1.8, 1, 17, 0x3a7fc8);
        k.beam('metal', [cx + s * 7, 38, cz + 12], [cx + s * 7, 46, cz - 7], 0.6, 0.6, 0x3a7fc8);
      }
      k.box('metal', cx, 38, cz + 1, 15.2, 2.4, 30, 0x3a7fc8);
      k.box('metal', cx, 38, cz - 32, 3.4, 2.2, 36, 0x3a7fc8);
      k.box('metal', cx, 36, cz - 20, 4, 2, 4, 0x2a2d31);
      k.box('glass', cx, 34.8, cz - 20, 2.4, 1.6, 2.4, 0x2c3a46, { top: false });
      k.box('metal', cx, 40.4, cz + 10, 10, 3, 6, 0xd8dcdf);
      k.light(cx, 40, cz - 14, 0xf6f8ff, 12, 'flood');
      k.light(cx, 46.5, cz - 7, C.beaconRed, 3, 'beacon', true);
    }
    // stacking yard with straddle carriers, trucks, reefer racks
    containerStack(k, -24, 2, 3, 6, 4, 0);
    containerStack(k, 24, 2, 3, 6, 4, 0);
    containerStack(k, 0, 14, 2, 4, 3, Math.PI / 2);
    for (const [x, z] of [[-6, -8], [10, 20]] as P2[]) k.at(x, 0, z, 0, () => {
      for (const s of [-1, 1]) for (const t of [-1, 1]) k.box('metal', s * 1.8, 0, t * 4.5, 0.5, 12, 0.5, 0xd8412f);
      k.box('metal', 0, 12, 0, 4.2, 1.2, 9.6, 0xd8412f);
      k.box('glass', 1.6, 12.4, 3.8, 1.4, 1.6, 1.4, 0x2c3a46, { top: false });
    });
    truck(k, 30, 30, Math.PI, 0x2f5f9e, 0xb33a2e, 'container', 15);
    truck(k, -30, 32, 0, 0xf2c230, 0x3d8a4a, 'container', 15);
    // port authority tower
    k.box('wall_glass', W / 2 - 8, 0, D / 2 - 10, 10, 20, 10, 0xa8c8dc, { top: 'roof_flat' });
    antennaMast(k, W / 2 - 8, D / 2 - 10, 8, 0.5);
    lampsAlong(k, [[-W / 2 + 3, D / 2 - 3], [W / 2 - 18, D / 2 - 3]], 16, 10, 'modern', 0);
    return 55;
  },

  heliport(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xcfc9bb, 0.2, 0.04);
    // raised landing deck above a small terminal
    k.box('wall_glass', 0, 0, 6, 26, 4.2, 12, 0xa8c8dc, { top: false });
    k.box('concrete', 0, 4.2, -2, 28, 1, 28, 0xd8d6d0, { top: 'concrete', topColor: 0x5b5f64 });
    for (const [x, z] of [[-12, -14], [12, -14], [-12, 10], [12, 10]] as P2[]) k.cyl('concrete', x, 0, z, 0.6, 0.6, 4.2, 0xd8d6d0, 10);
    k.helipad(0, 5.2, -2, 11, true);
    helicopter(k, -2, 5.45, -2, 0.6, 0x2a2d31, true);
    k.box('metal', 0, 5.2, 12, 28, 1.1, 0.1, 0xd8dcdf, { top: false });
    k.cyl('metal', 13, 5.2, -15, 0.06, 0.06, 5, 0x777777, 5);
    k.rev('plain', 13, 9.6, -14.6, [[0.35, 0], [0.12, 1.8]], 0xf06a1a, 6, {});
    k.stairs(-10, 13, 3, 4.2, 0xd8d6d0);
    k.sign(0, 2.6, 12.1, 8, 0.9, 0x2a2d31, 0xffffff, 0xf4f4f4);
    taxi(k, 8, D / 2 - 2.5, 0);
    return 12;
  },

  blimp_depot(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('asphalt', 0, 0, W - 4, D - 4, 0.07, 0x55585c, 0.2);
    // giant arched airship hangar
    const hx = -8, hz = -4;
    k.barrel('roof_metal', hx, 0, hz, 26, D - 10, 24, 0xd8dadc, k.seg(14), false, 'metal', 0x8a929a);
    if (!k.lo) for (let i = 1; i < 8; i++) {
      const x = -13 + i * (26 / 8);
      const h = 24 * Math.sqrt(Math.max(0, 1 - (x / 13) ** 2)) - 0.4;
      k.box('metal', hx + x, 0, hz + (D - 10) / 2 + 0.08, 0.25, h, 0.1, 0x6a727a, { top: false });
    }
    k.light(hx, 21, hz + (D - 10) / 2 + 1, C.lampCool, 5, 'lamp');
    // mooring mast with a moored blimp
    const mx = 22, mz = 10;
    k.lattice('metal', mx, mz, 0, 20, 1.6, 0.8, 0xd8412f, 5, 0.25, 0.1);
    k.cyl('metal', mx, 20, mz, 0.8, 0.6, 2, 0x6a6e72, 8);
    k.light(mx, 22.5, mz, C.beaconRed, 3, 'beacon', true);
    k.at(mx - 18, 22, mz - 2, 0.1, () => {
      k.push(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
      k.rev('plain', 0, -17, 0, [[0.2, 0], [3.2, 2.5], [5.5, 7], [6, 14], [5.2, 24], [3, 31], [0.3, 34]], 0xf2f2ee, k.seg(18), { crease: 70 });
      k.pop();
      for (const [a, s] of [[0, 1], [Math.PI / 2, 1], [Math.PI, 1], [-Math.PI / 2, 1]] as [number, number][]) {
        k.pushTRS(-14, 0, 0, 0);
        k.push(new THREE.Matrix4().makeRotationX(a));
        k.tri('plain', { x: 0, y: 3.2, z: 0 }, { x: -5, y: 3.2, z: 0 }, { x: -4.5, y: 7.4 * s, z: 0 }, [0, 0], [1, 0], [1, 1], 0x2f7fd0, { x: 0, y: 0, z: 1 });
        k.tri('plain', { x: 0, y: 3.2, z: 0 }, { x: -5, y: 3.2, z: 0 }, { x: -4.5, y: 7.4 * s, z: 0 }, [0, 0], [1, 0], [1, 1], 0x2f7fd0, { x: 0, y: 0, z: -1 });
        k.pop();
        k.pop();
      }
      k.box('plain', 2, -6.8, 0, 6, 1.4, 1.8, 0xd8dcdf);
      k.box('emissive', 0, -2, 5.6, 14, 2.4, 0.1, 0x2f7fd0);
      k.light(0, -1, 6.4, 0x7fc0ff, 10, 'neon');
    });
    van(k, 10, D / 2 - 5, 0, 0xf2f2ee, 0x2f7fd0);
    return 40;
  },

  small_airport(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.35), 0.2, 0.04);
    runway(k, 0, -D / 2 + 16, W - 6, 18);
    // taxiway + apron
    k.slab('asphalt', 0, -D / 2 + 34, W - 30, 10, 0.08, 0x45474b, 0.2);
    k.paint(-W / 2 + 15, -D / 2 + 34, W / 2 - 15, -D / 2 + 34, 0.3, 0.11, C.paintYellow);
    for (const s of [-1, 1]) k.slab('asphalt', s * (W / 2 - 20), -D / 2 + 26, 10, 10, 0.08, 0x45474b, 0.2);
    k.slab('asphalt', -10, 10, 70, 22, 0.085, 0x4a4c50, 0.2);
    airplane(k, -30, 8, -Math.PI / 2, 0.5, 0x2f7fd0);
    airplane(k, -10, 8, -Math.PI / 2, 0.42, 0xd8412f);
    airplane(k, 44, -D / 2 + 34, 0, 0.36, 0x3fa05a);
    // terminal, control tower, hangars
    k.box('wall_glass', -8, 0, D / 2 - 12, 36, 7, 12, 0xa8c8dc, { top: false });
    k.box('metal', -8, 7, D / 2 - 12, 38, 0.6, 14, 0xe8eaec, { bottom: true });
    k.sign(-8, 4.8, D / 2 - 5.9, 10, 1.1, 0x2f7fd0, 0x7fc0ff);
    const tt = controlTower(k, 20, D / 2 - 14, 16);
    hangar(k, 42, 12, 22, 20, 9, 0xd8dadc, 0x6a7a86);
    parkingLot(k, -40, D / 2 - 9, 30, 12, 0.6);
    return tt;
  },

  intl_airport(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.35), 0.2, 0.04);
    // main runway + parallel taxiway at the back
    runway(k, 0, -D / 2 + 20, W - 10, 30);
    k.slab('asphalt', 0, -D / 2 + 48, W - 50, 14, 0.08, 0x45474b, 0.2);
    k.paint(-W / 2 + 25, -D / 2 + 48, W / 2 - 25, -D / 2 + 48, 0.35, 0.11, C.paintYellow);
    for (const x of [-90, -30, 30, 90]) {
      k.slab('asphalt', x, -D / 2 + 38, 14, 12, 0.08, 0x45474b, 0.2);
      k.paint(x, -D / 2 + 35, x, -D / 2 + 55, 0.3, 0.115, C.paintYellow);
    }
    airplane(k, -60, -D / 2 + 20, 0, 1.0, 0x2f5fa8, 0);
    airplane(k, 70, -D / 2 + 48, Math.PI, 0.9, 0xd8412f, 0);
    // apron with stands
    k.slab('asphalt', 0, -6, W - 40, 50, 0.085, 0x4a4c50, 0.2);
    // terminal: long curved-roof hall + pier with jet bridges
    const tz = 32;
    k.box('wall_glass', 0, 0, tz, 150, 14, 26, 0xa8c8dc, { top: false });
    for (let i = 0; i < 10; i++) {
      const x0 = -78 + i * 15.6, x1 = x0 + 15.6;
      k.barrel('roof_metal', (x0 + x1) / 2, 14, tz, 28, 15.6, 5, 0xe8eaec, k.seg(8), false);
    }
    k.box('wall_glass', 0, 0, tz - 18, 130, 7, 10, 0xa8c8dc, { top: 'roof_metal', topColor: 0xd8dcdf });
    k.sign(0, 10, tz + 13.1, 30, 2, 0x2f7fd0, 0x9fd0ff);
    const liveries = [0x2f5fa8, 0xd8412f, 0x3fa05a, 0xf2c230, 0x8a2f9a, 0x1a1a1a];
    for (let i = 0; i < 6; i++) {
      const x = -55 + i * 22;
      jetBridge(k, x + 3.5, tz - 23, 10, 3.6);
      airplane(k, x + 0.5, -11, Math.PI / 2 + Math.PI, 1.0, liveries[i]);
      baggageTrain(k, x + 10, -2, Math.PI / 2);
    }
    // control tower, hangars, cargo, parking garage, forecourt road
    const tt = controlTower(k, W / 2 - 30, 20, 38);
    hangar(k, -W / 2 + 26, 10, 36, 30, 16, 0xd8dadc, 0x6a7a86);
    hangar(k, W / 2 - 64, 4, 30, 24, 13, 0xd8dadc, 0x6a7a86);
    k.box('wall_concrete', -40, 0, D / 2 - 18, 60, 10, 22, 0xc8c4bc, { top: 'asphalt', topColor: 0x55585c });
    for (let l = 1; l < 3; l++) k.box('concrete', -40, l * 3.3, D / 2 - 18, 60.4, 0.4, 22.4, 0xd8d4cc);
    parkedCars(k, -68, D / 2 - 18, -12, D / 2 - 18, 3, 0, 0.8);
    k.ribbon('asphalt', [[-W / 2, D / 2 - 5], [W / 2, D / 2 - 5]], 10, 0.09, C.asphalt);
    for (let i = 0; i < 4; i++) bus(k, 20 + i * 14, D / 2 - 5, 0, 0x2d7fd0, 12);
    lampsAlong(k, [[-W / 2 + 10, 10], [W / 2 - 10, 10]], 22, 14, 'modern', 0);
    crowd(k, 20, tz + 16, 60, 4, 20);
    return Math.max(tt, 48);
  },
};

export const TRANSIT_MODELS = models(M);
