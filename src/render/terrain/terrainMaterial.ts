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
  /** seasonal colour of tree canopies seen from afar (linear) */
  uCanopyCol: { value: THREE.Color };
  /** landscape beyond the map: forest cover and farmland amount (0..1) */
  uRingForest: { value: number };
  uRingFields: { value: number };
  /** 0..1 aridity: bare sand/gravel ground with sparse scrub (desert) */
  uArid: { value: number };
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
    uCanopyCol: { value: new THREE.Color(0.045, 0.08, 0.035) },
    uRingForest: { value: 0.5 },
    uRingFields: { value: 0.5 },
    uArid: { value: 0 },
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
uniform vec3 uCanopyCol;
uniform float uRingForest, uRingFields, uArid;
uniform float uSnow, uWetness, uMapSize, uNight;
float tHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
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
  float canopyD = nt.a;
#endif
#ifdef TERRAIN_RING
  float canopyD = 0.0;
#endif
  float slope = 1.0 - nW.y;
  vec4 nA = texture2D(uNoise, p / 2900.0);
  vec4 nB = texture2D(uNoise, p / 430.0 + 0.37);
  vec4 nC = texture2D(uNoise, p / 67.0 + 0.61);
  vec4 nD = texture2D(uNoise, p / 9.7 + 0.13);
#ifdef TERRAIN_RING
  // woods beyond the map: large noise-shaped forests on dry, not-too-steep land
  float fN = texture2D(uNoise, p / 5200.0 + 0.23).g * 0.62 + nA.b * 0.2 + nB.r * 0.18;
  float fTh = mix(0.8, 0.46, uRingForest);
  canopyD = smoothstep(fTh, fTh + 0.07, fN) * (1.0 - smoothstep(0.3, 0.55, slope)) * smoothstep(0.5, 3.0, h - level) * step(0.02, uRingForest);
#endif
  float macro = nA.r, meso = nB.g, det = nC.a;
  float micro = mix(0.5, nD.a, detailFade);

  // meadow: moisture, exposure (south-facing slopes dry out), season
  float dry = clamp(uDry + (macro - 0.5) * 1.1 + (0.5 - moist) * 0.9 + nW.z * 0.35 + (meso - 0.5) * 0.45, 0.0, 1.0);
  // turf reads less saturated than its swatch colour from altitude
  vec3 gLive = mix(vec3(dot(uGrass, vec3(0.2126, 0.7152, 0.0722))), uGrass, 0.76);
  vec3 grass = mix(gLive * 0.78, uGrassDry * 0.82, smoothstep(0.12, 0.9, dry));
  // lush, darker bluish-green hollows vs sunlit yellow-green swards
  float lushN = smoothstep(0.35, 0.75, nA.g * 0.6 + moist * 0.5 - cav * 0.2);
  grass = mix(grass, grass * vec3(0.72, 0.86, 0.78), lushN * 0.8);
  grass = mix(grass, grass * vec3(1.1, 1.05, 0.76), smoothstep(0.6, 0.9, meso) * 0.3);
  grass *= 0.78 + 0.44 * meso * (0.7 + 0.3 * det);
  grass = mix(grass, grass * vec3(1.02, 1.04, 0.86), uLush * (1.0 - dry) * 0.6);
  grass = mix(grass, mix(grass, uGrassDry * vec3(1.05, 0.88, 0.62), 0.55), uAutumn * (0.45 + 0.55 * macro));
  grass *= mix(1.0, 0.8 + 0.4 * micro, detailFade);
  // close range: tufts and small hue patches (2-25 m)
  float nearFade = 1.0 - smoothstep(60.0, 700.0, camDist);
  float midFade = 1.0 - smoothstep(150.0, 1400.0, camDist);
  vec4 nE = texture2D(uNoise, p / 2.3 + 0.77);
  vec4 nF = texture2D(uNoise, p / 24.0 + 0.29);
  vec4 nG = texture2D(uNoise, p / 7.3 + 0.53);
  grass *= mix(1.0, 0.84 + 0.32 * nE.a, nearFade);
  // clumps and swales (7-25 m): value and hue variation so meadows never read as felt
  float clump = nF.g * 0.6 + nG.r * 0.4;
  grass *= mix(1.0, 0.74 + 0.52 * clump, midFade);
  grass = mix(grass, grass * mix(vec3(1.12, 1.06, 0.78), vec3(0.84, 0.96, 1.04), nF.b), midFade * 0.65);
  // clover/flower speckle in lush meadows, darker tufts
  float speck = smoothstep(0.78, 0.9, nD.g) * detailFade * uLush * (1.0 - dry);
  grass = mix(grass, vec3(0.62, 0.6, 0.35), speck * 0.25);
  grass *= 1.0 - smoothstep(0.6, 0.85, nD.b) * 0.18 * detailFade;
  // arid biomes: the ground is bare sand and gravel with sparse scrub; green
  // only where water is near (oases, river banks) or the soil holds moisture
  if (uArid > 0.0) {
    float soilMix = smoothstep(0.3, 0.72, macro * 0.6 + det * 0.25 + meso * 0.15);
    vec3 aridGround = mix(uSand * vec3(0.98, 0.93, 0.86), uDirt * vec3(1.12, 1.04, 0.96), soilMix);
    aridGround = mix(aridGround, uRock * 1.05, smoothstep(0.62, 0.85, nB.b * 0.7 + det * 0.3) * 0.35);
    aridGround *= (0.86 + 0.26 * det) * (0.92 + 0.16 * micro);
    aridGround *= mix(1.0, 0.88 + 0.24 * nE.a, nearFade);
    float scrub = smoothstep(0.58, 0.82, meso * 0.45 + det * 0.3 + nD.g * 0.25 + moist * 0.35);
    float oasis = smoothstep(0.55, 0.85, moist);
    vec3 scrubCol = mix(uGrassDry * 0.75, gLive * 0.7, oasis);
    float green = clamp(scrub * 0.55 + oasis, 0.0, 1.0);
    grass = mix(grass, mix(aridGround, mix(scrubCol, grass, oasis), green), uArid);
  }

#ifdef TERRAIN_RING
  // farmland patchwork on gentle lowland: a rotated grid of fields with hedgerows
  {
    vec2 fq = mat2(0.83, -0.56, 0.56, 0.83) * p / vec2(260.0, 170.0);
    // split some parcels into narrow strips so the grid does not read as a checkerboard
    float split = tHash(floor(fq) + 5.0);
    if (split > 0.55) fq.x *= split > 0.8 ? 3.0 : 2.0;
    vec2 fc = floor(fq);
    float fh = tHash(fc + 17.0);
    float fh2 = tHash(fc + 71.0);
    float region = smoothstep(0.38, 0.56, texture2D(uNoise, p / 9000.0 + 0.4).b + (1.0 - canopyD) * 0.1);
    float fieldMask = uRingFields * (1.0 - smoothstep(0.04, 0.1, slope)) * region * (1.0 - canopyD) * smoothstep(0.5, 2.5, h - level) * step(0.15, fh2);
    vec3 crop = fh < 0.28 ? uGrassDry * vec3(1.2, 1.08, 0.66) : fh < 0.52 ? uGrass * vec3(0.8, 0.86, 0.7) : fh < 0.7 ? uDirt * vec3(1.05, 0.95, 0.85) : fh < 0.85 ? mix(uGrass, uGrassDry, 0.55) : uGrass * 1.05;
    crop = mix(crop, crop * vec3(0.9, 0.85, 0.75), uAutumn);
    vec2 fe = abs(fract(fq) - 0.5);
    float fw = max(fwidth(fq.x), fwidth(fq.y));
    float hedge = smoothstep(0.5 - 1.5 * fw - 0.015, 0.5 - 0.5 * fw, max(fe.x, fe.y)) * (1.0 - smoothstep(0.04, 0.12, fw));
    grass = mix(grass, mix(crop * (0.9 + 0.2 * fh2), uCanopyCol * 1.6, hedge * 0.7), fieldMask * 0.58);
  }
#endif
  // bare soil on moderate slopes and trampled patches
  float dirtMask = smoothstep(0.64, 0.8, meso * 0.55 + det * 0.35 + slope * 1.1 - moist * 0.25 + (1.0 - macro) * 0.1);
  vec3 dirt = uDirt * (0.78 + 0.44 * det) * (0.9 + 0.2 * micro);
  vec3 col = mix(grass, dirt, dirtMask * 0.8);

  // rock and cliffs with horizontal strata
  float rockMask = smoothstep(0.28, 0.44, slope + (det - 0.5) * 0.16 + (meso - 0.5) * 0.08);
  // band-limited: bands thinner than ~2 px fade to their mean (no moiré at distance)
  float hfw = fwidth(h);
  float strata = mix(0.5 + 0.5 * sin(h * 1.35 + meso * 7.0 + det * 2.5), 0.5, smoothstep(0.6, 2.2, hfw * 1.35));
  float strata2 = mix(0.5 + 0.5 * sin(h * 4.1 + nC.b * 5.0), 0.5, smoothstep(0.6, 2.2, hfw * 4.1));
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
  // snow lingers on shaded north-facing slopes (-Z) and in hollows, melts first on sunny ground;
  // large meso-scale patches with ragged fine-scale edges
  float lingering = macro * 0.3 + meso * 0.46 + det * 0.16 + micro * 0.08 - nW.z * 0.9 + (0.5 - cav) * 0.3;
  float snowT = 1.0 - cover * 1.25;
  float snowGround = smoothstep(snowT - 0.045, snowT + 0.045, lingering) * smoothstep(0.0, 0.06, cover) * (1.0 - smoothstep(0.42, 0.68, slope)) * (1.0 - under);
  float snow = clamp(max(snowAlt, snowGround), 0.0, 1.0);
  col = mix(col, uSnowCol * (0.9 + 0.1 * det), snow);

  // forests: darker litter floor under trees; from afar (where individual
  // trees thin out) the canopy itself tints the ground, seasonally coloured
  float forest = smoothstep(0.04, 0.55, canopyD + (meso - 0.5) * 0.25);
  col = mix(col, col * vec3(0.72, 0.68, 0.62), forest * (1.0 - snow * 0.7));
  float farK = smoothstep(260.0, 1600.0, camDist);
  vec3 canopy = uCanopyCol * (0.7 + 0.6 * nB.b) * (0.85 + 0.3 * macro);
  canopy = mix(canopy, vec3(0.5, 0.53, 0.57), clamp(uSnow, 0.0, 1.0) * 0.35);
  col = mix(col, canopy, forest * farK * 0.92);

  // cavity darkening in gullies, slight lift on ridges
  col *= 0.8 + 0.4 * cav;
  // wetness: rain soaks everything, shorelines are always damp. Bare soil,
  // sand and rock darken and turn glossy; turf only darkens a little.
  float hard = clamp(max(max(rockMask, dirtMask * 0.85), beach), 0.0, 1.0);
  float wet = max(uWetness * 0.85 * (1.0 - snow), wetBand * 0.9);
  col *= mix(1.0, mix(0.76, 0.56, hard), wet * (1.0 - under));
  // rain puddles collect in flat hollows of bare ground
  float flatG = 1.0 - smoothstep(0.02, 0.07, slope);
  float puddle = uWetness * flatG * (1.0 - snow) * (1.0 - under) * (0.25 + 0.75 * hard)
    * smoothstep(0.66, 0.8, nB.r * 0.45 + nC.r * 0.35 + (0.5 - cav) * 1.4 + 0.12) * detailFade;
  col *= 1.0 - 0.35 * puddle;
  rough = mix(0.95, 0.84, rockMask);
  rough = mix(rough, 0.88, beach);
  rough = mix(rough, 0.55, snow);
  rough = mix(rough, mix(0.68, 0.34, hard), wet);
  rough = mix(rough, 0.06, puddle);

  // micro normals (stronger on rock), faded with distance
  vec3 dn = texture2D(uDetailN, p / 6.5).xyz * 2.0 - 1.0;
  vec3 dn2 = texture2D(uDetailN, p / 29.0 + 0.5).xyz * 2.0 - 1.0;
  float ns = detailFade * mix(0.42, 0.75, rockMask) * (1.0 - snow * 0.6) * (1.0 - under * 0.7) * (1.0 - puddle);
  nW = normalize(nW + vec3(dn.x + dn2.x * 0.9, 0.0, dn.y + dn2.y * 0.9) * ns);

  // playable border: a thin soft line; the world outside is slightly muted
  float S = uMapSize;
  vec2 dd = max(max(-p, p - S), 0.0);
  float outside = length(dd);
  float inside = min(min(p.x, p.y), min(S - p.x, S - p.y));
  float sd = outside > 0.0 ? outside : -inside;
  float lw = max(2.5, camDist * 0.0018);
  float line = exp(-(sd * sd) / (lw * lw)) * uBorder;
  emis = vec3(1.0, 0.9, 0.7) * line * 0.22 * (1.0 - 0.75 * uNight);
  float mute = smoothstep(0.0, 350.0, sd);
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), mute * 0.28) * (1.0 - mute * 0.08);
  // theme colours are "perceived" colours: scale to plausible albedo under full sun
  alb = col * 0.86;
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
      uNight: shared.uNight,
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
