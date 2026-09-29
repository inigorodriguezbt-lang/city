// ─────────────────────────────────────────────────────────────────────────────
// Vegetation ("Growing forests"): per-cell tree density 0..3.
//
// Forest potential = domain-warped patch noise + moisture (proximity to water,
// valley floors / drainage, theme rainfall) − dryness with altitude. The
// threshold is picked from a quantile so the forested share of land follows the
// theme and the forests slider exactly, then density ramps from the patch edge
// (1) to the core (3) with small clearings. No trees on water, beaches, bare
// rock, above the tree line, or in the start area core. Desert maps get oasis
// palms, acacia along dry washes and scattered cacti instead of forests.
// ─────────────────────────────────────────────────────────────────────────────
import { WATER_EPS } from '../../core/constants';
import type { GenContext } from './context';
import { cellHeights, cellSlopes, clampf, quantile, sstep } from './grid';
import { WK_LAKE, WK_OCEAN, WK_WASH } from './hydro';

/** Base forest cover share of land by theme at forests = 0.5. */
const COVER: Record<string, number> = {
  temperate: 0.34,
  boreal: 0.56,
  desert: 0,
  tropical: 0.5,
  alpine: 0.36,
  mediterranean: 0.24,
};

/** Tree line (m above sea level) per theme; above it only rock, meadow and snow. */
export function treeLine(ctx: GenContext): number {
  switch (ctx.params.theme.id) {
    case 'alpine': return 255;
    case 'boreal': return 215;
    case 'tropical': return 330;
    case 'mediterranean': return 360;
    default: return 380;
  }
}

export function growForests(ctx: GenContext, report: (f: number) => void): void {
  const size = ctx.size, nC = ctx.nC;
  const Zc = cellHeights(ctx.heights, size);
  const slope = cellSlopes(ctx.heights, size, 16);
  const water = ctx.water, kind = ctx.waterKind;
  const wd = ctx.waterDist as Float32Array;
  const A = ctx.flow;
  const sea = ctx.seaLevel;
  const theme = ctx.params.theme;
  const forests = ctx.params.forests;
  const L = ctx.layout;
  const core = L.buildRadius * 0.34;
  const trees = ctx.trees;
  trees.fill(0);
  const tl = treeLine(ctx);
  ctx.treeLine = tl;
  const nPatch = ctx.noise('forest-patch');
  const nWarp = ctx.noise('forest-warp');
  const nClear = ctx.noise('forest-clear');
  const rng = ctx.rng('trees');
  const coastal = L.hasSea;
  const wet = (i: number) => water[i] > Zc[i] + WATER_EPS;

  if (theme.id === 'desert') {
    growDesert(ctx, Zc, slope, wet, report);
    return;
  }

  // potential for every eligible land cell
  const pot = new Float32Array(nC).fill(-1e9);
  const elig = new Uint8Array(nC);
  const rain = theme.rainfall;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (wet(i) || kind[i] === WK_OCEAN || kind[i] === WK_LAKE) continue;
      const z = Zc[i] - sea;
      const s = slope[i];
      if (s > 0.62) continue;
      const tlj = tl + 22 * nClear.noise2(x / 45, y / 45);
      if (z > tlj) continue;
      const dStart = Math.hypot(x + 0.5 - L.startX, y + 0.5 - L.startY);
      if (dStart < core || Math.hypot(x - ctx.start.x, y - ctx.start.y) < 9 || ctx.routeMask[i]) continue;
      // beaches: coastal strip just above the sea
      const beach = coastal && z < 2.6 && wd[i] < 8;
      if (beach && theme.id !== 'tropical') continue;
      const wx = x + 18 * nWarp.fbm2(x / 70, y / 70, 3), wy = y + 18 * nWarp.fbm2(x / 70 + 9.3, y / 70 - 4.1, 3);
      const patch = nPatch.fbm2(wx / 95, wy / 95, 5);
      const nearWater = Math.exp(-wd[i] / 10);
      const valley = clampf(Math.log(1 + A[i]) / Math.log(1 + 4000), 0, 1);
      const moist = 0.55 * nearWater + 0.35 * valley + 0.6 * rain;
      const dry = sstep(0, tl, z) * 0.25 + sstep(0.35, 0.6, s) * 0.5;
      let v = patch + 0.45 * moist - dry;
      // thin toward the start area and the tree line
      v -= 0.35 * sstep(core * 1.9, core, dStart);
      v -= 0.4 * sstep(tlj - 45, tlj, z);
      if (beach) v -= 0.5;
      pot[i] = v;
      elig[i] = 1;
    }
    if ((y & 63) === 0) report(0.6 * (y / size));
  }
  let landN = 0;
  for (let i = 0; i < nC; i++) if (elig[i]) landN++;
  if (landN === 0) return;
  // share of eligible land to forest: theme base × slider (0 → none, 1 → ~2.1×)
  const base = COVER[theme.id] ?? 0.3;
  const share = clampf(base * (forests <= 0.5 ? forests * 2 : 1 + (forests - 0.5) * 2.2), 0, 0.88);
  if (share <= 0.001) return;
  const thr = quantile(pot, 1 - share, elig);
  const band = 0.16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!elig[i]) continue;
      const v = pot[i] - thr;
      if (v < 0) {
        // scattered lone trees / hedgerows just outside the forest edge
        if (v > -0.08 && rng.next() < 0.18 * (1 + v / 0.08)) trees[i] = 1;
        continue;
      }
      let d = 1 + Math.floor(2.999 * sstep(0, band, v));
      // clearings and glades
      const cl = nClear.fbm2(x / 16, y / 16, 3);
      if (cl > 0.42) d -= 2;
      else if (cl > 0.3) d -= 1;
      if (slope[i] > 0.45) d = Math.min(d, 2);
      if (theme.id === 'mediterranean' && d > 2 && rng.next() < 0.5) d = 2;
      if (d > 0 && rng.next() < 0.04) d--;
      trees[i] = d < 0 ? 0 : d > 3 ? 3 : d;
    }
  }
  // tropical beaches: a fringe of palms
  if (theme.id === 'tropical') {
    for (let i = 0; i < nC; i++) {
      if (!elig[i] || trees[i]) continue;
      const z = Zc[i] - sea;
      if (z > 0.4 && z < 2.6 && wd[i] > 0.9 && wd[i] < 7 && rng.next() < 0.45) trees[i] = rng.next() < 0.6 ? 1 : 2;
    }
  }
  report(1);
}

/** Desert: oasis palms, acacia along washes, scattered cacti. */
function growDesert(ctx: GenContext, Zc: Float32Array, slope: Float32Array, wet: (i: number) => boolean, report: (f: number) => void): void {
  const size = ctx.size;
  const wd = ctx.waterDist as Float32Array;
  const kind = ctx.waterKind;
  const trees = ctx.trees;
  const L = ctx.layout;
  const core = L.buildRadius * 0.3;
  const rng = ctx.rng('desert-trees');
  const n = ctx.noise('desert-veg');
  const f = ctx.params.forests;
  const k = 0.4 + 1.2 * f;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (wet(i) || slope[i] > 0.4) continue;
      const dStart = Math.hypot(x + 0.5 - L.startX, y + 0.5 - L.startY);
      if (dStart < core || Math.hypot(x - ctx.start.x, y - ctx.start.y) < 9 || ctx.routeMask[i]) continue;
      const nz = n.fbm2(x / 30, y / 30, 3);
      let d = 0;
      const dw = wd[i];
      if (dw < 14) {
        // oasis / riverside palm groves
        const p = (1 - dw / 14) * (0.75 + 0.5 * nz) * k;
        if (rng.next() < p) d = dw < 5 ? (rng.next() < 0.6 ? 3 : 2) : rng.next() < 0.5 ? 2 : 1;
      } else if (kind[i] === WK_WASH || (x > 0 && kind[i - 1] === WK_WASH) || (x < size - 1 && kind[i + 1] === WK_WASH)) {
        if (rng.next() < 0.3 * k) d = 1;
      } else if (slope[i] < 0.2 && nz > 0.15 && rng.next() < 0.025 * k) {
        d = 1; // lone cactus / scrub
      }
      trees[i] = d;
    }
    if ((y & 63) === 0) report(y / size);
  }
  report(1);
}
