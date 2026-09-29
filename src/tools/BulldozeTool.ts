// Bulldozer: hover highlights the target in red, click removes a building /
// road / rubble, drag a rectangle to clear an area. Filters while dragging:
// Shift = roads only, Ctrl = buildings only, Alt = zones only.
import { RoadType, type Building, type Cell, type Rect } from '../core/types';
import { formatMoney } from '../core/util';
import { roadDef } from '../data/roads';
import { zoneDef } from '../data/zones';
import type { Game } from '../game/Game';
import { isRubble } from '../world/history';
import type { BulldozeFilter, BulldozePreview } from '../world/actions';
import type { World } from '../world/World';
import { BaseTool } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { BoxLayer, buildingBox, TileLayer, TONE, type LabelContent } from './preview';
import { buildingDef } from '../data/buildings';

/** confirm destruction worth more than this (settings.gameplay.confirmBulldoze) */
const CONFIRM_VALUE = 5000;
const MAX_RECT = 128;

type Target = { kind: 'building'; b: Building } | { kind: 'road'; c: Cell; type: RoadType } | null;

export class BulldozeTool extends BaseTool {
  readonly id = 'bulldoze';
  private tiles = new TileLayer({ lift: 0.5 });
  private boxes = new BoxLayer();
  private hoverCell: Cell | null = null;
  private highlighted: number | null = null;
  private dragStart: Cell | null = null;
  private dragging = false;
  private preview: BulldozePreview | null = null;
  private busy = false;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh, this.boxes.mesh);
  }

  protected onActivate(): void {
    this.dragStart = null;
    this.dragging = false;
    this.preview = null;
  }

  protected onDeactivate(): void {
    this.setHighlight(null);
    this.tiles.clear();
    this.boxes.clear();
    this.hoverCell = null;
  }

  private setHighlight(id: number | null): void {
    if (id === this.highlighted) return;
    this.highlighted = id;
    try {
      this.game.buildings.highlight(id, TONE.demolish);
    } catch {
      /* renderer unavailable */
    }
  }

  override cancelDrag(): boolean {
    if (!this.dragStart) return false;
    this.dragStart = null;
    this.dragging = false;
    this.preview = null;
    this.redraw();
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    if (!this.dragStart) {
      this.hoverCell = null;
        this.setHighlight(null);
      this.tiles.clear();
      this.boxes.clear();
    }
  }

  private filter(e: ToolPointerEvent | null): BulldozeFilter {
    if (e?.shift) return { roads: true };
    if (e?.ctrl) return { buildings: true };
    if (e?.alt) return { zones: true };
    return { roads: true, buildings: true };
  }

  private rect(a: Cell, b: Cell): Rect {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return { x0: Math.max(x0, x1 - MAX_RECT + 1), y0: Math.max(y0, y1 - MAX_RECT + 1), x1, y1 };
  }

  private targetAt(w: World, c: Cell | null): Target {
    if (!c) return null;
    const b = w.buildingAt(c.x, c.y);
    if (b) return { kind: 'building', b };
    const t = w.roadAt(c.x, c.y);
    if (t) return { kind: 'road', c, type: t };
    return null;
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    if (this.busy || !e.cell || e.button !== 0) return;
    this.dragStart = e.cell;
    this.hoverCell = e.cell;
    this.dragging = false;
    this.redraw();
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    if (e.cell) this.hoverCell = e.cell;
    if (this.dragStart && e.cell && (e.cell.x !== this.dragStart.x || e.cell.y !== this.dragStart.y)) this.dragging = true;
    this.redraw();
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    const start = this.dragStart;
    if (!start || e.button !== 0) return;
    const end = e.cell ?? this.hoverCell ?? start;
    const dragging = this.dragging;
    this.dragStart = null;
    this.dragging = false;
    const w = this.world;
    if (!w || this.busy) return;
    if (dragging) void this.bulldozeArea(this.rect(start, end), this.filter(e));
    else void this.bulldozeSingle(w, this.targetAt(w, end));
    this.preview = null;
    this.redraw();
  }

  private async confirmIfCostly(valueLost: number, what: string): Promise<boolean> {
    const s = this.game.settings.value.gameplay;
    if (!s.confirmBulldoze || valueLost <= CONFIRM_VALUE || this.world?.creative) return true;
    this.busy = true;
    this.label.hide();
    try {
      return await this.game.ui.confirm('Demolish?', `${what} — about ${formatMoney(valueLost)} of value will be lost. This can be undone with ${this.key('edit.undo') || 'Ctrl+Z'}.`);
    } catch {
      return true;
    } finally {
      this.busy = false;
    }
  }

  private async bulldozeSingle(w: World, t: Target): Promise<void> {
    if (!t) {
      this.reject('Nothing to bulldoze here');
      return;
    }
    const acts = this.game.actions;
    if (t.kind === 'building') {
      const b = t.b;
      const p = acts.previewBulldoze({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, { buildings: true });
      if (!(await this.confirmIfCostly(p.valueLost, acts.buildingName(b)))) return;
      if (!w.buildings.has(b.id)) return;
      const res = acts.bulldozeBuilding(b.id);
      this.feedback(res.ok, res.cost, res.reason);
      if (res.ok && this.highlighted === b.id) this.setHighlight(null);
      return;
    }
    const res = acts.bulldozeRect({ x0: t.c.x, y0: t.c.y, x1: t.c.x, y1: t.c.y }, { roads: true });
    this.feedback(res.ok, res.cost, res.reason);
  }

  private async bulldozeArea(r: Rect, f: BulldozeFilter): Promise<void> {
    const acts = this.game.actions;
    const p = acts.previewBulldoze(r, f);
    const n = p.buildings.length;
    const what = [n ? `${n} building${n > 1 ? 's' : ''}` : '', p.roads.length ? `${p.roads.length} road cells` : ''].filter(Boolean).join(' and ') || 'This area';
    if (!(await this.confirmIfCostly(p.valueLost, what))) return;
    const res = acts.bulldozeRect(r, f);
    this.feedback(res.ok, res.cost, res.reason);
  }

  private feedback(ok: boolean, cost: number, reason?: string): void {
    if (!ok) {
      this.reject(reason);
      return;
    }
    this.sfx('bulldoze');
    this.flashCost(cost);
    this.redraw();
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
    const t = this.tiles;
    const bx = this.boxes;
    if (!w || !c || this.busy) {
      t.clear();
      bx.clear();
      this.setHighlight(null);
      this.setLabel(null);
      return;
    }
    t.begin();
    bx.begin();
    const box = (b: Building, color: number) => {
      const bb = buildingBox(this.game, w, b, buildingDef(b.defId)?.height);
      bx.add(b.x, b.y, b.w, b.h, bb.ground, bb.height, color);
    };
    if (this.dragStart && this.dragging) {
      this.setHighlight(null);
      const r = this.rect(this.dragStart, c);
      const f = this.filter(this.last);
      const p = (this.preview = this.game.actions.previewBulldoze(r, f));
      const hit = new Set<number>();
      for (const id of p.buildings) {
        const b = w.buildings.get(id);
        if (!b) continue;
        box(b, TONE.demolish);
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) hit.add(y * 65536 + x);
      }
      for (const q of p.roads) hit.add(q.y * 65536 + q.x);
      const zoneHit = new Set(p.zones.map((q) => q.y * 65536 + q.x));
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const k = y * 65536 + x;
          if (hit.has(k)) t.add(w, x, y, TONE.demolish, 0.72, { lift: 0.15 });
          else if (zoneHit.has(k)) t.add(w, x, y, TONE.erase, 0.55);
          else t.add(w, x, y, TONE.demolish, 0.1);
        }
      // building footprints outside the rect but hit (partially covered)
      for (const k of hit) {
        const x = k % 65536, y = Math.floor(k / 65536);
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) t.add(w, x, y, TONE.demolish, 0.6, { lift: 0.15 });
      }
      t.end();
      bx.end();
      this.setLabel(this.areaLabel(p, f));
      return;
    }
    const tg = this.targetAt(w, c);
    if (!tg) {
      this.setHighlight(null);
      t.add(w, c.x, c.y, TONE.demolish, 0.18);
      t.end();
      bx.end();
      this.setLabel({ title: 'Bulldoze', tone: 'dim', sub: 'Click a building or road · drag an area', subTone: 'dim', keys: [['Shift', 'roads'], ['Ctrl', 'buildings'], ['Alt', 'zones']] });
      return;
    }
    if (tg.kind === 'building') {
      const b = tg.b;
      this.setHighlight(b.id);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) t.add(w, x, y, TONE.demolish, 0.55, { lift: 0.15 });
      box(b, TONE.demolish);
      t.end();
      bx.end();
      const rf = this.game.actions.refundFor(b.id);
      const rubble = isRubble(b);
      const creative = w.creative;
      const zd = b.kind === 'zoned' ? zoneDef(b.zone) : undefined;
      const name = b.name ?? (zd ? zd.name : this.game.actions.buildingName(b));
      const who = b.residents ? `${b.residents} residents` : b.workers ? `${b.workers} workers` : '';
      this.setLabel({
        title: rubble ? `Rubble · ${name}` : name,
        value: creative ? undefined : rf > 0 ? `+${formatMoney(rf)}` : rf < 0 ? formatMoney(-rf) : 'No refund',
        valueTone: rf > 0 ? 'refund' : rf < 0 ? 'money' : 'dim',
        tone: 'bad',
        sub: rubble ? 'Click to clear the rubble' : ['Click to demolish', who, b.kind === 'zoned' ? 'zoning stays' : ''].filter(Boolean).join(' · '),
        subTone: b.kind === 'zoned' && who ? 'warn' : 'dim',
      });
      return;
    }
    this.setHighlight(null);
    t.add(w, tg.c.x, tg.c.y, TONE.demolish, 0.65, { lift: 0.15 });
    t.end();
    bx.end();
    this.setLabel({ title: `Remove ${roadDef(tg.type).name}${w.isBridge(tg.c.x, tg.c.y) ? ' bridge' : ''}`, tone: 'bad', value: 'No refund', valueTone: 'dim' });
  }

  private areaLabel(p: BulldozePreview, f: BulldozeFilter): LabelContent {
    const parts: string[] = [];
    if (p.buildings.length) parts.push(`${p.buildings.length} building${p.buildings.length > 1 ? 's' : ''}`);
    if (p.roads.length) parts.push(`${p.roads.length} road${p.roads.length > 1 ? 's' : ''}`);
    if (f.zones && p.zones.length) parts.push(`${p.zones.length} zoned cells`);
    const filterName = f.zones ? 'Zones only' : f.roads && !f.buildings ? 'Roads only' : f.buildings && !f.roads ? 'Buildings only' : 'Roads & buildings';
    const net = p.refund - p.clearing;
    const creative = this.world?.creative;
    return {
      title: parts.join(' · ') || 'Nothing selected',
      value: creative || (!p.refund && !p.clearing) ? undefined : net >= 0 ? `+${formatMoney(net)}` : formatMoney(-net),
      valueTone: net >= 0 ? 'refund' : 'money',
      tone: parts.length ? 'bad' : 'dim',
      sub: filterName + (p.valueLost > CONFIRM_VALUE && !creative ? ` · ${formatMoney(p.valueLost, true)} value` : ''),
      subTone: 'dim',
    };
  }

  hint(): string {
    if (this.dragStart && this.dragging && this.preview) {
      const p = this.preview;
      return `Bulldoze area · ${p.buildings.length} buildings · ${p.roads.length} roads · refund ${formatMoney(p.refund)} · Shift roads · Ctrl buildings · Alt zones`;
    }
    return 'Bulldoze · Click to demolish · Drag an area · Shift roads only · Ctrl buildings only · Alt zones only';
  }
}
