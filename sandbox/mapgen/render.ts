// 2D map renderer for the mapgen sandbox (browser canvas + node PNG harness).
// Hillshade × hypsometric/theme tint, water depth, trees, routes, resources.
import type { GeneratedMap, ThemeDef } from '../../src/core/types';

export type Layer = 'terrain' | 'fertility' | 'forest' | 'ore' | 'oil' | 'wind' | 'slope' | 'height';

export interface RenderOpts {
  theme: ThemeDef;
  layer: Layer;
  trees: boolean;
  routes: boolean;
  water: boolean;
  /** pixels per cell (integer ≥ 1) */
  scale: number;
}

type RGB = [number, number, number];
const hex = (s: string): RGB => {
  const v = parseInt(s.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mixc = (a: RGB, b: RGB, t: number): RGB => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};
const ss = (a: number, b: number, v: number) => {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number) => {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(y ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

function heat(t: number): RGB {
  const stops: RGB[] = [[20, 20, 60], [40, 90, 170], [40, 170, 120], [230, 210, 60], [230, 90, 40], [250, 250, 250]];
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mixc(stops[i], stops[i + 1], t - i);
}

export function renderMap(m: GeneratedMap, o: RenderOpts): { data: Uint8ClampedArray; w: number; h: number } {
  const size = m.size, V = size + 1, S = Math.max(1, o.scale | 0);
  const W = size * S;
  const out = new Uint8ClampedArray(W * W * 4);
  const H = m.heights;
  const th = o.theme;
  const cGrass = hex(th.grass), cDry = hex(th.grassDry), cDirt = hex(th.dirt), cSand = hex(th.sand), cRock = hex(th.rock), cSnow = hex(th.snow);
  const cShal = hex(th.waterShallow), cDeep = hex(th.waterDeep);
  const cTree: RGB = th.id === 'desert' ? [92, 110, 52] : th.id === 'tropical' ? [26, 92, 38] : th.id === 'boreal' || th.id === 'alpine' ? [30, 62, 40] : [38, 78, 34];
  const hv = (x: number, y: number) => {
    x = x < 0 ? 0 : x > size ? size : x;
    y = y < 0 ? 0 : y > size ? size : y;
    const ix = Math.min(size - 1, Math.floor(x)), iy = Math.min(size - 1, Math.floor(y));
    const fx = x - ix, fy = y - iy;
    const i = iy * V + ix;
    return (H[i] * (1 - fx) + H[i + 1] * fx) * (1 - fy) + (H[i + V] * (1 - fx) + H[i + V + 1] * fx) * fy;
  };
  const cellH = (x: number, y: number) => {
    const i = y * V + x;
    return (H[i] + H[i + 1] + H[i + V] + H[i + V + 1]) * 0.25;
  };
  const cellSlope = (x: number, y: number) => {
    const i = y * V + x;
    const a = H[i], b = H[i + 1], c = H[i + V], d = H[i + V + 1];
    return (Math.max(a, b, c, d) - Math.min(a, b, c, d)) / 16;
  };
  const lx = -0.55, ly = -0.6, lz = 0.58;
  const ll = Math.hypot(lx, ly, lz);
  const res: Record<string, Uint8Array | undefined> = { fertility: m.fertility, forest: m.forest, ore: m.ore, oil: m.oil, wind: m.wind };
  const sea = m.seaLevel;
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      const gx = (px + 0.5) / S, gy = (py + 0.5) / S;
      const cx = Math.min(size - 1, Math.floor(gx)), cy = Math.min(size - 1, Math.floor(gy));
      const ci = cy * size + cx;
      const z = hv(gx, gy);
      const e = 0.5 / S;
      const dzdx = (hv(gx + e, gy) - hv(gx - e, gy)) / (2 * e * 16);
      const dzdy = (hv(gx, gy + e) - hv(gx, gy - e)) / (2 * e * 16);
      const nx = -dzdx * 1.6, ny = -dzdy * 1.6, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const dot = (nx * lx + ny * ly + nz * lz) / (nl * ll);
      const shade = 0.35 + 0.85 * Math.max(0, dot);
      const slope = cellSlope(cx, cy);
      const ch = cellH(cx, cy);
      let col: RGB;
      if (o.layer === 'terrain') {
        const zz = z - sea;
        const nse = hash(cx >> 3, cy >> 3) * 0.3 + hash(cx, cy) * 0.1;
        if (th.id === 'desert') col = mixc(mixc(cSand, cDry, 0.35 + nse), cDirt, ss(0.15, 0.6, slope));
        else col = mixc(cGrass, cDry, ss(40, 220, zz) * 0.7 + nse * 0.5 - 0.1);
        if (th.hasCoast && zz < 3.2) col = mixc(col, cSand, 1 - ss(1.8, 3.2, zz));
        col = mixc(col, cDirt, ss(0.28, 0.5, slope) * 0.6);
        col = mixc(col, cRock, ss(0.45, 0.85, slope));
        const snowLine = th.id === 'alpine' ? 300 : th.id === 'boreal' ? 230 : 9999;
        if (zz > snowLine - 40) col = mixc(col, cRock, ss(snowLine - 40, snowLine, zz) * 0.7);
        if (zz > snowLine) col = mixc(col, cSnow, ss(snowLine, snowLine + 40, zz) * (1 - ss(0.6, 1.1, slope)));
        if (o.trees && m.trees[ci] > 0) {
          const t = m.trees[ci];
          const dots = hash(px * 7 + 1, py * 13 + 5);
          col = mixc(col, cTree, 0.25 + 0.2 * t + (dots < 0.3 * t ? 0.15 : 0));
        }
      } else if (o.layer === 'height') {
        col = heat((z - sea) / 400);
      } else if (o.layer === 'slope') {
        col = slope < 0.1 ? [120, 200, 110] : slope < 0.18 ? [220, 210, 90] : slope < 0.35 ? [230, 140, 60] : [180, 50, 50];
      } else {
        const g = 150;
        const arr = res[o.layer];
        const v = arr ? arr[ci] / 255 : 0;
        col = mixc([g, g, g], heat(v), v > 0.02 ? 0.85 : 0);
      }
      let r = col[0] * shade, g2 = col[1] * shade, b = col[2] * shade;
      if (o.water) {
        const wl = m.water[ci];
        const depth = wl - ch;
        if (depth > 0.15) {
          const wc = mixc(cShal, cDeep, ss(0.5, 22, depth));
          const a = 0.62 + 0.33 * ss(0, 6, depth);
          const ws = 0.9 + 0.1 * shade;
          r = r * (1 - a) + wc[0] * ws * a;
          g2 = g2 * (1 - a) + wc[1] * ws * a;
          b = b * (1 - a) + wc[2] * ws * a;
        }
      }
      const oi = (py * W + px) * 4;
      out[oi] = r;
      out[oi + 1] = g2;
      out[oi + 2] = b;
      out[oi + 3] = 255;
    }
  }
  const paint = (cx: number, cy: number, c: RGB, inset = 0) => {
    for (let yy = inset; yy < S - inset; yy++) {
      for (let xx = inset; xx < S - inset; xx++) {
        const oi = ((cy * S + yy) * W + cx * S + xx) * 4;
        out[oi] = c[0];
        out[oi + 1] = c[1];
        out[oi + 2] = c[2];
      }
    }
  };
  if (o.routes) {
    for (const c of m.rail) paint(c.x, c.y, [120, 40, 60]);
    for (const c of m.highway) {
      const wet = m.water[c.y * size + c.x] > cellH(c.x, c.y) + 0.15;
      paint(c.x, c.y, wet ? [255, 255, 255] : [250, 190, 40]);
    }
    const dot = (x: number, y: number, rad: number, c: RGB) => {
      const R = rad * S;
      const cx = (x + 0.5) * S, cy = (y + 0.5) * S;
      for (let yy = Math.floor(cy - R - 1); yy <= cy + R + 1; yy++) {
        for (let xx = Math.floor(cx - R - 1); xx <= cx + R + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= W) continue;
          const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
          if (d > R) continue;
          const oi = (yy * W + xx) * 4;
          const edge = d > R - 1.2 * S;
          out[oi] = edge ? 0 : c[0];
          out[oi + 1] = edge ? 0 : c[1];
          out[oi + 2] = edge ? 0 : c[2];
        }
      }
    };
    const kc: Record<string, RGB> = { highway: [250, 190, 40], rail: [200, 60, 90], ship: [60, 140, 255], air: [240, 240, 240] };
    for (const c of m.connections) dot(c.x, c.y, 4, kc[c.kind] ?? [255, 0, 255]);
    dot(m.start.x, m.start.y, 5, [230, 30, 30]);
  }
  return { data: out, w: W, h: W };
}
