// Field-system sandbox: builds the synthetic city, runs the real FieldSystem
// (worker path) against a minimal fake Game, and renders every field as a
// heatmap over a dimmed base map (water, roads, buildings).
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { Dir, RoadType, type FieldId } from '../../src/core/types';
import { buildingDef } from '../../src/data/buildings';
import { overlayInfo } from '../../src/data/overlays';
import type { Game } from '../../src/game/Game';
import { FieldSystem } from '../../src/sim/fields/FieldSystem';
import { buildWorld } from './scene';

const params = new URLSearchParams(location.search);
const size = Number(params.get('size') ?? 256);
/** ?focus=police,pollution renders only those fields, large */
const focus = params.get('focus')?.split(',') as FieldId[] | undefined;
const { world, probes } = buildWorld(size);
const events = new EventBus<GameEvents>();
world.bus = events;
const mods = { powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, crimeMult: 1, tourismMult: 1 };
const fakeGame = { events, eventSystem: { modifiers: () => mods }, world } as unknown as Game;
const fs = new FieldSystem(fakeGame);
fs.onWorldLoaded(world);
Object.assign(window, { __fs: fs, __world: world, __probes: probes, __mods: mods });

const ALL_FIELDS: FieldId[] = [
  'power', 'water', 'sewage', 'landValue', 'pollution',
  'noise', 'crime', 'happiness', 'police', 'fire',
  'health', 'education', 'garbage', 'deathcare', 'leisure',
  'transit', 'tourism', 'forest', 'wind', 'traffic',
];
const FIELDS = focus?.length ? focus : ALL_FIELDS;
if (focus?.length) {
  const px = Math.min(1000, Math.floor((window.innerWidth - 60) / focus.length) - 20);
  document.head.insertAdjacentHTML('beforeend', `<style>#grid{grid-template-columns:repeat(auto-fill,${px + 12}px)}.panel canvas{width:${px}px;height:${px}px}</style>`);
}

const grid = document.getElementById('grid')!;
const panels = new Map<FieldId, { ctx: CanvasRenderingContext2D; img: ImageData; label: HTMLSpanElement }>();
for (const f of FIELDS) {
  const el = document.createElement('div');
  el.className = 'panel';
  const t = document.createElement('div');
  t.className = 't';
  const b = document.createElement('b');
  b.textContent = overlayInfo(f)?.name ?? f;
  const label = document.createElement('span');
  t.append(b, label);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  el.append(t, c);
  grid.append(el);
  const ctx = c.getContext('2d')!;
  panels.set(f, { ctx, img: ctx.createImageData(size, size), label });
}

function rampOf(f: FieldId): [number, number, number][] {
  const r = overlayInfo(f)?.ramp ?? ['#000000', '#ffffff'];
  return r.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
}

function sample(ramp: [number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const k = x - i;
  const a = ramp[i], b = ramp[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function render(): void {
  const n = size * size;
  for (const [f, p] of panels) {
    const data = p.img.data, F = world.fields[f], ramp = rampOf(f);
    const lut: [number, number, number][] = [];
    for (let v = 0; v < 256; v++) lut.push(sample(ramp, v / 255));
    let sum = 0, max = 0, cnt = 0;
    const roadsOnly = overlayInfo(f)?.roadsOnly;
    for (let i = 0; i < n; i++) {
      const x = i % size, y = (i / size) | 0;
      const wet = world.isWater(x, y);
      const road = world.road[i] !== RoadType.None;
      const b = world.bldg[i] !== 0;
      // base map
      let r = 58, g = 64, bl = 54;
      if (wet) { r = 28; g = 44; bl = 70; }
      if (road) { r = 92; g = 92; bl = 96; }
      if (b) { r = 76; g = 78; bl = 84; }
      const v = F[i];
      if (!wet || f === 'pollution' || f === 'wind') { sum += v; cnt++; if (v > max) max = v; }
      const show = roadsOnly ? road : !(wet && f !== 'pollution' && f !== 'wind');
      if (show && (v > 0 || !roadsOnly)) {
        const c = lut[v];
        const a = roadsOnly ? 0.95 : 0.78;
        r = r * (1 - a) + c[0] * a;
        g = g * (1 - a) + c[1] * a;
        bl = bl * (1 - a) + c[2] * a;
      }
      const o = i * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = 255;
    }
    p.ctx.putImageData(p.img, 0, 0);
    // probe markers
    p.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    p.ctx.lineWidth = 1;
    for (const q of Object.values(probes)) if (q.x >= 0) p.ctx.strokeRect(q.x - 1.5, q.y - 1.5, 4, 4);
    p.label.textContent = `avg ${(sum / Math.max(1, cnt)).toFixed(0)} max ${max}`;
  }
  const t = fs.timings;
  const r1 = (v: number) => Math.round(v).toLocaleString('en-US');
  document.getElementById('stats')!.textContent =
    `power ${r1(fs.power.produced)} / ${r1(fs.power.consumed)} MW (${fs.power.connected} served)   ` +
    `water ${r1(fs.water.produced)} / ${r1(fs.water.consumed)} m³   sewage cap ${r1(fs.sewage.produced)} / ${r1(fs.sewage.consumed)} m³\n` +
    `${world.buildings.size} buildings · ${t.mode} · pack ${t.packMs.toFixed(1)} ms · compute ${t.computeMs.toFixed(0)} ms · latency ${t.latencyMs.toFixed(0)} ms · jobs ${t.jobs}   ` +
    `wind ${(world.weather.windDir * 180 / Math.PI).toFixed(0)}° ${world.weather.windSpeed.toFixed(1)} m/s · ${world.time.hour.toFixed(1)} h · day ${world.time.day.toFixed(1)}`;
}

events.on('fields:updated', () => render());

// ── interactions ────────────────────────────────────────────────────────────
document.getElementById('wind')!.onclick = () => {
  world.weather.windDir = (world.weather.windDir + Math.PI / 2) % (Math.PI * 2);
  fs.requestRecompute();
};
document.getElementById('night')!.onclick = () => {
  world.time.hour = world.time.hour > 20 || world.time.hour < 5 ? 13 : 23;
  fs.requestRecompute();
};
document.getElementById('plant')!.onclick = () => {
  const def = buildingDef('coal_plant')!;
  for (let y = 60; y < 200; y++)
    for (let x = 30; x < 70; x++) {
      let ok = true;
      for (let yy = y; yy < y + def.h && ok; yy++) for (let xx = x; xx < x + def.w; xx++) if (!world.inBounds(xx, yy) || world.bldg[world.idx(xx, yy)] || world.road[world.idx(xx, yy)] || world.isWater(xx, yy)) ok = false;
      if (ok && world.roadAccessDir(x, y, def.w, def.h) >= 0) {
        world.addBuilding({ kind: 'service', defId: 'coal_plant', x, y, w: def.w, h: def.h, rot: Dir.S, built: 1, efficiency: 1 });
        world.flushChanges();
        return;
      }
    }
};
document.getElementById('days')!.onclick = () => {
  const target = world.time.day + 5;
  const tick = () => {
    world.time.day = Math.min(target, world.time.day + 0.05);
    world.flushChanges();
    fs.update(1 / 60);
    if (world.time.day < target) requestAnimationFrame(tick);
  };
  tick();
};

// scheduler loop (like Game.step)
function frame(): void {
  world.flushChanges();
  fs.update(1 / 60);
  requestAnimationFrame(frame);
}

(async () => {
  await fs.recomputeNow();
  render();
  (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(frame);
})();
