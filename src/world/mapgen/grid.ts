// ─────────────────────────────────────────────────────────────────────────────
// Map generator grid toolkit: typed-array data structures and O(n) field
// operations shared by every generation stage. Pure, allocation-light, worker
// safe (no DOM / THREE).
// ─────────────────────────────────────────────────────────────────────────────

/** 8-neighbour offsets (dx, dy) and their lengths; index 0..3 are the 4-neighbours N,E,S,W. */
export const N8_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
export const N8_DY = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);
export const N8_LEN = new Float32Array([1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]);

export const clampf = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const sstep = (a: number, b: number, v: number): number => {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// ── Priority queue ──────────────────────────────────────────────────────────

/**
 * Binary min-heap of (float key, int value) pairs backed by typed arrays.
 * Ties are resolved by insertion sequence so results are fully deterministic.
 */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private seqs: Float64Array;
  private seq = 0;
  size = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.seqs = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
    this.seq = 0;
  }

  private grow(): void {
    const cap = this.keys.length * 2;
    const k = new Float64Array(cap);
    k.set(this.keys);
    const v = new Int32Array(cap);
    v.set(this.vals);
    const s = new Float64Array(cap);
    s.set(this.seqs);
    this.keys = k;
    this.vals = v;
    this.seqs = s;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) this.grow();
    const keys = this.keys, vals = this.vals, seqs = this.seqs;
    const sq = this.seq++;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p];
      if (pk < key || (pk === key && seqs[p] < sq)) break;
      keys[i] = pk;
      vals[i] = vals[p];
      seqs[i] = seqs[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
    seqs[i] = sq;
  }

  /** key of the minimum element (heap must be non-empty) */
  peekKey(): number {
    return this.keys[0];
  }

  /** remove the minimum element and return its value */
  pop(): number {
    const keys = this.keys, vals = this.vals, seqs = this.seqs;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const k = keys[n], v = vals[n], s = seqs[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        let c = l;
        const r = l + 1;
        if (r < n && (keys[r] < keys[l] || (keys[r] === keys[l] && seqs[r] < seqs[l]))) c = r;
        if (keys[c] > k || (keys[c] === k && seqs[c] > s)) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        seqs[i] = seqs[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
      seqs[i] = s;
    }
    return top;
  }
}

/** FIFO ring queue of ints. */
export class IntQueue {
  private buf: Int32Array;
  private head = 0;
  private tail = 0;
  constructor(capacity = 1024) {
    let c = 16;
    while (c < capacity) c <<= 1;
    this.buf = new Int32Array(c);
  }
  get length(): number {
    return this.tail - this.head;
  }
  clear(): void {
    this.head = this.tail = 0;
  }
  push(v: number): void {
    if (this.tail - this.head === this.buf.length) {
      const nb = new Int32Array(this.buf.length * 2);
      const mask = this.buf.length - 1;
      for (let i = this.head; i < this.tail; i++) nb[i - this.head] = this.buf[i & mask];
      this.tail -= this.head;
      this.head = 0;
      this.buf = nb;
    }
    this.buf[this.tail++ & (this.buf.length - 1)] = v;
  }
  shift(): number {
    return this.buf[this.head++ & (this.buf.length - 1)];
  }
}

// ── Euclidean distance transform ───────────────────────────────────────────

const EDT_INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let vk = v[k];
    let s = (fq - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
    while (s <= z[k]) {
      k--;
      vk = v[k];
      s = (fq - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const vk = v[k];
    const dq = q - vk;
    d[q] = dq * dq + f[vk];
    arg[q] = vk;
  }
}

export interface DistanceField {
  /** euclidean distance (grid units) to the nearest seed; large (>1e9) when there are no seeds */
  dist: Float32Array;
  /** grid index of the nearest seed (-1 when there are no seeds) */
  nearest: Int32Array | null;
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) of a w×h grid.
 * `seed[i] != 0` marks seed pixels. Optionally returns the index of the nearest seed.
 */
export function distanceTransform(seed: Uint8Array, w: number, h: number, wantNearest = false): DistanceField {
  const n = w * h;
  const m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m), arg = new Int32Array(m);
  const tmp = new Float64Array(n);
  const rowOf = wantNearest ? new Int32Array(n) : null;
  // columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = seed[y * w + x] ? 0 : EDT_INF;
    edt1d(f, h, d, arg, v, z);
    for (let y = 0; y < h; y++) {
      tmp[y * w + x] = d[y];
      if (rowOf) rowOf[y * w + x] = arg[y];
    }
  }
  const dist = new Float32Array(n);
  const nearest = wantNearest ? new Int32Array(n) : null;
  // rows
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) f[x] = tmp[o + x];
    edt1d(f, w, d, arg, v, z);
    for (let x = 0; x < w; x++) {
      const dd = d[x];
      dist[o + x] = dd >= EDT_INF * 0.5 ? 1e10 : Math.sqrt(dd);
      if (nearest && rowOf) {
        const sx = arg[x];
        nearest[o + x] = dd >= EDT_INF * 0.5 ? -1 : rowOf[o + sx] * w + sx;
      }
    }
  }
  return { dist, nearest };
}

// ── Blurs & resampling ──────────────────────────────────────────────────────

/** One separable box-blur pass of radius r with clamped edges (in place via scratch). */
function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      const kk = k < 0 ? 0 : k >= len ? len - 1 : k;
      acc += src[base + kk * stride];
    }
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = acc * inv;
      const outI = i - r < 0 ? 0 : i - r;
      const inI = i + r + 1 >= len ? len - 1 : i + r + 1;
      acc += src[base + inI * stride] - src[base + outI * stride];
    }
  }
}

/**
 * Approximate gaussian blur (3 box passes per axis) with clamped edges.
 * Returns a new array; `radius` ≈ sigma * 1.2 in grid units.
 */
export function blur(src: Float32Array, w: number, h: number, radius: number, passes = 3): Float32Array {
  const a = new Float32Array(src);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return a;
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    boxBlurPass(a, b, w, h, r, true);
    boxBlurPass(b, a, w, h, r, false);
  }
  return a;
}

/** Bilinear sample of a w×h grid at fractional grid coordinates (clamped). */
export function sampleBilinear(g: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  let ix = x | 0, iy = y | 0;
  if (ix >= w - 1) ix = w - 2;
  if (iy >= h - 1) iy = h - 2;
  const fx = x - ix, fy = y - iy;
  const i = iy * w + ix;
  const a = g[i], b = g[i + 1], c = g[i + w], d = g[i + w + 1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Cell heights (average of 4 corners) from a (size+1)^2 vertex grid. */
export function cellHeights(heights: Float32Array, size: number, out?: Float32Array): Float32Array {
  const V = size + 1;
  const res = out ?? new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const r0 = y * V, r1 = r0 + V, o = y * size;
    for (let x = 0; x < size; x++) res[o + x] = (heights[r0 + x] + heights[r0 + x + 1] + heights[r1 + x] + heights[r1 + x + 1]) * 0.25;
  }
  return res;
}

/** Per-cell slope (max-min corner difference / CELL) exactly like World.cellSlope. */
export function cellSlopes(heights: Float32Array, size: number, cellSize: number, out?: Float32Array): Float32Array {
  const V = size + 1;
  const res = out ?? new Float32Array(size * size);
  const inv = 1 / cellSize;
  for (let y = 0; y < size; y++) {
    const r0 = y * V, r1 = r0 + V, o = y * size;
    for (let x = 0; x < size; x++) {
      const a = heights[r0 + x], b = heights[r0 + x + 1], c = heights[r1 + x], d = heights[r1 + x + 1];
      let lo = a, hi = a;
      if (b < lo) lo = b; else if (b > hi) hi = b;
      if (c < lo) lo = c; else if (c > hi) hi = c;
      if (d < lo) lo = d; else if (d > hi) hi = d;
      res[o + x] = (hi - lo) * inv;
    }
  }
  return res;
}

/** Minimum corner height of each cell. */
export function cellMinHeights(heights: Float32Array, size: number, out?: Float32Array): Float32Array {
  const V = size + 1;
  const res = out ?? new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const r0 = y * V, r1 = r0 + V, o = y * size;
    for (let x = 0; x < size; x++) {
      let m = heights[r0 + x];
      const b = heights[r0 + x + 1], c = heights[r1 + x], d = heights[r1 + x + 1];
      if (b < m) m = b;
      if (c < m) m = c;
      if (d < m) m = d;
      res[o + x] = m;
    }
  }
  return res;
}

/** Deterministic histogram-based quantile of the values selected by `mask` (or all). */
export function quantile(values: Float32Array, q: number, mask?: Uint8Array, bins = 4096): number {
  let lo = Infinity, hi = -Infinity, count = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    count++;
  }
  if (count === 0) return 0;
  if (hi - lo < 1e-9) return lo;
  const hist = new Uint32Array(bins);
  const scale = (bins - 1) / (hi - lo);
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    hist[((values[i] - lo) * scale) | 0]++;
  }
  const target = clampf(q, 0, 1) * count;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return lo + (b + 0.5) / scale;
  }
  return hi;
}

/** Label 4- or 8-connected components of cells where mask != 0. Returns labels (0 = none) and count. */
export function labelComponents(mask: Uint8Array, w: number, h: number, eight: boolean): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const q = new IntQueue(1024);
  let count = 0;
  const nn = eight ? 8 : 4;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = ++count;
    labels[s] = id;
    q.clear();
    q.push(s);
    while (q.length) {
      const i = q.shift();
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < nn; k++) {
        const nx = x + N8_DX[k], ny = y + N8_DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!mask[j] || labels[j]) continue;
        labels[j] = id;
        q.push(j);
      }
    }
  }
  return { labels, count };
}
