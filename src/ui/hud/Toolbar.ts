// Bottom dock: tool hint bar, flyout palette of cards and the category toolbar.
// Cards are generated from the data catalogs (see ./catalog.ts); clicking a
// card activates the matching tool through game.tools.setTool(...).
import { h } from '../dom';
import { formatMoney } from '../../core/util';
import { CATEGORY_INFO } from '../../data/buildings';
import { MILESTONES } from '../../data/milestones';
import type { BuildingCategory } from '../../core/types';
import { icon, type IconName } from './icons';
import { richTip } from './Tooltip';
import { Tabs } from '../panels/widgets';
import { setClass, setText, type HudContext } from './context';
import {
  CATEGORIES, SERVICE_CYCLE, allItems, catOfTool, categoryDef, isItemActive, isItemUnlocked, milestoneLabel, tabsFor, toolLabel, unlockText,
  type CatId, type CatalogActions, type PaletteItem, type PaletteTab,
} from './catalog';

type ZoneMode = 'brush' | 'rect' | 'fill';

const ZONE_MODES: { id: ZoneMode; label: string; icon: IconName; tip: string }[] = [
  { id: 'brush', label: 'Brush', icon: 'brush', tip: 'Paint zones with a round brush · [ ] changes the size' },
  { id: 'rect', label: 'Rectangle', icon: 'rect', tip: 'Drag a rectangle to zone every free cell inside' },
  { id: 'fill', label: 'Fill', icon: 'fill', tip: 'Flood-fill a connected area bounded by roads' },
];

const CAT_TIPS: Partial<Record<CatId, string>> = {
  roads: 'Streets, avenues, highways and railways. Everything starts with a road.',
  zoning: 'Mark land for homes, shops, offices and industry. Buildings grow on their own.',
  districts: 'Name neighbourhoods and give them their own policies, style and specialisation.',
  terrain: 'Sculpt the land and plant trees and forests.',
  bulldoze: 'Demolish roads, buildings and zones. Drag to clear an area.',
  transit: 'Draw bus, tram, metro and train lines, and build stations and ports.',
};

const TOOL_KEYS: Record<string, [string, string][]> = {
  road: [['Shift', 'straight'], ['Ctrl', 'auto-path'], ['Alt', 'replace']],
  zone: [['[ ]', 'brush size'], ['Right-drag', 'dezone']],
  place: [['R', 'rotate']],
  move: [['R', 'rotate']],
  bulldoze: [['Drag', 'area']],
  terraform: [['[ ]', 'brush size']],
  trees: [['[ ]', 'brush size']],
  district: [['[ ]', 'brush size']],
  transit: [['Right-click', 'undo stop']],
};

const BAD_HINT = /not enough|blocked|cannot|can't|too steep|invalid|requires|needs|must |no road|occupied|out of|unavailable|locked|✖|⚠/i;

interface CardRef {
  item: PaletteItem;
  el: HTMLButtonElement;
  cost?: HTMLElement;
}

export class Toolbar {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private scroller: HTMLElement;
  private flyout: HTMLElement;
  private flyTitle: HTMLElement;
  private flyIcon: HTMLElement;
  private flyTools: HTMLElement;
  private cardsEl: HTMLElement;
  private tabs: Tabs<string>;
  private hintEl: HTMLElement;
  private hintIcon: HTMLElement;
  private hintName: HTMLElement;
  private hintText: HTMLElement;
  private hintKeys: HTMLElement;
  private btns = new Map<CatId, HTMLButtonElement>();
  private cards: CardRef[] = [];
  private tabsByCat = new Map<CatId, PaletteTab[]>();
  private tabSel = new Map<CatId, string>();
  private zoneMode: ZoneMode = 'brush';
  private zoneModeBtns = new Map<ZoneMode, HTMLButtonElement>();
  private lastHint = '\u0000';
  private lastToolKey = '\u0000';
  private moneyAcc = 0;
  private knownUnlocked = new Set<string>();
  private fresh = new Set<CatId>();
  openCat: CatId | null = null;
  readonly actions: CatalogActions;

  constructor(private ctx: HudContext) {
    this.actions = {
      openPanel: (id) => ctx.ui.openPanel(id),
      newDistrict: () => void this.newDistrict(),
    };

    // ── hint bar ─────────────────────────────────────────────────────────
    this.hintIcon = h('span', { class: 'hud-hint-icon' });
    this.hintName = h('span', { class: 'hud-hint-name' });
    this.hintText = h('span', { class: 'hud-hint-text' });
    this.hintKeys = h('span', { class: 'hud-hint-keys' });
    const cancel = h('button', { class: 'hud-hint-x', 'aria-label': 'Cancel tool', onclick: () => ctx.game.tools.cancel() }, icon('close', 14));
    ctx.tips.attach(cancel, 'Cancel tool', { key: 'Esc' });
    this.hintEl = h('div', { class: 'hud-hint hud-pe', role: 'status', 'aria-live': 'polite' },
      this.hintIcon, this.hintName, this.hintText, this.hintKeys, cancel);

    // ── flyout ───────────────────────────────────────────────────────────
    this.flyIcon = h('span', { class: 'hud-fly-icon' });
    this.flyTitle = h('span', { class: 'hud-fly-title' });
    this.tabs = new Tabs<string>([], '', (id) => {
      if (this.openCat) this.tabSel.set(this.openCat, id);
      this.renderCards();
    }, 'hud-fly-tabs');
    this.flyTools = h('div', { class: 'hud-fly-tools' });
    const closeFly = h('button', { class: 'hud-fly-x', 'aria-label': 'Close palette', onclick: () => this.close() }, icon('close', 16));
    ctx.tips.attach(closeFly, 'Close palette', { key: 'Esc' });
    this.cardsEl = h('div', { class: 'hud-cards' });
    this.cardsEl.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && this.cardsEl.scrollWidth > this.cardsEl.clientWidth) {
        this.cardsEl.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    this.flyout = h('div', { class: 'hud-flyout hud-pe', role: 'dialog', 'aria-label': 'Build palette' },
      h('div', { class: 'hud-fly-head' },
        h('div', { class: 'hud-fly-name' }, this.flyIcon, this.flyTitle),
        this.tabs.el,
        h('div', { class: 'hud-fly-spacer' }),
        this.flyTools,
        closeFly),
      this.cardsEl);

    // zoning mode chips (inserted into flyTools for the zoning category)
    for (const m of ZONE_MODES) {
      const b = h('button', { class: 'hud-chip-btn', onclick: () => this.setZoneMode(m.id) }, icon(m.icon, 15), h('span', null, m.label));
      ctx.tips.attach(b, m.tip);
      this.zoneModeBtns.set(m.id, b);
    }

    // ── toolbar ──────────────────────────────────────────────────────────
    this.scroller = h('div', { class: 'hud-tb-scroll' });
    let group = -1;
    for (const c of CATEGORIES) {
      if (group >= 0 && c.group !== group) this.scroller.appendChild(h('span', { class: 'hud-tb-sep' }));
      group = c.group;
      const b = h('button', { class: 'hud-tb-btn', style: `--c:${c.color}`, 'aria-label': c.label, 'data-cat': c.id },
        h('span', { class: 'hud-tb-icon' }, icon(c.icon, 22)),
        h('span', { class: 'hud-tb-label' }, c.short),
        h('span', { class: 'hud-tb-dot' }));
      b.onclick = () => this.onCategory(c.id);
      ctx.tips.attach(b, () => this.categoryTip(c.id), { rich: true, placement: 'top', key: () => (c.key ? ctx.key(c.key) : '') });
      this.btns.set(c.id, b);
      this.scroller.appendChild(b);
    }
    this.scroller.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && this.scroller.scrollWidth > this.scroller.clientWidth) {
        this.scroller.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    this.bar = h('nav', { class: 'hud-toolbar hud-pe', 'aria-label': 'Build tools' }, this.scroller);

    this.el = h('div', { class: 'hud-dock' }, this.hintEl, this.flyout, this.bar);

    ctx.game.events.on('tool:changed', () => this.onToolChanged());
    ctx.game.events.on('unlocks:changed', () => this.onUnlocks());
    ctx.game.events.on('creative:changed', () => this.onUnlocks());
    ctx.game.events.on('money:changed', () => (this.moneyAcc = 1));
  }

  // ── public ─────────────────────────────────────────────────────────────
  onWorld(): void {
    this.close();
    this.tabsByCat.clear();
    this.fresh.clear();
    this.knownUnlocked = this.unlockedKeys();
    for (const b of this.btns.values()) b.classList.remove('fresh');
    this.onToolChanged();
  }

  isOpen(): boolean {
    return this.openCat !== null;
  }

  /** open a toolbar category (bulldoze toggles the tool directly) */
  open(cat: CatId): void {
    if (!this.ctx.world()) return;
    if (cat === 'bulldoze') {
      this.close();
      const tools = this.ctx.game.tools;
      tools.setTool(tools.current?.id === 'bulldoze' ? null : 'bulldoze');
      this.ctx.sfx('click');
      return;
    }
    const was = this.openCat;
    this.openCat = cat;
    this.fresh.delete(cat);
    this.btns.get(cat)?.classList.remove('fresh');
    for (const [id, b] of this.btns) setClass(b, 'open', id === cat);
    this.buildFlyout(cat);
    this.flyout.classList.add('open');
    this.el.classList.add('fly-open');
    if (was !== cat) this.ctx.sfx('open', 0.55);
    this.btns.get(cat)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  close(): boolean {
    if (!this.openCat) return false;
    this.openCat = null;
    this.flyout.classList.remove('open');
    this.el.classList.remove('fly-open');
    for (const b of this.btns.values()) b.classList.remove('open');
    this.ctx.tips.hide();
    this.ctx.sfx('close', 0.45);
    return true;
  }

  toggle(cat: CatId): void {
    if (this.openCat === cat) this.close();
    else this.open(cat);
  }

  /** keyboard shortcut for the services menu: cycles through service categories */
  cycleServices(): void {
    const i = this.openCat ? SERVICE_CYCLE.indexOf(this.openCat) : -1;
    this.open(SERVICE_CYCLE[(i + 1) % SERVICE_CYCLE.length]);
  }

  /** activate a palette item (from cards or search) */
  select(it: PaletteItem): boolean {
    const w = this.ctx.world();
    if (!w) return false;
    if (!isItemUnlocked(w, it)) {
      this.ctx.sfx('error');
      this.ctx.ui.toast(`${it.name} is locked. ${unlockText(it.unlock)}.`, 'warning');
      return false;
    }
    if (it.action) {
      it.action();
      this.ctx.sfx('click');
      return true;
    }
    if (!it.tool) return false;
    const opts = it.kind === 'zone' ? { ...it.opts, mode: this.zoneMode } : it.opts;
    this.ctx.game.tools.setTool(it.tool, opts);
    this.ctx.sfx('click');
    return true;
  }

  /** every palette item (for search) */
  items(): PaletteItem[] {
    return allItems(this.ctx.world(), this.actions);
  }

  update(dt: number): void {
    // hint bar: poll every frame, touch the DOM only on change
    const tools = this.ctx.game.tools;
    const cur = tools.current;
    const toolKey = cur ? `${cur.id}|${safeJson(tools.currentOpts)}` : '';
    if (toolKey !== this.lastToolKey) {
      this.lastToolKey = toolKey;
      if (cur) {
        const lab = toolLabel(cur.id, tools.currentOpts);
        setText(this.hintIcon, lab.icon);
        setText(this.hintName, lab.name);
        this.hintKeys.replaceChildren(...[...(TOOL_KEYS[cur.id] ?? []), ['Esc', 'cancel'] as [string, string]].map(([k, t]) =>
          h('span', { class: 'hud-hint-key' }, h('kbd', { class: 'hud-kbd' }, k), t)));
      }
      setClass(this.hintEl, 'show', !!cur);
      setClass(this.el, 'tool-on', !!cur);
    }
    let hint = '';
    try {
      hint = cur ? tools.hint : '';
    } catch {
      hint = '';
    }
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      setText(this.hintText, hint);
      setClass(this.hintText, 'bad', BAD_HINT.test(hint));
      setClass(this.hintText, 'empty', !hint);
    }
    // affordability of visible cards (cheap, throttled)
    this.moneyAcc += dt;
    if (this.openCat && this.moneyAcc >= 0.5) {
      this.moneyAcc = 0;
      this.refreshAffordability();
    }
  }

  // ── internals ──────────────────────────────────────────────────────────
  private onCategory(cat: CatId): void {
    if (cat === 'bulldoze') return this.open(cat);
    this.toggle(cat);
  }

  private setZoneMode(m: ZoneMode): void {
    this.zoneMode = m;
    for (const [id, b] of this.zoneModeBtns) setClass(b, 'active', id === m);
    const tools = this.ctx.game.tools;
    if (tools.current?.id === 'zone') {
      const o = { ...((tools.currentOpts as Record<string, unknown>) ?? {}), mode: m };
      tools.setTool('zone', o);
    }
    this.ctx.sfx('click', 0.6);
  }

  private tabsFor(cat: CatId): PaletteTab[] {
    // districts depend on world state: always rebuild; others are cached
    if (cat === 'districts' || !this.tabsByCat.has(cat)) this.tabsByCat.set(cat, tabsFor(cat, this.ctx.world(), this.actions));
    return this.tabsByCat.get(cat)!;
  }

  private buildFlyout(cat: CatId): void {
    const def = categoryDef(cat);
    this.flyout.style.setProperty('--c', def.color);
    this.flyIcon.replaceChildren(icon(def.icon, 18));
    setText(this.flyTitle, def.label);
    const tabs = this.tabsFor(cat);
    const w = this.ctx.world();
    let sel = this.tabSel.get(cat);
    // default to the tab holding the active tool, else the first tab
    const tools = this.ctx.game.tools;
    if (!sel) {
      const act = tabs.find((t) => t.items.some((it) => isItemActive(it, tools.current?.id, tools.currentOpts)));
      sel = act?.id ?? tabs[0]?.id ?? '';
    }
    this.tabs.value = sel;
    this.tabs.setItems(tabs.map((t) => {
      const locked = t.items.every((it) => !isItemUnlocked(w, it));
      return { id: t.id, label: t.label, icon: t.icon, badge: locked ? '🔒' : undefined };
    }));
    this.tabs.el.style.display = tabs.length > 1 ? '' : 'none';
    this.flyTools.replaceChildren();
    if (cat === 'zoning') {
      const seg = h('div', { class: 'hud-chip-group' }, [...this.zoneModeBtns.values()]);
      for (const [id, b] of this.zoneModeBtns) setClass(b, 'active', id === this.zoneMode);
      this.flyTools.appendChild(seg);
    }
    this.renderCards();
  }

  private renderCards(): void {
    const cat = this.openCat;
    if (!cat) return;
    const tabs = this.tabsFor(cat);
    const tab = tabs.find((t) => t.id === this.tabs.value) ?? tabs[0];
    this.cards = [];
    const frag = document.createDocumentFragment();
    const w = this.ctx.world();
    const tools = this.ctx.game.tools;
    for (const it of tab?.items ?? []) {
      const unlocked = isItemUnlocked(w, it);
      const cost = h('span', { class: 'hud-card-cost' });
      if (it.cost !== undefined) {
        cost.append(h('b', null, formatMoney(it.cost, it.cost >= 100_000)), ...(it.costUnit ? [h('small', null, it.costUnit)] : []));
      } else if (it.costText) cost.append(h('small', null, it.costText));
      const up = it.upkeep !== undefined ? h('span', { class: 'hud-card-upkeep' }, `${formatMoney(it.upkeep, it.upkeep >= 10_000)}${it.upkeepUnit ?? '/mo'}`) : null;
      const el = h('button', {
        class: 'hud-card' + (unlocked ? '' : ' locked') + (isItemActive(it, tools.current?.id, tools.currentOpts) ? ' active' : '') + (it.kind === 'action' ? ' action' : ''),
        style: it.color ? `--ic:${it.color}` : '',
        'aria-label': it.name,
      },
      h('span', { class: 'hud-card-art' }, h('span', { class: 'hud-card-icon' }, it.icon), it.color ? h('span', { class: 'hud-card-swatch' }) : null),
      h('span', { class: 'hud-card-name' }, it.name),
      h('span', { class: 'hud-card-meta' }, cost, up),
      it.chips.length ? h('span', { class: 'hud-card-chips' }, it.chips.slice(0, 2).map((c) => h('span', { class: 'hud-card-chip ' + (c.kind ?? '') }, h('i', null, c.icon), c.text))) : null,
      unlocked ? null : h('span', { class: 'hud-card-lock' }, icon('lock', 12), lockLabel(it.unlock)));
      el.onclick = () => {
        if (this.select(it)) this.markActive();
      };
      this.ctx.tips.attach(el, () => this.cardTip(it), { rich: true, placement: 'top', delay: 260 });
      this.cards.push({ item: it, el, cost });
      frag.appendChild(el);
    }
    if (!tab || !tab.items.length) frag.appendChild(h('div', { class: 'hud-cards-empty' }, 'Nothing here yet.'));
    this.cardsEl.replaceChildren(frag);
    this.cardsEl.scrollLeft = 0;
    this.refreshAffordability();
  }

  private refreshAffordability(): void {
    const w = this.ctx.world();
    if (!w) return;
    const money = w.economy.money;
    for (const c of this.cards) {
      const poor = !w.creative && c.item.cost !== undefined && !c.item.costUnit && c.item.cost > money;
      setClass(c.el, 'poor', poor);
    }
  }

  private markActive(): void {
    const tools = this.ctx.game.tools;
    for (const c of this.cards) setClass(c.el, 'active', isItemActive(c.item, tools.current?.id, tools.currentOpts));
  }

  private onToolChanged(): void {
    const tools = this.ctx.game.tools;
    const cat = catOfTool(tools.current?.id, tools.currentOpts);
    for (const [id, b] of this.btns) setClass(b, 'tool', id === cat);
    if (tools.current?.id === 'zone') {
      const m = (tools.currentOpts as { mode?: ZoneMode } | undefined)?.mode;
      if (m && m !== this.zoneMode && this.zoneModeBtns.has(m)) {
        this.zoneMode = m;
        for (const [id, b] of this.zoneModeBtns) setClass(b, 'active', id === m);
      }
    }
    this.markActive();
  }

  private unlockedKeys(): Set<string> {
    const w = this.ctx.world();
    const s = new Set<string>();
    if (!w) return s;
    for (const it of this.items()) if (it.kind !== 'district' && it.kind !== 'action' && isItemUnlocked(w, it)) s.add(it.key);
    return s;
  }

  private onUnlocks(): void {
    const now = this.unlockedKeys();
    const w = this.ctx.world();
    if (w && !w.creative) {
      for (const it of this.items()) {
        if (now.has(it.key) && !this.knownUnlocked.has(it.key)) this.fresh.add(it.cat);
      }
    }
    this.knownUnlocked = now;
    for (const [id, b] of this.btns) setClass(b, 'fresh', this.fresh.has(id) && this.openCat !== id);
    this.tabsByCat.clear();
    if (this.openCat) this.buildFlyout(this.openCat);
  }

  private async newDistrict(): Promise<void> {
    const w = this.ctx.world();
    if (!w) return;
    try {
      const d = this.ctx.game.actions.createDistrict();
      this.ctx.game.tools.setTool('district', { districtId: d.id });
      this.ctx.ui.toast(`${d.name} created — paint it onto the map`, 'good');
      if (this.openCat === 'districts') this.buildFlyout('districts');
    } catch (e) {
      this.ctx.ui.toast(String((e as Error).message ?? e), 'danger');
    }
  }

  private categoryTip(cat: CatId): HTMLElement {
    const def = categoryDef(cat);
    const bc = def.buildings ?? [];
    const text = CAT_TIPS[cat] ?? bc.map((b: BuildingCategory) => CATEGORY_INFO[b]?.description).filter(Boolean).join(' ');
    const w = this.ctx.world();
    let total = 0, open = 0;
    if (cat !== 'bulldoze') {
      for (const t of this.tabsFor(cat)) for (const it of t.items) {
        if (it.kind === 'action') continue;
        total++;
        if (isItemUnlocked(w, it)) open++;
      }
    }
    return richTip({
      title: def.label,
      text,
      rows: total ? [['Available', `${open} of ${total}`, open === total ? 'good' : '']] : undefined,
      footer: this.fresh.has(cat) ? 'New items unlocked!' : undefined,
      footerKind: 'good',
    });
  }

  private cardTip(it: PaletteItem): HTMLElement {
    const w = this.ctx.world();
    const unlocked = isItemUnlocked(w, it);
    const sub: string[] = [];
    if (it.cost !== undefined) sub.push(`${formatMoney(it.cost)}${it.costUnit ?? ''}`);
    else if (it.costText) sub.push(it.costText);
    if (it.upkeep !== undefined) sub.push(`${formatMoney(it.upkeep)}${it.upkeepUnit ?? '/mo'} upkeep`);
    let footer: string | undefined;
    let footerKind: 'bad' | 'warn' | 'good' | '' = '';
    if (!unlocked) {
      footer = `🔒 ${unlockText(it.unlock)}`;
      footerKind = 'warn';
    } else if (w && !w.creative && it.cost !== undefined && !it.costUnit && it.cost > w.economy.money) {
      footer = `Not enough money (${formatMoney(w.economy.money)} available)`;
      footerKind = 'bad';
    } else if (it.notes.length) footer = it.notes.join(' · ');
    const tip = richTip({ title: it.name, icon: it.icon, subtitle: sub.join(' · '), text: it.description, rows: it.rows, footer, footerKind });
    if (!unlocked) {
      const m = MILESTONES[Math.min(it.unlock, MILESTONES.length - 1)];
      const cur = w?.stats.population ?? 0;
      if (m && m.population > 0) {
        const p = Math.max(0, Math.min(1, cur / m.population));
        tip.appendChild(h('div', { class: 'hud-rtip-progress' }, h('span', { style: `width:${(p * 100).toFixed(1)}%` })));
      }
    }
    return tip;
  }
}

function shortPop(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function lockLabel(unlock: number): string {
  const m = MILESTONES[Math.min(unlock, MILESTONES.length - 1)];
  return m && m.population > 0 ? `${m.name} · ${shortPop(m.population)}` : milestoneLabel(unlock);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

