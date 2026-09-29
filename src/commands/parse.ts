// Command-line parsing helpers: tokenizer with quotes/escapes, argument
// quoting for completions, forgiving number parsing and fuzzy matching.

export interface Tokenized {
  tokens: string[];
  /** the line ends with unquoted whitespace (the next argument is empty) */
  trailingSpace: boolean;
  /** the last token has an unterminated quote */
  openQuote: boolean;
}

/** Split a line into arguments. Supports "double" and 'single' quotes and backslash escapes. */
export function tokenize(input: string): Tokenized {
  const tokens: string[] = [];
  let cur = '';
  let inTok = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length && (quote !== "'" || input[i + 1] === "'")) {
      cur += input[++i];
      inTok = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inTok = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inTok) {
        tokens.push(cur);
        cur = '';
        inTok = false;
      }
      continue;
    }
    cur += ch;
    inTok = true;
  }
  const trailingSpace = !inTok && !quote && /\s$/.test(input);
  if (inTok || quote) tokens.push(cur);
  return { tokens, trailingSpace, openQuote: quote !== null };
}

/** Quote an argument when it needs it (spaces, quotes, empty). */
export function quoteArg(s: string): string {
  if (s !== '' && !/[\s"'\\]/.test(s)) return s;
  return '"' + s.replace(/(["\\])/g, '\\$1') + '"';
}

/** Parse "12", "-3.5", "10k", "1.5M", "$25,000", "2b", "1e6". NaN when invalid. */
export function parseNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  let t = s.trim().toLowerCase().replace(/[,_\s]/g, '');
  if (t.startsWith('$')) t = t.slice(1);
  if (t.startsWith('-$')) t = '-' + t.slice(2);
  let mult = 1;
  const suffix = t.slice(-1);
  if (suffix === 'k') mult = 1e3;
  else if (suffix === 'm') mult = 1e6;
  else if (suffix === 'b') mult = 1e9;
  else if (suffix === 't') mult = 1e12;
  if (mult !== 1) t = t.slice(0, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(t)) return NaN;
  return Number(t) * mult;
}

/** Parse an integer (with the same conveniences as parseNumber). */
export function parseInt10(s: string | undefined): number {
  const n = parseNumber(s);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/** on/off/true/false/yes/no/1/0 → boolean; undefined when unrecognised */
export function parseBool(s: string | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  const t = s.toLowerCase();
  if (['on', 'true', 'yes', 'y', '1', 'enable', 'enabled'].includes(t)) return true;
  if (['off', 'false', 'no', 'n', '0', 'disable', 'disabled'].includes(t)) return false;
  return undefined;
}

/** Levenshtein edit distance (small strings). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Best fuzzy suggestions for `q` among `options`. */
export function suggest(q: string, options: Iterable<string>, max = 3): string[] {
  const lq = q.toLowerCase();
  const scored: { o: string; d: number }[] = [];
  for (const o of options) {
    const lo = o.toLowerCase();
    let d = editDistance(lq, lo);
    if (lo.startsWith(lq) || lq.startsWith(lo)) d = Math.min(d, 1);
    else if (lo.includes(lq)) d = Math.min(d, 2);
    if (d <= Math.max(2, Math.floor(lq.length / 3))) scored.push({ o, d });
  }
  scored.sort((a, b) => a.d - b.d || a.o.localeCompare(b.o));
  return [...new Set(scored.map((s) => s.o))].slice(0, max);
}

/** Order candidates for a partial word: prefix matches, then word-start, then substring. */
export function rankMatches(partial: string, candidates: Iterable<string>, limit = 60): string[] {
  const p = partial.toLowerCase();
  const pre: string[] = [], word: string[] = [], sub: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    const lc = c.toLowerCase();
    if (!p || lc.startsWith(p)) pre.push(c);
    else if (lc.split(/[\s_:\-./]+/).some((w) => w.startsWith(p))) word.push(c);
    else if (lc.includes(p)) sub.push(c);
  }
  const byLen = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
  pre.sort(byLen);
  word.sort(byLen);
  sub.sort(byLen);
  return [...pre, ...word, ...sub].slice(0, limit);
}

/** "HH:MM", "H", "7pm", "7:30am" or 0..24 decimals → hours; NaN when invalid */
export function parseClock(s: string): number {
  const t = s.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (min > 59) return NaN;
    if (m[3]) {
      if (h < 1 || h > 12) return NaN;
      h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
    }
    if (h > 24 || (h === 24 && min > 0)) return NaN;
    return (h + min / 60) % 24;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n % 24 : NaN;
}
