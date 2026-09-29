// City management & saves: /bulldoze /kill /save /load /saves /export
import { BFlag, type Building } from '../../core/types';
import { formatMoney, formatNumber } from '../../core/util';
import { describeSave } from '../../save/SaveManager';
import { defineCommand, type CommandRegistry } from '../CommandRegistry';
import { CommandError, UsageError } from '../util';

type TrafficWithClear = { clearVehicles?: () => number | void; clear?: () => number | void; reset?: () => void };

const BULLDOZE_TARGETS: Record<string, { label: string; test: (b: Building) => boolean }> = {
  abandoned: { label: 'abandoned buildings', test: (b) => (b.flags & BFlag.Abandoned) !== 0 },
  rubble: { label: 'ruins', test: (b) => (b.flags & (BFlag.Collapsed | BFlag.Burned)) !== 0 },
  derelict: { label: 'abandoned buildings and ruins', test: (b) => (b.flags & (BFlag.Abandoned | BFlag.Collapsed | BFlag.Burned)) !== 0 },
};
BULLDOZE_TARGETS.ruins = BULLDOZE_TARGETS.rubble;
BULLDOZE_TARGETS.burned = BULLDOZE_TARGETS.rubble;

export function registerCity(reg: CommandRegistry): void {
  reg.register(defineCommand({
    name: 'bulldoze', aliases: ['demolish'], category: 'City',
    usage: '/bulldoze abandoned | rubble | derelict',
    description: 'Clear every abandoned building and/or ruin in the city.',
    complete: (_a, i) => (i === 0 ? ['abandoned', 'rubble', 'derelict'] : []),
    run(ctx) {
      const w = ctx.world();
      const what = ctx.args[0]?.toLowerCase();
      const t = what ? BULLDOZE_TARGETS[what] : undefined;
      if (!t) throw new UsageError(what ? `Cannot bulldoze “${what}”.` : '');
      const targets = [...w.buildings.values()].filter(t.test);
      if (!targets.length) {
        ctx.print(`There are no ${t.label}. 🎉`, 'ok');
        return;
      }
      let done = 0, cost = 0, failed = 0;
      for (const b of targets) {
        const r = ctx.game.actions.bulldozeBuilding(b.id);
        if (r.ok) {
          done++;
          cost += r.cost;
        } else failed++;
      }
      if (done) ctx.game.audio.play('bulldoze');
      const money = cost > 0 ? ` for ${formatMoney(cost)}` : cost < 0 ? ` (refund ${formatMoney(-cost)})` : '';
      ctx.print(`🚜 Cleared ${formatNumber(done)} ${t.label}${money}.`, done ? 'ok' : 'warn');
      if (failed) ctx.print(`${failed} could not be removed right now.`, 'warn');
    },
  }));

  reg.register(defineCommand({
    name: 'kill', category: 'City',
    usage: '/kill vehicles',
    description: 'Remove every vehicle from the streets (they respawn naturally).',
    complete: (_a, i) => (i === 0 ? ['vehicles'] : []),
    run(ctx) {
      const w = ctx.world();
      if (!/^(vehicles|cars|traffic)$/i.test(ctx.args[0] ?? '')) throw new UsageError();
      const g = ctx.game;
      const before = g.traffic.vehicleCount;
      const tr = g.traffic as unknown as TrafficWithClear;
      const direct = tr.clearVehicles ?? tr.clear;
      if (typeof direct === 'function') {
        direct.call(g.traffic);
      } else {
        // no dedicated API: re-attach the traffic system and vehicle renderer to the
        // world, which drops every transient vehicle (they are never persisted)
        g.vehicles.onWorldUnloaded();
        g.traffic.onWorldUnloaded();
        g.traffic.onWorldLoaded(w);
        g.vehicles.onWorldLoaded(w);
      }
      const removed = Math.max(0, before - g.traffic.vehicleCount);
      ctx.print(`🚗 Cleared ${formatNumber(removed || before)} vehicle${(removed || before) === 1 ? '' : 's'} — traffic will rebuild gradually.`, 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'save', category: 'Saves',
    usage: '/save [name]',
    description: 'Save the city (a save with the same name in this city is overwritten).',
    examples: ['/save', '/save "Before the flood"'],
    complete: (_a, i) => (i === 0 ? saveNames(reg, true) : []),
    async run(ctx) {
      const w = ctx.world();
      const g = ctx.game;
      const name = ctx.args.join(' ').trim() || w.settings.cityName;
      const city = g.saves.currentCityId();
      const all = await g.saves.list();
      const existing = all.find((m) => !m.auto && m.name.toLowerCase() === name.toLowerCase() && (!city || m.cityId === city));
      ctx.print(`💾 Saving “${name}”…`, 'system');
      const meta = await g.saves.save(name, { overwriteId: existing?.id });
      if (!meta) throw new CommandError('The save failed (see the notification for details).');
      ctx.print(`Saved “${meta.name}”${existing ? ' (overwritten)' : ''} · ${(meta.bytes / 1024).toFixed(0)} KB${meta.volatile ? ' · session only — use /export to keep it' : ''}.`, meta.volatile ? 'warn' : 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'load', category: 'Saves',
    usage: '/load <save name>',
    description: 'Load a save by name (current city first, newest first). Without a name, lists saves.',
    examples: ['/load Quicksave', '/load "Autosave 2"'],
    complete: (_a, i) => (i === 0 ? saveNames(reg, false) : []),
    async run(ctx) {
      const g = ctx.game;
      const q = ctx.args.join(' ').trim();
      if (!q) {
        await listSaves(reg, ctx.print, 8);
        return;
      }
      const meta = await g.saves.findByName(q);
      if (!meta) throw new CommandError(`No save matches “${q}”. /saves lists them all.`);
      ctx.print(`📂 Loading “${meta.name}” (${meta.cityName})…`, 'system');
      g.chat.close();
      const ok = await g.saves.load(meta.id);
      if (!ok) throw new CommandError(`“${meta.name}” could not be loaded.`);
      ctx.print(`Loaded “${meta.name}”.`, 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'saves', aliases: ['list'], category: 'Saves',
    usage: '/saves', description: 'List stored saves, newest first.',
    async run(ctx) {
      await listSaves(reg, ctx.print, 20);
    },
  }));

  reg.register(defineCommand({
    name: 'export', category: 'Saves',
    usage: '/export', description: 'Download the city as a .urbis file you can import anywhere.',
    async run(ctx) {
      ctx.world();
      await ctx.game.saves.exportCurrent();
      ctx.print('Export started — check your downloads.', 'ok');
    },
  }));
}

async function listSaves(reg: CommandRegistry, print: (t: string, k?: 'info' | 'ok' | 'warn' | 'error' | 'system') => void, max: number): Promise<void> {
  const all = await reg.owner.saves.list();
  if (!all.length) {
    print('No saves yet — /save creates one (F5 quicksaves).', 'warn');
    return;
  }
  print(`Saves (${all.length}, newest first):`, 'system');
  for (const m of all.slice(0, max)) print(`  ${m.auto ? '⟳' : m.quick ? '⚡' : '💾'} ${describeSave(m)}`, 'info');
  if (all.length > max) print(`  … and ${all.length - max} more`, 'info');
  print('Load one with /load <name> (Tab completes names).', 'system');
}

function saveNames(reg: CommandRegistry, manualOnly: boolean): string[] {
  const g = reg.owner;
  const list = g.saves.cachedList ?? [];
  // refresh in the background so the next Tab sees fresh names
  void g.saves.list().catch(() => undefined);
  const city = g.saves.currentCityId();
  const sorted = list.slice().sort((a, b) => (a.cityId === city ? 0 : 1) - (b.cityId === city ? 0 : 1) || b.savedAt - a.savedAt);
  return [...new Set(sorted.filter((m) => !manualOnly || !m.auto).map((m) => m.name))];
}
