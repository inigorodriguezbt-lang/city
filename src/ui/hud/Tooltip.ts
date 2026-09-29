// One shared floating tooltip for the whole HUD. Targets register content
// (static text, an element, or a builder function re-evaluated while shown).
// Mouse: hover with a short delay (instant when moving between targets).
// Touch: long-press shows the tip and swallows the following click.
import { h } from '../dom';

export type TipContent = string | HTMLElement | (() => string | HTMLElement | null);

export interface TipOptions {
  /** keyboard hint shown in a <kbd> after the text */
  key?: string | (() => string);
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
  /** wider layout for rich content */
  rich?: boolean;
  /** show delay (ms) when cold */
  delay?: number;
}

interface Entry {
  content: TipContent;
  opts: TipOptions;
}

export class Tooltips {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private entries = new WeakMap<HTMLElement, Entry>();
  private target: HTMLElement | null = null;
  private timer = 0;
  private hideTimer = 0;
  private lastHide = 0;
  private suppressClick: HTMLElement | null = null;
  private visible = false;

  constructor(host: HTMLElement, private env: { scale(): number; enabled(): boolean }) {
    this.body = h('div', { class: 'hud-tip-body' });
    this.el = h('div', { class: 'hud-tip', role: 'tooltip' }, this.body);
    host.appendChild(this.el);
    // Any press anywhere hides the tip (except long-press on touch targets).
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') this.hide();
    }, true);
    window.addEventListener('wheel', () => this.hide(), { passive: true, capture: true });
    window.addEventListener('blur', () => this.hide());
  }

  /** Register (or replace) tooltip content for an element. */
  attach(target: HTMLElement, content: TipContent, opts: TipOptions = {}): HTMLElement {
    const had = this.entries.has(target);
    this.entries.set(target, { content, opts });
    if (had) return target;
    target.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      this.schedule(target);
    });
    target.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.target === target) this.hideSoon();
      else if (this.timer) this.cancelTimer();
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.cancelTimer();
      const startX = e.clientX, startY = e.clientY;
      const move = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) cancel();
      };
      const cancel = () => {
        this.cancelTimer();
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', cancel);
        target.removeEventListener('pointercancel', cancel);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', cancel);
      target.addEventListener('pointercancel', cancel);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.suppressClick = target;
        this.show(target);
        window.setTimeout(() => this.hide(), 2600);
      }, 460);
    });
    target.addEventListener('click', (e) => {
      if (this.suppressClick === target) {
        this.suppressClick = null;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    return target;
  }

  detach(target: HTMLElement): void {
    this.entries.delete(target);
    if (this.target === target) this.hide();
  }

  /** Re-render the visible tooltip (dynamic content). */
  refresh(): void {
    if (!this.visible || !this.target) return;
    if (!this.target.isConnected || this.target.offsetParent === null) {
      this.hide();
      return;
    }
    const entry = this.entries.get(this.target);
    if (!entry || typeof entry.content !== 'function') return;
    this.render(entry);
    this.position(this.target, entry.opts);
  }

  hide(): void {
    this.cancelTimer();
    window.clearTimeout(this.hideTimer);
    this.hideTimer = 0;
    if (this.visible) this.lastHide = performance.now();
    this.visible = false;
    this.target = null;
    this.el.classList.remove('show');
  }

  private hideSoon(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 60);
  }

  private cancelTimer(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
  }

  private schedule(target: HTMLElement): void {
    if (!this.env.enabled()) return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = 0;
    this.cancelTimer();
    const entry = this.entries.get(target);
    if (!entry) return;
    const warm = this.visible || performance.now() - this.lastHide < 350;
    const delay = warm ? 0 : entry.opts.delay ?? 380;
    if (delay <= 0) this.show(target);
    else this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.show(target);
    }, delay);
  }

  private render(entry: Entry): boolean {
    let c = entry.content;
    if (typeof c === 'function') c = c() ?? '';
    const key = typeof entry.opts.key === 'function' ? entry.opts.key() : entry.opts.key;
    while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
    if (typeof c === 'string') {
      if (!c && !key) return false;
      if (c) this.body.appendChild(h('span', { class: 'hud-tip-text' }, c));
    } else this.body.appendChild(c);
    if (key) this.body.appendChild(h('kbd', { class: 'hud-kbd' }, key));
    this.el.classList.toggle('rich', !!entry.opts.rich || typeof c !== 'string');
    return true;
  }

  private show(target: HTMLElement): void {
    const entry = this.entries.get(target);
    if (!entry || !target.isConnected) return;
    if (!this.render(entry)) return;
    this.target = target;
    this.visible = true;
    this.el.classList.add('show');
    this.position(target, entry.opts);
  }

  private position(target: HTMLElement, opts: TipOptions): void {
    const s = this.env.scale() || 1;
    const r = target.getBoundingClientRect();
    const vw = window.innerWidth / s, vh = window.innerHeight / s;
    const left = r.left / s, top = r.top / s, right = r.right / s, bottom = r.bottom / s;
    const tw = this.el.offsetWidth, th = this.el.offsetHeight;
    const gap = 10;
    let place = opts.placement ?? 'auto';
    if (place === 'auto') place = top > th + gap + 8 ? 'top' : 'bottom';
    if (place === 'top' && top < th + gap + 8) place = 'bottom';
    if (place === 'bottom' && bottom + th + gap > vh - 8) place = 'top';
    if (place === 'left' && left < tw + gap + 8) place = 'right';
    if (place === 'right' && right + tw + gap > vw - 8) place = 'left';
    let x: number, y: number;
    if (place === 'top' || place === 'bottom') {
      x = (left + right) / 2 - tw / 2;
      y = place === 'top' ? top - th - gap : bottom + gap;
    } else {
      y = (top + bottom) / 2 - th / 2;
      x = place === 'left' ? left - tw - gap : right + gap;
    }
    const cx = Math.max(8, Math.min(vw - tw - 8, x));
    const cy = Math.max(8, Math.min(vh - th - 8, y));
    this.el.dataset.place = place;
    // arrow offset (relative to tooltip box)
    if (place === 'top' || place === 'bottom') this.el.style.setProperty('--arrow', `${Math.max(12, Math.min(tw - 12, (left + right) / 2 - cx))}px`);
    else this.el.style.setProperty('--arrow', `${Math.max(12, Math.min(th - 12, (top + bottom) / 2 - cy))}px`);
    this.el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  }
}

/** Build a structured tooltip: title, optional subtitle, description and stat rows. */
export function richTip(p: {
  title: string;
  icon?: string;
  subtitle?: string;
  text?: string;
  rows?: [string, string, ('good' | 'bad' | 'warn' | '')?][];
  footer?: string;
  footerKind?: 'bad' | 'warn' | 'good' | '';
}): HTMLElement {
  return h('div', { class: 'hud-rtip' },
    h('div', { class: 'hud-rtip-head' },
      p.icon ? h('span', { class: 'hud-rtip-icon' }, p.icon) : null,
      h('div', null,
        h('div', { class: 'hud-rtip-title' }, p.title),
        p.subtitle ? h('div', { class: 'hud-rtip-sub' }, p.subtitle) : null)),
    p.text ? h('div', { class: 'hud-rtip-text' }, p.text) : null,
    p.rows && p.rows.length
      ? h('div', { class: 'hud-rtip-rows' }, p.rows.map(([k, v, kind]) => h('div', { class: 'hud-rtip-row' }, h('span', null, k), h('b', { class: kind || '' }, v))))
      : null,
    p.footer ? h('div', { class: 'hud-rtip-foot ' + (p.footerKind ?? '') }, p.footer) : null);
}
