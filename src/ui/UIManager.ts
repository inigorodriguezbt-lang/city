// STUB — owned by the "ui-hud" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import type { World } from '../world/World';

export type PanelId =
  | 'budget' | 'stats' | 'policies' | 'milestones' | 'districts' | 'transit' | 'overlays' | 'notices' | 'graphs' | 'search';

export class UIManager {
  protected world: World | null = null;
  hudVisible = true;
  constructor(protected game: Game, readonly root: HTMLElement) {}
  init(): void {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}
  toast(_text: string, _kind: 'info' | 'good' | 'warning' | 'danger' = 'info'): void {}
  openBuildingInfo(_id: number): void {}
  openPanel(_id: PanelId): void {}
  togglePanel(_id: PanelId): void {}
  closePanels(): boolean { return false; }
  setHudVisible(v: boolean): void { this.hudVisible = v; }
  confirm(_title: string, _text: string): Promise<boolean> { return Promise.resolve(true); }
  prompt(_title: string, def = ''): Promise<string | null> { return Promise.resolve(def); }
  /** apply GUI scale (0.6..2) */
  setScale(_s: number): void {}
}
