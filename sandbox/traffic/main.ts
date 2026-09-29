// Traffic sandbox: a small valley town (grid of streets, avenues, a tram
// avenue, a boulevard, a highway from the map edge, bridges over a river, a
// railway) with zoned + service buildings, driven by the real TrafficSystem
// (path worker, trips, services, transit lines) and rendered with the real
// GameRenderer + RoadRenderer + BuildingRenderer + VehicleRenderer.
// URL params: ?t=day|golden|dusk|night|rain  &cam=<preset>  &warm=<sim seconds>  &live=1  &density=0..1
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { Noise } from '../../src/core/noise';
import { RNG } from '../../src/core/rng';
import { CELL } from '../../src/core/constants';
import { BFlag, Dir, RoadType, ZoneType, type Building, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { RoadSurface } from '../../src/world/roadHeight';
import { RoadRenderer } from '../../src/render/roads/RoadRenderer';
import { BuildingRenderer } from '../../src/render/buildings/BuildingRenderer';
import { registerServiceModels } from '../../src/render/buildings/service';
import { GameRenderer } from '../../src/render/Renderer';
import { TrafficSystem } from '../../src/sim/traffic/TrafficSystem';
import { VehicleRenderer } from '../../src/render/vehicles/VehicleRenderer';
import { DEFAULT_KEYBINDS, defaultSettings, type ActionId } from '../../src/settings/types';
import { buildingDef } from '../../src/data/buildings';
import { LEVEL_CAPACITY, zoneDef } from '../../src/data/zones';
import type { Game } from '../../src/game/Game';

const params = new URLSearchParams(location.search);
const TIME = params.get('t') ?? 'day';
const CAM = params.get('cam') ?? 'overview';
const WARM = Number(params.get('warm') ?? 90);
const BLD = params.get('bld') !== '0';
const SIZE = 96;
const log = (...a: unknown[]) => console.log('[sb]', ...a);

// ── world ───────────────────────────────────────────────────────────────────
const settings: MapSettings = {
  cityName: 'Traffic Sandbox', mapSize: 'small', theme: 'temperate', seed: 11, style: 'european', difficulty: 'normal',
  creative: true, disasters: false, mountains: 0.3, water: 0.4, forests: 0.2, leftHandTraffic: params.get('lht') === '1',
};
const world = new World(settings, SIZE);
const noise = new Noise(5);
const RIVER = 60;
const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
for (let vy = 0; vy <= SIZE; vy++)
  for (let vx = 0; vx <= SIZE; vx++) {
    let h = 20 + 1.2 * noise.noise2(vx / 28, vy / 28) + 0.4 * noise.noise2(vx / 9, vy / 9);
    h += 4 * sm(70, 96, vx) * sm(0, 40, vy);
    const d = Math.abs(vx - RIVER);
    h -= 8.5 * (1 - sm(2.6, 5.5, d));
    world.heights[vy * (SIZE + 1) + vx] = h;
  }
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (Math.abs(x + 0.5 - RIVER) < 3.2) world.water[y * SIZE + x] = 15.2;

type Seg = [RoadType, number, number, number, number];
const H = RoadType.Highway, A = RoadType.Avenue, S = RoadType.Street, B = RoadType.Boulevard, T = RoadType.TramAvenue, P = RoadType.Pedestrian, R = RoadType.Rail, D = RoadType.Dirt;
const segs: Seg[] = [
  [H, 0, 8, 95, 8],
  [A, 20, 8, 20, 86], [A, 44, 8, 44, 86],
  [S, 6, 20, 44, 20], [S, 6, 32, 44, 32], [S, 6, 58, 44, 58], [S, 6, 72, 44, 72], [S, 6, 86, 44, 86],
  [S, 6, 20, 6, 86], [S, 32, 20, 32, 86],
  [T, 6, 46, 92, 46],
  [B, 44, 72, 92, 72],
  [S, 72, 8, 72, 86], [S, 86, 20, 86, 86], [S, 44, 28, 86, 28], [S, 64, 58, 86, 58], [S, 44, 86, 86, 86],
  [P, 33, 38, 43, 38], [D, 88, 28, 94, 28],
  [R, 0, 92, 95, 92],
];
const cellsOf = ([, x0, y0, x1, y1]: Seg): [number, number][] => {
  const out: [number, number][] = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / Math.max(1, n)), Math.round(y0 + ((y1 - y0) * i) / Math.max(1, n))]);
  return out;
};
// grade the terrain under roads (smooth the corner heights of road cells)
const onRoad = new Uint8Array((SIZE + 1) * (SIZE + 1));
for (const s of segs) for (const [x, y] of cellsOf(s)) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) onRoad[(y + dy) * (SIZE + 1) + x + dx] = 1;
for (let pass = 0; pass < 4; pass++) {
  const src = world.heights.slice();
  for (let vy = 1; vy < SIZE; vy++)
    for (let vx = 1; vx < SIZE; vx++) {
      const i = vy * (SIZE + 1) + vx;
      if (!onRoad[i] || Math.abs(vx - RIVER) < 5) continue;
      world.heights[i] = (src[i] * 4 + src[i - 1] + src[i + 1] + src[i - SIZE - 1] + src[i + SIZE + 1]) / 8;
    }
}
const order: RoadType[] = [R, D, S, P, B, T, A, H];
for (const t of order)
  for (const s of segs) {
    if (s[0] !== t) continue;
    for (const [x, y] of cellsOf(s)) world.setRoad(x, y, t, world.isWater(x, y) ? 1 : 0);
  }
world.connections = [{ kind: 'highway', x: 0, y: 8, dir: Dir.W }, { kind: 'highway', x: 95, y: 8, dir: Dir.E }, { kind: 'rail', x: 0, y: 92, dir: Dir.W }];

// ── buildings ──────────────────────────────────────────────────────────────
const rng = new RNG(99);
const free = (x: number, y: number, w: number, h: number) => {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (!world.inBounds(xx, yy) || world.roadAt(xx, yy) || world.isWater(xx, yy) || world.bldg[world.idx(xx, yy)]) return false;
      if (Math.abs(xx + 0.5 - RIVER) < 5) return false;
    }
  return true;
};
const place = (defId: string, x: number, y: number, rot: Dir): Building | null => {
  const def = buildingDef(defId);
  if (!def) return null;
  const w = rot === Dir.N || rot === Dir.S ? def.w : def.h, h = rot === Dir.N || rot === Dir.S ? def.h : def.w;
  if (!free(x, y, w, h)) return null;
  return world.addBuilding({ kind: 'service', defId, x, y, w, h, rot, built: 1, jobs: def.jobs ?? 10, workers: def.jobs ?? 10, flags: BFlag.Powered | BFlag.Watered | BFlag.RoadAccess });
};
const services: Record<string, Building | null> = {
  fire: place('fire_station', 21, 21, Dir.W),
  police: place('police_station', 45, 29, Dir.N),
  hospital: place('hospital', 33, 59, Dir.N),
  post: place('post_office', 7, 47, Dir.N),
  garbage: place('landfill', 73, 73, Dir.N),
  cemetery: place('cemetery', 87, 47, Dir.N),
};
log('services', Object.entries(services).map(([k, b]) => `${k}:${b ? b.id : 'x'}`).join(' '));
const zoneFor = (x: number, y: number): ZoneType => {
  if (x < 20) return y < 46 ? ZoneType.ResLow : ZoneType.ResMed;
  if (x < 44) return y < 46 ? ZoneType.ComLow : y < 72 ? ZoneType.ResMed : ZoneType.ComLow;
  if (x < 72) return y < 46 ? ZoneType.Office : y < 72 ? ZoneType.ResMed : ZoneType.Industry;
  return y < 46 ? ZoneType.ComLow : y < 72 ? ZoneType.MixedUse : ZoneType.Industry;
};
for (let y = 1; y < SIZE - 3; y++)
  for (let x = 1; x < SIZE - 3; x++) {
    const zone = zoneFor(x, y);
    const big = zone === ZoneType.Industry;
    const w = big ? 3 : 2, h = big ? 3 : 2;
    if (!free(x, y, w, h)) continue;
    // front toward an adjacent road
    let rot = -1;
    for (const d of [Dir.S, Dir.N, Dir.E, Dir.W]) {
      if (world.roadAccessDir(x, y, w, h, d) === d) {
        rot = d;
        break;
      }
    }
    if (rot < 0) continue;
    const level = 1 + Math.floor(rng.next() * (zone === ZoneType.Office ? 3 : 4));
    const zd = zoneDef(zone);
    const cap = Math.round(zd.capacityPerCell * w * h * LEVEL_CAPACITY[level]);
    const res = zd.category === 'res';
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) world.setZone(xx, yy, zone);
    world.addBuilding({
      kind: 'zoned', defId: 'zoned:' + zd.id, x, y, w, h, rot: rot as Dir, zone, level, built: 1, style: 'european',
      residents: res ? cap : zone === ZoneType.MixedUse ? cap : 0, maxResidents: res ? cap : 0, jobs: res ? 0 : cap, workers: res ? 0 : Math.round(cap * 0.8),
      visitors: zd.category === 'com' ? cap : 0, goods: 60, flags: BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess, seed: rng.int(1, 1e9),
    });
  }
let pop = 0, jobs = 0;
for (const b of world.buildings.values()) (pop += b.residents), (jobs += b.jobs);
world.stats.population = Number(params.get('pop') ?? pop);
world.stats.jobs = jobs;
world.stats.tourists = 300;
log('buildings', world.buildings.size, 'pop', pop, 'jobs', jobs);

// ── game wiring (real renderer) ─────────────────────────────────────────────
const HOURS: Record<string, number> = { day: 11.2, golden: 18.3, dusk: 20.1, night: 22.6, rain: 13, morning: 8.2 };
world.time.hour = HOURS[TIME] ?? 11;
world.time.speed = 1;
if (TIME === 'rain') world.weather = { ...world.weather, type: 'rain', intensity: 0.7 };
const events = new EventBus<GameEvents>();
world.bus = events;
const gs = defaultSettings();
gs.graphics.shadows = 'high';
gs.graphics.tiltShift = false;
gs.graphics.vehicleDensity = Number(params.get('density') ?? 1);
const keys = new Set<string>();
const view = document.createElement('div');
view.style.cssText = 'position:absolute;inset:0';
document.body.prepend(view);
const neutral = () => ({ demandRes: 0, demandCom: 0, demandInd: 0, demandOff: 0, happiness: 0, incomeMult: 1, tourismMult: 1, crimeMult: 1, healthMult: 1, powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, trafficMult: 1, fireRiskMult: 1, constructionMult: 1 });
const toolReg: { current: { id: string } | null; tools: Map<string, unknown>; register(t: { id: string }): void } = {
  current: null,
  tools: new Map(),
  register(t) {
    this.tools.set(t.id, t);
  },
};
const game = {
  events, world, settings: { value: gs }, simDt: 0, dt: 0, time: 0,
  roadSurface: new RoadSurface(world),
  input: {
    enabled: true, pointer: { x: 0, y: 0, overCanvas: false },
    isDown: (a: ActionId) => (gs.controls.keybinds[a] ?? DEFAULT_KEYBINDS[a]).some((k) => keys.has(k)),
    onAction: () => () => {}, onPointer: () => () => {}, onGesture: () => () => {},
  },
  eventSystem: { modifiers: neutral },
  tools: toolReg,
  effects: { addEmitter: () => 0, removeEmitter: () => {} },
  ui: { toast: (t: string) => log('toast', t) },
  audio: { play: () => {} },
  chat: { isOpen: false, close: () => {} },
  renderer: null as unknown as GameRenderer,
} as unknown as Game & { simDt: number; dt: number; time: number };
events.on('world:changed', ({ rect, layers }) => {
  if (layers & 7) game.roadSurface!.invalidate(rect);
});
const gr = new GameRenderer(game, view);
(game as unknown as { renderer: GameRenderer }).renderer = gr;
gr.applySettings(gs);
gr.onWorldLoaded(world);
registerServiceModels();
const roads = new RoadRenderer(game);
(game as unknown as { roads: RoadRenderer }).roads = roads;
const buildings = BLD ? new BuildingRenderer(game) : null;
const traffic = new TrafficSystem(game);
(game as unknown as { traffic: TrafficSystem }).traffic = traffic;
const vehicles = new VehicleRenderer(game);
roads.onWorldLoaded(world);
buildings?.onWorldLoaded(world);
traffic.onWorldLoaded(world);
vehicles.onWorldLoaded(world);
events.emit('world:loaded', world);
world.flushChanges();

// ── transit lines ──────────────────────────────────────────────────────────
const tr = traffic.transit;
const mk = (mode: 'bus' | 'tram' | 'train' | 'metro' | 'ferry' | 'monorail', pts: [number, number][]) => {
  const stops = pts.map(([x, y]) => tr.snap(mode, x, y, 3)).filter((c): c is { x: number; y: number } => !!c);
  const l = traffic.createLine(mode, stops);
  log('line', mode, l ? `${l.id} "${l.name}" stops=${l.stops.length} veh=${l.vehicles}` : 'FAILED', stops.map((s) => `${s.x},${s.y}`).join(' '));
  return l;
};
mk('bus', [[6, 26], [26, 32], [32, 52], [26, 72], [6, 64]]);
mk('tram', [[12, 46], [38, 46], [70, 46], [90, 46]]);
mk('train', [[18, 92], [78, 92]]);
mk('monorail', [[48, 72], [90, 72], [86, 40]]);
mk('ferry', [[60, 18], [60, 80]]);
mk('metro', [[12, 26], [38, 52], [78, 36], [80, 80]]);

// ── camera presets [x, y (cells), distance, azimuth°, elevation°] ────────────
const views: Record<string, [number, number, number, number, number]> = {
  overview: [46, 50, 1300, 25, 42],
  junction: [20.5, 32.5, 95, 35, 38],
  junction2: [44.5, 46.5, 110, 210, 40],
  bridge: [60, 46.5, 170, 60, 22],
  highway: [58, 8.5, 190, 150, 28],
  street: [15, 20.5, 70, 60, 26],
  tram: [30, 46.5, 80, 25, 24],
  train: [40, 92, 200, 20, 26],
  monorail: [70, 72, 150, 25, 22],
  ferry: [60, 50, 260, 70, 30],
  queue: [44.5, 20.5, 120, 330, 45],
  top: [20.5, 46.5, 120, 0, 88],
  close: [20.5, 29, 38, 20, 22],
  close2: [44.5, 47.5, 45, 200, 25],
  tramclose: [30, 46.5, 40, 25, 18],
  busstop: [26, 32.5, 34, 20, 26],
  metro: [38, 52, 40, 30, 30],
  station: [78, 92, 70, 20, 25],
  mstation: [48, 72, 60, 30, 22],
  ferry2: [60, 30, 120, 60, 25],
  peds: [44.5, 46.5, 45, 20, 55],
  top2: [20.5, 32.5, 70, 0, 88],
  top3: [44.5, 46.5, 80, 0, 88],
  service: [26, 26, 180, 20, 45],
};
const [cx, cy, cd, caz, cel] = views[CAM] ?? views.overview;
gr.cameraCtl.setPose(cx, cy, cd, THREE.MathUtils.degToRad(caz), THREE.MathUtils.degToRad(cel));

// ── dispatch some emergency vehicles ───────────────────────────────────────
const dispatchAll = () => {
  const f = services.fire, p = services.police, h = services.hospital;
  if (f) log('dispatch fire', traffic.dispatch('firetruck', f.id, { x: 38, y: 70 }));
  if (p) log('dispatch police', traffic.dispatch('police', p.id, { x: 80, y: 30 }));
  if (h) log('dispatch ambulance', traffic.dispatch('ambulance', h.id, { x: 14, y: 40 }));
};

// ── simulation warm-up (no rendering), then render ─────────────────────────
const stats = document.getElementById('stats')!;
const W = window as unknown as { __ready: boolean; __sb: unknown };
W.__ready = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statLine = () => {
  const st = traffic.store;
  return `arr ${traffic.stats.arrived} rm ${traffic.stats.removed} veh ${traffic.vehicleCount} trips ${traffic.trips}/${traffic.stats.target} flow ${world.stats.trafficFlow}% mover ${traffic.mover!.stats.stepMs.toFixed(2)}ms lights ${traffic.mover!.stats.waitingAtLights} paths ${traffic.paths.stats.requests}/${traffic.paths.stats.failures}f/${traffic.paths.stats.cacheHits}c active ${st.activeN}  drawn ${vehicles.stats.drawn}/${vehicles.stats.sections} glows ${vehicles.stats.glows} peds ${vehicles.pedestrians.stats.drawn} render ${vehicles.stats.ms.toFixed(1)}ms`;
};
async function warm(): Promise<void> {
  let k = 0;
  const steps = Math.round(WARM / 0.2);
  for (let i = 0; i < steps; i++) {
    game.simDt = 0.2;
    roads.update(0.05);
    traffic.update(0.05);
    world.flushChanges();
    if (i === Math.round(steps * 0.7)) dispatchAll();
    if (++k % 6 === 0) await sleep(0);
  }
  log(statLine());
}
let frames = 0, settle = 0;
let last = performance.now();
const live = params.get('live') === '1';
function frame(): void {
  if (W.__ready && ++settle > 2 && !live) return;
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.simDt = live ? dt : frames < 2 && !GALLERY ? 0.05 : 0;
  game.dt = dt;
  game.time += dt;
  roads.budgetMs = 200;
  if (live) traffic.update(dt);
  world.flushChanges();
  gr.update(frames < 3 ? 1 : dt);
  roads.update(dt);
  buildings?.update(dt);
  vehicles.update(frames < 2 ? 0.016 : dt);
  gr.render();
  frames++;
  stats.textContent = statLine();
  const bpending = buildings?.stats().pending ?? 0;
  if (roads.stats.pending === 0 && !bpending && frames > 8) W.__ready = true;
}
W.__sb = { world, traffic, vehicles, roads, buildings, gr, renderer: gr.renderer, render: () => gr.render(), game };
const GALLERY = params.get('gallery');
function gallery(): void {
  // static showroom: every model in a row along the highway (no simulation)
  traffic.clearVehicles();
  for (const rt of traffic.transit.rt.values()) rt.veh = [];
  const st = traffic.store;
  const small = [0, 1, 2, 3, 4, 5, 6, 18, 21, 22, 7, 28, 23, 19];
  const big = [8, 9, 10, 17, 20, 11, 12, 13];
  const rail = [14, 15, 27, 16, 25, 26];
  const list = GALLERY === 'big' ? big : GALLERY === 'rail' ? rail : small;
  const palette = [0xc42a22, 0xf2f2ef, 0x1f3e6e, 0x17181b, 0xa9adb2, 0xe0b21c, 0xf2c21b, 0xf4f5f7, 0x101113, 0x1d6fb8, 0xf4f4f1, 0xf2c230, 0xe8a317, 0xf6f6f2];
  let z = 0;
  const x0 = 32 * 16 + 8;
  for (let k = 0; k < list.length; k++) {
    const m = list[k];
    const L = [4.6, 4.0, 4.7, 5.3, 4.9, 4.4, 4.6, 5.6, 7.6, 6.2, 12.4, 12.0, 10.4, 8.6, 18.6, 20.0, 17.0, 8.8, 4.7, 6.2, 8.4, 5.6, 1.8, 5.4, 26.0, 11.0, 9.0, 16.0, 5.0][m];
    const i = st.alloc();
    st.model[i] = m;
    st.nsec[i] = 1;
    st.comp[i] = 0;
    st.flags[i] = m === 17 || m === 18 || m === 19 ? 1 : m === 20 || m === 23 ? 32 : 0;
    st.color[i] = GALLERY === 'rail' || GALLERY === 'big' ? [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0xf2f2ef, 0xc42a22, 0x2c5aa0][k % 8] : palette[k % palette.length];
    st.seed[i] = k * 977;
    st.len[i] = L;
    st.half[i] = L / 2;
    z += L / 2 + 1.6;
    st.x[i] = x0 + ((k % 2) * 2 - 1) * 2.2 * (GALLERY === 'rail' ? 2 : 1);
    st.z[i] = 22 * 16 + z;
    z += L / 2;
    st.yaw[i] = k % 2 ? 0.5 : -0.5;
    st.fade[i] = 1;
    st.state[i] = 2;
    st.activate(i);
  }
  const zc = (22 * 16 + z * Number(params.get('gz') ?? 0.5)) / 16;
  gr.cameraCtl.setPose(32.5, zc, GALLERY === 'rail' ? 40 : Number(params.get('gd') ?? 16), THREE.MathUtils.degToRad(Number(params.get('ga') ?? 70)), THREE.MathUtils.degToRad(Number(params.get('ge') ?? 20)));
}

void warm().then(async () => {
  if (GALLERY) gallery();
  const TOOL = params.get('tool');
  if (TOOL) {
    // transit tool preview: two placed stops + a hovered third one
    const tool = toolReg.tools.get('transit') as { activate(o: unknown): void; onPointerDown(e: unknown): void; onPointerMove(e: unknown): void; update(dt: number): void; hint(): string };
    toolReg.current = { id: 'transit' };
    tool.activate({ mode: TOOL });
    const ev = (x: number, y: number) => ({ cell: { x, y }, point: null, button: 0, shift: false, ctrl: false, alt: false, clientX: 0, clientY: 0 });
    const pts: Record<string, [number, number][]> = { bus: [[44, 60], [64, 58], [86, 50]], tram: [[20, 46], [50, 46], [80, 46]], metro: [[30, 40], [60, 20], [80, 60]] };
    const p3 = pts[TOOL] ?? pts.bus;
    tool.onPointerDown(ev(...p3[0]));
    tool.onPointerDown(ev(...p3[1]));
    tool.onPointerMove(ev(...p3[2]));
    traffic.update(0.016);
    await sleep(300);
    traffic.update(0.016);
    await sleep(300);
    tool.update(0.016);
    log('tool hint', tool.hint());
  }
  // pedestrians spawn around the camera focus: let them walk a little first
  gr.update(1);
  roads.budgetMs = 400;
  for (let i = 0; i < 600; i++) {
    roads.update(0.016);
    buildings?.update(0.016);
    if (roads.stats.pending === 0 && (buildings?.stats().pending ?? 0) === 0 && i > 4) break;
  }
  log('prebuild', roads.stats.pending, buildings?.stats().pending);
  for (let i = 0; i < 40; i++) {
    game.simDt = 0.1;
    vehicles.pedestrians.update(0.1);
  }
  frame();
});

// ── UI ─────────────────────────────────────────────────────────────────────
const ui = document.getElementById('ui')!;
const link = (label: string, p: Record<string, string>) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(p)) q.set(k, v);
    location.search = q.toString();
  };
  ui.appendChild(b);
};
for (const t of Object.keys(HOURS)) link(t, { t });
for (const v of Object.keys(views)) link(v, { cam: v });
