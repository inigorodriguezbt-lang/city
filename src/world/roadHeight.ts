// Road surface heights shared by road + vehicle renderers and anything that
// needs to sit on a road. Non-bridge road surfaces follow the terrain corners
// (+ ROAD_LIFT). Bridge cells (roadFlags bit0) get a flat deck height derived
// from the two banks of their straight run, never lower than water + MIN_CLEAR.
import { CELL } from '../core/constants';
import { DIR_BIT } from '../core/types';
import type { Rect } from '../core/types';
import type { World } from './World';

export const ROAD_LIFT = 0.12;
export const SIDEWALK_LIFT = 0.28;
const MIN_CLEAR = 4.5;

export class RoadSurface {
  private deckCache: Float32Array;
  constructor(readonly world: World) {
    this.deckCache = new Float32Array(world.size * world.size).fill(NaN);
  }

  /** forget cached decks in (and around) a rect after road/terrain/water edits */
  invalidate(r: Rect): void {
    const w = this.world;
    const pad = 64; // bridges can be long
    const x0 = Math.max(0, r.x0 - pad), y0 = Math.max(0, r.y0 - pad), x1 = Math.min(w.size - 1, r.x1 + pad), y1 = Math.min(w.size - 1, r.y1 + pad);
    for (let y = y0; y <= y1; y++) this.deckCache.fill(NaN, y * w.size + x0, y * w.size + x1 + 1);
  }

  /** deck height of a bridge cell (m). For non-bridge cells returns terrain cell height + ROAD_LIFT. */
  deck(x: number, y: number): number {
    const w = this.world;
    if (!w.inBounds(x, y)) return 0;
    const i = w.idx(x, y);
    const cached = this.deckCache[i];
    if (!Number.isNaN(cached)) return cached;
    let h: number;
    if (!w.isBridge(x, y)) h = w.cellHeight(x, y) + ROAD_LIFT;
    else {
      const m = w.roadMask(x, y);
      // run axis: horizontal if E/W connections dominate
      const horiz = (m & (DIR_BIT[1] | DIR_BIT[3])) !== 0 && (m & (DIR_BIT[0] | DIR_BIT[2])) === 0 ? true : (m & (DIR_BIT[0] | DIR_BIT[2])) !== 0 && (m & (DIR_BIT[1] | DIR_BIT[3])) === 0 ? false : true;
      const dx = horiz ? 1 : 0, dy = horiz ? 0 : 1;
      let a = 1, b = 1, ha = NaN, hb = NaN;
      for (; a < 256; a++) {
        const xx = x - dx * a, yy = y - dy * a;
        if (!w.inBounds(xx, yy) || !w.roadAt(xx, yy)) break;
        if (!w.isBridge(xx, yy)) { ha = w.cellHeight(xx, yy) + ROAD_LIFT; break; }
      }
      for (; b < 256; b++) {
        const xx = x + dx * b, yy = y + dy * b;
        if (!w.inBounds(xx, yy) || !w.roadAt(xx, yy)) break;
        if (!w.isBridge(xx, yy)) { hb = w.cellHeight(xx, yy) + ROAD_LIFT; break; }
      }
      const water = w.waterLevel(x, y);
      // wet cells keep ship clearance; dry abutment cells (steep banks the road
      // tool folds into the bridge) only need to clear their own ground
      const floor = w.isWater(x, y) ? Math.max(water, w.cellHeight(x, y)) + MIN_CLEAR : w.cellHeight(x, y) + ROAD_LIFT;
      let base: number;
      if (!Number.isNaN(ha) && !Number.isNaN(hb)) base = ha + (hb - ha) * (a / (a + b));
      else if (!Number.isNaN(ha)) base = ha;
      else if (!Number.isNaN(hb)) base = hb;
      else base = floor;
      h = Math.max(base, floor);
    }
    this.deckCache[i] = h;
    return h;
  }

  /** continuous drivable surface height at world meters (terrain-following or bridge deck) */
  heightAt(wx: number, wz: number): number {
    const w = this.world;
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    if (w.isBridge(x, y)) return this.deck(x, y);
    return w.heightAt(wx, wz) + ROAD_LIFT;
  }
}
