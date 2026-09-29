// Floating legend for the active info view (visible while an overlay is on).
import { h } from '../dom';
import type { FieldId } from '../../core/types';
import { overlayInfo } from '../../data/overlays';
import { legendBar } from '../panels/OverlaysPanel';
import { icon } from './icons';
import { setClass, type HudContext } from './context';

export class Legend {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private current: FieldId | null = null;

  constructor(ctx: HudContext) {
    this.body = h('div', { class: 'hud-legend-body' });
    const close = h('button', { class: 'hud-legend-x', 'aria-label': 'Turn off info view', onclick: () => ctx.game.renderer.setOverlay(null) }, icon('close', 14));
    ctx.tips.attach(close, 'Back to normal view');
    const more = h('button', { class: 'hud-legend-more', 'aria-label': 'All info views', onclick: () => ctx.ui.togglePanel('overlays') }, icon('layers', 14));
    ctx.tips.attach(more, 'All info views', { key: () => ctx.key('ui.overlays') });
    this.el = h('div', { class: 'hud-legend hud-pe', role: 'status' }, this.body, h('div', { class: 'hud-legend-tools' }, more, close));
    ctx.game.events.on('overlay:changed', (id) => this.set(id));
  }

  set(id: FieldId | null): void {
    if (id === this.current) return;
    this.current = id;
    const o = id ? overlayInfo(id) : undefined;
    setClass(this.el, 'show', !!o);
    if (!o) return;
    this.body.replaceChildren(
      h('div', { class: 'hud-legend-head' }, h('span', { class: 'hud-legend-icon' }, o.icon), h('b', null, o.name)),
      legendBar(o));
  }
}
