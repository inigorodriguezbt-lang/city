// Style kits: how each of the 8 architectural styles dresses a building —
// wall materials per building class, palettes per material, window facade
// codes, roof families, trims and signature details.
import type { RNG } from '../../../core/rng';
import type { StyleDef, StyleId } from '../../../core/types';
import type { MatKey } from '../types';
import { STYLE_INDEX, WF, WinKind, facCode } from './constants';
import { type Col, col, jitter, pickCol, shade } from './util';

export type RoofShape = StyleDef['roofs'][number];
export type BClass = 'house' | 'apt' | 'tower' | 'shop' | 'office';

export interface StyleKit {
  id: StyleId;
  idx: number;
  def: StyleDef;
  /** weighted wall materials by building class */
  walls: Record<BClass, [MatKey, number][]>;
  /** pitched roof covering */
  pitched: MatKey[];
  /** residential storey height (m) */
  fh: number;
  /** extra ornament (cornices, surrounds) */
  ornate: number;
  /** shutters probability on houses */
  shutters: number;
}

const KITS: Record<StyleId, Omit<StyleKit, 'def' | 'idx' | 'id'>> = {
  american: {
    walls: {
      house: [['wall_wood', 6], ['wall_brick', 2.5], ['wall_plaster', 1.2]],
      apt: [['wall_brick', 7], ['wall_concrete', 1.2], ['wall_plaster', 1.2]],
      tower: [['wall_glass', 4], ['wall_office', 3], ['wall_brick', 1.5], ['wall_concrete', 1.5]],
      shop: [['wall_brick', 6], ['wall_plaster', 2], ['wall_wood', 1]],
      office: [['wall_glass', 5], ['wall_office', 4], ['wall_stone', 1]],
    },
    pitched: ['roof_shingle', 'roof_shingle', 'roof_shingle', 'roof_metal'],
    fh: 3.0,
    ornate: 0.5,
    shutters: 0.55,
  },
  european: {
    walls: {
      house: [['wall_plaster', 8], ['wall_stone', 1], ['wall_brick', 1.2]],
      apt: [['wall_plaster', 7], ['wall_stone', 2], ['wall_brick', 1]],
      tower: [['wall_concrete', 3.5], ['wall_plaster', 2.5], ['wall_glass', 2], ['wall_office', 2]],
      shop: [['wall_plaster', 6], ['wall_stone', 3]],
      office: [['wall_office', 4], ['wall_glass', 4], ['wall_stone', 2]],
    },
    pitched: ['roof_tile', 'roof_tile', 'roof_tile', 'roof_shingle'],
    fh: 3.1,
    ornate: 0.8,
    shutters: 0.45,
  },
  mediterranean: {
    walls: {
      house: [['wall_plaster', 10], ['wall_stone', 1]],
      apt: [['wall_plaster', 9], ['wall_stone', 1]],
      tower: [['wall_plaster', 4], ['wall_concrete', 3], ['wall_glass', 2]],
      shop: [['wall_plaster', 8], ['wall_stone', 2]],
      office: [['wall_office', 4], ['wall_glass', 3], ['wall_plaster', 2]],
    },
    pitched: ['roof_tile'],
    fh: 3.0,
    ornate: 0.5,
    shutters: 0.75,
  },
  nordic: {
    walls: {
      house: [['wall_wood', 9], ['wall_plaster', 1]],
      apt: [['wall_brick', 4], ['wall_wood', 3], ['wall_plaster', 3]],
      tower: [['wall_brick', 3], ['wall_concrete', 3], ['wall_glass', 2], ['wall_wood', 2]],
      shop: [['wall_wood', 4], ['wall_plaster', 4], ['wall_brick', 2]],
      office: [['wall_glass', 5], ['wall_office', 3], ['wall_brick', 2]],
    },
    pitched: ['roof_metal', 'roof_metal', 'roof_shingle', 'roof_tile'],
    fh: 3.0,
    ornate: 0.2,
    shutters: 0,
  },
  asian: {
    walls: {
      house: [['wall_plaster', 6], ['wall_wood', 4]],
      apt: [['wall_concrete', 5], ['wall_plaster', 5], ['wall_office', 1]],
      tower: [['wall_concrete', 3.5], ['wall_glass', 3.5], ['wall_office', 3]],
      shop: [['wall_plaster', 5], ['wall_concrete', 5]],
      office: [['wall_glass', 5], ['wall_office', 4]],
    },
    pitched: ['roof_tile', 'roof_tile', 'roof_metal'],
    fh: 2.9,
    ornate: 0.3,
    shutters: 0,
  },
  artdeco: {
    walls: {
      house: [['wall_plaster', 5], ['wall_stone', 3], ['wall_brick', 2]],
      apt: [['wall_stone', 4], ['wall_brick', 4], ['wall_plaster', 2]],
      tower: [['wall_stone', 5], ['wall_brick', 2], ['wall_office', 3]],
      shop: [['wall_stone', 5], ['wall_plaster', 5]],
      office: [['wall_stone', 6], ['wall_office', 3], ['wall_glass', 1]],
    },
    pitched: ['roof_tile', 'roof_metal'],
    fh: 3.2,
    ornate: 1,
    shutters: 0,
  },
  modern: {
    walls: {
      house: [['wall_plaster', 5], ['wall_wood', 3], ['wall_concrete', 2]],
      apt: [['wall_plaster', 4], ['wall_concrete', 3], ['wall_wood', 1.5], ['wall_glass', 1.5]],
      tower: [['wall_glass', 6], ['wall_concrete', 2.5], ['wall_office', 1.5]],
      shop: [['wall_concrete', 4], ['wall_plaster', 4], ['wall_wood', 2]],
      office: [['wall_glass', 7], ['wall_office', 3]],
    },
    pitched: ['roof_metal', 'roof_metal', 'roof_shingle'],
    fh: 3.1,
    ornate: 0.1,
    shutters: 0,
  },
  futuristic: {
    walls: {
      house: [['wall_plaster', 6], ['wall_glass', 2], ['wall_concrete', 2]],
      apt: [['wall_plaster', 5], ['wall_glass', 5]],
      tower: [['wall_glass', 9], ['wall_office', 1]],
      shop: [['wall_plaster', 5], ['wall_glass', 5]],
      office: [['wall_glass', 9], ['wall_office', 1]],
    },
    pitched: ['roof_metal'],
    fh: 3.2,
    ornate: 0,
    shutters: 0,
  },
};

const cache = new Map<StyleId, StyleKit>();
export function styleKit(def: StyleDef): StyleKit {
  let k = cache.get(def.id);
  if (!k) {
    const base = KITS[def.id] ?? KITS.american;
    k = { ...base, id: def.id, idx: STYLE_INDEX[def.id] ?? 0, def };
    cache.set(def.id, k);
  }
  return k;
}

export function pickWall(k: StyleKit, cls: BClass, rng: RNG): MatKey {
  const list = k.walls[cls];
  return rng.weighted(list.map((l) => l[0]), list.map((l) => l[1]));
}

// ── palettes per material ─────────────────────────────────────────────────
const BRICKS: Record<string, string[]> = {
  default: ['#9e4f3b', '#a9583f', '#8c4533', '#b56a4c', '#7f4030', '#a86248'],
  nordic: ['#8a3b2e', '#6e3a30', '#9b5a3f', '#b89a78', '#5a3a30'],
  artdeco: ['#b88a64', '#a0674a', '#c7a07a', '#8a5a40', '#d0b08a'],
  european: ['#a9583f', '#b86a4a', '#9a4a36', '#c28a64'],
  american: ['#9e4f3b', '#8c4533', '#a9583f', '#7a3f30', '#b06a52', '#6f5a4e'],
};
const STONES: Record<string, string[]> = {
  default: ['#d8ccb4', '#cbbd9f', '#e2d8c3', '#bfb4a0', '#d6c7a6'],
  artdeco: ['#e6d8bd', '#d9c8a4', '#cfc3ae', '#e8dcc2', '#c9b690'],
  mediterranean: ['#e6d6b6', '#dcc49a', '#efe2c8'],
};
const CONCRETES: Record<string, string[]> = {
  default: ['#c9c6be', '#b9b6ae', '#d6d3cb', '#a9a7a2', '#cfc9bc'],
  asian: ['#e9e6df', '#cfd6d9', '#d8cbb6', '#b9c2c4', '#efe8dc', '#c8c2b0'],
  modern: ['#e4e2dc', '#cfcdc6', '#8c8f93', '#b7b3aa', '#f0efea'],
};
const GLASS: Record<string, string[]> = {
  default: ['#8fb6cc', '#7fa8c0', '#9dc1cf', '#88a9b8', '#a3bcc4', '#6f98b4', '#9fb2a8'],
  futuristic: ['#a9d6e8', '#8fd0dc', '#b7c7e6', '#c3e3ea', '#9ec5f0'],
  artdeco: ['#8aa0a6', '#9d9a86', '#7f9aa3'],
  modern: ['#8fb0c0', '#7c98a8', '#9fb8b8', '#6a8898', '#b0c0c4'],
  asian: ['#7fa8c0', '#86b8b8', '#9fb0cc', '#6f9cb4'],
};
const WOODS: Record<string, string[]> = {
  american: ['#f0ece2', '#e4ddd0', '#c8d3da', '#9fb4c7', '#d9cfae', '#b7c4a8', '#e8d8b8', '#f4f1ea', '#b9c9c4', '#d8c7a6'],
  nordic: ['#a8342a', '#b3342c', '#e4c35a', '#f0ede6', '#3f5f7a', '#6f8f6a', '#d9d2c5', '#2b2d30', '#c9803a', '#8a9aa6'],
  modern: ['#b88b5a', '#a67a4c', '#8a6a4a', '#c49a6a', '#6e5a48', '#3a3632'],
  asian: ['#6b4a32', '#7a5638', '#5a4030', '#8a6a4a'],
  default: ['#c9a57a', '#b08a5a', '#e0d6c4', '#9a7a58'],
};

function pal(map: Record<string, string[]>, id: string): string[] {
  return map[id] ?? map.default;
}

/** Wall colour appropriate for a material in a style. */
export function wallColor(k: StyleKit, mat: MatKey, rng: RNG): Col {
  switch (mat) {
    case 'wall_brick': return pickCol(rng, pal(BRICKS, k.id), 0.05);
    case 'wall_stone': return pickCol(rng, pal(STONES, k.id), 0.03);
    case 'wall_concrete': return pickCol(rng, pal(CONCRETES, k.id), 0.03);
    case 'wall_glass': return pickCol(rng, pal(GLASS, k.id), 0.04);
    case 'wall_wood': return pickCol(rng, pal(WOODS, k.id), 0.04);
    case 'wall_office': return pickCol(rng, k.id === 'artdeco' ? pal(STONES, 'artdeco') : pal(CONCRETES, k.id === 'asian' ? 'asian' : 'default'), 0.03);
    case 'wall_industrial': return pickCol(rng, ['#c9ccce', '#aeb4b8', '#d8d6cf', '#8fa1ad', '#b8bdb0', '#d1c7b5', '#7a8a96', '#b04a3a'], 0.03);
    case 'wall_shop': return pickCol(rng, k.def.wallColors, 0.04);
    default: {
      // plaster / render
      if (k.id === 'mediterranean') return pickCol(rng, rng.chance(0.65) ? ['#f7f3ea', '#f5efe0', '#f2ede2'] : k.def.wallColors, 0.02);
      if (k.id === 'futuristic') return pickCol(rng, ['#f2f5f7', '#e8eef2', '#dfe7ec', '#f5f5f2'], 0.02);
      if (k.id === 'modern') return pickCol(rng, ['#f2f2f0', '#e8e6e1', '#d6d6d2', '#f5f3ee', '#3d4145'], 0.02);
      return pickCol(rng, k.def.wallColors, 0.04);
    }
  }
}

export function roofColor(k: StyleKit, mat: MatKey, rng: RNG): Col {
  if (mat === 'roof_tile' && (k.id === 'european' || k.id === 'mediterranean')) return pickCol(rng, ['#b04e32', '#a4452f', '#c0633b', '#9a4430', '#b5552f', '#8e3b2a'], 0.05);
  if (mat === 'roof_tile' && k.id === 'asian') return pickCol(rng, ['#3c4a55', '#2d3f3a', '#4a4a4e', '#5b3a2e'], 0.04);
  if (mat === 'roof_metal' && k.id === 'nordic') return pickCol(rng, ['#25282c', '#2f3236', '#3a3d42', '#4a2a26'], 0.03);
  if (mat === 'roof_metal') return pickCol(rng, ['#5f666e', '#4a4f57', '#7a8088', '#3b4a5a', '#5a4038'], 0.03);
  return pickCol(rng, k.def.roofColors, 0.04);
}

export function trimColor(k: StyleKit, rng: RNG): Col {
  return col(rng.pick(k.def.trimColors));
}

/** light trim for window surrounds / cornices on masonry */
export function lightTrim(k: StyleKit, rng: RNG): Col {
  if (k.id === 'artdeco') return pickCol(rng, ['#efe6d0', '#e8dcc0'], 0.02);
  if (k.id === 'nordic' || k.id === 'modern' || k.id === 'futuristic') return col('#f4f2ec');
  return pickCol(rng, ['#f1ece0', '#ebe4d4', '#e6dfd0', '#f4f1ea'], 0.02);
}

/** darker accent for bases / plinths */
export function baseColor(c: Col, rng: RNG): Col {
  return jitter(shade(c, 0.72), rng, 0.03);
}

// ── window facade codes ──────────────────────────────────────────────────
/** Houses (1-3 floors). */
export function houseWindows(k: StyleKit, mat: MatKey, rng: RNG): number {
  const sh = rng.chance(k.shutters) ? WF.Shutters : 0;
  switch (k.id) {
    case 'american': return facCode(rng.chance(0.25) ? WinKind.Paired : WinKind.Single, 0.95, 1.5, WF.Lites | sh);
    case 'european': return facCode(WinKind.Single, 1.05, 1.65, (rng.chance(0.5) ? WF.Surround : 0) | sh | (rng.chance(0.4) ? WF.Lites : 0));
    case 'mediterranean': return facCode(WinKind.Single, 0.95, 1.45, (rng.chance(0.5) ? WF.Arched : 0) | WF.Shutters);
    case 'nordic': return facCode(rng.chance(0.3) ? WinKind.Paired : WinKind.Single, 1.0, 1.35, WF.Lites | (mat === 'wall_wood' ? WF.AltBase : 0));
    case 'asian': return facCode(WinKind.Single, 1.45, 1.3, WF.DarkFrame | (mat === 'wall_wood' ? WF.AltBase : 0));
    case 'artdeco': return facCode(WinKind.Single, 0.95, 1.8, WF.Surround | WF.DarkFrame);
    case 'modern': return facCode(rng.chance(0.4) ? WinKind.French : WinKind.Single, 2.3, 2.05, WF.DarkFrame | (mat === 'wall_wood' ? WF.AltBase : 0));
    case 'futuristic': return facCode(WinKind.Ribbon, 2.8, 1.9, WF.DarkFrame);
  }
}

/** Apartment blocks (3-10 floors). `balcony` → floor-to-ceiling doors above ground. */
export function aptWindows(k: StyleKit, mat: MatKey, rng: RNG, balcony = false): number {
  const b = balcony ? WF.Balcony : 0;
  switch (k.id) {
    case 'american': return mat === 'wall_brick' ? facCode(rng.chance(0.5) ? WinKind.Paired : WinKind.Single, 1.1, 1.8, WF.Lites | b) : facCode(WinKind.Single, 1.3, 1.6, b);
    case 'european': return facCode(WinKind.Single, 1.15, 2.0, WF.Surround | (rng.chance(0.3) ? WF.Shutters : 0) | (rng.chance(0.5) ? WF.Lites : 0) | b);
    case 'mediterranean': return facCode(balcony ? WinKind.French : WinKind.Single, 1.1, 1.7, WF.Shutters | (rng.chance(0.4) ? WF.Arched : 0) | b);
    case 'nordic': return facCode(WinKind.Single, 1.35, 1.6, (mat === 'wall_wood' ? WF.AltBase : 0) | (rng.chance(0.5) ? WF.Lites : WF.DarkFrame) | b);
    case 'asian': return facCode(rng.chance(0.5) ? WinKind.Single : WinKind.Paired, 1.6, 1.45, WF.DarkFrame | b);
    case 'artdeco': return facCode(WinKind.Single, 1.0, 2.1, WF.Surround | WF.Lites | b);
    case 'modern': return facCode(rng.chance(0.5) ? WinKind.Ribbon : WinKind.Single, 2.5, 2.1, WF.DarkFrame | b);
    case 'futuristic': return facCode(WinKind.Ribbon, 3.0, 2.2, WF.DarkFrame | b);
  }
}

/** Towers & offices on punched materials. */
export function towerWindows(k: StyleKit, mat: MatKey, rng: RNG, office = false): number {
  if (mat === 'wall_glass') return facCode(rng.chance(office ? 0.35 : 0.2) ? WinKind.Ribbon : WinKind.Auto, 0, rng.chance(0.5) ? 2.4 : 2.7, k.id === 'futuristic' ? 0 : rng.chance(0.5) ? WF.DarkFrame : 0);
  if (k.id === 'artdeco') return facCode(WinKind.Strip, 1.0, 2.2, WF.DarkFrame | WF.Surround);
  if (mat === 'wall_office') return facCode(rng.chance(0.3) ? WinKind.Ribbon : WinKind.Single, rng.range(2.1, 2.7), rng.range(1.8, 2.2), WF.DarkFrame);
  if (mat === 'wall_brick') return facCode(rng.chance(0.4) ? WinKind.Paired : WinKind.Single, 1.2, 1.9, office ? WF.DarkFrame : WF.Lites);
  if (mat === 'wall_stone') return facCode(WinKind.Single, 1.2, 2.0, WF.Surround | WF.DarkFrame);
  if (office) return facCode(WinKind.Ribbon, 3.0, 1.7, WF.DarkFrame);
  return facCode(rng.chance(0.4) ? WinKind.Paired : WinKind.Single, 1.6, 1.6, rng.chance(0.5) ? WF.DarkFrame : 0);
}

export function pickRoof(k: StyleKit, rng: RNG, allowFlat = true): RoofShape {
  const opts = k.def.roofs.filter((r) => allowFlat || r !== 'flat');
  return rng.pick(opts.length ? opts : ['gable']);
}

export function pitchedMat(k: StyleKit, rng: RNG): MatKey {
  return rng.pick(k.pitched);
}
