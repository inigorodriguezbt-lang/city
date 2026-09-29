// ─────────────────────────────────────────────────────────────────────────────
// ChatConsole: Minecraft-style command chat in the bottom-left corner.
//
// Closed: the last ~10 lines float over the city and fade out ~10 s after the
// last activity. Open (T / Enter / "/" via Game.ts): a glass panel with the
// full scrollable history, an input line with ↑/↓ history (persisted), Tab
// completion (cycles candidates from game.commands.complete) and a live
// suggestion list with the matched command's usage. Game input is suspended
// while typing and restored on close.
// ─────────────────────────────────────────────────────────────────────────────
import '../menus.css';
import type { Game } from '../../game/Game';
import type { CommandDef } from '../../commands/CommandRegistry';
import { h } from '../dom';
import { mIcon } from '../menus/icons';

export type ChatKind = 'info' | 'ok' | 'error' | 'warn' | 'input' | 'system';

const HISTORY_KEY = 'urbis.chat.history.v1';
const HISTORY_MAX = 100;
const LOG_MAX = 400;
const FADE_AFTER_MS = 10_000;
const SUGGEST_MAX = 8;

interface Cycle {
  base: string;
  items: string[];
  index: number;
}

export class ChatConsole {
  isOpen = false;
  private el!: HTMLElement;
  private log!: HTMLElement;
  private input!: HTMLInputElement;
  private suggest!: HTMLElement;
  private usage!: HTMLElement;
  private built = false;
  private history: string[] = [];
  /** index into history while browsing (history.length = draft) */
  private hIndex = 0;
  private draft = '';
  private cycle: Cycle | null = null;
  private fadeTimer = 0;
  private savedInputEnabled: boolean | null = null;
  private savedMenusOpen = false;
  private suggestSel = -1;
  private suggestItems: string[] = [];
  private pendingText = '';

  constructor(protected game: Game, readonly root: HTMLElement) {}

  init(): void {
    if (this.built) return;
    this.built = true;
    this.history = this.readHistory();
    this.hIndex = this.history.length;
    this.log = h('div', { class: 'ch-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Chat messages' });
    this.input = h('input', {
      type: 'text', class: 'ch-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', maxLength: 256,
      'aria-label': 'Chat or command', placeholder: 'Type a message or /command — Tab completes',
    }) as HTMLInputElement;
    this.suggest = h('div', { class: 'ch-suggest', role: 'listbox', 'aria-label': 'Suggestions' });
    this.usage = h('div', { class: 'ch-usage' });
    const sendBtn = h('button', { class: 'ch-send', type: 'button', 'aria-label': 'Send' }, mIcon('send', 16));
    sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    sendBtn.addEventListener('click', () => void this.submit());
    const closeBtn = h('button', { class: 'ch-close', type: 'button', 'aria-label': 'Close chat' }, mIcon('x', 16));
    closeBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    closeBtn.addEventListener('click', () => this.close());
    const bar = h('div', { class: 'ch-bar' }, h('span', { class: 'ch-prompt' }, '›'), this.input, sendBtn, closeBtn);
    this.el = h('div', { class: 'ch-root idle' }, this.log, h('div', { class: 'ch-pop' }, this.suggest, this.usage), bar);
    this.root.append(this.el);

    this.input.addEventListener('keydown', this.onKey);
    this.input.addEventListener('input', () => {
      this.cycle = null;
      this.hIndex = this.history.length;
      this.updateSuggestions();
    });
    // stop wheel/pointer from reaching the 3D view while interacting with the chat
    for (const t of ['pointerdown', 'wheel', 'contextmenu', 'dblclick']) {
      this.el.addEventListener(t, (e) => {
        if (this.isOpen) e.stopPropagation();
      });
    }
    // clicking anywhere else closes the chat (the draft is kept)
    window.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !this.el.contains(e.target as Node)) this.close(true);
    }, true);
    this.game.events.on('settings:changed', () => this.place());
    this.game.events.on('world:loaded', () => this.place());
    this.game.events.on('world:unloaded', () => {
      if (this.isOpen) this.close();
    });
    this.place();
  }

  /** open the input line; `prefill` e.g. "/" when opened with the command key */
  open(prefill = ''): void {
    this.init();
    if (!this.isOpen) {
      this.isOpen = true;
      const input = this.game.input;
      if (input) {
        this.savedInputEnabled = input.enabled;
        this.savedMenusOpen = !!this.game.menus?.isOpen();
        input.enabled = false;
      }
      this.el.classList.add('open');
      this.el.classList.remove('idle');
      window.visualViewport?.addEventListener('resize', this.onViewport);
      window.visualViewport?.addEventListener('scroll', this.onViewport);
      this.onViewport();
      window.clearTimeout(this.fadeTimer);
      this.place();
    }
    const text = prefill || this.pendingText;
    this.pendingText = '';
    this.input.value = text;
    this.hIndex = this.history.length;
    this.cycle = null;
    this.input.focus({ preventScroll: true });
    const n = this.input.value.length;
    this.input.setSelectionRange(n, n);
    this.log.scrollTop = this.log.scrollHeight;
    this.updateSuggestions();
    this.sfx('open', 0.4);
  }

  /** close the input line; `keepDraft` remembers the text for the next open() */
  close(keepDraft = false): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.pendingText = keepDraft ? this.input.value : '';
    this.input.value = '';
    this.cycle = null;
    this.hideSuggestions();
    this.el.classList.remove('open', 'kb');
    window.visualViewport?.removeEventListener('resize', this.onViewport);
    window.visualViewport?.removeEventListener('scroll', this.onViewport);
    if (document.activeElement === this.input) this.input.blur();
    const input = this.game.input;
    if (input && this.savedInputEnabled !== null) {
      // input was only off because a menu was open, and that menu has closed since
      const menusClosed = this.savedMenusOpen && !this.game.menus?.isOpen();
      input.enabled = this.game.menus?.isOpen() ? false : menusClosed ? true : this.savedInputEnabled;
    }
    this.savedInputEnabled = null;
    this.log.scrollTop = this.log.scrollHeight;
    this.touch();
  }

  /** append a message (multi-line supported) */
  print(text: string, kind: ChatKind = 'info'): void {
    this.init();
    if (!this.isOpen) this.place();
    const msg = String(text ?? '');
    const line = h('div', { class: `ch-line ${kind}` });
    if (kind === 'input' && msg.startsWith('/')) {
      line.append(h('span', { class: 'ch-cmd' }, msg));
    } else {
      const m = /^<([^>]{1,32})> ([\s\S]*)$/.exec(msg);
      if (m) line.append(h('span', { class: 'ch-who' }, `<${m[1]}>`), ' ', m[2]);
      else line.textContent = msg;
    }
    const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    this.log.append(line);
    while (this.log.childElementCount > LOG_MAX) this.log.firstElementChild?.remove();
    if (!this.isOpen || stick) this.log.scrollTop = this.log.scrollHeight;
    this.touch();
  }

  clear(): void {
    this.init();
    this.log.replaceChildren();
  }

  // ── internals ────────────────────────────────────────────────────────────
  /** restart the fade timer (log stays visible for a while after activity) */
  private touch(): void {
    this.el.classList.remove('idle');
    window.clearTimeout(this.fadeTimer);
    if (this.isOpen) return;
    this.fadeTimer = window.setTimeout(() => {
      if (!this.isOpen) this.el.classList.add('idle');
    }, FADE_AFTER_MS);
  }

  /** on-screen keyboards shrink the visual viewport: lift the chat above them */
  private onViewport = (): void => {
    const vv = window.visualViewport;
    if (!vv || !this.isOpen) return;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const scale = this.game.settings.value.ui.scale || 1;
    this.el.classList.toggle('kb', covered > 80);
    this.el.style.setProperty('--kb', `${Math.round(covered / scale)}px`);
  };

  /** keep clear of the HUD minimap (bottom-left) when it is shown */
  private place(): void {
    if (!this.el) return;
    const s = this.game.settings.value;
    const minimap = !!this.game.world && s.ui.minimap && this.game.ui?.hudVisible !== false;
    this.el.classList.toggle('mm', minimap);
    this.el.classList.toggle('reduced', !!s.ui.reducedMotion);
  }

  private sfx(id: 'open' | 'click' | 'error' | 'close', v = 1): void {
    try {
      this.game.audio?.play(id, v);
    } catch {
      /* audio unavailable */
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    // keep everything typed here away from global shortcuts
    e.stopPropagation();
    if (e.isComposing) return;
    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        // Enter on a partial command name picks the highlighted suggestion first
        const line = this.input.value.trim();
        const pick = this.suggestItems[this.suggestSel];
        if (pick && line.startsWith('/') && !/\s/.test(line) && !this.findCommand(line.slice(1))) {
          this.applyCompletion(pick, true);
          return;
        }
        void this.submit();
        return;
      }
      case 'Escape':
        e.preventDefault();
        this.close();
        return;
      case 'Tab':
        e.preventDefault();
        this.complete(e.shiftKey ? -1 : 1);
        return;
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const d = e.key === 'ArrowUp' ? -1 : 1;
        // with a partial command typed, arrows walk the suggestion list; otherwise history
        if (this.suggestItems.length > 1 && this.suggestSel >= 0 && this.input.value.length > 1) this.moveSuggest(d);
        else this.browse(d);
        return;
      }
      case 'PageUp':
        e.preventDefault();
        this.log.scrollTop -= this.log.clientHeight * 0.8;
        return;
      case 'PageDown':
        e.preventDefault();
        this.log.scrollTop += this.log.clientHeight * 0.8;
        return;
      default:
        break;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      this.clear();
    }
  };

  private async submit(): Promise<void> {
    const raw = this.input.value;
    const line = raw.trim();
    if (!line) {
      this.close();
      return;
    }
    this.pushHistory(line);
    this.input.value = '';
    this.close();
    if (line.startsWith('/')) {
      this.print(line, 'input');
      try {
        await this.game.commands.execute(line);
      } catch (err) {
        this.print(`Command failed: ${String((err as Error)?.message ?? err)}`, 'error');
        this.sfx('error', 0.6);
      }
    } else {
      this.print(`<you> ${line}`, 'input');
      this.sfx('click', 0.4);
    }
  }

  // ── history ──────────────────────────────────────────────────────────────
  private readHistory(): string[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX) : [];
    } catch {
      return [];
    }
  }

  private pushHistory(line: string): void {
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    this.hIndex = this.history.length;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      /* storage unavailable */
    }
    // keep the registry's in-memory history in step for commands that read it
    try {
      const reg = this.game.commands;
      if (reg && Array.isArray(reg.history) && reg.history[reg.history.length - 1] !== line) {
        reg.history.push(line);
        if (reg.history.length > HISTORY_MAX) reg.history.splice(0, reg.history.length - HISTORY_MAX);
      }
    } catch {
      /* registry unavailable */
    }
  }

  private browse(dir: number): void {
    if (!this.history.length) return;
    if (this.hIndex === this.history.length) this.draft = this.input.value;
    const n = Math.max(0, Math.min(this.history.length, this.hIndex + dir));
    if (n === this.hIndex) return;
    this.hIndex = n;
    this.input.value = n === this.history.length ? this.draft : this.history[n];
    const len = this.input.value.length;
    this.input.setSelectionRange(len, len);
    this.cycle = null;
    this.updateSuggestions();
  }

  // ── completion ───────────────────────────────────────────────────────────
  /** registered commands, minus ones the registry marks as hidden */
  private commands(): CommandDef[] {
    try {
      return (this.game.commands?.list() ?? []).filter((c) => !(c as CommandDef & { hidden?: boolean }).hidden);
    } catch {
      return [];
    }
  }

  private findCommand(name: string): CommandDef | undefined {
    const n = name.toLowerCase();
    return this.commands().find((c) => c.name.toLowerCase() === n || (c.aliases ?? []).some((a) => a.toLowerCase() === n));
  }

  /** completion candidates for the current line (registry first, then command names) */
  private candidates(line: string): string[] {
    let list: string[] = [];
    try {
      list = this.game.commands?.complete(line) ?? [];
    } catch {
      list = [];
    }
    if (!list.length && line.startsWith('/') && !/\s/.test(line)) {
      const p = line.slice(1).toLowerCase();
      list = this.commands().map((c) => c.name).filter((n) => n.toLowerCase().startsWith(p)).sort();
    }
    return [...new Set(list.filter((c) => typeof c === 'string' && c.length))];
  }

  /** turn a candidate into the full line it produces */
  private applyTo(base: string, cand: string): string {
    if (cand.startsWith('/')) return cand;
    if (/\s/.test(cand.trim())) return '/' + cand.trim();
    if (!/\s/.test(base)) return '/' + cand.replace(/^\//, '');
    // replace the last (partial) argument
    const cut = base.search(/\S*$/);
    return base.slice(0, cut) + cand;
  }

  private complete(dir: number): void {
    const line = this.input.value;
    if (!this.cycle || this.cycle.items.length === 0) {
      const items = this.candidates(line);
      if (!items.length) {
        this.sfx('error', 0.3);
        this.el.classList.remove('nudge');
        void this.el.offsetWidth;
        this.el.classList.add('nudge');
        return;
      }
      if (items.length === 1) {
        this.applyCompletion(items[0], true);
        return;
      }
      // complete the common prefix first, then cycle
      const full = items.map((c) => this.applyTo(line, c));
      const prefix = commonPrefix(full);
      if (prefix.length > line.length) {
        this.input.value = prefix;
        this.updateSuggestions();
        return;
      }
      this.cycle = { base: line, items, index: dir > 0 ? -1 : 0 };
    }
    const c = this.cycle;
    c.index = (c.index + dir + c.items.length) % c.items.length;
    this.input.value = this.applyTo(c.base, c.items[c.index]);
    const n = this.input.value.length;
    this.input.setSelectionRange(n, n);
    this.renderSuggestions(c.items, c.index);
    this.renderUsage();
  }

  private applyCompletion(cand: string, addSpace: boolean): void {
    const line = this.applyTo(this.input.value, cand);
    const cmd = this.findCommand(line.replace(/^\//, '').split(/\s+/)[0] ?? '');
    const needsArgs = !!cmd && /[<[]/.test(cmd.usage);
    this.input.value = addSpace && (needsArgs || /\s/.test(line)) && !line.endsWith(' ') ? line + ' ' : line;
    const n = this.input.value.length;
    this.input.setSelectionRange(n, n);
    this.cycle = null;
    this.updateSuggestions();
  }

  private updateSuggestions(): void {
    const line = this.input.value;
    if (!line.startsWith('/')) {
      this.hideSuggestions();
      return;
    }
    if (!/\s/.test(line)) {
      const p = line.slice(1).toLowerCase();
      const cmds = this.commands()
        .filter((c) => c.name.toLowerCase().startsWith(p) || (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(p)))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.renderCommandList(cmds.slice(0, SUGGEST_MAX), cmds.length);
      this.renderUsage();
      return;
    }
    // arguments: show candidate values (if any) + the command usage
    const items = this.candidates(line).slice(0, 24);
    this.renderSuggestions(items, -1);
    this.renderUsage();
  }

  private renderCommandList(cmds: CommandDef[], total: number): void {
    this.suggestItems = cmds.map((c) => c.name);
    this.suggestSel = cmds.length ? 0 : -1;
    this.suggest.replaceChildren();
    cmds.forEach((c, i) => {
      const el = h('div', { class: 'ch-sug cmd' + (i === this.suggestSel ? ' on' : ''), role: 'option' },
        h('span', { class: 'ch-sug-name' }, '/' + c.name),
        h('span', { class: 'ch-sug-usage' }, c.usage.replace(/^\/?\S+\s*/, '')),
        h('span', { class: 'ch-sug-desc' }, c.description),
        c.cheat ? h('span', { class: 'ch-sug-cheat' }, 'cheat') : null);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.applyCompletion(c.name, true);
        this.input.focus();
      });
      this.suggest.append(el);
    });
    if (total > cmds.length) this.suggest.append(h('div', { class: 'ch-sug more' }, `+${total - cmds.length} more — keep typing`));
    this.suggest.classList.toggle('show', cmds.length > 0);
  }

  private renderSuggestions(items: string[], active: number): void {
    this.suggestItems = [];
    this.suggestSel = -1;
    this.suggest.replaceChildren();
    if (!items.length) {
      this.suggest.classList.remove('show');
      return;
    }
    const chips = h('div', { class: 'ch-chips' });
    items.forEach((it, i) => {
      const chip = h('span', { class: 'ch-chip' + (i === active ? ' on' : '') }, it.replace(/^\//, '').split(/\s+/).pop() ?? it);
      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.applyCompletion(it, true);
        this.input.focus();
      });
      chips.append(chip);
    });
    this.suggest.append(chips);
    this.suggest.classList.add('show');
  }

  private moveSuggest(d: number): void {
    const n = this.suggestItems.length;
    if (!n) return;
    this.suggestSel = (this.suggestSel + d + n) % n;
    Array.from(this.suggest.querySelectorAll('.ch-sug.cmd')).forEach((el, i) => el.classList.toggle('on', i === this.suggestSel));
  }

  private renderUsage(): void {
    const line = this.input.value;
    const name = line.replace(/^\//, '').split(/\s+/)[0] ?? '';
    const cmd = line.startsWith('/') && name ? this.findCommand(name) : undefined;
    if (!cmd || (!/\s/.test(line) && this.suggestItems.length > 1)) {
      this.usage.classList.remove('show');
      return;
    }
    const argc = line.trim().split(/\s+/).length - 1 + (/\s$/.test(line) ? 1 : 0);
    // highlight the argument currently being typed in the usage string
    const parts = cmd.usage.replace(/^\/?\S+/, '').trim().split(/\s+(?![^<[]*[>\]])/).filter(Boolean);
    const usage = h('span', { class: 'ch-usage-line' }, h('b', null, '/' + cmd.name));
    parts.forEach((p, i) => usage.append(' ', h('span', { class: i === argc - 1 ? 'arg on' : 'arg' }, p)));
    this.usage.replaceChildren(usage, h('span', { class: 'ch-usage-desc' }, cmd.description), cmd.cheat ? h('span', { class: 'ch-sug-cheat' }, 'cheat') : '');
    this.usage.classList.add('show');
  }

  private hideSuggestions(): void {
    this.suggestItems = [];
    this.suggestSel = -1;
    this.suggest.classList.remove('show');
    this.usage.classList.remove('show');
  }
}

function commonPrefix(list: string[]): string {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) {
    let i = 0;
    while (i < p.length && i < s.length && p[i].toLowerCase() === s[i].toLowerCase()) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}
