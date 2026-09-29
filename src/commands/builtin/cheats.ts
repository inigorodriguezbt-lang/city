// Cheats & sandbox tools: /give /summon /creative /fill /disasters
import type { World } from '../../world/World';
import { BFlag, Dir, ZoneType, type Building, type PlacementCheck } from '../../core/types';
import { formatMoney, formatNumber } from '../../core/util';
import { BUILDINGS, buildingDef } from '../../data/buildings';
import { MILESTONES } from '../../data/milestones';
import { zoneDef } from '../../data/zones';
import { defineCommand, type CmdCtx, type CommandRegistry } from '../CommandRegistry';
import { parseBool, parseInt10, parseNumber, suggest } from '../parse';
import {
  CommandError, UsageError, flyToCell, focusCell, looksNumeric, parseCell, parseZone, zoneCompletions,
} from '../util';

const GIVE_WHAT = ['money', 'unlockall', 'milestone', 'residents', 'building'];

/** Run `fn` with the world temporarily in creative mode (free + unlocked), without events. */
function asCreative<T>(w: World, fn: () => T): T {
  const prev = w.creative;
  w.creative = true;
  try {
    return fn();
  } finally {
    w.creative = prev;
  }
}

/** Find a valid spot for a catalog building at/near (x,y): spiral search, all rotations. */
function findPlacement(ctx: CmdCtx, w: World, defId: string, x: number, y: number, exact: boolean): { check: PlacementCheck; x: number; y: number; rot: Dir } | { reason: string } {
  const acts = ctx.game.actions;
  const rots = [Dir.S, Dir.E, Dir.N, Dir.W];
  let firstReason = '';
  const tryAt = (cx: number, cy: number) => {
    if (!w.inBounds(cx, cy)) return null;
    // prefer the rotation whose front faces an adjacent road
    for (const rot of rots) {
      const c = asCreative(w, () => acts.checkBuilding(defId, cx, cy, rot));
      if (c.ok) return { check: c, x: cx, y: cy, rot };
      if (!firstReason && c.reason) firstReason = c.reason;
    }
    return null;
  };
  const r0 = tryAt(x, y);
  if (r0) return r0;
  if (!exact) {
    for (let r = 1; r <= 12; r++) {
      const ring: [number, number][] = [];
      for (let i = -r; i <= r; i++) ring.push([x + i, y - r], [x + i, y + r], [x - r, y + i], [x + r, y + i]);
      ring.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
      for (const [cx, cy] of ring) {
        const res = tryAt(cx, cy);
        if (res) return res;
      }
    }
  }
  return { reason: firstReason || 'no valid spot nearby' };
}

function giveBuilding(ctx: CmdCtx, w: World, args: string[]): void {
  const id = args[0];
  if (!id) throw new UsageError('Which building? e.g. /give building fire_station');
  const def = buildingDef(id) ?? BUILDINGS.find((b) => b.name.toLowerCase() === id.toLowerCase());
  if (!def) {
    const alt = suggest(id, BUILDINGS.map((b) => b.id));
    throw new CommandError(`Unknown building “${id}”.${alt.length ? ` Did you mean ${alt.join(', ')}?` : ''}`);
  }
  let x: number, y: number, exact = false;
  if (args.length >= 3) {
    if (!looksNumeric(args[1]) || !looksNumeric(args[2])) throw new UsageError();
    ({ x, y } = parseCell(ctx.game, w, args, 1));
    exact = true;
  } else {
    const f = focusCell(ctx.game);
    x = Math.floor(f.x);
    y = Math.floor(f.y);
  }
  const spot = findPlacement(ctx, w, def.id, x, y, exact);
  if ('reason' in spot) throw new CommandError(`Cannot place ${def.name} ${exact ? `at (${x}, ${y})` : 'near the camera'}: ${spot.reason}.`);
  ctx.cheat();
  const res = asCreative(w, () => ctx.game.actions.placeBuilding(def.id, spot.x, spot.y, spot.rot));
  if (!res.ok) throw new CommandError(`Cannot place ${def.name}: ${res.reason ?? 'placement failed'}.`);
  const b = res.id !== undefined ? w.getBuilding(res.id) : w.buildingAt(spot.check.x, spot.check.y);
  if (b) completeConstruction(w, b);
  ctx.game.audio.play('place');
  ctx.print(`${def.icon} ${def.name} placed at (${spot.check.x}, ${spot.check.y})${b ? ` as #${b.id}` : ''} — free of charge.`, 'ok');
  if (!exact) flyToCell(ctx.game, spot.check.x + spot.check.w / 2, spot.check.y + spot.check.h / 2);
}

function completeConstruction(w: World, b: Building): void {
  if (b.built >= 1 && !(b.flags & BFlag.UnderConstruction)) return;
  b.built = 1;
  b.flags &= ~BFlag.UnderConstruction;
  w.touchBuilding(b);
}

export function registerCheats(reg: CommandRegistry): void {
  reg.register(defineCommand({
    name: 'give', category: 'Cheats', cheat: true,
    usage: '/give money <amount> | unlockall | milestone <n> | residents <n> | building <defId> [x y]',
    description: 'Money, unlocks, milestones, residents or free buildings.',
    examples: ['/give money 250k', '/give unlockall', '/give milestone 5', '/give residents 2000', '/give building stadium', '/give building fire_station 120 88'],
    complete: (args, i) => {
      if (i === 0) return GIVE_WHAT;
      const what = args[0]?.toLowerCase();
      if (i === 1) {
        if (what === 'money') return ['10k', '100k', '1m', '10m'];
        if (what === 'milestone') return MILESTONES.map((m) => String(m.index));
        if (what === 'residents') return ['100', '1000', '10000'];
        if (what === 'building') return BUILDINGS.map((b) => b.id);
      }
      if (what === 'building' && (i === 2 || i === 3)) return ['~'];
      return [];
    },
    run(ctx) {
      const w = ctx.world();
      const g = ctx.game;
      const what = ctx.args[0]?.toLowerCase();
      const rest = ctx.args.slice(1);
      switch (what) {
        case 'money':
        case 'cash': {
          const n = parseNumber(rest[0]);
          if (!Number.isFinite(n) || Math.abs(n) > 1e13) throw new UsageError('Amount must be a number like 50000, 250k or 2m.');
          ctx.cheat();
          w.economy.money += n;
          g.events.emit('money:changed', w.economy.money);
          g.audio.play('money');
          ctx.print(`💰 ${n >= 0 ? 'Added' : 'Removed'} ${formatMoney(Math.abs(n))} — balance ${formatMoney(w.economy.money)}${w.creative ? ' (creative mode is unlimited anyway)' : ''}.`, 'ok');
          return;
        }
        case 'unlockall':
        case 'unlock': {
          ctx.cheat();
          w.unlockAll = true;
          g.events.emit('unlocks:changed', null);
          g.audio.play('achievement');
          ctx.print('🔓 Every road, zone, building and style is unlocked.', 'ok');
          return;
        }
        case 'milestone': {
          const tok = rest.join(' ');
          let idx = parseInt10(tok);
          if (!Number.isFinite(idx)) idx = MILESTONES.find((m) => m.name.toLowerCase() === tok.toLowerCase())?.index ?? NaN;
          if (!Number.isFinite(idx) || idx < 0 || idx >= MILESTONES.length) throw new UsageError(`Milestone must be 0–${MILESTONES.length - 1} or a name like “${MILESTONES[5].name}”.`);
          if (idx <= w.milestone) {
            ctx.print(`${MILESTONES[idx].name} is already reached (current: ${MILESTONES[w.milestone].name}).`, 'warn');
            return;
          }
          ctx.cheat();
          const from = w.milestone;
          g.sim.grantMilestone(idx);
          ctx.print(`🏆 Milestone granted: ${MILESTONES[idx].name} (${formatNumber(MILESTONES[idx].population)} citizens).`, 'ok');
          for (const m of MILESTONES.slice(from + 1, idx + 1)) ctx.print(`   ${m.name}: ${m.unlocksText.join(', ')}`, 'info');
          return;
        }
        case 'residents':
        case 'people':
        case 'population': {
          const n = parseInt10(rest[0]);
          if (!Number.isFinite(n) || n < 1 || n > 5_000_000) throw new UsageError('Residents must be between 1 and 5,000,000.');
          ctx.cheat();
          const before = w.stats.population;
          g.sim.addResidents(n);
          const moved = w.stats.population - before;
          ctx.print(`👪 ${formatNumber(moved)} residents moved in${moved < n ? ` (${formatNumber(n - moved)} more will arrive as homes free up)` : ''} — population ${formatNumber(w.stats.population)}.`, 'ok');
          return;
        }
        case 'building':
        case 'bldg':
          giveBuilding(ctx, w, rest);
          return;
        default:
          throw new UsageError(what ? `Cannot give “${what}”.` : '');
      }
    },
  }));

  reg.register(defineCommand({
    name: 'summon', aliases: ['event', 'trigger'], category: 'Cheats', cheat: true,
    usage: '/summon <event id> [x y | random]',
    description: 'Start an event or disaster (tornado, meteor, fire, festival, ufo…) at the camera or a cell.',
    examples: ['/summon tornado', '/summon meteor 140 90', '/summon festival', '/summon earthquake random'],
    complete: (_a, i) => (i === 0 ? safeSummonables(reg) : i === 1 ? ['random', '~'] : []),
    run(ctx) {
      const w = ctx.world();
      const es = ctx.game.eventSystem;
      const id = ctx.args[0];
      const ids = safeSummonables(reg);
      if (!id) {
        if (!ids.length) throw new CommandError('No events can be summoned right now.');
        ctx.print('Summonable events: ' + ids.join(', '), 'info');
        throw new UsageError();
      }
      const key = ids.find((s) => s.toLowerCase() === id.toLowerCase());
      if (!key) {
        const alt = suggest(id, ids);
        throw new CommandError(ids.length ? `Unknown event “${id}”.${alt.length ? ` Did you mean ${alt.join(', ')}?` : ''} Try /summon with Tab.` : 'No events can be summoned right now.');
      }
      let at: { x: number; y: number } | undefined;
      if (ctx.args[1]?.toLowerCase() === 'random') at = undefined;
      else if (ctx.args.length >= 3) at = parseCell(ctx.game, w, ctx.args, 1);
      else {
        const f = focusCell(ctx.game);
        at = { x: Math.floor(f.x), y: Math.floor(f.y) };
        if (!w.inBounds(at.x, at.y)) at = undefined;
      }
      ctx.cheat();
      const ev = es.trigger(key, at);
      if (!ev) throw new CommandError(`${key} could not start here (wrong season, terrain or no valid target).`);
      const def = es.catalog.find((d) => d.id === key);
      const where = ev.x !== undefined && ev.y !== undefined ? ` at (${ev.x}, ${ev.y})` : at ? ` near (${at.x}, ${at.y})` : '';
      ctx.print(`${def?.icon ?? '⚡'} ${def?.name ?? key} summoned${where}.`, def?.disaster || def?.severity === 'disaster' || def?.severity === 'danger' ? 'warn' : 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'creative', aliases: ['sandbox'], category: 'Cheats',
    usage: '/creative on|off',
    description: 'Unlimited money and everything unlocked (turning it on counts as a cheat).',
    complete: (_a, i) => (i === 0 ? ['on', 'off'] : []),
    run(ctx) {
      const w = ctx.world();
      const on = ctx.args[0] === undefined ? undefined : parseBool(ctx.args[0]);
      if (ctx.args[0] !== undefined && on === undefined) throw new UsageError();
      if (on === undefined) {
        ctx.print(`Creative mode is ${w.creative ? 'on' : 'off'}.`, 'info');
        return;
      }
      if (on === w.creative) {
        ctx.print(`Creative mode is already ${on ? 'on' : 'off'}.`, 'warn');
        return;
      }
      if (on) ctx.cheat();
      ctx.game.setCreative(on);
      ctx.print(on ? '🎨 Creative mode on — unlimited money, everything unlocked.' : 'Creative mode off — back to a real budget.', 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'disasters', category: 'City',
    usage: '/disasters on|off',
    description: 'Enable or disable random disasters for this city.',
    complete: (_a, i) => (i === 0 ? ['on', 'off'] : []),
    run(ctx) {
      const w = ctx.world();
      const on = ctx.args[0] === undefined ? undefined : parseBool(ctx.args[0]);
      if (ctx.args[0] !== undefined && on === undefined) throw new UsageError();
      if (on === undefined) {
        ctx.print(`Random disasters are ${w.settings.disasters ? 'on' : 'off'}.`, 'info');
        return;
      }
      w.settings.disasters = on;
      ctx.print(on ? '🌪️ Random disasters enabled. Stay prepared!' : '🛡️ Random disasters disabled.', 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'fill', aliases: ['zone'], category: 'Cheats', cheat: true,
    usage: '/fill <zone> <x0> <y0> <x1> <y1>  |  /fill <zone> <radius>',
    description: 'Zone every eligible cell in a rectangle (or a square around the camera).',
    examples: ['/fill res_low 100 100 140 120', '/fill com_high 6', '/fill none ~-5 ~-5 ~5 ~5'],
    complete: (_a, i) => (i === 0 ? zoneCompletions() : i < 5 ? ['~'] : []),
    run(ctx) {
      const w = ctx.world();
      const [ztok, ...rest] = ctx.args;
      const zone = parseZone(ztok);
      if (zone === undefined) throw new UsageError(ztok ? `Unknown zone “${ztok}”.` : '');
      let x0: number, y0: number, x1: number, y1: number;
      if (rest.length === 1) {
        const r = parseInt10(rest[0]);
        if (!Number.isFinite(r) || r < 0 || r > 64) throw new UsageError('Radius must be 0–64 cells.');
        const f = focusCell(ctx.game);
        x0 = Math.floor(f.x) - r; y0 = Math.floor(f.y) - r; x1 = Math.floor(f.x) + r; y1 = Math.floor(f.y) + r;
      } else if (rest.length >= 4) {
        const a = parseCell(ctx.game, w, rest, 0), b = parseCell(ctx.game, w, rest, 2);
        x0 = Math.min(a.x, b.x); y0 = Math.min(a.y, b.y); x1 = Math.max(a.x, b.x); y1 = Math.max(a.y, b.y);
      } else throw new UsageError();
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w.size - 1, x1); y1 = Math.min(w.size - 1, y1);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      if (area > 256 * 256) throw new CommandError('That area is too large (max 65,536 cells at once).');
      const rect = { x0, y0, x1, y1 };
      const count = () => {
        let n = 0;
        w.forEachCellInRect(rect, (_x, _y, i) => { if (w.zone[i] === zone) n++; });
        return n;
      };
      const before = count();
      ctx.cheat();
      const res = asCreative(w, () => ctx.game.actions.zoneRect(rect, zone));
      const changed = Math.abs(count() - before);
      const name = zone === ZoneType.None ? 'Dezoned' : `Zoned ${zoneDef(zone).name}:`;
      if (!res.ok && !changed) throw new CommandError(`Nothing zoned: ${res.reason ?? 'no eligible cells (zones need a nearby road)'}.`);
      ctx.game.audio.play('zone');
      ctx.print(`${name} ${formatNumber(changed)} cell${changed === 1 ? '' : 's'} in (${x0}, ${y0})–(${x1}, ${y1}).`, 'ok');
    },
  }));
}

function safeSummonables(reg: CommandRegistry): string[] {
  try {
    return reg.owner.eventSystem.summonables().slice();
  } catch {
    return [];
  }
}

