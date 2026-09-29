// Tick-cost benchmark: a 384² map packed with ~6000 zoned buildings and a set
// of services, all utilities connected. Run: node sandbox/sim-core/run.mjs --perf
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { Dir, RoadType, ZoneType, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { Simulation } from '../../src/sim/Simulation';
import { defaultSettings } from '../../src/settings/types';
import { buildingDef } from '../../src/data/buildings';
import { zoneDef } from '../../src/data/zones';
import { capRes, capJobs, zoneMeta } from '../../src/sim/zonemeta';

const SIZE = 384;
const events = new EventBus<GameEvents>();
const settings = defaultSettings();
const game = {
  events,
  settings: { value: settings },
  fields: { power: { produced: 1e4, consumed: 5e3, connected: 0 }, water: { produced: 1e5, consumed: 5e4, connected: 0 }, sewage: { produced: 1e5, consumed: 5e4, connected: 0 } },
  eventSystem: { modifiers: () => ({}), catalog: [] },
  traffic: { dispatch: () => false },
  audio: { play: () => undefined },
  actions: {},
} as unknown as import('../../src/game/Game').Game;
const ms: MapSettings = {
  cityName: 'Perfton', mapSize: 'medium', theme: 'temperate', seed: 7, style: 'modern', difficulty: 'normal',
  creative: false, disasters: false, mountains: 0, water: 0, forests: 0,
};
const world = new World(ms, SIZE);
world.bus = events;
world.heights.fill(5);
world.milestone = 6;
world.connections = [{ kind: 'highway', x: 0, y: 12, dir: Dir.W }];
const STEP = 7;
for (let y = 12; y < SIZE - 4; y += STEP) for (let x = 0; x < SIZE - 4; x++) world.setRoad(x, y, x < 4 ? RoadType.Highway : RoadType.Street);
for (let x = 4; x < SIZE - 4; x += STEP) for (let y = 12; y < SIZE - 4; y++) world.setRoad(x, y, RoadType.Street);
const zones = [ZoneType.ResLow, ZoneType.ResMed, ZoneType.ResHigh, ZoneType.ComLow, ZoneType.ComHigh, ZoneType.Office, ZoneType.Industry, ZoneType.MixedUse];
let spawned = 0, seed = 1;
const SPARSE = process.argv.includes('--5k');
for (let by = 12; by + STEP < SIZE - 4; by += STEP)
  for (let bx = 4; bx + STEP < SIZE - 4; bx += STEP) {
    if (SPARSE && ((bx - 4) / STEP + (by - 12) / STEP) % 3 !== 0) continue;
    const z = zones[(bx * 7 + by * 13) % zones.length];
    const m = zoneMeta(z)!;
    // two rows of 2x3 lots facing the top and bottom streets
    for (let x = bx + 1; x + 1 < bx + STEP; x += 2) {
      for (const [y, rot] of [[by + 1, Dir.N], [by + STEP - 3, Dir.S]] as [number, Dir][]) {
        for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) world.setZone(xx, yy, z);
        const lvl = 1 + (seed % 3);
        world.addBuilding({
          kind: 'zoned', defId: 'zoned:' + zoneDef(z).id, x, y, w: 2, h: 2, rot, zone: z, level: lvl, style: 'modern', seed: seed++,
          built: 1, happiness: 60.5, health: 70.5, education: 20.5, garbage: 0.5, goods: 50.5, efficiency: 0.99, maxResidents: capRes(m, 4, lvl), residents: Math.round(capRes(m, 4, lvl) * 0.8), jobs: capJobs(m, 4, lvl), workers: Math.round(capJobs(m, 4, lvl) * 0.8),
        });
        spawned++;
      }
    }
  }
// services sprinkled around
const svc = ['clinic', 'fire_station', 'police_station', 'elementary_school', 'small_park', 'landfill', 'cemetery', 'high_school'];
let placedSvc = 0;
for (let by = 12 + STEP * 3; by + STEP < SIZE - 4; by += STEP * 6)
  for (let bx = 4 + STEP * 3; bx + STEP < SIZE - 4; bx += STEP * 6) {
    const def = buildingDef(svc[placedSvc % svc.length])!;
    // clear the block middle for it
    const x = bx + 1, y = by + 1;
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
      const b = world.buildingAt(xx, yy);
      if (b) world.removeBuilding(b.id);
    }
    world.addBuilding({ kind: 'service', defId: def.id, x, y, w: def.w, h: def.h, rot: Dir.N, jobs: def.jobs ?? 0, workers: def.jobs ?? 0, built: 1, efficiency: 1 });
    placedSvc++;
  }
const F = world.fields;
F.power.fill(255); F.water.fill(255); F.sewage.fill(255);
F.landValue.fill(90); F.police.fill(120); F.fire.fill(120); F.health.fill(110); F.education.fill(110); F.garbage.fill(160); F.leisure.fill(80); F.deathcare.fill(100);
F.crime.fill(40); F.pollution.fill(20); F.noise.fill(50);
world.flushChanges();
let touches = 0;
events.on('building:changed', () => { touches++; });
const sim = new Simulation(game);
sim.onWorldLoaded(world);
console.log(`buildings: ${world.buildings.size} (zoned ${spawned}, services ${placedSvc})`);
// warm up 10 days, then measure 60 days at 10x (0.2 s per day)
const times: number[] = [];
const cpuTimes: number[] = [];
for (let f = 0; f < 70 * 12; f++) {
  const tick0 = sim.perf.buildingsPerTick, c0 = process.cpuUsage();
  const before = Math.floor(world.time.day * 8);
  sim.update(2 / 12);
  const c1 = process.cpuUsage(c0);
  world.flushChanges();
  const ran = Math.floor(world.time.day * 8) - before;
  void tick0;
  if (f >= 10 * 12 && ran > 0) cpuTimes.push((c1.user + c1.system) / 1000 / ran);
  if (f >= 10 * 12) {
    times.push(sim.perf.lastTickMs);
    const p = sim.perf;
    if (p.lastTickMs > 5 && process.argv.includes('--spikes')) console.log(`spike ${p.lastTickMs.toFixed(1)} day ${p.dayMs.toFixed(1)} slice ${p.sliceMs.toFixed(1)} growth ${p.growthMs.toFixed(1)} scan ${p.scanMs.toFixed(1)} tick ${Math.floor(world.time.day * 8)}`);
  }
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(3);
console.log(`ticks measured: ${times.length}; avg ${avg.toFixed(3)} ms, p50 ${pct(0.5)}, p90 ${pct(0.9)}, p99 ${pct(0.99)}, max ${times[times.length - 1].toFixed(3)} ms`);
cpuTimes.sort((a, b) => a - b);
const cavg = cpuTimes.reduce((a, b) => a + b, 0) / Math.max(1, cpuTimes.length);
console.log(`cpu time per tick: avg ${cavg.toFixed(3)} ms, p50 ${cpuTimes[Math.floor(cpuTimes.length * 0.5)]?.toFixed(3)}, p90 ${cpuTimes[Math.floor(cpuTimes.length * 0.9)]?.toFixed(3)}, p99 ${cpuTimes[Math.floor(cpuTimes.length * 0.99)]?.toFixed(3)}, max ${cpuTimes[cpuTimes.length - 1]?.toFixed(3)} ms`);
console.log(`building:changed per day: ${(touches / 70).toFixed(0)}`);
console.log(`population ${world.stats.population}, jobs ${world.stats.jobs}, happiness ${world.stats.happiness}, buildings/tick ${sim.perf.buildingsPerTick}`);
if (process.argv.includes('--noff')) process.exit(0);
const ff0 = performance.now();
sim.advanceDays(3600);
console.log(`advanceDays(3600): ${(performance.now() - ff0).toFixed(0)} ms → day ${world.time.day.toFixed(1)}, pop ${world.stats.population}, buildings ${world.buildings.size}`);
