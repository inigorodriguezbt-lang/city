// ─────────────────────────────────────────────────────────────────────────────
// WorldActions: every player-initiated world mutation. Each action is
// validated, costed (world.spend/charge/earn — creative mode is free, World
// handles that) and recorded as one undo step (see ./history.ts).
// Continuous edits (brush strokes, terraforming while held) are grouped into a
// single undo step with beginGroup()/endGroup().
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../game/Game';
import type { World } from './World';
import {
  CELL, MAX_HEIGHT, MAX_LOT_SLOPE, MAX_ROAD_SLOPE, MAX_ZONE_DEPTH, MIN_HEIGHT,
} from '../core/constants';
import {
  BFlag, DIR_DX, DIR_DY, Dir, RoadType, ZoneType,
  type ActionResult, type Building, type BuildingDef, type Cell, type District, type FieldId, type PlacementCheck, type Rect,
} from '../core/types';
import { hash3, hashFloat } from '../core/rng';
import { clamp, formatMoney } from '../core/util';
import { buildingDef } from '../data/buildings';
import { roadDef } from '../data/roads';
import { zoneDef } from '../data/zones';
import { MILESTONES } from '../data/milestones';
import { History, Transaction, diffIsEmpty, isRubble, type WorldDiff } from './history';

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

/** Per-cell verdict of a road analysis (index-aligned with `cells`). */
export enum RoadCellState {
  New = 0,
  /** same type already there (free) */
  Existing = 1,
  /** different car type there: pays the price difference */
  Upgrade = 2,
  Invalid = 3,
}

/** Full road analysis (a RoadCheck plus everything tools need for previews). */
export interface RoadAnalysis extends RoadCheck {
  type: RoadType;
  /** deduplicated path cells */
  cells: Cell[];
  state: Uint8Array;
  /** 1 where the cell is/will be a bridge */
  bridge: Uint8Array;
  upgrades: Cell[];
  existing: Cell[];
  /** zoned buildings removed when building with replace (Alt) */
  replaces: number[];
  /** number of cells that are new or upgraded */
  newCells: number;
  /** vertex index → graded height */
  grading: Map<number, number>;
  /** planned surface height per path cell (graded ground or bridge deck) */
  surface: Float32Array;
}

/** Placement analysis of a catalog building. */
export interface BuildingCheck extends PlacementCheck {
  /** zoned buildings that will be demolished */
  replaces: number[];
  /** footprint cells that fail (for red tiles) */
  blocked: Cell[];
  /** flattened lot elevation (m) */
  ground: number;
  /** true when the front side touches a usable road */
  frontage: boolean;
  /** the site itself is fine (only money may be missing) */
  siteOk: boolean;
  /** the player can pay for it (always true for free moves / creative) */
  affordable: boolean;
}

export interface BulldozePreview {
  buildings: number[];
  roads: Cell[];
  zones: Cell[];
  trees: Cell[];
  /** money returned (>= 0) */
  refund: number;
  /** rubble clearing cost (>= 0) */
  clearing: number;
  /** estimated value destroyed (for the confirmation prompt) */
  valueLost: number;
}

export interface BulldozeFilter {
  roads?: boolean;
  buildings?: boolean;
  zones?: boolean;
  trees?: boolean;
}

// ── tuning ──────────────────────────────────────────────────────────────────
const BRIDGE_COST_MULT = 3;
const MAX_BRIDGE_SPAN = 64;
/** steep bank cells a bridge may extend over on each side */
const MAX_ABUTMENT = 2;
/** max cut / fill depth when grading a road (m) */
const MAX_GRADE = 12;
/** road profile step limit between neighbouring cells (m) */
const GRADE_STEP = MAX_ROAD_SLOPE * CELL * 0.9;
const RESOURCE_THRESHOLD = 60;
const RUBBLE_COST_PER_CELL = 60;
const TERRAFORM_COST_PER_M3 = 0.05;
const TREE_COST = 12;
/** 'level' terraform target above sea level (m) */
const LEVEL_ABOVE_SEA = 1.2;
const ZONED_VALUE_PER_CELL = 600;

const ok = (cost = 0, id?: number): ActionResult => (id === undefined ? { ok: true, cost } : { ok: true, cost, id });
const fail = (reason: string): ActionResult => ({ ok: false, cost: 0, reason });

function isRailType(t: RoadType): boolean {
  return t === RoadType.Rail;
}

/** grid extents of a catalog footprint for a rotation */
export function rotatedSize(def: Pick<BuildingDef, 'w' | 'h'>, rot: Dir): { w: number; h: number } {
  return rot === Dir.N || rot === Dir.S ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}

/** footprint min corner for a footprint centered on cell (x,y) */
export function footprintAt(def: Pick<BuildingDef, 'w' | 'h'>, x: number, y: number, rot: Dir): { x: number; y: number; w: number; h: number } {
  const s = rotatedSize(def, rot);
  return { x: x - Math.floor(s.w / 2), y: y - Math.floor(s.h / 2), w: s.w, h: s.h };
}

/** the "center cell" argument for checkBuilding so the footprint is centered on world point (wx,wz) */
export function anchorForPoint(def: Pick<BuildingDef, 'w' | 'h'>, rot: Dir, wx: number, wz: number): Cell {
  const s = rotatedSize(def, rot);
  const x0 = Math.round(wx / CELL - s.w / 2);
  const y0 = Math.round(wz / CELL - s.h / 2);
  return { x: x0 + Math.floor(s.w / 2), y: y0 + Math.floor(s.h / 2) };
}

function milestoneLabel(index: number): string {
  const m = MILESTONES[Math.min(index, MILESTONES.length - 1)];
  return m ? `${m.name} (${m.population.toLocaleString('en-US')} citizens)` : `milestone ${index}`;
}

const RESOURCE_NAMES: Partial<Record<FieldId, string>> = {
  fertility: 'fertile land', forest: 'forest', ore: 'ore deposits', oil: 'oil deposits', wind: 'wind',
};

// ── district names & colours ────────────────────────────────────────────────
const DISTRICT_PREFIX = ['Old', 'New', 'North', 'South', 'East', 'West', 'Upper', 'Lower', 'Little', 'Great', 'Port', 'Fort', 'Saint', 'Green', 'High', 'Kings', 'Queens', 'Mill', 'Bridge', 'Harbor', 'Oak', 'Elm', 'Cedar', 'Maple', 'Willow', 'Stone', 'Silver', 'Golden', 'Fair', 'Lark', 'Ash', 'Rose', 'Iron', 'Crown', 'Amber', 'Linden'];
const DISTRICT_SUFFIX = ['Town', 'Heights', 'Park', 'Gardens', 'Village', 'Quarter', 'Hill', 'Fields', 'Bay', 'Point', 'Ridge', 'Grove', 'Side', 'Brook', 'Vale', 'Wood', 'Market', 'Square', 'Commons', 'Docks', 'Crossing', 'Meadows', 'Terrace', 'Green', 'Row', 'End', 'Gate', 'Hollow', 'Landing', 'Mews'];
const DISTRICT_WHOLE = ['Downtown', 'Midtown', 'Uptown', 'Riverside', 'Lakeview', 'Hillcrest', 'Brookhaven', 'Ashbury', 'Kingsbridge', 'Westmere', 'Eastgate', 'Northfield', 'Southmoor', 'Fairhaven', 'Oakridge', 'Silverlake', 'Harborview', 'Greenwich', 'Belmont', 'Clearwater', 'Redstone', 'Maplewood', 'Windermere', 'Highgate', 'Stonebridge', 'Larkspur', 'Rosedale', 'Cedarbrook', 'Ironworks', 'Millbrook'];

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function hexHue(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// ── binary heap for A* ──────────────────────────────────────────────────────
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        if (l >= n) break;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

type HistoryListener = () => void;

export class WorldActions {
  /** undo/redo stacks (100 steps) */
  readonly history = new History(100);
  private tx: Transaction | null = null;
  private group: { label: string; depth: number } | null = null;
  /** true while this class mutates the world (ignore our own removal events) */
  private applying = false;
  private historyListeners = new Set<HistoryListener>();

  constructor(protected game: Game) {
    game.events.on('building:removed', (b) => {
      if (this.applying) return;
      // removed by another system (auto-bulldoze, events…): its history is void
      this.history.forgetBuilding(b.id);
      this.tx?.forgetBuilding(b.id);
    });
    game.events.on('world:loaded', () => this.clearHistory());
    game.events.on('world:unloaded', () => this.clearHistory());
  }

  private get world(): World | null {
    return this.game.world;
  }

  // ════════════════════════════════════════════════════════════════════════
  // History
  // ════════════════════════════════════════════════════════════════════════

  undo(): boolean {
    const w = this.world;
    if (!w) return false;
    this.flushGroup();
    const d = this.history.popUndo();
    if (!d) {
      this.toast('Nothing to undo', 'info');
      return false;
    }
    const tx = new Transaction(w, d.label);
    this.applying = true;
    let res: { ok: boolean; reason?: string };
    try {
      res = tx.revert(d);
    } finally {
      this.applying = false;
    }
    if (!res.ok) {
      this.history.pushUndoKeepRedo(d);
      this.toast(`Can't undo ${d.label}: ${res.reason ?? 'blocked'}`, 'warning');
      this.sfx('error');
      return false;
    }
    this.history.pushRedo(tx.commit());
    this.afterChange();
    this.toast(`Undo · ${d.label}`, 'info');
    this.sfx('close', 0.7);
    this.emitHistory();
    return true;
  }

  redo(): boolean {
    const w = this.world;
    if (!w) return false;
    this.flushGroup();
    const d = this.history.popRedo();
    if (!d) {
      this.toast('Nothing to redo', 'info');
      return false;
    }
    const tx = new Transaction(w, d.label);
    this.applying = true;
    let res: { ok: boolean; reason?: string };
    try {
      res = tx.revert(d);
    } finally {
      this.applying = false;
    }
    if (!res.ok) {
      this.history.pushRedo(d);
      this.toast(`Can't redo ${d.label}: ${res.reason ?? 'blocked'}`, 'warning');
      this.sfx('error');
      return false;
    }
    this.history.pushUndoKeepRedo(tx.commit());
    this.afterChange();
    this.toast(`Redo · ${d.label}`, 'info');
    this.sfx('click', 0.7);
    this.emitHistory();
    return true;
  }

  canUndo(): boolean {
    return this.history.canUndo || !!this.tx;
  }
  canRedo(): boolean {
    return this.history.canRedo;
  }
  clearHistory(): void {
    this.tx = null;
    this.group = null;
    this.history.clear();
    this.emitHistory();
  }
  /** label of the step undo() would revert */
  undoLabel(): string | null {
    return this.history.peekUndo()?.label ?? null;
  }
  redoLabel(): string | null {
    return this.history.peekRedo()?.label ?? null;
  }
  /** subscribe to undo/redo availability changes */
  onHistoryChanged(fn: HistoryListener): () => void {
    this.historyListeners.add(fn);
    return () => this.historyListeners.delete(fn);
  }

  /** Group following actions into ONE undo step until endGroup() (brush strokes, drags). Nests. */
  beginGroup(label: string): void {
    if (this.group) {
      this.group.depth++;
      return;
    }
    this.group = { label, depth: 1 };
  }
  endGroup(): void {
    if (!this.group) return;
    if (--this.group.depth > 0) return;
    this.group = null;
    this.commitTx();
  }
  /** rename the currently open group (e.g. once the stroke knows what it did) */
  setGroupLabel(label: string): void {
    if (this.group) this.group.label = label;
    if (this.tx) this.tx.label = label;
  }
  get grouping(): boolean {
    return !!this.group;
  }

  private flushGroup(): void {
    if (this.group) {
      this.group = null;
      this.commitTx();
    }
  }

  private emitHistory(): void {
    for (const fn of this.historyListeners) {
      try {
        fn();
      } catch (e) {
        console.error('[actions] history listener failed', e);
      }
    }
  }

  private commitTx(): void {
    const tx = this.tx;
    this.tx = null;
    if (!tx) return;
    const d: WorldDiff = tx.commit();
    if (diffIsEmpty(d)) return;
    this.history.push(d);
    this.emitHistory();
  }

  /** run a mutation inside the current (or a new) transaction */
  private run<T>(label: string, fn: (tx: Transaction, w: World) => T): T {
    const w = this.world!;
    if (!this.tx) this.tx = new Transaction(w, this.group?.label ?? label);
    const tx = this.tx;
    this.applying = true;
    try {
      return fn(tx, w);
    } finally {
      this.applying = false;
      if (!this.group) this.commitTx();
    }
  }

  private afterChange(): void {
    try {
      this.game.fields?.requestRecompute();
    } catch (e) {
      console.warn('[actions] field recompute request failed', e);
    }
  }

  private toast(text: string, kind: 'info' | 'good' | 'warning' | 'danger'): void {
    try {
      this.game.ui?.toast(text, kind);
    } catch {
      /* UI not ready */
    }
  }

  private sfx(id: 'error' | 'click' | 'close', vol = 1): void {
    try {
      this.game.audio?.play(id, vol);
    } catch {
      /* audio not ready */
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Roads
  // ════════════════════════════════════════════════════════════════════════

  /** Plan a path between two cells. 'straight' = one axis-aligned or diagonal-staircase line,
   *  'lshape' = two segments, 'auto' = A* avoiding obstacles/steep slopes. */
  planRoad(from: Cell, to: Cell, type: RoadType, mode: 'straight' | 'lshape' | 'auto' = 'lshape'): Cell[] {
    const w = this.world;
    if (!w) return [from, to];
    const a = this.clampCell(w, from), b = this.clampCell(w, to);
    if (a.x === b.x && a.y === b.y) return [a];
    if (mode === 'straight') return this.straightPath(a, b);
    if (mode === 'auto') return this.autoPath(w, a, b, type) ?? this.lPath(w, a, b, type);
    return this.lPath(w, a, b, type);
  }

  /** the end cell a straight (8-direction snapped) drag from `from` toward `to` reaches */
  snapStraight(from: Cell, to: Cell): Cell {
    const p = this.straightPath(from, to);
    return p[p.length - 1];
  }

  private clampCell(w: World, c: Cell): Cell {
    return { x: clamp(Math.round(c.x), 0, w.size - 1), y: clamp(Math.round(c.y), 0, w.size - 1) };
  }

  private segment(a: Cell, b: Cell, out: Cell[]): void {
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    let x = a.x, y = a.y;
    if (!out.length || out[out.length - 1].x !== x || out[out.length - 1].y !== y) out.push({ x, y });
    while (x !== b.x || y !== b.y) {
      if (x !== b.x) x += dx;
      else y += dy;
      out.push({ x, y });
    }
  }

  private straightPath(a: Cell, b: Cell): Cell[] {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const out: Cell[] = [];
    if (ay * 2 <= ax) {
      this.segment(a, { x: b.x, y: a.y }, out);
      return out;
    }
    if (ax * 2 <= ay) {
      this.segment(a, { x: a.x, y: b.y }, out);
      return out;
    }
    // 45° diagonal staircase (roads need 4-connectivity)
    const n = Math.max(1, Math.round((ax + ay) / 2));
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const xFirst = ax >= ay;
    let x = a.x, y = a.y;
    out.push({ x, y });
    for (let k = 0; k < n; k++) {
      if (xFirst) {
        x += sx;
        out.push({ x, y });
        y += sy;
        out.push({ x, y });
      } else {
        y += sy;
        out.push({ x, y });
        x += sx;
        out.push({ x, y });
      }
    }
    return out;
  }

  /** obstacle penalty of a cell for choosing between the two L bends */
  private lPenalty(w: World, c: Cell, type: RoadType): number {
    if (!w.inBounds(c.x, c.y)) return 20;
    const i = w.idx(c.x, c.y);
    let p = 0;
    const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
    if (b) p += b.kind === 'service' ? 12 : 5;
    const r = w.road[i] as RoadType;
    if (r) {
      if (isRailType(r) !== isRailType(type)) p += 12;
      else if (r === type) p -= 0.3;
    }
    if (!r && w.isWater(c.x, c.y)) p += type === RoadType.Dirt ? 12 : 1.5;
    const s = w.cellSlope(c.x, c.y);
    if (s > MAX_ROAD_SLOPE * 1.4) p += 2;
    return p;
  }

  private lPath(w: World, a: Cell, b: Cell, type: RoadType): Cell[] {
    const h: Cell[] = [];
    this.segment(a, { x: b.x, y: a.y }, h);
    this.segment({ x: b.x, y: a.y }, b, h);
    const v: Cell[] = [];
    this.segment(a, { x: a.x, y: b.y }, v);
    this.segment({ x: a.x, y: b.y }, b, v);
    let sh = 0, sv = 0;
    for (const c of h) sh += this.lPenalty(w, c, type);
    for (const c of v) sv += this.lPenalty(w, c, type);
    if (Math.abs(sh - sv) < 0.05) return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? h : v;
    return sh < sv ? h : v;
  }

  /** A* over cells × incoming direction (turn penalty). null when no route. */
  private autoPath(w: World, a: Cell, b: Cell, type: RoadType): Cell[] | null {
    const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const margin = Math.min(64, 16 + Math.round(dist * 0.5));
    const x0 = Math.max(0, Math.min(a.x, b.x) - margin), y0 = Math.max(0, Math.min(a.y, b.y) - margin);
    const x1 = Math.min(w.size - 1, Math.max(a.x, b.x) + margin), y1 = Math.min(w.size - 1, Math.max(a.y, b.y) + margin);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const n = bw * bh;
    // per-cell step cost (Infinity = blocked)
    const cost = new Float32Array(n);
    const rail = isRailType(type);
    for (let yy = 0; yy < bh; yy++)
      for (let xx = 0; xx < bw; xx++) {
        const cx = xx + x0, cy = yy + y0;
        const i = w.idx(cx, cy);
        let c: number;
        const r = w.road[i] as RoadType;
        if (w.bldg[i]) c = Infinity;
        else if (r) c = isRailType(r) !== rail ? Infinity : r === type ? 0.3 : 0.8;
        else if (w.isWater(cx, cy)) c = type === RoadType.Dirt ? Infinity : 3.5;
        else {
          const s = w.cellSlope(cx, cy);
          c = s > MAX_ROAD_SLOPE ? 4 + (10 * (s - MAX_ROAD_SLOPE)) / MAX_ROAD_SLOPE : 1 + (s / MAX_ROAD_SLOPE) * 0.4;
        }
        cost[yy * bw + xx] = c;
      }
    const ia = (a.y - y0) * bw + (a.x - x0), ib = (b.y - y0) * bw + (b.x - x0);
    cost[ia] = Math.min(cost[ia], 1);
    cost[ib] = Math.min(cost[ib], 1);
    // states: cell*5 + dir (0..3 incoming dir, 4 = start)
    const S = n * 5;
    const g = new Float32Array(S).fill(Infinity);
    const came = new Int32Array(S).fill(-1);
    const closed = new Uint8Array(S);
    const heap = new MinHeap();
    const hw = 0.45;
    const hfn = (c: number) => (Math.abs((c % bw) - (b.x - x0)) + Math.abs(((c / bw) | 0) - (b.y - y0))) * hw;
    const start = ia * 5 + 4;
    g[start] = 0;
    heap.push(start, hfn(ia));
    let found = -1;
    let expansions = 0;
    const maxExp = 250_000;
    while (heap.size) {
      const s = heap.pop();
      if (closed[s]) continue;
      closed[s] = 1;
      const c = (s / 5) | 0, dIn = s % 5;
      if (c === ib) {
        found = s;
        break;
      }
      if (++expansions > maxExp) break;
      const cx = c % bw, cy = (c / bw) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIR_DX[d], ny = cy + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nc = ny * bw + nx;
        const step = cost[nc];
        if (step === Infinity) continue;
        const turn = dIn !== 4 && dIn !== d ? 0.5 : 0;
        const ns = nc * 5 + d;
        const ng = g[s] + step + turn;
        if (ng < g[ns]) {
          g[ns] = ng;
          came[ns] = s;
          heap.push(ns, ng + hfn(nc));
        }
      }
    }
    if (found < 0) return null;
    const out: Cell[] = [];
    for (let s = found; s >= 0; s = came[s]) {
      const c = (s / 5) | 0;
      out.push({ x: (c % bw) + x0, y: ((c / bw) | 0) + y0 });
    }
    out.reverse();
    return out;
  }

  checkRoad(path: Cell[], type: RoadType, opts: { replace?: boolean } = {}): RoadAnalysis {
    return this.analyzeRoad(path, type, !!opts.replace);
  }

  /** Validate + cost + grade a road path (no mutation). */
  analyzeRoad(path: Cell[], type: RoadType, replace = false): RoadAnalysis {
    const w = this.world;
    const def = roadDef(type);
    const cells: Cell[] = [];
    const seen = new Set<number>();
    const res: RoadAnalysis = {
      ok: false, cost: 0, invalid: [], bridges: [], type, cells, state: new Uint8Array(0), bridge: new Uint8Array(0),
      upgrades: [], existing: [], replaces: [], newCells: 0, grading: new Map(), surface: new Float32Array(0),
    };
    if (!w || !def || type === RoadType.None) {
      res.reason = 'Pick a road type';
      return res;
    }
    for (const c of path) {
      const k = c.y * 65536 + c.x;
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push({ x: c.x, y: c.y });
    }
    const n = cells.length;
    const state = (res.state = new Uint8Array(n));
    const bridge = (res.bridge = new Uint8Array(n));
    res.surface = new Float32Array(n);
    const reasons = new Map<string, number>();
    const bad = (k: number, why: string) => {
      if (state[k] !== RoadCellState.Invalid) res.invalid.push(cells[k]);
      state[k] = RoadCellState.Invalid;
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
    };
    const locked = !w.isUnlocked(def.unlock);
    const replaces = new Set<number>();
    const rail = isRailType(type);

    for (let k = 0; k < n; k++) {
      const { x, y } = cells[k];
      if (!w.inBounds(x, y)) {
        bad(k, 'Outside the map');
        continue;
      }
      const i = w.idx(x, y);
      const r = w.road[i] as RoadType;
      const wet = r ? w.isBridge(x, y) : w.isWater(x, y);
      bridge[k] = wet ? 1 : 0;
      if (locked) {
        bad(k, `${def.name} unlocks at ${milestoneLabel(def.unlock)}`);
        continue;
      }
      if (r) {
        if (isRailType(r) !== rail) {
          bad(k, rail ? 'Railways cannot cross roads' : 'Roads cannot cross railways');
          continue;
        }
        if (r === type) {
          state[k] = RoadCellState.Existing;
          res.existing.push(cells[k]);
          continue;
        }
        if (wet && type === RoadType.Dirt) {
          bad(k, 'Gravel roads cannot be bridges');
          continue;
        }
        state[k] = RoadCellState.Upgrade;
        res.upgrades.push(cells[k]);
        const diff = Math.max(0, def.cost - roadDef(r).cost);
        res.cost += diff * (wet ? BRIDGE_COST_MULT : 1);
        continue;
      }
      const bid = w.bldg[i];
      if (bid) {
        const b = w.buildings.get(bid);
        if (b && b.kind === 'zoned' && replace) {
          replaces.add(bid);
        } else {
          const name = b ? this.buildingName(b) : 'a building';
          bad(k, b && b.kind === 'zoned' ? `Blocked by buildings (hold Alt to replace)` : `Blocked by ${name}`);
          continue;
        }
      }
      if (wet) {
        if (type === RoadType.Dirt) {
          bad(k, 'Gravel roads cannot cross water');
          continue;
        }
        res.bridges.push(cells[k]);
      }
      state[k] = RoadCellState.New;
      res.cost += def.cost * (wet ? BRIDGE_COST_MULT : 1);
    }

    // bridge span limit (consecutive new water cells)
    for (let k = 0; k < n; ) {
      if (!bridge[k] || state[k] !== RoadCellState.New) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < n && bridge[e + 1] && this.adjacent(cells[e], cells[e + 1])) e++;
      if (e - k + 1 > MAX_BRIDGE_SPAN) for (let j = k; j <= e; j++) bad(j, `Bridge too long (max ${MAX_BRIDGE_SPAN * CELL} m)`);
      k = e + 1;
    }

    res.replaces = [...replaces];
    // terrain grading along the path (only new land cells are regraded)
    let steep = this.gradeRoad(w, res, replaces);
    // steep banks next to a bridge become part of it (abutments / short viaducts)
    if (steep.length && type !== RoadType.Dirt && this.extendBridges(res, steep, def.cost)) {
      res.grading.clear();
      steep = this.gradeRoad(w, res, replaces);
    }
    for (const k of steep) {
      res.invalid.push(cells[k]);
      state[k] = RoadCellState.Invalid;
    }
    if (steep.length) reasons.set('Too steep for a road', (reasons.get('Too steep for a road') ?? 0) + steep.length);

    let newCells = 0;
    for (let k = 0; k < n; k++) if (state[k] === RoadCellState.New || state[k] === RoadCellState.Upgrade) newCells++;
    res.newCells = newCells;
    res.cost = Math.round(res.cost);

    if (res.invalid.length) {
      let best = '', cnt = -1;
      for (const [why, c] of reasons) if (c > cnt) { best = why; cnt = c; }
      res.reason = best;
    } else if (!w.canAfford(res.cost)) {
      res.reason = `Not enough money (${formatMoney(res.cost)} needed)`;
    } else if (!newCells) {
      res.reason = 'Already built';
    }
    res.ok = !res.invalid.length && w.canAfford(res.cost) && newCells > 0;
    return res;
  }

  private adjacent(a: Cell, b: Cell): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  /**
   * Turn steep new land cells that directly continue a bridge run (in path
   * order) into bridge cells — at most MAX_ABUTMENT per side. Returns true
   * when something changed (grading must then be recomputed).
   */
  private extendBridges(res: RoadAnalysis, steep: number[], cellCost: number): boolean {
    const { cells, state, bridge } = res;
    const n = cells.length;
    const isSteep = new Uint8Array(n);
    for (const k of steep) isSteep[k] = 1;
    const convert: number[] = [];
    for (let k = 0; k < n; k++) {
      if (!bridge[k]) continue;
      for (const dir of [-1, 1]) {
        let j = k + dir, count = 0;
        while (j >= 0 && j < n && count < MAX_ABUTMENT && isSteep[j] && !bridge[j] && state[j] === RoadCellState.New && this.adjacent(cells[j], cells[j - dir])) {
          convert.push(j);
          isSteep[j] = 0;
          count++;
          j += dir;
        }
      }
    }
    if (!convert.length) return false;
    for (const j of convert) {
      bridge[j] = 1;
      res.bridges.push(cells[j]);
      res.cost += cellCost * (BRIDGE_COST_MULT - 1);
    }
    return true;
  }

  /** is vertex (vx,vy) locked for road grading? */
  private gradePinned(w: World, vx: number, vy: number, gradable: Set<number>, replaces: Set<number>): boolean {
    for (let cy = vy - 1; cy <= vy; cy++)
      for (let cx = vx - 1; cx <= vx; cx++) {
        if (!w.inBounds(cx, cy)) continue;
        const i = w.idx(cx, cy);
        if (gradable.has(i)) continue;
        if (w.road[i]) return true;
        if (w.bldg[i] && !replaces.has(w.bldg[i])) return true;
        if (w.isWater(cx, cy)) return true;
      }
    return false;
  }

  /**
   * Smooth the path's height profile with a slope limit and derive vertex
   * targets. Existing roads, buildings and shorelines are never regraded.
   * Returns the path indices of new land cells that remain too steep.
   */
  private gradeRoad(w: World, res: RoadAnalysis, replaces: Set<number>): number[] {
    const { cells, state, bridge, surface } = res;
    const n = cells.length;
    const s1 = w.size + 1;
    const nat = new Float32Array(n);
    const T = new Float32Array(n);
    const anchor = new Uint8Array(n);
    const gradable = new Set<number>();
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      if (!w.inBounds(c.x, c.y)) {
        anchor[k] = 1;
        continue;
      }
      nat[k] = T[k] = w.cellHeight(c.x, c.y);
      if (state[k] === RoadCellState.New && !bridge[k]) gradable.add(w.idx(c.x, c.y));
      else anchor[k] = 1;
    }
    // runs of consecutive, adjacent, non-bridge cells
    let k = 0;
    while (k < n) {
      if (bridge[k] || !w.inBounds(cells[k].x, cells[k].y)) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < n && !bridge[e + 1] && this.adjacent(cells[e], cells[e + 1])) e++;
      if (e > k) {
        const tmp = new Float32Array(e - k + 1);
        for (let pass = 0; pass < 3; pass++) {
          for (let j = k; j <= e; j++) {
            const a = T[Math.max(k, j - 1)], b = T[Math.min(e, j + 1)];
            tmp[j - k] = anchor[j] ? T[j] : (a + 2 * T[j] + b) * 0.25;
          }
          for (let j = k; j <= e; j++) T[j] = tmp[j - k];
        }
        for (let round = 0; round < 3; round++) {
          for (let j = k + 1; j <= e; j++) if (!anchor[j]) T[j] = clamp(T[j], T[j - 1] - GRADE_STEP, T[j - 1] + GRADE_STEP);
          for (let j = e - 1; j >= k; j--) if (!anchor[j]) T[j] = clamp(T[j], T[j + 1] - GRADE_STEP, T[j + 1] + GRADE_STEP);
        }
        for (let j = k; j <= e; j++) if (!anchor[j]) T[j] = clamp(T[j], nat[j] - MAX_GRADE, nat[j] + MAX_GRADE);
      }
      k = e + 1;
    }
    // vertex targets = mean of the targets of the gradable cells touching them
    const sum = new Map<number, number>();
    const cnt = new Map<number, number>();
    for (let j = 0; j < n; j++) {
      const c = cells[j];
      if (!w.inBounds(c.x, c.y) || !gradable.has(w.idx(c.x, c.y))) continue;
      for (let oy = 0; oy <= 1; oy++)
        for (let ox = 0; ox <= 1; ox++) {
          const v = (c.y + oy) * s1 + c.x + ox;
          sum.set(v, (sum.get(v) ?? 0) + T[j]);
          cnt.set(v, (cnt.get(v) ?? 0) + 1);
        }
    }
    const grading = res.grading;
    const pinnedCache = new Map<number, boolean>();
    const pinned = (v: number) => {
      let p = pinnedCache.get(v);
      if (p === undefined) {
        p = this.gradePinned(w, v % s1, (v / s1) | 0, gradable, replaces);
        pinnedCache.set(v, p);
      }
      return p;
    };
    for (const [v, s] of sum) {
      if (pinned(v)) continue;
      const t = s / cnt.get(v)!;
      if (Math.abs(t - w.heights[v]) > 0.01) grading.set(v, t);
    }
    // slope check on the graded result + planned surface heights
    const hAt = (v: number) => grading.get(v) ?? w.heights[v];
    const steep: number[] = [];
    for (let j = 0; j < n; j++) {
      const c = cells[j];
      if (!w.inBounds(c.x, c.y)) continue;
      const v00 = c.y * s1 + c.x, v10 = v00 + 1, v01 = v00 + s1, v11 = v01 + 1;
      const a = hAt(v00), b = hAt(v10), cc = hAt(v01), d = hAt(v11);
      surface[j] = (a + b + cc + d) * 0.25;
      if (state[j] !== RoadCellState.New || bridge[j]) continue;
      const slope = (Math.max(a, b, cc, d) - Math.min(a, b, cc, d)) / CELL;
      if (slope > MAX_ROAD_SLOPE + 1e-3) steep.push(j);
    }
    // bridge decks for previews: interpolate between the banks, keep clearance
    for (let j = 0; j < n; ) {
      if (!bridge[j]) {
        j++;
        continue;
      }
      let e = j;
      while (e + 1 < n && bridge[e + 1]) e++;
      const ha = j > 0 ? surface[j - 1] : NaN;
      const hb = e + 1 < n ? surface[e + 1] : NaN;
      for (let q = j; q <= e; q++) {
        const c = cells[q];
        if (!w.inBounds(c.x, c.y)) continue;
        if (w.road[w.idx(c.x, c.y)] && this.game.roadSurface) {
          surface[q] = this.game.roadSurface.deck(c.x, c.y);
          continue;
        }
        const floor = Math.max(w.waterLevel(c.x, c.y), w.cellHeight(c.x, c.y)) + 4.5;
        const t = (q - j + 1) / (e - j + 2);
        const base = !Number.isNaN(ha) && !Number.isNaN(hb) ? ha + (hb - ha) * t : !Number.isNaN(ha) ? ha : !Number.isNaN(hb) ? hb : floor;
        surface[q] = Math.max(base, floor);
      }
      j = e + 1;
    }
    // feather one ring of vertices around the graded corridor (half blend)
    if (grading.size) {
      const feather = new Map<number, [number, number]>();
      for (const [v, t] of grading) {
        const vx = v % s1, vy = (v / s1) | 0;
        const dh = t - w.heights[v];
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = vx + ox, ny = vy + oy;
            if (nx < 0 || ny < 0 || nx >= s1 || ny >= s1) continue;
            const nv = ny * s1 + nx;
            if (sum.has(nv) || grading.has(nv)) continue;
            const f = feather.get(nv) ?? [0, 0];
            f[0] += dh;
            f[1]++;
            feather.set(nv, f);
          }
      }
      for (const [v, [s, c]] of feather) {
        const dh = (s / c) * 0.5;
        if (Math.abs(dh) < 0.05) continue;
        if (this.gradePinned(w, v % s1, (v / s1) | 0, new Set(), replaces)) continue;
        grading.set(v, w.heights[v] + dh);
      }
    }
    return steep;
  }

  placeRoad(path: Cell[], type: RoadType, opts: { replace?: boolean } = {}): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const a = this.analyzeRoad(path, type, !!opts.replace);
    if (!a.ok) return fail(a.reason ?? 'Cannot build here');
    const def = roadDef(type);
    const label = a.upgrades.length && a.upgrades.length === a.newCells ? `Upgrade to ${def.name}` : `Build ${def.name}`;
    return this.run(label, (tx, world) => {
      if (!tx.spend(a.cost, 'construction')) return fail('Not enough money');
      for (const id of a.replaces) tx.removeBuilding(id);
      const s1 = world.size + 1;
      for (const [v, h] of a.grading) tx.setVertex(v % s1, (v / s1) | 0, h);
      for (let k = 0; k < a.cells.length; k++) {
        const c = a.cells[k];
        const st = a.state[k];
        if (st === RoadCellState.New) tx.setRoad(c.x, c.y, type, a.bridge[k] ? 1 : 0);
        else if (st === RoadCellState.Upgrade) tx.setRoad(c.x, c.y, type, world.roadFlags[world.idx(c.x, c.y)]);
      }
      this.afterChange();
      return ok(a.cost);
    });
  }

  /** replace road type along existing cells (pays difference) */
  upgradeRoad(cells: Cell[], type: RoadType): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const def = roadDef(type);
    if (!def) return fail('Unknown road type');
    if (!w.isUnlocked(def.unlock)) return fail(`${def.name} unlocks at ${milestoneLabel(def.unlock)}`);
    const todo: Cell[] = [];
    let cost = 0;
    const seen = new Set<number>();
    for (const c of cells) {
      if (!w.inBounds(c.x, c.y)) continue;
      const i = w.idx(c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      const r = w.road[i] as RoadType;
      if (!r || r === type || isRailType(r) !== isRailType(type)) continue;
      const wet = w.isBridge(c.x, c.y);
      if (wet && type === RoadType.Dirt) continue;
      todo.push(c);
      cost += Math.max(0, def.cost - roadDef(r).cost) * (wet ? BRIDGE_COST_MULT : 1);
    }
    if (!todo.length) return fail('Nothing to upgrade');
    cost = Math.round(cost);
    if (!w.canAfford(cost)) return fail(`Not enough money (${formatMoney(cost)} needed)`);
    return this.run(`Upgrade to ${def.name}`, (tx, world) => {
      if (!tx.spend(cost, 'construction')) return fail('Not enough money');
      for (const c of todo) tx.setRoad(c.x, c.y, type, world.roadFlags[world.idx(c.x, c.y)]);
      this.afterChange();
      return ok(cost);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Zoning
  // ════════════════════════════════════════════════════════════════════════

  /** a zoning-enabled road within MAX_ZONE_DEPTH cells straight N/E/S/W */
  private nearZoningRoad(w: World, x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      for (let k = 1; k <= MAX_ZONE_DEPTH; k++) {
        const cx = x + DIR_DX[d] * k, cy = y + DIR_DY[d] * k;
        if (!w.inBounds(cx, cy)) break;
        const i = w.idx(cx, cy);
        const r = w.road[i] as RoadType;
        if (r) {
          if (roadDef(r).allowsZoning) return true;
          break;
        }
        if (w.isWater(cx, cy)) break;
        const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
        if (b && b.kind === 'service') break;
      }
    }
    return false;
  }

  /** why a cell cannot take `zone` (null = zoneable) */
  zoneBlockReason(x: number, y: number, zone?: ZoneType): string | null {
    const w = this.world;
    if (!w || !w.inBounds(x, y)) return 'Outside the map';
    const i = w.idx(x, y);
    if (w.road[i]) return 'Roads cannot be zoned';
    if (w.isWater(x, y)) return 'Water cannot be zoned';
    const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
    if (b && b.kind === 'service') return `Occupied by ${this.buildingName(b)}`;
    if (w.cellSlope(x, y) > MAX_LOT_SLOPE) return 'Too steep to build on';
    if (zone !== undefined && zone !== ZoneType.None) {
      const zd = zoneDef(zone);
      if (zd && !w.isUnlocked(zd.unlock)) return `${zd.name} unlocks at ${milestoneLabel(zd.unlock)}`;
      if (zd?.resource && w.field(zd.resource, x, y) <= RESOURCE_THRESHOLD) return `Needs ${RESOURCE_NAMES[zd.resource] ?? zd.resource} (check the resource info view)`;
    }
    if (!this.nearZoningRoad(w, x, y)) return `Too far from a road (max ${MAX_ZONE_DEPTH} cells)`;
    return null;
  }

  isZoneable(x: number, y: number, zone?: ZoneType): boolean {
    return this.zoneBlockReason(x, y, zone) === null;
  }

  zoneCells(cells: Cell[], zone: ZoneType): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const zd = zone ? zoneDef(zone) : undefined;
    if (zone && !zd) return fail('Unknown zone');
    const label = zone ? `Zone ${zd!.name}` : 'Dezone';
    // validate first so failed strokes don't open empty transactions
    const todo: Cell[] = [];
    const reasons = new Map<string, number>();
    const seen = new Set<number>();
    for (const c of cells) {
      if (!w.inBounds(c.x, c.y)) continue;
      const i = w.idx(c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (zone === ZoneType.None) {
        if (w.zone[i]) todo.push(c);
        continue;
      }
      if (w.zone[i] === zone) continue;
      const why = this.zoneBlockReason(c.x, c.y, zone);
      if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
      else todo.push(c);
    }
    if (!todo.length) {
      let best = zone ? 'Already zoned' : 'Nothing to dezone', cnt = 0;
      for (const [why, c] of reasons) if (c > cnt) { best = why; cnt = c; }
      return fail(best);
    }
    return this.run(label, (tx, world) => {
      for (const c of todo) {
        const i = world.idx(c.x, c.y);
        const b = world.bldg[i] ? world.buildings.get(world.bldg[i]) : undefined;
        if (b && b.kind === 'zoned' && b.zone !== zone) tx.removeBuilding(b.id);
        tx.setZone(c.x, c.y, zone);
      }
      return ok(0);
    });
  }

  zoneRect(r: Rect, zone: ZoneType): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const cells: Cell[] = [];
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    w.forEachCellInRect({ x0, y0, x1, y1 }, (x, y) => cells.push({ x, y }));
    return this.zoneCells(cells, zone);
  }

  /** cells a fill from `start` would (re)zone — no mutation */
  fillRegion(start: Cell, zone: ZoneType, maxCells = 4000): Cell[] {
    const w = this.world;
    if (!w || !w.inBounds(start.x, start.y)) return [];
    const startZone = w.zone[w.idx(start.x, start.y)];
    if (zone === ZoneType.None ? startZone === 0 : startZone === zone) return [];
    const accept = (x: number, y: number) => {
      const i = w.idx(x, y);
      if (w.zone[i] !== startZone) return false;
      return zone === ZoneType.None ? true : this.isZoneable(x, y, zone);
    };
    if (!accept(start.x, start.y)) return [];
    const out: Cell[] = [];
    const seen = new Uint8Array(w.size * w.size);
    const q: number[] = [w.idx(start.x, start.y)];
    seen[q[0]] = 1;
    while (q.length && out.length < maxCells) {
      const i = q.shift()!;
      const x = i % w.size, y = (i / w.size) | 0;
      out.push({ x, y });
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
        if (!w.inBounds(nx, ny)) continue;
        const ni = w.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        if (accept(nx, ny)) q.push(ni);
      }
    }
    return out;
  }

  /** flood-fill contiguous zoneable cells from start (bounded) */
  zoneFill(start: Cell, zone: ZoneType, maxCells = 4000): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const cells = this.fillRegion(start, zone, maxCells);
    if (!cells.length) {
      const why = zone ? this.zoneBlockReason(start.x, start.y, zone) : null;
      return fail(why ?? (zone ? 'Already zoned' : 'Nothing to dezone'));
    }
    return this.zoneCells(cells, zone);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Buildings
  // ════════════════════════════════════════════════════════════════════════

  /** display name of a building */
  buildingName(b: Building): string {
    if (b.name) return b.name;
    if (b.kind === 'service') return buildingDef(b.defId)?.name ?? 'Building';
    const zd = zoneDef(b.zone);
    return zd ? `${zd.name} building` : 'Building';
  }

  /** usable (car/pedestrian, not highway/rail) road on the row just outside side `d` of a footprint */
  private sideHasRoad(w: World, x0: number, y0: number, gw: number, gh: number, d: Dir, rail = false): boolean {
    const test = (x: number, y: number) => {
      const t = w.roadAt(x, y);
      if (rail) return t === RoadType.Rail;
      return t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Highway;
    };
    if (d === Dir.N) { for (let i = 0; i < gw; i++) if (test(x0 + i, y0 - 1)) return true; }
    else if (d === Dir.S) { for (let i = 0; i < gw; i++) if (test(x0 + i, y0 + gh)) return true; }
    else if (d === Dir.W) { for (let i = 0; i < gh; i++) if (test(x0 - 1, y0 + i)) return true; }
    else for (let i = 0; i < gh; i++) if (test(x0 + gw, y0 + i)) return true;
    return false;
  }

  /** flattened lot elevation for a footprint (road-shared vertices keep their height) */
  lotGround(x0: number, y0: number, gw: number, gh: number, ignoreId = 0): number {
    const w = this.world;
    if (!w) return 0;
    let ps = 0, pn = 0, as = 0, an = 0;
    for (let vy = y0; vy <= y0 + gh; vy++)
      for (let vx = x0; vx <= x0 + gw; vx++) {
        const h = w.vertexHeight(vx, vy);
        as += h;
        an++;
        if (this.lotVertexPinned(w, vx, vy, x0, y0, gw, gh, ignoreId)) {
          ps += h;
          pn++;
        }
      }
    return pn ? ps / pn : an ? as / an : 0;
  }

  /** a footprint vertex shared with a road / other building / water keeps its height */
  private lotVertexPinned(w: World, vx: number, vy: number, x0: number, y0: number, gw: number, gh: number, ignoreId: number): boolean {
    for (let cy = vy - 1; cy <= vy; cy++)
      for (let cx = vx - 1; cx <= vx; cx++) {
        if (cx >= x0 && cy >= y0 && cx < x0 + gw && cy < y0 + gh) continue; // inside the lot
        if (!w.inBounds(cx, cy)) continue;
        const i = w.idx(cx, cy);
        if (w.road[i]) return true;
        const o = w.bldg[i];
        if (o && o !== ignoreId) {
          const ob = w.buildings.get(o);
          if (ob && ob.kind === 'service') return true;
        }
        if (w.isWater(cx, cy)) return true;
      }
    return false;
  }

  private flattenLot(tx: Transaction, w: World, x0: number, y0: number, gw: number, gh: number, ignoreId = 0): void {
    const target = this.lotGround(x0, y0, gw, gh, ignoreId);
    for (let vy = y0; vy <= y0 + gh; vy++)
      for (let vx = x0; vx <= x0 + gw; vx++) {
        if (this.lotVertexPinned(w, vx, vy, x0, y0, gw, gh, ignoreId)) continue;
        if (Math.abs(w.vertexHeight(vx, vy) - target) > 0.01) tx.setVertex(vx, vy, target);
      }
  }

  /** Validate placement of a catalog building with its footprint centered near (x,y). */
  checkBuilding(defId: string, x: number, y: number, rot: Dir, opts: { ignoreId?: number; free?: boolean } = {}): BuildingCheck {
    const w = this.world;
    const def = buildingDef(defId);
    const fp = def ? footprintAt(def, x, y, rot) : { x, y, w: 1, h: 1 };
    const res: BuildingCheck = {
      ok: false, cost: def && !opts.free ? def.cost : 0, x: fp.x, y: fp.y, w: fp.w, h: fp.h, rot,
      replaces: [], blocked: [], ground: 0, frontage: false, siteOk: false, affordable: true,
    };
    if (!w) return { ...res, reason: 'No city loaded' };
    if (!def) return { ...res, reason: 'Unknown building' };
    const ignoreId = opts.ignoreId ?? 0;
    const pl = def.placement ?? {};
    const reasons: string[] = [];
    const add = (why: string) => {
      if (!reasons.includes(why)) reasons.push(why);
    };
    // bounds
    if (fp.x < 0 || fp.y < 0 || fp.x + fp.w > w.size || fp.y + fp.h > w.size) {
      for (let yy = fp.y; yy < fp.y + fp.h; yy++) for (let xx = fp.x; xx < fp.x + fp.w; xx++) if (!w.inBounds(xx, yy)) res.blocked.push({ x: xx, y: yy });
      return { ...res, reason: 'Outside the map' };
    }
    if (!ignoreId && !w.isUnlocked(def.unlock, def.id)) add(`Unlocks at ${milestoneLabel(def.unlock)}`);
    if (pl.unique) for (const b of w.buildings.values()) if (b.defId === def.id && b.id !== ignoreId) { add(`Only one ${def.name} allowed`); break; }

    const maxSlope = pl.maxSlope ?? MAX_LOT_SLOPE;
    const replaces = new Set<number>();
    let wetCells = 0, resSum = 0;
    for (let yy = fp.y; yy < fp.y + fp.h; yy++)
      for (let xx = fp.x; xx < fp.x + fp.w; xx++) {
        const i = w.idx(xx, yy);
        let blocked = false;
        if (w.road[i]) { add('Blocked by a road'); blocked = true; }
        const bid = w.bldg[i];
        if (bid && bid !== ignoreId) {
          const b = w.buildings.get(bid);
          if (b && b.kind === 'zoned' && !isRubble(b)) replaces.add(bid);
          else if (b && b.kind === 'zoned') replaces.add(bid);
          else { add(`Blocked by ${b ? this.buildingName(b) : 'a building'}`); blocked = true; }
        }
        const wet = w.isWater(xx, yy);
        if (wet) wetCells++;
        if (pl.onWater ? !wet : wet) { add(pl.onWater ? 'Must be built on water' : 'Cannot build on water'); blocked = true; }
        if (!pl.onWater && w.cellSlope(xx, yy) > maxSlope) { add('Ground is too steep'); blocked = true; }
        if (pl.resource) resSum += w.field(pl.resource, xx, yy);
        if (blocked) res.blocked.push({ x: xx, y: yy });
      }
    if (pl.shore && !pl.onWater) {
      let touches = false;
      for (let yy = fp.y - 1; yy <= fp.y + fp.h && !touches; yy++)
        for (let xx = fp.x - 1; xx <= fp.x + fp.w; xx++) {
          const inside = xx >= fp.x && yy >= fp.y && xx < fp.x + fp.w && yy < fp.y + fp.h;
          const corner = (xx === fp.x - 1 || xx === fp.x + fp.w) && (yy === fp.y - 1 || yy === fp.y + fp.h);
          if (inside || corner) continue;
          if (w.isWater(xx, yy)) { touches = true; break; }
        }
      if (!touches) add('Must touch the shoreline');
    }
    res.frontage = this.sideHasRoad(w, fp.x, fp.y, fp.w, fp.h, rot);
    if (pl.road !== false && !res.frontage) add('Needs a road in front');
    if (pl.rail) {
      let railOk = false;
      for (let d = 0; d < 4; d++) if (this.sideHasRoad(w, fp.x, fp.y, fp.w, fp.h, d as Dir, true)) railOk = true;
      if (!railOk) add('Needs to be next to a railway');
    }
    if (pl.resource) {
      const avg = resSum / (fp.w * fp.h);
      if (avg <= RESOURCE_THRESHOLD) add(`Needs ${RESOURCE_NAMES[pl.resource] ?? pl.resource} here`);
    }
    res.siteOk = reasons.length === 0;
    res.affordable = !!opts.free || w.canAfford(def.cost);
    if (!res.affordable) add(`Not enough money (${formatMoney(def.cost)} needed)`);
    void wetCells;
    res.replaces = [...replaces];
    res.ground = pl.onWater ? Math.max(w.waterLevel(fp.x + (fp.w >> 1), fp.y + (fp.h >> 1)), w.cellHeight(fp.x, fp.y)) : this.lotGround(fp.x, fp.y, fp.w, fp.h, ignoreId);
    res.ok = reasons.length === 0;
    if (reasons.length) res.reason = reasons[0];
    return res;
  }

  placeBuilding(defId: string, x: number, y: number, rot: Dir): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const def = buildingDef(defId);
    if (!def) return fail('Unknown building');
    const c = this.checkBuilding(defId, x, y, rot);
    if (!c.ok) return fail(c.reason ?? 'Cannot build here');
    return this.run(`Build ${def.name}`, (tx, world) => {
      if (!tx.spend(def.cost, 'construction')) return fail('Not enough money');
      for (const id of c.replaces) tx.removeBuilding(id);
      if (!def.placement?.onWater) this.flattenLot(tx, world, c.x, c.y, c.w, c.h);
      const cx = c.x + (c.w >> 1), cy = c.y + (c.h >> 1);
      const dId = world.district[world.idx(cx, cy)];
      const district = dId ? world.districts.find((d) => d.id === dId) : undefined;
      const b = tx.addBuilding({
        kind: 'service', defId: def.id, x: c.x, y: c.y, w: c.w, h: c.h, rot,
        zone: ZoneType.None, level: 1, style: district?.style ?? world.settings.style,
        seed: hash3(c.x, c.y, world.nextBuildingId) & 0x7fffffff,
        built: world.creative ? 1 : 0, jobs: def.jobs ?? 0, efficiency: 1,
      });
      this.afterChange();
      return ok(world.creative ? 0 : def.cost, b.id);
    });
  }

  moveBuilding(id: number, x: number, y: number, rot: Dir): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const b = w.getBuilding(id);
    if (!b) return fail('Building not found');
    if (b.kind !== 'service') return fail('Only service buildings can be moved');
    if (isRubble(b)) return fail('Rubble cannot be moved');
    const c = this.checkBuilding(b.defId, x, y, rot, { ignoreId: id, free: true });
    if (!c.ok) return fail(c.reason ?? 'Cannot move here');
    if (c.x === b.x && c.y === b.y && c.rot === b.rot) return fail('Already there');
    const def = buildingDef(b.defId);
    return this.run(`Move ${this.buildingName(b)}`, (tx, world) => {
      const live = world.getBuilding(id)!;
      const moved: Building = { ...structuredClone(live), x: c.x, y: c.y, w: c.w, h: c.h, rot };
      tx.removeBuilding(id);
      for (const rid of c.replaces) tx.removeBuilding(rid);
      if (!def?.placement?.onWater) this.flattenLot(tx, world, c.x, c.y, c.w, c.h);
      tx.restoreBuilding(moved);
      this.afterChange();
      return ok(0, id);
    });
  }

  /** refund amount for bulldozing a building now (negative = rubble clearing cost) */
  refundFor(id: number): number {
    const w = this.world;
    const b = w?.getBuilding(id);
    if (!w || !b) return 0;
    if (isRubble(b)) return -RUBBLE_COST_PER_CELL * b.w * b.h;
    if (b.kind === 'zoned') return 0;
    const def = buildingDef(b.defId);
    if (!def) return 0;
    const fresh = b.built < 1 || (b.flags & BFlag.UnderConstruction) !== 0 || b.age < 1;
    return Math.round(def.cost * (fresh ? 0.75 : 0.2));
  }

  bulldozeBuilding(id: number): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const b = w.getBuilding(id);
    if (!b) return fail('Building not found');
    const refund = this.refundFor(id);
    if (refund < 0 && !w.canAfford(-refund)) return fail(`Not enough money to clear the rubble (${formatMoney(-refund)})`);
    const label = isRubble(b) ? 'Clear rubble' : `Demolish ${this.buildingName(b)}`;
    return this.run(label, (tx) => {
      if (refund < 0 && !tx.spend(-refund, 'construction')) return fail('Not enough money');
      tx.removeBuilding(id);
      if (refund > 0) tx.earn(refund, 'refunds');
      if (b.kind === 'service') this.afterChange();
      return ok(-refund);
    });
  }

  /** Disaster/fire/abandonment destruction: no refund, no undo; leaves rubble (BFlag.Collapsed). */
  destroyBuilding(id: number, cause: DestroyCause): void {
    const w = this.world;
    const b = w?.getBuilding(id);
    if (!w || !b) return;
    b.flags |= BFlag.Collapsed;
    if (cause === 'fire') b.flags |= BFlag.Burned;
    if (cause === 'flood') b.flags |= BFlag.Flooded;
    b.flags &= ~(BFlag.OnFire | BFlag.UnderConstruction | BFlag.Upgrading | BFlag.Powered | BFlag.Watered | BFlag.Sewered);
    b.fire = 0;
    b.residents = 0;
    b.maxResidents = 0;
    b.jobs = 0;
    b.workers = 0;
    b.visitors = 0;
    b.goods = 0;
    b.efficiency = 0;
    w.touchBuilding(b);
    // disasters are permanent: history that could resurrect/refund it is dropped
    this.history.forgetBuilding(id);
    this.tx?.forgetBuilding(id);
    this.emitHistory();
    if (b.kind === 'service') this.afterChange();
  }

  /** What a bulldoze of rect `r` with filter would remove (for previews / confirmation). */
  previewBulldoze(r: Rect, what: BulldozeFilter): BulldozePreview {
    const w = this.world;
    const out: BulldozePreview = { buildings: [], roads: [], zones: [], trees: [], refund: 0, clearing: 0, valueLost: 0 };
    if (!w) return out;
    const ids = new Set<number>();
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    w.forEachCellInRect({ x0, y0, x1, y1 }, (x, y, i) => {
      if (what.buildings && w.bldg[i]) ids.add(w.bldg[i]);
      if (what.roads && w.road[i]) {
        out.roads.push({ x, y });
        out.valueLost += roadDef(w.road[i] as RoadType).cost * (w.isBridge(x, y) ? BRIDGE_COST_MULT : 1);
      }
      if (what.zones && w.zone[i]) out.zones.push({ x, y });
      if (what.trees && w.trees[i] && !w.bldg[i] && !w.road[i]) out.trees.push({ x, y });
    });
    for (const id of ids) {
      const b = w.buildings.get(id);
      if (!b) continue;
      out.buildings.push(id);
      const rf = this.refundFor(id);
      if (rf >= 0) out.refund += rf;
      else out.clearing += -rf;
      if (isRubble(b)) continue;
      if (b.kind === 'service') out.valueLost += Math.max(0, (buildingDef(b.defId)?.cost ?? 0) - rf);
      else out.valueLost += b.w * b.h * ZONED_VALUE_PER_CELL * b.level;
    }
    if (what.zones) {
      // zoned buildings standing on dezoned cells are demolished too
      for (const c of out.zones) {
        const b = w.buildingAt(c.x, c.y);
        if (b && b.kind === 'zoned' && !ids.has(b.id)) {
          ids.add(b.id);
          out.buildings.push(b.id);
          if (!isRubble(b)) out.valueLost += b.w * b.h * ZONED_VALUE_PER_CELL * b.level;
        }
      }
    }
    return out;
  }

  bulldozeRect(r: Rect, what: BulldozeFilter): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const p = this.previewBulldoze(r, what);
    if (!p.buildings.length && !p.roads.length && !p.zones.length && !p.trees.length) return fail('Nothing to bulldoze here');
    if (p.clearing > 0 && !w.canAfford(p.clearing)) return fail(`Not enough money to clear rubble (${formatMoney(p.clearing)})`);
    const parts: string[] = [];
    if (p.buildings.length) parts.push(p.buildings.length === 1 ? this.buildingName(w.buildings.get(p.buildings[0])!) : `${p.buildings.length} buildings`);
    if (p.roads.length) parts.push(p.roads.length === 1 ? 'road' : `${p.roads.length} road cells`);
    if (!parts.length && p.zones.length) parts.push('zoning');
    if (!parts.length && p.trees.length) parts.push('trees');
    const label = what.zones && !what.buildings && !what.roads ? 'Dezone' : `Bulldoze ${parts.join(' & ')}`;
    return this.run(label, (tx, world) => {
      if (p.clearing > 0 && !tx.spend(p.clearing, 'construction')) return fail('Not enough money');
      for (const id of p.buildings) if (world.buildings.has(id)) tx.removeBuilding(id);
      for (const c of p.roads) tx.setRoad(c.x, c.y, RoadType.None);
      for (const c of p.zones) tx.setZone(c.x, c.y, ZoneType.None);
      for (const c of p.trees) tx.setTrees(c.x, c.y, 0);
      if (p.refund > 0) tx.earn(p.refund, 'refunds');
      if (p.roads.length || p.buildings.length) this.afterChange();
      return ok(p.clearing - p.refund);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Terrain & trees
  // ════════════════════════════════════════════════════════════════════════

  /** vertex touches a road or building cell (terraforming leaves it alone) */
  private terraformLocked(w: World, vx: number, vy: number): boolean {
    for (let cy = vy - 1; cy <= vy; cy++)
      for (let cx = vx - 1; cx <= vx; cx++) {
        if (!w.inBounds(cx, cy)) continue;
        const i = w.idx(cx, cy);
        if (w.road[i] || w.bldg[i]) return true;
      }
    return false;
  }

  /** Estimated cost ($) of one terraform application (no mutation). */
  terraformCost(wx: number, wz: number, radius: number, mode: TerraformMode, strength: number, target?: number): number {
    const r = this.computeTerraform(wx, wz, radius, mode, strength, target);
    return r ? r.cost : 0;
  }

  private computeTerraform(wx: number, wz: number, radius: number, mode: TerraformMode, strength: number, target?: number): { verts: number[]; heights: number[]; cost: number } | null {
    const w = this.world;
    if (!w || radius <= 0 || strength <= 0) return null;
    const s1 = w.size + 1;
    const vx0 = Math.max(0, Math.floor((wx - radius) / CELL)), vx1 = Math.min(w.size, Math.ceil((wx + radius) / CELL));
    const vy0 = Math.max(0, Math.floor((wz - radius) / CELL)), vy1 = Math.min(w.size, Math.ceil((wz + radius) / CELL));
    const list: { v: number; f: number; vx: number; vy: number }[] = [];
    let avgS = 0, avgW = 0;
    for (let vy = vy0; vy <= vy1; vy++)
      for (let vx = vx0; vx <= vx1; vx++) {
        const dx = vx * CELL - wx, dz = vy * CELL - wz;
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const t = d / radius;
        const f = 0.5 + 0.5 * Math.cos(Math.PI * t); // smooth falloff
        const v = vy * s1 + vx;
        avgS += w.heights[v] * f;
        avgW += f;
        if (this.terraformLocked(w, vx, vy)) continue;
        list.push({ v, f, vx, vy });
      }
    if (!list.length) return null;
    // flatten: toward `target` (the stroke's start height) or the brush average;
    // level: toward `target` or just above sea level (waterfront land)
    const flat = target ?? (avgW ? avgS / avgW : 0);
    const lvl = target ?? w.seaLevel + LEVEL_ABOVE_SEA;
    const verts: number[] = [];
    const heights: number[] = [];
    let volume = 0;
    for (const { v, f, vx, vy } of list) {
      const h = w.heights[v];
      let nh = h;
      switch (mode) {
        case 'raise':
          nh = h + strength * f;
          break;
        case 'lower':
          nh = h - strength * f;
          break;
        case 'smooth': {
          let s = 0, c = 0;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const nx = vx + ox, ny = vy + oy;
              if (nx < 0 || ny < 0 || nx > w.size || ny > w.size) continue;
              const wgt = ox === 0 && oy === 0 ? 2 : ox === 0 || oy === 0 ? 1 : 0.7;
              s += w.heights[ny * s1 + nx] * wgt;
              c += wgt;
            }
          const k = 1 - Math.exp(-strength * f * 0.6);
          nh = h + (s / c - h) * k;
          break;
        }
        case 'flatten': {
          const k = 1 - Math.exp(-strength * f * 0.6);
          nh = h + (flat - h) * k;
          break;
        }
        case 'level': {
          const k = 1 - Math.exp(-strength * Math.min(1, f * 1.6) * 1.2);
          nh = h + (lvl - h) * k;
          break;
        }
      }
      nh = clamp(nh, MIN_HEIGHT, MAX_HEIGHT);
      if (Math.abs(nh - h) < 1e-4) continue;
      volume += Math.abs(nh - h) * CELL * CELL;
      verts.push(v);
      heights.push(nh);
    }
    if (!verts.length) return null;
    return { verts, heights, cost: Math.round(volume * TERRAFORM_COST_PER_M3 * 100) / 100 };
  }

  /** wx, wz in world meters; radius meters; strength m per application */
  terraform(wx: number, wz: number, radius: number, mode: TerraformMode, strength: number, target?: number): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const r = this.computeTerraform(wx, wz, radius, mode, strength, target);
    if (!r) return fail('Nothing to change here');
    if (!w.canAfford(r.cost)) return fail(`Not enough money (${formatMoney(r.cost)})`);
    const label = { raise: 'Raise terrain', lower: 'Lower terrain', smooth: 'Smooth terrain', flatten: 'Flatten terrain', level: 'Level terrain' }[mode];
    return this.run(label, (tx, world) => {
      if (!tx.spend(r.cost, 'landscaping')) return fail('Not enough money');
      const s1 = world.size + 1;
      for (let k = 0; k < r.verts.length; k++) tx.setVertex(r.verts[k] % s1, (r.verts[k] / s1) | 0, r.heights[k]);
      return ok(world.creative ? 0 : r.cost);
    });
  }

  /** cells a tree brush touches with their new density (no mutation) */
  treeBrush(x: number, y: number, radiusCells: number, density: number): { x: number; y: number; d: number; old: number }[] {
    const w = this.world;
    const out: { x: number; y: number; d: number; old: number }[] = [];
    if (!w) return out;
    const dens = clamp(Math.round(density), 0, 3);
    const r = Math.max(0.5, radiusCells);
    const R = Math.ceil(r);
    for (let yy = y - R; yy <= y + R; yy++)
      for (let xx = x - R; xx <= x + R; xx++) {
        if (!w.inBounds(xx, yy)) continue;
        const dist = Math.hypot(xx - x, yy - y);
        if (dist > r + 0.25) continue;
        const i = w.idx(xx, yy);
        if (w.road[i] || w.bldg[i] || w.isWater(xx, yy)) continue;
        const old = w.trees[i];
        let d: number;
        if (!dens) d = 0;
        else {
          const t = 1 - dist / (r + 0.5);
          const edge = clamp(t / 0.45, 0, 1);
          const jitter = (hashFloat(xx, yy, 0x7ee5) - 0.5) * 1.1;
          d = clamp(Math.round(dens * edge + jitter * (1 - edge * 0.6)), 0, dens);
          d = Math.max(old, d);
        }
        if (d !== old) out.push({ x: xx, y: yy, d, old });
      }
    return out;
  }

  /** planting cost of a treeBrush() result (removal is free) */
  treeBrushCost(cells: { d: number; old: number }[]): number {
    let cost = 0;
    for (const c of cells) cost += Math.max(0, c.d - c.old) * TREE_COST;
    return cost;
  }

  plantTrees(x: number, y: number, radiusCells: number, density: number): ActionResult {
    const w = this.world;
    if (!w) return fail('No city loaded');
    const cells = this.treeBrush(x, y, radiusCells, density);
    if (!cells.length) return fail(density > 0 ? 'No room for more trees here' : 'No trees here');
    const cost = this.treeBrushCost(cells);
    if (!w.canAfford(cost)) return fail(`Not enough money (${formatMoney(cost)})`);
    return this.run(density > 0 ? 'Plant trees' : 'Remove trees', (tx, world) => {
      if (!tx.spend(cost, 'landscaping')) return fail('Not enough money');
      for (const c of cells) tx.setTrees(c.x, c.y, c.d);
      return ok(world.creative ? 0 : cost);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Districts
  // ════════════════════════════════════════════════════════════════════════

  private districtName(w: World): string {
    const used = new Set(w.districts.map((d) => d.name));
    const base = (w.settings.seed >>> 0) ^ 0x2545f491;
    for (let attempt = 0; attempt < 400; attempt++) {
      const h = hash3(base, w.districts.length, attempt);
      let name: string;
      if (h % 5 < 2) name = DISTRICT_WHOLE[(h >>> 3) % DISTRICT_WHOLE.length];
      else {
        const p = DISTRICT_PREFIX[(h >>> 3) % DISTRICT_PREFIX.length];
        const s = DISTRICT_SUFFIX[(h >>> 11) % DISTRICT_SUFFIX.length];
        if (p === s) continue;
        name = `${p} ${s}`;
      }
      if (!used.has(name)) return name;
    }
    return `District ${w.districts.length + 1}`;
  }

  private districtColor(w: World): string {
    const hues = w.districts.map((d) => hexHue(d.color));
    const off = hashFloat(w.settings.seed, w.districts.length) * 360;
    let best = 0, bestScore = -1;
    for (let k = 0; k < 48; k++) {
      const hue = (off + k * 137.508) % 360;
      let score = 180;
      for (const u of hues) {
        const dd = Math.abs(hue - u);
        score = Math.min(score, Math.min(dd, 360 - dd));
      }
      // avoid muddy yellow-greens next to the zone colours
      if (hue > 55 && hue < 95) score *= 0.7;
      if (score > bestScore) {
        bestScore = score;
        best = hue;
      }
      if (!hues.length) break;
    }
    const sat = 68 + ((w.districts.length * 7) % 12);
    const light = 58 + ((w.districts.length * 5) % 8);
    return hslToHex(best, sat, light);
  }

  createDistrict(name?: string): District {
    const w = this.world;
    if (!w) throw new Error('No city loaded');
    const used = new Set(w.districts.map((d) => d.id));
    let id = 0;
    for (let i = 1; i <= 255; i++)
      if (!used.has(i)) {
        id = i;
        break;
      }
    if (!id) throw new Error('Too many districts (max 255)');
    const d: District = { id, name: name?.trim() || this.districtName(w), color: this.districtColor(w), style: null, policies: [] };
    this.run(`Create ${d.name}`, (tx, world) => {
      tx.touchDistricts();
      world.districts.push(d);
    });
    return d;
  }

  /** rename / recolour / restyle a district (undoable) */
  updateDistrict(id: number, patch: Partial<Omit<District, 'id'>>): boolean {
    const w = this.world;
    if (!w) return false;
    const d = w.districts.find((q) => q.id === id);
    if (!d) return false;
    this.run(`Edit ${d.name}`, (tx, world) => {
      tx.touchDistricts();
      const live = world.districts.find((q) => q.id === id)!;
      Object.assign(live, patch);
      world.markDirty({ x0: 0, y0: 0, x1: world.size - 1, y1: world.size - 1 }, 1 << 6);
    });
    return true;
  }

  deleteDistrict(id: number): void {
    const w = this.world;
    if (!w) return;
    const d = w.districts.find((q) => q.id === id);
    if (!d) return;
    this.run(`Delete ${d.name}`, (tx, world) => {
      tx.touchDistricts();
      world.districts = world.districts.filter((q) => q.id !== id);
      const arr = world.district;
      for (let i = 0; i < arr.length; i++) if (arr[i] === id) tx.setDistrict(i % world.size, (i / world.size) | 0, 0);
    });
  }

  paintDistrict(cells: Cell[], id: number): void {
    const w = this.world;
    if (!w) return;
    if (id !== 0 && !w.districts.some((d) => d.id === id)) return;
    const todo = cells.filter((c) => w.inBounds(c.x, c.y) && w.district[w.idx(c.x, c.y)] !== id);
    if (!todo.length) return;
    const name = id ? w.districts.find((d) => d.id === id)!.name : '';
    this.run(id ? `Paint ${name}` : 'Erase district', (tx) => {
      for (const c of todo) tx.setDistrict(c.x, c.y, id);
    });
  }
}
