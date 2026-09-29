// STUB — owned by the "render-core" agent. Public API is FROZEN (add, don't change).
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { CELL } from '../core/constants';

export class CameraController {
  /** focus point in CELL coordinates (fractional) */
  focus = new THREE.Vector2(128, 128);
  /** distance from focus (m) */
  distance = 600;
  /** yaw radians around Y, pitch radians above horizon */
  yaw = Math.PI * 0.25;
  pitch = 0.9;
  protected world: World | null = null;

  constructor(protected game: Game, readonly camera: THREE.PerspectiveCamera) {}
  onWorldLoaded(world: World): void {
    this.world = world;
    this.focus.set(world.home.x, world.home.y);
  }
  update(_dt: number): void {
    const fx = this.focus.x * CELL, fz = this.focus.y * CELL;
    const fy = this.world ? this.world.heightAt(fx, fz) : 0;
    const d = this.distance;
    this.camera.position.set(fx + Math.sin(this.yaw) * Math.cos(this.pitch) * d, fy + Math.sin(this.pitch) * d, fz + Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    this.camera.lookAt(fx, fy, fz);
  }
  /** animate to a cell (x,y) at optional distance */
  flyTo(x: number, y: number, distance?: number, instant = false): void {
    this.focus.set(x, y);
    if (distance) this.distance = distance;
    void instant;
  }
  /** follow a moving target (return null to stop following) */
  follow(_fn: (() => THREE.Vector3 | null) | null): void {}
  /** camera shake (earthquakes, explosions): intensity in meters, duration seconds */
  shake(_intensity: number, _duration: number): void {}
  reset(): void { if (this.world) this.flyTo(this.world.home.x, this.world.home.y, 600); }
}
