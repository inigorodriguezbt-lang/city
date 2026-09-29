// Shared context handed to every HUD component + small UI helpers.
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { ActionId } from '../../settings/types';
import type { SfxId } from '../../audio/AudioManager';
import type { Tooltips } from './Tooltip';
import type { UIManager } from '../UIManager';

export interface HudContext {
  readonly game: Game;
  readonly ui: UIManager;
  readonly tips: Tooltips;
  /** current world (null while in menus) */
  world(): World | null;
  /** play a UI sound (guarded) */
  sfx(id: SfxId, volume?: number): void;
  /** human-readable key label for an action ("" if unbound) */
  key(action: ActionId): string;
  /** current GUI scale (for converting client px → zoomed CSS px) */
  scale(): number;
  /** true when gameplay input should be handled (world loaded, no menu/chat) */
  inGame(): boolean;
  /** true on narrow (phone) layouts where panels become bottom sheets */
  compact(): boolean;
}

/** Persisted per-city HUD state (lives in world.ext['ui-hud']). */
export interface HudWorldState {
  tutorialDismissed?: boolean;
  tutorialDone?: string[];
  advisorMuted?: string[];
  /** notice ids already seen in the log */
  lastSeenNotice?: number;
}

export function hudState(world: World): HudWorldState {
  let s = world.ext['ui-hud'] as HudWorldState | undefined;
  if (!s || typeof s !== 'object') {
    s = {};
    world.ext['ui-hud'] = s;
  }
  return s;
}

/** Stable 32-bit string hash (FNV-1a). */
export function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pleasant avatar colour derived from a name. */
export function nameColor(name: string): string {
  const h = strHash(name) % 360;
  return `hsl(${h} 62% 52%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '';
  return (a + b).toUpperCase();
}

export function handleOf(name: string): string {
  return '@' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 18);
}

/** Set textContent only if it changed (avoids layout churn). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Toggle a class only when needed. */
export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Set a CSS custom property only when it changed. */
export function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** Title-case a camelCase / snake_case key ("resLow" → "Res Low"). */
export function prettyKey(k: string): string {
  const s = k.replace(/[_:-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Human-friendly label for money-flow categories recorded by world.spend/earn. */
export function flowLabel(k: string): string {
  const map: Record<string, string> = {
    resLow: 'Residential (low)', resHigh: 'Residential (high)', comLow: 'Commercial (low)', comHigh: 'Commercial (high)',
    office: 'Offices', industry: 'Industry', tourism: 'Tourism', transit: 'Transit fares', exports: 'Exports',
    construction: 'Construction', roads: 'Road upkeep', power: 'Electricity', water: 'Water & sewage', garbage: 'Garbage',
    health: 'Healthcare', deathcare: 'Deathcare', fire: 'Fire department', police: 'Police', education: 'Education',
    parks: 'Parks & leisure', government: 'Government', disaster: 'Disaster response', policies: 'Policies', loans: 'Loan payments',
    taxes: 'Taxes', rewards: 'Milestone rewards', reward: 'Milestone rewards', refund: 'Refunds', refunds: 'Refunds', other: 'Other',
  };
  const base = k.replace(/^(tax|taxes|upkeep|expense|income)[:_]/i, '');
  return map[k] ?? map[base] ?? prettyKey(base);
}

export function sumValues(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const v of Object.values(r)) if (Number.isFinite(v)) s += v;
  return s;
}

/** Compose a keyboard hint "<kbd>" element (empty when unbound). */
export function kbd(label: string): HTMLElement | null {
  if (!label) return null;
  const k = document.createElement('kbd');
  k.className = 'hud-kbd';
  k.textContent = label;
  return k;
}

/** Temperature formatted per unit setting. */
export function formatTemp(c: number, units: 'metric' | 'imperial'): string {
  return units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`;
}

export function formatSpeed(ms: number, units: 'metric' | 'imperial'): string {
  return units === 'imperial' ? `${Math.round(ms * 2.237)} mph` : `${Math.round(ms * 3.6)} km/h`;
}

/** Signed money with explicit + sign. */
export function signedMoney(v: number, compact = false, fmt: (v: number, c?: boolean) => string): string {
  return (v >= 0 ? '+' : '') + fmt(v, compact);
}
