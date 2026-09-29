// STUB — owned by the "ui-menus" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';

export class MenuSystem {
  constructor(protected game: Game, readonly root: HTMLElement) {}
  init(): void {}
  showMainMenu(): void {}
  hideMainMenu(): void {}
  openNewGame(): void {}
  openOptions(): void {}
  openPause(): void {}
  openSaveDialog(): void {}
  openLoadDialog(): void {}
  showLoading(_text: string, _progress: number): void {}
  hideLoading(): void {}
  /** close the top-most menu; returns false if none open */
  closeTop(): boolean { return false; }
  /** true while any blocking menu/dialog is open (game input suspended) */
  isOpen(): boolean { return false; }
}
