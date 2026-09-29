// Budget & taxes: overview (income/expense breakdown), tax sliders, service
// budget sliders and loans.
import { h } from '../dom';
import type { BudgetCategory, TaxCategory } from '../../core/types';
import { formatMoney, formatPercent } from '../../core/util';
import { Panel } from './Panel';
import { Slider, Tabs, emptyState, section } from './widgets';
import { flowLabel, setClass, setText, sumValues, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';
import { loanPayment, loanTiers, maxLoans } from '../hud/optional';
import { milestoneLabel } from '../hud/catalog';

type Page = 'overview' | 'taxes' | 'services' | 'loans';
type Source = 'projected' | 'month' | 'last';
type KpiKey = 'balance' | 'net' | 'income' | 'expense';

const TAXES: { id: TaxCategory; label: string; icon: string; color: string }[] = [
  { id: 'resLow', label: 'Residential · low density', icon: '🏡', color: 'var(--res)' },
  { id: 'resHigh', label: 'Residential · high density', icon: '🏢', color: 'var(--res)' },
  { id: 'comLow', label: 'Commercial · low density', icon: '🏪', color: 'var(--com)' },
  { id: 'comHigh', label: 'Commercial · high density', icon: '🏬', color: 'var(--com)' },
  { id: 'office', label: 'Offices', icon: '🏙️', color: 'var(--off)' },
  { id: 'industry', label: 'Industry', icon: '🏭', color: 'var(--ind)' },
];

const BUDGETS: { id: BudgetCategory; label: string; icon: string }[] = [
  { id: 'roads', label: 'Road maintenance', icon: '🛣️' },
  { id: 'power', label: 'Electricity', icon: '⚡' },
  { id: 'water', label: 'Water & sewage', icon: '💧' },
  { id: 'garbage', label: 'Garbage', icon: '🗑️' },
  { id: 'health', label: 'Healthcare', icon: '🏥' },
  { id: 'deathcare', label: 'Deathcare', icon: '⚱️' },
  { id: 'fire', label: 'Fire department', icon: '🚒' },
  { id: 'police', label: 'Police', icon: '🚓' },
  { id: 'education', label: 'Education', icon: '🎓' },
  { id: 'parks', label: 'Parks & leisure', icon: '🌳' },
  { id: 'transit', label: 'Public transport', icon: '🚌' },
  { id: 'government', label: 'Government', icon: '🏛️' },
  { id: 'disaster', label: 'Disaster response', icon: '🚨' },
];

interface Flow {
  income: Record<string, number>;
  expense: Record<string, number>;
}

export class BudgetPanel extends Panel {
  private page: Page = 'overview';
  private source: Source = 'projected';
  private tabs!: Tabs<Page>;
  private pages = {} as Record<Page, HTMLElement>;
  private kpi = {} as Record<KpiKey, HTMLElement>;
  private netTile!: HTMLElement;
  private balanceTile!: HTMLElement;
  private warn!: HTMLElement;
  private incomeList!: HTMLElement;
  private expenseList!: HTMLElement;
  private srcTabs!: Tabs<Source>;
  private taxSliders = new Map<TaxCategory, Slider>();
  private budgetSliders = new Map<BudgetCategory, Slider>();
  private taxTotal!: HTMLElement;
  private loansActive!: HTMLElement;
  private loansTiers!: HTMLElement;
  private loanSig = '';
  private proj: Flow = { income: {}, expense: {} };
  private dirtyProj = true;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'budget', title: 'Budget & Taxes', icon: 'budget', width: 780, anchor: 'center', key: 'ui.budget', rate: 2, cls: 'hud-panel-budget' });
    ctx.game.events.on('sim:month', () => (this.dirtyProj = true));
  }

  protected build(body: HTMLElement): void {
    this.tabs = new Tabs<Page>([
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'taxes', label: 'Taxes', icon: '🧾' },
      { id: 'services', label: 'Service budgets', icon: '🎚️' },
      { id: 'loans', label: 'Loans', icon: '🏦' },
    ], this.page, (p) => this.show(p));
    this.toolsEl.appendChild(this.tabs.el);
    this.pages.overview = this.buildOverview();
    this.pages.taxes = this.buildTaxes();
    this.pages.services = this.buildServices();
    this.pages.loans = this.buildLoans();
    for (const p of Object.values(this.pages)) body.appendChild(p);
    this.show(this.page);
  }

  /** open straight on a page */
  setPage(p: Page): void {
    this.page = p;
    if (this.tabs) {
      this.tabs.select(p, false);
      this.show(p);
    }
  }

  protected override onOpen(): void {
    this.tabs.placeIndicator();
    this.srcTabs.placeIndicator();
    this.dirtyProj = true;
    this.refresh();
  }

  private show(p: Page): void {
    this.page = p;
    for (const [k, el] of Object.entries(this.pages)) el.style.display = k === p ? '' : 'none';
    this.srcTabs?.placeIndicator();
    this.refresh();
  }

  // ── builders ───────────────────────────────────────────────────────────
  private tile(key: KpiKey, label: string, ic: string): HTMLElement {
    const v = h('div', { class: 'hud-kpi-val' }, '—');
    this.kpi[key] = v;
    return h('div', { class: 'hud-kpi' }, h('div', { class: 'hud-kpi-label' }, h('span', null, ic), label), v);
  }

  private buildOverview(): HTMLElement {
    this.balanceTile = this.tile('balance', 'Balance', '🏦');
    this.netTile = this.tile('net', 'Net per month', '📈');
    this.warn = h('div', { class: 'hud-banner bad' });
    this.incomeList = h('div', { class: 'hud-flow-list' });
    this.expenseList = h('div', { class: 'hud-flow-list' });
    this.srcTabs = new Tabs<Source>([
      { id: 'projected', label: 'Projected' }, { id: 'month', label: 'This month' }, { id: 'last', label: 'Last month' },
    ], this.source, (s) => {
      this.source = s;
      this.refresh();
    }, 'hud-tabs-sm');
    return h('div', { class: 'hud-page' },
      h('div', { class: 'hud-kpis' }, this.balanceTile, this.netTile, this.tile('income', 'Income', '💰'), this.tile('expense', 'Expenses', '🧾')),
      this.warn,
      section('Breakdown', this.srcTabs.el),
      h('div', { class: 'hud-flow-cols' },
        h('div', null, h('div', { class: 'hud-flow-head good' }, icon('trendUp', 14), 'Income'), this.incomeList),
        h('div', null, h('div', { class: 'hud-flow-head bad' }, icon('trendDown', 14), 'Expenses'), this.expenseList)));
  }

  private buildTaxes(): HTMLElement {
    const grid = h('div', { class: 'hud-slider-grid' });
    for (const t of TAXES) {
      const s = new Slider({
        label: t.label, icon: t.icon, color: t.color, min: 0, max: 29, step: 1, value: 9, ticks: [9, 12, 20],
        format: (v) => `${Math.round(v)}%`,
        onInput: (v) => {
          this.ctx.game.sim.setTax(t.id, v / 100);
          this.dirtyProj = true;
          this.refreshTaxes();
        },
      });
      this.taxSliders.set(t.id, s);
      grid.appendChild(s.el);
    }
    this.taxTotal = h('b', null, '—');
    const reset = h('button', { class: 'btn', onclick: () => {
      for (const t of TAXES) {
        const v = t.id === 'office' || t.id === 'industry' ? 10 : 9;
        this.ctx.game.sim.setTax(t.id, v / 100);
      }
      this.dirtyProj = true;
      this.ctx.sfx('click');
      this.refresh();
    } }, 'Reset to defaults');
    return h('div', { class: 'hud-page' },
      h('div', { class: 'hud-note' }, icon('info', 14), h('span', null, 'Rates above 12% start to slow demand and dampen happiness; above 20% citizens and businesses begin to leave.')),
      grid,
      h('div', { class: 'hud-page-foot' }, h('span', { class: 'dim' }, 'Projected tax income '), this.taxTotal, h('span', { class: 'hud-fly-spacer' }), reset));
  }

  private buildServices(): HTMLElement {
    const grid = h('div', { class: 'hud-slider-grid' });
    for (const b of BUDGETS) {
      const s = new Slider({
        label: b.label, icon: b.icon, min: 50, max: 150, step: 5, value: 100, ticks: [100],
        format: (v) => `${Math.round(v)}%`,
        onInput: (v) => {
          this.ctx.game.sim.setBudget(b.id, v / 100);
          this.dirtyProj = true;
          this.refreshServices();
        },
      });
      this.budgetSliders.set(b.id, s);
      grid.appendChild(s.el);
    }
    return h('div', { class: 'hud-page' },
      h('div', { class: 'hud-note' }, icon('info', 14), h('span', null, 'Funding changes both cost and effectiveness. Below 100% coverage shrinks and buildings struggle; above 100% has diminishing returns.')),
      grid);
  }

  private buildLoans(): HTMLElement {
    this.loansActive = h('div', { class: 'hud-loans' });
    this.loansTiers = h('div', { class: 'hud-loan-tiers' });
    return h('div', { class: 'hud-page' },
      section('Active loans'), this.loansActive,
      section('Borrow'), this.loansTiers);
  }

  // ── refresh ────────────────────────────────────────────────────────────
  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.pages.overview) return;
    if (this.dirtyProj || this.page === 'overview') {
      try {
        this.proj = this.ctx.game.sim.projection() ?? { income: {}, expense: {} };
      } catch {
        this.proj = { income: {}, expense: {} };
      }
      this.dirtyProj = false;
    }
    const e = w.economy;
    const inc = sumValues(this.proj.income), exp = sumValues(this.proj.expense);
    const hasProj = inc !== 0 || exp !== 0;
    const net = hasProj ? inc - exp : w.stats.netIncome || sumValues(e.lastIncome) - sumValues(e.lastExpense);
    this.setSubtitle(w.creative ? 'Creative mode — money is unlimited' : `${formatMoney(e.money)} · ${net >= 0 ? '+' : ''}${formatMoney(net)}/month`);
    if (this.page === 'overview') this.refreshOverview(net);
    else if (this.page === 'taxes') this.refreshTaxes();
    else if (this.page === 'services') this.refreshServices();
    else this.refreshLoans();
  }

  private refreshOverview(net: number): void {
    const w = this.ctx.world()!;
    const e = w.economy;
    const flow: Flow = this.source === 'projected' ? this.proj : this.source === 'month' ? { income: e.monthIncome, expense: e.monthExpense } : { income: e.lastIncome, expense: e.lastExpense };
    const inc = sumValues(flow.income), exp = sumValues(flow.expense);
    setText(this.kpi.balance, w.creative ? '∞' : formatMoney(e.money));
    setClass(this.balanceTile, 'bad', !w.creative && e.money < 0);
    setText(this.kpi.net, `${net >= 0 ? '+' : ''}${formatMoney(net)}`);
    setClass(this.netTile, 'good', net > 0);
    setClass(this.netTile, 'bad', net < 0);
    setText(this.kpi.income, formatMoney(inc));
    setText(this.kpi.expense, formatMoney(exp));
    const inDebt = !w.creative && e.money < 0;
    setClass(this.warn, 'show', inDebt);
    if (inDebt) setText(this.warn, '⚠ Bankruptcy warning — the treasury is empty. After three months in the red all construction is frozen. Raise taxes, cut budgets or take a loan.');
    const max = Math.max(1, ...Object.values(flow.income).map(Math.abs), ...Object.values(flow.expense).map(Math.abs));
    this.fillFlow(this.incomeList, flow.income, max, 'good');
    this.fillFlow(this.expenseList, flow.expense, max, 'bad');
  }

  private fillFlow(list: HTMLElement, rec: Record<string, number>, max: number, kind: 'good' | 'bad'): void {
    const entries = Object.entries(rec).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => b[1] - a[1]);
    const sig = entries.map(([k]) => k).join('|');
    if (!entries.length) {
      if (list.dataset.sig !== '') {
        list.dataset.sig = '';
        list.replaceChildren(h('div', { class: 'hud-flow-empty' }, this.source === 'last' ? 'No closed month yet.' : 'Nothing yet.'));
      }
      return;
    }
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.replaceChildren(...entries.map(([k]) => h('div', { class: 'hud-flow-row', 'data-k': k },
        h('div', { class: 'hud-flow-line' }, h('span', null, flowLabel(k, kind === 'bad')), h('b', { class: kind })),
        h('div', { class: 'hud-meter ' + kind }, h('span', { class: 'hud-meter-fill' })))));
    }
    for (const [k, v] of entries) {
      const row = list.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`);
      if (!row) continue;
      setText(row.querySelector('b')!, formatMoney(v));
      (row.querySelector('.hud-meter-fill') as HTMLElement).style.width = `${((Math.abs(v) / max) * 100).toFixed(1)}%`;
    }
  }

  private refreshTaxes(): void {
    const w = this.ctx.world();
    if (!w) return;
    if (this.dirtyProj) {
      try {
        this.proj = this.ctx.game.sim.projection() ?? this.proj;
      } catch {
        /* keep last */
      }
      this.dirtyProj = false;
    }
    let total = 0;
    for (const t of TAXES) {
      const s = this.taxSliders.get(t.id)!;
      const rate = w.economy.taxes[t.id] ?? 0;
      s.set(Math.round(rate * 100));
      const income = this.proj.income[t.id] ?? w.economy.lastIncome['taxes:' + t.id] ?? 0;
      total += income;
      const r = Math.round(rate * 100);
      const mood = r > 20 ? ' · residents furious' : r > 12 ? ' · slows demand' : r < 5 ? ' · very attractive' : '';
      s.setSub(`${income ? '+' + formatMoney(income, income >= 100_000) + '/mo' : ''}${mood}`, r > 20 ? 'bad' : r > 12 ? 'warn' : r < 5 ? 'good' : '');
    }
    setText(this.taxTotal, `${formatMoney(total)}/month`);
  }

  private refreshServices(): void {
    const w = this.ctx.world();
    if (!w) return;
    if (this.dirtyProj) {
      try {
        this.proj = this.ctx.game.sim.projection() ?? this.proj;
      } catch {
        /* keep last */
      }
      this.dirtyProj = false;
    }
    for (const b of BUDGETS) {
      const s = this.budgetSliders.get(b.id)!;
      const v = w.economy.budgets[b.id] ?? 1;
      s.set(Math.round(v * 100));
      const cost = this.proj.expense[b.id] ?? w.economy.lastExpense['upkeep:' + b.id] ?? 0;
      const eff = v < 1 ? 'reduced coverage' : v > 1.25 ? 'max effort' : v > 1 ? 'boosted' : 'normal';
      s.setSub(`${cost ? formatMoney(cost, cost >= 100_000) + '/mo · ' : ''}${eff}`, v < 0.8 ? 'warn' : v > 1 ? 'good' : '');
    }
  }

  private refreshLoans(): void {
    const w = this.ctx.world();
    if (!w) return;
    const e = w.economy;
    const tiers = loanTiers();
    const max = maxLoans();
    const sig = `${e.loans.map((l) => `${l.id}:${Math.round(l.remaining)}`).join(',')}|${w.milestone}|${Math.floor(e.money / 1000)}|${w.creative}`;
    if (sig === this.loanSig) return;
    this.loanSig = sig;
    if (!e.loans.length) this.loansActive.replaceChildren(emptyState('🏦', 'No loans', 'Borrow to fund big projects early. Interest is charged monthly.'));
    else this.loansActive.replaceChildren(...e.loans.map((l) => {
      const paid = 1 - l.remaining / Math.max(1, l.amount);
      const repay = h('button', { class: 'btn', onclick: () => {
        if (this.ctx.game.sim.repayLoan(l.id)) {
          this.ctx.sfx('money');
          this.ctx.ui.toast(`Loan repaid — ${formatMoney(l.remaining)}`, 'good');
        } else {
          this.ctx.sfx('error');
          this.ctx.ui.toast('Not enough money to repay this loan', 'warning');
        }
        this.loanSig = '';
        this.refresh();
      } }, `Repay ${formatMoney(l.remaining, l.remaining >= 100_000)}`);
      if (!w.creative && e.money < l.remaining) repay.classList.add('disabled');
      return h('div', { class: 'hud-loan' },
        h('div', { class: 'hud-loan-top' },
          h('div', null, h('div', { class: 'hud-loan-amt' }, formatMoney(l.amount)), h('div', { class: 'dim' }, `${formatPercent(l.rate, 1)} APR · ${formatMoney(l.payment)}/month`)),
          repay),
        h('div', { class: 'hud-meter good' }, h('span', { class: 'hud-meter-fill', style: `width:${(paid * 100).toFixed(1)}%` })),
        h('div', { class: 'hud-loan-foot dim' }, h('span', null, `${formatPercent(paid)} repaid`), h('span', null, `${formatMoney(l.remaining)} remaining`)));
    }));
    const full = e.loans.length >= max;
    this.loansTiers.replaceChildren(...tiers.map((t) => {
      const locked = !w.isUnlocked(t.unlock);
      const pay = loanPayment(t.amount, t.rate, t.years);
      const take = h('button', { class: 'btn primary', onclick: () => {
        if (this.ctx.game.sim.takeLoan(t.amount, t.years)) {
          this.ctx.sfx('money');
          this.ctx.ui.toast(`Loan of ${formatMoney(t.amount)} approved`, 'good');
        } else {
          this.ctx.sfx('error');
          this.ctx.ui.toast('The bank declined this loan', 'warning');
        }
        this.loanSig = '';
        this.refresh();
      } }, 'Borrow');
      if (locked || full) take.classList.add('disabled');
      return h('div', { class: 'hud-tier' + (locked ? ' locked' : '') },
        h('div', { class: 'hud-tier-amt' }, formatMoney(t.amount, t.amount >= 1e6)),
        h('div', { class: 'hud-tier-rows' },
          h('span', null, 'Term', h('b', null, `${t.years} years`)),
          h('span', null, 'Interest', h('b', null, formatPercent(t.rate, 1))),
          h('span', null, 'Payment', h('b', null, `${formatMoney(pay)}/mo`))),
        locked ? h('div', { class: 'hud-tier-lock' }, icon('lock', 12), milestoneLabel(t.unlock)) : full ? h('div', { class: 'hud-tier-lock' }, `Max ${max} loans`) : take);
    }));
  }
}
