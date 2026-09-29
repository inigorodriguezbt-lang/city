// District painting brush. Creates a district on first use when none exists.
// { districtId: 0 } or { erase: true } erases district cells.
import type { Cell, District } from '../core/types';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import { BaseTool, lineCells } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { GroundCircle, TileLayer, TONE } from './preview';
import { CELL } from '../core/constants';

export interface DistrictToolOpts {
  districtId?: number;
  erase?: boolean;
}

/** cells of a disc brush of radius r (cells) around c */
export function discCells(c: Cell, r: number): Cell[] {
  const out: Cell[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= (r + 0.35) * (r + 0.35)) out.push({ x: c.x + dx, y: c.y + dy });
  return out;
}

export class DistrictTool extends BaseTool {
  readonly id = 'district';
  override claimsRight = true;
  private targetId: number | undefined;
  private erase = false;
  private radius = 3;
  /** remembered between activations */
  private lastUsed = 0;
  private tiles = new TileLayer({ lift: 0.25 });
  private ring = new GroundCircle({ color: TONE.accent, fill: 0, opacity: 0.9, ringWidth: 1.6 });
  private hoverCell: Cell | null = null;
  private stroke: { id: number; last: Cell; changed: number } | null = null;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh, this.ring.mesh);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as DistrictToolOpts;
    this.erase = !!o.erase || o.districtId === 0;
    this.targetId = this.erase ? 0 : o.districtId;
    this.stroke = null;
    try {
      this.game.zones.setDistrictsVisible(true);
    } catch {
      /* renderer unavailable */
    }
  }

  protected onDeactivate(): void {
    this.tiles.clear();
    this.ring.hide();
    this.hoverCell = null;
    try {
      this.game.zones.setDistrictsVisible(false);
    } catch {
      /* renderer unavailable */
    }
  }

  /** district this stroke paints (creating one if the city has none) */
  private district(create: boolean): District | null {
    const w = this.world;
    if (!w) return null;
    const find = (id: number | undefined) => (id ? w.districts.find((d) => d.id === id) ?? null : null);
    let d = find(this.targetId) ?? find(this.lastUsed) ?? w.districts[w.districts.length - 1] ?? null;
    if (!d && create) {
      try {
        d = this.game.actions.createDistrict();
        this.toast(`New district: ${d.name}`, 'good');
      } catch (e) {
        this.reject(e instanceof Error ? e.message : 'Cannot create a district');
        return null;
      }
    }
    return d;
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
    const w = this.world;
    if (!w || !e.cell) return;
    if (this.stroke) this.cancelDrag(); // a lost pointerup never leaves a stroke open
    const erase = this.erase || e.button === 2;
    this.game.actions.beginGroup(erase ? 'Erase district' : 'Paint district');
    let id = 0;
    if (!erase) {
      const d = this.district(true);
      if (!d) {
        this.game.actions.endGroup();
        return;
      }
      id = d.id;
      this.lastUsed = d.id;
    }
    this.stroke = { id, last: e.cell, changed: 0 };
    this.paint(discCells(e.cell, this.radius));
    this.hoverCell = e.cell;
    this.redraw();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    if (e.cell) this.hoverCell = e.cell;
    const s = this.stroke;
    if (s && e.cell && (e.cell.x !== s.last.x || e.cell.y !== s.last.y)) {
      const seen = new Set<number>();
      const cells: Cell[] = [];
      for (const c of lineCells(s.last.x, s.last.y, e.cell.x, e.cell.y))
        for (const q of discCells(c, this.radius)) {
          const k = q.y * 65536 + q.x;
          if (!seen.has(k)) {
            seen.add(k);
            cells.push(q);
          }
        }
      s.last = e.cell;
      this.paint(cells);
    }
    this.redraw();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.game.actions.endGroup();
    if (s.changed) this.sfx(s.id ? 'zone' : 'bulldoze', 0.6);
    this.redraw();
  }

  private paint(cells: Cell[]): void {
    const w = this.world;
    const s = this.stroke;
    if (!w || !s) return;
    const valid = cells.filter((c) => w.inBounds(c.x, c.y) && w.district[w.idx(c.x, c.y)] !== s.id);
    if (!valid.length) return;
    this.game.actions.paintDistrict(valid, s.id);
    s.changed += valid.length;
  }

  onAction(action: ActionId): boolean {
    if (action === 'tool.brushBigger' || action === 'tool.brushSmaller') {
      this.radius = Math.max(0, Math.min(12, this.radius + (action === 'tool.brushBigger' ? 1 : -1)));
      this.flashText(`Brush ${this.radius * 2 + 1} cells`, 'info');
      this.sfx('hover', 0.5);
      this.redraw();
      return true;
    }
    return false;
  }

  override update(dt: number): void {
    this.tiles.tick(this.time);
    this.ring.tick(this.time);
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
    const erase = this.stroke ? this.stroke.id === 0 : this.erase;
    const d = erase ? null : this.district(false);
    const col = erase ? TONE.erase : d ? parseInt(d.color.slice(1), 16) : TONE.accent;
    const t = this.tiles;
    t.begin();
    for (const q of discCells(c, this.radius)) {
      if (!w.inBounds(q.x, q.y)) continue;
      const cur = w.district[w.idx(q.x, q.y)];
      const already = erase ? cur === 0 : d !== null && cur === d.id;
      t.add(w, q.x, q.y, already ? TONE.existing : col, already ? 0.12 : 0.45);
    }
    t.end();
    this.ring.setStyle({ color: col });
    this.ring.set(w, (c.x + 0.5) * CELL, (c.y + 0.5) * CELL, (this.radius + 0.5) * CELL);
    this.setLabel({
      title: erase ? 'Erase district' : d ? d.name : 'New district',
      value: this.stroke ? `${this.stroke.changed} cells` : undefined,
      valueTone: 'dim',
      tone: erase ? 'warn' : 'info',
      sub: !erase && !d ? 'Paint to found a new district' : undefined,
      subTone: 'dim',
      keys: this.stroke ? undefined : [[`${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')}`, 'size'], ['RMB', 'erase']],
    });
  }

  hint(): string {
    const d = this.erase ? null : this.district(false);
    const name = this.erase ? 'Erase district' : d ? `Paint ${d.name}` : 'Paint a new district';
    return `${name} · Brush ${this.radius * 2 + 1} · ${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')} size · Right-drag erase`;
  }
}
