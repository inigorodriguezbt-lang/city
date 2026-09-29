// Registers every built-in chat command.
import type { CommandRegistry } from '../CommandRegistry';
import { registerCheats } from './cheats';
import { registerCity } from './city';
import { registerGeneral } from './general';
import { registerNavigation } from './navigation';
import { registerTimeWeather } from './timeWeather';

export function registerBuiltins(reg: CommandRegistry): void {
  registerGeneral(reg);
  registerNavigation(reg);
  registerTimeWeather(reg);
  registerCity(reg);
  registerCheats(reg);
}
