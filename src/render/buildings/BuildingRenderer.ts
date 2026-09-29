// STUB — owned by the "buildings-zoned" agent. Public API is FROZEN (add, don't change).
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { Dir } from '../../core/types';

export class BuildingRenderer {
  protected world: World | null = null;
  readonly group = new THREE.Group();
  constructor(protected game: Game) {
    game.renderer.scene.add(this.group);
  }
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}
  /** outline/tint a building (selection, hover). null clears. */
  highlight(_id: number | null, _color?: number): void {}
  /** translucent placement preview of a catalog building (local origin = footprint center, front +Z rotated by rot). */
  createPreview(_defId: string, _rot: Dir): THREE.Object3D { return new THREE.Group(); }
  /** approximate top height (m, world) of a building for icons/labels */
  buildingTop(_id: number): number { return 0; }
}
