// STUB — owned by the "events" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { ActiveEvent, Cell, EventDef, WeatherType } from '../../core/types';

/** Multipliers/offsets from active events + weather, read by other systems each tick. Neutral = 1 (mult) / 0 (add). */
export interface EventModifiers {
  demandRes: number; // add, -1..1
  demandCom: number;
  demandInd: number;
  demandOff: number;
  happiness: number; // add, -30..30 points
  incomeMult: number; // tax income multiplier
  tourismMult: number;
  crimeMult: number;
  healthMult: number; // >1 = more sickness
  powerUseMult: number; // consumption multiplier (heat waves, cold)
  waterUseMult: number;
  waterSupplyMult: number; // droughts
  trafficMult: number; // >1 = more trips / slower roads
  fireRiskMult: number;
  constructionMult: number; // construction speed
}

export function neutralModifiers(): EventModifiers {
  return {
    demandRes: 0, demandCom: 0, demandInd: 0, demandOff: 0, happiness: 0, incomeMult: 1, tourismMult: 1, crimeMult: 1, healthMult: 1,
    powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, trafficMult: 1, fireRiskMult: 1, constructionMult: 1,
  };
}

export class EventSystem {
  protected world: World | null = null;
  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}

  /** all event definitions */
  get catalog(): EventDef[] { return []; }
  /** ids usable with /summon */
  summonables(): string[] { return []; }
  /** start an event now (optionally at a cell). Returns null if unknown/invalid. */
  trigger(_defId: string, _at?: Cell): ActiveEvent | null { return null; }
  end(_eventId: number): void {}
  /** force weather */
  setWeather(_type: WeatherType, _intensity?: number, _days?: number): void {}
  /** ignite a building */
  startFire(_buildingId: number): boolean { return false; }
  /** combined modifiers of active events and weather (cheap; call per tick) */
  modifiers(): EventModifiers { return neutralModifiers(); }
}
