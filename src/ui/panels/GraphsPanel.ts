// Graphs: canvas line charts over world.history with metric picker, time
// range, nice gridlines and a hover crosshair.
import { h } from '../dom';
import { calendar, formatDate, MONTH_SHORT } from '../../core/time';
import type { HistoryPoint } from '../../core/types';
import { formatMoney, formatNumber } from '../../core/util';
import { Panel } from './Panel';
import { Tabs, emptyState } from './widgets';
import { setClass, type HudContext } from '../hud/context';

type Range = '1y' | '5y' | 'all';

interface Series {
  key: keyof HistoryPoint;
  label: string;
  color: string;
}

interface Metric {
  id: string;
  label: string;
  icon: string;
  series: Series[];
  fmt: (v: number) => string;
  /** fixed domain (else auto) */
  domain?: [number, number];
  /** values stored as 0..1 fractions that should read as percentages */
  percentAuto?: boolean;
  area?: boolean;
}

const pct = (v: number) => `${Math.round(v)}%`;

const METRICS: Metric[] = [
  { id: 'population', label: 'Population', icon: '👥', series: [{ key: 'population', label: 'Citizens', color: '#4cc2ff' }], fmt: (v) => formatNumber(v, true), area: true },
  { id: 'money', label: 'Treasury', icon: '🏦', series: [{ key: 'money', label: 'Balance', color: '#7ee787' }], fmt: (v) => formatMoney(v, true), area: true },
  { id: 'cash', label: 'Income & expenses', icon: '💱', series: [{ key: 'income', label: 'Income', color: '#3ddc84' }, { key: 'expenses', label: 'Expenses', color: '#ff6b6b' }], fmt: (v) => formatMoney(v, true) },
  { id: 'happiness', label: 'Happiness', icon: '😊', series: [{ key: 'happiness', label: 'Happiness', color: '#ffd76a' }], fmt: pct, domain: [0, 100], area: true },
  { id: 'jobs', label: 'Jobs', icon: '💼', series: [{ key: 'jobs', label: 'Jobs', color: '#4aa8ff' }], fmt: (v) => formatNumber(v, true), area: true },
  { id: 'unemployment', label: 'Unemployment', icon: '📉', series: [{ key: 'unemployment', label: 'Unemployment', color: '#ff9f43' }], fmt: (v) => `${v.toFixed(1)}%`, percentAuto: true, area: true },
  { id: 'crime', label: 'Crime', icon: '🦹', series: [{ key: 'crime', label: 'Crime rate', color: '#ff5d8f' }], fmt: pct, domain: [0, 100], area: true },
  { id: 'pollution', label: 'Pollution', icon: '☣️', series: [{ key: 'pollution', label: 'Pollution', color: '#b58a5a' }], fmt: pct, domain: [0, 100], area: true },
  { id: 'landValue', label: 'Land value', icon: '💰', series: [{ key: 'landValue', label: 'Land value', color: '#f5c451' }], fmt: pct, domain: [0, 100], area: true },
  { id: 'traffic', label: 'Traffic flow', icon: '🚦', series: [{ key: 'trafficFlow', label: 'Flow', color: '#29d3e6' }], fmt: pct, domain: [0, 100], area: true },
  {
    id: 'demand', label: 'Demand', icon: '📶', domain: [-1, 1], fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`,
    series: [
      { key: 'demandRes', label: 'Residential', color: '#3ddc84' }, { key: 'demandCom', label: 'Commercial', color: '#4aa8ff' },
      { key: 'demandInd', label: 'Industrial', color: '#f2c230' }, { key: 'demandOff', label: 'Office', color: '#29d3e6' },
    ],
  },
];

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export class GraphsPanel extends Panel {
  private metric = METRICS[0];
  private range: Range = 'all';
  private canvas!: HTMLCanvasElement;
  private wrap!: HTMLElement;
  private tip!: HTMLElement;
  private legend!: HTMLElement;
  private summary!: HTMLElement;
  private empty!: HTMLElement;
  private chips = new Map<string, HTMLButtonElement>();
  private rangeTabs!: Tabs<Range>;
  private hoverX: number | null = null;
  private lastLen = -1;
  private pts: HistoryPoint[] = [];
  private ro: ResizeObserver | null = null;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'graphs', title: 'Graphs & Trends', icon: 'graph', width: 820, anchor: 'center', rate: 1, cls: 'hud-panel-graphs' });
  }

  protected build(body: HTMLElement): void {
    const chipRow = h('div', { class: 'hud-metric-chips' });
    for (const m of METRICS) {
      const b = h('button', { class: 'hud-metric', onclick: () => this.setMetric(m) }, h('span', null, m.icon), m.label);
      this.chips.set(m.id, b);
      chipRow.appendChild(b);
    }
    this.rangeTabs = new Tabs<Range>([{ id: '1y', label: '1 year' }, { id: '5y', label: '5 years' }, { id: 'all', label: 'All time' }], this.range, (r) => {
      this.range = r;
      this.lastLen = -1;
      this.refresh();
    }, 'hud-tabs-sm');
    this.canvas = h('canvas', { class: 'hud-chart' });
    this.tip = h('div', { class: 'hud-chart-tip' });
    this.empty = emptyState('📈', 'Not enough history yet', 'The city records a data point every month. Check back soon.');
    this.wrap = h('div', { class: 'hud-chart-wrap' }, this.canvas, this.tip, this.empty);
    this.legend = h('div', { class: 'hud-chart-legend' });
    this.summary = h('div', { class: 'hud-chart-summary' });
    body.append(chipRow, h('div', { class: 'hud-chart-bar' }, this.summary, h('span', { class: 'hud-fly-spacer' }), this.rangeTabs.el), this.wrap, this.legend);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverX = ((e.clientX - r.left) / r.width) * this.canvas.width;
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.draw();
    });
    this.ro = new ResizeObserver(() => this.isOpen && this.draw());
    this.ro.observe(this.wrap);
    this.setMetric(this.metric);
  }

  protected override onOpen(): void {
    this.rangeTabs.placeIndicator();
    this.lastLen = -1;
    this.refresh();
  }

  override reset(): void {
    this.lastLen = -1;
  }

  private setMetric(m: Metric): void {
    this.metric = m;
    for (const [id, b] of this.chips) setClass(b, 'active', id === m.id);
    this.legend.replaceChildren(...m.series.map((s) => h('span', { class: 'hud-chart-key' }, h('i', { style: `background:${s.color}` }), s.label)));
    this.lastLen = -1;
    this.refresh();
    this.ctx.sfx('click', 0.4);
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.canvas) return;
    const hist = w.history;
    const key = hist.length + (hist.length ? hist[hist.length - 1].day : 0);
    if (key === this.lastLen) return;
    this.lastLen = key;
    const lastDay = hist.length ? hist[hist.length - 1].day : 0;
    const span = this.range === '1y' ? 360 : this.range === '5y' ? 1800 : Infinity;
    this.pts = hist.filter((p) => p.day >= lastDay - span);
    this.setSubtitle(hist.length ? `${hist.length} monthly records since ${formatDate(hist[0].day)}` : 'No records yet');
    this.draw();
    this.updateSummary();
  }

  private val(p: HistoryPoint, s: Series): number {
    const v = Number(p[s.key]) || 0;
    if (this.metric.percentAuto && this.fractionScale) return v * 100;
    return v;
  }

  private get fractionScale(): boolean {
    if (!this.metric.percentAuto) return false;
    for (const p of this.pts) for (const s of this.metric.series) if (Math.abs(Number(p[s.key]) || 0) > 1.0001) return false;
    return true;
  }

  private updateSummary(): void {
    const m = this.metric;
    const p = this.pts;
    if (p.length < 1) {
      this.summary.replaceChildren();
      return;
    }
    const last = p[p.length - 1], first = p[0];
    this.summary.replaceChildren(...m.series.slice(0, 2).map((s) => {
      const a = this.val(first, s), b = this.val(last, s);
      const d = b - a;
      const rel = Math.abs(a) > Math.abs(b) * 0.02 && Math.abs(a) > 1e-6 ? (d / Math.abs(a)) * 100 : null;
      const abs = m.fmt(Math.abs(d)).replace(/^[+-]/, '');
      const txt = m.domain || rel === null || Math.abs(rel) > 999 ? abs : `${abs} (${Math.abs(rel).toFixed(1)}%)`;
      return h('div', { class: 'hud-chart-stat' },
        h('span', { class: 'dim' }, s.label),
        h('b', null, m.fmt(b)),
        p.length > 1 ? h('span', { class: 'hud-chart-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, `${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${txt}`) : null);
    }));
  }

  private draw(): void {
    const cw = this.wrap.clientWidth, ch = this.wrap.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.ctx.scale();
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    const pts = this.pts;
    const m = this.metric;
    const has = pts.length >= 2;
    setClass(this.empty, 'show', !has);
    setClass(this.tip, 'show', false);
    if (!has) return;
    const s = dpr;
    const x0 = 58 * s, x1 = W - 14 * s, y0 = 12 * s, y1 = H - 26 * s;
    const d0 = pts[0].day, d1 = pts[pts.length - 1].day;
    let v0 = Infinity, v1 = -Infinity;
    for (const p of pts) for (const se of m.series) {
      const v = this.val(p, se);
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    if (m.domain) {
      v0 = Math.min(v0, m.domain[0]);
      v1 = Math.max(v1, m.domain[1]);
    } else {
      const pad = (v1 - v0) * 0.08 || Math.abs(v1) * 0.1 || 1;
      v1 += pad;
      v0 = v0 >= 0 && v0 - pad < 0 ? 0 : v0 - pad;
    }
    const step = niceStep(v1 - v0, 5);
    v0 = Math.floor(v0 / step) * step;
    v1 = Math.ceil(v1 / step) * step;
    if (v1 === v0) v1 = v0 + step;
    const X = (d: number) => x0 + ((d - d0) / Math.max(1, d1 - d0)) * (x1 - x0);
    const Y = (v: number) => y1 - ((v - v0) / (v1 - v0)) * (y1 - y0);
    // grid + y labels
    c.font = `${11 * s}px Inter, system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    for (let v = v0; v <= v1 + step * 0.5; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      c.strokeStyle = Math.abs(v) < step * 1e-6 && v0 < 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.07)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x0, y);
      c.lineTo(x1, y);
      c.stroke();
      c.fillStyle = 'rgba(200,212,230,0.6)';
      c.fillText(m.fmt(v), x0 - 8 * s, y);
    }
    // x labels (years or months)
    c.textAlign = 'center';
    c.textBaseline = 'top';
    const spanDays = d1 - d0;
    const monthStep = spanDays > 360 * 6 ? 24 : spanDays > 360 * 3 ? 12 : spanDays > 360 ? 6 : spanDays > 180 ? 2 : 1;
    const firstMonth = Math.ceil(d0 / 30);
    let lastLabelX = -1e9;
    for (let mo = firstMonth; mo * 30 <= d1; mo++) {
      if (mo % monthStep) continue;
      const x = X(mo * 30);
      if (x - lastLabelX < 56 * s) continue;
      lastLabelX = x;
      const cal = calendar(mo * 30);
      c.fillStyle = 'rgba(200,212,230,0.55)';
      c.fillText(cal.month === 0 || monthStep >= 12 ? String(cal.year) : `${MONTH_SHORT[cal.month]} ${String(cal.year).slice(2)}`, x, y1 + 8 * s);
      c.strokeStyle = 'rgba(255,255,255,0.04)';
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, y0);
      c.lineTo(Math.round(x) + 0.5, y1);
      c.stroke();
    }
    // series
    for (const se of m.series) {
      c.beginPath();
      pts.forEach((p, i) => {
        const x = X(p.day), y = Y(this.val(p, se));
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      if (m.area && m.series.length === 1) {
        const g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, hexA(se.color, 0.32));
        g.addColorStop(1, hexA(se.color, 0));
        c.save();
        c.lineTo(X(pts[pts.length - 1].day), y1);
        c.lineTo(X(pts[0].day), y1);
        c.closePath();
        c.fillStyle = g;
        c.fill();
        c.restore();
        c.beginPath();
        pts.forEach((p, i) => {
          const x = X(p.day), y = Y(this.val(p, se));
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
      }
      c.strokeStyle = se.color;
      c.lineWidth = 2.2 * s;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke();
    }
    // crosshair
    if (this.hoverX !== null && this.hoverX >= x0 - 4 * s && this.hoverX <= x1 + 4 * s) {
      const day = d0 + ((this.hoverX - x0) / (x1 - x0)) * (d1 - d0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
      const x = X(best.day);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1 * s;
      c.setLineDash([4 * s, 4 * s]);
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, y0);
      c.lineTo(Math.round(x) + 0.5, y1);
      c.stroke();
      c.setLineDash([]);
      for (const se of m.series) {
        const y = Y(this.val(best, se));
        c.beginPath();
        c.arc(x, y, 4.5 * s, 0, Math.PI * 2);
        c.fillStyle = '#0d131c';
        c.fill();
        c.lineWidth = 2.2 * s;
        c.strokeStyle = se.color;
        c.stroke();
      }
      this.tip.replaceChildren(
        h('div', { class: 'hud-chart-tip-date' }, formatDate(best.day)),
        ...m.series.map((se) => h('div', { class: 'hud-chart-tip-row' }, h('i', { style: `background:${se.color}` }), h('span', null, se.label), h('b', null, m.fmt(this.val(best, se))))));
      const left = x / s;
      const flip = left > cw - 170;
      this.tip.style.transform = `translate(${Math.round(flip ? left - 12 : left + 12)}px, 12px) translateX(${flip ? '-100%' : '0'})`;
      setClass(this.tip, 'show', true);
    }
  }

  override close(): void {
    super.close();
    this.hoverX = null;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
