// Weather simulation: a per-theme, per-season Markov chain over the eight
// weather types, a temperature model (seasonal curve + day/night swing +
// weather offsets + slow random anomaly), drifting wind and snow cover that
// accumulates while it snows below freezing and melts above it.
// State lives on `world.weather` (persisted) plus a few scalars in the events
// module's `world.ext` block (anomaly, base intensity, forced flag).
import type { RNG } from '../../core/rng';
import type { Season, ThemeDef, WeatherState, WeatherType } from '../../core/types';
import { calendar } from '../../core/time';
import { clamp, clamp01 } from '../../core/util';
import type { World } from '../../world/World';
import type { EventModifiers } from './EventSystem';

export const WEATHER_TYPES: WeatherType[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'heatwave', 'blizzard'];

/** persisted scalars (inside world.ext.events) */
export interface WeatherExt {
  /** slow temperature anomaly °C */
  anomaly: number;
  /** base intensity of the current state (intensity breathes around it) */
  base: number;
  /** wind speed target m/s */
  windTarget: number;
  /** set while the weather is forced by /weather or an event (no natural changes until it expires) */
  forced: boolean;
  /** phase for intensity breathing */
  phase: number;
}

export function defaultWeatherExt(): WeatherExt {
  return { anomaly: 0, base: 0.5, windTarget: 4, forced: false, phase: 0 };
}

/** typical intensity / duration (days) ranges and wind (m/s) per type */
const PROFILE: Record<WeatherType, { i: [number, number]; d: [number, number]; wind: [number, number] }> = {
  clear: { i: [0, 0.2], d: [12, 36], wind: [2, 6] },
  cloudy: { i: [0.3, 0.8], d: [6, 18], wind: [4, 8] },
  rain: { i: [0.35, 0.95], d: [5, 14], wind: [5, 10] },
  storm: { i: [0.7, 1], d: [3, 7], wind: [13, 21] },
  snow: { i: [0.35, 0.9], d: [7, 18], wind: [3, 8] },
  fog: { i: [0.5, 1], d: [3, 7], wind: [0.4, 2] },
  heatwave: { i: [0.6, 1], d: [10, 20], wind: [1.5, 4] },
  blizzard: { i: [0.8, 1], d: [4, 9], wind: [15, 25] },
};

const RAIN_SEASON: Record<Season, number> = { spring: 1.25, summer: 0.8, autumn: 1.3, winter: 0.95 };
const STORM_SEASON: Record<Season, number> = { spring: 1.1, summer: 1.8, autumn: 0.8, winter: 0.2 };
const FOG_SEASON: Record<Season, number> = { spring: 1.0, summer: 0.4, autumn: 1.6, winter: 1.3 };

/** seasonal base temperature (°C) for a calendar day, without weather or anomaly */
export function seasonalTemperature(theme: ThemeDef, day: number): number {
  const p = calendar(day).yearProgress + (((day % 1) + 1) % 1) / 360;
  // warmest around mid-July, coldest mid-January
  return theme.tempMean + theme.tempSwing * Math.cos(2 * Math.PI * (p - 0.54));
}

/** day/night swing amplitude (°C): dry climates swing more, clouds damp it */
function diurnalAmplitude(theme: ThemeDef, type: WeatherType): number {
  const base = 3.5 + 3.5 * (1 - theme.rainfall);
  const damp: Record<WeatherType, number> = { clear: 1, cloudy: 0.6, rain: 0.35, storm: 0.3, snow: 0.45, fog: 0.4, heatwave: 1.15, blizzard: 0.3 };
  return base * damp[type];
}

export class WeatherSim {
  constructor(private readonly rng: RNG) {}

  /** target temperature right now */
  targetTemperature(world: World, ext: WeatherExt): number {
    const theme = world.theme;
    const w = world.weather;
    let t = seasonalTemperature(theme, world.time.day) + ext.anomaly;
    // afternoon peak ~15:00, coldest ~03:00
    t += diurnalAmplitude(theme, w.type) * Math.cos((2 * Math.PI * (world.time.hour - 15)) / 24);
    const i = w.intensity;
    switch (w.type) {
      case 'cloudy': t -= 1; break;
      case 'rain': t -= 1.5 + 1.5 * i; break;
      case 'storm': t -= 3; break;
      case 'fog': t -= 1; break;
      case 'snow': t = Math.min(t, -0.5 - 2.5 * i); break;
      case 'blizzard': t = Math.min(t - 4, -6 - 6 * i); break;
      case 'heatwave': t += 7 + 6 * i; break;
      default: break;
    }
    return t;
  }

  /** advance by dtDays of game time. Returns true when the weather type changed. */
  update(world: World, ext: WeatherExt, dtDays: number): boolean {
    const w = world.weather;
    let changed = false;
    if (dtDays > 0) {
      w.nextChange -= dtDays;
      if (w.nextChange <= 0) {
        ext.forced = false;
        const prev = w.type;
        this.transition(world, ext);
        changed = w.type !== prev;
      }
      // anomaly: slow mean-reverting random walk (~±4 °C)
      ext.anomaly = clamp(ext.anomaly * Math.exp(-dtDays / 25) + this.rng.gauss() * 0.55 * Math.sqrt(dtDays), -6, 6);
      // intensity breathes gently around its base value
      ext.phase = (ext.phase + dtDays * 0.9) % (Math.PI * 2);
      w.intensity = clamp01(ext.base * (0.88 + 0.12 * Math.sin(ext.phase)));
      // wind: direction random walk, speed follows the weather's target with gusts
      w.windDir = (w.windDir + this.rng.gauss() * 0.12 * Math.sqrt(dtDays) + Math.PI * 4) % (Math.PI * 2);
      const gust = this.rng.gauss() * 0.6 * Math.sqrt(dtDays);
      w.windSpeed = clamp(w.windSpeed + (ext.windTarget - w.windSpeed) * (1 - Math.exp(-dtDays * 0.8)) + gust, 0, 32);
      // snow cover
      const t = w.temperature;
      const snowing = (w.type === 'snow' || w.type === 'blizzard') && t < 0.8;
      if (snowing) w.snowCover = clamp01(w.snowCover + dtDays * w.intensity * (w.type === 'blizzard' ? 0.3 : 0.14));
      else if (t > 0.5) {
        const rainy = w.type === 'rain' || w.type === 'storm' ? 0.08 : 0;
        w.snowCover = clamp01(w.snowCover - dtDays * (0.015 + 0.012 * t + rainy));
      } else w.snowCover = clamp01(w.snowCover - dtDays * 0.002);
    }
    // temperature follows its target smoothly (also while paused, the hour still moves)
    const target = this.targetTemperature(world, ext);
    const k = dtDays > 0 ? 1 - Math.exp(-dtDays * 1.5) : 0;
    w.temperature += (target - w.temperature) * k;
    if (!Number.isFinite(w.temperature)) w.temperature = target;
    return changed;
  }

  /** choose the next weather naturally (Markov step) */
  transition(world: World, ext: WeatherExt): void {
    const theme = world.theme;
    const cal = calendar(world.time.day);
    const s = cal.season;
    const tb = seasonalTemperature(theme, world.time.day) + ext.anomaly;
    const cur = world.weather.type;
    const rain = theme.rainfall, snowy = theme.snowiness;
    const cold = tb < 1.5;
    const weights: Record<WeatherType, number> = {
      clear: 1.15 - rain * 0.75 + (rain < 0.15 ? 0.6 : 0),
      cloudy: 0.5 + rain * 0.45,
      rain: cold ? 0 : rain * RAIN_SEASON[s] * 1.25 * (tb < 4 ? 0.5 : 1),
      storm: cold ? 0 : rain * STORM_SEASON[s] * 0.42 * (tb > 12 ? 1 : 0.3),
      snow: cold ? snowy * 1.7 : tb < 4 ? snowy * 0.3 : 0,
      fog: 0.16 * (0.35 + rain) * FOG_SEASON[s] * (tb > 25 ? 0.2 : 1),
      heatwave: s === 'summer' && tb > 19 ? 0.1 + (1 - rain) * 0.22 + (tb > 27 ? 0.1 : 0) : 0,
      blizzard: cold && tb < -2 ? snowy * 0.32 : 0,
    };
    // variety: repeating the same state is less likely; storms are followed by rain or clearing
    weights[cur] *= 0.45;
    if (cur === 'storm') { weights.rain *= 1.8; weights.cloudy *= 1.4; weights.storm *= 0.3; }
    if (cur === 'blizzard') { weights.snow *= 1.8; weights.blizzard *= 0.2; }
    if (cur === 'heatwave') { weights.storm *= 2.2; weights.heatwave *= 0.2; }
    const types = WEATHER_TYPES.filter((t) => weights[t] > 0);
    const next = this.rng.weighted(types, types.map((t) => weights[t]));
    this.apply(world, ext, next, undefined, undefined, false);
  }

  /** set a weather state (natural or forced) */
  apply(world: World, ext: WeatherExt, type: WeatherType, intensity?: number, days?: number, forced = true): void {
    const p = PROFILE[type];
    const w = world.weather;
    w.type = type;
    ext.base = clamp01(intensity ?? this.rng.range(p.i[0], p.i[1]));
    ext.phase = this.rng.range(0, Math.PI * 2);
    w.intensity = ext.base;
    w.nextChange = Math.max(0.25, days ?? this.rng.range(p.d[0], p.d[1]));
    ext.windTarget = this.rng.range(p.wind[0], p.wind[1]) * (type === 'storm' || type === 'blizzard' ? 0.8 + 0.3 * ext.base : 1);
    ext.forced = forced;
    // storms swing the wind round
    if (type === 'storm' || type === 'blizzard') w.windDir = (w.windDir + this.rng.range(-0.8, 0.8) + Math.PI * 2) % (Math.PI * 2);
  }

  /** weather contribution to the city modifiers */
  modifiers(world: World, m: EventModifiers): void {
    const w = world.weather;
    const i = w.intensity;
    const t = w.temperature;
    switch (w.type) {
      case 'heatwave':
        m.powerUseMult *= 1 + 0.22 * i;
        m.waterUseMult *= 1 + 0.3 * i;
        m.fireRiskMult *= 2 + 1.2 * i;
        m.healthMult *= 1 + 0.1 * i;
        m.happiness -= 2 + 2 * i;
        m.tourismMult *= 1 - 0.08 * i;
        break;
      case 'blizzard':
        m.trafficMult *= 1 + 0.4 * i;
        m.powerUseMult *= 1 + 0.25 * i;
        m.constructionMult *= 1 - 0.5 * i;
        m.happiness -= 3 * i;
        m.healthMult *= 1 + 0.08 * i;
        m.tourismMult *= 1 - 0.25 * i;
        m.fireRiskMult *= 0.7;
        break;
      case 'snow':
        m.trafficMult *= 1 + 0.15 * i;
        m.powerUseMult *= 1 + 0.1 * i;
        m.constructionMult *= 1 - 0.2 * i;
        m.fireRiskMult *= 0.8;
        m.happiness += 0.5;
        break;
      case 'rain':
        m.fireRiskMult *= 1 - 0.55 * i;
        m.happiness -= 1 * i;
        m.trafficMult *= 1 + 0.06 * i;
        m.tourismMult *= 1 - 0.06 * i;
        m.waterSupplyMult *= 1 + 0.05 * i;
        m.constructionMult *= 1 - 0.1 * i;
        break;
      case 'storm':
        m.fireRiskMult *= 0.7;
        m.happiness -= 2 + 1.5 * i;
        m.trafficMult *= 1 + 0.12 * i;
        m.tourismMult *= 1 - 0.12 * i;
        m.constructionMult *= 1 - 0.35 * i;
        m.powerUseMult *= 1.03;
        break;
      case 'fog':
        m.trafficMult *= 1 + 0.1 * i;
        m.tourismMult *= 0.97;
        break;
      case 'clear':
        if (t > 14 && t < 27) { m.happiness += 1; m.tourismMult *= 1.04; }
        break;
      default:
        break;
    }
    // heating below 12 °C, air conditioning above 26 °C
    if (t < 12) m.powerUseMult *= 1 + Math.min(0.35, (12 - t) * 0.012);
    else if (t > 26) m.powerUseMult *= 1 + Math.min(0.3, (t - 26) * 0.018);
    if (t > 28) m.waterUseMult *= 1 + Math.min(0.2, (t - 28) * 0.02);
    // snow on the ground slows traffic even after it stops falling
    if (w.snowCover > 0.2 && w.type !== 'snow' && w.type !== 'blizzard') m.trafficMult *= 1 + 0.08 * w.snowCover;
  }

  /** a readable one-liner for notices */
  static describe(w: WeatherState): string {
    const names: Record<WeatherType, string> = {
      clear: 'Clear skies', cloudy: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snowfall', fog: 'Thick fog', heatwave: 'Heat wave', blizzard: 'Blizzard',
    };
    return `${names[w.type]}, ${Math.round(w.temperature)} °C`;
  }
}
