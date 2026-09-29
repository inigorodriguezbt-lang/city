// Per-building field sampling. One reusable LotSample is filled for each
// building visited by the daily pass: utility connection flags (any footprint
// cell), road access (any perimeter cell) and environment / coverage values
// averaged between the lot's center and its road-facing front.
import { Dir, RoadType, type Building } from '../core/types';
import type { World } from '../world/World';

export class LotSample {
  power = false;
  water = false;
  sewage = false;
  road = false;
  /** index of the center cell and of the front-center cell */
  ci = 0;
  fi = 0;
  lv = 0;
  poll = 0;
  noise = 0;
  crime = 0;
  happy = 0;
  traffic = 0;
  police = 0;
  fire = 0;
  health = 0;
  edu = 0;
  leisure = 0;
  garbage = 0;
  death = 0;
  transit = 0;
  tourism = 0;
  /** average of the building's resource field (specialised industry), 0..255 */
  resource = 0;
}

const isAccess = (t: number): boolean => t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Highway;

/** true when any cell along the footprint perimeter is an access road */
export function hasRoadAccess(w: World, b: Building): boolean {
  const s = w.size, road = w.road;
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  for (let x = x0; x <= x1; x++) {
    if (y0 > 0 && isAccess(road[(y0 - 1) * s + x])) return true;
    if (y1 < s - 1 && isAccess(road[(y1 + 1) * s + x])) return true;
  }
  for (let y = y0; y <= y1; y++) {
    if (x0 > 0 && isAccess(road[y * s + x0 - 1])) return true;
    if (x1 < s - 1 && isAccess(road[y * s + x1 + 1])) return true;
  }
  return false;
}

/** index of the road cell in front of the building (or the front-center cell) */
export function frontRoadIndex(w: World, b: Building): number {
  const s = w.size;
  let x = b.x + (b.w >> 1), y = b.y + (b.h >> 1);
  switch (b.rot) {
    case Dir.N: y = b.y - 1; break;
    case Dir.S: y = b.y + b.h; break;
    case Dir.W: x = b.x - 1; break;
    case Dir.E: x = b.x + b.w; break;
  }
  if (x < 0 || y < 0 || x >= s || y >= s) return (b.y + (b.h >> 1)) * s + b.x + (b.w >> 1);
  return y * s + x;
}

/** Utilities + road only (cheap; used for service buildings). */
export function sampleUtilities(w: World, b: Building, out: LotSample): void {
  const s = w.size;
  const pw = w.fields.power, wt = w.fields.water, sw = w.fields.sewage;
  let p = false, wa = false, se = false;
  const x1 = Math.min(s, b.x + b.w), y1 = Math.min(s, b.y + b.h);
  for (let y = Math.max(0, b.y); y < y1 && !(p && wa && se); y++) {
    let i = y * s + Math.max(0, b.x);
    for (let x = Math.max(0, b.x); x < x1; x++, i++) {
      if (!p && pw[i] > 0) p = true;
      if (!wa && wt[i] > 0) wa = true;
      if (!se && sw[i] > 0) se = true;
    }
  }
  out.power = p;
  out.water = wa;
  out.sewage = se;
  out.road = hasRoadAccess(w, b);
  const cx = Math.min(s - 1, b.x + (b.w >> 1)), cy = Math.min(s - 1, b.y + (b.h >> 1));
  out.ci = cy * s + cx;
}

/** Full sample: utilities, road, environment and coverage. */
export function sampleLot(w: World, b: Building, out: LotSample, resourceField?: Uint8Array): void {
  sampleUtilities(w, b, out);
  const s = w.size;
  // front-center cell (inside the footprint, on the road side)
  let fx = b.x + (b.w >> 1), fy = b.y + (b.h >> 1);
  switch (b.rot) {
    case Dir.N: fy = b.y; break;
    case Dir.S: fy = b.y + b.h - 1; break;
    case Dir.W: fx = b.x; break;
    case Dir.E: fx = b.x + b.w - 1; break;
  }
  fx = Math.min(s - 1, Math.max(0, fx));
  fy = Math.min(s - 1, Math.max(0, fy));
  const c = out.ci, f = fy * s + fx;
  out.fi = f;
  const F = w.fields;
  out.lv = (F.landValue[c] + F.landValue[f]) * 0.5;
  out.poll = (F.pollution[c] + F.pollution[f]) * 0.5;
  out.noise = (F.noise[c] + F.noise[f]) * 0.5;
  out.crime = (F.crime[c] + F.crime[f]) * 0.5;
  out.happy = (F.happiness[c] + F.happiness[f]) * 0.5;
  out.police = Math.max(F.police[c], F.police[f]);
  out.fire = Math.max(F.fire[c], F.fire[f]);
  out.health = Math.max(F.health[c], F.health[f]);
  out.edu = Math.max(F.education[c], F.education[f]);
  out.leisure = Math.max(F.leisure[c], F.leisure[f]);
  out.garbage = Math.max(F.garbage[c], F.garbage[f]);
  out.death = Math.max(F.deathcare[c], F.deathcare[f]);
  out.transit = Math.max(F.transit[c], F.transit[f]);
  out.tourism = Math.max(F.tourism[c], F.tourism[f]);
  out.traffic = F.traffic[frontRoadIndex(w, b)];
  if (resourceField) {
    let sum = 0, n = 0;
    const x1 = Math.min(s, b.x + b.w), y1 = Math.min(s, b.y + b.h);
    for (let y = Math.max(0, b.y); y < y1; y++) for (let x = Math.max(0, b.x); x < x1; x++, n++) sum += resourceField[y * s + x];
    out.resource = n ? sum / n : 0;
  } else out.resource = 0;
}
