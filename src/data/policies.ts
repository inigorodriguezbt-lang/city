// Policy catalog. Each policy carries data-driven effects that the simulation
// (src/sim/policies.ts) applies to every building in its scope: city-wide
// (world.policies) or per district (world.districts[].policies).
import type { PolicyDef, TaxCategory, ZoneCategory } from '../core/types';

/** Effects of a policy. Multipliers default to 1, additive values to 0. */
export interface PolicyEffect {
  /** happiness points for residents / for workplaces */
  happinessRes?: number;
  happinessWork?: number;
  /** demand deltas (−1..1) */
  demand?: Partial<Record<ZoneCategory, number>>;
  /** tax income multipliers */
  income?: Partial<Record<TaxCategory, number>>;
  /** consumption multipliers */
  garbage?: number;
  power?: number;
  water?: number;
  sewage?: number;
  /** perceived environment multipliers (health, happiness, problems) */
  crime?: number;
  pollution?: number;
  noise?: number;
  /** additive health target points */
  health?: number;
  /** education gain multiplier */
  education?: number;
  /** level-up speed multiplier per category */
  levelRate?: Partial<Record<ZoneCategory, number>>;
  /** level cap for zoned buildings */
  maxLevel?: number;
  /** multiplier on land value needed to level up */
  landValueReq?: number;
  /** fire risk multiplier (read by the event system) */
  fireRisk?: number;
  /** tourism multiplier */
  tourism?: number;
  /** transit fare income multiplier (0 = free transit) */
  transitFare?: number;
  /** efficiency multiplier for parks, plazas and leisure */
  parksEfficiency?: number;
  /** capacity multipliers for services */
  healthCapacity?: number;
  educationCapacity?: number;
  /** blocks lot merging (densification) */
  noDensify?: boolean;
  /** disables the "high rent" problem */
  noHighRent?: boolean;
  /** tax multiplier for buildings younger than one year */
  newBuildingTax?: number;
  /** commercial sales multiplier */
  commerceSales?: number;
  /** industrial output multiplier (generic) */
  industryOutput?: number;
  /** farming income multiplier */
  farmingIncome?: number;
  /** emigration multiplier */
  emigration?: number;
  /** birth rate multiplier */
  birthRate?: number;
}

export interface PolicyInfo extends PolicyDef {
  effects: PolicyEffect;
  /** short human readable effect bullets for the UI */
  details: string[];
  /** flat $ per month on top of costPer1000 */
  flatCost?: number;
}

export const POLICIES: PolicyInfo[] = [
  // ── services ────────────────────────────────────────────────────────────
  {
    id: 'recycling', name: 'Recycling Program', icon: '♻️', category: 'services', costPer1000: 22, unlock: 3, districtLevel: true,
    description: 'Households separate their waste and recycling trucks do the rest.',
    details: ['−20 % garbage produced', '+1 resident happiness'],
    effects: { garbage: 0.8, happinessRes: 1 },
  },
  {
    id: 'smoke_detectors', name: 'Smoke Detector Distribution', icon: '🚨', category: 'services', costPer1000: 12, unlock: 3, districtLevel: true,
    description: 'Free smoke detectors for every home and workplace.',
    details: ['−50 % fire risk'],
    effects: { fireRisk: 0.5 },
  },
  {
    id: 'school_programs', name: 'Extracurricular Programs', icon: '🎨', category: 'services', costPer1000: 28, unlock: 3, districtLevel: true,
    description: 'After-school clubs, tutoring and summer camps.',
    details: ['+35 % education gain', '+1 resident happiness'],
    effects: { education: 1.35, happinessRes: 1 },
  },
  {
    id: 'extended_school_hours', name: 'Extended School Hours', icon: '🕰️', category: 'services', costPer1000: 24, unlock: 4, districtLevel: false,
    description: 'Longer school days let every school take more students.',
    details: ['+20 % school capacity', '−1 resident happiness'],
    effects: { educationCapacity: 1.2, happinessRes: -1 },
  },
  {
    id: 'free_clinics', name: 'Universal Healthcare', icon: '🩺', category: 'services', costPer1000: 38, unlock: 4, districtLevel: false,
    description: 'Free check-ups and treatment for all residents.',
    details: ['+20 % healthcare capacity', '+3 health', '+2 resident happiness'],
    effects: { healthCapacity: 1.2, health: 3, happinessRes: 2 },
  },
  {
    id: 'parks_maintenance', name: 'Parks Maintenance Boost', icon: '🌷', category: 'services', costPer1000: 20, unlock: 3, districtLevel: false,
    description: 'Extra gardeners keep parks immaculate and events running.',
    details: ['+25 % parks & plazas effectiveness', '+1 resident happiness'],
    effects: { parksEfficiency: 1.25, happinessRes: 1 },
  },
  {
    id: 'public_wifi', name: 'Free Public Wi-Fi', icon: '📶', category: 'services', costPer1000: 14, unlock: 4, districtLevel: true,
    description: 'Fast wireless internet in every street and park.',
    details: ['+2 happiness', '+10 % education gain', '+office demand'],
    effects: { happinessRes: 2, happinessWork: 1, education: 1.1, demand: { off: 0.04 } },
  },
  // ── taxation ────────────────────────────────────────────────────────────
  {
    id: 'tax_break_new', name: 'Tax Break for New Buildings', icon: '🧾', category: 'taxation', costPer1000: 0, unlock: 3, districtLevel: false,
    description: 'Buildings pay half taxes during their first year.',
    details: ['−50 % taxes on buildings younger than a year', '+5 % demand for all zones'],
    effects: { newBuildingTax: 0.5, demand: { res: 0.05, com: 0.05, ind: 0.05, off: 0.05 } },
  },
  {
    id: 'carbon_tax', name: 'Carbon Tax', icon: '🏭', category: 'taxation', costPer1000: 0, unlock: 5, districtLevel: false,
    description: 'Industry pays for its emissions and invests in cleaner processes.',
    details: ['+15 % industrial tax income', '−8 % industrial demand', '−10 % perceived pollution', 'Industry modernises faster'],
    effects: { income: { industry: 1.15 }, demand: { ind: -0.08 }, pollution: 0.9, levelRate: { ind: 1.2 } },
  },
  {
    id: 'tourism_promotion', name: 'Tourism Promotion', icon: '🧳', category: 'taxation', costPer1000: 30, unlock: 4, districtLevel: false,
    description: 'Advertising campaigns abroad bring visitors and their wallets.',
    details: ['+30 % tourists', '+commercial demand'],
    effects: { tourism: 1.3, demand: { com: 0.04 } },
  },
  // ── city planning ───────────────────────────────────────────────────────
  {
    id: 'high_rise_ban', name: 'High-Rise Ban', icon: '🚫', category: 'city_planning', costPer1000: 0, unlock: 3, districtLevel: true,
    description: 'Keeps the skyline low: buildings cannot exceed level 3.',
    details: ['Zoned buildings capped at level 3', '+1 resident happiness'],
    effects: { maxLevel: 3, happinessRes: 1 },
  },
  {
    id: 'old_town', name: 'Old Town', icon: '🏰', category: 'city_planning', costPer1000: 0, unlock: 4, districtLevel: true,
    description: 'Protects the historic fabric: no merging of lots and no towers.',
    details: ['Buildings capped at level 3', 'No lot merging', '+10 % tourism', '+2 resident happiness'],
    effects: { maxLevel: 3, noDensify: true, tourism: 1.1, happinessRes: 2 },
  },
  {
    id: 'small_business', name: 'Small Business Enthusiast', icon: '🏪', category: 'city_planning', costPer1000: 0, unlock: 3, districtLevel: true,
    description: 'Favours local shops and family businesses.',
    details: ['+10 % low commercial tax income', '−10 % high commercial tax income', '+commercial demand', '+2 workplace happiness'],
    effects: { income: { comLow: 1.1, comHigh: 0.9 }, demand: { com: 0.06 }, happinessWork: 2 },
  },
  {
    id: 'big_business', name: 'Big Business Benefactor', icon: '🏬', category: 'city_planning', costPer1000: 0, unlock: 5, districtLevel: true,
    description: 'Tax incentives attract chains and department stores.',
    details: ['+10 % high commercial tax income', 'Commerce levels up 30 % faster', '−1 resident happiness'],
    effects: { income: { comHigh: 1.1 }, levelRate: { com: 1.3 }, demand: { com: 0.04 }, happinessRes: -1 },
  },
  {
    id: 'high_tech_housing', name: 'High-Tech Housing', icon: '🏠', category: 'city_planning', costPer1000: 8, unlock: 5, districtLevel: true,
    description: 'Smart, efficient homes that command higher rents.',
    details: ['+12 % residential tax income', '−5 % power use', 'Needs 10 % more land value to level up'],
    effects: { income: { resLow: 1.12, resHigh: 1.12 }, power: 0.95, landValueReq: 1.1 },
  },
  {
    id: 'rent_control', name: 'Rent Control', icon: '🔑', category: 'city_planning', costPer1000: 0, unlock: 4, districtLevel: true,
    description: 'Caps rent increases. Residents are happier, landlords less so.',
    details: ['−10 % residential tax income', '+4 resident happiness', '+residential demand', 'No high-rent problems', 'Homes level up 20 % slower'],
    effects: { income: { resLow: 0.9, resHigh: 0.9 }, happinessRes: 4, demand: { res: 0.06 }, noHighRent: true, levelRate: { res: 0.8 } },
  },
  // ── industry ────────────────────────────────────────────────────────────
  {
    id: 'industrial_space_planning', name: 'Industrial Space Planning', icon: '📐', category: 'industry', costPer1000: 16, unlock: 3, districtLevel: true,
    description: 'Consultants optimise factory layouts and logistics.',
    details: ['Industry levels up 60 % faster', '+5 % industrial output'],
    effects: { levelRate: { ind: 1.6 }, industryOutput: 1.05 },
  },
  {
    id: 'tech_incentives', name: 'High-Tech Incentives', icon: '💻', category: 'industry', costPer1000: 18, unlock: 4, districtLevel: true,
    description: 'Tax credits for research labs and tech companies.',
    details: ['+15 % office demand', 'Offices level up 30 % faster', '−10 % office tax income'],
    effects: { demand: { off: 0.15 }, levelRate: { off: 1.3 }, income: { office: 0.9 } },
  },
  {
    id: 'organic_farming', name: 'Organic Farming', icon: '🥕', category: 'industry', costPer1000: 10, unlock: 3, districtLevel: true,
    description: 'Pesticide-free farming earns premium prices.',
    details: ['+20 % farming income', '−5 % perceived pollution', '+1 health'],
    effects: { farmingIncome: 1.2, pollution: 0.95, health: 1 },
  },
  {
    id: 'industrial_filters', name: 'Industrial Emission Filters', icon: '🧯', category: 'industry', costPer1000: 18, unlock: 5, districtLevel: true,
    description: 'Mandatory scrubbers and filters on every chimney.',
    details: ['−20 % perceived pollution', '−8 % industrial tax income'],
    effects: { pollution: 0.8, income: { industry: 0.92 } },
  },
  // ── environment ─────────────────────────────────────────────────────────
  {
    id: 'energy_saving', name: 'Power Saving Campaign', icon: '💡', category: 'environment', costPer1000: 12, unlock: 3, districtLevel: true,
    description: 'LED bulbs, insulation grants and smart meters.',
    details: ['−15 % power use', '−1 resident happiness'],
    effects: { power: 0.85, happinessRes: -1 },
  },
  {
    id: 'water_saving', name: 'Water Conservation', icon: '🚿', category: 'environment', costPer1000: 12, unlock: 3, districtLevel: true,
    description: 'Low-flow fixtures and rainwater harvesting.',
    details: ['−15 % water use', '−15 % sewage'],
    effects: { water: 0.85, sewage: 0.85 },
  },
  {
    id: 'solar_subsidies', name: 'Rooftop Solar Subsidies', icon: '☀️', category: 'environment', costPer1000: 30, unlock: 4, districtLevel: true,
    description: 'Subsidised solar panels on homes and businesses.',
    details: ['−12 % power use', '+1 resident happiness'],
    effects: { power: 0.88, happinessRes: 1 },
  },
  {
    id: 'green_roofs', name: 'Green Roofs Initiative', icon: '🌿', category: 'environment', costPer1000: 26, unlock: 5, districtLevel: true,
    description: 'Planted roofs cool the city and clean the air.',
    details: ['−10 % perceived pollution', '−5 % power and water use', '+3 resident happiness'],
    effects: { pollution: 0.9, power: 0.95, water: 0.95, happinessRes: 3 },
  },
  {
    id: 'noise_restrictions', name: 'Nightlife Noise Restrictions', icon: '🔇', category: 'environment', costPer1000: 5, unlock: 3, districtLevel: true,
    description: 'Quiet hours after 10 pm. Bars close early.',
    details: ['−30 % perceived noise', '−8 % commercial sales', '+2 resident happiness'],
    effects: { noise: 0.7, commerceSales: 0.92, happinessRes: 2 },
  },
  // ── traffic ─────────────────────────────────────────────────────────────
  {
    id: 'free_transit', name: 'Free Public Transport', icon: '🎫', category: 'traffic', costPer1000: 26, unlock: 3, districtLevel: false,
    description: 'All buses, trams and trains are free to ride.',
    details: ['No fare income', '+3 resident happiness', 'More transit riders'],
    effects: { transitFare: 0, happinessRes: 3, demand: { res: 0.02 } },
  },
  {
    id: 'bus_priority', name: 'Bus Priority Lanes', icon: '🚌', category: 'traffic', costPer1000: 8, unlock: 3, districtLevel: false,
    description: 'Dedicated lanes and signal priority speed up buses and trams.',
    details: ['+15 % transit fare income', '+1 resident happiness'],
    effects: { transitFare: 1.15, happinessRes: 1 },
  },
  {
    id: 'heavy_traffic_ban', name: 'Heavy Traffic Ban', icon: '🚛', category: 'traffic', costPer1000: 0, unlock: 3, districtLevel: true,
    description: 'Trucks may not cross the district. Quieter streets, slower deliveries.',
    details: ['−25 % perceived noise', '−10 % industrial tax income', '+2 resident happiness'],
    effects: { noise: 0.75, income: { industry: 0.9 }, happinessRes: 2 },
  },
  {
    id: 'encourage_biking', name: 'Encourage Biking', icon: '🚲', category: 'traffic', costPer1000: 10, unlock: 3, districtLevel: true,
    description: 'Bike lanes, racks and a city-wide bike share.',
    details: ['+4 health', '+1 resident happiness', '−5 % perceived noise'],
    effects: { health: 4, happinessRes: 1, noise: 0.95 },
  },
  // ── social ──────────────────────────────────────────────────────────────
  {
    id: 'neighborhood_watch', name: 'Neighbourhood Watch', icon: '👀', category: 'social', costPer1000: 12, unlock: 3, districtLevel: true,
    description: 'Residents look out for each other.',
    details: ['−15 % crime', '+1 resident happiness'],
    effects: { crime: 0.85, happinessRes: 1 },
  },
  {
    id: 'curfew', name: 'Teen Curfew', icon: '🌙', category: 'social', costPer1000: 5, unlock: 3, districtLevel: true,
    description: 'Minors must be home by 10 pm.',
    details: ['−20 % crime', '−10 % commercial sales', '−3 resident happiness'],
    effects: { crime: 0.8, commerceSales: 0.9, happinessRes: -3 },
  },
  {
    id: 'pet_ban', name: 'Pet Ban', icon: '🐕', category: 'social', costPer1000: 0, unlock: 3, districtLevel: true,
    description: 'No pets allowed. Cleaner parks, sadder people.',
    details: ['−5 % garbage', '+2 health', '−4 resident happiness'],
    effects: { garbage: 0.95, health: 2, happinessRes: -4 },
  },
  {
    id: 'smoking_ban', name: 'Smoking Ban', icon: '🚭', category: 'social', costPer1000: 0, unlock: 3, districtLevel: true,
    description: 'No smoking in public places.',
    details: ['+4 health', '−2 resident happiness', '−3 % commercial sales'],
    effects: { health: 4, happinessRes: -2, commerceSales: 0.97 },
  },
  {
    id: 'recreational_use', name: 'Legalised Recreational Use', icon: '🍃', category: 'social', costPer1000: 0, unlock: 5, districtLevel: true,
    description: 'Regulated and taxed. Popular with residents and tourists alike.',
    details: ['+10 % commercial tax income', '+10 % tourism', '+4 resident happiness', '+10 % crime', '−2 health'],
    effects: { income: { comLow: 1.1, comHigh: 1.1 }, tourism: 1.1, happinessRes: 4, crime: 1.1, health: -2 },
  },
  {
    id: 'immigration_outreach', name: 'Immigration Outreach', icon: '🌍', category: 'social', costPer1000: 10, unlock: 3, districtLevel: false,
    description: 'Welcome centres and campaigns invite newcomers to settle here.',
    details: ['+10 % residential demand', 'Newcomers move in faster'],
    effects: { demand: { res: 0.1 } },
  },
  {
    id: 'basic_income', name: 'Universal Basic Income', icon: '💶', category: 'social', costPer1000: 110, unlock: 7, districtLevel: false,
    description: 'Every resident receives a monthly stipend.',
    details: ['+7 resident happiness', '−20 % crime', '−40 % emigration', '+10 % commercial sales', 'Very expensive'],
    effects: { happinessRes: 7, crime: 0.8, emigration: 0.6, commerceSales: 1.1, demand: { res: 0.05, com: 0.05 } },
  },
  {
    id: 'family_support', name: 'Family Support Program', icon: '👶', category: 'social', costPer1000: 20, unlock: 4, districtLevel: false,
    description: 'Parental leave, childcare and child benefits.',
    details: ['+40 % birth rate', '+2 resident happiness'],
    effects: { birthRate: 1.4, happinessRes: 2 },
  },
];

const byId = new Map<string, PolicyInfo>();
for (const p of POLICIES) byId.set(p.id, p);

export function policyDef(id: string): PolicyInfo | undefined {
  return byId.get(id);
}

export const POLICY_CATEGORY_NAMES: Record<PolicyDef['category'], string> = {
  services: 'Services',
  taxation: 'Taxation & Tourism',
  city_planning: 'City Planning',
  industry: 'Industry',
  environment: 'Environment',
  traffic: 'Traffic',
  social: 'Social',
};
