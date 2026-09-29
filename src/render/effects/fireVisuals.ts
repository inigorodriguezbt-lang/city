// Fire & smoke on burning buildings and burning forest cells, driven by the
// simulation state (BFlag.OnFire + b.fire, EventSystem.burningTrees()).
// Burned-out ruins keep smouldering for a while.
import { CELL } from '../../core/constants';
import { BFlag, type Building } from '../../core/types';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { EffectsRenderer } from './EffectsRenderer';
import { Clock } from './particles';

interface BurningBuilding {
  ids: number[];
  /** base rates per emitter */
  base: number[];
}

interface Smoulder {
  id: number;
  /** sim seconds left */
  left: number;
  total: number;
}

export class FireVisuals {
  private burning = new Map<number, BurningBuilding>();
  private smoulder = new Map<number, Smoulder>();
  private trees = new Map<number, number>();
  private treeTimer = 0;

  constructor(private readonly fx: EffectsRenderer, private readonly game: Game) {}

  /** scan a freshly loaded world */
  attach(world: World): void {
    for (const b of world.buildings.values()) if (b.flags & BFlag.OnFire) this.ignite(b);
  }

  onChanged(b: Building): void {
    const on = (b.flags & BFlag.OnFire) !== 0;
    const has = this.burning.has(b.id);
    if (on && !has) this.ignite(b);
    else if (!on && has) {
      this.extinguish(b.id);
      // burned down → smouldering ruin; put out → a short puff of steam/smoke
      const top = this.top(b);
      const cx = (b.x + b.w / 2) * CELL, cz = (b.y + b.h / 2) * CELL;
      const ground = this.fx.ground(cx, cz);
      const size = Math.sqrt(b.w * b.h);
      if (b.flags & (BFlag.Burned | BFlag.Collapsed)) {
        const id = this.fx.addEmitter('smoke', { x: cx, y: ground + 3, z: cz }, 1, { scale: 0.9 + size * 0.35, radius: size * 4, clock: Clock.Sim, color: 0x3e3a36 });
        this.smoulder.get(b.id) && this.fx.removeEmitter(this.smoulder.get(b.id)!.id);
        this.smoulder.set(b.id, { id, left: 40, total: 40 });
      } else {
        this.fx.burst('steam', { x: cx, y: Math.max(ground + 4, top - 4), z: cz }, 0.8 + size * 0.3);
      }
    }
  }

  onRemoved(b: Building): void {
    this.extinguish(b.id);
    const s = this.smoulder.get(b.id);
    if (s) {
      this.fx.removeEmitter(s.id);
      this.smoulder.delete(b.id);
    }
  }

  update(world: World, dtSim: number): void {
    // flame rate follows the fire intensity
    for (const [id, f] of this.burning) {
      const b = world.getBuilding(id);
      if (!b || !(b.flags & BFlag.OnFire)) {
        this.extinguish(id);
        continue;
      }
      const k = 0.25 + 1.0 * Math.max(0, Math.min(1, b.fire));
      for (let i = 0; i < f.ids.length; i++) this.fx.setEmitterRate(f.ids[i], f.base[i] * k);
    }
    for (const [id, s] of this.smoulder) {
      s.left -= dtSim;
      if (s.left <= 0) {
        this.fx.removeEmitter(s.id);
        this.smoulder.delete(id);
      } else this.fx.setEmitterRate(s.id, 0.2 + 0.8 * (s.left / s.total));
    }
    // forest fires: diff the burning cells a few times per second
    this.treeTimer -= dtSim;
    if (this.treeTimer > 0) return;
    this.treeTimer = 0.25;
    let cells: ReadonlyMap<number, number> | null = null;
    try {
      cells = this.game.eventSystem.burningTrees();
    } catch {
      cells = null;
    }
    if (!cells) return;
    for (const [idx, emitter] of this.trees) {
      if (cells.has(idx)) continue;
      this.fx.removeEmitter(emitter);
      this.trees.delete(idx);
    }
    const size = world.size;
    for (const [idx, intensity] of cells) {
      let id = this.trees.get(idx);
      if (id === undefined) {
        const x = ((idx % size) + 0.5) * CELL, z = (Math.floor(idx / size) + 0.5) * CELL;
        id = this.fx.addEmitter('fire', { x, y: this.fx.ground(x, z) + 1.5, z }, 0.6, { scale: 1.5, radius: 6.5, clock: Clock.Sim });
        this.trees.set(idx, id);
      }
      this.fx.setEmitterRate(id, 0.2 + 0.9 * intensity);
    }
  }

  clear(): void {
    for (const id of [...this.burning.keys()]) this.extinguish(id);
    for (const s of this.smoulder.values()) this.fx.removeEmitter(s.id);
    this.smoulder.clear();
    for (const id of this.trees.values()) this.fx.removeEmitter(id);
    this.trees.clear();
  }

  private top(b: Building): number {
    try {
      const t = this.game.buildings.buildingTop(b.id);
      if (t > 0) return t;
    } catch {
      /* building renderer unavailable */
    }
    return this.fx.ground((b.x + b.w / 2) * CELL, (b.y + b.h / 2) * CELL) + 8 + b.level * 5;
  }

  private ignite(b: Building): void {
    const cx = (b.x + b.w / 2) * CELL, cz = (b.y + b.h / 2) * CELL;
    const ground = this.fx.ground(cx, cz);
    const top = Math.max(ground + 4, this.top(b));
    const h = top - ground;
    const size = Math.sqrt(b.w * b.h);
    const scale = Math.min(2.6, 0.8 + size * 0.45);
    const radius = Math.min(b.w, b.h) * CELL * 0.32;
    const ids: number[] = [], base: number[] = [];
    // roof fire
    ids.push(this.fx.addEmitter('fire', { x: cx, y: top - Math.min(3, h * 0.2), z: cz }, 1, { scale, radius, clock: Clock.Sim }));
    base.push(1);
    // tall buildings burn on several floors
    if (h > 22) {
      ids.push(this.fx.addEmitter('fire', { x: cx, y: ground + h * 0.45, z: cz }, 0.7, { scale: scale * 0.8, radius: radius * 1.1, clock: Clock.Sim }));
      base.push(0.7);
    }
    // large footprints get extra seats of fire
    if (b.w * b.h >= 6) {
      const ox = (b.w * CELL) * 0.28, oz = (b.h * CELL) * 0.28;
      ids.push(this.fx.addEmitter('fire', { x: cx - ox, y: top - 2, z: cz + oz }, 0.8, { scale: scale * 0.8, radius: radius * 0.6, clock: Clock.Sim }));
      ids.push(this.fx.addEmitter('fire', { x: cx + ox, y: top - 2, z: cz - oz }, 0.8, { scale: scale * 0.8, radius: radius * 0.6, clock: Clock.Sim }));
      base.push(0.8, 0.8);
    }
    this.burning.set(b.id, { ids, base });
    // a fresh ruin that re-ignites loses its smoulder
    const s = this.smoulder.get(b.id);
    if (s) {
      this.fx.removeEmitter(s.id);
      this.smoulder.delete(b.id);
    }
  }

  private extinguish(id: number): void {
    const f = this.burning.get(id);
    if (!f) return;
    for (const e of f.ids) this.fx.removeEmitter(e);
    this.burning.delete(id);
  }
}
