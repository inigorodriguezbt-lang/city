// Model registry: service/landmark generators register by BuildingDef.model key.
import type { ModelFn } from './types';

const registry = new Map<string, ModelFn>();

export function registerModel(key: string, fn: ModelFn): void {
  registry.set(key, fn);
}
export function getModel(key: string): ModelFn | undefined {
  return registry.get(key);
}
export function modelKeys(): string[] {
  return [...registry.keys()];
}
