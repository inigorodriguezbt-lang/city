// Rendered road surface height model (pure: no THREE / DOM, safe to move into
// world/roadHeight.ts or a worker).
//
// Plain road cells follow the bilinear terrain + ROAD_LIFT, exactly like
// RoadSurface.heightAt. Bridge cells use RoadSurface.deck(x, y) at their center
// and blend linearly toward the shared edge value of neighbouring bridge cells,
// so a run of decks is one continuous (piecewise-linear) ramp instead of a
// staircase. Straight land cells in line with a bridge end ramp smoothly from
// the terrain up to the deck (over one to three cells, smoothstep eased), so a
// bridge whose deck sits BRIDGE_CLEARANCE above the water is reachable.
//
// Vehicles should sample `heightAt(wx, wz)` of this class (see the integration
// notes of the roads module) so they drive exactly on the rendered asphalt.
import { CELL } from '../../core/constants';
import { DIR_BIT, DIR_DX, DIR_DY, RoadType, type Rect } from '../../core/types';
import { ROAD_LIFT, type RoadSurface } from '../../world/roadHeight';
import type { World } from '../../world/World';

/** structural depth of a bridge deck below the asphalt (m) */
export const DECK_THICKNESS = 1.35;
/** steepest grade between neighbouring deck cells of a straight bridge run */
const MAX_DECK_GRADE = 0.05;
/** longest approach ramp (cells) */
const MAX_RAMP_CELLS = 3;
/** rise (m) one ramp cell absorbs: the eased profile peaks at 1.5× the mean grade → ≈ 12 % */
const RISE_PER_CELL = 1.3;

const enum Mode {
  Unknown = 0,
  Plain = 1,
  /** straight bridge cell along an axis: piecewise-linear deck */
  Run = 2,
  /** non-straight bridge cell (curve/junction on a deck): flat deck */
  Flat = 3,
  /** land cell ramping toward one or two bridge ends */
  Ramp = 4,
}

/** Bridge-run parameters: axis 0 = along z (N-S), 1 = along x (E-W). */
interface RunInfo {
  axis: number;
  d: number;
  /** surface height at the low (N/W) and high (S/E) edges; NaN = terrain at the edge */
  e0: number;
  e1: number;
}
/** Ramp parameters: up to two eased blends toward a deck edge along `axis`. */
interface RampInfo {
  axis: number;
  /** world coordinate (along axis) of the deck edge, deck height, ramp length, direction (+1: deck lies toward +axis) */
  edges: { at: number; d: number; len: number; dir: number }[];
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class RoadHeightField {
  private mode: Uint8Array;
  private runs = new Map<number, RunInfo>();
  private ramps = new Map<number, RampInfo>();
  private flats = new Map<number, number>();

  constructor(readonly world: World, readonly surface: RoadSurface) {
    this.mode = new Uint8Array(world.size * world.size);
  }

  /** forget cached cell modes around a changed rect (bridges can be long) */
  invalidate(r: Rect): void {
    const w = this.world;
    const pad = 66;
    const x0 = Math.max(0, r.x0 - pad), y0 = Math.max(0, r.y0 - pad), x1 = Math.min(w.size - 1, r.x1 + pad), y1 = Math.min(w.size - 1, r.y1 + pad);
    for (let y = y0; y <= y1; y++) {
      const row = y * w.size;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const m = this.mode[i];
        if (m === Mode.Unknown) continue;
        if (m === Mode.Run) this.runs.delete(i);
        else if (m === Mode.Ramp) this.ramps.delete(i);
        else if (m === Mode.Flat) this.flats.delete(i);
        this.mode[i] = Mode.Unknown;
      }
    }
  }

  /** drivable surface height (asphalt level) at world meters */
  heightAt(wx: number, wz: number): number {
    const w = this.world;
    let cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    cx = cx < 0 ? 0 : cx >= w.size ? w.size - 1 : cx;
    cy = cy < 0 ? 0 : cy >= w.size ? w.size - 1 : cy;
    return this.cellSurface(cx, cy, wx, wz);
  }

  /** true when the cell's surface is not plain terrain-following */
  isRaised(cx: number, cy: number): boolean {
    return this.classify(cx, cy) !== Mode.Plain;
  }

  /** surface height of cell (cx, cy) evaluated at world point (wx, wz) (may lie on the cell border) */
  cellSurface(cx: number, cy: number, wx: number, wz: number): number {
    const m = this.classify(cx, cy);
    if (m === Mode.Plain) return this.world.heightAt(wx, wz) + ROAD_LIFT;
    const i = cy * this.world.size + cx;
    if (m === Mode.Flat) return this.flats.get(i)!;
    if (m === Mode.Run) {
      const r = this.runs.get(i)!;
      const la = r.axis === 0 ? wz - cy * CELL : wx - cx * CELL;
      if (la < CELL / 2) {
        const e = Number.isNaN(r.e0) ? this.edgeTerrain(r.axis, cx, cy, wx, wz, 0) : r.e0;
        return e + (r.d - e) * (la / (CELL / 2));
      }
      const e = Number.isNaN(r.e1) ? this.edgeTerrain(r.axis, cx, cy, wx, wz, 1) : r.e1;
      return r.d + (e - r.d) * ((la - CELL / 2) / (CELL / 2));
    }
    // ramp
    const rp = this.ramps.get(i)!;
    const t = this.world.heightAt(wx, wz) + ROAD_LIFT;
    const a = rp.axis === 0 ? wz : wx;
    let h = t;
    for (const e of rp.edges) {
      const dist = (e.at - a) * e.dir; // distance from the point to the deck edge (>= 0 inside the ramp)
      h += (e.d - t) * smooth(1 - dist / e.len);
    }
    return h;
  }

  /** surface normal of cell (cx, cy) at a world point (analytic for plain cells) */
  cellNormal(cx: number, cy: number, wx: number, wz: number, out: { x: number; y: number; z: number }): void {
    const m = this.classify(cx, cy);
    let gx: number, gz: number;
    if (m === Mode.Plain) {
      const w = this.world;
      const fx = wx / CELL - cx, fz = wz / CELL - cy;
      const h00 = w.vertexHeight(cx, cy), h10 = w.vertexHeight(cx + 1, cy), h01 = w.vertexHeight(cx, cy + 1), h11 = w.vertexHeight(cx + 1, cy + 1);
      gx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / CELL;
      gz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / CELL;
    } else if (m === Mode.Flat) {
      gx = 0;
      gz = 0;
    } else {
      const e = 0.35;
      gx = (this.cellSurface(cx, cy, wx + e, wz) - this.cellSurface(cx, cy, wx - e, wz)) / (2 * e);
      gz = (this.cellSurface(cx, cy, wx, wz + e) - this.cellSurface(cx, cy, wx, wz - e)) / (2 * e);
    }
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    out.x = -gx * inv;
    out.y = inv;
    out.z = -gz * inv;
  }

  private edgeTerrain(axis: number, cx: number, cy: number, wx: number, wz: number, end: number): number {
    if (axis === 0) return this.world.heightAt(wx, (cy + end) * CELL) + ROAD_LIFT;
    return this.world.heightAt((cx + end) * CELL, wz) + ROAD_LIFT;
  }

  // ── classification ──────────────────────────────────────────────────────
  private classify(cx: number, cy: number): Mode {
    const w = this.world;
    const i = cy * w.size + cx;
    const cached = this.mode[i];
    if (cached !== Mode.Unknown) return cached;
    let m: Mode = Mode.Plain;
    const t = w.road[i] as RoadType;
    if (t !== RoadType.None) {
      if (w.isBridge(cx, cy)) m = this.classifyBridge(cx, cy, i);
      else m = this.classifyRamp(cx, cy, i);
    }
    this.mode[i] = m;
    return m;
  }

  /** axis of a straight cell (0 = N-S, 1 = E-W) or -1 */
  private straightAxis(x: number, y: number): number {
    const m = this.world.roadMask(x, y);
    if (m === (DIR_BIT[0] | DIR_BIT[2])) return 0;
    if (m === (DIR_BIT[1] | DIR_BIT[3])) return 1;
    return -1;
  }

  private connected(x: number, y: number, d: number): boolean {
    return (this.world.roadMask(x, y) & DIR_BIT[d]) !== 0;
  }

  private classifyBridge(cx: number, cy: number, i: number): Mode {
    const axis = this.straightAxis(cx, cy);
    if (axis < 0) {
      this.flats.set(i, this.surface.deck(cx, cy));
      return Mode.Flat;
    }
    this.buildRun(cx, cy, axis);
    return Mode.Run;
  }

  /**
   * Classify a whole straight bridge run at once. Deck heights come from
   * RoadSurface.deck (clearance over water / banks) and are lifted to their
   * upper envelope with a bounded grade, so the deck is a smooth, drivable
   * profile (never lower than required) instead of following per-cell floors.
   */
  private buildRun(cx: number, cy: number, axis: number): void {
    const w = this.world;
    const dx = axis === 1 ? 1 : 0, dy = axis === 0 ? 1 : 0;
    const lowDir = axis === 0 ? 0 : 3; // N or W
    const highDir = axis === 0 ? 2 : 1; // S or E
    const inRun = (x: number, y: number): boolean => w.inBounds(x, y) && w.isBridge(x, y) && this.straightAxis(x, y) === axis;
    let a = 0, b = 0;
    while (a < 1024 && inRun(cx - dx * (a + 1), cy - dy * (a + 1))) a++;
    while (b < 1024 && inRun(cx + dx * (b + 1), cy + dy * (b + 1))) b++;
    const n = a + b + 1;
    const x0 = cx - dx * a, y0 = cy - dy * a;
    const raw = new Float64Array(n + 2);
    for (let k = 0; k < n; k++) raw[k + 1] = this.surface.deck(x0 + dx * k, y0 + dy * k);
    // connected non-straight bridge cells (flat decks) terminating the run take part in the envelope
    const bx0 = x0 - dx, by0 = y0 - dy, bx1 = x0 + dx * n, by1 = y0 + dy * n;
    const flat0 = this.connected(x0, y0, lowDir) && w.isBridge(bx0, by0);
    const flat1 = this.connected(bx1 - dx, by1 - dy, highDir) && w.isBridge(bx1, by1);
    raw[0] = flat0 ? this.surface.deck(bx0, by0) : -Infinity;
    raw[n + 1] = flat1 ? this.surface.deck(bx1, by1) : -Infinity;
    const D = new Float64Array(n);
    const step = MAX_DECK_GRADE * CELL;
    for (let k = 0; k < n; k++) {
      let h = -Infinity;
      for (let j = 0; j < n + 2; j++) {
        const v = raw[j] - step * Math.abs(k + 1 - j);
        if (v > h) h = v;
      }
      D[k] = h;
    }
    for (let k = 0; k < n; k++) {
      const x = x0 + dx * k, y = y0 + dy * k;
      const d = D[k];
      const e0 = k > 0 ? (D[k - 1] + d) * 0.5 : this.runEnd(x, y, d, lowDir, axis, flat0 ? raw[0] : NaN);
      const e1 = k < n - 1 ? (D[k + 1] + d) * 0.5 : this.runEnd(x, y, d, highDir, axis, flat1 ? raw[n + 1] : NaN);
      const i = y * w.size + x;
      this.runs.set(i, { axis, d, e0, e1 });
      this.mode[i] = Mode.Run;
    }
  }

  /** surface height at the outer edge of a run's end cell toward `dir` (NaN = follow terrain) */
  private runEnd(cx: number, cy: number, d: number, dir: number, axis: number, flatDeck: number): number {
    if (!this.connected(cx, cy, dir)) return d; // dead end on the deck
    if (!Number.isNaN(flatDeck)) return flatDeck; // flat junction / curve deck
    // land neighbour: it ramps up to us if it can (straight along our axis)
    const nx = cx + DIR_DX[dir], ny = cy + DIR_DY[dir];
    return this.straightAxis(nx, ny) === axis ? d : NaN;
  }

  /** drivable deck height at the center of bridge cell (x, y) */
  private deckAt(x: number, y: number): number {
    const m = this.classify(x, y);
    const i = y * this.world.size + x;
    if (m === Mode.Run) return this.runs.get(i)!.d;
    if (m === Mode.Flat) return this.flats.get(i)!;
    return this.surface.deck(x, y);
  }

  private classifyRamp(cx: number, cy: number, i: number): Mode {
    const w = this.world;
    const axis = this.straightAxis(cx, cy);
    if (axis < 0) return Mode.Plain;
    const dirs = axis === 0 ? [0, 2] : [3, 1];
    const edges: RampInfo['edges'] = [];
    for (const dir of dirs) {
      const dx = DIR_DX[dir], dy = DIR_DY[dir];
      // walk toward the bridge through straight, connected land cells
      let k = 1;
      let x = cx, y = cy;
      let found = false;
      for (; k <= MAX_RAMP_CELLS; k++) {
        if (!this.connected(x, y, dir)) break;
        const nx = cx + dx * k, ny = cy + dy * k;
        if (!w.inBounds(nx, ny)) break;
        if (w.isBridge(nx, ny)) {
          found = true;
          break;
        }
        if (this.straightAxis(nx, ny) !== axis) break;
        x = nx;
        y = ny;
      }
      if (!found) continue;
      const bx = cx + dx * k, by = cy + dy * k;
      const n = this.rampCells(bx, by, (dir + 2) & 3, axis);
      if (k > n) continue;
      const sign = dir === 1 || dir === 2 ? 1 : -1; // deck toward +axis?
      // deck edge: the bridge cell's border facing us
      const edgeAt = axis === 0 ? (sign > 0 ? by * CELL : (by + 1) * CELL) : sign > 0 ? bx * CELL : (bx + 1) * CELL;
      edges.push({ at: edgeAt, d: this.deckAt(bx, by), len: n * CELL, dir: sign });
    }
    if (!edges.length) return Mode.Plain;
    this.ramps.set(i, { axis, edges });
    return Mode.Ramp;
  }

  /**
   * Length (cells) of the approach ramp leading away from bridge cell (bx, by)
   * in direction `away`: long enough to keep the eased grade gentle, limited
   * by the straight land run available (split fairly with a bridge ahead).
   * 0 = the land neighbour cannot ramp (not straight / not connected).
   */
  private rampCells(bx: number, by: number, away: number, axis: number): number {
    const w = this.world;
    const dx = DIR_DX[away], dy = DIR_DY[away];
    if (!this.connected(bx, by, away)) return 0;
    let avail = 0;
    let x = bx, y = by;
    for (let j = 1; j <= MAX_RAMP_CELLS; j++) {
      const nx = bx + dx * j, ny = by + dy * j;
      if (!w.inBounds(nx, ny) || w.isBridge(nx, ny) || this.straightAxis(nx, ny) !== axis || !this.connected(x, y, away)) break;
      avail = j;
      x = nx;
      y = ny;
    }
    if (avail === 0) return 0;
    // another bridge further along the run: both ends share the land between them
    for (let j = avail + 1; j <= MAX_RAMP_CELLS * 2 + 1; j++) {
      const nx = bx + dx * j, ny = by + dy * j;
      if (!w.inBounds(nx, ny) || !w.roadAt(nx, ny)) break;
      if (w.isBridge(nx, ny)) {
        avail = Math.min(avail, Math.max(1, Math.floor((j - 1) / 2)));
        break;
      }
      if (this.straightAxis(nx, ny) !== axis) break;
    }
    const deck = this.deckAt(bx, by);
    const ex = axis === 1 ? (away === 1 ? (bx + 1) * CELL : bx * CELL) : (bx + 0.5) * CELL;
    const ez = axis === 0 ? (away === 2 ? (by + 1) * CELL : by * CELL) : (by + 0.5) * CELL;
    const rise = Math.abs(deck - (w.heightAt(ex, ez) + ROAD_LIFT));
    return Math.max(1, Math.min(avail, Math.ceil(rise / RISE_PER_CELL)));
  }
}
