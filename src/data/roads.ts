import { RoadType, type RoadDef } from '../core/types';

export const ROADS: RoadDef[] = [
  { type: RoadType.Dirt, id: 'dirt', name: 'Gravel Road', description: 'Cheap unpaved lane. Slow and dusty, but gets a village started.', icon: '🟫', lanes: 2, speed: 30, capacity: 600, cost: 20, upkeep: 0.2, width: 7, allowsZoning: true, cars: true, noise: 0.1, unlock: 0 },
  { type: RoadType.Street, id: 'street', name: 'Street', description: 'Two-lane street with sidewalks and street lights. The backbone of neighbourhoods.', icon: '🛣️', lanes: 2, speed: 50, capacity: 1600, cost: 60, upkeep: 0.6, width: 12, allowsZoning: true, cars: true, noise: 0.25, unlock: 0 },
  { type: RoadType.Avenue, id: 'avenue', name: 'Avenue', description: 'Four-lane arterial road for busier districts.', icon: '🚦', lanes: 4, speed: 60, capacity: 4200, cost: 160, upkeep: 1.6, width: 15, allowsZoning: true, cars: true, noise: 0.45, unlock: 1 },
  { type: RoadType.Boulevard, id: 'boulevard', name: 'Grand Boulevard', description: 'Six lanes split by a tree-lined median. Raises land value nearby.', icon: '🌳', lanes: 6, speed: 60, capacity: 6800, cost: 320, upkeep: 3.2, width: 16, allowsZoning: true, cars: true, noise: 0.55, unlock: 4 },
  { type: RoadType.Highway, id: 'highway', name: 'Highway', description: 'Six-lane high-speed road. No zoning, no pedestrians, very noisy.', icon: '🛤️', lanes: 6, speed: 100, capacity: 9000, cost: 420, upkeep: 4.2, width: 16, allowsZoning: false, cars: true, noise: 0.85, unlock: 2 },
  { type: RoadType.Pedestrian, id: 'pedestrian', name: 'Pedestrian Street', description: 'Car-free promenade. Boosts commerce and happiness; service vehicles only.', icon: '🚶', lanes: 0, speed: 10, capacity: 400, cost: 90, upkeep: 0.8, width: 12, allowsZoning: true, cars: false, noise: 0.02, unlock: 3 },
  { type: RoadType.Rail, id: 'rail', name: 'Railway', description: 'Double-track railway for passenger and cargo trains.', icon: '🚆', lanes: 0, speed: 140, capacity: 12000, cost: 380, upkeep: 3.0, width: 10, allowsZoning: false, cars: false, noise: 0.7, unlock: 5 },
  { type: RoadType.TramAvenue, id: 'tram_avenue', name: 'Avenue with Tram', description: 'Four-lane avenue carrying tram tracks in the center lanes.', icon: '🚋', lanes: 4, speed: 50, capacity: 4600, cost: 260, upkeep: 2.6, width: 15, allowsZoning: true, cars: true, noise: 0.5, unlock: 6 },
];

const byType: RoadDef[] = [];
for (const r of ROADS) byType[r.type] = r;
export function roadDef(t: RoadType): RoadDef {
  return byType[t];
}
