// Road tool: click-drag from A to B. Default L-shaped path, Shift = straight /
// diagonal staircase, Ctrl = auto path (A*), Alt = replace zoned buildings.
// Live ghost strip draped over the graded terrain / bridge decks, snapping to
// existing road ends, upgrades when dragged over other road types.
import { CELL } from '../core/constants';
import { Layer, RoadType, type Cell, type Rect } from '../core/types';
import { formatMoney } from '../core/util';
import { roadDef } from '../data/roads';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import { RoadCellState, type RoadAnalysis } from '../world/actions';
import type { World } from '../world/World';
import { BaseTool } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { GroundCircle, TileLayer, TONE } from './preview';

export interface RoadToolOpts {
  type: RoadType;
}

type PathMode = 'straight' | 'lshape' | 'auto';

export class RoadTool extends BaseTool {
  readonly id = 'road';
  private type: RoadType = RoadType.Street;
  private start: Cell | null = null;
  private hover: Cell | null = null;
  private dragging = false;
  private analysis: RoadAnalysis | null = null;
  private planKey = '';
  private worldGen = 0;
  private tiles = new TileLayer({ lift: 0.45 });
  private startMark = new GroundCircle({ color: TONE.accent, fill: 0.28, opacity: 0.95, ringWidth: 1.4, falloff: 0 });
  private endMark = new GroundCircle({ color: TONE.accent, fill: 0.18, opacity: 0.8, ringWidth: 1.2, falloff: 0 });
  private offWorld: (() => void) | null = null;
  /** bounding box (+ auto-path margin) of the current plan */
  private pathBox: Rect | null = null;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh, this.startMark.mesh, this.endMark.mesh);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as Partial<RoadToolOpts>;
    this.type = typeof o.type === 'number' && o.type !== RoadType.None ? o.type : RoadType.Street;
    this.start = null;
    this.dragging = false;
    this.analysis = null;
    this.planKey = '';
    this.offWorld = this.game.events.on('world:changed', ({ rect, layers }) => {
      if (layers & (Layer.Road | Layer.Terrain | Layer.Water)) this.worldGen++;
      else if (layers & Layer.Building) {
        // growth elsewhere in the city must not re-plan the drag every frame
        const b = this.pathBox;
        if (b && rect.x1 >= b.x0 && rect.x0 <= b.x1 && rect.y1 >= b.y0 && rect.y0 <= b.y1) this.worldGen++;
      }
    });
  }

  protected onDeactivate(): void {
    this.offWorld?.();
    this.offWorld = null;
    this.tiles.clear();
    this.startMark.hide();
    this.endMark.hide();
    this.hover = null;
  }

  override cancelDrag(): boolean {
    if (!this.dragging) return false;
    this.dragging = false;
    this.start = null;
    this.planKey = '';
    this.refresh();
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    if (!this.dragging) {
      this.hover = null;
      this.tiles.clear();
      this.endMark.hide();
      this.startMark.hide();
    }
  }

  private mode(e: ToolPointerEvent | null): PathMode {
    if (e?.ctrl) return 'auto';
    if (e?.shift) return 'straight';
    return 'lshape';
  }

  /** snap the cursor cell to a nearby dead-end of the same network */
  private snap(w: World, e: ToolPointerEvent): Cell | null {
    if (!e.cell) return null;
    const c = e.cell;
    const rail = this.type === RoadType.Rail;
    if (w.roadAt(c.x, c.y)) return c;
    if (!e.point) return c;
    let best: Cell | null = null;
    let bestD = CELL * 1.05;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = c.x + dx, y = c.y + dy;
        const t = w.roadAt(x, y);
        if (!t || (t === RoadType.Rail) !== rail) continue;
        const m = w.roadMask(x, y);
        const deg = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
        if (deg > 1) continue;
        const d = Math.hypot((x + 0.5) * CELL - e.point.x, (y + 0.5) * CELL - e.point.z);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best ?? c;
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    const w = this.world;
    if (!w || e.button !== 0) return;
    const c = this.snap(w, e);
    if (!c) return;
    this.start = c;
    this.hover = c;
    this.dragging = true;
    this.planKey = '';
    this.refresh();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    const w = this.world;
    if (!w) return;
    const c = this.snap(w, e);
    if (c) this.hover = c;
    else if (!this.dragging) this.hover = null;
    this.refresh();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    if (!this.dragging || e.button !== 0) return;
    const w = this.world;
    this.refresh();
    const a = this.analysis;
    this.dragging = false;
    this.start = null;
    this.planKey = '';
    if (!w || !a) {
      this.refresh();
      return;
    }
    if (!a.ok) {
      if (a.newCells > 0 || a.invalid.length) this.reject(a.reason);
      this.refresh();
      return;
    }
    const res = this.game.actions.placeRoad(a.cells, this.type, { replace: e.alt });
    if (res.ok) {
      this.sfx('road');
      this.flashCost(res.cost);
    } else this.reject(res.reason);
    this.refresh();
  }

  onAction(_action: ActionId): boolean {
    return false;
  }

  override update(dt: number): void {
    const t = this.time;
    this.tiles.tick(t);
    this.startMark.tick(t);
    this.endMark.tick(t);
    super.update(dt);
  }

  /** recompute the plan + preview for the current pointer state */
  private refresh(): void {
    const w = this.world;
    const e = this.last;
    if (!w || !this.hover) {
      this.tiles.clear();
      this.startMark.hide();
      this.endMark.hide();
      this.setLabel(null);
      this.analysis = null;
      return;
    }
    const mode = this.mode(e);
    const replace = !!e?.alt;
    const from = this.dragging && this.start ? this.start : this.hover;
    const afford = this.analysis ? w.canAfford(this.analysis.cost) : true;
    const key = `${from.x},${from.y}>${this.hover.x},${this.hover.y}|${mode}|${replace}|${this.type}|${this.worldGen}|${afford}`;
    if (key !== this.planKey) {
      const path = this.dragging ? this.game.actions.planRoad(from, this.hover, this.type, mode) : [this.hover];
      this.analysis = this.game.actions.checkRoad(path, this.type, { replace });
      const m = mode === 'auto' ? 24 : 1;
      this.pathBox = {
        x0: Math.min(from.x, this.hover.x) - m, y0: Math.min(from.y, this.hover.y) - m,
        x1: Math.max(from.x, this.hover.x) + m, y1: Math.max(from.y, this.hover.y) + m,
      };
      this.planKey = key.replace(/\|(true|false)$/, `|${w.canAfford(this.analysis.cost)}`);
      this.draw(w, this.analysis);
    }
    this.updateLabel(this.analysis);
  }

  private draw(w: World, a: RoadAnalysis): void {
    const t = this.tiles;
    const s1 = w.size + 1;
    const hAt = (vx: number, vy: number) => {
      const v = vy * s1 + vx;
      return a.grading.get(v) ?? w.heights[v];
    };
    const unaffordable = !a.invalid.length && a.newCells > 0 && !a.ok;
    t.begin();
    for (let k = 0; k < a.cells.length; k++) {
      const c = a.cells[k];
      if (!w.inBounds(c.x, c.y)) continue;
      const st = a.state[k];
      const br = a.bridge[k] === 1;
      let col: number = TONE.ok;
      let alpha = 0.62;
      if (st === RoadCellState.Invalid) {
        col = TONE.bad;
        alpha = 0.78;
      } else if (st === RoadCellState.Existing) {
        col = TONE.existing;
        alpha = 0.28;
      } else if (st === RoadCellState.Upgrade) {
        col = TONE.upgrade;
        alpha = 0.66;
      } else if (br) {
        col = TONE.bridge;
        alpha = 0.7;
      }
      if (unaffordable && st !== RoadCellState.Existing) {
        col = TONE.bad;
        alpha = 0.6;
      }
      if (br) t.add(w, c.x, c.y, col, alpha, { flat: a.surface[k] - 0.2 });
      else if (st === RoadCellState.New) t.add(w, c.x, c.y, col, alpha, { corners: [hAt(c.x, c.y), hAt(c.x + 1, c.y), hAt(c.x, c.y + 1), hAt(c.x + 1, c.y + 1)] });
      else t.add(w, c.x, c.y, col, alpha, { lift: 0.25 });
    }
    t.end();
    // endpoint markers
    const first = a.cells[0], lastC = a.cells[a.cells.length - 1];
    if (first) {
      this.mark(this.startMark, w, first);
      this.startMark.setStyle({ color: a.ok || a.state[0] !== RoadCellState.Invalid ? TONE.accent : TONE.bad });
    }
    if (lastC && a.cells.length > 1) {
      this.mark(this.endMark, w, lastC);
      this.endMark.setStyle({ color: a.state[a.cells.length - 1] === RoadCellState.Invalid ? TONE.bad : TONE.accent });
    } else this.endMark.hide();
  }

  private mark(circle: GroundCircle, w: World, c: Cell): void {
    circle.set(w, (c.x + 0.5) * CELL, (c.y + 0.5) * CELL, CELL * 0.32);
  }

  private updateLabel(a: RoadAnalysis | null): void {
    const w = this.world;
    if (!a || !w) {
      this.setLabel(null);
      return;
    }
    const def = roadDef(this.type);
    const len = a.cells.length * CELL;
    const creative = w.creative;
    const bridges = a.bridges.length;
    const extras: string[] = [];
    if (bridges) extras.push(`${bridges} bridge${bridges > 1 ? 's' : ''}`);
    if (a.upgrades.length) extras.push(`${a.upgrades.length} upgrade${a.upgrades.length > 1 ? 's' : ''}`);
    if (a.replaces.length) extras.push(`replaces ${a.replaces.length} building${a.replaces.length > 1 ? 's' : ''}`);
    const invalid = a.invalid.length > 0;
    const value = a.newCells === 0 ? 'Built' : creative ? 'Free' : formatMoney(a.cost);
    const valueTone = a.newCells === 0 ? 'dim' : !w.canAfford(a.cost) ? 'bad' : 'money';
    if (!this.dragging) {
      this.setLabel({
        title: def.name,
        value: creative ? 'Free' : `${formatMoney(def.cost)}/cell`,
        valueTone: creative ? 'dim' : 'money',
        tone: invalid ? 'bad' : 'ok',
        sub: invalid ? a.reason : a.newCells === 0 ? 'Drag over roads to upgrade them' : undefined,
        subTone: invalid ? 'bad' : 'dim',
        keys: [['Drag', 'build'], ['Shift', 'straight'], ['Ctrl', 'auto'], ['Alt', 'replace']],
      });
      return;
    }
    const lenTxt = len >= 1000 ? `${(len / 1000).toFixed(2)} km` : `${len} m`;
    const mode = this.mode(this.last);
    const modeTxt = mode === 'auto' ? ' · auto' : mode === 'straight' ? ' · straight' : '';
    this.setLabel({
      title: `${def.name} · ${lenTxt}${modeTxt}`,
      value,
      valueTone,
      tone: a.ok ? 'ok' : 'bad',
      sub: !a.ok && a.reason ? a.reason : extras.join(' · ') || undefined,
      subTone: !a.ok ? 'bad' : a.replaces.length ? 'warn' : 'dim',
    });
  }

  hint(): string {
    const def = roadDef(this.type);
    const w = this.world;
    const a = this.analysis;
    if (this.dragging && a) {
      const len = a.cells.length * CELL;
      const cost = w?.creative ? 'Free' : formatMoney(a.cost);
      const parts = [def.name, `${a.cells.length} cells`, `${len} m`, cost];
      if (!a.ok && a.reason) parts.push(a.reason);
      parts.push('Shift straight', 'Ctrl auto', 'Alt replace');
      return parts.join(' · ');
    }
    const per = w?.creative ? 'Free' : `${formatMoney(def.cost)}/cell`;
    const extra = this.type === RoadType.Dirt ? 'no bridges' : 'bridges ×3';
    return `${def.name} · ${per} (${extra}) · Drag to build · Shift straight · Ctrl auto · Alt replace`;
  }
}
