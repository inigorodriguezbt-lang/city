import type { MilestoneDef } from '../core/types';

// Milestone index is referenced by `unlock` fields across all catalogs.
export const MILESTONES: MilestoneDef[] = [
  { index: 0, name: 'Settlement', population: 0, reward: 0, unlocksText: ['Roads, low density zones, basic power & water'] },
  { index: 1, name: 'Hamlet', population: 300, reward: 10_000, unlocksText: ['Avenues', 'Health & fire services', 'Garbage collection'] },
  { index: 2, name: 'Village', population: 1_200, reward: 20_000, unlocksText: ['Highways', 'Medium density residential', 'Police', 'Elementary schools', 'Nordic style'] },
  { index: 3, name: 'Small Town', population: 3_500, reward: 35_000, unlocksText: ['High density zones', 'Specialized industry', 'Pedestrian streets', 'Bus lines', 'Policies', 'East Asian style'] },
  { index: 4, name: 'Town', population: 8_000, reward: 50_000, unlocksText: ['Offices', 'Boulevards', 'High schools', 'Districts', 'Art Deco style'] },
  { index: 5, name: 'Large Town', population: 16_000, reward: 75_000, unlocksText: ['Railway & trains', 'Mixed use zoning', 'Deathcare', 'Contemporary style'] },
  { index: 6, name: 'Small City', population: 30_000, reward: 100_000, unlocksText: ['Trams', 'University', 'Loans tier 2', 'Disaster services'] },
  { index: 7, name: 'City', population: 55_000, reward: 150_000, unlocksText: ['Metro', 'Advanced power', 'Landmarks'] },
  { index: 8, name: 'Large City', population: 90_000, reward: 200_000, unlocksText: ['Airport', 'Harbor', 'Advanced healthcare'] },
  { index: 9, name: 'Grand City', population: 140_000, reward: 300_000, unlocksText: ['Futuristic style', 'Nuclear power', 'Monuments'] },
  { index: 10, name: 'Capital', population: 220_000, reward: 400_000, unlocksText: ['Space elevator research', 'Mega-structures'] },
  { index: 11, name: 'Metropolis', population: 350_000, reward: 600_000, unlocksText: ['Fusion power', 'Arcology'] },
  { index: 12, name: 'Megalopolis', population: 550_000, reward: 1_000_000, unlocksText: ['Everything', 'Wonder monuments'] },
  { index: 13, name: 'Ecumenopolis', population: 1_000_000, reward: 2_000_000, unlocksText: ['Eternal glory'] },
];

export function milestoneForPopulation(pop: number): number {
  let m = 0;
  for (const ms of MILESTONES) if (pop >= ms.population) m = ms.index;
  return m;
}
