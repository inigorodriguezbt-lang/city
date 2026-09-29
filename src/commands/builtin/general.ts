// General & information commands: /help /clear /stats /budget /season /seed
// /fps /where /overlay /photo /screenshot
import type { UIManager } from '../../ui/UIManager';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../../core/constants';
import { calendar, formatDate, formatHour, seasonOfMonth } from '../../core/time';
import { formatMoney, formatNumber } from '../../core/util';
import { RoadType } from '../../core/types';
import { MILESTONES } from '../../data/milestones';
import { OVERLAYS } from '../../data/overlays';
import { roadDef } from '../../data/roads';
import { zoneDef } from '../../data/zones';
import { THEMES } from '../../data/themes';
import { STYLES } from '../../data/styles';
import { defineCommand, type CommandCategory, type CommandDef, type CommandRegistry } from '../CommandRegistry';
import { parseBool } from '../parse';
import {
  UsageError, WEATHER_LABEL, bar, buildingLabel, focusCell, formatDuration, kv, parseOverlay, signed, statusTags, title,
} from '../util';

const CATEGORY_ORDER: CommandCategory[] = ['General', 'Camera', 'City', 'Time & Weather', 'Saves', 'Cheats'];

const TAX_LABEL: Record<string, string> = { resLow: 'R', resHigh: 'R++', comLow: 'C', comHigh: 'C++', office: 'O', industry: 'I' };

function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function registerGeneral(reg: CommandRegistry): void {
  reg.register(defineCommand({
    name: 'help', aliases: ['?', 'h', 'commands'], category: 'General',
    usage: '/help [command]',
    description: 'List every command, or explain one in detail.',
    examples: ['/help', '/help give'],
    complete: (_a, i) => (i === 0 ? reg.list().filter((c) => !c.hidden).map((c) => c.name) : []),
    run(ctx) {
      const q = ctx.args[0];
      if (q) {
        const c = reg.get(q);
        if (!c) throw new UsageError(`No command called “${q}”.`);
        ctx.print(title(`/${c.name}${c.cheat ? '  (cheat)' : ''}`), 'system');
        ctx.print(c.description, 'info');
        for (const d of c.details ?? []) ctx.print('  ' + d, 'info');
        ctx.print(kv('Usage', c.usage, 9), 'ok');
        if (c.aliases?.length) ctx.print(kv('Aliases', c.aliases.map((a) => '/' + a).join(' '), 9), 'info');
        for (const ex of c.examples ?? []) ctx.print(kv('Example', ex, 9), 'info');
        return;
      }
      ctx.print(title('URBIS commands'), 'system');
      const groups = new Map<CommandCategory, CommandDef[]>();
      for (const c of reg.list()) {
        if (c.hidden) continue;
        const cat = c.category ?? 'General';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(c);
      }
      for (const cat of [...CATEGORY_ORDER, ...[...groups.keys()].filter((k) => !CATEGORY_ORDER.includes(k))]) {
        const list = groups.get(cat);
        if (!list?.length) continue;
        ctx.print(cat.toUpperCase(), 'warn');
        for (const c of list.sort((a, b) => a.name.localeCompare(b.name))) {
          ctx.print(`  ${('/' + c.name).padEnd(12)} ${c.description}${c.cheat ? '  (cheat)' : ''}`, 'info');
        }
      }
      ctx.print('Tab completes · ↑/↓ history · /help <command> for details · cheats disable achievements', 'system');
    },
  }));

  reg.register(defineCommand({
    name: 'clear', aliases: ['cls'], category: 'General',
    usage: '/clear', description: 'Clear the chat log.',
    run(ctx) {
      ctx.game.chat.clear();
    },
  }));

  reg.register(defineCommand({
    name: 'stats', aliases: ['info', 'city'], category: 'General',
    usage: '/stats', description: 'City overview: population, money, services, traffic.',
    run(ctx) {
      const w = ctx.world();
      const s = w.stats;
      const cal = calendar(w.time.day);
      const ms = MILESTONES[w.milestone] ?? MILESTONES[0];
      const next = MILESTONES[w.milestone + 1];
      ctx.print(title(w.settings.cityName), 'system');
      ctx.print(kv('Date', `${formatDate(w.time.day)} · ${formatHour(w.time.hour)} · ${cal.season[0].toUpperCase() + cal.season.slice(1)} · day ${Math.floor(w.time.day)}`), 'info');
      ctx.print(kv('Population', `${formatNumber(s.population)}  (${formatNumber(s.households)} households · +${formatNumber(s.movedIn)} in / −${formatNumber(s.movedOut)} out)`), 'info');
      ctx.print(kv('Milestone', `${ms.name} (${w.milestone}/${MILESTONES.length - 1})${next ? ` — next: ${next.name} at ${formatNumber(next.population)}` : ' — the final milestone!'}`), 'info');
      ctx.print(kv('Money', w.creative ? 'Unlimited (creative mode)' : `${formatMoney(w.economy.money)} · net ${signed(s.netIncome, (v) => formatMoney(v))}/month`), w.economy.money < 0 && !w.creative ? 'error' : 'ok');
      ctx.print(kv('Happiness', `${bar(s.happiness / 100)} ${Math.round(s.happiness)}%`), s.happiness >= 60 ? 'ok' : s.happiness >= 40 ? 'info' : 'warn');
      ctx.print(kv('Health', `${bar(s.health / 100)} ${Math.round(s.health)}%`), 'info');
      ctx.print(kv('Education', `${bar(s.education / 100)} ${Math.round(s.education)}%`), 'info');
      const unemp = s.workforce > 0 ? s.unemployed / s.workforce : 0;
      ctx.print(kv('Jobs', `${formatNumber(s.jobs)} jobs · ${formatNumber(s.employed)} employed · ${pct(unemp, 1)} unemployed`), unemp > 0.12 ? 'warn' : 'info');
      const d = s.demand;
      const dm = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
      ctx.print(kv('Demand', `R ${dm(d.res)}   C ${dm(d.com)}   I ${dm(d.ind)}   O ${dm(d.off)}`), 'info');
      const util = (label: string, used: number, cap: number, unit: string) => {
        const r = cap > 0 ? used / cap : used > 0 ? Infinity : 0;
        ctx.print(kv(label, `${formatNumber(used)} / ${formatNumber(cap)} ${unit}${cap > 0 ? ` (${Math.round(r * 100)}%)` : ''}`), r > 1 ? 'error' : r > 0.9 ? 'warn' : 'info');
      };
      util('Power', s.power.consumed, s.power.produced, 'MW');
      util('Water', s.water.consumed, s.water.produced, 'm³/day');
      util('Sewage', s.sewage.produced, s.sewage.capacity, 'm³/day');
      util('Garbage', s.garbage.produced, s.garbage.capacity, 't/month');
      ctx.print(kv('Crime', `${Math.round(s.crimeRate)}%   Pollution ${Math.round(s.pollution)}%   Land value ${Math.round(s.landValue)}`), 'info');
      ctx.print(kv('Traffic', `${Math.round(s.trafficFlow)}% flow · ${formatNumber(s.vehicles)} vehicles`), s.trafficFlow < 60 ? 'warn' : 'info');
      ctx.print(kv('Buildings', `${formatNumber(w.buildings.size)} · tourists ${formatNumber(s.tourists)} · students ${formatNumber(s.students)}`), 'info');
      ctx.print(kv('Played', `${formatDuration(w.playTime)}${w.creative ? ' · creative' : ''}${w.ext.cheated === true ? ' · cheats used' : ''}`), 'info');
    },
  }));

  reg.register(defineCommand({
    name: 'budget', aliases: ['money', 'finance'], category: 'General',
    usage: '/budget', description: 'Monthly income, expenses, taxes and loans.',
    run(ctx) {
      const w = ctx.world();
      const e = w.economy;
      let inc = e.lastIncome, exp = e.lastExpense, label = 'last month';
      if (!Object.keys(inc).length && !Object.keys(exp).length) {
        const p = ctx.game.sim.projection();
        inc = p.income;
        exp = p.expense;
        label = 'projected';
      }
      const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
      const ti = sum(inc), te = sum(exp);
      ctx.print(title(`Budget · ${label}`), 'system');
      ctx.print(kv('Balance', w.creative ? 'Unlimited (creative mode)' : formatMoney(e.money)), e.money < 0 && !w.creative ? 'error' : 'ok');
      ctx.print(kv('Income', '+' + formatMoney(ti)), 'ok');
      for (const [k, v] of Object.entries(inc).sort((a, b) => b[1] - a[1]).slice(0, 8)) if (v) ctx.print(`   ${prettyKey(k).padEnd(20)} ${formatMoney(v)}`, 'info');
      ctx.print(kv('Expenses', '−' + formatMoney(te).replace('-', '')), 'warn');
      for (const [k, v] of Object.entries(exp).sort((a, b) => b[1] - a[1]).slice(0, 10)) if (v) ctx.print(`   ${prettyKey(k).padEnd(20)} ${formatMoney(v)}`, 'info');
      const net = ti - te;
      ctx.print(kv('Net', `${signed(net, (v) => formatMoney(v))}/month`), net >= 0 ? 'ok' : 'error');
      ctx.print(kv('Taxes', Object.entries(e.taxes).map(([k, v]) => `${TAX_LABEL[k] ?? k} ${Math.round(v * 100)}%`).join(' · ')), 'info');
      if (e.loans.length) {
        const rem = e.loans.reduce((a, l) => a + l.remaining, 0), pay = e.loans.reduce((a, l) => a + l.payment, 0);
        ctx.print(kv('Loans', `${e.loans.length} · ${formatMoney(rem)} remaining · ${formatMoney(pay)}/month`), 'warn');
      } else ctx.print(kv('Loans', 'none'), 'info');
    },
  }));

  reg.register(defineCommand({
    name: 'season', aliases: ['date', 'calendar'], category: 'Time & Weather',
    usage: '/season', description: 'Current date, season, climate and weather.',
    run(ctx) {
      const w = ctx.world();
      const cal = calendar(w.time.day);
      let monthsAhead = 1;
      while (monthsAhead < 12 && seasonOfMonth((cal.month + monthsAhead) % MONTHS_PER_YEAR) === cal.season) monthsAhead++;
      const nextSeason = seasonOfMonth((cal.month + monthsAhead) % MONTHS_PER_YEAR);
      const daysLeft = monthsAhead * DAYS_PER_MONTH - (cal.dayOfMonth - 1);
      const th = w.theme;
      const icon = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' }[cal.season];
      ctx.print(title(`${icon} ${cal.season[0].toUpperCase() + cal.season.slice(1)} ${cal.year}`), 'system');
      ctx.print(kv('Date', `${formatDate(w.time.day)} · ${formatHour(w.time.hour, ctx.game.settings.value.ui.clock24h)}`), 'info');
      ctx.print(kv('Next season', `${nextSeason} in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`), 'info');
      const wt = w.weather;
      ctx.print(kv('Weather', `${WEATHER_LABEL[wt.type] ?? wt.type} · ${Math.round(wt.intensity * 100)}% · ${wt.temperature.toFixed(1)} °C · wind ${wt.windSpeed.toFixed(1)} m/s`), 'info');
      if (wt.snowCover > 0.02) ctx.print(kv('Snow cover', `${Math.round(wt.snowCover * 100)}%`), 'info');
      ctx.print(kv('Climate', `${th.name} · ${Math.round(th.tempMean - th.tempSwing)}…${Math.round(th.tempMean + th.tempSwing)} °C · rain ${Math.round(th.rainfall * 100)}% · snow ${Math.round(th.snowiness * 100)}%`), 'info');
    },
  }));

  reg.register(defineCommand({
    name: 'seed', aliases: ['mapinfo'], category: 'General',
    usage: '/seed', description: 'Show (and copy) the map seed and generation settings.',
    async run(ctx) {
      const w = ctx.world();
      const s = w.settings;
      const theme = THEMES.find((t) => t.id === s.theme)?.name ?? s.theme;
      const style = STYLES.find((t) => t.id === s.style)?.name ?? s.style;
      ctx.print(title('Map'), 'system');
      ctx.print(kv('Seed', String(s.seed)), 'ok');
      ctx.print(kv('Map', `${theme} · ${s.mapSize} (${w.size}×${w.size} cells, ${((w.size * 16) / 1000).toFixed(1)} km)`), 'info');
      ctx.print(kv('Generation', `mountains ${pct(s.mountains)} · water ${pct(s.water)} · forests ${pct(s.forests)}`), 'info');
      ctx.print(kv('Rules', `${s.difficulty} · ${style} style · disasters ${s.disasters ? 'on' : 'off'}${w.creative ? ' · creative' : ''}`), 'info');
      try {
        await navigator.clipboard.writeText(String(s.seed));
        ctx.print('Seed copied to the clipboard.', 'system');
      } catch {
        /* clipboard not permitted */
      }
    },
  }));

  reg.register(defineCommand({
    name: 'fps', aliases: ['perf'], category: 'General',
    usage: '/fps [on|off]', description: 'Show frame rate & renderer stats, or toggle the performance overlay.',
    complete: (_a, i) => (i === 0 ? ['on', 'off'] : []),
    run(ctx) {
      const g = ctx.game;
      const on = parseBool(ctx.args[0]);
      if (ctx.args[0] !== undefined && on === undefined) throw new UsageError();
      if (on !== undefined) {
        g.settings.set({ graphics: { showFps: on } });
        ctx.print(`Performance overlay ${on ? 'shown' : 'hidden'} (F3 toggles it).`, 'ok');
        return;
      }
      const st = g.renderer.stats;
      const fps = g.fps || st.fps;
      ctx.print(kv('FPS', `${fps.toFixed(1)}${st.frameMs ? ` · ${st.frameMs.toFixed(1)} ms/frame` : ''}`, 10), fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'error');
      ctx.print(kv('Renderer', `${formatNumber(st.drawCalls)} draw calls · ${formatNumber(st.triangles, true)} triangles`, 10), 'info');
      if (g.world) ctx.print(kv('World', `${formatNumber(g.world.buildings.size)} buildings · ${formatNumber(g.world.stats.vehicles)} vehicles`, 10), 'info');
      ctx.print('Tip: /fps on shows the live overlay.', 'system');
    },
  }));

  reg.register(defineCommand({
    name: 'where', aliases: ['pos', 'coords', 'whereami'], category: 'Camera',
    usage: '/where', description: 'Describe the cell at the camera focus (use its coordinates in other commands).',
    run(ctx) {
      const w = ctx.world();
      const f = focusCell(ctx.game);
      const x = Math.floor(f.x), y = Math.floor(f.y);
      if (!w.inBounds(x, y)) {
        ctx.print(`Camera focus (${x}, ${y}) is outside the map.`, 'warn');
        return;
      }
      ctx.print(title(`Cell ${x}, ${y}`), 'system');
      ctx.print(kv('Terrain', `${w.cellHeight(x, y).toFixed(1)} m · slope ${Math.round(w.cellSlope(x, y) * 100)}%${w.isWater(x, y) ? ` · water ${w.waterDepth(x, y).toFixed(1)} m deep` : w.isShore(x, y) ? ' · shoreline' : ''}`), 'info');
      const r = w.roadAt(x, y);
      if (r !== RoadType.None) ctx.print(kv('Road', `${roadDef(r)?.name ?? 'Road'}${w.isBridge(x, y) ? ' (bridge)' : ''}`), 'info');
      const z = w.zoneAt(x, y);
      if (z) ctx.print(kv('Zone', zoneDef(z)?.name ?? String(z)), 'info');
      const b = w.buildingAt(x, y);
      if (b) ctx.print(kv('Building', `#${b.id} ${buildingLabel(b)}${statusTags(b)}`), 'ok');
      const d = w.district[w.idx(x, y)];
      if (d) ctx.print(kv('District', w.districts.find((dd) => dd.id === d)?.name ?? `#${d}`), 'info');
      ctx.print(kv('Land value', `${w.field('landValue', x, y)} · pollution ${w.field('pollution', x, y)} · noise ${w.field('noise', x, y)}`), 'info');
      ctx.print(`Use “~” for relative coordinates, e.g. /tp ~10 ~-5`, 'system');
    },
  }));

  reg.register(defineCommand({
    name: 'overlay', aliases: ['infoview', 'view'], category: 'Camera',
    usage: '/overlay <field|off>', description: 'Show an info view (land value, pollution, traffic, power…).',
    examples: ['/overlay landValue', '/overlay pollution', '/overlay off'],
    complete: (_a, i) => (i === 0 ? [...OVERLAYS.map((o) => o.id), 'off'] : []),
    run(ctx) {
      const g = ctx.game;
      const q = ctx.args.join(' ');
      if (!q) {
        const cur = g.renderer.overlay;
        ctx.print(`Current info view: ${cur ? OVERLAYS.find((o) => o.id === cur)?.name ?? cur : 'none'}`, 'info');
        ctx.print('Available: ' + OVERLAYS.map((o) => o.id).join(', '), 'system');
        return;
      }
      const f = parseOverlay(q);
      if (f === undefined) throw new UsageError(`Unknown info view “${q}”.`);
      g.renderer.setOverlay(f);
      const info = f ? OVERLAYS.find((o) => o.id === f) : null;
      ctx.print(info ? `${info.icon} ${info.name} — ${info.low} → ${info.high}` : 'Info view off.', 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'photo', aliases: ['photomode'], category: 'Camera',
    usage: '/photo', description: 'Toggle photo mode (hides the interface for clean shots).',
    run(ctx) {
      const g = ctx.game;
      const ui = g.ui as UIManager & { setPhotoMode?: (on: boolean) => void; isPhotoMode?: () => boolean };
      g.chat.close();
      if (typeof ui.setPhotoMode === 'function') {
        const on = !(ui.isPhotoMode?.() ?? false);
        ui.setPhotoMode(on);
        ctx.print(on ? 'Photo mode on — press P or Esc to leave.' : 'Photo mode off.', 'ok');
      } else {
        ui.setHudVisible(!ui.hudVisible);
        ctx.print(ui.hudVisible ? 'Interface shown.' : 'Interface hidden — press F1 to bring it back.', 'ok');
      }
    },
  }));

  reg.register(defineCommand({
    name: 'screenshot', aliases: ['shot', 'snap'], category: 'Camera',
    usage: '/screenshot', description: 'Save a screenshot of the city (same as F2).',
    async run(ctx) {
      ctx.world();
      await ctx.game.downloadScreenshot();
      ctx.print('Screenshot saved to your downloads.', 'ok');
    },
  }));
}
