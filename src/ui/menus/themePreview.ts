// Tiny procedural landscape vignettes for the climate cards of the New City
// dialog, painted once per card from the ThemeDef palette: sky, distant
// ridges (snow-capped where the climate is cold), rolling hills, water with a
// beach where the theme has coast/lakes, and species-specific tree silhouettes.
import type { ThemeDef, TreeSpecies } from '../../core/types';

type RGB = [number, number, number];
const hex = (s: string): RGB => {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** sky mood per climate: zenith, horizon, sun glow */
const SKIES: Record<string, [string, string, string]> = {
  temperate: ['#3f7fc4', '#bfe0f2', '#fff4d6'],
  boreal: ['#44648d', '#d5e2ea', '#f4efe2'],
  desert: ['#3a86c6', '#f6d9a8', '#fff0c2'],
  tropical: ['#1f86d6', '#aee8f0', '#fffbe0'],
  alpine: ['#2f6fb8', '#d8ecf8', '#ffffff'],
  mediterranean: ['#3f8fd0', '#f8e2b6', '#fff1cf'],
};

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ridge(rnd: () => number, w: number, base: number, amp: number, rough: number): number[] {
  const pts: number[] = [];
  const f1 = 1.5 + rnd() * 2;
  const f2 = 4 + rnd() * 4;
  const p1 = rnd() * 6;
  const p2 = rnd() * 6;
  for (let x = 0; x <= w; x += 2) {
    const t = x / w;
    const y = base - amp * (0.55 + 0.45 * Math.sin(t * f1 * Math.PI + p1)) - amp * rough * Math.abs(Math.sin(t * f2 * Math.PI + p2));
    pts.push(y);
  }
  return pts;
}

function fillRidge(g: CanvasRenderingContext2D, pts: number[], w: number, h: number, fill: string | CanvasGradient): void {
  g.beginPath();
  g.moveTo(0, h);
  pts.forEach((y, i) => g.lineTo(i * 2, y));
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function tree(g: CanvasRenderingContext2D, sp: TreeSpecies, x: number, y: number, s: number, c: RGB): void {
  const dark = css(mix(c, [8, 18, 12], 0.35));
  const light = css(mix(c, [255, 255, 220], 0.12));
  g.fillStyle = dark;
  switch (sp) {
    case 'pine':
    case 'spruce':
    case 'cypress': {
      const tall = sp === 'cypress' ? 2.6 : sp === 'spruce' ? 2.1 : 1.8;
      const wide = sp === 'cypress' ? 0.32 : 0.55;
      g.beginPath();
      g.moveTo(x, y - s * tall);
      g.lineTo(x + s * wide, y);
      g.lineTo(x - s * wide, y);
      g.closePath();
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.moveTo(x, y - s * tall);
      g.lineTo(x - s * wide * 0.1, y);
      g.lineTo(x - s * wide, y);
      g.closePath();
      g.globalAlpha = 0.25;
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'palm': {
      g.strokeStyle = css([92, 70, 48]);
      g.lineWidth = Math.max(1, s * 0.12);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + s * 0.3, y - s * 0.9, x + s * 0.15, y - s * 1.7);
      g.stroke();
      g.strokeStyle = dark;
      g.lineWidth = Math.max(1, s * 0.16);
      const tx = x + s * 0.15;
      const ty = y - s * 1.7;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.55;
        g.beginPath();
        g.moveTo(tx, ty);
        g.quadraticCurveTo(tx + Math.cos(a) * s * 0.6, ty + Math.sin(a) * s * 0.4 - s * 0.1, tx + Math.cos(a) * s * 0.85, ty + Math.sin(a) * s * 0.3 + s * 0.35);
        g.stroke();
      }
      break;
    }
    case 'cactus': {
      g.fillStyle = css(mix(c, [40, 90, 50], 0.5));
      const r = s * 0.13;
      g.fillRect(x - r, y - s * 1.2, r * 2, s * 1.2);
      g.fillRect(x - s * 0.42, y - s * 0.8, r * 1.6, s * 0.45);
      g.fillRect(x - s * 0.42, y - s * 0.55, s * 0.42, r * 1.4);
      g.fillRect(x + s * 0.2, y - s * 0.95, r * 1.6, s * 0.5);
      g.fillRect(x, y - s * 0.6, s * 0.3, r * 1.4);
      break;
    }
    case 'acacia': {
      g.fillRect(x - s * 0.05, y - s * 0.9, s * 0.1, s * 0.9);
      g.beginPath();
      g.ellipse(x, y - s * 1, s * 0.85, s * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'birch':
    case 'willow':
    case 'olive':
    case 'cherry':
    case 'oak':
    case 'maple':
    default: {
      const tint: RGB = sp === 'cherry' ? [226, 150, 176] : sp === 'olive' ? [120, 132, 92] : sp === 'maple' ? mix(c, [200, 110, 50], 0.18) : c;
      g.fillStyle = sp === 'birch' ? '#e8e4da' : css([70, 52, 38]);
      g.fillRect(x - s * 0.06, y - s * 0.7, s * 0.12, s * 0.7);
      g.fillStyle = css(mix(tint, [10, 20, 10], 0.3));
      g.beginPath();
      g.arc(x, y - s * 0.95, s * 0.5, 0, Math.PI * 2);
      g.arc(x - s * 0.3, y - s * 0.75, s * 0.34, 0, Math.PI * 2);
      g.arc(x + s * 0.32, y - s * 0.78, s * 0.36, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(mix(tint, [255, 255, 220], 0.18), 0.5);
      g.beginPath();
      g.arc(x - s * 0.12, y - s * 1.1, s * 0.26, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** paint a theme vignette into `canvas` (css size w×h; drawn at devicePixelRatio) */
export function paintThemePreview(canvas: HTMLCanvasElement, t: ThemeDef, w = 240, h = 120, seed = 1): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = lcg(seed * 7919 + t.id.length * 131);
  const [zen, hor, sunC] = (SKIES[t.id] ?? SKIES.temperate).map(hex);

  // sky + sun glow
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, css(zen));
  sky.addColorStop(1, css(hor));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sx = w * (0.72 + rnd() * 0.12);
  const sy = h * 0.2;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.6);
  glow.addColorStop(0, css(sunC, 0.95));
  glow.addColorStop(0.08, css(sunC, 0.75));
  glow.addColorStop(0.3, css(sunC, 0.18));
  glow.addColorStop(1, css(sunC, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  // soft clouds
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 3; i++) {
    const cx = rnd() * w;
    const cy = h * (0.12 + rnd() * 0.18);
    const cw = 18 + rnd() * 26;
    g.beginPath();
    g.ellipse(cx, cy, cw, cw * 0.18, 0, 0, Math.PI * 2);
    g.ellipse(cx + cw * 0.3, cy - cw * 0.12, cw * 0.45, cw * 0.2, 0, 0, Math.PI * 2);
    g.fill();
  }

  const rock = hex(t.rock);
  const snow = hex(t.snow);
  const grass = hex(t.grass);
  const dry = hex(t.grassDry);
  const haze = hor;
  const m = t.mountainousness;
  const horizon = h * 0.62;

  // far mountains (hazy) with snow caps on cold/high themes
  const far = ridge(rnd, w, horizon, h * (0.14 + m * 0.34), 0.35 + m * 0.4);
  const farG = g.createLinearGradient(0, horizon - h * 0.5, 0, horizon);
  farG.addColorStop(0, css(mix(rock, haze, 0.45)));
  farG.addColorStop(1, css(mix(rock, haze, 0.7)));
  fillRidge(g, far, w, h, farG);
  const capLevel = t.snowiness > 0.3 || m > 0.7 ? horizon - h * (0.16 + m * 0.2) : -1;
  if (capLevel > 0) {
    g.save();
    g.beginPath();
    g.moveTo(0, h);
    far.forEach((y, i) => g.lineTo(i * 2, y));
    g.lineTo(w, h);
    g.closePath();
    g.clip();
    const sg = g.createLinearGradient(0, capLevel - h * 0.25, 0, capLevel + 4);
    sg.addColorStop(0, css(snow, 0.95));
    sg.addColorStop(1, css(mix(snow, haze, 0.4), 0));
    g.fillStyle = sg;
    g.fillRect(0, 0, w, capLevel + 4);
    g.restore();
  }

  // mid hills
  const mid = ridge(rnd, w, horizon + h * 0.08, h * (0.06 + m * 0.12), 0.3);
  const midG = g.createLinearGradient(0, horizon - h * 0.1, 0, horizon + h * 0.1);
  midG.addColorStop(0, css(mix(mix(grass, dry, 0.4), haze, 0.35)));
  midG.addColorStop(1, css(mix(grass, haze, 0.25)));
  fillRidge(g, mid, w, h, midG);

  // water body + beach on coastal / wet themes
  const wet = t.hasCoast || t.waterAmount > 0.35;
  const waterTop = h * 0.72;
  if (wet) {
    const wg = g.createLinearGradient(0, waterTop, 0, h);
    wg.addColorStop(0, css(mix(hex(t.waterShallow), haze, 0.25)));
    wg.addColorStop(1, css(hex(t.waterDeep)));
    g.fillStyle = wg;
    g.fillRect(0, waterTop, w, h - waterTop);
    // glints
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 14; i++) {
      const gx = sx + (rnd() - 0.5) * w * 0.5;
      const gy = waterTop + 3 + rnd() * (h - waterTop - 4);
      g.fillRect(gx, gy, 3 + rnd() * 8, 0.8);
    }
  }

  // foreground land sweeping in from the left
  const land = g.createLinearGradient(0, h * 0.6, 0, h);
  land.addColorStop(0, css(mix(grass, dry, t.rainfall < 0.2 ? 0.8 : 0.15)));
  land.addColorStop(1, css(mix(grass, [10, 20, 10], 0.35)));
  const shore: number[] = [];
  for (let x = 0; x <= w; x += 2) {
    const k = x / w;
    const edge = wet ? 0.58 + Math.sin(k * 5 + 1) * 0.04 : 1.2;
    const y = k < edge ? h * (0.7 + 0.05 * Math.sin(k * 9 + 2)) : h * (0.7 + (k - edge) * 2.2);
    shore.push(y);
  }
  if (wet) {
    // sand rim just outside the grass
    g.beginPath();
    g.moveTo(0, h);
    shore.forEach((y, i) => g.lineTo(i * 2 + 6, y - 1.5));
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = css(hex(t.sand));
    g.fill();
  }
  fillRidge(g, shore, w, h, land);
  if (t.rainfall < 0.2) {
    // dunes / dry wash texture
    g.strokeStyle = css(hex(t.sand), 0.5);
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = h * (0.78 + i * 0.045);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2);
      g.stroke();
    }
  }

  // trees along the land
  const species = t.trees.length ? t.trees : (['oak'] as TreeSpecies[]);
  const treeCount = Math.round(9 + (1 - Math.min(1, t.rainfall < 0.15 ? 0.7 : 0)) * 10);
  const tc = mix(grass, [20, 60, 30], 0.35);
  const spots: [number, number, number][] = [];
  for (let i = 0; i < treeCount; i++) {
    const x = rnd() * w * (wet ? 0.62 : 1);
    const idx = Math.min(shore.length - 1, Math.round(x / 2));
    const y = shore[idx] + 2 + rnd() * (h - shore[idx]) * 0.7;
    spots.push([x, y, 5 + ((y - h * 0.68) / (h * 0.32)) * 9]);
  }
  spots.sort((a, b) => a[1] - b[1]);
  for (const [x, y, s] of spots) tree(g, species[Math.floor(rnd() * species.length)], x, y, s, tc);

  // a small town cluster on the shore for scale
  const tx0 = w * (wet ? 0.3 : 0.45);
  for (let i = 0; i < 6; i++) {
    const bx = tx0 + i * 7 + rnd() * 3;
    const bh = 5 + rnd() * 12;
    const idx = Math.min(shore.length - 1, Math.round(bx / 2));
    const by = shore[idx] + 3;
    g.fillStyle = css(mix([236, 230, 220], haze, 0.15));
    g.fillRect(bx, by - bh, 5.5, bh);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(bx + 3.5, by - bh, 2, bh);
  }

  // subtle vignette
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0.6, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}
