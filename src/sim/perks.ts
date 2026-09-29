// City-wide perks of special service buildings: the tax office keeps the books
// straight, courts and prisons take criminals off the streets, a cargo harbour
// opens world trade, processing plants boost their resource industry, the
// supercomputer optimises everything… Each perk scales with the building's
// efficiency (budget × staffing × power) and some stack up to `max` copies.
// Perks are gathered during the daily building pass and applied from the next
// day on (see SimContext.perks).
import type { Building, BuildingDef } from '../core/types';
import type { World } from '../world/World';
import { defOf } from './catalog';

export interface Perks {
  /** tax income multiplier */
  tax: number;
  /** perceived crime multiplier */
  crime: number;
  /** additive health target points */
  health: number;
  /** education gain multiplier */
  education: number;
  /** commercial sales multiplier */
  commerce: number;
  /** manufacturing output multiplier */
  industry: number;
  /** raw material output multipliers */
  farm: number;
  forest: number;
  mine: number;
  oil: number;
  /** export income multiplier */
  exports: number;
  /** extra share of shop goods that imports may cover (additive) */
  imports: number;
  /** office demand (additive) */
  office: number;
  /** additive happiness points */
  happyRes: number;
  happyWork: number;
  /** level-up speed multipliers */
  levelCom: number;
  levelInd: number;
  levelOff: number;
}

type PerkKey = keyof Perks;
const ADDITIVE = new Set<PerkKey>(['health', 'imports', 'office', 'happyRes', 'happyWork']);

export interface PerkDef {
  /** how many copies of the building contribute */
  max: number;
  fx: Partial<Perks>;
  /** effect bullets for the inspector */
  text: string[];
}

export const PERKS: Record<string, PerkDef> = {
  city_hall: { max: 1, fx: { tax: 1.03, happyRes: 1 }, text: ['+3 % tax income', '+1 resident happiness'] },
  tax_office: { max: 2, fx: { tax: 1.05 }, text: ['+5 % tax income (up to 2 offices)'] },
  embassy: { max: 1, fx: { tax: 1.02, office: 0.04 }, text: ['+2 % tax income', '+office demand'] },
  courthouse: { max: 2, fx: { crime: 0.93 }, text: ['−7 % crime city-wide (up to 2)'] },
  police_hq: { max: 1, fx: { crime: 0.95 }, text: ['−5 % crime city-wide'] },
  prison: { max: 2, fx: { crime: 0.88 }, text: ['−12 % crime city-wide (up to 2)'] },
  intelligence_agency: { max: 1, fx: { crime: 0.8 }, text: ['−20 % crime city-wide'] },
  medical_lab: { max: 2, fx: { health: 3 }, text: ['+3 health city-wide (up to 2)'] },
  research_institute: { max: 1, fx: { office: 0.1, education: 1.15, levelOff: 1.2 }, text: ['+office demand', '+15 % education gain', 'Offices level up 20 % faster'] },
  supercomputer: {
    max: 1,
    fx: { tax: 1.05, industry: 1.1, office: 0.06, education: 1.1, levelCom: 1.15, levelInd: 1.15, levelOff: 1.15 },
    text: ['+5 % tax income', '+10 % industrial output', '+10 % education gain', 'Businesses level up 15 % faster'],
  },
  post_office: { max: 4, fx: { commerce: 1.025, happyWork: 0.5 }, text: ['+2.5 % commercial sales (up to 4)', '+0.5 workplace happiness'] },
  sorting_facility: { max: 1, fx: { commerce: 1.05, industry: 1.04 }, text: ['+5 % commercial sales', '+4 % industrial output'] },
  cargo_terminal: { max: 2, fx: { exports: 1.15, imports: 0.08 }, text: ['+15 % export income (up to 2)', 'More imported goods for shops'] },
  cargo_harbor: { max: 1, fx: { exports: 1.3, imports: 0.15 }, text: ['+30 % export income', 'Much more imported goods for shops'] },
  logistics_hub: { max: 2, fx: { industry: 1.08, exports: 1.05 }, text: ['+8 % industrial output (up to 2)', '+5 % export income'] },
  industrial_hq: { max: 1, fx: { industry: 1.05, levelInd: 1.3 }, text: ['+5 % industrial output', 'Industry levels up 30 % faster'] },
  farm_coop: { max: 2, fx: { farm: 1.2 }, text: ['+20 % farm output (up to 2)'] },
  lumber_yard: { max: 2, fx: { forest: 1.2 }, text: ['+20 % forestry output (up to 2)'] },
  ore_processing: { max: 2, fx: { mine: 1.2 }, text: ['+20 % mining output (up to 2)'] },
  oil_refinery: { max: 2, fx: { oil: 1.2 }, text: ['+20 % oil output (up to 2)'] },
  radio_mast: { max: 1, fx: { happyRes: 0.5 }, text: ['+0.5 resident happiness (local radio & alerts)'] },
};

export function neutralPerks(): Perks {
  return {
    tax: 1, crime: 1, health: 0, education: 1, commerce: 1, industry: 1, farm: 1, forest: 1, mine: 1, oil: 1, exports: 1, imports: 0,
    office: 0, happyRes: 0, happyWork: 0, levelCom: 1, levelInd: 1, levelOff: 1,
  };
}

export function perkOf(def: BuildingDef | undefined): PerkDef | undefined {
  return def ? PERKS[def.id] : undefined;
}

/** Collects the efficiency of every perk building during a day pass. */
export class PerkAcc {
  private eff = new Map<string, number[]>();

  add(defId: string, efficiency: number): void {
    if (!(efficiency > 0)) return;
    let list = this.eff.get(defId);
    if (!list) this.eff.set(defId, (list = []));
    list.push(Math.min(1, efficiency));
  }

  resolve(): Perks {
    const out = neutralPerks();
    for (const [id, list] of this.eff) {
      const def = PERKS[id];
      if (!def) continue;
      list.sort((a, b) => b - a);
      let strength = 0;
      for (let i = 0; i < Math.min(def.max, list.length); i++) strength += list[i];
      if (strength <= 0) continue;
      for (const [k, v] of Object.entries(def.fx) as [PerkKey, number][]) {
        if (ADDITIVE.has(k)) out[k] += v * strength;
        else out[k] *= 1 + (v - 1) * strength;
      }
    }
    return out;
  }
}

/** Perks of the buildings currently in the world (used right after loading). */
export function perksFromWorld(world: World): Perks {
  const acc = new PerkAcc();
  for (const b of world.buildings.values()) addPerkOf(acc, b);
  return acc.resolve();
}

/** Record a building's perk contribution (complete, running buildings only). */
export function addPerkOf(acc: PerkAcc, b: Building): void {
  if (b.kind !== 'service' || b.built < 1 || !PERKS[b.defId]) return;
  if (!defOf(b.defId)) return;
  acc.add(b.defId, b.efficiency);
}
