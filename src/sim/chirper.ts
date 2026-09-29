// Chirper: citizens react to the state of the city on a social feed. At most
// one chirp every CHIRP_MIN_GAP..CHIRP_MAX_GAP days; queued reactions (new
// services, milestones, disasters, policies) go first, otherwise a topic is
// drawn by weight from what is happening, with per-topic cooldowns and no
// template repeats in the recent history.
import { Problem, RoadType, type Building } from '../core/types';
import { hash2, hashString } from '../core/rng';
import { formatNumber, formatPercent } from '../core/util';
import { calendar, isNight } from '../core/time';
import { STREET_WORDS, handleOf, personName, pickName } from '../data/names';
import { defOf } from './catalog';
import { buildingTitle } from './naming';
import type { SimContext } from './context';
import { CHIRPS, CHIRP_ICONS } from './chirps';
import { frontRoadIndex } from './lot';
import { CHIRP_MAX_GAP, CHIRP_MIN_GAP } from './tuning';

interface Candidate {
  topic: string;
  weight: number;
  vars?: Record<string, string>;
  target?: Building;
}

const COOLDOWN: Record<string, number> = {
  generic: 4, night: 8, weather_rain: 10, weather_snow: 12, weather_heat: 12, weather_storm: 10, weather_fog: 14, weather_clear: 14,
  season_spring: 60, season_summer: 60, season_autumn: 60, season_winter: 60, first_home: 25, growth: 18,
};
const DEFAULT_COOLDOWN = 20;

/** A plausible street name for a building (road type decides the suffix). */
export function streetName(ctx: SimContext, b: Building | undefined): string {
  if (!b) return `${pickName(STREET_WORDS, ctx.world.settings.seed, 1)} Street`;
  const w = ctx.world;
  const ri = frontRoadIndex(w, b);
  const t = w.road[ri] as RoadType;
  const rx = ri % w.size, ry = (ri / w.size) | 0;
  // street names are stable along a road: hash coarse coordinates of the road cell
  const key = hash2(Math.floor(rx / 12) * 131 + (b.rot & 1), Math.floor(ry / 12) * 71 + (b.rot & 1) * 7);
  const word = pickName(STREET_WORDS, key, w.settings.seed);
  const suffix = t === RoadType.Avenue || t === RoadType.TramAvenue ? 'Avenue' : t === RoadType.Boulevard ? 'Boulevard' : t === RoadType.Pedestrian ? 'Promenade' : t === RoadType.Dirt ? 'Lane' : pickName(['Street', 'Road', 'Way', 'Street', 'Drive'], key, 3);
  return `${word} ${suffix}`;
}

export class Chirper {
  constructor(private ctx: SimContext) {}

  /** queue a reaction to something that just happened */
  queue(topic: string, vars: Record<string, string> = {}, target?: Building): void {
    const q = this.ctx.state.chirp.queue;
    if (q.length >= 6) q.shift();
    q.push({ topic, vars, x: target ? target.x + (target.w >> 1) : undefined, y: target ? target.y + (target.h >> 1) : undefined, buildingId: target?.id });
  }

  daily(): void {
    const ctx = this.ctx, st = ctx.state.chirp, day = ctx.day;
    if (ctx.fastForward || !ctx.settings.ui.chirps) {
      st.queue.length = 0;
      return;
    }
    if (day < st.next) return;
    if (ctx.world.stats.population <= 0 && !st.queue.length) return;
    let cand: Candidate | null = null;
    while (st.queue.length && !cand) {
      const q = st.queue.shift()!;
      const target = q.buildingId ? ctx.world.buildings.get(q.buildingId) : undefined;
      if (CHIRPS[q.topic]) cand = { topic: q.topic, weight: 1, vars: q.vars, target };
    }
    if (!cand) cand = this.pick();
    if (!cand) return;
    this.post(cand);
    const gap = CHIRP_MIN_GAP + ctx.rng.next() * (CHIRP_MAX_GAP - CHIRP_MIN_GAP);
    // small towns chatter less
    const quiet = ctx.world.stats.population < 200 ? 2 : 1;
    st.next = day + Math.ceil(gap * quiet);
  }

  private pick(): Candidate | null {
    const ctx = this.ctx, w = ctx.world, s = w.stats, a = ctx.last, st = ctx.state.chirp, day = ctx.day;
    if (!ctx.lastValid) return null;
    const list: Candidate[] = [];
    const n = Math.max(1, a.zoned);
    const add = (topic: string, weight: number, target?: Building, vars?: Record<string, string>) => {
      if (weight <= 0 || !CHIRPS[topic]) return;
      if ((st.cd[topic] ?? -1) > day) return;
      list.push({ topic, weight, target, vars });
    };
    const sampleOf = (p: number) => w.buildings.get(a.sample(p));
    const share = (p: number) => a.problems(p) / n;
    const pop = s.population;
    if (pop < 250) add('first_home', 3);
    const growth = s.movedIn - s.movedOut;
    if (growth > Math.max(20, pop * 0.03)) add('growth', 2, undefined, { n: formatNumber(growth) });
    if (s.trafficFlow < 60 && pop > 1000) add('traffic_bad', (70 - s.trafficFlow) / 10);
    if (s.trafficFlow > 90 && pop > 3000) add('traffic_good', 0.8);
    if (w.transitLines.some((l) => l.active && l.ridership > 50)) add('transit_good', 1);
    if (pop > 8000 && !w.transitLines.some((l) => l.active) && w.isUnlocked(3)) add('no_transit', 1.5);
    if (share(Problem.Pollution) > 0.05 || s.pollution > 25) add('pollution', 1 + share(Problem.Pollution) * 20, sampleOf(Problem.Pollution));
    if (s.pollution < 5 && pop > 2000) add('clean_air', 0.8);
    if (a.problems(Problem.NoPower) > 0) add('no_power', 2 + share(Problem.NoPower) * 30, sampleOf(Problem.NoPower));
    if (a.problems(Problem.NoWater) > 0) add('no_water', 2 + share(Problem.NoWater) * 30, sampleOf(Problem.NoWater));
    if (a.problems(Problem.NoSewage) > 0) add('sewage', 1 + share(Problem.NoSewage) * 20, sampleOf(Problem.NoSewage));
    if (a.problems(Problem.Garbage) > 0) add('garbage', 1 + share(Problem.Garbage) * 25, sampleOf(Problem.Garbage));
    if (a.problems(Problem.Crime) > 0) add('crime', 1 + share(Problem.Crime) * 25, sampleOf(Problem.Crime));
    if (s.crimeRate < 8 && pop > 2000 && ctx.unlocked('police')) add('safe', 0.6);
    if (a.problems(Problem.Sick) > 0) add('sick', 1 + share(Problem.Sick) * 25, sampleOf(Problem.Sick));
    if (ctx.serviceOn('health') && s.health_.sick > s.health_.capacity * 1.3 && pop > 800) add('no_health', 1.5);
    if (a.problems(Problem.Dead) > 0) add('dead', 1.5 + share(Problem.Dead) * 30, sampleOf(Problem.Dead));
    const unemp = s.workforce > 0 ? s.unemployed / s.workforce : 0;
    if (unemp > 0.12 && pop > 300) add('unemployment', 1 + unemp * 10, undefined, { pct: formatPercent(unemp) });
    if (unemp < 0.04 && pop > 1000) add('jobs_good', 0.8);
    if (a.problems(Problem.NoWorkers) > n * 0.05) add('worker_shortage', 1.2, sampleOf(Problem.NoWorkers));
    const taxes = Object.values(w.economy.taxes);
    const avgTax = taxes.reduce((x, y) => x + y, 0) / taxes.length;
    if (avgTax > 0.15) add('taxes_high', (avgTax - 0.15) * 30 + 1, undefined, { pct: formatPercent(avgTax) });
    if (avgTax < 0.07 && pop > 500) add('taxes_low', 1);
    if (s.happiness > 80 && pop > 500) add('happy', 1.2);
    if (s.happiness < 40 && pop > 300) add('unhappy', 1.5);
    if (a.parks >= Math.max(3, pop / 3000)) add('parks_good', 0.8, undefined, { season: calendar(w.time.day).season });
    if (a.parks === 0 && pop > 1500) add('no_parks', 1.2);
    if (s.education > 60 && pop > 3000) add('education_good', 0.8);
    if (ctx.serviceOn('education') && s.education_.capacity < a.studentsPotential * 0.6 && pop > 1500) add('no_school', 1.3);
    if (a.problems(Problem.Noise) > n * 0.04) add('noise', 1, sampleOf(Problem.Noise));
    if (a.abandoned > 0) add('abandoned', 1 + Math.min(3, a.abandoned / 10), sampleOf(Problem.Abandoned));
    if (a.problems(Problem.HighRent) > 0) add('high_rent', 0.8, sampleOf(Problem.HighRent));
    if (a.problems(Problem.NoGoods) > 0) add('no_goods', 1, sampleOf(Problem.NoGoods));
    if (s.demand.com > 0.6 && pop > 300) add('shops_wanted', 1);
    if (s.demand.res > 0.75 && pop > 1000) add('homes_wanted', 1);
    if (s.tourists > 1000) add('tourism', 0.9, undefined, { building: this.landmarkName() });
    if (w.economy.money < 0) add('budget_bad', 1.5);
    const wt = w.weather.type;
    const weatherTopic = wt === 'rain' ? 'weather_rain' : wt === 'snow' || wt === 'blizzard' ? 'weather_snow' : wt === 'heatwave' ? 'weather_heat' : wt === 'storm' ? 'weather_storm' : wt === 'fog' ? 'weather_fog' : wt === 'clear' ? 'weather_clear' : '';
    if (weatherTopic) add(weatherTopic, wt === 'clear' ? 0.4 : 1.2);
    add('season_' + calendar(w.time.day).season, 0.35);
    if (isNight(w.time.hour)) add('night', 0.4);
    add('generic', 1.1);
    if (!list.length) return null;
    let total = 0;
    for (const c of list) total += c.weight;
    let r = ctx.rng.next() * total;
    for (const c of list) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return list[list.length - 1];
  }

  private landmarkName(): string {
    for (const b of this.ctx.world.buildings.values()) {
      if (b.kind !== 'service' || b.built < 1) continue;
      const cat = defOf(b.defId)?.category;
      if (cat === 'landmark' || cat === 'monument' || cat === 'tourism') return buildingTitle(b);
    }
    return 'old town';
  }

  private post(c: Candidate): void {
    const ctx = this.ctx, w = ctx.world, st = ctx.state.chirp, rng = ctx.rng;
    const templates = CHIRPS[c.topic];
    if (!templates?.length) return;
    // avoid recently used lines
    let idx = Math.floor(rng.next() * templates.length);
    for (let t = 0; t < templates.length; t++) {
      const h = hashString(c.topic + ':' + ((idx + t) % templates.length));
      if (!st.recent.includes(h)) {
        idx = (idx + t) % templates.length;
        break;
      }
    }
    const lineHash = hashString(c.topic + ':' + idx);
    st.recent.push(lineHash);
    if (st.recent.length > 24) st.recent.shift();
    // author: a resident of a sampled home (deterministic per home + slot)
    const home = w.buildings.get(ctx.last.resSample) ?? c.target;
    const seed = home ? home.seed : w.settings.seed;
    const slot = Math.floor(rng.next() * Math.max(1, home?.residents ?? 4));
    const author = personName(seed, slot);
    const vars: Record<string, string> = {
      city: w.settings.cityName,
      street: streetName(ctx, c.target ?? home),
      pct: '',
      n: '',
      season: calendar(w.time.day).season,
      temp: `${Math.round(w.weather.temperature)}°C`,
      ...(c.vars ?? {}),
    };
    if (c.target && !vars.building) vars.building = buildingTitle(c.target);
    let text = templates[idx].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
    text = text.replace(/\s{2,}/g, ' ').trim();
    const target = c.target;
    w.notify({
      kind: 'chirp',
      title: `${author} ${handleOf(author, seed + slot)}`,
      text,
      icon: CHIRP_ICONS[c.topic] ?? '🐦',
      author,
      x: target ? target.x + (target.w >> 1) : undefined,
      y: target ? target.y + (target.h >> 1) : undefined,
      buildingId: target?.id,
    });
    st.cd[c.topic] = ctx.day + (COOLDOWN[c.topic] ?? DEFAULT_COOLDOWN);
    ctx.state.metrics.chirps++;
    try { ctx.game.audio.play('chirp', 0.5); } catch { /* audio optional */ }
  }
}
