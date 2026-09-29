// Base class for HUD panels: glass card, draggable header, close button,
// lazy build, throttled refresh while open. On narrow screens panels become
// bottom sheets (pure CSS via the .hud container query).
import { h, isolate } from '../dom';
import type { HudContext } from '../hud/context';
import { icon, type IconName } from '../hud/icons';
import type { PanelId } from '../UIManager';
import type { ActionId } from '../../settings/types';

export interface PanelOptions {
  id: PanelId;
  title: string;
  icon: IconName;
  /** preferred width in CSS px */
  width: number;
  /** default anchor */
  anchor?: 'center' | 'right' | 'left' | 'top';
  /** hotkey hint shown in the header */
  key?: ActionId;
  /** refreshes per second while open (0 = only on open) */
  rate?: number;
  /** extra class on the root */
  cls?: string;
}

const savedPos = new Map<string, { x: number; y: number }>();

export abstract class Panel {
  readonly el: HTMLElement;
  protected head: HTMLElement;
  protected body: HTMLElement;
  protected titleEl: HTMLElement;
  protected subEl: HTMLElement;
  /** header slot for tabs/filters */
  protected toolsEl: HTMLElement;
  isOpen = false;
  private built = false;
  private acc = 0;
  private closeTimer = 0;

  constructor(protected ctx: HudContext, readonly opts: PanelOptions) {
    this.titleEl = h('div', { class: 'hud-panel-title' }, opts.title);
    this.subEl = h('div', { class: 'hud-panel-sub' });
    this.toolsEl = h('div', { class: 'hud-panel-tools' });
    const keyLabel = opts.key ? ctx.key(opts.key) : '';
    const close = h('button', { class: 'hud-panel-x', 'aria-label': 'Close panel', onclick: () => this.ctx.ui.closePanel(this.opts.id) }, icon('close', 16));
    ctx.tips.attach(close, 'Close', { key: 'Esc' });
    this.head = h('div', { class: 'hud-panel-head' },
      h('span', { class: 'hud-panel-grab' }),
      h('div', { class: 'hud-panel-icon' }, icon(opts.icon, 18)),
      h('div', { class: 'hud-panel-titles' }, this.titleEl, this.subEl),
      keyLabel ? h('kbd', { class: 'hud-kbd hud-panel-key' }, keyLabel) : null,
      close);
    this.body = h('div', { class: 'hud-panel-body' });
    this.el = isolate(h('section', {
      class: `hud-panel hud-pe ${opts.cls ?? ''}`,
      style: `--pw:${opts.width}px`,
      'data-panel': opts.id,
      'aria-label': opts.title,
    }, this.head, this.toolsEl, this.body));
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
    this.initDrag();
  }

  /** build the body once (lazy, on first open) */
  protected abstract build(body: HTMLElement): void;
  /** update live values (called on open and at `rate` Hz while open) */
  refresh(): void {}
  /** called when opened (after build + first refresh) */
  protected onOpen(): void {}
  protected onClose(): void {}
  /** world changed (load/unload) – drop cached state */
  reset(): void {}

  mount(host: HTMLElement): void {
    host.appendChild(this.el);
  }

  open(): void {
    if (!this.built) {
      this.built = true;
      this.build(this.body);
    }
    window.clearTimeout(this.closeTimer);
    this.isOpen = true;
    this.el.classList.remove('closing');
    this.el.classList.add('open');
    this.place();
    this.acc = 0;
    this.refresh();
    this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('closing');
    this.el.classList.remove('open');
    this.closeTimer = window.setTimeout(() => this.el.classList.remove('closing'), 200);
    this.onClose();
  }

  tick(dt: number): void {
    if (!this.isOpen) return;
    const rate = this.opts.rate ?? 4;
    if (rate <= 0) return;
    this.acc += dt;
    if (this.acc >= 1 / rate) {
      this.acc = 0;
      this.refresh();
    }
  }

  setSubtitle(t: string): void {
    if (this.subEl.textContent !== t) this.subEl.textContent = t;
  }

  /** place at the saved position or the default anchor */
  private place(): void {
    const s = this.ctx.scale();
    const vw = window.innerWidth / s, vh = window.innerHeight / s;
    const saved = savedPos.get(this.opts.id);
    const w = Math.min(this.opts.width, vw - 24);
    let x: number, y: number;
    if (saved) {
      x = saved.x;
      y = saved.y;
    } else {
      const a = this.opts.anchor ?? 'center';
      y = a === 'top' ? 72 : 84;
      if (a === 'right') x = vw - w - 16;
      else if (a === 'left') x = 16;
      else x = (vw - w) / 2;
    }
    x = Math.max(8, Math.min(vw - Math.min(w, 160), x));
    y = Math.max(8, Math.min(vh - 80, y));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  private initDrag(): void {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, pid = -1;
    this.head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      if (this.ctx.compact()) return;
      dragging = true;
      pid = e.pointerId;
      this.head.setPointerCapture(pid);
      sx = e.clientX;
      sy = e.clientY;
      ox = parseFloat(this.el.style.left) || 0;
      oy = parseFloat(this.el.style.top) || 0;
      this.el.classList.add('dragging');
    });
    this.head.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      const s = this.ctx.scale();
      const vw = window.innerWidth / s, vh = window.innerHeight / s;
      const x = Math.max(8 - this.el.offsetWidth + 120, Math.min(vw - 120, ox + (e.clientX - sx) / s));
      const y = Math.max(4, Math.min(vh - 48, oy + (e.clientY - sy) / s));
      this.el.style.left = `${Math.round(x)}px`;
      this.el.style.top = `${Math.round(y)}px`;
    });
    const end = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      this.el.classList.remove('dragging');
      savedPos.set(this.opts.id, { x: parseFloat(this.el.style.left) || 0, y: parseFloat(this.el.style.top) || 0 });
    };
    this.head.addEventListener('pointerup', end);
    this.head.addEventListener('pointercancel', end);
    this.head.addEventListener('dblclick', () => {
      savedPos.delete(this.opts.id);
      this.place();
    });
  }
}
