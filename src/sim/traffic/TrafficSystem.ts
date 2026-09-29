// ─────────────────────────────────────────────────────────────────────────────
// TrafficSystem: agent-based road, rail and water traffic.
//
//  • RoadGraph        per-cell classification, junctions, components, access
//  • PathService      batched A* in path.worker.ts (+ cache, main-thread fallback)
//  • VehicleStore     SoA vehicle storage (≈3000 × vehicleDensity trip vehicles
//                     plus transit and service fleets)
//  • Mover            lanes, Bézier turns, IDM car following, signals, junction
//                     yielding, anti-gridlock, congestion sampling
//  • TripPlanner      trip generation by population / jobs / time of day
//  • ServiceManager   dispatch() + roaming garbage / hearse / police / mail
//  • TransitManager   world.transitLines, line vehicles, ridership
//
// Writes world.fields.traffic (0..255 congestion per road cell) about once a
// second, plus world.stats.trafficFlow / world.stats.vehicles.
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { Layer, type Cell, type Rect, type TransitLine, type TransitMode, type VehicleType } from '../../core/types';
import type { EventModifiers } from '../events/EventSystem';
import { TransitTool } from '../../tools/transit/TransitTool';
import { RoadGraph } from './graph';
import { laneCount } from './lanes';
import { Mover } from './Mover';
import { paintFor } from './palette';
import { PathService } from './PathService';
import { ServiceManager } from './services';
import { TransitManager } from './transit';
import { activityAt, TripPlanner, type TripSpec } from './trips';
import {
  Comp, compositionLength, METRO_DEPTH, Model, MODEL_LEN, MODEL_NAMES, PMode, Purpose, PURPOSE_LABEL, sectionModel, VF, VS, VT, VTYPES,
} from './types';
import { End, Start, VehicleStore } from './VehicleStore';

export interface VehicleInfo {
  id: number;
  type: VehicleType;
  x: number; // world meters
  y: number;
  z: number;
  heading: number; // radians, 0 = +Z
  speed: number; // m/s
  label: string;
  fromBuilding?: number;
  toBuilding?: number;
}

/** everything needed to put a vehicle on a ready path */
export interface SpawnSpec {
  slot?: number;
  type: VehicleType;
  model: Model;
  comp: Comp;
  nsec: number;
  color: number;
  flags: number;
  seed: number;
  purpose: Purpose;
  path: Int32Array;
  loop?: boolean;
  pi?: number;
  s?: number;
  startMode: Start;
  startDir: number;
  endMode: End;
  endDir: number;
  fromB?: number;
  toB?: number;
  line?: number;
  stopI?: number;
}

const BASE_VEHICLES = 3000;
const NEUTRAL: EventModifiers = {
  demandRes: 0, demandCom: 0, demandInd: 0, demandOff: 0, happiness: 0, incomeMult: 1, tourismMult: 1, crimeMult: 1, healthMult: 1,
  powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1, trafficMult: 1, fireRiskMult: 1, constructionMult: 1,
};
const SERVICE_TYPES = new Set<VehicleType>(['firetruck', 'police', 'ambulance', 'garbage', 'hearse', 'service']);

export class TrafficSystem {
  world: World | null = null;
  readonly store = new VehicleStore(4096);
  graph: RoadGraph | null = null;
  paths!: PathService;
  mover: Mover | null = null;
  planner: TripPlanner | null = null;
  readonly services: ServiceManager;
  readonly transit: TransitManager;
  /** +1 right-hand traffic, -1 left-hand */
  hand = 1;
  /** private trips (not service / transit) alive or waiting for a path */
  trips = 0;
  /** smoothed 0..100 flow */
  flow = 100;
  /** diagnostics */
  readonly stats = { target: 0, cap: 0, spawnFails: 0, congestionMs: 0, arrived: 0, removed: 0 };

  private offs: (() => void)[] = [];
  private spawnAcc = 0;
  private fieldTimer = 0;
  private congTimer = 0;
  private roadDirty: Rect | null = null;
  private roadTimer = 0;
  private waterDirty = false;
  private graphFieldVersion = -1;
  private densAvg = new Float32Array(0);
  private slowAvg = new Float32Array(0);
  private mods: EventModifiers = NEUTRAL;
  /** trips with a path waiting for room at their start cell */
  private spawnQueue: { spec: SpawnSpec; t: number }[] = [];
  private modsTimer = 0;

  constructor(readonly game: Game) {
    this.services = new ServiceManager(this);
    this.transit = new TransitManager(this);
    try {
      game.tools.register(new TransitTool(game));
    } catch (e) {
      console.warn('[traffic] transit tool registration failed', e);
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────
  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.hand = world.settings.leftHandTraffic ? -1 : 1;
    const graph = (this.graph = new RoadGraph(world));
    this.paths = new PathService(world, graph);
    this.planner = new TripPlanner(world, graph);
    const mover = (this.mover = new Mover(world, graph, this.store, {
      arrive: (i) => this.onArrive(i),
      despawn: (i) => {
        this.stats.removed++;
        this.despawn(i);
      },
      reroute: (i) => this.reroute(i),
      stopReached: (i) => this.transit.stopReached(i),
      transitStuck: (i) => this.transit.unstick(i),
      nextStopPi: (i) => this.transit.nextStopPi(i),
    }));
    mover.hand = this.hand;
    const roads = (this.game as unknown as { roads?: { signalState?: unknown } }).roads;
    mover.signals = roads && typeof roads.signalState === 'function' ? (roads as never) : null;
    this.services.reset();
    this.transit.clear();
    this.trips = 0;
    this.flow = 100;
    this.graphFieldVersion = -1;
    const ev = this.game.events;
    this.offs.push(
      ev.on('world:changed', ({ rect, layers }) => {
        if (layers & Layer.Road) {
          const d = this.roadDirty;
          this.roadDirty = d ? { x0: Math.min(d.x0, rect.x0), y0: Math.min(d.y0, rect.y0), x1: Math.max(d.x1, rect.x1), y1: Math.max(d.y1, rect.y1) } : { ...rect };
        }
        if (layers & (Layer.Water | Layer.Terrain)) this.waterDirty = true;
        if (layers & Layer.Building) this.planner?.markDirty();
      }),
      ev.on('building:added', (b) => {
        this.planner?.markDirty();
        if (b.kind === 'service') this.services.markDirty();
      }),
      ev.on('building:removed', (b) => {
        this.planner?.markDirty();
        if (b.kind === 'service') this.services.markDirty();
      }),
      ev.on('building:changed', () => this.planner?.markDirty()),
      ev.on('sim:month', () => this.transit.monthly()),
    );
    this.transit.attachAll();
  }

  onWorldUnloaded(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.world) {
      this.store.clear();
      this.paths?.dispose();
    }
    this.transit.clear();
    this.services.reset();
    this.world = null;
    this.graph = null;
    this.mover = null;
    this.planner = null;
    this.trips = 0;
    this.spawnQueue = [];
    this.roadDirty = null;
    this.waterDirty = false;
  }

  // ── frame update ────────────────────────────────────────────────────────
  update(dt: number): void {
    const w = this.world, g = this.graph, mover = this.mover, planner = this.planner;
    if (!w || !g || !mover || !planner) return;
    const sdt = Math.max(0, this.game.simDt);
    // network changes (coalesced: road drags touch many cells over a few frames)
    this.roadTimer -= dt;
    if (this.roadDirty && this.roadTimer <= 0) {
      const r = this.roadDirty;
      this.roadDirty = null;
      this.roadTimer = 0.2;
      g.updateRect(r);
      this.paths.roadsChanged(r);
      this.transit.networkChanged();
      planner.markDirty();
    }
    if (this.waterDirty && this.roadTimer <= 0) {
      this.waterDirty = false;
      this.roadTimer = 0.2;
      g.updateWater();
      this.paths.waterChanged();
    }
    this.modsTimer -= dt;
    if (this.modsTimer <= 0) {
      this.modsTimer = 1;
      this.mods = this.readModifiers();
      mover.speedMult = 1 / (1 + 0.55 * Math.max(0, this.mods.trafficMult - 1));
    }
    this.paths.update(dt);
    planner.refresh(dt);
    if (sdt > 0) {
      this.spawnTrips(sdt);
      this.flushSpawnQueue(sdt);
    }
    mover.update(sdt);
    this.transit.updateFree(sdt);
    this.services.update(sdt);
    // congestion field + stats (about once a second of real time while running)
    this.fieldTimer += dt;
    if (this.fieldTimer >= 1 && sdt > 0) {
      this.fieldTimer = 0;
      this.writeCongestion();
    }
    this.congTimer += dt;
    if (this.congTimer >= 5) {
      this.congTimer = 0;
      this.paths.congestion(w.fields.traffic);
    }
    w.stats.vehicles = this.vehicleCount;
  }

  private readModifiers(): EventModifiers {
    try {
      return this.game.eventSystem?.modifiers() ?? NEUTRAL;
    } catch {
      return NEUTRAL;
    }
  }

  /** combined event / weather modifiers (refreshed each second) */
  modifiers(): EventModifiers {
    return this.mods;
  }

  /** max private-trip vehicles for the current graphics settings */
  get vehicleCap(): number {
    let d = 1;
    try {
      d = this.game.settings.value.graphics.vehicleDensity;
    } catch {
      d = 1;
    }
    return Math.round(BASE_VEHICLES * Math.max(0.05, Math.min(1.5, d ?? 1)));
  }

  private spawnTrips(sdt: number): void {
    const w = this.world!, planner = this.planner!;
    const cap = this.vehicleCap;
    const pop = Math.max(w.stats.population, planner.residents);
    const jobs = Math.max(w.stats.jobs, planner.jobs);
    const base = pop * 0.05 + jobs * 0.018 + planner.indJobs * 0.02 + w.stats.tourists * 0.02;
    let target = base * activityAt(w.time.hour) * Math.max(0.3, this.mods.trafficMult);
    if (planner.homes.n > 0) target = Math.max(target, 3);
    target = Math.min(cap, target);
    this.stats.target = Math.round(target);
    this.stats.cap = cap;
    const deficit = target - this.trips;
    if (deficit <= 0) {
      this.spawnAcc = 0;
      return;
    }
    this.spawnAcc += sdt * Math.max(0.8, deficit * 0.4);
    let attempts = Math.min(40, Math.floor(this.spawnAcc));
    this.spawnAcc -= attempts;
    if (this.paths.pending > 600) return;
    while (attempts-- > 0 && this.trips < target) {
      const t = planner.plan(w.time.hour, this.mods.tourismMult);
      if (!t) {
        this.stats.spawnFails++;
        continue;
      }
      this.spawnTrip(t);
    }
  }

  private spawnTrip(t: TripSpec): void {
    const st = this.store;
    const slot = st.alloc();
    st.type[slot] = VT[t.type];
    st.flags[slot] = t.flags;
    this.trips++;
    const gen = st.gen[slot];
    const mode = PMode.Car;
    this.paths.request(mode, t.from.cell, t.to.cell, (path) => {
      if (st.gen[slot] !== gen || st.state[slot] !== VS.Pending) return;
      if (!path || path.length < 2) {
        this.despawn(slot);
        return;
      }
      this.spawnQueue.push({
        t: 0,
        spec: {
          slot, type: t.type, model: t.model, comp: t.comp, nsec: t.nsec, color: t.color, flags: t.flags, seed: t.seed, purpose: t.purpose, path,
          startMode: t.from.outside ? Start.Outside : Start.Building, startDir: t.from.dir,
          endMode: t.to.outside ? End.Outside : End.Building, endDir: t.to.dir,
          fromB: t.from.b, toB: t.to.b,
        },
      });
    });
  }

  /** release queued trips whose start cell has room (no spawning on top of queues) */
  private flushSpawnQueue(sdt: number): void {
    const q = this.spawnQueue, mover = this.mover!, st = this.store;
    let w = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      const slot = e.spec.slot!;
      if (st.state[slot] !== VS.Pending) continue;
      const cell = e.spec.path[0];
      const lanes = laneCount(this.world!.road[cell]);
      const limit = e.spec.startMode === Start.Outside ? lanes * 2 : Math.max(1, lanes - 1);
      if (mover.cellLoad(cell) < limit) {
        this.spawn(e.spec);
        continue;
      }
      e.t += sdt;
      if (e.t > 12) {
        this.despawn(slot);
        continue;
      }
      q[w++] = e;
    }
    q.length = w;
  }

  /** set length / half length from the composition */
  initShape(i: number): void {
    const st = this.store;
    const head = st.model[i] as Model;
    st.len[i] = compositionLength(st.comp[i], st.nsec[i], head);
    st.half[i] = MODEL_LEN[sectionModel(st.comp[i], 0, st.nsec[i], head)] * 0.5;
  }

  /** put a vehicle on a ready path (allocates a slot unless spec.slot is given); returns the slot */
  spawn(spec: SpawnSpec): number {
    const st = this.store, mover = this.mover!;
    const i = spec.slot ?? st.alloc();
    st.type[i] = VT[spec.type] ?? 0;
    st.model[i] = spec.model;
    st.comp[i] = spec.comp;
    st.nsec[i] = Math.max(1, spec.nsec);
    st.color[i] = spec.color;
    st.flags[i] = spec.flags | (spec.nsec > 1 ? VF.Long : 0);
    st.seed[i] = spec.seed >>> 0;
    st.purpose[i] = spec.purpose;
    st.path[i] = spec.path;
    st.loop[i] = spec.loop ? 1 : 0;
    st.pi[i] = spec.pi ?? 0;
    st.startMode[i] = spec.startMode;
    st.startDir[i] = spec.startDir;
    st.endMode[i] = spec.endMode;
    st.endDir[i] = spec.endDir;
    st.fromB[i] = spec.fromB ?? 0;
    st.toB[i] = spec.toB ?? 0;
    st.line[i] = spec.line ?? 0;
    st.stopI[i] = spec.stopI ?? 0;
    st.commit[i] = -1;
    st.v[i] = 0;
    st.stuck[i] = 0;
    st.wait[i] = 0;
    st.age[i] = 0;
    st.fade[i] = 0;
    st.state[i] = VS.Drive;
    this.initShape(i);
    mover.primeEntry(i, st.pi[i]);
    mover.enterCell(i, st.pi[i]);
    st.s[i] = spec.s ?? 0;
    mover.pose(i);
    st.activate(i);
    return i;
  }

  /** give an existing vehicle a new path (service returns, reroutes) */
  assignPath(i: number, path: Int32Array, startMode: Start, startDir: number, endMode: End, endDir: number, loop: boolean): void {
    const st = this.store, mover = this.mover;
    if (!mover) return;
    st.path[i] = path;
    st.loop[i] = loop ? 1 : 0;
    st.pi[i] = 0;
    st.s[i] = 0;
    st.startMode[i] = startMode;
    st.startDir[i] = startDir;
    st.endMode[i] = endMode;
    st.endDir[i] = endDir;
    st.commit[i] = -1;
    st.stuck[i] = 0;
    st.state[i] = VS.Drive;
    mover.enterCell(i, 0);
    mover.pose(i);
    st.activate(i);
  }

  /** remove a vehicle (any state) */
  despawn(i: number): void {
    const st = this.store;
    if (st.state[i] === VS.Free) return;
    const f = st.flags[i];
    if (f & VF.Service) this.services.gone(i);
    else if (f & VF.Transit) this.transit.gone(i);
    else this.trips = Math.max(0, this.trips - 1);
    st.release(i);
  }

  /** release a reserved (pending) slot */
  releaseSlot(i: number): void {
    this.despawn(i);
  }

  private onArrive(i: number): void {
    const st = this.store;
    if (st.flags[i] & VF.Service) this.services.arrive(i);
    else {
      this.stats.arrived++;
      this.despawn(i);
    }
  }

  private reroute(i: number): void {
    const st = this.store;
    if (st.flags[i] & VF.Transit) return; // the line re-plans itself
    const path = st.path[i];
    if (!path || st.state[i] !== VS.Drive) return;
    const cur = path[st.pi[i]];
    const dest = path[path.length - 1];
    const svc = (st.flags[i] & VF.Service) !== 0;
    const mode = svc ? PMode.Service : PMode.Car;
    if (!this.graph!.reachable(mode, cur, dest) || cur === dest) {
      this.despawn(i);
      return;
    }
    const endMode = st.endMode[i] as End, endDir = st.endDir[i];
    st.state[i] = VS.Waiting;
    const gen = st.gen[i];
    this.paths.request(mode, cur, dest, (p) => {
      if (st.gen[i] !== gen || st.state[i] !== VS.Waiting) return;
      if (!p || p.length < 2) {
        this.despawn(i);
        return;
      }
      this.assignPath(i, p, Start.Pose, -1, endMode, endDir, false);
    }, false);
  }

  /** remove every vehicle (transit lines respawn theirs) */
  clearVehicles(): void {
    if (!this.world) return;
    this.store.clear();
    this.trips = 0;
    this.spawnQueue = [];
    this.services.reset();
    for (const rt of this.transit.rt.values()) rt.veh = [];
    for (const l of this.world.transitLines) this.transit.syncVehicles(l);
  }

  // ── congestion ──────────────────────────────────────────────────────────
  private writeCongestion(): void {
    const t0 = performance.now();
    const w = this.world!, g = this.graph!, m = this.mover!;
    const field = w.fields.traffic;
    if (this.graphFieldVersion !== g.version) {
      field.fill(0);
      this.densAvg = new Float32Array(0);
      this.graphFieldVersion = g.version;
    }
    const samples = Math.max(1, m.samples);
    let density = 1;
    try {
      density = this.game.settings.value.graphics.vehicleDensity || 1;
    } catch {
      density = 1;
    }
    const scale = 1 / Math.max(0.05, Math.min(1.5, density));
    const occSum = m.occSum, spdSum = m.spdSum;
    if (this.densAvg.length !== occSum.length) {
      this.densAvg = new Float32Array(occSum.length);
      this.slowAvg = new Float32Array(occSum.length);
    }
    const dAvg = this.densAvg, sAvg = this.slowAvg;
    let flowNum = 0, flowDen = 0;
    const road = w.road;
    for (let k = 0; k < g.count; k++) {
      const cell = g.cells[k];
      const occ = occSum[k] / samples;
      // long-term (≈8 s) average density per lane of one direction and slowness:
      // queues cycling at a traffic light stay moderate, persistent jams go red
      const lanes = Math.max(1, laneCount(road[cell]));
      const dens = (occ * scale) / (lanes * 2.2);
      const slow = occ > 0.005 ? 1 - Math.min(1, spdSum[k] / Math.max(1e-3, occSum[k])) : 0;
      dAvg[k] = dAvg[k] * 0.88 + dens * 0.12;
      sAvg[k] = sAvg[k] * 0.88 + slow * 0.12;
      const c = Math.min(1, Math.max(0, 1.25 * (dAvg[k] - 0.35)) * (0.5 + 0.5 * sAvg[k]));
      if (occ > 0.005) {
        flowNum += occ * c;
        flowDen += occ;
      }
      field[cell] = Math.round(c * 255);
      occSum[k] = 0;
      spdSum[k] = 0;
    }
    m.samples = 0;
    const flow = flowDen > 0 ? 100 * (1 - flowNum / flowDen) : 100;
    this.flow = this.flow * 0.85 + flow * 0.15;
    w.stats.trafficFlow = Math.round(Math.max(0, Math.min(100, this.flow)));
    this.stats.congestionMs = performance.now() - t0;
  }

  // ── public API ──────────────────────────────────────────────────────────
  get vehicleCount(): number {
    const st = this.store;
    let n = 0;
    for (let a = 0; a < st.activeN; a++) if (st.state[st.active[a]] >= VS.Drive) n++;
    return n;
  }

  /** send a service vehicle from a building toward a target cell (visual + effect) */
  dispatch(type: VehicleType, fromBuildingId: number, to: Cell): boolean {
    if (!this.world) return false;
    return this.services.dispatch(type, fromBuildingId, to);
  }

  spawnVehicle(type: VehicleType, from: Cell, to: Cell): number | null {
    const w = this.world, g = this.graph;
    if (!w || !g) return null;
    const svc = SERVICE_TYPES.has(type);
    const mode = svc ? PMode.Service : PMode.Car;
    const a = g.nearest(from.x | 0, from.y | 0, mode, 4), b = g.nearest(to.x | 0, to.y | 0, mode, 4);
    if (a < 0 || b < 0 || a === b || !g.reachable(mode, a, b)) return null;
    const st = this.store;
    const slot = st.alloc();
    const model = svc ? this.services.modelFor(type) : type === 'taxi' ? Model.Taxi : type === 'truck' ? Model.BoxTruck : type === 'van' ? Model.DeliveryVan : type === 'bus' ? Model.Bus : type === 'bike' ? Model.Bicycle : Model.Sedan;
    let flags = svc ? VF.Service : 0;
    if (type === 'firetruck' || type === 'police' || type === 'ambulance') flags |= VF.Siren;
    if (type === 'bike') flags |= VF.Bike | VF.NoFollow;
    st.type[slot] = VT[type] ?? 0;
    st.flags[slot] = flags;
    if (!svc) this.trips++;
    else this.services.active++;
    const gen = st.gen[slot];
    const seed = (slot * 2654435761) >>> 0;
    this.paths.request(mode, a, b, (path) => {
      if (st.gen[slot] !== gen || st.state[slot] !== VS.Pending) return;
      if (!path || path.length < 2) {
        this.despawn(slot);
        return;
      }
      this.spawn({
        slot, type, model, comp: Comp.Single, nsec: 1, color: paintFor(model, seed), flags, seed, purpose: svc ? Purpose.Service : Purpose.Visitor, path,
        startMode: Start.Mid, startDir: -1, endMode: svc ? End.Mid : End.Mid, endDir: -1,
      });
      if (svc) st.timer[slot] = 8;
    });
    return st.uid(slot);
  }

  vehicleInfo(id: number): VehicleInfo | null {
    const st = this.store;
    const i = st.indexOf(id);
    if (i < 0 || st.state[i] < VS.Drive) return null;
    const type = VTYPES[st.type[i]];
    const x = st.x[i], z = st.z[i];
    return {
      id,
      type,
      x,
      y: this.heightOf(i, x, z),
      z,
      heading: st.yaw[i],
      speed: st.v[i],
      label: this.labelOf(i),
      fromBuilding: st.fromB[i] || undefined,
      toBuilding: st.toB[i] || undefined,
    };
  }

  private labelOf(i: number): string {
    const st = this.store, w = this.world!;
    const model = st.model[i] as Model;
    const name = MODEL_NAMES[model] ?? 'Vehicle';
    if (st.flags[i] & VF.Transit) {
      const line = w.transitLines.find((l) => l.id === st.line[i]);
      const what = st.state[i] === VS.Dwell ? 'at a stop' : 'in service';
      return line ? `${line.name} · ${what}` : `${name} · ${what}`;
    }
    if (st.flags[i] & VF.Service) {
      const state = st.state[i] === VS.OnScene ? 'On scene' : st.flags[i] & VF.Return ? 'Returning to depot' : PURPOSE_LABEL[st.purpose[i]] ?? 'In service';
      return `${name} · ${state}`;
    }
    return `${name} · ${PURPOSE_LABEL[st.purpose[i]] ?? 'Driving'}`;
  }

  /** ground / deck / water / guideway height for a vehicle at (x, z) */
  heightOf(i: number, x: number, z: number): number {
    const st = this.store, w = this.world!;
    const f = st.flags[i];
    if (f & VF.Free) {
      const mode: TransitMode = f & VF.Underground ? 'metro' : f & VF.Water ? 'ferry' : 'monorail';
      return this.transit.freeHeight(mode, x, z);
    }
    const rs = this.game.roadSurface;
    return rs ? rs.heightAt(x, z) : w.heightAt(x, z);
  }

  /**
   * Trailing-section support for renderers: points `backs[k]` meters behind
   * the head center (ascending), out[k*4..]: x, z, tx, tz.
   */
  sectionPoints(i: number, backs: Float32Array, count: number, out: Float32Array): void {
    const st = this.store;
    if (st.flags[i] & VF.Free) {
      const p = this.tmpPt;
      for (let k = 0; k < count; k++) {
        this.transit.freePoint(i, backs[k], p);
        out[k * 4] = p.x;
        out[k * 4 + 1] = p.z;
        out[k * 4 + 2] = p.tx;
        out[k * 4 + 3] = p.tz;
      }
      return;
    }
    this.mover?.pointsBehind(i, backs, count, out);
  }
  private tmpPt = { x: 0, z: 0, tx: 0, tz: 1 };

  nearestVehicle(wx: number, wz: number, maxDist: number): number | null {
    const st = this.store;
    let best = -1, bd = maxDist * maxDist;
    for (let a = 0; a < st.activeN; a++) {
      const i = st.active[a];
      if (st.state[i] < VS.Drive || st.flags[i] & VF.Underground) continue;
      const dx = st.x[i] - wx, dz = st.z[i] - wz;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? st.uid(best) : null;
  }

  /** 0..1 congestion on a road cell */
  congestionAt(x: number, y: number): number {
    const w = this.world;
    if (!w || !w.inBounds(x, y)) return 0;
    return w.fields.traffic[w.idx(x, y)] / 255;
  }

  // transit lines
  createLine(mode: TransitMode, stops: Cell[]): TransitLine | null {
    if (!this.world || !this.graph) return null;
    return this.transit.create(mode, stops);
  }
  updateLine(id: number, patch: Partial<Pick<TransitLine, 'name' | 'color' | 'vehicles' | 'active' | 'stops'>>): void {
    if (!this.world) return;
    this.transit.update(id, patch);
  }
  removeLine(id: number): void {
    if (!this.world) return;
    this.transit.remove(id);
  }

  /** metro tunnels depth (for renderers drawing station entrances) */
  get metroDepth(): number {
    return METRO_DEPTH;
  }
}
