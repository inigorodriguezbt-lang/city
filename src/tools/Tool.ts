// Tool contract (FROZEN). Tools are registered with ToolManager by id.
import type * as THREE from 'three';
import type { Cell } from '../core/types';
import type { ActionId } from '../settings/types';

export interface ToolPointerEvent {
  /** cell under pointer (null if off-map / sky) */
  cell: Cell | null;
  /** world hit point */
  point: THREE.Vector3 | null;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  clientX: number;
  clientY: number;
}

export interface Tool {
  /** unique id, e.g. 'road', 'zone', 'bulldoze', 'place', 'transit' */
  readonly id: string;
  /** called when selected; opts are tool-specific (e.g. { type }, { defId }, { zone }) */
  activate(opts?: unknown): void;
  deactivate(): void;
  onPointerDown?(e: ToolPointerEvent): void;
  onPointerMove?(e: ToolPointerEvent): void;
  onPointerUp?(e: ToolPointerEvent): void;
  /** keyboard action while active; return true if consumed */
  onAction?(action: ActionId): boolean;
  update?(dt: number): void;
  /** short status text for the tool hint bar (cost, size, errors) */
  hint?(): string;
}
