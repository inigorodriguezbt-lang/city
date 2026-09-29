// ─────────────────────────────────────────────────────────────────────────────
// Grid kernels for the field engine: separable box blurs (cache-friendly: the
// vertical pass walks rows with per-column accumulators), max-with-decay
// chamfer propagation and float → byte conversion. Worker-safe (no DOM).
// ─────────────────────────────────────────────────────────────────────────────

/** Scratch buffers reused by the blur kernels. */
export class BlurScratch {
  tmp: Float32Array;
  col: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.tmp = new Float32Array(w * h);
    this.col = new Float32Array(w);
  }
}

/** Horizontal box pass of radius r with clamped edges: src → dst. */
function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = src[o] * (r + 1);
    for (let k = 1; k <= r; k++) acc += src[o + (k > last ? last : k)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      const add = x + r + 1;
      const sub = x - r;
      acc += src[o + (add > last ? last : add)] - src[o + (sub < 0 ? 0 : sub)];
    }
  }
}

/** Vertical box pass of radius r with clamped edges, row-major via column accumulators. */
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, acc: Float32Array): void {
  const inv = 1 / (2 * r + 1);
  const last = h - 1;
  for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
  for (let k = 1; k <= r; k++) {
    const o = (k > last ? last : k) * w;
    for (let x = 0; x < w; x++) acc[x] += src[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const addRow = y + r + 1;
    const subRow = y - r;
    const ao = (addRow > last ? last : addRow) * w;
    const so = (subRow < 0 ? 0 : subRow) * w;
    for (let x = 0; x < w; x++) {
      const a = acc[x];
      dst[o + x] = a * inv;
      acc[x] = a + src[ao + x] - src[so + x];
    }
  }
}

/**
 * In-place approximate gaussian blur: `passes` rounds of horizontal + vertical
 * box passes of radius r (3 passes ≈ gaussian with sigma ≈ r).
 */
export function blurInPlace(a: Float32Array, s: BlurScratch, r: number, passes = 2): void {
  if (r <= 0 || passes <= 0) return;
  const { w, h, tmp, col } = s;
  for (let p = 0; p < passes; p++) {
    boxH(a, tmp, w, h, r);
    boxV(tmp, a, w, h, r, col);
  }
}

/**
 * Max-propagation with multiplicative decay over 8 neighbours (two raster
 * passes): a[i] = max(a[i], a[j] · k^dist). Gives octagonal falloff around
 * every source; the loudest source dominates (like decibels).
 */
export function chamferDecay(a: Float32Array, w: number, h: number, k: number): void {
  const kd = Math.pow(k, Math.SQRT2);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const i = o + x;
      let v = a[i];
      if (x > 0) { const c = a[i - 1] * k; if (c > v) v = c; }
      if (y > 0) {
        const u = i - w;
        let c = a[u] * k; if (c > v) v = c;
        if (x > 0) { c = a[u - 1] * kd; if (c > v) v = c; }
        if (x < w - 1) { c = a[u + 1] * kd; if (c > v) v = c; }
      }
      a[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const o = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = o + x;
      let v = a[i];
      if (x < w - 1) { const c = a[i + 1] * k; if (c > v) v = c; }
      if (y < h - 1) {
        const d = i + w;
        let c = a[d] * k; if (c > v) v = c;
        if (x > 0) { c = a[d - 1] * kd; if (c > v) v = c; }
        if (x < w - 1) { c = a[d + 1] * kd; if (c > v) v = c; }
      }
      a[i] = v;
    }
  }
}

/**
 * Chebyshev distance (in cells, capped at `cap`) from every cell to the
 * nearest cell with mask[i] != 0. Two-pass chamfer on bytes.
 */
export function distanceToMask(mask: Uint8Array, out: Uint8Array, w: number, h: number, cap: number): void {
  const c = Math.min(254, cap);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 0 : c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = out[i];
      if (v === 0) continue;
      if (x > 0 && out[i - 1] + 1 < v) v = out[i - 1] + 1;
      if (y > 0) {
        const u = i - w;
        if (out[u] + 1 < v) v = out[u] + 1;
        if (x > 0 && out[u - 1] + 1 < v) v = out[u - 1] + 1;
        if (x < w - 1 && out[u + 1] + 1 < v) v = out[u + 1] + 1;
      }
      out[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = out[i];
      if (v === 0) continue;
      if (x < w - 1 && out[i + 1] + 1 < v) v = out[i + 1] + 1;
      if (y < h - 1) {
        const d = i + w;
        if (out[d] + 1 < v) v = out[d] + 1;
        if (x > 0 && out[d - 1] + 1 < v) v = out[d - 1] + 1;
        if (x < w - 1 && out[d + 1] + 1 < v) v = out[d + 1] + 1;
      }
      out[i] = v;
    }
  }
}

/** Round + clamp floats into bytes using the native clamped conversion. */
export function toBytes(src: Float32Array, dst: Uint8Array): void {
  new Uint8ClampedArray(dst.buffer, dst.byteOffset, dst.length).set(src);
}

/**
 * Dial's bucket queue for small positive integer edge costs: O(V + maxCost).
 * Entries are lazily invalidated (a node may be queued more than once; stale
 * pops are skipped by the caller comparing against its distance array).
 */
export class BucketQueue {
  private head: Int32Array;
  private nodeCell: Int32Array;
  private nodeNext: Int32Array;
  private used = 0;
  private maxUsed = 0;
  constructor(maxCost: number, cap = 1 << 16) {
    this.head = new Int32Array(maxCost + 1).fill(-1);
    this.nodeCell = new Int32Array(cap);
    this.nodeNext = new Int32Array(cap);
  }
  get maxCost(): number {
    return this.head.length - 1;
  }
  /** Grow the bucket range (clears the queue). */
  ensure(maxCost: number): void {
    if (maxCost + 1 > this.head.length) this.head = new Int32Array(maxCost + 1).fill(-1);
    else this.reset();
  }
  reset(): void {
    const h = this.head;
    for (let d = 0; d <= this.maxUsed && d < h.length; d++) h[d] = -1;
    this.used = 0;
    this.maxUsed = 0;
  }
  push(cell: number, d: number): void {
    if (this.used === this.nodeCell.length) {
      const c = new Int32Array(this.used * 2);
      c.set(this.nodeCell);
      this.nodeCell = c;
      const nx = new Int32Array(this.used * 2);
      nx.set(this.nodeNext);
      this.nodeNext = nx;
    }
    const k = this.used++;
    this.nodeCell[k] = cell;
    this.nodeNext[k] = this.head[d];
    this.head[d] = k;
    if (d > this.maxUsed) this.maxUsed = d;
  }
  /** Pop every cell queued at distance d (LIFO within the bucket). -1 when empty. */
  pop(d: number): number {
    const k = this.head[d];
    if (k < 0) return -1;
    this.head[d] = this.nodeNext[k];
    return this.nodeCell[k];
  }
  get highest(): number {
    return this.maxUsed;
  }
}

/**
 * Advect a field downwind: dst = Σₖ wₖ · src(p − k·(dx, dy)) for k = 0..steps,
 * with wₖ ∝ decayᵏ (normalised). Every tap uses the same fractional offset for
 * the whole grid, so the bilinear weights are hoisted out of the cell loop.
 * Edges clamp. Produces plumes that lean and stretch with the wind.
 */
export function driftSmear(src: Float32Array, dst: Float32Array, w: number, h: number, dx: number, dy: number, steps: number, decay: number): void {
  let norm = 0;
  for (let k = 0; k <= steps; k++) norm += Math.pow(decay, k);
  dst.fill(0);
  const lastX = w - 1, lastY = h - 1;
  for (let k = 0; k <= steps; k++) {
    const wk = Math.pow(decay, k) / norm;
    // sample upwind: p − k·d
    const ox = -dx * k, oy = -dy * k;
    const ix = Math.floor(ox), iy = Math.floor(oy);
    const fx = ox - ix, fy = oy - iy;
    const w00 = (1 - fx) * (1 - fy) * wk, w10 = fx * (1 - fy) * wk, w01 = (1 - fx) * fy * wk, w11 = fx * fy * wk;
    for (let y = 0; y < h; y++) {
      let sy0 = y + iy, sy1 = sy0 + 1;
      sy0 = sy0 < 0 ? 0 : sy0 > lastY ? lastY : sy0;
      sy1 = sy1 < 0 ? 0 : sy1 > lastY ? lastY : sy1;
      const r0 = sy0 * w, r1 = sy1 * w, o = y * w;
      // interior span where both x taps are in range
      const xa = Math.max(0, -ix), xb = Math.min(w, lastX - ix);
      for (let x = 0; x < xa && x < w; x++) {
        let sx0 = x + ix, sx1 = sx0 + 1;
        sx0 = sx0 < 0 ? 0 : sx0 > lastX ? lastX : sx0;
        sx1 = sx1 < 0 ? 0 : sx1 > lastX ? lastX : sx1;
        dst[o + x] += src[r0 + sx0] * w00 + src[r0 + sx1] * w10 + src[r1 + sx0] * w01 + src[r1 + sx1] * w11;
      }
      for (let x = xa; x < xb; x++) {
        const sx = x + ix;
        dst[o + x] += src[r0 + sx] * w00 + src[r0 + sx + 1] * w10 + src[r1 + sx] * w01 + src[r1 + sx + 1] * w11;
      }
      for (let x = Math.max(xa, xb); x < w; x++) {
        let sx0 = x + ix, sx1 = sx0 + 1;
        sx0 = sx0 < 0 ? 0 : sx0 > lastX ? lastX : sx0;
        sx1 = sx1 < 0 ? 0 : sx1 > lastX ? lastX : sx1;
        dst[o + x] += src[r0 + sx0] * w00 + src[r0 + sx1] * w10 + src[r1 + sx0] * w01 + src[r1 + sx1] * w11;
      }
    }
  }
}

/** Radial kernel shapes for additive stamps (take t² = (d / radius)²). */
export enum KernelShape {
  /** plateau then fade (service reach) */
  Plateau = 0,
  /** smooth bell (plumes, blight) */
  Bell = 1,
}

/**
 * Add `amount · kernel(d / radius)` to a float grid, with d measured from a
 * footprint rectangle [x0, x1) × [y0, y1) (0 inside it). Amount may be negative.
 */
export function stampAdd(F: Float32Array, s: number, x0: number, y0: number, x1: number, y1: number, radius: number, amount: number, shape: KernelShape): void {
  const R = radius;
  if (R <= 0 || amount === 0) return;
  const bx0 = Math.max(0, Math.floor(x0 - R)), by0 = Math.max(0, Math.floor(y0 - R));
  const bx1 = Math.min(s - 1, Math.ceil(x1 + R)), by1 = Math.min(s - 1, Math.ceil(y1 + R));
  const invR2 = 1 / (R * R);
  for (let y = by0; y <= by1; y++) {
    const cy = y + 0.5;
    const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    const dy2 = dy * dy * invR2;
    if (dy2 >= 1) continue;
    const row = y * s;
    for (let x = bx0; x <= bx1; x++) {
      const cx = x + 0.5;
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      const t2 = dx * dx * invR2 + dy2;
      if (t2 >= 1) continue;
      let k: number;
      if (shape === KernelShape.Plateau) {
        k = 1.2 * (1 - t2);
        if (k > 1) k = 1;
      } else {
        const u = 1 - t2;
        k = u * u;
      }
      F[row + x] += amount * k;
    }
  }
}

/** Frame-count aware exponential smoothing factor: 1 − (1 − α)^days. */
export function smoothFactor(alphaPerDay: number, days: number): number {
  if (days <= 0) return 0;
  return 1 - Math.pow(1 - alphaPerDay, days);
}
