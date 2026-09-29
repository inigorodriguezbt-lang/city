// Synthesized sound effects. Each recipe schedules a small node graph at
// time `t` and returns when it ends. No samples, no files.
import type { SfxId } from './AudioManager';
import {
  ahr, biquad, driveCurve, gainNode, mtof, noise, osc, perc, pick, rand, voice,
  type NoiseBank, type Routing,
} from './dsp';

export interface SfxEnv extends Routing {
  noise: NoiseBank;
  /** cached waveshaper curve */
  drive: Float32Array<ArrayBuffer>;
}

export interface SfxOpts {
  /** -1..1 stereo position */
  pan?: number;
  /** 0 = close/bright … 1 = far/muffled */
  distance?: number;
}

type Recipe = (e: SfxEnv, t: number, vol: number, o: SfxOpts) => number;

const lpFor = (o: SfxOpts): number | undefined => (o.distance && o.distance > 0.02 ? 18000 * Math.pow(0.07, o.distance) : undefined);

/** additive bell: inharmonic partials with individual decays */
function bell(e: SfxEnv, dest: AudioNode, t: number, f: number, amp: number, decay: number, partials: [number, number, number][] = [[1, 1, 1], [2.76, 0.42, 0.55], [5.4, 0.2, 0.3], [8.93, 0.08, 0.18]], detune = 0): number {
  let end = t;
  for (const [ratio, a, d] of partials) {
    const fr = f * ratio;
    if (fr > Math.min(16000, e.ctx.sampleRate * 0.45)) continue;
    const g = gainNode(e.ctx, 0, dest);
    const stop = perc(g.gain, t, 0.002, amp * a, decay * d);
    osc(e.ctx, 'sine', fr, t, stop + 0.02, g, detune);
    end = Math.max(end, stop);
  }
  return end;
}

/** gentle FM "mallet": carrier sine with a fast-decaying modulator */
export function mallet(e: SfxEnv, dest: AudioNode, t: number, f: number, amp: number, decay: number, ratio = 3.5, index = 2.2): number {
  const ctx = e.ctx;
  const g = gainNode(ctx, 0, dest);
  const stop = perc(g.gain, t, 0.004, amp, decay);
  const car = osc(ctx, 'sine', f, t, stop + 0.02, g);
  const mg = gainNode(ctx, 0);
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.01, f * 0.02), t + Math.min(decay, 0.25));
  osc(ctx, 'sine', f * ratio, t, stop + 0.02, mg);
  mg.connect(car.frequency);
  return stop;
}

/** band-passed noise grain (debris, droplets, sparkle) */
function grain(e: SfxEnv, dest: AudioNode, t: number, freq: number, q: number, amp: number, dur: number, buf?: AudioBuffer): number {
  const ctx = e.ctx;
  const g = gainNode(ctx, 0, dest);
  const f = biquad(ctx, 'bandpass', freq, q, g);
  const stop = perc(g.gain, t, 0.001, amp, dur);
  noise(ctx, buf ?? e.noise.white, t, stop + 0.02, f);
  return stop;
}

// ── UI ──────────────────────────────────────────────────────────────────────
const click: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.5, { pan: o.pan, wet: 0.05 });
  const g = gainNode(e.ctx, 0, v.input);
  let end = perc(g.gain, t, 0.001, 0.32, 0.03);
  const ob = osc(e.ctx, 'sine', 1850, t, end + 0.02, g);
  ob.frequency.exponentialRampToValueAtTime(1500, t + 0.03);
  end = Math.max(end, grain(e, v.input, t, 4200, 0.8, 0.11, 0.012));
  finish(end);
  return end;
};

const hover: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.22, { pan: o.pan, wet: 0.03 });
  const g = gainNode(e.ctx, 0, v.input);
  const end = perc(g.gain, t, 0.003, 0.2, 0.025);
  osc(e.ctx, 'sine', 2900, t, end + 0.02, g);
  finish(end);
  return end;
};

function whoosh(e: SfxEnv, t: number, vol: number, o: SfxOpts, up: boolean): number {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.55, { pan: o.pan, wet: 0.28, lowpass: lpFor(o) });
  const dur = 0.3;
  const g = gainNode(ctx, 0, v.input);
  const bp = biquad(ctx, 'bandpass', up ? 520 : 2700, 1.1, g);
  bp.frequency.exponentialRampToValueAtTime(up ? 2800 : 480, t + dur);
  const end = ahr(g.gain, t, up ? 0.09 : 0.04, 0.5, 0.05, up ? 0.2 : 0.24);
  noise(ctx, e.noise.pink, t, end + 0.02, bp);
  // airy tonal lift
  const tg = gainNode(ctx, 0, v.input);
  perc(tg.gain, t, 0.03, 0.06, 0.24);
  const f0 = up ? 440 : 780, f1 = up ? 880 : 390;
  const a = osc(ctx, 'sine', f0, t, end + 0.02, tg);
  a.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  const b = osc(ctx, 'triangle', f0 * 1.5, t, end + 0.02, tg);
  b.frequency.exponentialRampToValueAtTime(f1 * 1.5, t + dur * 0.8);
  finish(end);
  return end;
}

// ── building tools ──────────────────────────────────────────────────────────
const place: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.62, { pan: o.pan, wet: 0.12, lowpass: lpFor(o) });
  // thunk body
  const g = gainNode(ctx, 0, v.input);
  let end = perc(g.gain, t, 0.002, 0.85, 0.26);
  const s = osc(ctx, 'sine', 170, t, end + 0.02, g);
  s.frequency.exponentialRampToValueAtTime(46, t + 0.14);
  const ng = gainNode(ctx, 0, v.input);
  const lp = biquad(ctx, 'lowpass', 900, 0.8, ng);
  end = Math.max(end, perc(ng.gain, t, 0.001, 0.45, 0.08));
  noise(ctx, e.noise.brown, t, end + 0.02, lp);
  // wood knock + click
  const k = gainNode(ctx, 0, v.input);
  end = Math.max(end, perc(k.gain, t + 0.004, 0.001, 0.18, 0.07));
  const tri = osc(ctx, 'triangle', 540, t + 0.004, end + 0.02, k);
  tri.frequency.exponentialRampToValueAtTime(420, t + 0.08);
  end = Math.max(end, grain(e, v.input, t + 0.014, 3400, 1.2, 0.16, 0.018));
  const c = gainNode(ctx, 0, v.input);
  end = Math.max(end, perc(c.gain, t + 0.014, 0.0008, 0.12, 0.02));
  osc(ctx, 'sine', 2350, t + 0.014, t + 0.06, c);
  finish(end);
  return end;
};

const road: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.75, { pan: o.pan, wet: 0.1, lowpass: lpFor(o) });
  // rolling rumble
  const g = gainNode(ctx, 0, v.input);
  const lp = biquad(ctx, 'lowpass', 280, 0.9, g);
  let end = ahr(g.gain, t, 0.04, 0.8, 0.2, 0.3);
  noise(ctx, e.noise.brown, t, end + 0.02, lp);
  // gravel crackle with a fast tremolo
  const cg = gainNode(ctx, 0, v.input);
  const trem = gainNode(ctx, 0.5, cg);
  const bp = biquad(ctx, 'bandpass', 1500, 0.7, trem);
  end = Math.max(end, ahr(cg.gain, t, 0.03, 0.2, 0.18, 0.22));
  noise(ctx, e.noise.white, t, end + 0.02, bp);
  const lfoG = gainNode(ctx, 0.5);
  lfoG.connect(trem.gain);
  osc(ctx, 'square', rand(18, 26), t, end + 0.02, lfoG);
  // compactor thump
  const s = gainNode(ctx, 0, v.input);
  end = Math.max(end, perc(s.gain, t, 0.02, 0.32, 0.45));
  osc(ctx, 'sine', 58, t, end + 0.02, s);
  finish(end);
  return end;
};

const zone: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.55, { pan: o.pan ?? rand(-0.3, 0.3), wet: 0.15, lowpass: lpFor(o) });
  let end = t;
  for (let i = 0; i < 2; i++) {
    const t0 = t + i * 0.05;
    const g = gainNode(ctx, 0, v.input);
    const hp = biquad(ctx, 'highpass', 700, 0.7, g);
    const bp = biquad(ctx, 'bandpass', i ? 1500 : 1900, 0.9, hp);
    bp.frequency.exponentialRampToValueAtTime(i ? 2600 : 3500, t0 + 0.2);
    end = Math.max(end, ahr(g.gain, t0, 0.05, i ? 0.22 : 0.35, 0.03, 0.15));
    noise(ctx, e.noise.pink, t0, end + 0.02, bp);
  }
  finish(end);
  return end;
};

const bulldoze: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.62, { pan: o.pan, wet: 0.18, lowpass: lpFor(o) });
  // impact
  const ig = gainNode(ctx, 0, v.input);
  let end = perc(ig.gain, t, 0.002, 0.85, 0.32);
  const s = osc(ctx, 'sine', 115, t, end + 0.02, ig);
  s.frequency.exponentialRampToValueAtTime(36, t + 0.22);
  // crunch
  const cg = gainNode(ctx, 0, v.input);
  const ws = ctx.createWaveShaper();
  ws.curve = e.drive;
  ws.connect(cg);
  const lp = biquad(ctx, 'lowpass', 2400, 0.7, ws);
  end = Math.max(end, perc(cg.gain, t, 0.003, 0.55, 0.26));
  noise(ctx, e.noise.white, t, end + 0.02, lp);
  // debris
  for (let i = 0; i < 10; i++) {
    const at = t + 0.05 + Math.pow(Math.random(), 1.4) * 0.7;
    const a = 0.3 * (1 - (at - t) / 0.9) + 0.04;
    end = Math.max(end, grain(e, v.input, at, rand(800, 4200), rand(2, 5), a, rand(0.02, 0.07)));
  }
  // dust hiss
  const dg = gainNode(ctx, 0, v.input);
  const hp = biquad(ctx, 'highpass', 2200, 0.7, dg);
  end = Math.max(end, ahr(dg.gain, t + 0.05, 0.1, 0.07, 0.1, 0.5));
  noise(ctx, e.noise.pink, t + 0.05, end + 0.02, hp);
  finish(end);
  return end;
};

const error: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.45, { pan: o.pan, wet: 0.05 });
  let end = t;
  const pulses: [number, number][] = [[0, 110], [0.15, 98]];
  for (const [dt, f] of pulses) {
    const g = gainNode(ctx, 0, v.input);
    const lp = biquad(ctx, 'lowpass', 720, 1.2, g);
    end = Math.max(end, ahr(g.gain, t + dt, 0.006, 0.35, 0.08, 0.05));
    osc(ctx, 'sawtooth', f, t + dt, end + 0.02, lp);
    osc(ctx, 'sawtooth', f * 1.059, t + dt, end + 0.02, lp);
    osc(ctx, 'square', f / 2, t + dt, end + 0.02, lp);
  }
  finish(end);
  return end;
};

const money: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.42, { pan: o.pan, wet: 0.25, lowpass: lpFor(o) });
  let end = bell(e, v.input, t, 1975.5, 0.5, 0.6);
  end = Math.max(end, bell(e, v.input, t + 0.075, 2637, 0.55, 0.9));
  end = Math.max(end, grain(e, v.input, t, 7500, 0.8, 0.12, 0.025));
  finish(end);
  return end;
};

// ── progression & notifications ────────────────────────────────────────────
/** brassy synth note (two detuned saws through an opening filter) */
function brass(e: SfxEnv, dest: AudioNode, t: number, f: number, amp: number, dur: number): number {
  const ctx = e.ctx;
  const g = gainNode(ctx, 0, dest);
  const lp = biquad(ctx, 'lowpass', 500, 1.4, g);
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.exponentialRampToValueAtTime(3400, t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(1500, t + 0.3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.025);
  g.gain.exponentialRampToValueAtTime(amp * 0.55, t + 0.25);
  g.gain.setValueAtTime(amp * 0.55, t + Math.max(0.26, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.26, dur) + 0.35);
  const end = t + Math.max(0.26, dur) + 0.36;
  osc(ctx, 'sawtooth', f, t, end, lp, -6);
  osc(ctx, 'sawtooth', f, t, end, lp, 7);
  osc(ctx, 'triangle', f / 2, t, end, lp);
  return end;
}

const milestone: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.5, { pan: o.pan, wet: 0.38 });
  // I – IV – V – I(add9), bright arpeggios over sustained brass chords
  const chords: { at: number; dur: number; notes: number[]; arp: number[] }[] = [
    { at: 0, dur: 0.5, notes: [48, 55, 64], arp: [60, 64, 67, 72] },
    { at: 0.52, dur: 0.5, notes: [53, 57, 65], arp: [65, 69, 72, 77] },
    { at: 1.04, dur: 0.5, notes: [55, 59, 67], arp: [67, 71, 74, 79] },
    { at: 1.58, dur: 1.5, notes: [48, 55, 64, 67, 74], arp: [72, 76, 79, 84] },
  ];
  let end = t;
  for (const c of chords) {
    for (const n of c.notes) end = Math.max(end, brass(e, v.input, t + c.at, mtof(n), 0.09, c.dur));
    c.arp.forEach((n, i) => {
      const at = t + c.at + i * 0.07;
      end = Math.max(end, mallet(e, v.input, at, mtof(n), 0.16, 0.55, 3.01, 1.4));
      end = Math.max(end, bell(e, v.input, at, mtof(n + 12), 0.05, 0.8));
    });
  }
  // timpani hits
  for (const at of [0, 1.58]) {
    const g = gainNode(ctx, 0, v.input);
    const stop = perc(g.gain, t + at, 0.004, 0.55, 0.7);
    const s = osc(ctx, 'sine', 70, t + at, stop + 0.02, g);
    s.frequency.exponentialRampToValueAtTime(58, t + at + 0.4);
    end = Math.max(end, grain(e, v.input, t + at, 180, 0.8, 0.25, 0.12, e.noise.brown));
  }
  // bell cascade + cymbal swell on the final chord
  [84, 88, 91, 96].forEach((n, i) => { end = Math.max(end, bell(e, v.input, t + 1.62 + i * 0.09, mtof(n), 0.09, 1.6)); });
  const cg = gainNode(ctx, 0, v.input);
  const hp = biquad(ctx, 'highpass', 5200, 0.7, cg);
  end = Math.max(end, ahr(cg.gain, t + 1.2, 0.38, 0.07, 0.05, 1.5));
  noise(ctx, e.noise.white, t + 1.2, end + 0.02, hp);
  finish(end);
  return end;
};

const achievement: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.4, { pan: o.pan, wet: 0.42 });
  let end = t;
  [88, 91, 93, 96, 100].forEach((n, i) => {
    const at = t + i * 0.055;
    end = Math.max(end, bell(e, v.input, at, mtof(n), 0.18, 0.9, [[1, 1, 1], [2, 0.3, 0.6], [3, 0.12, 0.4]], -4));
    end = Math.max(end, bell(e, v.input, at, mtof(n), 0.1, 0.9, [[1, 1, 1]], 5));
  });
  // soft chord bloom
  for (const n of [72, 76, 79]) {
    const g = gainNode(ctx, 0, v.input);
    const stop = ahr(g.gain, t + 0.2, 0.08, 0.05, 0.1, 1.1);
    osc(ctx, 'sine', mtof(n), t + 0.2, stop + 0.02, g);
    end = Math.max(end, stop);
  }
  const sg = gainNode(ctx, 0, v.input);
  const hp = biquad(ctx, 'highpass', 7000, 0.7, sg);
  end = Math.max(end, ahr(sg.gain, t, 0.05, 0.06, 0.1, 0.9));
  noise(ctx, e.noise.white, t, end + 0.02, hp);
  finish(end);
  return end;
};

const notice: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.36, { pan: o.pan, wet: 0.3 });
  let end = bell(e, v.input, t, mtof(84), 0.35, 0.7, [[1, 1, 1], [2, 0.16, 0.5], [3, 0.06, 0.3]]);
  end = Math.max(end, bell(e, v.input, t + 0.09, mtof(91), 0.22, 0.8, [[1, 1, 1], [2, 0.12, 0.5]]));
  finish(end);
  return end;
};

const warning: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.42, { pan: o.pan, wet: 0.12 });
  let end = t;
  const tones: [number, number, number][] = [[0, 880, 0.14], [0.17, 659.3, 0.22]];
  for (const [dt, f, d] of tones) {
    const g = gainNode(ctx, 0, v.input);
    const lp = biquad(ctx, 'lowpass', 2600, 0.7, g);
    const stop = ahr(g.gain, t + dt, 0.01, 0.34, d, 0.07);
    osc(ctx, 'triangle', f, t + dt, stop + 0.02, lp);
    const sq = gainNode(ctx, 0.22, lp);
    osc(ctx, 'square', f, t + dt, stop + 0.02, sq);
    end = Math.max(end, stop);
  }
  finish(end);
  return end;
};

const levelup: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.3, { pan: o.pan, wet: 0.3, lowpass: lpFor(o) });
  let end = t;
  [84, 88, 91].forEach((n, i) => { end = Math.max(end, mallet(e, v.input, t + i * 0.06, mtof(n), 0.25, 0.4, 4, 1.2)); });
  end = Math.max(end, grain(e, v.input, t + 0.12, 8000, 0.7, 0.07, 0.25));
  finish(end);
  return end;
};

// ── world / disasters ───────────────────────────────────────────────────────
const disaster: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.4, { pan: o.pan, wet: 0.42 });
  const dur = 4.2;
  // dark minor drone
  const g = gainNode(ctx, 0, v.input);
  const lp = biquad(ctx, 'lowpass', 120, 2, g);
  lp.frequency.setValueAtTime(120, t);
  lp.frequency.exponentialRampToValueAtTime(820, t + 1.7);
  lp.frequency.exponentialRampToValueAtTime(150, t + dur);
  let end = ahr(g.gain, t, 1.5, 0.42, 0.7, 1.9);
  for (const [f, d] of [[41.2, -8], [41.2, 9], [61.74, 0], [49, -5], [98, 6]] as [number, number][]) osc(ctx, 'sawtooth', f, t, end + 0.02, lp, d);
  const sub = gainNode(ctx, 0, v.input);
  ahr(sub.gain, t, 1.3, 0.45, 0.8, 1.9);
  osc(ctx, 'sine', 41.2, t, end + 0.02, sub);
  // rumble
  const rg = gainNode(ctx, 0, v.input);
  const rlp = biquad(ctx, 'lowpass', 260, 0.8, rg);
  end = Math.max(end, ahr(rg.gain, t, 1.2, 0.6, 0.6, 2.1));
  noise(ctx, e.noise.brown, t, end + 0.02, rlp);
  // tense high cluster
  const hg = gainNode(ctx, 0, v.input);
  ahr(hg.gain, t + 0.6, 1.6, 0.025, 0.4, 1.4);
  osc(ctx, 'sine', 311.1, t + 0.6, end + 0.02, hg);
  osc(ctx, 'sine', 329.6, t + 0.6, end + 0.02, hg);
  finish(end);
  return end;
};

const siren: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const dist = o.distance ?? 0.55;
  const { v, finish } = voice(e, vol * 0.3, { pan: o.pan ?? rand(-0.6, 0.6), wet: 0.35 + dist * 0.35, lowpass: 1500 + (1 - dist) * 5000 });
  const cycles = 3, per = 1.15;
  const dur = cycles * per;
  const g = gainNode(ctx, 0, v.input);
  const hp = biquad(ctx, 'highpass', 320, 0.7, g);
  const end = ahr(g.gain, t, 0.45, 0.45, dur - 1.1, 0.8);
  const a = osc(ctx, 'triangle', 640, t, end + 0.02, hp);
  const b = gainNode(ctx, 0.35, hp);
  const sq = osc(ctx, 'square', 640, t, end + 0.02, b);
  for (const oo of [a, sq]) {
    const f = oo.frequency;
    f.setValueAtTime(640, t);
    for (let c = 0; c < cycles + 1; c++) {
      f.linearRampToValueAtTime(1320, t + c * per + per * 0.55);
      f.linearRampToValueAtTime(640, t + (c + 1) * per);
    }
    // passing-by doppler drift
    oo.detune.setValueAtTime(35, t);
    oo.detune.linearRampToValueAtTime(-45, end);
  }
  finish(end);
  return end;
};

const thunder: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const near = Math.max(0, Math.min(1, 1 - (o.distance ?? 1 - Math.min(1, vol))));
  const { v, finish } = voice(e, Math.min(1, vol) * 0.5, { pan: o.pan ?? rand(-0.5, 0.5), wet: 0.5 });
  const delay = (1 - near) * 0.9;
  let end = t;
  // crack (only audible when close)
  if (near > 0.2) {
    const cg = gainNode(ctx, 0, v.input);
    const hp = biquad(ctx, 'highpass', 300 + near * 1600, 0.6, cg);
    end = perc(cg.gain, t + delay * 0.3, 0.002, 0.9 * near, 0.14 + near * 0.1);
    noise(ctx, e.noise.white, t + delay * 0.3, end + 0.02, hp);
  }
  // rolling rumble with irregular swells
  const rg = gainNode(ctx, 0, v.input);
  const lp = biquad(ctx, 'lowpass', 220 + near * 700, 0.7, rg);
  const t0 = t + delay;
  const len = 3.5 + Math.random() * 2;
  rg.gain.setValueAtTime(0.0001, t0);
  rg.gain.linearRampToValueAtTime(0.7, t0 + 0.12 + (1 - near) * 0.3);
  let tt = t0 + 0.3;
  while (tt < t0 + len - 0.6) {
    rg.gain.setTargetAtTime(rand(0.25, 0.85) * (1 - (tt - t0) / len), tt, 0.12);
    tt += rand(0.2, 0.55);
  }
  rg.gain.setTargetAtTime(0.0001, t0 + len - 0.6, 0.35);
  end = Math.max(end, t0 + len + 1.2);
  noise(ctx, e.noise.brown, t0, end, lp, 0.8);
  const sg = gainNode(ctx, 0, v.input);
  ahr(sg.gain, t0, 0.1, 0.3, 0.3, 2.4);
  osc(ctx, 'sine', 42, t0, end, sg);
  finish(end);
  return end;
};

const explosion: Recipe = (e, t, vol, o) => {
  const ctx = e.ctx;
  const { v, finish } = voice(e, vol * 0.52, { pan: o.pan, wet: 0.35, lowpass: lpFor(o) });
  const bg = gainNode(ctx, 0, v.input);
  let end = perc(bg.gain, t, 0.003, 1, 1.2);
  const s = osc(ctx, 'sine', 95, t, end + 0.02, bg);
  s.frequency.exponentialRampToValueAtTime(27, t + 0.8);
  const ng = gainNode(ctx, 0, v.input);
  const ws = ctx.createWaveShaper();
  ws.curve = e.drive;
  ws.connect(ng);
  const lp = biquad(ctx, 'lowpass', 5200, 0.6, ws);
  lp.frequency.exponentialRampToValueAtTime(170, t + 1.4);
  end = Math.max(end, perc(ng.gain, t, 0.002, 0.85, 1.6));
  noise(ctx, e.noise.white, t, end + 0.02, lp);
  const rg = gainNode(ctx, 0, v.input);
  const rlp = biquad(ctx, 'lowpass', 380, 0.7, rg);
  end = Math.max(end, ahr(rg.gain, t, 0.03, 0.65, 0.3, 2.0));
  noise(ctx, e.noise.brown, t, end + 0.02, rlp);
  for (let i = 0; i < 7; i++) end = Math.max(end, grain(e, v.input, t + rand(0.3, 1.5), rand(900, 3500), rand(2, 4), rand(0.05, 0.14), rand(0.03, 0.08)));
  finish(end);
  return end;
};

// ── birds ───────────────────────────────────────────────────────────────────
export type BirdSpecies = 'tweet' | 'whistle' | 'trill' | 'dove' | 'warble';

/** One procedural bird call into an existing destination. */
export function birdCall(e: SfxEnv, dest: AudioNode, t: number, amp: number, species: BirdSpecies = pick(['tweet', 'whistle', 'trill', 'warble'] as BirdSpecies[])): number {
  const ctx = e.ctx;
  let end = t;
  const syll = (at: number, f0: number, f1: number, f2: number, d: number, a: number, type: OscillatorType = 'sine') => {
    const g = gainNode(ctx, 0, dest);
    const stop = ahr(g.gain, at, d * 0.18, a, d * 0.45, d * 0.37);
    const o = osc(ctx, type, f0, at, stop + 0.02, g);
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + d * 0.45);
    o.frequency.exponentialRampToValueAtTime(f2, at + d);
    end = Math.max(end, stop);
  };
  switch (species) {
    case 'tweet': {
      const n = 2 + ((Math.random() * 3) | 0), base = rand(3200, 4300);
      for (let i = 0; i < n; i++) syll(t + i * rand(0.09, 0.13), base, base * rand(1.25, 1.5), base * rand(0.8, 0.95), rand(0.05, 0.08), amp);
      break;
    }
    case 'whistle': {
      const f = rand(2200, 3000);
      syll(t, f, f * 1.02, f * 1.35, 0.32, amp * 0.8);
      syll(t + 0.4, f * 1.3, f * 1.1, f * 0.95, 0.28, amp * 0.7);
      break;
    }
    case 'trill': {
      const f = rand(4200, 5600), n = 6 + ((Math.random() * 6) | 0);
      for (let i = 0; i < n; i++) syll(t + i * 0.045, f * 1.1, f, f * 0.92, 0.035, amp * (0.6 + 0.4 * Math.sin((i / n) * Math.PI)));
      break;
    }
    case 'warble': {
      const g = gainNode(ctx, 0, dest);
      const d = rand(0.45, 0.7);
      const stop = ahr(g.gain, t, 0.03, amp * 0.8, d - 0.1, 0.07);
      const f = rand(2600, 3600);
      const o = osc(ctx, 'sine', f, t, stop + 0.02, g);
      o.frequency.linearRampToValueAtTime(f * 1.25, t + d);
      const mg = gainNode(ctx, f * 0.12);
      osc(ctx, 'sine', rand(28, 45), t, stop + 0.02, mg);
      mg.connect(o.frequency);
      end = Math.max(end, stop);
      break;
    }
    case 'dove': {
      const f = rand(420, 520);
      const pattern = [[0, 0.32], [0.45, 0.2], [0.72, 0.42]];
      for (const [dt, d] of pattern) {
        const g = gainNode(ctx, 0, dest);
        const lp = biquad(ctx, 'lowpass', 900, 0.7, g);
        const stop = ahr(g.gain, t + dt, 0.06, amp * 0.7, d - 0.12, 0.08);
        const o = osc(ctx, 'sine', f, t + dt, stop + 0.02, lp);
        o.frequency.linearRampToValueAtTime(f * 1.08, t + dt + d * 0.3);
        o.frequency.linearRampToValueAtTime(f * 0.92, t + dt + d);
        end = Math.max(end, stop);
      }
      break;
    }
  }
  return end;
}

const chirp: Recipe = (e, t, vol, o) => {
  const { v, finish } = voice(e, vol * 0.32, { pan: o.pan ?? rand(-0.6, 0.6), wet: 0.2, lowpass: lpFor(o) });
  const hp = biquad(e.ctx, 'highpass', 1200, 0.7, v.input);
  const end = birdCall(e, hp, t, 0.5, pick(['tweet', 'tweet', 'trill', 'whistle'] as BirdSpecies[]));
  finish(end);
  return end;
};

export const RECIPES: Record<SfxId, Recipe> = {
  click, hover,
  open: (e, t, v, o) => whoosh(e, t, v, o, true),
  close: (e, t, v, o) => whoosh(e, t, v, o, false),
  place, road, zone, bulldoze, error, money,
  milestone, achievement, notice, warning, disaster, siren, thunder, explosion, chirp, levelup,
};

export function makeSfxEnv(r: Routing, bank: NoiseBank): SfxEnv {
  return { ...r, noise: bank, drive: driveCurve(3.2) };
}
