// render-core sandbox: the real GameRenderer (sky, terrain, water, trees,
// overlays, post) on a generated map, driven by a minimal fake Game.
//
// URL params:
//   theme, size (small|medium|large|huge), seed, mountains, water, forests
//   hour (0..24), month (0..11) | day, weather (clear|cloudy|rain|storm|snow|fog|heatwave|blizzard),
//   intensity, snow (0..1 snow cover), wind (m/s), flood (m)
//   cam=x,y,dist,yawDeg,pitchDeg  (x,y in cells; default = map start)
//   overlay=<fieldId>, city=1 (sandbox boxes + roads), anim=<hours per second>
//   shadows=off|low|medium|high, ao=1, tilt=1, bloom=0, aa=0, fog=0, clouds=0, res=<scale>, dist=<chunks>, trees=<0.2..1>
//   clean=1 (hide HUD)
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CELL, MAP_SIZES, type MapSizeId } from '../../src/core/constants';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import { FIELD_IDS, RoadType, type FieldId, type GeneratedMap, type MapSettings, type ThemeId, type WeatherType } from '../../src/core/types';
import { Noise } from '../../src/core/noise';
import { World } from '../../src/world/World';
import { ROAD_LIFT } from '../../src/world/roadHeight';
import { generateMap } from '../../src/world/mapgen';
import { themeDef } from '../../src/data/themes';
import { DEFAULT_KEYBINDS, defaultSettings, type ActionId } from '../../src/settings/types';
import type { Game } from '../../src/game/Game';
import type { Gesture, PointerInfo } from '../../src/input/InputManager';
import { GameRenderer } from '../../src/render/Renderer';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);
const hud = document.getElementById('hud')!;
if (qs.get('clean') === '1') document.body.classList.add('clean');

// ── settings ────────────────────────────────────────────────────────────────
const settings = defaultSettings();
const g = settings.graphics;
if (qs.has('shadows')) g.shadows = qs.get('shadows') as typeof g.shadows;
if (qs.has('ao')) g.ambientOcclusion = qs.get('ao') === '1';
if (qs.has('tilt')) g.tiltShift = qs.get('tilt') === '1';
if (qs.has('bloom')) g.bloom = qs.get('bloom') !== '0';
if (qs.has('aa')) g.antialias = qs.get('aa') !== '0';
if (qs.has('fog')) g.fog = qs.get('fog') !== '0';
if (qs.has('clouds')) g.clouds = qs.get('clouds') !== '0';
g.resolutionScale = num('res', 1);
g.renderDistance = num('dist', g.renderDistance);
g.treeDensity = num('trees', 1);

// ── fake game + input ───────────────────────────────────────────────────────
const events = new EventBus<GameEvents>();
const keys = new Set<string>();
const pointerFns: ((p: PointerInfo) => void)[] = [];
const gestureFns: ((g: Gesture) => void)[] = [];
const input = {
  enabled: true,
  pointer: { x: 0, y: 0, overCanvas: false },
  isDown: (a: ActionId) => (settings.controls.keybinds[a] ?? DEFAULT_KEYBINDS[a]).some((k) => keys.has(k)),
  onAction: () => () => {},
  onPointer: (fn: (p: PointerInfo) => void) => (pointerFns.push(fn), () => {}),
  onGesture: (fn: (g: Gesture) => void) => (gestureFns.push(fn), () => {}),
};
const game = { events, settings: { value: settings }, input, world: null as World | null, renderer: null as GameRenderer | null, simDt: 0 };
const view = document.getElementById('view')!;
const gr = new GameRenderer(game as unknown as Game, view);
game.renderer = gr;
gr.applySettings(settings);

window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
const emit = (type: PointerInfo['type'], e: PointerEvent | WheelEvent, wheel = 0) => {
  const info: PointerInfo = { type, button: e.button, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY, dx: e.movementX, dy: e.movementY, wheel, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, onCanvas: true };
  input.pointer.x = e.clientX;
  input.pointer.y = e.clientY;
  input.pointer.overCanvas = true;
  for (const f of pointerFns) f(info);
};
gr.canvas.addEventListener('pointerdown', (e) => emit('down', e));
window.addEventListener('pointermove', (e) => emit('move', e));
window.addEventListener('pointerup', (e) => emit('up', e));
gr.canvas.addEventListener('wheel', (e) => { e.preventDefault(); emit('wheel', e, Math.sign(e.deltaY)); }, { passive: false });
gr.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ── world ───────────────────────────────────────────────────────────────────
const theme = (qs.get('theme') ?? 'temperate') as ThemeId;
const ms: MapSettings = {
  cityName: 'Sandbox', mapSize: (qs.get('size') ?? 'small') as MapSizeId, theme, seed: num('seed', 42),
  style: themeDef(theme).defaultStyle, difficulty: 'normal', creative: true, disasters: false,
  mountains: num('mountains', 0.5), water: num('water', 0.5), forests: num('forests', 0.5),
};

function synthMap(s: MapSettings): GeneratedMap {
  const size = MAP_SIZES[s.mapSize];
  const n = new Noise(s.seed);
  const V = size + 1;
  const heights = new Float32Array(V * V);
  for (let y = 0; y < V; y++)
    for (let x = 0; x < V; x++) {
      const u = x / size, v = y / size;
      let h = 30 + n.noise2(u * 3, v * 3) * 25 + n.noise2(u * 9, v * 9) * 6;
      h += Math.max(0, u + v - 1.1) * 260 * (0.6 + 0.4 * n.noise2(u * 5 + 3, v * 5));
      h -= Math.max(0, 0.45 - (u * 0.7 + v * 0.3)) * 260;
      heights[y * V + x] = h;
    }
  const water = new Float32Array(size * size).fill(-1e4);
  const trees = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = (heights[y * V + x] + heights[y * V + x + 1] + heights[(y + 1) * V + x] + heights[(y + 1) * V + x + 1]) / 4;
      if (h < 0) water[i] = 0;
      else if (n.noise2(x / 30, y / 30) > 0.15) trees[i] = 1 + Math.floor(Math.max(0, n.noise2(x / 9, y / 9)) * 3);
    }
  const z = () => new Uint8Array(size * size);
  return { size, heights, water, seaLevel: 0, trees, fertility: z(), forest: z(), ore: z(), oil: z(), wind: z(), connections: [], highway: [], rail: [], start: { x: size >> 1, y: size >> 1 } };
}

async function main(): Promise<void> {
  hud.textContent = 'generating map…';
  let map: GeneratedMap;
  try {
    map = qs.get('gen') === 'synth' ? synthMap(ms) : await generateMap(ms, (p, l) => (hud.textContent = `mapgen ${(p * 100) | 0}% ${l}`));
  } catch (err) {
    console.warn('generateMap failed, using synthetic terrain', err);
    map = synthMap(ms);
  }
  const world = new World(ms, map.size);
  world.applyGeneratedMap(map);
  for (const c of map.highway) world.setRoad(c.x, c.y, RoadType.Highway, world.isWater(c.x, c.y) ? 1 : 0);
  for (const c of map.rail) world.setRoad(c.x, c.y, RoadType.Rail, world.isWater(c.x, c.y) ? 1 : 0);
  world.bus = events;
  world.time.hour = num('hour', 16.8);
  world.time.day = qs.has('day') ? num('day', 0) : num('month', 5) * DAYS_PER_MONTH + 12;
  world.weather.type = (qs.get('weather') ?? 'clear') as WeatherType;
  world.weather.intensity = num('intensity', 0.8);
  world.weather.snowCover = num('snow', world.weather.type === 'snow' || world.weather.type === 'blizzard' ? 0.85 : 0);
  world.weather.windSpeed = num('wind', 5);
  world.floodOffset = num('flood', 0);
  world.stats.population = num('pop', 40000);
  // fake field data for overlays
  const nz = new Noise(7);
  for (const f of FIELD_IDS) {
    const arr = world.fields[f];
    if (['fertility', 'forest', 'ore', 'oil', 'wind'].includes(f)) continue;
    for (let y = 0; y < world.size; y++)
      for (let x = 0; x < world.size; x++) {
        const d = Math.hypot(x - world.home.x, y - world.home.y);
        arr[y * world.size + x] = Math.max(0, Math.min(255, 128 + nz.noise2(x / 18, y / 18) * 90 + (60 - d) * 1.2));
      }
  }
  if (qs.get('city') === '1') buildCity(world);
  game.world = world;
  world.flushChanges();
  gr.onWorldLoaded(world);
  events.emit('world:loaded', world);
  const cam = qs.has('cam') ? qs.get('cam')!.split(',').map(Number) : [];
  const cx = Number.isFinite(cam[0]) ? cam[0] : world.home.x, cy = Number.isFinite(cam[1]) ? cam[1] : world.home.y;
  gr.cameraCtl.setPose(cx, cy, Number.isFinite(cam[2]) ? cam[2] : 900, ((Number.isFinite(cam[3]) ? cam[3] : 35) * Math.PI) / 180, ((Number.isFinite(cam[4]) ? cam[4] : 38) * Math.PI) / 180);
  if (qs.has('overlay')) gr.setOverlay(qs.get('overlay') as FieldId);
  const anim = num('anim', 0);
  let last = performance.now();
  let frames = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    if ((window as unknown as { __pause?: boolean }).__pause) {
      last = performance.now();
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (anim) world.time.hour = (world.time.hour + anim * dt) % 24;
    world.flushChanges();
    gr.update(frames < 3 ? 1 : dt);
    gr.render();
    frames++;
    if (frames % 10 === 0 || frames < 5) {
      const s = gr.stats;
      hud.textContent = `${ms.theme} ${world.size}² · ${world.time.hour.toFixed(2)}h day ${world.time.day | 0} · ${world.weather.type}\n` +
        `fps ${s.fps.toFixed(1)} · ${s.frameMs.toFixed(1)} ms · calls ${s.drawCalls} · tris ${(s.triangles / 1000) | 0}k · trees ${gr.trees?.instanceCount ?? 0}\n` +
        `terrain leaves ${gr.terrain?.leafCount ?? 0} · reversedZ ${gr.reversedDepth} · near ${gr.camera.near.toFixed(2)} far ${gr.camera.far | 0}`;
    }
    (window as unknown as { __frames: number }).__frames = frames;
  };
  loop();
  Object.assign(window, { __r: gr, __world: world, __game: game });
}

/** sandbox-only stand-ins for other agents' renderers: a road grid and boxes */
function buildCity(world: World): void {
  const hx = world.home.x, hy = world.home.y;
  const rng = new Noise(3);
  for (let y = hy - 14; y <= hy + 14; y++)
    for (let x = hx - 14; x <= hx + 14; x++) {
      if (!world.inBounds(x, y) || world.isWater(x, y)) continue;
      if ((x - hx) % 5 === 0 || (y - hy) % 5 === 0) world.setRoad(x, y, RoadType.Street);
      world.setTrees(x, y, 0);
    }
  const roadGeo: number[] = [];
  const idx: number[] = [];
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
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.75, emissive: 0xffc070, emissiveIntensity: 0 });
  const count = 400;
  const inst = new THREE.InstancedMesh(box, mat, count);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let y = hy - 14; y <= hy + 14 && n < count; y++)
    for (let x = hx - 14; x <= hx + 14 && n < count; x++) {
      if (!world.inBounds(x, y) || world.roadAt(x, y) || world.isWater(x, y)) continue;
      const d = Math.hypot(x - hx, y - hy);
      const hgt = 8 + Math.max(0, 1 - d / 16) * 90 * (0.4 + 0.6 * (rng.noise2(x * 0.7, y * 0.7) * 0.5 + 0.5));
      const c = world.cellCenter(x, y);
      m.compose(new THREE.Vector3(c.x, c.y - 0.5, c.z), new THREE.Quaternion(), new THREE.Vector3(12, hgt, 12));
      inst.setMatrixAt(n, m);
      inst.setColorAt(n, col.setHSL(0.08 + rng.noise2(x, y) * 0.05, 0.18, 0.62 + rng.noise2(y, x) * 0.15));
      n++;
    }
  inst.count = n;
  inst.castShadow = true;
  inst.receiveShadow = true;
  gr.scene.add(inst);
  // windows glow at night
  const tick = () => {
    mat.emissiveIntensity = gr.lighting.night * 0.9;
    requestAnimationFrame(tick);
  };
  tick();
}

main().catch((e) => {
  hud.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
