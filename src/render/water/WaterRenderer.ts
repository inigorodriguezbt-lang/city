// Water surfaces: one sea plane at sea level (+ flood offset) that extends to
// the horizon (the shader discards it inland), plus per-chunk meshes for
// lakes and rivers at their own (possibly descending) levels.
import * as THREE from 'three';
import { CELL, CHUNK, WATER_EPS } from '../../core/constants';
import { ChunkGrid } from '../../core/chunks';
import { Layer, type Rect } from '../../core/types';
import type { World } from '../../world/World';
import type { SharedUniforms } from '../sky/SharedUniforms';
import type { TerrainRenderer } from '../terrain/TerrainRenderer';
import { createWaterMaterial, createWaterUniforms, type WaterUniforms } from './waterMaterial';

export class WaterRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: WaterUniforms;
  readonly seaMaterial: THREE.MeshStandardMaterial;
  readonly inlandMaterial: THREE.MeshStandardMaterial;
  private sea: THREE.Mesh | null = null;
  private farTex: THREE.DataTexture | null = null;
  private grid: ChunkGrid;
  private chunks = new Map<number, THREE.Mesh>();
  private hasSea = false;

  constructor(readonly world: World, private readonly shared: SharedUniforms, terrain: TerrainRenderer, waterNormal: THREE.Texture) {
    this.group.name = 'water';
    const wu = (this.uniforms = createWaterUniforms());
    wu.uHTex.value = terrain.data.hTex;
    wu.uMapCells.value = world.size;
    wu.uWaterNormal.value = waterNormal;
    wu.uShallow.value.set(world.theme.waterShallow);
    wu.uDeep.value.set(world.theme.waterDeep);
    const far = terrain.far.createHeightTexture(128);
    this.farTex = far.tex;
    wu.uFarTex.value = far.tex;
    wu.uFarOrigin.value = far.origin;
    wu.uFarSpan.value = far.span;
    wu.uFarRes.value = 128;
    this.seaMaterial = createWaterMaterial(wu, shared, true);
    this.inlandMaterial = createWaterMaterial(wu, shared, false);
    this.grid = new ChunkGrid(world.size, CHUNK);
    this.grid.markAll();
    this.refreshSea(terrain);
  }

  /** does the map touch the sea (decides whether the ocean plane exists) */
  private refreshSea(terrain: TerrainRenderer): void {
    const w = this.world;
    let seaCells = 0;
    for (let i = 0; i < w.water.length; i += 3) {
      if (Math.abs(w.water[i] - w.seaLevel) < 0.01) {
        const x = i % w.size, y = (i / w.size) | 0;
        if (w.water[i] > w.cellHeight(x, y) + WATER_EPS) seaCells++;
      }
    }
    this.hasSea = seaCells > 8 || (w.theme.hasCoast && seaCells > 0);
    if (this.hasSea && !this.sea) {
      const E = terrain.far.extent, S = w.size * CELL;
      const g = new THREE.PlaneGeometry(S + 2 * E, S + 2 * E, 24, 24);
      g.rotateX(-Math.PI / 2);
      g.translate(S / 2, 0, S / 2);
      this.sea = new THREE.Mesh(g, this.seaMaterial);
      this.sea.name = 'sea';
      this.sea.receiveShadow = true;
      this.sea.frustumCulled = false;
      this.group.add(this.sea);
    } else if (!this.hasSea && this.sea) {
      this.group.remove(this.sea);
      this.sea.geometry.dispose();
      this.sea = null;
    }
  }

  onWorldChanged(rect: Rect, layers: number): void {
    if (layers & (Layer.Water | Layer.Terrain)) this.grid.markRect(rect, 1);
  }

  update(focusX: number, focusY: number, maxBuilds = 6): void {
    const w = this.world;
    this.shared.uSeaLevel.value = w.seaLevel;
    this.shared.uFlood.value = w.floodOffset;
    if (this.sea) this.sea.position.y = w.seaLevel + w.floodOffset;
    if (this.sea) this.sea.updateMatrix();
    const keys = this.grid.take(this.grid.dirty.size > 64 && this.chunks.size === 0 ? this.grid.dirty.size : maxBuilds, focusX, focusY);
    for (const k of keys) this.buildChunk(k);
  }

  private buildChunk(key: number): void {
    const w = this.world;
    const r = this.grid.rect(key);
    const old = this.chunks.get(key);
    // inland water level per cell of the chunk + 1 cell border (NaN = none)
    const W = r.x1 - r.x0 + 3, H = r.y1 - r.y0 + 3;
    const lv = new Float32Array(W * H).fill(NaN);
    let any = false;
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++)
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        if (!w.inBounds(x, y)) continue;
        const raw = w.water[w.idx(x, y)];
        if (raw <= w.cellHeight(x, y) + WATER_EPS) continue;
        if (Math.abs(raw - w.seaLevel) < 0.01 && this.hasSea) continue; // sea plane covers it
        lv[(y - r.y0 + 1) * W + (x - r.x0 + 1)] = raw;
        any = true;
      }
    if (!any) {
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        this.chunks.delete(key);
      }
      return;
    }
    // cells to draw: wet cells + one ring of shore cells (terrain clips the edge)
    const cw = r.x1 - r.x0 + 1, ch = r.y1 - r.y0 + 1;
    const draw = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        let hit = false;
        for (let oy = 0; oy <= 2 && !hit; oy++) for (let ox = 0; ox <= 2 && !hit; ox++) if (!Number.isNaN(lv[(y + oy) * W + (x + ox)])) hit = true;
        draw[y * cw + x] = hit ? 1 : 0;
      }
    // vertex levels: mean of adjacent wet cells, else nearest in a 4×4 window
    const VW = cw + 1, VH = ch + 1;
    const vlev = new Float32Array(VW * VH).fill(NaN);
    for (let vy = 0; vy < VH; vy++)
      for (let vx = 0; vx < VW; vx++) {
        let sum = 0, n = 0;
        for (let oy = 0; oy <= 1; oy++)
          for (let ox = 0; ox <= 1; ox++) {
            const v = lv[(vy + oy) * W + (vx + ox)];
            if (!Number.isNaN(v)) { sum += v; n++; }
          }
        if (!n) {
          for (let oy = -1; oy <= 2; oy++)
            for (let ox = -1; ox <= 2; ox++) {
              const yy = vy + oy, xx = vx + ox;
              if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
              const v = lv[yy * W + xx];
              if (!Number.isNaN(v)) { sum += v; n++; }
            }
        }
        if (n) vlev[vy * VW + vx] = sum / n;
      }
    const vmap = new Int32Array(VW * VH).fill(-1);
    const pos: number[] = [], flow: number[] = [], idx: number[] = [];
    const vert = (vx: number, vy: number): number => {
      const k = vy * VW + vx;
      if (vmap[k] >= 0) return vmap[k];
      let h = vlev[k];
      if (Number.isNaN(h)) h = w.vertexHeight(r.x0 + vx, r.y0 + vy);
      const at = (ax: number, ay: number) => {
        const v = ax >= 0 && ay >= 0 && ax < VW && ay < VH ? vlev[ay * VW + ax] : NaN;
        return Number.isNaN(v) ? h : v;
      };
      const gx = (at(vx + 1, vy) - at(vx - 1, vy)) / (2 * CELL);
      const gz = (at(vx, vy + 1) - at(vx, vy - 1)) / (2 * CELL);
      const gl = Math.hypot(gx, gz);
      const speed = Math.min(1, gl * 60);
      vmap[k] = pos.length / 3;
      pos.push((r.x0 + vx) * CELL, h, (r.y0 + vy) * CELL);
      flow.push(gl > 1e-5 ? (-gx / gl) * speed : 0, gl > 1e-5 ? (-gz / gl) * speed : 0);
      return vmap[k];
    };
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        if (!draw[y * cw + x]) continue;
        const a = vert(x, y), b = vert(x + 1, y), c = vert(x, y + 1), d = vert(x + 1, y + 1);
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    const nor = new Float32Array(pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (old) {
      old.geometry.dispose();
      old.geometry = g;
    } else {
      const m = new THREE.Mesh(g, this.inlandMaterial);
      m.name = 'water-chunk';
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.chunks.set(key, m);
      this.group.add(m);
    }
  }

  /** water surface height at a cell, as rendered (NaN if dry) */
  surfaceAt(x: number, y: number): number {
    const w = this.world;
    return w.isWater(x, y) ? w.waterLevel(x, y) : NaN;
  }

  dispose(): void {
    for (const m of this.chunks.values()) m.geometry.dispose();
    this.chunks.clear();
    this.sea?.geometry.dispose();
    this.seaMaterial.dispose();
    this.inlandMaterial.dispose();
    this.farTex?.dispose();
    this.group.clear();
  }
}
