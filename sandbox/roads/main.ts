// Roads + zones sandbox: a synthetic valley (hills, a river with water) and a
// hand-built network exercising every road type, junction shape, bridges,
// rail, tram, dead ends and slopes; zoned lots, a few buildings, districts.
// URL params: ?t=golden|noon|dusk|night|rain|snow|autumn  &cam=<preset>  &grid=1  &districts=1  &live=1 (keep rendering)
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CELL, WATER_EPS } from '../../src/core/constants';
import { ZoneType } from '../../src/core/types';
import { RoadSurface } from '../../src/world/roadHeight';
import { RoadRenderer } from '../../src/render/roads/RoadRenderer';
import { ZoneRenderer } from '../../src/render/zones/ZoneRenderer';
import type { Game } from '../../src/game/Game';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRealStage } from './real';
import { buildSandboxWorld, SIZE } from './world';

const params = new URLSearchParams(location.search);
const TIME = params.get('t') ?? 'golden';
const CAM = params.get('cam') ?? 'overview';
const REAL = params.get('real') === '1';

const { world, noise, bcolors } = buildSandboxWorld(TIME);

// ── basic stage: own lights, terrain stand-in, water, boxes ─────────────────
interface Look { sun: [number, number]; sunCol: number; sunI: number; sky: number; ground: number; hemiI: number; bg: number; fog: number; night: number; exposure: number }
function basicStage() {
  // ── three.js scene ─────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 20000);

  const LOOKS: Record<string, Look> = {
    golden: { sun: [0.2, 9], sunCol: 0xffb070, sunI: 3.2, sky: 0x9fb8d8, ground: 0x6b5a45, hemiI: 0.9, bg: 0xe9c9a4, fog: 0xe0c4a2, night: 0, exposure: 1.0 },
    noon: { sun: [0.8, 58], sunCol: 0xfff4e6, sunI: 3.4, sky: 0xa8c8f0, ground: 0x5a6045, hemiI: 1.1, bg: 0xa9c7ea, fog: 0xbfd4ea, night: 0, exposure: 0.95 },
    dusk: { sun: [2.6, 1.5], sunCol: 0xff8a50, sunI: 1.2, sky: 0x55648c, ground: 0x2a2530, hemiI: 0.55, bg: 0x6a6a8e, fog: 0x7a6f86, night: 0.75, exposure: 1.1 },
    // night exposure mimics the game's eye adaptation (SkySystem raises exposure up to ~3.4 at night)
    night: { sun: [3.6, 35], sunCol: 0x6f86c0, sunI: 0.07, sky: 0x1c2a48, ground: 0x0c0c10, hemiI: 0.08, bg: 0x060a14, fog: 0x0a1020, night: 1, exposure: 3.2 },
    rain: { sun: [1.1, 40], sunCol: 0xd8dde4, sunI: 0.9, sky: 0x9aa4b0, ground: 0x4a4c50, hemiI: 1.25, bg: 0x8e98a4, fog: 0x8d97a3, night: 0.15, exposure: 1.05 },
    snow: { sun: [1.6, 22], sunCol: 0xe8eefa, sunI: 1.6, sky: 0xc0cfe0, ground: 0x9aa0a8, hemiI: 1.0, bg: 0xc9d4e0, fog: 0xc8d2de, night: 0, exposure: 0.9 },
    autumn: { sun: [0.5, 25], sunCol: 0xffd9a8, sunI: 3.0, sky: 0xa8c0e0, ground: 0x6b5a45, hemiI: 1.0, bg: 0xb8cce4, fog: 0xc8d4e0, night: 0, exposure: 1.0 },
  };
  const look = LOOKS[TIME] ?? LOOKS.golden;
  renderer.toneMappingExposure = look.exposure;
  scene.background = new THREE.Color(look.bg);
  scene.fog = new THREE.Fog(look.fog, 900, 4200);
  const hemi = new THREE.HemisphereLight(look.sky, look.ground, look.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(look.sunCol, look.sunI);
  const [az, elDeg] = look.sun;
  const el = THREE.MathUtils.degToRad(elDeg);
  const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  // environment for reflections (gradient sky)
  {
    const envScene = new THREE.Scene();
    const g = new THREE.SphereGeometry(100, 32, 16);
    const col: number[] = [];
    const top = new THREE.Color(look.sky), hor = new THREE.Color(look.bg), bot = new THREE.Color(look.ground);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 100;
      const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.min(1, -y * 3));
      if (TIME === 'golden' || TIME === 'dusk') {
        const d = Math.max(0, new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize().dot(sunDir));
        c.lerp(new THREE.Color(look.sunCol), Math.pow(d, 8) * 0.8);
      }
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    envScene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = TIME === 'night' ? 0.25 : 0.8;
  }

  // terrain mesh (sandbox stand-in for render-core's terrain)
  {
    const N = SIZE + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const grass = new THREE.Color(world.theme.grass), dry = new THREE.Color(world.theme.grassDry), dirt = new THREE.Color(world.theme.dirt), sand = new THREE.Color(world.theme.sand);
    const snowC = new THREE.Color(0xf0f4fa);
    for (let vy = 0; vy < N; vy++)
      for (let vx = 0; vx < N; vx++) {
        const i = vy * N + vx;
        const h = world.heights[i];
        pos.set([vx * CELL, h, vy * CELL], i * 3);
        const n = noise.noise2(vx / 6, vy / 6) * 0.5 + 0.5;
        const c = grass.clone().lerp(dry, n * 0.6);
        if (h < 13.2) c.lerp(sand, 0.8);
        if (h < 11.5) c.lerp(dirt, 0.7);
        if (TIME === 'snow') c.lerp(snowC, 0.85);
        if (TIME === 'autumn') c.lerp(dry, 0.3);
        col.set([c.r, c.g, c.b], i * 3);
      }
    const idx: number[] = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const a = y * N + x, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true;
    scene.add(m);
    // water
    const wg: number[] = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const lvl = world.water[y * SIZE + x];
        if (lvl <= world.cellHeight(x, y) + WATER_EPS && !(lvl > -100 && world.cellMinMax(x, y)[0] < lvl)) continue;
        const x0 = x * CELL, z0 = y * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
        wg.push(x0, lvl, z0, x0, lvl, z1, x1, lvl, z0, x1, lvl, z0, x0, lvl, z1, x1, lvl, z1);
      }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wg, 3));
    wgeo.computeVertexNormals();
    const wm = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: TIME === 'snow' ? 0x3f5a66 : 0x1f4f5e, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 }));
    scene.add(wm);
    // simple buildings for context
    const bgeo: THREE.BufferGeometry[] = [];
    let bi = 0;
    const palette = [0xd8cbb8, 0xc9b8a4, 0xe2dccf, 0xb9a48d, 0xa8b0b8, 0xcfc6bb];
    for (const b of world.buildings.values()) {
      const hsh = bcolors[bi++] ?? 0;
      const floors = b.zone === ZoneType.ComHigh || b.zone === ZoneType.Office ? 6 + (hsh % 9) : b.zone === ZoneType.Industry ? 2 : 2 + (hsh % 2);
      const hgt = floors * 3.3;
      const w = b.w * CELL - 3, d = b.h * CELL - 3;
      const box = new THREE.BoxGeometry(w, hgt, d);
      const base = world.cellHeight(b.x + (b.w >> 1), b.y + (b.h >> 1));
      box.translate(b.x * CELL + (b.w * CELL) / 2, base + hgt / 2 - 0.5, b.y * CELL + (b.h * CELL) / 2);
      const c = new THREE.Color(palette[hsh % palette.length]);
      const cc = new Float32Array(box.getAttribute('position').count * 3);
      for (let i = 0; i < cc.length; i += 3) cc.set([c.r, c.g, c.b], i);
      box.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      bgeo.push(box);
    }
    if (bgeo.length) {
      const bm = new THREE.Mesh(mergeGeometries(bgeo)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
      bm.castShadow = bm.receiveShadow = true;
      scene.add(bm);
    }
  }

  const lighting = { sunDir, daylight: 1 - look.night, night: look.night, sunColor: new THREE.Color(look.sunCol), ambientColor: new THREE.Color(look.sky) };
  const place = (tgt: THREE.Vector3, dist: number) => {
    const shadowR = Math.min(900, dist * 1.6 + 60);
    sun.position.copy(tgt).addScaledVector(sunDir, 1500);
    sun.target.position.copy(tgt);
    sun.shadow.camera.left = -shadowR;
    sun.shadow.camera.right = shadowR;
    sun.shadow.camera.top = shadowR;
    sun.shadow.camera.bottom = -shadowR;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 3500;
    sun.shadow.camera.updateProjectionMatrix();
  };
  return { renderer, scene, camera, lighting, place, looks: LOOKS };
}

// ── game wiring (basic stage or the real GameRenderer) ──────────────────────
const events = new EventBus<GameEvents>();
world.bus = events;
const REAL_HOURS: Record<string, number> = { golden: 18.4, noon: 12.5, dusk: 20.2, night: 23.2, rain: 13, snow: 11.5, autumn: 15.5 };
world.time.hour = REAL_HOURS[TIME] ?? 17;
const focus = { x: 48, y: 48 };
const real = REAL ? createRealStage(world, events) : null;
const basic = REAL ? null : basicStage();
const renderer = real ? real.gr.renderer : basic!.renderer;
const scene = real ? real.gr.scene : basic!.scene;
const camera = real ? real.gr.camera : basic!.camera;
const fakeRenderer = real
  ? real.gr
  : {
      scene, camera, canvas: renderer.domElement, lighting: basic!.lighting, renderer,
      getViewInfo: () => ({ focusX: focus.x, focusY: focus.y, radiusCells: 220, cameraPos: camera.position, altitude: camera.position.y, frustum: new THREE.Frustum() }),
    };
const game = { events, world, roadSurface: new RoadSurface(world), renderer: fakeRenderer, simDt: 0, dt: 0, time: 0, settings: { value: {} } } as unknown as Game;
const roads = new RoadRenderer(game);
(game as unknown as { roads: RoadRenderer }).roads = roads;
const zones = new ZoneRenderer(game);
roads.onWorldLoaded(world);
zones.onWorldLoaded(world);
if (params.get('grid') === '1') zones.setGridVisible(true);
if (params.get('districts') === '1') zones.setDistrictsVisible(true);
world.flushChanges();

// ── camera presets ──────────────────────────────────────────────────────────
const C = (x: number, y: number) => new THREE.Vector3(x * CELL, world.cellHeight(Math.floor(x), Math.floor(y)), y * CELL);
const views: Record<string, [THREE.Vector3, number, number, number]> = {
  // target, distance, azimuth (deg, 0 = from +Z/south), elevation deg
  overview: [C(48, 50), 1500, 20, 42],
  junction: [C(30.5, 58.5), 95, 35, 40],
  signals: [C(30.5, 38.5), 70, 150, 30],
  bridge: [C(48, 40), 230, 70, 22],
  bridge2: [C(47, 70.5), 120, 200, 18],
  rail: [C(70, 88), 170, 30, 38],
  ped: [C(16.5, 48.5), 75, 20, 45],
  east: [C(72, 60), 320, 15, 45],
  highway: [C(30, 6.5), 150, 150, 32],
  street: [C(12.5, 22), 60, 60, 30],
  cul: [C(74, 50.5), 70, 210, 45],
  dirt: [C(91, 55), 160, 250, 40],
  top: [C(30.5, 58.5), 140, 0, 89],
  tram: [C(22, 38.5), 60, 30, 25],
  curve: [C(64, 80), 90, 330, 40],
  zones: [C(16, 30), 260, 25, 52],
  zones2: [C(70, 52), 230, 340, 50],
  districts: [C(33, 42), 420, 15, 55],
  tramclose: [C(37, 38.5), 38, 60, 32],
  railclose: [C(60, 90.5), 30, 30, 30],
  dirtclose: [C(88.5, 44), 34, 250, 32],
  dirtj: [C(91.5, 60.5), 75, 200, 55],
  dirtend: [C(89.5, 60.5), 32, 10, 70],
  city: [C(26, 46), 520, 35, 38],
};
const [tgt, dist, azd, eld] = views[CAM] ?? views.overview;
focus.x = tgt.x / CELL;
focus.y = tgt.z / CELL;
if (real) real.setView(focus.x, focus.y, dist, azd, eld);
else {
  const azr = THREE.MathUtils.degToRad(azd), elr = THREE.MathUtils.degToRad(eld);
  camera.position.set(tgt.x + dist * Math.sin(azr) * Math.cos(elr), tgt.y + dist * Math.sin(elr), tgt.z + dist * Math.cos(azr) * Math.cos(elr));
  camera.lookAt(tgt);
  basic!.place(tgt, dist);
}

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
for (const t of Object.keys(REAL_HOURS)) link(t, { t });
for (const v of Object.keys(views)) link(v, { cam: v });
link('grid', { grid: params.get('grid') === '1' ? '0' : '1' });
link('districts', { districts: params.get('districts') === '1' ? '0' : '1' });
link(REAL ? 'basic stage' : 'real renderer', { real: REAL ? '0' : '1' });
const stats = document.getElementById('stats')!;

// ── loop ───────────────────────────────────────────────────────────────────
let last = performance.now();
let frames = 0;
const W = window as unknown as { __ready: boolean; __sb: unknown };
W.__ready = false;
let settle = 0;
const renderOnce = () => {
  if (real) real.render();
  else renderer.render(scene, camera);
};
function frame() {
  // SwiftShader is slow: once everything is built, render a couple of frames and stop
  if (W.__ready && ++settle > 3 && !params.get('live')) return;
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  (game as unknown as { simDt: number; dt: number }).simDt = dt;
  roads.budgetMs = 60;
  zones.budgetMs = 60;
  world.flushChanges();
  // the real renderer updates its camera / view info first (as in Game.step the order is roads → renderer,
  // but the sandbox has no input so the first frame must already know the view)
  if (real) real.step(frames < 3 ? 1 : dt);
  roads.update(dt);
  zones.update(dt);
  renderOnce();
  frames++;
  if (frames % 10 === 0 || roads.stats.pending === 0) {
    stats.textContent = `zones: chunks ${zones.stats.chunks} cells ${zones.stats.cells} pending ${zones.stats.pending}  roads: chunks ${roads.stats.chunks} tris ${roads.stats.triangles} pending ${roads.stats.pending} build ${roads.stats.lastBuildMs.toFixed(1)}ms  draws ${renderer.info.render.calls}`;
  }
  if (roads.stats.pending === 0 && zones.stats.pending === 0 && frames > (real ? 8 : 3)) W.__ready = true;
}
frame();
W.__sb = { world, roads, zones, scene, camera, renderer, render: renderOnce };
