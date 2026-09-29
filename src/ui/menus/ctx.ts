// Shared context handed to every menu screen (keeps screens decoupled from
// MenuSystem internals and makes them easy to boot in the sandbox).
import type { Game } from '../../game/Game';
import type { SfxId } from '../../audio/AudioManager';

export interface MenuLayer {
  /** unique id ("main", "options", "confirm", …) */
  id: string;
  /** root element (appended to the menus host while open) */
  el: HTMLElement;
  /** full-screen screens (main menu) sit at the bottom and are never popped by closeTop() */
  base?: boolean;
  /** Escape / backdrop may close it (default true) */
  dismissible?: boolean;
  /** called after the layer was removed from the stack */
  onClose?(): void;
  /** called when the layer becomes the top-most layer again */
  onResume?(): void;
  /** focus the first sensible control when shown */
  focus?(): void;
  /** per-frame update while open (real dt seconds) */
  update?(dt: number): void;
  /** key handling while top-most; return true when consumed */
  onKey?(e: KeyboardEvent): boolean;
}

export interface ConfirmOpts {
  ok?: string;
  cancel?: string;
  danger?: boolean;
  icon?: string;
}

export interface MenuCtx {
  game: Game;
  /** play a UI sound (never throws) */
  sfx(id: SfxId, volume?: number): void;
  /** attach a hover/focus tooltip; `key` shows a keycap hint */
  tip(el: HTMLElement, text: string | (() => string), key?: string | (() => string)): void;
  push(layer: MenuLayer): void;
  /** remove a specific layer (or the top one) */
  pop(layer?: MenuLayer): void;
  confirm(title: string, text: string, opts?: ConfirmOpts): Promise<boolean>;
  /** true when UI animations should be minimal */
  reduced(): boolean;
  /** show a transient message at the bottom of the menus */
  notify(text: string, kind?: 'info' | 'good' | 'bad'): void;
}
