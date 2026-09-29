// STUB — owned by the "systems" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';

export type SfxId =
  | 'click' | 'hover' | 'open' | 'close' | 'place' | 'road' | 'zone' | 'bulldoze' | 'error' | 'money'
  | 'milestone' | 'achievement' | 'notice' | 'warning' | 'disaster' | 'siren' | 'thunder' | 'explosion' | 'chirp' | 'levelup';

export class AudioManager {
  constructor(protected game: Game) {}
  /** must be called from a user gesture to unlock WebAudio */
  unlock(): void {}
  init(): void {}
  update(_dt: number): void {}
  play(_id: SfxId, _volume = 1): void {}
}
