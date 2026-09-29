// Landmarks: unique, milestone-gated showpieces. Each is a recognisable,
// detailed procedural model (historic towers, cultural venues, sports bowls,
// record-breaking towers) with night floodlighting, beacons and animation.
import * as THREE from 'three';
import { Kit, type P2, type V3 } from './kit';
import { C, shade, mix, jitter, lawnColor, civicLook } from './colors';
import { models } from './define';
import { bench, boat, bus, car, crowd, fence, flagpole, flowerBed, foliageBlob, hedge, parkingLot, person, railCar, taxi, tree, treeGrove, themeTree, umbrella } from './props';
import { archVault, archWindow, clockFace, floodMast, jetty, lampsAlong, lancet, portico, quay, roseWindow, spire, statueFigure } from './arch';
import { fountain } from './plazas';
import { path, pond } from './parks';
import { track } from './transit';

// ── shared bits ────────────────────────────────────────────────────────────
/** paved plaza lot with a darker border */
export function plaza(k: Kit, color: number = C.pavingWarm, border = 0xbdb4a2): void {
  k.lot('paving', border, 0.2, 0.05);
  k.slab('paving', 0, 0, k.W - 2.4, k.D - 2.4, 0.08, color, 0.1);
}

/** night floodlight: a small ground fixture plus a wide glow on the facade */
export function flood(k: Kit, x: number, z: number, y: number, size: number, color = 0xfff0d6): void {
  if (!k.lo) k.box('metal', x, 0.05, z, 0.5, 0.3, 0.5, 0x2a2e33);
  k.light(x, y, z, color, size, 'flood');
}

/** crenellated battlement (merlons) along a straight edge from a to b at height y */
function merlons(k: Kit, a: P2, b: P2, y: number, color: number, t = 0.7, mw = 1.2, mh = 1.3, pitch = 2.4): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.floor(len / pitch));
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    k.rbox('plain', a[0] + (b[0] - a[0]) * f, y, a[1] + (b[1] - a[1]) * f, mw, mh, t, ang, color);
  }
}

/** round tower with machicolations and either a conical roof or merlons. Returns top. */
function roundTower(k: Kit, x: number, z: number, r: number, y0: number, h: number, stone: number, roof: 'cone' | 'battlement', roofColor: number): number {
  const s = k.seg(14);
  k.cyl('plain', x, y0, z, r * 1.06, r, h, stone, s, false);
  k.cyl('plain', x, y0 + h - 1.6, z, r + 0.55, r + 0.55, 1.6, shade(stone, 1.05), s, true);
  if (!k.lo) for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.at(x + Math.cos(a) * (r + 0.02), 0, z + Math.sin(a) * (r + 0.02), Math.PI / 2 - a, () => k.box('plain', 0, y0 + h * 0.55, 0, 0.35, 1.6, 0.1, 0x1c1a18));
  }
  const top = y0 + h;
  if (roof === 'cone') {
    k.rev('roof_tile', x, top, z, [[r + 0.9, 0], [r * 0.55, r * 1.1], [0.05, r * 2.3]], roofColor, s, { bottom: true, crease: 20 });
    k.cyl('metal', x, top + r * 2.3, z, 0.08, 0.05, 2.2, 0x333333, 4);
    k.box('plain', x + 0.5, top + r * 2.3 + 1.2, z, 1.0, 0.7, 0.05, C.red);
    return top + r * 2.3 + 2.2;
  }
  const n = Math.max(8, Math.round((Math.PI * 2 * (r + 0.4)) / 2.2));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.rbox('plain', x + Math.cos(a) * (r + 0.25), top, z + Math.sin(a) * (r + 0.25), 1.1, 1.3, 0.6, Math.PI / 2 - a, stone);
  }
  return top + 1.3;
}

/** points of a rounded rectangle (half extents a, b, corner radius rc), fixed vertex count */
export function roundRect(a: number, b: number, rc: number, ns: number, nc: number): P2[] {
  const pts: P2[] = [];
  const corners: [number, number, number][] = [[a - rc, b - rc, 0], [-(a - rc), b - rc, Math.PI / 2], [-(a - rc), -(b - rc), Math.PI], [a - rc, -(b - rc), Math.PI * 1.5]];
  for (let c = 0; c < 4; c++) {
    const [cx, cz, a0] = corners[c];
    for (let i = 0; i < nc; i++) {
      const t = a0 + (i / nc) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * rc, cz + Math.sin(t) * rc]);
    }
    const [nx, nz] = corners[(c + 1) % 4];
    const ex = cx + Math.cos(a0 + Math.PI / 2) * rc, ez = cz + Math.sin(a0 + Math.PI / 2) * rc;
    const fx = nx + Math.cos(a0 + Math.PI / 2) * rc, fz = nz + Math.sin(a0 + Math.PI / 2) * rc;
    for (let i = 0; i < ns; i++) pts.push([ex + ((fx - ex) * i) / ns, ez + ((fz - ez) * i) / ns]);
  }
  return pts;
}

/** loft a band between two closed loops (same vertex count) at heights y0 / y1,
 *  facing towards (0, *, 0) when `inward`, else away from it */
function loopBand(k: Kit, mat: 'plain' | 'glass' | 'wall_glass' | 'metal' | 'neon' | 'emissive' | 'concrete' | 'roof_metal', L0: P2[], y0: number, L1: P2[], y1: number, color: number, inward: boolean, both = false): void {
  const n = L0.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = { x: L0[i][0], y: y0, z: L0[i][1] }, b = { x: L0[j][0], y: y0, z: L0[j][1] };
    const c = { x: L1[j][0], y: y1, z: L1[j][1] }, d = { x: L1[i][0], y: y1, z: L1[i][1] };
    const mx = (a.x + b.x + c.x + d.x) / 4, mz = (a.z + b.z + c.z + d.z) / 4;
    const l = Math.hypot(mx, mz) || 1;
    // facing: horizontal component towards/away from the centre, plus the tier's upward tilt
    const up = Math.hypot(L1[i][0], L1[i][1]) > Math.hypot(L0[i][0], L0[i][1]) === inward ? 0.6 : -0.6;
    const f = { x: ((inward ? -1 : 1) * mx) / l, y: y1 !== y0 ? up : 0, z: ((inward ? -1 : 1) * mz) / l };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const uv: [[number, number], [number, number], [number, number], [number, number]] = [[u, y0], [u + len, y0], [u + len, y1], [u, y1]];
    k.quad(mat, a, b, c, d, uv, color, f);
    if (both) k.quad(mat, a, b, c, d, uv, shade(color, 0.8), { x: -f.x, y: -f.y, z: -f.z });
    u += len;
  }
}

/** vertical wall along a polyline whose top follows yTop(x, z) */
function profileWall(k: Kit, mat: 'wall_glass' | 'wall_industrial' | 'plain' | 'glass', a: P2, b: P2, n: number, yTop: (x: number, z: number) => number, color: number, facing: V3): void {
  let u = 0;
  for (let i = 0; i < n; i++) {
    const x0 = a[0] + ((b[0] - a[0]) * i) / n, z0 = a[1] + ((b[1] - a[1]) * i) / n;
    const x1 = a[0] + ((b[0] - a[0]) * (i + 1)) / n, z1 = a[1] + ((b[1] - a[1]) * (i + 1)) / n;
    const h0 = yTop(x0, z0), h1 = yTop(x1, z1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    k.quad(mat, { x: x0, y: 0, z: z0 }, { x: x1, y: 0, z: z1 }, { x: x1, y: h1, z: z1 }, { x: x0, y: h0, z: z0 }, [[u, 0], [u + len, 0], [u + len, h1], [u, h0]], color, { x: facing[0], y: facing[1], z: facing[2] });
    u += len;
  }
}

/** meridian + hoop ribs over a surface of revolution (profile prof, elliptical sx/sz) */
export function revRibs(k: Kit, cx: number, y0: number, cz: number, prof: P2[], sx: number, sz: number, meridians: number, hoops: number[], color: number, w = 0.35, off = 0.12): void {
  const P = (t: number, r: number, y: number): V3 => [cx + Math.cos(t) * (r + off) * sx, y0 + y, cz + Math.sin(t) * (r + off) * sz];
  for (let m = 0; m < meridians; m++) {
    const t = (m / meridians) * Math.PI * 2;
    for (let j = 0; j < prof.length - 1; j++) k.beam('metal', P(t, prof[j][0], prof[j][1]), P(t, prof[j + 1][0], prof[j + 1][1]), w, w, color);
  }
  const segs = k.seg(28);
  for (const j of hoops) {
    const [r, y] = prof[j];
    for (let i = 0; i < segs; i++) k.beam('metal', P((i / segs) * Math.PI * 2, r, y), P(((i + 1) / segs) * Math.PI * 2, r, y), w, w, color);
  }
}

/** Gardens-by-the-Bay style "supertree": vine-clad trunk with a funnel canopy that glows at night */
function supertree(k: Kit, x: number, z: number, h: number, glow: number): void {
  const s = k.seg(12);
  k.rev('concrete', x, 0, z, [[1.8, 0], [1.2, h * 0.3], [1.0, h * 0.7], [1.5, h * 0.82]], 0x6a6258, s, { crease: 60 });
  const r = k.ctx.rng;
  if (!k.lo) for (let i = 0; i < 7; i++) {
    const a = r.range(0, Math.PI * 2), y = r.range(1.5, h * 0.78);
    foliageBlob(k, x + Math.cos(a) * 1.1, y, z + Math.sin(a) * 1.1, 1.2, 1.8, 1.2, r.pick([0x3f7a3a, 0x5a8a3a, 0x7a3a6a, 0x4a6a2a]), i + x, 0.3, 0);
  }
  const R = h * 0.42;
  const prof: P2[] = [[1.5, h * 0.8], [R * 0.45, h * 0.9], [R, h]];
  k.rev('metal', x, 0, z, prof, 0x5a3f6a, s, { crease: 60 });
  k.rev('metal', x, 0, z, prof, 0x3f2f4a, s, { crease: 60, inside: true });
  k.torus('neon', x, h, z, R, 0.18, glow, s, 4);
  const n = k.lo ? 4 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.beam('metal', [x + Math.cos(a) * 1.4, h * 0.8, z + Math.sin(a) * 1.4], [x + Math.cos(a) * R, h, z + Math.sin(a) * R], 0.12, 0.12, 0x6a4a7a);
    k.light(x + Math.cos(a) * R, h, z + Math.sin(a) * R, glow, 3.4, 'neon');
  }
  k.light(x, h * 0.9, z, glow, R * 1.4, 'neon');
}

/** Sydney-style shell: pointed-arch cross-section rising to a tip at the open +Z front. */
function shell(k: Kit, x: number, y0: number, z: number, rotY: number, B: number, L: number, H: number, color: number, glass: number): number {
  const nu = k.seg(14), nv = k.seg(12);
  const P = (s: number, t: number): V3 => {
    const e = Math.sin((s * Math.PI) / 2);
    const hr = H * Math.pow(e, 0.85);
    const w = B * (0.35 + 0.65 * e);
    const u = t * 2 - 1;
    const yy = hr * (1 - Math.pow(Math.abs(u), 1.45));
    const lean = (yy / H) * L * 0.18 * s;
    return [u * w, yy, -L / 2 + s * L + lean];
  };
  k.at(x, y0, z, rotY, () => {
    k.surface('plain', nv, nu, (s, t) => P(s, t), color, true);
    // glazed front: fan from the base centre, bronze mullions
    const n = nu;
    const zf = L / 2;
    for (let i = 0; i < n; i++) {
      const a = P(1, i / n), b = P(1, (i + 1) / n);
      k.tri('wall_glass', { x: 0, y: 0, z: zf - 1.5 }, { x: a[0], y: a[1], z: a[2] - 0.4 }, { x: b[0], y: b[1], z: b[2] - 0.4 }, [0, 0], [a[0], a[1]], [b[0], b[1]], glass, { x: 0, y: 0.2, z: 1 });
    }
    if (!k.lo) {
      for (let i = 1; i < 8; i++) {
        const a = P(1, i / 8);
        k.beam('metal', [a[0] * 0.98, 0, zf - 1.5 + (a[2] - zf + 1.1) * 0.02], [a[0], a[1] - 0.3, a[2] - 0.45], 0.18, 0.18, 0x5a4a38);
      }
      // ridge rib
      const pts: V3[] = [];
      for (let j = 0; j <= 8; j++) { const p = P(j / 8, 0.5); pts.push([p[0], p[1] + 0.12, p[2]]); }
      k.polyPipe('plain', pts, 0.22, shade(color, 0.93), 5);
    }
    k.light(0, H * 0.35, zf + 1, 0xffe4b8, H * 0.8, 'lamp');
  });
  return y0 + H;
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  // ── Clock tower (campanile) ─────────────────────────────────────────────
  clock_tower(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    plaza(k, 0xd6ccb8, 0xb8ae9c);
    const brick = look.wall === 'wall_brick' || k.rnd() < 0.5;
    const body = brick ? mix(look.wallColor, C.brick, 0.65) : mix(look.wallColor, C.limestone, 0.55);
    const trim = brick ? 0xe6dcc6 : shade(body, 1.1);
    const S = 7.6, tz = -3, base = 1.6;
    k.box('plain', 0, 0, tz, S + 1.8, base, S + 1.8, 0xa9a397, { top: 'paving', topColor: 0xbfb8aa });
    k.stairs(0, tz + (S + 1.8) / 2 + 2.9, 4, base, 0xb2ab9d, 0.18, 0.32);
    const shaftTop = 36;
    k.box('plain', 0, base, tz, S, shaftTop - base, S, body, { top: false });
    // corner lesenes + string courses
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('plain', sx * (S / 2 - 0.45), base, tz + sz * (S / 2 - 0.45), 1.15, shaftTop - base, 1.15, shade(body, 0.94), { top: false });
    for (let y = base + 8.6; y < shaftTop - 2; y += 8.6) k.box('plain', 0, y, tz, S + 0.5, 0.45, S + 0.5, trim);
    for (let s = 0; s < 4; s++)
      k.at(0, 0, tz, (s * Math.PI) / 2, () => {
        for (const y of [11, 19.5, 28]) archWindow(k, 0, y, S / 2 + 0.6, 0.8, 2.2, trim, 0x1f2428);
        if (s === 0) archWindow(k, 0, base, S / 2 + 0.6, 2.2, 3.8, trim, 0x4a3222, 'wood');
      });
    // clock stage
    const cs = S + 0.9;
    k.box('plain', 0, shaftTop - 0.6, tz, cs + 0.6, 0.6, cs + 0.6, trim);
    k.box('plain', 0, shaftTop, tz, cs, 7, cs, body, { top: 'plain', topColor: trim });
    for (let s = 0; s < 4; s++) k.at(0, 0, tz, (s * Math.PI) / 2, () => clockFace(k, 0, shaftTop + 3.6, cs / 2 + 0.02, 2.5, C.gold, 1.2 + s * 0.02, -0.5));
    // open belfry: corner piers, twin arches per face, bell
    const by = shaftTop + 7.4, bh = 6.6;
    k.box('plain', 0, shaftTop + 7, tz, cs + 0.5, 0.4, cs + 0.5, trim);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('plain', sx * (S / 2 - 0.9), by, tz + sz * (S / 2 - 0.9), 1.8, bh, 1.8, body, { top: false });
    for (let s = 0; s < 4; s++)
      k.at(0, 0, tz, (s * Math.PI) / 2, () => {
        for (const sx of [-1, 1]) archVault(k, sx * 1.05, S / 2 - 0.9, 1.9, 1.8, by + 3.6, by + bh - 0.2, 'plain', body, 0x3a3430);
        k.box('plain', 0, by + 3.6, S / 2 - 0.9, 0.3, bh - 3.8, 1.8, body);
        k.cyl('plain', 0, by, S / 2 - 0.9, 0.2, 0.18, 3.6, trim, 6);
      });
    k.box('plain', 0, by + bh - 0.2, tz, S, 1.0, S, body, { bottom: true, top: false });
    k.rev('metal', 0, by + 1.2, tz, [[1.3, 0], [1.15, 0.35], [0.85, 1.2], [0.8, 1.7], [0.5, 2.05], [0, 2.15]], C.bronze, k.seg(12), { crease: 70 });
    k.box('wood', 0, by + 3.4, tz, 3.4, 0.35, 0.4, C.woodDark);
    k.light(0, by + 2, tz, C.lampWarm, 5, 'lamp');
    // cornice + pyramidal roof + finial
    const ry = by + bh + 0.8;
    k.box('plain', 0, ry - 0.5, tz, S + 1.3, 0.55, S + 1.3, trim);
    const roofC = brick ? C.terracotta : C.copper;
    k.pyramid(brick ? 'roof_tile' : 'roof_metal', 0, ry, tz, S + 0.6, S + 0.6, 7.2, roofC);
    k.ball('metal', 0, ry + 7.4, tz, 0.35, C.gold, 8, 5);
    k.cyl('metal', 0, ry + 7.6, tz, 0.07, 0.05, 2.4, 0x333333, 4);
    k.box('metal', 0.5, ry + 9.1, tz, 1.1, 0.5, 0.05, C.gold);
    const top = ry + 10;
    // piazza: lawns, trees, benches, lamps, floodlights
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const cx = sx * (W / 2 - 6.5), cz = sz * (D / 2 - 6.5);
        k.slab('grass', cx, cz, 9, 9, 0.1, lawnColor(k.ctx, 0.7), 0.1);
        hedge(k, cx, cz + sz * 4.2, 9, 0.7, 0.8);
        tree(k, themeTree(k.ctx, 'shade'), cx, cz, 0.75, sx + sz, 1);
        if (!k.lo) flowerBed(k, cx - sx * 2.6, cz - sz * 2.6, 2.4, 1.2);
      }
    for (const sx of [-1, 1]) {
      bench(k, sx * 7.5, tz, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      bench(k, sx * 3.5, 9, Math.PI);
    }
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 9, 4.2, 'classic', 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) flood(k, sx * 6.5, tz + sz * 6.5, 14, 16, 0xffe8c8);
    crowd(k, 0, 10, 20, 6, 7);
    return top;
  },

  // ── Lighthouse ──────────────────────────────────────────────────────────
  lighthouse(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    k.lot('grass', lawnColor(k.ctx, 0.25), 0.2, 0.05);
    // rocky shore towards the sea (−Z)
    for (let i = 0; i < (k.lo ? 8 : 18); i++) {
      const x = r.range(-W / 2 + 1, W / 2 - 1), z = -D / 2 + r.range(0.5, 5.5);
      k.ball('concrete', x, r.range(-1.2, 0.2), z, r.range(1.0, 2.4), jitter(0x8f8a82, () => r.next(), 0.12), 7, 5, 0.65);
    }
    path(k, [[-2, D / 2], [-3, 8], [0, 3], [3, -0.5]], 1.8, 0xc9bda5);
    const tx = 4, tz = -4;
    // tower: tapered, red and white bands
    k.cyl('plain', tx, 0, tz, 5, 5, 1.4, 0xb4ada2, k.seg(16));
    const H = 32, r0 = 3.7, r1 = 2.4, bands = 6;
    for (let i = 0; i < bands; i++) {
      const y0 = 1.4 + ((H - 1.4) * i) / bands, y1 = 1.4 + ((H - 1.4) * (i + 1)) / bands;
      const ra = r0 + (r1 - r0) * ((y0 - 1.4) / (H - 1.4)), rb = r0 + (r1 - r0) * ((y1 - 1.4) / (H - 1.4));
      k.cyl('plain', tx, y0, tz, ra, rb, y1 - y0, i % 2 ? C.red : 0xf4f2ec, k.seg(18), false);
    }
    for (const y of [8, 15, 22]) {
      const rr = r0 + (r1 - r0) * ((y - 1.4) / (H - 1.4));
      k.at(tx, 0, tz, 0.7 + y * 0.1, () => k.box('glass', 0, y, rr - 0.1, 0.7, 1.2, 0.3, 0x2a3440, { top: false }));
    }
    k.at(tx, 0, tz, 0, () => archWindow(k, 0, 1.4, r0 - 0.05, 1.3, 2.4, 0xf4f2ec, 0x3a2a1e, 'wood'));
    // gallery + railing
    k.cyl('concrete', tx, H, tz, 3.9, 3.9, 0.45, 0x2e3236, k.seg(18));
    k.torus('metal', tx, H + 1.4, tz, 3.8, 0.06, 0x2e3236, k.seg(18), 3);
    if (!k.lo) for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      k.cyl('metal', tx + Math.cos(a) * 3.8, H + 0.45, tz + Math.sin(a) * 3.8, 0.05, 0.05, 0.95, 0x2e3236, 3, false);
    }
    // lantern room: open mullions around a rotating Fresnel lens
    const ly = H + 0.45;
    k.cyl('plain', tx, ly, tz, 2.2, 2.2, 1.0, 0x2e3236, k.seg(14));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.box('metal', tx + Math.cos(a) * 2.0, ly + 1, tz + Math.sin(a) * 2.0, 0.14, 3.2, 0.14, 0x2e3236);
    }
    k.torus('metal', tx, ly + 2.6, tz, 2.0, 0.05, 0x2e3236, k.seg(14), 3);
    k.anim([tx, ly + 2.5, tz], [0, 1, 0], 1.1, (s) => {
      s.cyl('emissive', tx, ly + 1.4, tz, 0.9, 0.9, 2.3, 0xfff2c0, 10);
      for (const sx of [-1, 1]) s.box('emissive', tx + sx * 0.98, ly + 1.6, tz, 0.12, 1.8, 1.4, 0xfff8d8);
      s.box('metal', tx, ly + 1.3, tz, 0.4, 0.2, 2.4, 0x3a3e42);
    });
    k.light(tx, ly + 2.5, tz, 0xfff2c8, 18, 'beacon', true);
    k.light(tx, ly + 2.5, tz, 0xffe8b0, 5, 'lamp');
    k.dome('roof_metal', tx, ly + 4.2, tz, 2.4, C.red, k.seg(14), 0.75);
    k.ball('metal', tx, ly + 6.1, tz, 0.4, 0x2e3236, 8, 5);
    k.cyl('metal', tx, ly + 6.4, tz, 0.06, 0.04, 2.4, 0x333333, 4);
    const top = ly + 8.8;
    // keeper's cottage with picket fence
    const hx = -8, hz = 7;
    k.box('wall_plaster', hx, 0, hz, 9, 3.6, 6, 0xf2efe6, { top: false });
    k.gableRoof('roof_tile', hx, 3.6, hz, 9, 6, 2.6, C.red, { overhang: 0.4, wallMat: 'wall_plaster', wallColor: 0xf2efe6 });
    k.box('plain', hx + 2.5, 3.6, hz - 1, 0.9, 3.2, 0.9, 0xb0a898);
    k.box('wall_plaster', hx + 6, 0, hz + 0.5, 3.4, 2.8, 4, 0xe8e4da, { top: false });
    k.shedRoof('roof_tile', hx + 6, 2.8, hz + 0.5, 3.4, 4, 0.8, C.red);
    k.light(hx, 2.6, hz + 3.3, C.lampWarm, 2.4, 'lamp');
    fence(k, [[hx - 6, hz - 4.5], [hx - 6, hz + 5], [hx + 9, hz + 5]], 1.0, 0xf4f4f0, 1.4, 'wood');
    // jetty with a sailing boat
    jetty(k, -10, -D / 2 + 6, 2.6, 9);
    boat(k, -6.5, -D / 2 - 1, Math.PI / 2, 'sail', 0xf4f4f4, -0.2);
    bench(k, 0, 10, Math.PI);
    flood(k, tx + 5.5, tz + 5.5, 12, 14, 0xfff4e0);
    person(k, 1, 12, 0x2f5fa8, 0.3);
    return top;
  },

  // ── Triumphal arch ─────────────────────────────────────────────────────
  city_gate(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const stone = mix(0xe6dcc6, look.wallColor, 0.18);
    const dark = shade(stone, 0.82);
    plaza(k, 0xcfc6b4, 0xb4ab98);
    // avenue through the arch
    k.flat('asphalt', 0, 0, 9, D - 0.6, 0.1, C.asphalt);
    if (!k.lo) for (let z = -D / 2 + 2; z < D / 2 - 2; z += 4) k.flat('plain', 0, z, 0.2, 2, 0.12, C.paint);
    const HW = 15, HD = 6, span = 10, spring = 13.5, crown = spring + span / 2;
    // piers with transverse passages
    for (const sx of [-1, 1]) {
      const px = sx * (HW - (HW - span / 2) / 2), pw = HW - span / 2;
      for (const sz of [-1, 1]) k.box('plain', px, 0, sz * (HD - 1.75), pw, crown, 3.5, stone, { top: false });
      k.box('plain', px, 9, 0, pw, crown - 9, 5, stone, { top: false, bottom: true });
      k.at(px, 0, 0, Math.PI / 2, () => archVault(k, 0, 0, 5, pw, 6.5, 9, 'plain', stone));
      // relief panels and sculpture groups on the front and back faces
      for (const sz of [-1, 1])
        k.at(px, 0, 0, sz > 0 ? 0 : Math.PI, () => {
          k.box('plain', 0, 0, HD + 0.9, pw + 0.8, 1.6, 1.8, dark);
          k.box('plain', 0, 1.6, HD + 0.9, pw * 0.6, 1.8, 1.4, stone);
          statueFigure(k, -0.9, 3.4, HD + 0.9, 2.1, dark, 0.2, 'raise');
          statueFigure(k, 0.9, 3.4, HD + 0.9, 1.9, dark, -0.3);
          k.box('plain', 0, 10.5, HD + 0.08, pw - 2, 2.2, 0.3, dark);
        });
    }
    archVault(k, 0, 0, span, HD * 2, spring, crown, 'plain', stone);
    // entablature, frieze, attic with shields and inscription
    k.box('plain', 0, crown, 0, HW * 2, 7, HD * 2, stone, { top: false });
    k.box('plain', 0, crown + 1.4, 0, HW * 2 + 0.3, 1.6, HD * 2 + 0.3, dark);
    k.box('plain', 0, crown + 7, 0, HW * 2 + 1.4, 0.9, HD * 2 + 1.4, shade(stone, 1.05));
    const ay = crown + 7.9;
    k.box('plain', 0, ay, 0, HW * 2, 5.2, HD * 2, stone, { top: 'roof_flat', topColor: 0x8a8578 });
    k.box('plain', 0, ay + 5.2, 0, HW * 2 + 0.6, 0.5, HD * 2 + 0.6, shade(stone, 1.05));
    for (const sz of [-1, 1])
      k.at(0, 0, 0, sz > 0 ? 0 : Math.PI, () => {
        k.box('plain', 0, ay + 1.6, HD + 0.05, 12, 2, 0.2, dark);
        if (!k.lo) for (let i = 0; i < 14; i++) k.box('metal', -5.2 + i * 0.8, ay + 2.2, HD + 0.2, 0.45, 0.8, 0.06, C.gold);
        for (let i = 0; i < 6; i++) {
          const sx = -HW + 2 + i * ((HW * 2 - 4) / 5);
          if (Math.abs(sx) < 7) continue;
          k.push(new THREE.Matrix4().makeTranslation(sx, ay + 2.6, HD + 0.1).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
          k.cylinder('plain', 0, 0, 0, 1.1, 1.1, 0.25, dark, 12, { top: true });
          k.pop();
        }
      });
    // quadriga-like group and flags on top
    const gy = ay + 5.7;
    k.box('plain', 0, gy, 0, 8, 1.2, 4, dark);
    statueFigure(k, 0, gy + 1.2, 0, 2.6, C.bronze, 0, 'rider');
    statueFigure(k, -2.8, gy + 1.2, 0.4, 2.3, C.bronze, 0.3, 'raise');
    statueFigure(k, 2.8, gy + 1.2, 0.4, 2.3, C.bronze, -0.3, 'stand');
    for (const sx of [-1, 1]) flagpole(k, sx * (HW - 1), 0, 3, 0xd8272f, 0xf4f4f4);
    for (const sx of [-1, 1]) k.at(0, gy - 0.5, 0, 0, () => flagpole(k, sx * (HW - 1.2), HD - 1.2, 5, 0x2f5fa8, 0xf4f4f4));
    // eternal flame + lamps + floodlights
    k.box('metal', 0, 0.1, HD + 4.5, 1.6, 0.35, 1.6, C.bronze);
    k.rev('emissive', 0, 0.45, HD + 4.5, [[0.35, 0], [0.2, 0.5], [0, 0.9]], 0xffa040, 8);
    k.light(0, 0.9, HD + 4.5, 0xffa040, 2.5, 'lamp');
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [-6, D / 2 - 1.5]], 7, 4.4, 'classic', 0);
    lampsAlong(k, [[6, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 7, 4.4, 'classic', 0);
    for (const sx of [-1, 0.001, 1]) for (const sz of [-1, 1]) flood(k, sx * 9, sz * (HD + 3), 12, 22, 0xffe6c0);
    k.light(0, spring, 0, 0xffe0b0, 8, 'lamp');
    for (const sx of [-1, 1]) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 3), D / 2 - 5, 0.8, sx);
    crowd(k, 0, D / 2 - 5, W - 10, 4, 8);
    return gy + 1.2 + 2.6 * 3;
  },

  // ── Hilltop castle ──────────────────────────────────────────────────────
  castle(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    const lawn = lawnColor(k.ctx, 0.35);
    const stone = jitter(0xb5ad9b, () => r.next(), 0.05);
    const slate = r.pick([0x3e4650, 0x4a3f3a, 0x2f3b4a]);
    k.lot('grass', lawn, 0.2, 0.05);
    const Y0 = 2.4;
    k.rev('grass', 0, 0, 0, [[W / 2 - 0.4, 0.04], [W / 2 - 4, 1.2], [W / 2 - 9, 2.2], [0, Y0]], lawn, k.seg(24), { crease: 60 });
    // courtyard
    const S = 26;
    k.slab('dirt', 0, 0, S * 2 - 3, S * 2 - 3, Y0 + 0.06, mix(0x9a8a6a, C.gravel, 0.4), 0.3);
    // curtain walls (with a gate gap at the front)
    const wh = 11, wt = 2.4, wy = -1;
    const top = Y0 + wh;
    k.box('plain', 0, wy, -S, S * 2, top - wy, wt, stone);
    k.box('plain', -S, wy, 0, wt, top - wy, S * 2, stone);
    k.box('plain', S, wy, 0, wt, top - wy, S * 2, stone);
    for (const sx of [-1, 1]) k.box('plain', sx * (S + 4) / 2, wy, S, S - 4, top - wy, wt, stone);
    const mc = shade(stone, 1.04);
    merlons(k, [-S, -S - wt / 2 + 0.35], [S, -S - wt / 2 + 0.35], top, mc);
    merlons(k, [-S - wt / 2 + 0.35, S], [-S - wt / 2 + 0.35, -S], top, mc);
    merlons(k, [S + wt / 2 - 0.35, -S], [S + wt / 2 - 0.35, S], top, mc);
    for (const sx of [-1, 1]) merlons(k, [sx * S, S + wt / 2 - 0.35], [sx * 4, S + wt / 2 - 0.35], top, mc);
    // corner towers
    let peak = 0;
    const cones = [r.chance(0.8), r.chance(0.8), r.chance(0.35), r.chance(0.35)];
    [[-S, S], [S, S], [-S, -S], [S, -S]].forEach(([x, z], i) => {
      peak = Math.max(peak, roundTower(k, x, z, 4.6, wy, top - wy + 6, stone, cones[i] ? 'cone' : 'battlement', slate));
    });
    // gatehouse: twin drum towers, vaulted gate, portcullis, drawbridge
    for (const sx of [-1, 1]) roundTower(k, sx * 5.6, S + 0.8, 3.6, wy, top - wy + 3, stone, 'battlement', slate);
    k.box('plain', 0, wy, S + 0.8, 7.4, Y0 + 6.2 - wy, 1, stone);
    for (const sx of [-1, 1]) k.box('plain', sx * 3.1, wy, S + 0.8, 1.2, Y0 + 4 - wy, 6, stone, { top: false });
    archVault(k, 0, S + 0.8, 5, 6, Y0 + 4, Y0 + 6.6, 'plain', stone, 0x4a4540);
    k.box('plain', 0, Y0 + 6.6, S + 0.8, 7.4, top - Y0 - 4.6, 6, stone);
    merlons(k, [-3.7, S + 3.8], [3.7, S + 3.8], top + 2, mc);
    if (!k.lo) {
      for (let i = -2; i <= 2; i++) k.box('metal', i * 0.95, Y0 + 3, S + 3.5, 0.14, 3.5, 0.14, 0x2a2622);
      for (let j = 0; j < 3; j++) k.box('metal', 0, Y0 + 3.4 + j * 1.1, S + 3.5, 4.4, 0.14, 0.14, 0x2a2622);
    }
    k.beam('wood', [0, Y0 + 0.1, S + 4.2], [0, 0.6, S + 10.5], 4.2, 0.45, C.wood, true);
    for (const sx of [-1, 1]) k.pipe('metal', [sx * 2, Y0 + 6, S + 4], [sx * 2, 0.9, S + 10.2], 0.06, 0x2a2622, 3);
    // banners
    for (const sx of [-1, 1]) {
      k.box('plain', sx * 10, top - 5.5, S + wt / 2 + 0.06, 1.8, 5, 0.08, r.pick([0xa0202a, 0x1f3f8a]), { top: false });
      k.box('plain', sx * 10, top - 5.2, S + wt / 2 + 0.1, 0.4, 4.6, 0.04, C.gold, { top: false });
    }
    // keep with corner turrets
    const kx = 0, kz = -8, ks = 15, kh = 26;
    k.box('plain', kx, wy, kz, ks, Y0 + kh - wy, ks, shade(stone, 1.03), { top: 'roof_flat', topColor: 0x6a655c });
    for (let s = 0; s < 4; s++)
      k.at(kx, 0, kz, (s * Math.PI) / 2, () => {
        for (const y of [Y0 + 8, Y0 + 15, Y0 + 21]) for (const x of [-3.5, 0, 3.5]) archWindow(k, x, y, ks / 2 + 0.03, 0.9, 2.2, shade(stone, 1.1), 0x1c1a18, 'plain');
      });
    const kt = Y0 + kh;
    merlons(k, [kx - ks / 2, kz + ks / 2 - 0.3], [kx + ks / 2, kz + ks / 2 - 0.3], kt, mc);
    merlons(k, [kx - ks / 2, kz - ks / 2 + 0.3], [kx + ks / 2, kz - ks / 2 + 0.3], kt, mc);
    merlons(k, [kx - ks / 2 + 0.3, kz - ks / 2], [kx - ks / 2 + 0.3, kz + ks / 2], kt, mc);
    merlons(k, [kx + ks / 2 - 0.3, kz - ks / 2], [kx + ks / 2 - 0.3, kz + ks / 2], kt, mc);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) peak = Math.max(peak, roundTower(k, kx + sx * (ks / 2), kz + sz * (ks / 2), 1.8, kt - 6, 10, stone, 'cone', slate));
    k.cyl('metal', kx, kt, kz, 0.1, 0.08, 12, 0x333333, 4);
    k.box('plain', kx + 1.6, kt + 9, kz, 3.0, 1.9, 0.06, 0xa0202a);
    k.box('plain', kx + 1.6, kt + 9.6, kz + 0.02, 3.0, 0.5, 0.06, C.gold);
    peak = Math.max(peak, kt + 12);
    // great hall + chapel inside the bailey
    k.box('plain', -S + 7, Y0, 6, 9, 9, 20, shade(stone, 1.06), { top: false });
    k.gableRoof('roof_tile', -S + 7, Y0 + 9, 6, 9, 20, 5, slate, { overhang: 0.4, ridgeAlongX: false, wallMat: 'plain', wallColor: shade(stone, 1.06) });
    k.at(-S + 11.55, 0, 6, Math.PI / 2, () => { for (const z of [-6, -2, 2, 6]) archWindow(k, z, Y0 + 2.5, 0, 1.2, 4.2, 0xd8d0c0, 0x2a2e3a); });
    k.box('plain', S - 7, Y0, 10, 8, 7, 12, shade(stone, 1.08), { top: false });
    k.gableRoof('roof_tile', S - 7, Y0 + 7, 10, 8, 12, 4, slate, { overhang: 0.4, ridgeAlongX: false, wallMat: 'plain', wallColor: shade(stone, 1.08) });
    spire(k, S - 7, Y0 + 11, 15, 1.1, 6, slate, 'roof_tile', true);
    // well
    k.cyl('plain', 8, Y0, 12, 1.1, 1.1, 0.9, stone, 10);
    k.disc('water', 8, Y0 + 0.8, 12, 0.85, 0x2f5a66, 10);
    for (const sx of [-1, 1]) k.box('wood', 8 + sx * 0.9, Y0 + 0.9, 12, 0.14, 1.6, 0.14, C.woodDark);
    k.gableRoof('roof_tile', 8, Y0 + 2.5, 12, 2.2, 2.2, 0.8, slate, { overhang: 0.2 });
    // winding approach, trees, torches
    path(k, [[3, D / 2 - 0.5], [8, D / 2 - 4], [2, S + 11]], 3.2, 0x9a8a6a, 0.5);
    treeGrove(k, 0, 0, W - 4, D - 4, 16, 'any', (x, z) => Math.abs(x) < S + 7 && Math.abs(z) < S + 11, [0.8, 1.2]);
    for (const [x, z] of [[-S, S + 1.5], [S, S + 1.5], [-3.6, S + 4], [3.6, S + 4], [-S - 1.5, 0], [S + 1.5, 0]] as P2[]) k.light(x, top - 2, z, 0xffb060, 3, 'lamp');
    for (const sx of [-1, 1]) flood(k, sx * 12, 0, kt * 0.6, 26, 0xffe2b0);
    crowd(k, 0, S + 14, 12, 4, 5);
    return peak;
  },

  // ── Grand hotel (Belle Époque) ───────────────────────────────────────────
  grand_hotel(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const stone = mix(0xeee2c8, look.wallColor, 0.15);
    const trim = 0xf6efe0;
    const copper = C.copper;
    plaza(k, 0xd9cfbd, 0xbdb4a2);
    const iron = 0x2a2e33;
    const wing = (x: number, z: number, w: number, d: number, h: number, roof: 'mansard' | 'hip') => {
      k.box('wall_stone', x, 0, z, w, 5.2, d, shade(stone, 0.9), { top: false });
      k.box('plain', x, 5.2, z, w + 0.3, 0.45, d + 0.3, trim);
      k.box('wall_stone', x, 5.65, z, w, h - 5.65, d, stone, { top: 'roof_flat', topColor: 0x5a5d62 });
      k.box('plain', x, h - 0.1, z, w + 0.9, 0.7, d + 0.9, trim);
      if (roof === 'mansard') k.mansard('roof_metal', x, h + 0.6, z, w + 0.2, d + 0.2, 4.4, 1.7, copper, 'roof_flat', 0x4a5a58);
      else k.hipRoof('roof_metal', x, h + 0.6, z, w + 0.2, d + 0.2, 7.5, copper, 0.3);
    };
    const mz = -15, md = 14, mh = 23;
    wing(0, mz, 40, md, mh, 'mansard');
    for (const sx of [-1, 1]) wing(sx * 15, 0, 10, 16, mh, 'hip');
    // dormers on the main mansard
    if (!k.lo) for (let i = -5; i <= 5; i++) {
      if (Math.abs(i) < 2) continue;
      const x = i * 3.3;
      k.box('wall_plaster', x, mh + 1.1, mz + md / 2 - 0.4, 1.4, 1.8, 1.4, trim, { top: false });
      k.box('glass', x, mh + 1.4, mz + md / 2 + 0.31, 0.9, 1.2, 0.05, 0x2c3a46, { top: false });
      k.gableRoof('roof_metal', x, mh + 2.9, mz + md / 2 - 0.4, 1.7, 1.6, 0.8, copper, { overhang: 0.1, ridgeAlongX: false, wallMat: 'plain', wallColor: trim });
    }
    // central pavilion with the dome
    const ph = 26;
    k.box('wall_stone', 0, 0, mz + 1, 12, ph, md + 2, stone, { top: 'roof_flat', topColor: 0x5a5d62 });
    k.box('plain', 0, ph - 0.1, mz + 1, 12.9, 0.8, md + 2.9, trim);
    k.cyl('plain', 0, ph + 0.7, mz + 1, 5, 5, 2.2, trim, k.seg(20));
    const dp: P2[] = [[5.1, 0], [5.2, 1.4], [4.7, 3.6], [3.4, 6], [1.5, 7.8], [0.5, 8.6], [0, 8.8]];
    k.rev('roof_metal', 0, ph + 2.9, mz + 1, dp, copper, k.seg(22), { crease: 70 });
    if (!k.lo) revRibs(k, 0, ph + 2.9, mz + 1, dp, 1, 1, 12, [], shade(copper, 0.8), 0.18, 0.05);
    k.cyl('plain', 0, ph + 11.6, mz + 1, 0.8, 0.8, 1.6, trim, 8);
    k.dome('metal', 0, ph + 13.2, mz + 1, 0.9, C.gold, 8, 1.2);
    k.cyl('metal', 0, ph + 14.2, mz + 1, 0.08, 0.04, 2.2, C.gold, 4);
    const top = ph + 16.4;
    k.word('HOTEL', 0, ph - 3.4, mz + md / 2 + 2.05, 1.7, C.gold, 'neon', 0.12);
    // balconies with wrought-iron rails on the fronts
    const balcony = (x: number, z: number, w: number, y: number) => {
      k.box('plain', x, y, z + 0.5, w, 0.18, 1.0, trim);
      k.box('metal', x, y + 0.18, z + 0.98, w, 0.9, 0.05, iron, { top: false });
    };
    for (const y of [8.95, 15.55]) {
      for (const sx of [-1, 1]) balcony(sx * 13, mz + md / 2, 12, y);
      for (const sx of [-1, 1]) balcony(sx * 15, 8, 8, y);
    }
    balcony(0, mz + md / 2 + 1, 10, 12.25);
    // glass-and-iron marquise over the entrance, revolving door
    const ez = mz + md / 2 + 1;
    k.box('glass', 0, 4.4, ez + 2.2, 10, 0.18, 4.4, 0xa9c0c8, { bottom: true });
    k.box('metal', 0, 4.58, ez + 4.35, 10.2, 0.4, 0.12, iron);
    for (const sx of [-1, 1]) k.beam('metal', [sx * 4.6, 5.8, ez + 0.1], [sx * 4.6, 4.6, ez + 4.3], 0.12, 0.12, iron);
    k.cyl('glass', 0, 0.05, ez + 0.4, 1.3, 1.3, 3.2, 0x5d7a90, 12);
    for (let i = 0; i < 4; i++) k.light(-3.6 + i * 2.4, 4.2, ez + 2.6, C.lampWarm, 2.2, 'lamp');
    k.box('plain', 0, 0.05, ez + 5, 3, 0.03, 8, 0x8a1f25, { top: 'plain' });
    // forecourt: carriage loop around a fountain, cars, doorman
    const fz = 9;
    k.ring('asphalt', 0, 0.1, fz, 4.6, 8.2, C.asphaltLight, k.seg(24));
    fountain(k, 0, fz, 3.4, 0xe0d6c2);
    k.flat('asphalt', 0, (fz + 8.2 + D / 2) / 2, 7, D / 2 - fz - 8.2, 0.1, C.asphaltLight);
    car(k, -5, ez + 5.5, 0, 0x1a1a1e);
    taxi(k, 5.5, ez + 6.5, Math.PI);
    person(k, 1.4, ez + 3.2, 0x8a1f25, 0.4);
    person(k, -1.8, ez + 3.6, 0xf4f4f0, -0.6);
    for (const sx of [-1, 1]) flagpole(k, sx * 3.5, mz + md / 2 + 2.3, 4, sx > 0 ? 0xd8272f : 0x2f5fa8, 0xf4f4f4);
    // garden front: hedges, formal trees, iron fence with gate piers
    for (const sx of [-1, 1]) {
      hedge(k, sx * 15, 15, 9, 1.2, 1.0);
      tree(k, themeTree(k.ctx, 'formal'), sx * 11.5, 18.5, 0.7, sx);
      tree(k, themeTree(k.ctx, 'formal'), sx * 19.5, 18.5, 0.7, sx + 1);
      k.box('plain', sx * 4.8, 0, D / 2 - 1.2, 0.9, 2.2, 0.9, trim);
      k.ball('plain', sx * 4.8, 2.5, D / 2 - 1.2, 0.35, trim, 6, 4);
      fence(k, [[sx * 5.4, D / 2 - 1.2], [sx * (W / 2 - 1), D / 2 - 1.2]], 1.5, iron, 2.2);
    }
    lampsAlong(k, [[-W / 2 + 3, D / 2 - 2.6], [W / 2 - 3, D / 2 - 2.6]], 8, 4.2, 'classic', 0);
    for (const x of [-14, -6, 6, 14]) flood(k, x, mz + md / 2 + 2.4, 11, 14, 0xffe4c0);
    for (const sx of [-1, 1]) flood(k, sx * 15, 9.2, 11, 12, 0xffe4c0);
    return top;
  },

  // ── Art museum (titanium curves) ─────────────────────────────────────────
  art_museum(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    plaza(k, 0xd9d4ca, 0xb5b0a6);
    // reflecting pool along the back right
    k.box('concrete', 14, 0, -18, 30, 0.5, 10, 0x8f8b84, { top: false });
    k.flat('water', 14, -18, 29, 9, 0.35, 0x3f7f8a);
    k.slab('grass', -20, 14, 20, 14, 0.1, lawnColor(k.ctx, 0.7), 0.1);
    // limestone galleries
    k.box('plain', -20, 0, -10, 18, 12, 16, 0xd9ccb0, { top: 'roof_flat', topColor: 0x8a8578 });
    k.box('plain', 20, 0, -13, 14, 9, 12, 0xd4c6a8, { top: 'roof_flat', topColor: 0x8a8578 });
    k.box('wall_glass', -4, 0, 6, 16, 7.5, 5, 0x8fb4c8, { top: 'roof_flat' });
    k.cyl('wall_glass', 0, 0, -6, 6.5, 5.2, 21, 0xb4d0e0, k.seg(16));
    // titanium volumes: leaning, pointed blobs
    const ti = 0xc6cacf;
    const petals: [number, number, number, number, number, number, number, number][] = [
      [-8, -9, 0.3, 8, 17, 0.2, 1.4, 0.6],
      [7, -12, -0.5, 7, 23, -0.16, 1.2, 0.55],
      [-1, -18, 0.9, 8.5, 18, 0.1, 1.5, 0.5],
      [19, -6, 0.6, 4.6, 29, 0.1, 0.8, 0.62],
    ];
    for (const [x, z, rot, R, H, lean, sx, sz] of petals) {
      const col = jitter(ti, () => r.next(), 0.05);
      k.at(x, 0, z, rot, () => {
        k.push(new THREE.Matrix4().makeRotationZ(lean));
        k.rev('metal', 0, -4, 0, [[R * 0.8, 0], [R, (H + 4) * 0.3], [R * 0.9, (H + 4) * 0.62], [R * 0.45, (H + 4) * 0.9], [0, H + 4]], col, k.seg(22), { sx, sz, crease: 70 });
        k.pop();
      });
    }
    // flowing titanium sheets wrapping the galleries (double-sided curved skins)
    const sheets: [number, number, number, number, number, number, number, number][] = [
      // cx, cz, radius, angle start, angle span, height, flare, phase
      [0, -6, 11, 0.2, 2.2, 15, 3.5, 0.0],
      [0, -6, 13.5, 2.6, 1.9, 12, -3, 1.3],
      [-6, -4, 9, 3.6, 2.0, 18, 4, 2.1],
      [10, -8, 8, 4.9, 2.2, 20, 3, 0.7],
      [4, -2, 7.5, 0.9, 1.6, 10, 2.5, 2.8],
    ];
    for (const [cx, cz, R, a0, span, H, flare, ph] of sheets) {
      const col = jitter(0xcfd3d8, () => r.next(), 0.06);
      k.surface('metal', k.seg(18), k.seg(7), (u, v) => {
        const a = a0 + span * u;
        const h = H * (0.55 + 0.45 * Math.sin(Math.PI * u + ph * 0.3)) * (0.85 + 0.15 * Math.sin(u * 7 + ph));
        const rr = R + flare * v * v + 1.2 * Math.sin(Math.PI * v) * Math.sin(u * 4 + ph);
        return [cx + Math.cos(a) * rr, v * h, cz + Math.sin(a) * rr * 0.8];
      }, col, true);
    }
    // Maman-style spider sculpture
    const spx = -18, spz = 13;
    k.ball('metal', spx, 8.2, spz, 1.4, 0x3a3028, 10, 7, 0.8);
    k.ball('metal', spx, 8.4, spz - 2.2, 2.0, 0x3a3028, 10, 7, 0.75);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const kx = spx + Math.cos(a) * 4.5, kz = spz + Math.sin(a) * 4.5;
      k.polyPipe('metal', [[spx, 8.2, spz], [kx, 11, kz], [spx + Math.cos(a) * 7.8, 0.1, spz + Math.sin(a) * 7.8]], 0.22, 0x3a3028, 5);
    }
    // flower "puppy" topiary guarding the entrance
    const px = 16, pz = 13;
    const fl = [0xe0414f, 0xf2c230, 0xf5f0f0, 0xb05cc8, 0xf07a3a, 0xe58ab0];
    const blobs: [number, number, number, number, number, number][] = [[0, 3.2, 0, 2.2, 2.6, 3.0], [0, 6.5, 1.8, 1.8, 1.9, 1.8], [0, 8.3, 2.3, 1.2, 1.3, 1.4], [-1.1, 1, 1.6, 0.7, 1.2, 0.7], [1.1, 1, 1.6, 0.7, 1.2, 0.7], [-1.1, 1, -1.8, 0.7, 1.2, 0.7], [1.1, 1, -1.8, 0.7, 1.2, 0.7], [-1.4, 8.3, 1.6, 0.4, 1.0, 0.5], [1.4, 8.3, 1.6, 0.4, 1.0, 0.5]];
    blobs.forEach(([x, y, z, rx, ry, rz], i) => foliageBlob(k, px + x, y, pz + z, rx, ry, rz, fl[i % fl.length], i * 3 + 1, 0.3, k.lo ? 0 : 1));
    if (!k.lo) for (let i = 0; i < 14; i++) foliageBlob(k, px + r.range(-1.8, 1.8), r.range(1.5, 7), pz + r.range(-2.2, 2.4), 0.6, 0.6, 0.6, r.pick(fl), i + 20, 0.3, 0);
    // trees, benches, lamps, floodlit curves
    for (let i = 0; i < 5; i++) tree(k, themeTree(k.ctx, 'shade'), -W / 2 + 4 + i * 5, D / 2 - 3, 0.75, i);
    for (const x of [-8, 0, 8]) bench(k, x, 17, Math.PI);
    lampsAlong(k, [[-2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 9, 4.4, 'modern', 0);
    for (const [x, z] of [[-7, 2], [6, -2], [-14, 6], [12, 5], [19, 1]] as P2[]) flood(k, x, z, 9, 16, 0xe8eeff);
    crowd(k, 0, 14, 24, 8, 10);
    return 30;
  },

  // ── Iron observation tower ──────────────────────────────────────────────
  observation_tower(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    const iron = 0x6d5842, ironL = 0x7d6850;
    k.lot('grass', lawnColor(k.ctx, 0.6), 0.2, 0.05);
    k.slab('paving', 0, 0, 36, 36, 0.08, 0xcdbf9f, 0.1);
    for (const sx of [-1, 1]) path(k, [[sx * 18, 18], [sx * 21, 22], [sx * 22, D / 2]], 3, 0xcdbf9f);
    const hw = (y: number) => 16.2 * Math.exp(-y / 36) + 0.9;
    const legW = (y: number) => Math.max(1.6, 5.4 - y * 0.055);
    const c = (y: number) => hw(y) - legW(y) / 2;
    // four curved legs up to the second platform
    const ys = [0, 10, 22, 36, 50, 62, 72];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        k.box('concrete', sx * c(0), 0, sz * c(0), legW(0) + 1.4, 1.4, legW(0) + 1.4, 0xb8b0a0);
        for (let i = 0; i < ys.length - 1; i++) {
          const y0 = ys[i], y1 = ys[i + 1];
          k.trussColumn('metal', [sx * c(y0), y0 + (i === 0 ? 1.4 : 0), sz * c(y0)], [sx * c(y1), y1, sz * c(y1)], legW(y0), legW(y1), i < 3 ? iron : ironL, k.lo ? 1 : 3, 0.42, 0.16);
        }
      }
    // decorative arches between the legs
    const an = k.seg(14);
    for (let f = 0; f < 4; f++)
      k.at(0, 0, 0, (f * Math.PI) / 2, () => {
        const pts: V3[] = [];
        for (let i = 0; i <= an; i++) {
          const t = (i / an) * Math.PI;
          const y = 6 + 17 * Math.sin(t);
          const x = Math.cos(t) * c(6);
          pts.push([x, y, c(y) + 0.2]);
        }
        for (let i = 0; i < an; i++) k.beam('metal', pts[i], pts[i + 1], 1.1, 0.6, iron);
      });
    // first platform (restaurant pavilions) and second platform
    const p1 = 36, s1 = c(p1) + legW(p1) / 2 + 2.2;
    k.box('metal', 0, p1 - 1.4, 0, s1 * 2, 1.6, s1 * 2, iron, { bottom: true, top: 'metal', topColor: 0x8a7a64 });
    for (let e = 0; e < 4; e++)
      k.at(0, 0, 0, (e * Math.PI) / 2, () => {
        k.box('glass', 0, p1 + 0.2, s1 - 1.6, s1 * 1.4, 3.2, 2.4, 0x7a8a90, { top: 'metal', topColor: iron });
        k.box('metal', 0, p1 + 0.2, s1 - 0.1, s1 * 2, 1.1, 0.12, iron, { top: false });
        for (let i = 0; i < 4; i++) k.light(-s1 * 0.5 + i * (s1 / 3), p1 + 2.2, s1 - 0.3, 0xffd48a, 2.6, 'lamp');
      });
    const p2 = 72, s2 = hw(p2) + 2.8;
    k.box('metal', 0, p2 - 1, 0, s2 * 2, 1.2, s2 * 2, iron, { bottom: true, top: 'metal', topColor: 0x8a7a64 });
    k.box('metal', 0, p2 + 0.2, 0, s2 * 2, 1.1, s2 * 2, iron, { top: false });
    k.box('glass', 0, p2 + 0.2, 0, s2 * 1.1, 3, s2 * 1.1, 0x7a8a90, { top: 'metal', topColor: iron });
    // upper shaft
    const shaft = [72, 90, 108, 124, 138];
    for (let i = 0; i < shaft.length - 1; i++) k.lattice('metal', 0, 0, shaft[i], shaft[i + 1], hw(shaft[i]), hw(shaft[i + 1]), ironL, 6, 0.45, 0.16);
    // top: observation cabin, campanile, lighthouse beam, antenna
    const p3 = 138, s3 = hw(p3) + 1.6;
    k.box('metal', 0, p3, 0, s3 * 2, 0.8, s3 * 2, iron, { bottom: true });
    k.box('glass', 0, p3 + 0.8, 0, s3 * 1.7, 3.2, s3 * 1.7, 0x6a7a80, { top: 'metal', topColor: iron });
    k.box('metal', 0, p3 + 4, 0, s3 * 1.9, 0.5, s3 * 1.9, iron);
    k.cyl('metal', 0, p3 + 4.5, 0, 1.2, 0.9, 3.5, ironL, 8);
    k.anim([0, p3 + 6.6, 0], [0, 1, 0], 0.7, (s) => {
      s.cyl('metal', 0, p3 + 8, 0, 0.9, 0.9, 1.4, 0x2a2622, 8);
      s.box('emissive', 0.95, p3 + 8.2, 0, 0.14, 1, 0.8, 0xfff4d0);
      s.box('emissive', -0.95, p3 + 8.2, 0, 0.14, 1, 0.8, 0xfff4d0);
    });
    k.cyl('metal', 0, p3 + 9.4, 0, 0.5, 0.2, 14.6, 0xd8d8d8, 6);
    k.light(0, p3 + 8.6, 0, 0xfff4d0, 14, 'beacon', true);
    k.light(0, 162, 0, C.beaconRed, 3.2, 'beacon', true);
    // golden night lighting: sparkles + uplights
    const sparkles = k.lo ? 16 : 44;
    for (let i = 0; i < sparkles; i++) {
      const y = r.range(4, 136);
      const sx = r.chance(0.5) ? 1 : -1, sz = r.chance(0.5) ? 1 : -1;
      const h = y < 72 ? c(y) : hw(y);
      k.light(sx * h + r.range(-1, 1), y, sz * h + r.range(-1, 1), 0xfff0c8, r.range(1.0, 1.8), 'beacon', true);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.light(sx * c(20), 20, sz * c(20), 0xffc870, 20, 'flood');
      k.light(sx * c(55) * 0.8, 55, sz * c(55) * 0.8, 0xffc870, 14, 'flood');
    }
    k.light(0, 100, 0, 0xffc870, 14, 'flood');
    // Champ-de-Mars style grounds
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) tree(k, themeTree(k.ctx, 'shade'), sx * (W / 2 - 3), -D / 2 + 5 + i * 9, 0.8, i);
      flowerBed(k, sx * 12, 21, 6, 2.4);
    }
    fountain(k, 0, 20.5, 2.6, 0xd8d0c0);
    crowd(k, 0, 0, 30, 30, 18);
    return 162;
  },

  // ── Planetarium ─────────────────────────────────────────────────────────
  planetarium(k) {
    const W = k.W, D = k.D;
    plaza(k, 0xd4d6d8, 0xb0b4b8);
    const cz = -4;
    const s = k.seg(28);
    k.rev('wall_glass', 0, 0, cz, [[12.4, 0], [12.4, 4.2]], 0x7fa4c0, s);
    k.cyl('plain', 0, 4.2, cz, 12.9, 12.9, 2.6, 0xeceae4, s);
    const R = 12.4;
    const dp: P2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); dp.push([Math.cos(a) * R, Math.sin(a) * R * 1.05]); }
    dp[8][0] = 0;
    k.rev('metal', 0, 6.8, cz, dp, 0xd6dbe0, s, { crease: 80 });
    if (!k.lo) revRibs(k, 0, 6.8, cz, dp, 1, 1, 16, [3, 6], 0x9aa2aa, 0.16, 0.04);
    k.cyl('metal', 0, 6.8 + R * 1.05 - 0.2, cz, 1.2, 0.9, 1, 0xb8bec4, 10);
    k.light(0, 6.8 + R * 1.05 + 1.4, cz, C.beaconRed, 2.4, 'beacon', true);
    // entrance pavilion with a star logo
    k.box('wall_glass', 0, 0, 9.5, 16, 4.4, 5, 0x86a8c0, { top: 'roof_flat' });
    k.box('concrete', 0, 4.4, 10.5, 18, 0.5, 8, 0xf2f2ee, { bottom: true });
    k.torus('neon', 0, 3.2, 12.1, 1.1, 0.1, 0x7fb8ff, 16, 4);
    k.push(new THREE.Matrix4().makeTranslation(0, 3.2, 12.1).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.torus('neon', 0, 0, 0, 1.1, 0.1, 0x7fb8ff, 16, 4);
    k.pop();
    k.ball('emissive', 0, 3.2, 12.1, 0.35, 0xfff4c0, 8, 5);
    for (let i = 0; i < 4; i++) k.light(-6 + i * 4, 4.2, 12.5, C.lampCool, 2.4, 'lamp');
    // rooftop observatory with a rotating dome and telescope
    const ox = 14, oz = -15;
    k.box('plain', ox, 0, oz, 10, 5, 10, 0xe4e2dc, { top: 'paving', topColor: 0xc8c4bc });
    k.box('metal', ox, 5, oz, 10, 1, 10, 0x8a8e92, { top: false });
    k.cyl('plain', ox, 5, oz, 3.2, 3.2, 2.6, 0xf0f0ec, 16);
    k.anim([ox, 7.6, oz], [0, 1, 0], 0.08, (a) => {
      a.dome('metal', ox, 7.6, oz, 3.25, 0xf2f4f6, 16, 1, 6);
      a.box('plain', ox, 7.8, oz + 1.6, 1.1, 3.4, 0.2, 0x1a1e24, { top: false });
      a.pipe('metal', [ox, 8.4, oz + 0.2], [ox, 11.3, oz + 3.2], 0.45, 0xe8e8e8, 10, true);
    });
    // kinetic orrery in the forecourt
    const qx = -12, qz = 14;
    k.cyl('plain', qx, 0, qz, 2.4, 2.6, 0.8, 0xc8c4bc, 12);
    k.cyl('metal', qx, 0.8, qz, 0.2, 0.15, 2.4, C.bronze, 6);
    k.ball('emissive', qx, 3.4, qz, 0.8, 0xffc050, 10, 7);
    k.light(qx, 3.4, qz, 0xffc050, 3, 'lamp');
    const orbits: [number, number, number, number][] = [[1.8, 0.28, 0x9a8a7a, 0.5], [2.9, 0.42, 0x4a8ad0, 0.32], [4.1, 0.6, 0xd0a060, 0.2]];
    orbits.forEach(([rr, pr, col, sp], i) =>
      k.anim([qx, 3.4, qz], [0, 1, 0], sp, (a) => {
        a.torus('metal', qx, 3.4, qz, rr, 0.04, C.bronze, 20, 3);
        a.beam('metal', [qx, 3.4, qz], [qx + rr, 3.4, qz], 0.06, 0.06, C.bronze);
        a.ball('plain', qx + rr * Math.cos(i * 2), 3.4, qz + rr * Math.sin(i * 2), pr, col, 8, 6);
      }),
    );
    // crescent lawns, trees and benches
    for (const sx of [-1, 1]) {
      k.slab('grass', sx * 17, 12, 10, 14, 0.1, lawnColor(k.ctx, 0.7), 0.1);
      tree(k, themeTree(k.ctx, 'shade'), sx * 18, 15, 0.7, sx);
      bench(k, sx * 12, 19, Math.PI);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.light(Math.cos(a) * 13.4, 0.5, cz + Math.sin(a) * 13.4, 0x8fb8ff, 2.2, 'neon');
    }
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 9, 4.2, 'modern', 0);
    crowd(k, 2, 16, 18, 5, 8);
    return 6.8 + R * 1.05 + 1;
  },

  // ── Casino ──────────────────────────────────────────────────────────────
  casino(k) {
    const W = k.W, D = k.D;
    plaza(k, 0xe4dccc, 0xc4b8a4);
    const gold = 0xf4cf5c, cream = 0xf0e6d2;
    const magenta = 0xff3aa0, cyan = 0x3ae0ff;
    // gold Y-shaped hotel tower
    const tz = -11;
    const wings: [number, number, number][] = [[0, 15, 60], [(Math.PI * 2) / 3, 13, 52], [(-Math.PI * 2) / 3, 13, 46]];
    for (const [ang, len, H] of wings)
      k.at(0, 0, tz, ang, () => {
        k.box('wall_office', 0, 0, len / 2, 9, H - 6, len, gold, { top: 'roof_flat' });
        k.box('wall_office', 0, H - 6, len / 2 - 1.5, 8, 6, len - 3, shade(gold, 0.95), { top: 'roof_flat' });
        k.box('neon', 0, H - 0.2, len / 2 - 1.5, 8.2, 0.3, len - 2.8, gold);
        k.light(0, H, len - 3, 0xffd070, 6, 'neon');
      });
    k.cyl('wall_office', 0, 0, tz, 5.4, 5.4, 62, shade(gold, 0.92), 8);
    k.cyl('metal', 0, 62, tz, 2, 0.3, 6, gold, 8);
    k.light(0, 68, tz, C.beaconRed, 3, 'beacon', true);
    // podium with neon bands
    k.box('plain', 0, 0, -1, 56, 10, 16, cream, { top: 'roof_flat', topColor: 0x6a6660 });
    k.box('wall_shop', 0, 0, 7.05, 56, 4.5, 0.1, cream, { top: false });
    for (const [y, col] of [[9.2, magenta], [9.8, cyan], [4.6, gold]] as [number, number][]) {
      k.box('neon', 0, y, 7.1, 56.2, 0.25, 0.12, col, { top: false });
      for (const sx of [-1, 1]) k.box('neon', sx * 28.05, y, -1, 0.12, 0.25, 16.2, col, { top: false });
    }
    k.word('CASINO', 0, 5.9, 7.3, 2.8, 0xffd040, 'neon', 0.14);
    // podium roof: pool deck with loungers and umbrellas, cabana garden
    k.box('concrete', -16, 10, 0, 16, 0.3, 9, 0xe8e2d4, { top: 'paving', topColor: 0xe8dcc4 });
    k.box('concrete', -16, 10.3, 0, 11, 0.25, 4.2, 0xf4f4f0, { top: 'water', topColor: 0x4fc0d8 });
    if (!k.lo) for (let i = 0; i < 6; i++) {
      k.box('plain', -21 + i * 2, 10.3, 3.4, 0.7, 0.3, 1.8, 0xf4f4f0);
      if (i % 2 === 0) umbrella(k, -20 + i * 2, 3.5, i % 4 ? 0xff5a8a : 0xf4f4f0, 1.2, 2.2);
    }
    k.at(0, 10.3, 0, 0, () => { for (const x of [-24, -8]) for (const z of [-3, 3]) tree(k, themeTree(k.ctx, 'formal'), x, z, 0.45, x + z); });
    k.slab('grass', 16, 0, 16, 9, 10.35, lawnColor(k.ctx, 0.9), 0.3);
    for (let i = 0; i < 3; i++) {
      k.box('plain', 11 + i * 5, 10.35, -2, 3, 2.4, 3, 0xf4f4f0, { top: false });
      k.pyramid('plain', 11 + i * 5, 12.75, -2, 3.6, 3.6, 1.4, [0xff5a8a, 0xf2c230, 0x3ae0ff][i]);
    }
    for (let i = 0; i < 6; i++) k.light(-12 + i * 4.8, 7, 8, [magenta, 0xffd040, cyan][i % 3], 5, 'neon', i % 2 === 0);
    // porte-cochère
    k.box('metal', 0, 3.8, 11, 20, 0.6, 8, gold, { bottom: true });
    for (const sx of [-1, 1]) for (const sz of [0, 1]) k.cyl('metal', sx * 9, 0, 8 + sz * 6, 0.35, 0.35, 3.8, gold, 8);
    for (let i = 0; i < 8; i++) k.light(-8.4 + i * 2.4, 3.6, 11, 0xfff0c0, 2.2, 'lamp');
    car(k, -4, 10, 0, 0x1a1a1e);
    car(k, 4, 12, Math.PI, 0xf4f4f0, 'suv');
    taxi(k, 7, 9.5, 0);
    // dancing-fountain lake
    const lz = 18.5;
    k.box('concrete', 0, 0, lz, 52, 0.6, 9, 0xd8d0c0, { top: false });
    k.flat('water', 0, lz, 51, 8, 0.45, 0x3f8fa8);
    const jets = k.lo ? 6 : 13;
    for (let i = 0; i < jets; i++) {
      const x = -24 + (48 * i) / (jets - 1);
      const z = lz + Math.sin(i * 0.9) * 2;
      k.emitter('fountain', x, 0.6, z, 0.7);
      k.light(x, 0.8, z, i % 2 ? magenta : cyan, 3, 'neon');
    }
    // marquee pylon sign
    const sx0 = W / 2 - 5, sz0 = D / 2 - 5;
    k.cyl('metal', sx0, 0, sz0, 0.7, 0.6, 16, gold, 8);
    k.box('metal', sx0, 10, sz0, 5.6, 8, 1.4, 0x2a1a2e);
    k.box('neon', sx0, 10.4, sz0 + 0.72, 5, 7.2, 0.06, 0xd02070, { top: false });
    k.glyph('7', sx0 - 1.2, 11.5, sz0 + 0.8, 4.4, 0xffd040, 'neon', 0.1);
    k.glyph('7', sx0 + 1.3, 11.5, sz0 + 0.8, 4.4, 0xffd040, 'neon', 0.1);
    k.rev('neon', sx0, 18.1, sz0, [[0.8, 0], [0.9, 0.8], [0, 2.4]], 0xffd040, 5);
    for (let i = 0; i < 6; i++) k.light(sx0 + (i % 2 ? 2.6 : -2.6), 10.5 + Math.floor(i / 2) * 3.4, sz0 + 0.8, i % 2 ? magenta : 0xffd040, 2.4, 'neon', true);
    k.light(sx0, 14, sz0 + 1, magenta, 10, 'neon');
    // palms / formal trees along the drive, crowds
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 3), -8 + i * 8, 0.85, i + sx);
    crowd(k, 0, D / 2 - 2.5, W - 12, 2, 12);
    for (const x of [-20, -10, 10, 20]) flood(k, x, 12.5, 30, 22, 0xffe0a0);
    return 68;
  },

  // ── Convention center (wave roof) ────────────────────────────────────────
  convention_center(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', C.asphalt, 0.2, 0.05);
    k.slab('paving', 0, 2, W - 2.4, 50, 0.08, 0xd2ccc0, 0.1);
    const x0 = -40, x1 = 40, zb = -24, zf = 8;
    const roofY = (x: number, z: number) => 17 + 5 * Math.sin(((x + 44) / 88) * Math.PI * 2.4 + 0.4) + (z - zb) * 0.06;
    const ro = 4;
    const nx = k.seg(40);
    k.surface('roof_metal', nx, 4, (u, v) => {
      const x = x0 - ro + (x1 - x0 + ro * 2) * u;
      const z = zf + ro - (zf - zb + ro * 2) * v;
      return [x, roofY(x, z) + 0.2, z];
    }, 0xe8eaec, true);
    profileWall(k, 'wall_glass', [x0, zf], [x1, zf], nx, roofY, 0x8fb4c8, [0, 0, 1]);
    profileWall(k, 'wall_industrial', [x1, zb], [x0, zb], nx, roofY, 0xd8dad8, [0, 0, -1]);
    profileWall(k, 'wall_glass', [x0, zb], [x0, zf], 6, roofY, 0x8fb4c8, [-1, 0, 0]);
    profileWall(k, 'wall_glass', [x1, zf], [x1, zb], 6, roofY, 0x8fb4c8, [1, 0, 0]);
    // colonnade under the overhang + glass lobby
    for (let x = x0; x <= x1; x += 8) k.cyl('metal', x, 0, zf + ro - 0.6, 0.35, 0.35, roofY(x, zf + ro - 0.6), 0xdadcde, 8, false);
    k.box('wall_glass', 0, 0, zf + 3, 24, 7, 6, 0x9ac0d4, { top: 'roof_flat' });
    k.box('emissive', 0, 8.5, zf + 0.15, 30, 4, 0.2, 0x3a8ad0, { top: false });
    k.word('EXPO', 0, 9, zf + 0.3, 2.6, 0xf4f8ff, 'neon', 0.1);
    for (let i = 0; i < 8; i++) k.light(-14 + i * 4, 6.6, zf + 5, C.lampCool, 2.8, 'lamp');
    // banners, flags, sculpture ring
    const pal = [0xe0414f, 0x3a8ad0, 0xf2c230, 0x3fa05a, 0xb05cc8];
    for (let i = 0; i < 10; i++) {
      const x = -36 + i * 8;
      if (Math.abs(x) < 14) continue;
      k.cyl('metal', x, 0, zf + 8, 0.08, 0.08, 7, 0x5a6066, 4);
      k.box('plain', x + 0.6, 3.5, zf + 8, 1.1, 3.2, 0.05, pal[i % pal.length], { top: false });
    }
    for (let i = 0; i < 7; i++) flagpole(k, -12 + i * 4, zf + 14, 9, pal[i % pal.length], 0xf4f4f4);
    k.push(new THREE.Matrix4().makeTranslation(24, 5, zf + 13).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.3)));
    k.torus('metal', 0, 0, 0, 4, 0.5, 0xd84a2a, k.seg(24), 6);
    k.pop();
    k.box('concrete', 24, 0, zf + 13, 3, 0.6, 3, 0xb0aca4);
    // parking and a bus drop-off
    parkingLot(k, -32, 20, 26, 14, 0.7);
    parkingLot(k, 34, -2, 22, 16, 0.6);
    bus(k, 12, 22, 0, 0x2d7fd0);
    bus(k, -6, 22, 0, 0xe0a030);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 6, 'modern', 0);
    crowd(k, 0, zf + 10, 40, 6, 16);
    for (const x of [-30, -10, 10, 30]) flood(k, x, zf + 6, 10, 18, 0xe8f0ff);
    return 24;
  },

  // ── Opera house (sail shells) ───────────────────────────────────────────
  opera_house(k) {
    const W = k.W, D = k.D;
    const granite = 0xb8a08a;
    plaza(k, 0xcfc4b4, 0xb0a492);
    const py = 6;
    k.box('plain', 0, 0, -9, 64, py, 34, granite, { top: 'paving', topColor: 0xcfbfa8 });
    k.box('glass', 0, 1, 8.02, 60, 3.4, 0.1, 0x3a4652, { top: false });
    for (const sx of [-1, 1]) k.box('glass', sx * 32.02, 1, -9, 0.1, 3.4, 30, 0x3a4652, { top: false });
    k.stairs(0, 8 + py / 0.18 * 0.34, 34, py, 0xc4b09a, 0.18, 0.34, 'paving');
    const white = 0xf4f1e8;
    let top = 0;
    const group: [number, number, number, number, number, number][] = [
      // x, z, rot, B, L, H
      [-13, -4, 0, 11.5, 22, 34],
      [-13, -17, 0, 10, 15, 26],
      [-13, -24, Math.PI, 7.5, 10, 16],
      [13, -3, 0, 10.5, 20, 30],
      [13, -15, 0, 9, 14, 23],
      [13, -23, Math.PI, 7, 9, 14],
      [-27, 4, 0, 4.5, 8, 10],
      [-27, -2, Math.PI, 3.8, 6, 7.5],
    ];
    group.forEach(([x, z, rot, B, L, H], i) => {
      top = Math.max(top, shell(k, x, py, z, rot, B, L, H, i % 3 === 1 ? shade(white, 0.97) : white, 0xb8a078));
    });
    // floodlights on the sails, promenade lamps, people on the steps
    for (const [x, z] of [[-13, 10], [13, 10], [-27, 12], [0, -30]] as P2[]) k.light(x, py + 12, z, 0xf0f4ff, 22, 'flood');
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.6, 'modern', 0);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 3.5), -24 + i * 12, 0.8, i + sx);
    crowd(k, 0, 15, 30, 8, 16);
    for (let i = 0; i < 6; i++) umbrella(k, 26 + (i % 2) * 4, -20 + Math.floor(i / 2) * 5, [0xf4f4f0, 0xd84a3a][i % 2], 1.3, 2.4);
    k.box('paving', 28, 0, -15, 10, py, 16, granite, { top: 'paving', topColor: 0xcfbfa8 });
    return top;
  },

  // ── Stadium ─────────────────────────────────────────────────────────────
  stadium(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    plaza(k, 0xcfc8ba, 0xb0a898);
    const A = 36, B = 22, rc0 = 7;
    const ns = k.seg(8), nc = k.seg(6);
    const ring = (d: number) => roundRect(A + d, B + d, rc0 + d, ns, nc);
    const team = r.pick([[0xc8322b, 0xf4f4f0], [0x1f4fa8, 0xf4f4f0], [0x2f8a3a, 0xf2c230], [0x6a2a8a, 0xf2c230], [0xe0a030, 0x1a1a1e]]);
    // pitch with mowing stripes and markings
    k.slab('grass', 0, 0, (A + 4) * 2, (B + 4) * 2, 0.1, 0x4f8f3a, 0.2);
    const stripes = 12;
    for (let i = 0; i < stripes; i += 2) k.flat('grass', -A + ((i + 0.5) * (2 * A)) / stripes, 0, (2 * A) / stripes, B * 2, 0.12, 0x5fa044);
    k.paintRect(0, 0, A * 2 - 4, B * 2 - 4, 0.14, 0.14);
    k.paint(0, -B + 2, 0, B - 2, 0.14, 0.14);
    k.ring('plain', 0, 0.14, 0, 6.2, 6.4, C.paint, 24);
    for (const sx of [-1, 1]) {
      k.paintRect(sx * (A - 2 - 7), 0, 14, 26, 0.14, 0.14);
      k.box('metal', sx * (A - 1.6), 0, 0, 0.12, 2.4, 7.3, 0xf4f4f4, { top: false });
      k.box('metal', sx * (A - 1.6), 2.4, 0, 0.14, 0.14, 7.4, 0xf4f4f4);
    }
    // bowl: boards, lower tier, boxes, upper tier, back wall
    const R = (d: number) => ring(d);
    loopBand(k, 'emissive', R(2), 0, R(2), 1.3, team[0], true);
    loopBand(k, 'plain', R(2.4), 1.3, R(9), 6.2, team[0], true);
    loopBand(k, 'plain', R(9), 6.2, R(15.5), 11, shade(team[0], 0.85), true);
    loopBand(k, 'glass', R(15.5), 11, R(15.5), 13.6, 0x2a3440, true);
    loopBand(k, 'plain', R(15.8), 13.6, R(21), 21, team[1], true);
    loopBand(k, 'plain', R(21), 21, R(26), 28.5, shade(team[1], 0.88), true);
    loopBand(k, 'concrete', R(26), 28.5, R(26), 31, 0x9a968e, true);
    // outer facade with fins + neon crown band
    loopBand(k, 'glass', R(27.5), 0, R(27.5), 5, 0x4a5a66, false);
    loopBand(k, 'plain', R(27.5), 5, R(27.5), 30, 0xe6e6e2, false);
    loopBand(k, 'neon', R(27.6), 30, R(27.6), 31.2, team[0], false);
    loopBand(k, 'concrete', R(26), 31, R(27.6), 31, 0x9a968e, false);
    const outer = R(27.5);
    if (!k.lo) for (let i = 0; i < outer.length; i += 2) {
      const [x, z] = outer[i];
      const l = Math.hypot(x, z);
      k.beam('metal', [x + (x / l) * 0.5, 0, z + (z / l) * 0.5], [x + (x / l) * 0.5, 31, z + (z / l) * 0.5], 0.5, 0.8, 0xf4f4f2);
    }
    // cantilevered roof ring
    loopBand(k, 'roof_metal', R(13), 37, R(28), 34, 0xeceeee, false, true);
    const inner = R(13);
    for (let i = 0; i < inner.length; i += 3) k.light(inner[i][0] * 1.04, 36.2, inner[i][1] * 1.04, 0xf6f8ff, 5, 'flood');
    // soft floodlit wash over the pitch (reads as an illuminated field at night)
    for (const x of [-A * 0.55, 0, A * 0.55]) for (const z of [-B * 0.45, B * 0.45]) k.light(x, 2.5, z, 0xeef6ff, 34, 'flood');
    // big screens under the roof at both ends
    for (const sx of [-1, 1])
      k.at(sx * (A + 20), 0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, () => {
        k.box('metal', 0, 22.5, -0.3, 16, 7, 0.6, 0x1a1a1e);
        k.box('emissive', 0, 23, 0.02, 15, 6, 0.06, 0x3a7ad0, { top: false });
        k.light(0, 26, 1, 0x9ac8ff, 10, 'neon');
      });
    // crowd speckle on the stands
    if (!k.lo) {
      const pal = [team[0], team[1], 0xf4f4f0, 0x2a2a2e, 0xe8c4a0];
      for (let i = 0; i < 260; i++) {
        const t = r.int(0, inner.length - 1), f = r.range(0, 1);
        const upper = r.chance(0.5);
        const d = upper ? 16 + f * 10 : 2.6 + f * 12.6;
        const y = upper ? 13.6 + f * 14.9 : 1.3 + f * 9.7;
        const L = ring(d)[t];
        k.box('plain', L[0], y + 0.05, L[1], 0.6, 0.55, 0.6, r.pick(pal));
      }
    }
    // four floodlight masts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) floodMast(k, sx * (A + 22), sz * (B + 22), 48, 0, 0, 0xd8dade);
    // concourse: people, flags, trees
    crowd(k, 0, D / 2 - 3, W - 16, 3, 18);
    for (const sx of [-1, 1]) flagpole(k, sx * 12, D / 2 - 2, 10, team[0], team[1]);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 14, 6, 'modern', 0);
    return 48;
  },

  // ── Gothic cathedral ────────────────────────────────────────────────────
  cathedral(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const stone = mix(0xd9cdb2, look.wallColor, 0.12);
    const dark = shade(stone, 0.86);
    const lead = k.rnd() < 0.5 ? 0x4f5a60 : C.copper;
    const glassA = 0x33406a, glassB = 0x6a2a3a;
    k.lot('grass', lawnColor(k.ctx, 0.55), 0.2, 0.05);
    k.slab('paving', 0, 41, W - 1, 14, 0.08, 0xcfc6b4, 0.1);
    k.slab('paving', 0, 0, 34, 80, 0.07, 0xc6bca8, 0.1);
    const nave = 6, naveH = 28, aisle = 13, aisleH = 14, zF = 34, zB = -30;
    // nave + choir
    k.box('plain', 0, 0, (zF + zB) / 2, nave * 2, naveH, zF - zB, stone, { top: false });
    k.gableRoof('roof_metal', 0, naveH, (zF + zB) / 2 - 0.3, nave * 2 + 0.6, zF - zB - 0.6, 11, lead, { overhang: 0.2, ridgeAlongX: false, wallMat: 'plain', wallColor: stone });
    // aisles with lean-to roofs
    for (const sx of [-1, 1]) {
      const ax = sx * (nave + aisle) / 2;
      k.box('plain', ax, 0, 6, aisle - nave, aisleH, 56, stone, { top: false });
      k.at(ax, 0, 6, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => k.shedRoof('roof_metal', 0, aisleH, 0, 56, aisle - nave + 0.6, 3.2, lead, 0.3, 'plain', stone));
    }
    // transept
    const tz = -8, tw = 24;
    k.box('plain', 0, 0, tz, tw * 2, naveH, 12, stone, { top: false });
    k.gableRoof('roof_metal', 0, naveH, tz, tw * 2 + 0.6, 12.6, 11, lead, { overhang: 0.2, ridgeAlongX: true, wallMat: 'plain', wallColor: stone });
    for (const sx of [-1, 1])
      k.at(sx * (tw + 0.02), 0, tz, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
        roseWindow(k, 0, 20, 0, 3.4, stone);
        lancet(k, -2.2, 4, 0, 1.6, 9, glassA, stone);
        lancet(k, 2.2, 4, 0, 1.6, 9, glassA, stone);
      });
    // apse (half drum + half cone)
    k.rev('plain', 0, 0, zB, [[nave, 0], [nave, naveH]], stone, k.seg(12), { a0: Math.PI, a1: Math.PI * 2 });
    k.rev('roof_metal', 0, naveH, zB, [[nave + 0.3, 0], [0, 11]], lead, k.seg(12), { a0: Math.PI, a1: Math.PI * 2 });
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + ((i + 0.5) / 5) * Math.PI;
      k.at(Math.cos(a) * (nave + 0.02), 0, zB + Math.sin(a) * (nave + 0.02), Math.PI / 2 - a, () => lancet(k, 0, 12, 0, 1.4, 11, i % 2 ? glassB : glassA, stone));
      const bx = Math.cos(a) * (nave + 3.5), bz = zB + Math.sin(a) * (nave + 3.5);
      k.rbox('plain', bx, 0, bz, 1.4, 20, 2.2, Math.PI / 2 - a, dark);
      k.pyramid('plain', bx, 20, bz, 1.6, 1.6, 4, dark);
      k.beam('plain', [bx, 18, bz], [Math.cos(a) * nave, 24, zB + Math.sin(a) * nave], 0.8, 0.6, dark);
    }
    // bays: clerestory + aisle lancets, buttresses, flying buttresses
    for (let z = -27; z < 30; z += 6) {
      if (z > tz - 7 && z < tz + 7) continue;
      for (const sx of [-1, 1]) {
        k.at(sx * (nave + 0.02), 0, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => lancet(k, 0, aisleH + 3.4, 0, 1.8, 9.5, (z / 6) % 2 ? glassA : glassB, stone));
        if (z > -14 && z < 22) {
          k.at(sx * (aisle + 0.02), 0, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => lancet(k, 0, 3, 0, 1.6, 7.6, glassA, stone));
          const bx = sx * (aisle + 1.8), bz = z + 3;
          k.box('plain', bx, 0, bz, 2.2, 19, 1.4, dark);
          k.pyramid('plain', bx, 19, bz, 1.6, 1.6, 4.5, dark);
          k.ball('plain', bx, 23.6, bz, 0.25, dark, 5, 3);
          k.beam('plain', [bx, 17.5, bz], [sx * nave, 24.5, bz], 0.7, 0.6, dark);
          k.beam('plain', [bx, 14, bz], [sx * nave, 19, bz], 0.55, 0.5, dark);
        }
      }
    }
    // west front: twin towers with openwork spires, rose window, portals
    const towerS = 12, tH = 52;
    let top = 0;
    for (const sx of [-1, 1]) {
      const x = sx * 12;
      k.box('plain', x, 0, zF - towerS / 2, towerS, tH, towerS, stone, { top: 'roof_flat', topColor: 0x6a655c });
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
        k.box('plain', x + cx * (towerS / 2 - 0.4), 0, zF - towerS / 2 + cz * (towerS / 2 - 0.4), 1.6, tH - 3, 1.6, dark);
        k.pyramid('plain', x + cx * (towerS / 2 - 0.4), tH, zF - towerS / 2 + cz * (towerS / 2 - 0.4), 1.8, 1.8, 7, dark);
      }
      for (let f = 0; f < 4; f++)
        k.at(x, 0, zF - towerS / 2, (f * Math.PI) / 2, () => {
          for (const lx of [-2.2, 2.2]) lancet(k, lx, 36, towerS / 2 + 0.03, 2.2, 12, 0x1c1c22, stone, 'plain');
          if (f === 0) lancet(k, 0, 22, towerS / 2 + 0.03, 2, 7, glassA, stone);
        });
      k.at(x, 0, zF + 0.03, 0, () => {
        for (let j = 0; j < 3; j++) lancet(k, 0, 0.1, 0.25 * j, 4.4 - j * 0.8, 9 - j * 0.9, j === 2 ? 0x2a2420 : stone, dark, 'plain');
      });
      spire(k, x, tH, zF - towerS / 2, 5.2, 36, dark, 'plain', true);
      if (!k.lo) for (let i = 1; i < 6; i++) {
        const y = tH + i * 6, rr = 5.2 * (1 - (i * 6) / 36 * 0.82);
        for (let q = 0; q < 8; q += 2) k.ball('plain', x + Math.cos((q / 8) * Math.PI * 2 + Math.PI / 8) * rr, y, zF - towerS / 2 + Math.sin((q / 8) * Math.PI * 2 + Math.PI / 8) * rr, 0.35, dark, 5, 3);
      }
      top = Math.max(top, tH + 38.4);
      k.light(x, 28, zF + 3, 0xffe0b8, 26, 'flood');
    }
    // central gable: portals, gallery of kings, rose window
    k.at(0, 0, zF + 0.03, 0, () => {
      for (let j = 0; j < 4; j++) lancet(k, 0, 0.1, 0.25 * j, 6 - j * 0.9, 12 - j * 1.1, j === 3 ? 0x2a2420 : stone, dark, 'plain');
      k.beam('plain', [-3.6, 12.5, 0.6], [0, 17, 0.6], 0.6, 0.5, dark);
      k.beam('plain', [3.6, 12.5, 0.6], [0, 17, 0.6], 0.6, 0.5, dark);
      if (!k.lo) for (let i = 0; i < 6; i++) statueFigure(k, -4.6 + i * 1.84, 17.6, 0.5, 1.1, dark);
      k.box('plain', 0, 17.3, 0.4, 12, 0.3, 1.0, dark);
      roseWindow(k, 0, 24, 0.1, 4.6, stone);
    });
    // crossing flèche
    spire(k, 0, naveH + 11, tz, 1.8, 20, lead, 'roof_metal', true);
    k.cyl('plain', 0, naveH + 8, tz, 2, 2, 3.4, dark, 8);
    top = Math.max(top, naveH + 33);
    // grounds, lamps, floodlights
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) tree(k, themeTree(k.ctx, 'shade'), sx * (W / 2 - 4), -30 + i * 14, 0.9, i + sx);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 8, 4.4, 'classic', 0);
    k.light(0, 22, zF + 6, 0xffe0b8, 24, 'flood');
    for (const sx of [-1, 1]) k.light(sx * 16, 12, tz, 0xffe0b8, 22, 'flood');
    crowd(k, 0, 42, 40, 8, 14);
    return top;
  },

  // ── Indoor arena (LED skin) ─────────────────────────────────────────────
  arena(k) {
    const W = k.W, D = k.D;
    const r = k.ctx.rng;
    plaza(k, 0xcac6c0, 0xa8a49c);
    const sz = 0.84;
    const s = k.seg(32);
    k.rev('wall_glass', 0, 0, -2, [[28.4, 0], [28.4, 6]], 0x5a7890, s, { sz });
    k.rev('plain', 0, 0, -2, [[28.2, 6], [31.2, 6]], 0xdcdfe2, s, { sz });
    const prof: P2[] = [[31.2, 6], [32.8, 13], [33, 20], [31.4, 27], [27.4, 32], [20, 35], [9, 36.3], [0, 36.5]];
    k.rev('plain', 0, 0, -2, prof, 0xe9ecef, s, { sz, crease: 80 });
    // LED diagrid over the skin
    const colA = r.pick([0x7a4dff, 0x2a8aff, 0xff3a6a]), colB = 0x36d6ff;
    const helices = k.lo ? 8 : 16, steps = 7;
    const onSkin = (t: number, f: number): V3 => {
      const idx = f * 4, j = Math.min(3, Math.floor(idx)), g = idx - j;
      const [ra, ya] = prof[j], [rb, yb] = prof[j + 1];
      const rr = ra + (rb - ra) * g + 0.15, yy = ya + (yb - ya) * g;
      return [Math.cos(t) * rr, yy, -2 + Math.sin(t) * rr * sz];
    };
    for (let h = 0; h < helices; h++)
      for (const dir of [1, -1]) {
        for (let i = 0; i < steps; i++) {
          const t0 = (h / helices) * Math.PI * 2 + dir * (i / steps) * 1.2, t1 = (h / helices) * Math.PI * 2 + dir * ((i + 1) / steps) * 1.2;
          k.beam('neon', onSkin(t0, i / steps), onSkin(t1, (i + 1) / steps), 0.22, 0.16, dir > 0 ? colA : colB);
        }
      }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = onSkin(a, 0.5);
      k.light(p[0] * 1.02, p[1], -2 + (p[2] + 2) * 1.02, i % 2 ? colA : colB, 12, 'neon');
    }
    // skylight ring on the roof
    k.torus('metal', 0, 36.1, -2, 12, 1.1, 0xc4ccd4, s, 5);
    // entrance canopy + LED pylon with lettering
    k.box('metal', 0, 5.6, 26, 26, 0.6, 7, 0xd8dade, { bottom: true });
    for (const sx of [-1, 1]) k.cyl('metal', sx * 12, 0, 29, 0.3, 0.3, 5.6, 0x9aa0a6, 8);
    for (let i = 0; i < 6; i++) k.light(-10 + i * 4, 5.3, 27, C.lampCool, 2.6, 'lamp');
    const px = W / 2 - 7, pz = D / 2 - 6;
    k.box('metal', px, 0, pz, 5, 15, 1.2, 0x1e2126);
    k.box('emissive', px, 2, pz + 0.62, 4.4, 9, 0.05, 0x3a2a8a, { top: false });
    k.word('ARENA', px, 11.8, pz + 0.66, 0.9, colB, 'neon', 0.06);
    k.light(px, 7, pz + 1.2, colA, 9, 'neon');
    // parking, trees, crowd
    parkingLot(k, -W / 2 + 13, D / 2 - 8, 22, 12, 0.7);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 3), -24 + i * 12, 0.75, i + sx);
    crowd(k, 0, 32, 30, 6, 16);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 6, 'modern', 0);
    return 37;
  },

  // ── Aquarium (waterfront) ───────────────────────────────────────────────
  aquarium(k) {
    const W = k.W, D = k.D;
    plaza(k, 0xd8d6d0, 0xb4b0a8);
    quay(k, 0, -D / 2 + 6, W, 6);
    // dolphin lagoon with a glass shark tunnel
    k.box('concrete', 17, -1.5, -14, 26, 2, 14, 0xa8a49c, { top: false });
    k.flat('water', 17, -14, 25, 13, 0.25, 0x2f8fa8);
    k.barrel('glass', 17, 0.3, -14, 3.6, 24, 3, 0x9fd6e0, k.seg(10), true);
    for (let x = 6; x <= 28; x += 5.5) k.box('concrete', x, -1, -14, 0.6, 1.3, 4, 0x8a8680);
    // wave-roofed halls
    const x0 = -28, x1 = 4, zb = -17, zf = 8;
    const roofY = (x: number, z: number) => 9 + 3.6 * Math.sin(x * 0.16 + 0.8) + (zf - z) * 0.08;
    k.surface('roof_metal', k.seg(24), 4, (u, v) => {
      const x = x0 - 2 + (x1 - x0 + 4) * u, z = zf + 2 - (zf - zb + 4) * v;
      return [x, roofY(x, z) + 0.2, z];
    }, 0x3f8ab0, true);
    profileWall(k, 'wall_glass', [x0, zf], [x1, zf], k.seg(24), roofY, 0x7fb8d0, [0, 0, 1]);
    profileWall(k, 'plain', [x1, zb], [x0, zb], k.seg(24), roofY, 0xe8eaec, [0, 0, -1]);
    profileWall(k, 'wall_glass', [x0, zb], [x0, zf], 5, roofY, 0x7fb8d0, [-1, 0, 0]);
    profileWall(k, 'wall_glass', [x1, zf], [x1, zb], 5, roofY, 0x7fb8d0, [1, 0, 0]);
    // cylindrical ocean tank
    k.cyl('plain', 14, 0, 2, 6, 6, 11, 0x3f9fc0, k.seg(20));
    for (const y of [0.4, 3.9, 7.4]) k.cyl('metal', 14, y, 2, 6.08, 6.08, 0.35, 0xc8ccd0, k.seg(20), false);
    if (!k.lo) for (let i = 0; i < 7; i++) { const a = i * 0.9; k.ball('plain', 14 + Math.cos(a) * 6.02, 2 + (i % 4) * 2.2, 2 + Math.sin(a) * 6.02, 0.35, [0xf2a030, 0xf4f4f0, 0xe0414f][i % 3], 6, 4, 0.5, 1.6); }
    k.disc('water', 14, 11.05, 2, 5.9, 0x2f8fa8, k.seg(20));
    k.torus('neon', 14, 11, 2, 6.05, 0.15, 0x3ae0ff, k.seg(20), 4);
    k.light(14, 6, 2, 0x3ac8ff, 14, 'neon');
    // whale-tail fountain sculpture
    const wx = -8, wz = 16;
    k.cyl('concrete', wx, 0, wz, 4.5, 4.5, 0.6, 0xd8d2c4, 18, false);
    k.disc('water', wx, 0.5, wz, 4.1, 0x3f9ab0, 18);
    k.rev('metal', wx, 0.4, wz, [[0.9, 0], [0.7, 2.5], [0.45, 4.5]], 0x3a5a6e, 10);
    for (const sx of [-1, 1]) foliageBlob(k, wx + sx * 1.8, 5.4, wz, 2.2, 0.7, 0.9, 0x3a5a6e, sx + 5, 0.1, 1);
    k.emitter('fountain', wx, 0.8, wz + 2, 0.6);
    k.emitter('fountain', wx, 0.8, wz - 2, 0.6);
    // neon fish logo on the facade
    k.push(new THREE.Matrix4().makeTranslation(-12, 5.5, zf + 0.25).multiply(new THREE.Matrix4().makeScale(1.6, 1, 1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.torus('neon', 0, 0, 0, 1.2, 0.12, 0xff8a3a, 16, 4);
    k.pop();
    k.beam('neon', [-9.9, 5.5, zf + 0.25], [-8.6, 6.6, zf + 0.25], 0.16, 0.12, 0xff8a3a);
    k.beam('neon', [-9.9, 5.5, zf + 0.25], [-8.6, 4.4, zf + 0.25], 0.16, 0.12, 0xff8a3a);
    k.box('metal', -12, 0.05, zf + 1.4, 8, 3.2, 2.8, 0xdadcde, { bottom: true, top: 'roof_metal' });
    // jetty + boat, promenade, trees
    jetty(k, -20, -D / 2 + 6, 3, 8);
    boat(k, -15, -D / 2 + 1, Math.PI / 2, 'yacht', 0xf4f4f4, -0.3);
    for (let i = 0; i < 5; i++) tree(k, themeTree(k.ctx, 'formal'), -W / 2 + 4 + i * 6.5, D / 2 - 3, 0.7, i);
    for (const x of [6, 14, 22]) bench(k, x, 15, Math.PI);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.4, 'modern', 0);
    for (const x of [-22, -10, 0]) flood(k, x, zf + 4, 8, 14, 0xa8e0ff);
    crowd(k, 0, 14, 36, 6, 12);
    return 24;
  },

  // ── Central station (terminus) ──────────────────────────────────────────
  central_station(k) {
    const W = k.W, D = k.D;
    const look = civicLook(k.ctx);
    const stone = mix(0xe8dcc2, look.wallColor, 0.2);
    const trim = 0xf4ecda;
    const iron = 0x3a4048;
    k.lot('paving', 0xc8c0b0, 0.2, 0.05);
    // platforms and tracks under the shed (tracks run along Z)
    const zs = -D / 2 + 0.4, ze = 8;
    for (let i = 0; i < 5; i++) {
      const x = -24 + i * 12;
      k.at(x - 3, 0, 0, Math.PI / 2, () => track(k, -ze, -zs, 0));
      k.at(x + 3, 0, 0, Math.PI / 2, () => track(k, -ze, -zs, 0));
      if (i < 4) k.box('concrete', x + 6, 0, (zs + ze) / 2, 5, 1.0, ze - zs, 0xb8b4aa, { top: 'paving', topColor: 0xc8c2b4 });
    }
    for (let i = 0; i < 4; i++) railCar(k, -24 + i * 12 + (i % 2 ? 3 : -3), -D / 2 + 12, Math.PI / 2, [0xc8322b, 0x2d7fd0, 0xe8e8e4, 0x3f8a5a][i], 20, i === 0 ? 'loco' : 'coach');
    // side walls and the arched iron-and-glass shed
    for (const sx of [-1, 1]) k.box('wall_brick', sx * 32, 0, (zs + ze) / 2 + 2, 2, 10, ze - zs - 4, 0xa4523c, { top: 'concrete', topColor: 0x9a968e });
    const span = 64, len = ze - zs - 6, rise = 16, cz = (zs + ze) / 2 + 3, y0 = 10;
    k.barrel('glass', 0, y0, cz, span, len, rise, 0xa8c4d0, k.seg(16), false);
    const ribs = Math.round(len / 5);
    for (let i = 0; i <= ribs; i++) {
      const z = cz - len / 2 + (len * i) / ribs;
      const pts: V3[] = [];
      const n = k.seg(14);
      for (let j = 0; j <= n; j++) { const t = (j / n) * Math.PI; pts.push([Math.cos(t) * (span / 2 + 0.1), y0 + Math.sin(t) * (rise + 0.1), z]); }
      k.polyPipe('metal', pts, i % 3 === 0 ? 0.4 : 0.22, iron, 4);
    }
    for (const t of [0.35, 0.7, 1.0, 1.3, 1.57, 1.84, 2.14, 2.44, 2.79]) {
      const x = Math.cos(t) * (span / 2 + 0.15), y = y0 + Math.sin(t) * (rise + 0.15);
      k.beam('metal', [x, y, cz - len / 2], [x, y, cz + len / 2], 0.2, 0.2, iron);
    }
    // head building
    const hz = 14, hd = 12;
    k.box('wall_stone', 0, 0, hz, 80, 18, hd, stone, { top: 'roof_flat', topColor: 0x5a5d62 });
    k.box('plain', 0, 17.6, hz, 80.8, 0.8, hd + 0.8, trim);
    for (const sx of [-1, 1]) {
      k.box('wall_stone', sx * 36, 0, hz + 0.5, 8, 22, hd + 1, stone, { top: false });
      k.mansard('roof_metal', sx * 36, 22, hz + 0.5, 8.4, hd + 1.4, 4, 1.4, C.roofDark);
    }
    // central pavilion with a great lunette window and clock
    k.box('plain', 0, 0, hz + 1, 26, 28, hd + 2, stone, { top: 'roof_flat', topColor: 0x5a5d62 });
    archWindow(k, 0, 4, hz + hd / 2 + 1.05, 17, 19, trim, 0x5a7890);
    if (!k.lo) {
      for (let i = 1; i < 6; i++) k.box('metal', -8.5 + i * (17 / 6), 4, hz + hd / 2 + 1.12, 0.18, 10.5 + Math.sin((i / 6) * Math.PI) * 8.3, 0.08, iron);
      k.box('metal', 0, 9.5, hz + hd / 2 + 1.12, 17, 0.2, 0.08, iron);
    }
    k.box('plain', 0, 27.6, hz + 1, 27, 0.9, hd + 3, trim);
    clockFace(k, 0, 25.8, hz + hd / 2 + 1.1, 1.6, C.gold);
    for (const sx of [-1, 1]) statueFigure(k, sx * 8, 28.5, hz + hd / 2, 1.6, 0xd8d0c0, 0, 'raise');
    k.word('STATION', 0, 19, hz + hd / 2 + 1.12, 1.3, C.gold, 'emissive', 0.08);
    // clock tower on the corner
    const cx = 30, czT = hz - 2;
    k.box('wall_stone', cx, 0, czT, 7, 32, 7, stone, { top: false });
    k.box('plain', cx, 31.6, czT, 7.8, 0.6, 7.8, trim);
    for (let s = 0; s < 4; s++) k.at(cx, 0, czT, (s * Math.PI) / 2, () => clockFace(k, 0, 29, 3.52, 2, C.gold, 2.1, 0.3));
    k.pyramid('roof_metal', cx, 32.2, czT, 7.4, 7.4, 7.8, C.copper);
    k.cyl('metal', cx, 40, czT, 0.06, 0.04, 1.6, C.gold, 4);
    // canopy, taxis, buses, lamps, flags
    k.box('glass', 0, 4.6, hz + hd / 2 + 3.5, 60, 0.2, 5, 0xa9c0c8, { bottom: true });
    for (let x = -28; x <= 28; x += 7) k.cyl('metal', x, 0, hz + hd / 2 + 5.6, 0.14, 0.14, 4.6, iron, 6, false);
    for (let i = 0; i < 8; i++) k.light(-26 + i * 7.4, 4.4, hz + hd / 2 + 3.5, C.lampWarm, 2.4, 'lamp');
    for (let i = 0; i < 4; i++) taxi(k, -20 + i * 5.5, D / 2 - 5, 0);
    bus(k, 16, D / 2 - 5, 0, 0x2d7fd0);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.6, 'classic', 0);
    crowd(k, 0, hz + hd / 2 + 4, 50, 4, 18);
    for (const x of [-20, 0, 20]) flood(k, x, D / 2 - 2, 14, 20, 0xffe6c4);
    return 42;
  },

  // ── Botanical dome + supertrees ─────────────────────────────────────────
  botanical_dome(k) {
    const W = k.W, D = k.D;
    k.lot('grass', lawnColor(k.ctx, 0.7), 0.2, 0.05);
    const dx = -8, dz = -8;
    const prof: P2[] = [[24, 0], [23.8, 8], [21.5, 18], [16.5, 28], [9, 35.5], [0, 38.5]];
    k.cyl('concrete', dx, 0, dz, 24.6, 24.6, 1.4, 0xc8c4bc, k.seg(32));
    k.rev('wall_glass', dx, 1.4, dz, prof, 0xcfe6ec, k.seg(32), { sz: 0.8, crease: 80, vArc: true });
    revRibs(k, dx, 1.4, dz, prof, 1, 0.8, k.lo ? 10 : 20, [1, 2, 3, 4], 0xf2f4f4, 0.3, 0.1);
    k.emitter('steam', dx, 40, dz, 0.4);
    // entrance link
    k.box('wall_glass', dx, 0, dz + 21, 14, 5, 6, 0x9ac4d0, { top: 'grass', topColor: lawnColor(k.ctx, 0.9) });
    // paths, pond with a rocky waterfall
    path(k, [[dx, dz + 24], [dx + 2, 18], [8, 26], [10, D / 2]], 3.2, 0xd8ccb0);
    path(k, [[dx + 2, 18], [-26, 26], [-W / 2, 30]], 2.6, 0xd8ccb0);
    pond(k, -26, 12, 7, 5, 3, false);
    for (let i = 0; i < 6; i++) k.ball('concrete', -26 + (i - 2.5) * 1.8, 1.2 + (i % 3) * 1.1, 6 + (i % 2), 1.6 + (i % 3) * 0.5, 0x7a7468, 6, 4, 0.8);
    k.box('water', -26, 0.2, 7.9, 3, 4.6, 0.3, 0x6fb8c8, { top: false });
    k.emitter('fountain', -26, 5, 8, 0.8);
    k.emitter('steam', -26, 1.5, 9, 0.5);
    // supertree grove with a skyway
    const trees: [number, number, number, number][] = [[22, 16, 22, 0xd070ff], [32, 0, 18, 0xff5ab0], [14, 30, 16, 0x7a8aff], [30, 28, 20, 0xd070ff]];
    for (const [x, z, h, g] of trees) supertree(k, x, z, h, g);
    const deck = (a: V3, b: V3) => {
      k.beam('metal', a, b, 2.2, 0.35, 0xdcdcd8);
      for (const s of [-1, 1]) k.beam('metal', [a[0] + s * 1.0, a[1] + 1.1, a[2]], [b[0] + s * 1.0, b[1] + 1.1, b[2]], 0.08, 0.08, 0x8a8e92);
    };
    deck([22, 14, 16], [30, 14, 28]);
    deck([22, 14, 16], [32, 14, 0]);
    // flower beds, trees, visitors
    flowerBed(k, 6, 8, 6, 3);
    flowerBed(k, -30, -30, 6, 3, [0xf2c230, 0xe0414f]);
    treeGrove(k, 0, 0, W - 6, D - 6, 12, 'shade', (x, z) => Math.hypot(x - dx, (z - dz) / 0.8) < 28 || (x > 8 && z > -8) || (Math.abs(x - 2) < 8 && z > 14), [0.7, 1.1]);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 12, 4.4, 'modern', 0);
    crowd(k, 4, 22, 22, 8, 12);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.light(dx + Math.cos(a) * 25, 3, dz + Math.sin(a) * 20, 0x9fe8c8, 16, 'flood');
    }
    return 40;
  },

  // ── TV tower ────────────────────────────────────────────────────────────
  tv_tower(k) {
    const W = k.W, D = k.D;
    plaza(k, 0xd2cec6, 0xb0aca4);
    const s = k.seg(20);
    // podium + tripod buttresses
    k.cyl('wall_glass', 0, 0, 0, 11, 11, 5, 0x7f9fb4, s);
    k.cyl('concrete', 0, 5, 0, 11.6, 11.6, 0.8, 0xe8e6e0, s);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      k.beam('concrete', [Math.cos(a) * 9, 5.6, Math.sin(a) * 9], [Math.cos(a) * 4.4, 30, Math.sin(a) * 4.4], 2.2, 1.6, 0xd6d4ce);
    }
    // shaft
    k.rev('concrete', 0, 5.6, 0, [[5, 0], [4.3, 50], [3.5, 140], [3, 190]], 0xd6d4ce, s, { crease: 60 });
    for (const y of [60, 120, 170]) k.torus('concrete', 0, y, 0, 3.9 - (y / 190) * 0.8, 0.25, 0xbcb8b0, s, 4);
    // the sphere with a revolving restaurant band
    const sy = 212, R = 15;
    k.cyl('concrete', 0, 195, 0, 3, 3, 8, 0xd6d4ce, s);
    k.ball('metal', 0, sy, 0, R, 0xb8bcc2, k.seg(28), k.seg(18));
    k.rev('wall_glass', 0, sy - 3.4, 0, [[R * 0.97, 0], [R * 1.015, 2.2], [R * 1.015, 4], [R * 0.99, 6]], 0xa8c0d0, k.seg(28), { crease: 60 });
    k.rev('emissive', 0, sy - 4.6, 0, [[R * 0.958, 0], [R * 0.972, 1.2]], 0xffdca0, k.seg(28));
    k.anim([0, sy, 0], [0, 1, 0], 0.04, (a) => {
      const n = k.lo ? 12 : 28;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        a.box('metal', Math.cos(t) * R * 1.02, sy - 1.2, Math.sin(t) * R * 1.02, 0.16, 3.6, 0.16, 0x6a6e72);
      }
    });
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      k.light(Math.cos(t) * R * 1.05, sy + 0.6, Math.sin(t) * R * 1.05, 0xffe0a8, 3.2, 'lamp');
    }
    // upper shaft + red/white antenna
    k.cyl('concrete', 0, sy + R - 1, 0, 2.4, 2, 24, 0xd6d4ce, s);
    const a0 = sy + R + 23, a1 = 365;
    const segsA = 12;
    for (let i = 0; i < segsA; i++) {
      const y0 = a0 + ((a1 - a0) * i) / segsA, y1 = a0 + ((a1 - a0) * (i + 1)) / segsA;
      const r0 = 1.6 - (1.2 * i) / segsA, r1 = 1.6 - (1.2 * (i + 1)) / segsA;
      k.cyl('metal', 0, y0, 0, r0, r1, y1 - y0, i % 2 ? C.red : 0xf2f2f2, 8, i === segsA - 1);
    }
    for (const y of [a0, a0 + 40, a0 + 80, 365]) k.light(1.4, y, 0, C.beaconRed, 3 + y / 100, 'beacon', true);
    k.light(0, 366, 0, 0xffffff, 4, 'beacon', true);
    // plaza: terraced fountains, trees
    for (const sx of [-1, 1]) {
      k.slab('grass', sx * 12, 12, 7, 7, 0.1, lawnColor(k.ctx, 0.7), 0.1);
      tree(k, themeTree(k.ctx, 'formal'), sx * 12, 12, 0.7, sx);
      bench(k, sx * 6, 13.5, Math.PI);
    }
    for (const [x, z] of [[-12, -12], [12, -12]] as P2[]) tree(k, themeTree(k.ctx, 'formal'), x, z, 0.7, x);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      k.light(Math.cos(a) * 12, 40, Math.sin(a) * 12, 0xe8eeff, 24, 'flood');
    }
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 8, 4.2, 'modern', 0);
    crowd(k, 0, 13, 10, 3, 5);
    return 366;
  },

  // ── Sky needle (diagrid spire) ──────────────────────────────────────────
  sky_needle(k) {
    const W = k.W, D = k.D;
    plaza(k, 0xd4d2cc, 0xaca8a0);
    const white = 0xeef0f2;
    const rS = (y: number) => (y <= 340 ? 19 - 10.5 * Math.pow(y / 340, 0.8) : 8.5 - ((y - 340) / 110) * 3);
    // core
    k.rev('concrete', 0, 0, 0, [[6, 0], [4.6, 200], [3.4, 452]], 0xc8c6c0, k.seg(12));
    // diagrid lattice
    const M = k.lo ? 8 : 12;
    const rings: number[] = [];
    for (let y = 0; y <= 336; y += 14) rings.push(y);
    const pt = (ri: number, j: number): V3 => {
      const y = rings[ri], rr = rS(y);
      const a = ((j + (ri % 2) * 0.5) / M) * Math.PI * 2;
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    };
    for (let i = 0; i < rings.length - 1; i++)
      for (let j = 0; j < M; j++) {
        const a = pt(i, j);
        const b1 = pt(i + 1, i % 2 ? j + 1 : j), b0 = pt(i + 1, i % 2 ? j : j - 1);
        k.beam('metal', a, b1, 0.8, 0.8, white);
        k.beam('metal', a, b0, 0.8, 0.8, white);
        if (i % 3 === 0) k.beam('metal', a, pt(i, j + 1), 0.6, 0.6, white);
      }
    // LED lights along the lattice
    for (let i = 2; i < rings.length; i += 3)
      for (let j = 0; j < M; j += 3) { const p = pt(i, j); k.light(p[0], p[1], p[2], 0x7fc8ff, 4, 'neon'); }
    // sky-deck 1
    const d1 = 340;
    k.rev('wall_glass', 0, d1, 0, [[8.6, 0], [15.5, 4], [16, 9], [14.5, 14], [9, 16.5]], 0x9ab4c8, k.seg(24), { crease: 45, bottom: false });
    k.rev('concrete', 0, d1 + 16.5, 0, [[9.2, 0], [6, 1.2]], 0xe0e0dc, k.seg(24), { top: true });
    k.rev('emissive', 0, d1 + 6.5, 0, [[16.1, 0], [16.1, 0.6]], 0x8fd0ff, k.seg(24));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; k.light(Math.cos(a) * 16.4, d1 + 7, Math.sin(a) * 16.4, 0xbfe4ff, 4, 'lamp'); }
    // shaft between decks
    const upper: number[] = [];
    for (let y = d1 + 17; y <= 440; y += 12) upper.push(y);
    for (let i = 0; i < upper.length - 1; i++) k.lattice('metal', 0, 0, upper[i], upper[i + 1], 5.6, 5.4, white, 12, 0.6, 0.25);
    // sky-deck 2 + spire
    const d2 = 440;
    k.rev('wall_glass', 0, d2, 0, [[5.5, 0], [9.2, 3], [9.4, 6.5], [8, 9], [5, 10.5]], 0x9ab4c8, k.seg(20), { crease: 45 });
    k.rev('concrete', 0, d2 + 10.5, 0, [[5.2, 0], [2.4, 1.4]], 0xe0e0dc, k.seg(20), { top: true });
    k.rev('emissive', 0, d2 + 4.5, 0, [[9.5, 0], [9.5, 0.5]], 0x8fd0ff, k.seg(20));
    k.cyl('metal', 0, d2 + 11.9, 0, 2.2, 0.35, 520 - d2 - 11.9, 0xd8dade, 8);
    for (const y of [470, 495]) k.torus('metal', 0, y, 0, 2.2 - ((y - d2) / 80) * 1.8 + 0.3, 0.2, 0xb8bcc0, 10, 4);
    for (const y of [300, 360, 452, 490, 520]) k.light(2, y, 0, C.beaconRed, 3 + y / 120, 'beacon', true);
    k.light(0, 521, 0, 0xffffff, 5, 'beacon', true);
    // base: curved podium building + plaza
    k.rev('wall_glass', 0, 0, 0, [[21.5, 0], [21.5, 8]], 0x8fb0c4, k.seg(24), { a0: 0.4, a1: Math.PI - 0.4 });
    k.rev('wall_glass', 0, 0, 0, [[19.6, 0], [19.6, 8]], 0x8fb0c4, k.seg(24), { a0: 0.4, a1: Math.PI - 0.4, inside: true });
    k.ring('roof_flat', 0, 8, 0, 19.6, 21.5, 0x6a6d70, k.seg(24), 0.4, Math.PI - 0.4);
    for (const sx of [-1, 1]) tree(k, themeTree(k.ctx, 'formal'), sx * (W / 2 - 3), -D / 2 + 3, 0.7, sx);
    lampsAlong(k, [[-W / 2 + 2, D / 2 - 1.5], [W / 2 - 2, D / 2 - 1.5]], 10, 4.2, 'modern', 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.light(Math.cos(a) * 18, 60, Math.sin(a) * 18, 0x9fd0ff, 30, 'flood');
    }
    crowd(k, 0, 22, 30, 3, 10);
    return 521;
  },
};

export const LANDMARK_MODELS = models(M);
