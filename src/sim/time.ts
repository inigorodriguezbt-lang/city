// Simulation clock: advances the calendar (world.time.day) and the visual time
// of day (world.time.hour) and tells the simulation which fixed ticks are due.
import { MAX_SPEED_LEVEL, REAL_SECONDS_PER_DAY, SPEEDS, TICKS_PER_DAY } from '../core/constants';
import type { World } from '../world/World';

/** Max fixed ticks processed in one frame (catch-up is spread over frames). */
export const MAX_TICKS_PER_FRAME = 12;

export class SimClock {
  /** last processed global tick (tick t covers day floor(t / TICKS_PER_DAY), slice t % TICKS_PER_DAY) */
  lastTick = -1;

  constructor(private world: World) {
    this.resync();
  }

  /** align with the world's current time (after load) so the current tick runs next */
  resync(): void {
    this.lastTick = Math.floor(this.world.time.day * TICKS_PER_DAY) - 1;
  }

  get speedMult(): number {
    return SPEEDS[this.world.time.speed] ?? 0;
  }

  /**
   * Advance time by `dt` real seconds.
   * @param dayCycleMinutes real minutes per 24 h at 1x (0 = keep noon)
   * @returns the newest tick that is due
   */
  advance(dt: number, dayCycleMinutes: number): number {
    const t = this.world.time;
    const mult = this.speedMult;
    if (!(dayCycleMinutes > 0)) t.hour = 12;
    else if (mult > 0) t.hour = (((t.hour + (dt * mult * 24) / (dayCycleMinutes * 60)) % 24) + 24) % 24;
    if (mult > 0) t.day += (dt * mult) / REAL_SECONDS_PER_DAY;
    return Math.floor(t.day * TICKS_PER_DAY);
  }

  static clampSpeed(level: number): number {
    if (!Number.isFinite(level)) return 1;
    return Math.max(0, Math.min(MAX_SPEED_LEVEL, Math.round(level)));
  }
}
