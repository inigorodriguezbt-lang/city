// Night light glows (ModelLight) rendered as camera-facing additive billboards,
// one instanced draw per chunk. Lamps and floods fade in at dusk, neon glows
// a little even at twilight, aviation beacons blink.
import * as THREE from 'three';
import type { ModelLight } from '../types';

export interface WorldLight extends ModelLight {
  /** per-light phase for blinking (0..1) */
  phase?: number;
}

const KIND: Record<ModelLight['kind'], number> = { lamp: 0, beacon: 1, neon: 2, flood: 3 };

const uniforms: Record<string, THREE.IUniform> = {
  ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  uNight: { value: 0 },
  uTime: { value: 0 },
  uViewH: { value: 800 },
};

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iCol;
attribute vec3 iData; // size, kind, blink phase (negative = steady)
uniform float uNight;
uniform float uTime;
uniform float uViewH;
varying vec3 vCol;
varying vec2 vUv;
varying float vA;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  float kind = iData.y;
  float night = smoothstep(0.08, 0.6, uNight);
  float a;
  if (kind < 0.5) a = night;
  else if (kind < 1.5) {
    a = mix(0.35, 1.0, night);
    if (iData.z >= 0.0) a *= step(0.62, fract(uTime * 0.75 + iData.z));
  }
  else if (kind < 2.5) a = 0.06 + 0.94 * night;
  else a = night * 0.85;
  vA = a;
  vCol = iCol;
  vUv = position.xy;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float dist = max(1.0, -mv.z);
  // keep a minimum on-screen size so distant lights twinkle instead of vanishing
  float minWorld = dist * 3.2 / (projectionMatrix[1][1] * uViewH);
  float size = max(iData.x, minWorld * (kind > 0.5 && kind < 1.5 ? 2.2 : 1.4));
  mv.xy += position.xy * size * (a > 0.001 ? 1.0 : 0.0);
  // pull slightly toward the camera so glows are not swallowed by their own fixture
  mv.xyz += normalize(-mv.xyz) * min(1.5, iData.x * 0.4);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
varying float vA;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 18.0);
  float halo = exp(-r2 * 4.0) * 0.45;
  vec3 c = vCol * (halo + core * 1.6) + vec3(core * 0.6);
  float keep = 1.0;
#ifdef USE_FOG
  // additive glow: haze swallows it instead of tinting it
  #ifdef FOG_EXP2
  keep = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.6);
  #else
  keep = 1.0 - smoothstep(fogNear, fogFar, vFogDepth) * 0.85;
  #endif
#endif
  gl_FragColor = vec4(c * vA * keep, 1.0);
}
`;

let material: THREE.ShaderMaterial | null = null;
const QUAD = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0];

export function glowMaterial(): THREE.ShaderMaterial {
  if (!material) {
    material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: true,
    });
    material.name = 'bld:glow';
  }
  return material;
}

/** Build an instanced glow mesh for world-space lights (null if none). */
export function buildGlowMesh(lights: WorldLight[]): THREE.Mesh | null {
  if (!lights.length) return null;
  const g = new THREE.InstancedBufferGeometry();
  // own copy of the tiny quad so disposing one chunk never frees another's buffer
  g.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
  const n = lights.length;
  const pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), data = new Float32Array(n * 3);
  const c = new THREE.Color();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const l = lights[i];
    pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z;
    c.setHex(l.color);
    const boost = l.kind === 'beacon' ? 2.2 : l.kind === 'neon' ? 1.6 : 1.2;
    colr[i * 3] = c.r * boost; colr[i * 3 + 1] = c.g * boost; colr[i * 3 + 2] = c.b * boost;
    data[i * 3] = l.size * 0.5;
    data[i * 3 + 1] = KIND[l.kind] ?? 0;
    data[i * 3 + 2] = l.blink ? l.phase ?? ((i * 0.618) % 1) : -1;
    minX = Math.min(minX, l.x); minY = Math.min(minY, l.y); minZ = Math.min(minZ, l.z);
    maxX = Math.max(maxX, l.x); maxY = Math.max(maxY, l.y); maxZ = Math.max(maxZ, l.z);
  }
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(colr, 3));
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 3));
  g.instanceCount = n;
  g.boundingBox = new THREE.Box3(new THREE.Vector3(minX - 10, minY - 10, minZ - 10), new THREE.Vector3(maxX + 10, maxY + 10, maxZ + 10));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, glowMaterial());
  mesh.renderOrder = 5;
  mesh.frustumCulled = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'bld:glows';
  return mesh;
}

/** Per-frame uniforms. */
export function updateGlow(night: number, time: number, viewH: number): void {
  uniforms.uNight.value = night;
  uniforms.uTime.value = time % 10000;
  uniforms.uViewH.value = viewH;
}

export function disposeGlowMesh(m: THREE.Mesh): void {
  m.geometry.dispose();
}
