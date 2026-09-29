// Electricity: wind, solar, hydro, geothermal, biomass, fossil, nuclear, fusion.
import * as THREE from 'three';
import { Kit, type P2, type V3 } from './kit';
import { C, shade, mix, lawnColor, dryGround } from './colors';
import { models } from './define';
import { chimney, conveyor, fence, pile, pylon, sphereTank, solarRow, tank, truck, tree, logPile } from './props';
import { coolingTower, hall, pipeRack, windTurbine, rollDoors, officeBlock, lampsAlong } from './arch';

// ── shared plant furniture ────────────────────────────────────────────────
/** electrical switchyard: gravel pad, transformers, gantries, fence */
function switchyard(k: Kit, x: number, z: number, w: number, d: number, trafos = 2): void {
  k.slab('dirt', x, z, w, d, 0.08, 0xa39c8e, 0.3);
  const n = Math.max(1, trafos);
  for (let i = 0; i < n; i++) {
    const tx = x - w / 2 + (w * (i + 0.5)) / n;
    const tz = z + d * 0.18;
    k.box('metal', tx, 0, tz, 3.2, 3.2, 2.6, 0x7d858c);
    if (!k.lo) {
      for (let f = 0; f < 5; f++) k.box('metal', tx - 1.4 + f * 0.7, 0.4, tz + 1.35, 0.08, 2.4, 0.3, 0x5c646b, { top: false });
      for (let b = 0; b < 3; b++) k.cyl('plain', tx - 1 + b, 3.2, tz - 0.5, 0.18, 0.12, 1.6, 0xb8663a, 6);
    }
    k.box('metal', tx, 3.2, tz + 0.6, 2.4, 0.9, 0.9, 0x6d757c);
  }
  // gantries with insulator strings
  const gz = z - d * 0.25;
  const bays = Math.max(2, Math.round(w / 9));
  for (let i = 0; i <= bays; i++) {
    const gx = x - w / 2 + 1 + ((w - 2) * i) / bays;
    k.lattice('metal', gx, gz, 0, 11, 0.5, 0.35, 0xa8adb2, 5.5, 0.18, 0.07);
  }
  k.beam('metal', [x - w / 2 + 1, 11, gz], [x + w / 2 - 1, 11, gz], 0.5, 0.6, 0xa8adb2);
  if (!k.lo) for (let i = 0; i < bays; i++) {
    const gx = x - w / 2 + 1 + ((w - 2) * (i + 0.5)) / bays;
    for (const o of [-1.4, 0, 1.4]) k.cable('metal', [gx + o, 10.8, gz], [gx + o, 4.2, z + d * 0.18], 0.4, 0.05, 0x3a3a3a, 3);
  }
  fence(k, [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]], 2.2, 0x8a9096, 3.2, 'metal', true);
}

/** gatehouse with barrier at the front entrance */
function gatehouse(k: Kit, x: number, z: number, color: number = C.concreteLight): void {
  k.box('wall_concrete', x, 0, z, 4, 3, 3, color, { top: 'roof_flat' });
  k.box('concrete', x, 3, z, 5, 0.3, 4, 0xe4e2dc);
  k.box('glass', x, 0.9, z + 1.52, 3.2, 1.4, 0.05, 0x3b5266, { top: false });
  k.box('plain', x + 5, 0.9, z + 1, 6, 0.14, 0.14, 0xd83a2a);
  k.box('metal', x + 2.2, 0, z + 1, 0.3, 1.1, 0.3, 0x333333);
  k.light(x, 3.4, z + 2, C.lampCool, 2.4, 'lamp');
}

/** oil / fuel tank farm unit with bund wall */
function bundedTank(k: Kit, x: number, z: number, r: number, h: number, color: number = 0xe8e6de): void {
  const b = r + 2.5;
  k.box('concrete', x, 0, z - b, b * 2, 1.2, 0.5, C.concrete);
  k.box('concrete', x, 0, z + b, b * 2, 1.2, 0.5, C.concrete);
  k.box('concrete', x - b, 0, z, 0.5, 1.2, b * 2, C.concrete);
  k.box('concrete', x + b, 0, z, 0.5, 1.2, b * 2, C.concrete);
  tank(k, x, z, r, h, color, 'dome');
  if (!k.lo) k.cyl('plain', x, h * 0.62, z, r + 0.02, r + 0.02, 1.2, 0x2f6fd0, k.seg(20), false);
}

// ── models ─────────────────────────────────────────────────────────────────
const M: Record<string, (k: Kit) => number> = {
  wind_turbine(k) {
    k.lot('grass', lawnColor(k.ctx, 0.3), 0.2, 0.04);
    k.slab('dirt', 0, 0, 9, 9, 0.08, dryGround(k.ctx), 0.2);
    k.ribbon('dirt', [[0, k.D / 2], [0, 3]], 3, 0.07, dryGround(k.ctx));
    return windTurbine(k, 0, -0.5, { hub: 41, blade: 20, phase: k.rnd() * 2, speed: 1.35 });
  },

  wind_turbine_adv(k) {
    k.lot('grass', lawnColor(k.ctx, 0.3), 0.2, 0.04);
    k.slab('dirt', 0, 0, 16, 16, 0.08, dryGround(k.ctx), 0.3);
    k.ribbon('dirt', [[4, k.D / 2], [4, 4], [0, 2]], 4, 0.07, dryGround(k.ctx));
    // crane pad + service container
    k.box('metal', -6, 0, 5, 6, 2.6, 2.4, 0x3d6f9e);
    return windTurbine(k, 0, -2, { hub: 82, blade: 43, phase: k.rnd() * 2, speed: 0.7 });
  },

  offshore_wind(k) {
    const spots: [number, number][] = [[-15, 13], [16, 4], [-1, -16]];
    let top = 0;
    for (const [x, z] of spots) top = Math.max(top, windTurbine(k, x, z, { hub: 104, blade: 34, foundation: 'monopile', phase: k.rnd() * 3, speed: 0.75 + k.rnd() * 0.1 }));
    // offshore substation platform
    k.at(14, 0, -15, 0, () => {
      for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) k.cyl('metal', lx, -12, lz, 0.8, 0.8, 24, C.yellow, 8);
      k.box('metal', 0, 12, 0, 12, 1.2, 12, 0x5a5f65);
      k.box('wall_industrial', 0, 13.2, 0, 10, 6, 9, 0xe8e8e4, { top: 'roof_flat', topColor: 0x9aa0a6 });
      k.helipad(0, 19.3, 0, 4.3, true);
      k.light(5, 19, 5, C.beaconRed, 3, 'beacon', true);
    });
    return top;
  },

  solar_farm(k) {
    const W = k.W, D = k.D;
    k.lot('grass', mix(lawnColor(k.ctx, 0.2), dryGround(k.ctx), 0.25), 0.2, 0.04);
    const rows = Math.floor((D - 8) / 5.2);
    for (let i = 0; i < rows; i++) {
      const z = D / 2 - 6 - i * 5.2;
      solarRow(k, -2, z, W - 12, 3.4, 0.5, 0.7);
    }
    // service track, inverter kiosks, fence
    k.ribbon('dirt', [[W / 2 - 3, D / 2], [W / 2 - 3, -D / 2 + 2]], 3, 0.07, dryGround(k.ctx));
    for (let i = 0; i < 3; i++) {
      const z = D / 2 - 10 - i * 14;
      k.box('metal', W / 2 - 6.2, 0, z, 2.2, 2.4, 3.2, 0xe4e6e2, { top: 'metal', topColor: 0xb8bcc0 });
      k.box('plain', W / 2 - 5.08, 1.4, z, 0.04, 0.5, 0.5, C.yellow, { top: false });
    }
    fence(k, [[-W / 2 + 0.6, -D / 2 + 0.6], [W / 2 - 0.6, -D / 2 + 0.6], [W / 2 - 0.6, D / 2 - 0.6], [W / 2 - 5, D / 2 - 0.6]], 2, 0x8a9096, 3.2, 'metal');
    fence(k, [[W / 2 - 1.4 - 3, D / 2 - 0.6], [-W / 2 + 0.6, D / 2 - 0.6], [-W / 2 + 0.6, -D / 2 + 0.6]], 2, 0x8a9096, 3.2, 'metal');
    k.light(W / 2 - 3, 3, D / 2 - 1, C.lampWarm, 2.5, 'lamp');
    return 3.2;
  },

  solar_tower_plant(k) {
    const W = k.W, D = k.D;
    k.lot('sand', mix(k.ctx.theme.sand, dryGround(k.ctx), 0.3), 0.2, 0.04);
    const tx = 0, tz = -4;
    const H = 104;
    // concrete tower with receiver
    k.rev('concrete', tx, 0, tz, [[5.2, 0], [4.2, 40], [3.4, H - 14]], 0xdedbd2, k.seg(16), { top: true });
    k.cyl('metal', tx, H - 14, tz, 4.4, 4.4, 2, 0x6a6e72, k.seg(16));
    k.cyl('neon', tx, H - 12, tz, 3.9, 3.9, 9, 0xffe7a8, k.seg(16), false);
    k.cyl('metal', tx, H - 3, tz, 4.4, 3.2, 2.2, 0x6a6e72, k.seg(16));
    k.box('metal', tx, H - 0.8, tz, 3, 3, 3, 0xbfc3c7);
    k.cyl('metal', tx, H + 2.2, tz, 0.15, 0.1, 5, 0x777777, 5);
    k.light(tx, H - 7, tz, 0xfff0c0, 34, 'flood');
    k.light(tx, H + 7, tz, C.beaconRed, 3, 'beacon', true);
    // heliostats on concentric rings, each aimed at the receiver
    const rings = k.lo ? [14, 24, 34] : [13, 19, 25, 31, 37];
    for (const R of rings) {
      const n = Math.floor((Math.PI * 2 * R) / 6.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (R % 2) * 0.12;
        const x = tx + Math.cos(a) * R, z = tz + Math.sin(a) * R;
        if (Math.abs(x) > W / 2 - 2.6 || Math.abs(z) > D / 2 - 2.6) continue;
        if (z > D / 2 - 12 && Math.abs(x - 22) < 9) continue;
        k.cyl('metal', x, 0, z, 0.12, 0.1, 2.3, 0x8a8e92, 4, false);
        const yaw = Math.atan2(tx - x, tz - z);
        const tilt = Math.atan2(H - 12, R) * 0.5;
        k.pushTRS(x, 2.4, z, yaw);
        k.push(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - tilt)));
        k.box('metal', 0, -0.05, 0, 4.2, 0.1, 3.2, 0xdfe9f2, { top: 'glass', topColor: 0xcfe0ee });
        k.pop();
        k.pop();
      }
    }
    // power block: molten-salt tanks + turbine hall by the road
    tank(k, 22, D / 2 - 18, 4.8, 9, 0xe9e6de, 'dome');
    tank(k, 32, D / 2 - 18, 4.8, 9, 0x9aa0a6, 'dome');
    hall(k, 27, D / 2 - 6.5, 16, 8, 7, { roof: 'flat', color: 0xe2e2dc, doors: 1 });
    return H + 9;
  },

  solar_updraft(k) {
    const W = k.W;
    k.lot('dirt', dryGround(k.ctx), 0.2, 0.04);
    const R = W / 2 - 1.5, H = 400;
    // glass collector canopy rising towards the chimney
    const seg = k.seg(36);
    k.rev('glass', 0, 0, 0, [[R, 3.2], [R * 0.7, 5.4], [R * 0.4, 8], [12, 10.5]], 0x9fc0cc, seg, { crease: 80 });
    k.rev('plain', 0, 0, 0, [[R, 3.2], [R * 0.7, 5.4], [R * 0.4, 8], [12, 10.5]], 0x5d6a70, seg, { crease: 80, inside: true });
    k.cyl('metal', 0, 0, 0, R + 0.1, R + 0.1, 3.2, 0x4a4f55, seg, false);
    if (!k.lo) {
      for (const r of [R * 0.85, R * 0.55, R * 0.3]) {
        const n = Math.round((Math.PI * 2 * r) / 9);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const hh = 3.2 + (R - r) / (R - 12) * 7.3;
          k.cyl('metal', Math.cos(a) * r, 0, Math.sin(a) * r, 0.15, 0.15, hh, 0x8a8e92, 4, false);
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        k.beam('metal', [Math.cos(a) * 12, 10.6, Math.sin(a) * 12], [Math.cos(a) * R, 3.3, Math.sin(a) * R], 0.25, 0.25, 0xd8dadc);
      }
    }
    // chimney with stiffening rings, turbine house at its foot
    k.cyl('concrete', 0, 0, 0, 12.5, 12.5, 14, 0xc9c6be, k.seg(20));
    k.rev('concrete', 0, 14, 0, [[10, 0], [9, H * 0.45], [8.2, H - 14]], 0xd8d5ce, k.seg(20), { top: false });
    k.rev('concrete', 0, 14, 0, [[9.6, 0], [8.6, H * 0.45], [7.8, H - 14]], 0x55585c, k.seg(20), { inside: true });
    for (let y = 60; y < H; y += 55) {
      const r = 10 - (y / H) * 1.8 + 0.45;
      k.cyl('metal', 0, y, 0, r, r, 1.2, 0x9aa0a6, k.seg(20));
    }
    k.ring('concrete', 0, H, 0, 7.8, 8.4, 0xb8b5ae, k.seg(20));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.box('wall_industrial', Math.cos(a) * 13, 0, Math.sin(a) * 13, 5, 6, 5, 0xe0e0dc, { top: 'roof_flat' });
    }
    for (const y of [120, 240, 360, H]) {
      k.light(8.8, y - 1, 0, C.beaconRed, 6, 'beacon', true);
      k.light(-8.8, y - 1, 0, C.beaconRed, 6, 'beacon', true);
    }
    return H;
  },

  hydro_dam(k) {
    const W = k.W, D = k.D;
    // curved arch dam: crest at y = 14, base down in the gorge; reservoir behind (−Z)
    const crest = 14, base = -26;
    const n = k.seg(18);
    const arc = (t: number, off: number): P2 => {
      const x = -W / 2 + t * W;
      const sag = 7 * (1 - Math.pow(x / (W / 2), 2));
      return [x, -2 - sag + off];
    };
    const crestW = 7, baseW = 18;
    // downstream (+Z) face, battered
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const a0 = arc(t0, crestW / 2), a1 = arc(t1, crestW / 2);
      const b0 = arc(t0, crestW / 2 + (baseW - crestW)), b1 = arc(t1, crestW / 2 + (baseW - crestW));
      k.quad('concrete', { x: b0[0], y: base, z: b0[1] }, { x: b1[0], y: base, z: b1[1] }, { x: a1[0], y: crest, z: a1[1] }, { x: a0[0], y: crest, z: a0[1] }, [[0, base], [1, base], [1, crest], [0, crest]], 0xcfccc4, { x: 0, y: 0.35, z: 1 });
      const u0 = arc(t0, -crestW / 2), u1 = arc(t1, -crestW / 2);
      k.quad('concrete', { x: u1[0], y: base, z: u1[1] }, { x: u0[0], y: base, z: u0[1] }, { x: u0[0], y: crest + 1.2, z: u0[1] }, { x: u1[0], y: crest + 1.2, z: u1[1] }, [[0, base], [1, base], [1, crest], [0, crest]], 0xb9b6ae, { x: 0, y: 0, z: -1 });
      // crest road deck
      k.quad('asphalt', { x: a0[0], y: crest, z: a0[1] }, { x: a1[0], y: crest, z: a1[1] }, { x: u1[0], y: crest, z: u1[1] }, { x: u0[0], y: crest, z: u0[1] }, [[a0[0], 0], [a1[0], 0], [u1[0], 7], [u0[0], 7]], C.asphalt, { x: 0, y: 1, z: 0 });
      // parapets
      k.quad('concrete', { x: a0[0], y: crest, z: a0[1] }, { x: a1[0], y: crest, z: a1[1] }, { x: a1[0], y: crest + 1.1, z: a1[1] }, { x: a0[0], y: crest + 1.1, z: a0[1] }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xdcd9d0, { x: 0, y: 0, z: 1 });
    }
    // abutments
    for (const s of [-1, 1]) k.box('concrete', s * (W / 2 - 2), base, -6, 4, crest - base + 1.2, 26, 0xa8a59d, { top: 'paving', topColor: 0xb8b4aa });
    // reservoir behind the dam
    k.flat('water', 0, -D / 2 + 3.5, W - 8, 7, crest - 2.2, 0x2f6f82);
    k.poly('water', [arc(0.06, -crestW / 2 - 0.2), arc(0.3, -crestW / 2 - 0.2), arc(0.5, -crestW / 2 - 0.2), arc(0.7, -crestW / 2 - 0.2), arc(0.94, -crestW / 2 - 0.2), [W / 2 - 4, -D / 2], [-W / 2 + 4, -D / 2]], crest - 2.2, 0x2f6f82);
    // central spillway chute with falling water
    const sw = 12;
    for (let i = 0; i < 6; i++) {
      const t0 = i / 6, t1 = (i + 1) / 6;
      const y0 = crest - 0.8 - t0 * (crest - base - 2), y1 = crest - 0.8 - t1 * (crest - base - 2);
      const z0 = -2 + crestW / 2 + t0 * (baseW - crestW) + 0.3, z1 = -2 + crestW / 2 + t1 * (baseW - crestW) + 0.3;
      k.quad('water', { x: -sw / 2, y: y0, z: z0 }, { x: sw / 2, y: y0, z: z0 }, { x: sw / 2, y: y1, z: z1 }, { x: -sw / 2, y: y1, z: z1 }, [[0, 0], [1, 0], [1, 1], [0, 1]], 0xcfe8ee, { x: 0, y: 0.5, z: 1 });
    }
    for (const s of [-1, 1]) k.box('concrete', s * (sw / 2 + 0.6), base, 6, 1.2, crest - base + 1, 14, 0xd8d5cd);
    // spillway gates on crest
    for (let i = 0; i < 3; i++) k.box('metal', -4 + i * 4, crest + 1.2, -2 + 0.5, 3.4, 3, 1.2, 0x5a6d7a);
    k.box('concrete', 0, crest + 4.2, -1.5, sw + 2, 0.8, 3, 0xcfccc4);
    // powerhouse at the toe + tailwater
    k.box('wall_concrete', 0, base, D / 2 - 5, W * 0.6, 12, 9, 0xd6d2c8, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.flat('water', 0, D / 2 - 0.5, W - 6, 2, base + 0.5, 0x6fa7b0);
    k.emitter('steam', 0, base + 2, D / 2 - 1, 1);
    k.emitter('steam', -3, base + 1, 9, 0.8);
    // lights on the crest
    for (let i = 0; i < 6; i++) {
      const [lx, lz] = arc((i + 0.5) / 6, crestW / 2 - 0.3);
      k.cyl('metal', lx, crest + 1.1, lz, 0.08, 0.08, 4.5, 0x333333, 5);
      k.light(lx, crest + 5.6, lz, C.lampWarm, 4, 'lamp');
    }
    return crest + 5;
  },

  geothermal_plant(k) {
    const W = k.W, D = k.D;
    k.lot('dirt', mix(dryGround(k.ctx), 0x9a8f7a, 0.4), 0.2, 0.04);
    // turbine hall + separators by the road
    hall(k, -8, D / 2 - 9, 22, 12, 11, { roof: 'shed', color: 0xdad8d0, doors: 1, roofColor: 0x5a7a86 });
    for (let i = 0; i < 2; i++) {
      const x = 8 + i * 6;
      k.cyl('metal', x, 0, D / 2 - 10, 1.8, 1.8, 10, 0xd8d8d2, 12);
      k.dome('metal', x, 10, D / 2 - 10, 1.8, 0xc8c8c2, 12, 0.6, 4);
    }
    // mechanical-draft cooling cells with fan stacks and steam
    k.box('concrete', 4, 0, -D / 2 + 9, 30, 9, 11, 0xbdbab2, { top: 'roof_flat', topColor: 0x7a7e82 });
    for (let i = 0; i < 4; i++) {
      const x = -7.5 + i * 7.6;
      k.cyl('plain', x, 9, -D / 2 + 9, 2.8, 3.1, 3.2, 0x7a8288, k.seg(14), false);
      k.emitter('steam', x, 13, -D / 2 + 9, 0.9);
    }
    // well pads with wellheads + expansion loops on the pipeline
    const wells: V3[] = [[-17, 0, -3], [-17, 0, -15]];
    for (const [x, , z] of wells) {
      k.slab('concrete', x, z, 6, 6, 0.1, 0xb0aca2, 0.2);
      k.cyl('metal', x, 0, z, 0.5, 0.5, 2.4, 0x3f6f4a, 8);
      k.box('metal', x, 1.2, z, 1.8, 0.3, 0.3, 0x3f6f4a);
      k.cyl('metal', x, 2.4, z, 0.3, 0.3, 1.4, 0xc8322b, 6);
      k.emitter('steam', x + 1, 1.5, z, 0.25);
    }
    const pipe = (pts: V3[]) => k.polyPipe('metal', pts, 0.45, 0xd8d8d0, 8);
    pipe([[-17, 1.6, -3], [-12, 1.6, -3], [-12, 1.6, 2], [-8, 1.6, 2], [-8, 4.2, 2], [-4, 4.2, 2], [-4, 1.6, 2], [6, 1.6, 2], [8, 1.6, D / 2 - 10]]);
    pipe([[-17, 1.6, -15], [-12, 1.6, -15], [-12, 1.6, -3.6]]);
    for (const x of [-10, -2, 4]) k.box('concrete', x, 0, 2, 0.6, 1.2, 1.4, 0x9a968d);
    return 16;
  },

  biomass_plant(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5b5d60, 0.2, 0.04);
    // fuel yard: chip piles + logs
    pile(k, -12, -12, 9, 7, 7, 0xa8834e);
    pile(k, -14, 4, 7, 6, 5.5, 0x8f6a3c);
    logPile(k, 10, -18, 11, 7, 4, 0.4);
    // boiler house + turbine hall
    const bx = 9, bz = -2;
    k.box('wall_industrial', bx, 0, bz, 14, 26, 14, 0x3f6f5a, { top: 'roof_flat', topColor: 0x5a5e62 });
    k.box('wall_industrial', bx, 0, D / 2 - 7, 20, 11, 10, 0xd5d8d2, { top: false });
    k.gableRoof('roof_metal', bx, 11, D / 2 - 7, 20, 10, 2.2, 0x3f6f5a, { wallMat: 'wall_industrial', wallColor: 0xd5d8d2, ridgeAlongX: true });
    rollDoors(k, bx, D / 2 - 2, 10, 2, 4.6, 0xb8bcc0);
    // silo + covered conveyor into boiler
    k.cyl('metal', -2, 0, -14, 4, 4, 16, 0xc8c8c0, k.seg(16), false);
    k.rev('metal', -2, 16, -14, [[4, 0], [0.8, 2.5]], 0xa8a8a0, k.seg(16));
    conveyor(k, [-6, 0.5, -3], [bx - 7, 20, bz], 2.2, 0xc8b88a);
    conveyor(k, [-2, 17, -14], [bx - 6, 22, bz - 4], 1.8, 0xc8b88a);
    chimney(k, bx + 4, bz - 10, 45, 2.2, 1.5, { emit: 'smoke', rate: 0.6 });
    truck(k, -4, 12, Math.PI / 2, 0x2f6f4a, 0x8a6a3a, 'box', 12);
    return 45;
  },

  coal_plant(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x55575a, 0.2, 0.04);
    // coal yard at the back with stacker-reclaimer
    k.slab('dirt', -12, -D / 2 + 13, 36, 22, 0.08, 0x3a3634, 0.2);
    pile(k, -20, -D / 2 + 13, 11, 8, 8, 0x24221f);
    pile(k, -4, -D / 2 + 12, 10, 7.5, 7, 0x2a2724);
    k.box('metal', -12, 0.1, -D / 2 + 22, 36, 0.4, 1.2, 0x6a6e72);
    k.at(-10, 0, -D / 2 + 22, 0, () => {
      k.box('metal', 0, 0.5, 0, 5, 3, 4, C.yellow);
      k.lattice('metal', 0, 0, 3.5, 11, 1.3, 0.6, C.yellow, 3.8, 0.25, 0.1);
      k.beam('metal', [0, 10, 0], [0, 4, -16], 1.2, 1.4, C.yellow);
      k.anim([0, 4, -16.5], [1, 0, 0], 0.6, (s) => {
        s.push(new THREE.Matrix4().makeTranslation(0, 4, -16.5).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
        s.cylinder('metal', 0, -0.6, 0, 3, 3, 1.2, 0xd8a020, 12, { top: true, bottom: true });
        s.pop();
      });
    });
    // boiler house (tall), precipitators, turbine hall
    const bx = 8, bz = -4;
    k.box('wall_industrial', bx, 0, bz, 18, 44, 16, 0xcbc7bd, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('wall_industrial', bx, 44, bz, 10, 5, 10, 0xb9b5ab, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('wall_glass', bx, 8, bz + 8.05, 14, 30, 0.1, 0x9fb8c8, { top: false });
    for (let i = 0; i < 2; i++) k.box('wall_industrial', bx + 17, 0, bz - 4 + i * 9, 12, 20, 7, 0x9aa3a8, { top: 'roof_flat' });
    k.box('wall_industrial', bx - 2, 0, D / 2 - 10, 32, 18, 14, 0xd9d6ce, { top: false });
    k.barrel('roof_metal', bx - 2, 18, D / 2 - 10, 14.6, 32.6, 3, 0x6d7f8a, k.seg(10), true, 'wall_industrial', 0xd9d6ce);
    rollDoors(k, bx - 12, D / 2 - 3, 6, 1, 6, 0xb8bcc0);
    // coal conveyor gallery up to the boiler bunkers
    conveyor(k, [-8, 1, -D / 2 + 18], [bx - 9, 36, bz], 2.6, 0x9a8f7a);
    // twin stacks with smoke
    chimney(k, bx + 26, bz - 14, 80, 3.6, 2.4, { emit: 'smoke', rate: 1 });
    chimney(k, bx + 17, bz - 18, 80, 3.6, 2.4, { emit: 'smoke', rate: 1 });
    k.beam('metal', [bx + 15, 12, bz - 4], [bx + 17, 12, bz - 16], 2.2, 2.2, 0x8a8e92);
    k.beam('metal', [bx + 23, 12, bz - 4], [bx + 26, 12, bz - 12], 2.2, 2.2, 0x8a8e92);
    switchyard(k, -18, D / 2 - 10, 20, 14, 2);
    pylon(k, -30, D / 2 - 4, 26);
    gatehouse(k, 8, D / 2 - 2.5);
    return 80;
  },

  oil_plant(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5b5d60, 0.2, 0.04);
    for (const [x, z] of [[-20, -18], [-6, -18], [-20, -4], [-6, -4]] as [number, number][]) bundedTank(k, x, z, 5.2, 11, 0xecebe4);
    const bx = 17, bz = -8;
    k.box('wall_industrial', bx, 0, bz, 20, 30, 18, 0xd2d4d0, { top: 'roof_flat', topColor: 0x6a6e72 });
    k.box('wall_industrial', bx - 2, 30, bz, 12, 6, 10, 0xb9bdb9, { top: 'roof_flat' });
    k.box('wall_glass', bx, 6, bz + 9.05, 16, 20, 0.1, 0x9fb8c8, { top: false });
    k.box('wall_industrial', 8, 0, D / 2 - 9, 28, 14, 12, 0xe0ded8, { top: false });
    k.gableRoof('roof_metal', 8, 14, D / 2 - 9, 28, 12, 2.4, 0x2f5f8a, { wallMat: 'wall_industrial', wallColor: 0xe0ded8 });
    rollDoors(k, 0, D / 2 - 3, 6, 1, 5.5, 0xb8bcc0);
    chimney(k, bx + 6, bz - 16, 60, 3, 2.1, { emit: 'smoke', rate: 0.8 });
    pipeRack(k, [-13, -11], [bx - 10, -11], 4.5, 3);
    pipeRack(k, [-13, 3], [-13, -11], 4.5, 2);
    switchyard(k, -18, D / 2 - 9, 20, 12, 2);
    gatehouse(k, 26, D / 2 - 2.5);
    return 60;
  },

  gas_plant(k) {
    const W = k.W, D = k.D;
    k.lot('asphalt', 0x5b5d60, 0.2, 0.04);
    // two gas-turbine trains: turbine enclosure → HRSG → stack
    for (let i = 0; i < 2; i++) {
      const x = -10 + i * 16;
      k.box('wall_industrial', x, 0, 6, 9, 9, 16, 0xe2e4e0, { top: 'roof_flat', topColor: 0x8a8e92 });
      k.box('metal', x, 9, 12, 7, 5, 5, 0xb8bcc0);
      k.box('wall_industrial', x, 0, -10, 11, 26, 16, 0xcfd3d4, { top: 'roof_flat', topColor: 0x6a6e72 });
      k.box('metal', x, 0, -1, 7, 8, 3, 0x9aa0a6);
      chimney(k, x, -21, 48, 2.8, 2.6, { color: 0xb8bcc0, bands: false, emit: 'steam', rate: 0.6 });
    }
    // steam turbine hall + air-cooled condenser on stilts
    hall(k, 20, 4, 12, 26, 13, { roof: 'shed', color: 0xdcdcd6, roofColor: 0x2a6f8a });
    k.box('metal', 20, 16, -18, 14, 1, 22, 0x7a8288);
    for (const [lx, lz] of [[-6, -8], [6, -8], [-6, 8], [6, 8]]) k.box('metal', 20 + lx, 0, -18 + lz, 0.6, 16, 0.6, 0x6a6e72);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      k.cyl('metal', 20 - 3.5 + j * 7, 17, -25 + i * 7, 2.8, 2.8, 2.2, 0x9aa0a6, k.seg(12), false);
      k.emitter('steam', 20 - 3.5 + j * 7, 19.5, -25 + i * 7, 0.3);
    }
    pipeRack(k, [-18, 16], [14, 16], 3.5, 2, [C.yellow, 0xb8bcc0]);
    k.cyl('metal', -19, 0, D / 2 - 5, 1.6, 1.6, 3, C.yellow, 10);
    gatehouse(k, 4, D / 2 - 2.5);
    return 48;
  },

  waste_energy_plant(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xb8b3a8, 0.2, 0.04);
    // sloping plant hall with a ski slope on its roof (high at the back)
    const x0 = -W / 2 + 3, x1 = W / 2 - 14, zf = D / 2 - 6, zb = -D / 2 + 3;
    const hf = 12, hb = 40;
    const facade = 0x9b8f84;
    // side walls (trapezoids) + front + back
    for (const [x, s] of [[x0, -1], [x1, 1]] as [number, number][]) {
      k.quad('wall_industrial', { x, y: 0, z: s > 0 ? zf : zb }, { x, y: 0, z: s > 0 ? zb : zf }, { x, y: s > 0 ? hb : hf, z: s > 0 ? zb : zf }, { x, y: s > 0 ? hf : hb, z: s > 0 ? zf : zb }, [[0, 0], [zf - zb, 0], [zf - zb, hb], [0, hf]], facade, { x: s, y: 0, z: 0 });
    }
    k.wall('wall_industrial', x0, zf, x1, zf, 0, hf, facade);
    k.wall('wall_industrial', x1, zb, x0, zb, 0, hb, shade(facade, 0.9));
    k.box('glass', (x0 + x1) / 2, 0.2, zf + 0.05, x1 - x0 - 4, 7, 0.1, 0x3d5566, { top: false });
    // ski slope (artificial turf) with side paths, trees and a lift
    const slopeW = (x1 - x0) * 0.5;
    const sx = x0 + slopeW / 2 + 2;
    k.quad('grass', { x: x0, y: hf, z: zf }, { x: x1, y: hf, z: zf }, { x: x1, y: hb, z: zb }, { x: x0, y: hb, z: zb }, [[x0, 0], [x1, 0], [x1, 80], [x0, 80]], 0x5e8c3e, { x: 0, y: 1, z: 1 });
    const along = (t: number, x: number, off = 0.12): THREE.Vector3Like => ({ x, y: hf + (hb - hf) * t + off, z: zf + (zb - zf) * t });
    k.quad('plain', along(0, sx - slopeW / 2), along(0, sx + slopeW / 2), along(1, sx + slopeW / 2), along(1, sx - slopeW / 2), [[0, 0], [1, 0], [1, 1], [0, 1]], 0xeef2f4, { x: 0, y: 1, z: 1 });
    if (!k.lo) {
      for (let i = 0; i < 8; i++) {
        const t = 0.08 + i * 0.11;
        const p = along(t, x1 - 5 - (i % 2) * 3, 0);
        k.pushTRS(0, p.y, 0, 0);
        tree(k, 'pine', p.x, p.z, 0.55);
        k.pop();
      }
      for (let i = 0; i < 10; i++) {
        const p = along(0.1 + i * 0.085, x1 - 8, 0.2);
        k.cyl('metal', p.x, p.y, p.z, 0.15, 0.15, 5, 0x444444, 4);
        k.light(p.x, p.y + 5.2, p.z, C.lampCool, 3.5, 'lamp');
      }
      const l0 = along(0.02, sx + slopeW / 2 + 1.5, 3.5), l1 = along(0.98, sx + slopeW / 2 + 1.5, 3.5);
      k.cable('metal', [l0.x, l0.y, l0.z], [l1.x, l1.y, l1.z], 1.5, 0.06, 0x222222, 6);
    }
    // chimney that puffs steam rings
    const cx = x1 + 7, cz = -D / 2 + 10;
    k.cyl('concrete', cx, 0, cz, 3.2, 2.6, 90, 0xb8aea2, k.seg(14));
    k.torus('metal', cx, 89.6, cz, 2.7, 0.3, 0x444444, k.seg(14), 4);
    k.emitter('steam', cx, 91, cz, 0.7);
    k.light(cx + 2.7, 88, cz, C.beaconRed, 3, 'beacon', true);
    // tipping hall + garbage trucks
    hall(k, x1 + 7, D / 2 - 10, 12, 14, 10, { roof: 'flat', color: 0x7f766c, doors: 2, doorColor: 0x3f8a4a });
    truck(k, x1 + 4, D / 2 + 0.5 - 3, Math.PI, 0xf2f2f2, 0x3d8a4a, 'garbage', 9);
    return 90;
  },

  nuclear_plant(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xb8b4aa, 0.2, 0.04);
    // two natural-draft cooling towers at the back
    coolingTower(k, -W / 2 + 25, -D / 2 + 25, 105, 23, 0xd9d6ce, true, 1);
    coolingTower(k, W / 2 - 25, -D / 2 + 25, 105, 23, 0xd9d6ce, true, 1);
    // containment building (cylinder + dome) with auxiliary block
    const cx = -14, cz = 16;
    k.cyl('concrete', cx, 0, cz, 14, 14, 34, 0xe6e3dc, k.seg(28), false);
    k.dome('concrete', cx, 34, cz, 14, 0xd6d3cc, k.seg(28), 0.55, 7);
    k.cyl('plain', cx, 30, cz, 14.08, 14.08, 1.2, 0xc8322b, k.seg(28), false);
    k.box('wall_concrete', cx, 0, cz - 17, 26, 20, 10, 0xd8d6d0, { top: 'roof_flat', topColor: 0x7a7e82 });
    k.cyl('metal', cx + 10, 20, cz - 17, 1.2, 1.1, 30, 0xe0e0dc, 10);
    k.light(cx + 10, 50.5, cz - 17, C.beaconRed, 3, 'beacon', true);
    // turbine hall
    k.box('wall_industrial', 16, 0, cz, 30, 24, 16, 0xdcdad4, { top: false });
    k.barrel('roof_metal', 16, 24, cz, 16.6, 30.6, 3, 0x2f5f8a, k.seg(10), true, 'wall_industrial', 0xdcdad4);
    k.box('glass', 16, 4, cz + 8.05, 26, 3, 0.1, 0x4e6a7e, { top: false });
    k.box('metal', 0, 14, cz, 3, 3, 4, 0x9aa0a6);
    k.box('wall_concrete', 16, 0, D / 2 - 7, 22, 8, 8, 0xe8e6e0, { top: 'roof_flat' });
    // switchyard + security
    switchyard(k, -W / 2 + 14, D / 2 - 12, 20, 16, 3);
    fence(k, [[-W / 2 + 1, D / 2 - 1], [-W / 2 + 1, -D / 2 + 1], [W / 2 - 1, -D / 2 + 1], [W / 2 - 1, D / 2 - 1]], 3, 0x8a9096, 3.2, 'metal');
    gatehouse(k, 34, D / 2 - 3);
    lampsAlong(k, [[-W / 2 + 4, D / 2 - 3], [W / 2 - 18, D / 2 - 3]], 18, 7, 'modern', 0);
    return 105;
  },

  fusion_plant(k) {
    const W = k.W, D = k.D;
    k.lot('paving', 0xd8dade, 0.2, 0.04);
    k.slab('grass', 0, -8, W - 10, D - 30, 0.07, lawnColor(k.ctx, 0.6), 0.1);
    // central tokamak: raised torus with D-shaped field coils and a glowing plasma slot
    const cx = 0, cz = -8, Y = 20, R = 22, r = 9;
    k.cyl('concrete', cx, 0, cz, R - 2, R - 4, Y - r + 1, 0xe6e8ea, k.seg(28));
    k.torus('plain', cx, Y, cz, R, r, 0xf2f4f6, k.seg(40), k.lo ? 8 : 14);
    k.torus('neon', cx, Y, cz, R + r - 0.35, 0.8, 0x9f7bff, k.seg(40), 6);
    k.torus('neon', cx, Y, cz, R - r + 0.35, 0.8, 0x6fe8ff, k.seg(40), 6);
    const coils = k.lo ? 8 : 16;
    for (let i = 0; i < coils; i++) {
      const a = (i / coils) * Math.PI * 2;
      k.pushTRS(cx, Y, cz, -a);
      const pts: V3[] = [];
      for (let j = 0; j <= 10; j++) {
        const t = (j / 10) * Math.PI * 2;
        pts.push([R + Math.cos(t) * (r + 1.2) + (Math.cos(t) < 0 ? Math.cos(t) * -1.2 : 0), Math.sin(t) * (r + 2.2), 0]);
      }
      k.polyPipe('metal', pts, 0.9, 0x3a5a8a, 6);
      k.pop();
    }
    k.cyl('metal', cx, 0, cz, 5, 5, Y + r + 6, 0xc8ccd2, k.seg(16));
    k.cyl('neon', cx, Y + r + 6, cz, 5.2, 5.2, 1, 0x6fe8ff, k.seg(16), false);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.light(cx + Math.cos(a) * (R + r), Y, cz + Math.sin(a) * (R + r), 0xb89cff, 7, 'neon');
    }
    // cryoplant spheres + power conversion halls
    for (let i = 0; i < 3; i++) sphereTank(k, W / 2 - 8, -D / 2 + 10 + i * 12, 4.2, 0xf0f2f4);
    officeBlock(k, -W / 2 + 14, D / 2 - 12, 20, 16, 3, 0xeef2f4, 'wall_glass');
    hall(k, 22, D / 2 - 11, 28, 14, 12, { roof: 'barrel', color: 0xe6eaee, roofColor: 0xb8c0c8 });
    k.sign(22, 8, D / 2 - 3.9, 10, 1.6, 0x6fe8ff, 0x6fe8ff);
    switchyard(k, -W / 2 + 12, -D / 2 + 12, 18, 16, 3);
    return Y + r + 8;
  },
};

export const POWER_MODELS = models(M);
