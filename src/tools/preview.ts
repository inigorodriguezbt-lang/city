// ─────────────────────────────────────────────────────────────────────────────
// Tool preview primitives: draped cell tiles, ground circles (brushes and
// coverage rings) and the DOM cursor label. Everything here renders slightly
// above the terrain with depth testing on (polygon offset + small lift) so the
// previews hug slopes without z-fighting and are hidden behind hills.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CELL, WATER_EPS } from '../core/constants';
import type { World } from '../world/World';

// ── palette ──────────────────────────────────────────────────────────────────
export const TONE = {
  ok: 0x3ddc84,
  build: 0x7fe3ff,
  upgrade: 0x4cc2ff,
  existing: 0x9aa8bb,
  bridge: 0x6fd6ff,
  bad: 0xff5d5d,
  warn: 0xffb547,
  erase: 0xff7a59,
  accent: 0x4cc2ff,
  select: 0x4cc2ff,
  hover: 0xdfe9f7,
  demolish: 0xff4d4d,
} as const;

const tmpColor = new THREE.Color();

// ── shared shader chunks ─────────────────────────────────────────────────────
const TILE_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 tileColor;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    vColor = tileColor;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const TILE_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float inset = smoothstep(0.012, 0.035, e);
    float border = 1.0 - smoothstep(0.07, 0.13, e);
    float shimmer = 0.92 + 0.08 * sin(uTime * 3.2 + (vUv.x + vUv.y) * 2.0);
    float a = vColor.a * mix(0.42 * shimmer, 1.0, border) * inset;
    vec3 c = mix(vColor.rgb, min(vColor.rgb * 1.2 + 0.1, vec3(1.0)), border);
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`;

const CIRCLE_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float radial;
  attribute float around;
  varying float vR;
  varying float vA;
  void main() {
    vR = radial;
    vA = around;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const CIRCLE_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;       // center fill opacity
  uniform float uFalloff;    // 1 = brush falloff gradient, 0 = flat coverage fill
  uniform float uRingWidth;  // ring width as fraction of radius
  uniform float uDash;       // dash count (0 = solid)
  uniform float uTime;
  varying float vR;
  varying float vA;
  void main() {
    #include <logdepthbuf_fragment>
    float ring = smoothstep(1.0 - uRingWidth * 2.2, 1.0 - uRingWidth, vR) * (1.0 - smoothstep(0.985, 1.0, vR));
    if (uDash > 0.0) {
      float d = fract(vA * uDash - uTime * 0.25);
      ring *= smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.55, 0.63, d));
    }
    float fillShape = mix(0.35 + 0.65 * smoothstep(0.0, 1.0, vR), 1.0 - 0.75 * vR * vR, uFalloff);
    float fill = uFill * fillShape * (1.0 - smoothstep(0.97, 1.0, vR));
    float a = max(ring, fill) * uOpacity;
    vec3 c = mix(uColor, min(uColor * 1.25 + 0.12, vec3(1.0)), ring);
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`;

function overlayMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

/** ground (or water surface) elevation at a vertex, for draping */
function surfaceAtVertex(w: World, vx: number, vy: number): number {
  let h = w.vertexHeight(vx, vy);
  // lift onto water around wet cells so tiles don't sink under the surface
  for (let cy = vy - 1; cy <= vy; cy++)
    for (let cx = vx - 1; cx <= vx; cx++) {
      if (!w.inBounds(cx, cy)) continue;
      const wl = w.waterLevel(cx, cy);
      if (wl > w.cellHeight(cx, cy) + WATER_EPS && wl > h) h = wl;
    }
  return h;
}

/** ground (or water surface) at world meters */
export function surfaceAt(w: World, wx: number, wz: number): number {
  const h = w.heightAt(wx, wz);
  const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
  if (w.inBounds(cx, cy)) {
    const wl = w.waterLevel(cx, cy);
    if (wl > w.cellHeight(cx, cy) + WATER_EPS && wl > h) return wl;
  }
  return h;
}

// ════════════════════════════════════════════════════════════════════════════
// TileLayer: one translucent rounded-border quad per grid cell.
// ════════════════════════════════════════════════════════════════════════════

export interface TileOpts {
  /** override the 4 corner heights (NW, NE, SW, SE) */
  corners?: [number, number, number, number];
  /** flat height for the whole tile (bridge decks) */
  flat?: number;
  /** extra lift in meters */
  lift?: number;
}

export class TileLayer {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private cap = 0;
  private count = 0;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private uvs = new Float32Array(0);
  private lift: number;

  constructor(opts: { lift?: number; renderOrder?: number } = {}) {
    this.lift = opts.lift ?? 0.35;
    this.mat = overlayMaterial(TILE_VERT, TILE_FRAG, { uTime: { value: 0 } });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 20;
    this.mesh.name = 'tool-tiles';
    this.mesh.userData.toolOwned = true;
    this.ensure(64);
  }

  private ensure(n: number): void {
    if (n <= this.cap) return;
    let cap = Math.max(64, this.cap);
    while (cap < n) cap *= 2;
    const pos = new Float32Array(cap * 12);
    const col = new Float32Array(cap * 16);
    const uvs = new Float32Array(cap * 8);
    pos.set(this.pos);
    col.set(this.col);
    uvs.set(this.uvs);
    this.pos = pos;
    this.col = col;
    this.uvs = uvs;
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v;
      idx[o + 1] = v + 2;
      idx[o + 2] = v + 1;
      idx[o + 3] = v + 1;
      idx[o + 4] = v + 2;
      idx[o + 5] = v + 3;
      const u = i * 8;
      uvs[u] = 0; uvs[u + 1] = 0;
      uvs[u + 2] = 1; uvs[u + 3] = 0;
      uvs[u + 4] = 0; uvs[u + 5] = 1;
      uvs[u + 6] = 1; uvs[u + 7] = 1;
    }
    this.cap = cap;
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tileColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh.geometry = this.geo;
  }

  /** start a new frame of tiles */
  begin(): void {
    this.count = 0;
  }

  /** add a tile for cell (x, y) */
  add(w: World, x: number, y: number, color: number | THREE.Color, alpha = 0.6, o?: TileOpts): void {
    if (!w.inBounds(x, y)) return;
    this.ensure(this.count + 1);
    const i = this.count++;
    const lift = this.lift + (o?.lift ?? 0);
    let h00: number, h10: number, h01: number, h11: number;
    if (o?.flat !== undefined) h00 = h10 = h01 = h11 = o.flat;
    else if (o?.corners) [h00, h10, h01, h11] = o.corners;
    else {
      h00 = surfaceAtVertex(w, x, y);
      h10 = surfaceAtVertex(w, x + 1, y);
      h01 = surfaceAtVertex(w, x, y + 1);
      h11 = surfaceAtVertex(w, x + 1, y + 1);
    }
    const p = this.pos, b = i * 12;
    const x0 = x * CELL, x1 = (x + 1) * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
    p[b] = x0; p[b + 1] = h00 + lift; p[b + 2] = z0;
    p[b + 3] = x1; p[b + 4] = h10 + lift; p[b + 5] = z0;
    p[b + 6] = x0; p[b + 7] = h01 + lift; p[b + 8] = z1;
    p[b + 9] = x1; p[b + 10] = h11 + lift; p[b + 11] = z1;
    const c = typeof color === 'number' ? tmpColor.setHex(color) : color;
    const q = this.col, k = i * 16;
    for (let v = 0; v < 4; v++) {
      q[k + v * 4] = c.r;
      q[k + v * 4 + 1] = c.g;
      q[k + v * 4 + 2] = c.b;
      q[k + v * 4 + 3] = alpha;
    }
  }

  /** upload the tiles added since begin() */
  end(): void {
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const ca = this.geo.getAttribute('tileColor') as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    ca.clearUpdateRanges();
    pa.addUpdateRange(0, this.count * 12);
    ca.addUpdateRange(0, this.count * 16);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
    this.mesh.visible = this.count > 0;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.begin();
    this.end();
  }

  tick(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BoxLayer: translucent glass boxes with glowing edges around buildings
// (demolition / replacement warnings). One instanced draw call.
// ════════════════════════════════════════════════════════════════════════════

const BOX_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vTop;
  void main() {
    vUv = uv;
    vTop = step(0.99, position.y) * step(0.99, normal.y);
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
    #include <logdepthbuf_vertex>
  }
`;

const BOX_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vTop;
  void main() {
    #include <logdepthbuf_fragment>
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.045, e);
    float scan = 0.5 + 0.5 * sin(vUv.y * 18.0 - uTime * 4.0);
    float a = uOpacity * (0.16 + 0.1 * scan * (1.0 - vTop) + 0.75 * edge);
    gl_FragColor = vec4(min(vColor * (1.0 + edge * 0.4) + edge * 0.1, vec3(1.0)), a);
    #include <colorspace_fragment>
  }
`;

export class BoxLayer {
  private inst: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private cap: number;
  private n = 0;
  private m = new THREE.Matrix4();

  constructor(cap = 64) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.mat = overlayMaterial(BOX_VERT, BOX_FRAG, { uTime: { value: 0 }, uOpacity: { value: 1 } });
    this.mat.polygonOffset = false;
    this.cap = cap;
    this.inst = new THREE.InstancedMesh(geo, this.mat, cap);
    this.inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.inst.frustumCulled = false;
    this.inst.renderOrder = 23;
    this.inst.count = 0;
    this.inst.visible = false;
    this.inst.name = 'tool-boxes';
    this.inst.userData.toolOwned = true;
  }

  /** the instanced mesh (replaced when capacity grows; parent is kept) */
  get mesh(): THREE.InstancedMesh {
    return this.inst;
  }

  begin(): void {
    this.n = 0;
  }

  /** a box over cells [x, x+w) × [y, y+h) from ground to ground+height */
  add(x: number, y: number, w: number, h: number, ground: number, height: number, color: number): void {
    if (this.n >= this.cap) this.grow();
    const pad = 0.9;
    this.m.makeScale(w * CELL + pad, Math.max(2, height) + pad, h * CELL + pad).setPosition((x + w / 2) * CELL, ground - 0.3, (y + h / 2) * CELL);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, tmpColor.setHex(color));
    this.n++;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const next = new THREE.InstancedMesh(this.mesh.geometry, this.mat, cap);
    next.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (let i = 0; i < this.n; i++) {
      this.mesh.getMatrixAt(i, this.m);
      next.setMatrixAt(i, this.m);
      this.mesh.getColorAt(i, tmpColor);
      next.setColorAt(i, tmpColor);
    }
    next.frustumCulled = false;
    next.renderOrder = this.mesh.renderOrder;
    next.name = this.mesh.name;
    next.userData.toolOwned = true;
    const parent = this.inst.parent;
    parent?.remove(this.inst);
    this.inst.dispose();
    this.inst = next;
    parent?.add(next);
    this.cap = cap;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }

  clear(): void {
    this.begin();
    this.end();
  }

  tick(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

/** approximate building bounds for warning boxes (renderer height if known) */
export function buildingBox(game: { buildings: { buildingTop(id: number): number } }, w: World, b: { id: number; x: number; y: number; w: number; h: number; kind: string; level: number }, defHeight?: number): { ground: number; height: number } {
  let ground = Infinity;
  for (let vy = b.y; vy <= b.y + b.h; vy++) for (let vx = b.x; vx <= b.x + b.w; vx++) ground = Math.min(ground, w.vertexHeight(vx, vy));
  let top = 0;
  try {
    top = game.buildings.buildingTop(b.id);
  } catch {
    top = 0;
  }
  const est = b.kind === 'zoned' ? 5 + b.level * 5 : Math.max(6, Math.min(90, defHeight ?? 12));
  const height = top > ground + 1.5 ? top - ground : est;
  return { ground, height };
}

// ════════════════════════════════════════════════════════════════════════════
// GroundCircle: draped disc with a crisp ring (brushes, coverage radii).
// ════════════════════════════════════════════════════════════════════════════

export interface CircleStyle {
  color: number;
  opacity?: number;
  /** center fill opacity 0..1 */
  fill?: number;
  /** 1 = brush falloff (dense center), 0 = coverage (brighter toward edge) */
  falloff?: number;
  /** ring width in meters */
  ringWidth?: number;
  /** dashes around the ring (0 = solid) */
  dashes?: number;
  lift?: number;
}

export class GroundCircle {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private rings = 0;
  private segs = 0;
  private lift = 0.8;
  private ringWidthM = 3;
  private radius = 1;
  private lastKey = '';

  constructor(style: CircleStyle) {
    this.mat = overlayMaterial(CIRCLE_VERT, CIRCLE_FRAG, {
      uColor: { value: new THREE.Color(style.color) },
      uOpacity: { value: style.opacity ?? 0.9 },
      uFill: { value: style.fill ?? 0.12 },
      uFalloff: { value: style.falloff ?? 0 },
      uRingWidth: { value: 0.03 },
      uDash: { value: style.dashes ?? 0 },
      uTime: { value: 0 },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.name = 'tool-circle';
    this.mesh.userData.toolOwned = true;
    this.mesh.visible = false;
    this.setStyle(style);
  }

  setStyle(s: Partial<CircleStyle>): void {
    const u = this.mat.uniforms;
    if (s.color !== undefined) (u.uColor.value as THREE.Color).setHex(s.color);
    if (s.opacity !== undefined) u.uOpacity.value = s.opacity;
    if (s.fill !== undefined) u.uFill.value = s.fill;
    if (s.falloff !== undefined) u.uFalloff.value = s.falloff;
    if (s.dashes !== undefined) u.uDash.value = s.dashes;
    if (s.ringWidth !== undefined) this.ringWidthM = s.ringWidth;
    if (s.lift !== undefined) this.lift = s.lift;
  }

  private build(rings: number, segs: number): void {
    this.rings = rings;
    this.segs = segs;
    const nv = (rings + 1) * (segs + 1);
    const pos = new Float32Array(nv * 3);
    const radial = new Float32Array(nv);
    const around = new Float32Array(nv);
    for (let r = 0; r <= rings; r++)
      for (let s = 0; s <= segs; s++) {
        const v = r * (segs + 1) + s;
        radial[v] = r / rings;
        around[v] = s / segs;
      }
    const idx: number[] = [];
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('radial', new THREE.BufferAttribute(radial, 1));
    this.geo.setAttribute('around', new THREE.BufferAttribute(around, 1));
    this.geo.setIndex(idx);
    this.mesh.geometry = this.geo;
  }

  /** place the circle at world (wx, wz) with radius in meters */
  set(w: World, wx: number, wz: number, radius: number): void {
    const key = `${wx.toFixed(2)},${wz.toFixed(2)},${radius.toFixed(2)}`;
    this.mesh.visible = radius > 0.5;
    if (key === this.lastKey || !this.mesh.visible) return;
    this.lastKey = key;
    this.radius = radius;
    // radial spacing ~12 m for draping; ring segments ~ 6 m (min 48)
    const rings = Math.max(3, Math.min(48, Math.ceil(radius / 12)));
    const segs = Math.max(48, Math.min(256, Math.ceil((radius * Math.PI * 2) / 6)));
    // extra outer micro-ring so the rim follows the terrain tightly
    if (rings !== this.rings || segs !== this.segs) this.build(rings, segs);
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const p = pa.array as Float32Array;
    for (let r = 0; r <= rings; r++) {
      const rr = (r / rings) * radius;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const x = wx + Math.cos(a) * rr, z = wz + Math.sin(a) * rr;
        const v = (r * (segs + 1) + s) * 3;
        p[v] = x;
        p[v + 1] = surfaceAt(w, x, z) + this.lift;
        p[v + 2] = z;
      }
    }
    pa.needsUpdate = true;
    this.mat.uniforms.uRingWidth.value = Math.min(0.2, this.ringWidthM / Math.max(1, radius));
  }

  get currentRadius(): number {
    return this.radius;
  }

  hide(): void {
    this.mesh.visible = false;
    this.lastKey = '';
  }

  tick(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CursorLabel: glass pill next to the cursor (length, cost, errors).
// ════════════════════════════════════════════════════════════════════════════

export type LabelTone = 'ok' | 'bad' | 'warn' | 'info' | 'dim';

export interface LabelContent {
  /** main line, e.g. "Street · 192 m" */
  title: string;
  /** right-hand value pill, e.g. "$720" */
  value?: string;
  valueTone?: 'money' | 'bad' | 'dim' | 'refund';
  /** second line (reason / hint) */
  sub?: string;
  subTone?: LabelTone;
  /** status dot color */
  tone?: LabelTone;
  /** optional key hints ["Shift", "straight"] pairs */
  keys?: [string, string][];
}

const STYLE_ID = 'urbis-tool-label-style';
const CSS = `
.utl { position: fixed; left: 0; top: 0; z-index: 70; pointer-events: none; transform-origin: 0 0;
  font: 600 12.5px/1.3 var(--font, system-ui, sans-serif); color: var(--text, #e8eef7);
  background: linear-gradient(180deg, rgba(22,30,43,.94), rgba(12,17,25,.94));
  border: 1px solid var(--stroke-strong, rgba(255,255,255,.18)); border-radius: 11px;
  box-shadow: 0 10px 28px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.06) inset;
  -webkit-backdrop-filter: var(--blur, blur(14px)); backdrop-filter: var(--blur, blur(14px));
  padding: 7px 10px 7px 10px; min-width: 64px; max-width: 380px; white-space: nowrap;
  opacity: 0; transition: opacity .14s var(--ease, ease), filter .14s; will-change: transform, opacity; }
.utl.on { opacity: 1; }
.utl-row { display: flex; align-items: center; gap: 8px; }
.utl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; box-shadow: 0 0 8px currentColor; background: currentColor; }
.utl-title { flex: 1 1 auto; letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; }
.utl-val { flex: none; font: 700 12px/1 var(--font-mono, ui-monospace, monospace); padding: 4px 7px; border-radius: 7px;
  background: rgba(126,231,135,.12); color: var(--money, #7ee787); border: 1px solid rgba(126,231,135,.25); }
.utl-val.bad { background: rgba(255,93,93,.12); color: #ff8a8a; border-color: rgba(255,93,93,.3); }
.utl-val.dim { background: rgba(255,255,255,.06); color: var(--text-dim, #9aa8bb); border-color: var(--stroke, rgba(255,255,255,.09)); }
.utl-val.refund { background: rgba(76,194,255,.12); color: #8fd8ff; border-color: rgba(76,194,255,.3); }
.utl-sub { margin-top: 4px; font-weight: 500; font-size: 11.5px; color: var(--text-dim, #9aa8bb); white-space: normal; }
.utl-sub.bad { color: #ff8a8a; } .utl-sub.warn { color: var(--warn, #ffb547); } .utl-sub.ok { color: var(--good, #3ddc84); }
.utl-keys { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px 8px; font-weight: 500; font-size: 10.5px; color: var(--text-faint, #66758a); }
.utl-keys kbd { font: 600 10px/1 var(--font-mono, ui-monospace, monospace); color: var(--text-dim, #9aa8bb); padding: 2px 4px; margin-right: 3px;
  border-radius: 4px; border: 1px solid var(--stroke-strong, rgba(255,255,255,.18)); border-bottom-width: 2px; background: rgba(255,255,255,.04); }
.utl-flash { position: fixed; left: 0; top: 0; z-index: 71; pointer-events: none; transform-origin: 0 0;
  font: 800 14px/1 var(--font-display, var(--font, system-ui)); letter-spacing: .02em; text-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 1px rgba(0,0,0,.9);
  animation: utl-rise 1.05s var(--ease, ease-out) forwards; }
.utl-flash.money { color: #ffb4b4; } .utl-flash.refund { color: var(--money, #7ee787); } .utl-flash.bad { color: #ff7373; } .utl-flash.info { color: var(--accent, #4cc2ff); }
@keyframes utl-rise { 0% { opacity: 0; translate: 0 6px; } 15% { opacity: 1; translate: 0 0; } 70% { opacity: 1; } 100% { opacity: 0; translate: 0 -30px; } }
@media (pointer: coarse) { .utl { font-size: 13.5px; padding: 8px 12px; } }
@media (prefers-reduced-motion: reduce) { .utl { transition: none; } .utl-flash { animation-duration: .6s; } }
`;

function injectStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

const TONE_CSS: Record<LabelTone, string> = {
  ok: 'var(--good, #3ddc84)',
  bad: 'var(--bad, #ff5d5d)',
  warn: 'var(--warn, #ffb547)',
  info: 'var(--accent, #4cc2ff)',
  dim: 'var(--text-faint, #66758a)',
};

let coarseMq: MediaQueryList | null = null;
function coarsePointer(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  coarseMq ??= matchMedia('(pointer: coarse)');
  return coarseMq.matches;
}

function uiScale(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export class CursorLabel {
  private el: HTMLDivElement | null = null;
  private dot!: HTMLSpanElement;
  private title!: HTMLSpanElement;
  private val!: HTMLSpanElement;
  private sub!: HTMLDivElement;
  private keys!: HTMLDivElement;
  private lastHtmlKey = '';
  private scale = 1;
  private scaleAt = 0;

  private ensure(): HTMLDivElement {
    if (this.el) return this.el;
    injectStyle();
    const el = document.createElement('div');
    el.className = 'utl';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const row = document.createElement('div');
    row.className = 'utl-row';
    this.dot = document.createElement('span');
    this.dot.className = 'utl-dot';
    this.title = document.createElement('span');
    this.title.className = 'utl-title';
    this.val = document.createElement('span');
    this.val.className = 'utl-val';
    row.append(this.dot, this.title, this.val);
    this.sub = document.createElement('div');
    this.sub.className = 'utl-sub';
    this.keys = document.createElement('div');
    this.keys.className = 'utl-keys';
    el.append(row, this.sub, this.keys);
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  private currentScale(): number {
    const now = performance.now();
    if (now - this.scaleAt > 500) {
      this.scale = uiScale();
      this.scaleAt = now;
    }
    return this.scale;
  }

  /** show the label with its top-left near client point (x, y) */
  show(x: number, y: number, c: LabelContent): void {
    const el = this.ensure();
    const key = JSON.stringify(c);
    if (key !== this.lastHtmlKey) {
      this.lastHtmlKey = key;
      this.dot.style.color = TONE_CSS[c.tone ?? 'info'];
      this.title.textContent = c.title;
      this.val.textContent = c.value ?? '';
      this.val.style.display = c.value ? '' : 'none';
      this.val.className = 'utl-val' + (c.valueTone && c.valueTone !== 'money' ? ' ' + c.valueTone : '');
      this.sub.textContent = c.sub ?? '';
      this.sub.style.display = c.sub ? '' : 'none';
      this.sub.className = 'utl-sub' + (c.subTone ? ' ' + c.subTone : '');
      this.keys.replaceChildren();
      if (c.keys?.length) {
        for (const [k, t] of c.keys) {
          const s = document.createElement('span');
          const kb = document.createElement('kbd');
          kb.textContent = k;
          s.append(kb, t);
          this.keys.append(s);
        }
        this.keys.style.display = '';
      } else this.keys.style.display = 'none';
    }
    const sc = this.currentScale();
    const w = el.offsetWidth * sc, h = el.offsetHeight * sc;
    const off = 18 * sc;
    let px = x + off, py = y + off;
    if (coarsePointer()) {
      // touch: keep the label above the finger
      px = x - w / 2;
      py = y - 56 * sc - h;
      if (py < 6) py = y + 48 * sc;
    } else {
      if (px + w > window.innerWidth - 6) px = x - off - w;
      if (py + h > window.innerHeight - 6) py = y - off - h;
    }
    px = Math.max(6, Math.min(px, window.innerWidth - w - 6));
    py = Math.max(6, Math.min(py, window.innerHeight - h - 6));
    el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0) scale(${sc})`;
    el.classList.add('on');
  }

  hide(): void {
    this.el?.classList.remove('on');
  }

  /** floating "-$720" style feedback that rises and fades at a client point */
  static flash(x: number, y: number, text: string, tone: 'money' | 'refund' | 'bad' | 'info' = 'money'): void {
    if (typeof document === 'undefined') return;
    injectStyle();
    const el = document.createElement('div');
    el.className = `utl-flash ${tone}`;
    el.textContent = text;
    const sc = uiScale();
    el.style.transform = `translate3d(${Math.round(x + 14 * sc)}px, ${Math.round(y - 26 * sc)}px, 0) scale(${sc})`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.lastHtmlKey = '';
  }
}

/**
 * Free the GPU buffers/programs of every tool-owned preview mesh under `obj`
 * (userData.toolOwned). The objects stay usable: three.js re-uploads them the
 * next time they render, so tools can release on deactivate and reuse later.
 */
export function releaseGpu(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!o.userData.toolOwned) return;
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material;
    if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
  });
}
