// Transit line tool (id "transit", activate({ mode })).
// Click cells to add stops (snapped to the nearest valid cell for the mode:
// roads for buses, tram avenues for trams, railways for trains, water for
// ferries, roads for the elevated monorail, anywhere on land for the metro).
// A live preview shows the placed stops, the hovered stop (green / red) and
// the route between consecutive stops (as the vehicles will drive it, through
// the path worker), including the closing leg back to the first stop.
// Enter or clicking the first stop again creates the line; right click / Esc
// abandons the line being drawn (a second Esc leaves the tool). Clicking an
// existing stop while not drawing selects that line.
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { Cell, TransitMode } from '../../core/types';
import { CELL } from '../../core/constants';
import type { ActionId } from '../../settings/types';
import type { Tool, ToolPointerEvent } from '../Tool';
import type { TrafficSystem } from '../../sim/traffic/TrafficSystem';
import { MONORAIL_HEIGHT } from '../../sim/traffic/types';
import { createRibbonMaterial, pixelFactor, RibbonBuilder } from '../../render/vehicles/ribbons';

const MODE_COLOR: Record<TransitMode, number> = { bus: 0x29b6f6, tram: 0xffb300, metro: 0xe53935, train: 0x43a047, ferry: 0x1e88e5, monorail: 0x8e24aa };
const MODE_NAME: Record<TransitMode, string> = { bus: 'Bus', tram: 'Tram', metro: 'Metro', train: 'Train', ferry: 'Ferry', monorail: 'Monorail' };
const MODES: TransitMode[] = ['bus', 'tram', 'metro', 'train', 'ferry', 'monorail'];

interface Leg {
  path: Int32Array | null;
  done: boolean;
}

export class TransitTool implements Tool {
  readonly id = 'transit';
  /** ToolManager extra: right button stays with the camera unless we claim it */
  claimsRight = false;
  private mode: TransitMode = 'bus';
  private stops: Cell[] = [];
  private hover: Cell | null = null;
  private hoverReason: string | null = null;
  private active = false;
  private root = new THREE.Group();
  private legs = new Map<string, Leg>();
  private dirty = true;
  private time = 0;
  private lastKey = '';
  private lastKeyAt = 0;
  private offAction: (() => void) | null = null;
  private message = '';
  private messageT = 0;
  private mat = createRibbonMaterial(0.95, 2.6, 1.4);
  private mesh: THREE.Mesh | null = null;

  constructor(private game: Game) {
    this.root.name = 'transit-tool';
    this.root.renderOrder = 20;
  }

  private get traffic(): TrafficSystem {
    return this.game.traffic;
  }

  activate(opts?: unknown): void {
    const m = (opts as { mode?: TransitMode } | undefined)?.mode;
    this.mode = m && MODES.includes(m) ? m : 'bus';
    this.active = true;
    this.stops = [];
    this.hover = null;
    this.legs.clear();
    this.dirty = true;
    this.message = '';
    this.messageT = 0;
    if (!this.root.parent) this.game.renderer.scene.add(this.root);
    window.addEventListener('keydown', this.onKey, true);
    try {
      this.offAction = this.game.input.onAction('ui.chat', this.onChatAction);
    } catch {
      this.offAction = null;
    }
  }

  deactivate(): void {
    this.active = false;
    this.stops = [];
    this.hover = null;
    this.legs.clear();
    this.clearPreview();
    this.root.removeFromParent();
    window.removeEventListener('keydown', this.onKey, true);
    this.offAction?.();
    this.offAction = null;
  }

  /** Esc / right click: drop the line being drawn first */
  cancelDrag(): boolean {
    if (!this.stops.length) return false;
    this.stops = [];
    this.dirty = true;
    this.flash('Line discarded');
    return true;
  }

  onPointerLeave(): void {
    this.hover = null;
    this.dirty = true;
  }

  private onKey = (e: KeyboardEvent): void => {
    this.lastKey = e.code;
    this.lastKeyAt = performance.now();
  };

  /** Game asks this before opening the chat on Enter: finishing a line wins */
  wantsEnter(): boolean {
    return this.active && this.stops.length >= 2 && (this.lastKey === 'Enter' || this.lastKey === 'NumpadEnter') && performance.now() - this.lastKeyAt < 500;
  }

  /** Enter is bound to the chat: finish the line instead when drawing */
  private onChatAction = (): void => {
    if (!this.active || this.stops.length < 2) return;
    setTimeout(() => {
      if (this.lastKey !== 'Enter' && this.lastKey !== 'NumpadEnter') return;
      if (performance.now() - this.lastKeyAt > 500) return;
      try {
        if (this.game.chat.isOpen) this.game.chat.close();
      } catch {
        /* chat unavailable */
      }
      this.finish();
    }, 0);
  };

  onAction(_a: ActionId): boolean {
    return false;
  }

  private snap(cell: Cell | null): { c: Cell | null; reason: string | null } {
    const w = this.game.world;
    if (!cell || !w) return { c: null, reason: null };
    const t = this.traffic;
    const c = t.transit.snap(this.mode, cell.x, cell.y, 2);
    if (!c) return { c: cell, reason: t.transit.stopInvalidReason(this.mode, cell.x, cell.y) };
    const last = this.stops[this.stops.length - 1];
    if (last && last.x === c.x && last.y === c.y) return { c, reason: 'Already a stop here' };
    // consecutive stops must be connected for road / rail / water modes
    if (last) {
      const pm = t.transit.pathMode(this.mode);
      if (pm !== -1 && !t.graph?.reachable(pm, w.idx(last.x, last.y), w.idx(c.x, c.y))) return { c, reason: 'Not connected to the previous stop' };
    }
    return { c, reason: null };
  }

  onPointerMove(e: ToolPointerEvent): void {
    if (!this.game.world) return;
    const { c, reason } = this.snap(e.cell);
    if (c?.x !== this.hover?.x || c?.y !== this.hover?.y || reason !== this.hoverReason) {
      this.hover = c;
      this.hoverReason = reason;
      this.dirty = true;
    }
  }

  onPointerDown(e: ToolPointerEvent): void {
    const w = this.game.world;
    if (!w || e.button !== 0) return;
    const { c, reason } = this.snap(e.cell);
    if (!c) return;
    const first = this.stops[0];
    if (first && this.stops.length >= 2 && Math.abs(first.x - c.x) + Math.abs(first.y - c.y) <= 1) {
      this.finish();
      return;
    }
    if (!this.stops.length) {
      // clicking an existing stop selects its line
      for (const l of w.transitLines)
        for (const s of l.stops)
          if (s.x === (e.cell?.x ?? -1) && s.y === (e.cell?.y ?? -1) && l.mode === this.mode && reason) {
            this.game.events.emit('select', { lineId: l.id });
            return;
          }
    }
    if (reason) {
      this.flash(reason);
      this.sfx('error');
      return;
    }
    this.stops.push(c);
    this.dirty = true;
    this.sfx('click');
  }

  private finish(): void {
    if (this.stops.length < 2) {
      this.flash('A line needs at least two stops');
      return;
    }
    const line = this.traffic.createLine(this.mode, this.stops);
    if (!line) {
      this.flash('Stops are not connected — check the route');
      this.sfx('error');
      return;
    }
    this.stops = [];
    this.legs.clear();
    this.dirty = true;
    this.flash(`${line.name} created`);
    this.sfx('build');
    try {
      this.game.ui.toast(`${line.name} is running with ${line.vehicles} vehicles`, 'good');
    } catch {
      /* no ui */
    }
    this.game.events.emit('select', { lineId: line.id });
  }

  private flash(msg: string): void {
    this.message = msg;
    this.messageT = 2.5;
  }

  private sfx(id: string): void {
    try {
      (this.game.audio as unknown as { play(id: string, v?: number): void }).play(id, 0.7);
    } catch {
      /* audio optional */
    }
  }

  hint(): string {
    const n = this.stops.length;
    const name = MODE_NAME[this.mode];
    if (this.messageT > 0 && this.message) return `${name} line · ${this.message}`;
    if (this.hover && this.hoverReason) return `${name} line · ${n} stop${n === 1 ? '' : 's'} · ⚠ ${this.hoverReason}`;
    if (!n) return `${name} line · click to place the first stop`;
    if (n === 1) return `${name} line · 1 stop · click to add the next stop`;
    return `${name} line · ${n} stops · click to add · Enter or click the first stop to finish · right-click to cancel`;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    this.messageT -= dt;
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
    const r = this.game.renderer;
    (this.mat.uniforms.uPixel as { value: number }).value = pixelFactor(r.camera, r.renderer.domElement.height || 800);
    (this.mat.uniforms.uOpacity as { value: number }).value = 0.86 + Math.sin(this.time * 5) * 0.08;
  }

  // ── preview ─────────────────────────────────────────────────────────────
  private clearPreview(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }
  }

  private cellY(c: Cell): number {
    const w = this.game.world!;
    const cx = (c.x + 0.5) * CELL, cz = (c.y + 0.5) * CELL;
    if (this.mode === 'ferry') return Math.max(w.waterLevel(c.x, c.y), w.cellHeight(c.x, c.y));
    const base = this.game.roadSurface?.heightAt(cx, cz) ?? w.heightAt(cx, cz);
    return base + (this.mode === 'monorail' ? MONORAIL_HEIGHT : 0);
  }

  private leg(a: Cell, b: Cell): Leg | null {
    const w = this.game.world!;
    const pm = this.traffic.transit.pathMode(this.mode);
    if (pm === -1) return null;
    const key = `${this.mode}|${a.x},${a.y}|${b.x},${b.y}`;
    let l = this.legs.get(key);
    if (!l) {
      l = { path: null, done: false };
      this.legs.set(key, l);
      const leg = l;
      this.traffic.paths.request(pm, w.idx(a.x, a.y), w.idx(b.x, b.y), (p) => {
        leg.path = p;
        leg.done = true;
        if (this.active) this.dirty = true;
      });
    }
    return l;
  }

  private rebuild(): void {
    const w = this.game.world;
    this.clearPreview();
    if (!w) return;
    const color = new THREE.Color(MODE_COLOR[this.mode]);
    const bad = new THREE.Color(0xff4a3d), ghost = color.clone().lerp(new THREE.Color(0xffffff), 0.45);
    const rb = new RibbonBuilder();
    const lift = 1.3;
    const drawLeg = (a: Cell, b: Cell, c: THREE.Color, half: number) => {
      const lg = this.leg(a, b);
      if (lg && lg.done && lg.path) {
        const p = lg.path;
        for (let j = 0; j < p.length - 1; j++) {
          const c0 = { x: p[j] % w.size, y: Math.floor(p[j] / w.size) }, c1 = { x: p[j + 1] % w.size, y: Math.floor(p[j + 1] / w.size) };
          rb.segment((c0.x + 0.5) * CELL, this.cellY(c0) + lift, (c0.y + 0.5) * CELL, (c1.x + 0.5) * CELL, this.cellY(c1) + lift, (c1.y + 0.5) * CELL, half, c);
        }
        return;
      }
      // straight dashes: metro tunnels, routes still being computed, unreachable legs (red)
      const col2 = lg && lg.done && !lg.path ? bad : c;
      const ax = (a.x + 0.5) * CELL, az = (a.y + 0.5) * CELL, bx = (b.x + 0.5) * CELL, bz = (b.y + 0.5) * CELL;
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 10));
      const dash = this.mode === 'metro' || !lg?.done ? 0.6 : 1;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + dash) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = (this.mode === 'metro' ? w.heightAt(x0, z0) : this.cellY({ x: Math.floor(x0 / CELL), y: Math.floor(z0 / CELL) })) + lift;
        const y1 = (this.mode === 'metro' ? w.heightAt(x1, z1) : this.cellY({ x: Math.floor(x1 / CELL), y: Math.floor(z1 / CELL) })) + lift;
        rb.segment(x0, y0, z0, x1, y1, z1, half, col2);
      }
    };
    const st = this.stops;
    for (let k = 0; k < st.length - 1; k++) drawLeg(st[k], st[k + 1], color, 1.4);
    const last = st[st.length - 1];
    if (last && this.hover && !this.hoverReason && (this.hover.x !== last.x || this.hover.y !== last.y)) drawLeg(last, this.hover, ghost, 1.1);
    // closing leg back to the first stop (lines always loop)
    if (st.length >= 2) drawLeg(this.hover && !this.hoverReason ? this.hover : last, st[0], ghost, 0.7);
    // stop markers: first stop white with a colored ring
    st.forEach((s, k) => {
      const x = (s.x + 0.5) * CELL, z = (s.y + 0.5) * CELL, y = this.cellY(s) + lift + 0.2;
      if (k === 0) {
        rb.disc(x, y, z, 2.6, 0xffffff);
        rb.ring(x, y + 0.02, z, 3.0, 3.9, color);
      } else {
        rb.disc(x, y, z, 2.6, color);
        rb.disc(x, y + 0.02, z, 1.2, 0xffffff);
      }
    });
    if (this.hover) {
      const closing = st.length >= 2 && Math.abs(st[0].x - this.hover.x) + Math.abs(st[0].y - this.hover.y) <= 1;
      const hc = this.hoverReason && !closing ? 0xff4a3d : closing ? 0xffffff : 0x66ff88;
      rb.ring((this.hover.x + 0.5) * CELL, this.cellY(this.hover) + lift + 0.4, (this.hover.y + 0.5) * CELL, 3.2, 4.3, hc);
    }
    if (rb.empty) return;
    const m = new THREE.Mesh(rb.build(), this.mat);
    m.renderOrder = 21;
    m.frustumCulled = false;
    this.mesh = m;
    this.root.add(m);
  }
}
