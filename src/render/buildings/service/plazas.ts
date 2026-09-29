// Plazas and decorative squares.
import { Kit, type P2, type V3 } from './kit';
import { C, shade, mix, lawnColor } from './colors';
import { models } from './define';
import { bench, bush, crowd, flowerBed, hedge, lampPost, person, tree, themeTree, trashBin, umbrella } from './props';
import { lampsAlong, statueFigure } from './arch';

/** paved square with a border band */
function square(k: Kit, color: number, border: number): void {
  k.lot('paving', border, 0.2, 0.05);
  k.slab('paving', 0, 0, k.W - 2.4, k.D - 2.4, 0.08, color, 0.1);
}

/** tiered fountain with emitters and night uplights */
export function fountain(k: Kit, x: number, z: number, r: number, stone: number): number {
  const seg = k.seg(24);
  k.cyl('concrete', x, 0, z, r, r, 0.7, stone, seg, false);
  k.ring('concrete', x, 0.7, z, r - 0.5, r, shade(stone, 1.05), seg);
  k.disc('water', x, 0.55, z, r - 0.5, 0x4fa8b8, seg);
  k.cyl('concrete', x, 0.5, z, r * 0.14, r * 0.1, 1.6, stone, 10);
  k.rev('concrete', x, 2.0, z, [[0.2, 0], [r * 0.45, 0.35], [r * 0.48, 0.55]], stone, 16, { crease: 60 });
  k.disc('water', x, 2.5, z, r * 0.44, 0x6fc0d0, 16);
  k.cyl('concrete', x, 2.5, z, r * 0.07, r * 0.05, 1.3, stone, 8);
  k.rev('concrete', x, 3.7, z, [[0.1, 0], [r * 0.22, 0.25], [r * 0.24, 0.4]], stone, 12, { crease: 60 });
  k.ball('concrete', x, 4.25, z, 0.25, stone, 8, 5);
  k.emitter('fountain', x, 4.4, z, 1);
  k.emitter('fountain', x + r * 0.3, 2.6, z, 0.5);
  k.emitter('fountain', x - r * 0.3, 2.6, z, 0.5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.light(x + Math.cos(a) * (r - 0.8), 0.7, z + Math.sin(a) * (r - 0.8), 0x9fd8ff, 2.2, 'neon');
  }
  return 4.6;
}

/** bandstand / gazebo: octagonal platform, slim columns, ogee roof */
export function pavilion(k: Kit, x: number, z: number, r: number, h: number, base: number, color: number, roof: number, rails = true): number {
  const n = 8;
  k.cyl('wall_stone', x, 0, z, r + 0.3, r + 0.3, base, shade(color, 0.85), n);
  if (base > 0.5) k.stairs(x, z + r + 1.1, 2.4, base, shade(color, 0.85), 0.17, 0.32);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    k.cyl('plain', cx, base, cz, 0.14, 0.12, h, color, 6, false);
    if (rails && !k.lo && i !== 1) {
      const b = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
      k.beam('plain', [cx, base + 0.9, cz], [x + Math.cos(b) * r, base + 0.9, z + Math.sin(b) * r], 0.08, 0.08, color);
    }
  }
  const y = base + h;
  k.rev('roof_metal', x, y, z, [[r + 0.7, 0], [r * 0.8, 0.5], [r * 0.45, 1.3], [r * 0.18, 2.3], [0.1, 2.9]], roof, n, { bottom: true, crease: 25 });
  k.ball('metal', x, y + 3.0, z, 0.2, C.gold, 6, 4);
  k.light(x, y - 0.2, z, C.lampWarm, r * 1.3, 'lamp');
  return y + 3.2;
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  statue(k) {
    square(k, 0xd8d0c0, 0xbdb4a2);
    k.disc('grass', 0, 0.1, 0, 5.4, lawnColor(k.ctx, 0.7), 20);
    // stepped granite plinth + bronze figure (rider or orator)
    k.box('wall_stone', 0, 0, 0, 5, 0.5, 5, 0x9a968f, { top: 'concrete' });
    k.box('wall_stone', 0, 0.5, 0, 3.6, 0.5, 3.6, 0xa8a49c, { top: 'concrete' });
    k.box('wall_stone', 0, 1.0, 0, 2.4, 2.4, 2.4, 0xb8b4ac, { top: 'concrete' });
    k.box('plain', 0, 3.4, 0, 2.8, 0.3, 2.8, 0xc8c4bc);
    k.box('metal', 0, 1.8, 1.22, 1.6, 0.6, 0.04, C.bronze, { top: false });
    const rider = k.ctx.rng.chance(0.5);
    const top = statueFigure(k, 0, 3.7, 0, rider ? 1.9 : 2.6, mix(C.copper, C.bronze, rider ? 0.2 : 0.6), 0.2, rider ? 'rider' : 'raise');
    for (const [x, z] of [[-5.5, 5.5], [5.5, 5.5], [-5.5, -5.5], [5.5, -5.5]] as P2[]) lampPost(k, x, z, 3.8, 0x2a2e33, C.lampWarm, 'classic');
    for (const [x, z] of [[-3, 3], [3, 3], [-3, -3], [3, -3]] as P2[]) k.light(x * 0.8, 0.3, z * 0.8, 0xfff0d0, 2.2, 'flood');
    bench(k, 0, 6.6, Math.PI);
    return top;
  },

  gazebo(k) {
    k.lot('grass', lawnColor(k.ctx, 0.65), 0.2, 0.04);
    k.ribbon('paving', [[0, k.D / 2], [0, 3.6]], 1.6, 0.08, 0xd8ccb0);
    const wood = k.ctx.rng.pick([0xf4f2ec, 0xe8dcc4, 0xdfe8e0]);
    const top = pavilion(k, 0, -0.5, 3.2, 2.8, 0.45, wood, k.ctx.rng.pick([0x4a6a5a, 0x8a3a2a, 0x3a4a5a]));
    bench(k, -1.4, -0.5, Math.PI / 2);
    for (const [x, z] of [[-5.5, -5], [5.5, -5.5]] as P2[]) bush(k, x, z, 1, 0x4a7a36, x);
    flowerBed(k, -5, 5, 3, 1.6);
    flowerBed(k, 5, 5, 3, 1.6);
    tree(k, themeTree(k.ctx, 'shade'), 5.5, -5.5, 0.55);
    return top;
  },

  flower_garden(k) {
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.04);
    k.ribbon('paving', [[-8, 0], [8, 0]], 1.4, 0.08, 0xd8ccb0);
    k.ribbon('paving', [[0, -8], [0, 8]], 1.4, 0.08, 0xd8ccb0);
    const pals = [[0xe0414f, 0xf5f0f0], [0xf2c230, 0xf07a3a], [0xb05cc8, 0xf08fb0], [0x5a7ad8, 0xf5f0f0]];
    [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(([x, z], i) => {
      flowerBed(k, x, z, 5.4, 5.4, pals[i], 5);
      hedge(k, x, z + (z > 0 ? 2.9 : -2.9), 5.8, 0.4, 0.5);
    });
    k.cyl('concrete', 0, 0, 0, 0.9, 0.9, 0.5, 0xd8d2c4, 12);
    k.rev('concrete', 0, 0.5, 0, [[0.4, 0], [0.7, 0.6], [0.8, 0.9]], 0xd8d2c4, 12, { crease: 60 });
    foliage(k, 0, 1.4, 0);
    for (const [x, z] of [[-7, 7], [7, -7]] as P2[]) k.at(x, 0, z, Math.atan2(-x, -z), () => bench(k, 0, 0, 0));
    return 3;
  },

  fountain_plaza(k) {
    square(k, 0xd8d0c0, 0xbdb4a2);
    // radial paving pattern
    k.disc('paving', 0, 0.1, 0, 11, 0xcfc4b0, k.seg(28));
    k.ring('paving', 0, 0.11, 0, 8.4, 9, 0xb8ad98, k.seg(28));
    const top = fountain(k, 0, 0, 5.2, 0xe6dcc8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 12, z = Math.sin(a) * 12;
      tree(k, themeTree(k.ctx, 'formal'), x, z, 0.75, a, i);
      k.cyl('concrete', x, 0, z, 1.4, 1.4, 0.45, 0xb8ad98, 10);
      bench(k, Math.cos(a) * 8, Math.sin(a) * 8, -a - Math.PI / 2);
      lampPost(k, Math.cos(a + Math.PI / 4) * 10.5, Math.sin(a + Math.PI / 4) * 10.5, 4.2);
    }
    crowd(k, 0, 0, 26, 26, 10);
    return top;
  },

  tree_plaza(k) {
    square(k, 0xd4cbb8, 0xb8ae9a);
    // grid of shade trees in raised planters with seating
    const sp = 9;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        const x = i * sp, z = j * sp;
        k.box('concrete', x, 0, z, 3.4, 0.55, 3.4, 0xc8bea8, { top: 'grass', topColor: lawnColor(k.ctx, 0.6) });
        tree(k, themeTree(k.ctx, 'shade'), x, z, 0.8, i * 3 + j, Math.abs(i + j));
        if (!k.lo) k.box('wood', x, 0.55, z + 1.9, 3.4, 0.08, 0.5, C.woodLight);
      }
    k.disc('paving', 0, 0.1, 0, 3.6, 0xb8ae9a, 16);
    k.cyl('concrete', 0, 0, 0, 0.6, 0.6, 0.6, 0x9a9488, 10);
    k.emitter('fountain', 0, 0.3, 0, 0.5);
    for (let i = 0; i < 4; i++) umbrella(k, -3 + (i % 2) * 6, i < 2 ? 4.5 : -4.5, 0xf4f0e6, 1.2, 2.3);
    for (const [x, z] of [[-13, 13], [13, 13], [-13, -13], [13, -13]] as P2[]) lampPost(k, x, z, 4.2, 0x2a2e33, C.lampWarm, 'modern');
    trashBin(k, 4.5, 0);
    crowd(k, 0, 0, 24, 24, 10);
    return 10;
  },

  bandstand(k) {
    k.lot('grass', lawnColor(k.ctx, 0.65), 0.2, 0.04);
    k.disc('paving', 0, 0.08, -2, 10, 0xd8ccb0, k.seg(24));
    const top = pavilion(k, 0, -3, 4.8, 3.4, 1.2, 0xf4f2ec, 0x2f5f4a);
    // musicians + audience chairs + bunting
    const r = k.ctx.rng;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI;
      k.pushTRS(0, 1.2, 0, 0);
      person(k, Math.cos(a) * 2.5, -3 + Math.sin(a) * 2.5 * -1, r.pick([0x1e2a4a, 0x8a1a1a]), -a);
      k.pop();
    }
    for (let row = 0; row < 3; row++) for (let c = 0; c < 6; c++) k.box('plain', -5 + c * 2, 0.1, 7 + row * 1.6, 0.5, 0.45, 0.5, 0x2f5f4a);
    if (!k.lo) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ax = Math.cos(a) * 5.4, az = -3 + Math.sin(a) * 5.4;
      k.cable('plain', [ax, 4.4, az], [Math.cos(a + 0.8) * 5.4, 4.4, -3 + Math.sin(a + 0.8) * 5.4], 0.4, 0.03, 0xf4f4f4, 3);
    }
    crowd(k, 0, 9, 14, 5, 10);
    for (const [x, z] of [[-12, 10], [12, 10]] as P2[]) lampPost(k, x, z, 4);
    tree(k, themeTree(k.ctx, 'shade'), -11, -11, 0.85);
    tree(k, themeTree(k.ctx, 'shade'), 11, -11, 0.8, 1, 1);
    return top;
  },

  obelisk(k) {
    square(k, 0xd8d0c0, 0xbdb4a2);
    k.box('wall_stone', 0, 0, 0, 6, 0.6, 6, 0x8f8a80, { top: 'concrete' });
    k.box('wall_stone', 0, 0.6, 0, 4.4, 0.6, 4.4, 0x9a958a, { top: 'concrete' });
    k.box('wall_stone', 0, 1.2, 0, 3, 2.2, 3, 0xa8a398, { top: 'concrete' });
    // tapering granite shaft with gilded pyramidion
    const h = 26;
    k.rev('concrete', 0, 3.4, 0, [[1.1 * Math.SQRT2, 0], [0.72 * Math.SQRT2, h]], 0xd8d0bc, 4, { crease: 10, a0: Math.PI / 4, a1: Math.PI / 4 + Math.PI * 2 });
    k.pushTRS(0, 3.4 + h, 0, Math.PI / 4);
    k.rev('metal', 0, 0, 0, [[0.72 * Math.SQRT2, 0], [0, 2.2]], C.gold, 4, { crease: 10, a0: 0, a1: Math.PI * 2 });
    k.pop();
    for (const [x, z] of [[-4, 4], [4, 4], [-4, -4], [4, -4]] as P2[]) {
      k.light(x * 0.8, 0.4, z * 0.8, 0xfff0d0, 3, 'flood');
      k.cyl('metal', x * 1.4, 0, z * 1.4, 0.18, 0.18, 1, 0x2a2e33, 6);
    }
    k.light(0, 3.4 + h + 2.4, 0, C.beaconRed, 2, 'beacon', true);
    for (const x of [-6, 6]) bench(k, x, 6.5, Math.PI);
    return 3.4 + h + 2.2;
  },

  sculpture_garden(k) {
    lawnSquare(k);
    const r = k.ctx.rng;
    // abstract sculptures on plinths
    k.box('concrete', -7, 0, -7, 3, 0.6, 3, 0xd8d2c4);
    k.torus('metal', -7, 3.2, -7, 2, 0.45, 0xc8322b, 20, 8);
    k.box('concrete', 7, 0, -6, 2.6, 0.6, 2.6, 0xd8d2c4);
    for (let i = 0; i < 5; i++) k.rbox('metal', 7, 0.6 + i * 1.1, -6, 2.2 - i * 0.3, 1.0, 0.5, i * 0.5, [0xf2c230, 0x2f6fd0, 0xd8d8d8][i % 3]);
    k.box('concrete', -6, 0, 7, 2, 0.5, 2, 0xd8d2c4);
    k.ball('metal', -6, 2.2, 7, 1.6, 0xd8dce0, 16, 12);
    k.box('concrete', 7, 0, 7, 3.4, 0.4, 1.4, 0xd8d2c4);
    statueFigure(k, 7, 0.4, 7, 1.3, 0xf2f0ea, Math.PI, 'stand');
    const arch: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      arch.push([Math.cos(a) * 3, Math.sin(a) * 5, 0]);
    }
    k.polyPipe('metal', arch, 0.3, 0x5e9e89, 6);
    // paths, hedges, benches
    k.ribbon('paving', [[0, 16], [0, 4], [-4, 0], [0, -4], [4, 0], [0, 4]], 1.8, 0.1, 0xd8d2c4);
    hedge(k, -12, 0, 1, 20, 1.2);
    hedge(k, 12, 0, 1, 20, 1.2);
    for (const [x, z] of [[-9, 12], [9, 12]] as P2[]) bench(k, x, z, Math.PI);
    for (let i = 0; i < 4; i++) k.light(r.range(-8, 8), 0.3, r.range(-8, 8), 0xfff0d0, 2.4, 'flood');
    lampsAlong(k, [[-14, -14], [14, -14]], 9, 3.8, 'modern', 0);
    return 8;
  },
};

function lawnSquare(k: Kit): void {
  k.lot('paving', 0xbdb4a2, 0.2, 0.05);
  k.slab('grass', 0, 0, k.W - 2.4, k.D - 2.4, 0.08, lawnColor(k.ctx, 0.7), 0.1);
}

/** small topiary ball on an urn */
function foliage(k: Kit, x: number, y: number, z: number): void {
  k.ball('foliage', x, y + 0.5, z, 0.7, 0x3f6b33, 10, 7);
}

export const PLAZA_MODELS = models(M);
