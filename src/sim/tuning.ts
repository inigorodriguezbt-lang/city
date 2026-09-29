// ─────────────────────────────────────────────────────────────────────────────
// Simulation balance constants. Every gameplay number the simulation uses lives
// here so balancing is a one-file job. Units: "per day" = one in-game day,
// "per month" = DAYS_PER_MONTH days. Fields are 0..255 unless stated otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import type { TaxCategory, TransitMode, ZoneCategory } from '../core/types';

// ── demography ──────────────────────────────────────────────────────────────
export const HOUSEHOLD_SIZE = 2.6;
/** share of residents of working age */
export const WORKFORCE_SHARE = 0.55;
/** share of residents in school / university age */
export const STUDENT_SHARE = 0.18;
export const SENIOR_SHARE = 0.15;
export const CHILD_SHARE = 0.12;
/** unemployment that always exists (job changes) */
export const FRICTIONAL_UNEMPLOYMENT = 0.03;
/** yearly base mortality (healthy city) */
export const BASE_MORTALITY = 0.0065;
/** extra yearly mortality at 0 health */
export const SICK_MORTALITY = 0.05;
/** yearly base birth rate */
export const BASE_BIRTH_RATE = 0.013;

// ── occupancy dynamics ──────────────────────────────────────────────────────
/** fraction of vacant homes filled per day at residential desire 0 / 1 */
export const MOVE_IN_MIN = 0.05;
export const MOVE_IN_MAX = 0.32;
/** job slots filled / vacated per day (fraction of the gap) */
export const WORKER_RAMP = 0.2;
/** days a building stays in "upgrading" scaffolding after a level-up */
export const UPGRADE_SCAFFOLD_DAYS = 4;

// ── construction ────────────────────────────────────────────────────────────
export const CONSTRUCTION_MIN_DAYS = 6;
export const CONSTRUCTION_MAX_DAYS = 20;
export const CONSTRUCTION_DAYS_PER_CELL = 0.95;
export const SERVICE_CONSTRUCTION_DAYS = 3;

// ── growth ──────────────────────────────────────────────────────────────────
/** max spawn attempts per category per tick */
export const MAX_SPAWNS_PER_TICK = 6;
/** candidate samples per spawn attempt */
export const SPAWN_SAMPLES = 4;
/** resource average needed for specialised industry lots */
export const RESOURCE_THRESHOLD = 60;
/** chunk rows rescanned per tick for the candidate set */
export const CANDIDATE_CHUNKS_PER_TICK = 12;
/** days between densification attempts per category */
export const DENSIFY_INTERVAL = 3;

// ── levels ──────────────────────────────────────────────────────────────────
/** land value needed to reach level [index] */
export const LEVEL_LAND_VALUE = [0, 0, 32, 60, 95, 135];
/** average education (0..100) of residents needed to reach level [index] */
export const LEVEL_EDUCATION = [0, 0, 12, 28, 46, 64];
/** service score (0..1) needed to reach level [index] */
export const LEVEL_SERVICES = [0, 0, 0.18, 0.34, 0.52, 0.68];
/** city educated-workforce share needed by industry to reach level [index] */
export const LEVEL_IND_EDUCATED = [0, 0, 0.06, 0.16, 0.3, 0.44];
/** base days of sustained good conditions to level up (scaled by level) */
export const LEVEL_UP_DAYS = 26;
export const LEVEL_UP_DAYS_PER_LEVEL = 14;
/** specialised industry max level */
export const SPECIALIZED_MAX_LEVEL = 3;

// ── distress / abandonment ──────────────────────────────────────────────────
/** days without a utility before it becomes a severe (abandonment) problem */
export const UTILITY_GRACE_DAYS = 30;
export const NO_ROAD_GRACE_DAYS = 10;
export const WORKER_GRACE_DAYS = 30;
export const CUSTOMER_GRACE_DAYS = 30;
/** distress at which a building is abandoned */
export const ABANDON_DISTRESS = 40;
/** distress recovered per day with no severe problem */
export const DISTRESS_RECOVERY = 3;
/** days abandoned before auto-bulldoze (when enabled) */
export const AUTO_BULLDOZE_DAYS = 12;
/** days an abandoned building must be problem-free to be reoccupied */
export const RECOVERY_DAYS = 20;
/** days before rubble is cleared */
export const RUBBLE_CLEAR_DAYS = 60;
export const BURNED_CLEAR_DAYS = 45;
/** days a zoned building survives on re-zoned land */
export const ZONE_MISMATCH_DAYS = 12;

// ── thresholds for problems (fields 0..255) ─────────────────────────────────
export const CRIME_PROBLEM = 150;
export const CRIME_SEVERE = 205;
export const POLLUTION_PROBLEM = 110;
export const POLLUTION_SEVERE = 190;
export const NOISE_PROBLEM = 160;
export const TRAFFIC_PROBLEM = 205;
export const SICK_HEALTH = 38;
export const SICK_SEVERE = 22;
export const UNHAPPY = 25;
export const MISERABLE = 14;
/** coverage at which a service is considered "covering" the lot */
export const COVERAGE_OK = 60;
/** coverage for full service quality */
export const COVERAGE_FULL = 150;
/** garbage coverage needed for pickup */
export const GARBAGE_PICKUP_MIN = 30;
export const DEATHCARE_PICKUP_MIN = 25;

// ── economy ─────────────────────────────────────────────────────────────────
/** $ per occupant per month at a 10 % tax rate, level 1, average land value */
export const TAX_BASE: Record<TaxCategory, number> = {
  resLow: 1.6,
  resHigh: 1.45,
  comLow: 2.4,
  comHigh: 2.6,
  office: 2.9,
  industry: 2.1,
};
export const LEVEL_TAX = [0, 1, 1.3, 1.7, 2.2, 2.8];
export const TAX_MIN = 0;
export const TAX_MAX = 0.29;
export const BUDGET_MIN = 0.5;
export const BUDGET_MAX = 1.5;
/** tax rate above which demand/happiness start to suffer */
export const TAX_COMFORT = 0.12;
/** $ per tourist per month */
export const TOURIST_SPEND = 2.4;
/** $ the city earns (export duty) per unit of exported manufactured goods */
export const EXPORT_PRICE = 0.07;
/** $ the city earns per unit of exported raw material (farming, forestry, ore, oil) */
export const RAW_EXPORT_PRICE = 0.09;
/** share of commercial goods demand that imports can cover when connected */
export const IMPORT_SHARE_MAX = 0.6;
/** share of raw output that feeds local commerce directly (food, timber…) */
export const RAW_LOCAL_SHARE = 0.3;
/** transit fare per passenger by mode */
export const TRANSIT_FARE: Record<TransitMode, number> = { bus: 1.5, tram: 1.8, metro: 2.2, train: 3, ferry: 3, monorail: 2.5 };
/** $ per line vehicle per month */
export const TRANSIT_VEHICLE_UPKEEP: Record<TransitMode, number> = { bus: 60, tram: 110, metro: 180, train: 250, ferry: 200, monorail: 160 };
/** months of negative money before bankruptcy warning */
export const BANKRUPTCY_MONTHS = 3;
export const MAX_LOANS = 3;

export interface LoanTier {
  amount: number;
  years: number;
  rate: number;
  /** milestone index required */
  unlock: number;
}
export const LOAN_TIERS: LoanTier[] = [
  { amount: 50_000, years: 5, rate: 0.05, unlock: 0 },
  { amount: 150_000, years: 10, rate: 0.07, unlock: 0 },
  { amount: 400_000, years: 20, rate: 0.09, unlock: 3 },
  { amount: 1_200_000, years: 25, rate: 0.095, unlock: 6 },
  { amount: 4_000_000, years: 30, rate: 0.1, unlock: 9 },
];

// ── commerce & industry ─────────────────────────────────────────────────────
/** residents served per commercial job at balance */
export const RESIDENTS_PER_COM_JOB = 4.8;
/** goods units needed per commercial job per day */
export const GOODS_PER_COM_JOB = 1;
/** goods produced per industrial worker per day at level 1 */
export const GOODS_PER_IND_WORKER = 1.25;
/** raw-material industries: output per worker (exported or refined) */
export const RAW_PER_WORKER = 1.1;
/** fraction of a job's education requirement by category (level 1 → +per level) */
export const EDU_REQ: Record<ZoneCategory | 'svc', [number, number]> = {
  res: [0, 0],
  com: [0.12, 0.08],
  ind: [0.05, 0.08],
  off: [0.55, 0.08],
  svc: [0.35, 0],
};

// ── tourism ─────────────────────────────────────────────────────────────────
export const DEFAULT_ATTRACTION: Record<string, number> = {
  landmark: 60,
  monument: 160,
  tourism: 40,
  parks: 2,
  plazas: 2,
};
/** monthly tourists per point of attraction */
export const TOURISTS_PER_ATTRACTION = 11;

// ── demand ──────────────────────────────────────────────────────────────────
export const DEMAND_SMOOTHING = 0.14;
/** job share targets of the private job market */
export const COM_JOB_SHARE = 0.3;
export const OFF_JOB_SHARE_MAX = 0.34;

// ── labour market ───────────────────────────────────────────────────────────
/** outside commuters available: base + share of population */
export const COMMUTER_BASE = 60;
export const COMMUTER_POP_SHARE = 0.22;
/** share of a job shortfall that outside commuters fill */
export const COMMUTER_FILL = 0.55;
/** a service building keeps this share of effectiveness with no staff (skeleton crew) */
export const STAFF_FLOOR = 0.3;

// ── health, death, garbage ──────────────────────────────────────────────────
/** share of residents sick at perfect / zero health */
export const SICK_BASE = 0.008;
export const SICK_RANGE = 0.075;
/** days of production a garbage pile may reach before it is a problem / severe */
export const GARBAGE_PROBLEM_DAYS = 6;
export const GARBAGE_SEVERE_DAYS = 35;
/** landfill intake per garbage truck per day, cemetery intake per hearse per day */
export const LANDFILL_INTAKE_PER_VEHICLE = 70;
export const CEMETERY_INTAKE_PER_VEHICLE = 3;
/** days bodies may wait before the Dead problem appears / becomes severe */
export const DEAD_PROBLEM_DAYS = 3;
export const DEAD_SEVERE_DAYS = 12;
/** days after a service category unlocks before its problems start to apply */
export const SERVICE_GRACE_DAYS = 45;

// ── chirper / advisor ───────────────────────────────────────────────────────
export const CHIRP_MIN_GAP = 2;
export const CHIRP_MAX_GAP = 5;
export const ADVISOR_MIN_GAP = 3;
