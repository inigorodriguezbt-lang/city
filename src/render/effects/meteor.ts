// Meteor visual: a craggy, white-hot rock with an ablation cone trailing
// behind it. EffectsRenderer drives its position along the fall path and adds
// fire/smoke particles, the impact explosion and the smouldering crater.
import * as THREE from 'three';
import { FOG_ADD, disposeTree, fxMaterial, type FxUniforms } from './fxShared';

const ROCK_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const ROCK_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uSimTime;
uniform vec3 uFront;
uniform float uHeat;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vN);
  // the leading face is white hot, the lee side glows through cracks
  float lead = max(0.0, dot(n, uFront));
  float cracks = texture2D(uNoise, vLocal.xy * 0.35 + vLocal.z * 0.21 + uSimTime * 0.4).b;
  float rim = pow(1.0 - abs(dot(n, normalize(vView))), 2.0);
  vec3 rock = vec3(0.09, 0.07, 0.06);
  vec3 hot = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.9, 0.7), lead);
  float h = uHeat * clamp(lead * 1.3 + smoothstep(0.55, 0.9, cracks) * 0.8 + rim * 0.6, 0.0, 1.0);
  vec3 col = mix(rock, hot * 9.0, h);
  ${FOG_ADD.replace('col *= 1.0 - fogF;', 'col = mix(col, fogColor, fogF * 0.6);')}
  gl_FragColor = vec4(col, 1.0);
}
`;

const TRAIL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vFacing = abs(dot(n, normalize(cameraPosition - wp.xyz)));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TRAIL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uSimTime;
uniform float uHeat;
varying vec2 vUv;
varying float vFacing;
void main() {
  // v: 0 at the tail tip → 1 at the head (CylinderGeometry uv)
  float v = vUv.y;
  float n = texture2D(uNoise, vec2(vUv.x * 2.0, v * 1.5 - uSimTime * 3.0)).g;
  float core = pow(vFacing, 1.6);
  float fall = pow(v, 2.2);
  vec3 c = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.3, 0.8, v));
  c = mix(c, vec3(1.0, 0.92, 0.75), smoothstep(0.85, 1.0, v));
  vec3 col = c * fall * core * (0.55 + 0.9 * n) * 3.2 * uHeat;
  ${FOG_ADD}
  gl_FragColor = vec4(col, 1.0);
}
`;

export class MeteorVisual {
  readonly group = new THREE.Group();
  private readonly rock: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly rockMat: THREE.ShaderMaterial;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();

  constructor(u: FxUniforms, readonly radius: number) {
    this.group.name = 'effects.meteor';
    // craggy rock: displaced icosphere
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 5.1 + 1.3) * Math.sin(v.y * 4.3 + 0.7) * Math.sin(v.z * 6.1 + 2.1);
      const n2 = Math.sin(v.x * 11.7) * Math.sin(v.y * 13.1 + 1) * Math.sin(v.z * 9.3 + 2);
      v.multiplyScalar(1 + n * 0.22 + n2 * 0.07);
      v.y *= 0.82;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    this.rockMat = fxMaterial(u, { uFront: { value: new THREE.Vector3(0, -1, 0) }, uHeat: { value: 1 } }, ROCK_VERT, ROCK_FRAG, { transparent: false });
    this.rock = new THREE.Mesh(geo, this.rockMat);
    this.rock.scale.setScalar(radius);
    this.group.add(this.rock);
    // ablation trail: an open cone with its wide end at the head
    const tg = new THREE.CylinderGeometry(1, 0.08, 1, 28, 12, true);
    tg.translate(0, -0.5, 0); // y ∈ [-1, 0], head at 0 (uv.y = 1 at the head)
    this.trailMat = fxMaterial(u, { uHeat: { value: 1 } }, TRAIL_VERT, TRAIL_FRAG, { additive: true, side: THREE.DoubleSide });
    this.trail = new THREE.Mesh(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 7;
    this.group.add(this.trail);
    this.group.frustumCulled = false;
  }

  /** head position (world), unit travel direction, 0..1 heat */
  setState(x: number, y: number, z: number, dir: THREE.Vector3, heat: number, spin: number): void {
    this.group.position.set(x, y, z);
    // the cone spans local y ∈ [-1, 0] with its wide end at 0: map +y → travel direction
    this.trail.quaternion.setFromUnitVectors(this.up, this.tmp.copy(dir));
    const r = this.radius;
    this.trail.scale.set(r * 1.25, r * 34, r * 1.25);
    this.trail.position.copy(dir).multiplyScalar(r * 0.3);
    this.rock.rotation.set(spin * 0.7, spin, spin * 0.4);
    (this.rockMat.uniforms.uFront.value as THREE.Vector3).copy(dir);
    this.rockMat.uniforms.uHeat.value = heat;
    this.trailMat.uniforms.uHeat.value = heat;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
