// ─────────────────────────────────────────────────────────────────────────────
// Natural resources ("Surveying resources"), Uint8 0..255 per cell:
//   fertility – flat, moist lowlands and river plains (not under forest)
//   forest    – smoothed tree density
//   ore       – rocky blobs in hills and foothills
//   oil       – a few sedimentary basin blobs (may extend offshore)
//   wind      – exposure: ridges, hilltops and coasts (smooth)
// Specialised industry needs > 60, so every map guarantees reachable deposits
// of ore and oil near the start area and fertile land along its rivers.
// ─────────────────────────────────────────────────────────────────────────────
import { WATER_EPS } from '../../core/constants';
import type { GenContext } from './context';
import { blur, cellHeights, cellSlopes, clampf, distanceTransform, sstep } from './grid';
import { WK_OCEAN, WK_WASH } from './hydro';

const toU8 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

export function surveyResources(ctx: GenContext, report: (f: number) => void): void {
  const size = ctx.size, nC = ctx.nC;
  const Zc = cellHeights(ctx.heights, size);
  const slope = cellSlopes(ctx.heights, size, 16);
  const water = ctx.water, kind = ctx.waterKind;
  const wd = ctx.waterDist as Float32Array;
  const sea = ctx.seaLevel;
  const theme = ctx.params.theme;
  const L = ctx.layout;
  const wet = new Uint8Array(nC);
  for (let i = 0; i < nC; i++) wet[i] = water[i] > Zc[i] + WATER_EPS ? 1 : 0;
  // local relief: height above the regional (blurred) surface → hills, ridges
  const regional = blur(Zc, size, size, 22);
  // nearest wet cell → height above the nearby water surface (river plains)
  const near = distanceTransform(wet, size, size, true).nearest as Int32Array;
  const smoothSlope = blur(slope, size, size, 4);
  report(0.1);

  // ── forest ───────────────────────────────────────────────────────────────
  {
    const t = new Float32Array(nC);
    for (let i = 0; i < nC; i++) t[i] = ctx.trees[i] / 3;
    const b = blur(t, size, size, 2);
    for (let i = 0; i < nC; i++) ctx.forest[i] = wet[i] ? 0 : toU8(Math.pow(b[i], 0.8) * 1.15);
  }
  report(0.2);

  // ── fertility ────────────────────────────────────────────────────────────
  {
    const nSoil = ctx.noise('soil');
    const desert = theme.id === 'desert';
    const rain = theme.rainfall;
    const A = ctx.flow;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (wet[i]) continue;
        const z = Zc[i] - sea;
        const flat = 1 - sstep(0.05, 0.22, smoothSlope[i]);
        const low = 1 - sstep(35, 190, z);
        const nw = near[i];
        const above = nw >= 0 ? Zc[i] - water[nw] : 99;
        const plain = Math.exp(-wd[i] / (desert ? 7 : 16)) * (1 - sstep(3, 22, above));
        const valley = clampf(Math.log(1 + A[i]) / Math.log(1 + 3000), 0, 1);
        const soil = 0.75 + 0.45 * nSoil.fbm2(x / 55, y / 55, 4);
        let f: number;
        if (desert) {
          f = (0.95 * plain + (kind[i] === WK_WASH ? 0.3 : 0) + 0.12 * valley) * flat * soil;
        } else {
          f = (0.35 + 0.35 * rain + 0.4 * plain + 0.15 * valley) * flat * (0.35 + 0.65 * low) * soil;
        }
        // beaches and dunes are sandy, forests are not farmland
        if (L.hasSea && z < 2.5 && wd[i] < 8) f *= 0.2;
        f *= 1 - 0.8 * (ctx.trees[i] / 3);
        ctx.fertility[i] = toU8(f);
      }
    }
    const b = blur(new Float32Array(ctx.fertility), size, size, 1);
    for (let i = 0; i < nC; i++) ctx.fertility[i] = wet[i] ? 0 : Math.round(b[i]);
  }
  report(0.4);

  // ── ore: rocky blobs, favoured in hills/foothills ───────────────────────
  {
    const nOre = ctx.noise('ore');
    const nOre2 = ctx.noise('ore-detail');
    const ore = new Float32Array(nC);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (wet[i]) continue;
        const z = Zc[i] - sea;
        const hills = clampf(0.45 * sstep(0.04, 0.3, smoothSlope[i]) + 0.35 * sstep(-5, 40, Zc[i] - regional[i]) + 0.4 * sstep(25, 160, z), 0, 1);
        const blob = nOre.fbm2(x / 38, y / 38, 4) + 0.25 * nOre2.noise2(x / 9, y / 9);
        ore[i] = sstep(0.28, 0.58, blob) * (0.25 + 0.75 * hills);
      }
    }
    ensureDeposit(ctx, ore, wet, slope, 0.62, (i) => 0.4 * sstep(0.03, 0.25, smoothSlope[i]) + 0.6 * sstep(-5, 35, Zc[i] - regional[i]), 5, 9);
    for (let i = 0; i < nC; i++) ctx.ore[i] = toU8(ore[i]);
  }
  report(0.6);

  // ── oil: a few sedimentary basins ───────────────────────────────────────
  {
    const rng = ctx.rng('oil');
    const nOil = ctx.noise('oil');
    const oil = new Float32Array(nC);
    const count = 2 + Math.round(size / 192) + rng.int(0, 2);
    const reach = size * 0.42;
    for (let b = 0; b < count; b++) {
      // candidates weighted toward lowlands / shallow sea
      let best = -1, bestS = -Infinity;
      for (let t = 0; t < 40; t++) {
        const x = rng.int(8, size - 9), y = rng.int(8, size - 9);
        const i = y * size + x;
        const z = Zc[i] - sea;
        const offshore = kind[i] === WK_OCEAN;
        const s = (offshore ? (z > -30 ? 0.55 : -1) : 1 - sstep(10, 120, z)) - (b === 0 ? Math.hypot(x - L.startX, y - L.startY) / reach : 0) + 0.3 * rng.next();
        if (s > bestS) {
          bestS = s;
          best = i;
        }
      }
      if (best < 0) continue;
      const cx = best % size, cy = (best / size) | 0;
      const r = rng.range(7, 13) * (size >= 512 ? 1.4 : 1);
      const ang = rng.range(0, Math.PI);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const elong = rng.range(1, 1.8);
      const R = Math.ceil(r * elong * 1.5);
      for (let y = Math.max(0, cy - R); y <= Math.min(size - 1, cy + R); y++) {
        for (let x = Math.max(0, cx - R); x <= Math.min(size - 1, cx + R); x++) {
          const dx = x - cx, dy = y - cy;
          const u = (dx * ca + dy * sa) / elong, v = -dx * sa + dy * ca;
          const d = Math.hypot(u, v) / r;
          const e = d * (1 + 0.28 * nOil.fbm2(x / 12 + b * 17, y / 12, 3));
          const val = sstep(1.05, 0.35, e);
          const i = y * size + x;
          if (val > oil[i]) oil[i] = val;
        }
      }
    }
    ensureDeposit(ctx, oil, wet, slope, 0.62, (i) => 1 - sstep(10, 90, Zc[i] - sea), 7, 11);
    for (let i = 0; i < nC; i++) ctx.oil[i] = toU8(oil[i]);
  }
  report(0.8);

  // ── wind: exposure (ridges, hilltops, coasts), smooth ───────────────────
  {
    let hasOcean = false;
    const oceanSeed = new Uint8Array(nC);
    for (let i = 0; i < nC; i++) if (kind[i] === WK_OCEAN) {
      oceanSeed[i] = 1;
      hasOcean = true;
    }
    const dSea = hasOcean ? distanceTransform(oceanSeed, size, size).dist : null;
    const nWind = ctx.noise('wind');
    const w = new Float32Array(nC);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const z = Zc[i] - sea;
        const exposure = sstep(-10, 45, Zc[i] - regional[i]);
        const alt = sstep(20, 320, z);
        const coast = dSea ? Math.exp(-dSea[i] / 28) : 0;
        const open = kind[i] === WK_OCEAN ? 0.55 : 0;
        w[i] = 0.18 + 0.32 * exposure + 0.3 * alt + 0.35 * coast + open + 0.12 * nWind.fbm2(x / 90, y / 90, 3);
      }
    }
    const b = blur(w, size, size, 3);
    for (let i = 0; i < nC; i++) ctx.wind[i] = toU8(b[i] * 0.95);
  }
  report(1);
}

/**
 * Guarantee at least one deposit (value ≥ `min`) of `radius` cells on dry,
 * buildable land within reach of the start. If none exists, a blob is stamped
 * at the best-scoring nearby location.
 */
function ensureDeposit(ctx: GenContext, field: Float32Array, wet: Uint8Array, slope: Float32Array, min: number, score: (i: number) => number, rMin: number, rMax: number): void {
  const size = ctx.size, L = ctx.layout;
  const reach = Math.min(size * 0.4, L.buildRadius * 2.6);
  const core = L.buildRadius * 0.5;
  let good = 0;
  const x0 = Math.max(0, Math.floor(L.startX - reach)), x1 = Math.min(size - 1, Math.ceil(L.startX + reach));
  const y0 = Math.max(0, Math.floor(L.startY - reach)), y1 = Math.min(size - 1, Math.ceil(L.startY + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * size + x;
      if (!wet[i] && field[i] >= min && slope[i] < 0.3 && Math.hypot(x - L.startX, y - L.startY) <= reach) good++;
    }
  }
  if (good >= rMin * rMin) return;
  const rng = ctx.rng('deposit' + min + rMin);
  let best = -1, bestS = -Infinity;
  for (let t = 0; t < 160; t++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(core, reach);
    const x = Math.round(L.startX + Math.cos(a) * d), y = Math.round(L.startY + Math.sin(a) * d);
    if (x < 4 || y < 4 || x >= size - 4 || y >= size - 4) continue;
    const i = y * size + x;
    if (wet[i] || slope[i] > 0.3) continue;
    const s = score(i) - 0.3 * (d / reach) + 0.15 * rng.next();
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  }
  if (best < 0) return;
  const cx = best % size, cy = (best / size) | 0;
  const r = rng.range(rMin, rMax);
  const n = ctx.noise('deposit-edge');
  const R = Math.ceil(r * 1.6);
  for (let y = Math.max(0, cy - R); y <= Math.min(size - 1, cy + R); y++) {
    for (let x = Math.max(0, cx - R); x <= Math.min(size - 1, cx + R); x++) {
      const i = y * size + x;
      const d = (Math.hypot(x - cx, y - cy) / r) * (1 + 0.25 * n.fbm2(x / 8, y / 8, 2));
      const v = 0.95 * sstep(1.2, 0.4, d);
      if (v > field[i]) field[i] = v;
    }
  }
}
