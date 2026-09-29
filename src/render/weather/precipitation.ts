// Rain and snow as stateless GPU particles in a wrapping box around the view.
//
// Every drop/flake is an instance with a random seed; its position is
// origin + mod(seed·box + velocity·t − origin, box), so drops are anchored in
// the world (they don't slide with the camera) while the box follows the
// view. The box and the drop size scale with the camera distance, so a
// street-level view shows fine streaks and a panorama still reads as rain.
// Intensity changes how many instances are drawn (seed.w threshold) — no
// buffer updates ever.
import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uOrigin;
uniform float uBox;
uniform vec3 uVel;
uniform float uLen;
uniform float uWidth;
uniform float uDensity;
uniform float uSnow;
uniform float uFlutter;
uniform float uPixelScale;
varying vec2 vUv;
varying float vA;
varying float vStreak;
void main() {
  if (aSeed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float sp = 0.8 + 0.4 * fract(aSeed.w * 7.13 + aSeed.x * 3.1);
  vec3 v = uVel * sp;
  vec3 p = aSeed.xyz * uBox + v * uTime;
  if (uSnow > 0.5) {
    float ph = aSeed.x * 40.0 + aSeed.z * 17.0;
    p += vec3(sin(uTime * 0.9 + ph), 0.0, cos(uTime * 0.7 + ph * 1.3)) * uFlutter;
  }
  p = uOrigin + mod(p - uOrigin, uBox);
  // fade at the box faces (hides wrapping) and very close to the camera
  vec3 rel = abs(p - (uOrigin + 0.5 * uBox)) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.72, 1.0, max(rel.x, max(rel.y, rel.z)));
  float dc = length(p - cameraPosition);
  float near = smoothstep(uBox * 0.05, uBox * 0.22, dc);
  vec2 c = position.xy;
  vUv = c * 0.5 + 0.5;
  vec4 mvH = viewMatrix * vec4(p, 1.0);
  vec4 mv;
  float w = uWidth;
  float px = w * uPixelScale / max(1.0, -mvH.z);
  float thin = 1.0;
  if (px < 1.0) { thin = sqrt(max(px, 1e-3)); w *= 1.0 / max(px, 1e-3); }
  vStreak = uLen > 0.0 ? 1.0 : 0.0;
  if (uLen <= 0.0) {
    mv = mvH;
    mv.xy += c * w * 0.5;
  } else {
    vec3 dir = normalize(v);
    vec4 mvT = viewMatrix * vec4(p - dir * uLen, 1.0);
    vec2 d2 = mvH.xy - mvT.xy;
    float L = length(d2);
    d2 = L > 1e-4 ? d2 / L : vec2(0.0, 1.0);
    vec2 perp = vec2(-d2.y, d2.x);
    mv = mix(mvT, mvH, vUv.y);
    mv.xy += perp * c.x * w * 0.5;
  }
  vA = edge * near * thin;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSnow;
varying vec2 vUv;
varying float vA;
varying float vStreak;
void main() {
  float a;
  if (vStreak < 0.5) {
    float r = length(vUv - 0.5) * 2.0;
    a = smoothstep(1.0, 0.25, r);
  } else {
    float x = abs(vUv.x * 2.0 - 1.0);
    a = (1.0 - x * x) * smoothstep(0.0, 0.55, vUv.y);
  }
  a *= uAlpha * vA;
  if (a < 0.003) discard;
  vec3 col = uColor;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor, fogF);
    a *= 1.0 - 0.6 * fogF;
  #endif
  gl_FragColor = vec4(col, a);
}
`;

export interface PrecipParams {
  /** 0..1 how many instances are drawn */
  density: number;
  /** view-dependent box */
  origin: THREE.Vector3;
  box: number;
  /** velocity (m/s, already scaled to the box) */
  vel: THREE.Vector3;
  len: number;
  width: number;
  alpha: number;
  color: THREE.Color;
  flutter: number;
  pixelScale: number;
  time: number;
}

export class PrecipitationLayer {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(readonly count: number, snow: boolean) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      // stratified so that density d draws ≈ d·count instances
      seeds[i * 4 + 3] = (i + Math.random()) / count;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) as Record<string, THREE.IUniform>;
    Object.assign(uniforms, {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uBox: { value: 100 },
      uVel: { value: new THREE.Vector3(0, -9, 0) },
      uLen: { value: 1 },
      uWidth: { value: 0.03 },
      uDensity: { value: 0 },
      uSnow: { value: snow ? 1 : 0 },
      uFlutter: { value: 0 },
      uPixelScale: { value: 800 },
      uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uAlpha: { value: 0.3 },
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = snow ? 'weather.snow' : 'weather.rain';
    this.mesh.visible = false;
  }

  set(p: PrecipParams): void {
    const u = this.mat.uniforms;
    this.mesh.visible = p.density > 0.002 && p.alpha > 0.002;
    if (!this.mesh.visible) return;
    u.uTime.value = p.time;
    (u.uOrigin.value as THREE.Vector3).copy(p.origin);
    u.uBox.value = p.box;
    (u.uVel.value as THREE.Vector3).copy(p.vel);
    u.uLen.value = p.len;
    u.uWidth.value = p.width;
    u.uDensity.value = p.density;
    u.uFlutter.value = p.flutter;
    u.uPixelScale.value = p.pixelScale;
    (u.uColor.value as THREE.Color).copy(p.color);
    u.uAlpha.value = p.alpha;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
