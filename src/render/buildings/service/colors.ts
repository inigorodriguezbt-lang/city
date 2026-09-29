// Shared colour palette + style-aware "civic look" for service models.
// Colours are the intended final surface colour: materials multiply their
// (mostly luminance) texture detail by the vertex colour.
import * as THREE from 'three';
import type { MatKey, ModelContext } from '../types';
import type { StyleId } from '../../../core/types';

export const C = {
  white: 0xf3f1ec,
  offWhite: 0xe7e2d6,
  cream: 0xeadcc0,
  sand: 0xd9c49a,
  stone: 0xcfc6b4,
  limestone: 0xe2d8c3,
  granite: 0x9a9690,
  darkGranite: 0x5d5b58,
  marble: 0xf1eee8,
  concrete: 0xbab7af,
  concreteLight: 0xd3d0c8,
  concreteDark: 0x86837d,
  asphalt: 0x3b3d41,
  asphaltLight: 0x55585d,
  paving: 0xc9c2b5,
  pavingWarm: 0xd6c6a8,
  gravel: 0xa39c8e,
  dirt: 0x7e6547,
  steel: 0xa4acb4,
  steelDark: 0x5a6168,
  gunmetal: 0x3d4247,
  black: 0x1e2023,
  rust: 0x8e4b2c,
  copper: 0x5e9e89, // patina
  bronze: 0x8a6a3a,
  gold: 0xd8b04a,
  wood: 0x8a6240,
  woodLight: 0xb88c5a,
  woodDark: 0x5a3d26,
  brick: 0xa4523c,
  brickDark: 0x7d3b2c,
  terracotta: 0xc0633b,
  roofGrey: 0x4a4f57,
  roofDark: 0x2f3338,
  glass: 0x9fc4d8,
  glassDark: 0x4d6f86,
  glassTeal: 0x6fb3b8,
  water: 0x3f8f99,
  grass: 0x6f9a48,
  lawn: 0x74a84c,
  hedge: 0x3f6b33,
  foliage: 0x4f7d38,
  bark: 0x5b4633,
  red: 0xc8322b,
  fireRed: 0xc01f1a,
  policeBlue: 0x1f4fa8,
  navy: 0x1c2c4a,
  yellow: 0xf2c230,
  orange: 0xe9812f,
  green: 0x3f9a4a,
  blue: 0x2f6fd0,
  teal: 0x2aa6a0,
  purple: 0x7b4fb8,
  pink: 0xf08fb0,
  lampWarm: 0xffd49a,
  lampCool: 0xdff0ff,
  beaconRed: 0xff2a1a,
  signWhite: 0xfafafa,
  paint: 0xf4f4f0,
  paintYellow: 0xf1c232,
  solarBlue: 0x1d2c4a,
  tennisClay: 0xc2653a,
  courtBlue: 0x3a6fa8,
  courtGreen: 0x3f8a5a,
  track: 0xb4553c,
  poolTile: 0x4fc0d8,
  snow: 0xf4f7fb,
} as const;

const _a = new THREE.Color();
const _b = new THREE.Color();

/** Linear blend of two colours (0 = a, 1 = b) → hex. */
export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number): number {
  return _a.set(a).lerp(_b.set(b), t).getHex();
}

/** Multiply brightness (e.g. 0.85 = darker). */
export function shade(c: THREE.ColorRepresentation, k: number): number {
  _a.set(c);
  return _a.setRGB(Math.min(1, _a.r * k), Math.min(1, _a.g * k), Math.min(1, _a.b * k)).getHex();
}

/** Small random brightness / hue jitter for variety. */
export function jitter(c: THREE.ColorRepresentation, rnd: () => number, amount = 0.06): number {
  _a.set(c);
  const k = 1 + (rnd() - 0.5) * 2 * amount;
  return _a.setRGB(Math.min(1, _a.r * k), Math.min(1, _a.g * k), Math.min(1, _a.b * k)).getHex();
}

/** Theme-aware lawn colour: the terrain grass nudged towards a watered green. */
export function lawnColor(ctx: ModelContext, lush = 0.55): number {
  return mix(ctx.theme.grass, C.lawn, lush);
}

/** Dry / worn ground (paths through grass, dog runs). */
export function dryGround(ctx: ModelContext): number {
  return mix(ctx.theme.dirt, ctx.theme.sand, 0.35);
}

export type RoofShape = 'flat' | 'gable' | 'hip' | 'mansard' | 'pagoda' | 'dome' | 'shed';

/** How a civic building should look in the city's architectural style. */
export interface CivicLook {
  wall: MatKey;
  wallColor: number;
  /** secondary wall colour for wings / plinths */
  wall2: number;
  roofMat: MatKey;
  roofColor: number;
  trim: number;
  accent: number;
  roof: RoofShape;
  /** style leans modern (glass, flat) */
  modern: boolean;
  plinth: number;
}

const WALL_MAT: Record<StyleId, MatKey> = {
  american: 'wall_brick',
  european: 'wall_plaster',
  mediterranean: 'wall_plaster',
  nordic: 'wall_plaster',
  asian: 'wall_concrete',
  artdeco: 'wall_stone',
  modern: 'wall_concrete',
  futuristic: 'wall_glass',
};

function hexOf(s: string): number {
  return new THREE.Color(s).getHex();
}

/** Deterministic civic look for the building's style (uses ctx.rng once). */
export function civicLook(ctx: ModelContext, prefer?: RoofShape[]): CivicLook {
  const st = ctx.style;
  const r = ctx.rng;
  let wall = WALL_MAT[st.id];
  // pick a dignified (lighter) wall colour for civic buildings
  const walls = st.wallColors.map(hexOf);
  const sorted = walls.slice().sort((a, b) => lum(b) - lum(a));
  let wallColor = sorted[Math.min(sorted.length - 1, r.int(0, Math.min(2, sorted.length - 1)))];
  if (st.id === 'american') {
    // civic America is red brick or limestone
    if (r.chance(0.6)) {
      wallColor = r.pick([C.brick, 0x9c4a36, 0xb0634a]);
      wall = 'wall_brick';
    } else {
      wallColor = C.limestone;
      wall = 'wall_stone';
    }
  }
  const roofs = st.roofColors.map(hexOf);
  const trims = st.trimColors.map(hexOf);
  const allowed = (prefer ?? st.roofs).filter((x) => st.roofs.includes(x));
  const roof = (allowed.length ? r.pick(allowed) : st.roofs[0]) as RoofShape;
  const modern = st.id === 'modern' || st.id === 'futuristic';
  const roofMat: MatKey = roof === 'flat' ? 'roof_flat' : st.id === 'nordic' || st.id === 'modern' || st.id === 'futuristic' ? 'roof_metal' : st.id === 'american' ? 'roof_shingle' : 'roof_tile';
  return {
    wall,
    wallColor,
    wall2: shade(wallColor, 0.9),
    roofMat,
    roofColor: r.pick(roofs),
    trim: trims[0],
    accent: trims[Math.min(trims.length - 1, 1)],
    roof,
    modern,
    plinth: st.id === 'mediterranean' ? C.cream : st.id === 'nordic' ? C.darkGranite : C.granite,
  };
}

function lum(c: number): number {
  return ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
}
