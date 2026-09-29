// Chunk build benchmark: a dense 64×64 downtown (streets every 5 cells,
// avenues / boulevard / tram / rail / a pedestrian mall, rolling terrain)
// timed per 32×32 chunk for both geometry LODs, plus the zone overlay.
import { Noise } from '../../src/core/noise';
import { RoadType, ZoneType, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { RoadSurface } from '../../src/world/roadHeight';
import { ChunkGrid } from '../../src/core/chunks';
import { ChunkBuilder } from '../../src/render/roads/builder';
import { RoadHeightField } from '../../src/render/roads/surface';

const SIZE = 64;
const settings: MapSettings = { cityName: 'Perf', mapSize: 'small', theme: 'temperate', seed: 3, style: 'european', difficulty: 'normal', creative: true, disasters: false, mountains: 0.5, water: 0.5, forests: 0.3 };
const world = new World(settings, SIZE);
const noise = new Noise(5);
for (let vy = 0; vy <= SIZE; vy++) for (let vx = 0; vx <= SIZE; vx++) world.heights[vy * (SIZE + 1) + vx] = 30 + 4 * noise.noise2(vx / 20, vy / 20);
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    let t = RoadType.None;
    if (x % 5 === 2 || y % 5 === 2) t = RoadType.Street;
    if (x % 15 === 7 || y % 15 === 7) t = x % 30 === 7 || y % 30 === 7 ? RoadType.Boulevard : RoadType.Avenue;
    if (y === 47) t = RoadType.TramAvenue;
    if (x === 12 && y > 2 && y < 40) t = RoadType.Pedestrian;
    if (y === 60) t = RoadType.Rail;
    if (t) world.setRoad(x, y, t);
    else world.setZone(x, y, ZoneType.ResMed);
  }
const surface = new RoadSurface(world);
const hf = new RoadHeightField(world, surface);
const builder = new ChunkBuilder(world, hf);
const grid = new ChunkGrid(SIZE);
const out: string[] = [];
for (let lod = 0; lod < 2; lod++)
  for (let k = 0; k < 4; k++) {
    const rect = grid.rect(k);
    for (let i = 0; i < 4; i++) builder.build(rect, lod);
    // minimum over repeated runs: robust against CPU contention from other processes
    let ms = Infinity;
    let res = builder.build(rect, lod);
    for (let i = 0; i < 16; i++) {
      const t0 = performance.now();
      res = builder.build(rect, lod);
      ms = Math.min(ms, performance.now() - t0);
    }
    const tris = res.geometry ? (res.geometry.index!.count / 3) | 0 : 0;
    const verts = res.geometry ? res.geometry.getAttribute('position').count : 0;
    out.push(`lod${lod} chunk ${k}: ${res.roadCells} cells  ${verts} verts  ${tris} tris  ${ms.toFixed(2)} ms`);
  }
console.log(out.join('\n'));

