// Accurate ray picking against the heightfield + water surfaces:
// clip to the map box, march with a height-adaptive step, refine by bisection.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import type { World } from '../../world/World';

const _box = new THREE.Box3();
const _p = new THREE.Vector3();

/** rendered surface: terrain, or the water surface where the cell is wet */
export function surfaceHeight(world: World, x: number, z: number): { h: number; water: boolean } {
  const t = world.heightAt(x, z);
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (world.isWater(cx, cz)) {
    const lv = world.waterLevel(cx, cz);
    if (lv > t) return { h: lv, water: true };
  }
  return { h: t, water: false };
}

export function pickHeightfield(world: World, ray: THREE.Ray, minH: number, maxH: number): { point: THREE.Vector3; onWater: boolean } | null {
  const S = world.size * CELL;
  _box.min.set(0, minH - 2, 0);
  _box.max.set(S, maxH + 2 + Math.max(0, world.floodOffset), S);
  let t0: number;
  if (_box.containsPoint(ray.origin)) t0 = 0;
  else {
    const hit = ray.intersectBox(_box, _p);
    if (!hit) return null;
    t0 = ray.origin.distanceTo(hit);
  }
  // exit distance: march until we leave the box
  const d = ray.direction;
  let tExit = Infinity;
  const o = ray.origin;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, 0, S],
    [o.y, d.y, _box.min.y, _box.max.y],
    [o.z, d.z, 0, S],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) continue;
    const ta = (lo - oo) / dd, tb = (hi - oo) / dd;
    tExit = Math.min(tExit, Math.max(ta, tb));
  }
  if (!Number.isFinite(tExit)) tExit = t0 + 4 * S;
  const at = (t: number) => {
    const x = Math.min(S - 1e-3, Math.max(0, o.x + d.x * t));
    const z = Math.min(S - 1e-3, Math.max(0, o.z + d.z * t));
    return { y: o.y + d.y * t, s: surfaceHeight(world, x, z) };
  };
  let prev = t0;
  let cur = t0;
  let a = at(cur);
  if (a.y <= a.s.h) return finish(world, ray, cur, a.s.water);
  let guard = 0;
  while (cur < tExit && guard++ < 20000) {
    const gap = a.y - a.s.h;
    const step = Math.min(24, Math.max(1.5, gap * 0.45));
    prev = cur;
    cur = Math.min(tExit, cur + step);
    a = at(cur);
    if (a.y <= a.s.h) {
      // bisection refinement
      let lo = prev, hi = cur;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) * 0.5;
        const m = at(mid);
        if (m.y <= m.s.h) hi = mid;
        else lo = mid;
      }
      const f = at(hi);
      return finish(world, ray, hi, f.s.water);
    }
    if (cur >= tExit) break;
  }
  return null;
}

function finish(world: World, ray: THREE.Ray, t: number, water: boolean): { point: THREE.Vector3; onWater: boolean } | null {
  const p = ray.at(t, new THREE.Vector3());
  const S = world.size * CELL;
  if (p.x < 0 || p.z < 0 || p.x >= S || p.z >= S) return null;
  const s = surfaceHeight(world, p.x, p.z);
  p.y = s.h;
  return { point: p, onWater: water || s.water };
}
