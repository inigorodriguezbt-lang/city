// Map generation worker. Runs the full mapgen pipeline off the main thread,
// streams progress (0..1 + stage label) and transfers every typed array back.
import { exposeWorker } from '../core/rpc';
import type { GeneratedMap, MapSettings } from '../core/types';
import { runPipeline } from '../world/mapgen/pipeline';

exposeWorker({
  generate(args: MapSettings, ctx): GeneratedMap {
    const map = runPipeline(args, (p, label) => ctx.progress(p, label));
    ctx.transfer.push(
      map.heights.buffer,
      map.water.buffer,
      map.trees.buffer,
      map.fertility.buffer,
      map.forest.buffer,
      map.ore.buffer,
      map.oil.buffer,
      map.wind.buffer,
    );
    return map;
  },
});
