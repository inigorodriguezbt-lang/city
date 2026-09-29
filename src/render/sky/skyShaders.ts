// Sky shaders: sky-view LUT bake (physically based scattering) and the
// full-screen sky (LUT lookup + sun/moon discs + stars + milky way + two
// cloud decks + overcast + horizon haze). The same sky material, compiled in
// ENV_MODE, renders the environment cube used for PBR reflections.
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, SKY_RADIANCE_SCALE } from './atmosphere';

export const SKY_LUT_W = 128;
export const SKY_LUT_H = 64;

/** Hash / noise helpers shared by several render-core shaders. */
export const HASH_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

/** Cloud deck density (shared by the sky and the cloud-shadow post pass). */
export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uNoise;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
float cloudDensity(vec2 p) {
  p += uCloudOffset;
  vec4 a = texture2D(uNoise, p * (1.0 / 23000.0));
  vec4 b = texture2D(uNoise, p * (1.0 / 6300.0) + vec2(0.31, 0.17));
  vec4 c = texture2D(uNoise, p * (1.0 / 1900.0) + vec2(0.13, 0.71));
  float n = a.r * 0.56 + b.g * 0.29 + c.a * 0.15 + (b.b - 0.45) * 0.1;
  float cov = clamp(uCloudCover, 0.0, 1.0);
  float th = mix(0.74, 0.24, cov);
  return smoothstep(th, th + mix(0.1, 0.34, cov), n);
}
`;

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Material that bakes the sky-view LUT (u = azimuth from sun 0..PI, v = sqrt(elevation)). */
export function createSkyLutMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SkyLUT',
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() },
      uTurbidity: { value: 1 },
      uMieG: { value: 0.78 },
      uMsScale: { value: 0.55 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      ${ATMOSPHERE_GLSL}
      void main() {
        float az = vUv.x * ATM_PI;
        float el = vUv.y * vUv.y * ATM_PI * 0.5;
        vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
        gl_FragColor = vec4(atmSkyRadiance(dir) * ${SKY_RADIANCE_SCALE.toFixed(2)}, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
  uLut: { value: THREE.Texture | null };
  uSunDir: { value: THREE.Vector3 };
  uSunDisc: { value: THREE.Color };
  uMoonDir: { value: THREE.Vector3 };
  uMoonColor: { value: THREE.Color };
  uMoonGlow: { value: number };
  uNightSky: { value: THREE.Color };
  uCityGlow: { value: THREE.Color };
  uStars: { value: number };
  uStarRot: { value: THREE.Matrix3 };
  uPixelAngle: { value: number };
  uOvercast: { value: number };
  uOvercastColor: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uHorizonFog: { value: number };
  uHorizonFalloff: { value: number };
  uNoise: { value: THREE.Texture | null };
  uCloudCover: { value: number };
  uCloudOffset: { value: THREE.Vector2 };
  uCloudsOn: { value: number };
  uCloudHeight: { value: number };
  uCloudLightDir: { value: THREE.Vector3 };
  uCloudSun: { value: THREE.Color };
  uCloudAmbient: { value: THREE.Color };
  uCloudDark: { value: number };
  uCirrus: { value: number };
  uGroundColor: { value: THREE.Color };
  uTime: { value: number };
}

export function createSkyUniforms(): SkyUniforms {
  return {
    uLut: { value: null },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: new THREE.Color(0, 0, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonColor: { value: new THREE.Color(0, 0, 0) },
    uMoonGlow: { value: 0 },
    uNightSky: { value: new THREE.Color(0.004, 0.006, 0.014) },
    uCityGlow: { value: new THREE.Color(0, 0, 0) },
    uStars: { value: 0 },
    uStarRot: { value: new THREE.Matrix3() },
    uPixelAngle: { value: 0.001 },
    uOvercast: { value: 0 },
    uOvercastColor: { value: new THREE.Color(0.5, 0.52, 0.55) },
    uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uHorizonFog: { value: 0.5 },
    uHorizonFalloff: { value: 16 },
    uNoise: { value: null },
    uCloudCover: { value: 0.2 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudsOn: { value: 1 },
    uCloudHeight: { value: 2200 },
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudSun: { value: new THREE.Color(1, 1, 1) },
    uCloudAmbient: { value: new THREE.Color(0.4, 0.45, 0.55) },
    uCloudDark: { value: 0 },
    uCirrus: { value: 0.4 },
    uGroundColor: { value: new THREE.Color(0.1, 0.1, 0.08) },
    uTime: { value: 0 },
  };
}

/**
 * Full-screen sky. In the main scene it is drawn after opaque geometry at the
 * far plane with depth testing, so it only shades uncovered pixels.
 */
export function createSkyMaterial(uniforms: SkyUniforms, envMode: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: envMode ? 'SkyEnv' : 'Sky',
    uniforms,
    defines: envMode ? { ENV_MODE: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 v = inverse(projectionMatrix) * vec4(position.xy, 0.5, 1.0);
        vec3 viewDir = v.xyz / v.w;
        vDir = transpose(mat3(viewMatrix)) * viewDir;
        #ifdef ENV_MODE
          gl_Position = vec4(position.xy, 0.5, 1.0);
        #else
          #ifdef USE_REVERSED_DEPTH_BUFFER
            gl_Position = vec4(position.xy, 1e-7, 1.0);
          #else
            gl_Position = vec4(position.xy, 0.9999999, 1.0);
          #endif
        #endif
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform sampler2D uLut;
      uniform vec3 uSunDir;
      uniform vec3 uSunDisc;
      uniform vec3 uMoonDir;
      uniform vec3 uMoonColor;
      uniform float uMoonGlow;
      uniform vec3 uNightSky;
      uniform vec3 uCityGlow;
      uniform float uStars;
      uniform mat3 uStarRot;
      uniform float uPixelAngle;
      uniform float uOvercast;
      uniform vec3 uOvercastColor;
      uniform vec3 uFogColor;
      uniform float uHorizonFog;
      uniform float uHorizonFalloff;
      uniform float uCloudsOn;
      uniform float uCloudHeight;
      uniform vec3 uCloudLightDir;
      uniform vec3 uCloudSun;
      uniform vec3 uCloudAmbient;
      uniform float uCloudDark;
      uniform float uCirrus;
      uniform vec3 uGroundColor;
      uniform float uTime;
      ${HASH_GLSL}
      ${CLOUD_GLSL}

      vec3 skyLut(vec3 d) {
        float el = asin(clamp(d.y, 0.0, 1.0));
        vec2 dh = d.xz;
        vec2 sh = uSunDir.xz;
        float ld = length(dh), ls = length(sh);
        float c = (ld > 1e-4 && ls > 1e-4) ? dot(dh / ld, sh / ls) : 1.0;
        float az = acos(clamp(c, -1.0, 1.0));
        vec2 uv = vec2(az / 3.14159265, sqrt(el / 1.5707963));
        uv = uv * vec2(${(1 - 1 / SKY_LUT_W).toFixed(5)}, ${(1 - 1 / SKY_LUT_H).toFixed(5)}) + vec2(${(0.5 / SKY_LUT_W).toFixed(5)}, ${(0.5 / SKY_LUT_H).toFixed(5)});
        return texture2D(uLut, uv).rgb;
      }

      float hg(float mu, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (12.566 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
      }

      vec3 starField(vec3 d) {
        vec3 sd = uStarRot * d;
        vec3 col = vec3(0.0);
        // two densities of stars: a few bright ones and many faint ones
        for (int layer = 0; layer < 2; layer++) {
          float scale = layer == 0 ? 90.0 : 230.0;
          vec3 g = sd * scale;
          vec3 c = floor(g);
          float h = hash13(c + float(layer) * 17.0);
          float threshold = layer == 0 ? 0.955 : 0.968;
          if (h > threshold) {
            vec3 j = hash33(c + 3.7) - 0.5;
            vec3 sp = normalize((c + 0.5 + j * 0.6) / scale);
            float ang = length(sd - sp);
            float mag = pow((h - threshold) / (1.0 - threshold), layer == 0 ? 3.0 : 6.0);
            float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 5.0 * j.x) + h * 60.0);
            float core = exp(-pow(ang / (uPixelAngle * 0.7), 2.0));
            vec3 tint = mix(vec3(0.75, 0.83, 1.0), vec3(1.0, 0.86, 0.7), fract(h * 91.7));
            col += tint * core * mag * tw * (layer == 0 ? 7.0 : 2.2);
          }
        }
        // milky way: soft band with dusty structure
        vec3 bandN = normalize(vec3(0.35, 0.3, 0.88));
        float b = dot(sd, bandN);
        float band = exp(-b * b * 22.0);
        vec2 buv = vec2(atan(sd.z, sd.x) * 0.9, b * 3.0);
        float dust = texture2D(uNoise, buv * 0.35).g * 0.7 + texture2D(uNoise, buv * 1.3).a * 0.3;
        col += vec3(0.55, 0.6, 0.8) * band * smoothstep(0.35, 0.8, dust) * 0.045;
        return col;
      }

      vec4 cumulus(vec3 d, vec3 haze) {
        if (d.y < 0.012) return vec4(0.0);
        float camY = cameraPosition.y;
        float t = (uCloudHeight - camY) / d.y;
        vec2 p = cameraPosition.xz + d.xz * t;
        float den = cloudDensity(p);
        if (den <= 0.001) return vec4(0.0);
        vec3 L = uCloudLightDir;
        // light march toward the key light through the deck (3 taps)
        vec2 lo = normalize(L.xz + vec2(1e-4)) * (400.0 / max(L.y, 0.12));
        float s = cloudDensity(p + lo * 0.22) * 0.5 + cloudDensity(p + lo * 0.6) * 0.35 + cloudDensity(p + lo * 1.25) * 0.25;
        // Beer + a softer multiple-scattering lobe keeps thick clouds luminous
        float beer = exp(-s * 2.6);
        float ms = mix(beer, exp(-s * 0.7), 0.45);
        float powder = 1.0 - exp(-den * 4.0);
        float mu = dot(d, L);
        float phase = hg(mu, 0.6) * 0.72 + hg(mu, -0.2) * 0.28;
        float dark = 1.0 - uCloudDark;
        vec3 lit = uCloudSun * ms * mix(1.0, powder, 0.55) * (0.62 + 11.0 * phase) * 1.2 * dark;
        // silver lining: thin edges light up when looking toward the light
        lit += uCloudSun * (1.0 - smoothstep(0.0, 0.45, den)) * pow(max(mu, 0.0), 8.0) * 2.5 * dark;
        // sky light from above (thin parts brighter), ground bounce on the bases
        float baseView = smoothstep(0.08, 0.7, d.y);
        vec3 amb = uCloudAmbient * (1.32 - 0.5 * den) * mix(1.0, 0.55, uCloudDark) + uGroundColor * 0.35 * den;
        vec3 col = lit * mix(1.0, 0.72, baseView * den) + amb;
        float alpha = smoothstep(0.0, 0.42, den) * 0.97;
        // aerial perspective: distant clouds melt into the horizon haze
        float fade = exp(-t / 52000.0);
        col = mix(haze, col, clamp(fade * 1.25, 0.0, 1.0));
        alpha *= smoothstep(0.0, 0.35, fade);
        return vec4(col, alpha);
      }

      vec4 cirrus(vec3 d) {
        if (d.y < 0.02 || uCirrus <= 0.0) return vec4(0.0);
        float t = (8500.0 - cameraPosition.y) / d.y;
        vec2 p = cameraPosition.xz + d.xz * t + uCloudOffset * 1.6;
        vec2 q = vec2(p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8);
        float n = texture2D(uNoise, q * vec2(1.0 / 30000.0, 1.0 / 8000.0)).g * 0.75 + texture2D(uNoise, q * vec2(1.0 / 11000.0, 1.0 / 3200.0) + 0.3).a * 0.25;
        // soft, translucent wisps (never brighter than a thin veil)
        float a = smoothstep(0.5, 0.86, n) * uCirrus * 0.42 * exp(-t / 90000.0);
        vec3 col = uCloudSun * 0.55 + uCloudAmbient * 0.8;
        return vec4(col, a);
      }

      void main() {
        vec3 d = normalize(vDir);
        #ifdef ENV_MODE
          if (d.y < -0.02) {
            float g = smoothstep(-0.02, -0.25, d.y);
            vec3 hz = mix(skyLut(vec3(d.x, 0.0, d.z)), uFogColor, 0.6);
            gl_FragColor = vec4(mix(hz, uGroundColor, g), 1.0);
            return;
          }
        #endif
        vec3 base = skyLut(d);
        vec3 horizonHaze = skyLut(normalize(vec3(d.x, 0.02, d.z)));
        vec3 col = base;
        // night sky: airglow gradient, light pollution, stars
        float up = clamp(d.y, 0.0, 1.0);
        col += uNightSky * (0.4 + 0.9 * pow(1.0 - up, 3.0));
        col += uCityGlow * pow(1.0 - up, 6.0);
        #ifndef ENV_MODE
          if (uStars > 0.001) col += starField(d) * uStars * smoothstep(-0.02, 0.1, d.y);
        #endif
        // moon glow + disc
        float cm = dot(d, uMoonDir);
        col += uMoonColor * uMoonGlow * (pow(max(cm, 0.0), 900.0) * 0.6 + pow(max(cm, 0.0), 40.0) * 0.05);
        #ifndef ENV_MODE
          float moonR = 0.0165;
          float ma = acos(clamp(cm, -1.0, 1.0));
          if (ma < moonR * 1.2 && uMoonDir.y > -0.05) {
            vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 upv = cross(right, uMoonDir);
            vec2 q = vec2(dot(d, right), dot(d, upv)) / moonR;
            float r2 = dot(q, q);
            if (r2 < 1.0) {
              vec3 n = right * q.x + upv * q.y - uMoonDir * sqrt(1.0 - r2);
              float lit = smoothstep(-0.05, 0.12, dot(n, uSunDir));
              float maria = texture2D(uNoise, q * 0.35 + 0.5).r;
              float crater = texture2D(uNoise, q * 1.1 + 0.2).b;
              float albedo = 0.55 + 0.45 * smoothstep(0.35, 0.65, maria) - 0.12 * smoothstep(0.6, 0.9, crater);
              vec3 moon = uMoonColor * (lit * albedo * 9.0 + 0.04);
              float edge = smoothstep(1.0, 0.92, r2);
              col = mix(col, moon + base * 0.3, edge * (1.0 - uOvercast * 0.9));
            }
          }
          // sun disc with limb darkening
          float cs = dot(d, uSunDir);
          float sunR = 0.0105;
          float sa = acos(clamp(cs, -1.0, 1.0));
          if (sa < sunR * 1.5) {
            float x = clamp(sa / sunR, 0.0, 1.0);
            float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - x * x)));
            float disc = smoothstep(1.0, 0.85, sa / sunR);
            col += uSunDisc * disc * limb * (1.0 - uOvercast);
          }
        #endif
        if (uCloudsOn > 0.5) {
          vec4 ci = cirrus(d);
          col = mix(col, ci.rgb, ci.a * (1.0 - uOvercast));
          vec4 cu = cumulus(d, horizonHaze);
          col = mix(col, cu.rgb, cu.a);
        }
        // overcast deck: a soft grey dome, a little brighter toward the light
        float oc = uOvercast;
        if (oc > 0.0) {
          float glow = pow(max(dot(d, uCloudLightDir), 0.0), 6.0);
          // structured deck: slow-drifting darker cloud masses and brighter gaps
          vec2 op = (cameraPosition.xz + d.xz * ((1600.0 - cameraPosition.y) / max(d.y, 0.03))) + uCloudOffset * 0.7;
          float m1 = texture2D(uNoise, op / 14000.0).r;
          float m2 = texture2D(uNoise, op / 4200.0 + 0.37).g;
          float masses = smoothstep(0.3, 0.8, m1 * 0.65 + m2 * 0.35);
          float structure = mix(1.12, 0.62 - 0.22 * uCloudDark, masses) * mix(1.0, 0.94, uCloudDark);
          structure = mix(1.0, structure, smoothstep(0.02, 0.2, d.y) * 0.85);
          vec3 ov = uOvercastColor * (0.78 + 0.32 * up + 0.35 * glow) * structure;
          col = mix(col, ov, oc * smoothstep(-0.05, 0.08, d.y + 0.1));
        }
        // horizon haze matches the scene fog colour
        float hf = uHorizonFog * exp(-max(d.y, 0.0) * uHorizonFalloff);
        col = mix(col, uFogColor, clamp(hf, 0.0, 1.0));
        #ifdef ENV_MODE
          col = mix(col, mix(col, uGroundColor, 0.3), smoothstep(0.0, -0.02, d.y));
        #endif
        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
      }
    `,
    depthTest: !envMode,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
  });
}
