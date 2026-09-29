// STUB — owned by the "systems" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import type { World } from '../world/World';

export interface SaveMeta {
  id: string;
  name: string;
  cityName: string;
  /** real timestamp ms */
  savedAt: number;
  population: number;
  money: number;
  day: number;
  mapSize: string;
  theme: string;
  /** small JPEG data URL */
  thumbnail?: string;
  auto: boolean;
  bytes: number;
}

export class SaveManager {
  constructor(protected game: Game) {}
  init(): Promise<void> { return Promise.resolve(); }
  update(_dt: number): void {}
  list(): Promise<SaveMeta[]> { return Promise.resolve([]); }
  save(_name?: string, _opts?: { auto?: boolean; overwriteId?: string }): Promise<SaveMeta | null> { return Promise.resolve(null); }
  load(_id: string): Promise<boolean> { return Promise.resolve(false); }
  delete(_id: string): Promise<void> { return Promise.resolve(); }
  quicksave(): Promise<void> { return Promise.resolve(); }
  quickload(): Promise<void> { return Promise.resolve(); }
  /** download the current city as a .urbis file */
  exportCurrent(): Promise<void> { return Promise.resolve(); }
  /** export a stored save as a .urbis download */
  exportSave(_id: string): Promise<void> { return Promise.resolve(); }
  /** import a .urbis file into the save list (does not load it) */
  importFile(_file: File): Promise<SaveMeta | null> { return Promise.resolve(null); }
  serialize(_world: World): Promise<Uint8Array> { return Promise.resolve(new Uint8Array()); }
  deserialize(_bytes: Uint8Array): Promise<World> { return Promise.reject(new Error('not implemented')); }
}
