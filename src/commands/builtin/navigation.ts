// Camera navigation: /tp and /locate (with /locate next cycling).
import type { World } from '../../world/World';
import { BFlag, type Building, type ZoneCategory } from '../../core/types';
import { BUILDINGS, CATEGORY_INFO, buildingDef } from '../../data/buildings';
import { ZONES, zoneDef } from '../../data/zones';
import { defineCommand, type CmdCtx, type CommandRegistry } from '../CommandRegistry';
import { parseInt10 } from '../parse';
import {
  CommandError, UsageError, buildingCenter, buildingIcon, buildingKindName, buildingLabel, distCells, flyToCell,
  fmtDistance, focusCell, looksNumeric, parseCategory, parseCell, parseZone, statusTags,
} from '../util';

/** close-up camera distance used when jumping to a building (m) */
const BUILDING_VIEW = 260;

interface LocateState {
  label: string;
  ids: number[];
  index: number;
}

const SPECIAL: Record<string, { label: string; test: (b: Building) => boolean }> = {
  abandoned: { label: 'abandoned buildings', test: (b) => (b.flags & BFlag.Abandoned) !== 0 },
  burning: { label: 'burning buildings', test: (b) => (b.flags & BFlag.OnFire) !== 0 },
  rubble: { label: 'ruins', test: (b) => (b.flags & (BFlag.Collapsed | BFlag.Burned)) !== 0 },
  construction: { label: 'construction sites', test: (b) => (b.flags & BFlag.UnderConstruction) !== 0 },
  flooded: { label: 'flooded buildings', test: (b) => (b.flags & BFlag.Flooded) !== 0 },
  problems: { label: 'buildings with problems', test: (b) => b.problems !== 0 },
  named: { label: 'named buildings', test: (b) => !!b.name },
  services: { label: 'service buildings', test: (b) => b.kind === 'service' },
};
SPECIAL.onfire = SPECIAL.burning;
SPECIAL.fires = SPECIAL.burning;
SPECIAL.ruins = SPECIAL.rubble;

const ZONE_CATS: Record<string, ZoneCategory> = {
  residential: 'res', res: 'res', homes: 'res', commercial: 'com', com: 'com', shops: 'com',
  industrial: 'ind', industry: 'ind', ind: 'ind', offices: 'off', office: 'off', off: 'off',
};

/** Resolve a /locate query into a labelled set of buildings. */
export function findBuildings(world: World, query: string): { label: string; list: Building[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const all = [...world.buildings.values()];
  const sp = SPECIAL[q];
  if (sp) return { label: sp.label, list: all.filter(sp.test) };
  if (/^#?\d+$/.test(q)) {
    const b = world.getBuilding(Number(q.replace('#', '')));
    return { label: b ? buildingLabel(b) : `building #${q}`, list: b ? [b] : [] };
  }
  const def = buildingDef(q);
  if (def) return { label: def.name, list: all.filter((b) => b.defId === def.id) };
  const zc = ZONE_CATS[q];
  if (zc) return { label: `${q} buildings`, list: all.filter((b) => b.kind === 'zoned' && zoneDef(b.zone)?.category === zc) };
  const zt = parseZone(q);
  if (zt !== undefined && zt !== 0) return { label: `${zoneDef(zt).name} buildings`, list: all.filter((b) => b.kind === 'zoned' && b.zone === zt) };
  const cat = parseCategory(q);
  if (cat) return { label: `${CATEGORY_INFO[cat].name} buildings`, list: all.filter((b) => b.kind === 'service' && buildingDef(b.defId)?.category === cat) };
  // names: custom names first, then catalog names
  const named = all.filter((b) => b.name && b.name.toLowerCase().includes(q));
  if (named.length) return { label: `“${query}”`, list: named };
  const defs = new Set(BUILDINGS.filter((d) => d.name.toLowerCase().includes(q) || (d.tags ?? []).includes(q)).map((d) => d.id));
  if (defs.size) return { label: `“${query}”`, list: all.filter((b) => defs.has(b.defId)) };
  const zones = new Set(ZONES.filter((z) => z.name.toLowerCase().includes(q)).map((z) => z.type));
  if (zones.size) return { label: `“${query}”`, list: all.filter((b) => b.kind === 'zoned' && zones.has(b.zone)) };
  return null;
}

function nameCompletions(world: World | null): string[] {
  const out = new Set<string>();
  if (world) {
    for (const b of world.buildings.values()) {
      if (b.name) out.add(b.name);
      else if (b.kind === 'service') out.add(buildingDef(b.defId)?.name ?? b.defId);
    }
  }
  return [...out];
}

function jumpTo(ctx: CmdCtx, b: Building): void {
  const c = buildingCenter(b);
  flyToCell(ctx.game, c.x, c.y, BUILDING_VIEW + Math.max(b.w, b.h) * 24);
}

export function registerNavigation(reg: CommandRegistry): void {
  reg.register(defineCommand({
    name: 'tp', aliases: ['teleport', 'goto', 'go'], category: 'Camera',
    usage: '/tp <x> <y> | home | <building id or name>',
    description: 'Fly the camera to cell coordinates, home, or a building.',
    examples: ['/tp 128 96', '/tp ~20 ~', '/tp home', '/tp 42', '/tp "City Hall"'],
    complete: (args, i) => {
      if (i === 0) return ['home', ...nameCompletions(reg.owner.world)];
      return [];
    },
    run(ctx) {
      const w = ctx.world();
      const a = ctx.args;
      if (!a.length) throw new UsageError();
      if (a.length >= 2 && looksNumeric(a[0]) && looksNumeric(a[1])) {
        const c = parseCell(ctx.game, w, a, 0);
        flyToCell(ctx.game, c.x + 0.5, c.y + 0.5);
        ctx.print(`Flying to (${c.x}, ${c.y}).`, 'ok');
        return;
      }
      const q = a.join(' ');
      if (/^(home|cityhall|city hall|center|centre)$/i.test(q)) {
        flyToCell(ctx.game, w.home.x + 0.5, w.home.y + 0.5);
        ctx.print(`Flying home to (${w.home.x}, ${w.home.y}).`, 'ok');
        return;
      }
      let target: Building | undefined;
      if (/^#?\d+$/.test(q)) {
        target = w.getBuilding(parseInt10(q.replace('#', '')));
        if (!target) throw new CommandError(`There is no building #${q.replace('#', '')}.`);
      } else {
        const found = findBuildings(w, q);
        if (!found || !found.list.length) throw new CommandError(`Nothing called “${q}” was found. Try /locate ${q}.`);
        const f = focusCell(ctx.game);
        target = found.list.slice().sort((x, y) => distCells(buildingCenter(x), f) - distCells(buildingCenter(y), f))[0];
      }
      jumpTo(ctx, target);
      ctx.print(`${buildingIcon(target)} Flying to #${target.id} ${buildingLabel(target)} at (${target.x}, ${target.y})${statusTags(target)}.`, 'ok');
    },
  }));

  reg.register(defineCommand({
    name: 'locate', aliases: ['find', 'search'], category: 'Camera',
    usage: '/locate <building id | category | zone | name> | next | prev',
    description: 'List matching buildings by distance and fly to the nearest; /locate next cycles.',
    examples: ['/locate fire_station', '/locate health', '/locate abandoned', '/locate "Old Mill"', '/locate next'],
    details: ['Special queries: abandoned, burning, rubble, construction, flooded, problems, named, services.'],
    complete: (_args, i) => {
      if (i !== 0) return [];
      return ['next', 'prev', ...Object.keys(SPECIAL), ...Object.keys(CATEGORY_INFO), ...ZONES.map((z) => z.id), ...BUILDINGS.map((b) => b.id), ...nameCompletions(reg.owner.world)];
    },
    run(ctx) {
      const w = ctx.world();
      const q = ctx.args.join(' ').trim();
      if (!q) throw new UsageError();
      const lq = q.toLowerCase();
      const st = reg.state.locate as LocateState | undefined;
      if (lq === 'next' || lq === 'prev' || lq === 'previous') {
        if (!st || !st.ids.length) throw new CommandError('Nothing to cycle through — run /locate <something> first.');
        const alive = st.ids.filter((id) => w.buildings.has(id));
        if (!alive.length) throw new CommandError(`All ${st.label} are gone.`);
        st.ids = alive;
        st.index = (st.index + (lq === 'next' ? 1 : -1) + alive.length) % alive.length;
        const b = w.getBuilding(alive[st.index])!;
        jumpTo(ctx, b);
        ctx.print(`${st.index + 1}/${alive.length} · ${buildingIcon(b)} #${b.id} ${buildingLabel(b)} at (${b.x}, ${b.y}) · ${fmtDistance(distCells(buildingCenter(b), focusCell(ctx.game)))}${statusTags(b)}`, 'ok');
        return;
      }
      const found = findBuildings(w, q);
      if (!found) throw new CommandError(`“${q}” matches no building type, category, zone or name.`);
      if (!found.list.length) {
        ctx.print(`No ${found.label} found in ${w.settings.cityName}.`, 'warn');
        reg.state.locate = undefined;
        return;
      }
      const f = focusCell(ctx.game);
      const sorted = found.list.map((b) => ({ b, d: distCells(buildingCenter(b), f) })).sort((a, b) => a.d - b.d);
      reg.state.locate = { label: found.label, ids: sorted.map((s) => s.b.id), index: 0 } satisfies LocateState;
      ctx.print(`Found ${sorted.length} × ${found.label}:`, 'system');
      const shown = sorted.slice(0, 8);
      for (const { b, d } of shown) {
        ctx.print(`  ${buildingIcon(b)} #${String(b.id).padEnd(6)} ${buildingKindName(b).padEnd(26).slice(0, 26)} (${b.x}, ${b.y})  ${fmtDistance(d)}${b.name ? `  “${b.name}”` : ''}${statusTags(b)}`, 'info');
      }
      if (sorted.length > shown.length) ctx.print(`  … and ${sorted.length - shown.length} more`, 'info');
      jumpTo(ctx, sorted[0].b);
      ctx.print(sorted.length > 1 ? 'Flying to the nearest · /locate next for the next one.' : 'Flying there.', 'ok');
    },
  }));
}
