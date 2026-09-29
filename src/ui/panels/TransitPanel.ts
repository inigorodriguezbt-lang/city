// Transit lines: create per mode, recolour/rename, vehicles, ridership,
// active toggle, locate and delete.
import { h } from '../dom';
import type { TransitLine } from '../../core/types';
import { formatNumber } from '../../core/util';
import { Panel } from './Panel';
import { colorPicker, emptyState, toggle } from './widgets';
import { setClass, setText, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';
import { TRANSIT_MODES, transitMode, milestoneLabel } from '../hud/catalog';

const MAX_VEHICLES = 40;

interface RowRef {
  el: HTMLElement;
  stops: HTMLElement;
  riders: HTMLElement;
  vehVal: HTMLElement;
  veh: HTMLInputElement;
  sw: ReturnType<typeof toggle>;
}

export class TransitPanel extends Panel {
  private create!: HTMLElement;
  private list!: HTMLElement;
  private rows = new Map<number, RowRef>();
  private sig = '';
  private picker: HTMLElement | null = null;
  private focusLine: number | null = null;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'transit', title: 'Public Transport', icon: 'bus', width: 720, anchor: 'center', rate: 2, cls: 'hud-panel-transit' });
  }

  /** highlight a line (from a 'select' with lineId) */
  focus(lineId: number): void {
    this.focusLine = lineId;
    this.sig = '';
    if (this.isOpen) this.refresh();
  }

  protected build(body: HTMLElement): void {
    this.create = h('div', { class: 'hud-transit-modes' });
    this.list = h('div', { class: 'hud-line-list' });
    body.append(h('div', { class: 'hud-sec-title' }, h('span', null, 'New line')), this.create, h('div', { class: 'hud-sec-title' }, h('span', null, 'Lines')), this.list);
    body.addEventListener('pointerdown', (e) => {
      if (this.picker && !(e.target as HTMLElement).closest('.hud-colors, .hud-line-swatch')) this.closePicker();
    });
  }

  protected override onOpen(): void {
    this.sig = '';
    this.refresh();
  }

  protected override onClose(): void {
    this.closePicker();
    this.focusLine = null;
  }

  override reset(): void {
    this.sig = '';
    this.rows.clear();
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.list) return;
    const lines = w.transitLines;
    const riders = lines.reduce((s, l) => s + l.ridership, 0);
    const veh = lines.reduce((s, l) => s + (l.active ? l.vehicles : 0), 0);
    this.setSubtitle(lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'} · ${formatNumber(veh)} vehicles · ${formatNumber(riders)} riders last month` : 'No lines yet');
    const sig = `${w.milestone}|${w.creative}|${this.focusLine}|` + lines.map((l) => `${l.id}:${l.name}:${l.color}:${l.mode}`).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.renderModes();
      this.renderLines();
    }
    for (const l of lines) {
      const r = this.rows.get(l.id);
      if (!r) continue;
      setText(r.stops, `${l.stops.length} stop${l.stops.length === 1 ? '' : 's'}`);
      setText(r.riders, formatNumber(l.ridership));
      if (document.activeElement !== r.veh) {
        r.veh.value = String(l.vehicles);
        this.paintVeh(r, l.vehicles);
      }
      r.sw.set(l.active);
      setClass(r.el, 'inactive', !l.active);
    }
  }

  private renderModes(): void {
    const w = this.ctx.world()!;
    this.create.replaceChildren(...TRANSIT_MODES.map((m) => {
      const ok = w.isUnlocked(m.unlock);
      const b = h('button', { class: 'hud-mode' + (ok ? '' : ' locked'), style: `--c:${m.color}`, onclick: () => {
        if (!ok) {
          this.ctx.sfx('error');
          return;
        }
        this.ctx.game.tools.setTool('transit', { mode: m.mode });
        this.ctx.sfx('click');
        this.ctx.ui.closePanel('transit');
      } },
      h('span', { class: 'hud-mode-icon' }, m.icon),
      h('span', { class: 'hud-mode-name' }, m.name.replace(' Line', '')),
      ok ? h('span', { class: 'hud-mode-sub' }, m.capacity) : h('span', { class: 'hud-mode-sub' }, icon('lock', 11), milestoneLabel(m.unlock)));
      this.ctx.tips.attach(b, m.description);
      return b;
    }));
  }

  private renderLines(): void {
    const w = this.ctx.world()!;
    this.rows.clear();
    if (!w.transitLines.length) {
      this.list.replaceChildren(emptyState('🚏', 'No transit lines yet', 'Pick a mode above, then click along the streets to place stops. Lines take cars off the road and earn fares.'));
      return;
    }
    this.list.replaceChildren(...w.transitLines.map((l) => this.row(l)));
    if (this.focusLine !== null) requestAnimationFrame(() => this.list.querySelector('.focus')?.scrollIntoView({ block: 'nearest' }));
  }

  private row(l: TransitLine): HTMLElement {
    const g = this.ctx.game;
    const m = transitMode(l.mode);
    const swatch = h('button', { class: 'hud-line-swatch', style: `--c:${l.color}`, 'aria-label': 'Line colour' }, m.icon);
    swatch.onclick = (e) => {
      e.stopPropagation();
      this.openPicker(l, swatch);
    };
    this.ctx.tips.attach(swatch, 'Change colour');
    const name = h('button', { class: 'hud-dist-name', onclick: () => void this.rename(l) }, l.name, icon('pencil', 12));
    const stops = h('span', null);
    const riders = h('b', null);
    const vehVal = h('b', { class: 'hud-line-vehval' });
    const veh = h('input', { type: 'range', min: '1', max: String(MAX_VEHICLES), step: '1', class: 'hud-range sm', 'aria-label': 'Vehicles' });
    veh.value = String(l.vehicles);
    const ref: RowRef = { el: null as unknown as HTMLElement, stops, riders, vehVal, veh, sw: null as unknown as ReturnType<typeof toggle> };
    veh.addEventListener('input', () => {
      const v = Number(veh.value);
      this.paintVeh(ref, v);
      g.traffic.updateLine(l.id, { vehicles: v });
    });
    veh.addEventListener('keydown', (e) => e.stopPropagation());
    const sw = toggle(l.active, (v) => {
      g.traffic.updateLine(l.id, { active: v });
      this.ctx.sfx('click', 0.6);
    }, 'Active');
    this.ctx.tips.attach(sw.el, 'Run / suspend this line');
    const locate = h('button', { class: 'hud-icon-btn', 'aria-label': 'Locate', onclick: () => {
      const s = l.stops[0];
      if (s) this.ctx.flyTo(s.x + 0.5, s.y + 0.5, 600);
    } }, icon('crosshair', 15));
    this.ctx.tips.attach(locate, 'Fly to the first stop');
    const del = h('button', { class: 'hud-icon-btn danger', 'aria-label': 'Delete line', onclick: () => void this.remove(l) }, icon('trash', 15));
    this.ctx.tips.attach(del, 'Delete line');
    const el = h('div', { class: 'hud-line' + (l.id === this.focusLine ? ' focus' : '') + (l.active ? '' : ' inactive'), style: `--c:${l.color}` },
      swatch,
      h('div', { class: 'hud-line-main' },
        h('div', { class: 'hud-line-top' }, name, h('span', { class: 'hud-line-mode' }, m.name.replace(' Line', '')), stops),
        h('div', { class: 'hud-line-veh' }, h('span', { class: 'dim' }, 'Vehicles'), veh, vehVal)),
      h('div', { class: 'hud-line-riders' }, riders, h('small', null, 'riders / month')),
      sw.el, locate, del);
    ref.el = el;
    ref.sw = sw;
    this.paintVeh(ref, l.vehicles);
    this.rows.set(l.id, ref);
    return el;
  }

  private paintVeh(r: RowRef, v: number): void {
    setText(r.vehVal, String(v));
    r.veh.style.setProperty('--fill', `${(((v - 1) / (MAX_VEHICLES - 1)) * 100).toFixed(1)}%`);
  }

  private openPicker(l: TransitLine, anchor: HTMLElement): void {
    this.closePicker();
    const p = colorPicker(l.color, (c) => {
      this.ctx.game.traffic.updateLine(l.id, { color: c });
      this.closePicker();
      this.sig = '';
      this.refresh();
    });
    p.classList.add('pop');
    anchor.parentElement!.appendChild(p);
    this.picker = p;
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = null;
  }

  private async rename(l: TransitLine): Promise<void> {
    const name = await this.ctx.ui.prompt('Rename line', l.name);
    if (!name) return;
    this.ctx.game.traffic.updateLine(l.id, { name: name.slice(0, 32) });
    this.sig = '';
    this.refresh();
  }

  private async remove(l: TransitLine): Promise<void> {
    const ok = await this.ctx.ui.confirmEx(`Delete ${l.name}?`, `All ${l.stops.length} stops and ${l.vehicles} vehicles on this line will be removed.`, { danger: true, ok: 'Delete line', icon: transitMode(l.mode).icon });
    if (!ok) return;
    this.ctx.game.traffic.removeLine(l.id);
    this.ctx.sfx('bulldoze', 0.6);
    this.sig = '';
    this.refresh();
  }
}
