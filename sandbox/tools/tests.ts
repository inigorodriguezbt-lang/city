// Unit-style assertions for WorldActions, history, InputManager and ToolManager.
import { MAX_ROAD_SLOPE, MAX_ZONE_DEPTH } from '../../src/core/constants';
import { BFlag, Dir, RoadType, ZoneType, type BuildingDef, type Cell } from '../../src/core/types';
import { BUILDINGS } from '../../src/data/buildings';
import { World } from '../../src/world/World';
import { comboLabel, parseCombo, isMac } from '../../src/input/keys';
import { attach, mapSettings, type FakeGame } from './fakeGame';

export interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** flat test world: plateau at 20 m, a lake with wet banks, a steep hill */
export function makeTestWorld(): World {
  const w = new World(mapSettings(), 64);
  w.heights.fill(20);
  w.seaLevel = 0;
  const s1 = w.size + 1;
  // lake: vertices [30..38]×[8..21] at 12 m; water surface 17 m on [29..38]×[7..21]
  for (let vy = 8; vy <= 21; vy++) for (let vx = 30; vx <= 38; vx++) w.heights[vy * s1 + vx] = 12;
  for (let y = 7; y <= 21; y++) for (let x = 29; x <= 38; x++) w.water[w.idx(x, y)] = 17;
  // hill centered at (12, 46), radius 8 cells, +34 m
  for (let vy = 0; vy <= w.size; vy++)
    for (let vx = 0; vx <= w.size; vx++) {
      const d = Math.hypot(vx - 12, vy - 46) / 8;
      if (d < 1) w.heights[vy * s1 + vx] += 34 * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
  w.milestone = 13;
  w.economy.money = 500_000;
  return w;
}

function snapshot(w: World): string {
  const bs = [...w.buildings.values()].sort((a, b) => a.id - b.id);
  return JSON.stringify({
    road: Array.from(w.road), flags: Array.from(w.roadFlags), zone: Array.from(w.zone), trees: Array.from(w.trees), district: Array.from(w.district),
    heights: Array.from(w.heights, (h) => Math.round(h * 1e4) / 1e4), bldg: Array.from(w.bldg), bs, districts: w.districts, money: Math.round(w.economy.money * 100) / 100,
  });
}

function connected(path: Cell[]): boolean {
  for (let i = 1; i < path.length; i++) if (Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y) !== 1) return false;
  return true;
}

/** a plain road-fronted building w×h without special placement rules */
function plainDef(w = 2, h = 2): BuildingDef | undefined {
  return BUILDINGS.find((d) => d.w === w && d.h === h && d.cost > 0 && d.unlock <= 13 && !d.placement?.unique && !d.placement?.onWater && !d.placement?.shore && !d.placement?.rail && !d.placement?.resource && d.placement?.road !== false)
    ?? BUILDINGS.find((d) => d.cost > 0 && !d.placement);
}

export async function runTests(g: FakeGame): Promise<TestResult[]> {
  const out: TestResult[] = [];
  const t = (name: string, fn: () => string | true) => {
    try {
      const r = fn();
      out.push({ name, ok: r === true, detail: r === true ? '' : r });
    } catch (e) {
      out.push({ name, ok: false, detail: `threw ${(e as Error).message}` });
      console.error(name, e);
    }
  };
  const eq = (a: unknown, b: unknown, what: string): string | true => (JSON.stringify(a) === JSON.stringify(b) ? true : `${what}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

  const w = makeTestWorld();
  attach(g, w);
  const A = g.actions;

  // ── roads: planning ────────────────────────────────────────────────────
  t('plan straight (axis)', () => {
    const p = A.planRoad({ x: 5, y: 5 }, { x: 15, y: 6 }, RoadType.Street, 'straight');
    return p.length === 11 && p.every((c) => c.y === 5) && connected(p) ? true : `len ${p.length}`;
  });
  t('plan L-shape', () => {
    const p = A.planRoad({ x: 5, y: 10 }, { x: 12, y: 16 }, RoadType.Street, 'lshape');
    return p.length === 14 && connected(p) && p[13].x === 12 && p[13].y === 16 ? true : `len ${p.length}`;
  });
  t('plan diagonal staircase', () => {
    const p = A.planRoad({ x: 5, y: 20 }, { x: 9, y: 24 }, RoadType.Street, 'straight');
    const e = p[p.length - 1];
    return connected(p) && e.x === 9 && e.y === 24 && p.length === 9 ? true : `len ${p.length} end ${e.x},${e.y}`;
  });

  // ── roads: validation, cost, placement ─────────────────────────────────
  const street = A.planRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.Street, 'straight');
  t('check street cost = 11 × $60', () => {
    const a = A.checkRoad(street, RoadType.Street);
    return a.ok && a.cost === 660 && !a.invalid.length ? true : `ok ${a.ok} cost ${a.cost} reason ${a.reason}`;
  });
  t('place street charges money', () => {
    const m0 = w.economy.money;
    const r = A.placeRoad(street, RoadType.Street);
    return r.ok && m0 - w.economy.money === 660 && w.roadAt(10, 5) === RoadType.Street ? true : `ok ${r.ok} spent ${m0 - w.economy.money} ${r.reason}`;
  });
  t('existing road is free / already built', () => {
    const a = A.checkRoad(street, RoadType.Street);
    return !a.ok && a.newCells === 0 && a.cost === 0 && a.reason === 'Already built' ? true : `ok ${a.ok} new ${a.newCells} cost ${a.cost}`;
  });
  t('upgrade pays the difference', () => {
    const a = A.checkRoad(street, RoadType.Avenue);
    return a.ok && a.upgrades.length === 11 && a.cost === 11 * 100 ? true : `ok ${a.ok} upg ${a.upgrades.length} cost ${a.cost}`;
  });
  t('locked road type is refused', () => {
    w.milestone = 0;
    const a = A.checkRoad([{ x: 50, y: 50 }], RoadType.Boulevard);
    w.milestone = 13;
    return !a.ok && /unlocks/i.test(a.reason ?? '') ? true : `reason ${a.reason}`;
  });
  t('rail cannot cross road', () => {
    const p = A.planRoad({ x: 10, y: 2 }, { x: 10, y: 8 }, RoadType.Rail, 'straight');
    const a = A.checkRoad(p, RoadType.Rail);
    return !a.ok && a.invalid.some((c) => c.x === 10 && c.y === 5) && /cross/.test(a.reason ?? '') ? true : `ok ${a.ok} reason ${a.reason}`;
  });
  const bridgePath = A.planRoad({ x: 26, y: 14 }, { x: 41, y: 14 }, RoadType.Street, 'straight');
  t('bridge cells cost ×3', () => {
    const a = A.checkRoad(bridgePath, RoadType.Street);
    return a.ok && a.bridges.length === 10 && a.cost === 6 * 60 + 10 * 180 ? true : `ok ${a.ok} bridges ${a.bridges.length} cost ${a.cost} ${a.reason}`;
  });
  t('gravel cannot bridge', () => {
    const a = A.checkRoad(bridgePath, RoadType.Dirt);
    return !a.ok && a.invalid.length === 10 ? true : `ok ${a.ok} invalid ${a.invalid.length}`;
  });
  t('undo/redo road with bridge restores exact state', () => {
    const s0 = snapshot(w);
    const r = A.placeRoad(bridgePath, RoadType.Street);
    if (!r.ok) return `place failed ${r.reason}`;
    if (!w.isBridge(33, 14)) return 'no bridge flag';
    const s1 = snapshot(w);
    if (!A.undo()) return 'undo failed';
    if (snapshot(w) !== s0) return 'undo mismatch';
    if (!A.redo()) return 'redo failed';
    if (snapshot(w) !== s1) return 'redo mismatch';
    return true;
  });
  t('grading keeps road slope ≤ max', () => {
    const p = A.planRoad({ x: 1, y: 46 }, { x: 23, y: 46 }, RoadType.Street, 'straight');
    const a = A.checkRoad(p, RoadType.Street);
    if (!a.ok) return /steep/i.test(a.reason ?? '') ? true : `unexpected reason ${a.reason}`;
    const r = A.placeRoad(p, RoadType.Street);
    if (!r.ok) return `place failed ${r.reason}`;
    const worst = Math.max(...p.map((c) => w.cellSlope(c.x, c.y)));
    return worst <= MAX_ROAD_SLOPE + 1e-3 ? true : `slope ${worst.toFixed(3)}`;
  });
  t('auto path avoids buildings', () => {
    const b = w.addBuilding({ kind: 'service', defId: 'x', x: 20, y: 27, w: 3, h: 5, rot: Dir.S, built: 1 });
    const p = A.planRoad({ x: 17, y: 29 }, { x: 26, y: 29 }, RoadType.Street, 'auto');
    const clear = p.every((c) => !(c.x >= b.x && c.x < b.x + b.w && c.y >= b.y && c.y < b.y + b.h));
    const L = A.checkRoad(A.planRoad({ x: 17, y: 29 }, { x: 26, y: 29 }, RoadType.Street, 'lshape'), RoadType.Street);
    w.removeBuilding(b.id);
    return clear && connected(p) && !L.ok ? true : `clear ${clear} connected ${connected(p)} lshapeBlocked ${!L.ok}`;
  });
  t('zoned buildings block unless replace', () => {
    const b = w.addBuilding({ kind: 'zoned', defId: 'zoned:res_low', x: 50, y: 30, w: 1, h: 1, rot: Dir.S, zone: ZoneType.ResLow, built: 1 });
    const p = A.planRoad({ x: 48, y: 30 }, { x: 52, y: 30 }, RoadType.Street, 'straight');
    const a1 = A.checkRoad(p, RoadType.Street);
    const a2 = A.checkRoad(p, RoadType.Street, { replace: true });
    w.removeBuilding(b.id);
    return !a1.ok && a2.ok && a2.replaces.includes(b.id) ? true : `default ${a1.ok} replace ${a2.ok}`;
  });

  // ── zoning ─────────────────────────────────────────────────────────────
  t(`zoning depth ≤ ${MAX_ZONE_DEPTH}`, () => {
    const r = [1, 2, 3, 4, 5].map((d) => A.isZoneable(8, 5 + d));
    return eq(r, [true, true, true, true, false], 'depth');
  });
  t('road / water not zoneable', () => (!A.isZoneable(8, 5) && !A.isZoneable(33, 15) ? true : 'zoneable'));
  t('zoneRect zones only valid cells', () => {
    const r = A.zoneRect({ x0: 5, y0: 6, x1: 15, y1: 11 }, ZoneType.ResLow);
    let n = 0;
    w.forEachCellInRect({ x0: 5, y0: 6, x1: 15, y1: 11 }, (_x, _y, i) => { if (w.zone[i] === ZoneType.ResLow) n++; });
    return r.ok && n === 44 ? true : `ok ${r.ok} n ${n}`;
  });
  t('rezoning removes mismatched zoned building (undo restores it)', () => {
    const b = w.addBuilding({ kind: 'zoned', defId: 'zoned:res_low', x: 6, y: 6, w: 2, h: 2, rot: Dir.N, zone: ZoneType.ResLow, built: 1, level: 2 });
    const s0 = snapshot(w);
    const r = A.zoneCells([{ x: 6, y: 6 }], ZoneType.ComLow);
    if (!r.ok || w.buildings.has(b.id)) return 'not removed';
    A.undo();
    return snapshot(w) === s0 && w.buildings.get(b.id)?.level === 2 ? true : 'undo mismatch';
  });
  t('zoneFill bounded flood fill', () => {
    const r = A.zoneFill({ x: 7, y: 8 }, ZoneType.ComLow, 20);
    let n = 0;
    for (let i = 0; i < w.zone.length; i++) if (w.zone[i] === ZoneType.ComLow) n++;
    return r.ok && n === 20 ? true : `n ${n}`;
  });
  t('dezone', () => {
    const r = A.zoneRect({ x0: 5, y0: 6, x1: 15, y1: 11 }, ZoneType.None);
    let n = 0;
    w.forEachCellInRect({ x0: 5, y0: 6, x1: 15, y1: 11 }, (_x, _y, i) => { if (w.zone[i]) n++; });
    return r.ok && n === 0 ? true : `left ${n}`;
  });

  // ── buildings ──────────────────────────────────────────────────────────
  const def = plainDef();
  let placedId = -1;
  t('placement needs road frontage', () => {
    if (!def) return 'no plain 2x2 def in catalog';
    const c = A.checkBuilding(def.id, 10, 2, Dir.S);
    return !c.ok && /road/i.test(c.reason ?? '') ? true : `ok ${c.ok} ${c.reason}`;
  });
  t('place building (built 0, charged, flattened)', () => {
    if (!def) return 'no def';
    const c = A.checkBuilding(def.id, 10, 4, Dir.S);
    if (!c.ok) return `check ${c.reason}`;
    const m0 = w.economy.money;
    const r = A.placeBuilding(def.id, 10, 4, Dir.S);
    if (!r.ok || r.id === undefined) return `place ${r.reason}`;
    placedId = r.id;
    const b = w.getBuilding(r.id)!;
    return m0 - w.economy.money === def.cost && b.built === 0 && (b.flags & BFlag.UnderConstruction) !== 0 && b.jobs === (def.jobs ?? 0) && b.rot === Dir.S ? true : 'state mismatch';
  });
  t('occupied footprint blocks', () => {
    if (!def) return 'no def';
    const c = A.checkBuilding(def.id, 10, 4, Dir.S);
    return !c.ok && /Blocked/.test(c.reason ?? '') ? true : `ok ${c.ok} ${c.reason}`;
  });
  t('bulldoze fresh = 75% refund, undo restores', () => {
    if (placedId < 0 || !def) return 'no building';
    const s0 = snapshot(w);
    const m0 = w.economy.money;
    const r = A.bulldozeBuilding(placedId);
    const refund = w.economy.money - m0;
    if (!r.ok || Math.abs(refund - Math.round(def.cost * 0.75)) > 0.5) return `refund ${refund}`;
    A.undo();
    return snapshot(w) === s0 ? true : 'undo mismatch';
  });
  t('old building refund = 20%', () => {
    if (placedId < 0 || !def) return 'no building';
    const b = w.getBuilding(placedId)!;
    b.built = 1;
    b.age = 12;
    b.flags &= ~BFlag.UnderConstruction;
    return A.refundFor(placedId) === Math.round(def.cost * 0.2) ? true : `refund ${A.refundFor(placedId)}`;
  });
  t('zoned building: no refund', () => {
    const b = w.addBuilding({ kind: 'zoned', defId: 'zoned:res_low', x: 12, y: 7, w: 1, h: 1, rot: Dir.N, zone: ZoneType.ResLow, built: 1 });
    const v = A.refundFor(b.id);
    w.removeBuilding(b.id);
    return v === 0 ? true : `refund ${v}`;
  });
  t('destroy (disaster) → rubble, not undoable, clearing cost', () => {
    if (placedId < 0) return 'no building';
    const before = A.history.undoCount;
    A.destroyBuilding(placedId, 'fire');
    const b = w.getBuilding(placedId)!;
    const rubble = (b.flags & BFlag.Collapsed) !== 0 && b.jobs === 0;
    const dropped = A.history.undoCount < before;
    return rubble && dropped && A.refundFor(placedId) < 0 ? true : `rubble ${rubble} dropped ${dropped}`;
  });
  t('unique buildings', () => {
    const u = BUILDINGS.find((d) => d.placement?.unique && !d.placement.onWater && !d.placement.shore && !d.placement.rail && !d.placement.resource && d.w <= 3 && d.h <= 3);
    if (!u) return 'no unique def';
    // road along y=60 to host it
    A.placeRoad(A.planRoad({ x: 40, y: 60 }, { x: 60, y: 60 }, RoadType.Street, 'straight'), RoadType.Street);
    const sz = { w: u.w, h: u.h };
    const cy = 60 - sz.h + Math.floor(sz.h / 2);
    const r1 = A.placeBuilding(u.id, 44, cy, Dir.S);
    const r2 = A.checkBuilding(u.id, 52, cy, Dir.S);
    return r1.ok && !r2.ok && /Only one/.test(r2.reason ?? '') ? true : `first ${r1.ok} ${r1.reason} second ${r2.reason}`;
  });
  t('water building on land refused', () => {
    const d = BUILDINGS.find((q) => q.placement?.onWater);
    if (!d) return 'no onWater def';
    const c = A.checkBuilding(d.id, 50, 40, Dir.S);
    return !c.ok && /water/i.test(c.reason ?? '') ? true : `ok ${c.ok} ${c.reason}`;
  });

  // ── terrain, trees ─────────────────────────────────────────────────────
  t('terraform raise costs per m³, spares roads, undo exact', () => {
    const s0 = snapshot(w);
    const roadV = w.vertexHeight(10, 5);
    const h0 = w.vertexHeight(10, 20);
    const m0 = w.economy.money;
    const r = A.terraform(10 * 16, 20 * 16, 64, 'raise', 2);
    if (!r.ok) return `fail ${r.reason}`;
    const raised = w.vertexHeight(10, 20) - h0;
    const r2 = A.terraform(10 * 16, 5 * 16, 40, 'raise', 2);
    const untouched = w.vertexHeight(10, 5) === roadV;
    const spent = m0 - w.economy.money;
    A.undo();
    if (r2.ok) A.undo();
    return raised > 1.9 && untouched && spent > 0 && snapshot(w) === s0 ? true : `raised ${raised.toFixed(2)} untouched ${untouched} spent ${spent}`;
  });
  t('level to sea / flatten target', () => {
    const r = A.terraform(50 * 16, 50 * 16, 48, 'level', 40);
    const h = w.vertexHeight(50, 50);
    A.undo();
    return r.ok && Math.abs(h - (w.seaLevel + 1.2)) < 0.5 ? true : `h ${h.toFixed(2)}`;
  });
  t('plant trees cost per tree', () => {
    const m0 = w.economy.money;
    const cells = A.treeBrush(45, 40, 2, 2);
    const expect = A.treeBrushCost(cells);
    const r = A.plantTrees(45, 40, 2, 2);
    return r.ok && expect > 0 && Math.abs(m0 - w.economy.money - expect) < 0.01 ? true : `cost ${m0 - w.economy.money} vs ${expect}`;
  });

  // ── districts ──────────────────────────────────────────────────────────
  t('districts create/paint/delete/undo', () => {
    const d = A.createDistrict();
    if (d.id !== 1 || !/^#[0-9a-f]{6}$/.test(d.color) || !d.name) return `bad district ${JSON.stringify(d)}`;
    A.paintDistrict([{ x: 1, y: 1 }, { x: 2, y: 1 }], d.id);
    const s1 = snapshot(w);
    A.deleteDistrict(d.id);
    const cleared = w.district[w.idx(1, 1)] === 0 && !w.districts.length;
    A.undo();
    const d2 = A.createDistrict();
    return cleared && snapshot(w) !== s1 && d2.id === 2 && d2.color !== d.color ? true : `cleared ${cleared}`;
  });

  // ── history bounds ─────────────────────────────────────────────────────
  t('history capped at 100, redo cleared by new action', () => {
    for (let i = 0; i < 110; i++) A.plantTrees(2 + (i % 20), 30 + Math.floor(i / 20), 0, 1 + (i % 3));
    const capped = A.history.undoCount === 100;
    A.undo();
    const hadRedo = A.canRedo();
    A.plantTrees(55, 55, 1, 3);
    return capped && hadRedo && !A.canRedo() ? true : `count ${A.history.undoCount} redo ${hadRedo}`;
  });
  t('creative mode is free', () => {
    w.creative = true;
    const m0 = w.economy.money;
    const r = A.placeRoad(A.planRoad({ x: 45, y: 25 }, { x: 55, y: 25 }, RoadType.Avenue, 'straight'), RoadType.Avenue);
    w.creative = false;
    return r.ok && w.economy.money === m0 ? true : `spent ${m0 - w.economy.money}`;
  });

  // ── input ──────────────────────────────────────────────────────────────
  t('combo parsing & labels', () => {
    const p = parseCombo('Ctrl+Shift+KeyZ');
    const l = comboLabel('Ctrl+KeyZ');
    const ok = p && p.ctrl && p.shift && !p.alt && p.code === 'KeyZ' && (isMac ? l === '⌘Z' : l === 'Ctrl+Z') && comboLabel('Space') === 'Space' && comboLabel('BracketLeft') === '[';
    return ok ? true : `label ${l}`;
  });
  t('onAction: once per press, no repeat, not while typing (Esc still fires)', () => {
    let undo = 0, redo = 0, esc = 0;
    const offs = [g.input.onAction('edit.undo', () => undo++), g.input.onAction('edit.redo', () => redo++), g.input.onAction('tool.cancel', () => esc++)];
    const key = (code: string, o: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...o }));
    const ctrl = isMac ? { metaKey: true } : { ctrlKey: true };
    key('KeyZ', ctrl);
    key('KeyZ', { ...ctrl, repeat: true });
    key('KeyZ', { ...ctrl, shiftKey: true });
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' }));
    const inp = document.createElement('input');
    document.body.appendChild(inp);
    inp.focus();
    key('KeyZ', ctrl);
    key('Escape');
    inp.remove();
    for (const o of offs) o();
    return undo === 1 && redo === 1 && esc === 1 ? true : `undo ${undo} redo ${redo} esc ${esc}`;
  });
  t('isDown tracks held keys, cleared on blur', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    const held = g.input.isDown('camera.forward');
    window.dispatchEvent(new Event('blur'));
    return held && !g.input.isDown('camera.forward') ? true : `held ${held}`;
  });
  t('setTool toggles & emits tool:changed', () => {
    const seen: (string | null)[] = [];
    const off = g.events.on('tool:changed', (id) => seen.push(id));
    g.tools.setTool('road', { type: RoadType.Street });
    const a = g.tools.current?.id;
    g.tools.setTool('road', { type: RoadType.Street });
    const b = g.tools.current;
    g.tools.setTool('road', { type: RoadType.Street });
    g.tools.setTool('road', { type: RoadType.Avenue });
    const c = g.tools.current?.id;
    g.tools.setTool(null);
    off();
    return a === 'road' && b === null && c === 'road' && eq(seen, ['road', null, 'road', 'road', null], 'events') === true ? true : `seen ${JSON.stringify(seen)}`;
  });
  // ── tool integration through real pointer events ───────────────────────
  const canvas = g.renderer.canvas;
  g.renderer.lookAt(20, 20, 520);
  const scr = (x: number, y: number) => g.renderer.cellToScreen(x, y);
  const fire = (type: string, x: number, y: number, o: { button?: number; buttons?: number; id?: number; touch?: boolean; shift?: boolean } = {}) => {
    const p = scr(x, y);
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: p.x, clientY: p.y, button: o.button ?? (type === 'pointermove' ? -1 : 0), buttons: o.buttons ?? 0, pointerId: o.id ?? 1,
      pointerType: o.touch ? 'touch' : 'mouse', bubbles: true, cancelable: true, shiftKey: !!o.shift,
    }));
    g.tools.update(0);
  };
  t('road drag through pointer pipeline places road', () => {
    g.tools.setTool('road', { type: RoadType.Street });
    fire('pointermove', 5, 30);
    fire('pointerdown', 5, 30, { buttons: 1 });
    fire('pointermove', 9, 30, { buttons: 1 });
    fire('pointermove', 14, 30, { buttons: 1, shift: true });
    fire('pointerup', 14, 30, { shift: true });
    const ok = w.roadAt(5, 30) === RoadType.Street && w.roadAt(14, 30) === RoadType.Street && w.roadAt(10, 30) === RoadType.Street;
    return ok ? true : `roads ${w.roadAt(5, 30)} ${w.roadAt(10, 30)} ${w.roadAt(14, 30)}`;
  });
  t('chorded right-press cancels an in-progress road drag', () => {
    const before = w.roadAt(8, 36);
    fire('pointermove', 5, 36);
    fire('pointerdown', 5, 36, { buttons: 1 });
    fire('pointermove', 12, 36, { buttons: 1 });
    fire('pointermove', 12, 36, { button: 2, buttons: 3 });
    fire('pointermove', 12, 36, { button: 2, buttons: 1 });
    fire('pointerup', 12, 36);
    return before === RoadType.None && w.roadAt(8, 36) === RoadType.None && g.tools.current?.id === 'road' ? true : `road ${w.roadAt(8, 36)} tool ${g.tools.current?.id}`;
  });
  t('right-click (no drag) cancels the tool', () => {
    fire('pointerdown', 10, 33, { button: 2, buttons: 2 });
    fire('pointerup', 10, 33, { button: 2 });
    return g.tools.current === null ? true : `still ${g.tools.current.id}`;
  });
  t('zone brush stroke = one undo step; right-drag erases', () => {
    g.tools.setTool('zone', { zone: ZoneType.ResLow });
    A.clearHistory();
    const before = A.history.undoCount;
    fire('pointermove', 6, 31);
    fire('pointerdown', 6, 31, { buttons: 1 });
    for (let x = 7; x <= 13; x++) fire('pointermove', x, 32, { buttons: 1 });
    fire('pointerup', 13, 32);
    const steps = A.history.undoCount - before;
    const zoned = w.zoneAt(10, 32) === ZoneType.ResLow && w.zoneAt(10, 31) === ZoneType.ResLow;
    // right-drag erase
    fire('pointerdown', 7, 32, { button: 2, buttons: 2 });
    for (let x = 8; x <= 12; x++) fire('pointermove', x, 32, { buttons: 2 });
    fire('pointerup', 12, 32, { button: 2 });
    const erased = w.zoneAt(10, 32) === ZoneType.None;
    const stillOn = g.tools.current?.id === 'zone';
    g.tools.setTool(null);
    return steps === 1 && zoned && erased && stillOn ? true : `steps ${steps} zoned ${zoned} erased ${erased} tool ${stillOn}`;
  });
  t('touch: tap = click, pinch = gesture zoom', async () => true);
  const touchRes = await new Promise<string | true>((resolve) => {
    const gestures: { zoom: number }[] = [];
    const off = g.input.onGesture((ge) => gestures.push(ge));
    g.tools.setTool('bulldoze');
    const dozeBefore = w.roadAt(9, 30);
    // quick tap on a road cell → bulldozes it
    fire('pointerdown', 9, 30, { touch: true, id: 11, buttons: 1 });
    fire('pointerup', 9, 30, { touch: true, id: 11 });
    const tapped = dozeBefore !== RoadType.None && w.roadAt(9, 30) === RoadType.None;
    // two fingers spreading apart → zoom > 1, no bulldozing
    const roads0 = w.road.reduce((a, b) => a + (b ? 1 : 0), 0);
    fire('pointerdown', 18, 40, { touch: true, id: 21, buttons: 1 });
    fire('pointerdown', 22, 40, { touch: true, id: 22, buttons: 1 });
    for (let k = 1; k <= 6; k++) {
      fire('pointermove', 18 - k, 40, { touch: true, id: 21, buttons: 1 });
      fire('pointermove', 22 + k, 40, { touch: true, id: 22, buttons: 1 });
    }
    fire('pointerup', 12, 40, { touch: true, id: 21 });
    fire('pointerup', 28, 40, { touch: true, id: 22 });
    const roads1 = w.road.reduce((a, b) => a + (b ? 1 : 0), 0);
    off();
    g.tools.setTool(null);
    const zoom = gestures.reduce((a, ge) => a * ge.zoom, 1);
    resolve(tapped && zoom > 1.2 && roads0 === roads1 ? true : `tapped ${tapped} zoom ${zoom.toFixed(2)} roads ${roads0}->${roads1}`);
  });
  out[out.length - 1] = { name: 'touch: tap = click, pinch = gesture zoom', ok: touchRes === true, detail: touchRes === true ? '' : touchRes };
  return out;
}
