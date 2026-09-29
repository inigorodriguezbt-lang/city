// Sandbox gallery for the zoned building generators + material library.
// URL params:
//   zones=res_low,res_med|all  styles=european,nordic|all  levels=1,3,5  lot=2x3
//   hour=15  detail=high|medium|low  state=normal|abandoned|burned|fire|flooded|construction:0.4|collapsed
//   lod=1 (show far-LOD boxes)  cam=overview|close|street|x,y,z,tx,ty,tz  seed=7  layout=grid|street
import * as THREE from 'three';
import { RNG, hash2 } from '../../src/core/rng';
import { ZoneType, type StyleId } from '../../src/core/types';
import { STYLES, styleDef } from '../../src/data/styles';
import { ZONES, zoneById } from '../../src/data/zones';
import { themeDef } from '../../src/data/themes';
import { getChunkMaterial, getAnimDepthMaterials, setMaterialWeather, updateMaterials } from '../../src/render/buildings/materials';
import { buildZoned, schedFor } from '../../src/render/buildings/zoned';
import { mergeDetail, mergeLod, type MergeItem, type LodItem } from '../../src/render/buildings/zoned/merge';
import { buildGlowMesh, updateGlow, type WorldLight } from '../../src/render/buildings/zoned/glow';
import { Cond, STYLE_INDEX, packInfo } from '../../src/render/buildings/zoned/constants';
import { constructionModel, rubbleModel, weatherModel } from '../../src/render/buildings/zoned/states';

const q = new URLSearchParams(location.search);
const zoneIds = (q.get('zones') ?? 'res_low') === 'all' ? ZONES.map((z) => z.id) : (q.get('zones') ?? 'res_low').split(',');
const styleIds = (q.get('styles') ?? 'all') === 'all' ? STYLES.map((s) => s.id) : (q.get('styles') ?? '').split(',');
const levels = (q.get('levels') ?? '1,2,3,4,5').split(',').map(Number);
const hour = Number(q.get('hour') ?? 15);
const detail = (q.get('detail') ?? 'high') as 'high' | 'medium' | 'low';
const stateArg = q.get('state') ?? 'normal';
const useLod = q.get('lod') === '1';
const seed0 = Number(q.get('seed') ?? 7);
const theme = themeDef((q.get('theme') ?? 'temperate') as never);
const lotArg = q.get('lot');

// ?test=1 → generate every zone × style × level × lot, report errors and budgets (no rendering)
if (q.get('test') === '1') {
  const rows: string[] = [];
  const errs: string[] = [];
  let n = 0, total = 0;
  const heavy: [number, string, string][] = [];
  for (const zd of ZONES) {
    let zmax = 0, zsum = 0, zc = 0, zms = 0, hmax = 0;
    for (const sd of STYLES) for (let lv = 1; lv <= 5; lv++) for (const lot of zd.lots) for (const det of ['high', 'low'] as const) {
      const seed = hash2(n * 7 + 1, lv * 31 + lot[0] * 5 + lot[1]);
      n++;
      try {
        const t0 = performance.now();
        const m = buildZoned({ b: null, width: lot[0] * 16, depth: lot[1] * 16, level: lv, zone: zd.type, style: sd, theme, rng: new RNG(seed), detail: det });
        zms += performance.now() - t0;
        let t = 0;
        for (const p of m.parts) {
          const g = p.geometry;
          const pc = g.getAttribute('position').count;
          t += pc / 3;
          for (const a of ['normal', 'uv', 'color', 'aFac']) if (!g.getAttribute(a) || g.getAttribute(a).count !== pc) errs.push(`${zd.id}/${sd.id}/L${lv}/${lot}: bad attr ${a} on ${p.mat}`);
          const arr = g.getAttribute('position').array as Float32Array;
          for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { errs.push(`${zd.id}/${sd.id}/L${lv}/${lot}: NaN in ${p.mat}`); break; }
        }
        if (det === 'high') { zmax = Math.max(zmax, t); zsum += t; zc++; heavy.push([t, `${zd.id}/${sd.id}/L${lv}/${lot}`, m.parts.map((p) => `${p.mat}:${p.geometry.getAttribute('position').count / 3}`).join(' ')]); }
        hmax = Math.max(hmax, m.height);
        total += t;
        if (!m.masses.length) errs.push(`${zd.id}/${sd.id}/L${lv}/${lot}: no LOD masses`);
      } catch (e) {
        errs.push(`${zd.id}/${sd.id}/L${lv}/${lot}: ${(e as Error).message}`);
      }
    }
    rows.push(`${zd.id}: avg ${Math.round(zsum / Math.max(1, zc))} tris, max ${Math.round(zmax)}, max h ${hmax.toFixed(0)} m, ${(zms / (zc * 2)).toFixed(1)} ms/model`);
  }
  heavy.sort((a, b) => b[0] - a[0]);
  (window as unknown as { __report: unknown }).__report = { n, rows, errs: errs.slice(0, 40), nErr: errs.length, heavy: heavy.slice(0, 6) };
  throw new Error('test done');
}

// ?test=2 → time full / construction / rubble / weathered variants per zone (warm runs)
if (q.get('test') === '2') {
  const rows: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    rows.length = 0;
    for (const zd of ZONES) {
      const acc = { full: 0, cons: 0, rubble: 0, weather: 0, n: 0 };
      let worst = 0, worstKey = '';
      for (const sd of STYLES) for (const lv of [2, 5]) {
        const lot = zd.lots[zd.lots.length - 1];
        const seed = hash2(lv * 31 + lot[0], STYLE_INDEX[sd.id] ?? 0);
        const ctx = { b: null, width: lot[0] * 16, depth: lot[1] * 16, level: lv, zone: zd.type, style: sd, theme, rng: new RNG(seed), detail: 'high' as const };
        let t = performance.now();
        const full = buildZoned(ctx);
        const tf = performance.now() - t;
        acc.full += tf;
        if (tf > worst) { worst = tf; worstKey = `${sd.id}/L${lv}`; }
        t = performance.now();
        constructionModel(full, { ...ctx, rng: new RNG(seed + 1) }, 0.55);
        acc.cons += performance.now() - t;
        t = performance.now();
        rubbleModel(full, { ...ctx, rng: new RNG(seed + 2) });
        acc.rubble += performance.now() - t;
        t = performance.now();
        weatherModel(full, 'abandoned');
        acc.weather += performance.now() - t;
        acc.n++;
      }
      rows.push(`${zd.id}: full ${(acc.full / acc.n).toFixed(2)} (worst ${worst.toFixed(1)} ${worstKey}) cons ${(acc.cons / acc.n).toFixed(2)} rubble ${(acc.rubble / acc.n).toFixed(2)} weather ${(acc.weather / acc.n).toFixed(2)} ms`);
    }
  }
  (window as unknown as { __report: unknown }).__report = rows;
  throw new Error('test done');
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 6000);

// ── lighting by hour ───────────────────────────────────────────────────────
const sunAng = ((hour - 6) / 12) * Math.PI;
const sunDir = new THREE.Vector3(Math.cos(sunAng) * 0.8, Math.sin(sunAng), 0.45).normalize();
const day = THREE.MathUtils.clamp(Math.sin(sunAng) * 1.6 + 0.15, 0, 1);
const night = 1 - THREE.MathUtils.smoothstep(Math.sin(sunAng), -0.12, 0.18);
const dusk = Math.max(0, 1 - Math.abs(Math.sin(sunAng) - 0.1) * 4) * (1 - night * 0.6);
const skyTop = new THREE.Color().setRGB(0.02 + 0.3 * day, 0.03 + 0.45 * day, 0.07 + 0.75 * day);
const skyHor = new THREE.Color().setRGB(0.04 + 0.7 * day + 0.5 * dusk, 0.05 + 0.72 * day + 0.2 * dusk, 0.1 + 0.78 * day);
scene.background = skyHor.clone().lerp(skyTop, 0.35);
scene.fog = new THREE.Fog(skyHor.getHex(), 900, 4200);
// environment map (the game's SkySystem provides one; emulate with a gradient sky + sun disc)
{
  const envScene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: skyTop }, hor: { value: skyHor }, gnd: { value: new THREE.Color(0.18, 0.17, 0.15).multiplyScalar(0.3 + day * 0.7) }, sunDir: { value: sunDir }, sunI: { value: day * 30 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunDir; uniform float sunI; varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y > 0.0 ? mix(hor, top, pow(d.y, 0.5)) : mix(hor * 0.6, gnd, min(1.0, -d.y * 5.0)); c += vec3(1.0, 0.9, 0.75) * sunI * pow(max(dot(d, sunDir), 0.0), 600.0); gl_FragColor = vec4(c, 1.0); }',
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.85;
}
const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.93 - dusk * 0.25, 0.84 - dusk * 0.4), 3.2 * day + 0.05);
sun.position.copy(sunDir).multiplyScalar(800);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color(0.6, 0.7, 0.9), 0.5), new THREE.Color(0.25, 0.23, 0.2), 0.55 + 0.9 * day);
scene.add(hemi);
if (night > 0.5) {
  const moon = new THREE.DirectionalLight(0x8fa6d8, 0.25);
  moon.position.set(-300, 500, 200);
  scene.add(moon);
}

// ── lots ───────────────────────────────────────────────────────────────────
// state=mix cycles the lots through every building state
const MIX = ['normal', 'abandoned', 'burned', 'collapsed', 'fire', 'flooded', 'construction:0.6', 'normal'];
let lotIndex = 0;
function lotState(): string {
  return stateArg === 'mix' ? MIX[lotIndex % MIX.length] : stateArg;
}
function stateCond(arg = stateArg): { cond: number; flags: string } {
  switch (arg.split(':')[0]) {
    case 'abandoned': return { cond: Cond.Abandoned, flags: 'abandoned' };
    case 'burned': return { cond: Cond.Burned, flags: 'burned' };
    case 'fire': return { cond: Cond.OnFire, flags: 'fire' };
    case 'flooded': return { cond: Cond.Flooded, flags: 'flooded' };
    case 'construction': case 'stages': return { cond: Cond.Construction, flags: 'construction' };
    case 'collapsed': return { cond: 0, flags: 'collapsed' };
    default: return { cond: 0, flags: 'normal' };
  }
}
const st = stateCond();
const items: MergeItem[] = [];
const lodItems: LodItem[] = [];
const lights: WorldLight[] = [];
const roads: [number, number, number, number][] = [];
let tris = 0, maxTris = 0, maxH = 0, genMs = 0;
const ROAD = 16;
let zRow = 0;
let totalW = 0;
const rowsInfo: string[] = [];
// rows of lots along a street: layout=bystyle → one row per (zone, style) with
// levels as columns; layout=bylevel (default) → one row per (zone, level) with styles as columns
const layout = q.get('layout') ?? 'bylevel';
const rowDefs: { zid: string; cells: { sid: string; level: number; i: number }[] }[] = [];
for (const zid of zoneIds) {
  if (layout === 'bystyle') for (const sid of styleIds) rowDefs.push({ zid, cells: levels.map((level, i) => ({ sid, level, i })) });
  else levels.forEach((level, i) => rowDefs.push({ zid, cells: styleIds.map((sid) => ({ sid, level, i })) }));
}
for (const row of rowDefs) {
  const zd = zoneById(row.zid)!;
  {
    let x = 0;
    let rowDepth = 0;
    const lots: { lw: number; ld: number; level: number; sid: string }[] = [];
    for (const c of row.cells) {
      const lv = c.level;
      const lot = lotArg ? lotArg.split('x').map(Number) : zd.lots[Math.min(zd.lots.length - 1, Math.floor(((lv - 1) / 4) * zd.lots.length + (c.i % 2) * 0.5))];
      lots.push({ lw: lot[0] * 16, ld: lot[1] * 16, level: lv, sid: c.sid });
      rowDepth = Math.max(rowDepth, lot[1] * 16);
    }
    for (const l of lots) {
      const sid = l.sid;
      const seed = hash2(seed0 * 7919 + l.level * 131, hash2(STYLE_INDEX[sid] ?? 0, zd.type));
      const ctx = {
        b: null, width: l.lw, depth: l.ld, level: l.level, zone: zd.type as ZoneType, style: styleDef(sid as StyleId), theme,
        rng: new RNG(seed), detail,
      };
      const t0 = performance.now();
      let model = buildZoned(ctx);
      const lotSt = lotState();
      lotIndex++;
      const sk = lotSt.split(':');
      if (sk[0] === 'construction') model = constructionModel(model, { ...ctx, rng: new RNG(seed + 1) }, Number(sk[1] ?? 0.5));
      else if (sk[0] === 'stages') model = constructionModel(model, { ...ctx, rng: new RNG(seed + 1) }, Math.min(0.97, (l.level - 0.5) / 5 + (STYLE_INDEX[sid] ?? 0) * 0.02));
      else if (sk[0] === 'collapsed') model = rubbleModel(model, { ...ctx, rng: new RNG(seed + 2) });
      else if (sk[0] === 'abandoned') model = weatherModel(model, 'abandoned');
      else if (sk[0] === 'burned') model = weatherModel(model, 'burned');
      genMs += performance.now() - t0;
      const cx = x + l.lw / 2, cz = zRow + rowDepth - l.ld / 2;
      const m = new THREE.Matrix4().makeTranslation(cx, 0, cz);
      const info = packInfo(seed, schedFor(zd.type), STYLE_INDEX[sid] ?? 0, sk[0] === 'normal' || sk[0] === 'flooded' || sk[0] === 'fire' ? 2 : 0, stateCond(lotSt).cond);
      items.push({ src: model, matrix: m, info });
      lodItems.push({ masses: model.masses, matrix: m, info });
      let t = 0;
      for (const p of model.parts) t += p.geometry.getAttribute('position').count / 3;
      tris += t;
      maxTris = Math.max(maxTris, t);
      maxH = Math.max(maxH, model.height);
      for (const L of model.lights) lights.push({ ...L, x: L.x + cx, y: L.y, z: L.z + cz });
      x += l.lw + 4;
    }
    roads.push([-8, x + 4, zRow + rowDepth, zRow + rowDepth + ROAD]);
    totalW = Math.max(totalW, x);
    rowsInfo.push(`${row.zid}`);
    zRow += rowDepth + ROAD + 6;
  }
}

const mat = getChunkMaterial();
if (useLod) {
  const g = mergeLod(lodItems);
  if (g) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
} else {
  const merged = mergeDetail(items);
  if (merged.geometry) {
    const mesh = new THREE.Mesh(merged.geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (merged.anim) {
    const am = new THREE.Mesh(merged.anim, getChunkMaterial(true));
    const dm = getAnimDepthMaterials();
    am.customDepthMaterial = dm.depth;
    am.customDistanceMaterial = dm.distance;
    am.castShadow = am.receiveShadow = true;
    scene.add(am);
  }
  const glow = buildGlowMesh(lights);
  if (glow) scene.add(glow);
}

// ground + roads
const groundMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.grass).multiplyScalar(0.9), roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9 });
const walkMat = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 });
for (const [x0, x1, z0, z1] of roads) {
  const r = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0 - 5), roadMat);
  r.rotation.x = -Math.PI / 2;
  r.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  r.receiveShadow = true;
  scene.add(r);
  for (const zz of [z0 + 1.25, z1 - 1.25]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.25, 2.5), walkMat);
    w.position.set((x0 + x1) / 2, 0.12, zz);
    w.receiveShadow = true;
    scene.add(w);
  }
}

// camera
const cx = totalW / 2, cz = zRow / 2;
const span = Math.max(totalW, zRow);
const camArg = q.get('cam') ?? 'overview';
if (camArg === 'overview') {
  camera.position.set(cx + totalW * 0.08, span * 0.42 + maxH * 0.55, zRow + span * 0.42);
  camera.lookAt(cx, maxH * 0.12, cz + zRow * 0.08);
} else if (camArg === 'close') {
  camera.position.set(cx + 20, 35 + maxH * 0.5, zRow + 40);
  camera.lookAt(cx, maxH * 0.25, zRow - 40);
} else if (camArg === 'street') {
  camera.position.set(cx - span * 0.25, 7 + maxH * 0.1, zRow - ROAD / 2 - 6 + 4);
  camera.lookAt(cx + span * 0.1, 6 + maxH * 0.2, zRow - ROAD - 30);
} else {
  const v = camArg.split(',').map(Number);
  camera.position.set(v[0], v[1], v[2]);
  camera.lookAt(v[3], v[4], v[5]);
}
const sc = sun.shadow.camera;
const ext = span * 0.7 + maxH;
sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 3000;
sun.target.position.set(cx, 0, cz);
sun.position.copy(sunDir).multiplyScalar(1400).add(sun.target.position);
sc.updateProjectionMatrix();

const hud = document.getElementById('hud')!;
hud.textContent = `zones ${zoneIds.join(',')} · ${items.length} lots · ${Math.round(tris / 1000)}k tris (max ${Math.round(maxTris)}) · max h ${maxH.toFixed(0)} m · gen ${genMs.toFixed(0)} ms · hour ${hour} · ${st.flags}${useLod ? ' · LOD' : ''}`;

// SwiftShader is slow: render a couple of frames then stop unless ?loop=1
let t = 0;
let frames = 0;
const loop = q.get('loop') === '1';
const t0 = performance.now();
function frame() {
  t = (performance.now() - t0) / 1000 + Number(q.get('t') ?? 0);
  updateMaterials(night, t, hour, t);
  setMaterialWeather(Number(q.get('wet') ?? 0), Number(q.get('snow') ?? 0));
  updateGlow(night, t, innerHeight);
  renderer.render(scene, camera);
  frames++;
  if (loop || frames < 2) requestAnimationFrame(frame);
  else (window as unknown as { __done: boolean }).__done = true;
}
frame();
(window as unknown as { __sb: unknown }).__sb = { scene, camera, renderer, items };
