// BuildingRenderer — chunked, LOD'd renderer for every building in the world.
//
//  * Models: zoned buildings come from the zoned generators (zoned/), service
//    and landmark buildings from the model registry (getModel(def.model)) with
//    a civic fallback. Models are cached per building, keyed by everything that
//    affects geometry (def/zone, level, footprint, style, seed, construction
//    stage, abandoned/collapsed/burned state, detail setting).
//  * Detail chunks (16×16 cells) near the camera merge all their buildings into
//    ONE mesh drawn with the chunk "uber" material (+ one mesh for animated
//    parts, + one instanced glow mesh for night lights). Per-building data
//    (seed, occupancy schedule, style, lit level, condition) rides in `aInfo`.
//  * LOD chunks (32×32 cells) cover everything else with merged boxes (LOD
//    masses) whose walls draw a simplified lit window grid; the sub-ranges of
//    detail chunks that are currently shown in full are skipped via draw groups.
//  * Rebuilds are budgeted per frame (≈4 ms), nearest first; models for far
//    buildings are generated in the background for accurate LOD, with cheap
//    provisional boxes until then.
//  * Emitters (smoke, steam, dust, fountains) are registered with the effects
//    renderer for buildings in detail range; problem icons, highlight overlays
//    and placement previews are provided too.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { BFlag, Dir, Layer, Problem, ZoneType, type Building, type Rect } from '../../core/types';
import { CELL } from '../../core/constants';
import { ChunkGrid } from '../../core/chunks';
import { RNG, hash2, hashString } from '../../core/rng';
import { styleDef } from '../../data/styles';
import { themeDef } from '../../data/themes';
import { zoneById, zoneDef } from '../../data/zones';
import { buildingDef } from '../../data/buildings';
import { getModel } from './registry';
import type { ModelContext, ModelEmitter, ModelLight, ModelPart, ModelResult } from './types';
import { getAnimDepthMaterials, getChunkMaterial, ghostMaterial, updateMaterials } from './materials';
import { buildZoned, schedFor } from './zoned';
import { civicFallback } from './zoned/civic';
import { constructionModel, constructionStage, rubbleModel, weatherModel } from './zoned/states';
import { massesFromParts } from './zoned/lodgen';
import { DetailMergeJob, LOD_VERTS_PER_MASS, mergeLod, patchInfo, type MergeItem, type LodItem } from './zoned/merge';
import { buildGlowMesh, updateGlow, type WorldLight } from './zoned/glow';
import { Cond, LodFacade, STYLE_INDEX, Sched, packInfo } from './zoned/constants';
import { addFac, type LodMass, type ZAnim, type ZModel } from './zoned/fab';
import { ProblemIcons, topProblems, type IconInstance } from './icons/ProblemIcons';

const DETAIL_CHUNK = 16;
const LOD_CHUNK = 32;
/** frame budget for model generation + merging (ms) */
const BUDGET_MS = 4;
/** cached detailed geometry budget (vertices) before far models drop their geometry */
const VERT_BUDGET = 2_600_000;
const ICON_RANGE = 1500;
const EMPTY_F32 = new Float32Array(0);

type Mode = 0 | 1 | 2; // hidden, lod, detail

interface CachedModel {
  key: string;
  masses: LodMass[];
  lights: ModelLight[];
  emitters: ModelEmitter[];
  height: number;
  parts: ModelPart[] | null;
  anims: ZAnim[] | null;
  verts: number;
  used: number;
  /** estimated boxes only (model not generated yet) */
  provisional: boolean;
}

interface BInfo {
  b: Building;
  chunk: number;
  matrix: THREE.Matrix4;
  ground: number;
  key: string;
  sig: number;
  info: number;
  model: CachedModel | null;
  emitters: number[];
  cx: number;
  cz: number;
  fw: number;
  fd: number;
}

interface DetailChunk {
  key: number;
  ids: Set<number>;
  cx: number;
  cz: number;
  mode: Mode;
  /** geometry reflects current state */
  clean: boolean;
  /** a detail mesh exists and may be shown (possibly slightly stale) */
  ready: boolean;
  mesh: THREE.Mesh | null;
  anim: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  dist: number;
  /** incremental merge in progress (cancelled when the chunk is dirtied) */
  job: DetailMergeJob | null;
  jobIds: number[];
  /** building id → [static start, static count, anim start, anim count] in the current meshes */
  ranges: Map<number, [number, number, number, number]>;
  /** lamp/neon glow needs rebuilding (a building's lights switched on/off) */
  glowDirty: boolean;
}

interface LodChunk {
  key: number;
  mesh: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  clean: boolean;
  /** vertex range per detail sub-chunk key */
  ranges: Map<number, [number, number]>;
  /** vertex range per building id (for in-place aInfo patches) */
  bRanges: Map<number, [number, number]>;
  groupsSig: string;
  cx: number;
  cz: number;
}

const ROT_ANGLE: Record<number, number> = { [Dir.S]: 0, [Dir.E]: Math.PI / 2, [Dir.N]: Math.PI, [Dir.W]: -Math.PI / 2 };

export class BuildingRenderer {
  protected world: World | null = null;
  readonly group = new THREE.Group();

  private detailGrid: ChunkGrid | null = null;
  private lodGrid: ChunkGrid | null = null;
  private dchunks = new Map<number, DetailChunk>();
  private lchunks = new Map<number, LodChunk>();
  private binfo = new Map<number, BInfo>();
  private cachedVerts = 0;
  private unsub: (() => void)[] = [];
  private detailGroup = new THREE.Group();
  private lodGroup = new THREE.Group();
  private glowGroup = new THREE.Group();
  private icons = new ProblemIcons();
  private iconTimer = 0;
  private pollTimer = 0;
  private pollCursor = 0;
  private pollIds: number[] = [];
  private frame = 0;
  private refineQueue: number[] = [];
  private refineDirty = new Set<number>();
  private detailSig = '';
  private settingsSig = '';
  private hl: { id: number; color: THREE.Color; mesh: THREE.Group } | null = null;
  private hlMat: THREE.ShaderMaterial | null = null;
  private tmpV = new THREE.Vector3();
  private pendingDetail: DetailChunk[] = [];
  /** finished models of buildings under construction (LRU, keyed without state) */
  private fullCache = new Map<string, ZModel>();

  constructor(protected game: Game) {
    this.group.name = 'buildings';
    this.detailGroup.name = 'buildings:detail';
    this.lodGroup.name = 'buildings:lod';
    this.glowGroup.name = 'buildings:glow';
    this.group.add(this.lodGroup, this.detailGroup, this.glowGroup, this.icons.mesh);
    game.renderer.scene.add(this.group);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.detailGrid = new ChunkGrid(world.size, DETAIL_CHUNK);
    this.lodGrid = new ChunkGrid(world.size, LOD_CHUNK);
    this.settingsSig = this.currentSettingsSig();
    for (const b of world.buildings.values()) this.addBuilding(b, false);
    const ev = this.game.events;
    this.unsub.push(
      ev.on('building:added', (b) => this.addBuilding(b, true)),
      ev.on('building:removed', (b) => this.removeBuilding(b)),
      ev.on('building:changed', (b) => this.changeBuilding(b)),
      ev.on('world:changed', ({ rect, layers }) => this.onWorldChanged(rect, layers)),
      ev.on('settings:changed', () => this.onSettings()),
    );
  }

  onWorldUnloaded(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.highlight(null);
    for (const bi of this.binfo.values()) this.dropEmitters(bi);
    for (const c of this.dchunks.values()) this.disposeDetail(c);
    for (const c of this.lchunks.values()) this.disposeLod(c);
    for (const bi of this.binfo.values()) this.releaseModel(bi);
    this.dchunks.clear();
    this.lchunks.clear();
    this.binfo.clear();
    this.refineQueue = [];
    this.refineDirty.clear();
    for (const m of this.fullCache.values()) {
      for (const p of m.parts) p.geometry.dispose();
      for (const an of m.anims) an.part.geometry.dispose();
    }
    this.fullCache.clear();
    this.pollIds = [];
    this.cachedVerts = 0;
    this.icons.set([]);
    this.detailGrid = this.lodGrid = null;
    this.world = null;
  }

  // ── building bookkeeping ──────────────────────────────────────────────
  private addBuilding(b: Building, live: boolean): void {
    if (!this.world || !this.detailGrid || this.binfo.has(b.id)) return;
    const n = b.rot === Dir.N || b.rot === Dir.S;
    const fw = n ? b.w : b.h, fd = n ? b.h : b.w;
    const cx = (b.x + b.w / 2) * CELL, cz = (b.y + b.h / 2) * CELL;
    const chunk = this.detailGrid.chunkOfCell(Math.min(this.world.size - 1, Math.floor(b.x + b.w / 2)), Math.min(this.world.size - 1, Math.floor(b.y + b.h / 2)));
    const bi: BInfo = { b, chunk, matrix: new THREE.Matrix4(), ground: 0, key: '', sig: 0, info: 0, model: null, emitters: [], cx, cz, fw, fd };
    this.placeBuilding(bi);
    bi.key = this.modelKey(b, fw, fd);
    bi.sig = this.signature(b);
    bi.info = this.infoOf(b);
    this.binfo.set(b.id, bi);
    this.pollIds.push(b.id);
    const dc = this.detailChunk(chunk);
    dc.ids.add(b.id);
    this.markChunk(chunk);
    this.refineQueue.push(b.id);
    void live;
  }

  private removeBuilding(b: Building): void {
    const bi = this.binfo.get(b.id);
    if (!bi) return;
    this.dropEmitters(bi);
    this.releaseModel(bi);
    this.binfo.delete(b.id);
    const dc = this.dchunks.get(bi.chunk);
    if (dc) dc.ids.delete(b.id);
    this.markChunk(bi.chunk);
    if (this.hl?.id === b.id) this.highlight(null);
  }

  private changeBuilding(b: Building): void {
    const bi = this.binfo.get(b.id);
    if (!bi) return this.addBuilding(b, true);
    bi.b = b;
    this.refresh(bi, true);
  }

  /** re-evaluate a building's model key / info. Geometry changes re-merge the
   *  chunk; info-only changes (lit level, fire, flood) patch vertices in place. */
  private refresh(bi: BInfo, force: boolean): void {
    const key = this.modelKey(bi.b, bi.fw, bi.fd);
    const info = this.infoOf(bi.b);
    const sig = this.signature(bi.b);
    if (key !== bi.key) {
      this.releaseModel(bi);
      bi.key = key;
      bi.info = info;
      bi.sig = sig;
      this.refineQueue.push(bi.b.id);
      this.markChunk(bi.chunk);
    } else {
      if (info !== bi.info) {
        bi.info = info;
        this.patchBuilding(bi);
      }
      if (sig !== bi.sig) {
        bi.sig = sig;
        const dc = this.dchunks.get(bi.chunk);
        if (dc) dc.glowDirty = true;
      }
      if (force && !this.dchunks.get(bi.chunk)?.ranges.has(bi.b.id)) this.markChunk(bi.chunk);
    }
    if (this.hl?.id === bi.b.id && key !== this.hlKey) this.rebuildHighlight();
  }

  /** write a building's packed info into the merged detail + LOD meshes */
  private patchBuilding(bi: BInfo): void {
    const id = bi.b.id;
    const dc = this.dchunks.get(bi.chunk);
    if (dc) {
      if (dc.job) dc.job = null; // restart the merge with the new info
      const r = dc.ranges.get(id);
      if (r) {
        if (dc.mesh) patchInfo(dc.mesh.geometry, r[0], r[1], bi.info);
        if (dc.anim) patchInfo(dc.anim.geometry, r[2], r[3], bi.info);
      } else dc.clean = false;
    }
    const l = this.lchunks.get(this.lodKeyOf(bi.chunk));
    if (l) {
      const r = l.bRanges.get(id);
      if (r && l.mesh) patchInfo(l.mesh.geometry, r[0], r[1], bi.info);
      else l.clean = false;
    }
  }

  private onWorldChanged(r: Rect, layers: number): void {
    if (!this.world || !this.detailGrid || !(layers & Layer.Terrain)) return;
    const g = this.detailGrid;
    const n = g.chunksPerSide;
    const c0x = Math.max(0, Math.floor((r.x0 - 1) / DETAIL_CHUNK)), c1x = Math.min(n - 1, Math.floor((r.x1 + 1) / DETAIL_CHUNK));
    const c0y = Math.max(0, Math.floor((r.y0 - 1) / DETAIL_CHUNK)), c1y = Math.min(n - 1, Math.floor((r.y1 + 1) / DETAIL_CHUNK));
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const dc = this.dchunks.get(g.key(cx, cy));
        if (!dc) continue;
        for (const id of dc.ids) {
          const bi = this.binfo.get(id);
          if (!bi) continue;
          const b = bi.b;
          if (b.x + b.w < r.x0 - 1 || b.x > r.x1 + 1 || b.y + b.h < r.y0 - 1 || b.y > r.y1 + 1) continue;
          const old = bi.ground;
          this.placeBuilding(bi);
          if (Math.abs(old - bi.ground) > 0.01) this.markChunk(bi.chunk);
        }
      }
  }

  private onSettings(): void {
    const sig = this.currentSettingsSig();
    if (sig === this.settingsSig) return;
    const detailChanged = sig.split('|')[0] !== this.settingsSig.split('|')[0];
    this.settingsSig = sig;
    for (const c of this.dchunks.values()) {
      for (const m of [c.mesh, c.anim]) if (m) m.castShadow = this.shadows();
    }
    if (detailChanged) {
      for (const bi of this.binfo.values()) {
        this.releaseModel(bi);
        bi.key = this.modelKey(bi.b, bi.fw, bi.fd);
        this.refineQueue.push(bi.b.id);
      }
      for (const k of this.dchunks.keys()) this.markChunk(k);
    }
  }

  private currentSettingsSig(): string {
    const g = this.game.settings.value.graphics;
    return `${g.buildingDetail}|${g.shadows}`;
  }

  private shadows(): boolean {
    return this.game.settings.value.graphics.shadows !== 'off';
  }

  private detailSetting(): 'low' | 'medium' | 'high' {
    return this.game.settings.value.graphics.buildingDetail ?? 'high';
  }

  /** world transform: rotate by b.rot, translate to footprint centre at lot ground */
  private placeBuilding(bi: BInfo): void {
    const w = this.world!;
    const b = bi.b;
    const h = (w.vertexHeight(b.x, b.y) + w.vertexHeight(b.x + b.w, b.y) + w.vertexHeight(b.x, b.y + b.h) + w.vertexHeight(b.x + b.w, b.y + b.h)) / 4;
    bi.ground = h;
    const a = ROT_ANGLE[b.rot] ?? 0;
    const c = Math.cos(a), s = Math.sin(a);
    // rotation about Y then translation (column-major)
    bi.matrix.set(c, 0, s, bi.cx, 0, 1, 0, h, -s, 0, c, bi.cz, 0, 0, 0, 1);
  }

  private detailChunk(key: number): DetailChunk {
    let c = this.dchunks.get(key);
    if (!c) {
      const [x, y] = this.detailGrid!.coords(key);
      c = { key, ids: new Set(), cx: (x + 0.5) * DETAIL_CHUNK * CELL, cz: (y + 0.5) * DETAIL_CHUNK * CELL, mode: 1, clean: false, ready: false, mesh: null, anim: null, glow: null, dist: Infinity, job: null, jobIds: [], ranges: new Map(), glowDirty: false };
      this.dchunks.set(key, c);
    }
    return c;
  }

  private lodKeyOf(detailKey: number): number {
    const [x, y] = this.detailGrid!.coords(detailKey);
    return this.lodGrid!.key(x >> 1, y >> 1);
  }

  private lodChunk(key: number): LodChunk {
    let c = this.lchunks.get(key);
    if (!c) {
      const [x, y] = this.lodGrid!.coords(key);
      c = { key, mesh: null, glow: null, clean: false, ranges: new Map(), bRanges: new Map(), groupsSig: '', cx: (x + 0.5) * LOD_CHUNK * CELL, cz: (y + 0.5) * LOD_CHUNK * CELL };
      this.lchunks.set(key, c);
    }
    return c;
  }

  private markChunk(detailKey: number): void {
    const dc = this.detailChunk(detailKey);
    dc.clean = false;
    dc.job = null;
    this.lodChunk(this.lodKeyOf(detailKey)).clean = false;
  }

  // ── keys / packed info ────────────────────────────────────────────────
  private stateOf(b: Building): string {
    if (b.flags & BFlag.Collapsed) return 'x';
    if (b.built < 1) return 'c' + constructionStage(b.built);
    if (b.flags & BFlag.Burned) return 'b';
    if (b.flags & BFlag.Abandoned) return 'a';
    return 'n';
  }

  private modelKey(b: Building, fw: number, fd: number): string {
    return `${b.defId}|${b.kind === 'zoned' ? b.level : 1}|${fw}x${fd}|${b.style}|${b.seed}|${this.stateOf(b)}|${this.detailSetting()}`;
  }

  /** 1 when the building's lamps / neon / floodlights should glow at night */
  private signature(b: Building): number {
    return this.lampsOn(b) ? 1 : 0;
  }

  private lampsOn(b: Building): boolean {
    return !(b.flags & (BFlag.Abandoned | BFlag.Burned | BFlag.Collapsed)) && b.built >= 1 && this.litLevel(b) > 0;
  }

  private litLevel(b: Building): 0 | 1 | 2 | 3 {
    if (b.problems & Problem.NoPower || b.flags & BFlag.Disabled) return 0;
    if (b.kind === 'zoned') {
      const occ = b.maxResidents > 0 ? b.residents / b.maxResidents : b.jobs > 0 ? b.workers / b.jobs : 1;
      if (occ < 0.35) return 1;
      if (b.level >= 4 && (b.zone === ZoneType.ComHigh || b.zone === ZoneType.Office)) return 3;
    }
    return 2;
  }

  private infoOf(b: Building): number {
    let cond = 0;
    if (b.flags & BFlag.Abandoned) cond |= Cond.Abandoned;
    if (b.flags & BFlag.Burned) cond |= Cond.Burned;
    if (b.flags & BFlag.Flooded) cond |= Cond.Flooded;
    if (b.flags & BFlag.OnFire) cond |= Cond.OnFire;
    if (b.built < 1) cond |= Cond.Construction;
    const sched = b.kind === 'zoned' ? schedFor(b.zone) : this.serviceSched(b);
    return packInfo(b.seed, sched, STYLE_INDEX[b.style] ?? 0, this.litLevel(b), cond);
  }

  private serviceSched(b: Building): Sched {
    const cat = buildingDef(b.defId)?.category;
    if (cat === 'health' || cat === 'fire' || cat === 'police' || cat === 'power' || cat === 'water' || cat === 'transit' || cat === 'disaster') return Sched.Civic;
    if (cat === 'education' || cat === 'government') return Sched.Office;
    if (cat === 'tourism') return Sched.Hotel;
    if (cat === 'industry' || cat === 'garbage') return Sched.Industrial;
    return Sched.Commercial;
  }

  // ── model generation ─────────────────────────────────────────────────
  private context(b: Building | null, zone: ZoneType, level: number, fw: number, fd: number, style: string, seed: number, defId: string, detail: 'low' | 'medium' | 'high'): ModelContext {
    const theme = themeDef(this.world?.settings.theme ?? 'temperate');
    const def = defId.startsWith('zoned:') ? undefined : buildingDef(defId);
    return { b, def, width: fw * CELL, depth: fd * CELL, level, zone, style: styleDef(style as never), theme, rng: new RNG(hash2(seed, 0x51ed)), detail };
  }

  /** Generate the model for a building in its current state. */
  private generate(bi: BInfo, detail: 'low' | 'medium' | 'high'): ZModel {
    const b = bi.b;
    const ctx = this.context(b, b.zone, b.kind === 'zoned' ? b.level : 1, bi.fw, bi.fd, b.style, b.seed, b.defId, detail);
    const st = this.stateOf(b);
    // buildings under construction step through ~9 stages: keep their finished
    // model around so each stage only re-clips it (and completion is free)
    const base = `${b.defId}|${ctx.level}|${bi.fw}x${bi.fd}|${b.style}|${b.seed}|${detail}`;
    let full = this.fullCache.get(base);
    if (full) this.fullCache.delete(base);
    else full = this.fullModel(b.kind, b.defId, ctx);
    if (st === 'n') return full;
    if (st[0] === 'c') {
      this.fullCache.set(base, full);
      if (this.fullCache.size > 64) this.fullCache.delete(this.fullCache.keys().next().value as string);
    }
    const vctx = { ...ctx, rng: new RNG(hash2(b.seed, 0x7a7e)) };
    if (st === 'x') return rubbleModel(full, vctx);
    if (st[0] === 'c') return constructionModel(full, vctx, b.built);
    return weatherModel(full, st === 'b' ? 'burned' : 'abandoned');
  }

  /** Full (normal state) model for a zoned or catalog building. */
  private fullModel(kind: Building['kind'], defId: string, ctx: ModelContext): ZModel {
    if (kind === 'zoned' || defId.startsWith('zoned:')) return buildZoned(ctx);
    const def = ctx.def;
    let res: ModelResult | null = null;
    const fn = def ? getModel(def.model) : undefined;
    if (fn) {
      try {
        res = fn(ctx);
      } catch (e) {
        console.warn(`[buildings] model "${def?.model}" failed, using civic fallback`, e);
        res = null;
      }
    }
    if (!res) return civicFallback(ctx);
    return this.adopt(res, ctx);
  }

  /** Normalize a registry ModelResult into a ZModel (facade attr + LOD masses). */
  private adopt(res: ModelResult, ctx: ModelContext): ZModel {
    for (const p of res.parts) if (!p.geometry.getAttribute('aFac')) addFac(p.geometry, 0);
    const anims: ZAnim[] = (res.anims ?? []).map((a) => {
      if (!a.part.geometry.getAttribute('aFac')) addFac(a.part.geometry, 0);
      return a;
    });
    const masses = (res as Partial<ZModel>).masses ?? massesFromParts(res.parts, ctx.width, ctx.depth);
    if (!masses.length) masses.push({ cx: 0, cz: 0, w: ctx.width * 0.6, d: ctx.depth * 0.6, y0: 0, h: Math.max(3, res.height * 0.8), rot: 0, wall: [0.7, 0.7, 0.68], roof: [0.45, 0.45, 0.45], fac: LodFacade.Punched });
    return { parts: res.parts, anims, lights: res.lights ?? [], emitters: res.emitters ?? [], masses, height: res.height };
  }

  private ensureModel(bi: BInfo, needGeometry: boolean): boolean {
    const m = bi.model;
    if (m && !m.provisional && (!needGeometry || m.parts)) {
      m.used = this.frame;
      return false;
    }
    const z = this.generate(bi, this.detailSetting());
    const verts = z.parts.reduce((a, p) => a + p.geometry.getAttribute('position').count, 0) + z.anims.reduce((a, p) => a + p.part.geometry.getAttribute('position').count, 0);
    this.releaseModel(bi);
    bi.model = { key: bi.key, masses: z.masses, lights: z.lights, emitters: z.emitters, height: z.height, parts: z.parts, anims: z.anims, verts, used: this.frame, provisional: false };
    this.cachedVerts += verts;
    if (!needGeometry) this.dropGeometry(bi.model);
    return true;
  }

  private dropGeometry(m: CachedModel): void {
    if (!m.parts) return;
    for (const p of m.parts) p.geometry.dispose();
    for (const a of m.anims ?? []) a.part.geometry.dispose();
    m.parts = null;
    m.anims = null;
    this.cachedVerts -= m.verts;
  }

  private releaseModel(bi: BInfo): void {
    if (!bi.model) return;
    this.dropGeometry(bi.model);
    bi.model = null;
  }

  /** Cheap placeholder boxes for LOD before the real model exists. */
  private provisional(bi: BInfo): CachedModel {
    const b = bi.b;
    const w = bi.fw * CELL, d = bi.fd * CELL;
    let h = 8, cover = 0.6;
    const L = b.level;
    switch (b.zone) {
      case ZoneType.ResLow: h = 6 + L; cover = 0.35; break;
      case ZoneType.ResMed: h = 6 + L * 3.4; cover = 0.55; break;
      case ZoneType.ResHigh: h = [0, 32, 45, 62, 85, 115][L] ?? 40; cover = 0.4; break;
      case ZoneType.ComLow: h = 5 + L * 1.8; cover = 0.55; break;
      case ZoneType.ComHigh: h = 12 + L * 9; cover = 0.55; break;
      case ZoneType.Office: h = [0, 24, 44, 76, 120, 180][L] ?? 40; cover = 0.4; break;
      case ZoneType.MixedUse: h = 10 + L * 4; cover = 0.55; break;
      case ZoneType.Farming: h = 2; cover = 0.2; break;
      default: h = b.kind === 'service' ? buildingDef(b.defId)?.height ?? 10 : 10; cover = 0.5;
    }
    const built = b.built < 1 ? Math.max(0.1, b.built) : 1;
    const s = hash2(b.seed, 3) / 4294967296;
    const wall: [number, number, number] = b.flags & BFlag.Abandoned ? [0.35, 0.33, 0.3] : [0.62 + s * 0.2, 0.6 + s * 0.15, 0.56 + s * 0.1];
    const fac = b.zone === ZoneType.Office ? LodFacade.Office : b.zone === ZoneType.ResLow ? LodFacade.House : b.zone === ZoneType.Industry ? LodFacade.Industrial : LodFacade.Punched;
    return {
      key: bi.key, masses: [{ cx: 0, cz: -d * 0.1, w: w * Math.sqrt(cover) * 1.1, d: d * Math.sqrt(cover), y0: 0, h: h * built, rot: 0, wall, roof: [0.42, 0.41, 0.4], fac }],
      lights: [], emitters: [], height: h * built, parts: null, anims: null, verts: 0, used: this.frame, provisional: true,
    };
  }

  private evict(): void {
    if (this.cachedVerts <= VERT_BUDGET) return;
    // drop geometry of models whose chunk is not shown in detail, least recently used first
    const cands: BInfo[] = [];
    for (const bi of this.binfo.values()) {
      if (!bi.model?.parts) continue;
      const dc = this.dchunks.get(bi.chunk);
      if (dc && dc.mode === 2) continue;
      cands.push(bi);
    }
    cands.sort((a, b) => a.model!.used - b.model!.used);
    for (const bi of cands) {
      if (this.cachedVerts <= VERT_BUDGET * 0.85) break;
      this.dropGeometry(bi.model!);
    }
  }

  // ── per frame ─────────────────────────────────────────────────────────
  update(dt: number): void {
    const game = this.game;
    const night = game.renderer.lighting.night;
    const hour = this.world?.time.hour ?? 12;
    updateMaterials(night, game.time, hour, game.time);
    const viewH = game.renderer.renderer.domElement.height || 800;
    updateGlow(night, game.time, viewH);
    this.icons.update(game.time, viewH);
    this.glowGroup.visible = night > 0.03;
    if (this.hl) this.animateHighlight();
    if (!this.world || !this.detailGrid) return;
    this.frame++;
    void dt;
    const t0 = performance.now();
    const cam = game.renderer.camera.position;
    this.classify(cam);
    this.poll(dt);
    this.rebuildDetail(t0);
    this.rebuildLod(t0);
    this.refine(t0);
    this.updateLodGroups();
    this.evict();
    this.iconTimer -= dt;
    if (this.iconTimer <= 0) {
      this.iconTimer = 0.4;
      this.updateIcons(cam);
    }
  }

  /** distance-based mode per detail chunk (with hysteresis) */
  private classify(cam: THREE.Vector3): void {
    const g = this.game.settings.value.graphics;
    const dk = g.buildingDetail === 'low' ? 0.65 : g.buildingDetail === 'medium' ? 0.9 : 1.2;
    const detailD = 900 * dk;
    const renderD = Math.max(1500, (g.renderDistance ?? 10) * 32 * CELL);
    const alt = Math.max(0, cam.y - (this.world?.heightAt(cam.x, cam.z) ?? 0));
    let sig = '';
    for (const c of this.dchunks.values()) {
      const dx = c.cx - cam.x, dz = c.cz - cam.z;
      const d = Math.sqrt(dx * dx + dz * dz + alt * alt * 0.6);
      c.dist = d;
      let mode: Mode;
      if (d > renderD) mode = 0;
      else if (d < detailD - DETAIL_CHUNK * CELL * 0.35 || (c.mode === 2 && d < detailD * 1.12)) mode = 2;
      else mode = 1;
      if (!c.ids.size) mode = mode === 2 ? 2 : mode;
      if (mode !== c.mode) {
        if (c.mode === 2 && mode !== 2) this.leaveDetail(c);
        c.mode = mode;
      }
      if (mode === 2 && c.ready) sig += c.key + ',';
    }
    if (sig !== this.detailSig) {
      this.detailSig = sig;
      for (const l of this.lchunks.values()) l.groupsSig = '';
    }
    for (const l of this.lchunks.values()) {
      const dx = l.cx - cam.x, dz = l.cz - cam.z;
      const vis = Math.sqrt(dx * dx + dz * dz) < renderD + LOD_CHUNK * CELL;
      if (l.mesh) l.mesh.visible = vis;
      if (l.glow) l.glow.visible = vis;
    }
  }

  private leaveDetail(c: DetailChunk): void {
    // free the detailed meshes (models stay cached for a quick return)
    for (const id of c.ids) {
      const bi = this.binfo.get(id);
      if (bi) this.dropEmitters(bi);
    }
    this.disposeDetail(c);
    c.ready = false;
    c.job = null;
    c.jobIds = [];
  }

  /** round-robin check for state changes that did not raise events (construction progress, occupancy, power) */
  private poll(dt: number): void {
    this.pollTimer -= dt;
    if (this.pollTimer > 0) return;
    this.pollTimer = 0.05;
    const n = Math.min(this.pollIds.length, 300);
    for (let i = 0; i < n; i++) {
      if (this.pollCursor >= this.pollIds.length) this.pollCursor = 0;
      const id = this.pollIds[this.pollCursor];
      const bi = this.binfo.get(id);
      if (!bi) {
        // compact removed ids lazily
        this.pollIds[this.pollCursor] = this.pollIds[this.pollIds.length - 1];
        this.pollIds.pop();
        continue;
      }
      this.pollCursor++;
      const sig = this.signature(bi.b);
      const info = this.infoOf(bi.b);
      if (sig !== bi.sig || info !== bi.info) this.refresh(bi, false);
    }
  }

  private rebuildDetail(t0: number): void {
    const pending = this.pendingDetail;
    pending.length = 0;
    for (const c of this.dchunks.values()) {
      if (c.mode !== 2) continue;
      if (!c.clean || !c.ready) pending.push(c);
      else if (c.glowDirty) this.rebuildGlow(c);
    }
    if (!pending.length) return;
    pending.sort((a, b) => a.dist - b.dist);
    let first = true;
    for (const c of pending) {
      if (!first && performance.now() - t0 > BUDGET_MS) break;
      if (!c.job) {
        // generate missing models (budgeted); start merging once all are ready
        let complete = true;
        for (const id of c.ids) {
          const bi = this.binfo.get(id);
          if (!bi) continue;
          if (bi.model && !bi.model.provisional && bi.model.parts) {
            bi.model.used = this.frame;
            continue;
          }
          if (!first && performance.now() - t0 > BUDGET_MS) {
            complete = false;
            break;
          }
          const hadLod = !!bi.model && !bi.model.provisional;
          this.ensureModel(bi, true);
          if (!hadLod) this.lodChunk(this.lodKeyOf(c.key)).clean = false;
          first = false;
        }
        if (!complete) break;
        const items: MergeItem[] = [];
        c.jobIds = [];
        for (const id of c.ids) {
          const bi = this.binfo.get(id);
          if (!bi?.model?.parts) continue;
          items.push({ src: { parts: bi.model.parts, anims: bi.model.anims ?? undefined }, matrix: bi.matrix, info: bi.info });
          c.jobIds.push(id);
        }
        c.job = new DetailMergeJob(items);
      }
      // the nearest chunk always advances a little, others only within budget
      const deadline = first ? Math.max(t0 + BUDGET_MS, performance.now() + 1) : t0 + BUDGET_MS;
      if (c.job.step(deadline)) this.finishDetailChunk(c);
      first = false;
    }
  }

  private finishDetailChunk(c: DetailChunk): void {
    const job = c.job!;
    c.job = null;
    const merged = job.result();
    this.disposeDetail(c);
    const mat = getChunkMaterial();
    const shadows = this.shadows();
    if (merged.geometry) {
      freeAfterUpload(merged.geometry);
      c.mesh = new THREE.Mesh(merged.geometry, mat);
      c.mesh.castShadow = shadows;
      c.mesh.receiveShadow = true;
      c.mesh.matrixAutoUpdate = false;
      c.mesh.name = `bld:chunk:${c.key}`;
      this.detailGroup.add(c.mesh);
    }
    if (merged.anim) {
      c.anim = new THREE.Mesh(merged.anim, getChunkMaterial(true));
      const dm = getAnimDepthMaterials();
      c.anim.customDepthMaterial = dm.depth;
      c.anim.customDistanceMaterial = dm.distance;
      c.anim.castShadow = shadows;
      c.anim.receiveShadow = true;
      c.anim.matrixAutoUpdate = false;
      c.anim.name = `bld:anim:${c.key}`;
      this.detailGroup.add(c.anim);
    }
    const r = merged.ranges;
    c.jobIds.forEach((id, i) => c.ranges.set(id, [r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]]));
    c.jobIds = [];
    this.rebuildGlow(c);
    c.clean = true;
    c.ready = true;
    // emitters for this chunk's buildings
    for (const id of c.ids) {
      const bi = this.binfo.get(id);
      if (bi) this.syncEmitters(bi);
    }
    this.detailSig = '';
  }

  /** lamp / neon / floodlight sprites of a detail chunk (beacons live in the LOD glow) */
  private rebuildGlow(c: DetailChunk): void {
    c.glowDirty = false;
    if (c.glow) {
      this.glowGroup.remove(c.glow);
      c.glow.geometry.dispose();
      c.glow = null;
    }
    const lights: WorldLight[] = [];
    for (const id of c.ids) {
      const bi = this.binfo.get(id);
      if (!bi?.model || !this.lampsOn(bi.b)) continue;
      const m = bi.matrix.elements;
      for (const l of bi.model.lights) {
        if (l.kind === 'beacon') continue;
        lights.push({ ...l, x: m[0] * l.x + m[8] * l.z + m[12], y: l.y + m[13], z: m[2] * l.x + m[10] * l.z + m[14] });
      }
    }
    c.glow = buildGlowMesh(lights);
    if (c.glow) this.glowGroup.add(c.glow);
  }

  private rebuildLod(t0: number): void {
    let first = true;
    for (const l of this.lchunks.values()) {
      if (l.clean) continue;
      if (!first && performance.now() - t0 > BUDGET_MS * 1.25) break;
      this.mergeLodChunk(l);
      first = false;
    }
  }

  private mergeLodChunk(l: LodChunk): void {
    const [lx, ly] = this.lodGrid!.coords(l.key);
    const items: LodItem[] = [];
    const beacons: WorldLight[] = [];
    const subRanges: [number, number, number][] = [];
    const bRanges: [number, number, number][] = [];
    let vert = 0;
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 2; sx++) {
        const dx = lx * 2 + sx, dy = ly * 2 + sy;
        if (dx >= this.detailGrid!.chunksPerSide || dy >= this.detailGrid!.chunksPerSide) continue;
        const dk = this.detailGrid!.key(dx, dy);
        const dc = this.dchunks.get(dk);
        if (!dc) continue;
        const start = vert;
        for (const id of dc.ids) {
          const bi = this.binfo.get(id);
          if (!bi) continue;
          const m = bi.model ?? this.provisional(bi);
          if (!bi.model) {
            bi.model = m;
          }
          items.push({ masses: m.masses, matrix: bi.matrix, info: bi.info });
          bRanges.push([id, vert, m.masses.length * LOD_VERTS_PER_MASS]);
          vert += m.masses.length * LOD_VERTS_PER_MASS;
          const e = bi.matrix.elements;
          for (const L of m.lights) if (L.kind === 'beacon' && !(bi.b.flags & (BFlag.Collapsed | BFlag.Burned))) beacons.push({ ...L, x: e[0] * L.x + e[8] * L.z + e[12], y: L.y + e[13], z: e[2] * L.x + e[10] * L.z + e[14], phase: (bi.b.seed % 97) / 97 });
        }
        subRanges.push([dk, start, vert - start]);
      }
    this.disposeLod(l);
    const g = mergeLod(items);
    if (g) {
      l.mesh = new THREE.Mesh(g, [getChunkMaterial()]);
      l.mesh.castShadow = this.shadows();
      l.mesh.receiveShadow = true;
      l.mesh.matrixAutoUpdate = false;
      l.mesh.name = `bld:lod:${l.key}`;
      this.lodGroup.add(l.mesh);
    }
    l.ranges.clear();
    for (const [dk, s, n] of subRanges) l.ranges.set(dk, [s, n]);
    l.bRanges.clear();
    for (const [id, s, n] of bRanges) l.bRanges.set(id, [s, n]);
    l.glow = buildGlowMesh(beacons);
    if (l.glow) this.glowGroup.add(l.glow);
    l.clean = true;
    l.groupsSig = '';
  }

  /** hide LOD sub-ranges whose detail chunk is currently shown */
  private updateLodGroups(): void {
    for (const l of this.lchunks.values()) {
      if (!l.mesh || l.groupsSig) continue;
      const g = l.mesh.geometry;
      g.clearGroups();
      let open: [number, number] | null = null;
      const ranges = [...l.ranges.entries()].sort((a, b) => a[1][0] - b[1][0]);
      let sig = 'g';
      for (const [dk, [s, n]] of ranges) {
        const dc = this.dchunks.get(dk);
        const hide = !!dc && dc.mode === 2 && dc.ready;
        if (hide || n === 0) {
          if (hide) sig += dk + ';';
          continue;
        }
        if (open && open[0] + open[1] === s) open[1] += n;
        else {
          if (open) g.addGroup(open[0], open[1], 0);
          open = [s, n];
        }
      }
      if (open) g.addGroup(open[0], open[1], 0);
      l.mesh.visible = l.mesh.visible && g.groups.length > 0;
      l.groupsSig = sig;
    }
  }

  /** background model generation so LOD boxes match the real buildings */
  private refine(t0: number): void {
    if (!this.refineQueue.length) {
      this.flushRefine();
      return;
    }
    // nearest-ish first: sort occasionally
    if (this.frame % 30 === 1 && this.refineQueue.length > 1) {
      const cam = this.game.renderer.camera.position;
      this.refineQueue.sort((a, b) => {
        const A = this.binfo.get(a), B = this.binfo.get(b);
        if (!A || !B) return 0;
        return (B.cx - cam.x) ** 2 + (B.cz - cam.z) ** 2 - ((A.cx - cam.x) ** 2 + (A.cz - cam.z) ** 2);
      });
    }
    // always make a little progress so far LOD boxes converge even when the
    // detail rebuilds consume the whole frame budget
    let n = 0;
    while (this.refineQueue.length && (n < 1 || performance.now() - t0 < BUDGET_MS)) {
      n++;
      const id = this.refineQueue.pop()!;
      const bi = this.binfo.get(id);
      if (!bi || (bi.model && !bi.model.provisional)) continue;
      const dc = this.dchunks.get(bi.chunk);
      this.ensureModel(bi, !!dc && dc.mode === 2);
      this.refineDirty.add(this.lodKeyOf(bi.chunk));
    }
    if (this.frame % 20 === 0 || !this.refineQueue.length) this.flushRefine();
  }

  private flushRefine(): void {
    for (const k of this.refineDirty) {
      const l = this.lchunks.get(k);
      if (l) l.clean = false;
    }
    this.refineDirty.clear();
  }

  // ── emitters ──────────────────────────────────────────────────────────
  private syncEmitters(bi: BInfo): void {
    this.dropEmitters(bi);
    const m = bi.model;
    if (!m || !m.emitters.length) return;
    if (bi.b.flags & BFlag.Abandoned && !(bi.b.flags & BFlag.Burned)) return;
    const e = bi.matrix.elements;
    const fx = this.game.effects;
    for (const em of m.emitters) {
      const pos = { x: e[0] * em.x + e[8] * em.z + e[12], y: em.y + e[13], z: e[2] * em.x + e[10] * em.z + e[14] };
      try {
        const id = fx.addEmitter(em.kind, pos, em.rate);
        if (id) bi.emitters.push(id);
      } catch (err) {
        console.warn('[buildings] addEmitter failed', err);
      }
    }
  }

  private dropEmitters(bi: BInfo): void {
    if (!bi.emitters.length) return;
    for (const id of bi.emitters) {
      try {
        this.game.effects.removeEmitter(id);
      } catch {
        /* effects renderer already torn down */
      }
    }
    bi.emitters = [];
  }

  // ── problem icons ─────────────────────────────────────────────────────
  private updateIcons(cam: THREE.Vector3): void {
    if (!this.game.settings.value.ui.problemIcons || !this.world) {
      this.icons.set([]);
      return;
    }
    const list: IconInstance[] = [];
    const r2 = ICON_RANGE * ICON_RANGE;
    for (const c of this.dchunks.values()) {
      if (c.dist > ICON_RANGE + DETAIL_CHUNK * CELL) continue;
      for (const id of c.ids) {
        const bi = this.binfo.get(id);
        if (!bi || !bi.b.problems) continue;
        const dx = bi.cx - cam.x, dz = bi.cz - cam.z;
        const y = bi.ground + (bi.model?.height ?? 10) + 3;
        const dy = y - cam.y;
        if (dx * dx + dz * dz + dy * dy > r2) continue;
        const top = topProblems(bi.b.problems, 2);
        const ph = (bi.b.seed % 1000) / 1000;
        top.forEach((icon, i) => list.push({ x: bi.cx, y, z: bi.cz, icon, phase: ph, scale: i === 0 ? 1 : 0.7, offset: i === 0 ? (top.length > 1 ? -0.3 : 0) : 0.75 }));
        if (list.length > 4000) break;
      }
    }
    this.icons.set(list);
  }

  // ── highlight ─────────────────────────────────────────────────────────
  private hlKey = '';

  /** outline/tint a building (selection, hover). null clears. */
  highlight(id: number | null, color?: number): void {
    if (id === null) {
      if (this.hl) {
        this.group.remove(this.hl.mesh);
        this.hl.mesh.traverse((o) => {
          if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
        });
        this.hl = null;
        this.hlKey = '';
      }
      return;
    }
    const col = new THREE.Color(color ?? 0x5cd6ff);
    if (this.hl && this.hl.id === id) {
      this.hl.color.copy(col);
      if (this.hlMat) this.hlMat.uniforms.uColor.value.copy(col);
      return;
    }
    this.highlight(null);
    const bi = this.binfo.get(id);
    if (!bi) return;
    this.hl = { id, color: col, mesh: new THREE.Group() };
    this.rebuildHighlight();
  }

  private highlightMaterial(): THREE.ShaderMaterial {
    if (!this.hlMat) {
      this.hlMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0x5cd6ff) }, uPulse: { value: 0.5 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uPulse;
          varying vec3 vN; varying vec3 vW;
          #include <common>
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            vec3 v = normalize(cameraPosition - vW);
            float rim = pow(1.0 - abs(dot(normalize(vN), v)), 2.0);
            float a = 0.16 + 0.12 * uPulse + rim * 0.55;
            gl_FragColor = vec4(uColor * (0.7 + rim), a);
          }`,
        transparent: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
        toneMapped: false,
      });
      this.hlMat.name = 'bld:highlight';
    }
    return this.hlMat;
  }

  private rebuildHighlight(): void {
    const hl = this.hl;
    if (!hl) return;
    const bi = this.binfo.get(hl.id);
    this.group.remove(hl.mesh);
    hl.mesh.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    hl.mesh = new THREE.Group();
    hl.mesh.name = 'bld:highlight';
    if (!bi) return;
    this.hlKey = bi.key;
    const mat = this.highlightMaterial();
    mat.uniforms.uColor.value.copy(hl.color);
    // body: the building's own geometry (walls/roofs only) or its LOD boxes
    const geos: THREE.BufferGeometry[] = [];
    const skip = new Set(['grass', 'paving', 'asphalt', 'dirt', 'sand', 'water', 'crop']);
    if (bi.model?.parts) {
      for (const p of bi.model.parts) {
        if (skip.has(p.mat)) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', p.geometry.getAttribute('position'));
        g.setAttribute('normal', p.geometry.getAttribute('normal'));
        geos.push(g);
      }
    }
    let body: THREE.BufferGeometry | null = geos.length ? mergeGeometries(geos, false) : null;
    if (!body && bi.model) {
      const boxes = bi.model.masses.map((m) => {
        const g = new THREE.BoxGeometry(m.w, m.h, m.d).toNonIndexed();
        g.deleteAttribute('uv');
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(m.rot).setPosition(m.cx, m.y0 + m.h / 2, m.cz));
        return g;
      });
      body = boxes.length ? mergeGeometries(boxes, false) : null;
      for (const b of boxes) b.dispose();
    }
    for (const g of geos) g.dispose();
    if (body) {
      const mesh = new THREE.Mesh(body, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(bi.matrix);
      mesh.renderOrder = 10;
      hl.mesh.add(mesh);
    }
    // footprint ring on the ground
    const w = bi.fw * CELL, d = bi.fd * CELL, t = 0.6;
    const ring = new THREE.Shape();
    ring.moveTo(-w / 2, -d / 2).lineTo(w / 2, -d / 2).lineTo(w / 2, d / 2).lineTo(-w / 2, d / 2).lineTo(-w / 2, -d / 2);
    const hole = new THREE.Path();
    hole.moveTo(-w / 2 + t, -d / 2 + t).lineTo(-w / 2 + t, d / 2 - t).lineTo(w / 2 - t, d / 2 - t).lineTo(w / 2 - t, -d / 2 + t).lineTo(-w / 2 + t, -d / 2 + t);
    ring.holes.push(hole);
    const rg = new THREE.ShapeGeometry(ring);
    rg.rotateX(-Math.PI / 2);
    rg.translate(0, 0.45, 0);
    const rmesh = new THREE.Mesh(rg, mat);
    rmesh.matrixAutoUpdate = false;
    rmesh.matrix.copy(bi.matrix);
    rmesh.renderOrder = 10;
    hl.mesh.add(rmesh);
    this.group.add(hl.mesh);
  }

  private animateHighlight(): void {
    if (!this.hlMat) return;
    this.hlMat.uniforms.uPulse.value = 0.5 + 0.5 * Math.sin(this.game.time * 5);
    // the detailed model may have arrived since the overlay was built
    const bi = this.hl ? this.binfo.get(this.hl.id) : undefined;
    if (bi && this.hl && this.hl.mesh.children.length < 2 && bi.model?.parts) this.rebuildHighlight();
  }

  // ── placement preview ────────────────────────────────────────────────
  /** translucent placement preview of a catalog building (local origin = footprint center, front +Z rotated by rot). */
  createPreview(defId: string, rot: Dir): THREE.Object3D {
    const grp = new THREE.Group();
    grp.name = `bld:preview:${defId}`;
    let zone = ZoneType.None, fw = 1, fd = 1, level = 1;
    if (defId.startsWith('zoned:')) {
      const zd = zoneById(defId.slice(6));
      if (zd) {
        zone = zd.type;
        const lot = zd.lots[Math.min(zd.lots.length - 1, 1)];
        fw = lot[0];
        fd = lot[1];
      }
    } else {
      const def = buildingDef(defId);
      if (def) {
        fw = def.w;
        fd = def.h;
      }
    }
    const style = this.world?.settings.style ?? 'european';
    const seed = hashString(defId);
    let model: ZModel;
    try {
      const ctx = this.context(null, zone, level, fw, fd, style, seed, defId, 'medium');
      model = this.fullModel(defId.startsWith('zoned:') ? 'zoned' : 'service', defId, ctx);
    } catch (e) {
      console.warn('[buildings] preview failed', e);
      model = civicFallback(this.context(null, zone, level, fw, fd, style, seed, defId, 'low'));
    }
    const geos: THREE.BufferGeometry[] = [];
    for (const p of [...model.parts, ...model.anims.map((a) => a.part)]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', p.geometry.getAttribute('position'));
      g.setAttribute('normal', p.geometry.getAttribute('normal'));
      geos.push(g);
    }
    const merged = geos.length ? mergeGeometries(geos, false) : new THREE.BoxGeometry(fw * CELL * 0.7, 8, fd * CELL * 0.7).translate(0, 4, 0);
    for (const g of geos) g.dispose();
    for (const p of model.parts) p.geometry.dispose();
    for (const a of model.anims) a.part.geometry.dispose();
    const mesh = new THREE.Mesh(merged, ghostMaterial(true));
    mesh.renderOrder = 20;
    mesh.name = 'bld:preview-body';
    grp.add(mesh);
    // footprint outline
    const w = fw * CELL, d = fd * CELL;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.2, d).translate(0, 0.3, 0)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    edge.renderOrder = 21;
    grp.add(edge);
    grp.rotation.y = ROT_ANGLE[rot] ?? 0;
    grp.userData.height = model.height;
    grp.userData.setValid = (valid: boolean) => {
      mesh.material = ghostMaterial(valid);
      (edge.material as THREE.LineBasicMaterial).color.set(valid ? 0xffffff : 0xff6a6a);
    };
    grp.userData.dispose = () => {
      merged.dispose();
      edge.geometry.dispose();
      (edge.material as THREE.Material).dispose();
    };
    return grp;
  }

  /** approximate top height (m, world) of a building for icons/labels */
  buildingTop(id: number): number {
    const bi = this.binfo.get(id);
    if (!bi) {
      const b = this.world?.getBuilding(id);
      if (!b || !this.world) return 0;
      return this.world.cellHeight(b.x, b.y) + 10;
    }
    return bi.ground + (bi.model?.height ?? this.provisional(bi).height);
  }

  // ── disposal ──────────────────────────────────────────────────────────
  private disposeDetail(c: DetailChunk): void {
    for (const m of [c.mesh, c.anim]) {
      if (!m) continue;
      this.detailGroup.remove(m);
      m.geometry.dispose();
    }
    if (c.glow) {
      this.glowGroup.remove(c.glow);
      c.glow.geometry.dispose();
    }
    c.mesh = c.anim = c.glow = null;
    c.ranges.clear();
  }

  private disposeLod(l: LodChunk): void {
    if (l.mesh) {
      this.lodGroup.remove(l.mesh);
      l.mesh.geometry.dispose();
    }
    if (l.glow) {
      this.glowGroup.remove(l.glow);
      l.glow.geometry.dispose();
    }
    l.mesh = l.glow = null;
  }

  /** debug / tests: counts of what is currently built */
  stats(): { buildings: number; detailChunks: number; lodChunks: number; cachedVerts: number; pending: number } {
    let d = 0;
    for (const c of this.dchunks.values()) if (c.mesh) d++;
    let l = 0;
    for (const c of this.lchunks.values()) if (c.mesh) l++;
    return { buildings: this.binfo.size, detailChunks: d, lodChunks: l, cachedVerts: this.cachedVerts, pending: this.refineQueue.length };
  }
}

/** Drop CPU copies of vertex data once uploaded (positions keep their count).
 *  aInfo stays resident so per-building state can be patched in place. */
function freeAfterUpload(g: THREE.BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    if (name === 'aInfo') continue;
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    a.onUpload(function (this: THREE.BufferAttribute) {
      (this as unknown as { array: THREE.TypedArray }).array = EMPTY_F32 as unknown as THREE.TypedArray;
    });
  }
}
