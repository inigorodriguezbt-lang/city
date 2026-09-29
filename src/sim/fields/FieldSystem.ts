// ─────────────────────────────────────────────────────────────────────────────
// FieldSystem: schedules field recomputes in a Web Worker and writes the
// results into world.fields. Public API is FROZEN (add, don't change).
//
// Scheduling
//  • About once per in-game day while time runs (a faster game speed simply
//    launches the next job as soon as the previous one returns — never more
//    than one job in flight).
//  • Soon after edits: road / terrain / water changes and service buildings
//    (added, removed, changed) within ~300 ms real; zoned growth within ~1.5 s.
//  • requestRecompute() forces the next job within ~300 ms; recomputeNow()
//    awaits a fresh full (unsmoothed) result — used right after a load.
//
// A job is a snapshot of the world packed into transferable typed arrays (see
// pack.ts); the worker hands every buffer back with its result, so steady-state
// recomputes allocate almost nothing. world.fields.traffic (traffic system)
// and the static resources fertility / ore / oil / wind are never written.
// If workers are unavailable the same engine runs on the main thread.
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { Layer, type Building, type FieldId } from '../../core/types';
import { WorkerRPC } from '../../core/rpc';
import FieldsWorker from '../../workers/fields.worker?worker&inline';
import type { FieldEngine } from './engine';
import { BufferPool, BuildingPacker, packStops, packTerrain, weatherPacket, type UtilityMods } from './pack';
import { OUTPUT_FIELDS, type FieldJob, type FieldResult } from './protocol';

export interface NetworkSummary {
  produced: number;
  consumed: number;
  /** cells/buildings connected */
  connected: number;
}

/** Diagnostics of the most recent recompute. */
export interface FieldTimings {
  /** main-thread packing (ms) */
  packMs: number;
  /** engine compute time (ms) */
  computeMs: number;
  /** request → applied (ms) */
  latencyMs: number;
  /** per-stage breakdown of the engine */
  stages: Record<string, number>;
  /** completed recomputes this session */
  jobs: number;
  /** where the engine runs */
  mode: 'worker' | 'main';
}

/** Real-time delays before a requested recompute runs. */
const URGENT_MS = 300;
const SOFT_MS = 1500;
/** In-game days between routine recomputes. */
const DAYS_PER_JOB = 1;
/** Minimum real time between routine jobs (keeps packing off hot frames at 10x). */
const MIN_GAP_MS = 250;
/** Consecutive worker failures before falling back to the main thread. */
const WORKER_RETRIES = 2;

export class FieldSystem {
  protected world: World | null = null;
  /** last computed utility summaries */
  power: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };
  water: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };
  sewage: NetworkSummary = { produced: 0, consumed: 0, connected: 0 };
  /** diagnostics of the last recompute */
  readonly timings: FieldTimings = { packMs: 0, computeMs: 0, latencyMs: 0, stages: {}, jobs: 0, mode: 'worker' };

  private rpc: WorkerRPC | null = null;
  private engine: FieldEngine | null = null;
  private workerDead = false;
  private failures = 0;
  /** world session; results of older sessions are discarded */
  private token = 0;
  private inFlight: Promise<boolean> | null = null;
  /** performance.now() at which a requested recompute becomes due */
  private dueAt = Number.POSITIVE_INFINITY;
  private lastJobDay = 0;
  private lastJobReal = Number.NEGATIVE_INFINITY;
  private terrainDirty = true;
  private treesDirty = true;
  private lastFlood = 0;
  private readonly packer = new BuildingPacker();
  private readonly pool = new BufferPool();

  constructor(protected game: Game) {
    const ev = game.events;
    ev.on('world:changed', ({ layers }) => {
      if (!this.world) return;
      if (layers & (Layer.Terrain | Layer.Water)) this.terrainDirty = true;
      if (layers & Layer.Tree) this.treesDirty = true;
      if (layers & (Layer.Road | Layer.Terrain | Layer.Water)) this.schedule(URGENT_MS);
      else if (layers & (Layer.Building | Layer.Zone)) this.schedule(SOFT_MS);
    });
    const onService = (b: Building): void => {
      if (this.world && b.kind === 'service') this.schedule(URGENT_MS);
    };
    ev.on('building:added', onService);
    ev.on('building:changed', onService);
    ev.on('building:removed', (b) => {
      this.packer.forget(b.id);
      onService(b);
    });
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    this.token++;
    this.terrainDirty = true;
    this.treesDirty = true;
    this.lastFlood = world.floodOffset;
    this.packer.clear();
    this.lastJobDay = world.time.day;
    this.lastJobReal = Number.NEGATIVE_INFINITY;
    this.dueAt = Number.POSITIVE_INFINITY;
    this.power = { produced: 0, consumed: 0, connected: 0 };
    this.water = { produced: 0, consumed: 0, connected: 0 };
    this.sewage = { produced: 0, consumed: 0, connected: 0 };
    this.timings.jobs = 0;
  }

  onWorldUnloaded(): void {
    this.world = null;
    this.token++;
    this.dueAt = Number.POSITIVE_INFINITY;
    this.packer.clear();
    this.pool.clear();
  }

  /** schedules async worker recomputes; writes into world.fields when done */
  update(_dt: number): void {
    const w = this.world;
    if (!w || this.inFlight) return;
    const now = performance.now();
    if (now >= this.dueAt) {
      this.launch(false);
      return;
    }
    if (w.time.speed > 0 && w.time.day - this.lastJobDay >= DAYS_PER_JOB && now - this.lastJobReal >= MIN_GAP_MS) this.launch(false);
  }

  /** ask for a recompute as soon as possible (e.g. after big edits) */
  requestRecompute(_fields?: FieldId[]): void {
    // every job recomputes all derived fields; the list is accepted for API compatibility
    if (this.world) this.schedule(URGENT_MS);
  }

  /** await a full synchronous-ish recompute (tests, after load) */
  async recomputeNow(): Promise<void> {
    const w = this.world;
    if (!w) return;
    for (let attempt = 0; attempt <= WORKER_RETRIES; attempt++) {
      while (this.inFlight) await this.inFlight;
      if (this.world !== w) return;
      const job = this.execute(true);
      this.inFlight = job;
      let ok = false;
      try {
        ok = await job;
      } finally {
        if (this.inFlight === job) this.inFlight = null;
      }
      if (ok || this.world !== w) return;
    }
    throw new Error('field recompute failed');
  }

  /** true while a job is being computed */
  get busy(): boolean {
    return this.inFlight !== null;
  }

  // ── internals ───────────────────────────────────────────────────────────
  private schedule(delayMs: number): void {
    const due = performance.now() + delayMs;
    if (due < this.dueAt) this.dueAt = due;
  }

  private launch(full: boolean): void {
    const job = this.execute(full);
    this.inFlight = job;
    void job.finally(() => {
      if (this.inFlight === job) this.inFlight = null;
    });
  }

  /** Pack, compute and apply one job. Resolves true when results were applied. Never rejects. */
  private async execute(full: boolean): Promise<boolean> {
    const w = this.world;
    if (!w) return false;
    const t0 = performance.now();
    let job: FieldJob;
    try {
      job = this.buildJob(w, full);
    } catch (err) {
      console.error('[fields] packing failed', err);
      this.dueAt = performance.now() + 1000;
      this.lastJobReal = performance.now();
      return false;
    }
    const t1 = performance.now();
    this.timings.packMs = t1 - t0;
    let result: FieldResult;
    try {
      result = await this.dispatch(job);
    } catch (err) {
      this.failures++;
      console.warn(`[fields] recompute failed (${this.failures})`, err);
      // the engine may have missed the terrain / forest inputs of this job
      this.terrainDirty = true;
      this.treesDirty = true;
      if (this.failures >= WORKER_RETRIES && !this.workerDead) {
        console.warn('[fields] worker unavailable, computing fields on the main thread');
        this.rpc?.terminate();
        this.rpc = null;
        this.workerDead = true;
      }
      if (this.world === w) this.schedule(1000);
      return false;
    }
    this.failures = 0;
    return this.apply(w, result, t0);
  }

  private async dispatch(job: FieldJob): Promise<FieldResult> {
    if (!this.workerDead) {
      if (!this.rpc) {
        try {
          this.rpc = new WorkerRPC(new FieldsWorker());
        } catch (err) {
          console.warn('[fields] could not start the worker', err);
          this.workerDead = true;
        }
      }
      if (this.rpc) {
        this.timings.mode = 'worker';
        return this.rpc.call<FieldResult>('compute', job, transferList(job));
      }
    }
    if (!this.engine) {
      const { FieldEngine } = await import('./engine');
      this.engine = new FieldEngine();
    }
    this.timings.mode = 'main';
    return this.engine.run(job);
  }

  private buildJob(w: World, full: boolean): FieldJob {
    const s = w.size, n = s * s, pool = this.pool;
    const copy = (src: Uint8Array): Uint8Array => {
      const a = new Uint8Array(pool.take(n));
      a.set(src.length === n ? src : src.subarray(0, n));
      return a;
    };
    const road = copy(w.road);
    const roadFlags = copy(w.roadFlags);
    const zone = copy(w.zone);
    const trees = copy(w.trees);
    const traffic = copy(w.fields.traffic);
    let terrain;
    if (this.terrainDirty || full || w.floodOffset !== this.lastFlood) {
      terrain = packTerrain(w, pool);
      this.terrainDirty = false;
      this.lastFlood = w.floodOffset;
    }
    const recs = this.packer.pack(w, this.modifiers(), pool);
    const { stops, stopCount } = packStops(w, pool);
    const days = full ? 0 : Math.max(0, Math.min(60, w.time.day - this.lastJobDay));
    const treesChanged = this.treesDirty || full;
    this.treesDirty = false;
    this.lastJobDay = w.time.day;
    this.lastJobReal = performance.now();
    this.dueAt = Number.POSITIVE_INFINITY;
    return {
      token: this.token, size: s, full, days, terrain,
      road, roadFlags, zone, trees, treesChanged, traffic,
      recI: recs.recI, recF: recs.recF, count: recs.count,
      stops, stopCount,
      weather: weatherPacket(w),
      rainfall: w.theme?.rainfall ?? 0.5,
      recycle: pool.takeUpTo(n, OUTPUT_FIELDS.length),
    };
  }

  private apply(w: World, result: FieldResult, startedAt: number): boolean {
    const pool = this.pool;
    const current = result.token === this.token && this.world === w;
    const ids: FieldId[] = [];
    for (const id of OUTPUT_FIELDS) {
      const arr = result.fields[id];
      if (!arr) continue;
      if (current) {
        const dst = w.fields[id];
        if (dst && dst.length === arr.length) dst.set(arr);
        else w.fields[id] = arr.slice();
        ids.push(id);
      }
      if (current) pool.put(arr.buffer as ArrayBuffer);
    }
    // buffers of a finished session are simply dropped
    if (!current) return false;
    for (const b of result.recycle) pool.put(b);
    this.power = { ...result.power };
    this.water = { ...result.water };
    this.sewage = { ...result.sewage };
    this.timings.computeMs = result.ms;
    this.timings.stages = result.stages;
    this.timings.latencyMs = performance.now() - startedAt;
    this.timings.jobs++;
    this.game.events.emit('fields:updated', ids);
    return true;
  }

  private modifiers(): UtilityMods {
    try {
      const m = this.game.eventSystem?.modifiers();
      if (m) return { powerUseMult: m.powerUseMult, waterUseMult: m.waterUseMult, waterSupplyMult: m.waterSupplyMult };
    } catch (err) {
      console.warn('[fields] event modifiers unavailable', err);
    }
    return { powerUseMult: 1, waterUseMult: 1, waterSupplyMult: 1 };
  }
}

/** Every distinct buffer of a job (they all move to the worker). */
function transferList(job: FieldJob): Transferable[] {
  const set = new Set<ArrayBuffer>();
  const add = (v: ArrayBufferView | undefined): void => {
    if (v) set.add(v.buffer as ArrayBuffer);
  };
  add(job.road);
  add(job.roadFlags);
  add(job.zone);
  add(job.trees);
  add(job.traffic);
  add(job.recI);
  add(job.recF);
  add(job.stops);
  add(job.terrain?.heights);
  add(job.terrain?.water);
  if (job.recycle) for (const b of job.recycle) set.add(b);
  return [...set];
}
