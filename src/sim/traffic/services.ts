// Service vehicles: dispatch() requests (fire engines, ambulances and police
// with flashing light bars, garbage trucks, hearses…) drive from their depot's
// access road to the curb nearest the target, stay on scene for a while, then
// return to the depot and park. A light roaming layer keeps city services
// visibly busy: garbage rounds to buildings with garbage, hearses to buildings
// with dead, police patrols around stations and mail vans from post offices.
import { BFlag, Problem, type Building, type Cell, type VehicleType } from '../../core/types';
import { buildingDef } from '../../data/buildings';
import type { TrafficSystem } from './TrafficSystem';
import { paintFor } from './palette';
import { End, Start } from './VehicleStore';
import { Comp, Model, PMode, Purpose, VF, VS, VT } from './types';

const SERVICE_MODEL: Partial<Record<VehicleType, Model>> = {
  firetruck: Model.FireTruck,
  police: Model.Police,
  ambulance: Model.Ambulance,
  garbage: Model.Garbage,
  hearse: Model.Hearse,
  service: Model.Utility,
  van: Model.PostVan,
  truck: Model.BoxTruck,
  taxi: Model.Taxi,
  bus: Model.Bus,
  bike: Model.Bicycle,
  car: Model.Sedan,
};
const EMERGENCY = new Set<VehicleType>(['firetruck', 'police', 'ambulance']);
const MAX_SERVICE = 260;

export class ServiceManager {
  /** active vehicles per depot building id */
  private perDepot = new Map<number, number>();
  private roamTimer = 1.5;
  private depots: number[] = [];
  private depotsDirty = true;
  private sample: number[] = [];
  private sampleTimer = 0;
  active = 0;

  constructor(private ts: TrafficSystem) {}

  markDirty(): void {
    this.depotsDirty = true;
  }

  modelFor(type: VehicleType): Model {
    return SERVICE_MODEL[type] ?? Model.Utility;
  }

  /** spawn a service vehicle from a depot toward a target cell; false if impossible */
  dispatch(type: VehicleType, fromBuildingId: number, to: Cell, opts: { siren?: boolean; purpose?: Purpose; onScene?: number } = {}): boolean {
    const ts = this.ts, w = ts.world, g = ts.graph;
    if (!w || !g || !ts.planner) return false;
    if (this.active >= MAX_SERVICE) return false;
    const depot = w.buildings.get(fromBuildingId);
    if (!depot) return false;
    const from = ts.planner.buildingEndpoint(fromBuildingId, true, true);
    if (!from) return false;
    // target: the access road of a building at the cell, else the nearest road
    let target = -1;
    if (w.inBounds(to.x, to.y)) {
      const tb = w.buildingAt(to.x, to.y);
      if (tb && tb.id !== fromBuildingId) {
        const a = g.accessOf(tb, true);
        if (a >= 0) target = a >> 2;
      }
      if (target < 0) target = g.nearest(to.x, to.y, PMode.Service, 6);
    }
    if (target < 0 || !g.reachable(PMode.Service, from.cell, target)) return false;
    if (target === from.cell) return false;
    const siren = opts.siren ?? EMERGENCY.has(type);
    const model = this.modelFor(type);
    const seed = ((ts.planner.rand() * 0xffffffff) >>> 0) ^ fromBuildingId;
    const slot = ts.store.alloc();
    ts.store.type[slot] = VT[type] ?? VT.service;
    this.perDepot.set(fromBuildingId, (this.perDepot.get(fromBuildingId) ?? 0) + 1);
    this.active++;
    ts.store.fromB[slot] = fromBuildingId;
    ts.store.flags[slot] = VF.Service;
    const gen = ts.store.gen[slot];
    ts.paths.request(PMode.Service, from.cell, target, (path) => {
      if (ts.store.gen[slot] !== gen || ts.store.state[slot] !== VS.Pending) return;
      if (!path || path.length < 2) {
        ts.releaseSlot(slot);
        return;
      }
      let flags = VF.Service;
      if (siren) flags |= VF.Siren;
      if (type === 'garbage' || type === 'service') flags |= VF.Beacon;
      ts.spawn({
        slot, type, model, comp: Comp.Single, nsec: 1, color: paintFor(model, seed), flags, seed,
        purpose: opts.purpose ?? Purpose.Service, path,
        startMode: Start.Building, startDir: from.dir, endMode: End.Mid, endDir: -1,
        fromB: fromBuildingId, toB: w.buildingAt(to.x, to.y)?.id ?? 0,
      });
      ts.store.timer[slot] = opts.onScene ?? (siren ? 9 + ts.planner!.rand() * 8 : 3 + ts.planner!.rand() * 3);
    });
    return true;
  }

  /** a service vehicle reached the end of its path */
  arrive(i: number): void {
    const ts = this.ts, st = ts.store;
    if (st.flags[i] & VF.Return) {
      ts.despawn(i);
      return;
    }
    // on scene: park at the curb (lights keep flashing), then head home
    if (st.state[i] === VS.Drive) {
      st.state[i] = VS.OnScene;
      st.flags[i] |= VF.NoFollow;
      st.v[i] = 0;
      if (st.timer[i] <= 0) st.timer[i] = 6;
      return;
    }
    // on-scene timer elapsed → request the way back
    const depot = ts.world!.buildings.get(st.fromB[i]);
    const back = depot ? ts.planner!.buildingEndpoint(depot.id, false, true) : null;
    const cur = st.path[i]![st.pi[i]];
    if (!back || !ts.graph!.reachable(PMode.Service, cur, back.cell) || back.cell === cur) {
      ts.despawn(i);
      return;
    }
    st.state[i] = VS.Waiting;
    st.flags[i] = (st.flags[i] & ~VF.Siren) | VF.Return;
    const gen = st.gen[i];
    ts.paths.request(PMode.Service, cur, back.cell, (path) => {
      if (st.gen[i] !== gen || st.state[i] !== VS.Waiting) return;
      if (!path || path.length < 2) {
        ts.despawn(i);
        return;
      }
      st.flags[i] &= ~VF.NoFollow;
      ts.assignPath(i, path, Start.Pose, -1, End.Building, back.dir, false);
    });
  }

  /** bookkeeping when a service vehicle leaves the simulation */
  gone(i: number): void {
    const st = this.ts.store;
    const id = st.fromB[i];
    const c = this.perDepot.get(id);
    if (c !== undefined) {
      if (c <= 1) this.perDepot.delete(id);
      else this.perDepot.set(id, c - 1);
    }
    this.active = Math.max(0, this.active - 1);
  }

  reset(): void {
    this.perDepot.clear();
    this.active = 0;
    this.depotsDirty = true;
  }

  // ── roaming (visual service activity) ───────────────────────────────────
  update(dt: number): void {
    const ts = this.ts, w = ts.world;
    if (!w || dt <= 0) return;
    if (this.depotsDirty) {
      this.depotsDirty = false;
      this.depots = [];
      for (const b of w.buildings.values()) {
        if (b.kind !== 'service') continue;
        const def = buildingDef(b.defId);
        const t = def?.vehicles?.type;
        if (t === 'garbage' || t === 'hearse' || t === 'police' || t === 'van' || t === 'service') this.depots.push(b.id);
      }
    }
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 6;
      this.sample.length = 0;
      for (const b of w.buildings.values()) if (b.kind === 'zoned' && b.built >= 1) this.sample.push(b.id);
    }
    this.roamTimer -= dt;
    if (this.roamTimer > 0 || !this.depots.length) return;
    this.roamTimer = 2.2 + (ts.planner?.rand() ?? 0.5) * 2;
    const id = this.depots[Math.floor((ts.planner?.rand() ?? 0) * this.depots.length) % this.depots.length];
    const depot = w.buildings.get(id);
    if (!depot || depot.flags & (BFlag.Disabled | BFlag.Collapsed | BFlag.UnderConstruction) || depot.built < 1) return;
    const def = buildingDef(depot.defId);
    const t = def?.vehicles?.type;
    const cap = Math.max(1, Math.ceil((def?.vehicles?.count ?? 2) * 0.5));
    if ((this.perDepot.get(id) ?? 0) >= cap) return;
    const hour = w.time.hour;
    const cx = depot.x + (depot.w >> 1), cy = depot.y + (depot.h >> 1);
    const rnd = () => ts.planner?.rand() ?? Math.random();
    if (t === 'police') {
      // patrol: a random road nearby
      for (let k = 0; k < 6; k++) {
        const tx = cx + Math.round((rnd() - 0.5) * 40), ty = cy + Math.round((rnd() - 0.5) * 40);
        const cell = ts.graph!.nearest(tx, ty, PMode.Car, 3);
        if (cell < 0) continue;
        if (this.dispatch('police', id, { x: cell % w.size, y: (cell / w.size) | 0 }, { siren: false, purpose: Purpose.Patrol, onScene: 2 })) return;
      }
      return;
    }
    if (t === 'van') {
      if (hour < 7 || hour > 19) return;
      const b = this.pickBuilding(cx, cy, 50, () => true);
      if (b) this.dispatch('van', id, { x: b.x, y: b.y }, { siren: false, purpose: Purpose.Mail, onScene: 3 });
      return;
    }
    if (t === 'garbage') {
      if (hour > 1 && hour < 5) return;
      const b = this.pickBuilding(cx, cy, 70, (bb) => (bb.problems & Problem.Garbage) !== 0 || bb.garbage > 1.5);
      if (b) this.dispatch('garbage', id, { x: b.x, y: b.y }, { siren: false, onScene: 5 });
      return;
    }
    if (t === 'hearse') {
      const b = this.pickBuilding(cx, cy, 80, (bb) => (bb.problems & Problem.Dead) !== 0);
      if (b) this.dispatch('hearse', id, { x: b.x, y: b.y }, { siren: false, onScene: 6 });
      return;
    }
    if (t === 'service') {
      const b = this.pickBuilding(cx, cy, 60, (bb) => (bb.flags & BFlag.Collapsed) !== 0 || (bb.flags & BFlag.Burned) !== 0);
      if (b) this.dispatch('service', id, { x: b.x, y: b.y }, { siren: false, onScene: 10 });
    }
  }

  private pickBuilding(cx: number, cy: number, radius: number, ok: (b: Building) => boolean): Building | null {
    const w = this.ts.world!;
    if (!this.sample.length) return null;
    let best: Building | null = null, bd = Infinity;
    const rnd = () => this.ts.planner?.rand() ?? Math.random();
    for (let k = 0; k < 24; k++) {
      const b = w.buildings.get(this.sample[Math.floor(rnd() * this.sample.length) % this.sample.length]);
      if (!b || !ok(b)) continue;
      const d = Math.abs(b.x - cx) + Math.abs(b.y - cy);
      if (d > radius) continue;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
}
