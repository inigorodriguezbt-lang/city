// ─────────────────────────────────────────────────────────────────────────────
// Outside connections ("Routing the highway").
//
//  • Highway: entry chosen over the theme's preferred edges from an exact
//    cost-to-goal field (reverse Dijkstra), then A* over (cell, heading) states
//    with slope/roughness/water/turn costs, using that field as a (perfect,
//    admissible) heuristic. 4-connected, edge → inward, ends next to the start
//    area on gentle land. Only short water crossings (bridges) are allowed.
//  • Rail (optional): from a different edge, gentle grades, avoids the
//    highway, ending ~30-50 % into the map beside buildable land.
//  • Terrain along both routes is graded (Lipschitz-limited longitudinal
//    profile + embankments/cuttings blended into the surroundings) so every
//    dry route cell satisfies MAX_ROAD_SLOPE; water cells are never touched.
//  • Connections: highway, rail, ship (ocean edge nearest the city) and air.
//  • Start cell: flattest dry cell near the highway end in buildable land.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, MAX_ROAD_SLOPE, WATER_EPS } from '../../core/constants';
import { DIR_DX, DIR_DY, type Cell, type OutsideConnection } from '../../core/types';
import type { GenContext } from './context';
import { MinHeap, blur, cellHeights, cellSlopes, clampf, distanceTransform, mix, sstep } from './grid';
import { WK_OCEAN } from './hydro';

interface Grid {
  size: number;
  Zc: Float32Array;
  slope: Float32Array;
  wet: Uint8Array;
  ocean: Uint8Array;
  /** for wet cells: distance (cells) to the nearest dry cell */
  wwidth: Float32Array;
  /** fraction of gentle dry cells in a 9×9 window */
  build: Float32Array;
  /** distance to the nearest wet cell */
  wdist: Float32Array;
}

interface Spec {
  turn: number;
  gradeK: number;
  gradeMax: number;
  hardK: number;
  rough: number;
  wetCost: number;
  /** water bodies wider than this (distance-to-dry, cells) are impassable */
  maxWaterWidth: number;
  /** allow wide water / ocean at a steep price (last-resort fallback) */
  allowWide: boolean;
  shore: number;
  blocked: Uint8Array | null;
}

const INF = 1e30;

function buildGrid(ctx: GenContext): Grid {
  const size = ctx.size, nC = ctx.nC;
  const Zc = cellHeights(ctx.heights, size);
  const slope = cellSlopes(ctx.heights, size, CELL);
  const wet = new Uint8Array(nC);
  const ocean = new Uint8Array(nC);
  const dry = new Uint8Array(nC);
  for (let i = 0; i < nC; i++) {
    wet[i] = ctx.water[i] > Zc[i] + WATER_EPS ? 1 : 0;
    dry[i] = wet[i] ? 0 : 1;
    ocean[i] = ctx.waterKind[i] === WK_OCEAN && wet[i] ? 1 : 0;
  }
  const wwidth = distanceTransform(dry, size, size).dist;
  const wdist = distanceTransform(wet, size, size).dist;
  const gentle = new Float32Array(nC);
  for (let i = 0; i < nC; i++) gentle[i] = !wet[i] && slope[i] < 0.1 ? 1 : 0;
  const build = blur(gentle, size, size, 4, 1);
  return { size, Zc, slope, wet, ocean, wwidth, build, wdist };
}

/** Cost of stepping from cell i into neighbouring cell j (no turn cost). */
function stepCost(g: Grid, s: Spec, i: number, j: number): number {
  if (s.blocked && s.blocked[j]) return INF;
  let c = 1;
  if (g.wet[j]) {
    const w = g.wwidth[j];
    if (w > s.maxWaterWidth || g.ocean[j]) {
      if (!s.allowWide) return INF;
      c += 40 + 25 * w;
    }
    c += s.wetCost;
  } else {
    if (!g.wet[i]) {
      const dz = Math.abs(g.Zc[j] - g.Zc[i]) / CELL;
      const over = dz - s.gradeMax;
      c += s.gradeK * dz + (over > 0 ? s.hardK * over * over : 0);
    }
    c += s.rough * g.slope[j];
    if (g.wdist[j] < 1.5) c += s.shore;
  }
  const size = g.size;
  const x = j % size, y = (j / size) | 0;
  const e = Math.min(x, y, size - 1 - x, size - 1 - y);
  if (e < 4) c += (4 - e) * 0.8;
  return c;
}

/** Multi-source reverse Dijkstra: exact cost-to-goal (without turn costs) for every cell. */
function costField(g: Grid, s: Spec, goal: Uint8Array): Float64Array {
  const size = g.size, n = size * size;
  const dist = new Float64Array(n).fill(INF);
  const heap = new MinHeap(4096);
  for (let i = 0; i < n; i++) {
    if (!goal[i]) continue;
    dist[i] = 0;
    heap.push(0, i);
  }
  while (heap.size > 0) {
    const d = heap.peekKey();
    const u = heap.pop();
    if (d > dist[u]) continue;
    const x = u % size, y = (u / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DIR_DX[k], ny = y + DIR_DY[k];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const v = ny * size + nx;
      // forward direction is v → u
      const c = stepCost(g, s, v, u);
      if (c >= INF) continue;
      const nd = d + c;
      if (nd < dist[v]) {
        dist[v] = nd;
        heap.push(nd, v);
      }
    }
  }
  return dist;
}

/** A* over (cell, heading) from `start` (entered heading `dir0`) to any goal cell. */
function astar(g: Grid, s: Spec, start: number, dir0: number, goal: Uint8Array, hField: Float64Array): number[] | null {
  const size = g.size, n = size * size;
  const G = new Float64Array(n * 4).fill(INF);
  const parent = new Int32Array(n * 4).fill(-1);
  const heap = new MinHeap(4096);
  const s0 = start * 4 + dir0;
  G[s0] = 0;
  heap.push(hField[start], s0);
  let found = -1;
  let expanded = 0;
  const maxExpand = n * 6;
  while (heap.size > 0) {
    const st = heap.pop();
    const cell = st >> 2, dir = st & 3;
    const gc = G[st];
    if (goal[cell]) {
      found = st;
      break;
    }
    if (++expanded > maxExpand) break;
    const x = cell % size, y = (cell / size) | 0;
    for (let k = 0; k < 4; k++) {
      if (k === ((dir + 2) & 3)) continue; // no U-turns
      const nx = x + DIR_DX[k], ny = y + DIR_DY[k];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const v = ny * size + nx;
      let c = stepCost(g, s, cell, v);
      if (c >= INF) continue;
      if (k !== dir) c += s.turn;
      const ng = gc + c;
      const ns = v * 4 + k;
      if (ng < G[ns]) {
        G[ns] = ng;
        parent[ns] = st;
        const hv = hField[v];
        heap.push(ng + (hv >= INF ? 1e6 : hv), ns);
      }
    }
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let st = found; st >= 0; st = parent[st]) path.push(st >> 2);
  path.reverse();
  return path;
}

/** Map-edge cell for edge `e` (Dir) at position t along it, plus inward step. */
function edgeCell(size: number, e: number, p: number): [number, number] {
  switch (e) {
    case 0: return [p, 0];
    case 1: return [size - 1, p];
    case 2: return [p, size - 1];
    default: return [0, p];
  }
}

interface Entry {
  edge: number;
  cells: number[];
  cost: number;
}

/** Best entry (straight stub from the edge) on the given edges for a cost field. */
function bestEntry(g: Grid, s: Spec, field: Float64Array, edges: number[], stub: number, pref: number[], lo = 0.1, hi = 0.9): Entry | null {
  const size = g.size;
  let best: Entry | null = null;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const inward = (e + 2) & 3;
    for (let p = Math.floor(size * lo); p <= Math.ceil(size * hi); p++) {
      const [ex, ey] = edgeCell(size, e, p);
      const cells: number[] = [];
      let cost = 0, ok = true;
      for (let k = 0; k < stub; k++) {
        const x = ex + DIR_DX[inward] * k, y = ey + DIR_DY[inward] * k;
        const i = y * size + x;
        if (g.wet[i] || (s.blocked && s.blocked[i])) {
          ok = false;
          break;
        }
        if (k > 0) cost += stepCost(g, s, cells[k - 1], i);
        cells.push(i);
      }
      if (!ok) continue;
      const f = field[cells[stub - 1]];
      if (f >= INF) continue;
      // mild preference for entries away from corners
      const centred = 1 + 0.25 * Math.abs(p / size - 0.5);
      const total = (cost + f) * centred * (1 + (pref[ei] ?? 0));
      if (!best || total < best.cost) best = { edge: e, cells, cost: total };
    }
  }
  return best;
}

/** Goal cells: dry, gentle, buildable, inside a disc. */
function goalDisc(g: Grid, cx: number, cy: number, r: number, minBuild: number, blocked: Uint8Array | null): Uint8Array {
  const size = g.size;
  const goal = new Uint8Array(size * size);
  let cnt = 0;
  for (let pass = 0; pass < 4 && cnt === 0; pass++) {
    const rr = r * (1 + pass * 0.6);
    const mb = minBuild * (1 - pass * 0.25);
    const x0 = Math.max(1, Math.floor(cx - rr)), x1 = Math.min(size - 2, Math.ceil(cx + rr));
    const y0 = Math.max(1, Math.floor(cy - rr)), y1 = Math.min(size - 2, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rr) continue;
        const i = y * size + x;
        if (g.wet[i] || g.slope[i] > 0.1 || g.build[i] < mb || (blocked && blocked[i])) continue;
        goal[i] = 1;
        cnt++;
      }
    }
  }
  return goal;
}

// ── terrain grading ─────────────────────────────────────────────────────────

/**
 * Grade the terrain under a route so each dry route cell's corner spread is
 * ≤ maxSlope·CELL, then blend embankments into the surroundings. Vertices
 * shared with wet cells may only move while those cells stay wet; locked
 * vertices (another route) never move. Returns the route-vertex mask.
 */
function gradeRoute(ctx: GenContext, path: number[], maxSlope: number, locked: Uint8Array): Uint8Array {
  const size = ctx.size, V = ctx.V, h = ctx.heights;
  const n = path.length;
  const Zc = cellHeights(h, size);
  const wet = new Uint8Array(ctx.nC);
  for (let i = 0; i < ctx.nC; i++) wet[i] = ctx.water[i] > Zc[i] + WATER_EPS ? 1 : 0;
  // longitudinal profile (bridges interpolate between their abutments)
  const P = new Float64Array(n);
  for (let k = 0; k < n; k++) P[k] = wet[path[k]] ? NaN : Zc[path[k]];
  let k0 = -1;
  for (let k = 0; k <= n; k++) {
    if (k < n && Number.isNaN(P[k])) continue;
    if (k0 + 1 < k) {
      const a = k0 >= 0 ? P[k0] : k < n ? P[k] : 0;
      const b = k < n ? P[k] : a;
      for (let q = k0 + 1; q < k; q++) P[q] = mix(a, b, (q - k0) / (k - k0));
    }
    k0 = k;
  }
  const tmp = new Float64Array(n);
  for (let it = 0; it < 4; it++) {
    tmp.set(P);
    for (let k = 0; k < n; k++) {
      let s = 0, c = 0;
      for (let q = -3; q <= 3; q++) {
        const kk = k + q;
        if (kk < 0 || kk >= n) continue;
        const w = 4 - Math.abs(q);
        s += tmp[kk] * w;
        c += w;
      }
      P[k] = s / c;
    }
  }
  // Lipschitz limit (both directions) so consecutive cells differ ≤ step
  const step = maxSlope * CELL * 0.8;
  for (let it = 0; it < 3; it++) {
    for (let k = 1; k < n; k++) P[k] = clampf(P[k], P[k - 1] - step, P[k - 1] + step);
    for (let k = n - 2; k >= 0; k--) P[k] = clampf(P[k], P[k + 1] - step, P[k + 1] + step);
  }
  // corner targets
  const sum = new Float64Array(V * V);
  const cnt = new Uint8Array(V * V);
  for (let k = 0; k < n; k++) {
    const c = path[k];
    if (wet[c]) continue;
    const x = c % size, y = (c / size) | 0;
    for (let q = 0; q < 4; q++) {
      const v = (y + (q >> 1)) * V + x + (q & 1);
      sum[v] += P[k];
      cnt[v]++;
    }
  }
  const touchesWet = (v: number) => {
    const vx = v % V, vy = (v / V) | 0;
    for (let q = 0; q < 4; q++) {
      const cx = vx - 1 + (q & 1), cy = vy - 1 + (q >> 1);
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
      if (wet[cy * size + cx]) return true;
    }
    return false;
  };
  /** would moving vertex v to z keep every adjacent wet cell wet? */
  const safeWet = (v: number, z: number) => {
    const vx = v % V, vy = (v / V) | 0;
    const dz = z - h[v];
    for (let q = 0; q < 4; q++) {
      const cx = vx - 1 + (q & 1), cy = vy - 1 + (q >> 1);
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
      const i = cy * size + cx;
      if (!wet[i]) continue;
      const zc = (h[cy * V + cx] + h[cy * V + cx + 1] + h[(cy + 1) * V + cx] + h[(cy + 1) * V + cx + 1]) * 0.25 + dz * 0.25;
      if (ctx.water[i] - zc < 0.3) return false;
    }
    return true;
  };
  const routeV = new Uint8Array(V * V);
  for (let v = 0; v < V * V; v++) {
    if (!cnt[v] || locked[v]) continue;
    const z = sum[v] / cnt[v];
    if (touchesWet(v) && !safeWet(v, z)) continue;
    h[v] = z;
    routeV[v] = 1;
  }
  // repair any residual over-steep dry route cell by flattening toward its mean
  const lim = MAX_ROAD_SLOPE * CELL * 0.92;
  for (let it = 0; it < 8; it++) {
    let bad = 0;
    for (let k = 0; k < n; k++) {
      const c = path[k];
      if (wet[c]) continue;
      const x = c % size, y = (c / size) | 0;
      const vs = [y * V + x, y * V + x + 1, (y + 1) * V + x, (y + 1) * V + x + 1];
      let lo = Infinity, hi = -Infinity, mean = 0;
      for (const v of vs) {
        lo = Math.min(lo, h[v]);
        hi = Math.max(hi, h[v]);
        mean += h[v] * 0.25;
      }
      if (hi - lo <= lim) continue;
      bad++;
      for (const v of vs) {
        if (locked[v]) continue;
        const z = mix(h[v], mean, 0.7);
        if (touchesWet(v) && !safeWet(v, z)) continue;
        h[v] = z;
        routeV[v] = 1;
      }
    }
    if (bad === 0) break;
  }
  // embankments / cuttings: blend nearby terrain toward the route surface
  const { dist, nearest } = distanceTransform(routeV, V, V, true);
  if (nearest) {
    const hr = new Float32Array(h);
    for (let v = 0; v < V * V; v++) {
      if (routeV[v] || locked[v]) continue;
      const d = dist[v];
      if (d > 11) continue;
      const nv = nearest[v];
      if (nv < 0) continue;
      const target = hr[nv];
      const dh = Math.abs(hr[v] - target);
      const R = clampf(1.5 + dh / (CELL * 0.45), 1.5, 11);
      if (d >= R) continue;
      const w = sstep(R, 0.6, d);
      const z = mix(hr[v], target, w);
      if (touchesWet(v) && !safeWet(v, z)) continue;
      h[v] = z;
    }
  }
  return routeV;
}

/** After terrain edits: cells that were dry must stay dry (cap fringe surfaces). */
function recapWater(ctx: GenContext, wasWet: Uint8Array): void {
  const Zc = cellHeights(ctx.heights, ctx.size);
  for (let i = 0; i < ctx.nC; i++) {
    if (wasWet[i]) continue;
    if (ctx.water[i] > Zc[i] + WATER_EPS * 0.5) ctx.water[i] = Zc[i] + WATER_EPS * 0.5;
  }
}

// ── public entry ───────────────────────────────────────────────────────────

export function routeConnections(ctx: GenContext, report: (f: number) => void): void {
  const size = ctx.size, nC = ctx.nC, V = ctx.V;
  const L = ctx.layout;
  const wasWet = new Uint8Array(nC);
  {
    const Zc = cellHeights(ctx.heights, size);
    for (let i = 0; i < nC; i++) wasWet[i] = ctx.water[i] > Zc[i] + WATER_EPS ? 1 : 0;
  }
  let g = buildGrid(ctx);
  report(0.08);

  // ── highway ──────────────────────────────────────────────────────────────
  const hwSpec: Spec = { turn: 20, gradeK: 30, gradeMax: 0.1, hardK: 900, rough: 7, wetCost: 30, maxWaterWidth: 3.2, allowWide: false, shore: 0.6, blocked: null };
  const endR = Math.max(5, L.buildRadius * 0.3);
  const goal = goalDisc(g, L.startX, L.startY, endR, 0.6, null);
  const edges = L.highwayEdges.length ? L.highwayEdges : [0, 1, 2, 3];
  const pref = edges.map((_, i) => i * 0.18);
  let hwPath: number[] | null = null;
  let hwEdge = edges[0];
  for (let attempt = 0; attempt < 2 && !hwPath; attempt++) {
    const spec = attempt === 0 ? hwSpec : { ...hwSpec, allowWide: true };
    const field = costField(g, spec, goal);
    report(0.25 + attempt * 0.1);
    const entry = bestEntry(g, spec, field, attempt === 0 ? edges : [0, 1, 2, 3], 6, attempt === 0 ? pref : [0, 0, 0, 0]);
    if (!entry) continue;
    const last = entry.cells[entry.cells.length - 1];
    const tail = astar(g, spec, last, (entry.edge + 2) & 3, goal, field);
    if (!tail) continue;
    hwPath = entry.cells.concat(tail.slice(1));
    hwEdge = entry.edge;
  }
  report(0.45);
  const locked = new Uint8Array(V * V);
  const occupied = new Uint8Array(nC);
  if (hwPath) {
    const rv = gradeRoute(ctx, hwPath, 0.1, locked);
    for (let v = 0; v < V * V; v++) if (rv[v]) locked[v] = 1;
    for (const c of hwPath) {
      occupied[c] = 1;
      // lock every corner of highway cells so later edits never tilt them
      const x = c % size, y = (c / size) | 0;
      locked[y * V + x] = locked[y * V + x + 1] = locked[(y + 1) * V + x] = locked[(y + 1) * V + x + 1] = 1;
    }
    ctx.highway = hwPath.map((c) => ({ x: c % size, y: (c / size) | 0 }));
    const e = ctx.highway[0];
    ctx.connections.push({ kind: 'highway', x: e.x, y: e.y, dir: hwEdge });
  }
  recapWater(ctx, wasWet);
  report(0.55);

  // ── rail ─────────────────────────────────────────────────────────────────
  const wantRail = !(ctx.params.theme.id === 'tropical' && size < 384);
  let railEdge = -1;
  if (wantRail && hwPath) {
    g = buildGrid(ctx);
    const blocked = new Uint8Array(nC);
    for (const c of hwPath) {
      const x = c % size, y = (c / size) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < size && yy < size) blocked[yy * size + xx] = 1;
      }
    }
    const coreR = L.buildRadius * 0.4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.hypot(x + 0.5 - L.startX, y + 0.5 - L.startY) < coreR) blocked[y * size + x] = 1;
    const railSpec: Spec = { turn: 32, gradeK: 90, gradeMax: 0.045, hardK: 5000, rough: 9, wetCost: 45, maxWaterWidth: 2.3, allowWide: false, shore: 1, blocked };
    // candidate edges: opposite of the highway first, then the perpendiculars (never the open sea edge)
    const cand = [(hwEdge + 2) & 3, (hwEdge + 1) & 3, (hwEdge + 3) & 3].filter((e) => e !== L.seaEdge);
    for (const e of cand) {
      // end point: toward that edge, just outside the start core, 30-50 % into the map
      const ox = DIR_DX[e], oy = DIR_DY[e];
      const off = L.buildRadius * 0.75;
      const tx = L.startX + ox * off, ty = L.startY + oy * off;
      const depth = e === 0 ? ty : e === 1 ? size - tx : e === 2 ? size - ty : tx;
      if (depth < size * 0.22 || depth > size * 0.6) continue;
      const rgoal = goalDisc(g, tx, ty, Math.max(4, size * 0.02), 0.5, blocked);
      const field = costField(g, railSpec, rgoal);
      const entry = bestEntry(g, railSpec, field, [e], 5, [0], 0.15, 0.85);
      if (!entry) continue;
      const tail = astar(g, railSpec, entry.cells[entry.cells.length - 1], (e + 2) & 3, rgoal, field);
      if (!tail) continue;
      const path = entry.cells.concat(tail.slice(1));
      // reject absurd detours (> 2.4× the straight distance)
      const [ex, ey] = [entry.cells[0] % size, (entry.cells[0] / size) | 0];
      if (path.length > 2.4 * (Math.abs(ex - tx) + Math.abs(ey - ty)) + 20) continue;
      gradeRoute(ctx, path, 0.055, locked);
      for (const c of path) occupied[c] = 2;
      ctx.rail = path.map((c) => ({ x: c % size, y: (c / size) | 0 }));
      const r0 = ctx.rail[0];
      ctx.connections.push({ kind: 'rail', x: r0.x, y: r0.y, dir: e });
      railEdge = e;
      break;
    }
    recapWater(ctx, wasWet);
  }
  report(0.8);
  ctx.routeMask = occupied;

  // ── start cell near the highway end ─────────────────────────────────────
  g = buildGrid(ctx);
  const endCell = hwPath ? hwPath[hwPath.length - 1] : Math.floor(L.startY) * size + Math.floor(L.startX);
  const ex = endCell % size, ey = (endCell / size) | 0;
  let best = -1, bestS = -Infinity;
  for (let y = Math.max(1, ey - 14); y <= Math.min(size - 2, ey + 14); y++) {
    for (let x = Math.max(1, ex - 14); x <= Math.min(size - 2, ex + 14); x++) {
      const i = y * size + x;
      if (g.wet[i] || occupied[i] || g.slope[i] > 0.08) continue;
      let adjRoute = false;
      for (let k = 0; k < 4; k++) if (occupied[(y + DIR_DY[k]) * size + x + DIR_DX[k]]) adjRoute = true;
      if (adjRoute) continue;
      const d = Math.hypot(x - ex, y - ey);
      const toward = Math.hypot(x - L.startX, y - L.startY) < Math.hypot(ex - L.startX, ey - L.startY) + 2 ? 0.4 : 0;
      const s = g.build[i] * 6 - d * 0.12 - g.slope[i] * 10 + toward;
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
  }
  if (best < 0) best = endCell;
  ctx.start = { x: best % size, y: (best / size) | 0 };

  // ── ship & air connections ───────────────────────────────────────────────
  if (L.hasSea) {
    let sb = -1, sd = Infinity;
    for (let e = 0; e < 4; e++) {
      for (let p = 2; p < size - 2; p++) {
        const [x, y] = edgeCell(size, e, p);
        const i = y * size + x;
        if (!g.ocean[i] || ctx.water[i] - g.Zc[i] < 4) continue;
        const d = Math.hypot(x - ctx.start.x, y - ctx.start.y) * (e === L.seaEdge ? 0.8 : 1);
        if (d < sd) {
          sd = d;
          sb = e * size * 4 + p;
        }
      }
    }
    if (sb >= 0) {
      const e = Math.floor(sb / (size * 4)), p = sb % (size * 4);
      const [x, y] = edgeCell(size, e, p);
      ctx.connections.push({ kind: 'ship', x, y, dir: e });
    }
  }
  {
    // air: an edge not used by the highway/rail, at the start's projection onto it
    const shipEdge = ctx.connections.find((c) => c.kind === 'ship')?.dir ?? -1;
    const used = new Set<number>([hwEdge, railEdge, shipEdge]);
    let ae = -1, ad = Infinity;
    for (let e = 0; e < 4; e++) {
      if (used.has(e)) continue;
      const d = e === 0 ? ctx.start.y : e === 1 ? size - 1 - ctx.start.x : e === 2 ? size - 1 - ctx.start.y : ctx.start.x;
      const s = d + (e === L.seaEdge ? size * 0.05 : 0);
      if (s < ad) {
        ad = s;
        ae = e;
      }
    }
    if (ae < 0) ae = (hwEdge + 1) & 3;
    const p = clampf(ae === 0 || ae === 2 ? ctx.start.x : ctx.start.y, 2, size - 3);
    const [x, y] = edgeCell(size, ae, Math.round(p));
    const conn: OutsideConnection = { kind: 'air', x, y, dir: ae };
    ctx.connections.push(conn);
  }
  report(1);
}

/** Remove trees on and right beside the pre-built routes (verges). */
export function clearRouteVerges(ctx: GenContext, routes: Cell[][]): void {
  const size = ctx.size;
  for (const r of routes) {
    for (const c of r) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (x >= 0 && y >= 0 && x < size && y < size) ctx.trees[y * size + x] = 0;
      }
    }
  }
}
