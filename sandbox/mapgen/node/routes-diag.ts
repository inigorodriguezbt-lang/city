// Diagnostic: report route cells that violate slope / water constraints.
// node ... routes-diag.ts <theme> <size> <seed> [mountains water forests]
import { generateContext } from '../../../src/world/mapgen/pipeline';
import type { MapSettings, ThemeId } from '../../../src/core/types';
import type { MapSizeId } from '../../../src/core/constants';
import { MAX_ROAD_SLOPE, WATER_EPS } from '../../../src/core/constants';
import { cellHeights } from '../../../src/world/mapgen/grid';

const [theme = 'alpine', size = 'medium', seed = '1', mtn = '0.5', wat = '0.5', fst = '0.5'] = process.argv.slice(2);
const s: MapSettings = { cityName: 'j', mapSize: size as MapSizeId, theme: theme as ThemeId, seed: Number(seed), style: 'european', difficulty: 'normal', creative: false, disasters: true, mountains: Number(mtn), water: Number(wat), forests: Number(fst) };
const ctx = generateContext(s);
const N = ctx.size, V = ctx.V, H = ctx.heights;
const Zc = cellHeights(H, N);
const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && ctx.water[y * N + x] > Zc[y * N + x] + WATER_EPS;
const K = ['dry', 'ocean', 'lake', 'river', 'wash'];
for (const [name, r] of [['highway', ctx.highway], ['rail', ctx.rail]] as const) {
  console.log(name, r.length, 'cells from', r[0], 'to', r[r.length - 1]);
  let run = 0;
  r.forEach((c, k) => {
    const i = c.y * V + c.x;
    const cs = [H[i], H[i + 1], H[i + V], H[i + V + 1]];
    const sl = (Math.max(...cs) - Math.min(...cs)) / 16;
    const w = wet(c.x, c.y);
    run = w ? run + 1 : 0;
    const adjW = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].filter(([dx, dy]) => wet(c.x + dx, c.y + dy)).length;
    if ((!w && sl > MAX_ROAD_SLOPE) || w) console.log(`  #${k} (${c.x},${c.y}) ${w ? 'WET ' + K[ctx.waterKind[c.y * N + c.x]] + ' run ' + run : 'slope ' + sl.toFixed(3)} corners ${cs.map((v) => v.toFixed(1)).join(' ')} wetNbrs ${adjW} water ${ctx.water[c.y * N + c.x].toFixed(2)}`);
  });
}
