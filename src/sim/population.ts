// End-of-day city computations: the labour market (education-aware job
// matching with outside commuters), migration rates, commerce & industry
// balance (goods, imports, exports, sales), service capacity ratios
// (schools, healthcare, garbage, deathcare), tourism and the CityStats the
// UI shows. Rates computed here drive the next day's building pass.
import { milestoneForPopulation } from '../data/milestones';
import type { DayAgg } from './aggregates';
import type { SimContext } from './context';
import {
  COMMUTER_BASE, COMMUTER_FILL, COMMUTER_POP_SHARE, EXPORT_PRICE, FRICTIONAL_UNEMPLOYMENT, IMPORT_SHARE_MAX, MOVE_IN_MAX, MOVE_IN_MIN,
  RAW_LOCAL_SHARE, RESIDENTS_PER_COM_JOB, TOURISTS_PER_ATTRACTION,
} from './tuning';
import { calendar } from '../core/time';

/** Manufactured goods exported per day (units) — computed with the rates. */
export interface DayFlows {
  exportUnits: number;
  imports: number;
}

/** Compute next-day rates from a complete day of aggregates. */
export function computeRates(ctx: SimContext, a: DayAgg): DayFlows {
  const st = ctx.state, r = st.rates, w = ctx.world;
  const pop = a.population;
  // trade, commuters and immigrants need a road link to an outside connection
  const outside = !ctx.outside.hasConnections || a.connected > 0 ? 1 : 0;
  r.outside = outside;

  // ── labour market ──────────────────────────────────────────────────────
  const W = a.workforce;
  const We = Math.min(W, a.educatedWorkforce);
  const availE = We * (1 - FRICTIONAL_UNEMPLOYMENT);
  const availU = (W - We) * (1 - FRICTIONAL_UNEMPLOYMENT);
  const eduJobs = a.eduJobs, uneJobs = a.uneJobs;
  const fillE = Math.min(eduJobs, availE);
  const spillE = availE - fillE; // educated people taking uneducated jobs
  const fillU = Math.min(uneJobs, availU + spillE);
  const shortE = eduJobs - fillE;
  const shortU = uneJobs - fillU;
  const pool = outside ? COMMUTER_BASE + pop * COMMUTER_POP_SHARE : 0;
  const cE = Math.min(shortE * COMMUTER_FILL, pool * 0.35);
  const cU = Math.min(shortU * COMMUTER_FILL, Math.max(0, pool - cE));
  r.commuters = cE + cU;
  r.eduFill = eduJobs > 0 ? Math.min(1, (fillE + cE) / eduJobs) : 1;
  r.uneFill = uneJobs > 0 ? Math.min(1, (fillU + cU) / uneJobs) : 1;
  const employed = fillE + fillU;
  r.unemployment = W > 0 ? Math.max(0, Math.min(1, 1 - employed / W)) : 0;
  r.educated = W > 0 ? We / W : 0.2;

  // ── happiness & migration ──────────────────────────────────────────────
  r.happiness = a.weight > 0 ? a.happySum / a.weight : 60;
  const desire = Math.max(-1, Math.min(1, w.stats.demand.res));
  st.desire.res = desire;
  if (!outside) r.moveIn = 0;
  else if (desire >= 0) r.moveIn = MOVE_IN_MIN + (MOVE_IN_MAX - MOVE_IN_MIN) * desire;
  else r.moveIn = MOVE_IN_MIN * (1 + desire);
  const unhappy = Math.max(0, (45 - r.happiness) / 100) * 0.012;
  const jobless = Math.max(0, r.unemployment - 0.1) * 0.02;
  r.emigrate = unhappy + jobless + (desire < -0.3 ? (-desire - 0.3) * 0.004 : 0);
  // newcomers get better educated as the city grows and gains reputation
  r.immigrantEdu = Math.min(55, 18 + milestoneForPopulation(pop) * 2.5 + Math.max(0, (w.stats.landValue - 30) * 0.2));

  // ── tourism ────────────────────────────────────────────────────────────
  const season = calendar(w.time.day).season;
  const seasonF = season === 'summer' ? 1.2 : season === 'winter' ? 0.8 : 1;
  const tourismPolicy = ctx.policies.cityFx().tourism;
  r.tourists = a.attraction * TOURISTS_PER_ATTRACTION * ctx.mods.tourismMult * tourismPolicy * (outside ? 1 : 0.1) * (0.6 + (r.happiness / 100) * 0.6) * seasonF;

  // ── commerce & industry ────────────────────────────────────────────────
  const comJobs = a.jobs.com;
  const buying = a.buyingPower + (r.tourists / 30) * 3 + r.commuters * 0.3;
  const comCap = a.workers.com * RESIDENTS_PER_COM_JOB;
  r.customers = comCap > 0 ? Math.min(2.5, buying / comCap) : 1;
  const need = a.goodsNeed;
  const supply = a.production + a.rawProduction * RAW_LOCAL_SHARE;
  const localSold = Math.min(supply, need);
  const imports = outside ? Math.min(need - localSold, need * IMPORT_SHARE_MAX) : 0;
  r.imported = need > 0 ? imports / need : 0;
  r.goods = need > 0 ? Math.min(1, (localSold + imports) / need) : comJobs > 0 ? 1 : 1;
  const surplus = supply - localSold;
  const exportUnits = outside ? surplus : 0;
  r.sales = supply > 0 ? Math.min(1, (localSold + exportUnits * 0.92) / supply) : 1;

  // ── services capacity ──────────────────────────────────────────────────
  r.enroll = a.studentsPotential > 0 ? Math.min(1, a.eduCap / a.studentsPotential) : a.eduCap > 0 ? 1 : 0;
  r.treat = a.sick > 0 ? Math.min(1, a.healthCap / a.sick) : 1;
  r.garbageAllow = a.gbThroughput + a.gbIntake;
  r.deathAllow = a.dcThroughput + a.dcIntake;
  r.garbageOn = ctx.serviceOn('garbage') ? 1 : 0;
  r.deathOn = ctx.serviceOn('deathcare') ? 1 : 0;
  r.healthOn = ctx.serviceOn('health') ? 1 : 0;
  r.educationOn = ctx.serviceOn('education') ? 1 : 0;
  return { exportUnits, imports };
}

/** Exports duty per day for the manufactured surplus. */
export function exportDuty(flows: DayFlows): number {
  return flows.exportUnits * EXPORT_PRICE;
}

/** Write world.stats from a complete day (does not touch trafficFlow / vehicles). */
export function writeStats(ctx: SimContext, a: DayAgg): void {
  const w = ctx.world, s = w.stats, r = ctx.state.rates, f = ctx.game.fields, roll = ctx.state.roll;
  s.population = Math.round(a.population);
  s.households = Math.round(a.households);
  s.workforce = Math.round(a.workforce);
  s.jobs = Math.round(a.totalJobs);
  s.employed = Math.round(a.workforce * (1 - r.unemployment));
  s.unemployed = Math.max(0, s.workforce - s.employed);
  s.students = Math.round(a.studentsEnrolled);
  s.tourists = Math.round(r.tourists);
  s.happiness = Math.round(r.happiness * 10) / 10;
  s.health = a.eduWeight > 0 ? Math.round((a.healthSum / a.eduWeight) * 10) / 10 : 50;
  s.education = a.eduWeight > 0 ? Math.round((a.eduSum / a.eduWeight) * 10) / 10 : 0;
  const env = a.envWeight > 0 ? 1 / a.envWeight : 0;
  s.crimeRate = Math.round((a.crimeSum * env * 100) / 255 * 10) / 10;
  s.landValue = Math.round((a.landSum * env * 100) / 255 * 10) / 10;
  s.pollution = Math.round((a.pollSum * env * 100) / 255 * 10) / 10;
  s.power = { produced: round1(f?.power?.produced ?? 0), consumed: round1(f?.power?.consumed ?? 0) };
  s.water = { produced: round1(f?.water?.produced ?? 0), consumed: round1(f?.water?.consumed ?? 0) };
  s.sewage = { capacity: round1(f?.sewage?.produced ?? 0), produced: round1(f?.sewage?.consumed ?? 0) };
  s.garbage = {
    capacity: Math.round((a.gbThroughput + a.gbIntake) * 30),
    produced: Math.round(a.garbageProduced * 30),
    stored: Math.round(a.gbStored),
  };
  s.health_ = { capacity: Math.round(a.healthCap), sick: Math.round(a.sick) };
  s.education_ = { capacity: Math.round(a.eduCap), students: Math.round(a.studentsEnrolled) };
  s.deathcare = { capacity: Math.round((a.dcThroughput + a.dcIntake) * 30), dead: Math.round(a.deadWaiting) };
  s.buildings = a.buildings;
  s.births = sum(roll.births);
  s.deaths = sum(roll.deaths);
  s.movedIn = sum(roll.movedIn);
  s.movedOut = sum(roll.movedOut);
}

/** Push today's counts into the rolling 30-day windows (dtDays days at once). */
export function rollCounts(ctx: SimContext, a: DayAgg, dtDays: number): void {
  const roll = ctx.state.roll;
  const n = Math.max(1, Math.round(dtDays));
  for (let d = 0; d < n; d++) {
    roll.i = (roll.i + 1) % 30;
    roll.births[roll.i] = a.births / n;
    roll.deaths[roll.i] = a.deaths / n;
    roll.movedIn[roll.i] = a.movedIn / n;
    roll.movedOut[roll.i] = a.movedOut / n;
  }
  const m = ctx.state.metrics;
  m.totalBirths += a.births;
  m.totalDeaths += a.deaths;
}

function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return Math.round(s);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
