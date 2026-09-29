// End-to-end harness for the real BuildingRenderer (chunks, LOD, glow, icons,
// highlight, previews, states) with a minimal fake Game + a real World.
// URL params: hour=15  n=900 (buildings)  size=128  cam=near|mid|far|street|x,y,z,tx,ty,tz
//   style=mixed|<id>  states=1 (sprinkle construction/abandoned/fire/…)  problems=1
//   hl=<building index>  preview=zoned:res_high|<service def>  detail=high|medium|low  frames=40
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { BFlag, Dir, Problem, ZoneType, type MapSettings, type StyleId } from '../../src/core/types';
import { CELL } from '../../src/core/constants';
import { World } from '../../src/world/World';
import { defaultSettings } from '../../src/settings/types';
import { themeDef } from '../../src/data/themes';
import { BuildingRenderer } from '../../src/render/buildings/BuildingRenderer';
import { makeStage } from './stage';

const q = new URLSearchParams(location.search);
const hour = Number(q.get('hour') ?? 15);
const size = Number(q.get('size') ?? 128);
const nWanted = Number(q.get('n') ?? 900);
const styleArg = q.get('style') ?? 'mixed';
const theme = themeDef((q.get('theme') ?? 'temperate') as never);
const stage = makeStage(document.getElementById('c') as HTMLCanvasElement, hour, new THREE.Color(theme.grass).multiplyScalar(0.8));
const { scene, camera, renderer } = stage;

// ── fake game ───────────────────────────────────────────────────────────────
const events = new EventBus<GameEvents>();
const settings = defaultSettings();
settings.graphics.buildingDetail = (q.get('detail') ?? 'high') as 'high';
const emitters = new Map<number, { kind: string; pos: THREE.Vector3Like }>();
let emitterId = 1;
const emitterGroup = new THREE.Group();
scene.add(emitterGroup);
const game = {
  events,
  settings: { value: settings },
  time: 0,
  renderer: { scene, camera, renderer, lighting: { night: stage.night, daylight: 1 - stage.night, sunDir: new THREE.Vector3(0, 1, 0) } },
  effects: {
    addEmitter(kind: string, pos: THREE.Vector3Like): number {
      const id = emitterId++;
      emitters.set(id, { kind, pos });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 4), new THREE.MeshBasicMaterial({ color: kind === 'smoke' ? 0x777777 : kind === 'dust' ? 0xb09060 : 0xffffff, transparent: true, opacity: 0.6 }));
      m.position.set(pos.x, pos.y + 1.5, pos.z);
      m.name = 'em' + id;
      emitterGroup.add(m);
      return id;
    },
    removeEmitter(id: number): void {
      emitters.delete(id);
      const m = emitterGroup.getObjectByName('em' + id);
      if (m) emitterGroup.remove(m);
    },
  },
};

// ── world ───────────────────────────────────────────────────────────────────
const ms = { cityName: 'Sandbox', mapSize: 'small', theme: q.get('theme') ?? 'temperate', seed: 1, style: 'european', difficulty: 'normal', creative: true, disasters: false, mountains: 0, water: 0, forests: 0 } as unknown as MapSettings;
const world = new World(ms, size);
world.bus = events;
world.time.hour = hour;
// gentle relief so the plinths get exercised
for (let vy = 0; vy <= size; vy++)
  for (let vx = 0; vx <= size; vx++) world.heights[vy * (size + 1) + vx] = 2 * Math.sin(vx * 0.07) * Math.cos(vy * 0.05);

// ── blocks of lots along a street grid ──────────────────────────────────────
const zonesByRing: [ZoneType, number, number][][] = [
  [[ZoneType.Office, 3, 3], [ZoneType.Office, 2, 3], [ZoneType.ComHigh, 3, 3], [ZoneType.ResHigh, 3, 3], [ZoneType.ResHigh, 2, 3], [ZoneType.MixedUse, 2, 2]],
  [[ZoneType.ResMed, 2, 2], [ZoneType.ResMed, 1, 2], [ZoneType.MixedUse, 2, 2], [ZoneType.ComLow, 2, 2], [ZoneType.ComHigh, 2, 3], [ZoneType.ResHigh, 2, 2]],
  [[ZoneType.ResLow, 1, 2], [ZoneType.ResLow, 1, 2], [ZoneType.ResLow, 2, 2], [ZoneType.ComLow, 1, 1], [ZoneType.ResMed, 1, 2]],
  [[ZoneType.Industry, 3, 3], [ZoneType.Industry, 2, 3], [ZoneType.Farming, 4, 4], [ZoneType.Forestry, 3, 3], [ZoneType.Mining, 3, 3], [ZoneType.Oil, 3, 3]],
];
const STYLES_ALL: StyleId[] = ['american', 'european', 'mediterranean', 'nordic', 'asian', 'artdeco', 'modern', 'futuristic'];
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const c0 = size / 2;
const placed: number[] = [];
const BLOCK = 8; // cells between streets (street = 1 cell)
// layout=states: one row of identical lots in every visual state (close camera)
const statesRow = q.get('layout') === 'states';
if (statesRow) {
  const zone = Number(q.get('zone') ?? ZoneType.ResMed) as ZoneType;
  const zidS = { 1: 'res_low', 2: 'res_med', 3: 'res_high', 4: 'com_low', 5: 'com_high', 6: 'office', 7: 'industry', 8: 'farming', 9: 'forestry', 10: 'mining', 11: 'oil', 12: 'mixed' }[zone as number];
  const variants: [number, number][] = [
    [1, 0], [0.05, 0], [0.35, 0], [0.7, 0], [1, BFlag.Abandoned], [1, BFlag.Burned], [1, BFlag.Collapsed], [1, BFlag.OnFire], [1, BFlag.Flooded],
  ];
  const lw = Number(q.get('lw') ?? 2), ld = Number(q.get('ld') ?? 2);
  variants.forEach(([built, fl], i) => {
    const b = world.addBuilding({
      kind: 'zoned', defId: 'zoned:' + zidS, x: c0 - 9 + i * lw, y: c0 - ld, w: lw, h: ld, rot: Dir.S, zone, level: Number(q.get('level') ?? 3),
      style: (styleArg === 'mixed' ? 'european' : styleArg) as StyleId, seed: 4242, built, flags: fl | BFlag.Powered | BFlag.Watered, residents: 8, maxResidents: 10, jobs: 10, workers: 9,
      problems: fl & BFlag.OnFire ? Problem.Fire : fl & BFlag.Flooded ? Problem.Flooded : fl & BFlag.Abandoned ? Problem.Abandoned : 0,
    });
    placed.push(b.id);
  });
}
const blocks: [number, number][] = [];
if (!statesRow) 
for (let by = 2; by < size - BLOCK; by += BLOCK + 1) for (let bx = 2; bx < size - BLOCK; bx += BLOCK + 1) blocks.push([bx, by]);
blocks.sort((a, b) => Math.hypot(a[0] + BLOCK / 2 - c0, a[1] + BLOCK / 2 - c0) - Math.hypot(b[0] + BLOCK / 2 - c0, b[1] + BLOCK / 2 - c0));
for (const [bx, by] of blocks) {
    if (placed.length >= nWanted) break;
    const dcen = Math.hypot(bx + BLOCK / 2 - c0, by + BLOCK / 2 - c0) / (size / 2);
    const ring = zonesByRing[Math.min(3, Math.floor(dcen * 3.2))];
    const level = Math.max(1, Math.min(5, Math.round(5 - dcen * 4 + rnd() * 1.5)));
    const style: StyleId = styleArg === 'mixed' ? STYLES_ALL[Math.floor(rnd() * 8)] : (styleArg as StyleId);
    // two rows of lots facing the streets south (+Z, rot S) and north (-Z, rot N)
    for (const side of [0, 1]) {
      let x = bx;
      while (x < bx + BLOCK) {
        const [zone, fw0, fd0] = ring[Math.floor(rnd() * ring.length)];
        const fw = Math.min(fw0, bx + BLOCK - x);
        const fd = Math.min(fd0, BLOCK / 2);
        if (fw < 1) break;
        const y = side === 0 ? by + BLOCK - fd : by;
        const rot = side === 0 ? Dir.S : Dir.N;
        let flags = BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess;
        let built = 1, problems = 0;
        if (q.get('states') === '1') {
          const r = rnd();
          if (r < 0.06) built = 0.1 + rnd() * 0.85;
          else if (r < 0.1) flags |= BFlag.Abandoned;
          else if (r < 0.12) flags |= BFlag.OnFire;
          else if (r < 0.14) flags |= BFlag.Burned;
          else if (r < 0.16) flags |= BFlag.Collapsed;
          else if (r < 0.18) flags |= BFlag.Flooded;
        }
        if (q.get('problems') === '1' && rnd() < 0.3) problems = [Problem.NoPower, Problem.Garbage, Problem.Crime | Problem.Noise, Problem.NoWater, Problem.Fire, Problem.Sick][Math.floor(rnd() * 6)];
        const zid = { 1: 'res_low', 2: 'res_med', 3: 'res_high', 4: 'com_low', 5: 'com_high', 6: 'office', 7: 'industry', 8: 'farming', 9: 'forestry', 10: 'mining', 11: 'oil', 12: 'mixed' }[zone as number];
        const b = world.addBuilding({
          kind: 'zoned', defId: 'zoned:' + zid, x, y, w: fw, h: fd, rot, zone, level: zone >= 7 && zone <= 11 ? Math.min(3, level) : level, style,
          seed: Math.floor(rnd() * 2 ** 31), built, flags, problems, residents: 8, maxResidents: 10, jobs: 10, workers: rnd() < 0.2 ? 2 : 9,
        });
        placed.push(b.id);
        x += fw;
      }
    }
  }

const br = new BuildingRenderer(game as never);
br.onWorldLoaded(world);

// camera
const camArg = q.get('cam') ?? 'mid';
const mid = (size / 2) * CELL;
const views: Record<string, [number, number, number, number, number, number]> = {
  near: [mid + 180, 170, mid + 330, mid, 20, mid + 40],
  mid: [mid + 500, 520, mid + 900, mid, 0, mid],
  far: [mid + 1200, 1400, mid + 2300, mid, 0, mid],
  street: [mid + 40, 14, mid + 150, mid - 40, 30, mid - 60],
  states: [mid, 140, mid + 300, mid, 4, mid - 24],
};
const v = views[camArg] ?? camArg.split(',').map(Number);
camera.position.set(v[0], v[1], v[2]);
camera.lookAt(v[3], v[4], v[5]);
camera.updateMatrixWorld();
stage.fitShadow(v[3], v[5], camArg === 'far' ? 1800 : camArg === 'mid' ? 1000 : 500);

const hl = q.get('hl');
if (hl) br.highlight(placed[Number(hl)] ?? placed[0], 0x5cd6ff);
const pv = q.get('preview');
if (pv) {
  const o = br.createPreview(pv, Dir.S);
  o.position.set(v[3], 0.2, v[5]);
  scene.add(o);
}

const hud = document.getElementById('hud')!;
// profile the renderer's phases (private methods wrapped through the prototype)
const prof: Record<string, number> = {};
const proto = BuildingRenderer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const name of ['classify', 'poll', 'rebuildDetail', 'rebuildLod', 'refine', 'updateLodGroups', 'evict', 'updateIcons']) {
  const fn = proto[name];
  proto[name] = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    const r = fn.apply(this, a);
    const d = performance.now() - t;
    prof[name] = Math.max(prof[name] ?? 0, d);
    return r;
  };
}
const slow: [number, string][] = [];
{
  const gen = proto.generate;
  proto.generate = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    const r = gen.apply(this, a);
    const d = performance.now() - t;
    const bi = a[0] as { key: string };
    slow.push([d, bi.key]);
    slow.sort((x, y) => y[0] - x[0]);
    slow.length = Math.min(slow.length, 6);
    return r;
  };
}
// SwiftShader is slow: run the renderer's budgeted update loop without drawing
// (like frames on a fast GPU), then draw a couple of frames at the end.
const updates = Number(q.get('frames') ?? 200);
let f = 0;
const t0 = performance.now();
let upd = 0, sum = 0;
function info(): string {
  const s = br.stats();
  return `buildings ${s.buildings} · detail ${s.detailChunks} · lod ${s.lodChunks} · pending ${s.pending} · verts ${(s.cachedVerts / 1e6).toFixed(2)}M · update max ${upd.toFixed(1)} avg ${(sum / Math.max(1, f)).toFixed(1)} ms · calls ${renderer.info.render.calls} · tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k · emitters ${emitters.size} · f${f}\n` +
    Object.entries(prof).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ') + '\nslow: ' + slow.map(([d, k]) => `${d.toFixed(0)}ms ${k}`).join(' | ');
}
function step(): void {
  game.time = (performance.now() - t0) / 1000;
  const u0 = performance.now();
  br.update(1 / 60);
  const d = performance.now() - u0;
  if (f > 2) { upd = Math.max(upd, d); sum += d; }
  f++;
  if (f < updates) setTimeout(step, 0);
  else {
    renderer.render(scene, camera);
    hud.textContent = info();
    (window as unknown as { __done: boolean }).__done = true;
  }
}
step();
(window as unknown as Record<string, unknown>).__h = { br, world, game, placed, scene, camera, events, info };
