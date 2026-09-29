// STUB — owned by the "mapgen" agent. Public API is FROZEN.
import type { GeneratedMap, MapSettings } from '../../core/types';
import { MAP_SIZES } from '../../core/constants';

/** Generate a map in a Web Worker. onProgress(0..1, label). */
export async function generateMap(settings: MapSettings, onProgress?: (p: number, label: string) => void): Promise<GeneratedMap> {
  const size = MAP_SIZES[settings.mapSize];
  onProgress?.(1, 'flat stub map');
  const n = size * size;
  return {
    size,
    heights: new Float32Array((size + 1) * (size + 1)).fill(10),
    water: new Float32Array(n).fill(-1e4),
    seaLevel: 0,
    trees: new Uint8Array(n),
    fertility: new Uint8Array(n), forest: new Uint8Array(n), ore: new Uint8Array(n), oil: new Uint8Array(n), wind: new Uint8Array(n),
    connections: [],
    highway: [],
    rail: [],
    start: { x: size >> 1, y: size >> 1 },
  };
}
