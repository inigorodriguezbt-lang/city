// Organic growth of zoned buildings. Every tick, each demand category with
// positive demand accumulates a capacity budget and spends it spawning new
// buildings on lots picked from the incremental candidate set: lot sizes
// from ZoneDef.lots that fit same-zone, empty, dry, gentle cells with their
// whole front on an access road. Occasionally, when land is scarce and demand
// high, small low-level buildings are merged into a larger lot.
import { MAX_LOT_SLOPE, MAX_ZONE_DEPTH, TICKS_PER_DAY } from '../core/constants';
import { BFlag, DIR_DX, DIR_DY, Dir, RoadType, ZoneType, type Building, type ZoneCategory } from '../core/types';
import { hash3 } from '../core/rng';
import { zoneDef } from '../data/zones';
import { CATS, isAccessRoad } from './candidates';
import type { SimContext } from './context';
import { buildDaysFor } from './lifecycle';
import { bsim, newBSim } from './state';
import { capacityOf, zoneMeta } from './zonemeta';
import { DENSIFY_INTERVAL, MAX_SPAWNS_PER_TICK, RESOURCE_THRESHOLD, SPAWN_SAMPLES, UNFIT_RETRY_DAYS } from './tuning';

interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Dir;
}

/** Capacity (residents or jobs) a category may add per day at demand 1. */
export function dailySpawnBudget(ctx: SimContext, cat: ZoneCategory): number {
  const st = ctx.world.stats;
  const d = st.demand[cat];
  if (d <= 0.02) return 0;
  const pop = st.population;
  const jobs = st.jobs;
  const scale = cat === 'res' ? 18 + pop * 0.018 : cat === 'com' ? 5 + jobs * 0.008 + pop * 0.002 : cat === 'ind' ? 6 + jobs * 0.008 + pop * 0.002 : 4 + jobs * 0.006;
  // gentle ramp: weak demand grows slowly, strong demand grows fast
  return scale * d * (0.4 + 0.6 * d);
}

/** infill lot sizes [frontage, depth] tried after a zone's own lot list */
const FALLBACK_LOTS: [number, number][] = [[2, 2], [1, 2], [2, 1], [1, 1]];

export class Growth {
  constructor(private ctx: SimContext) {}

  /** called once per simulation tick */
  tick(): void {
    const ctx = this.ctx, st = ctx.state;
    if (ctx.outside.dirty) ctx.outside.recompute();
    for (let c = 0; c < 4; c++) {
      const cat = CATS[c];
      const budget = dailySpawnBudget(ctx, cat);
      if (budget <= 0) {
        st.spawnAcc[cat] = Math.min(st.spawnAcc[cat], 0) * 0.9;
        continue;
      }
      st.spawnAcc[cat] = Math.min(st.spawnAcc[cat] + budget / TICKS_PER_DAY, budget * 1.5 + 8);
      let attempts = 0;
      while (st.spawnAcc[cat] > 0 && attempts++ < MAX_SPAWNS_PER_TICK) {
        const added = this.trySpawn(c);
        if (added < 0) break;
        st.spawnAcc[cat] -= added;
      }
    }
  }

  /** Daily: try merging small lots where land is scarce. */
  daily(): void {
    const ctx = this.ctx, st = ctx.state, day = ctx.day;
    for (let c = 0; c < 4; c++) {
      const cat = CATS[c];
      const d = ctx.world.stats.demand[cat];
      if (d < 0.4 || day < st.densify[cat]) continue;
      st.densify[cat] = day + DENSIFY_INTERVAL;
      // only when little free land is left for this category
      if (ctx.candidates.count(c) > 24) continue;
      this.densify(cat);
    }
  }

  // ── spawning ─────────────────────────────────────────────────────────────
  /** Try to spawn one building of category index c. Returns capacity added, 0 if nothing fitted, -1 if no candidates. */
  private trySpawn(c: number): number {
    const ctx = this.ctx, w = ctx.world, cs = ctx.candidates, rng = ctx.rng, s = w.size;
    if (cs.count(c) === 0) return -1;
    let bestI = -1, bestScore = -Infinity;
    for (let t = 0; t < SPAWN_SAMPLES; t++) {
      const i = cs.random(c, rng);
      if (i < 0) break;
      const x = i % s, y = (i / s) | 0;
      if (cs.eligible(x, y, i) !== c) {
        cs.remove(i);
        continue;
      }
      const z = w.zone[i] as ZoneType;
      const zd = zoneDef(z);
      if (!zd || !w.isUnlocked(zd.unlock)) continue;
      if (ctx.outside.hasConnections && !this.reachesOutside(x, y)) continue;
      const lv = w.fields.landValue[i];
      // industry prefers cheap land, everyone else prefers valuable land
      const score = (CATS[c] === 'ind' ? 255 - lv * 0.5 : lv) + rng.next() * 70;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    if (bestI < 0) return 0;
    const x = bestI % s, y = (bestI / s) | 0;
    const z = w.zone[bestI] as ZoneType;
    const lot = this.findLot(x, y, z);
    if (!lot) {
      // this cell cannot host any lot right now; drop it until something changes nearby
      cs.markUnfit(bestI, UNFIT_RETRY_DAYS);
      return 0;
    }
    this.absorbBackRows(lot, z);
    const b = this.spawn(lot, z, 1, 0);
    return b ? Math.max(1, b.maxResidents + b.jobs) : 0;
  }

  /**
   * Extend a lot backwards over same-zone cells that no road can ever reach
   * (they touch no access road), so deep zoned blocks fill completely instead
   * of leaving orphaned back rows empty. Stops at MAX_ZONE_DEPTH.
   */
  private absorbBackRows(l: Lot, z: ZoneType): void {
    const w = this.ctx.world, s = w.size;
    const alongX = l.rot === Dir.N || l.rot === Dir.S;
    const depth = () => (alongX ? l.h : l.w);
    const free = (xx: number, yy: number): boolean => {
      if (xx < 0 || yy < 0 || xx >= s || yy >= s) return false;
      const i = yy * s + xx;
      if (w.zone[i] !== z || w.road[i] || w.bldg[i]) return false;
      if (w.isWater(xx, yy) || w.cellSlope(xx, yy) > MAX_LOT_SLOPE) return false;
      // a cell with its own road access can host its own building later
      for (let d = 0; d < 4; d++) if (isAccessRoad(w.roadAt(xx + DIR_DX[d], yy + DIR_DY[d]))) return false;
      return true;
    };
    while (depth() < MAX_ZONE_DEPTH) {
      const cells: [number, number][] = [];
      if (l.rot === Dir.N) for (let k = 0; k < l.w; k++) cells.push([l.x + k, l.y + l.h]);
      else if (l.rot === Dir.S) for (let k = 0; k < l.w; k++) cells.push([l.x + k, l.y - 1]);
      else if (l.rot === Dir.W) for (let k = 0; k < l.h; k++) cells.push([l.x + l.w, l.y + k]);
      else for (let k = 0; k < l.h; k++) cells.push([l.x - 1, l.y + k]);
      if (!cells.every(([xx, yy]) => free(xx, yy))) return;
      if (l.rot === Dir.N) l.h++;
      else if (l.rot === Dir.S) { l.y--; l.h++; }
      else if (l.rot === Dir.W) l.w++;
      else { l.x--; l.w++; }
    }
  }

  /** true if a road cell next to (x,y) connects to an outside connection */
  private reachesOutside(x: number, y: number): boolean {
    const w = this.ctx.world, r = this.ctx.outside.reach, s = w.size;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
      if (r[ny * s + nx]) return true;
    }
    return false;
  }

  /** road directions touching cell (x,y), car roads first */
  private roadDirs(x: number, y: number): Dir[] {
    const w = this.ctx.world;
    const car: Dir[] = [], ped: Dir[] = [];
    for (let d = 0; d < 4; d++) {
      const t = w.roadAt(x + DIR_DX[d], y + DIR_DY[d]);
      if (!isAccessRoad(t)) continue;
      (t === RoadType.Pedestrian ? ped : car).push(d as Dir);
    }
    return car.length ? car : ped;
  }

  /** Rect of a lot with frontage f and depth dp facing `d`, with the front cell (x,y) at offset o along the frontage. */
  private rectFor(x: number, y: number, f: number, dp: number, d: Dir, o: number): Lot {
    switch (d) {
      case Dir.N: return { x: x - o, y, w: f, h: dp, rot: d };
      case Dir.S: return { x: x - o, y: y - dp + 1, w: f, h: dp, rot: d };
      case Dir.W: return { x, y: y - o, w: dp, h: f, rot: d };
      default: return { x: x - dp + 1, y: y - o, w: dp, h: f, rot: d };
    }
  }

  /** Check a candidate lot. `mergeable` (densification) lists building ids that may be replaced. */
  private fits(l: Lot, z: ZoneType, mergeable?: Set<number>): boolean {
    const w = this.ctx.world, s = w.size;
    if (l.x < 0 || l.y < 0 || l.x + l.w > s || l.y + l.h > s) return false;
    for (let yy = l.y; yy < l.y + l.h; yy++) {
      for (let xx = l.x; xx < l.x + l.w; xx++) {
        const i = yy * s + xx;
        if (w.zone[i] !== z || w.road[i]) return false;
        const bid = w.bldg[i];
        if (bid && !(mergeable && mergeable.has(bid))) return false;
        if (w.cellSlope(xx, yy) > MAX_LOT_SLOPE) return false;
        if (w.isWater(xx, yy)) return false;
      }
    }
    // the whole front must face an access road
    const d = l.rot;
    const n = d === Dir.N || d === Dir.S ? l.w : l.h;
    for (let k = 0; k < n; k++) {
      let fx: number, fy: number;
      if (d === Dir.N) { fx = l.x + k; fy = l.y - 1; }
      else if (d === Dir.S) { fx = l.x + k; fy = l.y + l.h; }
      else if (d === Dir.W) { fx = l.x - 1; fy = l.y + k; }
      else { fx = l.x + l.w; fy = l.y + k; }
      if (!isAccessRoad(w.roadAt(fx, fy))) return false;
    }
    // specialised industry needs its resource under the lot
    const zd = zoneDef(z);
    if (zd?.resource) {
      const f = w.fields[zd.resource];
      let sum = 0;
      for (let yy = l.y; yy < l.y + l.h; yy++) for (let xx = l.x; xx < l.x + l.w; xx++) sum += f[yy * s + xx];
      if (sum / (l.w * l.h) <= RESOURCE_THRESHOLD) return false;
    }
    return true;
  }

  /** Pick a lot for a new building whose front cell is (x,y). */
  private findLot(x: number, y: number, z: ZoneType): Lot | null {
    const ctx = this.ctx, w = ctx.world, rng = ctx.rng;
    const zd = zoneDef(z);
    if (!zd) return null;
    const dirs = this.roadDirs(x, y);
    if (!dirs.length) return null;
    const lv = w.fields.landValue[w.idx(x, y)];
    // larger lots are preferred where land is valuable
    const exp = -0.8 + 2.6 * Math.min(1, lv / 160);
    const lots = zd.lots.map((l) => ({ f: l[0], d: l[1], wgt: Math.pow(l[0] * l[1], exp) * (0.5 + rng.next()) }));
    lots.sort((a, b) => b.wgt - a.wgt);
    const d0 = dirs[Math.floor(rng.next() * dirs.length)];
    const dirOrder = [d0, ...dirs.filter((d) => d !== d0)];
    // standard lots first; small infill lots only for leftover slivers
    // (single cells, one-deep strips between a road and existing buildings)
    const fallback = FALLBACK_LOTS.filter(([f, d]) => !zd.lots.some((l) => l[0] === f && l[1] === d)).map(([f, d]) => ({ f, d, wgt: 0 }));
    for (const l of [...lots, ...fallback]) {
      for (const d of dirOrder) {
        const start = Math.floor(rng.next() * l.f);
        for (let t = 0; t < l.f; t++) {
          const o = (start + t) % l.f;
          const lot = this.rectFor(x, y, l.f, l.d, d, o);
          if (this.fits(lot, z)) return lot;
        }
      }
    }
    return null;
  }

  /** Create the building for a lot. */
  private spawn(l: Lot, z: ZoneType, level: number, residents: number): Building | null {
    const ctx = this.ctx, w = ctx.world, st = ctx.state;
    const zd = zoneDef(z), m = zoneMeta(z);
    if (!zd || !m) return null;
    const area = l.w * l.h;
    const cap = capacityOf(m, area, level);
    const seed = (hash3(l.x, l.y, w.nextBuildingId) ^ Math.floor(ctx.rng.next() * 0x7fffffff)) & 0x7fffffff;
    const cx = l.x + (l.w >> 1), cy = l.y + (l.h >> 1);
    const did = w.district[w.idx(cx, cy)];
    const district = did ? w.districts.find((d) => d.id === did) : undefined;
    const sim = newBSim();
    sim.bd = buildDaysFor(area, seed);
    const instant = w.creative;
    const b = w.addBuilding({
      kind: 'zoned', defId: 'zoned:' + zd.id, x: l.x, y: l.y, w: l.w, h: l.h, rot: l.rot, zone: z, level,
      style: district?.style ?? w.settings.style, seed, built: instant ? 1 : 0,
      maxResidents: cap.res, jobs: cap.jobs, residents: Math.min(residents, instant ? cap.res : 0),
      happiness: 60, health: 72, education: st.rates.immigrantEdu, goods: 50, efficiency: 1,
      ext: { sim },
    });
    for (let yy = l.y; yy < l.y + l.h; yy++) for (let xx = l.x; xx < l.x + l.w; xx++) ctx.candidates.remove(yy * w.size + xx);
    st.metrics.spawned++;
    ctx.idsDirty = true;
    return b;
  }

  // ── densification ────────────────────────────────────────────────────────
  private densify(cat: ZoneCategory): void {
    const ctx = this.ctx, w = ctx.world, ids = ctx.ids, rng = ctx.rng;
    if (!ids.length) return;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = w.buildings.get(ids[Math.floor(rng.next() * ids.length)]);
      if (!a || a.kind !== 'zoned' || !this.mergeCandidate(a)) continue;
      const m = zoneMeta(a.zone);
      if (!m || m.cat !== cat || m.raw) continue;
      if (ctx.policies.at(a).noDensify) continue;
      if (this.tryMerge(a)) return;
    }
  }

  private mergeCandidate(b: Building): boolean {
    return b.built >= 1 && b.level <= 2 && b.age > 90 && !(b.flags & (BFlag.Abandoned | BFlag.Collapsed | BFlag.Burned | BFlag.Historical | BFlag.OnFire | BFlag.Upgrading));
  }

  private tryMerge(a: Building): boolean {
    const ctx = this.ctx, w = ctx.world, s = w.size;
    const zd = zoneDef(a.zone);
    if (!zd) return false;
    const area = a.w * a.h;
    const lots = zd.lots.filter((l) => l[0] * l[1] > area).sort((p, q) => q[0] * q[1] - p[0] * p[1]);
    if (!lots.length) return false;
    const d = a.rot;
    const aFront = d === Dir.N || d === Dir.S ? a.w : a.h;
    const aDepth = d === Dir.N || d === Dir.S ? a.h : a.w;
    for (const [f, dp] of lots) {
      if (f < aFront || dp < aDepth) continue;
      for (let o = 0; o <= f - aFront; o++) {
        let lot: Lot;
        if (d === Dir.N) lot = { x: a.x - o, y: a.y, w: f, h: dp, rot: d };
        else if (d === Dir.S) lot = { x: a.x - o, y: a.y + a.h - dp, w: f, h: dp, rot: d };
        else if (d === Dir.W) lot = { x: a.x, y: a.y - o, w: dp, h: f, rot: d };
        else lot = { x: a.x + a.w - dp, y: a.y - o, w: dp, h: f, rot: d };
        if (lot.x < 0 || lot.y < 0 || lot.x + lot.w > s || lot.y + lot.h > s) continue;
        // collect buildings inside; each must be fully contained and mergeable
        const inside = new Set<number>([a.id]);
        let ok = true;
        for (let yy = lot.y; yy < lot.y + lot.h && ok; yy++) {
          for (let xx = lot.x; xx < lot.x + lot.w; xx++) {
            const bid = w.bldg[yy * s + xx];
            if (!bid || inside.has(bid)) continue;
            const b = w.buildings.get(bid);
            if (!b || b.kind !== 'zoned' || b.zone !== a.zone || !this.mergeCandidate(b) ||
              b.x < lot.x || b.y < lot.y || b.x + b.w > lot.x + lot.w || b.y + b.h > lot.y + lot.h) {
              ok = false;
              break;
            }
            inside.add(bid);
          }
        }
        if (!ok || inside.size < 2 || !this.fits(lot, a.zone, inside)) continue;
        // merge: residents relocate (they move into the new block or elsewhere), workers are re-hired
        let level = 1, residents = 0;
        for (const id of inside) {
          const b = w.buildings.get(id)!;
          level = Math.max(level, b.level);
          residents += b.residents;
          const bs = bsim(b);
          bs.dead = 0;
          w.removeBuilding(id);
        }
        ctx.state.pendingImmigrants += residents;
        const nb = this.spawn(lot, a.zone, level, 0);
        if (nb) ctx.state.metrics.densified++;
        ctx.idsDirty = true;
        return !!nb;
      }
    }
    return false;
  }
}
