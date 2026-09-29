// Weather visuals owned by the events module: rain and snow particle layers,
// ground splashes, lightning bolts with a sky flash and distance-delayed
// thunder. The sky, clouds, fog density, wet roads and snow cover are drawn by
// render-core from the same `world.weather` state.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import { clamp01, smoothstep } from '../../core/util';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import type { FxUniforms } from '../effects/fxShared';
import { Clock, Mode, Shape, particleInit, type ParticleSystem } from '../effects/particles';
import { Lightning } from './lightning';
import { PrecipitationLayer } from './precipitation';

const RAIN_MAX = 16000;
const SNOW_MAX = 14000;
const SPEED_OF_SOUND = 343;

const FLASH_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = position.y * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.5, 1.0);
}
`;
const FLASH_FRAG = /* glsl */ `
uniform float uFlash;
varying float vY;
void main() {
  gl_FragColor = vec4(vec3(0.62, 0.68, 0.9) * uFlash * (0.25 + 0.75 * vY * vY), 1.0);
}
`;

interface PendingThunder {
  at: number;
  volume: number;
  x: number;
  y: number;
}

export interface ViewState {
  /** camera focus (world m) */
  focus: THREE.Vector3;
  /** camera to focus distance (m) */
  distance: number;
  camera: THREE.Camera;
  /** projection scale: pixels per metre at 1 m depth */
  pixelScale: number;
}

export class WeatherRenderer {
  readonly group = new THREE.Group();
  readonly lightning = new Lightning();
  private readonly rain = new PrecipitationLayer(RAIN_MAX, false);
  private readonly snow = new PrecipitationLayer(SNOW_MAX, true);
  private readonly hemi: THREE.HemisphereLight;
  private readonly flashMesh: THREE.Mesh;
  private readonly flashMat: THREE.ShaderMaterial;
  private readonly P = particleInit();
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly top = new THREE.Vector3();
  private readonly bottom = new THREE.Vector3();
  private thunder: PendingThunder[] = [];
  private time = 0;
  private precipTime = 0;
  private nextBolt = 3;
  private splashAcc = 0;
  /** smoothed amounts */
  private rainK = 0;
  private snowK = 0;
  private stormK = 0;

  constructor(private readonly game: Game, private readonly fx: FxUniforms, private readonly sys: ParticleSystem) {
    this.group.name = 'weather';
    this.group.add(this.rain.mesh, this.snow.mesh, this.lightning.mesh);
    // lightning fill light: always present (so no shader recompiles), dark until a flash
    this.hemi = new THREE.HemisphereLight(0xc8d4ff, 0x30343c, 0);
    this.hemi.name = 'weather.flashLight';
    this.group.add(this.hemi);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.flashMat = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 } }, vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flashMesh = new THREE.Mesh(fg, this.flashMat);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.renderOrder = 1000;
    this.flashMesh.visible = false;
    this.group.add(this.flashMesh);
  }

  /** a gameplay lightning strike at a world point (tall building, tree…) */
  strike(x: number, y: number, z: number): void {
    const top = this.top.set(x + (Math.random() - 0.5) * 300, y + 850 + Math.random() * 300, z + (Math.random() - 0.5) * 300);
    this.lightning.strike(top, this.bottom.set(x, y, z), 1);
    this.queueThunder(x, y, z, 1.25);
    this.sparkAt(x, y, z);
  }

  update(dt: number, world: World | null, view: ViewState): void {
    this.time += dt;
    const enabled = this.game.settings.value.graphics.weatherEffects;
    const w = world?.weather;
    const type = w?.type ?? 'clear';
    const intensity = w ? clamp01(w.intensity) : 0;
    const temp = w?.temperature ?? 15;
    // precipitation amounts (sleet near 0 °C shows a bit of both)
    const rainT = type === 'rain' ? 0.25 + 0.75 * intensity : type === 'storm' ? 0.55 + 0.45 * intensity : 0;
    const snowT = type === 'snow' ? 0.2 + 0.7 * intensity : type === 'blizzard' ? 0.8 + 0.2 * intensity : 0;
    const coldRain = rainT * smoothstep(1.5, -0.5, temp);
    const k = Math.min(1, dt * 0.6);
    this.rainK += (rainT - coldRain - this.rainK) * k;
    this.snowK += (snowT + coldRain - this.snowK) * k;
    this.stormK += ((type === 'storm' ? 0.4 + 0.6 * intensity : 0) - this.stormK) * Math.min(1, dt * 0.5);

    // view box: scale with distance so panoramas still read as rain
    const D = Math.max(20, view.distance);
    const box = Math.min(1500, Math.max(34, D * 0.9));
    const scale = box / 70;
    const cam = view.camera.position;
    view.camera.getWorldDirection(this.fwd);
    this.origin.copy(cam).addScaledVector(this.fwd, box * 0.5).subScalar(box * 0.5);
    this.precipTime = (this.precipTime + dt) % 240;
    const wind = w ? w.windSpeed : 4;
    const wd = this.game.renderer.shared.uWindDir.value as THREE.Vector2;
    const lit = this.fx.uAmbient.value;
    const sun = this.fx.uSunColor.value;
    const night = this.fx.uNight.value;
    if (enabled && this.rainK > 0.004) {
      const fall = 10 * scale;
      this.vel.set(wd.x * wind * 0.55 * scale, -fall, wd.y * wind * 0.55 * scale);
      this.color.copy(lit).multiplyScalar(0.9).add(this.c2.copy(sun).multiplyScalar(0.04)).add(this.c2.setRGB(0.03, 0.035, 0.04).multiplyScalar(1 + night * 2));
      this.rain.set({
        density: Math.min(1, this.rainK * 1.1), origin: this.origin, box, vel: this.vel, len: 1.5 * scale, width: 0.018 * scale,
        alpha: 0.3 + 0.25 * this.rainK, color: this.color, flutter: 0, pixelScale: view.pixelScale, time: this.precipTime,
      });
    } else this.rain.mesh.visible = false;
    if (enabled && this.snowK > 0.004) {
      const bliz = type === 'blizzard' ? 1 : 0;
      const fall = (1.3 + bliz * 1.2) * scale;
      const drift = (0.35 + 0.5 * bliz) * scale;
      this.vel.set(wd.x * wind * drift, -fall, wd.y * wind * drift);
      this.color.copy(lit).multiplyScalar(1.35).add(this.c2.copy(sun).multiplyScalar(0.22)).add(this.c2.setRGB(0.05, 0.05, 0.06));
      this.snow.set({
        density: Math.min(1, this.snowK), origin: this.origin, box, vel: this.vel, len: bliz ? 0.9 * scale : 0, width: (bliz ? 0.1 : 0.15) * scale,
        alpha: 0.7 + 0.3 * this.snowK, color: this.color, flutter: 0.5 * scale, pixelScale: view.pixelScale, time: this.precipTime,
      });
    } else this.snow.mesh.visible = false;

    // splashes on the ground around the focus when close enough to see them
    if (enabled && world && this.rainK > 0.05 && D < 520) {
      this.splashAcc += dt * this.rainK * 260 * (1 - D / 520);
      const r = Math.min(box * 0.45, 160);
      while (this.splashAcc >= 1) {
        this.splashAcc -= 1;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        const x = view.focus.x + Math.cos(a) * d, z = view.focus.z + Math.sin(a) * d;
        const y = this.game.renderer.groundHeight(x, z);
        const wl = world.waterLevel(Math.floor(x / CELL), Math.floor(z / CELL));
        this.splash(x, Math.max(y, wl) + 0.05, z, Math.max(0.5, scale * 0.35));
      }
    }

    // storm lightning (ambient bolts around the view)
    if (enabled && this.stormK > 0.2 && world) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.ambientBolt(view, world);
        const mean = 9 - 6.5 * this.stormK;
        this.nextBolt = -Math.log(1 - Math.random() * 0.999) * mean + 0.4;
      }
    }
    this.lightning.update(dt, view.pixelScale);
    if (!enabled && this.lightning.active) this.lightning.clear();

    // flash → light, overlay, cloud/funnel uniform
    const f = Math.min(1.5, this.lightning.flash);
    this.hemi.intensity = f * (0.5 + 0.9 * night);
    this.flashMat.uniforms.uFlash.value = f * (0.04 + 0.09 * night);
    this.flashMesh.visible = f > 0.01;
    this.fx.uFlash.value = f;

    // thunder claps arrive later than the flash
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      const th = this.thunder[i];
      if (this.time >= th.at) {
        this.thunder.splice(i, 1);
        this.playThunder(th);
      }
    }
  }

  clear(): void {
    this.lightning.clear();
    this.thunder.length = 0;
    this.rainK = this.snowK = this.stormK = 0;
    this.rain.mesh.visible = this.snow.mesh.visible = false;
    this.hemi.intensity = 0;
    this.flashMesh.visible = false;
    this.fx.uFlash.value = 0;
  }

  dispose(): void {
    this.rain.dispose();
    this.snow.dispose();
    this.lightning.dispose();
    this.flashMesh.geometry.dispose();
    this.flashMat.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────
  private ambientBolt(view: ViewState, world: World): void {
    const D = Math.max(300, view.distance);
    // mostly in front of the camera so it is seen
    this.v.copy(this.fwd).setY(0);
    if (this.v.lengthSq() < 1e-4) this.v.set(1, 0, 0);
    this.v.normalize();
    const ang = Math.atan2(this.v.z, this.v.x) + (Math.random() - 0.5) * 2.2;
    const dist = D * (0.3 + Math.random() * 1.6);
    const x = view.focus.x + Math.cos(ang) * dist, z = view.focus.z + Math.sin(ang) * dist;
    const g = this.game.renderer.groundHeight(x, z);
    const cloudY = g + 750 + Math.random() * 450;
    const weight = Math.max(0.15, Math.min(1, 1.3 - dist / (D * 2.2)));
    if (Math.random() < 0.28) {
      // cloud-to-cloud: a long, mostly horizontal discharge
      const a2 = Math.random() * Math.PI * 2, l = 500 + Math.random() * 900;
      this.top.set(x, cloudY + Math.random() * 120, z);
      this.bottom.set(x + Math.cos(a2) * l, cloudY - 60 - Math.random() * 180, z + Math.sin(a2) * l);
      this.lightning.strike(this.top, this.bottom, weight * 0.7, true);
    } else {
      this.top.set(x + (Math.random() - 0.5) * 200, cloudY, z + (Math.random() - 0.5) * 200);
      const wl = world.waterLevel(Math.floor(x / CELL), Math.floor(z / CELL));
      this.bottom.set(x, Math.max(g, wl), z);
      this.lightning.strike(this.top, this.bottom, weight);
      if (dist < 700) this.sparkAt(x, Math.max(g, wl), z);
    }
    this.queueThunder(x, cloudY * 0.3 + g * 0.7, z, weight);
  }

  private queueThunder(x: number, y: number, z: number, weight: number): void {
    const cam = this.game.renderer.camera.position;
    const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    const delay = Math.min(6.5, d / SPEED_OF_SOUND);
    const volume = Math.max(0.2, Math.min(1.1, (1.25 - d / 4000) * (0.6 + 0.4 * weight)));
    if (this.thunder.length < 6) this.thunder.push({ at: this.time + delay, volume, x: x / CELL, y: z / CELL });
  }

  private playThunder(th: PendingThunder): void {
    const audio = this.game.audio;
    try {
      if (typeof audio.playAt === 'function') audio.playAt('thunder', th.x, th.y, th.volume, 0.35);
      else audio.play('thunder', th.volume);
    } catch {
      /* audio not ready */
    }
  }

  private splash(x: number, y: number, z: number, s: number): void {
    const P = this.P, sys = this.sys;
    P.clock = Clock.Real;
    P.x = x; P.y = y; P.z = z;
    P.vx = P.vy = P.vz = 0;
    P.life = 0.35; P.s0 = 0.15 * s; P.s1 = 1.6 * s; P.drag = 0; P.wind = 0; P.buoy = 0; P.turb = 0;
    P.c0 = 0xdfe9f2; P.c1 = 0xeef4fa; P.alpha = 0.32; P.shape = Shape.Ring; P.mode = Mode.Lit; P.additive = false; P.glow = 0; P.age = 0;
    sys.emit(P);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 1.2;
      P.vx = Math.cos(a) * sp * Math.sqrt(s); P.vz = Math.sin(a) * sp * Math.sqrt(s); P.vy = (1.8 + Math.random() * 1.5) * Math.sqrt(s);
      P.life = 0.3 + Math.random() * 0.15; P.s0 = 0.06 * s; P.s1 = 0.05 * s; P.buoy = -9.8; P.drag = 0.2;
      P.shape = Shape.Streak; P.alpha = 0.5;
      sys.emit(P);
    }
  }

  private sparkAt(x: number, y: number, z: number): void {
    const P = this.P, sys = this.sys;
    P.clock = Clock.Real;
    P.x = x; P.y = y + 1; P.z = z;
    P.vx = P.vy = P.vz = 0;
    P.life = 0.5; P.s0 = 40; P.s1 = 60; P.drag = 0; P.wind = 0; P.buoy = 0; P.turb = 0;
    P.c0 = 0xdfe6ff; P.c1 = 0x8fa0ff; P.alpha = 0.8; P.shape = Shape.Soft; P.mode = Mode.Unlit; P.additive = true; P.glow = 5; P.age = 0;
    sys.emit(P);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, v = 8 + Math.random() * 18;
      P.vx = Math.cos(a) * Math.cos(e) * v; P.vz = Math.sin(a) * Math.cos(e) * v; P.vy = Math.sin(e) * v;
      P.life = 0.5 + Math.random() * 0.7; P.s0 = 0.35; P.s1 = 0.2; P.drag = 0.8; P.buoy = -9.8;
      P.c0 = 0xffffff; P.c1 = 0xffb060; P.alpha = 1; P.shape = Shape.Streak; P.glow = 7;
      sys.emit(P);
    }
  }
}
