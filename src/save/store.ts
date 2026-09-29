// Persistent save storage: IndexedDB database "urbis" with two object stores —
// "meta" (small SaveMeta records, so listing is instant) and "blobs" (the
// .urbis bytes, keyed by the same id). A MemoryStore provides the same API for
// private browsing / blocked storage / quota overflow (session-only saves).
import type { SaveMeta } from './SaveManager';
import { isQuotaError } from './serialize';

export const DB_NAME = 'urbis';
export const DB_VERSION = 1;
const META = 'meta';
const BLOBS = 'blobs';

export interface SaveStore {
  readonly kind: 'indexeddb' | 'memory';
  listMeta(): Promise<SaveMeta[]>;
  getMeta(id: string): Promise<SaveMeta | undefined>;
  getBytes(id: string): Promise<Uint8Array | undefined>;
  /** atomically write meta + bytes */
  put(meta: SaveMeta, bytes: Uint8Array): Promise<void>;
  putMeta(meta: SaveMeta): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Error raised when the browser refuses more storage. */
export class StorageFullError extends Error {
  constructor(cause?: unknown) {
    super('Browser storage is full');
    this.name = 'StorageFullError';
    (this as { cause?: unknown }).cause = cause;
  }
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error);
  });
}

function toOwnedBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  return bytes.slice().buffer as ArrayBuffer;
}

export class IdbStore implements SaveStore {
  readonly kind = 'indexeddb' as const;
  private constructor(private db: IDBDatabase) {
    // another tab upgrading the schema: step aside gracefully
    db.onversionchange = () => db.close();
  }

  /** Open (and create/upgrade) the database. Rejects when IndexedDB is unusable. */
  static open(timeoutMs = 5000): Promise<IdbStore> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      let req: IDBOpenDBRequest;
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        fail(e);
        return;
      }
      const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), timeoutMs);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) {
          const s = db.createObjectStore(META, { keyPath: 'id' });
          s.createIndex('savedAt', 'savedAt');
        }
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          req.result.close();
          return;
        }
        settled = true;
        resolve(new IdbStore(req.result));
      };
      req.onerror = () => {
        clearTimeout(timer);
        fail(req.error ?? new Error('IndexedDB open failed'));
      };
      req.onblocked = () => {
        /* wait for the other tab; the timeout above handles a permanent block */
      };
    });
  }

  async listMeta(): Promise<SaveMeta[]> {
    const tx = this.db.transaction(META, 'readonly');
    const all = await reqToPromise(tx.objectStore(META).getAll() as IDBRequest<SaveMeta[]>);
    return all;
  }

  async getMeta(id: string): Promise<SaveMeta | undefined> {
    const tx = this.db.transaction(META, 'readonly');
    return (await reqToPromise(tx.objectStore(META).get(id) as IDBRequest<SaveMeta | undefined>)) ?? undefined;
  }

  async getBytes(id: string): Promise<Uint8Array | undefined> {
    const tx = this.db.transaction(BLOBS, 'readonly');
    const v = await reqToPromise(tx.objectStore(BLOBS).get(id) as IDBRequest<unknown>);
    if (!v) return undefined;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (v instanceof Blob) return new Uint8Array(await v.arrayBuffer());
    return undefined;
  }

  async put(meta: SaveMeta, bytes: Uint8Array): Promise<void> {
    try {
      const tx = this.db.transaction([META, BLOBS], 'readwrite');
      const done = txDone(tx);
      tx.objectStore(BLOBS).put(toOwnedBuffer(bytes), meta.id);
      tx.objectStore(META).put(meta);
      await done;
    } catch (e) {
      if (isQuotaError(e)) throw new StorageFullError(e);
      throw e;
    }
  }

  async putMeta(meta: SaveMeta): Promise<void> {
    try {
      const tx = this.db.transaction(META, 'readwrite');
      const done = txDone(tx);
      tx.objectStore(META).put(meta);
      await done;
    } catch (e) {
      if (isQuotaError(e)) throw new StorageFullError(e);
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    const tx = this.db.transaction([META, BLOBS], 'readwrite');
    const done = txDone(tx);
    tx.objectStore(META).delete(id);
    tx.objectStore(BLOBS).delete(id);
    await done;
  }

  close(): void {
    this.db.close();
  }
}

/** Session-only store (private mode, storage disabled, or quota overflow). */
export class MemoryStore implements SaveStore {
  readonly kind = 'memory' as const;
  private metas = new Map<string, SaveMeta>();
  private blobs = new Map<string, Uint8Array>();

  async listMeta(): Promise<SaveMeta[]> {
    return [...this.metas.values()].map((m) => ({ ...m }));
  }
  async getMeta(id: string): Promise<SaveMeta | undefined> {
    const m = this.metas.get(id);
    return m ? { ...m } : undefined;
  }
  async getBytes(id: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(id);
  }
  async put(meta: SaveMeta, bytes: Uint8Array): Promise<void> {
    this.metas.set(meta.id, { ...meta });
    this.blobs.set(meta.id, bytes);
  }
  async putMeta(meta: SaveMeta): Promise<void> {
    if (this.metas.has(meta.id)) this.metas.set(meta.id, { ...meta });
  }
  async delete(id: string): Promise<void> {
    this.metas.delete(id);
    this.blobs.delete(id);
  }
  has(id: string): boolean {
    return this.metas.has(id);
  }
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}
