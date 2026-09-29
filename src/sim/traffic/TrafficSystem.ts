// STUB — owned by the "traffic" agent. Public API is FROZEN (add, don't change).
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { Cell, TransitLine, TransitMode, VehicleType } from '../../core/types';

export interface VehicleInfo {
  id: number;
  type: VehicleType;
  x: number; // world meters
  y: number;
  z: number;
  heading: number; // radians, 0 = +Z
  speed: number; // m/s
  label: string;
  fromBuilding?: number;
  toBuilding?: number;
}

export class TrafficSystem {
  protected world: World | null = null;
  constructor(protected game: Game) {}
  onWorldLoaded(world: World): void { this.world = world; }
  onWorldUnloaded(): void { this.world = null; }
  update(_dt: number): void {}

  get vehicleCount(): number { return 0; }
  /** send a service vehicle from a building toward a target cell (visual + effect) */
  dispatch(_type: VehicleType, _fromBuildingId: number, _to: Cell): boolean { return false; }
  spawnVehicle(_type: VehicleType, _from: Cell, _to: Cell): number | null { return null; }
  vehicleInfo(_id: number): VehicleInfo | null { return null; }
  nearestVehicle(_wx: number, _wz: number, _maxDist: number): number | null { return null; }
  /** 0..1 congestion on a road cell */
  congestionAt(_x: number, _y: number): number { return 0; }

  // transit lines
  createLine(_mode: TransitMode, _stops: Cell[]): TransitLine | null { return null; }
  updateLine(_id: number, _patch: Partial<Pick<TransitLine, 'name' | 'color' | 'vehicles' | 'active' | 'stops'>>): void {}
  removeLine(_id: number): void {}
}
