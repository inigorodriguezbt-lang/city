// Node benchmark + assertions for the field engine (bundled by run.mjs).
//   node sandbox/fields/run.mjs            → correctness probes on 256 + perf on 768
import { FieldEngine } from '../../src/sim/fields/engine';
import { BufferPool, BuildingPacker, packStops, packTerrain, weatherPacket } from '../../src/sim/fields/pack';
import { OUTPUT_FIELDS, type FieldJob, type FieldResult } from '../../src/sim/fields/protocol';
import type { World } from '../../src/world/World';
import { buildWorld } from './scene';

const mods = { powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1 };

function job(w: World, pool: BufferPool, packer: BuildingPacker, full: boolean, token = 1, days = 1, terrain = true): { job: FieldJob; packMs: number; recMs: number } {
  const t0 = performance.now();
  const n = w.size * w.size;
  const copy = (a: Uint8Array) => {
    const b = new Uint8Array(pool.take(n));
    b.set(a);
    return b;
  };
  const tr = performance.now();
  const recs = packer.pack(w, mods, pool);
  const recMs = performance.now() - tr;
  const { stops, stopCount } = packStops(w, pool);
  const j: FieldJob = {
    token, size: w.size, full, days, terrain: terrain || full ? packTerrain(w, pool) : undefined,
    road: copy(w.road), roadFlags: copy(w.roadFlags), zone: copy(w.zone), trees: copy(w.trees), treesChanged: full,
    traffic: copy(w.fields.traffic), recI: recs.recI, recF: recs.recF, count: recs.count, stops, stopCount,
    weather: weatherPacket(w), rainfall: 0.5, recycle: pool.takeUpTo(n, OUTPUT_FIELDS.length),
  };
  return { job: j, packMs: performance.now() - t0, recMs };
}

function apply(w: World, r: FieldResult, pool: BufferPool): void {
  for (const [id, arr] of Object.entries(r.fields)) {
    if (!arr) continue;
    w.fields[id as keyof typeof w.fields].set(arr);
    pool.put(arr.buffer as ArrayBuffer);
  }
  for (const b of r.recycle) pool.put(b);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

// ── correctness on a small map ─────────────────────────────────────────────
{
  const { world: w, probes } = buildWorld(256);
  const pool = new BufferPool(), packer = new BuildingPacker(), eng = new FieldEngine();
  const { job: j } = job(w, pool, packer, true);
  const r = eng.run(j);
  apply(w, r, pool);
  const F = w.fields;
  const at = (f: keyof typeof F, p: { x: number; y: number }) => F[f][p.y * w.size + p.x];
  console.log('buildings', w.buildings.size, 'compute', r.ms.toFixed(1), 'ms');
  console.log('power', r.power, 'water', r.water, 'sewage', r.sewage);
  console.log('probes', JSON.stringify(probes));
  const table: Record<string, Record<string, number>> = {};
  for (const [k, p] of Object.entries(probes)) {
    if (p.x < 0) continue;
    table[k] = {};
    for (const f of ['power', 'water', 'sewage', 'police', 'fire', 'health', 'education', 'garbage', 'leisure', 'transit', 'pollution', 'noise', 'crime', 'landValue', 'happiness', 'tourism'] as const) table[k][f] = at(f, p);
  }
  console.table(table);
  check('pump placed', probes.pump.x >= 0);
  check('outlet placed', probes.outlet.x >= 0);
  check('downtown powered', at('power', probes.downtown) === 255);
  check('island suburb unpowered', at('power', probes.island) === 0);
  check('brownout: near turbine served', at('power', probes.brownNear) === 255, String(at('power', probes.brownNear)));
  check('brownout: far end dark', at('power', probes.brownFar) === 0, String(at('power', probes.brownFar)));
  check('downtown watered', at('water', probes.downtown) === 255);
  check('police coverage near station', at('police', probes.police) > 150, String(at('police', probes.police)));
  check('coal pollution high', at('pollution', probes.coal) > 150, String(at('pollution', probes.coal)));
  check('industry polluted > suburb', at('pollution', probes.industry) > at('pollution', probes.suburbWest) + 30);
  check('downtown land value > abandoned', at('landValue', probes.downtown) > at('landValue', probes.abandoned) + 20);
  check('abandoned crime > downtown', at('crime', probes.abandoned) > at('crime', probes.downtown));
  // pollution drifts downwind (+x, windDir 0.15): compare 12 cells east vs west of the plant
  const c = { x: probes.coal.x + 2, y: probes.coal.y + 2 };
  const east = at('pollution', { x: c.x + 14, y: c.y }), west = at('pollution', { x: c.x - 14, y: c.y });
  check('pollution drifts downwind', east > west, `east ${east} west ${west}`);
  // water pollution downstream of the outlet
  let wmax = 0;
  for (let i = 0; i < w.size * w.size; i++) if (w.water[i] > -100 && w.isWater(i % w.size, (i / w.size) | 0)) wmax = Math.max(wmax, F.pollution[i]);
  check('sewage pollutes water', wmax > 60, String(wmax));
  // coverage follows roads: a cell 3 cells off-road far from the station less covered than a road cell at equal straight distance
  check('forest field present', F.forest.some((v) => v > 100));

  // temporal smoothing: a second non-full run should keep values close
  const before = F.landValue.slice();
  const { job: j2 } = job(w, pool, packer, false, 1, 1);
  apply(w, eng.run(j2), pool);
  let maxd = 0;
  for (let i = 0; i < before.length; i++) maxd = Math.max(maxd, Math.abs(before[i] - F.landValue[i]));
  check('steady state stable across runs', maxd <= 3, 'max Δ ' + maxd);
}

// ── performance on a huge map ──────────────────────────────────────────────
{
  const t0 = performance.now();
  const { world: w } = buildWorld(768);
  console.log(`\n768 map: ${w.buildings.size} buildings, built in ${(performance.now() - t0).toFixed(0)} ms`);
  const pool = new BufferPool(), packer = new BuildingPacker(), eng = new FieldEngine();
  const times: number[] = [], packs: number[] = [], recs: number[] = [];
  let last: FieldResult | null = null;
  for (let k = 0; k < 6; k++) {
    const { job: j, packMs, recMs } = job(w, pool, packer, k === 0, 1, 1, false);
    const r = eng.run(j);
    apply(w, r, pool);
    if (k > 0) {
      times.push(r.ms);
      packs.push(packMs);
      recs.push(recMs);
    }
    last = r;
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`compute avg ${avg(times).toFixed(1)} ms (min ${Math.min(...times).toFixed(1)}), pack avg ${avg(packs).toFixed(2)} ms (records ${avg(recs).toFixed(2)} ms)`);
  if (last) console.log('stages', Object.fromEntries(Object.entries(last.stages).map(([k, v]) => [k, +v.toFixed(1)])));
  check('768 compute < 350 ms', avg(times) < 350, avg(times).toFixed(1));
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
