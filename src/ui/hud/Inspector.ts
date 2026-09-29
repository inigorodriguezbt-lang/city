// Floating inspector card for a selected building (live info from
// game.sim.buildingInfo, actions) or a selected vehicle (follow camera).
import { Vector3 } from 'three';
import { h, isolate } from '../dom';
import { BFlag, Problem, type Building, type VehicleType } from '../../core/types';
import { formatMoney, formatNumber } from '../../core/util';
import { buildingDef, CATEGORY_INFO } from '../../data/buildings';
import { zoneDef } from '../../data/zones';
import { styleDef } from '../../data/styles';
import type { BuildingInfo, InfoLine } from '../../sim/Simulation';
import { icon } from './icons';
import { formatSpeed, initials, nameColor, setClass, setText, type HudContext } from './context';

const PROBLEM_TEXT: [Problem, string, string][] = [
  [Problem.NoPower, '⚡', 'No electricity'],
  [Problem.NoWater, '💧', 'No water'],
  [Problem.NoSewage, '🚽', 'No sewage service'],
  [Problem.NoRoad, '🛣️', 'No road access'],
  [Problem.Garbage, '🗑️', 'Garbage is piling up'],
  [Problem.Crime, '🦹', 'High crime'],
  [Problem.Sick, '🤒', 'Sick residents'],
  [Problem.Fire, '🔥', 'On fire!'],
  [Problem.NoWorkers, '👷', 'Not enough workers'],
  [Problem.NoCustomers, '🛍️', 'Not enough customers'],
  [Problem.NoGoods, '📦', 'Not enough goods to sell'],
  [Problem.Pollution, '☣️', 'Polluted surroundings'],
  [Problem.Noise, '🔊', 'Too noisy'],
  [Problem.Abandoned, '🏚️', 'Abandoned'],
  [Problem.Dead, '⚱️', 'Dead are not collected'],
  [Problem.NoEducated, '🎓', 'Needs educated workers'],
  [Problem.HighRent, '💸', 'Rent too high for its level'],
  [Problem.Flooded, '🌊', 'Flooded'],
  [Problem.Traffic, '🚦', 'Traffic congestion'],
  [Problem.LowHappiness, '😟', 'Unhappy occupants'],
];

const VEHICLE: Record<VehicleType, [string, string]> = {
  car: ['🚗', 'Car'], taxi: ['🚕', 'Taxi'], truck: ['🚚', 'Truck'], van: ['🚐', 'Van'], bus: ['🚌', 'Bus'], tram: ['🚋', 'Tram'],
  metro: ['🚇', 'Metro'], train: ['🚆', 'Train'], firetruck: ['🚒', 'Fire engine'], police: ['🚓', 'Police car'], ambulance: ['🚑', 'Ambulance'],
  garbage: ['🚛', 'Garbage truck'], hearse: ['⚱️', 'Hearse'], service: ['🛻', 'Service vehicle'], bike: ['🚲', 'Bicycle'],
};

export class Inspector {
  readonly el: HTMLElement;
  private iconEl: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private levelEl: HTMLElement;
  private flagsEl: HTMLElement;
  private linesEl: HTMLElement;
  private peopleEl: HTMLElement;
  private problemsEl: HTMLElement;
  private actionsEl: HTMLElement;
  private buildingId: number | null = null;
  private vehicleId: number | null = null;
  private following = false;
  private followBtn: HTMLButtonElement | null = null;
  private acc = 0;
  private sig = '';
  private lineRows = new Map<string, { row: HTMLElement; val: HTMLElement; fill: HTMLElement | null }>();
  private tmp = new Vector3();

  constructor(private ctx: HudContext) {
    this.iconEl = h('div', { class: 'hud-insp-icon' });
    this.title = h('div', { class: 'hud-insp-title' });
    this.sub = h('div', { class: 'hud-insp-sub' });
    this.levelEl = h('div', { class: 'hud-insp-level' });
    this.flagsEl = h('div', { class: 'hud-insp-flags' });
    this.linesEl = h('div', { class: 'hud-insp-lines' });
    this.peopleEl = h('div', { class: 'hud-insp-people' });
    this.problemsEl = h('div', { class: 'hud-insp-problems' });
    this.actionsEl = h('div', { class: 'hud-insp-actions' });
    const close = h('button', { class: 'hud-panel-x', 'aria-label': 'Close', onclick: () => this.close() }, icon('close', 16));
    ctx.tips.attach(close, 'Close', { key: 'Esc' });
    this.el = isolate(h('aside', { class: 'hud-insp hud-pe', 'aria-label': 'Inspector' },
      h('div', { class: 'hud-insp-head' },
        this.iconEl,
        h('div', { class: 'hud-insp-titles' }, this.title, this.sub, this.levelEl),
        close),
      this.flagsEl,
      h('div', { class: 'hud-insp-scroll' }, this.problemsEl, this.linesEl, this.peopleEl),
      this.actionsEl));
    ctx.game.events.on('building:removed', (b) => {
      if (b.id === this.buildingId) this.close();
    });
    ctx.game.events.on('building:changed', (b) => {
      if (b.id === this.buildingId) this.acc = 1;
    });
  }

  get isOpen(): boolean {
    return this.buildingId !== null || this.vehicleId !== null;
  }

  get currentBuilding(): number | null {
    return this.buildingId;
  }

  openBuilding(id: number): void {
    const w = this.ctx.world();
    const b = w?.getBuilding(id);
    if (!w || !b) return;
    if (this.vehicleId !== null || (this.buildingId !== null && this.buildingId !== id)) this.teardown();
    this.buildingId = id;
    this.vehicleId = null;
    this.sig = '';
    this.lineRows.clear();
    this.linesEl.replaceChildren();
    this.el.dataset.mode = 'building';
    this.buildActions(b);
    this.refresh();
    this.show();
    try {
      this.ctx.game.buildings.highlight(id, 0x4cc2ff);
    } catch {
      /* renderer not ready */
    }
  }

  openVehicle(id: number): void {
    const info = this.ctx.game.traffic.vehicleInfo(id);
    if (!info) return;
    this.teardown();
    this.vehicleId = id;
    this.buildingId = null;
    this.sig = '';
    this.lineRows.clear();
    this.linesEl.replaceChildren();
    this.el.dataset.mode = 'vehicle';
    this.buildVehicleActions();
    this.refresh();
    this.show();
  }

  close(): boolean {
    if (!this.isOpen) return false;
    this.teardown();
    this.buildingId = null;
    this.vehicleId = null;
    this.el.classList.remove('open');
    this.ctx.sfx('close', 0.5);
    return true;
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    // the camera drops a follow target when the player pans or jumps away
    if (this.following && !this.ctx.game.renderer.cameraCtl.following) {
      this.following = false;
      if (this.followBtn) setClass(this.followBtn, 'active', false);
    }
    this.acc += dt;
    const rate = this.vehicleId !== null ? 0.25 : 0.5;
    if (this.acc >= rate) {
      this.acc = 0;
      this.refresh();
    }
  }

  // ── internals ──────────────────────────────────────────────────────────
  private show(): void {
    this.el.classList.add('open');
    this.acc = 0;
    this.ctx.sfx('open', 0.5);
  }

  private teardown(): void {
    if (this.following) this.ctx.game.renderer.cameraCtl.follow(null);
    this.following = false;
    if (this.buildingId !== null) {
      try {
        this.ctx.game.buildings.highlight(null);
      } catch {
        /* ignore */
      }
    }
  }

  private refresh(): void {
    if (this.buildingId !== null) this.refreshBuilding();
    else if (this.vehicleId !== null) this.refreshVehicle();
  }

  private refreshBuilding(): void {
    const w = this.ctx.world();
    const b = this.buildingId !== null ? w?.getBuilding(this.buildingId) : undefined;
    if (!w || !b) {
      this.close();
      return;
    }
    let info: BuildingInfo | null = null;
    try {
      info = this.ctx.game.sim.buildingInfo(b.id);
    } catch {
      info = null;
    }
    if (!info) info = this.fallbackInfo(b);
    setText(this.iconEl, info.icon);
    setText(this.title, b.name || info.title);
    setText(this.sub, info.subtitle);
    // level pips (zoned)
    if (b.kind === 'zoned') {
      const pips = `${b.level}`;
      if (this.levelEl.dataset.level !== pips) {
        this.levelEl.dataset.level = pips;
        this.levelEl.replaceChildren(h('span', { class: 'hud-insp-lvl-label' }, 'Level'), ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= b.level ? 'on' : '' })));
      }
      this.levelEl.style.display = '';
    } else this.levelEl.style.display = 'none';
    this.renderFlags(b);
    this.renderLines(info.lines);
    this.renderPeople(info.people ?? []);
    this.renderProblems(info.problems, b);
    // service on/off state + historical toggle labels
    const onoff = this.actionsEl.querySelector<HTMLElement>('[data-act="power"]');
    if (onoff) {
      const off = (b.flags & BFlag.Disabled) !== 0;
      setClass(onoff, 'active', !off);
      setText(onoff.querySelector('span')!, off ? 'Turn on' : 'Turn off');
    }
    const hist = this.actionsEl.querySelector<HTMLElement>('[data-act="hist"]');
    if (hist) setClass(hist, 'active', (b.flags & BFlag.Historical) !== 0);
  }

  private renderFlags(b: Building): void {
    const f = b.flags;
    const chips: [string, string, string][] = [];
    if (f & BFlag.UnderConstruction) chips.push(['warn', '🏗️', `Under construction ${Math.round(b.built * 100)}%`]);
    if (f & BFlag.Upgrading) chips.push(['good', '⬆️', 'Upgrading']);
    if (f & BFlag.OnFire) chips.push(['bad pulse', '🔥', 'On fire']);
    if (f & BFlag.Collapsed) chips.push(['bad', '🧱', 'Rubble']);
    else if (f & BFlag.Burned) chips.push(['bad', '♨️', 'Burned out']);
    if (f & BFlag.Abandoned) chips.push(['bad', '🏚️', 'Abandoned']);
    if (f & BFlag.Flooded) chips.push(['bad', '🌊', 'Flooded']);
    if (f & BFlag.Disabled) chips.push(['warn', '⏻', 'Switched off']);
    if (f & BFlag.Historical) chips.push(['accent', '🏛️', 'Historical']);
    const util: [number, string, string][] = [[BFlag.Powered, '⚡', 'Power'], [BFlag.Watered, '💧', 'Water'], [BFlag.Sewered, '🚽', 'Sewage'], [BFlag.RoadAccess, '🛣️', 'Road']];
    const sig = chips.map((c) => c[2]).join('|') + '#' + util.map(([bit]) => ((f & bit) ? 1 : 0)).join('');
    if (sig === this.sig) return;
    this.sig = sig;
    this.flagsEl.replaceChildren(
      ...util.map(([bit, ic, label]) => {
        const on = (f & bit) !== 0;
        const el = h('span', { class: 'hud-insp-util ' + (on ? 'on' : 'off') }, ic);
        this.ctx.tips.attach(el, `${label}: ${on ? 'connected' : 'not connected'}`);
        return el;
      }),
      ...chips.map(([k, ic, t]) => h('span', { class: 'hud-insp-flag ' + k }, h('i', null, ic), t)));
  }

  private renderLines(lines: InfoLine[]): void {
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.label);
      let r = this.lineRows.get(l.label);
      if (!r) {
        const val = h('span', { class: 'hud-insp-val' });
        const fill = l.bar !== undefined ? h('span', { class: 'hud-meter-fill' }) : null;
        const row = h('div', { class: 'hud-insp-line' },
          h('div', { class: 'hud-insp-line-top' }, h('span', { class: 'hud-insp-lab' }, l.label), val),
          fill ? h('div', { class: 'hud-meter' }, fill) : null);
        r = { row, val, fill };
        this.lineRows.set(l.label, r);
        this.linesEl.appendChild(row);
      }
      setText(r.val, l.value);
      r.val.className = 'hud-insp-val ' + (l.kind ?? '');
      if (r.fill && l.bar !== undefined) {
        const v = Math.max(0, Math.min(1, l.bar));
        r.fill.style.width = `${(v * 100).toFixed(1)}%`;
        r.fill.parentElement!.className = 'hud-meter ' + (l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : 'accent');
      }
    }
    for (const [k, r] of this.lineRows) if (!seen.has(k)) {
      r.row.remove();
      this.lineRows.delete(k);
    }
  }

  private renderPeople(people: { name: string; detail: string }[]): void {
    const sig = people.map((p) => p.name + p.detail).join('|');
    if (this.peopleEl.dataset.sig === sig) return;
    this.peopleEl.dataset.sig = sig;
    if (!people.length) {
      this.peopleEl.replaceChildren();
      return;
    }
    this.peopleEl.replaceChildren(
      h('div', { class: 'hud-insp-sec' }, 'People'),
      ...people.slice(0, 6).map((p) => h('div', { class: 'hud-person' },
        h('span', { class: 'hud-avatar sm', style: `--av:${nameColor(p.name)}` }, initials(p.name)),
        h('div', null, h('b', null, p.name), h('span', null, p.detail)))));
  }

  private renderProblems(problems: string[], b: Building): void {
    let list = problems;
    if (!list.length && b.problems) list = PROBLEM_TEXT.filter(([bit]) => (b.problems & bit) !== 0).map(([, ic, t]) => `${ic} ${t}`);
    const sig = list.join('|');
    if (this.problemsEl.dataset.sig === sig) return;
    this.problemsEl.dataset.sig = sig;
    this.problemsEl.replaceChildren(...list.map((p) => h('div', { class: 'hud-insp-problem' }, icon('alert', 13), h('span', null, p))));
  }

  private buildActions(b: Building): void {
    const g = this.ctx.game;
    const acts: HTMLElement[] = [];
    const btn = (id: string, ic: Parameters<typeof icon>[0], label: string, tip: string, fn: () => void, cls = '') => {
      const el = h('button', { class: 'hud-insp-act ' + cls, 'data-act': id, onclick: fn }, icon(ic, 16), h('span', null, label));
      this.ctx.tips.attach(el, tip);
      acts.push(el);
      return el;
    };
    this.followBtn = btn('follow', 'eye', 'Follow', 'Keep the camera on this building', () => this.toggleFollowBuilding());
    btn('locate', 'crosshair', 'Locate', 'Fly the camera here', () => {
      const bb = this.ctx.world()?.getBuilding(this.buildingId ?? -1);
      if (bb) this.ctx.flyTo(bb.x + bb.w / 2, bb.y + bb.h / 2, 300);
    });
    btn('rename', 'pencil', 'Rename', 'Give this building a name', () => void this.rename());
    if (b.kind === 'service') {
      btn('power', 'power', 'Turn off', 'Switch the building on or off (saves upkeep)', () => this.toggleFlag(BFlag.Disabled));
      const def = buildingDef(b.defId);
      if (def) btn('move', 'move', 'Move', 'Relocate this building', () => {
        g.tools.setTool('move', { id: b.id, defId: b.defId });
        this.close();
      });
    } else {
      btn('hist', 'landmark', 'Historical', 'Historical buildings keep their look and never level up or change', () => this.toggleFlag(BFlag.Historical));
    }
    btn('bulldoze', 'trash', 'Demolish', 'Bulldoze this building', () => void this.bulldoze(), 'danger');
    this.actionsEl.style.setProperty('--cols', String(acts.length <= 5 ? acts.length : 3));
    this.actionsEl.replaceChildren(...acts);
  }

  private buildVehicleActions(): void {
    const follow = h('button', { class: 'hud-insp-act', 'data-act': 'follow', onclick: () => this.toggleFollowVehicle() }, icon('eye', 16), h('span', null, 'Follow'));
    this.ctx.tips.attach(follow, 'Ride along with the camera');
    this.followBtn = follow;
    const locate = h('button', { class: 'hud-insp-act', onclick: () => {
      const v = this.ctx.game.traffic.vehicleInfo(this.vehicleId ?? -1);
      if (v) this.ctx.flyTo(v.x / 16, v.z / 16, 220);
    } }, icon('crosshair', 16), h('span', null, 'Locate'));
    this.actionsEl.style.setProperty('--cols', '2');
    this.actionsEl.replaceChildren(follow, locate);
  }

  private refreshVehicle(): void {
    const g = this.ctx.game;
    const v = this.vehicleId !== null ? g.traffic.vehicleInfo(this.vehicleId) : null;
    if (!v) {
      this.close();
      return;
    }
    const [ic, name] = VEHICLE[v.type] ?? ['🚗', 'Vehicle'];
    setText(this.iconEl, ic);
    setText(this.title, v.label || name);
    setText(this.sub, name);
    this.levelEl.style.display = 'none';
    if (this.sig !== 'veh') {
      this.sig = 'veh';
      this.flagsEl.replaceChildren();
      this.problemsEl.replaceChildren();
      this.peopleEl.replaceChildren();
      delete this.problemsEl.dataset.sig;
      delete this.peopleEl.dataset.sig;
    }
    const units = g.settings.value.ui.units;
    const w = this.ctx.world();
    const lines: InfoLine[] = [
      { label: 'Speed', value: formatSpeed(v.speed, units), bar: Math.min(1, v.speed / 30), kind: 'neutral' },
      { label: 'Direction', value: compass(v.heading) },
    ];
    const from = v.fromBuilding !== undefined ? w?.getBuilding(v.fromBuilding) : undefined;
    const to = v.toBuilding !== undefined ? w?.getBuilding(v.toBuilding) : undefined;
    if (from) lines.push({ label: 'From', value: g.actions.buildingName(from) });
    if (to) lines.push({ label: 'Heading to', value: g.actions.buildingName(to) });
    this.renderLines(lines);
  }

  private toggleFollowBuilding(): void {
    const cam = this.ctx.game.renderer.cameraCtl;
    if (this.following) {
      cam.follow(null);
      this.following = false;
    } else {
      const id = this.buildingId;
      const t = this.tmp;
      cam.follow(() => {
        const w = this.ctx.world();
        const b = id !== null ? w?.getBuilding(id) : undefined;
        if (!w || !b) return null;
        const c = w.cellCenter(b.x, b.y);
        return t.set((b.x + b.w / 2) * 16, c.y, (b.y + b.h / 2) * 16);
      });
      this.following = true;
    }
    setClass(this.followBtn!, 'active', this.following);
    this.ctx.sfx('click', 0.6);
  }

  private toggleFollowVehicle(): void {
    const g = this.ctx.game;
    const cam = g.renderer.cameraCtl;
    if (this.following) {
      cam.follow(null);
      this.following = false;
    } else {
      const id = this.vehicleId;
      const t = this.tmp;
      cam.follow(() => {
        const v = id !== null ? g.traffic.vehicleInfo(id) : null;
        return v ? t.set(v.x, v.y, v.z) : null;
      });
      this.following = true;
    }
    setClass(this.followBtn!, 'active', this.following);
    this.ctx.sfx('click', 0.6);
  }

  private toggleFlag(bit: BFlag): void {
    const w = this.ctx.world();
    const b = this.buildingId !== null ? w?.getBuilding(this.buildingId) : undefined;
    if (!w || !b) return;
    b.flags ^= bit;
    w.touchBuilding(b);
    this.ctx.sfx('click', 0.7);
    if (bit === BFlag.Disabled) this.ctx.ui.toast(`${this.ctx.game.actions.buildingName(b)} switched ${(b.flags & bit) ? 'off' : 'on'}`, 'info');
    else this.ctx.ui.toast((b.flags & bit) ? 'Marked as historical — it will keep its current look' : 'No longer historical', 'info');
    this.acc = 1;
  }

  private async rename(): Promise<void> {
    const w = this.ctx.world();
    const b = this.buildingId !== null ? w?.getBuilding(this.buildingId) : undefined;
    if (!w || !b) return;
    const name = await this.ctx.ui.prompt('Rename building', this.ctx.game.actions.buildingName(b));
    if (name === null || !w.getBuilding(b.id)) return;
    b.name = name.slice(0, 48);
    w.touchBuilding(b);
    this.acc = 1;
  }

  private async bulldoze(): Promise<void> {
    const g = this.ctx.game;
    const w = this.ctx.world();
    const b = this.buildingId !== null ? w?.getBuilding(this.buildingId) : undefined;
    if (!w || !b) return;
    const id = b.id;
    const refund = g.actions.refundFor(id);
    const name = g.actions.buildingName(b);
    const needConfirm = g.settings.value.gameplay.confirmBulldoze || b.kind === 'service';
    if (needConfirm) {
      const text = refund > 0
        ? `You will get ${formatMoney(refund)} back.`
        : refund < 0 ? `Clearing the rubble costs ${formatMoney(-refund)}.` : b.residents > 0 ? `${formatNumber(b.residents)} residents will have to move out.` : 'This cannot be undone once time moves on.';
      const ok = await this.ctx.ui.confirmEx(`Demolish ${name}?`, text, { danger: true, ok: 'Demolish', icon: '🚜' });
      if (!ok) return;
    }
    const r = g.actions.bulldozeBuilding(id);
    if (r.ok) {
      this.ctx.sfx('bulldoze', 0.8);
      if (w.getBuilding(id)) this.close();
    } else {
      this.ctx.sfx('error');
      this.ctx.ui.toast(r.reason ?? 'Cannot demolish this building', 'danger');
    }
  }

  private fallbackInfo(b: Building): BuildingInfo {
    const g = this.ctx.game;
    const w = this.ctx.world()!;
    const lines: InfoLine[] = [];
    const pct = (v: number) => `${Math.round(v)}%`;
    const k = (v: number): 'good' | 'bad' | 'neutral' => (v >= 65 ? 'good' : v < 35 ? 'bad' : 'neutral');
    let title = g.actions.buildingName(b), subtitle = '', ic = '🏠';
    if (b.kind === 'service') {
      const d = buildingDef(b.defId);
      ic = d?.icon ?? '🏛️';
      subtitle = d ? `${CATEGORY_INFO[d.category]?.name ?? d.category}${d.group ? ' · ' + d.group : ''}` : 'Service building';
      if (d?.jobs) lines.push({ label: 'Workers', value: `${formatNumber(b.workers)} / ${formatNumber(d.jobs)}`, bar: b.workers / Math.max(1, d.jobs), kind: b.workers < d.jobs * 0.6 ? 'bad' : 'neutral' });
      if (d?.capacity) lines.push({ label: d.capacityLabel ? cap(d.capacityLabel) : 'Capacity', value: `${formatNumber(b.visitors)} / ${formatNumber(d.capacity)}`, bar: b.visitors / Math.max(1, d.capacity) });
      if (d?.power) lines.push({ label: d.power > 0 ? 'Power output' : 'Power use', value: `${formatNumber(Math.abs(d.power) * (d.power > 0 ? b.efficiency : 1))} MW` });
      if (d?.water) lines.push({ label: d.water > 0 ? 'Water output' : 'Water use', value: `${formatNumber(Math.abs(d.water) * (d.water > 0 ? b.efficiency : 1))} m³/day` });
      if (d?.sewage) lines.push({ label: d.sewage > 0 ? 'Sewage processed' : 'Sewage', value: `${formatNumber(Math.abs(d.sewage))} m³/day` });
      lines.push({ label: 'Efficiency', value: pct(b.efficiency * 100), bar: b.efficiency / 1.5, kind: b.efficiency < 0.6 ? 'bad' : b.efficiency > 1 ? 'good' : 'neutral' });
      if (d) lines.push({ label: 'Upkeep', value: `${formatMoney(d.upkeep * (w.economy.budgets[(CATEGORY_INFO[d.category]?.budget ?? 'government') as keyof typeof w.economy.budgets] ?? 1))}/month` });
    } else {
      const z = zoneDef(b.zone);
      ic = z?.icon ?? '🏠';
      subtitle = `${z?.name ?? 'Zoned'} · ${styleDef(b.style).name}`;
      if (b.maxResidents > 0 || z?.category === 'res') lines.push({ label: 'Residents', value: `${formatNumber(b.residents)} / ${formatNumber(b.maxResidents)}`, bar: b.residents / Math.max(1, b.maxResidents) });
      if (b.jobs > 0) lines.push({ label: 'Workers', value: `${formatNumber(b.workers)} / ${formatNumber(b.jobs)}`, bar: b.workers / Math.max(1, b.jobs), kind: b.workers < b.jobs * 0.6 ? 'bad' : 'neutral' });
      if (z && (z.category === 'com' || z.category === 'ind')) lines.push({ label: z.category === 'com' ? 'Stock' : 'Output', value: pct(b.goods), bar: b.goods / 100, kind: k(b.goods) });
      lines.push({ label: 'Happiness', value: pct(b.happiness), bar: b.happiness / 100, kind: k(b.happiness) });
      lines.push({ label: 'Health', value: pct(b.health), bar: b.health / 100, kind: k(b.health) });
      lines.push({ label: 'Education', value: pct(b.education), bar: b.education / 100, kind: k(b.education) });
      lines.push({ label: 'Land value', value: pct((w.field('landValue', b.x, b.y) / 255) * 100), bar: w.field('landValue', b.x, b.y) / 255 });
    }
    if (b.age > 0) {
      const y = Math.floor(b.age / 360), d = Math.floor(b.age);
      lines.push({ label: 'Age', value: y >= 1 ? `${y} year${y === 1 ? '' : 's'}` : `${d} day${d === 1 ? '' : 's'}` });
    }
    return { title, subtitle, icon: ic, lines, problems: [] };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function compass(rad: number): string {
  const names = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
  const a = ((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return names[Math.round(a / (Math.PI / 4)) % 8];
}
