// STUB — owned by the "tools" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';

export interface PointerInfo {
  type: 'down' | 'move' | 'up' | 'wheel' | 'leave';
  button: number;
  /** buttons bitmask (MouseEvent.buttons) */
  buttons: number;
  clientX: number;
  clientY: number;
  dx: number;
  dy: number;
  /** wheel delta (normalized, + = zoom out) */
  wheel: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** true when the event started over the 3D canvas (not UI) */
  onCanvas: boolean;
}

export interface Gesture {
  panX: number;
  panY: number;
  /** multiplicative zoom factor (>1 = zoom in) */
  zoom: number;
  /** radians */
  rotate: number;
  tilt: number;
}

export class InputManager {
  /** false while typing in chat / menus capture input */
  enabled = true;
  pointer = { x: 0, y: 0, overCanvas: false };
  constructor(protected game: Game, protected canvas: HTMLElement) {}
  init(): void {}
  update(_dt: number): void {}
  /** is an action's key currently held */
  isDown(_action: ActionId): boolean { return false; }
  /** subscribe to an action press; returns unsubscribe */
  onAction(_action: ActionId, _fn: () => void): () => void { return () => {}; }
  /** raw pointer stream over the canvas */
  onPointer(_fn: (p: PointerInfo) => void): () => void { return () => {}; }
  /** touch gestures (2-finger pan/zoom/rotate) */
  onGesture(_fn: (g: Gesture) => void): () => void { return () => {}; }
  /** wait for the next key combo (for rebinding). Resolves "Ctrl+KeyZ" style strings or null on Escape. */
  captureNextKey(): Promise<string | null> { return Promise.resolve(null); }
  /** human-readable label for an action's first binding, e.g. "Ctrl+Z" */
  bindingLabel(_action: ActionId): string { return ''; }
}
