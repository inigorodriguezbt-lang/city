// ─────────────────────────────────────────────────────────────────────────────
// Undo / redo history for WorldActions.
//
// Every player action runs inside a `Transaction`: a thin recorder that wraps
// the World mutators, remembers the value of every cell / vertex the first
// time it is touched, snapshots buildings that are removed, tracks buildings
// that are created, the district list and every money movement. `commit()`
// packs that into a compact `WorldDiff` (typed arrays of touched indices with
// before/after values; no-op entries are dropped).
//
// Undo and redo are the same operation: `revertDiff()` puts the world back to
// a diff's *before* state while itself recording a new transaction. The diff
// it produces is pushed to the opposite stack, so undo→redo→undo round-trips
// are exact even if the simulation changed things in between (e.g. a zoned
// building that grew on a lot is snapshotted when undo removes it, and comes
// back on redo).
//
// Building ids survive undo/redo: removed buildings are re-inserted with their
// original id (ids are never reused because World.nextBuildingId only grows).
// ─────────────────────────────────────────────────────────────────────────────
import { BFlag, Layer, RoadType, ZoneType, type Building, type District, type Rect } from '../core/types';
import type { World } from './World';

export type CellLayer = 'road' | 'roadFlags' | 'zone' | 'trees' | 'district';
export const CELL_LAYERS: readonly CellLayer[] = ['road', 'roadFlags', 'zone', 'trees', 'district'];

export interface PackedCells {
  idx: Int32Array;
  before: Uint8Array;
  after: Uint8Array;
}

export interface PackedVerts {
  idx: Int32Array;
  before: Float32Array;
  after: Float32Array;
}

/** One money movement. amount > 0 adds to the category, < 0 takes back from it. */
export interface MoneyEntry {
  kind: 'expense' | 'income';
  category: string;
  amount: number;
}

export interface WorldDiff {
  /** human readable, e.g. "Build Street" (shown in undo toasts) */
  label: string;
  cells: Partial<Record<CellLayer, PackedCells>>;
  verts: PackedVerts | null;
  /** snapshots (at commit time) of buildings that exist because of this change */
  added: Building[];
  /** snapshots (at removal time) of buildings this change removed */
  removed: Building[];
  districtsBefore: District[] | null;
  districtsAfter: District[] | null;
  money: MoneyEntry[];
  /** in-game day when recorded */
  day: number;
  /** bounding rect of everything touched (cells) */
  rect: Rect;
}

/** Net money change of a diff (negative = the change cost money). */
export function diffNetMoney(d: WorldDiff): number {
  let n = 0;
  for (const m of d.money) n += m.kind === 'income' ? m.amount : -m.amount;
  return n;
}

export function diffIsEmpty(d: WorldDiff): boolean {
  if (d.added.length || d.removed.length || d.money.length) return false;
  if (d.verts && d.verts.idx.length) return false;
  if (d.districtsBefore && JSON.stringify(d.districtsBefore) !== JSON.stringify(d.districtsAfter)) return false;
  for (const l of CELL_LAYERS) if (d.cells[l]?.idx.length) return false;
  return true;
}

/** ids of every building referenced by a diff */
export function diffBuildingIds(d: WorldDiff): Set<number> {
  const s = new Set<number>();
  for (const b of d.added) s.add(b.id);
  for (const b of d.removed) s.add(b.id);
  return s;
}

function cloneBuilding(b: Building): Building {
  return structuredClone(b);
}

/** Apply one money movement directly to the economy (creative mode: no-op). */
export function applyMoney(world: World, e: MoneyEntry): void {
  if (world.creative || !e.amount) return;
  const ec = world.economy;
  const book = e.kind === 'expense' ? ec.monthExpense : ec.monthIncome;
  const cur = book[e.category] ?? 0;
  book[e.category] = Math.max(0, cur + e.amount);
  ec.money += e.kind === 'income' ? e.amount : -e.amount;
  world.bus?.emit('money:changed', ec.money);
}

/**
 * Re-insert a building snapshot with its ORIGINAL id (World.addBuilding always
 * allocates a new id, which would break selections, notices and later history
 * entries). Mirrors World.addBuilding's occupancy bookkeeping.
 */
export function insertBuildingSnapshot(world: World, snap: Building): Building {
  const b = cloneBuilding(snap);
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      if (!world.inBounds(xx, yy)) continue;
      const i = world.idx(xx, yy);
      world.bldg[i] = b.id;
      world.trees[i] = 0;
      if (b.kind === 'service') world.zone[i] = 0;
    }
  world.buildings.set(b.id, b);
  if (world.nextBuildingId <= b.id) world.nextBuildingId = b.id + 1;
  world.markDirty({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, Layer.Building | Layer.Tree | Layer.Zone);
  world.bus?.emit('building:added', b);
  return b;
}

/**
 * Records every mutation made through it. All WorldActions mutations go
 * through a Transaction so they can be undone.
 */
export class Transaction {
  private readonly cellBefore: Record<CellLayer, Map<number, number>> = {
    road: new Map(), roadFlags: new Map(), zone: new Map(), trees: new Map(), district: new Map(),
  };
  private readonly vertBefore = new Map<number, number>();
  /** buildings created by this transaction (live objects, snapshotted at commit) */
  readonly added = new Map<number, Building>();
  /** snapshots of buildings removed by this transaction */
  readonly removed = new Map<number, Building>();
  private districtsBefore: District[] | null = null;
  private moneyLog: MoneyEntry[] = [];
  private rect: Rect = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };

  constructor(readonly world: World, public label: string) {}

  // ── bookkeeping ───────────────────────────────────────────────────────
  private grow(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.rect;
    if (x0 < r.x0) r.x0 = x0;
    if (y0 < r.y0) r.y0 = y0;
    if (x1 > r.x1) r.x1 = x1;
    if (y1 > r.y1) r.y1 = y1;
  }

  private touch(layer: CellLayer, i: number): void {
    const m = this.cellBefore[layer];
    if (!m.has(i)) m.set(i, this.world[layer][i]);
  }

  private touchCellAll(x: number, y: number): void {
    const i = this.world.idx(x, y);
    for (const l of CELL_LAYERS) this.touch(l, i);
    this.grow(x, y, x, y);
  }

  // ── mutators ──────────────────────────────────────────────────────────
  setRoad(x: number, y: number, t: RoadType, flags = 0): void {
    const w = this.world;
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    this.touch('road', i);
    this.touch('roadFlags', i);
    this.touch('zone', i);
    this.touch('trees', i);
    this.grow(x, y, x, y);
    w.setRoad(x, y, t, flags);
  }

  setZone(x: number, y: number, z: ZoneType): void {
    const w = this.world;
    if (!w.inBounds(x, y)) return;
    this.touch('zone', w.idx(x, y));
    this.grow(x, y, x, y);
    w.setZone(x, y, z);
  }

  setTrees(x: number, y: number, d: number): void {
    const w = this.world;
    if (!w.inBounds(x, y)) return;
    this.touch('trees', w.idx(x, y));
    this.grow(x, y, x, y);
    w.setTrees(x, y, d);
  }

  setDistrict(x: number, y: number, id: number): void {
    const w = this.world;
    if (!w.inBounds(x, y)) return;
    this.touch('district', w.idx(x, y));
    this.grow(x, y, x, y);
    w.setDistrict(x, y, id);
  }

  setVertex(vx: number, vy: number, h: number): void {
    const w = this.world;
    const s = w.size;
    if (vx < 0 || vy < 0 || vx > s || vy > s) return;
    const v = vy * (s + 1) + vx;
    if (!this.vertBefore.has(v)) this.vertBefore.set(v, w.heights[v]);
    this.grow(Math.max(0, vx - 1), Math.max(0, vy - 1), Math.min(s - 1, vx), Math.min(s - 1, vy));
    w.setVertexHeight(vx, vy, h);
  }

  /** set road/flags of a cell exactly (used when reverting). */
  private setRoadRaw(x: number, y: number, t: RoadType, flags: number): void {
    this.setRoad(x, y, t, flags);
  }

  addBuilding(init: Parameters<World['addBuilding']>[0]): Building {
    const w = this.world;
    for (let yy = init.y; yy < init.y + init.h; yy++)
      for (let xx = init.x; xx < init.x + init.w; xx++) if (w.inBounds(xx, yy)) this.touchCellAll(xx, yy);
    const b = w.addBuilding(init);
    this.added.set(b.id, b);
    this.grow(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
    return b;
  }

  /** re-insert a snapshot under its original id */
  restoreBuilding(snap: Building): Building {
    const w = this.world;
    for (let yy = snap.y; yy < snap.y + snap.h; yy++)
      for (let xx = snap.x; xx < snap.x + snap.w; xx++) if (w.inBounds(xx, yy)) this.touchCellAll(xx, yy);
    const b = insertBuildingSnapshot(w, snap);
    this.added.set(b.id, b);
    this.grow(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
    return b;
  }

  removeBuilding(id: number): Building | undefined {
    const w = this.world;
    const b = w.buildings.get(id);
    if (!b) return undefined;
    if (this.added.has(id)) {
      // created (or re-inserted) inside this transaction: the net effect is
      // "never existed" unless an earlier state was already snapshotted.
      this.added.delete(id);
    } else if (!this.removed.has(id)) {
      this.removed.set(id, cloneBuilding(b));
    }
    this.grow(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
    return w.removeBuilding(id);
  }

  /** the district list is about to change */
  touchDistricts(): void {
    if (!this.districtsBefore) this.districtsBefore = structuredClone(this.world.districts);
  }

  // ── money ─────────────────────────────────────────────────────────────
  private log(kind: 'expense' | 'income', category: string, amount: number): void {
    if (!amount) return;
    const e = this.moneyLog.find((m) => m.kind === kind && m.category === category && Math.sign(m.amount) === Math.sign(amount));
    if (e) e.amount += amount;
    else this.moneyLog.push({ kind, category, amount });
  }

  /** world.spend with bookkeeping; false if unaffordable (nothing spent) */
  spend(amount: number, category: string): boolean {
    if (amount <= 0) return true;
    const w = this.world;
    const before = w.economy.money;
    if (!w.spend(amount, category)) return false;
    this.log('expense', category, before - w.economy.money);
    return true;
  }

  /** world.charge (may go into debt) with bookkeeping */
  charge(amount: number, category: string): void {
    if (amount <= 0) return;
    const w = this.world;
    const before = w.economy.money;
    w.charge(amount, category);
    this.log('expense', category, before - w.economy.money);
  }

  earn(amount: number, category: string): void {
    if (amount <= 0) return;
    const w = this.world;
    const before = w.economy.money;
    w.earn(amount, category);
    this.log('income', category, w.economy.money - before);
  }

  /** apply an arbitrary (possibly negative) money entry, e.g. when reverting */
  applyMoney(e: MoneyEntry): void {
    const w = this.world;
    if (w.creative || !e.amount) return;
    applyMoney(w, e);
    this.log(e.kind, e.category, e.amount);
  }

  /** net money change so far (negative = spent) */
  get net(): number {
    let n = 0;
    for (const m of this.moneyLog) n += m.kind === 'income' ? m.amount : -m.amount;
    return n;
  }

  /** does this transaction reference building id? */
  involves(id: number): boolean {
    return this.added.has(id) || this.removed.has(id);
  }

  /** forget a building that was removed by someone else mid-transaction */
  forgetBuilding(id: number): void {
    this.added.delete(id);
  }

  // ── packing ───────────────────────────────────────────────────────────
  commit(): WorldDiff {
    const w = this.world;
    const cells: Partial<Record<CellLayer, PackedCells>> = {};
    for (const l of CELL_LAYERS) {
      const m = this.cellBefore[l];
      if (!m.size) continue;
      const arr = w[l];
      const keys: number[] = [];
      for (const [i, before] of m) if (arr[i] !== before) keys.push(i);
      if (!keys.length) continue;
      keys.sort((a, b) => a - b);
      const idx = new Int32Array(keys);
      const before = new Uint8Array(keys.length);
      const after = new Uint8Array(keys.length);
      for (let k = 0; k < keys.length; k++) {
        before[k] = m.get(keys[k])!;
        after[k] = arr[keys[k]];
      }
      cells[l] = { idx, before, after };
    }
    let verts: PackedVerts | null = null;
    if (this.vertBefore.size) {
      const keys: number[] = [];
      for (const [v, before] of this.vertBefore) if (Math.abs(w.heights[v] - before) > 1e-5) keys.push(v);
      if (keys.length) {
        keys.sort((a, b) => a - b);
        const idx = new Int32Array(keys);
        const before = new Float32Array(keys.length);
        const after = new Float32Array(keys.length);
        for (let k = 0; k < keys.length; k++) {
          before[k] = this.vertBefore.get(keys[k])!;
          after[k] = w.heights[keys[k]];
        }
        verts = { idx, before, after };
      }
    }
    const added: Building[] = [];
    for (const b of this.added.values()) if (w.buildings.get(b.id) === b) added.push(cloneBuilding(b));
    const removed = [...this.removed.values()];
    return {
      label: this.label,
      cells,
      verts,
      added,
      removed,
      districtsBefore: this.districtsBefore,
      districtsAfter: this.districtsBefore ? structuredClone(w.districts) : null,
      money: this.moneyLog.filter((m) => Math.abs(m.amount) > 1e-6).map((m) => ({ ...m })),
      day: w.time.day,
      rect: { ...this.rect },
    };
  }

  // ── revert ────────────────────────────────────────────────────────────
  /**
   * Put the world back to `d`'s BEFORE state, recording into this transaction.
   * Returns false (and changes nothing) when the money needed is unavailable.
   */
  revert(d: WorldDiff): { ok: boolean; reason?: string } {
    const w = this.world;
    // money first: can we afford giving back a refund?
    let net = 0;
    for (const m of d.money) net += m.kind === 'income' ? -m.amount : m.amount;
    if (net < 0 && !w.canAfford(-net)) return { ok: false, reason: 'Not enough money' };

    // 1. remove buildings the change created (if they still exist)
    for (const a of d.added) if (w.buildings.has(a.id)) this.removeBuilding(a.id);

    // 2. roads (road + flags together, through setRoad so occupancy/zone rules hold)
    const road = d.cells.road, flags = d.cells.roadFlags;
    if (road || flags) {
      const target = new Map<number, [number, number]>();
      const cur = (i: number): [number, number] => target.get(i) ?? [w.road[i], w.roadFlags[i]];
      if (road) for (let k = 0; k < road.idx.length; k++) { const i = road.idx[k]; const c = cur(i); target.set(i, [road.before[k], c[1]]); }
      if (flags) for (let k = 0; k < flags.idx.length; k++) { const i = flags.idx[k]; const c = cur(i); target.set(i, [c[0], flags.before[k]]); }
      for (const [i, [t, f]] of target) {
        const x = i % w.size, y = (i / w.size) | 0;
        // a building that now occupies a cell that becomes road again must go
        if (t !== RoadType.None && w.bldg[i]) {
          const b = w.buildings.get(w.bldg[i]);
          if (b) this.removeBuilding(b.id);
        }
        this.setRoadRaw(x, y, t as RoadType, t ? f : 0);
      }
    }

    // 3. terrain vertices
    if (d.verts) {
      const s1 = w.size + 1;
      for (let k = 0; k < d.verts.idx.length; k++) {
        const v = d.verts.idx[k];
        this.setVertex(v % s1, (v / s1) | 0, d.verts.before[k]);
      }
    }

    // 4. districts list, then per-cell layers
    if (d.districtsBefore) {
      this.touchDistricts();
      w.districts = structuredClone(d.districtsBefore);
    }
    const zone = d.cells.zone;
    if (zone)
      for (let k = 0; k < zone.idx.length; k++) {
        const i = zone.idx[k];
        const x = i % w.size, y = (i / w.size) | 0;
        const z = zone.before[k] as ZoneType;
        // a zoned building that no longer matches its lot's zone is removed
        const b = w.bldg[i] ? w.buildings.get(w.bldg[i]) : undefined;
        if (b && b.kind === 'zoned' && b.zone !== z && !d.added.some((a) => a.id === b.id)) this.removeBuilding(b.id);
        this.setZone(x, y, z);
      }
    const trees = d.cells.trees;
    if (trees) for (let k = 0; k < trees.idx.length; k++) { const i = trees.idx[k]; this.setTrees(i % w.size, (i / w.size) | 0, trees.before[k]); }
    const dist = d.cells.district;
    if (dist) for (let k = 0; k < dist.idx.length; k++) { const i = dist.idx[k]; this.setDistrict(i % w.size, (i / w.size) | 0, dist.before[k]); }

    // 5. re-insert removed buildings (original ids). Buildings that grew on the
    //    footprint since are sim-made zoned buildings: they make way.
    for (const snap of d.removed) {
      if (w.buildings.has(snap.id)) continue;
      let blocked = false;
      const others = new Set<number>();
      for (let yy = snap.y; yy < snap.y + snap.h && !blocked; yy++)
        for (let xx = snap.x; xx < snap.x + snap.w; xx++) {
          if (!w.inBounds(xx, yy)) { blocked = true; break; }
          const i = w.idx(xx, yy);
          if (w.road[i]) { blocked = true; break; }
          const o = w.bldg[i];
          if (o) {
            const ob = w.buildings.get(o);
            if (ob && ob.kind === 'service') { blocked = true; break; }
            others.add(o);
          }
        }
      if (blocked) continue;
      for (const o of others) this.removeBuilding(o);
      this.restoreBuilding(snap);
    }

    // 6. money back
    for (const m of d.money) this.applyMoney({ kind: m.kind, category: m.category, amount: -m.amount });
    return { ok: true };
  }
}

/** Bounded undo/redo stacks. */
export class History {
  readonly limit: number;
  private undoStack: WorldDiff[] = [];
  private redoStack: WorldDiff[] = [];
  constructor(limit = 100) {
    this.limit = limit;
  }
  push(d: WorldDiff): void {
    this.undoStack.push(d);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack.length = 0;
  }
  popUndo(): WorldDiff | undefined {
    return this.undoStack.pop();
  }
  popRedo(): WorldDiff | undefined {
    return this.redoStack.pop();
  }
  pushUndoKeepRedo(d: WorldDiff): void {
    this.undoStack.push(d);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }
  pushRedo(d: WorldDiff): void {
    this.redoStack.push(d);
    if (this.redoStack.length > this.limit) this.redoStack.splice(0, this.redoStack.length - this.limit);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  peekUndo(): WorldDiff | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }
  peekRedo(): WorldDiff | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }
  get undoCount(): number {
    return this.undoStack.length;
  }
  get redoCount(): number {
    return this.redoStack.length;
  }
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
  /** Drop every entry that references a building (destroyed by a disaster or
   *  removed by another system): its change becomes permanent. */
  forgetBuilding(id: number): void {
    const keep = (d: WorldDiff) => !d.added.some((b) => b.id === id) && !d.removed.some((b) => b.id === id);
    this.undoStack = this.undoStack.filter(keep);
    this.redoStack = this.redoStack.filter(keep);
  }
}

/** building is rubble (collapsed/burned) */
export function isRubble(b: Building): boolean {
  return (b.flags & (BFlag.Collapsed | BFlag.Burned)) !== 0;
}
