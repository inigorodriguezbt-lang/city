// Where events happen: location pickers for EventPlace, readable place names,
// building helpers (height, vulnerability) and disaster-response mitigation.
import { BFlag, ZoneType, type Building, type Cell } from '../../core/types';
import type { RNG } from '../../core/rng';
import { buildingDef } from '../../data/buildings';
import type { EventPlace, Hazard } from '../../data/events';
import { zoneDef } from '../../data/zones';
import type { World } from '../../world/World';

export interface Place {
  x: number;
  y: number;
  /** building at the place, when the event targets one */
  bid?: number;
  /** "Maple Court", "the Coal Power Plant", "the waterfront"… */
  name: string;
}

const INDUSTRY_ZONES = new Set<ZoneType>([ZoneType.Industry, ZoneType.Farming, ZoneType.Forestry, ZoneType.Mining, ZoneType.Oil]);
const HEAVY_SERVICE = new Set(['coal_plant', 'oil_plant', 'gas_plant', 'incinerator', 'refinery', 'biomass_plant', 'nuclear_plant', 'geothermal_plant']);

/** finished, standing building */
export function standing(b: Building): boolean {
  return b.built >= 1 && !(b.flags & (BFlag.Collapsed | BFlag.Burned));
}

export function centerOf(b: Building): Cell {
  return { x: b.x + Math.floor(b.w / 2), y: b.y + Math.floor(b.h / 2) };
}

/** approximate height (m) of a building */
export function buildingHeight(b: Building): number {
  if (b.kind === 'service') return buildingDef(b.defId)?.height ?? 12;
  const z = zoneDef(b.zone);
  const floors = z ? Math.max(1, Math.round(1 + (z.maxFloors - 1) * ((b.level - 1) / 4) ** 1.3)) : b.level * 2;
  return floors * 3.4 + 2;
}

export function placeName(world: World, b: Building | undefined, x?: number, y?: number): string {
  if (b) {
    if (b.name) return b.name;
    if (b.kind === 'service') {
      const d = buildingDef(b.defId);
      if (d) return `the ${d.name}`;
    } else {
      const z = zoneDef(b.zone);
      const kind = b.zone === ZoneType.Office ? 'an office building' : z?.category === 'res' ? 'a residential block' : z?.category === 'com' ? 'a shopping street' : 'an industrial site';
      return `${kind} ${compass(world, b.x, b.y)}`;
    }
  }
  if (x !== undefined && y !== undefined) return `the ${compassWord(world, x, y)} of the city`;
  return 'the city';
}

function compassWord(world: World, x: number, y: number): string {
  const dx = x - world.home.x, dy = y - world.home.y;
  if (Math.hypot(dx, dy) < 18) return 'heart';
  const a = Math.atan2(-dy, dx);
  const dirs = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

function compass(world: World, x: number, y: number): string {
  const w = compassWord(world, x, y);
  return w === 'heart' ? 'downtown' : `in the ${w}`;
}

function weightedBuilding(world: World, rng: RNG, filter: (b: Building) => boolean, weight: (b: Building) => number): Building | undefined {
  const list: Building[] = [];
  const ws: number[] = [];
  for (const b of world.buildings.values()) {
    if (!standing(b) || !filter(b)) continue;
    const w = weight(b);
    if (w <= 0) continue;
    list.push(b);
    ws.push(w);
  }
  return list.length ? rng.weighted(list, ws) : undefined;
}

function fromBuilding(world: World, b: Building | undefined): Place | null {
  if (!b) return null;
  const c = centerOf(b);
  return { x: c.x, y: c.y, bid: b.id, name: placeName(world, b) };
}

function category(b: Building): string | undefined {
  return b.kind === 'service' ? buildingDef(b.defId)?.category : undefined;
}

/** pick a location for an event; null when nothing suitable exists */
export function pickPlace(world: World, rng: RNG, place: EventPlace): Place | null {
  switch (place) {
    case 'none':
      return null;
    case 'city': {
      const b = weightedBuilding(world, rng, () => true, (b) => b.w * b.h);
      return fromBuilding(world, b) ?? { x: world.home.x, y: world.home.y, name: 'the city centre' };
    }
    case 'building':
      return fromBuilding(world, weightedBuilding(world, rng, (b) => !(b.flags & BFlag.OnFire) && category(b) !== 'parks' && category(b) !== 'plazas', (b) => 1 + b.level * 0.3));
    case 'tall': {
      let best: Building[] = [];
      for (const b of world.buildings.values()) if (standing(b) && !(b.flags & BFlag.OnFire)) best.push(b);
      if (!best.length) return null;
      best.sort((a, b) => buildingHeight(b) - buildingHeight(a));
      best = best.slice(0, 12);
      return fromBuilding(world, rng.weighted(best, best.map((b) => buildingHeight(b))));
    }
    case 'industry': {
      const b = weightedBuilding(world, rng, (b) => INDUSTRY_ZONES.has(b.zone) || HEAVY_SERVICE.has(b.defId) || category(b) === 'industry', (b) => b.w * b.h);
      return fromBuilding(world, b) ?? pickPlace(world, rng, 'building');
    }
    case 'farm': {
      const b = weightedBuilding(world, rng, (b) => b.zone === ZoneType.Farming, () => 1);
      return fromBuilding(world, b) ?? pickPlace(world, rng, 'city');
    }
    case 'stadium': {
      const b = weightedBuilding(world, rng, (b) => b.defId === 'stadium' || b.defId === 'arena' || (buildingDef(b.defId)?.tags ?? []).includes('sports'), () => 1);
      return fromBuilding(world, b) ?? pickPlace(world, rng, 'park');
    }
    case 'park': {
      const b = weightedBuilding(world, rng, (b) => category(b) === 'parks' || category(b) === 'plazas', (b) => b.w * b.h);
      if (b) return fromBuilding(world, b);
      const hall = weightedBuilding(world, rng, (b) => category(b) === 'government', () => 1);
      return fromBuilding(world, hall) ?? { x: world.home.x, y: world.home.y, name: 'the city centre' };
    }
    case 'road': {
      for (let i = 0; i < 40; i++) {
        const b = weightedBuilding(world, rng, () => true, () => 1);
        if (!b) break;
        const d = world.roadAccessDir(b.x, b.y, b.w, b.h);
        if (d < 0) continue;
        const x = d === 1 ? b.x + b.w : d === 3 ? b.x - 1 : b.x + Math.floor(b.w / 2);
        const y = d === 2 ? b.y + b.h : d === 0 ? b.y - 1 : b.y + Math.floor(b.h / 2);
        if (world.roadAt(x, y)) return { x, y, name: `the streets ${compass(world, x, y)}` };
      }
      return null;
    }
    case 'forest': {
      // prefer forest within reach of the city, else anywhere
      const s = world.size;
      let best: Cell | null = null, bestScore = -1;
      for (let i = 0; i < 1500; i++) {
        const near = i < 1000;
        const x = near ? world.home.x + rng.int(-70, 70) : rng.int(0, s - 1);
        const y = near ? world.home.y + rng.int(-70, 70) : rng.int(0, s - 1);
        if (!world.inBounds(x, y)) continue;
        const t = world.trees[world.idx(x, y)];
        if (t < 2) continue;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) n += world.inBounds(x + dx, y + dy) ? world.trees[world.idx(x + dx, y + dy)] : 0;
        const score = n + rng.next() * 6;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
        if (bestScore > 40 && i > 200) break;
      }
      return best ? { ...best, name: `the woods ${compass(world, best.x, best.y)}` } : null;
    }
    case 'coast':
      return pickCoast(world, rng);
  }
  return null;
}

function isSeaCell(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return false;
  const w = world.water[world.idx(x, y)];
  return Math.abs(w - world.seaLevel) < 0.01 && world.isWater(x, y);
}

/** does the map touch the sea at all (sampled) */
export function hasSea(world: World): boolean {
  const s = world.size;
  for (let i = 0; i < s; i += 4) {
    if (isSeaCell(world, i, 0) || isSeaCell(world, i, s - 1) || isSeaCell(world, 0, i) || isSeaCell(world, s - 1, i)) return true;
  }
  for (let y = 8; y < s; y += 16) for (let x = 8; x < s; x += 16) if (isSeaCell(world, x, y)) return true;
  return false;
}

/** a land cell next to the sea, as close as possible to developed land */
function pickCoast(world: World, rng: RNG): Place | null {
  const s = world.size;
  const shore: number[] = [];
  for (let y = 1; y < s - 1; y += 2)
    for (let x = 1; x < s - 1; x += 2) {
      if (world.isWater(x, y)) continue;
      if (isSeaCell(world, x + 2, y) || isSeaCell(world, x - 2, y) || isSeaCell(world, x, y + 2) || isSeaCell(world, x, y - 2)) shore.push(y * s + x);
    }
  if (!shore.length) return null;
  // score by nearby buildings
  const anchor = weightedBuilding(world, rng, () => true, (b) => b.w * b.h);
  const ax = anchor ? anchor.x : world.home.x, ay = anchor ? anchor.y : world.home.y;
  let best = shore[0], bd = Infinity;
  for (const i of shore) {
    const x = i % s, y = (i / s) | 0;
    const d = Math.hypot(x - ax, y - ay) + rng.next() * 12;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const x = best % s, y = (best / s) | 0;
  return { x, y, name: `the waterfront ${compass(world, x, y)}` };
}

/** unit direction (cells) pointing from open sea toward (x, y) */
export function seaDirection(world: World, x: number, y: number): { dx: number; dy: number } {
  let sx = 0, sy = 0;
  for (let dy = -10; dy <= 10; dy++)
    for (let dx = -10; dx <= 10; dx++) {
      if (!isSeaCell(world, x + dx, y + dy)) continue;
      const d = Math.hypot(dx, dy) || 1;
      sx -= dx / d;
      sy -= dy / d;
    }
  const l = Math.hypot(sx, sy);
  if (l < 1e-6) {
    // fall back to the direction from the map centre
    const cx = world.size / 2, cy = world.size / 2;
    const ll = Math.hypot(x - cx, y - cy) || 1;
    return { dx: -(x - cx) / ll, dy: -(y - cy) / ll };
  }
  return { dx: sx / l, dy: sy / l };
}

// ── disaster response ───────────────────────────────────────────────────────
interface ResponseSite {
  defId: string;
  x: number;
  y: number;
  eff: number;
}

/** snapshot of disaster-preparedness buildings (refresh daily) */
export class Preparedness {
  private sites: ResponseSite[] = [];
  private heli: ResponseSite[] = [];
  private stations: { id: number; x: number; y: number; radius: number; eff: number }[] = [];

  refresh(world: World): void {
    this.sites.length = 0;
    this.heli.length = 0;
    this.stations.length = 0;
    for (const b of world.buildings.values()) {
      if (b.kind !== 'service' || !standing(b) || b.flags & BFlag.Disabled) continue;
      const d = buildingDef(b.defId);
      if (!d) continue;
      const c = centerOf(b);
      const eff = Math.max(0, Math.min(1.5, b.efficiency || 0));
      if (eff <= 0) continue;
      if (d.category === 'disaster') this.sites.push({ defId: d.id, x: c.x, y: c.y, eff });
      if (d.id === 'fire_heli') this.heli.push({ defId: d.id, x: c.x, y: c.y, eff });
      if (d.category === 'fire' && d.vehicles?.type === 'firetruck') {
        const radius = d.effects?.find((e) => e.field === 'fire')?.radius ?? 20;
        this.stations.push({ id: b.id, x: c.x, y: c.y, radius, eff });
      }
    }
  }

  /** 0..0.75 damage reduction for a hazard at a location */
  mitigation(h: Hazard, x?: number, y?: number): number {
    let warn = 0, resp = 0, shelter = 0, radar = 0, buoys = 0;
    for (const s of this.sites) {
      const near = x === undefined || y === undefined ? 1 : Math.max(0, 1 - Math.hypot(s.x - x, s.y - y) / 70);
      switch (s.defId) {
        case 'early_warning': warn += 0.12 * s.eff * Math.max(0.25, near); break;
        case 'weather_radar': radar += 0.15 * s.eff; break;
        case 'tsunami_buoys': buoys += 0.35 * s.eff; break;
        case 'disaster_response': resp += 0.2 * s.eff * Math.max(0.2, near); break;
        case 'emergency_shelter': shelter += 0.1 * s.eff * Math.max(0.3, near); break;
        default: resp += 0.05 * s.eff * near; break;
      }
    }
    warn = Math.min(0.3, warn);
    resp = Math.min(0.35, resp);
    shelter = Math.min(0.2, shelter);
    let m = resp + shelter;
    if (h === 'storm' || h === 'flood') m += warn + Math.min(0.2, radar);
    else if (h === 'tsunami') m += warn * 0.6 + Math.min(0.4, buoys);
    else if (h === 'quake' || h === 'impact') m += warn * 0.7;
    else if (h === 'ground') m += warn * 0.3;
    else if (h === 'fire') m = resp * 0.5;
    return Math.max(0, Math.min(0.75, m));
  }

  /** extra warning time multiplier (1 = none … 2.5) */
  warning(h: Hazard, x?: number, y?: number): number {
    let w = 0;
    for (const s of this.sites) {
      const near = x === undefined || y === undefined ? 1 : Math.max(0.25, 1 - Math.hypot(s.x - x, s.y - y) / 90);
      if (s.defId === 'early_warning') w += 0.25 * s.eff * near;
      if (s.defId === 'weather_radar' && (h === 'storm' || h === 'flood' || h === 'impact')) w += 0.35 * s.eff;
      if (s.defId === 'tsunami_buoys' && h === 'tsunami') w += 0.8 * s.eff;
    }
    return 1 + Math.min(1.5, w);
  }

  /** 0..1 aerial firefighting cover at a cell */
  heliCover(x: number, y: number): number {
    let c = 0;
    for (const s of this.heli) c = Math.max(c, s.eff * Math.max(0, 1 - Math.hypot(s.x - x, s.y - y) / 45));
    return Math.min(1, c);
  }

  /** nearest working fire station able to reach (x, y), with distance in cells */
  nearestStation(x: number, y: number): { id: number; dist: number } | null {
    let best: { id: number; dist: number } | null = null;
    for (const s of this.stations) {
      const d = Math.abs(s.x - x) + Math.abs(s.y - y);
      if (d > s.radius * 3.5) continue;
      if (!best || d < best.dist) best = { id: s.id, dist: d };
    }
    return best;
  }
}
