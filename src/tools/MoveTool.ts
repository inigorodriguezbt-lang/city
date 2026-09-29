// Move tool: pick up a service building and drop it elsewhere for free (same
// placement rules). { id } starts with that building already picked up.
import { Dir, type Building, type BuildingDef } from '../core/types';
import { buildingDef } from '../data/buildings';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import type { BuildingCheck } from '../world/actions';
import { isRubble } from '../world/history';
import { BaseTool } from './BaseTool';
import { BuildingGhost, smartPlacement, type Placement } from './ghost';
import type { ToolPointerEvent } from './Tool';
import { TileLayer, TONE } from './preview';

export interface MoveToolOpts {
  id?: number;
}

export class MoveTool extends BaseTool {
  readonly id = 'move';
  private fixedId: number | null = null;
  private moving: { id: number; def: BuildingDef; name: string } | null = null;
  private rot: Dir = Dir.S;
  private auto = true;
  private ghost: BuildingGhost;
  private placement: Placement | null = null;
  private check: BuildingCheck | null = null;
  private tiles = new TileLayer({ lift: 0.45 });
  private highlighted: number | null = null;
  private pressed = false;

  constructor(game: Game) {
    super(game);
    this.ghost = new BuildingGhost(game);
    this.root.add(this.ghost.root, this.tiles.mesh);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as MoveToolOpts;
    this.fixedId = typeof o.id === 'number' ? o.id : null;
    this.moving = null;
    this.pressed = false;
    this.ghost.hide();
    if (this.fixedId !== null) {
      const b = this.world?.getBuilding(this.fixedId);
      if (b) this.pickUp(b);
    }
  }

  protected onDeactivate(): void {
    this.setHighlight(null, 0);
    this.ghost.dispose();
    this.ghost = new BuildingGhost(this.game);
    this.root.add(this.ghost.root);
    this.ghost.hide();
    this.tiles.clear();
    this.moving = null;
  }

  private setHighlight(id: number | null, color: number): void {
    if (id === this.highlighted) return;
    this.highlighted = id;
    try {
      this.game.buildings.highlight(id, color);
    } catch {
      /* renderer unavailable */
    }
  }

  private movable(b: Building): string | null {
    if (b.kind !== 'service') return 'Only service buildings can be moved';
    if (isRubble(b)) return 'Rubble cannot be moved — bulldoze it';
    return null;
  }

  private pickUp(b: Building): void {
    const def = buildingDef(b.defId);
    if (!def || this.movable(b)) return;
    this.moving = { id: b.id, def, name: this.game.actions.buildingName(b) };
    this.rot = b.rot;
    this.auto = false;
    this.setHighlight(b.id, TONE.warn);
    this.sfx('click', 0.7);
    this.evaluate(this.last);
  }

  /** right-click / Esc while carrying drops back to picking */
  override cancelDrag(): boolean {
    this.pressed = false;
    if (!this.moving || this.fixedId !== null) return false;
    this.moving = null;
    this.ghost.hide();
    this.setHighlight(null, 0);
    this.evaluate(this.last);
    return true;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    this.ghost.hide();
    this.tiles.clear();
    if (!this.moving) this.setHighlight(null, 0);
  }

  private evaluate(e: ToolPointerEvent | null): void {
    const w = this.world;
    if (!w || !e) return;
    const m = this.moving;
    if (!m) {
      // picking: hover highlight
      const b = e.cell ? w.buildingAt(e.cell.x, e.cell.y) : undefined;
      const why = b ? this.movable(b) : null;
      this.setHighlight(b ? b.id : null, why ? TONE.bad : TONE.select);
      const t = this.tiles;
      t.begin();
      if (b) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) t.add(w, x, y, why ? TONE.bad : TONE.select, 0.4);
      t.end();
      this.setLabel(b
        ? { title: why ? this.game.actions.buildingName(b) : `Move ${this.game.actions.buildingName(b)}`, tone: why ? 'bad' : 'info', sub: why ?? 'Click to pick up · moving is free', subTone: why ? 'bad' : 'dim' }
        : { title: 'Move building', tone: 'dim', sub: 'Click a service building to pick it up', subTone: 'dim' });
      return;
    }
    this.tiles.clear();
    if (!e.point) {
      this.ghost.hide();
      return;
    }
    const p = smartPlacement(w, m.def, e.point.x, e.point.z, this.rot, this.auto);
    this.placement = p;
    if (this.auto) this.rot = p.rot;
    this.check = this.game.actions.checkBuilding(m.def.id, p.x, p.y, p.rot, { ignoreId: m.id, free: true });
    this.ghost.update(w, m.def, this.check, this.time);
    const c = this.check;
    this.setLabel({
      title: `Move ${m.name}`,
      value: 'Free',
      valueTone: 'dim',
      tone: c.ok ? 'ok' : 'bad',
      sub: c.ok ? (c.replaces.length ? `Replaces ${c.replaces.length} building${c.replaces.length > 1 ? 's' : ''}` : undefined) : c.reason,
      subTone: c.ok ? 'warn' : 'bad',
      keys: [[this.key('tool.rotate') || 'R', 'rotate'], ['RMB', 'cancel']],
    });
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button === 0) this.pressed = true;
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    this.evaluate(e);
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button !== 0 || !this.pressed) return;
    this.pressed = false;
    const w = this.world;
    if (!w) return;
    const m = this.moving;
    if (!m) {
      const b = e.cell ? w.buildingAt(e.cell.x, e.cell.y) : undefined;
      if (!b) return;
      const why = this.movable(b);
      if (why) {
        this.reject(why);
        return;
      }
      this.pickUp(b);
      return;
    }
    const p = this.placement;
    if (!p) return;
    const res = this.game.actions.moveBuilding(m.id, p.x, p.y, p.rot);
    if (!res.ok) {
      this.reject(res.reason);
      return;
    }
    this.sfx('place');
    this.flashText('Moved', 'info');
    this.moving = null;
    this.ghost.hide();
    this.setHighlight(null, 0);
    if (this.fixedId !== null) {
      this.game.tools.setTool(null);
      return;
    }
    this.evaluate(e);
  }

  onAction(action: ActionId): boolean {
    if (action !== 'tool.rotate' || !this.moving) return false;
    this.auto = false;
    this.rot = ((this.rot + 1) % 4) as Dir;
    this.sfx('hover', 0.6);
    this.evaluate(this.last);
    return true;
  }

  override update(dt: number): void {
    const w = this.world;
    const m = this.moving;
    if (m && w && !w.buildings.has(m.id)) {
      // destroyed while carried (disaster): drop it
      this.moving = null;
      this.ghost.hide();
      this.highlighted = null;
    } else if (m && w && this.check && this.ghost.root.visible) this.ghost.update(w, m.def, this.check, this.time);
    this.tiles.tick(this.time);
    super.update(dt);
  }

  hint(): string {
    const m = this.moving;
    if (m) {
      const why = this.check && !this.check.ok ? ` · ${this.check.reason}` : '';
      return `Moving ${m.name} · free${why} · ${this.key('tool.rotate') || 'R'} rotate · Right-click cancel`;
    }
    return 'Move building · Click a service building to pick it up · moving is free';
  }
}
