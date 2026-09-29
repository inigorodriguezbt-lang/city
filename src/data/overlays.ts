// Info-view metadata shared by the overlay renderer and the UI legend.
import type { FieldId } from '../core/types';

export interface OverlayInfo {
  id: FieldId;
  name: string;
  icon: string;
  description: string;
  /** color ramp stops from value 0 → 255 (hex) */
  ramp: string[];
  /** legend labels at low / high end */
  low: string;
  high: string;
  /** true = high is good (green), false = high is bad */
  highIsGood: boolean;
  /** only meaningful on road cells */
  roadsOnly?: boolean;
}

const GOOD = ['#b3261e', '#e8a33d', '#e8e05a', '#6cc46a', '#1f9e5a'];
const BAD = ['#1f9e5a', '#9bd06a', '#e8e05a', '#e8883d', '#b3261e'];

export const OVERLAYS: OverlayInfo[] = [
  { id: 'landValue', name: 'Land Value', icon: '💰', description: 'What the land is worth. Rises with services, parks and views; falls with pollution, noise and crime.', ramp: ['#2b3a67', '#3f7cac', '#5bbf8a', '#d8c85a', '#f5a623'], low: 'Low', high: 'High', highIsGood: true },
  { id: 'power', name: 'Electricity', icon: '⚡', description: 'Where the power grid reaches. Power travels along roads and between touching buildings.', ramp: ['#b3261e', '#f2c230'], low: 'No power', high: 'Powered', highIsGood: true },
  { id: 'water', name: 'Water', icon: '💧', description: 'Fresh water supply coverage through pipes under the roads.', ramp: ['#b3261e', '#2f8fff'], low: 'No water', high: 'Supplied', highIsGood: true },
  { id: 'sewage', name: 'Sewage', icon: '🚽', description: 'Sewage collection coverage.', ramp: ['#b3261e', '#8a6b3d'], low: 'None', high: 'Collected', highIsGood: true },
  { id: 'pollution', name: 'Pollution', icon: '☣️', description: 'Ground and air pollution from industry, power plants and traffic. Makes people sick.', ramp: ['#2e7d32', '#9e9d24', '#8d6e63', '#5d4037', '#3e2723'], low: 'Clean', high: 'Toxic', highIsGood: false },
  { id: 'noise', name: 'Noise', icon: '🔊', description: 'Noise from traffic, industry and nightlife.', ramp: BAD, low: 'Quiet', high: 'Deafening', highIsGood: false },
  { id: 'crime', name: 'Crime', icon: '🦹', description: 'Crime risk. Police coverage, jobs and prosperity keep it down.', ramp: BAD, low: 'Safe', high: 'Dangerous', highIsGood: false },
  { id: 'police', name: 'Police', icon: '🚓', description: 'Police station coverage.', ramp: GOOD, low: 'None', high: 'Excellent', highIsGood: true },
  { id: 'fire', name: 'Fire Safety', icon: '🚒', description: 'Fire station coverage. Uncovered buildings burn longer and spread fire.', ramp: GOOD, low: 'None', high: 'Excellent', highIsGood: true },
  { id: 'health', name: 'Healthcare', icon: '🏥', description: 'Clinic and hospital coverage.', ramp: GOOD, low: 'None', high: 'Excellent', highIsGood: true },
  { id: 'education', name: 'Education', icon: '🎓', description: 'School, college and university coverage.', ramp: GOOD, low: 'None', high: 'Excellent', highIsGood: true },
  { id: 'leisure', name: 'Parks & Leisure', icon: '🌳', description: 'Access to parks, plazas and recreation.', ramp: GOOD, low: 'None', high: 'Plenty', highIsGood: true },
  { id: 'garbage', name: 'Garbage', icon: '🗑️', description: 'Garbage collection coverage.', ramp: GOOD, low: 'Uncollected', high: 'Collected', highIsGood: true },
  { id: 'deathcare', name: 'Deathcare', icon: '⚱️', description: 'Cemetery and crematorium coverage.', ramp: GOOD, low: 'None', high: 'Covered', highIsGood: true },
  { id: 'transit', name: 'Public Transport', icon: '🚌', description: 'Walking distance to transit stops and stations.', ramp: GOOD, low: 'None', high: 'Excellent', highIsGood: true },
  { id: 'traffic', name: 'Traffic', icon: '🚦', description: 'Congestion on roads. Green flows, red is gridlock.', ramp: ['#1f9e5a', '#9bd06a', '#e8e05a', '#e8883d', '#b3261e'], low: 'Free flow', high: 'Gridlock', highIsGood: false, roadsOnly: true },
  { id: 'happiness', name: 'Happiness', icon: '😊', description: 'How content residents and workers are.', ramp: GOOD, low: 'Miserable', high: 'Delighted', highIsGood: true },
  { id: 'tourism', name: 'Tourism', icon: '📸', description: 'Attractiveness to visitors.', ramp: ['#2b2b3a', '#6a4c93', '#c26dbc', '#ff9f68', '#ffe066'], low: 'None', high: 'Must-see', highIsGood: true },
  { id: 'wind', name: 'Wind Speed', icon: '🌬️', description: 'Average wind — build turbines where it is strongest.', ramp: ['#1b2a41', '#28536b', '#4f9d9f', '#a7d8c9', '#ffffff'], low: 'Calm', high: 'Gusty', highIsGood: true },
  { id: 'fertility', name: 'Fertile Land', icon: '🌾', description: 'Soil suitable for farming industry.', ramp: ['#3e2f1f', '#6b5b2e', '#9bb33c', '#c8e05a'], low: 'Barren', high: 'Fertile', highIsGood: true },
  { id: 'forest', name: 'Forest', icon: '🌲', description: 'Timber available for forestry industry.', ramp: ['#3e2f1f', '#2e5d34', '#1f8a3a'], low: 'None', high: 'Dense', highIsGood: true },
  { id: 'ore', name: 'Ore Deposits', icon: '⛏️', description: 'Minerals for mining industry.', ramp: ['#2b2b2b', '#6b4f3a', '#b07f5a', '#e0b080'], low: 'None', high: 'Rich', highIsGood: true },
  { id: 'oil', name: 'Oil Deposits', icon: '🛢️', description: 'Oil fields for the oil industry.', ramp: ['#2b2b2b', '#3d3d55', '#6b6b8f', '#aaaacc'], low: 'None', high: 'Rich', highIsGood: true },
];

export function overlayInfo(id: FieldId): OverlayInfo | undefined {
  return OVERLAYS.find((o) => o.id === id);
}
