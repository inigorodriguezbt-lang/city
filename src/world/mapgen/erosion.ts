// ─────────────────────────────────────────────────────────────────────────────
// Erosion ("Eroding mountains"). Three complementary processes on the vertex
// grid, all deterministic and allocation-free in their inner loops:
//
//  • streamPower   – implicit detachment-limited fluvial incision
//                    (Braun & Willett 2013) over the Priority-Flood drainage
//                    graph. Carves the large-scale dendritic valley network so
//                    ridges and drainage basins look like real landscapes.
//  • particleErosion – droplet hydraulic erosion with inertia, sediment
//                    capacity and deposition (Beyer 2015). Adds gullies, rills,
//                    sediment fans and softened valley floors at cell scale.
//  • thermalErosion – talus relaxation that collapses over-steep slopes into
//                    scree and removes single-vertex spikes.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL } from '../../core/constants';
import type { RNG } from '../../core/rng';
import { accumulate, priorityFlood } from './flow';
import { N8_DX, N8_DY, N8_LEN } from './grid';

export interface StreamPowerOpts {
  iterations: number;
  /** incision coefficient: f = k · erod · √A / L per iteration */
  k: number;
  /** nodes below this level act as fixed base level (sea); null = none */
  seaLevel: number | null;
  /** per-vertex erodibility 0..1 (null = 1 everywhere) */
  erod: Float32Array | null;
  /** max lowering per iteration (m), keeps huge catchments from over-cutting */
  maxCut: number;
  /** fixed base-level nodes (map-edge outlets); null = every border node */
  edges: Uint8Array | null;
}

/**
 * Implicit stream-power incision. Each iteration routes flow over the
 * depression-filled surface, accumulates drainage area and solves
 * h_i' = (h_i + f·h_r') / (1 + f) from outlets upstream, which is
 * unconditionally stable and propagates knickpoints naturally.
 */
export function streamPower(h: Float32Array, V: number, o: StreamPowerOpts, report?: (f: number) => void): void {
  const n = V * V;
  const outlet = o.seaLevel !== null || o.edges ? new Uint8Array(n) : null;
  const hn = new Float32Array(n);
  for (let it = 0; it < o.iterations; it++) {
    if (outlet) {
      const sl = o.seaLevel ?? -Infinity;
      const e = o.edges;
      for (let i = 0; i < n; i++) outlet[i] = h[i] < sl || (e !== null && e[i]) ? 1 : 0;
    }
    const g = priorityFlood(h, V, V, { outlet, edges: o.edges === null });
    const A = accumulate(g, 1);
    const { order, rec, recLen } = g;
    const erod = o.erod;
    for (let q = 0; q < n; q++) {
      const c = order[q];
      const r = rec[c];
      const hc = h[c];
      if (r < 0 || (outlet !== null && outlet[c])) {
        hn[c] = hc;
        continue;
      }
      const hr = hn[r];
      if (hc <= hr) {
        hn[c] = hc;
        continue;
      }
      const f = o.k * (erod ? erod[c] : 1) * Math.sqrt(A[c]) / recLen[c];
      let z = (hc + f * hr) / (1 + f);
      if (hc - z > o.maxCut) z = hc - o.maxCut;
      hn[c] = z;
    }
    h.set(hn);
    report?.((it + 1) / o.iterations);
  }
}

export interface ParticleOpts {
  /** droplets per vertex */
  density: number;
  lifetime: number;
  inertia: number;
  capacity: number;
  minCapacity: number;
  erodeRate: number;
  depositRate: number;
  evaporate: number;
  gravity: number;
  /** erosion brush radius in vertices */
  radius: number;
  /** droplets stop (and drop half their load) below this level; null = none */
  seaLevel: number | null;
  /** per-vertex erodibility 0..1 (null = 1 everywhere) */
  erod: Float32Array | null;
  /** max erosion depth per droplet step (cell-height units) */
  maxStep: number;
  /** vertices where droplets end without depositing (designed lake basins); null = none */
  sink: Uint8Array | null;
}

/**
 * Droplet hydraulic erosion. Heights are processed in "cell units" (m / CELL)
 * so the gradient is the true rise/run and parameters are resolution-free.
 */
export function particleErosion(h: Float32Array, V: number, o: ParticleOpts, rng: RNG, report?: (f: number) => void): void {
  const n = V * V;
  const H = new Float32Array(n);
  const inv = 1 / CELL;
  for (let i = 0; i < n; i++) H[i] = h[i] * inv;
  const sea = o.seaLevel !== null ? o.seaLevel * inv : -Infinity;
  // erosion brush
  const r = Math.max(1, o.radius);
  const bdx: number[] = [], bdy: number[] = [], bw: number[] = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < r) {
        bdx.push(dx);
        bdy.push(dy);
        bw.push(r - d);
      }
    }
  }
  const BX = new Int32Array(bdx), BY = new Int32Array(bdy), BW = new Float32Array(bw);
  const BN = BX.length;
  const drops = Math.round(o.density * n);
  const lim = V - 1;
  const erod = o.erod;
  const { inertia, capacity, minCapacity, erodeRate, depositRate, evaporate, gravity, lifetime, maxStep } = o;
  const reportEvery = Math.max(1, drops >> 6);
  for (let d = 0; d < drops; d++) {
    let px = rng.next() * lim, py = rng.next() * lim;
    let dirX = 0, dirY = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < lifetime; life++) {
      const cx = px | 0, cy = py | 0;
      const u = px - cx, v = py - cy;
      const i0 = cy * V + cx;
      const a = H[i0], b = H[i0 + 1], c = H[i0 + V], e = H[i0 + V + 1];
      const gx = (b - a) * (1 - v) + (e - c) * v;
      const gy = (c - a) * (1 - u) + (e - b) * u;
      const hOld = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v;
      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-9) break;
      dirX /= len;
      dirY /= len;
      px += dirX;
      py += dirY;
      if (px < 0 || py < 0 || px >= lim || py >= lim) break;
      const nx = px | 0, ny = py | 0;
      const nu = px - nx, nv = py - ny;
      const j0 = ny * V + nx;
      const hNew = H[j0] * (1 - nu) * (1 - nv) + H[j0 + 1] * nu * (1 - nv) + H[j0 + V] * (1 - nu) * nv + H[j0 + V + 1] * nu * nv;
      const dh = hNew - hOld;
      if (o.sink !== null && o.sink[j0]) break;
      if (hNew < sea) {
        // reached the sea: drop half the load as a delta/beach deposit, lose the rest
        const dep = sed * 0.5;
        H[i0] += dep * (1 - u) * (1 - v);
        H[i0 + 1] += dep * u * (1 - v);
        H[i0 + V] += dep * (1 - u) * v;
        H[i0 + V + 1] += dep * u * v;
        break;
      }
      const cap = Math.max(-dh * speed * water * capacity, minCapacity);
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositRate;
        sed -= dep;
        H[i0] += dep * (1 - u) * (1 - v);
        H[i0 + 1] += dep * u * (1 - v);
        H[i0 + V] += dep * (1 - u) * v;
        H[i0 + V + 1] += dep * u * v;
      } else {
        let amt = Math.min((cap - sed) * erodeRate, -dh, maxStep);
        if (erod) amt *= erod[i0];
        if (amt > 0) {
          // normalise brush weights over in-bounds vertices
          let wsum = 0;
          for (let k = 0; k < BN; k++) {
            const x = cx + BX[k], y = cy + BY[k];
            if (x >= 0 && y >= 0 && x < V && y < V) wsum += BW[k];
          }
          const s = amt / wsum;
          for (let k = 0; k < BN; k++) {
            const x = cx + BX[k], y = cy + BY[k];
            if (x < 0 || y < 0 || x >= V || y >= V) continue;
            H[y * V + x] -= BW[k] * s;
          }
          sed += amt;
        }
      }
      const s2 = speed * speed - dh * gravity;
      speed = s2 > 0 ? Math.sqrt(s2) : 0;
      water *= 1 - evaporate;
      if (water < 0.02) break;
    }
    if (report && d % reportEvery === 0) report(d / drops);
  }
  for (let i = 0; i < n; i++) h[i] = H[i] * CELL;
}

/**
 * Talus relaxation: any vertex steeper than `talus` (rise/run) toward its
 * 8-neighbours sheds `rate` of the excess, split proportionally among the lower
 * neighbours. Alternating scan direction avoids directional bias.
 */
export function thermalErosion(h: Float32Array, V: number, iterations: number, talus: number, rate: number, erod: Float32Array | null): void {
  const tCard = talus * CELL;
  const T = new Float32Array(8);
  for (let k = 0; k < 8; k++) T[k] = tCard * N8_LEN[k];
  const ex = new Float32Array(8);
  for (let it = 0; it < iterations; it++) {
    const rev = (it & 1) === 1;
    for (let yy = 0; yy < V; yy++) {
      const y = rev ? V - 1 - yy : yy;
      for (let xx = 0; xx < V; xx++) {
        const x = rev ? V - 1 - xx : xx;
        const i = y * V + x;
        const hi = h[i];
        let total = 0, maxEx = 0;
        for (let k = 0; k < 8; k++) {
          const nx = x + N8_DX[k], ny = y + N8_DY[k];
          ex[k] = 0;
          if (nx < 0 || ny < 0 || nx >= V || ny >= V) continue;
          const d = hi - h[ny * V + nx] - T[k];
          if (d > 0) {
            ex[k] = d;
            total += d;
            if (d > maxEx) maxEx = d;
          }
        }
        if (total <= 0) continue;
        const move = rate * maxEx * 0.5 * (erod ? 0.25 + 0.75 * erod[i] : 1);
        h[i] = hi - move;
        const s = move / total;
        for (let k = 0; k < 8; k++) {
          if (ex[k] <= 0) continue;
          h[(y + N8_DY[k]) * V + x + N8_DX[k]] += ex[k] * s;
        }
      }
    }
  }
}

/** Light 3×3 smoothing restricted by a per-vertex weight (0 = untouched). */
export function smoothMasked(h: Float32Array, V: number, weight: Float32Array, passes: number): void {
  const tmp = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    tmp.set(h);
    for (let y = 1; y < V - 1; y++) {
      for (let x = 1; x < V - 1; x++) {
        const i = y * V + x;
        const w = weight[i];
        if (w <= 0) continue;
        const avg = (tmp[i - 1] + tmp[i + 1] + tmp[i - V] + tmp[i + V]) * 0.125 + (tmp[i - V - 1] + tmp[i - V + 1] + tmp[i + V - 1] + tmp[i + V + 1]) * 0.0625 + tmp[i] * 0.25;
        h[i] = tmp[i] + (avg - tmp[i]) * w;
      }
    }
  }
}
