// Building inspector content: rich stat lines with bars, problems as text and
// a deterministic list of the people who live or work there.
import { BFlag, Problem, type Building, type BuildingDef, type FieldId } from '../core/types';
import { hashFloat } from '../core/rng';
import { CELL } from '../core/constants';
import { formatMoney, formatNumber } from '../core/util';
import { CATEGORY_INFO } from '../data/buildings';
import { OCCUPATIONS, firstName, lastName, personName, pickName } from '../data/names';
import { zoneDef } from '../data/zones';
import type { BuildingInfo, InfoLine } from './Simulation';
import type { SimContext } from './context';
import { budgetCategoryOf, defOf, isCrematorium, isGarbageProcessor } from './catalog';
import { powerUse, sewageUse, waterUse } from './consumption';
import { LEVEL_BLOCK_TEXT, LevelBlock } from './lifecycle';
import { buildingTitle } from './naming';
import { perkOf } from './perks';
import { isHousing, needsWater, serviceBuildDays } from './services';
import { bsim } from './state';
import { ABANDON_DISTRESS, BURNED_CLEAR_DAYS, HOUSEHOLD_SIZE, LEVEL_UP_DAYS, LEVEL_UP_DAYS_PER_LEVEL, RUBBLE_CLEAR_DAYS } from './tuning';
import { zoneMeta } from './zonemeta';

const PROBLEM_TEXT: [number, string][] = [
  [Problem.Fire, 'On fire!'],
  [Problem.Flooded, 'Flooded'],
  [Problem.NoRoad, 'No road access'],
  [Problem.NoPower, 'No electricity — connect it to the power grid'],
  [Problem.NoWater, 'No running water'],
  [Problem.NoSewage, 'Sewage is not being drained'],
  [Problem.Dead, 'Waiting for a hearse'],
  [Problem.Sick, 'Residents are sick and untreated'],
  [Problem.Garbage, 'Garbage is piling up'],
  [Problem.Crime, 'High crime in the area'],
  [Problem.NoWorkers, 'Not enough workers'],
  [Problem.NoEducated, 'Not enough educated workers'],
  [Problem.NoCustomers, 'Not enough customers'],
  [Problem.NoGoods, 'Not enough goods to sell'],
  [Problem.Pollution, 'Polluted surroundings'],
  [Problem.Noise, 'Too noisy'],
  [Problem.Traffic, 'Traffic jams keep customers and deliveries away'],
  [Problem.HighRent, 'Rent too high for this building'],
  [Problem.LowHappiness, 'Residents are unhappy'],
  [Problem.Abandoned, 'Abandoned'],
];

const COVERAGE: { field: FieldId; label: string; cat: 'police' | 'fire' | 'health' | 'education' | 'garbage' | 'parks' | 'deathcare' | 'transit' }[] = [
  { field: 'police', label: 'Police', cat: 'police' },
  { field: 'fire', label: 'Fire protection', cat: 'fire' },
  { field: 'health', label: 'Healthcare', cat: 'health' },
  { field: 'education', label: 'Education', cat: 'education' },
  { field: 'garbage', label: 'Garbage pickup', cat: 'garbage' },
  { field: 'leisure', label: 'Parks & leisure', cat: 'parks' },
  { field: 'deathcare', label: 'Deathcare', cat: 'deathcare' },
  { field: 'transit', label: 'Public transport', cat: 'transit' },
];

const SERVICE_JOBS: Partial<Record<string, readonly string[]>> = {
  health: ['Doctor', 'Nurse', 'Paramedic', 'Surgeon', 'Pharmacist', 'Radiologist', 'Receptionist'],
  deathcare: ['Funeral director', 'Groundskeeper', 'Hearse driver', 'Chaplain'],
  education: ['Teacher', 'Professor', 'Librarian', 'Principal', 'Lab assistant', 'Counsellor'],
  police: ['Police officer', 'Detective', 'Sergeant', 'Dispatcher', 'Forensics expert'],
  fire: ['Firefighter', 'Fire captain', 'Paramedic', 'Engine driver'],
  garbage: ['Garbage truck driver', 'Sorter', 'Plant operator', 'Mechanic'],
  power: ['Plant engineer', 'Technician', 'Control room operator', 'Electrician'],
  water: ['Water engineer', 'Pump technician', 'Chemist', 'Pipe fitter'],
  transit: ['Bus driver', 'Conductor', 'Mechanic', 'Station agent', 'Dispatcher'],
  parks: ['Gardener', 'Ranger', 'Lifeguard', 'Groundskeeper'],
  plazas: ['Gardener', 'Street cleaner'],
  government: ['Civil servant', 'Clerk', 'Planner', 'Postal worker'],
  disaster: ['Emergency coordinator', 'Rescue worker', 'Meteorologist'],
  landmark: ['Tour guide', 'Curator', 'Security guard', 'Ticket seller'],
  monument: ['Tour guide', 'Engineer', 'Security guard', 'Curator'],
  tourism: ['Receptionist', 'Concierge', 'Chef', 'Housekeeper', 'Entertainer'],
  industry: ['Operator', 'Engineer', 'Logistics planner', 'Forklift driver'],
};

/** fields whose positive effects are a service coverage (shown as the coverage radius) */
const COVERAGE_FIELDS = new Set<FieldId>(['police', 'fire', 'health', 'education', 'leisure', 'garbage', 'deathcare', 'transit', 'tourism']);

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const bar = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const goodBad = (v01: number, invert = false): 'good' | 'bad' | 'neutral' => {
  const v = invert ? 1 - v01 : v01;
  return v >= 0.6 ? 'good' : v < 0.3 ? 'bad' : 'neutral';
};

export function formatAge(days: number): string {
  const d = Math.max(0, Math.floor(days));
  const y = Math.floor(d / 360), m = Math.floor((d % 360) / 30);
  if (y > 0) return `${y} year${y > 1 ? 's' : ''}${m ? `, ${m} month${m > 1 ? 's' : ''}` : ''}`;
  if (m > 0) return `${m} month${m > 1 ? 's' : ''}`;
  return `${d} day${d === 1 ? '' : 's'}`;
}

export function problemTexts(b: Building, def?: BuildingDef): string[] {
  const out: string[] = [];
  for (const [bit, text] of PROBLEM_TEXT) {
    if (!(b.problems & bit)) continue;
    if (def && bit === Problem.Garbage && def.category === 'garbage') out.push('Landfill is full — build a new one');
    else if (def && bit === Problem.Dead && def.category === 'deathcare') out.push('Cemetery is full');
    else out.push(text);
  }
  return out;
}

/** Deterministic citizen names for a building (households share a surname). */
export function citizenNames(b: Building, count: number): string[] {
  const n = Math.max(0, Math.min(count, 500));
  const out: string[] = [];
  if (b.kind === 'zoned' && zoneMeta(b.zone)?.cat === 'res') {
    for (let i = 0; i < n; i++) {
      const hh = Math.floor(i / HOUSEHOLD_SIZE);
      out.push(`${firstName(b.seed, i * 7 + 3)} ${lastName(b.seed, hh)}`);
    }
  } else {
    for (let i = 0; i < n; i++) out.push(personName(b.seed ^ 0x5f3759df, i));
  }
  return out;
}

function peopleOf(ctx: SimContext, b: Building): { name: string; detail: string }[] {
  const people: { name: string; detail: string }[] = [];
  const r = ctx.state.rates;
  const m = b.kind === 'zoned' ? zoneMeta(b.zone) : undefined;
  if (m?.cat === 'res' && b.residents > 0) {
    const shown = Math.min(8, b.residents);
    const names = citizenNames(b, shown);
    for (let i = 0; i < shown; i++) {
      const slot = i % 3; // household: two adults and a child / student
      const h = hashFloat(b.seed, i, 77);
      let age: number, job: string;
      if (slot === 2 && h < 0.6) {
        age = 3 + Math.floor(h * 25);
        job = age < 6 ? pickName(OCCUPATIONS.child, b.seed, i) : age < 18 ? 'Pupil' : pickName(OCCUPATIONS.student, b.seed, i);
      } else {
        age = 22 + Math.floor(hashFloat(b.seed, i, 78) * 62);
        if (age >= 67) job = pickName(OCCUPATIONS.retired, b.seed, i);
        else if (hashFloat(b.seed, i, 79 + Math.floor(ctx.world.time.day / 60)) < r.unemployment) job = 'Looking for work';
        else job = pickName(OCCUPATIONS.res, b.seed, i);
      }
      people.push({ name: names[i], detail: `${age} · ${job}` });
    }
  } else if (b.workers > 0) {
    const shown = Math.min(6, b.workers);
    const names = citizenNames(b, shown);
    let list: readonly string[] = OCCUPATIONS.svc;
    if (m) {
      list = m.raw === 'farm' ? OCCUPATIONS.farm : m.raw === 'forest' ? OCCUPATIONS.forest : m.raw === 'mine' ? OCCUPATIONS.mine : m.raw === 'oil' ? OCCUPATIONS.oil
        : m.jobCat === 'com' ? OCCUPATIONS.com : m.jobCat === 'ind' ? OCCUPATIONS.ind : OCCUPATIONS.off;
    } else {
      const def = defOf(b.defId);
      list = (def && SERVICE_JOBS[def.category]) || OCCUPATIONS.svc;
    }
    for (let i = 0; i < shown; i++) {
      const age = 19 + Math.floor(hashFloat(b.seed, i, 91) * 46);
      people.push({ name: names[i], detail: `${age} · ${pickName(list, b.seed, i + 1)}` });
    }
  }
  return people;
}

function coverageLines(ctx: SimContext, b: Building, lines: InfoLine[]): void {
  const w = ctx.world;
  const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
  for (const c of COVERAGE) {
    if (c.cat === 'transit') {
      if (!w.transitLines.some((l) => l.active)) continue;
    } else if (c.cat !== 'parks' && !ctx.unlocked(c.cat as 'police')) continue;
    const v = w.field(c.field, cx, cy);
    lines.push({ label: c.label, value: v >= 150 ? 'Excellent' : v >= 90 ? 'Good' : v >= 40 ? 'Fair' : v > 0 ? 'Poor' : 'None', bar: bar(v / 200), kind: goodBad(v / 200) });
  }
}

function environmentLines(ctx: SimContext, b: Building, lines: InfoLine[]): void {
  const w = ctx.world;
  const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
  const lv = w.field('landValue', cx, cy), poll = w.field('pollution', cx, cy), noise = w.field('noise', cx, cy), crime = w.field('crime', cx, cy);
  lines.push({ label: 'Land value', value: formatMoney(Math.round(40 + lv * 6)) + '/m²', bar: bar(lv / 200), kind: goodBad(lv / 200) });
  lines.push({ label: 'Pollution', value: pct(poll / 255), bar: bar(poll / 255), kind: poll > 110 ? 'bad' : poll > 50 ? 'neutral' : 'good' });
  lines.push({ label: 'Noise', value: pct(noise / 255), bar: bar(noise / 255), kind: noise > 160 ? 'bad' : noise > 80 ? 'neutral' : 'good' });
  lines.push({ label: 'Crime', value: pct(crime / 255), bar: bar(crime / 255), kind: crime > 150 ? 'bad' : crime > 70 ? 'neutral' : 'good' });
}

function utilityLines(b: Building, def: BuildingDef | undefined, lines: InfoLine[]): void {
  const p = powerUse(b, def);
  // service buildings that do not depend on running water only list what they produce
  const plumbing = !def || def.water !== undefined || def.sewage !== undefined || needsWater(def);
  const wtr = plumbing ? waterUse(b, def) : Math.min(0, waterUse(b, def));
  const sw = plumbing ? sewageUse(b, def) : Math.min(0, sewageUse(b, def));
  const ok = (f: number) => (b.flags & f) !== 0;
  if (p < 0) lines.push({ label: 'Produces', value: `${formatNumber(-p)} MW`, kind: 'good' });
  else if (p > 0) lines.push({ label: 'Electricity', value: `${p.toFixed(p < 1 ? 2 : 1)} MW ${ok(BFlag.Powered) ? '✓' : '✗'}`, kind: ok(BFlag.Powered) ? 'good' : 'bad' });
  if (wtr < 0) lines.push({ label: 'Pumps', value: `${formatNumber(-wtr)} m³/day`, kind: 'good' });
  else if (wtr > 0) lines.push({ label: 'Water', value: `${wtr.toFixed(wtr < 1 ? 2 : 1)} m³/day ${ok(BFlag.Watered) ? '✓' : '✗'}`, kind: ok(BFlag.Watered) ? 'good' : 'bad' });
  if (sw < 0) lines.push({ label: 'Treats sewage', value: `${formatNumber(-sw)} m³/day`, kind: 'good' });
  else if (sw > 0) lines.push({ label: 'Sewage', value: `${sw.toFixed(sw < 1 ? 2 : 1)} m³/day ${ok(BFlag.Sewered) ? '✓' : '✗'}`, kind: ok(BFlag.Sewered) ? 'good' : 'bad' });
}

export function buildingInfo(ctx: SimContext, id: number): BuildingInfo | null {
  const w = ctx.world;
  const b = w.getBuilding(id);
  if (!b) return null;
  const bs = bsim(b);
  const lines: InfoLine[] = [];
  const title = buildingTitle(b);
  const rubble = (b.flags & (BFlag.Collapsed | BFlag.Burned)) !== 0;

  if (rubble) {
    return {
      title, subtitle: b.flags & BFlag.Burned ? 'Burned ruins' : 'Rubble', icon: '🧱',
      lines: [{ label: 'Status', value: 'Destroyed — waiting to be cleared', kind: 'bad' }, { label: 'Cleared in', value: formatAge(Math.max(0, (b.flags & BFlag.Collapsed ? RUBBLE_CLEAR_DAYS : BURNED_CLEAR_DAYS) - bs.cd)) }],
      problems: [], people: [],
    };
  }

  if (b.kind === 'zoned') {
    const zd = zoneDef(b.zone), m = zoneMeta(b.zone);
    const maxLevel = Math.min(m?.maxLevel ?? 5, ctx.policies.at(b).maxLevel);
    const subtitle = `${zd?.name ?? 'Zoned building'} · Level ${b.level}`;
    if (b.built < 1) {
      lines.push({ label: 'Construction', value: pct(b.built), bar: bar(b.built), kind: 'neutral' });
      lines.push({ label: 'Ready in', value: formatAge(Math.ceil((1 - b.built) * bs.bd)) });
    } else {
      const status = b.flags & BFlag.Abandoned ? `Abandoned (${formatAge(bs.cd)})` : b.flags & BFlag.Upgrading ? 'Upgrading' : b.flags & BFlag.OnFire ? 'On fire!' : 'Occupied';
      lines.push({ label: 'Status', value: status, kind: b.flags & (BFlag.Abandoned | BFlag.OnFire) ? 'bad' : 'good' });
      const days = LEVEL_UP_DAYS + LEVEL_UP_DAYS_PER_LEVEL * (b.level - 1);
      lines.push({ label: 'Level', value: `${b.level} / ${maxLevel}`, bar: b.level >= maxLevel ? 1 : bar(bs.lp), kind: 'good' });
      if (b.level < maxLevel) {
        const eta = bs.lr === LevelBlock.None ? ` · ~${Math.max(1, Math.ceil((1 - bs.lp) * days))} days` : '';
        lines.push({ label: 'Next level', value: (LEVEL_BLOCK_TEXT[bs.lr] ?? '') + eta, kind: bs.lr === LevelBlock.None ? 'good' : 'neutral' });
      }
    }
    if (b.maxResidents > 0) {
      lines.push({ label: 'Residents', value: `${formatNumber(b.residents)} / ${formatNumber(b.maxResidents)}`, bar: bar(b.residents / Math.max(1, b.maxResidents)) });
      lines.push({ label: 'Households', value: formatNumber(Math.ceil(b.residents / HOUSEHOLD_SIZE)) });
    }
    if (b.jobs > 0) {
      lines.push({ label: 'Workers', value: `${formatNumber(b.workers)} / ${formatNumber(b.jobs)}`, bar: bar(b.workers / Math.max(1, b.jobs)), kind: goodBad(b.workers / Math.max(1, b.jobs)) });
      if (m?.jobCat === 'com') {
        lines.push({ label: 'Customers', value: `${formatNumber(b.visitors)} / day` });
        lines.push({ label: 'Goods in stock', value: pct(b.goods / 100), bar: bar(b.goods / 100), kind: goodBad(b.goods / 100) });
      } else if (m?.jobCat === 'ind') {
        lines.push({ label: m.raw ? 'Output exported' : 'Output sold', value: pct(b.goods / 100), bar: bar(b.goods / 100), kind: goodBad(b.goods / 100) });
      }
    }
    if (b.built >= 1) {
      lines.push({ label: 'Happiness', value: pct(b.happiness / 100), bar: bar(b.happiness / 100), kind: goodBad(b.happiness / 100) });
      if (b.maxResidents > 0) {
        lines.push({ label: 'Health', value: pct(b.health / 100), bar: bar(b.health / 100), kind: goodBad(b.health / 100) });
        if (bs.sick > 0) lines.push({ label: 'Sick', value: formatNumber(bs.sick), kind: 'bad' });
      }
      lines.push({ label: 'Education', value: pct(b.education / 100), bar: bar(b.education / 100), kind: goodBad(b.education / 100) });
      environmentLines(ctx, b, lines);
      coverageLines(ctx, b, lines);
      if (b.garbage > 0.5) lines.push({ label: 'Garbage', value: `${b.garbage.toFixed(1)} t`, kind: b.problems & Problem.Garbage ? 'bad' : 'neutral' });
      if (bs.dead > 0) lines.push({ label: 'Awaiting hearse', value: formatNumber(bs.dead), kind: 'bad' });
      utilityLines(b, undefined, lines);
      lines.push({ label: 'Taxes', value: `${formatMoney(bs.tx)} / month` });
      if (b.distress > 0 && !(b.flags & BFlag.Abandoned)) lines.push({ label: 'Distress', value: pct(Math.min(1, b.distress / ABANDON_DISTRESS)), bar: bar(b.distress / ABANDON_DISTRESS), kind: 'bad' });
      lines.push({ label: 'Age', value: formatAge(b.age) });
    }
    return { title, subtitle, icon: zd?.icon ?? '🏠', lines, people: peopleOf(ctx, b), problems: problemTexts(b) };
  }

  // ── service building ─────────────────────────────────────────────────────
  const def = defOf(b.defId);
  const catName = def ? CATEGORY_INFO[def.category]?.name ?? def.category : 'Service';
  const subtitle = `${catName}${def?.group ? ' · ' + def.group : ''}`;
  if (!def) return { title, subtitle, icon: '🏢', lines: [{ label: 'Status', value: 'Unknown building type' }], problems: [], people: [] };
  const budgetCat = budgetCategoryOf(def.category);
  const budget = w.economy.budgets[budgetCat] ?? 1;
  const disabled = (b.flags & BFlag.Disabled) !== 0;
  if (b.built < 1) {
    lines.push({ label: 'Construction', value: pct(b.built), bar: bar(b.built) });
    lines.push({ label: 'Ready in', value: formatAge(Math.ceil((1 - b.built) * serviceBuildDays(def))) });
  } else {
    const status = disabled ? 'Switched off' : b.flags & BFlag.OnFire ? 'On fire!' : b.problems & Problem.NoPower ? 'No power' : b.efficiency >= 0.95 ? 'Operating normally' : 'Operating (reduced)';
    lines.push({ label: 'Status', value: status, kind: disabled || b.problems & (Problem.NoPower | Problem.Fire) ? 'bad' : 'good' });
    lines.push({ label: 'Efficiency', value: pct(b.efficiency), bar: bar(b.efficiency / 1.5), kind: goodBad(b.efficiency) });
  }
  if (b.jobs > 0) lines.push({ label: 'Workers', value: `${formatNumber(b.workers)} / ${formatNumber(b.jobs)}`, bar: bar(b.workers / b.jobs), kind: goodBad(b.workers / b.jobs) });
  const cap = def.capacity ?? 0;
  if (cap > 0 && isHousing(def)) {
    lines.push({ label: 'Residents', value: `${formatNumber(b.residents)} / ${formatNumber(cap)}`, bar: bar(b.residents / cap) });
    lines.push({ label: 'Households', value: formatNumber(Math.ceil(b.residents / HOUSEHOLD_SIZE)) });
    lines.push({ label: 'Happiness', value: pct(b.happiness / 100), bar: bar(b.happiness / 100), kind: goodBad(b.happiness / 100) });
    lines.push({ label: 'Education', value: pct(b.education / 100), bar: bar(b.education / 100), kind: goodBad(b.education / 100) });
  } else if (cap > 0) {
    const label = def.capacityLabel ?? 'Capacity';
    if (def.category === 'garbage' && !isGarbageProcessor(def)) {
      lines.push({ label: 'Filled', value: `${formatNumber(bs.st)} / ${formatNumber(cap)} ${label}`, bar: bar(bs.st / cap), kind: bs.st / cap > 0.9 ? 'bad' : 'neutral' });
    } else if (def.category === 'deathcare' && !isCrematorium(def)) {
      lines.push({ label: 'Graves used', value: `${formatNumber(bs.st)} / ${formatNumber(cap)}`, bar: bar(bs.st / cap), kind: bs.st / cap > 0.9 ? 'bad' : 'neutral' });
    } else {
      lines.push({ label: 'In use', value: `${formatNumber(b.visitors)} / ${formatNumber(Math.round(cap * Math.max(0, b.efficiency)))} ${label}`, bar: bar(b.visitors / Math.max(1, cap * b.efficiency)) });
    }
  }
  const radius = def.effects?.reduce((mx, e) => (e.amount > 0 && COVERAGE_FIELDS.has(e.field) ? Math.max(mx, e.radius) : mx), 0) ?? 0;
  if (radius > 0) lines.push({ label: 'Coverage radius', value: `${radius} cells (${radius * CELL} m)` });
  const emits = def.effects?.filter((e) => e.amount > 0 && (e.field === 'pollution' || e.field === 'noise')) ?? [];
  for (const e of emits) lines.push({ label: e.field === 'pollution' ? 'Pollutes' : 'Noise', value: `within ${e.radius} cells`, kind: 'bad' });
  utilityLines(b, def, lines);
  if (def.vehicles) lines.push({ label: 'Vehicles', value: `${def.vehicles.count} ${def.vehicles.type === 'service' ? 'service vehicles' : def.vehicles.type + (def.vehicles.count > 1 ? 's' : '')}` });
  if ((def.category === 'tourism' || def.category === 'landmark' || def.category === 'monument') && b.visitors > 0 && !isHousing(def)) {
    lines.push({ label: 'Visitors', value: `${formatNumber(b.visitors * 30)} / month` });
  }
  const perk = perkOf(def);
  if (perk) for (const t of perk.text) lines.push({ label: 'City-wide', value: t, kind: b.efficiency > 0 && b.built >= 1 ? 'good' : 'neutral' });
  lines.push({ label: 'Budget', value: pct(budget), kind: budget < 0.8 ? 'bad' : budget > 1.1 ? 'good' : 'neutral' });
  lines.push({ label: 'Upkeep', value: `${formatMoney(def.upkeep * (disabled ? 0.25 : budget))} / month` });
  if (b.built >= 1) lines.push({ label: 'Age', value: formatAge(b.age) });
  return { title, subtitle, icon: def.icon, lines, people: peopleOf(ctx, b), problems: problemTexts(b, def) };
}

