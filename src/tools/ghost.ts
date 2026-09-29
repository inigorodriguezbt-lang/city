// Building placement ghost shared by the place and move tools: the catalog
// preview model (from BuildingRenderer.createPreview), a footprint plate with
// per-cell validity, a front-access strip and coverage radius rings.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { CELL } from '../core/constants';
import { DIR_DX, DIR_DY, Dir, RoadType, type BuildingDef, type FieldId } from '../core/types';
import { overlayInfo } from '../data/overlays';
import { footprintAt, type BuildingCheck } from '../world/actions';
import { BoxLayer, buildingBox, GroundCircle, TileLayer, TONE } from './preview';

/** fields whose coverage is a nuisance (drawn as a warning ring) */
const NUISANCE: FieldId[] = ['pollution', 'noise', 'crime', 'traffic'];

const DIR_ORDER: Dir[] = [Dir.S, Dir.E, Dir.N, Dir.W];

/** usable access road for a service building (not rail/highway) */
function usableRoad(w: World, x: number, y: number, rail: boolean): boolean {
  const t = w.roadAt(x, y);
  if (rail) return t === RoadType.Rail;
  return t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Highway;
}

/**
 * Gap (in cells) between side `d` of a footprint and the nearest usable road
 * straight out from that side: 0 = touching, up to `max`, Infinity = none.
 */
export function frontGap(w: World, fx: number, fy: number, fw: number, fh: number, d: Dir, max = 2, rail = false): number {
  for (let k = 0; k <= max; k++) {
    if (d === Dir.N || d === Dir.S) {
      const y = d === Dir.N ? fy - 1 - k : fy + fh + k;
      for (let i = 0; i < fw; i++) if (usableRoad(w, fx + i, y, rail)) return k;
    } else {
      const x = d === Dir.W ? fx - 1 - k : fx + fw + k;
      for (let i = 0; i < fh; i++) if (usableRoad(w, x, fy + i, rail)) return k;
    }
  }
  return Infinity;
}

export interface Placement {
  /** center-cell argument for checkBuilding/placeBuilding */
  x: number;
  y: number;
  rot: Dir;
}

/**
 * Best placement near a world point: footprint centered on the cursor,
 * optionally auto-rotated toward the closest road and magnetically snapped
 * so the front edge touches it.
 */
/** true if any cell just behind the footprint (opposite its front) is water */
function backTouchesWater(w: World, fx: number, fy: number, fw: number, fh: number, front: Dir): boolean {
  const back = ((front + 2) % 4) as Dir;
  const cells: [number, number][] = [];
  if (back === Dir.N) for (let i = 0; i < fw; i++) cells.push([fx + i, fy - 1]);
  if (back === Dir.S) for (let i = 0; i < fw; i++) cells.push([fx + i, fy + fh]);
  if (back === Dir.W) for (let i = 0; i < fh; i++) cells.push([fx - 1, fy + i]);
  if (back === Dir.E) for (let i = 0; i < fh; i++) cells.push([fx + fw, fy + i]);
  return cells.some(([x, y]) => w.isWater(x, y));
}

export function smartPlacement(w: World, def: BuildingDef, wx: number, wz: number, rot: Dir, auto: boolean): Placement {
  const anchor = (r: Dir) => {
    const s = r === Dir.N || r === Dir.S ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
    const x0 = Math.round(wx / CELL - s.w / 2), y0 = Math.round(wz / CELL - s.h / 2);
    return { x: x0 + Math.floor(s.w / 2), y: y0 + Math.floor(s.h / 2) };
  };
  const rail = !!def.placement?.rail && def.placement?.road === false;
  // shoreline models (pumps, harbors, marinas…) put the water behind the lot
  const shore = !!def.placement?.shore;
  const evalDir = (r: Dir) => {
    const a = anchor(r);
    const fp = footprintAt(def, a.x, a.y, r);
    const gap = frontGap(w, fp.x, fp.y, fp.w, fp.h, r, 2, rail);
    return { a, gap, back: shore ? backTouchesWater(w, fp.x, fp.y, fp.w, fp.h, r) : true };
  };
  let best: { r: Dir; a: { x: number; y: number }; gap: number; back: boolean } | null = null;
  if (auto) {
    for (const r of [rot, ...DIR_ORDER.filter((d) => d !== rot)]) {
      const e = evalDir(r);
      const better = !best || (e.gap !== Infinity && best.gap === Infinity) || (e.gap !== Infinity && (e.back && !best.back ? e.gap <= best.gap + 1 : e.gap < best.gap && (e.back || !best.back)));
      if (better) best = { r, ...e };
    }
  }
  if (!best || best.gap === Infinity) {
    const e = evalDir(rot);
    best = { r: rot, ...e };
  }
  const g = best.gap;
  if (g > 0 && g !== Infinity) return { x: best.a.x + DIR_DX[best.r] * g, y: best.a.y + DIR_DY[best.r] * g, rot: best.r };
  return { x: best.a.x, y: best.a.y, rot: best.r };
}

export class BuildingGhost {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private modelKey = '';
  private tinted = new Map<THREE.Material, { emissive: THREE.Color; intensity: number }>();
  private owned = new Set<THREE.Material>();
  private ownedGeo = new Set<THREE.BufferGeometry>();
  private valid = true;
  readonly tiles = new TileLayer({ lift: 0.3 });
  private boxes = new BoxLayer(16);
  private ring = new GroundCircle({ color: TONE.ok, fill: 0.07, opacity: 0.9, ringWidth: 3.2, falloff: 0 });
  private nuisance = new GroundCircle({ color: TONE.warn, fill: 0.04, opacity: 0.75, ringWidth: 2.4, dashes: 48, falloff: 0 });
  private bob = 0;

  constructor(private game: Game) {
    this.root.name = 'building-ghost';
    this.root.add(this.tiles.mesh, this.ring.mesh, this.nuisance.mesh, this.boxes.mesh);
  }

  /** (re)create the preview model for defId + rot */
  setModel(def: BuildingDef, rot: Dir): void {
    const key = `${def.id}|${rot}`;
    if (key === this.modelKey && this.model) return;
    this.clearModel();
    this.modelKey = key;
    let obj: THREE.Object3D | null = null;
    try {
      obj = this.game.buildings.createPreview(def.id, rot);
    } catch (e) {
      console.warn('[tools] createPreview failed', e);
    }
    let hasMesh = false;
    obj?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) hasMesh = true;
    });
    if (!obj || !hasMesh) obj = this.fallbackModel(def, rot, obj);
    // clone materials we tint so shared catalog materials stay untouched
    const cloneOf = new Map<THREE.Material, THREE.Material>();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = mats.map((mm) => {
        const std = mm as THREE.MeshStandardMaterial;
        if (!std.emissive) return mm;
        const prev = cloneOf.get(mm);
        if (prev) return prev;
        const c = std.clone();
        cloneOf.set(mm, c);
        this.owned.add(c);
        this.tinted.set(c, { emissive: c.emissive.clone(), intensity: c.emissiveIntensity ?? 1 });
        return c;
      });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 22;
    });
    this.model = obj;
    this.root.add(obj);
    this.applyTint();
  }

  /** translucent box stand-in when no catalog model is available */
  private fallbackModel(def: BuildingDef, rot: Dir, prev: THREE.Object3D | null): THREE.Object3D {
    const g = prev ?? new THREE.Group();
    const s = rot === Dir.N || rot === Dir.S ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
    const hgt = Math.max(4, Math.min(80, def.height || 10));
    const geo = new THREE.BoxGeometry(s.w * CELL * 0.86, hgt, s.h * CELL * 0.86);
    geo.translate(0, hgt / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.55, emissive: 0x0b1a2a });
    const box = new THREE.Mesh(geo, mat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    // a small "door" marker on the front (+Z local, rotated)
    const door = new THREE.Mesh(new THREE.BoxGeometry(Math.min(6, s.w * CELL * 0.3), 3.2, 0.6), new THREE.MeshStandardMaterial({ color: 0x4cc2ff, emissive: 0x1a5a80 }));
    const frontDist = ((rot === Dir.N || rot === Dir.S ? s.h : s.w) * CELL * 0.86) / 2;
    const ang = rot === Dir.S ? 0 : rot === Dir.E ? Math.PI / 2 : rot === Dir.N ? Math.PI : -Math.PI / 2;
    door.position.set(Math.sin(ang) * frontDist, 1.6, Math.cos(ang) * frontDist);
    door.rotation.y = ang;
    for (const m of [mat, edges.material as THREE.Material, door.material as THREE.Material]) this.owned.add(m);
    for (const q of [geo, edges.geometry, door.geometry]) this.ownedGeo.add(q);
    g.add(box, edges, door);
    return g;
  }

  private clearModel(): void {
    if (!this.model) return;
    this.model.removeFromParent();
    for (const m of this.owned) m.dispose();
    for (const q of this.ownedGeo) q.dispose();
    this.owned.clear();
    this.ownedGeo.clear();
    this.tinted.clear();
    this.model = null;
    this.modelKey = '';
  }

  private applyTint(): void {
    for (const [m, orig] of this.tinted) {
      const std = m as THREE.MeshStandardMaterial;
      if (this.valid) {
        std.emissive.copy(orig.emissive);
        std.emissiveIntensity = orig.intensity;
      } else {
        std.emissive.setHex(0xb01818);
        std.emissiveIntensity = 0.85;
      }
    }
  }

  /** position the ghost and draw its footprint for a placement check */
  update(w: World, def: BuildingDef, c: BuildingCheck, time: number): void {
    this.setModel(def, c.rot);
    const site = c.siteOk;
    if (site !== this.valid) {
      this.valid = site;
      this.applyTint();
    }
    const cx = (c.x + c.w / 2) * CELL, cz = (c.y + c.h / 2) * CELL;
    // gentle hover bob so the ghost reads as "not built yet"
    this.bob = Math.sin(time * 3) * 0.25 + 0.35;
    if (this.model) this.model.position.set(cx, c.ground + this.bob, cz);

    // footprint plate
    const t = this.tiles;
    t.begin();
    const blocked = new Set(c.blocked.map((b) => b.y * 65536 + b.x));
    const replaced = new Set(c.replaces);
    for (let y = c.y; y < c.y + c.h; y++)
      for (let x = c.x; x < c.x + c.w; x++) {
        if (!w.inBounds(x, y)) continue;
        const bad = blocked.has(y * 65536 + x);
        const rep = !bad && replaced.has(w.bldg[w.idx(x, y)]);
        const col = bad ? TONE.bad : rep ? TONE.warn : site ? (c.ok ? TONE.ok : TONE.existing) : TONE.bad;
        t.add(w, x, y, col, bad ? 0.75 : site ? 0.5 : 0.4, def.placement?.onWater ? { flat: c.ground } : undefined);
      }
    // front access strip (cells just outside the front edge)
    const r = c.rot;
    const front: { x: number; y: number }[] = [];
    if (r === Dir.N) for (let i = 0; i < c.w; i++) front.push({ x: c.x + i, y: c.y - 1 });
    else if (r === Dir.S) for (let i = 0; i < c.w; i++) front.push({ x: c.x + i, y: c.y + c.h });
    else if (r === Dir.W) for (let i = 0; i < c.h; i++) front.push({ x: c.x - 1, y: c.y + i });
    else for (let i = 0; i < c.h; i++) front.push({ x: c.x + c.w, y: c.y + i });
    if (def.placement?.road !== false)
      for (const f of front) t.add(w, f.x, f.y, c.frontage ? TONE.accent : TONE.warn, c.frontage ? 0.4 : 0.28, { lift: 0.25 });
    t.end();
    t.tick(time);
    // zoned buildings that will be demolished
    const bx = this.boxes;
    bx.begin();
    for (const id of c.replaces) {
      const b = w.buildings.get(id);
      if (!b) continue;
      const bb = buildingBox(this.game, w, b);
      bx.add(b.x, b.y, b.w, b.h, bb.ground, bb.height, TONE.warn);
    }
    bx.end();
    bx.tick(time);

    // coverage rings
    let best: { r: number; field: FieldId } | null = null;
    let worst = 0;
    for (const e of def.effects ?? []) {
      if (e.radius <= 0) continue;
      if (NUISANCE.includes(e.field) ? e.amount > 0 : e.amount < 0) worst = Math.max(worst, e.radius);
      else if (!best || e.radius > best.r) best = { r: e.radius, field: e.field };
    }
    if (best) {
      const info = overlayInfo(best.field);
      const hex = info?.highIsGood ? info.ramp[info.ramp.length - 1] : undefined;
      const col = hex ? parseInt(hex.slice(1), 16) : TONE.ok;
      this.ring.setStyle({ color: site ? col : TONE.bad });
      this.ring.set(w, cx, cz, best.r * CELL);
      this.ring.tick(time);
    } else this.ring.hide();
    if (worst > 0) {
      this.nuisance.set(w, cx, cz, worst * CELL);
      this.nuisance.tick(time);
    } else this.nuisance.hide();
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.clearModel();
    this.tiles.dispose();
    this.boxes.dispose();
    this.ring.dispose();
    this.nuisance.dispose();
    this.root.removeFromParent();
  }
}
