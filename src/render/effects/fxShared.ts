// Uniforms and GLSL snippets shared by the effect meshes (tornado, meteor,
// UFO, balloons, tsunami, lightning). One uniform object per EffectsRenderer;
// materials reference the same objects so a single per-frame refresh updates
// all of them.
import * as THREE from 'three';

export interface FxUniforms {
  [k: string]: THREE.IUniform;
  /** gameplay clock (s) — frozen while paused */
  uSimTime: { value: number };
  /** real clock (s) */
  uRealTime: { value: number };
  /** direction toward the key light (sun or moon) */
  uSunDir: { value: THREE.Vector3 };
  /** key light radiance */
  uSunColor: { value: THREE.Color };
  /** sky ambient radiance */
  uAmbient: { value: THREE.Color };
  /** 0 day … 1 night */
  uNight: { value: number };
  /** tileable RGBA noise (R low fbm, G mid, B ridged, A fine) */
  uNoise: { value: THREE.Texture | null };
  /** lightning flash 0..1 (lights clouds / funnels) */
  uFlash: { value: number };
}

export function createFxUniforms(noise: THREE.Texture | null): FxUniforms {
  return {
    uSimTime: { value: 0 },
    uRealTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(3, 2.9, 2.7) },
    uAmbient: { value: new THREE.Color(0.35, 0.4, 0.48) },
    uNight: { value: 0 },
    uNoise: { value: noise },
    uFlash: { value: 0 },
  };
}

/** a tileable RGBA value-noise texture (fallback when the renderer has none) */
export function createNoiseTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (n: number, seed: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = g[((yi % n) + n) % n * n + ((xi % n) + n) % n], b = g[((yi % n) + n) % n * n + (((xi + 1) % n) + n) % n];
      const c = g[(((yi + 1) % n) + n) % n * n + ((xi % n) + n) % n], d = g[(((yi + 1) % n) + n) % n * n + (((xi + 1) % n) + n) % n];
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
  };
  const oct = [lattice(4, 1), lattice(8, 2), lattice(16, 3), lattice(32, 4), lattice(64, 5)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / size, fy = y / size;
      const f = (o0: number, o1: number) => {
        let v = 0, a = 0.5, t = 0;
        for (let o = o0; o <= o1; o++) {
          const n = 4 << o;
          v += oct[o](fx * n, fy * n) * a;
          t += a;
          a *= 0.5;
        }
        return v / t;
      };
      const r = f(0, 3), g = f(1, 4), rid = 1 - Math.abs(f(0, 2) * 2 - 1), fine = f(2, 4);
      const o = (y * size + x) * 4;
      data[o] = r * 255;
      data[o + 1] = g * 255;
      data[o + 2] = rid * 255;
      data[o + 3] = fine * 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** fog for alpha-blended output (premultiplied later) */
export const FOG_ALPHA = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor, fogF);
  #endif
`;

/** fog for additive output: fade to nothing */
export const FOG_ADD = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - fogF;
  #endif
`;

/** standard ShaderMaterial options for transparent effect meshes */
export function fxMaterial(
  uniforms: FxUniforms,
  extra: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
  opts: { additive?: boolean; side?: THREE.Side; depthWrite?: boolean; transparent?: boolean } = {},
): THREE.ShaderMaterial {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) as Record<string, THREE.IUniform>;
  Object.assign(u, uniforms, extra);
  const transparent = opts.transparent ?? true;
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader,
    fragmentShader,
    fog: true,
    transparent,
    depthWrite: opts.depthWrite ?? !transparent,
    side: opts.side ?? THREE.FrontSide,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** dispose every geometry/material under an object */
export function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
