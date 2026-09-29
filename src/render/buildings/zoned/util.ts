// Small colour / random helpers shared by the zoned generators.
// Colours are kept as THREE.Color in LINEAR space (what ModelBuilder emits
// into the vertex colour attribute); hex palette strings are sRGB.
import * as THREE from 'three';
import type { RNG } from '../../../core/rng';
import { toColor, type ColorLike } from '../ModelBuilder';

export type Col = THREE.Color;

/** sRGB hex / css string → linear THREE.Color */
export function col(c: string | number): Col {
  return new THREE.Color(c as THREE.ColorRepresentation);
}

/** any ColorLike → new linear THREE.Color */
export function cl(c: ColorLike): Col {
  return toColor(c, new THREE.Color());
}

/** multiply brightness */
export function shade(c: Col, k: number): Col {
  return c.clone().multiplyScalar(k);
}

export function mix(a: Col, b: Col, t: number): Col {
  return a.clone().lerp(b, t);
}

/** random subtle variation in hue/saturation/lightness */
export function jitter(c: Col, rng: RNG, amt = 0.05): Col {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const out = new THREE.Color();
  out.setHSL((hsl.h + (rng.next() - 0.5) * amt * 0.25 + 1) % 1, clamp01(hsl.s * (1 + (rng.next() - 0.5) * amt * 2)), clamp01(hsl.l * (1 + (rng.next() - 0.5) * amt * 2)));
  return out;
}

export function desaturate(c: Col, t: number): Col {
  const l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  return new THREE.Color(c.r + (l - c.r) * t, c.g + (l - c.g) * t, c.b + (l - c.b) * t);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** pick one of the hex strings and return it as a (jittered) colour */
export function pickCol(rng: RNG, list: readonly string[], amt = 0.04): Col {
  return jitter(col(rng.pick(list)), rng, amt);
}

/** saturated colour from a hue (0..1) — signs, neon, awnings */
export function hueCol(h: number, s = 0.75, l = 0.5): Col {
  return new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
}

/** round to a grid step */
export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** number of whole floors of height fh that fit in h */
export function floorsIn(h: number, fh: number): number {
  return Math.max(1, Math.floor(h / fh + 1e-6));
}

/** common palette constants (sRGB hex) */
export const P = {
  white: '#f2f0ea',
  offWhite: '#e6e1d6',
  trimWhite: '#f7f5ef',
  concrete: '#b9b6ae',
  concreteLight: '#d4d1c9',
  concreteDark: '#85827c',
  asphalt: '#3a3c40',
  asphaltWorn: '#4d4f53',
  paving: '#c6bfb2',
  pavingWarm: '#d4c4a6',
  gravel: '#9f998c',
  dirt: '#7b6448',
  dirtDark: '#5a4834',
  lawn: '#6f9f47',
  lawnDry: '#9aa35a',
  hedge: '#3d6a31',
  foliage: '#4e7c37',
  foliageDark: '#35592a',
  bark: '#57432f',
  steel: '#a3abb3',
  steelDark: '#5b626a',
  gunmetal: '#3c4146',
  black: '#1d1f22',
  glass: '#8fb4c8',
  glassDark: '#40596b',
  wood: '#8a6240',
  woodLight: '#b88c5a',
  woodDark: '#5a3d26',
  water: '#3a8fa0',
  pool: '#3fb4c9',
  rust: '#8b4a2b',
  gold: '#d6ad48',
  copper: '#5f9d88',
  terracotta: '#c0633b',
  brick: '#9e4f3b',
  sand: '#d8c49a',
  yellow: '#f0c02f',
  red: '#c43a2f',
  safety: '#f2b705',
  green: '#3f8f4a',
  blue: '#2f64c0',
} as const;
