// Shared helpers for chat commands: lookups, coordinates, pretty formatting.
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { CELL } from '../core/constants';
import { BFlag, ZoneType, type Building, type BuildingCategory, type FieldId, type WeatherType } from '../core/types';
import { BUILDINGS, CATEGORY_INFO, buildingDef } from '../data/buildings';
import { ZONES, zoneById, zoneDef } from '../data/zones';
import { OVERLAYS } from '../data/overlays';
import { parseInt10 } from './parse';

export const WEATHER_TYPES: WeatherType[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'heatwave', 'blizzard'];

export const WEATHER_LABEL: Record<WeatherType, string> = {
  clear: '☀️ Clear', cloudy: '☁️ Cloudy', rain: '🌧️ Rain', storm: '⛈️ Thunderstorm', snow: '🌨️ Snow',
  fog: '🌫️ Fog', heatwave: '🥵 Heat wave', blizzard: '❄️ Blizzard',
};

/** named times of day for /time set */
export const TIME_KEYWORDS: Record<string, number> = {
  dawn: 5.75, sunrise: 6.4, morning: 8, day: 10, noon: 12, afternoon: 15, golden: 18.2, sunset: 19.1,
  dusk: 19.7, evening: 21, night: 23, midnight: 0,
};

/** Friendly error: printed without "Command failed". */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Wrong arguments: the registry prints the command's usage line. */
export class UsageError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'UsageError';
  }
}

// ── camera / coordinates ────────────────────────────────────────────────────
/** camera focus in cell coordinates */
export function focusCell(game: Game): { x: number; y: number } {
  try {
    const f = game.renderer.cameraCtl.focus;
    if (Number.isFinite(f.x) && Number.isFinite(f.y)) return { x: f.x, y: f.y };
  } catch {
    /* renderer not ready */
  }
  const w = game.world;
  return w ? { x: w.home.x + 0.5, y: w.home.y + 0.5 } : { x: 0, y: 0 };
}

/** Parse a coordinate: absolute integer, or `~` / `~n` relative to `base`. */
export function parseCoord(tok: string | undefined, base: number): number {
  if (tok === undefined) return NaN;
  if (tok.startsWith('~')) {
    const rest = tok.slice(1);
    const d = rest === '' ? 0 : parseInt10(rest);
    return Number.isFinite(d) ? Math.floor(base) + d : NaN;
  }
  return parseInt10(tok);
}

/** Parse "x y" at args[i], args[i+1]; throws a CommandError when out of bounds. */
export function parseCell(game: Game, world: World, args: string[], i: number): { x: number; y: number } {
  const f = focusCell(game);
  const x = parseCoord(args[i], f.x), y = parseCoord(args[i + 1], f.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new UsageError();
  if (!world.inBounds(x, y)) throw new CommandError(`(${x}, ${y}) is outside the map (0–${world.size - 1}).`);
  return { x, y };
}

export function looksNumeric(tok: string | undefined): boolean {
  return tok !== undefined && /^(~-?\d*|-?\d+)$/.test(tok);
}

export function flyToCell(game: Game, x: number, y: number, distance?: number): void {
  game.renderer.cameraCtl.flyTo(x, y, distance);
}

// ── buildings ───────────────────────────────────────────────────────────────
export function buildingKindName(b: Building): string {
  if (b.kind === 'service') return buildingDef(b.defId)?.name ?? b.defId;
  const z = zoneDef(b.zone) ?? zoneById(b.defId.replace(/^zoned:/, ''));
  return `${z?.name ?? 'Building'} L${b.level}`;
}

export function buildingIcon(b: Building): string {
  if (b.kind === 'service') return buildingDef(b.defId)?.icon ?? '🏢';
  return (zoneDef(b.zone) ?? zoneById(b.defId.replace(/^zoned:/, '')))?.icon ?? '🏠';
}

export function buildingLabel(b: Building): string {
  const kind = buildingKindName(b);
  return b.name ? `“${b.name}” (${kind})` : kind;
}

export function buildingCenter(b: Building): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function distCells(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function fmtDistance(cells: number): string {
  const m = cells * CELL;
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function statusTags(b: Building): string {
  const t: string[] = [];
  if (b.flags & BFlag.OnFire) t.push('🔥 burning');
  if (b.flags & (BFlag.Collapsed | BFlag.Burned)) t.push('rubble');
  else if (b.flags & BFlag.Abandoned) t.push('abandoned');
  else if (b.flags & BFlag.UnderConstruction) t.push('under construction');
  else if (b.flags & BFlag.Disabled) t.push('switched off');
  return t.length ? ' · ' + t.join(', ') : '';
}

// ── zones, overlays, categories ─────────────────────────────────────────────
const ZONE_ALIASES: Record<string, ZoneType> = {
  none: ZoneType.None, dezone: ZoneType.None, clear: ZoneType.None, empty: ZoneType.None,
  residential: ZoneType.ResLow, res: ZoneType.ResLow, commercial: ZoneType.ComLow, com: ZoneType.ComLow,
  industrial: ZoneType.Industry, ind: ZoneType.Industry, offices: ZoneType.Office, off: ZoneType.Office,
};

/** zone by id ("res_low"), short ("R+"), name or alias; undefined when unknown */
export function parseZone(tok: string | undefined): ZoneType | undefined {
  if (!tok) return undefined;
  const t = tok.toLowerCase().replace(/^zoned:/, '');
  if (t in ZONE_ALIASES) return ZONE_ALIASES[t];
  const z = ZONES.find((d) => d.id === t || d.short.toLowerCase() === t || d.name.toLowerCase() === t);
  return z?.type;
}

export function zoneCompletions(): string[] {
  return [...ZONES.map((z) => z.id), 'none'];
}

export function parseOverlay(tok: string): FieldId | null | undefined {
  const t = tok.toLowerCase().replace(/[\s_-]+/g, '');
  if (['off', 'none', 'clear', 'hide', '0'].includes(t)) return null;
  const o = OVERLAYS.find((d) => d.id.toLowerCase() === t || d.name.toLowerCase().replace(/[\s&_-]+/g, '') === t);
  return o ? o.id : undefined;
}

export function parseCategory(tok: string): BuildingCategory | undefined {
  const t = tok.toLowerCase();
  for (const [id, info] of Object.entries(CATEGORY_INFO) as [BuildingCategory, (typeof CATEGORY_INFO)[BuildingCategory]][]) {
    if (id === t || info.name.toLowerCase() === t) return id;
  }
  return undefined;
}

export function buildingIds(): string[] {
  return BUILDINGS.map((b) => b.id);
}

// ── text formatting ─────────────────────────────────────────────────────────
export function kv(label: string, value: string, width = 13): string {
  return `${label.padEnd(width)} ${value}`;
}

export function bar(v01: number, width = 12): string {
  const n = Math.round(Math.max(0, Math.min(1, v01)) * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

export function signed(n: number, fmt: (v: number) => string): string {
  return (n >= 0 ? '+' : '−') + fmt(Math.abs(n)).replace(/^-/, '');
}

export function title(text: string): string {
  return `━━ ${text} ${'━'.repeat(Math.max(3, 34 - text.length))}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}
