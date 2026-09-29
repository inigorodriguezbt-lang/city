// Key-combo parsing and pretty labels shared by InputManager and the UI.
// Combo format: modifiers in canonical order + KeyboardEvent.code, e.g.
// "Ctrl+Shift+KeyZ", "Alt+Digit1", "Space", "ShiftLeft".

export interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  code: string;
}

export const isMac: boolean = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export function parseCombo(s: string): ParsedCombo | null {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: ParsedCombo = { ctrl: false, shift: false, alt: false, code: '' };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const last = i === parts.length - 1;
    const low = p.toLowerCase();
    if (!last && (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta')) out.ctrl = true;
    else if (!last && low === 'shift') out.shift = true;
    else if (!last && (low === 'alt' || low === 'option')) out.alt = true;
    else if (last) out.code = p;
    else return null;
  }
  return out.code ? out : null;
}

export function formatCombo(c: ParsedCombo): string {
  return [c.ctrl ? 'Ctrl' : '', c.shift ? 'Shift' : '', c.alt ? 'Alt' : '', c.code].filter(Boolean).join('+');
}

/** canonical combo string of a keydown (Meta counts as Ctrl on macOS) */
export function eventCombo(e: KeyboardEvent): string {
  return formatCombo({
    ctrl: e.ctrlKey || (isMac && e.metaKey),
    shift: e.shiftKey && !e.code.startsWith('Shift'),
    alt: e.altKey && !e.code.startsWith('Alt'),
    code: e.code,
  });
}

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Slash: '/', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Backquote: '`', IntlBackslash: '<',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Alt', AltRight: 'AltGr', MetaLeft: isMac ? '⌘' : 'Win', MetaRight: isMac ? 'Right ⌘' : 'Right Win',
  ContextMenu: 'Menu', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause',
  Mouse0: 'Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

/** pretty label of a bare KeyboardEvent.code */
export function codeLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Mouse')) return 'Mouse ' + code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** pretty label of a combo string: "Ctrl+Z", "Shift+R", "Space" (macOS: "⌘Z", "⇧R") */
export function comboLabel(s: string): string {
  const c = parseCombo(s);
  if (!c) return s;
  const key = codeLabel(c.code);
  if (isMac) return (c.ctrl ? '⌘' : '') + (c.alt ? '⌥' : '') + (c.shift ? '⇧' : '') + key;
  return [c.ctrl ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
