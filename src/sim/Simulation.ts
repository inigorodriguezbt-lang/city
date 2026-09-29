// ─────────────────────────────────────────────────────────────────────────────
// Simulation (sim-core): calendar & time of day, organic zoned growth, the
// daily life cycle of every building (sliced across TICKS_PER_DAY ticks),
// population & labour market, RCIO demand, economy & loans, milestones,
// achievements, policies, chirper and advisor, and the building inspector.
//
// Day structure: tick t processes slice (t mod TICKS_PER_DAY) of the day's
// building snapshot; the first tick of a day finalises the previous one
// (rates, stats, demand, money) and emits sim:day / sim:month / sim:year.
// Public API is FROZEN (add, don't change).
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { BFlag, Layer, RoadType, type Building, type BudgetCategory, type TaxCategory, type ZoneCategory } from '../core/types';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, START_YEAR, TICKS_PER_DAY } from '../core/constants';
import { calendar } from '../core/time';
import { policyDef } from '../data/policies';
import { achievementDef, ACHIEVEMENTS } from '../data/achievements';
import { DayAgg } from './aggregates';
import { SimContext, neutralMods } from './context';
import { loadSimState, type CityRates } from './state';
import { SimClock, MAX_BACKLOG_TICKS, MAX_TICKS_PER_FRAME } from './time';
import { Growth } from './growth';
import { updateZoned, vacancyOf, isResidentialZone } from './lifecycle';
import { settleStorage, updateService } from './services';
import { computeRates, exportDuty, rollCounts, writeStats, type DayFlows } from './population';
import { updateDemand, type DemandFactors } from './demand';
import { EconomyEngine, type LoanOffer } from './economy';
import { achievementSnapshot, checkAchievements, checkMilestones, grantMilestone, updateStreaks } from './milestones';
import { Chirper } from './chirper';
import { Advisor, type AdvisorTip } from './advisor';
import { buildingInfo, citizenNames } from './info';
import { buildingTitle } from './naming';
import { defOf } from './catalog';
import { CANDIDATE_CHUNKS_PER_TICK } from './tuning';
import { perksFromWorld, type Perks } from './perks';
import type { Effects } from './policies';

export interface InfoLine {
  label: string;
  value: string;
  /** optional 0..1 bar */
  bar?: number;
  kind?: 'good' | 'bad' | 'neutral';
}

export interface BuildingInfo {
  title: string;
  subtitle: string;
  icon: string;
  lines: InfoLine[];
  /** notable citizens/workers with names for flavour */
  people?: { name: string; detail: string }[];
  /** problems as text */
  problems: string[];
}

/** Fast-forward: full-detail ticks for this long, then coarser multi-day steps. */
const FF_DETAIL_MS = 700;
/** Fast-forward target total time and hard stop (ms). */
const FF_TARGET_MS = 2500;
const FF_HARD_MS = 9000;
/** coarse step sizes (divisors of a month so steps never straddle a month) */
const COARSE_STEPS = [2, 3, 5, 6, 10, 15, 30];

export class Simulation {
  protected world: World | null = null;
  private ctx: SimContext | null = null;
  private clock: SimClock | null = null;
  private growth: Growth | null = null;
  private economy: EconomyEngine | null = null;
  private chirper: Chirper | null = null;
  private advisor: Advisor | null = null;
  private offs: (() => void)[] = [];
  private dayStarted = false;
  /** days covered by the day currently being accumulated (1, or K in coarse fast-forward) */
  private pendingDt = 1;
  private flows: DayFlows = { exportUnits: 0, imports: 0 };
  private why: DemandFactors = { res: [], com: [], ind: [], off: [] };
  /** tick timing (ms) for the performance overlay */
  readonly perf = { lastTickMs: 0, avgTickMs: 0, maxTickMs: 0, buildingsPerTick: 0, dayMs: 0, sliceMs: 0, growthMs: 0, scanMs: 0 };
  /** reason of the last failed policy toggle / loan request (UI feedback) */
  lastError = '';

  constructor(protected game: Game) {}

  // ════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════════

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    const fresh = world.ext.sim === undefined;
    const state = loadSimState(world);
    // the regional highway / railway the map starts with is maintained by the state
    if (fresh && world.time.day < 1) {
      const road = world.road;
      for (let i = 0; i < road.length; i++) if (road[i] === RoadType.Highway || road[i] === RoadType.Rail) state.stateRoads.push(i);
    }
    const ctx = new SimContext(this.game, world, state);
    this.ctx = ctx;
    this.clock = new SimClock(world);
    this.growth = new Growth(ctx);
    this.economy = new EconomyEngine(ctx);
    this.chirper = new Chirper(ctx);
    this.advisor = new Advisor(ctx);
    this.dayStarted = false;
    this.pendingDt = 1;
    world.time.speed = SimClock.clampSpeed(world.time.speed);
    if (!Number.isFinite(world.time.hour)) world.time.hour = 9;
    ctx.candidates.fullScan();
    ctx.outside.recompute();
    ctx.perks = perksFromWorld(world);
    this.economy.recountRoads();
    ctx.idsDirty = true;
    ctx.onLevel5 = (b) => this.chirper?.queue('level5', {}, b);
    ctx.onServiceOpened = (b) => {
      const cat = defOf(b.defId)?.category;
      this.chirper?.queue(cat === 'landmark' || cat === 'monument' ? 'landmark' : 'new_service', { building: buildingTitle(b) }, b);
      ctx.refreshServiceFields();
    };
    // existing buildings from older saves get default per-building state lazily (bsim)
    const ev = this.game.events;
    this.offs.push(
      ev.on('world:changed', ({ rect, layers }) => {
        // building layer changes are mostly visual (touchBuilding); additions and removals are handled below,
        // so cells that cannot host a lot are not re-added every time a neighbour levels up
        if (layers & (Layer.Zone | Layer.Road | Layer.Terrain | Layer.Water)) {
          ctx.candidates.markRect(rect, 1, (layers & (Layer.Road | Layer.Terrain | Layer.Water)) !== 0);
        }
        if (layers & Layer.Road) {
          ctx.roadsDirty = true;
          ctx.outside.dirty = true;
        }
        if (layers & Layer.District) ctx.policies.sync();
      }),
      ev.on('building:added', (b) => {
        ctx.idsDirty = true;
        const size = world.size;
        for (let y = Math.max(0, b.y); y < Math.min(size, b.y + b.h); y++)
          for (let x = Math.max(0, b.x); x < Math.min(size, b.x + b.w); x++) ctx.candidates.remove(y * size + x);
      }),
      ev.on('building:removed', (b) => {
        ctx.idsDirty = true;
        ctx.candidates.markRect({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, 1, true);
      }),
      ev.on('unlocks:changed', () => {
        ctx.refreshServiceFields();
        ctx.refreshGrace();
      }),
      ev.on('event:start', (e) => {
        let def: { name: string; disaster?: boolean; severity?: string } | undefined;
        try {
          def = this.game.eventSystem.catalog.find((d) => d.id === e.defId);
        } catch {
          def = undefined;
        }
        if (!def) return;
        const target = e.x !== undefined && e.y !== undefined ? world.buildingAt(e.x, e.y) : undefined;
        if (def.disaster || def.severity === 'disaster') {
          ctx.state.metrics.disasters++;
          this.chirper?.queue('disaster', { event: def.name.toLowerCase() }, target);
        } else if (def.severity === 'good') {
          this.chirper?.queue('event_good', { event: def.name }, target);
        } else if (def.severity === 'warning' || def.severity === 'danger') {
          this.chirper?.queue('event_bad', { event: def.name.toLowerCase() }, target);
        }
      }),
    );
  }

  onWorldUnloaded(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.ctx) this.ctx.syncRng();
    this.world = null;
    this.ctx = null;
    this.clock = null;
    this.growth = null;
    this.economy = null;
    this.chirper = null;
    this.advisor = null;
    this.dayStarted = false;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Time
  // ════════════════════════════════════════════════════════════════════════

  /** Advance calendar/time-of-day and run fixed ticks. dt = real seconds. */
  update(dt: number): void {
    const w = this.world, clock = this.clock;
    if (!w || !clock || !this.ctx) return;
    const now = clock.advance(Math.max(0, dt), this.game.settings.value.gameplay.dayCycleMinutes);
    let budget = MAX_TICKS_PER_FRAME;
    while (clock.lastTick < now && budget-- > 0) this.runTick(++clock.lastTick);
    // the machine cannot keep up at this speed: the calendar waits for the simulation
    // instead of piling up an ever-growing backlog of ticks
    if (now - clock.lastTick > MAX_BACKLOG_TICKS) w.time.day = (clock.lastTick + MAX_BACKLOG_TICKS + 0.5) / TICKS_PER_DAY;
  }

  get speed(): number {
    return this.world?.time.speed ?? 0;
  }

  setSpeed(level: number): void {
    const w = this.world;
    if (!w) return;
    const l = SimClock.clampSpeed(level);
    if (l > 0 && this.ctx) this.ctx.state.lastSpeed = l;
    if (w.time.speed === l) return;
    w.time.speed = l;
    this.game.events.emit('time:speed', l);
  }

  togglePause(): void {
    const w = this.world;
    if (!w) return;
    if (w.time.speed > 0) {
      if (this.ctx) this.ctx.state.lastSpeed = w.time.speed;
      this.setSpeed(0);
    } else {
      this.setSpeed(this.ctx?.state.lastSpeed || 1);
    }
  }

  /** fast-forward the simulation by n days (runs ticks synchronously) */
  advanceDays(n: number): void {
    const w = this.world, ctx = this.ctx, clock = this.clock;
    if (!w || !ctx || !clock) return;
    const days = Math.max(0, Math.min(3600, Math.floor(Number.isFinite(n) ? n : 0)));
    if (!days) return;
    const targetTick = Math.floor((w.time.day + days) * TICKS_PER_DAY);
    const t0 = performance.now();
    const startTick = clock.lastTick;
    let mode: 'undecided' | 'detail' | 'coarse' = 'undecided';
    let K = 1;
    ctx.fastForward = true;
    try {
      while (clock.lastTick < targetTick) {
        const elapsed = performance.now() - t0;
        if (elapsed > FF_HARD_MS) break;
        const next = clock.lastTick + 1;
        if (mode === 'undecided' && elapsed > FF_DETAIL_MS) {
          // measured cost so far decides whether the rest fits the time budget in full detail
          const doneDays = Math.max(0.25, (clock.lastTick - startTick) / TICKS_PER_DAY);
          const msPerDay = elapsed / doneDays;
          const remainingDays = (targetTick - clock.lastTick) / TICKS_PER_DAY;
          const budgetMs = Math.max(200, FF_TARGET_MS - elapsed);
          if (remainingDays * msPerDay <= budgetMs) mode = 'detail';
          else {
            mode = 'coarse';
            K = COARSE_STEPS.find((k) => (remainingDays / k) * msPerDay * 1.15 <= budgetMs) ?? COARSE_STEPS[COARSE_STEPS.length - 1];
          }
        }
        const day = next / TICKS_PER_DAY;
        if (mode === 'coarse' && next % TICKS_PER_DAY === 0 && day % K === 0 && next + K * TICKS_PER_DAY - 1 <= targetTick) {
          this.coarseStep(day, K);
          continue;
        }
        clock.lastTick = next;
        w.time.day = Math.max(w.time.day, next / TICKS_PER_DAY);
        this.runTick(next);
      }
    } finally {
      ctx.fastForward = false;
    }
    if (clock.lastTick < targetTick) {
      // hard time limit hit: jump the calendar without simulating the rest
      clock.lastTick = targetTick;
    }
    w.time.day = Math.max(w.time.day, targetTick / TICKS_PER_DAY);
  }

  /** set visual time of day (0..24) */
  setHour(h: number): void {
    if (this.world && Number.isFinite(h)) this.world.time.hour = ((h % 24) + 24) % 24;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Ticks & days
  // ════════════════════════════════════════════════════════════════════════

  private runTick(t: number): void {
    const ctx = this.ctx!, w = this.world!;
    const t0 = performance.now();
    const slice = t % TICKS_PER_DAY;
    const day = Math.floor(t / TICKS_PER_DAY);
    const p = this.perf;
    if (slice === 0 || !this.dayStarted) {
      this.beginDay(day, slice !== 0);
      p.dayMs = performance.now() - t0;
    }
    this.refreshMods();
    if (ctx.outside.dirty) ctx.outside.recompute();
    const r = ctx.state.rates;
    ctx.garbagePool += r.garbageAllow / TICKS_PER_DAY;
    ctx.deathPool += r.deathAllow / TICKS_PER_DAY;
    const t1 = performance.now();
    const n = this.processSlice(slice, 1);
    const t2 = performance.now();
    this.growth!.tick();
    const t3 = performance.now();
    ctx.candidates.process(CANDIDATE_CHUNKS_PER_TICK);
    this.flushRemovals();
    p.sliceMs = t2 - t1;
    p.growthMs = t3 - t2;
    p.scanMs = performance.now() - t3;
    ctx.syncRng();
    this.game.events.emit('sim:tick', { day: w.time.day, tick: t });
    const ms = performance.now() - t0;
    p.lastTickMs = ms;
    p.avgTickMs = p.avgTickMs * 0.95 + ms * 0.05;
    p.maxTickMs = Math.max(p.maxTickMs * 0.999, ms);
    p.buildingsPerTick = n;
  }

  /** Multi-day step used by fast-forward: one pass over every building covering K days. */
  private coarseStep(day: number, K: number): void {
    const ctx = this.ctx!, w = this.world!, clock = this.clock!;
    clock.lastTick = day * TICKS_PER_DAY;
    w.time.day = Math.max(w.time.day, day);
    this.beginDay(day, false);
    this.refreshMods();
    if (ctx.outside.dirty) ctx.outside.recompute();
    const r = ctx.state.rates;
    ctx.garbagePool = r.garbageAllow * K;
    ctx.deathPool = r.deathAllow * K;
    for (let s = 0; s < TICKS_PER_DAY; s++) this.processSlice(s, K);
    for (let i = 0; i < K * TICKS_PER_DAY; i++) this.growth!.tick();
    ctx.candidates.process(1e6);
    this.flushRemovals();
    ctx.syncRng();
    this.game.events.emit('sim:tick', { day: w.time.day, tick: clock.lastTick });
    for (let d = day + 1; d < day + K; d++) this.game.events.emit('sim:day', { day: d });
    this.pendingDt = K;
    clock.lastTick = (day + K) * TICKS_PER_DAY - 1;
    w.time.day = Math.max(w.time.day, clock.lastTick / TICKS_PER_DAY);
  }

  private refreshMods(): void {
    const ctx = this.ctx!;
    try {
      ctx.mods = { ...neutralMods(), ...this.game.eventSystem.modifiers() };
    } catch {
      ctx.mods = neutralMods();
    }
  }

  /** Update one slice of the day's buildings; returns the number visited. */
  private processSlice(slice: number, k: number): number {
    const ctx = this.ctx!, w = this.world!;
    const ids = ctx.ids, n = ids.length;
    const from = Math.floor((n * slice) / TICKS_PER_DAY);
    const to = Math.floor((n * (slice + 1)) / TICKS_PER_DAY);
    for (let i = from; i < to; i++) {
      const b = w.buildings.get(ids[i]);
      if (!b) continue;
      if (b.kind === 'zoned') updateZoned(ctx, b, k);
      else updateService(ctx, b, k);
    }
    return to - from;
  }

  private flushRemovals(): void {
    const ctx = this.ctx!, w = this.world!;
    if (!ctx.removeQueue.length) return;
    const q = ctx.removeQueue;
    ctx.removeQueue = [];
    for (const id of q) {
      const b = w.getBuilding(id);
      if (!b) continue;
      w.removeBuilding(id);
      ctx.candidates.markRect({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }, 1, true);
    }
    ctx.idsDirty = true;
  }

  /** Start day `day`: close the previous day (and month/year), snapshot buildings, reset accumulators. */
  private beginDay(day: number, partial: boolean): void {
    const ctx = this.ctx!, w = this.world!;
    const continuing = this.dayStarted;
    if (continuing) {
      this.endDay(this.pendingDt);
      this.pendingDt = 1;
    }
    this.dayStarted = true;
    // calendar
    if (continuing && day > 0) {
      if (day % DAYS_PER_MONTH === 0) {
        this.economy!.closeMonth();
        updateStreaks(ctx);
        checkAchievements(ctx);
      }
      this.game.events.emit('sim:day', { day });
      if (day % DAYS_PER_MONTH === 0) {
        const c = calendar(day);
        this.game.events.emit('sim:month', { day, month: c.month, year: c.year });
      }
      if (day % DAYS_PER_YEAR === 0) this.game.events.emit('sim:year', { year: START_YEAR + day / DAYS_PER_YEAR });
    }
    ctx.policies.sync();
    // snapshot of buildings processed today (insertion order = stable slices)
    ctx.ids = Array.from(w.buildings.keys());
    ctx.idsDirty = false;
    ctx.agg = new DayAgg();
    ctx.agg.partial = partial;
    ctx.garbagePool = 0;
    ctx.deathPool = 0;
    ctx.facilities = ctx.nextFacilities;
    ctx.nextFacilities = { garbage: [], hearse: [], ambulance: [], police: [] };
    const density = this.game.settings.value.graphics.vehicleDensity ?? 1;
    ctx.dispatchLeft = Math.round(24 * Math.max(0.1, density));
  }

  /** Finalise the accumulated day(s): rates, stats, demand, ledger, money, progression, feeds. */
  private endDay(dtDays: number): void {
    const ctx = this.ctx!, w = this.world!, st = ctx.state, m = st.metrics;
    const a = ctx.agg;
    settleStorage(ctx);
    if (!a.partial) {
      this.flows = computeRates(ctx, a);
      ctx.last = a;
      ctx.lastValid = true;
      writeStats(ctx, a);
      ctx.perks = a.perks.resolve();
      rollCounts(ctx, a, dtDays);
      this.why = updateDemand(ctx, a, dtDays);
      st.ledger = this.economy!.buildLedger(a, exportDuty(this.flows));
      m.maxPopulation = Math.max(m.maxPopulation, w.stats.population);
      m.maxTourists = Math.max(m.maxTourists, w.stats.tourists);
      m.maxLevel5 = Math.max(m.maxLevel5, a.level5);
      m.maxLandValue = Math.max(m.maxLandValue, w.stats.landValue);
    }
    this.economy!.accrue(dtDays);
    const money = w.economy.money;
    m.maxMoney = Math.max(m.maxMoney, money);
    if (money < m.minMoney) m.minMoney = money;
    if (m.minMoney < 0 && money >= 100_000 && m.comeback === 0) m.comeback = m.minMoney;
    w.stats.netIncome = Math.round(this.economy!.projectedNet());
    checkMilestones(ctx);
    ctx.refreshGrace();
    ctx.refreshServiceFields();
    this.growth!.daily();
    this.chirper!.daily();
    this.advisor!.daily();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Queries
  // ════════════════════════════════════════════════════════════════════════

  getDemand(): Record<ZoneCategory, number> {
    return this.world?.stats.demand ?? { res: 0, com: 0, ind: 0, off: 0 };
  }

  /** human-readable reasons behind each demand bar */
  demandFactors(): DemandFactors {
    return this.why;
  }

  buildingInfo(id: number): BuildingInfo | null {
    return this.ctx ? buildingInfo(this.ctx, id) : null;
  }

  /** deterministic citizen names for a building */
  citizenNames(b: Building, count: number): string[] {
    return citizenNames(b, count);
  }

  /** display name of a building (custom name, catalog name or a generated one) */
  buildingTitle(b: Building): string {
    return buildingTitle(b);
  }

  /** city-wide rates of the last full day (labour market, services…) */
  get rates(): CityRates | null {
    return this.ctx?.state.rates ?? null;
  }

  /** combined policy effects that apply at a building (city-wide + its district) */
  policyEffectsAt(b: Building): Effects | null {
    return this.ctx ? this.ctx.policies.at(b) : null;
  }

  /** policy fire-risk multiplier at a building (smoke detectors…), for the event system */
  fireRiskAt(b: Building): number {
    return this.ctx ? this.ctx.policies.at(b).fireRisk : 1;
  }

  /** city-wide perks currently granted by special service buildings (tax office, courthouse…) */
  get perks(): Perks | null {
    return this.ctx?.perks ?? null;
  }

  /** construction is frozen while bankrupt (money < 0 for 3 months) */
  get bankrupt(): boolean {
    return this.economy?.bankrupt ?? false;
  }

  /** advice currently applicable (sorted by urgency), regardless of cooldowns */
  advisorTips(): AdvisorTip[] {
    if (!this.advisor || !this.ctx?.lastValid) return [];
    return this.advisor.evaluate().sort((a, b) => b.priority - a.priority);
  }

  /** 0..1 progress of an achievement (1 when unlocked) */
  achievementProgress(id: string): number {
    const w = this.world, ctx = this.ctx;
    if (!w || !ctx) return 0;
    if (w.achievements.includes(id)) return 1;
    const a = achievementDef(id);
    if (!a || !ctx.lastValid) return 0;
    const snap = achievementSnapshot(ctx);
    try {
      return a.progress ? Math.max(0, Math.min(1, a.progress(snap))) : a.check(snap) ? 1 : 0;
    } catch {
      return 0;
    }
  }

  /** all achievements with unlocked flag and progress */
  achievementList(): { id: string; name: string; description: string; icon: string; hidden: boolean; unlocked: boolean; progress: number }[] {
    const w = this.world;
    return ACHIEVEMENTS.map((a) => ({
      id: a.id, name: a.name, description: a.description, icon: a.icon, hidden: !!a.hidden,
      unlocked: !!w?.achievements.includes(a.id), progress: this.achievementProgress(a.id),
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Economy
  // ════════════════════════════════════════════════════════════════════════

  setTax(cat: TaxCategory, rate: number): void {
    const before = this.world?.economy.taxes[cat];
    this.economy?.setTax(cat, rate);
    const after = this.world?.economy.taxes[cat];
    if (before !== undefined && after !== undefined && Math.abs(after - before) >= 0.005 && (this.world?.stats.population ?? 0) > 200) {
      this.chirper?.queue(after > before ? 'tax_raise' : 'tax_cut');
    }
    if (this.world && this.economy) this.world.stats.netIncome = Math.round(this.economy.projectedNet());
  }

  setBudget(cat: BudgetCategory, v: number): void {
    this.economy?.setBudget(cat, v);
    if (this.world && this.economy) this.world.stats.netIncome = Math.round(this.economy.projectedNet());
  }

  takeLoan(amount: number, years: number): boolean {
    if (!this.economy) return false;
    const r = this.economy.takeLoan(amount, years);
    this.lastError = r.reason ?? '';
    if (r.ok) this.chirper?.queue('loan');
    return r.ok;
  }

  repayLoan(id: number): boolean {
    if (!this.economy) return false;
    const r = this.economy.repayLoan(id);
    this.lastError = r.reason ?? '';
    return r.ok;
  }

  /** available loan tiers (with lock state, monthly payment and total interest) */
  loanOffers(): LoanOffer[] {
    return this.economy?.offers() ?? [];
  }

  /** projected monthly income/expense breakdown at current state */
  projection(): { income: Record<string, number>; expense: Record<string, number> } {
    if (!this.economy) return { income: {}, expense: {} };
    const p = this.economy.monthly();
    const round = (r: Record<string, number>) => {
      const o: Record<string, number> = {};
      for (const [k, v] of Object.entries(r)) o[k] = Math.round(v);
      return o;
    };
    return { income: round(p.income), expense: round(p.expense) };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Policies
  // ════════════════════════════════════════════════════════════════════════

  togglePolicy(id: string, districtId?: number): boolean {
    const ctx = this.ctx, w = this.world;
    if (!ctx || !w) return false;
    const r = ctx.policies.toggle(id, districtId);
    this.lastError = r.reason ?? '';
    if (!r.ok) return false;
    const p = policyDef(id);
    const where = districtId ? w.districts.find((d) => d.id === districtId)?.name ?? 'district' : 'city-wide';
    if (r.active) {
      ctx.state.metrics.policiesEnacted++;
      if (p) this.chirper?.queue('policy', { policy: p.name });
    }
    w.notify({ kind: 'info', title: `${r.active ? 'Enacted' : 'Repealed'}: ${p?.name ?? id}`, text: `${where === 'city-wide' ? 'City-wide' : `In ${where}`}. ${p?.details.join(' · ') ?? ''}`, icon: p?.icon ?? '📜' });
    if (this.economy) w.stats.netIncome = Math.round(this.economy.projectedNet());
    return true;
  }

  isPolicyActive(id: string, districtId?: number): boolean {
    return this.ctx?.policies.isActive(id, districtId) ?? false;
  }

  /** monthly cost of a policy in a scope at the current population */
  policyCost(id: string, districtId?: number): number {
    const ctx = this.ctx, p = policyDef(id);
    if (!ctx || !p) return 0;
    const pop = districtId ? ctx.last.districtPop[districtId] ?? 0 : this.world?.stats.population ?? 0;
    return Math.round(ctx.policies.costFor(p, pop));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Cheats / commands
  // ════════════════════════════════════════════════════════════════════════

  addResidents(n: number): void {
    const w = this.world, ctx = this.ctx;
    if (!w || !ctx) return;
    let left = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
    if (!left) return;
    const edu = ctx.state.rates.immigrantEdu;
    let added = 0;
    for (const b of w.buildings.values()) {
      if (!left) break;
      if (b.kind !== 'zoned' || !isResidentialZone(b.zone) || b.flags & BFlag.UnderConstruction) continue;
      const vac = vacancyOf(b);
      if (!vac) continue;
      const k = Math.min(vac, left);
      b.education = (b.education * b.residents + edu * k) / (b.residents + k);
      b.residents += k;
      left -= k;
      added += k;
    }
    if (left > 0) ctx.state.pendingImmigrants += left;
    w.stats.population += added;
    w.stats.movedIn += added;
    checkMilestones(ctx);
  }

  grantMilestone(index: number): void {
    if (this.ctx) grantMilestone(this.ctx, index, { cheat: true });
  }
}
