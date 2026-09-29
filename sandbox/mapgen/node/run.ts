// Node harness: generate maps and write PNGs + stats.
// node --experimental-transform-types --no-warnings --import ./sandbox/mapgen/node/loader.mjs sandbox/mapgen/node/run.ts <theme> <size> <seed> <out.png> [layers]
import { runPipeline } from '../../../src/world/mapgen/pipeline';
import { themeDef } from '../../../src/data/themes';
import type { MapSettings, ThemeId } from '../../../src/core/types';
import { MAP_SIZES, type MapSizeId } from '../../../src/core/constants';
import { renderMap, type Layer } from '../render';
import { writePNG, tile } from './png';
import { stats } from '../stats';

const [theme = 'temperate', size = 'small', seed = '42', out = '/tmp/map.png', layers = 'terrain', mtn, wat, fst] = process.argv.slice(2);
const settings: MapSettings = {
  cityName: 'Test', mapSize: size as MapSizeId, theme: theme as ThemeId, seed: Number(seed), style: 'european', difficulty: 'normal',
  creative: false, disasters: true, mountains: mtn ? Number(mtn) : 0.5, water: wat ? Number(wat) : 0.5, forests: fst ? Number(fst) : 0.5,
};
const t0 = performance.now();
let last = '';
const stageT: Record<string, number> = {};
let stageStart = t0;
const map = runPipeline(settings, (p, label) => {
  if (label !== last) {
    const now = performance.now();
    if (last) stageT[last] = Math.round(now - stageStart);
    stageStart = now;
    last = label;
  }
});
stageT[last] = Math.round(performance.now() - stageStart);
const ms = Math.round(performance.now() - t0);
console.log(`${theme} ${size}(${MAP_SIZES[size as MapSizeId]}) seed ${seed}: ${ms} ms`, JSON.stringify(stageT));
console.log(JSON.stringify(stats(map)));
const th = themeDef(settings.theme);
const S = Number(process.env.SCALE ?? (map.size <= 256 ? 2 : 1));
const imgs = layers.split(',').map((l) => renderMap(map, { theme: th, layer: l as Layer, trees: true, routes: true, water: true, scale: l === 'terrain' ? S : 1 }));
const img = imgs.length === 1 ? imgs[0] : tile(imgs);
writePNG(out, img.data, img.w, img.h);
