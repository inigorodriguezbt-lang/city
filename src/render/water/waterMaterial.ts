// Water surface material (MeshStandardMaterial + onBeforeCompile): two
// scrolling normal layers plus a slow swell, fresnel reflection of the sky
// environment (PBR), sun glints, depth-based colour and transparency from the
// terrain height texture, animated shoreline foam, whitecaps in strong wind,
// rain ripples and flow along rivers. Output is premultiplied so reflections
// stay bright even where the water is shallow and clear.
import * as THREE from 'three';
import type { SharedUniforms } from '../sky/SharedUniforms';
import { TERRAIN_SAMPLE_GLSL } from '../terrain/TerrainData';
import { HASH_GLSL } from '../sky/skyShaders';

export interface WaterUniforms {
  [k: string]: THREE.IUniform;
  uHTex: { value: THREE.Texture | null };
  uMapCells: { value: number };
  uFarTex: { value: THREE.Texture | null };
  uFarOrigin: { value: number };
  uFarSpan: { value: number };
  uFarRes: { value: number };
  uWaterNormal: { value: THREE.Texture | null };
  uShallow: { value: THREE.Color };
  uDeep: { value: THREE.Color };
}

export function createWaterUniforms(): WaterUniforms {
  return {
    uHTex: { value: null },
    uMapCells: { value: 256 },
    uFarTex: { value: null },
    uFarOrigin: { value: -10000 },
    uFarSpan: { value: 20000 },
    uFarRes: { value: 128 },
    uWaterNormal: { value: null },
    uShallow: { value: new THREE.Color('#3f8f99') },
    uDeep: { value: new THREE.Color('#123f5a') },
  };
}

const PARS = /* glsl */ `
varying vec3 vWPos;
varying vec2 vFlow;
uniform sampler2D uWaterNormal;
uniform sampler2D uNoise;
uniform highp sampler2D uFarTex;
uniform float uFarOrigin, uFarSpan, uFarRes;
uniform vec3 uShallow, uDeep;
uniform float uTime, uWindSpeed, uRain, uMapSize, uNight;
uniform vec2 uWindDir;
${TERRAIN_SAMPLE_GLSL}
${HASH_GLSL}

float farHeight(vec2 p) {
  vec2 g = clamp((p - uFarOrigin) / uFarSpan, 0.0, 1.0) * (uFarRes - 1.0);
  vec2 i = min(floor(g), vec2(uFarRes - 2.0));
  vec2 f = g - i;
  ivec2 ii = ivec2(i);
  float a = texelFetch(uFarTex, ii, 0).r, b = texelFetch(uFarTex, ii + ivec2(1, 0), 0).r;
  float c = texelFetch(uFarTex, ii + ivec2(0, 1), 0).r, d = texelFetch(uFarTex, ii + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 rainRipples(vec2 p, float amount) {
  if (amount <= 0.01) return vec2(0.0);
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p / (k == 0 ? 1.3 : 0.83) + float(k) * 7.31;
    vec2 cell = floor(q);
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        vec2 h = hash22(c);
        float t = fract(uTime * (0.9 + 0.3 * h.y) + h.x);
        vec2 d = q - (c + 0.2 + 0.6 * h);
        float r = length(d);
        float ring = sin((r - t * 0.9) * 28.0) * smoothstep(0.0, 0.08, t * 0.9 - r + 0.08) * (1.0 - t) * smoothstep(0.9, 0.0, r);
        acc += (d / max(r, 1e-3)) * ring;
      }
  }
  return acc * amount * 0.35;
}
`;

export function createWaterMaterial(wu: WaterUniforms, shared: SharedUniforms, sea: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true });
  mat.name = sea ? 'WaterSea' : 'WaterInland';
  mat.depthWrite = true;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.envMapIntensity = 1.0;
  if (sea) mat.defines = { WATER_SEA: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wu, {
      uNoise: shared.uNoise,
      uTime: shared.uTime,
      uWindDir: shared.uWindDir,
      uWindSpeed: shared.uWindSpeed,
      uRain: shared.uRain,
      uMapSize: shared.uMapSize,
      uSeaLevel: shared.uSeaLevel,
      uFlood: shared.uFlood,
      uNight: shared.uNight,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec2 vFlow;\nattribute vec2 flow;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef WATER_SEA\nvFlow = vec2(0.0);\n#else\nvFlow = flow;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 wp = vWPos.xz;
        float level = vWPos.y;
        float groundH;
        #ifdef WATER_SEA
          bool insideMap = wp.x >= 0.0 && wp.y >= 0.0 && wp.x <= uMapSize && wp.y <= uMapSize;
          if (insideMap) {
            vec4 hs = hSample(wp);
            if (hs.g < -500.0 || abs(hs.g - level) > 0.35) discard;
            groundH = hs.r;
          } else {
            groundH = farHeight(wp);
          }
        #else
          groundH = hSample(wp).r;
        #endif
        float depth = max(0.0, level - groundH);
        float camDist = length(vWPos - cameraPosition);
        // waves
        float ws = clamp(uWindSpeed / 14.0, 0.0, 1.0);
        vec2 wdir = uWindDir;
        vec2 wperp = vec2(-wdir.y, wdir.x);
        vec2 fl = vFlow;
        float t = uTime;
        vec2 q = vec2(dot(wp, wdir), dot(wp, wperp));
        vec2 uv1 = q / 34.0 - vec2(t * (0.018 + 0.03 * ws), 0.0) - fl * t * 0.05;
        vec2 uv2 = vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8) / 11.0 - vec2(t * 0.045, t * 0.012) - fl * t * 0.12;
        vec2 uv3 = q / 190.0 - vec2(t * 0.006, 0.0);
        vec3 n1 = texture2D(uWaterNormal, uv1).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uWaterNormal, uv2).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(uWaterNormal, uv3).xyz * 2.0 - 1.0;
        vec2 sl = n1.xy * 0.55 + n2.xy * 0.4 + n3.xy * 0.6;
        sl = vec2(dot(sl, vec2(wdir.x, wperp.x)), dot(sl, vec2(wdir.y, wperp.y)));
        float amp = mix(0.18, 0.75, ws);
        #ifndef WATER_SEA
          amp *= 0.55 + 0.6 * clamp(length(fl) * 3.0, 0.0, 1.0);
        #endif
        amp *= mix(1.0, 0.3, smoothstep(250.0, 3500.0, camDist));
        amp *= smoothstep(0.0, 1.2, depth) * 0.7 + 0.3;
        sl *= amp;
        sl += rainRipples(wp, uRain * (1.0 - smoothstep(60.0, 220.0, camDist)));
        vec3 wN = normalize(vec3(-sl.x, 1.0, -sl.y));
        // colour by depth: shallow turquoise → deep; slight silt near banks
        float dd = 1.0 - exp(-depth / 6.5);
        vec3 wcol = mix(uShallow, uDeep, dd);
        wcol = mix(wcol * vec3(1.05, 1.0, 0.85), wcol, smoothstep(0.0, 2.5, depth));
        // foam: shoreline bands + whitecaps
        float fn = texture2D(uNoise, wp / 23.0 + vec2(t * 0.01, 0.0)).a;
        float fn2 = texture2D(uNoise, wp / 7.0 - vec2(0.0, t * 0.02)).g;
        #ifdef WATER_SEA
          float foamW = 0.7 + 0.8 * fn;
        #else
          float foamW = 0.2 + 0.25 * fn;
        #endif
        float edge = 1.0 - smoothstep(0.0, foamW, depth);
        float bands = 0.5 + 0.5 * sin(depth * 7.0 - t * 1.6 + fn * 8.0);
        float foam = edge * smoothstep(0.35, 0.8, fn2 * 0.6 + bands * 0.55);
        foam = max(foam, (1.0 - smoothstep(0.0, 0.1, depth)) * 0.5);
        #ifdef WATER_SEA
          float crest = smoothstep(0.35, 0.6, n1.x * 0.5 + n3.y * 0.5 + fn2 * 0.3) * clamp((uWindSpeed - 8.0) / 10.0, 0.0, 1.0);
          foam = max(foam, crest * 0.7 * (1.0 - smoothstep(400.0, 2500.0, camDist)));
        #endif
        foam *= 1.0 - smoothstep(900.0, 3000.0, camDist) * 0.6;
        diffuseColor.rgb = mix(wcol, vec3(0.92, 0.95, 0.97), foam);
        float wA = clamp(1.0 - exp(-depth * 0.65), 0.0, 1.0);
        wA = max(wA, foam * 0.95);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.035 + 0.07 * ws + 0.1 * uRain, 0.6, foam);',
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
        float aOut = clamp(max(wA, fres * 0.9), 0.0, 1.0);
        gl_FragColor = vec4(totalDiffuse * aOut + min(totalSpecular, vec3(6.0)) + totalEmissiveRadiance, aOut);
        `,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor);
        #endif
        `,
      );
  };
  mat.customProgramCacheKey = () => (sea ? 'urbis-water-sea' : 'urbis-water');
  return mat;
}
