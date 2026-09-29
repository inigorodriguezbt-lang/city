// Path service: batches A* requests to the path worker (?worker&inline +
// WorkerRPC), caches frequent origin/destination pairs, keeps the worker's
// road / water / congestion copies in sync, and falls back to a main-thread
// pathfinder (time-budgeted) if the worker cannot be created.
import { WorkerRPC } from '../../core/rpc';
import type { Rect } from '../../core/types';
import type { World } from '../../world/World';
import PathWorker from '../../workers/path.worker?worker&inline';
import type { PathBatchResult } from '../../workers/path.worker';
import { GridPathfinder } from './astar';
import type { RoadGraph } from './graph';
import { PMode } from './types';

export type PathCallback = (path: Int32Array | null) => void;

interface Req {
  mode: PMode;
  s: number;
  t: number;
  key: number;
  cbs: PathCallback[];
}

const BATCH = 96;
const MAX_IN_FLIGHT = 2;
const CACHE_MAX = 2400;
/** cached car paths expire (congestion changes), seconds */
const CACHE_TTL = 45;

export class PathService {
  private rpc: WorkerRPC | null = null;
  private fallback: GridPathfinder | null = null;
  private queue: Req[] = [];
  private queued = new Map<number, Req>();
  private inFlight = 0;
  private cache = new Map<number, { p: Int32Array | null; t: number }>();
  private n2: number;
  private time = 0;
  private disposed = false;
  private ready: Promise<unknown> | null = null;
  /** statistics */
  readonly stats = { requests: 0, cacheHits: 0, failures: 0, workerMs: 0 };

  constructor(private world: World, private graph: RoadGraph) {
    this.n2 = world.size * world.size;
    try {
      this.rpc = new WorkerRPC(new PathWorker());
      this.ready = this.rpc.call('init', { size: world.size, road: world.road.slice(), water: graph.water.slice() }).catch((e) => {
        console.warn('[traffic] path worker init failed, using main thread', e);
        this.useFallback();
      });
    } catch (e) {
      console.warn('[traffic] path worker unavailable, using main thread', e);
      this.useFallback();
    }
  }

  private useFallback(): void {
    this.rpc?.terminate();
    this.rpc = null;
    const pf = new GridPathfinder(this.world.size);
    pf.road.set(this.world.road);
    pf.water.set(this.graph.water);
    this.fallback = pf;
  }

  get pending(): number {
    return this.queue.length + this.inFlight * BATCH;
  }

  /** Request a path; the callback may run synchronously (cache hit). */
  request(mode: PMode, s: number, t: number, cb: PathCallback, useCache = true): void {
    if (this.disposed) return;
    this.stats.requests++;
    const key = (mode * this.n2 + s) * this.n2 + t;
    if (useCache) {
      const c = this.cache.get(key);
      if (c && this.time - c.t < CACHE_TTL) {
        this.stats.cacheHits++;
        // refresh LRU position
        this.cache.delete(key);
        this.cache.set(key, c);
        cb(c.p);
        return;
      }
    }
    const q = this.queued.get(key);
    if (q) {
      q.cbs.push(cb);
      return;
    }
    const r: Req = { mode, s, t, key, cbs: [cb] };
    this.queue.push(r);
    this.queued.set(key, r);
  }

  /** road types changed in a rect: patch the worker copy and drop cached paths */
  roadsChanged(r: Rect): void {
    this.cache.clear();
    const w = this.world;
    const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0), x1 = Math.min(w.size - 1, r.x1), y1 = Math.min(w.size - 1, r.y1);
    if (x1 < x0 || y1 < y0) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (this.fallback) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.fallback.road[y * w.size + x] = w.road[y * w.size + x];
      return;
    }
    if (!this.rpc) return;
    const road = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) road.set(w.road.subarray((y0 + y) * w.size + x0, (y0 + y) * w.size + x0 + bw), y * bw);
    this.rpc.call('patch', { x0, y0, w: bw, h: bh, road }, [road.buffer]).catch(() => {});
  }

  waterChanged(): void {
    this.cache.clear();
    if (this.fallback) this.fallback.water.set(this.graph.water);
    else if (this.rpc) {
      const water = this.graph.water.slice();
      this.rpc.call('water', { water }, [water.buffer]).catch(() => {});
    }
  }

  /** send the current congestion snapshot (world.fields.traffic) */
  congestion(traffic: Uint8Array): void {
    if (this.fallback) this.fallback.cong.set(traffic);
    else if (this.rpc) {
      const cong = traffic.slice();
      this.rpc.call('cong', { cong }, [cong.buffer]).catch(() => {});
    }
  }

  /** drop every queued request (their callbacks receive null) */
  cancelAll(): void {
    const q = this.queue;
    this.queue = [];
    this.queued.clear();
    for (const r of q) for (const cb of r.cbs) cb(null);
  }

  /** dispatch queued requests; call once per frame */
  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    if (!this.queue.length) return;
    if (this.fallback) {
      // main-thread fallback: a few ms per frame
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 3) {
        const r = this.queue.shift()!;
        this.queued.delete(r.key);
        this.deliver(r, this.fallback.find(r.mode, r.s, r.t, 120_000));
      }
      return;
    }
    if (!this.rpc || this.inFlight >= MAX_IN_FLIGHT) return;
    const batch = this.queue.splice(0, BATCH);
    for (const r of batch) this.queued.delete(r.key);
    const reqs = new Int32Array(batch.length * 3);
    batch.forEach((r, i) => {
      reqs[i * 3] = r.mode;
      reqs[i * 3 + 1] = r.s;
      reqs[i * 3 + 2] = r.t;
    });
    this.inFlight++;
    const rpc = this.rpc;
    const run = () =>
      rpc.call<PathBatchResult>('find', { reqs, maxExpand: 200_000 }, [reqs.buffer]).then(
        (res) => {
          this.inFlight--;
          if (this.disposed) return;
          this.stats.workerMs += res.ms;
          for (let i = 0; i < batch.length; i++) {
            const a = res.offsets[i], b = res.offsets[i + 1];
            this.deliver(batch[i], b > a ? res.cells.slice(a, b) : null);
          }
        },
        () => {
          this.inFlight--;
          if (this.disposed) return;
          for (const r of batch) this.deliver(r, null);
        },
      );
    if (this.ready) void this.ready.then(run);
    else void run();
  }

  private deliver(r: Req, p: Int32Array | null): void {
    if (!p) this.stats.failures++;
    this.cache.set(r.key, { p, t: this.time });
    if (this.cache.size > CACHE_MAX) {
      // evict the oldest quarter (Map iterates in insertion / refresh order)
      let k = CACHE_MAX >> 2;
      for (const key of this.cache.keys()) {
        this.cache.delete(key);
        if (--k <= 0) break;
      }
    }
    for (const cb of r.cbs) {
      try {
        cb(p);
      } catch (e) {
        console.error('[traffic] path callback failed', e);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.queued.clear();
    this.cache.clear();
    this.rpc?.terminate();
    this.rpc = null;
    this.fallback = null;
  }
}
