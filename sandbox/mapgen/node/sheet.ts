// Contact sheet: all six themes (or one theme × several seeds) in a 3×2 grid.
// node ... sheet.ts <size> <seed|theme:seeds> <out.png> [layer] [scale]
import { runPipeline } from '../../../src/world/mapgen/pipeline';
import { THEMES, themeDef } from '../../../src/data/themes';
import type { MapSettings, ThemeId } from '../../../src/core/types';
import type { MapSizeId } from '../../../src/core/constants';
import { renderMap, type Layer } from '../render';
import { writePNG } from './png';
import { stats } from '../stats';

const [size = 'medium', spec = '42', out = '/tmp/sheet.png', layer = 'terrain', scaleS = '1', mtn, wat, fst] = process.argv.slice(2);
const jobs: { theme: ThemeId; seed: number }[] = [];
if (spec.includes(':')) {
  const [th, seeds] = spec.split(':');
  for (const s of seeds.split(',')) jobs.push({ theme: th as ThemeId, seed: Number(s) });
} else for (const t of THEMES) jobs.push({ theme: t.id, seed: Number(spec) });
const imgs: { data: Uint8ClampedArray; w: number; h: number }[] = [];
for (const j of jobs) {
  const settings: MapSettings = {
    cityName: 'Test', mapSize: size as MapSizeId, theme: j.theme, seed: j.seed, style: 'european', difficulty: 'normal',
    creative: false, disasters: true, mountains: mtn ? Number(mtn) : 0.5, water: wat ? Number(wat) : 0.5, forests: fst ? Number(fst) : 0.5,
  };
  const t0 = performance.now();
  const map = runPipeline(settings);
  const ms = Math.round(performance.now() - t0);
  console.log(`${j.theme} s${j.seed} ${ms}ms`, JSON.stringify(stats(map)));
  imgs.push(renderMap(map, { theme: themeDef(j.theme), layer: layer as Layer, trees: true, routes: true, water: true, scale: Number(scaleS) }));
}
const cols = Math.min(3, imgs.length), rows = Math.ceil(imgs.length / cols);
const w = imgs[0].w, h = imgs[0].h, gap = 6;
const W = cols * w + (cols - 1) * gap, H = rows * h + (rows - 1) * gap;
const outImg = new Uint8ClampedArray(W * H * 4).fill(25);
imgs.forEach((im, k) => {
  const ox = (k % cols) * (w + gap), oy = Math.floor(k / cols) * (h + gap);
  for (let y = 0; y < im.h; y++) outImg.set(im.data.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((oy + y) * W + ox) * 4);
});
writePNG(out, outImg, W, H);
