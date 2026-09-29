// Shared per-building utility/garbage consumption formulas (used by the
// simulation, the field/utility worker and UI). Owned by sim-core agent; the
// signatures are FROZEN.
import { ZoneType, type Building, type BuildingDef } from '../core/types';
import { zoneDef } from '../data/zones';

function zonedScale(b: Building): number {
  // occupants-ish proxy
  return Math.max(1, b.maxResidents || 0) * 0.5 + Math.max(0, b.jobs || 0) * 0.8;
}

/** MW consumed (positive) or produced (negative) by a building. */
export function powerUse(b: Building, def?: BuildingDef): number {
  if (b.kind === 'service') return def?.power !== undefined ? -def.power : 0.2;
  const z = zoneDef(b.zone);
  const k = z?.category === 'ind' ? 0.035 : z?.category === 'off' ? 0.03 : z?.category === 'com' ? 0.025 : 0.012;
  return zonedScale(b) * k;
}

/** m³/day water consumed (positive) or produced (negative). */
export function waterUse(b: Building, def?: BuildingDef): number {
  if (b.kind === 'service') return def?.water !== undefined ? -def.water : 0.5;
  const z = zoneDef(b.zone);
  const k = b.zone === ZoneType.Farming ? 0.2 : z?.category === 'ind' ? 0.12 : 0.08;
  return zonedScale(b) * k;
}

/** m³/day sewage produced (positive) or processed (negative). */
export function sewageUse(b: Building, def?: BuildingDef): number {
  if (b.kind === 'service') return def?.sewage !== undefined ? -def.sewage : 0.4;
  return waterUse(b, def) * 0.9;
}

/** garbage units produced per day */
export function garbageRate(b: Building): number {
  if (b.kind === 'service') return 0.3;
  const z = zoneDef(b.zone);
  return zonedScale(b) * (z?.category === 'ind' ? 0.05 : z?.category === 'com' ? 0.04 : 0.025);
}
