// Tornado visual: a twisting condensation funnel (two nested translucent
// shells with swirling noise bands, drawn back faces first), a rotating wall
// cloud at the top, a flared debris skirt and orbiting debris chunks.
// The gameplay path lives in the EventSystem; this only follows it.
import * as THREE from 'three';
import { FOG_ALPHA, disposeTree, fxMaterial, type FxUniforms } from './fxShared';

const HEIGHT = 520;
const DEBRIS = 110;

const FUNNEL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uSimTime;
uniform float uR0;
uniform float uR1;
uniform float uH;
uniform float uSpin;
uniform vec2 uLean;
uniform float uGrow;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vH;
void main() {
  float v = uv.y;
  float ang = uv.x * 6.2831853;
  // radius profile: slender rope near the ground, flaring into the cloud base
  float r = mix(uR0, uR1, pow(v, 2.3)) + uR0 * 1.6 * exp(-v * 22.0);
  r *= 0.92 + 0.08 * sin(v * 23.0 - uSimTime * 3.0 + uv.x * 6.2831853 * 2.0);
  r *= uGrow;
  // sway and lean: the rope snakes while the top trails behind
  float t = uSimTime;
  vec2 sway = vec2(sin(t * 0.37 + v * 3.1), cos(t * 0.29 + v * 2.4)) * 26.0 * pow(v, 1.4)
            + vec2(sin(t * 1.1 + v * 7.0), cos(t * 0.9 + v * 6.0)) * 4.0 * v;
  vec2 off = sway + uLean * pow(v, 1.6);
  vec3 pos = vec3(cos(ang) * r + off.x, v * uH * uGrow, sin(ang) * r + off.y);
  vUv = uv;
  vH = v;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vN = normalize(mat3(modelMatrix) * vec3(cos(ang), 0.25 * (uR1 - uR0) / uH, sin(ang)));
  vView = normalize(cameraPosition - wp.xyz);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FUNNEL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uSimTime;
uniform float uSpin;
uniform float uOpacity;
uniform vec3 uTint;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uFlash;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vH;
void main() {
  float t = uSimTime;
  // swirling bands: the texture scrolls around faster near the ground
  vec2 q = vec2(vUv.x * 2.0 - t * uSpin * (1.4 - vH * 0.8) + vH * 1.3, vH * 2.6 - t * 0.35);
  float n1 = texture2D(uNoise, q).g;
  float n2 = texture2D(uNoise, q * vec2(3.0, 5.0) + vec2(t * 0.05, 0.0)).a;
  float bands = smoothstep(0.25, 0.8, n1 * 0.65 + n2 * 0.55);
  float facing = abs(dot(normalize(vN), vView));
  float edge = pow(1.0 - facing, 0.8);
  float a = uOpacity * mix(0.5, 1.0, edge) * (0.55 + 0.7 * bands);
  a *= smoothstep(1.0, 0.8, vH) * smoothstep(0.0, 0.015, vH);
  // lighting: dusty grey, darker toward the cloud base, rim lit by the sun
  float lit = 0.55 + 0.45 * max(0.0, dot(normalize(vN), uSunDir));
  vec3 col = uTint * (uAmbient * 1.1 + uSunColor * 0.16 * lit) * mix(1.05, 0.55, smoothstep(0.35, 1.0, vH));
  col *= 0.75 + 0.5 * bands;
  col += vec3(0.75, 0.8, 1.0) * uFlash * 0.9 * (0.4 + 0.6 * vH);
  ${FOG_ALPHA}
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const CLOUD_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position.x, 0.0, position.y, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uSimTime;
uniform float uRadius;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uFlash;
uniform float uGrow;
varying vec2 vP;
void main() {
  float r = length(vP) / uRadius;
  float ang = atan(vP.y, vP.x);
  // spiral inflow: rotate faster toward the centre
  float sw = ang + uSimTime * (0.25 + 0.6 * (1.0 - r)) + r * 3.0;
  vec2 q = vec2(cos(sw), sin(sw)) * r * 0.9 + 0.5;
  float n = texture2D(uNoise, q * 1.3).r * 0.6 + texture2D(uNoise, q * 3.7 + uSimTime * 0.01).g * 0.4;
  float a = smoothstep(1.0, 0.35, r) * (0.55 + 0.6 * n) * 0.92 * uGrow;
  vec3 col = vec3(0.24, 0.25, 0.27) * (uAmbient * 1.2 + uSunColor * 0.05) * (0.7 + 0.6 * n);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.7;
  ${FOG_ALPHA}
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export class TornadoVisual {
  readonly group = new THREE.Group();
  private readonly funnelMats: THREE.ShaderMaterial[] = [];
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly debris: THREE.InstancedMesh;
  private readonly orbit: Float32Array; // radius, height, phase, speed, tumble per chunk
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly prev = new THREE.Vector3(NaN, 0, 0);
  private lean = new THREE.Vector2();
  /** 0..1 formation / dissipation */
  grow = 0;

  constructor(private readonly u: FxUniforms, strength = 1) {
    this.group.name = 'effects.tornado';
    const seg = 56, rings = 64;
    const geo = new THREE.PlaneGeometry(1, 1, seg, rings);
    // uv only matters: x → angle, y → height
    const layers: { r0: number; r1: number; spin: number; opacity: number; tint: THREE.Color }[] = [
      { r0: 7 * strength, r1: 120 * strength, spin: 0.9, opacity: 1.0, tint: new THREE.Color(0.3, 0.28, 0.26) },
      { r0: 15 * strength, r1: 170 * strength, spin: 0.6, opacity: 0.42, tint: new THREE.Color(0.42, 0.38, 0.34) },
    ];
    let order = 7;
    for (const L of layers) {
      for (const side of [THREE.BackSide, THREE.FrontSide]) {
        const mat = fxMaterial(u, {
          uR0: { value: L.r0 }, uR1: { value: L.r1 }, uH: { value: HEIGHT }, uSpin: { value: L.spin },
          uLean: { value: this.lean }, uOpacity: { value: L.opacity }, uTint: { value: L.tint }, uGrow: { value: 0 },
        }, FUNNEL_VERT, FUNNEL_FRAG, { side });
        this.funnelMats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = order++;
        this.group.add(mesh);
      }
    }
    // wall cloud
    const cgeo = new THREE.CircleGeometry(1, 64);
    const radius = 520 * strength;
    this.cloudMat = fxMaterial(u, { uRadius: { value: 1 }, uGrow: { value: 0 } }, CLOUD_VERT, CLOUD_FRAG, { side: THREE.DoubleSide });
    const cloud = new THREE.Mesh(cgeo, this.cloudMat);
    cloud.scale.set(radius, 1, radius);
    cloud.position.y = HEIGHT * 0.97;
    cloud.renderOrder = 6;
    cloud.frustumCulled = false;
    this.group.add(cloud);
    // debris chunks
    const box = new THREE.BoxGeometry(1, 1, 1);
    const dmat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
    this.debris = new THREE.InstancedMesh(box, dmat, DEBRIS);
    this.debris.frustumCulled = false;
    this.debris.castShadow = false;
    const col = new THREE.Color();
    this.orbit = new Float32Array(DEBRIS * 6);
    for (let i = 0; i < DEBRIS; i++) {
      const o = i * 6;
      const hr = Math.random();
      this.orbit[o] = (10 + Math.random() * 55) * strength; // radius
      this.orbit[o + 1] = Math.pow(hr, 2.2) * 170; // height
      this.orbit[o + 2] = Math.random() * Math.PI * 2; // phase
      this.orbit[o + 3] = (0.8 + Math.random() * 0.6) * 6 / Math.sqrt(this.orbit[o]); // angular speed
      this.orbit[o + 4] = 0.4 + Math.random() * 1.8; // size
      this.orbit[o + 5] = Math.random() * 10; // tumble phase
      this.debris.setColorAt(i, col.setHSL(0.07 + Math.random() * 0.05, 0.2 + Math.random() * 0.2, 0.15 + Math.random() * 0.25));
    }
    this.group.add(this.debris);
  }

  /** place at world position (ground under the funnel); call every frame */
  update(x: number, y: number, z: number, simDt: number): void {
    const g = this.group;
    if (Number.isFinite(this.prev.x) && simDt > 0) {
      // lean the top back against the direction of travel
      const vx = (x - this.prev.x) / simDt, vz = (z - this.prev.z) / simDt;
      const k = Math.min(1, simDt * 0.8);
      this.lean.x += (-vx * 5 - this.lean.x) * k;
      this.lean.y += (-vz * 5 - this.lean.y) * k;
      this.lean.clampLength(0, 140);
    }
    this.prev.set(x, y, z);
    g.position.set(x, y, z);
    for (const m of this.funnelMats) m.uniforms.uGrow.value = 0.25 + 0.75 * this.grow;
    this.cloudMat.uniforms.uGrow.value = Math.min(1, this.grow * 1.4);
    // debris
    const t = this.u.uSimTime.value;
    const o = this.orbit;
    for (let i = 0; i < DEBRIS; i++) {
      const j = i * 6;
      const r = o[j] * (0.6 + 0.4 * this.grow), a = o[j + 2] + t * o[j + 3];
      const h = o[j + 1] * this.grow + 2;
      this.p.set(Math.cos(a) * r + this.lean.x * Math.pow(h / HEIGHT, 1.6), h, Math.sin(a) * r + this.lean.y * Math.pow(h / HEIGHT, 1.6));
      this.e.set(t * 2 + o[j + 5], t * 1.7 + o[j + 5] * 2, t * 1.3);
      this.q.setFromEuler(this.e);
      const sz = o[j + 4] * this.grow;
      this.s.set(sz, sz * 0.5, sz * 0.8);
      this.m.compose(this.p, this.q, this.s);
      this.debris.setMatrixAt(i, this.m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
