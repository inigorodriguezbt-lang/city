// Invariant checks over a matrix of themes × sizes × seeds × slider extremes.
// node --experimental-transform-types --no-warnings --import ./sandbox/mapgen/node/loader.mjs sandbox/mapgen/node/validate.ts [sizes] [seeds] [quick]
import { runPipeline } from '../../../src/world/mapgen/pipeline';
import { THEMES } from '../../../src/data/themes';
import type { GeneratedMap, MapSettings, ThemeId } from '../../../src/core/types';
import { MAX_ROAD_SLOPE, WATER_EPS, type MapSizeId } from '../../../src/core/constants';

const [sizesArg = 'small,medium', seedsArg = '1,2,3', quick = ''] = process.argv.slice(2);
const sizes = sizesArg.split(',') as MapSizeId[];
const seeds = seedsArg.split(',').map(Number);
const sliders: [number, number, number][] = quick ? [[0.5, 0.5, 0.5]] : [[0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1], [1, 0, 0.5], [0, 1, 1]];

function hashMap(m: GeneratedMap): number {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619);
  };
  const f = new Uint32Array(m.heights.buffer.slice(0));
  for (let i = 0; i < f.length; i += 7) mix(f[i]);
  const w = new Uint32Array(m.water.buffer.slice(0));
  for (let i = 0; i < w.length; i += 5) mix(w[i]);
  for (let i = 0; i < m.trees.length; i += 3) mix(m.trees[i] + m.ore[i] * 7 + m.oil[i] * 13);
  for (const c of m.highway) mix(c.x * 4096 + c.y);
  for (const c of m.rail) mix(c.x * 4096 + c.y);
  mix(m.start.x * 4096 + m.start.y);
  return h >>> 0;
}

function check(m: GeneratedMap, s: MapSettings): string[] {
  const errs: string[] = [];
  const size = m.size, V = size + 1, H = m.heights, n = size * size;
  if (H.length !== V * V || m.water.length !== n) errs.push('array sizes');
  for (let i = 0; i < H.length; i++) if (!Number.isFinite(H[i])) { errs.push('non-finite height'); break; }
  for (let i = 0; i < n; i++) if (!Number.isFinite(m.water[i])) { errs.push('non-finite water'); break; }
  const ch = (x: number, y: number) => {
    const i = y * V + x;
    return (H[i] + H[i + 1] + H[i + V] + H[i + V + 1]) * 0.25;
  };
  const sl = (x: number, y: number) => {
    const i = y * V + x;
    const a = H[i], b = H[i + 1], c = H[i + V], d = H[i + V + 1];
    return (Math.max(a, b, c, d) - Math.min(a, b, c, d)) / 16;
  };
  const wet = (x: number, y: number) => m.water[y * size + x] > ch(x, y) + WATER_EPS;
  let lo = Infinity, hi = -Infinity, gentle = 0, maxJump = 0, jumps = 0, treeWet = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const z = ch(x, y);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
      const w = wet(x, y);
      if (!w && sl(x, y) < 0.1) gentle++;
      if (w && m.trees[i]) treeWet++;
      if (m.trees[i] > 3) errs.push('tree density > 3');
      if (w) {
        if (x + 1 < size && wet(x + 1, y)) {
          const d = Math.abs(m.water[i] - m.water[i + 1]);
          if (d > maxJump) maxJump = d;
          if (d > 3) jumps++;
        }
        if (y + 1 < size && wet(x, y + 1)) {
          const d = Math.abs(m.water[i] - m.water[i + size]);
          if (d > maxJump) maxJump = d;
          if (d > 3) jumps++;
        }
      }
    }
  }
  if (treeWet) errs.push(`${treeWet} trees on water`);
  if (lo < -45 || hi > 425) errs.push(`height range ${lo.toFixed(0)}..${hi.toFixed(0)}`);
  if (gentle / n < 0.2) errs.push(`gentle ${(100 * gentle / n).toFixed(1)}%`);
  if (jumps > 2) errs.push(`${jumps} waterfalls >3m (max ${maxJump.toFixed(2)})`);
  // routes
  const checkRoute = (name: string, r: { x: number; y: number }[], required: boolean) => {
    if (r.length === 0) {
      if (required) errs.push(`${name} missing`);
      return;
    }
    const e = r[0];
    if (!(e.x === 0 || e.y === 0 || e.x === size - 1 || e.y === size - 1)) errs.push(`${name} does not start at edge`);
    let run = 0, maxRun = 0, wetN = 0, steep = 0;
    const seen = new Set<number>();
    for (let k = 0; k < r.length; k++) {
      const c = r[k];
      if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) errs.push(`${name} out of bounds`);
      if (seen.has(c.y * size + c.x)) errs.push(`${name} revisits cell`);
      seen.add(c.y * size + c.x);
      if (k > 0 && Math.abs(c.x - r[k - 1].x) + Math.abs(c.y - r[k - 1].y) !== 1) errs.push(`${name} gap at ${k}`);
      if (wet(c.x, c.y)) {
        wetN++;
        run++;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
        if (sl(c.x, c.y) > MAX_ROAD_SLOPE + 1e-4) steep++;
      }
    }
    if (steep) errs.push(`${name} ${steep} cells steeper than MAX_ROAD_SLOPE`);
    if (maxRun > 8) errs.push(`${name} water run ${maxRun}`);
    const last = r[r.length - 1];
    if (wet(last.x, last.y)) errs.push(`${name} ends in water`);
    return seen;
  };
  const hs = checkRoute('highway', m.highway, true);
  const rs = checkRoute('rail', m.rail, false);
  if (hs && rs) for (const k of rs) if (hs.has(k)) { errs.push('rail overlaps highway'); break; }
  if (wet(m.start.x, m.start.y)) errs.push('start is wet');
  if (sl(m.start.x, m.start.y) > 0.1) errs.push(`start slope ${sl(m.start.x, m.start.y).toFixed(2)}`);
  if (hs && hs.has(m.start.y * size + m.start.x)) errs.push('start on highway');
  const hw = m.connections.find((c) => c.kind === 'highway');
  if (!hw) errs.push('no highway connection');
  const air = m.connections.find((c) => c.kind === 'air');
  if (!air) errs.push('no air connection');
  const ship = m.connections.find((c) => c.kind === 'ship');
  const theme = THEMES.find((t) => t.id === s.theme);
  if (theme?.hasCoast && !ship) errs.push('no ship connection');
  if (ship && !wet(ship.x, ship.y)) errs.push('ship connection on land');
  for (const c of m.connections) {
    const onEdge = (c.dir === 0 && c.y === 0) || (c.dir === 1 && c.x === size - 1) || (c.dir === 2 && c.y === size - 1) || (c.dir === 3 && c.x === 0);
    if (!onEdge) errs.push(`${c.kind} connection dir/edge mismatch`);
  }
  // resources over rich thresholds near start (specialised industry reachable)
  const near = (arr: Uint8Array) => {
    let c = 0;
    const R = Math.round(size * 0.35);
    for (let y = Math.max(0, m.start.y - R); y < Math.min(size, m.start.y + R); y++) for (let x = Math.max(0, m.start.x - R); x < Math.min(size, m.start.x + R); x++) if (arr[y * size + x] > 60 && !wet(x, y)) c++;
    return c;
  };
  if (near(m.ore) < 20) errs.push('little ore near start');
  if (near(m.oil) < 20) errs.push('little oil near start');
  if (s.forests > 0.2 && s.theme !== 'desert' && near(m.forest) < 50) errs.push('little forest near start');
  if (s.theme !== 'desert' && near(m.fertility) < 100) errs.push('little fertile land near start');
  return errs;
}

let fails = 0, total = 0;
const times: Record<string, number[]> = {};
for (const size of sizes) {
  for (const t of THEMES) {
    for (const seed of seeds) {
      for (const [mt, wa, fo] of sliders) {
        const s: MapSettings = { cityName: 'v', mapSize: size, theme: t.id as ThemeId, seed, style: 'european', difficulty: 'normal', creative: false, disasters: true, mountains: mt, water: wa, forests: fo };
        const t0 = performance.now();
        let m: GeneratedMap;
        try {
          m = runPipeline(s);
        } catch (e) {
          console.log(`CRASH ${t.id} ${size} seed ${seed} [${mt},${wa},${fo}]`, (e as Error).stack);
          fails++;
          continue;
        }
        const ms = performance.now() - t0;
        (times[size] ??= []).push(ms);
        total++;
        const errs = check(m, s);
        if (seed === seeds[0] && mt === 0.5 && wa === 0.5) {
          const m2 = runPipeline(s);
          if (hashMap(m) !== hashMap(m2)) errs.push('NON-DETERMINISTIC');
        }
        if (errs.length) {
          fails++;
          console.log(`FAIL ${t.id} ${size} seed ${seed} [${mt},${wa},${fo}] ${Math.round(ms)}ms: ${errs.join('; ')}`);
        }
      }
    }
  }
}
for (const [k, v] of Object.entries(times)) console.log(`${k}: avg ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}ms max ${Math.round(Math.max(...v))}ms`);
console.log(`${total - fails}/${total} passed`);
