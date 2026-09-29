// Zoning tool: brush (sizes 1-9), rectangle drag and flood fill. ZoneType.None
// or a right-drag erases. Shows the zoning grid while active.
import { CELL } from '../core/constants';
import { RoadType, ZoneType, type Cell, type Rect } from '../core/types';
import { zoneDef } from '../data/zones';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import type { World } from '../world/World';
import { BaseTool, lineCells } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { BoxLayer, buildingBox, TileLayer, TONE } from './preview';

export type ZoneMode = 'brush' | 'rect' | 'fill';

export interface ZoneToolOpts {
  zone: ZoneType;
  mode?: ZoneMode;
}

const MODES: ZoneMode[] = ['brush', 'rect', 'fill'];
const MODE_NAME: Record<ZoneMode, string> = { brush: 'Brush', rect: 'Rectangle', fill: 'Fill' };
const MAX_RECT = 96;

export class ZoneTool extends BaseTool {
  readonly id = 'zone';
  override claimsRight = true;
  private zone: ZoneType = ZoneType.ResLow;
  private mode: ZoneMode = 'brush';
  private size = 3;
  private tiles = new TileLayer({ lift: 0.3 });
  /** zoned buildings a rezone/dezone would demolish */
  private boxes = new BoxLayer(32);
  /** active stroke */
  private stroke: { erase: boolean; mode: ZoneMode; start: Cell; lastCell: Cell; changed: number; lastFail?: string } | null = null;
  private hoverCell: Cell | null = null;
  private previewKey = '';
  private fillCache: { key: string; cells: Cell[] } | null = null;
  /** buildings the current preview would demolish */
  private doomed = 0;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh, this.boxes.mesh);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as Partial<ZoneToolOpts>;
    this.zone = typeof o.zone === 'number' ? o.zone : ZoneType.ResLow;
    if (o.mode && MODES.includes(o.mode)) this.mode = o.mode;
    this.stroke = null;
    this.previewKey = '';
    this.fillCache = null;
    try {
      this.game.zones.setGridVisible(true);
    } catch {
      /* renderer unavailable */
    }
  }

  protected onDeactivate(): void {
    this.tiles.clear();
    this.boxes.clear();
    this.hoverCell = null;
    try {
      this.game.zones.setGridVisible(false);
    } catch {
      /* renderer unavailable */
    }
  }

  private get zoneName(): string {
    return this.zone === ZoneType.None ? 'Dezone' : zoneDef(this.zone)?.name ?? 'Zone';
  }

  private color(erase: boolean): number {
    if (erase) return TONE.erase;
    const hex = zoneDef(this.zone)?.color;
    return hex ? parseInt(hex.replace('#', ''), 16) : TONE.ok;
  }

  override cancelDrag(): boolean {
    if (!this.stroke) return false;
    const s = this.stroke;
    this.stroke = null;
    // brush strokes apply live: close the undo group so they stay one step
    if (s.mode === 'brush') this.game.actions.endGroup();
    this.previewKey = '';
    this.redraw();
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    if (!this.stroke) {
      this.hoverCell = null;
      this.tiles.clear();
      this.boxes.clear();
      this.previewKey = '';
    }
  }

  // ── brush geometry ────────────────────────────────────────────────────
  private brushAt(c: Cell, e: ToolPointerEvent | null): Cell[] {
    const n = this.size;
    // even sizes lean toward the quadrant the cursor is in
    let ox = Math.floor((n - 1) / 2), oy = ox;
    if (n % 2 === 0 && e?.point) {
      const fx = e.point.x / CELL - c.x, fy = e.point.z / CELL - c.y;
      if (fx > 0.5) ox = n / 2 - 1;
      else ox = n / 2;
      if (fy > 0.5) oy = n / 2 - 1;
      else oy = n / 2;
    }
    const out: Cell[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ x: c.x - ox + x, y: c.y - oy + y });
    return out;
  }

  private rectOf(a: Cell, b: Cell): Rect {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return { x0: Math.max(x0, x1 - MAX_RECT + 1), y0: Math.max(y0, y1 - MAX_RECT + 1), x1, y1 };
  }

  // ── pointer ───────────────────────────────────────────────────────────
  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    const w = this.world;
    if (!w || !e.cell) return;
    if (this.stroke) this.cancelDrag(); // a lost pointerup never leaves a stroke open
    const erase = e.button === 2 || this.zone === ZoneType.None;
    const mode: ZoneMode = this.mode === 'fill' && e.button === 2 ? 'brush' : this.mode;
    this.hoverCell = e.cell;
    this.stroke = { erase, mode, start: e.cell, lastCell: e.cell, changed: 0 };
    if (mode === 'brush') {
      this.game.actions.beginGroup(erase ? 'Dezone' : `Zone ${this.zoneName}`);
      this.paint(this.brushAt(e.cell, e));
    }
    this.previewKey = '';
    this.redraw();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    if (!this.world) return;
    if (e.cell) this.hoverCell = e.cell;
    const s = this.stroke;
    if (s && s.mode === 'brush' && e.cell && (e.cell.x !== s.lastCell.x || e.cell.y !== s.lastCell.y)) {
      const cells: Cell[] = [];
      const seen = new Set<number>();
      for (const c of lineCells(s.lastCell.x, s.lastCell.y, e.cell.x, e.cell.y))
        for (const b of this.brushAt(c, e)) {
          const k = b.y * 65536 + b.x;
          if (seen.has(k)) continue;
          seen.add(k);
          cells.push(b);
        }
      s.lastCell = e.cell;
      this.paint(cells);
    }
    this.redraw();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const acts = this.game.actions;
    const zone = s.erase ? ZoneType.None : this.zone;
    if (s.mode === 'brush') {
      acts.endGroup();
      if (s.changed > 0) this.sfx(s.erase ? 'bulldoze' : 'zone', s.erase ? 0.5 : 0.8);
      else if (s.lastFail && !s.erase) this.reject(s.lastFail);
    } else if (s.mode === 'rect') {
      const end = e.cell ?? this.hoverCell ?? s.start;
      const res = acts.zoneRect(this.rectOf(s.start, end), zone);
      if (res.ok) this.sfx(s.erase ? 'bulldoze' : 'zone', 0.8);
      else this.reject(res.reason);
    } else {
      const res = acts.zoneFill(s.start, zone);
      if (res.ok) this.sfx(s.erase ? 'bulldoze' : 'zone', 0.8);
      else this.reject(res.reason);
    }
    this.previewKey = '';
    this.fillCache = null;
    this.redraw();
  }

  private paint(cells: Cell[]): void {
    const s = this.stroke;
    const w = this.world;
    if (!s || !w) return;
    const zone = s.erase ? ZoneType.None : this.zone;
    const before = this.countZoned(w, cells, zone);
    const res = this.game.actions.zoneCells(cells, zone);
    if (res.ok) s.changed += Math.max(0, this.countZoned(w, cells, zone) - before);
    else s.lastFail = res.reason;
  }

  private countZoned(w: World, cells: Cell[], zone: ZoneType): number {
    let n = 0;
    for (const c of cells) if (w.inBounds(c.x, c.y) && w.zone[w.idx(c.x, c.y)] === zone) n++;
    return n;
  }

  // ── keys ──────────────────────────────────────────────────────────────
  onAction(action: ActionId): boolean {
    if (action === 'tool.brushBigger' || action === 'tool.brushSmaller') {
      if (this.mode !== 'brush') this.mode = 'brush';
      this.size = Math.max(1, Math.min(9, this.size + (action === 'tool.brushBigger' ? 1 : -1)));
      this.flashText(`Brush ${this.size}×${this.size}`, 'info');
      this.sfx('hover', 0.5);
      this.previewKey = '';
      this.redraw();
      return true;
    }
    if (action === 'tool.rotate') {
      if (this.stroke) return true;
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
      this.flashText(MODE_NAME[this.mode], 'info');
      this.sfx('hover', 0.5);
      this.previewKey = '';
      this.redraw();
      return true;
    }
    return false;
  }

  override update(dt: number): void {
    this.tiles.tick(this.time);
    this.boxes.tick(this.time);
    super.update(dt);
  }

  // ── preview ───────────────────────────────────────────────────────────
  private redraw(): void {
    const w = this.world;
    const c = this.hoverCell;
    if (!w || !c) {
      this.tiles.clear();
      this.boxes.clear();
      this.setLabel(null);
      return;
    }
    const s = this.stroke;
    const erase = s ? s.erase : this.zone === ZoneType.None;
    const mode = s ? s.mode : this.mode;
    const key = `${c.x},${c.y}|${mode}|${erase}|${this.size}|${s ? `${s.start.x},${s.start.y}` : '-'}|${this.last?.point ? Math.round(this.last.point.x / 8) + ',' + Math.round(this.last.point.z / 8) : ''}`;
    let cells: Cell[];
    if (mode === 'rect' && s) {
      const r = this.rectOf(s.start, c);
      cells = [];
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) cells.push({ x, y });
    } else if (mode === 'fill' && !s) {
      const fk = `${c.x},${c.y}|${this.zone}|${w.zone[w.idx(c.x, c.y)]}`;
      if (!this.fillCache || this.fillCache.key !== fk) this.fillCache = { key: fk, cells: this.game.actions.fillRegion(c, this.zone) };
      cells = this.fillCache.cells.length ? this.fillCache.cells : [c];
    } else cells = this.brushAt(c, this.last);

    const zone = erase ? ZoneType.None : this.zone;
    let ok = 0, blocked = 0;
    let firstReason: string | null = null;
    if (key !== this.previewKey || mode !== 'brush' || s) {
      this.previewKey = key;
      const t = this.tiles;
      t.begin();
      const doomed = new Set<number>();
      const col = this.color(erase);
      for (const q of cells) {
        if (!w.inBounds(q.x, q.y)) continue;
        const i = w.idx(q.x, q.y);
        const cur = w.zone[i];
        const bid = w.bldg[i];
        if (bid && cur !== zone && (erase ? cur !== 0 : true)) {
          const b = w.buildings.get(bid);
          if (b && b.kind === 'zoned' && b.zone !== zone && (erase || this.game.actions.isZoneable(q.x, q.y, zone))) doomed.add(bid);
        }
        if (erase) {
          if (cur) {
            t.add(w, q.x, q.y, col, 0.62);
            ok++;
          } else t.add(w, q.x, q.y, TONE.existing, 0.12);
          continue;
        }
        if (cur === zone) {
          t.add(w, q.x, q.y, col, 0.3);
          continue;
        }
        if (w.road[i] && w.road[i] !== RoadType.None) continue;
        const why = this.game.actions.zoneBlockReason(q.x, q.y, zone);
        if (why) {
          blocked++;
          if (!firstReason) firstReason = why;
          t.add(w, q.x, q.y, TONE.bad, 0.3);
        } else {
          ok++;
          t.add(w, q.x, q.y, col, 0.62);
        }
      }
      t.end();
      const bx = this.boxes;
      bx.begin();
      for (const id of doomed) {
        const b = w.buildings.get(id)!;
        const bb = buildingBox(this.game, w, b);
        bx.add(b.x, b.y, b.w, b.h, bb.ground, bb.height, TONE.demolish);
      }
      bx.end();
      this.doomed = doomed.size;
      this.updateLabel(mode, erase, ok, blocked, firstReason, cells.length);
    }
  }

  private updateLabel(mode: ZoneMode, erase: boolean, ok: number, blocked: number, reason: string | null, total: number): void {
    const s = this.stroke;
    const name = erase ? 'Dezone' : this.zoneName;
    const modeTxt = mode === 'brush' ? `${this.size}×${this.size}` : MODE_NAME[mode];
    if (s && s.mode === 'brush') {
      this.setLabel({ title: `${name} · ${modeTxt}`, value: `${s.changed} cells`, valueTone: 'dim', tone: erase ? 'warn' : 'ok' });
      return;
    }
    const title = s && mode === 'rect' ? `${name} · ${total} cells` : `${name} · ${modeTxt}`;
    const value = ok ? `+${ok}` : undefined;
    this.setLabel({
      title,
      value: erase ? (ok ? `−${ok}` : undefined) : value,
      valueTone: erase ? 'bad' : 'dim',
      tone: ok ? (erase ? 'warn' : 'ok') : 'bad',
      sub: !ok && reason ? reason : this.doomed ? `Demolishes ${this.doomed} building${this.doomed > 1 ? 's' : ''}` : blocked && reason ? `${blocked} blocked: ${reason}` : undefined,
      subTone: !ok ? 'bad' : 'warn',
      keys: s ? undefined : [[`${this.key('tool.brushSmaller')} ${this.key('tool.brushBigger')}`, 'size'], [this.key('tool.rotate') || 'R', 'mode'], ['RMB', 'erase']],
    });
  }

  hint(): string {
    const modeTxt = this.mode === 'brush' ? `Brush ${this.size}×${this.size}` : MODE_NAME[this.mode];
    const zd = this.zone !== ZoneType.None ? zoneDef(this.zone) : undefined;
    const need = zd?.resource ? ` · needs ${zd.resource}` : '';
    const small = this.key('tool.brushSmaller'), big = this.key('tool.brushBigger'), rot = this.key('tool.rotate');
    const status = this.stroke?.lastFail && !this.stroke.changed ? ` · ${this.stroke.lastFail}` : '';
    return `${this.zoneName} · ${modeTxt}${need}${status} · ${small} ${big} size · ${rot} brush/rect/fill · Right-drag erase`;
  }
}
