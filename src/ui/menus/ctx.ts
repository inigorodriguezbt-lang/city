// Shared context handed to every menu screen (keeps screens decoupled from
// MenuSystem internals and makes them easy to boot in the sandbox).
import type { Game } from '../../game/Game';
import type { SfxId } from '../../audio/AudioManager';
import type { ActionId } from '../../settings/types';
import type { SkylineBackground } from './skyline';

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

/** screens that can be opened from anywhere in the menus */
export interface MenuNav {
  newGame(): void;
  load(): void;
  save(): void;
  options(tab?: string): void;
  help(): void;
  credits(): void;
  photoTips(): void;
  pause(): void;
}

export interface MenuCtx {
  game: Game;
  nav: MenuNav;
  /** play a UI sound (never throws) */
  sfx(id: SfxId, volume?: number): void;
  /** attach a hover/focus tooltip; `key` shows a keycap hint */
  tip(el: HTMLElement, text: string | (() => string), key?: string | (() => string)): void;
  push(layer: MenuLayer): void;
  /** remove a specific layer (or the top one) */
  pop(layer?: MenuLayer): void;
  /** remove every non-base layer (and the base one too when `all`) */
  closeAll(all?: boolean): void;
  /** is a layer with this id on the stack */
  has(id: string): boolean;
  confirm(title: string, text: string, opts?: ConfirmOpts): Promise<boolean>;
  /** true when UI animations should be minimal */
  reduced(): boolean;
  /** show a transient message at the bottom of the menus */
  notify(text: string, kind?: 'info' | 'good' | 'bad'): void;
  /** first binding label of an action ("" when unbound) */
  key(action: ActionId): string;
  /** the shared animated skyline backdrop (lazily created) */
  sky(): SkylineBackground;
  /** show the loading overlay */
  loading(text: string, progress: number): void;
  hideLoading(): void;
}
