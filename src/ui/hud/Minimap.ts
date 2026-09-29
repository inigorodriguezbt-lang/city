// Minimap: a 256² low-res rendering of the city (terrain shading, water,
// trees, zones, roads, buildings) updated incrementally from 'world:changed',
// plus a live camera footprint. Click / drag moves the camera.
import { h, isolate } from '../dom';
import { CELL } from '../../core/constants';
import { Layer, RoadType, ZoneType, type Rect } from '../../core/types';
import { hexToRgb } from '../../core/util';
import { buildingDef, CATEGORY_INFO } from '../../data/buildings';
import { zoneDef } from '../../data/zones';
import type { World } from '../../world/World';
import { icon } from './icons';
import { setClass, type HudContext } from './context';

const RES = 256;
/** pixels recomputed per frame at most (keeps big edits smooth) */
const BUDGET = 9000;

type RGB = [number, number, number];

const rgb255 = (hex: string): RGB => {
  const [r, g, b] = hexToRgb(hex);
  return [r * 255, g * 255, b * 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Minimap {
  readonly el: HTMLElement;
  private base: HTMLCanvasElement;
  private view: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private vctx: CanvasRenderingContext2D;
  private img: ImageData;
  private world: World | null = null;
  private k = 1;
  /** dirty pixel rect queue */
  private dirty: Rect | null = null;
  private cursorRow = 0;
  private lastView = '';
  private palette: {
    grass: RGB; dry: RGB; rock: RGB; snow: RGB; sand: RGB; shallow: RGB; deep: RGB; forest: RGB;
    road: RGB; highway: RGB; rail: RGB; pedestrian: RGB; service: RGB;
  } | null = null;
  private zoneRgb: RGB[] = [];
  private catRgb = new Map<string, RGB>();
  private hMin = 0;
  private hMax = 1;
  private visible = true;

  constructor(private ctx: HudContext) {
    this.base = h('canvas', { class: 'hud-mm-base', width: RES, height: RES });
    this.view = h('canvas', { class: 'hud-mm-view', width: RES * 2, height: RES * 2 });
    this.bctx = this.base.getContext('2d', { willReadFrequently: false })!;
    this.vctx = this.view.getContext('2d')!;
    this.img = this.bctx.createImageData(RES, RES);
    const home = h('button', { class: 'hud-mm-btn', 'aria-label': 'Go to city hall', onclick: () => this.ctx.game.renderer.cameraCtl.reset() }, icon('home', 14));
    ctx.tips.attach(home, 'Back to city centre', { key: () => ctx.key('camera.reset') });
    const hide = h('button', { class: 'hud-mm-btn', 'aria-label': 'Hide minimap', onclick: () => this.ctx.game.settings.set({ ui: { minimap: false } }) }, icon('shrink', 14));
    ctx.tips.attach(hide, 'Hide minimap', { key: () => ctx.key('ui.minimap') });
    const stage = h('div', { class: 'hud-mm-stage' }, this.base, this.view, h('span', { class: 'hud-mm-n' }, 'N'));
    this.el = isolate(h('div', { class: 'hud-minimap hud-pe', 'aria-label': 'Minimap' }, stage, h('div', { class: 'hud-mm-tools' }, home, hide)));
    this.initPointer(stage);
    ctx.game.events.on('world:changed', ({ rect, layers }) => {
      if (!this.world) return;
      if (layers & (Layer.Terrain | Layer.Water | Layer.Road | Layer.Zone | Layer.Building | Layer.Tree)) this.markCells(rect);
    });
    ctx.game.events.on('building:added', (b) => this.markCells({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }));
    ctx.game.events.on('building:removed', (b) => this.markCells({ x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 }));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    setClass(this.el, 'hidden', !v);
    if (v) this.lastView = '';
  }

  attach(world: World | null): void {
    this.world = world;
    this.dirty = null;
    this.lastView = '';
    if (!world) {
      this.bctx.clearRect(0, 0, RES, RES);
      this.vctx.clearRect(0, 0, this.view.width, this.view.height);
      return;
    }
    this.k = world.size / RES;
    const t = world.theme;
    this.palette = {
      grass: rgb255(t.grass), dry: rgb255(t.grassDry), rock: rgb255(t.rock), snow: rgb255(t.snow), sand: rgb255(t.sand),
      shallow: rgb255(t.waterShallow), deep: rgb255(t.waterDeep), forest: mix(rgb255(t.grass), [18, 52, 28], 0.55),
      road: [206, 212, 222], highway: [236, 205, 140], rail: [140, 132, 150], pedestrian: [226, 196, 170], service: [236, 238, 244],
    };
    this.zoneRgb = [];
    for (let z = 0; z <= ZoneType.MixedUse; z++) {
      const d = zoneDef(z as ZoneType);
      this.zoneRgb[z] = d ? rgb255(d.color) : [0, 0, 0];
    }
    this.catRgb.clear();
    for (const [k, v] of Object.entries(CATEGORY_INFO)) this.catRgb.set(k, rgb255(v.color));
    // height range for tinting
    let lo = Infinity, hi = -Infinity;
    const hs = world.heights;
    for (let i = 0; i < hs.length; i += 7) {
      const v = hs[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.hMin = Math.max(world.seaLevel, lo);
    this.hMax = Math.max(this.hMin + 1, hi);
    this.dirty = { x0: 0, y0: 0, x1: RES - 1, y1: RES - 1 };
    this.cursorRow = 0;
  }

  update(): void {
    if (!this.world || !this.visible) return;
    if (this.dirty) this.processDirty();
    this.drawView();
  }

  // ── rendering ──────────────────────────────────────────────────────────
  private markCells(r: Rect): void {
    if (!this.world) return;
    const k = this.k;
    const p: Rect = {
      x0: Math.max(0, Math.floor((r.x0 - 1) / k)), y0: Math.max(0, Math.floor((r.y0 - 1) / k)),
      x1: Math.min(RES - 1, Math.floor((r.x1 + 1) / k)), y1: Math.min(RES - 1, Math.floor((r.y1 + 1) / k)),
    };
    if (!this.dirty) {
      this.dirty = p;
      this.cursorRow = p.y0;
    } else {
      const d = this.dirty;
      // restart the sweep from the top of the union so nothing is skipped
      this.cursorRow = Math.min(this.cursorRow, p.y0);
      d.x0 = Math.min(d.x0, p.x0);
      d.y0 = Math.min(d.y0, p.y0);
      d.x1 = Math.max(d.x1, p.x1);
      d.y1 = Math.max(d.y1, p.y1);
    }
  }

  private processDirty(): void {
    const d = this.dirty!;
    const width = d.x1 - d.x0 + 1;
    const rows = Math.max(1, Math.floor(BUDGET / width));
    const y0 = Math.max(d.y0, this.cursorRow);
    const y1 = Math.min(d.y1, y0 + rows - 1);
    const data = this.img.data;
    for (let py = y0; py <= y1; py++)
      for (let px = d.x0; px <= d.x1; px++) {
        const c = this.pixel(px, py);
        const o = (py * RES + px) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    this.bctx.putImageData(this.img, 0, 0, d.x0, y0, width, y1 - y0 + 1);
    if (y1 >= d.y1) this.dirty = null;
    else this.cursorRow = y1 + 1;
  }

  private pixel(px: number, py: number): RGB {
    const w = this.world!;
    const pal = this.palette!;
    const k = this.k;
    const cx0 = Math.floor(px * k), cy0 = Math.floor(py * k);
    const cx1 = Math.max(cx0, Math.floor((px + 1) * k) - 1), cy1 = Math.max(cy0, Math.floor((py + 1) * k) - 1);
    // roads win inside the block so thin lines survive downsampling
    let road = 0;
    for (let y = cy0; y <= cy1 && !road; y++)
      for (let x = cx0; x <= cx1; x++) {
        const t = w.road[y * w.size + x];
        if (t) {
          road = t;
          if (t !== RoadType.Rail) break;
        }
      }
    if (road) {
      if (road === RoadType.Highway) return pal.highway;
      if (road === RoadType.Rail) return pal.rail;
      if (road === RoadType.Pedestrian) return pal.pedestrian;
      return pal.road;
    }
    const x = Math.min(w.size - 1, (cx0 + cx1) >> 1), y = Math.min(w.size - 1, (cy0 + cy1) >> 1);
    const i = y * w.size + x;
    const shade = this.shade(x, y);
    const bid = w.bldg[i];
    if (bid) {
      const b = w.buildings.get(bid);
      if (b) {
        let c: RGB;
        if (b.kind === 'service') {
          const def = buildingDef(b.defId);
          c = mix(pal.service, this.catRgb.get(def?.category ?? '') ?? pal.service, 0.55);
        } else c = mix(this.zoneRgb[b.zone] ?? pal.service, [255, 255, 255], 0.28);
        return scale(c, 0.9 + shade * 0.12);
      }
    }
    const depth = w.waterDepth(x, y);
    if (depth > 0.15) {
      const t = Math.min(1, depth / 14);
      return scale(mix(pal.shallow, pal.deep, t), 0.92 + shade * 0.05);
    }
    const hgt = w.cellHeight(x, y);
    const slope = w.cellSlope(x, y);
    const hn = (hgt - this.hMin) / (this.hMax - this.hMin);
    let c: RGB = mix(pal.grass, pal.dry, Math.min(1, Math.max(0, hn * 1.4 - 0.2)));
    if (hgt - w.seaLevel < 1.6 && w.isShore(x, y)) c = mix(c, pal.sand, 0.65);
    if (slope > 0.45) c = mix(c, pal.rock, Math.min(1, (slope - 0.45) * 2.2));
    if (hn > 0.82) c = mix(c, pal.snow, Math.min(1, (hn - 0.82) * 5));
    const tr = w.trees[i];
    if (tr) c = mix(c, pal.forest, 0.3 + tr * 0.17);
    const z = w.zone[i];
    if (z) c = mix(c, this.zoneRgb[z] ?? c, 0.62);
    return scale(c, shade);
  }

  /** simple NW hillshade from corner heights */
  private shade(x: number, y: number): number {
    const w = this.world!;
    const k = Math.max(1, this.k);
    const dx = w.vertexHeight(x + k, y) - w.vertexHeight(x, y);
    const dy = w.vertexHeight(x, y + k) - w.vertexHeight(x, y);
    const s = 1 + (-(dx + dy) / (CELL * k)) * 1.6;
    return Math.max(0.62, Math.min(1.28, s));
  }

  private drawView(): void {
    const cam = this.ctx.game.renderer.cameraCtl;
    const camera = this.ctx.game.renderer.camera;
    const w = this.world!;
    const key = `${cam.focus.x.toFixed(1)}|${cam.focus.y.toFixed(1)}|${cam.yaw.toFixed(3)}|${cam.pitch.toFixed(3)}|${cam.distance.toFixed(0)}|${camera.aspect.toFixed(2)}`;
    if (key === this.lastView) return;
    this.lastView = key;
    const c = this.vctx;
    const S = this.view.width;
    const m = S / w.size; // canvas px per cell
    c.clearRect(0, 0, S, S);
    // camera footprint on the ground (trapezoid), in cells
    const vf = (camera.fov * Math.PI) / 180;
    const p = Math.max(0.05, cam.pitch);
    const H = Math.sin(p) * cam.distance;
    const base = Math.cos(p) * cam.distance;
    const nearA = p + vf / 2, farA = p - vf / 2;
    const near = H / Math.tan(Math.min(1.55, nearA));
    const far = farA > 0.04 ? H / Math.tan(farA) : base + 6000;
    const hf = Math.tan(vf / 2) * camera.aspect;
    const slantN = Math.hypot(near, H), slantF = Math.hypot(Math.min(far, base + 6000), H);
    const wn = slantN * hf, wfar = slantF * hf;
    // forward (camera → focus) direction in cell space
    const fx = -Math.sin(cam.yaw), fy = -Math.cos(cam.yaw);
    const rx = -fy, ry = fx;
    const ox = cam.focus.x, oy = cam.focus.y;
    const dn = (near - base) / CELL, df = (Math.min(far, base + 6000) - base) / CELL;
    const pt = (d: number, s: number): [number, number] => [(ox + fx * d + rx * s) * m, (oy + fy * d + ry * s) * m];
    const a = pt(dn, -wn / CELL), b = pt(dn, wn / CELL), cc = pt(df, wfar / CELL), d = pt(df, -wfar / CELL);
    c.save();
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(cc[0], cc[1]);
    c.lineTo(d[0], d[1]);
    c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.13)';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.stroke();
    // focus dot
    c.beginPath();
    c.arc(ox * m, oy * m, 5, 0, Math.PI * 2);
    c.fillStyle = '#4cc2ff';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#fff';
    c.stroke();
    c.restore();
  }

  // ── interaction ────────────────────────────────────────────────────────
  private initPointer(stage: HTMLElement): void {
    let down = false, moved = false, sx = 0, sy = 0, pid = -1;
    const toCell = (e: PointerEvent): { x: number; y: number } | null => {
      const w = this.world;
      if (!w) return null;
      const r = stage.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      return { x: Math.max(0, Math.min(w.size, u * w.size)), y: Math.max(0, Math.min(w.size, v * w.size)) };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      pid = e.pointerId;
      stage.setPointerCapture(pid);
      stage.classList.add('drag');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== pid) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      moved = true;
      const c = toCell(e);
      if (c) this.ctx.game.renderer.cameraCtl.flyTo(c.x, c.y, undefined, true);
    });
    const end = (e: PointerEvent) => {
      if (!down || e.pointerId !== pid) return;
      down = false;
      stage.classList.remove('drag');
      if (!moved) {
        const c = toCell(e);
        if (c) {
          this.ctx.flyTo(c.x, c.y);
          this.ctx.sfx('click', 0.5);
        }
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }
}

function scale(c: RGB, s: number): RGB {
  return [Math.min(255, c[0] * s), Math.min(255, c[1] * s), Math.min(255, c[2] * s)];
}
