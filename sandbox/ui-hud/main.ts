// HUD sandbox: boots the real UIManager against a fake Game with a populated
// World so every panel/state can be opened via URL params, e.g.
//   ?panel=budget&page=loans   ?panel=graphs   ?fly=power   ?tool=road
//   ?inspect=1  ?vehicle=1  ?toasts=1  ?milestone=1  ?achievement=1
//   ?overlay=pollution  ?photo=1  ?tutorial=1  ?search=scho  ?paused=1
//   ?perf=1  ?dialog=1  ?more=1  ?scale=1.25  ?creative=1  ?debt=1
import '../../src/ui/theme.css';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { Noise } from '../../src/core/noise';
import { RNG } from '../../src/core/rng';
import {
  BFlag, Dir, Problem, RoadType, ZoneType,
  type Building, type BudgetCategory, type District, type FieldId, type HistoryPoint, type MapSettings, type TaxCategory, type TransitLine,
} from '../../src/core/types';
import { DAYS_PER_MONTH, REAL_SECONDS_PER_DAY, SPEEDS } from '../../src/core/constants';
import { World } from '../../src/world/World';
import { defaultSettings, DEFAULT_KEYBINDS, type ActionId, type Settings } from '../../src/settings/types';
import { BUILDINGS, buildingDef, CATEGORY_INFO } from '../../src/data/buildings';
import { zoneDef } from '../../src/data/zones';
import { MILESTONES } from '../../src/data/milestones';
import { POLICIES } from '../../src/data/policies';
import { UIManager } from '../../src/ui/UIManager';
import type { Game } from '../../src/game/Game';
import type { BuildingInfo } from '../../src/sim/Simulation';

const q = new URLSearchParams(location.search);
const SIZE = 256;

// ── world ────────────────────────────────────────────────────────────────
function makeWorld(): World {
  const ms: MapSettings = {
    cityName: 'Port Aurelia', mapSize: 'small', theme: 'temperate', seed: 42, style: 'european', difficulty: 'normal',
    creative: q.get('creative') === '1', disasters: true, mountains: 0.5, water: 0.5, forests: 0.5,
  };
  const w = new World(ms, SIZE);
  const n = new Noise(7);
  const rng = new RNG(11);
  // terrain: rolling hills, sea in the south-east, a river from the north
  for (let y = 0; y <= SIZE; y++)
    for (let x = 0; x <= SIZE; x++) {
      let hgt = 10 + n.fbm2(x / 70, y / 70, 5) * 26 + Math.max(0, n.fbm2(x / 40 + 9, y / 40, 4)) * 30 * Math.max(0, 1 - (x + y) / 260);
      const sea = (x - 20) + (y - 10) * 1.1 - 330 + n.noise2(x / 30, y / 30) * 18;
      if (sea > 0) hgt -= sea * 0.9;
      const rx = 70 + Math.sin(y / 23) * 14 + n.noise2(y / 40, 3) * 8;
      const rd = Math.abs(x - rx);
      if (rd < 3.2 && y < 200) hgt = Math.min(hgt, -2.5 + rd * 0.6);
      w.heights[y * (SIZE + 1) + x] = hgt;
    }
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (w.cellHeight(x, y) < -0.3) w.water[y * SIZE + x] = 0;
      const f = n.fbm2(x / 34 + 40, y / 34, 4);
      if (!w.isWater(x, y) && f > 0.12) w.trees[y * SIZE + x] = f > 0.35 ? 3 : f > 0.22 ? 2 : 1;
    }
  // highway from the west edge into town, rail from the north
  for (let x = 0; x <= 150; x++) w.setRoad(x, 132, RoadType.Highway, w.isWater(x, 132) ? 1 : 0);
  for (let y = 0; y < 120; y++) w.setRoad(160, y, RoadType.Rail, w.isWater(160, y) ? 1 : 0);
  // street grid
  const x0 = 96, x1 = 190, y0 = 92, y1 = 176;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      if (w.isWater(x, y)) continue;
      const av = (x - x0) % 18 === 0 || (y - y0) % 18 === 0;
      const st = (x - x0) % 6 === 0 || (y - y0) % 6 === 0;
      if (av) w.setRoad(x, y, (x - x0) % 36 === 0 && (y - y0) % 18 !== 0 ? RoadType.Boulevard : RoadType.Avenue);
      else if (st) w.setRoad(x, y, RoadType.Street);
    }
  // zones + buildings on 2x2 lots inside blocks
  const zoneFor = (x: number, y: number): ZoneType => {
    const cx = 143, cy = 134;
    const d = Math.hypot(x - cx, y - cy);
    if (x > 168 && y > 150) return ZoneType.Industry;
    if (d < 16) return ZoneType.Office;
    if (d < 26 && ((x + y) & 3) === 0) return ZoneType.ComHigh;
    if (d < 30) return ZoneType.ResHigh;
    if (((x >> 3) + (y >> 3)) % 5 === 0) return ZoneType.ComLow;
    if (d < 42) return ZoneType.ResMed;
    return ZoneType.ResLow;
  };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (w.roadAt(x, y) || w.isWater(x, y)) continue;
      w.setZone(x, y, zoneFor(x, y));
    }
  const services = ['coal_plant', 'wind_turbine', 'water_pump', 'sewage_outlet', 'clinic', 'fire_station', 'police_station', 'elementary_school', 'city_park', 'landfill', 'bus_depot', 'city_hall'];
  let si = 0;
  for (let by = y0 + 1; by < y1; by += 6)
    for (let bx = x0 + 1; bx < x1; bx += 6) {
      for (const [ox, oy] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
        const x = bx + ox, y = by + oy;
        if (x + 1 >= x1 || y + 1 >= y1) continue;
        let ok = true;
        for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (w.roadAt(xx, yy) || w.isWater(xx, yy) || w.bldg[w.idx(xx, yy)]) ok = false;
        if (!ok || rng.chance(0.12)) continue;
        if (rng.chance(0.05) && si < services.length) {
          const def = buildingDef(services[si]) ?? BUILDINGS.find((b) => b.category === Object.keys(CATEGORY_INFO)[si % 8]);
          si++;
          if (def) {
            w.addBuilding({ kind: 'service', defId: def.id, x, y, w: 2, h: 2, rot: Dir.S, built: 1, flags: BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess, workers: def.jobs ?? 10, visitors: Math.round((def.capacity ?? 100) * 0.7), efficiency: 1.04, age: 400 });
            continue;
          }
        }
        const z = w.zoneAt(x, y);
        const zd = zoneDef(z);
        if (!zd) continue;
        const level = 1 + Math.min(4, Math.floor(rng.next() * 3 + (zd.density === 'high' ? 2 : 0)));
        const cap = Math.round(zd.capacityPerCell * 4 * [0, 1, 1.35, 1.75, 2.2, 2.8][level]);
        const res = zd.category === 'res';
        w.addBuilding({
          kind: 'zoned', defId: 'zoned:' + zd.id, x, y, w: 2, h: 2, rot: Dir.S, zone: z, level, built: rng.chance(0.06) ? 0.4 : 1,
          flags: BFlag.Powered | BFlag.Watered | BFlag.Sewered | BFlag.RoadAccess | (rng.chance(0.02) ? BFlag.Abandoned : 0),
          residents: res ? Math.round(cap * rng.range(0.7, 1)) : 0, maxResidents: res ? cap : 0,
          jobs: res ? 0 : cap, workers: res ? 0 : Math.round(cap * rng.range(0.6, 1)),
          happiness: rng.range(50, 90), health: rng.range(55, 92), education: rng.range(20, 80), age: rng.range(10, 1500),
          problems: rng.chance(0.08) ? Problem.Garbage | Problem.Noise : 0,
        });
      }
    }
  // fields for the inspector / overlays
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = i % SIZE, y = (i / SIZE) | 0;
    w.fields.landValue[i] = Math.max(0, Math.min(255, 220 - Math.hypot(x - 143, y - 134) * 3));
  }
  w.home = { x: 143, y: 134 };
  // economy & stats
  const e = w.economy;
  e.money = q.get('debt') ? -12_400 : 284_560;
  e.lastIncome = { resLow: 41_200, resHigh: 12_800, comLow: 18_300, comHigh: 6_100, office: 9_400, industry: 14_200, tourism: 3_200, transit: 2_150 };
  e.lastExpense = { roads: 6_200, power: 9_800, water: 7_250, garbage: 4_100, health: 8_900, education: 11_200, police: 5_600, fire: 4_800, parks: 3_300, transit: 5_200, loans: 2_120, policies: 1_450 };
  e.monthIncome = Object.fromEntries(Object.entries(e.lastIncome).map(([k, v]) => [k, Math.round(v * 0.46)]));
  e.monthExpense = Object.fromEntries(Object.entries(e.lastExpense).map(([k, v]) => [k, Math.round(v * 0.48)]));
  e.loans = [{ id: 1, amount: 150_000, rate: 0.07, remaining: 96_400, payment: 1_742, takenDay: 700 }];
  e.taxes.resLow = 0.11;
  e.taxes.industry = 0.14;
  e.budgets.education = 1.2;
  e.budgets.parks = 0.8;
  const st = w.stats;
  Object.assign(st, {
    population: 48_250, households: 18_560, workforce: 26_540, jobs: 27_900, employed: 24_870, unemployed: 1_670, students: 8_690, tourists: 1_240,
    happiness: 72, health: 68, education: 54, crimeRate: 22, landValue: 61, pollution: 18,
    demand: { res: 0.62, com: 0.18, ind: -0.12, off: 0.41 },
    power: { produced: 360, consumed: 312 }, water: { produced: 5_600, consumed: 5_900 },
    sewage: { capacity: 6_000, produced: 5_200 }, garbage: { capacity: 2_400, produced: 2_150, stored: 820 },
    health_: { capacity: 900, sick: 610 }, education_: { capacity: 8_000, students: 8_690 }, deathcare: { capacity: 300, dead: 44 },
    trafficFlow: 78, vehicles: 2_140, buildings: w.buildings.size, netIncome: 0, births: 212, deaths: 131, movedIn: 1_240, movedOut: 385,
  });
  w.milestone = 6;
  // history: five years of monthly points
  const hist: HistoryPoint[] = [];
  for (let m = 1; m <= 61; m++) {
    const t = m / 61;
    const pop = Math.round(48_250 / (1 + Math.exp(-9 * (t - 0.55))) + Math.sin(m) * 300);
    hist.push({
      day: m * DAYS_PER_MONTH, population: Math.max(0, pop), money: Math.round(70_000 + Math.sin(m / 5) * 40_000 + t * t * 220_000),
      income: Math.round(pop * 2.3 + 2_000), expenses: Math.round(pop * 1.95 + 4_000 + Math.cos(m / 3) * 3_000),
      happiness: 60 + Math.sin(m / 4) * 8 + t * 6, jobs: Math.round(pop * 0.58), unemployment: 0.04 + Math.abs(Math.sin(m / 7)) * 0.06,
      crime: 30 - t * 10 + Math.sin(m / 2) * 3, pollution: 12 + t * 8, landValue: 30 + t * 30, trafficFlow: 92 - t * 16 + Math.sin(m) * 3,
      demandRes: Math.sin(m / 6) * 0.6, demandCom: Math.cos(m / 5) * 0.4, demandInd: Math.sin(m / 9 + 1) * 0.5, demandOff: t * 0.6 - 0.1,
    });
  }
  w.history = hist;
  w.time = { day: 61 * DAYS_PER_MONTH + 14.3, hour: 17.6, speed: q.get('paused') ? 0 : 1 };
  w.weather = { type: 'cloudy', intensity: 0.4, temperature: 17.4, windDir: 2.1, windSpeed: 6.2, snowCover: 0, nextChange: 3 };
  // districts, lines, policies
  w.districts = [
    { id: 1, name: 'Old Harbour', color: '#ff9f43', style: 'mediterranean', policies: ['recycling'], specialization: 'tourism' },
    { id: 2, name: 'Northgate', color: '#4cc2ff', style: null, policies: [] },
    { id: 3, name: 'Foundry Row', color: '#b98cff', style: 'artdeco', policies: ['smoke_detectors', 'recycling'], specialization: 'hightech' },
  ];
  for (let y = 92; y < 130; y++) for (let x = 96; x < 140; x++) w.district[w.idx(x, y)] = 2;
  for (let y = 140; y < 176; y++) for (let x = 150; x < 190; x++) w.district[w.idx(x, y)] = 3;
  w.transitLines = [
    { id: 1, mode: 'bus', name: 'Line 1 · Harbour Loop', color: '#29b6f6', stops: [{ x: 110, y: 110 }, { x: 150, y: 110 }, { x: 150, y: 150 }, { x: 110, y: 150 }], vehicles: 6, active: true, ridership: 18_420 },
    { id: 2, mode: 'tram', name: 'Tram A · Central', color: '#ffb300', stops: [{ x: 114, y: 128 }, { x: 132, y: 128 }, { x: 168, y: 128 }], vehicles: 4, active: true, ridership: 26_110 },
    { id: 3, mode: 'bus', name: 'Line 7 · Northgate', color: '#e53935', stops: [{ x: 100, y: 96 }, { x: 130, y: 96 }], vehicles: 2, active: false, ridership: 1_320 },
  ];
  w.policies = ['recycling', 'free_clinics'];
  w.achievements = [];
  const notices: [Parameters<World['notify']>[0], number][] = [
    [{ kind: 'good', title: 'Welcome to Port Aurelia!', text: 'Connect a road to the highway, zone some land, and provide power and water.', icon: '🏙️', x: 143, y: 134 }, 2],
    [{ kind: 'milestone', title: 'Small City reached', text: 'Trams, universities and disaster services are now available.', icon: '🏆' }, 1500],
    [{ kind: 'warning', title: 'Water shortage', text: 'Demand for fresh water exceeds what your pumps can deliver.', icon: '💧' }, 1820],
    [{ kind: 'chirp', title: '', author: 'Maya Lindqvist', text: 'The new tram line is SO smooth. Got to work in 12 minutes today 🚋 #PortAurelia', icon: '🐦' }, 1826],
    [{ kind: 'event', title: 'Harbour Festival', text: 'Lanterns, food stalls and fireworks along the waterfront. Tourism is booming this week!', icon: '🎆', x: 120, y: 170 }, 1828],
  ];
  for (const [nn, day] of notices) {
    w.time.day = day;
    w.notify(nn);
  }
  w.time.day = 61 * DAYS_PER_MONTH + 14.3;
  if (q.get('tutorial')) {
    // a brand-new city for the checklist
    w.stats.population = 120;
    w.buildings.clear();
    w.bldg.fill(0);
    w.zone.fill(0);
  }
  return w;
}

// ── fake game ──────────────────────────────────────────────────────────────
type Patch = { [k: string]: unknown };
function deepMerge(t: Patch, p: Patch): void {
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) deepMerge(t[k] as Patch, v as Patch);
    else t[k] = v;
  }
}

function keyLabel(code: string): string {
  return code.split('+').map((p) => p.replace(/^Key/, '').replace(/^Digit/, '').replace('Escape', 'Esc').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Slash', '/').replace('Equal', '=').replace('Minus', '-').replace('ShiftLeft', 'Shift')).join('+');
}

function makeGame(world: World): Game {
  const events = new EventBus<GameEvents>();
  world.bus = events;
  const settings = {
    value: defaultSettings() as Settings,
    set(patch: Patch) {
      deepMerge(this.value as unknown as Patch, patch);
      events.emit('settings:changed', this.value);
    },
  };
  const handlers = new Map<ActionId, (() => void)[]>();
  const input = {
    enabled: true,
    onAction(a: ActionId, fn: () => void) {
      const l = handlers.get(a) ?? [];
      l.push(fn);
      handlers.set(a, l);
      return () => undefined;
    },
    bindingLabel(a: ActionId) {
      const b = settings.value.controls.keybinds[a]?.[0] ?? DEFAULT_KEYBINDS[a]?.[0];
      return b ? keyLabel(b) : '';
    },
  };
  let toolCur: { id: string; hint(): string } | null = null;
  let toolOpts: unknown;
  const tools = {
    get current() {
      return toolCur;
    },
    get currentOpts() {
      return toolOpts;
    },
    setTool(id: string | null, opts?: unknown) {
      if (id && toolCur?.id === id && JSON.stringify(opts) === JSON.stringify(toolOpts)) id = null;
      toolCur = id ? { id, hint: () => (id === 'road' ? '14 cells · $840 · 2 bridges' : id === 'place' ? '$6,500 · R to rotate' : id === 'zone' ? 'Brush 3 · 42 cells' : '') } : null;
      toolOpts = id ? opts : undefined;
      events.emit('tool:changed', id);
    },
    cancel() {
      this.setTool(null);
    },
    get hint() {
      return toolCur?.hint() ?? '';
    },
  };
  const focus = { x: 143, y: 134 };
  const cameraCtl = {
    focus, yaw: Math.PI * 0.25, pitch: 0.85, distance: 900,
    flyTo(x: number, y: number) {
      focus.x = x;
      focus.y = y;
      drawBackground(world, focus);
    },
    follow() {},
    reset() {
      this.flyTo(world.home.x, world.home.y);
    },
  };
  const renderer = {
    overlay: null as FieldId | null,
    cameraCtl,
    camera: { fov: 50, get aspect() { return innerWidth / innerHeight; } },
    stats: { fps: 60, frameMs: 11.8, drawCalls: 412, triangles: 1_840_000 },
    setOverlay(f: FieldId | null) {
      this.overlay = f;
      events.emit('overlay:changed', f);
    },
  };
  const policyList = (d?: number) => (d ? world.districts.find((x) => x.id === d)?.policies ?? [] : world.policies);
  const sim = {
    setSpeed(l: number) {
      world.time.speed = l;
      events.emit('time:speed', l);
    },
    togglePause() {
      this.setSpeed(world.time.speed === 0 ? 1 : 0);
    },
    setHour(h: number) {
      world.time.hour = h;
    },
    setTax(c: TaxCategory, v: number) {
      world.economy.taxes[c] = v;
    },
    setBudget(c: BudgetCategory, v: number) {
      world.economy.budgets[c] = v;
    },
    takeLoan(amount: number, years: number) {
      if (world.economy.loans.length >= 3) return false;
      const r = 0.07 / 12, n = years * 12;
      world.economy.loans.push({ id: Date.now(), amount, rate: 0.07, remaining: amount, payment: (amount * r) / (1 - Math.pow(1 + r, -n)), takenDay: world.time.day });
      world.economy.money += amount;
      return true;
    },
    repayLoan(id: number) {
      const l = world.economy.loans.find((x) => x.id === id);
      if (!l || world.economy.money < l.remaining) return false;
      world.economy.money -= l.remaining;
      world.economy.loans = world.economy.loans.filter((x) => x !== l);
      return true;
    },
    projection() {
      const e = world.economy;
      const income: Record<string, number> = {};
      for (const [k, v] of Object.entries(e.lastIncome)) income[k] = k in e.taxes ? v * (e.taxes[k as TaxCategory] / 0.09) : v;
      const expense: Record<string, number> = {};
      for (const [k, v] of Object.entries(e.lastExpense)) expense[k] = k in e.budgets ? v * (e.budgets[k as BudgetCategory] ?? 1) : v;
      return { income, expense };
    },
    togglePolicy(id: string, d?: number) {
      const list = policyList(d);
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.push(id);
      return true;
    },
    isPolicyActive(id: string, d?: number) {
      return policyList(d).includes(id);
    },
    buildingInfo(id: number): BuildingInfo | null {
      const b = world.getBuilding(id);
      if (!b || b.kind !== 'zoned' || zoneDef(b.zone)?.category !== 'res') return null;
      return {
        title: `${b.name ?? '14 Linden Row'}`, subtitle: `${zoneDef(b.zone)!.name} · European`, icon: zoneDef(b.zone)!.icon,
        lines: [
          { label: 'Residents', value: `${b.residents} / ${b.maxResidents}`, bar: b.residents / Math.max(1, b.maxResidents) },
          { label: 'Happiness', value: `${Math.round(b.happiness)}%`, bar: b.happiness / 100, kind: 'good' },
          { label: 'Health', value: `${Math.round(b.health)}%`, bar: b.health / 100 },
          { label: 'Education', value: `${Math.round(b.education)}%`, bar: b.education / 100 },
          { label: 'Land value', value: '$182 / m²', bar: 0.72, kind: 'good' },
          { label: 'Rent', value: '$1,240 / month' },
          { label: 'Tax paid', value: '$86 / month', kind: 'good' },
        ],
        people: [
          { name: 'Maya Lindqvist', detail: 'Software engineer · works at Harbour Tech' },
          { name: 'Tomás Ferreira', detail: 'Student · Aurelia University' },
          { name: 'Olu Adeyemi', detail: 'Nurse · Central Clinic' },
        ],
        problems: b.problems ? ['🗑️ Garbage is piling up', '🔊 Too noisy — near an avenue'] : [],
      };
    },
  };
  const traffic = {
    vehicleCount: 2_140,
    vehicleInfo(id: number) {
      const t = performance.now() / 1000;
      return { id, type: 'bus' as const, x: (130 + Math.sin(t / 5) * 10) * 16, y: 12, z: 128 * 16, heading: 1.57, speed: 11.4, label: 'Bus 14 · Line 1', fromBuilding: [...world.buildings.keys()][4], toBuilding: [...world.buildings.keys()][30] };
    },
    updateLine(id: number, patch: Partial<TransitLine>) {
      const l = world.transitLines.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
    },
    removeLine(id: number) {
      world.transitLines = world.transitLines.filter((x) => x.id !== id);
    },
  };
  const actions = {
    buildingName(b: Building) {
      if (b.name) return b.name;
      if (b.kind === 'service') return buildingDef(b.defId)?.name ?? 'Building';
      return `${zoneDef(b.zone)?.name ?? 'Zoned'} building`;
    },
    refundFor(id: number) {
      const b = world.getBuilding(id);
      return b?.kind === 'service' ? Math.round((buildingDef(b.defId)?.cost ?? 0) * 0.2) : 0;
    },
    bulldozeBuilding(id: number) {
      world.removeBuilding(id);
      return { ok: true, cost: 0 };
    },
    createDistrict(name?: string): District {
      const id = Math.max(0, ...world.districts.map((d) => d.id)) + 1;
      const d: District = { id, name: name ?? `District ${id}`, color: '#3ddc84', style: null, policies: [] };
      world.districts.push(d);
      return d;
    },
    updateDistrict(id: number, patch: Partial<District>) {
      const d = world.districts.find((x) => x.id === id);
      if (d) Object.assign(d, patch);
      return !!d;
    },
    deleteDistrict(id: number) {
      world.districts = world.districts.filter((d) => d.id !== id);
    },
  };
  const game = {
    events, settings, input, tools, renderer, sim, traffic, actions, world,
    buildings: { highlight() {} },
    zones: { setDistrictsVisible() {} },
    menus: { isOpen: () => false, openPause: () => ui.toast('Pause menu (other module)', 'info') },
    chat: { isOpen: false },
    audio: { play() {} },
    fps: 58.6,
    async downloadScreenshot() {
      ui.toast('Screenshot saved', 'good');
    },
  } as unknown as Game;
  const ui = new UIManager(game, document.getElementById('ui')!);
  (game as unknown as { ui: UIManager }).ui = ui;
  // keyboard → actions (subset of the real InputManager)
  window.addEventListener('keydown', (e) => {
    if (!input.enabled) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const combo = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey && e.code !== 'ShiftLeft' ? 'Shift+' : ''}${e.code}`;
    for (const [a, list] of handlers) {
      const binds = settings.value.controls.keybinds[a] ?? [];
      if (binds.includes(combo)) {
        e.preventDefault();
        for (const fn of list) fn();
      }
    }
    if (e.code === 'Escape') {
      if (tools.current) tools.cancel();
      else ui.closePanels();
    }
    if (e.code === 'Space') sim.togglePause();
    if (e.code === 'F3') settings.set({ graphics: { showFps: !settings.value.graphics.showFps } });
  });
  return game;
}

// ── painted background (stand-in for the 3D view) ─────────────────────────
function drawBackground(w: World, focus: { x: number; y: number }): void {
  const cv = document.getElementById('bg') as HTMLCanvasElement;
  const W = innerWidth, H = innerHeight;
  cv.width = W;
  cv.height = H;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const c = cv.getContext('2d')!;
  const px = 7;
  const ox = W / 2 - focus.x * px, oy = H / 2 - focus.y * px;
  const img = c.createImageData(W, H);
  const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const t = w.theme;
  const grass = hex(t.grass), deep = hex(t.waterDeep), shallow = hex(t.waterShallow), forest = [38, 74, 40];
  for (let sy = 0; sy < H; sy++)
    for (let sx = 0; sx < W; sx++) {
      const cx = Math.floor((sx - ox) / px), cy = Math.floor((sy - oy) / px);
      let col = [20, 28, 36];
      if (w.inBounds(cx, cy)) {
        const i = cy * w.size + cx;
        const shade = 1 + (w.vertexHeight(cx, cy) - w.vertexHeight(cx + 1, cy + 1)) * 0.05;
        if (w.isWater(cx, cy)) col = mix(shallow, deep, Math.min(1, w.waterDepth(cx, cy) / 10));
        else if (w.road[i]) col = w.road[i] === RoadType.Highway ? [70, 72, 78] : w.road[i] === RoadType.Rail ? [96, 88, 80] : [58, 61, 67];
        else if (w.bldg[i]) {
          const b = w.buildings.get(w.bldg[i])!;
          const base = b.kind === 'service' ? [214, 208, 196] : hex(zoneDef(b.zone)?.color ?? '#888888');
          const lx = (sx - ox) / px - b.x, ly = (sy - oy) / px - b.y;
          const edge = lx < 0.18 || ly < 0.18 || lx > b.w - 0.18 || ly > b.h - 0.18;
          col = mix(mix(base, [235, 230, 222], 0.55), [0, 0, 0], edge ? 0.35 : 0.04 * b.level);
        } else {
          col = grass.map((v) => v * shade);
          if (w.trees[i]) col = mix(col, forest, 0.25 + w.trees[i] * 0.18);
          if (w.zone[i]) col = mix(col, hex(zoneDef(w.zone[i])?.color ?? '#888888'), 0.25);
        }
        // soft building shadow to the south-east
        const sb = w.bldg[w.idx(Math.max(0, cx - 1), Math.max(0, cy - 1))];
        if (!w.bldg[i] && sb && !w.road[i]) col = col.map((v) => v * 0.72);
      }
      const o = (sy * W + sx) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  // atmospheric vignette + warm evening light
  const g = c.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H / 2, H);
  g.addColorStop(0, 'rgba(255,190,120,0.05)');
  g.addColorStop(1, 'rgba(0,0,10,0.55)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}
function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ── boot ────────────────────────────────────────────────────────────────
const world = makeWorld();
(window as unknown as { __w: World }).__w = world;
const game = makeGame(world);
drawBackground(world, { x: 143, y: 134 });
const ui = game.ui;
ui.init();
ui.setScale(Number(q.get('scale') ?? 1));
if (q.get('perf')) game.settings.set({ graphics: { showFps: true } });
if (q.get('nominimap')) game.settings.set({ ui: { minimap: false } });
ui.onWorldLoaded(world);
game.events.emit('world:loaded', world);
world.flushChanges();

let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  const mult = SPEEDS[world.time.speed] ?? 0;
  if (!q.get('frozen')) {
    world.time.day += (dt * mult) / REAL_SECONDS_PER_DAY;
    world.time.hour = (world.time.hour + (dt * mult * 24) / (8 * 60)) % 24;
  }
  world.flushChanges();
  ui.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── scenario params ───────────────────────────────────────────────────────
const after = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
const firstOf = (pred: (b: Building) => boolean) => [...world.buildings.values()].find(pred);
after(200, () => {
  const panel = q.get('panel');
  if (panel) ui.openPanel(panel as Parameters<UIManager['openPanel']>[0], q.get('page') ?? (q.get('district') ? Number(q.get('district')) : undefined));
  const fly = q.get('fly');
  if (fly) ui.toolbar.open(fly as Parameters<UIManager['toolbar']['open']>[0]);
  const tool = q.get('tool');
  if (tool === 'road') game.tools.setTool('road', { type: RoadType.Street });
  if (tool === 'place') game.tools.setTool('place', { defId: 'clinic' });
  if (tool === 'zone') game.tools.setTool('zone', { zone: ZoneType.ResLow, zoneId: 'res_low', mode: 'brush' });
  if (q.get('inspect')) {
    const b = q.get('inspect') === 'service' ? firstOf((x) => x.kind === 'service') : firstOf((x) => x.kind === 'zoned' && zoneDef(x.zone)?.category === 'res' && x.problems !== 0) ?? firstOf((x) => x.kind === 'zoned');
    if (b) ui.openBuildingInfo(b.id);
  }
  if (q.get('vehicle')) game.events.emit('select', { vehicleId: 7 });
  const ov = q.get('overlay');
  if (ov) game.renderer.setOverlay(ov as FieldId);
  if (q.get('photo')) ui.setPhotoMode(true);
  if (q.get('more')) ui.toggleMore();
  if (q.get('dialog')) void ui.confirmEx('Demolish Central Clinic?', 'You will get $1,300 back. Patients will be sent to the nearest hospital.', { danger: true, ok: 'Demolish', icon: '🚜' });
  if (q.get('prompt')) void ui.prompt('Rename district', 'Old Harbour');
  if (q.get('search')) {
    ui.openPanel('search');
    after(100, () => {
      const inp = document.querySelector<HTMLInputElement>('.hud-search-input');
      if (inp) {
        inp.value = q.get('search')!;
        inp.dispatchEvent(new Event('input'));
      }
    });
  }
  if (q.get('toasts')) {
    const n = (x: Parameters<World['notify']>[0]) => world.notify(x);
    n({ kind: 'danger', title: 'Fire in Northgate!', text: 'A blaze broke out at 14 Linden Row. Fire trucks are on the way.', icon: '🔥', buildingId: [...world.buildings.keys()][12] });
    after(150, () => n({ kind: 'chirp', title: '', author: 'Maya Lindqvist', text: 'Whoever designed the new boulevard: thank you. Best evening walk in town 🌳✨', icon: '🐦' }));
    after(300, () => n({ kind: 'warning', title: 'Garbage piling up', text: 'Landfill capacity is at 92%. Build an incinerator or recycling center.', icon: '🗑️', x: 180, y: 160 }));
    after(450, () => ui.toast('Loan of $150,000 approved', 'good'));
  }
  if (q.get('milestone')) game.events.emit('milestone', MILESTONES[7]);
  if (q.get('achievement')) game.events.emit('achievement', { id: 'first', name: 'Gridlock Buster', description: 'Keep traffic flow above 85% with 50,000 citizens.', icon: '🚦' });
  if (q.get('debt')) world.economy.money = -12_400;
  if (q.get('policy')) for (const p of POLICIES.slice(0, 2)) if (!world.policies.includes(p.id)) world.policies.push(p.id);
});
