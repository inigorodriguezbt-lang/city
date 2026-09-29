// ─────────────────────────────────────────────────────────────────────────────
// Service, landmark & monument catalog. Owned by the "buildings-service" agent.
//
// Balance notes (see src/sim/consumption.ts):
//  • A low-density house draws ≈0.03–0.08 MW and ≈0.2–0.5 m³/day of water.
//    Counting their homes only, a 40 MW coal plant keeps ≈6–8k residents lit,
//    and a 600 m³/day pumping station keeps roughly the same number watered.
//  • Services cost 1.5k–12k early, 15k–90k mid-game, landmarks 100k–600k,
//    monuments 1M–6M. Monthly upkeep ≈3–6 % of the build cost.
//  • Coverage radii are in cells of road distance (≈10–40); amounts are on the
//    0..255 field scale at the building's access cells.
//  • `unlock` indexes src/data/milestones.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { BuildingCategory, BuildingDef, FieldEffect, FieldId } from '../core/types';

const fx = (field: FieldId, radius: number, amount: number): FieldEffect => ({ field, radius, amount });

export const BUILDINGS: BuildingDef[] = [
  // ══ ELECTRICITY ═══════════════════════════════════════════════════════════
  {
    id: 'wind_turbine', name: 'Wind Turbine', icon: '🌬️', category: 'power', group: 'Renewable',
    description: 'A slender three-bladed turbine. Clean and cheap, but its output rises and falls with the local wind — check the Wind info view before you build.',
    w: 1, h: 1, cost: 2_700, upkeep: 90, unlock: 0, model: 'wind_turbine', height: 62, power: 8, jobs: 1,
    effects: [fx('noise', 4, 60)], tags: ['renewable', 'clean', 'green', 'wind', 'electricity'],
  },
  {
    id: 'wind_turbine_adv', name: 'Advanced Wind Turbine', icon: '🌀', category: 'power', group: 'Renewable',
    description: 'A towering multi-megawatt turbine with 60 m blades that harvests the steadier winds high above the ground.',
    w: 2, h: 2, cost: 9_800, upkeep: 380, unlock: 7, model: 'wind_turbine_adv', height: 125, power: 24, jobs: 2,
    effects: [fx('noise', 6, 80)], tags: ['renewable', 'clean', 'wind', 'electricity'],
  },
  {
    id: 'offshore_wind', name: 'Offshore Wind Farm', icon: '🌊', category: 'power', group: 'Renewable',
    description: 'A cluster of giant turbines on monopile foundations. The sea wind never sleeps — place it on open water.',
    w: 3, h: 3, cost: 42_000, upkeep: 1_700, unlock: 8, model: 'offshore_wind', height: 140, power: 100, jobs: 6,
    placement: { onWater: true, road: false }, tags: ['renewable', 'clean', 'wind', 'sea', 'water', 'electricity'],
  },
  {
    id: 'solar_farm', name: 'Solar Farm', icon: '☀️', category: 'power', group: 'Renewable',
    description: 'Rows of tilted photovoltaic panels. Silent and pollution-free, strongest in summer and useless at night.',
    w: 3, h: 3, cost: 11_500, upkeep: 460, unlock: 3, model: 'solar_farm', height: 4, power: 18, jobs: 2,
    tags: ['renewable', 'clean', 'solar', 'pv', 'electricity'],
  },
  {
    id: 'solar_tower_plant', name: 'Solar Power Tower', icon: '🔆', category: 'power', group: 'Renewable',
    description: 'Thousands of sun-tracking mirrors focus daylight on a molten-salt receiver atop a 110 m tower. Stored heat keeps it running into the evening.',
    w: 5, h: 5, cost: 78_000, upkeep: 3_100, unlock: 7, model: 'solar_tower_plant', height: 112, power: 130, jobs: 18,
    tags: ['renewable', 'clean', 'solar', 'csp', 'heliostat', 'electricity'],
  },
  {
    id: 'solar_updraft', name: 'Solar Updraft Tower', icon: '🌡️', category: 'power', group: 'Renewable',
    description: 'A vast glass greenhouse heats air that rushes up a 400 m chimney through wind turbines. Visible from anywhere on the map.',
    w: 6, h: 6, cost: 260_000, upkeep: 8_400, unlock: 8, model: 'solar_updraft', height: 400, power: 220, jobs: 12,
    effects: [fx('tourism', 16, 50)], tags: ['renewable', 'clean', 'solar', 'chimney', 'electricity'],
  },
  {
    id: 'hydro_dam', name: 'Hydroelectric Dam', icon: '🌉', category: 'power', group: 'Renewable',
    description: 'A curved concrete dam that turns falling river water into huge amounts of clean power. Must be built across flowing water.',
    w: 5, h: 2, cost: 125_000, upkeep: 3_800, unlock: 7, model: 'hydro_dam', height: 42, power: 320, jobs: 24,
    placement: { onWater: true, road: true, maxSlope: 0.8 }, effects: [fx('tourism', 12, 40)], tags: ['renewable', 'clean', 'hydro', 'river', 'dam', 'electricity'],
  },
  {
    id: 'geothermal_plant', name: 'Geothermal Plant', icon: '♨️', category: 'power', group: 'Renewable',
    description: 'Taps superheated steam from deep wells. Reliable baseload with only a whiff of sulphur.',
    w: 3, h: 3, cost: 52_000, upkeep: 2_000, unlock: 7, model: 'geothermal_plant', height: 26, power: 85, jobs: 14,
    effects: [fx('pollution', 5, 30), fx('noise', 6, 70)], tags: ['renewable', 'steam', 'baseload', 'electricity'],
  },
  {
    id: 'biomass_plant', name: 'Biomass Plant', icon: '🌾', category: 'power', group: 'Renewable',
    description: 'Burns wood chips and crop waste. Carbon-neutral on paper, a little smoky in practice.',
    w: 3, h: 3, cost: 26_000, upkeep: 1_100, unlock: 4, model: 'biomass_plant', height: 45, power: 45, jobs: 22,
    effects: [fx('pollution', 8, 90), fx('noise', 6, 70)], tags: ['renewable', 'wood', 'biofuel', 'electricity'],
  },
  {
    id: 'coal_plant', name: 'Coal Power Plant', icon: '🏭', category: 'power', group: 'Fossil Fuel',
    description: 'Boiler house, turbine hall and two tall stacks. Cheap and reliable baseload — and the dirtiest way to keep the lights on.',
    w: 4, h: 4, cost: 18_000, upkeep: 900, unlock: 0, model: 'coal_plant', height: 80, power: 40, jobs: 40,
    effects: [fx('pollution', 14, 200), fx('noise', 8, 120), fx('landValue', 10, -60)], tags: ['fossil', 'coal', 'baseload', 'dirty', 'electricity'],
  },
  {
    id: 'oil_plant', name: 'Oil Power Plant', icon: '🛢️', category: 'power', group: 'Fossil Fuel',
    description: 'Fuel-oil tanks feed a compact steam plant. More power than coal and a bit cleaner, but thirsty for cash.',
    w: 4, h: 4, cost: 34_000, upkeep: 1_500, unlock: 2, model: 'oil_plant', height: 60, power: 64, jobs: 36,
    effects: [fx('pollution', 12, 170), fx('noise', 8, 110), fx('landValue', 9, -45)], tags: ['fossil', 'oil', 'tanks', 'electricity'],
  },
  {
    id: 'gas_plant', name: 'Combined-Cycle Gas Plant', icon: '⛽', category: 'power', group: 'Fossil Fuel',
    description: 'Gas turbines exhaust through heat-recovery boilers that drive a second steam turbine. Efficient, flexible, moderately clean.',
    w: 3, h: 4, cost: 58_000, upkeep: 2_300, unlock: 7, model: 'gas_plant', height: 48, power: 130, jobs: 26,
    effects: [fx('pollution', 9, 90), fx('noise', 8, 110)], tags: ['fossil', 'gas', 'turbine', 'electricity'],
  },
  {
    id: 'waste_energy_plant', name: 'Waste-to-Energy Plant', icon: '🚮', category: 'power', group: 'Fossil Fuel',
    description: 'A sleek incinerator that burns the city\'s rubbish for power — with an artificial ski slope on its roof. Also collects garbage.',
    w: 4, h: 3, cost: 64_000, upkeep: 2_800, unlock: 5, model: 'waste_energy_plant', height: 90, power: 35, jobs: 45,
    capacity: 3_000, capacityLabel: 'tons/month', vehicles: { type: 'garbage', count: 8 },
    effects: [fx('garbage', 26, 200), fx('pollution', 10, 90), fx('leisure', 12, 90), fx('tourism', 12, 40)], tags: ['garbage', 'incinerator', 'ski', 'copenhill', 'electricity'],
  },
  {
    id: 'nuclear_plant', name: 'Nuclear Power Plant', icon: '☢️', category: 'power', group: 'Advanced',
    description: 'Two hyperboloid cooling towers and a pressurised-water reactor under a steel containment dome. A gigawatt of carbon-free baseload.',
    w: 6, h: 6, cost: 460_000, upkeep: 16_000, unlock: 9, model: 'nuclear_plant', height: 150, power: 1_000, jobs: 280,
    effects: [fx('noise', 8, 90), fx('landValue', 14, -50)], tags: ['nuclear', 'reactor', 'baseload', 'uranium', 'electricity'],
  },
  {
    id: 'fusion_plant', name: 'Fusion Power Plant', icon: '⚛️', category: 'power', group: 'Advanced',
    description: 'A superconducting tokamak confines a star in a magnetic bottle. Almost limitless clean energy for a true metropolis.',
    w: 6, h: 6, cost: 1_450_000, upkeep: 42_000, unlock: 11, model: 'fusion_plant', height: 70, power: 2_400, jobs: 320,
    effects: [fx('noise', 6, 50), fx('tourism', 20, 60)], tags: ['fusion', 'tokamak', 'futuristic', 'clean', 'electricity'],
  },

  // ══ WATER & SEWAGE ════════════════════════════════════════════════════════
  {
    id: 'water_pump', name: 'Water Pumping Station', icon: '💧', category: 'water', group: 'Supply',
    description: 'Draws fresh water from a lake or river. Must stand on the shore, upstream of any sewage outlets.',
    w: 1, h: 2, cost: 2_500, upkeep: 100, unlock: 0, model: 'water_pump', height: 8, water: 600, jobs: 3,
    placement: { shore: true }, tags: ['water', 'pump', 'intake', 'shore'],
  },
  {
    id: 'water_tower', name: 'Water Tower', icon: '🪣', category: 'water', group: 'Supply',
    description: 'Pumps groundwater into an elevated tank. Works anywhere, but ground pollution taints its supply.',
    w: 1, h: 1, cost: 1_800, upkeep: 75, unlock: 0, model: 'water_tower', height: 28, water: 300, jobs: 1,
    tags: ['water', 'groundwater', 'tank', 'well'],
  },
  {
    id: 'water_pump_large', name: 'Large Pumping Station', icon: '🚰', category: 'water', group: 'Supply',
    description: 'A heavy-duty intake with four pump trains and a surge tank. Supplies a whole district.',
    w: 2, h: 3, cost: 16_000, upkeep: 700, unlock: 4, model: 'water_pump_large', height: 14, water: 3_000, jobs: 10,
    placement: { shore: true }, tags: ['water', 'pump', 'intake', 'shore'],
  },
  {
    id: 'water_treatment', name: 'Water Purification Plant', icon: '🧪', category: 'water', group: 'Supply',
    description: 'Settling basins, sand filters and UV disinfection make even murky river water drinkable.',
    w: 4, h: 4, cost: 38_000, upkeep: 1_600, unlock: 5, model: 'water_treatment', height: 12, water: 4_200, jobs: 28,
    placement: { shore: true }, tags: ['water', 'purification', 'filter', 'clean', 'shore'],
  },
  {
    id: 'desalination_plant', name: 'Desalination Plant', icon: '🧂', category: 'water', group: 'Supply',
    description: 'Reverse-osmosis membranes turn seawater into fresh water. Power-hungry, but a lifeline for dry coastal cities.',
    w: 4, h: 3, cost: 72_000, upkeep: 3_000, unlock: 7, model: 'desalination_plant', height: 16, water: 5_000, power: -18, jobs: 30,
    placement: { shore: true }, tags: ['water', 'sea', 'coastal', 'osmosis', 'desert', 'shore'],
  },
  {
    id: 'sewage_outlet', name: 'Sewage Outlet', icon: '🚽', category: 'water', group: 'Sewage',
    description: 'Dumps untreated sewage straight into the water. Pollutes everything downstream — keep it far from your pumps.',
    w: 1, h: 2, cost: 2_000, upkeep: 80, unlock: 0, model: 'sewage_outlet', height: 5, sewage: 600, jobs: 2,
    placement: { shore: true }, effects: [fx('pollution', 6, 120), fx('landValue', 6, -40)], tags: ['sewage', 'drain', 'outfall', 'shore'],
  },
  {
    id: 'sewage_treatment', name: 'Sewage Treatment Plant', icon: '🧼', category: 'water', group: 'Sewage',
    description: 'Round clarifiers and aeration tanks clean wastewater before releasing it. Far less pollution than an outlet.',
    w: 4, h: 4, cost: 30_000, upkeep: 1_300, unlock: 4, model: 'sewage_treatment', height: 12, sewage: 3_000, jobs: 22,
    placement: { shore: true }, effects: [fx('pollution', 4, 40), fx('landValue', 6, -25)], tags: ['sewage', 'treatment', 'clarifier', 'shore'],
  },
  {
    id: 'sewage_treatment_adv', name: 'Advanced Treatment Plant', icon: '🫧', category: 'water', group: 'Sewage',
    description: 'Membrane bioreactors under a green roof return crystal-clear water to nature. Odourless, silent, spotless.',
    w: 4, h: 3, cost: 88_000, upkeep: 3_400, unlock: 8, model: 'sewage_treatment_adv', height: 14, sewage: 6_500, jobs: 30,
    placement: { shore: true }, tags: ['sewage', 'treatment', 'eco', 'membrane', 'shore'],
  },

  // ══ GARBAGE ═══════════════════════════════════════════════════════════════
  {
    id: 'landfill', name: 'Landfill Site', icon: '🗑️', category: 'garbage', group: 'Disposal',
    description: 'A lined pit where the city\'s rubbish is buried. Cheap, smelly, and it fills up — empty or replace it in time.',
    w: 3, h: 3, cost: 4_500, upkeep: 180, unlock: 1, model: 'landfill', height: 8, jobs: 10,
    capacity: 40_000, capacityLabel: 'tons stored', vehicles: { type: 'garbage', count: 4 },
    effects: [fx('garbage', 30, 220), fx('pollution', 8, 120), fx('landValue', 10, -60)], tags: ['garbage', 'dump', 'trash', 'waste'],
  },
  {
    id: 'incinerator', name: 'Incineration Plant', icon: '🔥', category: 'garbage', group: 'Disposal',
    description: 'Burns garbage continuously and recovers a little electricity from the heat. Never fills up, but it smokes.',
    w: 3, h: 3, cost: 22_000, upkeep: 1_000, unlock: 3, model: 'incinerator', height: 50, power: 12, jobs: 24,
    capacity: 2_000, capacityLabel: 'tons/month', vehicles: { type: 'garbage', count: 8 },
    effects: [fx('garbage', 30, 220), fx('pollution', 12, 150), fx('noise', 6, 80)], tags: ['garbage', 'burn', 'trash', 'waste', 'electricity'],
  },
  {
    id: 'waste_transfer', name: 'Waste Transfer Station', icon: '🚛', category: 'garbage', group: 'Disposal',
    description: 'Compacts local collections into big trailers bound for landfills and plants. Extends coverage to far-flung districts.',
    w: 2, h: 2, cost: 9_000, upkeep: 380, unlock: 4, model: 'waste_transfer', height: 12, jobs: 12,
    capacity: 600, capacityLabel: 'tons/month', vehicles: { type: 'garbage', count: 10 },
    effects: [fx('garbage', 22, 200), fx('noise', 6, 70), fx('landValue', 5, -25)], tags: ['garbage', 'trucks', 'transfer', 'waste'],
  },
  {
    id: 'recycling_center', name: 'Recycling Center', icon: '♻️', category: 'garbage', group: 'Processing',
    description: 'Sorts paper, glass, metal and plastics back into raw materials. Cleaner than burning, and sells what it recovers.',
    w: 3, h: 3, cost: 30_000, upkeep: 1_200, unlock: 5, model: 'recycling_center', height: 16, jobs: 36,
    capacity: 1_600, capacityLabel: 'tons/month', vehicles: { type: 'garbage', count: 8 },
    effects: [fx('garbage', 30, 220), fx('pollution', 6, 60), fx('noise', 6, 70)], tags: ['garbage', 'recycle', 'sorting', 'waste', 'green'],
  },
  {
    id: 'eco_waste', name: 'Eco Waste Facility', icon: '🌱', category: 'garbage', group: 'Processing',
    description: 'Anaerobic digesters turn organic waste into biogas and compost; everything else is recycled. Nearly zero emissions.',
    w: 4, h: 3, cost: 125_000, upkeep: 4_600, unlock: 9, model: 'eco_waste', height: 22, power: 20, jobs: 44,
    capacity: 5_000, capacityLabel: 'tons/month', vehicles: { type: 'garbage', count: 12 },
    effects: [fx('garbage', 34, 235), fx('pollution', 4, 20)], tags: ['garbage', 'biogas', 'compost', 'eco', 'green', 'electricity'],
  },

  // ══ HEALTHCARE ════════════════════════════════════════════════════════════
  {
    id: 'clinic', name: 'Medical Clinic', icon: '🏥', category: 'health', group: 'Care',
    description: 'A neighbourhood clinic with a few beds and an ambulance bay. Treats the sick and keeps the district healthy.',
    w: 2, h: 2, cost: 6_000, upkeep: 300, unlock: 1, model: 'clinic', height: 10, jobs: 20,
    capacity: 100, capacityLabel: 'patients', vehicles: { type: 'ambulance', count: 3 },
    effects: [fx('health', 18, 200)], tags: ['health', 'doctor', 'ambulance', 'sick'],
  },
  {
    id: 'hospital', name: 'Hospital', icon: '🩺', category: 'health', group: 'Care',
    description: 'A general hospital tower with an emergency department and a rooftop helipad. Covers a large area.',
    w: 3, h: 3, cost: 30_000, upkeep: 1_400, unlock: 4, model: 'hospital', height: 36, jobs: 110,
    capacity: 500, capacityLabel: 'patients', vehicles: { type: 'ambulance', count: 10 },
    effects: [fx('health', 26, 230)], tags: ['health', 'hospital', 'ambulance', 'emergency', 'helipad'],
  },
  {
    id: 'medical_center', name: 'Medical Center', icon: '⚕️', category: 'health', group: 'Specialist',
    description: 'A sprawling teaching hospital with twin towers and research wings. The best care money can buy.',
    w: 4, h: 4, cost: 175_000, upkeep: 6_200, unlock: 8, model: 'medical_center', height: 58, jobs: 420,
    capacity: 1_600, capacityLabel: 'patients', vehicles: { type: 'ambulance', count: 20 },
    effects: [fx('health', 40, 255), fx('landValue', 12, 40)], tags: ['health', 'hospital', 'research', 'ambulance'],
  },
  {
    id: 'childrens_hospital', name: 'Children\'s Hospital', icon: '🧸', category: 'health', group: 'Specialist',
    description: 'Bright colours, a rooftop garden and paediatric specialists. Families love living nearby.',
    w: 3, h: 3, cost: 46_000, upkeep: 1_800, unlock: 6, model: 'childrens_hospital', height: 22, jobs: 90,
    capacity: 300, capacityLabel: 'patients', vehicles: { type: 'ambulance', count: 6 },
    effects: [fx('health', 24, 190), fx('happiness', 14, 30)], tags: ['health', 'kids', 'children', 'family', 'pediatric'],
  },
  {
    id: 'eldercare', name: 'Eldercare Home', icon: '👵', category: 'health', group: 'Care',
    description: 'A garden residence where seniors are looked after. Lifts health and happiness for the retirees nearby.',
    w: 2, h: 3, cost: 12_000, upkeep: 520, unlock: 4, model: 'eldercare', height: 12, jobs: 32,
    capacity: 120, capacityLabel: 'residents', effects: [fx('health', 14, 120), fx('happiness', 14, 50)], tags: ['health', 'seniors', 'retirement', 'care home'],
  },
  {
    id: 'medical_lab', name: 'Medical Research Lab', icon: '🔬', category: 'health', group: 'Specialist',
    description: 'Scientists develop vaccines and treatments here, boosting the health of the whole region.',
    w: 3, h: 2, cost: 42_000, upkeep: 1_700, unlock: 7, model: 'medical_lab', height: 18, jobs: 70,
    effects: [fx('health', 34, 90), fx('education', 12, 50), fx('landValue', 8, 30)], tags: ['health', 'research', 'science', 'lab', 'vaccine'],
  },
  {
    id: 'medical_heli', name: 'Medical Helicopter Depot', icon: '🚁', category: 'health', group: 'Emergency',
    description: 'Air ambulances reach patients fast, even across rivers and gridlocked avenues.',
    w: 2, h: 2, cost: 24_000, upkeep: 1_100, unlock: 8, model: 'medical_heli', height: 12, jobs: 20,
    effects: [fx('health', 48, 140), fx('noise', 8, 90)], tags: ['health', 'helicopter', 'air ambulance', 'emergency'],
  },
  {
    id: 'spa_sanatorium', name: 'Sanatorium & Spa', icon: '🧖', category: 'health', group: 'Care',
    description: 'Thermal pools, massage and clean air. Heals body and mind — and draws wellness tourists.',
    w: 3, h: 3, cost: 38_000, upkeep: 1_400, unlock: 6, model: 'spa_sanatorium', height: 16, jobs: 48,
    capacity: 200, capacityLabel: 'guests', effects: [fx('health', 20, 150), fx('happiness', 18, 60), fx('leisure', 14, 90), fx('tourism', 18, 60)], tags: ['health', 'spa', 'wellness', 'thermal', 'pool'],
  },

  // ══ DEATHCARE ═════════════════════════════════════════════════════════════
  {
    id: 'cemetery', name: 'Cemetery', icon: '🪦', category: 'deathcare', group: 'Deathcare',
    description: 'Quiet rows of headstones between cypress trees and a small chapel. Fills up over the years.',
    w: 3, h: 3, cost: 4_500, upkeep: 200, unlock: 5, model: 'cemetery', height: 10, jobs: 8,
    capacity: 6_000, capacityLabel: 'graves', vehicles: { type: 'hearse', count: 6 },
    effects: [fx('deathcare', 24, 220), fx('landValue', 6, -20)], tags: ['deathcare', 'graves', 'hearse', 'funeral'],
  },
  {
    id: 'crematorium', name: 'Crematorium', icon: '⚱️', category: 'deathcare', group: 'Deathcare',
    description: 'A dignified modern crematorium with a garden of remembrance. Never runs out of space.',
    w: 2, h: 3, cost: 18_000, upkeep: 800, unlock: 5, model: 'crematorium', height: 18, jobs: 16,
    capacity: 300, capacityLabel: 'per month', vehicles: { type: 'hearse', count: 8 },
    effects: [fx('deathcare', 26, 220), fx('pollution', 4, 40)], tags: ['deathcare', 'cremation', 'hearse', 'funeral'],
  },
  {
    id: 'memorial_park', name: 'Memorial Park', icon: '🕊️', category: 'deathcare', group: 'Deathcare',
    description: 'A landscaped garden cemetery with a reflecting pool and a columbarium. Doubles as a serene park.',
    w: 4, h: 4, cost: 46_000, upkeep: 1_300, unlock: 7, model: 'memorial_park', height: 14, jobs: 14,
    capacity: 12_000, capacityLabel: 'graves', vehicles: { type: 'hearse', count: 10 },
    effects: [fx('deathcare', 30, 235), fx('leisure', 14, 100), fx('landValue', 10, 30)], tags: ['deathcare', 'garden', 'park', 'funeral'],
  },

  // ══ FIRE ══════════════════════════════════════════════════════════════════
  {
    id: 'fire_station', name: 'Fire House', icon: '🚒', category: 'fire', group: 'Stations',
    description: 'Two red engine bays and a hose-drying tower. Protects nearby buildings and puts out fires fast.',
    w: 2, h: 2, cost: 5_500, upkeep: 250, unlock: 1, model: 'fire_station', height: 16, jobs: 15,
    vehicles: { type: 'firetruck', count: 3 }, effects: [fx('fire', 18, 220)], tags: ['fire', 'firefighters', 'engine'],
  },
  {
    id: 'fire_station_large', name: 'Fire Station', icon: '🧯', category: 'fire', group: 'Stations',
    description: 'A four-bay station with ladder trucks and a training tower. Covers a whole district.',
    w: 3, h: 3, cost: 18_000, upkeep: 800, unlock: 4, model: 'fire_station_large', height: 20, jobs: 36,
    vehicles: { type: 'firetruck', count: 6 }, effects: [fx('fire', 26, 240)], tags: ['fire', 'firefighters', 'ladder'],
  },
  {
    id: 'fire_hq', name: 'Fire Headquarters', icon: '🚨', category: 'fire', group: 'Stations',
    description: 'The command centre of the fire service with dispatch, training grounds and a fleet of heavy engines.',
    w: 4, h: 4, cost: 62_000, upkeep: 2_400, unlock: 7, model: 'fire_hq', height: 30, jobs: 90,
    vehicles: { type: 'firetruck', count: 12 }, effects: [fx('fire', 36, 255)], tags: ['fire', 'firefighters', 'headquarters', 'dispatch'],
  },
  {
    id: 'fire_heli', name: 'Fire Helicopter Depot', icon: '💦', category: 'fire', group: 'Aerial & Watch',
    description: 'Water-bombing helicopters fight forest fires and reach blazes no truck can.',
    w: 3, h: 2, cost: 32_000, upkeep: 1_400, unlock: 6, model: 'fire_heli', height: 12, jobs: 24,
    effects: [fx('fire', 40, 150), fx('noise', 8, 90)], tags: ['fire', 'helicopter', 'forest fire', 'aerial'],
  },
  {
    id: 'fire_watch', name: 'Fire Watch Tower', icon: '🪜', category: 'fire', group: 'Aerial & Watch',
    description: 'A lookout on stilts above the treeline. Spots fires early in forests and outlying farms.',
    w: 1, h: 1, cost: 1_200, upkeep: 40, unlock: 3, model: 'fire_watch', height: 22, jobs: 1,
    effects: [fx('fire', 20, 60)], tags: ['fire', 'forest', 'lookout', 'watch'],
  },

  // ══ POLICE ════════════════════════════════════════════════════════════════
  {
    id: 'police_station', name: 'Police Station', icon: '🚓', category: 'police', group: 'Stations',
    description: 'A neighbourhood precinct with patrol cars out front. Keeps crime in check.',
    w: 2, h: 2, cost: 6_000, upkeep: 280, unlock: 2, model: 'police_station', height: 12, jobs: 18,
    vehicles: { type: 'police', count: 4 }, effects: [fx('police', 18, 220)], tags: ['police', 'crime', 'patrol', 'cops'],
  },
  {
    id: 'police_hq', name: 'Police Headquarters', icon: '👮', category: 'police', group: 'Stations',
    description: 'A modern HQ with detectives, forensics and a big patrol fleet. Covers much of the city.',
    w: 3, h: 3, cost: 38_000, upkeep: 1_600, unlock: 5, model: 'police_hq', height: 34, jobs: 90,
    vehicles: { type: 'police', count: 12 }, effects: [fx('police', 30, 250)], tags: ['police', 'crime', 'detectives', 'headquarters'],
  },
  {
    id: 'prison', name: 'Prison', icon: '⛓️', category: 'police', group: 'Justice',
    description: 'High walls, watchtowers and cell blocks. Takes criminals off the streets city-wide, though nobody wants to live next door.',
    w: 4, h: 4, cost: 55_000, upkeep: 2_200, unlock: 6, model: 'prison', height: 18, jobs: 80,
    capacity: 800, capacityLabel: 'inmates', vehicles: { type: 'police', count: 4 },
    effects: [fx('police', 40, 110), fx('landValue', 10, -60)], tags: ['police', 'jail', 'prison', 'crime'],
  },
  {
    id: 'police_heli', name: 'Police Helicopter Depot', icon: '🔦', category: 'police', group: 'Special',
    description: 'Eyes in the sky. Helicopters with searchlights patrol vast areas day and night.',
    w: 3, h: 2, cost: 30_000, upkeep: 1_300, unlock: 7, model: 'police_heli', height: 12, jobs: 24,
    effects: [fx('police', 44, 140), fx('noise', 8, 90)], tags: ['police', 'helicopter', 'aerial', 'patrol'],
  },
  {
    id: 'intelligence_agency', name: 'Intelligence Agency', icon: '🕵️', category: 'police', group: 'Special',
    description: 'A black-glass cube bristling with radomes. Nobody knows what happens inside, but crime drops everywhere.',
    w: 3, h: 3, cost: 150_000, upkeep: 5_200, unlock: 9, model: 'intelligence_agency', height: 40, jobs: 260,
    placement: { unique: true }, effects: [fx('police', 60, 120), fx('landValue', 8, -10)], tags: ['police', 'spy', 'secret', 'agency', 'unique'],
  },

  // ══ EDUCATION ═════════════════════════════════════════════════════════════
  {
    id: 'elementary_school', name: 'Elementary School', icon: '🏫', category: 'education', group: 'Schools',
    description: 'A brick school with a gym, playground and sports field. Teaches the city\'s children to read and write.',
    w: 2, h: 3, cost: 7_000, upkeep: 320, unlock: 2, model: 'elementary_school', height: 12, jobs: 16,
    capacity: 300, capacityLabel: 'students', effects: [fx('education', 16, 180)], tags: ['education', 'school', 'kids', 'primary'],
  },
  {
    id: 'high_school', name: 'High School', icon: '🎒', category: 'education', group: 'Schools',
    description: 'Science labs, an auditorium and a running track. Produces the skilled workers offices and industry crave.',
    w: 3, h: 3, cost: 22_000, upkeep: 950, unlock: 4, model: 'high_school', height: 15, jobs: 45,
    capacity: 1_000, capacityLabel: 'students', effects: [fx('education', 22, 200)], tags: ['education', 'school', 'teenagers', 'secondary'],
  },
  {
    id: 'trade_school', name: 'Trade School', icon: '🛠️', category: 'education', group: 'Schools',
    description: 'Workshops for welders, electricians and mechanics. Industry\'s favourite school.',
    w: 3, h: 3, cost: 28_000, upkeep: 1_200, unlock: 5, model: 'trade_school', height: 14, jobs: 40,
    capacity: 800, capacityLabel: 'students', effects: [fx('education', 20, 150)], tags: ['education', 'vocational', 'industry', 'workshop'],
  },
  {
    id: 'community_college', name: 'Community College', icon: '📚', category: 'education', group: 'Higher Education',
    description: 'Affordable higher education in a modern campus block with a green quad.',
    w: 3, h: 4, cost: 46_000, upkeep: 1_900, unlock: 5, model: 'community_college', height: 20, jobs: 70,
    capacity: 1_600, capacityLabel: 'students', effects: [fx('education', 26, 190)], tags: ['education', 'college', 'adult', 'campus'],
  },
  {
    id: 'university', name: 'University', icon: '🎓', category: 'education', group: 'Higher Education',
    description: 'A grand quadrangle of lecture halls around a clock tower. Educated graduates fuel offices and high-tech industry.',
    w: 5, h: 5, cost: 120_000, upkeep: 4_800, unlock: 6, model: 'university', height: 48, jobs: 220,
    capacity: 4_500, capacityLabel: 'students', effects: [fx('education', 34, 230), fx('landValue', 14, 50), fx('tourism', 12, 30)], tags: ['education', 'university', 'campus', 'college', 'quad'],
  },
  {
    id: 'campus_library', name: 'Campus Library', icon: '📖', category: 'education', group: 'Higher Education',
    description: 'A glass-and-stone reading hall with a lawn for studying under the trees. Boosts nearby schools and colleges.',
    w: 3, h: 3, cost: 55_000, upkeep: 2_000, unlock: 7, model: 'campus_library', height: 20, jobs: 30,
    capacity: 1_200, capacityLabel: 'readers', effects: [fx('education', 26, 120), fx('landValue', 10, 30)], tags: ['education', 'library', 'campus', 'books'],
  },
  {
    id: 'library', name: 'Public Library', icon: '📕', category: 'education', group: 'Culture & Research',
    description: 'A classic library with a columned portico. Free books, quiet reading rooms and story time for kids.',
    w: 2, h: 2, cost: 9_000, upkeep: 380, unlock: 3, model: 'library', height: 13, jobs: 12,
    capacity: 400, capacityLabel: 'visitors', effects: [fx('education', 16, 90), fx('leisure', 12, 50)], tags: ['education', 'library', 'books', 'culture'],
  },
  {
    id: 'science_museum', name: 'Science Museum', icon: '🦕', category: 'education', group: 'Culture & Research',
    description: 'Dinosaur skeletons, a rocket in the atrium and hands-on exhibits. Educates, entertains and attracts tourists.',
    w: 4, h: 3, cost: 72_000, upkeep: 2_600, unlock: 7, model: 'science_museum', height: 30, jobs: 60,
    capacity: 2_000, capacityLabel: 'visitors', effects: [fx('education', 30, 110), fx('tourism', 30, 100), fx('leisure', 16, 80)], tags: ['education', 'museum', 'science', 'rocket', 'culture'],
  },
  {
    id: 'research_institute', name: 'Research Institute', icon: '🧬', category: 'education', group: 'Culture & Research',
    description: 'Cutting-edge laboratories and a particle accelerator ring. Attracts brilliant minds and high-tech offices.',
    w: 4, h: 4, cost: 165_000, upkeep: 6_000, unlock: 8, model: 'research_institute', height: 28, jobs: 180,
    effects: [fx('education', 40, 140), fx('landValue', 16, 70)], tags: ['education', 'research', 'science', 'lab', 'accelerator'],
  },

  // ══ PARKS & RECREATION ════════════════════════════════════════════════════
  {
    id: 'small_park', name: 'Small Park', icon: '🌳', category: 'parks', group: 'Neighbourhood',
    description: 'A pocket of green with a winding path, a bench and a few trees. Raises land value and happiness.',
    w: 1, h: 1, cost: 600, upkeep: 20, unlock: 0, model: 'small_park', height: 8,
    effects: [fx('leisure', 8, 120), fx('landValue', 8, 40)], attractiveness: 10, tags: ['park', 'green', 'trees', 'bench'],
  },
  {
    id: 'playground', name: 'Playground', icon: '🛝', category: 'parks', group: 'Neighbourhood',
    description: 'Slides, swings and a climbing frame on soft sand. Young families adore it.',
    w: 1, h: 1, cost: 900, upkeep: 30, unlock: 0, model: 'playground', height: 5,
    effects: [fx('leisure', 8, 110), fx('landValue', 8, 35), fx('happiness', 8, 20)], attractiveness: 12, tags: ['park', 'kids', 'slide', 'swings', 'family'],
  },
  {
    id: 'dog_park', name: 'Dog Park', icon: '🐕', category: 'parks', group: 'Neighbourhood',
    description: 'A fenced run with agility hoops and water bowls. Happy dogs, happy owners.',
    w: 2, h: 2, cost: 2_200, upkeep: 80, unlock: 1, model: 'dog_park', height: 5,
    effects: [fx('leisure', 10, 120), fx('landValue', 10, 35)], attractiveness: 10, tags: ['park', 'dogs', 'pets'],
  },
  {
    id: 'city_park', name: 'City Park', icon: '🏞️', category: 'parks', group: 'Neighbourhood',
    description: 'Sweeping lawns, a duck pond, a fountain and shady groves. The green heart of a neighbourhood.',
    w: 3, h: 3, cost: 7_500, upkeep: 260, unlock: 2, model: 'city_park', height: 12,
    effects: [fx('leisure', 16, 180), fx('landValue', 14, 60)], attractiveness: 25, tags: ['park', 'pond', 'fountain', 'lawn', 'green'],
  },
  {
    id: 'botanical_garden', name: 'Botanical Garden', icon: '🌺', category: 'parks', group: 'Attractions',
    description: 'A Victorian palm house surrounded by formal beds and rare trees from every continent.',
    w: 4, h: 3, cost: 22_000, upkeep: 800, unlock: 5, model: 'botanical_garden', height: 18,
    effects: [fx('leisure', 18, 190), fx('landValue', 14, 70), fx('tourism', 18, 80)], attractiveness: 35, tags: ['park', 'garden', 'greenhouse', 'flowers', 'plants'],
  },
  {
    id: 'skate_park', name: 'Skate Park', icon: '🛹', category: 'parks', group: 'Sports',
    description: 'Bowls, ramps and rails in smooth concrete, with graffiti walls for the artists.',
    w: 2, h: 2, cost: 3_500, upkeep: 120, unlock: 3, model: 'skate_park', height: 5,
    effects: [fx('leisure', 12, 130), fx('noise', 4, 40)], attractiveness: 12, tags: ['park', 'skate', 'youth', 'sports'],
  },
  {
    id: 'basketball_courts', name: 'Basketball Courts', icon: '🏀', category: 'parks', group: 'Sports',
    description: 'Two floodlit outdoor courts. Pick-up games run late into warm summer nights.',
    w: 2, h: 2, cost: 2_800, upkeep: 100, unlock: 2, model: 'basketball_courts', height: 7,
    effects: [fx('leisure', 10, 120), fx('noise', 4, 30)], attractiveness: 10, tags: ['park', 'basketball', 'sports', 'court'],
  },
  {
    id: 'soccer_field', name: 'Soccer Field', icon: '⚽', category: 'parks', group: 'Sports',
    description: 'A floodlit community pitch with a small grandstand and changing rooms.',
    w: 4, h: 3, cost: 6_500, upkeep: 220, unlock: 2, model: 'soccer_field', height: 16,
    effects: [fx('leisure', 16, 150), fx('noise', 6, 40)], attractiveness: 15, tags: ['park', 'football', 'soccer', 'sports', 'pitch'],
  },
  {
    id: 'tennis_club', name: 'Tennis Club', icon: '🎾', category: 'parks', group: 'Sports',
    description: 'Three clay courts and a clubhouse terrace. A touch of class for the neighbourhood.',
    w: 3, h: 2, cost: 8_000, upkeep: 300, unlock: 3, model: 'tennis_club', height: 8,
    effects: [fx('leisure', 14, 140), fx('landValue', 12, 50)], attractiveness: 15, tags: ['park', 'tennis', 'sports', 'club'],
  },
  {
    id: 'public_pool', name: 'Public Pool', icon: '🏊', category: 'parks', group: 'Sports',
    description: 'An outdoor lido with lanes, a diving board and a sunbathing lawn. Packed in summer.',
    w: 3, h: 2, cost: 9_500, upkeep: 420, unlock: 3, model: 'public_pool', height: 8,
    effects: [fx('leisure', 14, 160), fx('happiness', 12, 30)], attractiveness: 18, tags: ['park', 'swimming', 'pool', 'summer', 'sports'],
  },
  {
    id: 'zoo', name: 'City Zoo', icon: '🦒', category: 'parks', group: 'Attractions',
    description: 'Savannah enclosures, a lake with flamingos and an elephant house. Visitors come from far and wide.',
    w: 6, h: 5, cost: 95_000, upkeep: 3_200, unlock: 6, model: 'zoo', height: 12, jobs: 60,
    effects: [fx('leisure', 26, 200), fx('tourism', 30, 160), fx('landValue', 12, 40)], attractiveness: 45, tags: ['park', 'animals', 'zoo', 'family', 'tourism'],
  },
  {
    id: 'amusement_park', name: 'Amusement Park', icon: '🎢', category: 'parks', group: 'Attractions',
    description: 'A roller coaster, carousel, drop tower and candy-striped tents. Screams of joy guaranteed.',
    w: 6, h: 6, cost: 145_000, upkeep: 5_000, unlock: 7, model: 'amusement_park', height: 45, jobs: 120,
    effects: [fx('leisure', 30, 220), fx('tourism', 34, 200), fx('noise', 10, 90)], attractiveness: 50, tags: ['park', 'rollercoaster', 'rides', 'fun', 'tourism'],
  },
  {
    id: 'ferris_wheel', name: 'Ferris Wheel', icon: '🎡', category: 'parks', group: 'Attractions',
    description: 'A 50 m observation wheel with glowing gondolas. The city\'s favourite date spot.',
    w: 3, h: 2, cost: 38_000, upkeep: 1_400, unlock: 5, model: 'ferris_wheel', height: 50, jobs: 12,
    effects: [fx('leisure', 20, 140), fx('tourism', 20, 110), fx('landValue', 10, 40)], attractiveness: 35, tags: ['park', 'wheel', 'ride', 'view', 'tourism'],
  },
  {
    id: 'golf_course', name: 'Golf Course', icon: '⛳', category: 'parks', group: 'Sports',
    description: 'Rolling fairways, sand bunkers, a water hazard and a clubhouse. Sends nearby land values soaring.',
    w: 8, h: 6, cost: 62_000, upkeep: 1_900, unlock: 6, model: 'golf_course', height: 10, jobs: 30,
    effects: [fx('leisure', 20, 140), fx('landValue', 20, 90), fx('tourism', 16, 50)], attractiveness: 30, tags: ['park', 'golf', 'sports', 'luxury'],
  },
  {
    id: 'nature_reserve', name: 'Nature Reserve', icon: '🦌', category: 'parks', group: 'Nature',
    description: 'Protected woodland and wildflower meadows with a boardwalk and bird hide. Absorbs pollution.',
    w: 5, h: 5, cost: 12_000, upkeep: 150, unlock: 4, model: 'nature_reserve', height: 14, jobs: 4,
    effects: [fx('leisure', 20, 120), fx('pollution', 12, -70), fx('landValue', 14, 40)], attractiveness: 25, tags: ['park', 'forest', 'nature', 'wildlife', 'green'],
  },
  {
    id: 'campground', name: 'Campground', icon: '🏕️', category: 'parks', group: 'Nature',
    description: 'Tents, camper vans and a campfire circle under the pines. A cheap getaway for locals and tourists alike.',
    w: 3, h: 3, cost: 5_000, upkeep: 150, unlock: 3, model: 'campground', height: 10, jobs: 3,
    effects: [fx('leisure', 14, 120), fx('tourism', 14, 60)], attractiveness: 15, tags: ['park', 'camping', 'tents', 'nature'],
  },
  {
    id: 'lakeside_park', name: 'Lakeside Park', icon: '🦆', category: 'parks', group: 'Waterfront',
    description: 'A lawn that runs down to the water with a jetty, pedal boats and a café kiosk.',
    w: 3, h: 2, cost: 6_000, upkeep: 200, unlock: 2, model: 'lakeside_park', height: 8,
    placement: { shore: true }, effects: [fx('leisure', 16, 170), fx('landValue', 14, 80)], attractiveness: 25, tags: ['park', 'lake', 'waterfront', 'jetty', 'shore'],
  },
  {
    id: 'beach_promenade', name: 'Beach Promenade', icon: '🏖️', category: 'parks', group: 'Waterfront',
    description: 'A palm-lined boardwalk above golden sand with umbrellas, a lifeguard tower and ice-cream stands.',
    w: 4, h: 2, cost: 14_000, upkeep: 450, unlock: 4, model: 'beach_promenade', height: 9,
    placement: { shore: true }, effects: [fx('leisure', 20, 190), fx('tourism', 20, 110), fx('landValue', 16, 80)], attractiveness: 35, tags: ['park', 'beach', 'sea', 'sand', 'waterfront', 'shore'],
  },
  {
    id: 'marina', name: 'Marina', icon: '⛵', category: 'parks', group: 'Waterfront',
    description: 'Floating pontoons crowded with yachts and sailboats, plus a harbour-master\'s office and seafood bar.',
    w: 4, h: 3, cost: 44_000, upkeep: 1_500, unlock: 6, model: 'marina', height: 18, jobs: 20,
    placement: { shore: true }, effects: [fx('leisure', 20, 150), fx('tourism', 22, 120), fx('landValue', 18, 90)], attractiveness: 30, tags: ['park', 'boats', 'yachts', 'harbor', 'waterfront', 'shore'],
  },
  {
    id: 'ski_resort', name: 'Ski Resort', icon: '⛷️', category: 'parks', group: 'Nature',
    description: 'A chalet lodge, a chairlift and groomed pistes on a mountainside. Built for steep alpine slopes.',
    w: 4, h: 5, cost: 88_000, upkeep: 3_000, unlock: 6, model: 'ski_resort', height: 40, jobs: 50,
    placement: { maxSlope: 0.75 }, effects: [fx('leisure', 24, 180), fx('tourism', 30, 160)], attractiveness: 30, tags: ['park', 'ski', 'snow', 'alpine', 'winter', 'mountain', 'tourism'],
  },

  // ══ PLAZAS & DECOR ════════════════════════════════════════════════════════
  {
    id: 'statue', name: 'Founder\'s Statue', icon: '🗿', category: 'plazas', group: 'Decor',
    description: 'A bronze likeness of the city\'s founder on a granite plinth, pigeons included.',
    w: 1, h: 1, cost: 1_800, upkeep: 40, unlock: 0, model: 'statue', height: 9,
    effects: [fx('landValue', 8, 40)], attractiveness: 12, tags: ['plaza', 'statue', 'decor', 'bronze'],
  },
  {
    id: 'gazebo', name: 'Gazebo', icon: '🛖', category: 'plazas', group: 'Decor',
    description: 'A white octagonal pavilion among flower beds. Perfect for summer picnics and proposals.',
    w: 1, h: 1, cost: 1_200, upkeep: 30, unlock: 0, model: 'gazebo', height: 7,
    effects: [fx('leisure', 6, 80), fx('landValue', 6, 30)], attractiveness: 10, tags: ['plaza', 'pavilion', 'decor', 'garden'],
  },
  {
    id: 'flower_garden', name: 'Flower Garden', icon: '🌷', category: 'plazas', group: 'Decor',
    description: 'Formal beds of tulips, roses and lavender with a sundial at the centre.',
    w: 1, h: 1, cost: 1_500, upkeep: 60, unlock: 1, model: 'flower_garden', height: 3,
    effects: [fx('leisure', 6, 80), fx('landValue', 8, 45)], attractiveness: 14, tags: ['plaza', 'flowers', 'garden', 'decor'],
  },
  {
    id: 'fountain_plaza', name: 'Fountain Plaza', icon: '⛲', category: 'plazas', group: 'Plazas',
    description: 'A paved square around a three-tier fountain, lit up at night. A natural meeting point.',
    w: 2, h: 2, cost: 3_500, upkeep: 110, unlock: 1, model: 'fountain_plaza', height: 7,
    effects: [fx('leisure', 10, 90), fx('landValue', 10, 60)], attractiveness: 20, tags: ['plaza', 'fountain', 'square', 'water'],
  },
  {
    id: 'tree_plaza', name: 'Tree-lined Plaza', icon: '🌲', category: 'plazas', group: 'Plazas',
    description: 'A shady square with a grid of trees, café tables and benches.',
    w: 2, h: 2, cost: 2_800, upkeep: 90, unlock: 2, model: 'tree_plaza', height: 10,
    effects: [fx('leisure', 10, 90), fx('landValue', 10, 55)], attractiveness: 16, tags: ['plaza', 'trees', 'square', 'cafe'],
  },
  {
    id: 'bandstand', name: 'Bandstand', icon: '🎺', category: 'plazas', group: 'Plazas',
    description: 'A Victorian bandstand with a copper roof. Brass bands on Sundays, jazz on summer nights.',
    w: 2, h: 2, cost: 4_200, upkeep: 150, unlock: 3, model: 'bandstand', height: 9,
    effects: [fx('leisure', 12, 110), fx('landValue', 10, 45)], attractiveness: 18, tags: ['plaza', 'music', 'concert', 'decor'],
  },
  {
    id: 'obelisk', name: 'Obelisk', icon: '🗡️', category: 'plazas', group: 'Decor',
    description: 'A soaring granite needle in a round plaza, commemorating the city\'s pioneers.',
    w: 1, h: 1, cost: 6_500, upkeep: 80, unlock: 4, model: 'obelisk', height: 32,
    effects: [fx('landValue', 10, 50), fx('tourism', 8, 20)], attractiveness: 18, tags: ['plaza', 'monument', 'decor', 'needle'],
  },
  {
    id: 'sculpture_garden', name: 'Sculpture Garden', icon: '🎨', category: 'plazas', group: 'Plazas',
    description: 'Abstract steel and marble sculptures on manicured lawns, curated by the art museum.',
    w: 2, h: 2, cost: 9_000, upkeep: 260, unlock: 5, model: 'sculpture_garden', height: 8,
    effects: [fx('leisure', 12, 100), fx('landValue', 12, 60), fx('tourism', 12, 40)], attractiveness: 22, tags: ['plaza', 'art', 'sculpture', 'culture'],
  },

  // ══ PUBLIC TRANSPORT ══════════════════════════════════════════════════════
  {
    id: 'bus_depot', name: 'Bus Depot', icon: '🚌', category: 'transit', group: 'Road',
    description: 'Garages, a wash bay and a fleet of buses. Required before you can run bus lines.',
    w: 3, h: 3, cost: 14_000, upkeep: 650, unlock: 3, model: 'bus_depot', height: 10, jobs: 40,
    capacity: 12, capacityLabel: 'buses', vehicles: { type: 'bus', count: 12 }, effects: [fx('noise', 6, 60)], tags: ['transit', 'bus', 'depot', 'lines'],
  },
  {
    id: 'taxi_depot', name: 'Taxi Depot', icon: '🚕', category: 'transit', group: 'Road',
    description: 'A yellow fleet ready to whisk citizens and tourists anywhere. Cuts private car trips.',
    w: 2, h: 2, cost: 8_000, upkeep: 350, unlock: 4, model: 'taxi_depot', height: 8, jobs: 24,
    vehicles: { type: 'taxi', count: 10 }, effects: [fx('transit', 20, 60)], tags: ['transit', 'taxi', 'cab'],
  },
  {
    id: 'bike_hub', name: 'Bike Share Hub', icon: '🚲', category: 'transit', group: 'Road',
    description: 'Docked rental bikes under a green canopy. Healthy, quiet and cheap short trips.',
    w: 1, h: 1, cost: 1_600, upkeep: 60, unlock: 3, model: 'bike_hub', height: 4, jobs: 1,
    vehicles: { type: 'bike', count: 6 }, effects: [fx('transit', 8, 80)], tags: ['transit', 'bike', 'bicycle', 'green'],
  },
  {
    id: 'tram_depot', name: 'Tram Depot', icon: '🚋', category: 'transit', group: 'Rail',
    description: 'A long shed with maintenance pits and a fan of tracks. Required before you can run tram lines.',
    w: 4, h: 3, cost: 30_000, upkeep: 1_300, unlock: 6, model: 'tram_depot', height: 12, jobs: 44,
    capacity: 8, capacityLabel: 'trams', vehicles: { type: 'tram', count: 8 }, effects: [fx('noise', 6, 70)], tags: ['transit', 'tram', 'streetcar', 'depot'],
  },
  {
    id: 'metro_station', name: 'Metro Station', icon: 'Ⓜ️', category: 'transit', group: 'Rail',
    description: 'A glass entrance pavilion over an underground station. Fast, silent, and takes cars off the road.',
    w: 2, h: 2, cost: 18_000, upkeep: 800, unlock: 7, model: 'metro_station', height: 7, jobs: 10,
    vehicles: { type: 'metro', count: 2 }, effects: [fx('transit', 14, 200), fx('landValue', 10, 30)], tags: ['transit', 'metro', 'subway', 'underground'],
  },
  {
    id: 'train_station', name: 'Train Station', icon: '🚉', category: 'transit', group: 'Rail',
    description: 'A station hall with canopied platforms. Connects your city to the national rail network. Needs a railway alongside.',
    w: 4, h: 3, cost: 45_000, upkeep: 1_800, unlock: 5, model: 'train_station', height: 18, jobs: 30,
    vehicles: { type: 'train', count: 2 }, placement: { rail: true }, effects: [fx('transit', 20, 200), fx('tourism', 16, 60), fx('noise', 8, 80)], tags: ['transit', 'train', 'rail', 'railway', 'station'],
  },
  {
    id: 'cargo_terminal', name: 'Cargo Train Terminal', icon: '🚂', category: 'transit', group: 'Rail',
    description: 'Freight sidings, gantry cranes and container stacks. Moves goods in bulk and eases truck traffic. Needs a railway alongside.',
    w: 5, h: 4, cost: 56_000, upkeep: 2_200, unlock: 5, model: 'cargo_terminal', height: 22, jobs: 60,
    vehicles: { type: 'truck', count: 12 }, placement: { rail: true }, effects: [fx('noise', 12, 160), fx('pollution', 6, 50), fx('landValue', 8, -30)], tags: ['transit', 'cargo', 'freight', 'rail', 'containers'],
  },
  {
    id: 'monorail_station', name: 'Monorail Station', icon: '🚝', category: 'transit', group: 'Rail',
    description: 'A sleek elevated station on a single concrete beam. The future of city transit, today.',
    w: 2, h: 2, cost: 36_000, upkeep: 1_500, unlock: 9, model: 'monorail_station', height: 16, jobs: 12,
    effects: [fx('transit', 16, 180), fx('landValue', 10, 30)], tags: ['transit', 'monorail', 'elevated', 'futuristic'],
  },
  {
    id: 'ferry_terminal', name: 'Ferry Terminal', icon: '⛴️', category: 'transit', group: 'Water',
    description: 'A waterfront terminal with a covered gangway. Ferries glide commuters across bays and rivers.',
    w: 3, h: 2, cost: 28_000, upkeep: 1_200, unlock: 6, model: 'ferry_terminal', height: 14, jobs: 18,
    placement: { shore: true }, effects: [fx('transit', 16, 150), fx('tourism', 12, 40)], tags: ['transit', 'ferry', 'boat', 'water', 'shore'],
  },
  {
    id: 'cargo_harbor', name: 'Cargo Harbor', icon: '🚢', category: 'transit', group: 'Water',
    description: 'Quays, towering gantry cranes and acres of containers. Opens the city to world trade by sea.',
    w: 6, h: 5, cost: 165_000, upkeep: 5_800, unlock: 8, model: 'cargo_harbor', height: 55, jobs: 150,
    vehicles: { type: 'truck', count: 20 }, placement: { shore: true }, effects: [fx('noise', 14, 170), fx('pollution', 10, 90), fx('landValue', 10, -40)], tags: ['transit', 'cargo', 'port', 'ship', 'containers', 'shore'],
  },
  {
    id: 'heliport', name: 'City Heliport', icon: '🛬', category: 'transit', group: 'Air',
    description: 'A rooftop-style landing deck for executive shuttles and sightseeing flights.',
    w: 2, h: 2, cost: 40_000, upkeep: 1_600, unlock: 8, model: 'heliport', height: 14, jobs: 16,
    effects: [fx('tourism', 14, 60), fx('noise', 10, 110), fx('landValue', 6, 20)], tags: ['transit', 'helicopter', 'air', 'heliport'],
  },
  {
    id: 'blimp_depot', name: 'Blimp Depot', icon: '🎈', category: 'transit', group: 'Air',
    description: 'A huge arched hangar and mooring mast for sightseeing airships drifting lazily over the skyline.',
    w: 4, h: 3, cost: 66_000, upkeep: 2_500, unlock: 9, model: 'blimp_depot', height: 42, jobs: 26,
    effects: [fx('tourism', 26, 120), fx('transit', 20, 80)], tags: ['transit', 'blimp', 'airship', 'air', 'tourism'],
  },
  {
    id: 'small_airport', name: 'Regional Airport', icon: '🛩️', category: 'transit', group: 'Air',
    description: 'A single runway, a compact terminal and turboprops to nearby cities. Brings tourists — and noise.',
    w: 8, h: 5, cost: 185_000, upkeep: 6_200, unlock: 8, model: 'small_airport', height: 24, jobs: 140,
    effects: [fx('tourism', 24, 130), fx('noise', 20, 180), fx('landValue', 12, -40)], tags: ['transit', 'airport', 'planes', 'air', 'tourism'],
  },
  {
    id: 'intl_airport', name: 'International Airport', icon: '✈️', category: 'transit', group: 'Air',
    description: 'A sweeping glass terminal, jet bridges, a control tower and a long runway. Connects your metropolis to the world.',
    w: 16, h: 10, cost: 920_000, upkeep: 28_000, unlock: 10, model: 'intl_airport', height: 48, jobs: 900,
    placement: { unique: true }, effects: [fx('tourism', 40, 255), fx('noise', 30, 220), fx('landValue', 16, -50)], tags: ['transit', 'airport', 'planes', 'jets', 'air', 'tourism', 'unique'],
  },

  // ══ GOVERNMENT ════════════════════════════════════════════════════════════
  {
    id: 'city_hall', name: 'City Hall', icon: '🏛️', category: 'government', group: 'Civic',
    description: 'The seat of your administration, in the city\'s own architectural style. Citizens feel proud to live nearby.',
    w: 3, h: 3, cost: 15_000, upkeep: 400, unlock: 0, model: 'city_hall', height: 30, jobs: 40,
    placement: { unique: true }, effects: [fx('landValue', 16, 70), fx('happiness', 18, 40), fx('tourism', 12, 30)], attractiveness: 20, tags: ['government', 'city hall', 'mayor', 'civic', 'unique'],
  },
  {
    id: 'courthouse', name: 'Courthouse', icon: '⚖️', category: 'government', group: 'Civic',
    description: 'A neoclassical hall of justice with a grand stair. Swift trials help the police keep order.',
    w: 3, h: 2, cost: 26_000, upkeep: 1_000, unlock: 4, model: 'courthouse', height: 22, jobs: 50,
    effects: [fx('police', 22, 60), fx('landValue', 12, 40)], tags: ['government', 'court', 'justice', 'law', 'civic'],
  },
  {
    id: 'tax_office', name: 'Tax Office', icon: '🧾', category: 'government', group: 'Civic',
    description: 'Accountants and auditors in a sober office block. Nobody loves it, but it keeps the books straight.',
    w: 2, h: 2, cost: 12_000, upkeep: 500, unlock: 4, model: 'tax_office', height: 20, jobs: 40,
    effects: [fx('landValue', 6, 10)], tags: ['government', 'tax', 'office', 'civic'],
  },
  {
    id: 'embassy', name: 'Embassy Row', icon: '🏳️', category: 'government', group: 'Civic',
    description: 'Elegant consulates behind wrought-iron gates, flags fluttering. Brings prestige and foreign visitors.',
    w: 3, h: 2, cost: 82_000, upkeep: 2_000, unlock: 8, model: 'embassy', height: 18, jobs: 60,
    placement: { unique: true }, effects: [fx('tourism', 20, 80), fx('landValue', 14, 80)], attractiveness: 15, tags: ['government', 'embassy', 'diplomacy', 'flags', 'unique'],
  },
  {
    id: 'post_office', name: 'Post Office', icon: '📮', category: 'government', group: 'Postal',
    description: 'Parcels, letters and a fleet of delivery vans. Happy customers, happy businesses.',
    w: 2, h: 2, cost: 9_000, upkeep: 420, unlock: 3, model: 'post_office', height: 11, jobs: 30,
    vehicles: { type: 'van', count: 6 }, effects: [fx('happiness', 18, 25), fx('landValue', 10, 20)], tags: ['government', 'post', 'mail', 'parcels'],
  },
  {
    id: 'sorting_facility', name: 'Post Sorting Facility', icon: '📦', category: 'government', group: 'Postal',
    description: 'Conveyor mazes sort a million parcels a day. Supercharges every post office in the city.',
    w: 4, h: 3, cost: 32_000, upkeep: 1_300, unlock: 5, model: 'sorting_facility', height: 14, jobs: 90,
    vehicles: { type: 'truck', count: 10 }, effects: [fx('happiness', 30, 20), fx('noise', 8, 80)], tags: ['government', 'post', 'mail', 'parcels', 'logistics'],
  },
  {
    id: 'radio_mast', name: 'Radio Mast', icon: '📡', category: 'government', group: 'Infrastructure',
    description: 'A guyed steel lattice mast broadcasting local radio and emergency alerts, beacons blinking at night.',
    w: 1, h: 1, cost: 4_000, upkeep: 120, unlock: 2, model: 'radio_mast', height: 120, jobs: 2,
    effects: [fx('happiness', 26, 20)], tags: ['government', 'radio', 'antenna', 'broadcast', 'mast'],
  },

  // ══ DISASTER RESPONSE ═════════════════════════════════════════════════════
  {
    id: 'emergency_shelter', name: 'Emergency Shelter', icon: '🛡️', category: 'disaster', group: 'Preparedness',
    description: 'A bunker-like hall stocked with food, water and cots. Citizens take refuge here during disasters.',
    w: 3, h: 2, cost: 15_000, upkeep: 500, unlock: 6, model: 'emergency_shelter', height: 8, jobs: 10,
    capacity: 1_500, capacityLabel: 'evacuees', tags: ['disaster', 'shelter', 'bunker', 'evacuation'],
  },
  {
    id: 'disaster_response', name: 'Disaster Response Unit', icon: '🚧', category: 'disaster', group: 'Response',
    description: 'Search-and-rescue teams, heavy lifting gear and drones. Clears rubble and saves lives after catastrophes.',
    w: 3, h: 3, cost: 42_000, upkeep: 1_600, unlock: 6, model: 'disaster_response', height: 14, jobs: 50,
    vehicles: { type: 'service', count: 6 }, effects: [fx('fire', 30, 50)], tags: ['disaster', 'rescue', 'rubble', 'response'],
  },
  {
    id: 'early_warning', name: 'Early Warning Siren', icon: '📢', category: 'disaster', group: 'Preparedness',
    description: 'A solar-powered siren tower that alerts citizens to incoming storms, floods and quakes.',
    w: 1, h: 1, cost: 6_000, upkeep: 150, unlock: 6, model: 'early_warning', height: 20, jobs: 1,
    tags: ['disaster', 'siren', 'alarm', 'warning'],
  },
  {
    id: 'weather_radar', name: 'Weather Radar Station', icon: '🛰️', category: 'disaster', group: 'Preparedness',
    description: 'A white radome on a tower tracks every storm cell. Forecasts give the city time to prepare.',
    w: 2, h: 2, cost: 28_000, upkeep: 900, unlock: 6, model: 'weather_radar', height: 32, jobs: 8,
    tags: ['disaster', 'radar', 'weather', 'forecast', 'storm'],
  },
  {
    id: 'tsunami_buoys', name: 'Tsunami Warning Buoys', icon: '🛟', category: 'disaster', group: 'Preparedness',
    description: 'A shore station linked to deep-ocean pressure buoys. Buys precious minutes before a wave arrives.',
    w: 2, h: 2, cost: 22_000, upkeep: 800, unlock: 7, model: 'tsunami_buoys', height: 14, jobs: 6,
    placement: { shore: true }, tags: ['disaster', 'tsunami', 'buoy', 'sea', 'warning', 'shore'],
  },

  // ══ LANDMARKS (unique) ════════════════════════════════════════════════════
  {
    id: 'clock_tower', name: 'Clock Tower', icon: '🕰️', category: 'landmark', group: 'Historic',
    description: 'A 55 m campanile with four illuminated clock faces and a bronze bell that chimes the hours.',
    w: 2, h: 2, cost: 110_000, upkeep: 1_200, unlock: 7, model: 'clock_tower', height: 56,
    placement: { unique: true }, effects: [fx('tourism', 20, 90), fx('landValue', 14, 70)], attractiveness: 30, tags: ['landmark', 'clock', 'tower', 'bell', 'historic', 'unique'],
  },
  {
    id: 'lighthouse', name: 'Lighthouse', icon: '💡', category: 'landmark', group: 'Historic',
    description: 'A red-and-white striped lighthouse whose rotating beam sweeps the sea every night.',
    w: 2, h: 2, cost: 115_000, upkeep: 1_100, unlock: 7, model: 'lighthouse', height: 44,
    placement: { unique: true, shore: true }, effects: [fx('tourism', 22, 100), fx('landValue', 12, 60)], attractiveness: 30, tags: ['landmark', 'lighthouse', 'sea', 'beacon', 'coast', 'unique', 'shore'],
  },
  {
    id: 'city_gate', name: 'City Gate Arch', icon: '⛩️', category: 'landmark', group: 'Historic',
    description: 'A triumphal arch of carved stone welcoming visitors to the city. Traffic may pass beneath its vault.',
    w: 3, h: 2, cost: 140_000, upkeep: 1_000, unlock: 7, model: 'city_gate', height: 36,
    placement: { unique: true }, effects: [fx('tourism', 24, 110), fx('landValue', 14, 70)], attractiveness: 35, tags: ['landmark', 'arch', 'gate', 'triumph', 'unique'],
  },
  {
    id: 'castle', name: 'Hilltop Castle', icon: '🏰', category: 'landmark', group: 'Historic',
    description: 'Curtain walls, round towers and a mighty keep. Loves a hilltop, and tourists love it back.',
    w: 5, h: 5, cost: 260_000, upkeep: 3_000, unlock: 7, model: 'castle', height: 46, jobs: 30,
    placement: { unique: true, maxSlope: 0.6 }, effects: [fx('tourism', 34, 180), fx('landValue', 16, 70)], attractiveness: 40, tags: ['landmark', 'castle', 'medieval', 'historic', 'unique'],
  },
  {
    id: 'grand_hotel', name: 'Grand Hotel', icon: '🛎️', category: 'landmark', group: 'Culture',
    description: 'A Belle Époque palace hotel with a green copper mansard, a ballroom and a doorman in white gloves.',
    w: 3, h: 3, cost: 180_000, upkeep: 2_600, unlock: 7, model: 'grand_hotel', height: 42, jobs: 120,
    placement: { unique: true }, effects: [fx('tourism', 28, 150), fx('landValue', 16, 90)], attractiveness: 30, tags: ['landmark', 'hotel', 'luxury', 'historic', 'unique'],
  },
  {
    id: 'art_museum', name: 'Art Museum', icon: '🖼️', category: 'landmark', group: 'Culture',
    description: 'A deconstructivist gallery of titanium curves housing masterpieces from every age.',
    w: 4, h: 3, cost: 220_000, upkeep: 3_400, unlock: 8, model: 'art_museum', height: 30, jobs: 70,
    placement: { unique: true }, effects: [fx('tourism', 30, 170), fx('education', 20, 60), fx('landValue', 16, 90)], attractiveness: 35, tags: ['landmark', 'museum', 'art', 'gallery', 'culture', 'unique'],
  },
  {
    id: 'observation_tower', name: 'Iron Observation Tower', icon: '🗼', category: 'landmark', group: 'Towers',
    description: 'A 160 m wrought-iron lattice tower with three viewing platforms. Sparkles with lights on the hour.',
    w: 3, h: 3, cost: 190_000, upkeep: 2_200, unlock: 8, model: 'observation_tower', height: 162, jobs: 30,
    placement: { unique: true }, effects: [fx('tourism', 34, 180), fx('landValue', 16, 80)], attractiveness: 40, tags: ['landmark', 'tower', 'iron', 'lattice', 'view', 'unique'],
  },
  {
    id: 'planetarium', name: 'Planetarium', icon: '🔭', category: 'landmark', group: 'Culture',
    description: 'A silver dome projecting the night sky, with an observatory telescope on the terrace.',
    w: 3, h: 3, cost: 200_000, upkeep: 2_800, unlock: 8, model: 'planetarium', height: 26, jobs: 40,
    placement: { unique: true }, effects: [fx('tourism', 26, 130), fx('education', 22, 90), fx('landValue', 12, 60)], attractiveness: 30, tags: ['landmark', 'planetarium', 'stars', 'space', 'science', 'unique'],
  },
  {
    id: 'casino', name: 'Casino Royale', icon: '🎰', category: 'landmark', group: 'Sports & Entertainment',
    description: 'Neon, fountains and a golden tower. The house always wins — and so do your tourism numbers.',
    w: 4, h: 3, cost: 260_000, upkeep: 3_600, unlock: 8, model: 'casino', height: 60, jobs: 180,
    placement: { unique: true }, effects: [fx('tourism', 32, 190), fx('noise', 8, 60), fx('crime', 10, 30)], attractiveness: 25, tags: ['landmark', 'casino', 'neon', 'nightlife', 'unique'],
  },
  {
    id: 'convention_center', name: 'Convention Center', icon: '🎪', category: 'landmark', group: 'Sports & Entertainment',
    description: 'A vast hall under a wave-shaped roof hosting trade fairs, comic cons and world summits.',
    w: 6, h: 4, cost: 320_000, upkeep: 4_200, unlock: 7, model: 'convention_center', height: 30, jobs: 160,
    placement: { unique: true }, effects: [fx('tourism', 36, 170), fx('landValue', 14, 60)], attractiveness: 25, tags: ['landmark', 'convention', 'expo', 'business', 'unique'],
  },
  {
    id: 'opera_house', name: 'Opera House', icon: '🎭', category: 'landmark', group: 'Culture',
    description: 'Gleaming white shell roofs rise like sails over the concert halls. An icon of the city skyline.',
    w: 5, h: 4, cost: 380_000, upkeep: 4_800, unlock: 7, model: 'opera_house', height: 45, jobs: 110,
    placement: { unique: true }, effects: [fx('tourism', 40, 220), fx('landValue', 20, 110), fx('leisure', 16, 90)], attractiveness: 45, tags: ['landmark', 'opera', 'music', 'shells', 'culture', 'unique'],
  },
  {
    id: 'stadium', name: 'Stadium', icon: '🏟️', category: 'landmark', group: 'Sports & Entertainment',
    description: 'A 60,000-seat bowl with floodlight masts and a roaring crowd on match days.',
    w: 8, h: 7, cost: 420_000, upkeep: 5_400, unlock: 7, model: 'stadium', height: 48, jobs: 200,
    placement: { unique: true }, effects: [fx('tourism', 40, 220), fx('leisure', 24, 150), fx('noise', 14, 130)], attractiveness: 30, tags: ['landmark', 'stadium', 'football', 'sports', 'unique'],
  },
  {
    id: 'cathedral', name: 'Grand Cathedral', icon: '⛪', category: 'landmark', group: 'Historic',
    description: 'Twin Gothic spires, flying buttresses and a great rose window. Centuries of craftsmanship, built in years.',
    w: 4, h: 6, cost: 300_000, upkeep: 3_200, unlock: 7, model: 'cathedral', height: 92, jobs: 20,
    placement: { unique: true }, effects: [fx('tourism', 36, 200), fx('landValue', 18, 90), fx('happiness', 20, 40)], attractiveness: 45, tags: ['landmark', 'cathedral', 'church', 'gothic', 'historic', 'unique'],
  },
  {
    id: 'arena', name: 'Sports Arena', icon: '🎤', category: 'landmark', group: 'Sports & Entertainment',
    description: 'An indoor arena under a glowing LED skin. Basketball, ice hockey and sold-out concerts.',
    w: 5, h: 5, cost: 280_000, upkeep: 3_800, unlock: 8, model: 'arena', height: 36, jobs: 140,
    placement: { unique: true }, effects: [fx('tourism', 32, 170), fx('leisure', 20, 120), fx('noise', 10, 90)], attractiveness: 25, tags: ['landmark', 'arena', 'concert', 'sports', 'unique'],
  },
  {
    id: 'aquarium', name: 'Aquarium', icon: '🐠', category: 'landmark', group: 'Culture',
    description: 'Wave-shaped halls on the water\'s edge with a walk-through shark tunnel. Must be built on the shore.',
    w: 4, h: 3, cost: 240_000, upkeep: 3_400, unlock: 8, model: 'aquarium', height: 24, jobs: 90,
    placement: { unique: true, shore: true }, effects: [fx('tourism', 34, 190), fx('education', 20, 60), fx('leisure', 18, 100)], attractiveness: 35, tags: ['landmark', 'aquarium', 'fish', 'sea', 'family', 'unique', 'shore'],
  },
  {
    id: 'central_station', name: 'Central Station', icon: '🚆', category: 'landmark', group: 'Culture',
    description: 'A monumental terminus with an arched iron-and-glass train shed and a clock-faced stone facade. Needs a railway alongside.',
    w: 6, h: 4, cost: 450_000, upkeep: 5_500, unlock: 9, model: 'central_station', height: 40, jobs: 120,
    vehicles: { type: 'train', count: 4 }, placement: { unique: true, rail: true },
    effects: [fx('transit', 28, 255), fx('tourism', 30, 140), fx('landValue', 16, 70)], attractiveness: 25, tags: ['landmark', 'station', 'train', 'rail', 'transit', 'unique'],
  },
  {
    id: 'botanical_dome', name: 'Botanical Dome', icon: '🪴', category: 'landmark', group: 'Culture',
    description: 'A glass cloud-forest dome with a misty waterfall and a canopy walkway. Tropical paradise in any climate.',
    w: 5, h: 5, cost: 260_000, upkeep: 3_600, unlock: 8, model: 'botanical_dome', height: 42, jobs: 60,
    placement: { unique: true }, effects: [fx('tourism', 32, 180), fx('leisure', 20, 140), fx('landValue', 16, 80)], attractiveness: 40, tags: ['landmark', 'dome', 'greenhouse', 'jungle', 'plants', 'unique'],
  },
  {
    id: 'tv_tower', name: 'TV Tower', icon: '📺', category: 'landmark', group: 'Towers',
    description: 'A 365 m concrete shaft crowned by a steel sphere with a revolving restaurant. Broadcasts to the whole region.',
    w: 2, h: 2, cost: 350_000, upkeep: 3_800, unlock: 9, model: 'tv_tower', height: 365, jobs: 40,
    placement: { unique: true }, effects: [fx('tourism', 40, 200), fx('happiness', 40, 25), fx('landValue', 14, 60)], attractiveness: 40, tags: ['landmark', 'tower', 'tv', 'broadcast', 'view', 'unique'],
  },
  {
    id: 'sky_needle', name: 'Sky Needle', icon: '🪡', category: 'landmark', group: 'Towers',
    description: 'A 520 m lattice spire with twin sky-decks, the tallest structure in the land. Visible from every corner of the map.',
    w: 3, h: 3, cost: 600_000, upkeep: 6_000, unlock: 9, model: 'sky_needle', height: 520, jobs: 60,
    placement: { unique: true }, effects: [fx('tourism', 50, 240), fx('landValue', 20, 100)], attractiveness: 50, tags: ['landmark', 'tower', 'spire', 'tallest', 'view', 'unique'],
  },

  // ══ MONUMENTS (late-game wonders) ═════════════════════════════════════════
  {
    id: 'grand_library', name: 'Grand Library', icon: '📜', category: 'monument', group: 'Wonders',
    description: 'A domed temple of knowledge holding every book ever written. Education soars across the entire city.',
    w: 5, h: 5, cost: 1_200_000, upkeep: 12_000, unlock: 9, model: 'grand_library', height: 60, jobs: 120,
    placement: { unique: true }, effects: [fx('education', 80, 200), fx('tourism', 40, 180), fx('landValue', 20, 100)], attractiveness: 50, tags: ['monument', 'library', 'wonder', 'dome', 'unique'],
  },
  {
    id: 'expo_tower', name: 'Expo Tower', icon: '🌐', category: 'monument', group: 'Wonders',
    description: 'A 300 m twisting helix of glass built for the World Expo. Pure spectacle.',
    w: 3, h: 3, cost: 1_500_000, upkeep: 14_000, unlock: 9, model: 'expo_tower', height: 300, jobs: 80,
    placement: { unique: true }, effects: [fx('tourism', 60, 230), fx('landValue', 24, 120)], attractiveness: 55, tags: ['monument', 'expo', 'twist', 'tower', 'wonder', 'unique'],
  },
  {
    id: 'colossus', name: 'The Colossus', icon: '🗽', category: 'monument', group: 'Wonders',
    description: 'A 110 m bronze giant holding a torch aloft over the city. The ultimate symbol of civic pride.',
    w: 4, h: 4, cost: 1_800_000, upkeep: 10_000, unlock: 10, model: 'colossus', height: 112,
    placement: { unique: true }, effects: [fx('tourism', 70, 240), fx('happiness', 60, 60), fx('landValue', 20, 100)], attractiveness: 60, tags: ['monument', 'statue', 'colossus', 'torch', 'wonder', 'unique'],
  },
  {
    id: 'supercomputer', name: 'Supercomputer Center', icon: '🖥️', category: 'monument', group: 'Wonders',
    description: 'Exascale server halls cooled by a lake of water, crowned by glowing data towers. Optimises everything.',
    w: 5, h: 4, cost: 2_200_000, upkeep: 18_000, unlock: 10, model: 'supercomputer', height: 44, power: -60, jobs: 260,
    placement: { unique: true }, effects: [fx('education', 60, 160), fx('landValue', 30, 90), fx('tourism', 30, 90)], attractiveness: 30, tags: ['monument', 'computer', 'ai', 'data', 'wonder', 'unique'],
  },
  {
    id: 'hanging_gardens', name: 'Hanging Gardens', icon: '🌿', category: 'monument', group: 'Wonders',
    description: 'Terraces overflowing with greenery and cascading waterfalls, reborn as a modern ziggurat.',
    w: 5, h: 5, cost: 2_000_000, upkeep: 12_000, unlock: 10, model: 'hanging_gardens', height: 55, jobs: 80,
    placement: { unique: true }, effects: [fx('leisure', 60, 220), fx('tourism', 60, 220), fx('pollution', 20, -120), fx('landValue', 24, 110)], attractiveness: 60, tags: ['monument', 'gardens', 'waterfall', 'green', 'wonder', 'unique'],
  },
  {
    id: 'eden_domes', name: 'Eden Biomes', icon: '🌍', category: 'monument', group: 'Wonders',
    description: 'Interlocking geodesic domes housing rainforest and desert biomes. A living ark for the planet.',
    w: 7, h: 6, cost: 2_800_000, upkeep: 16_000, unlock: 11, model: 'eden_domes', height: 50, jobs: 140,
    placement: { unique: true }, effects: [fx('tourism', 70, 240), fx('leisure', 50, 200), fx('pollution', 24, -140), fx('education', 40, 80)], attractiveness: 60, tags: ['monument', 'dome', 'geodesic', 'biome', 'eco', 'wonder', 'unique'],
  },
  {
    id: 'arcology', name: 'Arcology', icon: '🏔️', category: 'monument', group: 'Wonders',
    description: 'A self-contained terraced mountain city of 50,000 souls, wrapped in gardens and solar glass.',
    w: 8, h: 8, cost: 4_500_000, upkeep: 30_000, unlock: 11, model: 'arcology', height: 360, power: -120, water: -3_000, jobs: 12_000,
    capacity: 50_000, capacityLabel: 'residents', placement: { unique: true }, effects: [fx('tourism', 80, 240), fx('landValue', 30, 140), fx('happiness', 60, 60)], attractiveness: 60, tags: ['monument', 'arcology', 'megastructure', 'futuristic', 'wonder', 'unique'],
  },
  {
    id: 'fusion_megaproject', name: 'Helios Ignition Facility', icon: '🌞', category: 'monument', group: 'Wonders',
    description: 'A thousand lasers converge on a target the size of a peppercorn to ignite a star on Earth. Powers an entire civilisation.',
    w: 8, h: 8, cost: 5_000_000, upkeep: 60_000, unlock: 12, model: 'fusion_megaproject', height: 90, power: 6_000, jobs: 900,
    placement: { unique: true }, effects: [fx('tourism', 60, 180), fx('education', 60, 120)], attractiveness: 30, tags: ['monument', 'fusion', 'laser', 'energy', 'wonder', 'unique', 'electricity'],
  },
  {
    id: 'wonder_pyramid', name: 'Pyramid of Light', icon: '🔺', category: 'monument', group: 'Wonders',
    description: 'A 140 m pyramid of mirrored glass whose apex fires a beam of light into the night sky.',
    w: 8, h: 8, cost: 4_000_000, upkeep: 20_000, unlock: 12, model: 'wonder_pyramid', height: 140, jobs: 300,
    placement: { unique: true }, effects: [fx('tourism', 90, 255), fx('landValue', 28, 130), fx('happiness', 60, 50)], attractiveness: 60, tags: ['monument', 'pyramid', 'beam', 'glass', 'wonder', 'unique'],
  },
  {
    id: 'space_elevator', name: 'Space Elevator', icon: '🚀', category: 'monument', group: 'Wonders',
    description: 'A carbon-nanotube tether rising from a vast anchor station into orbit, climbers gliding up it day and night. Humanity\'s stairway to the stars.',
    w: 6, h: 6, cost: 6_000_000, upkeep: 50_000, unlock: 12, model: 'space_elevator', height: 820, power: -200, jobs: 1_500,
    placement: { unique: true }, effects: [fx('tourism', 120, 255), fx('landValue', 40, 160), fx('happiness', 120, 60), fx('education', 60, 100)], attractiveness: 70, tags: ['monument', 'space', 'elevator', 'orbit', 'wonder', 'unique'],
  },

  // ══ TOURISM & LEISURE ═════════════════════════════════════════════════════
  {
    id: 'visitor_center', name: 'Visitor Center', icon: 'ℹ️', category: 'tourism', group: 'Visitors',
    description: 'Maps, guided tours and souvenirs. Helps tourists discover everything the city has to offer.',
    w: 2, h: 2, cost: 12_000, upkeep: 420, unlock: 3, model: 'visitor_center', height: 9, jobs: 12,
    effects: [fx('tourism', 24, 90), fx('leisure', 8, 40)], tags: ['tourism', 'information', 'tours', 'souvenirs'],
  },
  {
    id: 'hotel', name: 'Hotel', icon: '🏨', category: 'tourism', group: 'Hotels',
    description: 'A comfortable mid-rise hotel with a rooftop bar. More beds mean more tourists staying longer.',
    w: 2, h: 3, cost: 24_000, upkeep: 600, unlock: 4, model: 'hotel', height: 38, jobs: 50,
    capacity: 240, capacityLabel: 'guests', effects: [fx('tourism', 16, 120)], tags: ['tourism', 'hotel', 'rooms', 'guests'],
  },
  {
    id: 'resort', name: 'Resort Hotel', icon: '🌴', category: 'tourism', group: 'Hotels',
    description: 'A terraced luxury resort wrapped around a lagoon pool, cabanas and a spa.',
    w: 5, h: 4, cost: 92_000, upkeep: 2_600, unlock: 6, model: 'resort', height: 30, jobs: 140,
    capacity: 600, capacityLabel: 'guests', effects: [fx('tourism', 26, 170), fx('leisure', 12, 80), fx('landValue', 14, 60)], tags: ['tourism', 'resort', 'pool', 'luxury'],
  },
  {
    id: 'beach_resort', name: 'Beach Resort', icon: '🏝️', category: 'tourism', group: 'Hotels',
    description: 'Overwater bungalows on stilts, a white-sand beach and a curving hotel wing. Paradise found.',
    w: 5, h: 3, cost: 115_000, upkeep: 3_000, unlock: 6, model: 'beach_resort', height: 24, jobs: 150,
    capacity: 500, capacityLabel: 'guests', placement: { shore: true }, effects: [fx('tourism', 30, 190), fx('leisure', 14, 90), fx('landValue', 16, 80)], tags: ['tourism', 'beach', 'resort', 'bungalows', 'sea', 'shore'],
  },
  {
    id: 'theme_hotel', name: 'Ocean Liner Hotel', icon: '🛳️', category: 'tourism', group: 'Hotels',
    description: 'A hotel built in the shape of a grand 1930s ocean liner — funnels, lifeboats and all — permanently moored on dry land.',
    w: 3, h: 5, cost: 150_000, upkeep: 3_400, unlock: 7, model: 'theme_hotel', height: 40, jobs: 160,
    capacity: 700, capacityLabel: 'guests', effects: [fx('tourism', 30, 180), fx('leisure', 14, 80)], attractiveness: 20, tags: ['tourism', 'hotel', 'ship', 'themed', 'liner'],
  },

  // ══ INDUSTRY FACILITIES ═══════════════════════════════════════════════════
  {
    id: 'farm_coop', name: 'Farm Cooperative', icon: '🚜', category: 'industry', group: 'Resource',
    description: 'Shared grain silos, a machinery barn and a farmers\' market. Place on fertile land to boost the farming industry.',
    w: 4, h: 4, cost: 30_000, upkeep: 1_100, unlock: 3, model: 'farm_coop', height: 26, jobs: 40,
    placement: { resource: 'fertility' }, effects: [fx('landValue', 6, 10)], tags: ['industry', 'farming', 'silo', 'barn', 'agriculture'],
  },
  {
    id: 'lumber_yard', name: 'Lumber Yard', icon: '🪵', category: 'industry', group: 'Resource',
    description: 'Log decks, a sawmill and drying kilns. Place near forests to boost the forestry industry.',
    w: 4, h: 4, cost: 28_000, upkeep: 1_000, unlock: 3, model: 'lumber_yard', height: 18, jobs: 45,
    placement: { resource: 'forest' }, effects: [fx('noise', 8, 100), fx('pollution', 5, 40)], tags: ['industry', 'forestry', 'wood', 'sawmill', 'timber'],
  },
  {
    id: 'ore_processing', name: 'Ore Processing Plant', icon: '⛏️', category: 'industry', group: 'Resource',
    description: 'A headframe, crushers and conveyor galleries feeding ore bins. Place on ore deposits to boost mining.',
    w: 4, h: 4, cost: 40_000, upkeep: 1_500, unlock: 3, model: 'ore_processing', height: 32, jobs: 60,
    placement: { resource: 'ore' }, effects: [fx('noise', 10, 130), fx('pollution', 8, 110), fx('landValue', 8, -40)], tags: ['industry', 'mining', 'ore', 'crusher', 'conveyor'],
  },
  {
    id: 'oil_refinery', name: 'Oil Refinery', icon: '🏗️', category: 'industry', group: 'Resource',
    description: 'Distillation columns, cracking units and a flare stack that burns day and night. Place on oil fields to boost the oil industry.',
    w: 5, h: 5, cost: 72_000, upkeep: 2_800, unlock: 4, model: 'oil_refinery', height: 55, jobs: 90,
    placement: { resource: 'oil' }, effects: [fx('pollution', 12, 160), fx('noise', 10, 120), fx('landValue', 10, -60)], tags: ['industry', 'oil', 'refinery', 'petrochemical', 'flare'],
  },
  {
    id: 'industrial_hq', name: 'Industrial Headquarters', icon: '🏢', category: 'industry', group: 'Logistics',
    description: 'The corporate HQ of your industrial conglomerate: glass tower, R&D wing and a logo that glows at night.',
    w: 3, h: 3, cost: 62_000, upkeep: 1_800, unlock: 5, model: 'industrial_hq', height: 60, jobs: 300,
    placement: { unique: true }, effects: [fx('landValue', 10, 30), fx('education', 14, 30)], tags: ['industry', 'headquarters', 'office', 'corporate', 'unique'],
  },
  {
    id: 'logistics_hub', name: 'Logistics Hub', icon: '🚚', category: 'industry', group: 'Logistics',
    description: 'Cross-dock warehouses with dozens of loading bays and container stacks. Speeds goods to shops across the city.',
    w: 6, h: 4, cost: 82_000, upkeep: 2_600, unlock: 5, model: 'logistics_hub', height: 16, jobs: 160,
    vehicles: { type: 'truck', count: 16 }, effects: [fx('noise', 12, 130), fx('pollution', 6, 50)], tags: ['industry', 'logistics', 'warehouse', 'trucks', 'goods'],
  },
];

const byId = new Map<string, BuildingDef>();
for (const b of BUILDINGS) byId.set(b.id, b);

export function buildingDef(id: string): BuildingDef | undefined {
  return byId.get(id);
}

export interface CategoryInfo {
  name: string;
  icon: string;
  /** BudgetCategory the building's upkeep is charged to */
  budget: string;
  /** toolbar ordering (lower first) */
  order: number;
  /** one-line summary for toolbar tooltips */
  description: string;
  /** suggested toolbar tab (several categories may share one tab) */
  tab: 'power' | 'water' | 'garbage' | 'health' | 'fire' | 'police' | 'education' | 'parks' | 'transit' | 'government' | 'landmarks';
  /** accent colour for UI chips (hex) */
  color: string;
  /** ordered sub-groups (BuildingDef.group values) */
  groups: string[];
}

export const CATEGORY_INFO: Record<BuildingCategory, CategoryInfo> = {
  power: { name: 'Electricity', icon: '⚡', budget: 'power', order: 0, tab: 'power', color: '#f2c230', description: 'Power plants feed the grid along your roads.', groups: ['Renewable', 'Fossil Fuel', 'Advanced'] },
  water: { name: 'Water & Sewage', icon: '💧', budget: 'water', order: 1, tab: 'water', color: '#2f8fff', description: 'Pump fresh water in and carry sewage away.', groups: ['Supply', 'Sewage'] },
  garbage: { name: 'Garbage', icon: '🗑️', budget: 'garbage', order: 2, tab: 'garbage', color: '#8d7b52', description: 'Collect, bury, burn or recycle the city\'s waste.', groups: ['Disposal', 'Processing'] },
  health: { name: 'Healthcare', icon: '🏥', budget: 'health', order: 3, tab: 'health', color: '#e8505b', description: 'Clinics and hospitals keep citizens healthy.', groups: ['Care', 'Specialist', 'Emergency'] },
  deathcare: { name: 'Deathcare', icon: '⚱️', budget: 'deathcare', order: 4, tab: 'health', color: '#8a86a8', description: 'Cemeteries and crematoria take care of the departed.', groups: ['Deathcare'] },
  fire: { name: 'Fire Department', icon: '🚒', budget: 'fire', order: 5, tab: 'fire', color: '#e5452f', description: 'Fire coverage stops blazes before they spread.', groups: ['Stations', 'Aerial & Watch'] },
  police: { name: 'Police', icon: '🚓', budget: 'police', order: 6, tab: 'police', color: '#3a6fd8', description: 'Police coverage keeps crime down.', groups: ['Stations', 'Justice', 'Special'] },
  education: { name: 'Education', icon: '🎓', budget: 'education', order: 7, tab: 'education', color: '#f0a33a', description: 'Schools and universities build a skilled workforce.', groups: ['Schools', 'Higher Education', 'Culture & Research'] },
  parks: { name: 'Parks & Recreation', icon: '🌳', budget: 'parks', order: 8, tab: 'parks', color: '#46b35a', description: 'Parks raise land value, happiness and leisure.', groups: ['Neighbourhood', 'Sports', 'Attractions', 'Nature', 'Waterfront'] },
  plazas: { name: 'Plazas & Decor', icon: '⛲', budget: 'parks', order: 9, tab: 'parks', color: '#7cc7b2', description: 'Small squares and ornaments that make streets lovely.', groups: ['Plazas', 'Decor'] },
  transit: { name: 'Public Transport', icon: '🚌', budget: 'transit', order: 10, tab: 'transit', color: '#29b6c9', description: 'Depots, stations, ports and airports move people and goods.', groups: ['Road', 'Rail', 'Water', 'Air'] },
  government: { name: 'Government', icon: '🏛️', budget: 'government', order: 11, tab: 'government', color: '#b58ad8', description: 'Civic buildings, postal services and infrastructure.', groups: ['Civic', 'Postal', 'Infrastructure'] },
  disaster: { name: 'Disaster Response', icon: '🚨', budget: 'disaster', order: 12, tab: 'government', color: '#ff7a3a', description: 'Prepare for storms, floods and quakes — and recover faster.', groups: ['Preparedness', 'Response'] },
  landmark: { name: 'Landmarks', icon: '🗽', budget: 'parks', order: 13, tab: 'landmarks', color: '#e0b84a', description: 'Unique showpieces unlocked by milestones. Tourists flock to them.', groups: ['Historic', 'Culture', 'Towers', 'Sports & Entertainment'] },
  monument: { name: 'Monuments', icon: '🏆', budget: 'parks', order: 14, tab: 'landmarks', color: '#ffd76a', description: 'Late-game wonders with city-wide effects.', groups: ['Wonders'] },
  tourism: { name: 'Tourism & Leisure', icon: '🎡', budget: 'parks', order: 15, tab: 'parks', color: '#ff8fb1', description: 'Hotels and attractions that bring visitors and their money.', groups: ['Hotels', 'Visitors'] },
  industry: { name: 'Industry Facilities', icon: '🏗️', budget: 'government', order: 16, tab: 'government', color: '#c9a227', description: 'Unique facilities that boost specialised industry.', groups: ['Resource', 'Logistics'] },
};

/** All catalog entries of a category, in catalog order. */
export function buildingsInCategory(cat: BuildingCategory): BuildingDef[] {
  return BUILDINGS.filter((b) => b.category === cat);
}

/** Category entries split by sub-group in CATEGORY_INFO order (ungrouped last). */
export function buildingGroups(cat: BuildingCategory): { group: string; defs: BuildingDef[] }[] {
  const defs = buildingsInCategory(cat);
  const out: { group: string; defs: BuildingDef[] }[] = [];
  for (const g of CATEGORY_INFO[cat].groups) {
    const list = defs.filter((d) => d.group === g);
    if (list.length) out.push({ group: g, defs: list });
  }
  const rest = defs.filter((d) => !d.group || !CATEGORY_INFO[cat].groups.includes(d.group));
  if (rest.length) out.push({ group: 'Other', defs: rest });
  return out;
}

/** Case-insensitive search over name, id, category, group, tags and description. */
export function searchBuildings(query: string): BuildingDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: { d: BuildingDef; s: number }[] = [];
  for (const d of BUILDINGS) {
    const name = d.name.toLowerCase();
    const hay = `${name} ${d.id} ${d.category} ${CATEGORY_INFO[d.category].name} ${d.group ?? ''} ${(d.tags ?? []).join(' ')} ${d.description}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    if (name === q) s += 100;
    if (name.startsWith(q)) s += 50;
    if (name.includes(q)) s += 20;
    for (const w of words) if ((d.tags ?? []).some((t) => t.startsWith(w))) s += 5;
    scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s || a.d.cost - b.d.cost);
  return scored.map((x) => x.d);
}
