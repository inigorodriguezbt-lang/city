// FPS / performance overlay (settings.graphics.showFps, F3).
import { h } from '../dom';
import { formatNumber } from '../../core/util';
import { setClass, setText, type HudContext } from './context';

const HIST = 90;

export class PerfOverlay {
  readonly el: HTMLElement;
  private fps: HTMLElement;
  private rows: Record<string, HTMLElement> = {};
  private spark: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private hist = new Float32Array(HIST);
  private head = 0;
  private acc = 0;
  private frames = 0;
  private frameAcc = 0;
  private visible = false;

  constructor(private ctx: HudContext) {
    this.fps = h('span', { class: 'hud-perf-fps' }, '--');
    this.spark = h('canvas', { class: 'hud-perf-spark', width: HIST * 2, height: 44 });
    this.sctx = this.spark.getContext('2d')!;
    const grid = h('div', { class: 'hud-perf-grid' });
    for (const [k, label] of [
      ['ms', 'Frame'], ['draw', 'Draw calls'], ['tris', 'Triangles'], ['veh', 'Vehicles'], ['bld', 'Buildings'], ['pop', 'Population'],
    ] as const) {
      const v = h('b', null, '–');
      this.rows[k] = v;
      grid.append(h('span', null, label), v);
    }
    this.el = h('div', { class: 'hud-perf hud-pe', 'aria-label': 'Performance' },
      h('div', { class: 'hud-perf-top' }, this.fps, h('span', { class: 'hud-perf-unit' }, 'FPS'), h('kbd', { class: 'hud-kbd' }, ctx.key('ui.debug') || 'F3')),
      this.spark, grid);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    setClass(this.el, 'show', v);
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.acc += dt;
    this.frameAcc += dt;
    this.frames++;
    if (this.acc < 0.25) return;
    const g = this.ctx.game;
    const fps = g.fps || this.frames / Math.max(1e-3, this.frameAcc);
    this.acc = 0;
    this.frames = 0;
    this.frameAcc = 0;
    this.hist[this.head] = fps;
    this.head = (this.head + 1) % HIST;
    setText(this.fps, fps >= 100 ? fps.toFixed(0) : fps.toFixed(1));
    setClass(this.el, 'slow', fps < 30);
    setClass(this.el, 'ok', fps >= 30 && fps < 55);
    const st = g.renderer.stats;
    const w = this.ctx.world();
    setText(this.rows.ms, `${(st.frameMs || (1000 / Math.max(1, fps))).toFixed(1)} ms`);
    setText(this.rows.draw, formatNumber(st.drawCalls));
    setText(this.rows.tris, formatNumber(st.triangles, true));
    let veh = 0;
    try {
      veh = g.traffic.vehicleCount;
    } catch {
      veh = 0;
    }
    setText(this.rows.veh, formatNumber(veh));
    setText(this.rows.bld, formatNumber(w?.buildings.size ?? 0));
    setText(this.rows.pop, formatNumber(w?.stats.population ?? 0, true));
    this.drawSpark();
  }

  private drawSpark(): void {
    const c = this.sctx;
    const W = this.spark.width, H = this.spark.height;
    c.clearRect(0, 0, W, H);
    const max = 75;
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1;
    for (const v of [30, 60]) {
      const y = H - (v / max) * H;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    c.beginPath();
    for (let i = 0; i < HIST; i++) {
      const v = this.hist[(this.head + i) % HIST];
      const x = (i / (HIST - 1)) * W;
      const y = H - Math.min(1, v / max) * (H - 2) - 1;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#3ddc84');
    grad.addColorStop(0.5, '#ffb547');
    grad.addColorStop(1, '#ff5d5d');
    c.strokeStyle = grad;
    c.lineWidth = 2;
    c.stroke();
  }
}
