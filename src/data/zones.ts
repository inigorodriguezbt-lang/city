import { ZoneType, type ZoneDef } from '../core/types';

// capacityPerCell: residents (res) or jobs (others) per cell of lot area at level 1.
// Level scaling: capacity = capacityPerCell * area * LEVEL_CAPACITY[level].
export const LEVEL_CAPACITY = [0, 1, 1.35, 1.75, 2.2, 2.8];

export const ZONES: ZoneDef[] = [
  { type: ZoneType.ResLow, id: 'res_low', name: 'Low Density Residential', short: 'R', icon: '🏡', category: 'res', color: '#5bd46a', density: 'low', lots: [[1, 2], [1, 3], [2, 2], [2, 3]], maxFloors: 3, capacityPerCell: 2.5, tax: 'resLow', unlock: 0 },
  { type: ZoneType.ResMed, id: 'res_med', name: 'Medium Density Residential', short: 'R+', icon: '🏘️', category: 'res', color: '#2fb84a', density: 'med', lots: [[1, 2], [2, 2], [2, 3], [3, 3]], maxFloors: 7, capacityPerCell: 8, tax: 'resLow', unlock: 2 },
  { type: ZoneType.ResHigh, id: 'res_high', name: 'High Density Residential', short: 'R++', icon: '🏢', category: 'res', color: '#138a32', density: 'high', lots: [[2, 2], [2, 3], [3, 3], [3, 4], [4, 4]], maxFloors: 45, capacityPerCell: 20, tax: 'resHigh', unlock: 3 },
  { type: ZoneType.ComLow, id: 'com_low', name: 'Low Density Commercial', short: 'C', icon: '🏪', category: 'com', color: '#4aa8ff', density: 'low', lots: [[1, 2], [2, 2], [2, 3]], maxFloors: 3, capacityPerCell: 2.5, tax: 'comLow', unlock: 0 },
  { type: ZoneType.ComHigh, id: 'com_high', name: 'High Density Commercial', short: 'C++', icon: '🏬', category: 'com', color: '#1566d6', density: 'high', lots: [[2, 2], [2, 3], [3, 3], [4, 4]], maxFloors: 30, capacityPerCell: 9, tax: 'comHigh', unlock: 3 },
  { type: ZoneType.Office, id: 'office', name: 'Office', short: 'O', icon: '🏙️', category: 'off', color: '#29d3e6', density: 'high', lots: [[2, 2], [2, 3], [3, 3], [4, 4]], maxFloors: 60, capacityPerCell: 12, tax: 'office', unlock: 4 },
  { type: ZoneType.Industry, id: 'industry', name: 'Generic Industry', short: 'I', icon: '🏭', category: 'ind', color: '#f2c230', density: 'low', lots: [[2, 2], [2, 3], [3, 3], [4, 4]], maxFloors: 4, capacityPerCell: 4, tax: 'industry', unlock: 0 },
  { type: ZoneType.Farming, id: 'farming', name: 'Farming Industry', short: 'IF', icon: '🌾', category: 'ind', color: '#b8d93a', density: 'low', lots: [[3, 3], [4, 4]], maxFloors: 2, capacityPerCell: 1.2, tax: 'industry', unlock: 3, resource: 'fertility' },
  { type: ZoneType.Forestry, id: 'forestry', name: 'Forestry Industry', short: 'IW', icon: '🌲', category: 'ind', color: '#6f9e3a', density: 'low', lots: [[2, 3], [3, 3], [4, 4]], maxFloors: 2, capacityPerCell: 1.8, tax: 'industry', unlock: 3, resource: 'forest' },
  { type: ZoneType.Mining, id: 'mining', name: 'Ore Mining Industry', short: 'IM', icon: '⛏️', category: 'ind', color: '#b07f5a', density: 'low', lots: [[3, 3], [4, 4]], maxFloors: 3, capacityPerCell: 2.5, tax: 'industry', unlock: 3, resource: 'ore' },
  { type: ZoneType.Oil, id: 'oil', name: 'Oil Industry', short: 'IO', icon: '🛢️', category: 'ind', color: '#6b6b6b', density: 'low', lots: [[2, 3], [3, 3], [4, 4]], maxFloors: 3, capacityPerCell: 2.5, tax: 'industry', unlock: 3, resource: 'oil' },
  { type: ZoneType.MixedUse, id: 'mixed', name: 'Mixed Use', short: 'M', icon: '🏫', category: 'res', color: '#9c6bff', density: 'med', lots: [[1, 2], [2, 2], [2, 3], [3, 3]], maxFloors: 10, capacityPerCell: 7, tax: 'comLow', unlock: 5 },
];

const byType: ZoneDef[] = [];
for (const z of ZONES) byType[z.type] = z;
export function zoneDef(t: ZoneType): ZoneDef {
  return byType[t];
}
export function zoneById(id: string): ZoneDef | undefined {
  return ZONES.find((z) => z.id === id);
}
