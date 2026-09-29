// Place tool: ghost of a catalog building following the cursor, snapped to the
// footprint grid, auto-rotating (and snapping) toward the nearest road until the
// player rotates manually. Stays active for repeated placement; Shift+click
// places and exits.
import { Dir, type BuildingDef } from '../core/types';
import { formatMoney } from '../core/util';
import { buildingDef } from '../data/buildings';
import type { Game } from '../game/Game';
import type { ActionId } from '../settings/types';
import type { BuildingCheck } from '../world/actions';
import { BaseTool } from './BaseTool';
import { BuildingGhost, smartPlacement, type Placement } from './ghost';
import type { ToolPointerEvent } from './Tool';

export interface PlaceToolOpts {
  defId: string;
  /** initial rotation (defaults to auto) */
  rot?: Dir;
}

const DIR_NAME = ['north', 'east', 'south', 'west'];

export class PlaceTool extends BaseTool {
  readonly id = 'place';
  private def: BuildingDef | null = null;
  private rot: Dir = Dir.S;
  private auto = true;
  private ghost: BuildingGhost;
  private placement: Placement | null = null;
  private check: BuildingCheck | null = null;
  private pressed = false;
  private checkKey = '';

  constructor(game: Game) {
    super(game);
    this.ghost = new BuildingGhost(game);
    this.root.add(this.ghost.root);
  }

  protected onActivate(opts?: unknown): void {
    const o = (opts ?? {}) as Partial<PlaceToolOpts>;
    this.def = o.defId ? buildingDef(o.defId) ?? null : null;
    this.auto = o.rot === undefined;
    this.rot = o.rot ?? Dir.S;
    this.placement = null;
    this.check = null;
    this.checkKey = '';
    this.pressed = false;
    this.ghost.hide();
    if (!this.def) this.toast('Unknown building', 'warning');
  }

  protected onDeactivate(): void {
    this.ghost.dispose();
    this.ghost = new BuildingGhost(this.game);
    this.root.add(this.ghost.root);
    this.ghost.hide();
    this.placement = null;
    this.check = null;
  }

  override cancelDrag(): boolean {
    const was = this.pressed;
    this.pressed = false;
    return was;
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    this.ghost.hide();
    this.placement = null;
  }

  private evaluate(e: ToolPointerEvent | null): void {
    const w = this.world;
    const def = this.def;
    if (!w || !def || !e?.point) {
      this.ghost.hide();
      this.setLabel(null);
      this.check = null;
      return;
    }
    const p = smartPlacement(w, def, e.point.x, e.point.z, this.rot, this.auto);
    this.placement = p;
    if (this.auto) this.rot = p.rot;
    const key = `${p.x},${p.y},${p.rot}|${w.buildings.size}|${w.economy.money >= def.cost}`;
    if (key !== this.checkKey || !this.check) {
      this.checkKey = key;
      this.check = this.game.actions.checkBuilding(def.id, p.x, p.y, p.rot);
    }
    this.ghost.update(w, def, this.check, this.time);
    this.updateLabel(def, this.check);
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button !== 0) return;
    this.pressed = true;
    this.evaluate(e);
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    this.evaluate(e);
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button !== 0 || !this.pressed) return;
    this.pressed = false;
    const def = this.def;
    const p = this.placement;
    if (!def || !p) return;
    const res = this.game.actions.placeBuilding(def.id, p.x, p.y, p.rot);
    if (!res.ok) {
      this.reject(res.reason);
      return;
    }
    this.sfx('place');
    this.flashCost(res.cost);
    this.checkKey = '';
    if (e.shift) {
      this.game.tools.setTool(null);
      return;
    }
    this.evaluate(e);
  }

  onAction(action: ActionId): boolean {
    if (action !== 'tool.rotate') return false;
    this.auto = false;
    this.rot = ((this.rot + 1) % 4) as Dir;
    this.sfx('hover', 0.6);
    this.checkKey = '';
    this.evaluate(this.last);
    return true;
  }

  override update(dt: number): void {
    // keep the ghost bobbing and the rings animated
    const w = this.world;
    if (w && this.def && this.check && this.placement && this.ghost.root.visible) this.ghost.update(w, this.def, this.check, this.time);
    super.update(dt);
  }

  private updateLabel(def: BuildingDef, c: BuildingCheck): void {
    const w = this.world;
    if (!w) return;
    const creative = w.creative;
    const afford = w.canAfford(def.cost);
    const warn = c.ok && c.replaces.length ? `Replaces ${c.replaces.length} building${c.replaces.length > 1 ? 's' : ''}` : undefined;
    this.setLabel({
      title: def.name,
      value: creative ? 'Free' : formatMoney(def.cost),
      valueTone: creative ? 'dim' : afford ? 'money' : 'bad',
      tone: c.ok ? 'ok' : 'bad',
      sub: !c.ok ? c.reason : warn ?? `Upkeep ${formatMoney(def.upkeep)}/mo · facing ${DIR_NAME[c.rot]}${this.auto ? ' (auto)' : ''}`,
      subTone: !c.ok ? 'bad' : warn ? 'warn' : 'dim',
      keys: [[this.key('tool.rotate') || 'R', 'rotate'], ['Shift+Click', 'place & exit']],
    });
  }

  hint(): string {
    const def = this.def;
    if (!def) return 'Unknown building';
    const w = this.world;
    const cost = w?.creative ? 'Free' : formatMoney(def.cost);
    const parts = [def.name, cost, `upkeep ${formatMoney(def.upkeep)}/mo`];
    if (def.jobs) parts.push(`${def.jobs} jobs`);
    if (this.check && !this.check.ok && this.check.reason) parts.push(this.check.reason);
    parts.push(`${this.key('tool.rotate') || 'R'} rotate${this.auto ? ' (auto)' : ''}`, 'Shift+click place & exit');
    return parts.join(' · ');
  }
}
