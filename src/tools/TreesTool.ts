// Tree brush: plant (density 1-3) or remove trees. Painting while held; one
// stroke = one undo step. [ ] brush radius.
import { CELL } from '../core/constants';
import type { Cell } from '../core/types';
import { formatMoney } from '../core/util';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import { BaseTool } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { GroundCircle, TileLayer, TONE } from './preview';

export interface TreesToolOpts {
  /** 1 sparse … 3 dense (default 2) */
  density?: number;
  erase?: boolean;
}

const DENSITY_NAME = ['', 'Sparse', 'Woodland', 'Dense forest'];
/** re-apply interval while the brush is held still (s) */
const REPEAT = 0.16;

export class TreesTool extends BaseTool {
  readonly id = 'trees';
  override claimsRight = true;
  private density = 2;
  private erase = false;
  private radius = 2;
  private ring = new GroundCircle({ color: 0x46b35a, fill: 0.12, falloff: 1, opacity: 0.9, ringWidth: 1.8 });
  private tiles = new TileLayer({ lift: 0.25 });
  private hoverCell: Cell | null = null;
  private stroke: { erase: boolean; last: Cell | null; acc: number; cost: number; planted: number; failed: boolean } | null = null;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh, this.ring.mesh);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as TreesToolOpts;
    this.erase = !!o.erase || o.density === 0;
    this.density = Math.max(1, Math.min(3, Math.round(o.density ?? 2)));
    this.stroke = null;
  }

  protected onDeactivate(): void {
    this.tiles.clear();
    this.ring.hide();
    this.hoverCell = null;
  }

  override cancelDrag(): boolean {
    if (!this.stroke) return false;
    this.stroke = null;
    this.game.actions.endGroup();
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    if (!this.stroke) {
      this.hoverCell = null;
      this.tiles.clear();
      this.ring.hide();
    }
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    if (!this.world || !e.cell) return;
    if (this.stroke) this.cancelDrag(); // a lost pointerup never leaves a stroke open
    const erase = this.erase || e.button === 2;
    this.game.actions.beginGroup(erase ? 'Remove trees' : 'Plant trees');
    this.stroke = { erase, last: null, acc: 0, cost: 0, planted: 0, failed: false };
    this.hoverCell = e.cell;
    this.apply(e.cell);
    this.redraw();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    if (e.cell) this.hoverCell = e.cell;
    const s = this.stroke;
    if (s && e.cell && (!s.last || Math.hypot(e.cell.x - s.last.x, e.cell.y - s.last.y) >= Math.max(1, this.radius * 0.5))) this.apply(e.cell);
    this.redraw();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.game.actions.endGroup();
    if (s.planted) {
      this.sfx(s.erase ? 'bulldoze' : 'place', 0.5);
      if (s.cost > 0) this.flashCost(s.cost);
    }
    this.redraw();
  }

  private apply(c: Cell): void {
    const s = this.stroke;
    if (!s || s.failed) return;
    s.last = c;
    s.acc = 0;
    const w = this.world!;
    const before = w.economy.money;
    const res = this.game.actions.plantTrees(c.x, c.y, this.radius, s.erase ? 0 : this.density);
    if (res.ok) {
      s.planted++;
      s.cost += w.creative ? 0 : Math.max(0, before - w.economy.money);
    } else if (res.reason && /money/i.test(res.reason)) {
      s.failed = true;
      this.reject(res.reason);
    }
  }

  onAction(action: ActionId): boolean {
    if (action !== 'tool.brushBigger' && action !== 'tool.brushSmaller') return false;
    this.radius = Math.max(0, Math.min(8, this.radius + (action === 'tool.brushBigger' ? 1 : -1)));
    this.flashText(`Brush ${this.radius * 2 + 1} cells`, 'info');
    this.sfx('hover', 0.5);
    this.redraw();
    return true;
  }

  override update(dt: number): void {
    const s = this.stroke;
    if (s && this.hoverCell && !s.failed) {
      s.acc += dt;
      if (s.acc >= REPEAT) {
        this.apply(this.hoverCell);
        this.redraw();
      }
    }
    this.ring.tick(this.time);
    this.tiles.tick(this.time);
    super.update(dt);
  }

  private redraw(): void {
    const w = this.world;
    const c = this.hoverCell;
    if (!w || !c) {
      this.tiles.clear();
      this.ring.hide();
      this.setLabel(null);
      return;
    }
    const erase = this.stroke ? this.stroke.erase : this.erase;
    const col = erase ? TONE.erase : 0x46b35a;
    const cells = this.game.actions.treeBrush(c.x, c.y, this.radius, erase ? 0 : this.density);
    const t = this.tiles;
    t.begin();
    for (const q of cells) {
      t.add(w, q.x, q.y, col, erase ? 0.4 : 0.18 + q.d * 0.1);
    }
    t.end();
    this.ring.setStyle({ color: col });
    this.ring.set(w, (c.x + 0.5) * CELL, (c.y + 0.5) * CELL, (this.radius + 0.5) * CELL);
    const s = this.stroke;
    const perTree = this.game.actions.treeBrushCost(cells);
    this.setLabel({
      title: erase ? 'Remove trees' : `Plant trees · ${DENSITY_NAME[this.density]}`,
      value: w.creative || erase ? undefined : s ? formatMoney(s.cost) : perTree ? formatMoney(perTree) : undefined,
      valueTone: s ? 'money' : 'dim',
      tone: erase ? 'warn' : 'ok',
      sub: cells.length ? undefined : erase ? 'No trees here' : 'No room for more trees here',
      subTone: 'dim',
      keys: s ? undefined : [[`${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')}`, 'size'], ['RMB', 'remove']],
    });
  }

  hint(): string {
    const name = this.erase ? 'Remove trees' : `Plant trees (${DENSITY_NAME[this.density]})`;
    const cost = this.stroke && !this.world?.creative && this.stroke.cost ? ` · ${formatMoney(this.stroke.cost)}` : '';
    return `${name} · Brush ${this.radius * 2 + 1}${cost} · ${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')} size · Right-drag remove · trees cut noise & pollution`;
  }
}
