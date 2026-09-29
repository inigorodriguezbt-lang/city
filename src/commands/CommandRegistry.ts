// STUB — owned by the "systems" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';

export interface CommandContext {
  game: Game;
  args: string[];
  raw: string;
  print: (text: string, kind?: 'info' | 'ok' | 'error' | 'warn') => void;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  /** requires creative mode or cheats enabled */
  cheat?: boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
  /** tab-completion for argument index i given previous args */
  complete?: (args: string[], i: number) => string[];
}

export class CommandRegistry {
  protected cmds = new Map<string, CommandDef>();
  history: string[] = [];
  constructor(protected game: Game) {}
  init(): void {}
  register(cmd: CommandDef): void { this.cmds.set(cmd.name, cmd); }
  list(): CommandDef[] { return [...this.cmds.values()]; }
  /** run a line (with or without leading '/') */
  async execute(_line: string): Promise<void> {}
  /** completion candidates for the full input line */
  complete(_line: string): string[] { return []; }
}
