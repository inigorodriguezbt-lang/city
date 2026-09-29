// Visuals for active events, derived every frame from `world.activeEvents`
// (so they are recreated after loading a save and always match the sim):
// tornado funnels, falling meteors and smouldering craters, UFOs, balloon
// parades, fireworks shows, meteor showers, geysers, film-set explosions,
// industrial smoke plumes and tsunami waves.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import type { ActiveEvent } from '../../core/types';
import { clamp01, smoothstep } from '../../core/util';
import type { World } from '../../world/World';
import type { FloodData, MeteorData, TornadoData } from '../../sim/events/types';
import type { EffectsRenderer } from './EffectsRenderer';
import { BalloonParade, DinoBalloon } from './balloons';
import { MeteorVisual } from './meteor';
import { Clock, Mode, Shape, particleInit } from './particles';
import { TornadoVisual } from './tornado';
import { TsunamiVisual } from './tsunami';
import { UfoVisual } from './ufo';

interface Visual {
  update(ev: ActiveEvent, world: World, dtSim: number, dtReal: number): void;
  dispose(): void;
}

const P = particleInit();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const rnd = Math.random;

function cellToWorld(fx: EffectsRenderer, cx: number, cy: number, out: THREE.Vector3): THREE.Vector3 {
  const x = cx * CELL, z = cy * CELL;
  return out.set(x, fx.ground(x, z), z);
}

/** event progress helpers (days) */
function since(ev: ActiveEvent, w: World): number {
  return Math.max(0, w.time.day - ev.startDay);
}
function until(ev: ActiveEvent, w: World): number {
  return Math.max(0, ev.endDay - w.time.day);
}

// ── tornado ─────────────────────────────────────────────────────────────────
class TornadoCtl implements Visual {
  private readonly vis: TornadoVisual;
  private dustAcc = 0;
  constructor(private readonly fx: EffectsRenderer, ev: ActiveEvent) {
    const d = ev.data as unknown as TornadoData | undefined;
    this.vis = new TornadoVisual(fx.fx, d?.strength ?? 1);
    fx.group.add(this.vis.group);
  }
  update(ev: ActiveEvent, w: World, dtSim: number): void {
    const d = ev.data as unknown as TornadoData | undefined;
    if (!d) return;
    const p = cellToWorld(this.fx, d.px, d.py, _v);
    this.vis.grow = Math.min(smoothstep(0, 0.45, since(ev, w)), smoothstep(0, 0.6, until(ev, w)));
    this.vis.update(p.x, p.y, p.z, dtSim);
    // debris skirt: dust boiling outward and upward at the base
    this.dustAcc += dtSim * 22 * this.vis.grow * this.fx.budget;
    const sys = this.fx.particles;
    while (this.dustAcc >= 1) {
      this.dustAcc -= 1;
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 30;
      P.clock = Clock.Sim;
      P.x = p.x + Math.cos(a) * r; P.y = p.y + rnd() * 6; P.z = p.z + Math.sin(a) * r;
      const tang = 14 + rnd() * 10;
      P.vx = -Math.sin(a) * tang + Math.cos(a) * 6; P.vz = Math.cos(a) * tang + Math.sin(a) * 6; P.vy = 3 + rnd() * 9;
      P.life = 3 + rnd() * 3; P.s0 = 8 + rnd() * 6; P.s1 = 28 + rnd() * 18; P.drag = 0.7; P.wind = 0.4; P.buoy = 1.2; P.turb = 3;
      P.c0 = 0x6d6257; P.c1 = 0x8f857a; P.alpha = 0.5; P.shape = Shape.Puff; P.mode = Mode.Lit; P.additive = false; P.glow = 0; P.age = rnd() * dtSim;
      sys.emit(P);
    }
  }
  dispose(): void {
    this.fx.group.remove(this.vis.group);
    this.vis.dispose();
  }
}

// ── meteor ──────────────────────────────────────────────────────────────────
class MeteorCtl implements Visual {
  private vis: MeteorVisual | null = null;
  private crater: number[] = [];
  private trailAcc = 0;
  private readonly dir = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private hasPrev = false;
  constructor(private readonly fx: EffectsRenderer) {}
  update(ev: ActiveEvent, w: World, dtSim: number): void {
    const d = ev.data as unknown as MeteorData | undefined;
    if (!d) return;
    const impact = cellToWorld(this.fx, d.tx, d.ty, _v);
    if (!d.impacted) {
      if (!this.vis) {
        this.vis = new MeteorVisual(this.fx.fx, d.size);
        this.fx.group.add(this.vis.group);
      }
      const total = Math.max(0.1, d.impactDay - ev.startDay);
      const s = clamp01((w.time.day - ev.startDay) / total);
      // travel direction: from the sky toward the impact point
      this.dir.set(Math.cos(d.az) * Math.cos(d.el), -Math.sin(d.el), Math.sin(d.az) * Math.cos(d.el)).normalize();
      const D0 = 4800;
      const dist = D0 * Math.pow(1 - s, 1.25) + d.size * 0.5;
      const head = _d.copy(impact).addScaledVector(this.dir, -dist);
      const heat = smoothstep(0, 0.12, s);
      this.vis.setState(head.x, head.y, head.z, this.dir, 0.4 + 0.6 * heat, w.time.day * 3);
      // fiery wake: flames at the head and a long smoke trail, spread along the
      // path travelled this frame so the trail stays continuous at any frame rate
      const sys = this.fx.particles;
      if (!this.hasPrev) this.prev.copy(head);
      // one flame per ~5 m of path and a minimum rate while hovering (paused → nothing)
      this.trailAcc += dtSim > 0 ? Math.max(dtSim * 40, this.prev.distanceTo(head) / Math.max(3, d.size * 0.6)) : 0;
      if (this.trailAcc > 400) this.trailAcc = 400;
      while (this.trailAcc >= 1) {
        this.trailAcc -= 1;
        const f = rnd();
        const bx = this.prev.x + (head.x - this.prev.x) * f, by = this.prev.y + (head.y - this.prev.y) * f, bz = this.prev.z + (head.z - this.prev.z) * f;
        const age = (1 - f) * dtSim;
        P.clock = Clock.Sim;
        P.x = bx + (rnd() - 0.5) * d.size; P.y = by + (rnd() - 0.5) * d.size; P.z = bz + (rnd() - 0.5) * d.size;
        P.vx = -this.dir.x * 60; P.vy = -this.dir.y * 60; P.vz = -this.dir.z * 60;
        P.life = 0.5 + rnd() * 0.5; P.s0 = d.size * 2.6; P.s1 = d.size * 1.2; P.drag = 2; P.wind = 0; P.buoy = 0; P.turb = 4;
        P.shape = Shape.Soft; P.mode = Mode.Fire; P.additive = true; P.glow = 4; P.alpha = 0.9; P.age = age;
        sys.emit(P);
        if (rnd() < 0.55) {
          P.vx = -this.dir.x * 20; P.vy = -this.dir.y * 20 + 2; P.vz = -this.dir.z * 20;
          P.life = 6 + rnd() * 5; P.s0 = d.size * 2; P.s1 = d.size * 7; P.drag = 1; P.wind = 0.8; P.buoy = 0.5; P.turb = 3;
          P.c0 = 0x3a3430; P.c1 = 0x77716a; P.alpha = 0.55; P.shape = Shape.Puff; P.mode = Mode.Lit; P.additive = false; P.glow = 0.35; P.age = age;
          sys.emit(P);
        }
      }
      this.prev.copy(head);
      this.hasPrev = true;
      // head glow
      P.clock = Clock.Sim; P.x = head.x; P.y = head.y; P.z = head.z; P.vx = P.vy = P.vz = 0;
      P.life = 0.12; P.s0 = d.size * 6; P.s1 = d.size * 7; P.drag = 0; P.buoy = 0; P.turb = 0; P.wind = 0;
      P.c0 = 0xfff0d0; P.c1 = 0xffa050; P.alpha = 0.8; P.shape = Shape.Soft; P.mode = Mode.Unlit; P.additive = true; P.glow = 5; P.age = 0;
      if (dtSim > 0) sys.emit(P);
    } else {
      if (this.vis) {
        this.fx.group.remove(this.vis.group);
        this.vis.dispose();
        this.vis = null;
      }
      if (!this.crater.length && !d.water) {
        const s = Math.max(1, d.radius * 0.6);
        this.crater.push(this.fx.addEmitter('fire', impact, 0.8, { scale: s * 0.7, radius: d.radius * CELL * 0.35, clock: Clock.Sim }));
        this.crater.push(this.fx.addEmitter('smoke', { x: impact.x, y: impact.y + 4, z: impact.z }, 1.2, { scale: s * 1.4, radius: d.radius * CELL * 0.3, clock: Clock.Sim, color: 0x3a3632 }));
      }
      // the crater cools down over the event
      const k = clamp01(until(ev, w) / Math.max(0.5, ev.endDay - d.impactDay));
      if (this.crater.length) {
        this.fx.setEmitterRate(this.crater[0], 0.15 + 0.85 * k * k);
        this.fx.setEmitterRate(this.crater[1], 0.3 + 0.9 * k);
      }
    }
  }
  dispose(): void {
    if (this.vis) {
      this.fx.group.remove(this.vis.group);
      this.vis.dispose();
    }
    for (const id of this.crater) this.fx.removeEmitter(id);
  }
}

// ── UFO ─────────────────────────────────────────────────────────────────────
class UfoCtl implements Visual {
  private readonly vis: UfoVisual;
  private readonly bank = new THREE.Vector2();
  private t = 0;
  private readonly seed = rnd() * 100;
  constructor(private readonly fx: EffectsRenderer) {
    this.vis = new UfoVisual(fx.fx);
    fx.group.add(this.vis.group);
  }
  update(ev: ActiveEvent, w: World, _dtSim: number, dtReal: number): void {
    this.t += dtReal;
    const t = this.t;
    const c = cellToWorld(this.fx, (ev.x ?? w.home.x) + 0.5, (ev.y ?? w.home.y) + 0.5, _v);
    // lazy figure-eight around the sighting, with sudden sideways darts
    const a = t * 0.11 + this.seed;
    const dart = Math.sin(t * 0.37 + this.seed) > 0.97 ? 1 : 0;
    const x = c.x + Math.sin(a) * 140 + Math.sin(a * 2.3) * 40 + dart * 30;
    const z = c.z + Math.sin(a * 2) * 90;
    const vx = Math.cos(a) * 140 * 0.11, vz = Math.cos(a * 2) * 180 * 0.11;
    this.bank.set(vx * 0.02, vz * 0.02);
    const g = this.fx.ground(x, z);
    const y = Math.max(g, c.y) + 95 + Math.sin(t * 0.8) * 4;
    // the beam switches on while it lingers (and always at the start)
    const beam = since(ev, w) < 0.6 || Math.sin(t * 0.21 + this.seed) > -0.2 ? 1 : 0;
    this.vis.update(x, y, z, g, t, this.bank, beam * smoothstep(0, 0.3, until(ev, w)), dtReal);
  }
  dispose(): void {
    this.fx.group.remove(this.vis.group);
    this.vis.dispose();
  }
}

// ── balloons ────────────────────────────────────────────────────────────────
class BalloonCtl implements Visual {
  private readonly vis: BalloonParade;
  private t = 0;
  constructor(private readonly fx: EffectsRenderer, ev: ActiveEvent) {
    this.vis = new BalloonParade(11, ev.id * 7919);
    fx.group.add(this.vis.group);
  }
  update(ev: ActiveEvent, w: World, _dtSim: number, dtReal: number): void {
    this.t += dtReal;
    const c = cellToWorld(this.fx, (ev.x ?? w.home.x) + 0.5, (ev.y ?? w.home.y) + 0.5, _v);
    const wind = this.fx.windVector();
    this.vis.update(c.x, c.z, (x, z) => this.fx.ground(x, z), wind.x, wind.z, this.t, dtReal);
    // burner flames
    const sys = this.fx.particles;
    for (let i = 0; i < this.vis.balloons.length; i++) {
      const b = this.vis.balloons[i];
      if (b.burn.value < 0.3 || rnd() > dtReal * 30) continue;
      const f = this.vis.flames[i];
      P.clock = Clock.Real; P.x = f.x; P.y = f.y; P.z = f.z;
      P.vx = (rnd() - 0.5) * 0.4; P.vy = 3.5 + rnd() * 2; P.vz = (rnd() - 0.5) * 0.4;
      P.life = 0.35 + rnd() * 0.2; P.s0 = 1.3; P.s1 = 0.5; P.drag = 1; P.wind = 0; P.buoy = 2; P.turb = 0.4;
      P.shape = Shape.Soft; P.mode = Mode.Fire; P.additive = true; P.glow = 4; P.alpha = 0.9; P.age = 0;
      sys.emit(P);
    }
  }
  dispose(): void {
    this.fx.group.remove(this.vis.group);
    this.vis.dispose();
  }
}

class DinoCtl implements Visual {
  private readonly vis = new DinoBalloon();
  private t = 0;
  private ox = 0;
  private oz = 0;
  constructor(private readonly fx: EffectsRenderer) {
    fx.group.add(this.vis.group);
  }
  update(ev: ActiveEvent, w: World, _dtSim: number, dtReal: number): void {
    this.t += dtReal;
    const wind = this.fx.windVector();
    this.ox = (this.ox + wind.x * 0.6 * dtReal + 900) % 1800 - 900;
    this.oz = (this.oz + wind.z * 0.6 * dtReal + 900) % 1800 - 900;
    const c = cellToWorld(this.fx, (ev.x ?? w.home.x) + 0.5, (ev.y ?? w.home.y) + 0.5, _v);
    const x = c.x + this.ox + Math.sin(this.t * 0.05) * 60, z = c.z + this.oz + Math.cos(this.t * 0.04) * 60;
    const g = this.fx.ground(x, z);
    const y = Math.max(g + 60, c.y + 95) + Math.sin(this.t * 0.2) * 8;
    this.vis.update(x, y, z, Math.atan2(-wind.z, wind.x), this.t);
  }
  dispose(): void {
    this.fx.group.remove(this.vis.group);
    this.vis.dispose();
  }
}

// ── fireworks shows ─────────────────────────────────────────────────────────
class FireworksCtl implements Visual {
  private acc = 0;
  constructor(private readonly fx: EffectsRenderer, private readonly rate: number, private readonly spread: number) {}
  update(ev: ActiveEvent, w: World, dtSim: number): void {
    const night = this.fx.fx.uNight.value;
    const k = 0.12 + 0.88 * smoothstep(0.25, 0.75, night);
    this.acc += dtSim * this.rate * k;
    if (this.acc > 6) this.acc = 6;
    while (this.acc >= 1) {
      this.acc -= 1;
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * this.spread;
      const x = ((ev.x ?? w.home.x) + 0.5) * CELL + Math.cos(a) * r, z = ((ev.y ?? w.home.y) + 0.5) * CELL + Math.sin(a) * r;
      this.fx.fireworks.launch(x, this.fx.ground(x, z) + 2, z, 0.9 + rnd() * 0.5, Clock.Sim);
    }
  }
  dispose(): void {}
}

// ── meteor shower (shooting stars at night) ─────────────────────────────────
class ShowerCtl implements Visual {
  private acc = 0;
  private readonly radiant = new THREE.Vector3(rnd() - 0.5, -0.35, rnd() - 0.5).normalize();
  constructor(private readonly fx: EffectsRenderer) {}
  update(_ev: ActiveEvent, _w: World, _dtSim: number, dtReal: number): void {
    const night = this.fx.fx.uNight.value;
    if (night < 0.4) return;
    this.acc += dtReal * 2.2 * night;
    const cam = this.fx.cameraPosition();
    const sys = this.fx.particles;
    while (this.acc >= 1) {
      this.acc -= 1;
      const a = rnd() * Math.PI * 2, d = 1200 + rnd() * 2200;
      const sp = 350 + rnd() * 350;
      P.clock = Clock.Real;
      P.x = cam.x + Math.cos(a) * d; P.z = cam.z + Math.sin(a) * d; P.y = cam.y + 900 + rnd() * 1600;
      P.vx = (this.radiant.x + (rnd() - 0.5) * 0.3) * sp; P.vy = this.radiant.y * sp; P.vz = (this.radiant.z + (rnd() - 0.5) * 0.3) * sp;
      P.life = 0.5 + rnd() * 0.8; P.s0 = 3; P.s1 = 1.5; P.drag = 0; P.wind = 0; P.buoy = 0; P.turb = 0;
      P.c0 = rnd() < 0.3 ? 0xb8ffd0 : 0xe8f0ff; P.c1 = 0xffc890; P.alpha = 1; P.shape = Shape.Streak; P.mode = Mode.Unlit; P.additive = true; P.glow = 7; P.age = 0;
      sys.emit(P);
    }
  }
  dispose(): void {}
}

// ── emitter-based site visuals ──────────────────────────────────────────────
class SiteCtl implements Visual {
  private ids: number[] = [];
  private acc = 0;
  constructor(private readonly fx: EffectsRenderer, private readonly kind: 'geyser' | 'plume' | 'film' | 'sinkhole') {}
  update(ev: ActiveEvent, w: World, dtSim: number): void {
    const p = cellToWorld(this.fx, (ev.x ?? w.home.x) + 0.5, (ev.y ?? w.home.y) + 0.5, _v);
    const fade = smoothstep(0, 0.5, until(ev, w));
    if (!this.ids.length) {
      if (this.kind === 'geyser') {
        this.ids.push(this.fx.addEmitter('fountain', { x: p.x, y: p.y + 0.3, z: p.z }, 1.4, { scale: 3.2, clock: Clock.Sim }));
        this.ids.push(this.fx.addEmitter('splash', { x: p.x, y: p.y + 0.2, z: p.z }, 3, { scale: 2, radius: 6, clock: Clock.Sim }));
      } else if (this.kind === 'plume') {
        this.ids.push(this.fx.addEmitter('fire', p, 1.2, { scale: 2.2, radius: 10, clock: Clock.Sim }));
        this.ids.push(this.fx.addEmitter('smoke', { x: p.x, y: p.y + 8, z: p.z }, 1.6, { scale: 3, radius: 8, clock: Clock.Sim, color: 0x2a2724 }));
      } else if (this.kind === 'sinkhole') {
        this.ids.push(this.fx.addEmitter('dust', p, 1.2, { scale: 2, radius: 12, clock: Clock.Sim }));
      }
    }
    if (this.kind === 'plume' && this.ids.length) {
      const k = clamp01(until(ev, w) / Math.max(0.5, ev.endDay - ev.startDay));
      this.fx.setEmitterRate(this.ids[0], 0.2 + 1.0 * k * k);
      this.fx.setEmitterRate(this.ids[1], 0.4 + 1.2 * k);
    } else if (this.kind === 'geyser' && this.ids.length) {
      this.fx.setEmitterRate(this.ids[0], 1.4 * fade);
      this.fx.setEmitterRate(this.ids[1], 3 * fade);
    } else if (this.kind === 'sinkhole' && this.ids.length) {
      this.fx.setEmitterRate(this.ids[0], 1.2 * fade);
    }
    if (this.kind === 'film') {
      // "action scene": a pyrotechnic blast every so often
      this.acc += dtSim * 0.18;
      if (this.acc >= 1) {
        this.acc = 0;
        const a = rnd() * Math.PI * 2;
        const x = p.x + Math.cos(a) * 25, z = p.z + Math.sin(a) * 25;
        this.fx.burst('explosion', { x, y: this.fx.ground(x, z), z }, 0.45);
      }
    }
  }
  dispose(): void {
    for (const id of this.ids) this.fx.removeEmitter(id);
    this.ids = [];
  }
}

// ── tsunami wave ────────────────────────────────────────────────────────────
class TsunamiCtl implements Visual {
  private vis: TsunamiVisual | null = null;
  private sprayAcc = 0;
  constructor(private readonly fx: EffectsRenderer) {}
  update(ev: ActiveEvent, w: World, dtSim: number): void {
    const d = ev.data as unknown as FloodData | undefined;
    if (!d || d.arriveDay === undefined || d.dx === undefined || d.dy === undefined) return;
    const approach = Math.max(0.2, d.approach ?? 1.5);
    const left = d.arriveDay - w.time.day;
    const fade = smoothstep(-0.25, 0.05, left) * smoothstep(approach, approach * 0.85, left);
    if (fade <= 0.001) {
      if (this.vis) this.vis.group.visible = false;
      return;
    }
    if (!this.vis) {
      this.vis = new TsunamiVisual(this.fx.fx);
      this.fx.group.add(this.vis.group);
    }
    const coast = cellToWorld(this.fx, (ev.x ?? 0) + 0.5, (ev.y ?? 0) + 0.5, _v);
    const dist = Math.max(0, left / approach) * 3200;
    const x = coast.x - d.dx * dist, z = coast.z - d.dy * dist;
    const sea = w.seaLevel + w.floodOffset;
    const height = (16 + d.peak * 3) * (1 - 0.4 * clamp01(left / approach));
    this.vis.update(x, z, d.dx, d.dy, sea, height, fade);
    this.vis.group.updateMatrixWorld();
    // wind-torn spray along the crest
    this.sprayAcc += dtSim * 50 * fade * this.fx.budget;
    const sys = this.fx.particles;
    while (this.sprayAcc >= 1) {
      this.sprayAcc -= 1;
      this.vis.crestPoint(0.12 + rnd() * 0.76, _d);
      P.clock = Clock.Sim; P.x = _d.x; P.y = _d.y; P.z = _d.z;
      P.vx = d.dx * 12 + (rnd() - 0.5) * 4; P.vy = 3 + rnd() * 5; P.vz = d.dy * 12 + (rnd() - 0.5) * 4;
      P.life = 2 + rnd() * 2; P.s0 = 8; P.s1 = 26; P.drag = 1; P.wind = 0.6; P.buoy = -1; P.turb = 2;
      P.c0 = 0xf2f6f8; P.c1 = 0xffffff; P.alpha = 0.5; P.shape = Shape.Puff; P.mode = Mode.Lit; P.additive = false; P.glow = 0; P.age = 0;
      sys.emit(P);
    }
  }
  dispose(): void {
    if (this.vis) {
      this.fx.group.remove(this.vis.group);
      this.vis.dispose();
    }
  }
}

// ── registry ────────────────────────────────────────────────────────────────
function createVisual(fx: EffectsRenderer, ev: ActiveEvent): Visual | null {
  switch (ev.defId) {
    case 'tornado': return new TornadoCtl(fx, ev);
    case 'meteor':
    case 'giant_meteor': return new MeteorCtl(fx);
    case 'ufo': return new UfoCtl(fx);
    case 'balloon_parade': return new BalloonCtl(fx, ev);
    case 'dino_balloon': return new DinoCtl(fx);
    case 'festival': return new FireworksCtl(fx, 0.9, 60);
    case 'new_year': return new FireworksCtl(fx, 1.8, 110);
    case 'championship': return new FireworksCtl(fx, 0.5, 50);
    case 'concert': return new FireworksCtl(fx, 0.25, 30);
    case 'meteor_shower': return new ShowerCtl(fx);
    case 'water_main_break': return new SiteCtl(fx, 'geyser');
    case 'explosion': return new SiteCtl(fx, 'plume');
    case 'film_shoot': return new SiteCtl(fx, 'film');
    case 'sinkhole': return new SiteCtl(fx, 'sinkhole');
    case 'tsunami': return new TsunamiCtl(fx);
    default: return null;
  }
}

export class EventVisuals {
  private visuals = new Map<number, Visual | null>();
  private readonly seen = new Set<number>();

  constructor(private readonly fx: EffectsRenderer) {}

  update(world: World, dtSim: number, dtReal: number): void {
    const seen = this.seen;
    seen.clear();
    for (const ev of world.activeEvents) {
      seen.add(ev.id);
      let v = this.visuals.get(ev.id);
      if (v === undefined) {
        v = createVisual(this.fx, ev);
        this.visuals.set(ev.id, v);
      }
      if (v) {
        try {
          v.update(ev, world, dtSim, dtReal);
        } catch (err) {
          console.warn('[effects] event visual failed', ev.defId, err);
          v.dispose();
          this.visuals.set(ev.id, null);
        }
      }
    }
    for (const [id, v] of this.visuals) {
      if (seen.has(id)) continue;
      v?.dispose();
      this.visuals.delete(id);
    }
  }

  clear(): void {
    for (const v of this.visuals.values()) v?.dispose();
    this.visuals.clear();
  }
}
