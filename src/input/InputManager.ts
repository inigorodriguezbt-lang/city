// ─────────────────────────────────────────────────────────────────────────────
// InputManager: keyboard actions (rebindable, see settings.controls.keybinds),
// held-key state, a normalized pointer stream over the 3D canvas and touch
// gestures (one finger = tool pointer, two fingers = camera gesture).
//
// Keybind strings are KeyboardEvent.code values optionally prefixed by
// modifiers in the canonical order "Ctrl+Shift+Alt+<Code>". On macOS the
// Command (Meta) key counts as Ctrl.
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../game/Game';
import { ACTIONS, type ActionId } from '../settings/types';
import type { Settings } from '../settings/types';
import { comboLabel, eventCombo, isMac, isModifierCode, parseCombo, type ParsedCombo } from './keys';

export { comboLabel, parseCombo, isMac } from './keys';

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
  /** 'mouse' | 'pen' | 'touch' (additive) */
  pointerType?: string;
  /** bitmask (MouseEvent.buttons layout) of buttons a tool has claimed:
   *  camera controllers should not use a claimed button for camera moves (additive) */
  claimed?: number;
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

type PointerFn = (p: PointerInfo) => void;
type GestureFn = (g: Gesture) => void;

interface Binding {
  action: ActionId;
  combo: ParsedCombo;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
}

/** how long a first finger waits for a second one before acting as a tool pointer (ms) */
const TOUCH_HOLD_MS = 90;
/** movement that commits a pending single touch as a tool drag (px) */
const TOUCH_COMMIT_PX = 10;
/** two-finger movement before the gesture mode (tilt vs pan/zoom/rotate) is decided (px) */
const GESTURE_DECIDE_PX = 12;

const BUTTON_BIT = [1, 4, 2, 8, 16];

export class InputManager {
  /** false while typing in chat / menus capture input */
  enabled = true;
  pointer = { x: 0, y: 0, overCanvas: false };
  /** live modifier state (additive) */
  readonly modifiers = { shift: false, ctrl: false, alt: false };

  private bindings: Binding[] = [];
  private byAction = new Map<ActionId, ParsedCombo[]>();
  private actionFns = new Map<ActionId, Set<() => void>>();
  private pointerFns = new Set<PointerFn>();
  private gestureFns = new Set<GestureFn>();
  /** KeyboardEvent.code values currently held */
  private held = new Set<string>();
  private captureResolve: ((combo: string | null) => void) | null = null;
  private captureModifier: string | null = null;
  private initialized = false;
  private disposers: (() => void)[] = [];

  // pointer state
  private dragPointer = -1;
  private dragFromCanvas = false;
  private lastX = 0;
  private lastY = 0;
  private claimedMask = 0;

  // touch state
  private touches = new Map<number, TouchPoint>();
  /** the single touch currently forwarded as a left-button pointer (-1 = none) */
  private touchTool = -1;
  /** a first touch waiting for TOUCH_HOLD_MS before becoming a tool pointer */
  private touchPending = -1;
  private touchTimer = 0;
  private gestureMode: 'none' | 'undecided' | 'panzoom' | 'tilt' = 'none';
  private gesturePrev = { cx: 0, cy: 0, dist: 1, angle: 0 };
  private gestureAcc = 0;
  /** touches of a finished gesture keep being ignored until all fingers lift */
  private touchIgnore = new Set<number>();

  constructor(protected game: Game, protected canvas: HTMLElement) {
    this.rebuildBindings(game.settings.value.controls.keybinds);
    game.events.on('settings:changed', (s: Settings) => this.rebuildBindings(s.controls.keybinds));
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.style.userSelect = 'none';
    c.style.webkitUserSelect = 'none';
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', this.onKeyDown, { capture: true });
    on(window, 'keyup', this.onKeyUp, { capture: true });
    on(window, 'blur', this.onBlur);
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.clearHeld();
    });
    on(c, 'pointerdown', this.onPointerDown);
    on(window, 'pointermove', this.onPointerMove, { passive: true });
    on(window, 'pointerup', this.onPointerUp);
    on(window, 'pointercancel', this.onPointerCancel);
    on(c, 'pointerleave', this.onPointerLeave);
    on(c, 'wheel', this.onWheel, { passive: false });
    on(c, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    // Safari trackpad pinch → gesture events; stop page zoom
    on(c, 'gesturestart', (e: Event) => e.preventDefault());
  }

  /** remove every DOM listener (tests / hot reload) */
  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.initialized = false;
  }

  update(_dt: number): void {
    // a pending single touch that stayed alone long enough becomes a tool pointer
    if (this.touchPending >= 0 && performance.now() - this.touchTimer >= TOUCH_HOLD_MS) this.commitPendingTouch();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Keyboard
  // ════════════════════════════════════════════════════════════════════════

  /** is an action's key currently held */
  isDown(action: ActionId): boolean {
    const combos = this.byAction.get(action);
    if (!combos || !this.enabled || this.typing()) return false;
    for (const c of combos) {
      if (!this.codeHeld(c.code)) continue;
      if (c.ctrl && !this.modifiers.ctrl) continue;
      if (c.shift && !this.modifiers.shift) continue;
      if (c.alt && !this.modifiers.alt) continue;
      return true;
    }
    return false;
  }

  /** subscribe to an action press; returns unsubscribe */
  onAction(action: ActionId, fn: () => void): () => void {
    let set = this.actionFns.get(action);
    if (!set) this.actionFns.set(action, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** raw pointer stream over the canvas */
  onPointer(fn: (p: PointerInfo) => void): () => void {
    this.pointerFns.add(fn);
    return () => this.pointerFns.delete(fn);
  }

  /** touch gestures (2-finger pan/zoom/rotate) */
  onGesture(fn: (g: Gesture) => void): () => void {
    this.gestureFns.add(fn);
    return () => this.gestureFns.delete(fn);
  }

  /** wait for the next key combo (for rebinding). Resolves "Ctrl+KeyZ" style strings or null on Escape. */
  captureNextKey(): Promise<string | null> {
    this.captureResolve?.(null);
    this.clearHeld();
    return new Promise((resolve) => {
      this.captureResolve = resolve;
      this.captureModifier = null;
    });
  }

  /** abort a pending captureNextKey() (resolves it with null) */
  cancelCapture(): void {
    const r = this.captureResolve;
    this.captureResolve = null;
    this.captureModifier = null;
    r?.(null);
  }

  /** true while captureNextKey() is waiting */
  get capturing(): boolean {
    return this.captureResolve !== null;
  }

  /** human-readable label for an action's first binding, e.g. "Ctrl+Z" */
  bindingLabel(action: ActionId): string {
    const b = this.game.settings.value.controls.keybinds[action]?.[0];
    return b ? comboLabel(b) : '';
  }

  /** labels of every binding of an action */
  bindingLabels(action: ActionId): string[] {
    return (this.game.settings.value.controls.keybinds[action] ?? []).map(comboLabel);
  }

  /** actions (other than `except`) already bound to a combo — for rebinding conflict warnings */
  conflicts(combo: string, except?: ActionId): ActionId[] {
    const p = parseCombo(combo);
    if (!p) return [];
    const out: ActionId[] = [];
    const binds = this.game.settings.value.controls.keybinds;
    for (const a of Object.keys(ACTIONS) as ActionId[]) {
      if (a === except) continue;
      for (const s of binds[a] ?? []) {
        const q = parseCombo(s);
        if (q && q.code === p.code && q.ctrl === p.ctrl && q.shift === p.shift && q.alt === p.alt) {
          out.push(a);
          break;
        }
      }
    }
    return out;
  }

  /** Claim / release a mouse button for tool use (e.g. right-drag erase while
   *  zoning). `button` uses MouseEvent.button numbering (0 left, 1 middle, 2 right). */
  claimButton(button: number, on: boolean): void {
    const bit = BUTTON_BIT[button] ?? 0;
    this.claimedMask = on ? this.claimedMask | bit : this.claimedMask & ~bit;
  }
  isButtonClaimed(button: number): boolean {
    return (this.claimedMask & (BUTTON_BIT[button] ?? 0)) !== 0;
  }

  private rebuildBindings(keybinds: Record<ActionId, string[]>): void {
    this.bindings = [];
    this.byAction.clear();
    for (const a of Object.keys(ACTIONS) as ActionId[]) {
      const list: ParsedCombo[] = [];
      for (const s of keybinds?.[a] ?? []) {
        const p = parseCombo(s);
        if (!p) continue;
        list.push(p);
        this.bindings.push({ action: a, combo: p });
      }
      this.byAction.set(a, list);
    }
  }

  private codeHeld(code: string): boolean {
    if (this.held.has(code)) return true;
    // left/right modifier variants are interchangeable for held checks
    const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
    if (m) return this.held.has(m[1] + (m[2] === 'Left' ? 'Right' : 'Left'));
    return false;
  }

  private syncModifiers(e: KeyboardEvent | MouseEvent): void {
    this.modifiers.shift = e.shiftKey;
    this.modifiers.ctrl = e.ctrlKey || (isMac && e.metaKey);
    this.modifiers.alt = e.altKey;
  }

  /** a text field (or editable element) has keyboard focus */
  private typing(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(t);
    }
    return el.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.syncModifiers(e);
    if (this.captureResolve) {
      this.handleCapture(e);
      return;
    }
    const typing = this.typing();
    if (!typing) this.held.add(e.code);
    if (e.repeat) {
      // swallow browser defaults for held game keys (space scrolling etc.)
      if (!typing && this.enabled && this.match(e).length) e.preventDefault();
      return;
    }
    const escape = e.code === 'Escape';
    if (!escape && (typing || !this.enabled)) return;
    const actions = this.match(e);
    if (!actions.length) return;
    if (!typing) e.preventDefault();
    for (const a of actions) this.fire(a);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.syncModifiers(e);
    this.held.delete(e.code);
    if (e.key === 'Meta' || e.code.startsWith('Meta')) {
      // browsers drop keyup of other keys while Meta is held (macOS)
      this.held.clear();
    }
    if (this.captureResolve && this.captureModifier === e.code) {
      // a lone modifier press+release binds the modifier itself (e.g. "ShiftLeft")
      this.finishCapture(e.code);
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private clearHeld = (): void => {
    this.held.clear();
    this.modifiers.shift = this.modifiers.ctrl = this.modifiers.alt = false;
  };

  /** window lost focus: held keys and any drag in progress are abandoned */
  private onBlur = (): void => {
    this.clearHeld();
    if (this.dragPointer >= 0) {
      this.dragPointer = -1;
      this.dragFromCanvas = false;
      this.emit({
        type: 'leave', button: -1, buttons: 0, clientX: this.pointer.x, clientY: this.pointer.y, dx: 0, dy: 0, wheel: 0,
        shift: false, ctrl: false, alt: false, onCanvas: false, pointerType: 'mouse',
      });
    }
  };

  /** actions whose binding matches a keydown. Exact modifier match wins; a
   *  plain binding still fires with Shift held when no Shift binding exists. */
  private match(e: KeyboardEvent): ActionId[] {
    const code = e.code;
    if (!code) return [];
    const ctrl = e.ctrlKey || (isMac && e.metaKey);
    const shift = e.shiftKey;
    const alt = e.altKey;
    const modKey = isModifierCode(code);
    const exact: ActionId[] = [];
    const loose: ActionId[] = [];
    for (const b of this.bindings) {
      const c = b.combo;
      if (c.code !== code) {
        // a modifier binding like "ShiftLeft" also accepts its right twin
        if (!(modKey && isModifierCode(c.code) && c.code.replace(/Left|Right/, '') === code.replace(/Left|Right/, ''))) continue;
      }
      if (modKey) {
        exact.push(b.action);
        continue;
      }
      if (c.ctrl !== ctrl || c.alt !== alt) continue;
      if (c.shift === shift) exact.push(b.action);
      else if (shift && !c.shift) loose.push(b.action);
    }
    return exact.length ? exact : loose;
  }

  private fire(a: ActionId): void {
    const set = this.actionFns.get(a);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn();
      } catch (err) {
        console.error(`[input] action ${a} failed`, err);
      }
    }
  }

  private handleCapture(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.finishCapture(null);
      return;
    }
    if (isModifierCode(e.code)) {
      this.captureModifier = e.code;
      return;
    }
    this.finishCapture(eventCombo(e));
  }

  private finishCapture(combo: string | null): void {
    const r = this.captureResolve;
    this.captureResolve = null;
    this.captureModifier = null;
    this.clearHeld();
    r?.(combo);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Pointer
  // ════════════════════════════════════════════════════════════════════════

  private emit(p: PointerInfo): void {
    p.claimed = this.claimedMask;
    for (const fn of [...this.pointerFns]) {
      try {
        fn(p);
      } catch (err) {
        console.error('[input] pointer handler failed', err);
      }
    }
  }

  private info(type: PointerInfo['type'], e: PointerEvent | WheelEvent, onCanvas: boolean, over?: Partial<PointerInfo>): PointerInfo {
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    return {
      type, button: e.button, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY,
      dx: type === 'move' ? dx : 0, dy: type === 'move' ? dy : 0, wheel: 0,
      shift: e.shiftKey, ctrl: e.ctrlKey || (isMac && e.metaKey), alt: e.altKey,
      onCanvas, pointerType: (e as PointerEvent).pointerType ?? 'mouse',
      ...over,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.syncModifiers(e);
    if (e.pointerType === 'touch') {
      this.touchDown(e);
      return;
    }
    // focus leaves text fields when clicking the world
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== document.body && this.typing()) ae.blur();
    if (this.dragPointer < 0) {
      this.dragPointer = e.pointerId;
      this.dragFromCanvas = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (e.button === 1) e.preventDefault(); // no autoscroll
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.overCanvas = true;
    this.emit(this.info('down', e, true));
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchMove(e);
      return;
    }
    this.syncModifiers(e);
    const onCanvas = e.target === this.canvas || (this.dragPointer === e.pointerId && this.dragFromCanvas);
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.overCanvas = e.target === this.canvas;
    if (e.button >= 0 && this.dragPointer === e.pointerId) {
      // chorded press/release of another button while one is held (Pointer
      // Events report these as pointermove with `button` set)
      const bit = BUTTON_BIT[e.button] ?? 0;
      this.emit(this.info(e.buttons & bit ? 'down' : 'up', e, onCanvas));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }
    const p = this.info('move', e, onCanvas);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.emit(p);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchUp(e, false);
      return;
    }
    this.syncModifiers(e);
    const fromCanvas = this.dragPointer === e.pointerId ? this.dragFromCanvas : e.target === this.canvas;
    if (e.buttons === 0 && this.dragPointer === e.pointerId) {
      this.dragPointer = -1;
      this.dragFromCanvas = false;
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    this.emit(this.info('up', e, fromCanvas));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchUp(e, true);
      return;
    }
    if (this.dragPointer === e.pointerId) {
      this.dragPointer = -1;
      this.dragFromCanvas = false;
    }
    this.emit(this.info('leave', e, false));
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    this.pointer.overCanvas = false;
    if (this.dragPointer >= 0) return; // captured drag continues
    this.emit(this.info('leave', e, false));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.syncModifiers(e);
    let d = e.deltaY;
    if (e.deltaMode === 1) d /= 3; // lines: 3 per notch
    else if (e.deltaMode === 2) d *= 1; // pages
    else d /= 100; // pixels: ~100 per notch
    if (e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 50) d *= 4; // trackpad pinch reports small deltas
    const wheel = Math.max(-6, Math.min(6, d));
    this.emit(this.info('wheel', e as unknown as PointerEvent, true, { wheel, button: -1 }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // Touch: one finger = left-button tool pointer, two fingers = gestures
  // ════════════════════════════════════════════════════════════════════════

  private touchDown(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const t: TouchPoint = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, startT: performance.now() };
    this.touches.set(e.pointerId, t);
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.overCanvas = true;
    if (this.touchIgnore.size) {
      this.touchIgnore.add(e.pointerId);
      return;
    }
    const n = this.touches.size;
    if (n === 1) {
      // wait a moment: a second finger may follow (then it's a gesture)
      this.touchPending = e.pointerId;
      this.touchTimer = performance.now();
      return;
    }
    if (n === 2) {
      // abort any single-finger tool interaction
      if (this.touchTool >= 0) {
        const tp = this.touches.get(this.touchTool);
        this.emit(this.touchInfo('leave', tp ?? t, 0, 0));
        this.touchTool = -1;
      }
      this.touchPending = -1;
      this.startGesture();
      return;
    }
    // 3+ fingers: ignored (the gesture keeps using the first two)
    this.touchIgnore.add(e.pointerId);
  }

  private touchInfo(type: PointerInfo['type'], t: TouchPoint, dx: number, dy: number): PointerInfo {
    const pressed = type === 'down' || type === 'move';
    return {
      type, button: 0, buttons: pressed ? 1 : 0, clientX: t.x, clientY: t.y, dx, dy, wheel: 0,
      shift: this.modifiers.shift, ctrl: this.modifiers.ctrl, alt: this.modifiers.alt,
      onCanvas: true, pointerType: 'touch',
    };
  }

  private commitPendingTouch(): void {
    const t = this.touches.get(this.touchPending);
    this.touchPending = -1;
    if (!t || this.touches.size !== 1) return;
    this.touchTool = t.id;
    // replay the press where it started, then catch up to the current position
    const cur = { x: t.x, y: t.y };
    t.x = t.startX;
    t.y = t.startY;
    this.emit(this.touchInfo('move', t, 0, 0));
    this.emit(this.touchInfo('down', t, 0, 0));
    if (cur.x !== t.x || cur.y !== t.y) {
      const dx = cur.x - t.x, dy = cur.y - t.y;
      t.x = cur.x;
      t.y = cur.y;
      this.emit(this.touchInfo('move', t, dx, dy));
    }
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    if (this.touchIgnore.has(e.pointerId)) return;
    if (this.touchPending === e.pointerId) {
      if (Math.hypot(t.x - t.startX, t.y - t.startY) >= TOUCH_COMMIT_PX) this.commitPendingTouch();
      return;
    }
    if (this.touchTool === e.pointerId) {
      this.emit(this.touchInfo('move', t, dx, dy));
      return;
    }
    if (this.gestureMode !== 'none') this.updateGesture();
  }

  private touchUp(e: PointerEvent, cancelled: boolean): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    this.touches.delete(e.pointerId);
    if (this.touchIgnore.delete(e.pointerId)) {
      if (!this.touches.size) this.touchIgnore.clear();
      return;
    }
    if (this.touchPending === e.pointerId) {
      // quick tap: press + release at the same spot
      if (!cancelled) {
        this.touchPending = -1;
        this.touchTool = t.id;
        const at = { ...t, x: t.startX, y: t.startY };
        this.emit(this.touchInfo('move', at, 0, 0));
        this.emit(this.touchInfo('down', at, 0, 0));
        this.emit(this.touchInfo('up', at, 0, 0));
      }
      this.touchPending = -1;
      this.touchTool = -1;
      return;
    }
    if (this.touchTool === e.pointerId) {
      this.emit(this.touchInfo(cancelled ? 'leave' : 'up', t, 0, 0));
      this.touchTool = -1;
      return;
    }
    if (this.gestureMode !== 'none') {
      // gesture ends; remaining fingers stay ignored until lifted
      this.gestureMode = 'none';
      for (const id of this.touches.keys()) this.touchIgnore.add(id);
    }
  }

  private gesturePair(): [TouchPoint, TouchPoint] | null {
    const it = this.touches.values();
    const a = it.next().value, b = it.next().value;
    return a && b ? [a, b] : null;
  }

  private startGesture(): void {
    const p = this.gesturePair();
    if (!p) return;
    const [a, b] = p;
    this.gestureMode = 'undecided';
    this.gestureAcc = 0;
    this.gesturePrev = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  private updateGesture(): void {
    const p = this.gesturePair();
    if (!p) return;
    const [a, b] = p;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const prev = this.gesturePrev;
    const dcx = cx - prev.cx, dcy = cy - prev.cy;
    let dAng = angle - prev.angle;
    if (dAng > Math.PI) dAng -= Math.PI * 2;
    if (dAng < -Math.PI) dAng += Math.PI * 2;
    const zoom = dist / prev.dist;
    this.gesturePrev = { cx, cy, dist, angle };
    if (this.gestureMode === 'undecided') {
      this.gestureAcc += Math.hypot(dcx, dcy) + Math.abs(dist - prev.dist) + Math.abs(dAng) * dist * 0.5;
      if (this.gestureAcc < GESTURE_DECIDE_PX) return;
      // fingers side by side moving together vertically without pinching → tilt
      const sideBySide = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) * 1.3;
      const vertical = Math.abs(cy - (a.startY + b.startY) / 2) > Math.abs(cx - (a.startX + b.startX) / 2) * 2;
      const pinch = Math.abs(dist - Math.hypot(b.startX - a.startX, b.startY - a.startY));
      this.gestureMode = sideBySide && vertical && pinch < 24 ? 'tilt' : 'panzoom';
    }
    const g: Gesture = this.gestureMode === 'tilt'
      ? { panX: 0, panY: 0, zoom: 1, rotate: 0, tilt: dcy }
      : { panX: dcx, panY: dcy, zoom, rotate: dAng, tilt: 0 };
    for (const fn of [...this.gestureFns]) {
      try {
        fn(g);
      } catch (err) {
        console.error('[input] gesture handler failed', err);
      }
    }
  }
}
