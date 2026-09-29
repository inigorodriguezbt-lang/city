// ─────────────────────────────────────────────────────────────────────────────
// Shared state threaded through every map generation stage.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, MAP_SIZES, WATER_EPS } from '../../core/constants';
import { Noise } from '../../core/noise';
import { RNG, hash2, hashString } from '../../core/rng';
import type { Cell, MapSettings, OutsideConnection, ThemeDef } from '../../core/types';
import { themeDef } from '../../data/themes';
import { clampf } from './grid';

export type ProgressFn = (p: number, label: string) => void;

/** A hand-designed watercourse (major river / fjord / glacial valley) in CELL coordinates. */
export interface DesignedPath {
  kind: 'river' | 'fjord' | 'valley';
  /** polyline x,y pairs in cell units (vertex grid space: 0..size) */
  pts: Float32Array;
  /** cumulative arc length (cells) per point */
  arc: Float32Array;
  /** total arc length (cells) */
  length: number;
  /** river only: extra upstream catchment (cells) entering at the first point from off-map */
  inflow: number;
  /** river only: [s0, s1] normalised arc ranges occupied by designed lakes (trench is not cut there) */
  lakeSpans: [number, number][];
}

/** Macro layout decided by the theme shaper and consumed by later stages. */
export interface Layout {
  hasSea: boolean;
  /** map edge facing the open sea (coastal themes), else -1 */
  seaEdge: number;
  /** edges the highway may enter from, in preference order */
  highwayEdges: number[];
  /** designed rivers (routed by hydrology via inflow + trench) */
  rivers: DesignedPath[];
  /** desired centre of the city start area (cells) */
  startX: number;
  startY: number;
  /** radius (cells) of the guaranteed gentle region around the start */
  buildRadius: number;
}

export interface GenParams {
  theme: ThemeDef;
  settings: MapSettings;
  size: number;
  /** 0..1 user sliders (clamped) */
  mountains: number;
  water: number;
  forests: number;
  /** terrain relief multiplier derived from theme + slider (~0.4..1.6) */
  relief: number;
}

export class GenContext {
  readonly params: GenParams;
  readonly size: number;
  /** vertices per edge (size + 1) */
  readonly V: number;
  readonly nV: number;
  readonly nC: number;
  /** meters across the map */
  readonly extent: number;
  readonly seed: number;

  // ── products ─────────────────────────────────────────────────────────────
  heights: Float32Array;
  water: Float32Array;
  seaLevel = 0;
  trees: Uint8Array;
  fertility: Uint8Array;
  forest: Uint8Array;
  ore: Uint8Array;
  oil: Uint8Array;
  wind: Uint8Array;
  connections: OutsideConnection[] = [];
  highway: Cell[] = [];
  rail: Cell[] = [];
  start: Cell;

  // ── intermediate state shared between stages ────────────────────────────
  layout!: Layout;
  /** per-cell water body class: 0 dry, 1 ocean, 2 lake, 3 river (wet or bank fringe) */
  waterKind: Uint8Array;
  /** per-cell flow accumulation (cells, rain-weighted, incl. off-map inflow) */
  flow: Float32Array;
  /** per-cell distance (cells) to the nearest wet cell (computed after hydrology) */
  waterDist: Float32Array | null = null;
  /** per-cell mask of cells occupied by highway/rail (1 highway, 2 rail) */
  routeMask: Uint8Array;
  /** height at which the terrain is considered alpine rock/snow (m) */
  treeLine = 1e9;

  private progressFn: ProgressFn | undefined;
  private stageStart = 0;
  private stageSpan = 0;
  private stageLabel = '';
  private lastReport = -1;

  constructor(settings: MapSettings, onProgress?: ProgressFn) {
    const size = MAP_SIZES[settings.mapSize] ?? MAP_SIZES.medium;
    const theme = themeDef(settings.theme);
    const mountains = clampf(Number.isFinite(settings.mountains) ? settings.mountains : 0.5, 0, 1);
    const water = clampf(Number.isFinite(settings.water) ? settings.water : 0.5, 0, 1);
    const forests = clampf(Number.isFinite(settings.forests) ? settings.forests : 0.5, 0, 1);
    this.params = {
      theme, settings, size, mountains, water, forests,
      relief: 0.45 + 1.1 * mountains,
    };
    this.size = size;
    this.V = size + 1;
    this.nV = this.V * this.V;
    this.nC = size * size;
    this.extent = size * CELL;
    this.seed = hash2(settings.seed >>> 0, hashString(theme.id)) ^ hash2(size, 0x51ed);
    this.heights = new Float32Array(this.nV);
    this.water = new Float32Array(this.nC).fill(-1e4);
    this.trees = new Uint8Array(this.nC);
    this.fertility = new Uint8Array(this.nC);
    this.forest = new Uint8Array(this.nC);
    this.ore = new Uint8Array(this.nC);
    this.oil = new Uint8Array(this.nC);
    this.wind = new Uint8Array(this.nC);
    this.waterKind = new Uint8Array(this.nC);
    this.flow = new Float32Array(this.nC);
    this.routeMask = new Uint8Array(this.nC);
    this.start = { x: size >> 1, y: size >> 1 };
    this.progressFn = onProgress;
  }

  /** Independent deterministic RNG stream for a named purpose. */
  rng(purpose: string): RNG {
    return new RNG(hash2(this.seed, hashString(purpose)));
  }

  /** Independent deterministic noise generator for a named purpose. */
  noise(purpose: string): Noise {
    return new Noise(hash2(this.seed ^ 0x7f4a7c15, hashString(purpose)));
  }

  // ── progress ────────────────────────────────────────────────────────────
  /** Begin a stage occupying [start, end) of the overall progress bar. */
  stage(label: string, start: number, end: number): void {
    this.stageLabel = label;
    this.stageStart = start;
    this.stageSpan = end - start;
    this.lastReport = -1;
    this.report(0);
  }

  /** Report progress within the current stage (0..1). Throttled to ~1% steps. */
  report(frac: number): void {
    const p = this.stageStart + this.stageSpan * clampf(frac, 0, 1);
    if (p - this.lastReport < 0.008 && frac > 0 && frac < 1) return;
    this.lastReport = p;
    this.progressFn?.(clampf(p, 0, 1), this.stageLabel);
  }

  // ── indexing helpers ────────────────────────────────────────────────────
  vi(x: number, y: number): number {
    return y * this.V + x;
  }
  ci(x: number, y: number): number {
    return y * this.size + x;
  }
  cellHeight(x: number, y: number): number {
    const V = this.V, h = this.heights, i = y * V + x;
    return (h[i] + h[i + 1] + h[i + V] + h[i + V + 1]) * 0.25;
  }
  isWet(ci: number, cellH: number): boolean {
    return this.water[ci] > cellH + WATER_EPS;
  }
}
