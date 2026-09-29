// Info views: pick an overlay (game.renderer.setOverlay) and read its legend.
import { h } from '../dom';
import type { FieldId } from '../../core/types';
import { OVERLAYS, overlayInfo, type OverlayInfo } from '../../data/overlays';
import { Panel } from './Panel';
import type { HudContext } from '../hud/context';
import { setClass } from '../hud/context';
import { icon } from '../hud/icons';

const GROUPS: { title: string; ids: FieldId[] }[] = [
  { title: 'Utilities', ids: ['power', 'water', 'sewage'] },
  { title: 'Services', ids: ['health', 'education', 'police', 'fire', 'garbage', 'deathcare', 'leisure', 'transit'] },
  { title: 'City life', ids: ['happiness', 'landValue', 'traffic', 'tourism', 'crime', 'pollution', 'noise'] },
  { title: 'Natural resources', ids: ['wind', 'fertility', 'forest', 'ore', 'oil'] },
];

/** gradient + labels for an overlay ramp (shared with the floating legend) */
export function legendBar(o: OverlayInfo): HTMLElement {
  const stops = o.ramp.map((c, i) => `${c} ${((i / Math.max(1, o.ramp.length - 1)) * 100).toFixed(0)}%`).join(', ');
  return h('div', { class: 'hud-legend-bar' },
    h('div', { class: 'hud-legend-ramp', style: `background:linear-gradient(90deg, ${stops})` }),
    h('div', { class: 'hud-legend-labels' },
      h('span', null, o.low),
      h('span', { class: 'hud-legend-good' }, o.highIsGood ? 'higher is better' : 'lower is better'),
      h('span', null, o.high)));
}

export class OverlaysPanel extends Panel {
  private tiles = new Map<FieldId | 'none', HTMLButtonElement>();
  private legend!: HTMLElement;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'overlays', title: 'Info Views', icon: 'layers', width: 340, anchor: 'right', key: 'ui.overlays', rate: 0, cls: 'hud-panel-overlays' });
    this.setSubtitle('Colour the map by any statistic');
    ctx.game.events.on('overlay:changed', () => this.isOpen && this.refresh());
  }

  protected build(body: HTMLElement): void {
    const none = h('button', { class: 'hud-ov-tile none', onclick: () => this.pick(null) }, h('span', { class: 'hud-ov-icon' }, icon('eye', 16)), h('span', null, 'Normal view'));
    this.tiles.set('none', none);
    body.appendChild(none);
    for (const g of GROUPS) {
      const grid = h('div', { class: 'hud-ov-grid' });
      for (const id of g.ids) {
        const o = overlayInfo(id);
        if (!o) continue;
        const t = h('button', { class: 'hud-ov-tile', style: `--c:${o.ramp[o.highIsGood ? o.ramp.length - 1 : 0]}`, onclick: () => this.pick(o.id) },
          h('span', { class: 'hud-ov-icon' }, o.icon),
          h('span', { class: 'hud-ov-name' }, o.name));
        this.ctx.tips.attach(t, o.description, { placement: 'left' });
        this.tiles.set(o.id, t);
        grid.appendChild(t);
      }
      body.append(h('div', { class: 'hud-sec-title' }, h('span', null, g.title)), grid);
    }
    // any overlay not covered by the groups (future additions)
    const known = new Set(GROUPS.flatMap((g) => g.ids));
    const extra = OVERLAYS.filter((o) => !known.has(o.id));
    if (extra.length) {
      const grid = h('div', { class: 'hud-ov-grid' });
      for (const o of extra) {
        const t = h('button', { class: 'hud-ov-tile', onclick: () => this.pick(o.id) }, h('span', { class: 'hud-ov-icon' }, o.icon), h('span', { class: 'hud-ov-name' }, o.name));
        this.tiles.set(o.id, t);
        grid.appendChild(t);
      }
      body.append(h('div', { class: 'hud-sec-title' }, h('span', null, 'Other')), grid);
    }
    this.legend = h('div', { class: 'hud-ov-legend' });
    body.appendChild(this.legend);
  }

  override refresh(): void {
    const cur = this.ctx.game.renderer.overlay;
    for (const [id, t] of this.tiles) setClass(t, 'active', id === (cur ?? 'none'));
    const o = cur ? overlayInfo(cur) : undefined;
    if (!o) {
      this.legend.replaceChildren(h('div', { class: 'hud-ov-legend-empty' }, 'Pick a view to colour the map. Press ', h('kbd', { class: 'hud-kbd' }, this.ctx.key('ui.overlays') || 'O'), ' to toggle this list.'));
      return;
    }
    this.legend.replaceChildren(
      h('div', { class: 'hud-ov-legend-head' }, h('span', { class: 'hud-ov-icon' }, o.icon), h('b', null, o.name)),
      h('p', null, o.description),
      legendBar(o),
      ...(o.roadsOnly ? [h('div', { class: 'hud-ov-note' }, 'Shown on road cells only.')] : []));
  }

  private pick(id: FieldId | null): void {
    const r = this.ctx.game.renderer;
    const next = r.overlay === id ? null : id;
    r.setOverlay(next);
    this.ctx.sfx('click', 0.6);
    this.refresh();
  }
}
