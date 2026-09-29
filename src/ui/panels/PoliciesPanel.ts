// Policies: city-wide or per-district toggles with live monthly cost.
import { h } from '../dom';
import { formatMoney } from '../../core/util';
import type { PolicyDef } from '../../core/types';
import { POLICIES, POLICY_CATEGORY_NAMES, type PolicyInfo } from '../../data/policies';
import { Panel } from './Panel';
import { Tabs, toggle } from './widgets';
import { setClass, setText, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';
import { unlockText } from '../hud/catalog';

type Cat = PolicyDef['category'] | 'all' | 'active';

interface CardRef {
  p: PolicyInfo;
  el: HTMLElement;
  sw: ReturnType<typeof toggle>;
  cost: HTMLElement;
}

export class PoliciesPanel extends Panel {
  private cat: Cat = 'all';
  private scope = 0; // 0 = city-wide, else district id
  private tabs!: Tabs<Cat>;
  private grid!: HTMLElement;
  private scopeSel!: HTMLSelectElement;
  private scopeNote!: HTMLElement;
  private cards: CardRef[] = [];
  private districtPop = 0;
  private popAcc = 10;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'policies', title: 'Policies', icon: 'policy', width: 860, anchor: 'center', key: 'ui.policies', rate: 2, cls: 'hud-panel-policies' });
  }

  /** open scoped to a district (0 = city-wide) */
  setScope(districtId: number): void {
    this.scope = districtId;
    if (this.scopeSel) {
      this.fillScopes();
      this.render();
    }
  }

  protected build(body: HTMLElement): void {
    const cats = Object.keys(POLICY_CATEGORY_NAMES) as PolicyDef['category'][];
    this.tabs = new Tabs<Cat>([
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Enacted' },
      ...cats.filter((c) => POLICIES.some((p) => p.category === c)).map((c) => ({ id: c as Cat, label: POLICY_CATEGORY_NAMES[c] })),
    ], this.cat, (c) => {
      this.cat = c;
      this.render();
    }, 'hud-tabs-sm');
    this.scopeSel = h('select', { class: 'hud-select', 'aria-label': 'Policy scope' });
    this.scopeSel.addEventListener('change', () => {
      this.scope = Number(this.scopeSel.value);
      this.popAcc = 10;
      this.render();
      this.ctx.sfx('click', 0.5);
    });
    this.scopeNote = h('span', { class: 'hud-scope-note' });
    this.toolsEl.append(this.tabs.el);
    this.grid = h('div', { class: 'hud-policy-grid' });
    body.append(
      h('div', { class: 'hud-scope' }, h('span', { class: 'hud-scope-label' }, icon('map', 14), 'Apply to'), this.scopeSel, this.scopeNote),
      this.grid);
  }

  protected override onOpen(): void {
    this.fillScopes();
    this.render();
    this.tabs.placeIndicator();
  }

  override reset(): void {
    this.scope = 0;
  }

  private fillScopes(): void {
    const w = this.ctx.world();
    const opts: [number, string][] = [[0, 'Entire city']];
    for (const d of w?.districts ?? []) opts.push([d.id, d.name]);
    if (!opts.some(([id]) => id === this.scope)) this.scope = 0;
    this.scopeSel.replaceChildren(...opts.map(([id, name]) => h('option', { value: String(id), selected: id === this.scope }, id ? `District · ${name}` : name)));
    this.scopeSel.value = String(this.scope);
  }

  private render(): void {
    const w = this.ctx.world();
    if (!w || !this.grid) return;
    const list = POLICIES.filter((p) => this.cat === 'all' || (this.cat === 'active' ? this.isActive(p) : p.category === this.cat));
    this.cards = [];
    const frag = document.createDocumentFragment();
    for (const p of list) {
      const locked = !w.isUnlocked(p.unlock, p.id);
      const districtBlocked = this.scope > 0 && !p.districtLevel;
      const sw = toggle(this.isActive(p), () => this.flip(p), p.name);
      const cost = h('span', { class: 'hud-policy-cost' });
      const el = h('div', { class: 'hud-policy' + (locked ? ' locked' : '') + (districtBlocked ? ' blocked' : '') },
        h('div', { class: 'hud-policy-head' },
          h('span', { class: 'hud-policy-icon' }, p.icon),
          h('div', { class: 'hud-policy-titles' }, h('b', null, p.name), h('span', null, POLICY_CATEGORY_NAMES[p.category] + (p.districtLevel ? ' · district-ready' : ' · city-wide only'))),
          sw.el),
        h('p', { class: 'hud-policy-desc' }, p.description),
        p.details?.length ? h('ul', { class: 'hud-policy-fx' }, p.details.map((d) => h('li', { class: /^[−-]/.test(d) && !/cost|risk|garbage|pollution|crime|noise/i.test(d) ? 'neg' : '' }, d))) : null,
        h('div', { class: 'hud-policy-foot' },
          cost,
          locked ? h('span', { class: 'hud-policy-lock' }, icon('lock', 12), unlockText(p.unlock)) : districtBlocked ? h('span', { class: 'hud-policy-lock' }, 'City-wide only') : null));
      if (locked || districtBlocked) sw.setDisabled(true);
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.hud-switch')) return;
        if (!locked && !districtBlocked) this.flip(p);
      });
      this.cards.push({ p, el, sw, cost });
      frag.appendChild(el);
    }
    if (!list.length) frag.appendChild(h('div', { class: 'hud-flow-empty' }, this.cat === 'active' ? 'No policies enacted yet.' : 'No policies in this category.'));
    this.grid.replaceChildren(frag);
    this.refresh();
  }

  private isActive(p: PolicyInfo): boolean {
    const w = this.ctx.world();
    if (!w) return false;
    try {
      return this.ctx.game.sim.isPolicyActive(p.id, this.scope || undefined);
    } catch {
      return this.scope ? !!w.districts.find((d) => d.id === this.scope)?.policies.includes(p.id) : w.policies.includes(p.id);
    }
  }

  private flip(p: PolicyInfo): void {
    const w = this.ctx.world();
    if (!w) return;
    if (!w.isUnlocked(p.unlock, p.id)) {
      this.ctx.sfx('error');
      return;
    }
    const before = this.isActive(p);
    this.ctx.game.sim.togglePolicy(p.id, this.scope || undefined);
    const after = this.isActive(p);
    if (before === after) {
      this.ctx.sfx('error');
      this.ctx.ui.toast(`Could not ${before ? 'repeal' : 'enact'} ${p.name}`, 'warning');
    } else {
      this.ctx.sfx(after ? 'money' : 'click', 0.7);
    }
    if (this.cat === 'active') this.render();
    else this.refresh();
  }

  private scopePopulation(): number {
    const w = this.ctx.world();
    if (!w) return 0;
    if (!this.scope) return w.stats.population;
    this.popAcc += 0.5;
    if (this.popAcc >= 3) {
      this.popAcc = 0;
      let pop = 0;
      for (const b of w.buildings.values()) if (w.district[w.idx(b.x, b.y)] === this.scope) pop += b.residents;
      this.districtPop = pop;
    }
    return this.districtPop;
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.grid) return;
    const pop = this.scopePopulation();
    let active = 0, total = 0;
    for (const c of this.cards) {
      const on = this.isActive(c.p);
      c.sw.set(on);
      setClass(c.el, 'on', on);
      const monthly = (c.p.costPer1000 * pop) / 1000 + (c.p.flatCost ?? 0);
      setText(c.cost, `${formatMoney(monthly, monthly >= 100_000)}/month${on ? '' : ' if enacted'}`);
    }
    for (const p of POLICIES) if (this.isActive(p)) {
      active++;
      total += (p.costPer1000 * pop) / 1000 + (p.flatCost ?? 0);
    }
    const scopeName = this.scope ? w.districts.find((d) => d.id === this.scope)?.name ?? 'District' : 'City-wide';
    this.setSubtitle(`${scopeName} · ${active} enacted · ${formatMoney(total)}/month`);
    const note = this.scope ? `${pop.toLocaleString('en-US')} residents in this district` : 'Some policies can also be set per district';
    setText(this.scopeNote, note);
  }
}
