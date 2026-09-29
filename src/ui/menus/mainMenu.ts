// Main menu: full-screen animated skyline, URBIS logotype and the primary
// navigation (Continue / New City / Load / Options / How to Play / Credits).
import { h } from '../dom';
import { formatMoney, formatNumber } from '../../core/util';
import type { SaveMeta } from '../../save/SaveManager';
import type { MenuCtx, MenuLayer } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { timeAgo } from './format';
import { kbd } from './widgets';
import { version } from '../../../package.json';

export const URBIS_VERSION: string = version;

interface NavItem {
  id: string;
  icon: MenuIcon;
  label: string;
  sub: string;
  run: () => void;
}

export class MainMenu {
  readonly layer: MenuLayer;
  private nav: HTMLElement;
  private cont: HTMLButtonElement;
  private contSub: HTMLElement;
  private contAgo: HTMLElement;
  private contThumb: HTMLElement;
  private stage: HTMLElement;
  private recent: SaveMeta | null = null;
  private refreshSeq = 0;

  constructor(private ctx: MenuCtx) {
    this.contSub = h('span', { class: 'mn-mi-sub' }, '');
    this.contAgo = h('span', { class: 'mn-mi-ago' }, '');
    this.contThumb = h('span', { class: 'mn-mi-thumb' });
    this.cont = h('button', { class: 'mn-mi primary', type: 'button', hidden: true },
      h('span', { class: 'mn-mi-icon' }, mIcon('play', 20)),
      h('span', { class: 'mn-mi-txt' }, h('span', { class: 'mn-mi-label' }, 'Continue', this.contAgo), this.contSub),
      this.contThumb,
      h('span', { class: 'mn-mi-go' }, mIcon('chevronRight', 18)));
    this.cont.addEventListener('click', () => void this.continueRecent());
    ctx.tip(this.cont, () => {
      const r = this.recent;
      return r ? `“${r.name}” · ${formatMoney(r.money)} · saved ${new Date(r.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    });
    this.hover(this.cont);

    const items: NavItem[] = [
      { id: 'new', icon: 'plus', label: 'New City', sub: 'Found a city on a fresh landscape', run: () => ctx.nav.newGame() },
      { id: 'load', icon: 'folder', label: 'Load City', sub: 'Saved cities, imports & exports', run: () => ctx.nav.load() },
      { id: 'options', icon: 'sliders', label: 'Options', sub: 'Graphics, interface, controls & audio', run: () => ctx.nav.options() },
      { id: 'help', icon: 'help', label: 'How to Play', sub: 'Controls, first steps & tips', run: () => ctx.nav.help() },
      { id: 'credits', icon: 'heart', label: 'Credits', sub: 'The people and tools behind URBIS', run: () => ctx.nav.credits() },
    ];
    this.nav = h('nav', { class: 'mn-main-nav', 'data-nav': 'v', 'aria-label': 'Main menu' }, this.cont);
    items.forEach((it, i) => {
      const b = h('button', { class: 'mn-mi', type: 'button', style: `--d:${i + 1}` },
        h('span', { class: 'mn-mi-icon' }, mIcon(it.icon, 20)),
        h('span', { class: 'mn-mi-txt' }, h('span', { class: 'mn-mi-label' }, it.label), h('span', { class: 'mn-mi-sub' }, it.sub)),
        h('span', { class: 'mn-mi-go' }, mIcon('chevronRight', 18)));
      b.dataset.id = it.id;
      b.addEventListener('click', () => {
        ctx.sfx('open', 0.8);
        it.run();
      });
      this.hover(b);
      this.nav.append(b);
    });

    const letters = 'URBIS'.split('').map((c, i) => h('span', { style: `--i:${i}` }, c));
    this.stage = h('div', { class: 'mn-main-stage' });
    const el = h('div', { class: 'mn-layer mn-main' },
      this.stage,
      h('div', { class: 'mn-main-shade' }),
      h('div', { class: 'mn-main-inner' },
        h('header', { class: 'mn-brand' },
          h('div', { class: 'mn-logo', 'aria-label': 'URBIS' }, ...letters),
          h('div', { class: 'mn-tagline' }, h('span', null, 'Build the city of your dreams'))),
        this.nav),
      h('footer', { class: 'mn-main-foot' },
        h('span', { class: 'mn-ver' }, `URBIS ${URBIS_VERSION}`),
        h('span', { class: 'mn-foot-dot' }),
        h('span', { class: 'mn-foot-txt' }, 'Procedural city builder · WebGL'),
        h('span', { class: 'mn-foot-keys' }, kbd('↑'), kbd('↓'), h('span', null, 'Navigate'), kbd('Enter'), h('span', null, 'Select'))));

    this.layer = {
      id: 'main',
      el,
      base: true,
      dismissible: false,
      focus: () => {
        const first = this.nav.querySelector<HTMLButtonElement>('.mn-mi:not([hidden])');
        first?.focus({ preventScroll: true });
      },
      onResume: () => void this.refresh(),
      onClose: () => {
        // the skyline canvas may be borrowed by the loading overlay later
      },
    };
  }

  private hover(b: HTMLElement): void {
    b.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType !== 'touch') this.ctx.sfx('hover', 0.35);
    });
  }

  /** (re)attach the shared skyline canvas to the title screen and run it */
  attachSky(): void {
    const sky = this.ctx.sky();
    if (sky.canvas.parentElement !== this.stage) this.stage.append(sky.canvas);
    sky.setReduced(this.ctx.reduced());
    sky.start();
  }

  /** re-read saves (Continue button) and make sure the skyline is running */
  async refresh(): Promise<void> {
    this.attachSky();
    const seq = ++this.refreshSeq;
    let list: SaveMeta[] = [];
    try {
      list = await this.ctx.game.saves.list();
    } catch (err) {
      console.warn('[menus] could not list saves', err);
    }
    if (seq !== this.refreshSeq) return;
    const recent = list.slice().sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
    this.recent = recent;
    const wasHidden = this.cont.hidden;
    this.cont.hidden = !recent;
    if (!recent) return;
    this.contAgo.textContent = timeAgo(recent.savedAt);
    this.contSub.replaceChildren(
      h('b', null, recent.cityName || recent.name),
      h('span', { class: 'mn-mi-meta' }, ` · ${formatNumber(recent.population, true)} citizens`));
    this.contThumb.replaceChildren();
    if (recent.thumbnail) this.contThumb.append(h('img', { src: recent.thumbnail, alt: '', draggable: false }));
    this.contThumb.style.display = recent.thumbnail ? '' : 'none';
    // the Continue button just appeared: move the initial focus onto it
    const active = document.activeElement;
    const onFirst = active === this.nav.querySelector('.mn-mi:not(.primary)');
    if (wasHidden && this.layer.el.isConnected && !this.layer.el.classList.contains('mn-covered') && (onFirst || !active || active === document.body)) {
      this.cont.focus({ preventScroll: true });
    }
  }

  private async continueRecent(): Promise<void> {
    const r = this.recent;
    if (!r) return;
    this.ctx.sfx('open');
    this.cont.disabled = true;
    try {
      const ok = await this.ctx.game.saves.load(r.id);
      if (!ok) {
        this.ctx.hideLoading();
        this.ctx.notify(`Could not load “${r.name}”. The save may be damaged.`, 'bad');
      }
    } catch (err) {
      console.error('[menus] continue failed', err);
      this.ctx.hideLoading();
      this.ctx.notify('Loading failed: ' + String((err as Error)?.message ?? err), 'bad');
    } finally {
      this.cont.disabled = false;
    }
  }
}
