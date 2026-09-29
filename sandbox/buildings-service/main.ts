// Service / landmark model gallery (buildings-service sandbox, port 5210).
// URL params:
//   cat=power,water       filter by category      ids=a,b,c   explicit ids
//   style=european        theme=temperate          detail=high|medium|low
//   hour=13 (0..24)        night=1 (= hour 22)      focus=<id>  frame one model
//   row=420 (m row width)  labels=0                 lots=1 footprint outlines
//   yaw=35 pitch=38 dist=1 (camera tweaks)         seed=7
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BUILDINGS } from '../../src/data/buildings';
import { STYLES } from '../../src/data/styles';
import { THEMES } from '../../src/data/themes';
import { RNG, hashString } from '../../src/core/rng';
import { CELL } from '../../src/core/constants';
import { ZoneType, type BuildingDef, type StyleId, type ThemeId } from '../../src/core/types';
import { registerServiceModels } from '../../src/render/buildings/service';
import { getModel } from '../../src/render/buildings/registry';
import { getAnimMaterial, getMaterial, updateMaterials } from '../../src/render/buildings/materials';
import type { ModelContext, ModelResult } from '../../src/render/buildings/types';

const Q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (Q.has(k) ? Number(Q.get(k)) : d);

registerServiceModels();

const style = STYLES.find((s) => s.id === (Q.get('style') as StyleId)) ?? STYLES[1];
const theme = THEMES.find((t) => t.id === (Q.get('theme') as ThemeId)) ?? THEMES[0];
const detail = (Q.get('detail') as ModelContext['detail']) ?? 'high';
let hour = Q.has('hour') ? num('hour', 13) : Q.get('night') === '1' ? 22 : 14.5;

let defs: BuildingDef[] = BUILDINGS.slice();
if (Q.get('cat')) {
  const cats = Q.get('cat')!.split(',');
  defs = defs.filter((d) => cats.includes(d.category));
}
if (Q.get('ids')) {
  const ids = Q.get('ids')!.split(',');
  defs = ids.map((id) => BUILDINGS.find((b) => b.id === id)).filter((d): d is BuildingDef => !!d);
}
if (Q.get('focus')) defs = defs.filter((d) => d.id === Q.get('focus'));

// ── renderer / scene ─────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// sky-gradient environment map (the game renderer provides a real sky env)
function skyEnv(night: boolean): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const top = new THREE.Color(night ? 0x0a1224 : 0x5f94d8), hor = new THREE.Color(night ? 0x1a2238 : 0xdce8f2), gnd = new THREE.Color(night ? 0x08080a : 0x6a6558);
  const cols: number[] = [];
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(gnd, Math.min(1, -y * 4));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const t = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return t;
}
const envDay = skyEnv(false), envNight = skyEnv(true);
scene.environment = envDay;
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(num('sm', 2048));
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// ── layout ───────────────────────────────────────────────────────────────
interface Item {
  def: BuildingDef;
  x: number;
  z: number;
  res: ModelResult | null;
  tris: number;
  group: THREE.Group;
  ms: number;
}
const items: Item[] = [];
const ROAD = 12;
const GAP = 10;
const totalArea = defs.reduce((a, d) => a + (d.w * CELL + GAP) * (d.h * CELL + ROAD + GAP), 0);
const rowW = num('row', Math.max(120, Math.sqrt(totalArea) * 1.25));
{
  let x = 0, z = 0, rowD = 0;
  for (const def of defs) {
    const w = def.w * CELL, d = def.h * CELL;
    if (x > 0 && x + w > rowW) {
      x = 0;
      z += rowD + ROAD + GAP * 2;
      rowD = 0;
    }
    items.push({ def, x: x + w / 2, z: z + d / 2, res: null, tris: 0, group: new THREE.Group(), ms: 0 });
    x += w + GAP;
    rowD = Math.max(rowD, d);
  }
}
const bbox = new THREE.Box3();
for (const it of items) {
  bbox.expandByPoint(new THREE.Vector3(it.x - (it.def.w * CELL) / 2, 0, it.z - (it.def.h * CELL) / 2));
  bbox.expandByPoint(new THREE.Vector3(it.x + (it.def.w * CELL) / 2, 0, it.z + (it.def.h * CELL) / 2 + ROAD));
}
const center = bbox.getCenter(new THREE.Vector3());
const size = bbox.getSize(new THREE.Vector3());

// ground, roads, water hints
const ground = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 4000, size.z + 4000), new THREE.MeshStandardMaterial({ color: theme.grass, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(center.x, -0.02, center.z);
ground.receiveShadow = true;
scene.add(ground);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 });
const waterMat = new THREE.MeshStandardMaterial({ color: theme.waterShallow, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.92 });
const lotLine = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeGlowTexture();
interface Glow {
  sprite: THREE.Sprite;
  blink: boolean;
  phase: number;
  kind: string;
}
const glows: Glow[] = [];
interface Emit {
  kind: string;
  pos: THREE.Vector3;
  rate: number;
  acc: number;
}
const emits: Emit[] = [];

function toMesh(res: ModelResult, g: THREE.Group): number {
  let tris = 0;
  for (const p of res.parts) {
    const m = new THREE.Mesh(p.geometry, getMaterial(p.mat));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    tris += p.geometry.getAttribute('position').count / 3;
  }
  for (const a of res.anims ?? []) {
    const geo = a.part.geometry;
    const n = geo.getAttribute('position').count;
    const piv = new Float32Array(n * 3), ax = new Float32Array(n * 3), an = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      piv.set(a.pivot, i * 3);
      ax.set(a.axis, i * 3);
      an.set([a.speed, 0, 0], i * 3);
    }
    geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(ax, 3));
    geo.setAttribute('aAnim', new THREE.BufferAttribute(an, 3));
    const m = new THREE.Mesh(geo, getAnimMaterial(a.part.mat));
    m.castShadow = true;
    m.frustumCulled = false;
    g.add(m);
    tris += n / 3;
  }
  for (const l of res.lights ?? []) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: l.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(l.x, l.y, l.z);
    s.scale.setScalar(l.size);
    g.add(s);
    glows.push({ sprite: s, blink: !!l.blink, phase: Math.random() * 6, kind: l.kind });
  }
  for (const e of res.emitters ?? []) emits.push({ kind: e.kind, pos: new THREE.Vector3(e.x, e.y, e.z).add(g.position), rate: e.rate, acc: 0 });
  return tris;
}

const missing: string[] = [];
const errors: string[] = [];
const seed = num('seed', 1);
for (const it of items) {
  const { def } = it;
  const w = def.w * CELL, d = def.h * CELL;
  it.group.position.set(it.x, 0, it.z);
  scene.add(it.group);
  // context: road in front, water behind/under where relevant
  const onWater = !!def.placement?.onWater;
  const shore = !!def.placement?.shore;
  if (def.placement?.road !== false) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w + GAP, ROAD - 2), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(it.x, 0.01, it.z + d / 2 + ROAD / 2);
    road.receiveShadow = true;
    scene.add(road);
  }
  if (onWater || shore) {
    const wd = onWater ? d + 40 : 60;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w + 30, wd), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(it.x, onWater ? 0.02 : -0.6, onWater ? it.z : it.z - d / 2 - wd / 2 + 2);
    scene.add(water);
  }
  if (Q.get('lots') === '1') {
    const pts = [new THREE.Vector3(-w / 2, 0.3, -d / 2), new THREE.Vector3(w / 2, 0.3, -d / 2), new THREE.Vector3(w / 2, 0.3, d / 2), new THREE.Vector3(-w / 2, 0.3, d / 2), new THREE.Vector3(-w / 2, 0.3, -d / 2)];
    it.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lotLine));
  }
  const fn = getModel(def.model);
  if (!fn) {
    missing.push(def.model);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, def.height, d * 0.8), new THREE.MeshStandardMaterial({ color: 0xff2266 }));
    box.position.y = def.height / 2;
    it.group.add(box);
  } else {
    const ctx: ModelContext = {
      b: null,
      def,
      width: w,
      depth: d,
      level: 1,
      zone: ZoneType.None,
      style,
      theme,
      rng: new RNG(hashString(def.id) ^ seed),
      detail,
    };
    const t0 = performance.now();
    try {
      it.res = fn(ctx);
      it.ms = performance.now() - t0;
      it.tris = toMesh(it.res, it.group);
    } catch (e) {
      errors.push(`${def.id}: ${(e as Error).message}`);
      console.error(def.id, e);
    }
  }
  if (Q.get('labels') !== '0') {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.innerHTML = `${def.icon} ${def.name} <small>${def.w}×${def.h} · ${(it.tris / 1000).toFixed(1)}k</small>`;
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, 0, d / 2 + ROAD * 0.6);
    it.group.add(lbl);
  }
}

// ── camera framing ───────────────────────────────────────────────────────
const yaw = THREE.MathUtils.degToRad(num('yaw', 35));
const pitch = THREE.MathUtils.degToRad(num('pitch', 38));
function frame(target: THREE.Vector3, radius: number): void {
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * num('dist', 0.9);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  controls.target.copy(target);
  camera.far = dist * 6 + 4000;
  camera.updateProjectionMatrix();
  controls.update();
}
if (items.length === 1) {
  const it = items[0];
  const h = it.res?.height ?? it.def.height;
  const r = Math.max(it.def.w, it.def.h) * CELL * 0.62;
  const R = Math.max(r, h * 0.55);
  frame(new THREE.Vector3(it.x, Math.min(h * 0.4, R * 0.6), it.z), R);
} else {
  frame(new THREE.Vector3(center.x, 0, center.z), Math.max(size.x, size.z) * 0.55);
}

// shadow frustum over the layout
function placeSun(): void {
  const t = ((hour - 6) / 12) * Math.PI;
  const el = Math.max(0.12, Math.sin(t)) * 1.05;
  const az = Math.cos(t);
  const R = Math.max(size.x, size.z) * 0.8 + 300;
  sun.position.set(center.x + az * R * 0.8, Math.max(40, el * R), center.z + R * 0.55);
  sun.target.position.copy(center);
  const cam = sun.shadow.camera;
  const half = Math.max(size.x, size.z) * 0.62 + 120;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = R * 3;
  cam.updateProjectionMatrix();
}
placeSun();

function nightAmount(): number {
  const h = hour;
  if (h >= 7.5 && h <= 17.5) return 0;
  if (h <= 5.5 || h >= 19.5) return 1;
  return h < 12 ? (7.5 - h) / 2 : (h - 17.5) / 2;
}
function applyTime(): void {
  const n = nightAmount();
  sun.intensity = 2.8 * (1 - n) + 0.05;
  sun.color.set(n > 0.2 ? 0xffb07a : 0xfff1dc);
  hemi.intensity = 1.15 * (1 - n) + 0.12;
  hemi.color.set(n > 0.5 ? 0x33466e : 0xcfe3ff);
  const sky = new THREE.Color(0x9cc3e8).lerp(new THREE.Color(0x0b1224), n);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 1500 + size.x, 6000 + size.x * 2);
  renderer.toneMappingExposure = n > 0.5 ? 1.25 : 1.0;
  scene.environment = n > 0.5 ? envNight : envDay;
  scene.environmentIntensity = Q.get('env') === '0' ? 0 : n > 0.5 ? 0.35 : 0.8;
  placeSun();
}
applyTime();

// ── particles for emitters ───────────────────────────────────────────────
interface Puff {
  s: THREE.Sprite;
  v: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
}
const puffs: Puff[] = [];
const puffMats: Record<string, THREE.SpriteMaterial> = {
  smoke: new THREE.SpriteMaterial({ map: glowTex, color: 0x6a6a6a, transparent: true, opacity: 0.5, depthWrite: false }),
  steam: new THREE.SpriteMaterial({ map: glowTex, color: 0xf4f6f8, transparent: true, opacity: 0.55, depthWrite: false }),
  fountain: new THREE.SpriteMaterial({ map: glowTex, color: 0xcfe9ff, transparent: true, opacity: 0.7, depthWrite: false }),
  dust: new THREE.SpriteMaterial({ map: glowTex, color: 0xb8a07a, transparent: true, opacity: 0.4, depthWrite: false }),
};
function spawn(e: Emit): void {
  const m = puffMats[e.kind] ?? puffMats.smoke;
  const s = new THREE.Sprite(m);
  s.position.copy(e.pos);
  const fountain = e.kind === 'fountain';
  const v = fountain ? new THREE.Vector3((Math.random() - 0.5) * 1.5, 6 + Math.random() * 2, (Math.random() - 0.5) * 1.5) : new THREE.Vector3(1.5 + Math.random(), 3 + Math.random() * 2, (Math.random() - 0.5) * 1.2);
  const max = fountain ? 1.6 : 9;
  s.scale.setScalar(fountain ? 0.8 : e.kind === 'steam' ? 6 : 4);
  scene.add(s);
  puffs.push({ s, v, life: 0, max, grow: fountain ? 0.2 : e.kind === 'steam' ? 3.2 : 2.2 });
}

// ── UI ───────────────────────────────────────────────────────────────────
const ui = document.getElementById('ui')!;
function btn(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  ui.appendChild(b);
}
btn('☀ Day', () => { hour = 14.5; applyTime(); });
btn('🌇 Dusk', () => { hour = 18.6; applyTime(); });
btn('🌙 Night', () => { hour = 22; applyTime(); });
const stats = document.getElementById('stats')!;
const totalTris = items.reduce((a, i) => a + i.tris, 0);
stats.textContent = `${items.length} models · ${(totalTris / 1000).toFixed(0)}k tris · missing ${missing.length}${missing.length ? ': ' + missing.slice(0, 12).join(', ') : ''}${errors.length ? ' · ERRORS: ' + errors.join(' | ') : ''}`;
(window as unknown as { __report: () => unknown }).__report = () =>
  items.map((i) => ({ id: i.def.id, tris: Math.round(i.tris), ms: Math.round(i.ms), h: i.res?.height ?? 0, lights: i.res?.lights?.length ?? 0, anims: i.res?.anims?.length ?? 0, emit: i.res?.emitters?.length ?? 0 }));
if (errors.length) console.error('MODEL ERRORS', errors.join('\n'));
if (missing.length) console.warn('missing models', missing.join(','));

// ── loop ─────────────────────────────────────────────────────────────────
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Timer();
let t = 0;
function loop(): void {
  clock.update();
  const dt = ONCE ? 0.4 : Math.min(0.05, clock.getDelta());
  t += dt;
  const n = nightAmount();
  updateMaterials(n, t, hour, t);
  for (const g of glows) {
    const base = g.kind === 'flood' ? 0.9 : g.kind === 'beacon' ? 1 : 0.85;
    const on = g.blink ? (Math.sin(t * 3 + g.phase) > 0.2 ? 1 : 0.05) : 1;
    g.sprite.material.opacity = base * on * Math.max(g.kind === 'beacon' ? 0.35 : 0, n);
    g.sprite.visible = g.sprite.material.opacity > 0.01;
  }
  for (const e of emits) {
    e.acc += dt * e.rate * (e.kind === 'fountain' ? 20 : 2.5);
    while (e.acc > 1 && puffs.length < 1500) {
      e.acc -= 1;
      spawn(e);
    }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt;
    if (p.v.y !== 0 && p.max < 3) p.v.y -= 9.8 * dt;
    p.s.position.addScaledVector(p.v, dt);
    p.s.scale.addScalar(p.grow * dt);
    if (p.life > p.max) {
      scene.remove(p.s);
      puffs.splice(i, 1);
    }
  }
  frames++;
  if (SHEET) renderSheet();
  else {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  // once=1: render a few frames (particles need a moment), then stop and flag completion
  if (ONCE && frames >= num('frames', 3)) {
    (window as unknown as { __done: boolean }).__done = true;
    return;
  }
  requestAnimationFrame(loop);
}
let frames = 0;
const ONCE = Q.get('once') === '1';
(window as unknown as { __summary: string }).__summary = items.map((i) => `${i.def.id}:${(i.tris / 1000).toFixed(1)}k`).join(' ') + (errors.length ? ' ERRORS ' + errors.join(' | ') : '') + (missing.length ? ' MISSING ' + missing.join(',') : '');

// ── contact-sheet mode: every model framed in its own tile ────────────────
const SHEET = Q.get('sheet') === '1';
const cols = num('cols', Math.ceil(Math.sqrt(items.length * 1.3)));
const tileRows = Math.ceil(items.length / cols);
const tiles: HTMLDivElement[] = [];
if (SHEET) {
  labels.domElement.style.display = 'none';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.style.position = 'fixed';
    el.innerHTML = `${it.def.icon} ${it.def.name} <small>${(it.tris / 1000).toFixed(1)}k · h${Math.round(it.res?.height ?? 0)}</small>`;
    document.body.appendChild(el);
    tiles.push(el);
  }
}
const sheetCam = new THREE.PerspectiveCamera(38, 1, 1, 30000);
function renderSheet(): void {
  const tw = Math.floor(innerWidth / cols), th = Math.floor(innerHeight / tileRows);
  renderer.setScissorTest(true);
  sheetCam.aspect = tw / th;
  items.forEach((it, i) => {
    const cx = (i % cols) * tw, cy = Math.floor(i / cols) * th;
    tiles[i].style.left = `${cx + 4}px`;
    tiles[i].style.top = `${cy + 4}px`;
    const h = it.res?.height ?? it.def.height;
    const fr = Math.max(it.def.w, it.def.h) * CELL * 0.6;
    const R = Math.max(fr, h * 0.56);
    const ty = Math.min(h * 0.45, R * 0.8);
    const dist = (R / Math.sin(THREE.MathUtils.degToRad(sheetCam.fov / 2))) * num('dist', 0.95) * Math.max(1, 1 / sheetCam.aspect);
    sheetCam.position.set(it.x + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, it.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    sheetCam.lookAt(it.x, ty, it.z);
    sheetCam.far = dist * 5 + 2000;
    sheetCam.updateProjectionMatrix();
    // per-tile shadow frustum
    const half = Math.max(fr * 1.5, Math.min(h, 200) * 0.9) + 10;
    const tt = ((hour - 6) / 12) * Math.PI;
    const el = Math.max(0.25, Math.sin(tt));
    sun.position.set(it.x + Math.cos(tt) * half * 2, el * half * 3 + 20, it.z + half * 1.4);
    sun.target.position.set(it.x, 0, it.z);
    sun.target.updateMatrixWorld();
    const sc = sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = half * 8 + 400;
    sc.updateProjectionMatrix();
    renderer.setViewport(cx, innerHeight - cy - th, tw, th);
    renderer.setScissor(cx, innerHeight - cy - th, tw, th);
    renderer.render(scene, sheetCam);
  });
  renderer.setScissorTest(false);
}
loop();
