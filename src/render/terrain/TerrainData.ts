// GPU-side copies of the terrain for per-pixel shading, water depth and overlays.
//
//  visH  (size+1)^2 *rendered* vertex heights: the true heights, except that
//        free shoreline vertices (no road / lot / building next to them) are
//        smoothed so rivers and coasts carved on the cell grid do not show
//        stair-stepped banks. Everything render-core draws uses visH.
//  hTex  RGBA32F (size+1)^2, one texel per terrain vertex (texelFetch only):
//        R = rendered vertex height (m)
//        G = water surface level of the nearest water cell within 8 cells (raw
//            world.water value, flood offset applied in shaders), -1000 = none
//        B = distance to the nearest water cell (m, 0..136, 200 = far)
//        A = moisture 0..1 (forest + fertility + water proximity)
//  nTex  RGBA8 (size+1)^2, linear filtered with mipmaps:
//        RG = world normal x/z (encoded 0..1), B = curvature (0.5 = flat),
//        A = tree canopy density of the adjacent cells (0..1; forests seen from afar)
import * as THREE from 'three';
import { CELL, WATER_EPS } from '../../core/constants';
import type { Rect } from '../../core/types';
import type { World } from '../../world/World';

const MAX_SHORE = 8;
const NO_WATER = -1000;

export class TerrainData {
  readonly n: number;
  readonly hData: Float32Array;
  /** rendered vertex heights (see header) */
  readonly visH: Float32Array;
  readonly nData: Uint8Array;
  readonly hTex: THREE.DataTexture;
  readonly nTex: THREE.DataTexture;
  /** per cell: nearest water level (dilated) and distance in cells (255 = none) */
  private cellLevel: Float32Array;
  private cellDist: Uint8Array;
  minHeight = 0;
  maxHeight = 1;

  constructor(readonly world: World) {
    const n = world.size + 1;
    this.n = n;
    this.hData = new Float32Array(n * n * 4);
    this.visH = new Float32Array(world.heights);
    this.nData = new Uint8Array(n * n * 4);
    this.cellLevel = new Float32Array(world.size * world.size);
    this.cellDist = new Uint8Array(world.size * world.size);
    this.hTex = new THREE.DataTexture(this.hData, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.hTex.magFilter = THREE.NearestFilter;
    this.hTex.minFilter = THREE.NearestFilter;
    this.hTex.generateMipmaps = false;
    this.hTex.colorSpace = THREE.NoColorSpace;
    this.nTex = new THREE.DataTexture(this.nData, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.nTex.magFilter = THREE.LinearFilter;
    this.nTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.nTex.generateMipmaps = true;
    this.nTex.wrapS = this.nTex.wrapT = THREE.ClampToEdgeWrapping;
    this.nTex.colorSpace = THREE.NoColorSpace;
    this.update({ x0: 0, y0: 0, x1: world.size - 1, y1: world.size - 1 }, true);
  }

  /** Recompute everything influenced by changes inside `r` (cell rect). */
  update(r: Rect, full = false): void {
    const w = this.world;
    const s = w.size;
    const pad = MAX_SHORE + 1;
    // 1. water proximity (multi-source BFS over a padded window)
    const wx0 = Math.max(0, r.x0 - pad * 2), wy0 = Math.max(0, r.y0 - pad * 2);
    const wx1 = Math.min(s - 1, r.x1 + pad * 2), wy1 = Math.min(s - 1, r.y1 + pad * 2);
    const ux0 = full ? 0 : Math.max(0, r.x0 - pad), uy0 = full ? 0 : Math.max(0, r.y0 - pad);
    const ux1 = full ? s - 1 : Math.min(s - 1, r.x1 + pad), uy1 = full ? s - 1 : Math.min(s - 1, r.y1 + pad);
    this.waterProximity(wx0, wy0, wx1, wy1, ux0, uy0, ux1, uy1);
    // 2. rendered heights, then per-vertex data for vertices touching the
    //    updated cells (+1 for normals)
    const vx0 = Math.max(0, ux0 - 1), vy0 = Math.max(0, uy0 - 1);
    const vx1 = Math.min(s, ux1 + 2), vy1 = Math.min(s, uy1 + 2);
    this.computeVisual(vx0, vy0, vx1, vy1);
    this.writeVertices(vx0, vy0, vx1, vy1);
    // 3. upload
    if (full) {
      this.hTex.needsUpdate = true;
      this.nTex.needsUpdate = true;
      let mn = Infinity, mx = -Infinity;
      for (const h of this.visH) {
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
      this.minHeight = mn;
      this.maxHeight = Math.max(mx, mn + 1);
    } else {
      const n = this.n;
      for (let vy = vy0; vy <= vy1; vy++) {
        const start = (vy * n + vx0) * 4;
        const count = (vx1 - vx0 + 1) * 4;
        this.hTex.addUpdateRange(start, count);
        this.nTex.addUpdateRange(start, count);
      }
      this.hTex.needsUpdate = true;
      this.nTex.needsUpdate = true;
      for (let vy = vy0; vy <= vy1; vy++)
        for (let vx = vx0; vx <= vx1; vx++) {
          const h = this.visH[vy * n + vx];
          if (h > this.maxHeight) this.maxHeight = h;
          if (h < this.minHeight) this.minHeight = h;
        }
    }
  }

  private waterProximity(wx0: number, wy0: number, wx1: number, wy1: number, ux0: number, uy0: number, ux1: number, uy1: number): void {
    const w = this.world;
    const s = w.size;
    const W = wx1 - wx0 + 1, H = wy1 - wy0 + 1;
    const dist = new Uint8Array(W * H).fill(255);
    const level = new Float32Array(W * H).fill(NO_WATER);
    const queue = new Int32Array(W * H);
    let qh = 0, qt = 0;
    for (let y = wy0; y <= wy1; y++)
      for (let x = wx0; x <= wx1; x++) {
        const i = y * s + x;
        const lv = w.water[i];
        if (lv > w.cellHeight(x, y) + WATER_EPS) {
          const li = (y - wy0) * W + (x - wx0);
          dist[li] = 0;
          level[li] = lv;
          queue[qt++] = li;
        }
      }
    while (qh < qt) {
      const li = queue[qh++];
      const d = dist[li];
      if (d >= MAX_SHORE) continue;
      const lx = li % W, ly = (li / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = lx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = ly + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (dist[ni] <= d + 1) continue;
        dist[ni] = d + 1;
        level[ni] = level[li];
        queue[qt++] = ni;
      }
    }
    for (let y = uy0; y <= uy1; y++)
      for (let x = ux0; x <= ux1; x++) {
        const li = (y - wy0) * W + (x - wx0);
        const i = y * s + x;
        this.cellDist[i] = dist[li];
        this.cellLevel[i] = level[li];
      }
  }

  private writeVertices(vx0: number, vy0: number, vx1: number, vy1: number): void {
    const w = this.world;
    const s = w.size, n = this.n;
    const hd = this.hData, nd = this.nData;
    const heights = this.visH;
    const forest = w.fields.forest, fert = w.fields.fertility;
    const hv = (x: number, y: number) => heights[(y < 0 ? 0 : y > s ? s : y) * n + (x < 0 ? 0 : x > s ? s : x)];
    for (let vy = vy0; vy <= vy1; vy++)
      for (let vx = vx0; vx <= vx1; vx++) {
        const vi = vy * n + vx;
        const h = heights[vi];
        // adjacent cells: nearest water + moisture
        let bestD = 255, bestL = NO_WATER, moist = 0, cnt = 0;
        for (let oy = -1; oy <= 0; oy++)
          for (let ox = -1; ox <= 0; ox++) {
            const cx = vx + ox, cy = vy + oy;
            if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
            const ci = cy * s + cx;
            const d = this.cellDist[ci];
            if (d < bestD || (d === bestD && this.cellLevel[ci] > bestL)) {
              bestD = d;
              bestL = this.cellLevel[ci];
            }
            moist += forest[ci] / 255 * 0.45 + fert[ci] / 255 * 0.35;
            cnt++;
          }
        moist = cnt ? moist / cnt : 0;
        const shoreM = bestD === 255 ? 200 : bestD * CELL;
        if (bestD !== 255) moist += 0.35 * (1 - Math.min(1, bestD / 6));
        const o = vi * 4;
        hd[o] = h;
        hd[o + 1] = bestL;
        hd[o + 2] = shoreM;
        hd[o + 3] = Math.min(1, 0.2 + moist);
        // normal + curvature
        const hl = hv(vx - 1, vy), hr = hv(vx + 1, vy), hu = hv(vx, vy - 1), hdn = hv(vx, vy + 1);
        let nx = (hl - hr) / (2 * CELL), nz = (hu - hdn) / (2 * CELL);
        const inv = 1 / Math.sqrt(nx * nx + nz * nz + 1);
        nx *= inv;
        nz *= inv;
        const lap = (hl + hr + hu + hdn - 4 * h) / (CELL * CELL);
        nd[o] = Math.round((nx * 0.5 + 0.5) * 255);
        nd[o + 1] = Math.round((nz * 0.5 + 0.5) * 255);
        nd[o + 2] = Math.max(0, Math.min(255, Math.round((0.5 + lap * 6) * 255)));
        nd[o + 3] = this.canopyAt(vx, vy);
      }
  }

  /**
   * Recompute rendered heights for vertices in [vx0..vx1]×[vy0..vy1].
   * Shoreline vertices (touching both wet and dry cells) take a 5×5 binomial
   * blur of the true heights, their neighbours half of it, so the waterline
   * follows a smooth curve instead of the cell staircase. Vertices next to a
   * road, zoned lot or building keep their true height (things sit on them).
   * Returns true when any rendered height changed.
   */
  private computeVisual(vx0: number, vy0: number, vx1: number, vy1: number): boolean {
    const w = this.world;
    const s = w.size, n = this.n;
    const H = w.heights, V = this.visH;
    // shoreline classification over the window + 1 (neighbour weights)
    const ax0 = Math.max(0, vx0 - 1), ay0 = Math.max(0, vy0 - 1), ax1 = Math.min(s, vx1 + 1), ay1 = Math.min(s, vy1 + 1);
    const AW = ax1 - ax0 + 1;
    const shore = new Uint8Array(AW * (ay1 - ay0 + 1));
    const wetCell = (x: number, y: number) => x >= 0 && y >= 0 && x < s && y < s && this.cellDist[y * s + x] === 0;
    for (let vy = ay0; vy <= ay1; vy++)
      for (let vx = ax0; vx <= ax1; vx++) {
        let wet = 0, dry = 0;
        for (let q = 0; q < 4; q++) {
          const cx = vx - 1 + (q & 1), cy = vy - 1 + (q >> 1);
          if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
          if (wetCell(cx, cy)) wet++;
          else dry++;
        }
        if (wet && dry) shore[(vy - ay0) * AW + (vx - ax0)] = 1;
      }
    const K = [1, 4, 6, 4, 1];
    let changed = false;
    for (let vy = vy0; vy <= vy1; vy++)
      for (let vx = vx0; vx <= vx1; vx++) {
        const vi = vy * n + vx;
        let wgt = 0;
        if (shore[(vy - ay0) * AW + (vx - ax0)]) wgt = 1;
        else {
          for (let oy = -1; oy <= 1 && !wgt; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const xx = vx + ox, yy = vy + oy;
              if (xx < ax0 || yy < ay0 || xx > ax1 || yy > ay1) continue;
              if (shore[(yy - ay0) * AW + (xx - ax0)]) { wgt = 0.5; break; }
            }
        }
        if (wgt > 0) {
          // anything built on the adjacent cells pins the vertex
          for (let q = 0; q < 4 && wgt > 0; q++) {
            const cx = vx - 1 + (q & 1), cy = vy - 1 + (q >> 1);
            if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
            const ci = cy * s + cx;
            if (w.road[ci] || w.bldg[ci] || w.zone[ci]) wgt = 0;
          }
        }
        let h = H[vi];
        if (wgt > 0) {
          let sum = 0, ws = 0;
          for (let oy = -2; oy <= 2; oy++) {
            const yy = vy + oy;
            if (yy < 0 || yy > s) continue;
            for (let ox = -2; ox <= 2; ox++) {
              const xx = vx + ox;
              if (xx < 0 || xx > s) continue;
              const k = K[ox + 2] * K[oy + 2];
              sum += H[yy * n + xx] * k;
              ws += k;
            }
          }
          h += (sum / ws - h) * wgt;
        }
        if (V[vi] !== h) {
          V[vi] = h;
          changed = true;
        }
      }
    return changed;
  }

  /**
   * Roads, lots or buildings changed inside `r`: re-pin / release shoreline
   * vertices. Returns the vertex rect whose rendered heights changed, or null.
   */
  refreshVisual(r: Rect): Rect | null {
    const s = this.world.size;
    const vx0 = Math.max(0, r.x0 - 1), vy0 = Math.max(0, r.y0 - 1);
    const vx1 = Math.min(s, r.x1 + 2), vy1 = Math.min(s, r.y1 + 2);
    if (!this.computeVisual(vx0, vy0, vx1, vy1)) return null;
    const wx0 = Math.max(0, vx0 - 1), wy0 = Math.max(0, vy0 - 1), wx1 = Math.min(s, vx1 + 1), wy1 = Math.min(s, vy1 + 1);
    this.writeVertices(wx0, wy0, wx1, wy1);
    const n = this.n;
    for (let vy = wy0; vy <= wy1; vy++) {
      const start = (vy * n + wx0) * 4, count = (wx1 - wx0 + 1) * 4;
      this.hTex.addUpdateRange(start, count);
      this.nTex.addUpdateRange(start, count);
    }
    this.hTex.needsUpdate = true;
    this.nTex.needsUpdate = true;
    return { x0: wx0, y0: wy0, x1: Math.min(s - 1, wx1), y1: Math.min(s - 1, wy1) };
  }

  /** rendered terrain height at world meters (bilinear over visH) */
  heightAt(wx: number, wz: number): number {
    const s = this.world.size, n = this.n;
    const fx = Math.min(s, Math.max(0, wx / CELL)), fz = Math.min(s, Math.max(0, wz / CELL));
    const x = Math.min(s - 1, Math.floor(fx)), z = Math.min(s - 1, Math.floor(fz));
    const tx = fx - x, tz = fz - z;
    const V = this.visH;
    const h00 = V[z * n + x], h10 = V[z * n + x + 1], h01 = V[(z + 1) * n + x], h11 = V[(z + 1) * n + x + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** mean tree density (0..255) of the up to 4 cells touching vertex (vx, vy) */
  private canopyAt(vx: number, vy: number): number {
    const w = this.world;
    const s = w.size;
    let sum = 0, cnt = 0;
    for (let oy = -1; oy <= 0; oy++)
      for (let ox = -1; ox <= 0; ox++) {
        const cx = vx + ox, cy = vy + oy;
        if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
        sum += w.trees[cy * s + cx];
        cnt++;
      }
    return cnt ? Math.round((sum / cnt / 3) * 255) : 0;
  }

  /** refresh only the canopy channel after tree edits inside `r` (cell rect) */
  updateCanopy(r: Rect): void {
    const s = this.world.size, n = this.n;
    const vx0 = Math.max(0, r.x0), vy0 = Math.max(0, r.y0);
    const vx1 = Math.min(s, r.x1 + 1), vy1 = Math.min(s, r.y1 + 1);
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) this.nData[(vy * n + vx) * 4 + 3] = this.canopyAt(vx, vy);
      this.nTex.addUpdateRange((vy * n + vx0) * 4, (vx1 - vx0 + 1) * 4);
    }
    this.nTex.needsUpdate = true;
  }

  dispose(): void {
    this.hTex.dispose();
    this.nTex.dispose();
  }
}

/** GLSL: manual bilinear lookup into hTex (needs uHTex, uMapCells, uSeaLevel, uFlood). */
export const TERRAIN_SAMPLE_GLSL = /* glsl */ `
uniform highp sampler2D uHTex;
uniform float uMapCells;
uniform float uSeaLevel;
uniform float uFlood;
vec4 hFetch(ivec2 p) {
  int m = int(uMapCells);
  return texelFetch(uHTex, clamp(p, ivec2(0), ivec2(m)), 0);
}
// returns (height, waterLevel, shoreDist, moisture); water level uses the
// nearest valid texel at the fringe and includes the flood offset for sea water
vec4 hSample(vec2 wxz) {
  vec2 g = clamp(wxz / ${CELL.toFixed(1)}, vec2(0.0), vec2(uMapCells));
  vec2 i = min(floor(g), vec2(uMapCells - 1.0));
  vec2 f = g - i;
  ivec2 ii = ivec2(i);
  vec4 a = hFetch(ii), b = hFetch(ii + ivec2(1, 0)), c = hFetch(ii + ivec2(0, 1)), d = hFetch(ii + ivec2(1, 1));
  vec4 r = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  float mn = min(min(a.g, b.g), min(c.g, d.g));
  if (mn < -500.0) r.g = max(max(a.g, b.g), max(c.g, d.g));
  if (abs(r.g - uSeaLevel) < 0.05) r.g += uFlood;
  return r;
}
`;
