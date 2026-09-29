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
  /** prefix sums along each edge (4 × (size+1)) of sea flag and edge height */
  private seaPS: Float64Array;
  private hPS: Float64Array;
  private amp: number;
  private ridged: boolean;

  constructor(readonly world: World) {
    this.S = world.size * CELL;
    this.extent = Math.max(15000, this.S * 1.8);
    this.noise = new Noise((world.settings.seed ^ 0x51f15e) >>> 0);
    const t = world.theme;
    this.amp = 30 + t.mountainousness * 380 * (0.5 + world.settings.mountains);
    this.ridged = t.id === 'alpine' || t.id === 'boreal' || t.mountainousness > 0.55;
    const s = world.size;
    this.seaPS = new Float64Array(4 * (s + 1));
    this.hPS = new Float64Array(4 * (s + 1));
    this.computeEdges();
  }

  /** recompute border statistics (after terrain/water edits on the border) */
  computeEdges(): void {
    const w = this.world;
    const s = w.size;
    for (let e = 0; e < 4; e++) {
      let a = 0, b = 0;
      const base = e * (s + 1);
      this.seaPS[base] = 0;
      this.hPS[base] = 0;
      for (let i = 0; i < s; i++) {
        const [x, y] = e === 0 ? [i, 0] : e === 1 ? [s - 1, i] : e === 2 ? [i, s - 1] : [0, i];
        const wet = w.isWater(x, y);
        const sea = wet && Math.abs(w.water[w.idx(x, y)] - w.seaLevel) < 0.05 ? 1 : 0;
        a += sea;
        b += wet ? Math.min(w.waterLevel(x, y), w.cellHeight(x, y)) : w.cellHeight(x, y);
        this.seaPS[base + i + 1] = a;
        this.hPS[base + i + 1] = b;
      }
    }
  }

  /** mean of an edge profile around border index i (half-width hw cells) */
  private edgeMean(ps: Float64Array, e: number, i: number, hw: number): number {
    const s = this.world.size;
    const lo = Math.max(0, Math.min(s - 1, Math.floor(i - hw)));
    const hi = Math.max(lo + 1, Math.min(s, Math.ceil(i + hw)));
    const base = e * (s + 1);
    return (ps[base + hi] - ps[base + lo]) / (hi - lo);
  }

  /** edge profile sampled beyond the map: widening average, corners blend both edges */
  private edgeSample(ps: Float64Array, ex: number, ez: number, x: number, z: number, hw: number): number {
    const S = this.S;
    const ix = ex / CELL, iz = ez / CELL;
    const dxo = x < 0 ? -x : x > S ? x - S : 0;
    const dzo = z < 0 ? -z : z > S ? z - S : 0;
    const ex0 = x < S / 2 ? 3 : 1; // west / east edge
    const ez0 = z < S / 2 ? 0 : 2; // north / south edge
    const vx = this.edgeMean(ps, ex0, iz, hw);
    const vz = this.edgeMean(ps, ez0, ix, hw);
    // weight each edge by how much the point lies beyond it (inside map: nearest edge)
    let wx: number, wz: number;
    if (dxo > 0 || dzo > 0) {
      wx = dxo;
      wz = dzo;
    } else {
      const mx = Math.min(ex, S - ex), mz = Math.min(ez, S - ez);
      wx = mx <= mz ? 1 : 0;
      wz = 1 - wx;
    }
    const sum = wx + wz || 1;
    return (vx * wx + vz * wz) / sum;
  }

  /**
   * Band-limited fbm: octaves whose wavelength (m) falls below `minWave` fade
   * out, so detail never exceeds what the ring's row spacing can represent
   * (otherwise sharp ridges alias into radial streaks).
   */
  private fbm(x: number, z: number, wavelength: number, oct: number, minWave: number): number {
    let a = 0.5, f = 1 / wavelength, lambda = wavelength, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      const keep = Math.min(1, Math.max(0, (lambda - minWave) / minWave));
      if (keep <= 0 && o > 0) break;
      let n = this.noise.noise2(x * f, z * f);
      if (this.ridged) n = 1 - Math.abs(n) * 2;
      const wgt = a * (o === 0 ? 1 : keep);
      sum += n * wgt;
      norm += wgt;
      a *= 0.5;
      f *= 2.03;
      lambda /= 2.03;
    }
    return sum / norm;
  }

  /** radial spacing of the ring rows at distance d beyond the border (m) */
  static rowSpacing(d: number): number {
    return 32 + d * 0.12;
  }

  /** terrain height at world (x, z) outside (or on) the map */
  height(x: number, z: number): number {
    const S = this.S;
    const ex = Math.min(S, Math.max(0, x)), ez = Math.min(S, Math.max(0, z));
    const d = Math.hypot(x - ex, z - ez);
    const w = this.world;
    if (d < 1) return w.heightAt(ex, ez);
    const dc = d / CELL;
    const near = Math.exp(-d / 420);
    // narrow profile near the border (ridges and valleys carry on), widening outward
    const hEdge = this.edgeSample(this.hPS, ex, ez, x, z, 1.5 + dc * 0.45) * (1 - near) + w.heightAt(ex, ez) * near;
    const t = Math.min(1, d / 2600);
    const blend = t * t * (3 - 2 * t);
    // far out the land settles on a broad regional level (no extruded border features)
    const tw = Math.min(1, d / 5000);
    const regional = this.edgeSample(this.hPS, ex, ez, x, z, 48 + dc * 0.9);
    const base = hEdge + (regional - hEdge) * tw * tw * (3 - 2 * tw);
    let sea = this.edgeSample(this.seaPS, ex, ez, x, z, 4 + dc * 0.6);
    sea += this.noise.noise2(x / 2300 + 11.3, z / 2300 - 7.1) * 0.55 * blend;
    sea = Math.min(1, Math.max(0, (sea - 0.3) / 0.4));
    sea = sea * sea * (3 - 2 * sea);
    const hillsBase = Math.max(base, w.seaLevel + 3);
    const rise = Math.min(1, d / 3200);
    const minWave = FarLand.rowSpacing(d) * 2.5;
    const hills = hillsBase + (this.fbm(x, z, 4200, 5, minWave) * 0.5 + 0.35) * this.amp * rise + this.fbm(x, z, 900, 3, minWave) * 12 * blend;
    const ocean = w.seaLevel - 6 - 34 * blend - this.fbm(x, z, 3000, 2, minWave) * 8;
    const target = hills * (1 - sea) + ocean * sea;
    return base * (1 - blend) + target * blend;
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
    // geometric rows: dense near the border, ~12 % of the distance far out
    const outer: number[] = [0];
    for (let d = 0; ; ) {
      d += FarLand.rowSpacing(d);
      if (d >= E * 0.97) break;
      outer.push(Math.round(d));
    }
    outer.push(E);
    const axis: number[] = [];
    for (let i = outer.length - 1; i > 0; i--) axis.push(-outer[i]);
    // fine spacing along the border so the ring's first row follows the map edge
    const inner = CELL * 2;
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
        // vertices strictly inside the map are never referenced by a ring quad
        pos[o + 1] = x > 0 && z > 0 && x < S && z < S ? 0 : this.height(x, z);
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
