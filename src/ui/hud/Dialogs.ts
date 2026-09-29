// Styled modal confirm/prompt dialogs (promise based, keyboard friendly).
import { h, isolate } from '../dom';
import type { HudContext } from './context';
import { icon } from './icons';

export interface ConfirmOptions {
  ok?: string;
  cancel?: string;
  danger?: boolean;
  /** emoji or short glyph shown in the header badge */
  icon?: string;
}

export interface PromptOptions {
  ok?: string;
  text?: string;
  placeholder?: string;
  maxLength?: number;
}

interface Active {
  el: HTMLElement;
  resolve: (ok: boolean) => void;
}

export class Dialogs {
  private queue: Promise<unknown> = Promise.resolve();
  private active: Active | null = null;
  private prevInput = true;

  constructor(private host: HTMLElement, private ctx: HudContext) {
    window.addEventListener('keydown', this.onKey, true);
  }

  isOpen(): boolean {
    return !!this.active;
  }

  /** cancel the visible dialog (Esc chain); returns true if one was open */
  cancelTop(): boolean {
    if (!this.active) return false;
    this.active.resolve(false);
    return true;
  }

  confirm(title: string, text: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return this.enqueue(() => new Promise<boolean>((resolve) => {
      const ok = h('button', { class: 'btn ' + (opts.danger ? 'danger hud-btn-danger' : 'primary') }, opts.ok ?? (opts.danger ? 'Confirm' : 'OK'));
      const cancel = h('button', { class: 'btn' }, opts.cancel ?? 'Cancel');
      const card = this.card(title, opts.icon ?? (opts.danger ? '!' : '?'), opts.danger ?? false, [
        h('p', { class: 'hud-dlg-text' }, text),
      ], [cancel, ok]);
      const done = this.open(card, (v) => resolve(v));
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      requestAnimationFrame(() => ok.focus());
    }));
  }

  prompt(title: string, def = '', opts: PromptOptions = {}): Promise<string | null> {
    return this.enqueue(() => new Promise<string | null>((resolve) => {
      const input = h('input', { type: 'text', class: 'hud-dlg-input', value: def, maxLength: opts.maxLength ?? 48, placeholder: opts.placeholder ?? '', spellcheck: false });
      const ok = h('button', { class: 'btn primary' }, opts.ok ?? 'Save');
      const cancel = h('button', { class: 'btn' }, 'Cancel');
      const card = this.card(title, '✎', false, [
        opts.text ? h('p', { class: 'hud-dlg-text' }, opts.text) : null,
        input,
      ], [cancel, ok]);
      const done = this.open(card, (v) => resolve(v ? input.value.trim() : null));
      const validate = () => ok.toggleAttribute('disabled', input.value.trim().length === 0);
      input.addEventListener('input', validate);
      validate();
      ok.onclick = () => { if (input.value.trim()) done(true); };
      cancel.onclick = () => done(false);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private card(title: string, badge: string, danger: boolean, body: (HTMLElement | null)[], buttons: HTMLElement[]): HTMLElement {
    return h('div', { class: 'hud-dlg-card glass' + (danger ? ' danger' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'hud-dlg-head' },
        h('div', { class: 'hud-dlg-badge' }, badge),
        h('div', { class: 'hud-dlg-title' }, title)),
      h('div', { class: 'hud-dlg-body' }, body),
      h('div', { class: 'hud-dlg-actions' }, buttons));
  }

  private open(card: HTMLElement, onDone: (ok: boolean) => void): (ok: boolean) => void {
    const closeBtn = h('button', { class: 'hud-dlg-x', 'aria-label': 'Close' }, icon('close', 16));
    card.appendChild(closeBtn);
    const el = isolate(h('div', { class: 'hud-dlg' }, card));
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el) finish(false);
    });
    this.host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const input = this.ctx.game.input;
    this.prevInput = input.enabled;
    input.enabled = false;
    this.ctx.sfx('open', 0.6);
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      this.active = null;
      input.enabled = this.prevInput;
      el.classList.remove('show');
      el.classList.add('hide');
      window.setTimeout(() => el.remove(), 180);
      this.ctx.sfx(ok ? 'click' : 'close', 0.6);
      onDone(ok);
    };
    closeBtn.onclick = () => finish(false);
    this.active = { el, resolve: finish };
    return finish;
  }

  private onKey = (e: KeyboardEvent): void => {
    const a = this.active;
    if (!a) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      a.resolve(false);
    } else if (e.key === 'Enter') {
      const primary = a.el.querySelector<HTMLButtonElement>('.btn.primary, .btn.danger');
      if (primary && !primary.disabled) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        primary.click();
      }
    } else {
      // keep typing inside the dialog from reaching game hotkeys
      e.stopPropagation();
    }
  };
}
