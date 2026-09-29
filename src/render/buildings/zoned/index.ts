// Zoned building generators — entry point.
// buildZoned(ctx) dispatches on the zone type and returns a ZModel (parts with
// facade codes, lights, emitters, animated parts and LOD masses).
import { ZoneType } from '../../../core/types';
import type { ModelContext, ModelResult } from '../types';
import { Fab, type ZModel } from './fab';
import { resHigh, resLow, resMed } from './residential';
import { comHigh, comLow, mixedUse } from './commercial';
import { office } from './office';
import { industry } from './industrial';
import { farming, forestry, mining, oil } from './rural';

export type { ZModel } from './fab';

export function buildZoned(ctx: ModelContext): ZModel {
  const f = new Fab(ctx);
  switch (ctx.zone) {
    case ZoneType.ResLow: resLow(f); break;
    case ZoneType.ResMed: resMed(f); break;
    case ZoneType.ResHigh: resHigh(f); break;
    case ZoneType.ComLow: comLow(f); break;
    case ZoneType.ComHigh: comHigh(f); break;
    case ZoneType.Office: office(f); break;
    case ZoneType.Industry: industry(f); break;
    case ZoneType.Farming: farming(f); break;
    case ZoneType.Forestry: forestry(f); break;
    case ZoneType.Mining: mining(f); break;
    case ZoneType.Oil: oil(f); break;
    case ZoneType.MixedUse: mixedUse(f); break;
    default: resLow(f); break;
  }
  return f.finish(3);
}

/** ModelFn-compatible wrapper (for registries / previews). */
export function zonedModel(ctx: ModelContext): ModelResult {
  return buildZoned(ctx);
}

import { Sched } from './constants';

/** Lit-window occupancy schedule for a zone. */
export function schedFor(zone: ZoneType): Sched {
  switch (zone) {
    case ZoneType.ResLow: case ZoneType.ResMed: case ZoneType.ResHigh: case ZoneType.MixedUse: return Sched.Residential;
    case ZoneType.ComLow: case ZoneType.ComHigh: return Sched.Commercial;
    case ZoneType.Office: return Sched.Office;
    case ZoneType.Industry: case ZoneType.Farming: case ZoneType.Forestry: case ZoneType.Mining: case ZoneType.Oil: return Sched.Industrial;
    default: return Sched.Generic;
  }
}
