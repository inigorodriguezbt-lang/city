// ─────────────────────────────────────────────────────────────────────────────
// Field-system wire protocol shared by the main thread (FieldSystem), the
// worker (fields.worker.ts) and the main-thread fallback engine.
//
// Buildings travel as two flat typed arrays (ints + floats, fixed stride per
// building) so a job is a handful of transferable buffers instead of a
// structured clone of thousands of objects. No DOM / THREE imports here.
// ─────────────────────────────────────────────────────────────────────────────
import type { BuildingDef, FieldId } from '../../core/types';
import { BUILDINGS } from '../../data/buildings';

// ── building record layout ──────────────────────────────────────────────────
/** Int32 slots per building record. */
export const REC_I = 8;
export const RI_X = 0;
export const RI_Y = 1;
export const RI_W = 2;
export const RI_H = 3;
/** kind | zone << 1 | level << 5 | role << 8 | cable << 13 */
export const RI_META = 4;
/** BFlag bitmask */
export const RI_FLAGS = 5;
/** index into BUILDINGS (-1 for zoned buildings / unknown ids) */
export const RI_DEF = 6;
export const RI_ID = 7;

/** Float32 slots per building record. */
export const REC_F = 8;
/** 0..1.5 service efficiency (budget × staffing × power), zoned = 1 */
export const RF_EFF = 0;
/** MW: > 0 consumption, < 0 supply (already scaled by efficiency / weather) */
export const RF_POWER = 1;
/** m³/day water: > 0 consumption, < 0 supply */
export const RF_WATER = 2;
/** m³/day sewage: > 0 produced, < 0 processing capacity */
export const RF_SEWAGE = 3;
export const RF_RESIDENTS = 4;
/** job capacity */
export const RF_JOBS = 5;
/** filled jobs */
export const RF_WORKERS = 6;
/** 0..1 construction progress */
export const RF_BUILT = 7;

export const META_SERVICE = 1;
export const metaZone = (m: number): number => (m >> 1) & 15;
export const metaLevel = (m: number): number => (m >> 5) & 7;
export const metaRole = (m: number): Role => ((m >> 8) & 31) as Role;
export const metaCable = (m: number): boolean => ((m >> 13) & 1) !== 0;
export function packMeta(service: boolean, zone: number, level: number, role: Role, cable: boolean): number {
  return (service ? 1 : 0) | ((zone & 15) << 1) | ((Math.max(0, Math.min(7, level)) & 7) << 5) | ((role & 31) << 8) | ((cable ? 1 : 0) << 13);
}

/** Special behaviour of utility / transit buildings, derived from catalog data. */
export enum Role {
  None = 0,
  /** wind turbine: output follows the static wind field and the weather */
  Wind = 1,
  /** photovoltaic: follows daylight, season, cloud cover (small battery buffer) */
  SolarPV = 2,
  /** concentrated solar with molten-salt storage */
  SolarCSP = 3,
  /** solar updraft tower: thermal mass keeps it running at night */
  SolarUpdraft = 4,
  /** hydro dam: follows river flow (droughts) */
  Hydro = 5,
  /** surface water intake: quality drops with water pollution */
  Pump = 6,
  /** groundwater well / tower: quality drops with ground pollution */
  Well = 7,
  /** purification plant: intake is filtered, nearly immune to pollution */
  WaterTreatment = 8,
  /** desalination: sea water, immune to pollution */
  Desalination = 9,
  /** raw sewage outlet: dumps untreated sewage into the water */
  Outlet = 10,
  /** treatment plant: releases mostly clean effluent */
  SewageTreatment = 11,
  /** advanced (membrane / eco) treatment: nearly clean effluent */
  SewageTreatmentAdv = 12,
}

/** effluent pollution share per unit of processed sewage, by role */
export function effluentShare(role: Role): number {
  switch (role) {
    case Role.Outlet: return 1;
    case Role.SewageTreatment: return 0.14;
    case Role.SewageTreatmentAdv: return 0.03;
    default: return 0;
  }
}

function hasTag(def: BuildingDef, ...tags: string[]): boolean {
  const t = def.tags;
  if (!t) return false;
  for (const x of tags) if (t.includes(x)) return true;
  return false;
}

/** Derive a building's utility role from its catalog entry (tags + numbers). */
export function roleOf(def: BuildingDef | undefined): Role {
  if (!def) return Role.None;
  if ((def.power ?? 0) > 0) {
    if (hasTag(def, 'wind') || def.id.includes('wind')) return Role.Wind;
    if (hasTag(def, 'chimney') || def.id.includes('updraft')) return Role.SolarUpdraft;
    if (hasTag(def, 'csp', 'heliostat')) return Role.SolarCSP;
    if (hasTag(def, 'solar', 'pv') || def.id.includes('solar')) return Role.SolarPV;
    if (hasTag(def, 'hydro', 'dam') || def.id.includes('hydro')) return Role.Hydro;
  }
  if ((def.water ?? 0) > 0) {
    if (hasTag(def, 'osmosis') || def.id.includes('desal')) return Role.Desalination;
    if (hasTag(def, 'purification', 'filter')) return Role.WaterTreatment;
    if (def.placement?.shore || hasTag(def, 'intake', 'pump')) return Role.Pump;
    return Role.Well;
  }
  if ((def.sewage ?? 0) > 0) {
    if (hasTag(def, 'outfall', 'drain') || def.id.includes('outlet')) return Role.Outlet;
    if (hasTag(def, 'membrane', 'eco') || def.id.endsWith('_adv')) return Role.SewageTreatmentAdv;
    return Role.SewageTreatment;
  }
  return Role.None;
}

/** Buildings that need no road and link to the grid by a cable (offshore wind). */
export function needsCable(def: BuildingDef | undefined): boolean {
  return !!def && def.placement?.road === false;
}

/** Catalog index lookup shared by both sides (same module → same order). */
const DEF_INDEX = new Map<string, number>();
BUILDINGS.forEach((d, i) => DEF_INDEX.set(d.id, i));
export function defIndexOf(id: string): number {
  return DEF_INDEX.get(id) ?? -1;
}
export function defAt(index: number): BuildingDef | undefined {
  return index >= 0 ? BUILDINGS[index] : undefined;
}

// ── jobs & results ──────────────────────────────────────────────────────────
/** Terrain snapshot; sent only when terrain / water changed. */
export interface TerrainPacket {
  /** (size+1)^2 vertex heights */
  heights: Float32Array;
  /** size^2 water surface elevation (flood offset already applied) */
  water: Float32Array;
}

/** Previous persisted values used to seed temporal smoothing after a load. */
export interface SeedPacket {
  landValue: Uint8Array;
  pollution: Uint8Array;
  crime: Uint8Array;
  happiness: Uint8Array;
}

export interface WeatherPacket {
  /** downwind direction (radians, x = cos, y = sin in cell space) */
  windDir: number;
  /** m/s */
  windSpeed: number;
  /** 0..1 rain / snow wash-out strength */
  precipitation: number;
}

export interface FieldJob {
  /** world session token; results for a stale token are discarded */
  token: number;
  size: number;
  /** skip temporal smoothing (fresh load / tests) */
  full: boolean;
  terrain?: TerrainPacket;
  seed?: SeedPacket;
  road: Uint8Array;
  zone: Uint8Array;
  trees: Uint8Array;
  /** congestion per road cell (owned by the traffic system) */
  traffic: Uint8Array;
  recI: Int32Array;
  recF: Float32Array;
  count: number;
  /** transit stops: [x, y, amount, radius] quadruples */
  stops: Int32Array;
  weather: WeatherPacket;
  powerUseMult: number;
  waterUseMult: number;
  /** 0..1 theme rainfall (scales how quickly rain washes the air) */
  rainfall: number;
  /** output buffers handed back from the previous result for reuse */
  recycle?: ArrayBuffer[];
}

export interface NetworkStats {
  produced: number;
  consumed: number;
  connected: number;
}

/** Fields the engine writes every run (never traffic or static resources). */
export const OUTPUT_FIELDS: FieldId[] = [
  'power', 'water', 'sewage',
  'police', 'fire', 'health', 'education', 'garbage', 'deathcare',
  'leisure', 'transit', 'tourism',
  'pollution', 'noise', 'crime', 'landValue', 'happiness', 'forest',
];

export interface FieldResult {
  token: number;
  fields: Partial<Record<FieldId, Uint8Array>>;
  power: NetworkStats;
  water: NetworkStats;
  sewage: NetworkStats;
  /** worker compute time (ms) and a per-stage breakdown */
  ms: number;
  stages: Record<string, number>;
}
