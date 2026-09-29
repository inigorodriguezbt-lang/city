// Instanced prop material: per-instance position/scale/rotation/colour jitter
// from instanced attributes, wind sway, seasonal foliage (spring freshness,
// cherry blossom, autumn colours, bare winter branches, snowy conifers).
// A matching depth material keeps shadows in sync with the animation.
import * as THREE from 'three';
import type { SharedUniforms } from '../sky/SharedUniforms';

export interface PropUniforms {
  [k: string]: THREE.IUniform;
  /** 0..1 deciduous leaf presence (0 = bare winter) */
  uLeaf: { value: number };
  uSpring: { value: number };
  uAutumn: { value: number };
  uBlossom: { value: number };
  uRockTint: { value: THREE.Color };
}

export function createPropUniforms(): PropUniforms {
  return {
    uLeaf: { value: 1 },
    uSpring: { value: 0 },
    uAutumn: { value: 0 },
    uBlossom: { value: 0 },
    uRockTint: { value: new THREE.Color(1, 1, 1) },
  };
}

const TRANSFORM = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iData;
attribute vec3 aCenter;
attribute float aKind;
attribute float aSway;
uniform float uTime, uWindSpeed, uLeaf;
uniform vec2 uWindDir;
bool propDeciduous(float k) { return abs(k - 1.0) < 0.5 || abs(k - 3.0) < 0.5; }
vec3 propRotate(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
vec3 propTransform(vec3 p) {
  float k = aKind;
  if (propDeciduous(k)) {
    float lf = clamp(uLeaf * 1.25 - (iData.y - 0.5) * 0.35 - 0.1, 0.0, 1.0);
    p = mix(aCenter, p, lf);
  }
  float stretch = 0.86 + 0.28 * fract(iData.z * 7.13);
  p.y *= stretch;
  p = propRotate(p, iData.x) * iPos.w;
  float rigid = (abs(k - 5.0) < 0.5 || abs(k - 6.0) < 0.5) ? 0.0 : 1.0;
  float sw = aSway * aSway * rigid;
  float phase = iData.z + iPos.x * 0.013 + iPos.z * 0.011;
  float gust = 0.55 + 0.3 * sin(uTime * 0.7 + phase) + 0.15 * sin(uTime * 2.1 + phase * 1.7);
  float strength = (0.12 + uWindSpeed * 0.028) * gust;
  p.xz += uWindDir * strength * sw * iPos.w;
  // leaf flutter
  float leafy = (k > 0.5 && k < 4.5) || abs(k - 7.0) < 0.5 ? 1.0 : 0.0;
  p += vec3(sin(uTime * 5.3 + phase * 3.0 + p.y), 0.0, cos(uTime * 4.7 + phase * 2.0 + p.x)) * 0.04 * sw * leafy * (0.3 + uWindSpeed * 0.06);
  return p + iPos.xyz;
}
`;

export function createPropMaterial(pu: PropUniforms, shared: SharedUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.name = 'Props';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pu, {
      uTime: shared.uTime,
      uWindDir: shared.uWindDir,
      uWindSpeed: shared.uWindSpeed,
      uSnow: shared.uSnow,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${TRANSFORM}
        attribute vec3 aAlt;
        uniform float uSpring, uAutumn, uBlossom, uSnow;
        uniform vec3 uRockTint;`,
      )
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = propRotate(objectNormal, iData.x);')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 transformed = propTransform(position);
        #ifdef USE_COLOR
        {
          float k = aKind;
          vec3 col = vColor.rgb * (0.86 + 0.28 * iData.y);
          float j = iData.y;
          if (abs(k - 1.0) < 0.5) {
            col = mix(col, col * vec3(1.18, 1.22, 0.7), uSpring * 0.55);
            float au = clamp(uAutumn * 1.5 - j * 0.5, 0.0, 1.0);
            vec3 autumn = aAlt * (0.7 + 0.6 * fract(j * 13.7)) * mix(vec3(1.0), vec3(1.15, 0.8, 0.5), step(0.7, fract(j * 5.3)));
            col = mix(col, autumn, au);
          } else if (abs(k - 3.0) < 0.5) {
            col = mix(col, col * vec3(1.1, 1.18, 0.8), uSpring * 0.4);
            col = mix(col, aAlt * (0.9 + 0.2 * j), clamp(uBlossom * 1.3 - j * 0.3, 0.0, 1.0));
            col = mix(col, vec3(0.55, 0.16, 0.08) * (0.8 + 0.4 * j), clamp(uAutumn * 1.4 - j * 0.4, 0.0, 1.0));
          } else if (abs(k - 6.0) < 0.5) {
            col *= uRockTint;
          }
          float snowy = (abs(k - 2.0) < 0.5 || abs(k - 6.0) < 0.5 || abs(k - 7.0) < 0.5 || k < 0.5) ? 1.0 : 0.0;
          float up = smoothstep(0.15, 0.75, normal.y);
          col = mix(col, vec3(0.86, 0.9, 0.95), clamp(uSnow * 1.2, 0.0, 1.0) * up * snowy * (0.75 + 0.25 * j));
          vColor.rgb = col;
        }
        #endif
        `,
      );
  };
  mat.customProgramCacheKey = () => 'urbis-props';
  return mat;
}

export function createPropDepthMaterial(pu: PropUniforms, shared: SharedUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.name = 'PropsDepth';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pu, {
      uTime: shared.uTime,
      uWindDir: shared.uWindDir,
      uWindSpeed: shared.uWindSpeed,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TRANSFORM}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = propTransform(position);');
  };
  mat.customProgramCacheKey = () => 'urbis-props-depth';
  return mat;
}
