// ─────────────────────────────────────────────────────────────────────────────
// ToolManager: owns the registered tools, routes canvas pointer events (with
// terrain picks) and tool key actions to the active tool, and runs the default
// "inspect" behaviour (hover highlight + click to select) when no tool is on.
//
// Pointer routing rules
//  • left button on the canvas → current tool (down/move/up) with a pick
//  • right click without dragging (< 5 px) → cancels the current drag, or the
//    tool itself; right-drag belongs to the camera unless the tool claims the
//    right button (zone / tree / district erase drags)
//  • moves are coalesced to one pick per frame; the hover is re-evaluated when
//    the camera moves, modifiers change or the world changes under the cursor
// ─────────────────────────────────────────────────────────────────────────────
import type * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { ActionId } from '../settings/types';
import type { PointerInfo } from '../input/InputManager';
import { Layer, RoadType } from '../core/types';
import type { Tool, ToolPointerEvent } from './Tool';
import { BaseTool, sameOpts } from './BaseTool';
import { RoadTool } from './RoadTool';
import { ZoneTool } from './ZoneTool';
import { BulldozeTool } from './BulldozeTool';
import { PlaceTool } from './PlaceTool';
import { DistrictTool } from './DistrictTool';
import { TerraformTool } from './TerraformTool';
import { TreesTool } from './TreesTool';
import { MoveTool } from './MoveTool';
import { EyedropperTool, eyedropTarget } from './EyedropperTool';
import { TONE } from './preview';

/** pixels a press may travel and still count as a click */
const CLICK_SLOP = 5;
/** min seconds between hover re-evaluations caused by world changes */
const WORLD_REHOVER = 0.2;
/** meters around a road click to look for a vehicle */
const VEHICLE_PICK_RADIUS = 14;

/** optional extras a tool may implement (all built-in tools extend BaseTool) */
interface ToolExtras {
  cancelDrag?(): boolean;
  onPointerLeave?(): void;
  claimsRight?: boolean;
}

interface Press {
  button: number;
  x: number;
  y: number;
  moved: boolean;
  /** tool that received the down (null = inspect / camera) */
  tool: Tool | null;
  /** right-button press forwarded to a claiming tool */
  forwarded: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export class ToolManager {
  protected world: World | null = null;
  protected tools = new Map<string, Tool>();
  current: Tool | null = null;
  currentOpts: unknown = undefined;

  private press: Press | null = null;
  private pendingMove: PointerInfo | null = null;
  private lastPointer: { clientX: number; clientY: number; shift: boolean; ctrl: boolean; alt: boolean; onCanvas: boolean } | null = null;
  private hoverDirty = false;
  private worldDirtyAt = -1;
  private lastWorldRehover = 0;
  /** touch has no hover: previews fade out a moment after the finger lifts */
  private touchLeaveAt = -1;
  private lastCam = new Float32Array(16);
  private lastMods = '';
  /** inspect mode state */
  private inspectHover: number | null = null;
  private selectedId: number | null = null;
  private highlighted: number | null = null;
  private highlightColor = 0;

  constructor(protected game: Game) {
    this.register(new RoadTool(game));
    this.register(new ZoneTool(game));
    this.register(new BulldozeTool(game));
    this.register(new PlaceTool(game));
    this.register(new DistrictTool(game));
    this.register(new TerraformTool(game));
    this.register(new TreesTool(game));
    this.register(new MoveTool(game));
    this.register(new EyedropperTool(game));

    game.input.onPointer((p) => this.onPointer(p));
    const routed: ActionId[] = ['tool.rotate', 'tool.brushBigger', 'tool.brushSmaller', 'tool.eyedropper'];
    for (const a of routed) game.input.onAction(a, () => this.routeAction(a));
    game.events.on('select', (s) => {
      this.selectedId = s?.buildingId ?? null;
      this.refreshHighlight();
    });
    game.events.on('building:removed', (b) => {
      if (this.selectedId === b.id) this.selectedId = null;
      if (this.inspectHover === b.id) this.inspectHover = null;
      if (this.highlighted === b.id) this.refreshHighlight();
    });
    game.events.on('world:changed', ({ layers }) => {
      if (layers & (Layer.Road | Layer.Zone | Layer.Building | Layer.Terrain | Layer.Water | Layer.District | Layer.Tree)) this.worldDirtyAt = this.game.time;
    });
  }

  onWorldLoaded(world: World): void {
    this.world = world;
    this.selectedId = null;
    this.inspectHover = null;
    this.highlighted = null;
  }

  onWorldUnloaded(): void {
    this.setTool(null);
    this.press = null;
    this.pendingMove = null;
    this.setHighlight(null, 0);
    this.world = null;
  }

  update(dt: number): void {
    if (!this.world) return;
    if (this.blocked()) {
      if (this.press) this.abortPress();
      return;
    }
    if (this.touchLeaveAt >= 0 && this.game.time >= this.touchLeaveAt && !this.press) {
      this.touchLeaveAt = -1;
      if (this.lastPointer) this.lastPointer.onCanvas = false;
      this.leaveCanvas();
    }
    if (this.pendingMove) {
      const p = this.pendingMove;
      this.pendingMove = null;
      this.handleMove(p);
    } else if (this.lastPointer?.onCanvas) {
      // re-evaluate the hover when the view, modifiers or world changed
      const cam = this.game.renderer.camera.matrixWorld.elements;
      let camMoved = false;
      for (let i = 0; i < 16; i++)
        if (Math.abs(cam[i] - this.lastCam[i]) > 1e-4) {
          camMoved = true;
          break;
        }
      const m = this.game.input.modifiers;
      const mods = m ? `${m.shift}${m.ctrl}${m.alt}` : '';
      const worldChanged = this.worldDirtyAt >= 0 && this.game.time - this.worldDirtyAt < 1 && this.game.time - this.lastWorldRehover >= WORLD_REHOVER;
      if (camMoved || mods !== this.lastMods || this.hoverDirty || worldChanged) {
        this.hoverDirty = false;
        if (worldChanged) {
          this.lastWorldRehover = this.game.time;
          this.worldDirtyAt = -1;
        }
        const lp = this.lastPointer;
        const synth: PointerInfo = {
          type: 'move', button: -1, buttons: this.press ? 1 : 0, clientX: lp.clientX, clientY: lp.clientY, dx: 0, dy: 0, wheel: 0,
          shift: m?.shift ?? lp.shift, ctrl: m?.ctrl ?? lp.ctrl, alt: m?.alt ?? lp.alt, onCanvas: true,
        };
        this.handleMove(synth);
      }
      if (camMoved) for (let i = 0; i < 16; i++) this.lastCam[i] = cam[i];
      this.lastMods = mods;
    }
    try {
      this.current?.update?.(dt);
    } catch (e) {
      console.error(`[tools] ${this.current?.id} update failed`, e);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  /** a registered tool by id */
  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /** ids of every registered tool */
  get ids(): string[] {
    return [...this.tools.keys()];
  }

  /** activate a tool by id with options; same id+opts toggles off (pass toggle=false to force) */
  setTool(id: string | null, opts?: unknown, toggle = true): void {
    if (id && toggle && this.current?.id === id && sameOpts(opts, this.currentOpts)) id = null;
    const next = id ? this.tools.get(id) ?? null : null;
    if (id && !next) {
      console.warn(`[tools] unknown tool "${id}"`);
      return;
    }
    const prev = this.current;
    if (prev) {
      try {
        prev.deactivate();
      } catch (e) {
        console.error(`[tools] ${prev.id} deactivate failed`, e);
      }
    }
    if (this.press) this.press.tool = null;
    this.current = next;
    this.currentOpts = next ? opts : undefined;
    this.inspectHover = null;
    this.refreshHighlight();
    try {
      this.game.input.claimButton?.(2, false);
    } catch {
      /* input without claims */
    }
    if (next) {
      try {
        next.activate(opts);
      } catch (e) {
        console.error(`[tools] ${next.id} activate failed`, e);
      }
      if ((next as ToolExtras).claimsRight) this.game.input.claimButton?.(2, true);
      this.hoverDirty = true;
    }
    this.game.events.emit('tool:changed', next ? next.id : null);
    if (next) this.sfx('click', 0.6);
    else if (prev) this.sfx('close', 0.5);
  }

  /** Esc / right-click: abort the current drag if there is one, else turn the tool off */
  cancel(): void {
    const t = this.current;
    if (t && this.extras(t)?.cancelDrag?.()) {
      if (this.press) this.press.tool = null;
      return;
    }
    this.setTool(null);
  }

  get hint(): string {
    try {
      return this.current?.hint?.() ?? '';
    } catch {
      return '';
    }
  }

  // ── routing ──────────────────────────────────────────────────────────
  private blocked(): boolean {
    const g = this.game;
    try {
      return !this.world || g.menus.isOpen() || g.chat.isOpen;
    } catch {
      return !this.world;
    }
  }

  private toEvent(p: { clientX: number; clientY: number; button: number; shift: boolean; ctrl: boolean; alt: boolean }): ToolPointerEvent {
    const w = this.world;
    let pick: { cell: { x: number; y: number }; point: THREE.Vector3 } | null = null;
    try {
      pick = this.game.renderer.pick(p.clientX, p.clientY);
    } catch (e) {
      console.warn('[tools] pick failed', e);
    }
    const cell = pick && w && w.inBounds(pick.cell.x, pick.cell.y) ? { x: pick.cell.x, y: pick.cell.y } : null;
    return { cell, point: pick?.point ?? null, button: p.button, shift: p.shift, ctrl: p.ctrl, alt: p.alt, clientX: p.clientX, clientY: p.clientY };
  }

  private onPointer(p: PointerInfo): void {
    if (!this.world || p.type === 'wheel') return;
    if (this.blocked()) {
      if (p.type === 'up' && this.press) this.press = null;
      return;
    }
    this.lastPointer = { clientX: p.clientX, clientY: p.clientY, shift: p.shift, ctrl: p.ctrl, alt: p.alt, onCanvas: p.onCanvas };
    switch (p.type) {
      case 'move':
        if (this.press && Math.hypot(p.clientX - this.press.x, p.clientY - this.press.y) >= CLICK_SLOP) this.press.moved = true;
        this.pendingMove = p;
        // a claimed right-drag starts once it has moved far enough
        if (this.press && this.press.button === 2 && this.press.moved && !this.press.forwarded) this.forwardRightDown();
        return;
      case 'down':
        this.touchLeaveAt = -1;
        this.flushMove();
        if (p.onCanvas) this.handleDown(p);
        return;
      case 'up':
        this.flushMove();
        this.handleUp(p);
        if (p.pointerType === 'touch') this.touchLeaveAt = this.game.time + 1.4;
        return;
      case 'leave':
        this.pendingMove = null;
        if (this.press) this.abortPress();
        else this.leaveCanvas();
        return;
    }
  }

  private flushMove(): void {
    if (!this.pendingMove) return;
    const p = this.pendingMove;
    this.pendingMove = null;
    this.handleMove(p);
  }

  private handleDown(p: PointerInfo): void {
    if (this.press && this.press.button !== p.button) {
      // a second button during a drag: right cancels the drag
      if (p.button === 2 && this.press.button === 0) {
        this.extras(this.press.tool)?.cancelDrag?.();
        this.press.tool = null;
      }
      return;
    }
    const tool = this.current;
    this.press = { button: p.button, x: p.clientX, y: p.clientY, moved: false, tool: null, forwarded: false, shift: p.shift, ctrl: p.ctrl, alt: p.alt };
    if (p.button === 0 && tool?.onPointerDown) {
      this.press.tool = tool;
      this.safe(() => tool.onPointerDown!(this.toEvent(p)));
    }
  }

  private forwardRightDown(): void {
    const pr = this.press;
    const tool = this.current;
    if (!pr || !tool || !this.extras(tool)?.claimsRight || !tool.onPointerDown) return;
    pr.forwarded = true;
    pr.tool = tool;
    this.safe(() => tool.onPointerDown!(this.toEvent({ clientX: pr.x, clientY: pr.y, button: 2, shift: pr.shift, ctrl: pr.ctrl, alt: pr.alt })));
  }

  private handleMove(p: PointerInfo): void {
    const tool = this.current;
    const pr = this.press;
    const dragging = !!pr && !!pr.tool && pr.tool === tool;
    if (!p.onCanvas && !dragging) {
      this.leaveCanvas();
      return;
    }
    if (tool) {
      if (tool.onPointerMove) {
        const ev = this.toEvent({ ...p, button: pr?.forwarded ? 2 : pr?.button ?? -1 });
        this.safe(() => tool.onPointerMove!(ev));
      }
      return;
    }
    this.inspectMove(p);
  }

  private handleUp(p: PointerInfo): void {
    const pr = this.press;
    if (!pr || pr.button !== p.button) return;
    this.press = null;
    const tool = this.current;
    if (pr.button === 2) {
      if (pr.forwarded && pr.tool && pr.tool === tool) {
        this.safe(() => tool.onPointerUp?.(this.toEvent(p)));
        return;
      }
      if (!pr.moved && p.onCanvas) {
        // right click: cancel the drag, else the tool
        if (tool) {
          if (!this.extras(tool)?.cancelDrag?.()) this.cancel();
        }
      }
      return;
    }
    if (pr.button !== 0) return;
    if (pr.tool) {
      if (pr.tool === tool) this.safe(() => tool.onPointerUp?.(this.toEvent(p)));
      return;
    }
    if (!tool && !pr.moved && p.onCanvas) this.inspectClick(p);
  }

  /** abort any press without applying it (touch gesture took over, focus lost) */
  private abortPress(): void {
    const pr = this.press;
    this.press = null;
    if (pr?.tool) this.extras(pr.tool)?.cancelDrag?.();
  }

  private leaveCanvas(): void {
    const tool = this.current;
    if (tool) this.extras(tool)?.onPointerLeave?.();
    else if (this.inspectHover !== null) {
      this.inspectHover = null;
      this.refreshHighlight();
    }
  }

  private routeAction(a: ActionId): void {
    if (this.blocked()) return;
    const tool = this.current;
    let used = false;
    if (tool?.onAction) {
      try {
        used = tool.onAction(a);
      } catch (e) {
        console.error(`[tools] ${tool.id} action failed`, e);
      }
    }
    if (used || a !== 'tool.eyedropper') return;
    // instant eyedropper at the cursor, or the eyedropper tool when nothing is there
    const lp = this.lastPointer;
    const w = this.world;
    if (lp?.onCanvas && w) {
      const ev = this.toEvent({ ...lp, button: 0 });
      const t = eyedropTarget(w, ev.cell);
      if (t) {
        this.setTool(t.tool, t.opts, false);
        return;
      }
    }
    this.setTool('eyedropper');
  }

  // ── default inspect behaviour ────────────────────────────────────────
  private inspectMove(p: PointerInfo): void {
    const w = this.world;
    if (!w) return;
    const ev = this.toEvent(p);
    const b = ev.cell ? w.buildingAt(ev.cell.x, ev.cell.y) : undefined;
    const id = b?.id ?? null;
    if (id !== this.inspectHover) {
      this.inspectHover = id;
      this.refreshHighlight();
    }
  }

  private inspectClick(p: PointerInfo): void {
    const w = this.world;
    if (!w) return;
    const ev = this.toEvent(p);
    const g = this.game;
    const b = ev.cell ? w.buildingAt(ev.cell.x, ev.cell.y) : undefined;
    if (b) {
      this.selectedId = b.id;
      g.events.emit('select', { buildingId: b.id });
      try {
        g.ui.openBuildingInfo(b.id);
      } catch (e) {
        console.warn('[tools] openBuildingInfo failed', e);
      }
      this.sfx('click', 0.7);
      this.refreshHighlight();
      return;
    }
    if (ev.cell && ev.point && w.roadAt(ev.cell.x, ev.cell.y) !== RoadType.None) {
      let vid: number | null = null;
      try {
        vid = g.traffic.nearestVehicle(ev.point.x, ev.point.z, VEHICLE_PICK_RADIUS);
      } catch {
        vid = null;
      }
      if (vid !== null && vid !== undefined) {
        this.selectedId = null;
        g.events.emit('select', { vehicleId: vid });
        this.sfx('click', 0.7);
        this.refreshHighlight();
        return;
      }
    }
    if (this.selectedId !== null) {
      this.selectedId = null;
      g.events.emit('select', null);
      this.refreshHighlight();
    }
  }

  private refreshHighlight(): void {
    if (this.current) {
      // tools manage their own highlights; drop the inspect one
      if (this.highlighted !== null && (this.highlightColor === TONE.hover || this.highlightColor === TONE.select)) this.setHighlight(null, 0);
      return;
    }
    if (this.inspectHover !== null) this.setHighlight(this.inspectHover, this.inspectHover === this.selectedId ? TONE.select : TONE.hover);
    else if (this.selectedId !== null) this.setHighlight(this.selectedId, TONE.select);
    else this.setHighlight(null, 0);
  }

  private setHighlight(id: number | null, color: number): void {
    if (id === this.highlighted && color === this.highlightColor) return;
    this.highlighted = id;
    this.highlightColor = color;
    try {
      this.game.buildings.highlight(id, id === null ? undefined : color);
    } catch {
      /* renderer unavailable */
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────
  private extras(t: Tool | null | undefined): ToolExtras | null {
    return t ? (t as unknown as ToolExtras) : null;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.error(`[tools] ${this.current?.id ?? 'inspect'} pointer handler failed`, e);
    }
  }

  private sfx(id: 'click' | 'close', vol: number): void {
    try {
      this.game.audio.play(id, vol);
    } catch {
      /* audio unavailable */
    }
  }

  /** true when `t` is one of the built-in tools (extends BaseTool) */
  static isBuiltIn(t: Tool | null): t is BaseTool {
    return t instanceof BaseTool;
  }
}
