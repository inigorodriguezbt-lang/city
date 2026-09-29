// New-city tutorial checklist (settings.ui.tutorial) with steps detected from
// the world state, plus the advisor bubble (settings.gameplay.advisor) that
// points out what the city needs next.
import { h } from '../dom';
import { formatNumber } from '../../core/util';
import { Layer, RoadType, type Building, type Rect } from '../../core/types';
import { buildingDef } from '../../data/buildings';
import { zoneDef } from '../../data/zones';
import type { World } from '../../world/World';
import type { PanelId } from '../UIManager';
import { icon } from './icons';
import type { CatId } from './catalog';
import { hudState, setClass, setText, type HudContext } from './context';

type StepId = 'road' | 'res' | 'com' | 'ind' | 'power' | 'water' | 'sewage' | 'pop';

interface StepDef {
  id: StepId;
  title: string;
  text: string;
  open?: CatId;
}

const STEPS: StepDef[] = [
  { id: 'road', title: 'Connect a road to the highway', text: 'Drag a street from the highway exit into open land.', open: 'roads' },
  { id: 'res', title: 'Zone residential', text: 'Paint green homes along your new streets.', open: 'zoning' },
  { id: 'com', title: 'Zone commercial', text: 'Shops give residents jobs and somewhere to spend.', open: 'zoning' },
  { id: 'ind', title: 'Zone industry', text: 'Factories produce goods — keep them away from homes.', open: 'zoning' },
  { id: 'power', title: 'Build a power plant', text: 'Electricity flows along your roads.', open: 'power' },
  { id: 'water', title: 'Pump fresh water', text: 'Place a water pump on a shoreline.', open: 'water' },
  { id: 'sewage', title: 'Add a sewage outlet', text: 'Downstream from your pump, please.', open: 'water' },
  { id: 'pop', title: 'Reach 300 citizens', text: 'Hamlet status unlocks new services.' },
];

interface Tip {
  id: string;
  icon: string;
  text: string;
  action?: { label: string; cat?: CatId; panel?: PanelId };
  kind: 'bad' | 'warn' | 'info';
}

export class Tutorial {
  readonly el: HTMLElement;
  readonly advisorEl: HTMLElement;
  private list: HTMLElement;
  private progress: HTMLElement;
  private count: HTMLElement;
  private rows = new Map<StepId, HTMLElement>();
  private done = new Set<StepId>();
  private world: World | null = null;
  private active = false;
  private collapsed = false;
  private acc = 0;
  private advAcc = 2;
  private tip: Tip | null = null;
  private muted = new Map<string, number>();
  private advIcon: HTMLElement;
  private advText: HTMLElement;
  private advAction: HTMLButtonElement;
  private finishTimer = 0;

  constructor(private ctx: HudContext) {
    this.progress = h('span', { class: 'hud-guide-fill' });
    this.count = h('span', { class: 'hud-guide-count' });
    this.list = h('ol', { class: 'hud-guide-list' });
    for (const s of STEPS) {
      const show = s.open ? h('button', { class: 'hud-guide-go', onclick: () => this.showMe(s) }, 'Show me', icon('chevronRight', 12)) : null;
      const row = h('li', { class: 'hud-guide-step', 'data-step': s.id },
        h('span', { class: 'hud-guide-check' }, icon('check', 12)),
        h('div', { class: 'hud-guide-txt' }, h('b', null, s.title), h('span', null, s.text)),
        show);
      this.rows.set(s.id, row);
      this.list.appendChild(row);
    }
    const collapse = h('button', { class: 'hud-guide-btn', 'aria-label': 'Collapse', onclick: () => this.setCollapsed(!this.collapsed) }, icon('chevronUp', 15));
    const dismiss = h('button', { class: 'hud-guide-btn', 'aria-label': 'Dismiss tutorial', onclick: () => this.dismiss() }, icon('close', 15));
    ctx.tips.attach(collapse, 'Collapse / expand');
    ctx.tips.attach(dismiss, 'Hide the tutorial (re-enable it in Options → Interface)');
    this.el = h('div', { class: 'hud-guide hud-pe', 'aria-label': 'Getting started' },
      h('div', { class: 'hud-guide-head', onclick: (e: Event) => { if (!(e.target as HTMLElement).closest('button')) this.setCollapsed(!this.collapsed); } },
        h('span', { class: 'hud-guide-badge' }, icon('flag', 14)),
        h('div', { class: 'hud-guide-titles' }, h('b', null, 'Getting started'), this.count),
        collapse, dismiss),
      h('div', { class: 'hud-guide-bar' }, this.progress),
      this.list);

    this.advIcon = h('span', { class: 'hud-adv-icon' });
    this.advText = h('span', { class: 'hud-adv-text' });
    this.advAction = h('button', { class: 'hud-adv-go' });
    const advClose = h('button', { class: 'hud-adv-x', 'aria-label': 'Dismiss tip', onclick: () => this.muteTip() }, icon('close', 13));
    this.advisorEl = h('div', { class: 'hud-advisor hud-pe', role: 'status' },
      h('span', { class: 'hud-adv-who' }, icon('sparkle', 13), 'Advisor'),
      h('div', { class: 'hud-adv-body' }, this.advIcon, this.advText),
      h('div', { class: 'hud-adv-foot' }, this.advAction, advClose));

    ctx.game.events.on('world:changed', ({ rect, layers }) => {
      if (!this.active || !this.world) return;
      if (layers & Layer.Road) this.scanRoads(rect);
      if (layers & Layer.Zone) this.scanZones(rect);
    });
    ctx.game.events.on('building:added', (b) => this.active && this.checkBuilding(b));
  }

  attach(world: World | null): void {
    this.world = world;
    this.done.clear();
    this.tip = null;
    this.muted.clear();
    window.clearTimeout(this.finishTimer);
    this.el.classList.remove('finished');
    setClass(this.advisorEl, 'show', false);
    if (!world) {
      this.active = false;
      this.render();
      return;
    }
    const st = hudState(world);
    for (const id of st.tutorialDone ?? []) this.done.add(id as StepId);
    // only new-ish cities get the checklist (or ones that already started it)
    const fresh = world.stats.population < 300 || (st.tutorialDone?.length ?? 0) > 0;
    this.active = !st.tutorialDismissed && fresh && this.done.size < STEPS.length;
    if (this.active) {
      this.scanRoads({ x0: 0, y0: 0, x1: world.size - 1, y1: world.size - 1 });
      this.scanZones({ x0: 0, y0: 0, x1: world.size - 1, y1: world.size - 1 });
      for (const b of world.buildings.values()) this.checkBuilding(b);
    }
    this.render();
  }

  update(dt: number): void {
    const w = this.world;
    if (!w) return;
    this.acc += dt;
    if (this.active && this.acc > 0.5) {
      this.acc = 0;
      if (w.stats.population >= 300) this.complete('pop');
    }
    this.advAcc += dt;
    if (this.advAcc > 3) {
      this.advAcc = 0;
      this.evaluateAdvisor();
    }
  }

  /** settings changed: re-evaluate visibility */
  refreshVisibility(): void {
    this.render();
    this.evaluateAdvisor();
  }

  // ── detection ──────────────────────────────────────────────────────────
  private scanRoads(r: Rect): void {
    const w = this.world;
    if (!w || this.done.has('road')) return;
    const x0 = Math.max(0, r.x0 - 1), y0 = Math.max(0, r.y0 - 1), x1 = Math.min(w.size - 1, r.x1 + 1), y1 = Math.min(w.size - 1, r.y1 + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const t = w.road[y * w.size + x];
        if (!t || t === RoadType.Highway || t === RoadType.Rail) continue;
        if (w.roadAt(x + 1, y) === RoadType.Highway || w.roadAt(x - 1, y) === RoadType.Highway || w.roadAt(x, y + 1) === RoadType.Highway || w.roadAt(x, y - 1) === RoadType.Highway) {
          this.complete('road');
          return;
        }
      }
  }

  private scanZones(r: Rect): void {
    const w = this.world;
    if (!w || (this.done.has('res') && this.done.has('com') && this.done.has('ind'))) return;
    for (let y = Math.max(0, r.y0); y <= Math.min(w.size - 1, r.y1); y++)
      for (let x = Math.max(0, r.x0); x <= Math.min(w.size - 1, r.x1); x++) {
        const z = w.zone[y * w.size + x];
        if (!z) continue;
        const cat = zoneDef(z)?.category;
        if (cat === 'res') this.complete('res');
        else if (cat === 'com' || cat === 'off') this.complete('com');
        else if (cat === 'ind') this.complete('ind');
      }
  }

  private checkBuilding(b: Building): void {
    if (b.kind !== 'service') return;
    const d = buildingDef(b.defId);
    if (!d) return;
    if ((d.power ?? 0) > 0) this.complete('power');
    if ((d.water ?? 0) > 0) this.complete('water');
    if ((d.sewage ?? 0) > 0) this.complete('sewage');
  }

  private complete(id: StepId): void {
    if (this.done.has(id) || !this.world) return;
    this.done.add(id);
    const st = hudState(this.world);
    st.tutorialDone = [...this.done];
    if (this.active) {
      this.ctx.sfx('money', 0.5);
      const row = this.rows.get(id);
      row?.classList.add('just');
      window.setTimeout(() => row?.classList.remove('just'), 1200);
    }
    this.render();
    if (this.done.size >= STEPS.length && this.active) {
      this.el.classList.add('finished');
      setText(this.count, 'All done — your city is on its way!');
      this.finishTimer = window.setTimeout(() => {
        if (this.world) hudState(this.world).tutorialDismissed = true;
        this.active = false;
        this.render();
      }, 6000);
    }
  }

  // ── rendering ──────────────────────────────────────────────────────────
  private render(): void {
    const on = this.active && this.ctx.game.settings.value.ui.tutorial;
    setClass(this.el, 'show', on);
    if (!on) return;
    const n = this.done.size;
    this.progress.style.width = `${((n / STEPS.length) * 100).toFixed(1)}%`;
    if (n < STEPS.length) setText(this.count, `${n} of ${STEPS.length} complete`);
    let firstOpen = true;
    for (const s of STEPS) {
      const row = this.rows.get(s.id)!;
      const d = this.done.has(s.id);
      setClass(row, 'done', d);
      setClass(row, 'current', !d && firstOpen);
      if (!d) firstOpen = false;
    }
    setClass(this.el, 'collapsed', this.collapsed);
  }

  private setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.ctx.sfx('click', 0.5);
    this.render();
  }

  private dismiss(): void {
    if (this.world) hudState(this.world).tutorialDismissed = true;
    this.active = false;
    this.ctx.sfx('close', 0.6);
    this.render();
  }

  private showMe(s: StepDef): void {
    if (s.open) this.ctx.ui.toolbar.open(s.open);
    if (s.id === 'road') {
      const w = this.world;
      const hw = w ? this.findHighwayEnd(w) : null;
      if (hw) this.ctx.flyTo(hw.x + 0.5, hw.y + 0.5, 420);
    }
  }

  /** a highway cell deep inside the map (where players usually branch off) */
  private findHighwayEnd(w: World): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = -1;
    const s = w.size;
    for (let y = 0; y < s; y += 2)
      for (let x = 0; x < s; x += 2) {
        if (w.road[y * s + x] !== RoadType.Highway) continue;
        const d = Math.min(x, y, s - 1 - x, s - 1 - y);
        if (d > bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best;
  }

  // ── advisor ────────────────────────────────────────────────────────────
  private evaluateAdvisor(): void {
    const w = this.world;
    const s = this.ctx.game.settings.value;
    if (!w || !s.gameplay.advisor || w.stats.population < 40 || (this.active && s.ui.tutorial && this.done.size < 5)) {
      this.tip = null;
      setClass(this.advisorEl, 'show', false);
      return;
    }
    const now = performance.now();
    const tips = this.tips(w).filter((t) => (this.muted.get(t.id) ?? 0) < now);
    const t = tips[0] ?? null;
    if (t?.id !== this.tip?.id || t?.text !== this.tip?.text) {
      this.tip = t;
      if (t) {
        setText(this.advIcon, t.icon);
        setText(this.advText, t.text);
        this.advisorEl.dataset.kind = t.kind;
        if (t.action) {
          this.advAction.style.display = '';
          this.advAction.replaceChildren(h('span', null, t.action.label), icon('chevronRight', 12));
          this.advAction.onclick = () => {
            if (t.action?.cat) this.ctx.ui.toolbar.open(t.action.cat);
            if (t.action?.panel) this.ctx.ui.openPanel(t.action.panel);
          };
        } else this.advAction.style.display = 'none';
      }
    }
    setClass(this.advisorEl, 'show', !!t && !this.ctx.ui.isPhotoMode());
  }

  private muteTip(): void {
    if (this.tip) this.muted.set(this.tip.id, performance.now() + 5 * 60_000);
    this.tip = null;
    setClass(this.advisorEl, 'show', false);
    this.ctx.sfx('close', 0.5);
  }

  private tips(w: World): Tip[] {
    const st = w.stats;
    const out: Tip[] = [];
    const pct = (a: number, b: number) => (b > 0 ? a / b : 0);
    if (!w.creative && w.economy.money < 0) out.push({ id: 'debt', icon: '💸', kind: 'bad', text: 'The city is in debt. Raise taxes, trim budgets or take a loan before construction is frozen.', action: { label: 'Open budget', panel: 'budget' } });
    if (st.power.consumed > st.power.produced * 1.001 && st.power.consumed > 0) out.push({ id: 'power', icon: '⚡', kind: 'bad', text: `Blackouts! Demand is ${formatNumber(st.power.consumed)} MW but plants only make ${formatNumber(st.power.produced)} MW.`, action: { label: 'Build power', cat: 'power' } });
    if (st.water.consumed > st.water.produced * 1.001 && st.water.consumed > 0) out.push({ id: 'water', icon: '💧', kind: 'bad', text: `Taps are running dry — ${formatNumber(st.water.consumed)} m³ needed, ${formatNumber(st.water.produced)} m³ pumped.`, action: { label: 'Build water', cat: 'water' } });
    if (st.sewage.produced > st.sewage.capacity * 1.001 && st.sewage.produced > 0) out.push({ id: 'sewage', icon: '🚽', kind: 'bad', text: 'Sewage is backing up. Add outlets or a treatment plant.', action: { label: 'Build sewage', cat: 'water' } });
    if (st.garbage.capacity > 0 ? st.garbage.stored > st.garbage.capacity * 0.9 : st.population > 1500) out.push({ id: 'garbage', icon: '🗑️', kind: 'warn', text: 'Garbage is piling up in the streets. Build a landfill or incinerator.', action: { label: 'Garbage', cat: 'garbage' } });
    if (st.health_.sick > st.health_.capacity && st.population > 800) out.push({ id: 'health', icon: '🏥', kind: 'warn', text: `${formatNumber(st.health_.sick)} citizens are sick but clinics can treat ${formatNumber(st.health_.capacity)}.`, action: { label: 'Healthcare', cat: 'health' } });
    if (st.deathcare.dead > st.deathcare.capacity && st.population > 1500) out.push({ id: 'dead', icon: '⚱️', kind: 'warn', text: 'The departed are not being collected. Build a cemetery.', action: { label: 'Deathcare', cat: 'health' } });
    if (st.education_.students > st.education_.capacity * 1.1 && st.population > 1200) out.push({ id: 'edu', icon: '🎓', kind: 'warn', text: 'Schools are overcrowded. More schools mean a smarter workforce.', action: { label: 'Education', cat: 'education' } });
    const unemp = pct(st.unemployed, st.workforce);
    if (unemp > 0.12 && st.workforce > 200) out.push({ id: 'unemp', icon: '💼', kind: 'warn', text: `Unemployment is ${(unemp * 100).toFixed(0)}%. Zone commercial, industry or offices to create jobs.`, action: { label: 'Zoning', cat: 'zoning' } });
    if (st.crimeRate > 50 && st.population > 1000) out.push({ id: 'crime', icon: '🚓', kind: 'warn', text: 'Crime is rising. Police stations keep neighbourhoods safe.', action: { label: 'Police', cat: 'police' } });
    if (st.trafficFlow < 55 && st.population > 2000) out.push({ id: 'traffic', icon: '🚦', kind: 'warn', text: `Traffic flow is down to ${Math.round(st.trafficFlow)}%. Upgrade roads or add public transport.`, action: { label: 'Transit', cat: 'transit' } });
    if (st.pollution > 55) out.push({ id: 'pollution', icon: '☣️', kind: 'warn', text: 'Pollution is making people sick. Separate industry from homes and plant trees.', action: { label: 'Info view', panel: 'overlays' } });
    if (st.happiness < 40 && st.population > 500) out.push({ id: 'happy', icon: '😟', kind: 'warn', text: 'Citizens are unhappy. Parks, services and lower taxes help.', action: { label: 'Parks', cat: 'parks' } });
    const d = st.demand;
    if (d.res > 0.6) out.push({ id: 'dres', icon: '🏡', kind: 'info', text: 'People want to move in! Zone more residential land.', action: { label: 'Zone homes', cat: 'zoning' } });
    else if (d.com > 0.6) out.push({ id: 'dcom', icon: '🏪', kind: 'info', text: 'Residents need more shops. Zone commercial areas.', action: { label: 'Zone shops', cat: 'zoning' } });
    else if (d.ind > 0.6) out.push({ id: 'dind', icon: '🏭', kind: 'info', text: 'Businesses want to build factories. Zone industry.', action: { label: 'Zone industry', cat: 'zoning' } });
    else if (d.off > 0.6) out.push({ id: 'doff', icon: '🏙️', kind: 'info', text: 'Educated workers are looking for office jobs.', action: { label: 'Zone offices', cat: 'zoning' } });
    return out;
  }
}
