// Parks, sports, attractions, nature and waterfront recreation.
import * as THREE from 'three';
import { Kit, blobPts, smoothPath, type P2, type V3 } from './kit';
import { C, shade, mix, jitter, lawnColor, dryGround } from './colors';
import { models } from './define';
import { animal, bench, boat, bush, car, crowd, fence, flowerBed, foliageBlob, hedge, lampPost, parkedCars, person, picnicTable, playEquipment, tree, treeGrove, themeTree, trashBin, umbrella, van } from './props';
import { floodMast, grandstand, jetty, lampsAlong, lawnLot, quay, lotEdge, geodesicDome, spire } from './arch';
import { stadiumPts } from './education';

// ── shared park furniture ──────────────────────────────────────────────────
const PATH = 0xd6c9aa;

/** smoothed gravel path through control points */
function path(k: Kit, pts: P2[], w = 2.2, color: number = PATH, y = 0.09): P2[] {
  const sm = smoothPath(pts, k.lo ? 3 : 6);
  k.ribbon('paving', sm, w, y, color);
  return sm;
}

/** pond with stone rim, water surface and optional fountain */
function pond(k: Kit, x: number, z: number, rx: number, rz: number, seed: number, fountain = false, color: number = 0x3f7f8a): void {
  k.blob('dirt', x, z, rx + 0.8, rz + 0.8, 0.08, 0x8f8676, 18, 0.16, seed);
  k.blob('water', x, z, rx, rz, 0.12, color, 18, 0.16, seed);
  if (!k.lo) {
    const pts = blobPts(x, z, rx + 0.35, rz + 0.35, 18, 0.16, seed);
    const r = k.ctx.rng;
    for (let i = 0; i < pts.length; i += 2) k.ball('concrete', pts[i][0], 0.1, pts[i][1], r.range(0.3, 0.55), 0x9a958a, 5, 3, 0.6);
  }
  if (fountain) {
    k.cyl('concrete', x, 0.1, z, 0.8, 0.6, 0.6, 0xd8d2c4, 10);
    k.emitter('fountain', x, 0.8, z, 1);
    k.light(x, 0.6, z, 0x9fd8ff, 3, 'neon');
  }
}

/** reeds / tall grass tufts */
function reeds(k: Kit, x: number, z: number, n: number, spread: number): void {
  if (k.lo) return;
  const r = k.ctx.rng;
  for (let i = 0; i < n; i++) {
    const px = x + r.range(-spread, spread), pz = z + r.range(-spread, spread);
    k.cyl('foliage', px, 0, pz, 0.12, 0.02, r.range(1, 1.8), jitter(0x7a8a3a, () => r.next(), 0.15), 4, false);
  }
}

/** striped fairground tent / stall */
function stall(k: Kit, x: number, z: number, w: number, d: number, c1: number, c2: number, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    k.box('wood', 0, 0, 0, w, 2.6, d, 0xf4efe4, { top: false });
    const n = Math.max(3, Math.round(w / 0.8));
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 - 0.3 + ((w + 0.6) * i) / n, x1 = -w / 2 - 0.3 + ((w + 0.6) * (i + 1)) / n;
      const col = i % 2 ? c1 : c2;
      k.quad('plain', { x: x0, y: 2.6, z: d / 2 + 0.8 }, { x: x1, y: 2.6, z: d / 2 + 0.8 }, { x: x1, y: 3.8, z: 0 }, { x: x0, y: 3.8, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], col, { x: 0, y: 1, z: 1 });
      k.quad('plain', { x: x1, y: 2.6, z: -d / 2 - 0.3 }, { x: x0, y: 2.6, z: -d / 2 - 0.3 }, { x: x0, y: 3.8, z: 0 }, { x: x1, y: 3.8, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], col, { x: 0, y: 1, z: -1 });
    }
    k.box('emissive', 0, 2.2, d / 2 + 0.02, w * 0.7, 0.4, 0.06, 0xffe6a0);
    k.light(0, 2.4, d / 2 + 0.6, 0xffd08a, 3, 'neon');
  });
}

/** circus-style round tent */
function roundTent(k: Kit, x: number, z: number, r: number, h: number, c1: number, c2: number): void {
  const n = 12;
  k.cyl('plain', x, 0, z, r, r, h * 0.45, 0xf4efe4, n, false);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    k.tri('plain', { x: x + Math.cos(a0) * (r + 0.3), y: h * 0.45, z: z + Math.sin(a0) * (r + 0.3) }, { x: x + Math.cos(a1) * (r + 0.3), y: h * 0.45, z: z + Math.sin(a1) * (r + 0.3) }, { x, y: h, z }, [0, 0], [1, 0], [0.5, 1], i % 2 ? c1 : c2, { x: Math.cos((a0 + a1) / 2), y: 0.6, z: Math.sin((a0 + a1) / 2) });
  }
  k.cyl('metal', x, h, z, 0.06, 0.04, 1.6, 0x444444, 4);
  k.box('plain', x + 0.4, h + 1.1, z, 0.8, 0.5, 0.04, c1);
  k.light(x, h + 0.2, z, 0xffd08a, 3, 'neon');
}

/** carousel with animated platform */
function carousel(k: Kit, x: number, z: number, r: number): void {
  k.cyl('concrete', x, 0, z, r + 0.4, r + 0.4, 0.4, 0xd8d0c0, 16);
  k.anim([x, 0, z], [0, 1, 0], 0.7, (s) => {
    s.cyl('plain', x, 0.4, z, r, r, 0.3, 0xf2c230, 16);
    s.cyl('plain', x, 0.7, z, 0.6, 0.6, 3.2, 0xe8665a, 10, false);
    const horses = 8;
    for (let i = 0; i < horses; i++) {
      const a = (i / horses) * Math.PI * 2;
      const hx = x + Math.cos(a) * r * 0.72, hz = z + Math.sin(a) * r * 0.72;
      s.cyl('metal', hx, 0.7, hz, 0.05, 0.05, 3.2, C.gold, 4, false);
      s.box('plain', hx, 1.3 + (i % 2) * 0.3, hz, 0.35, 0.55, 1.1, [0xf4f4f4, 0x6a4a3a, 0x2a2a2a][i % 3]);
    }
    s.rev('plain', x, 3.9, z, [[r + 0.4, 0], [r * 0.3, 1.6], [0, 2.1]], 0xd83a4a, 16, { bottom: true, crease: 50 });
  });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.light(x + Math.cos(a) * (r + 0.3), 3.9, z + Math.sin(a) * (r + 0.3), 0xffe0a0, 1.6, 'neon');
  }
}

/** ferris wheel (plane XY, axis Z) with animated rim, spokes and gondolas */
function ferris(k: Kit, x: number, z: number, R: number, gondolas: number, speed = 0.08): number {
  const hub = R + 3;
  // A-frame legs on both sides
  for (const s of [-1, 1]) {
    k.beam('metal', [x - R * 0.42, 0, z + s * 3.2], [x, hub, z + s * 1.6], 0.8, 0.8, 0xe8eaec);
    k.beam('metal', [x + R * 0.42, 0, z + s * 3.2], [x, hub, z + s * 1.6], 0.8, 0.8, 0xe8eaec);
    k.beam('metal', [x - R * 0.2, hub * 0.5, z + s * 2.4], [x + R * 0.2, hub * 0.5, z + s * 2.4], 0.4, 0.4, 0xe8eaec);
  }
  k.push(new THREE.Matrix4().makeTranslation(x, hub, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  k.cylinder('metal', 0, -2, 0, 0.9, 0.9, 4, 0x9aa0a6, 10, { top: true, bottom: true });
  k.pop();
  k.anim([x, hub, z], [0, 0, 1], speed, (w) => {
    const segs = k.lo ? 24 : 48;
    for (const zz of [-1.3, 1.3]) {
      const rim: V3[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        rim.push([x + Math.cos(a) * R, hub + Math.sin(a) * R, z + zz]);
      }
      w.polyPipe('metal', rim, 0.3, 0xf4f4f4, 5);
      const inner: V3[] = rim.map(([px, py]) => [x + (px - x) * 0.93, hub + (py - hub) * 0.93, z + zz] as V3);
      if (!k.lo) w.polyPipe('metal', inner, 0.16, 0xf4f4f4, 4);
    }
    const spokes = k.lo ? 12 : 24;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      for (const zz of [-1.3, 1.3]) w.pipe('metal', [x, hub, z + zz * 0.5], [x + Math.cos(a) * R, hub + Math.sin(a) * R, z + zz], 0.06, 0xdfe2e6, 3);
    }
    const cols = [0xe8665a, 0x4aa3df, 0xf2c230, 0x5cb85c, 0x9b6cc8, 0xf29a3b];
    for (let i = 0; i < gondolas; i++) {
      const a = (i / gondolas) * Math.PI * 2;
      const gx = x + Math.cos(a) * (R + 0.2), gy = hub + Math.sin(a) * (R + 0.2);
      w.box('plain', gx, gy - 2.6, z, 2.2, 2.2, 2.2, cols[i % cols.length], { top: 'plain', topColor: 0xf4f4f4 });
      w.box('glass', gx, gy - 2.1, z, 2.26, 1.1, 1.9, 0x3a5266, { top: false });
      w.box('metal', gx, gy - 0.4, z, 0.12, 0.5, 0.12, 0x777777);
    }
  });
  const nl = k.lo ? 12 : 24;
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2;
    k.light(x + Math.cos(a) * R, hub + Math.sin(a) * R, z + 1.6, [0xff5ab0, 0x5ad8ff, 0xffe05a][i % 3], 2.6, 'neon');
  }
  k.light(x, hub, z + 2.4, 0xffffff, 4, 'neon');
  return hub + R + 1;
}

/** roller coaster: closed spline track on supports with a train */
function coaster(k: Kit, ctrl: V3[], color: number, support: number): number {
  // Catmull-Rom smoothing in 3D
  const n = ctrl.length;
  const pts: V3[] = [];
  const per = k.lo ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  let top = 0;
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * 0.6, nz = (dx / l) * 0.6;
    k.pipe('metal', [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz], 0.14, color, 4);
    k.pipe('metal', [a[0] - nx, a[1], a[2] - nz], [b[0] - nx, b[1], b[2] - nz], 0.14, color, 4);
    k.pipe('metal', [a[0], a[1] - 0.45, a[2]], [b[0], b[1] - 0.45, b[2]], 0.22, shade(color, 0.8), 4);
    if (i % 2 === 0) k.beam('metal', [a[0] + nx * 1.2, a[1] - 0.1, a[2] + nz * 1.2], [a[0] - nx * 1.2, a[1] - 0.1, a[2] - nz * 1.2], 0.12, 0.12, 0x555555);
    if (i % (k.lo ? 4 : 3) === 0 && a[1] > 2) k.beam('metal', [a[0], 0, a[2]], [a[0], a[1] - 0.5, a[2]], 0.35, 0.35, support);
    top = Math.max(top, a[1]);
  }
  // train of cars near the top of the lift hill
  let peak = 0;
  for (let i = 0; i < m; i++) if (pts[i][1] > pts[peak][1]) peak = i;
  for (let c = 0; c < 5; c++) {
    const a = pts[(peak - c * 1 + m) % m], b = pts[(peak - c * 1 + 1 + m) % m];
    k.pushTRS(a[0], a[1] + 0.1, a[2], Math.atan2(-(b[2] - a[2]), b[0] - a[0]));
    k.box('plain', 0, 0, 0, 1.9, 0.9, 1.5, [0xd83a3a, 0xf2c230][c % 2]);
    k.pop();
  }
  return top + 1;
}

/** tennis court with net (length along Z) */
function tennisCourt(k: Kit, x: number, z: number, surface: number, rotY = 0): void {
  k.at(x, 0, z, rotY, () => {
    k.flat('plain', 0, 0, 10.97 + 4, 23.77 + 6, 0.09, shade(surface, 0.85));
    k.flat('plain', 0, 0, 10.97, 23.77, 0.1, surface);
    k.paintRect(0, 0, 10.97, 23.77, 0.08, 0.11);
    k.paint(-4.11, -11.88, -4.11, 11.88, 0.06, 0.11);
    k.paint(4.11, -11.88, 4.11, 11.88, 0.06, 0.11);
    k.paint(-4.11, -6.4, 4.11, -6.4, 0.06, 0.11);
    k.paint(-4.11, 6.4, 4.11, 6.4, 0.06, 0.11);
    k.paint(0, -6.4, 0, 6.4, 0.06, 0.11);
    k.box('plain', 0, 0, 0, 12.8, 0.95, 0.05, 0x222222, { top: false });
    k.box('plain', 0, 0.86, 0, 12.8, 0.08, 0.07, 0xf4f4f4);
    for (const s of [-1, 1]) k.cyl('metal', s * 6.4, 0, 0, 0.05, 0.05, 1.07, 0x333333, 4);
  });
}

/** tent (ridge along X) */
function tent(k: Kit, x: number, z: number, rotY: number, color: number, size = 1): void {
  k.at(x, 0, z, rotY, () => {
    const w = 2.4 * size, d = 2.0 * size, h = 1.4 * size;
    k.quad('plain', { x: -w / 2, y: 0, z: d / 2 }, { x: w / 2, y: 0, z: d / 2 }, { x: w / 2, y: h, z: 0 }, { x: -w / 2, y: h, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], color, { x: 0, y: 1, z: 1 });
    k.quad('plain', { x: w / 2, y: 0, z: -d / 2 }, { x: -w / 2, y: 0, z: -d / 2 }, { x: -w / 2, y: h, z: 0 }, { x: w / 2, y: h, z: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]], shade(color, 0.85), { x: 0, y: 1, z: -1 });
    for (const s of [-1, 1]) k.tri('plain', { x: s * w / 2, y: 0, z: d / 2 }, { x: s * w / 2, y: h, z: 0 }, { x: s * w / 2, y: 0, z: -d / 2 }, [0, 0], [0.5, 1], [1, 0], s > 0 ? shade(color, 0.7) : shade(color, 0.92), { x: s, y: 0, z: 0 });
  });
}

/** zoo enclosure: ground patch, moat fence, rocks, animals */
function enclosure(k: Kit, pts: P2[], ground: number, animals: { kind: Parameters<typeof animal>[4]; n: number }[], rocks = 2): void {
  k.poly('dirt', pts, 0.08, ground);
  fence(k, pts, 1.4, 0x6a5a44, 3, 'wood', true);
  const r = k.ctx.rng;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) * 0.5;
  for (let i = 0; i < rocks; i++) k.ball('concrete', cx + r.range(-span, span), 0, cz + r.range(-span, span), r.range(1.2, 2.2), 0x9a8f80, 6, 4, 0.7);
  for (const a of animals) for (let i = 0; i < a.n; i++) animal(k, cx + r.range(-span, span), cz + r.range(-span, span), r.range(0, 6.28), a.kind);
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  small_park(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.6));
    path(k, [[-W / 2, 3], [-2, 1], [2, -2], [W / 2, -3]], 1.8);
    path(k, [[1, D / 2], [0.5, 2], [0, 0.8]], 1.6);
    tree(k, themeTree(k.ctx, 'shade'), -4, -4, 0.8, k.rnd() * 6, k.ctx.rng.int(0, 2));
    tree(k, themeTree(k.ctx, 'any'), 4.5, 4, 0.7, k.rnd() * 6, k.ctx.rng.int(0, 2));
    bench(k, -1.5, -0.8, Math.PI * 0.9);
    lampPost(k, 2.6, 1.2, 4);
    flowerBed(k, -4.5, 4.5, 3, 2);
    bush(k, 5.5, -5, 0.8);
    bush(k, -6, 1, 0.7);
    trashBin(k, 3.2, -1.5);
    return 8;
  },

  playground(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.6));
    k.slab('plain', 0, -0.5, W - 3, D - 5, 0.1, 0xc8553a, 0.1);
    k.slab('sand', -3.5, -3.5, 5, 5, 0.12, 0xe8d8a8, 0.1);
    playEquipment(k, 'swing', 3, -4, 0);
    playEquipment(k, 'slide', -3.5, 2.5, Math.PI / 2);
    playEquipment(k, 'seesaw', 3.5, 2, 0);
    playEquipment(k, 'climber', -3.5, -3.5);
    fence(k, [[-W / 2 + 0.6, D / 2 - 0.6], [-W / 2 + 0.6, -D / 2 + 0.6], [W / 2 - 0.6, -D / 2 + 0.6], [W / 2 - 0.6, D / 2 - 0.6], [2, D / 2 - 0.6]], 1.1, 0x3f7a4a, 1.8);
    bench(k, 5.5, 6.2, Math.PI);
    tree(k, themeTree(k.ctx, 'shade'), -6, 6, 0.6);
    crowd(k, 0, 0, 8, 8, 4);
    lampPost(k, -1, 6.5, 3.8);
    return 5;
  },

  dog_park(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.45));
    k.blob('dirt', -4, 2, 8, 6, 0.08, dryGround(k.ctx), 14, 0.25, 5);
    k.blob('dirt', 7, -8, 5, 4, 0.08, dryGround(k.ctx), 12, 0.3, 9);
    fence(k, [[-W / 2 + 0.8, D / 2 - 0.8], [-W / 2 + 0.8, -D / 2 + 0.8], [W / 2 - 0.8, -D / 2 + 0.8], [W / 2 - 0.8, D / 2 - 0.8], [3, D / 2 - 0.8]], 1.4, 0x4a5a4a, 2.6);
    // agility course: jumps, tunnel, A-frame, weave poles
    for (let i = 0; i < 3; i++) k.at(-8 + i * 4, 0, 4, 0, () => {
      k.box('plain', -0.7, 0, 0, 0.08, 0.9, 0.08, 0xf4f4f4);
      k.box('plain', 0.7, 0, 0, 0.08, 0.9, 0.08, 0xf4f4f4);
      k.box('plain', 0, 0.55, 0, 1.4, 0.06, 0.06, [0xd83a3a, 0x3a6fd8, 0xf2c230][i]);
    });
    k.push(new THREE.Matrix4().makeTranslation(4, 0.55, -2).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
    k.rev('plain', 0, -2.5, 0, [[0.55, 0], [0.55, 5]], 0x3a8ad8, 10, { crease: 80 });
    k.pop();
    k.quad('wood', { x: -6, y: 0, z: -5 }, { x: -6, y: 0, z: -7 }, { x: -3.5, y: 1.4, z: -7 }, { x: -3.5, y: 1.4, z: -5 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xf2c230, { x: -0.5, y: 1, z: 0 });
    k.quad('wood', { x: -1, y: 0, z: -7 }, { x: -1, y: 0, z: -5 }, { x: -3.5, y: 1.4, z: -5 }, { x: -3.5, y: 1.4, z: -7 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0x3f9a4a, { x: 0.5, y: 1, z: 0 });
    for (let i = 0; i < 6; i++) k.cyl('plain', 6 + i * 0.7, 0, 6, 0.04, 0.04, 1, i % 2 ? 0xd83a3a : 0xf4f4f4, 4);
    const r = k.ctx.rng;
    for (let i = 0; i < 6; i++) animal(k, r.range(-10, 10), r.range(-10, 10), r.range(0, 6), 'dog');
    for (let i = 0; i < 4; i++) person(k, r.range(-10, 10), r.range(-10, 10), r.pick([0x3a6fd8, 0xd04040, 0x2f9a5a, 0x333333]), r.range(0, 6));
    bench(k, -11, -11, Math.PI * 0.25);
    bench(k, 11, 11, Math.PI * 1.25);
    tree(k, themeTree(k.ctx, 'shade'), -11, 10, 0.85);
    tree(k, themeTree(k.ctx, 'shade'), 11, -11, 0.8, 1, 1);
    k.cyl('metal', 12, 0, 1, 0.2, 0.25, 1, 0x5a6a7a, 6);
    return 5;
  },

  city_park(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.65));
    const main = path(k, [[-W / 2, 8], [-12, 6], [-4, 12], [6, 10], [14, 2], [W / 2, -2]], 2.6);
    path(k, [[0, D / 2], [-2, 14], [-4, 12]], 2.4);
    path(k, [[-10, -D / 2], [-12, -12], [-6, -4], [0, -6], [6, -2], [14, 2]], 2.2);
    pond(k, 6, -14, 9, 5, 3, true);
    // gazebo on the lawn
    k.at(-12, 0, -2, 0, () => {
      k.cyl('concrete', 0, 0, 0, 3.4, 3.4, 0.4, 0xd8d2c4, 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.cyl('plain', Math.cos(a) * 3, 0.4, Math.sin(a) * 3, 0.12, 0.12, 2.8, 0xf4f4f0, 6, false);
      }
      k.rev('roof_metal', 0, 3.2, 0, [[3.8, 0], [1.2, 1.6], [0.2, 2.3]], C.copper, 8, { bottom: true, crease: 30 });
    });
    const avoid = (x: number, z: number) => Math.hypot(x - 6, (z + 14) * 1.6) < 12 || Math.hypot(x + 12, z + 2) < 5 || main.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.2);
    treeGrove(k, 0, 0, W - 6, D - 6, 14, 'any', avoid, [0.75, 1.1]);
    flowerBed(k, -4, 6, 5, 2.4);
    flowerBed(k, 10, 14, 3.6, 2);
    for (const [x, z, r] of [[-6, 10, 0.3], [2, 12.5, -0.2], [10, 7, -0.6], [0, -8, Math.PI]] as [number, number, number][]) bench(k, x, z, r);
    lampsAlong(k, main, 12, 4.2, 'classic', 1.8);
    picnicTable(k, -16, 16, 0.4);
    crowd(k, 0, 4, 24, 20, 10);
    return 12;
  },

  botanical_garden(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.75), 0xd8ccb0);
    // Victorian palm house: curved glass nave + central dome
    const gx = 0, gz = -12;
    k.box('wall_stone', gx, 0, gz, 40, 1, 14, 0xe6dcc6, { top: 'paving', topColor: 0xd8ccb0 });
    k.box('glass', gx, 1, gz, 38, 5, 12, 0xcfe6e0, { top: false });
    k.barrel('glass', gx, 6, gz, 12, 38, 5.5, 0xcfe6e0, k.seg(10), true, 'glass', 0xcfe6e0);
    for (let i = 0; i <= 10; i++) k.box('metal', gx - 19 + i * 3.8, 1, gz + 6.05, 0.15, 5, 0.1, 0xf4f4f0, { top: false });
    k.cyl('glass', gx, 1, gz, 7, 7, 9, 0xcfe6e0, k.seg(16), false);
    k.dome('glass', gx, 10, gz, 7, 0xcfe6e0, k.seg(16), 1.05);
    k.cyl('metal', gx, 17.2, gz, 0.6, 0.3, 1.4, 0xf4f4f0, 8);
    for (let i = 0; i < 6; i++) tree(k, 'palm', gx - 15 + i * 6, gz + (i % 2 ? 2 : -2), 0.7, i, i);
    k.light(gx, 8, gz, 0xbfffd0, 16, 'neon');
    // formal parterre with patterned beds + pond
    const pal = [[0xe0414f, 0xf5f0f0], [0xf2c230, 0xf07a3a], [0xb05cc8, 0xf5f0f0], [0xf08fb0, 0xe0414f]];
    for (let i = 0; i < 4; i++) {
      const x = -18 + (i % 2) * 10 + (i > 1 ? 26 : 0), z = 8 + (i % 2) * 0;
      flowerBed(k, x, z, 7, 3.2, pal[i], 3);
      hedge(k, x, z - 2.4, 7.6, 0.6, 0.7);
      hedge(k, x, z + 2.4, 7.6, 0.6, 0.7);
    }
    pond(k, 0, 9, 4.5, 3.2, 7, true, 0x3f8f8a);
    path(k, [[0, D / 2], [0, 13]], 3, 0xd8ccb0);
    path(k, [[-W / 2 + 2, 2], [W / 2 - 2, 2]], 2.4, 0xd8ccb0);
    for (const x of [-26, 26]) for (const z of [14, -4]) tree(k, themeTree(k.ctx, 'formal'), x, z, 0.85, x + z, Math.abs(x + z) % 3);
    tree(k, 'cherry', -12, 18, 0.8);
    tree(k, 'cherry', 12, 18, 0.8, 1, 1);
    crowd(k, 0, 4, 40, 10, 12);
    return 18.5;
  },

  skate_park(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.5));
    k.slab('concrete', 0, 0, W - 4, D - 4, 0.12, 0xc8c4bc, 0.2);
    // bowl
    k.rev('concrete', -5, -0.2, -5, [[6.5, 0.3], [6, 0.1], [4.8, -1.4], [3, -2]], 0xb8b4ac, k.seg(20), { inside: true, crease: 80 });
    k.disc('concrete', -5, -1.8, -5, 3.1, 0xa8a49c, k.seg(20));
    k.torus('metal', -5, 0.3, -5, 6.5, 0.08, 0x888888, k.seg(20), 3);
    // half-pipe
    k.at(6, 0, 3, 0, () => {
      for (const s of [-1, 1]) {
        const prof: P2[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * (Math.PI / 2);
          prof.push([s * (2 + Math.sin(a) * 3), 3 - Math.cos(a) * 3]);
        }
        for (let i = 0; i < 6; i++) {
          const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
          k.quad('concrete', { x: x0, y: y0 + 0.1, z: -4 }, { x: x1, y: y1 + 0.1, z: -4 }, { x: x1, y: y1 + 0.1, z: 4 }, { x: x0, y: y0 + 0.1, z: 4 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xd0ccc4, { x: -s * 0.5, y: 1, z: 0 });
        }
        k.box('wood', s * 5.6, 0, 0, 1.2, 3.1, 8, 0x8a8e92, { top: 'wood', topColor: C.woodLight });
        k.box('metal', s * 5.05, 3.1, 0, 0.1, 0.1, 8, 0x999999);
      }
      for (const s of [-1, 1]) k.quad('plain', { x: -5, y: 0.1, z: s * 4 }, { x: 5, y: 0.1, z: s * 4 }, { x: 5, y: 3.1, z: s * 4 }, { x: -5, y: 3.1, z: s * 4 }, [[0, 0], [1, 0], [1, 1], [0, 1]], [0x3a8ad8, 0xe8665a][s > 0 ? 0 : 1], { x: 0, y: 0, z: s });
    });
    // funbox, rail, stairs
    k.box('concrete', 5, 0.1, -8, 5, 0.9, 3, 0xbcb8b0);
    k.quad('concrete', { x: 2.5, y: 0.1, z: -6.5 }, { x: 2.5, y: 0.1, z: -9.5 }, { x: 0.5, y: 0.1, z: -9.5 }, { x: 0.5, y: 0.1, z: -6.5 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xbcb8b0);
    k.box('metal', -6, 0.1, 8, 7, 0.06, 0.08, 0xd8d8d8);
    k.box('metal', -9.4, 0.1, 8, 0.08, 0.7, 0.08, 0x999999);
    k.box('metal', -2.6, 0.1, 8, 0.08, 0.7, 0.08, 0x999999);
    const r = k.ctx.rng;
    for (let i = 0; i < 5; i++) person(k, r.range(-10, 10), r.range(-10, 10), r.pick([0xd04040, 0x333333, 0xf2c230, 0x3a6fd8]), r.range(0, 6));
    lampsAlong(k, [[-W / 2 + 1.5, D / 2 - 1.5], [W / 2 - 1.5, D / 2 - 1.5]], 10, 5, 'modern', 0);
    tree(k, themeTree(k.ctx, 'shade'), W / 2 - 3, -D / 2 + 3, 0.7);
    return 5;
  },

  basketball_courts(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.5));
    for (const [x, col] of [[-6.8, C.courtBlue], [6.8, 0xc8553a]] as [number, number][]) {
      k.at(x, 0, -1, Math.PI / 2, () => {
        k.slab('asphalt', 0, 0, 26, 14, 0.08, 0x3f6f5a, 0.1);
        k.flat('plain', 0, 0, 24, 12, 0.1, col);
        k.paintRect(0, 0, 24, 12, 0.08, 0.12);
        k.paint(0, -6, 0, 6, 0.08, 0.12);
        k.ring('plain', 0, 0.12, 0, 1.75, 1.83, 0xf4f4f0, 16);
        for (const s of [-1, 1]) {
          k.ring('plain', s * 12, 0.12, 0, 6.7, 6.78, 0xf4f4f0, 16, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
          k.flat('plain', s * 9.1, 0, 5.8, 4.9, 0.115, shade(col, 0.85));
          k.cyl('metal', s * 12.8, 0, 0, 0.1, 0.1, 3.4, 0x333333, 5);
          k.box('plain', s * 12.45, 2.9, 0, 0.06, 1.05, 1.8, 0xf4f4f4);
          k.torus('metal', s * 12.1, 3.05, 0, 0.23, 0.025, 0xe06a1a, 8, 3);
        }
      });
    }
    fence(k, [[-W / 2 + 0.6, D / 2 - 1], [-W / 2 + 0.6, -D / 2 + 0.6], [W / 2 - 0.6, -D / 2 + 0.6], [W / 2 - 0.6, D / 2 - 1], [2, D / 2 - 1]], 3.2, 0x3f5a4a, 2.6);
    for (const [x, z] of [[-W / 2 + 1, 0], [W / 2 - 1, 0]] as P2[]) {
      k.cyl('metal', x, 0, z, 0.1, 0.08, 7, 0x444444, 5);
      k.box('emissive', x, 6.8, z, 0.3, 0.3, 1.2, 0xfff6e0);
      k.light(x, 6.6, z, 0xfff8e8, 7, 'flood');
    }
    crowd(k, 0, -1, 24, 20, 10);
    bench(k, 0, D / 2 - 2.2, 0);
    return 7;
  },

  soccer_field(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.5));
    const pw = 52, pd = 34, pz = -2;
    k.flat('grass', 0, pz, pw + 6, pd + 6, 0.08, 0x4f9a3e);
    if (!k.lo) for (let i = 0; i < 10; i++) k.flat('grass', -pw / 2 + (i + 0.5) * (pw / 10), pz, pw / 10, pd, 0.09, i % 2 ? 0x5aa648 : 0x4c9a3c);
    k.paintRect(0, pz, pw, pd, 0.14, 0.11);
    k.paint(0, pz - pd / 2, 0, pz + pd / 2, 0.14, 0.11);
    k.ring('plain', 0, 0.11, pz, 4.5, 4.64, 0xf4f4f0, 24);
    for (const s of [-1, 1]) {
      k.paintRect((s * pw) / 2 - s * 6.5, pz, 13, 20, 0.12, 0.11);
      k.at((s * pw) / 2, 0, pz, Math.PI / 2, () => {
        k.box('plain', -3.66, 0, 0, 0.12, 2.44, 0.12, 0xf4f4f4);
        k.box('plain', 3.66, 0, 0, 0.12, 2.44, 0.12, 0xf4f4f4);
        k.box('plain', 0, 2.38, 0, 7.44, 0.12, 0.12, 0xf4f4f4);
        k.quad('plain', { x: -3.66, y: 2.44, z: -s * 1.5 }, { x: 3.66, y: 2.44, z: -s * 1.5 }, { x: 3.66, y: 0, z: -s * 2 }, { x: -3.66, y: 0, z: -s * 2 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xe8e8e8, { x: 0, y: 0.3, z: s });
      });
    }
    grandstand(k, 0, pz + pd / 2 + 3.5, 40, 5, 0x2f5fa8, 0, 0.2, 0.45, 0.8, true);
    for (const [x, z] of [[-30, -21], [30, -21], [-30, 18], [30, 18]] as P2[]) floodMast(k, x, z, 16, 0, pz);
    // clubhouse
    k.box('wall_brick', -22, 0, -D / 2 + 3.5, 14, 3.4, 5, 0xb86a4a, { top: 'roof_flat' });
    crowd(k, 0, pz + pd / 2 + 5, 36, 3, 16);
    crowd(k, 0, pz, 44, 28, 14);
    return 17;
  },

  tennis_club(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.6));
    const surf = [C.tennisClay, C.courtGreen, C.courtBlue];
    for (let i = 0; i < 3; i++) tennisCourt(k, -15.5 + i * 15.5, -2, surf[k.ctx.rng.int(0, 1) === 0 ? 0 : i % 3]);
    fence(k, [[-W / 2 + 0.5, 13], [-W / 2 + 0.5, -D / 2 + 0.5], [W / 2 - 0.5, -D / 2 + 0.5], [W / 2 - 0.5, 13], [-W / 2 + 0.5, 13]], 3.4, 0x2f4f3a, 2.6);
    // clubhouse with terrace + umbrellas
    k.box('wall_wood', 16, 0, 13.5, 14, 3.6, 4.5, 0xf2eee4, { top: false });
    k.gableRoof('roof_tile', 16, 3.6, 13.5, 14, 4.5, 1.4, 0x3f6f4a, { overhang: 0.6, wallMat: 'wall_wood', wallColor: 0xf2eee4, ridgeAlongX: true });
    for (let i = 0; i < 3; i++) umbrella(k, -14 + i * 6, 14.2, 0x3f8a4a, 1.3, 2.3);
    for (let i = 0; i < 6; i++) person(k, -15.5 + (i % 3) * 15.5, -2 + (i < 3 ? -9 : 9), 0xf4f4f4, i < 3 ? 0 : Math.PI);
    return 8;
  },

  public_pool(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.6));
    k.slab('paving', -2, -3, W - 8, D - 10, 0.1, 0xe8e2d4, 0.1);
    // 25 m lane pool + kids pool + slide tower
    const coping = (x: number, z: number, w: number, d: number, h: number) => {
      k.box('concrete', x, 0, z - d / 2, w + 0.8, h, 0.8, 0xf2eee6);
      k.box('concrete', x, 0, z + d / 2, w + 0.8, h, 0.8, 0xf2eee6);
      k.box('concrete', x - w / 2, 0, z, 0.8, h, d, 0xf2eee6);
      k.box('concrete', x + w / 2, 0, z, 0.8, h, d, 0xf2eee6);
    };
    coping(-6, -4, 25, 12, 0.55);
    k.flat('water', -6, -4, 25, 12, 0.45, 0x4fc0d8);
    if (!k.lo) for (let i = 1; i < 6; i++) k.box('plain', -6, 0.46, -10 + i * 2, 25, 0.04, 0.08, i % 2 ? 0xd83a3a : 0xf4f4f4);
    coping(14, -6, 8.4, 6.4, 0.45);
    k.flat('water', 14, -6, 8.4, 6.4, 0.38, 0x6fd0e0);
    k.at(14, 0, 4, 0, () => {
      k.box('metal', 0, 0, 0, 3, 5, 3, 0x2f6fd0, { top: 'plain', topColor: 0xf2c230 });
      const pts: V3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, a = t * Math.PI * 1.4;
        pts.push([Math.cos(a) * 3 - 1.5, 5 - t * 4.9, Math.sin(a) * 3 - 3]);
      }
      k.polyPipe('plain', pts, 0.55, 0xf2c230, 8);
    });
    for (let i = 0; i < 6; i++) umbrella(k, -16 + i * 4.4, 6.5, [0xf2c230, 0x2f6fd0, 0xe8665a][i % 3], 1.3, 2.3);
    for (let i = 0; i < 6; i++) k.box('plain', -16 + i * 4.4 + 1.2, 0.1, 7.8, 0.7, 0.35, 1.9, 0xf4f4f4);
    // changing building
    k.box('wall_plaster', 0, 0, D / 2 - 3.5, 22, 3.4, 5, 0xf2f0ea, { top: 'roof_flat' });
    k.box('plain', 0, 2.6, D / 2 - 0.95, 22, 0.8, 0.1, 0x2f9fd0, { top: false });
    crowd(k, -6, 2, 28, 4, 10);
    const r = k.ctx.rng;
    for (let i = 0; i < 8; i++) {
      const px = -6 + r.range(-11, 11), pz = -4 + r.range(-5, 5);
      k.ball('plain', px, 0.48, pz, 0.15, [0xe8c4a0, 0xc68e62, 0x8d5a3b][i % 3], 5, 3);
    }
    fence(k, [[-W / 2 + 0.6, D / 2 - 6], [-W / 2 + 0.6, -D / 2 + 0.6], [W / 2 - 0.6, -D / 2 + 0.6], [W / 2 - 0.6, D / 2 - 6]], 2, 0x5d6166, 2.6);
    return 8;
  },

  zoo(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.6));
    const main = path(k, [[0, D / 2], [0, 22], [-20, 10], [-26, -10], [-8, -26], [16, -22], [30, -4], [22, 14], [0, 22]], 3, 0xd6c49a);
    // savannah (giraffes, zebras), elephants, lions, flamingo lake
    enclosure(k, [[-44, -2], [-30, 12], [-12, 4], [-14, -18], [-34, -22]], 0xc8b27a, [{ kind: 'giraffe', n: 3 }, { kind: 'zebra', n: 4 }], 3);
    enclosure(k, [[-2, -10], [18, -8], [22, -16], [10, -34], [-6, -32]], 0xb09a70, [{ kind: 'elephant', n: 3 }], 2);
    enclosure(k, [[32, -8], [44, -6], [44, -30], [26, -32], [22, -22]], 0xa8905a, [{ kind: 'lion', n: 3 }], 4);
    k.blob('dirt', 30, 20, 13, 8, 0.08, 0x8f8676, 16, 0.2, 4);
    k.blob('water', 30, 20, 12, 7, 0.12, 0x4f8f8a, 16, 0.2, 4);
    for (let i = 0; i < 9; i++) animal(k, 26 + (i % 3) * 3, 18 + Math.floor(i / 3) * 2.4, i, 'flamingo');
    reeds(k, 22, 24, 12, 3);
    // elephant house + aviary dome
    k.box('wall_brick', 6, 0, -40, 20, 7, 6, 0xb89a70, { top: false });
    k.gableRoof('roof_tile', 6, 7, -40, 20, 6, 2.4, 0x7a4a2a, { wallMat: 'wall_brick', wallColor: 0xb89a70, ridgeAlongX: true });
    geodesicDome(k, -28, 0, 24, 8, 0xcfe8e0, 0xe8eaec, 1, 0.9);
    for (let i = 0; i < 4; i++) tree(k, 'palm', -28 + Math.cos(i * 1.6) * 4, 24 + Math.sin(i * 1.6) * 4, 0.55, i, i);
    // entrance gate with arch, ticket kiosk
    k.box('wall_stone', -7, 0, D / 2 - 3, 2, 7, 2, 0x8a6a4a);
    k.box('wall_stone', 7, 0, D / 2 - 3, 2, 7, 2, 0x8a6a4a);
    k.box('wood', 0, 5.6, D / 2 - 3, 16, 1.6, 1.2, C.woodDark);
    k.sign(0, 5.8, D / 2 - 2.35, 9, 1.1, 0xf2c230, 0xffe080);
    const avoid = (x: number, z: number) => main.some(([px, pz]) => Math.hypot(px - x, pz - z) < 4) || (x < -10 && z < 12 && z > -22) || (x > -6 && x < 24 && z < -6) || (x > 20 && z < -4) || Math.hypot(x - 30, z - 20) < 14 || Math.hypot(x + 28, z - 24) < 10;
    treeGrove(k, 0, 0, W - 6, D - 6, 26, 'any', avoid, [0.7, 1.1]);
    crowd(k, 0, 0, 50, 40, 22);
    lampsAlong(k, main, 16, 4, 'classic', 2.2);
    return 12;
  },

  amusement_park(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd8ccb4, 0.2, 0.04);
    k.slab('grass', -26, -26, 40, 40, 0.07, lawnColor(k.ctx, 0.6), 0.1);
    // roller coaster around the back-left
    const top = coaster(k, [[-44, 8, -44], [-10, 34, -44], [-4, 30, -36], [-8, 6, -22], [-22, 16, -14], [-40, 24, -10], [-44, 10, -24], [-36, 4, -34], [-44, 4, -40]], 0xd8412f, 0xe8eaec);
    k.box('wood', -40, 0, -38, 8, 3, 4, 0xf2c230, { top: 'roof_metal', topColor: 0xd8412f });
    // drop tower
    const dx = 32, dz = -32;
    k.cyl('metal', dx, 0, dz, 1.6, 1.3, 44, 0xe8eaec, 12);
    k.cyl('neon', dx, 44, dz, 1.8, 1.8, 1.2, 0xff4fd8, 12);
    k.anim([dx, 0, dz], [0, 1, 0], 0.4, (s) => {
      s.torus('plain', dx, 30, dz, 2.6, 0.9, 0x3a8ad8, 14, 6);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.box('plain', dx + Math.cos(a) * 3.2, 28.8, dz + Math.sin(a) * 3.2, 0.9, 1.4, 0.9, 0xf2c230);
      }
    });
    k.light(dx, 45.5, dz, C.beaconRed, 3, 'beacon', true);
    for (let y = 6; y < 44; y += 6) k.light(dx + 1.5, y, dz, 0xff5ab0, 2.2, 'neon');
    // ferris wheel + carousel + circus tent + stalls
    ferris(k, 30, 6, 16, 16, 0.12);
    carousel(k, -4, 22, 6);
    roundTent(k, 10, -12, 9, 11, 0xd83a3a, 0xf4f4f0);
    const stallCols: [number, number][] = [[0xd83a3a, 0xf4f4f0], [0x3a6fd8, 0xf4f4f0], [0xf2c230, 0xd83a3a], [0x3fa05a, 0xf4f4f0]];
    for (let i = 0; i < 6; i++) stall(k, -34 + i * 8, 40, 5, 3, ...stallCols[i % 4], 0);
    for (let i = 0; i < 3; i++) stall(k, 16 + i * 8, 26, 5, 3, ...stallCols[(i + 1) % 4], Math.PI);
    // entrance arch with lights
    k.at(0, 0, D / 2 - 2, 0, () => {
      for (const s of [-1, 1]) k.cyl('plain', s * 7, 0, 0, 0.8, 0.8, 9, 0xd83a3a, 10);
      k.box('plain', 0, 9, 0, 16, 2.2, 1.2, 0xf2c230);
      k.sign(0, 9.4, 0.65, 10, 1.4, 0xff4fd8, 0xff8ae8);
      for (let i = 0; i < 9; i++) k.light(-8 + i * 2, 11.4, 0.6, [0xffe05a, 0xff5ab0, 0x5ad8ff][i % 3], 1.6, 'neon');
    });
    path(k, [[0, D / 2], [0, 30], [-4, 14], [10, 2], [24, -8], [30, -20]], 4, 0xd8ccb4);
    treeGrove(k, 20, 38, 30, 8, 5, 'shade');
    crowd(k, 0, 10, 60, 50, 40);
    lampsAlong(k, [[-W / 2 + 3, 34], [W / 2 - 3, 34]], 9, 4.2, 'classic', 0);
    return Math.max(top, 47);
  },

  ferris_wheel(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd8ccb4, 0.2, 0.04);
    k.slab('grass', 0, -D / 2 + 4, W - 4, 6, 0.08, lawnColor(k.ctx, 0.6), 0.1);
    const top = ferris(k, 0, -2, 21, 18, 0.07);
    // boarding platform + ticket booth + queue rails
    k.box('concrete', 0, 0, 3, 12, 1.2, 6, 0xc8c3b8);
    k.stairs(0, 6.2, 4, 1.2, 0xc8c3b8);
    k.box('wood', 14, 0, 9, 4, 3, 3, 0xd83a3a, { top: 'roof_metal', topColor: 0xf4f4f0 });
    k.box('emissive', 14, 2.1, 10.55, 3, 0.6, 0.06, 0xffe6a0);
    for (let i = 0; i < 4; i++) k.box('metal', 6 + i * 1.6, 0.9, 11 - (i % 2) * 1.6, 0.06, 0.06, 5, 0xc8a040);
    for (const x of [-18, 18]) tree(k, themeTree(k.ctx, 'shade'), x, -10, 0.8, x);
    crowd(k, 6, 11, 12, 3, 8);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.2, 'classic', 0);
    return top;
  },

  golf_course(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.45), 0.2, 0.04);
    const holes: { tee: P2; green: P2 }[] = [
      { tee: [-54, 36], green: [-40, -30] },
      { tee: [-28, -38], green: [4, 20] },
      { tee: [16, 34], green: [50, -30] },
      { tee: [36, -40], green: [14, -8] },
    ];
    const r = k.ctx.rng;
    for (const [i, h] of holes.entries()) {
      const mid: P2 = [(h.tee[0] + h.green[0]) / 2 + (i % 2 ? 6 : -6), (h.tee[1] + h.green[1]) / 2];
      const fw = smoothPath([h.tee, mid, h.green], 6);
      k.ribbon('grass', fw, 16, 0.08, mix(lawnColor(k.ctx, 0.8), 0x8fc85a, 0.3));
      if (!k.lo) k.ribbon('grass', fw, 8, 0.085, mix(lawnColor(k.ctx, 0.8), 0x9fd060, 0.4));
      k.flat('grass', h.tee[0], h.tee[1], 5, 5, 0.09, 0x86c050);
      k.blob('grass', h.green[0], h.green[1], 6, 5, 0.1, 0x8fd05a, 14, 0.15, i);
      k.cyl('metal', h.green[0], 0.1, h.green[1], 0.03, 0.03, 2.3, 0xf4f4f4, 4);
      k.tri('plain', { x: h.green[0], y: 2.4, z: h.green[1] }, { x: h.green[0], y: 1.8, z: h.green[1] }, { x: h.green[0] + 0.8, y: 2.1, z: h.green[1] }, [0, 0], [0, 1], [1, 0.5], 0xd83a3a, { x: 0, y: 0, z: 1 });
      k.tri('plain', { x: h.green[0], y: 2.4, z: h.green[1] }, { x: h.green[0], y: 1.8, z: h.green[1] }, { x: h.green[0] + 0.8, y: 2.1, z: h.green[1] }, [0, 0], [0, 1], [1, 0.5], 0xd83a3a, { x: 0, y: 0, z: -1 });
      k.blob('sand', h.green[0] + 7, h.green[1] + 3, 3, 2, 0.11, 0xe8d8a8, 10, 0.3, i + 3);
      k.blob('sand', mid[0] - 6, mid[1], 3.5, 2.2, 0.1, 0xe8d8a8, 10, 0.3, i + 7);
    }
    pond(k, -14, 2, 10, 6, 11, false, 0x3f7f8a);
    const avoid = (x: number, z: number) => holes.some((h) => {
      const dx = h.green[0] - h.tee[0], dz = h.green[1] - h.tee[1];
      const t = Math.max(0, Math.min(1, ((x - h.tee[0]) * dx + (z - h.tee[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - h.tee[0] - dx * t, z - h.tee[1] - dz * t) < 11;
    }) || Math.hypot(x + 14, z - 2) < 12 || (z > 30 && x > -20 && x < 12);
    treeGrove(k, 0, 0, W - 4, D - 4, 36, 'any', avoid, [0.8, 1.2]);
    // clubhouse + cart path + carts
    k.box('wall_wood', -4, 0, 38, 20, 4.5, 10, 0xf2eee4, { top: false });
    k.hipRoof('roof_shingle', -4, 4.5, 38, 20, 10, 3.2, 0x4a5a4a, 0.8);
    k.box('wood', -4, 0, 44.2, 20, 0.5, 3, C.woodLight);
    parkedCars(k, 18, D / 2 - 3, 40, D / 2 - 3, 2.8, Math.PI / 2, 0.7);
    for (let i = 0; i < 3; i++) k.at(-18 + i * 2, 0, 42, 0, () => {
      k.box('plain', 0, 0.3, 0, 2.2, 0.8, 1.2, 0xf4f4f4);
      k.box('plain', 0, 1.8, 0, 2.2, 0.08, 1.3, 0x2f6f4a);
    });
    for (let i = 0; i < 6; i++) {
      const h = holes[i % 4];
      person(k, h.green[0] + r.range(-3, 3), h.green[1] + r.range(-3, 3), r.pick([0xf4f4f4, 0xd83a3a, 0x3a6fd8]), r.range(0, 6));
    }
    return 9;
  },

  nature_reserve(k) {
    const W = k.W, D = k.D;
    k.lot('grass', mix(lawnColor(k.ctx, 0.25), k.ctx.theme.grassDry, 0.3), 0.2, 0.04);
    // wetland pond with reeds + boardwalk, wild woods, bird hide, lookout
    k.blob('dirt', 8, -6, 16, 11, 0.07, 0x6f6a52, 18, 0.25, 21);
    k.blob('water', 8, -6, 15, 10, 0.1, 0x4a7a72, 18, 0.25, 21);
    reeds(k, 0, 2, 30, 6);
    reeds(k, 20, -14, 24, 5);
    const bw = smoothPath([[-30, 30], [-14, 12], [0, 0], [10, -6], [22, -2]], 4);
    for (let i = 0; i < bw.length - 1; i++) {
      const [ax, az] = bw[i], [bx, bz] = bw[i + 1];
      k.beam('wood', [ax, 0.6, az], [bx, 0.6, bz], 1.8, 0.2, C.wood);
      if (i % 2 === 0) for (const s of [-1, 1]) k.cyl('wood', ax + s * 0.8, -0.5, az, 0.1, 0.1, 1.9, C.woodDark, 4, true);
    }
    k.box('wood', 22, 0.5, -2, 5, 2.6, 3, C.woodDark, { top: false });
    k.shedRoof('roof_shingle', 22, 3.1, -2, 5, 3, 0.8, 0x4a5a3a, 0.3, 'wood', C.woodDark);
    // observation tower
    k.at(-26, 0, -26, 0.3, () => {
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as P2[]) k.beam('wood', [x * 1.4, 0, z * 1.4], [x, 12, z], 0.3, 0.3, C.woodDark);
      for (let y = 3; y <= 12; y += 3) k.box('wood', 0, y, 0, 4 - y * 0.08, 0.15, 4 - y * 0.08, C.wood, { top: false });
      k.box('wood', 0, 12, 0, 4, 1.1, 4, C.wood, { top: false });
      k.pyramid('roof_shingle', 0, 13.8, 0, 4.4, 4.4, 1.6, 0x4a5a3a);
      for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]] as P2[]) k.box('wood', x, 12, z, 0.2, 1.8, 0.2, C.woodDark);
    });
    const avoid = (x: number, z: number) => Math.hypot((x - 8) / 16, (z + 6) / 11) < 1.1 || bw.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3);
    treeGrove(k, 0, 0, W - 4, D - 4, 44, 'any', avoid, [0.8, 1.3]);
    const r = k.ctx.rng;
    for (let i = 0; i < 12; i++) bush(k, r.range(-36, 36), r.range(-36, 36), r.range(0.7, 1.3), jitter(0x4a7a36, () => r.next(), 0.15), i);
    for (let i = 0; i < 4; i++) animal(k, -12 + i * 3, 22 + (i % 2) * 2, i, 'deer');
    k.box('wood', 0, 0, D / 2 - 3, 6, 0.4, 3, C.wood);
    k.sign(0, 1, D / 2 - 1.4, 3, 1, 0x5a7a3a, 0xc8ffb0, C.woodDark);
    return 14;
  },

  campground(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.4));
    path(k, [[0, D / 2], [0, 10], [-12, 0], [-8, -14], [8, -14], [14, 0], [0, 10]], 3, dryGround(k.ctx));
    const cols = [0xd8412f, 0xf2a93b, 0x3a8ad8, 0x3fa05a, 0xf2d04b, 0x9b6cc8];
    const spots: [number, number, number][] = [[-18, 12, 0.4], [-18, -4, 1.2], [-4, -4, 0.2], [4, 6, 2.2], [18, -12, 0.8], [18, 8, 1.8], [-6, -20, 0.1]];
    spots.forEach(([x, z, r], i) => {
      k.blob('dirt', x, z, 3.4, 3, 0.07, dryGround(k.ctx), 10, 0.2, i);
      tent(k, x, z, r, cols[i % cols.length], i % 3 === 0 ? 1.3 : 1);
      if (i % 2 === 0) {
        k.ring('concrete', x + 2.5, 0.08, z + 2, 0.5, 0.75, 0x6a6a6a, 8);
        k.cyl('neon', x + 2.5, 0.08, z + 2, 0.3, 0.05, 0.7, 0xff8a2a, 6, false);
        k.light(x + 2.5, 0.8, z + 2, 0xffa040, 2.6, 'lamp');
      } else picnicTable(k, x + 2.8, z + 1.5, r);
    });
    // camper van + wash house
    van(k, 12, 16, 0.2, 0xf4f4ee, 0x3a8ad8);
    k.box('wall_wood', -16, 0, 19, 8, 3, 4, 0x8a6a4a, { top: false });
    k.gableRoof('roof_metal', -16, 3, 19, 8, 4, 1.2, 0x4a5a4a, { wallMat: 'wall_wood', wallColor: 0x8a6a4a, ridgeAlongX: true });
    const avoid = (x: number, z: number) => spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 5) || Math.abs(x) < 3 || (z > 14 && Math.abs(x) < 22);
    treeGrove(k, 0, 0, W - 4, D - 4, 14, 'conifer', avoid, [0.8, 1.2]);
    crowd(k, 0, 0, 30, 30, 6);
    return 10;
  },

  lakeside_park(k) {
    const W = k.W, D = k.D;
    lawnLot(k, lawnColor(k.ctx, 0.65));
    // shoreline steps into the water at the back + jetty with pedal boats
    k.box('concrete', 0, -1.2, -D / 2 + 2, W - 1, 1.3, 4, 0xc8c2b4, { top: 'paving', topColor: 0xd8d2c4 });
    for (let i = 0; i < 3; i++) k.box('concrete', 0, -1.2 - i * 0.4, -D / 2 - 0.5 - i * 1.2, W - 1, 0.4, 1.2, 0xb8b2a4);
    jetty(k, 12, -D / 2, 3, 14, 0.8);
    for (let i = 0; i < 3; i++) boat(k, 15.5, -D / 2 - 4 - i * 3.4, Math.PI, 'pedal', [0xf2c230, 0x3a8ad8, 0xd8412f][i]);
    const p = path(k, [[-W / 2, -8], [-10, -9], [0, -7], [12, -9], [W / 2, -8]], 3, 0xd8ccb0);
    path(k, [[-4, D / 2], [-2, 4], [0, -7]], 2.2, 0xd8ccb0);
    // willows, café kiosk, benches facing the water, lamps
    tree(k, 'willow', -18, -12, 0.85);
    tree(k, themeTree(k.ctx, 'shade'), 18, 6, 0.9, 1, 1);
    tree(k, themeTree(k.ctx, 'shade'), -16, 8, 0.8, 2, 2);
    k.box('wood', 8, 0, 4, 5, 2.8, 3.4, 0xf4efe4, { top: false });
    k.hipRoof('roof_tile', 8, 2.8, 4, 5, 3.4, 1.2, 0x3f6f8a, 0.8);
    for (let i = 0; i < 3; i++) umbrella(k, 3 + i * 3, 0, [0xf4f4f0, 0x3f6f8a][i % 2], 1.1, 2.2);
    for (let i = 0; i < 4; i++) bench(k, -16 + i * 9, -11, Math.PI);
    lampsAlong(k, p, 10, 4, 'classic', -2);
    crowd(k, 0, -2, 36, 10, 10);
    return 8;
  },

  beach_promenade(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xe0d4bc, 0.2, 0.04);
    // sand beach sloping into the water at the back
    k.quad('sand', { x: -W / 2 + 0.2, y: 0.1, z: -2 }, { x: W / 2 - 0.2, y: 0.1, z: -2 }, { x: W / 2 - 0.2, y: -1.2, z: -D / 2 - 6 }, { x: -W / 2 + 0.2, y: -1.2, z: -D / 2 - 6 }, [[-W / 2, 2], [W / 2, 2], [W / 2, D / 2 + 6], [-W / 2, D / 2 + 6]], k.ctx.theme.sand, { x: 0, y: 1, z: 0 });
    // boardwalk promenade with railings, palms / theme trees, lamps
    k.box('wood', 0, 0, 2, W - 1, 0.35, 4, C.woodLight);
    k.box('metal', 0, 1.2, 0.1, W - 1, 0.06, 0.06, 0xf4f4f4);
    const tsp = k.ctx.theme.trees.includes('palm') ? 'palm' : themeTree(k.ctx, 'formal');
    for (let i = 0; i < 6; i++) tree(k, tsp, -28 + i * 11.2, 8, 0.8, i, i);
    lampsAlong(k, [[-W / 2 + 2, 4.4], [W / 2 - 2, 4.4]], 9, 4.4, 'classic', 0);
    // umbrellas + loungers, lifeguard tower, volleyball net
    const cols = [0xd8412f, 0x3a8ad8, 0xf2c230, 0x3fa05a, 0xf4f4f0];
    for (let i = 0; i < 8; i++) {
      const x = -26 + i * 7.4, z = -7 - (i % 2) * 4;
      umbrella(k, x, z, cols[i % cols.length], 1.4, 2.3);
      k.box('plain', x + 1.2, 0.1, z + 0.2, 0.7, 0.3, 1.9, 0xf4f4f4);
    }
    k.at(20, 0, -9, 0, () => {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as P2[]) k.box('wood', x, 0, z, 0.2, 3, 0.2, 0xf4f4f4);
      k.box('wood', 0, 3, 0, 2.6, 1.6, 2.6, 0xd8412f, { top: 'plain', topColor: 0xf4f4f4 });
      k.stairs(0, 2.6, 1, 3, 0xf4f4f4);
    });
    k.cyl('metal', -8, 0, -12, 0.05, 0.05, 2.4, 0x333333, 4);
    k.cyl('metal', 0, 0, -12, 0.05, 0.05, 2.4, 0x333333, 4);
    k.box('plain', -4, 1.6, -12, 8, 0.8, 0.03, 0xf4f4f4, { top: false });
    // kiosks
    for (const x of [-18, 16]) {
      k.box('wood', x, 0, 12, 5, 3, 3.4, 0xf4efe4, { top: false });
      k.hipRoof('roof_tile', x, 3, 12, 5, 3.4, 1.1, 0x2f6fa8, 0.7);
    }
    crowd(k, 0, -8, 56, 8, 18);
    return 9;
  },

  marina(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xcfc9bb, 0.2, 0.04);
    quay(k, 0, -D / 2 + 6, W - 1, 6, 0.4);
    // floating pontoons with finger piers + moored boats (over the water)
    const piers = 3;
    for (let p = 0; p < piers; p++) {
      const px = -20 + p * 20;
      k.box('wood', px, 0, -D / 2 - 14, 2.4, 0.5, 26, 0xd8ccb0);
      for (let f = 0; f < 5; f++) {
        const fz = -D / 2 - 4 - f * 5;
        for (const s of [-1, 1]) {
          k.box('wood', px + s * 4.4, 0, fz, 6.4, 0.45, 1.2, 0xd8ccb0);
          if (k.ctx.rng.chance(0.75)) boat(k, px + s * 5, fz - 2.4 * (s > 0 ? 1 : 1), s > 0 ? 0 : Math.PI, k.ctx.rng.pick(['yacht', 'sail', 'sail', 'fishing'] as const), 0xf4f4f4, -0.4);
        }
      }
      k.light(px, 1.2, -D / 2 - 27, 0x3fdf6a, 1.6, 'beacon', true);
    }
    // harbour master's office with tower + chandlery, masts & flags
    k.box('wall_plaster', -16, 0, 8, 14, 7, 8, 0xf4f2ec, { top: 'roof_flat' });
    k.box('wall_glass', -20, 7, 8, 5, 3.4, 5, 0xbcd6e4, { top: 'roof_metal', topColor: 0x2f5f8a });
    k.box('plain', -16, 5.6, 12.05, 14, 0.8, 0.1, 0x2f5f8a, { top: false });
    k.box('wall_wood', 10, 0, 10, 16, 4, 7, 0x2f5f8a, { top: false });
    k.gableRoof('roof_metal', 10, 4, 10, 16, 7, 1.6, 0xf4f4f0, { wallMat: 'wall_wood', wallColor: 0x2f5f8a, ridgeAlongX: true });
    k.cyl('metal', 24, 0, 2, 0.1, 0.07, 12, 0xf4f4f4, 5);
    k.light(24, 12.2, 2, 0xff3a2a, 2, 'beacon', true);
    parkedCars(k, -26, D / 2 - 3, 26, D / 2 - 3, 3, Math.PI / 2, 0.55);
    lampsAlong(k, [[-W / 2 + 2, -D / 2 + 7], [W / 2 - 2, -D / 2 + 7]], 10, 4.2, 'classic', 0);
    crowd(k, 0, -10, 40, 4, 10);
    return 18;
  },

  ski_resort(k) {
    const W = k.W, D = k.D;
    const snow = C.snow;
    k.lot('grass', lawnColor(k.ctx, 0.3), 0.2, 0.04);
    // piste: snowy slope rising to the back (on real terrain the slope adds more)
    const top = 34;
    const slope = (x0: number, x1: number, col: number, y = 0) => k.quad('sand', { x: x0, y: 0.15 + y, z: 6 }, { x: x1, y: 0.15 + y, z: 6 }, { x: x1, y: top + y, z: -D / 2 + 1 }, { x: x0, y: top + y, z: -D / 2 + 1 }, [[x0, 0], [x1, 0], [x1, 80], [x0, 80]], col, { x: 0, y: 1, z: 0.6 });
    slope(-W / 2 + 1, W / 2 - 1, 0xe8eef4);
    k.tri('concrete', { x: W / 2 - 1, y: 0, z: 6 }, { x: W / 2 - 1, y: top, z: -D / 2 + 1 }, { x: W / 2 - 1, y: 0, z: -D / 2 + 1 }, [0, 0], [1, 1], [1, 0], 0x8a8782, { x: 1, y: 0, z: 0 });
    k.tri('concrete', { x: -W / 2 + 1, y: 0, z: 6 }, { x: -W / 2 + 1, y: 0, z: -D / 2 + 1 }, { x: -W / 2 + 1, y: top, z: -D / 2 + 1 }, [0, 0], [1, 0], [1, 1], 0x8a8782, { x: -1, y: 0, z: 0 });
    k.wall('concrete', W / 2 - 1, -D / 2 + 1, -W / 2 + 1, -D / 2 + 1, 0, top, 0x8a8782);
    const onSlope = (x: number, z: number): number => ((6 - z) / (6 + D / 2 - 1)) * (top - 0.15) + 0.15;
    // groomed trail stripes + conifers along the piste edges
    if (!k.lo) for (let i = 0; i < 6; i++) {
      const x = -18 + i * 7;
      k.quad('sand', { x: x - 0.6, y: 0.2, z: 6 }, { x: x + 0.6, y: 0.2, z: 6 }, { x: x + 0.6, y: top + 0.05, z: -D / 2 + 1 }, { x: x - 0.6, y: top + 0.05, z: -D / 2 + 1 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xf6f9fc, { x: 0, y: 1, z: 0.6 });
    }
    const conifer = k.ctx.theme.trees.find((t) => t === 'spruce' || t === 'pine') ?? 'spruce';
    for (let i = 0; i < 10; i++) {
      const z = 2 - i * 4.6;
      for (const x of [W / 2 - 4, 22]) {
        k.pushTRS(0, onSlope(x, z), 0, 0);
        tree(k, conifer, x - (i % 2) * 2, z, 0.75, i, i);
        k.pop();
      }
    }
    // chairlift: bottom & top stations, pylons, cable, chairs
    const lx = -20;
    k.box('metal', lx, 0, 4, 4, 5, 5, 0xd8412f, { top: 'metal', topColor: 0x55585c });
    k.at(lx, onSlope(lx, -D / 2 + 5), -D / 2 + 5, 0, () => k.box('metal', 0, 0, 0, 4, 5, 5, 0xd8412f, { top: 'metal', topColor: 0x55585c }));
    const pyl = 5;
    const cab: V3[] = [];
    for (let i = 0; i <= pyl; i++) {
      const z = 4 - (i / pyl) * (D - 10);
      const y = onSlope(lx, z);
      if (i > 0 && i < pyl) {
        k.cyl('metal', lx, y, z, 0.35, 0.3, 9, 0x9aa0a6, 6);
        k.box('metal', lx, y + 9, z, 4.4, 0.4, 0.4, 0x9aa0a6);
      }
      cab.push([lx, y + 8.8, z]);
    }
    for (const s of [-2, 2]) k.polyPipe('metal', cab.map(([x, y, z]) => [x + s, y, z] as V3), 0.05, 0x222222, 3);
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.5) / 12;
      const z = 4 - t * (D - 10);
      const y = onSlope(lx, z) + 8.8;
      const sx = lx + (i % 2 ? 2 : -2);
      k.box('metal', sx, y - 2.2, z, 0.05, 2.2, 0.05, 0x333333);
      k.box('plain', sx, y - 2.6, z, 1.6, 0.4, 0.7, 0x2f5f8a);
    }
    // chalet lodge at the base
    k.box('wall_wood', 10, 0, 16, 22, 6.6, 12, 0x8a5a3a, { top: false });
    k.gableRoof('roof_shingle', 10, 6.6, 16, 22, 12, 5.5, 0x4a3a30, { overhang: 1.2, wallMat: 'wall_wood', wallColor: 0x8a5a3a, ridgeAlongX: true });
    k.gableRoof('sand', 10, 6.75, 16, 22.2, 12.2, 5.55, snow, { overhang: 1.25, ridgeAlongX: true, wallMat: 'wall_wood', wallColor: 0x8a5a3a });
    k.box('wood', 10, 3.3, 22.6, 22, 0.25, 1.6, C.woodDark);
    k.box('wall_stone', 18, 0, 13, 1.6, 12.5, 1.6, 0x8a8480, { top: 'concrete' });
    k.light(10, 5, 23, C.lampWarm, 6, 'lamp');
    const r = k.ctx.rng;
    for (let i = 0; i < 10; i++) {
      const x = r.range(-12, 18), z = r.range(-30, 4);
      k.pushTRS(0, onSlope(x, z), 0, 0);
      person(k, x, z, r.pick([0xd8412f, 0x3a8ad8, 0xf2c230, 0x222222]), r.range(2.5, 3.8));
      k.pop();
    }
    parkedCars(k, -20, D / 2 - 3, 0, D / 2 - 3, 2.8, Math.PI / 2, 0.8);
    return top + 10;
  },
};

export const PARK_MODELS = models(M);
