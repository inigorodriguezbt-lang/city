// Daily life cycle of zoned buildings: construction, utilities, occupancy,
// births & deaths, sickness, education, garbage, happiness, problems,
// distress / abandonment / recovery, level ups, taxes. Each building is
// visited once per in-game day (sliced across the day's ticks); `k` is the
// number of days the visit covers (1 normally, more during fast-forward).
import { BFlag, Problem, ZoneType, type Building, type ZoneCategory } from '../core/types';
import { DAYS_PER_MONTH } from '../core/constants';
import { garbageRate } from './consumption';
import type { SimContext } from './context';
import { LotSample, sampleLot } from './lot';
import { bsim, type BSim } from './state';
import { capJobs, capRes, eduShareOf, zoneMeta, type ZoneMeta } from './zonemeta';
import type { Effects } from './policies';
import {
  ABANDON_DISTRESS, AUTO_BULLDOZE_DAYS, BASE_BIRTH_RATE, BASE_MORTALITY, BURNED_CLEAR_DAYS, COVERAGE_FULL, COVERAGE_OK, CRIME_PROBLEM,
  CRIME_SEVERE, CUSTOMER_GRACE_DAYS, DEAD_PROBLEM_DAYS, DEAD_SEVERE_DAYS, DEATHCARE_PICKUP_MIN, DISTRESS_RECOVERY, GARBAGE_PICKUP_MIN,
  GARBAGE_PROBLEM_DAYS, GARBAGE_SEVERE_DAYS, GOODS_PER_COM_JOB, GOODS_PER_IND_WORKER, HOUSEHOLD_SIZE, LEVEL_EDUCATION,
  LEVEL_IND_EDUCATED, LEVEL_LAND_VALUE, LEVEL_SERVICES, LEVEL_TAX, LEVEL_UP_DAYS, LEVEL_UP_DAYS_PER_LEVEL, MISERABLE, NOISE_PROBLEM,
  NO_ROAD_GRACE_DAYS, POLLUTION_PROBLEM, POLLUTION_SEVERE, RAW_EXPORT_PRICE, RAW_LOCAL_SHARE, RAW_PER_WORKER, RECOVERY_DAYS,
  RESIDENTS_PER_COM_JOB, RUBBLE_CLEAR_DAYS, SENIOR_SHARE, SICK_BASE, SICK_HEALTH, SICK_RANGE, SICK_SEVERE, STUDENT_SHARE, TAX_BASE,
  TAX_COMFORT, TRAFFIC_PROBLEM, UNHAPPY, UPGRADE_SCAFFOLD_DAYS, UTILITY_GRACE_DAYS, WORKER_GRACE_DAYS, WORKER_RAMP, WORKFORCE_SHARE,
  ZONE_MISMATCH_DAYS,
} from './tuning';

/** Requirement that blocks a building's next level (stored in bsim.lr). */
export const LevelBlock = {
  None: 0,
  LandValue: 1,
  Services: 2,
  Education: 3,
  Customers: 4,
  Goods: 5,
  Workers: 6,
  Utilities: 7,
  Happiness: 8,
  MaxLevel: 9,
  Construction: 10,
  EducatedWorkers: 11,
  Sales: 12,
  Occupancy: 13,
  Problems: 14,
  Policy: 15,
} as const;

export const LEVEL_BLOCK_TEXT: Record<number, string> = {
  0: 'Conditions are good — levelling up',
  1: 'Needs higher land value',
  2: 'Needs better service coverage',
  3: 'Needs better educated residents',
  4: 'Needs more customers',
  5: 'Needs a steadier supply of goods',
  6: 'Needs more workers',
  7: 'Needs power, water and sewage',
  8: 'Residents are not happy enough',
  9: 'Maximum level reached',
  10: 'Under construction',
  11: 'Needs more educated workers',
  12: 'Cannot sell enough of its output',
  13: 'Needs more occupants',
  14: 'Has unresolved problems',
  15: 'Level capped by a district policy',
};

/** Problem icon priority (first = most important). */
const PROBLEM_PRIORITY: number[] = [
  Problem.Fire, Problem.Flooded, Problem.NoRoad, Problem.NoPower, Problem.NoWater, Problem.NoSewage, Problem.Dead, Problem.Sick,
  Problem.Garbage, Problem.Crime, Problem.NoWorkers, Problem.NoEducated, Problem.NoCustomers, Problem.NoGoods, Problem.Pollution,
  Problem.Noise, Problem.Traffic, Problem.HighRent, Problem.LowHappiness,
];

/** Most important problem bit of a mask (0 = none). */
export function primaryProblem(mask: number): number {
  if (!mask) return 0;
  for (const p of PROBLEM_PRIORITY) if (mask & p) return p;
  return mask & -mask;
}

const VISUAL_FLAGS = BFlag.Powered | BFlag.Abandoned | BFlag.UnderConstruction | BFlag.Upgrading | BFlag.Collapsed | BFlag.Burned;

const sample = new LotSample();
const CAT_RES_MOVE_MAX = 0.95;

/** 1-(1-r)^k: a daily fraction applied over k days */
function over(r: number, k: number): number {
  if (r <= 0) return 0;
  if (r >= 1) return 1;
  return k === 1 ? r : 1 - Math.pow(1 - r, k);
}

/** Construction duration (days) for a new zoned building. */
export function buildDaysFor(area: number, seed: number): number {
  const jitter = 0.85 + ((seed >>> 7) % 1000) / 1000 * 0.3;
  return Math.max(6, Math.min(20, (6 + area * 0.95) * jitter));
}

/** Terminal states (rubble, burned shells): count down until cleared. */
export function updateRubble(ctx: SimContext, b: Building, bs: BSim, k: number): void {
  const agg = ctx.agg;
  if (!bs.tf) {
    bs.tf = 1;
    bs.cd = 0;
    b.problems = 0;
  }
  bs.cd += k;
  agg.buildings++;
  agg.collapsed++;
  const limit = b.flags & BFlag.Collapsed ? RUBBLE_CLEAR_DAYS : BURNED_CLEAR_DAYS;
  if (bs.cd >= limit) ctx.removeQueue.push(b.id);
}

/** Taxes paid per day by a building at a 100 % rate, split by category (writes into agg). */
function addTaxes(ctx: SimContext, b: Building, m: ZoneMeta, e: Effects, lv: number, jobOcc: number, bs: BSim): void {
  const lvF = 0.75 + (lv / 255) * 0.8;
  const newF = b.age < 360 ? e.newBuildingTax : 1;
  const mult = (LEVEL_TAX[b.level] ?? 1) * lvF * newF * 10 / DAYS_PER_MONTH;
  const taxes = ctx.world.economy.taxes;
  let monthly = 0;
  if (m.resTax && b.residents > 0) {
    const v = b.residents * TAX_BASE[m.resTax] * mult * e.income[m.resTax];
    ctx.agg.taxBase[m.resTax] += v;
    monthly += v * taxes[m.resTax] * DAYS_PER_MONTH;
  }
  if (m.jobTax && jobOcc > 0) {
    const v = jobOcc * TAX_BASE[m.jobTax] * mult * e.income[m.jobTax];
    ctx.agg.taxBase[m.jobTax] += v;
    monthly += v * taxes[m.jobTax] * DAYS_PER_MONTH;
  }
  bs.tx = Math.round(monthly * ctx.mods.incomeMult);
}

function taxRateFor(ctx: SimContext, m: ZoneMeta): number {
  const t = ctx.world.economy.taxes;
  if (m.resTax && m.jobTax) return (t[m.resTax] + t[m.jobTax]) * 0.5;
  return t[(m.resTax ?? m.jobTax)!] ?? 0.1;
}

/** Evaluate the requirement for the next level. */
function levelBlock(ctx: SimContext, b: Building, m: ZoneMeta, e: Effects, s: LotSample, svc: number, jobsOk: boolean, customers: number): number {
  const next = b.level + 1;
  const r = ctx.state.rates;
  const lvReq = LEVEL_LAND_VALUE[next] * e.landValueReq;
  if (!s.power || !s.water || !s.sewage || !s.road) return LevelBlock.Utilities;
  if (b.problems & (Problem.Garbage | Problem.Sick | Problem.Dead | Problem.Crime | Problem.Fire | Problem.Flooded)) return LevelBlock.Problems;
  switch (m.cat) {
    case 'res': {
      if (b.residents < b.maxResidents * 0.6) return LevelBlock.Occupancy;
      if (s.lv < lvReq) return LevelBlock.LandValue;
      if (svc < LEVEL_SERVICES[next]) return LevelBlock.Services;
      if (b.education < LEVEL_EDUCATION[next]) return LevelBlock.Education;
      if (b.happiness < 35 + next * 3) return LevelBlock.Happiness;
      if (m.mixed && !jobsOk) return LevelBlock.Workers;
      return LevelBlock.None;
    }
    case 'com': {
      if (!jobsOk) return LevelBlock.Workers;
      if (s.lv < lvReq * 0.9) return LevelBlock.LandValue;
      if (svc < LEVEL_SERVICES[next] * 0.8) return LevelBlock.Services;
      if (customers < 0.75) return LevelBlock.Customers;
      if (r.goods < 0.7) return LevelBlock.Goods;
      if (r.educated < LEVEL_IND_EDUCATED[next] * 0.8) return LevelBlock.EducatedWorkers;
      return LevelBlock.None;
    }
    case 'ind': {
      if (!jobsOk) return LevelBlock.Workers;
      if (s.lv < lvReq * 0.45) return LevelBlock.LandValue;
      if (svc < LEVEL_SERVICES[next] * 0.6) return LevelBlock.Services;
      if (r.educated < LEVEL_IND_EDUCATED[next]) return LevelBlock.EducatedWorkers;
      if (r.sales < 0.6) return LevelBlock.Sales;
      return LevelBlock.None;
    }
    case 'off': {
      if (!jobsOk) return LevelBlock.Workers;
      if (s.lv < lvReq * 0.85) return LevelBlock.LandValue;
      if (svc < LEVEL_SERVICES[next] * 0.85) return LevelBlock.Services;
      if (r.eduFill < 0.75 || r.educated < LEVEL_IND_EDUCATED[next] + 0.1) return LevelBlock.EducatedWorkers;
      return LevelBlock.None;
    }
  }
  return LevelBlock.None;
}

/** handleGarbage result bits */
export const GARBAGE_PROBLEM = 1;
export const GARBAGE_SEVERE = 2;

/** Collect garbage lying at a building (shared by zoned and service buildings). Returns GARBAGE_* bits. */
export function handleGarbage(ctx: SimContext, b: Building, s: LotSample, k: number): number {
  const agg = ctx.agg;
  const daily = garbageRate(b);
  const gen = daily * k;
  b.garbage += gen;
  agg.garbageProduced += gen;
  if (b.garbage > 0) {
    if (s.garbage >= GARBAGE_PICKUP_MIN && ctx.garbagePool > 0) {
      const take = Math.min(b.garbage, ctx.garbagePool);
      const big = take > daily * 4 + 2;
      b.garbage -= take;
      ctx.garbagePool -= take;
      agg.garbageCollected += take;
      if (big && ctx.rng.next() < 0.5) ctx.dispatch('garbage', b);
    } else if (!ctx.serviceOn('garbage')) {
      // no municipal service yet: residents take care of it themselves
      b.garbage = 0;
    }
  }
  if (b.garbage < 1e-3) b.garbage = 0;
  agg.garbagePile += b.garbage;
  const ref = Math.max(daily, 0.05);
  return (b.garbage > Math.max(1, ref * GARBAGE_PROBLEM_DAYS) ? GARBAGE_PROBLEM : 0) | (b.garbage > Math.max(3, ref * GARBAGE_SEVERE_DAYS) ? GARBAGE_SEVERE : 0);
}

/**
 * Daily update of one zoned building.
 * @returns true when the building's visual state changed (renderers are notified by the caller).
 */
export function updateZoned(ctx: SimContext, b: Building, k: number): void {
  const w = ctx.world, agg = ctx.agg, st = ctx.state, r = st.rates;
  const bs = bsim(b);
  if (b.flags & (BFlag.Collapsed | BFlag.Burned)) {
    updateRubble(ctx, b, bs, k);
    return;
  }
  bs.tf = 0;
  const m = zoneMeta(b.zone);
  if (!m) {
    ctx.removeQueue.push(b.id);
    return;
  }
  const before = (b.flags & VISUAL_FLAGS) | (b.level << 20);
  const e = ctx.policies.at(b);
  const s = sample;
  const resField = m.zd.resource ? w.fields[m.zd.resource] : undefined;
  sampleLot(w, b, s, resField);
  const area = b.w * b.h;
  const onFire = (b.flags & BFlag.OnFire) !== 0;
  agg.buildings++;
  agg.zoned++;
  agg.byZone[b.zone]++;

  // ── utility & access flags ─────────────────────────────────────────────
  let flags = b.flags & ~(BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess);
  if (s.power) flags |= BFlag.Powered;
  if (s.water) flags |= BFlag.Watered;
  if (s.sewage) flags |= BFlag.Sewered;
  if (s.road) flags |= BFlag.RoadAccess;
  b.flags = flags;

  // policy consumption multipliers read by consumption.ts / the utility worker
  bs.pm = e.power;
  bs.wm = e.water;
  bs.sm = e.sewage;
  bs.gm = e.garbage;

  // zone repainted under the building (tools normally demolish it right away)
  if (w.zone[s.ci] !== b.zone) {
    bs.zm += k;
    if (bs.zm >= ZONE_MISMATCH_DAYS) {
      ctx.removeQueue.push(b.id);
      return;
    }
  } else bs.zm = 0;

  // ── construction ───────────────────────────────────────────────────────
  if (b.built < 1) {
    b.built = Math.min(1, b.built + (k * Math.max(0.05, ctx.mods.constructionMult)) / Math.max(1, bs.bd));
    if (b.built < 1) {
      agg.underConstruction++;
      agg.resCapUC += capRes(m, area, b.level);
      if (m.jobCat) agg.jobsUC[m.jobCat] += capJobs(m, area, b.level);
      b.flags |= BFlag.UnderConstruction;
      b.problems = s.road ? 0 : Problem.NoRoad;
      bs.lr = LevelBlock.Construction;
      finish(ctx, b, bs, before);
      return;
    }
    b.flags &= ~BFlag.UnderConstruction;
    b.age = 0;
  }
  b.age += k;

  // scaffolding after a level-up
  if (bs.up > 0) {
    bs.up -= k;
    if (bs.up <= 0) {
      bs.up = 0;
      b.flags &= ~BFlag.Upgrading;
    }
  }

  const capR = capRes(m, area, b.level);
  const capJ = capJobs(m, area, b.level);
  b.maxResidents = capR;
  b.jobs = capJ;
  const abandoned = (b.flags & BFlag.Abandoned) !== 0;
  const roadLost = !s.road && bs.nr > NO_ROAD_GRACE_DAYS;
  const svc = ctx.serviceScore(s.ci);
  const healthOn = ctx.serviceOn('health');
  const perPoll = s.poll * e.pollution;
  const perNoise = s.noise * e.noise;
  const perCrime = s.crime * e.crime * ctx.mods.crimeMult;
  // connected to the outside world through the road network (immigrants, trade)
  const linked = !ctx.outside.hasConnections || ctx.outside.building(b);
  if (linked) agg.connected++;

  // ── residents ──────────────────────────────────────────────────────────
  let untreatedShare = 0;
  if (capR > 0) {
    let res = b.residents;
    // sickness & treatment
    const hf = b.health / 100;
    const sickShare = SICK_BASE + (1 - hf) * (1 - hf) * SICK_RANGE;
    const sick = res * sickShare;
    const treat = healthOn ? (s.health >= 25 ? r.treat : r.treat * 0.35) : 0.65;
    const untreated = sick * (1 - treat);
    untreatedShare = res > 0 ? untreated / res : 0;
    bs.sick = Math.round(sick);
    agg.sick += sick;
    agg.untreated += untreated;
    if (untreated >= 1 && ctx.rng.next() < 0.08) ctx.dispatch('ambulance', b);
    // births & deaths
    if (res > 0) {
      const mortality = BASE_MORTALITY * (1 + 2 * (1 - hf)) + untreatedShare * 0.25;
      const birthRate = BASE_BIRTH_RATE * e.birthRate * (0.6 + (b.happiness / 100) * 0.8);
      const deaths = Math.min(res, ctx.stochasticRound((res * mortality * k) / 360));
      const births = ctx.stochasticRound((res * birthRate * k) / 360);
      res += births - deaths;
      agg.births += births;
      agg.deaths += deaths;
      if (deaths > 0 && ctx.serviceOn('deathcare')) bs.dead += deaths;
    }
    // immigration into vacant homes
    if (!abandoned && !roadLost && !onFire && res < capR) {
      const vacancy = capR - res;
      const attract = Math.max(0.35, Math.min(1.4, 0.35 + b.happiness / 110 + (s.lv / 255) * 0.35)) * (s.power ? 1 : 0.4) * (s.water ? 1 : 0.4);
      let n = linked ? ctx.stochasticRound(vacancy * over(Math.min(CAT_RES_MOVE_MAX, r.moveIn * attract), k)) : 0;
      if (st.pendingImmigrants > 0 && n < vacancy) {
        const extra = Math.min(vacancy - n, Math.ceil(st.pendingImmigrants));
        n += extra;
        st.pendingImmigrants = Math.max(0, st.pendingImmigrants - extra);
      }
      if (n > 0) {
        b.education = (b.education * res + r.immigrantEdu * n) / (res + n);
        res += n;
        agg.movedIn += n;
      }
    }
    if (res > capR) {
      // grown-up children and new families that no longer fit leave town
      agg.movedOut += res - capR;
      res = capR;
    }
    // emigration
    if (abandoned || roadLost) {
      agg.movedOut += res;
      res = 0;
    } else if (res > 0) {
      let leave = r.emigrate + Math.max(0, (28 - b.happiness) / 28) * 0.012 + (bs.hr > 40 ? 0.003 : 0) + Math.min(3, (b.distress / ABANDON_DISTRESS) * 3) * 0.002;
      leave *= e.emigration;
      const out = Math.min(res, ctx.stochasticRound(res * over(Math.min(0.5, leave), k)));
      res -= out;
      agg.movedOut += out;
    }
    b.residents = res;
    const hh = Math.ceil(res / HOUSEHOLD_SIZE);
    agg.population += res;
    agg.households += hh;
    agg.resCap += capR;
    agg.resVacant += abandoned ? 0 : capR - res;
    const wf = res * WORKFORCE_SHARE;
    agg.workforce += wf;
    // education of the workforce: educated share grows with the building's education level
    agg.educatedWorkforce += wf * Math.min(1, (b.education / 100) * 1.15);
    agg.seniors += res * SENIOR_SHARE;
    const studentsAll = res * STUDENT_SHARE;
    agg.studentsAll += studentsAll;
    if (ctx.unlocked('education')) {
      const covered = studentsAll * Math.min(1, s.edu / COVERAGE_OK);
      agg.studentsPotential += covered;
      agg.studentsEnrolled += covered * r.enroll;
    }
    if (linked) agg.outsidePop += res;
    agg.buyingPower += res * (0.8 + 0.12 * b.level) * (0.85 + b.happiness / 400);
    // education drifts toward what local schools can offer
    const schoolQ = Math.min(1, s.edu / COVERAGE_FULL) * r.enroll;
    const eduTarget = Math.max(r.immigrantEdu * 0.85, 8 + 84 * schoolQ);
    b.education += (eduTarget - b.education) * over(0.006 * e.education, k);
    // resident sampling for chirp authors
    agg.resSeen++;
    if (agg.resSeen === 1 || ctx.rng.next() * agg.resSeen < 1) agg.resSample = b.id;
  } else {
    b.residents = 0;
  }

  // ── jobs ───────────────────────────────────────────────────────────────
  let jobOcc = 0;
  let customers = 1;
  let jobsOk = true;
  if (m.jobCat && capJ > 0) {
    const jc: ZoneCategory = m.jobCat;
    const eduShare = eduShareOf(jc, b.level);
    const fill = eduShare * r.eduFill + (1 - eduShare) * r.uneFill;
    const target = abandoned || roadLost || onFire ? 0 : capJ * Math.min(1, fill);
    const gap = target - b.workers;
    let dw = gap * over(WORKER_RAMP, k);
    if (Math.abs(dw) < 1 && Math.abs(gap) >= 1) dw = Math.sign(gap);
    b.workers = Math.max(0, Math.min(capJ, Math.round(b.workers + dw)));
    agg.jobs[jc] += capJ;
    agg.workers[jc] += b.workers;
    agg.eduJobs += capJ * eduShare;
    agg.uneJobs += capJ * (1 - eduShare);
    jobsOk = b.workers >= capJ * 0.7;
    // workplace education = how educated its staff is on average
    if (!m.mixed) b.education = Math.min(100, 100 * (eduShare * r.eduFill * 0.9 + 0.1));
    if (jc === 'com') {
      const local = 0.8 + (s.lv / 255) * 0.3 + (s.tourism / 255) * 0.35 + (s.transit / 255) * 0.1 - (s.traffic >= TRAFFIC_PROBLEM ? 0.15 : 0);
      customers = r.customers * local * e.commerceSales;
      b.visitors = Math.round(b.workers * RESIDENTS_PER_COM_JOB * Math.min(1.6, customers));
      agg.goodsNeed += b.workers * GOODS_PER_COM_JOB;
      b.goods += (Math.min(100, r.goods * 100) - b.goods) * over(0.3, k);
      jobOcc = b.workers * Math.min(1.25, Math.max(0.2, customers));
      if (customers < 0.35 && b.workers > 0) bs.ncu += k;
      else bs.ncu = Math.max(0, bs.ncu - 2 * k);
      if (r.goods < 0.5) bs.ngd += k;
      else bs.ngd = Math.max(0, bs.ngd - 2 * k);
    } else if (jc === 'ind') {
      if (m.raw) {
        const richness = Math.min(1.5, s.resource / 170 + 0.25);
        const out = b.workers * RAW_PER_WORKER * (1 + 0.15 * (b.level - 1)) * richness * e.industryOutput;
        agg.rawProduction += out;
        const price = RAW_EXPORT_PRICE * (m.raw === 'farm' ? e.farmingIncome : 1);
        agg.exportsValue += out * (1 - RAW_LOCAL_SHARE) * price * r.outside;
        b.goods += (Math.min(100, r.outside ? 90 : 35) - b.goods) * over(0.25, k);
        jobOcc = b.workers * (r.outside ? 1 : 0.5);
        if (!r.outside && b.workers > 0) bs.ncu += k;
        else bs.ncu = Math.max(0, bs.ncu - 2 * k);
      } else {
        const out = b.workers * GOODS_PER_IND_WORKER * (1 + 0.18 * (b.level - 1)) * e.industryOutput;
        agg.production += out;
        b.goods += (Math.min(100, r.sales * 100) - b.goods) * over(0.3, k);
        jobOcc = b.workers * (0.4 + 0.6 * r.sales);
        if (r.sales < 0.45 && b.workers > 0) bs.ncu += k;
        else bs.ncu = Math.max(0, bs.ncu - 2 * k);
      }
      b.visitors = 0;
    } else {
      b.visitors = Math.round(b.workers * 0.15);
      jobOcc = b.workers;
    }
  } else {
    b.workers = 0;
    if (!m.mixed) b.visitors = 0;
  }

  // ── health ─────────────────────────────────────────────────────────────
  {
    let target = 64;
    if (healthOn) target += Math.min(1, s.health / COVERAGE_FULL) * 26 - 8;
    target -= (perPoll / 255) * 45 + (perNoise / 255) * 6;
    target += (s.leisure / 255) * 8 + e.health;
    if (!s.water) target -= 14;
    if (!s.sewage) target -= 8;
    target = 100 - (100 - target) * ctx.mods.healthMult;
    target = target < 0 ? 0 : target > 100 ? 100 : target;
    b.health += (target - b.health) * over(0.12, k);
  }

  // ── garbage & deathcare ────────────────────────────────────────────────
  const gb = abandoned ? 0 : handleGarbage(ctx, b, s, k);
  if (abandoned) b.garbage = 0;
  if (bs.dead > 0) {
    if (s.death >= DEATHCARE_PICKUP_MIN && ctx.deathPool >= 1) {
      const take = Math.min(bs.dead, Math.floor(ctx.deathPool));
      bs.dead -= take;
      ctx.deathPool -= take;
      agg.bodiesCollected += take;
      if (take > 0 && ctx.rng.next() < 0.35) ctx.dispatch('hearse', b);
    } else if (!ctx.serviceOn('deathcare') || abandoned) {
      bs.dead = 0;
    }
  }
  if (bs.dead > 0) bs.dd += k;
  else bs.dd = 0;
  agg.deadWaiting += bs.dead;

  // ── happiness ──────────────────────────────────────────────────────────
  const isRes = capR > 0;
  {
    let h = 58;
    h += (svc - 0.25) * 24;
    h += (s.leisure / 255) * 8 + (s.happy / 255) * 14 + (s.lv / 255) * 8;
    h -= (Math.max(0, perPoll - 20) / 235) * 30 + (Math.max(0, perNoise - 50) / 205) * (isRes ? 16 : 6) + (Math.max(0, perCrime - 40) / 215) * 22;
    const t = taxRateFor(ctx, m);
    h -= Math.max(0, t - TAX_COMFORT) * 140;
    h += Math.max(0, TAX_COMFORT - t) * 40;
    if (!s.power) h -= 12;
    if (!s.water) h -= 12;
    if (!s.sewage) h -= 8;
    if (!s.road) h -= 10;
    if (gb & GARBAGE_PROBLEM) h -= 8;
    if (bs.dd > DEAD_PROBLEM_DAYS) h -= 10;
    h -= Math.min(20, untreatedShare * 200);
    if (isRes) h -= Math.max(0, r.unemployment - 0.05) * 60;
    h += isRes ? e.happinessRes : e.happinessWork;
    h += ctx.mods.happiness + b.level * 1.5;
    h = h < 0 ? 0 : h > 100 ? 100 : h;
    b.happiness += (h - b.happiness) * over(0.25, k);
  }

  // ── problems & distress ────────────────────────────────────────────────
  let p = 0;
  let severe = 0;
  let envSevere = 0;
  if (!s.power) {
    bs.np += k;
    if (bs.np >= 2) p |= Problem.NoPower;
    if (bs.np > UTILITY_GRACE_DAYS) { severe++; envSevere++; }
  } else bs.np = 0;
  if (!s.water) {
    bs.nw += k;
    if (bs.nw >= 2) p |= Problem.NoWater;
    if (bs.nw > UTILITY_GRACE_DAYS) { severe++; envSevere++; }
  } else bs.nw = 0;
  if (!s.sewage) {
    bs.ns += k;
    if (bs.ns >= 2) p |= Problem.NoSewage;
    if (bs.ns > UTILITY_GRACE_DAYS) { severe++; envSevere++; }
  } else bs.ns = 0;
  if (!s.road) {
    bs.nr += k;
    if (bs.nr >= 2) p |= Problem.NoRoad;
    if (bs.nr > NO_ROAD_GRACE_DAYS) { severe++; envSevere++; }
  } else bs.nr = 0;
  if (gb & GARBAGE_PROBLEM) p |= Problem.Garbage;
  if (gb & GARBAGE_SEVERE) severe++;
  if (ctx.serviceOn('police') && perCrime >= CRIME_PROBLEM) {
    p |= Problem.Crime;
    if (perCrime >= CRIME_SEVERE) { severe++; envSevere++; }
    if (ctx.rng.next() < 0.03) ctx.dispatch('police', b);
  }
  if (isRes && healthOn && b.health < SICK_HEALTH && untreatedShare > 0.015) {
    p |= Problem.Sick;
    if (b.health < SICK_SEVERE) severe++;
  }
  if (onFire) p |= Problem.Fire;
  if (b.flags & BFlag.Flooded) p |= Problem.Flooded;
  if (b.jobs > 0 && !abandoned) {
    if (b.workers < b.jobs * 0.5 && b.age > 20) bs.nwk += k;
    else bs.nwk = Math.max(0, bs.nwk - 2 * k);
    if (bs.nwk > 5) {
      const eduShare = eduShareOf(m.jobCat ?? 'com', b.level);
      p |= eduShare > 0.4 && r.eduFill < r.uneFill ? Problem.NoEducated : Problem.NoWorkers;
    }
    if (bs.nwk > WORKER_GRACE_DAYS) severe++;
    if (bs.ncu > 5) p |= Problem.NoCustomers;
    if (bs.ncu > CUSTOMER_GRACE_DAYS) severe++;
    if (m.jobCat === 'com' && bs.ngd > 5) p |= Problem.NoGoods;
    if (m.jobCat === 'com' && bs.ngd > CUSTOMER_GRACE_DAYS) severe++;
  } else {
    bs.nwk = 0;
    bs.ncu = 0;
    bs.ngd = 0;
  }
  if (m.cat !== 'ind' && perPoll >= POLLUTION_PROBLEM) {
    p |= Problem.Pollution;
    if (isRes && perPoll >= POLLUTION_SEVERE) { severe++; envSevere++; }
  }
  if (isRes && perNoise >= NOISE_PROBLEM) p |= Problem.Noise;
  if (bs.dead > 0 && bs.dd > DEAD_PROBLEM_DAYS) {
    p |= Problem.Dead;
    if (bs.dd > DEAD_SEVERE_DAYS) severe++;
  }
  if (m.cat !== 'res' && m.cat !== 'ind' && s.traffic >= TRAFFIC_PROBLEM) p |= Problem.Traffic;
  if (isRes && !abandoned && b.residents > 0 && b.happiness < UNHAPPY) {
    p |= Problem.LowHappiness;
    if (b.happiness < MISERABLE) severe++;
  }

  // high rent: land value far beyond what the building can offer
  const maxLevel = Math.min(e.maxLevel, m.maxLevel);
  let block: number = LevelBlock.None;
  if (!abandoned && !onFire && !(b.flags & BFlag.Historical) && b.level < maxLevel) {
    block = levelBlock(ctx, b, m, e, s, svc, jobsOk, customers);
  } else {
    block = b.level >= m.maxLevel ? LevelBlock.MaxLevel : b.level >= maxLevel ? LevelBlock.Policy : LevelBlock.Problems;
  }
  if (!e.noHighRent && (m.cat === 'res' || m.cat === 'com') && b.level < 5 && block !== LevelBlock.None && s.lv >= LEVEL_LAND_VALUE[Math.min(5, b.level + 2)]) {
    bs.hr += k;
  } else bs.hr = Math.max(0, bs.hr - 2 * k);
  if (bs.hr > 40) p |= Problem.HighRent;

  if (!abandoned) {
    if (severe > 0) b.distress += k * Math.min(3, severe);
    else b.distress = Math.max(0, b.distress - k * DISTRESS_RECOVERY);
    if (b.distress >= ABANDON_DISTRESS) {
      b.flags |= BFlag.Abandoned;
      agg.movedOut += b.residents;
      b.residents = 0;
      b.workers = 0;
      b.visitors = 0;
      b.garbage = 0;
      bs.cd = 0;
      bs.rc = 0;
      bs.lp = 0;
      st.metrics.abandonedEver++;
    }
  } else {
    bs.cd += k;
    const utilitiesOk = s.power && s.water && s.sewage && s.road;
    if (envSevere === 0 && utilitiesOk && !onFire) bs.rc += k;
    else bs.rc = 0;
    if (bs.rc >= RECOVERY_DAYS) {
      b.flags &= ~BFlag.Abandoned;
      b.distress = 0;
      bs.cd = 0;
      bs.rc = 0;
      bs.nwk = 0;
      bs.ncu = 0;
      bs.ngd = 0;
      st.metrics.recovered++;
    } else if (ctx.settings.gameplay.autoBulldozeAbandoned && bs.cd >= AUTO_BULLDOZE_DAYS) {
      st.metrics.autoBulldozed++;
      ctx.removeQueue.push(b.id);
    }
  }
  if (b.flags & BFlag.Abandoned) p |= Problem.Abandoned;
  b.problems = p;

  // ── level up ───────────────────────────────────────────────────────────
  bs.lr = block;
  if (!(b.flags & BFlag.Abandoned)) agg.blockCount[block]++;
  if (block === LevelBlock.None) {
    const days = LEVEL_UP_DAYS + LEVEL_UP_DAYS_PER_LEVEL * (b.level - 1);
    bs.lp += (k * (e.levelRate[m.cat] ?? 1)) / days;
    if (bs.lp >= 1) {
      b.level++;
      bs.lp = 0;
      b.maxResidents = capRes(m, area, b.level);
      b.jobs = capJobs(m, area, b.level);
      b.flags |= BFlag.Upgrading;
      bs.up = UPGRADE_SCAFFOLD_DAYS;
      st.metrics.levelUps++;
      if (b.level === 5 && m.highDensity) ctx.onLevel5?.(b);
    }
  } else if (bs.lp > 0) {
    bs.lp = Math.max(0, bs.lp - k * 0.004);
  }

  // ── taxes & aggregates ─────────────────────────────────────────────────
  if (!abandoned) addTaxes(ctx, b, m, e, s.lv, jobOcc, bs);
  else bs.tx = 0;
  const occ = b.residents + b.workers;
  if (occ > 0) {
    agg.weight += occ;
    agg.happySum += b.happiness * occ;
    if (isRes) {
      agg.healthSum += b.health * b.residents;
      agg.eduSum += b.education * b.residents;
      agg.eduWeight += b.residents;
    }
  }
  agg.envWeight += area;
  agg.crimeSum += perCrime * area;
  agg.landSum += s.lv * area;
  agg.pollSum += s.poll * area;
  agg.noiseSum += s.noise * area;
  if (s.lv > agg.maxLand) agg.maxLand = s.lv;
  if (abandoned || b.flags & BFlag.Abandoned) agg.abandoned++;
  agg.byLevel[b.level]++;
  if (b.level === 5) agg.level5++;
  if (m.highDensity) agg.highDensity++;
  agg.styles.add(b.style);
  if (ctx.serviceArrays.length) {
    agg.coverageEvaluated++;
    let all = true;
    for (const arr of ctx.serviceArrays) if (arr[s.ci] < COVERAGE_OK) { all = false; break; }
    if (all) agg.coveredAll++;
  }
  const did = ctx.policies.districtOf(b);
  if (did) {
    agg.districtPop[did] += b.residents;
    agg.districtJobs[did] += b.jobs;
    agg.districtHappy[did] += b.happiness;
    agg.districtLand[did] += s.lv;
    agg.districtBuildings[did]++;
  }
  agg.addProblems(p, b.id, ctx.rng.next());
  finish(ctx, b, bs, before);
}

/** Notify renderers only when something visible changed (flags, level or the primary problem icon). */
export function finish(ctx: SimContext, b: Building, bs: BSim, before: number): void {
  const after = (b.flags & VISUAL_FLAGS) | (b.level << 20);
  const pp = primaryProblem(b.problems);
  if (after !== before || pp !== bs.pp) {
    bs.pp = pp;
    ctx.touch(b);
  }
}

/** Zoned residential capacity helper for immediate fills (cheats). */
export function vacancyOf(b: Building): number {
  if (b.kind !== 'zoned' || b.built < 1 || b.flags & (BFlag.Abandoned | BFlag.Collapsed | BFlag.Burned)) return 0;
  return Math.max(0, b.maxResidents - b.residents);
}

export function isResidentialZone(z: ZoneType): boolean {
  return zoneMeta(z)?.cat === 'res';
}
