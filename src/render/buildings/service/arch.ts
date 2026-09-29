// Architectural & engineering assemblies shared by many service models:
// wind turbines, cooling towers, industrial halls, clarifiers, garages,
// grandstands, floodlight masts, hangars, spires, clock faces, porticos,
// geodesic domes, quays, radar, antennas… Everything is built in the Kit's
// current frame (local metres, +Z = front/road side).
import * as THREE from 'three';
import type { ColorLike } from '../ModelBuilder';
import type { MatKey } from '../types';
import { Kit, type P2, type V3 } from './kit';
import { C, shade, mix } from './colors';
import { lampPost } from './props';

// ── wind turbines ──────────────────────────────────────────────────────────
export interface TurbineOpts {
  hub: number;
  blade: number;
  y0?: number;
  base?: number;
  color?: ColorLike;
  speed?: number;
  phase?: number;
  /** nacelle yaw (radians, 0 = rotor facing +Z) */
  yaw?: number;
  foundation?: 'ground' | 'monopile';
}

function turbineBlade(k: Kit, L: number, chord: number, color: ColorLike): void {
  const n = k.lo ? 3 : 6;
  const st: { y: number; c: number; tw: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = t < 0.22 ? chord * (0.55 + (t / 0.22) * 0.45) : chord * (1 - ((t - 0.22) / 0.78) * 0.78);
    st.push({ y: 1.1 + t * (L - 1.1), c, tw: (1 - t) * 0.42 });
  }
  const pt = (s: { y: number; c: number; tw: number }, f: number, side: number): THREE.Vector3Like => {
    const x = s.c * f;
    const th = s.c * 0.09 * (1 - Math.abs(f - 0.05) * 1.2) * side;
    return { x: x * Math.cos(s.tw) - th * Math.sin(s.tw), y: s.y, z: x * Math.sin(s.tw) + th * Math.cos(s.tw) };
  };
  const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < n; i++) {
    const a = st[i], b = st[i + 1];
    // front (+Z) and back faces, leading-edge (-X) and trailing-edge strips
    k.quad('plain', pt(a, -0.3, 1), pt(a, 0.7, 1), pt(b, 0.7, 1), pt(b, -0.3, 1), uv, color, { x: 0, y: 0, z: 1 });
    k.quad('plain', pt(a, 0.7, -1), pt(a, -0.3, -1), pt(b, -0.3, -1), pt(b, 0.7, -1), uv, shade(color, 0.93), { x: 0, y: 0, z: -1 });
    k.quad('plain', pt(a, -0.3, -1), pt(a, -0.3, 1), pt(b, -0.3, 1), pt(b, -0.3, -1), uv, color, { x: -1, y: 0, z: 0 });
    k.quad('plain', pt(a, 0.7, 1), pt(a, 0.7, -1), pt(b, 0.7, -1), pt(b, 0.7, 1), uv, color, { x: 1, y: 0, z: 0 });
  }
  k.cyl('plain', 0, 0, 0, chord * 0.28, chord * 0.26, 1.3, color, 8, false);
}

/** Horizontal-axis 3-blade wind turbine with animated rotor + aviation beacon. */
export function windTurbine(k: Kit, x: number, z: number, o: TurbineOpts): number {
  const y0 = o.y0 ?? 0;
  const H = o.hub, L = o.blade;
  const base = o.base ?? Math.max(1.6, H * 0.034);
  const col = o.color ?? 0xf2f3f1;
  k.pushTRS(x, y0, z, o.yaw ?? 0);
  if (o.foundation === 'monopile') {
    k.cyl('metal', 0, -14, 0, base * 1.35, base * 1.35, 14, 0x3a3f44, k.seg(14), false);
    k.cyl('plain', 0, -0.6, 0, base * 1.4, base * 1.4, 9, C.yellow, k.seg(14));
    k.ring('metal', 0, 6.8, 0, base * 1.4, base * 2.8, 0x6a6e72, k.seg(14));
    k.box('metal', base * 2.2, 6.8, 0, 1.2, 1.2, 1.2, 0x9aa0a6);
    if (!k.lo) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.box('metal', Math.cos(a) * base * 2.7, 6.8, Math.sin(a) * base * 2.7, 0.08, 1.1, 0.08, C.yellow);
    }
  } else {
    k.cyl('concrete', 0, -0.8, 0, base * 2.6, base * 2.5, 1.2, C.concreteLight, k.seg(16));
    k.box('metal', base * 2.9, 0, base * 0.6, 1.8, 2.3, 1.4, 0xd8dad6);
    k.box('metal', 0, 0.4, base * 0.98, 0.9, 2.1, 0.1, 0x9aa0a6);
  }
  const ty0 = o.foundation === 'monopile' ? 8.4 : 0.4;
  const segs = k.seg(16);
  k.rev('plain', 0, ty0, 0, [[base, 0], [base * 0.86, (H - ty0) * 0.45], [base * 0.62, H - ty0 - 2.4]], col, segs, { crease: 60 });
  if (!k.lo) k.cyl('plain', 0, ty0, 0, base * 1.01, base * 1.0, 3.2, mix(col, 0x7aa36a, 0.35), segs, false);
  // nacelle
  const nl = Math.max(5, L * 0.24), nh = Math.max(2.4, L * 0.075), nw = Math.max(2.2, L * 0.068);
  const ny = H - nh * 0.55;
  k.box('plain', 0, ny, -nl * 0.28, nw, nh, nl, col);
  k.box('plain', 0, ny + nh, -nl * 0.3, nw * 0.9, 0.18, nl * 0.85, shade(col, 0.95));
  k.box('metal', 0, ny + nh + 0.18, -nl * 0.62, 0.12, 1.4, 0.12, 0x777777);
  k.light(0, ny + nh + 1.7, -nl * 0.62, C.beaconRed, Math.max(3, L * 0.09), 'beacon', true);
  const hz = nl * 0.22 + nh * 0.25;
  const hubY = ny + nh * 0.5;
  const spin = o.speed ?? Math.max(0.55, 26 / L);
  const phase = o.phase ?? 0;
  k.anim([0, hubY, hz], [0, 0, 1], spin, (r) => {
    r.pushTRS(0, hubY, hz, 0);
    // spinner (rotated so its axis points +Z)
    r.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    r.rev('plain', 0, -nh * 0.3, 0, [[nh * 0.52, 0], [nh * 0.5, nh * 0.35], [nh * 0.34, nh * 0.85], [0, nh * 1.15]], col, k.seg(12), { crease: 70 });
    r.pop();
    for (let b = 0; b < 3; b++) {
      r.push(new THREE.Matrix4().makeRotationZ(phase + (b * Math.PI * 2) / 3));
      turbineBlade(r, L, L * 0.075, col);
      r.pop();
    }
    r.pop();
  });
  k.pop();
  return H + L;
}

// ── cooling tower ──────────────────────────────────────────────────────────
export function coolingTower(k: Kit, x: number, z: number, H: number, R: number, color: ColorLike = 0xd2d0ca, emit = true, rate = 1): void {
  const legH = Math.max(3, H * 0.06);
  const n = k.lo ? 7 : 12;
  const prof: P2[] = [];
  const throatY = H * 0.78, rT = R * 0.58, rTop = R * 0.64;
  for (let i = 0; i <= n; i++) {
    const y = legH + (i / n) * (H - legH);
    let r: number;
    if (y < throatY) {
      const t = (throatY - y) / (throatY - legH);
      r = rT + (R - rT) * Math.pow(t, 1.7);
    } else {
      const t = (y - throatY) / (H - throatY);
      r = rT + (rTop - rT) * t * t;
    }
    prof.push([r, y]);
  }
  const segs = k.seg(30);
  k.rev('concrete', x, 0, z, prof, color, segs, { crease: 80 });
  k.rev('concrete', x, 0, z, prof.map(([r, y]) => [r - 0.6, y] as P2), shade(color, 0.62), segs, { crease: 80, inside: true });
  // weathering band at top + rim
  k.rev('concrete', x, 0, z, prof.slice(n - 1).map(([r, y]) => [r + 0.05, y] as P2), shade(color, 0.86), segs, { crease: 80 });
  k.ring('concrete', x, H, z, rTop - 0.6, rTop + 0.05, shade(color, 0.8), segs);
  // diagonal leg colonnade
  const legs = k.lo ? 12 : 28;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2, b = ((i + 0.5) / legs) * Math.PI * 2;
    k.beam('concrete', [x + Math.cos(a) * R * 1.02, 0, z + Math.sin(a) * R * 1.02], [x + Math.cos(b) * R, legH + 0.2, z + Math.sin(b) * R], 0.55, 0.55, shade(color, 0.9));
  }
  k.disc('water', x, 0.4, z, R * 0.98, 0x5e7780, segs);
  if (emit) {
    k.emitter('steam', x, H + 2, z, rate);
    if (!k.lo) k.emitter('steam', x + rTop * 0.4, H + 2, z - rTop * 0.3, rate * 0.7);
  }
  k.light(x + rTop, H - 1, z, C.beaconRed, 3, 'beacon', true);
  k.light(x - rTop, H - 1, z, C.beaconRed, 3, 'beacon', true);
}

// ── industrial halls ───────────────────────────────────────────────────────
export interface HallOpts {
  wall?: MatKey;
  color?: ColorLike;
  roof?: 'shed' | 'gable' | 'barrel' | 'flat' | 'saw';
  roofColor?: ColorLike;
  rise?: number;
  y0?: number;
  /** roll-up doors on the front (+Z) face */
  doors?: number;
  doorColor?: ColorLike;
  skylights?: boolean;
}

/** Industrial / utility hall with the requested roof. Returns the roof top. */
export function hall(k: Kit, x: number, z: number, w: number, d: number, h: number, o: HallOpts = {}): number {
  const wall = o.wall ?? 'wall_industrial';
  const col = o.color ?? 0xc9ccc8;
  const rc = o.roofColor ?? 0x6d737a;
  const y0 = o.y0 ?? 0;
  const roof = o.roof ?? 'gable';
  let top = y0 + h;
  k.box(wall, x, y0, z, w, h, d, col, { top: roof === 'flat' || roof === 'saw' ? 'roof_flat' : false, topColor: rc });
  // base plinth + corner trims
  k.box('concrete', x, y0, z, w + 0.2, 0.7, d + 0.2, 0x8a8780, { top: false });
  switch (roof) {
    case 'gable': {
      const rise = o.rise ?? Math.min(w, d) * 0.12;
      k.gableRoof('roof_metal', x, y0 + h, z, w, d, rise, rc, { overhang: 0.5, wallMat: wall, wallColor: col, ridgeAlongX: w >= d });
      top += rise;
      if (o.skylights && !k.lo) {
        const along = w >= d;
        const span = along ? d : w;
        const run = along ? w : d;
        const ang = Math.atan2(rise, span / 2);
        for (const s of [-1, 1]) {
          const off = span * 0.22 * s;
          const yy = y0 + h + rise * (1 - Math.abs(off) / (span / 2)) + 0.12;
          if (along) k.pushTRS(x, yy, z + off, 0); else k.pushTRS(x + off, yy, z, Math.PI / 2);
          k.push(new THREE.Matrix4().makeRotationX(s > 0 ? ang : -ang));
          k.box('glass', 0, 0, 0, run * 0.8, 0.08, span * 0.12, 0x9fc0d0, { top: 'glass' });
          k.pop();
          k.pop();
        }
      }
      break;
    }
    case 'shed': {
      const rise = o.rise ?? Math.min(3, d * 0.1);
      k.shedRoof('roof_metal', x, y0 + h, z, w, d, rise, rc, 0.4, wall, col);
      top += rise;
      break;
    }
    case 'barrel': {
      const rise = o.rise ?? Math.min(w, d) * 0.16;
      const alongX = w >= d;
      k.barrel('roof_metal', x, y0 + h, z, alongX ? d + 0.8 : w + 0.8, alongX ? w + 0.8 : d + 0.8, rise, rc, k.seg(12), alongX, wall, col);
      top += rise;
      break;
    }
    case 'saw': {
      const teeth = Math.max(2, Math.round(d / 7));
      const td = d / teeth, rise = o.rise ?? 2.6;
      for (let i = 0; i < teeth; i++) {
        const zc = z - d / 2 + td * (i + 0.5);
        // sloped roof (low at front of tooth) + vertical glazing facing -Z (north light)
        k.quad('roof_metal', { x: x - w / 2, y: y0 + h, z: zc + td / 2 }, { x: x + w / 2, y: y0 + h, z: zc + td / 2 }, { x: x + w / 2, y: y0 + h + rise, z: zc - td / 2 }, { x: x - w / 2, y: y0 + h + rise, z: zc - td / 2 }, [[0, 0], [w, 0], [w, td], [0, td]], rc, { x: 0, y: 1, z: 0.3 });
        k.quad('glass', { x: x + w / 2, y: y0 + h, z: zc - td / 2 }, { x: x - w / 2, y: y0 + h, z: zc - td / 2 }, { x: x - w / 2, y: y0 + h + rise, z: zc - td / 2 }, { x: x + w / 2, y: y0 + h + rise, z: zc - td / 2 }, [[0, 0], [w, 0], [w, rise], [0, rise]], 0x7f9fb0, { x: 0, y: 0, z: -1 });
        for (const sx of [-1, 1]) k.tri(wall, { x: x + (sx * w) / 2, y: y0 + h, z: zc + td / 2 }, { x: x + (sx * w) / 2, y: y0 + h, z: zc - td / 2 }, { x: x + (sx * w) / 2, y: y0 + h + rise, z: zc - td / 2 }, [0, 0], [td, 0], [td, rise], col, { x: sx, y: 0, z: 0 });
      }
      top += rise;
      break;
    }
    case 'flat':
      k.parapet(x, y0 + h, z, w, d, 0.6, shade(col, 0.9));
      break;
  }
  if (o.doors) rollDoors(k, x, z + d / 2, Math.min(w - 2, o.doors * 5.2), o.doors, Math.min(h - 1, 5.2), o.doorColor ?? 0xb9bdc0, y0);
  return top;
}

/** row of roll-up doors on a wall facing +Z at z (centred on x) */
export function rollDoors(k: Kit, x: number, z: number, span: number, n: number, h: number, color: ColorLike, y0 = 0, frame: ColorLike = 0x3a3d42): void {
  const dw = span / n;
  for (let i = 0; i < n; i++) {
    const cx = x - span / 2 + dw * (i + 0.5);
    const w = dw * 0.82;
    k.box('metal', cx, y0, z + 0.02, w + 0.3, h + 0.25, 0.12, frame, { top: false });
    k.box('metal', cx, y0, z + 0.08, w, h, 0.1, color, { top: false });
    if (!k.lo) for (let j = 1; j < 6; j++) k.box('metal', cx, y0 + (h * j) / 6, z + 0.14, w, 0.06, 0.04, shade(color, 0.8), { top: false });
    k.box('emissive', cx, y0 + h + 0.35, z + 0.2, 0.5, 0.18, 0.2, C.lampWarm);
    k.light(cx, y0 + h + 0.2, z + 0.7, C.lampWarm, 2.4, 'lamp');
  }
}

/** pipe rack: supports + parallel pipes between two ground points at height h */
export function pipeRack(k: Kit, a: P2, b: P2, h: number, pipes = 3, colors: ColorLike[] = [0xb8bcc0, 0x7a8a9a, C.yellow]): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
  const bents = Math.max(1, Math.round(len / 8));
  for (let i = 0; i <= bents; i++) {
    const t = i / bents;
    const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
    k.beam('metal', [px - nx * 1.2, 0, pz - nz * 1.2], [px - nx * 1.2, h, pz - nz * 1.2], 0.3, 0.3, 0x6a6e72);
    k.beam('metal', [px + nx * 1.2, 0, pz + nz * 1.2], [px + nx * 1.2, h, pz + nz * 1.2], 0.3, 0.3, 0x6a6e72);
    k.beam('metal', [px - nx * 1.4, h, pz - nz * 1.4], [px + nx * 1.4, h, pz + nz * 1.4], 0.3, 0.3, 0x6a6e72);
  }
  for (let p = 0; p < pipes; p++) {
    const o = (p - (pipes - 1) / 2) * 0.8;
    k.pipe('metal', [a[0] + nx * o, h + 0.45, a[1] + nz * o], [b[0] + nx * o, h + 0.45, b[1] + nz * o], 0.3, colors[p % colors.length], 6);
  }
}

// ── water treatment ────────────────────────────────────────────────────────
/** circular clarifier: rim wall, water, weir, rotating bridge */
export function clarifier(k: Kit, x: number, z: number, r: number, water: ColorLike = 0x4d7f7a, speed = 0.12): void {
  const segs = k.seg(28);
  k.cyl('concrete', x, 0, z, r + 0.4, r + 0.4, 1.4, C.concreteLight, segs, false);
  k.rev('concrete', x, 0, z, [[r, 0], [r, 1.4]], shade(C.concrete, 0.8), segs, { inside: true });
  k.ring('concrete', x, 1.4, z, r, r + 0.4, C.concreteLight, segs);
  k.disc('water', x, 1.1, z, r, water, segs);
  k.ring('concrete', x, 1.15, z, r - 1.3, r - 0.9, shade(C.concrete, 0.85), segs);
  k.cyl('concrete', x, 0, z, 1.1, 1.1, 2.4, C.concrete, 10);
  k.anim([x, 0, z], [0, 1, 0], speed, (s) => {
    s.box('metal', x + r / 2, 2.1, z, r + 0.6, 0.35, 1.6, 0xd8d0b8);
    s.box('metal', x + r / 2, 2.45, z - 0.75, r + 0.6, 0.9, 0.05, 0xf2c230, { top: false });
    s.box('metal', x + r / 2, 2.45, z + 0.75, r + 0.6, 0.9, 0.05, 0xf2c230, { top: false });
    s.box('metal', x + r * 0.95, 0.9, z, 0.3, 1.25, 1.2, 0x8a8e92);
  });
}

/** rectangular basin (aeration / settling) with water and walkways */
export function basin(k: Kit, x: number, z: number, w: number, d: number, water: ColorLike = 0x5a8a82, lanes = 1, aeration = false): void {
  const wall = 0.5, h = 1.5;
  k.box('concrete', x, 0, z - d / 2 + wall / 2, w, h, wall, C.concreteLight);
  k.box('concrete', x, 0, z + d / 2 - wall / 2, w, h, wall, C.concreteLight);
  k.box('concrete', x - w / 2 + wall / 2, 0, z, wall, h, d - wall * 2, C.concreteLight);
  k.box('concrete', x + w / 2 - wall / 2, 0, z, wall, h, d - wall * 2, C.concreteLight);
  for (let i = 1; i < lanes; i++) k.box('concrete', x - w / 2 + (w * i) / lanes, 0, z, 0.5, h, d - wall * 2, C.concreteLight);
  k.flat('water', x, z, w - wall * 2, d - wall * 2, 1.15, water);
  if (aeration && !k.lo) {
    const r = k.ctx.rng;
    for (let i = 0; i < Math.round((w * d) / 14); i++) k.disc('plain', x + r.range(-w / 2 + 1, w / 2 - 1), 1.17, z + r.range(-d / 2 + 1, d / 2 - 1), r.range(0.35, 0.8), 0xdfeae6, 7);
  }
  // railings on the long sides
  if (!k.lo) {
    for (const s of [-1, 1]) {
      k.box('metal', x, h + 0.95, z + s * (d / 2 - 0.25), w, 0.06, 0.06, C.yellow);
    }
  }
}

// ── garages & vehicles bays ────────────────────────────────────────────────
/** apparatus bay doors for fire stations (tall, glazed upper panels) */
export function bayDoors(k: Kit, x: number, z: number, n: number, dw: number, dh: number, frame: ColorLike, door: ColorLike): void {
  const span = n * dw;
  for (let i = 0; i < n; i++) {
    const cx = x - span / 2 + dw * (i + 0.5);
    const w = dw - 1.0;
    k.box('plain', cx, 0, z + 0.04, w + 0.5, dh + 0.3, 0.14, frame, { top: false });
    k.box('metal', cx, 0, z + 0.1, w, dh, 0.1, door, { top: false });
    if (!k.lo) {
      for (let j = 1; j < 5; j++) k.box('metal', cx, (dh * j) / 5, z + 0.16, w, 0.05, 0.04, shade(door, 0.75), { top: false });
      k.box('glass', cx, dh * 0.6, z + 0.17, w * 0.9, dh * 0.18, 0.04, 0x2c3a46, { top: false });
    }
    k.light(cx, dh + 0.6, z + 0.6, C.lampWarm, 2.6, 'lamp');
  }
}

// ── stadium parts ──────────────────────────────────────────────────────────
/** stepped seating tiers rising away from the field (local −Z), front edge at z */
export function grandstand(k: Kit, x: number, z: number, len: number, rows: number, seat: ColorLike, rotY = 0, y0 = 0.3, stepH = 0.45, stepD = 0.85, roof = false): number {
  k.at(x, 0, z, rotY, () => {
    const pal = [seat, shade(seat, 0.85)];
    for (let i = 0; i < rows; i++) {
      const zz = -i * stepD;
      k.box('concrete', 0, y0, zz - stepD / 2, len, stepH * (i + 1), stepD, 0xb8b4ac, { top: 'plain', topColor: pal[Math.floor(i / 4) % 2] });
    }
    const back = -rows * stepD;
    k.box('concrete', 0, 0, back - 0.2, len, y0 + stepH * rows + 1.2, 0.4, 0xa8a49c);
    if (roof) {
      const rh = y0 + stepH * rows + 4.5;
      k.box('metal', 0, rh, back / 2 - 0.5, len + 1, 0.4, -back + 3, 0xdcdcd8, { bottom: true });
      for (let i = 0; i <= Math.max(1, Math.round(len / 12)); i++) {
        const xx = -len / 2 + (len * i) / Math.max(1, Math.round(len / 12));
        k.beam('metal', [xx, 0, back - 0.1], [xx, rh, back - 0.1], 0.4, 0.4, 0x8a8e92);
      }
    }
  });
  return y0 + stepH * rows;
}

/** floodlight mast: pole + lamp frame tilted towards (tx, tz) */
export function floodMast(k: Kit, x: number, z: number, h: number, tx: number, tz: number, color: ColorLike = 0x9aa0a6): void {
  k.cyl('metal', x, 0, z, 0.7, 0.4, h, color, 8);
  const ang = Math.atan2(tx - x, tz - z);
  k.at(x, h, z, ang, () => {
    k.box('metal', 0, 0, 0.6, 6, 3.4, 0.4, 0x5a5f65);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 5; c++) k.box('emissive', -2.4 + c * 1.2, 0.3 + r * 1.05, 0.85, 0.9, 0.8, 0.12, 0xfff8e8);
    k.light(0, 1.7, 1.6, 0xf6f8ff, 12, 'flood');
  });
}

// ── hangars, sheds ─────────────────────────────────────────────────────────
/** aircraft / vehicle hangar with barrel roof and big door facing +Z */
export function hangar(k: Kit, x: number, z: number, w: number, d: number, h: number, color: ColorLike = 0xd4d6d2, doorColor: ColorLike = 0x8a929a): void {
  k.box('wall_industrial', x, 0, z, w, h, d, color, { top: false });
  k.barrel('roof_metal', x, h, z, w + 0.6, d + 0.6, Math.min(w * 0.18, 6), shade(color, 0.85), k.seg(12), false, 'wall_industrial', color);
  const dw = w * 0.82;
  k.box('metal', x, 0, z + d / 2 + 0.05, dw, h * 0.92, 0.2, doorColor, { top: false });
  if (!k.lo) for (let i = 1; i < 6; i++) k.box('metal', x - dw / 2 + (dw * i) / 6, 0, z + d / 2 + 0.16, 0.12, h * 0.92, 0.06, shade(doorColor, 0.75), { top: false });
  k.light(x, h - 0.5, z + d / 2 + 0.8, C.lampCool, 3, 'lamp');
}

// ── sacred / historic elements ─────────────────────────────────────────────
/** octagonal spire with optional finial cross */
export function spire(k: Kit, x: number, y0: number, z: number, r: number, h: number, color: ColorLike, mat: MatKey = 'roof_metal', cross = true): void {
  k.rev(mat, x, y0, z, [[r, 0], [r * 0.18, h * 0.92], [0, h]], color, 8, { crease: 20 });
  k.cyl('plain', x, y0 - 0.4, z, r * 1.08, r * 1.08, 0.5, shade(color, 0.8), 8);
  if (cross) {
    k.box('metal', x, y0 + h, z, 0.14, 2.2, 0.14, C.gold);
    k.box('metal', x, y0 + h + 1.3, z, 0.9, 0.14, 0.14, C.gold);
  }
}

/** clock face on a +Z facing plane (in the current frame) */
export function clockFace(k: Kit, x: number, y: number, z: number, r: number, frame: ColorLike = C.gold, hourAngle = 1.1, minAngle = -0.6): void {
  k.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  k.cylinder('plain', 0, -0.2, 0, r + 0.25, r + 0.25, 0.2, frame, 20, { top: true });
  k.cylinder('emissive', 0, 0, 0, r, r, 0.06, 0xf6f0dc, 20, { top: true });
  k.pop();
  if (!k.lo) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box('plain', x + Math.sin(a) * r * 0.82, y + Math.cos(a) * r * 0.82 - 0.12, z + 0.08, 0.1, 0.24, 0.04, 0x222222, { top: false });
  }
  k.beam('plain', [x, y, z + 0.1], [x + Math.sin(hourAngle) * r * 0.5, y + Math.cos(hourAngle) * r * 0.5, z + 0.1], 0.14, 0.05, 0x1a1a1a);
  k.beam('plain', [x, y, z + 0.13], [x + Math.sin(minAngle) * r * 0.8, y + Math.cos(minAngle) * r * 0.8, z + 0.13], 0.09, 0.05, 0x1a1a1a);
  k.light(x, y, z + 0.6, 0xfff4d8, r * 2.2, 'lamp');
}

/** arched (round-top) window on a +Z facing plane; bottom at y */
export function archWindow(k: Kit, x: number, y: number, z: number, w: number, h: number, frame: ColorLike = 0xe8e2d4, glass: ColorLike = 0x3b5266, mat: MatKey = 'glass'): void {
  const r = w / 2, rect = h - r;
  k.box(mat, x, y, z, w, rect, 0.06, glass, { top: false });
  const segs = k.lo ? 4 : 8;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
    k.tri(mat, { x, y: y + rect, z: z + 0.03 }, { x: x + Math.cos(a0) * r, y: y + rect + Math.sin(a0) * r, z: z + 0.03 }, { x: x + Math.cos(a1) * r, y: y + rect + Math.sin(a1) * r, z: z + 0.03 }, [0, 0], [1, 0], [1, 1], glass, { x: 0, y: 0, z: 1 });
  }
  if (!k.lo) {
    const f = 0.18;
    k.box('plain', x - r - f / 2, y, z, f, rect, 0.14, frame, { top: false });
    k.box('plain', x + r + f / 2, y, z, f, rect, 0.14, frame, { top: false });
    k.box('plain', x, y - f, z, w + f * 2, f, 0.2, frame);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
      k.beam('plain', [x + Math.cos(a0) * (r + f / 2), y + rect + Math.sin(a0) * (r + f / 2), z], [x + Math.cos(a1) * (r + f / 2), y + rect + Math.sin(a1) * (r + f / 2), z], f, 0.14, frame);
    }
  }
}

/** rose window (circular tracery) facing +Z */
export function roseWindow(k: Kit, x: number, y: number, z: number, r: number, frame: ColorLike = 0xd8cdb4): void {
  k.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  k.cylinder('plain', 0, -0.3, 0, r + 0.5, r + 0.5, 0.3, frame, 24, { top: true });
  k.cylinder('emissive', 0, 0, 0, r, r, 0.05, 0x4a5ab0, 24, { top: true });
  k.pop();
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    k.beam('plain', [x, y, z + 0.1], [x + Math.cos(a) * r, y + Math.sin(a) * r, z + 0.1], 0.14, 0.1, frame);
    const cx = x + Math.cos(a + Math.PI / petals) * r * 0.62, cy = y + Math.sin(a + Math.PI / petals) * r * 0.62;
    k.push(new THREE.Matrix4().makeTranslation(cx, cy, z + 0.08).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.cylinder('emissive', 0, 0, 0, r * 0.2, r * 0.2, 0.04, [0xb03030, 0x3050c0, 0xd8a030][i % 3], 8, { top: true });
    k.pop();
  }
  k.light(x, y, z + 0.8, 0xa8b0ff, r * 2.4, 'neon');
}

/** classical temple front: steps, columns, entablature, pediment. Front edge at z. */
export function portico(k: Kit, x: number, z: number, w: number, depth: number, colH: number, n: number, color: ColorLike, y0 = 0, roofColor?: ColorLike): number {
  const steps = y0;
  if (steps > 0) k.stairs(x, z + 0.1, w + 1.6, steps, shade(color, 0.93), 0.17, 0.34, 'concrete');
  const zc = z - depth / 2;
  k.box('wall_stone', x, 0, zc, w, y0 + 0.01, depth, color, { top: 'paving', topColor: shade(color, 0.95) });
  k.colonnade(x - w / 2 + 1.1, x + w / 2 - 1.1, z - 1.0, n, Math.min(0.75, (w / n) * 0.18), colH, color, y0, 'plain');
  const eh = Math.max(1.2, colH * 0.14);
  k.box('wall_stone', x, y0 + colH, zc, w + 0.4, eh, depth + 0.2, color, { top: 'roof_flat' });
  k.box('plain', x, y0 + colH + eh - 0.3, zc, w + 0.8, 0.35, depth + 0.5, shade(color, 1.04));
  const rise = Math.min(w * 0.18, 5.5);
  k.gableRoof('roof_tile', x, y0 + colH + eh, zc, w + 0.4, depth + 0.4, rise, roofColor ?? shade(color, 0.8), { overhang: 0.3, ridgeAlongX: false, wallMat: 'wall_stone', wallColor: color });
  return y0 + colH + eh + rise;
}

/** geodesic glass dome (upper hemisphere of a subdivided icosahedron) */
export function geodesicDome(k: Kit, x: number, y0: number, z: number, r: number, glass: ColorLike = 0xa9d4de, frame: ColorLike = 0xf0f2f4, detail = 2, sy = 1, mat: MatKey = 'glass'): void {
  const geo = new THREE.IcosahedronGeometry(r, k.lo ? 1 : detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const tris: number[] = [];
  const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  const key = (a: THREE.Vector3) => `${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)}`;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    A.fromBufferAttribute(pos, i);
    B.fromBufferAttribute(pos, i + 1);
    Cc.fromBufferAttribute(pos, i + 2);
    if ((A.y + B.y + Cc.y) / 3 < -r * 0.05) continue;
    const vs = [A.clone(), B.clone(), Cc.clone()].map((v) => new THREE.Vector3(v.x, Math.max(0, v.y) * sy, v.z));
    for (const v of vs) tris.push(v.x, v.y, v.z);
    for (let e = 0; e < 3; e++) {
      const p = vs[e], q = vs[(e + 1) % 3];
      const kk = [key(p), key(q)].sort().join('|');
      if (!edges.has(kk)) edges.set(kk, [p, q]);
    }
  }
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  // faceted look: flat normals
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  k.push(new THREE.Matrix4().makeTranslation(x, y0, z));
  k.addGeometry(mat, flat, glass);
  if (!k.lo) for (const [p, q] of edges.values()) k.beam('metal', [p.x, p.y, p.z], [q.x, q.y, q.z], 0.22, 0.22, frame);
  k.pop();
  g.dispose();
  flat.dispose();
  k.torus('metal', x, y0 + 0.2, z, r, 0.4, frame, k.seg(28), 4);
}

// ── waterfront ─────────────────────────────────────────────────────────────
/** quay edge along the back (−Z) of the lot: concrete wall down into water, bollards, fenders */
export function quay(k: Kit, x: number, z: number, w: number, depth = 6, y = 0.3): void {
  k.box('concrete', x, -6, z - depth / 2, w, 6 + y, depth, 0x9d9990, { top: 'paving', topColor: 0xb7b2a6 });
  k.box('plain', x, y, z - depth + 0.25, w, 0.25, 0.5, 0xe8c030, { top: 'plain' });
  if (!k.lo) {
    const n = Math.max(2, Math.round(w / 9));
    for (let i = 0; i < n; i++) {
      const bx = x - w / 2 + (w * (i + 0.5)) / n;
      k.cyl('metal', bx, y, z - depth + 0.9, 0.28, 0.22, 0.7, 0x2e3236, 6);
      k.box('plain', bx, -2.5, z - depth - 0.2, 0.6, 2.4 + y, 0.4, 0x1e1e1e);
    }
  }
}

/** wooden jetty on piles, starting at (x, z) and extending towards −Z */
export function jetty(k: Kit, x: number, z: number, w: number, len: number, y = 0.8, color: ColorLike = C.wood): void {
  k.box('wood', x, y - 0.25, z - len / 2, w, 0.25, len, color);
  const n = Math.max(2, Math.round(len / 4));
  for (let i = 0; i <= n; i++) {
    const zz = z - (len * i) / n;
    for (const s of [-1, 1]) k.cyl('wood', x + (s * w) / 2 - s * 0.15, -3, zz, 0.16, 0.16, y + 2.8, C.woodDark, 5, true);
  }
}

// ── towers, masts, radar ───────────────────────────────────────────────────
/** guyed / lattice antenna mast with aviation beacons. Returns top height. */
export function antennaMast(k: Kit, x: number, z: number, h: number, base = 1.4, color: ColorLike = 0xd8dade, red: ColorLike = 0xd8412f, guyed = false): number {
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const y0 = (h * i) / bands, y1 = (h * (i + 1)) / bands;
    const b0 = base * (1 - (i / bands) * 0.6), b1 = base * (1 - ((i + 1) / bands) * 0.6);
    k.lattice('metal', x, z, y0, y1, b0, b1, i % 2 ? red : color, Math.max(3, (y1 - y0) / 3), 0.22, 0.09);
  }
  k.cyl('metal', x, h, z, 0.15, 0.08, h * 0.08, color, 5);
  if (guyed && !k.lo) {
    for (let g = 0; g < 3; g++) {
      const a = (g / 3) * Math.PI * 2 + 0.5;
      for (const f of [0.45, 0.8]) k.pipe('metal', [x, h * f, z], [x + Math.cos(a) * h * 0.45, 0, z + Math.sin(a) * h * 0.45], 0.04, 0x4a4a4a, 3);
    }
  }
  for (const f of [0.33, 0.66, 1]) {
    k.light(x + base * 0.5, h * f, z, C.beaconRed, 3 + f * 2, 'beacon', true);
    k.light(x - base * 0.5, h * f, z, C.beaconRed, 3 + f * 2, 'beacon', true);
  }
  return h * 1.08;
}

/** radome (white golf ball) on a truss tower */
export function radome(k: Kit, x: number, z: number, towerH: number, r: number, color: ColorLike = 0xf4f4f2): number {
  if (towerH > 0.5) {
    k.lattice('metal', x, z, 0, towerH, r * 0.55, r * 0.4, 0xb8bcc0, 4, 0.3, 0.12);
    k.box('metal', x, towerH - 0.3, z, r * 1.3, 0.3, r * 1.3, 0x8a8e92);
  }
  k.rev('plain', x, towerH, z, [[r * 0.72, 0], [r * 0.98, r * 0.55], [r, r * 1.0], [r * 0.86, r * 1.45], [r * 0.5, r * 1.8], [0, r * 1.95]], color, k.seg(20), { crease: 60 });
  k.light(x, towerH + r * 1.98, z, C.beaconRed, 3, 'beacon', true);
  return towerH + r * 1.95;
}

/** rotating parabolic radar dish (animated about Y) at height y */
export function radarDish(k: Kit, x: number, y: number, z: number, r: number, speed = 0.8, color: ColorLike = 0xe8eaec): void {
  k.cyl('metal', x, y - 1.2, z, 0.5, 0.4, 1.2, 0x6a6e72, 8);
  k.anim([x, y, z], [0, 1, 0], speed, (s) => {
    s.box('metal', x, y, z, 0.8, 0.8, 0.8, 0x5a5e62);
    s.pushTRS(x, y + r * 0.55, z + 0.4, 0);
    s.push(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.35));
    s.rev('metal', 0, 0, 0, [[0.2, 0], [r * 0.5, r * 0.07], [r, r * 0.28]], color, k.seg(16), { crease: 80 });
    s.rev('metal', 0, 0, 0, [[0.2, 0], [r * 0.5, r * 0.07], [r, r * 0.28]], shade(color, 0.7), k.seg(16), { crease: 80, inside: true });
    s.pipe('metal', [0, 0, 0], [0, r * 0.7, 0], 0.08, 0x777777, 4);
    s.pop();
    s.pop();
  });
}

// ── landscaping helpers ────────────────────────────────────────────────────
/** grassed lot with optional gravel/paving border */
export function lawnLot(k: Kit, lawn: ColorLike, border?: ColorLike, bw = 1.2): void {
  if (border !== undefined) {
    k.lot('paving', border, 0.2, 0.04);
    k.slab('grass', 0, 0, k.W - 0.4 - bw * 2, k.D - 0.4 - bw * 2, 0.07, lawn, 0.1);
  } else k.lot('grass', lawn, 0.2, 0.05);
}

/** lamp posts along a polyline */
export function lampsAlong(k: Kit, pts: P2[], every = 14, h = 4.4, style: 'modern' | 'classic' = 'classic', offset = 1.6): void {
  let acc = every * 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    let t = acc;
    while (t < len) {
      const f = t / len;
      lampPost(k, ax + (bx - ax) * f + nx * offset, az + (bz - az) * f + nz * offset, h, 0x2a2e33, C.lampWarm, style);
      t += every;
    }
    acc = t - len;
  }
}

/** simple low wall / kerb around the lot edge (gaps at the front centre for an entrance) */
export function lotEdge(k: Kit, h: number, color: ColorLike, gap = 8, mat: MatKey = 'concrete', t = 0.4): void {
  const W = k.W - 0.6, D = k.D - 0.6;
  k.box(mat, 0, 0, -D / 2 + t / 2, W, h, t, color);
  k.box(mat, -W / 2 + t / 2, 0, 0, t, h, D, color);
  k.box(mat, W / 2 - t / 2, 0, 0, t, h, D, color);
  const side = (W - gap) / 2;
  if (side > 0.2) {
    k.box(mat, -W / 2 + side / 2, 0, D / 2 - t / 2, side, h, t, color);
    k.box(mat, W / 2 - side / 2, 0, D / 2 - t / 2, side, h, t, color);
  }
}

/** modern office / institutional block with glazed ground floor. Returns top. */
export function officeBlock(k: Kit, x: number, z: number, w: number, d: number, floors: number, color: ColorLike, wall: MatKey = 'wall_office', y0 = 0, crown?: ColorLike): number {
  const h = floors * 3.3 + 1.0;
  k.box('glass', x, y0, z, w - 0.6, 4.3, d - 0.6, 0x4e6a7e, { top: false });
  k.box(wall, x, y0 + 4.3, z, w, h - 4.3, d, color, { top: 'roof_flat', topColor: 0x5a5d62 });
  k.box('concrete', x, y0 + 4.0, z, w + 0.3, 0.35, d + 0.3, shade(color, 0.92));
  k.parapet(x, y0 + h, z, w, d, 0.8, crown ?? shade(color, 0.95));
  return y0 + h + 0.8;
}

export { lampPost };
export type { V3 };

// ── civic buildings in the city style ──────────────────────────────────────
export interface CivicOpts {
  roof?: import('./colors').RoofShape | 'none';
  y0?: number;
  plinth?: boolean;
  wall?: MatKey;
  color?: ColorLike;
  roofColor?: ColorLike;
  hvac?: boolean;
  cornice?: boolean;
  floorH?: number;
}

/** A civic block (floors × 3.3 m) dressed in the city's style. Returns the top height. */
export function civicBlock(k: Kit, look: import('./colors').CivicLook, x: number, z: number, w: number, d: number, floors: number, o: CivicOpts = {}): number {
  const y0 = o.y0 ?? 0;
  const fh = o.floorH ?? 3.3;
  const plinthH = o.plinth === false ? 0 : 0.9;
  if (plinthH > 0) k.box('wall_stone', x, y0, z, w + 0.4, plinthH, d + 0.4, look.plinth, { top: 'concrete', topColor: shade(look.plinth, 1.05) });
  const h = floors * fh + 0.6 - plinthH;
  const roof = o.roof ?? look.roof;
  return k.block({
    x, z, w, d, h, y0: y0 + plinthH,
    wall: o.wall ?? look.wall,
    color: o.color ?? look.wallColor,
    roof,
    roofMat: roof === 'flat' || roof === 'none' ? 'roof_flat' : look.roofMat,
    roofColor: o.roofColor ?? (roof === 'flat' ? 0x55585c : look.roofColor),
    cornice: o.cornice === false ? undefined : look.trim,
    parapet: 0.8,
    parapetColor: shade(o.color !== undefined ? (o.color as number) : look.wallColor, 0.95),
    hvac: o.hvac ?? roof === 'flat',
    rise: Math.min(w, d) * (roof === 'pagoda' ? 0.3 : 0.28),
  });
}

/** standing statue figure (cast in one colour) on a plinth top at y; ~1.8 m × scale */
export function statueFigure(k: Kit, x: number, y: number, z: number, scale: number, color: ColorLike, rotY = 0, pose: 'stand' | 'raise' | 'rider' = 'stand'): number {
  k.pushTRS(x, y, z, rotY, scale);
  const col = color;
  if (pose === 'rider') {
    // horse + rider
    k.box('plain', -0.1, 1.0, 0, 1.9, 0.75, 0.6, col);
    for (const [lx, lz] of [[-0.8, -0.2], [-0.8, 0.2], [0.65, -0.2], [0.65, 0.2]] as P2[]) k.box('plain', lx, 0, lz, 0.16, 1.05, 0.16, col, { top: false });
    k.beam('plain', [0.8, 1.5, 0], [1.2, 2.1, 0], 0.3, 0.32, col);
    k.box('plain', 1.35, 1.95, 0, 0.55, 0.28, 0.24, col);
    k.box('plain', 0, 1.75, 0, 0.36, 0.7, 0.3, col);
    k.ball('plain', 0, 2.62, 0, 0.14, col, 7, 5);
    k.beam('plain', [0.1, 2.25, 0.1], [0.6, 2.9, 0.15], 0.08, 0.08, col);
    k.pop();
    return y + 3 * scale;
  }
  k.box('plain', -0.1, 0, 0, 0.15, 0.85, 0.2, col, { top: false });
  k.box('plain', 0.1, 0, 0, 0.15, 0.85, 0.2, col, { top: false });
  k.rev('plain', 0, 0.55, 0, [[0.3, 0], [0.26, 0.5], [0.22, 0.95], [0.12, 1.05]], col, 8, { crease: 60, sz: 0.7 });
  k.ball('plain', 0, 1.7, 0, 0.14, col, 7, 5);
  if (pose === 'raise') {
    k.beam('plain', [0.22, 1.4, 0], [0.45, 2.2, 0.05], 0.08, 0.08, col);
    k.beam('plain', [-0.22, 1.4, 0], [-0.3, 0.9, 0.1], 0.08, 0.08, col);
  } else {
    k.beam('plain', [0.24, 1.4, 0], [0.3, 0.85, 0.08], 0.08, 0.08, col);
    k.beam('plain', [-0.24, 1.4, 0], [-0.3, 0.85, 0.08], 0.08, 0.08, col);
  }
  k.pop();
  return y + 1.9 * scale;
}

/** Semicircular walk-through vault running along Z (depth), opening of `span`
 *  whose arch springs at y = spring. Builds the intrados (inside faces) and the
 *  front/back spandrels up to yTop, so it can sit between two piers. */
export function archVault(k: Kit, cx: number, cz: number, span: number, depth: number, spring: number, yTop: number, mat: MatKey, color: ColorLike, soffit: ColorLike = shade(color, 0.82)): void {
  const r = span / 2, n = k.seg(12);
  const z0 = cz - depth / 2, z1 = cz + depth / 2;
  const pt = (i: number): P2 => {
    const a = Math.PI - (i / n) * Math.PI;
    return [cx + Math.cos(a) * r, spring + Math.sin(a) * r];
  };
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, by - ay);
    // intrados faces the arch axis
    k.quad(mat, { x: ax, y: ay, z: z0 }, { x: bx, y: by, z: z0 }, { x: bx, y: by, z: z1 }, { x: ax, y: ay, z: z1 }, [[u, z0], [u + len, z0], [u + len, z1], [u, z1]], soffit, { x: cx - mx, y: spring - my, z: 0 });
    u += len;
    // spandrels (front and back): fill up to yTop, left half to the left corner, right half to the right
    const cxr = i < n / 2 ? cx - r : cx + r;
    for (const [zz, f] of [[z1, 1], [z0, -1]] as [number, number][]) {
      k.tri(mat, { x: ax, y: ay, z: zz }, { x: bx, y: by, z: zz }, { x: cxr, y: yTop, z: zz }, [ax, ay], [bx, by], [cxr, yTop], color, { x: 0, y: 0, z: f });
      if (i === Math.floor(n / 2) - 1 || (n % 2 === 1 && i === Math.floor(n / 2)))
        k.tri(mat, { x: bx, y: by, z: zz }, { x: cx + r, y: yTop, z: zz }, { x: cx - r, y: yTop, z: zz }, [bx, by], [cx + r, yTop], [cx - r, yTop], color, { x: 0, y: 0, z: f });
    }
  }
  // voussoir band + keystone on the front face
  if (!k.lo) {
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
      const nx0 = (ax - cx) / r, ny0 = (ay - spring) / r, nx1 = (bx - cx) / r, ny1 = (by - spring) / r;
      k.beam('plain', [ax + nx0 * 0.45, ay + ny0 * 0.45, z1 + 0.12], [bx + nx1 * 0.45, by + ny1 * 0.45, z1 + 0.12], 0.9, 0.24, shade(color, 1.06));
    }
    k.box('plain', cx, spring + r - 0.2, z1 + 0.05, 1.2, 1.8, 0.4, shade(color, 1.08));
  }
}

/** Pointed Gothic lancet window on a +Z facing plane (equilateral arch), bottom at y. */
export function lancet(k: Kit, x: number, y: number, z: number, w: number, h: number, glass: ColorLike, frame: ColorLike, mat: MatKey = 'emissive'): void {
  const rise = w * 0.866, rect = Math.max(0.1, h - rise);
  k.box(mat, x, y, z, w, rect, 0.06, glass, { top: false });
  const n = k.lo ? 3 : 6;
  const yb = y + rect;
  const L = (i: number): P2 => { const a = Math.PI - (i / n) * (Math.PI / 3); return [x + w / 2 + Math.cos(a) * w, yb + Math.sin(a) * w]; };
  const R = (i: number): P2 => { const a = (i / n) * (Math.PI / 3); return [x - w / 2 + Math.cos(a) * w, yb + Math.sin(a) * w]; };
  for (let i = 0; i < n; i++) {
    const [ax, ay] = L(i), [bx, by] = L(i + 1), [cx2, cy] = R(i), [dx, dy] = R(i + 1);
    k.tri(mat, { x, y: yb, z: z + 0.03 }, { x: ax, y: ay, z: z + 0.03 }, { x: bx, y: by, z: z + 0.03 }, [0, 0], [1, 0], [1, 1], glass, { x: 0, y: 0, z: 1 });
    k.tri(mat, { x, y: yb, z: z + 0.03 }, { x: cx2, y: cy, z: z + 0.03 }, { x: dx, y: dy, z: z + 0.03 }, [0, 0], [1, 0], [1, 1], glass, { x: 0, y: 0, z: 1 });
    if (!k.lo) {
      k.beam('plain', [ax, ay, z + 0.02], [bx, by, z + 0.02], 0.22, 0.16, frame);
      k.beam('plain', [cx2, cy, z + 0.02], [dx, dy, z + 0.02], 0.22, 0.16, frame);
    }
  }
  if (!k.lo) {
    k.box('plain', x - w / 2 - 0.11, y, z, 0.22, rect, 0.16, frame, { top: false });
    k.box('plain', x + w / 2 + 0.11, y, z, 0.22, rect, 0.16, frame, { top: false });
    k.box('plain', x, y, z + 0.06, 0.12, rect, 0.06, frame, { top: false });
    k.box('plain', x, y - 0.25, z + 0.05, w + 0.5, 0.25, 0.3, frame);
  }
}
