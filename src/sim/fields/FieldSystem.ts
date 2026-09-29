// STUB — owned by the "fields" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { FieldId } from '../../core/types';

export interface NetworkSummary {
  produced: number;
  consumed: number;
  /** cells/buildings connected */
  connected: number;
}

export class FieldSystem {
  protected world: World | null = null;
  /** last computed utility summaries */
  power: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };
  water: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };
  sewage: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };

  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  /** schedules async worker recomputes; writes into world.fields when done */
  update(_dt: number): void {}
  /** ask for a recompute as soon as possible (e.g. after big edits) */
  requestRecompute(_fields?: FieldId[]): void {}
  /** await a full synchronous-ish recompute (tests, after load) */
  async recomputeNow(): Promise<void> {}
}
