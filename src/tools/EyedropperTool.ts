// Eyedropper: click something in the city to select the tool that builds it.
// service building → place tool, zoned building / zoned cell → zone tool,
// road → road tool.
import { RoadType, ZoneType, type Cell } from '../core/types';
import { buildingDef } from '../data/buildings';
import { roadDef } from '../data/roads';
import { zoneDef } from '../data/zones';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { BaseTool } from './BaseTool';
import type { ToolPointerEvent } from './Tool';
import { TileLayer, TONE } from './preview';

export interface PickTarget {
  tool: 'place' | 'zone' | 'road';
  opts: Record<string, unknown>;
  name: string;
  buildingId?: number;
}

/** what the eyedropper would pick at a cell (null = nothing useful) */
export function eyedropTarget(w: World, c: Cell | null): PickTarget | null {
  if (!c || !w.inBounds(c.x, c.y)) return null;
  const b = w.buildingAt(c.x, c.y);
  if (b) {
    if (b.kind === 'service') {
      const def = buildingDef(b.defId);
      if (def) return { tool: 'place', opts: { defId: def.id }, name: def.name, buildingId: b.id };
    } else if (b.zone) {
      const zd = zoneDef(b.zone);
      if (zd) return { tool: 'zone', opts: { zone: zd.type, zoneId: zd.id }, name: zd.name, buildingId: b.id };
    }
  }
  const r = w.roadAt(c.x, c.y);
  if (r !== RoadType.None) return { tool: 'road', opts: { type: r }, name: roadDef(r).name };
  const z = w.zoneAt(c.x, c.y);
  if (z !== ZoneType.None) {
    const zd = zoneDef(z);
    if (zd) return { tool: 'zone', opts: { zone: zd.type, zoneId: zd.id }, name: zd.name };
  }
  return null;
}

export class EyedropperTool extends BaseTool {
  readonly id = 'eyedropper';
  private tiles = new TileLayer({ lift: 0.45 });
  private highlighted: number | null = null;
  private pressed = false;

  constructor(game: Game) {
    super(game);
    this.root.add(this.tiles.mesh);
  }

  protected onActivate(): void {
    this.pressed = false;
  }

  protected onDeactivate(): void {
    this.setHighlight(null);
    this.tiles.clear();
  }

  private setHighlight(id: number | null): void {
    if (id === this.highlighted) return;
    this.highlighted = id;
    try {
      this.game.buildings.highlight(id, TONE.select);
    } catch {
      /* renderer unavailable */
    }
  }

  override onPointerLeave(): void {
    super.onPointerLeave();
    this.setHighlight(null);
    this.tiles.clear();
  }

  onPointerDown(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button === 0) this.pressed = true;
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e;
    const w = this.world;
    if (!w) return;
    const t = eyedropTarget(w, e.cell);
    this.setHighlight(t?.buildingId ?? null);
    const tl = this.tiles;
    tl.begin();
    if (t && e.cell && !t.buildingId) tl.add(w, e.cell.x, e.cell.y, TONE.select, 0.55);
    tl.end();
    this.setLabel(t
      ? { title: `Pick ${t.name}`, tone: 'info', sub: t.tool === 'place' ? 'Build another one' : t.tool === 'zone' ? 'Zone with this type' : 'Build this road type', subTone: 'dim' }
      : { title: 'Eyedropper', tone: 'dim', sub: 'Click a building, road or zone', subTone: 'dim' });
  }

  onPointerUp(e: ToolPointerEvent): void {
    this.last = e;
    if (e.button !== 0 || !this.pressed) return;
    this.pressed = false;
    const w = this.world;
    const t = w ? eyedropTarget(w, e.cell) : null;
    if (!t) {
      this.reject('Nothing to pick here');
      return;
    }
    this.game.tools.setTool(t.tool, t.opts, false);
  }

  override update(dt: number): void {
    this.tiles.tick(this.time);
    super.update(dt);
  }

  hint(): string {
    return 'Eyedropper · Click a building, road or zone to build more of it';
  }
}
