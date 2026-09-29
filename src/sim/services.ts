// Daily update of service buildings (player-placed catalog buildings):
// construction, staffing, efficiency (budget × staffing × power), capacity
// bookkeeping for health / education / garbage / deathcare, tourism
// attraction, upkeep and problems.
import { BFlag, Problem, type Building, type BuildingDef } from '../core/types';
import type { SimContext } from './context';
import { LotSample, sampleUtilities } from './lot';
import { bsim } from './state';
import { budgetCategoryOf, defOf, isCrematorium, isGarbageProcessor, isRenewable } from './catalog';
import { eduShareOf } from './zonemeta';
import { GARBAGE_PROBLEM, finish, handleGarbage, updateRubble } from './lifecycle';
import {
  CEMETERY_INTAKE_PER_VEHICLE, DEFAULT_ATTRACTION, LANDFILL_INTAKE_PER_VEHICLE, NO_ROAD_GRACE_DAYS, STAFF_FLOOR, UTILITY_GRACE_DAYS,
} from './tuning';
import { DAYS_PER_MONTH } from '../core/constants';

const VISUAL_FLAGS = BFlag.Powered | BFlag.Abandoned | BFlag.UnderConstruction | BFlag.Upgrading | BFlag.Collapsed | BFlag.Burned;
const sample = new LotSample();

/** Categories whose buildings keep working (at reduced quality) without power. */
const SOFT_POWER = new Set<string>(['parks', 'plazas', 'landmark', 'monument', 'tourism', 'deathcare']);
/** Categories that need running water / sewage to operate properly. */
const NEEDS_WATER = new Set<string>(['health', 'education', 'tourism', 'government', 'fire']);

/** Construction days for a catalog building (bigger projects take longer). */
export function serviceBuildDays(def: BuildingDef | undefined): number {
  const cost = def?.cost ?? 5000;
  return Math.max(3, Math.min(30, 3 + Math.sqrt(cost) / 60));
}

/** Nominal tourist attraction of a catalog building. */
export function attractionOf(def: BuildingDef): number {
  let a = DEFAULT_ATTRACTION[def.category] ?? 0;
  if (def.effects) for (const e of def.effects) if (e.field === 'tourism' && e.amount > 0) a += e.amount * 0.5;
  a += (def.attractiveness ?? 0) * 0.2;
  return a;
}

/** true when the building needs grid power to operate at full efficiency */
export function needsPower(def: BuildingDef): boolean {
  return !(def.power !== undefined && def.power > 0);
}

export function updateService(ctx: SimContext, b: Building, k: number): void {
  const w = ctx.world, agg = ctx.agg, r = ctx.state.rates;
  const bs = bsim(b);
  if (b.flags & (BFlag.Collapsed | BFlag.Burned)) {
    updateRubble(ctx, b, bs, k);
    return;
  }
  bs.tf = 0;
  const before = (b.flags & VISUAL_FLAGS) | (b.level << 20);
  const def = defOf(b.defId);
  agg.buildings++;
  agg.services++;
  if (!def) {
    b.problems = 0;
    return;
  }
  const s = sample;
  sampleUtilities(w, b, s);
  let flags = b.flags & ~(BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess);
  if (s.power) flags |= BFlag.Powered;
  if (s.water) flags |= BFlag.Watered;
  if (s.sewage) flags |= BFlag.Sewered;
  if (s.road) flags |= BFlag.RoadAccess;
  b.flags = flags;
  const e = ctx.policies.at(b);
  bs.pm = e.power;
  bs.wm = e.water;
  bs.sm = e.sewage;
  bs.gm = e.garbage;

  const jobs = def.jobs ?? b.jobs ?? 0;
  b.jobs = jobs;
  const eduShare = eduShareOf('svc', 1);
  const fill = Math.min(1, eduShare * r.eduFill + (1 - eduShare) * r.uneFill);

  // ── construction ───────────────────────────────────────────────────────
  if (b.built < 1) {
    b.built = Math.min(1, b.built + (k * Math.max(0.05, ctx.mods.constructionMult)) / serviceBuildDays(def));
    if (b.built < 1) {
      b.flags |= BFlag.UnderConstruction;
      b.problems = 0;
      b.efficiency = 0;
      agg.underConstruction++;
      finish(ctx, b, bs, before);
      return;
    }
    b.flags &= ~BFlag.UnderConstruction;
    b.age = 0;
    // staff was hired during construction
    b.workers = Math.round(jobs * fill * 0.85);
    ctx.onServiceOpened?.(b);
  }
  b.age += k;

  const cat = def.category;
  const budgetCat = budgetCategoryOf(cat);
  const budget = w.economy.budgets[budgetCat] ?? 1;
  const disabled = (b.flags & BFlag.Disabled) !== 0;
  const onFire = (b.flags & BFlag.OnFire) !== 0;

  // ── staffing ───────────────────────────────────────────────────────────
  const target = disabled || onFire ? jobs * 0.3 : jobs * fill;
  const gap = target - b.workers;
  let dw = gap * (k === 1 ? 0.35 : 1 - Math.pow(0.65, k));
  if (Math.abs(dw) < 1 && Math.abs(gap) >= 1) dw = Math.sign(gap);
  b.workers = Math.max(0, Math.min(jobs, Math.round(b.workers + dw)));
  const staffing = jobs > 0 ? b.workers / jobs : 1;
  agg.svcJobs += jobs;
  agg.svcWorkers += b.workers;
  agg.eduJobs += jobs * eduShare;
  agg.uneJobs += jobs * (1 - eduShare);

  // ── efficiency ─────────────────────────────────────────────────────────
  let powerF = 1;
  if (needsPower(def) && !s.power) powerF = SOFT_POWER.has(cat) ? 0.75 : 0.2;
  let eff = disabled ? 0 : budget * (STAFF_FLOOR + (1 - STAFF_FLOOR) * staffing) * powerF;
  if (cat === 'parks' || cat === 'plazas') eff *= e.parksEfficiency;
  if (onFire) eff *= 0.3;
  if (b.flags & BFlag.Flooded) eff *= 0.5;
  if (!s.road && def.placement?.road !== false && def.placement?.onWater !== true) eff *= 0.6;
  eff = Math.round(Math.max(0, Math.min(1.5, eff)) * 100) / 100;
  b.efficiency = eff;

  // ── capacity & category bookkeeping ────────────────────────────────────
  const capacity = def.capacity ?? 0;
  let p = 0;
  agg.serviceByCat[cat] = (agg.serviceByCat[cat] ?? 0) + 1;
  agg.defCount[def.id] = (agg.defCount[def.id] ?? 0) + 1;
  const last = ctx.lastValid ? ctx.last : null;
  switch (cat) {
    case 'health': {
      const cap = capacity * eff * e.healthCapacity;
      agg.healthCap += cap;
      const use = last && last.healthCap > 0 ? Math.min(1, last.sick / last.healthCap) : 0;
      b.visitors = Math.round(cap * use);
      if (def.vehicles?.type === 'ambulance') ctx.nextFacilities.ambulance.push(b);
      break;
    }
    case 'education': {
      const cap = capacity * eff * e.educationCapacity;
      agg.eduCap += cap;
      const use = last && last.eduCap > 0 ? Math.min(1, last.studentsPotential / last.eduCap) : 0;
      b.visitors = Math.round(cap * use);
      break;
    }
    case 'garbage': {
      if (isGarbageProcessor(def)) {
        const tp = (capacity / DAYS_PER_MONTH) * eff;
        agg.gbThroughput += tp;
        const use = last && last.gbThroughput > 0 ? Math.min(1, last.garbageCollected / last.gbThroughput) : 0;
        b.visitors = Math.round(capacity * use);
      } else if (capacity > 0) {
        agg.gbStorageCap += capacity;
        agg.gbStored += bs.st;
        if (bs.st < capacity) {
          agg.gbIntake += (def.vehicles?.count ?? 4) * LANDFILL_INTAKE_PER_VEHICLE * eff;
          agg.landfills.push(b);
        } else p |= Problem.Garbage;
        b.visitors = Math.round(bs.st);
      }
      if (def.vehicles?.type === 'garbage') ctx.nextFacilities.garbage.push(b);
      break;
    }
    case 'deathcare': {
      if (isCrematorium(def)) {
        agg.dcThroughput += (capacity / DAYS_PER_MONTH) * eff;
      } else if (capacity > 0) {
        agg.dcStorageCap += capacity;
        agg.dcStored += bs.st;
        if (bs.st < capacity) {
          agg.dcIntake += (def.vehicles?.count ?? 4) * CEMETERY_INTAKE_PER_VEHICLE * eff;
          agg.cemeteries.push(b);
        } else p |= Problem.Dead;
        b.visitors = Math.round(bs.st);
      }
      if (def.vehicles?.type === 'hearse') ctx.nextFacilities.hearse.push(b);
      break;
    }
    case 'police':
      if (def.vehicles?.type === 'police') ctx.nextFacilities.police.push(b);
      break;
    case 'parks':
    case 'plazas':
      agg.parks++;
      break;
    case 'landmark':
      agg.landmarks++;
      break;
    case 'monument':
      agg.monuments++;
      break;
    case 'power':
      if (def.power && def.power > 0) {
        agg.nominalMW += def.power * Math.min(1, eff);
        if (isRenewable(def)) agg.renewableMW += def.power * Math.min(1, eff);
      }
      break;
  }
  const attraction = attractionOf(def);
  if (attraction > 0) {
    agg.attraction += attraction * Math.min(1, eff);
    if (def.category === 'tourism' || def.category === 'landmark' || def.category === 'monument') b.visitors = Math.round(attraction * eff * 0.6);
  }
  if (def.category !== 'garbage' && def.category !== 'deathcare' && def.category !== 'health' && def.category !== 'education' && attraction <= 0) {
    b.visitors = Math.round(b.workers * 0.2);
  }

  // ── upkeep (per day at 100 % budget; disabled buildings cost a quarter) ─
  agg.upkeepBase[budgetCat] = (agg.upkeepBase[budgetCat] ?? 0) + (def.upkeep / DAYS_PER_MONTH) * (disabled ? 0.25 : 1);

  // ── problems ───────────────────────────────────────────────────────────
  if (needsPower(def) && !s.power) {
    bs.np += k;
    if (bs.np >= 2) p |= Problem.NoPower;
  } else bs.np = 0;
  if (NEEDS_WATER.has(cat)) {
    if (!s.water) {
      bs.nw += k;
      if (bs.nw >= 2) p |= Problem.NoWater;
    } else bs.nw = 0;
    if (!s.sewage) {
      bs.ns += k;
      if (bs.ns >= 2) p |= Problem.NoSewage;
    } else bs.ns = 0;
  }
  if (!s.road && def.placement?.road !== false && def.placement?.onWater !== true) {
    bs.nr += k;
    if (bs.nr >= 2) p |= Problem.NoRoad;
  } else bs.nr = 0;
  if (jobs > 0 && staffing < 0.5 && b.age > 10 && !disabled) {
    bs.nwk += k;
    if (bs.nwk > 5) p |= Problem.NoWorkers;
  } else bs.nwk = 0;
  if (onFire) p |= Problem.Fire;
  if (b.flags & BFlag.Flooded) p |= Problem.Flooded;
  if (cat !== 'garbage') {
    const gb = handleGarbage(ctx, b, s, k);
    if (gb & GARBAGE_PROBLEM && ctx.serviceOn('garbage')) p |= Problem.Garbage;
  }
  // service buildings never get abandoned, but track days of utility loss for the advisor
  b.distress = Math.min(99, bs.np > UTILITY_GRACE_DAYS || bs.nr > NO_ROAD_GRACE_DAYS ? b.distress + k : Math.max(0, b.distress - k));
  b.problems = p;
  agg.addProblems(p & ~Problem.Abandoned, b.id, ctx.rng.next());
  const did = ctx.policies.districtOf(b);
  if (did) agg.districtBuildings[did]++;
  finish(ctx, b, bs, before);
}

/** Distribute the day's collected garbage / bodies to processors and storage sites. */
export function settleStorage(ctx: SimContext): void {
  const a = ctx.agg;
  // garbage: processors first, the rest goes into landfills proportionally to their intake
  let rest = Math.max(0, a.garbageCollected - a.gbThroughput);
  if (rest > 0 && a.landfills.length) {
    let total = 0;
    const intakes: number[] = [];
    for (const b of a.landfills) {
      const def = defOf(b.defId);
      const v = (def?.vehicles?.count ?? 4) * Math.max(0.05, b.efficiency);
      intakes.push(v);
      total += v;
    }
    for (let i = 0; i < a.landfills.length && rest > 0; i++) {
      const b = a.landfills[i];
      const def = defOf(b.defId);
      const cap = def?.capacity ?? 0;
      const bs = bsim(b);
      const share = total > 0 ? (a.garbageCollected - a.gbThroughput) * (intakes[i] / total) : 0;
      const put = Math.min(share, Math.max(0, cap - bs.st), rest);
      bs.st += put;
      rest -= put;
    }
  }
  // bodies: crematoria first, then cemeteries
  let bodies = Math.max(0, a.bodiesCollected - a.dcThroughput);
  if (bodies > 0 && a.cemeteries.length) {
    const per = bodies / a.cemeteries.length;
    for (const b of a.cemeteries) {
      const cap = defOf(b.defId)?.capacity ?? 0;
      const bs = bsim(b);
      const put = Math.min(per, Math.max(0, cap - bs.st), bodies);
      bs.st += put;
      bodies -= put;
    }
  }
}
