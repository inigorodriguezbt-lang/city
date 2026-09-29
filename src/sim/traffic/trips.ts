// Trip generation: a weighted index of trip generators / attractors (homes,
// workplaces, shops, leisure, industry, outside highway connections) and a
// time-of-day demand model. Private trips (commutes, shopping, leisure,
// taxis, bikes), freight (industry → commerce / export / import), tourists
// and out-of-town commuters are spawned in proportion to population, jobs and
// commerce, shaped by rush hours and quiet nights, scaled by event modifiers
// and reduced where transit coverage is good. Destinations follow a simple
// gravity model (weighted candidates, nearer ones preferred).
import { hashFloat, RNG } from '../../core/rng';
import { BFlag, ZoneType, type Building, type VehicleType } from '../../core/types';
import { buildingDef } from '../../data/buildings';
import { zoneDef } from '../../data/zones';
import type { World } from '../../world/World';
import type { RoadGraph } from './graph';
import { paintFor } from './palette';
import { Comp, Model, PMode, Purpose, VF } from './types';

export interface Endpoint {
  cell: number;
  /** Start: travel dir from the building into the road / inward from the map edge.
   *  End: dir from the road into the building / outward. */
  dir: number;
  /** building id (0 = none) */
  b: number;
  outside: boolean;
}

export interface TripSpec {
  purpose: Purpose;
  type: VehicleType;
  model: Model;
  comp: Comp;
  nsec: number;
  color: number;
  flags: number;
  seed: number;
  from: Endpoint;
  to: Endpoint;
}

class WeightedSet {
  ids: Int32Array = new Int32Array(64);
  cx: Int32Array = new Int32Array(64);
  cy: Int32Array = new Int32Array(64);
  cum: Float64Array = new Float64Array(64);
  n = 0;
  total = 0;
  reset(): void {
    this.n = 0;
    this.total = 0;
  }
  add(b: Building, w: number): void {
    if (w <= 0) return;
    if (this.n >= this.ids.length) {
      const grow = <T extends Int32Array | Float64Array>(a: T): T => {
        const c = new (a.constructor as new (n: number) => T)(a.length * 2);
        c.set(a as never);
        return c;
      };
      this.ids = grow(this.ids);
      this.cx = grow(this.cx);
      this.cy = grow(this.cy);
      this.cum = grow(this.cum);
    }
    this.total += w;
    this.ids[this.n] = b.id;
    this.cx[this.n] = b.x + (b.w >> 1);
    this.cy[this.n] = b.y + (b.h >> 1);
    this.cum[this.n++] = this.total;
  }
  /** index of a weighted random entry, -1 if empty */
  pick(r: number): number {
    if (!this.n) return -1;
    const t = r * this.total;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

const g = (h: number, c: number, s: number): number => {
  let d = Math.abs(h - c);
  if (d > 12) d = 24 - d;
  return Math.exp(-(d * d) / (2 * s * s));
};

/** relative trip activity by hour (≈0.1 at night, ≈1 at rush hours) */
export function activityAt(hour: number): number {
  return Math.min(1.15, 0.09 + 0.95 * Math.max(g(hour, 8.0, 1.25), g(hour, 17.6, 1.55)) + 0.42 * g(hour, 12.8, 2.8) + 0.22 * g(hour, 20.8, 1.8));
}

const IND_ZONES = new Set<ZoneType>([ZoneType.Industry, ZoneType.Farming, ZoneType.Forestry, ZoneType.Mining, ZoneType.Oil]);

export class TripPlanner {
  readonly homes = new WeightedSet();
  readonly work = new WeightedSet();
  readonly shops = new WeightedSet();
  readonly leisure = new WeightedSet();
  readonly industry = new WeightedSet();
  readonly commerce = new WeightedSet();
  /** resolved outside highway connections (cell + inward dir) */
  outside: { cell: number; dir: number }[] = [];
  residents = 0;
  jobs = 0;
  indJobs = 0;
  comJobs = 0;
  private dirty = true;
  private timer = 0;
  private rng: RNG;
  private seedCounter = 1;

  constructor(private world: World, private graph: RoadGraph) {
    this.rng = new RNG((world.settings.seed ^ 0x7a3f11) >>> 0);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** rebuild the weighted index (throttled) */
  refresh(dt: number): void {
    this.timer -= dt;
    if (!this.dirty || this.timer > 0) return;
    this.dirty = false;
    this.timer = 2.5;
    const w = this.world;
    for (const s of [this.homes, this.work, this.shops, this.leisure, this.industry, this.commerce]) s.reset();
    this.residents = this.jobs = this.indJobs = this.comJobs = 0;
    for (const b of w.buildings.values()) {
      if (b.built < 1 || b.flags & (BFlag.Abandoned | BFlag.Collapsed | BFlag.Burned | BFlag.UnderConstruction)) continue;
      if (b.kind === 'zoned') {
        const zd = zoneDef(b.zone);
        if (!zd) continue;
        const jobs = Math.max(b.workers, b.jobs * 0.35);
        if (zd.category === 'res') {
          this.homes.add(b, b.residents || b.maxResidents * 0.3);
          this.residents += b.residents;
          if (b.zone === ZoneType.MixedUse) {
            this.shops.add(b, 1 + jobs + b.visitors * 0.3);
            this.commerce.add(b, 1 + jobs);
          }
        } else if (zd.category === 'com') {
          this.work.add(b, jobs);
          this.shops.add(b, 1 + jobs + b.visitors * 0.3);
          this.commerce.add(b, 1 + jobs);
          this.comJobs += jobs;
        } else if (zd.category === 'off') {
          this.work.add(b, jobs);
        } else if (IND_ZONES.has(b.zone)) {
          this.work.add(b, jobs);
          this.industry.add(b, 1 + jobs * (0.4 + b.goods / 100));
          this.indJobs += jobs;
        }
        this.jobs += zd.category === 'res' ? 0 : jobs;
      } else {
        const def = buildingDef(b.defId);
        if (!def) continue;
        const jobs = Math.max(b.workers, (def.jobs ?? 0) * 0.5);
        if (jobs > 0) this.work.add(b, jobs * 0.6);
        if (def.category === 'parks' || def.category === 'plazas' || def.category === 'tourism' || def.category === 'landmark' || def.category === 'monument')
          this.leisure.add(b, 4 + Math.sqrt(def.capacity ?? 60) + (def.attractiveness ?? 0) * 0.3);
        if (def.category === 'education' || def.category === 'health') this.leisure.add(b, 2 + jobs * 0.2);
      }
    }
    this.outside = [];
    for (const c of w.connections) {
      if (c.kind !== 'highway') continue;
      const cell = this.graph.connectionCell(c.x, c.y);
      if (cell >= 0) this.outside.push({ cell, dir: (c.dir + 2) & 3 });
    }
  }

  private endpointOf(id: number, asStart: boolean, service = false): Endpoint | null {
    const b = this.world.buildings.get(id);
    if (!b) return null;
    const a = this.graph.accessOf(b, service);
    if (a < 0) return null;
    const cell = a >> 2, side = a & 3;
    // side = dir from building toward road: start travels along it, end travels against it
    return { cell, dir: asStart ? side : (side + 2) & 3, b: id, outside: false };
  }

  /** gravity-model destination: best of a few weighted samples, nearer preferred */
  private pickNear(set: WeightedSet, ox: number, oy: number, exclude: number): number {
    if (!set.n) return -1;
    let best = -1, bestScore = -1;
    for (let k = 0; k < 4; k++) {
      const j = set.pick(this.rng.next());
      if (j < 0 || set.ids[j] === exclude) continue;
      const d = Math.abs(set.cx[j] - ox) + Math.abs(set.cy[j] - oy);
      const score = this.rng.next() / (1 + (d / 48) * (d / 48));
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    return best >= 0 ? set.ids[best] : -1;
  }

  private outsideEnd(asStart: boolean): Endpoint | null {
    if (!this.outside.length) return null;
    const o = this.outside[Math.floor(this.rng.next() * this.outside.length)];
    return { cell: o.cell, dir: asStart ? o.dir : (o.dir + 2) & 3, b: 0, outside: true };
  }

  private privateModel(rural: boolean): Model {
    const r = this.rng.next() * 100;
    if (rural) return r < 25 ? Model.Pickup : r < 50 ? Model.SUV : r < 70 ? Model.Sedan : r < 85 ? Model.Hatchback : Model.Minivan;
    return r < 29 ? Model.Sedan : r < 51 ? Model.Hatchback : r < 71 ? Model.SUV : r < 78 ? Model.Pickup : r < 88 ? Model.Minivan : r < 91.5 ? Model.Sports : Model.Sedan;
  }

  /**
   * Plan one trip for the current hour; null when nothing sensible is
   * available (no buildings, no road access, unreachable, rode transit).
   */
  plan(hour: number, tourismMult: number): TripSpec | null {
    const hasOut = this.outside.length > 0;
    const W: number[] = [];
    const home = this.homes.n > 0, work = this.work.n > 0, shop = this.shops.n > 0, leis = this.leisure.n > 0;
    const ind = this.industry.n > 0, com = this.commerce.n > 0;
    W[Purpose.Commute] = home && work ? 0.12 + 1.25 * g(hour, 7.8, 1.3) + 0.15 * g(hour, 13, 2) : 0;
    W[Purpose.Home] = home && work ? 0.1 + 1.25 * g(hour, 17.4, 1.5) + 0.2 * g(hour, 22.5, 1.8) : 0;
    W[Purpose.Shop] = home && shop ? 0.14 + 0.7 * g(hour, 11.5, 2.8) + 0.62 * g(hour, 18.6, 1.8) : 0;
    W[Purpose.Leisure] = home && leis ? 0.05 + 0.35 * g(hour, 15, 3) + 0.55 * g(hour, 20.3, 1.8) : 0;
    const indShare = Math.min(1, 0.25 + this.indJobs / Math.max(1, this.jobs));
    W[Purpose.Freight] = ind && com ? (0.05 + 0.2 * g(hour, 10.5, 3.5)) * indShare : 0;
    W[Purpose.Export] = ind && hasOut ? (0.03 + 0.08 * g(hour, 11, 4)) * indShare : 0;
    W[Purpose.Import] = com && hasOut ? 0.03 + 0.07 * g(hour, 9, 4) : 0;
    W[Purpose.Tourist] = hasOut && (leis || shop) ? (0.04 + 0.2 * g(hour, 13, 3.5)) * tourismMult * Math.min(1.5, this.world.stats.tourists / 800 + 0.2) : 0;
    W[Purpose.Visitor] = hasOut && work ? 0.05 + 0.25 * g(hour, 7.6, 1.2) + 0.2 * g(hour, 17.8, 1.4) : 0;
    W[Purpose.Taxi] = (shop || leis) && home && this.residents > 3000 ? 0.04 + 0.2 * g(hour, 23, 2.2) + 0.08 * g(hour, 18, 3) : 0;
    let total = 0;
    for (let k = 0; k < W.length; k++) total += W[k] ?? 0;
    if (total <= 0) return null;
    let r = this.rng.next() * total, purpose = Purpose.Commute;
    for (let k = 0; k < W.length; k++) {
      r -= W[k] ?? 0;
      if (r <= 0) {
        purpose = k as Purpose;
        break;
      }
    }
    let from: Endpoint | null = null, to: Endpoint | null = null;
    let type: VehicleType = 'car';
    let model = Model.Sedan;
    let comp = Comp.Single;
    let flags = 0;
    const pickHome = () => {
      const j = this.homes.pick(this.rng.next());
      return j >= 0 ? this.homes.ids[j] : -1;
    };
    const center = (id: number): [number, number] => {
      const b = this.world.buildings.get(id)!;
      return [b.x + (b.w >> 1), b.y + (b.h >> 1)];
    };
    switch (purpose) {
      case Purpose.Commute:
      case Purpose.Home:
      case Purpose.Shop:
      case Purpose.Leisure:
      case Purpose.Taxi: {
        const h = pickHome();
        if (h < 0) return null;
        const [hx, hy] = center(h);
        // transit riders leave the car at home
        const cell = this.world.idx(hx, hy);
        if ((purpose !== Purpose.Taxi && this.rng.next() < (this.world.fields.transit[cell] / 255) * 0.45)) return null;
        const set = purpose === Purpose.Shop ? this.shops : purpose === Purpose.Leisure ? this.leisure : purpose === Purpose.Taxi ? (this.rng.next() < 0.5 ? this.shops : this.leisure) : this.work;
        const d = this.pickNear(set.n ? set : this.shops, hx, hy, h);
        if (d < 0) return null;
        const hb = this.world.buildings.get(h)!;
        const rural = hb.zone === ZoneType.ResLow && this.world.fields.landValue[cell] < 70;
        if (purpose === Purpose.Taxi) {
          type = 'taxi';
          model = Model.Taxi;
          from = this.endpointOf(d, true);
          to = this.endpointOf(h, false);
        } else {
          // some short hops by bicycle
          const [dx, dy] = center(d);
          const dist = Math.abs(dx - hx) + Math.abs(dy - hy);
          if (dist < 28 && this.rng.next() < 0.14 && hour > 6 && hour < 21) {
            type = 'bike';
            model = Model.Bicycle;
            flags |= VF.Bike | VF.NoFollow;
          } else model = this.privateModel(rural);
          const out = purpose !== Purpose.Home;
          from = this.endpointOf(out ? h : d, true);
          to = this.endpointOf(out ? d : h, false);
        }
        break;
      }
      case Purpose.Freight: {
        const j = this.industry.pick(this.rng.next());
        if (j < 0) return null;
        const src = this.industry.ids[j];
        const d = this.pickNear(this.commerce, this.industry.cx[j], this.industry.cy[j], src);
        if (d < 0) return null;
        const rr = this.rng.next();
        type = rr < 0.5 ? 'van' : 'truck';
        model = rr < 0.5 ? Model.DeliveryVan : rr < 0.88 ? Model.BoxTruck : Model.SemiTractor;
        from = this.endpointOf(src, true);
        to = this.endpointOf(d, false);
        break;
      }
      case Purpose.Export:
      case Purpose.Import: {
        const set = purpose === Purpose.Export ? this.industry : this.commerce;
        const j = set.pick(this.rng.next());
        if (j < 0) return null;
        const id = set.ids[j];
        const rr = this.rng.next();
        type = 'truck';
        model = rr < 0.6 ? Model.SemiTractor : rr < 0.9 ? Model.BoxTruck : Model.DeliveryVan;
        if (model === Model.DeliveryVan) type = 'van';
        if (purpose === Purpose.Export) {
          from = this.endpointOf(id, true);
          to = this.outsideEnd(false);
        } else {
          from = this.outsideEnd(true);
          to = this.endpointOf(id, false);
        }
        flags |= VF.Outside;
        break;
      }
      case Purpose.Tourist: {
        const set = this.leisure.n && this.rng.next() < 0.6 ? this.leisure : this.shops;
        const j = set.pick(this.rng.next());
        if (j < 0) return null;
        const id = set.ids[j];
        const back = hour > 16 && this.rng.next() < 0.5;
        model = this.rng.next() < 0.3 ? Model.Minivan : this.privateModel(false);
        from = back ? this.endpointOf(id, true) : this.outsideEnd(true);
        to = back ? this.outsideEnd(false) : this.endpointOf(id, false);
        flags |= VF.Outside;
        break;
      }
      case Purpose.Visitor: {
        const j = this.work.pick(this.rng.next());
        if (j < 0) return null;
        const id = this.work.ids[j];
        const back = hour > 13;
        model = this.privateModel(false);
        from = back ? this.endpointOf(id, true) : this.outsideEnd(true);
        to = back ? this.outsideEnd(false) : this.endpointOf(id, false);
        flags |= VF.Outside;
        break;
      }
      default:
        return null;
    }
    if (!from || !to || from.cell === to.cell) return null;
    if (!this.graph.reachable(PMode.Car, from.cell, to.cell)) return null;
    if (model === Model.SemiTractor) comp = Comp.Semi;
    const seed = (this.rng.next() * 0xffffffff) >>> 0 ^ this.seedCounter++;
    return { purpose, type, model, comp, nsec: comp === Comp.Semi ? 2 : 1, color: paintFor(model, seed), flags, seed, from, to };
  }

  /** endpoint helper for other planners (services, spawnVehicle) */
  buildingEndpoint(id: number, asStart: boolean, service = false): Endpoint | null {
    return this.endpointOf(id, asStart, service);
  }

  /** a deterministic pseudo-random float for callers without their own RNG */
  rand(): number {
    return this.rng.next();
  }

  /** deterministic per-id variation in 0..1 */
  static vary(id: number, salt: number): number {
    return hashFloat(id, salt);
  }
}
