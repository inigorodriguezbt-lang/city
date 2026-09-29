// Helpers that interpret the service building catalog (src/data/buildings.ts)
// for the simulation: budget categories, storage vs. processing facilities,
// renewables, category unlocks.
import type { BuildingCategory, BuildingDef, BudgetCategory } from '../core/types';
import { BUILDINGS, CATEGORY_INFO, buildingDef } from '../data/buildings';
import type { World } from '../world/World';

const BUDGET_CATS = new Set<string>(['roads', 'power', 'water', 'garbage', 'health', 'deathcare', 'fire', 'police', 'education', 'parks', 'transit', 'government', 'disaster']);

/** budget slider that funds a service category */
export function budgetCategoryOf(cat: BuildingCategory): BudgetCategory {
  const b = CATEGORY_INFO[cat]?.budget;
  return (b && BUDGET_CATS.has(b) ? b : 'government') as BudgetCategory;
}

function text(def: BuildingDef): string {
  return `${def.id} ${def.model} ${def.group ?? ''} ${(def.tags ?? []).join(' ')} ${def.capacityLabel ?? ''}`.toLowerCase();
}

const memo = new Map<string, number>();
function flagsOf(def: BuildingDef): number {
  let f = memo.get(def.id);
  if (f !== undefined) return f;
  const t = text(def);
  f = 0;
  // garbage processors burn/recycle a monthly throughput; landfills store
  if (def.category === 'garbage' && /incinerat|recycl|waste.to|processing|compost|\/month|per month|throughput/.test(t)) f |= 1;
  // crematoria process bodies; cemeteries store them
  if (def.category === 'deathcare' && /cremat|\/month|per month|throughput/.test(t)) f |= 2;
  if (def.category === 'power' && /wind|solar|hydro|dam|geotherm|tidal|wave|fusion|biomass|photovolt/.test(t)) f |= 4;
  // storage-type landfill or cemetery (anything else in those categories)
  memo.set(def.id, f);
  return f;
}

export const isGarbageProcessor = (d: BuildingDef): boolean => (flagsOf(d) & 1) !== 0;
export const isCrematorium = (d: BuildingDef): boolean => (flagsOf(d) & 2) !== 0;
export const isRenewable = (d: BuildingDef): boolean => (flagsOf(d) & 4) !== 0;

/** Milestone at which the first building of each category unlocks. */
const CATEGORY_UNLOCK = new Map<BuildingCategory, number>();
function categoryUnlockIndex(cat: BuildingCategory): number {
  if (CATEGORY_UNLOCK.size === 0) {
    for (const d of BUILDINGS) {
      const cur = CATEGORY_UNLOCK.get(d.category);
      if (cur === undefined || d.unlock < cur) CATEGORY_UNLOCK.set(d.category, d.unlock);
    }
  }
  return CATEGORY_UNLOCK.get(cat) ?? 999;
}

/** true when the player can build at least one building of the category */
export function categoryUnlocked(world: World, cat: BuildingCategory): boolean {
  const idx = categoryUnlockIndex(cat);
  if (idx >= 999) return false;
  return world.isUnlocked(idx) || BUILDINGS.some((d) => d.category === cat && world.unlockedIds.includes(d.id));
}

export function defOf(defId: string): BuildingDef | undefined {
  return buildingDef(defId);
}

/** buildings of a category unlocked at exactly milestone `index` (advisor hints) */
export function unlockedAt(index: number): BuildingDef[] {
  return BUILDINGS.filter((d) => d.unlock === index);
}

export function cheapestUnlocked(world: World, cat: BuildingCategory): BuildingDef | undefined {
  let best: BuildingDef | undefined;
  for (const d of BUILDINGS) {
    if (d.category !== cat || !world.isUnlocked(d.unlock, d.id)) continue;
    if (!best || d.cost < best.cost) best = d;
  }
  return best;
}
