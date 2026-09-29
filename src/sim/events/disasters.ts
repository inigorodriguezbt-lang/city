// Gameplay of events that change the world: building fire, forest fire,
// tornado, earthquake, meteor strikes, flood / storm surge, tsunami, sinkhole,
// lightning strike and industrial explosion. Visuals follow from the state
// written here (ActiveEvent.data, building flags, world.floodOffset) plus a
// few one-shot bursts sent to the EffectsRenderer.
import { CELL } from '../../core/constants';
import { BFlag, type ActiveEvent, type Building } from '../../core/types';
import type { RNG } from '../../core/rng';
import type { EventSpec } from '../../data/events';
import type { Game } from '../../game/Game';
import type { EffectsRenderer } from '../../render/effects/EffectsRenderer';
import type { DestroyCause } from '../../world/actions';
import type { World } from '../../world/World';
import type { FireManager } from './fires';
import { buildingHeight, centerOf, placeName, seaDirection, standing, type Place, type Preparedness } from './places';
import type { FireEventData, FloodData, MeteorData, QuakeData, TornadoData } from './types';

export interface EventCtx {
  game: Game;
  world: World;
  rng: RNG;
  fires: FireManager;
  prep: Preparedness;
  fx: EffectsRenderer | null;
}

export interface Handler {
  /** set up event data; return false to abort the event */
  start?(c: EventCtx, ev: ActiveEvent, spec: EventSpec, place: Place | null): boolean;
  /** advance by dtDays of game time */
  update?(c: EventCtx, ev: ActiveEvent, spec: EventSpec, dtDays: number): void;
  /** finished early (duration-0 events end when this returns true) */
  done?(c: EventCtx, ev: ActiveEvent, spec: EventSpec): boolean;
  /** clean up world state */
  end?(c: EventCtx, ev: ActiveEvent, spec: EventSpec): void;
  /** custom end notice text (overrides spec.endText) */
  endText?(c: EventCtx, ev: ActiveEvent, spec: EventSpec): string | null;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function worldPos(c: EventCtx, x: number, y: number): { x: number; y: number; z: number } {
  const wx = x * CELL, wz = y * CELL;
  let h: number;
  try {
    h = c.game.renderer.groundHeight(wx, wz);
  } catch {
    h = c.world.heightAt(wx, wz);
  }
  return { x: wx, y: h, z: wz };
}

function topOf(c: EventCtx, b: Building): { x: number; y: number; z: number } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const p = worldPos(c, cx, cy);
  let top = p.y + buildingHeight(b);
  try {
    const t = c.game.buildings.buildingTop(b.id);
    if (t > 0) top = t;
  } catch {
    /* renderer not ready */
  }
  return { x: p.x, y: top, z: p.z };
}

/** destroy a building (rubble) with a collapse dust cloud */
export function destroyBuilding(c: EventCtx, b: Building, cause: DestroyCause, dust = 1): void {
  if (!c.world.getBuilding(b.id) || b.flags & BFlag.Collapsed) return;
  const p = worldPos(c, b.x + b.w / 2, b.y + b.h / 2);
  try {
    c.game.actions.destroyBuilding(b.id, cause);
  } catch (err) {
    console.warn('[events] destroyBuilding failed', err);
    return;
  }
  c.fires.burning.delete(b.id);
  if (dust > 0) c.fx?.burst('dust', { x: p.x, y: p.y + 2, z: p.z }, dust * (0.7 + 0.25 * Math.sqrt(b.w * b.h)) * Math.min(1.8, 0.7 + buildingHeight(b) / 40));
}

/** distance (cells) from a point to a building footprint */
function distToBuilding(b: Building, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function buildingsNear(world: World, x: number, y: number, r: number, out: Building[]): Building[] {
  out.length = 0;
  const seen = new Set<number>();
  const x0 = Math.max(0, Math.floor(x - r - 1)), x1 = Math.min(world.size - 1, Math.ceil(x + r + 1));
  const y0 = Math.max(0, Math.floor(y - r - 1)), y1 = Math.min(world.size - 1, Math.ceil(y + r + 1));
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const id = world.bldg[yy * world.size + xx];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = world.buildings.get(id);
      if (b && distToBuilding(b, x, y) <= r) out.push(b);
    }
  return out;
}

/** carve (negative depth) or raise terrain in a smooth bowl with a rim */
function carve(world: World, cx: number, cy: number, radius: number, depth: number, rim: number): void {
  const r1 = radius * 1.45;
  const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(world.size, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(world.size, Math.ceil(cy + r1));
  for (let vy = y0; vy <= y1; vy++)
    for (let vx = x0; vx <= x1; vx++) {
      const d = Math.hypot(vx - cx, vy - cy) / radius;
      if (d >= 1.45) continue;
      let dh = 0;
      if (d < 1) dh = -depth * (1 - d * d) * (0.85 + 0.15 * Math.cos(vx * 1.7 + vy * 2.3));
      else dh = rim * (1 - Math.abs(d - 1.15) / 0.3) * (d < 1.45 ? 1 : 0);
      if (dh !== 0) world.setVertexHeight(vx, vy, world.vertexHeight(vx, vy) + dh);
    }
}

const tmpList: Building[] = [];

// ── building fire ───────────────────────────────────────────────────────────
const fire: Handler = {
  start(c, ev, _spec, place) {
    const b = place?.bid !== undefined ? c.world.getBuilding(place.bid) : undefined;
    if (!b || !c.fires.ignite(c.world, b, 0.35)) return false;
    ev.data = { bid: b.id } satisfies FireEventData as unknown as Record<string, unknown>;
    return true;
  },
  done(c, ev) {
    const d = ev.data as unknown as FireEventData | undefined;
    const b = d ? c.world.getBuilding(d.bid) : undefined;
    return !b || !(b.flags & BFlag.OnFire);
  },
  endText(c, ev) {
    const d = ev.data as unknown as FireEventData | undefined;
    const b = d ? c.world.getBuilding(d.bid) : undefined;
    const name = placeName(c.world, b, ev.x, ev.y);
    if (!b || b.flags & (BFlag.Burned | BFlag.Collapsed)) return `${cap(name)} burned down.`;
    return `The fire at ${name} is out.`;
  },
};

// ── forest fire ─────────────────────────────────────────────────────────────
const forestFire: Handler = {
  start(c, ev, _spec, place) {
    if (!place) return false;
    const w = c.world;
    // start in the nearest woods (a /summon cell may be just outside the trees)
    let fx = -1, fy = -1;
    for (let r = 0; r <= 16 && fx < 0; r++)
      for (let dy = -r; dy <= r && fx < 0; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = place.x + dx, y = place.y + dy;
          if (w.inBounds(x, y) && w.trees[w.idx(x, y)] >= 1) {
            fx = x;
            fy = y;
            break;
          }
        }
    if (fx < 0) return false;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (c.fires.igniteTree(w, fx + dx, fy + dy)) n++;
    ev.x = fx;
    ev.y = fy;
    ev.data = { cells: n };
    return n > 0;
  },
  done(c) {
    return c.fires.trees.size === 0;
  },
};

// ── tornado ─────────────────────────────────────────────────────────────────
const TORNADO_TRAVEL = 70;
const tornado: Handler = {
  start(c, ev, spec, place) {
    const w = c.world;
    const tx = place ? place.x : w.home.x, ty = place ? place.y : w.home.y;
    // touch down upwind of the target and cross it
    const heading = w.weather.windDir + c.rng.range(-0.7, 0.7);
    const back = c.rng.range(18, 30);
    const px = Math.min(w.size - 3, Math.max(2, tx - Math.cos(heading) * back));
    const py = Math.min(w.size - 3, Math.max(2, ty - Math.sin(heading) * back));
    const d: TornadoData = { px, py, heading, speed: TORNADO_TRAVEL / Math.max(1, spec.duration), strength: c.rng.range(0.8, 1.25), hit: [] };
    ev.data = d as unknown as Record<string, unknown>;
    return true;
  },
  update(c, ev, _spec, dt) {
    const d = ev.data as unknown as TornadoData;
    if (!d || dt <= 0) return;
    const w = c.world;
    // a wandering path, gently pulled downwind
    d.heading += c.rng.gauss() * 0.5 * Math.sqrt(dt);
    const wd = w.weather.windDir;
    d.heading += Math.sin(wd - d.heading) * 0.15 * dt;
    d.px += Math.cos(d.heading) * d.speed * dt;
    d.py += Math.sin(d.heading) * d.speed * dt;
    if (d.px < 1 || d.py < 1 || d.px > w.size - 2 || d.py > w.size - 2) {
      d.px = Math.min(w.size - 2, Math.max(1, d.px));
      d.py = Math.min(w.size - 2, Math.max(1, d.py));
      ev.endDay = Math.min(ev.endDay, w.time.day + 0.3);
    }
    const age = w.time.day - ev.startDay, left = ev.endDay - w.time.day;
    const grow = Math.min(1, age / 0.45, Math.max(0, left) / 0.6);
    const s = d.strength * Math.max(0, grow);
    if (s < 0.15) return;
    const core = 1.3 * s, outer = 2.8 * s;
    const mit = c.prep.mitigation('storm', d.px, d.py);
    // buildings: each rolled once when the funnel first reaches it
    for (const b of buildingsNear(w, d.px, d.py, outer, tmpList)) {
      if (d.hit.includes(b.id) || !standing(b)) continue;
      d.hit.push(b.id);
      if (d.hit.length > 600) d.hit.splice(0, 200);
      const inCore = distToBuilding(b, d.px, d.py) <= core;
      const sturdy = b.kind === 'service' ? Math.min(0.6, buildingHeight(b) / 120) : 0.1 * (b.level - 1) + (b.w * b.h > 4 ? 0.15 : 0);
      const p = (inCore ? 0.8 : 0.28) * s * (1 - sturdy) * (1 - mit);
      if (c.rng.next() < p) destroyBuilding(c, b, 'disaster', 1.3);
    }
    // trees are ripped out along the path
    const r = Math.ceil(outer);
    for (let yy = Math.floor(d.py) - r; yy <= Math.floor(d.py) + r; yy++)
      for (let xx = Math.floor(d.px) - r; xx <= Math.floor(d.px) + r; xx++) {
        if (!w.inBounds(xx, yy)) continue;
        const t = w.trees[w.idx(xx, yy)];
        if (!t) continue;
        const dd = Math.hypot(xx + 0.5 - d.px, yy + 0.5 - d.py);
        if (dd <= core) w.setTrees(xx, yy, Math.max(0, t - 2));
        else if (dd <= outer && c.rng.next() < dt * 3) w.setTrees(xx, yy, t - 1);
      }
  },
};

// ── earthquake ──────────────────────────────────────────────────────────────
const earthquake: Handler = {
  start(c, ev, _spec, place) {
    const w = c.world;
    const x = place ? place.x : w.home.x, y = place ? place.y : w.home.y;
    const m = c.rng.range(5.6, 7.6);
    const radius = (m - 4.8) * 24;
    const d: QuakeData = { magnitude: Math.round(m * 10) / 10, radius, queue: [], aftershocks: [] };
    scheduleCollapses(c, d, x, y, 1, ev.startDay, 0.45);
    const n = 1 + c.rng.int(0, 2);
    for (let i = 0; i < n; i++) d.aftershocks.push(ev.startDay + c.rng.range(0.5, 1.7));
    d.aftershocks.sort((a, b) => a - b);
    ev.data = d as unknown as Record<string, unknown>;
    shake(c, x, y, (m - 4.9) * 2.2, 4 + (m - 5.5) * 1.5);
    return true;
  },
  update(c, ev) {
    const d = ev.data as unknown as QuakeData;
    if (!d) return;
    const w = c.world, day = w.time.day;
    const x = ev.x ?? w.home.x, y = ev.y ?? w.home.y;
    while (d.aftershocks.length && day >= d.aftershocks[0]) {
      d.aftershocks.shift();
      scheduleCollapses(c, d, x, y, 0.3, day, 0.1);
      shake(c, x, y, (d.magnitude - 5.6) * 1.4 + 1, 2.5);
    }
    for (let i = 0; i + 1 < d.queue.length; ) {
      if (day < d.queue[i]) {
        i += 2;
        continue;
      }
      const b = w.getBuilding(d.queue[i + 1]);
      d.queue.splice(i, 2);
      if (!b || !standing(b)) continue;
      destroyBuilding(c, b, 'collapse', 1.5);
      // ruptured gas lines
      if (c.rng.next() < 0.12) {
        const nb = buildingsNear(w, b.x + b.w / 2, b.y + b.h / 2, 2.5, tmpList).find((o) => o.id !== b.id && standing(o));
        if (nb) c.fires.ignite(w, nb, 0.3);
      }
    }
  },
};

function scheduleCollapses(c: EventCtx, d: QuakeData, x: number, y: number, k: number, from: number, spread: number): void {
  const mit = c.prep.mitigation('quake', x, y);
  const r = d.radius * (0.6 + 0.4 * k);
  for (const b of c.world.buildings.values()) {
    if (!standing(b)) continue;
    const dist = distToBuilding(b, x, y);
    if (dist > r) continue;
    const shaking = Math.pow(1 - dist / r, 1.4) * Math.min(1.4, (d.magnitude - 5.2) / 2);
    // tall and old buildings fall first; abandoned ones are fragile
    const h = buildingHeight(b);
    let vul = 0.06 + Math.min(0.5, h / 90) + Math.min(0.15, b.age / 3600);
    if (b.flags & BFlag.Abandoned) vul *= 1.6;
    if (b.kind === 'service') vul *= 0.65;
    const p = Math.min(0.85, shaking * vul * k * (1 - mit));
    if (c.rng.next() < p) d.queue.push(from + c.rng.next() * spread, b.id);
  }
}

function shake(c: EventCtx, x: number, y: number, intensity: number, duration: number): void {
  try {
    const ctl = c.game.renderer.cameraCtl;
    const vi = c.game.renderer.getViewInfo();
    const d = Math.hypot(vi.focusX - x, vi.focusY - y);
    const k = Math.max(0.25, 1 - d / 260);
    ctl.shake(intensity * k, duration);
  } catch {
    /* no renderer */
  }
}

// ── meteors ─────────────────────────────────────────────────────────────────
function meteorHandler(giant: boolean): Handler {
  return {
    start(c, ev, spec, place) {
      const w = c.world;
      const x = (place ? place.x : w.home.x) + c.rng.range(0.1, 0.9), y = (place ? place.y : w.home.y) + c.rng.range(0.1, 0.9);
      const warn = c.prep.warning('impact', x, y);
      const fall = (giant ? 3.2 : 2.2) * warn;
      const d: MeteorData = {
        tx: x, ty: y, az: c.rng.range(0, Math.PI * 2), el: c.rng.range(0.4, 0.75), impactDay: ev.startDay + fall, impacted: false,
        radius: giant ? 8.5 : 3.6, size: giant ? 30 : 9, water: w.isWater(Math.floor(x), Math.floor(y)),
      };
      ev.data = d as unknown as Record<string, unknown>;
      ev.endDay = Math.max(ev.endDay, d.impactDay + Math.max(3, spec.duration * 0.6));
      return true;
    },
    update(c, ev) {
      const d = ev.data as unknown as MeteorData;
      if (!d || d.impacted || c.world.time.day < d.impactDay) return;
      d.impacted = true;
      impact(c, ev, d, giant);
    },
  };
}

function impact(c: EventCtx, ev: ActiveEvent, d: MeteorData, giant: boolean): void {
  const w = c.world;
  const p = worldPos(c, d.tx, d.ty);
  const wl = w.waterLevel(Math.floor(d.tx), Math.floor(d.ty));
  d.water = wl > p.y + 0.3;
  const R = d.radius;
  if (d.water) {
    c.fx?.burst('splash', { x: p.x, y: wl, z: p.z }, giant ? 60 : 22);
    c.fx?.burst('steam', { x: p.x, y: wl + 4, z: p.z }, giant ? 6 : 3);
  } else {
    c.fx?.burst('explosion', { x: p.x, y: p.y + 2, z: p.z }, giant ? 28 : 12);
    carve(w, d.tx, d.ty, R * 0.8, giant ? 16 : 6, giant ? 3.5 : 1.4);
  }
  shake(c, d.tx, d.ty, giant ? 14 : 6, giant ? 6 : 3.5);
  const mit = c.prep.mitigation('impact', d.tx, d.ty);
  for (const b of buildingsNear(w, d.tx, d.ty, R * 1.35, tmpList).slice()) {
    if (!standing(b)) continue;
    const dist = distToBuilding(b, d.tx, d.ty);
    if (dist <= R * 0.75 || c.rng.next() < 0.55 * (1 - mit) * (1 - (dist - R * 0.75) / (R * 0.6))) destroyBuilding(c, b, 'disaster', 1.2);
    else if (c.rng.next() < 0.6) c.fires.ignite(w, b, 0.5);
  }
  const r = Math.ceil(R * 1.5);
  for (let yy = Math.floor(d.ty) - r; yy <= Math.floor(d.ty) + r; yy++)
    for (let xx = Math.floor(d.tx) - r; xx <= Math.floor(d.tx) + r; xx++) {
      if (!w.inBounds(xx, yy) || !w.trees[w.idx(xx, yy)]) continue;
      const dd = Math.hypot(xx + 0.5 - d.tx, yy + 0.5 - d.ty);
      if (dd <= R) w.setTrees(xx, yy, 0);
      else if (dd <= R * 1.5 && c.rng.next() < 0.5) c.fires.igniteTree(w, xx, yy);
    }
  try {
    c.game.audio.play('explosion', giant ? 1.4 : 1);
  } catch {
    /* audio not ready */
  }
  w.notify({ kind: 'danger', title: giant ? 'Giant meteor impact!' : 'Meteor impact!', text: d.water ? 'The meteor plunged into the water in a towering plume of steam.' : 'The meteor struck the ground, leaving a smoking crater.', icon: giant ? '🌑' : '☄️', x: Math.floor(d.tx), y: Math.floor(d.ty) });
  void ev;
}

// ── floods & tsunamis ───────────────────────────────────────────────────────
/** spill height: the lowest sea level at which the sea reaches each cell (priority flood) */
class SpillMap {
  heights: Float32Array | null = null;
  maxLevel = 0;

  compute(world: World, maxLevel: number): void {
    const s = world.size, n = s * s;
    const out = new Float32Array(n).fill(Infinity);
    const sea = world.seaLevel;
    const limit = sea + maxLevel;
    // binary heap of cell indices keyed by spill height
    const heap: number[] = [];
    const key = out;
    const push = (i: number) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (key[heap[p]] <= key[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && key[heap[l]] < key[heap[m]]) m = l;
          if (r < heap.length && key[heap[r]] < key[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    for (let i = 0; i < n; i++) {
      const w = world.water[i];
      if (Math.abs(w - sea) < 0.01 && w > world.cellHeight(i % s, (i / s) | 0) + 0.05) {
        out[i] = sea;
        push(i);
      }
    }
    const done = new Uint8Array(n);
    while (heap.length) {
      const i = pop();
      if (done[i]) continue;
      done[i] = 1;
      const x = i % s, y = (i / s) | 0;
      const base = out[i];
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 0 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const j = ny * s + nx;
        if (done[j]) continue;
        const h = Math.max(base, world.cellMinMax(nx, ny)[0]);
        if (h > limit || h >= out[j]) continue;
        out[j] = h;
        push(j);
      }
    }
    this.heights = out;
    this.maxLevel = maxLevel;
  }
}

const spillCache = new Map<number, SpillMap>();

function spillFor(c: EventCtx, ev: ActiveEvent, maxLevel: number): SpillMap {
  let m = spillCache.get(ev.id);
  if (!m || !m.heights || m.heights.length !== c.world.size * c.world.size || m.maxLevel < maxLevel) {
    m = new SpillMap();
    m.compute(c.world, maxLevel + 0.5);
    spillCache.set(ev.id, m);
  }
  return m;
}

function floodLevel(ev: ActiveEvent, d: FloodData, day: number): number {
  const t = day - ev.startDay;
  const total = ev.endDay - ev.startDay;
  const start = d.arriveDay !== undefined ? d.arriveDay - ev.startDay : 0;
  if (t < start) return 0;
  if (t < d.riseEnd) return d.peak * smooth((t - start) / Math.max(0.05, d.riseEnd - start));
  if (t < d.fallStart) return d.peak * (0.97 + 0.03 * Math.sin(t * 5));
  return d.peak * (1 - smooth((t - d.fallStart) / Math.max(0.1, total - d.fallStart)));
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** combined flood offset of every flood-type event (set by the EventSystem after updating events) */
export function floodOffsetFor(world: World): number {
  let off = 0;
  for (const ev of world.activeEvents) {
    if (ev.defId !== 'flood' && ev.defId !== 'tsunami') continue;
    const d = ev.data as unknown as FloodData | undefined;
    if (d) off = Math.max(off, floodLevel(ev, d, world.time.day));
  }
  return Math.round(off * 20) / 20;
}

function floodHandler(tsunami: boolean): Handler {
  const acc = new Map<number, number>();
  return {
    start(c, ev, spec, place) {
      const w = c.world;
      if (!place) return false;
      const total = ev.endDay - ev.startDay;
      if (tsunami) {
        const dir = seaDirection(w, place.x, place.y);
        const approach = 1.1 * c.prep.warning('tsunami', place.x, place.y);
        const arrive = ev.startDay + approach;
        ev.endDay = Math.max(ev.endDay, arrive + 5);
        const d: FloodData = {
          peak: c.rng.range(4.5, 8.5), riseEnd: approach + 0.3, fallStart: approach + 1.3, arriveDay: arrive, approach, dx: dir.dx, dy: dir.dy, flooded: [],
        };
        ev.data = d as unknown as Record<string, unknown>;
      } else {
        const d: FloodData = { peak: c.rng.range(1.6, 3.4), riseEnd: Math.min(2.5, total * 0.25), fallStart: total * 0.65, flooded: [] };
        ev.data = d as unknown as Record<string, unknown>;
      }
      void spec;
      acc.set(ev.id, 0);
      return true;
    },
    update(c, ev, _spec, dt) {
      const d = ev.data as unknown as FloodData;
      if (!d || dt <= 0) return;
      const t = (acc.get(ev.id) ?? 0) + dt;
      if (t < 0.2) {
        acc.set(ev.id, t);
        return;
      }
      acc.set(ev.id, 0);
      const w = c.world;
      const level = w.seaLevel + floodLevel(ev, d, w.time.day);
      const spill = spillFor(c, ev, d.peak).heights!;
      const mit = c.prep.mitigation(tsunami ? 'tsunami' : 'flood', ev.x, ev.y);
      const flooded = new Set(d.flooded);
      const surge = tsunami && d.arriveDay !== undefined && w.time.day - d.arriveDay < 1.5;
      for (const b of w.buildings.values()) {
        if (b.flags & BFlag.Collapsed) {
          if (flooded.has(b.id)) flooded.delete(b.id);
          continue;
        }
        // lowest cell of the footprint
        let low = Infinity;
        for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) if (w.inBounds(xx, yy)) low = Math.min(low, spill[w.idx(xx, yy)]);
        const depth = level - Math.max(low, w.cellHeight(b.x, b.y));
        const wet = low < level - 0.05 && depth > 0.05;
        if (wet) {
          if (!(b.flags & BFlag.Flooded)) {
            b.flags |= BFlag.Flooded;
            w.touchBuilding(b);
          }
          flooded.add(b.id);
          const pDay = (surge ? 0.6 * Math.min(1, depth / 2.5) : 0.035 * Math.min(1.5, depth / 1.5)) * (1 - mit);
          if (c.rng.next() < 1 - Math.exp(-pDay * t)) {
            flooded.delete(b.id);
            destroyBuilding(c, b, 'flood', 0.6);
          }
        } else if (flooded.has(b.id)) {
          flooded.delete(b.id);
          if (b.flags & BFlag.Flooded) {
            b.flags &= ~BFlag.Flooded;
            w.touchBuilding(b);
          }
        }
      }
      d.flooded = [...flooded];
    },
    end(c, ev) {
      const d = ev.data as unknown as FloodData | undefined;
      const w = c.world;
      if (d) {
        for (const id of d.flooded) {
          const b = w.getBuilding(id);
          if (b && b.flags & BFlag.Flooded && !(b.flags & BFlag.Collapsed)) {
            b.flags &= ~BFlag.Flooded;
            w.touchBuilding(b);
          }
        }
        d.flooded = [];
      }
      spillCache.delete(ev.id);
      acc.delete(ev.id);
    },
  };
}

// ── sinkhole ────────────────────────────────────────────────────────────────
const sinkhole: Handler = {
  start(c, ev, _spec, place) {
    if (!place) return false;
    const w = c.world;
    const b = place.bid !== undefined ? w.getBuilding(place.bid) : undefined;
    const cx = b ? b.x + b.w / 2 : place.x + 0.5, cy = b ? b.y + b.h / 2 : place.y + 0.5;
    const r = b ? Math.max(1.2, Math.sqrt(b.w * b.h) * 0.75) : 1.4;
    const mit = c.prep.mitigation('ground', cx, cy);
    if (b) destroyBuilding(c, b, 'collapse', 1.4);
    for (const o of buildingsNear(w, cx, cy, r + 0.8, tmpList).slice()) if (o !== b && standing(o) && c.rng.next() < 0.45 * (1 - mit)) destroyBuilding(c, o, 'collapse', 1);
    carve(w, cx, cy, r, 9, 0);
    const p = worldPos(c, cx, cy);
    c.fx?.burst('dust', p, 2.2);
    ev.data = { r };
    return true;
  },
};

// ── lightning strike ────────────────────────────────────────────────────────
export function lightningStrike(c: EventCtx, b: Building, igniteChance = 1): boolean {
  const top = topOf(c, b);
  c.fx?.lightningStrike(top);
  if (c.rng.next() < igniteChance) return c.fires.ignite(c.world, b, 0.45);
  return false;
}

const lightning: Handler = {
  start(c, ev, _spec, place) {
    const b = place?.bid !== undefined ? c.world.getBuilding(place.bid) : undefined;
    if (!b) return false;
    lightningStrike(c, b, 1);
    ev.data = { bid: b.id };
    return true;
  },
};

// ── industrial explosion ────────────────────────────────────────────────────
const explosion: Handler = {
  start(c, ev, _spec, place) {
    const w = c.world;
    const b = place?.bid !== undefined ? w.getBuilding(place.bid) : undefined;
    if (!b) return false;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const p = worldPos(c, cx, cy);
    c.fx?.burst('explosion', { x: p.x, y: p.y + 3, z: p.z }, 3.5 + Math.sqrt(b.w * b.h) * 0.9);
    shake(c, cx, cy, 3, 2);
    const mit = c.prep.mitigation('fire', cx, cy);
    destroyBuilding(c, b, 'disaster', 0.8);
    for (const o of buildingsNear(w, cx, cy, 3.5, tmpList).slice()) {
      if (o.id === b.id || !standing(o)) continue;
      const dist = distToBuilding(o, cx, cy);
      if (dist < 1.2 && c.rng.next() < 0.35 * (1 - mit)) destroyBuilding(c, o, 'disaster', 1);
      else if (c.rng.next() < 0.65 * (1 - dist / 4)) c.fires.ignite(w, o, 0.4);
    }
    try {
      c.game.audio.play('explosion', 1.1);
    } catch {
      /* audio not ready */
    }
    return true;
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const HANDLERS: Record<string, Handler> = {
  fire,
  forest_fire: forestFire,
  tornado,
  earthquake,
  meteor: meteorHandler(false),
  giant_meteor: meteorHandler(true),
  flood: floodHandler(false),
  tsunami: floodHandler(true),
  sinkhole,
  lightning,
  explosion,
};
