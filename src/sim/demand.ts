// RCIO demand. Each full day, a target in [-1, 1] is computed per category
// from the labour market, housing vacancy, happiness, taxes, commercial
// buying power vs. shop capacity, goods balance, exports, the educated
// workforce, policies and event modifiers; the displayed demand eases toward
// it (DEMAND_SMOOTHING per day).
import { ZoneType, type ZoneCategory } from '../core/types';
import { zoneDef } from '../data/zones';
import { MILESTONES } from '../data/milestones';
import type { DayAgg } from './aggregates';
import type { SimContext } from './context';
import { GOODS_PER_IND_WORKER, RAW_LOCAL_SHARE, RESIDENTS_PER_COM_JOB, TAX_COMFORT, DEMAND_SMOOTHING } from './tuning';

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Demand penalty (positive) or bonus (negative) of a tax rate. */
function taxEffect(rate: number): number {
  return rate > TAX_COMFORT ? (rate - TAX_COMFORT) * 3.2 : -(TAX_COMFORT - rate) * 1.4;
}

/** Explanations for the UI (why a category's demand is what it is). */
export interface DemandFactors {
  res: string[];
  com: string[];
  ind: string[];
  off: string[];
}

export function demandTargets(ctx: SimContext, a: DayAgg): { t: Record<ZoneCategory, number>; why: DemandFactors } {
  const w = ctx.world, r = ctx.state.rates, taxes = w.economy.taxes, mods = ctx.mods;
  const why: DemandFactors = { res: [], com: [], ind: [], off: [] };
  const pop = a.population;
  const W = a.workforce;
  const policyDemand = ctx.policies.demandEffect(pop, a.districtPop);
  const outside = r.outside > 0;

  // ── residential ───────────────────────────────────────────────────────
  // base appeal: people keep moving to a well-run city, expecting to find work
  let R = 0.36;
  // a young town expects its jobs to follow (industry and shops are still being zoned),
  // so a temporary lack of work weighs less until the town has found its feet
  const young = 1 - smooth(400, 2500, pop);
  const totalJobs = a.totalJobs + a.jobsUC.com + a.jobsUC.ind + a.jobsUC.off;
  const unemployed = W * r.unemployment;
  // jobs not held by residents (vacant or filled by commuters) are an invitation to move here
  const employedResidents = W - unemployed;
  const openJobs = Math.max(0, totalJobs * 0.97 - employedResidents);
  let jobTerm = clamp((openJobs - unemployed) / Math.max(30, W * 0.3 + 25), -1, 1) * 0.5;
  if (jobTerm < 0) jobTerm *= 1 - 0.5 * young;
  R += jobTerm;
  if (jobTerm > 0.15) why.res.push('Plenty of jobs available');
  else if (jobTerm < -0.15) why.res.push('Not enough jobs');
  const homes = a.resCap + a.resCapUC;
  const vacancy = homes > 0 ? (a.resVacant + a.resCapUC) / homes : 0;
  const vac = smooth(0.05, 0.3, vacancy) * 0.6;
  R -= vac;
  if (vac > 0.2) why.res.push('Many homes are empty');
  const happy = (r.happiness - 50) / 100 * 0.6;
  R += happy;
  if (happy < -0.06) why.res.push('Citizens are unhappy');
  else if (happy > 0.12) why.res.push('The city has a great reputation');
  const jobless = Math.max(0, r.unemployment - 0.08) * 3 * (1 - 0.6 * young);
  R -= jobless;
  if (jobless > 0.1) why.res.push('High unemployment scares newcomers away');
  const tr = (taxEffect(taxes.resLow) + taxEffect(taxes.resHigh)) * 0.5;
  R -= tr;
  if (tr > 0.05) why.res.push('Residential taxes are high');
  if (pop < 400) {
    R += 0.4 * (1 - pop / 400);
    why.res.push('Settlers are eager to move in');
  }
  if (ctx.state.pendingImmigrants > 0) R += 0.3;
  R += policyDemand.res + mods.demandRes;
  if (!outside && ctx.outside.hasConnections) why.res.push('Not connected to the highway');

  // ── commercial ────────────────────────────────────────────────────────
  let C: number;
  const comCap = (a.jobs.com + a.jobsUC.com) * RESIDENTS_PER_COM_JOB;
  const buying = a.buyingPower + (r.tourists / 30) * 3 + r.commuters * 0.3;
  if (pop < 60 && a.jobs.com === 0) {
    C = 0.1 + pop / 600;
  } else {
    C = clamp((buying - comCap) / Math.max(60, comCap * 0.45 + 40), -1, 1) * 0.85 + 0.05;
    if (buying > comCap * 1.1) why.com.push('Residents want more shops');
    else if (buying < comCap * 0.8) why.com.push('Too many shops for the population');
  }
  const tc = (taxEffect(taxes.comLow) + taxEffect(taxes.comHigh)) * 0.5;
  C -= tc;
  if (tc > 0.05) why.com.push('Commercial taxes are high');
  if (r.uneFill < 0.85 && a.jobs.com > 0) {
    C -= (0.85 - r.uneFill) * 1.1;
    why.com.push('Shops cannot find workers');
  }
  if (r.goods < 0.6 && a.jobs.com > 0) {
    C -= (0.6 - r.goods) * 0.5;
    why.com.push('Shops lack goods');
  }
  if (r.tourists > 500) why.com.push('Tourists are shopping');
  const comLabour = pop > 100 ? clamp((r.unemployment - 0.05) * 2, -0.15, 0.3) : 0;
  C += comLabour;
  if (comLabour > 0.08) why.com.push('Plenty of people looking for work');
  C += policyDemand.com + mods.demandCom;

  // ── industrial ────────────────────────────────────────────────────────
  const need = a.goodsNeed + a.jobsUC.com;
  const supply = a.production + a.rawProduction * RAW_LOCAL_SHARE + a.jobsUC.ind * GOODS_PER_IND_WORKER * 0.8;
  // surplus goods can be exported, so a saturated local market only mildly discourages industry
  const goodsTerm = clamp((need - supply) / Math.max(40, need * 0.5 + 30), -1, 1) * 0.55;
  let I = (outside ? 0.24 : 0) + (outside ? Math.max(-0.15, goodsTerm) : goodsTerm);
  if (need > supply * 1.1) why.ind.push('Shops need goods');
  if (outside) why.ind.push('Export markets are open');
  if (pop < 300) {
    I += 0.3 * (1 - pop / 300);
  }
  const unemp = clamp((r.unemployment - 0.05) * 3, -0.2, 0.45);
  I += unemp;
  if (unemp > 0.1) why.ind.push('Many people are looking for work');
  if (r.uneFill < 0.85 && a.jobs.ind > 0) {
    I -= (0.85 - r.uneFill) * 1.2;
    why.ind.push('Factories cannot find workers');
  }
  // industry beyond what the workforce can staff is pointless
  const indJobs = a.jobs.ind + a.jobsUC.ind;
  if (pop > 300 && indJobs > W * 0.65) I -= clamp((indJobs - W * 0.65) / Math.max(50, W * 0.2), 0, 0.8);
  const ti = taxEffect(taxes.industry);
  I -= ti;
  if (ti > 0.05) why.ind.push('Industrial taxes are high');
  I += policyDemand.ind + mods.demandInd;

  // ── office ────────────────────────────────────────────────────────────
  let O = 0;
  const officeUnlocked = w.isUnlocked(zoneDef(ZoneType.Office).unlock);
  if (officeUnlocked) {
    const educatedIdle = W * r.educated * r.unemployment;
    const offJobs = a.jobs.off + a.jobsUC.off;
    const eduPool = W * r.educated;
    O = clamp((r.educated - 0.22) * 1.6, -0.35, 0.55);
    O += clamp((educatedIdle * 1.5 + eduPool * 0.12 - offJobs * 0.35) / Math.max(30, eduPool * 0.25 + 20), -1, 1) * 0.35;
    if (r.educated > 0.35) why.off.push('Educated workers are available');
    else why.off.push('Needs a more educated workforce');
    if (r.eduFill < 0.8 && a.jobs.off > 0) {
      O -= (0.8 - r.eduFill) * 1.2;
      why.off.push('Offices cannot find educated staff');
    }
    const to = taxEffect(taxes.office);
    O -= to;
    if (to > 0.05) why.off.push('Office taxes are high');
    O += policyDemand.off + mods.demandOff + ctx.perks.office;
  } else {
    why.off.push(`Offices unlock at the ${MILESTONES[zoneDef(ZoneType.Office).unlock]?.name ?? 'next'} milestone`);
  }
  return {
    t: { res: clamp(R, -1, 1), com: clamp(C, -1, 1), ind: clamp(I, -1, 1), off: officeUnlocked ? clamp(O, -1, 1) : 0 },
    why,
  };
}

/** Ease the displayed demand toward today's targets. */
export function updateDemand(ctx: SimContext, a: DayAgg, dtDays: number): DemandFactors {
  const { t, why } = demandTargets(ctx, a);
  const d = ctx.world.stats.demand;
  const k = 1 - Math.pow(1 - DEMAND_SMOOTHING, Math.max(1, dtDays));
  for (const c of ['res', 'com', 'ind', 'off'] as ZoneCategory[]) {
    const v = d[c] + (t[c] - d[c]) * k;
    d[c] = Math.round(clamp(v, -1, 1) * 1000) / 1000;
  }
  return why;
}
