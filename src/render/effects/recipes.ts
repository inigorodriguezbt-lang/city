// Particle recipes: how each EffectKind looks, both as a continuous emitter and
// as a one-shot burst. Recipes only write spawn records into the stateless
// ParticleSystem; all motion happens on the GPU.
import { Clock, Mode, ParticleSystem, Shape, particleInit, type ParticleInit } from './particles';

export type EffectKind = 'fire' | 'smoke' | 'steam' | 'explosion' | 'dust' | 'fountain' | 'fireworks' | 'sparks' | 'splash';

export const EFFECT_KINDS: EffectKind[] = ['fire', 'smoke', 'steam', 'explosion', 'dust', 'fountain', 'fireworks', 'sparks', 'splash'];

/** persistent emitter state (owned by EffectsRenderer) */
export interface EmitterState {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  z: number;
  /** relative rate multiplier (1 = normal) */
  rate: number;
  /** size multiplier */
  scale: number;
  /** spawn area radius (m) */
  radius: number;
  clock: Clock;
  /** optional tint override for smoke / steam / dust (0xRRGGBB) */
  color: number;
  /** spawn accumulators for sub-streams */
  acc: [number, number, number, number];
  /** spatial hash key (chunk) */
  key: number;
  /** false while culled (far / off-screen) */
  live: boolean;
}

const P: ParticleInit = particleInit();
const TAU = Math.PI * 2;
const rnd = Math.random;
const range = (a: number, b: number) => a + (b - a) * rnd();

function base(clock: Clock): ParticleInit {
  P.vx = P.vy = P.vz = 0;
  P.drag = 0;
  P.wind = 0;
  P.buoy = 0;
  P.turb = 0;
  P.glow = 1;
  P.alpha = 1;
  P.age = 0;
  P.stretch = 0;
  P.clock = clock;
  P.shape = Shape.Soft;
  P.mode = Mode.Unlit;
  P.additive = true;
  return P;
}

/** random point in a disc of radius r around (x, z) → P.x/P.z */
function inDisc(x: number, z: number, r: number): void {
  const a = rnd() * TAU, d = Math.sqrt(rnd()) * r;
  P.x = x + Math.cos(a) * d;
  P.z = z + Math.sin(a) * d;
}

/** integer number of spawns for `n` expected (keeps the fraction in acc[i]) */
function take(acc: number[], i: number, n: number): number {
  const v = acc[i] + n;
  const k = Math.floor(v);
  acc[i] = v - k;
  return k;
}

// ── building blocks ─────────────────────────────────────────────────────────
function flame(sys: ParticleSystem, x: number, y: number, z: number, r: number, s: number, clock: Clock, age: number, heat = 1): void {
  base(clock);
  inDisc(x, z, r);
  P.y = y + rnd() * 1.4 * s;
  const up = Math.sqrt(s);
  P.vx = (rnd() - 0.5) * 1.2 * up;
  P.vz = (rnd() - 0.5) * 1.2 * up;
  P.vy = range(2.2, 4.8) * up;
  P.life = range(0.65, 1.25) * (0.8 + 0.2 * up);
  P.s0 = range(2.0, 3.4) * s;
  P.s1 = P.s0 * range(0.3, 0.55);
  P.drag = 1.3;
  P.wind = 0.35;
  P.buoy = 3.2 * up;
  P.turb = 0.8 * up;
  P.mode = Mode.Fire;
  P.shape = Shape.Flame;
  P.glow = range(1.9, 3.2) * heat;
  P.alpha = 0.75;
  P.age = age;
  sys.emit(P);
}

function fireGlow(sys: ParticleSystem, x: number, y: number, z: number, r: number, s: number, clock: Clock, age: number, ground = true): void {
  // firelight pooled on the ground around the blaze
  if (ground) {
    base(clock);
    P.x = x + (rnd() - 0.5) * r * 0.5;
    P.z = z + (rnd() - 0.5) * r * 0.5;
    P.y = y + 0.5;
    P.life = range(0.45, 0.8);
    P.s0 = r * 3.2 + 12 * s;
    P.s1 = P.s0 * 1.08;
    P.c0 = 0xff8a3a;
    P.c1 = 0xff5a1a;
    P.glow = 1.6;
    P.alpha = 0.45;
    P.shape = Shape.Decal;
    P.age = age;
    sys.emit(P);
  }
  // a soft halo just above the flames (kept clear of the ground so it is never cut)
  base(clock);
  const size = r * 1.4 + 5 * s;
  P.x = x + (rnd() - 0.5) * r * 0.5;
  P.z = z + (rnd() - 0.5) * r * 0.5;
  P.y = y + size * 0.5 + 0.5 * s;
  P.vy = 0.6;
  P.life = range(0.5, 0.9);
  P.s0 = size;
  P.s1 = size * 1.1;
  P.c0 = 0xffa050;
  P.c1 = 0xff5a1a;
  P.glow = 1.2;
  P.alpha = 0.16;
  P.age = age;
  sys.emit(P);
}

function ember(sys: ParticleSystem, x: number, y: number, z: number, r: number, s: number, clock: Clock, age: number): void {
  base(clock);
  inDisc(x, z, r);
  P.y = y + rnd() * 2 * s;
  P.vx = (rnd() - 0.5) * 3;
  P.vz = (rnd() - 0.5) * 3;
  P.vy = range(4, 9) * Math.sqrt(s);
  P.life = range(1.8, 3.4);
  P.s0 = range(0.35, 0.6) * Math.sqrt(s);
  P.s1 = P.s0 * 0.5;
  P.drag = 0.6;
  P.wind = 0.8;
  P.buoy = 1.4;
  P.turb = 2.2;
  P.c0 = 0xffd48a;
  P.c1 = 0xff3a00;
  P.glow = 6;
  P.mode = Mode.Sparkle;
  P.alpha = 1;
  P.age = age;
  sys.emit(P);
}

function puff(
  sys: ParticleSystem, x: number, y: number, z: number, r: number, s: number, clock: Clock, age: number,
  c0: number, c1: number, alpha: number, life: [number, number], s0: number, s1: [number, number],
  vy: [number, number], opts: { drag?: number; wind?: number; buoy?: number; turb?: number; glow?: number; spread?: number } = {},
): void {
  base(clock);
  inDisc(x, z, r);
  P.y = y;
  const sp = opts.spread ?? 0.8;
  P.vx = (rnd() - 0.5) * 2 * sp;
  P.vz = (rnd() - 0.5) * 2 * sp;
  P.vy = range(vy[0], vy[1]);
  P.life = range(life[0], life[1]);
  P.s0 = s0 * s * range(0.8, 1.2);
  P.s1 = range(s1[0], s1[1]) * s;
  P.drag = opts.drag ?? 0.4;
  P.wind = opts.wind ?? 0.9;
  P.buoy = opts.buoy ?? 0.5;
  P.turb = opts.turb ?? 1;
  P.c0 = c0;
  P.c1 = c1;
  P.alpha = alpha;
  P.glow = opts.glow ?? 0;
  P.shape = Shape.Puff;
  P.mode = Mode.Lit;
  P.additive = false;
  P.age = age;
  sys.emit(P);
}

function droplet(sys: ParticleSystem, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, clock: Clock, age: number, alpha = 0.75): void {
  base(clock);
  P.x = x;
  P.y = y;
  P.z = z;
  P.vx = vx;
  P.vy = vy;
  P.vz = vz;
  P.life = life;
  P.s0 = size;
  P.s1 = size * 0.8;
  P.drag = 0.15;
  P.wind = 0.2;
  P.buoy = -9.8;
  P.c0 = 0xdcefff;
  P.c1 = 0xeef7ff;
  P.alpha = alpha;
  P.shape = Shape.Streak;
  P.mode = Mode.Lit;
  P.additive = false;
  P.age = age;
  sys.emit(P);
}

function ring(sys: ParticleSystem, x: number, y: number, z: number, s0: number, s1: number, life: number, c0: number, c1: number, alpha: number, additive: boolean, clock: Clock, glow = 1): void {
  base(clock);
  P.x = x;
  P.y = y;
  P.z = z;
  P.life = life;
  P.s0 = s0;
  P.s1 = s1;
  P.c0 = c0;
  P.c1 = c1;
  P.alpha = alpha;
  P.shape = Shape.Ring;
  P.mode = additive ? Mode.Unlit : Mode.Lit;
  P.additive = additive;
  P.glow = additive ? glow : 0;
  sys.emit(P);
}

function spark(sys: ParticleSystem, x: number, y: number, z: number, speed: number, up: number, s: number, clock: Clock, age: number, life: [number, number] = [0.5, 1.1]): void {
  base(clock);
  P.x = x;
  P.y = y;
  P.z = z;
  const a = rnd() * TAU;
  const el = Math.acos(1 - rnd() * (1 + up)) ;
  const h = Math.sin(el);
  const v = speed * range(0.4, 1);
  P.vx = Math.cos(a) * h * v;
  P.vz = Math.sin(a) * h * v;
  P.vy = Math.abs(Math.cos(el)) * v;
  P.life = range(life[0], life[1]);
  P.s0 = 0.3 * s;
  P.s1 = 0.16 * s;
  P.drag = 0.7;
  P.wind = 0.1;
  P.buoy = -9.8;
  P.c0 = 0xfff3c8;
  P.c1 = 0xff6a1a;
  P.glow = 7;
  P.shape = Shape.Streak;
  P.age = age;
  sys.emit(P);
}

// ── continuous emitters ─────────────────────────────────────────────────────
export interface EmitParams {
  sys: ParticleSystem;
  /** emission multiplier (budget × distance LOD) */
  lod: number;
  /** size multiplier compensating for fewer particles far away */
  lodSize: number;
  /** launches a firework shell (handled by the fireworks system) */
  launchShell: (x: number, y: number, z: number, scale: number, clock: Clock) => void;
}

/** spawn one frame of a persistent emitter; dt in seconds of the emitter's clock */
export function emitContinuous(e: EmitterState, dt: number, p: EmitParams): void {
  if (dt <= 0 || e.rate <= 0) return;
  const sys = p.sys, k = e.rate * p.lod * dt, s = e.scale * p.lodSize, c = e.clock;
  const { x, y, z, radius: r, acc } = e;
  switch (e.kind) {
    case 'fire': {
      const heat = Math.min(1.4, 0.6 + 0.4 * e.rate);
      for (let i = take(acc, 0, 38 * k), j = 0; j < i; j++) flame(sys, x, y, z, r, s, c, rnd() * dt, heat);
      for (let i = take(acc, 1, 2.2 * k * e.scale), j = 0; j < i; j++) fireGlow(sys, x, y, z, r, e.scale, c, rnd() * dt);
      for (let i = take(acc, 2, 5 * k), j = 0; j < i; j++) ember(sys, x, y, z, r, e.scale, c, rnd() * dt);
      for (let i = take(acc, 3, 7 * k), j = 0; j < i; j++)
        puff(sys, x, y + 2.5 * e.scale, z, r * 0.7, s, c, rnd() * dt, e.color || 0x24211e, 0x68645e, 0.72, [7, 11], 3, [16, 26], [3, 5.5], { drag: 0.35, wind: 0.9, buoy: 0.8, turb: 1.3, glow: 0.45, spread: 1.2 });
      break;
    }
    case 'smoke':
      for (let i = take(acc, 0, 5 * k), j = 0; j < i; j++)
        puff(sys, x, y, z, r, s, c, rnd() * dt, e.color || 0x8f8b85, 0xc4c1bb, 0.5, [11, 16], 2, [8, 13], [2.4, 3.8], { drag: 0.4, wind: 1, buoy: 0.3, turb: 0.7, spread: 0.4 });
      break;
    case 'steam':
      for (let i = take(acc, 0, 5 * k), j = 0; j < i; j++)
        puff(sys, x, y, z, r, s, c, rnd() * dt, e.color || 0xf2f4f6, 0xffffff, 0.55, [5, 7.5], 3, [11, 17], [3, 5], { drag: 0.6, wind: 0.9, buoy: 0.7, turb: 0.9, spread: 0.6 });
      break;
    case 'dust':
      for (let i = take(acc, 0, 3 * k), j = 0; j < i; j++)
        puff(sys, x, y + 0.5, z, r + 2 * e.scale, s, c, rnd() * dt, e.color || 0x9c8a70, 0xb8a88f, 0.32, [5, 8], 3, [12, 18], [0.5, 1.5], { drag: 0.5, wind: 0.6, buoy: 0.15, turb: 0.8, spread: 2 });
      break;
    case 'fountain': {
      const up = Math.sqrt(e.scale);
      for (let i = take(acc, 0, 70 * k), j = 0; j < i; j++) {
        const a = rnd() * TAU, sp = range(0.3, 1) * up;
        droplet(sys, x + (rnd() - 0.5) * 0.4 * e.scale, y, z + (rnd() - 0.5) * 0.4 * e.scale, Math.cos(a) * sp, range(7, 9.5) * up, Math.sin(a) * sp, range(0.25, 0.42) * s, range(1.3, 1.8) * up, c, rnd() * dt, 0.75);
      }
      for (let i = take(acc, 1, 4 * k), j = 0; j < i; j++)
        puff(sys, x, y + 0.3, z, r + 1.2 * e.scale, s, c, rnd() * dt, e.color || 0xeef6ff, 0xffffff, 0.16, [2, 3], 1.5, [4, 7], [0.4, 1.2], { drag: 1, wind: 0.6, buoy: 0.2, turb: 0.4, spread: 1 });
      break;
    }
    case 'sparks':
      for (let i = take(acc, 0, 32 * k), j = 0; j < i; j++) spark(sys, x, y, z, 8 * Math.sqrt(e.scale), 0.4, s, c, rnd() * dt);
      break;
    case 'splash':
      for (let i = take(acc, 0, 6 * k), j = 0; j < i; j++) {
        inDisc(x, z, r);
        burstSplash(sys, P.x, y, P.z, e.scale, c);
      }
      break;
    case 'explosion':
      for (let i = take(acc, 0, 0.35 * e.rate * dt), j = 0; j < i; j++) {
        inDisc(x, z, r);
        burst(p, 'explosion', P.x, y, P.z, 0.35 * e.scale, c);
      }
      break;
    case 'fireworks':
      for (let i = take(acc, 0, 0.7 * e.rate * dt), j = 0; j < i; j++) {
        inDisc(x, z, r + 12);
        p.launchShell(P.x, y, P.z, e.scale, c);
      }
      break;
  }
}

// ── bursts ──────────────────────────────────────────────────────────────────
function burstSplash(sys: ParticleSystem, x: number, y: number, z: number, s: number, c: Clock): void {
  ring(sys, x, y + 0.05, z, 0.25 * s, 2.4 * s, 0.45, 0xeaf4ff, 0xffffff, 0.3, false, c);
  const n = s > 3 ? Math.min(120, Math.round(12 * Math.sqrt(s))) : 5;
  const up = Math.sqrt(s);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, sp = range(0.6, 2.2) * up;
    droplet(sys, x, y, z, Math.cos(a) * sp, range(1.8, 4) * up, Math.sin(a) * sp, 0.07 * s, range(0.35, 0.6) * Math.max(1, up * 0.7), c, 0, 0.55);
  }
  if (s > 3) {
    for (let i = 0; i < 10; i++)
      puff(sys, x, y + 1, z, s * 0.6, s * 0.35, c, 0, 0xf2f7fb, 0xffffff, 0.45, [2.5, 4], 3, [10, 18], [2, 8], { drag: 1.2, wind: 0.6, buoy: -0.5, turb: 1.2, spread: 2 * up });
  }
}

/** one-shot effect at a world position */
export function burst(p: EmitParams, kind: EffectKind, x: number, y: number, z: number, scale: number, clock: Clock): void {
  const sys = p.sys, s = Math.max(0.05, scale), q = Math.sqrt(s);
  const n = (v: number) => Math.max(1, Math.round(v * Math.min(1, p.lod + 0.35)));
  switch (kind) {
    case 'explosion': {
      // flash
      base(clock);
      P.x = x; P.y = y + 3 * s; P.z = z;
      P.life = 0.28; P.s0 = 34 * s; P.s1 = 46 * s; P.c0 = 0xfff6e0; P.c1 = 0xffa040; P.glow = 9; P.alpha = 1;
      sys.emit(P);
      // fireball
      for (let i = 0, m = n(38 * q); i < m; i++) {
        base(clock);
        const a = rnd() * TAU, el = rnd() * 1.2;
        const v = range(6, 20) * Math.pow(s, 0.6);
        P.x = x + (rnd() - 0.5) * 3 * s; P.y = y + rnd() * 2 * s; P.z = z + (rnd() - 0.5) * 3 * s;
        P.vx = Math.cos(a) * Math.cos(el) * v; P.vz = Math.sin(a) * Math.cos(el) * v; P.vy = Math.sin(el) * v + 5 * q;
        P.life = range(0.9, 1.7) * Math.pow(s, 0.25); P.s0 = range(4, 7) * s; P.s1 = range(10, 15) * s;
        P.drag = 2.4; P.buoy = 6 * q; P.turb = 1.5 * q; P.wind = 0.3; P.mode = Mode.Fire; P.glow = range(3, 4.5); P.alpha = 0.85;
        sys.emit(P);
      }
      // hot debris & sparks
      for (let i = 0, m = n(46 * q); i < m; i++) {
        base(clock);
        const a = rnd() * TAU, el = range(0.15, 1.35);
        const v = range(14, 38) * q;
        P.x = x; P.y = y + 2 * s; P.z = z;
        P.vx = Math.cos(a) * Math.cos(el) * v; P.vz = Math.sin(a) * Math.cos(el) * v; P.vy = Math.sin(el) * v;
        P.life = range(1.2, 2.6) * Math.pow(s, 0.2); P.s0 = 0.45 * q; P.s1 = 0.2 * q;
        P.drag = 0.45; P.buoy = -9.8; P.shape = Shape.Streak; P.c0 = 0xffe2a0; P.c1 = 0xff4a10; P.glow = 6;
        sys.emit(P);
      }
      // smoke column
      for (let i = 0, m = n(26 * q); i < m; i++)
        puff(sys, x, y + range(1, 6) * s, z, 4 * s, s, clock, 0, 0x1c1a18, 0x57534e, 0.72, [7, 12], 8, [26, 38], [2, 9 * q], { drag: 0.8, wind: 0.8, buoy: 1.1 * q, turb: 1.6 * q, glow: 1.3, spread: 5 * q });
      // ground shock: additive ring + dust ring
      ring(sys, x, y + 0.3, z, 3 * s, 110 * s, 0.75, 0xfff0d0, 0xff9a50, 0.55, true, clock, 2.2);
      ring(sys, x, y + 0.3, z, 4 * s, 70 * s, 1.6, 0xa89880, 0xc8baa4, 0.35, false, clock);
      for (let i = 0, m = n(14 * q); i < m; i++) {
        const a = rnd() * TAU;
        base(clock);
        puff(sys, x + Math.cos(a) * 5 * s, y + 1, z + Math.sin(a) * 5 * s, 1, s, clock, 0, 0x8a7d6c, 0xb0a490, 0.45, [4, 7], 6, [18, 26], [0.5, 2], { drag: 1.2, wind: 0.5, buoy: 0.1, turb: 0.8, spread: 0 });
      }
      break;
    }
    case 'dust': {
      for (let i = 0, m = n(30 * q); i < m; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 4 * s;
        base(clock);
        P.x = x + Math.cos(a) * d; P.y = y + rnd() * 3 * s; P.z = z + Math.sin(a) * d;
        const v = range(3, 10) * q;
        P.vx = Math.cos(a) * v; P.vz = Math.sin(a) * v; P.vy = range(1, 5) * q;
        P.life = range(6, 10); P.s0 = 6 * s * range(0.8, 1.2); P.s1 = range(18, 26) * s;
        P.drag = 1; P.wind = 0.5; P.buoy = 0.3; P.turb = 1; P.c0 = 0x8f8373; P.c1 = 0xb3a896; P.alpha = 0.55;
        P.shape = Shape.Puff; P.mode = Mode.Lit; P.additive = false; P.glow = 0;
        sys.emit(P);
      }
      for (let i = 0, m = n(18 * q); i < m; i++) {
        base(clock);
        const a = rnd() * TAU, v = range(4, 12) * q;
        P.x = x; P.y = y + rnd() * 6 * s; P.z = z;
        P.vx = Math.cos(a) * v; P.vz = Math.sin(a) * v; P.vy = range(3, 9) * q;
        P.life = range(0.9, 1.6); P.s0 = 0.5 * q; P.s1 = 0.4 * q; P.drag = 0.3; P.buoy = -9.8;
        P.c0 = 0x5a534a; P.c1 = 0x6a6258; P.alpha = 0.9; P.shape = Shape.Streak; P.mode = Mode.Lit; P.additive = false; P.glow = 0;
        sys.emit(P);
      }
      break;
    }
    case 'fire':
      for (let i = 0, m = n(34 * q); i < m; i++) flame(sys, x, y, z, 3 * s, s * 1.4, clock, 0, 1.2);
      fireGlow(sys, x, y, z, 3 * s, s, clock, 0);
      for (let i = 0, m = n(8 * q); i < m; i++) ember(sys, x, y, z, 3 * s, s, clock, 0);
      for (let i = 0, m = n(6 * q); i < m; i++) puff(sys, x, y + 3 * s, z, 2 * s, s, clock, 0, 0x24211e, 0x68645e, 0.6, [6, 9], 4, [16, 24], [3, 6], { glow: 0.6 });
      break;
    case 'smoke':
      for (let i = 0, m = n(10 * q); i < m; i++) puff(sys, x, y, z, 3 * s, s, clock, 0, 0x55514c, 0x9a968f, 0.55, [6, 10], 4, [14, 22], [1.5, 4], { spread: 2 });
      break;
    case 'steam':
      for (let i = 0, m = n(12 * q); i < m; i++) puff(sys, x, y, z, 3 * s, s, clock, 0, 0xf2f4f6, 0xffffff, 0.55, [3, 5], 4, [14, 20], [2, 5], { spread: 2.5, drag: 0.9 });
      break;
    case 'sparks':
      for (let i = 0, m = n(60 * q); i < m; i++) spark(sys, x, y, z, 14 * q, 0.9, s, clock, 0, [0.6, 1.6]);
      base(clock);
      P.x = x; P.y = y; P.z = z; P.life = 0.15; P.s0 = 6 * s; P.s1 = 8 * s; P.c0 = 0xfff4d0; P.c1 = 0xffc080; P.glow = 6;
      sys.emit(P);
      break;
    case 'splash':
    case 'fountain':
      burstSplash(sys, x, y, z, kind === 'fountain' ? s * 4 : s, clock);
      break;
    case 'fireworks':
      p.launchShell(x, y, z, s, clock);
      break;
  }
}

/** default clock per kind: gameplay effects follow the sim, ambience real time */
export function defaultClock(kind: EffectKind): Clock {
  return kind === 'steam' || kind === 'fountain' || kind === 'splash' || kind === 'smoke' ? Clock.Real : Clock.Sim;
}
