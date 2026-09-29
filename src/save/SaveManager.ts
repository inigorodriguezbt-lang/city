// ─────────────────────────────────────────────────────────────────────────────
// SaveManager — IndexedDB saves, autosave rotation, quicksave/quickload,
// .urbis export/import. Owned by the "systems" agent.
//
// Storage: database "urbis" → "meta" (SaveMeta, fast listing) + "blobs"
// (bytes). When IndexedDB is unavailable (private mode) or full, saves fall
// back to an in-memory store for the session and the player is told so.
// Every save embeds a 320×180 thumbnail and a stable per-city id stored in
// `world.ext.save`, which drives the per-city Quicksave and Autosave slots.
// ─────────────────────────────────────────────────────────────────────────────
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import { formatMoney } from '../core/util';
import { inArtifactViewer, offerDownload, type DownloadOutcome } from '../core/download';
import {
  SAVE_EXTENSION, SAVE_MIME, SaveFormatError, buildWorld, decodeSave, describeSaveError, looksLikeSave, serializeWorld,
} from './serialize';
import { IdbStore, MemoryStore, StorageFullError, uuid, type SaveStore } from './store';

export interface SaveMeta {
  id: string;
  name: string;
  cityName: string;
  /** real timestamp ms */
  savedAt: number;
  population: number;
  money: number;
  day: number;
  mapSize: string;
  theme: string;
  /** small JPEG data URL */
  thumbnail?: string;
  auto: boolean;
  bytes: number;
  // ── additive extras ──
  /** stable identity of the city (shared by all of its saves) */
  cityId?: string;
  /** session-only save (storage unavailable/full) */
  volatile?: boolean;
  seed?: number;
  milestone?: number;
  creative?: boolean;
  /** cheat commands were used in this city */
  cheated?: boolean;
  /** real seconds played */
  playTime?: number;
  /** true for quicksave slots */
  quick?: boolean;
}

/** Persisted SaveManager state inside `world.ext.save`. */
interface SaveExt {
  cityId: string;
  lastSaveId?: string;
  lastSaveName?: string;
  lastSavedAt?: number;
  /** camera pose at save time (restored on load) */
  camera?: { x: number; y: number; distance: number };
}

export const QUICKSAVE_NAME = 'Quicksave';
export const AUTOSAVE_PREFIX = 'Autosave';
const THUMB_W = 320;
const THUMB_H = 180;

export class SaveManager {
  private primary: SaveStore | null = null;
  private memory = new MemoryStore();
  private ready: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private autosaveTimer = 0;
  private dirty = false;
  private loadingNow = false;
  private savingNow = false;
  private warnedVolatile = false;
  private lastQuotaWarn = -1e9;
  private cache: SaveMeta[] = [];

  constructor(protected game: Game) {}

  // ── lifecycle ────────────────────────────────────────────────────────────
  init(): Promise<void> {
    if (this.ready) return this.ready;
    const ev = this.game.events;
    const markDirty = () => { this.dirty = true; };
    ev.on('world:changed', markDirty);
    ev.on('building:added', markDirty);
    ev.on('building:removed', markDirty);
    ev.on('money:changed', markDirty);
    ev.on('sim:day', markDirty);
    ev.on('world:loaded', (w) => {
      this.autosaveTimer = 0;
      this.dirty = false;
      this.ensureExt(w);
    });
    ev.on('world:unloaded', () => { this.autosaveTimer = 0; });
    this.ready = IdbStore.open()
      .then((s) => { this.primary = s; })
      .catch((e) => {
        console.warn('[save] IndexedDB unavailable, using session storage', e);
        this.primary = null;
      })
      .then(async () => {
        await this.refreshCache();
      });
    return this.ready;
  }

  /** autosave clock (real seconds; paused while menus are open) */
  update(dt: number): void {
    const g = this.game;
    const w = g.world;
    if (!w || this.loadingNow || this.savingNow) return;
    const mins = g.settings.value.gameplay.autosaveMinutes;
    if (!(mins > 0)) {
      this.autosaveTimer = 0;
      return;
    }
    if (g.menus.isOpen()) return;
    this.autosaveTimer += dt;
    if (this.autosaveTimer < mins * 60) return;
    this.autosaveTimer = 0;
    if (!this.dirty) return; // nothing happened since the last save
    void this.autosave();
  }

  /** where saves go right now */
  get storageKind(): 'indexeddb' | 'memory' {
    return this.primary ? 'indexeddb' : 'memory';
  }

  /** true while a save or load is running */
  get busy(): boolean {
    return this.savingNow || this.loadingNow;
  }

  /** seconds until the next autosave (Infinity when disabled) */
  get nextAutosaveIn(): number {
    const mins = this.game.settings.value.gameplay.autosaveMinutes;
    return mins > 0 ? Math.max(0, mins * 60 - this.autosaveTimer) : Infinity;
  }

  /** last list() result (synchronous, for completions and HUD hints) */
  get cachedList(): readonly SaveMeta[] {
    return this.cache;
  }

  // ── listing ──────────────────────────────────────────────────────────────
  async list(): Promise<SaveMeta[]> {
    await this.init();
    return this.refreshCache();
  }

  private async refreshCache(): Promise<SaveMeta[]> {
    let metas: SaveMeta[] = [];
    if (this.primary) {
      try {
        metas = await this.primary.listMeta();
      } catch (e) {
        console.warn('[save] listing failed', e);
      }
    }
    const mem = (await this.memory.listMeta()).map((m) => ({ ...m, volatile: true }));
    const ids = new Set(metas.map((m) => m.id));
    for (const m of mem) if (!ids.has(m.id)) metas.push(m);
    metas.sort((a, b) => b.savedAt - a.savedAt);
    this.cache = metas;
    return metas.slice();
  }

  async getMeta(id: string): Promise<SaveMeta | undefined> {
    await this.init();
    if (this.memory.has(id)) return this.memory.getMeta(id);
    return this.primary?.getMeta(id);
  }

  /** find a save by name (exact, then prefix, then substring; current city first, newest first) */
  async findByName(name: string): Promise<SaveMeta | undefined> {
    const all = await this.list();
    return this.matchName(all, name);
  }

  matchName(all: readonly SaveMeta[], name: string): SaveMeta | undefined {
    const q = name.trim().toLowerCase();
    if (!q) return undefined;
    const city = this.currentCityId();
    const rank = (m: SaveMeta) => (m.cityId && m.cityId === city ? 0 : 1);
    const pick = (pred: (m: SaveMeta) => boolean) => all.filter(pred).sort((a, b) => rank(a) - rank(b) || b.savedAt - a.savedAt)[0];
    return (
      pick((m) => m.id === name) ??
      pick((m) => m.name.toLowerCase() === q) ??
      pick((m) => m.name.toLowerCase().startsWith(q)) ??
      pick((m) => m.name.toLowerCase().includes(q) || m.cityName.toLowerCase().includes(q))
    );
  }

  // ── saving ───────────────────────────────────────────────────────────────
  save(name?: string, opts: { auto?: boolean; overwriteId?: string } = {}): Promise<SaveMeta | null> {
    return this.exclusive(() => this.doSave(name, opts));
  }

  private async doSave(name: string | undefined, opts: { auto?: boolean; overwriteId?: string; quick?: boolean }): Promise<SaveMeta | null> {
    await this.init();
    const g = this.game;
    const w = g.world;
    if (!w) {
      this.toast('There is no city to save', 'warning');
      return null;
    }
    this.savingNow = true;
    try {
      const ext = this.ensureExt(w);
      const auto = !!opts.auto;
      const slotName = (name ?? '').trim() || w.settings.cityName || 'My City';
      const prev = opts.overwriteId ? await this.getMeta(opts.overwriteId) : undefined;
      const id = prev ? prev.id : opts.overwriteId || uuid();
      const thumbnail = await this.captureThumbnail();
      const savedAt = Date.now();
      // persist bookkeeping inside the city itself
      const cam = this.cameraPose();
      const prevExt = { ...ext };
      ext.lastSaveId = id;
      ext.lastSaveName = slotName;
      ext.lastSavedAt = savedAt;
      if (cam) ext.camera = cam;
      let bytes: Uint8Array;
      try {
        bytes = await serializeWorld(w, { meta: { name: slotName, cityId: ext.cityId, thumbnail, savedAt } });
      } catch (e) {
        Object.assign(ext, prevExt);
        throw e;
      }
      const meta: SaveMeta = {
        ...this.metaFromWorld(w, bytes.length),
        id, name: slotName, savedAt, thumbnail, auto, quick: !!opts.quick,
      };
      const stored = await this.store(meta, bytes, auto);
      if (!stored) return null;
      this.dirty = false;
      this.autosaveTimer = 0;
      await this.refreshCache();
      g.events.emit('game:saved', { id: stored.id, name: stored.name });
      g.audio.play('click');
      if (opts.quick) this.toast('Quicksaved — press F9 to load it', 'good');
      else if (auto) this.toast('Autosaved', 'info');
      else this.toast(`Saved “${slotName}”`, 'good');
      if (stored.volatile && !this.warnedVolatile) {
        this.warnedVolatile = true;
        this.toast('Browser storage is unavailable: saves last only for this session. Use Export to keep a copy.', 'warning');
      }
      return stored;
    } catch (e) {
      console.error('[save] failed', e);
      this.toast(`Could not save: ${describeSaveError(e)}`, 'danger');
      g.audio.play('error');
      return null;
    } finally {
      this.savingNow = false;
    }
  }

  /** write meta+bytes to IndexedDB; falls back to the session store on quota/private mode */
  private async store(meta: SaveMeta, bytes: Uint8Array, auto: boolean): Promise<SaveMeta | null> {
    if (this.primary) {
      try {
        await this.primary.put(meta, bytes);
        await this.memory.delete(meta.id);
        return meta;
      } catch (e) {
        if (!(e instanceof StorageFullError)) console.warn('[save] IndexedDB write failed, keeping save in memory', e);
        const now = performance.now();
        if (now - this.lastQuotaWarn > 120_000 || !auto) {
          this.lastQuotaWarn = now;
          this.toast(
            e instanceof StorageFullError
              ? 'Browser storage is full — this save is kept for this session only. Delete old saves or Export to keep it.'
              : 'Saving to browser storage failed — this save is kept for this session only. Export it to keep it.',
            'warning',
          );
        }
        this.warnedVolatile = true;
      }
    }
    const vol = { ...meta, volatile: true };
    await this.memory.put(vol, bytes);
    return vol;
  }

  /** rotating per-city autosave slots ("Autosave 1..N"), replacing the oldest */
  async autosave(): Promise<SaveMeta | null> {
    const w = this.game.world;
    if (!w) return null;
    return this.exclusive(async () => {
      const city = this.ensureExt(w).cityId;
      const slots = Math.max(1, Math.min(20, Math.round(this.game.settings.value.gameplay.autosaveSlots || 1)));
      const mine = (await this.list()).filter((m) => m.auto && m.cityId === city).sort((a, b) => a.savedAt - b.savedAt);
      let name: string;
      let overwriteId: string | undefined;
      if (mine.length < slots) {
        const used = new Set(mine.map((m) => m.name));
        let k = 1;
        while (used.has(`${AUTOSAVE_PREFIX} ${k}`)) k++;
        name = `${AUTOSAVE_PREFIX} ${k}`;
      } else {
        const oldest = mine[0];
        name = oldest.name;
        overwriteId = oldest.id;
      }
      const meta = await this.doSave(name, { auto: true, overwriteId });
      // trim surplus slots (e.g. after lowering the slot count)
      if (meta) {
        const after = (await this.list()).filter((m) => m.auto && m.cityId === city).sort((a, b) => b.savedAt - a.savedAt);
        for (const extra of after.slice(slots)) await this.deleteInternal(extra.id);
        if (after.length > slots) await this.refreshCache();
      }
      return meta;
    });
  }

  async quicksave(): Promise<void> {
    const w = this.game.world;
    if (!w) return;
    await this.exclusive(async () => {
      const city = this.ensureExt(w).cityId;
      const existing = (await this.list()).find((m) => m.name === QUICKSAVE_NAME && m.cityId === city);
      await this.doSave(QUICKSAVE_NAME, { overwriteId: existing?.id, quick: true });
    });
  }

  async quickload(): Promise<void> {
    const w = this.game.world;
    if (!w) return;
    const city = this.ensureExt(w).cityId;
    const q = (await this.list()).find((m) => m.name === QUICKSAVE_NAME && m.cityId === city);
    if (!q) {
      this.toast('No quicksave for this city yet — press F5 to quicksave', 'warning');
      this.game.audio.play('error');
      return;
    }
    await this.load(q.id);
  }

  // ── loading ──────────────────────────────────────────────────────────────
  load(id: string): Promise<boolean> {
    return this.exclusive(() => this.doLoad(id));
  }

  private async doLoad(id: string): Promise<boolean> {
    await this.init();
    const g = this.game;
    const meta = await this.getMeta(id);
    if (!meta) {
      this.toast('That save no longer exists', 'danger');
      return false;
    }
    this.loadingNow = true;
    const hadWorld = !!g.world;
    try {
      g.menus.showLoading(`Loading “${meta.name}”…`, 0.05);
      const bytes = await this.readBytes(id);
      if (!bytes) throw new SaveFormatError('The save data is missing from browser storage.', 'corrupt');
      g.menus.showLoading(`Unpacking “${meta.name}”…`, 0.3);
      const decoded = await decodeSave(bytes);
      g.menus.showLoading('Restoring the city…', 0.6);
      const world = buildWorld(decoded);
      const saved = world.ext.save as Partial<SaveExt> | undefined;
      if ((!saved || typeof saved.cityId !== 'string') && meta.cityId) world.ext.save = { ...(saved ?? {}), cityId: meta.cityId };
      this.ensureExt(world);
      g.menus.hideMainMenu();
      await g.attachWorld(world);
      this.restoreCamera(world);
      for (let i = 0; i < 8 && g.menus.isOpen() && g.menus.closeTop(); i++) { /* land the player in the game */ }
      this.dirty = false;
      this.autosaveTimer = 0;
      g.audio.play('open');
      this.toast(`Loaded “${meta.name}” · ${world.settings.cityName}`, 'good');
      return true;
    } catch (e) {
      console.error('[save] load failed', e);
      g.menus.hideLoading();
      // the old city stays if we failed before replacing it; otherwise go home
      if (!g.world) g.menus.showMainMenu();
      else if (!hadWorld) g.menus.hideLoading();
      this.toast(`Could not load “${meta.name}”: ${describeSaveError(e)}`, 'danger');
      g.audio.play('error');
      return false;
    } finally {
      this.loadingNow = false;
    }
  }

  private async readBytes(id: string): Promise<Uint8Array | undefined> {
    if (this.memory.has(id)) return this.memory.getBytes(id);
    return this.primary?.getBytes(id);
  }

  // ── management ───────────────────────────────────────────────────────────
  async delete(id: string): Promise<void> {
    await this.init();
    await this.deleteInternal(id);
    await this.refreshCache();
  }

  private async deleteInternal(id: string): Promise<void> {
    await this.memory.delete(id);
    if (this.primary) {
      try {
        await this.primary.delete(id);
      } catch (e) {
        console.warn('[save] delete failed', e);
        this.toast('Could not delete the save', 'danger');
      }
    }
  }

  /** rename a stored save (the embedded name updates on the next overwrite) */
  async rename(id: string, name: string): Promise<SaveMeta | null> {
    await this.init();
    const meta = await this.getMeta(id);
    const clean = name.trim();
    if (!meta || !clean) return null;
    const next = { ...meta, name: clean };
    if (this.memory.has(id)) await this.memory.putMeta(next);
    else await this.primary?.putMeta(next);
    await this.refreshCache();
    return next;
  }

  /** storage usage estimate (bytes) when the browser exposes it */
  async estimateStorage(): Promise<{ usage: number; quota: number } | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est) return null;
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  // ── export / import ──────────────────────────────────────────────────────
  async exportCurrent(): Promise<void> {
    const w = this.game.world;
    if (!w) {
      this.toast('There is no city to export', 'warning');
      return;
    }
    try {
      const ext = this.ensureExt(w);
      const cam = this.cameraPose();
      if (cam) ext.camera = cam;
      const thumbnail = await this.captureThumbnail();
      const bytes = await serializeWorld(w, { meta: { name: w.settings.cityName, cityId: ext.cityId, thumbnail, savedAt: Date.now() } });
      const file = exportName(fileName(w.settings.cityName));
      this.reportExport(await downloadBytes(bytes, file), file, bytes.length);
    } catch (e) {
      console.error('[save] export failed', e);
      this.toast(`Could not export: ${describeSaveError(e)}`, 'danger');
    }
  }

  async exportSave(id: string): Promise<void> {
    await this.init();
    const meta = await this.getMeta(id);
    const bytes = meta ? await this.readBytes(id) : undefined;
    if (!meta || !bytes) {
      this.toast('That save could not be found', 'danger');
      return;
    }
    const base = meta.name && meta.name !== meta.cityName && !meta.auto ? `${meta.cityName} - ${meta.name}` : meta.cityName;
    const file = exportName(fileName(base));
    this.reportExport(await downloadBytes(bytes, file), file, bytes.length);
  }

  private reportExport(outcome: DownloadOutcome, file: string, size: number): void {
    if (outcome === 'saved') {
      this.game.audio.play('click');
      this.toast(`Exported ${file} (${formatBytes(size)})`, 'good');
    } else if (outcome === 'declined') {
      this.toast('Export cancelled', 'info');
    } else {
      this.toast('This browser blocked the download. Your cities are still saved in the browser.', 'warning');
    }
  }

  async importFile(file: File): Promise<SaveMeta | null> {
    await this.init();
    try {
      if (!file || file.size === 0) throw new SaveFormatError('The file is empty.', 'not-a-save');
      if (file.size > 1024 * 1024 * 1024) throw new SaveFormatError('The file is too large to be an URBIS save.', 'not-a-save');
      const bytes = unwrapExport(new Uint8Array(await file.arrayBuffer()));
      if (!looksLikeSave(bytes)) throw new SaveFormatError(`“${file.name}” is not an URBIS save (.urbis).`, 'not-a-save');
      const decoded = await decodeSave(bytes);
      const world = buildWorld(decoded); // full validation
      const ext = (world.ext.save ?? {}) as Partial<SaveExt>;
      const stem = file.name.replace(/\.[^.]+$/, '').trim();
      const meta: SaveMeta = {
        ...this.metaFromWorld(world, bytes.length),
        id: uuid(),
        name: (decoded.doc.meta.name || stem || world.settings.cityName).slice(0, 80),
        savedAt: Date.now(),
        thumbnail: typeof decoded.doc.meta.thumbnail === 'string' && decoded.doc.meta.thumbnail.startsWith('data:image/') ? decoded.doc.meta.thumbnail : undefined,
        auto: false,
        cityId: typeof ext.cityId === 'string' ? ext.cityId : decoded.doc.meta.cityId,
      };
      const stored = await this.exclusive(() => this.store(meta, bytes, false));
      await this.refreshCache();
      if (stored) {
        this.game.audio.play('notice');
        this.toast(`Imported “${stored.name}” · ${stored.cityName}`, 'good');
      }
      return stored;
    } catch (e) {
      console.warn('[save] import failed', e);
      this.toast(`Could not import: ${describeSaveError(e)}`, 'danger');
      this.game.audio.play('error');
      return null;
    }
  }

  // ── raw serialization (public API) ───────────────────────────────────────
  serialize(world: World): Promise<Uint8Array> {
    const ext = this.ensureExt(world);
    return serializeWorld(world, { meta: { name: world.settings.cityName, cityId: ext.cityId, savedAt: Date.now() } });
  }

  deserialize(bytes: Uint8Array): Promise<World> {
    return decodeSave(bytes).then(buildWorld);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  /** stable id of the loaded city */
  currentCityId(): string | undefined {
    const w = this.game.world;
    return w ? this.ensureExt(w).cityId : undefined;
  }

  private ensureExt(w: World): SaveExt {
    let ext = w.ext.save as SaveExt | undefined;
    if (!ext || typeof ext !== 'object') {
      ext = { cityId: uuid() };
      w.ext.save = ext;
    }
    if (typeof ext.cityId !== 'string' || !ext.cityId) ext.cityId = uuid();
    return ext;
  }

  private metaFromWorld(w: World, bytes: number): Omit<SaveMeta, 'id' | 'name' | 'savedAt' | 'auto'> {
    const ext = w.ext.save as Partial<SaveExt> | undefined;
    return {
      cityName: w.settings.cityName,
      population: Math.round(w.stats.population || 0),
      money: Math.round(w.economy.money || 0),
      day: Math.floor(w.time.day || 0),
      mapSize: w.settings.mapSize,
      theme: w.settings.theme,
      bytes,
      cityId: ext?.cityId,
      seed: w.settings.seed,
      milestone: w.milestone,
      creative: w.creative,
      cheated: w.ext.cheated === true,
      playTime: Math.round(w.playTime || 0),
    };
  }

  private cameraPose(): SaveExt['camera'] | undefined {
    try {
      const c = this.game.renderer.cameraCtl;
      if (!Number.isFinite(c.focus.x) || !Number.isFinite(c.focus.y) || !Number.isFinite(c.distance)) return undefined;
      return { x: c.focus.x, y: c.focus.y, distance: c.distance };
    } catch {
      return undefined;
    }
  }

  private restoreCamera(w: World): void {
    const cam = (w.ext.save as Partial<SaveExt> | undefined)?.camera;
    if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y)) return;
    const x = Math.max(0, Math.min(w.size, cam.x)), y = Math.max(0, Math.min(w.size, cam.y));
    try {
      this.game.renderer.cameraCtl.flyTo(x, y, Number.isFinite(cam.distance) ? cam.distance : undefined, true);
    } catch (e) {
      console.warn('[save] camera restore failed', e);
    }
  }

  /** 320×180 JPEG of the current frame (cover-cropped), or undefined */
  private async captureThumbnail(): Promise<string | undefined> {
    try {
      const shot = await withTimeout(this.game.renderer.screenshot(THUMB_W, THUMB_H), 2500);
      if (!shot) return undefined;
      return await withTimeout(downscale(shot, THUMB_W, THUMB_H), 2500);
    } catch (e) {
      console.warn('[save] thumbnail failed', e);
      return undefined;
    }
  }

  private toast(text: string, kind: 'info' | 'good' | 'warning' | 'danger'): void {
    // menu dialogs report their own successes; problems are always shown
    if ((kind === 'good' || kind === 'info') && this.menuOpen()) return;
    try {
      this.game.ui.toast(text, kind);
    } catch {
      console.log(`[save] ${text}`);
    }
  }

  private menuOpen(): boolean {
    try {
      return this.game.menus.isOpen();
    } catch {
      return false;
    }
  }

  /** run save/load/import operations strictly one at a time */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }
}

// ── module helpers ──────────────────────────────────────────────────────────
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function downscale(dataUrl: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx || !img.naturalWidth || !img.naturalHeight) return reject(new Error('no 2d context'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const sa = img.naturalWidth / img.naturalHeight, da = w / h;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (sa > da) { sw = sh * da; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / da; sy = (img.naturalHeight - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('thumbnail decode failed'));
    img.src = dataUrl;
  });
}

export function fileName(base: string): string {
  const clean = (base || 'city').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'city';
  return clean + SAVE_EXTENSION;
}

/** Wrapper used where only text formats can be offered (the artifact viewer
 *  allows .json downloads but not .urbis): the binary save as base64. */
const WRAP_FORMAT = 'urbis-save';

/** export filename: `.urbis`, or `.urbis.json` inside the artifact viewer */
export function exportName(file: string): string {
  return inArtifactViewer() ? file + '.json' : file;
}

/** Offer save bytes as a download (JSON-wrapped inside the artifact viewer). */
export function downloadBytes(bytes: Uint8Array, name: string): Promise<DownloadOutcome> {
  if (name.endsWith('.json')) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const doc = JSON.stringify({ format: WRAP_FORMAT, version: 1, encoding: 'base64', data: btoa(bin) });
    return offerDownload(name, new Blob([doc], { type: 'application/json' }));
  }
  return offerDownload(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: SAVE_MIME }));
}

/** Accept both raw .urbis bytes and the .urbis.json wrapper. */
export function unwrapExport(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0x7b /* { */) return bytes;
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { format?: string; encoding?: string; data?: string };
    if (doc.format !== WRAP_FORMAT || doc.encoding !== 'base64' || typeof doc.data !== 'string') return bytes;
    const bin = atob(doc.data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return bytes;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** one-line description of a save for lists/chat */
export function describeSave(m: SaveMeta): string {
  const d = new Date(m.savedAt);
  const when = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return `${m.name} — ${m.cityName} · pop ${m.population.toLocaleString('en-US')} · ${formatMoney(m.money, true)} · ${when}${m.volatile ? ' · session only' : ''}`;
}
