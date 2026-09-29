// Static per-zone metadata used by the lifecycle, growth and info modules.
import { ZoneType, type TaxCategory, type ZoneCategory, type ZoneDef } from '../core/types';
import { LEVEL_CAPACITY, ZONES, zoneDef } from '../data/zones';
import { EDU_REQ, SPECIALIZED_MAX_LEVEL } from './tuning';

export type RawKind = 'farm' | 'forest' | 'mine' | 'oil';

export interface ZoneMeta {
  zd: ZoneDef;
  /** demand category the zone grows with */
  cat: ZoneCategory;
  /** category of the zone's jobs (null = no jobs) */
  jobCat: ZoneCategory | null;
  mixed: boolean;
  /** specialised resource industry */
  raw: RawKind | null;
  resTax: TaxCategory | null;
  jobTax: TaxCategory | null;
  maxLevel: number;
  highDensity: boolean;
}

const META: (ZoneMeta | undefined)[] = [];
for (const zd of ZONES) {
  const mixed = zd.type === ZoneType.MixedUse;
  const raw: RawKind | null =
    zd.type === ZoneType.Farming ? 'farm' : zd.type === ZoneType.Forestry ? 'forest' : zd.type === ZoneType.Mining ? 'mine' : zd.type === ZoneType.Oil ? 'oil' : null;
  const isRes = zd.category === 'res';
  META[zd.type] = {
    zd,
    cat: zd.category,
    jobCat: mixed ? 'com' : isRes ? null : zd.category,
    mixed,
    raw,
    resTax: isRes ? (zd.type === ZoneType.ResHigh ? 'resHigh' : 'resLow') : null,
    jobTax: mixed ? 'comLow' : isRes ? null : zd.tax,
    maxLevel: raw ? SPECIALIZED_MAX_LEVEL : 5,
    highDensity: zd.density === 'high',
  };
}

export function zoneMeta(t: ZoneType): ZoneMeta | undefined {
  return META[t];
}

export function zoneDefSafe(t: ZoneType): ZoneDef | undefined {
  return zoneDef(t);
}

function capBase(m: ZoneMeta, area: number, level: number): number {
  const lc = LEVEL_CAPACITY[Math.max(1, Math.min(5, level))] ?? 1;
  return m.zd.capacityPerCell * area * lc;
}

/** Residents capacity of a lot of `area` cells at `level` (allocation-free). */
export function capRes(m: ZoneMeta, area: number, level: number): number {
  if (m.cat !== 'res') return 0;
  const base = capBase(m, area, level);
  return Math.max(1, Math.round(m.mixed ? base * 0.8 : base));
}

/** Jobs capacity of a lot of `area` cells at `level` (allocation-free). */
export function capJobs(m: ZoneMeta, area: number, level: number): number {
  if (m.cat === 'res' && !m.mixed) return 0;
  const base = capBase(m, area, level);
  return Math.max(1, Math.round(m.mixed ? base * 0.3 : base));
}

/** Residents / jobs capacity of a lot of `area` cells at `level`. */
export function capacityOf(m: ZoneMeta, area: number, level: number): { res: number; jobs: number } {
  return { res: capRes(m, area, level), jobs: capJobs(m, area, level) };
}

/** Share of a building's jobs that require an educated worker. */
export function eduShareOf(jobCat: ZoneCategory | 'svc', level: number): number {
  const [base, per] = EDU_REQ[jobCat];
  return Math.min(0.95, base + per * Math.max(0, level - 1));
}

/** Resource field id for a specialised zone. */
export function resourceFieldOf(m: ZoneMeta): 'fertility' | 'forest' | 'ore' | 'oil' | undefined {
  return m.zd.resource;
}
