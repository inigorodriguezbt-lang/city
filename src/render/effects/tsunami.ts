// Tsunami wave: a kilometre-wide wall of water with a steep, curling,
// foam-capped front and a long back slope, travelling toward the coast.
// Local frame: +x along the wave front, −z is the direction of travel
// (the steep face), +z trails back out to sea.
import * as THREE from 'three';
import { FOG_ALPHA, disposeTree, fxMaterial, type FxUniforms } from './fxShared';

const WAVE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uSimTime;
uniform float uHeight;
uniform float uWidth;
uniform float uDepth;
uniform float uBow;
uniform sampler2D uNoise;
varying vec3 vN;
varying vec3 vView;
varying float vCrest;
varying float vFoam;
varying vec2 vUv;

float profile(float s) {
  // s: 0 = foot of the front face … 1 = far back
  float front = smoothstep(0.0, 0.1, s);
  float back = 1.0 - smoothstep(0.1, 1.0, s);
  return front * pow(back, 1.4);
}

vec3 wave(vec2 uv) {
  float lat = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
  float n = texture2D(uNoise, vec2(uv.x * 3.0 + uSimTime * 0.02, uv.y * 0.7)).r - 0.5;
  float h = uHeight * profile(uv.y) * lat * (0.85 + 0.35 * n);
  float x = (uv.x - 0.5) * uWidth;
  float z = uv.y * uDepth - uDepth * 0.08;
  // the front bows toward the shore in the middle, and the crest curls forward
  z -= uBow * (1.0 - pow(uv.x * 2.0 - 1.0, 2.0));
  float crest = smoothstep(0.03, 0.12, uv.y) * smoothstep(0.26, 0.1, uv.y);
  z -= crest * uHeight * 0.45 * lat;
  float chop = sin(x * 0.08 + uSimTime * 2.0) * sin(z * 0.11 - uSimTime * 1.7) * 0.6;
  return vec3(x, h + chop * lat, z);
}

void main() {
  vUv = uv;
  vec3 p = wave(uv);
  float e = 0.004;
  vec3 px = wave(uv + vec2(e, 0.0)) - p;
  vec3 pz = wave(uv + vec2(0.0, e)) - p;
  vec3 n = normalize(cross(pz, px));
  if (n.y < 0.0) n = -n;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * n);
  vView = normalize(cameraPosition - wp.xyz);
  float s = uv.y;
  vCrest = smoothstep(0.04, 0.12, s) * smoothstep(0.22, 0.12, s);
  vFoam = max(vCrest, smoothstep(0.035, 0.0, s));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WAVE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uSimTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFade;
varying vec3 vN;
varying vec3 vView;
varying float vCrest;
varying float vFoam;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float fres = pow(1.0 - max(0.0, dot(n, v)), 4.0);
  // light shining through the thin crest
  vec3 water = mix(uDeep, uShallow, vCrest * 0.8);
  float diff = 0.35 + 0.65 * max(0.0, dot(n, uSunDir));
  vec3 col = water * (uAmbient * 1.4 + uSunColor * 0.12 * diff);
  vec3 h = normalize(uSunDir + v);
  col += uSunColor * pow(max(0.0, dot(n, h)), 90.0) * 0.6;
  col = mix(col, uAmbient * 1.6, fres * 0.6);
  float fn = texture2D(uNoise, vec2(vUv.x * 18.0 - uSimTime * 0.1, vUv.y * 5.0 + uSimTime * 0.4)).a;
  float foam = smoothstep(0.35, 0.75, vFoam * (0.6 + 0.8 * fn));
  vec3 foamCol = vec3(0.92, 0.95, 0.97) * (uAmbient * 1.6 + uSunColor * 0.25 * diff);
  col = mix(col, foamCol, foam);
  ${FOG_ALPHA}
  float a = uFade * smoothstep(1.0, 0.8, vUv.y);
  gl_FragColor = vec4(col, a);
}
`;

export class TsunamiVisual {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  readonly width: number;
  readonly depth: number;

  constructor(u: FxUniforms, width = 2600, deep = 0x0d3f55, shallow = 0x3fa6a8) {
    this.group.name = 'effects.tsunami';
    this.width = width;
    this.depth = 900;
    const geo = new THREE.PlaneGeometry(1, 1, 160, 48);
    this.mat = fxMaterial(u, {
      uHeight: { value: 12 }, uWidth: { value: width }, uDepth: { value: this.depth }, uBow: { value: 180 },
      uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) }, uFade: { value: 1 },
    }, WAVE_VERT, WAVE_FRAG, { side: THREE.DoubleSide, depthWrite: true });
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.group.add(mesh);
  }

  /**
   * @param x,z position of the middle of the front foot (world)
   * @param dirX,dirZ unit direction of travel (toward the shore)
   * @param seaY sea surface height; height crest height above it; fade 0..1
   */
  update(x: number, z: number, dirX: number, dirZ: number, seaY: number, height: number, fade: number): void {
    this.group.position.set(x, seaY - 0.3, z);
    // local −z must point along (dirX, dirZ)
    this.group.rotation.set(0, Math.atan2(-dirX, -dirZ), 0);
    this.mat.uniforms.uHeight.value = height;
    this.mat.uniforms.uFade.value = fade;
    this.group.visible = fade > 0.01;
  }

  /** world position of a point on the crest, for spray (u ∈ 0..1 along the front) */
  crestPoint(u: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.mat.uniforms.uHeight.value as number;
    const bow = this.mat.uniforms.uBow.value as number;
    const lx = (u - 0.5) * this.width;
    const lz = 0.1 * this.depth - this.depth * 0.08 - bow * (1 - Math.pow(u * 2 - 1, 2)) - h * 0.45;
    out.set(lx, h * 0.9, lz).applyMatrix4(this.group.matrixWorld);
    return out;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
