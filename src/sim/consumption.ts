// Shared per-building utility/garbage consumption formulas (used by the
// simulation, the field/utility worker and UI). Owned by sim-core agent; the
// signatures are FROZEN.
//
// Consumption scales with the building's capacity (a stable proxy for its
// occupants, so networks do not flicker as people move), its state (sites
// under construction and abandoned shells draw little, rubble nothing) and
// the policy multipliers the simulation stores in `b.ext.sim` (pm/wm/sm/gm).
import { BFlag, ZoneType, type Building, type BuildingDef } from '../core/types';
import { zoneDef } from '../data/zones';

interface PolicyMults {
  pm?: number;
  wm?: number;
  sm?: number;
  gm?: number;
}

function mults(b: Building): PolicyMults | undefined {
  const s = b.ext?.sim;
  return s && typeof s === 'object' ? (s as PolicyMults) : undefined;
}

/** 0 for rubble, a trickle for construction sites / abandoned shells, 1 otherwise */
function stateFactor(b: Building): number {
  if (b.flags & (BFlag.Collapsed | BFlag.Burned)) return 0;
  if (b.flags & BFlag.Abandoned) return 0.08;
  if (b.built < 1) return 0.15;
  return 1;
}

function zonedScale(b: Building): number {
  // occupants-ish proxy
  return Math.max(1, b.maxResidents || 0) * 0.5 + Math.max(0, b.jobs || 0) * 0.8;
}

/** MW consumed (positive) or produced (negative) by a building. */
export function powerUse(b: Building, def?: BuildingDef): number {
  const f = stateFactor(b);
  if (b.kind === 'service') {
    if (def?.power !== undefined) return def.power > 0 ? -def.power * (f > 0.5 ? 1 : 0) : -def.power * f;
    return 0.2 * f;
  }
  const z = zoneDef(b.zone);
  const k = z?.category === 'ind' ? 0.035 : z?.category === 'off' ? 0.03 : z?.category === 'com' ? 0.025 : 0.012;
  return zonedScale(b) * k * f * (mults(b)?.pm ?? 1);
}

/** m³/day water consumed (positive) or produced (negative). */
export function waterUse(b: Building, def?: BuildingDef): number {
  const f = stateFactor(b);
  if (b.kind === 'service') {
    if (def?.water !== undefined) return def.water > 0 ? -def.water * (f > 0.5 ? 1 : 0) : -def.water * f;
    return 0.5 * f;
  }
  const z = zoneDef(b.zone);
  const k = b.zone === ZoneType.Farming ? 0.2 : z?.category === 'ind' ? 0.12 : 0.08;
  return zonedScale(b) * k * f * (mults(b)?.wm ?? 1);
}

/** m³/day sewage produced (positive) or processed (negative). */
export function sewageUse(b: Building, def?: BuildingDef): number {
  const f = stateFactor(b);
  if (b.kind === 'service') {
    if (def?.sewage !== undefined) return def.sewage > 0 ? -def.sewage * (f > 0.5 ? 1 : 0) : -def.sewage * f;
    return 0.4 * f;
  }
  const z = zoneDef(b.zone);
  const k = b.zone === ZoneType.Farming ? 0.2 : z?.category === 'ind' ? 0.12 : 0.08;
  return zonedScale(b) * k * 0.9 * f * (mults(b)?.sm ?? 1);
}

/** garbage units produced per day */
export function garbageRate(b: Building): number {
  if (b.flags & (BFlag.Collapsed | BFlag.Burned | BFlag.Abandoned) || b.built < 1) return 0;
  const g = mults(b)?.gm ?? 1;
  if (b.kind === 'service') return 0.25 * g;
  const z = zoneDef(b.zone);
  // actual occupants when known, capacity otherwise (fresh buildings)
  const res = b.residents > 0 ? b.residents : b.maxResidents * 0.5;
  const wrk = b.workers > 0 ? b.workers : b.jobs * 0.5;
  const perJob = z?.category === 'ind' ? 0.009 : z?.category === 'com' ? 0.005 : 0.003;
  return (res * 0.004 + wrk * perJob) * g;
}
