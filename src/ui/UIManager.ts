// ─────────────────────────────────────────────────────────────────────────────
// UIManager — owned by the "ui-hud" agent. Builds and drives the in-game HUD:
// top bar, bottom toolbar + palette, hint bar, notifications, minimap, info
// view legend, tutorial/advisor, inspector, photo mode, perf overlay and all
// panels. Public API of the original stub is preserved (additions only).
// The HUD lives in its own `.hud` container inside the shared #ui root; menus
// and chat (other module) build their own containers next to it.
// ─────────────────────────────────────────────────────────────────────────────
import './hud.css';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Settings } from '../settings/types';
import type { SfxId } from '../audio/AudioManager';
import { h, isolate } from './dom';
import { Tooltips } from './hud/Tooltip';
import { Dialogs, type ConfirmOptions } from './hud/Dialogs';
import { TopBar } from './hud/TopBar';
import { Toolbar } from './hud/Toolbar';
import { Notifications } from './hud/Notifications';
import { Minimap } from './hud/Minimap';
import { PerfOverlay } from './hud/PerfOverlay';
import { PhotoMode } from './hud/PhotoMode';
import { Tutorial } from './hud/Tutorial';
import { Inspector } from './hud/Inspector';
import { Legend } from './hud/Legend';
import { icon, type IconName } from './hud/icons';
import { setClass, setText, type HudContext } from './hud/context';
import type { Panel } from './panels/Panel';
import { BudgetPanel } from './panels/BudgetPanel';
import { StatsPanel } from './panels/StatsPanel';
import { GraphsPanel } from './panels/GraphsPanel';
import { PoliciesPanel } from './panels/PoliciesPanel';
import { MilestonesPanel } from './panels/MilestonesPanel';
import { DistrictsPanel } from './panels/DistrictsPanel';
import { TransitPanel } from './panels/TransitPanel';
import { SearchPanel } from './panels/SearchPanel';
import { OverlaysPanel } from './panels/OverlaysPanel';
import { NoticesPanel } from './panels/NoticesPanel';

export type PanelId =
  | 'budget' | 'stats' | 'policies' | 'milestones' | 'districts' | 'transit' | 'overlays' | 'notices' | 'graphs' | 'search';

/** optional argument for openPanel: a sub page or a target id */
export type PanelArg = string | number | undefined;

const MORE_ITEMS: { id: PanelId | 'photo' | 'minimap' | 'menu'; icon: IconName; label: string }[] = [
  { id: 'budget', icon: 'budget', label: 'Budget' },
  { id: 'stats', icon: 'stats', label: 'Statistics' },
  { id: 'graphs', icon: 'graph', label: 'Graphs' },
  { id: 'policies', icon: 'policy', label: 'Policies' },
  { id: 'milestones', icon: 'trophy', label: 'Milestones' },
  { id: 'districts', icon: 'map', label: 'Districts' },
  { id: 'transit', icon: 'bus', label: 'Transit' },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'minimap', icon: 'compass', label: 'Minimap' },
  { id: 'photo', icon: 'aperture', label: 'Photo mode' },
  { id: 'menu', icon: 'menu', label: 'Game menu' },
];

export class UIManager {
  protected world: World | null = null;
  hudVisible = true;
  /** HUD container (child of root) */
  readonly el: HTMLElement;
  /** modal layer: dialogs + tooltip (above everything, survives F1) */
  private modal: HTMLElement;
  private ctx: HudContext;
  private built = false;
  private scale = 1;
  private tips!: Tooltips;
  private dialogs!: Dialogs;
  private top!: TopBar;
  toolbar!: Toolbar;
  private notes!: Notifications;
  private minimap!: Minimap;
  private perf!: PerfOverlay;
  private photo!: PhotoMode;
  private tutorial!: Tutorial;
  private inspector!: Inspector;
  private legend!: Legend;
  private panels = new Map<PanelId, Panel>();
  private panelHost!: HTMLElement;
  private openId: PanelId | null = null;
  private pausedEl!: HTMLElement;
  private moreEl!: HTMLElement;
  private flashEl!: HTMLElement;
  private tipAcc = 0;
  private unread = 0;

  constructor(protected game: Game, readonly root: HTMLElement) {
    this.el = h('div', { class: 'hud', 'aria-label': 'City interface' });
    this.modal = h('div', { class: 'hud-modal' });
    const self = this;
    this.ctx = {
      game,
      get ui() {
        return self;
      },
      get tips() {
        return self.tips;
      },
      world: () => self.world,
      sfx: (id: SfxId, volume?: number) => {
        try {
          game.audio?.play(id, volume);
        } catch {
          /* audio unavailable */
        }
      },
      key: (action) => {
        try {
          return game.input.bindingLabel(action) || '';
        } catch {
          return '';
        }
      },
      scale: () => self.scale,
      inGame: () => !!self.world && !game.menus?.isOpen() && !game.chat?.isOpen,
      compact: () => self.el.classList.contains('compact'),
      flyTo: (x, y, distance, instant) => {
        game.events.emit('camera:flyTo', { x, y, distance, instant });
        try {
          game.renderer.cameraCtl.flyTo(x, y, distance, instant);
        } catch {
          /* camera not ready */
        }
      },
    };
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  init(): void {
    if (this.built) return;
    this.built = true;
    const game = this.game;
    this.root.append(this.el, this.modal);
    this.tips = new Tooltips(this.modal, { scale: () => this.scale, enabled: () => game.settings.value.ui.tooltips });
    this.dialogs = new Dialogs(this.modal, this.ctx);

    this.top = new TopBar(this.ctx);
    this.toolbar = new Toolbar(this.ctx);
    this.notes = new Notifications(this.ctx);
    this.minimap = new Minimap(this.ctx);
    this.perf = new PerfOverlay(this.ctx);
    this.photo = new PhotoMode(this.ctx);
    this.tutorial = new Tutorial(this.ctx);
    this.inspector = new Inspector(this.ctx);
    this.legend = new Legend(this.ctx);

    this.pausedEl = h('div', { class: 'hud-paused hud-pe' },
      h('span', { class: 'hud-paused-dot' }), 'Paused',
      h('button', { class: 'hud-paused-go', onclick: () => game.sim.togglePause() }, icon('chevronRight', 13), 'Resume', h('kbd', { class: 'hud-kbd' }, this.ctx.key('game.pause') || 'Space')));
    this.panelHost = h('div', { class: 'hud-panels' });
    this.moreEl = isolate(h('div', { class: 'hud-more hud-pe', role: 'menu' },
      ...MORE_ITEMS.map((m) => h('button', { class: 'hud-more-item', 'data-id': m.id, onclick: () => this.onMore(m.id) }, icon(m.icon, 22), h('span', null, m.label)))));
    this.flashEl = h('div', { class: 'hud-flash' });

    const left = h('div', { class: 'hud-left' }, this.perf.el, this.tutorial.el, this.tutorial.advisorEl);
    const pe = (el: HTMLElement) => isolate(el);
    this.el.append(
      pe(this.top.el),
      this.pausedEl,
      left,
      this.notes.stack,
      this.inspector.el,
      this.minimap.el,
      pe(this.legend.el),
      pe(this.toolbar.el),
      this.panelHost,
      this.notes.celebration,
      this.photo.el,
      this.moreEl,
      this.flashEl);
    for (const el of [left, this.notes.stack, this.notes.celebration]) isolate(el);

    const panels: Panel[] = [
      new BudgetPanel(this.ctx), new StatsPanel(this.ctx), new GraphsPanel(this.ctx), new PoliciesPanel(this.ctx),
      new MilestonesPanel(this.ctx), new DistrictsPanel(this.ctx), new TransitPanel(this.ctx), new SearchPanel(this.ctx),
      new OverlaysPanel(this.ctx), new NoticesPanel(this.ctx),
    ];
    for (const p of panels) {
      this.panels.set(p.opts.id, p);
      p.mount(this.panelHost);
    }

    this.bindActions();
    this.bindEvents();
    window.addEventListener('resize', () => this.layout());
    // click outside closes the "more" menu
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement | null;
      if (this.moreEl.classList.contains('open') && t && !this.moreEl.contains(t) && !t.closest('[data-id="more"]')) this.closeMore();
    }, true);
    this.applySettings(game.settings.value);
    this.layout();
    if (this.world) this.onWorldLoaded(this.world);
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    if (!this.built) return;
    this.closeAll();
    this.notes.clear();
    this.top.onWorld();
    this.toolbar.onWorld();
    this.minimap.attach(world);
    this.tutorial.attach(world);
    for (const p of this.panels.values()) p.reset();
    this.legend.set(this.game.renderer.overlay);
    this.el.classList.add('live');
    this.el.classList.remove('photo');
    this.top.reflectSpeed(world.time.speed);
    this.refreshUnread();
    this.layout();
  }

  onWorldUnloaded(): void {
    this.world = null;
    if (!this.built) return;
    this.closeAll();
    this.notes.clear();
    this.minimap.attach(null);
    this.tutorial.attach(null);
    this.tips.hide();
    this.el.classList.remove('live');
  }

  update(dt: number): void {
    if (!this.built || !this.world) return;
    const w = this.world;
    this.top.update(dt);
    this.toolbar.update(dt);
    this.notes.update(dt);
    this.minimap.update();
    this.perf.update(dt);
    this.photo.update(dt);
    this.tutorial.update(dt);
    this.inspector.update(dt);
    if (this.openId) this.panels.get(this.openId)?.tick(dt);
    this.tipAcc += dt;
    if (this.tipAcc > 0.25) {
      this.tipAcc = 0;
      this.tips.refresh();
    }
    const menus = this.game.menus;
    setClass(this.pausedEl, 'show', w.time.speed === 0 && !(menus?.isOpen() ?? false) && !this.photo.active);
  }

  // ── public API ─────────────────────────────────────────────────────────
  toast(text: string, kind: 'info' | 'good' | 'warning' | 'danger' = 'info'): void {
    if (!this.built) {
      console.info(`[toast:${kind}]`, text);
      return;
    }
    this.notes.toast(text, kind);
  }

  openBuildingInfo(id: number): void {
    if (!this.built || !this.world?.getBuilding(id)) return;
    if (this.photo.active) this.setPhotoMode(false);
    this.inspector.openBuilding(id);
  }

  /** open a panel (closing any other). `arg`: budget/milestones page, policies district id, transit line id. */
  openPanel(id: PanelId, arg?: PanelArg): void {
    if (!this.built || !this.world) return;
    const p = this.panels.get(id);
    if (!p) return;
    if (this.photo.active) this.setPhotoMode(false);
    this.closeMore();
    if (id === 'budget' && typeof arg === 'string') (p as BudgetPanel).setPage(arg as 'overview' | 'taxes' | 'services' | 'loans');
    if (id === 'milestones' && typeof arg === 'string') (p as MilestonesPanel).setPage(arg as 'milestones' | 'achievements');
    if (id === 'policies') (p as PoliciesPanel).setScope(typeof arg === 'number' ? arg : 0);
    if (id === 'transit' && typeof arg === 'number') (p as TransitPanel).focus(arg);
    if (this.openId === id) {
      p.open();
      return;
    }
    if (this.openId) this.panels.get(this.openId)?.close();
    this.openId = id;
    p.open();
    this.el.classList.add('panel-open');
    this.el.dataset.panel = id;
    this.top.setPanelOpen(id);
    this.ctx.sfx('open', 0.6);
    // palettes and big panels compete for the same space on phones
    if (this.ctx.compact()) this.toolbar.close();
  }

  togglePanel(id: PanelId): void {
    if (this.openId === id) this.closePanel(id);
    else this.openPanel(id);
  }

  /** close one panel if it is open */
  closePanel(id: PanelId): void {
    if (this.openId !== id) return;
    this.panels.get(id)?.close();
    this.openId = null;
    this.el.classList.remove('panel-open');
    delete this.el.dataset.panel;
    this.top.setPanelOpen(null);
    this.tips.hide();
    this.ctx.sfx('close', 0.5);
  }

  /** Esc chain step: closes the top-most HUD layer; returns true if something closed */
  closePanels(): boolean {
    if (!this.built) return false;
    if (this.dialogs.cancelTop()) return true;
    if (this.notes.hideCelebration()) return true;
    if (this.photo.active) {
      this.setPhotoMode(false);
      return true;
    }
    if (this.closeMore()) return true;
    if (this.openId) {
      this.closePanel(this.openId);
      return true;
    }
    if (this.toolbar.close()) return true;
    if (this.inspector.close()) return true;
    return false;
  }

  setHudVisible(v: boolean): void {
    this.hudVisible = v;
    if (this.built) {
      setClass(this.el, 'hidden', !v);
      if (!v) this.tips.hide();
    }
    this.game.events.emit('ui:hud', v);
  }

  confirm(title: string, text: string): Promise<boolean> {
    if (!this.built) return Promise.resolve(window.confirm(`${title}\n\n${text}`));
    return this.dialogs.confirm(title, text);
  }

  /** confirm with options (danger styling, button labels, badge icon) */
  confirmEx(title: string, text: string, opts: ConfirmOptions): Promise<boolean> {
    if (!this.built) return Promise.resolve(window.confirm(`${title}\n\n${text}`));
    return this.dialogs.confirm(title, text, opts);
  }

  prompt(title: string, def = ''): Promise<string | null> {
    if (!this.built) return Promise.resolve(window.prompt(title, def));
    return this.dialogs.prompt(title, def);
  }

  /** apply GUI scale (0.6..2) */
  setScale(s: number): void {
    const v = Math.max(0.6, Math.min(2, Number.isFinite(s) ? s : 1));
    this.scale = v;
    document.documentElement.style.setProperty('--ui-scale', String(v));
    if (this.built) this.layout();
  }

  // ── additions used by HUD components ───────────────────────────────────
  setPhotoMode(on: boolean): void {
    if (!this.built) return;
    if (on === this.photo.active) return;
    if (on) {
      if (!this.world) return;
      if (this.openId) this.closePanel(this.openId);
      this.toolbar.close();
      this.inspector.close();
      this.closeMore();
      this.tips.hide();
      this.photo.enter();
      this.ctx.sfx('open', 0.6);
    } else {
      this.photo.exit();
      this.ctx.sfx('close', 0.6);
    }
    setClass(this.el, 'photo', on);
  }

  isPhotoMode(): boolean {
    return this.built && this.photo.active;
  }

  /** is any HUD panel open */
  get openPanelId(): PanelId | null {
    return this.openId;
  }

  /** recount unread notices (badge) */
  refreshUnread(): void {
    const w = this.world;
    let n = 0;
    if (w) for (const x of w.notices) if (!x.read && (x.kind !== 'chirp' || this.game.settings.value.ui.chirps)) n++;
    this.unread = n;
    if (this.built) this.top.setUnread(n);
  }

  get unreadCount(): number {
    return this.unread;
  }

  /** white camera-flash effect (screenshots) */
  flash(): void {
    if (!this.built || this.game.settings.value.ui.reducedMotion) return;
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  toggleMore(): void {
    if (this.moreEl.classList.contains('open')) this.closeMore();
    else {
      this.moreEl.classList.add('open');
      this.ctx.sfx('open', 0.5);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────
  /** close every HUD layer (world load/unload) */
  private closeAll(): void {
    this.setPhotoMode(false);
    this.notes.hideCelebration(true);
    this.closeMore();
    if (this.openId) this.closePanel(this.openId);
    this.toolbar.close();
    this.inspector.close();
    this.tips.hide();
  }

  private closeMore(): boolean {
    if (!this.moreEl?.classList.contains('open')) return false;
    this.moreEl.classList.remove('open');
    return true;
  }

  private onMore(id: (typeof MORE_ITEMS)[number]['id']): void {
    this.closeMore();
    if (id === 'photo') this.setPhotoMode(true);
    else if (id === 'minimap') this.game.settings.set({ ui: { minimap: !this.game.settings.value.ui.minimap } });
    else if (id === 'menu') this.game.menus.openPause();
    else this.openPanel(id);
  }

  private bindActions(): void {
    const g = this.game;
    const i = g.input;
    const ok = () => this.ctx.inGame() && !this.dialogs.isOpen();
    i.onAction('ui.budget', () => ok() && this.togglePanel('budget'));
    i.onAction('ui.stats', () => ok() && this.togglePanel('stats'));
    i.onAction('ui.overlays', () => ok() && this.togglePanel('overlays'));
    i.onAction('ui.policies', () => ok() && this.togglePanel('policies'));
    i.onAction('ui.milestones', () => ok() && this.togglePanel('milestones'));
    i.onAction('ui.search', () => ok() && this.togglePanel('search'));
    i.onAction('ui.minimap', () => ok() && g.settings.set({ ui: { minimap: !g.settings.value.ui.minimap } }));
    i.onAction('ui.photoMode', () => ok() && this.setPhotoMode(!this.photo.active));
    i.onAction('tool.roads', () => ok() && !this.photo.active && this.toolbar.toggle('roads'));
    i.onAction('tool.zoning', () => ok() && !this.photo.active && this.toolbar.toggle('zoning'));
    i.onAction('tool.services', () => ok() && !this.photo.active && this.toolbar.cycleServices());
  }

  private bindEvents(): void {
    const ev = this.game.events;
    ev.on('notice', (n) => {
      if (!this.world) return;
      if (!this.photo.active && this.hudVisible) this.notes.notice(n);
      this.refreshUnread();
    });
    ev.on('milestone', (m) => this.world && this.notes.milestone(m));
    ev.on('achievement', (a) => this.world && this.notes.achievement(a));
    ev.on('time:speed', (s) => this.built && this.top.reflectSpeed(s));
    ev.on('settings:changed', (s) => this.applySettings(s));
    ev.on('select', (sel) => {
      if (!this.world) return;
      if (!sel) {
        this.inspector.close();
        return;
      }
      if (sel.buildingId !== undefined) this.openBuildingInfo(sel.buildingId);
      else if (sel.vehicleId !== undefined) this.inspector.openVehicle(sel.vehicleId);
      else if (sel.lineId !== undefined) this.openPanel('transit', sel.lineId);
      else this.inspector.close();
    });
    ev.on('tool:changed', (id) => {
      // painting districts: keep district colours visible
      if (id === 'district') {
        try {
          this.game.zones.setDistrictsVisible(true);
        } catch {
          /* ignore */
        }
      } else if (this.openId !== 'districts') {
        try {
          this.game.zones.setDistrictsVisible(false);
        } catch {
          /* ignore */
        }
      }
    });
  }

  private applySettings(s: Settings): void {
    if (!this.built) return;
    this.minimap.setVisible(s.ui.minimap);
    this.perf.setVisible(s.graphics.showFps);
    this.tutorial.refreshVisibility();
    setClass(this.el, 'reduced-motion', s.ui.reducedMotion);
    setClass(this.modal, 'reduced-motion', s.ui.reducedMotion);
    if (this.photo.active) this.photo.sync();
    if (!s.ui.tooltips) this.tips.hide();
    this.refreshUnread();
    const mm = this.moreEl.querySelector<HTMLElement>('[data-id="minimap"] span');
    if (mm) setText(mm, s.ui.minimap ? 'Hide minimap' : 'Show minimap');
  }

  private layout(): void {
    const s = this.scale || 1;
    const w = window.innerWidth / s, hgt = window.innerHeight / s;
    const compact = w < 700;
    setClass(this.el, 'compact', compact);
    setClass(this.el, 'stack', w < 1000);
    setClass(this.el, 'narrow', w < 1600);
    setClass(this.el, 'tight', w < 1360);
    setClass(this.el, 'short', hgt < 640);
    setClass(this.modal, 'compact', compact);
  }
}
