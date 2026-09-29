// RTS orbit camera: keyboard / mouse / touch / edge-scroll control with
// critically damped smoothing, zoom-toward-cursor, cinematic auto-flattening
// at street level, terrain collision, fly-to animations, follow and shake.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { CELL } from '../core/constants';
import type { Gesture, PointerInfo } from '../input/InputManager';

export const MIN_DISTANCE = 20;
export const MAX_DISTANCE = 7000;
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.5;
const CLEARANCE = 4;
const DEFAULT_YAW = Math.PI * 0.25;
const DEFAULT_PITCH = 0.66;
const DEFAULT_DISTANCE = 440;

interface Flight {
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
  d0: number;
  d1: number;
  hop: number;
  t: number;
  dur: number;
}

interface Shake {
  intensity: number;
  duration: number;
  t: number;
  seed: number;
}

/** implicit critically damped spring step: returns [x, v] */
function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * target) * inv, (v + hoo * (target - x)) * inv];
}

function smoothstep(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class CameraController {
  /** focus point in CELL coordinates (fractional) */
  focus = new THREE.Vector2(128, 128);
  /** distance from focus (m) */
  distance = DEFAULT_DISTANCE;
  /** yaw radians around Y, pitch radians above horizon */
  yaw = DEFAULT_YAW;
  pitch = DEFAULT_PITCH;
  protected world: World | null = null;

  /** pitch actually used this frame (after street-level flattening + terrain clearance) */
  effectivePitch = DEFAULT_PITCH;
  /** smoothed ground height under the focus (m) */
  focusHeight = 0;
  /** camera height above the terrain below it (m) */
  altitude = 200;

  private tFocus = new THREE.Vector2(128, 128);
  private tDistance = DEFAULT_DISTANCE;
  private tYaw = DEFAULT_YAW;
  private tPitch = DEFAULT_PITCH;
  private vFx = 0;
  private vFy = 0;
  private vD = 0;
  private vYaw = 0;
  private vPitch = 0;
  private pitchFloor = 0;
  private flight: Flight | null = null;
  private followFn: (() => THREE.Vector3 | null) | null = null;
  /** height (m) of the followed target, NaN when not following */
  private followY = NaN;
  private shakes: Shake[] = [];
  private shakeOffset = new THREE.Vector3();
  private drag: 'rotate' | 'pan' | null = null;
  private dragButton = -1;
  private lastX = 0;
  private lastY = 0;
  private bound = false;
  private unsub: (() => void)[] = [];
  private time = 0;
  private hasInit = false;

  constructor(protected game: Game, readonly camera: THREE.PerspectiveCamera) {
    this.unsub.push(
      game.events.on('camera:flyTo', (e) => this.flyTo(e.x, e.y, e.distance, e.instant ?? false)),
    );
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    this.focus.set(world.home.x, world.home.y);
    this.tFocus.copy(this.focus);
    this.flight = null;
    this.followFn = null;
    this.shakes.length = 0;
    this.focusHeight = this.groundAt(this.focus.x * CELL, this.focus.y * CELL);
    this.hasInit = false;
  }

  /** stop following / flying (called when the world goes away) */
  onWorldUnloaded(): void {
    this.world = null;
    this.flight = null;
    this.followFn = null;
    this.drag = null;
  }

  private bindInput(): void {
    const input = this.game.input;
    if (!input || this.bound) return;
    this.bound = true;
    this.unsub.push(input.onPointer((p) => this.onPointer(p)));
    this.unsub.push(input.onGesture((g) => this.onGesture(g)));
  }

  private get controls() {
    return this.game.settings.value.controls;
  }

  private metersPerPixel(): number {
    const h = this.game.renderer?.canvas.clientHeight || window.innerHeight || 800;
    return (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  private cancelAutomation(): void {
    if (this.flight) {
      this.flight = null;
      this.tFocus.copy(this.focus);
      this.tDistance = this.distance;
    }
    this.followFn = null;
  }

  private onPointer(p: PointerInfo): void {
    if (!this.world) return;
    const c = this.controls;
    switch (p.type) {
      case 'down': {
        if (!p.onCanvas) return;
        // a tool may claim a button (e.g. right-drag erase): leave it alone
        const bit = p.button === 0 ? 1 : p.button === 1 ? 4 : p.button === 2 ? 2 : 0;
        if ((p.claimed ?? 0) & bit) return;
        if (p.button === 2 && !p.shift) this.drag = 'rotate';
        else if (p.button === 1 || (p.button === 2 && p.shift)) this.drag = 'pan';
        else return;
        this.dragButton = p.button;
        this.lastX = p.clientX;
        this.lastY = p.clientY;
        if (this.drag === 'pan') this.cancelAutomation();
        break;
      }
      case 'move': {
        if (!this.drag) return;
        if ((p.buttons & (this.dragButton === 2 ? 2 : 4)) === 0) {
          this.drag = null;
          return;
        }
        const dx = p.clientX - this.lastX, dy = p.clientY - this.lastY;
        this.lastX = p.clientX;
        this.lastY = p.clientY;
        if (this.drag === 'rotate') {
          this.tYaw -= dx * 0.0055 * c.rotateSpeed;
          this.tPitch += dy * 0.0045 * c.rotateSpeed * (c.invertY ? -1 : 1);
          this.tPitch = THREE.MathUtils.clamp(this.tPitch, MIN_PITCH, MAX_PITCH);
          if (this.flight) this.cancelAutomation();
        } else {
          this.panPixels(dx, dy);
        }
        break;
      }
      case 'up': {
        if (this.drag && p.button === this.dragButton) this.drag = null;
        break;
      }
      case 'leave':
        break;
      case 'wheel': {
        if (!p.onCanvas || !p.wheel) return;
        let w = p.wheel;
        if (Math.abs(w) > 8) w /= 100; // pixel deltas → notches
        w = THREE.MathUtils.clamp(w, -4, 4) * (c.invertZoom ? -1 : 1);
        this.zoomBy(Math.pow(1 + 0.16 * c.zoomSpeed, w), p.clientX, p.clientY);
        break;
      }
    }
  }

  private onGesture(g: Gesture): void {
    if (!this.world) return;
    if (g.panX || g.panY) this.panPixels(g.panX, g.panY);
    if (g.zoom && g.zoom !== 1) this.zoomBy(1 / g.zoom);
    if (g.rotate) this.tYaw += g.rotate;
    if (g.tilt) this.tPitch = THREE.MathUtils.clamp(this.tPitch + g.tilt, MIN_PITCH, MAX_PITCH);
  }

  /** grab-style pan: the ground under the pointer follows it */
  private panPixels(dx: number, dy: number): void {
    this.cancelAutomation();
    const mpp = this.metersPerPixel();
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    const k = 1 / Math.max(0.35, Math.sin(this.effectivePitch));
    // right = (cos, -sin), forward = (-sin, -cos): focus -= right·dx, += forward·dy
    const mx = -co * dx * mpp - s * dy * mpp * k;
    const mz = s * dx * mpp - co * dy * mpp * k;
    this.tFocus.x += mx / CELL;
    this.tFocus.y += mz / CELL;
  }

  /** multiply the distance, keeping the ground point under (cx, cy) fixed */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    if (this.flight) this.cancelAutomation();
    const d0 = this.tDistance;
    const d1 = THREE.MathUtils.clamp(d0 * factor, MIN_DISTANCE, MAX_DISTANCE);
    if (d1 === d0) return;
    this.tDistance = d1;
    if (clientX === undefined || clientY === undefined || this.followFn) return;
    const hit = this.game.renderer?.pick(clientX, clientY);
    if (!hit) return;
    const k = 1 - d1 / d0;
    this.tFocus.x += (hit.point.x / CELL - this.tFocus.x) * k;
    this.tFocus.y += (hit.point.z / CELL - this.tFocus.y) * k;
  }

  private groundAt(wx: number, wz: number): number {
    const w = this.world;
    if (!w) return 0;
    const S = w.size * CELL;
    const x = THREE.MathUtils.clamp(wx, 0, S), z = THREE.MathUtils.clamp(wz, 0, S);
    let h = w.heightAt(x, z);
    const cx = Math.min(w.size - 1, Math.floor(x / CELL)), cz = Math.min(w.size - 1, Math.floor(z / CELL));
    if (w.isWater(cx, cz)) h = Math.max(h, w.waterLevel(cx, cz));
    return h;
  }

  update(dt: number): void {
    this.bindInput();
    this.time += dt;
    const w = this.world;
    const c = this.controls;
    const input = this.game.input;
    const smooth = c.smoothCamera;
    dt = Math.min(dt, 0.1);

    // ── keyboard + edge scroll ────────────────────────────────────────────
    if (w && input && input.enabled !== false) {
      const fast = input.isDown('camera.fast') ? 3 : 1;
      let f = (input.isDown('camera.forward') ? 1 : 0) - (input.isDown('camera.back') ? 1 : 0);
      let r = (input.isDown('camera.right') ? 1 : 0) - (input.isDown('camera.left') ? 1 : 0);
      if (c.edgeScroll && input.pointer?.overCanvas) {
        const canvas = this.game.renderer?.canvas;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const m = 6;
          const px = input.pointer.x, py = input.pointer.y;
          if (px <= rect.left + m) r -= 1;
          else if (px >= rect.right - m) r += 1;
          if (py <= rect.top + m) f += 1;
          else if (py >= rect.bottom - m) f -= 1;
        }
      }
      if (f || r) {
        this.cancelAutomation();
        const speed = (this.tDistance * 0.85 + 45) * c.cameraSpeed * fast;
        const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
        const len = Math.hypot(f, r) || 1;
        this.tFocus.x += ((-s * f + co * r) / len) * speed * dt / CELL;
        this.tFocus.y += ((-co * f - s * r) / len) * speed * dt / CELL;
      }
      const rot = (input.isDown('camera.rotateLeft') ? 1 : 0) - (input.isDown('camera.rotateRight') ? 1 : 0);
      if (rot) this.tYaw += rot * 1.7 * c.rotateSpeed * dt;
      const tilt = (input.isDown('camera.tiltDown') ? 1 : 0) - (input.isDown('camera.tiltUp') ? 1 : 0);
      if (tilt) this.tPitch = THREE.MathUtils.clamp(this.tPitch + tilt * 0.9 * c.rotateSpeed * dt, MIN_PITCH, MAX_PITCH);
      const zoom = (input.isDown('camera.zoomOut') ? 1 : 0) - (input.isDown('camera.zoomIn') ? 1 : 0);
      if (zoom) this.zoomBy(Math.exp(zoom * 1.9 * c.zoomSpeed * dt));
    }

    // ── automation: flights and follow ────────────────────────────────────
    const fl = this.flight;
    if (fl) {
      fl.t = Math.min(1, fl.t + dt / fl.dur);
      const e = fl.t < 0.5 ? 4 * fl.t ** 3 : 1 - (-2 * fl.t + 2) ** 3 / 2;
      this.focus.set(fl.fx0 + (fl.fx1 - fl.fx0) * e, fl.fy0 + (fl.fy1 - fl.fy0) * e);
      this.distance = Math.exp(Math.log(fl.d0) + (Math.log(fl.d1) - Math.log(fl.d0)) * e) + fl.hop * Math.sin(Math.PI * e);
      this.tFocus.copy(this.focus);
      this.tDistance = fl.t >= 1 ? fl.d1 : this.distance;
      this.vFx = this.vFy = this.vD = 0;
      if (fl.t >= 1) this.flight = null;
    } else if (this.followFn) {
      const v = this.followFn();
      if (!v) {
        this.followFn = null;
        this.followY = NaN;
      } else {
        this.tFocus.set(v.x / CELL, v.z / CELL);
        this.followY = v.y;
      }
    }

    // ── clamp targets ─────────────────────────────────────────────────────
    const size = w ? w.size : 256;
    this.tFocus.x = THREE.MathUtils.clamp(this.tFocus.x, 0, size);
    this.tFocus.y = THREE.MathUtils.clamp(this.tFocus.y, 0, size);
    this.tDistance = THREE.MathUtils.clamp(this.tDistance, MIN_DISTANCE, MAX_DISTANCE);
    this.tPitch = THREE.MathUtils.clamp(this.tPitch, MIN_PITCH, MAX_PITCH);

    // ── smoothing ─────────────────────────────────────────────────────────
    if (!this.flight) {
      if (smooth && this.hasInit) {
        const om = 11;
        [this.focus.x, this.vFx] = spring(this.focus.x, this.vFx, this.tFocus.x, om, dt);
        [this.focus.y, this.vFy] = spring(this.focus.y, this.vFy, this.tFocus.y, om, dt);
        let ld: number;
        [ld, this.vD] = spring(Math.log(this.distance), this.vD, Math.log(this.tDistance), om, dt);
        this.distance = Math.exp(ld);
      } else {
        this.focus.copy(this.tFocus);
        this.distance = this.tDistance;
      }
    }
    if (smooth && this.hasInit) {
      [this.yaw, this.vYaw] = spring(this.yaw, this.vYaw, this.tYaw, 13, dt);
      [this.pitch, this.vPitch] = spring(this.pitch, this.vPitch, this.tPitch, 13, dt);
    } else {
      this.yaw = this.tYaw;
      this.pitch = this.tPitch;
    }

    // ── place the camera ──────────────────────────────────────────────────
    const fx = this.focus.x * CELL, fz = this.focus.y * CELL;
    // orbit around the followed target's own height (bridges, elevated rails)
    const g = this.followFn && Number.isFinite(this.followY) ? Math.max(this.groundAt(fx, fz), this.followY) : this.groundAt(fx, fz);
    this.focusHeight = this.hasInit ? this.focusHeight + (g - this.focusHeight) * Math.min(1, dt * 9) : g;
    const fy = this.focusHeight;
    const d = this.distance;
    // cinematic: flatten toward the horizon at street level
    const maxP = 0.26 + (MAX_PITCH - 0.26) * smoothstep(d, MIN_DISTANCE + 2, 300);
    let pitch = Math.min(this.pitch, maxP);
    // terrain clearance along the camera boom
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let need = pitch;
    if (w) {
      for (let iter = 0; iter < 3; iter++) {
        const cp = Math.cos(need), sp = Math.sin(need);
        let req = need;
        // the boom may not dip into terrain; the required clearance grows from
        // 0 at the focus (which sits on the ground) to CLEARANCE at the camera
        for (let i = 1; i <= 8; i++) {
          const t = Math.sqrt(i / 8);
          const px = fx + sy * cp * d * t, pz = fz + cy * cp * d * t;
          const ground = this.groundAt(px, pz) + CLEARANCE * t;
          const y = fy + sp * d * t;
          if (y < ground) {
            const ratio = THREE.MathUtils.clamp((ground - fy) / (d * t), -1, 1);
            req = Math.max(req, Math.asin(ratio) + 0.01);
          }
        }
        if (req <= need + 1e-4) break;
        need = Math.min(MAX_PITCH, req);
      }
    }
    // floor rises fast, relaxes slowly (no jitter over bumpy ground)
    const floor = need - pitch;
    this.pitchFloor = floor > this.pitchFloor ? floor : this.pitchFloor + (floor - this.pitchFloor) * Math.min(1, dt * 2.5);
    if (!this.hasInit) this.pitchFloor = floor;
    pitch = Math.min(MAX_PITCH, pitch + this.pitchFloor);
    this.effectivePitch = pitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cam = this.camera;
    cam.position.set(fx + sy * cp * d, fy + sp * d, fz + cy * cp * d);
    // never below the terrain directly under the camera
    const under = this.groundAt(cam.position.x, cam.position.z);
    if (cam.position.y < under + CLEARANCE) cam.position.y = under + CLEARANCE;
    this.altitude = cam.position.y - (w ? w.heightAt(THREE.MathUtils.clamp(cam.position.x, 0, size * CELL), THREE.MathUtils.clamp(cam.position.z, 0, size * CELL)) : 0);
    this.applyShake(dt);
    cam.position.add(this.shakeOffset);
    cam.lookAt(fx + this.shakeOffset.x * 0.3, fy + this.shakeOffset.y * 0.3, fz + this.shakeOffset.z * 0.3);
    cam.updateMatrixWorld();
    this.hasInit = true;
  }

  private applyShake(dt: number): void {
    this.shakeOffset.set(0, 0, 0);
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      if (s.t >= s.duration) {
        this.shakes.splice(i, 1);
        continue;
      }
      const k = (1 - s.t / s.duration) ** 2 * s.intensity * THREE.MathUtils.clamp(this.distance / 300, 0.35, 2.5);
      const t = s.t * 18 + s.seed;
      this.shakeOffset.x += k * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4);
      this.shakeOffset.y += k * (Math.sin(t * 1.7 + 2.1) * 0.5 + Math.sin(t * 3.1) * 0.3);
      this.shakeOffset.z += k * (Math.sin(t * 1.3 + 4.2) * 0.6 + Math.sin(t * 2.3 + 0.7) * 0.4);
    }
  }

  /** animate to a cell (x,y) at optional distance */
  flyTo(x: number, y: number, distance?: number, instant = false): void {
    this.followFn = null;
    const d1 = THREE.MathUtils.clamp(distance ?? this.tDistance, MIN_DISTANCE, MAX_DISTANCE);
    if (instant || !this.hasInit) {
      this.flight = null;
      this.focus.set(x, y);
      this.tFocus.set(x, y);
      this.distance = this.tDistance = d1;
      this.vFx = this.vFy = this.vD = 0;
      if (this.world) this.focusHeight = this.groundAt(x * CELL, y * CELL);
      return;
    }
    const travel = Math.hypot(x - this.focus.x, y - this.focus.y) * CELL;
    this.flight = {
      fx0: this.focus.x, fy0: this.focus.y, fx1: x, fy1: y,
      d0: this.distance, d1,
      hop: Math.min(2500, travel * 0.3),
      t: 0,
      dur: THREE.MathUtils.clamp(0.8 + Math.log2(1 + travel / 400) * 0.38, 0.8, 2.8),
    };
  }

  /** follow a moving target (return null to stop following) */
  follow(fn: (() => THREE.Vector3 | null) | null): void {
    this.flight = null;
    this.followFn = fn;
    this.followY = NaN;
  }

  /** true while a follow target is being tracked */
  get following(): boolean {
    return this.followFn !== null;
  }

  /** camera shake (earthquakes, explosions): intensity in meters, duration seconds */
  shake(intensity: number, duration: number): void {
    if (intensity <= 0 || duration <= 0) return;
    this.shakes.push({ intensity, duration, t: 0, seed: Math.random() * 100 });
    if (this.shakes.length > 8) this.shakes.shift();
  }

  reset(): void {
    if (!this.world) return;
    this.tYaw = this.yaw + Math.atan2(Math.sin(DEFAULT_YAW - this.yaw), Math.cos(DEFAULT_YAW - this.yaw));
    this.tPitch = DEFAULT_PITCH;
    this.flyTo(this.world.home.x, this.world.home.y, DEFAULT_DISTANCE);
  }

  /** set the orbit instantly (sandbox, photo mode, saves) */
  setPose(x: number, y: number, distance: number, yaw: number, pitch: number): void {
    this.flyTo(x, y, distance, true);
    this.yaw = this.tYaw = yaw;
    this.pitch = this.tPitch = THREE.MathUtils.clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.vYaw = this.vPitch = 0;
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.bound = false;
  }
}
