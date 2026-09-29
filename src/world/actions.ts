// STUB — owned by the "tools" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import {
  Dir, RoadType, ZoneType,
  type ActionResult, type Cell, type District, type PlacementCheck, type Rect,
} from '../core/types';

export type TerraformMode = 'raise' | 'lower' | 'flatten' | 'smooth' | 'level';
export type DestroyCause = 'fire' | 'disaster' | 'abandoned' | 'collapse' | 'flood';

export interface RoadCheck {
  ok: boolean;
  cost: number;
  reason?: string;
  /** cells that cannot be built (shown red) */
  invalid: Cell[];
  /** cells that will become bridges */
  bridges: Cell[];
}

export class WorldActions {
  constructor(protected game: Game) {}

  // ── history ──
  undo(): boolean { return false; }
  redo(): boolean { return false; }
  canUndo(): boolean { return false; }
  canRedo(): boolean { return false; }
  clearHistory(): void {}

  // ── roads ──
  /** Plan a path between two cells. 'straight' = one axis-aligned or diagonal-staircase line,
   *  'lshape' = two segments, 'auto' = A* avoiding obstacles/steep slopes. */
  planRoad(from: Cell, to: Cell, _type: RoadType, _mode: 'straight' | 'lshape' | 'auto' = 'lshape'): Cell[] { return [from, to]; }
  checkRoad(_path: Cell[], _type: RoadType): RoadCheck { return { ok: false, cost: 0, invalid: [], bridges: [] }; }
  placeRoad(_path: Cell[], _type: RoadType): ActionResult { return { ok: false, cost: 0, reason: 'not implemented' }; }
  /** replace road type along existing cells (pays difference) */
  upgradeRoad(_cells: Cell[], _type: RoadType): ActionResult { return { ok: false, cost: 0 }; }

  // ── zoning ──
  isZoneable(_x: number, _y: number): boolean { return false; }
  zoneCells(_cells: Cell[], _zone: ZoneType): ActionResult { return { ok: false, cost: 0 }; }
  zoneRect(_r: Rect, _zone: ZoneType): ActionResult { return { ok: false, cost: 0 }; }
  /** flood-fill contiguous zoneable cells from start (bounded) */
  zoneFill(_start: Cell, _zone: ZoneType, _maxCells = 4000): ActionResult { return { ok: false, cost: 0 }; }

  // ── buildings ──
  /** Validate placement of a catalog building with its footprint centered near (x,y). */
  checkBuilding(_defId: string, x: number, y: number, rot: Dir): PlacementCheck { return { ok: false, cost: 0, x, y, w: 1, h: 1, rot }; }
  placeBuilding(_defId: string, _x: number, _y: number, _rot: Dir): ActionResult { return { ok: false, cost: 0 }; }
  moveBuilding(_id: number, _x: number, _y: number, _rot: Dir): ActionResult { return { ok: false, cost: 0 }; }
  bulldozeBuilding(_id: number): ActionResult { return { ok: false, cost: 0 }; }
  /** Disaster/fire/abandonment destruction: no refund, no undo; leaves rubble (BFlag.Collapsed). */
  destroyBuilding(_id: number, _cause: DestroyCause): void {}
  bulldozeRect(_r: Rect, _what: { roads?: boolean; buildings?: boolean; zones?: boolean; trees?: boolean }): ActionResult { return { ok: false, cost: 0 }; }
  /** refund amount for bulldozing a building now */
  refundFor(_id: number): number { return 0; }

  // ── terrain, trees ──
  /** wx, wz in world meters; radius meters; strength m per application */
  terraform(_wx: number, _wz: number, _radius: number, _mode: TerraformMode, _strength: number, _target?: number): ActionResult { return { ok: false, cost: 0 }; }
  plantTrees(_x: number, _y: number, _radiusCells: number, _density: number): ActionResult { return { ok: false, cost: 0 }; }

  // ── districts ──
  createDistrict(_name?: string): District { throw new Error('not implemented'); }
  deleteDistrict(_id: number): void {}
  paintDistrict(_cells: Cell[], _id: number): void {}
}
