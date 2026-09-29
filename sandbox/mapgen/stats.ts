// Map quality statistics shared by the node harness and the browser sandbox.
import type { GeneratedMap } from '../../src/core/types';
import { MAX_ROAD_SLOPE, WATER_EPS } from '../../src/core/constants';

export function stats(m: GeneratedMap) {
  const size = m.size, V = size + 1, H = m.heights, n = size * size;
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
  let gentle = 0, wetN = 0, sea = 0, treesN = 0, lo = Infinity, hi = -Infinity;
  const res = { fertility: 0, forest: 0, ore: 0, oil: 0, wind: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const z = ch(x, y);
      if (z < lo) lo = z;
      if (z > hi) hi = z;
      const w = wet(x, y);
      if (w) {
        wetN++;
        if (Math.abs(m.water[i] - m.seaLevel) < 0.01) sea++;
      } else if (sl(x, y) < 0.1) gentle++;
      if (m.trees[i]) treesN++;
      for (const k of Object.keys(res) as (keyof typeof res)[]) if (m[k][i] > 60) res[k]++;
    }
  }
  // gentle land around the start (radius 40)
  let near = 0, nearN = 0;
  for (let y = m.start.y - 40; y <= m.start.y + 40; y++) {
    for (let x = m.start.x - 40; x <= m.start.x + 40; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size || Math.hypot(x - m.start.x, y - m.start.y) > 40) continue;
      nearN++;
      if (!wet(x, y) && sl(x, y) < 0.1) near++;
    }
  }
  let hwMaxSlope = 0, hwWet = 0, hwGaps = 0;
  for (let k = 0; k < m.highway.length; k++) {
    const c = m.highway[k];
    if (wet(c.x, c.y)) hwWet++;
    else hwMaxSlope = Math.max(hwMaxSlope, sl(c.x, c.y));
    if (k > 0 && Math.abs(c.x - m.highway[k - 1].x) + Math.abs(c.y - m.highway[k - 1].y) !== 1) hwGaps++;
  }
  let rlMaxSlope = 0, rlWet = 0, rlGaps = 0;
  for (let k = 0; k < m.rail.length; k++) {
    const c = m.rail[k];
    if (wet(c.x, c.y)) rlWet++;
    else rlMaxSlope = Math.max(rlMaxSlope, sl(c.x, c.y));
    if (k > 0 && Math.abs(c.x - m.rail[k - 1].x) + Math.abs(c.y - m.rail[k - 1].y) !== 1) rlGaps++;
  }
  const pct = (v: number) => Math.round((v / n) * 1000) / 10;
  return {
    h: [Math.round(lo), Math.round(hi)],
    gentle: pct(gentle), water: pct(wetN), sea: pct(sea), trees: pct(treesN),
    startNear: Math.round((near / Math.max(1, nearN)) * 100),
    start: [m.start.x, m.start.y, wet(m.start.x, m.start.y) ? 'WET' : 'dry', Math.round(sl(m.start.x, m.start.y) * 100) / 100],
    hw: { len: m.highway.length, wet: hwWet, maxSlope: Math.round(hwMaxSlope * 100) / 100, gaps: hwGaps, ok: hwMaxSlope <= MAX_ROAD_SLOPE },
    rail: { len: m.rail.length, wet: rlWet, maxSlope: Math.round(rlMaxSlope * 100) / 100, gaps: rlGaps },
    res: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, pct(v)])),
    conn: m.connections.map((c) => `${c.kind}@${c.x},${c.y}>${c.dir}`).join(' '),
  };
}
