// UFO visual: a brushed-metal flying saucer with a glowing glass dome, a
// chasing ring of coloured rim lights, a pulsing underside ring and a
// scanning tractor beam down to a glowing spot on the ground.
import * as THREE from 'three';
import { FOG_ADD, disposeTree, fxMaterial, type FxUniforms } from './fxShared';

const RIM_LIGHTS = 22;

const BEAM_VERT = /* glsl */ `
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

const BEAM_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uRealTime;
uniform float uBeam;
uniform vec3 uColor;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vFacing;
void main() {
  float v = vUv.y; // 1 at the saucer, 0 at the ground
  float scan = pow(0.5 + 0.5 * sin(v * 42.0 + uRealTime * 7.0), 6.0);
  float n = texture2D(uNoise, vec2(vUv.x * 3.0 + uRealTime * 0.05, v * 2.0 - uRealTime * 0.3)).g;
  float body = pow(vFacing, 1.3) * (0.35 + 0.65 * v) * (0.7 + 0.6 * n);
  vec3 col = uColor * (body * 0.9 + scan * 0.8 * vFacing) * uBeam;
  col *= smoothstep(0.0, 0.06, v);
  ${FOG_ADD}
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPOT_VERT = /* glsl */ `
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

const SPOT_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uRealTime;
uniform float uBeam;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float r = length(vP);
  float rings = pow(0.5 + 0.5 * sin(r * 26.0 - uRealTime * 6.0), 8.0) * smoothstep(1.0, 0.3, r);
  float disc = smoothstep(1.0, 0.0, r);
  vec3 col = uColor * (disc * disc * 1.2 + rings * 0.9) * uBeam;
  ${FOG_ADD}
  gl_FragColor = vec4(col, 1.0);
}
`;

export class UfoVisual {
  readonly group = new THREE.Group();
  private readonly craft = new THREE.Group();
  private readonly lights: THREE.InstancedMesh;
  private readonly beam: THREE.Mesh;
  private readonly spot: THREE.Mesh;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly spotMat: THREE.ShaderMaterial;
  private readonly underMat: THREE.MeshBasicMaterial;
  private readonly col = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private beamOn = 0;

  constructor(u: FxUniforms) {
    this.group.name = 'effects.ufo';
    // saucer hull (lathe profile, metres)
    const prof = [
      [0, -2.6], [3.5, -2.7], [8, -2.3], [12.5, -1.4], [16.2, -0.35], [17.2, 0], [16.4, 0.45], [13, 1.15], [9, 1.8], [6.4, 2.2], [0, 2.3],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const hull = new THREE.LatheGeometry(prof, 64);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xaab3bd, metalness: 0.92, roughness: 0.26 });
    const hullMesh = new THREE.Mesh(hull, hullMat);
    this.craft.add(hullMesh);
    // panel seam ring
    const seam = new THREE.Mesh(new THREE.TorusGeometry(12.6, 0.18, 6, 64), new THREE.MeshStandardMaterial({ color: 0x5c646c, metalness: 0.9, roughness: 0.4 }));
    seam.rotation.x = Math.PI / 2;
    seam.position.y = 1.2;
    this.craft.add(seam);
    // glass dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(6.6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x3cffd8, emissiveIntensity: 0.9, metalness: 0.1, roughness: 0.08 }),
    );
    dome.position.y = 2.1;
    dome.scale.y = 0.72;
    this.craft.add(dome);
    // underside glow ring
    this.underMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 1.8) });
    const under = new THREE.Mesh(new THREE.TorusGeometry(6.8, 0.55, 8, 48), this.underMat);
    under.rotation.x = Math.PI / 2;
    under.position.y = -2.55;
    this.craft.add(under);
    // rim lights
    this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), RIM_LIGHTS);
    for (let i = 0; i < RIM_LIGHTS; i++) {
      const a = (i / RIM_LIGHTS) * Math.PI * 2;
      this.m.makeTranslation(Math.cos(a) * 16.7, 0.05, Math.sin(a) * 16.7);
      this.lights.setMatrixAt(i, this.m);
      this.lights.setColorAt(i, this.col.setRGB(1, 1, 1));
    }
    this.craft.add(this.lights);
    this.group.add(this.craft);
    // tractor beam: cone from the belly (y=0) down to the ground (y=-1), scaled per frame
    const bg = new THREE.CylinderGeometry(5.5, 24, 1, 40, 1, true);
    bg.translate(0, -0.5, 0);
    const beamColor = new THREE.Color(0.35, 1.0, 0.8);
    this.beamMat = fxMaterial(u, { uBeam: { value: 0 }, uColor: { value: beamColor } }, BEAM_VERT, BEAM_FRAG, { additive: true, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 7;
    this.group.add(this.beam);
    this.spotMat = fxMaterial(u, { uBeam: { value: 0 }, uColor: { value: beamColor } }, SPOT_VERT, SPOT_FRAG, { additive: true, side: THREE.DoubleSide });
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.spotMat);
    this.spot.frustumCulled = false;
    this.spot.renderOrder = 7;
    this.group.add(this.spot);
    this.group.traverse((o) => {
      o.castShadow = o === hullMesh;
    });
  }

  /**
   * @param x,z craft position; y altitude of the craft; ground ground height under it
   * @param t real time (s); heading travel direction (rad); beam 0..1 target
   */
  update(x: number, y: number, z: number, ground: number, t: number, bank: THREE.Vector2, beam: number, dt: number): void {
    this.group.position.set(x, 0, z);
    const c = this.craft;
    c.position.set(0, y, 0);
    c.rotation.set(bank.y * 0.25, t * 0.9, -bank.x * 0.25, 'YXZ');
    c.rotation.y = t * 0.9;
    // chasing rim lights
    for (let i = 0; i < RIM_LIGHTS; i++) {
      const ph = ((i / RIM_LIGHTS) * 3 - t * 1.6) % 1;
      const k = Math.pow(0.5 + 0.5 * Math.cos(((ph + 1) % 1) * Math.PI * 2), 4);
      const hue = (i / RIM_LIGHTS + t * 0.05) % 1;
      this.col.setHSL(hue, 1, 0.55).multiplyScalar(1.2 + 5 * k);
      this.lights.setColorAt(i, this.col);
    }
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
    const pulse = 0.7 + 0.3 * Math.sin(t * 4);
    this.underMat.color.setRGB(0.4 * pulse, 2.4 * pulse, 1.9 * pulse);
    // beam
    this.beamOn += (beam - this.beamOn) * Math.min(1, dt * 2.5);
    const h = Math.max(1, y - 2.6 - ground);
    this.beam.position.set(0, y - 2.6, 0);
    this.beam.scale.set(1, h, 1);
    this.beamMat.uniforms.uBeam.value = this.beamOn * (0.85 + 0.15 * Math.sin(t * 13));
    this.spot.position.set(0, ground + 0.6, 0);
    this.spot.scale.set(26, 1, 26);
    this.spotMat.uniforms.uBeam.value = this.beamOn;
    this.beam.visible = this.spot.visible = this.beamOn > 0.01;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
