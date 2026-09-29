// ─────────────────────────────────────────────────────────────────────────────
// AudioManager — every sound in URBIS is synthesized with WebAudio.
// Owned by the "systems" agent.
//
// Graph
//   sfx voices ──dry──► sfxBus ─┐                 ┌─► worldMuffle (lowpass) ─┐
//              └─wet──► sfxWet ─┼─► worldVerb ────┘                          │
//   ambience ───dry──► ambBus ──┘   (convolver)                              ├─► master ─► compressor ─► out
//              └─wet──► ambWet ─┘                                            │
//   music ──────dry──► musicBus ─────────────────────────────────────────────┤
//              └─wet──► musicWet ─► musicVerb (long hall) ───────────────────┘
// Bus gains follow settings.audio (squared for a perceptual curve) and glide,
// so slider moves never click. The world path is muffled while menus are open.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Settings } from '../settings/types';
import { CELL } from '../core/constants';
import { calendar, daylight } from '../core/time';
import { BFlag } from '../core/types';
import { Ambience, defaultScene, type AmbienceScene } from './ambience';
import { biquad, createImpulse, createNoiseBank, gainNode, glide, type NoiseBank } from './dsp';
import { Music, type MusicMood } from './music';
import { RECIPES, makeSfxEnv, type SfxEnv, type SfxOpts } from './sfx';

export type SfxId =
  | 'click' | 'hover' | 'open' | 'close' | 'place' | 'road' | 'zone' | 'bulldoze' | 'error' | 'money'
  | 'milestone' | 'achievement' | 'notice' | 'warning' | 'disaster' | 'siren' | 'thunder' | 'explosion' | 'chirp' | 'levelup';

export const SFX_IDS: SfxId[] = [
  'click', 'hover', 'open', 'close', 'place', 'road', 'zone', 'bulldoze', 'error', 'money',
  'milestone', 'achievement', 'notice', 'warning', 'disaster', 'siren', 'thunder', 'explosion', 'chirp', 'levelup',
];

/** minimum gap between repeats (s) and max simultaneous voices per sound */
const THROTTLE: Record<SfxId, [gap: number, max: number]> = {
  click: [0.09, 3], hover: [0.05, 2], open: [0.12, 2], close: [0.12, 2], place: [0.05, 4], road: [0.07, 3], zone: [0.05, 4],
  bulldoze: [0.08, 3], error: [0.25, 1], money: [0.12, 3], milestone: [2.5, 1], achievement: [0.8, 2], notice: [0.3, 2],
  warning: [0.6, 1], disaster: [4, 1], siren: [10, 1], thunder: [0.6, 3], explosion: [0.2, 3], chirp: [0.15, 3], levelup: [0.25, 3],
};

const MAX_VOICES = 40;
const UI_SELECTOR = 'button, [role="button"], [role="tab"], [role="menuitem"], .btn, a[href], select, summary, input[type="checkbox"], input[type="radio"], [data-sfx]';

interface Bus {
  dry: GainNode;
  wet: GainNode;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private bank: NoiseBank | null = null;
  private env: SfxEnv | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private muffleGain: GainNode | null = null;
  private sfxBus: Bus | null = null;
  private ambBus: Bus | null = null;
  private musicBus: Bus | null = null;
  private musicDuck: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private ambience: Ambience | null = null;
  private music: Music | null = null;
  private lastPlay = new Map<SfxId, number>();
  private active = new Map<SfxId, number>();
  private voices = 0;
  private unlocked = false;
  private inited = false;
  private hidden = false;
  private lastHover: Element | null = null;
  private muffled = false;
  /** true while the ambience itself triggers a sound (not an external caller) */
  private internalCall = false;
  private sceneAcc = 1;
  private scene: AmbienceScene = defaultScene();
  private bstate = new Map<number, number>();
  private tmpV = new THREE.Vector3();
  /** override scene values (sandbox / photo tools); null = live scene */
  debugScene: Partial<AmbienceScene> | null = null;
  /** force a music mood (null = automatic) */
  forceMood: MusicMood | null = null;
  /** automatic click/hover sounds for every interactive element (see init) */
  uiSounds = false;

  constructor(protected game: Game) {}

  /** must be called from a user gesture to unlock WebAudio */
  unlock(): void {
    if (!this.ctx) this.createGraph();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running' && !this.hidden) void ctx.resume().catch(() => undefined);
    if (!this.unlocked) {
      this.unlocked = true;
      // iOS: a silent buffer inside the gesture unlocks output
      try {
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        b.connect(ctx.destination);
        b.start();
      } catch {
        /* not needed elsewhere */
      }
      // starts the music too, unless it is muted / at zero volume
      this.applySettings(this.game.settings.value, true);
    }
  }

  init(): void {
    if (this.inited) return;
    this.inited = true;
    const g = this.game;
    g.events.on('settings:changed', (s) => this.applySettings(s));
    // disasters get an ominous swell (throttled, so callers that already play it don't double up)
    g.events.on('event:start', (ev) => {
      try {
        const def = g.eventSystem.catalog.find((d) => d.id === ev.defId);
        if (def && (def.disaster || def.severity === 'disaster')) {
          if (ev.x !== undefined && ev.y !== undefined) this.playAt('disaster', ev.x, ev.y, 1, 0.5);
          else this.play('disaster');
        }
      } catch {
        /* catalog unavailable */
      }
    });
    // nearby level-ups sparkle, nearby fires bring a distant siren
    g.events.on('world:loaded', (w) => {
      this.bstate.clear();
      for (const b of w.buildings.values()) this.bstate.set(b.id, b.level | (b.flags << 4));
    });
    g.events.on('world:unloaded', () => this.bstate.clear());
    g.events.on('building:added', (b) => this.bstate.set(b.id, b.level | (b.flags << 4)));
    g.events.on('building:removed', (b) => this.bstate.delete(b.id));
    g.events.on('building:changed', (b) => {
      const prev = this.bstate.get(b.id);
      const cur = b.level | (b.flags << 4);
      this.bstate.set(b.id, cur);
      if (prev === undefined || !this.ctx) return;
      const pLevel = prev & 15, pFlags = prev >> 4;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      // only when the camera is close enough to see it (a growing city levels up constantly)
      if (b.kind === 'zoned' && b.level > pLevel && this.scene.altitude < 900) this.playAt('levelup', cx, cy, 0.6, 0, 28);
      if (b.flags & BFlag.OnFire && !(pFlags & BFlag.OnFire)) this.playAt('siren', cx, cy, 0.9, 0, 140);
    });
    // Declarative UI sounds (delegated on the UI root): any element with
    // data-sfx="<SfxId>" plays that sound when pressed, and data-sfx-hover
    // adds a hover tick. With `uiSounds` on, every interactive element gets
    // click/hover automatically (data-sfx="none" opts out). The HUD and menus
    // play their own sounds, so the automatic mode is off in the game.
    const root = g.uiRoot;
    if (root) {
      root.addEventListener('pointerdown', (e) => {
        const target = e.target as Element | null;
        const el = this.uiSounds ? target?.closest?.(UI_SELECTOR) : target?.closest?.('[data-sfx]');
        if (!el || isDisabled(el)) return;
        const id = el.getAttribute('data-sfx');
        if (id === 'none') return;
        this.play(id && isSfx(id) ? id : 'click', 0.8);
      }, { capture: true, passive: true });
      root.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const target = e.target as Element | null;
        const el = this.uiSounds ? target?.closest?.(UI_SELECTOR) : target?.closest?.('[data-sfx-hover]');
        if (!el || el === this.lastHover || isDisabled(el) || el.getAttribute('data-sfx') === 'none') {
          if (!el) this.lastHover = null;
          return;
        }
        this.lastHover = el;
        this.play('hover', 0.6);
      }, { passive: true });
    }
    // browsers may re-suspend the context (e.g. iOS after an interruption): resume on any gesture
    const resume = () => {
      const ctx = this.ctx;
      if (ctx && this.unlocked && !this.hidden && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', resume, { capture: true, passive: true });
      window.addEventListener('keydown', resume, { capture: true, passive: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.hidden;
        const ctx = this.ctx;
        if (!ctx || !this.unlocked || !this.master) return;
        if (document.hidden) {
          // fade out, then stop the clock (no click, no CPU while hidden)
          glide(this.master.gain, 0, ctx.currentTime, 0.02);
          setTimeout(() => { if (document.hidden) void ctx.suspend().catch(() => undefined); }, 120);
        } else {
          void ctx.resume().then(() => this.applySettings(this.game.settings.value)).catch(() => undefined);
        }
      });
    }
  }

  /** per frame: ambience follows the scene, music schedules ahead */
  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || ctx.state !== 'running') return;
    this.sceneAcc += dt;
    if (this.sceneAcc >= 0.1) {
      this.sceneAcc = 0;
      this.readScene();
    }
    const scene = this.debugScene ? { ...this.scene, ...this.debugScene } : this.scene;
    this.ambience?.update(dt, scene);
    // muffle the world while a blocking menu is open
    const menu = this.menuOpen();
    if (this.muffle && this.muffleGain && menu !== this.muffled) {
      this.muffled = menu;
      glide(this.muffle.frequency, menu ? 700 : 20000, ctx.currentTime, 0.25);
      glide(this.muffleGain.gain, menu ? 0.55 : 1, ctx.currentTime, 0.25);
    }
    if (this.music) {
      const mood: MusicMood = this.forceMood ?? (!scene.active ? 'menu' : scene.daylight < 0.32 ? 'night' : 'day');
      this.music.setMood(mood);
      this.music.update();
    }
  }

  play(id: SfxId, volume = 1): void {
    this.playWith(id, volume, {});
  }

  // ── additive API ─────────────────────────────────────────────────────────
  /** play a sound at a map cell: attenuated by distance, panned, muffled far away */
  playAt(id: SfxId, x: number, y: number, volume = 1, minGain = 0, maxCells = Infinity): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let gain = 1, pan = 0, distance = 0;
    try {
      const ctl = this.game.renderer.cameraCtl;
      const w = this.game.world;
      const cells = Math.hypot(ctl.focus.x - x, ctl.focus.y - y);
      if (cells > maxCells) return;
      const horiz = cells * CELL;
      const alt = this.scene.altitude || 300;
      const d3 = Math.hypot(horiz, alt * 0.7);
      gain = Math.min(1, 320 / Math.max(320, d3));
      distance = Math.min(1, d3 / 4000);
      if (w) {
        this.tmpV.set((x + 0.5) * CELL, w.cellHeight(Math.floor(x), Math.floor(y)), (y + 0.5) * CELL);
        const s = this.game.renderer.worldToScreen(this.tmpV);
        const r = this.game.renderer.canvas.getBoundingClientRect();
        if (r.width > 0) pan = Math.max(-1, Math.min(1, ((s.x - r.left) / r.width) * 2 - 1)) * 0.8;
      }
    } catch {
      /* renderer not ready: play centered */
    }
    gain = Math.max(minGain, gain);
    if (gain < 0.05) return;
    this.playWith(id, volume * gain, { pan, distance });
  }

  /** play with explicit stereo position / distance */
  playWith(id: SfxId, volume = 1, opts: SfxOpts = {}): void {
    const ctx = this.ctx, env = this.env;
    if (!ctx || !env || !this.unlocked || this.hidden) return;
    if (ctx.state !== 'running') return;
    const recipe = RECIPES[id];
    if (!recipe || !(volume > 0)) return;
    const now = ctx.currentTime;
    const [gap, max] = THROTTLE[id];
    const last = this.lastPlay.get(id) ?? -1e9;
    const act = this.active.get(id) ?? 0;
    if (now - last < gap || act >= max || this.voices >= MAX_VOICES) return;
    if (this.sfxLevel() <= 0.0001) return;
    this.lastPlay.set(id, now);
    if (id === 'thunder' && !this.internalCall && this.ambience) this.ambience.externalThunderAt = now;
    if (id === 'milestone') this.duckMusic(0.35, 3.4);
    else if (id === 'disaster') this.duckMusic(0.5, 4);
    else if (id === 'achievement') this.duckMusic(0.6, 1.6);
    try {
      const end = recipe(env, now + 0.005, Math.min(2, volume), opts);
      this.active.set(id, act + 1);
      this.voices++;
      setTimeout(() => {
        this.active.set(id, Math.max(0, (this.active.get(id) ?? 1) - 1));
        this.voices = Math.max(0, this.voices - 1);
      }, Math.max(30, (end - now) * 1000));
    } catch (e) {
      console.warn('[audio] sfx failed', id, e);
    }
  }

  /** true once WebAudio is running */
  get ready(): boolean {
    return !!this.ctx && this.unlocked && this.ctx.state === 'running';
  }

  /** the AudioContext (null before the first gesture) */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get musicMood(): MusicMood | null {
    return this.music?.currentMood ?? null;
  }

  /** RMS of the final mix over the last ~20 ms (0..1), for meters and tests */
  outputLevel(): number {
    const a = this.analyser;
    if (!a) return 0;
    const buf = (this.levelBuf ??= new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** layer levels for debug meters */
  ambienceLevels(): Record<string, number> {
    return this.ambience?.levels() ?? {};
  }

  /** scene the ambience is currently following */
  get currentScene(): Readonly<AmbienceScene> {
    return this.debugScene ? { ...this.scene, ...this.debugScene } : this.scene;
  }

  // ── internals ────────────────────────────────────────────────────────────
  private createGraph(): void {
    const AC: typeof AudioContext | undefined = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      console.warn('[audio] WebAudio unavailable', e);
      return;
    }
    this.ctx = ctx;
    const bank = (this.bank = createNoiseBank(ctx));
    // master chain
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    comp.connect(this.analyser);
    this.master = gainNode(ctx, 0, comp);
    // world path (sfx + ambience) with a muffling lowpass for menus
    this.muffleGain = gainNode(ctx, 1, this.master);
    this.muffle = biquad(ctx, 'lowpass', 20000, 0.5, this.muffleGain);
    const worldVerb = ctx.createConvolver();
    worldVerb.buffer = createImpulse(ctx, 2.2, { decay: 3.2, predelay: 0.015, brightness: 0.55 });
    worldVerb.connect(this.muffle);
    const bus = (dryDest: AudioNode, wetDest: AudioNode): Bus => ({ dry: gainNode(ctx, 0, dryDest), wet: gainNode(ctx, 0, wetDest) });
    this.sfxBus = bus(this.muffle, worldVerb);
    this.ambBus = bus(this.muffle, worldVerb);
    // music path (not muffled; ducks under fanfares)
    this.musicDuck = gainNode(ctx, 1, this.master);
    const musicVerb = ctx.createConvolver();
    musicVerb.buffer = createImpulse(ctx, 4.8, { decay: 2.6, predelay: 0.03, brightness: 0.45, early: 10 });
    musicVerb.connect(this.musicDuck);
    this.musicBus = bus(this.musicDuck, musicVerb);
    this.env = makeSfxEnv({ ctx, dry: this.sfxBus.dry, wet: this.sfxBus.wet }, bank);
    const ambEnv = makeSfxEnv({ ctx, dry: this.ambBus.dry, wet: this.ambBus.wet }, bank);
    this.ambience = new Ambience(ambEnv, this.ambBus.dry, this.ambBus.wet, bank, (vol, pan) => {
      this.internalCall = true;
      try {
        this.playWith('thunder', vol, { pan, distance: 1 - vol });
      } finally {
        this.internalCall = false;
      }
    });
    const musicEnv = makeSfxEnv({ ctx, dry: this.musicBus.dry, wet: this.musicBus.wet }, bank);
    this.music = new Music({ ctx, dry: this.musicBus.dry, wet: this.musicBus.wet }, musicEnv);
    this.applySettings(this.game.settings.value, true);
  }

  private applySettings(s: Settings, instant = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const a = s.audio;
    const curve = (v: number) => {
      const c = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      return c * c;
    };
    const t = ctx.currentTime;
    const tau = instant ? 0.01 : 0.08;
    glide(this.master.gain, a.muted ? 0 : curve(a.master), t, tau);
    const set = (b: Bus | null, v: number) => {
      if (!b) return;
      glide(b.dry.gain, v, t, tau);
      glide(b.wet.gain, v, t, tau);
    };
    set(this.sfxBus, curve(a.sfx));
    set(this.ambBus, curve(a.ambience) * 1.2);
    set(this.musicBus, curve(a.music) * 1.1);
    // keep the scheduler idle when music is silent
    if (this.music && this.unlocked) {
      if (a.music <= 0.001 || a.muted) this.music.stop(1);
      else if (!this.music.playing) this.music.start();
    }
  }

  private sfxLevel(): number {
    const a = this.game.settings.value.audio;
    return a.muted ? 0 : a.master * a.sfx;
  }

  private duckMusic(to: number, seconds: number): void {
    const ctx = this.ctx, d = this.musicDuck;
    if (!ctx || !d) return;
    const t = ctx.currentTime;
    d.gain.cancelScheduledValues(t);
    d.gain.setTargetAtTime(to, t, 0.15);
    d.gain.setTargetAtTime(1, t + seconds, 0.8);
  }

  private menuOpen(): boolean {
    try {
      return this.game.menus.isOpen() && !!this.game.world;
    } catch {
      return false;
    }
  }

  /** sample the live game into the ambience scene (10 Hz) */
  private readScene(): void {
    const g = this.game;
    const w = g.world;
    const s = this.scene;
    s.active = !!w;
    if (!w) return;
    let altitude = s.altitude;
    try {
      const vi = g.renderer.getViewInfo();
      if (vi && Number.isFinite(vi.altitude)) altitude = vi.altitude;
    } catch {
      /* renderer not ready */
    }
    s.altitude = altitude;
    s.hour = w.time.hour;
    s.daylight = g.settings.value.gameplay.dayCycleMinutes === 0 ? 1 : daylight(w.time.hour);
    s.season = calendar(w.time.day).season;
    s.weather = w.weather.type;
    s.intensity = w.weather.intensity;
    s.windSpeed = w.weather.windSpeed;
    s.temperature = w.weather.temperature;
    s.vehicles = w.stats.vehicles;
    s.population = w.stats.population;
    s.paused = w.time.speed === 0;
    // what surrounds the camera focus: water, trees, buildings/roads
    let fx = w.home.x, fy = w.home.y;
    try {
      const f = g.renderer.cameraCtl.focus;
      fx = f.x;
      fy = f.y;
    } catch {
      /* renderer not ready */
    }
    const radius = Math.max(3, Math.min(64, (altitude / CELL) * 0.6));
    const N = 7;
    let water = 0, trees = 0, urban = 0, n = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = Math.floor(fx + ((i / (N - 1)) * 2 - 1) * radius);
        const y = Math.floor(fy + ((j / (N - 1)) * 2 - 1) * radius);
        if (!w.inBounds(x, y)) continue;
        n++;
        const k = w.idx(x, y);
        if (w.isWater(x, y)) water++;
        else {
          if (w.trees[k]) trees += w.trees[k] / 3;
          if (w.bldg[k] || w.road[k]) urban++;
        }
      }
    }
    if (n) {
      s.water = Math.min(1, (water / n) * 2.2);
      s.trees = Math.min(1, (trees / n) * 2);
      s.urban = urban / n;
    }
  }
}

function isSfx(id: string): id is SfxId {
  return (SFX_IDS as string[]).includes(id);
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
}
