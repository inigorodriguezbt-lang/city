// Zone / zoning-grid / district ground overlays.
//
// Per 32×32 chunk up to three draped meshes (one draw call each, only when
// they have content and are shown):
//   zoned     – zoned cells without a building: translucent zone-color tile
//               with a thin inset outline. Always visible; stronger while the
//               zoning grid is shown.
//   grid      – every other zoneable land cell (within MAX_ZONE_DEPTH of a
//               zoning road, same rule as WorldActions): faint white tiles.
//               Visible only while a zoning tool is active (fades in/out).
//   districts – district color wash with a crisp border + inner glow along
//               district boundaries; also drawn over road cells (at the road
//               surface) so districts read as continuous regions.
//
// The overlay is draped on the terrain corner heights with the SAME triangle
// diagonal the terrain renderer uses ((x + y) odd → b–c), lifted a few cm and
// polygon-offset, so it never z-fights or cuts into slopes. Outlines are
// analytic in the fragment shader (fwidth anti-aliased) → crisp at any zoom
// with 4 vertices per cell.
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { CELL, CHUNK, MAX_LOT_SLOPE, MAX_ZONE_DEPTH } from '../../core/constants';
import { ChunkGrid } from '../../core/chunks';
import { DIR_DX, DIR_DY, Layer, RoadType, ZoneType, type Rect } from '../../core/types';
import { roadDef } from '../../data/roads';
import { ZONES } from '../../data/zones';
import { ROAD_LIFT, SIDEWALK_LIFT } from '../../world/roadHeight';

/** overlay lift above the terrain (m) */
const LIFT = 0.07;
/** zone / grid tiles are shown within this many cells of the camera focus */
const ZONE_VIEW_CELLS = 170;
/** lift above the road surface for district paint on road cells (m) */
const ROAD_PAINT_LIFT = SIDEWALK_LIFT - ROAD_LIFT + 0.14;

const enum L {
  Zoned = 0,
  Grid = 1,
  District = 2,
}

interface ChunkMeshes {
  meshes: (THREE.Mesh | null)[];
}

// ── shader ──────────────────────────────────────────────────────────────────
const VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec2 aUV;
attribute vec4 aCol;
attribute vec4 aExt;
varying vec2 vUV;
varying vec4 vCol;
varying vec4 vExt;
varying float vDist;
void main() {
  vUV = aUV;
  vCol = aCol;
  vExt = aExt;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDist = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;   // layer fade (grid / districts)
uniform float uGrid;      // 0..1 zoning grid emphasis (zoned layer)
uniform float uLight;     // scene light level for the overlay
uniform float uGap;       // gap between tiles (m, each side)
uniform float uLineW;     // tile outline width (m)
uniform float uBorderW;   // district border width (m)
uniform float uTime;
uniform float uFadeFar;   // distance (m) where the layer has faded out
varying vec2 vUV;
varying vec4 vCol;
varying vec4 vExt;
varying float vDist;

float bit(float m, float b) { return mod(floor(m / b + 0.001), 2.0); }

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUV * 16.0;
  vec2 q = min(p, 16.0 - p);
  float dEdge = min(q.x, q.y);
  float aa = max(fwidth(dEdge), 1e-4);
  // weights: vExt = (fill alpha, outline alpha, border alpha, mask)
  float fillA = vCol.a, lineA = vExt.x, bordA = vExt.y;
  float mask = floor(vExt.z * 255.0 + 0.5);
  // zoned layer gets stronger while the zoning grid is visible
  fillA *= mix(1.0, vExt.w * 4.0, uGrid);
  lineA *= mix(1.0, 1.45, uGrid);

  float a = 0.0;
  vec3 col = vCol.rgb;
  // ── tile fill + outline (inset square per cell) ──
  if (uGap > 0.0 || uLineW > 0.0) {
    float gap = max(uGap, aa * 0.5);
    float tile = smoothstep(gap - aa, gap + aa, dEdge) * (uGap / gap);
    float lw = max(uLineW, aa * 1.2);
    float line = tile * (1.0 - smoothstep(gap + lw - aa, gap + lw + aa, dEdge)) * (uLineW / lw);
    // subtle inner gradient toward the outline so tiles read as slightly raised
    float inner = smoothstep(gap + lw, gap + lw + 3.0, dEdge);
    a = tile * fillA * mix(1.25, 0.85, inner);
    vec3 lc = mix(col, vec3(1.0), 0.35);
    col = mix(col, lc, line);
    a = max(a, line * lineA);
  } else {
    a = fillA;
  }
  // ── district borders (sides N=1 E=2 S=4 W=8, concave corners NE=16 SE=32 SW=64 NW=128) ──
  if (mask > 0.5) {
    float d = 1e3;
    if (bit(mask, 1.0) > 0.5) d = min(d, p.y);
    if (bit(mask, 2.0) > 0.5) d = min(d, 16.0 - p.x);
    if (bit(mask, 4.0) > 0.5) d = min(d, 16.0 - p.y);
    if (bit(mask, 8.0) > 0.5) d = min(d, p.x);
    if (bit(mask, 16.0) > 0.5) d = min(d, length(vec2(16.0 - p.x, p.y)));
    if (bit(mask, 32.0) > 0.5) d = min(d, length(vec2(16.0 - p.x, 16.0 - p.y)));
    if (bit(mask, 64.0) > 0.5) d = min(d, length(vec2(p.x, 16.0 - p.y)));
    if (bit(mask, 128.0) > 0.5) d = min(d, length(p));
    float daa = max(fwidth(d), 1e-4);
    // at least ~2.5 px wide so borders stay readable when zoomed out
    float bw = max(uBorderW, daa * 2.5);
    float border = 1.0 - smoothstep(bw - daa, bw + daa, d);
    float glow = exp(-max(0.0, d - bw) / max(2.6, daa * 7.0));
    col = mix(col, col * 1.15 + 0.04, border);
    a = max(a, max(border * bordA, glow * bordA * 0.5));
  }
  a *= uOpacity * (1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, vDist));
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function overlayMaterial(opts: { gap: number; lineW: number; borderW: number; order: number; fadeFar: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOpacity: { value: 1 },
        uGrid: { value: 0 },
        uLight: { value: 1 },
        uGap: { value: opts.gap },
        uLineW: { value: opts.lineW },
        uBorderW: { value: opts.borderW },
        uTime: { value: 0 },
        uFadeFar: { value: opts.fadeFar },
      },
    ]),
    vertexShader: VS,
    fragmentShader: FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4 - opts.order,
  });
  return m;
}

// ── geometry buffer ─────────────────────────────────────────────────────────
class OverlayBuf {
  pos = new Float32Array(3 * 4 * 256);
  uv = new Uint8Array(2 * 4 * 256);
  col = new Uint8Array(4 * 4 * 256);
  ext = new Uint8Array(4 * 4 * 256);
  idx: number[] = [];
  nv = 0;

  reset(): void {
    this.nv = 0;
    this.idx.length = 0;
  }

  private grow(): void {
    const n = this.pos.length / 3 * 2;
    const p = new Float32Array(n * 3), u = new Uint8Array(n * 2), c = new Uint8Array(n * 4), e = new Uint8Array(n * 4);
    p.set(this.pos);
    u.set(this.uv);
    c.set(this.col);
    e.set(this.ext);
    this.pos = p;
    this.uv = u;
    this.col = c;
    this.ext = e;
  }

  /**
   * One cell quad. h = corner heights [a (x,y), b (x+1,y), c (x,y+1), d (x+1,y+1)].
   * rgb 0..255, fillA/lineA/bordA 0..1, mask border bits, gridBoost fill multiplier/4 for grid mode.
   */
  cell(x: number, y: number, h: ArrayLike<number>, rgb: [number, number, number], fillA: number, lineA: number, bordA: number, mask: number, gridBoost: number): void {
    if ((this.nv + 4) * 3 > this.pos.length) this.grow();
    const v = this.nv;
    const x0 = x * CELL, z0 = y * CELL;
    const P = this.pos, U = this.uv, C = this.col, E = this.ext;
    const corners = [
      [x0, z0, 0, 0],
      [x0 + CELL, z0, 1, 0],
      [x0, z0 + CELL, 0, 1],
      [x0 + CELL, z0 + CELL, 1, 1],
    ];
    const fa = Math.round(Math.min(1, fillA) * 255), la = Math.round(Math.min(1, lineA) * 255), ba = Math.round(Math.min(1, bordA) * 255);
    const gb = Math.round(Math.min(1, gridBoost / 4) * 255);
    for (let k = 0; k < 4; k++) {
      const i = v + k;
      P[i * 3] = corners[k][0];
      P[i * 3 + 1] = h[k];
      P[i * 3 + 2] = corners[k][1];
      U[i * 2] = corners[k][2] * 255;
      U[i * 2 + 1] = corners[k][3] * 255;
      C[i * 4] = rgb[0];
      C[i * 4 + 1] = rgb[1];
      C[i * 4 + 2] = rgb[2];
      C[i * 4 + 3] = fa;
      E[i * 4] = la;
      E[i * 4 + 1] = ba;
      E[i * 4 + 2] = mask;
      E[i * 4 + 3] = gb;
    }
    // same diagonal as the terrain mesh
    if ((x + y) & 1) this.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    else this.idx.push(v, v + 2, v + 3, v, v + 3, v + 1);
    this.nv += 4;
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (!this.nv) return null;
    const n = this.nv;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('aUV', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2, true));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col.slice(0, n * 4), 4, true));
    g.setAttribute('aExt', new THREE.BufferAttribute(this.ext.slice(0, n * 4), 4, true));
    g.setIndex(n < 65535 ? new THREE.BufferAttribute(new Uint16Array(this.idx), 1) : new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function hexRgb(hex: string): [number, number, number] {
  // linear working-space color → 0..255 (the shader outputs linear, colorspace_fragment encodes)
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

const ZONE_RGB: [number, number, number][] = [];
for (const z of ZONES) ZONE_RGB[z.type] = hexRgb(z.color);
const WHITE: [number, number, number] = [235, 240, 245];

export class ZoneRenderer {
  protected world: World | null = null;
  /** root group of all zone / district overlays */
  readonly group = new THREE.Group();
  /** per-frame rebuild budget (ms) */
  budgetMs = 2;
  readonly stats = { chunks: 0, cells: 0, pending: 0, lastBuildMs: 0 };

  private grid: ChunkGrid | null = null;
  private chunks = new Map<number, ChunkMeshes>();
  private mats: THREE.ShaderMaterial[];
  private buf = [new OverlayBuf(), new OverlayBuf(), new OverlayBuf()];
  private offs: (() => void)[] = [];
  private gridOn = false;
  private districtsOn = false;
  private gridFade = 0;
  private distFade = 0;
  private sweepTimer = 0;
  private time = 0;
  private districtRgb: ([number, number, number] | undefined)[] = [];
  private districtKey = '';
  private h = new Float64Array(4);

  constructor(protected game: Game) {
    this.group.name = 'zones';
    this.mats = [
      overlayMaterial({ gap: 0.45, lineW: 0.32, borderW: 0, order: 0, fadeFar: 4500 }),
      overlayMaterial({ gap: 0.45, lineW: 0.26, borderW: 0, order: 0, fadeFar: 4500 }),
      overlayMaterial({ gap: 0, lineW: 0, borderW: 1.5, order: 1, fadeFar: 1e6 }),
    ];
    this.mats[L.Grid].uniforms.uOpacity.value = 0;
    this.mats[L.District].uniforms.uOpacity.value = 0;
  }

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.grid = new ChunkGrid(world.size);
    this.grid.markAll();
    this.districtKey = this.districtSignature(world);
    this.refreshDistrictColors(world);
    this.game.renderer.scene.add(this.group);
    this.offs.push(this.game.events.on('world:changed', ({ rect, layers }) => this.onChanged(rect, layers)));
  }

  onWorldUnloaded(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.group.removeFromParent();
    this.world = null;
    this.grid = null;
  }

  update(dt: number): void {
    const w = this.world;
    if (!w || !this.grid) return;
    this.time += dt;
    // layer fades
    const k = Math.min(1, dt * 9);
    this.gridFade += ((this.gridOn ? 1 : 0) - this.gridFade) * k;
    this.distFade += ((this.districtsOn ? 1 : 0) - this.distFade) * k;
    if (Math.abs(this.gridFade - (this.gridOn ? 1 : 0)) < 0.002) this.gridFade = this.gridOn ? 1 : 0;
    if (Math.abs(this.distFade - (this.districtsOn ? 1 : 0)) < 0.002) this.distFade = this.districtsOn ? 1 : 0;
    const light = this.lightLevel();
    for (const m of this.mats) m.uniforms.uTime.value = this.time;
    // while a zoning / district tool is active the overlay stays readable at night
    this.mats[L.Zoned].uniforms.uLight.value = Math.max(light, 0.55 * this.gridFade);
    this.mats[L.Grid].uniforms.uLight.value = Math.max(light, 0.6);
    this.mats[L.District].uniforms.uLight.value = Math.max(light, 0.6);
    this.mats[L.Zoned].uniforms.uGrid.value = this.gridFade;
    this.mats[L.Grid].uniforms.uOpacity.value = this.gridFade;
    this.mats[L.District].uniforms.uOpacity.value = this.distFade;
    // district palette edits (rename/recolor) don't emit world:changed
    const sig = this.districtSignature(w);
    if (sig !== this.districtKey) {
      this.districtKey = sig;
      this.refreshDistrictColors(w);
      for (const key of this.chunks.keys()) this.grid.dirty.add(key);
    }
    const view = this.game.renderer.getViewInfo();
    this.sweepTimer -= dt;
    if (this.sweepTimer <= 0) {
      this.sweepTimer = 0.35;
      this.sweep(view.focusX, view.focusY, view.radiusCells);
    }
    this.rebuild(view.focusX, view.focusY, view.radiusCells);
    this.applyVisibility();
  }

  /** show the zoning grid (zoneable cells near roads) — used while a zoning tool is active */
  setGridVisible(v: boolean): void {
    this.gridOn = v;
  }

  /** show district colors/borders (district tool / districts panel) */
  setDistrictsVisible(v: boolean): void {
    this.districtsOn = v;
  }

  get gridVisible(): boolean {
    return this.gridOn;
  }

  get districtsVisible(): boolean {
    return this.districtsOn;
  }

  /** force every chunk to rebuild (e.g. after a zone palette change) */
  rebuildAll(): void {
    this.grid?.markAll();
  }

  /** same rule as WorldActions.isZoneable (without zone-specific resource checks) */
  isZoneableCell(x: number, y: number): boolean {
    const w = this.world;
    if (!w || !w.inBounds(x, y)) return false;
    const i = w.idx(x, y);
    if (w.road[i] || w.isWater(x, y)) return false;
    const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
    if (b && b.kind === 'service') return false;
    if (w.cellSlope(x, y) > MAX_LOT_SLOPE) return false;
    return this.nearZoningRoad(w, x, y);
  }

  // ── internals ─────────────────────────────────────────────────────────────
  private lightLevel(): number {
    const lt = this.game.renderer.lighting;
    // lit like the ground by day, a faint self-lit tint at night
    const d = Math.min(1, Math.max(0, lt.daylight));
    return 0.025 + 0.975 * d * Math.sqrt(d);
  }

  private districtSignature(w: World): string {
    let s = '';
    for (const d of w.districts) s += d.id + ':' + d.color + ';';
    return s;
  }

  private refreshDistrictColors(w: World): void {
    this.districtRgb = [];
    for (const d of w.districts) this.districtRgb[d.id] = hexRgb(d.color);
  }

  private nearZoningRoad(w: World, x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      for (let k = 1; k <= MAX_ZONE_DEPTH; k++) {
        const cx = x + DIR_DX[d] * k, cy = y + DIR_DY[d] * k;
        if (!w.inBounds(cx, cy)) break;
        const i = w.idx(cx, cy);
        const r = w.road[i] as RoadType;
        if (r) {
          if (roadDef(r).allowsZoning) return true;
          break;
        }
        if (w.isWater(cx, cy)) break;
        const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
        if (b && b.kind === 'service') break;
      }
    }
    return false;
  }

  private onChanged(rect: Rect, layers: number): void {
    if (!this.grid) return;
    if (!(layers & (Layer.Zone | Layer.Road | Layer.Building | Layer.District | Layer.Terrain | Layer.Water))) return;
    // roads / water / service buildings change zoneability up to MAX_ZONE_DEPTH cells away
    const far = layers & (Layer.Road | Layer.Water | Layer.Building | Layer.Terrain);
    this.grid.markRect(rect, far ? MAX_ZONE_DEPTH + 1 : 1);
  }

  private inRange(key: number, fx: number, fy: number, radiusCells: number, factor: number): boolean {
    const [cx, cy] = this.grid!.coords(key);
    const mx = cx * CHUNK + CHUNK / 2, my = cy * CHUNK + CHUNK / 2;
    const r = radiusCells * factor + CHUNK * 0.75;
    return (mx - fx) ** 2 + (my - fy) ** 2 <= r * r;
  }

  private sweep(fx: number, fy: number, radius: number): void {
    const g = this.grid!;
    for (const [key, c] of this.chunks) {
      if (this.inRange(key, fx, fy, radius, 1.5)) continue;
      this.disposeChunk(c);
      this.chunks.delete(key);
      g.dirty.add(key); // rebuild when back in range
    }
    this.stats.chunks = this.chunks.size;
    this.stats.pending = g.dirty.size;
  }

  private rebuild(fx: number, fy: number, radius: number): void {
    const g = this.grid!;
    if (!g.dirty.size) return;
    const cand: { key: number; d: number }[] = [];
    for (const key of g.dirty) {
      if (!this.inRange(key, fx, fy, radius, 1.2)) continue;
      const [cx, cy] = g.coords(key);
      cand.push({ key, d: (cx * CHUNK + CHUNK / 2 - fx) ** 2 + (cy * CHUNK + CHUNK / 2 - fy) ** 2 });
    }
    if (!cand.length) return;
    cand.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    const budget = this.chunks.size < 4 ? this.budgetMs * 4 : this.budgetMs;
    for (const { key } of cand) {
      if (performance.now() - t0 > budget) break;
      g.dirty.delete(key);
      this.buildChunk(key, fx, fy, radius);
    }
    this.stats.lastBuildMs = performance.now() - t0;
    this.stats.pending = g.dirty.size;
    let cells = 0;
    for (const c of this.chunks.values()) for (const m of c.meshes) if (m) cells += (m.geometry.getAttribute('position').count / 4) | 0;
    this.stats.cells = cells;
    this.stats.chunks = this.chunks.size;
  }

  private cornerHeights(w: World, x: number, y: number, lift: number): Float64Array {
    const h = this.h;
    h[0] = w.vertexHeight(x, y) + lift;
    h[1] = w.vertexHeight(x + 1, y) + lift;
    h[2] = w.vertexHeight(x, y + 1) + lift;
    h[3] = w.vertexHeight(x + 1, y + 1) + lift;
    return h;
  }

  /** road-surface corner heights for district paint on road cells (bridges: deck) */
  private roadCorners(x: number, y: number): Float64Array {
    const h = this.h;
    const roads = (this.game as Partial<Game>).roads;
    const surf = this.game.roadSurface;
    const at = (wx: number, wz: number): number => {
      // sample slightly inside the cell so bridge decks / ramps of THIS cell are used
      const cx = Math.min(Math.max(wx, x * CELL + 0.05), (x + 1) * CELL - 0.05);
      const cz = Math.min(Math.max(wz, y * CELL + 0.05), (y + 1) * CELL - 0.05);
      if (roads && typeof roads.surfaceHeight === 'function') return roads.surfaceHeight(cx, cz);
      if (surf) return surf.heightAt(cx, cz);
      return this.world!.heightAt(cx, cz) + ROAD_LIFT;
    };
    h[0] = at(x * CELL, y * CELL) + ROAD_PAINT_LIFT;
    h[1] = at((x + 1) * CELL, y * CELL) + ROAD_PAINT_LIFT;
    h[2] = at(x * CELL, (y + 1) * CELL) + ROAD_PAINT_LIFT;
    h[3] = at((x + 1) * CELL, (y + 1) * CELL) + ROAD_PAINT_LIFT;
    return h;
  }

  private buildChunk(key: number, fx: number, fy: number, radius: number): void {
    const w = this.world!, g = this.grid!;
    const r = g.rect(key);
    const [bz, bg, bd] = this.buf;
    bz.reset();
    bg.reset();
    bd.reset();
    const hasDistricts = w.districts.length > 0;
    const S = w.size;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * S + x;
        const road = w.road[i] as RoadType;
        const wet = !road && w.isWater(x, y);
        // ── district wash ──
        const dist = hasDistricts ? w.district[i] : 0;
        if (dist && this.districtRgb[dist] && !wet) {
          const rgb = this.districtRgb[dist]!;
          const same = (dx: number, dy: number): boolean => {
            const xx = x + dx, yy = y + dy;
            return !w.inBounds(xx, yy) || w.district[yy * S + xx] === dist;
          };
          const n = same(0, -1), e = same(1, 0), s = same(0, 1), wv = same(-1, 0);
          let mask = (n ? 0 : 1) | (e ? 0 : 2) | (s ? 0 : 4) | (wv ? 0 : 8);
          if (n && e && !same(1, -1)) mask |= 16;
          if (s && e && !same(1, 1)) mask |= 32;
          if (s && wv && !same(-1, 1)) mask |= 64;
          if (n && wv && !same(-1, -1)) mask |= 128;
          const h = road ? this.roadCorners(x, y) : this.cornerHeights(w, x, y, LIFT + 0.02);
          bd.cell(x, y, h, rgb, road ? 0.2 : 0.3, 0, 1, mask, 1);
        }
        if (road || wet) continue;
        const bid = w.bldg[i];
        if (bid) continue; // buildings (zoned or service) cover their cells
        const z = w.zone[i] as ZoneType;
        if (z !== ZoneType.None) {
          const rgb = ZONE_RGB[z] ?? WHITE;
          // subtle wash + thin outline; grid mode: fill ×2.4, outline stronger (see shader)
          bz.cell(x, y, this.cornerHeights(w, x, y, LIFT), rgb, 0.1, 0.38, 0, 0, 2.4);
        } else if (this.isZoneableCell(x, y)) {
          bg.cell(x, y, this.cornerHeights(w, x, y, LIFT), WHITE, 0.05, 0.42, 0, 0, 1);
        }
      }
    let c = this.chunks.get(key);
    if (!c) {
      c = { meshes: [null, null, null] };
      this.chunks.set(key, c);
    }
    const visible = this.inRange(key, fx, fy, radius, 1.0);
    for (let l = 0; l < 3; l++) {
      const old = c.meshes[l];
      if (old) {
        old.removeFromParent();
        old.geometry.dispose();
        c.meshes[l] = null;
      }
      const geo = this.buf[l].toGeometry();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats[l]);
      m.name = `zones:${['zoned', 'grid', 'districts'][l]}:${key}`;
      m.matrixAutoUpdate = false;
      m.renderOrder = 2 + l;
      m.visible = visible && this.layerShown(l);
      this.group.add(m);
      c.meshes[l] = m;
    }
    if (!c.meshes[0] && !c.meshes[1] && !c.meshes[2]) this.chunks.delete(key);
  }

  private layerShown(l: number): boolean {
    if (l === L.Grid) return this.gridFade > 0.001;
    if (l === L.District) return this.distFade > 0.001;
    return true;
  }

  private applyVisibility(): void {
    const shown = [true, this.layerShown(L.Grid), this.layerShown(L.District)];
    const view = this.game.renderer.getViewInfo();
    // zone tiles are sub-pixel noise far away: bound their range (and draw calls);
    // district washes stay visible over the whole render distance
    const zoneR = Math.min(view.radiusCells, ZONE_VIEW_CELLS);
    for (const [key, c] of this.chunks) {
      const vis = this.inRange(key, view.focusX, view.focusY, view.radiusCells, 1.0);
      const near = vis && this.inRange(key, view.focusX, view.focusY, zoneR, 1.0);
      for (let l = 0; l < 3; l++) {
        const m = c.meshes[l];
        if (m) m.visible = (l === L.District ? vis : near) && shown[l];
      }
    }
  }

  private disposeChunk(c: ChunkMeshes): void {
    for (let l = 0; l < 3; l++) {
      const m = c.meshes[l];
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
      c.meshes[l] = null;
    }
  }

  dispose(): void {
    this.onWorldUnloaded();
    for (const m of this.mats) m.dispose();
  }
}
