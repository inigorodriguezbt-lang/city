// STUB — owned by the "buildings-zoned" agent. Public API is FROZEN (add, don't change).
// Shared material library for every procedural model (buildings, props, roads may reuse).
import * as THREE from 'three';
import type { MatKey } from './types';

const cache = new Map<MatKey, THREE.Material>();

/** Get the shared material for a key (vertex colors enabled). */
export function getMaterial(key: MatKey): THREE.Material {
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    cache.set(key, m);
  }
  return m;
}

/** Called every frame by BuildingRenderer: night 0..1 drives lit windows/emissives. */
export function updateMaterials(_night: number, _timeSec: number): void {}

/** Translucent ghost material for placement previews (valid = green/blue, invalid = red). */
export function ghostMaterial(valid: boolean): THREE.Material {
  return new THREE.MeshBasicMaterial({ color: valid ? 0x66ccff : 0xff4444, transparent: true, opacity: 0.45, depthWrite: false });
}
