// Small pure helpers shared everywhere (no DOM/THREE).
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential damping factor */
export const damp = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);

export function formatMoney(v: number, compact = false): string {
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (compact && a >= 1e9) s = (a / 1e9).toFixed(2) + 'B';
  else if (compact && a >= 1e6) s = (a / 1e6).toFixed(2) + 'M';
  else if (compact && a >= 1e4) s = (a / 1e3).toFixed(1) + 'k';
  else s = Math.round(a).toLocaleString('en-US');
  return (neg ? '-$' : '$') + s;
}

export function formatNumber(v: number, compact = false): string {
  const a = Math.abs(v);
  if (compact && a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (compact && a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toLocaleString('en-US');
}

export function formatPercent(v01: number, digits = 0): string {
  return (v01 * 100).toFixed(digits) + '%';
}

/** Parse "#rrggbb" to [r,g,b] 0..1 */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function uid(): number {
  return (uidCounter = (uidCounter + 1) >>> 0);
}
let uidCounter = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Yield to the event loop (lets the UI paint during long jobs). */
export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
