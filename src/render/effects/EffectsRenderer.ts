// STUB — owned by the "events" agent. Public API is FROZEN (add, don't change).
import type * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';

export type EffectKind = 'fire' | 'smoke' | 'steam' | 'explosion' | 'dust' | 'fountain' | 'fireworks' | 'sparks' | 'splash';

export class EffectsRenderer {
  protected world: World | null = null;
  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}
  /** persistent emitter at a world position; returns id */
  addEmitter(_kind: EffectKind, _pos: THREE.Vector3Like, _rate = 1): number { return 0; }
  removeEmitter(_id: number): void {}
  /** one-shot burst */
  burst(_kind: EffectKind, _pos: THREE.Vector3Like, _scale = 1): void {}
}
