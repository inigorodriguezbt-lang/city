// events sandbox: the real GameRenderer (sky, terrain, water, post) + the
// real EventSystem and EffectsRenderer on a synthetic map with a small city
// of boxes. Other systems are minimal stand-ins.
//
// URL params:
//   scene = all | storm | fire | tornado | meteor | giant | ufo | balloons | dino | tsunami | fireworks | forest | quake | explosion | geyser | shower | sinkhole | flood
//   all: only=<kinds,…> gap=<cells> lift=<m> scale=<n> (emitter showcase row); cov=<0..255> fire coverage
//   warm=<s> pre-simulated seconds, maxdt=<s> frame dt cap, bloom=0
//   helper: node sandbox/events/shot.cjs "<query>" out.png [waitMs] [WxH]  (dev server: npx vite --port 5206 --config sandbox/events/vite.config.ts)
//   hour (0..24), month (0..11), weather (clear|cloudy|rain|storm|snow|fog|heatwave|blizzard), intensity, snow
//   cam=x,y,dist,yawDeg,pitchDeg (cells), speed (sim speed multiplier, default 1), clean=1
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CELL, DAYS_PER_MONTH, REAL_SECONDS_PER_DAY } from '../../src/core/constants';
import { Noise } from '../../src/core/noise';
import { BFlag, Dir, RoadType, ZoneType, type Building, type GeneratedMap, type MapSettings, type WeatherType } from '../../src/core/types';
import { World } from '../../src/world/World';
import { ROAD_LIFT } from '../../src/world/roadHeight';
import { DEFAULT_KEYBINDS, defaultSettings, type ActionId } from '../../src/settings/types';
import type { Game } from '../../src/game/Game';
import type { Gesture, PointerInfo } from '../../src/input/InputManager';
import { GameRenderer } from '../../src/render/Renderer';
import { EffectsRenderer } from '../../src/render/effects/EffectsRenderer';
import { EventSystem } from '../../src/sim/events/EventSystem';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);
const hud = document.getElementById('hud')!;
if (qs.get('clean') === '1') document.body.classList.add('clean');
const scene = qs.get('scene') ?? 'all';

const settings = defaultSettings();
settings.graphics.resolutionScale = num('res', 1);
settings.graphics.shadows = (qs.get('shadows') as typeof settings.graphics.shadows) ?? 'medium';
if (qs.has('bloom')) settings.graphics.bloom = qs.get('bloom') !== '0';

// ── fake game ───────────────────────────────────────────────────────────────
const events = new EventBus<GameEvents>();
const keys = new Set<string>();
const pointerFns: ((p: PointerInfo) => void)[] = [];
const input = {
  enabled: true,
  pointer: { x: 0, y: 0, overCanvas: false },
  isDown: (a: ActionId) => (settings.controls.keybinds[a] ?? DEFAULT_KEYBINDS[a]).some((k) => keys.has(k)),
  onAction: () => () => {},
  onPointer: (fn: (p: PointerInfo) => void) => (pointerFns.push(fn), () => {}),
  onGesture: (_fn: (g: Gesture) => void) => () => {},
};
const heights = new Map<number, number>();
const game = {
  events,
  settings: { value: settings },
  input,
  world: null as World | null,
  renderer: null as unknown as GameRenderer,
  simDt: 0,
  audio: { play: () => {}, playAt: () => {} },
  sim: { setSpeed: (l: number) => console.log('[sandbox] setSpeed', l), isPolicyActive: () => false },
  ui: { toast: (t: string) => console.log('[sandbox] toast', t) },
  traffic: { dispatch: () => false },
  actions: {
    destroyBuilding(id: number, cause: string) {
      const w = game.world!;
      const b = w.getBuilding(id);
      if (!b) return;
      b.flags |= BFlag.Collapsed;
      if (cause === 'fire') b.flags |= BFlag.Burned;
      b.flags &= ~BFlag.OnFire;
      b.fire = 0;
      w.touchBuilding(b);
      setBox(b);
    },
  },
  buildings: {
    buildingTop(id: number) {
      const b = game.world?.getBuilding(id);
      if (!b || !game.world) return 0;
      return game.world.cellHeight(b.x, b.y) + (b.flags & BFlag.Collapsed ? 2 : heights.get(id) ?? 10);
    },
  },
  effects: null as unknown as EffectsRenderer,
  eventSystem: null as unknown as EventSystem,
};
const view = document.getElementById('view')!;
const gr = new GameRenderer(game as unknown as Game, view);
game.renderer = gr;
gr.applySettings(settings);
const effects = new EffectsRenderer(game as unknown as Game);
game.effects = effects;
const eventSystem = new EventSystem(game as unknown as Game);
game.eventSystem = eventSystem;

window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
const emit = (type: PointerInfo['type'], e: PointerEvent | WheelEvent, wheel = 0) => {
  const info: PointerInfo = { type, button: e.button, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY, dx: e.movementX, dy: e.movementY, wheel, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, onCanvas: true };
  for (const f of pointerFns) f(info);
};
gr.canvas.addEventListener('pointerdown', (e) => emit('down', e));
window.addEventListener('pointermove', (e) => emit('move', e));
window.addEventListener('pointerup', (e) => emit('up', e));
gr.canvas.addEventListener('wheel', (e) => { e.preventDefault(); emit('wheel', e, Math.sign(e.deltaY)); }, { passive: false });

// ── world ───────────────────────────────────────────────────────────────────
const ms: MapSettings = {
  cityName: 'Sandbox', mapSize: 'small', theme: (qs.get('theme') as MapSettings['theme']) ?? 'temperate', seed: 7,
  style: 'european', difficulty: 'normal', creative: true, disasters: true, mountains: 0.4, water: 0.5, forests: 0.5,
};

function synthMap(): GeneratedMap {
  const size = 256;
  const n = new Noise(11);
  const V = size + 1;
  const hts = new Float32Array(V * V);
  for (let y = 0; y < V; y++)
    for (let x = 0; x < V; x++) {
      const u = x / size, v = y / size;
      let h = 14 + n.noise2(u * 3, v * 3) * 8 + n.noise2(u * 9, v * 9) * 2;
      // city plateau
      const dc = Math.hypot(x - 128, y - 128);
      const kf = Math.min(1, Math.max(0, (dc - 40) / 30));
      h = h * kf * kf * (3 - 2 * kf) + 12 * (1 - kf * kf * (3 - 2 * kf));
      // sea to the west, hills to the east
      h -= Math.max(0, 0.32 - u) * 220;
      h += Math.max(0, u - 0.72) * 260 * (0.6 + 0.4 * n.noise2(u * 5, v * 5 + 3));
      hts[y * V + x] = h;
    }
  const water = new Float32Array(size * size).fill(-1e4);
  const trees = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = (hts[y * V + x] + hts[y * V + x + 1] + hts[(y + 1) * V + x] + hts[(y + 1) * V + x + 1]) / 4;
      if (h < 0) water[i] = 0;
      else if (Math.hypot(x - 128, y - 128) > 22 && n.noise2(x / 20, y / 20) > 0.05) trees[i] = 1 + Math.floor(Math.max(0, n.noise2(x / 7, y / 7) + 0.5) * 2.2);
    }
  const z = () => new Uint8Array(size * size);
  return { size, heights: hts, water, seaLevel: 0, trees, fertility: z(), forest: z(), ore: z(), oil: z(), wind: z(), connections: [], highway: [], rail: [], start: { x: 128, y: 128 } };
}

// box renderer for the sandbox city
const box = new THREE.BoxGeometry(1, 1, 1);
box.translate(0, 0.5, 0);
const boxMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.75, emissive: 0xffb060, emissiveIntensity: 0 });
const boxes = new THREE.InstancedMesh(box, boxMat, 700);
boxes.castShadow = boxes.receiveShadow = true;
boxes.count = 0;
const boxIndex = new Map<number, number>();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
function setBox(b: Building): void {
  const w = game.world!;
  let i = boxIndex.get(b.id);
  if (i === undefined) {
    i = boxes.count++;
    boxIndex.set(b.id, i);
  }
  const h = b.flags & BFlag.Collapsed ? 2.5 : heights.get(b.id) ?? 10;
  const c = w.cellCenter(b.x, b.y);
  _p.set(c.x + (b.w - 1) * CELL * 0.5, w.cellHeight(b.x, b.y) - 0.3, c.z + (b.h - 1) * CELL * 0.5);
  _s.set(b.w * CELL - 3, h, b.h * CELL - 3);
  _m.compose(_p, _q, _s);
  boxes.setMatrixAt(i, _m);
  const burned = b.flags & (BFlag.Burned | BFlag.Collapsed);
  boxes.setColorAt(i, burned ? _c.setRGB(0.12, 0.1, 0.09) : _c.setHSL(0.08 + (b.seed % 7) * 0.012, 0.16, 0.55 + (b.seed % 5) * 0.04));
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
}

function buildCity(world: World): void {
  const hx = 128, hy = 128;
  const rng = new Noise(3);
  for (let y = hy - 16; y <= hy + 16; y++)
    for (let x = hx - 16; x <= hx + 16; x++) {
      if ((x - hx) % 4 === 0 || (y - hy) % 4 === 0) world.setRoad(x, y, RoadType.Street);
      world.setTrees(x, y, 0);
    }
  const roadGeo: number[] = [], idx: number[] = [];
  for (let y = 0; y < world.size; y++)
    for (let x = 0; x < world.size; x++) {
      if (!world.roadAt(x, y)) continue;
      const b = roadGeo.length / 3;
      for (const [vx, vy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) roadGeo.push(vx * CELL, world.vertexHeight(vx, vy) + ROAD_LIFT, vy * CELL);
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roadGeo, 3));
  rg.setIndex(idx);
  rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  road.receiveShadow = true;
  gr.scene.add(road);
  let seed = 1;
  for (let by = hy - 16; by < hy + 16; by += 4)
    for (let bx = hx - 16; bx < hx + 16; bx += 4) {
      // each block of 3×3 cells holds 1–4 buildings
      const lots: [number, number, number, number][] = rng.noise2(bx, by) > 0.3 ? [[0, 0, 3, 3]] : [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 2]];
      for (const [ox, oy, w, h] of lots) {
        const x = bx + 1 + ox, y = by + 1 + oy;
        const d = Math.hypot(x - hx, y - hy);
        const b = world.addBuilding({ kind: 'zoned', defId: 'zoned:res_high', x, y, w, h, rot: Dir.S, zone: ZoneType.ResHigh, built: 1, level: 3, seed: seed++ });
        b.flags &= ~BFlag.UnderConstruction;
        heights.set(b.id, 8 + Math.max(0, 1 - d / 17) * 70 * (0.4 + 0.6 * (rng.noise2(x * 0.7, y * 0.7) * 0.5 + 0.5)));
        setBox(b);
      }
    }
  gr.scene.add(boxes);
  // fire coverage (moderate) so fires eventually go out
  world.fields.fire.fill(num('cov', 40));
}

async function main(): Promise<void> {
  const map = synthMap();
  const world = new World(ms, map.size);
  world.applyGeneratedMap(map);
  world.bus = events;
  world.time.hour = num('hour', 17.2);
  world.time.day = num('month', 5) * DAYS_PER_MONTH + 12;
  world.stats.population = 60000;
  game.world = world;
  buildCity(world);
  world.flushChanges();
  gr.onWorldLoaded(world);
  eventSystem.onWorldLoaded(world);
  effects.onWorldLoaded(world);
  events.emit('world:loaded', world);
  if (qs.has('weather')) eventSystem.setWeather(qs.get('weather') as WeatherType, num('intensity', 0.85), 1000);
  else eventSystem.setWeather('clear', 0.1, 1000);
  if (qs.has('snow')) world.weather.snowCover = num('snow', 0);
  gr.snapTransitions();

  const cam = qs.has('cam') ? qs.get('cam')!.split(',').map(Number) : [];
  const setCam = (x: number, y: number, d: number, yaw: number, pitch: number) =>
    gr.cameraCtl.setPose(Number.isFinite(cam[0]) ? cam[0] : x, Number.isFinite(cam[1]) ? cam[1] : y, Number.isFinite(cam[2]) ? cam[2] : d, ((Number.isFinite(cam[3]) ? cam[3] : yaw) * Math.PI) / 180, ((Number.isFinite(cam[4]) ? cam[4] : pitch) * Math.PI) / 180);
  setupScene(world, setCam);

  const speed = num('speed', 1);
  // warm-up: simulate a few seconds before the first frame (SwiftShader renders very slowly)
  const warm = num('warm', 6);
  for (let t = 0; t < warm; t += 0.1) {
    game.simDt = 0.1 * speed;
    world.time.day += game.simDt / REAL_SECONDS_PER_DAY;
    eventSystem.update(0.1);
    world.flushChanges();
    gr.update(0.1);
    effects.update(0.1);
  }
  const maxDt = num('maxdt', 0.35);
  let last = performance.now();
  let frames = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    if ((window as unknown as { __pause?: boolean }).__pause) {
      last = performance.now();
      return;
    }
    const now = performance.now();
    const dt = Math.min(maxDt, (now - last) / 1000);
    last = now;
    game.simDt = dt * speed;
    world.time.day += game.simDt / REAL_SECONDS_PER_DAY;
    const anim = num('anim', 0);
    if (anim) world.time.hour = (world.time.hour + anim * dt) % 24;
    eventSystem.update(dt);
    world.flushChanges();
    effects.update(dt);
    gr.update(frames < 3 ? 1 : dt);
    gr.render();
    boxMat.emissiveIntensity = gr.lighting.night * 0.35;
    frames++;
    if (frames % 10 === 0 || frames < 5) {
      const s = gr.stats, st = effects.stats();
      hud.textContent = `${scene} · ${world.time.hour.toFixed(2)}h day ${world.time.day.toFixed(2)} · ${world.weather.type} ${world.weather.intensity.toFixed(2)} ${world.weather.temperature.toFixed(1)}°C\n` +
        `fps ${s.fps.toFixed(1)} · calls ${s.drawCalls} · emitters ${st.liveEmitters}/${st.emitters} · particle load ${st.particleLoad} · budget ${st.budget.toFixed(2)}\n` +
        `events: ${world.activeEvents.map((e) => e.defId).join(', ')} · burning ${eventSystem.burningBuildings().size} · trees ${eventSystem.burningTrees().size} · flood ${world.floodOffset.toFixed(2)}`;
    }
    (window as unknown as { __frames: number }).__frames = frames;
  };
  loop();
  Object.assign(window, { __r: gr, __world: world, __game: game, __fx: effects, __ev: eventSystem });
}

function setupScene(world: World, setCam: (x: number, y: number, d: number, yaw: number, pitch: number) => void): void {
  const at = (x: number, y: number) => {
    const c = world.cellCenter(x, y);
    return new THREE.Vector3(c.x, gr.groundHeight(c.x, c.z), c.z);
  };
  switch (scene) {
    case 'fire': {
      for (const [x, y] of [[129, 125], [121, 133], [133, 121]]) {
        const b = world.buildingAt(x, y);
        if (b) eventSystem.startFire(b.id);
      }
      setCam(128, 128, 420, 35, 32);
      break;
    }
    case 'tornado':
      eventSystem.trigger('tornado', { x: 120, y: 130 });
      setCam(124, 134, 1100, 25, 16);
      break;
    case 'meteor':
    case 'giant':
      eventSystem.trigger(scene === 'giant' ? 'giant_meteor' : 'meteor', { x: 134, y: 126 });
      setCam(128, 128, 1200, 30, 24);
      break;
    case 'ufo':
      eventSystem.trigger('ufo', { x: 128, y: 128 });
      setCam(128, 128, 520, 30, 18);
      break;
    case 'balloons':
      eventSystem.trigger('balloon_parade', { x: 128, y: 128 });
      setCam(128, 128, 900, 30, 12);
      break;
    case 'dino':
      eventSystem.trigger('dino_balloon', { x: 128, y: 128 });
      setCam(128, 128, 420, 30, 14);
      break;
    case 'tsunami':
      eventSystem.trigger('tsunami', { x: 83, y: 128 });
      setCam(96, 128, 900, 100, 14);
      break;
    case 'flood':
      eventSystem.trigger('flood', { x: 83, y: 128 });
      setCam(90, 128, 900, -80, 30);
      break;
    case 'fireworks':
      eventSystem.trigger('new_year', { x: 128, y: 128 });
      setCam(128, 128, 800, 30, 14);
      break;
    case 'forest':
      eventSystem.trigger('forest_fire', { x: 150, y: 150 });
      setCam(150, 150, 600, 30, 28);
      break;
    case 'quake':
      eventSystem.trigger('earthquake', { x: 128, y: 128 });
      setCam(128, 128, 700, 30, 30);
      break;
    case 'explosion':
      eventSystem.trigger('explosion', { x: 129, y: 129 });
      setCam(128, 128, 500, 30, 25);
      break;
    case 'geyser':
      eventSystem.trigger('water_main_break', { x: 128, y: 128 });
      setCam(128, 128, 120, 30, 25);
      break;
    case 'shower':
      eventSystem.trigger('meteor_shower');
      setCam(128, 128, 900, 30, 10);
      break;
    case 'sinkhole':
      eventSystem.trigger('sinkhole', { x: 125, y: 125 });
      setCam(125, 125, 250, 30, 35);
      break;
    case 'storm':
      setCam(128, 128, 900, 30, 14);
      break;
    default: {
      // showcase of every emitter kind
      for (let y = 145; y < 162; y++) for (let x = 108; x < 150; x++) world.setTrees(x, y, 0);
      const all = ['fire', 'smoke', 'steam', 'dust', 'fountain', 'sparks', 'splash', 'fireworks', 'explosion'] as const;
      const only = qs.get('only')?.split(',') ?? all.slice();
      const kinds = all.filter((k) => only.includes(k));
      const gap = num('gap', 3);
      kinds.forEach((k, i) => {
        const p = at(128 + (i - (kinds.length - 1) / 2) * gap, 152);
        effects.addEmitter(k, k === 'smoke' || k === 'steam' ? p.clone().setY(p.y + num('lift', 20)) : p, 1, { scale: k === 'fireworks' ? 0.8 : num('scale', 1.2) });
      });
      const b = world.buildingAt(129, 141);
      if (b) eventSystem.startFire(b.id);
      setCam(128, 150, 170, 0, 12);
    }
  }
}

main().catch((e) => {
  hud.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
