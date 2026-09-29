// Headless balance & performance harness for the sim-core module.
// Bundle + run:  node sandbox/sim-core/run.mjs [years] [--big]
// Builds a flat map with a street grid, fakes the field system (utilities,
// coverage, pollution, land value) and plays as a simple automated mayor that
// zones land and builds services as the city grows. Prints monthly stats.
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { BFlag, Dir, RoadType, ZoneType, type Building, type FieldId, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { Simulation } from '../../src/sim/Simulation';
import { defaultSettings } from '../../src/settings/types';
import { BUILDINGS, buildingDef } from '../../src/data/buildings';
import { powerUse, waterUse, sewageUse } from '../../src/sim/consumption';
import { MILESTONES } from '../../src/data/milestones';
import { CATS } from '../../src/sim/candidates';
import { hashFloat } from '../../src/core/rng';

const argv = typeof process !== 'undefined' ? process.argv.slice(2) : [];
const YEARS = Number(argv.find((a) => /^\d+$/.test(a)) ?? 12);
const BIG = argv.includes('--big');
const SIZE = BIG ? 256 : 128;

// ── fake game ────────────────────────────────────────────────────────────────
const events = new EventBus<GameEvents>();
const settings = defaultSettings();
settings.gameplay.autoBulldozeAbandoned = true;
const summaries = {
  power: { produced: 0, consumed: 0, connected: 0 },
  water: { produced: 0, consumed: 0, connected: 0 },
  sewage: { produced: 0, consumed: 0, connected: 0 },
};
const notices: string[] = [];
const game = {
  events,
  settings: { value: settings },
  fields: summaries,
  eventSystem: { modifiers: () => ({}), catalog: [] },
  traffic: { dispatch: () => false },
  audio: { play: () => undefined },
  actions: {},
} as unknown as import('../../src/game/Game').Game;

const ms: MapSettings = {
  cityName: 'Testville', mapSize: 'small', theme: 'temperate', seed: 1234, style: 'european', difficulty: 'normal',
  creative: false, disasters: false, mountains: 0, water: 0, forests: 0,
};
const world = new World(ms, SIZE);
world.bus = events;
world.heights.fill(10);
world.connections = [{ kind: 'highway', x: 0, y: Y0_HWY(), dir: Dir.W }];
function Y0_HWY(): number { return 16 + 10 * Math.floor((SIZE / 2 - 16) / 10); }
events.on('notice', (n) => notices.push(`[d${Math.floor(n.day)}] ${n.kind.toUpperCase()} ${n.title}: ${n.text}`.slice(0, 200)));

// ── roads: highway stub + street grid ────────────────────────────────────────
const X0 = 8, X1 = SIZE - 12, Y0 = 16, Y1 = SIZE - 16, STEP = 10;
/** highway row sits on a street line so the grid connects to it */
const MID = Y0 + STEP * Math.floor((SIZE / 2 - Y0) / STEP);
for (let x = 0; x < X0; x++) world.setRoad(x, MID, RoadType.Highway);
const AVENUES = new Set([MID - 4, MID + 6]);
/** streets are built with the blocks they serve (like a player would) */
function roadLine(x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (world.road[world.idx(x, y)]) continue;
      world.setRoad(x, y, AVENUES.has(y) && y0 === y1 ? RoadType.Avenue : RoadType.Street);
    }
}
// entrance: highway → first vertical street
roadLine(X0, MID - STEP, X0, MID + STEP);

// blocks: interior rects between streets
interface Block { x0: number; y0: number; x1: number; y1: number; zone: ZoneType | 'svc' | null; zoned: boolean; bx: number; by: number }
const COLS = Math.floor((X1 - X0) / STEP);
const blocks: Block[] = [];
for (let by = Y0; by + STEP <= Y1; by += STEP)
  for (let bx = X0; bx + STEP <= X1; bx += STEP) {
    const col = (bx - X0) / STEP, row = (by - Y0) / STEP;
    const cols = Math.floor((X1 - X0) / STEP);
    // service blocks are fixed; every other block is zoned on demand by the mayor
    const zone: 'svc' | null = col % 3 === 1 && col < cols - 1 ? 'svc' : null;
    void row;
    blocks.push({ x0: bx + 1, y0: by + 1, x1: bx + STEP - 1, y1: by + STEP - 1, zone, zoned: false, bx: col, by: row });
  }
// order blocks by distance from the highway entrance so the city grows outward
blocks.sort((a, b) => Math.hypot(a.x0 - X0, a.y0 - MID) - Math.hypot(b.x0 - X0, b.y0 - MID));

/** zone type the mayor paints for a demand category (deterministic per block) */
function zoneFor(cat: string, b: Block, m: number): ZoneType {
  const r = hashFloat(b.bx, b.by, 91);
  if (cat === 'res') return m >= 5 && r < 0.12 ? ZoneType.MixedUse : m >= 3 && r < 0.4 ? ZoneType.ResHigh : m >= 2 && r < 0.7 ? ZoneType.ResMed : ZoneType.ResLow;
  if (cat === 'com') return m >= 3 && r < 0.5 ? ZoneType.ComHigh : ZoneType.ComLow;
  if (cat === 'off') return ZoneType.Office;
  return ZoneType.Industry;
}
/** next free block for a category: industry on the city edges, the rest near the centre */
function nextBlock(cat: string): Block | undefined {
  const free = blocks.filter((b) => !b.zoned && b.zone !== 'svc');
  const edge = (b: Block) => b.bx === 0 || b.bx >= COLS - 2;
  if (cat === 'ind') return free.find(edge) ?? free[free.length - 1];
  return free.find((b) => !edge(b)) ?? free[0];
}

function blockRoads(b: Block): void {
  // connect to the entrance: along the first grid column, then along the block's top street
  roadLine(X0, Math.min(MID, b.y0 - 1), X0, Math.max(MID, b.y0 - 1));
  roadLine(X0, b.y0 - 1, b.x0 - 1, b.y0 - 1);
  roadLine(b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y0 - 1);
  roadLine(b.x0 - 1, b.y1 + 1, b.x1 + 1, b.y1 + 1);
  roadLine(b.x0 - 1, b.y0 - 1, b.x0 - 1, b.y1 + 1);
  roadLine(b.x1 + 1, b.y0 - 1, b.x1 + 1, b.y1 + 1);
}

function zoneBlock(b: Block, cat: string): void {
  blockRoads(b);
  const z = zoneFor(cat, b, world.milestone);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (!world.road[world.idx(x, y)]) world.setZone(x, y, z);
  b.zoned = true;
  b.zone = z;
}

// ── services placement ──────────────────────────────────────────────────────
const svcBlocks = () => blocks.filter((b) => b.zone === 'svc');
function place(defId: string, near?: { x: number; y: number }): Building | null {
  const def = buildingDef(defId);
  if (!def || !world.isUnlocked(def.unlock)) return null;
  // near a problem spot, else near the zoned block furthest from any building of the same category
  const zoned = blocks.filter((b) => b.zoned);
  const same = [...world.buildings.values()].filter((b) => b.kind === 'service' && buildingDef(b.defId)?.category === def.category);
  let target = near ?? { x: X0, y: MID };
  let bestGap = -1;
  if (!near) for (const z of zoned) {
    const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
    const gap = same.length ? Math.min(...same.map((b) => Math.hypot(b.x - cx, b.y - cy))) : 1e9 - Math.hypot(cx - X0, cy - MID);
    if (gap > bestGap) { bestGap = gap; target = { x: cx, y: cy }; }
  }
  for (const blk of svcBlocks().sort((a, b) => Math.hypot(a.x0 - target.x, a.y0 - target.y) - Math.hypot(b.x0 - target.x, b.y0 - target.y))) {
    blockRoads(blk);
    for (let y = blk.y0; y + def.h - 1 <= blk.y1; y++)
      for (let x = blk.x0; x + def.w - 1 <= blk.x1; x++) {
        let free = true;
        for (let yy = y; yy < y + def.h && free; yy++) for (let xx = x; xx < x + def.w; xx++) if (world.bldg[world.idx(xx, yy)] || world.road[world.idx(xx, yy)]) { free = false; break; }
        if (!free) continue;
        if (!world.spend(def.cost, 'construction')) return null;
        return world.addBuilding({ kind: 'service', defId, x, y, w: def.w, h: def.h, rot: Dir.N, jobs: def.jobs ?? 0, built: 0, efficiency: 1 });
      }
  }
  return null;
}
const count = (pred: (d: NonNullable<ReturnType<typeof buildingDef>>) => boolean) => {
  let n = 0;
  for (const b of world.buildings.values()) if (b.kind === 'service') { const d = buildingDef(b.defId); if (d && pred(d)) n++; }
  return n;
};

// ── fake field system ───────────────────────────────────────────────────────
const N = SIZE * SIZE;
const tmp = new Float32Array(N);
function stamp(field: FieldId, cx: number, cy: number, radius: number, amount: number, eff: number): void {
  const f = world.fields[field];
  const r = Math.ceil(radius);
  for (let y = Math.max(0, cy - r); y <= Math.min(SIZE - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(SIZE - 1, cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const v = amount * (1 - (d / radius) * 0.6) * eff;
      const i = y * SIZE + x;
      if (field === 'pollution' || field === 'noise' || field === 'landValue' || field === 'happiness') tmp[i] += v;
      else f[i] = Math.max(f[i], Math.min(255, v));
    }
}
function recomputeFields(): void {
  const cover: FieldId[] = ['police', 'fire', 'health', 'education', 'leisure', 'garbage', 'deathcare', 'tourism'];
  for (const f of cover) world.fields[f].fill(0);
  const env: FieldId[] = ['pollution', 'noise', 'landValue', 'happiness'];
  const acc: Record<string, Float32Array> = {};
  for (const e of env) {
    tmp.fill(0);
    for (const b of world.buildings.values()) {
      const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
      if (b.kind === 'service' && b.built >= 1) {
        const d = buildingDef(b.defId);
        for (const fx of d?.effects ?? []) if (fx.field === e) stamp(e, cx, cy, fx.radius, fx.amount, Math.min(1, b.efficiency));
      } else if (b.kind === 'zoned' && b.built >= 1 && !(b.flags & BFlag.Abandoned)) {
        if (e === 'pollution' && (b.zone === ZoneType.Industry || b.zone === ZoneType.Oil || b.zone === ZoneType.Mining)) stamp(e, cx, cy, 6, 50 + b.level * 12, 1);
        if (e === 'noise' && (b.zone === ZoneType.Industry || b.zone === ZoneType.ComHigh)) stamp(e, cx, cy, 4, 40, 1);
      }
    }
    acc[e] = tmp.slice();
  }
  for (const b of world.buildings.values()) {
    if (b.kind !== 'service' || b.built < 1) continue;
    const d = buildingDef(b.defId);
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    for (const fx of d?.effects ?? []) if (cover.includes(fx.field) && fx.amount > 0) stamp(fx.field, cx, cy, fx.radius * 0.8, fx.amount, Math.min(1.2, b.efficiency));
  }
  const unemp = world.stats.workforce > 0 ? world.stats.unemployed / world.stats.workforce : 0;
  for (let i = 0; i < N; i++) {
    const F = world.fields;
    F.power[i] = 255;
    F.water[i] = 255;
    F.sewage[i] = 255;
    const poll = Math.min(255, acc.pollution[i]);
    F.pollution[i] = poll;
    F.noise[i] = Math.min(255, acc.noise[i] + (world.road[i] ? 30 : 0));
    const svc = (F.police[i] + F.fire[i] + F.health[i] + F.education[i] + F.leisure[i] * 1.5) / 5;
    F.landValue[i] = Math.max(0, Math.min(255, 38 + svc * 0.55 + acc.landValue[i] * 0.5 - poll * 0.6));
    F.crime[i] = Math.max(0, Math.min(255, 70 + unemp * 250 - F.police[i] * 0.6 - F.landValue[i] * 0.1));
    F.happiness[i] = Math.min(255, acc.happiness[i]);
  }
  // utility summaries
  let pp = 0, pc = 0, wp = 0, wc = 0, sp = 0, sc = 0;
  for (const b of world.buildings.values()) {
    const d = b.kind === 'service' ? buildingDef(b.defId) : undefined;
    const p = powerUse(b, d), wv = waterUse(b, d), s = sewageUse(b, d);
    if (p < 0) pp -= p; else pc += p;
    if (wv < 0) wp -= wv; else wc += wv;
    if (s < 0) sp -= s; else sc += s;
  }
  Object.assign(summaries.power, { produced: pp, consumed: pc });
  Object.assign(summaries.water, { produced: wp, consumed: wc });
  Object.assign(summaries.sewage, { produced: sp, consumed: sc });
}
let fieldsDue = false;
events.on('sim:day', () => { fieldsDue = true; });

// ── automated mayor ─────────────────────────────────────────────────────────
function mayor(): void {
  const s = world.stats;
  const pop = s.population;
  // utilities
  if (summaries.power.consumed > summaries.power.produced * 0.8 || summaries.power.produced === 0) place(pop > 6000 ? 'coal_plant' : 'wind_turbine');
  if (world.economy.money < 3000 && world.economy.loans.length < 2) sim.takeLoan(50_000, 5);
  if (summaries.water.consumed > summaries.water.produced * 0.8 || summaries.water.produced === 0) place('water_pump');
  if (summaries.sewage.consumed > summaries.sewage.produced * 0.8 || summaries.sewage.produced === 0) place('sewage_outlet');
  // services by population
  const want: [string, (d: NonNullable<ReturnType<typeof buildingDef>>) => boolean, number][] = [
    ['landfill', (d) => d.id === 'landfill', 1 + Math.floor(pop / 15000)],
    ['clinic', (d) => d.category === 'health', Math.ceil(pop / 2500)],
    ['fire_station', (d) => d.category === 'fire', Math.ceil(pop / 3500)],
    ['police_station', (d) => d.category === 'police', Math.ceil(pop / 3500)],
    ['elementary_school', (d) => d.id === 'elementary_school', Math.ceil(pop / 1800)],
    ['high_school', (d) => d.id === 'high_school', Math.floor(pop / 6000)],
    ['small_park', (d) => d.category === 'parks', Math.ceil(pop / 1500)],
    ['cemetery', (d) => d.category === 'deathcare', Math.ceil(pop / 20000)],
    ['incinerator', (d) => d.id === 'incinerator', Math.floor(pop / 9000)],
  ];
  for (const [id, pred, n] of want) if (pop > 150 && count(pred) < n && world.economy.money > 15000) place(id);
  // react to problem hotspots like a player looking at the info views
  const hot: [number, string][] = [[1 << 4, 'landfill'], [1 << 5, 'police_station'], [1 << 6, 'clinic'], [1 << 14, 'cemetery']];
  let zonedN = 0;
  const hits = new Map<number, Building[]>();
  for (const b of world.buildings.values()) {
    if (b.kind !== 'zoned') continue;
    zonedN++;
    for (const [bit] of hot) if (b.problems & bit) { const l = hits.get(bit) ?? []; l.push(b); hits.set(bit, l); }
  }
  for (const [bit, id] of hot) {
    const l = hits.get(bit);
    if (l && l.length > zonedN * 0.08 && world.economy.money > 10000) {
      const b = l[Math.floor(l.length / 2)];
      place(id, { x: b.x, y: b.y });
    }
  }
  // zoning: keep some free land for each category with demand
  for (let c = 0; c < 4; c++) {
    const cat = CATS[c];
    if (s.demand[cat] > 0.15 || (pop < 100 && cat !== 'off')) {
      for (let k = 0; k < (s.demand[cat] > 0.5 ? 3 : 1); k++) {
        if (cat === 'off' && !world.isUnlocked(4)) continue;
        const next = nextBlock(cat);
        const free = freeZoned(cat);
        if (next && free < 24 + k * 60) zoneBlock(next, cat);
      }
    }
  }
  // taxes: react to money
  if (world.economy.money < 0) for (const k of Object.keys(world.economy.taxes) as (keyof typeof world.economy.taxes)[]) world.economy.taxes[k] = Math.min(0.14, world.economy.taxes[k] + 0.01);
}
function catOf(z: ZoneType): string {
  return z === ZoneType.ResLow || z === ZoneType.ResMed || z === ZoneType.ResHigh || z === ZoneType.MixedUse ? 'res' : z === ZoneType.ComLow || z === ZoneType.ComHigh ? 'com' : z === ZoneType.Office ? 'off' : 'ind';
}
function freeZoned(cat: string): number {
  const c = (sim as unknown as { ctx: { candidates: { count(c: number): number } } }).ctx;
  return c.candidates.count(CATS.indexOf(cat as never));
}

// ── run ─────────────────────────────────────────────────────────────────────
const sim = new Simulation(game);
world.flushChanges();
sim.onWorldLoaded(world);
recomputeFields();
place('wind_turbine');
place('wind_turbine');
place('water_pump');
place('sewage_outlet');
const t0 = performance.now();
let maxTick = 0;
// optional growth diagnostics (--growth): count spawn attempt outcomes
const gstat = { tries: 0, noReach: 0, noLot: 0, spawned: 0, locked: 0 };
if (argv.includes('--growth')) {
  const g = (sim as unknown as { growth: Record<string, (...a: unknown[]) => unknown> }).growth;
  const origReach = g.reachesOutside.bind(g), origLot = g.findLot.bind(g), origSpawn = g.spawn.bind(g), origTry = g.trySpawn.bind(g);
  g.trySpawn = (...a: unknown[]) => { gstat.tries++; return origTry(...a); };
  g.reachesOutside = (...a: unknown[]) => { const r = origReach(...a); if (!r) gstat.noReach++; return r; };
  g.findLot = (...a: unknown[]) => { const r = origLot(...a); if (!r) gstat.noLot++; return r; };
  g.spawn = (...a: unknown[]) => { gstat.spawned++; return origSpawn(...a); };
  const cs = (sim as unknown as { ctx: { candidates: Record<string, (...a: unknown[]) => unknown> } }).ctx.candidates;
  const origElig = cs.eligible.bind(cs), origRandom = cs.random.bind(cs);
  let inTry = false;
  const tr = g.trySpawn;
  g.trySpawn = (...a: unknown[]) => { inTry = true; const r = tr(...a); inTry = false; if (r === 0) gstat.locked++; return r; };
  cs.random = (...a: unknown[]) => { const r = origRandom(...a); if (inTry) (gstat as Record<string, number>).samples = ((gstat as Record<string, number>).samples ?? 0) + 1; return r; };
  cs.eligible = (...a: unknown[]) => { const r = origElig(...a); if (inTry && r !== a[3] && (r as number) < 0) (gstat as Record<string, number>).inelig = ((gstat as Record<string, number>).inelig ?? 0) + 1; return r; };
}
const pad = (v: unknown, n: number) => String(v).padStart(n);
console.log('month   pop   hh  jobs unemp%  R     C     I     O    happy hlth edu  money     net   bldg lvl(1..5)        aband probs');
for (let m = 0; m < YEARS * 12; m++) {
  mayor();
  // 30 days in real ticks (as the game does)
  for (let d = 0; d < 30 * 8; d++) {
    sim.update(2 / 8);
    const pf = sim.perf;
    if (pf.lastTickMs > 4 && argv.includes('--spikes')) console.log(`spike ${pf.lastTickMs.toFixed(2)}ms day ${pf.dayMs.toFixed(2)} slice ${pf.sliceMs.toFixed(2)} growth ${pf.growthMs.toFixed(2)} scan ${pf.scanMs.toFixed(2)} n=${pf.buildingsPerTick} tick=${Math.floor(world.time.day * 8)}`);
    world.flushChanges();
    if (fieldsDue) { fieldsDue = false; recomputeFields(); }
  }
  maxTick = Math.max(maxTick, sim.perf.maxTickMs);
  if (argv.includes('--debug') && m < 3) {
    let zc = 0, rc = 0;
    for (let i = 0; i < N; i++) { if (world.zone[i]) zc++; if (world.road[i]) rc++; }
    const c = (sim as unknown as { ctx: { candidates: { count(c: number): number }; outside: { reachable: number; hasConnections: boolean } } }).ctx;
    const o = (c as unknown as { outside: { dirty: boolean; recompute(): void; reachable: number } }).outside;
    const before = o.reachable, wasDirty = o.dirty;
    o.recompute();
    console.log('reach before', before, 'dirty', wasDirty, 'after', o.reachable);
    console.log('debug zones', zc, 'roads', rc, 'cands', [0, 1, 2, 3].map((k) => c.candidates.count(k)), 'reach', c.outside.reachable, c.outside.hasConnections, 'demand', JSON.stringify(world.stats.demand), 'acc', JSON.stringify((world.ext.sim as { spawnAcc: unknown }).spawnAcc));
  }
  const s = world.stats;
  const lv = [0, 0, 0, 0, 0, 0];
  let aband = 0;
  const prob: Record<string, number> = {};
  for (const b of world.buildings.values()) {
    if (b.kind !== 'zoned') continue;
    lv[b.level]++;
    if (b.flags & BFlag.Abandoned) aband++;
    for (let bit = 0; bit < 20; bit++) if (b.problems & (1 << bit)) prob[bit] = (prob[bit] ?? 0) + 1;
  }
  const u = s.workforce ? ((s.unemployed / s.workforce) * 100).toFixed(1) : '0';
  const d = s.demand;
  const probStr = Object.entries(prob).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' ');
  if (m % (YEARS > 20 ? 6 : 3) === 2 || m < 4)
    console.log(`${pad(m + 1, 4)} ${pad(s.population, 6)} ${pad(s.households, 5)} ${pad(s.jobs, 5)} ${pad(u, 5)} ${d.res.toFixed(2).padStart(5)} ${d.com.toFixed(2).padStart(5)} ${d.ind.toFixed(2).padStart(5)} ${d.off.toFixed(2).padStart(5)} ${pad(s.happiness.toFixed(0), 5)} ${pad(s.health.toFixed(0), 4)} ${pad(s.education.toFixed(0), 4)} ${pad(Math.round(world.economy.money), 9)} ${pad(s.netIncome, 7)} ${pad(s.buildings, 5)} ${lv.slice(1).map((v) => pad(v, 4)).join('')} ${pad(aband, 5)}  ${probStr}`);
}
const elapsed = performance.now() - t0;
console.log(`\nsimulated ${YEARS} years in ${(elapsed / 1000).toFixed(1)} s; avg tick ${sim.perf.avgTickMs.toFixed(3)} ms, max tick ${maxTick.toFixed(2)} ms; buildings ${world.buildings.size}; milestone ${MILESTONES[world.milestone].name}`);
console.log('last income', JSON.stringify(world.economy.lastIncome));
console.log('last expense', JSON.stringify(world.economy.lastExpense));
console.log('rates', JSON.stringify(sim.rates, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
console.log('stats', JSON.stringify({ ...world.stats, demand: undefined }));
console.log('achievements', world.achievements.join(', '));
console.log('demand why', JSON.stringify(sim.demandFactors()));
{
  const last = (sim as unknown as { ctx: { last: { blockCount: Int32Array } } }).ctx.last;
  const names = ['none', 'landValue', 'services', 'education', 'customers', 'goods', 'workers', 'utilities', 'happiness', 'maxLevel', 'construction', 'educatedWorkers', 'sales', 'occupancy', 'problems', 'policy'];
  console.log('level blockers', names.map((n, i) => `${n}:${last.blockCount[i]}`).filter((x) => !x.endsWith(':0')).join(' '));
  let lvSum = 0, lvN = 0, lvMax = 0;
  for (const b of world.buildings.values()) if (b.kind === 'zoned') { const v = world.fields.landValue[world.idx(b.x, b.y)]; lvSum += v; lvN++; lvMax = Math.max(lvMax, v); }
  {
    const c = (sim as unknown as { ctx: { candidates: { count(c: number): number }; outside: { reach: Uint8Array } } }).ctx;
    const freeBlocks = blocks.filter((b) => !b.zoned && b.zone !== 'svc').length;
    let zonedEmpty = 0;
    for (let i = 0; i < N; i++) if (world.zone[i] && !world.bldg[i]) zonedEmpty++;
    console.log('candidates', [0, 1, 2, 3].map((k) => c.candidates.count(k)).join('/'), 'free blocks', freeBlocks, 'zoned empty cells', zonedEmpty);
  }
  if (argv.includes('--growth')) {
    console.log('growth', JSON.stringify(gstat), 'milestone', world.milestone);
    const byZone: Record<number, number> = {};
    const cs = (sim as unknown as { ctx: { candidates: { has(i: number): boolean } } }).ctx.candidates;
    for (let i = 0; i < N; i++) if (cs.has(i)) byZone[world.zone[i]] = (byZone[world.zone[i]] ?? 0) + 1;
    console.log('candidate zones', JSON.stringify(byZone));
  }
  console.log('land value avg', (lvSum / Math.max(1, lvN)).toFixed(0), 'max', lvMax);
}
{
  let jc = 0, ji = 0, jo = 0;
  for (const b of world.buildings.values()) if (b.kind === 'zoned') { const c = catOf(b.zone); if (c === 'com' || b.zone === ZoneType.MixedUse) jc += b.jobs; else if (c === 'ind') ji += b.jobs; else if (c === 'off') jo += b.jobs; }
  console.log('jobs com/ind/off', jc, ji, jo);
}
// fast-forward timing
const ff0 = performance.now();
sim.advanceDays(360);
console.log(`advanceDays(360): ${(performance.now() - ff0).toFixed(0)} ms, pop ${world.stats.population}`);
// info sample
const sample = [...world.buildings.values()].find((b) => b.kind === 'zoned' && b.residents > 0);
if (sample) console.log(JSON.stringify(sim.buildingInfo(sample.id), null, 0).slice(0, 1500));
const svc = [...world.buildings.values()].find((b) => b.kind === 'service' && b.defId === 'clinic');
if (svc) console.log(JSON.stringify(sim.buildingInfo(svc.id), null, 0).slice(0, 900));
console.log('\nnotices (last 25):');
for (const n of notices.slice(-25)) console.log(' ', n);
void BUILDINGS;
