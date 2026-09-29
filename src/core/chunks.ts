// Chunk bookkeeping helper for renderers: maps cell rects to chunk keys & dirty sets.
import { CHUNK } from './constants';
import type { Rect } from './types';

export class ChunkGrid {
  readonly chunksPerSide: number;
  readonly dirty = new Set<number>();
  constructor(public readonly size: number, public readonly chunk = CHUNK) {
    this.chunksPerSide = Math.ceil(size / chunk);
  }
  key(cx: number, cy: number): number {
    return cy * this.chunksPerSide + cx;
  }
  coords(key: number): [number, number] {
    return [key % this.chunksPerSide, Math.floor(key / this.chunksPerSide)];
  }
  chunkOfCell(x: number, y: number): number {
    return this.key(Math.floor(x / this.chunk), Math.floor(y / this.chunk));
  }
  /** cell rect covered by chunk key */
  rect(key: number): Rect {
    const [cx, cy] = this.coords(key);
    const x0 = cx * this.chunk,
      y0 = cy * this.chunk;
    return { x0, y0, x1: Math.min(this.size, x0 + this.chunk) - 1, y1: Math.min(this.size, y0 + this.chunk) - 1 };
  }
  /** mark chunks overlapping rect (expanded by `pad` cells) dirty */
  markRect(r: Rect, pad = 1): void {
    const n = this.chunksPerSide;
    const cx0 = Math.max(0, Math.floor((r.x0 - pad) / this.chunk));
    const cy0 = Math.max(0, Math.floor((r.y0 - pad) / this.chunk));
    const cx1 = Math.min(n - 1, Math.floor((r.x1 + pad) / this.chunk));
    const cy1 = Math.min(n - 1, Math.floor((r.y1 + pad) / this.chunk));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(this.key(cx, cy));
  }
  markAll(): void {
    const n = this.chunksPerSide;
    for (let i = 0; i < n * n; i++) this.dirty.add(i);
  }
  /** pop up to `max` dirty chunk keys, nearest to (px, py) cell first */
  take(max: number, px?: number, py?: number): number[] {
    let keys = [...this.dirty];
    if (px !== undefined && py !== undefined && keys.length > max) {
      const c = this.chunk;
      keys.sort((a, b) => {
        const [ax, ay] = this.coords(a),
          [bx, by] = this.coords(b);
        const da = (ax * c + c / 2 - px) ** 2 + (ay * c + c / 2 - py) ** 2;
        const db = (bx * c + c / 2 - px) ** 2 + (by * c + c / 2 - py) ** 2;
        return da - db;
      });
    }
    keys = keys.slice(0, max);
    for (const k of keys) this.dirty.delete(k);
    return keys;
  }
}
