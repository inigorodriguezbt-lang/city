// Building model contract shared by zoned + service generators and the
// BuildingRenderer. FROZEN (additive only, by integrator).
import type * as THREE from 'three';
import type { RNG } from '../../core/rng';
import type { Building, BuildingDef, StyleDef, ThemeDef, ZoneType } from '../../core/types';

/** Shared material palette. Every material multiplies its texture by the
 *  geometry's vertex `color`. Wall materials (wall_*) show windows: their UVs
 *  are in METERS (u = horizontal distance along the face, v = height above the
 *  lot ground) so floors/windows line up; the material defines bay size
 *  (≈ 3.2 m wide × 3.3 m per floor; wall_shop is a 4.5 m storefront band). */
export type MatKey =
  | 'wall_plaster' | 'wall_brick' | 'wall_wood' | 'wall_concrete' | 'wall_stone'
  | 'wall_glass' // curtain wall
  | 'wall_office' // punched window grid
  | 'wall_shop' // storefront ground floor
  | 'wall_industrial' // corrugated, sparse windows
  | 'roof_tile' | 'roof_metal' | 'roof_flat' | 'roof_shingle'
  | 'plain' | 'glass' | 'metal' | 'wood' | 'concrete' | 'asphalt' | 'paving'
  | 'grass' | 'foliage' | 'bark' | 'water' | 'sand' | 'dirt' | 'crop'
  | 'emissive' // glows at night (signs, lamps)
  | 'neon' // bright colored glow, always slightly lit
  | 'solar';

export const MAT_KEYS: MatKey[] = [
  'wall_plaster', 'wall_brick', 'wall_wood', 'wall_concrete', 'wall_stone', 'wall_glass', 'wall_office', 'wall_shop', 'wall_industrial',
  'roof_tile', 'roof_metal', 'roof_flat', 'roof_shingle',
  'plain', 'glass', 'metal', 'wood', 'concrete', 'asphalt', 'paving', 'grass', 'foliage', 'bark', 'water', 'sand', 'dirt', 'crop',
  'emissive', 'neon', 'solar',
];

/** A piece of a model. Geometry MUST be non-indexed with attributes
 *  position, normal, uv, color (itemSize 3) — use ModelBuilder to guarantee it. */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  mat: MatKey;
}

/** Point light glow rendered as a billboard sprite at night. Local coords. */
export interface ModelLight {
  x: number;
  y: number;
  z: number;
  color: number;
  /** sprite size in meters */
  size: number;
  kind: 'lamp' | 'beacon' | 'neon' | 'flood';
  blink?: boolean;
}

/** Animated sub-mesh (wind turbine rotor, radar dish, ferris wheel…). */
export interface ModelAnim {
  part: ModelPart;
  /** pivot in local coords */
  pivot: [number, number, number];
  /** rotation axis (local) */
  axis: [number, number, number];
  /** radians per second */
  speed: number;
}

/** Particle emitter hint (chimney smoke, cooling-tower steam, fountain). Local coords. */
export interface ModelEmitter {
  kind: 'smoke' | 'steam' | 'fountain' | 'dust';
  x: number;
  y: number;
  z: number;
  /** 0..1 relative rate */
  rate: number;
}

export interface ModelResult {
  parts: ModelPart[];
  lights?: ModelLight[];
  anims?: ModelAnim[];
  emitters?: ModelEmitter[];
  /** total height in meters (for LOD boxes, icons, selection) */
  height: number;
}

/** Input to a model generator. Local space: origin at footprint CENTER on the
 *  lot ground (y = 0), FRONT (road side) faces +Z, width along X, depth along Z. */
export interface ModelContext {
  /** null when building a placement preview */
  b: Building | null;
  def?: BuildingDef;
  /** frontage width (m) along local X */
  width: number;
  /** depth (m) along local Z */
  depth: number;
  level: number;
  zone: ZoneType;
  style: StyleDef;
  theme: ThemeDef;
  rng: RNG;
  detail: 'low' | 'medium' | 'high';
}

export type ModelFn = (ctx: ModelContext) => ModelResult;
