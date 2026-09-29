// EventSystem — owned by the "events" agent.
//
// Runs the weather state machine, random city events and disasters, and
// fires. Every in-game day each catalog entry rolls its yearly chance
// (population, season, theme, coast, cooldown and "disasters on" permitting,
// boosted when the city conditions invite it). Active events live in
// world.activeEvents (persisted) with their state in `data`; their effects on
// the city are exposed through modifiers(), which Simulation, FieldSystem and
// TrafficSystem read every tick. Visuals are drawn by EffectsRenderer from
// the same state.
import { REAL_SECONDS_PER_DAY } from '../../core/constants';
import { RNG, hashString } from '../../core/rng';
import { calendar } from '../../core/time';
import { BFlag, ZoneType, type ActiveEvent, type Cell, type EventDef, type NoticeKind, type WeatherType } from '../../core/types';
import { EVENTS, EVENT_ALIASES, eventDef, type EventSpec } from '../../data/events';
import { FIRST_NAMES, LAST_NAMES } from '../../data/names';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { HANDLERS, floodOffsetFor, lightningStrike, type EventCtx } from './disasters';
import { FireManager } from './fires';
import { Preparedness, hasSea, pickPlace, placeName, type Place } from './places';
import type { EventsExt } from './types';
import { WEATHER_TYPES, WeatherSim, defaultWeatherExt } from './weather';

/** Multipliers/offsets from active events + weather, read by other systems each tick. Neutral = 1 (mult) / 0 (add). */
export interface EventModifiers {
  demandRes: number; // add, -1..1
  demandCom: number;
  demandInd: number;
  demandOff: number;
  happiness: number; // add, -30..30 points
  incomeMult: number; // tax income multiplier
  tourismMult: number;
  crimeMult: number;
  healthMult: number; // >1 = more sickness
  powerUseMult: number; // consumption multiplier (heat waves, cold)
  waterUseMult: number;
  waterSupplyMult: number; // droughts
  trafficMult: number; // >1 = more trips / slower roads
  fireRiskMult: number;
  constructionMult: number; // construction speed
}

export function neutralModifiers(): EventModifiers {
  return {
    demandRes: 0, demandCom: 0, demandInd: 0, demandOff: 0, happiness: 0, incomeMult: 1, tourismMult: 1, crimeMult: 1, healthMult: 1,
    powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, trafficMult: 1, fireRiskMult: 1, constructionMult: 1,
  };
}

const ADD_KEYS = ['demandRes', 'demandCom', 'demandInd', 'demandOff', 'happiness'] as const;
const MULT_KEYS = ['incomeMult', 'tourismMult', 'crimeMult', 'healthMult', 'powerUseMult', 'waterUseMult', 'waterSupplyMult', 'trafficMult', 'fireRiskMult', 'constructionMult'] as const;

const DIFFICULTY_DISASTERS: Record<string, number> = { easy: 0.6, normal: 1, hard: 1.3, expert: 1.6 };
const MAX_DISASTERS = 1;
const MAX_EVENTS = 3;
const SEVERE_WEATHER: WeatherType[] = ['storm', 'blizzard', 'heatwave', 'fog'];

export class EventSystem {
  protected world: World | null = null;
  /** weather simulation (additive) */
  readonly weatherSim: WeatherSim;
  private rng = new RNG(1);
  private readonly prep = new Preparedness();
  private readonly fires: FireManager;
  private ext: EventsExt | null = null;
  private mods = neutralModifiers();
  private modsKey = -1;
  private version = 0;
  private sea = false;
  private readonly treeView = new Map<number, number>();
  private treeViewAt = -1;
  private lastWeather: WeatherType = 'clear';
  /** buildings burned down since the last daily summary */
  private burnedToday = 0;
  private stormAcc = 0;

  constructor(protected game: Game) {
    this.weatherSim = new WeatherSim(this.rng);
    this.fires = new FireManager(game, this.prep, {
      onBurnedDown: (b) => {
        const w = this.world;
        if (!w) return;
        // fires of the "fire" event report through its end notice
        if (w.activeEvents.some((e) => e.defId === 'fire' && (e.data as { bid?: number } | undefined)?.bid === b.id)) return;
        // one notice per day; further losses are summed up at the end of the day
        if (this.burnedToday++ > 0) return;
        w.notify({ kind: 'danger', title: 'Building burned down', text: `${cap(placeName(w, b))} burned down. Build more fire stations to protect the neighbourhood.`, icon: '🔥', x: b.x, y: b.y, buildingId: b.id });
      },
    });
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    const raw = (world.ext.events ?? {}) as Partial<EventsExt>;
    const ext: EventsExt = {
      weather: { ...defaultWeatherExt(), ...(raw.weather ?? {}) },
      lastDay: raw.lastDay ?? Math.floor(world.time.day),
      cooldowns: raw.cooldowns ?? {},
      rng: raw.rng ?? (hashString(`events:${world.settings.seed}`) || 1),
      treeFires: raw.treeFires ?? [],
      lastFireDay: raw.lastFireDay ?? 0,
      newYear: raw.newYear ?? calendar(world.time.day).year,
    };
    this.ext = ext;
    world.ext.events = ext;
    this.rng.state = ext.rng;
    this.prep.refresh(world);
    this.fires.attach(world, ext.treeFires);
    this.sea = hasSea(world);
    // a fresh city starts with weather fitting its climate and season
    if (!raw.weather) {
      this.weatherSim.transition(world, ext.weather);
      world.weather.temperature = this.weatherSim.targetTemperature(world, ext.weather);
    }
    this.lastWeather = world.weather.type;
    world.floodOffset = floodOffsetFor(world);
    this.modsKey = -1;
    this.version++;
  }

  onWorldUnloaded(): void {
    this.fires.detach();
    this.world = null;
    this.ext = null;
    this.treeView.clear();
  }

  update(dt: number): void {
    const w = this.world, ext = this.ext;
    if (!w || !ext) return;
    const dtDays = Math.max(0, this.game.simDt) / REAL_SECONDS_PER_DAY;
    // ── weather ───────────────────────────────────────────────────────────
    this.weatherSim.update(w, ext.weather, dtDays);
    if (w.weather.type !== this.lastWeather) this.onWeatherChanged();
    if (dtDays <= 0) {
      ext.rng = this.rng.state;
      return;
    }
    // ── daily rolls ───────────────────────────────────────────────────────
    const today = Math.floor(w.time.day);
    let guard = 0;
    while (ext.lastDay < today && guard++ < 5) {
      ext.lastDay++;
      this.daily(ext.lastDay);
    }
    if (ext.lastDay < today) ext.lastDay = today;
    // ── storms throw lightning at tall buildings ─────────────────────────
    if (w.weather.type === 'storm' && w.stats.population > 0) {
      this.stormAcc += dtDays * (0.35 + 0.55 * w.weather.intensity);
      if (this.stormAcc >= 1) {
        this.stormAcc = 0;
        const place = pickPlace(w, this.rng, 'tall');
        const b = place?.bid !== undefined ? w.getBuilding(place.bid) : undefined;
        if (b && lightningStrike(this.ctx(), b, 0.4)) {
          w.notify({ kind: 'warning', title: 'Lightning strike', text: `Lightning struck ${placeName(w, b)} and set it on fire!`, icon: '⚡', x: b.x, y: b.y, buildingId: b.id });
        }
      }
    }
    // ── fires ─────────────────────────────────────────────────────────────
    const m = this.modifiers();
    const wet = this.wetness();
    const wx = Math.cos(w.weather.windDir) * w.weather.windSpeed, wy = Math.sin(w.weather.windDir) * w.weather.windSpeed;
    this.fires.update(w, this.rng, dtDays, m.fireRiskMult, wet, wx, wy);
    if (this.fires.treesDirty) {
      this.fires.treesDirty = false;
      ext.treeFires = this.fires.serializeTrees();
    }
    // ── active events ─────────────────────────────────────────────────────
    const c = this.ctx();
    for (const ev of w.activeEvents.slice()) {
      const spec = eventDef(ev.defId);
      if (!spec) {
        this.finish(ev, null);
        continue;
      }
      const h = HANDLERS[ev.defId];
      try {
        h?.update?.(c, ev, spec, dtDays);
      } catch (err) {
        console.warn('[events] update failed', ev.defId, err);
      }
      // events with a completion test (fires) run until done; others until endDay
      const over = h?.done
        ? h.done(c, ev, spec) || (spec.duration > 0 && w.time.day >= ev.endDay) || w.time.day - ev.startDay > 90
        : w.time.day >= ev.endDay;
      if (over) this.finish(ev, spec);
    }
    const off = floodOffsetFor(w);
    if (off !== w.floodOffset) w.floodOffset = off;
    ext.rng = this.rng.state;
    void dt;
  }

  // ── public API (frozen) ───────────────────────────────────────────────
  /** all event definitions */
  get catalog(): EventDef[] {
    return EVENTS;
  }

  /** ids usable with /summon */
  summonables(): string[] {
    return EVENTS.filter((e) => e.summonable).map((e) => e.id);
  }

  /** start an event now (optionally at a cell). Returns null if unknown/invalid. */
  trigger(defId: string, at?: Cell): ActiveEvent | null {
    const id = EVENT_ALIASES[defId] ?? defId;
    const spec = eventDef(id);
    if (!spec || !this.world) return null;
    return this.start(spec, at, false);
  }

  end(eventId: number): void {
    const w = this.world;
    if (!w) return;
    const ev = w.activeEvents.find((e) => e.id === eventId);
    if (ev) this.finish(ev, eventDef(ev.defId) ?? null);
  }

  /** force weather */
  setWeather(type: WeatherType, intensity?: number, days?: number): void {
    const w = this.world, ext = this.ext;
    if (!w || !ext || !WEATHER_TYPES.includes(type)) return;
    this.weatherSim.apply(w, ext.weather, type, intensity, days ?? undefined, true);
    // snap temperature toward the new regime so snow and heat make sense immediately
    const target = this.weatherSim.targetTemperature(w, ext.weather);
    w.weather.temperature = w.weather.temperature * 0.3 + target * 0.7;
    if ((type === 'snow' || type === 'blizzard') && w.weather.temperature > -0.5) w.weather.temperature = -1.5;
    this.onWeatherChanged(true);
  }

  /** ignite a building */
  startFire(buildingId: number): boolean {
    const w = this.world;
    const b = w?.getBuilding(buildingId);
    if (!w || !b) return false;
    return this.fires.ignite(w, b, 0.35);
  }

  /** combined modifiers of active events and weather (cheap; call per tick) */
  modifiers(): EventModifiers {
    const w = this.world;
    if (!w) return neutralModifiers();
    const key = Math.floor(w.time.day * 8) * 1024 + (this.version & 1023);
    if (key === this.modsKey) return this.mods;
    this.modsKey = key;
    const m = neutralModifiers();
    for (const ev of w.activeEvents) {
      const spec = eventDef(ev.defId);
      if (!spec?.mods) continue;
      // disaster-response buildings soften the blow to morale
      const soften = spec.hazard ? 1 - 0.5 * this.prep.mitigation(spec.hazard, ev.x, ev.y) : 1;
      for (const k of ADD_KEYS) {
        const v = spec.mods[k];
        if (v !== undefined) m[k] += v < 0 && k === 'happiness' ? v * soften : v;
      }
      for (const k of MULT_KEYS) {
        const v = spec.mods[k];
        if (v !== undefined) m[k] *= v;
      }
    }
    this.weatherSim.modifiers(w, m);
    // active fires unsettle the neighbourhood a little
    const burning = this.fires.burning.size + (this.fires.trees.size > 0 ? 2 : 0);
    if (burning) m.happiness -= Math.min(3, burning * 0.3);
    m.happiness = Math.max(-30, Math.min(30, m.happiness));
    for (const k of ['demandRes', 'demandCom', 'demandInd', 'demandOff'] as const) m[k] = Math.max(-1, Math.min(1, m[k]));
    this.mods = m;
    return m;
  }

  // ── additive API ──────────────────────────────────────────────────────
  /** burning forest cells → 0..1 intensity (for visuals) */
  burningTrees(): ReadonlyMap<number, number> {
    const w = this.world;
    if (!w) return this.treeView;
    const stamp = w.time.day;
    if (stamp !== this.treeViewAt) {
      this.treeViewAt = stamp;
      this.fires.treeIntensities(this.treeView);
    }
    return this.treeView;
  }

  /** ids of buildings currently on fire */
  burningBuildings(): ReadonlySet<number> {
    return this.fires.burning;
  }

  /** put out every fire (cheat / debugging) */
  extinguishAll(): void {
    const w = this.world;
    if (!w) return;
    this.fires.extinguishAll(w);
    if (this.ext) this.ext.treeFires = [];
  }

  /** active event of a definition, if any */
  active(defId: string): ActiveEvent | undefined {
    return this.world?.activeEvents.find((e) => e.defId === defId);
  }

  /** 0..0.75 damage reduction from disaster-response buildings for a hazard at a cell */
  mitigation(hazard: EventSpec['hazard'], x?: number, y?: number): number {
    return hazard ? this.prep.mitigation(hazard, x, y) : 0;
  }

  // ── internals ─────────────────────────────────────────────────────────
  private ctx(): EventCtx {
    let fx: EventCtx['fx'] = null;
    try {
      fx = this.game.effects ?? null;
    } catch {
      fx = null;
    }
    return { game: this.game, world: this.world!, rng: this.rng, fires: this.fires, prep: this.prep, fx };
  }

  private wetness(): number {
    const w = this.world!.weather;
    if (w.type === 'rain') return 0.5 + 0.4 * w.intensity;
    if (w.type === 'storm') return 0.7 + 0.3 * w.intensity;
    if (w.type === 'snow' || w.type === 'blizzard') return 0.6;
    if (w.type === 'fog') return 0.2;
    return 0;
  }

  private onWeatherChanged(forced = false): void {
    const w = this.world!;
    const prev = this.lastWeather;
    this.lastWeather = w.weather.type;
    this.modsKey = -1;
    this.game.events.emit('weather:changed', w.weather);
    const t = w.weather.type;
    if (forced || !SEVERE_WEATHER.includes(t) || prev === t) return;
    const text: Record<string, string> = {
      storm: 'A thunderstorm is rolling in. Expect lightning, heavy rain and slower traffic.',
      blizzard: 'A blizzard is sweeping in! Heating demand will soar and traffic will crawl.',
      heatwave: 'A heat wave is building. Power and water use will climb and fires start easily.',
      fog: 'Thick fog has settled over the city. Drive carefully.',
    };
    const icon: Record<string, string> = { storm: '⛈️', blizzard: '🌨️', heatwave: '🌡️', fog: '🌫️' };
    w.notify({ kind: t === 'fog' ? 'info' : 'warning', title: 'Weather alert', text: text[t], icon: icon[t] });
  }

  /** one in-game day: random fires and event rolls */
  private daily(day: number): void {
    const w = this.world!, ext = this.ext!;
    this.prep.refresh(w);
    if (this.burnedToday > 1) {
      const more = this.burnedToday - 1;
      w.notify({ kind: 'danger', title: 'Fires raging', text: `${more} more building${more > 1 ? 's' : ''} burned down yesterday. Fire coverage is badly needed.`, icon: '🔥' });
    }
    this.burnedToday = 0;
    const m = this.modifiers();
    // random building fires
    for (const b of this.fires.daily(w, this.rng, m.fireRiskMult)) {
      ext.lastFireDay = day;
      this.announceFire(b.id);
    }
    // New Year's fireworks
    const cal = calendar(day);
    if (cal.year > ext.newYear) {
      ext.newYear = cal.year;
      if (!this.active('new_year')) {
        const spec = eventDef('new_year');
        if (spec) this.start(spec, undefined, true);
      }
    }
    if (day < 12) return;
    const pop = w.stats.population;
    let disasters = 0, events = 0;
    for (const ev of w.activeEvents) {
      const s = eventDef(ev.defId);
      if (!s || s.id === 'fire' || s.scripted) continue;
      if (s.disaster) disasters++;
      else events++;
    }
    const dm = DIFFICULTY_DISASTERS[w.settings.difficulty] ?? 1;
    for (const spec of EVENTS) {
      if (spec.scripted || spec.yearlyChance <= 0) continue;
      if (pop < spec.minPopulation) continue;
      if (spec.disaster && (!w.settings.disasters || disasters >= MAX_DISASTERS)) continue;
      if (!spec.disaster && events >= MAX_EVENTS) continue;
      if (spec.seasons && !spec.seasons.includes(cal.season)) continue;
      if (spec.themes && !spec.themes.includes(w.settings.theme)) continue;
      if (spec.coastal && !this.sea) continue;
      if ((ext.cooldowns[spec.id] ?? -1) > day) continue;
      if (this.active(spec.id)) continue;
      let p = spec.yearlyChance / 360;
      if (spec.boostWhen && this.boosted(spec.boostWhen)) p *= 2.5;
      if (spec.disaster) p *= dm;
      if (this.rng.next() >= p) continue;
      const ev = this.start(spec, undefined, true);
      if (ev) {
        if (spec.disaster) disasters++;
        else events++;
      }
    }
  }

  private boosted(cond: NonNullable<EventSpec['boostWhen']>): boolean {
    const w = this.world!;
    const s = w.stats;
    switch (cond) {
      case 'highTax': {
        const t = Object.values(w.economy.taxes);
        return t.reduce((a, b) => a + b, 0) / Math.max(1, t.length) > 0.13;
      }
      case 'lowHappiness': return s.happiness < 45;
      case 'highUnemployment': return s.workforce > 0 && s.unemployed / s.workforce > 0.12;
      case 'lowHealth': return s.health < 45;
      case 'highCrime': return s.crimeRate > 25;
      case 'hot': return w.weather.temperature > 28 || w.weather.type === 'heatwave';
      case 'dry': return w.theme.rainfall < 0.3 || !!this.active('drought') || w.weather.type === 'heatwave';
      case 'storm': return w.weather.type === 'storm' || (w.weather.type === 'rain' && w.weather.intensity > 0.7);
      case 'winter': return calendar(w.time.day).season === 'winter';
      case 'educated': return s.education > 60;
      case 'farming':
      case 'industry': {
        let n = 0, total = 0;
        for (const b of w.buildings.values()) {
          if (b.kind !== 'zoned') continue;
          total++;
          if (cond === 'farming' ? b.zone === ZoneType.Farming : b.zone >= ZoneType.Industry && b.zone <= ZoneType.Oil) n++;
        }
        return total > 0 && n / total > (cond === 'farming' ? 0.08 : 0.25);
      }
    }
    return false;
  }

  /** start an event; natural = rolled by the city (pauses on disasters) */
  private start(spec: EventSpec, at: Cell | undefined, natural: boolean): ActiveEvent | null {
    const w = this.world!, ext = this.ext!;
    if (spec.coastal && !this.sea) return null;
    let place: Place | null = null;
    if (at && w.inBounds(at.x, at.y)) {
      const b = w.buildingAt(at.x, at.y);
      place = { x: at.x, y: at.y, bid: b?.id, name: placeName(w, b, at.x, at.y) };
      // targeted events need a building at (or near) the given cell
      if ((spec.place === 'building' || spec.place === 'tall' || spec.place === 'industry') && !b) {
        const near = this.nearestBuilding(at.x, at.y, 6);
        if (!near) return null;
        place = { x: at.x, y: at.y, bid: near.id, name: placeName(w, near) };
      }
    } else if (spec.place && spec.place !== 'none') {
      place = pickPlace(w, this.rng, spec.place);
      if (!place && spec.place !== 'city' && spec.place !== 'park') return null;
    }
    const day = w.time.day;
    const ev: ActiveEvent = { id: w.nextEventId++, defId: spec.id, startDay: day, endDay: day + spec.duration };
    if (place) {
      ev.x = place.x;
      ev.y = place.y;
    }
    ev.data = { seed: this.rng.int(1, 1 << 30) };
    const h = HANDLERS[spec.id];
    const c = this.ctx();
    try {
      if (h?.start && h.start(c, ev, spec, place) === false) {
        w.nextEventId--;
        return null;
      }
    } catch (err) {
      console.warn('[events] start failed', spec.id, err);
      return null;
    }
    w.activeEvents.push(ev);
    if (spec.cooldown) ext.cooldowns[spec.id] = ev.endDay + spec.cooldown;
    // weather forced for the event
    if (spec.weather) this.setWeather(spec.weather, spec.weatherIntensity, Math.max(1, ev.endDay - day));
    // one-off money
    if (spec.moneyPer1k) {
      const amount = Math.round((spec.moneyPer1k * Math.max(1000, w.stats.population)) / 1000);
      if (amount > 0) w.earn(amount, 'events');
      else w.charge(-amount, 'events');
    }
    this.version++;
    this.modsKey = -1;
    // notice + cues
    const text = spec.startText.replace('{place}', place?.name ?? 'the city');
    w.notify({ kind: noticeKind(spec), title: spec.name, text, icon: spec.icon, x: place?.x, y: place?.y, buildingId: place?.bid });
    this.game.events.emit('event:start', ev);
    this.cue(spec, ev);
    if (spec.id === 'ufo') this.ufoChirps(place);
    if (natural && spec.disaster && this.game.settings.value.gameplay.pauseOnDisaster) {
      try {
        this.game.sim.setSpeed(0);
        this.game.ui.toast(`${spec.icon} ${spec.name}! The game is paused.`, 'danger');
      } catch {
        /* ui/sim unavailable */
      }
    }
    return ev;
  }

  private finish(ev: ActiveEvent, spec: EventSpec | null): void {
    const w = this.world!;
    const i = w.activeEvents.indexOf(ev);
    if (i < 0) return;
    const h = HANDLERS[ev.defId];
    const c = this.ctx();
    let endText: string | null | undefined;
    try {
      h?.end?.(c, ev, spec!);
      endText = spec && h?.endText ? h.endText(c, ev, spec) : spec?.endText;
    } catch (err) {
      console.warn('[events] end failed', ev.defId, err);
    }
    w.activeEvents.splice(i, 1);
    // release weather forced by this event (a natural change follows soon)
    if (spec?.weather && this.ext && w.weather.type === spec.weather) {
      this.ext.weather.forced = false;
      w.weather.nextChange = Math.min(w.weather.nextChange, 0.5);
    }
    if (ev.defId === 'flood' || ev.defId === 'tsunami') w.floodOffset = floodOffsetFor(w);
    this.version++;
    this.modsKey = -1;
    if (spec && endText) {
      const b = ev.x !== undefined && ev.y !== undefined ? w.buildingAt(ev.x, ev.y) : undefined;
      const place = placeName(w, b, ev.x, ev.y);
      w.notify({ kind: spec.severity === 'good' ? 'good' : 'info', title: spec.name, text: endText.replace('{place}', place), icon: spec.icon, x: ev.x, y: ev.y });
    }
    this.game.events.emit('event:end', ev);
  }

  private announceFire(bid: number): void {
    const w = this.world!;
    const b = w.getBuilding(bid);
    if (!b) return;
    const spec = eventDef('fire');
    if (!spec) return;
    // a "fire" event tracks the blaze and reports when it is out
    const ev: ActiveEvent = { id: w.nextEventId++, defId: 'fire', startDay: w.time.day, endDay: w.time.day, x: b.x, y: b.y, data: { bid } };
    w.activeEvents.push(ev);
    w.notify({ kind: 'danger', title: spec.name, text: spec.startText.replace('{place}', placeName(w, b)), icon: spec.icon, x: b.x, y: b.y, buildingId: b.id });
    this.game.events.emit('event:start', ev);
  }

  private cue(spec: EventSpec, ev: ActiveEvent): void {
    const a = this.game.audio;
    try {
      if (spec.severity === 'good') a.play('notice', 0.8);
      else if (spec.id === 'fire' || spec.id === 'explosion' || spec.id === 'forest_fire') {
        if (ev.x !== undefined && ev.y !== undefined && typeof a.playAt === 'function') a.playAt('siren', ev.x, ev.y, 0.9, 0.25);
      } else if (!spec.disaster) a.play('warning', 0.8);
      // disasters get their swell from the AudioManager's event:start listener
    } catch {
      /* audio not ready */
    }
  }

  private ufoChirps(place: Place | null): void {
    const w = this.world!;
    const lines = [
      'Just saw a FLYING SAUCER over {place}!!! Not joking. #ufo',
      'Bright green beam over {place}. My dog will not stop barking. 👽',
      'Scientists say "weather balloon". Weather balloons don\'t do loop-the-loops. #ufo',
      'Charging a small fee for rooftop UFO viewing. DM me. 🛸',
    ];
    const n = 2 + this.rng.int(0, 1);
    for (let i = 0; i < n; i++) {
      const author = `${this.rng.pick(FIRST_NAMES)} ${this.rng.pick(LAST_NAMES)}`;
      const text = lines[(i + this.rng.int(0, lines.length - 1)) % lines.length].replace('{place}', place?.name ?? 'the city');
      w.notify({ kind: 'chirp', title: author, text, icon: '🛸', author, x: place?.x, y: place?.y });
    }
  }

  private nearestBuilding(x: number, y: number, r: number) {
    const w = this.world!;
    for (let d = 0; d <= r; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const b = w.buildingAt(x + dx, y + dy);
          if (b && !(b.flags & BFlag.Collapsed)) return b;
        }
    return undefined;
  }
}

function noticeKind(spec: EventSpec): NoticeKind {
  switch (spec.severity) {
    case 'good': return 'good';
    case 'warning': return 'warning';
    case 'danger':
    case 'disaster': return 'danger';
    default: return 'info';
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
