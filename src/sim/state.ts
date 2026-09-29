// Persisted simulation state. City-level state lives in `world.ext.sim`,
// per-building state in `building.ext.sim`. Everything is plain JSON.
import type { Building, TaxCategory, ZoneCategory } from '../core/types';
import type { World } from '../world/World';

/** Per-building simulation state (`b.ext.sim`). Short keys keep saves small. */
export interface BSim {
  /** level-up progress 0..1 */
  lp: number;
  /** consecutive days without power / water / sewage / road access */
  np: number;
  nw: number;
  ns: number;
  nr: number;
  /** consecutive days understaffed / without customers or buyers / without goods */
  nwk: number;
  ncu: number;
  ngd: number;
  /** bodies waiting for deathcare pickup, and days they have waited */
  dead: number;
  dd: number;
  /** days in a terminal state (abandoned, burned, rubble) */
  cd: number;
  /** remaining days of upgrade scaffolding */
  up: number;
  /** stored units (landfill garbage / cemetery bodies) for storage services */
  st: number;
  /** days the zone under the building no longer matches */
  zm: number;
  /** primary problem last announced to renderers (see info.primaryProblem) */
  pp: number;
  /** sick residents */
  sick: number;
  /** days with land value too high for the building's level */
  hr: number;
  /** consecutive problem-free days while abandoned (recovery) */
  rc: number;
  /** total construction days of this building (set at spawn) */
  bd: number;
  /** code of the requirement blocking the next level (see lifecycle.LevelBlock) */
  lr: number;
  /** estimated taxes paid per month at current rates ($) */
  tx: number;
  /** 1 once the terminal (rubble) state has been seen */
  tf: number;
  /** consumption multipliers from policies (read by consumption.ts) */
  pm?: number;
  wm?: number;
  sm?: number;
  gm?: number;
}

/** 1 stored as a non-integer double (1 + 2⁻⁵²): numerically one, but never a small integer. */
const ONE = 1 + Number.EPSILON;

export function newBSim(): BSim {
  // Fields that hold fractions start as -0 / ONE (heap doubles, numerically 0 / 1) so
  // the engine picks a double representation up front instead of migrating
  // thousands of objects the first time a value becomes fractional.
  return {
    lp: -0, np: -0, nw: -0, ns: -0, nr: -0, nwk: -0, ncu: -0, ngd: -0, dead: 0, dd: -0, cd: -0, up: -0, st: -0, zm: -0, pp: 0, sick: 0,
    hr: -0, rc: -0, bd: 10.5, lr: 0, tx: 0, tf: 0, pm: ONE, wm: ONE, sm: ONE, gm: ONE,
  };
}

/** Get (creating on demand) a building's simulation state. */
export function bsim(b: Building): BSim {
  const ext = (b.ext ??= {});
  let s = ext.sim as BSim | undefined;
  if (!s || typeof s !== 'object') {
    s = newBSim();
    ext.sim = s;
  } else if (s.lp === undefined) {
    // older / partial state → fill missing keys
    const d = newBSim();
    for (const k of Object.keys(d) as (keyof BSim)[]) if (s[k] === undefined) (s as unknown as Record<string, number>)[k] = d[k] as number;
  }
  return s;
}

/** City-wide rates computed at the end of each day and applied during the next day's pass. */
export interface CityRates {
  /** fill ratio for educated / uneducated job positions */
  eduFill: number;
  uneFill: number;
  /** fraction of vacant homes filled per day */
  moveIn: number;
  /** base fraction of residents leaving per day */
  emigrate: number;
  /** commercial customers / capacity (≈1 balanced) */
  customers: number;
  /** goods supplied / needed by commerce (0..1) */
  goods: number;
  /** share of industrial output sold (0..1) */
  sales: number;
  /** share of goods that are imported (0..1) */
  imported: number;
  /** enrolled / potential students (0..1) */
  enroll: number;
  /** treated / sick (0..1) */
  treat: number;
  /** garbage units that can still be accepted today */
  garbageAllow: number;
  /** bodies that can still be accepted today */
  deathAllow: number;
  /** 1 when the service is unlocked (problems apply), 0 while handled privately */
  garbageOn: number;
  deathOn: number;
  healthOn: number;
  educationOn: number;
  unemployment: number;
  /** educated share of the workforce */
  educated: number;
  /** city-wide happiness 0..100 */
  happiness: number;
  /** monthly tourists */
  tourists: number;
  /** 1 when the road network reaches an outside connection */
  outside: number;
  /** commuters from outside filling jobs */
  commuters: number;
  /** immigrant education level 0..100 */
  immigrantEdu: number;
}

export function defaultRates(): CityRates {
  return {
    eduFill: 1, uneFill: 1, moveIn: 0.2, emigrate: 0, customers: 1, goods: 1, sales: 1, imported: 0, enroll: 0, treat: 1,
    garbageAllow: 0, deathAllow: 0, garbageOn: 0, deathOn: 0, healthOn: 0, educationOn: 0,
    unemployment: 0, educated: 0.2, happiness: 60, tourists: 0, outside: 1, commuters: 0, immigrantEdu: 22,
  };
}

/** Daily money bases used for projections (all per day). */
export interface Ledger {
  /** tax income per category at a 100 % rate (multiply by the tax rate) */
  taxBase: Record<TaxCategory, number>;
  /** service upkeep per budget category at 100 % budget */
  upkeepBase: Record<string, number>;
  /** road upkeep at 100 % road budget */
  roadsBase: number;
  /** other income (tourism, transit, exports…) */
  income: Record<string, number>;
  /** other expenses (policies, loans, transit vehicles…) */
  expense: Record<string, number>;
}

export function emptyLedger(): Ledger {
  return {
    taxBase: { resLow: 0, resHigh: 0, comLow: 0, comHigh: 0, office: 0, industry: 0 },
    upkeepBase: {}, roadsBase: 0, income: {}, expense: {},
  };
}

/** Long-running counters for achievements, chirps and statistics. */
export interface Metrics {
  months: number;
  maxPopulation: number;
  maxMoney: number;
  minMoney: number;
  /** consecutive months with positive net income */
  profitStreak: number;
  disasters: number;
  loansTaken: number;
  loansRepaid: number;
  chirps: number;
  abandonedEver: number;
  levelUps: number;
  spawned: number;
  maxTourists: number;
  maxExports: number;
  /** consecutive months meeting the "clean city" criterion etc. are computed live */
  maxLevel5: number;
  policiesEnacted: number;
  /** consecutive months with average happiness >= 85 */
  happyStreak: number;
  /** consecutive months with pollution below 6 % (population >= 5000) */
  cleanStreak: number;
  /** consecutive months with unemployment below 5 % (population >= 2000) */
  employStreak: number;
  maxMonthlyIncome: number;
  maxNetIncome: number;
  maxLandValue: number;
  recovered: number;
  autoBulldozed: number;
  densified: number;
  /** most loans held at the same time */
  maxLoans: number;
  /** lowest money ever reached after going into debt, then recovered above 100k */
  comeback: number;
  /** sum of births / deaths ever */
  totalBirths: number;
  totalDeaths: number;
}

export function defaultMetrics(): Metrics {
  return {
    months: 0, maxPopulation: 0, maxMoney: 0, minMoney: 0, profitStreak: 0, disasters: 0, loansTaken: 0, loansRepaid: 0,
    chirps: 0, abandonedEver: 0, levelUps: 0, spawned: 0, maxTourists: 0, maxExports: 0, maxLevel5: 0, policiesEnacted: 0,
    happyStreak: 0, cleanStreak: 0, employStreak: 0, maxMonthlyIncome: 0, maxNetIncome: 0, maxLandValue: 0, recovered: 0,
    autoBulldozed: 0, densified: 0, maxLoans: 0, comeback: 0, totalBirths: 0, totalDeaths: 0,
  };
}

export interface SimState {
  v: number;
  /** simulation RNG state */
  rng: number;
  /** last non-zero speed (for toggling pause) */
  lastSpeed: number;
  /** residential "desire" (willingness to move in), before vacancy effects */
  desire: Record<ZoneCategory, number>;
  /** fractional spawn accumulators */
  spawnAcc: Record<ZoneCategory, number>;
  /** next day a densification attempt may run, per category */
  densify: Record<ZoneCategory, number>;
  /** immigrants waiting for homes (from /give residents) */
  pendingImmigrants: number;
  /** consecutive months with money < 0 */
  negMonths: number;
  nextLoanId: number;
  rates: CityRates;
  ledger: Ledger;
  /** rolling 30-day windows */
  roll: { births: number[]; deaths: number[]; movedIn: number[]; movedOut: number[]; i: number };
  metrics: Metrics;
  chirp: { next: number; cd: Record<string, number>; recent: number[]; queue: { topic: string; vars: Record<string, string>; x?: number; y?: number; buildingId?: number }[] };
  /** next regular advisor notice day, last notice day, per-tip cooldowns */
  advisor: { next: number; last?: number; cd: Record<string, number> };
  /** exports sold in the current month ($) */
  monthExports: number;
  /** first day each service category was found unlocked (drives SERVICE_GRACE_DAYS) */
  svcUnlock: Record<string, number>;
  /** highest milestone whose unlock hints were already given by the advisor */
  hintedMilestone: number;
  /** last month a bankruptcy warning was shown */
  bankruptWarned: number;
  /** cells of the regional highway / railway that existed at founding (maintained by the state, no upkeep) */
  stateRoads: number[];
}

export function defaultSimState(seed: number): SimState {
  const z = () => ({ res: 0, com: 0, ind: 0, off: 0 });
  return {
    v: 1,
    rng: (seed ^ 0x2f6b1c3d) >>> 0 || 1,
    lastSpeed: 1,
    desire: { res: 0.7, com: 0.25, ind: 0.55, off: 0 },
    spawnAcc: z(),
    densify: z(),
    pendingImmigrants: 0,
    negMonths: 0,
    nextLoanId: 1,
    rates: defaultRates(),
    ledger: emptyLedger(),
    roll: { births: new Array(30).fill(0), deaths: new Array(30).fill(0), movedIn: new Array(30).fill(0), movedOut: new Array(30).fill(0), i: 0 },
    metrics: defaultMetrics(),
    chirp: { next: 3, cd: {}, recent: [], queue: [] },
    advisor: { next: 4, cd: {} },
    monthExports: 0,
    svcUnlock: {},
    hintedMilestone: 0,
    bankruptWarned: -1,
    stateRoads: [],
  };
}

/** Load (or create) the persisted sim state, filling any missing keys with defaults. */
export function loadSimState(world: World): SimState {
  const d = defaultSimState(world.settings.seed);
  const raw = world.ext.sim as Partial<SimState> | undefined;
  if (!raw || typeof raw !== 'object') {
    world.ext.sim = d;
    return d;
  }
  const s = raw as SimState;
  for (const k of Object.keys(d) as (keyof SimState)[]) {
    if (s[k] === undefined) (s as unknown as Record<string, unknown>)[k] = d[k];
  }
  // nested objects: fill missing keys
  s.rates = { ...d.rates, ...s.rates };
  s.metrics = { ...d.metrics, ...s.metrics };
  s.desire = { ...d.desire, ...s.desire };
  s.spawnAcc = { ...d.spawnAcc, ...s.spawnAcc };
  s.densify = { ...d.densify, ...s.densify };
  s.ledger = { ...d.ledger, ...s.ledger, taxBase: { ...d.ledger.taxBase, ...(s.ledger?.taxBase ?? {}) } };
  s.chirp = { ...d.chirp, ...s.chirp };
  if (!Array.isArray(s.chirp.queue)) s.chirp.queue = [];
  if (!Array.isArray(s.chirp.recent)) s.chirp.recent = [];
  s.advisor = { ...d.advisor, ...s.advisor };
  if (!s.advisor.cd || typeof s.advisor.cd !== 'object') s.advisor.cd = {};
  if (!s.chirp.cd || typeof s.chirp.cd !== 'object') s.chirp.cd = {};
  if (!s.svcUnlock || typeof s.svcUnlock !== 'object') s.svcUnlock = {};
  if (!Array.isArray(s.stateRoads)) s.stateRoads = [];
  for (const key of ['births', 'deaths', 'movedIn', 'movedOut'] as const) {
    if (!Array.isArray(s.roll?.[key]) || s.roll[key].length !== 30) s.roll = d.roll;
  }
  world.ext.sim = s;
  return s;
}
