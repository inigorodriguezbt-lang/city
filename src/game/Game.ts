// ─────────────────────────────────────────────────────────────────────────────
// Game: constructs every system, owns the frame loop and world lifecycle.
// Owned by the integrator.
// ─────────────────────────────────────────────────────────────────────────────
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { MAX_SPEED_LEVEL, SPEEDS } from '../core/constants';
import { Layer, RoadType, type MapSettings } from '../core/types';
import { World } from '../world/World';
import { RoadSurface } from '../world/roadHeight';
import { WorldActions } from '../world/actions';
import { generateMap } from '../world/mapgen';
import { SettingsStore } from '../settings/SettingsStore';
import { GameRenderer } from '../render/Renderer';
import { RoadRenderer } from '../render/roads/RoadRenderer';
import { ZoneRenderer } from '../render/zones/ZoneRenderer';
import { BuildingRenderer } from '../render/buildings/BuildingRenderer';
import { VehicleRenderer } from '../render/vehicles/VehicleRenderer';
import { EffectsRenderer } from '../render/effects/EffectsRenderer';
import { registerServiceModels } from '../render/buildings/service';
import { Simulation } from '../sim/Simulation';
import { FieldSystem } from '../sim/fields/FieldSystem';
import { TrafficSystem } from '../sim/traffic/TrafficSystem';
import { EventSystem } from '../sim/events/EventSystem';
import { InputManager } from '../input/InputManager';
import { ToolManager } from '../tools/ToolManager';
import { UIManager } from '../ui/UIManager';
import { MenuSystem } from '../ui/menus/MenuSystem';
import { ChatConsole } from '../ui/chat/ChatConsole';
import { SaveManager } from '../save/SaveManager';
import { CommandRegistry } from '../commands/CommandRegistry';
import { AudioManager } from '../audio/AudioManager';
import { themeDef } from '../data/themes';

export function defaultMapSettings(): MapSettings {
  return {
    cityName: 'New Harbor',
    mapSize: 'medium',
    theme: 'temperate',
    seed: Math.floor(Math.random() * 1e9),
    style: 'european',
    difficulty: 'normal',
    creative: false,
    disasters: true,
    mountains: 0.5,
    water: 0.5,
    forests: 0.5,
  };
}

interface WorldSystem {
  onWorldLoaded?(w: World): void;
  onWorldUnloaded?(): void;
}

export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly settings: SettingsStore;
  world: World | null = null;
  /** road/bridge surface heights for the current world (null when no world) */
  roadSurface: RoadSurface | null = null;

  readonly renderer: GameRenderer;
  readonly input: InputManager;
  readonly actions: WorldActions;
  readonly tools: ToolManager;
  readonly sim: Simulation;
  readonly fields: FieldSystem;
  readonly traffic: TrafficSystem;
  readonly eventSystem: EventSystem;
  readonly roads: RoadRenderer;
  readonly zones: ZoneRenderer;
  readonly buildings: BuildingRenderer;
  readonly vehicles: VehicleRenderer;
  readonly effects: EffectsRenderer;
  readonly ui: UIManager;
  readonly menus: MenuSystem;
  readonly chat: ChatConsole;
  readonly saves: SaveManager;
  readonly commands: CommandRegistry;
  readonly audio: AudioManager;

  /** real seconds since start */
  time = 0;
  /** this frame's real dt and simulation-scaled dt (0 when paused) */
  dt = 0;
  simDt = 0;
  fps = 0;
  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private running = false;
  private loading = false;

  constructor(readonly viewport: HTMLElement, readonly uiRoot: HTMLElement) {
    // keep road deck cache fresh before any renderer reacts to the change
    this.events.on('world:changed', ({ rect, layers }) => {
      if (layers & (Layer.Road | Layer.Terrain | Layer.Water)) this.roadSurface?.invalidate(rect);
    });
    this.settings = new SettingsStore(this.events);
    this.settings.load();
    this.renderer = new GameRenderer(this, viewport);
    this.input = new InputManager(this, this.renderer.canvas);
    this.actions = new WorldActions(this);
    this.tools = new ToolManager(this);
    this.sim = new Simulation(this);
    this.fields = new FieldSystem(this);
    this.traffic = new TrafficSystem(this);
    this.eventSystem = new EventSystem(this);
    this.roads = new RoadRenderer(this);
    this.zones = new ZoneRenderer(this);
    this.buildings = new BuildingRenderer(this);
    this.vehicles = new VehicleRenderer(this);
    this.effects = new EffectsRenderer(this);
    this.ui = new UIManager(this, uiRoot);
    this.menus = new MenuSystem(this, uiRoot);
    this.chat = new ChatConsole(this, uiRoot);
    this.saves = new SaveManager(this);
    this.commands = new CommandRegistry(this);
    this.audio = new AudioManager(this);
  }

  /** systems notified on world load (in order) / unload (reverse order) */
  private get worldSystems(): WorldSystem[] {
    return [
      this.renderer, this.sim, this.fields, this.traffic, this.eventSystem,
      this.roads, this.zones, this.buildings, this.vehicles, this.effects,
      this.tools, this.ui,
    ];
  }

  async init(): Promise<void> {
    registerServiceModels();
    await this.renderer.init();
    this.input.init();
    this.ui.init();
    this.menus.init();
    this.chat.init();
    this.commands.init();
    this.audio.init();
    await this.saves.init();
    this.bindGlobalActions();
    this.events.on('settings:changed', (s) => {
      this.renderer.applySettings(s);
      this.ui.setScale(s.ui.scale);
    });
    this.renderer.applySettings(this.settings.value);
    this.ui.setScale(this.settings.value.ui.scale);
    // unlock audio on first gesture
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    this.menus.showMainMenu();
  }

  // ── world lifecycle ──────────────────────────────────────────────────────
  async newGame(partial: Partial<MapSettings> = {}): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const ms: MapSettings = { ...defaultMapSettings(), ...partial };
      if (!partial.style) ms.style = themeDef(ms.theme).defaultStyle;
      this.menus.hideMainMenu();
      this.menus.showLoading('Generating terrain…', 0);
      this.unloadWorld();
      const map = await generateMap(ms, (p, label) => this.menus.showLoading(label, p * 0.9));
      this.menus.showLoading('Founding the city…', 0.92);
      const world = new World(ms, map.size);
      world.applyGeneratedMap(map);
      // pre-built outside connections
      const placeLine = (cells: { x: number; y: number }[], type: RoadType) => {
        for (const c of cells) {
          const wet = world.isWater(c.x, c.y);
          world.setRoad(c.x, c.y, type, wet ? 1 : 0);
        }
      };
      placeLine(map.highway, RoadType.Highway);
      placeLine(map.rail, RoadType.Rail);
      await this.attachWorld(world);
      world.notify({ kind: 'good', title: `Welcome to ${ms.cityName}!`, text: 'Connect a road to the highway, zone some land, and provide power and water. Your citizens are waiting.', icon: '🏙️', x: world.home.x, y: world.home.y });
    } finally {
      this.loading = false;
    }
  }

  /** attach a created or deserialized world to all systems */
  async attachWorld(world: World): Promise<void> {
    this.unloadWorld();
    this.menus.showLoading('Building the city…', 0.95);
    this.world = world;
    world.bus = this.events;
    this.roadSurface = new RoadSurface(world);
    for (const s of this.worldSystems) s.onWorldLoaded?.(world);
    try {
      await this.fields.recomputeNow();
    } catch (e) {
      console.warn('initial field recompute failed', e);
    }
    this.events.emit('world:loaded', world);
    this.renderer.cameraCtl.flyTo(world.home.x, world.home.y, undefined, true);
    this.menus.hideLoading();
  }

  unloadWorld(): void {
    if (!this.world) return;
    this.events.emit('world:unloaded', null);
    const systems = this.worldSystems.slice().reverse();
    for (const s of systems) {
      try {
        s.onWorldUnloaded?.();
      } catch (e) {
        console.error('unload failed', e);
      }
    }
    this.actions.clearHistory();
    this.world.bus = null;
    this.world = null;
    this.roadSurface = null;
  }

  quitToMenu(): void {
    this.unloadWorld();
    this.menus.showMainMenu();
  }

  setCreative(on: boolean): void {
    if (!this.world) return;
    this.world.creative = on;
    this.events.emit('creative:changed', on);
    this.events.emit('unlocks:changed', null);
    this.events.emit('money:changed', this.world.economy.money);
  }

  get paused(): boolean {
    return !this.world || this.world.time.speed === 0;
  }

  // ── frame loop ───────────────────────────────────────────────────────────
  private frame = (t: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const limit = this.settings.value.graphics.fpsLimit;
    const elapsed = t - this.last;
    if (limit > 0 && elapsed < 1000 / limit - 1) return;
    const dt = Math.min(0.1, Math.max(0, elapsed / 1000));
    this.last = t;
    this.time += dt;
    this.dt = dt;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    try {
      this.step(dt);
    } catch (err) {
      console.error('[frame] error', err);
    }
  };

  private step(dt: number): void {
    const w = this.world;
    const blocked = this.menus.isOpen();
    this.input.update(dt);
    if (w) {
      const speed = blocked ? 0 : SPEEDS[w.time.speed] ?? 0;
      this.simDt = dt * speed;
      if (!blocked) {
        w.playTime += dt;
        this.tools.update(dt);
        this.sim.update(dt);
        this.fields.update(dt);
        this.traffic.update(dt);
        this.eventSystem.update(dt);
      }
      w.flushChanges();
      this.roads.update(dt);
      this.zones.update(dt);
      this.buildings.update(dt);
      this.vehicles.update(dt);
      this.effects.update(dt);
    } else {
      this.simDt = 0;
    }
    this.renderer.update(dt);
    this.renderer.render();
    this.ui.update(dt);
    this.saves.update(dt);
    this.audio.update(dt);
  }

  // ── global key actions ───────────────────────────────────────────────────
  private bindGlobalActions(): void {
    const i = this.input;
    const inGame = () => !!this.world && !this.menus.isOpen() && !this.chat.isOpen;
    i.onAction('game.pause', () => inGame() && this.sim.togglePause());
    i.onAction('game.speed1', () => inGame() && this.sim.setSpeed(1));
    i.onAction('game.speed2', () => inGame() && this.sim.setSpeed(2));
    i.onAction('game.speed3', () => inGame() && this.sim.setSpeed(3));
    i.onAction('game.speed4', () => inGame() && this.sim.setSpeed(MAX_SPEED_LEVEL));
    i.onAction('game.quicksave', () => inGame() && void this.saves.quicksave());
    i.onAction('game.quickload', () => !!this.world && !this.chat.isOpen && void this.saves.quickload());
    i.onAction('edit.undo', () => inGame() && this.actions.undo());
    i.onAction('edit.redo', () => inGame() && this.actions.redo());
    i.onAction('ui.chat', () => {
      // a tool may claim Enter (e.g. finishing a transit line)
      const t = this.tools.current as { wantsEnter?: () => boolean } | null;
      if (t?.wantsEnter?.()) return;
      if (inGame()) this.chat.open();
    });
    i.onAction('ui.command', () => inGame() && this.chat.open('/'));
    i.onAction('ui.toggleHud', () => inGame() && this.ui.setHudVisible(!this.ui.hudVisible));
    i.onAction('ui.screenshot', () => !!this.world && void this.downloadScreenshot());
    i.onAction('tool.bulldoze', () => inGame() && this.tools.setTool(this.tools.current?.id === 'bulldoze' ? null : 'bulldoze'));
    i.onAction('camera.reset', () => inGame() && this.renderer.cameraCtl.reset());
    i.onAction('ui.debug', () => this.settings.set({ graphics: { showFps: !this.settings.value.graphics.showFps } }));
    i.onAction('tool.cancel', () => {
      if (this.chat.isOpen) return this.chat.close();
      if (this.menus.closeTop()) return;
      if (!this.world) return;
      if (this.tools.current) return this.tools.cancel();
      if (this.ui.closePanels()) return;
      this.menus.openPause();
    });
  }

  async downloadScreenshot(): Promise<void> {
    const url = await this.renderer.screenshot();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.world?.settings.cityName ?? 'urbis'}-${Date.now()}.jpg`;
    a.click();
    this.audio.play('click');
    this.ui.toast('Screenshot saved', 'good');
  }
}
