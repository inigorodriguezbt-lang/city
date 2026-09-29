// Game-wide event map for the EventBus (FROZEN names; additive only).
import type {
  AchievementDef, ActiveEvent, Building, Cell, FieldId, MilestoneDef, Notice, Rect, WeatherState,
} from './types';
import type { Settings } from '../settings/types';
import type { World } from '../world/World';

export interface Selection {
  buildingId?: number;
  cell?: Cell;
  vehicleId?: number;
  lineId?: number;
}

export interface GameEvents {
  /** a world was created or loaded and all systems have attached */
  'world:loaded': World;
  /** the current world is being torn down */
  'world:unloaded': null;
  /** batched once per frame: union rect + Layer bitmask of what changed */
  'world:changed': { rect: Rect; layers: number };
  'building:added': Building;
  'building:removed': Building;
  /** level/flags/state changed (renderers may refresh the model) */
  'building:changed': Building;
  /** fixed simulation tick (TICKS_PER_DAY per day) */
  'sim:tick': { day: number; tick: number };
  'sim:day': { day: number };
  'sim:month': { day: number; month: number; year: number };
  'sim:year': { year: number };
  'time:speed': number;
  'money:changed': number;
  'notice': Notice;
  'milestone': MilestoneDef;
  'achievement': AchievementDef;
  'event:start': ActiveEvent;
  'event:end': ActiveEvent;
  'weather:changed': WeatherState;
  /** info-view overlay selected (null = none) */
  'overlay:changed': FieldId | null;
  'tool:changed': string | null;
  'select': Selection | null;
  /** camera target in CELL coordinates (fractional ok) */
  'camera:flyTo': { x: number; y: number; distance?: number; instant?: boolean };
  'settings:changed': Settings;
  'ui:hud': boolean;
  'unlocks:changed': null;
  /** a field-system recompute finished */
  'fields:updated': FieldId[];
  'game:saved': { id: string; name: string };
  'creative:changed': boolean;
}
