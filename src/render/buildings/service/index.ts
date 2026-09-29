// Service / landmark / monument model registry. Owned by the "buildings-service" agent.
// Registers a model generator for every BuildingDef.model key in data/buildings.ts.
import { BUILDINGS } from '../../../data/buildings';
import { registerModel } from '../registry';
import type { ModelFn } from '../types';
import { POWER_MODELS } from './power';
import { UTILITY_MODELS } from './utilities';
import { HEALTH_MODELS } from './health';
import { SAFETY_MODELS } from './safety';
import { EDUCATION_MODELS } from './education';
import { PARK_MODELS } from './parks';
import { PLAZA_MODELS } from './plazas';
import { TRANSIT_MODELS } from './transit';
import { CIVIC_MODELS } from './civic';
import { LANDMARK_MODELS } from './landmarks';
import { MONUMENT_MODELS } from './monuments';

/** Every service model generator, keyed by BuildingDef.model. */
export const SERVICE_MODELS: Record<string, ModelFn> = {
  ...POWER_MODELS,
  ...UTILITY_MODELS,
  ...HEALTH_MODELS,
  ...SAFETY_MODELS,
  ...EDUCATION_MODELS,
  ...PARK_MODELS,
  ...PLAZA_MODELS,
  ...TRANSIT_MODELS,
  ...CIVIC_MODELS,
  ...LANDMARK_MODELS,
  ...MONUMENT_MODELS,
};

let registered = false;

/** Register all service/landmark/monument model generators (idempotent). */
export function registerServiceModels(): void {
  if (registered) return;
  registered = true;
  for (const key of Object.keys(SERVICE_MODELS)) registerModel(key, SERVICE_MODELS[key]);
}

/** Catalog model keys without a registered generator (should always be empty). */
export function missingServiceModels(): string[] {
  const out: string[] = [];
  for (const d of BUILDINGS) if (!SERVICE_MODELS[d.model] && !out.includes(d.model)) out.push(d.model);
  return out;
}
