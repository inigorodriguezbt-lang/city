// Palette model shared by the toolbar flyout and the search panel. Everything
// is derived generically from the data catalogs (roads, zones, buildings,
// milestones) so new entries appear automatically.
import { CELL } from '../../core/constants';
import { ZoneType, type BuildingCategory, type BuildingDef, type FieldId, type TransitMode } from '../../core/types';
import { formatMoney, formatNumber } from '../../core/util';
import { BUILDINGS, CATEGORY_INFO } from '../../data/buildings';
import { MILESTONES } from '../../data/milestones';
import { OVERLAYS } from '../../data/overlays';
import { styleDef } from '../../data/styles';
import { ROADS } from '../../data/roads';
import { ZONES } from '../../data/zones';
import type { World } from '../../world/World';
import type { ActionId } from '../../settings/types';
import type { IconName } from './icons';

export type CatId =
  | 'roads' | 'zoning' | 'districts' | 'power' | 'water' | 'garbage' | 'health' | 'fire' | 'police' | 'education'
  | 'parks' | 'transit' | 'government' | 'tourism' | 'landmarks' | 'terrain' | 'bulldoze';

export interface Chip {
  icon: string;
  text: string;
  kind?: 'good' | 'bad' | 'warn' | '';
}

export type TipRow = [string, string, ('good' | 'bad' | 'warn' | '')?];

export interface PaletteItem {
  /** unique key, e.g. "road:street", "place:clinic" */
  key: string;
  kind: 'road' | 'zone' | 'building' | 'terraform' | 'trees' | 'district' | 'transit' | 'action';
  name: string;
  icon: string;
  description: string;
  cost?: number;
  /** suffix after the cost ("/cell") */
  costUnit?: string;
  /** text shown instead of a cost */
  costText?: string;
  upkeep?: number;
  upkeepUnit?: string;
  unlock: number;
  unlockId?: string;
  chips: Chip[];
  rows: TipRow[];
  notes: string[];
  /** accent colour (zones, districts, transit) */
  color?: string;
  tool: string | null;
  opts?: Record<string, unknown>;
  /** option keys compared to decide whether this card is the active tool */
  matchKeys?: string[];
  /** alternative action instead of a tool */
  action?: () => void;
  /** extra searchable text */
  search: string;
  /** toolbar category */
  cat: CatId;
}

export interface PaletteTab {
  id: string;
  label: string;
  icon?: string;
  items: PaletteItem[];
}

export interface CategoryDef {
  id: CatId;
  label: string;
  short: string;
  icon: IconName;
  color: string;
  group: number;
  key?: ActionId;
  /** building categories feeding this toolbar category (in tab order) */
  buildings?: BuildingCategory[];
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'roads', label: 'Roads', short: 'Roads', icon: 'roads', color: '#aab6c8', group: 0, key: 'tool.roads' },
  { id: 'zoning', label: 'Zoning', short: 'Zoning', icon: 'zoning', color: '#3ddc84', group: 0, key: 'tool.zoning' },
  { id: 'districts', label: 'Districts', short: 'Districts', icon: 'districts', color: '#b98cff', group: 0 },
  { id: 'power', label: 'Electricity', short: 'Power', icon: 'electricity', color: '#ffc53d', group: 1, key: 'tool.services', buildings: ['power'] },
  { id: 'water', label: 'Water & Sewage', short: 'Water', icon: 'water', color: '#4aa8ff', group: 1, buildings: ['water'] },
  { id: 'garbage', label: 'Garbage', short: 'Garbage', icon: 'garbage', color: '#a9c07a', group: 1, buildings: ['garbage'] },
  { id: 'health', label: 'Health & Deathcare', short: 'Health', icon: 'health', color: '#ff6b8b', group: 2, buildings: ['health', 'deathcare'] },
  { id: 'fire', label: 'Fire Department', short: 'Fire', icon: 'fire', color: '#ff8a3d', group: 2, buildings: ['fire'] },
  { id: 'police', label: 'Police', short: 'Police', icon: 'police', color: '#5b8cff', group: 2, buildings: ['police'] },
  { id: 'education', label: 'Education', short: 'Education', icon: 'education', color: '#a78bff', group: 2, buildings: ['education'] },
  { id: 'parks', label: 'Parks & Plazas', short: 'Parks', icon: 'parks', color: '#4fd68a', group: 3, buildings: ['parks', 'plazas'] },
  { id: 'transit', label: 'Public Transport', short: 'Transit', icon: 'transit', color: '#29d3e6', group: 3, buildings: ['transit'] },
  { id: 'government', label: 'Government & Disaster', short: 'Gov’t', icon: 'government', color: '#e0c07a', group: 3, buildings: ['government', 'disaster'] },
  { id: 'tourism', label: 'Tourism & Industry', short: 'Tourism', icon: 'tourism', color: '#ff6fd0', group: 3, buildings: ['tourism', 'industry'] },
  { id: 'landmarks', label: 'Landmarks & Monuments', short: 'Landmarks', icon: 'landmarks', color: '#f5c451', group: 3, buildings: ['landmark', 'monument'] },
  { id: 'terrain', label: 'Terrain & Trees', short: 'Terrain', icon: 'terrain', color: '#c9a67a', group: 4 },
  { id: 'bulldoze', label: 'Bulldoze', short: 'Bulldoze', icon: 'bulldoze', color: '#ff6464', group: 4, key: 'tool.bulldoze' },
];

export const SERVICE_CYCLE: CatId[] = ['power', 'water', 'garbage', 'health', 'fire', 'police', 'education', 'parks', 'transit', 'government'];

export function categoryDef(id: CatId): CategoryDef {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

const CAT_OF_BUILDING = new Map<BuildingCategory, CatId>();
for (const c of CATEGORIES) for (const b of c.buildings ?? []) CAT_OF_BUILDING.set(b, c.id);
export function catOfBuilding(cat: BuildingCategory): CatId {
  return CAT_OF_BUILDING.get(cat) ?? 'government';
}

export const TRANSIT_MODES: { mode: TransitMode; name: string; icon: string; unlock: number; color: string; description: string; capacity: string }[] = [
  { mode: 'bus', name: 'Bus Line', icon: '🚌', unlock: 3, color: '#29b6f6', description: 'Flexible lines on existing roads. Place stops along streets; buses loop the route.', capacity: '30 passengers' },
  { mode: 'tram', name: 'Tram Line', icon: '🚋', unlock: 6, color: '#ffb300', description: 'Quiet, high-capacity trams on tram avenues. Great for dense corridors.', capacity: '90 passengers' },
  { mode: 'metro', name: 'Metro Line', icon: '🚇', unlock: 7, color: '#e53935', description: 'Underground rapid transit between metro stations. Ignores surface traffic.', capacity: '180 passengers' },
  { mode: 'train', name: 'Train Line', icon: '🚆', unlock: 5, color: '#43a047', description: 'Regional passenger trains on railways between train stations.', capacity: '240 passengers' },
  { mode: 'ferry', name: 'Ferry Line', icon: '⛴️', unlock: 8, color: '#1e88e5', description: 'Water routes between ferry piers. Connects islands and shores.', capacity: '60 passengers' },
  { mode: 'monorail', name: 'Monorail Line', icon: '🚝', unlock: 9, color: '#8e24aa', description: 'Elevated futuristic rail above avenues. Fast and iconic.', capacity: '150 passengers' },
];

export function transitMode(mode: TransitMode) {
  return TRANSIT_MODES.find((m) => m.mode === mode) ?? TRANSIT_MODES[0];
}

const COVERAGE_FIELDS: FieldId[] = ['police', 'fire', 'health', 'education', 'leisure', 'garbage', 'deathcare', 'transit', 'tourism'];

export function fieldName(id: FieldId): string {
  return OVERLAYS.find((o) => o.id === id)?.name ?? id;
}

export function milestoneLabel(unlock: number): string {
  const m = MILESTONES[Math.min(unlock, MILESTONES.length - 1)];
  return m ? m.name : `Milestone ${unlock}`;
}

export function unlockText(unlock: number): string {
  const m = MILESTONES[Math.min(unlock, MILESTONES.length - 1)];
  return m ? `Unlocks at ${m.name} (${formatNumber(m.population)} citizens)` : 'Locked';
}

export function isItemUnlocked(world: World | null, it: PaletteItem): boolean {
  if (!world) return it.unlock <= 0;
  return world.isUnlocked(it.unlock, it.unlockId);
}

/** Card chips + tooltip rows for a catalog building. */
export function buildingStats(d: BuildingDef): { chips: Chip[]; rows: TipRow[]; notes: string[] } {
  const chips: Chip[] = [];
  const rows: TipRow[] = [];
  const notes: string[] = [];
  rows.push(['Construction', formatMoney(d.cost)]);
  rows.push(['Upkeep', `${formatMoney(d.upkeep)}/month`]);
  rows.push(['Footprint', `${d.w} × ${d.h} cells`]);
  if (d.power) {
    rows.push(['Electricity', `${d.power > 0 ? '+' : ''}${formatNumber(d.power)} MW`, d.power > 0 ? 'good' : 'warn']);
    if (d.power > 0) chips.push({ icon: '⚡', text: `${formatNumber(d.power)} MW`, kind: 'good' });
  }
  if (d.water) {
    rows.push(['Water', `${d.water > 0 ? '+' : ''}${formatNumber(d.water)} m³/day`, d.water > 0 ? 'good' : 'warn']);
    if (d.water > 0) chips.push({ icon: '💧', text: `${formatNumber(d.water, true)} m³`, kind: 'good' });
  }
  if (d.sewage) {
    rows.push(['Sewage', `${d.sewage > 0 ? '' : '+'}${formatNumber(Math.abs(d.sewage))} m³/day ${d.sewage > 0 ? 'processed' : 'produced'}`, d.sewage > 0 ? 'good' : 'warn']);
    if (d.sewage > 0) chips.push({ icon: '🚽', text: `${formatNumber(d.sewage, true)} m³`, kind: 'good' });
  }
  if (d.capacity) {
    const label = d.capacityLabel ?? 'capacity';
    rows.push(['Capacity', `${formatNumber(d.capacity)} ${label}`]);
    chips.push({ icon: '👥', text: `${formatNumber(d.capacity, true)} ${shortLabel(label)}` });
  }
  let cover: { f: FieldId; r: number } | null = null;
  for (const e of d.effects ?? []) {
    if (COVERAGE_FIELDS.includes(e.field) && e.amount > 0) {
      rows.push([`${fieldName(e.field)} coverage`, `${formatNumber(e.radius * CELL)} m radius`, 'good']);
      if (!cover || e.radius > cover.r) cover = { f: e.field, r: e.radius };
    }
  }
  if (cover) chips.push({ icon: '◎', text: `${formatNumber(cover.r * CELL)} m` });
  if (d.jobs) {
    rows.push(['Jobs', formatNumber(d.jobs)]);
    if (chips.length < 2) chips.push({ icon: '👷', text: `${formatNumber(d.jobs)} jobs` });
  }
  for (const e of d.effects ?? []) {
    if (COVERAGE_FIELDS.includes(e.field)) continue;
    if (e.field === 'pollution' && e.amount > 0) {
      rows.push(['Pollution', `${severity(e.amount)} · ${formatNumber(e.radius * CELL)} m`, 'bad']);
      chips.push({ icon: '☣️', text: severity(e.amount), kind: 'bad' });
    } else if (e.field === 'noise' && e.amount > 0) {
      rows.push(['Noise', `${severity(e.amount)} · ${formatNumber(e.radius * CELL)} m`, 'warn']);
    } else if (e.field === 'landValue') {
      rows.push(['Land value', `${e.amount > 0 ? 'Raises' : 'Lowers'} · ${formatNumber(e.radius * CELL)} m`, e.amount > 0 ? 'good' : 'bad']);
    } else if (e.field === 'crime') {
      rows.push(['Crime', e.amount > 0 ? 'Increases' : 'Reduces', e.amount > 0 ? 'bad' : 'good']);
    } else if (e.field === 'happiness') {
      rows.push(['Happiness', e.amount > 0 ? 'Raises' : 'Lowers', e.amount > 0 ? 'good' : 'bad']);
    } else if (e.amount !== 0) {
      rows.push([fieldName(e.field), `${e.amount > 0 ? '+' : ''}${e.amount} · ${formatNumber(e.radius * CELL)} m`]);
    }
  }
  if (d.attractiveness) {
    rows.push(['Attractiveness', `+${d.attractiveness}`, 'good']);
    if (chips.length < 2) chips.push({ icon: '✨', text: `+${d.attractiveness}`, kind: 'good' });
  }
  if (d.vehicles) rows.push(['Vehicles', `${d.vehicles.count} × ${d.vehicles.type}`]);
  const p = d.placement;
  if (p?.shore) notes.push('Must be placed on a shoreline');
  if (p?.onWater) notes.push('Must be placed on water');
  if (p?.rail) notes.push('Needs railway frontage');
  if (p?.resource) notes.push(`Requires ${fieldName(p.resource).toLowerCase()} underground`);
  if (p?.unique) notes.push('Unique — only one per city');
  if (p?.road === false) notes.push('No road access needed');
  return { chips: chips.slice(0, 3), rows, notes };
}

function shortLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith('student')) return 'students';
  if (l.startsWith('patient')) return 'beds';
  if (l.startsWith('visitor')) return 'visitors';
  if (l.startsWith('ton')) return 't';
  if (l.startsWith('passenger')) return 'pax';
  return l.length > 9 ? l.slice(0, 8) + '.' : l;
}

function severity(amount: number): string {
  const a = Math.abs(amount);
  return a >= 180 ? 'Severe' : a >= 110 ? 'High' : a >= 60 ? 'Moderate' : 'Low';
}

// ── item builders ───────────────────────────────────────────────────────────

function roadItems(): PaletteItem[] {
  return ROADS.map((r) => ({
    key: `road:${r.id}`,
    kind: 'road' as const,
    name: r.name,
    icon: r.icon,
    description: r.description,
    cost: r.cost,
    costUnit: '/cell',
    upkeep: r.upkeep,
    upkeepUnit: '/cell',
    unlock: r.unlock,
    unlockId: r.id,
    chips: [
      { icon: '⏱', text: `${r.speed} km/h` },
      r.lanes ? { icon: '⇅', text: `${r.lanes} lanes` } : { icon: r.cars ? '🚗' : '🚶', text: r.cars ? 'Cars' : 'No cars' },
    ],
    rows: [
      ['Cost', `${formatMoney(r.cost)} per cell`],
      ['Upkeep', `${formatMoney(r.upkeep)} per cell / month`],
      ['Speed limit', `${r.speed} km/h`],
      ['Lanes', r.lanes ? String(r.lanes) : '—'],
      ['Capacity', `${formatNumber(r.capacity)} vehicles/day`],
      ['Zoning', r.allowsZoning ? 'Allowed' : 'Not allowed', r.allowsZoning ? 'good' : 'warn'],
      ['Noise', r.noise >= 0.6 ? 'High' : r.noise >= 0.3 ? 'Moderate' : 'Low', r.noise >= 0.6 ? 'bad' : ''],
    ],
    notes: ['Drag to build · Shift straight · Ctrl auto-path', 'Drag over existing roads to upgrade'],
    tool: 'road',
    opts: { type: r.type },
    matchKeys: ['type'],
    search: `road street ${r.id} ${r.cars ? '' : 'pedestrian walk'}`,
    cat: 'roads' as CatId,
  }));
}

function zoneItems(): PaletteItem[] {
  const items: PaletteItem[] = ZONES.map((z) => {
    const cap = z.category === 'res' ? 'residents' : 'jobs';
    const chips: Chip[] = [
      { icon: '▦', text: z.density === 'low' ? 'Low density' : z.density === 'med' ? 'Medium' : 'High density' },
      { icon: '🏢', text: `≤ ${z.maxFloors} floors` },
    ];
    if (z.resource) chips[1] = { icon: '⛏', text: `Needs ${fieldName(z.resource).toLowerCase()}`, kind: 'warn' };
    return {
      key: `zone:${z.id}`,
      kind: 'zone' as const,
      name: z.name,
      icon: z.icon,
      description: zoneBlurb(z.category, z.density, z.resource),
      costText: 'Free to zone',
      unlock: z.unlock,
      unlockId: z.id,
      chips,
      rows: [
        ['Category', ({ res: 'Residential', com: 'Commercial', ind: 'Industrial', off: 'Office' } as const)[z.category]],
        ['Density', z.density === 'low' ? 'Low' : z.density === 'med' ? 'Medium' : 'High'],
        ['Max height', `${z.maxFloors} floors`],
        ['Base capacity', `${z.capacityPerCell} ${cap} per cell`],
        ['Lot sizes', z.lots.map(([a, b]) => `${a}×${b}`).join(', ')],
        ...(z.resource ? [['Requires', `${fieldName(z.resource)} (> 60)`, 'warn'] as TipRow] : []),
      ],
      notes: ['Paint within 4 cells of a road · [ ] brush size'],
      color: z.color,
      tool: 'zone',
      opts: { zone: z.type, zoneId: z.id },
      matchKeys: ['zone'],
      search: `zone ${z.id} ${z.short} ${z.category}`,
      cat: 'zoning' as CatId,
    };
  });
  return items;
}

function zoneBlurb(cat: string, density: string, resource?: string): string {
  if (resource) return `Specialised industry that extracts ${resource === 'fertility' ? 'crops from fertile land' : resource === 'forest' ? 'timber from forests' : resource === 'ore' ? 'minerals from ore deposits' : 'oil from underground fields'}. Only grows on matching resources.`;
  if (cat === 'res') return density === 'low' ? 'Detached houses and villas. Quiet, family friendly and low traffic.' : density === 'med' ? 'Townhouses and walk-ups. More residents per street, still human scale.' : 'Apartment towers. Huge population, needs strong services and transit.';
  if (cat === 'com') return density === 'low' ? 'Corner shops, cafés and small offices serving the neighbourhood.' : 'Malls, department stores and commercial towers. Needs lots of customers.';
  if (cat === 'off') return 'Clean, high-paying jobs for educated workers. No goods required, low pollution.';
  return 'Factories and warehouses. Provide goods for commerce; they pollute and make noise.';
}

function dezoneItem(): PaletteItem {
  return {
    key: 'zone:none',
    kind: 'zone',
    name: 'Dezone',
    icon: '🧽',
    description: 'Remove zoning from cells. Buildings on dezoned land are eventually abandoned.',
    costText: 'Free',
    unlock: 0,
    chips: [{ icon: '⌫', text: 'Clear zones' }],
    rows: [],
    notes: ['Right-drag with any zoning tool also removes zones'],
    color: '#8b95a5',
    tool: 'zone',
    opts: { zone: ZoneType.None, zoneId: 'none' },
    matchKeys: ['zone'],
    search: 'dezone unzone remove zone erase',
    cat: 'zoning',
  };
}

function buildingItem(d: BuildingDef): PaletteItem {
  const s = buildingStats(d);
  return {
    key: `place:${d.id}`,
    kind: 'building',
    name: d.name,
    icon: d.icon,
    description: d.description,
    cost: d.cost,
    upkeep: d.upkeep,
    upkeepUnit: '/mo',
    unlock: d.unlock,
    unlockId: d.id,
    chips: s.chips,
    rows: s.rows,
    notes: s.notes,
    tool: 'place',
    opts: { defId: d.id },
    matchKeys: ['defId'],
    search: `${d.id} ${d.category} ${CATEGORY_INFO[d.category]?.name ?? ''} ${d.group ?? ''} ${(d.tags ?? []).join(' ')}`,
    cat: catOfBuilding(d.category),
  };
}

function buildingTabs(cat: CategoryDef): PaletteTab[] {
  const tabs: PaletteTab[] = [];
  const byKey = new Map<string, PaletteTab>();
  for (const bc of cat.buildings ?? []) {
    const defs = BUILDINGS.filter((b) => b.category === bc);
    for (const d of defs) {
      const label = d.group ?? CATEGORY_INFO[bc]?.name ?? bc;
      const key = `${bc}:${label}`;
      let tab = byKey.get(key);
      if (!tab) {
        tab = { id: key, label, icon: d.group ? undefined : CATEGORY_INFO[bc]?.icon, items: [] };
        byKey.set(key, tab);
        tabs.push(tab);
      }
      tab.items.push(buildingItem(d));
    }
  }
  for (const t of tabs) t.items.sort((a, b) => a.unlock - b.unlock || (a.cost ?? 0) - (b.cost ?? 0));
  return tabs;
}

function terraformItems(): PaletteItem[] {
  const modes: { mode: string; name: string; icon: string; text: string }[] = [
    { mode: 'raise', name: 'Raise Terrain', icon: '⛰️', text: 'Lift the ground under the brush. Hold to keep raising.' },
    { mode: 'lower', name: 'Lower Terrain', icon: '🕳️', text: 'Dig the ground down. Carve canals, harbours and valleys.' },
    { mode: 'flatten', name: 'Flatten', icon: '▭', text: 'Level the ground to the height where you started dragging.' },
    { mode: 'smooth', name: 'Smooth', icon: '〰️', text: 'Soften bumps and sharp ridges for gentle slopes.' },
    { mode: 'level', name: 'Level to Sea', icon: '🌊', text: 'Bring terrain to just above sea level for waterfront land.' },
  ];
  return modes.map((m) => ({
    key: `terraform:${m.mode}`,
    kind: 'terraform' as const,
    name: m.name,
    icon: m.icon,
    description: m.text,
    costText: 'Pay per use',
    unlock: 0,
    chips: [{ icon: '◯', text: 'Brush [ ]' }],
    rows: [['Cost', 'Charged by volume moved']],
    notes: ['Roads and buildings block terraforming', '[ ] changes the brush size'],
    tool: 'terraform',
    opts: { mode: m.mode },
    matchKeys: ['mode'],
    search: `terraform terrain ground dig ${m.mode}`,
    cat: 'terrain' as CatId,
  }));
}

function treeItems(): PaletteItem[] {
  const brushes: { id: string; name: string; icon: string; density: number; text: string; erase?: boolean }[] = [
    { id: 'sparse', name: 'Scattered Trees', icon: '🌱', density: 1, text: 'Plant a light scattering of trees. Great along streets and in gardens.' },
    { id: 'grove', name: 'Tree Grove', icon: '🌳', density: 2, text: 'Plant a leafy grove. Raises land value and absorbs noise.' },
    { id: 'forest', name: 'Dense Forest', icon: '🌲', density: 3, text: 'Plant thick forest. Feeds forestry industry and filters pollution.' },
    { id: 'clear', name: 'Remove Trees', icon: '🪓', density: 0, erase: true, text: 'Clear trees from an area.' },
  ];
  return brushes.map((b) => ({
    key: `trees:${b.id}`,
    kind: 'trees' as const,
    name: b.name,
    icon: b.icon,
    description: b.text,
    costText: b.erase ? 'Free' : '$10 / tree',
    unlock: 0,
    chips: [{ icon: b.erase ? '✕' : '♣', text: b.erase ? 'Clear' : `Density ${b.density}` }],
    rows: [['Density', b.erase ? 'Removes trees' : `${b.density} / 3`]],
    notes: ['[ ] changes the brush size', 'Trees reduce noise and pollution nearby'],
    tool: 'trees',
    opts: b.erase ? { density: 0, erase: true } : { density: b.density },
    matchKeys: ['density'],
    search: `trees plant forest nature ${b.id}`,
    cat: 'terrain' as CatId,
  }));
}

function transitLineItems(): PaletteItem[] {
  return TRANSIT_MODES.map((m) => ({
    key: `transit:${m.mode}`,
    kind: 'transit' as const,
    name: m.name,
    icon: m.icon,
    description: m.description,
    costText: 'Free to draw',
    unlock: m.unlock,
    chips: [{ icon: '👥', text: m.capacity.replace(' passengers', ' pax') }],
    rows: [['Vehicle capacity', m.capacity], ['Earns', 'Ticket fares every month', 'good']],
    notes: ['Click to place stops · click the first stop to close the loop', 'Right-click removes the last stop'],
    color: m.color,
    tool: 'transit',
    opts: { mode: m.mode },
    matchKeys: ['mode'],
    search: `transit line public transport ${m.mode}`,
    cat: 'transit' as CatId,
  }));
}

export interface CatalogActions {
  openPanel(id: 'districts' | 'transit'): void;
  newDistrict(): void;
}

function districtItems(world: World | null, actions: CatalogActions): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      key: 'district:new', kind: 'action', name: 'New District', icon: '✳️', description: 'Create a new district and start painting it onto the map.',
      costText: 'Free', unlock: 4, chips: [{ icon: '+', text: 'Create' }], rows: [], notes: ['Districts can have their own policies, style and specialisation'],
      tool: null, action: () => actions.newDistrict(), search: 'district new create area neighbourhood', cat: 'districts', color: '#b98cff',
    },
  ];
  for (const d of world?.districts ?? []) {
    items.push({
      key: `district:${d.id}`, kind: 'district', name: d.name, icon: '🖌️', description: `Paint cells into ${d.name}.`,
      costText: 'Free', unlock: 4, chips: [{ icon: '●', text: d.style ? styleDef(d.style).name : 'City style' }], rows: [['Policies', String(d.policies.length)]], notes: ['Drag to paint · [ ] brush size'],
      color: d.color, tool: 'district', opts: { districtId: d.id }, matchKeys: ['districtId'], search: `district paint ${d.name}`, cat: 'districts',
    });
  }
  items.push({
    key: 'district:erase', kind: 'district', name: 'Erase District', icon: '🧽', description: 'Remove cells from any district.',
    costText: 'Free', unlock: 4, chips: [{ icon: '⌫', text: 'Erase' }], rows: [], notes: ['Drag to erase · [ ] brush size'],
    color: '#8b95a5', tool: 'district', opts: { districtId: 0 }, matchKeys: ['districtId'], search: 'district erase remove', cat: 'districts',
  });
  items.push({
    key: 'district:manage', kind: 'action', name: 'Manage Districts', icon: '🗺️', description: 'Rename, recolour, style and set policies for your districts.',
    costText: '', unlock: 4, chips: [{ icon: '⚙', text: 'Panel' }], rows: [], notes: [],
    tool: null, action: () => actions.openPanel('districts'), search: 'districts manage panel', cat: 'districts', color: '#b98cff',
  });
  return items;
}

/** Tabs for a toolbar category (rebuilt on demand; cheap). */
export function tabsFor(cat: CatId, world: World | null, actions: CatalogActions): PaletteTab[] {
  const def = categoryDef(cat);
  switch (cat) {
    case 'roads': {
      const all = roadItems();
      const hw = all.filter((i) => i.key === 'road:highway' || i.key === 'road:rail');
      return [
        { id: 'roads', label: 'Roads', icon: '🛣️', items: all.filter((i) => !hw.includes(i)) },
        { id: 'highways', label: 'Highways & Rail', icon: '🛤️', items: hw },
      ].filter((t) => t.items.length);
    }
    case 'zoning': {
      const all = zoneItems();
      const res = all.filter((i) => ZONES.find((z) => `zone:${z.id}` === i.key)?.category === 'res');
      const com = all.filter((i) => { const c = ZONES.find((z) => `zone:${z.id}` === i.key)?.category; return c === 'com' || c === 'off'; });
      const ind = all.filter((i) => ZONES.find((z) => `zone:${z.id}` === i.key)?.category === 'ind');
      return [
        { id: 'res', label: 'Residential', icon: '🏡', items: [...res, dezoneItem()] },
        { id: 'com', label: 'Commercial & Office', icon: '🏪', items: [...com, dezoneItem()] },
        { id: 'ind', label: 'Industry', icon: '🏭', items: [...ind, dezoneItem()] },
      ];
    }
    case 'districts':
      return [{ id: 'districts', label: 'Districts', icon: '🗺️', items: districtItems(world, actions) }];
    case 'terrain':
      return [
        { id: 'terraform', label: 'Terraform', icon: '⛰️', items: terraformItems() },
        { id: 'trees', label: 'Trees', icon: '🌳', items: treeItems() },
      ];
    case 'transit': {
      const lines: PaletteItem[] = [...transitLineItems(), {
        key: 'transit:manage', kind: 'action', name: 'Manage Lines', icon: '🗂️', description: 'See ridership, vehicles and colours of every transit line.',
        costText: '', unlock: 0, chips: [{ icon: '⚙', text: 'Panel' }], rows: [], notes: [], tool: null,
        action: () => actions.openPanel('transit'), search: 'transit lines manage', cat: 'transit', color: '#29d3e6',
      }];
      return [{ id: 'lines', label: 'Lines', icon: '〰️', items: lines }, ...buildingTabs(def)];
    }
    case 'bulldoze':
      return [];
    default:
      return buildingTabs(def);
  }
}

/** Every buildable/tool item (for search). */
export function allItems(world: World | null, actions: CatalogActions): PaletteItem[] {
  const out: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const c of CATEGORIES) {
    for (const t of tabsFor(c.id, world, actions)) {
      for (const it of t.items) {
        if (seen.has(it.key)) continue;
        seen.add(it.key);
        out.push(it);
      }
    }
  }
  return out;
}

/** Does an item correspond to the currently active tool? */
export function isItemActive(it: PaletteItem, toolId: string | null | undefined, opts: unknown): boolean {
  if (!it.tool || it.tool !== toolId) return false;
  if (!it.matchKeys?.length) return true;
  const o = (opts ?? {}) as Record<string, unknown>;
  for (const k of it.matchKeys) {
    const want = it.opts?.[k];
    const have = o[k];
    if (want === undefined) continue;
    if (want !== have && !(k === 'districtId' && !want && !have)) return false;
  }
  return true;
}

/** Toolbar category owning a tool (for the "active tool" marker). */
export function catOfTool(toolId: string | null | undefined, opts: unknown): CatId | null {
  if (!toolId) return null;
  switch (toolId) {
    case 'road': return 'roads';
    case 'zone': return 'zoning';
    case 'district': return 'districts';
    case 'terraform': case 'trees': return 'terrain';
    case 'transit': return 'transit';
    case 'bulldoze': return 'bulldoze';
    case 'place': case 'move': {
      const id = (opts as { defId?: string } | undefined)?.defId;
      const d = id ? BUILDINGS.find((b) => b.id === id) : undefined;
      return d ? catOfBuilding(d.category) : null;
    }
    default: return null;
  }
}

/** Human label for the active tool (hint bar). */
export function toolLabel(toolId: string, opts: unknown): { name: string; icon: string } {
  const o = (opts ?? {}) as Record<string, unknown>;
  switch (toolId) {
    case 'road': {
      const r = ROADS.find((x) => x.type === o.type);
      return { name: r ? r.name : 'Roads', icon: r?.icon ?? '🛣️' };
    }
    case 'zone': {
      const z = ZONES.find((x) => x.type === o.zone || x.id === o.zoneId);
      const mode = typeof o.mode === 'string' ? ` · ${o.mode === 'rect' ? 'Rectangle' : o.mode === 'fill' ? 'Fill' : 'Brush'}` : '';
      return { name: (z ? z.name : o.zone === ZoneType.None ? 'Dezone' : 'Zoning') + mode, icon: z?.icon ?? '🧽' };
    }
    case 'place': {
      const d = BUILDINGS.find((b) => b.id === o.defId);
      return { name: d ? d.name : 'Place building', icon: d?.icon ?? '🏗️' };
    }
    case 'move': return { name: 'Move building', icon: '✥' };
    case 'bulldoze': return { name: 'Bulldozer', icon: '🚜' };
    case 'district': return { name: o.districtId === 0 ? 'Erase district' : 'Paint district', icon: '🖌️' };
    case 'terraform': return { name: `Terraform · ${String(o.mode ?? 'raise')}`, icon: '⛰️' };
    case 'trees': return { name: o.erase ? 'Remove trees' : 'Plant trees', icon: o.erase ? '🪓' : '🌳' };
    case 'transit': {
      const m = TRANSIT_MODES.find((x) => x.mode === o.mode);
      return { name: m ? m.name : 'Transit line', icon: m?.icon ?? '🚌' };
    }
    case 'eyedropper': return { name: 'Eyedropper', icon: '💉' };
    default: return { name: toolId.charAt(0).toUpperCase() + toolId.slice(1), icon: '🛠️' };
  }
}
