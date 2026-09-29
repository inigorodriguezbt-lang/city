// Stateless GPU particle system.
//
// Every particle is written ONCE into a ring buffer (an instanced, interleaved
// attribute: 20 floats) when it is spawned; the vertex shader evaluates its
// whole life analytically — drag toward the wind, buoyancy/gravity, growing
// turbulence, size/colour/alpha over life — so the CPU cost is proportional
// to spawns only, never to the number of live particles. Only the ring slots
// written this frame are uploaded (update ranges).
//
// One draw call renders everything: premultiplied-alpha output lets additive
// particles (fire, sparks, fireworks — alpha written as 0) and alpha-blended
// particles (smoke, dust, steam, water) share a single blend state.
//
// Two clocks: `sim` follows game.simDt (fires, disasters, fireworks: frozen
// while paused) and `real` follows real time (chimney smoke, fountains, rain
// splashes). Each particle records which clock it lives on.
import * as THREE from 'three';

export const enum Shape {
  /** soft round glow */
  Soft = 0,
  /** billowy smoke puff (atlas cell picked by seed) */
  Puff = 1,
  /** velocity-aligned streak (sparks, fireworks stars, droplets) */
  Streak = 2,
  /** flat ring on the ground plane (shock waves, splash rings) */
  Ring = 3,
  /** velocity-aligned flame tongue (2.4× longer than wide) */
  Flame = 4,
  /** soft glow lying flat on the ground (fire light, crater glow) */
  Decal = 5,
}

export const enum Mode {
  /** unlit colour lerp c0 → c1, × glow (HDR) */
  Unlit = 0,
  /** black-body flame ramp (c0/c1 ignored), × glow */
  Fire = 1,
  /** lit by sun + ambient (smoke, dust, steam, water); glow = fire under-light */
  Lit = 2,
  /** unlit + crackling flicker (fireworks glitter) */
  Sparkle = 3,
}

export const enum Clock {
  Sim = 0,
  Real = 1,
}

/** spawn description; reuse one object and fill it (no per-particle allocation) */
export interface ParticleInit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** seconds */
  life: number;
  /** size (m) at birth / death */
  s0: number; s1: number;
  /** velocity relaxation rate toward the wind + terminal velocity (1/s) */
  drag: number;
  /** 0..1 how strongly the wind carries it */
  wind: number;
  /** vertical acceleration m/s² (+ rises, − falls) */
  buoy: number;
  /** turbulent wander amplitude (m/s) */
  turb: number;
  /** 0xRRGGBB (sRGB) */
  c0: number; c1: number;
  /** peak opacity 0..1 */
  alpha: number;
  shape: Shape;
  mode: Mode;
  clock: Clock;
  additive: boolean;
  /** Unlit/Fire/Sparkle: HDR intensity; Lit: warm under-glow amount */
  glow: number;
  /** seconds this particle is already old at spawn (sub-frame emission) */
  age: number;
  /** Streak shape: motion-blur length in seconds of travel (0 = default shutter) */
  stretch: number;
}

export function particleInit(): ParticleInit {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 1, drag: 0, wind: 0, buoy: 0, turb: 0,
    c0: 0xffffff, c1: 0xffffff, alpha: 1, shape: Shape.Soft, mode: Mode.Unlit, clock: Clock.Sim, additive: true, glow: 1, age: 0, stretch: 0,
  };
}

const STRIDE = 20;
/** rebase clocks before float32 precision in the shader degrades */
const REBASE_AT = 6000;
const REBASE_BY = 5000;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 iA; // x y z vx
attribute vec4 iB; // vy vz t0 life
attribute vec4 iC; // s0 s1 drag wind
attribute vec4 iD; // buoy turb c0 c1
attribute vec4 iE; // alpha flags seed glow
uniform float uTimeSim;
uniform float uTimeReal;
uniform vec3 uWind;
uniform float uPixelScale;
uniform float uStreak;
uniform vec3 uAmbient;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
varying float vLit;

vec3 unpackRGB(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  vec3 c = vec3(r, g, b) / 255.0;
  return c * c * (c * 0.3 + 0.7); // cheap sRGB → linear
}

vec3 fireRamp(float T) {
  // T: 1 = hottest (white-yellow) … 0 = cooled (deep red)
  vec3 hot = vec3(1.0, 0.86, 0.55);
  vec3 mid = vec3(1.0, 0.42, 0.07);
  vec3 cool = vec3(0.62, 0.09, 0.015);
  vec3 c = T > 0.55 ? mix(mid, hot, (T - 0.55) / 0.45) : mix(cool, mid, T / 0.55);
  return c * (0.35 + 0.65 * T);
}

void main() {
  float flags = iE.y;
  float fAdd = step(64.0, flags);
  flags -= fAdd * 64.0;
  float fClock = step(32.0, flags);
  flags -= fClock * 32.0;
  float mode = floor(flags / 8.0 + 0.001);
  float shape = flags - mode * 8.0;
  float now = fClock > 0.5 ? uTimeReal : uTimeSim;
  float age = now - iB.z;
  float life = iB.w;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    return;
  }
  float t = age / life;
  float seed = fract(iE.z);
  float stretch = floor(iE.z) / 32.0;
  vec3 p0 = iA.xyz;
  vec3 v0 = vec3(iA.w, iB.xy);
  float k = max(iC.z, 1e-4);
  float x = k * age;
  float e = exp(-x);
  // stable integrals of e^{-kt}: f1 = ∫e, g = ∫∫e
  float f1 = x < 0.02 ? age * (1.0 - x * 0.5 + x * x / 6.0) : (1.0 - e) / k;
  float g = x < 0.02 ? age * age * (0.5 - x / 6.0 + x * x / 24.0) : (age - f1) / k;
  vec3 A = uWind * (iC.w * k) + vec3(0.0, iD.x, 0.0);
  vec3 pos = p0 + v0 * f1 + A * g;
  vec3 vel = v0 * e + A * f1;
  // turbulent wander that grows with age
  float ph = seed * 6.2831853;
  float tu = iD.y * age;
  pos += tu * vec3(sin(age * 1.9 + ph), 0.35 * sin(age * 1.3 + ph * 1.7), cos(age * 1.6 + ph * 2.3));

  float size = mix(iC.x, iC.y, pow(t, mode > 1.5 && mode < 2.5 ? 0.8 : 0.6));
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float depth = max(0.5, -mv.z);
  float px = size * uPixelScale / depth;
  float alphaK = 1.0;
  if (px < 1.6) {
    // keep a minimum on-screen size; additive sparks lose less energy than smoke
    float k0 = max(px, 0.05) / 1.6;
    alphaK = iE.y >= 64.0 ? sqrt(k0) : k0;
    size *= 1.6 / max(px, 0.05);
  }

  vec2 c = position.xy;
  vUv = c * 0.5 + 0.5;
  vec4 clip;
  if (shape > 4.5) {
    // soft glow decal lying on the ground plane
    vec3 wp = pos + vec3(c.x, 0.0, c.y) * size * 0.5;
    mv = viewMatrix * vec4(wp, 1.0);
    clip = projectionMatrix * mv;
    vUv = vUv * 0.5;
  } else if (shape > 3.5) {
    // flame tongue: stretched along the (screen-projected) velocity, base at the particle
    vec3 vv = (viewMatrix * vec4(vel + vec3(0.0, 0.5, 0.0), 0.0)).xyz;
    vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size * 2.4;
    mv.xy += dir * (c.y * 0.5 + 0.3) * len + perp * c.x * size * 0.5;
    clip = projectionMatrix * mv;
    vUv = vUv * 0.5;
  } else if (shape > 2.5) {
    // flat ring on the ground plane
    vec3 wp = pos + vec3(c.x, 0.0, c.y) * size * 0.5;
    vec4 mv2 = viewMatrix * vec4(wp, 1.0);
    mv = mv2;
    clip = projectionMatrix * mv2;
    vUv = vUv * 0.5 + vec2(0.5, 0.5);
  } else if (shape > 1.5) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 dir = vv.xy;
    float L = length(dir);
    dir = L > 1e-4 ? dir / L : vec2(0.0, 1.0);
    float len = size + L * (stretch > 0.0 ? stretch : uStreak);
    vec2 perp = vec2(-dir.y, dir.x);
    mv.xy += dir * (c.y * len * 0.5 - len * 0.35) + perp * c.x * size * 0.5;
    clip = projectionMatrix * mv;
    vUv = vUv * 0.5;
  } else {
    float ang = ph + age * (seed - 0.5) * 0.9;
    float cs = cos(ang), sn = sin(ang);
    mv.xy += mat2(cs, sn, -sn, cs) * c * size * 0.5;
    clip = projectionMatrix * mv;
    if (shape > 0.5) vUv = vUv * 0.5 + (seed > 0.5 ? vec2(0.5, 0.0) : vec2(0.0, 0.5));
    else vUv = vUv * 0.5;
  }
  gl_Position = clip;

  // colour & alpha over life
  vec3 col;
  float fin = 0.08, fout = 0.5;
  float glow = iE.w;
  vLit = 0.0;
  if (mode < 0.5) {
    col = mix(unpackRGB(iD.z), unpackRGB(iD.w), t) * glow;
  } else if (mode < 1.5) {
    col = fireRamp(pow(1.0 - t, 0.8)) * glow * (0.8 + 0.25 * sin(age * 31.0 + ph * 9.0));
    fin = 0.04; fout = 0.25;
  } else if (mode < 2.5) {
    vec3 base = mix(unpackRGB(iD.z), unpackRGB(iD.w), t);
    float sunK = 0.45 + 0.55 * clamp(uSunDir.y * 2.0 + 0.2, 0.0, 1.0);
    col = base * (uAmbient + uSun * sunK * 0.55);
    col += vec3(1.0, 0.36, 0.08) * glow * exp(-age * 0.9);
    fin = 0.1; fout = 0.5;
    vLit = 1.0;
  } else {
    col = mix(unpackRGB(iD.z), unpackRGB(iD.w), t) * glow;
    float fl = sin(age * 47.0 + ph * 13.0) * sin(age * 29.0 + ph * 7.0);
    col *= 0.35 + 1.3 * step(0.0, fl);
    fin = 0.0; fout = 0.6;
  }
  float a = iE.x * alphaK * smoothstep(0.0, fin + 1e-4, t) * (1.0 - smoothstep(fout, 1.0, t));
  vColor = vec4(col, a);
  vAdd = fAdd;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
varying float vLit;
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float a = vColor.a * tex.r;
  if (a < 0.002) discard;
  vec3 col = vColor.rgb * mix(1.0, 0.62 + 0.55 * tex.g, vLit);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = vAdd > 0.5 ? col * (1.0 - fogF) : mix(col, fogColor, fogF);
  #endif
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}
`;

/** 2×2 atlas: [0] soft glow, [1] puff A, [2] puff B, [3] ring. R = mask, G = top-lit shading. */
export function createParticleAtlas(): THREE.Texture {
  const N = 256, H = N / 2;
  const data = new Uint8Array(N * N * 4);
  const rnd = (i: number) => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  // value noise for puff edges
  const vnoise = (x: number, y: number, seed: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a: number, b: number) => rnd(((a & 63) * 57 + (b & 63) * 131 + seed * 977) % 100000);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  const puffs: { x: number; y: number; r: number }[][] = [[], []];
  for (let p = 0; p < 2; p++) {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const a = rnd(p * 50 + i) * Math.PI * 2, d = 0.12 + rnd(p * 50 + i + 20) * 0.2;
      puffs[p].push({ x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d * 0.9, r: 0.16 + rnd(p * 50 + i + 40) * 0.12 });
    }
    puffs[p].push({ x: 0.5, y: 0.5, r: 0.3 });
  }
  for (let cy = 0; cy < 2; cy++)
    for (let cx = 0; cx < 2; cx++) {
      const cell = cy * 2 + cx;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < H; x++) {
          const u = (x + 0.5) / H, v = (y + 0.5) / H;
          const dx = u - 0.5, dy = v - 0.5;
          const r = Math.sqrt(dx * dx + dy * dy) * 2;
          let m = 0, shade = 0.5;
          if (cell === 0) {
            // soft glow: bright core, long gaussian tail
            m = Math.exp(-r * r * 5.5) * 0.8 + Math.exp(-r * r * 22) * 0.2;
            m *= 1 - Math.min(1, Math.max(0, (r - 0.92) / 0.08));
            shade = 1;
          } else if (cell === 3) {
            // ring: thin bright annulus with a soft inner fill
            const ring = Math.exp(-((r - 0.78) ** 2) * 260);
            m = ring + Math.exp(-((r - 0.6) ** 2) * 30) * 0.18;
            m *= r < 1 ? 1 : 0;
            shade = 1;
          } else {
            const set = puffs[cell - 1];
            let dens = 0, top = 0;
            for (const b of set) {
              const bx = u - b.x, by = v - b.y;
              const d = Math.sqrt(bx * bx + by * by) / b.r;
              if (d < 1) {
                const w = (1 - d * d) ** 2;
                dens += w;
                top += w * (0.5 - by / b.r * 0.5);
              }
            }
            const n = vnoise(u * 9, v * 9, cell) * 0.6 + vnoise(u * 21, v * 21, cell + 7) * 0.4;
            m = Math.min(1, dens * 0.8) * (0.55 + 0.45 * n);
            m *= Math.max(0, 1 - Math.max(0, r - 0.8) / 0.2);
            shade = dens > 0 ? Math.min(1, Math.max(0, top / dens) * 0.9 + n * 0.25) : 0.5;
          }
          // atlas rows: cell 0 bottom-left in UV space (v up) → texture row index
          const px = cx * H + x, py = cy * H + y;
          const o = (py * N + px) * 4;
          data[o] = Math.round(Math.min(1, Math.max(0, m)) * 255);
          data[o + 1] = Math.round(Math.min(1, Math.max(0, shade)) * 255);
          data[o + 2] = 0;
          data[o + 3] = 255;
        }
    }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  readonly uniforms: {
    uTimeSim: { value: number };
    uTimeReal: { value: number };
    uWind: { value: THREE.Vector3 };
    uPixelScale: { value: number };
    uStreak: { value: number };
    uAmbient: { value: THREE.Color };
    uSun: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uAtlas: { value: THREE.Texture };
  };
  /** clocks in seconds (sim, real) */
  readonly clock = [0, 0];
  /** particle-seconds spawned per second (EMA) — steady-state live count estimate */
  load = 0;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly material: THREE.ShaderMaterial;
  private head = 0;
  private written = 0;
  private writeStart = 0;
  private lifeAcc = 0;

  constructor(capacity: number, atlas: THREE.Texture) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // all slots start dead (t0 far in the future)
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 6] = 1e9;
    const buf = (this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1));
    buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(buf, 4, 12));
    geo.setAttribute('iE', new THREE.InterleavedBufferAttribute(buf, 4, 16));
    geo.instanceCount = capacity;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = {
      uTimeSim: { value: 0 },
      uTimeReal: { value: 0 },
      uWind: { value: new THREE.Vector3(3, 0, 0) },
      uPixelScale: { value: 800 },
      uStreak: { value: 0.055 },
      uAmbient: { value: new THREE.Color(0.35, 0.38, 0.42) },
      uSun: { value: new THREE.Color(1, 0.95, 0.9) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uAtlas: { value: atlas },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // velocity-aligned quads (streaks, flames, ground rings) may be mirrored
      side: THREE.DoubleSide,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    Object.assign(this.material.uniforms, this.uniforms);
    const mesh = (this.mesh = new THREE.Mesh(geo, this.material));
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.name = 'effects.particles';
  }

  /** write one particle into the ring (overwrites the oldest slot) */
  emit(p: ParticleInit): void {
    const i = this.head;
    this.head = i + 1 === this.capacity ? 0 : i + 1;
    if (this.written === 0) this.writeStart = i;
    this.written++;
    const d = this.data, o = i * STRIDE;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = p.vx; d[o + 4] = p.vy; d[o + 5] = p.vz;
    d[o + 6] = this.clock[p.clock] - p.age; d[o + 7] = p.life;
    d[o + 8] = p.s0; d[o + 9] = p.s1; d[o + 10] = p.drag; d[o + 11] = p.wind;
    d[o + 12] = p.buoy; d[o + 13] = p.turb; d[o + 14] = p.c0 & 0xffffff; d[o + 15] = p.c1 & 0xffffff;
    d[o + 16] = p.alpha;
    d[o + 17] = (p.shape & 7) + (p.mode & 3) * 8 + (p.clock === 1 ? 32 : 0) + (p.additive ? 64 : 0);
    // integer part: streak stretch (1/32 s units), fraction: random seed
    d[o + 18] = Math.min(255, Math.round(p.stretch * 32)) + Math.random() * 0.999;
    d[o + 19] = p.glow;
    this.lifeAcc += p.life;
  }

  /** advance clocks, keep float precision, upload this frame's writes */
  update(dtSim: number, dtReal: number): void {
    const c = this.clock;
    c[0] += dtSim;
    c[1] += dtReal;
    for (let k = 0; k < 2; k++) if (c[k] > REBASE_AT) this.rebase(k);
    this.uniforms.uTimeSim.value = c[0];
    this.uniforms.uTimeReal.value = c[1];
    // steady-state occupancy estimate (particle-seconds spawned per second)
    if (dtReal > 0) {
      const inst = this.lifeAcc / dtReal;
      this.load += (inst - this.load) * Math.min(1, dtReal * 1.5);
    }
    this.lifeAcc = 0;
    this.flush();
  }

  /** fraction of the ring the current spawn rate keeps alive (≈ 1 = saturated) */
  get occupancy(): number {
    return this.load / this.capacity;
  }

  /** kill every particle */
  clear(): void {
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) d[i * STRIDE + 6] = 1e9;
    this.head = 0;
    this.written = 0;
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private rebase(k: number): void {
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * STRIDE;
      const isReal = (d[o + 17] % 64) >= 32;
      if ((k === 1) === isReal && d[o + 6] < 1e8) d[o + 6] -= REBASE_BY;
    }
    this.clock[k] -= REBASE_BY;
    this.written = 0;
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
  }

  private flush(): void {
    const n = this.written;
    if (!n) return;
    this.written = 0;
    const buf = this.buffer;
    if (n >= this.capacity) {
      buf.clearUpdateRanges();
      buf.needsUpdate = true;
      return;
    }
    const s = this.writeStart;
    if (s + n <= this.capacity) buf.addUpdateRange(s * STRIDE, n * STRIDE);
    else {
      buf.addUpdateRange(s * STRIDE, (this.capacity - s) * STRIDE);
      buf.addUpdateRange(0, (s + n - this.capacity) * STRIDE);
    }
    buf.needsUpdate = true;
  }
}
