import type { StyleDef, StyleId } from '../core/types';

export const STYLES: StyleDef[] = [
  { id: 'american', name: 'North American', description: 'Clapboard suburbs, brick main streets and steel-and-glass downtowns.', wallColors: ['#e8e1d3', '#c9b99a', '#9fb4c7', '#d8d0c0', '#a7503f', '#8d6e57', '#f1ede4'], roofColors: ['#4a4f57', '#5a3f35', '#3b3f45', '#6b5446'], trimColors: ['#ffffff', '#f4f0e6', '#2f3338'], roofs: ['gable', 'hip', 'flat'], unlock: 0 },
  { id: 'european', name: 'European', description: 'Rendered facades, steep clay-tile roofs, dormers and cobbled charm.', wallColors: ['#efe3c8', '#e7c9a2', '#d9d4c7', '#c7d1cf', '#e8b99a', '#f2ead8', '#b7c4a8'], roofColors: ['#a4452f', '#8e3b2a', '#5d5f66', '#7a3526'], trimColors: ['#fbf7ee', '#6b5d4f', '#2f3a33'], roofs: ['gable', 'hip', 'mansard'], unlock: 0 },
  { id: 'mediterranean', name: 'Mediterranean', description: 'Whitewashed walls, terracotta roofs, arches and shaded terraces.', wallColors: ['#f7f3ea', '#f2e3c7', '#efd9b4', '#e9e4da', '#d9c2a0', '#f5efe0'], roofColors: ['#c0633b', '#b5552f', '#cf7a4b'], trimColors: ['#2f6fa8', '#3d8a5a', '#ffffff'], roofs: ['hip', 'flat', 'shed'], unlock: 0 },
  { id: 'nordic', name: 'Nordic', description: 'Colourful timber houses, steep black roofs and minimalist blocks.', wallColors: ['#b3342c', '#e4c35a', '#f0ede6', '#3f5f7a', '#6f8f6a', '#d9d2c5', '#2b2d30'], roofColors: ['#25282c', '#3a3d42', '#56585c'], trimColors: ['#ffffff', '#f4f1ea'], roofs: ['gable', 'shed', 'flat'], unlock: 2 },
  { id: 'asian', name: 'East Asian', description: 'Dense mid-rises, neon signage, curved tile roofs in older quarters.', wallColors: ['#e9e6df', '#cfd6d9', '#d8cbb6', '#b9c2c4', '#efe8dc', '#a8b3b0'], roofColors: ['#3c4a55', '#5b3a2e', '#2d3f3a'], trimColors: ['#b03030', '#2b2b2b', '#e6c55a'], roofs: ['pagoda', 'flat', 'hip'], unlock: 3 },
  { id: 'artdeco', name: 'Art Deco', description: 'Stepped setbacks, vertical piers, gilded crowns and terrazzo lobbies.', wallColors: ['#e6d8bd', '#d2bf9b', '#c9c3b4', '#e8e1cf', '#b9a37e'], roofColors: ['#3b3b3b', '#6e5c3a', '#2f3b3a'], trimColors: ['#c9a44c', '#1f2a2a', '#f3ead3'], roofs: ['flat', 'mansard', 'dome'], unlock: 4 },
  { id: 'modern', name: 'Contemporary', description: 'Clean concrete, timber cladding, full-height glazing and green roofs.', wallColors: ['#f2f2f0', '#d6d6d2', '#8c8f93', '#c4b39a', '#3d4145', '#e4e0d8'], roofColors: ['#4a4e52', '#6f7a5e', '#2f3236'], trimColors: ['#1f2226', '#b88b5a', '#ffffff'], roofs: ['flat', 'shed'], unlock: 5 },
  { id: 'futuristic', name: 'Futuristic', description: 'Parametric curves, sky gardens, photovoltaic skins and neon accents.', wallColors: ['#eef4f7', '#cfe3ea', '#a9c7d6', '#dfe7ec', '#b7c1c9'], roofColors: ['#2d3a44', '#1e5a6b', '#324a3a'], trimColors: ['#3ff0ff', '#ff4fd8', '#e8ff5a'], roofs: ['flat', 'dome'], unlock: 9 },
];

export function styleDef(id: StyleId): StyleDef {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}
