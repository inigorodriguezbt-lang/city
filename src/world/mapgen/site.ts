// ─────────────────────────────────────────────────────────────────────────────
// Start-site selection. Theme shapers propose a start (beside the river, on
// the bay shore, …); this refines it on the shaped terrain so the city always
// begins on low-relief, dry land with room to grow, well away from map edges.
// ─────────────────────────────────────────────────────────────────────────────
import type { GenContext } from './context';
import { blur } from './grid';

export function refineStart(ctx: GenContext): void {
  const L = ctx.layout, size = ctx.size, V = ctx.V, h = ctx.heights;
  const R = L.buildRadius;
  const r = Math.max(4, Math.round(R * 0.45));
  const n = V * V;
  const sq = new Float32Array(n);
  const wetish = new Float32Array(n);
  const sea = L.hasSea ? 0 : -Infinity;
  for (let i = 0; i < n; i++) {
    sq[i] = h[i] * h[i];
    wetish[i] = h[i] < sea + 1.5 ? 1 : 0;
  }
  const m1 = blur(h, V, V, r, 2);
  const m2 = blur(sq, V, V, r, 2);
  const seaFrac = L.hasSea ? blur(wetish, V, V, Math.round(r * 1.5), 2) : null;
  // regional base level so that valleys are preferred on mountainous maps
  let lo = Infinity;
  for (let i = 0; i < n; i++) if (m1[i] < lo && (!seaFrac || seaFrac[i] < 0.05)) lo = m1[i];
  const margin = Math.max(size * 0.2, R * 0.95);
  const step = Math.max(2, size >> 7);
  const prefS = size * 0.22;
  let best = -1, bestS = -Infinity;
  for (let y = Math.ceil(margin); y <= size - margin; y += step) {
    for (let x = Math.ceil(margin); x <= size - margin; x += step) {
      const i = y * V + x;
      if (seaFrac && h[i] < 3) continue;
      const std = Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]));
      const dPref = Math.hypot(x - L.startX, y - L.startY) / prefS;
      const dc = Math.hypot(x - size / 2, y - size / 2) / (size * 0.5);
      let s = -std / 7 - 1.1 * dPref * dPref - 1.2 * dc * dc - (m1[i] - lo) / 140;
      if (seaFrac) s -= 4 * Math.max(0, seaFrac[i] - 0.12);
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
  }
  if (best >= 0) {
    L.startX = best % V;
    L.startY = (best / V) | 0;
  }
}
