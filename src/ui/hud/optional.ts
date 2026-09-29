// Data owned by other modules that may not exist yet while modules are built
// in parallel. Loaded through Vite's eager glob so a missing file simply
// yields an empty module instead of a build error.
import type { AchievementDef } from '../../core/types';

type Mod = Record<string, unknown>;

const achievementMods = import.meta.glob('../../data/achievements.ts', { eager: true }) as Record<string, Mod>;
const tuningMods = import.meta.glob('../../sim/tuning.ts', { eager: true }) as Record<string, Mod>;

function firstArray<T>(mods: Record<string, Mod>, preferred: string, test: (v: unknown) => boolean): T[] {
  for (const m of Object.values(mods)) {
    const p = m[preferred];
    if (Array.isArray(p) && (p.length === 0 || test(p[0]))) return p as T[];
    for (const v of Object.values(m)) if (Array.isArray(v) && v.length && test(v[0])) return v as T[];
  }
  return [];
}

let achCache: AchievementDef[] | null = null;
/** achievement catalog from src/data/achievements.ts (empty if not present) */
export function achievementDefs(): AchievementDef[] {
  if (!achCache) {
    achCache = firstArray<AchievementDef>(achievementMods, 'ACHIEVEMENTS', (v) => {
      const o = v as Partial<AchievementDef>;
      return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.description === 'string';
    });
  }
  return achCache;
}

export interface LoanTierInfo {
  amount: number;
  years: number;
  rate: number;
  unlock: number;
}

const DEFAULT_TIERS: LoanTierInfo[] = [
  { amount: 50_000, years: 5, rate: 0.05, unlock: 0 },
  { amount: 150_000, years: 10, rate: 0.07, unlock: 0 },
  { amount: 400_000, years: 20, rate: 0.09, unlock: 3 },
  { amount: 1_200_000, years: 25, rate: 0.095, unlock: 6 },
  { amount: 4_000_000, years: 30, rate: 0.1, unlock: 9 },
];

/** loan tiers offered by the simulation (src/sim/tuning.ts LOAN_TIERS) */
export function loanTiers(): LoanTierInfo[] {
  const t = firstArray<LoanTierInfo>(tuningMods, 'LOAN_TIERS', (v) => {
    const o = v as Partial<LoanTierInfo>;
    return !!o && typeof o.amount === 'number' && typeof o.years === 'number' && typeof o.rate === 'number';
  });
  return t.length ? t.map((x) => ({ ...x, unlock: x.unlock ?? 0 })) : DEFAULT_TIERS;
}

export function maxLoans(): number {
  for (const m of Object.values(tuningMods)) if (typeof m.MAX_LOANS === 'number') return m.MAX_LOANS;
  return 3;
}

/** monthly annuity payment */
export function loanPayment(amount: number, yearlyRate: number, years: number): number {
  const n = Math.max(1, Math.round(years * 12));
  const r = yearlyRate / 12;
  if (r <= 0) return amount / n;
  return (amount * r) / (1 - Math.pow(1 + r, -n));
}
