// Time & weather: /time /speed /weather
import { MAX_SPEED_LEVEL, SPEEDS } from '../../core/constants';
import { formatDate, formatHour } from '../../core/time';
import type { WeatherType } from '../../core/types';
import { defineCommand, type CmdCtx, type CommandRegistry } from '../CommandRegistry';
import { parseClock, parseInt10, parseNumber } from '../parse';
import { CommandError, TIME_KEYWORDS, UsageError, WEATHER_LABEL, WEATHER_TYPES, kv } from '../util';

const SPEED_NAMES = ['paused', '1×', '2×', '4×', '10×'];

function parseSpeed(tok: string | undefined): number {
  if (tok === undefined) return NaN;
  const t = tok.toLowerCase().replace(/x$/, '');
  if (t === 'pause' || t === 'paused' || t === 'stop') return 0;
  if (t === 'max' || t === 'ultra') return MAX_SPEED_LEVEL;
  const n = parseNumber(t);
  if (!Number.isFinite(n)) return NaN;
  if (/x$/i.test(tok)) {
    // "4x" means the multiplier, not the level
    const lvl = SPEEDS.indexOf(n as (typeof SPEEDS)[number]);
    return lvl >= 0 ? lvl : NaN;
  }
  return Number.isInteger(n) && n >= 0 && n <= MAX_SPEED_LEVEL ? n : NaN;
}

function parseHour(tok: string): number {
  const k = TIME_KEYWORDS[tok.toLowerCase()];
  return k !== undefined ? k : parseClock(tok);
}

function setSpeed(ctx: CmdCtx, tok: string | undefined): void {
  ctx.world();
  const lvl = parseSpeed(tok);
  if (!Number.isFinite(lvl)) throw new UsageError(`Speed must be 0–${MAX_SPEED_LEVEL} (or pause, 1x, 2x, 4x, 10x).`);
  ctx.game.sim.setSpeed(lvl);
  ctx.print(lvl === 0 ? '⏸ Paused.' : `▶ Speed ${SPEED_NAMES[lvl] ?? lvl}.`, 'ok');
}

export function registerTimeWeather(reg: CommandRegistry): void {
  reg.register(defineCommand({
    name: 'time', aliases: ['clock'], category: 'Time & Weather',
    usage: '/time [set <HH:MM|dawn|noon|dusk|night|…> | speed <0-4> | add <days>]',
    description: 'Show or change the time of day, game speed, or fast-forward days.',
    examples: ['/time set 18:30', '/time set dusk', '/time speed 3', '/time add 30'],
    details: [`Keywords: ${Object.keys(TIME_KEYWORDS).join(', ')}.`, '/time add is a cheat (it skips simulation time instantly).'],
    complete: (args, i) => {
      if (i === 0) return ['set', 'speed', 'add', ...Object.keys(TIME_KEYWORDS)];
      const sub = args[0]?.toLowerCase();
      if (i === 1 && sub === 'set') return [...Object.keys(TIME_KEYWORDS), '06:00', '12:00', '18:00', '21:30'];
      if (i === 1 && sub === 'speed') return ['0', '1', '2', '3', '4'];
      if (i === 1 && sub === 'add') return ['1', '7', '30', '90', '360'];
      return [];
    },
    run(ctx) {
      const w = ctx.world();
      const g = ctx.game;
      const [sub, val] = ctx.args;
      const h24 = g.settings.value.ui.clock24h;
      if (!sub) {
        ctx.print(kv('Time', `${formatHour(w.time.hour, h24)} · ${formatDate(w.time.day)} (day ${Math.floor(w.time.day)})`, 7), 'info');
        ctx.print(kv('Speed', w.time.speed === 0 ? 'paused' : SPEED_NAMES[w.time.speed] ?? String(w.time.speed), 7), 'info');
        return;
      }
      const s = sub.toLowerCase();
      if (s === 'speed') return setSpeed(ctx, val);
      if (s === 'add' || s === 'skip') {
        const n = parseInt10(val);
        if (!Number.isFinite(n) || n < 1) throw new UsageError('Days must be a whole number ≥ 1.');
        if (n > 3600) throw new CommandError('At most 3600 days (10 years) at once.');
        ctx.cheat();
        const before = w.time.day;
        const t0 = performance.now();
        g.sim.advanceDays(n);
        const ms = performance.now() - t0;
        const skipped = Math.round(w.time.day - before);
        ctx.print(`⏩ Advanced ${skipped} day${skipped === 1 ? '' : 's'} in ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`} — it is now ${formatDate(w.time.day)}.`, 'ok');
        if (skipped < n) ctx.print('The simulation hit its time budget; the calendar jumped ahead for the rest.', 'warn');
        return;
      }
      // "/time set X" or the shorthand "/time X"
      const tok = s === 'set' ? val : sub;
      if (!tok) throw new UsageError();
      const hour = parseHour(tok);
      if (!Number.isFinite(hour)) throw new UsageError(`“${tok}” is not a time. Use HH:MM or a keyword like noon or dusk.`);
      g.sim.setHour(hour);
      ctx.print(`🕒 Time set to ${formatHour(hour, h24)}.`, 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'speed', category: 'Time & Weather',
    usage: '/speed <0-4|pause|1x|2x|4x|10x>',
    description: 'Set the simulation speed (0 = pause).',
    complete: (_a, i) => (i === 0 ? ['0', '1', '2', '3', '4', 'pause'] : []),
    run(ctx) {
      if (!ctx.args.length) {
        const w = ctx.world();
        ctx.print(`Speed: ${w.time.speed === 0 ? 'paused' : SPEED_NAMES[w.time.speed]}`, 'info');
        return;
      }
      setSpeed(ctx, ctx.args[0]);
    },
  }));

  reg.register(defineCommand({
    name: 'weather', category: 'Time & Weather',
    usage: '/weather <clear|cloudy|rain|storm|snow|fog|heatwave|blizzard> [days]',
    description: 'Force the weather for a number of days (cheat).',
    examples: ['/weather storm 2', '/weather snow', '/weather clear'],
    complete: (_a, i) => (i === 0 ? WEATHER_TYPES.slice() : i === 1 ? ['1', '3', '7'] : []),
    run(ctx) {
      const w = ctx.world();
      const [t, d] = ctx.args;
      if (!t) {
        const wt = w.weather;
        ctx.print(`${WEATHER_LABEL[wt.type] ?? wt.type} · ${Math.round(wt.intensity * 100)}% · ${wt.temperature.toFixed(1)} °C · changes in ${Math.max(0, wt.nextChange).toFixed(1)} days`, 'info');
        return;
      }
      const type = t.toLowerCase() as WeatherType;
      if (!WEATHER_TYPES.includes(type)) throw new UsageError(`Unknown weather “${t}”.`);
      let days: number | undefined;
      if (d !== undefined) {
        days = parseNumber(d);
        if (!Number.isFinite(days) || days <= 0 || days > 365) throw new UsageError('Days must be between 0 and 365.');
      }
      ctx.cheat();
      ctx.game.eventSystem.setWeather(type, undefined, days);
      ctx.print(`${WEATHER_LABEL[type]}${days ? ` for ${days} day${days === 1 ? '' : 's'}` : ''}.`, 'ok');
    },
  }));
}
