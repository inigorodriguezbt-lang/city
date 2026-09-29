// Achievement catalog. Each entry is checked monthly (and on milestones) by
// src/sim/achievements.ts against a read-only snapshot of the city. Achievements
// are disabled for cities where cheats were used (world.ext.cheated).
import type { AchievementDef } from '../core/types';

/** Read-only city snapshot the checks run against (built by the simulation). */
export interface AchievementSnapshot {
  population: number;
  maxPopulation: number;
  milestone: number;
  /** full in-game years / months played */
  years: number;
  months: number;
  money: number;
  /** net income of the last closed month */
  netIncome: number;
  /** gross income of the last closed month */
  income: number;
  profitStreak: number;
  loans: number;
  loansTaken: number;
  loansRepaid: number;
  maxLoans: number;
  /** lowest money ever when later recovered above 100k (0 if never) */
  comeback: number;
  minMoney: number;
  /** 0..100 */
  happiness: number;
  health: number;
  education: number;
  crimeRate: number;
  pollution: number;
  landValue: number;
  trafficFlow: number;
  /** 0..1 */
  unemployment: number;
  buildings: number;
  zoned: number;
  services: number;
  level5: number;
  highDensity: number;
  abandoned: number;
  abandonedEver: number;
  recovered: number;
  levelUps: number;
  spawned: number;
  densified: number;
  /** zoned buildings per zone id (e.g. 'res_low', 'farming') */
  byZone: Record<string, number>;
  /** service buildings per category */
  byCategory: Record<string, number>;
  /** service buildings per catalog id */
  byDef: Record<string, number>;
  parks: number;
  landmarks: number;
  monuments: number;
  transitLines: number;
  transitModes: number;
  /** passengers last month over all lines */
  ridership: number;
  policies: number;
  districts: number;
  styles: number;
  tourists: number;
  /** $ of exports last month */
  exports: number;
  /** 0..1 share of nominal power from renewables */
  renewableShare: number;
  powerProduced: number;
  waterProduced: number;
  /** 0..1 share of zoned buildings covered by every unlocked key service */
  coverageAll: number;
  students: number;
  disasters: number;
  happyStreak: number;
  cleanStreak: number;
  employStreak: number;
  totalBirths: number;
  chirps: number;
  /** lowest / highest tax rate and average budget slider */
  minTax: number;
  maxTax: number;
  avgBudget: number;
  roadCells: number;
  bridgeCells: number;
  difficulty: string;
  creative: boolean;
}

export interface AchievementInfo extends AchievementDef {
  category: 'population' | 'economy' | 'environment' | 'wellbeing' | 'services' | 'transport' | 'growth' | 'industry' | 'planning' | 'time' | 'fun';
  check: (s: AchievementSnapshot) => boolean;
  /** optional 0..1 progress for the UI */
  progress?: (s: AchievementSnapshot) => number;
}

const ratio = (v: number, target: number): number => Math.max(0, Math.min(1, v / target));

function pop(id: string, name: string, n: number, icon: string, description: string): AchievementInfo {
  return { id, name, icon, description, category: 'population', check: (s) => s.population >= n, progress: (s) => ratio(s.population, n) };
}

export const ACHIEVEMENTS: AchievementInfo[] = [
  // ── population ──────────────────────────────────────────────────────────
  pop('first_residents', 'Home Sweet Home', 1, '🏡', 'Welcome your very first residents.'),
  pop('pop_500', 'Neighbours', 500, '👋', 'Reach a population of 500.'),
  pop('pop_2k', 'Village People', 2_000, '🏘️', 'Reach a population of 2,000.'),
  pop('pop_10k', 'On the Map', 10_000, '🗺️', 'Reach a population of 10,000.'),
  pop('pop_25k', 'Boomtown', 25_000, '📈', 'Reach a population of 25,000.'),
  pop('pop_50k', 'City Slicker', 50_000, '🏙️', 'Reach a population of 50,000.'),
  pop('pop_100k', 'Six Figures', 100_000, '🌆', 'Reach a population of 100,000.'),
  pop('pop_250k', 'Quarter Million', 250_000, '🌃', 'Reach a population of 250,000.'),
  pop('pop_500k', 'Half a Million Stories', 500_000, '🌇', 'Reach a population of 500,000.'),
  pop('pop_1m', 'Ecumenopolis', 1_000_000, '🪐', 'Reach a population of one million.'),
  {
    id: 'milestone_5', name: 'Growing Up', icon: '🎖️', category: 'population', description: 'Reach the Large Town milestone.',
    check: (s) => s.milestone >= 5, progress: (s) => ratio(s.milestone, 5),
  },
  {
    id: 'milestone_10', name: 'Capital Ambitions', icon: '🏛️', category: 'population', description: 'Reach the Capital milestone.',
    check: (s) => s.milestone >= 10, progress: (s) => ratio(s.milestone, 10),
  },
  {
    id: 'baby_boom', name: 'Baby Boom', icon: '👶', category: 'population', description: 'Celebrate 10,000 births in your city.',
    check: (s) => s.totalBirths >= 10_000, progress: (s) => ratio(s.totalBirths, 10_000),
  },
  // ── economy ─────────────────────────────────────────────────────────────
  {
    id: 'money_1m', name: 'Millionaire Mayor', icon: '💰', category: 'economy', description: 'Have $1,000,000 in the treasury.',
    check: (s) => s.money >= 1_000_000, progress: (s) => ratio(s.money, 1_000_000),
  },
  {
    id: 'money_10m', name: 'Deep Pockets', icon: '💎', category: 'economy', description: 'Have $10,000,000 in the treasury.',
    check: (s) => s.money >= 10_000_000, progress: (s) => ratio(s.money, 10_000_000),
  },
  {
    id: 'money_100m', name: 'Scrooge', icon: '🏦', category: 'economy', description: 'Have $100,000,000 in the treasury.',
    check: (s) => s.money >= 100_000_000, progress: (s) => ratio(s.money, 100_000_000),
  },
  {
    id: 'income_10k', name: 'In the Black', icon: '📊', category: 'economy', description: 'Earn a net profit of $10,000 in a month.',
    check: (s) => s.netIncome >= 10_000, progress: (s) => ratio(s.netIncome, 10_000),
  },
  {
    id: 'income_100k', name: 'Economic Powerhouse', icon: '💹', category: 'economy', description: 'Earn a net profit of $100,000 in a month.',
    check: (s) => s.netIncome >= 100_000, progress: (s) => ratio(s.netIncome, 100_000),
  },
  {
    id: 'profit_streak', name: 'Steady Hand', icon: '🧮', category: 'economy', description: 'Stay profitable for 24 months in a row.',
    check: (s) => s.profitStreak >= 24, progress: (s) => ratio(s.profitStreak, 24),
  },
  {
    id: 'debt_free', name: 'Debt Free', icon: '🧾', category: 'economy', description: 'Pay off a loan in full.',
    check: (s) => s.loansRepaid >= 1,
  },
  {
    id: 'loan_juggler', name: 'Creative Accounting', icon: '🤹', category: 'economy', description: 'Hold three loans at the same time.',
    check: (s) => s.maxLoans >= 3, progress: (s) => ratio(s.maxLoans, 3),
  },
  {
    id: 'comeback', name: 'Comeback Kid', icon: '🔄', category: 'economy', description: 'Climb out of $25,000 of debt to a treasury of $100,000.',
    check: (s) => s.comeback <= -25_000,
  },
  {
    id: 'tax_haven', name: 'Tax Haven', icon: '🏝️', category: 'economy', description: 'Run a city of 20,000 with every tax rate at 6 % or less.',
    check: (s) => s.population >= 20_000 && s.maxTax <= 0.06 + 1e-6,
  },
  {
    id: 'taxman', name: 'The Taxman', icon: '🤑', category: 'economy', description: 'Keep every tax at 18 % or more while happiness stays above 60 (10,000 citizens).',
    check: (s) => s.population >= 10_000 && s.minTax >= 0.18 - 1e-6 && s.happiness >= 60,
  },
  {
    id: 'frugal', name: 'Penny Pincher', icon: '🪙', category: 'economy', description: 'Run a city of 15,000 with average service budgets at 75 % or less.',
    check: (s) => s.population >= 15_000 && s.avgBudget <= 0.75 + 1e-6,
  },
  // ── environment ─────────────────────────────────────────────────────────
  {
    id: 'clean_city', name: 'Clean Air Act', icon: '🌬️', category: 'environment', description: 'Keep pollution below 6 % for a whole year with 5,000+ citizens.',
    check: (s) => s.cleanStreak >= 12, progress: (s) => ratio(s.cleanStreak, 12),
  },
  {
    id: 'green_grid', name: 'Green Grid', icon: '🔋', category: 'environment', description: 'Produce 90 % of 100+ MW of power from renewables.',
    check: (s) => s.powerProduced >= 100 && s.renewableShare >= 0.9,
  },
  {
    id: 'carbon_neutral', name: 'Carbon Neutral', icon: '🌍', category: 'environment', description: 'Power a city of 50,000 entirely with renewables.',
    check: (s) => s.population >= 50_000 && s.renewableShare >= 0.999,
  },
  {
    id: 'parks_10', name: 'Weekend Picnic', icon: '🧺', category: 'environment', description: 'Build 10 parks and plazas.',
    check: (s) => s.parks >= 10, progress: (s) => ratio(s.parks, 10),
  },
  {
    id: 'parks_100', name: 'Garden City', icon: '🌳', category: 'environment', description: 'Build 100 parks and plazas.',
    check: (s) => s.parks >= 100, progress: (s) => ratio(s.parks, 100),
  },
  // ── wellbeing ───────────────────────────────────────────────────────────
  {
    id: 'happy_90', name: 'Paradise Found', icon: '😊', category: 'wellbeing', description: 'Reach 90 % happiness with 5,000+ citizens.',
    check: (s) => s.population >= 5_000 && s.happiness >= 90,
  },
  {
    id: 'happy_streak', name: 'Good Times', icon: '🎉', category: 'wellbeing', description: 'Keep happiness at 85 % or more for 12 months in a row.',
    check: (s) => s.happyStreak >= 12, progress: (s) => ratio(s.happyStreak, 12),
  },
  {
    id: 'healthy', name: 'An Apple a Day', icon: '🍎', category: 'wellbeing', description: 'Reach an average health of 85 % with 10,000+ citizens.',
    check: (s) => s.population >= 10_000 && s.health >= 85,
  },
  {
    id: 'educated', name: 'City of Scholars', icon: '🎓', category: 'wellbeing', description: 'Reach an average education of 70 % with 20,000+ citizens.',
    check: (s) => s.population >= 20_000 && s.education >= 70,
  },
  {
    id: 'safe', name: 'Safe Streets', icon: '🛡️', category: 'wellbeing', description: 'Keep crime below 5 % in a city of 20,000.',
    check: (s) => s.population >= 20_000 && s.crimeRate < 5,
  },
  {
    id: 'land_value', name: 'Prime Real Estate', icon: '🏰', category: 'wellbeing', description: 'Raise the average land value to 60 %.',
    check: (s) => s.population >= 2_000 && s.landValue >= 60, progress: (s) => ratio(s.landValue, 60),
  },
  {
    id: 'full_employment', name: 'Full Employment', icon: '💼', category: 'wellbeing', description: 'Keep unemployment below 5 % for 12 months (2,000+ citizens).',
    check: (s) => s.employStreak >= 12, progress: (s) => ratio(s.employStreak, 12),
  },
  {
    id: 'students_10k', name: 'Back to School', icon: '📚', category: 'wellbeing', description: 'Have 10,000 students enrolled at once.',
    check: (s) => s.students >= 10_000, progress: (s) => ratio(s.students, 10_000),
  },
  // ── services ────────────────────────────────────────────────────────────
  {
    id: 'all_services', name: 'Full Coverage', icon: '🧩', category: 'services', description: 'Cover 90 % of buildings with every unlocked service (5,000+ citizens).',
    check: (s) => s.population >= 5_000 && s.coverageAll >= 0.9, progress: (s) => ratio(s.coverageAll, 0.9),
  },
  {
    id: 'health_10', name: 'Health Network', icon: '🏥', category: 'services', description: 'Operate 10 healthcare buildings.',
    check: (s) => (s.byCategory.health ?? 0) >= 10, progress: (s) => ratio(s.byCategory.health ?? 0, 10),
  },
  {
    id: 'fire_10', name: 'Hot Stuff', icon: '🚒', category: 'services', description: 'Operate 10 fire department buildings.',
    check: (s) => (s.byCategory.fire ?? 0) >= 10, progress: (s) => ratio(s.byCategory.fire ?? 0, 10),
  },
  {
    id: 'police_10', name: 'Law & Order', icon: '🚓', category: 'services', description: 'Operate 10 police buildings.',
    check: (s) => (s.byCategory.police ?? 0) >= 10, progress: (s) => ratio(s.byCategory.police ?? 0, 10),
  },
  {
    id: 'schools_20', name: 'Education Nation', icon: '🏫', category: 'services', description: 'Operate 20 education buildings.',
    check: (s) => (s.byCategory.education ?? 0) >= 20, progress: (s) => ratio(s.byCategory.education ?? 0, 20),
  },
  {
    id: 'university', name: 'Alma Mater', icon: '🎓', category: 'services', description: 'Open a university.',
    check: (s) => (s.byDef.university ?? 0) >= 1,
  },
  {
    id: 'first_landmark', name: 'Postcard Worthy', icon: '🗽', category: 'services', description: 'Build your first landmark.',
    check: (s) => s.landmarks >= 1,
  },
  {
    id: 'landmarks_5', name: 'Tourist Magnet', icon: '📸', category: 'services', description: 'Build 5 landmarks.',
    check: (s) => s.landmarks >= 5, progress: (s) => ratio(s.landmarks, 5),
  },
  {
    id: 'first_monument', name: 'Wonder of the World', icon: '🏆', category: 'services', description: 'Complete a monument.',
    check: (s) => s.monuments >= 1,
  },
  {
    id: 'monuments_3', name: 'Seven Wonders (Well, Three)', icon: '👑', category: 'services', description: 'Complete 3 monuments.',
    check: (s) => s.monuments >= 3, progress: (s) => ratio(s.monuments, 3),
  },
  // ── transport ───────────────────────────────────────────────────────────
  {
    id: 'first_line', name: 'All Aboard', icon: '🚌', category: 'transport', description: 'Open your first public transport line.',
    check: (s) => s.transitLines >= 1,
  },
  {
    id: 'lines_10', name: 'Transit Tycoon', icon: '🚇', category: 'transport', description: 'Run 10 public transport lines.',
    check: (s) => s.transitLines >= 10, progress: (s) => ratio(s.transitLines, 10),
  },
  {
    id: 'multimodal', name: 'Multimodal', icon: '🚋', category: 'transport', description: 'Run lines of 4 different transport modes.',
    check: (s) => s.transitModes >= 4, progress: (s) => ratio(s.transitModes, 4),
  },
  {
    id: 'ridership_100k', name: 'Rush Hour', icon: '🎫', category: 'transport', description: 'Carry 100,000 passengers in a month.',
    check: (s) => s.ridership >= 100_000, progress: (s) => ratio(s.ridership, 100_000),
  },
  {
    id: 'zero_jams', name: 'Zero Traffic Jams', icon: '🟢', category: 'transport', description: 'Keep traffic flowing above 90 % with 20,000+ citizens.',
    check: (s) => s.population >= 20_000 && s.trafficFlow >= 90,
  },
  {
    id: 'smooth_operator', name: 'Smooth Operator', icon: '🛣️', category: 'transport', description: 'Keep traffic flowing above 80 % with 100,000+ citizens.',
    check: (s) => s.population >= 100_000 && s.trafficFlow >= 80,
  },
  {
    id: 'bridges_50', name: 'Bridge Builder', icon: '🌉', category: 'transport', description: 'Build 50 cells of bridges.',
    check: (s) => s.bridgeCells >= 50, progress: (s) => ratio(s.bridgeCells, 50),
  },
  {
    id: 'roads_5000', name: 'All Roads Lead Here', icon: '🛤️', category: 'transport', description: 'Build 5,000 road cells.',
    check: (s) => s.roadCells >= 5_000, progress: (s) => ratio(s.roadCells, 5_000),
  },
  // ── growth ──────────────────────────────────────────────────────────────
  {
    id: 'skyline', name: 'Skyline', icon: '🏢', category: 'growth', description: 'Have 50 level-5 buildings.',
    check: (s) => s.level5 >= 50, progress: (s) => ratio(s.level5, 50),
  },
  {
    id: 'skyline_500', name: 'Concrete Jungle', icon: '🌆', category: 'growth', description: 'Have 500 level-5 buildings.',
    check: (s) => s.level5 >= 500, progress: (s) => ratio(s.level5, 500),
  },
  {
    id: 'high_density', name: 'Going Up', icon: '🏗️', category: 'growth', description: 'Have 100 high-density buildings.',
    check: (s) => s.highDensity >= 100, progress: (s) => ratio(s.highDensity, 100),
  },
  {
    id: 'densified', name: 'Urban Renewal', icon: '🧱', category: 'growth', description: 'See 25 small lots merge into bigger buildings.',
    check: (s) => s.densified >= 25, progress: (s) => ratio(s.densified, 25),
  },
  {
    id: 'nobody_left', name: 'Nobody Left Behind', icon: '🤝', category: 'growth', description: 'Reach 50,000 citizens with no abandoned buildings.',
    check: (s) => s.population >= 50_000 && s.abandoned === 0,
  },
  {
    id: 'phoenix', name: 'Phoenix', icon: '🐦‍🔥', category: 'growth', description: 'Bring 10 abandoned buildings back to life.',
    check: (s) => s.recovered >= 10, progress: (s) => ratio(s.recovered, 10),
  },
  // ── industry & tourism ──────────────────────────────────────────────────
  {
    id: 'farmer', name: 'Breadbasket', icon: '🌾', category: 'industry', description: 'Have 20 farming buildings.',
    check: (s) => (s.byZone.farming ?? 0) >= 20, progress: (s) => ratio(s.byZone.farming ?? 0, 20),
  },
  {
    id: 'lumberjack', name: 'I\'m a Lumberjack', icon: '🪓', category: 'industry', description: 'Have 20 forestry buildings.',
    check: (s) => (s.byZone.forestry ?? 0) >= 20, progress: (s) => ratio(s.byZone.forestry ?? 0, 20),
  },
  {
    id: 'miner', name: 'Dig Deep', icon: '⛏️', category: 'industry', description: 'Have 20 mining buildings.',
    check: (s) => (s.byZone.mining ?? 0) >= 20, progress: (s) => ratio(s.byZone.mining ?? 0, 20),
  },
  {
    id: 'oil_baron', name: 'Oil Baron', icon: '🛢️', category: 'industry', description: 'Have 20 oil buildings.',
    check: (s) => (s.byZone.oil ?? 0) >= 20, progress: (s) => ratio(s.byZone.oil ?? 0, 20),
  },
  {
    id: 'exporter', name: 'Made Here', icon: '📦', category: 'industry', description: 'Earn $20,000 from exports in a month.',
    check: (s) => s.exports >= 20_000, progress: (s) => ratio(s.exports, 20_000),
  },
  {
    id: 'tourists_10k', name: 'Wish You Were Here', icon: '🧳', category: 'industry', description: 'Welcome 10,000 tourists in a month.',
    check: (s) => s.tourists >= 10_000, progress: (s) => ratio(s.tourists, 10_000),
  },
  {
    id: 'tourists_100k', name: 'Bucket List Destination', icon: '✈️', category: 'industry', description: 'Welcome 100,000 tourists in a month.',
    check: (s) => s.tourists >= 100_000, progress: (s) => ratio(s.tourists, 100_000),
  },
  // ── planning ────────────────────────────────────────────────────────────
  {
    id: 'policy_wonk', name: 'Policy Wonk', icon: '📜', category: 'planning', description: 'Have 10 policies active at once.',
    check: (s) => s.policies >= 10, progress: (s) => ratio(s.policies, 10),
  },
  {
    id: 'districts_5', name: 'Neighbourhood Watcher', icon: '🗺️', category: 'planning', description: 'Create 5 districts.',
    check: (s) => s.districts >= 5, progress: (s) => ratio(s.districts, 5),
  },
  {
    id: 'styles_4', name: 'Eclectic', icon: '🎨', category: 'planning', description: 'Have buildings of 4 different architectural styles.',
    check: (s) => s.styles >= 4, progress: (s) => ratio(s.styles, 4),
  },
  {
    id: 'styles_8', name: 'Architectural Zoo', icon: '🏛️', category: 'planning', description: 'Have buildings of all 8 architectural styles.',
    check: (s) => s.styles >= 8, progress: (s) => ratio(s.styles, 8),
  },
  {
    id: 'expert_10k', name: 'Against the Odds', icon: '🧗', category: 'planning', description: 'Reach 10,000 citizens on Expert difficulty.',
    check: (s) => s.difficulty === 'expert' && s.population >= 10_000,
  },
  // ── time & disasters ────────────────────────────────────────────────────
  {
    id: 'years_10', name: 'A Decade in Office', icon: '📅', category: 'time', description: 'Run your city for 10 years.',
    check: (s) => s.years >= 10, progress: (s) => ratio(s.years, 10),
  },
  {
    id: 'years_50', name: 'Half a Century', icon: '🕰️', category: 'time', description: 'Run your city for 50 years.',
    check: (s) => s.years >= 50, progress: (s) => ratio(s.years, 50),
  },
  {
    id: 'years_100', name: 'Centennial', icon: '🎂', category: 'time', description: 'Run your city for 100 years.',
    check: (s) => s.years >= 100, progress: (s) => ratio(s.years, 100),
  },
  {
    id: 'survivor', name: 'Survivor', icon: '🌪️', category: 'time', description: 'Weather your first disaster with 1,000+ citizens.',
    check: (s) => s.disasters >= 1 && s.population >= 1_000,
  },
  {
    id: 'disaster_veteran', name: 'Disaster Veteran', icon: '🧯', category: 'time', description: 'Live through 10 disasters.',
    check: (s) => s.disasters >= 10, progress: (s) => ratio(s.disasters, 10),
  },
  // ── fun & hidden ────────────────────────────────────────────────────────
  {
    id: 'chatterbox', name: 'Trending', icon: '🐦', category: 'fun', description: 'Your citizens have posted 500 chirps.',
    check: (s) => s.chirps >= 500, progress: (s) => ratio(s.chirps, 500),
  },
  {
    id: 'ghost_town', name: 'Ghost Town', icon: '👻', category: 'fun', hidden: true, description: 'Have 100 abandoned buildings at once. Oops.',
    check: (s) => s.abandoned >= 100,
  },
  {
    id: 'in_the_red', name: 'In the Red', icon: '📉', category: 'fun', hidden: true, description: 'Let the treasury sink below −$100,000.',
    check: (s) => s.minMoney <= -100_000,
  },
  {
    id: 'mayor_for_life', name: 'Mayor for Life', icon: '🎩', category: 'fun', hidden: true, description: 'Keep happiness above 75 % after 25 years in office.',
    check: (s) => s.years >= 25 && s.happiness >= 75 && s.population >= 1_000,
  },
];

const byId = new Map<string, AchievementInfo>();
for (const a of ACHIEVEMENTS) byId.set(a.id, a);

export function achievementDef(id: string): AchievementInfo | undefined {
  return byId.get(id);
}

export const ACHIEVEMENT_CATEGORY_NAMES: Record<AchievementInfo['category'], string> = {
  population: 'Population',
  economy: 'Economy',
  environment: 'Environment',
  wellbeing: 'Wellbeing',
  services: 'Services',
  transport: 'Transport',
  growth: 'Growth',
  industry: 'Industry & Tourism',
  planning: 'Planning',
  time: 'Time & Disasters',
  fun: 'Fun',
};
