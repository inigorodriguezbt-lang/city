// ─────────────────────────────────────────────────────────────────────────────
// Per-job scene for the field engine: the unpacked grid layers, building
// records rasterised into a cell → record index, and the terrain-derived
// static layers (cell heights, slope, water mask, shore distance, "view"
// elevation) which are rebuilt only when the main thread sends new terrain.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, WATER_EPS } from '../../core/constants';
import { BlurScratch, blurInPlace, distanceToMask } from './grid';
import {
  REC_F, REC_I, RI_H, RI_META, RI_W, RI_X, RI_Y, STOP_STRIDE, type FieldJob, type TerrainPacket, type WeatherPacket,
} from './protocol';

/** Cap for shore distance (cells); cells farther away hold this value. */
export const SHORE_CAP = 12;

export class TerrainState {
  readonly n: number;
  /** average of the 4 corner heights (m) */
  cellH: Float32Array;
  /** (max - min) corner height / CELL */
  slope: Float32Array;
  /** water surface elevation (flood offset applied) */
  surf: Float32Array;
  /** 1 = water cell */
  wet: Uint8Array;
  /** Chebyshev distance to the nearest water cell, capped at SHORE_CAP */
  shoreDist: Uint8Array;
  /** 0..1 how much a cell rises above its surroundings (view bonus) */
  elev: Float32Array;

  constructor(readonly s: number) {
    const n = (this.n = s * s);
    this.cellH = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.surf = new Float32Array(n).fill(-1e4);
    this.wet = new Uint8Array(n);
    this.shoreDist = new Uint8Array(n).fill(SHORE_CAP);
    this.elev = new Float32Array(n);
  }

  /** Rebuild every derived layer from a terrain packet. */
  apply(p: TerrainPacket, blur: BlurScratch): void {
    const s = this.s, s1 = s + 1, H = p.heights, W = p.water;
    const { cellH, slope, wet } = this;
    this.surf.set(W);
    for (let y = 0; y < s; y++) {
      let v = y * s1;
      let o = y * s;
      for (let x = 0; x < s; x++, v++, o++) {
        const a = H[v], b = H[v + 1], c = H[v + s1], d = H[v + s1 + 1];
        const h = (a + b + c + d) * 0.25;
        cellH[o] = h;
        const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
        slope[o] = (hi - lo) / CELL;
        wet[o] = W[o] > h + WATER_EPS ? 1 : 0;
      }
    }
    distanceToMask(wet, this.shoreDist, s, s, SHORE_CAP);
    // local relief: height above the regional (blurred) surface
    const regional = this.elev;
    regional.set(cellH);
    blurInPlace(regional, blur, 12, 3);
    for (let i = 0; i < this.n; i++) {
      const r = (cellH[i] - regional[i]) / 28;
      regional[i] = wet[i] ? 0 : r <= 0 ? 0 : r >= 1 ? 1 : r;
    }
  }
}

/** Unpacked job inputs plus the building raster, valid for one compute run. */
export class Scene {
  readonly n: number;
  road!: Uint8Array;
  roadFlags!: Uint8Array;
  zone!: Uint8Array;
  trees!: Uint8Array;
  traffic!: Uint8Array;
  recI!: Int32Array;
  recF!: Float32Array;
  count = 0;
  stops!: Float32Array;
  stopCount = 0;
  weather!: WeatherPacket;
  rainfall = 0.5;
  full = false;
  /** in-game days since the previous job */
  days = 1;
  /** record index occupying each cell, -1 = none */
  bidx: Int32Array;

  constructor(readonly s: number, readonly terrain: TerrainState) {
    this.n = s * s;
    this.bidx = new Int32Array(this.n).fill(-1);
  }

  load(job: FieldJob): void {
    this.road = job.road;
    this.roadFlags = job.roadFlags;
    this.zone = job.zone;
    this.trees = job.trees;
    this.traffic = job.traffic;
    this.recI = job.recI;
    this.recF = job.recF;
    this.count = Math.min(job.count, Math.floor(job.recI.length / REC_I), Math.floor(job.recF.length / REC_F));
    this.stops = job.stops;
    this.stopCount = Math.min(job.stopCount, Math.floor(job.stops.length / STOP_STRIDE));
    this.weather = job.weather;
    this.rainfall = job.rainfall;
    this.full = job.full;
    this.days = job.days > 0 ? job.days : 0;
    this.rasterize();
  }

  private rasterize(): void {
    const { s, bidx, recI, count } = this;
    bidx.fill(-1);
    for (let r = 0; r < count; r++) {
      const o = r * REC_I;
      const x0 = Math.max(0, recI[o + RI_X]), y0 = Math.max(0, recI[o + RI_Y]);
      const x1 = Math.min(s, recI[o + RI_X] + recI[o + RI_W]), y1 = Math.min(s, recI[o + RI_Y] + recI[o + RI_H]);
      for (let y = y0; y < y1; y++) bidx.fill(r, y * s + x0, y * s + x1);
    }
  }

  // ── record helpers ─────────────────────────────────────────────────────
  meta(r: number): number {
    return this.recI[r * REC_I + RI_META];
  }
  /** clamp footprint to the map: [x0, y0, x1, y1) */
  rect(r: number, out: Int32Array): boolean {
    const o = r * REC_I, s = this.s;
    out[0] = Math.max(0, this.recI[o + RI_X]);
    out[1] = Math.max(0, this.recI[o + RI_Y]);
    out[2] = Math.min(s, this.recI[o + RI_X] + this.recI[o + RI_W]);
    out[3] = Math.min(s, this.recI[o + RI_Y] + this.recI[o + RI_H]);
    return out[2] > out[0] && out[3] > out[1];
  }
}
