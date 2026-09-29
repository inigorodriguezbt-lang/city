// Per-day accumulators. Every building is visited exactly once per in-game day
// (sliced across TICKS_PER_DAY ticks); its contributions land here and are
// turned into CityStats, rates, demand and money at the end of the day.
import type { Building, TaxCategory, ZoneCategory } from '../core/types';

export const PROBLEM_SLOTS = 20;

export type Cat4 = Record<ZoneCategory, number>;
const cat4 = (): Cat4 => ({ res: 0, com: 0, ind: 0, off: 0 });

export class DayAgg {
  /** true when the day's pass did not cover every building (loaded mid-day) */
  partial = false;
  // ── people ────────────────────────────────────────────────────────────
  population = 0;
  households = 0;
  workforce = 0;
  /** Σ workforce × education share */
  educatedWorkforce = 0;
  studentsPotential = 0;
  seniors = 0;
  /** residential capacity of completed, occupied-able buildings */
  resCap = 0;
  /** residential capacity still under construction */
  resCapUC = 0;
  resVacant = 0;
  /** residents whose home reaches an outside connection */
  outsidePop = 0;
  // ── jobs ──────────────────────────────────────────────────────────────
  jobs: Cat4 = cat4();
  jobsUC: Cat4 = cat4();
  workers: Cat4 = cat4();
  svcJobs = 0;
  svcWorkers = 0;
  /** Σ jobs × education requirement (all employers) */
  eduJobs = 0;
  uneJobs = 0;
  // ── wellbeing (weighted by occupants) ─────────────────────────────────
  weight = 0;
  happySum = 0;
  healthSum = 0;
  eduSum = 0;
  eduWeight = 0;
  // environment (weighted by building footprint cells)
  envWeight = 0;
  crimeSum = 0;
  landSum = 0;
  pollSum = 0;
  noiseSum = 0;
  maxLand = 0;
  sick = 0;
  deadWaiting = 0;
  births = 0;
  deaths = 0;
  movedIn = 0;
  movedOut = 0;
  // ── commerce & industry ───────────────────────────────────────────────
  buyingPower = 0;
  goodsNeed = 0;
  production = 0;
  rawProduction = 0;
  // ── garbage & deathcare ───────────────────────────────────────────────
  garbageProduced = 0;
  garbageCollected = 0;
  garbagePile = 0;
  bodiesCollected = 0;
  gbStorageCap = 0;
  gbStored = 0;
  gbThroughput = 0;
  dcStorageCap = 0;
  dcStored = 0;
  dcThroughput = 0;
  landfills: Building[] = [];
  cemeteries: Building[] = [];
  // ── services ──────────────────────────────────────────────────────────
  healthCap = 0;
  eduCap = 0;
  attraction = 0;
  parks = 0;
  landmarks = 0;
  monuments = 0;
  serviceByCat: Record<string, number> = {};
  /** power produced by renewables (nominal MW) and total nominal MW */
  renewableMW = 0;
  nominalMW = 0;
  // ── economy (per day) ─────────────────────────────────────────────────
  taxBase: Record<TaxCategory, number> = { resLow: 0, resHigh: 0, comLow: 0, comHigh: 0, office: 0, industry: 0 };
  upkeepBase: Record<string, number> = {};
  exportsValue = 0;
  // ── counts ────────────────────────────────────────────────────────────
  buildings = 0;
  zoned = 0;
  services = 0;
  abandoned = 0;
  collapsed = 0;
  underConstruction = 0;
  level5 = 0;
  highDensity = 0;
  byZone = new Int32Array(16);
  /** completed zoned buildings per level (index 1..5) */
  byLevel = new Int32Array(6);
  styles = new Set<string>();
  problemCount = new Int32Array(PROBLEM_SLOTS);
  /** reservoir-sampled building id per problem bit */
  problemSample = new Int32Array(PROBLEM_SLOTS);
  /** any residential building (for chirp authors) */
  resSample = 0;
  resSeen = 0;
  // ── per district ──────────────────────────────────────────────────────
  districtPop = new Float64Array(256);
  districtJobs = new Float64Array(256);
  districtHappy = new Float64Array(256);
  districtLand = new Float64Array(256);
  districtBuildings = new Float64Array(256);

  /** record a problem bitmask with reservoir sampling of an example building */
  addProblems(mask: number, id: number, r: number): void {
    if (!mask) return;
    for (let bit = 0; bit < PROBLEM_SLOTS; bit++) {
      if (!(mask & (1 << bit))) continue;
      const n = ++this.problemCount[bit];
      if (n === 1 || r * n < 1) this.problemSample[bit] = id;
    }
  }

  problems(bitMask: number): number {
    for (let bit = 0; bit < PROBLEM_SLOTS; bit++) if (bitMask === 1 << bit) return this.problemCount[bit];
    return 0;
  }

  sample(bitMask: number): number {
    for (let bit = 0; bit < PROBLEM_SLOTS; bit++) if (bitMask === 1 << bit) return this.problemSample[bit];
    return 0;
  }

  get totalJobs(): number {
    return this.jobs.com + this.jobs.ind + this.jobs.off + this.svcJobs;
  }
  get zonedJobs(): number {
    return this.jobs.com + this.jobs.ind + this.jobs.off;
  }
  get totalWorkers(): number {
    return this.workers.com + this.workers.ind + this.workers.off + this.svcWorkers;
  }
}
