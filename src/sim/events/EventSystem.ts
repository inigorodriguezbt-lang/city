// STUB — owned by the "events" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { ActiveEvent, Cell, EventDef, WeatherType } from '../../core/types';

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
}
