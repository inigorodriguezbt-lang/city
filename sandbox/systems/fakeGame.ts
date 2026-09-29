// Minimal Game stand-in for the systems sandbox: the REAL World, SaveManager,
// CommandRegistry and AudioManager plus lightweight fakes for everything else
// (other agents' modules are written in parallel).
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import {
  Dir, ZoneType, type ActiveEvent, type Cell, type EventDef, type FieldId, type MapSettings, type PlacementCheck, type Rect, type WeatherType,
} from '../../src/core/types';
import { World } from '../../src/world/World';
import { defaultSettings, type Settings } from '../../src/settings/types';
import { buildingDef } from '../../src/data/buildings';
import { SaveManager } from '../../src/save/SaveManager';
import { CommandRegistry } from '../../src/commands/CommandRegistry';
import { AudioManager } from '../../src/audio/AudioManager';
import type { ChatKind } from '../../src/ui/chat/ChatConsole';
import type { Game } from '../../src/game/Game';

export function mapSettings(over: Partial<MapSettings> = {}): MapSettings {
  return {
    cityName: 'Sandbox Bay', mapSize: 'small', theme: 'temperate', seed: 4242, style: 'european', difficulty: 'normal',
    creative: false, disasters: true, mountains: 0.4, water: 0.4, forests: 0.5, ...over,
  };
}

function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') deepMerge(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
    else dst[k] = v;
  }
}

const EVENTS: EventDef[] = [
  { id: 'tornado', name: 'Tornado', description: '', icon: '🌪️', severity: 'disaster', yearlyChance: 0.1, minPopulation: 0, duration: 1, summonable: true, disaster: true },
  { id: 'meteor', name: 'Meteor Strike', description: '', icon: '☄️', severity: 'disaster', yearlyChance: 0.02, minPopulation: 0, duration: 0, summonable: true, disaster: true },
  { id: 'festival', name: 'Summer Festival', description: '', icon: '🎉', severity: 'good', yearlyChance: 0.5, minPopulation: 0, duration: 3, summonable: true },
  { id: 'ufo', name: 'UFO Sighting', description: '', icon: '🛸', severity: 'info', yearlyChance: 0.01, minPopulation: 0, duration: 1, summonable: true },
  { id: 'earthquake', name: 'Earthquake', description: '', icon: '🌋', severity: 'disaster', yearlyChance: 0.03, minPopulation: 0, duration: 0, summonable: true, disaster: true },
];

export interface FakeLog {
  chat: { text: string; kind: ChatKind }[];
  toasts: { text: string; kind: string }[];
  flights: { x: number; y: number; distance?: number }[];
  weather: { type: WeatherType; days?: number }[];
  triggers: { id: string; at?: Cell }[];
  overlays: (FieldId | null)[];
  zoned: Rect[];
  loading: string[];
}

export class FakeGame {
  readonly events = new EventBus<GameEvents>();
  world: World | null = null;
  fps = 60;
  readonly log: FakeLog = { chat: [], toasts: [], flights: [], weather: [], triggers: [], overlays: [], zoned: [], loading: [] };
  onChat: ((text: string, kind: ChatKind) => void) | null = null;
  onToast: ((text: string, kind: string) => void) | null = null;

  readonly settings = {
    value: defaultSettings() as Settings,
    set: (patch: unknown) => {
      deepMerge(this.settings.value as unknown as Record<string, unknown>, patch as Record<string, unknown>);
      this.events.emit('settings:changed', this.settings.value);
    },
  };

  readonly renderer = (() => {
    const self = this;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const focus = { x: 32, y: 32 };
    return {
      canvas,
      stats: { fps: 60, frameMs: 16.4, drawCalls: 312, triangles: 1_240_000 },
      overlay: null as FieldId | null,
      altitude: 420,
      cameraCtl: {
        focus, distance: 600, yaw: 0.7, pitch: 0.9,
        flyTo(x: number, y: number, distance?: number) {
          focus.x = x;
          focus.y = y;
          if (distance) this.distance = distance;
          self.log.flights.push({ x, y, distance });
        },
      },
      getViewInfo() {
        return { focusX: focus.x, focusY: focus.y, radiusCells: 320, altitude: this.altitude };
      },
      setOverlay(f: FieldId | null) {
        this.overlay = f;
        self.log.overlays.push(f);
      },
      worldToScreen() {
        return { x: 320, y: 180, visible: true };
      },
      async screenshot(): Promise<string> {
        // a little painted "city" so thumbnails are recognisable
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        const g = c.getContext('2d')!;
        const sky = g.createLinearGradient(0, 0, 0, 720);
        sky.addColorStop(0, '#ffb877');
        sky.addColorStop(0.55, '#6d7fb8');
        sky.addColorStop(1, '#1d2b45');
        g.fillStyle = sky;
        g.fillRect(0, 0, 1280, 720);
        let seed = self.world?.settings.seed ?? 1;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 60; i++) {
          const w = 20 + rnd() * 60, h = 60 + rnd() * 360, x = rnd() * 1280;
          g.fillStyle = `hsl(${220 + rnd() * 30}, 25%, ${14 + rnd() * 16}%)`;
          g.fillRect(x, 720 - h, w, h);
          g.fillStyle = 'rgba(255,214,140,0.55)';
          for (let k = 0; k < h / 18; k++) if (rnd() < 0.4) g.fillRect(x + 4 + rnd() * (w - 10), 720 - h + 8 + k * 18, 4, 6);
        }
        return c.toDataURL('image/jpeg', 0.9);
      },
    };
  })();

  readonly ui = {
    hudVisible: true,
    toast: (text: string, kind = 'info') => {
      this.log.toasts.push({ text, kind });
      this.onToast?.(text, kind);
    },
    openBuildingInfo: (_id: number) => {},
    setHudVisible: (v: boolean) => { this.ui.hudVisible = v; },
  };

  menusOpen = false;
  readonly menus = {
    isOpen: () => this.menusOpen,
    showLoading: (t: string) => { this.log.loading.push(t); },
    hideLoading: () => {},
    hideMainMenu: () => {},
    showMainMenu: () => {},
    closeTop: () => false,
  };

  readonly chat = {
    isOpen: false,
    print: (text: string, kind: ChatKind = 'info') => {
      this.log.chat.push({ text, kind });
      this.onChat?.(text, kind);
    },
    clear: () => { this.log.chat.length = 0; },
    close: () => { this.chat.isOpen = false; },
    open: () => { this.chat.isOpen = true; },
  };

  readonly sim = {
    lastSpeed: 1,
    setHour: (h: number) => { if (this.world) this.world.time.hour = ((h % 24) + 24) % 24; },
    setSpeed: (l: number) => {
      if (!this.world) return;
      this.world.time.speed = l;
      this.events.emit('time:speed', l);
    },
    togglePause: () => {},
    advanceDays: (n: number) => { if (this.world) this.world.time.day += n; },
    addResidents: (n: number) => { if (this.world) this.world.stats.population += n; },
    grantMilestone: (i: number) => { if (this.world) this.world.milestone = Math.max(this.world.milestone, i); },
    projection: () => ({ income: { residential: 12000, commercial: 5400 }, expense: { roads: 2200, power: 4100 } }),
  };

  readonly eventSystem = {
    catalog: EVENTS,
    summonables: () => EVENTS.filter((e) => e.summonable).map((e) => e.id),
    trigger: (id: string, at?: Cell): ActiveEvent | null => {
      this.log.triggers.push({ id, at });
      if (!EVENTS.some((e) => e.id === id)) return null;
      const w = this.world!;
      const ev: ActiveEvent = { id: w.nextEventId++, defId: id, startDay: w.time.day, endDay: w.time.day + 1, x: at?.x, y: at?.y };
      w.activeEvents.push(ev);
      this.events.emit('event:start', ev);
      return ev;
    },
    setWeather: (type: WeatherType, _i?: number, days?: number) => {
      this.log.weather.push({ type, days });
      if (this.world) this.world.weather.type = type;
    },
  };

  readonly actions = {
    checkBuilding: (defId: string, x: number, y: number, rot: Dir): PlacementCheck => {
      const def = buildingDef(defId);
      const w = this.world!;
      const bw = rot === Dir.N || rot === Dir.S ? def?.w ?? 1 : def?.h ?? 1;
      const bh = rot === Dir.N || rot === Dir.S ? def?.h ?? 1 : def?.w ?? 1;
      const x0 = x - Math.floor((bw - 1) / 2), y0 = y - Math.floor((bh - 1) / 2);
      let ok = !!def;
      for (let yy = y0; yy < y0 + bh && ok; yy++) for (let xx = x0; xx < x0 + bw && ok; xx++) if (!w.inBounds(xx, yy) || w.bldg[w.idx(xx, yy)] || w.road[w.idx(xx, yy)]) ok = false;
      return { ok, cost: def?.cost ?? 0, reason: ok ? undefined : 'blocked', x: x0, y: y0, w: bw, h: bh, rot };
    },
    placeBuilding: (defId: string, x: number, y: number, rot: Dir) => {
      const c = this.actions.checkBuilding(defId, x, y, rot);
      if (!c.ok) return { ok: false, cost: 0, reason: c.reason };
      const w = this.world!;
      if (!w.spend(c.cost)) return { ok: false, cost: 0, reason: 'not enough money' };
      const b = w.addBuilding({ kind: 'service', defId, x: c.x, y: c.y, w: c.w, h: c.h, rot });
      return { ok: true, cost: c.cost, id: b.id };
    },
    zoneRect: (r: Rect, z: ZoneType) => {
      this.log.zoned.push(r);
      const w = this.world!;
      w.forEachCellInRect(r, (x, y) => w.setZone(x, y, z));
      return { ok: true, cost: 0 };
    },
    bulldozeBuilding: (id: number) => {
      const b = this.world?.removeBuilding(id);
      return { ok: !!b, cost: b ? 50 : 0 };
    },
  };

  vehicleCount = 37;
  readonly traffic = {
    get vehicleCount() { return fake.vehicleCount; },
    onWorldLoaded: () => {},
    onWorldUnloaded: () => { fake.vehicleCount = 0; },
  };
  readonly vehicles = { onWorldLoaded: () => {}, onWorldUnloaded: () => {} };
  readonly fields = { recomputeNow: async () => {} };

  readonly saves: SaveManager;
  readonly commands: CommandRegistry;
  readonly audio: AudioManager;

  constructor(readonly uiRoot: HTMLElement) {
    fake = this;
    const g = this as unknown as Game;
    this.saves = new SaveManager(g);
    this.commands = new CommandRegistry(g);
    this.audio = new AudioManager(g);
  }

  async attachWorld(world: World): Promise<void> {
    if (this.world) this.events.emit('world:unloaded', null);
    this.world = world;
    world.bus = this.events;
    this.vehicleCount = 37;
    this.events.emit('world:loaded', world);
  }

  setCreative(on: boolean): void {
    if (!this.world) return;
    this.world.creative = on;
    this.events.emit('creative:changed', on);
  }

  async downloadScreenshot(): Promise<void> {
    this.ui.toast('Screenshot saved', 'good');
  }

  asGame(): Game {
    return this as unknown as Game;
  }
}

let fake: FakeGame;

