// Formatting helpers shared by the menu screens and the chat console.
import { ACTIONS, type ActionId } from '../../settings/types';

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago", or a date */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60;
  if (m < 1.5) return 'a minute ago';
  if (m < 55) return `${Math.round(m)} minutes ago`;
  const h = m / 60;
  if (h < 1.5) return 'an hour ago';
  if (h < 22) return `${Math.round(h)} hours ago`;
  const d = h / 24;
  if (d < 1.8) return 'yesterday';
  if (d < 6.5) return `${Math.round(d)} days ago`;
  if (d < 11) return 'a week ago';
  if (d < 28) return `${Math.round(d / 7)} weeks ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** play time: "42 s", "12 min", "3 h 05 min" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const isMacPlatform: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

// ── key combos ("Ctrl+Shift+KeyZ" style strings, see settings/types.ts) ─────

export interface Combo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  code: string;
}

export function parseCombo(s: string): Combo | null {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const c: Combo = { ctrl: false, shift: false, alt: false, code: '' };
  for (let i = 0; i < parts.length; i++) {
    const low = parts[i].toLowerCase();
    const last = i === parts.length - 1;
    if (!last && (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta')) c.ctrl = true;
    else if (!last && low === 'shift') c.shift = true;
    else if (!last && (low === 'alt' || low === 'option')) c.alt = true;
    else if (last) c.code = parts[i];
    else return null;
  }
  return c.code ? c : null;
}

/** canonical string form (modifier order Ctrl+Shift+Alt) for equality tests */
export function canonicalCombo(s: string): string {
  const c = parseCombo(s);
  if (!c) return s;
  return [c.ctrl ? 'Ctrl' : '', c.shift ? 'Shift' : '', c.alt ? 'Alt' : '', c.code].filter(Boolean).join('+');
}

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Slash: '/', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Backquote: '`', IntlBackslash: '<',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'Alt', AltRight: 'AltGr', MetaLeft: isMacPlatform ? '⌘' : 'Win', MetaRight: isMacPlatform ? 'R ⌘' : 'R Win',
  ContextMenu: 'Menu', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause',
};

export function codeLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

/** keycap parts of a combo: ["Ctrl", "Z"] */
export function comboParts(s: string): string[] {
  const c = parseCombo(s);
  if (!c) return [s];
  const out: string[] = [];
  if (c.ctrl) out.push(isMacPlatform ? '⌘' : 'Ctrl');
  if (c.alt) out.push(isMacPlatform ? '⌥' : 'Alt');
  if (c.shift) out.push(isMacPlatform ? '⇧' : 'Shift');
  out.push(codeLabel(c.code));
  return out;
}

export function comboLabel(s: string): string {
  return comboParts(s).join(isMacPlatform ? '' : '+');
}

/** first binding label of an action from a keybind table ("" if unbound) */
export function actionKey(binds: Record<ActionId, string[]>, a: ActionId): string {
  const b = binds[a]?.[0];
  return b ? comboLabel(b) : '';
}

/** actions (other than `except`) already bound to `combo` */
export function comboConflicts(binds: Record<ActionId, string[]>, combo: string, except?: ActionId): ActionId[] {
  const want = canonicalCombo(combo);
  const out: ActionId[] = [];
  for (const a of Object.keys(ACTIONS) as ActionId[]) {
    if (a === except) continue;
    if ((binds[a] ?? []).some((b) => canonicalCombo(b) === want)) out.push(a);
  }
  return out;
}
