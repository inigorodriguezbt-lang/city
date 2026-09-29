// ─────────────────────────────────────────────────────────────────────────────
// CommandRegistry — parses and runs chat commands ("/give money 10k"),
// provides full-line tab completion and command history.
// Owned by the "systems" agent. Built-in commands live in ./builtin/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { ChatKind } from '../ui/chat/ChatConsole';
import { quoteArg, rankMatches, suggest, tokenize } from './parse';
import { CommandError, UsageError } from './util';
import { registerBuiltins } from './builtin/index';

export interface CommandContext {
  game: Game;
  args: string[];
  raw: string;
  print: (text: string, kind?: 'info' | 'ok' | 'error' | 'warn') => void;
}

export type CommandCategory = 'General' | 'Camera' | 'Time & Weather' | 'City' | 'Saves' | 'Cheats';

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
  // ── additive ──
  /** grouping in /help */
  category?: CommandCategory;
  /** example invocations shown by /help <cmd> */
  examples?: string[];
  /** longer help text shown by /help <cmd> */
  details?: string[];
  /** hide from /help listings */
  hidden?: boolean;
}

/** Extended context handed to commands (a superset of CommandContext). */
export interface CmdCtx extends CommandContext {
  print: (text: string, kind?: ChatKind) => void;
  registry: CommandRegistry;
  cmd: CommandDef;
  /** the command word as typed */
  label: string;
  /** the loaded world, or throws "No city is loaded" */
  world(): World;
  /** mark the city as cheated (prints the one-time "(cheat)" notice) */
  cheat(): void;
}

/** Define a command whose run() receives the extended context. */
export function defineCommand(def: Omit<CommandDef, 'run'> & { run: (ctx: CmdCtx) => void | Promise<void> }): CommandDef {
  return def as CommandDef;
}

const HISTORY_KEY = 'urbis.commandHistory';
const HISTORY_MAX = 100;

export class CommandRegistry {
  protected cmds = new Map<string, CommandDef>();
  history: string[] = [];
  private aliases = new Map<string, CommandDef>();
  private inited = false;
  /** module state shared by commands (e.g. /locate cycling) */
  readonly state: Record<string, unknown> = {};

  constructor(protected game: Game) {}

  /** the Game this registry serves (for command completions) */
  get owner(): Game {
    return this.game;
  }

  init(): void {
    if (this.inited) return;
    this.inited = true;
    registerBuiltins(this);
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(arr)) this.history = arr.filter((s): s is string => typeof s === 'string').slice(-HISTORY_MAX);
    } catch {
      /* storage unavailable */
    }
  }

  register(cmd: CommandDef): void {
    const key = cmd.name.toLowerCase();
    const prev = this.cmds.get(key);
    if (prev) for (const a of prev.aliases ?? []) if (this.aliases.get(a.toLowerCase()) === prev) this.aliases.delete(a.toLowerCase());
    this.cmds.set(key, cmd);
    for (const a of cmd.aliases ?? []) this.aliases.set(a.toLowerCase(), cmd);
  }

  list(): CommandDef[] {
    return [...this.cmds.values()];
  }

  /** command by name or alias (case-insensitive) */
  get(name: string): CommandDef | undefined {
    const k = name.toLowerCase().replace(/^\//, '');
    return this.cmds.get(k) ?? this.aliases.get(k);
  }

  /** run a line (with or without leading '/') */
  async execute(line: string): Promise<void> {
    const raw = line.trim();
    if (!raw) return;
    this.pushHistory(raw);
    const body = raw.startsWith('/') ? raw.slice(1) : raw;
    const { tokens } = tokenize(body);
    if (!tokens.length || !tokens[0]) {
      this.print('Type /help to see every command.', 'info');
      return;
    }
    const label = tokens[0];
    const cmd = this.get(label);
    if (!cmd) {
      const names = [...this.cmds.keys(), ...this.aliases.keys()];
      const alt = suggest(label, names).map((n) => '/' + (this.get(n)?.name ?? n));
      this.print(`Unknown command /${label}.${alt.length ? ` Did you mean ${[...new Set(alt)].join(', ')}?` : ''} Type /help for the list.`, 'error');
      this.sfx('error');
      return;
    }
    const game = this.game;
    const ctx: CmdCtx = {
      game,
      args: tokens.slice(1),
      raw,
      print: (text, kind = 'info') => this.print(text, kind),
      registry: this,
      cmd,
      label,
      world: () => {
        const w = game.world;
        if (!w) throw new CommandError('No city is loaded — start or load a city first.');
        return w;
      },
      cheat: () => this.markCheated(),
    };
    try {
      await cmd.run(ctx);
      if (cmd.cheat && game.world) this.markCheated();
    } catch (e) {
      if (e instanceof UsageError) {
        if (e.message) this.print(e.message, 'error');
        this.print(`Usage: ${cmd.usage}`, 'warn');
      } else if (e instanceof CommandError) {
        this.print(e.message, 'error');
      } else {
        console.error(`[commands] /${cmd.name} failed`, e);
        this.print(`/${cmd.name} failed: ${(e as Error)?.message ?? String(e)}`, 'error');
      }
      this.sfx('error');
    }
  }

  /** completion candidates for the full input line (each is a complete replacement line) */
  complete(line: string): string[] {
    const slash = line.startsWith('/') ? '/' : '';
    const body = slash ? line.slice(1) : line;
    const { tokens, trailingSpace } = tokenize(body);
    // command word
    if (tokens.length === 0 || (tokens.length === 1 && !trailingSpace)) {
      const partial = tokens[0] ?? '';
      const visible = this.list().filter((c) => !c.hidden);
      const names = rankMatches(partial, visible.map((c) => c.name));
      // aliases only when they are what the user is typing
      if (partial) for (const [a, c] of this.aliases) if (a.startsWith(partial.toLowerCase()) && !names.includes(c.name)) names.push(c.name);
      return names.map((n) => slash + n);
    }
    const cmd = this.get(tokens[0]);
    if (!cmd?.complete) return [];
    const args = tokens.slice(1);
    let partial = '';
    if (!trailingSpace) partial = args.pop() ?? '';
    let cands: string[] = [];
    try {
      cands = cmd.complete(args.slice(), args.length) ?? [];
    } catch (e) {
      console.warn('[commands] completion failed', e);
      return [];
    }
    const head = [slash + tokens[0], ...args.map(quoteArg)].join(' ');
    return rankMatches(partial, cands, 60).map((c) => `${head} ${quoteArg(c)}`);
  }

  /** print through the chat console (falls back to the browser console) */
  print(text: string, kind: ChatKind = 'info'): void {
    try {
      this.game.chat.print(text, kind);
    } catch {
      console.log(`[chat:${kind}] ${text}`);
    }
  }

  /** mark the current city as cheated; prints the notice once per city */
  markCheated(): void {
    const w = this.game.world;
    if (!w || w.ext.cheated === true) return;
    w.ext.cheated = true;
    this.print('(cheat) Cheats used — achievements are disabled for this city.', 'warn');
  }

  clearHistory(): void {
    this.history = [];
    this.persistHistory();
  }

  private pushHistory(s: string): void {
    if (this.history[this.history.length - 1] !== s) this.history.push(s);
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    this.persistHistory();
  }

  private persistHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      /* storage unavailable */
    }
  }

  private sfx(id: 'error' | 'click'): void {
    try {
      this.game.audio.play(id, 0.6);
    } catch {
      /* audio optional */
    }
  }
}
