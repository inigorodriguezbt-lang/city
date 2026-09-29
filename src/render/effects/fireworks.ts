// Fireworks: a handful of CPU-simulated shells (launch, glittering trail,
// fuse) that burst into hundreds of GPU star particles. Several classic shell
// types — peony, chrysanthemum, willow, ring, crossette and strobe — in a
// festive palette, with a bright burst flash for bloom and a delayed pop.
import { Clock, Mode, Shape, particleInit, type ParticleSystem } from './particles';

const PALETTE: [number, number][] = [
  [0xff3b3b, 0xff9a3a], // red → orange
  [0x42ff6a, 0xc8ff5a], // green
  [0x4a7dff, 0xa0c8ff], // blue
  [0xffd76a, 0xff8a2a], // gold
  [0xd05aff, 0xff7ad8], // violet
  [0xffffff, 0xbfd8ff], // silver
  [0x3cf2ff, 0x5a8cff], // cyan
  [0xff5ab4, 0xffc0e0], // pink
];

type ShellType = 'peony' | 'chrys' | 'willow' | 'ring' | 'crossette' | 'strobe';
const TYPES: ShellType[] = ['peony', 'peony', 'chrys', 'chrys', 'willow', 'ring', 'crossette', 'strobe'];

interface Shell {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  type: ShellType;
  color: number;
  scale: number;
  clock: Clock;
  trailAcc: number;
}

export interface FireworkHooks {
  /** a shell burst at a world position (for sound) */
  onBurst?: (x: number, y: number, z: number, scale: number) => void;
}

const P = particleInit();
const TAU = Math.PI * 2;
const rnd = Math.random;
const range = (a: number, b: number) => a + (b - a) * rnd();
const MAX_SHELLS = 48;

export class Fireworks {
  private shells: Shell[] = [];

  constructor(private readonly sys: ParticleSystem, private readonly hooks: FireworkHooks = {}) {}

  get active(): number {
    return this.shells.length;
  }

  /** launch a shell from ground position (x, y, z) */
  launch(x: number, y: number, z: number, scale = 1, clock: Clock = Clock.Sim): void {
    if (this.shells.length >= MAX_SHELLS) return;
    const s = Math.max(0.3, scale);
    const q = Math.sqrt(s);
    const lean = 0.08;
    this.shells.push({
      x, y, z,
      vx: (rnd() - 0.5) * 2 * lean * 60 * q,
      vy: range(52, 72) * q,
      vz: (rnd() - 0.5) * 2 * lean * 60 * q,
      fuse: range(2.1, 2.9),
      type: TYPES[(rnd() * TYPES.length) | 0],
      color: (rnd() * PALETTE.length) | 0,
      scale: s,
      clock,
      trailAcc: 0,
    });
  }

  /** dt per clock: [sim, real] */
  update(dtSim: number, dtReal: number): void {
    const sys = this.sys;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      const dt = sh.clock === Clock.Sim ? dtSim : dtReal;
      if (dt <= 0) continue;
      // ballistic ascent with light drag
      const drag = Math.exp(-0.25 * dt);
      sh.vx *= drag;
      sh.vz *= drag;
      sh.vy = sh.vy * drag - 9.8 * dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.z += sh.vz * dt;
      sh.fuse -= dt;
      // glittering comet trail
      sh.trailAcc += dt * 70;
      while (sh.trailAcc >= 1) {
        sh.trailAcc -= 1;
        P.clock = sh.clock;
        P.x = sh.x - sh.vx * dt * rnd();
        P.y = sh.y - sh.vy * dt * rnd();
        P.z = sh.z - sh.vz * dt * rnd();
        P.vx = (rnd() - 0.5) * 1.5;
        P.vy = (rnd() - 0.5) * 1.5 - 2;
        P.vz = (rnd() - 0.5) * 1.5;
        P.life = range(0.35, 0.8);
        P.s0 = 1.6 * sh.scale;
        P.s1 = 0.5 * sh.scale;
        P.drag = 1.5;
        P.wind = 0.2;
        P.buoy = -3;
        P.turb = 0.4;
        P.c0 = 0xffe2a8;
        P.c1 = 0xff6a20;
        P.alpha = 0.9;
        P.shape = Shape.Soft;
        P.mode = Mode.Sparkle;
        P.additive = true;
        P.glow = 4;
        P.age = rnd() * dt;
        sys.emit(P);
      }
      if (sh.fuse <= 0 || sh.vy < -2) {
        this.explode(sh);
        this.shells.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.shells.length = 0;
  }

  private star(sh: Shell, vx: number, vy: number, vz: number, life: number, size: number, c0: number, c1: number, mode: Mode, drag: number, gravity: number, glow: number): void {
    P.clock = sh.clock;
    P.x = sh.x;
    P.y = sh.y;
    P.z = sh.z;
    P.vx = vx + sh.vx * 0.3;
    P.vy = vy + sh.vy * 0.3;
    P.vz = vz + sh.vz * 0.3;
    P.life = life;
    P.s0 = size;
    P.s1 = size * 0.55;
    P.drag = drag;
    P.wind = 0.25;
    P.buoy = gravity;
    P.turb = 0.3;
    P.c0 = c0;
    P.c1 = c1;
    P.alpha = 1;
    P.shape = Shape.Streak;
    P.mode = mode;
    P.additive = true;
    P.glow = glow;
    P.age = 0;
    P.stretch = mode === Mode.Sparkle ? 0.22 : 0.3;
    this.sys.emit(P);
    P.stretch = 0;
  }

  private explode(sh: Shell): void {
    const s = sh.scale, q = Math.sqrt(s);
    const [c0, c1] = PALETTE[sh.color];
    const [d0] = PALETTE[(sh.color + 3) % PALETTE.length];
    // burst flash
    P.clock = sh.clock;
    P.x = sh.x; P.y = sh.y; P.z = sh.z;
    P.vx = P.vy = P.vz = 0;
    P.life = 0.3; P.s0 = 36 * q; P.s1 = 60 * q; P.drag = 0; P.wind = 0; P.buoy = 0; P.turb = 0;
    P.c0 = c0; P.c1 = c1; P.alpha = 0.55; P.shape = Shape.Soft; P.mode = Mode.Unlit; P.additive = true; P.glow = 5; P.age = 0;
    this.sys.emit(P);
    const speed = range(22, 30) * q;
    const dir = (u: number, v: number): [number, number, number] => {
      const th = u * TAU, ph = Math.acos(2 * v - 1);
      return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    };
    switch (sh.type) {
      case 'peony': {
        const n = Math.round(120 * q);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = dir(rnd(), rnd());
          const v = speed * range(0.85, 1.05);
          this.star(sh, x * v, y * v, z * v, range(1.5, 2.1), 2.4 * q, c0, c1, Mode.Unlit, 1.25, -3.2, range(5, 7));
        }
        break;
      }
      case 'chrys': {
        const n = Math.round(110 * q);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = dir(rnd(), rnd());
          const v = speed * range(0.9, 1.1);
          this.star(sh, x * v, y * v, z * v, range(2.0, 2.8), 2.1 * q, c0, 0xffe0a0, Mode.Sparkle, 1.1, -3.5, range(5, 7));
        }
        break;
      }
      case 'willow': {
        const n = Math.round(140 * q);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = dir(rnd(), rnd());
          const v = speed * range(0.7, 1.0);
          this.star(sh, x * v, y * v, z * v, range(3.2, 4.4), 2.0 * q, 0xffd890, 0xff7a20, Mode.Sparkle, 1.6, -4.2, range(3.5, 5));
        }
        break;
      }
      case 'ring': {
        const n = Math.round(90 * q);
        // random ring plane
        const tx = rnd() - 0.5, tz = rnd() - 0.5;
        const nx = tx, ny = 1, nz = tz;
        const nl = Math.hypot(nx, ny, nz);
        const ax = nx / nl, ay = ny / nl, az = nz / nl;
        // basis vectors of the plane
        let ux = 1, uy = 0, uz = 0;
        const d = ux * ax + uy * ay + uz * az;
        ux -= ax * d; uy -= ay * d; uz -= az * d;
        const ul = Math.hypot(ux, uy, uz);
        ux /= ul; uy /= ul; uz /= ul;
        const wx = ay * uz - az * uy, wy = az * ux - ax * uz, wz = ax * uy - ay * ux;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const cx = Math.cos(a), sx = Math.sin(a);
          const v = speed * 0.95;
          this.star(sh, (ux * cx + wx * sx) * v, (uy * cx + wy * sx) * v, (uz * cx + wz * sx) * v, range(1.5, 1.9), 2.4 * q, c0, c1, Mode.Unlit, 1.2, -3, 6);
        }
        // a small core in a contrasting colour
        for (let i = 0; i < 30 * q; i++) {
          const [x, y, z] = dir(rnd(), rnd());
          const v = speed * 0.35;
          this.star(sh, x * v, y * v, z * v, range(1.2, 1.6), 2.0 * q, d0, c1, Mode.Unlit, 1.5, -3, 5);
        }
        break;
      }
      case 'crossette': {
        // a few heavy comets that each split into four
        const n = Math.round(8 * q);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = dir(rnd(), rnd() * 0.7 + 0.3);
          const v = speed * 0.7;
          for (let k = 0; k < 14; k++) {
            const j = 0.18;
            this.star(sh, (x + (rnd() - 0.5) * j) * v, (y + (rnd() - 0.5) * j) * v, (z + (rnd() - 0.5) * j) * v, range(1.6, 2.3), 2.2 * q, c0, c1, Mode.Sparkle, 1.0, -4, 6);
          }
        }
        break;
      }
      case 'strobe': {
        const n = Math.round(90 * q);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = dir(rnd(), rnd());
          const v = speed * range(0.6, 1.0);
          this.star(sh, x * v, y * v, z * v, range(2.2, 3.0), 2.4 * q, 0xffffff, 0xdfe8ff, Mode.Sparkle, 1.8, -2.5, 8);
        }
        break;
      }
    }
    this.hooks.onBurst?.(sh.x, sh.y, sh.z, s);
  }
}
