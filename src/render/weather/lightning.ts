// Lightning: branching bolts built by recursive midpoint displacement and
// drawn as screen-aligned ribbons (a hot white core plus a wide violet-blue
// glow) in one additive mesh. Each bolt flickers through several return
// strokes; the combined brightness drives the sky flash (a hemisphere light,
// a soft screen-space flash and uFlash for clouds/funnels).
import * as THREE from 'three';
import { FOG_ADD } from '../effects/fxShared';

const MAX_BOLTS = 6;
const MAX_SEGS = 2600;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aOther;
attribute vec4 aInfo; // side, width, bolt index, glow(1)/core(0)
attribute float aBright;
uniform float uBolt[${MAX_BOLTS}];
uniform float uPixelScale;
varying float vSide;
varying float vI;
varying float vGlow;
void main() {
  int bi = int(aInfo.z + 0.5);
  float b = 0.0;
  for (int i = 0; i < ${MAX_BOLTS}; i++) if (i == bi) b = uBolt[i];
  vec4 a = viewMatrix * vec4(position, 1.0);
  vec4 o = viewMatrix * vec4(aOther, 1.0);
  vec2 d = a.xy - o.xy;
  float L = length(d);
  d = L > 1e-4 ? d / L : vec2(0.0, 1.0);
  vec2 perp = vec2(-d.y, d.x);
  float depth = max(1.0, -a.z);
  // never thinner than ~1.3 px (core) so distant bolts stay crisp
  float minW = (aInfo.w > 0.5 ? 7.0 : 1.3) * depth / uPixelScale;
  float w = max(aInfo.y, minW);
  a.xy += perp * aInfo.x * w * 0.5;
  vSide = aInfo.x;
  vI = b * aBright;
  vGlow = aInfo.w;
  gl_Position = projectionMatrix * a;
  vec4 mvPosition = a;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying float vSide;
varying float vI;
varying float vGlow;
void main() {
  float x = abs(vSide);
  vec3 col;
  if (vGlow > 0.5) col = vec3(0.55, 0.6, 1.0) * pow(1.0 - x, 2.0) * 0.55;
  else col = mix(vec3(0.85, 0.9, 1.0), vec3(1.0), 1.0 - x) * (1.0 - x * x) * 7.0;
  col *= vI;
  if (vI < 0.002) discard;
  ${FOG_ADD.replace('col *= 1.0 - fogF;', 'col *= 1.0 - fogF * 0.7;')}
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Bolt {
  slot: number;
  t: number;
  strokes: number[];
  duration: number;
  /** 0..1 how bright it reads from the camera */
  weight: number;
  segs: { a: THREE.Vector3; b: THREE.Vector3; w: number; br: number }[];
}

const rnd = Math.random;

/** generate a jagged path from a to b; returns points */
function jag(a: THREE.Vector3, b: THREE.Vector3, levels: number, rough: number): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()];
  let disp = a.distanceTo(b) * rough;
  for (let l = 0; l < levels; l++) {
    const next: THREE.Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const m = p.clone().add(q).multiplyScalar(0.5);
      m.x += (rnd() - 0.5) * 2 * disp;
      m.z += (rnd() - 0.5) * 2 * disp;
      m.y += (rnd() - 0.5) * disp * 0.6;
      next.push(m, q);
    }
    pts = next;
    disp *= 0.52;
  }
  return pts;
}

export class Lightning {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly other: Float32Array;
  private readonly info: Float32Array;
  private readonly bright: Float32Array;
  private readonly boltU: number[];
  private bolts: Bolt[] = [];
  private dirty = false;
  /** overall flash 0..~1.5 this frame */
  flash = 0;

  constructor() {
    const vcount = MAX_SEGS * 4;
    this.pos = new Float32Array(vcount * 3);
    this.other = new Float32Array(vcount * 3);
    this.info = new Float32Array(vcount * 4);
    this.bright = new Float32Array(vcount);
    const idx = new Uint32Array(MAX_SEGS * 6);
    for (let s = 0; s < MAX_SEGS; s++) {
      const v = s * 4, o = s * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aOther', new THREE.BufferAttribute(this.other, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBright', new THREE.BufferAttribute(this.bright, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.boltU = new Array(MAX_BOLTS).fill(0);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) as Record<string, THREE.IUniform>;
    Object.assign(uniforms, { uBolt: { value: this.boltU }, uPixelScale: { value: 800 } });
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'weather.lightning';
  }

  get active(): number {
    return this.bolts.length;
  }

  /**
   * a bolt from `top` (cloud) to `bottom` (ground or another cloud point)
   * @param weight 0..1 brightness/proximity for the flash
   */
  strike(top: THREE.Vector3, bottom: THREE.Vector3, weight: number, cloudToCloud = false): void {
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    const used = new Set(this.bolts.map((b) => b.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const len = top.distanceTo(bottom);
    const main = jag(top, bottom, 7, cloudToCloud ? 0.16 : 0.1);
    const segs: Bolt['segs'] = [];
    const baseW = Math.max(0.8, len * 0.0016);
    for (let i = 0; i < main.length - 1; i++) segs.push({ a: main[i], b: main[i + 1], w: baseW * (1 - (i / main.length) * 0.35), br: 1 });
    // branches forking downward/outward, thinner and dimmer
    const nb = cloudToCloud ? 5 + ((rnd() * 4) | 0) : 3 + ((rnd() * 4) | 0);
    for (let k = 0; k < nb; k++) {
      const i0 = 4 + ((rnd() * (main.length * 0.7)) | 0);
      const start = main[Math.min(i0, main.length - 2)];
      const blen = len * (0.12 + rnd() * 0.25);
      const dir = new THREE.Vector3(rnd() - 0.5, cloudToCloud ? (rnd() - 0.5) * 0.4 : -0.6 - rnd() * 0.6, rnd() - 0.5).normalize();
      const end = start.clone().addScaledVector(dir, blen);
      const bp = jag(start, end, 5, 0.18);
      for (let i = 0; i < bp.length - 1; i++) segs.push({ a: bp[i], b: bp[i + 1], w: baseW * 0.45 * (1 - i / bp.length), br: 0.55 * (1 - (i / bp.length) * 0.6) });
      // sub-branch
      if (rnd() < 0.5) {
        const s2 = bp[(bp.length * 0.5) | 0];
        const e2 = s2.clone().add(new THREE.Vector3((rnd() - 0.5) * blen * 0.5, -blen * 0.35 * rnd(), (rnd() - 0.5) * blen * 0.5));
        const bp2 = jag(s2, e2, 4, 0.2);
        for (let i = 0; i < bp2.length - 1; i++) segs.push({ a: bp2[i], b: bp2[i + 1], w: baseW * 0.25, br: 0.3 });
      }
    }
    // stroke pattern: leader + 1–4 return strokes
    const strokes = [0];
    let t = 0;
    const n = 1 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) strokes.push((t += 0.05 + rnd() * 0.12));
    this.bolts.push({ slot, t: 0, strokes, duration: t + 0.28, weight, segs });
    this.dirty = true;
  }

  update(dt: number, pixelScale: number): void {
    this.mat.uniforms.uPixelScale.value = pixelScale;
    let flash = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t > b.duration) {
        this.boltU[b.slot] = 0;
        this.bolts.splice(i, 1);
        this.dirty = true;
        continue;
      }
      let br = 0;
      for (const s of b.strokes) if (b.t >= s) br += Math.exp(-(b.t - s) * 24);
      // the channel keeps a faint afterglow between strokes
      br = Math.min(1.6, br + 0.12 * (1 - b.t / b.duration));
      this.boltU[b.slot] = br;
      flash += br * b.weight;
    }
    this.flash = flash;
    if (this.dirty) this.rebuild();
    this.mesh.visible = this.bolts.length > 0;
  }

  clear(): void {
    this.bolts.length = 0;
    this.boltU.fill(0);
    this.flash = 0;
    this.dirty = true;
    this.rebuild();
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }

  private rebuild(): void {
    this.dirty = false;
    let s = 0;
    const P = this.pos, O = this.other, I = this.info, B = this.bright;
    const put = (v: number, p: THREE.Vector3, o: THREE.Vector3, side: number, w: number, slot: number, glow: number, br: number) => {
      P[v * 3] = p.x; P[v * 3 + 1] = p.y; P[v * 3 + 2] = p.z;
      O[v * 3] = o.x; O[v * 3 + 1] = o.y; O[v * 3 + 2] = o.z;
      I[v * 4] = side; I[v * 4 + 1] = w; I[v * 4 + 2] = slot; I[v * 4 + 3] = glow;
      B[v] = br;
    };
    for (const glow of [1, 0]) {
      for (const b of this.bolts) {
        for (const g of b.segs) {
          if (s >= MAX_SEGS) break;
          const v = s * 4;
          const w = glow ? g.w * 9 : g.w;
          // "other" for the a-end is b and vice versa (direction flips sign, perp flips too → swap sides)
          put(v, g.a, g.b, -1, w, b.slot, glow, g.br);
          put(v + 1, g.a, g.b, 1, w, b.slot, glow, g.br);
          put(v + 2, g.b, g.a, 1, w, b.slot, glow, g.br);
          put(v + 3, g.b, g.a, -1, w, b.slot, glow, g.br);
          s++;
        }
      }
    }
    this.geo.setDrawRange(0, s * 6);
    for (const name of ['position', 'aOther', 'aInfo', 'aBright']) {
      const a = this.geo.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, s * 4 * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
