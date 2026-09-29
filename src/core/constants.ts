// ─────────────────────────────────────────────────────────────────────────────
// URBIS global constants. Shared by main thread and workers (no DOM / THREE here).
// ─────────────────────────────────────────────────────────────────────────────

/** Meters per grid cell edge. One road occupies exactly one cell. */
export const CELL = 16;

/** Cells per chunk edge. Rendering + dirty tracking is done per chunk. */
export const CHUNK = 32;

/** Selectable map sizes (cells per edge). Must be multiples of CHUNK. */
export const MAP_SIZES = {
  small: 256, // 4.1 km
  medium: 384, // 6.1 km
  large: 512, // 8.2 km
  huge: 768, // 12.3 km
} as const;
export type MapSizeId = keyof typeof MAP_SIZES;

/** Simulation speed multipliers, indexed by speed level (0 = paused). */
export const SPEEDS = [0, 1, 2, 4, 10] as const;
export const MAX_SPEED_LEVEL = SPEEDS.length - 1;

/** Real seconds per in‑game calendar day at 1x speed. */
export const REAL_SECONDS_PER_DAY = 2.0;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const START_YEAR = 2026;
/** Simulation ticks per in‑game day. Each tick processes a slice of the city. */
export const TICKS_PER_DAY = 8;

/** Default length (real minutes at 1x) of a full 24h visual day/night cycle. */
export const DEFAULT_DAY_CYCLE_MINUTES = 8;

/** Max distance (cells) from a zoning-enabled road that can be zoned. */
export const MAX_ZONE_DEPTH = 4;

/** Maximum walkable/drivable slope (rise/run) for roads and building lots. */
export const MAX_ROAD_SLOPE = 0.18;
export const MAX_LOT_SLOPE = 0.35;

/** Deck clearance of bridges above the water surface (m). */
export const BRIDGE_CLEARANCE = 7;

/** Minimum water depth for a cell to count as water (m). */
export const WATER_EPS = 0.15;

/** Map height range guidance for generators (m). */
export const MIN_HEIGHT = -40;
export const MAX_HEIGHT = 420;

export const SAVE_VERSION = 1;
export const GAME_NAME = 'URBIS';
