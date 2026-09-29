// The land (or sea) beyond the playable map: a coarse, fog-faded ring that
// continues the map's edge heights outward into procedural hills or ocean
// floor, so the world never ends at a cliff.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import { Noise } from '../../core/noise';
import type { World } from '../../world/World';

/** Heights beyond the map edge; also sampled into a texture for ocean depth. */
export class FarLand {
  readonly S: number;
  readonly extent: number;
  private noise: Noise;
  /** per border cell (4 edges × size): 0 = land, 1 = sea, smoothed */
  private seaEdge: Float32Array;
  private edgeH: Float32Array;
  private amp: number;
  private ridged: boolean;

  constructor(readonly world: World) {
    this.S = world.size * CELL;
    this.extent = Math.max(15000, this.S * 1.8);
    this.noise = new Noise((world.settings.seed ^ 0x51f15e) >>> 0);
    const t = world.theme;
    this.amp = 30 + t.mountainousness * 320 * (0.5 + world.settings.mountains);
    this.ridged = t.id === 'alpine' || t.id === 'boreal' || t.mountainousness > 0.55;
    const s = world.size;
    this.seaEdge = new Float32Array(4 * s);
    this.edgeH = new Float32Array(4 * s);
    this.computeEdges();
  }

  /** recompute border statistics (after terrain/water edits on the border) */
  computeEdges(): void {
    const w = this.world;
    const s = w.size;
    const raw = new Float32Array(4 * s);
    const hraw = new Float32Array(4 * s);
    for (let e = 0; e < 4; e++)
      for (let i = 0; i < s; i++) {
        const [x, y] = e === 0 ? [i, 0] : e === 1 ? [s - 1, i] : e === 2 ? [i, s - 1] : [0, i];
        const lv = w.waterLevel(x, y);
        const sea = w.isWater(x, y) && Math.abs(w.water[w.idx(x, y)] - w.seaLevel) < 0.05 ? 1 : 0;
        raw[e * s + i] = sea;
        hraw[e * s + i] = w.isWater(x, y) ? Math.min(lv, w.cellHeight(x, y)) : w.cellHeight(x, y);
      }
    const R = 8;
    for (let e = 0; e < 4; e++)
      for (let i = 0; i < s; i++) {
        let a = 0, b = 0, n = 0;
        for (let k = -R; k <= R; k++) {
          const j = Math.min(s - 1, Math.max(0, i + k));
          a += raw[e * s + j];
          b += hraw[e * s + j];
          n++;
        }
        this.seaEdge[e * s + i] = a / n;
        this.edgeH[e * s + i] = b / n;
      }
  }

  private edgeSample(arr: Float32Array, ex: number, ez: number): number {
    // blend the (up to two) nearest edges at corners
    const s = this.world.size;
    const cx = Math.min(s - 1, Math.max(0, Math.floor(ex / CELL)));
    const cz = Math.min(s - 1, Math.max(0, Math.floor(ez / CELL)));
    const dl = ex, dr = this.S - ex, dt = ez, db = this.S - ez;
    const m = Math.min(dl, dr, dt, db);
    if (m === dt) return arr[0 * s + cx];
    if (m === dr) return arr[1 * s + cz];
    if (m === db) return arr[2 * s + cx];
    return arr[3 * s + cz];
  }

  private fbm(x: number, z: number, oct: number): number {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      let n = this.noise.noise2(x * f, z * f);
      if (this.ridged) n = 1 - Math.abs(n) * 2;
      sum += n * a;
      norm += a;
      a *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }

  /** terrain height at world (x, z) outside (or on) the map */
  height(x: number, z: number): number {
    const S = this.S;
    const ex = Math.min(S, Math.max(0, x)), ez = Math.min(S, Math.max(0, z));
    const d = Math.hypot(x - ex, z - ez);
    const w = this.world;
    const hEdge = d < 1 ? w.heightAt(ex, ez) : this.edgeSample(this.edgeH, ex, ez) * 0.6 + w.heightAt(ex, ez) * 0.4;
    if (d < 1) return hEdge;
    const t = Math.min(1, d / 2600);
    const blend = t * t * (3 - 2 * t);
    let sea = this.edgeSample(this.seaEdge, ex, ez);
    sea += this.noise.noise2(x / 2300 + 11.3, z / 2300 - 7.1) * 0.55 * blend;
    sea = Math.min(1, Math.max(0, (sea - 0.3) / 0.4));
    sea = sea * sea * (3 - 2 * sea);
    const hillsBase = Math.max(hEdge, w.seaLevel + 3);
    const rise = Math.min(1, d / 5000);
    const hills = hillsBase + (this.fbm(x / 4200, z / 4200, 5) * 0.5 + 0.35) * this.amp * rise + this.fbm(x / 900, z / 900, 3) * 12 * blend;
    const ocean = w.seaLevel - 6 - 34 * blend - this.fbm(x / 3000, z / 3000, 2) * 8;
    const target = hills * (1 - sea) + ocean * sea;
    return hEdge * (1 - blend) + target * blend;
  }

  /** Coarse height texture over [-extent, S+extent]^2 (R = height) for water depth. */
  createHeightTexture(res = 128): { tex: THREE.DataTexture; origin: number; span: number } {
    const E = this.extent, S = this.S;
    const span = S + 2 * E;
    const data = new Float32Array(res * res * 4);
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const x = -E + (i / (res - 1)) * span, z = -E + (j / (res - 1)) * span;
        const o = (j * res + i) * 4;
        data[o] = this.height(x, z);
        data[o + 1] = data[o + 2] = 0;
        data[o + 3] = 1;
      }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { tex, origin: -E, span };
  }

  /** Build the ring mesh geometry (the map interior is left open). */
  buildGeometry(): THREE.BufferGeometry {
    const S = this.S, E = this.extent;
    const steps = [0, 48, 112, 208, 352, 560, 860, 1280, 1850, 2600, 3600, 4900, 6600, 8800, 11500];
    const outer: number[] = [];
    for (const v of steps) if (v < E) outer.push(v);
    outer.push(E);
    const axis: number[] = [];
    for (let i = outer.length - 1; i > 0; i--) axis.push(-outer[i]);
    const inner = 128;
    for (let v = 0; v < S; v += inner) axis.push(v);
    axis.push(S);
    for (let i = 1; i < outer.length; i++) axis.push(S + outer[i]);
    const n = axis.length;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = axis[i], z = axis[j];
        const o = (j * n + i) * 3;
        pos[o] = x;
        pos[o + 1] = this.height(x, z);
        pos[o + 2] = z;
      }
    const idx: number[] = [];
    const eps = 0.5;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const x0 = axis[i], x1 = axis[i + 1], z0 = axis[j], z1 = axis[j + 1];
        if (x0 >= -eps && x1 <= S + eps && z0 >= -eps && z1 <= S + eps) continue; // map interior
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
