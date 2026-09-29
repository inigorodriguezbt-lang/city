// Runtime-generated tileable textures (no external assets). All noise here is
// periodic so the textures repeat seamlessly at any world scale.
import * as THREE from 'three';
import { RNG } from '../../core/rng';

/** 8 unit gradient directions for 2D gradient noise */
const GX = new Float32Array([1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

/** Periodic 2D gradient noise generator (Perlin-style, lattice wraps every `period`). */
export class TileNoise {
  private perm: Uint16Array;
  constructor(seed: number) {
    const rng = new RNG(seed);
    const p = new Uint16Array(1024);
    for (let i = 0; i < 1024; i++) p[i] = i;
    for (let i = 1023; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint16Array(2048);
    for (let i = 0; i < 2048; i++) this.perm[i] = p[i & 1023];
  }

  private grad(ix: number, iy: number, x: number, y: number): number {
    const h = this.perm[this.perm[ix & 1023] + (iy & 1023)] & 7;
    return GX[h] * x + GY[h] * y;
  }

  /** gradient noise in ~[-1,1], periodic with integer `period` */
  noise(x: number, y: number, period: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = this.grad(x0, y0, xf, yf);
    const n10 = this.grad(x1, y0, xf - 1, yf);
    const n01 = this.grad(x0, y1, xf, yf - 1);
    const n11 = this.grad(x1, y1, xf - 1, yf - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  }

  /** periodic fbm; (x, y) in [0,1) tile space, base period in lattice cells */
  fbm(x: number, y: number, period: number, octaves: number, gain = 0.5): number {
    let amp = 1, sum = 0, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * p, y * p, p);
      norm += amp;
      amp *= gain;
      p *= 2;
    }
    return sum / norm;
  }

  /** periodic ridged fbm in [0,1] */
  ridged(x: number, y: number, period: number, octaves: number): number {
    let amp = 0.5, sum = 0, norm = 0, p = period, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise(x * p, y * p, p));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n;
      amp *= 0.5;
      p *= 2;
    }
    return sum / norm;
  }

  /** periodic cellular (Worley F1) noise in [0,1] with `cells` cells per tile */
  worley(x: number, y: number, cells: number, seed = 0): number {
    const fx = x * cells, fy = y * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let best = 9;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
        const h = this.perm[(this.perm[(wx + seed) & 1023] + wy) & 2047];
        const h2 = this.perm[(h + 37) & 2047];
        const px = cx + (h & 1023) / 1023, py = cy + (h2 & 1023) / 1023;
        const d = (px - fx) * (px - fx) + (py - fy) * (py - fy);
        if (d < best) best = d;
      }
    return Math.min(1, Math.sqrt(best));
  }
}

function finishTexture(tex: THREE.DataTexture, srgb = false): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const to8 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/**
 * Multi-purpose tileable noise (256²):
 *  R = low-frequency fbm (macro patches), G = mid fbm, B = ridged/cellular mix, A = fine fbm.
 */
export function createNoiseTexture(size = 256, seed = 1337): THREE.DataTexture {
  const n1 = new TileNoise(seed), n2 = new TileNoise(seed + 17), n3 = new TileNoise(seed + 71);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = (y * size + x) * 4;
      data[i] = to8(n1.fbm(u, v, 4, 5) * 0.62 + 0.5);
      data[i + 1] = to8(n2.fbm(u, v, 8, 4) * 0.62 + 0.5);
      data[i + 2] = to8(n3.ridged(u, v, 6, 4) * 0.7 + (1 - n3.worley(u, v, 12)) * 0.3);
      data[i + 3] = to8(n1.fbm(u + 0.37, v + 0.71, 32, 3) * 0.62 + 0.5);
    }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType));
}

/** Build a tangent-space normal map (RGB) + height (A) from a periodic height function. */
function normalMapFromHeight(size: number, height: Float32Array, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  let hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < height.length; i++) {
    if (height[i] < hmin) hmin = height[i];
    if (height[i] > hmax) hmax = height[i];
  }
  const hr = hmax - hmin || 1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      data[i] = to8(-dx * inv * 0.5 + 0.5);
      data[i + 1] = to8(-dy * inv * 0.5 + 0.5);
      data[i + 2] = to8(inv * 0.5 + 0.5);
      data[i + 3] = to8((at(x, y) - hmin) / hr);
    }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType));
}

/** Tileable water wave normal map: sum of fbm + a few periodic directional swells. */
export function createWaterNormalTexture(size = 256, seed = 4242): THREE.DataTexture {
  const n = new TileNoise(seed);
  const h = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // periodic directional waves (integer wave numbers keep them tileable)
      let s = 0.35 * Math.sin(TAU * (3 * u + 2 * v) + 1.3 * n.noise(u * 4, v * 4, 4));
      s += 0.22 * Math.sin(TAU * (-2 * u + 5 * v) + 0.9);
      s += 0.14 * Math.sin(TAU * (7 * u + 3 * v) + 2.1 * n.noise(u * 8, v * 8, 8));
      s += 0.9 * n.fbm(u, v, 8, 5, 0.55);
      h[y * size + x] = s;
    }
  return normalMapFromHeight(size, h, size / 48);
}

/** Tileable terrain micro-detail normal map (soil clods, grass tufts, rock grain). */
export function createDetailNormalTexture(size = 256, seed = 9001): THREE.DataTexture {
  const n = new TileNoise(seed);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = n.fbm(u, v, 16, 4, 0.55) * 0.7 + n.ridged(u, v, 8, 3) * 0.5 - n.worley(u, v, 24) * 0.25;
    }
  return normalMapFromHeight(size, h, size / 40);
}

/** Linear-space gradient ramp texture (width×1) from hex color stops. */
export function createRampTexture(stops: string[], width = 256): THREE.DataTexture {
  const data = new Uint8Array(width * 4);
  const cols = stops.map((s) => new THREE.Color(s));
  const tmp = new THREE.Color();
  for (let i = 0; i < width; i++) {
    const t = (i / (width - 1)) * (cols.length - 1);
    const a = Math.min(cols.length - 1, Math.floor(t));
    const b = Math.min(cols.length - 1, a + 1);
    tmp.copy(cols[a]).lerp(cols[b], t - a);
    // store sRGB-encoded bytes; texture is flagged sRGB so the GPU linearizes
    const c = tmp.clone().convertLinearToSRGB();
    data[i * 4] = to8(c.r);
    data[i * 4 + 1] = to8(c.g);
    data[i * 4 + 2] = to8(c.b);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Shared procedural texture set, created once per renderer. */
export interface TextureSet {
  noise: THREE.DataTexture;
  waterNormal: THREE.DataTexture;
  detailNormal: THREE.DataTexture;
  dispose(): void;
}

export function createTextureSet(): TextureSet {
  const noise = createNoiseTexture();
  const waterNormal = createWaterNormalTexture();
  const detailNormal = createDetailNormalTexture();
  return {
    noise,
    waterNormal,
    detailNormal,
    dispose() {
      noise.dispose();
      waterNormal.dispose();
      detailNormal.dispose();
    },
  };
}
