// ─────────────────────────────────────────────────────────────────────────────
// World: the single authoritative, serializable game state.
// Owned by the integrator. Systems READ freely and MUTATE only through the
// low-level mutators below (which keep occupancy consistent and batch change
// notifications) or through WorldActions (validation, cost, undo).
// Anything that must persist in saves lives here (use `ext` for module state).
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, START_DAY, WATER_EPS } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import {
  BFlag,
  DIR_BIT,
  DIR_DX,
  DIR_DY,
  FIELD_IDS,
  Layer,
  RoadType,
  ZoneType,
  type ActiveEvent,
  type Building,
  type BudgetCategory,
  type Cell,
  type CityStats,
  type District,
  type Economy,
  type FieldId,
  type GeneratedMap,
  type HistoryPoint,
  type MapSettings,
  type Notice,
  type OutsideConnection,
  type Rect,
  type TaxCategory,
  type TimeState,
  type TransitLine,
  type WeatherState,
} from '../core/types';
import { roadDef } from '../data/roads';
import { themeDef } from '../data/themes';

export const TAX_CATEGORIES: TaxCategory[] = ['resLow', 'resHigh', 'comLow', 'comHigh', 'office', 'industry'];
export const BUDGET_CATEGORIES: BudgetCategory[] = [
  'roads', 'power', 'water', 'garbage', 'health', 'deathcare', 'fire', 'police', 'education', 'parks', 'transit', 'government', 'disaster', 'policies', 'loans',
];

export const START_MONEY: Record<string, number> = { easy: 150_000, normal: 70_000, hard: 45_000, expert: 30_000 };

export function emptyStats(): CityStats {
  return {
    population: 0, households: 0, workforce: 0, jobs: 0, employed: 0, unemployed: 0, students: 0, tourists: 0,
    happiness: 50, health: 50, education: 0, crimeRate: 0, landValue: 0, pollution: 0,
    demand: { res: 0.6, com: 0.2, ind: 0.4, off: 0 },
    power: { produced: 0, consumed: 0 },
    water: { produced: 0, consumed: 0 },
    sewage: { capacity: 0, produced: 0 },
    garbage: { capacity: 0, produced: 0, stored: 0 },
    health_: { capacity: 0, sick: 0 },
    education_: { capacity: 0, students: 0 },
    deathcare: { capacity: 0, dead: 0 },
    trafficFlow: 100, vehicles: 0, buildings: 0, netIncome: 0,
    births: 0, deaths: 0, movedIn: 0, movedOut: 0,
  };
}

export class World {
  readonly size: number;
  settings: MapSettings;

  // ── terrain ────────────────────────────────────────────────────────────
  /** (size+1)^2 vertex heights (m) */
  heights: Float32Array;
  /** size^2 water surface elevation per cell (wet if > cellHeight + WATER_EPS) */
  water: Float32Array;
  /** nominal sea level (m); flood events may temporarily add `floodOffset` to sea cells */
  seaLevel: number;
  floodOffset = 0;

  // ── per-cell layers ────────────────────────────────────────────────────
  road: Uint8Array;
  /** bit0 bridge, bit1 tunnel, bit2 no-lights, bits3-7 reserved */
  roadFlags: Uint8Array;
  zone: Uint8Array;
  /** building id occupying the cell, 0 = none */
  bldg: Int32Array;
  /** tree density 0..3 */
  trees: Uint8Array;
  /** district id 0..255 */
  district: Uint8Array;
  /** scalar fields 0..255 */
  fields: Record<FieldId, Uint8Array>;

  // ── entities ───────────────────────────────────────────────────────────
  buildings = new Map<number, Building>();
  nextBuildingId = 1;
  districts: District[] = [];
  transitLines: TransitLine[] = [];
  connections: OutsideConnection[] = [];
  /** camera home / city hall focus */
  home: Cell;

  // ── simulation state ───────────────────────────────────────────────────
  time: TimeState = { day: START_DAY, hour: 9, speed: 1 };
  weather: WeatherState = { type: 'clear', intensity: 0, temperature: 15, windDir: 0.6, windSpeed: 4, snowCover: 0, nextChange: 6 };
  economy: Economy;
  stats: CityStats = emptyStats();
  history: HistoryPoint[] = [];
  /** highest milestone index reached */
  milestone = 0;
  creative: boolean;
  /** set by /give unlockall etc. */
  unlockAll = false;
  /** extra unlocked building ids (rewards, commands) */
  unlockedIds: string[] = [];
  /** active city-wide policy ids */
  policies: string[] = [];
  achievements: string[] = [];
  notices: Notice[] = [];
  nextNoticeId = 1;
  activeEvents: ActiveEvent[] = [];
  nextEventId = 1;
  /** RNG state for deterministic simulation modules */
  rngState: number;
  /** real seconds played */
  playTime = 0;
  createdAt = Date.now();
  /** module-owned persisted state (JSON-serializable) */
  ext: Record<string, unknown> = {};

  // ── change tracking (not persisted) ────────────────────────────────────
  bus: EventBus<GameEvents> | null = null;
  private dirtyLayers = 0;
  private dirtyRect: Rect = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };

  constructor(settings: MapSettings, size: number) {
    this.settings = settings;
    this.size = size;
    const n = size * size;
    this.heights = new Float32Array((size + 1) * (size + 1));
    this.water = new Float32Array(n).fill(-1e4);
    this.seaLevel = 0;
    this.road = new Uint8Array(n);
    this.roadFlags = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.bldg = new Int32Array(n);
    this.trees = new Uint8Array(n);
    this.district = new Uint8Array(n);
    this.fields = {} as Record<FieldId, Uint8Array>;
    for (const f of FIELD_IDS) this.fields[f] = new Uint8Array(n);
    this.home = { x: size >> 1, y: size >> 1 };
    this.creative = settings.creative;
    this.rngState = settings.seed ^ 0x5bd1e995;
    const taxes = {} as Record<TaxCategory, number>;
    for (const t of TAX_CATEGORIES) taxes[t] = t === 'office' || t === 'industry' ? 0.1 : 0.09;
    const budgets = {} as Record<BudgetCategory, number>;
    for (const b of BUDGET_CATEGORIES) budgets[b] = 1;
    this.economy = {
      money: settings.creative ? 1e12 : START_MONEY[settings.difficulty] ?? 70_000,
      taxes, budgets, loans: [], monthIncome: {}, monthExpense: {}, lastIncome: {}, lastExpense: {},
    };
  }

  /** Initialise terrain & resources from generator output. */
  applyGeneratedMap(m: GeneratedMap): void {
    if (m.size !== this.size) throw new Error('map size mismatch');
    this.heights.set(m.heights);
    this.water.set(m.water);
    this.seaLevel = m.seaLevel;
    this.trees.set(m.trees);
    this.fields.fertility.set(m.fertility);
    this.fields.forest.set(m.forest);
    this.fields.ore.set(m.ore);
    this.fields.oil.set(m.oil);
    this.fields.wind.set(m.wind);
    this.connections = m.connections.slice();
    this.home = { ...m.start };
    this.markDirty({ x0: 0, y0: 0, x1: this.size - 1, y1: this.size - 1 }, Layer.All);
  }

  get theme() {
    return themeDef(this.settings.theme);
  }

  // ── indexing & geometry ────────────────────────────────────────────────
  idx(x: number, y: number): number {
    return y * this.size + x;
  }
  vidx(vx: number, vy: number): number {
    return vy * (this.size + 1) + vx;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  /** world meters → cell */
  worldToCell(wx: number, wz: number): Cell {
    return { x: Math.floor(wx / CELL), y: Math.floor(wz / CELL) };
  }
  /** cell center in world meters (y = terrain height) */
  cellCenter(x: number, y: number): { x: number; y: number; z: number } {
    return { x: (x + 0.5) * CELL, y: this.cellHeight(x, y), z: (y + 0.5) * CELL };
  }
  vertexHeight(vx: number, vy: number): number {
    const s = this.size;
    vx = vx < 0 ? 0 : vx > s ? s : vx;
    vy = vy < 0 ? 0 : vy > s ? s : vy;
    return this.heights[vy * (s + 1) + vx];
  }
  /** average of the 4 corner heights */
  cellHeight(x: number, y: number): number {
    return (this.vertexHeight(x, y) + this.vertexHeight(x + 1, y) + this.vertexHeight(x, y + 1) + this.vertexHeight(x + 1, y + 1)) * 0.25;
  }
  cellMinMax(x: number, y: number): [number, number] {
    const a = this.vertexHeight(x, y), b = this.vertexHeight(x + 1, y), c = this.vertexHeight(x, y + 1), d = this.vertexHeight(x + 1, y + 1);
    return [Math.min(a, b, c, d), Math.max(a, b, c, d)];
  }
  /** (max-min)/CELL across the cell corners */
  cellSlope(x: number, y: number): number {
    const [lo, hi] = this.cellMinMax(x, y);
    return (hi - lo) / CELL;
  }
  /** bilinear terrain height at world meters */
  heightAt(wx: number, wz: number): number {
    const fx = wx / CELL, fz = wz / CELL;
    const x = Math.floor(fx), z = Math.floor(fz);
    const tx = fx - x, tz = fz - z;
    const h00 = this.vertexHeight(x, z), h10 = this.vertexHeight(x + 1, z);
    const h01 = this.vertexHeight(x, z + 1), h11 = this.vertexHeight(x + 1, z + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  /** water surface at cell (or -1e4 if dry) */
  waterLevel(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1e4;
    const w = this.water[this.idx(x, y)];
    return w > this.seaLevel - 0.01 && w < this.seaLevel + 0.01 ? w + this.floodOffset : w;
  }
  waterDepth(x: number, y: number): number {
    return Math.max(0, this.waterLevel(x, y) - this.cellHeight(x, y));
  }
  isWater(x: number, y: number): boolean {
    return this.waterDepth(x, y) > WATER_EPS;
  }
  /** true if any 4-neighbour is water and this cell is land */
  isShore(x: number, y: number): boolean {
    if (this.isWater(x, y)) return false;
    for (let d = 0; d < 4; d++) if (this.isWater(x + DIR_DX[d], y + DIR_DY[d])) return true;
    return false;
  }

  // ── roads ──────────────────────────────────────────────────────────────
  roadAt(x: number, y: number): RoadType {
    return this.inBounds(x, y) ? (this.road[this.idx(x, y)] as RoadType) : RoadType.None;
  }
  /** 4-neighbour connection mask (DIR_BIT) of roads that connect to (x,y).
   *  Rail only connects to rail; car roads & pedestrian connect to each other. */
  roadMask(x: number, y: number): number {
    const t = this.roadAt(x, y);
    if (t === RoadType.None) return 0;
    const rail = t === RoadType.Rail;
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.roadAt(x + DIR_DX[d], y + DIR_DY[d]);
      if (n === RoadType.None) continue;
      if ((n === RoadType.Rail) === rail) m |= DIR_BIT[d];
    }
    return m;
  }
  isBridge(x: number, y: number): boolean {
    return this.inBounds(x, y) && (this.roadFlags[this.idx(x, y)] & 1) !== 0;
  }
  /** Direction from lot toward an adjacent road cell usable for access (or -1). */
  roadAccessDir(x: number, y: number, w: number, h: number, preferred = -1): number {
    const test = (d: number): boolean => {
      // cells along the side of the footprint in direction d
      const cells: Cell[] = [];
      if (d === 0) for (let i = 0; i < w; i++) cells.push({ x: x + i, y: y - 1 });
      if (d === 2) for (let i = 0; i < w; i++) cells.push({ x: x + i, y: y + h });
      if (d === 3) for (let i = 0; i < h; i++) cells.push({ x: x - 1, y: y + i });
      if (d === 1) for (let i = 0; i < h; i++) cells.push({ x: x + w, y: y + i });
      return cells.some((c) => {
        const t = this.roadAt(c.x, c.y);
        return t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Highway;
      });
    };
    if (preferred >= 0 && test(preferred)) return preferred;
    for (let d = 0; d < 4; d++) if (test(d)) return d;
    return -1;
  }

  // ── lookups ────────────────────────────────────────────────────────────
  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.bldg[this.idx(x, y)];
    return id ? this.buildings.get(id) : undefined;
  }
  getBuilding(id: number): Building | undefined {
    return this.buildings.get(id);
  }
  zoneAt(x: number, y: number): ZoneType {
    return this.inBounds(x, y) ? (this.zone[this.idx(x, y)] as ZoneType) : ZoneType.None;
  }
  field(id: FieldId, x: number, y: number): number {
    return this.inBounds(x, y) ? this.fields[id][this.idx(x, y)] : 0;
  }
  /** unlocked by milestone, creative mode or /give unlockall */
  isUnlocked(unlockIndex: number, id?: string): boolean {
    return this.creative || this.unlockAll || this.milestone >= unlockIndex || (id !== undefined && this.unlockedIds.includes(id));
  }
  get population(): number {
    return this.stats.population;
  }

  // ── low-level mutators (consistent occupancy + batched notifications) ─
  setRoad(x: number, y: number, t: RoadType, flags = 0): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.road[i] = t;
    this.roadFlags[i] = t === RoadType.None ? 0 : flags;
    let layers = Layer.Road;
    if (t !== RoadType.None) {
      if (this.zone[i]) { this.zone[i] = 0; layers |= Layer.Zone; }
      if (this.trees[i]) { this.trees[i] = 0; layers |= Layer.Tree; }
    }
    this.markDirty({ x0: x, y0: y, x1: x, y1: y }, layers);
  }

  setZone(x: number, y: number, z: ZoneType): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.road[i] && z !== ZoneType.None) return;
    if (this.zone[i] === z) return;
    this.zone[i] = z;
    this.markDirty({ x0: x, y0: y, x1: x, y1: y }, Layer.Zone);
  }

  setTrees(x: number, y: number, density: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const d = Math.max(0, Math.min(3, density | 0));
    if (this.trees[i] === d) return;
    this.trees[i] = d;
    this.markDirty({ x0: x, y0: y, x1: x, y1: y }, Layer.Tree);
  }

  setDistrict(x: number, y: number, id: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.district[i] === id) return;
    this.district[i] = id;
    this.markDirty({ x0: x, y0: y, x1: x, y1: y }, Layer.District);
  }

  /** set a terrain vertex height; marks the 4 touching cells dirty */
  setVertexHeight(vx: number, vy: number, h: number): void {
    const s = this.size;
    if (vx < 0 || vy < 0 || vx > s || vy > s) return;
    this.heights[vy * (s + 1) + vx] = h;
    this.markDirty({ x0: Math.max(0, vx - 1), y0: Math.max(0, vy - 1), x1: Math.min(s - 1, vx), y1: Math.min(s - 1, vy) }, Layer.Terrain);
  }

  setWater(x: number, y: number, level: number): void {
    if (!this.inBounds(x, y)) return;
    this.water[this.idx(x, y)] = level;
    this.markDirty({ x0: x, y0: y, x1: x, y1: y }, Layer.Water);
  }

  /** Create a building and occupy its footprint. Fills sensible defaults. */
  addBuilding(init: Pick<Building, 'kind' | 'defId' | 'x' | 'y' | 'w' | 'h' | 'rot'> & Partial<Building>): Building {
    const id = this.nextBuildingId++;
    const b: Building = {
      zone: ZoneType.None, level: 1, style: this.settings.style, seed: (Math.random() * 2 ** 31) | 0,
      built: 0, age: 0, flags: 0, problems: 0, distress: 0,
      residents: 0, maxResidents: 0, jobs: 0, workers: 0, visitors: 0, goods: 50,
      happiness: 60, health: 70, education: 0, garbage: 0, fire: 0, efficiency: 1,
      ...init,
      id,
    };
    if (b.built < 1) b.flags |= BFlag.UnderConstruction;
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        if (!this.inBounds(xx, yy)) continue;
        const i = this.idx(xx, yy);
        this.bldg[i] = id;
        this.trees[i] = 0;
        if (b.kind === 'service') this.zone[i] = 0;
      }
    this.buildings.set(id, b);
    this.markDirty({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, Layer.Building | Layer.Tree | Layer.Zone);
    this.bus?.emit('building:added', b);
    return b;
  }

  removeBuilding(id: number): Building | undefined {
    const b = this.buildings.get(id);
    if (!b) return undefined;
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        if (!this.inBounds(xx, yy)) continue;
        const i = this.idx(xx, yy);
        if (this.bldg[i] === id) this.bldg[i] = 0;
      }
    this.buildings.delete(id);
    this.markDirty({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, Layer.Building);
    this.bus?.emit('building:removed', b);
    return b;
  }

  /** notify that a building's visual/state changed (level, flags, fire…) */
  touchBuilding(b: Building): void {
    this.markDirty({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, Layer.Building);
    this.bus?.emit('building:changed', b);
  }

  // ── money ──────────────────────────────────────────────────────────────
  canAfford(amount: number): boolean {
    return this.creative || amount <= 0 || this.economy.money >= amount;
  }
  /** Deduct money (creative: free). Returns false if unaffordable (nothing spent). */
  spend(amount: number, category = 'construction'): boolean {
    if (this.creative) return true;
    if (amount > 0 && this.economy.money < amount) return false;
    this.economy.money -= amount;
    this.economy.monthExpense[category] = (this.economy.monthExpense[category] ?? 0) + amount;
    this.bus?.emit('money:changed', this.economy.money);
    return true;
  }
  /** Force a charge even into debt (upkeep, loans). */
  charge(amount: number, category: string): void {
    if (this.creative) return;
    this.economy.money -= amount;
    this.economy.monthExpense[category] = (this.economy.monthExpense[category] ?? 0) + amount;
    this.bus?.emit('money:changed', this.economy.money);
  }
  earn(amount: number, category: string): void {
    if (this.creative) return;
    this.economy.money += amount;
    this.economy.monthIncome[category] = (this.economy.monthIncome[category] ?? 0) + amount;
    this.bus?.emit('money:changed', this.economy.money);
  }

  // ── notices ────────────────────────────────────────────────────────────
  notify(n: Omit<Notice, 'id' | 'day'>): Notice {
    const notice: Notice = { ...n, id: this.nextNoticeId++, day: this.time.day };
    this.notices.push(notice);
    if (this.notices.length > 250) this.notices.splice(0, this.notices.length - 250);
    this.bus?.emit('notice', notice);
    return notice;
  }

  // ── change batching ────────────────────────────────────────────────────
  markDirty(r: Rect, layers: number): void {
    const d = this.dirtyRect;
    if (r.x0 < d.x0) d.x0 = r.x0;
    if (r.y0 < d.y0) d.y0 = r.y0;
    if (r.x1 > d.x1) d.x1 = r.x1;
    if (r.y1 > d.y1) d.y1 = r.y1;
    this.dirtyLayers |= layers;
  }
  /** Called once per frame by Game: emits a single 'world:changed'. */
  flushChanges(): void {
    if (!this.dirtyLayers) return;
    const s = this.size - 1;
    const d = this.dirtyRect;
    const rect: Rect = { x0: Math.max(0, d.x0), y0: Math.max(0, d.y0), x1: Math.min(s, d.x1), y1: Math.min(s, d.y1) };
    const layers = this.dirtyLayers;
    this.dirtyLayers = 0;
    this.dirtyRect = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    this.bus?.emit('world:changed', { rect, layers });
  }

  // ── helpers ────────────────────────────────────────────────────────────
  forEachCellInRect(r: Rect, fn: (x: number, y: number, i: number) => void): void {
    const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0), x1 = Math.min(this.size - 1, r.x1), y1 = Math.min(this.size - 1, r.y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y, y * this.size + x);
  }
  /** road def helper usable by everyone */
  roadDefAt(x: number, y: number) {
    const t = this.roadAt(x, y);
    return t ? roadDef(t) : undefined;
  }
}
