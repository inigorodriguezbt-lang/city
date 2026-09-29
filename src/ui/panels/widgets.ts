// Reusable DOM widgets for HUD panels (tabs, sliders, toggles, bars, cards).
import { h } from '../dom';
import { setText } from '../hud/context';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
  badge?: string;
}

/** Segmented tabs with an animated underline indicator. */
export class Tabs<T extends string> {
  readonly el: HTMLElement;
  private buttons = new Map<T, HTMLButtonElement>();
  private ind: HTMLElement;
  value: T;

  constructor(items: TabItem<T>[], value: T, private onChange: (id: T) => void, cls = '') {
    this.value = value;
    this.ind = h('span', { class: 'hud-tabs-ind' });
    this.el = h('div', { class: 'hud-tabs ' + cls, role: 'tablist' });
    this.setItems(items);
  }

  setItems(items: TabItem<T>[]): void {
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this.buttons.clear();
    for (const it of items) {
      const b = h('button', { class: 'hud-tab', role: 'tab', onclick: () => this.select(it.id, true) },
        it.icon ? h('span', { class: 'hud-tab-icon' }, it.icon) : null,
        h('span', null, it.label),
        it.badge ? h('span', { class: 'hud-tab-badge' }, it.badge) : null);
      this.buttons.set(it.id, b);
      this.el.appendChild(b);
    }
    this.el.appendChild(this.ind);
    if (!this.buttons.has(this.value) && items.length) this.value = items[0].id;
    this.select(this.value, false);
  }

  select(id: T, notify: boolean): void {
    this.value = id;
    for (const [k, b] of this.buttons) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    this.placeIndicator();
    if (notify) this.onChange(id);
  }

  /** reposition the indicator (call after the tabs became visible) */
  placeIndicator(): void {
    const b = this.buttons.get(this.value);
    if (!b) return;
    requestAnimationFrame(() => {
      this.ind.style.width = `${b.offsetWidth}px`;
      this.ind.style.transform = `translateX(${b.offsetLeft}px)`;
    });
  }
}

/** Range slider with label, live value text and optional sub-label. */
export class Slider {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private valueEl: HTMLElement;
  private subEl: HTMLElement;
  private dragging = false;
  private paint: () => void;

  constructor(p: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    format: (v: number) => string;
    onInput: (v: number) => void;
    color?: string;
    icon?: string;
    ticks?: number[];
  }) {
    this.input = h('input', { type: 'range', min: String(p.min), max: String(p.max), step: String(p.step), class: 'hud-range' });
    this.input.value = String(p.value);
    this.valueEl = h('span', { class: 'hud-slider-val' }, p.format(p.value));
    this.subEl = h('span', { class: 'hud-slider-sub' });
    const paint = (this.paint = () => {
      const v = Number(this.input.value);
      const t = (v - p.min) / (p.max - p.min || 1);
      this.input.style.setProperty('--fill', `${(t * 100).toFixed(1)}%`);
      setText(this.valueEl, p.format(v));
    });
    this.input.addEventListener('input', () => {
      paint();
      p.onInput(Number(this.input.value));
    });
    this.input.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    if (p.color) this.input.style.setProperty('--track', p.color);
    const ticks = p.ticks?.length
      ? h('div', { class: 'hud-slider-ticks' }, p.ticks.map((tv) => h('i', { style: `left:${(((tv - p.min) / (p.max - p.min)) * 100).toFixed(2)}%` })))
      : null;
    this.el = h('div', { class: 'hud-slider' },
      h('div', { class: 'hud-slider-top' },
        p.icon ? h('span', { class: 'hud-slider-icon', style: p.color ? `--c:${p.color}` : '' }, p.icon) : null,
        h('span', { class: 'hud-slider-label' }, p.label),
        this.subEl,
        this.valueEl),
      h('div', { class: 'hud-slider-track' }, this.input, ticks));
    paint();
  }

  set(v: number): void {
    if (this.dragging || document.activeElement === this.input) return;
    if (Math.abs(Number(this.input.value) - v) < 1e-9) return;
    this.input.value = String(v);
    this.paint();
  }

  setValueText(t: string): void {
    setText(this.valueEl, t);
  }

  setSub(t: string, kind = ''): void {
    setText(this.subEl, t);
    this.subEl.className = 'hud-slider-sub ' + kind;
  }
}

/** iOS-style switch. */
export function toggle(on: boolean, onChange: (v: boolean) => void, label?: string): { el: HTMLElement; set(v: boolean): void; setDisabled(d: boolean): void } {
  const knob = h('span', { class: 'hud-switch-knob' });
  const btn = h('button', { class: 'hud-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label ?? 'Toggle' }, knob);
  let value = on;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (btn.classList.contains('disabled')) return;
    value = !value;
    btn.classList.toggle('on', value);
    btn.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  return {
    el: btn,
    set(v: boolean) {
      if (v === value) return;
      value = v;
      btn.classList.toggle('on', v);
      btn.setAttribute('aria-checked', String(v));
    },
    setDisabled(d: boolean) {
      btn.classList.toggle('disabled', d);
    },
  };
}

/** Horizontal meter bar 0..1 (color via kind or explicit color). */
export class Meter {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private mark: HTMLElement | null = null;
  constructor(kind: 'good' | 'bad' | 'warn' | 'accent' | 'auto' | 'neutral' = 'accent', color?: string, markAt?: number) {
    this.fill = h('span', { class: 'hud-meter-fill' });
    this.el = h('div', { class: 'hud-meter ' + kind }, this.fill);
    if (color) this.fill.style.background = color;
    if (markAt !== undefined) {
      this.mark = h('i', { class: 'hud-meter-mark', style: `left:${(markAt * 100).toFixed(1)}%` });
      this.el.appendChild(this.mark);
    }
  }
  set(v01: number, kind?: string): void {
    const v = Math.max(0, Math.min(1, Number.isFinite(v01) ? v01 : 0));
    const w = `${(v * 100).toFixed(1)}%`;
    if (this.fill.style.width !== w) this.fill.style.width = w;
    if (kind && !this.el.classList.contains(kind)) this.el.className = 'hud-meter ' + kind;
  }
}

/** Key/value row with optional meter; returns setters. */
export function statRow(label: string, withMeter = false, kind: 'good' | 'bad' | 'warn' | 'accent' | 'auto' | 'neutral' = 'accent'): {
  el: HTMLElement; set(value: string, v01?: number, cls?: string): void; label: HTMLElement;
} {
  const lab = h('span', { class: 'hud-row-label' }, label);
  const val = h('span', { class: 'hud-row-val' });
  const meter = withMeter ? new Meter(kind) : null;
  const el = h('div', { class: 'hud-row' + (withMeter ? ' with-meter' : '') }, h('div', { class: 'hud-row-line' }, lab, val), meter?.el ?? null);
  return {
    el,
    label: lab,
    set(value: string, v01?: number, cls?: string) {
      setText(val, value);
      const c = 'hud-row-val' + (cls ? ' ' + cls : '');
      if (val.className !== c) val.className = c;
      if (meter && v01 !== undefined) meter.set(v01, kind === 'auto' ? (v01 > 0.66 ? 'good' : v01 > 0.33 ? 'warn' : 'bad') : undefined);
    },
  };
}

/** Section title inside a panel body. */
export function section(title: string, extra?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'hud-sec-title' }, h('span', null, title), extra ?? null);
}

/** Empty-state block. */
export function emptyState(glyph: string, title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'hud-empty' },
    h('div', { class: 'hud-empty-glyph' }, glyph),
    h('div', { class: 'hud-empty-title' }, title),
    h('div', { class: 'hud-empty-text' }, text),
    action ?? null);
}

export const SWATCHES = [
  '#ff5d5d', '#ff8a3d', '#ffb547', '#f2d33a', '#9be15d', '#3ddc84', '#1fc7a8', '#29d3e6',
  '#4cc2ff', '#4a7dff', '#7c5cff', '#b45cff', '#ff5cc8', '#ff7aa2', '#c9d1db', '#8b95a5',
];

/** Small popover with colour swatches + custom picker. */
export function colorPicker(current: string, onPick: (c: string) => void): HTMLElement {
  const custom = h('input', { type: 'color', class: 'hud-color-input', value: current });
  custom.addEventListener('input', () => onPick(custom.value));
  return h('div', { class: 'hud-colors' },
    SWATCHES.map((c) => h('button', {
      class: 'hud-color' + (c.toLowerCase() === current.toLowerCase() ? ' active' : ''),
      style: `--c:${c}`,
      'aria-label': c,
      onclick: () => onPick(c),
    })),
    h('label', { class: 'hud-color custom', title: 'Custom colour' }, custom, '+'));
}
