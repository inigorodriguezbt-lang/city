// STUB — owned by the "tools" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Tool } from './Tool';

export class ToolManager {
  protected world: World | null = null;
  protected tools = new Map<string, Tool>();
  current: Tool | null = null;
  currentOpts: unknown = undefined;

  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.cancel(); this.world = null; }
  update(_dt: number): void {}

  register(tool: Tool): void { this.tools.set(tool.id, tool); }
  /** activate a tool by id with options; same id+opts toggles off */
  setTool(id: string | null, opts?: unknown): void {
    this.current?.deactivate();
    this.current = id ? this.tools.get(id) ?? null : null;
    this.currentOpts = opts;
    this.current?.activate(opts);
    this.game.events.emit('tool:changed', id);
  }
  cancel(): void { this.setTool(null); }
  get hint(): string { return this.current?.hint?.() ?? ''; }
}
