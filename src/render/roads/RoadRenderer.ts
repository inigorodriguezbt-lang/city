// Road network renderer: per-chunk merged road meshes (one draw call per
// chunk), global instanced street furniture, GPU-animated traffic signals,
// weather-reactive procedural surface shading. Chunks rebuild on Road /
// Terrain / Water changes (nearest first, time-budgeted per frame), switch
// between a detailed and a simplified geometry LOD with camera distance, hide
// beyond the render distance and are disposed when far away or on unload.
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { CELL, CHUNK } from '../../core/constants';
import { ChunkGrid } from '../../core/chunks';
import { hash2 } from '../../core/rng';
import { calendar } from '../../core/time';
import { Layer, RoadType, type Rect } from '../../core/types';
import { RoadSurface } from '../../world/roadHeight';
import { ChunkBuilder } from './builder';
import { FurnitureSystem } from './furniture';
import { createRoadMaterial, type RoadUniforms } from './material';
import { laneOffsets } from './profiles';
import { RoadHeightField } from './surface';

export { laneOffsets } from './profiles';
export { RoadHeightField } from './surface';
export { RAIL_TOP, BALLAST_TOP } from './builder';

interface ChunkState {
  mesh: THREE.Mesh | null;
  lod: number;
  built: boolean;
  cells: number;
}

/** distance (m) under which chunks use full detail + furniture (with hysteresis) */
const NEAR_IN = 1150;
const NEAR_OUT = 1350;
const SIGNAL_CYCLE = 26;
/** seasonal canopy albedo (linear) of street trees, close to the terrain trees' palette */
const CANOPY_SPRING = new THREE.Color().setRGB(0.1, 0.17, 0.05);
const CANOPY_SUMMER = new THREE.Color().setRGB(0.065, 0.12, 0.035);
const CANOPY_AUTUMN = new THREE.Color().setRGB(0.24, 0.1, 0.03);

export class RoadRenderer {
  protected world: World | null = null;
  /** root of everything this renderer draws */
  readonly group = new THREE.Group();
  /** per-frame rebuild budget (ms) */
  budgetMs = 4;
  readonly stats = { chunks: 0, visibleChunks: 0, triangles: 0, lastBuildMs: 0, pending: 0 };

  private grid: ChunkGrid | null = null;
  private hf: RoadHeightField | null = null;
  private ownSurface: RoadSurface | null = null;
  /** the game's RoadSurface whose heightAt currently delegates to our height field */
  private boundSurface: RoadSurface | null = null;
  private builder: ChunkBuilder | null = null;
  private chunks = new Map<number, ChunkState>();
  private material: THREE.MeshStandardMaterial;
  private uniforms: RoadUniforms;
  private furniture = new FurnitureSystem();
  private offs: (() => void)[] = [];
  private lodTimer = 0;
  private sigTime = 0;
  private wet = 0;
  private snow = 0;
  private canopy = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private sphere = new THREE.Sphere();

  constructor(protected game: Game) {
    const m = createRoadMaterial();
    this.material = m.material;
    this.uniforms = m.uniforms;
    this.group.name = 'roads';
    this.group.add(this.furniture.group);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    let surface = this.game.roadSurface;
    if (!surface || surface.world !== world) {
      this.ownSurface = new RoadSurface(world);
      surface = this.ownSurface;
    }
    this.hf = new RoadHeightField(world, surface);
    if (surface !== this.ownSurface) this.bindSurface(surface, this.hf);
    this.builder = new ChunkBuilder(world, this.hf);
    this.grid = new ChunkGrid(world.size);
    this.grid.markAll();
    const theme = world.theme;
    this.uniforms.uGrass.value.set(theme.grass);
    this.uniforms.uGrassDry.value.set(theme.grassDry);
    this.uniforms.uLeftHand.value = world.settings.leftHandTraffic ? 1 : 0;
    this.wet = world.weather.type === 'rain' || world.weather.type === 'storm' ? 0.8 : 0;
    this.snow = world.weather.snowCover;
    this.game.renderer.scene.add(this.group);
    this.offs.push(this.game.events.on('world:changed', ({ rect, layers }) => this.onChanged(rect, layers)));
  }

  onWorldUnloaded(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const c of this.chunks.values()) this.disposeMesh(c);
    this.chunks.clear();
    this.furniture.clear();
    this.furniture.flush();
    this.group.removeFromParent();
    this.unbindSurface();
    this.world = null;
    this.grid = null;
    this.hf = null;
    this.builder = null;
    this.ownSurface = null;
  }

  update(dt: number): void {
    const w = this.world;
    if (!w || !this.grid || !this.builder) return;
    const view = this.game.renderer.getViewInfo();
    this.updateUniforms(dt, w, view.cameraPos);
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.3;
      this.sweep(view.cameraPos, view.focusX, view.focusY, view.radiusCells);
    }
    this.rebuild(view.cameraPos, view.focusX, view.focusY, view.radiusCells);
    this.furniture.flush();
  }

  // ── public helpers ────────────────────────────────────────────────────────
  /** the rendered drivable surface height at world meters (bridge decks + approach ramps included) */
  surfaceHeight(wx: number, wz: number): number {
    return this.hf ? this.hf.heightAt(wx, wz) : this.world ? this.world.heightAt(wx, wz) : 0;
  }

  /** height model used by the renderer (vehicles can sample it for exact deck/ramp heights) */
  get heightField(): RoadHeightField | null {
    return this.hf;
  }

  /** lane center offsets (m, right of travel direction) for a road type */
  laneOffsets(type: RoadType): number[] {
    return laneOffsets(type);
  }

  /**
   * State of the traffic signal controlling traffic that ARRIVES at junction
   * cell (x, y) from direction `fromDir` (Dir of the arm it comes from), or
   * null when that junction has no signals.
   */
  signalState(x: number, y: number, fromDir: number): 'green' | 'yellow' | 'red' | null {
    if (!this.world || !this.hasSignals(x, y)) return null;
    const phase = hash2(x * 7 + 1, y * 13 + 5) % SIGNAL_CYCLE;
    let t = (this.sigTime + phase) % SIGNAL_CYCLE;
    if (fromDir & 1) t = (t + 13) % SIGNAL_CYCLE;
    return t < 10 ? 'green' : t < 13 ? 'yellow' : 'red';
  }

  /** force a full rebuild (e.g. after changing graphics settings) */
  rebuildAll(): void {
    this.grid?.markAll();
  }

  /**
   * Make `game.roadSurface.heightAt` (what vehicles, pedestrians and tools
   * sample) return exactly the rendered drivable surface: identical to the
   * frozen implementation on plain cells, plus continuous bridge decks and the
   * eased approach ramps of the bridge ends (which the flat per-cell deck model
   * cannot express). Undone on unload.
   */
  private bindSurface(surface: RoadSurface, hf: RoadHeightField): void {
    this.unbindSurface();
    surface.heightAt = (wx: number, wz: number): number => hf.heightAt(wx, wz);
    this.boundSurface = surface;
  }

  private unbindSurface(): void {
    const s = this.boundSurface;
    if (!s) return;
    // drop the own-property override → the prototype method is visible again
    delete (s as unknown as Record<string, unknown>).heightAt;
    this.boundSurface = null;
  }

  // ── internals ─────────────────────────────────────────────────────────────
  private hasSignals(x: number, y: number): boolean {
    const w = this.world!;
    const t = w.roadAt(x, y);
    if (t === RoadType.None || t === RoadType.Rail || t === RoadType.Pedestrian || t === RoadType.Highway) return false;
    const m = w.roadMask(x, y);
    let n = 0, rank = t === RoadType.Street || t === RoadType.Dirt ? 0 : 1;
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const nt = w.roadAt(x + [0, 1, 0, -1][d], y + [-1, 0, 1, 0][d]);
      if (nt === RoadType.Pedestrian) continue;
      n++;
      if (nt === RoadType.Avenue || nt === RoadType.Boulevard || nt === RoadType.TramAvenue || nt === RoadType.Highway) rank = 1;
    }
    return n >= 3 && rank > 0;
  }

  private onChanged(rect: Rect, layers: number): void {
    if (!(layers & (Layer.Road | Layer.Terrain | Layer.Water)) || !this.grid || !this.hf || !this.world) return;
    this.ownSurface?.invalidate(rect);
    this.hf.invalidate(rect);
    this.grid.markRect(rect, 3);
    this.markBridgeRuns(rect);
  }

  /** a changed bank or deck can move the whole bridge: mark every chunk its runs touch */
  private markBridgeRuns(r: Rect): void {
    const w = this.world!, g = this.grid!;
    // approach ramps reach up to 3 cells from a bridge end and depend on the land run up to 7 cells away
    const P = 8;
    const x0 = Math.max(0, r.x0 - P), y0 = Math.max(0, r.y0 - P), x1 = Math.min(w.size - 1, r.x1 + P), y1 = Math.min(w.size - 1, r.y1 + P);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 20000) return; // huge edits already dirty most chunks
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!w.isBridge(x, y)) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          let a = 0, b = 0;
          while (a < 256 && w.isBridge(x - dx * (a + 1), y - dy * (a + 1))) a++;
          while (b < 256 && w.isBridge(x + dx * (b + 1), y + dy * (b + 1))) b++;
          if (a + b === 0) continue;
          g.markRect({ x0: x - dx * a, y0: y - dy * a, x1: x + dx * b, y1: y + dy * b }, P);
        }
      }
  }

  private chunkDistance(key: number, cam: THREE.Vector3): number {
    const [cx, cy] = this.grid!.coords(key);
    const half = (CHUNK * CELL) / 2;
    const mx = cx * CHUNK * CELL + half, mz = cy * CHUNK * CELL + half;
    const w = this.world!;
    const gy = w.heightAt(Math.min(mx, w.size * CELL - 1), Math.min(mz, w.size * CELL - 1));
    // distance to the chunk's footprint rectangle (not its center)
    const dx = Math.max(0, Math.abs(cam.x - mx) - half), dz = Math.max(0, Math.abs(cam.z - mz) - half);
    return Math.hypot(dx, dz, cam.y - gy);
  }

  private inRange(key: number, fx: number, fy: number, radiusCells: number, factor: number): boolean {
    const [cx, cy] = this.grid!.coords(key);
    const mx = cx * CHUNK + CHUNK / 2, my = cy * CHUNK + CHUNK / 2;
    const r = radiusCells * factor + CHUNK * 0.75;
    return (mx - fx) ** 2 + (my - fy) ** 2 <= r * r;
  }

  /** LOD / visibility / disposal pass over built chunks */
  private sweep(cam: THREE.Vector3, fx: number, fy: number, radius: number): void {
    const g = this.grid!;
    let visible = 0;
    for (const [key, c] of this.chunks) {
      if (!this.inRange(key, fx, fy, radius, 1.5)) {
        if (c.built) {
          this.disposeMesh(c);
          this.furniture.setChunk(key, null);
          c.built = false;
          g.dirty.add(key); // rebuild when back in range
        }
        continue;
      }
      const vis = this.inRange(key, fx, fy, radius, 1.0);
      if (c.mesh) c.mesh.visible = vis;
      if (vis && c.mesh) visible++;
      if (!c.built || c.cells === 0) continue;
      const d = this.chunkDistance(key, cam);
      const want = c.lod === 0 ? (d > NEAR_OUT ? 1 : 0) : d < NEAR_IN ? 0 : 1;
      if (want !== c.lod) g.dirty.add(key);
    }
    this.stats.visibleChunks = visible;
    this.stats.pending = g.dirty.size;
  }

  private rebuild(cam: THREE.Vector3, fx: number, fy: number, radius: number): void {
    const g = this.grid!;
    if (!g.dirty.size) return;
    const cand: { key: number; d: number }[] = [];
    for (const key of g.dirty) {
      if (!this.inRange(key, fx, fy, radius, 1.2)) continue;
      cand.push({ key, d: this.chunkDistance(key, cam) });
    }
    if (!cand.length) return;
    cand.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    // first builds after a load get a bigger budget so the city appears quickly
    const budget = this.chunks.size < 4 ? this.budgetMs * 4 : this.budgetMs;
    for (const { key, d } of cand) {
      if (performance.now() - t0 > budget) break;
      g.dirty.delete(key);
      const prev = this.chunks.get(key);
      const lod = prev && prev.built ? (prev.lod === 0 ? (d > NEAR_OUT ? 1 : 0) : d < NEAR_IN ? 0 : 1) : d < NEAR_IN ? 0 : 1;
      this.buildChunk(key, lod, this.inRange(key, fx, fy, radius, 1.0));
    }
    this.stats.lastBuildMs = performance.now() - t0;
    this.stats.pending = g.dirty.size;
  }

  private buildChunk(key: number, lod: number, visible: boolean): void {
    const g = this.grid!, w = this.world!;
    const rect = g.rect(key);
    let c = this.chunks.get(key);
    if (!c) {
      c = { mesh: null, lod, built: false, cells: 0 };
      this.chunks.set(key, c);
    }
    this.disposeMesh(c);
    // quick empty test
    let any = false;
    for (let y = rect.y0; y <= rect.y1 && !any; y++) {
      const row = y * w.size;
      for (let x = rect.x0; x <= rect.x1; x++) if (w.road[row + x]) { any = true; break; }
    }
    if (!any) {
      this.furniture.setChunk(key, null);
      this.chunks.delete(key);
      this.updateCounts();
      return;
    }
    const res = this.builder!.build(rect, lod);
    c.lod = lod;
    c.built = true;
    c.cells = res.roadCells;
    if (res.geometry) {
      const mesh = new THREE.Mesh(res.geometry, this.material);
      mesh.name = `roads:${key}`;
      mesh.receiveShadow = true;
      mesh.castShadow = res.shadow;
      mesh.matrixAutoUpdate = false;
      mesh.visible = visible;
      mesh.updateMatrix();
      this.group.add(mesh);
      c.mesh = mesh;
    }
    this.furniture.setChunk(key, res.furniture);
    this.updateCounts();
  }

  private updateCounts(): void {
    let tris = 0;
    for (const c of this.chunks.values()) if (c.mesh) tris += (c.mesh.geometry.index?.count ?? 0) / 3;
    this.stats.chunks = this.chunks.size;
    this.stats.triangles = tris;
  }

  private disposeMesh(c: ChunkState): void {
    if (!c.mesh) return;
    c.mesh.removeFromParent();
    c.mesh.geometry.dispose();
    c.mesh = null;
  }

  private updateUniforms(dt: number, w: World, cam: THREE.Vector3): void {
    const r = this.game.renderer;
    const wt = w.weather;
    const raining = wt.type === 'rain' || wt.type === 'storm';
    const target = raining ? 0.55 + 0.45 * Math.min(1, wt.intensity) : wt.type === 'fog' ? 0.25 : 0;
    const rate = target > this.wet ? 0.35 : 0.04;
    this.wet += (target - this.wet) * Math.min(1, rate * dt * 3);
    this.snow += (wt.snowCover - this.snow) * Math.min(1, dt * 0.8);
    // follow the renderer's shared weather state when present (wet after rain, smoothed snow)
    const shared = (r as { shared?: { uWetness?: { value: number }; uSnow?: { value: number } } }).shared;
    if (shared?.uWetness) this.wet = Math.max(this.wet, shared.uWetness.value);
    if (shared?.uSnow) this.snow = shared.uSnow.value;
    this.uniforms.uWet.value = this.wet;
    this.uniforms.uSnow.value = this.snow;
    this.uniforms.uLeftHand.value = w.settings.leftHandTraffic ? 1 : 0;
    this.sigTime = (this.sigTime + Math.min(this.game.simDt, dt * 4)) % (SIGNAL_CYCLE * 1000);
    // seasonal canopy tint for median / plaza trees
    const cal = calendar(w.time.day);
    const yp = cal.yearProgress; // 0 = Jan 1
    if (yp < 0.25) this.canopy.copy(CANOPY_SPRING).lerp(CANOPY_SUMMER, Math.max(0, (yp - 0.12) / 0.13));
    else if (yp < 0.62) this.canopy.copy(CANOPY_SUMMER);
    else if (yp < 0.9) this.canopy.copy(CANOPY_SUMMER).lerp(CANOPY_AUTUMN, Math.min(1, (yp - 0.62) / 0.12));
    else this.canopy.copy(CANOPY_AUTUMN);
    const winter = cal.season === 'winter' && w.theme.snowiness > 0.02;
    const cam3 = r.camera;
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(cam3.fov) / 2)) / Math.max(1, r.canvas.clientHeight || r.canvas.height || 800);
    this.furniture.setState(r.lighting.night, this.snow, this.canopy, winter, this.sigTime, px, this.wet);
    void cam;
    void this.tmpV;
    void this.sphere;
  }
}
