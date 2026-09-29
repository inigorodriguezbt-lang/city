// Diagnostic: list adjacent wet-cell pairs whose water surfaces differ by > 3 m.
// node ... jumps.ts <theme> <size> <seed> [mountains water forests]
import { generateContext } from '../../../src/world/mapgen/pipeline';
import type { MapSettings, ThemeId } from '../../../src/core/types';
import type { MapSizeId } from '../../../src/core/constants';
import { WATER_EPS } from '../../../src/core/constants';
import { cellHeights } from '../../../src/world/mapgen/grid';

const [theme = 'alpine', size = 'small', seed = '1', mtn = '0.5', wat = '0.5', fst = '0.5'] = process.argv.slice(2);
const s: MapSettings = { cityName: 'j', mapSize: size as MapSizeId, theme: theme as ThemeId, seed: Number(seed), style: 'european', difficulty: 'normal', creative: false, disasters: true, mountains: Number(mtn), water: Number(wat), forests: Number(fst) };
const ctx = generateContext(s);
const N = ctx.size;
const Zc = cellHeights(ctx.heights, N);
const wet = (i: number) => ctx.water[i] > Zc[i] + WATER_EPS;
const K = ['dry', 'ocean', 'lake', 'river', 'wash'];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x;
  if (!wet(i)) continue;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx >= N || yy >= N) continue;
    const j = yy * N + xx;
    if (!wet(j)) continue;
    const d = Math.abs(ctx.water[i] - ctx.water[j]);
    if (d > 3) console.log(`(${x},${y})${K[ctx.waterKind[i]]} w=${ctx.water[i].toFixed(2)} z=${Zc[i].toFixed(2)} flow=${ctx.flow[i].toFixed(0)} | (${xx},${yy})${K[ctx.waterKind[j]]} w=${ctx.water[j].toFixed(2)} z=${Zc[j].toFixed(2)} flow=${ctx.flow[j].toFixed(0)}`);
  }
}
