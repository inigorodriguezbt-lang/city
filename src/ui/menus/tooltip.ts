// Lightweight tooltip for the menu layers: one floating element, shown after a
// short hover delay (or immediately on keyboard focus), positioned above the
// target and flipped/clamped to stay inside the menus host.
import { h } from '../dom';
import { kbd } from './widgets';

type Text = string | (() => string);

interface TipData {
  text: Text;
  key?: Text;
}

const DELAY_MS = 380;

export class MenuTooltip {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private keyEl: HTMLElement;
  private data = new WeakMap<HTMLElement, TipData>();
  private target: HTMLElement | null = null;
  private timer = 0;
  /** tooltips globally enabled (settings.ui.tooltips) */
  enabled = true;

  constructor(private host: HTMLElement) {
    this.body = h('span', { class: 'mn-tip-text' });
    this.keyEl = h('span', { class: 'mn-tip-key' });
    this.el = h('div', { class: 'mn-tip', role: 'tooltip', 'aria-hidden': 'true' }, this.body, this.keyEl);
    host.append(this.el);
  }

  attach(el: HTMLElement, text: Text, key?: Text): void {
    const first = !this.data.has(el);
    this.data.set(el, { text, key });
    if (!first) return;
    el.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      this.schedule(el, DELAY_MS);
    });
    el.addEventListener('pointerleave', () => this.hide(el));
    el.addEventListener('pointerdown', () => this.hide(el));
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) this.schedule(el, 120);
    });
    el.addEventListener('blur', () => this.hide(el));
  }

  private schedule(el: HTMLElement, ms: number): void {
    if (!this.enabled) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(el), ms);
  }

  private show(el: HTMLElement): void {
    const d = this.data.get(el);
    if (!d || !el.isConnected) return;
    const text = typeof d.text === 'function' ? d.text() : d.text;
    const key = d.key ? (typeof d.key === 'function' ? d.key() : d.key) : '';
    if (!text && !key) return;
    this.target = el;
    this.body.textContent = text;
    this.keyEl.replaceChildren(...(key ? key.split(' / ').map((k) => kbd(k)) : []));
    this.keyEl.style.display = key ? '' : 'none';
    this.el.classList.add('show');
    this.place(el);
  }

  private place(el: HTMLElement): void {
    // work in the host's (zoomed) coordinate space
    const hr = this.host.getBoundingClientRect();
    const zoom = hr.width > 0 ? hr.width / Math.max(1, this.host.offsetWidth) : 1;
    const r = el.getBoundingClientRect();
    const tx = (r.left - hr.left) / zoom;
    const ty = (r.top - hr.top) / zoom;
    const tw = r.width / zoom;
    const th = r.height / zoom;
    const W = this.host.offsetWidth;
    const tipW = this.el.offsetWidth;
    const tipH = this.el.offsetHeight;
    let x = tx + tw / 2 - tipW / 2;
    let y = ty - tipH - 10;
    let below = false;
    if (y < 8) {
      y = ty + th + 10;
      below = true;
    }
    x = Math.max(8, Math.min(W - tipW - 8, x));
    this.el.classList.toggle('below', below);
    this.el.style.setProperty('--ax', `${Math.max(12, Math.min(tipW - 12, tx + tw / 2 - x))}px`);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  hide(el?: HTMLElement): void {
    window.clearTimeout(this.timer);
    if (el && this.target && el !== this.target) return;
    this.target = null;
    this.el.classList.remove('show');
  }
}
