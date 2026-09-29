// Shared state handed to every simulation sub-system for the lifetime of one
// loaded world. Nothing here is persisted; persisted state lives in `state`
// (world.ext.sim) and in each building's `ext.sim`.
import { BFlag, type Building, type BuildingCategory, type FieldId, type VehicleType } from '../core/types';
import { RNG, hashFloat } from '../core/rng';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Settings } from '../settings/types';
import type { EventModifiers } from './events/EventSystem';
import { DayAgg } from './aggregates';
import { CandidateSet } from './candidates';
import { PolicySystem } from './policies';
import { OutsideReach } from './reach';
import { categoryUnlocked } from './catalog';
import { SERVICE_GRACE_DAYS } from './tuning';
import type { SimState } from './state';

/** Neutral event modifiers (kept local so the sim never depends on the events module at runtime). */
export function neutralMods(): EventModifiers {
  return {
    demandRes: 0, demandCom: 0, demandInd: 0, demandOff: 0, happiness: 0, incomeMult: 1, tourismMult: 1, crimeMult: 1, healthMult: 1,
    powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, trafficMult: 1, fireRiskMult: 1, constructionMult: 1,
  };
}

/** Service coverage fields considered for the "service score" of a lot. */
const SERVICE_FIELDS: { field: FieldId; category: BuildingCategory | 'transit-lines' }[] = [
  { field: 'police', category: 'police' },
  { field: 'fire', category: 'fire' },
  { field: 'health', category: 'health' },
  { field: 'education', category: 'education' },
  { field: 'garbage', category: 'garbage' },
  { field: 'leisure', category: 'parks' },
  { field: 'deathcare', category: 'deathcare' },
  { field: 'transit', category: 'transit-lines' },
];

/** Categories whose absence only starts to hurt after a grace period once unlocked. */
export type GracedService = 'garbage' | 'deathcare' | 'health' | 'education' | 'police' | 'fire';

export class SimContext {
  readonly rng: RNG;
  mods: EventModifiers = neutralMods();
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
  /** true while advanceDays runs (suppresses chirps, audio, per-frame niceties) */
  fastForward = false;
  /** building ids processed during the current day (snapshot at day start) */
  ids: number[] = [];
  /** set when buildings were added/removed (the next day re-snapshots) */
  idsDirty = true;
  /** garbage units / bodies that can still be accepted today */
  garbagePool = 0;
  deathPool = 0;
  /** visual service trips left today */
  dispatchLeft = 0;
  /** facilities that dispatch vehicles (refreshed each day pass) */
  facilities: Record<'garbage' | 'hearse' | 'ambulance' | 'police', Building[]> = { garbage: [], hearse: [], ambulance: [], police: [] };
  nextFacilities: Record<'garbage' | 'hearse' | 'ambulance' | 'police', Building[]> = { garbage: [], hearse: [], ambulance: [], police: [] };
  /** service categories whose problems currently apply (after grace) */
  private graceOn: Record<GracedService, boolean> = { garbage: false, deathcare: false, health: false, education: false, police: false, fire: false };
  private unlockedCat: Record<GracedService, boolean> = { garbage: false, deathcare: false, health: false, education: false, police: false, fire: false };
  /** hook called when a high-density building reaches level 5 (chirps) */
  onLevel5?: (b: Building) => void;
  /** hook called when a service building finishes construction */
  onServiceOpened?: (b: Building) => void;

  constructor(readonly game: Game, readonly world: World, readonly state: SimState) {
    this.rng = new RNG(state.rng || 1);
    this.policies = new PolicySystem(world);
    this.candidates = new CandidateSet(world);
    this.outside = new OutsideReach(world);
    this.refreshServiceFields();
    this.refreshGrace();
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
      if (s.category === 'transit-lines') {
        if (!w.transitLines.some((l) => l.active)) continue;
      } else if (!categoryUnlocked(w, s.category)) continue;
      this.serviceArrays.push(w.fields[s.field]);
    }
  }

  /** Track when service categories unlock; their absence hurts only after a grace period. */
  refreshGrace(): void {
    const w = this.world, st = this.state, day = this.day;
    for (const cat of Object.keys(this.graceOn) as GracedService[]) {
      if (categoryUnlocked(w, cat)) {
        if (st.svcUnlock[cat] === undefined) st.svcUnlock[cat] = day;
        this.graceOn[cat] = day - st.svcUnlock[cat] >= SERVICE_GRACE_DAYS;
        this.unlockedCat[cat] = true;
      } else {
        this.graceOn[cat] = false;
        this.unlockedCat[cat] = false;
      }
    }
  }

  /** true when the player can build the service */
  unlocked(cat: GracedService): boolean {
    return this.unlockedCat[cat];
  }

  /** days left before the service's absence starts to hurt (0 when on / locked) */
  graceLeft(cat: GracedService): number {
    const u = this.state.svcUnlock[cat];
    if (!this.unlockedCat[cat] || u === undefined) return 0;
    return Math.max(0, SERVICE_GRACE_DAYS - (this.day - u));
  }

  /** true once the service is unlocked and its grace period is over */
  serviceOn(cat: GracedService): boolean {
    return this.graceOn[cat];
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

  /** Send a (visual) service vehicle from the nearest facility of a kind toward a building. */
  dispatch(kind: 'garbage' | 'hearse' | 'ambulance' | 'police', target: Building): void {
    if (this.fastForward || this.dispatchLeft <= 0) return;
    const list = this.facilities[kind];
    if (!list.length) return;
    const tx = target.x + (target.w >> 1), ty = target.y + (target.h >> 1);
    let best: Building | null = null, bd = Infinity;
    for (const f of list) {
      const d = Math.abs(f.x - tx) + Math.abs(f.y - ty);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best || bd > 90) return;
    const type: VehicleType = kind;
    this.dispatchLeft--;
    try {
      this.game.traffic.dispatch(type, best.id, { x: tx, y: ty });
    } catch {
      // traffic system unavailable: purely visual, ignore
    }
  }
}
