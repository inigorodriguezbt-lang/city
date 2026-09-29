// Shared constants between the zoned generators, the BuildingRenderer merge
// step and the procedural wall shaders in materials.ts.
//
// Wall UVs are meters (u along the facade, v = height). The shaders divide
// them into bays × floors using the module sizes below. Generators may scale
// UVs per facade so an integer number of bays fits and floor lines align with
// the real (possibly taller) storeys.

/** default window bay width (m) of the wall_* materials */
export const BAY = 3.2;
/** default storey height (m) of the wall_* materials */
export const FLOOR = 3.3;
/** storefront module (wall_shop) */
export const SHOP_BAY = 4.5;
export const SHOP_H = 4.5;
/** industrial module (wall_industrial) */
export const IND_BAY = 6.0;
export const IND_H = 6.0;
/** curtain-wall glazing panel width (wall_glass) */
export const CW_PANEL = 1.6;

/** Window arrangement drawn inside each bay (facade code byte 0). */
export enum WinKind {
  Auto = 0,
  Single = 1,
  Paired = 2,
  Triple = 3,
  Ribbon = 4,
  French = 5,
  Blank = 6,
  Small = 7,
  Round = 8,
  Strip = 9,
}

/** Facade flags (facade code byte 3). */
export const WF = {
  Shutters: 1,
  Arched: 2,
  Lites: 4, // divided lites / muntins
  DarkFrame: 8,
  BlankGround: 16, // no windows on the ground storey
  AltBase: 32, // alternate base texture (vertical boards, flemish bond, rough plaster, banded stone)
  Surround: 64, // stone surrounds / lintels around openings
  Balcony: 128, // floor-to-ceiling openings behind balconies (doors)
} as const;

/** Occupancy schedule ids used for lit windows (aInfo.z bits 0-2). */
export enum Sched {
  Generic = 0,
  Residential = 1,
  Commercial = 2,
  Office = 3,
  Industrial = 4,
  Civic = 5, // 24h services
  Hotel = 6,
  Never = 7,
}

/** Condition bits (aInfo.w). */
export enum Cond {
  Abandoned = 1,
  Burned = 2,
  Flooded = 4,
  OnFire = 8,
  Construction = 16,
}

/** LOD facade types (aFac.x on LOD boxes). */
export enum LodFacade {
  None = 0,
  Punched = 1,
  Office = 2,
  Glass = 3,
  Shop = 4,
  Industrial = 5,
  House = 6,
}

/** Style ids in STYLES order (aInfo.z bits 3-5). */
export const STYLE_INDEX: Record<string, number> = {
  american: 0, european: 1, mediterranean: 2, nordic: 3, asian: 4, artdeco: 5, modern: 6, futuristic: 7,
};

/** Pack a facade code: window kind, width & height (m, material units), flags. */
export function facCode(kind: WinKind, ww = 0, wh = 0, flags = 0): number {
  const w = Math.max(0, Math.min(255, Math.round(ww * 64)));
  const h = Math.max(0, Math.min(255, Math.round(wh * 64)));
  return ((kind & 255) | (w << 8) | (h << 16) | ((flags & 255) << 24)) >>> 0;
}

/** Pack per-building render info into 4 bytes (aInfo). */
export function packInfo(seed: number, sched: Sched, style: number, lit: 0 | 1 | 2 | 3, cond: number): number {
  const lo = seed & 255, hi = (seed >>> 8) & 255;
  const z = (sched & 7) | ((style & 7) << 3) | ((lit & 3) << 6);
  return (lo | (hi << 8) | (z << 16) | ((cond & 255) << 24)) >>> 0;
}
