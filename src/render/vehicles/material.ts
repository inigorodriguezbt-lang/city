// Vehicle materials.
//  • body: one MeshStandardMaterial for every model; per-vertex channels (aMat)
//    choose paint (× instance color), glass, chrome, plastic and the lights;
//    a per-instance vec4 (aState: brake, siren, lights, phase[+2 = reversed
//    section]) drives brake lights, flashing light bars, headlights, transit
//    cabin glow and signs through the emissive term (bloom picks them up).
//  • glow: additive camera-facing sprites for head / tail / siren lights with
//    a minimum on-screen size so they read from far away at night.
//  • beam: additive headlight pools projected on the road ahead at night.
import * as THREE from 'three';

export interface VehicleUniforms {
  uTime: { value: number };
  uNight: { value: number };
}

export function createBodyMaterial(u: VehicleUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, envMapIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uNight = u.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nattribute vec4 aState;\nvarying float vMat;\nvarying vec4 vState;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( 1.0 );
#ifdef USE_COLOR
  vColor.rgb *= color.rgb;
#endif
  vMat = aMat;
  vState = aState;
#ifdef USE_INSTANCING_COLOR
  if ( aMat < 0.5 ) vColor.rgb *= instanceColor.rgb;
  else if ( aMat > 9.5 && aMat < 10.5 ) vColor.rgb *= instanceColor.rgb * 0.55;
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uNight;\nvarying float vMat;\nvarying vec4 vState;')
      .replace(
        '#include <roughnessmap_fragment>',
        `int ch = int( vMat + 0.5 );
  float roughnessFactor = 0.78;
  if ( ch == 0 || ch == 10 ) roughnessFactor = 0.42;
  else if ( ch == 2 || ch == 8 ) roughnessFactor = 0.24;
  else if ( ch == 3 ) roughnessFactor = 0.4;
  else if ( ch == 12 ) roughnessFactor = 0.45;
  else if ( ch >= 4 && ch <= 7 || ch == 9 || ch == 11 || ch == 13 ) roughnessFactor = 0.42;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = 0.0;
  if ( ch == 0 || ch == 10 ) metalnessFactor = 0.22;
  else if ( ch == 2 || ch == 8 ) metalnessFactor = 0.2;
  else if ( ch == 3 ) metalnessFactor = 0.85;
  else if ( ch == 12 ) metalnessFactor = 0.08;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float brake = vState.x;
    float siren = vState.y;
    float lights = vState.z;
    float rev = step( 1.5, vState.w );
    float ph = fract( vState.w );
    vec3 em = vec3( 0.0 );
    if ( ch == 4 ) {
      em = rev > 0.5 ? vec3( 0.0 ) : vec3( 1.0, 0.9, 0.74 ) * ( 4.0 * lights );
    } else if ( ch == 5 ) {
      em = vec3( 1.0, 0.04, 0.02 ) * ( 0.04 + 1.8 * lights + 2.6 * brake );
    } else if ( ch == 13 ) {
      em = vec3( 1.0, 0.04, 0.02 ) * rev * ( 0.6 + 2.2 * lights );
    } else if ( ch == 6 || ch == 7 ) {
      float t = fract( uTime * 1.7 + ph );
      float strobe = 0.55 + 0.45 * step( 0.5, fract( t * 6.0 ) );
      float on = ch == 6 ? step( t, 0.5 ) : 1.0 - step( t, 0.5 );
      vec3 c = ch == 6 ? vec3( 1.0, 0.05, 0.03 ) : vec3( 0.08, 0.28, 1.0 );
      em = c * ( on * strobe * siren * ( 3.0 + 6.0 * uNight ) + 0.04 );
    } else if ( ch == 8 ) {
      em = vec3( 1.0, 0.86, 0.62 ) * lights * 0.75;
    } else if ( ch == 9 ) {
      float fl = siren > 0.5 ? step( fract( uTime * 1.25 + ph ), 0.4 ) * 3.5 : lights * 2.2;
      em = vec3( 1.0, 0.55, 0.08 ) * fl;
    } else if ( ch == 11 ) {
      em = vec3( 1.0, 0.6, 0.12 ) * ( 0.25 + 2.2 * lights );
    }
    totalEmissiveRadiance += em;
  }`,
      );
  };
  m.customProgramCacheKey = () => 'urbis-vehicle-body-v1';
  return m;
}

const GLOW_VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aGlow; // xyz, size (m)
attribute vec4 aCol; // rgb, intensity
uniform float uPixel;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4( aGlow.xyz, 1.0 );
  float dist = -mvPosition.z;
  float size = aGlow.w;
  float s = max( size, dist * uPixel * 2.4 );
  float fade = size / s;
  vCol = aCol.rgb * aCol.a * ( fade * 0.7 + 0.3 * sqrt( fade ) );
  mvPosition.xy += position.xy * s;
  // pull towards the camera so the sprite is not swallowed by its own lens geometry
  mvPosition.xyz *= 1.0 - min( 0.35, 0.6 / max( dist, 1.0 ) );
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const GLOW_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying vec3 vCol;
void main() {
  #include <logdepthbuf_fragment>
  float r = length( vUv );
  if ( r > 1.0 ) discard;
  float core = exp( -r * r * 18.0 );
  float halo = pow( 1.0 - r, 2.2 ) * 0.28;
  gl_FragColor = vec4( vCol * ( core * 1.6 + halo ), 1.0 );
  #include <fog_fragment>
}`;

export function createGlowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPixel: { value: 0.001 } }]),
    vertexShader: GLOW_VS,
    fragmentShader: GLOW_FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const BEAM_VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aBeam; // x, y, z, yaw
attribute vec4 aBeam2; // length, width, intensity, -
varying vec2 vUv;
varying float vI;
void main() {
  vUv = position.xy; // x: -1..1 across, y: 0..1 along
  vI = aBeam2.z;
  float c = cos( aBeam.w ), s = sin( aBeam.w );
  float lx = position.x * aBeam2.y * ( 0.35 + 0.65 * position.y );
  float lz = position.y * aBeam2.x;
  vec3 p = aBeam.xyz + vec3( lx * c + lz * s, 0.0, -lx * s + lz * c );
  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const BEAM_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying float vI;
void main() {
  #include <logdepthbuf_fragment>
  float across = 1.0 - vUv.x * vUv.x;
  float along = smoothstep( 0.0, 0.12, vUv.y ) * pow( 1.0 - vUv.y, 1.6 );
  float f = across * across * along * vI;
  gl_FragColor = vec4( vec3( 1.0, 0.86, 0.64 ) * f * 0.6, 1.0 );
  #include <fog_fragment>
}`;

export function createBeamMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  return m;
}
