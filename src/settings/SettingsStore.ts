// STUB — owned by the "ui-menus" agent. Public API is FROZEN (add, don't change).
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { defaultSettings, type GraphicsPreset, type Settings } from './types';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export class SettingsStore {
  value: Settings = defaultSettings();
  constructor(protected bus: EventBus<GameEvents>) {}
  /** load from localStorage (merging defaults for missing keys) */
  load(): void {}
  save(): void {}
  /** deep-merge patch, persist, emit 'settings:changed' */
  set(patch: DeepPartial<Settings>): void { void patch; this.bus.emit('settings:changed', this.value); }
  reset(): void { this.value = defaultSettings(); this.bus.emit('settings:changed', this.value); }
  applyPreset(_p: GraphicsPreset): void {}
}
