// ─────────────────────────────────────────────────────────────────────────────
// Hydrology: sea, lakes and rivers.
//
//  1. cutDesignedRivers – a gentle monotone trench along each designed river
//     centre line so the main river follows the hand-designed meanders.
//  2. fillMinorDepressions – vertex-level Priority-Flood; closed depressions
//     too small/shallow to be lakes (or beyond the theme's lake count/area
//     budget, or inside the start core) are filled flat, the rest are kept.
//  3. buildWater – ocean (below sea level & connected to the edge), lakes
//     (filled depressions that pass area/depth thresholds scaled by the water
//     slider), flow accumulation incl. off-map catchments of designed rivers,
//     river channels with a monotone (non-increasing downstream) water surface
//     whose per-cell drop is capped (steep reaches incise into gorges/rapids,
//     over-incised lake outlets lower their lake), width/depth growing with
//     log discharge, carved into the terrain, and a one-ring surface extension
//     so renderers can draw continuous shorelines.
// ─────────────────────────────────────────────────────────────────────────────
import { WATER_EPS } from '../../core/constants';
import type { GenContext } from './context';
import { accumulate, priorityFlood } from './flow';
import { IntQueue, N8_DX, N8_DY, cellHeights, clampf, distanceTransform, mix, sampleBilinear, sstep } from './grid';
import { pathField, pointAt } from './paths';

/** water-body classes stored in ctx.waterKind */
export const WK_DRY = 0;
export const WK_OCEAN = 1;
export const WK_LAKE = 2;
export const WK_RIVER = 3;
export const WK_WASH = 4;

const DRY = -1e4;

/** Lake acceptance thresholds for the current theme + water slider. */
function lakeThresholds(ctx: GenContext): { depth: number; area: number } {
  const w = ctx.params.water;
  let depth = mix(6.5, 2.4, w);
  let area = mix(520, 90, w);
  switch (ctx.params.theme.id) {
    case 'boreal': depth *= 0.4; area *= 0.22; break;
    case 'alpine': depth *= 0.75; area *= 0.45; break;
    case 'desert': depth *= 2; area *= 3; break;
    case 'mediterranean': depth *= 1.2; area *= 1.4; break;
    case 'tropical': depth *= 1.1; area *= 1.2; break;
    default: break;
  }
  return { depth, area };
}

/**
 * How many natural (non-designed) lakes a map may keep. Fluvial themes get a
 * handful, glacial ones many; scales with map area and the water slider.
 */
function lakeBudget(ctx: GenContext): number {
  const w = ctx.params.water;
  const area = Math.pow(ctx.size / 384, 1.5);
  let n: number;
  switch (ctx.params.theme.id) {
    case 'boreal': n = 14 + 34 * w; break;
    case 'alpine': n = 2 + 6 * w; break;
    case 'desert': n = 0; break;
    case 'mediterranean': n = 0.4 + 2.2 * w; break;
    case 'tropical': n = 0.5 + 2 * w; break;
    default: n = 0.8 + 3.4 * w; break;
  }
  return Math.round(n * area);
}

/**
 * Share of the map natural lakes may cover in total, and the largest share a
 * single natural lake may take (bigger basins are filled into flat valley
 * floors / bogs instead of swallowing the landscape).
 */
function lakeAreaShare(ctx: GenContext): { total: number; single: number } {
  const w = ctx.params.water;
  switch (ctx.params.theme.id) {
    case 'boreal': return { total: 0.05 + 0.1 * w, single: 0.012 + 0.016 * w };
    case 'alpine': return { total: 0.012 + 0.03 * w, single: 0.012 + 0.012 * w };
    case 'desert': return { total: 0, single: 0 };
    case 'mediterranean': return { total: 0.004 + 0.016 * w, single: 0.008 + 0.01 * w };
    case 'tropical': return { total: 0.003 + 0.012 * w, single: 0.006 + 0.008 * w };
    default: return { total: 0.008 + 0.026 * w, single: 0.012 + 0.014 * w };
  }
}

/** True if grid node (x, y) on a w×w grid lies inside a designed lake basin. */
function inDesignedLake(ctx: GenContext, x: number, y: number, w: number): boolean {
  const lakes = ctx.layout.lakes;
  if (!lakes || lakes.length === 0) return false;
  const sc = ctx.size / w;
  for (const lk of lakes) if (Math.hypot(x * sc - lk.x, y * sc - lk.y) < lk.r * 0.7) return true;
  return false;
}

/** Drainage area (cells) above which a channel carries permanent water. */
export function channelThreshold(ctx: GenContext): number {
  const w = ctx.params.water;
  let t = mix(9000, 2400, w);
  switch (ctx.params.theme.id) {
    case 'boreal': t *= 0.75; break;
    case 'tropical': t *= 0.45; break;
    case 'mediterranean': t *= 1.5; break;
    case 'alpine': t *= 0.8; break;
    case 'desert': t *= 0.6; break; // desert channels are dry washes (except the designed river)
    default: break;
  }
  return t;
}

/** Sea level: 0 on coastal maps; below the lowest terrain elsewhere. */
export function chooseSeaLevel(ctx: GenContext): number {
  if (ctx.layout.hasSea) return 0;
  let lo = Infinity;
  const h = ctx.heights;
  for (let i = 0; i < h.length; i++) if (h[i] < lo) lo = h[i];
  return Math.min(0, Math.floor(lo - 20));
}

/** Points (cell coords) where designed rivers with off-map catchments enter the map. */
export function riverEntries(ctx: GenContext): [number, number][] {
  const size = ctx.size;
  const out: [number, number][] = [];
  for (const p of ctx.layout.rivers) {
    if (p.inflow <= 0) continue;
    const cnt = p.arc.length;
    for (let k = 0; k < cnt; k++) {
      const x = p.pts[k * 2], y = p.pts[k * 2 + 1];
      if (x < 0 || y < 0 || x > size || y > size) continue;
      out.push([x, y]);
      break;
    }
  }
  return out;
}

/**
 * Outlet mask for a w×w grid spanning the map (w = size for cells, size+1 for
 * vertices): every border node drains off-map except those near a designed
 * river entry (water comes *in* there), OR-ed with an optional extra mask.
 */
export function edgeOutlets(ctx: GenContext, w: number, extra: Uint8Array | null): Uint8Array {
  const m = extra ? new Uint8Array(extra) : new Uint8Array(w * w);
  const entries = riverEntries(ctx);
  const scale = w / ctx.size;
  const R = 14;
  const near = (x: number, y: number) => {
    for (const [ex, ey] of entries) if (Math.hypot(x / scale - ex, y / scale - ey) < R) return true;
    return false;
  };
  for (let t = 0; t < w; t++) {
    const pts: [number, number][] = [[t, 0], [t, w - 1], [0, t], [w - 1, t]];
    for (const [x, y] of pts) if (!near(x, y)) m[y * w + x] = 1;
  }
  return m;
}

// ── 1. designed river trenches ──────────────────────────────────────────────

/**
 * Lower a smooth trench (only ever lowers) along each designed river so the
 * drainage network follows it. The profile is a running minimum of the
 * terrain along the path (monotone downstream); inside designed lake spans no
 * trench is cut, and past a lake the profile restarts at the basin rim so the
 * lake keeps a natural sill.
 */
export function cutDesignedRivers(ctx: GenContext): void {
  const rivers = ctx.layout.rivers;
  if (rivers.length === 0) return;
  const V = ctx.V, h = ctx.heights;
  const pf = pathField(rivers, V);
  const depth = 1.6;
  const core = 1.6, outer = 5.5;
  const profiles: Float32Array[] = [];
  for (const p of rivers) {
    const N = Math.max(16, Math.ceil(p.length * 2));
    const z = new Float32Array(N + 1);
    for (let k = 0; k <= N; k++) {
      const [x, y] = pointAt(p, k / N);
      z[k] = sampleBilinear(h, V, V, x, y) - depth;
    }
    const prof = new Float32Array(N + 1);
    const inLake = (t: number) => p.lakeSpans.some(([a, b]) => t >= a && t <= b);
    let run = Infinity;
    let k = 0;
    while (k <= N) {
      const t = k / N;
      if (inLake(t)) {
        prof[k] = NaN;
        k++;
        // leaving a lake span → restart at the rim (max terrain shortly downstream)
        if (k <= N && !inLake(k / N)) {
          let rim = -Infinity;
          const win = Math.min(N, k + Math.ceil(N * 0.05) + 8);
          for (let q = k; q <= win; q++) if (z[q] > rim) rim = z[q];
          run = rim + depth * 0.75;
        }
        continue;
      }
      if (z[k] < run) run = z[k];
      prof[k] = run;
      k++;
    }
    // light monotone-preserving smoothing
    const sm = new Float32Array(prof);
    for (let it = 0; it < 3; it++) {
      for (let q = 1; q < N; q++) {
        if (Number.isNaN(prof[q - 1]) || Number.isNaN(prof[q]) || Number.isNaN(prof[q + 1])) continue;
        sm[q] = (prof[q - 1] + 2 * prof[q] + prof[q + 1]) * 0.25;
      }
      prof.set(sm);
    }
    for (let q = 1; q <= N; q++) if (!Number.isNaN(prof[q]) && !Number.isNaN(prof[q - 1]) && prof[q] > prof[q - 1]) prof[q] = prof[q - 1];
    profiles.push(prof);
  }
  const n = V * V;
  for (let i = 0; i < n; i++) {
    const d = pf.dist[i];
    if (d >= outer) continue;
    const id = pf.id[i];
    if (id < 0) continue;
    const prof = profiles[id];
    const N = prof.length - 1;
    const f = pf.s[i] * N;
    const k0 = Math.min(N - 1, Math.floor(f));
    const a = prof[k0], b = prof[k0 + 1];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const target = a + (b - a) * (f - k0) + 0.5 * depth * (d / outer) * (d / outer);
    const w = sstep(outer, core, d);
    const z = mix(h[i], target, w);
    if (z < h[i]) h[i] = z;
  }
}

// ── 2. minor depression filling (vertex grid) ───────────────────────────────

/** Ocean seeds on a w×h grid: values below `level` 4-connected to the edge. */
export function oceanMask(z: Float32Array, w: number, hgt: number, level: number): Uint8Array {
  const m = new Uint8Array(w * hgt);
  const q = new IntQueue(4096);
  const seed = (i: number) => {
    if (m[i] || z[i] >= level) return;
    m[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((hgt - 1) * w + x);
  }
  for (let y = 0; y < hgt; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (q.length) {
    const i = q.shift();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < hgt - 1) seed(i + w);
  }
  return m;
}

/**
 * Flood-fill every closed depression of the vertex DEM that fails the lake
 * thresholds (so drainage is clean and the land has no puddles), keeping the
 * rest as lake basins.
 */
export function fillMinorDepressions(ctx: GenContext, scale = 1, budget = 1): void {
  const V = ctx.V, h = ctx.heights, n = V * V;
  const hasSea = ctx.layout.hasSea;
  const ocean = hasSea ? oceanMask(h, V, V, ctx.seaLevel) : null;
  // ε-fill so filled flats keep draining toward their spill point
  const eps = 0.012;
  const g = priorityFlood(h, V, V, { outlet: edgeOutlets(ctx, V, ocean), edges: false, epsilon: eps });
  const F = g.F;
  const t = lakeThresholds(ctx);
  const dMin = t.depth * scale, aMin = t.area * scale;
  const seen = new Uint8Array(n);
  const q = new IntQueue(4096);
  // collect depressions; members stored contiguously
  const members: number[] = [];
  const comps: { start: number; end: number; depth: number; designed: boolean; core: number; score: number }[] = [];
  const L = ctx.layout;
  const coreR = L.buildRadius * 0.5;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !g.raised[s] || (ocean && ocean[s])) continue;
    const start = members.length;
    seen[s] = 1;
    q.clear();
    q.push(s);
    let maxDepth = 0;
    let designed = false;
    let core = 0;
    while (q.length) {
      const i = q.shift();
      members.push(i);
      const dd = F[i] - h[i];
      if (dd > maxDepth) maxDepth = dd;
      const x = i % V, y = (i / V) | 0;
      if (!designed && dd > 1 && inDesignedLake(ctx, x, y, V)) designed = true;
      if (Math.hypot(x - L.startX, y - L.startY) < coreR) core++;
      for (let k = 0; k < 8; k++) {
        const nx = x + N8_DX[k], ny = y + N8_DY[k];
        if (nx < 0 || ny < 0 || nx >= V || ny >= V) continue;
        const j = ny * V + nx;
        if (seen[j] || !g.raised[j]) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    const area = members.length - start;
    comps.push({ start, end: members.length, depth: maxDepth, designed, core: core / area, score: Math.sqrt(maxDepth * area) });
  }
  // keep designed lakes plus the best natural candidates within the theme's
  // lake count and area budgets; basins in the start core are always filled
  const share = lakeAreaShare(ctx);
  const areaBudget = share.total * n * budget;
  const maxArea = share.single * n;
  const cand = comps.filter((c) => !c.designed && c.core < 0.25 && c.depth >= dMin && c.end - c.start >= aMin && c.end - c.start <= maxArea).sort((a, b) => b.score - a.score);
  const keep = new Set<(typeof comps)[number]>();
  const maxCount = Math.max(0, Math.round(lakeBudget(ctx) * budget));
  let used = 0;
  for (const c of cand) {
    if (keep.size >= maxCount) break;
    const area = c.end - c.start;
    if (used + area > areaBudget) continue;
    used += area;
    keep.add(c);
  }
  for (const c of comps) {
    if (c.designed || keep.has(c)) continue;
    for (let k = c.start; k < c.end; k++) h[members[k]] = F[members[k]];
  }
}

// ── 3. water bodies & rivers (cell grid) ────────────────────────────────────

/** Cells where designed rivers enter the map, with their off-map catchment. */
function designedInflows(ctx: GenContext, Zc: Float32Array): { cell: number; inflow: number }[] {
  const size = ctx.size;
  const out: { cell: number; inflow: number }[] = [];
  for (const p of ctx.layout.rivers) {
    if (p.inflow <= 0) continue;
    const cnt = p.arc.length;
    for (let k = 0; k < cnt; k++) {
      const x = p.pts[k * 2], y = p.pts[k * 2 + 1];
      if (x < 3 || y < 3 || x > size - 3 || y > size - 3) continue;
      // lowest cell near the entry point
      const cx = Math.floor(x), cy = Math.floor(y);
      let best = -1, bz = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const z = Zc[yy * size + xx];
          if (z < bz) {
            bz = z;
            best = yy * size + xx;
          }
        }
      }
      if (best >= 0) out.push({ cell: best, inflow: p.inflow });
      break;
    }
  }
  return out;
}

export function buildWater(ctx: GenContext, report: (f: number) => void): void {
  const size = ctx.size, V = ctx.V, nC = ctx.nC, h = ctx.heights;
  const sea = ctx.seaLevel;
  const kind = ctx.waterKind;
  kind.fill(0);
  let Zc = cellHeights(h, size);
  const ocean = ctx.layout.hasSea ? oceanMask(Zc, size, size, sea) : new Uint8Array(nC);
  report(0.1);
  // routing surface: sub-metre noise breaks up the unnaturally straight flow
  // lines that pure D8 routing produces across plains and flats
  const Zr = new Float32Array(Zc);
  {
    const nz = ctx.noise('routing');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (!ocean[i]) Zr[i] += 0.28 * nz.fbm2(x / 11, y / 11, 3) + 0.45 * nz.fbm2(x / 45 + 17, y / 45, 2);
      }
    }
  }
  const g = priorityFlood(Zr, size, size, { outlet: edgeOutlets(ctx, size, ocean), edges: false });
  const { F, rec, order } = g;
  report(0.3);

  // ── lakes: connected raised regions sharing one spill level ──────────────
  const { depth: dMin, area: aMin } = lakeThresholds(ctx);
  const lakeLevel = new Float32Array(nC).fill(NaN);
  /** lake component id per cell (-1 = none) and each lake's surface level */
  const lakeId = new Int32Array(nC).fill(-1);
  const lakeLv: number[] = [];
  {
    const seen = new Uint8Array(nC);
    const q = new IntQueue(4096);
    const comp: number[] = [];
    for (let s = 0; s < nC; s++) {
      if (seen[s] || ocean[s] || F[s] - Zr[s] <= 0.02) continue;
      const level = F[s];
      comp.length = 0;
      seen[s] = 1;
      q.clear();
      q.push(s);
      let maxDepth = 0;
      let designed = false;
      while (q.length) {
        const i = q.shift();
        comp.push(i);
        const dd = level - Zc[i];
        if (dd > maxDepth) maxDepth = dd;
        const x = i % size, y = (i / size) | 0;
        if (!designed && dd > 1 && inDesignedLake(ctx, x + 0.5, y + 0.5, size)) designed = true;
        for (let k = 0; k < 8; k++) {
          const nx = x + N8_DX[k], ny = y + N8_DY[k];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (seen[j] || ocean[j] || F[j] - Zr[j] <= 0.02 || Math.abs(F[j] - level) > 1e-3) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
      if (designed || (maxDepth >= dMin * 0.5 && comp.length >= aMin * 0.5)) {
        const id = lakeLv.length;
        lakeLv.push(level);
        for (const i of comp) {
          lakeLevel[i] = level;
          lakeId[i] = id;
          kind[i] = WK_LAKE;
        }
      }
    }
  }
  for (let i = 0; i < nC; i++) if (ocean[i]) kind[i] = WK_OCEAN;
  report(0.4);

  // ── flow accumulation (rain + off-map catchments of designed rivers) ─────
  const rain = new Float32Array(nC);
  for (let i = 0; i < nC; i++) rain[i] = ocean[i] ? 0 : 1;
  const inflows = designedInflows(ctx, Zc);
  const designed = new Float32Array(nC);
  for (const f of inflows) {
    rain[f.cell] += f.inflow;
    designed[f.cell] += f.inflow;
  }
  const A = accumulate(g, rain);
  const D = accumulate(g, designed);
  ctx.flow = A;
  report(0.5);

  // ── channels ─────────────────────────────────────────────────────────────
  const thr = channelThreshold(ctx);
  const isDesert = ctx.params.theme.id === 'desert';
  const washThr = thr * 0.45;
  /** 1 = wet channel centre, 2 = dry wash centre */
  const center = new Uint8Array(nC);
  for (let i = 0; i < nC; i++) {
    if (ocean[i] || kind[i] === WK_LAKE) continue;
    if (isDesert) {
      if (D[i] > 0 && A[i] >= thr) center[i] = 1;
      else if (A[i] >= washThr) center[i] = 2;
    } else if (A[i] >= thr) center[i] = 1;
  }
  // water surface S along wet channels
  const log10 = (v: number) => Math.log(v) / Math.LN10;
  const ratio = (i: number) => Math.max(1, A[i] / thr);
  const freeboard = (i: number) => clampf(0.95 + 0.45 * log10(ratio(i)), 0.95, 2.2);
  const S = new Float32Array(nC).fill(NaN);
  const up = new Int32Array(nC).fill(-1); // main (largest) channel donor
  const upA = new Float32Array(nC);
  for (let q = nC - 1; q >= 0; q--) {
    const c = order[q];
    if (!center[c]) continue;
    const r = rec[c];
    if (r >= 0 && center[r] === center[c] && A[c] > upA[r]) {
      upA[r] = A[c];
      up[r] = c;
    }
  }
  // distance (channel steps) below a lake/sea outlet, for the surface ramp
  const below = new Float32Array(nC).fill(99);
  const upS = new Float32Array(nC).fill(Infinity);
  const passDown = () => {
    upS.fill(Infinity);
    for (let q = nC - 1; q >= 0; q--) {
      const c = order[q];
      if (center[c] !== 1) continue;
      if (upS[c] < S[c]) S[c] = upS[c];
      const r = rec[c];
      if (r >= 0 && center[r] === 1 && S[c] < upS[r]) upS[r] = S[c];
    }
  };
  const passUp = () => {
    for (let q = 0; q < nC; q++) {
      const c = order[q];
      if (center[c] !== 1) continue;
      const r = rec[c];
      let base = -Infinity;
      if (r >= 0) {
        if (center[r] === 1) base = S[r];
        else if (ocean[r]) base = sea;
        else if (kind[r] === WK_LAKE) base = lakeLevel[r];
      }
      if (S[c] < base) S[c] = base;
    }
  };
  for (let q = nC - 1; q >= 0; q--) {
    const c = order[q];
    if (center[c] !== 1) continue;
    // lake outlet: the first channel cell whose donor lies in a lake
    let b = 99;
    const x = c % size, y = (c / size) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8_DX[k], ny = y + N8_DY[k];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (rec[j] === c && kind[j] === WK_LAKE) b = 0;
    }
    const u = up[c];
    if (u >= 0 && below[u] + 1 < b) b = below[u] + 1;
    below[c] = b;
    const ramp = sstep(0, 6, b);
    S[c] = F[c] - freeboard(c) * (0.25 + 0.75 * ramp);
  }
  passDown();
  passUp();
  // smooth along the main stem, then restore monotonicity
  const tmpS = new Float32Array(nC);
  for (let it = 0; it < 4; it++) {
    tmpS.set(S);
    for (let c = 0; c < nC; c++) {
      if (center[c] !== 1) continue;
      const u = up[c], r = rec[c];
      const su = u >= 0 ? tmpS[u] : tmpS[c];
      const sd = r >= 0 && center[r] === 1 ? tmpS[r] : tmpS[c];
      S[c] = (su + 2 * tmpS[c] + sd) * 0.25;
    }
    passDown();
    passUp();
  }
  // parallel channels (a tributary hugging the main river before joining):
  // the smaller one drops to the larger one's surface where they touch
  for (let it = 0; it < 3; it++) {
    let changed = 0;
    for (let c = 0; c < nC; c++) {
      if (center[c] !== 1) continue;
      const x = c % size, y = (c / size) | 0;
      // channels up to 3 wide touch when their centres are ≤ 3 cells apart;
      // only merge channels on the same valley floor (similar ground level)
      // and never incise more than a few metres below the banks
      const deepest = F[c] - freeboard(c) - 3;
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= size) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= size || (dx === 0 && dy === 0)) continue;
          const j = ny * size + nx;
          if (center[j] !== 1 || rec[c] === j || rec[j] === c || A[j] <= A[c]) continue;
          if (Math.abs(F[c] - F[j]) > 3.5) continue;
          const lim = Math.max(deepest, S[j] + 0.3 * Math.max(Math.abs(dx), Math.abs(dy)));
          if (S[c] > lim + 1e-4) {
            S[c] = lim;
            changed++;
          }
        }
      }
    }
    if (!changed) break;
    passDown();
    passUp();
  }
  // gorge pass (outlets upstream): bound the per-cell surface drop so water
  // stays continuous — knickpoints become short incised gorges and no link
  // drops more than MAX_RAPID (steep reaches become rapids, never waterfalls).
  // Small streams that would still tumble down steep slopes stay dry rocky
  // gullies until the gradient eases, so every wet channel flows continuously
  // to its outlet.
  const MAX_RAPID = 2.2;
  const flowing = new Uint8Array(nC);
  const gorgePass = () => {
    for (let q = 0; q < nC; q++) {
      const c = order[q];
      if (center[c] !== 1) continue;
      const r = rec[c];
      let base = NaN;
      let ok = 1;
      if (r >= 0) {
        if (center[r] === 1) {
          base = S[r];
          ok = flowing[r];
        } else if (ocean[r]) base = sea;
        else if (kind[r] === WK_LAKE) base = lakeLevel[r];
      }
      if (Number.isNaN(base)) {
        flowing[c] = 1;
        continue;
      }
      const major = ratio(c) > 6;
      const maxDrop = major ? 0.55 : 0.9;
      const deepest = F[c] - freeboard(c) - (major ? 6 : 2.5);
      const lim = Math.min(Math.max(base + maxDrop, deepest), base + MAX_RAPID);
      if (S[c] > lim) S[c] = lim;
      flowing[c] = major || (ok && S[c] - base <= 1.3) ? 1 : 0;
    }
  };
  gorgePass();
  // a lake whose outlet had to incise far below its spill level drains down
  // to just above the outlet (the sill is cut); its inflows are then re-graded.
  // Draining one lake can deepen the valley feeding it from a lake upstream,
  // so this repeats until every outlet sits within MAX_RAPID of its lake.
  if (lakeLv.length > 0) {
    const outMin = new Float32Array(lakeLv.length);
    for (let round = 0; round < 8; round++) {
      outMin.fill(Infinity);
      // an outlet is any wet channel cell that receives flow from a lake cell
      for (let j = 0; j < nC; j++) {
        const id = lakeId[j];
        if (id < 0) continue;
        const r = rec[j];
        if (r < 0 || lakeId[r] === id || center[r] !== 1 || !flowing[r]) continue;
        if (S[r] < outMin[id]) outMin[id] = S[r];
      }
      let lowered = false;
      for (let id = 0; id < lakeLv.length; id++) {
        if (outMin[id] < lakeLv[id] - MAX_RAPID) {
          lakeLv[id] = outMin[id] + MAX_RAPID * 0.8;
          lowered = true;
        }
      }
      if (!lowered) break;
      for (let i = 0; i < nC; i++) if (lakeId[i] >= 0) lakeLevel[i] = lakeLv[lakeId[i]];
      gorgePass();
    }
  }
  for (let c = 0; c < nC; c++) if (center[c] === 1 && !flowing[c]) center[c] = 2;
  report(0.62);

  // ── stamp channel width; per-cell surface/bed ────────────────────────────
  const chS = new Float32Array(nC).fill(NaN);
  const chB = new Float32Array(nC).fill(NaN);
  const chA = new Float32Array(nC);
  const wash = new Uint8Array(nC);
  /** write a channel cell unless a higher-priority (larger discharge / centre) stamp owns it */
  const stamp = (x: number, y: number, s: number, b: number, pri: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    if (ocean[i] || kind[i] === WK_LAKE) return;
    if (!Number.isNaN(chB[i]) && chA[i] >= pri) return;
    chS[i] = s;
    chB[i] = b;
    chA[i] = pri;
  };
  const centerOrder: number[] = [];
  for (let q = 0; q < nC; q++) {
    const c = order[q];
    if (center[c]) centerOrder.push(c);
  }
  // pass 1: side cells (larger discharge wins), pass 2: centres (always win)
  for (let pass = 0; pass < 2; pass++) {
    for (const c of centerOrder) {
      const x = c % size, y = (c / size) | 0;
      const r = rec[c];
      const isWash = center[c] === 2;
      const a = A[c];
      const rr = ratio(c);
      const width = isWash ? (rr > 8 ? 2 : 1) : rr > 40 ? 3 : rr > 6 ? 2 : 1;
      let s: number, b: number;
      if (isWash) {
        s = DRY;
        b = F[c] - clampf(0.8 + 0.4 * log10(Math.max(1, a / washThr)), 0.8, 1.8);
      } else {
        s = S[c];
        b = s - clampf(1.1 + 1.1 * log10(rr), 1.1, 4.2);
      }
      if (pass === 1) {
        stamp(x, y, s, b, 1e15 + a);
        if (isWash) wash[c] = 1;
        continue;
      }
      if (r < 0) continue;
      const dx = (r % size) - x, dy = ((r / size) | 0) - y;
      const diag = dx !== 0 && dy !== 0;
      if (diag) {
        // corner fill keeps the channel 4-connected
        const ia = y * size + x + dx, ib = (y + dy) * size + x;
        if (width === 1) {
          if (Zc[ia] <= Zc[ib]) stamp(x + dx, y, s, b, a);
          else stamp(x, y + dy, s, b, a);
        } else {
          stamp(x + dx, y, s, b, a);
          stamp(x, y + dy, s, b, a);
          if (width >= 3) {
            stamp(x - dy, y + dx, s, b, a);
            stamp(x + dy, y - dx, s, b, a);
          }
        }
      } else if (width >= 2) {
        // perpendicular spread: left side for width 2, both sides for width 3
        stamp(x - dy, y + dx, s, b, a);
        if (width >= 3) stamp(x + dy, y - dx, s, b, a);
      }
      if (isWash) {
        const set = (xx: number, yy: number) => {
          if (xx >= 0 && yy >= 0 && xx < size && yy < size) wash[yy * size + xx] = 1;
        };
        if (diag) set(x + dx, y);
        else if (width >= 2) set(x - dy, y + dx);
      }
    }
  }
  report(0.72);

  // ── carve: lower vertices under channels ─────────────────────────────────
  const EDGE = [0, 0.45, 0.8, 1.1];
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      let k = 0, sMax = -Infinity, bMin = Infinity, wetK = 0;
      for (let q = 0; q < 4; q++) {
        const cx = vx - 1 + (q & 1), cy = vy - 1 + (q >> 1);
        if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
        const i = cy * size + cx;
        const b = chB[i];
        if (Number.isNaN(b)) continue;
        k++;
        const s = chS[i];
        if (s > DRY) {
          wetK++;
          if (s > sMax) sMax = s;
        }
        if (b < bMin) bMin = b;
      }
      if (k === 0) continue;
      const vi = vy * V + vx;
      let target: number;
      if (wetK === 0) {
        // dry wash: shallow rounded gully
        target = k === 4 ? bMin : bMin + (4 - k) * 0.3;
      } else if (k === 4) target = Math.min(bMin, sMax - 0.9);
      else target = sMax - EDGE[k];
      if (target < h[vi]) h[vi] = target;
    }
  }
  report(0.8);

  // ── final surfaces ───────────────────────────────────────────────────────
  Zc = cellHeights(h, size);
  const water = ctx.water;
  water.fill(DRY);
  for (let i = 0; i < nC; i++) {
    if (ocean[i]) water[i] = sea;
    else if (kind[i] === WK_LAKE) {
      if (lakeLevel[i] > Zc[i] + WATER_EPS) water[i] = lakeLevel[i];
      else kind[i] = WK_DRY;
    } else if (!Number.isNaN(chS[i]) && chS[i] > DRY) {
      water[i] = chS[i];
      kind[i] = WK_RIVER;
    } else if (wash[i] || (!Number.isNaN(chB[i]) && chS[i] === DRY)) kind[i] = WK_WASH;
  }
  // bank cells of wide channels on steep reaches were stamped from centres a
  // few links apart; pull any that stand well above a wet neighbour down so
  // the rendered surface stays continuous (channel centres never move)
  for (let it = 0; it < 2; it++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (kind[i] !== WK_RIVER || center[i] === 1) continue;
        const wi = water[i];
        let lo = Infinity;
        if (x > 0 && water[i - 1] > Zc[i - 1] + WATER_EPS && water[i - 1] < lo) lo = water[i - 1];
        if (x < size - 1 && water[i + 1] > Zc[i + 1] + WATER_EPS && water[i + 1] < lo) lo = water[i + 1];
        if (y > 0 && water[i - size] > Zc[i - size] + WATER_EPS && water[i - size] < lo) lo = water[i - size];
        if (y < size - 1 && water[i + size] > Zc[i + size] + WATER_EPS && water[i + size] < lo) lo = water[i + size];
        if (wi > lo + MAX_RAPID) water[i] = lo + MAX_RAPID;
      }
    }
  }
  // ring 1: 4-neighbours of water bodies take the (lowest) adjacent surface
  const ring = new Float32Array(nC).fill(DRY);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (water[i] > DRY) continue;
      let s = Infinity;
      if (x > 0 && water[i - 1] > DRY && water[i - 1] < s) s = water[i - 1];
      if (x < size - 1 && water[i + 1] > DRY && water[i + 1] < s) s = water[i + 1];
      if (y > 0 && water[i - size] > DRY && water[i - size] < s) s = water[i - size];
      if (y < size - 1 && water[i + size] > DRY && water[i + size] < s) s = water[i + size];
      if (s < Infinity) ring[i] = s;
    }
  }
  for (let i = 0; i < nC; i++) {
    if (ring[i] > DRY) {
      water[i] = ring[i];
      if (ring[i] > Zc[i] + WATER_EPS && kind[i] === WK_DRY) kind[i] = WK_RIVER;
    }
  }
  // ring 2: 8-neighbours get a surface capped just below their own ground (always dry)
  ring.fill(DRY);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (water[i] > DRY) continue;
      let s = DRY;
      for (let k = 0; k < 8; k++) {
        const nx = x + N8_DX[k], ny = y + N8_DY[k];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const w = water[ny * size + nx];
        if (w > s) s = w;
      }
      if (s > DRY) ring[i] = Math.min(s, Zc[i] + WATER_EPS * 0.5);
    }
  }
  for (let i = 0; i < nC; i++) if (ring[i] > DRY) water[i] = ring[i];
  report(0.92);

  // distance to the nearest wet cell (cells) for vegetation/resources/routing
  const wet = new Uint8Array(nC);
  for (let i = 0; i < nC; i++) wet[i] = water[i] > Zc[i] + WATER_EPS ? 1 : 0;
  ctx.waterDist = distanceTransform(wet, size, size).dist;
  report(1);
}
