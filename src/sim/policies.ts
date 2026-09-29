// Policy engine: combines the effects of city-wide and district policies into
// one flat effect record per district id, so per-building lookups are O(1).
import type { Building, TaxCategory, ZoneCategory } from '../core/types';
import { POLICIES, policyDef, type PolicyEffect, type PolicyInfo } from '../data/policies';
import type { World } from '../world/World';

/** Fully resolved policy effects (all keys present). */
export interface Effects {
  happinessRes: number;
  happinessWork: number;
  demand: Record<ZoneCategory, number>;
  income: Record<TaxCategory, number>;
  garbage: number;
  power: number;
  water: number;
  sewage: number;
  crime: number;
  pollution: number;
  noise: number;
  health: number;
  education: number;
  levelRate: Record<ZoneCategory, number>;
  maxLevel: number;
  landValueReq: number;
  fireRisk: number;
  tourism: number;
  transitFare: number;
  parksEfficiency: number;
  healthCapacity: number;
  educationCapacity: number;
  noDensify: boolean;
  noHighRent: boolean;
  newBuildingTax: number;
  commerceSales: number;
  industryOutput: number;
  farmingIncome: number;
  emigration: number;
  birthRate: number;
}

export function neutralEffects(): Effects {
  return {
    happinessRes: 0, happinessWork: 0,
    demand: { res: 0, com: 0, ind: 0, off: 0 },
    income: { resLow: 1, resHigh: 1, comLow: 1, comHigh: 1, office: 1, industry: 1 },
    garbage: 1, power: 1, water: 1, sewage: 1, crime: 1, pollution: 1, noise: 1, health: 0, education: 1,
    levelRate: { res: 1, com: 1, ind: 1, off: 1 },
    maxLevel: 5, landValueReq: 1, fireRisk: 1, tourism: 1, transitFare: 1, parksEfficiency: 1,
    healthCapacity: 1, educationCapacity: 1, noDensify: false, noHighRent: false, newBuildingTax: 1,
    commerceSales: 1, industryOutput: 1, farmingIncome: 1, emigration: 1, birthRate: 1,
  };
}

function apply(e: Effects, p: PolicyEffect): void {
  if (p.happinessRes) e.happinessRes += p.happinessRes;
  if (p.happinessWork) e.happinessWork += p.happinessWork;
  if (p.demand) for (const k of Object.keys(p.demand) as ZoneCategory[]) e.demand[k] += p.demand[k] ?? 0;
  if (p.income) for (const k of Object.keys(p.income) as TaxCategory[]) e.income[k] *= p.income[k] ?? 1;
  if (p.levelRate) for (const k of Object.keys(p.levelRate) as ZoneCategory[]) e.levelRate[k] *= p.levelRate[k] ?? 1;
  const mul = ['garbage', 'power', 'water', 'sewage', 'crime', 'pollution', 'noise', 'education', 'landValueReq', 'fireRisk', 'tourism',
    'transitFare', 'parksEfficiency', 'healthCapacity', 'educationCapacity', 'newBuildingTax', 'commerceSales', 'industryOutput',
    'farmingIncome', 'emigration', 'birthRate'] as const;
  for (const k of mul) {
    const v = p[k];
    if (v !== undefined) e[k] *= v;
  }
  if (p.health) e.health += p.health;
  if (p.maxLevel !== undefined) e.maxLevel = Math.min(e.maxLevel, p.maxLevel);
  if (p.noDensify) e.noDensify = true;
  if (p.noHighRent) e.noHighRent = true;
}

export class PolicySystem {
  /** city-wide effects only */
  city: Effects = neutralEffects();
  /** effects per district id (index 0 = no district → city) */
  private table: Effects[] = [];
  private dirty = true;

  constructor(private world: World) {}

  invalidate(): void {
    this.dirty = true;
  }

  rebuild(): void {
    const w = this.world;
    this.city = neutralEffects();
    for (const id of w.policies) {
      const p = policyDef(id);
      if (p) apply(this.city, p.effects);
    }
    this.table = [];
    this.table[0] = this.city;
    for (const d of w.districts) {
      if (!d || d.id <= 0 || d.id > 255) continue;
      if (!d.policies.length) {
        this.table[d.id] = this.city;
        continue;
      }
      const e = neutralEffects();
      for (const id of w.policies) {
        const p = policyDef(id);
        if (p) apply(e, p.effects);
      }
      for (const id of d.policies) {
        if (w.policies.includes(id)) continue; // already applied city-wide
        const p = policyDef(id);
        if (p && p.districtLevel) apply(e, p.effects);
      }
      this.table[d.id] = e;
    }
    this.dirty = false;
  }

  /** district id of a building (its center cell) */
  districtOf(b: Building): number {
    const w = this.world;
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    return w.inBounds(cx, cy) ? w.district[w.idx(cx, cy)] : 0;
  }

  forDistrict(id: number): Effects {
    if (this.dirty) this.rebuild();
    return this.table[id] ?? this.city;
  }

  at(b: Building): Effects {
    if (this.dirty) this.rebuild();
    return this.table[this.districtOf(b)] ?? this.city;
  }

  isActive(id: string, districtId?: number): boolean {
    const w = this.world;
    if (districtId === undefined || districtId <= 0) return w.policies.includes(id);
    const d = w.districts.find((x) => x.id === districtId);
    return !!d && d.policies.includes(id);
  }

  /** true when the policy applies at the building (city-wide or its district) */
  appliesAt(id: string, b: Building): boolean {
    if (this.world.policies.includes(id)) return true;
    const did = this.districtOf(b);
    if (!did) return false;
    const d = this.world.districts.find((x) => x.id === did);
    return !!d && d.policies.includes(id);
  }

  /** Toggle; returns true when the change was applied. */
  toggle(id: string, districtId?: number): { ok: boolean; active: boolean; reason?: string } {
    const w = this.world;
    const p = policyDef(id);
    if (!p) return { ok: false, active: false, reason: 'Unknown policy' };
    const districtScope = districtId !== undefined && districtId > 0;
    if (districtScope) {
      const d = w.districts.find((x) => x.id === districtId);
      if (!d) return { ok: false, active: false, reason: 'Unknown district' };
      const i = d.policies.indexOf(id);
      if (i >= 0) {
        d.policies.splice(i, 1);
        this.invalidate();
        return { ok: true, active: false };
      }
      if (!p.districtLevel) return { ok: false, active: false, reason: 'This policy can only be enacted city-wide' };
      if (!w.isUnlocked(p.unlock)) return { ok: false, active: false, reason: 'Locked' };
      d.policies.push(id);
      this.invalidate();
      return { ok: true, active: true };
    }
    const i = w.policies.indexOf(id);
    if (i >= 0) {
      w.policies.splice(i, 1);
      this.invalidate();
      return { ok: true, active: false };
    }
    if (!w.isUnlocked(p.unlock)) return { ok: false, active: false, reason: 'Locked' };
    w.policies.push(id);
    this.invalidate();
    return { ok: true, active: true };
  }

  /** monthly cost of a policy in a scope (population of the scope) */
  costFor(p: PolicyInfo, population: number): number {
    return p.costPer1000 * Math.max(1, population / 1000) + (p.flatCost ?? 0);
  }

  /** total monthly policy cost given city and per-district populations */
  monthlyCost(cityPop: number, districtPop: Float64Array): number {
    const w = this.world;
    let total = 0;
    for (const id of w.policies) {
      const p = policyDef(id);
      if (p) total += this.costFor(p, cityPop);
    }
    for (const d of w.districts) {
      if (!d || d.id <= 0 || d.id > 255) continue;
      for (const id of d.policies) {
        if (w.policies.includes(id)) continue;
        const p = policyDef(id);
        if (p && p.districtLevel) total += this.costFor(p, districtPop[d.id] ?? 0);
      }
    }
    return total;
  }

  /** city-level demand effect: city-wide in full + district policies by population share */
  demandEffect(cityPop: number, districtPop: Float64Array): Record<ZoneCategory, number> {
    if (this.dirty) this.rebuild();
    const out = { ...this.city.demand };
    if (cityPop <= 0) return out;
    for (const d of this.world.districts) {
      if (!d || d.id <= 0 || d.id > 255 || !d.policies.length) continue;
      const share = (districtPop[d.id] ?? 0) / cityPop;
      if (share <= 0) continue;
      for (const id of d.policies) {
        if (this.world.policies.includes(id)) continue;
        const p = policyDef(id);
        if (!p?.districtLevel || !p.effects.demand) continue;
        for (const k of Object.keys(p.effects.demand) as ZoneCategory[]) out[k] += (p.effects.demand[k] ?? 0) * share;
      }
    }
    return out;
  }

  get catalog(): PolicyInfo[] {
    return POLICIES;
  }

  activeCount(): number {
    let n = this.world.policies.length;
    for (const d of this.world.districts) n += d?.policies.length ?? 0;
    return n;
  }
}
