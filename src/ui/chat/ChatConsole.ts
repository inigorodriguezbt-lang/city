// STUB — owned by the "ui-menus" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';

export type ChatKind = 'info' | 'ok' | 'error' | 'warn' | 'input' | 'system';

export class ChatConsole {
  isOpen = false;
  constructor(protected game: Game, readonly root: HTMLElement) {}
  init(): void {}
  open(_prefill = ''): void { this.isOpen = true; }
  close(): void { this.isOpen = false; }
  print(text: string, _kind: ChatKind = 'info'): void { console.log('[chat]', text); }
  clear(): void {}
}
