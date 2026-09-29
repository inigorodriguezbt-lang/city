// Shared plumbing for the built-in tools: a preview group in the scene, the
// cursor label, guarded sound/toast helpers and the last pointer state.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { ActionId } from '../settings/types';
import type { SfxId } from '../audio/AudioManager';
import type { Tool, ToolPointerEvent } from './Tool';
import { CursorLabel, releaseGpu, type LabelContent } from './preview';
import { formatMoney } from '../core/util';

export abstract class BaseTool implements Tool {
  abstract readonly id: string;
  /** preview meshes live here; added to the scene while active */
  readonly root = new THREE.Group();
  protected readonly label = new CursorLabel();
  protected active = false;
  /** last pointer event routed to the tool (hover or drag) */
  protected last: ToolPointerEvent | null = null;
  /** set when a tool wants the right mouse button for itself (e.g. erase drags) */
  claimsRight = false;
  private labelContent: LabelContent | null = null;

  constructor(protected game: Game) {
    this.root.name = 'tool-preview';
    this.root.renderOrder = 20;
  }

  protected get world(): World | null {
    return this.game.world;
  }

  activate(opts?: unknown): void {
    this.active = true;
    this.last = null;
    if (!this.root.parent) this.game.renderer.scene.add(this.root);
    this.root.visible = true;
    this.onActivate(opts);
  }

  deactivate(): void {
    this.cancelDrag();
    this.onDeactivate();
    this.root.removeFromParent();
    releaseGpu(this.root);
    this.label.hide();
    this.labelContent = null;
    this.active = false;
  }

  /** abort an in-progress drag without applying it; true if there was one */
  cancelDrag(): boolean {
    return false;
  }

  /** the pointer left the canvas (over UI / off window) */
  onPointerLeave(): void {
    this.label.hide();
  }

  protected abstract onActivate(opts?: unknown): void;
  protected abstract onDeactivate(): void;

  /** per-frame: animates shader time on subclasses' layers */
  update(_dt: number): void {
    if (this.labelContent && this.last) this.label.show(this.last.clientX, this.last.clientY, this.labelContent);
  }

  // ── helpers ────────────────────────────────────────────────────────────
  protected setLabel(c: LabelContent | null): void {
    this.labelContent = c;
    if (!c || !this.last) this.label.hide();
    else this.label.show(this.last.clientX, this.last.clientY, c);
  }

  protected sfx(id: SfxId, vol = 1): void {
    try {
      this.game.audio.play(id, vol);
    } catch {
      /* audio unavailable */
    }
  }

  protected toast(text: string, kind: 'info' | 'good' | 'warning' | 'danger' = 'info'): void {
    try {
      this.game.ui.toast(text, kind);
    } catch {
      /* ui unavailable */
    }
  }

  /** floating cost feedback at the last pointer position */
  protected flashCost(cost: number): void {
    if (!this.last || !cost || this.world?.creative) return;
    CursorLabel.flash(this.last.clientX, this.last.clientY, cost > 0 ? `−${formatMoney(cost)}` : `+${formatMoney(-cost)}`, cost > 0 ? 'money' : 'refund');
  }

  protected flashText(text: string, tone: 'money' | 'refund' | 'bad' | 'info' = 'info'): void {
    if (!this.last) return;
    CursorLabel.flash(this.last.clientX, this.last.clientY, text, tone);
  }

  /** error feedback: sound + floating reason */
  protected reject(reason: string | undefined): void {
    this.sfx('error', 0.8);
    this.flashText(reason ?? 'Cannot do that here', 'bad');
  }

  protected key(action: ActionId): string {
    try {
      return this.game.input.bindingLabel(action);
    } catch {
      return '';
    }
  }

  protected get time(): number {
    return this.game.time ?? performance.now() / 1000;
  }
}

/** Shallow-equal comparison of tool option objects (ToolManager toggling). */
export function sameOpts(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return (a ?? null) === (b ?? null);
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

/** Bresenham cells between two cells (inclusive) — continuous brush strokes */
export function lineCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (let guard = 0; guard < 4096; guard++) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}
