// Trees and boulders, instanced per species.
//
// Instances are generated per chunk (cached, rebuilt on Tree/Road/Building/
// Terrain changes) and assembled into blocks of 4×4 chunks. Each block owns
// one instanced mesh per (tier, species): tier 0 = full model + shadows near
// the camera, tier 1 = low model + shadows, tier 2 = low model, thinned with
// distance. Chunk tiers follow the camera with hysteresis; only blocks whose
// chunk tiers changed are re-assembled (bounded per frame).
import * as THREE from 'three';
import { CELL, CHUNK } from '../../core/constants';
import { hash3, hashFloat } from '../../core/rng';
import { Noise } from '../../core/noise';
import { Layer, type Rect, type TreeSpecies } from '../../core/types';
import type { World } from '../../world/World';
import type { SharedUniforms } from '../sky/SharedUniforms';
import { buildPropModels, PROP_KINDS, propHeight, type PropKind } from './treeModels';
import { createPropDepthMaterial, createPropMaterial, createPropUniforms, type PropUniforms } from './treeMaterial';

const STRIDE = 8; // x, y, z, scale, rot, jitter, phase, rank
const BLOCK = 4; // chunks per block edge
const NK = PROP_KINDS.length;
const ROCK = PROP_KINDS.indexOf('rock');
const CONIFER = new Set<PropKind>(['pine', 'spruce', 'cypress']);
const TIERS = 3;
/** instances closer than this (m) use the detailed model */
const LOD0_DIST = 240;
/** camera travel (m) after which blocks with detailed trees re-sort their LODs */
const LOD0_RESORT = 40;

interface ChunkProps {
  /** per kind: packed instance data */
  data: Float32Array[];
  counts: number[];
  tier: number;
  minH: number;
  maxH: number;
}

interface BlockMesh {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  iPos: THREE.InstancedBufferAttribute;
  iData: THREE.InstancedBufferAttribute;
  capacity: number;
}

interface Block {
  bx: number;
  by: number;
  meshes: (BlockMesh | null)[]; // index tier * NK + kind
  dirty: boolean;
  /** camera position at the last assembly (per-instance LOD split) */
  camAt: THREE.Vector3;
  /** true when the block holds near chunks (detailed models) */
  hasNear: boolean;
}

export interface TreeViewParams {
  camera: THREE.Camera;
  /** render radius (m) */
  radius: number;
  /** shadow radius (m) — trees inside keep casting shadows */
  shadowRadius: number;
  density: number;
}

export class TreeRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: PropUniforms;
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  private models: Record<PropKind, [THREE.BufferGeometry, THREE.BufferGeometry]>;
  private chunks: (ChunkProps | null)[];
  private dirtyChunks = new Set<number>();
  private blocks: Block[];
  private cps: number;
  private bps: number;
  private noises: Noise[];
  private density = 1;
  private themeKinds: TreeSpecies[];
  private frameNo = 0;

  constructor(readonly world: World, shared: SharedUniforms) {
    this.group.name = 'props';
    this.uniforms = createPropUniforms();
    // tint the neutral boulder model toward the theme's rock colour (terrain albedo scale included)
    const base = new THREE.Color('#8c877e');
    const rt = this.uniforms.uRockTint.value.set(world.theme.rock).multiplyScalar(0.86);
    const cl = (v: number) => Math.min(1.5, Math.max(0.5, v));
    rt.setRGB(cl(rt.r / base.r), cl(rt.g / base.g), cl(rt.b / base.b));
    this.material = createPropMaterial(this.uniforms, shared);
    this.depthMaterial = createPropDepthMaterial(this.uniforms, shared);
    this.models = buildPropModels();
    this.cps = Math.ceil(world.size / CHUNK);
    this.bps = Math.ceil(this.cps / BLOCK);
    this.chunks = new Array(this.cps * this.cps).fill(null);
    for (let i = 0; i < this.chunks.length; i++) this.dirtyChunks.add(i);
    this.blocks = [];
    for (let by = 0; by < this.bps; by++)
      for (let bx = 0; bx < this.bps; bx++) this.blocks.push({ bx, by, meshes: new Array(TIERS * NK).fill(null), dirty: true, camAt: new THREE.Vector3(), hasNear: false });
    this.noises = PROP_KINDS.map((_, i) => new Noise((world.settings.seed + 7919 * (i + 1)) >>> 0));
    this.themeKinds = world.theme.trees.slice();
  }

  onWorldChanged(rect: Rect, layers: number): void {
    if (!(layers & (Layer.Tree | Layer.Road | Layer.Building | Layer.Terrain | Layer.Water | Layer.Zone))) return;
    const c0x = Math.max(0, Math.floor((rect.x0 - 1) / CHUNK)), c0y = Math.max(0, Math.floor((rect.y0 - 1) / CHUNK));
    const c1x = Math.min(this.cps - 1, Math.floor((rect.x1 + 1) / CHUNK)), c1y = Math.min(this.cps - 1, Math.floor((rect.y1 + 1) / CHUNK));
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) this.dirtyChunks.add(cy * this.cps + cx);
  }

  /** seasonal parameters (see Renderer: computed from calendar + theme) */
  setSeason(leaf: number, spring: number, autumn: number, blossom: number): void {
    const u = this.uniforms;
    u.uLeaf.value = leaf;
    u.uSpring.value = spring;
    u.uAutumn.value = autumn;
    u.uBlossom.value = blossom;
  }

  update(p: TreeViewParams, budgetMs = 3): void {
    this.frameNo++;
    const t0 = performance.now();
    if (Math.abs(p.density - this.density) > 1e-3) {
      this.density = p.density;
      for (const b of this.blocks) b.dirty = true;
    }
    const cam = p.camera.position;
    const cps = this.cps;
    // 1. rebuild dirty chunk data, nearest first
    if (this.dirtyChunks.size) {
      const list = [...this.dirtyChunks];
      const cxf = cam.x / (CHUNK * CELL), czf = cam.z / (CHUNK * CELL);
      list.sort((a, b) => ((a % cps) - cxf) ** 2 + (Math.floor(a / cps) - czf) ** 2 - (((b % cps) - cxf) ** 2 + (Math.floor(b / cps) - czf) ** 2));
      const initial = this.chunks.every((c) => c === null);
      for (const k of list) {
        this.buildChunk(k);
        this.dirtyChunks.delete(k);
        this.blockOf(k).dirty = true;
        if (!initial && performance.now() - t0 > budgetMs) break;
      }
    }
    // 2. chunk tiers from camera distance (with hysteresis). Tier 0 chunks
    //    split per instance between the detailed and the low model.
    const nearD = LOD0_DIST + 30, midD = Math.max(900, Math.min(p.shadowRadius, 1600)), farD = p.radius;
    for (let k = 0; k < this.chunks.length; k++) {
      const c = this.chunks[k];
      if (!c) continue;
      const cx = ((k % cps) + 0.5) * CHUNK * CELL, cz = (Math.floor(k / cps) + 0.5) * CHUNK * CELL;
      const half = CHUNK * CELL * 0.5;
      const dx = Math.max(0, Math.abs(cam.x - cx) - half), dz = Math.max(0, Math.abs(cam.z - cz) - half);
      const dy = Math.max(0, cam.y - c.maxH, c.minH - cam.y);
      const d = Math.hypot(dx, dy, dz);
      const hy = c.tier >= 0 ? 40 : 0;
      const tier = d < nearD + (c.tier === 0 ? hy : 0) ? 0 : d < midD + (c.tier <= 1 ? hy : 0) ? 1 : d < farD + (c.tier <= 2 ? hy : 0) ? 2 : 3;
      // far chunks refresh their thinning in steps of ~350 m
      const bucket = tier === 2 ? 2 + Math.min(12, Math.floor(d / 350)) * 0.01 : tier;
      if (bucket !== c.tier) {
        c.tier = bucket;
        this.blockOf(k).dirty = true;
      }
    }
    // 3. re-assemble dirty blocks (nearest first, bounded); blocks with
    //    detailed trees refresh their per-instance LOD split as the camera moves
    for (const b of this.blocks) if (b.hasNear && !b.dirty && b.camAt.distanceToSquared(cam) > LOD0_RESORT * LOD0_RESORT) b.dirty = true;
    const dirty = this.blocks.filter((b) => b.dirty);
    if (dirty.length) {
      const bs = BLOCK * CHUNK * CELL;
      dirty.sort((a, b) => Math.hypot((a.bx + 0.5) * bs - cam.x, (a.by + 0.5) * bs - cam.z) - Math.hypot((b.bx + 0.5) * bs - cam.x, (b.by + 0.5) * bs - cam.z));
      let n = 0;
      for (const b of dirty) {
        if (n > 0 && performance.now() - t0 > budgetMs + 2) break;
        this.assemble(b, cam);
        n++;
      }
    }
  }

  private blockOf(chunkKey: number): Block {
    const cx = chunkKey % this.cps, cy = Math.floor(chunkKey / this.cps);
    return this.blocks[Math.floor(cy / BLOCK) * this.bps + Math.floor(cx / BLOCK)];
  }

  // ── chunk instance generation ───────────────────────────────────────────
  private buildChunk(key: number): void {
    const w = this.world;
    const s = w.size;
    const cx = key % this.cps, cy = Math.floor(key / this.cps);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(s, x0 + CHUNK), y1 = Math.min(s, y0 + CHUNK);
    const lists: number[][] = PROP_KINDS.map(() => []);
    const seed = w.settings.seed | 0;
    const theme = w.theme;
    const hRange = Math.max(1, this.maxHeight - this.minHeight);
    let minH = Infinity, maxH = -Infinity;
    const occupied = (x: number, y: number) => {
      if (!w.inBounds(x, y)) return false;
      const i = w.idx(x, y);
      return w.road[i] !== 0 || w.bldg[i] !== 0;
    };
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = w.idx(x, y);
        const hc = w.cellHeight(x, y);
        if (hc < minH) minH = hc;
        if (hc > maxH) maxH = hc;
        if (w.road[i] || w.bldg[i] || w.isWater(x, y)) continue;
        const d = w.trees[i];
        if (d > 0) {
          const target = d === 1 ? 1.3 : d === 2 ? 2.5 : 3.7;
          const n = Math.floor(target + hashFloat(x, y, seed ^ 0x51));
          // keep crowns off neighbouring roads
          const minX = occupied(x - 1, y) ? 6 : 2, maxX = occupied(x + 1, y) ? 10 : 14;
          const minZ = occupied(x, y - 1) ? 6 : 2, maxZ = occupied(x, y + 1) ? 10 : 14;
          const alt = (hc - this.minHeight) / hRange;
          const shore = w.isShore(x, y) || w.isWater(x + 2, y) || w.isWater(x - 2, y) || w.isWater(x, y + 2) || w.isWater(x, y - 2);
          for (let k = 0; k < n; k++) {
            const h1 = hash3(x, y, seed + k * 7717);
            const fx = minX + ((h1 & 0xffff) / 65535) * (maxX - minX);
            const fz = minZ + (((h1 >>> 16) & 0xffff) / 65535) * (maxZ - minZ);
            const wx = x * CELL + fx, wz = y * CELL + fz;
            const kind = this.pickSpecies(wx, wz, alt, shore, w.fields.fertility[i] / 255, hashFloat(x, y, seed + k * 31 + 5));
            const ki = PROP_KINDS.indexOf(kind);
            const r2 = hashFloat(x * 3 + k, y * 5 - k, seed + 99);
            const base = 0.78 + r2 * 0.42 + (d === 3 ? 0.08 : 0);
            lists[ki].push(wx, this.groundAt(wx, wz) - 0.25, wz, base, r2 * 1000 % (Math.PI * 2), hashFloat(x, y, k + 400), hashFloat(y, x, k + 900) * 6.283, hashFloat(x + k * 131, y, seed + 17));
          }
        }
        // boulders on steep or rocky ground (never on zoned lots)
        const slope = w.cellSlope(x, y);
        if (w.zone[i] === 0 && (slope > 0.42 || (theme.id === 'desert' && slope > 0.18) || (theme.id === 'alpine' && hc > this.minHeight + hRange * 0.7))) {
          const p = Math.min(0.9, (slope - 0.3) * 1.6 + (theme.id === 'desert' ? 0.15 : 0));
          const nr = hashFloat(x, y, seed + 3131) < p ? 1 + (hashFloat(y, x, seed + 77) < 0.35 ? 1 : 0) : 0;
          for (let k = 0; k < nr; k++) {
            const h1 = hash3(x, y, seed + 911 + k);
            const wx = x * CELL + 2 + ((h1 & 0xffff) / 65535) * 12, wz = y * CELL + 2 + (((h1 >>> 16) & 0xffff) / 65535) * 12;
            const sc = 0.5 + hashFloat(x, y, k + 555) ** 2 * 2.2;
            lists[ROCK].push(wx, this.groundAt(wx, wz) - 0.35 * sc, wz, sc, hashFloat(x, y, k + 71) * 6.283, hashFloat(x, y, k + 72), 0, hashFloat(x + 1, y, k + 73));
          }
        }
      }
    const data = lists.map((l) => {
      // sort by rank so density / distance thinning takes a prefix
      const n = l.length / STRIDE;
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => l[a * STRIDE + 7] - l[b * STRIDE + 7]);
      const out = new Float32Array(l.length);
      order.forEach((src, dst) => {
        for (let j = 0; j < STRIDE; j++) out[dst * STRIDE + j] = l[src * STRIDE + j];
      });
      return out;
    });
    const prev = this.chunks[key];
    this.chunks[key] = { data, counts: data.map((d) => d.length / STRIDE), tier: prev ? prev.tier : -1, minH, maxH: maxH + 25 };
  }

  minHeight = 0;
  maxHeight = 400;
  /** ground height sampler (rendered terrain surface); defaults to the true heights */
  groundAt: (wx: number, wz: number) => number = (wx, wz) => this.world.heightAt(wx, wz);

  private pickSpecies(wx: number, wz: number, alt: number, shore: boolean, fert: number, r: number): PropKind {
    const kinds = this.themeKinds;
    let total = 0;
    const weights: number[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      let wgt = 1 / (1 + i * 0.45);
      if (CONIFER.has(k) && k !== 'cypress') wgt *= 0.35 + alt * 2.6;
      else if (k !== 'cactus' && k !== 'palm') wgt *= 1.35 - alt * 0.9;
      if (k === 'willow') wgt *= shore ? 7 : 0.12;
      if (k === 'palm') wgt *= shore ? 3.5 : 0.8;
      if (k === 'cactus') wgt *= 1.6 - fert * 1.4;
      if (k === 'birch') wgt *= 0.8 + alt;
      // species patches (groves)
      const n = this.noises[PROP_KINDS.indexOf(k)].noise2(wx / 700, wz / 700);
      wgt *= Math.max(0.05, 0.55 + 1.2 * n);
      weights.push(wgt);
      total += wgt;
    }
    let x = r * total;
    for (let i = 0; i < kinds.length; i++) {
      x -= weights[i];
      if (x <= 0) return kinds[i];
    }
    return kinds[kinds.length - 1] ?? 'oak';
  }

  // ── block assembly ──────────────────────────────────────────────────────
  private assemble(b: Block, cam: THREE.Vector3): void {
    b.dirty = false;
    b.camAt.copy(cam);
    b.hasNear = false;
    const cps = this.cps;
    const counts = new Array(TIERS * NK).fill(0);
    const members: { c: ChunkProps; tier: number; keep: number; scale: number }[] = [];
    let minH = Infinity, maxH = -Infinity;
    for (let oy = 0; oy < BLOCK; oy++)
      for (let ox = 0; ox < BLOCK; ox++) {
        const cx = b.bx * BLOCK + ox, cy = b.by * BLOCK + oy;
        if (cx >= cps || cy >= cps) continue;
        const c = this.chunks[cy * cps + cx];
        if (!c || c.tier < 0 || c.tier >= 3) continue;
        const tier = Math.floor(c.tier);
        let keep = this.density, scale = 1;
        if (tier === 2) {
          const d = Math.hypot(((cx + 0.5) * CHUNK * CELL) - cam.x, ((cy + 0.5) * CHUNK * CELL) - cam.z);
          const f = Math.min(1, Math.max(0.28, 1.35 - d / 2600));
          keep *= f;
          scale = Math.min(1.4, Math.pow(f, -0.3));
        }
        members.push({ c, tier, keep, scale });
        minH = Math.min(minH, c.minH);
        maxH = Math.max(maxH, c.maxH);
        if (tier === 0) b.hasNear = true;
        for (let k = 0; k < NK; k++) {
          const cnt = Math.ceil(c.counts[k] * Math.min(1, keep));
          counts[tier * NK + k] += cnt;
          // near chunks may route any instance to the low model (tier 1 slot)
          if (tier === 0) counts[NK + k] += cnt;
        }
      }
    const bs = BLOCK * CHUNK * CELL;
    for (let tier = 0; tier < TIERS; tier++)
      for (let k = 0; k < NK; k++) {
        const slot = tier * NK + k;
        const need = counts[slot];
        let bm = b.meshes[slot];
        if (need === 0) {
          if (bm) bm.mesh.visible = false;
          continue;
        }
        if (!bm || bm.capacity < need) {
          if (bm) {
            this.group.remove(bm.mesh);
            bm.geo.dispose();
          }
          bm = this.createBlockMesh(PROP_KINDS[k], tier, Math.ceil(need * 1.3) + 16);
          b.meshes[slot] = bm;
          this.group.add(bm.mesh);
        }
        const P = bm.iPos.array as Float32Array, D = bm.iData.array as Float32Array;
        let n = 0;
        const lod0 = LOD0_DIST * LOD0_DIST;
        for (const m of members) {
          // tier-0 chunks feed both the detailed slot (near instances) and the low slot (the rest)
          if (m.tier !== tier && !(tier === 1 && m.tier === 0)) continue;
          const split = m.tier === 0;
          const src = m.c.data[k];
          const total = m.c.counts[k];
          const lim = m.keep >= 1 ? total : Math.ceil(total * m.keep);
          for (let i = 0; i < lim; i++) {
            const o = i * STRIDE;
            if (src[o + 7] > m.keep) break;
            if (split) {
              const dx = src[o] - cam.x, dy = src[o + 1] - cam.y, dz = src[o + 2] - cam.z;
              const near = dx * dx + dy * dy + dz * dz < lod0;
              if (near !== (tier === 0)) continue;
            }
            const q = n * 4;
            P[q] = src[o];
            P[q + 1] = src[o + 1];
            P[q + 2] = src[o + 2];
            P[q + 3] = src[o + 3] * m.scale;
            D[q] = src[o + 4];
            D[q + 1] = src[o + 5];
            D[q + 2] = src[o + 6];
            D[q + 3] = 0;
            n++;
          }
        }
        bm.geo.instanceCount = n;
        bm.iPos.clearUpdateRanges();
        bm.iData.clearUpdateRanges();
        bm.iPos.addUpdateRange(0, n * 4);
        bm.iData.addUpdateRange(0, n * 4);
        bm.iPos.needsUpdate = true;
        bm.iData.needsUpdate = true;
        bm.mesh.visible = n > 0;
        const sph = bm.geo.boundingSphere!;
        const ht = propHeight(PROP_KINDS[k]) * 1.6;
        sph.center.set((b.bx + 0.5) * bs, (minH + maxH + ht) * 0.5, (b.by + 0.5) * bs);
        sph.radius = Math.hypot(bs * 0.5, bs * 0.5, (maxH + ht - minH) * 0.5) + 10;
      }
  }

  private createBlockMesh(kind: PropKind, tier: number, capacity: number): BlockMesh {
    const base = this.models[kind][tier === 0 ? 0 : 1];
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
    if (base.index) geo.setIndex(base.index);
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    iPos.setUsage(THREE.DynamicDrawUsage);
    iData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', iPos);
    geo.setAttribute('iData', iData);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    geo.boundingBox = new THREE.Box3();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `props-${kind}-t${tier}`;
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.castShadow = tier < 2;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return { mesh, geo, iPos, iData, capacity };
  }

  /** total instances currently drawn */
  get instanceCount(): number {
    let n = 0;
    for (const b of this.blocks) for (const m of b.meshes) if (m && m.mesh.visible) n += m.geo.instanceCount;
    return n;
  }

  dispose(): void {
    for (const b of this.blocks) for (const m of b.meshes) if (m) m.geo.dispose();
    for (const [g0, g1] of Object.values(this.models)) {
      g0.dispose();
      g1.dispose();
    }
    this.material.dispose();
    this.depthMaterial.dispose();
    this.group.clear();
  }
}
