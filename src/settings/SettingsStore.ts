// ─────────────────────────────────────────────────────────────────────────────
// SettingsStore: the single source of truth for user preferences.
//
// - Persisted to localStorage under "urbis.settings.v1".
// - load() deep-merges saved values over defaultSettings(), validating every
//   leaf against the default's type (and enum/range where known), so corrupt,
//   stale or partial saves never break the game. New keybind actions get their
//   defaults automatically.
// - set(patch) deep-merges (arrays are replaced, not merged), persists and
//   emits exactly one 'settings:changed' per call.
// - Graphics presets map to concrete values; touching a preset-controlled
//   graphics option individually flips the preset to "custom".
// ─────────────────────────────────────────────────────────────────────────────
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { ACTIONS, DEFAULT_KEYBINDS, defaultSettings, type ActionId, type GraphicsPreset, type Settings } from './types';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const SETTINGS_STORAGE_KEY = 'urbis.settings.v1';

type Graphics = Settings['graphics'];
/** graphics options that a preset controls (changing one → preset "custom") */
export type PresetKey = 'renderDistance' | 'resolutionScale' | 'shadows' | 'antialias' | 'bloom' | 'ambientOcclusion' | 'treeDensity' | 'vehicleDensity' | 'pedestrians' | 'buildingDetail';
export type PresetValues = Pick<Graphics, PresetKey>;

/** concrete values behind each named graphics preset ("high" equals the defaults) */
export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, PresetValues> = {
  low: {
    renderDistance: 4, resolutionScale: 0.75, shadows: 'off', antialias: false, bloom: false, ambientOcclusion: false,
    treeDensity: 0.35, vehicleDensity: 0.3, pedestrians: false, buildingDetail: 'low',
  },
  medium: {
    renderDistance: 7, resolutionScale: 1, shadows: 'low', antialias: true, bloom: true, ambientOcclusion: false,
    treeDensity: 0.7, vehicleDensity: 0.6, pedestrians: true, buildingDetail: 'medium',
  },
  high: {
    renderDistance: 10, resolutionScale: 1, shadows: 'medium', antialias: true, bloom: true, ambientOcclusion: false,
    treeDensity: 1, vehicleDensity: 1, pedestrians: true, buildingDetail: 'high',
  },
  ultra: {
    renderDistance: 16, resolutionScale: 1.25, shadows: 'high', antialias: true, bloom: true, ambientOcclusion: true,
    treeDensity: 1, vehicleDensity: 1, pedestrians: true, buildingDetail: 'high',
  },
};

export const PRESET_KEYS: readonly PresetKey[] = [
  'renderDistance', 'resolutionScale', 'shadows', 'antialias', 'bloom', 'ambientOcclusion', 'treeDensity', 'vehicleDensity', 'pedestrians', 'buildingDetail',
];

/** allowed string values per leaf path (validated on load and set) */
const ENUMS: Record<string, readonly string[]> = {
  'graphics.preset': ['low', 'medium', 'high', 'ultra', 'custom'],
  'graphics.shadows': ['off', 'low', 'medium', 'high'],
  'graphics.buildingDetail': ['low', 'medium', 'high'],
  'ui.units': ['metric', 'imperial'],
};

/** numeric ranges per leaf path [min, max] (clamped on load and set) */
const RANGES: Record<string, readonly [number, number]> = {
  'graphics.renderDistance': [2, 24],
  'graphics.fov': [30, 100],
  'graphics.resolutionScale': [0.5, 2],
  'graphics.treeDensity': [0.2, 1],
  'graphics.vehicleDensity': [0.1, 1],
  'graphics.fpsLimit': [0, 360],
  'ui.scale': [0.6, 2],
  'controls.cameraSpeed': [0.2, 3],
  'controls.rotateSpeed': [0.2, 3],
  'controls.zoomSpeed': [0.2, 3],
  'audio.master': [0, 1],
  'audio.music': [0, 1],
  'audio.ambience': [0, 1],
  'audio.sfx': [0, 1],
  'gameplay.autosaveMinutes': [0, 120],
  'gameplay.autosaveSlots': [1, 20],
  'gameplay.dayCycleMinutes': [0, 60],
};

export type SettingsSection = keyof Settings;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** sanitize a keybind list: strings only, trimmed, de-duplicated, at most 2 */
function cleanBinds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * Merge `src` into `dst` (in place) using `dst`'s shape as the schema: unknown
 * keys are dropped, type mismatches ignored, enums/ranges enforced.
 * Returns true when anything changed.
 */
function mergeInto(dst: Obj, src: Obj, path: string): boolean {
  let changed = false;
  for (const key of Object.keys(src)) {
    if (!(key in dst)) continue;
    const p = path ? `${path}.${key}` : key;
    const cur = dst[key];
    const val = src[key];
    if (val === undefined) continue;
    if (p === 'controls.keybinds') {
      if (!isObj(val)) continue;
      const kb = cur as Record<string, string[]>;
      for (const a of Object.keys(val)) {
        if (!(a in ACTIONS)) continue;
        const list = cleanBinds(val[a]);
        if (!list) continue;
        if (list.length !== kb[a]?.length || list.some((s, i) => s !== kb[a][i])) {
          kb[a] = list;
          changed = true;
        }
      }
      continue;
    }
    if (isObj(cur)) {
      if (isObj(val) && mergeInto(cur, val, p)) changed = true;
      continue;
    }
    if (typeof cur === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      const r = RANGES[p];
      const v = r ? Math.min(r[1], Math.max(r[0], val)) : val;
      if (v !== cur) {
        dst[key] = v;
        changed = true;
      }
    } else if (typeof cur === 'boolean') {
      if (typeof val !== 'boolean') continue;
      if (val !== cur) {
        dst[key] = val;
        changed = true;
      }
    } else if (typeof cur === 'string') {
      if (typeof val !== 'string') continue;
      const e = ENUMS[p];
      if (e && !e.includes(val)) continue;
      if (val !== cur) {
        dst[key] = val;
        changed = true;
      }
    }
  }
  return changed;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class SettingsStore {
  value: Settings = defaultSettings();
  /** true once load() found and applied a stored blob */
  loadedFromStorage = false;

  constructor(protected bus: EventBus<GameEvents>) {}

  /** load from localStorage (merging defaults for missing keys) */
  load(): void {
    const fresh = defaultSettings();
    this.loadedFromStorage = false;
    const ls = storage();
    let raw: string | null = null;
    try {
      raw = ls?.getItem(SETTINGS_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isObj(parsed)) {
          mergeInto(fresh as unknown as Obj, parsed, '');
          this.loadedFromStorage = true;
        }
      } catch (err) {
        console.warn('[settings] stored settings are corrupt; using defaults', err);
      }
    }
    // every action must have a binding list (new actions get defaults)
    for (const a of Object.keys(ACTIONS) as ActionId[]) {
      if (!Array.isArray(fresh.controls.keybinds[a])) fresh.controls.keybinds[a] = [...DEFAULT_KEYBINDS[a]];
    }
    this.value = fresh;
  }

  save(): void {
    try {
      storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.value));
    } catch (err) {
      console.warn('[settings] could not persist settings', err);
    }
  }

  /** deep-merge patch, persist, emit 'settings:changed' */
  set(patch: DeepPartial<Settings>): void {
    if (!isObj(patch)) return;
    const g = (patch as Obj).graphics;
    const touchesPreset = isObj(g) && PRESET_KEYS.some((k) => k in g && g[k] !== undefined && g[k] !== this.value.graphics[k]);
    const explicitPreset = isObj(g) && typeof g.preset === 'string';
    const prevPreset = this.value.graphics.preset;
    let changed = mergeInto(this.value as unknown as Obj, patch as Obj, '');
    const preset = this.value.graphics.preset;
    if (explicitPreset && preset !== 'custom' && preset !== prevPreset) {
      // selecting a named preset through set() applies its values too
      const vals = GRAPHICS_PRESETS[preset];
      for (const k of PRESET_KEYS) if (!(isObj(g) && k in g)) (this.value.graphics as unknown as Obj)[k] = vals[k];
      changed = true;
    } else if (touchesPreset && !explicitPreset) {
      // an individual quality option changed: "custom" — unless the values now
      // happen to match a named preset exactly again
      this.value.graphics.preset = this.matchingPreset() ?? 'custom';
      changed = true;
    }
    if (!changed && !touchesPreset) return;
    this.save();
    this.bus.emit('settings:changed', this.value);
  }

  reset(): void {
    this.value = defaultSettings();
    this.save();
    this.bus.emit('settings:changed', this.value);
  }

  /** reset one section (e.g. the Options "Reset tab" button) */
  resetSection(section: SettingsSection): void {
    const d = defaultSettings();
    if (section === 'controls') this.value.controls = d.controls;
    else if (section === 'graphics') this.value.graphics = d.graphics;
    else if (section === 'ui') this.value.ui = d.ui;
    else if (section === 'audio') this.value.audio = d.audio;
    else this.value.gameplay = d.gameplay;
    this.save();
    this.bus.emit('settings:changed', this.value);
  }

  /** reset the bindings of one action to its defaults */
  resetKeybind(action: ActionId): void {
    this.setKeybinds({ [action]: [...DEFAULT_KEYBINDS[action]] } as Partial<Record<ActionId, string[]>>);
  }

  /** replace the binding lists of several actions in one change (one event) */
  setKeybinds(binds: Partial<Record<ActionId, string[]>>): void {
    this.set({ controls: { keybinds: binds as DeepPartial<Record<ActionId, string[]>> } });
  }

  applyPreset(p: GraphicsPreset): void {
    if (p === 'custom') {
      if (this.value.graphics.preset === 'custom') return;
      this.value.graphics.preset = 'custom';
    } else {
      const vals = GRAPHICS_PRESETS[p];
      if (!vals) return;
      Object.assign(this.value.graphics, vals);
      this.value.graphics.preset = p;
    }
    this.save();
    this.bus.emit('settings:changed', this.value);
  }

  /** the named preset whose values the current graphics settings match exactly (or null) */
  matchingPreset(): Exclude<GraphicsPreset, 'custom'> | null {
    const g = this.value.graphics;
    for (const [id, vals] of Object.entries(GRAPHICS_PRESETS) as [Exclude<GraphicsPreset, 'custom'>, PresetValues][]) {
      if (PRESET_KEYS.every((k) => g[k] === vals[k])) return id;
    }
    return null;
  }

  /** a detached deep copy of the defaults (for "is modified" indicators) */
  defaults(): Settings {
    return defaultSettings();
  }
}
