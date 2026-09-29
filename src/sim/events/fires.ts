// Building and forest fires.
//
// Buildings: a daily ignition roll per building (fire coverage, density and
// level, heat/drought via fireRiskMult, smoke-detector policy, abandonment).
// A burning building's intensity grows and is beaten back by fire coverage,
// rain and — once it arrives — a fire truck dispatched from the nearest
// station. Burning long enough destroys it (rubble via actions.destroyBuilding).
// Fire jumps to neighbouring buildings and trees, helped by the wind.
// Forests: burning tree cells spread downwind through dense woods, get
// knocked down by rain and fire helicopters, and leave the cells treeless.
import { BFlag, type Building } from '../../core/types';
import type { RNG } from '../../core/rng';
import { buildingDef } from '../../data/buildings';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { centerOf, standing, type Preparedness } from './places';

/** per-building fire state kept in `b.ext.evFire` (persisted with the building) */
interface FireExt {
  /** accumulated burn damage (≥ threshold → burns down) */
  burn: number;
  /** in-game day a fire truck reaches the scene (−1: none on the way) */
  truckAt: number;
  /** next day a dispatch may be retried */
  retry: number;
}

const MAX_TREE_FIRES = 500;
/** accumulated intensity × days after which a building burns down */
const BURN_DOWN = 6;
const TREE_NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

export interface FireHooks {
  /** a building was destroyed by fire */
  onBurnedDown?(b: Building): void;
  /** a building fire was put out */
  onExtinguished?(b: Building): void;
}

export class FireManager {
  /** ids of burning buildings */
  readonly burning = new Set<number>();
  /** burning tree cells: cell index → remaining burn time (days) */
  readonly trees = new Map<number, number>();
  /** tree cells changed since the last save sync */
  treesDirty = false;
  private readonly spreadTmp: number[] = [];

  constructor(private readonly game: Game, private readonly prep: Preparedness, private readonly hooks: FireHooks = {}) {}

  attach(world: World, treeFires: number[]): void {
    this.burning.clear();
    this.trees.clear();
    for (const b of world.buildings.values()) if (b.flags & BFlag.OnFire) this.burning.add(b.id);
    for (let i = 0; i + 1 < treeFires.length; i += 2) this.trees.set(treeFires[i], treeFires[i + 1]);
  }

  detach(): void {
    this.burning.clear();
    this.trees.clear();
  }

  /** flattened [idx, left, …] for world.ext */
  serializeTrees(): number[] {
    const out: number[] = [];
    for (const [i, v] of this.trees) out.push(i, Math.round(v * 1000) / 1000);
    return out;
  }

  /** set a building on fire; false if it cannot burn */
  ignite(world: World, b: Building, intensity = 0.3): boolean {
    if (!standing(b) || b.flags & BFlag.OnFire) return false;
    const d = b.kind === 'service' ? buildingDef(b.defId) : undefined;
    if (d && (d.category === 'parks' || d.category === 'plazas')) return false;
    b.flags |= BFlag.OnFire;
    b.fire = Math.max(b.fire || 0, intensity);
    const ext = (b.ext ??= {});
    ext.evFire = { burn: 0, truckAt: -1, retry: world.time.day } satisfies FireExt;
    this.burning.add(b.id);
    world.touchBuilding(b);
    this.dispatch(world, b);
    return true;
  }

  /** ignite a forest cell; false if no trees / at capacity */
  igniteTree(world: World, x: number, y: number): boolean {
    if (!world.inBounds(x, y)) return false;
    const i = world.idx(x, y);
    const t = world.trees[i];
    if (!t || this.trees.has(i) || this.trees.size >= MAX_TREE_FIRES) return false;
    this.trees.set(i, 2.4 + t * 0.8);
    this.treesDirty = true;
    return true;
  }

  /** chance a building catches fire today */
  private dailyChance(world: World, b: Building, risk: number, detectors: (b: Building) => boolean): number {
    if (!standing(b) || b.flags & BFlag.OnFire) return 0;
    let base: number;
    if (b.kind === 'service') {
      const d = buildingDef(b.defId);
      if (!d || d.category === 'parks' || d.category === 'plazas' || d.category === 'water') return 0;
      base = d.category === 'power' || d.category === 'industry' || d.category === 'garbage' ? 0.02 : 0.008;
    } else {
      // denser, older and bigger lots burn more; high levels have sprinklers
      base = 0.012 * (1 + 0.15 * (b.w * b.h - 1)) * (b.level >= 4 ? 0.7 : 1);
    }
    const c = centerOf(b);
    const cov = world.field('fire', c.x, c.y) / 255;
    let p = (base / 360) * (1 - 0.93 * Math.min(1, cov * 1.15)) * risk;
    if (b.flags & BFlag.Abandoned) p *= 3.5;
    if (!(b.flags & BFlag.Powered) && b.kind === 'zoned') p *= 1.15; // candles & generators
    if (detectors(b)) p *= 0.55;
    return p;
  }

  /** daily random ignitions; returns the buildings that caught fire */
  daily(world: World, rng: RNG, risk: number): Building[] {
    const started: Building[] = [];
    if (world.time.day < 20 || world.buildings.size === 0) return started;
    const sim = this.game.sim;
    const detectors = (b: Building) => {
      try {
        return sim.isPolicyActive('smoke_detectors', world.district[world.idx(b.x, b.y)] || undefined);
      } catch {
        return false;
      }
    };
    for (const b of world.buildings.values()) {
      const p = this.dailyChance(world, b, risk, detectors);
      if (p > 0 && rng.next() < p) {
        if (this.ignite(world, b)) started.push(b);
        if (started.length >= 3) break;
      }
    }
    return started;
  }

  /** advance all fires by dtDays of game time */
  update(world: World, rng: RNG, dtDays: number, risk: number, wet: number, windX: number, windY: number): void {
    if (dtDays <= 0) return;
    // ── buildings ───────────────────────────────────────────────────────
    for (const id of this.burning) {
      const b = world.getBuilding(id);
      if (!b || !(b.flags & BFlag.OnFire)) {
        this.burning.delete(id);
        continue;
      }
      const ext = ((b.ext ??= {}).evFire ??= { burn: 0, truckAt: -1, retry: world.time.day }) as FireExt;
      const c = centerOf(b);
      const cov = world.field('fire', c.x, c.y) / 255;
      const day = world.time.day;
      if (ext.truckAt < 0 && day >= ext.retry) this.dispatch(world, b);
      const truck = ext.truckAt >= 0 && day >= ext.truckAt;
      const heli = this.prep.heliCover(c.x, c.y);
      const growth = 0.2 * Math.min(2.2, Math.max(0.4, risk)) * (1 - 0.6 * wet);
      const suppress = 0.04 + cov * 0.36 + (truck ? 0.85 : 0) + heli * 0.25 + wet * 0.25;
      b.fire = Math.max(0, Math.min(1, b.fire + (growth * (1 - 0.35 * b.fire) - suppress * (0.4 + 0.6 * b.fire)) * dtDays));
      ext.burn += b.fire * dtDays * (b.kind === 'service' ? 0.75 : 1.0 - 0.06 * b.level);
      if (b.fire <= 0.001) {
        this.putOut(world, b);
        continue;
      }
      if (ext.burn >= BURN_DOWN) {
        this.burnDown(world, b);
        continue;
      }
      // spread to neighbours
      const pDay = 0.12 * b.fire * Math.min(2, risk) * (1 - 0.7 * wet);
      if (rng.next() < 1 - Math.exp(-pDay * dtDays)) this.spreadFrom(world, rng, b, windX, windY);
    }
    // ── forests ─────────────────────────────────────────────────────────
    if (!this.trees.size) return;
    const s = world.size;
    const spread = this.spreadTmp;
    spread.length = 0;
    const wl = Math.hypot(windX, windY) || 1;
    const wx = windX / wl, wy = windY / wl, windK = Math.min(1.5, wl / 8);
    for (const [i, left0] of this.trees) {
      const x = i % s, y = (i / s) | 0;
      const cov = world.fields.fire[i] / 255;
      const heli = this.prep.heliCover(x, y);
      const left = left0 - dtDays * (1 + wet * 2.5 + heli * 1.6 + cov * 0.4);
      if (left <= 0) {
        this.trees.delete(i);
        world.setTrees(x, y, 0);
        this.treesDirty = true;
        continue;
      }
      this.trees.set(i, left);
      const dens = world.trees[i] / 3;
      const pBase = 0.16 * Math.min(2, risk) * (1 - 0.85 * wet) * (1 - 0.7 * heli) * (1 - 0.35 * cov) * (0.4 + 0.6 * dens);
      for (const [dx, dy] of TREE_NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const ni = ny * s + nx;
        const dl = Math.hypot(dx, dy);
        const down = (dx * wx + dy * wy) / dl;
        const pd = pBase * (world.trees[ni] / 3) * (0.55 + windK * Math.max(-0.4, down)) / dl;
        if (pd > 0 && rng.next() < 1 - Math.exp(-pd * dtDays)) spread.push(nx, ny);
      }
      // nearby buildings catch sparks
      if (rng.next() < 1 - Math.exp(-0.06 * (1 - 0.8 * cov) * dtDays)) {
        const [dx, dy] = TREE_NEIGHBOURS[(rng.next() * 8) | 0];
        const nb = world.buildingAt(x + dx, y + dy);
        if (nb) this.ignite(world, nb, 0.25);
      }
    }
    for (let k = 0; k < spread.length; k += 2) this.igniteTree(world, spread[k], spread[k + 1]);
  }

  /** burning tree cells with a 0..1 intensity (for visuals) */
  treeIntensities(out: Map<number, number>): void {
    out.clear();
    for (const [i, left] of this.trees) out.set(i, Math.min(1, left * 0.6));
  }

  /** put out every fire (building fires and forest fires) */
  extinguishAll(world: World): void {
    for (const id of [...this.burning]) {
      const b = world.getBuilding(id);
      if (b) this.putOut(world, b);
    }
    this.trees.clear();
    this.treesDirty = true;
  }

  private putOut(world: World, b: Building): void {
    b.flags &= ~BFlag.OnFire;
    b.fire = 0;
    if (b.ext) delete b.ext.evFire;
    this.burning.delete(b.id);
    world.touchBuilding(b);
    this.hooks.onExtinguished?.(b);
  }

  private burnDown(world: World, b: Building): void {
    this.burning.delete(b.id);
    if (b.ext) delete b.ext.evFire;
    try {
      this.game.actions.destroyBuilding(b.id, 'fire');
    } catch (err) {
      console.warn('[events] destroyBuilding failed', err);
      b.flags = (b.flags & ~BFlag.OnFire) | BFlag.Burned | BFlag.Collapsed;
      b.fire = 0;
      world.touchBuilding(b);
    }
    this.hooks.onBurnedDown?.(b);
  }

  private spreadFrom(world: World, rng: RNG, b: Building, windX: number, windY: number): void {
    // candidate cells on the ring around the footprint, weighted downwind
    const cand: [number, number][] = [];
    const w: number[] = [];
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const wl = Math.hypot(windX, windY) || 1;
    for (let y = b.y - 1; y <= b.y + b.h; y++)
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
        if (!world.inBounds(x, y)) continue;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const dl = Math.hypot(dx, dy) || 1;
        const down = (dx * windX + dy * windY) / (dl * wl);
        cand.push([x, y]);
        w.push(Math.max(0.15, 1 + down));
      }
    if (!cand.length) return;
    const [x, y] = rng.weighted(cand, w);
    const nb = world.buildingAt(x, y);
    if (nb && nb.id !== b.id) {
      const cov = world.field('fire', x, y) / 255;
      if (rng.next() > cov * 0.75) this.ignite(world, nb, 0.2);
    } else if (world.trees[world.idx(x, y)]) this.igniteTree(world, x, y);
  }

  /** send a fire truck from the nearest capable station */
  private dispatch(world: World, b: Building): void {
    const ext = (b.ext?.evFire as FireExt | undefined);
    if (!ext) return;
    const c = centerOf(b);
    const st = this.prep.nearestStation(c.x, c.y);
    ext.retry = world.time.day + 1;
    if (!st) return;
    let ok = false;
    try {
      ok = this.game.traffic.dispatch('firetruck', st.id, { x: c.x, y: c.y });
    } catch {
      ok = false;
    }
    if (ok) ext.truckAt = world.time.day + 0.8 + st.dist * 0.35;
  }
}
