// Notification log: every world notice with filters, jump-to and read state.
import { h } from '../dom';
import { formatDate } from '../../core/time';
import type { Notice, NoticeKind } from '../../core/types';
import { Panel } from './Panel';
import { emptyState } from './widgets';
import { Tabs } from './widgets';
import { handleOf, initials, nameColor, setText, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';

type Filter = 'all' | 'alerts' | 'city' | 'chirps' | 'progress';

const FILTER_KINDS: Record<Filter, NoticeKind[] | null> = {
  all: null,
  alerts: ['warning', 'danger', 'event'],
  city: ['info', 'good'],
  chirps: ['chirp'],
  progress: ['milestone', 'achievement'],
};

const KIND_ICON: Record<NoticeKind, string> = {
  info: 'ℹ️', good: '✅', warning: '⚠️', danger: '🚨', chirp: '🐦', milestone: '🏆', achievement: '🏅', event: '✨',
};

export class NoticesPanel extends Panel {
  private filter: Filter = 'all';
  private tabs!: Tabs<Filter>;
  private list!: HTMLElement;
  private rendered = -1;
  private renderedFilter: Filter | null = null;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'notices', title: 'Notifications', icon: 'bell', width: 400, anchor: 'right', rate: 1, cls: 'hud-panel-notices' });
    ctx.game.events.on('notice', () => {
      if (this.isOpen) this.refresh();
    });
  }

  protected build(body: HTMLElement): void {
    this.tabs = new Tabs<Filter>([
      { id: 'all', label: 'All' }, { id: 'alerts', label: 'Alerts' }, { id: 'city', label: 'City' }, { id: 'chirps', label: 'Chirper' }, { id: 'progress', label: 'Progress' },
    ], this.filter, (f) => {
      this.filter = f;
      this.refresh();
    }, 'hud-tabs-sm');
    const readAll = h('button', { class: 'hud-link-btn', onclick: () => this.markAll() }, icon('checkAll', 14), 'Mark all read');
    this.toolsEl.append(this.tabs.el, readAll);
    this.list = h('div', { class: 'hud-log' });
    body.appendChild(this.list);
  }

  protected override onOpen(): void {
    this.tabs.placeIndicator();
  }

  protected override onClose(): void {
    this.markAll(false);
  }

  override reset(): void {
    this.rendered = -1;
    this.renderedFilter = null;
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w) return;
    const unread = w.notices.filter((n) => !n.read).length;
    this.setSubtitle(unread ? `${unread} unread` : 'All caught up');
    const last = w.notices.length ? w.notices[w.notices.length - 1].id : 0;
    if (last === this.rendered && this.filter === this.renderedFilter) {
      this.updateTimes();
      return;
    }
    this.rendered = last;
    this.renderedFilter = this.filter;
    const kinds = FILTER_KINDS[this.filter];
    const chirps = this.ctx.game.settings.value.ui.chirps;
    const items = w.notices.filter((n) => (!kinds || kinds.includes(n.kind)) && (chirps || n.kind !== 'chirp')).slice(-150).reverse();
    if (!items.length) {
      this.list.replaceChildren(emptyState('🔔', 'Nothing here yet', this.filter === 'chirps' && !chirps ? 'Chirper is turned off in Options → Interface.' : 'News about your city will show up here.'));
      return;
    }
    this.list.replaceChildren(...items.map((n) => this.row(n)));
  }

  private row(n: Notice): HTMLElement {
    const jump = n.buildingId !== undefined || (n.x !== undefined && n.y !== undefined);
    const lead = n.kind === 'chirp'
      ? h('span', { class: 'hud-avatar sm', style: `--av:${nameColor(n.author ?? 'Citizen')}` }, initials(n.author ?? 'Citizen'))
      : h('span', { class: 'hud-log-icon' }, n.icon || KIND_ICON[n.kind]);
    const title = n.kind === 'chirp'
      ? h('div', { class: 'hud-log-title' }, h('b', null, n.author ?? 'Citizen'), h('span', { class: 'hud-chirp-handle' }, handleOf(n.author ?? 'Citizen')))
      : h('div', { class: 'hud-log-title' }, h('b', null, n.title));
    const el = h('button', { class: `hud-log-row k-${n.kind}` + (n.read ? '' : ' unread') + (jump ? ' jump' : ''), 'data-id': String(n.id) },
      lead,
      h('div', { class: 'hud-log-main' },
        title,
        h('div', { class: 'hud-log-text' }, n.kind === 'chirp' ? n.text || n.title : n.text),
        h('div', { class: 'hud-log-meta' }, h('span', { class: 'hud-log-date' }, formatDate(n.day)), jump ? h('span', { class: 'hud-log-jump' }, icon('crosshair', 11), 'Jump') : null)),
      n.read ? null : h('span', { class: 'hud-log-dot' }));
    el.onclick = () => {
      n.read = true;
      el.classList.remove('unread');
      el.querySelector('.hud-log-dot')?.remove();
      this.ctx.ui.refreshUnread();
      const w = this.ctx.world();
      if (n.buildingId !== undefined && w?.getBuilding(n.buildingId)) {
        const b = w.getBuilding(n.buildingId)!;
        this.ctx.flyTo(b.x + b.w / 2, b.y + b.h / 2);
        this.ctx.ui.openBuildingInfo(n.buildingId);
      } else if (n.x !== undefined && n.y !== undefined) this.ctx.flyTo(n.x + 0.5, n.y + 0.5);
      this.ctx.sfx('click', 0.6);
    };
    return el;
  }

  private updateTimes(): void {
    // dates are absolute; nothing to tick, but keep read state in sync
    const w = this.ctx.world();
    if (!w) return;
    for (const el of Array.from(this.list.querySelectorAll<HTMLElement>('.hud-log-row.unread'))) {
      const n = w.notices.find((x) => String(x.id) === el.dataset.id);
      if (n?.read) {
        el.classList.remove('unread');
        el.querySelector('.hud-log-dot')?.remove();
      }
    }
  }

  private markAll(sound = true): void {
    const w = this.ctx.world();
    if (!w) return;
    let any = false;
    for (const n of w.notices) if (!n.read) {
      n.read = true;
      any = true;
    }
    if (any) {
      for (const el of Array.from(this.list?.querySelectorAll<HTMLElement>('.hud-log-row.unread') ?? [])) {
        el.classList.remove('unread');
        el.querySelector('.hud-log-dot')?.remove();
      }
      this.ctx.ui.refreshUnread();
      setText(this.subEl, 'All caught up');
      if (sound) this.ctx.sfx('click', 0.5);
    }
  }
}
