// ─────────────────────────────────────────────────────────────────────────────
// URBIS shared type contract. FROZEN: do not rename/remove members. Additive
// changes only, and only by the integrator. Module-private types live in the
// owning module. No DOM / THREE imports here (used by workers too).
// ─────────────────────────────────────────────────────────────────────────────
import type { MapSizeId } from './constants';

// ── Grid & directions ───────────────────────────────────────────────────────
// Grid cell (x, y): x → world +X, y → world +Z. Three.js Y is up.
// Cell (x, y) spans world [x*CELL, (x+1)*CELL] × [y*CELL, (y+1)*CELL].

/** Cardinal direction. N = -y (-Z), E = +x (+X), S = +y (+Z), W = -x (-X). */
export enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}
export const DIR_DX = [0, 1, 0, -1] as const;
export const DIR_DY = [-1, 0, 1, 0] as const;
/** Bit for a direction in 4‑neighbour masks (N=1, E=2, S=4, W=8). */
export const DIR_BIT = [1, 2, 4, 8] as const;

export interface Cell {
  x: number;
  y: number;
}

// ── Roads ───────────────────────────────────────────────────────────────────
export enum RoadType {
  None = 0,
  Dirt = 1, // gravel lane, cheap, slow
  Street = 2, // 2‑lane with sidewalks
  Avenue = 3, // 4‑lane
  Boulevard = 4, // 6‑lane with tree median
  Highway = 5, // 6‑lane, no zoning, fast
  Pedestrian = 6, // footpath, no cars, zoning allowed
  Rail = 7, // train tracks (separate network, no zoning)
  TramAvenue = 8, // 4‑lane with tram tracks
}
export const ROAD_TYPE_COUNT = 9;

export interface RoadDef {
  type: RoadType;
  id: string;
  name: string;
  description: string;
  icon: string;
  lanes: number;
  /** km/h speed limit */
  speed: number;
  /** vehicles/day a cell can carry before congestion */
  capacity: number;
  /** $ per cell */
  cost: number;
  /** $ per cell per month */
  upkeep: number;
  /** visual paved width in meters (<= CELL) */
  width: number;
  allowsZoning: boolean;
  /** carries cars (false for pedestrian/rail) */
  cars: boolean;
  /** noise emitted (0..1 scale) */
  noise: number;
  /** milestone index required */
  unlock: number;
}

// ── Zones ───────────────────────────────────────────────────────────────────
export enum ZoneType {
  None = 0,
  ResLow = 1,
  ResMed = 2,
  ResHigh = 3,
  ComLow = 4,
  ComHigh = 5,
  Office = 6,
  Industry = 7,
  Farming = 8,
  Forestry = 9,
  Mining = 10,
  Oil = 11,
  MixedUse = 12,
}
export const ZONE_TYPE_COUNT = 13;

/** Demand category a zone feeds. */
export type ZoneCategory = 'res' | 'com' | 'ind' | 'off';

export interface ZoneDef {
  type: ZoneType;
  id: string;
  name: string;
  short: string;
  icon: string;
  category: ZoneCategory;
  /** CSS hex color for UI + ground tint */
  color: string;
  density: 'low' | 'med' | 'high';
  /** allowed lot sizes as [frontage, depth] in cells */
  lots: [number, number][];
  /** typical max floors at level 5 */
  maxFloors: number;
  /** residents (res) or jobs (others) per cell of lot area at level 1 → scaled by level */
  capacityPerCell: number;
  /** tax category */
  tax: TaxCategory;
  unlock: number;
  /** specialized industry resource requirement (field id) */
  resource?: 'fertility' | 'forest' | 'ore' | 'oil';
}

export type TaxCategory = 'resLow' | 'resHigh' | 'comLow' | 'comHigh' | 'office' | 'industry';

// ── Styles & themes ─────────────────────────────────────────────────────────
export type StyleId =
  | 'american'
  | 'european'
  | 'mediterranean'
  | 'nordic'
  | 'asian'
  | 'artdeco'
  | 'modern'
  | 'futuristic';

export interface StyleDef {
  id: StyleId;
  name: string;
  description: string;
  /** hex palettes the procedural generators draw from */
  wallColors: string[];
  roofColors: string[];
  trimColors: string[];
  /** preferred roof shapes for low buildings */
  roofs: ('flat' | 'gable' | 'hip' | 'mansard' | 'pagoda' | 'dome' | 'shed')[];
  unlock: number;
}

export type ThemeId = 'temperate' | 'boreal' | 'desert' | 'tropical' | 'alpine' | 'mediterranean';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** terrain colors (hex) */
  grass: string;
  grassDry: string;
  dirt: string;
  sand: string;
  rock: string;
  snow: string;
  waterShallow: string;
  waterDeep: string;
  /** tree species ids used by prop renderer */
  trees: TreeSpecies[];
  /** 0..1 how often it snows in winter */
  snowiness: number;
  /** 0..1 rain frequency */
  rainfall: number;
  /** base temperature °C (yearly mean) and seasonal swing */
  tempMean: number;
  tempSwing: number;
  defaultStyle: StyleId;
  /** mapgen hints */
  mountainousness: number; // 0..1
  waterAmount: number; // 0..1
  hasCoast: boolean;
}

export type TreeSpecies = 'oak' | 'maple' | 'birch' | 'pine' | 'spruce' | 'palm' | 'cypress' | 'olive' | 'cactus' | 'acacia' | 'willow' | 'cherry';

// ── Fields (per-cell scalar layers, Uint8 0..255) ───────────────────────────
export type FieldId =
  // derived environment
  | 'landValue'
  | 'pollution' // ground/air pollution
  | 'noise'
  | 'crime'
  | 'happiness'
  | 'traffic' // congestion on road cells
  // service coverage (0 = none, 255 = excellent)
  | 'police'
  | 'fire'
  | 'health'
  | 'education'
  | 'leisure' // parks & recreation
  | 'garbage' // collection coverage
  | 'deathcare'
  | 'transit'
  | 'tourism'
  // utilities (0/255 connected flags, or 0..255 quality)
  | 'power'
  | 'water'
  | 'sewage'
  // static resources from mapgen
  | 'fertility'
  | 'forest'
  | 'ore'
  | 'oil'
  | 'wind';

export const FIELD_IDS: FieldId[] = [
  'landValue', 'pollution', 'noise', 'crime', 'happiness', 'traffic',
  'police', 'fire', 'health', 'education', 'leisure', 'garbage', 'deathcare', 'transit', 'tourism',
  'power', 'water', 'sewage',
  'fertility', 'forest', 'ore', 'oil', 'wind',
];

// ── Buildings ───────────────────────────────────────────────────────────────
export enum BFlag {
  None = 0,
  Powered = 1 << 0,
  Watered = 1 << 1,
  Sewered = 1 << 2,
  RoadAccess = 1 << 3,
  OnFire = 1 << 4,
  Abandoned = 1 << 5,
  Collapsed = 1 << 6, // rubble after disaster/fire
  Burned = 1 << 7,
  Historical = 1 << 8, // won't level up / change
  Flooded = 1 << 9,
  Disabled = 1 << 10, // service building switched off by player
  UnderConstruction = 1 << 11,
  Upgrading = 1 << 12,
}

/** Problem icons shown above buildings / in info panel. */
export enum Problem {
  None = 0,
  NoPower = 1 << 0,
  NoWater = 1 << 1,
  NoSewage = 1 << 2,
  NoRoad = 1 << 3,
  Garbage = 1 << 4,
  Crime = 1 << 5,
  Sick = 1 << 6,
  Fire = 1 << 7,
  NoWorkers = 1 << 8,
  NoCustomers = 1 << 9,
  NoGoods = 1 << 10,
  Pollution = 1 << 11,
  Noise = 1 << 12,
  Abandoned = 1 << 13,
  Dead = 1 << 14, // deathcare missing
  NoEducated = 1 << 15,
  HighRent = 1 << 16, // land value too high for level
  Flooded = 1 << 17,
  Traffic = 1 << 18,
  LowHappiness = 1 << 19,
}

export type BuildingKind = 'zoned' | 'service';

export interface Building {
  id: number;
  kind: BuildingKind;
  /** catalog id for services; for zoned buildings `zoned:<zone id>` */
  defId: string;
  /** min corner cell */
  x: number;
  y: number;
  /** footprint extents on the grid (already rotated) */
  w: number;
  h: number;
  /** direction the front (road side) faces */
  rot: Dir;
  zone: ZoneType;
  /** 1..5 for zoned buildings; services 1 */
  level: number;
  style: StyleId;
  /** deterministic seed for procedural variation */
  seed: number;
  /** 0..1 construction progress (1 = complete) */
  built: number;
  /** in-game days since completion */
  age: number;
  /** BFlag bitmask */
  flags: number;
  /** Problem bitmask */
  problems: number;
  /** consecutive days with severe problems (drives abandonment) */
  distress: number;
  // population / economy
  residents: number;
  maxResidents: number;
  jobs: number; // capacity
  workers: number; // filled
  /** customers/visitors/patients/students currently served */
  visitors: number;
  /** commercial stock / industrial output 0..100 */
  goods: number;
  /** 0..100 */
  happiness: number;
  /** 0..100 */
  health: number;
  /** 0..100 average education of occupants */
  education: number;
  /** accumulated garbage units */
  garbage: number;
  /** fire intensity 0..1 when OnFire */
  fire: number;
  /** service building effectiveness 0..1.5 (budget, staffing, upkeep) */
  efficiency: number;
  /** player-given name (optional) */
  name?: string;
  /** free-form per-module state (JSON-serializable only) */
  ext?: Record<string, unknown>;
}

export type BuildingCategory =
  | 'power'
  | 'water' // water pumps, towers, treatment, sewage outlets
  | 'garbage'
  | 'health'
  | 'deathcare'
  | 'fire'
  | 'police'
  | 'education'
  | 'parks'
  | 'plazas'
  | 'transit'
  | 'government'
  | 'disaster'
  | 'landmark' // unique buildings unlocked by milestones
  | 'monument' // late-game wonders
  | 'tourism'
  | 'industry'; // unique/special industry buildings

export type VehicleType =
  | 'car'
  | 'taxi'
  | 'truck'
  | 'van'
  | 'bus'
  | 'tram'
  | 'metro'
  | 'train'
  | 'firetruck'
  | 'police'
  | 'ambulance'
  | 'garbage'
  | 'hearse'
  | 'service'
  | 'bike';

export interface FieldEffect {
  field: FieldId;
  /** radius in cells */
  radius: number;
  /** positive or negative magnitude (0..255 scale at center) */
  amount: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  /** single emoji used by UI */
  icon: string;
  category: BuildingCategory;
  /** optional sub-grouping inside category for the toolbar */
  group?: string;
  /** footprint in cells, unrotated: w = frontage (along road), h = depth */
  w: number;
  h: number;
  cost: number;
  /** $ per month at 100% budget */
  upkeep: number;
  /** milestone index required (0 = available from start) */
  unlock: number;
  /** procedural model key understood by the service model registry */
  model: string;
  /** approx visual height in meters (hint for models / LOD) */
  height: number;
  jobs?: number;
  /** generic capacity: patients, students, tons garbage/month, visitors, etc. */
  capacity?: number;
  capacityLabel?: string;
  /** MW produced (+) or consumed (-) */
  power?: number;
  /** m³/day water produced (+) or consumed (-) */
  water?: number;
  /** m³/day sewage processed (+) or produced (-) */
  sewage?: number;
  /** coverage + environment effects */
  effects?: FieldEffect[];
  /** vehicles this building dispatches */
  vehicles?: { type: VehicleType; count: number };
  /** placement constraints */
  placement?: {
    /** must touch shoreline (water pump, harbor, hydro) */
    shore?: boolean;
    /** must sit on water (offshore wind, dam) */
    onWater?: boolean;
    /** needs road frontage (default true) */
    road?: boolean;
    /** needs rail frontage (train station, cargo terminal) */
    rail?: boolean;
    /** requires resource field > threshold */
    resource?: FieldId;
    /** only one allowed */
    unique?: boolean;
    /** can be placed on slopes up to this (default MAX_LOT_SLOPE) */
    maxSlope?: number;
  };
  /** flat happiness bonus in radius via 'happiness' field */
  attractiveness?: number;
  /** extra searchable tags */
  tags?: string[];
}

// ── Milestones, policies, events, achievements ──────────────────────────────
export interface MilestoneDef {
  index: number;
  name: string;
  population: number;
  /** cash reward when reached */
  reward: number;
  /** human-readable unlock summary for UI */
  unlocksText: string[];
}

export interface PolicyDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'services' | 'taxation' | 'city_planning' | 'industry' | 'environment' | 'traffic' | 'social';
  /** $ per month per 1000 citizens (or flat) */
  costPer1000: number;
  unlock: number;
  /** can be applied per district */
  districtLevel: boolean;
}

export type EventSeverity = 'info' | 'good' | 'warning' | 'danger' | 'disaster';

export interface EventDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  severity: EventSeverity;
  /** base chance per in-game year */
  yearlyChance: number;
  minPopulation: number;
  /** duration in days (0 = instant) */
  duration: number;
  /** can be spawned with /summon */
  summonable: boolean;
  seasons?: Season[];
  themes?: ThemeId[];
  disaster?: boolean;
}

export interface ActiveEvent {
  id: number;
  defId: string;
  startDay: number;
  endDay: number;
  x?: number;
  y?: number;
  /** event-specific JSON state */
  data?: Record<string, unknown>;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  hidden?: boolean;
}

// ── Time, weather ───────────────────────────────────────────────────────────
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'heatwave' | 'blizzard';

export interface TimeState {
  /** total in-game days elapsed since founding (fractional) */
  day: number;
  /** visual time of day in hours 0..24 */
  hour: number;
  /** 0..MAX_SPEED_LEVEL; 0 paused */
  speed: number;
}

export interface WeatherState {
  type: WeatherType;
  /** 0..1 intensity */
  intensity: number;
  /** °C */
  temperature: number;
  /** wind direction radians + speed m/s */
  windDir: number;
  windSpeed: number;
  /** 0..1 snow cover on ground */
  snowCover: number;
  /** days until next weather change */
  nextChange: number;
}

// ── Economy & stats ─────────────────────────────────────────────────────────
export type BudgetCategory =
  | 'roads'
  | 'power'
  | 'water'
  | 'garbage'
  | 'health'
  | 'deathcare'
  | 'fire'
  | 'police'
  | 'education'
  | 'parks'
  | 'transit'
  | 'government'
  | 'disaster'
  | 'policies'
  | 'loans';

export interface Loan {
  id: number;
  amount: number;
  /** yearly interest rate, e.g. 0.05 */
  rate: number;
  /** remaining principal */
  remaining: number;
  /** monthly payment */
  payment: number;
  takenDay: number;
}

export interface Economy {
  money: number;
  /** 0..0.29 per category */
  taxes: Record<TaxCategory, number>;
  /** 0.5..1.5 per service category */
  budgets: Record<BudgetCategory, number>;
  loans: Loan[];
  /** running totals for the current month */
  monthIncome: Record<string, number>;
  monthExpense: Record<string, number>;
  /** last closed month */
  lastIncome: Record<string, number>;
  lastExpense: Record<string, number>;
}

export interface CityStats {
  population: number;
  households: number;
  workforce: number;
  jobs: number;
  employed: number;
  unemployed: number;
  students: number;
  tourists: number;
  /** 0..100 */
  happiness: number;
  health: number;
  education: number;
  crimeRate: number;
  landValue: number;
  pollution: number;
  /** -1..1 demand per category */
  demand: Record<ZoneCategory, number>;
  power: { produced: number; consumed: number };
  water: { produced: number; consumed: number };
  sewage: { capacity: number; produced: number };
  garbage: { capacity: number; produced: number; stored: number };
  health_: { capacity: number; sick: number };
  education_: { capacity: number; students: number };
  deathcare: { capacity: number; dead: number };
  /** 0..100 average traffic flow (100 = free flow) */
  trafficFlow: number;
  vehicles: number;
  buildings: number;
  /** $ per month net at current rates */
  netIncome: number;
  /** births/deaths/moves per month */
  births: number;
  deaths: number;
  movedIn: number;
  movedOut: number;
}

export interface HistoryPoint {
  day: number;
  population: number;
  money: number;
  income: number;
  expenses: number;
  happiness: number;
  jobs: number;
  unemployment: number;
  crime: number;
  pollution: number;
  landValue: number;
  trafficFlow: number;
  demandRes: number;
  demandCom: number;
  demandInd: number;
  demandOff: number;
}

// ── Notifications ───────────────────────────────────────────────────────────
export type NoticeKind = 'info' | 'good' | 'warning' | 'danger' | 'chirp' | 'milestone' | 'achievement' | 'event';

export interface Notice {
  id: number;
  day: number;
  kind: NoticeKind;
  title: string;
  text: string;
  icon: string;
  /** chirp author (citizen name) */
  author?: string;
  /** jump target */
  x?: number;
  y?: number;
  buildingId?: number;
  read?: boolean;
}

// ── Districts & transit ─────────────────────────────────────────────────────
export interface District {
  id: number; // 1..255 (0 = none)
  name: string;
  color: string;
  style: StyleId | null; // null = city default
  policies: string[];
  /** specialization e.g. 'tourism', 'leisure', 'hightech', 'selfsufficient', 'organic' */
  specialization?: string;
}

export type TransitMode = 'bus' | 'tram' | 'metro' | 'train' | 'ferry' | 'monorail';

export interface TransitLine {
  id: number;
  mode: TransitMode;
  name: string;
  color: string;
  /** stop cells, in order; line loops back to first */
  stops: Cell[];
  /** vehicles assigned */
  vehicles: number;
  active: boolean;
  /** passengers last month */
  ridership: number;
}

// ── Map settings / generated map ────────────────────────────────────────────
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface MapSettings {
  cityName: string;
  mapSize: MapSizeId;
  theme: ThemeId;
  seed: number;
  style: StyleId;
  difficulty: Difficulty;
  creative: boolean;
  disasters: boolean;
  /** 0..1 terrain relief */
  mountains: number;
  /** 0..1 amount of water (lakes/rivers/sea) */
  water: number;
  /** 0..1 forest coverage */
  forests: number;
  /** leftHand traffic (visual only) */
  leftHandTraffic?: boolean;
}

export interface OutsideConnection {
  kind: 'highway' | 'rail' | 'ship' | 'air';
  /** cell on the map edge (or shore for ship) */
  x: number;
  y: number;
  /** direction pointing out of the map */
  dir: Dir;
}

/** Output of the map generator (transferable typed arrays). */
export interface GeneratedMap {
  size: number;
  /** (size+1)^2 vertex heights in meters */
  heights: Float32Array;
  /** size^2 water surface elevation per cell (<= terrain means dry) */
  water: Float32Array;
  seaLevel: number;
  /** size^2 tree density 0..3 */
  trees: Uint8Array;
  /** size^2 resource fields 0..255 */
  fertility: Uint8Array;
  forest: Uint8Array;
  ore: Uint8Array;
  oil: Uint8Array;
  wind: Uint8Array;
  connections: OutsideConnection[];
  /** cells of the pre-built highway from the edge (in order) */
  highway: Cell[];
  /** pre-built rail line from an edge (may be empty) */
  rail: Cell[];
  /** suggested start camera target cell */
  start: Cell;
}

// ── Layers for change notifications ─────────────────────────────────────────
export enum Layer {
  Terrain = 1 << 0,
  Water = 1 << 1,
  Road = 1 << 2,
  Zone = 1 << 3,
  Building = 1 << 4,
  Tree = 1 << 5,
  District = 1 << 6,
  All = 0x7f,
}

export interface Rect {
  x0: number;
  y0: number;
  /** inclusive */
  x1: number;
  y1: number;
}

// ── Actions ─────────────────────────────────────────────────────────────────
export interface ActionResult {
  ok: boolean;
  /** money spent (negative = refund) */
  cost: number;
  reason?: string;
  /** id of a created building if any */
  id?: number;
}

export interface PlacementCheck {
  ok: boolean;
  cost: number;
  reason?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Dir;
}
