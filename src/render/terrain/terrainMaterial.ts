// Terrain material: MeshStandardMaterial extended through onBeforeCompile so
// shadows, fog, IBL and all lights keep working. Per-pixel it blends theme
// colours by slope, altitude, shore distance, moisture, season and snow, adds
// multi-scale detail noise, rock strata, wet shorelines, micro normals and the
// playable-border line.
import * as THREE from 'three';
import type { SharedUniforms } from '../sky/SharedUniforms';
import { TERRAIN_SAMPLE_GLSL } from './TerrainData';

export interface TerrainUniforms {
  [k: string]: THREE.IUniform;
  uHTex: { value: THREE.Texture | null };
  uNTex: { value: THREE.Texture | null };
  uMapCells: { value: number };
  uDetailN: { value: THREE.Texture | null };
  uGrass: { value: THREE.Color };
  uGrassDry: { value: THREE.Color };
  uDirt: { value: THREE.Color };
  uSand: { value: THREE.Color };
  uRock: { value: THREE.Color };
  uSnowCol: { value: THREE.Color };
  uDry: { value: number };
  uAutumn: { value: number };
  uLush: { value: number };
  uSnowLine: { value: number };
  uBorder: { value: number };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uHTex: { value: null },
    uNTex: { value: null },
    uMapCells: { value: 256 },
    uDetailN: { value: null },
    uGrass: { value: new THREE.Color('#5f8f3e') },
    uGrassDry: { value: new THREE.Color('#8a9a4a') },
    uDirt: { value: new THREE.Color('#7a6247') },
    uSand: { value: new THREE.Color('#d8c89a') },
    uRock: { value: new THREE.Color('#7d7a73') },
    uSnowCol: { value: new THREE.Color('#f4f7fb') },
    uDry: { value: 0.2 },
    uAutumn: { value: 0 },
    uLush: { value: 0.5 },
    uSnowLine: { value: 1e5 },
    uBorder: { value: 1 },
  };
}

const PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
uniform sampler2D uNTex;
uniform sampler2D uNoise;
uniform sampler2D uDetailN;
uniform vec3 uGrass, uGrassDry, uDirt, uSand, uRock, uSnowCol;
uniform float uDry, uAutumn, uLush, uSnowLine, uBorder;
uniform float uSnow, uWetness, uMapSize;
${TERRAIN_SAMPLE_GLSL}

void terrainShade(out vec3 alb, out float rough, out vec3 nW, out vec3 emis) {
  vec2 p = vWPos.xz;
  float h = vWPos.y;
  float camDist = length(vWPos - cameraPosition);
  float detailFade = 1.0 - smoothstep(500.0, 2400.0, camDist);
#ifdef TERRAIN_RING
  nW = normalize(vWNormal);
  float level = uSeaLevel + uFlood;
  float shore = clamp((h - level) * 10.0, 0.0, 200.0);
  float moist = 0.55;
  float cav = 0.5;
#else
  vec4 hs = hSample(p);
  float level = hs.g;
  vec4 nt = texture2D(uNTex, (p / 16.0 + 0.5) / (uMapCells + 1.0));
  vec2 nxz = nt.rg * 2.0 - 1.0;
  nW = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
  float shore = hs.b;
  float moist = hs.a;
  float cav = nt.b;
#endif
  float slope = 1.0 - nW.y;
  vec4 nA = texture2D(uNoise, p / 2900.0);
  vec4 nB = texture2D(uNoise, p / 430.0 + 0.37);
  vec4 nC = texture2D(uNoise, p / 67.0 + 0.61);
  vec4 nD = texture2D(uNoise, p / 9.7 + 0.13);
  float macro = nA.r, meso = nB.g, det = nC.a;
  float micro = mix(0.5, nD.a, detailFade);

  // meadow: moisture, exposure (south-facing slopes dry out), season
  float dry = clamp(uDry + (macro - 0.5) * 1.1 + (0.5 - moist) * 0.9 + nW.z * 0.35 + (meso - 0.5) * 0.45, 0.0, 1.0);
  vec3 grass = mix(uGrass * 0.78, uGrassDry * 0.82, smoothstep(0.12, 0.9, dry));
  // lush, darker bluish-green hollows vs sunlit yellow-green swards
  float lushN = smoothstep(0.35, 0.75, nA.g * 0.6 + moist * 0.5 - cav * 0.2);
  grass = mix(grass, grass * vec3(0.72, 0.86, 0.78), lushN * 0.8);
  grass = mix(grass, grass * vec3(1.12, 1.06, 0.72), smoothstep(0.55, 0.85, meso) * 0.5);
  grass *= 0.78 + 0.44 * meso * (0.7 + 0.3 * det);
  grass = mix(grass, grass * vec3(1.02, 1.04, 0.86), uLush * (1.0 - dry) * 0.6);
  grass = mix(grass, mix(grass, uGrassDry * vec3(1.05, 0.88, 0.62), 0.55), uAutumn * (0.45 + 0.55 * macro));
  grass *= mix(1.0, 0.8 + 0.4 * micro, detailFade);
  // clover/flower speckle in lush meadows, darker tufts
  float speck = smoothstep(0.78, 0.9, nD.g) * detailFade * uLush * (1.0 - dry);
  grass = mix(grass, vec3(0.62, 0.6, 0.35), speck * 0.25);
  grass *= 1.0 - smoothstep(0.6, 0.85, nD.b) * 0.18 * detailFade;

  // bare soil on moderate slopes and trampled patches
  float dirtMask = smoothstep(0.64, 0.8, meso * 0.55 + det * 0.35 + slope * 1.1 - moist * 0.25 + (1.0 - macro) * 0.1);
  vec3 dirt = uDirt * (0.78 + 0.44 * det) * (0.9 + 0.2 * micro);
  vec3 col = mix(grass, dirt, dirtMask * 0.8);

  // rock and cliffs with horizontal strata
  float rockMask = smoothstep(0.28, 0.44, slope + (det - 0.5) * 0.16 + (meso - 0.5) * 0.08);
  float strata = 0.5 + 0.5 * sin(h * 1.35 + meso * 7.0 + det * 2.5);
  float strata2 = 0.5 + 0.5 * sin(h * 4.1 + nC.b * 5.0);
  vec3 rock = uRock * (0.7 + 0.26 * strata + 0.12 * strata2) * (0.84 + 0.32 * micro) * (0.9 + 0.2 * nB.b);
  rock = mix(rock, rock * vec3(0.86, 0.83, 0.8), smoothstep(0.55, 0.85, slope));
  rock = mix(rock, rock * vec3(0.95, 1.02, 0.9), (1.0 - smoothstep(0.3, 0.5, slope)) * 0.5);
  col = mix(col, rock, rockMask);

  // beaches (sea) and muddy/grassy banks (lakes, rivers)
  float above = h - level;
  float seaWater = 1.0 - step(0.6, abs(level - (uSeaLevel + uFlood)));
  float nearWater = 1.0 - smoothstep(mix(10.0, 24.0, seaWater), mix(34.0, 90.0, seaWater), shore + (det - 0.5) * 24.0);
  float beach = nearWater * (1.0 - smoothstep(mix(0.3, 1.2, seaWater), mix(1.1, 3.6, seaWater), above + (meso - 0.5) * 1.6)) * (1.0 - smoothstep(0.22, 0.42, slope));
  vec3 sand = uSand * (0.86 + 0.22 * det) * (0.94 + 0.12 * micro);
  vec3 bank = mix(uDirt * 0.85, uSand * 0.8, 0.35 + 0.3 * det);
  col = mix(col, mix(bank, sand, seaWater), beach * mix(0.75, 1.0, seaWater));
  float wetBand = (1.0 - smoothstep(0.0, 0.6 + 0.6 * det, above)) * nearWater;
  float under = smoothstep(0.05, -0.5, above);
  vec3 silt = mix(uSand, uDirt, mix(0.7, 0.4, seaWater)) * mix(0.72, 0.42, smoothstep(0.0, 8.0, -above));
  col = mix(col, silt, under);

  // snow: altitude snow line + weather snow cover (patchy while melting)
  float snowAlt = smoothstep(uSnowLine - 22.0, uSnowLine + 22.0, h + (meso - 0.5) * 70.0 + (det - 0.5) * 24.0) * (1.0 - smoothstep(0.5, 0.78, slope));
  float cover = clamp(uSnow, 0.0, 1.0);
  float patchN = meso * 0.45 + det * 0.35 + micro * 0.2;
  float snowGround = smoothstep(1.0 - cover * 1.15, 1.08 - cover * 1.15, patchN) * (1.0 - smoothstep(0.42, 0.68, slope)) * (1.0 - under);
  float snow = clamp(max(snowAlt, snowGround), 0.0, 1.0);
  col = mix(col, uSnowCol * (0.9 + 0.1 * det), snow);

  // cavity darkening in gullies, slight lift on ridges
  col *= 0.8 + 0.4 * cav;
  // wetness: rain soaks everything, shorelines are always damp
  float wet = max(uWetness * 0.85 * (1.0 - snow), wetBand * 0.9);
  col *= mix(1.0, 0.58, wet * (1.0 - under));
  rough = mix(0.95, 0.84, rockMask);
  rough = mix(rough, 0.88, beach);
  rough = mix(rough, 0.55, snow);
  rough = mix(rough, 0.32, wet);

  // micro normals (stronger on rock), faded with distance
  vec3 dn = texture2D(uDetailN, p / 6.5).xyz * 2.0 - 1.0;
  vec3 dn2 = texture2D(uDetailN, p / 29.0 + 0.5).xyz * 2.0 - 1.0;
  float ns = detailFade * mix(0.28, 0.75, rockMask) * (1.0 - snow * 0.6) * (1.0 - under * 0.7);
  nW = normalize(nW + vec3(dn.x + dn2.x * 0.9, 0.0, dn.y + dn2.y * 0.9) * ns);

  // playable border: a thin soft line; the world outside is slightly muted
  float S = uMapSize;
  vec2 dd = max(max(-p, p - S), 0.0);
  float outside = length(dd);
  float inside = min(min(p.x, p.y), min(S - p.x, S - p.y));
  float sd = outside > 0.0 ? outside : -inside;
  float lw = max(2.5, camDist * 0.0018);
  float line = exp(-(sd * sd) / (lw * lw)) * uBorder;
  emis = vec3(1.0, 0.9, 0.7) * line * 0.22;
  float mute = smoothstep(0.0, 350.0, sd);
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), mute * 0.28) * (1.0 - mute * 0.08);
  alb = col;
}
`;

/** Create a terrain material. `ring` = the landscape beyond the map (no data textures). */
export function createTerrainMaterial(tu: TerrainUniforms, shared: SharedUniforms, ring: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.name = ring ? 'TerrainRing' : 'Terrain';
  if (ring) mat.defines = { TERRAIN_RING: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, tu, {
      uNoise: shared.uNoise,
      uSnow: shared.uSnow,
      uWetness: shared.uWetness,
      uMapSize: shared.uMapSize,
      uSeaLevel: shared.uSeaLevel,
      uFlood: shared.uFlood,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nvec3 tAlb; float tRough; vec3 tN; vec3 tEmis;\nterrainShade(tAlb, tRough, tN, tEmis);\ndiffuseColor.rgb = tAlb;',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;');
  };
  mat.customProgramCacheKey = () => (ring ? 'urbis-terrain-ring' : 'urbis-terrain');
  return mat;
}
