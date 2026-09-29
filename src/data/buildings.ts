// STUB catalog — owned by the "buildings-service" agent (will be expanded to the full catalog).
import type { BuildingDef, BuildingCategory } from '../core/types';

export const BUILDINGS: BuildingDef[] = [
  { id: 'wind_turbine', name: 'Wind Turbine', description: 'Clean power that depends on wind.', icon: '🌬️', category: 'power', w: 1, h: 1, cost: 2700, upkeep: 80, unlock: 0, model: 'wind_turbine', height: 60, power: 8, jobs: 1, effects: [{ field: 'noise', radius: 4, amount: 60 }] },
  { id: 'coal_plant', name: 'Coal Power Plant', description: 'Cheap, reliable and filthy.', icon: '🏭', category: 'power', w: 4, h: 4, cost: 18000, upkeep: 900, unlock: 0, model: 'coal_plant', height: 45, power: 40, jobs: 40, effects: [{ field: 'pollution', radius: 14, amount: 200 }, { field: 'noise', radius: 8, amount: 120 }] },
  { id: 'water_pump', name: 'Water Pumping Station', description: 'Pumps fresh water from a lake or river. Must be on the shore.', icon: '💧', category: 'water', w: 1, h: 2, cost: 2500, upkeep: 90, unlock: 0, model: 'water_pump', height: 8, water: 900, jobs: 3, placement: { shore: true } },
  { id: 'sewage_outlet', name: 'Sewage Outlet', description: 'Dumps untreated sewage into water. Pollutes downstream.', icon: '🚽', category: 'water', w: 1, h: 2, cost: 2000, upkeep: 70, unlock: 0, model: 'sewage_outlet', height: 5, sewage: 900, jobs: 2, placement: { shore: true }, effects: [{ field: 'pollution', radius: 6, amount: 120 }] },
  { id: 'fire_station', name: 'Fire House', description: 'Protects nearby buildings from fire.', icon: '🚒', category: 'fire', w: 2, h: 2, cost: 5500, upkeep: 250, unlock: 1, model: 'fire_station', height: 10, jobs: 15, vehicles: { type: 'firetruck', count: 3 }, effects: [{ field: 'fire', radius: 18, amount: 220 }] },
  { id: 'police_station', name: 'Police Station', description: 'Reduces crime in the neighbourhood.', icon: '🚓', category: 'police', w: 2, h: 2, cost: 6000, upkeep: 280, unlock: 2, model: 'police_station', height: 11, jobs: 18, vehicles: { type: 'police', count: 4 }, effects: [{ field: 'police', radius: 18, amount: 220 }] },
  { id: 'clinic', name: 'Medical Clinic', description: 'Treats the sick nearby.', icon: '🏥', category: 'health', w: 2, h: 2, cost: 6000, upkeep: 300, unlock: 1, model: 'clinic', height: 10, jobs: 20, capacity: 100, capacityLabel: 'patients', vehicles: { type: 'ambulance', count: 3 }, effects: [{ field: 'health', radius: 18, amount: 200 }] },
  { id: 'elementary_school', name: 'Elementary School', description: 'Educates children.', icon: '🏫', category: 'education', w: 2, h: 3, cost: 7000, upkeep: 320, unlock: 2, model: 'elementary_school', height: 10, jobs: 16, capacity: 300, capacityLabel: 'students', effects: [{ field: 'education', radius: 16, amount: 180 }] },
  { id: 'small_park', name: 'Small Park', description: 'A patch of green. Raises land value and happiness.', icon: '🌳', category: 'parks', w: 1, h: 1, cost: 600, upkeep: 20, unlock: 0, model: 'small_park', height: 6, effects: [{ field: 'leisure', radius: 8, amount: 120 }, { field: 'landValue', radius: 8, amount: 40 }] },
  { id: 'landfill', name: 'Landfill Site', description: 'Stores garbage.', icon: '🗑️', category: 'garbage', w: 3, h: 3, cost: 4500, upkeep: 180, unlock: 1, model: 'landfill', height: 6, jobs: 10, capacity: 40000, capacityLabel: 'tons', vehicles: { type: 'garbage', count: 4 }, effects: [{ field: 'garbage', radius: 30, amount: 220 }, { field: 'pollution', radius: 8, amount: 120 }, { field: 'landValue', radius: 10, amount: -60 }] },
];

const byId = new Map<string, BuildingDef>();
for (const b of BUILDINGS) byId.set(b.id, b);

export function buildingDef(id: string): BuildingDef | undefined {
  return byId.get(id);
}

export const CATEGORY_INFO: Record<BuildingCategory, { name: string; icon: string; budget: string }> = {
  power: { name: 'Electricity', icon: '⚡', budget: 'power' },
  water: { name: 'Water & Sewage', icon: '💧', budget: 'water' },
  garbage: { name: 'Garbage', icon: '🗑️', budget: 'garbage' },
  health: { name: 'Healthcare', icon: '🏥', budget: 'health' },
  deathcare: { name: 'Deathcare', icon: '⚱️', budget: 'deathcare' },
  fire: { name: 'Fire Department', icon: '🚒', budget: 'fire' },
  police: { name: 'Police', icon: '🚓', budget: 'police' },
  education: { name: 'Education', icon: '🎓', budget: 'education' },
  parks: { name: 'Parks & Recreation', icon: '🌳', budget: 'parks' },
  plazas: { name: 'Plazas & Decor', icon: '⛲', budget: 'parks' },
  transit: { name: 'Public Transport', icon: '🚌', budget: 'transit' },
  government: { name: 'Government', icon: '🏛️', budget: 'government' },
  disaster: { name: 'Disaster Response', icon: '🚨', budget: 'disaster' },
  landmark: { name: 'Landmarks', icon: '🗽', budget: 'parks' },
  monument: { name: 'Monuments', icon: '🏆', budget: 'parks' },
  tourism: { name: 'Tourism & Leisure', icon: '🎡', budget: 'parks' },
  industry: { name: 'Industry Facilities', icon: '🏗️', budget: 'government' },
};
