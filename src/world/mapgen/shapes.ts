// ─────────────────────────────────────────────────────────────────────────────
// Theme-driven macro terrain ("Shaping continents"). Each theme works in a
// canonical frame (u → right, v → down, open sea toward v = 1) that a random
// Orientation maps onto the grid, so coasts/rivers can face any direction.
// Heights are meters at the (size+1)² vertices; feature scales are physical
// (meters), macro layout is map-relative.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, MAX_HEIGHT, MIN_HEIGHT } from '../../core/constants';
import type { Noise } from '../../core/noise';
import type { RNG } from '../../core/rng';
import type { DesignedPath, GenContext, Layout } from './context';
import { blur, clampf, mix, sstep } from './grid';
import { Orientation, chaikin, makePath, meanderLine, pathField, pointAt, tangentAt, type MeanderOpts } from './paths';

interface Kit {
  ctx: GenContext;
  o: Orientation;
  rng: RNG;
  /** map extent in meters */
  M: number;
  size: number;
  V: number;
  nWarp: Noise;
  nBase: Noise;
  nRidge: Noise;
  nMask: Noise;
  nDetail: Noise;
  nCoast: Noise;
  nPath: Noise;
}

/** canonical normalised → map cells */
function c2cells(k: Kit, u: number, v: number): [number, number] {
  const [x, y] = k.o.toMap(u, v);
  return [x * k.size, y * k.size];
}

/** Meandering designed path between two canonical points, returned in map cells. */
function designPath(k: Kit, kind: DesignedPath['kind'], u0: number, v0: number, u1: number, v1: number, o: MeanderOpts, inflow = 0): DesignedPath {
  const line = meanderLine(k.rng, k.nPath, u0 * k.M, v0 * k.M, u1 * k.M, v1 * k.M, o);
  const smooth = chaikin(line, 2);
  const cells: number[] = [];
  for (let i = 0; i < smooth.length; i += 2) {
    const [x, y] = c2cells(k, smooth[i] / k.M, smooth[i + 1] / k.M);
    cells.push(x, y);
  }
  return makePath(kind, cells, inflow);
}

/** Canonical-frame edge indices (top, right, bottom, left) → map Dir. */
function edges(k: Kit, canon: number[]): number[] {
  return canon.map((e) => k.o.edge(e));
}

/** Warp offsets (meters) at map meters (mx, my). */
function warp(k: Kit, mx: number, my: number, L: number, A: number): [number, number] {
  const x = mx / L, y = my / L;
  return [k.nWarp.fbm2(x, y, 3) * A, k.nWarp.fbm2(x + 31.4, y - 17.9, 3) * A];
}

/** Coastline position v_c(u) in canonical space. */
function coastline(k: Kit, u: number, c0: number, a1: number, a2: number): number {
  return c0 + a1 * k.nCoast.fbm2(u * 2.2, 3.7, 3) + a2 * k.nCoast.fbm2(u * 7.5, 9.1, 2);
}

/** Smooth seabed profile for a point `off` meters offshore (continuous with 0 at the shoreline). */
function seabed(off: number, maxDepth: number, scale: number): number {
  return -(maxDepth * (1 - Math.exp(-off / scale)) + 1.2 * sstep(0, 90, off));
}

/** Estimate rough relief amplitude used by flattening etc. */
interface ThemeResult {
  layout: Layout;
  /** strength (0..1) of the start-area flattening */
  flatten: number;
}

// ── Temperate: rolling hills, broad river valley to a coast ────────────────
function temperate(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief } = ctx.params;
  const seaFrac = 0.11 + 0.12 * water;
  const c0 = 1 - seaFrac;
  const u0 = rng.range(0.25, 0.75);
  const u1 = clampf(u0 + rng.range(-0.25, 0.25), 0.22, 0.78);
  const bayAmp = 0.03 * (0.6 + water);
  const coast = (u: number) => coastline(k, u, c0, 0.045, 0.016) - bayAmp * Math.exp(-(((u - u1) / 0.07) ** 2));
  const mouthV = coast(u1) + 0.05;
  const river = designPath(k, 'river', u0, -0.03, u1, mouthV, { wavelength: 1500 + 700 * rng.next(), amplitude: 0.9, step: 12, wander: 0.3 }, 0);
  const rf = pathField([river], V);
  const floodHalf = 230 + 260 * water;
  const sideW = 750 + 550 * relief;
  const inlandMax = M * (c0 - 0.02);
  const entryFloor = 0.5 * 48 * (1 - Math.exp(-inlandMax / 2800));
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 2600, 650);
      const [cu, cv] = k.o.toCanon(vx / k.size, vy / k.size);
      const d = (coast(cu + wx / M * 0.5) - (cv + wy / M * 0.5)) * M;
      const wmx = mx + wx, wmy = my + wy;
      let z: number;
      if (d >= 0) {
        const base = 48 * (1 - Math.exp(-d / 2800));
        const hills = (14 + 30 * relief) * sstep(0, 1300, d) * k.nBase.fbm2(wmx / 1900, wmy / 1900, 5);
        const hl = sstep(0.05, 0.6, k.nMask.fbm2(mx / 7000, my / 7000, 2) * 0.9 + (0.5 - cv) * 1.3) * sstep(700, 2600, d);
        const highland = hl * relief * (100 * k.nRidge.ridged2(wmx / 2700, wmy / 2700, 5) + 22 * k.nBase.fbm2(wmx / 1100 + 7, wmy / 1100, 3));
        z = base + hills + highland + 0.9 * sstep(0, 70, d);
      } else {
        z = seabed(-d, 30, 1000) + 1.5 * k.nDetail.fbm2(mx / 700, my / 700, 2) * sstep(0, 300, -d);
      }
      // river valley: flat floodplain with gently rising sides (only lowers)
      const i = vy * V + vx;
      const dv = rf.dist[i] * CELL;
      if (dv < floodHalf + sideW) {
        const s = rf.s[i];
        const floor = entryFloor * Math.pow(1 - s, 1.25) + 0.9 + 1.2 * k.nDetail.fbm2(mx / 900, my / 900, 2) * (1 - s);
        const t = sstep(floodHalf + sideW, floodHalf, dv);
        if (floor < z) z = mix(z, floor, t);
      }
      h[i] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  const sStart = rng.range(0.5, 0.68);
  const [px, py] = pointAt(river, sStart);
  const [tx, ty] = tangentAt(river, sStart);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (floodHalf * 0.45 + 120) / CELL;
  return {
    layout: {
      hasSea: true,
      seaEdge: k.o.edge(2),
      highwayEdges: edges(k, [3, 1, 0]),
      rivers: [withInflow(river, ctx, 1.0)],
      startX: px - ty * off * side,
      startY: py + tx * off * side,
      buildRadius: Math.max(44, k.size * 0.2),
    },
    flatten: 0.85,
  };
}

/** Assign a large off-map catchment to a designed river (scaled by water slider). */
function withInflow(p: DesignedPath, ctx: GenContext, scale: number): DesignedPath {
  // physical catchment in cells (256 m² each): 60..260 km²
  p.inflow = (240_000 + 780_000 * ctx.params.water) * scale;
  return p;
}

// ── Mediterranean: coastal hills around a large bay ─────────────────────────
function mediterranean(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief } = ctx.params;
  const seaFrac = 0.15 + 0.1 * water;
  const c0 = 1 - seaFrac;
  const ub = rng.range(0.38, 0.62);
  const coast = (u: number) => coastline(k, u, c0, 0.06, 0.022);
  const vb = coast(ub) - 0.01;
  const Rb = 0.15 + 0.07 * water;
  const apexU = ub, apexV = vb - Rb;
  const ur = clampf(ub + rng.range(-0.22, 0.22), 0.2, 0.8);
  const river = designPath(k, 'river', ur, -0.03, apexU, apexV + 0.035, { wavelength: 1100 + 500 * rng.next(), amplitude: 0.75, step: 10, wander: 0.3 });
  const rf = pathField([river], V);
  const floodHalf = 110 + 120 * water;
  const sideW = 450 + 300 * relief;
  const entryFloor = 26 + 14 * relief;
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 2200, 520);
      const [cu, cv] = k.o.toCanon(vx / k.size, vy / k.size);
      const wu = cu + (wx / M) * 0.5, wv = cv + (wy / M) * 0.5;
      const dLine = (coast(wu) - wv) * M;
      const bdx = wu - ub, bdy = wv - vb;
      const bd = Math.hypot(bdx, bdy);
      const ang = Math.atan2(bdy, bdx);
      const rB = Rb * (1 + 0.1 * k.nCoast.noise2(Math.cos(ang) * 1.6 + 11, Math.sin(ang) * 1.6 - 4));
      const dBay = (bd - rB) * M;
      const d = Math.min(dLine, dBay);
      const wmx = mx + wx, wmy = my + wy;
      // headlands: cliffs outside the bay
      const head = sstep(Rb * 1.0, Rb * 1.45, bd);
      let z: number;
      if (d >= 0) {
        const cliff = head * (18 + 26 * relief) * (1 - Math.exp(-d / 160));
        const base = (55 + 20 * relief) * (1 - Math.exp(-d / 2100));
        const ridge = k.nRidge.ridged2(wmx / 2300, wmy / 2300, 5);
        const hills = (40 + 80 * relief) * sstep(250, 2600, d) * (0.7 * ridge + 0.3 * (k.nBase.fbm2(wmx / 1500, wmy / 1500, 4) + 0.4));
        const rolling = (5 + 9 * relief) * k.nBase.fbm2(wmx / 800 + 3, wmy / 800, 3) * sstep(0, 450, d);
        z = base + cliff + hills + rolling + 0.7 * sstep(0, 60, d);
      } else {
        const off = -d;
        z = seabed(off, 34 + 8 * head, 650 - 250 * head) + 1.2 * k.nDetail.fbm2(mx / 600, my / 600, 2) * sstep(0, 250, off);
      }
      const i = vy * V + vx;
      const dv = rf.dist[i] * CELL;
      if (dv < floodHalf + sideW) {
        const s = rf.s[i];
        const floor = entryFloor * Math.pow(1 - s, 1.35) + 0.8;
        const t = sstep(floodHalf + sideW, floodHalf, dv);
        if (floor < z) z = mix(z, floor, t);
      }
      h[i] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  // start: on the bay's shore plain, beside the river mouth
  const side = rng.chance(0.5) ? 1 : -1;
  const su = apexU + side * Rb * 0.55, sv = apexV + Rb * 0.25 - 0.06;
  const [sx, sy] = c2cells(k, su, sv);
  return {
    layout: {
      hasSea: true,
      seaEdge: k.o.edge(2),
      highwayEdges: edges(k, [3, 1, 0]),
      rivers: [withInflow(river, ctx, 0.35)],
      startX: sx,
      startY: sy,
      buildRadius: Math.max(40, k.size * 0.19),
    },
    flatten: 0.85,
  };
}

// ── Boreal: fjord inlets, granite knolls, many lakes ───────────────────────
function boreal(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief } = ctx.params;
  const seaFrac = 0.08 + 0.07 * water;
  const c0 = 1 - seaFrac;
  const coast = (u: number) => coastline(k, u, c0, 0.05, 0.02);
  const nF = Math.max(2, Math.min(k.size >= 384 ? 4 : 3, 2 + Math.round(2 * water + rng.range(-0.4, 0.4))));
  const fjords: DesignedPath[] = [];
  const heads: [number, number][] = [];
  for (let f = 0; f < nF; f++) {
    const mu = 0.14 + (0.72 * (f + 0.5)) / nF + rng.range(-0.05, 0.05);
    const len = rng.range(0.3, 0.52);
    const hu = clampf(mu + rng.range(-0.12, 0.12), 0.1, 0.9);
    const hv = coast(mu) - len;
    fjords.push(designPath(k, 'fjord', mu, coast(mu) + 0.06, hu, hv, { wavelength: 2600, amplitude: 0.35, step: 16, wander: 0.35 }));
    heads.push([hu, hv]);
  }
  // designed river from the inland edge into the head of the longest fjord
  let li = 0;
  for (let f = 1; f < nF; f++) if (heads[f][1] < heads[li][1]) li = f;
  const ru = clampf(heads[li][0] + rng.range(-0.18, 0.18), 0.15, 0.85);
  const river = designPath(k, 'river', ru, -0.03, heads[li][0], heads[li][1] + 0.02, { wavelength: 1300, amplitude: 0.7, step: 12, wander: 0.4 });
  const ff = pathField(fjords, V);
  const rf = pathField([river], V);
  const floodHalf = 140 + 150 * water;
  const sideW = 500 + 300 * relief;
  const riverTop = 30 + 10 * relief;
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 1800, 420);
      const [cu, cv] = k.o.toCanon(vx / k.size, vy / k.size);
      const d = (coast(cu + (wx / M) * 0.5) - (cv + (wy / M) * 0.5)) * M;
      const wmx = mx + wx, wmy = my + wy;
      const i = vy * V + vx;
      let z: number;
      if (d >= 0) {
        const base = 46 * (1 - Math.exp(-d / 2600));
        const billow = Math.abs(k.nBase.fbm2(wmx / 1250, wmy / 1250, 5));
        const ridge = k.nRidge.ridged2(wmx / 2100, wmy / 2100, 5);
        const knolls = relief * (46 * billow + 60 * ridge) * sstep(0, 900, d);
        // glacial scour basins → lakes
        const pit = sstep(0.1, 0.42, k.nMask.fbm2(wmx / 1350 + 5, wmy / 1350 - 3, 3)) * (5 + 13 * water) * sstep(0, 500, d);
        z = base + knolls - pit + 0.8 * sstep(0, 60, d);
      } else {
        const off = -d;
        // skerries: small rocky islets poking out near the shore
        const sk = Math.max(0, k.nDetail.fbm2(mx / 520, my / 520, 3) - 0.3) * 70 * (1 - sstep(900, 2200, off));
        z = seabed(off, 30, 1000) + sk;
      }
      // fjords: deep U-shaped sea inlets with steep granite walls
      const df = ff.dist[i] * CELL;
      const s = ff.s[i];
      const half = mix(200 + 60 * water, 85, s);
      const wall = 240;
      if (df < half + wall * 3) {
        const shoulder = (16 + 22 * relief) * sstep(half + wall * 3, half + wall, df) * (1 - sstep(half + wall, half, df)) * sstep(0, 400, d);
        z += shoulder;
        const floor = mix(-32, -7, Math.pow(s, 0.8));
        const t = sstep(half + wall, half * 0.55, df);
        if (floor < z) z = mix(z, floor, t);
      }
      const dv = rf.dist[i] * CELL;
      if (dv < floodHalf + sideW) {
        const rs = rf.s[i];
        const floor = riverTop * Math.pow(1 - rs, 1.1) + 0.6;
        const t = sstep(floodHalf + sideW, floodHalf, dv);
        if (floor < z) z = mix(z, floor, t);
      }
      h[i] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  const sStart = rng.range(0.55, 0.7);
  const [px, py] = pointAt(river, sStart);
  const [tx, ty] = tangentAt(river, sStart);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (floodHalf * 0.5 + 140) / CELL;
  return {
    layout: {
      hasSea: true,
      seaEdge: k.o.edge(2),
      highwayEdges: edges(k, [0, 3, 1]),
      rivers: [withInflow(river, ctx, 0.8)],
      startX: px - ty * off * side,
      startY: py + tx * off * side,
      buildRadius: Math.max(42, k.size * 0.2),
    },
    flatten: 0.8,
  };
}

// ── Desert: mesas & terraced cliffs, dunes, one oasis river + lake ─────────
function desert(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief } = ctx.params;
  const u0 = rng.range(0.25, 0.75);
  const u1 = clampf(u0 + rng.range(-0.3, 0.3), 0.2, 0.8);
  const river = designPath(k, 'river', u0, -0.03, u1, 1.03, { wavelength: 1700 + 800 * rng.next(), amplitude: 0.7, step: 12, wander: 0.35 });
  const rf = pathField([river], V);
  const sLake = rng.range(0.42, 0.58);
  const [lx, ly] = pointAt(river, sLake);
  const lakeR = (180 + 220 * water) / CELL; // cells
  const spanHalf = (lakeR * 1.35) / river.length;
  river.lakeSpans.push([sLake - spanHalf, sLake + spanHalf]);
  const [tx, ty] = tangentAt(river, sLake);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = lakeR + 260 / CELL;
  const startX = lx - ty * off * side, startY = ly + tx * off * side;
  const buildRadius = Math.max(42, k.size * 0.2);
  const floodHalf = 100 + 110 * water;
  const sideW = 160 + 60 * relief;
  const t1 = 0.13 - 0.07 * (relief - 1);
  const t2 = t1 + 0.22;
  const tier1 = 36 + 32 * relief, tier2 = 24 + 24 * relief;
  const windA = rng.range(0, Math.PI);
  const ca = Math.cos(windA), sa = Math.sin(windA);
  const lakeDepth = 7 + 5 * water;
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 2400, 700);
      const [, cv] = k.o.toCanon(vx / k.size, vy / k.size);
      const wmx = mx + wx, wmy = my + wy;
      const i = vy * V + vx;
      const dStart = Math.hypot(vx - startX, vy - startY);
      const keep = sstep(buildRadius * 0.75, buildRadius * 1.15, dStart);
      const plain = 20 + 12 * (1 - cv) + 7 * k.nBase.fbm2(mx / 4200, my / 4200, 3) + 2.5 * k.nDetail.fbm2(mx / 700, my / 700, 3);
      // mesas: two tiers of flat-topped plateaus with cliff faces and talus aprons
      const m = k.nMask.fbm2(wmx / 2300, wmy / 2300, 5) - (1 - keep) * 0.6;
      const mesa =
        tier1 * (0.8 * sstep(t1, t1 + 0.03, m) + 0.2 * sstep(t1 - 0.12, t1 + 0.03, m)) +
        tier2 * (0.85 * sstep(t2, t2 + 0.025, m) + 0.15 * sstep(t2 - 0.08, t2 + 0.025, m));
      // strata banding on cliff faces
      const strata = mesa > 2 && mesa < tier1 + tier2 - 2 ? 1.2 * Math.sin(mesa * 0.9) * sstep(0, 6, mesa) : 0;
      // dune seas away from the oasis
      const dm = sstep(0.18, 0.5, k.nMask.fbm2(mx / 6500 + 40, my / 6500, 2)) * keep * (1 - sstep(2, 8, mesa));
      const a = (mx * ca + my * sa) / 560, b = (-mx * sa + my * ca) / 180;
      const dunes = dm * (4 + 5 * relief) * k.nRidge.ridged2(a, b + 0.3 * k.nDetail.noise2(a * 0.3, b * 0.1), 3);
      let z = plain + mesa + strata + dunes;
      // oasis river canyon (cuts through mesas)
      const dv = rf.dist[i] * CELL;
      if (dv < floodHalf + sideW) {
        const s = rf.s[i];
        const floor = 20 + 12 * (1 - s) - 3 + 1.2 * k.nDetail.fbm2(mx / 800, my / 800, 2);
        const t = sstep(floodHalf + sideW, floodHalf, dv);
        if (floor < z) z = mix(z, floor, t);
      }
      // oasis lake basin
      const dl = Math.hypot(vx - lx, vy - ly);
      if (dl < lakeR * 1.6) {
        const warpR = lakeR * (1 + 0.18 * k.nDetail.noise2(vx / 40, vy / 40));
        z -= lakeDepth * sstep(warpR * 1.45, warpR * 0.35, dl);
      }
      h[i] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  return {
    layout: {
      hasSea: false,
      seaEdge: -1,
      highwayEdges: edges(k, [3, 1, 0, 2]),
      rivers: [withInflow(river, ctx, 0.45)],
      startX,
      startY,
      buildRadius,
    },
    flatten: 0.75,
  };
}

// ── Tropical: archipelago, volcanic main island, reefs & lagoons ───────────
interface Island {
  u: number;
  v: number;
  r: number;
  hills: number;
  lagoon: number;
  salt: number;
}

function tropical(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief } = ctx.params;
  const main: Island = { u: 0.5 + rng.range(-0.08, 0.08), v: rng.range(0.27, 0.31), r: 0.33 + 0.06 * (1 - water), hills: 1, lagoon: 0.035 + 0.02 * water, salt: 0 };
  const islands: Island[] = [main];
  const nSmall = 3 + Math.round(rng.range(0, 3) + 2 * water);
  for (let tries = 0; tries < 200 && islands.length < nSmall + 1; tries++) {
    const r = rng.range(0.035, 0.1);
    const u = rng.range(0.08 + r, 0.92 - r), v = rng.range(0.25, 0.92 - r);
    let ok = true;
    for (const o of islands) if (Math.hypot(u - o.u, v - o.v) < r + o.r + 0.07) ok = false;
    if (ok) islands.push({ u, v, r, hills: rng.range(0.3, 1), lagoon: rng.range(0.015, 0.03), salt: rng.range(0, 500) });
  }
  // volcano on the seaward half of the main island
  const va = rng.range(-0.9, 0.9) + Math.PI / 2; // pointing roughly toward +v (seaward)
  const volU = main.u + Math.cos(va) * main.r * 0.42, volV = main.v + Math.sin(va) * main.r * 0.42;
  const volR = main.r * 0.5 * M; // meters
  const volH = 210 + 115 * relief;
  const craterR = volR * 0.11;
  const deep = -34;
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 1600, 380);
      const [cu, cv] = k.o.toCanon(vx / k.size, vy / k.size);
      const wu = cu + (wx / M) * 0.6, wv = cv + (wy / M) * 0.6;
      const wmx = mx + wx, wmy = my + wy;
      let z = deep + 3 * k.nDetail.fbm2(mx / 1500, my / 1500, 2);
      for (let n = 0; n < islands.length; n++) {
        const is = islands[n];
        const dx = wu - is.u, dy = wv - is.v;
        const dist = Math.hypot(dx, dy);
        if (dist > is.r * 1.6 + is.lagoon + 0.08) continue;
        const ang = Math.atan2(dy, dx);
        const rr = is.r * (1 + 0.2 * k.nCoast.noise2(Math.cos(ang) * 1.4 + is.salt, Math.sin(ang) * 1.4) + 0.08 * k.nCoast.noise2(Math.cos(ang) * 4 + is.salt, Math.sin(ang) * 4 + 9));
        const dm = (dist - rr) * M; // + offshore
        let zi: number;
        if (dm < 0) {
          const inl = -dm;
          const plain = 2.2 * sstep(0, 90, inl) + 16 * (1 - Math.exp(-inl / 1400));
          const hills = is.hills * (16 + 38 * relief) * sstep(150, 1400, inl) * (0.55 + k.nBase.fbm2(wmx / 1300, wmy / 1300, 5));
          zi = plain + Math.max(0, hills);
          if (n === 0) {
            const dvx = (wu - volU) * M, dvy = (wv - volV) * M;
            const dv = Math.hypot(dvx, dvy);
            if (dv < volR) {
              const pa = Math.atan2(dvy, dvx);
              const gully = 1 - 0.18 * k.nRidge.ridged2(Math.cos(pa) * 3.2 + dv / 900, Math.sin(pa) * 3.2, 3);
              let cone = volH * Math.pow(1 - dv / volR, 1.75) * gully;
              if (dv < craterR * 1.6) cone -= (38 + 10 * relief) * sstep(craterR * 1.6, craterR * 0.4, dv);
              zi = Math.max(zi, plain + cone);
            }
          }
        } else {
          const lw = is.lagoon * M;
          const pass = sstep(0.22, 0.5, k.nMask.fbm2(mx / 900 + is.salt, my / 900, 2));
          const cay = sstep(0.5, 0.75, k.nMask.fbm2(mx / 380 - is.salt, my / 380 + 2, 3));
          const crest = -0.8 + 1.5 * cay * (1 - pass) - 2.4 * pass;
          const lagoonFloor = -(2.4 + 1.6 * k.nDetail.fbm2(mx / 500, my / 500, 2)) * sstep(0, 140, dm);
          const reefT = Math.exp(-(((dm - lw) / 55) ** 2));
          if (dm < lw) zi = mix(lagoonFloor, crest, reefT);
          else zi = mix(crest, deep, sstep(lw, lw + 650, dm));
        }
        if (zi > z) z = zi;
      }
      h[vy * V + vx] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  // start: main island plain between the mainland edge and the volcano, away from it
  const sa = va + Math.PI + rng.range(-0.5, 0.5);
  const su = main.u + Math.cos(sa) * main.r * 0.35, sv = clampf(main.v + Math.sin(sa) * main.r * 0.35, 0.18, 0.5);
  const [sx, sy] = c2cells(k, su, sv);
  return {
    layout: {
      hasSea: true,
      seaEdge: k.o.edge(2),
      highwayEdges: edges(k, [0]),
      rivers: [],
      startX: sx,
      startY: sy,
      buildRadius: Math.max(40, k.size * 0.18),
    },
    flatten: 0.8,
  };
}

// ── Alpine: glacial U-valley with a long lake, ridged peaks, tarns ─────────
function alpine(k: Kit): ThemeResult {
  const { ctx, rng, M, V } = k;
  const { water, relief, mountains } = ctx.params;
  const va = rng.range(0.4, 0.6), vb = clampf(va + rng.range(-0.18, 0.18), 0.33, 0.67);
  const valley = designPath(k, 'river', -0.03, va, 1.03, vb, { wavelength: 3200 + 1200 * rng.next(), amplitude: 0.4, step: 16, wander: 0.35 });
  const vf = pathField([valley], V);
  // side (hanging) valleys joining from both flanks
  const sides: DesignedPath[] = [];
  const nSide = k.size >= 384 ? 3 : 2;
  for (let j = 0; j < nSide; j++) {
    const sj = 0.18 + (0.64 * (j + 0.5)) / nSide + rng.range(-0.05, 0.05);
    const [jx, jy] = pointAt(valley, sj);
    const [tx, ty] = tangentAt(valley, sj);
    const side = j % 2 === 0 ? 1 : -1;
    const len = rng.range(0.28, 0.4) * k.size;
    const hx = jx - ty * len * side + tx * rng.range(-0.15, 0.15) * k.size;
    const hy = jy + tx * len * side + ty * rng.range(-0.15, 0.15) * k.size;
    const line = meanderLine(k.rng, k.nPath, hx * CELL, hy * CELL, jx * CELL, jy * CELL, { wavelength: 1800, amplitude: 0.4, step: 16, wander: 0.4 });
    const cells: number[] = [];
    for (let i = 0; i < line.length; i += 2) cells.push(line[i] / CELL, line[i + 1] / CELL);
    sides.push(makePath('valley', chaikin(cells, 2)));
  }
  const sf = pathField(sides, V);
  const floorHalf = (0.1 + 0.035 * (1 - mountains)) * M;
  const sideW = 0.15 * M;
  const sLake = rng.range(0.32, 0.6);
  const lakeLen = ((0.12 + 0.14 * water) * M) / CELL / valley.length; // normalised
  const lakeDepth = 14 + 12 * water;
  valley.lakeSpans.push([sLake - lakeLen * 0.5, sLake + lakeLen * 0.5 + 0.015]);
  const floorAt = (s: number) => 36 + 30 * (1 - s);
  const h = ctx.heights;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const mx = vx * CELL, my = vy * CELL;
      const [wx, wy] = warp(k, mx, my, 3000, 700);
      const wmx = mx + wx, wmy = my + wy;
      const i = vy * V + vx;
      const ridge = k.nRidge.ridged2(wmx / 3300, wmy / 3300, 6);
      const mtn = 85 + relief * (275 * ridge + 55 * k.nBase.fbm2(wmx / 1500, wmy / 1500, 4) + 20);
      const dv = vf.dist[i] * CELL;
      const s = vf.s[i];
      const floor = floorAt(s) + 2.2 * k.nDetail.fbm2(mx / 1100, my / 1100, 3);
      const q = clampf((dv - floorHalf) / sideW, 0, 1);
      const U = q * q * (3 - 2 * q);
      // gentle alluvial fringe at the foot of the walls, then the U-shaped rise
      let z = floor + (mtn - floor) * Math.pow(U, 1.15) + 6 * sstep(-0.3 * floorHalf, 0, dv - floorHalf);
      // hanging side valleys
      const ds = sf.dist[i] * CELL;
      if (ds < 700) {
        const ss = sf.s[i];
        const f2 = mix(Math.min(mtn, 250 + 60 * relief), floorAt(0.5) + 30, Math.pow(ss, 0.8));
        const t = sstep(700, 110, ds);
        if (f2 < z) z = mix(z, f2, t);
      }
      // glacial lake basin in the valley floor
      const ls = (s - (sLake - lakeLen * 0.5)) / lakeLen;
      if (ls > -0.1 && ls < 1.1) {
        const along = sstep(-0.05, 0.22, ls) * (1 - sstep(0.8, 1.02, ls));
        const across = sstep(floorHalf * 0.85, floorHalf * 0.3, dv);
        z -= lakeDepth * along * across;
      }
      // tarns in high cirques
      const tarn = sstep(0.34, 0.52, k.nMask.fbm2(wmx / 700, wmy / 700, 3)) * sstep(200, 250, z) * (6 + 6 * water);
      z -= tarn;
      h[i] = z;
    }
    if ((vy & 31) === 0) ctx.report(vy / V);
  }
  const sStart = clampf(sLake + lakeLen * 0.5 + rng.range(0.05, 0.12), 0.15, 0.9);
  const [px, py] = pointAt(valley, sStart);
  const [tx, ty] = tangentAt(valley, sStart);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (floorHalf * 0.4) / CELL;
  return {
    layout: {
      hasSea: false,
      seaEdge: -1,
      highwayEdges: edges(k, [3, 1]),
      rivers: [withInflow(valley, ctx, 0.9)],
      startX: px - ty * off * side,
      startY: py + tx * off * side,
      buildRadius: Math.max(36, k.size * 0.15),
    },
    flatten: 0.55,
  };
}

/**
 * Compress local relief around the start area so a large, mostly gentle
 * region exists. Deviations from a low-passed surface are damped by a smooth,
 * noise-warped radial mask; land is never pushed below sea level.
 */
export function flattenRegion(ctx: GenContext, cx: number, cy: number, radius: number, strength: number, seaLevel: number | null): void {
  const V = ctx.V, h = ctx.heights;
  const low = blur(h, V, V, Math.max(6, radius * 0.18));
  const n = ctx.noise('flatten-edge');
  const r0 = radius * 0.55, r1 = radius * 1.08;
  const x0 = Math.max(0, Math.floor(cx - r1 * 1.3)), x1 = Math.min(V - 1, Math.ceil(cx + r1 * 1.3));
  const y0 = Math.max(0, Math.floor(cy - r1 * 1.3)), y1 = Math.min(V - 1, Math.ceil(cy + r1 * 1.3));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) * (1 + 0.22 * n.fbm2(x / 60, y / 60, 3));
      const m = sstep(r1, r0, d) * strength;
      if (m <= 0) continue;
      const i = y * V + x;
      const z = h[i];
      // flatten toward the low-passed surface, itself tilted gently
      let nz = low[i] + (z - low[i]) * (1 - m);
      if (seaLevel !== null && z >= seaLevel + 0.5 && nz < seaLevel + 1.2) nz = Math.min(z, seaLevel + 1.2);
      h[i] = nz;
    }
  }
}

/** Soft-limit heights into the engine's guidance range. */
export function clampHeights(ctx: GenContext): void {
  const h = ctx.heights;
  const hiKnee = MAX_HEIGHT - 60, loKnee = MIN_HEIGHT + 6;
  for (let i = 0; i < h.length; i++) {
    let z = h[i];
    if (z > hiKnee) z = hiKnee + 55 * Math.tanh((z - hiKnee) / 55);
    else if (z < loKnee) z = loKnee - 5 * Math.tanh((loKnee - z) / 5);
    h[i] = z;
  }
}

/** Run the theme shaper. Writes ctx.heights and returns layout + flatten strength. */
export function shapeTerrain(ctx: GenContext): ThemeResult {
  const rng = ctx.rng('layout');
  const k: Kit = {
    ctx,
    o: new Orientation(rng.int(0, 7)),
    rng,
    M: ctx.extent,
    size: ctx.size,
    V: ctx.V,
    nWarp: ctx.noise('warp'),
    nBase: ctx.noise('base'),
    nRidge: ctx.noise('ridge'),
    nMask: ctx.noise('mask'),
    nDetail: ctx.noise('detail'),
    nCoast: ctx.noise('coast'),
    nPath: ctx.noise('path'),
  };
  switch (ctx.params.theme.id) {
    case 'boreal': return boreal(k);
    case 'desert': return desert(k);
    case 'tropical': return tropical(k);
    case 'alpine': return alpine(k);
    case 'mediterranean': return mediterranean(k);
    default: return temperate(k);
  }
}
