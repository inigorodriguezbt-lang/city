// Small glue between Kit-based model functions and the frozen ModelFn contract.
import type { ModelFn } from '../types';
import { Kit } from './kit';

/** A service model written against the Kit; returns the model's top height (m). */
export type KitModel = (k: Kit) => number;

/** Wrap a Kit model into a registry ModelFn. */
export function model(fn: KitModel): ModelFn {
  return (ctx) => {
    const k = new Kit(ctx);
    const h = fn(k);
    return k.finish(Math.max(1, h));
  };
}

/** Build a model table from Kit models. */
export function models(table: Record<string, KitModel>): Record<string, ModelFn> {
  const out: Record<string, ModelFn> = {};
  for (const key of Object.keys(table)) out[key] = model(table[key]);
  return out;
}
