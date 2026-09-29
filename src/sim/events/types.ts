// JSON-serializable per-event state stored in `ActiveEvent.data` (persisted in
// saves) and the module's `world.ext.events` block. The EventSystem writes
// these; EffectsRenderer reads them to draw the matching visuals, so visuals
// survive save/load and follow the simulation exactly.
import type { WeatherExt } from './weather';

export interface TornadoData {
  /** current funnel position in cells (fractional) */
  px: number;
  py: number;
  /** heading (rad, cell space: x → +X, y → +Z) */
  heading: number;
  /** cells per day */
  speed: number;
  /** 0.5..1.3 size/damage */
  strength: number;
  /** building ids already hit (each is rolled once) */
  hit: number[];
}

export interface MeteorData {
  /** impact point (cells, fractional) */
  tx: number;
  ty: number;
  /** approach azimuth (rad, world XZ) and elevation angle (rad) */
  az: number;
  el: number;
  /** in-game day of impact */
  impactDay: number;
  impacted: boolean;
  /** blast radius (cells) */
  radius: number;
  /** rock radius (m) */
  size: number;
  /** landed in water */
  water: boolean;
}

export interface QuakeData {
  magnitude: number;
  /** affected radius (cells) */
  radius: number;
  /** scheduled collapses: [day, buildingId] pairs, flattened */
  queue: number[];
  /** aftershock days still to come */
  aftershocks: number[];
}

export interface FloodData {
  /** peak flood offset (m) */
  peak: number;
  /** day offsets (relative to startDay) where the rise ends / the fall starts */
  riseEnd: number;
  fallStart: number;
  /** tsunami only: wave arrival day and approach duration (days) */
  arriveDay?: number;
  approach?: number;
  /** tsunami: unit direction the wave travels (cells) and the coast point it heads for */
  dx?: number;
  dy?: number;
  /** building ids flagged Flooded by this event */
  flooded: number[];
}

export interface FireEventData {
  /** building on fire */
  bid: number;
}

export interface FestivalData {
  /** seed for visual variety */
  seed: number;
}

/** persisted module state: world.ext.events */
export interface EventsExt {
  weather: WeatherExt;
  /** last in-game day processed by the daily roll */
  lastDay: number;
  /** defId → day it may roll again */
  cooldowns: Record<string, number>;
  /** module RNG state */
  rng: number;
  /** burning tree cells: flattened [cellIndex, remaining burn days, …] */
  treeFires: number[];
  /** days since the last random fire (for pacing) */
  lastFireDay: number;
  /** the year New Year fireworks last ran for */
  newYear: number;
}
