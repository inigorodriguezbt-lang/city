// Generative ambient score: slowly evolving extended-chord progressions on
// soft detuned pads with a warm bass, plus a gentle FM "mallet" melody built
// from a motif that mutates as it repeats, through a filtered feedback delay
// and a long generated reverb. Moods: menu (wondrous, lydian), day (warm
// major), night (mellow dorian/aeolian). Everything is scheduled ahead of time
// on the AudioContext clock, so it never clicks or drifts.
import { ahr, biquad, gainNode, mtof, pick, rand, softWave, type Routing } from './dsp';
import { mallet, type SfxEnv } from './sfx';

export type MusicMood = 'menu' | 'day' | 'night';

interface MoodSpec {
  bpm: number;
  /** beats per chord */
  beats: number;
  progressions: number[][][];
  scale: number[];
  keys: number[];
  /** probability of a melody note per eighth */
  density: number;
  padCutoff: number;
  padLevel: number;
  bassLevel: number;
  melodyLevel: number;
  /** probability per chord of a high glass bell */
  bell: number;
}

// chord shapes (semitones from the key root)
const I9 = [0, 4, 7, 11, 14], Iadd9 = [0, 4, 7, 14], ii9 = [2, 5, 9, 12, 16], iii7 = [4, 7, 11, 14];
const IVmaj7 = [5, 9, 12, 16], IV9 = [5, 9, 12, 19], V69 = [7, 11, 14, 16], Vsus = [7, 12, 14, 19];
const vi9 = [9, 12, 16, 19, 23], vi7 = [9, 12, 16, 19], IIlyd = [2, 6, 9, 14];
const i9 = [0, 3, 7, 10, 14], iv9 = [5, 8, 12, 15, 19], bVImaj7 = [8, 12, 15, 19], bIIImaj7 = [3, 7, 10, 14];
const bVII6 = [10, 14, 17, 19], v7 = [7, 10, 14, 17], IVdor = [5, 9, 12, 15];

const MOODS: Record<MusicMood, MoodSpec> = {
  menu: {
    bpm: 62, beats: 8,
    progressions: [[I9, IIlyd, vi9, IVmaj7], [IVmaj7, I9, IIlyd, Vsus], [vi9, IV9, I9, IIlyd]],
    scale: [0, 2, 4, 6, 7, 9, 11], keys: [50, 52, 53, 55], density: 0.2, padCutoff: 1300, padLevel: 0.05, bassLevel: 0.1, melodyLevel: 0.14, bell: 0.35,
  },
  day: {
    bpm: 70, beats: 8,
    progressions: [[I9, V69, vi9, IVmaj7], [IV9, I9, ii9, Vsus], [vi7, IVmaj7, Iadd9, V69], [I9, iii7, vi9, IV9], [Iadd9, ii9, IVmaj7, Iadd9]],
    scale: [0, 2, 4, 7, 9], keys: [50, 52, 53, 55, 57], density: 0.27, padCutoff: 1500, padLevel: 0.045, bassLevel: 0.11, melodyLevel: 0.15, bell: 0.15,
  },
  night: {
    bpm: 56, beats: 8,
    progressions: [[i9, bVImaj7, bIIImaj7, bVII6], [i9, iv9, bVII6, bIIImaj7], [i9, IVdor, i9, bVII6], [bVImaj7, bVII6, i9, v7]],
    scale: [0, 3, 5, 7, 10, 14], keys: [48, 50, 52, 53, 55], density: 0.12, padCutoff: 850, padLevel: 0.05, bassLevel: 0.1, melodyLevel: 0.12, bell: 0.4,
  },
};

interface Step {
  /** scale-degree offset from the chord anchor */
  deg: number;
  vel: number;
}

export class Music {
  private out: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private delayIn: GainNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private wave: PeriodicWave;
  private running = false;
  private mood: MusicMood = 'menu';
  private spec: MoodSpec = MOODS.menu;
  private key = 50;
  private prog: number[][] = MOODS.menu.progressions[0];
  private chordIdx = 0;
  private reps = 0;
  private repsWanted = 2;
  private nextChordAt = 0;
  private prevVoicing: number[] | null = null;
  private motif: (Step | null)[] = [];
  private breath = false;
  private env: SfxEnv;
  /** notes currently scheduled (for meters/debug) */
  lastChord: number[] = [];

  constructor(private r: Routing, env: SfxEnv) {
    const ctx = r.ctx;
    this.env = env;
    this.out = gainNode(ctx, 0);
    this.dry = gainNode(ctx, 1, this.out);
    this.wet = gainNode(ctx, 1);
    this.out.connect(r.dry);
    this.wet.connect(r.wet);
    // feedback delay for the melody (dotted eighth), filtered each repeat
    this.delayIn = gainNode(ctx, 0.32);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.64;
    const fb = gainNode(ctx, 0.36);
    const lp = biquad(ctx, 'lowpass', 2600, 0.5);
    const hp = biquad(ctx, 'highpass', 280, 0.5);
    this.delayIn.connect(delay);
    delay.connect(lp);
    lp.connect(hp);
    hp.connect(fb);
    fb.connect(delay);
    hp.connect(this.dry);
    hp.connect(this.wet);
    // shared slow chorus LFO for pad detune
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.21;
    this.lfoGain = gainNode(ctx, 6);
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
    this.wave = softWave(ctx, 28, 1.75, 0.15);
    this.delayTime = delay.delayTime;
  }

  private delayTime: AudioParam;

  get playing(): boolean {
    return this.running;
  }

  get currentMood(): MusicMood {
    return this.mood;
  }

  setMood(m: MusicMood): void {
    this.mood = m;
  }

  start(): void {
    if (this.running) return;
    const ctx = this.r.ctx;
    this.running = true;
    const now = ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(1, now + 3);
    this.spec = MOODS[this.mood];
    this.key = pick(this.spec.keys);
    this.newPhrase();
    this.nextChordAt = now + 0.4;
  }

  stop(fade = 2): void {
    if (!this.running) return;
    this.running = false;
    const now = this.r.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fade);
  }

  /** schedule ahead; call every frame */
  update(): void {
    if (!this.running) return;
    const now = this.r.ctx.currentTime;
    if (this.nextChordAt < now - 0.25) this.nextChordAt = now + 0.1; // fell behind (tab throttled)
    let guard = 4;
    while (this.nextChordAt < now + 0.6 && guard-- > 0) this.scheduleChord(this.nextChordAt);
  }

  /** schedule everything up to context time `t` (offline rendering / previews) */
  scheduleUntil(t: number): void {
    if (!this.running) return;
    let guard = 256;
    while (this.nextChordAt < t && guard-- > 0) this.scheduleChord(this.nextChordAt);
  }

  // ── composition ──────────────────────────────────────────────────────────
  private newPhrase(): void {
    const s = this.spec;
    let p = pick(s.progressions);
    if (s.progressions.length > 1) while (p === this.prog) p = pick(s.progressions);
    this.prog = p;
    this.chordIdx = 0;
    this.reps = 0;
    this.repsWanted = Math.random() < 0.5 ? 2 : 3;
    this.motif = this.makeMotif();
  }

  private makeMotif(): (Step | null)[] {
    const steps: (Step | null)[] = new Array(16).fill(null);
    const d = this.spec.density;
    let deg = (Math.random() * 3) | 0;
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0 ? 1.6 : i % 2 === 0 ? 1 : 0.55;
      if (Math.random() < d * strong) {
        deg += pick([-2, -1, -1, 0, 1, 1, 2]);
        deg = Math.max(-2, Math.min(7, deg));
        steps[i] = { deg, vel: rand(0.55, 1) * (i % 4 === 0 ? 1 : 0.8) };
      }
    }
    if (!steps.some(Boolean)) steps[0] = { deg: 0, vel: 0.8 };
    return steps;
  }

  private mutateMotif(): void {
    const i = (Math.random() * 16) | 0;
    const cur = this.motif[i];
    if (cur && Math.random() < 0.4) this.motif[i] = null;
    else if (cur) cur.deg = Math.max(-2, Math.min(7, cur.deg + pick([-1, 1])));
    else if (Math.random() < this.spec.density * 2) this.motif[i] = { deg: (Math.random() * 5) | 0, vel: rand(0.5, 0.9) };
  }

  private voiceChord(offsets: number[]): number[] {
    const prev = this.prevVoicing;
    const center = prev ? (prev.reduce((a, b) => a + b, 0) / prev.length) * 0.7 + 62 * 0.3 : 62;
    const out: number[] = [];
    for (const off of offsets) {
      let n = this.key + off;
      while (n < center - 6) n += 12;
      while (n > center + 6) n -= 12;
      while (out.includes(n)) n += 12;
      out.push(n);
    }
    out.sort((a, b) => a - b);
    this.prevVoicing = out;
    return out;
  }

  private scheduleChord(t: number): void {
    // a new mood takes over at chord boundaries
    if (MOODS[this.mood] !== this.spec && this.chordIdx === 0) {
      this.spec = MOODS[this.mood];
      this.key = pick(this.spec.keys);
      this.newPhrase();
    }
    const s = this.spec;
    const beat = 60 / s.bpm;
    const dur = beat * s.beats;
    this.delayTime.setTargetAtTime(beat * 0.75, t, 0.5);
    if (this.breath) {
      // a breath between phrases: a soft drone on the root and fifth
      this.breath = false;
      const root = this.key + 12;
      this.pad(t, root - 12, dur * 0.8, s.padLevel * 0.7, s.padCutoff * 0.7, -0.2);
      this.pad(t, root - 5, dur * 0.8, s.padLevel * 0.5, s.padCutoff * 0.7, 0.2);
      if (Math.random() < 0.6) this.glass(t + beat * 2, root + 24 + pick([0, 7, 12]));
      this.nextChordAt = t + dur * 0.85;
      return;
    }
    const chord = this.prog[this.chordIdx];
    const voicing = this.voiceChord(chord);
    this.lastChord = voicing;
    // pads, spread across the stereo field
    voicing.forEach((n, i) => {
      const pan = voicing.length > 1 ? -0.55 + (1.1 * i) / (voicing.length - 1) : 0;
      this.pad(t, n, dur, s.padLevel * (i === 0 ? 0.9 : 1), s.padCutoff, pan);
    });
    // bass
    let b = this.key + chord[0];
    while (b > 47) b -= 12;
    while (b < 36) b += 12;
    this.bass(t, b, dur, s.bassLevel);
    // melody from the motif, snapped to chord tones on strong beats
    const eighth = beat / 2;
    const anchor = this.key + 12 + (chord[0] % 12);
    for (let i = 0; i < 16 && i * eighth < dur - eighth; i++) {
      const st = this.motif[i];
      if (!st) continue;
      let note = this.scaleNote(anchor, st.deg);
      if (i % 4 === 0) note = this.nearestChordTone(note, voicing);
      while (note < 66) note += 12;
      while (note > 86) note -= 12;
      const at = t + i * eighth + rand(-0.008, 0.012); // human feel
      this.pluck(at, note, s.melodyLevel * st.vel);
    }
    if (Math.random() < s.bell) this.glass(t + beat * pick([3, 5, 6]), pick(voicing) + 24);
    // advance
    this.chordIdx++;
    if (this.chordIdx >= this.prog.length) {
      this.chordIdx = 0;
      this.reps++;
      this.mutateMotif();
      if (Math.random() < 0.5) this.mutateMotif();
      if (this.reps >= this.repsWanted) {
        this.breath = Math.random() < 0.7;
        if (Math.random() < 0.45) {
          // modulate to a neighbouring key
          const k = this.key + pick([5, 7, -5, -7, 2, -2]);
          this.key = k < 47 ? k + 12 : k > 58 ? k - 12 : k;
        }
        this.newPhrase();
      }
    }
    this.nextChordAt = t + dur;
  }

  private scaleNote(anchor: number, deg: number): number {
    const sc = this.spec.scale;
    const n = sc.length;
    const oct = Math.floor(deg / n);
    const idx = ((deg % n) + n) % n;
    return anchor + sc[idx] + oct * 12;
  }

  private nearestChordTone(note: number, voicing: number[]): number {
    let best = note, bd = 99;
    for (const v of voicing) {
      for (let o = -24; o <= 36; o += 12) {
        const c = v + o;
        const d = Math.abs(c - note);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }

  // ── instruments ──────────────────────────────────────────────────────────
  private pad(t: number, note: number, dur: number, level: number, cutoff: number, pan: number): void {
    const ctx = this.r.ctx;
    const f = mtof(note);
    const attack = Math.min(2.8, dur * 0.35), release = Math.min(4, dur * 0.6);
    const end = t + dur + release;
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const lp = biquad(ctx, 'lowpass', cutoff * 0.55, 0.6, g);
    lp.frequency.setValueAtTime(cutoff * 0.55, t);
    lp.frequency.linearRampToValueAtTime(cutoff * (0.9 + Math.random() * 0.25), t + attack * 1.2);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.6, end);
    let last: AudioNode = g;
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      last = p;
    }
    last.connect(this.dry);
    const send = gainNode(ctx, 0.6, this.wet);
    last.connect(send);
    const oscs: OscillatorNode[] = [];
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = f;
      o.detune.value = det;
      this.lfoGain.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.05);
      oscs.push(o);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    const sg = gainNode(ctx, 0.35, lp);
    sub.connect(sg);
    sub.start(t);
    sub.stop(end + 0.05);
    oscs[0].onended = () => {
      for (const o of oscs) {
        try { this.lfoGain.disconnect(o.detune); } catch { /* gone */ }
        o.disconnect();
      }
      for (const n of [sub, sg, lp, g, p, send]) n?.disconnect();
    };
  }

  private bass(t: number, note: number, dur: number, level: number): void {
    const ctx = this.r.ctx;
    const f = mtof(note);
    const g = gainNode(ctx, 0, this.dry);
    const lp = biquad(ctx, 'lowpass', 420, 0.7, g);
    const end = ahr(g.gain, t, 0.7, level, Math.max(0, dur - 0.9), 2.2);
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = f;
    a.connect(lp);
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = f * 2;
    const bg = gainNode(ctx, 0.18, lp);
    b.connect(bg);
    a.start(t);
    b.start(t);
    a.stop(end + 0.05);
    b.stop(end + 0.05);
    a.onended = () => { for (const n of [a, b, bg, lp, g]) n.disconnect(); };
  }

  private pluck(t: number, note: number, level: number): void {
    const ctx = this.r.ctx;
    const g = gainNode(ctx, 1);
    let last: AudioNode = g;
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      p.pan.value = rand(-0.45, 0.45);
      g.connect(p);
      last = p;
    }
    last.connect(this.dry);
    last.connect(this.delayIn);
    const send = gainNode(ctx, 0.5, this.wet);
    last.connect(send);
    const end = mallet(this.env, g, t, mtof(note), level, rand(1.1, 1.8), pick([3.5, 4, 2.01]), rand(1.2, 2.2));
    setTimeout(() => { for (const n of [g, p, send]) n?.disconnect(); }, (end - ctx.currentTime + 0.5) * 1000);
  }

  private glass(t: number, note: number): void {
    const ctx = this.r.ctx;
    const g = gainNode(ctx, 1, this.wet);
    g.connect(this.delayIn);
    const dry = gainNode(ctx, 0.35, this.dry);
    g.connect(dry);
    const end = mallet(this.env, g, t, mtof(note), 0.05, 3.2, 2.76, 0.9);
    setTimeout(() => { g.disconnect(); dry.disconnect(); }, (end - ctx.currentTime + 0.5) * 1000);
  }

  dispose(): void {
    this.stop(0.1);
    try {
      this.lfo.stop();
    } catch {
      /* stopped */
    }
  }
}
