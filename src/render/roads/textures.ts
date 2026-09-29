// Procedural road textures, generated once per page and shared by every road
// chunk. Two tileable RGBA data textures:
//
//  detail (1024², tiles every DETAIL_TILE m)
//    R  asphalt grain: fine fbm + bright/dark aggregate speckles
//    G  pebbles: worley stones (gravel roads, rail ballast)
//    B  pavers: running-bond setts, per-stone tone, dark joints (0 = joint)
//    A  concrete: low-contrast mottling with pores
//
//  macro (512², tiles every MACRO_TILE m)
//    R  large-scale tone / wear variation
//    G  repair patches (1 inside a patched rectangle)
//    B  crack network (1 = crack)
//    A  puddle / dampness mask (low areas)
import * as THREE from 'three';
import { hash2, hash3 } from '../../core/rng';

export const DETAIL_TILE = 4;
export const MACRO_TILE = 64;

let cached: { detail: THREE.DataTexture; macro: THREE.DataTexture } | null = null;

/** Shared road textures (created on first use). */
export function roadTextures(): { detail: THREE.DataTexture; macro: THREE.DataTexture } {
  if (!cached) cached = { detail: makeDetail(1024), macro: makeMacro(1024) };
  return cached;
}

// ── tileable value noise ────────────────────────────────────────────────────
class TileNoise {
  private lat: Float32Array;
  constructor(readonly period: number, seed: number) {
    this.lat = new Float32Array(period * period);
    for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) this.lat[j * period + i] = hash3(i, j, seed) / 4294967296;
  }
  /** u, v in lattice units (wraps every `period`) */
  at(u: number, v: number): number {
    const p = this.period;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    let fx = u - i0, fy = v - j0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = ((i0 % p) + p) % p, b = ((j0 % p) + p) % p;
    const a1 = (a + 1) % p, b1 = (b + 1) % p;
    const L = this.lat;
    const v00 = L[b * p + a], v10 = L[b * p + a1], v01 = L[b1 * p + a], v11 = L[b1 * p + a1];
    return (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy;
  }
}

/** fbm over tileable octaves; x, y in [0,1) texture space. Returns ~[0,1]. */
function makeFbm(basePeriod: number, octaves: number, seed: number): (x: number, y: number) => number {
  const layers: TileNoise[] = [];
  for (let o = 0; o < octaves; o++) layers.push(new TileNoise(basePeriod << o, seed + o * 101));
  return (x, y) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = layers[o];
      s += n.at(x * n.period, y * n.period) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
}

/** tileable worley: returns [F1, F2, id] with distances in cell units */
function makeWorley(cells: number, seed: number): (x: number, y: number, out: Float32Array) => void {
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      px[j * cells + i] = 0.15 + 0.7 * (hash3(i, j, seed) / 4294967296);
      py[j * cells + i] = 0.15 + 0.7 * (hash3(i, j, seed + 7) / 4294967296);
    }
  return (x, y, out) => {
    const u = x * cells, v = y * cells;
    const ci = Math.floor(u), cj = Math.floor(v);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const gi = ci + di, gj = cj + dj;
        const wi = ((gi % cells) + cells) % cells, wj = ((gj % cells) + cells) % cells;
        const k = wj * cells + wi;
        const dx = gi + px[k] - u, dy = gj + py[k] - v;
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = k;
        } else if (d < f2) f2 = d;
      }
    out[0] = Math.sqrt(f1);
    out[1] = Math.sqrt(f2);
    out[2] = id;
  };
}

function finish(tex: THREE.DataTexture, aniso: number): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 1 ? 255 : (v * 255) | 0);

function makeDetail(N: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const grainA = makeFbm(64, 4, 11); // ~6 cm features, down to ~8 mm
  const grainB = makeFbm(256, 2, 23); // very fine
  const mottle = makeFbm(8, 4, 37); // concrete mottling
  const pores = makeFbm(256, 1, 41);
  const stones = makeWorley(150, 53); // ~2.7 cm pebbles
  const stoneTone = makeFbm(32, 3, 59);
  const w = new Float32Array(3);
  // pavers: running bond, 0.2 m × 0.1 m in a 4 m tile → 20 × 40 setts
  const PX = 20, PY = 40;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const o = (y * N + x) * 4;
      // R: asphalt grain
      const h = hash2(x * 7 + 3, y * 13 + 5) / 4294967296;
      let g = 0.42 + (grainA(u, v) - 0.5) * 0.55 + (grainB(u, v) - 0.5) * 0.35;
      if (h > 0.985) g += 0.42; // quartz chips
      else if (h < 0.02) g -= 0.25; // voids
      data[o] = clamp255(g);
      // G: pebbles
      stones(u, v, w);
      const edge = Math.min(1, (w[1] - w[0]) * 6.5);
      const tone = 0.35 + (hash2(w[2] | 0, 991) / 4294967296) * 0.45 + (stoneTone(u, v) - 0.5) * 0.3;
      const dome = 1 - Math.min(1, w[0] * 1.6) * 0.35;
      data[o + 1] = clamp255(edge < 0.18 ? 0.08 + edge * 0.6 : tone * dome * (0.75 + 0.25 * edge));
      // B: pavers
      const pyf = v * PY;
      const row = Math.floor(pyf);
      const pxf = u * PX + (row & 1) * 0.5;
      const col = Math.floor(pxf);
      const fx = pxf - col, fy = pyf - row;
      const jx = Math.min(fx, 1 - fx) * 0.2, jy = Math.min(fy, 1 - fy) * 0.1; // meters to joint
      const dj = Math.min(jx, jy);
      const st = 0.45 + (hash3(((col % PX) + PX) % PX, row % PY, 77) / 4294967296) * 0.4;
      const bevel = Math.min(1, dj / 0.012);
      const pv = dj < 0.005 ? 0.04 : st * (0.55 + 0.45 * bevel) + (grainA(u, v) - 0.5) * 0.18;
      data[o + 2] = clamp255(pv);
      // A: concrete
      const c = 0.55 + (mottle(u, v) - 0.5) * 0.45 + (grainB(u, v) - 0.5) * 0.18 - (pores(u, v) > 0.8 ? 0.2 : 0);
      data[o + 3] = clamp255(c);
    }
  }
  return finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat), 8);
}

function makeMacro(N: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const tone = makeFbm(4, 5, 101);
  const damp = makeFbm(8, 4, 131);
  const crackW = makeWorley(22, 151);
  const crackN = makeFbm(16, 3, 171);
  const w = new Float32Array(3);
  // repair patches: random axis-aligned rectangles rasterized into a mask (wraps)
  const patch = new Uint8Array(N * N);
  for (let k = 0; k < 46; k++) {
    const cx = (hash2(k, 1) / 4294967296) * N, cy = (hash2(k, 2) / 4294967296) * N;
    const long = 1.5 + (hash2(k, 3) / 4294967296) * 6; // meters
    const short = 1.1 + (hash2(k, 4) / 4294967296) * 2.2;
    const horiz = (hash2(k, 5) & 1) === 0;
    const hx = (((horiz ? long : short) / MACRO_TILE) * N) / 2, hy = (((horiz ? short : long) / MACRO_TILE) * N) / 2;
    for (let y = Math.floor(cy - hy - 2); y <= cy + hy + 2; y++)
      for (let x = Math.floor(cx - hx - 2); x <= cx + hx + 2; x++) {
        const j = (crackN(x / N * 5, y / N * 5) - 0.5) * 3; // ragged edges (px)
        if (Math.abs(x - cx) > hx + j || Math.abs(y - cy) > hy + j) continue;
        patch[(((y % N) + N) % N) * N + (((x % N) + N) % N)] = 1;
      }
  }
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const o = (y * N + x) * 4;
      data[o] = clamp255(0.5 + (tone(u, v) - 0.5) * 1.6);
      data[o + 1] = patch[y * N + x] ? 255 : 0;
      crackW(u, v, w);
      const lineD = w[1] - w[0];
      const mask = crackN(u, v);
      const crack = lineD < 0.012 && mask > 0.56 ? 1 - lineD / 0.012 : 0;
      data[o + 2] = clamp255(crack);
      data[o + 3] = clamp255(0.5 + (damp(u, v) - 0.5) * 2.2);
    }
  }
  return finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat), 4);
}
