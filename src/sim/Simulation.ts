// STUB — owned by the "sim-core" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Building, BudgetCategory, TaxCategory, ZoneCategory } from '../core/types';
import { REAL_SECONDS_PER_DAY, SPEEDS, TICKS_PER_DAY } from '../core/constants';

export interface InfoLine {
  label: string;
  value: string;
  /** optional 0..1 bar */
  bar?: number;
  kind?: 'good' | 'bad' | 'neutral';
}

export interface BuildingInfo {
  title: string;
  subtitle: string;
  icon: string;
  lines: InfoLine[];
  /** notable citizens/workers with names for flavour */
  people?: { name: string; detail: string }[];
  /** problems as text */
  problems: string[];
}

export class Simulation {
  protected world: World | null = null;
  constructor(protected game: Game) {}

  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }

  /** Advance calendar/time-of-day and run fixed ticks. dt = real seconds. */
  update(dt: number): void {
    const w = this.world;
    if (!w) return;
    const mult = SPEEDS[w.time.speed] ?? 0;
    const prevTick = Math.floor(w.time.day * TICKS_PER_DAY);
    w.time.day += (dt * mult) / REAL_SECONDS_PER_DAY;
    const nowTick = Math.floor(w.time.day * TICKS_PER_DAY);
    for (let t = prevTick + 1; t <= nowTick; t++) this.game.events.emit('sim:tick', { day: w.time.day, tick: t });
  }

  get speed(): number { return this.world?.time.speed ?? 0; }
  setSpeed(level: number): void { if (this.world) { this.world.time.speed = level; this.game.events.emit('time:speed', level); } }
  togglePause(): void {}
  /** fast-forward the simulation by n days (runs ticks synchronously) */
  advanceDays(_n: number): void {}
  /** set visual time of day (0..24) */
  setHour(h: number): void { if (this.world) this.world.time.hour = ((h % 24) + 24) % 24; }

  getDemand(): Record<ZoneCategory, number> { return this.world?.stats.demand ?? { res: 0, com: 0, ind: 0, off: 0 }; }
  buildingInfo(_id: number): BuildingInfo | null { return null; }
  /** deterministic citizen names for a building */
  citizenNames(_b: Building, _count: number): string[] { return []; }

  // economy
  setTax(_cat: TaxCategory, _rate: number): void {}
  setBudget(_cat: BudgetCategory, _v: number): void {}
  takeLoan(_amount: number, _years: number): boolean { return false; }
  repayLoan(_id: number): boolean { return false; }
  /** projected monthly income/expense breakdown at current state */
  projection(): { income: Record<string, number>; expense: Record<string, number> } { return { income: {}, expense: {} }; }
  togglePolicy(_id: string, _districtId?: number): boolean { return false; }
  isPolicyActive(_id: string, _districtId?: number): boolean { return false; }

  // cheats / commands
  addResidents(_n: number): void {}
  grantMilestone(_index: number): void {}
}
