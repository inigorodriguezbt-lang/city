// Shared state handed to every simulation sub-system for the lifetime of one
// loaded world.
import { BFlag, type Building, type FieldId } from '../core/types';
import { RNG, hashFloat } from '../core/rng';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Settings } from '../settings/types';
import { neutralModifiers, type EventModifiers } from './events/EventSystem';
import { DayAgg } from './aggregates';
import { CandidateSet } from './candidates';
import { PolicySystem } from './policies';
import { OutsideReach } from './reach';
import { categoryUnlocked } from './catalog';
import type { SimState } from './state';

/** Service coverage fields considered for the "service score" of a lot. */
const SERVICE_FIELDS: { field: FieldId; category: 'police' | 'fire' | 'health' | 'education' | 'garbage' | 'parks' | 'deathcare' | 'transit' }[] = [
  { field: 'police', category: 'police' },
  { field: 'fire', category: 'fire' },
  { field: 'health', category: 'health' },
  { field: 'education', category: 'education' },
  { field: 'garbage', category: 'garbage' },
  { field: 'leisure', category: 'parks' },
  { field: 'deathcare', category: 'deathcare' },
  { field: 'transit', category: 'transit' },
];

export class SimContext {
  readonly rng: RNG;
  mods: EventModifiers = neutralModifiers();
  /** accumulators of the day in progress */
  agg = new DayAgg();
  /** last completed (full) day */
  last = new DayAgg();
  lastValid = false;
  readonly policies: PolicySystem;
  readonly candidates: CandidateSet;
  readonly outside: OutsideReach;
  /** coverage arrays used for the service score (only unlocked services) */
  serviceArrays: Uint8Array[] = [];
  /** building ids to remove after the current slice */
  removeQueue: number[] = [];
  /** road cells changed since the last reachability / upkeep recount */
  roadsDirty = true;
  /** road cells per road type (upkeep) */
  roadCounts: number[] = [];
  bridgeCells = 0;
  /** true while advanceDays runs (suppresses per-frame niceties) */
  fastForward = false;

  constructor(readonly game: Game, readonly world: World, readonly state: SimState) {
    this.rng = new RNG(state.rng || 1);
    this.policies = new PolicySystem(world);
    this.candidates = new CandidateSet(world);
    this.outside = new OutsideReach(world);
    this.refreshServiceFields();
  }

  get settings(): Settings {
    return this.game.settings.value;
  }

  /** integer calendar day */
  get day(): number {
    return Math.floor(this.world.time.day);
  }

  /** persist RNG state into the save */
  syncRng(): void {
    this.state.rng = this.rng.state;
  }

  refreshServiceFields(): void {
    const w = this.world;
    this.serviceArrays = [];
    for (const s of SERVICE_FIELDS) {
      if (s.category === 'transit') {
        if (!w.transitLines.some((l) => l.active)) continue;
      } else if (!categoryUnlocked(w, s.category)) continue;
      this.serviceArrays.push(w.fields[s.field]);
    }
  }

  /** 0..1 average quality of unlocked services at cell index i */
  serviceScore(i: number): number {
    const arr = this.serviceArrays;
    if (!arr.length) return 0.5;
    let s = 0;
    for (let k = 0; k < arr.length; k++) {
      const v = arr[k][i] / 150;
      s += v > 1 ? 1 : v;
    }
    return s / arr.length;
  }

  /** round x up or down randomly so the expectation equals x */
  stochasticRound(x: number): number {
    if (x <= 0) return 0;
    const f = Math.floor(x);
    return f + (this.rng.next() < x - f ? 1 : 0);
  }

  /** notify renderers about a visual change */
  touch(b: Building): void {
    this.world.touchBuilding(b);
  }

  /** stable per-building pseudo random in [0,1) (changes every `period` days) */
  jitter(b: Building, salt: number, period = 30): number {
    return hashFloat(b.seed, salt, Math.floor(this.world.time.day / period));
  }

  isTerminal(b: Building): boolean {
    return (b.flags & (BFlag.Collapsed | BFlag.Burned)) !== 0;
  }
}
