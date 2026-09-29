// Low-level WebAudio helpers: noise banks, generated reverb impulses,
// envelopes, voices with automatic cleanup. Everything is synthesized.

export interface NoiseBank {
  /** 2 s mono white noise */
  white: AudioBuffer;
  /** 6 s stereo pink noise (seamless loop) */
  pink: AudioBuffer;
  /** 6 s stereo brown noise (seamless loop) */
  brown: AudioBuffer;
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fill `out` with a generator, crossfading the head with the natural continuation so the buffer loops seamlessly. */
function fillLoop(out: Float32Array, next: () => number, fade: number): void {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = next();
  const f = Math.min(fade, n >> 2);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = out[i] * t + next() * (1 - t);
  }
}

function normalize(out: Float32Array, peak = 0.9): void {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
}

export function createNoiseBank(ctx: BaseAudioContext): NoiseBank {
  const sr = ctx.sampleRate;
  const white = ctx.createBuffer(1, Math.floor(sr * 2), sr);
  {
    const d = white.getChannelData(0);
    fillLoop(d, () => Math.random() * 2 - 1, Math.floor(sr * 0.01));
  }
  const pink = ctx.createBuffer(2, Math.floor(sr * 6), sr);
  for (let c = 0; c < 2; c++) {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const d = pink.getChannelData(c);
    fillLoop(d, () => {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return o * 0.11;
    }, Math.floor(sr * 0.25));
    normalize(d, 0.85);
  }
  const brown = ctx.createBuffer(2, Math.floor(sr * 6), sr);
  for (let c = 0; c < 2; c++) {
    let last = 0;
    const d = brown.getChannelData(c);
    fillLoop(d, () => {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      return last * 3.5;
    }, Math.floor(sr * 0.5));
    normalize(d, 0.85);
  }
  return { white, pink, brown };
}

/**
 * Stereo reverb impulse: exponentially decaying noise that darkens over time
 * (like air absorption), with a short pre-delay and a few early reflections.
 */
export function createImpulse(ctx: BaseAudioContext, seconds: number, opts: { decay?: number; predelay?: number; brightness?: number; early?: number } = {}): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const decay = opts.decay ?? 3;
  const pre = Math.floor(sr * (opts.predelay ?? 0.012));
  const bright = opts.brightness ?? 0.6;
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const env = Math.pow(1 - t, decay);
      // one-pole lowpass whose cutoff falls over the tail
      const a = 0.08 + bright * 0.9 * (1 - t) * (1 - t);
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // sparse early reflections
    const early = opts.early ?? 6;
    for (let k = 0; k < early; k++) {
      const at = pre + Math.floor(sr * rand(0.004, 0.06));
      if (at < len) d[at] += rand(-0.6, 0.6) * (1 - k / early);
    }
    normalize(d, 0.6);
  }
  return buf;
}

/** Soft-clip curve for WaveShaper grit. */
export function driveCurve(amount: number, n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const k = Math.max(0.001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** A periodic wave with a gentle 1/n^p harmonic roll-off (soft pads/brass). */
export function softWave(ctx: BaseAudioContext, harmonics = 24, rolloff = 1.6, oddBias = 0): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (1 / Math.pow(n, rolloff)) * (n % 2 === 1 ? 1 : 1 - oddBias);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// ── envelopes ───────────────────────────────────────────────────────────────
const EPS = 0.0001;

/** percussive: 0 → peak in `a`, exponential fall over `d` */
export function perc(p: AudioParam, t: number, a: number, peak: number, d: number): number {
  p.cancelScheduledValues(t);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(Math.max(EPS, peak), t + a);
  p.exponentialRampToValueAtTime(EPS, t + a + d);
  p.setValueAtTime(0, t + a + d + 0.01);
  return t + a + d + 0.01;
}

/** attack / hold / release (linear attack, exponential release) */
export function ahr(p: AudioParam, t: number, a: number, peak: number, hold: number, r: number): number {
  p.cancelScheduledValues(t);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(Math.max(EPS, peak), t + a);
  p.setValueAtTime(Math.max(EPS, peak), t + a + hold);
  p.exponentialRampToValueAtTime(EPS, t + a + hold + r);
  p.setValueAtTime(0, t + a + hold + r + 0.01);
  return t + a + hold + r + 0.01;
}

/** smooth target (no clicks) */
export function glide(p: AudioParam, value: number, t: number, tau = 0.08): void {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(value, t, Math.max(0.001, tau));
}

// ── voices ──────────────────────────────────────────────────────────────────
export interface VoiceOut {
  /** connect sources/filters here */
  input: GainNode;
  /** stop time of the longest part (for cleanup) */
  end: number;
}

export interface Routing {
  ctx: AudioContext;
  /** dry destination */
  dry: AudioNode;
  /** reverb send destination */
  wet: AudioNode;
}

/**
 * Create a voice: input → [lowpass] → panner → dry (+ wet send). All nodes are
 * disconnected automatically shortly after `end` (call `finish`).
 */
export function voice(r: Routing, gain: number, opts: { pan?: number; wet?: number; lowpass?: number } = {}): { v: VoiceOut; nodes: AudioNode[]; finish: (end: number) => void } {
  const { ctx } = r;
  const input = ctx.createGain();
  input.gain.value = gain;
  const nodes: AudioNode[] = [input];
  let last: AudioNode = input;
  if (opts.lowpass && opts.lowpass < 18000) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lowpass;
    lp.Q.value = 0.5;
    last.connect(lp);
    last = lp;
    nodes.push(lp);
  }
  if (opts.pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    last.connect(p);
    last = p;
    nodes.push(p);
  }
  last.connect(r.dry);
  if (opts.wet && opts.wet > 0) {
    const send = ctx.createGain();
    send.gain.value = opts.wet;
    last.connect(send);
    send.connect(r.wet);
    nodes.push(send);
  }
  const v: VoiceOut = { input, end: ctx.currentTime };
  const finish = (end: number) => {
    v.end = end;
    const ms = Math.max(50, (end - ctx.currentTime + 0.3) * 1000);
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }, ms);
  };
  return { v, nodes, finish };
}

export function osc(ctx: AudioContext, type: OscillatorType | PeriodicWave, freq: number, t0: number, t1: number, dest: AudioNode, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  if (type instanceof PeriodicWave) o.setPeriodicWave(type);
  else o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (detune) o.detune.setValueAtTime(detune, t0);
  o.connect(dest);
  o.start(t0);
  o.stop(t1);
  return o;
}

export function noise(ctx: AudioContext, buf: AudioBuffer, t0: number, t1: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t0, Math.random() * Math.max(0, buf.duration - 0.1));
  s.stop(t1);
  return s;
}

export function biquad(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.707, dest?: AudioNode): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (dest) f.connect(dest);
  return f;
}

export function gainNode(ctx: AudioContext, value: number, dest?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}
