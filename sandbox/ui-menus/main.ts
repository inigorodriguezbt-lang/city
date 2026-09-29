// Menus sandbox: boots the real MenuSystem + ChatConsole + SettingsStore against
// a fake Game so every screen can be opened by URL, e.g.
//   ?screen=main | newgame | load | save | pause | options | help | credits | photo | loading | chat | confirm
//   &tab=graphics|interface|controls|audio|gameplay   &ingame=1   &empty=1   &scale=1.25
//   &capture=1 (controls tab: start a key capture)   &conflict=1   &reduced=1
import '../../src/ui/theme.css';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import type { MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { themeDef, THEMES } from '../../src/data/themes';
import { SettingsStore } from '../../src/settings/SettingsStore';
import { MenuSystem } from '../../src/ui/menus/MenuSystem';
import { ChatConsole } from '../../src/ui/chat/ChatConsole';
import { paintThemePreview } from '../../src/ui/menus/themePreview';
import type { SaveMeta } from '../../src/save/SaveManager';
import type { CommandDef } from '../../src/commands/CommandRegistry';
import type { Game } from '../../src/game/Game';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'main';
const ingame = q.get('ingame') === '1' || ['save', 'pause', 'chat'].includes(screen);

// fresh settings each load unless ?keep=1 (so screenshots are deterministic)
if (q.get('keep') !== '1') {
  try {
    localStorage.removeItem('urbis.settings.v1');
    localStorage.removeItem('urbis.options.tab');
  } catch {
    /* ignore */
  }
}

const events = new EventBus<GameEvents>();
const settings = new SettingsStore(events);
settings.load();
if (q.get('scale')) settings.set({ ui: { scale: Number(q.get('scale')) } });
if (q.get('reduced') === '1') settings.set({ ui: { reducedMotion: true } });
const applyScale = (s: number) => document.documentElement.style.setProperty('--ui-scale', String(s));
applyScale(settings.value.ui.scale);
events.on('settings:changed', (s) => applyScale(s.ui.scale));

// ── thumbnails: little isometric-ish city renders ─────────────────────────
function makeThumb(seed: number, themeIdx: number): string {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const g = c.getContext('2d')!;
  const t = THEMES[themeIdx % THEMES.length];
  paintThemePreview(c, t, 320, 180, seed);
  g.setTransform(1, 0, 0, 1, 0, 0);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // downtown towers on top of the landscape
  const base = c.height * 0.74;
  for (let i = 0; i < 26; i++) {
    const x = 40 + rnd() * 200;
    const w = 6 + rnd() * 12;
    const hgt = 10 + Math.pow(rnd(), 2) * 70 * (1 - Math.abs(x - 140) / 160);
    const shade = 200 + rnd() * 50;
    g.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
    g.fillRect(x, base - hgt, w, hgt);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x + w * 0.6, base - hgt, w * 0.4, hgt);
    g.fillStyle = 'rgba(120,180,230,0.55)';
    for (let y = base - hgt + 3; y < base - 3; y += 4) g.fillRect(x + 1.5, y, w * 0.45, 1.2);
  }
  return c.toDataURL('image/jpeg', 0.8);
}

const now = Date.now();
const MIN = 60_000;
let saves: SaveMeta[] = q.get('empty') === '1' ? [] : [
  { id: 's1', name: 'Port Aurelia', cityName: 'Port Aurelia', savedAt: now - 12 * MIN, population: 48_210, money: 1_284_300, day: 1460, mapSize: 'medium', theme: 'mediterranean', thumbnail: makeThumb(3, 5), auto: false, bytes: 2_480_000 },
  { id: 's2', name: 'Port Aurelia — autosave', cityName: 'Port Aurelia', savedAt: now - 3 * MIN, population: 48_402, money: 1_291_020, day: 1466, mapSize: 'medium', theme: 'mediterranean', thumbnail: makeThumb(4, 5), auto: true, bytes: 2_490_000 },
  { id: 's3', name: 'Fjordholm', cityName: 'Fjordholm', savedAt: now - 26 * 60 * MIN, population: 12_904, money: 84_200, day: 640, mapSize: 'large', theme: 'boreal', thumbnail: makeThumb(8, 1), auto: false, bytes: 1_730_000 },
  { id: 's4', name: 'Oasis Springs v2', cityName: 'Oasis Springs', savedAt: now - 5 * 24 * 60 * MIN, population: 3_120, money: -12_400, day: 210, mapSize: 'small', theme: 'desert', thumbnail: makeThumb(12, 2), auto: false, bytes: 610_000 },
  { id: 's5', name: 'Coral Bay mega build', cityName: 'Coral Bay', savedAt: now - 40 * 24 * 60 * MIN, population: 412_800, money: 24_880_000, day: 5200, mapSize: 'huge', theme: 'tropical', auto: false, bytes: 9_800_000 },
  { id: 's6', name: 'Alpenrose', cityName: 'Alpenrose', savedAt: now - 3 * 60 * MIN, population: 820, money: 41_200, day: 45, mapSize: 'small', theme: 'alpine', thumbnail: makeThumb(21, 4), auto: false, bytes: 380_000 },
];

// ── world ─────────────────────────────────────────────────────────────────
function makeWorld(name = 'Port Aurelia', theme: MapSettings['theme'] = 'mediterranean'): World {
  const ms: MapSettings = {
    cityName: name, mapSize: 'small', theme, seed: 42, style: 'mediterranean', difficulty: 'normal',
    creative: false, disasters: true, mountains: 0.5, water: 0.5, forests: 0.5,
  };
  const w = new World(ms, 256);
  w.stats.population = 48_402;
  w.economy.money = 1_291_020;
  w.time.day = 1466;
  w.time.hour = 18.5;
  w.playTime = 3 * 3600 + 42 * 60;
  w.milestone = 7;
  return w;
}

// ── fake command registry ─────────────────────────────────────────────────
const cmds: CommandDef[] = [
  { name: 'help', usage: '/help [command]', description: 'List commands or show help for one', run: () => {} },
  { name: 'give', usage: '/give <money|unlockall|milestone|residents|building> [amount]', description: 'Give yourself money, unlocks or buildings', cheat: true, run: () => {} },
  { name: 'time', usage: '/time <set|speed|add> <value>', description: 'Change the time of day, speed or skip days', run: () => {} },
  { name: 'tp', usage: '/tp <x> <y> | home | <building>', description: 'Teleport the camera', run: () => {} },
  { name: 'weather', usage: '/weather <type> [days]', description: 'Set the weather', run: () => {} },
  { name: 'locate', usage: '/locate <defId|category|name|next>', description: 'Find buildings and fly to the nearest', run: () => {} },
  { name: 'summon', usage: '/summon <event> [x y]', description: 'Trigger an event or disaster', cheat: true, run: () => {} },
  { name: 'season', usage: '/season', description: 'Show the current season', run: () => {} },
  { name: 'save', usage: '/save [name]', description: 'Save the city', run: () => {} },
  { name: 'stats', usage: '/stats', description: 'City statistics summary', run: () => {} },
  { name: 'seed', usage: '/seed', description: 'Show the map seed', run: () => {} },
  { name: 'speed', usage: '/speed <0-4>', description: 'Set the simulation speed', run: () => {} },
  { name: 'screenshot', usage: '/screenshot', description: 'Save a screenshot', run: () => {} },
];
const ARGS: Record<string, string[][]> = {
  give: [['money', 'unlockall', 'milestone', 'residents', 'building']],
  time: [['set', 'speed', 'add'], ['day', 'noon', 'dusk', 'night', 'midnight']],
  weather: [['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'heatwave', 'blizzard']],
  summon: [['tornado', 'meteor', 'earthquake', 'fire', 'flood', 'ufo', 'festival']],
};
const commands = {
  history: [] as string[],
  init() {},
  register() {},
  list: () => cmds,
  complete(line: string): string[] {
    const parts = line.replace(/^\//, '').split(' ');
    if (parts.length <= 1) return cmds.map((c) => c.name).filter((n) => n.startsWith(parts[0] ?? ''));
    const opts = ARGS[parts[0]]?.[parts.length - 2] ?? [];
    const cur = parts[parts.length - 1];
    return opts.filter((o) => o.startsWith(cur));
  },
  async execute(line: string): Promise<void> {
    const [name, ...args] = line.replace(/^\//, '').trim().split(/\s+/);
    const cmd = cmds.find((c) => c.name === name);
    if (!cmd) {
      chat.print(`Unknown command "/${name}". Type /help for a list.`, 'error');
      return;
    }
    if (name === 'help') {
      chat.print('Commands:\n' + cmds.map((c) => `  ${c.usage} — ${c.description}`).join('\n'), 'info');
      return;
    }
    if (cmd.cheat) chat.print('(cheat) achievements are disabled for this city', 'warn');
    chat.print(`Done: /${name} ${args.join(' ')}`.trim(), 'ok');
  },
};

// ── fake input with key capture ───────────────────────────────────────────
let captureResolve: ((v: string | null) => void) | null = null;
const input = {
  enabled: true,
  get capturing() {
    return captureResolve !== null;
  },
  captureNextKey(): Promise<string | null> {
    captureResolve?.(null);
    return new Promise((r) => (captureResolve = r));
  },
  bindingLabel: () => '',
};
window.addEventListener('keydown', (e) => {
  if (captureResolve) {
    e.preventDefault();
    e.stopPropagation();
    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
    const r = captureResolve;
    captureResolve = null;
    if (e.code === 'Escape') return r(null);
    r([e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.code].filter(Boolean).join('+'));
    return;
  }
  // emulate Game.bindGlobalActions (tool.cancel / ui.chat / ui.command)
  const typing = document.activeElement instanceof HTMLInputElement && !['range', 'checkbox'].includes(document.activeElement.type);
  if (e.code === 'Escape') {
    e.preventDefault();
    if (chat.isOpen) return chat.close();
    if (menus.closeTop()) return;
    if (game.world) menus.openPause();
    return;
  }
  if (typing || !input.enabled) return;
  const inGame = !!game.world && !menus.isOpen() && !chat.isOpen;
  if (inGame && (e.code === 'KeyT' || e.code === 'Enter')) {
    e.preventDefault();
    chat.open();
  } else if (inGame && e.code === 'Slash') {
    e.preventDefault();
    chat.open('/');
  }
}, true);

// ── fake game ─────────────────────────────────────────────────────────────
const uiRoot = document.getElementById('ui')!;
const bg = document.getElementById('bg') as HTMLCanvasElement;
function paintBg(themeId: MapSettings['theme']): void {
  paintThemePreview(bg, themeDef(themeId), window.innerWidth, window.innerHeight, 5);
}

const game = {
  events,
  settings,
  world: null as World | null,
  input,
  commands,
  ui: { hudVisible: true, setScale: applyScale, toast: () => {} },
  audio: { play: (id: string, v = 1) => { if (q.get('log')) console.log('[sfx]', id, v.toFixed(2)); } },
  saves: {
    list: async () => saves.slice(),
    async load(id: string) {
      const m = saves.find((s) => s.id === id);
      if (!m) return false;
      await fakeLoad(`Loading ${m.name}…`, () => makeWorld(m.cityName, m.theme as MapSettings['theme']));
      return true;
    },
    async save(name?: string, opts?: { overwriteId?: string }) {
      const w = game.world!;
      const meta: SaveMeta = {
        id: opts?.overwriteId ?? 's' + Math.random().toString(36).slice(2, 7), name: name || w.settings.cityName, cityName: w.settings.cityName,
        savedAt: Date.now(), population: w.stats.population, money: w.economy.money, day: w.time.day, mapSize: w.settings.mapSize, theme: w.settings.theme,
        thumbnail: makeThumb(Math.floor(Math.random() * 99), 5), auto: false, bytes: 2_500_000,
      };
      saves = saves.filter((s) => s.id !== meta.id).concat(meta);
      await new Promise((r) => setTimeout(r, 350));
      return meta;
    },
    async delete(id: string) {
      saves = saves.filter((s) => s.id !== id);
    },
    async exportSave() {},
    async exportCurrent() {},
    async importFile(f: File) {
      const meta: SaveMeta = { id: 'i' + Date.now(), name: f.name.replace(/\.urbis$/i, ''), cityName: f.name.replace(/\.urbis$/i, ''), savedAt: Date.now(), population: 9_999, money: 50_000, day: 300, mapSize: 'medium', theme: 'temperate', auto: false, bytes: f.size };
      saves.push(meta);
      return meta;
    },
    quicksave: async () => {},
    quickload: async () => {},
  },
  async newGame(ms: Partial<MapSettings>) {
    menus.hideMainMenu();
    await fakeLoad('Generating terrain…', () => makeWorld(ms.cityName, ms.theme));
  },
  quitToMenu() {
    game.world = null;
    events.emit('world:unloaded', null);
    bg.getContext('2d')!.clearRect(0, 0, bg.width, bg.height);
    menus.showMainMenu();
  },
  menus: null as unknown as MenuSystem,
  chat: null as unknown as ChatConsole,
};

async function fakeLoad(first: string, make: () => World): Promise<void> {
  const steps: [string, number][] = [[first, 0.05], ['Carving rivers…', 0.3], ['Growing forests…', 0.55], ['Laying the highway…', 0.75], ['Founding the city…', 0.92]];
  for (const [label, p] of steps) {
    menus.showLoading(label, p);
    await new Promise((r) => setTimeout(r, 450));
  }
  const w = make();
  game.world = w;
  paintBg(w.settings.theme);
  events.emit('world:loaded', w);
  menus.hideLoading();
}

const menus = new MenuSystem(game as unknown as Game, uiRoot);
const chat = new ChatConsole(game as unknown as Game, uiRoot);
game.menus = menus;
game.chat = chat;
(window as unknown as { __menus: MenuSystem; __chat: ChatConsole; __game: typeof game }).__menus = menus;
(window as unknown as { __chat: ChatConsole }).__chat = chat;
(window as unknown as { __game: typeof game }).__game = game;
menus.init();
chat.init();

if (ingame) {
  game.world = makeWorld();
  paintBg('mediterranean');
  events.emit('world:loaded', game.world);
}

switch (screen) {
  case 'main': menus.showMainMenu(); break;
  case 'newgame': menus.showMainMenu(); menus.openNewGame(); break;
  case 'load': if (!ingame) menus.showMainMenu(); menus.openLoadDialog(); break;
  case 'save': menus.openPause(); menus.openSaveDialog(); break;
  case 'pause': menus.openPause(); break;
  case 'options': {
    if (!ingame) menus.showMainMenu();
    menus.openOptions((q.get('tab') ?? 'graphics') as 'graphics');
    if (q.get('capture') === '1') setTimeout(() => (document.querySelector('.mn-kslot') as HTMLElement | null)?.click(), 400);
    if (q.get('conflict') === '1') {
      setTimeout(async () => {
        (document.querySelectorAll('.mn-kslot')[1] as HTMLElement | undefined)?.click();
        await new Promise((r) => setTimeout(r, 100));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true }));
      }, 400);
    }
    break;
  }
  case 'help': menus.showMainMenu(); menus.openHelp(); break;
  case 'credits': menus.showMainMenu(); menus.openCredits(); break;
  case 'photo': menus.openPause(); menus.openPhotoTips(); break;
  case 'loading': menus.showLoading('Carving rivers…', 0.42); break;
  case 'confirm': menus.showMainMenu(); void menus.confirm('Delete this save?', '“Port Aurelia” will be permanently deleted. This cannot be undone.', { ok: 'Delete', danger: true, icon: 'trash' }); break;
  case 'chat': {
    chat.print('Welcome to URBIS! Type /help for commands.', 'system');
    chat.print('/time set dusk', 'input');
    chat.print('Time set to 18:30 (dusk).', 'ok');
    chat.print('<you> this skyline is gorgeous', 'input');
    chat.print('/give money 1000000', 'input');
    chat.print('(cheat) achievements are disabled for this city', 'warn');
    chat.print('Unknown command "/fly". Type /help for a list.', 'error');
    chat.print('Commands:\n  /help [command] — list commands\n  /time <set|speed|add> <value> — change time', 'info');
    if (q.get('open') !== '0') chat.open(q.get('prefill') ?? '/ti');
    break;
  }
  default: menus.showMainMenu();
}
