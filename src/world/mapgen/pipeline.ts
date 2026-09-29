// ─────────────────────────────────────────────────────────────────────────────
// Map generation pipeline. Runs synchronously (inside the mapgen worker, or on
// the main thread as a fallback) and returns a GeneratedMap whose typed arrays
// can be transferred. Fully deterministic for the same settings + seed.
// ─────────────────────────────────────────────────────────────────────────────
import type { GeneratedMap, MapSettings } from '../../core/types';
import { GenContext, type ProgressFn } from './context';
import { particleErosion, streamPower, thermalErosion } from './erosion';
import { cellSlopes, cellHeights, sstep } from './grid';
import { buildWater, chooseSeaLevel, cutDesignedRivers, edgeOutlets, fillMinorDepressions } from './hydro';
import { surveyResources } from './resources';
import { clearRouteVerges, routeConnections } from './routes';
import { clampHeights, flattenRegion, shapeTerrain } from './shapes';
import { refineStart } from './site';
import { growForests } from './vegetation';

interface ErosionProfile {
  /** stream-power incision coefficient and iterations */
  spK: number;
  spIters: number;
  /** droplets per vertex */
  drops: number;
  /** thermal talus (rise/run) */
  talus: number;
  thermalIters: number;
}

const EROSION: Record<string, ErosionProfile> = {
  temperate: { spK: 0.0026, spIters: 6, drops: 0.7, talus: 0.7, thermalIters: 4 },
  boreal: { spK: 0.002, spIters: 5, drops: 0.55, talus: 0.9, thermalIters: 3 },
  desert: { spK: 0.0016, spIters: 5, drops: 0.45, talus: 1.25, thermalIters: 2 },
  tropical: { spK: 0.003, spIters: 6, drops: 0.8, talus: 0.75, thermalIters: 4 },
  alpine: { spK: 0.0036, spIters: 7, drops: 0.7, talus: 0.95, thermalIters: 4 },
  mediterranean: { spK: 0.0026, spIters: 6, drops: 0.6, talus: 0.8, thermalIters: 4 },
};

/** Per-vertex erodibility: the start area is protected so it stays buildable. */
function erodibility(ctx: GenContext): Float32Array {
  const V = ctx.V, L = ctx.layout;
  const e = new Float32Array(V * V);
  const r0 = L.buildRadius * 0.45, r1 = L.buildRadius * 1.1;
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const d = Math.hypot(x - L.startX, y - L.startY);
      e[y * V + x] = 0.25 + 0.75 * sstep(r0, r1, d);
    }
  }
  return e;
}

/** Designed lake basins: droplets end there so sediment never fills them. */
function lakeSinks(ctx: GenContext): Uint8Array | null {
  const lakes = ctx.layout.lakes ?? [];
  if (lakes.length === 0) return null;
  const V = ctx.V;
  const m = new Uint8Array(V * V);
  for (const lk of lakes) {
    const R = Math.ceil(lk.r * 1.1);
    for (let y = Math.max(0, Math.floor(lk.y - R)); y <= Math.min(V - 1, Math.ceil(lk.y + R)); y++) {
      for (let x = Math.max(0, Math.floor(lk.x - R)); x <= Math.min(V - 1, Math.ceil(lk.x + R)); x++) {
        if (Math.hypot(x - lk.x, y - lk.y) <= lk.r * 1.1) m[y * V + x] = 1;
      }
    }
  }
  return m;
}

function erode(ctx: GenContext): void {
  const prof = EROSION[ctx.params.theme.id] ?? EROSION.temperate;
  const V = ctx.V, h = ctx.heights;
  const sea = ctx.layout.hasSea ? 0 : null;
  const erod = erodibility(ctx);
  // droplet density scales with map size so large maps don't blow the time budget
  const sizeScale = ctx.size >= 768 ? 0.6 : ctx.size >= 512 ? 0.8 : 1;
  ctx.report(0.02);
  streamPower(h, V, { iterations: prof.spIters, k: prof.spK, seaLevel: sea, erod, maxCut: 7, edges: edgeOutlets(ctx, V, null) }, (f) => ctx.report(0.02 + 0.3 * f));
  particleErosion(
    h,
    V,
    {
      density: prof.drops * sizeScale,
      lifetime: 42,
      inertia: 0.12,
      capacity: 5,
      minCapacity: 0.008,
      erodeRate: 0.3,
      depositRate: 0.25,
      evaporate: 0.018,
      gravity: 4,
      radius: 2.2,
      seaLevel: sea,
      erod,
      maxStep: 0.06,
      sink: lakeSinks(ctx),
    },
    ctx.rng('droplets'),
    (f) => ctx.report(0.32 + 0.6 * f),
  );
  thermalErosion(h, V, prof.thermalIters, prof.talus, 0.45, erod);
  ctx.report(1);
}

/** Fraction of all cells that are dry-ish land with slope < 0.1. */
export function gentleFraction(ctx: GenContext): number {
  const zc = cellHeights(ctx.heights, ctx.size);
  const sl = cellSlopes(ctx.heights, ctx.size, 16);
  const lo = ctx.seaLevel + 0.6;
  let cnt = 0;
  for (let i = 0; i < ctx.nC; i++) if (zc[i] > lo && sl[i] < 0.1) cnt++;
  return cnt / ctx.nC;
}

/** Flatten the start region, widening it until enough gentle land exists. */
function prepareBuildLand(ctx: GenContext, strength: number): void {
  const L = ctx.layout;
  const sea = L.hasSea ? ctx.seaLevel : null;
  let radius = L.buildRadius;
  let s = strength;
  flattenRegion(ctx, L.startX, L.startY, radius, s, sea);
  for (let it = 0; it < 6; it++) {
    const frac = gentleFraction(ctx);
    if (frac >= 0.28) break;
    radius *= 1.2;
    s = Math.min(0.95, s + 0.08);
    flattenRegion(ctx, L.startX, L.startY, radius, s, sea);
  }
}

export function runPipeline(settings: MapSettings, onProgress?: ProgressFn): GeneratedMap {
  return generateContext(settings, onProgress).result();
}

/** Run every stage and return the full generation context (sandbox / diagnostics). */
export function generateContext(settings: MapSettings, onProgress?: ProgressFn): GenContext {
  const ctx = new GenContext(settings, onProgress);

  ctx.stage('Shaping continents', 0, 0.12);
  const shaped = shapeTerrain(ctx);
  ctx.layout = shaped.layout;
  clampHeights(ctx);
  refineStart(ctx);
  ctx.seaLevel = chooseSeaLevel(ctx);
  // closed basins too small to hold lakes are filled first, so fluvial
  // erosion carves a connected drainage network through them
  fillMinorDepressions(ctx, 0.8, 1.25);

  ctx.stage('Eroding mountains', 0.12, 0.5);
  erode(ctx);
  ctx.seaLevel = chooseSeaLevel(ctx);

  ctx.stage('Leveling the valley floor', 0.5, 0.55);
  prepareBuildLand(ctx, shaped.flatten);
  cutDesignedRivers(ctx);
  ctx.report(1);

  ctx.stage('Filling lakes', 0.55, 0.6);
  fillMinorDepressions(ctx);
  ctx.report(1);

  ctx.stage('Carving rivers', 0.6, 0.72);
  buildWater(ctx, (f) => ctx.report(f));

  ctx.stage('Routing the highway', 0.72, 0.86);
  routeConnections(ctx, (f) => ctx.report(f));

  ctx.stage('Growing forests', 0.86, 0.93);
  growForests(ctx, (f) => ctx.report(f));
  clearRouteVerges(ctx, [ctx.highway, ctx.rail]);

  ctx.stage('Surveying resources', 0.93, 1);
  surveyResources(ctx, (f) => ctx.report(f));

  return ctx;
}
