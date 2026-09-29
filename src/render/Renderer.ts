// STUB — owned by the "render-core" agent. Public API is FROZEN (add, don't change).
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Cell, FieldId } from '../core/types';
import type { Settings } from '../settings/types';
import { CameraController } from './CameraController';

export interface PickResult {
  cell: Cell;
  /** world-space hit point on terrain (or water surface) */
  point: THREE.Vector3;
  onWater: boolean;
}

export interface ViewInfo {
  /** camera focus in cell coords */
  focusX: number;
  focusY: number;
  /** render radius in cells (from settings.graphics.renderDistance) */
  radiusCells: number;
  cameraPos: THREE.Vector3;
  /** camera height above ground (m) — used for LOD */
  altitude: number;
  frustum: THREE.Frustum;
}

export interface LightingInfo {
  /** normalized direction TOWARD the sun */
  sunDir: THREE.Vector3;
  /** 0 = full night, 1 = full day */
  daylight: number;
  /** 0 = day, 1 = night (drives window/street lights) */
  night: number;
  sunColor: THREE.Color;
  ambientColor: THREE.Color;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraCtl: CameraController;
  readonly canvas: HTMLCanvasElement;
  readonly lighting: LightingInfo = {
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(), daylight: 1, night: 0,
    sunColor: new THREE.Color(1, 1, 1), ambientColor: new THREE.Color(0.5, 0.55, 0.6),
  };
  stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  overlay: FieldId | null = null;
  protected world: World | null = null;

  constructor(protected game: Game, container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
    this.cameraCtl = new CameraController(game, this.camera);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x445533, 1.2));
    const onResize = () => {
      const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  async init(): Promise<void> {}
  onWorldLoaded(world: World): void { this.world = world; this.cameraCtl.onWorldLoaded(world); }
  onWorldUnloaded(): void { this.world = null; }
  update(dt: number): void { this.cameraCtl.update(dt); }
  render(): void { this.renderer.render(this.scene, this.camera); }

  pick(_clientX: number, _clientY: number): PickResult | null { return null; }
  screenToRay(clientX: number, clientY: number): THREE.Ray {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray.clone();
  }
  worldToScreen(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: p.z < 1 && p.z > -1 };
  }
  getViewInfo(): ViewInfo {
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    return { focusX: this.cameraCtl.focus.x, focusY: this.cameraCtl.focus.y, radiusCells: 320, cameraPos: this.camera.position, altitude: 200, frustum: f };
  }
  setOverlay(field: FieldId | null): void { this.overlay = field; this.game.events.emit('overlay:changed', field); }
  applySettings(_s: Settings): void {}
  /** capture the current frame as a data URL (optionally resized) */
  async screenshot(_width?: number, _height?: number): Promise<string> { return this.canvas.toDataURL('image/jpeg', 0.85); }
}
