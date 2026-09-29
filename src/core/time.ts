import { DAYS_PER_MONTH, DAYS_PER_YEAR, MONTHS_PER_YEAR, START_YEAR } from './constants';
import type { Season } from './types';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export interface Calendar {
  year: number;
  /** 0..11 */
  month: number;
  /** 1..30 */
  dayOfMonth: number;
  season: Season;
  /** 0..1 progress through the year */
  yearProgress: number;
}

export function calendar(day: number): Calendar {
  const d = Math.floor(day);
  const year = START_YEAR + Math.floor(d / DAYS_PER_YEAR);
  const dayOfYear = d % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
  const dayOfMonth = (dayOfYear % DAYS_PER_MONTH) + 1;
  return { year, month, dayOfMonth, season: seasonOfMonth(month), yearProgress: dayOfYear / DAYS_PER_YEAR };
}

export function seasonOfMonth(month: number): Season {
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

export function formatDate(day: number): string {
  const c = calendar(day);
  return `${c.dayOfMonth} ${MONTH_SHORT[c.month]} ${c.year}`;
}

export function formatHour(hour: number, h24 = true): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  if (h24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** 0 at night … 1 at noon, smooth. */
export function daylight(hour: number): number {
  const t = Math.cos(((hour - 12) / 24) * Math.PI * 2);
  return Math.max(0, Math.min(1, t * 0.9 + 0.35));
}

/** true between dusk and dawn (for lights) */
export function isNight(hour: number): boolean {
  return hour < 6.2 || hour > 19.3;
}
