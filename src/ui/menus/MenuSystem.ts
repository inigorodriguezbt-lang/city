// ─────────────────────────────────────────────────────────────────────────────
// MenuSystem: a stack of modal layers (main menu, dialogs, options, pause…)
// rendered in their own container above the HUD, plus the loading overlay.
//
// - isOpen() is true while any layer (or the loading overlay) is shown; the
//   game freezes the simulation and routes Escape to closeTop().
// - The main menu is a "base" layer: closeTop() never pops it.
// - Game input (camera keys etc.) is suspended while menus are open and
//   restored afterwards.
// - Every screen is built from the shared MenuCtx (see ctx.ts) so it can be
//   opened from anywhere (main menu, pause menu, chat commands, sandbox).
// ─────────────────────────────────────────────────────────────────────────────
import '../menus.css';
import type { Game } from '../../game/Game';
import type { SfxId } from '../../audio/AudioManager';
import type { ActionId, Settings } from '../../settings/types';
import { h } from '../dom';
import type { ConfirmOpts, MenuCtx, MenuLayer, MenuNav } from './ctx';
import { MenuTooltip } from './tooltip';
import { LoadingOverlay } from './loading';
import { SkylineBackground } from './skyline';
import { comboLabel } from './format';
import { btn, dialog } from './widgets';
import { mIcon, type MenuIcon } from './icons';
import { MainMenu } from './mainMenu';
import { openNewGameDialog } from './newGame';
import { openLoadDialog, openSaveDialog } from './saveLoad';
import { openPauseMenu } from './pause';
import { openOptionsDialog, type OptionsTab } from './options';
import { openCreditsDialog, openHelpDialog, openPhotoTipsDialog } from './help';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class MenuSystem {
  /** container for all menu layers (sits above the HUD) */
  private host!: HTMLElement;
  private layersEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private stack: MenuLayer[] = [];
  private closing = new Set<MenuLayer>();
  private ctx!: MenuCtx;
  private tooltip!: MenuTooltip;
  private loading!: LoadingOverlay;
  private skyline: SkylineBackground | null = null;
  private main: MainMenu | null = null;
  private built = false;
  /** input.enabled value to restore once every layer is closed */
  private savedInputEnabled: boolean | null = null;
  private savedChatOpen = false;
  private raf = 0;
  private lastT = 0;
  private lastFocus: HTMLElement | null = null;
  private enterTimers = new WeakMap<MenuLayer, number>();
  /** world present when the loading overlay appeared (to detect a new world) */
  private worldAtLoadStart: Game['world'] = null;

  constructor(protected game: Game, readonly root: HTMLElement) {}

  init(): void {
    if (this.built) return;
    this.built = true;
    this.layersEl = h('div', { class: 'mn-layers' });
    this.toastsEl = h('div', { class: 'mn-toasts', 'aria-live': 'polite' });
    this.host = h('div', { class: 'mn-root', 'aria-label': 'Menus' }, this.layersEl, this.toastsEl);
    this.root.append(this.host);
    this.tooltip = new MenuTooltip(this.host);
    this.ctx = this.makeCtx();
    this.loading = new LoadingOverlay(this.ctx);
    this.host.append(this.loading.el);
    this.applySettings(this.game.settings.value);
    this.game.events.on('settings:changed', (s) => this.applySettings(s));
    window.addEventListener('keydown', this.onKeyDown);
    // keep pointer/wheel/touch inside the menus from reaching the 3D view
    for (const t of ['pointerdown', 'wheel', 'contextmenu', 'dblclick']) {
      this.host.addEventListener(t, (e) => {
        if (this.stack.length || this.loading.visible) e.stopPropagation();
      });
    }
  }

  // ── public API (frozen) ──────────────────────────────────────────────────
  showMainMenu(): void {
    this.init();
    // anything stacked (pause, dialogs) is discarded when returning to the title
    this.closeAll(true, true);
    if (!this.main) this.main = new MainMenu(this.ctx);
    this.push(this.main.layer);
    this.main.refresh();
  }

  hideMainMenu(): void {
    if (!this.built) return;
    // leaving the title screen closes whatever was open on top of it too
    this.closeAll(true);
  }

  openNewGame(): void {
    this.init();
    if (this.has('newgame')) return;
    openNewGameDialog(this.ctx);
  }

  openOptions(tab?: OptionsTab): void {
    this.init();
    if (this.has('options')) return;
    openOptionsDialog(this.ctx, tab);
  }

  openPause(): void {
    this.init();
    if (!this.game.world || this.has('pause')) return;
    openPauseMenu(this.ctx);
  }

  openSaveDialog(): void {
    this.init();
    if (!this.game.world || this.has('save')) return;
    openSaveDialog(this.ctx);
  }

  openLoadDialog(): void {
    this.init();
    if (this.has('load')) return;
    openLoadDialog(this.ctx);
  }

  showLoading(text: string, progress: number): void {
    this.init();
    this.tooltip.hide();
    if (!this.loading.visible) this.worldAtLoadStart = this.game.world;
    this.loading.show(text, progress);
    this.syncInput();
  }

  hideLoading(): void {
    if (!this.built) return;
    // a new world arrived (new game / load): nothing from the menus should flash through
    const newWorld = !!this.game.world && this.game.world !== this.worldAtLoadStart;
    this.worldAtLoadStart = null;
    if (newWorld) this.closeAll(true, true);
    // loading failed on the title screen: give the skyline back to the main menu
    else if (this.main && this.has('main')) this.main.attachSky();
    this.loading.hide();
    this.syncInput();
    // the skyline keeps running only while something shows it
    if (!this.has('main')) window.setTimeout(() => this.maybeStopSky(), 600);
  }

  /** close the top-most menu; returns false if none open */
  closeTop(): boolean {
    if (!this.built) return false;
    if (this.loading.visible) return true;
    const top = this.stack[this.stack.length - 1];
    if (!top || top.base) return false;
    if (top.dismissible === false) return true;
    this.sfx('close', 0.8);
    this.pop(top);
    return true;
  }

  /** true while any blocking menu/dialog is open (game input suspended) */
  isOpen(): boolean {
    return this.built && (this.stack.length > 0 || this.loading.visible);
  }

  // ── additions ────────────────────────────────────────────────────────────
  /** open the How to Play cheat sheet */
  openHelp(): void {
    this.init();
    if (!this.has('help')) openHelpDialog(this.ctx);
  }

  openCredits(): void {
    this.init();
    if (!this.has('credits')) openCreditsDialog(this.ctx);
  }

  openPhotoTips(): void {
    this.init();
    if (!this.has('photo')) openPhotoTipsDialog(this.ctx);
  }

  /** themed confirm dialog (resolves false on cancel / Escape) */
  confirm(title: string, text: string, opts?: ConfirmOpts): Promise<boolean> {
    this.init();
    return this.ctx.confirm(title, text, opts);
  }

  /** transient message at the bottom of the menus */
  notify(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    this.init();
    this.ctx.notify(text, kind);
  }

  /** id of the top-most layer (or null) */
  topId(): string | null {
    return this.stack[this.stack.length - 1]?.id ?? null;
  }

  /** the shared menu context (sandbox / other screens) */
  get context(): MenuCtx {
    this.init();
    return this.ctx;
  }

  // ── stack ────────────────────────────────────────────────────────────────
  private has(id: string): boolean {
    return this.stack.some((l) => l.id === id);
  }

  private push(layer: MenuLayer): void {
    if (this.stack.includes(layer)) return;
    const prevTop = this.stack[this.stack.length - 1];
    if (!this.stack.length) this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.tooltip.hide();
    if (layer.base) {
      // base layers always sit at the bottom of the stack
      this.stack.unshift(layer);
      this.layersEl.prepend(layer.el);
    } else {
      this.stack.push(layer);
      this.layersEl.append(layer.el);
    }
    this.closing.delete(layer);
    layer.el.classList.remove('mn-leave');
    layer.el.classList.add('mn-enter');
    if (!this.ctx.reduced()) {
      // restart the entrance animation
      void layer.el.offsetWidth;
    }
    // drop the entrance class once the (longest) entrance animation is over
    window.clearTimeout(this.enterTimers.get(layer));
    this.enterTimers.set(layer, window.setTimeout(() => layer.el.classList.remove('mn-enter'), 480));
    if (prevTop && prevTop !== layer && !layer.base) prevTop.el.classList.add('mn-covered');
    this.syncInput();
    this.startLoop();
    // focus right away (keys pressed immediately land in the new layer), and
    // again after layout in case the first attempt could not take effect
    const focusLayer = () => {
      if (this.stack[this.stack.length - 1] !== layer) return;
      const active = document.activeElement;
      if (active && active !== document.body && layer.el.contains(active)) return;
      try {
        layer.focus?.();
      } catch {
        /* element not focusable yet */
      }
    };
    focusLayer();
    requestAnimationFrame(focusLayer);
  }

  private pop(layer?: MenuLayer): void {
    const l = layer ?? this.stack[this.stack.length - 1];
    if (!l) return;
    const i = this.stack.indexOf(l);
    if (i < 0) return;
    this.stack.splice(i, 1);
    this.tooltip.hide();
    this.removeEl(l, true);
    try {
      l.onClose?.();
    } catch (err) {
      console.error('[menus] onClose failed', err);
    }
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.el.classList.remove('mn-covered');
      if (i === this.stack.length) {
        top.onResume?.();
        requestAnimationFrame(() => {
          if (this.stack[this.stack.length - 1] !== top) return;
          const active = document.activeElement;
          if (!active || active === document.body || !top.el.contains(active)) top.focus?.();
        });
      }
    } else {
      // give focus back to the game
      const f = this.lastFocus;
      this.lastFocus = null;
      if (f && f.isConnected && !this.host.contains(f)) f.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement && this.host.contains(document.activeElement)) document.activeElement.blur();
    }
    this.syncInput();
    if (!this.has('main') && !this.loading.visible) window.setTimeout(() => this.maybeStopSky(), 450);
  }

  /** remove every layer (base too when `all`); `instant` skips exit animations */
  private closeAll(all = false, instant = false): void {
    for (const l of this.stack.slice().reverse()) {
      if (l.base && !all) continue;
      const i = this.stack.indexOf(l);
      this.stack.splice(i, 1);
      this.removeEl(l, !instant);
      try {
        l.onClose?.();
      } catch (err) {
        console.error('[menus] onClose failed', err);
      }
    }
    for (const l of this.stack) l.el.classList.remove('mn-covered');
    this.tooltip.hide();
    if (!this.stack.length && document.activeElement instanceof HTMLElement && this.host.contains(document.activeElement)) document.activeElement.blur();
    this.syncInput();
    if (!this.has('main') && !this.loading.visible) window.setTimeout(() => this.maybeStopSky(), 450);
  }

  private removeEl(l: MenuLayer, animate: boolean): void {
    if (!animate || this.ctx.reduced()) {
      l.el.remove();
      l.el.classList.remove('mn-leave', 'mn-enter', 'mn-covered');
      this.closing.delete(l);
      return;
    }
    this.closing.add(l);
    l.el.classList.remove('mn-enter');
    l.el.classList.add('mn-leave');
    window.setTimeout(() => {
      if (!this.closing.has(l)) return;
      this.closing.delete(l);
      if (!this.stack.includes(l)) l.el.remove();
      l.el.classList.remove('mn-leave', 'mn-covered');
    }, 230);
  }

  /** suspend game input while menus are open, restore it afterwards */
  private syncInput(): void {
    const input = this.game.input;
    if (!input) return;
    const open = this.isOpen();
    this.host.classList.toggle('active', open);
    if (open && this.savedInputEnabled === null) {
      this.savedInputEnabled = input.enabled;
      this.savedChatOpen = !!this.game.chat?.isOpen;
      input.enabled = false;
    } else if (!open && this.savedInputEnabled !== null) {
      // input was only off because the chat was open, and the chat has closed since
      const chatClosed = this.savedChatOpen && !this.game.chat?.isOpen;
      input.enabled = chatClosed ? true : this.savedInputEnabled;
      this.savedInputEnabled = null;
      this.savedChatOpen = false;
    }
  }

  private maybeStopSky(): void {
    if (this.skyline && !this.has('main') && !this.loading.visible) this.skyline.stop();
  }

  private startLoop(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.stack.length) {
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      for (const l of this.stack) {
        if (!l.update) continue;
        try {
          l.update(dt);
        } catch (err) {
          console.error('[menus] update failed', err);
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.stack.length || this.loading.visible || e.defaultPrevented && e.key !== 'Tab') return;
    const top = this.stack[this.stack.length - 1];
    if (top.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab') {
      this.trapFocus(top.el, e);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (this.arrowNav(top.el, e)) e.preventDefault();
    }
  };

  private trapFocus(scope: HTMLElement, e: KeyboardEvent): void {
    const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let n: number;
    if (i < 0) n = e.shiftKey ? items.length - 1 : 0;
    else n = (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
    e.preventDefault();
    items[n].focus();
  }

  /** arrow keys move focus inside containers marked data-nav="v" | "h" | "grid" */
  private arrowNav(scope: HTMLElement, e: KeyboardEvent): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !scope.contains(active)) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const first = scope.querySelector<HTMLElement>('[data-nav] ' + FOCUSABLE.split(',')[0]);
        if (first) {
          first.focus();
          return true;
        }
      }
      return false;
    }
    if (active.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return false;
    if (active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'range') return false;
    const nav = active.closest<HTMLElement>('[data-nav]');
    if (!nav || !scope.contains(nav)) return false;
    const mode = nav.dataset.nav;
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    if (mode === 'v' && !vertical) return false;
    if (mode === 'h' && vertical) return false;
    const items = Array.from(nav.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.closest('[data-nav]') === nav && el.offsetParent !== null);
    const i = items.indexOf(active);
    if (i < 0) return false;
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    let n = i;
    if (mode === 'grid' && vertical) {
      // move to the nearest item in the next/previous visual row
      const r = active.getBoundingClientRect();
      let best = -1;
      let bestD = Infinity;
      items.forEach((it, k) => {
        const q = it.getBoundingClientRect();
        const dy = fwd ? q.top - r.bottom : r.top - q.bottom;
        if (dy < -2) return;
        const d = dy * 4 + Math.abs(q.left + q.width / 2 - (r.left + r.width / 2));
        if (k !== i && d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best < 0) return true;
      n = best;
    } else {
      n = Math.max(0, Math.min(items.length - 1, i + (fwd ? 1 : -1)));
    }
    if (n !== i) {
      items[n].focus();
      this.sfx('hover', 0.4);
    }
    return true;
  }

  // ── settings ─────────────────────────────────────────────────────────────
  private applySettings(s: Settings): void {
    this.host.classList.toggle('reduced', !!s.ui.reducedMotion);
    this.tooltip.enabled = s.ui.tooltips !== false;
    if (!this.tooltip.enabled) this.tooltip.hide();
    this.skyline?.setReduced(!!s.ui.reducedMotion);
  }

  private sfx(id: SfxId, volume = 1): void {
    try {
      this.game.audio?.play(id, volume);
    } catch {
      /* audio not available */
    }
  }

  // ── context ──────────────────────────────────────────────────────────────
  private makeCtx(): MenuCtx {
    const self = this;
    const nav: MenuNav = {
      newGame: () => self.openNewGame(),
      load: () => self.openLoadDialog(),
      save: () => self.openSaveDialog(),
      options: (tab?: string) => self.openOptions(tab as OptionsTab | undefined),
      help: () => self.openHelp(),
      credits: () => self.openCredits(),
      photoTips: () => self.openPhotoTips(),
      pause: () => self.openPause(),
    };
    return {
      game: this.game,
      nav,
      sfx: (id, volume) => self.sfx(id, volume),
      tip: (el, text, key) => self.tooltip.attach(el, text, key),
      push: (l) => self.push(l),
      pop: (l) => self.pop(l),
      closeAll: (all) => self.closeAll(!!all),
      has: (id) => self.has(id),
      confirm: (title, text, opts) => self.showConfirm(title, text, opts),
      reduced: () => !!self.game.settings.value.ui.reducedMotion,
      notify: (text, kind) => self.showToast(text, kind ?? 'info'),
      key: (a: ActionId) => {
        const b = self.game.settings.value.controls.keybinds[a]?.[0];
        return b ? comboLabel(b) : '';
      },
      sky: () => {
        if (!self.skyline) {
          self.skyline = new SkylineBackground();
          self.skyline.reduced = !!self.game.settings.value.ui.reducedMotion;
        }
        return self.skyline;
      },
      loading: (text, p) => self.showLoading(text, p),
      hideLoading: () => self.hideLoading(),
    };
  }

  private showConfirm(title: string, text: string, opts: ConfirmOpts = {}): Promise<boolean> {
    return new Promise((resolve) => {
      let result = false;
      const cancel = btn(this.ctx, opts.cancel ?? 'Cancel', { kind: 'ghost', onClick: () => d.close() });
      const ok = btn(this.ctx, opts.ok ?? 'OK', {
        kind: opts.danger ? 'danger' : 'primary',
        onClick: () => {
          result = true;
          d.close();
        },
      });
      const icon = (opts.icon ?? (opts.danger ? 'alert' : 'help')) as MenuIcon;
      const d = dialog(this.ctx, {
        id: 'confirm',
        title,
        width: 440,
        cls: 'mn-confirm' + (opts.danger ? ' danger' : ''),
        body: [h('div', { class: 'mn-confirm-body' }, h('span', { class: 'mn-confirm-icon' }, mIcon(icon, 26)), h('p', null, text))],
        footer: [cancel, ok],
        onClose: () => resolve(result),
      });
      d.focus = () => (opts.danger ? cancel : ok).focus({ preventScroll: true });
      d.onKey = (e) => {
        if (e.key === 'Enter' && document.activeElement !== cancel) {
          result = true;
          this.sfx('click');
          d.close();
          return true;
        }
        return false;
      };
      this.sfx('open', 0.7);
      this.push(d);
    });
  }

  private showToast(text: string, kind: 'info' | 'good' | 'bad'): void {
    const icon: MenuIcon = kind === 'good' ? 'check' : kind === 'bad' ? 'alert' : 'info';
    const el = h('div', { class: `mn-toast ${kind}`, role: 'status' }, mIcon(icon, 16), h('span', null, text));
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove();
    if (kind === 'bad') this.sfx('error', 0.7);
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), this.ctx.reduced() ? 0 : 320);
    }, kind === 'bad' ? 4800 : 3200);
  }
}
