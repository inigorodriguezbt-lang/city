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
            // the sea shows where sea water is near, plus any land a flood
            // (storm surge, tsunami) has pushed the sea over
            bool nearSea = hs.g > -500.0 && abs(hs.g - level) <= 0.35;
            bool flooded = uFlood > 0.01 && hs.r < level;
            if (!nearSea && !flooded) discard;
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
        // low-frequency field: domain warp + gusty "cat's paw" patches break the tiling
        vec4 mac = texture2D(uNoise, wp / 1300.0 + vec2(t * 0.0015, -t * 0.001));
        vec4 mac2 = texture2D(uNoise, wp / 310.0 - vec2(t * 0.004, t * 0.002));
        vec2 warp = (vec2(mac.g, mac2.r) - 0.5) * 14.0;
        float gustAmp = 0.55 + 0.75 * smoothstep(0.25, 0.75, mac.r * 0.7 + mac2.a * 0.3);
        vec2 q = vec2(dot(wp, wdir), dot(wp, wperp)) + warp;
        vec2 uv1 = q / 37.0 - vec2(t * (0.018 + 0.03 * ws), 0.0) - fl * t * 0.05;
        vec2 uv2 = vec2(q.x * 0.7986 - q.y * 0.6018, q.x * 0.6018 + q.y * 0.7986) / 12.3 - vec2(t * 0.045, t * 0.012) - fl * t * 0.12;
        vec2 uv3 = vec2(q.x * 0.9397 + q.y * 0.342, -q.x * 0.342 + q.y * 0.9397) / 173.0 - vec2(t * 0.006, 0.0);
        vec2 uv4 = vec2(q.x * 0.2588 - q.y * 0.9659, q.x * 0.9659 + q.y * 0.2588) / 4.7 - vec2(t * 0.09, -t * 0.03) - fl * t * 0.25;
        vec3 n1 = texture2D(uWaterNormal, uv1).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uWaterNormal, uv2).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(uWaterNormal, uv3).xyz * 2.0 - 1.0;
        vec3 n4 = texture2D(uWaterNormal, uv4).xyz * 2.0 - 1.0;
        float nearDetail = 1.0 - smoothstep(40.0, 260.0, camDist);
        vec2 sl = n1.xy * 0.55 + n2.xy * 0.38 + n3.xy * 0.55 + n4.xy * 0.3 * nearDetail;
        sl = vec2(dot(sl, vec2(wdir.x, wperp.x)), dot(sl, vec2(wdir.y, wperp.y)));
        float amp = mix(0.18, 0.75, ws) * gustAmp;
        #ifndef WATER_SEA
          amp *= 0.55 + 0.6 * clamp(length(fl) * 3.0, 0.0, 1.0);
        #endif
        amp *= mix(1.0, 0.3, smoothstep(250.0, 3500.0, camDist));
        amp *= smoothstep(0.0, 1.2, depth) * 0.7 + 0.3;
        // grazing views: calmer normals so reflections read as a mirror, not glitter
        float viewUp = abs(normalize(cameraPosition - vWPos).y);
        amp *= mix(0.4, 1.0, smoothstep(0.03, 0.35, viewUp));
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
        // horizontal distance to the waterline (depth / bottom slope): keeps the
        // surf band a few metres wide even over very flat shallows (no white flats)
        float bottomSlope = fwidth(depth) / max(length(fwidth(wp)), 1e-3);
        float shoreDist = depth / max(bottomSlope, 1e-3);
        float edge = (1.0 - smoothstep(0.0, foamW, depth)) * (1.0 - smoothstep(5.0, 16.0 + 14.0 * fn, shoreDist));
        float bands = 0.5 + 0.5 * sin(depth * 7.0 - t * 1.6 + fn * 8.0);
        float foam = edge * smoothstep(0.35, 0.8, fn2 * 0.6 + bands * 0.55);
        #ifdef WATER_SEA
          foam = max(foam, (1.0 - smoothstep(0.0, 0.1, depth)) * 0.5 * (1.0 - smoothstep(2.0, 8.0, shoreDist)));
        #else
          // rivers and lakes: a faint lap line; white water only on fast reaches (rapids)
          float rapid = smoothstep(0.35, 0.9, length(fl));
          foam *= 0.35 + 0.65 * rapid;
          foam = max(foam, (1.0 - smoothstep(0.0, 0.08, depth)) * 0.22);
          foam = max(foam, rapid * smoothstep(0.55, 0.8, fn2 * 0.7 + n2.x * 0.3) * 0.6 * (1.0 - smoothstep(300.0, 1500.0, camDist)));
        #endif
        #ifdef WATER_SEA
          float crest = smoothstep(0.35, 0.6, n1.x * 0.5 + n3.y * 0.5 + fn2 * 0.3) * clamp((uWindSpeed - 8.0) / 10.0, 0.0, 1.0);
          foam = max(foam, crest * 0.7 * (1.0 - smoothstep(400.0, 2500.0, camDist)));
        #endif
        foam *= 1.0 - smoothstep(900.0, 3000.0, camDist) * 0.6;
        // playable border (continues the line drawn on the terrain)
        vec2 bdd = max(max(-wp, wp - uMapSize), 0.0);
        float bIn = min(min(wp.x, wp.y), min(uMapSize - wp.x, uMapSize - wp.y));
        float bsd = length(bdd) > 0.0 ? length(bdd) : -bIn;
        float blw = max(2.5, camDist * 0.0018);
        float borderLine = exp(-(bsd * bsd) / (blw * blw));
        diffuseColor.rgb = mix(wcol, vec3(0.92, 0.95, 0.97), foam);
        #ifdef WATER_SEA
          float wA = clamp(1.0 - exp(-depth * 0.65), 0.0, 1.0);
        #else
          // fresh water carries silt and tannins: it turns opaque quickly
          float wA = clamp(1.0 - exp(-depth * 1.1), 0.0, 1.0);
        #endif
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
        vec3 borderGlow = vec3(1.0, 0.9, 0.7) * borderLine * 0.22 * (1.0 - uNight * 0.75);
        aOut = max(aOut, borderLine * 0.5);
        gl_FragColor = vec4(totalDiffuse * aOut + min(totalSpecular, vec3(6.0)) + totalEmissiveRadiance + borderGlow, aOut);
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
