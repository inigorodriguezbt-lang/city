// Rendered road surface height model (pure: no THREE / DOM, safe to move into
// world/roadHeight.ts or a worker).
//
// Plain road cells follow the bilinear terrain + ROAD_LIFT, exactly like
// RoadSurface.heightAt. Bridge cells use RoadSurface.deck(x, y) at their center
// and blend linearly toward the shared edge value of neighbouring bridge cells,
// so a run of decks is one continuous (piecewise-linear) ramp instead of a
// staircase. Straight land cells in line with a bridge end ramp smoothly from
// the terrain up to the deck (over one or two cells, smoothstep eased), so a
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
/** a bridge end steeper than this (m) gets a two-cell approach ramp */
const LONG_RAMP_RISE = 2.0;

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
    const d = this.surface.deck(cx, cy);
    const axis = this.straightAxis(cx, cy);
    if (axis < 0) {
      this.flats.set(i, d);
      return Mode.Flat;
    }
    const lowDir = axis === 0 ? 0 : 3; // N or W
    const highDir = axis === 0 ? 2 : 1; // S or E
    const e0 = this.bridgeEdge(cx, cy, d, lowDir, axis);
    const e1 = this.bridgeEdge(cx, cy, d, highDir, axis);
    this.runs.set(i, { axis, d, e0, e1 });
    return Mode.Run;
  }

  /** surface height at the edge of bridge cell toward `dir` (NaN = follow terrain) */
  private bridgeEdge(cx: number, cy: number, d: number, dir: number, axis: number): number {
    const w = this.world;
    if (!this.connected(cx, cy, dir)) return d;
    const nx = cx + DIR_DX[dir], ny = cy + DIR_DY[dir];
    if (w.isBridge(nx, ny)) {
      const nd = this.surface.deck(nx, ny);
      return this.straightAxis(nx, ny) === axis ? (d + nd) * 0.5 : nd;
    }
    // land neighbour: it ramps up to us if it is straight along our axis
    return this.straightAxis(nx, ny) === axis ? d : NaN;
  }

  private classifyRamp(cx: number, cy: number, i: number): Mode {
    const w = this.world;
    const axis = this.straightAxis(cx, cy);
    if (axis < 0) return Mode.Plain;
    const dirs = axis === 0 ? [0, 2] : [3, 1];
    const edges: RampInfo['edges'] = [];
    for (const dir of dirs) {
      const dx = DIR_DX[dir], dy = DIR_DY[dir];
      const sign = dir === 1 || dir === 2 ? 1 : -1; // deck toward +axis?
      // distance-1 bridge
      const n1x = cx + dx, n1y = cy + dy;
      if (w.isBridge(n1x, n1y) && this.connected(cx, cy, dir)) {
        const deck = this.deckEdgeToward(n1x, n1y);
        const edgeAt = axis === 0 ? (sign > 0 ? (cy + 1) * CELL : cy * CELL) : sign > 0 ? (cx + 1) * CELL : cx * CELL;
        const len = this.longRamp(cx, cy, dir, deck, edgeAt, axis) ? CELL * 2 : CELL;
        edges.push({ at: edgeAt, d: deck, len, dir: sign });
        continue;
      }
      // distance-2 bridge through a straight land neighbour needing a long ramp
      const n2x = cx + 2 * dx, n2y = cy + 2 * dy;
      if (!w.isBridge(n1x, n1y) && w.isBridge(n2x, n2y) && this.connected(cx, cy, dir) && this.straightAxis(n1x, n1y) === axis && this.connected(n1x, n1y, dir)) {
        const deck = this.deckEdgeToward(n2x, n2y);
        const edgeAt = axis === 0 ? (sign > 0 ? (cy + 2) * CELL : (cy - 1) * CELL) : sign > 0 ? (cx + 2) * CELL : (cx - 1) * CELL;
        if (this.longRamp(n1x, n1y, dir, deck, edgeAt, axis)) edges.push({ at: edgeAt, d: deck, len: CELL * 2, dir: sign });
      }
    }
    if (!edges.length) return Mode.Plain;
    this.ramps.set(i, { axis, edges });
    return Mode.Ramp;
  }

  /**
   * Deck height of bridge cell (bx, by) at its edge facing the ramping land
   * cell. A straight deck stays flat up to a ramping neighbour (bridgeEdge
   * returns the center deck there) and a non-straight deck is flat anyway.
   */
  private deckEdgeToward(bx: number, by: number): number {
    return this.surface.deck(bx, by);
  }

  /**
   * Whether the ramp starting at land cell (rx, ry) (adjacent to the deck edge
   * at `edgeAt`) should extend over a second cell away from the bridge.
   */
  private longRamp(rx: number, ry: number, dirToBridge: number, deck: number, edgeAt: number, axis: number): boolean {
    const w = this.world;
    const ex = axis === 1 ? edgeAt : (rx + 0.5) * CELL;
    const ez = axis === 0 ? edgeAt : (ry + 0.5) * CELL;
    if (Math.abs(deck - (w.heightAt(ex, ez) + ROAD_LIFT)) <= LONG_RAMP_RISE) return false;
    const away = (dirToBridge + 2) & 3;
    const dx = DIR_DX[away], dy = DIR_DY[away];
    if (!this.connected(rx, ry, away)) return false;
    // cells at distance 1..3 away from the ramp start must be plain land (gap >= 4 to the next bridge)
    for (let k = 1; k <= 3; k++) {
      const x = rx + dx * k, y = ry + dy * k;
      if (!w.inBounds(x, y)) return k > 1;
      if (w.isBridge(x, y)) return false;
      if (k === 1 && (w.roadAt(x, y) === RoadType.None || this.straightAxis(x, y) !== axis)) return false;
    }
    return true;
  }
}
