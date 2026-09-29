// Healthcare and deathcare.
import * as THREE from 'three';
import { Kit, type P2 } from './kit';
import { C, shade, mix, lawnColor, civicLook } from './colors';
import { models } from './define';
import { ambulance, bench, bush, car, flowerBed, hedge, helicopter, lampPost, parkingLot, parkedCars, person, playEquipment, tree, treeGrove, themeTree, umbrella, crowd, wallLine, fence } from './props';
import { archWindow, civicBlock, lampsAlong, officeBlock, spire, lotEdge, portico } from './arch';

// ── shared bits ────────────────────────────────────────────────────────────
/** illuminated red-cross sign box on a +Z face */
function crossSign(k: Kit, x: number, y: number, z: number, s: number): void {
  k.box('plain', x, y - s * 0.6, z - 0.05, s * 1.2, s * 1.2, 0.2, 0xf4f4f0);
  k.crossGlyph(x, y, z + 0.08, s, 0xe0242a);
  k.light(x, y - s * 0.1, z + 0.6, 0xff4040, s * 2.2, 'neon');
}

/** emergency entrance with deep canopy and ambulance bays, facing +Z at z */
function emergencyBay(k: Kit, x: number, z: number, w = 10): void {
  k.box('concrete', x, 3.6, z + 3, w, 0.5, 6, 0xf0efe9, { bottom: true });
  for (const s of [-1, 1]) k.box('metal', x + s * (w / 2 - 0.4), 0, z + 5.6, 0.35, 3.6, 0.35, 0x8a8e92);
  k.box('emissive', x, 4.1, z + 6.02, w * 0.7, 0.8, 0.08, 0xd42a2a);
  k.light(x, 4.4, z + 6.4, 0xff4040, 4, 'neon');
  k.light(x, 3.3, z + 3, C.lampCool, 4, 'lamp');
  ambulance(k, x - 2.4, z + 3.2, Math.PI / 2);
  ambulance(k, x + 2.4, z + 3.2, Math.PI / 2);
}

/** rooftop helipad on a flat roof (y = roof height) */
function roofHelipad(k: Kit, x: number, y: number, z: number, r: number): void {
  k.cyl('metal', x, y, z, r * 0.6, r * 0.6, 1.4, 0x6a6e72, 10, false);
  k.helipad(x, y + 1.4, z, r, true);
  k.box('metal', x, y + 1.4, z, r * 2.2, 0.1, 0.1, 0x6a6e72, { top: false });
}

/** cypress row / columnar trees */
function cypressRow(k: Kit, x0: number, z0: number, x1: number, z1: number, n: number, scale = 0.8): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    tree(k, 'cypress', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, scale * (0.9 + (i % 3) * 0.08), i, i);
  }
}

/** headstone rows inside a rectangle */
function headstones(k: Kit, cx: number, cz: number, w: number, d: number, spacingX = 2.2, spacingZ = 3): void {
  const r = k.ctx.rng;
  const nx = Math.floor(w / spacingX), nz = Math.floor(d / spacingZ);
  const stones = [0x9a968f, 0x7d7a75, 0xb8b3aa, 0x5d5b58, 0xcfc9bd];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (r.chance(0.12)) continue;
      const x = cx - w / 2 + (i + 0.5) * spacingX + r.range(-0.1, 0.1), z = cz - d / 2 + (j + 0.5) * spacingZ;
      const col = r.pick(stones);
      const kind = r.int(0, 3);
      if (kind === 0) {
        k.box('concrete', x, 0, z, 0.8, 1.0, 0.2, col);
        if (!k.lo) k.cyl('concrete', x, 1.0, z - 0.1, 0.4, 0.4, 0.2, col, 6, true, false);
      } else if (kind === 1) {
        k.box('concrete', x, 0, z, 0.25, 1.5, 0.2, col);
        k.box('concrete', x, 1.0, z, 0.8, 0.22, 0.2, col);
      } else if (kind === 2) {
        k.box('concrete', x, 0, z, 0.9, 0.7, 0.3, col);
      } else {
        k.box('concrete', x, 0, z + 0.9, 1.0, 0.35, 2.0, col);
        k.box('concrete', x, 0.35, z, 0.9, 0.8, 0.18, col);
      }
      if (!k.lo && r.chance(0.3)) k.box('plain', x, 0, z + 0.3, 0.4, 0.2, 0.3, r.pick([0xd04040, 0xf2c230, 0xf4f4f4, 0xb05cc8]));
    }
}

/** small chapel with bell cote / spire, entrance facing +Z */
function chapel(k: Kit, x: number, z: number, w: number, d: number, wallColor: number, roofColor: number, rotY = 0): number {
  let top = 0;
  k.at(x, 0, z, rotY, () => {
    k.box('wall_stone', 0, 0, 0, w, 5.4, d, wallColor, { top: false });
    k.gableRoof('roof_tile', 0, 5.4, 0, w, d, w * 0.55, roofColor, { overhang: 0.4, ridgeAlongX: false, wallMat: 'wall_stone', wallColor });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      k.at(s * (w / 2 + 0.04), 0, -d / 2 + 2.5 + i * ((d - 4) / 2), s * Math.PI / 2, () => archWindow(k, 0, 1.6, 0, 1.0, 2.8, shade(wallColor, 1.05), 0x39465a));
    }
    archWindow(k, 0, 0, d / 2 + 0.05, 1.8, 3.2, shade(wallColor, 1.05), 0x4a3526, 'wood');
    k.box('wall_stone', 0, 5.4 + w * 0.55 - 0.4, d / 2 - 1, 1.6, 2.2, 1.6, wallColor, { top: false });
    spire(k, 0, 5.4 + w * 0.55 + 1.8, d / 2 - 1, 1.1, 4.5, roofColor);
    top = 5.4 + w * 0.55 + 8.5;
    k.light(0, 3.6, d / 2 + 0.6, C.lampWarm, 2.4, 'lamp');
  });
  return top;
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  clinic(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('grass', lawnColor(k.ctx, 0.55), 0.2, 0.04);
    k.slab('paving', 0, D / 2 - 5, W - 1, 9, 0.08, 0xcfc9bd, 0.2);
    const wc = mix(look.wallColor, 0xf4f4f0, 0.55);
    const top = civicBlock(k, look, -3, -4, 20, 14, 2, { color: wc, roof: look.modern ? 'flat' : look.roof });
    k.box('wall_glass', 7.5, 0, -1, 7, 3.6, 8, 0xcfe0e8, { top: 'roof_flat' });
    k.entrance(-3, 3.2, 3, 2.8, true);
    crossSign(k, 3.2, 6.2, 3.3, 1.8);
    k.box('plain', -3, 3.5, 3.25, 8, 0.8, 0.1, 0x1f6fb0, { top: false });
    parkedCars(k, -12, D / 2 - 3, 4, D / 2 - 3, 2.8, Math.PI / 2, 0.7);
    ambulance(k, 9, D / 2 - 4, 0);
    tree(k, themeTree(k.ctx, 'shade'), -12, -12, 0.9);
    tree(k, themeTree(k.ctx, 'shade'), 12, -12, 0.8, 1, 1);
    bench(k, 11, 5, -Math.PI / 2);
    bush(k, -13, 2, 1);
    return top;
  },

  hospital(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xcfcac0, 0.2, 0.04);
    const white = 0xf2f2ee;
    // podium (3 floors) + ward tower (10 floors)
    k.box('wall_office', 0, 0, -6, 40, 10.5, 26, white, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('wall_glass', 0, 0.05, 7.05, 16, 4.2, 0.1, 0xbcd6e4, { top: false });
    const tz = -10;
    const floors = 10;
    const th = 10.5 + floors * 3.3;
    k.box('wall_office', 0, 10.5, tz, 26, floors * 3.3, 14, white, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let i = 0; i < floors; i++) k.box('plain', 0, 10.5 + i * 3.3 + 3.1, tz + 7.05, 26.2, 0.2, 0.12, 0x2f7fc0, { top: false });
    k.box('wall_glass', 13.1, 10.5, tz, 0.4, floors * 3.3, 8, 0xa8c8dc, { top: false });
    k.parapet(0, th, tz, 26, 14, 0.8, 0xe8e8e4);
    crossSign(k, -9, th - 2, tz + 7.2, 3.4);
    k.box('emissive', 3, th - 3.6, tz + 7.12, 14, 1.6, 0.06, 0xf4f4f4);
    k.light(3, th - 2.8, tz + 7.6, 0xffffff, 8, 'neon');
    roofHelipad(k, 0, th, tz, 6);
    k.box('metal', -10, th, tz - 4, 4, 2.4, 3, 0xb8bcc0);
    // emergency department + main entrance + parking
    emergencyBay(k, 13, 7);
    k.entrance(-8, 7, 4, 3.2, true);
    k.parapet(0, 10.5, -6, 40, 26, 0.8, 0xe8e8e4);
    parkingLot(k, -10, D / 2 - 7, 24, 12, 0.7);
    for (const x of [-20, 20]) tree(k, themeTree(k.ctx, 'shade'), x, D / 2 - 3, 0.85, x);
    lampsAlong(k, [[0, D / 2 - 1], [W / 2 - 1, D / 2 - 1]], 10, 5, 'modern', 0);
    return th + 3;
  },

  medical_center(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd2cdc3, 0.2, 0.04);
    const white = 0xf4f4f1;
    // two towers joined by a glass atrium and skybridges
    const tH = [15, 11];
    const xs = [-16, 16];
    let top = 0;
    xs.forEach((x, i) => {
      const f = tH[i];
      const h = 5 + f * 3.3;
      k.box('glass', x, 0, -10, 20, 5, 18, 0x6f8fa4, { top: false });
      k.box('wall_office', x, 5, -10, 22, f * 3.3, 20, white, { top: 'roof_flat', topColor: 0x6a6e72 });
      for (let j = 0; j < f; j += 2) k.box('plain', x, 5 + j * 3.3 + 3.2, -10 + 10.06, 22.2, 0.3, 0.12, 0x2aa6a0, { top: false });
      k.parapet(x, h, -10, 22, 20, 1, 0xe6e6e2);
      top = Math.max(top, h);
      if (i === 0) {
        roofHelipad(k, x, h, -10, 7);
        crossSign(k, x - 6, h - 3, 0.2, 3.6);
      } else {
        k.hvac(x, h, -10, 22, 20, 4);
        k.box('emissive', x, h - 3.4, 0.08, 16, 1.8, 0.06, 0xf4f4f4);
        k.light(x, h - 2.4, 0.6, 0xffffff, 9, 'neon');
      }
    });
    k.box('wall_glass', 0, 0, -8, 10, 22, 16, 0xbcd6e4, { top: 'glass', topColor: 0x9fc4d8 });
    for (const y of [26, 38]) k.box('wall_glass', 0, y, -10, 12, 3.6, 5, 0xbcd6e4, { top: 'roof_flat' });
    // outpatient wing + emergency + drop-off loop
    k.box('wall_office', 18, 0, 12, 22, 7, 14, white, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.parapet(18, 7, 12, 22, 14, 0.8, 0xe6e6e2);
    emergencyBay(k, 18, 19);
    k.ribbon('asphalt', [[-30, D / 2], [-24, 12], [-8, 12], [-4, D / 2]], 6, 0.09, C.asphalt);
    k.entrance(-14, 1.2, 5, 3.4, true);
    parkingLot(k, -16, D / 2 - 5, 18, 8, 0.8);
    treeGrove(k, 0, 12, 8, 6, 3, 'shade');
    flowerBed(k, -6, 20, 6, 2.2);
    lampsAlong(k, [[-W / 2 + 1, D / 2 - 1], [W / 2 - 1, D / 2 - 1]], 12, 5, 'modern', 0);
    return top + 2;
  },

  childrens_hospital(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.65), 0.2, 0.04);
    k.slab('paving', 0, 0, W - 4, D - 18, 0.07, 0xe0d8c8, 0.2);
    // colourful stacked volumes with rounded corner tower
    const palette = [0xf2a93b, 0x5cb85c, 0x4aa3df, 0xe8665a, 0x9b6cc8, 0xf2d04b];
    const r = k.ctx.rng;
    k.box('wall_office', -6, 0, -8, 30, 13.7, 18, 0xf6f4ee, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let f = 0; f < 4; f++)
      for (let i = 0; i < 8; i++) {
        if (r.chance(0.35)) continue;
        k.box('plain', -19.5 + i * 3.8, f * 3.3 + 0.9, 1.06, 1.1, 2.2, 0.1, palette[(i + f * 3) % palette.length], { top: false });
      }
    k.cyl('wall_glass', 12, 0, -6, 7, 7, 20, 0xc8e4f0, k.seg(20), true);
    k.cyl('plain', 12, 20, -6, 7.3, 7.3, 1.2, 0xf2a93b, k.seg(20));
    k.box('plain', -6, 13.7, -8, 30.4, 1.2, 18.4, 0x4aa3df, { top: 'grass', topColor: lawnColor(k.ctx, 0.8) });
    crossSign(k, -18, 11.5, 1.2, 2.2);
    // playful entrance canopy, garden with playground
    k.box('plain', -4, 3.6, 3.5, 10, 0.5, 5, 0xf2d04b, { bottom: true });
    for (const s of [-1, 1]) k.cyl('plain', -4 + s * 4.4, 0, 5.6, 0.25, 0.25, 3.6, 0xe8665a, 8);
    k.entrance(-4, 1.1, 3, 2.8, false);
    playEquipment(k, 'slide', 14, 12, 0);
    playEquipment(k, 'swing', 6, 16, 0);
    playEquipment(k, 'carousel', 18, 17, 0);
    k.slab('sand', 12, 15, 16, 8, 0.1, 0xe8d8a8, 0.1);
    ambulance(k, -18, D / 2 - 5, 0);
    parkedCars(k, -20, D / 2 - 2.5, -4, D / 2 - 2.5, 2.8, Math.PI / 2, 0.6);
    for (const [x, z] of [[-20, 12], [22, -20], [-22, -20]] as P2[]) tree(k, themeTree(k.ctx, 'shade'), x, z, 0.8, x);
    crowd(k, 8, 14, 10, 6, 5);
    return 21.5;
  },

  eldercare(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['gable', 'hip']);
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    // L-shaped home: wing along the road + wing into the garden
    const wc = mix(look.wallColor, 0xf0e6d6, 0.3);
    const roof = look.roof === 'flat' ? 'hip' : look.roof;
    civicBlock(k, look, -2, 8, 24, 11, 2, { color: wc, roof, plinth: false });
    const top = civicBlock(k, look, -8, -8, 11, 22, 2, { color: wc, roof, plinth: false });
    k.entrance(-2, 13.5, 3, 2.6, true, 0x5a4a3a, 0xe8dcc8);
    // balconies with flower boxes
    if (!k.lo) for (let i = 0; i < 4; i++) {
      k.box('concrete', -10 + i * 6, 3.3, 14, 2.6, 0.2, 1.2, 0xe8e2d6);
      k.box('plain', -10 + i * 6, 3.5, 14.55, 2.6, 0.7, 0.08, shade(look.trim, 0.9), { top: false });
      k.box('foliage', -10 + i * 6, 4.2, 14.5, 2.2, 0.3, 0.3, 0xd84a6a);
    }
    // sensory garden: paths, pergola, benches, flowers
    const path: P2[] = [[2, 2], [8, -4], [10, -14], [4, -20]];
    k.ribbon('paving', path, 2, 0.1, 0xd8ccb4);
    k.at(9, 0, -10, 0, () => {
      for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as P2[]) k.box('wood', x, 0, z, 0.25, 2.6, 0.25, C.woodLight);
      for (let i = 0; i < 6; i++) k.box('wood', -2.4 + i * 0.95, 2.6, 0, 0.14, 0.18, 4.6, C.woodLight);
    });
    bench(k, 6, -4, Math.PI * 0.75);
    bench(k, 6, -16, Math.PI * 0.5);
    flowerBed(k, 10, 2, 5, 2);
    flowerBed(k, 1, -14, 3, 3);
    tree(k, themeTree(k.ctx, 'shade'), 11, -20, 0.9);
    person(k, 7, -5, 0x9a7a6a, 1);
    person(k, 3, -1, 0x6a7a9a, 2);
    hedge(k, 0, D / 2 - 0.9, W - 2, 0.8, 1);
    return top;
  },

  medical_lab(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd6d2ca, 0.2, 0.04);
    // research lab: glass front, solid lab wing with fume-hood stacks
    k.box('wall_glass', -6, 0, 0, 28, 13.9, 14, 0xbcd6e4, { top: 'roof_flat', topColor: 0x6a6e72 });
    for (let i = 0; i < 9; i++) k.box('plain', -19.5 + i * 3.4, 0, 7.1, 0.4, 13.9, 0.6, 0xf2f2ee, { top: false });
    k.box('wall_concrete', 14, 0, -3, 14, 17.5, 18, 0xe6e4de, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.parapet(-6, 13.9, 0, 28, 14, 0.8, 0xe6e4de);
    for (let i = 0; i < 6; i++) k.cyl('metal', 9.5 + (i % 3) * 4.5, 17.5, -8 + Math.floor(i / 3) * 8, 0.45, 0.45, 4.5, 0xb8bcc0, 8);
    k.box('metal', 14, 17.5, 3, 8, 2.2, 4, 0xa8aeb4);
    // DNA helix sculpture on the forecourt
    const hx = -14, hz = 11;
    const turns = k.lo ? 10 : 18;
    for (let i = 0; i < turns; i++) {
      const a = i * 0.55, y = 0.6 + i * 0.36;
      const p1: [number, number, number] = [hx + Math.cos(a) * 1.3, y, hz + Math.sin(a) * 1.3];
      const p2: [number, number, number] = [hx - Math.cos(a) * 1.3, y, hz - Math.sin(a) * 1.3];
      k.ball('plain', p1[0], p1[1], p1[2], 0.28, 0x3a8ad8, 6, 4);
      k.ball('plain', p2[0], p2[1], p2[2], 0.28, 0xe8665a, 6, 4);
      k.beam('metal', p1, p2, 0.08, 0.08, 0xd8dcdf);
    }
    k.cyl('concrete', hx, 0, hz, 2, 2, 0.5, 0xb8b4aa, 12);
    k.light(hx, 4, hz, 0x8fc8ff, 5, 'neon');
    k.entrance(2, 7, 4, 3.2, true);
    k.sign(-6, 11.2, 7.2, 9, 1.2, 0x2aa6a0, 0x7fffea);
    parkedCars(k, 8, D / 2 - 3, 22, D / 2 - 3, 2.8, Math.PI / 2, 0.7);
    return 22;
  },

  medical_heli(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.45), 0.2, 0.04);
    k.slab('asphalt', 0, 0, W - 4, D - 4, 0.07, 0x55585c, 0.2);
    k.helipad(-5, 0.1, -5, 6.5, true);
    helicopter(k, -5, 0.35, -5, 0.4, 0xd42a2a, true);
    // hangar + crew building with rooftop windsock
    k.box('wall_industrial', 8, 0, -4, 12, 8, 18, 0xe6e8e4, { top: false });
    k.barrel('roof_metal', 8, 8, -4, 12.4, 18.4, 2.2, 0xd42a2a, k.seg(10), false, 'wall_industrial', 0xe6e8e4);
    k.box('metal', 1.95, 0, -4, 0.1, 6.8, 14, 0x9aa0a6, { top: false });
    k.box('wall_office', 4, 0, 10, 20, 6.8, 7, 0xf2f2ee, { top: 'roof_flat', topColor: 0x6a6e72 });
    crossSign(k, -3, 5.6, 13.6, 1.6);
    k.cyl('metal', 12, 6.8, 10, 0.06, 0.06, 4.5, 0x777777, 5);
    k.rev('plain', 12, 10.4, 10.4, [[0.35, 0], [0.12, 1.8]], 0xf06a1a, 6, {});
    ambulance(k, -10, D / 2 - 4, 0);
    for (let i = 0; i < 6; i++) k.light(-13 + i * 3.5, 0.3, 7, 0x6fb0ff, 1.2, 'beacon');
    return 12;
  },

  spa_sanatorium(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx, ['hip', 'mansard', 'gable']);
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.04);
    // grand historic spa hall with colonnade (back) + thermal pool terrace (front)
    const wc = mix(look.wallColor, C.cream, 0.5);
    const roof = look.roof === 'flat' ? 'mansard' : look.roof;
    const top = civicBlock(k, look, 0, -13, 40, 14, 3, { color: wc, roof });
    k.colonnade(-18, 18, -5.2, 11, 0.4, 5.4, 0xf4efe4, 0);
    k.box('plain', 0, 5.4, -5.6, 38, 0.6, 1.8, 0xf0eadc);
    k.dome('roof_metal', 0, top, -13, 4.5, C.copper, 16, 1);
    k.box('wall_stone', 0, 0, 5, 30, 0.9, 16, 0xe6dccb, { top: 'paving', topColor: 0xe6dccb });
    k.box('water', 0, 0.1, 5, 24, 0.86, 10, 0x6fc8d0, { top: 'water', topColor: 0x4fb6c6 });
    for (let i = 0; i < 4; i++) k.emitter('steam', -9 + i * 6, 1.3, 5, 0.35);
    for (let i = 0; i < 6; i++) umbrella(k, -14 + i * 5.6, 12.5, [0xf4f4f0, 0x2f6fa8][i % 2], 1.5, 2.6);
    for (let i = 0; i < 4; i++) k.box('wood', -10.5 + i * 7, 0.9, 11.2, 0.8, 0.3, 2, C.woodLight);
    // formal gardens + fountain
    for (const s of [-1, 1]) {
      hedge(k, s * 19, 10, 6, 14, 1.2);
      tree(k, 'cypress', s * 21, -2, 0.8, s);
    }
    k.cyl('concrete', 0, 0, D / 2 - 4, 2.4, 2.4, 0.6, 0xe6dccb, 14);
    k.disc('water', 0, 0.55, D / 2 - 4, 2.1, 0x6fc8d0, 14);
    k.emitter('fountain', 0, 0.9, D / 2 - 4, 0.8);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 8, 4, 'classic', 0);
    crowd(k, 0, 14, 20, 3, 6);
    return top + 5;
  },

  cemetery(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.5), 0.2, 0.04);
    // perimeter wall with wrought-iron gate at the front
    lotEdge(k, 1.6, 0x8f8a80, 6, 'wall_stone', 0.5);
    for (const s of [-1, 1]) {
      k.box('wall_stone', s * 3.2, 0, D / 2 - 0.6, 0.9, 2.8, 0.9, 0x8f8a80);
      k.ball('concrete', s * 3.2, 3.05, D / 2 - 0.6, 0.35, 0x8f8a80, 8, 5);
    }
    k.box('metal', 0, 2.4, D / 2 - 0.6, 5.6, 0.12, 0.12, 0x1e1e1e);
    // paths: central avenue + cross path
    k.ribbon('dirt', [[0, D / 2], [0, -D / 2 + 12]], 3, 0.09, 0xb8ad96);
    k.ribbon('dirt', [[-W / 2 + 2, 2], [W / 2 - 2, 2]], 2, 0.09, 0xb8ad96);
    // grave fields
    headstones(k, -12, 12, 18, 16);
    headstones(k, 12, 12, 18, 16);
    headstones(k, -12, -8, 18, 16);
    headstones(k, 12, -6, 18, 12);
    // chapel at the end of the avenue + cypress avenue
    const top = chapel(k, 0, -D / 2 + 7, 8, 10, 0xd9d2c3, 0x5a4a44);
    cypressRow(k, -2.5, D / 2 - 5, -2.5, -8, 5, 0.75);
    cypressRow(k, 2.5, D / 2 - 5, 2.5, -8, 5, 0.75);
    tree(k, 'willow', -W / 2 + 5, -D / 2 + 5, 0.9);
    bench(k, -4, 2, Math.PI / 2);
    return Math.max(top, 10);
  },

  crematorium(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.55), 0.2, 0.04);
    // serene modern hall: stone walls, deep roof, reflecting pool
    const stone = 0xd8d2c4;
    k.box('wall_stone', 0, 0, -8, 24, 7, 16, stone, { top: false });
    k.box('concrete', 0, 7, -7, 27, 0.8, 20, 0xe8e6e0, { bottom: true });
    k.box('wall_glass', 0, 0.1, 0.05, 12, 6, 0.1, 0xbcc8cc, { top: false });
    // tall slim chimney clad in stone
    k.box('wall_stone', 8, 0, -14, 2.6, 18, 2.6, stone, { top: 'concrete', topColor: 0x5a5a5a });
    k.emitter('steam', 8, 18.3, -14, 0.15);
    // colonnade walk + reflecting pool + garden of remembrance
    k.colonnade(-10, 10, 3.2, 6, 0.3, 4, 0xece8de);
    k.box('concrete', 0, 4, 3.2, 22, 0.5, 1.2, 0xe8e6e0);
    k.box('concrete', 0, 0, 13, 16, 0.4, 7, 0xb8b4aa, { top: 'water', topColor: 0x3f6f7a });
    cypressRow(k, -W / 2 + 3, D / 2 - 4, -W / 2 + 3, -D / 2 + 4, 6, 0.7);
    cypressRow(k, W / 2 - 3, D / 2 - 4, W / 2 - 3, -D / 2 + 4, 6, 0.7);
    bench(k, 0, 17.5, Math.PI);
    flowerBed(k, -8, 19, 4, 1.4, [0xf5f0f0, 0xb05cc8]);
    flowerBed(k, 8, 19, 4, 1.4, [0xf5f0f0, 0xb05cc8]);
    k.light(0, 6, 1, C.lampWarm, 4, 'lamp');
    return 18.5;
  },

  memorial_park(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    // radial layout around an eternal-flame memorial
    k.disc('paving', 0, 0.08, -2, 14, 0xd8d2c4, k.seg(32));
    k.ring('concrete', 0, 0.12, -2, 13.2, 14, 0xa8a49a, k.seg(32));
    k.cyl('concrete', 0, 0, -2, 3.5, 3.5, 0.9, 0x5d5b58, 16);
    k.cyl('concrete', 0, 0.9, -2, 1.4, 1.1, 1.3, 0x4a4845, 12);
    k.cyl('neon', 0, 2.2, -2, 0.6, 0.05, 1.4, 0xff9a2a, 8, false);
    k.light(0, 2.8, -2, 0xffa040, 4, 'neon');
    // obelisk
    k.box('wall_stone', 0, 0, -D / 2 + 9, 3, 1, 3, 0xcfc9bc);
    k.rev('concrete', 0, 1, -D / 2 + 9, [[1.1, 0], [0.75, 11.5], [0, 13]], 0xe8e2d4, 4, { crease: 10 });
    // memorial walls with names + columbarium niches
    for (const s of [-1, 1]) {
      k.at(s * 18, 0, -4, s * -Math.PI / 2, () => {
        k.box('wall_stone', 0, 0, 0, 22, 3.2, 1.2, 0x4a4845, { top: 'concrete', topColor: 0x5d5b58 });
        if (!k.lo) for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) k.box('plain', -9.9 + i * 2.2, 0.4 + j * 0.9, 0.61, 1.9, 0.7, 0.04, 0x8a8680, { top: false });
      });
    }
    // radiating paths, reflecting pools, trees in rings
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.ribbon('paving', [[Math.cos(a) * 14, -2 + Math.sin(a) * 14], [Math.cos(a) * 29, -2 + Math.sin(a) * 29]], 2.4, 0.09, 0xd8d2c4);
    }
    k.box('concrete', 0, 0, D / 2 - 8, 20, 0.35, 5, 0xb8b4aa, { top: 'water', topColor: 0x3f6f7a });
    k.ribbon('paving', [[0, D / 2], [0, 12]], 3, 0.09, 0xd8d2c4);
    const n = k.lo ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      tree(k, themeTree(k.ctx, 'formal'), Math.cos(a) * 20, -2 + Math.sin(a) * 20, 0.8, a, i);
    }
    for (let i = 0; i < 6; i++) bench(k, Math.cos((i / 6) * Math.PI * 2) * 11.5, -2 + Math.sin((i / 6) * Math.PI * 2) * 11.5, -(i / 6) * Math.PI * 2 - Math.PI / 2);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 2], [W / 2 - 2, D / 2 - 2]], 10, 4, 'classic', 0);
    crowd(k, 0, 6, 16, 8, 6);
    return 14;
  },
};

export const HEALTH_MODELS = models(M);
