// Milestones (population thresholds that unlock content) and achievements.
import { MILESTONES } from '../data/milestones';
import { ACHIEVEMENTS, type AchievementSnapshot } from '../data/achievements';
import { STYLES } from '../data/styles';
import { formatMoney, formatNumber } from '../core/util';
import type { SimContext } from './context';
import { unlockedAt } from './catalog';
import { operatingNet } from './economy';

/** Grant milestone `index` (and any skipped below it). Returns true if anything changed. */
export function grantMilestone(ctx: SimContext, index: number, opts: { cheat?: boolean } = {}): boolean {
  const w = ctx.world;
  const target = Math.max(0, Math.min(MILESTONES.length - 1, Math.floor(index)));
  if (target <= w.milestone) return false;
  let reward = 0;
  for (let i = w.milestone + 1; i <= target; i++) reward += MILESTONES[i].reward;
  w.milestone = target;
  const ms = MILESTONES[target];
  if (reward > 0) w.earn(reward, 'milestone');
  const unlocks = ms.unlocksText.join(', ');
  const newStyles = STYLES.filter((s) => s.unlock === target).map((s) => s.name);
  const extra = newStyles.length ? ` New style: ${newStyles.join(', ')}.` : '';
  w.notify({
    kind: 'milestone',
    title: `${ms.name} reached!`,
    text: `${opts.cheat ? '' : `Population ${formatNumber(w.stats.population)}. `}Unlocked: ${unlocks}.${extra}${reward > 0 && !w.creative ? ` Reward: ${formatMoney(reward)}.` : ''}`,
    icon: '🏆',
    x: w.home.x,
    y: w.home.y,
  });
  ctx.game.events.emit('milestone', ms);
  ctx.game.events.emit('unlocks:changed', null);
  if (!ctx.fastForward) {
    try { ctx.game.audio.play('milestone'); } catch { /* audio optional */ }
  }
  ctx.refreshServiceFields();
  ctx.refreshGrace();
  ctx.state.chirp.queue.push({ topic: 'milestone', vars: { milestone: ms.name, unlock: ms.unlocksText[0] ?? 'new buildings' } });
  return true;
}

/** Natural milestone progress: called daily with the current population. */
export function checkMilestones(ctx: SimContext): void {
  const w = ctx.world;
  const pop = w.stats.population;
  let next = w.milestone;
  while (next + 1 < MILESTONES.length && pop >= MILESTONES[next + 1].population) next++;
  if (next > w.milestone) {
    // grant one at a time so every fanfare / reward is announced
    for (let i = w.milestone + 1; i <= next; i++) grantMilestone(ctx, i);
  }
}

/** Buildings newly unlocked at a milestone (for advisor hints). */
export function unlockHint(index: number): string[] {
  return unlockedAt(index).slice(0, 6).map((d) => d.name);
}

// ── achievements ─────────────────────────────────────────────────────────────
export function achievementSnapshot(ctx: SimContext): AchievementSnapshot {
  const w = ctx.world, s = w.stats, st = ctx.state, m = st.metrics, a = ctx.last, e = w.economy;
  const byZone: Record<string, number> = {};
  const zoneIds = ['', 'res_low', 'res_med', 'res_high', 'com_low', 'com_high', 'office', 'industry', 'farming', 'forestry', 'mining', 'oil', 'mixed'];
  for (let z = 1; z < zoneIds.length; z++) byZone[zoneIds[z]] = a.byZone[z] ?? 0;
  const modes = new Set<string>();
  let ridership = 0, lines = 0;
  for (const l of w.transitLines) {
    if (!l.active) continue;
    lines++;
    modes.add(l.mode);
    ridership += l.ridership || 0;
  }
  let minTax = 1, maxTax = 0;
  for (const v of Object.values(e.taxes)) {
    minTax = Math.min(minTax, v);
    maxTax = Math.max(maxTax, v);
  }
  const svcBudgets = ['power', 'water', 'garbage', 'health', 'deathcare', 'fire', 'police', 'education', 'parks'] as const;
  let bsum = 0;
  for (const c of svcBudgets) bsum += e.budgets[c] ?? 1;
  const op = operatingNet(e.lastIncome, e.lastExpense);
  const inc = op.income, exp = op.expense;
  let roadCells = 0;
  for (let t = 1; t < ctx.roadCounts.length; t++) roadCells += ctx.roadCounts[t] ?? 0;
  const days = Math.floor(w.time.day);
  return {
    population: s.population,
    maxPopulation: m.maxPopulation,
    milestone: w.milestone,
    years: Math.floor(days / 360),
    months: Math.floor(days / 30),
    money: e.money,
    netIncome: inc - exp,
    income: inc,
    profitStreak: m.profitStreak,
    loans: e.loans.length,
    loansTaken: m.loansTaken,
    loansRepaid: m.loansRepaid,
    maxLoans: m.maxLoans,
    comeback: m.comeback,
    minMoney: m.minMoney,
    happiness: s.happiness,
    health: s.health,
    education: s.education,
    crimeRate: s.crimeRate,
    pollution: s.pollution,
    landValue: s.landValue,
    trafficFlow: s.trafficFlow,
    unemployment: s.workforce > 0 ? s.unemployed / s.workforce : 0,
    buildings: s.buildings,
    zoned: a.zoned,
    services: a.services,
    level5: a.level5,
    highDensity: a.highDensity,
    abandoned: a.abandoned,
    abandonedEver: m.abandonedEver,
    recovered: m.recovered,
    levelUps: m.levelUps,
    spawned: m.spawned,
    densified: m.densified,
    byZone,
    byCategory: { ...a.serviceByCat },
    byDef: { ...a.defCount },
    parks: a.parks,
    landmarks: a.landmarks,
    monuments: a.monuments,
    transitLines: lines,
    transitModes: modes.size,
    ridership,
    policies: ctx.policies.activeCount(),
    districts: w.districts.length,
    styles: a.styles.size,
    tourists: s.tourists,
    exports: st.monthExports,
    renewableShare: a.nominalMW > 0 ? a.renewableMW / a.nominalMW : 0,
    powerProduced: a.nominalMW,
    waterProduced: s.water.produced,
    coverageAll: a.coverageEvaluated > 0 ? a.coveredAll / a.coverageEvaluated : 0,
    students: s.students,
    disasters: m.disasters,
    happyStreak: m.happyStreak,
    cleanStreak: m.cleanStreak,
    employStreak: m.employStreak,
    totalBirths: m.totalBirths,
    chirps: m.chirps,
    minTax,
    maxTax,
    avgBudget: bsum / svcBudgets.length,
    roadCells,
    bridgeCells: ctx.bridgeCells,
    difficulty: w.settings.difficulty,
    creative: w.creative,
  };
}

/** Monthly streak counters feeding the achievements. */
export function updateStreaks(ctx: SimContext): void {
  const s = ctx.world.stats, m = ctx.state.metrics;
  m.happyStreak = s.population >= 500 && s.happiness >= 85 ? m.happyStreak + 1 : 0;
  m.cleanStreak = s.population >= 5000 && s.pollution < 6 ? m.cleanStreak + 1 : 0;
  const unemp = s.workforce > 0 ? s.unemployed / s.workforce : 1;
  m.employStreak = s.population >= 2000 && unemp < 0.05 ? m.employStreak + 1 : 0;
}

/** Check every locked achievement; unlock + announce the ones now satisfied. */
export function checkAchievements(ctx: SimContext): void {
  const w = ctx.world;
  if (w.ext.cheated === true || w.creative) return;
  if (!ctx.lastValid) return;
  const snap = achievementSnapshot(ctx);
  for (const a of ACHIEVEMENTS) {
    if (w.achievements.includes(a.id)) continue;
    let ok = false;
    try {
      ok = a.check(snap);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    w.achievements.push(a.id);
    w.notify({ kind: 'achievement', title: `Achievement: ${a.name}`, text: a.description, icon: a.icon });
    ctx.game.events.emit('achievement', { id: a.id, name: a.name, description: a.description, icon: a.icon, hidden: a.hidden });
    if (!ctx.fastForward) {
      try { ctx.game.audio.play('achievement'); } catch { /* audio optional */ }
    }
  }
}
