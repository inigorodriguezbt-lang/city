// Post-processing pipeline (hand-rolled around three's passes so we control
// the depth buffer format and pass order):
//
//   scene → HDR target (HalfFloat colour + 32-bit float depth texture)
//   → GTAO (optional, normals reconstructed from our depth, no extra scene pass)
//   → UnrealBloom (optional, added in place; threshold adapts to day/night)
//   → tilt-shift (optional, separable variable blur around a focus band)
//   → final: AO, cloud shadows (from depth), info-view desaturation, white
//     balance / saturation / contrast grading, ACES filmic, vignette, sRGB, dither
//   → SMAA (optional) → screen
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { CLOUD_GLSL, HASH_GLSL } from '../sky/skyShaders';
import type { SharedUniforms } from '../sky/SharedUniforms';

export interface PostSettings {
  bloom: boolean;
  ambientOcclusion: boolean;
  tiltShift: boolean;
  antialias: boolean;
}

export interface PostFrameParams {
  exposure: number;
  bloomThreshold: number;
  bloomStrength: number;
  /** 0..1 info-view desaturation */
  desaturate: number;
  /** direction toward the key light */
  sunDir: THREE.Vector3;
  /** 0..1 cloud shadow strength (0 disables) */
  cloudShadow: number;
  /** camera orbit distance (m), drives AO radius and tilt-shift strength */
  distance: number;
  pitch: number;
  /** white balance multiplier */
  whiteBalance: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  /** 0..1 scotopic blue lift of dark areas at night */
  nightLift: number;
}

const FINAL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform highp sampler2D tDepth;
uniform sampler2D tAO;
uniform float uAO;
uniform float uExposure;
uniform float uDesat;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uWB;
uniform float uCloudShadow;
uniform vec3 uSunDir;
uniform mat4 uInvViewProj;
uniform float uNightLift;
${HASH_GLSL}
${CLOUD_GLSL}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 c) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = inM * (c / 0.6);
  c = rrtOdt(c);
  return clamp(outM * c, 0.0, 1.0);
}
vec3 srgbOETF(vec3 v) {
  return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
}
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).r;
  #ifdef USE_REVERSED_DEPTH_BUFFER
    bool sky = depth <= 0.0;
    float ndcZ = depth;
  #else
    bool sky = depth >= 1.0;
    float ndcZ = depth * 2.0 - 1.0;
  #endif
  if (uAO > 0.0 && !sky) c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  if (uCloudShadow > 0.0 && !sky) {
    vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, ndcZ, 1.0);
    wp.xyz /= wp.w;
    vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.12), uSunDir.z));
    vec2 q = wp.xz + L.xz / L.y * (2200.0 - wp.y);
    // blurred (two taps, offset along the light) so the penumbra stays soft
    float cs = cloudDensity(q) * 0.6 + cloudDensity(q + L.xz * 260.0) * 0.4;
    c *= 1.0 - uCloudShadow * smoothstep(0.0, 0.95, cs);
  }
  float l = dot(c, LUMA);
  c = mix(c, vec3(l), uDesat);
  c *= uExposure * uWB;
  l = dot(c, LUMA);
  // scotopic (moonlit) vision: dark areas shift toward a readable blue while
  // lamps, windows and the lit sky keep their colour
  if (uNightLift > 0.0) {
    float nl = uNightLift * (1.0 - smoothstep(0.03, 0.3, l));
    c = mix(c, vec3(l) * vec3(0.6, 0.8, 1.25) * 2.4 + vec3(0.0026, 0.0042, 0.0085), nl * 0.8);
    l = dot(c, LUMA);
  }
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = pow(max(c, vec3(1e-6)) / 0.18, vec3(uContrast)) * 0.18;
  c = acesFilmic(c);
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.1, 0.9, dot(d, d) * 2.2);
  c = srgbOETF(c);
  c += (hash12(gl_FragCoord.xy + fract(uCloudOffset * 0.001)) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

const TILT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uDir;
uniform float uAmount;
uniform float uFocus;
uniform float uBand;
void main() {
  float dist = abs(vUv.y - uFocus);
  float r = uAmount * smoothstep(uBand, uBand + 0.35, dist);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float t = float(i) / 6.0;
    float w = exp(-t * t * 2.5);
    acc += texture2D(tColor, vUv + uDir * t * r).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class PostFX {
  readonly sceneRT: THREE.WebGLRenderTarget;
  private tiltRT: THREE.WebGLRenderTarget;
  private ldrRT: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass | null = null;
  private gtao: GTAOPass | null = null;
  private smaa: SMAAPass | null = null;
  private quad = new FullScreenQuad();
  private finalMat: THREE.ShaderMaterial;
  private tiltMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  settings: PostSettings = { bloom: true, ambientOcclusion: false, tiltShift: false, antialias: true };
  private invViewProj = new THREE.Matrix4();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, shared: SharedUniforms) {
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneRT.texture.name = 'urbis-hdr';
    this.tiltRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.ldrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.finalMat = new THREE.ShaderMaterial({
      name: 'UrbisFinal',
      uniforms: {
        tColor: { value: this.sceneRT.texture },
        tDepth: { value: depthTexture },
        tAO: { value: null },
        uAO: { value: 0 },
        uExposure: { value: 1 },
        uDesat: { value: 0 },
        uSat: { value: 1.05 },
        uContrast: { value: 1.04 },
        uVignette: { value: 0.3 },
        uWB: { value: new THREE.Color(1, 1, 1) },
        uCloudShadow: { value: 0 },
        uNightLift: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uInvViewProj: { value: this.invViewProj },
        uNoise: shared.uNoise,
        uCloudCover: shared.uCloudCover,
        uCloudOffset: shared.uCloudOffset,
      },
      vertexShader: FS_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.tiltMat = new THREE.ShaderMaterial({
      name: 'UrbisTiltShift',
      uniforms: {
        tColor: { value: null },
        uDir: { value: new THREE.Vector2() },
        uAmount: { value: 0.004 },
        uFocus: { value: 0.5 },
        uBand: { value: 0.12 },
      },
      vertexShader: FS_VERT,
      fragmentShader: TILT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.sceneRT.setSize(this.width, this.height);
    this.tiltRT.setSize(this.width, this.height);
    this.ldrRT.setSize(this.width, this.height);
    this.bloom?.setSize(this.width, this.height);
    this.gtao?.setSize(this.width, this.height);
    this.smaa?.setSize(this.width, this.height);
  }

  private ensurePasses(): void {
    const s = this.settings;
    if (s.bloom && !this.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.55, 0.6, 2);
      this.bloom.setSize(this.width, this.height);
    }
    if (s.ambientOcclusion && !this.gtao) {
      this.gtao = new GTAOPass(this.scene, this.camera, this.width, this.height);
      this.gtao.setGBuffer(this.sceneRT.depthTexture!);
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtao.updateGtaoMaterial({ radius: 4, distanceExponent: 1.4, thickness: 3, scale: 1.1, samples: 12, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
      this.gtao.setSize(this.width, this.height);
    }
    if (s.antialias && !this.smaa) {
      this.smaa = new SMAAPass();
      this.smaa.setSize(this.width, this.height);
    }
  }

  render(p: PostFrameParams): void {
    const r = this.renderer;
    const s = this.settings;
    this.ensurePasses();
    // 1. scene
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    // 2. ambient occlusion (from our depth buffer)
    let ao = 0;
    if (s.ambientOcclusion && this.gtao) {
      const rad = THREE.MathUtils.clamp(p.distance * 0.014, 1.5, 22);
      this.gtao.updateGtaoMaterial({ radius: rad, thickness: rad * 0.8 });
      this.gtao.render(r, this.ldrRT, this.sceneRT, 0, false);
      this.finalMat.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
      ao = 0.85;
    }
    this.finalMat.uniforms.uAO.value = ao;
    // 3. bloom (added into the HDR target)
    if (s.bloom && this.bloom) {
      this.bloom.threshold = p.bloomThreshold;
      this.bloom.strength = p.bloomStrength;
      this.bloom.radius = 0.55;
      this.bloom.render(r, this.tiltRT, this.sceneRT, 0, false);
    }
    // 4. tilt-shift: strongest in mid zoom, fades at street level and far out
    if (s.tiltShift) {
      const zoomK = THREE.MathUtils.smoothstep(p.distance, 60, 250) * (1 - THREE.MathUtils.smoothstep(p.distance, 1800, 4500));
      const amount = 0.0065 * zoomK * THREE.MathUtils.clamp(p.pitch / 0.9, 0.4, 1.2);
      if (amount > 0.0003) {
        const u = this.tiltMat.uniforms;
        u.uAmount.value = amount;
        u.uFocus.value = 0.5;
        u.uBand.value = 0.1;
        this.quad.material = this.tiltMat;
        u.tColor.value = this.sceneRT.texture;
        u.uDir.value.set(1, 0);
        r.setRenderTarget(this.tiltRT);
        this.quad.render(r);
        u.tColor.value = this.tiltRT.texture;
        u.uDir.value.set(0, this.width / this.height);
        r.setRenderTarget(this.sceneRT);
        this.quad.render(r);
      }
    }
    // 5. final grade + tone mapping
    const fu = this.finalMat.uniforms;
    fu.uExposure.value = p.exposure;
    fu.uDesat.value = p.desaturate;
    fu.uSunDir.value.copy(p.sunDir);
    fu.uCloudShadow.value = p.cloudShadow;
    fu.uWB.value.copy(p.whiteBalance);
    fu.uSat.value = p.saturation;
    fu.uContrast.value = p.contrast;
    fu.uVignette.value = p.vignette;
    fu.uNightLift.value = p.nightLift;
    this.invViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).invert();
    this.quad.material = this.finalMat;
    if (s.antialias && this.smaa) {
      r.setRenderTarget(this.ldrRT);
      this.quad.render(r);
      this.smaa.renderToScreen = true;
      this.smaa.render(r, null as unknown as THREE.WebGLRenderTarget, this.ldrRT, 0, false);
    } else {
      r.setRenderTarget(null);
      this.quad.render(r);
    }
  }

  dispose(): void {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.tiltRT.dispose();
    this.ldrRT.dispose();
    this.bloom?.dispose();
    this.gtao?.dispose();
    this.smaa?.dispose();
    this.finalMat.dispose();
    this.tiltMat.dispose();
    this.quad.dispose();
  }
}
