// Terraforming brush: raise / lower / smooth / flatten (to the height where the
// stroke started) / level (to just above sea level). Applies continuously while
// held; one stroke = one undo step. [ ] radius, Shift+[ ] strength.
import { formatMoney } from '../core/util';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import type { TerraformMode } from '../world/actions';
import { BaseTool } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { GroundCircle } from './preview';

export interface TerraformToolOpts {
  mode: TerraformMode;
}

const RADII = [16, 24, 32, 48, 64, 96, 128, 176];
const STRENGTHS = [0.5, 1, 2, 4, 8];
const STRENGTH_NAMES = ['Gentle', 'Soft', 'Medium', 'Strong', 'Extreme'];
/** applications per second while held */
const RATE = 20;

const MODE_INFO: Record<TerraformMode, { name: string; color: number; verb: string }> = {
  raise: { name: 'Raise terrain', color: 0x7ee787, verb: 'Raising' },
  lower: { name: 'Lower terrain', color: 0xffa24d, verb: 'Lowering' },
  smooth: { name: 'Smooth terrain', color: 0x4cc2ff, verb: 'Smoothing' },
  flatten: { name: 'Flatten', color: 0xb99cff, verb: 'Flattening' },
  level: { name: 'Level to sea', color: 0x5ad1ff, verb: 'Leveling' },
};

export class TerraformTool extends BaseTool {
  readonly id = 'terraform';
  private mode: TerraformMode = 'raise';
  private radiusIdx = 3;
  private strengthIdx = 2;
  private brush = new GroundCircle({ color: 0x7ee787, fill: 0.2, falloff: 1, opacity: 0.95, ringWidth: 2 });
  private inner = new GroundCircle({ color: 0xffffff, fill: 0, opacity: 0.35, ringWidth: 1, dashes: 32 });
  private stroke: { target?: number; cost: number; acc: number; failed: boolean } | null = null;
  private estimate = 0;

  constructor(game: Game) {
    super(game);
    this.root.add(this.brush.mesh, this.inner.mesh);
  }

  private get radius(): number {
    return RADII[this.radiusIdx];
  }
  private get strength(): number {
    return STRENGTHS[this.strengthIdx];
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as Partial<TerraformToolOpts>;
    this.mode = o.mode && o.mode in MODE_INFO ? o.mode : 'raise';
    this.brush.setStyle({ color: MODE_INFO[this.mode].color });
    this.stroke = null;
  }

  protected onDeactivate(): void {
    this.brush.hide();
    this.inner.hide();
  }

  override cancelDrag(): boolean {
    if (!this.stroke) return false;
    this.endStroke();
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    if (!this.stroke) {
      this.brush.hide();
      this.inner.hide();
    }
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    const w = this.world;
    if (!w || !e.point || e.button !== 0) return;
    if (this.stroke) this.cancelDrag(); // a lost pointerup never leaves a stroke open
    const target = this.mode === 'flatten' ? w.heightAt(e.point.x, e.point.z) : undefined;
    this.game.actions.beginGroup(MODE_INFO[this.mode].name);
    this.stroke = { target, cost: 0, acc: 1 / RATE, failed: false };
    this.apply(1 / RATE);
    this.redraw();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    this.redraw();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    if (!this.stroke) return;
    this.endStroke();
    this.redraw();
  }

  private endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    this.game.actions.endGroup();
    if (s && s.cost > 0) this.flashCost(s.cost);
  }

  private apply(step: number): void {
    const s = this.stroke;
    const p = this.last?.point;
    if (!s || !p || s.failed) return;
    const res = this.game.actions.terraform(p.x, p.z, this.radius, this.mode, this.strength * step * (this.mode === 'raise' || this.mode === 'lower' ? 1 : 3), s.target);
    if (res.ok) {
      s.cost += res.cost;
    } else if (res.reason && /money/i.test(res.reason)) {
      s.failed = true;
      this.reject(res.reason);
    }
  }

  onAction(action: ActionId): boolean {
    if (action !== 'tool.brushBigger' && action !== 'tool.brushSmaller') return false;
    const d = action === 'tool.brushBigger' ? 1 : -1;
    if (this.game.input.modifiers?.shift) {
      this.strengthIdx = Math.max(0, Math.min(STRENGTHS.length - 1, this.strengthIdx + d));
      this.flashText(`Strength: ${STRENGTH_NAMES[this.strengthIdx]}`, 'info');
    } else {
      this.radiusIdx = Math.max(0, Math.min(RADII.length - 1, this.radiusIdx + d));
      this.flashText(`Radius ${this.radius} m`, 'info');
    }
    this.sfx('hover', 0.5);
    this.redraw();
    return true;
  }

  override update(dt: number): void {
    const s = this.stroke;
    if (s && !s.failed) {
      s.acc += dt;
      const step = 1 / RATE;
      let n = 0;
      while (s.acc >= step && n < 4) {
        s.acc -= step;
        this.apply(step);
        n++;
      }
      if (s.acc > step) s.acc = 0;
      if (n) this.redraw();
    }
    this.brush.tick(this.time);
    this.inner.tick(this.time);
    super.update(dt);
  }

  private redraw(): void {
    const w = this.world;
    const p = this.last?.point;
    if (!w || !p) {
      this.brush.hide();
      this.inner.hide();
      this.setLabel(null);
      return;
    }
    this.brush.set(w, p.x, p.z, this.radius);
    this.inner.set(w, p.x, p.z, this.radius * 0.5);
    const info = MODE_INFO[this.mode];
    const s = this.stroke;
    if (!s) {
      const perSec = this.game.actions.terraformCost(p.x, p.z, this.radius, this.mode, this.strength * (this.mode === 'raise' || this.mode === 'lower' ? 1 : 3), this.mode === 'flatten' ? w.heightAt(p.x, p.z) : undefined);
      this.estimate = perSec;
    }
    const creative = w.creative;
    const h = w.heightAt(p.x, p.z);
    const targetTxt = this.mode === 'flatten' ? ` to ${(s?.target ?? h).toFixed(1)} m` : this.mode === 'level' ? ` to ${(w.seaLevel + 1.2).toFixed(1)} m` : '';
    this.setLabel({
      title: s ? `${info.verb}${targetTxt}` : `${info.name}${targetTxt}`,
      value: creative ? undefined : s ? formatMoney(s.cost) : this.estimate > 0 ? `~${formatMoney(this.estimate)}/s` : undefined,
      valueTone: s ? 'money' : 'dim',
      tone: 'info',
      sub: `${this.radius} m · ${STRENGTH_NAMES[this.strengthIdx]} · ground ${h.toFixed(1)} m`,
      subTone: 'dim',
      keys: s ? undefined : [[`${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')}`, 'radius'], [`Shift+${this.key('tool.brushBigger')}`, 'strength']],
    });
  }

  hint(): string {
    const info = MODE_INFO[this.mode];
    const cost = this.stroke && !this.world?.creative ? ` · ${formatMoney(this.stroke.cost)}` : '';
    return `${info.name} · radius ${this.radius} m · ${STRENGTH_NAMES[this.strengthIdx]}${cost} · hold to apply · ${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')} radius · Shift strength · roads & buildings are protected`;
  }
}
