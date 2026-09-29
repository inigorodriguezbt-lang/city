// ─────────────────────────────────────────────────────────────────────────────
// SkylineBackground: a cheap but lush 2D-canvas backdrop for the main menu and
// loading screen. A procedural waterfront city at dusk slowly sinking into
// night: gradient sky, sunset glow, stars and moon, drifting clouds, three
// parallax skyline layers with lit windows that twinkle, beacon lights, a
// suspension bridge with moving traffic, aircraft, and a rippling reflection.
//
// Performance: every static element is pre-rendered once per resize into a few
// offscreen strips; a frame is ~20 drawImage calls + a reflection pass, capped
// at 30 fps, paused when hidden. Reduced motion renders a single still frame.
// ─────────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const hex = (s: string): RGB => {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** sky gradient stops (0 = zenith … 1 = horizon) for dusk and night */
const SKY_DUSK = ['#1a2152', '#3b3574', '#8b4f8a', '#e2766c', '#ffb46e'].map(hex);
const SKY_NIGHT = ['#03060f', '#081029', '#111b42', '#1d2856', '#303a6c'].map(hex);
const SKY_POS = [0, 0.34, 0.62, 0.86, 1];
const WATER_DUSK = [hex('#6a4677'), hex('#171330')];
const WATER_NIGHT = [hex('#18204a'), hex('#03060e')];
const WIN_COLORS = ['#ffd89a', '#ffe6b5', '#ffcf86', '#fff1d0', '#cfe4ff', '#a9d8ff', '#ffb877', '#9ff0ff'].map(hex);

interface LayerSpec {
  /** building height range (fraction of horizon height) */
  minH: number;
  maxH: number;
  /** downtown bump height & width (fraction) */
  peak: number;
  widthMin: number;
  widthMax: number;
  color: string;
  /** window cell size in css px */
  win: [number, number, number, number];
  lit: number;
  haze: number;
  depth: number;
}

const LAYERS: LayerSpec[] = [
  { minH: 0.08, maxH: 0.2, peak: 0.26, widthMin: 16, widthMax: 44, color: '#2a2c55', win: [1.2, 1.6, 3.6, 4.6], lit: 0.34, haze: 0.62, depth: 0.25 },
  { minH: 0.06, maxH: 0.2, peak: 0.44, widthMin: 20, widthMax: 58, color: '#171a3a', win: [1.8, 2.4, 5, 6.4], lit: 0.4, haze: 0.34, depth: 0.55 },
  { minH: 0.04, maxH: 0.15, peak: 0.34, widthMin: 26, widthMax: 74, color: '#0b0d22', win: [2.6, 3.4, 7, 9], lit: 0.42, haze: 0.12, depth: 1 },
];

interface Twinkle { x: number; y: number; w: number; h: number; c: RGB; ph: number; sp: number }
interface Beacon { x: number; y: number; ph: number; r: number }
interface Layer {
  spec: LayerSpec;
  sil: HTMLCanvasElement;
  win: HTMLCanvasElement;
  /** strip top (css px, screen space) */
  top: number;
  twinkles: Twinkle[];
  beacons: Beacon[];
}
interface Cloud { x: number; y: number; s: number; sp: number; a: number; dusk: HTMLCanvasElement; night: HTMLCanvasElement }
interface Star { x: number; y: number; r: number; ph: number; sp: number }
interface Plane { x: number; y: number; vx: number; t: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number }

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export class SkylineBackground {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private horizon = 0;
  private margin = 0;
  private layers: Layer[] = [];
  private starsImg: HTMLCanvasElement | null = null;
  private moonImg: HTMLCanvasElement | null = null;
  private stars: Star[] = [];
  private clouds: Cloud[] = [];
  private bridge = { x0: 0, x1: 0, y: 0, lanes: [] as { x: number; v: number; c: RGB }[] };
  private bay: [number, number] = [0, 0];
  private refl: HTMLCanvasElement | null = null;
  private plane: Plane | null = null;
  private nextPlane = 6;
  private meteor: Meteor | null = null;
  private nextMeteor = 14;
  private running = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  /** seconds of animation time; phase cycles dusk → night → dusk */
  private t = 0;
  private mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  private ro: ResizeObserver | null = null;
  /** render a still frame only (reduced motion) */
  reduced = false;
  /** optional fixed phase 0 (dusk) .. 1 (night) */
  fixedPhase: number | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mn-sky';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    // start in late dusk: colourful sky with the city lights already on
    this.t = 150 * 0.21;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    if (typeof ResizeObserver !== 'undefined' && !this.ro) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.last = performance.now();
    this.draw();
    if (!this.reduced) this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointer);
    this.ro?.disconnect();
    this.ro = null;
  }

  setReduced(r: boolean): void {
    if (r === this.reduced) return;
    this.reduced = r;
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    this.draw();
    if (!r) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  private onResize = (): void => this.resize();

  private onPointer = (e: PointerEvent): void => {
    this.mouse.tx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    this.mouse.ty = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  };

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.acc += dt;
    if (this.acc < 1 / 31) return;
    const step = this.acc;
    this.acc = 0;
    this.t += step;
    this.tick(step);
    this.draw();
  };

  /** phase 0 = dusk, 1 = night */
  private phase(): number {
    if (this.fixedPhase !== null) return this.fixedPhase;
    return 0.5 - 0.5 * Math.cos((this.t / 150) * Math.PI * 2);
  }

  // ── setup ────────────────────────────────────────────────────────────────
  resize(): void {
    const rw = window.innerWidth;
    const rh = window.innerHeight;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (rw === this.w && rh === this.h && dpr === this.dpr && this.layers.length) return;
    this.w = rw;
    this.h = rh;
    this.dpr = dpr;
    this.canvas.width = Math.round(rw * dpr);
    this.canvas.height = Math.round(rh * dpr);
    // horizon a bit lower on portrait screens so the skyline stays grand
    this.horizon = Math.round(rh * (rw < rh ? 0.7 : 0.74));
    this.margin = Math.round(Math.max(40, rw * 0.04));
    this.build();
    if (this.running) this.draw();
  }

  private build(): void {
    const { w, horizon, dpr, margin } = this;
    const sw = w + margin * 2;
    // downtown cluster centre: right of the menu column on wide screens
    const cx = w < 720 ? 0.55 : 0.66;
    // the bridge crosses an open bay left of downtown (strip-local x range)
    this.bay = w < 720 ? [margin - w * 0.3, margin + w * 0.42] : [margin - w * 0.05, margin + w * 0.43];
    this.layers = LAYERS.map((spec, li) => this.buildLayer(spec, li, sw, cx));
    // stars
    const sh = horizon * 0.85;
    const stars = makeCanvas(w * dpr, sh * dpr);
    const sc = stars.getContext('2d')!;
    sc.scale(dpr, dpr);
    const n = Math.round((w * sh) / 2600);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w;
      const y = Math.pow(Math.random(), 1.6) * sh;
      const a = (0.25 + Math.random() * 0.75) * (1 - y / sh);
      const r = Math.random() < 0.06 ? 1.2 : Math.random() < 0.3 ? 0.8 : 0.55;
      sc.fillStyle = `rgba(${220 + Math.random() * 35 | 0},${225 + Math.random() * 30 | 0},255,${a})`;
      sc.beginPath();
      sc.arc(x, y, r, 0, Math.PI * 2);
      sc.fill();
    }
    this.starsImg = stars;
    this.stars = [];
    for (let i = 0; i < 46; i++) this.stars.push({ x: Math.random() * w, y: Math.pow(Math.random(), 1.8) * sh * 0.8, r: rand(0.8, 1.6), ph: Math.random() * 6.28, sp: rand(0.6, 2.2) });
    // moon (crescent with glow)
    const mr = Math.max(12, Math.min(26, w * 0.014));
    const moon = makeCanvas(mr * 8 * dpr, mr * 8 * dpr);
    const mc = moon.getContext('2d')!;
    mc.scale(dpr, dpr);
    const c0 = mr * 4;
    const glow = mc.createRadialGradient(c0, c0, mr * 0.6, c0, c0, mr * 4);
    glow.addColorStop(0, 'rgba(210,225,255,0.35)');
    glow.addColorStop(0.35, 'rgba(160,180,255,0.1)');
    glow.addColorStop(1, 'rgba(120,140,255,0)');
    mc.fillStyle = glow;
    mc.fillRect(0, 0, mr * 8, mr * 8);
    const disc = makeCanvas(mr * 2.4 * dpr, mr * 2.4 * dpr);
    const dc = disc.getContext('2d')!;
    dc.scale(dpr, dpr);
    const dg = dc.createRadialGradient(mr * 1.05, mr * 1.05, 0, mr * 1.2, mr * 1.2, mr);
    dg.addColorStop(0, '#fbf8ee');
    dg.addColorStop(1, '#dcdcd0');
    dc.fillStyle = dg;
    dc.beginPath();
    dc.arc(mr * 1.2, mr * 1.2, mr, 0, Math.PI * 2);
    dc.fill();
    dc.globalCompositeOperation = 'destination-out';
    dc.beginPath();
    dc.arc(mr * 1.2 + mr * 0.62, mr * 1.2 - mr * 0.28, mr * 0.92, 0, Math.PI * 2);
    dc.fill();
    mc.drawImage(disc, (c0 - mr * 1.2), (c0 - mr * 1.2), mr * 2.4, mr * 2.4);
    this.moonImg = moon;
    // clouds
    this.clouds = [];
    const nc = Math.max(5, Math.round(w / 230));
    for (let i = 0; i < nc; i++) {
      const s = rand(0.6, 1.25);
      this.clouds.push({ x: rand(-0.2, 1.1) * w, y: rand(0.08, 0.5) * horizon, s, sp: rand(3, 9) * s, a: rand(0.45, 0.8), ...this.makeCloud(s) });
    }
    this.clouds.sort((a, b) => a.y - b.y);
  }

  /** soft cloud sprite, pre-tinted for dusk (lit from below) and night */
  private makeCloud(s: number): { dusk: HTMLCanvasElement; night: HTMLCanvasElement } {
    const { dpr } = this;
    const cw = 420 * s;
    const ch = 110 * s;
    const mask = makeCanvas(cw * dpr, ch * dpr);
    const g = mask.getContext('2d')!;
    g.scale(dpr, dpr);
    const puffs = 7 + Math.floor(Math.random() * 6);
    for (let i = 0; i < puffs; i++) {
      const px = cw * (0.15 + (i / puffs) * 0.7 + rand(-0.05, 0.05));
      const py = ch * rand(0.45, 0.7);
      const r = ch * rand(0.18, 0.42) * (1 - Math.abs(i / puffs - 0.5) * 0.7);
      const rg = g.createRadialGradient(px, py, 0, px, py, r * 2.2);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)');
      rg.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
    }
    // soften the flat base
    g.globalCompositeOperation = 'destination-out';
    const base = g.createLinearGradient(0, ch * 0.62, 0, ch);
    base.addColorStop(0, 'rgba(0,0,0,0)');
    base.addColorStop(1, 'rgba(0,0,0,0.9)');
    g.fillStyle = base;
    g.fillRect(0, 0, cw, ch);
    const tint = (top: string, bottom: string) => {
      const c = makeCanvas(mask.width, mask.height);
      const x = c.getContext('2d')!;
      x.drawImage(mask, 0, 0);
      x.globalCompositeOperation = 'source-in';
      const lg = x.createLinearGradient(0, 0, 0, c.height);
      lg.addColorStop(0, top);
      lg.addColorStop(1, bottom);
      x.fillStyle = lg;
      x.fillRect(0, 0, c.width, c.height);
      return c;
    };
    return { dusk: tint('#9a7cc0', '#ffb89a'), night: tint('#323d6c', '#4a5688') };
  }

  private buildLayer(spec: LayerSpec, li: number, sw: number, cx: number): Layer {
    const { horizon, dpr, margin, w } = this;
    const maxH = horizon * (spec.maxH + spec.peak) + 30;
    const top = horizon - maxH;
    const sil = makeCanvas(sw * dpr, maxH * dpr);
    const win = makeCanvas(sw * dpr, maxH * dpr);
    const s = sil.getContext('2d')!;
    const wc = win.getContext('2d')!;
    s.scale(dpr, dpr);
    wc.scale(dpr, dpr);
    s.fillStyle = spec.color;
    s.strokeStyle = spec.color;
    const twinkles: Twinkle[] = [];
    const beacons: Beacon[] = [];
    const base = maxH; // strip-local y of the waterline
    const [ww, wh, sx, sy] = spec.win;
    let x = -rand(0, 20);
    while (x < sw) {
      const bw = rand(spec.widthMin, spec.widthMax) * (w < 720 ? 0.8 : 1);
      const fx = (x - margin + bw / 2) / w;
      // gaussian downtown bump + a gentle secondary cluster
      const bump = Math.exp(-Math.pow((fx - cx) / 0.13, 2)) + 0.45 * Math.exp(-Math.pow((fx - 0.2) / 0.1, 2));
      let bh = horizon * (rand(spec.minH, spec.maxH) + spec.peak * bump * rand(0.45, 1));
      const tall = bh > horizon * (spec.maxH + spec.peak * 0.45);
      if (Math.random() < 0.12) bh *= 0.55;
      if (li === 2 && x + bw > this.bay[0] + 40 && x < this.bay[1] - 30) {
        x += bw;
        continue;
      }
      const bx = x;
      const by = base - bh;
      // body
      s.fillRect(bx, by, bw, bh + 2);
      // roof variants
      const roll = Math.random();
      let roofTop = by;
      if (tall && roll < 0.3) {
        // spire
        s.beginPath();
        s.moveTo(bx + bw * 0.28, by);
        s.lineTo(bx + bw * 0.5, by - bh * 0.16);
        s.lineTo(bx + bw * 0.72, by);
        s.fill();
        roofTop = by - bh * 0.16;
        s.fillRect(bx + bw * 0.5 - 0.6, roofTop - bh * 0.07, 1.2, bh * 0.07);
        roofTop -= bh * 0.07;
      } else if (tall && roll < 0.55) {
        // art-deco setbacks
        const t1 = bh * 0.08;
        s.fillRect(bx + bw * 0.12, by - t1, bw * 0.76, t1);
        s.fillRect(bx + bw * 0.26, by - t1 * 2, bw * 0.48, t1);
        s.fillRect(bx + bw * 0.4, by - t1 * 2.9, bw * 0.2, t1 * 0.9);
        roofTop = by - t1 * 2.9;
      } else if (roll < 0.62) {
        // antenna mast
        const ah = rand(0.06, 0.16) * bh;
        s.fillRect(bx + bw * 0.5 - 0.7, by - ah, 1.4, ah);
        roofTop = by - ah;
      } else if (roll < 0.72) {
        // slanted crown
        s.beginPath();
        s.moveTo(bx, by);
        s.lineTo(bx + bw, by - bw * 0.45);
        s.lineTo(bx + bw, by);
        s.fill();
        roofTop = by - bw * 0.45;
      } else if (roll < 0.78 && !tall) {
        // dome
        s.beginPath();
        s.ellipse(bx + bw / 2, by, bw * 0.34, bw * 0.3, 0, Math.PI, 0);
        s.fill();
        roofTop = by - bw * 0.3;
      } else if (roll < 0.9 && li === 2 && !tall) {
        // rooftop water tower
        const tx = bx + bw * rand(0.2, 0.6);
        s.fillRect(tx, by - 9, 1, 9);
        s.fillRect(tx + 8, by - 9, 1, 9);
        s.fillRect(tx - 1, by - 17, 11, 9);
        s.beginPath();
        s.moveTo(tx - 1.5, by - 17);
        s.lineTo(tx + 4.5, by - 21);
        s.lineTo(tx + 10.5, by - 17);
        s.fill();
      } else {
        // rooftop boxes
        if (Math.random() < 0.6) s.fillRect(bx + bw * rand(0.1, 0.5), by - rand(2, 5), bw * rand(0.2, 0.4), 6);
      }
      if (tall && li > 0 && Math.random() < 0.8) beacons.push({ x: bx + bw * 0.5, y: roofTop - 1 + top, ph: Math.random() * 6.28, r: li === 2 ? 2.2 : 1.6 });

      // windows
      const style = Math.random();
      const occupancy = spec.lit * rand(0.35, 1.45);
      const m = Math.max(2, sx * 0.6);
      if (style < 0.14 && bh > horizon * 0.12) {
        // vertical light strips (modern glass tower)
        const c = WIN_COLORS[4 + Math.floor(Math.random() * 3)];
        wc.fillStyle = css(c, 0.5);
        const cols = Math.max(1, Math.floor((bw - m * 2) / (sx * 1.6)));
        for (let i = 0; i < cols; i++) wc.fillRect(bx + m + i * sx * 1.6 + sx * 0.4, by + m, Math.max(0.8, ww * 0.5), bh - m * 2);
      } else {
        const cols = Math.floor((bw - m * 2 + (sx - ww)) / sx);
        const rows = Math.floor((bh - m * 1.5) / sy);
        const warm = Math.random() < 0.72;
        const ox = bx + (bw - (cols * sx - (sx - ww))) / 2;
        for (let r = 0; r < rows; r++) {
          // whole floors tend to be lit together
          const floor = Math.random() < 0.3 ? 1.8 : Math.random() < 0.3 ? 0.2 : 1;
          for (let c = 0; c < cols; c++) {
            const wx = ox + c * sx;
            const wy = by + m + r * sy;
            if (wy + wh > base - 2) continue;
            const on = Math.random() < occupancy * floor;
            const col = warm ? WIN_COLORS[Math.floor(Math.random() * 4)] : WIN_COLORS[3 + Math.floor(Math.random() * 5)];
            if (!on) {
              if (li > 0 && Math.random() < 0.012) twinkles.push({ x: wx, y: wy + top, w: ww, h: wh, c: col, ph: Math.random() * 6.28, sp: rand(0.05, 0.25) });
              continue;
            }
            wc.fillStyle = css(col, rand(0.55, 1));
            wc.fillRect(wx, wy, ww, wh);
          }
        }
      }
      x += bw + (Math.random() < 0.18 ? rand(1, 8) : 0);
    }

    // suspension bridge in front of the near layer (left of downtown)
    if (li === 2) this.buildBridge(s, wc, base, top, beacons);
    return { spec, sil, win, top, twinkles, beacons };
  }

  private buildBridge(s: CanvasRenderingContext2D, wc: CanvasRenderingContext2D, base: number, top: number, beacons: Beacon[]): void {
    const { w, horizon, margin } = this;
    const [x0, x1] = this.bay;
    const deckY = base - horizon * 0.06;
    const towerH = horizon * 0.25;
    const t1 = x0 + (x1 - x0) * 0.22;
    const t2 = x0 + (x1 - x0) * 0.78;
    s.save();
    // deck
    s.fillRect(x0, deckY, x1 - x0, 3.2);
    // piers
    for (let px = x0 + 30; px < x1; px += 90) s.fillRect(px, deckY, 3, base - deckY);
    // towers (twin legs with cross beams)
    for (const tx of [t1, t2]) {
      s.fillRect(tx - 5, deckY - towerH, 3.2, towerH + (base - deckY));
      s.fillRect(tx + 2, deckY - towerH, 3.2, towerH + (base - deckY));
      for (let k = 0; k < 3; k++) s.fillRect(tx - 5, deckY - towerH + 6 + k * towerH * 0.3, 10.2, 2.4);
      beacons.push({ x: tx, y: deckY - towerH - 2 + top, ph: Math.random() * 6.28, r: 2.4 });
    }
    // main cables: centre span sags between the towers, side spans run to deck anchors
    s.lineWidth = 1.3;
    s.strokeStyle = s.fillStyle as string;
    const topY = deckY - towerH + 1;
    const span = (ax: number, ay: number, bx: number, by: number, sag: number) => {
      s.beginPath();
      s.moveTo(ax, ay);
      s.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag, bx, by);
      s.stroke();
    };
    span(t1, topY, t2, topY, towerH * 1.8);
    span(x0, deckY, t1, topY, towerH * 0.25);
    span(t2, topY, x1, deckY, towerH * 0.25);
    s.lineWidth = 0.6;
    s.globalAlpha = 0.7;
    for (let sx = t1 + 12; sx < t2 - 6; sx += 12) {
      const u = (sx - t1) / (t2 - t1);
      const cy = topY + 2 * u * (1 - u) * towerH * 1.8;
      s.beginPath();
      s.moveTo(sx, cy);
      s.lineTo(sx, deckY);
      s.stroke();
    }
    s.restore();
    // deck lamps
    for (let lx = x0 + 6; lx < x1; lx += 13) {
      wc.fillStyle = 'rgba(255,214,150,0.95)';
      wc.fillRect(lx, deckY - 2.2, 1.6, 1.6);
    }
    // traffic lanes
    this.bridge = {
      x0, x1, y: deckY + top, lanes: [],
    };
    for (let i = 0; i < 16; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      this.bridge.lanes.push({ x: rand(x0, x1), v: dir * rand(16, 28), c: dir > 0 ? [255, 244, 220] : [255, 70, 55] });
    }
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  private tick(dt: number): void {
    const { w } = this;
    this.mouse.x += (this.mouse.tx - this.mouse.x) * Math.min(1, dt * 2.5);
    this.mouse.y += (this.mouse.ty - this.mouse.y) * Math.min(1, dt * 2.5);
    for (const c of this.clouds) {
      c.x -= c.sp * dt;
      const cw = c.dusk.width / this.dpr;
      if (c.x + cw < -40) c.x = w + rand(20, 200);
    }
    const b = this.bridge;
    for (const l of b.lanes) {
      l.x += l.v * dt;
      if (l.x > b.x1) l.x = b.x0;
      if (l.x < b.x0) l.x = b.x1;
    }
    // aircraft
    this.nextPlane -= dt;
    if (!this.plane && this.nextPlane <= 0) {
      const ltr = Math.random() < 0.5;
      this.plane = { x: ltr ? -30 : w + 30, y: rand(0.08, 0.3) * this.horizon, vx: (ltr ? 1 : -1) * rand(22, 38), t: 0 };
    }
    if (this.plane) {
      this.plane.x += this.plane.vx * dt;
      this.plane.t += dt;
      if (this.plane.x < -60 || this.plane.x > w + 60) {
        this.plane = null;
        this.nextPlane = rand(18, 40);
      }
    }
    // shooting stars at night
    this.nextMeteor -= dt;
    if (!this.meteor && this.nextMeteor <= 0 && this.phase() > 0.55) {
      this.meteor = { x: rand(0.2, 0.9) * w, y: rand(0.05, 0.3) * this.horizon, vx: -rand(260, 380), vy: rand(90, 140), life: 0 };
      this.nextMeteor = rand(12, 30);
    }
    if (this.meteor) {
      const m = this.meteor;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life += dt;
      if (m.life > 0.9) this.meteor = null;
    }
  }

  private draw(): void {
    const { ctx, w, h, dpr, horizon, t } = this;
    if (!w || !h) return;
    const p = this.phase();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // sky
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    for (let i = 0; i < SKY_POS.length; i++) g.addColorStop(SKY_POS[i], css(mix(SKY_DUSK[i], SKY_NIGHT[i], p)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon + 1);

    // sunset glow (sun just below the horizon)
    const sunX = w * 0.74;
    const glowA = (1 - p) * 0.85;
    if (glowA > 0.01) {
      const sg = ctx.createRadialGradient(sunX, horizon, 0, sunX, horizon, horizon * 0.95);
      sg.addColorStop(0, `rgba(255,190,120,${glowA})`);
      sg.addColorStop(0.25, `rgba(255,120,90,${glowA * 0.45})`);
      sg.addColorStop(1, 'rgba(120,60,120,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, horizon);
    }

    // stars
    const starA = smooth(0.1, 0.85, p);
    if (starA > 0.01 && this.starsImg) {
      ctx.globalAlpha = starA;
      ctx.drawImage(this.starsImg, 0, 0, w, this.starsImg.height / dpr);
      for (const s of this.stars) {
        const a = starA * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#eef3ff';
        ctx.fillRect(s.x - s.r / 2, s.y - s.r / 2, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    // moon rises with the night
    if (this.moonImg) {
      const mw = this.moonImg.width / dpr;
      const my = horizon * (0.34 - 0.16 * smooth(0, 1, p));
      ctx.globalAlpha = 0.25 + 0.75 * smooth(0.05, 0.7, p);
      ctx.drawImage(this.moonImg, w * 0.86 - mw / 2 - this.mouse.x * 4, my - mw / 2, mw, mw);
      ctx.globalAlpha = 1;
    }

    // meteor
    if (this.meteor) {
      const m = this.meteor;
      const a = Math.sin((m.life / 0.9) * Math.PI);
      const lg = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.18, m.y - m.vy * 0.18);
      lg.addColorStop(0, `rgba(255,255,255,${a})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.18, m.y - m.vy * 0.18);
      ctx.stroke();
    }

    // clouds (lit warm from below at dusk, cool at night)
    const cn = smooth(0, 0.8, p);
    for (const c of this.clouds) {
      const cw = c.dusk.width / dpr;
      const chh = c.dusk.height / dpr;
      const cx = c.x - this.mouse.x * 6;
      if (cn < 0.99) {
        ctx.globalAlpha = c.a * (1 - cn);
        ctx.drawImage(c.dusk, cx, c.y, cw, chh);
      }
      if (cn > 0.01) {
        ctx.globalAlpha = c.a * cn * 0.7;
        ctx.drawImage(c.night, cx, c.y, cw, chh);
      }
    }
    ctx.globalAlpha = 1;

    // aircraft
    if (this.plane) {
      const pl = this.plane;
      const blink = Math.sin(pl.t * 7) > 0.75;
      ctx.fillStyle = 'rgba(255,90,80,0.9)';
      ctx.fillRect(pl.x - 2, pl.y, 1.6, 1.6);
      ctx.fillStyle = 'rgba(120,255,160,0.9)';
      ctx.fillRect(pl.x + 2, pl.y, 1.6, 1.6);
      if (blink) {
        const bg = ctx.createRadialGradient(pl.x, pl.y, 0, pl.x, pl.y, 7);
        bg.addColorStop(0, 'rgba(255,255,255,0.95)');
        bg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(pl.x - 7, pl.y - 7, 14, 14);
      }
    }

    // skyline layers with aerial-perspective haze
    const horizonC = mix(SKY_DUSK[4], SKY_NIGHT[4], p);
    const sway = this.reduced ? 0 : Math.sin(t * 0.045) * 0.5;
    const winA = 0.62 + 0.38 * smooth(0, 0.8, p);
    for (const L of this.layers) {
      const d = L.spec.depth;
      const ox = -this.margin + (sway * this.margin * 0.6 - this.mouse.x * this.margin * 0.5) * d;
      const oy = -this.mouse.y * 3 * d;
      const lw = L.sil.width / dpr;
      const lh = L.sil.height / dpr;
      ctx.drawImage(L.sil, ox, L.top + oy, lw, lh);
      ctx.globalAlpha = winA;
      ctx.drawImage(L.win, ox, L.top + oy, lw, lh);
      ctx.globalAlpha = 1;
      // twinkling windows
      for (const tw of L.twinkles) {
        const on = Math.sin(t * tw.sp + tw.ph) > 0.35 + (1 - p) * 0.3;
        if (!on) continue;
        ctx.fillStyle = css(tw.c, 0.85 * winA);
        ctx.fillRect(tw.x + ox, tw.y + oy, tw.w, tw.h);
      }
      // bridge traffic (near layer)
      if (L === this.layers[2]) {
        const b = this.bridge;
        for (const l of b.lanes) {
          ctx.fillStyle = css(l.c, 0.95);
          ctx.fillRect(l.x + ox, b.y + oy - (l.v > 0 ? 1.2 : 0.2), 2, 1.2);
        }
      }
      // beacons
      for (const bc of L.beacons) {
        const a = Math.max(0, Math.sin(t * 2.2 + bc.ph)) * (0.4 + 0.6 * p);
        if (a < 0.05) continue;
        const bx = bc.x + ox;
        const by = bc.y + oy;
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, bc.r * 4);
        bg.addColorStop(0, `rgba(255,70,60,${a})`);
        bg.addColorStop(0.3, `rgba(255,40,40,${a * 0.35})`);
        bg.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(bx - bc.r * 4, by - bc.r * 4, bc.r * 8, bc.r * 8);
      }
      // haze over this layer (thicker for distant layers, warmer at dusk)
      const hz = L.spec.haze * (0.55 + 0.45 * (1 - p));
      const hg = ctx.createLinearGradient(0, L.top + lh * 0.25, 0, horizon);
      hg.addColorStop(0, css(horizonC, 0));
      hg.addColorStop(1, css(horizonC, hz));
      ctx.fillStyle = hg;
      ctx.fillRect(0, L.top + lh * 0.25, w, horizon - (L.top + lh * 0.25));
    }

    // water
    const wg = ctx.createLinearGradient(0, horizon, 0, h);
    wg.addColorStop(0, css(mix(WATER_DUSK[0], WATER_NIGHT[0], p)));
    wg.addColorStop(1, css(mix(WATER_DUSK[1], WATER_NIGHT[1], p)));
    ctx.fillStyle = wg;
    ctx.fillRect(0, horizon, w, h - horizon);

    // reflection: flipped, squashed slices of the scene above with ripples,
    // rendered into a low-res buffer and upscaled (a free soft blur)
    const src = this.canvas;
    const wh = h - horizon;
    const R = 3;
    const rw = Math.ceil(w / R);
    const rh = Math.ceil(wh / R);
    if (!this.refl || this.refl.width !== rw || this.refl.height !== rh) this.refl = makeCanvas(rw, rh);
    const rc = this.refl.getContext('2d')!;
    rc.clearRect(0, 0, rw, rh);
    for (let d = 0; d < wh; d += R) {
      const sy = horizon - (d + R) * 1.1;
      if (sy < 0) break;
      const amp = 0.8 + d * 0.05;
      const dx = Math.sin(d * 0.19 + t * 1.5) * amp + Math.sin(d * 0.05 - t * 0.8) * amp * 0.7;
      rc.drawImage(src, 0, sy * dpr, w * dpr, R * 1.1 * dpr, dx / R, d / R, rw, 1);
    }
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.refl, 0, horizon, rw * R, rh * R);
    ctx.globalAlpha = 1;
    // darken towards the viewer
    const dg = ctx.createLinearGradient(0, horizon, 0, h);
    dg.addColorStop(0, 'rgba(4,6,14,0.05)');
    dg.addColorStop(1, 'rgba(4,6,14,0.75)');
    ctx.fillStyle = dg;
    ctx.fillRect(0, horizon, w, wh);

    // glitter path under the sun (dusk) / moon (night)
    const gx = w * (0.74 + (0.86 - 0.74) * smooth(0.3, 0.8, p));
    const gColor = p < 0.5 ? [255, 190, 130] : [210, 225, 255];
    for (let i = 0; i < 26; i++) {
      const d = ((i * 37.3) % wh) * 0.9 + 4;
      const spread = 10 + d * 0.5;
      const k = Math.sin(t * (1.3 + (i % 5) * 0.4) + i * 1.7);
      if (k < 0.2) continue;
      const lx = gx + Math.sin(i * 12.9) * spread;
      ctx.fillStyle = `rgba(${gColor[0]},${gColor[1]},${gColor[2]},${0.35 * k * (1 - d / wh)})`;
      ctx.fillRect(lx, horizon + d, 6 + (i % 4) * 5, 1);
    }
    // bright waterline
    ctx.fillStyle = css(mix([255, 190, 140], [120, 140, 200], p), 0.35);
    ctx.fillRect(0, horizon, w, 1);
  }
}
