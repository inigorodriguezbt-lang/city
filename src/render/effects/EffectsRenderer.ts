// EffectsRenderer — owned by the "events" agent.
//
// GPU particle effects (fire, smoke, steam, explosions, dust, fountains,
// fireworks, sparks, splashes), persistent emitters registered by other
// renderers (chimney smoke, cooling-tower steam, fountains), one-shot bursts,
// fire visuals on burning buildings and forests, disaster/event meshes
// (tornado, meteor, UFO, balloons, tsunami) and the weather visuals (rain,
// snow, splashes, lightning).
//
// Performance: one draw call for all particles (stateless GPU ring buffer,
// ~20k particles); emitters live in a chunk hash and only those near the
// camera and inside the view frustum emit; far emitters emit fewer, larger
// particles; a global budget scales every emitter down when the ring gets
// saturated. Gameplay effects run on game.simDt (frozen when paused, capped
// at 2× so 10× speed does not look frantic); ambience runs on real time.
import * as THREE from 'three';
import { CELL, CHUNK } from '../../core/constants';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { EventVisuals } from './eventVisuals';
import { FireVisuals } from './fireVisuals';
import { Fireworks } from './fireworks';
import { createFxUniforms, createNoiseTexture, type FxUniforms } from './fxShared';
import { Clock, ParticleSystem, createParticleAtlas } from './particles';
import { burst as burstRecipe, defaultClock, emitContinuous, type EffectKind, type EmitParams, type EmitterState } from './recipes';
import { WeatherRenderer, type ViewState } from '../weather/WeatherRenderer';

export type { EffectKind } from './recipes';
export { Clock } from './particles';

/** optional emitter settings (additive API) */
export interface EmitterOptions {
  /** size multiplier (default 1) */
  scale?: number;
  /** spawn area radius in metres (default depends on kind) */
  radius?: number;
  /** which clock the particles live on (default: sim for gameplay kinds, real for ambience) */
  clock?: Clock;
  /** tint for smoke / steam / dust (0xRRGGBB) */
  color?: number;
}

const CAPACITY = 20000;
const BUCKET = CHUNK * CELL; // 512 m spatial hash cells
const MAX_SIM_RATE = 2;

export class EffectsRenderer {
  protected world: World | null = null;
  /** everything this renderer draws */
  readonly group = new THREE.Group();
  readonly particles: ParticleSystem;
  readonly fireworks: Fireworks;
  readonly fx: FxUniforms;
  readonly weather: WeatherRenderer;
  /** 0.15..1 global emission scale from the particle budget */
  budget = 1;
  private readonly atlas: THREE.Texture;
  private readonly ownNoise: THREE.Texture | null;
  private readonly emitters = new Map<number, EmitterState>();
  private readonly grid = new Map<number, Set<EmitterState>>();
  private nextId = 1;
  private readonly visuals: EventVisuals;
  private readonly fires: FireVisuals;
  private readonly unsub: (() => void)[] = [];
  private readonly params: EmitParams;
  private readonly view: ViewState;
  private readonly sphere = new THREE.Sphere();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector2();
  private readonly wind = new THREE.Vector3();
  private dtSim = 0;
  private dtReal = 0;
  private thunderSfx: { at: number; x: number; y: number; vol: number }[] = [];
  private clockReal = 0;

  constructor(protected game: Game) {
    this.group.name = 'effects';
    this.atlas = createParticleAtlas();
    const shared = game.renderer.shared;
    this.ownNoise = shared?.uNoise?.value ? null : createNoiseTexture();
    this.fx = createFxUniforms(null);
    // share render-core's live noise uniform when available (it is filled during init)
    if (shared?.uNoise) (this.fx as Record<string, THREE.IUniform>).uNoise = this.ownNoise ? { value: this.ownNoise } : shared.uNoise;
    if (shared?.uSunDir) this.fx.uSunDir = shared.uSunDir;
    if (shared?.uSunColor) this.fx.uSunColor = shared.uSunColor as { value: THREE.Color };
    this.particles = new ParticleSystem(CAPACITY, this.atlas);
    this.group.add(this.particles.mesh);
    this.fireworks = new Fireworks(this.particles, { onBurst: (x, y, z, s) => this.fireworkSound(x, y, z, s) });
    this.params = {
      sys: this.particles,
      lod: 1,
      lodSize: 1,
      launchShell: (x, y, z, s, c) => this.fireworks.launch(x, y, z, s, c),
    };
    this.view = { focus: new THREE.Vector3(), distance: 500, camera: game.renderer.camera, pixelScale: 800 };
    this.weather = new WeatherRenderer(game, this.fx, this.particles);
    this.group.add(this.weather.group);
    this.visuals = new EventVisuals(this);
    this.fires = new FireVisuals(this, game);
    game.renderer.scene.add(this.group);
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    const ev = this.game.events;
    this.unsub.push(
      ev.on('building:changed', (b) => this.fires.onChanged(b)),
      ev.on('building:added', (b) => this.fires.onChanged(b)),
      ev.on('building:removed', (b) => this.fires.onRemoved(b)),
    );
    this.fires.attach(world);
  }

  onWorldUnloaded(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.visuals.clear();
    this.fires.clear();
    this.fireworks.clear();
    this.weather.clear();
    for (const e of this.emitters.values()) this.unbucket(e);
    this.emitters.clear();
    this.particles.clear();
    this.thunderSfx.length = 0;
    this.world = null;
  }

  update(dt: number): void {
    const game = this.game;
    const dtReal = Math.max(0, dt);
    const dtSim = Math.min(Math.max(0, game.simDt), dtReal * MAX_SIM_RATE);
    this.dtSim = dtSim;
    this.dtReal = dtReal;
    this.clockReal += dtReal;
    this.refreshUniforms(dtSim, dtReal);
    const w = this.world;

    // global budget: back off when the ring buffer is close to saturation
    const occ = this.particles.occupancy;
    const target = Math.max(0.15, Math.min(1, 0.85 / Math.max(1e-3, occ))) * this.presetBudget();
    this.budget += (target - this.budget) * Math.min(1, dtReal * 2);

    if (w) {
      this.fires.update(w, dtSim);
      this.visuals.update(w, dtSim, dtReal);
    }
    this.emitNearby();
    this.fireworks.update(dtSim, dtReal);
    this.weather.update(dtReal, w, this.view);
    this.flushSounds();
    this.particles.update(dtSim, dtReal);
  }

  // ── public API (frozen) ───────────────────────────────────────────────
  /** persistent emitter at a world position; returns id */
  addEmitter(kind: EffectKind, pos: THREE.Vector3Like, rate = 1, opts: EmitterOptions = {}): number {
    const id = this.nextId++;
    const e: EmitterState = {
      id, kind, x: pos.x, y: pos.y, z: pos.z, rate: Math.max(0, rate), scale: opts.scale ?? 1,
      radius: opts.radius ?? defaultRadius(kind), clock: opts.clock ?? defaultClock(kind), color: opts.color ?? 0,
      acc: [Math.random(), Math.random(), Math.random(), Math.random()], key: 0, live: false,
    };
    this.emitters.set(id, e);
    this.bucket(e);
    return id;
  }

  removeEmitter(id: number): void {
    const e = this.emitters.get(id);
    if (!e) return;
    this.unbucket(e);
    this.emitters.delete(id);
  }

  /** one-shot burst */
  burst(kind: EffectKind, pos: THREE.Vector3Like, scale = 1): void {
    const d = this.tmp.set(pos.x, pos.y, pos.z).distanceTo(this.game.renderer.camera.position);
    const p = this.params;
    p.lod = Math.max(0.25, Math.min(1, 700 / Math.max(1, d))) * Math.max(0.4, this.budget);
    p.lodSize = 1;
    // water ambience runs on real time; smoke, fire and blasts are gameplay (sim clock)
    const clock = kind === 'steam' || kind === 'fountain' || kind === 'splash' ? Clock.Real : Clock.Sim;
    burstRecipe(p, kind, pos.x, pos.y, pos.z, scale, clock);
    if (kind === 'explosion') this.explosionSound(pos, scale);
  }

  // ── additive API ──────────────────────────────────────────────────────
  setEmitterRate(id: number, rate: number): void {
    const e = this.emitters.get(id);
    if (e) e.rate = Math.max(0, rate);
  }

  moveEmitter(id: number, pos: THREE.Vector3Like): void {
    const e = this.emitters.get(id);
    if (!e) return;
    this.unbucket(e);
    e.x = pos.x;
    e.y = pos.y;
    e.z = pos.z;
    this.bucket(e);
  }

  /** gameplay lightning strike: bolt, flash, sparks and delayed thunder */
  lightningStrike(pos: THREE.Vector3Like): void {
    if (!this.game.settings.value.graphics.weatherEffects) {
      this.burst('sparks', pos, 1.2);
      return;
    }
    this.weather.strike(pos.x, pos.y, pos.z);
  }

  /** 0..~1.5 current lightning flash (render-core may use it to light clouds) */
  get lightningFlash(): number {
    return this.fx.uFlash.value;
  }

  /** active counts (debug overlay / tests) */
  stats(): { emitters: number; liveEmitters: number; particleLoad: number; budget: number } {
    let live = 0;
    for (const e of this.emitters.values()) if (e.live) live++;
    return { emitters: this.emitters.size, liveEmitters: live, particleLoad: Math.round(this.particles.load), budget: this.budget };
  }

  /** rendered ground height (m) */
  ground(x: number, z: number): number {
    try {
      return this.game.renderer.groundHeight(x, z);
    } catch {
      return this.world ? this.world.heightAt(x, z) : 0;
    }
  }

  /** current wind velocity (m/s, XZ) */
  windVector(): THREE.Vector3 {
    return this.wind;
  }

  cameraPosition(): THREE.Vector3 {
    return this.game.renderer.camera.position;
  }

  dispose(): void {
    this.onWorldUnloaded();
    this.game.renderer.scene.remove(this.group);
    this.particles.dispose();
    this.weather.dispose();
    this.atlas.dispose();
    this.ownNoise?.dispose();
  }

  // ── internals ─────────────────────────────────────────────────────────
  private presetBudget(): number {
    const g = this.game.settings.value.graphics;
    return g.preset === 'low' ? 0.5 : g.buildingDetail === 'low' ? 0.7 : 1;
  }

  private refreshUniforms(dtSim: number, dtReal: number): void {
    const r = this.game.renderer;
    const fx = this.fx;
    fx.uSimTime.value = (fx.uSimTime.value + dtSim) % 3600;
    fx.uRealTime.value = (fx.uRealTime.value + dtReal) % 3600;
    fx.uNight.value = r.lighting.night;
    fx.uAmbient.value.copy(r.lighting.ambientColor);
    if (fx.uSunDir !== r.shared.uSunDir) fx.uSunDir.value.copy(r.lighting.sunDir);
    if (fx.uSunColor !== r.shared.uSunColor) fx.uSunColor.value.copy(r.lighting.sunColor);
    const pu = this.particles.uniforms;
    pu.uAmbient.value.copy(r.lighting.ambientColor);
    pu.uSun.value.copy(r.lighting.sunColor);
    pu.uSunDir.value.copy(r.lighting.sunDir);
    // wind from the smoothed shared uniform (same as trees and clouds)
    const wd = r.shared.uWindDir?.value as THREE.Vector2 | undefined;
    const ws = (r.shared.uWindSpeed?.value as number | undefined) ?? this.world?.weather.windSpeed ?? 4;
    if (wd) this.wind.set(wd.x * ws, 0, wd.y * ws);
    else {
      const a = this.world?.weather.windDir ?? 0.6;
      this.wind.set(Math.cos(a) * ws, 0, Math.sin(a) * ws);
    }
    pu.uWind.value.copy(this.wind);
    // projection scale for minimum pixel sizes
    const cam = r.camera;
    const hPx = r.renderer.getDrawingBufferSize(this.tmp2).y;
    const ps = hPx * cam.projectionMatrix.elements[5] * 0.5;
    pu.uPixelScale.value = ps;
    // view state for weather
    const vi = r.getViewInfo();
    const fxw = vi.focusX * CELL, fzw = vi.focusY * CELL;
    this.view.focus.set(fxw, this.ground(fxw, fzw), fzw);
    this.view.distance = cam.position.distanceTo(this.view.focus);
    this.view.camera = cam;
    this.view.pixelScale = ps;
  }

  /** run the emitters close to the camera and inside the frustum */
  private emitNearby(): void {
    if (!this.emitters.size) return;
    const r = this.game.renderer;
    const vi = r.getViewInfo();
    const cam = r.camera.position;
    const maxDist = Math.min(Math.max(900, 900 + vi.altitude * 2.5), 5200);
    const focusX = vi.focusX * CELL, focusZ = vi.focusY * CELL;
    // search around both the focus and the camera ground point
    const cx = (focusX + cam.x) * 0.5, cz = (focusZ + cam.z) * 0.5;
    const reach = maxDist + Math.hypot(focusX - cam.x, focusZ - cam.z) * 0.5;
    const b0x = Math.floor((cx - reach) / BUCKET), b1x = Math.floor((cx + reach) / BUCKET);
    const b0z = Math.floor((cz - reach) / BUCKET), b1z = Math.floor((cz + reach) / BUCKET);
    for (const e of this.emitters.values()) e.live = false;
    const p = this.params;
    for (let bz = b0z; bz <= b1z; bz++)
      for (let bx = b0x; bx <= b1x; bx++) {
        const set = this.grid.get(key(bx, bz));
        if (!set) continue;
        for (const e of set) {
          if (e.rate <= 0) continue;
          const dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > maxDist) continue;
          this.sphere.center.set(e.x, e.y + 30 * e.scale, e.z);
          this.sphere.radius = 45 * e.scale + e.radius + 20;
          if (!vi.frustum.intersectsSphere(this.sphere)) continue;
          e.live = true;
          const lod = Math.max(0.1, Math.min(1, 380 / Math.max(1, d)));
          p.lod = lod * this.budget;
          p.lodSize = Math.min(2.4, 1 / Math.sqrt(Math.max(0.17, lod)));
          const dt = e.clock === Clock.Real ? this.dtReal : this.dtSim;
          emitContinuous(e, dt, p);
        }
      }
  }

  private bucket(e: EmitterState): void {
    e.key = key(Math.floor(e.x / BUCKET), Math.floor(e.z / BUCKET));
    let s = this.grid.get(e.key);
    if (!s) this.grid.set(e.key, (s = new Set()));
    s.add(e);
  }

  private unbucket(e: EmitterState): void {
    const s = this.grid.get(e.key);
    if (!s) return;
    s.delete(e);
    if (!s.size) this.grid.delete(e.key);
  }

  private explosionSound(pos: THREE.Vector3Like, scale: number): void {
    const d = this.tmp.set(pos.x, pos.y, pos.z).distanceTo(this.game.renderer.camera.position);
    this.queueSound(pos, Math.min(1.2, 0.35 + scale * 0.3), Math.min(3, d / 343));
  }

  private fireworkSound(x: number, y: number, z: number, s: number): void {
    const d = this.tmp.set(x, y, z).distanceTo(this.game.renderer.camera.position);
    if (d > 2500) return;
    this.queueSound({ x, y, z }, 0.12 * s, Math.min(4, d / 343));
  }

  private queueSound(pos: THREE.Vector3Like, vol: number, delay: number): void {
    if (this.thunderSfx.length > 12) return;
    this.thunderSfx.push({ at: this.clockReal + delay, x: pos.x / CELL, y: pos.z / CELL, vol });
  }

  private flushSounds(): void {
    for (let i = this.thunderSfx.length - 1; i >= 0; i--) {
      const s = this.thunderSfx[i];
      if (this.clockReal < s.at) continue;
      this.thunderSfx.splice(i, 1);
      try {
        const a = this.game.audio;
        if (typeof a.playAt === 'function') a.playAt('explosion', s.x, s.y, s.vol, 0.15);
        else a.play('explosion', s.vol);
      } catch {
        /* audio not ready */
      }
    }
  }
}

function key(bx: number, bz: number): number {
  return (bz + 4096) * 8192 + (bx + 4096);
}

function defaultRadius(kind: EffectKind): number {
  switch (kind) {
    case 'fire': return 4;
    case 'smoke': return 0.8;
    case 'steam': return 1.5;
    case 'dust': return 4;
    case 'fountain': return 0.5;
    case 'splash': return 3;
    case 'fireworks': return 20;
    case 'explosion': return 10;
    default: return 1;
  }
}
