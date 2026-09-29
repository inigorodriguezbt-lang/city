// ─────────────────────────────────────────────────────────────────────────────
// URBIS save format (.urbis)
//
//   frame (16 bytes, little endian)
//     0..3   magic "URBS"
//     4..5   u16  format version (SAVE_VERSION at write time)
//     6      u8   flags (bit0 = payload is gzip)
//     7      u8   reserved (0)
//     8..11  u32  container length (uncompressed)
//     12..15 u32  CRC-32 of the uncompressed container
//   payload  gzip(container) — or the raw container when CompressionStream is
//            unavailable (flag bit0 cleared)
//
//   container (uncompressed)
//     u32 LE json byte length, UTF-8 JSON document, zero padding to 8 bytes
//     binary area: every typed array of the World (heights, water, road, …,
//     every world.fields[id]) stored back to back, each 8-byte aligned. The
//     JSON document lists them in `sections` with offsets relative to the
//     start of the binary area and element counts.
//
// Round trips are exact: typed arrays are copied bit for bit and the JSON
// encoder preserves NaN / ±Infinity / -0, Maps, Sets, Dates and typed arrays
// that modules may have tucked into `ext` or building `ext` bags.
// ─────────────────────────────────────────────────────────────────────────────
import { GAME_NAME, SAVE_VERSION } from '../core/constants';
import { FIELD_IDS, type Building, type FieldId, type MapSettings, type Notice } from '../core/types';
import { World, emptyStats } from '../world/World';

export const SAVE_MAGIC = 'URBS';
export const SAVE_EXTENSION = '.urbis';
export const SAVE_MIME = 'application/octet-stream';
/** notices kept in a save (the live list holds up to 250) */
export const SAVED_NOTICES = 150;

const FRAME_BYTES = 16;
const FLAG_GZIP = 1;
const KNOWN_FLAGS = FLAG_GZIP;
const ALIGN = 8;
const MAX_CONTAINER_BYTES = 1.5 * 1024 * 1024 * 1024;

export type SaveErrorCode = 'not-a-save' | 'newer-version' | 'corrupt' | 'truncated' | 'unsupported' | 'invalid';

/** Error with a player-facing message (safe to show in a toast). */
export class SaveFormatError extends Error {
  constructor(message: string, readonly code: SaveErrorCode) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

/** Descriptive data embedded in every save (used for imports and listings). */
export interface SaveFileMeta {
  /** save slot name */
  name?: string;
  /** stable identity of the city across all of its saves */
  cityId?: string;
  /** 320×180 JPEG data URL */
  thumbnail?: string;
  /** real timestamp (ms) of the save */
  savedAt: number;
  /** "URBIS" */
  app?: string;
}

type SectionType = 'f32' | 'f64' | 'u8' | 'i8' | 'u8c' | 'u16' | 'i16' | 'u32' | 'i32';

interface SectionEntry {
  /** world property name, or `fields.<id>` */
  key: string;
  type: SectionType;
  /** byte offset from the start of the binary area */
  offset: number;
  /** element count */
  length: number;
}

/** The JSON document of a save. */
export interface SaveDoc {
  format: 'urbis-save';
  version: number;
  meta: SaveFileMeta;
  size: number;
  /** every non-array World property */
  state: Record<string, unknown>;
  sections: SectionEntry[];
}

/** A validated, decompressed save that has not yet been turned into a World. */
export interface DecodedSave {
  doc: SaveDoc;
  container: Uint8Array;
  binStart: number;
  /** version found in the file frame (before migration) */
  fileVersion: number;
  compressed: boolean;
}

// ── migrations ──────────────────────────────────────────────────────────────
/**
 * Migration hook per format version: `MIGRATIONS[v]` upgrades a document
 * written by version `v` to version `v + 1` in place. They run in order from
 * the file's version up to SAVE_VERSION before the World is rebuilt. Missing
 * World properties are filled with constructor defaults automatically, so a
 * migration only needs to handle renamed/re-shaped data.
 */
const MIGRATIONS: Record<number, (doc: SaveDoc) => void> = {};

/** Register an upgrade step from `fromVersion` to `fromVersion + 1`. */
export function registerMigration(fromVersion: number, fn: (doc: SaveDoc) => void): void {
  MIGRATIONS[fromVersion] = fn;
}

function migrate(doc: SaveDoc): void {
  for (let v = doc.version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) step(doc);
    doc.version = v + 1;
  }
}

// ── typed array helpers ─────────────────────────────────────────────────────
type AnyTyped = Float32Array | Float64Array | Uint8Array | Int8Array | Uint8ClampedArray | Uint16Array | Int16Array | Uint32Array | Int32Array;

const CTOR: Record<SectionType, { new (buf: ArrayBufferLike, off: number, len: number): AnyTyped; new (len: number): AnyTyped; BYTES_PER_ELEMENT: number }> = {
  f32: Float32Array, f64: Float64Array, u8: Uint8Array, i8: Int8Array, u8c: Uint8ClampedArray,
  u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array,
} as never;

function sectionType(a: ArrayBufferView): SectionType | null {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Uint8ClampedArray) return 'u8c';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int8Array) return 'i8';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int32Array) return 'i32';
  return null;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** In-place byte swap (only used on big-endian hosts; files are always LE). */
function swapBytes(bytes: Uint8Array, width: number): void {
  if (width < 2) return;
  for (let i = 0; i + width <= bytes.length; i += width) {
    for (let a = i, b = i + width - 1; a < b; a++, b--) {
      const t = bytes[a];
      bytes[a] = bytes[b];
      bytes[b] = t;
    }
  }
}

const align = (n: number): number => Math.ceil(n / ALIGN) * ALIGN;

// ── CRC-32 ──────────────────────────────────────────────────────────────────
let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  let t = CRC_TABLE;
  if (!t) {
    t = CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0, n = data.length; i < n; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── lossless JSON (NaN/±Infinity/-0, Map, Set, Date, typed arrays) ──────────
const TYPED_NAMES = new Set(['Float32Array', 'Float64Array', 'Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array']);

function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw = this[key];
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { $n: String(raw) };
    if (raw === 0 && 1 / raw < 0) return { $n: '-0' };
    return raw;
  }
  if (raw instanceof Map) return { $map: [...raw.entries()] };
  if (raw instanceof Set) return { $set: [...raw] };
  if (raw instanceof Date) return { $date: raw.getTime() };
  if (ArrayBuffer.isView(raw) && !(raw instanceof DataView) && TYPED_NAMES.has(raw.constructor.name)) {
    return { $ta: raw.constructor.name, d: Array.from(raw as unknown as ArrayLike<number>) };
  }
  return value;
}

function reviver(_key: string, v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1) {
    if (typeof o.$n === 'string') return Number(o.$n);
    if (Array.isArray(o.$map)) return new Map(o.$map as [unknown, unknown][]);
    if (Array.isArray(o.$set)) return new Set(o.$set);
    if (typeof o.$date === 'number') return new Date(o.$date);
  } else if (keys.length === 2 && typeof o.$ta === 'string' && Array.isArray(o.d) && TYPED_NAMES.has(o.$ta)) {
    const C = (globalThis as unknown as Record<string, new (a: ArrayLike<number>) => unknown>)[o.$ta];
    if (typeof C === 'function') return new C(o.d as number[]);
  }
  return v;
}

// ── state capture ───────────────────────────────────────────────────────────
/** World properties that are never persisted (runtime-only). */
const RUNTIME_KEYS = new Set(['bus', 'dirtyLayers', 'dirtyRect']);
/** Handled specially (not copied verbatim into `state`). */
const SPECIAL_KEYS = new Set(['size', 'buildings', 'notices', 'fields']);
/** Documented World state: always persisted (JSON drops anything unserializable inside). */
const STATE_KEYS = new Set([
  'settings', 'seaLevel', 'floodOffset', 'time', 'weather', 'economy', 'stats', 'history', 'nextBuildingId', 'districts',
  'transitLines', 'connections', 'home', 'milestone', 'creative', 'unlockAll', 'unlockedIds', 'policies', 'achievements',
  'nextNoticeId', 'activeEvents', 'nextEventId', 'rngState', 'playTime', 'createdAt', 'ext',
]);

function isPlainData(v: unknown, depth = 0): boolean {
  if (v === null || v === undefined) return true;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return true;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return false;
  if (depth > 3) return true; // deep values are validated by JSON.stringify itself
  if (Array.isArray(v)) return v.every((x) => isPlainData(x, depth + 1));
  if (v instanceof Map || v instanceof Set || v instanceof Date) return true;
  if (ArrayBuffer.isView(v)) return true;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v as object).every((x) => isPlainData(x, depth + 1));
}

function captureState(world: World): { state: Record<string, unknown>; arrays: { key: string; arr: ArrayBufferView }[] } {
  const state: Record<string, unknown> = {};
  const arrays: { key: string; arr: ArrayBufferView }[] = [];
  const w = world as unknown as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (RUNTIME_KEYS.has(key) || SPECIAL_KEYS.has(key)) continue;
    const v = w[key];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      if (sectionType(v)) arrays.push({ key, arr: v });
      continue;
    }
    // properties added to World later are persisted when they hold plain data
    if (!STATE_KEYS.has(key) && !isPlainData(v)) continue;
    state[key] = v;
  }
  // scalar fields: known ids first (stable order), then any extra ones
  const fieldKeys = [...FIELD_IDS, ...Object.keys(world.fields).filter((k) => !FIELD_IDS.includes(k as FieldId))];
  for (const f of fieldKeys) {
    const arr = world.fields[f as FieldId];
    if (arr && sectionType(arr)) arrays.push({ key: 'fields.' + f, arr });
  }
  state.buildings = [...world.buildings.values()];
  state.notices = world.notices.slice(-SAVED_NOTICES);
  return { state, arrays };
}

// ── compression ─────────────────────────────────────────────────────────────
export function compressionAvailable(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

async function gzip(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    return await pipeThrough(data, new CompressionStream('gzip'));
  } catch (e) {
    console.warn('[save] gzip failed, storing uncompressed', e);
    return null;
  }
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new SaveFormatError('This browser cannot read compressed saves (DecompressionStream is unavailable). Try an up-to-date Chrome, Edge, Firefox or Safari.', 'unsupported');
  }
  try {
    return await pipeThrough(data, new DecompressionStream('gzip'));
  } catch {
    throw new SaveFormatError('The save file is damaged: its compressed data is corrupt or incomplete.', 'corrupt');
  }
}

// ── serialize ───────────────────────────────────────────────────────────────
export interface SerializeOptions {
  meta?: Partial<SaveFileMeta>;
  /** skip gzip (tests, debugging) */
  uncompressed?: boolean;
}

/** World → .urbis bytes. */
export async function serializeWorld(world: World, opts: SerializeOptions = {}): Promise<Uint8Array> {
  const { state, arrays } = captureState(world);
  const sections: SectionEntry[] = [];
  let binBytes = 0;
  for (const { key, arr } of arrays) {
    const type = sectionType(arr)!;
    const len = arr.byteLength / CTOR[type].BYTES_PER_ELEMENT;
    sections.push({ key, type, offset: binBytes, length: len });
    binBytes = align(binBytes + arr.byteLength);
  }
  const doc: SaveDoc = {
    format: 'urbis-save',
    version: SAVE_VERSION,
    meta: { app: GAME_NAME, savedAt: Date.now(), ...opts.meta },
    size: world.size,
    state,
    sections,
  };
  let json: Uint8Array;
  try {
    json = new TextEncoder().encode(JSON.stringify(doc, replacer));
  } catch (e) {
    throw new SaveFormatError(`The city could not be saved: its state is not serializable (${(e as Error).message}).`, 'invalid');
  }
  const binStart = align(4 + json.length);
  const total = binStart + binBytes;
  if (total > MAX_CONTAINER_BYTES) throw new SaveFormatError('The city is too large to save.', 'invalid');
  const container = new Uint8Array(total);
  new DataView(container.buffer).setUint32(0, json.length, true);
  container.set(json, 4);
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i].arr;
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const at = binStart + sections[i].offset;
    container.set(bytes, at);
    if (!LITTLE_ENDIAN) swapBytes(container.subarray(at, at + a.byteLength), CTOR[sections[i].type].BYTES_PER_ELEMENT);
  }
  const crc = crc32(container);
  const packed = opts.uncompressed ? null : await gzip(container);
  const payload = packed ?? container;
  const out = new Uint8Array(FRAME_BYTES + payload.length);
  for (let i = 0; i < 4; i++) out[i] = SAVE_MAGIC.charCodeAt(i);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, SAVE_VERSION, true);
  out[6] = packed ? FLAG_GZIP : 0;
  out[7] = 0;
  dv.setUint32(8, total, true);
  dv.setUint32(12, crc, true);
  out.set(payload, FRAME_BYTES);
  return out;
}

// ── decode + validate ───────────────────────────────────────────────────────
/** Quick check of the 16-byte frame (no decompression). */
export function looksLikeSave(bytes: Uint8Array): boolean {
  if (bytes.length < FRAME_BYTES) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== SAVE_MAGIC.charCodeAt(i)) return false;
  return true;
}

function expectedLength(key: string, size: number): number | null {
  if (key === 'heights') return (size + 1) * (size + 1);
  if (key.startsWith('fields.')) return size * size;
  if (['water', 'road', 'roadFlags', 'zone', 'bldg', 'trees', 'district'].includes(key)) return size * size;
  return null;
}

/** Validate + decompress + parse. Throws SaveFormatError with a friendly message. */
export async function decodeSave(input: Uint8Array | ArrayBuffer): Promise<DecodedSave> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new SaveFormatError('The file is empty.', 'not-a-save');
  if (!looksLikeSave(bytes)) {
    throw new SaveFormatError(bytes.length < FRAME_BYTES ? 'This file is too small to be an URBIS save.' : 'This file is not an URBIS save (.urbis).', 'not-a-save');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileVersion = dv.getUint16(4, true);
  const flags = bytes[6];
  const total = dv.getUint32(8, true);
  const crc = dv.getUint32(12, true);
  if (fileVersion > SAVE_VERSION) {
    throw new SaveFormatError(`This save was made with a newer version of ${GAME_NAME} (format v${fileVersion}; this build reads up to v${SAVE_VERSION}). Please update the game.`, 'newer-version');
  }
  if (fileVersion < 1) throw new SaveFormatError('The save file header is damaged (invalid version).', 'corrupt');
  if (flags & ~KNOWN_FLAGS) throw new SaveFormatError('The save file uses an unknown encoding.', 'unsupported');
  if (total < 8 || total > MAX_CONTAINER_BYTES) throw new SaveFormatError('The save file header is damaged (invalid length).', 'corrupt');
  const payload = bytes.subarray(FRAME_BYTES);
  const compressed = (flags & FLAG_GZIP) !== 0;
  let container: Uint8Array;
  if (compressed) {
    container = await gunzip(payload);
  } else {
    if (payload.length < total) throw new SaveFormatError('The save file is incomplete (it was cut off while downloading or copying).', 'truncated');
    container = payload.slice(0, total);
  }
  if (container.length !== total) {
    throw new SaveFormatError(container.length < total ? 'The save file is incomplete (it was cut off while downloading or copying).' : 'The save file is damaged (unexpected data length).', container.length < total ? 'truncated' : 'corrupt');
  }
  if (crc32(container) !== crc) throw new SaveFormatError('The save file is damaged (checksum mismatch).', 'corrupt');
  // own, aligned buffer so typed views are valid
  if (container.byteOffset % ALIGN !== 0) container = container.slice();
  const cdv = new DataView(container.buffer, container.byteOffset, container.byteLength);
  const jsonLen = cdv.getUint32(0, true);
  if (jsonLen <= 0 || 4 + jsonLen > container.length) throw new SaveFormatError('The save file is damaged (header out of range).', 'corrupt');
  let doc: SaveDoc;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(container.subarray(4, 4 + jsonLen)), reviver) as SaveDoc;
  } catch {
    throw new SaveFormatError('The save file is damaged (its header could not be read).', 'corrupt');
  }
  if (!doc || typeof doc !== 'object' || doc.format !== 'urbis-save') throw new SaveFormatError('The save file is damaged (unknown document format).', 'corrupt');
  if (typeof doc.version !== 'number') doc.version = fileVersion;
  if (doc.version > SAVE_VERSION) throw new SaveFormatError(`This save was made with a newer version of ${GAME_NAME}. Please update the game.`, 'newer-version');
  const size = doc.size;
  if (!Number.isInteger(size) || size < 8 || size > 4096) throw new SaveFormatError('The save file is damaged (invalid map size).', 'corrupt');
  if (!doc.state || typeof doc.state !== 'object') throw new SaveFormatError('The save file is damaged (missing city state).', 'corrupt');
  if (!Array.isArray(doc.sections)) throw new SaveFormatError('The save file is damaged (missing map layers).', 'corrupt');
  if (!doc.meta || typeof doc.meta !== 'object') doc.meta = { savedAt: 0 };
  const binStart = align(4 + jsonLen);
  for (const s of doc.sections) {
    const C = s && CTOR[s.type];
    if (!C || typeof s.key !== 'string' || !Number.isInteger(s.offset) || !Number.isInteger(s.length) || s.offset < 0 || s.length < 0 || s.offset % ALIGN !== 0) {
      throw new SaveFormatError('The save file is damaged (invalid layer table).', 'corrupt');
    }
    const end = binStart + s.offset + s.length * C.BYTES_PER_ELEMENT;
    if (end > container.length) throw new SaveFormatError('The save file is incomplete (map layers are missing).', 'truncated');
    const want = expectedLength(s.key, size);
    if (want !== null && want !== s.length) throw new SaveFormatError(`The save file is damaged (layer "${s.key}" has the wrong size).`, 'corrupt');
  }
  migrate(doc);
  return { doc, container, binStart, fileVersion, compressed };
}

// ── rebuild the World ───────────────────────────────────────────────────────
function fallbackSettings(): MapSettings {
  return {
    cityName: 'Unnamed City', mapSize: 'medium', theme: 'temperate', seed: 1, style: 'european', difficulty: 'normal',
    creative: false, disasters: true, mountains: 0.5, water: 0.5, forests: 0.5,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readSection(d: DecodedSave, s: SectionEntry): AnyTyped {
  const C = CTOR[s.type];
  const byteLen = s.length * C.BYTES_PER_ELEMENT;
  const start = d.container.byteOffset + d.binStart + s.offset;
  if (!LITTLE_ENDIAN) {
    const copy = d.container.slice(d.binStart + s.offset, d.binStart + s.offset + byteLen);
    swapBytes(copy, C.BYTES_PER_ELEMENT);
    return new C(copy.buffer, 0, s.length);
  }
  if (start % C.BYTES_PER_ELEMENT === 0) return new C(d.container.buffer, start, s.length);
  const copy = d.container.slice(d.binStart + s.offset, d.binStart + s.offset + byteLen);
  return new C(copy.buffer, 0, s.length);
}

function sanitizeBuildings(list: unknown, size: number): Building[] {
  if (!Array.isArray(list)) return [];
  const out: Building[] = [];
  const seen = new Set<number>();
  for (const b of list) {
    if (!isObj(b)) continue;
    const id = b.id, x = b.x, y = b.y, w = b.w, h = b.h;
    if (!Number.isInteger(id) || (id as number) <= 0 || seen.has(id as number)) continue;
    if (![x, y, w, h].every((v) => Number.isInteger(v))) continue;
    if ((w as number) < 1 || (h as number) < 1 || (x as number) < -8 || (y as number) < -8 || (x as number) >= size + 8 || (y as number) >= size + 8) continue;
    if (typeof b.defId !== 'string' || (b.kind !== 'zoned' && b.kind !== 'service')) continue;
    seen.add(id as number);
    out.push(b as unknown as Building);
  }
  return out;
}

/** Turn a decoded save into a fresh World (exact inverse of serializeWorld). */
export function buildWorld(d: DecodedSave): World {
  const { doc } = d;
  const st = doc.state;
  const settings: MapSettings = { ...fallbackSettings(), ...(isObj(st.settings) ? (st.settings as Partial<MapSettings>) : {}) };
  let world: World;
  try {
    world = new World(settings, doc.size);
  } catch (e) {
    throw new SaveFormatError(`The save could not be opened (${(e as Error).message}).`, 'invalid');
  }
  const w = world as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(st)) {
    if (RUNTIME_KEYS.has(key) || SPECIAL_KEYS.has(key) || key === 'settings') continue;
    if (!(key in w)) continue; // property no longer exists on World
    const cur = w[key];
    if (ArrayBuffer.isView(cur) || typeof cur === 'function') continue;
    if (value === undefined) continue;
    switch (key) {
      case 'time':
      case 'weather':
        if (isObj(value)) w[key] = { ...(cur as object), ...value };
        break;
      case 'stats':
        if (isObj(value)) w[key] = { ...emptyStats(), ...value };
        break;
      case 'economy':
        if (isObj(value)) {
          const e = cur as Record<string, unknown>;
          w[key] = {
            ...e, ...value,
            taxes: { ...(e.taxes as object), ...(isObj(value.taxes) ? value.taxes : {}) },
            budgets: { ...(e.budgets as object), ...(isObj(value.budgets) ? value.budgets : {}) },
          };
        }
        break;
      case 'ext':
        if (isObj(value)) w[key] = value;
        break;
      default:
        // keep the type of the constructor default when it is a primitive
        if (cur !== null && cur !== undefined && typeof cur !== 'object' && typeof value !== typeof cur) continue;
        if (Array.isArray(cur) && !Array.isArray(value)) continue;
        w[key] = value;
    }
  }
  world.settings = settings;
  // buildings
  const buildings = sanitizeBuildings(st.buildings, doc.size);
  world.buildings = new Map(buildings.map((b) => [b.id, b]));
  let maxId = 0;
  for (const b of buildings) if (b.id > maxId) maxId = b.id;
  if (!Number.isInteger(world.nextBuildingId) || world.nextBuildingId <= maxId) world.nextBuildingId = maxId + 1;
  // notices
  world.notices = Array.isArray(st.notices) ? (st.notices as Notice[]).filter(isObj).slice(-SAVED_NOTICES) : [];
  let maxNotice = 0;
  for (const n of world.notices) if (typeof n.id === 'number' && n.id > maxNotice) maxNotice = n.id;
  if (!Number.isInteger(world.nextNoticeId) || world.nextNoticeId <= maxNotice) world.nextNoticeId = maxNotice + 1;
  // binary layers
  for (const s of doc.sections) {
    const src = readSection(d, s);
    if (s.key.startsWith('fields.')) {
      const f = s.key.slice(7);
      const cur = world.fields[f as FieldId];
      if (cur && cur.length === src.length) cur.set(src as unknown as ArrayLike<number>);
      else world.fields[f as FieldId] = new Uint8Array(src as unknown as ArrayLike<number>);
      continue;
    }
    const cur = w[s.key];
    if (ArrayBuffer.isView(cur) && !(cur instanceof DataView)) {
      const t = cur as AnyTyped;
      if (t.length === src.length && sectionType(t) === s.type) t.set(src as never);
      else if (t.length === src.length) t.set(Array.from(src as unknown as ArrayLike<number>));
    }
  }
  return world;
}

/** .urbis bytes → World (validated). */
export async function deserializeWorld(bytes: Uint8Array | ArrayBuffer): Promise<World> {
  return buildWorld(await decodeSave(bytes));
}

/** Friendly message for any error thrown while reading/writing saves. */
export function describeSaveError(e: unknown): string {
  if (e instanceof SaveFormatError) return e.message;
  const err = e as { name?: string; message?: string } | null;
  if (err && isQuotaError(err)) return 'Not enough browser storage space for this save.';
  return err?.message ? `Unexpected error: ${err.message}` : 'Unexpected error.';
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number; message?: string } | null;
  if (!err) return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || /quota/i.test(err.message ?? '');
}
