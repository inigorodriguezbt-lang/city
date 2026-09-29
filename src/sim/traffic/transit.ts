// Transit lines: validation, naming and coloring of world.transitLines, line
// paths (legs between consecutive stops through the path worker; reversal
// markers where rail / tram lines turn back so push-pull units swap ends),
// line vehicles (buses, trams and trains on the road/rail graph; metro,
// ferries and monorails on world-space polylines), dwell at stops, headway
// keeping and monthly ridership estimates for fares.
import { CELL } from '../../core/constants';
import { hash2 } from '../../core/rng';
import { BFlag, RoadType, type Cell, type TransitLine, type TransitMode } from '../../core/types';
import { buildingDef } from '../../data/buildings';
import type { World } from '../../world/World';
import { K } from './graph';
import { dirBetween } from './lanes';
import { LINE_COLORS, paintFor } from './palette';
import type { TrafficSystem } from './TrafficSystem';
import { End, Start, type FreePath } from './VehicleStore';
import {
  Comp, DWELL, FREE_SPEED, METRO_DEPTH, Model, MONORAIL_HEIGHT, PMode, Purpose, TRANSIT_CAPACITY, TRANSIT_TYPE, VF, VS, VT,
} from './types';

export interface LineRT {
  id: number;
  key: string;
  /** 0 pending, 1 ready, 2 broken (unreachable leg) */
  status: number;
  /** grid loop path (bus, tram, train) */
  cells: Int32Array | null;
  /** loop path index of each stop */
  stopPi: Int32Array;
  /** free path (metro, ferry, monorail) */
  free: FreePath | null;
  /** distance along the free path of each stop */
  stopS: Float32Array;
  /** vehicle slots */
  veh: number[];
  req: number;
  /** world-space overlay polyline x,y,z (rendering), rebuilt with the path */
  overlay: Float32Array | null;
}

const GRID_MODES = new Set<TransitMode>(['bus', 'tram', 'train']);
const DEFAULT_VEHICLES: Record<TransitMode, number> = { bus: 3, tram: 2, metro: 2, train: 2, ferry: 1, monorail: 2 };
const APPEAL: Record<TransitMode, number> = { bus: 1, tram: 1.3, metro: 1.8, train: 1.55, ferry: 0.9, monorail: 1.5 };
const MODE_NAME: Record<TransitMode, string> = { bus: 'Bus', tram: 'Tram', metro: 'Metro', train: 'Train', ferry: 'Ferry', monorail: 'Monorail' };
const SUFFIXES = ['Market Street', 'Old Town', 'Parkway', 'Central', 'Hillside', 'Greenway', 'Uptown', 'Station Link', 'Lakeshore', 'Garden District', 'University', 'Heritage', 'Meadows', 'Orchard', 'Northgate', 'Southbank'];

export class TransitManager {
  readonly rt = new Map<number, LineRT>();
  /** bumped whenever a line path / stops / color change (renderers rebuild) */
  version = 0;
  private reqCounter = 1;
  private replanTimer = -1;

  constructor(private ts: TrafficSystem) {}

  private get world(): World {
    return this.ts.world!;
  }

  // ── validation ──────────────────────────────────────────────────────────
  /** can a stop of this mode be placed on the cell? (null = ok, else reason) */
  stopInvalidReason(mode: TransitMode, x: number, y: number): string | null {
    const w = this.world, g = this.ts.graph!;
    if (!w.inBounds(x, y)) return 'Outside the map';
    const i = w.idx(x, y);
    const k = g.kind[i];
    switch (mode) {
      case 'bus':
        if (!(k & K.Car)) return 'Bus stops need a road';
        if (k & K.Hwy) return 'No bus stops on highways';
        return null;
      case 'monorail':
        if (!(k & K.Car)) return 'Monorail stations go above roads';
        return null;
      case 'tram':
        return k & K.Tram ? null : 'Tram stops need an avenue with tram tracks';
      case 'train':
        return k & K.Rail ? null : 'Train stops need a railway';
      case 'ferry':
        return g.water[i] ? null : 'Ferry piers must be on water';
      case 'metro':
        if (g.water[i]) return 'Metro stations cannot be under water';
        return null;
    }
  }

  pathMode(mode: TransitMode): PMode | -1 {
    switch (mode) {
      case 'bus':
        return PMode.Car;
      case 'monorail':
        return PMode.Monorail;
      case 'tram':
        return PMode.Tram;
      case 'train':
        return PMode.Rail;
      case 'ferry':
        return PMode.Water;
      default:
        return -1;
    }
  }

  /** snap a hovered cell to the nearest valid stop cell for a mode (radius in cells) */
  snap(mode: TransitMode, x: number, y: number, radius = 2): Cell | null {
    if (this.stopInvalidReason(mode, x, y) === null) return { x, y };
    const w = this.world;
    let best: Cell | null = null, bd = Infinity;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!w.inBounds(cx, cy) || this.stopInvalidReason(mode, cx, cy) !== null) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { x: cx, y: cy };
        }
      }
    return best;
  }

  /** consecutive stops connected? (instant, via connected components) */
  legsReachable(mode: TransitMode, stops: Cell[]): boolean {
    const pm = this.pathMode(mode);
    if (pm === -1) return true;
    const w = this.world, g = this.ts.graph!;
    for (let k = 0; k < stops.length; k++) {
      const a = stops[k], b = stops[(k + 1) % stops.length];
      if (!g.reachable(pm, w.idx(a.x, a.y), w.idx(b.x, b.y))) return false;
    }
    return true;
  }

  normalizeStops(stops: Cell[]): Cell[] {
    const out: Cell[] = [];
    for (const s of stops) {
      const p = out[out.length - 1];
      if (p && p.x === s.x && p.y === s.y) continue;
      out.push({ x: s.x | 0, y: s.y | 0 });
    }
    while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
    return out;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  create(mode: TransitMode, stopsIn: Cell[]): TransitLine | null {
    const w = this.world;
    const stops = this.normalizeStops(stopsIn);
    if (stops.length < 2) return null;
    for (const s of stops) if (this.stopInvalidReason(mode, s.x, s.y) !== null) return null;
    if (!this.legsReachable(mode, stops)) return null;
    let id = 1;
    for (const l of w.transitLines) id = Math.max(id, l.id + 1);
    const used = new Set(w.transitLines.map((l) => l.color.toLowerCase()));
    const color = LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[(id - 1) % LINE_COLORS.length];
    const line: TransitLine = {
      id, mode, stops, color,
      name: this.nameFor(id, mode, stops),
      vehicles: Math.min(12, Math.max(DEFAULT_VEHICLES[mode], Math.ceil(stops.length / (mode === 'bus' ? 2 : 3)))),
      active: true,
      ridership: 0,
    };
    w.transitLines.push(line);
    line.ridership = this.estimateRidership(line);
    this.plan(line);
    this.version++;
    return line;
  }

  update(id: number, patch: Partial<Pick<TransitLine, 'name' | 'color' | 'vehicles' | 'active' | 'stops'>>): void {
    const line = this.world.transitLines.find((l) => l.id === id);
    if (!line) return;
    let replan = false;
    if (patch.name !== undefined) line.name = String(patch.name).slice(0, 48) || line.name;
    if (patch.color !== undefined) {
      line.color = patch.color;
      const rt = this.rt.get(id);
      if (rt) for (const s of rt.veh) this.ts.store.color[s] = colorNum(line.color);
    }
    if (patch.vehicles !== undefined) line.vehicles = Math.max(0, Math.min(40, Math.round(patch.vehicles)));
    if (patch.active !== undefined) line.active = !!patch.active;
    if (patch.stops !== undefined) {
      const st = this.normalizeStops(patch.stops);
      if (st.length >= 2) {
        line.stops = st;
        replan = true;
      }
    }
    if (replan) this.plan(line);
    else this.syncVehicles(line);
    line.ridership = this.estimateRidership(line);
    this.version++;
  }

  remove(id: number): void {
    const w = this.world;
    const k = w.transitLines.findIndex((l) => l.id === id);
    if (k < 0) return;
    w.transitLines.splice(k, 1);
    const rt = this.rt.get(id);
    if (rt) for (const s of rt.veh.slice()) this.ts.despawn(s);
    this.rt.delete(id);
    this.version++;
  }

  /** (re)attach runtime state for all persisted lines (after load) */
  attachAll(): void {
    for (const l of this.world.transitLines) {
      l.stops = this.normalizeStops(l.stops ?? []);
      this.plan(l);
    }
    this.version++;
  }

  /** roads / water changed: re-plan every line (throttled) */
  networkChanged(): void {
    this.replanTimer = 1.0;
  }

  // ── naming ──────────────────────────────────────────────────────────────
  private nameFor(id: number, mode: TransitMode, stops: Cell[]): string {
    const w = this.world;
    const tag = `${MODE_NAME[mode]} ${id}`;
    // a named district most stops are in
    const dcount = new Map<number, number>();
    for (const s of stops) {
      const d = w.district[w.idx(s.x, s.y)];
      if (d) dcount.set(d, (dcount.get(d) ?? 0) + 1);
    }
    let bestD = 0, bestC = 0;
    for (const [d, c] of dcount) if (c > bestC) (bestD = d), (bestC = c);
    const loop = stops.length > 2 && Math.abs(stops[0].x - stops[stops.length - 1].x) + Math.abs(stops[0].y - stops[stops.length - 1].y) < 12;
    if (bestD && bestC * 2 >= stops.length) {
      const dist = w.districts.find((d) => d.id === bestD);
      if (dist) return `${tag} — ${dist.name} ${loop ? 'Loop' : 'Line'}`;
    }
    // a landmark / notable service building near a stop
    let landmark = '', lscore = 0;
    for (const s of stops)
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const b = w.buildingAt(s.x + dx, s.y + dy);
          if (!b || b.kind !== 'service') continue;
          const def = buildingDef(b.defId);
          if (!def || def.category === 'power' || def.category === 'water' || def.category === 'garbage') continue;
          const score = def.cost + (def.category === 'landmark' || def.category === 'monument' || def.category === 'transit' ? 1e6 : 0);
          if (score > lscore) {
            lscore = score;
            landmark = b.name || def.name;
          }
        }
    // near water?
    let wet = 0;
    for (const s of stops) {
      let near = false;
      for (let r = -3; r <= 3 && !near; r++) for (let q = -3; q <= 3 && !near; q++) if (w.isWater(s.x + q, s.y + r)) near = true;
      if (near) wet++;
    }
    if (mode !== 'ferry' && wet * 2 > stops.length) return `${tag} — ${loop ? 'Harbor Loop' : 'Waterfront'}`;
    if (landmark && hash2(id, 7) % 3 !== 0) return `${tag} — ${landmark.replace(/\s+(Station|Terminal)$/i, '')} ${mode === 'bus' || mode === 'tram' ? 'Link' : 'Express'}`;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const s of stops) (minX = Math.min(minX, s.x)), (maxX = Math.max(maxX, s.x)), (minY = Math.min(minY, s.y)), (maxY = Math.max(maxY, s.y));
    if (loop) return `${tag} — ${hash2(id, 3) % 2 ? 'Circle' : 'City Loop'}`;
    if (maxY - minY > 2 * (maxX - minX) && maxY - minY > 20) return `${tag} — North–South`;
    if (maxX - minX > 2 * (maxY - minY) && maxX - minX > 20) return `${tag} — Crosstown`;
    return `${tag} — ${SUFFIXES[hash2(id, w.settings.seed) % SUFFIXES.length]}`;
  }

  // ── path planning ───────────────────────────────────────────────────────
  private plan(line: TransitLine): void {
    let rt = this.rt.get(line.id);
    const key = `${line.mode}|${line.stops.map((s) => s.x + ',' + s.y).join(';')}`;
    if (!rt) {
      rt = { id: line.id, key: '', status: 0, cells: null, stopPi: new Int32Array(0), free: null, stopS: new Float32Array(0), veh: [], req: 0, overlay: null };
      this.rt.set(line.id, rt);
    }
    rt.key = key;
    const req = (rt.req = this.reqCounter++);
    const w = this.world;
    const stops = line.stops;
    if (stops.length < 2) {
      rt.status = 2;
      this.syncVehicles(line);
      return;
    }
    if (line.mode === 'metro') {
      const pts: number[] = [];
      for (const s of stops) pts.push((s.x + 0.5) * CELL, (s.y + 0.5) * CELL);
      pts.push(pts[0], pts[1]);
      rt.free = makeFree(pts);
      rt.stopS = new Float32Array(stops.length);
      for (let k = 0; k < stops.length; k++) rt.stopS[k] = rt.free.cum[k];
      rt.cells = null;
      rt.status = 1;
      rt.overlay = this.freeOverlay(line, rt.free);
      this.version++;
      this.resetVehicles(line, rt);
      return;
    }
    const pm = this.pathMode(line.mode) as PMode;
    const legs: (Int32Array | null)[] = new Array(stops.length).fill(null);
    let got = 0, failed = false;
    rt.status = 0;
    for (let k = 0; k < stops.length; k++) {
      const a = stops[k], b = stops[(k + 1) % stops.length];
      this.ts.paths.request(pm, w.idx(a.x, a.y), w.idx(b.x, b.y), (p) => {
        if (rt!.req !== req) return;
        legs[k] = p;
        if (!p) failed = true;
        if (++got < stops.length) return;
        if (failed) {
          rt!.status = 2;
          rt!.cells = null;
          rt!.free = null;
          rt!.overlay = null;
          this.syncVehicles(line);
          this.version++;
          return;
        }
        this.buildLoop(line, rt!, legs as Int32Array[]);
      });
    }
  }

  private buildLoop(line: TransitLine, rt: LineRT, legs: Int32Array[]): void {
    const size = this.world.size;
    const long = line.mode === 'train' || line.mode === 'tram';
    const cells: number[] = [];
    const stopPi: number[] = [];
    const S = legs.length;
    for (let k = 0; k < S; k++) {
      const leg = legs[k];
      // leg k goes from stop k to stop k+1; stop k is leg[0]
      if (k === 0) {
        stopPi.push(0);
        for (let j = 0; j < leg.length; j++) cells.push(leg[j]);
      } else {
        // cells already ends with stop k (last cell of leg k-1)
        stopPi.push(cells.length - 1);
        const arrive = cells.length >= 2 ? dirBetween(size, cells[cells.length - 2], cells[cells.length - 1]) : -1;
        const depart = leg.length >= 2 ? dirBetween(size, leg[0], leg[1]) : -1;
        if (long && arrive >= 0 && depart === ((arrive + 2) & 3)) cells.push(leg[0]); // reversal marker
        for (let j = 1; j < leg.length; j++) cells.push(leg[j]);
      }
    }
    // the loop closes on stop 0: drop the duplicated final cell (or keep it as a reversal marker)
    const last = cells.length - 1;
    const arrive0 = last >= 1 ? dirBetween(size, cells[last - 1], cells[last]) : -1;
    const depart0 = cells.length >= 2 ? dirBetween(size, cells[0], cells[1]) : -1;
    if (long && arrive0 >= 0 && depart0 === ((arrive0 + 2) & 3)) {
      // arrival visit of stop 0 is the final cell; departures start at index 0
      stopPi[0] = last;
    } else {
      cells.pop();
      stopPi[0] = 0;
    }
    const arr = Int32Array.from(cells);
    rt.stopPi = Int32Array.from(stopPi);
    if (line.mode === 'ferry' || line.mode === 'monorail') {
      const pts: number[] = [];
      for (let j = 0; j < arr.length; j++) pts.push(((arr[j] % size) + 0.5) * CELL, (Math.floor(arr[j] / size) + 0.5) * CELL);
      // run each direction on its own side (two guideways / sailing lanes, turnaround loops at the ends)
      const off = (line.mode === 'ferry' ? 5 : 2.1) * this.ts.hand;
      const sm = chaikin(offsetLoop(pts, off), line.mode === 'ferry' ? 3 : 2);
      rt.free = makeFree(sm);
      rt.stopS = new Float32Array(line.stops.length);
      let from = 0;
      for (let k = 0; k < line.stops.length; k++) {
        const s = line.stops[k];
        from = k === 0 ? nearestS(rt.free, (s.x + 0.5) * CELL, (s.y + 0.5) * CELL) : nearestSFrom(rt.free, (s.x + 0.5) * CELL, (s.y + 0.5) * CELL, from);
        rt.stopS[k] = from;
      }
      rt.cells = arr;
      rt.overlay = this.freeOverlay(line, rt.free);
    } else {
      const same = rt.cells && rt.cells.length === arr.length && rt.cells.every((c, j) => c === arr[j]);
      rt.cells = arr;
      rt.free = null;
      rt.overlay = this.gridOverlay(arr);
      rt.status = 1;
      this.version++;
      if (same) {
        this.syncVehicles(line);
        return;
      }
    }
    rt.status = 1;
    this.version++;
    this.resetVehicles(line, rt);
  }

  private gridOverlay(cells: Int32Array): Float32Array {
    const w = this.world, size = w.size, rs = this.ts.game.roadSurface;
    const out = new Float32Array((cells.length + 1) * 3);
    for (let j = 0; j <= cells.length; j++) {
      const c = cells[j % cells.length];
      const x = ((c % size) + 0.5) * CELL, z = (Math.floor(c / size) + 0.5) * CELL;
      out[j * 3] = x;
      out[j * 3 + 1] = rs ? rs.heightAt(x, z) : w.heightAt(x, z);
      out[j * 3 + 2] = z;
    }
    return out;
  }

  private freeOverlay(line: TransitLine, f: FreePath): Float32Array {
    const n = f.pts.length / 2;
    const out = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) {
      const x = f.pts[j * 2], z = f.pts[j * 2 + 1];
      out[j * 3] = x;
      out[j * 3 + 1] = this.freeHeight(line.mode, x, z);
      out[j * 3 + 2] = z;
    }
    return out;
  }

  /** height of a free-path vehicle / guideway at a point */
  freeHeight(mode: TransitMode, x: number, z: number): number {
    const w = this.world;
    if (mode === 'metro') return w.heightAt(x, z) - METRO_DEPTH;
    if (mode === 'ferry') {
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      const lvl = w.waterLevel(cx, cy);
      return lvl > -1000 ? lvl : w.heightAt(x, z);
    }
    const rs = this.ts.game.roadSurface;
    return (rs ? rs.heightAt(x, z) : w.heightAt(x, z)) + MONORAIL_HEIGHT;
  }

  // ── vehicles ─────────────────────────────────────────────────────────────
  private resetVehicles(line: TransitLine, rt: LineRT): void {
    for (const s of rt.veh.slice()) this.ts.despawn(s);
    rt.veh = [];
    this.syncVehicles(line);
  }

  /** spawn / remove vehicles to match line.vehicles and line.active */
  syncVehicles(line: TransitLine): void {
    const rt = this.rt.get(line.id);
    if (!rt) return;
    const want = line.active && rt.status === 1 ? line.vehicles : 0;
    while (rt.veh.length > want) this.ts.despawn(rt.veh[rt.veh.length - 1]);
    const have = rt.veh.length;
    for (let j = have; j < want; j++) {
      const slot = this.spawnLineVehicle(line, rt, j, want);
      if (slot < 0) break;
    }
  }

  private spawnLineVehicle(line: TransitLine, rt: LineRT, j: number, of: number): number {
    const ts = this.ts, st = ts.store;
    const mode = line.mode;
    const type = TRANSIT_TYPE[mode];
    let model = Model.Bus, comp = Comp.Single, nsec = 1;
    if (mode === 'tram') (model = Model.TramHead), (comp = Comp.Tram), (nsec = 3);
    else if (mode === 'train') (model = Model.Locomotive), (comp = Comp.Train), (nsec = 4 + (line.id % 2));
    else if (mode === 'monorail') (model = Model.MonorailHead), (comp = Comp.Monorail), (nsec = 3);
    else if (mode === 'metro') model = Model.Metro;
    else if (mode === 'ferry') model = Model.Ferry;
    const color = colorNum(line.color);
    const seed = hash2(line.id * 131 + j, 77);
    let flags = VF.Transit | (nsec > 1 ? VF.Long : 0);
    const S = line.stops.length;
    if (GRID_MODES.has(mode) && rt.cells) {
      const n = rt.cells.length;
      const pi = Math.floor((j * n) / Math.max(1, of)) % n;
      // next stop ahead of pi along the loop
      let stopI = 0, best = Infinity;
      for (let k = 0; k < S; k++) {
        const ahead = (((rt.stopPi[k] - pi) % n) + n) % n;
        if (ahead < best) (best = ahead), (stopI = k);
      }
      const slot = ts.spawn({
        type, model, comp, nsec, color, flags, seed, purpose: Purpose.Transit,
        path: rt.cells, loop: true, pi, s: 0,
        startMode: Start.Mid, startDir: -1, endMode: End.Loop, endDir: -1, line: line.id, stopI: stopI % S,
      });
      rt.veh.push(slot);
      return slot;
    }
    if (rt.free) {
      flags |= VF.Free;
      if (mode === 'metro') flags |= VF.Underground;
      if (mode === 'ferry') flags |= VF.Water;
      if (mode === 'monorail') flags |= VF.Elevated;
      const slot = st.alloc();
      st.type[slot] = VT[type];
      st.model[slot] = model;
      st.comp[slot] = comp;
      st.nsec[slot] = nsec;
      st.color[slot] = color;
      st.flags[slot] = flags;
      st.seed[slot] = seed;
      st.purpose[slot] = Purpose.Transit;
      st.line[slot] = line.id;
      st.free[slot] = rt.free;
      st.fs[slot] = (rt.free.total * j) / Math.max(1, of);
      let stopI = 0, best = Infinity;
      for (let k = 0; k < S; k++) {
        let ahead = (rt.stopS[k] % rt.free.total) - st.fs[slot];
        if (ahead < 0) ahead += rt.free.total;
        if (ahead < best) (best = ahead), (stopI = k);
      }
      st.stopI[slot] = stopI;
      st.state[slot] = VS.Drive;
      st.fade[slot] = 1;
      ts.initShape(slot);
      st.activate(slot);
      this.freePose(slot);
      rt.veh.push(slot);
      return slot;
    }
    return -1;
  }

  /** a line vehicle left the simulation */
  gone(i: number): void {
    const rt = this.rt.get(this.ts.store.line[i]);
    if (!rt) return;
    const k = rt.veh.indexOf(i);
    if (k >= 0) rt.veh.splice(k, 1);
  }

  /** path index of the next stop for a grid line vehicle */
  nextStopPi(i: number): number {
    const st = this.ts.store;
    const rt = this.rt.get(st.line[i]);
    if (!rt || !rt.stopPi.length) return -1;
    return rt.stopPi[st.stopI[i] % rt.stopPi.length];
  }

  stopReached(i: number): number {
    const st = this.ts.store;
    const line = this.world.transitLines.find((l) => l.id === st.line[i]);
    return (line ? DWELL[line.mode] : 5) * (0.85 + 0.3 * ((st.seed[i] >>> 8) % 100) / 100);
  }

  /** a grid line vehicle is stuck: put it at its next stop */
  unstick(i: number): void {
    const ts = this.ts, st = ts.store;
    const rt = this.rt.get(st.line[i]);
    if (!rt || !rt.cells) {
      ts.despawn(i);
      return;
    }
    st.stopI[i] = (st.stopI[i] + 1) % Math.max(1, rt.stopPi.length);
    const pi = rt.stopPi[st.stopI[i]] ?? 0;
    st.pi[i] = pi;
    st.s[i] = 0;
    st.v[i] = 0;
    st.stuck[i] = 0;
    st.commit[i] = -1;
    st.state[i] = VS.Drive;
    st.fade[i] = 0;
    ts.mover!.primeEntry(i, pi);
    ts.mover!.enterCell(i, pi);
    ts.mover!.pose(i);
  }

  /** per-frame: free-path vehicles, throttled re-planning */
  updateFree(dt: number): void {
    if (this.replanTimer > 0) {
      this.replanTimer -= dt > 0 ? dt : 0.016;
      if (this.replanTimer <= 0) {
        for (const l of this.world.transitLines) this.plan(l);
        this.version++;
      }
    }
    if (dt <= 0) return;
    const st = this.ts.store;
    for (const rt of this.rt.values()) {
      if (!rt.free || !rt.veh.length) continue;
      const line = this.world.transitLines.find((l) => l.id === rt.id);
      if (!line) continue;
      const vmax = FREE_SPEED[line.mode];
      const total = rt.free.total;
      const S = rt.stopS.length;
      for (const i of rt.veh) {
        if (!(st.flags[i] & VF.Free)) continue;
        if (st.state[i] === VS.Dwell) {
          st.timer[i] -= dt;
          st.v[i] = 0;
          if (st.timer[i] <= 0) {
            st.state[i] = VS.Drive;
            st.stopI[i] = (st.stopI[i] + 1) % S;
          }
          continue;
        }
        const fs = st.fs[i];
        let target = rt.stopS[st.stopI[i] % S] % total;
        let dist = target - (fs % total);
        if (dist < -0.01) dist += total;
        // headway: slow down behind the next vehicle of the line
        let gap = Infinity;
        for (const j of rt.veh) {
          if (j === i) continue;
          let d = (st.fs[j] % total) - (fs % total);
          if (d <= 0) d += total;
          if (d < gap) gap = d;
        }
        const brake = 1.1;
        let v0 = Math.min(vmax, Math.sqrt(2 * brake * Math.max(0, dist - 0.3)) + 0.3);
        const L = st.len[i];
        if (gap < Infinity) v0 = Math.min(v0, Math.max(0, (gap - L - 25) * 0.25));
        const v = st.v[i];
        const nv = v < v0 ? Math.min(v0, v + 0.9 * dt) : Math.max(v0, v - 2.2 * dt);
        st.v[i] = Math.max(0, nv);
        st.acc[i] = (nv - v) / dt;
        let step = st.v[i] * dt;
        if (step >= dist) {
          step = dist;
          st.state[i] = VS.Dwell;
          st.timer[i] = DWELL[line.mode];
          st.v[i] = 0;
          target = 0;
        }
        st.fs[i] = (fs + step) % total;
        this.freePose(i);
      }
    }
  }

  /** point `back` meters behind free-path vehicle i: x, z, tangent */
  freePoint(i: number, back: number, out: { x: number; z: number; tx: number; tz: number }): void {
    const st = this.ts.store;
    const f = st.free[i];
    if (!f) return;
    let s = (st.fs[i] - back) % f.total;
    if (s < 0) s += f.total;
    samplePath(f, s, out);
  }

  private tmp = { x: 0, z: 0, tx: 0, tz: 1 };
  private freePose(i: number): void {
    const st = this.ts.store;
    const f = st.free[i];
    if (!f) return;
    samplePath(f, st.fs[i], this.tmp);
    st.x[i] = this.tmp.x;
    st.z[i] = this.tmp.z;
    st.yaw[i] = Math.atan2(this.tmp.tx, this.tmp.tz);
  }

  // ── ridership ───────────────────────────────────────────────────────────
  /** passengers per month from homes / jobs / visitors within ~6 cells of the stops */
  estimateRidership(line: TransitLine): number {
    if (!line.active || line.vehicles <= 0 || line.stops.length < 2) return 0;
    const w = this.world;
    const R = 6;
    let res = 0, jobs = 0, vis = 0;
    const stops = line.stops;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const s of stops) (minX = Math.min(minX, s.x)), (maxX = Math.max(maxX, s.x)), (minY = Math.min(minY, s.y)), (maxY = Math.max(maxY, s.y));
    for (const b of w.buildings.values()) {
      if (b.built < 1 || b.flags & (BFlag.Abandoned | BFlag.Collapsed)) continue;
      const bx = b.x + b.w / 2, by = b.y + b.h / 2;
      if (bx < minX - R || bx > maxX + R || by < minY - R || by > maxY + R) continue;
      let best = 0;
      for (const s of stops) {
        const d = Math.hypot(bx - (s.x + 0.5), by - (s.y + 0.5));
        if (d <= R + 1) best = Math.max(best, 1 - d / (R + 1.5));
      }
      if (best <= 0) continue;
      res += b.residents * best;
      jobs += b.workers * best;
      vis += b.visitors * best;
    }
    const mods = this.ts.modifiers();
    const cover = Math.min(1.4, 0.55 + 0.1 * stops.length);
    const monthly = (res * 0.6 + jobs * 0.4 + vis * 0.15) * APPEAL[line.mode] * cover * Math.sqrt(Math.max(0.5, mods.trafficMult)) * Math.sqrt(Math.max(0.3, mods.tourismMult));
    const capacity = line.vehicles * TRANSIT_CAPACITY[line.mode] * 30;
    return Math.round(Math.min(monthly, capacity));
  }

  monthly(): void {
    for (const l of this.world.transitLines) l.ridership = this.estimateRidership(l);
  }

  clear(): void {
    this.rt.clear();
    this.version++;
  }

  /** stop cell ids (for renderers) */
  lineOf(id: number): TransitLine | undefined {
    return this.world.transitLines.find((l) => l.id === id);
  }

  /** is cell a rail/tram-capable road type (for tool snapping text) */
  static roadName(t: RoadType): string {
    return t === RoadType.Rail ? 'railway' : t === RoadType.TramAvenue ? 'tram avenue' : 'road';
  }
}

export function colorNum(css: string): number {
  const s = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/i.test(s)) return parseInt(s[1] + s[1] + s[2] + s[2] + s[3] + s[3], 16);
  return 0x29b6f6;
}

function makeFree(pts: number[]): FreePath {
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  for (let j = 1; j < n; j++) cum[j] = cum[j - 1] + Math.hypot(pts[j * 2] - pts[j * 2 - 2], pts[j * 2 + 1] - pts[j * 2 - 1]);
  return { pts: Float32Array.from(pts), cum, total: Math.max(1, cum[n - 1]) };
}

/**
 * Offset an implicitly closed polyline (x,z pairs, last point connects back to
 * the first) to the right of travel by `off` meters. Reversals (out-and-back
 * lines) become a small turnaround loop. Returns a closed list (first point
 * repeated at the end).
 */
function offsetLoop(pts: number[], off: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const a = (j - 1 + n) % n, b = (j + 1) % n;
    const px = pts[j * 2], pz = pts[j * 2 + 1];
    let t1x = px - pts[a * 2], t1z = pz - pts[a * 2 + 1];
    let t2x = pts[b * 2] - px, t2z = pts[b * 2 + 1] - pz;
    const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
    t1x /= l1;
    t1z /= l1;
    t2x /= l2;
    t2z /= l2;
    const r1x = -t1z, r1z = t1x, r2x = -t2z, r2z = t2x;
    if (t1x * t2x + t1z * t2z < -0.5) {
      out.push(px + r1x * off + t1x * Math.abs(off) * 0.9, pz + r1z * off + t1z * Math.abs(off) * 0.9);
      out.push(px + r2x * off - t2x * Math.abs(off) * 0.9, pz + r2z * off - t2z * Math.abs(off) * 0.9);
      continue;
    }
    let nx = r1x + r2x, nz = r1z + r2z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const k = off / Math.max(0.5, nx * r1x + nz * r1z);
    out.push(px + nx * k, pz + nz * k);
  }
  out.push(out[0], out[1]);
  return out;
}

/** closed-polyline Chaikin corner cutting (first == last point) */
function chaikin(pts: number[], iters: number): number[] {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const n = p.length / 2 - 1; // segments
    const out: number[] = [];
    for (let j = 0; j < n; j++) {
      const ax = p[j * 2], az = p[j * 2 + 1], bx = p[j * 2 + 2], bz = p[j * 2 + 3];
      out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
    }
    out.push(out[0], out[1]);
    p = out;
  }
  return p;
}

function samplePath(f: FreePath, s: number, out: { x: number; z: number; tx: number; tz: number }): void {
  const cum = f.cum, pts = f.pts;
  const n = cum.length;
  s = ((s % f.total) + f.total) % f.total;
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = Math.max(1e-4, cum[hi] - cum[lo]);
  const t = (s - cum[lo]) / segLen;
  const ax = pts[lo * 2], az = pts[lo * 2 + 1], bx = pts[hi * 2], bz = pts[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  let tx = bx - ax, tz = bz - az;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  out.tx = tx;
  out.tz = tz;
}

function nearestS(f: FreePath, x: number, z: number): number {
  let best = 0, bd = Infinity;
  const n = f.cum.length;
  for (let j = 0; j < n - 1; j++) {
    const ax = f.pts[j * 2], az = f.pts[j * 2 + 1], bx = f.pts[j * 2 + 2], bz = f.pts[j * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t, pz = az + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) {
      bd = d;
      best = f.cum[j] + Math.sqrt(l2) * t;
    }
  }
  return best;
}

/** first close approach to (x, z) travelling forward from distance `from` (wrapping) */
function nearestSFrom(f: FreePath, x: number, z: number, from: number): number {
  const n = f.cum.length - 1;
  let j0 = 0;
  const base = from % f.total;
  while (j0 < n - 1 && f.cum[j0 + 1] <= base) j0++;
  let best = -1, bd = Infinity;
  for (let k = 0; k < n; k++) {
    const j = (j0 + k) % n;
    const ax = f.pts[j * 2], az = f.pts[j * 2 + 1], bx = f.pts[j * 2 + 2], bz = f.pts[j * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < bd) {
      bd = d;
      let sAbs = f.cum[j] + Math.sqrt(l2) * t;
      if (j < j0 || (j === j0 && sAbs < base)) sAbs += f.total;
      best = sAbs + (from - base);
    } else if (bd < 10 && d > bd + 20) break;
  }
  return best < 0 ? from : best;
}

export { samplePath };
