// Building state variants derived from a finished model:
//  * construction — foundations → scaffolding → floors rising with progress,
//    tower cranes on tall projects, site fencing and materials;
//  * collapsed — rubble heaps, slabs, broken wall stubs and twisted beams;
//  * abandoned / burned — lights off, grime / soot tint on the geometry
//    (the shaders add broken windows, boards and charring via aInfo).
import * as THREE from 'three';
import type { ModelContext, ModelPart } from '../types';
import { LodFacade } from './constants';
import { BLANK, Fab, type LodMass, type ZModel, addFac } from './fab';
import { GROUND, fence, lampPost, lotGround, pad, pile } from './parts';
import { P, col, desaturate } from './util';

// ── triangle clipping against a horizontal plane ─────────────────────────
/** Keep the part of a non-indexed geometry below y = h (all attributes interpolated). */
export function clipBelow(g: THREE.BufferGeometry, h: number): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const P = pos.array as ArrayLike<number>;
  const n = pos.count;
  let allBelow = true, anyBelow = false;
  for (let i = 0; i < n; i++) {
    if (P[i * 3 + 1] > h) allBelow = false;
    else anyBelow = true;
  }
  if (allBelow) return g.clone();
  if (!anyBelow) return null;
  const names = Object.keys(g.attributes);
  const srcs = names.map((nm) => g.getAttribute(nm) as THREE.BufferAttribute);
  const sizes = srcs.map((a) => a.itemSize);
  const ints = srcs.map((a) => a.normalized || !(a.array instanceof Float32Array));
  // worst case: every triangle becomes a quad (2 triangles)
  const outs = srcs.map((a) => new (a.array.constructor as new (n: number) => THREE.TypedArray)(n * 2 * a.itemSize));
  let o = 0;
  const na = names.length;
  /** copy source vertex i, or the lerp of vertices i→j at t, to output slot o */
  const emit = (i: number, j: number, t: number): void => {
    for (let ai = 0; ai < na; ai++) {
      const s = sizes[ai], src = srcs[ai].array as ArrayLike<number>, dst = outs[ai];
      const si = i * s, sj = j * s, d = o * s;
      if (t === 0) for (let k = 0; k < s; k++) dst[d + k] = src[si + k];
      else if (ints[ai]) for (let k = 0; k < s; k++) dst[d + k] = Math.round(src[si + k] + (src[sj + k] - src[si + k]) * t);
      else for (let k = 0; k < s; k++) dst[d + k] = src[si + k] + (src[sj + k] - src[si + k]) * t;
    }
    o++;
  };
  for (let t = 0; t < n; t += 3) {
    const y0 = P[t * 3 + 1], y1 = P[t * 3 + 4], y2 = P[t * 3 + 7];
    const b0 = y0 <= h, b1 = y1 <= h, b2 = y2 <= h;
    const cnt = (b0 ? 1 : 0) + (b1 ? 1 : 0) + (b2 ? 1 : 0);
    if (cnt === 0) continue;
    if (cnt === 3) {
      emit(t, t, 0); emit(t + 1, t + 1, 0); emit(t + 2, t + 2, 0);
      continue;
    }
    // rotate so the odd vertex is A (keeps winding)
    const k = cnt === 1 ? (b0 ? 0 : b1 ? 1 : 2) : (!b0 ? 0 : !b1 ? 1 : 2);
    const A = t + k, B = t + ((k + 1) % 3), C = t + ((k + 2) % 3);
    const yA = P[A * 3 + 1], yB = P[B * 3 + 1], yC = P[C * 3 + 1];
    const tAB = (h - yA) / (yB - yA), tAC = (h - yA) / (yC - yA);
    if (cnt === 1) {
      // only A below
      emit(A, A, 0); emit(A, B, tAB); emit(A, C, tAC);
    } else {
      // A above, B & C below → quad AB, B, C, AC
      emit(A, B, tAB); emit(B, B, 0); emit(C, C, 0);
      emit(A, B, tAB); emit(C, C, 0); emit(A, C, tAC);
    }
  }
  if (!o) return null;
  const r = new THREE.BufferGeometry();
  names.forEach((name, ai) => {
    const a = srcs[ai];
    r.setAttribute(name, new THREE.BufferAttribute(outs[ai].slice(0, o * a.itemSize), a.itemSize, a.normalized));
  });
  r.computeBoundingSphere();
  return r;
}

/** construction stage bucket (so cache keys stay small) */
export function constructionStage(built: number): number {
  return Math.max(0, Math.min(8, Math.floor(built * 9)));
}

/** Construction-site model for a finished model at progress 0..1. */
export function constructionModel(full: ZModel, ctx: ModelContext, progress: number): ZModel {
  const f = new Fab(ctx);
  const W = ctx.width, D = ctx.depth;
  const rng = f.rng;
  // lot: compacted dirt, site fence, cabins, material piles
  lotGround(f, W, D, 'dirt', col('#8a7658'));
  fence(f, [[-W / 2 + 0.4, D / 2 - 0.4], [-2.5, D / 2 - 0.4]], 'chain', '#9aa0a6', 1.3);
  fence(f, [[2.5, D / 2 - 0.4], [W / 2 - 0.4, D / 2 - 0.4], [W / 2 - 0.4, -D / 2 + 0.4], [-W / 2 + 0.4, -D / 2 + 0.4], [-W / 2 + 0.4, D / 2 - 0.4]], 'chain', '#9aa0a6', 1.3);
  const B = f.m();
  const cabinX = -W / 2 + 3.5, cabinZ = D / 2 - 3;
  B.box('wall_industrial', cabinX, GROUND, cabinZ, 6, 2.6, 2.4, '#e0c040', { top: 'roof_metal', topColor: '#d0d0cc' });
  f.light(cabinX, 2.8, cabinZ + 1.3, 0xffe0b0, 1.5, 'lamp');
  pile(f, W / 2 - 4, D / 2 - 4, 2.2, 1.6, 'sand', '#cdb58a');
  B.box('wood', W / 2 - 4, GROUND, D / 2 - 9, 3, 0.8, 1.6, '#c8a070');
  const stageP = constructionStage(progress) / 8;
  const masses = full.masses.filter((m) => m.h > 1.2 && m.w > 2 && m.d > 2);
  const maxTop = masses.reduce((a, m) => Math.max(a, m.y0 + m.h), 0) || full.height;
  if (stageP <= 0.12) {
    // excavation + foundations
    for (const m of masses) {
      if (m.y0 > 0.5) continue;
      f.pushTRS(m.cx, 0, m.cz, m.rot);
      f.m().box('concrete', 0, -0.5, 0, m.w + 0.6, GROUND + 0.8, m.d + 0.6, '#b5b0a6', { top: 'concrete', topColor: '#c4bfb4' });
      const n = Math.max(2, Math.round(m.w / 3));
      for (let i = 0; i <= n; i++) f.m().box('metal', -m.w / 2 + (i / n) * m.w, GROUND + 0.3, m.d / 2 - 0.2, 0.06, 1.4, 0.06, '#6a4a3a', { top: false });
      f.pop();
    }
    pad(f, 'dirt', 0, 0, W - 2, D - 2, '#7a6448', 0.01);
    const r = f.finish(2);
    return { ...r, lights: r.lights, emitters: [{ kind: 'dust', x: 0, y: 1, z: 0, rate: 0.4 }] };
  }
  const H = Math.max(3, maxTop * ((stageP - 0.12) / 0.88));
  // keep the finished geometry below H (walls rise floor by floor)
  const parts: ModelPart[] = [];
  for (const p of full.parts) {
    if (p.mat === 'grass' || p.mat === 'foliage' || p.mat === 'bark' || p.mat === 'water') continue;
    const c = clipBelow(p.geometry, H);
    if (c) parts.push({ mat: p.mat, geometry: c });
  }
  // slabs at the working level + scaffolding around every mass that is taller than H
  for (const m of masses) {
    if (m.y0 >= H) continue;
    const top = m.y0 + m.h;
    const y = Math.min(top, H);
    f.pushTRS(m.cx, 0, m.cz, m.rot);
    const Bm = f.m();
    if (top > H) Bm.box('concrete', 0, y - 0.25, 0, m.w - 0.1, 0.3, m.d - 0.1, '#bdb8ae');
    if (top > H + 0.5) {
      // scaffolding: poles + ledgers + planks on all 4 sides
      const sy = y + 1.8;
      const off = 0.9;
      const sides: [number, number, number, number][] = [
        [-m.w / 2 - off, m.d / 2 + off, m.w / 2 + off, m.d / 2 + off],
        [m.w / 2 + off, m.d / 2 + off, m.w / 2 + off, -m.d / 2 - off],
        [m.w / 2 + off, -m.d / 2 - off, -m.w / 2 - off, -m.d / 2 - off],
        [-m.w / 2 - off, -m.d / 2 - off, -m.w / 2 - off, m.d / 2 + off],
      ];
      for (const [ax, az, bx, bz] of sides) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 2.5));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          Bm.box('metal', ax + (bx - ax) * t, Math.max(m.y0, 0), az + (bz - az) * t, 0.08, sy - Math.max(m.y0, 0), 0.08, '#b8bcc0', { top: false });
        }
        const lvls = Math.max(1, Math.floor((sy - Math.max(0, m.y0)) / 2));
        f.pushTRS((ax + bx) / 2, 0, (az + bz) / 2, -Math.atan2(bz - az, bx - ax));
        for (let l = 1; l <= lvls; l++) {
          const ly = Math.max(0, m.y0) + l * 2;
          if (ly > sy) break;
          f.m().box('wood', 0, ly - 0.05, 0.35, len, 0.05, 0.7, '#b89a6a', { bottom: true });
          f.m().box('metal', 0, ly + 1.0, 0, len, 0.05, 0.05, '#c0c4c8', { top: false });
        }
        // safety netting on the upper two levels (reads as green mesh)
        if (f.detail !== 'low') f.m().quad('plain', { x: -len / 2, y: sy - 3.5, z: 0.05 }, { x: len / 2, y: sy - 3.5, z: 0.05 }, { x: len / 2, y: sy, z: 0.05 }, { x: -len / 2, y: sy, z: 0.05 }, [[0, 0], [1, 0], [1, 1], [0, 1]], '#5f8a5a', { x: 0, y: 0, z: 1 });
        f.pop();
      }
    }
    f.pop();
  }
  // tower crane on tall projects
  if (maxTop > 18 && stageP < 1) {
    const big = masses.reduce((a, m) => (m.w * m.d > a.w * a.d ? m : a), masses[0]);
    const cx = big ? big.cx + big.w / 2 + 3.5 : W / 2 - 4, cz = big ? big.cz : 0;
    crane(f, Math.min(W / 2 - 2, cx), cz, Math.max(H + 12, maxTop * 0.5 + 12), Math.min(40, Math.max(W, D) * 0.8), rng.next() * Math.PI * 2);
  }
  lampPost(f, W / 2 - 2, D / 2 - 2, 7);
  const site = f.finish(2);
  // clipBelow preserves the facade codes; add a neutral code where a part had none
  for (const p of parts) if (!p.geometry.getAttribute('aFac')) addFac(p.geometry, 0);
  return { ...site, parts: [...site.parts, ...parts], emitters: [{ kind: 'dust', x: 0, y: H * 0.5, z: 0, rate: 0.3 }], height: Math.max(site.height, H) };
}

/** Tower crane: lattice mast, slewing jib (animated), counterweight, beacon. */
function crane(f: Fab, x: number, z: number, h: number, jib: number, rot: number): void {
  const B = f.m();
  const y = '#e8b820';
  const s = 0.9;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('metal', x + dx * s, GROUND, z + dz * s, 0.14, h, 0.14, y, { top: false });
  if (f.detail !== 'low') for (let yy = 2; yy < h; yy += 2.2) {
    B.box('metal', x, GROUND + yy, z + s, s * 2, 0.08, 0.08, y);
    B.box('metal', x, GROUND + yy, z - s, s * 2, 0.08, 0.08, y);
    B.box('metal', x + s, GROUND + yy, z, 0.08, 0.08, s * 2, y);
    B.box('metal', x - s, GROUND + yy, z, 0.08, 0.08, s * 2, y);
  }
  B.box('concrete', x, 0, z, 4, GROUND + 0.8, 4, '#a8a39a');
  // slewing part rotates slowly about the mast
  f.anim((b) => {
    b.pushTRS(x, GROUND + h, z, rot);
    b.box('metal', jib / 2 - 2, 0.3, 0, jib, 0.9, 0.9, y);
    b.box('metal', -5, 0.3, 0, 8, 0.8, 0.9, y);
    b.box('concrete', -8, -0.6, 0, 2.2, 1.8, 1.6, '#8a8a86');
    b.box('plain', 1.2, -2.2, 1.0, 1.6, 2.0, 1.6, '#f0f0ea');
    b.box('glass', 1.2, -1.4, 1.82, 1.3, 0.9, 0.04, '#2a3440');
    b.box('metal', 0, 0.3, 0, 0.6, 5, 0.6, y);
    b.box('metal', jib * 0.6, -0.2, 0, 1.2, 0.5, 0.6, '#3a3d40');
    b.box('metal', jib * 0.6, -h * 0.5, 0, 0.04, h * 0.5 - 0.2, 0.04, '#2a2c30', { top: false });
    b.pop();
  }, [x, GROUND + h, z], [0, 1, 0], 0.06, 0.8, rot);
  f.light(x, GROUND + h + 5.5, z, 0xff2a1a, 2.2, 'beacon', true);
  f.mass(x, z, 2, 2, 0, h + 5, y, y, LodFacade.None);
  f.reach(h + 5.5);
}

/** Rubble heap after a collapse. */
export function rubbleModel(full: ZModel, ctx: ModelContext): ZModel {
  const f = new Fab(ctx);
  const W = ctx.width, D = ctx.depth;
  const rng = f.rng;
  lotGround(f, W, D, 'dirt', col('#6f6458'));
  const B = f.m();
  // the largest few volumes are enough to read as a collapsed building
  const masses: LodMass[] = full.masses.filter((m) => m.h > 2 && m.w > 2).sort((a, b) => b.w * b.d * b.h - a.w * a.d * a.h).slice(0, 5);
  if (!masses.length) masses.push({ cx: 0, cz: 0, w: W * 0.6, d: D * 0.5, y0: 0, h: 8, rot: 0, wall: [0.6, 0.6, 0.6], roof: [0.4, 0.4, 0.4], fac: LodFacade.None });
  for (const m of masses) {
    const wall = new THREE.Color(m.wall[0], m.wall[1], m.wall[2]);
    // debris reads as a mix of the building's own walls, concrete dust and soil
    const dust = desaturate(wall, 0.55).lerp(col('#6b6255'), 0.55).multiplyScalar(0.85);
    const hh = Math.min(9, 1.2 + m.h * 0.18);
    f.pushTRS(m.cx, 0, m.cz, m.rot);
    // main heap
    const heapR = Math.min(m.w, m.d) * 0.55;
    B.cylinder('dirt', 0, 0, 0, heapR, heapR * 0.2, hh, dust, 7, { top: true });
    // spread debris mounds
    for (let i = 0; i < 5; i++) {
      const x = (rng.next() - 0.5) * m.w, z = (rng.next() - 0.5) * m.d;
      const dc = rng.chance(0.5) ? desaturate(wall, 0.3).lerp(col('#7d766c'), 0.35) : col(rng.pick(['#8c8479', '#6f675c', '#9a8f80', '#5f5850']));
      f.m().cylinder('concrete', x, 0, z, 1.5 + rng.next() * 2.5, 0.3, 0.8 + rng.next() * hh * 0.4, dc.multiplyScalar(0.75 + rng.next() * 0.2), 6, { top: true });
    }
    // tilted slabs
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BoxGeometry(2 + rng.next() * 4, 0.3, 1.5 + rng.next() * 3);
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3((rng.next() - 0.5) * m.w * 0.7, 0.5 + rng.next() * hh * 0.6, (rng.next() - 0.5) * m.d * 0.7), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.next() - 0.5, rng.next() * 6, rng.next() - 0.5)), new THREE.Vector3(1, 1, 1));
      f.m().addGeometry('concrete', g, rng.pick(['#8e897f', '#a39d92', '#7a756c']), mtx);
      g.dispose();
    }
    // broken wall stubs at the corners
    for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1]]) {
      if (!rng.chance(0.7)) continue;
      const wh = 1.5 + rng.next() * Math.min(6, m.h * 0.3);
      f.m(BLANK).box('wall_brick', (sx * m.w) / 2 - sx * 1.5, 0, (sz * m.d) / 2 - sz * 0.3, 3, wh, 0.4, wall);
    }
    // twisted beams
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(0.25, 0.25, 4 + rng.next() * 5);
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3((rng.next() - 0.5) * m.w * 0.5, hh * (0.3 + rng.next() * 0.5), (rng.next() - 0.5) * m.d * 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.next() * 1.2 - 0.6, rng.next() * 6, rng.next() * 0.8)), new THREE.Vector3(1, 1, 1));
      f.m().addGeometry('metal', g, P.rust, mtx);
      g.dispose();
    }
    f.pop();
    f.mass(m.cx, m.cz, heapR * 1.5, heapR * 1.5, 0, hh * 0.6, dust, dust, LodFacade.None);
  }
  const r = f.finish(2);
  return { ...r, emitters: [{ kind: 'dust', x: masses[0].cx, y: 2, z: masses[0].cz, rate: 0.4 }] };
}

/** Grime / soot applied to vertex colours (shaders add broken windows etc.). */
export function weatherModel(full: ZModel, kind: 'abandoned' | 'burned'): ZModel {
  const parts: ModelPart[] = full.parts.map((p) => {
    const g = p.geometry.clone();
    const c = g.getAttribute('color') as THREE.BufferAttribute;
    const arr = c.array as Float32Array;
    const veg = p.mat === 'grass' || p.mat === 'foliage' || p.mat === 'crop';
    for (let i = 0; i < arr.length; i += 3) {
      let r = arr[i], gg = arr[i + 1], b = arr[i + 2];
      if (kind === 'burned') {
        const k = veg ? 0.12 : 0.35;
        r *= k; gg *= k; b *= k;
      } else if (veg) {
        // overgrown, dried lawn
        const l = r * 0.3 + gg * 0.59 + b * 0.11;
        r = l * 1.25; gg = l * 1.08; b = l * 0.62;
      } else {
        const l = r * 0.3 + gg * 0.59 + b * 0.11;
        r = (r + (l - r) * 0.3) * 0.85; gg = (gg + (l - gg) * 0.3) * 0.83; b = (b + (l - b) * 0.3) * 0.8;
      }
      arr[i] = r; arr[i + 1] = gg; arr[i + 2] = b;
    }
    return { mat: p.mat === 'neon' || p.mat === 'emissive' ? 'plain' : p.mat, geometry: g };
  });
  return { ...full, parts, lights: [], emitters: kind === 'burned' ? [{ kind: 'smoke', x: 0, y: full.height * 0.6, z: 0, rate: 0.25 }] : [], anims: [] };
}
