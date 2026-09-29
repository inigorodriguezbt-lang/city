// Quadtree-LOD heightfield terrain. Leaves are always 32×32 quads: level L
// covers (CHUNK << L) cells with a vertex every (1 << L) cells, so draw calls
// stay low (tens of nodes) while full resolution surrounds the camera. Skirts
// hide LOD cracks; coarse levels are biased slightly downward so objects
// placed on the true surface (roads, lots) are never swallowed at distance.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import { Layer, type Rect } from '../../core/types';
import type { World } from '../../world/World';
import type { SharedUniforms } from '../sky/SharedUniforms';
import { TerrainData } from './TerrainData';
import { createTerrainMaterial, createTerrainUniforms, type TerrainUniforms } from './terrainMaterial';
import { FarLand } from './horizon';

interface TNode {
  key: number;
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  step: number;
  mesh: THREE.Mesh | null;
  overlay: THREE.Mesh | null;
  dirty: boolean;
  lastUsed: number;
}

const NODE_Q = 32;
const MAX_CACHED = 260;
const _box = new THREE.Box3();

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly data: TerrainData;
  readonly far: FarLand;
  readonly uniforms: TerrainUniforms;
  readonly material: THREE.MeshStandardMaterial;
  readonly ringMaterial: THREE.MeshStandardMaterial;
  /** geometry LOD multiplier (distance/size ratio at which a node splits) */
  lodFactor = 2.5;
  private ring: THREE.Mesh;
  private nodes = new Map<number, TNode>();
  private active = new Set<number>();
  private indexCache = new Map<string, THREE.BufferAttribute>();
  private maxLevel: number;
  /** min/max height pyramid per level (index = ny * n + nx) */
  private pyr: { n: number; min: Float32Array; max: Float32Array }[] = [];
  private frame = 0;
  private overlayMat: THREE.Material | null = null;
  private ringDirty = false;
  private leaves: number[] = [];
  /** true until the first update(): the load-time "everything changed" flush is already reflected */
  private fresh = true;

  constructor(readonly world: World, private readonly shared: SharedUniforms, detailNormal: THREE.Texture) {
    this.group.name = 'terrain';
    this.data = new TerrainData(world);
    this.far = new FarLand(world);
    const s = world.size;
    let L = 0;
    while (NODE_Q << L < s) L++;
    this.maxLevel = L;
    this.buildPyramid({ x0: 0, y0: 0, x1: s - 1, y1: s - 1 });

    const tu = (this.uniforms = createTerrainUniforms());
    tu.uHTex.value = this.data.hTex;
    tu.uNTex.value = this.data.nTex;
    tu.uMapCells.value = s;
    tu.uDetailN.value = detailNormal;
    const t = world.theme;
    tu.uGrass.value.set(t.grass);
    tu.uGrassDry.value.set(t.grassDry);
    tu.uDirt.value.set(t.dirt);
    tu.uSand.value.set(t.sand);
    tu.uRock.value.set(t.rock);
    tu.uSnowCol.value.set(t.snow);
    // what the land beyond the map looks like: woods follow the forest setting and
    // climate; farmland patchwork in the farming biomes
    const woody = t.trees.includes('cactus') ? 0.08 : 0.35 + t.rainfall * 0.9;
    tu.uRingForest.value = Math.min(1, Math.max(0, world.settings.forests * woody + 0.08));
    const FIELDS: Record<string, number> = { temperate: 1, mediterranean: 0.8, tropical: 0.35, boreal: 0.3, alpine: 0.35, desert: 0 };
    tu.uRingFields.value = FIELDS[t.id] ?? 0.5;
    tu.uArid.value = Math.min(1, Math.max(0, (0.3 - t.rainfall) / 0.22));
    this.material = createTerrainMaterial(tu, shared, false);
    this.ringMaterial = createTerrainMaterial(tu, shared, true);
    this.ring = new THREE.Mesh(this.far.buildGeometry(), this.ringMaterial);
    this.ring.name = 'terrain-ring';
    this.ring.receiveShadow = true;
    this.ring.matrixAutoUpdate = false;
    this.group.add(this.ring);
  }

  get minHeight(): number {
    return this.data.minHeight;
  }
  get maxHeight(): number {
    return this.data.maxHeight;
  }

  /** number of terrain leaves currently drawn */
  get leafCount(): number {
    return this.active.size;
  }

  // ── change handling ─────────────────────────────────────────────────────
  onWorldChanged(rect: Rect, layers: number): void {
    const full = rect.x0 <= 0 && rect.y0 <= 0 && rect.x1 >= this.world.size - 1 && rect.y1 >= this.world.size - 1;
    if (this.fresh && full) return;
    if (!(layers & (Layer.Terrain | Layer.Water))) {
      if (layers & Layer.Tree) this.data.updateCanopy(rect);
      // roads / lots / buildings pin (or release) smoothed shoreline vertices
      if (layers & (Layer.Road | Layer.Zone | Layer.Building)) {
        const vr = this.data.refreshVisual(rect);
        if (vr) {
          this.buildPyramid(vr);
          this.markNodes(vr);
        }
      }
      return;
    }
    this.data.update(rect);
    const s = this.world.size;
    if (rect.x0 <= 1 || rect.y0 <= 1 || rect.x1 >= s - 2 || rect.y1 >= s - 2) this.ringDirty = true;
    // rendered heights may change up to 3 vertices beyond the edit (shorelines
    // move with terrain *and* water edits; smoothing reaches 2 vertices further)
    const pr = { x0: Math.max(0, rect.x0 - 3), y0: Math.max(0, rect.y0 - 3), x1: Math.min(s - 1, rect.x1 + 3), y1: Math.min(s - 1, rect.y1 + 3) };
    this.buildPyramid(pr);
    this.markNodes(pr);
  }

  /** any cached node overlapping the rect (+1 for shared vertices / bias window) is stale */
  private markNodes(rect: Rect): void {
    for (const n of this.nodes.values()) {
      const span = NODE_Q << n.level;
      const pad = n.step + 1;
      if (rect.x1 + pad < n.x0 || rect.x0 - pad > n.x0 + span || rect.y1 + pad < n.y0 || rect.y0 - pad > n.y0 + span) continue;
      n.dirty = true;
    }
  }

  setOverlayMaterial(mat: THREE.Material | null): void {
    if (this.overlayMat === mat) return;
    this.overlayMat = mat;
    for (const key of this.active) {
      const n = this.nodes.get(key);
      if (n) this.syncOverlay(n);
    }
  }

  private syncOverlay(n: TNode): void {
    if (!n.mesh) return;
    if (this.overlayMat) {
      if (!n.overlay) {
        n.overlay = new THREE.Mesh(n.mesh.geometry, this.overlayMat);
        n.overlay.matrixAutoUpdate = false;
        n.overlay.renderOrder = 2;
        n.overlay.name = 'overlay-drape';
      }
      n.overlay.material = this.overlayMat;
      n.overlay.geometry = n.mesh.geometry;
      if (!n.overlay.parent) this.group.add(n.overlay);
    } else if (n.overlay?.parent) {
      this.group.remove(n.overlay);
    }
  }

  // ── per-frame LOD selection ─────────────────────────────────────────────
  update(camera: THREE.Camera, maxBuilds = 48): void {
    this.frame++;
    this.fresh = false;
    if (this.ringDirty) {
      this.ringDirty = false;
      this.far.computeEdges();
      this.ring.geometry.dispose();
      this.ring.geometry = this.far.buildGeometry();
    }
    const cam = camera.position;
    const leaves = this.leaves;
    leaves.length = 0;
    const top = this.maxLevel;
    const nTop = Math.ceil(this.world.size / (NODE_Q << top));
    for (let y = 0; y < nTop; y++) for (let x = 0; x < nTop; x++) this.select(top, x, y, cam, leaves);
    // build/refresh nearest first (leaves are pushed roughly outward already)
    let builds = 0;
    const next = new Set<number>();
    for (const key of leaves) {
      let n = this.nodes.get(key);
      if (!n) {
        n = this.makeNode(key);
        this.nodes.set(key, n);
      }
      if (!n.mesh || (n.dirty && builds < maxBuilds)) {
        this.buildNode(n);
        builds++;
      }
      n.lastUsed = this.frame;
      next.add(key);
    }
    for (const key of this.active) {
      if (next.has(key)) continue;
      const n = this.nodes.get(key);
      if (!n) continue;
      if (n.mesh) this.group.remove(n.mesh);
      if (n.overlay) this.group.remove(n.overlay);
    }
    for (const key of next) {
      if (this.active.has(key)) continue;
      const n = this.nodes.get(key)!;
      if (n.mesh) this.group.add(n.mesh);
      this.syncOverlay(n);
    }
    this.active = next;
    if (this.nodes.size > MAX_CACHED) this.evict();
  }

  private select(level: number, nx: number, ny: number, cam: THREE.Vector3, out: number[]): void {
    const span = NODE_Q << level;
    const x0 = nx * span, y0 = ny * span;
    const s = this.world.size;
    if (x0 >= s || y0 >= s) return;
    const x1 = Math.min(s, x0 + span), y1 = Math.min(s, y0 + span);
    if (level > 0) {
      const p = this.pyr[level];
      const i = ny * p.n + nx;
      _box.min.set(x0 * CELL, p.min[i], y0 * CELL);
      _box.max.set(x1 * CELL, p.max[i], y1 * CELL);
      const d = _box.distanceToPoint(cam);
      if (d < this.lodFactor * span * CELL) {
        // visit children nearest-first so nearer leaves build first
        const order = [0, 1, 2, 3];
        const cx = (x0 + span / 2) * CELL, cz = (y0 + span / 2) * CELL;
        const qx = cam.x < cx ? 0 : 1, qz = cam.z < cz ? 0 : 1;
        order.sort((a, b) => (Math.abs((a & 1) - qx) + Math.abs((a >> 1) - qz)) - (Math.abs((b & 1) - qx) + Math.abs((b >> 1) - qz)));
        for (const c of order) this.select(level - 1, nx * 2 + (c & 1), ny * 2 + (c >> 1), cam, out);
        return;
      }
    }
    out.push(this.nodeKey(level, nx, ny));
  }

  private nodeKey(level: number, nx: number, ny: number): number {
    return level * 16777216 + ny * 4096 + nx;
  }

  private makeNode(key: number): TNode {
    const level = Math.floor(key / 16777216);
    const rem = key - level * 16777216;
    const ny = Math.floor(rem / 4096), nx = rem - ny * 4096;
    const span = NODE_Q << level;
    const step = 1 << level;
    const s = this.world.size;
    const x0 = nx * span, y0 = ny * span;
    return {
      key, level, x0, y0, step,
      nx: Math.min(NODE_Q, Math.round((Math.min(s, x0 + span) - x0) / step)),
      ny: Math.min(NODE_Q, Math.round((Math.min(s, y0 + span) - y0) / step)),
      mesh: null, overlay: null, dirty: true, lastUsed: 0,
    };
  }

  private evict(): void {
    const list = [...this.nodes.values()].filter((n) => !this.active.has(n.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.nodes.size - MAX_CACHED * 0.8;
    for (const n of list) {
      if (excess-- <= 0) break;
      n.mesh?.geometry.dispose();
      this.nodes.delete(n.key);
    }
  }

  // ── geometry ────────────────────────────────────────────────────────────
  private getIndex(nx: number, ny: number): THREE.BufferAttribute {
    const k = `${nx}x${ny}`;
    let idx = this.indexCache.get(k);
    if (idx) return idx;
    const W = nx + 1;
    const gridCount = W * (ny + 1);
    const arr: number[] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        if ((i + j) & 1) arr.push(a, c, b, b, c, d);
        else arr.push(a, c, d, a, d, b);
      }
    // skirts: edges ordered so that (t × down) points outward
    let sk = gridCount;
    const edge = (verts: number[]) => {
      const base = sk;
      for (let k = 0; k < verts.length - 1; k++) {
        const e0 = verts[k], e1 = verts[k + 1], s0 = base + k, s1 = base + k + 1;
        arr.push(e0, e1, s0, e1, s1, s0);
      }
      sk += verts.length;
    };
    const top: number[] = [], bottom: number[] = [], left: number[] = [], right: number[] = [];
    for (let i = 0; i <= nx; i++) top.push(i);
    for (let i = nx; i >= 0; i--) bottom.push(ny * W + i);
    for (let j = ny; j >= 0; j--) left.push(j * W);
    for (let j = 0; j <= ny; j++) right.push(j * W + nx);
    edge(top);
    edge(bottom);
    edge(left);
    edge(right);
    idx = new THREE.BufferAttribute(gridCount + 2 * (nx + ny + 2) > 65535 ? new Uint32Array(arr) : new Uint16Array(arr), 1);
    this.indexCache.set(k, idx);
    return idx;
  }

  private buildNode(n: TNode): void {
    const w = this.world;
    const s = w.size, vn = s + 1;
    const H = this.data.visH;
    const nd = this.data.nData;
    const { nx, ny, step, x0, y0 } = n;
    const W = nx + 1;
    const gridCount = W * (ny + 1);
    const total = gridCount + 2 * (nx + ny + 2);
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const bias = step > 1 ? step >> 1 : 0;
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const vx = x0 + i * step, vy = y0 + j * step;
        let h = H[vy * vn + vx];
        if (bias) {
          // conservative (downward) LOD: never float above the true surface
          const ax0 = Math.max(0, vx - bias), ax1 = Math.min(s, vx + bias);
          const ay0 = Math.max(0, vy - bias), ay1 = Math.min(s, vy + bias);
          for (let yy = ay0; yy <= ay1; yy += Math.max(1, bias >> 1))
            for (let xx = ax0; xx <= ax1; xx += Math.max(1, bias >> 1)) {
              const hh = H[yy * vn + xx];
              if (hh < h) h = hh;
            }
          h = h * 0.7 + H[vy * vn + vx] * 0.3 - 0.05 * step;
        }
        const o = (j * W + i) * 3;
        pos[o] = vx * CELL;
        pos[o + 1] = h;
        pos[o + 2] = vy * CELL;
        const t = (vy * vn + vx) * 4;
        let ex = nd[t] / 127.5 - 1, ez = nd[t + 1] / 127.5 - 1;
        const ey = Math.sqrt(Math.max(0, 1 - ex * ex - ez * ez));
        const inv = 1 / Math.hypot(ex, ey, ez);
        ex *= inv;
        nor[o] = ex;
        nor[o + 1] = ey * inv;
        nor[o + 2] = ez * inv;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    // skirt vertices, same order as getIndex()
    const depth = step * CELL * 0.7 + 8;
    let sk = gridCount;
    const copy = (src: number) => {
      pos[sk * 3] = pos[src * 3];
      pos[sk * 3 + 1] = pos[src * 3 + 1] - depth;
      pos[sk * 3 + 2] = pos[src * 3 + 2];
      nor[sk * 3] = nor[src * 3];
      nor[sk * 3 + 1] = nor[src * 3 + 1];
      nor[sk * 3 + 2] = nor[src * 3 + 2];
      sk++;
    };
    for (let i = 0; i <= nx; i++) copy(i);
    for (let i = nx; i >= 0; i--) copy(ny * W + i);
    for (let j = ny; j >= 0; j--) copy(j * W);
    for (let j = 0; j <= ny; j++) copy(j * W + nx);

    let geo = n.mesh?.geometry as THREE.BufferGeometry | undefined;
    const fresh = !geo || (geo.getAttribute('position') as THREE.BufferAttribute).count !== total;
    if (fresh) {
      geo?.dispose();
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(this.getIndex(nx, ny));
    } else {
      const pa = geo!.getAttribute('position') as THREE.BufferAttribute;
      (pa.array as Float32Array).set(pos);
      pa.needsUpdate = true;
      const na = geo!.getAttribute('normal') as THREE.BufferAttribute;
      (na.array as Float32Array).set(nor);
      na.needsUpdate = true;
    }
    const g = geo!;
    if (!g.boundingBox) g.boundingBox = new THREE.Box3();
    g.boundingBox.min.set(x0 * CELL, minY - depth, y0 * CELL);
    g.boundingBox.max.set((x0 + nx * step) * CELL, maxY, (y0 + ny * step) * CELL);
    if (!g.boundingSphere) g.boundingSphere = new THREE.Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    if (!n.mesh) {
      const m = new THREE.Mesh(g, this.material);
      m.name = `terrain-L${n.level}`;
      m.matrixAutoUpdate = false;
      m.receiveShadow = true;
      m.castShadow = n.level <= 1;
      n.mesh = m;
    } else if (fresh) {
      n.mesh.geometry = g;
      if (n.overlay) n.overlay.geometry = g;
    }
    n.dirty = false;
  }

  private buildPyramid(r: Rect): void {
    const w = this.world;
    const s = w.size, vn = s + 1;
    const H = this.data.visH;
    for (let L = 0; L <= this.maxLevel; L++) {
      const span = NODE_Q << L;
      const n = Math.ceil(s / span);
      if (!this.pyr[L] || this.pyr[L].n !== n) this.pyr[L] = { n, min: new Float32Array(n * n), max: new Float32Array(n * n) };
      const p = this.pyr[L];
      const nx0 = Math.max(0, Math.floor((r.x0 - 1) / span)), ny0 = Math.max(0, Math.floor((r.y0 - 1) / span));
      const nx1 = Math.min(n - 1, Math.floor((r.x1 + 1) / span)), ny1 = Math.min(n - 1, Math.floor((r.y1 + 1) / span));
      for (let ny = ny0; ny <= ny1; ny++)
        for (let nx = nx0; nx <= nx1; nx++) {
          let mn = Infinity, mx = -Infinity;
          if (L === 0) {
            const x0 = nx * span, y0 = ny * span;
            for (let y = y0; y <= Math.min(s, y0 + span); y++)
              for (let x = x0; x <= Math.min(s, x0 + span); x++) {
                const h = H[y * vn + x];
                if (h < mn) mn = h;
                if (h > mx) mx = h;
              }
          } else {
            const c = this.pyr[L - 1];
            for (let k = 0; k < 4; k++) {
              const cx = nx * 2 + (k & 1), cy = ny * 2 + (k >> 1);
              if (cx >= c.n || cy >= c.n) continue;
              mn = Math.min(mn, c.min[cy * c.n + cx]);
              mx = Math.max(mx, c.max[cy * c.n + cx]);
            }
          }
          p.min[ny * n + nx] = mn;
          p.max[ny * n + nx] = mx;
        }
    }
  }

  dispose(): void {
    for (const n of this.nodes.values()) n.mesh?.geometry.dispose();
    this.nodes.clear();
    this.active.clear();
    this.indexCache.clear();
    this.ring.geometry.dispose();
    this.material.dispose();
    this.ringMaterial.dispose();
    this.data.dispose();
    this.group.clear();
  }
}

