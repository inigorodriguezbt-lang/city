// Reusable menu controls: buttons, switches, sliders, segmented pickers,
// steppers, keycaps and the dialog frame. All controls are keyboard
// accessible and emit UI sounds through the shared MenuCtx.
import { h } from '../dom';
import type { MenuCtx, MenuLayer } from './ctx';
import { mIcon, type MenuIcon } from './icons';

type Child = Node | string | null | undefined | false;

export function kbd(label: string, cls = ''): HTMLElement {
  return h('kbd', { class: 'mn-kbd' + (cls ? ' ' + cls : '') }, label);
}

/** keycaps for a combo label split into parts ("Ctrl", "Z") */
export function keycaps(parts: string[]): HTMLElement {
  return h('span', { class: 'mn-kcombo' }, ...parts.map((p) => kbd(p)));
}

export interface BtnOpts {
  icon?: MenuIcon;
  kind?: 'primary' | 'ghost' | 'danger' | 'default' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  onClick?: (e: MouseEvent) => void;
  cls?: string;
}

export function btn(ctx: MenuCtx, label: string | null, o: BtnOpts = {}): HTMLButtonElement {
  const b = h('button', {
    class: ['mn-btn', o.kind && o.kind !== 'default' ? o.kind : '', o.size ?? 'md', label ? '' : 'icon-only', o.cls ?? ''].filter(Boolean).join(' '),
    type: 'button',
    'aria-label': label ?? o.title ?? '',
  }, o.icon ? mIcon(o.icon, o.size === 'lg' ? 20 : o.size === 'sm' ? 15 : 17) : null, label ? h('span', null, label) : null);
  b.addEventListener('click', (e) => {
    ctx.sfx('click');
    o.onClick?.(e);
  });
  if (o.title) ctx.tip(b, o.title);
  return b;
}

/** on/off switch (role=switch) */
export function toggle(ctx: MenuCtx, value: boolean, onChange: (v: boolean) => void, label = ''): HTMLButtonElement & { set(v: boolean): void } {
  const el = h('button', { class: 'mn-switch', type: 'button', role: 'switch', 'aria-label': label }, h('span', { class: 'mn-switch-knob' })) as HTMLButtonElement & { set(v: boolean): void };
  let v = value;
  const paint = () => {
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
  };
  el.set = (nv: boolean) => {
    v = nv;
    paint();
  };
  el.addEventListener('click', () => {
    v = !v;
    paint();
    ctx.sfx('click', 0.7);
    onChange(v);
  });
  paint();
  return el;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  /** fires continuously while dragging */
  onInput?: (v: number) => void;
  /** fires on release / keyboard commit */
  onChange?: (v: number) => void;
  label?: string;
  /** notch marks to render (values) */
  marks?: number[];
}

export type Slider = HTMLElement & { set(v: number): void; input: HTMLInputElement };

export function slider(ctx: MenuCtx, o: SliderOpts): Slider {
  const input = h('input', {
    type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value), 'aria-label': o.label ?? '',
  }) as HTMLInputElement;
  const out = h('output', { class: 'mn-range-val' });
  const track = h('div', { class: 'mn-range-track' }, input);
  if (o.marks) {
    const marks = h('div', { class: 'mn-range-marks' });
    for (const m of o.marks) marks.append(h('i', { style: `left:${((m - o.min) / (o.max - o.min)) * 100}%` }));
    track.prepend(marks);
  }
  const el = h('div', { class: 'mn-range' }, track, out) as unknown as Slider;
  const fmt = o.format ?? ((v: number) => String(v));
  const paint = () => {
    const v = Number(input.value);
    el.style.setProperty('--p', String((v - o.min) / (o.max - o.min || 1)));
    out.textContent = fmt(v);
  };
  let lastTick = 0;
  input.addEventListener('input', () => {
    paint();
    const now = performance.now();
    if (now - lastTick > 70) {
      lastTick = now;
      ctx.sfx('hover', 0.35);
    }
    o.onInput?.(Number(input.value));
  });
  input.addEventListener('change', () => o.onChange?.(Number(input.value)));
  el.set = (v: number) => {
    input.value = String(v);
    paint();
  };
  el.input = input;
  paint();
  return el;
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  icon?: MenuIcon;
}

export type Segmented<T> = HTMLElement & { set(v: T): void };

/** radio-group of pills; arrow keys move the selection */
export function segmented<T extends string | number>(ctx: MenuCtx, opts: SegOption<T>[], value: T, onChange: (v: T) => void, label = ''): Segmented<T> {
  const el = h('div', { class: 'mn-seg', role: 'radiogroup', 'aria-label': label }) as unknown as Segmented<T>;
  const btns: HTMLButtonElement[] = [];
  let cur = value;
  const paint = () => {
    btns.forEach((b, i) => {
      const on = opts[i].value === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const i = opts.findIndex((o) => o.value === cur);
    el.style.setProperty('--i', String(Math.max(0, i)));
    el.style.setProperty('--n', String(opts.length));
  };
  const choose = (v: T, focus = false) => {
    if (v === cur) return;
    cur = v;
    paint();
    ctx.sfx('click', 0.7);
    onChange(v);
    if (focus) btns[opts.findIndex((o) => o.value === v)]?.focus();
  };
  el.append(h('span', { class: 'mn-seg-thumb' }));
  for (const o of opts) {
    const b = h('button', { class: 'mn-seg-btn', type: 'button', role: 'radio' }, o.icon ? mIcon(o.icon, 15) : null, h('span', null, o.label));
    b.addEventListener('click', () => choose(o.value));
    if (o.hint) ctx.tip(b, o.hint);
    btns.push(b);
    el.append(b);
  }
  el.addEventListener('keydown', (e) => {
    const i = opts.findIndex((o) => o.value === cur);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(opts.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, i - 1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = opts.length - 1;
    if (n < 0) return;
    e.preventDefault();
    e.stopPropagation();
    choose(opts[n].value, true);
  });
  el.set = (v: T) => {
    cur = v;
    paint();
  };
  paint();
  return el;
}

export type Stepper<T> = HTMLElement & { set(v: T): void };

/** ◀ value ▶ picker for many discrete options */
export function stepper<T extends string | number>(ctx: MenuCtx, opts: SegOption<T>[], value: T, onChange: (v: T) => void, label = ''): Stepper<T> {
  let i = Math.max(0, opts.findIndex((o) => o.value === value));
  const text = h('span', { class: 'mn-step-val' });
  const dots = h('span', { class: 'mn-step-dots' }, ...opts.map(() => h('i')));
  const prev = h('button', { class: 'mn-step-btn', type: 'button', 'aria-label': 'Previous', tabIndex: -1 }, mIcon('chevronLeft', 16));
  const next = h('button', { class: 'mn-step-btn', type: 'button', 'aria-label': 'Next', tabIndex: -1 }, mIcon('chevronRight', 16));
  const el = h('div', { class: 'mn-stepper', tabIndex: 0, role: 'spinbutton', 'aria-label': label }, prev, h('span', { class: 'mn-step-mid' }, text, dots), next) as unknown as Stepper<T>;
  const paint = () => {
    text.textContent = opts[i].label;
    el.setAttribute('aria-valuetext', opts[i].label);
    prev.disabled = i === 0;
    next.disabled = i === opts.length - 1;
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const go = (d: number) => {
    const n = Math.max(0, Math.min(opts.length - 1, i + d));
    if (n === i) return;
    i = n;
    paint();
    ctx.sfx('click', 0.6);
    onChange(opts[i].value);
  };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') go(-1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') go(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.set = (v: T) => {
    const k = opts.findIndex((o) => o.value === v);
    if (k >= 0) i = k;
    paint();
  };
  paint();
  return el;
}

/** option row: label + description on the left, control on the right */
export function row(label: string, desc: string | null, control: Child, extra?: { cls?: string; badge?: string }): HTMLElement {
  return h('div', { class: 'mn-row' + (extra?.cls ? ' ' + extra.cls : '') },
    h('div', { class: 'mn-row-txt' },
      h('div', { class: 'mn-row-label' }, label, extra?.badge ? h('span', { class: 'mn-badge' }, extra.badge) : null),
      desc ? h('div', { class: 'mn-row-desc' }, desc) : null),
    h('div', { class: 'mn-row-ctl' }, control));
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'mn-sec' }, h('h3', { class: 'mn-sec-title' }, title), ...children);
}

export interface DialogOpts {
  id: string;
  title: string;
  subtitle?: string;
  icon?: MenuIcon;
  /** css width of the card (px) */
  width?: number;
  cls?: string;
  body: Child | Child[];
  footer?: Child[];
  /** Escape/backdrop/× close (default true) */
  dismissible?: boolean;
  onClose?: () => void;
}

export interface Dialog extends MenuLayer {
  card: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  head: HTMLElement;
  close(): void;
}

/** standard modal dialog layer (backdrop + glass card + header/body/footer) */
export function dialog(ctx: MenuCtx, o: DialogOpts): Dialog {
  const closeBtn = h('button', { class: 'mn-x', type: 'button', 'aria-label': 'Close' }, mIcon('x', 18));
  const head = h('header', { class: 'mn-dlg-head' },
    o.icon ? h('span', { class: 'mn-dlg-icon' }, mIcon(o.icon, 20)) : null,
    h('div', { class: 'mn-dlg-titles' }, h('h2', { class: 'mn-dlg-title' }, o.title), o.subtitle ? h('div', { class: 'mn-dlg-sub' }, o.subtitle) : null),
    o.dismissible === false ? null : closeBtn);
  const body = h('div', { class: 'mn-dlg-body' }, ...(Array.isArray(o.body) ? o.body : [o.body]));
  const foot = h('footer', { class: 'mn-dlg-foot' }, ...(o.footer ?? []));
  const card = h('div', {
    class: 'mn-dlg glass' + (o.cls ? ' ' + o.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title,
    style: o.width ? `--w:${o.width}px` : '',
  }, head, body, o.footer?.length ? foot : null);
  const el = h('div', { class: 'mn-layer mn-dlg-wrap' }, h('div', { class: 'mn-backdrop' }), card);
  const d: Dialog = {
    id: o.id,
    el,
    card,
    body,
    foot,
    head,
    dismissible: o.dismissible !== false,
    close: () => ctx.pop(d),
    onClose: o.onClose,
    focus: () => {
      const f = card.querySelector<HTMLElement>('[autofocus], .mn-btn.primary, input, button:not(.mn-x)');
      f?.focus({ preventScroll: true });
    },
  };
  closeBtn.addEventListener('click', () => {
    ctx.sfx('close');
    d.close();
  });
  el.firstElementChild!.addEventListener('pointerdown', () => {
    if (d.dismissible) {
      ctx.sfx('close');
      d.close();
    }
  });
  return d;
}

/** number animation helper for stat readouts (respects reduced motion) */
export function countUp(ctx: MenuCtx, el: HTMLElement, to: number, fmt: (v: number) => string, ms = 650): void {
  if (ctx.reduced() || !Number.isFinite(to)) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(to * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
