// Scene-reactive ambience: wind, city hum & passing traffic, birds, crickets,
// rain/storm (with occasional thunder), shore waves. Continuous layers are
// looping noise through filters whose gains glide toward per-frame targets;
// discrete events (birds, crickets, pass-bys, droplets) are scheduled ahead.
import type { Season, WeatherType } from '../core/types';
import { ahr, biquad, clamp01, gainNode, glide, noise, osc, pick, rand, type NoiseBank } from './dsp';
import { birdCall, type BirdSpecies, type SfxEnv } from './sfx';

export interface AmbienceScene {
  /** a city is loaded */
  active: boolean;
  /** camera height above ground (m) */
  altitude: number;
  /** 0 night … 1 noon */
  daylight: number;
  hour: number;
  season: Season;
  weather: WeatherType;
  /** 0..1 */
  intensity: number;
  /** m/s */
  windSpeed: number;
  /** °C */
  temperature: number;
  vehicles: number;
  population: number;
  paused: boolean;
  /** fraction of water / wooded cells around the camera focus (0..1) */
  water: number;
  trees: number;
  /** built-up fraction around the focus (0..1) */
  urban: number;
}

export function defaultScene(): AmbienceScene {
  return {
    active: false, altitude: 400, daylight: 1, hour: 10, season: 'summer', weather: 'clear', intensity: 0, windSpeed: 4,
    temperature: 18, vehicles: 0, population: 0, paused: false, water: 0, trees: 0.3, urban: 0,
  };
}

const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A looping noise bed through a filter chain with a gliding gain and pan. */
class NoiseLayer {
  private src: AudioBufferSourceNode | null = null;
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly filter2: BiquadFilterNode | null;
  readonly panner: StereoPannerNode | null;
  private silentFor = 0;
  level = 0;

  constructor(private ctx: AudioContext, private buf: AudioBuffer, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, second?: { type: BiquadFilterType; freq: number; q: number }, private rate = 1) {
    this.gain = gainNode(ctx, 0, dest);
    this.panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (this.panner) this.panner.connect(this.gain);
    const into = this.panner ?? this.gain;
    this.filter2 = second ? biquad(ctx, second.type, second.freq, second.q, into) : null;
    this.filter = biquad(ctx, type, freq, q, this.filter2 ?? into);
  }

  /** glide toward `target`; starts/stops the source lazily */
  set(target: number, now: number, dt: number, tau = 0.6): void {
    if (target > 0.0005 && !this.src) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.buf;
      s.loop = true;
      s.playbackRate.value = this.rate;
      s.connect(this.filter);
      s.start(now, Math.random() * this.buf.duration);
      this.src = s;
    }
    if (!this.src) return;
    glide(this.gain.gain, target, now, tau);
    this.level = target;
    if (target <= 0.0005) {
      this.silentFor += dt;
      if (this.silentFor > tau * 6 + 1) this.stop();
    } else this.silentFor = 0;
  }

  stop(): void {
    if (!this.src) return;
    try {
      this.src.stop();
      this.src.disconnect();
    } catch {
      /* already stopped */
    }
    this.src = null;
    this.silentFor = 0;
  }
}

interface Cricket {
  osc: OscillatorNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  next: number;
  pulses: number;
  rate: number;
}

export class Ambience {
  private windA: NoiseLayer;
  private windB: NoiseLayer;
  private hum: NoiseLayer;
  private traffic: NoiseLayer;
  private rain: NoiseLayer;
  private rainBody: NoiseLayer;
  private waves: NoiseLayer;
  private crickets: Cricket[] = [];
  private cricketBus: GainNode;
  private birdBus: GainNode;
  private evBus: GainNode;
  private t = 0;
  private acc = 0;
  private windPhase = [Math.random() * 100, Math.random() * 100];
  private nextBird = 0;
  private nextPass = 0;
  private nextHorn = 0;
  private nextDrop = 0;
  private nextThunder = 0;
  private scene: AmbienceScene = defaultScene();
  /** time of the last thunder played by someone else (events), to avoid doubling */
  externalThunderAt = -1e9;

  constructor(private e: SfxEnv, private out: AudioNode, private wet: AudioNode, bank: NoiseBank, private thunder: (vol: number, pan: number) => void) {
    const ctx = e.ctx;
    this.windA = new NoiseLayer(ctx, bank.brown, out, 'bandpass', 500, 0.7, { type: 'lowpass', freq: 1800, q: 0.5 }, 1.4);
    this.windB = new NoiseLayer(ctx, bank.pink, out, 'bandpass', 700, 0.9, { type: 'lowpass', freq: 2400, q: 0.5 }, 0.8);
    this.hum = new NoiseLayer(ctx, bank.brown, out, 'lowpass', 420, 0.7, { type: 'highpass', freq: 45, q: 0.7 });
    this.traffic = new NoiseLayer(ctx, bank.pink, out, 'bandpass', 950, 0.55, { type: 'lowpass', freq: 3200, q: 0.5 });
    this.rain = new NoiseLayer(ctx, bank.white, out, 'highpass', 600, 0.5, { type: 'lowpass', freq: 7200, q: 0.4 });
    this.rainBody = new NoiseLayer(ctx, bank.pink, out, 'lowpass', 1300, 0.6, { type: 'highpass', freq: 120, q: 0.6 });
    this.waves = new NoiseLayer(ctx, bank.pink, out, 'lowpass', 800, 0.6, { type: 'highpass', freq: 90, q: 0.6 }, 0.7);
    this.birdBus = gainNode(ctx, 1, out);
    const birdWet = gainNode(ctx, 0.35, wet);
    this.birdBus.connect(birdWet);
    this.cricketBus = gainNode(ctx, 0, out);
    this.evBus = gainNode(ctx, 1, out);
    const evWet = gainNode(ctx, 0.2, wet);
    this.evBus.connect(evWet);
  }

  /** latest scene (for debugging UIs) */
  get current(): Readonly<AmbienceScene> {
    return this.scene;
  }

  /** layer levels for meters */
  levels(): Record<string, number> {
    return {
      wind: this.windA.level + this.windB.level, city: this.hum.level + this.traffic.level, rain: this.rain.level + this.rainBody.level,
      waves: this.waves.level, crickets: this.cricketBus.gain.value,
    };
  }

  update(dt: number, s: AmbienceScene): void {
    this.scene = s;
    this.t += dt;
    this.acc += dt;
    const ctx = this.e.ctx;
    const now = ctx.currentTime;
    this.scheduleEvents(now, s);
    if (this.crickets.length) this.tickCrickets(now);
    if (this.acc < 0.1) return;
    const step = this.acc;
    this.acc = 0;
    const on = s.active ? 1 : 0;
    const alt = Math.max(0, s.altitude);
    const close = 1 - smooth(120, 2600, alt); // zoomed in
    const high = smooth(250, 3200, alt); // zoomed out
    const wet = s.weather === 'rain' || s.weather === 'storm';
    const storm = s.weather === 'storm' ? s.intensity : 0;
    const blizzard = s.weather === 'blizzard' ? Math.max(0.5, s.intensity) : 0;
    const snow = s.weather === 'snow' ? s.intensity : 0;
    const muffle = Math.max(snow * 0.5, blizzard * 0.3); // snow dampens the city

    // ── wind: stronger high up, in storms and blizzards; gusts via slow noise
    const gust = (i: number) => {
      const p = (this.windPhase[i] += step * (0.13 + i * 0.07));
      return 0.55 + 0.25 * Math.sin(p) + 0.2 * Math.sin(p * 2.37 + 1.3);
    };
    const windBase = 0.035 + 0.3 * high + clamp01(s.windSpeed / 18) * 0.22 + storm * 0.28 + blizzard * 0.55;
    const gA = gust(0), gB = gust(1);
    this.windA.set(on * windBase * gA * 0.6, now, step, 0.5);
    this.windB.set(on * windBase * gB * 0.35, now, step, 0.5);
    glide(this.windA.filter.frequency, 320 + gA * 520 + blizzard * 300, now, 0.6);
    glide(this.windB.filter.frequency, 520 + gB * 800 + storm * 400, now, 0.6);
    if (this.windA.panner) glide(this.windA.panner.pan, Math.sin(this.t * 0.07) * 0.6, now, 1);
    if (this.windB.panner) glide(this.windB.panner.pan, -Math.sin(this.t * 0.05 + 1) * 0.6, now, 1);

    // ── city hum & traffic wash
    const traffic = clamp01(Math.log10(1 + s.vehicles) / 3.3);
    const pop = clamp01(Math.log10(1 + s.population) / 5.6);
    const night = 1 - smooth(0.15, 0.6, s.daylight);
    const activity = (1 - night * 0.45) * (s.paused ? 0.35 : 1) * (1 - muffle);
    const cityNear = 0.35 + 0.65 * close;
    this.hum.set(on * (0.04 * pop + 0.085 * traffic) * cityNear * activity * (0.4 + 0.6 * Math.max(s.urban, traffic * 0.5)), now, step, 0.8);
    this.traffic.set(on * 0.11 * traffic * (0.15 + 0.85 * close) * activity * (0.3 + 0.7 * s.urban), now, step, 0.8);
    glide(this.traffic.filter.frequency, 700 + 500 * close, now, 1);

    // ── rain
    const rainAmt = wet ? Math.max(0.25, s.intensity) * (s.weather === 'storm' ? 1.25 : 1) : 0;
    this.rain.set(on * rainAmt * 0.22, now, step, 1.2);
    this.rainBody.set(on * rainAmt * 0.16 * (0.5 + 0.5 * close), now, step, 1.2);

    // ── shore waves: slow swells
    const wave = 0.5 + 0.5 * Math.sin((this.t / 7.3) * Math.PI * 2) * Math.sin((this.t / 11.1) * Math.PI * 2 + 0.7);
    const waveAmt = on * s.water * (0.25 + 0.75 * (1 - smooth(200, 2200, alt))) * (0.55 + 0.45 * wave) * (1 + storm * 0.8);
    this.waves.set(waveAmt * 0.3, now, step, 0.9);
    glide(this.waves.filter.frequency, 450 + wave * 700 + storm * 500, now, 0.9);

    // ── crickets on warm nights
    const seasonK = s.season === 'summer' ? 1 : s.season === 'spring' || s.season === 'autumn' ? 0.35 : 0;
    const cricketAmt = on * seasonK * smooth(0.45, 0.1, s.daylight) * smooth(10, 18, s.temperature) * (wet || snow || blizzard ? 0 : 1) * (1 - smooth(300, 1800, alt)) * (0.35 + 0.65 * Math.max(s.trees, 1 - s.urban));
    glide(this.cricketBus.gain, cricketAmt * 0.08, now, 1.5);
    if (cricketAmt > 0.01 && !this.crickets.length) this.startCrickets();
    else if (cricketAmt <= 0.01 && this.crickets.length && this.cricketBus.gain.value < 0.001) this.stopCrickets();

    // ducking of discrete event layers
    glide(this.birdBus.gain, on, now, 0.5);
    glide(this.evBus.gain, on, now, 0.5);
  }

  private scheduleEvents(now: number, s: AmbienceScene): void {
    if (!s.active) return;
    const alt = s.altitude;
    const close = 1 - smooth(120, 2600, alt);
    const wet = s.weather === 'rain' || s.weather === 'storm' || s.weather === 'snow' || s.weather === 'blizzard';
    // birds: daytime, fewer in winter, dawn chorus, more near trees & when zoomed in
    if (now >= this.nextBird) {
      const seasonK = { spring: 1.35, summer: 1, autumn: 0.55, winter: 0.18 }[s.season];
      const dawn = s.hour > 4.8 && s.hour < 8.5 ? 1.9 : 1;
      const rate = (wet ? 0 : 1) * smooth(0.2, 0.55, s.daylight) * seasonK * dawn * (0.25 + 0.75 * s.trees) * (0.15 + 0.85 * (1 - smooth(200, 1800, alt))) * 0.9;
      if (rate > 0.02) {
        const pan = rand(-0.85, 0.85), far = Math.random();
        const species: BirdSpecies = s.season === 'summer' && Math.random() < 0.12 ? 'dove' : pick(['tweet', 'tweet', 'trill', 'whistle', 'warble'] as BirdSpecies[]);
        this.bird(now + 0.05, 0.1 + 0.3 * (1 - far) * (0.4 + 0.6 * close), pan, far, species);
        // sometimes an answer from another bird
        if (Math.random() < 0.3) this.bird(now + rand(0.5, 1.4), 0.08 + 0.12 * close, -pan * rand(0.5, 1), Math.min(1, far + 0.3), species);
        this.nextBird = now + rand(0.4, 2.2) / rate;
      } else this.nextBird = now + 1.5;
    }
    // passing cars when zoomed in on a busy city
    const traffic = clamp01(Math.log10(1 + s.vehicles) / 3.3);
    if (now >= this.nextPass) {
      const rate = traffic * smooth(900, 150, alt) * (s.paused ? 0 : 1) * (0.3 + 0.7 * s.urban) * 1.4;
      if (rate > 0.02) {
        this.passBy(now + 0.02, 0.05 + 0.1 * close * traffic);
        this.nextPass = now + rand(0.5, 1.6) / rate;
      } else this.nextPass = now + 1;
    }
    if (now >= this.nextHorn) {
      const busy = traffic * smooth(700, 150, alt) * (s.daylight > 0.3 ? 1 : 0.3) * (s.paused ? 0 : 1);
      if (busy > 0.3 && Math.random() < 0.5) this.horn(now + 0.05, 0.035 * busy);
      this.nextHorn = now + rand(18, 45);
    }
    // droplets when close to the ground in rain
    if (now >= this.nextDrop) {
      const rain = s.weather === 'rain' || s.weather === 'storm' ? Math.max(0.3, s.intensity) : 0;
      if (rain > 0 && alt < 1500) {
        this.droplet(now + 0.01, 0.04 * rain * (1 - smooth(200, 1500, alt)));
        this.nextDrop = now + rand(0.02, 0.12) / rain;
      } else this.nextDrop = now + 0.5;
    }
    // thunder during storms (unless the event system is already thundering)
    if (now >= this.nextThunder) {
      if (s.weather === 'storm' && now - this.externalThunderAt > 25) {
        this.thunder(rand(0.25, 0.9) * Math.max(0.5, s.intensity), rand(-0.7, 0.7));
        this.nextThunder = now + rand(8, 24) / Math.max(0.5, s.intensity);
      } else this.nextThunder = now + 4;
    }
  }

  private bird(t: number, amp: number, pan: number, far: number, species: BirdSpecies): void {
    const ctx = this.e.ctx;
    const g = gainNode(ctx, 1, this.birdBus);
    const lp = biquad(ctx, 'lowpass', 16000 * Math.pow(0.2, far), 0.5);
    const hp = biquad(ctx, 'highpass', species === 'dove' ? 200 : 1300, 0.7, lp);
    let last: AudioNode = lp;
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      lp.connect(p);
      last = p;
    }
    last.connect(g);
    const end = birdCall(this.e, hp, t, amp, species);
    setTimeout(() => {
      for (const n of [g, lp, hp, p]) n?.disconnect();
    }, (end - ctx.currentTime + 0.4) * 1000);
  }

  private passBy(t: number, amp: number): void {
    const ctx = this.e.ctx;
    const dur = rand(1.4, 2.8);
    const g = gainNode(ctx, 0, this.evBus);
    const bp = biquad(ctx, 'bandpass', 500, 0.9);
    const lp = biquad(ctx, 'lowpass', 2200, 0.5);
    bp.connect(lp);
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-0.9 * dir, t);
      p.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
      lp.connect(p);
      p.connect(g);
    } else lp.connect(g);
    // doppler-ish filter sweep and swell
    bp.frequency.setValueAtTime(rand(380, 520), t);
    bp.frequency.linearRampToValueAtTime(rand(1000, 1500), t + dur * 0.45);
    bp.frequency.linearRampToValueAtTime(rand(320, 450), t + dur);
    const end = ahr(g.gain, t, dur * 0.45, amp, 0.05, dur * 0.5);
    noise(ctx, this.e.noise.pink, t, end + 0.02, bp);
    setTimeout(() => {
      for (const n of [g, bp, lp, p]) n?.disconnect();
    }, (end - ctx.currentTime + 0.3) * 1000);
  }

  private horn(t: number, amp: number): void {
    const ctx = this.e.ctx;
    const g = gainNode(ctx, 0, this.evBus);
    const lp = biquad(ctx, 'lowpass', 1800, 0.8, g);
    const d = rand(0.15, 0.35);
    const end = ahr(g.gain, t, 0.01, amp, d, 0.05);
    const f = rand(380, 460);
    osc(ctx, 'square', f, t, end + 0.02, lp);
    osc(ctx, 'square', f * 1.26, t, end + 0.02, lp);
    if (Math.random() < 0.4) {
      const t2 = end + 0.08;
      const end2 = ahr(g.gain, t2, 0.01, amp, d * 0.7, 0.05);
      osc(ctx, 'square', f, t2, end2 + 0.02, lp);
      osc(ctx, 'square', f * 1.26, t2, end2 + 0.02, lp);
    }
    setTimeout(() => { g.disconnect(); lp.disconnect(); }, 2500);
  }

  private droplet(t: number, amp: number): void {
    const ctx = this.e.ctx;
    const g = gainNode(ctx, 0, this.evBus);
    const bp = biquad(ctx, 'bandpass', rand(2500, 6000), rand(4, 9), g);
    const end = ahr(g.gain, t, 0.001, amp, 0.002, rand(0.01, 0.03));
    noise(ctx, this.e.noise.white, t, end + 0.02, bp);
    setTimeout(() => { g.disconnect(); bp.disconnect(); }, 400);
  }

  private startCrickets(): void {
    const ctx = this.e.ctx;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const gain = gainNode(ctx, 0);
      let pan: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        pan.pan.value = -0.8 + (1.6 * i) / (n - 1) + rand(-0.1, 0.1);
        gain.connect(pan);
        pan.connect(this.cricketBus);
      } else gain.connect(this.cricketBus);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = rand(4300, 5200);
      o.connect(gain);
      o.start();
      this.crickets.push({ osc: o, gain, pan, next: ctx.currentTime + rand(0, 1), pulses: 3 + ((Math.random() * 3) | 0), rate: rand(0.45, 0.9) });
    }
  }

  private stopCrickets(): void {
    for (const c of this.crickets) {
      try {
        c.osc.stop();
      } catch {
        /* stopped */
      }
      c.osc.disconnect();
      c.gain.disconnect();
      c.pan?.disconnect();
    }
    this.crickets = [];
  }

  /** schedule cricket pulse trains slightly ahead of time */
  tickCrickets(now: number): void {
    for (const c of this.crickets) {
      while (c.next < now + 0.3) {
        const g = c.gain.gain;
        for (let p = 0; p < c.pulses; p++) {
          const at = c.next + p * 0.032;
          g.setValueAtTime(0, at);
          g.linearRampToValueAtTime(1, at + 0.004);
          g.linearRampToValueAtTime(0, at + 0.02);
        }
        c.next += c.rate * rand(0.85, 1.2);
        if (c.next < now) c.next = now + 0.05;
      }
    }
  }

  stop(): void {
    for (const l of [this.windA, this.windB, this.hum, this.traffic, this.rain, this.rainBody, this.waves]) l.stop();
    this.stopCrickets();
  }
}
