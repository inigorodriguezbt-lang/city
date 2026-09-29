// Block composer: a multi-storey rectangular volume with a styled base,
// optional distinct ground storey (shopfront / lobby), string courses,
// cornice and any roof family. Every zoned generator is built from these.
import type { ColorLike } from '../ModelBuilder';
import type { MatKey } from '../types';
import { FLOOR, LodFacade, SHOP_H } from './constants';
import { BLANK, type Fab } from './fab';
import { GROUND, ROUND_ATTIC, cornice, dome, flatRoof, gableRoof, hipRoof, mansardRoof, pagodaRoof, richCornice, shedRoof } from './parts';
import type { RoofShape, StyleKit } from './style';
import { type Col, cl, shade } from './util';

export interface BlockSpec {
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** bottom of the first storey (usually 0) */
  y0?: number;
  floors: number;
  fh: number;
  mat: MatKey;
  color: ColorLike;
  code: number;
  /** distinct ground storey */
  ground?: { mat: MatKey; color: ColorLike; code: number; h: number };
  roof: RoofShape | 'none';
  roofMat?: MatKey;
  roofColor?: ColorLike;
  /** pitched roof rise (m) — default from footprint */
  rise?: number;
  ridgeAlongX?: boolean;
  parapet?: number;
  /** cornice colour (null/undefined = no cornice) */
  cornice?: ColorLike | null;
  /** rich (multi-band) cornice */
  richCornice?: boolean;
  /** string course between ground and upper storeys */
  band?: ColorLike | null;
  /** visible sides (party walls can be hidden) */
  sides?: { n?: boolean; e?: boolean; s?: boolean; w?: boolean };
  trim?: ColorLike;
  /** facade flags used for mansard dormers */
  dormerFlags?: number;
  /** eave overhang for pitched roofs */
  overhang?: number;
  /** roof colour for flat roofs */
  flatColor?: ColorLike;
  /** pagoda tiers */
  tiers?: number;
  /** gable attic window code (0 = none) */
  attic?: number;
  /** LOD facade override */
  lod?: LodFacade;
}

export interface BlockOut {
  /** top of the walls (eave / roof deck) */
  eave: number;
  /** highest point */
  top: number;
}

/** Draw a styled block; returns eave and top heights. */
export function block(f: Fab, s: BlockSpec): BlockOut {
  const y0 = s.y0 ?? 0;
  const gh = s.ground?.h ?? 0;
  const upperFloors = s.ground ? s.floors - 1 : s.floors;
  const eave = y0 + gh + upperFloors * s.fh;
  const base = y0 - (y0 <= GROUND + 0.01 ? 2.5 : 0);
  // ground storey
  if (s.ground) {
    const g = s.ground;
    f.fbox(g.mat, g.code, s.cx, base, s.cz, s.w, s.d, y0 + gh - base, g.color, { fh: g.mat === 'wall_shop' ? SHOP_H * (gh / SHOP_H) : gh, base: y0, top: false, sides: s.sides, lod: s.lod, noMass: false, lodRoof: s.roofColor ?? s.color });
  }
  const uy = s.ground ? y0 + gh : base;
  if (upperFloors > 0) {
    // storey 0 starts at y0 (or storey 1 above a distinct ground floor)
    f.fbox(s.mat, s.code, s.cx, uy, s.cz, s.w, s.d, eave - uy, s.color, {
      fh: s.fh,
      base: s.ground ? y0 + gh : y0,
      vBase: s.ground ? FLOOR : 0,
      top: s.roof === 'flat' || s.roof === 'none' ? 'roof_flat' : false,
      topColor: s.flatColor ?? '#8d8a84',
      sides: s.sides,
      lod: s.lod,
      lodRoof: s.roof === 'flat' || s.roof === 'none' ? s.flatColor ?? '#8d8a84' : s.roofColor,
    });
  }
  if (s.band && s.ground) cornice(f, s.cx, s.cz, s.w, s.d, y0 + gh - 0.05, 0.35, 0.12, s.band, s.sides);
  let top = eave;
  if (s.cornice && (s.roof === 'flat' || s.roof === 'none' || s.roof === 'mansard')) {
    if (s.richCornice) richCornice(f, s.cx, s.cz, s.w, s.d, eave - 0.25, s.cornice);
    else cornice(f, s.cx, s.cz, s.w, s.d, eave - 0.3, 0.4, 0.22, s.cornice, s.sides);
  }
  top = roof(f, s, eave);
  return { eave, top };
}

/** Roof over a block footprint starting at `eave`; returns the highest point. */
export function roof(f: Fab, s: BlockSpec, eave: number): number {
  const short = Math.min(s.w, s.d);
  const rm = s.roofMat ?? 'roof_tile';
  const rc = s.roofColor ?? '#8a4a36';
  const trim = s.trim ?? '#f2efe6';
  switch (s.roof) {
    case 'gable': {
      const rise = s.rise ?? short * 0.38;
      gableRoof(f, { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y: eave, rise, mat: rm, color: rc, wallMat: s.mat, wallColor: s.color, fh: s.fh, trim, alongX: s.ridgeAlongX, overhang: s.overhang, attic: s.attic ?? ROUND_ATTIC });
      return eave + rise;
    }
    case 'hip': {
      const rise = s.rise ?? short * 0.3;
      hipRoof(f, { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y: eave, rise, mat: rm, color: rc, trim, overhang: s.overhang });
      return eave + rise;
    }
    case 'mansard':
      return mansardRoof(f, { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y: eave, rise: 0, mat: rm, color: rc, trim: s.cornice ?? trim, wallMat: s.mat, wallColor: s.color, lowerH: Math.min(3.2, s.fh * 0.95), dormerFlags: s.dormerFlags ?? 0, dormerColor: s.color });
    case 'pagoda': {
      const rise = s.rise ?? short * 0.28;
      pagodaRoof(f, { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y: eave, rise, mat: rm, color: rc, overhang: s.overhang ?? 1.1, wallMat: s.mat, wallColor: s.color }, s.tiers ?? 1);
      return eave + rise + 1;
    }
    case 'shed': {
      const rise = s.rise ?? short * 0.18;
      shedRoof(f, { cx: s.cx, cz: s.cz, w: s.w, d: s.d, y: eave, rise, mat: rm, color: rc, wallMat: s.mat, wallColor: s.color, fh: s.fh, trim: s.trim ?? '#34383c', overhang: s.overhang });
      return eave + rise;
    }
    case 'dome': {
      flatRoof(f, s.cx, s.cz, s.w, s.d, eave, s.parapet ?? 0.9, s.mat, s.color, s.flatColor ?? '#8d8a84', trim, s.fh);
      const r = Math.min(short * 0.32, 9);
      dome(f, s.cx, eave, s.cz, r, 'roof_metal', rc, s.cornice ?? trim);
      return eave + r * 2.2;
    }
    case 'flat':
      flatRoof(f, s.cx, s.cz, s.w, s.d, eave, s.parapet ?? 0.8, s.mat, s.color, s.flatColor ?? '#8d8a84', s.cornice ?? shade(cl(s.color), 0.9), s.fh);
      return eave + (s.parapet ?? 0.8);
    default:
      return eave;
  }
}

/** Plinth / base course band (darker) wrapping the bottom of a block. */
export function plinth(f: Fab, cx: number, cz: number, w: number, d: number, h: number, color: Col, mat: MatKey = 'wall_stone'): void {
  f.m(BLANK).box(mat, cx, -1.5, cz, w + 0.12, h + 1.5, d + 0.12, color, { top: 'concrete', topColor: shade(color, 1.05) });
}

/** Vertical piers (art deco / classical) on a face: thin boxes proud of the wall. */
export function piers(f: Fab, x0: number, x1: number, z: number, y0: number, y1: number, n: number, w: number, color: ColorLike, depth = 0.25): void {
  const B = f.m();
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    B.box('plain', x, y0, z + depth / 2, w, y1 - y0, depth, color, { sides: { n: false } });
  }
}

/** Horizontal spandrel/slab bands (modern) wrapping a block at each floor line. */
export function floorBands(f: Fab, cx: number, cz: number, w: number, d: number, y0: number, floors: number, fh: number, h: number, proj: number, color: ColorLike, every = 1): void {
  for (let i = every; i <= floors; i += every) cornice(f, cx, cz, w, d, y0 + i * fh - h, h, proj, color);
}
