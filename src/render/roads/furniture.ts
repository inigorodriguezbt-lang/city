// Street furniture: procedural models + global instanced meshes fed by the
// per-chunk road builder. Every furniture type is ONE draw call for the whole
// map (instances of all near chunks concatenated); night glows and road light
// pools are kept for every built chunk so the city sparkles at night even at
// panorama distance. Traffic-signal lenses animate entirely on the GPU.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** instanced furniture types */
export const enum FT {
  LampPole = 0,
  LampDouble,
  LampPed,
  SigPole,
  SigArm,
  SigHead,
  Bench,
  Bin,
  Planter,
  Bollard,
  Trunk,
  Canopy,
  COUNT,
}

/** light lens meshes that share a pole's transform */
const LENS_OF: Partial<Record<FT, number>> = { [FT.LampPole]: 0, [FT.LampDouble]: 1, [FT.LampPed]: 2 };

/** Growable float list. */
class FList {
  a = new Float32Array(64);
  n = 0;
  push(...v: number[]): void {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  take(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

/** Instances produced by one chunk build. */
export interface FurnitureChunk {
  /** 16-float matrices per FT */
  mats: Float32Array[];
  /** per-canopy rgb tint (matches mats[FT.Canopy] order) */
  canopy: Float32Array;
  /** glows: x, y, z, size */
  glows: Float32Array;
  /** pools: x, y, z, radius, nx, nz, strength, _ */
  pools: Float32Array;
  /** signal lenses: x, y, z, packed (group + 2*color + 8*phaseOffset) */
  lenses: Float32Array;
}

/** Per-chunk collector used by the builder. */
export class FurnitureBuilder {
  private mats: FList[] = [];
  private canopy = new FList();
  private glows = new FList();
  private pools = new FList();
  private lenses = new FList();
  /** when false only lights (glows, pools) and trees are collected */
  detail = true;

  constructor() {
    for (let i = 0; i < FT.COUNT; i++) this.mats.push(new FList());
  }

  reset(detail: boolean): void {
    for (const m of this.mats) m.n = 0;
    this.canopy.n = this.glows.n = this.pools.n = this.lenses.n = 0;
    this.detail = detail;
  }

  /** model +X points along world (cos yaw, −sin yaw) */
  add(t: FT, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1): void {
    if (!this.detail && t !== FT.Trunk && t !== FT.Canopy) return;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.mats[t].push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1);
  }

  tree(x: number, y: number, z: number, scale: number, seed: number): void {
    const yaw = (seed % 628) / 100;
    this.add(FT.Trunk, x, y, z, yaw, scale, scale, scale);
    this.add(FT.Canopy, x, y, z, yaw, scale * (0.9 + ((seed >> 4) % 20) / 100), scale, scale);
    const v = ((seed >> 9) % 100) / 100;
    this.canopy.push(0.85 + v * 0.3, 0.9 + ((seed >> 13) % 100) / 500, 0.8 + ((seed >> 17) % 100) / 400);
  }

  glow(x: number, y: number, z: number, size: number): void {
    this.glows.push(x, y, z, size);
  }

  pool(x: number, y: number, z: number, radius: number, nx: number, nz: number, strength = 1): void {
    this.pools.push(x, y, z, radius, nx, nz, strength, 0);
  }

  /** group 0: N-S approaches, 1: E-W; color 0 red, 1 yellow, 2 green */
  lens(x: number, y: number, z: number, group: number, color: number, phase: number): void {
    if (!this.detail) return;
    this.lenses.push(x, y, z, group + color * 2 + Math.floor(phase) * 8);
  }

  finish(): FurnitureChunk {
    return {
      mats: this.mats.map((m) => m.take()),
      canopy: this.canopy.take(),
      glows: this.glows.take(),
      pools: this.pools.take(),
      lenses: this.lenses.take(),
    };
  }
}

// ── procedural models ───────────────────────────────────────────────────────

function colored(g: THREE.BufferGeometry, hex: number | THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = hex instanceof THREE.Color ? hex : new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  return geo;
}

function cyl(r0: number, r1: number, h: number, seg: number, x: number, y: number, z: number, col: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, false);
  g.translate(x, y + h / 2, z);
  return colored(g, col);
}

function boxG(w: number, h: number, d: number, x: number, y: number, z: number, col: number, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return colored(g, col);
}

/** tube between two points */
function seg3(a: THREE.Vector3, b: THREE.Vector3, r: number, col: number, sides = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), sides, 1, true);
  g.translate(0, d.length() / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return colored(g, col);
}

function blob(r: number, x: number, y: number, z: number, seed: number, col: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 - seed * 1.3) * Math.sin(vy * 2.3 + seed * 0.7);
    const k = 1 + n * 0.18;
    p.setXYZ(i, vx * k, vy * k * 0.85, vz * k);
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return colored(g, col);
}

const POLE = 0x2a2e33;
const DARK = 0x16181b;

export interface Models {
  geo: THREE.BufferGeometry[];
  lens: THREE.BufferGeometry[];
  lensOffsets: THREE.Vector3[][];
  sigLens: THREE.BufferGeometry;
  bare: THREE.BufferGeometry;
}

function buildModels(): Models {
  const geo: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // single-arm street lamp: pole at origin, arm reaching +X, head at x≈1.75, y≈7.3
  geo[FT.LampPole] = mergeGeometries([
    cyl(0.2, 0.16, 0.45, 8, 0, 0, 0, POLE),
    cyl(0.1, 0.07, 7.0, 8, 0, 0.45, 0, POLE),
    seg3(V(0, 7.2, 0), V(0.6, 7.45, 0), 0.05, POLE),
    seg3(V(0.6, 7.45, 0), V(1.45, 7.5, 0), 0.045, POLE),
    boxG(0.78, 0.13, 0.3, 1.75, 7.47, 0, DARK, -0.05),
  ])!;
  // double lamp (median): two arms ±X
  geo[FT.LampDouble] = mergeGeometries([
    cyl(0.24, 0.2, 0.5, 8, 0, 0, 0, POLE),
    cyl(0.12, 0.08, 8.3, 8, 0, 0.5, 0, POLE),
    seg3(V(0, 8.5, 0), V(0.8, 8.75, 0), 0.055, POLE),
    seg3(V(0.8, 8.75, 0), V(1.75, 8.8, 0), 0.05, POLE),
    seg3(V(0, 8.5, 0), V(-0.8, 8.75, 0), 0.055, POLE),
    seg3(V(-0.8, 8.75, 0), V(-1.75, 8.8, 0), 0.05, POLE),
    boxG(0.8, 0.14, 0.32, 2.05, 8.77, 0, DARK, -0.05),
    boxG(0.8, 0.14, 0.32, -2.05, 8.77, 0, DARK, 0.05),
  ])!;
  // pedestrian lantern
  geo[FT.LampPed] = mergeGeometries([
    cyl(0.14, 0.1, 0.35, 8, 0, 0, 0, 0x1c2622),
    cyl(0.06, 0.05, 3.3, 8, 0, 0.35, 0, 0x1c2622),
    cyl(0.1, 0.22, 0.12, 8, 0, 3.62, 0, 0x1c2622),
    cyl(0.24, 0.02, 0.28, 8, 0, 4.12, 0, 0x1c2622),
    boxG(0.04, 0.4, 0.04, 0.19, 3.93, 0.19, 0x1c2622),
    boxG(0.04, 0.4, 0.04, -0.19, 3.93, 0.19, 0x1c2622),
    boxG(0.04, 0.4, 0.04, 0.19, 3.93, -0.19, 0x1c2622),
    boxG(0.04, 0.4, 0.04, -0.19, 3.93, -0.19, 0x1c2622),
  ])!;
  // traffic signal pole with a near-side head facing +X
  geo[FT.SigPole] = mergeGeometries([
    cyl(0.22, 0.18, 0.4, 8, 0, 0, 0, 0x2d3136),
    cyl(0.12, 0.1, 6.0, 8, 0, 0.4, 0, 0x3a3f45),
    boxG(0.3, 1.0, 0.36, 0.22, 3.1, 0, 0x121314),
    boxG(0.04, 1.2, 0.56, 0.06, 3.1, 0, 0x121314),
  ])!;
  // mast arm: unit length along +X at y=5.9 (scaled in x)
  geo[FT.SigArm] = boxG(1, 0.16, 0.16, 0.5, 5.95, 0, 0x3a3f45);
  // hanging head (housing + backplate with a yellow reflective border), faces +X
  geo[FT.SigHead] = mergeGeometries([
    boxG(0.3, 1.0, 0.36, 0, 0, 0, 0x121314),
    boxG(0.03, 1.22, 0.58, -0.16, 0, 0, 0xc9a227),
    boxG(0.035, 1.14, 0.5, -0.15, 0, 0, 0x121314),
    boxG(0.05, 0.4, 0.05, 0, 0.7, 0, 0x3a3f45),
  ])!;
  geo[FT.Bench] = mergeGeometries([
    boxG(0.46, 0.05, 1.8, 0, 0.45, 0, 0x7a5232),
    boxG(0.05, 0.36, 1.8, -0.24, 0.72, 0, 0x6b4a2e, 0.18),
    boxG(0.42, 0.45, 0.06, 0, 0.225, 0.8, 0x222426),
    boxG(0.42, 0.45, 0.06, 0, 0.225, -0.8, 0x222426),
    boxG(0.06, 0.55, 0.06, -0.26, 0.6, 0.8, 0x222426),
    boxG(0.06, 0.55, 0.06, -0.26, 0.6, -0.8, 0x222426),
  ])!;
  geo[FT.Bin] = mergeGeometries([
    cyl(0.24, 0.26, 0.85, 10, 0, 0, 0, 0x24352b),
    cyl(0.28, 0.28, 0.06, 10, 0, 0.85, 0, 0x1a1c1e),
  ])!;
  geo[FT.Planter] = mergeGeometries([
    boxG(1.3, 0.55, 1.3, 0, 0.275, 0, 0x8d8a84),
    boxG(1.18, 0.06, 1.18, 0, 0.56, 0, 0x3b2a1e),
    blob(0.62, 0, 1.0, 0, 3, 0x3f6b2a),
    blob(0.38, 0.3, 1.35, 0.15, 7, 0x4d7a30, 0),
  ])!;
  geo[FT.Bollard] = mergeGeometries([
    cyl(0.1, 0.09, 0.85, 8, 0, 0, 0, 0x2a2d31),
    cyl(0.095, 0.095, 0.08, 8, 0, 0.62, 0, 0xd8d8d0),
    cyl(0.11, 0.06, 0.06, 8, 0, 0.85, 0, 0x2a2d31),
  ])!;
  geo[FT.Trunk] = mergeGeometries([
    cyl(0.17, 0.11, 3.4, 7, 0, 0, 0, 0x4a3727),
    seg3(V(0, 2.6, 0), V(0.7, 3.8, 0.3), 0.06, 0x4a3727, 5),
    seg3(V(0, 2.9, 0), V(-0.6, 4.0, -0.4), 0.06, 0x4a3727, 5),
  ])!;
  geo[FT.Canopy] = mergeGeometries([
    blob(1.75, 0, 4.6, 0, 1, 0xffffff),
    blob(1.25, 0.8, 5.5, 0.4, 2, 0xffffff),
    blob(1.2, -0.7, 5.2, -0.5, 5, 0xffffff),
  ])!;
  // winter: bare crown
  const br: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const y0 = 2.8 + (i % 3) * 0.35;
    const tip = V(Math.cos(a) * 1.9, y0 + 2.4, Math.sin(a) * 1.9);
    br.push(seg3(V(0, y0, 0), tip, 0.05, 0x4a3727, 4));
    br.push(seg3(tip, V(Math.cos(a + 0.5) * 2.3, y0 + 3.2, Math.sin(a + 0.5) * 2.3), 0.025, 0x4a3727, 3));
  }
  const bare = mergeGeometries(br)!;
  // lenses
  const lens: THREE.BufferGeometry[] = [];
  lens[0] = new THREE.BoxGeometry(0.62, 0.03, 0.24).translate(1.75, 7.39, 0);
  lens[1] = mergeGeometries([new THREE.BoxGeometry(0.64, 0.03, 0.26).translate(2.05, 8.69, 0), new THREE.BoxGeometry(0.64, 0.03, 0.26).translate(-2.05, 8.69, 0)])!;
  lens[2] = new THREE.BoxGeometry(0.3, 0.34, 0.3).translate(0, 3.93, 0);
  const lensOffsets = [[V(1.75, 7.3, 0)], [V(2.05, 8.6, 0), V(-2.05, 8.6, 0)], [V(0, 3.93, 0)]];
  const sigLens = new THREE.SphereGeometry(0.11, 10, 6);
  return { geo, lens, lensOffsets, sigLens, bare };
}

let models: Models | null = null;
export function furnitureModels(): Models {
  if (!models) models = buildModels();
  return models;
}

// ── shaders for lights ─────────────────────────────────────────────────────

const GLOW_VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aGlow;
uniform float uNight;
uniform float uPixel; // world meters per pixel at distance 1
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(aGlow.xyz, 1.0);
  float dist = -mvPosition.z;
  float size = aGlow.w;
  float minSize = dist * uPixel * 3.0;
  float s = max(size, minSize);
  vFade = size / s; // keep energy roughly constant when enlarged
  vFade = vFade * vFade * 0.65 + 0.35 * vFade;
  mvPosition.xy += position.xy * s;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const GLOW_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uNight;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float core = exp(-r * r * 22.0);
  float halo = pow(1.0 - r, 2.2) * 0.35;
  float a = (core * 2.2 + halo) * uNight * vFade;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <fog_fragment>
}`;

const POOL_VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aPool;
attribute vec4 aPool2;
varying vec2 vUv;
varying float vStrength;
void main() {
  vUv = position.xy;
  vStrength = aPool2.z;
  vec3 n = normalize(vec3(aPool2.x, 1.0, aPool2.y));
  vec3 t = normalize(cross(vec3(0.0, 0.0, 1.0), n));
  vec3 b = cross(n, t);
  vec3 p = aPool.xyz + (t * position.x + b * position.y) * aPool.w + n * 0.2;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const POOL_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uNight;
uniform vec3 uColor;
varying vec2 vUv;
varying float vStrength;
void main() {
  #include <logdepthbuf_fragment>
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float f = (1.0 - r2);
  f = f * f * (0.55 + 0.45 * exp(-r2 * 6.0));
  gl_FragColor = vec4(uColor * f * uNight * vStrength, 1.0);
  #include <fog_fragment>
}`;

// signal lens: MeshBasic-like, colored by the GPU phase clock
const SIG_VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSig;
uniform float uTime;
varying vec3 vCol;
void main() {
  float packed = aSig.w;
  float group = mod(packed, 2.0);
  float color = mod(floor(packed / 2.0), 4.0);
  float phase = floor(packed / 8.0);
  float cycle = 26.0;
  float t = mod(uTime + phase, cycle);
  if (group > 0.5) t = mod(t + 13.0, cycle);
  // group phase (t in [0,26)): green [0,10), yellow [10,13), red [13,26)
  float on;
  vec3 c;
  if (color < 0.5) { on = step(13.0, t); c = vec3(1.0, 0.06, 0.03); }
  else if (color < 1.5) { on = step(10.0, t) * step(t, 13.0); c = vec3(1.0, 0.55, 0.02); }
  else { on = step(t, 10.0); c = vec3(0.05, 1.0, 0.45); }
  vCol = mix(c * 0.045 + 0.01, c * 4.5, on);
  vec4 mvPosition = modelViewMatrix * vec4(position + aSig.xyz, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const SIG_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec3 vCol;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vCol, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function lightMaterial(vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, additive: boolean): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader: vs,
    fragmentShader: fs,
    fog: true,
    transparent: additive,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (additive) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -4;
    m.polygonOffsetUnits = -4;
  }
  return m;
}

interface Slot {
  mesh: THREE.InstancedMesh;
  cap: number;
}

/** Global instanced furniture for the whole map. */
export class FurnitureSystem {
  readonly group = new THREE.Group();
  private chunks = new Map<number, FurnitureChunk>();
  private dirty = false;
  private slots: Slot[] = [];
  private lensSlots: Slot[] = [];
  private bareSlot: Slot;
  private models = furnitureModels();
  private matFurn: THREE.MeshStandardMaterial;
  private matCanopy: THREE.MeshStandardMaterial;
  readonly matLens: THREE.MeshBasicMaterial;
  private glow: THREE.Mesh;
  private pool: THREE.Mesh;
  private sig: THREE.Mesh;
  private glowGeo = new THREE.InstancedBufferGeometry();
  private poolGeo = new THREE.InstancedBufferGeometry();
  private sigGeo = new THREE.InstancedBufferGeometry();
  readonly glowMat: THREE.ShaderMaterial;
  readonly poolMat: THREE.ShaderMaterial;
  readonly sigMat: THREE.ShaderMaterial;
  private snowU = { value: 0 };
  private winter = false;

  constructor() {
    this.group.name = 'road-furniture';
    this.matFurn = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    this.matCanopy = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.85, metalness: 0 });
    this.matCanopy.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = this.snowU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vUpN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpN = normal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying float vUpN;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82,0.85,0.9), smoothstep(0.2, 0.7, vUpN) * uSnow * 0.85);');
    };
    this.matCanopy.customProgramCacheKey = () => 'urbis-road-canopy';
    this.matLens = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (let t = 0; t < FT.COUNT; t++) {
      const mat = t === FT.Canopy ? this.matCanopy : this.matFurn;
      this.slots.push(this.makeSlot(this.models.geo[t], mat, 16, true));
    }
    for (let i = 0; i < 3; i++) this.lensSlots.push(this.makeSlot(this.models.lens[i], this.matLens, 16, false));
    this.bareSlot = this.makeSlot(this.models.bare, this.matFurn, 16, true);
    this.bareSlot.mesh.visible = false;

    const quad = new THREE.PlaneGeometry(2, 2);
    this.glowGeo.index = quad.index;
    this.glowGeo.setAttribute('position', quad.getAttribute('position'));
    this.poolGeo.index = quad.index;
    this.poolGeo.setAttribute('position', quad.getAttribute('position'));
    this.glowMat = lightMaterial(GLOW_VS, GLOW_FS, { uNight: { value: 0 }, uPixel: { value: 0.001 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.5) } }, true);
    this.poolMat = lightMaterial(POOL_VS, POOL_FS, { uNight: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.4, 0.22) } }, true);
    this.sigMat = lightMaterial(SIG_VS, SIG_FS, { uTime: { value: 0 } }, false);
    this.glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    this.pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    const sg = this.models.sigLens;
    this.sigGeo.index = sg.index;
    this.sigGeo.setAttribute('position', sg.getAttribute('position'));
    this.sig = new THREE.Mesh(this.sigGeo, this.sigMat);
    for (const m of [this.glow, this.pool, this.sig]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.glow.renderOrder = 5;
    this.pool.renderOrder = 4;
    this.setInstances(this.glowGeo, 'aGlow', new Float32Array(0), 4);
    this.setInstances(this.poolGeo, 'aPool', new Float32Array(0), 4);
    this.setInstances(this.sigGeo, 'aSig', new Float32Array(0), 4);
  }

  private makeSlot(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow: boolean): Slot {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.count = 0;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return { mesh, cap };
  }

  setChunk(key: number, f: FurnitureChunk | null): void {
    if (f) this.chunks.set(key, f);
    else this.chunks.delete(key);
    this.dirty = true;
  }

  clear(): void {
    this.chunks.clear();
    this.dirty = true;
  }

  /** per-frame state: night 0..1, snow cover, season canopy color, signal clock, camera pixel scale */
  setState(night: number, snow: number, canopy: THREE.Color, winter: boolean, sigTime: number, pixel: number): void {
    const lampOn = THREE.MathUtils.smoothstep(night, 0.05, 0.6);
    this.glowMat.uniforms.uNight.value = lampOn;
    this.poolMat.uniforms.uNight.value = lampOn;
    this.glowMat.uniforms.uPixel.value = pixel;
    this.sigMat.uniforms.uTime.value = sigTime;
    this.matLens.color.setRGB(0.12 + 3.4 * lampOn, 0.12 + 2.7 * lampOn, 0.1 + 1.8 * lampOn);
    this.snowU.value = snow;
    this.matCanopy.color.copy(canopy);
    if (winter !== this.winter) {
      this.winter = winter;
      this.slots[FT.Canopy].mesh.visible = !winter;
      this.bareSlot.mesh.visible = winter;
    }
    this.glow.visible = this.pool.visible = lampOn > 0.001;
  }

  /** rebuild instance buffers if any chunk changed */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const all = [...this.chunks.values()];
    for (let t = 0; t < FT.COUNT; t++) {
      const arrs = all.map((c) => c.mats[t]);
      const n = arrs.reduce((a, b) => a + b.length / 16, 0);
      const slot = this.ensure(this.slots, t, n, this.models.geo[t], t === FT.Canopy ? this.matCanopy : this.matFurn, true);
      this.fill(slot, arrs, n);
      if (t === FT.Canopy) {
        const cols = new Float32Array(Math.max(1, n) * 3);
        let o = 0;
        for (const c of all) {
          cols.set(c.canopy, o);
          o += c.canopy.length;
        }
        slot.mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
        const bare = this.bareSlot;
        if (n > bare.cap) {
          this.group.remove(bare.mesh);
          bare.mesh.dispose();
          const b = this.makeSlot(this.models.bare, this.matFurn, Math.ceil(n * 1.5) + 16, true);
          b.mesh.visible = this.winter;
          this.bareSlot = b;
        }
        this.fill(this.bareSlot, arrs, n);
      }
      const li = LENS_OF[t as FT];
      if (li !== undefined) this.fill(this.ensure(this.lensSlots, li, n, this.models.lens[li], this.matLens, false), arrs, n);
    }
    this.setInstances(this.glowGeo, 'aGlow', concat(all.map((c) => c.glows)), 4);
    const pools = concat(all.map((c) => c.pools));
    const np = pools.length / 8;
    const p1 = new Float32Array(np * 4), p2 = new Float32Array(np * 4);
    for (let i = 0; i < np; i++) {
      p1.set(pools.subarray(i * 8, i * 8 + 4), i * 4);
      p2.set(pools.subarray(i * 8 + 4, i * 8 + 8), i * 4);
    }
    this.setInstances(this.poolGeo, 'aPool', p1, 4);
    this.poolGeo.setAttribute('aPool2', new THREE.InstancedBufferAttribute(p2, 4));
    this.setInstances(this.sigGeo, 'aSig', concat(all.map((c) => c.lenses)), 4);
  }

  private ensure(slots: Slot[], i: number, n: number, geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean): Slot {
    const s = slots[i];
    if (n <= s.cap) return s;
    const vis = s.mesh.visible;
    this.group.remove(s.mesh);
    s.mesh.dispose();
    const ns = this.makeSlot(geo, mat, Math.ceil(n * 1.5) + 16, shadow);
    ns.mesh.visible = vis;
    slots[i] = ns;
    return ns;
  }

  private fill(slot: Slot, arrs: Float32Array[], n: number): void {
    const dst = slot.mesh.instanceMatrix.array as Float32Array;
    let o = 0;
    for (const a of arrs) {
      dst.set(a, o);
      o += a.length;
    }
    slot.mesh.count = n;
    slot.mesh.instanceMatrix.needsUpdate = true;
    slot.mesh.instanceMatrix.clearUpdateRanges();
    slot.mesh.boundingSphere = null;
    slot.mesh.boundingBox = null;
  }

  private setInstances(geo: THREE.InstancedBufferGeometry, name: string, data: Float32Array, size: number): void {
    const n = data.length / size;
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(data.length ? data : new Float32Array(size), size));
    geo.instanceCount = n;
  }

  /** number of draw calls currently issued by furniture */
  get drawCalls(): number {
    let n = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && ((m as THREE.InstancedMesh).count > 0 || (m.geometry as THREE.InstancedBufferGeometry).instanceCount > 0)) n++;
    });
    return n;
  }

  dispose(): void {
    for (const s of [...this.slots, ...this.lensSlots, this.bareSlot]) s.mesh.dispose();
    this.glowGeo.dispose();
    this.poolGeo.dispose();
    this.sigGeo.dispose();
    this.glowMat.dispose();
    this.poolMat.dispose();
    this.sigMat.dispose();
    this.matFurn.dispose();
    this.matCanopy.dispose();
    this.matLens.dispose();
  }
}

function concat(arrs: Float32Array[]): Float32Array {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
