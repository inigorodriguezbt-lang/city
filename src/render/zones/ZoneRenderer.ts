// STUB — owned by the "roads" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';

export class ZoneRenderer {
  protected world: World | null = null;
  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}
  /** show the zoning grid (zoneable cells near roads) — used while a zoning tool is active */
  setGridVisible(_v: boolean): void {}
  /** show district colors/borders (district tool / districts panel) */
  setDistrictsVisible(_v: boolean): void {}
}
