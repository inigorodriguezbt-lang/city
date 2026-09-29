// Water supply, sewage and garbage facilities.
import * as THREE from 'three';
import { Kit, type P2 } from './kit';
import { C, shade, mix, lawnColor, dryGround, civicLook } from './colors';
import { models } from './define';
import { chimney, conveyor, fence, garbageTruck, pile, tank, truck, bush, treeGrove, sphereTank, containerStack, container, solarRow, lampPost } from './props';
import { basin, clarifier, hall, quay, rollDoors, archWindow, pipeRack, lampsAlong, windTurbine, officeBlock } from './arch';

// ── shared bits ────────────────────────────────────────────────────────────
/** big pipe running from (x, z0) at height y towards −Z, diving into the water at the back */
function intakePipe(k: Kit, x: number, z0: number, z1: number, r: number, color: number, y = r + 0.3): void {
  k.pipe('metal', [x, y, z0], [x, y, z1 + 3], r, color, k.seg(10));
  k.pipe('metal', [x, y, z1 + 3], [x, -2.5, z1 - 1], r, color, k.seg(10));
  const n = Math.max(1, Math.floor((z0 - z1) / 7));
  for (let i = 0; i <= n; i++) {
    const z = z0 - ((z0 - z1 - 3) * i) / n;
    k.box('concrete', x, 0, z, r * 2.4, y - r * 0.6, 0.8, C.concrete);
  }
}

/** egg-shaped anaerobic digester (steel) */
function digesterEgg(k: Kit, x: number, z: number, h: number, color: number = 0xc9ced3): void {
  const r = h * 0.3;
  k.rev('metal', x, 0, z, [[r * 0.5, 0], [r * 0.95, h * 0.2], [r, h * 0.45], [r * 0.85, h * 0.7], [r * 0.45, h * 0.92], [r * 0.12, h]], color, k.seg(18), { crease: 70 });
  k.cyl('metal', x, h, z, r * 0.14, r * 0.14, 1.4, 0x6a6e72, 8);
  k.box('metal', x, h + 1.2, z, r * 1.2, 0.2, r * 1.2, 0x8a8e92);
  if (!k.lo) {
    k.beam('metal', [x + r * 1.1, 0, z], [x + r * 0.2, h + 1.2, z], 0.1, 0.6, C.yellow);
    k.torus('metal', x, h * 0.45, z, r + 0.15, 0.12, 0x8a8e92, k.seg(18), 4);
  }
}

/** gas holder / membrane dome (biogas) */
function membraneDome(k: Kit, x: number, z: number, r: number, color: number): void {
  k.cyl('concrete', x, 0, z, r, r, 3, C.concreteLight, k.seg(20), false);
  k.dome('plain', x, 3, z, r, color, k.seg(20), 0.65, 6);
}

/** colourful stack of recycled-material bales */
function bales(k: Kit, x: number, z: number, cols: number, rows: number, layers: number, palette: number[]): void {
  const s = 1.25;
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < cols - l; i++)
      for (let j = 0; j < rows; j++) {
        const col = palette[(i + j * 3 + l) % palette.length];
        k.box('plain', x + (i - (cols - l - 1) / 2) * s, l * s, z + (j - (rows - 1) / 2) * s, s * 0.96, s * 0.96, s * 0.96, col);
      }
}

/** landfill heap: terraced mound, partly capped with grass */
function landfillMound(k: Kit, x: number, z: number, rx: number, rz: number, h: number): void {
  const prof: P2[] = [[1, 0], [0.9, 0.18], [0.78, 0.3], [0.7, 0.5], [0.56, 0.62], [0.46, 0.82], [0.2, 0.96], [0, 1]];
  k.rev('dirt', x, 0, z, prof.map(([r, y]) => [r, y * h] as P2), 0x6d6352, k.seg(20), { sx: rx, sz: rz, crease: 80 });
  // capped (grassed) older cell on one side
  k.rev('grass', x, 0.05, z, prof.slice(0, 4).map(([r, y]) => [r * 1.005, y * h] as P2), mix(0x6f8a45, 0x8a8a52, 0.3), k.seg(20), { sx: rx, sz: rz, a0: Math.PI * 0.95, a1: Math.PI * 1.75, crease: 80 });
  // colourful rubbish specks on the working face
  if (!k.lo) {
    const r = k.ctx.rng;
    const cols = [0xd8d8d0, 0x3a6fd8, 0xd04040, 0xf2c230, 0x2f9a5a, 0x333333, 0xf4f4f4];
    for (let i = 0; i < 70; i++) {
      const a = r.range(-0.6, 2.4), t = r.range(0.1, 0.85);
      const px = x + Math.cos(a) * rx * (1 - t * 0.8), pz = z + Math.sin(a) * rz * (1 - t * 0.8);
      const py = h * Math.min(0.95, t * 1.1);
      k.box('plain', px, py - 0.2, pz, r.range(0.4, 1.2), 0.4, r.range(0.4, 1.2), r.pick(cols));
    }
  }
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  water_pump(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    k.lot('grass', lawnColor(k.ctx, 0.5), 0.2, 0.04);
    k.slab('paving', 0, D / 2 - 7, W - 2, 12, 0.08, 0xbdb7aa, 0.2);
    // pump house (brick, gable roof, arched windows)
    const hx = 0, hz = 3, hw = 10, hd = 8;
    k.box('wall_brick', hx, 0, hz, hw, 5.2, hd, mix(look.wallColor, C.brick, 0.6), { top: false });
    k.gableRoof('roof_tile', hx, 5.2, hz, hw, hd, 2.8, look.roofColor, { overhang: 0.5, wallMat: 'wall_brick', wallColor: mix(look.wallColor, C.brick, 0.6), ridgeAlongX: true });
    archWindow(k, hx - 2.8, 1.4, hz + hd / 2 + 0.05, 1.4, 2.8);
    archWindow(k, hx + 2.8, 1.4, hz + hd / 2 + 0.05, 1.4, 2.8);
    k.box('wood', hx, 0, hz + hd / 2 + 0.05, 1.6, 2.6, 0.1, 0x3f5f7a, { top: false });
    k.light(hx, 3.2, hz + hd / 2 + 0.5, C.lampWarm, 2.4, 'lamp');
    k.box('wall_brick', hx, 5.2, hz - 1, 1, 4.6, 1, C.brickDark, { top: 'concrete' });
    // intake pipes to the water at the back + intake screen house
    intakePipe(k, -2, hz - hd / 2, -D / 2, 0.55, 0x2f6fa8);
    intakePipe(k, 2, hz - hd / 2, -D / 2, 0.55, 0x2f6fa8);
    k.box('concrete', 0, -3, -D / 2 + 2, 8, 4.4, 3.2, C.concreteLight, { top: 'paving', topColor: 0xb8b4aa });
    k.box('metal', 0, 1.4, -D / 2 + 2, 7.4, 0.9, 0.3, 0x6a6e72);
    fence(k, [[-W / 2 + 0.8, -D / 2 + 4], [-W / 2 + 0.8, D / 2 - 1], [-3, D / 2 - 1]], 1.6, 0x4a5a4a, 2.6);
    fence(k, [[3, D / 2 - 1], [W / 2 - 0.8, D / 2 - 1], [W / 2 - 0.8, -D / 2 + 4]], 1.6, 0x4a5a4a, 2.6);
    bush(k, -5.5, D / 2 - 3, 0.9);
    bush(k, 5.5, D / 2 - 3, 0.9);
    return 8.5;
  },

  water_tower(k) {
    const W = k.W;
    const look = civicLook(k.ctx);
    k.lot('grass', lawnColor(k.ctx, 0.45), 0.2, 0.04);
    k.slab('paving', 0, 0, 9, 9, 0.08, 0xb8b2a6, 0.2);
    const paint = k.ctx.rng.pick([0xe9eef2, 0x9cc3d6, look.accent, 0xdfe6d8]);
    const kind = k.ctx.rng.next() < 0.5 ? 'legs' : 'spheroid';
    let top: number;
    if (kind === 'legs') {
      // classic steel tank on 6 braced legs
      const legs = 6, R = 4.2, Hl = 18;
      for (let i = 0; i < legs; i++) {
        const a = (i / legs) * Math.PI * 2;
        k.pipe('metal', [Math.cos(a) * R * 1.12, 0, Math.sin(a) * R * 1.12], [Math.cos(a) * R * 0.92, Hl, Math.sin(a) * R * 0.92], 0.28, 0x8a9aa6, 6);
        k.box('concrete', Math.cos(a) * R * 1.12, 0, Math.sin(a) * R * 1.12, 1.2, 0.6, 1.2, C.concrete);
      }
      for (const y of [6, 12]) {
        const rr = R * (1.12 - (y / Hl) * 0.2);
        for (let i = 0; i < legs; i++) {
          const a0 = (i / legs) * Math.PI * 2, a1 = ((i + 1) / legs) * Math.PI * 2;
          k.beam('metal', [Math.cos(a0) * rr, y, Math.sin(a0) * rr], [Math.cos(a1) * rr, y, Math.sin(a1) * rr], 0.14, 0.14, 0x8a9aa6);
          if (!k.lo) k.beam('metal', [Math.cos(a0) * rr, y - 6 + 0.2, Math.sin(a0) * rr], [Math.cos(a1) * rr, y, Math.sin(a1) * rr], 0.06, 0.06, 0x6a7a86);
        }
      }
      k.cyl('metal', 0, 0, 0, 0.7, 0.7, Hl, 0x8a9aa6, 8, false);
      k.rev('metal', 0, Hl - 2.2, 0, [[0.7, 0], [3.6, 1.6], [R * 1.05, 2.4], [R * 1.05, 8], [R * 0.5, 9.6], [0.3, 10.2]], paint, k.seg(22), { crease: 35 });
      k.torus('metal', 0, Hl + 0.4, 0, R * 1.18, 0.07, 0x555555, k.seg(22), 3);
      k.ring('metal', 0, Hl + 0.2, 0, R * 1.05, R * 1.22, 0x6a6e72, k.seg(22));
      top = Hl + 10.4;
    } else {
      // concrete pedestal + fluted spheroid tank ("golf ball on a tee")
      k.rev('concrete', 0, 0, 0, [[3.2, 0], [2.4, 1.5], [2.1, 14], [2.4, 16]], 0xd9d6cf, k.seg(18), { crease: 40 });
      k.rev('metal', 0, 16, 0, [[2.4, 0], [5.5, 2.8], [7, 5.5], [6.4, 8.4], [3.6, 10.4], [0.4, 11]], paint, k.seg(24), { crease: 80 });
      top = 27.2;
    }
    k.cyl('metal', 0, top - 0.2, 0, 0.35, 0.3, 1, 0x666666, 6);
    k.light(0, top + 1, 0, C.beaconRed, 2.4, 'beacon', true);
    // logo band / floodlights at night
    k.light(3, 1, 3, 0xdfe8ff, 3, 'flood');
    k.box('wall_concrete', W / 2 - 3.4, 0, 3.4, 3.2, 2.6, 3.2, C.concreteLight, { top: 'roof_flat' });
    return top + 1.2;
  },

  water_pump_large(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.5), 0.2, 0.04);
    k.slab('paving', 0, D / 2 - 8, W - 2, 14, 0.08, 0xbdb7aa, 0.2);
    // Victorian-style pumping hall: brick, gable roof, arched windows, lantern
    const hz = 4, hw = 22, hd = 14, hh = 9;
    const brick = mix(C.brick, 0xb86a4a, 0.35);
    k.box('wall_stone', 0, 0, hz, hw + 0.6, 1, hd + 0.6, 0xbdb09a, { top: 'concrete' });
    k.box('wall_brick', 0, 1, hz, hw, hh - 1, hd, brick, { top: false });
    k.gableRoof('roof_tile', 0, hh, hz, hw, hd, 4.2, 0x5a5f66, { overhang: 0.6, wallMat: 'wall_brick', wallColor: brick, ridgeAlongX: true });
    k.box('glass', 0, hh + 4.2, hz, hw * 0.55, 1.2, 1.6, 0x8fb0c0, { top: 'roof_metal', topColor: 0x5a5f66 });
    for (let i = 0; i < 5; i++) archWindow(k, -8 + i * 4, 2.2, hz + hd / 2 + 0.05, 1.8, 4.8, 0xe8dcc4);
    for (const s of [-1, 1])
      k.at(s * (hw / 2 + 0.05), 0, hz, s * Math.PI / 2, () => {
        for (let i = 0; i < 3; i++) archWindow(k, -4 + i * 4, 2.2, 0, 1.8, 4.8, 0xe8dcc4);
      });
    k.box('plain', 0, 7.2, hz + hd / 2 + 0.1, 8, 0.9, 0.2, 0xe8dcc4, { top: false });
    // tall brick chimney (heritage steam engine)
    k.cyl('wall_brick', hw / 2 + 3, 0, hz - 4, 1.4, 1.0, 20, brick, 10);
    k.cyl('plain', hw / 2 + 3, 19, hz - 4, 1.3, 1.3, 1, 0x3a3030, 10);
    // three intake mains to an intake crib at the back
    for (const x of [-6, 0, 6]) intakePipe(k, x, hz - hd / 2, -D / 2, 0.8, 0x2f5f98);
    k.box('concrete', 0, -3, -D / 2 + 2.2, 20, 4.6, 3.6, C.concreteLight, { top: 'paving', topColor: 0xb8b4aa });
    k.box('metal', 0, 1.6, -D / 2 + 2.2, 18.6, 1, 0.3, 0x5a6168);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 2], [W / 2 - 2, D / 2 - 2]], 10, 4.4, 'classic', 0);
    return 20;
  },

  water_treatment(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.5), 0.2, 0.04);
    k.slab('paving', 0, 0, W - 6, D - 6, 0.07, 0xc4bfb3, 0.2);
    // two clarifiers at the back
    clarifier(k, -15, -16, 9, 0x4f8f92, 0.09);
    clarifier(k, 6, -16, 9, 0x4f8f92, 0.11);
    // flocculation / filter basins
    basin(k, -12, 4, 26, 12, 0x5d9aa0, 3);
    basin(k, 18, -6, 16, 22, 0x6aa7a8, 2);
    // filter & chemical building with blue trim, lab/admin by the road
    const look = civicLook(k.ctx);
    k.box('wall_concrete', 16, 0, 14, 22, 8, 10, 0xe8e6e0, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('plain', 16, 7, 19.05, 22, 1, 0.1, 0x2f7fc0, { top: false });
    rollDoors(k, 22, 19, 5, 1, 4.2, 0xb8bcc0);
    k.box(look.wall, -12, 0, 17, 18, 7, 8, look.wallColor, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.entrance(-12, 21, 3, 2.8);
    tank(k, 27, 6, 2.6, 7, 0xe8e8e2, 'dome');
    tank(k, 27, 0, 2.6, 7, 0xe8e8e2, 'dome');
    pipeRack(k, [-6, -8], [16, -8], 2.6, 2, [0x2f6fa8, 0x4f8f4a]);
    fence(k, [[-W / 2 + 1, -D / 2 + 1], [W / 2 - 1, -D / 2 + 1], [W / 2 - 1, D / 2 - 1]], 2, 0x4a5a4a, 3);
    return 12;
  },

  desalination_plant(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xc9c3b6, 0.2, 0.04);
    quay(k, 0, -D / 2 + 6, W - 2, 6, 0.3);
    // main reverse-osmosis hall (white, blue stripe, sawtooth skylights)
    hall(k, -6, 3, 40, 20, 12, { roof: 'saw', color: 0xf0f0ec, roofColor: 0xb8c0c8, wall: 'wall_industrial' });
    k.box('plain', -6, 9.4, 13.06, 40, 1.4, 0.1, 0x1f7fc8, { top: false });
    k.sign(-6, 5.5, 13.1, 12, 1.6, 0x2a9fe8, 0x7fd0ff);
    // pressure-vessel racks under a canopy
    k.box('metal', 20, 5.5, 3, 16, 0.3, 18, 0xd8dcdf, { bottom: true });
    for (const [x, z] of [[13, -5], [27, -5], [13, 11], [27, 11]]) k.box('metal', x, 0, z, 0.4, 5.5, 0.4, 0x8a8e92);
    if (!k.lo) for (let r = 0; r < 4; r++) for (let l = 0; l < 3; l++) {
      k.push(new THREE.Matrix4().makeTranslation(20, 1 + l * 1.3, -3 + r * 4).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      k.cylinder('plain', 0, -6, 0, 0.45, 0.45, 12, 0xeeeeea, 8, { top: true, bottom: true });
      k.pop();
    }
    // product water tanks + intake/brine pipes to the sea
    tank(k, -24, -10, 4.6, 10, 0xe6ebee, 'dome');
    tank(k, -13, -10, 4.6, 10, 0xe6ebee, 'dome');
    k.pipe('metal', [4, 1, -8], [4, 1, -D / 2 + 4], 0.9, 0x2f6fa8, k.seg(10));
    k.pipe('metal', [4, 1, -D / 2 + 4], [4, -3, -D / 2 - 1], 0.9, 0x2f6fa8, k.seg(10));
    k.pipe('metal', [10, 0.8, -8], [10, 0.8, -D / 2 + 4], 0.6, 0x8a8e92, 8);
    k.pipe('metal', [10, 0.8, -D / 2 + 4], [10, -3, -D / 2 - 1], 0.6, 0x8a8e92, 8);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 2], [W / 2 - 2, D / 2 - 2]], 14, 6, 'modern', 0);
    return 16;
  },

  sewage_outlet(k) {
    const W = k.W, D = k.D;
    k.lot('grass', mix(lawnColor(k.ctx, 0.3), dryGround(k.ctx), 0.3), 0.2, 0.04);
    // headwall at the back with two big outfall pipes discharging into the water
    k.box('concrete', 0, -4, -D / 2 + 4, W - 2, 5.2, 2.4, 0x8f8b82, { top: 'concrete', topColor: 0xa29e94 });
    for (const s of [-1, 1]) k.box('concrete', s * (W / 2 - 1.5), -4, -D / 2 + 7, 1, 5.2, 6, 0x8f8b82);
    for (const x of [-3, 3]) {
      k.pipe('concrete', [x, 0.2, -D / 2 + 4], [x, 0.2, -D / 2 - 0.5], 1.2, 0x7a766e, k.seg(12), true);
      k.pipe('metal', [x, 1, 6], [x, 0.4, -D / 2 + 5], 0.9, 0x5a5048, k.seg(10));
    }
    k.blob('water', 0, -D / 2 - 1, 6, 3, -0.45, 0x6a5a3a, 12, 0.3, 3);
    // valve chamber + fence + warning sign
    k.box('wall_concrete', 0, 0, 8, 7, 3.4, 5, 0xbdb9b0, { top: 'roof_flat' });
    k.box('metal', 0, 0, 10.55, 1.6, 2.4, 0.1, 0x3a4450, { top: false });
    k.box('plain', 3.9, 1.2, 10, 0.1, 1, 1, C.yellow, { top: false });
    fence(k, [[-W / 2 + 0.8, D / 2 - 0.8], [-W / 2 + 0.8, -D / 2 + 5], [W / 2 - 0.8, -D / 2 + 5], [W / 2 - 0.8, D / 2 - 0.8]], 1.8, 0x5d6166, 2.6);
    k.emitter('steam', 0, 0.5, -D / 2 - 1, 0.25);
    return 3.8;
  },

  sewage_treatment(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.4), 0.2, 0.04);
    k.slab('paving', 0, -2, W - 6, D - 10, 0.07, 0xbfbab0, 0.2);
    clarifier(k, -18, -18, 8, 0x6f7a5a, 0.1);
    clarifier(k, -18, 2, 8, 0x6f7a5a, 0.08);
    basin(k, 6, -16, 22, 18, 0x6d7f5e, 3, true);
    // egg-shaped digesters + gas flare
    digesterEgg(k, 14, 8, 22);
    digesterEgg(k, 24, 8, 22);
    k.cyl('metal', 27, 0, -4, 0.3, 0.25, 9, 0x6a6e72, 6);
    k.light(27, 9.4, -4, 0xffa040, 2.6, 'neon', true);
    // control building, sludge dewatering shed
    k.box('wall_concrete', -4, 0, 16, 16, 6, 9, 0xe0ddd5, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.entrance(-4, 20.5, 2.6, 2.6);
    hall(k, -W / 2 + 10, D / 2 - 6, 14, 8, 6, { roof: 'shed', color: 0xb8bcc0, doors: 1 });
    pipeRack(k, [-10, -8], [2, -8], 2.2, 2, [0x6a5040, 0x8a8e92]);
    treeGrove(k, 0, D / 2 - 2.5, W - 6, 2, 6, 'shade');
    return 22;
  },

  sewage_treatment_adv(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.04);
    // membrane bioreactor hall with green roof + solar
    k.box('wall_concrete', -8, 0, 2, 34, 10, 20, 0xe6e4de, { top: 'grass', topColor: lawnColor(k.ctx, 0.7) });
    k.box('wall_glass', -8, 0.1, 12.05, 30, 4, 0.1, 0xb8d0dc, { top: false });
    k.parapet(-8, 10, 2, 34, 20, 0.6, 0xd8d6d0);
    for (let i = 0; i < 4; i++) solarRow(k, -8, -5 + i * 4.4, 28, 2.4, 0.4, 10.4);
    // stainless digester eggs with a glass link bridge
    digesterEgg(k, 18, -10, 24, 0xdfe4e8);
    digesterEgg(k, 26, 0, 24, 0xdfe4e8);
    k.box('glass', 22, 14, -5, 2, 2.2, 10, 0x9fc0d0, { top: 'metal', topColor: 0xd8dcdf });
    // covered (odour-free) basins with walkway + UV channel
    for (let i = 0; i < 3; i++) {
      k.box('concrete', -20 + i * 10, 0, -D / 2 + 6, 8, 1.6, 8, C.concreteLight, { top: false });
      k.barrel('metal', -20 + i * 10, 1.6, -D / 2 + 6, 8, 8, 2.2, 0xdfe4e8, k.seg(10), false);
    }
    k.flat('water', 12, D / 2 - 6, 22, 3, 0.4, 0x4fb0c0);
    k.box('concrete', 12, 0, D / 2 - 6, 23, 0.35, 4, C.concreteLight, { top: false });
    k.sign(-8, 6.4, 12.2, 8, 1.2, 0x3fbf7a, 0x7fffb0);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 4.2, 'modern', 0);
    return 24.5;
  },

  landfill(k) {
    const W = k.W, D = k.D;
    k.lot('dirt', mix(dryGround(k.ctx), 0x6f6452, 0.4), 0.2, 0.04);
    landfillMound(k, -2, -4, W * 0.36, D * 0.34, 8);
    // haul road, compactor, trucks
    k.ribbon('dirt', [[W / 2 - 6, D / 2], [W / 2 - 6, 6], [8, -2], [2, -6]], 4, 0.09, 0x8a7a60);
    k.at(3, 7.2, -6, 0.4, () => {
      k.box('plain', 0, 0.6, 0, 4.6, 1.6, 2.6, C.yellow);
      k.box('glass', -0.6, 2.2, 0, 1.8, 1.3, 1.8, 0x2c3a46, { top: 'plain', topColor: C.yellow });
      k.box('metal', 2.8, 0, 0, 0.5, 1.4, 3, 0x666666);
    });
    garbageTruck(k, W / 2 - 6, 10, Math.PI / 2);
    // weighbridge office + methane vents + fence
    k.box('wall_industrial', -W / 2 + 6, 0, D / 2 - 5, 7, 3, 4, 0xd8d4c8, { top: 'roof_flat' });
    k.slab('concrete', -W / 2 + 14, D / 2 - 5, 3.5, 9, 0.2, 0x8a8a86, 0.1);
    for (const [x, z] of [[-10, -10], [2, -14], [-6, 2]] as P2[]) {
      k.cyl('metal', x, 0, z, 0.2, 0.2, 7 + 3, 0x6a6e72, 6);
    }
    fence(k, [[-W / 2 + 0.8, D / 2 - 0.8], [-W / 2 + 0.8, -D / 2 + 0.8], [W / 2 - 0.8, -D / 2 + 0.8], [W / 2 - 0.8, D / 2 - 10]], 2.4, 0x5d6166, 3);
    k.emitter('dust', 3, 8, -6, 0.3);
    return 8;
  },

  incinerator(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5b5d60, 0.2, 0.04);
    // bunker + furnace hall, flue gas treatment, stack
    k.box('wall_industrial', -4, 0, -2, 26, 22, 18, 0xb4b8b4, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('wall_industrial', -4, 22, -4, 14, 6, 10, 0x9aa0a6, { top: 'roof_flat' });
    k.box('plain', -4, 17, 7.05, 26, 2.2, 0.1, 0x3f8a4a, { top: false });
    k.box('wall_industrial', 14, 0, -8, 10, 16, 12, 0x8f969c, { top: 'roof_flat' });
    chimney(k, 16, -D / 2 + 6, 50, 2.2, 1.6, { emit: 'smoke', rate: 0.7, color: 0xc8c4bc });
    // tipping hall with ramp at the front
    k.box('wall_industrial', -4, 0, 12, 22, 8, 8, 0xc8ccc8, { top: 'roof_flat' });
    rollDoors(k, -4, 16, 16, 3, 5, 0x3f8a4a);
    garbageTruck(k, 10, 16, Math.PI);
    pile(k, 16, 10, 4, 3, 2.2, 0x5a4f44);
    return 50;
  },

  waste_transfer(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55585b, 0.2, 0.04);
    // big open-fronted transfer shed
    k.box('wall_industrial', 0, 0, -4, W - 4, 10, D * 0.55, 0xa9b0a4, { top: false, sides: { s: false } });
    k.gableRoof('roof_metal', 0, 10, -4, W - 4, D * 0.55, 2, 0x3f7a4a, { wallMat: 'wall_industrial', wallColor: 0xa9b0a4, ridgeAlongX: true });
    k.box('concrete', 0, 0, -4, W - 6, 0.1, D * 0.55 - 1, 0x6a645a, { top: 'dirt', topColor: 0x5a5046 });
    pile(k, -5, -8, 5, 3.5, 3, 0x6d6352);
    k.box('metal', 4, 0, -7, 4, 3, 4, C.yellow);
    // roll-off containers & trucks in the yard
    for (let i = 0; i < 3; i++) container(k, -10 + i * 3, 0, D / 2 - 6, Math.PI / 2, [0x3f8a4a, 0x2f5f9e, 0x7a6a4a][i], 6);
    garbageTruck(k, 7, D / 2 - 5, Math.PI);
    k.light(0, 9, D * 0.05, C.lampCool, 3, 'lamp');
    return 12;
  },

  recycling_center(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5a5d60, 0.2, 0.04);
    // sorting hall with sawtooth roof and green branding
    hall(k, -4, -6, 32, 22, 11, { roof: 'saw', color: 0xe4e6e0, roofColor: 0x3f8a4a });
    k.box('plain', -4, 8.6, 5.06, 32, 1.4, 0.1, 0x3f9a4a, { top: false });
    k.sign(-4, 5.2, 5.1, 3, 3, 0x3fbf5a, 0x7fff9a);
    rollDoors(k, -4, 5, 20, 3, 5, 0xc8ccc8);
    // bale yard + containers + conveyor to the baler
    bales(k, 17, -12, 4, 3, 3, [0x3f7fd0, 0x2fa05a, 0xe8e8e0, 0x8a6a4a]);
    bales(k, 17, -2, 4, 2, 2, [0xd8a030, 0xd04040, 0xe8e8e0]);
    conveyor(k, [12, 0.5, 8], [4, 9, -2], 1.6, 0x5a8a4a);
    for (let i = 0; i < 4; i++) container(k, -18 + i * 3, 0, 16, Math.PI / 2, [0x3f8a4a, 0x2f5f9e, 0xd8a030, 0x8a8f96][i], 6);
    garbageTruck(k, 12, 15, Math.PI);
    return 16;
  },

  eco_waste(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.04);
    k.slab('paving', 4, 4, W - 16, D - 16, 0.07, 0xc8c4ba, 0.2);
    // timber-clad process hall with sloping green roof + solar
    k.box('wall_wood', -6, 0, -6, 34, 12, 18, 0xa8845a, { top: false });
    k.quad('grass', { x: -23, y: 12, z: 3 }, { x: 11, y: 12, z: 3 }, { x: 11, y: 16, z: -15 }, { x: -23, y: 16, z: -15 }, [[-23, 3], [11, 3], [11, -15], [-23, -15]], lawnColor(k.ctx, 0.8), { x: 0, y: 1, z: 0.2 });
    for (const s of [-1, 1]) k.tri('wall_wood', { x: -6 + s * 17, y: 12, z: 3 }, { x: -6 + s * 17, y: 16, z: -15 }, { x: -6 + s * 17, y: 12, z: -15 }, [0, 12], [18, 16], [18, 12], 0xa8845a, { x: s, y: 0, z: 0 });
    k.wall('wall_wood', 11, -15, -23, -15, 12, 16, 0xa8845a);
    k.box('wall_glass', -6, 0.1, 3.05, 30, 8, 0.1, 0xbcd8e0, { top: false });
    // anaerobic digestion domes + biogas holder
    membraneDome(k, 20, -12, 6.5, 0x5f9a4a);
    membraneDome(k, 20, 3, 6.5, 0x5f9a4a);
    membraneDome(k, -W / 2 + 8, 12, 5, 0xe8e8e2);
    windTurbine(k, W / 2 - 6, D / 2 - 6, { hub: 18, blade: 8, phase: 1, speed: 1.6 });
    k.sign(-6, 9, 3.2, 10, 1.3, 0x5fcf6a, 0x9fffb0);
    treeGrove(k, -12, D / 2 - 3, 20, 2, 5, 'shade');
    return 26;
  },
};


export const UTILITY_MODELS = models(M);
