// Economy: builds the daily money ledger from the day pass, accrues income
// and expenses every day (1/30 of the monthly amounts), closes months (loan
// payments, history, bankruptcy warnings) and answers projections.
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../core/constants';
import { RoadType, type BudgetCategory, type HistoryPoint, type TaxCategory, type TransitMode } from '../core/types';
import { roadDef } from '../data/roads';
import { formatMoney } from '../core/util';
import { TAX_CATEGORIES, BUDGET_CATEGORIES } from '../world/World';
import type { DayAgg } from './aggregates';
import type { SimContext } from './context';
import { emptyLedger, type Ledger } from './state';
import {
  BANKRUPTCY_MONTHS, BUDGET_MAX, BUDGET_MIN, LOAN_TIERS, MAX_LOANS, TAX_MAX, TAX_MIN, TOURIST_SPEND, TRANSIT_FARE, TRANSIT_VEHICLE_UPKEEP,
  type LoanTier,
} from './tuning';

/** Extra cost multiplier of a bridge cell's upkeep. */
const BRIDGE_UPKEEP_MULT = 2;
/** History older than this many days is thinned to one point per quarter. */
const HISTORY_FULL_DAYS = 30 * DAYS_PER_YEAR;

export interface LoanOffer extends LoanTier {
  index: number;
  unlocked: boolean;
  /** monthly payment */
  payment: number;
  /** total interest over the term */
  interest: number;
}

export class EconomyEngine {
  constructor(private ctx: SimContext) {}

  // ── roads ────────────────────────────────────────────────────────────────
  /** recount road cells per type (only after road edits) */
  recountRoads(): void {
    const ctx = this.ctx, w = ctx.world;
    const counts = new Array<number>(16).fill(0);
    let bridges = 0;
    const road = w.road, flags = w.roadFlags, n = road.length;
    for (let i = 0; i < n; i++) {
      const t = road[i];
      if (!t) continue;
      counts[t]++;
      if (flags[i] & 1) bridges++;
    }
    ctx.roadCounts = counts;
    ctx.bridgeCells = bridges;
    ctx.roadsDirty = false;
  }

  /** road upkeep per day at 100 % budget */
  roadUpkeepPerDay(): number {
    const ctx = this.ctx;
    if (ctx.roadsDirty) this.recountRoads();
    let monthly = 0, cells = 0;
    for (let t = 1; t < ctx.roadCounts.length; t++) {
      const n = ctx.roadCounts[t];
      if (!n) continue;
      const def = roadDef(t as RoadType);
      if (!def) continue;
      monthly += n * def.upkeep;
      cells += n;
    }
    // bridges cost extra (average road upkeep per cell × bridge cells)
    if (cells > 0 && ctx.bridgeCells > 0) monthly += (monthly / cells) * ctx.bridgeCells * (BRIDGE_UPKEEP_MULT - 1);
    return monthly / DAYS_PER_MONTH;
  }

  // ── ledger ───────────────────────────────────────────────────────────────
  /** Build today's per-day money bases from a complete day. */
  buildLedger(a: DayAgg, exportDutyPerDay: number): Ledger {
    const ctx = this.ctx, w = ctx.world, st = ctx.state;
    const l = emptyLedger();
    for (const t of TAX_CATEGORIES) l.taxBase[t] = a.taxBase[t];
    l.upkeepBase = { ...a.upkeepBase };
    l.roadsBase = this.roadUpkeepPerDay();
    // tourism
    l.income.tourism = (st.rates.tourists * TOURIST_SPEND) / DAYS_PER_MONTH;
    // exports: raw materials (per building) + manufactured surplus
    l.income.exports = a.exportsValue + exportDutyPerDay;
    // transit fares & line vehicles
    let fares = 0, vehicles = 0;
    const fareMult = ctx.policies.cityFx().transitFare;
    for (const line of w.transitLines) {
      if (!line.active) continue;
      fares += (line.ridership || 0) * (TRANSIT_FARE[line.mode as TransitMode] ?? 1.5);
      vehicles += (line.vehicles || 0) * (TRANSIT_VEHICLE_UPKEEP[line.mode as TransitMode] ?? 80);
    }
    l.income.transit = (fares * fareMult) / DAYS_PER_MONTH;
    l.expense.transitVehicles = vehicles / DAYS_PER_MONTH;
    // policies
    l.expense.policies = ctx.policies.monthlyCost(a.population, a.districtPop) / DAYS_PER_MONTH;
    return l;
  }

  /** Monthly amounts per category at current rates (for projections and daily accrual). */
  monthly(l: Ledger = this.ctx.state.ledger): { income: Record<string, number>; expense: Record<string, number> } {
    const w = this.ctx.world, e = w.economy, mods = this.ctx.mods;
    const income: Record<string, number> = {};
    const expense: Record<string, number> = {};
    for (const t of TAX_CATEGORIES) {
      const v = (l.taxBase[t] ?? 0) * e.taxes[t] * mods.incomeMult * DAYS_PER_MONTH;
      if (v > 0) income['taxes:' + t] = v;
    }
    if (l.income.tourism > 0) income.tourism = l.income.tourism * DAYS_PER_MONTH;
    if (l.income.exports > 0) income.exports = l.income.exports * DAYS_PER_MONTH;
    if (l.income.transit > 0) income.transit = l.income.transit * DAYS_PER_MONTH;
    for (const [cat, v] of Object.entries(l.upkeepBase)) {
      if (v <= 0) continue;
      const b = e.budgets[cat as BudgetCategory] ?? 1;
      expense['upkeep:' + cat] = (expense['upkeep:' + cat] ?? 0) + v * b * DAYS_PER_MONTH;
    }
    if (l.roadsBase > 0) expense['upkeep:roads'] = l.roadsBase * (e.budgets.roads ?? 1) * DAYS_PER_MONTH;
    if ((l.expense.transitVehicles ?? 0) > 0) {
      expense['upkeep:transit'] = (expense['upkeep:transit'] ?? 0) + l.expense.transitVehicles * (e.budgets.transit ?? 1) * DAYS_PER_MONTH;
    }
    if ((l.expense.policies ?? 0) > 0) expense['upkeep:policies'] = l.expense.policies * DAYS_PER_MONTH;
    const loans = this.loanPayments();
    if (loans > 0) expense['upkeep:loans'] = loans;
    return { income, expense };
  }

  /** Accrue dtDays of income and expenses (loans are paid at month close). */
  accrue(dtDays: number): void {
    const w = this.ctx.world;
    if (w.creative) return;
    const { income, expense } = this.monthly();
    const f = dtDays / DAYS_PER_MONTH;
    for (const [k, v] of Object.entries(income)) if (v > 0) w.earn(v * f, k);
    for (const [k, v] of Object.entries(expense)) if (v > 0 && k !== 'upkeep:loans') w.charge(v * f, k);
  }

  /** projected monthly net at current rates */
  projectedNet(): number {
    const { income, expense } = this.monthly();
    let n = 0;
    for (const v of Object.values(income)) n += v;
    for (const v of Object.values(expense)) n -= v;
    return n;
  }

  // ── loans ────────────────────────────────────────────────────────────────
  loanPayments(): number {
    let s = 0;
    for (const l of this.ctx.world.economy.loans) s += Math.min(l.payment, l.remaining * (1 + l.rate / 12));
    return s;
  }

  offers(): LoanOffer[] {
    const w = this.ctx.world;
    return LOAN_TIERS.map((t, index) => {
      const payment = annuity(t.amount, t.rate, t.years);
      return { ...t, index, unlocked: w.isUnlocked(t.unlock), payment, interest: payment * t.years * 12 - t.amount };
    });
  }

  takeLoan(amount: number, years: number): { ok: boolean; reason?: string } {
    const ctx = this.ctx, w = ctx.world, e = w.economy;
    if (w.creative) return { ok: false, reason: 'Loans are not needed in creative mode' };
    if (e.loans.length >= MAX_LOANS) return { ok: false, reason: `You can hold at most ${MAX_LOANS} loans` };
    // match a tier (exact, or the smallest tier that covers the amount/term)
    const tiers = this.offers().filter((o) => o.unlocked);
    let tier = tiers.find((o) => Math.abs(o.amount - amount) < 1 && o.years === years) ?? tiers.find((o) => Math.abs(o.amount - amount) < 1);
    if (!tier) tier = tiers.filter((o) => o.amount >= amount).sort((a, b) => a.amount - b.amount)[0];
    if (!tier || !(amount > 0)) return { ok: false, reason: 'No loan offer available for that amount' };
    const principal = Math.min(amount, tier.amount);
    const term = years > 0 ? Math.min(tier.years, Math.max(1, Math.round(years))) : tier.years;
    const payment = annuity(principal, tier.rate, term);
    const id = ctx.state.nextLoanId++;
    e.loans.push({ id, amount: principal, rate: tier.rate, remaining: principal, payment, takenDay: Math.floor(w.time.day) });
    w.earn(principal, 'loan');
    const m = ctx.state.metrics;
    m.loansTaken++;
    m.maxLoans = Math.max(m.maxLoans, e.loans.length);
    w.notify({ kind: 'info', title: 'Loan approved', text: `${formatMoney(principal)} over ${term} years at ${(tier.rate * 100).toFixed(1)} % — ${formatMoney(payment)}/month.`, icon: '🏦' });
    return { ok: true };
  }

  repayLoan(id: number): { ok: boolean; reason?: string } {
    const ctx = this.ctx, w = ctx.world, e = w.economy;
    const i = e.loans.findIndex((l) => l.id === id);
    if (i < 0) return { ok: false, reason: 'Unknown loan' };
    const l = e.loans[i];
    const due = Math.ceil(l.remaining);
    if (!w.canAfford(due)) return { ok: false, reason: `Not enough money (${formatMoney(due)} needed)` };
    w.charge(due, 'upkeep:loans');
    e.loans.splice(i, 1);
    ctx.state.metrics.loansRepaid++;
    w.notify({ kind: 'good', title: 'Loan repaid', text: `You paid off ${formatMoney(l.amount)} early. The bank is impressed.`, icon: '✅' });
    return { ok: true };
  }

  // ── month close ──────────────────────────────────────────────────────────
  closeMonth(): void {
    const ctx = this.ctx, w = ctx.world, e = w.economy, st = ctx.state, m = st.metrics;
    // loan payments
    for (let i = e.loans.length - 1; i >= 0; i--) {
      const l = e.loans[i];
      const interest = l.remaining * (l.rate / 12);
      const pay = Math.min(l.payment, l.remaining + interest);
      w.charge(pay, 'upkeep:loans');
      l.remaining = Math.max(0, l.remaining - (pay - interest));
      if (l.remaining < 0.5) {
        e.loans.splice(i, 1);
        m.loansRepaid++;
        w.notify({ kind: 'good', title: 'Loan paid off', text: `The ${formatMoney(l.amount)} loan is fully repaid.`, icon: '✅' });
      }
    }
    // close books
    e.lastIncome = roundAll(e.monthIncome);
    e.lastExpense = roundAll(e.monthExpense);
    e.monthIncome = {};
    e.monthExpense = {};
    const op = operatingNet(e.lastIncome, e.lastExpense);
    const inc = op.income, exp = op.expense, net = op.net;
    st.monthExports = e.lastIncome.exports ?? 0;
    m.months++;
    m.profitStreak = net > 0 ? m.profitStreak + 1 : 0;
    m.maxMonthlyIncome = Math.max(m.maxMonthlyIncome, inc);
    m.maxNetIncome = Math.max(m.maxNetIncome, net);
    m.maxExports = Math.max(m.maxExports, st.monthExports);
    // history
    const s = w.stats;
    const point: HistoryPoint = {
      day: Math.floor(w.time.day),
      population: s.population,
      money: Math.round(e.money),
      income: Math.round(inc),
      expenses: Math.round(exp),
      happiness: s.happiness,
      jobs: s.jobs,
      unemployment: s.workforce > 0 ? Math.round((s.unemployed / s.workforce) * 1000) / 10 : 0,
      crime: s.crimeRate,
      pollution: s.pollution,
      landValue: s.landValue,
      trafficFlow: s.trafficFlow,
      demandRes: s.demand.res,
      demandCom: s.demand.com,
      demandInd: s.demand.ind,
      demandOff: s.demand.off,
    };
    w.history.push(point);
    this.thinHistory();
    // bankruptcy warnings
    if (!w.creative && e.money < 0) {
      st.negMonths++;
      // warn when the freeze starts, then every six months while it lasts
      if (st.negMonths >= BANKRUPTCY_MONTHS && (st.negMonths - BANKRUPTCY_MONTHS) % 6 === 0 && st.bankruptWarned !== m.months) {
        st.bankruptWarned = m.months;
        w.notify({
          kind: 'danger', title: 'Bankruptcy warning',
          text: `The treasury has been in debt for ${st.negMonths} months. Construction is frozen until you are back in the black — raise taxes, cut budgets or take a loan.`,
          icon: '💸',
        });
        try { ctx.game.audio.play('warning'); } catch { /* audio optional */ }
      }
    } else st.negMonths = 0;
  }

  /** true while the bankruptcy freeze applies (money < 0 for BANKRUPTCY_MONTHS) */
  get bankrupt(): boolean {
    return !this.ctx.world.creative && this.ctx.world.economy.money < 0 && this.ctx.state.negMonths >= BANKRUPTCY_MONTHS;
  }

  /** keep monthly points for the last 30 years, one per quarter before that */
  private thinHistory(): void {
    const h = this.ctx.world.history;
    if (h.length < 400) return;
    const cutoff = Math.floor(this.ctx.world.time.day) - HISTORY_FULL_DAYS;
    const out = h.filter((p) => p.day >= cutoff || Math.floor(p.day / DAYS_PER_MONTH) % 3 === 0);
    if (out.length !== h.length) {
      h.length = 0;
      h.push(...out);
    }
  }

  // ── setters ──────────────────────────────────────────────────────────────
  setTax(cat: TaxCategory, rate: number): void {
    const e = this.ctx.world.economy;
    if (!(cat in e.taxes) || !Number.isFinite(rate)) return;
    e.taxes[cat] = Math.round(Math.max(TAX_MIN, Math.min(TAX_MAX, rate)) * 1000) / 1000;
  }

  setBudget(cat: BudgetCategory, v: number): void {
    const e = this.ctx.world.economy;
    if (!BUDGET_CATEGORIES.includes(cat) || !Number.isFinite(v)) return;
    e.budgets[cat] = Math.round(Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, v)) * 100) / 100;
  }
}

/** Income categories that are not operating income (borrowing, rewards, refunds). */
const NON_OPERATING_INCOME = new Set(['loan', 'milestone', 'refund', 'refunds', 'reward', 'rewards']);
/** Expense categories that are investments rather than running costs. */
const NON_OPERATING_EXPENSE = new Set(['construction']);

/** Operating result of a month: taxes & fees minus running costs (loan payments included). */
export function operatingNet(income: Record<string, number>, expense: Record<string, number>): { income: number; expense: number; net: number } {
  let inc = 0, exp = 0;
  for (const [k, v] of Object.entries(income)) if (!NON_OPERATING_INCOME.has(k)) inc += v;
  for (const [k, v] of Object.entries(expense)) if (!NON_OPERATING_EXPENSE.has(k)) exp += v;
  return { income: inc, expense: exp, net: inc - exp };
}

/** monthly annuity payment */
export function annuity(principal: number, yearlyRate: number, years: number): number {
  const n = Math.max(1, Math.round(years * 12));
  const r = yearlyRate / 12;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function roundAll(r: Record<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) o[k] = Math.round(v * 100) / 100;
  return o;
}
