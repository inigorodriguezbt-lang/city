// Node check (bundle with rolldown, run with node): builds every chunk of the
// sandbox world and verifies that the rendered carriageway matches the height
// model vehicles use (RoadHeightField ≡ patched game.roadSurface.heightAt) at
// lane centers, junction interiors, bridge decks and ramps, and that the
// surface is continuous across cell borders (no steps / gaps).
import { CELL } from '../../src/core/constants';
import { ChunkGrid } from '../../src/core/chunks';
import { DIR_BIT, RoadType } from '../../src/core/types';
import { RoadSurface } from '../../src/world/roadHeight';
import { ChunkBuilder } from '../../src/render/roads/builder';
import { RoadHeightField } from '../../src/render/roads/surface';
import { laneOffsets } from '../../src/render/roads/profiles';
import { buildSandboxWorld, SIZE } from './world';

const { world } = buildSandboxWorld('noon');
const surface = new RoadSurface(world);
const hf = new RoadHeightField(world, surface);
const builder = new ChunkBuilder(world, hf);
const grid = new ChunkGrid(SIZE);

// up-facing triangles binned per 1 m² for point queries
const BIN = 1;
const NB = SIZE * CELL;
const bins = new Map<number, number[]>();
const tris: number[] = [];
for (let key = 0; key < grid.chunksPerSide ** 2; key++) {
  const res = builder.build(grid.rect(key), 0);
  const g = res.geometry;
  if (!g) continue;
  const p = g.getAttribute('position').array as Float32Array;
  const idx = g.index!.array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const ny = uz * vx - ux * vz;
    const nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (nl < 1e-9 || ny / nl < 0.5) continue; // up-facing surfaces only
    const t = tris.length / 9;
    tris.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
    const x0 = Math.floor(Math.min(p[a], p[b], p[c]) / BIN), x1 = Math.floor(Math.max(p[a], p[b], p[c]) / BIN);
    const z0 = Math.floor(Math.min(p[a + 2], p[b + 2], p[c + 2]) / BIN), z1 = Math.floor(Math.max(p[a + 2], p[b + 2], p[c + 2]) / BIN);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const k = z * NB + x;
        let l = bins.get(k);
        if (!l) bins.set(k, (l = []));
        l.push(t);
      }
  }
}

/** highest rendered up-facing surface at (x, z), or NaN */
function renderedAt(x: number, z: number): number {
  const l = bins.get(Math.floor(z / BIN) * NB + Math.floor(x / BIN));
  if (!l) return NaN;
  let best = NaN;
  for (const t of l) {
    const o = t * 9;
    const ax = tris[o], az = tris[o + 2], bx = tris[o + 3], bz = tris[o + 5], cx = tris[o + 6], cz = tris[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const y = w0 * tris[o + 1] + w1 * tris[o + 4] + w2 * tris[o + 7];
    if (!(y <= best)) best = y;
  }
  return best;
}

interface Stat { n: number; max: number; sum: number; worst: string; missing: number }
const stat = (): Stat => ({ n: 0, max: 0, sum: 0, worst: '', missing: 0 });
const stats: Record<string, Stat> = { plain: stat(), bridge: stat(), ramp: stat(), junction: stat() };
const check = (kind: string, x: number, z: number, label: string) => {
  const r = renderedAt(x, z);
  const s = stats[kind];
  if (Number.isNaN(r)) {
    s.missing++;
    if (s.missing < 4) console.log(`  missing surface ${kind} ${label} at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    return;
  }
  const e = Math.abs(r - hf.heightAt(x, z));
  s.n++;
  s.sum += e;
  if (e > s.max) {
    s.max = e;
    s.worst = `${label} at (${x.toFixed(2)}, ${z.toFixed(2)}): rendered ${r.toFixed(3)} model ${hf.heightAt(x, z).toFixed(3)}`;
  }
};

const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    const t = world.roadAt(x, y);
    if (t === RoadType.None || t === RoadType.Rail || t === RoadType.Pedestrian) continue;
    // geometric connectivity as rendered (e.g. a boulevard passing a pedestrian street stays straight)
    const m = builder.gmask(x, y);
    const ox = x * CELL, oz = y * CELL;
    const kind = popcount(m) >= 3 ? 'junction' : world.isBridge(x, y) ? 'bridge' : hf.isRaised(x, y) ? 'ramp' : 'plain';
    const label = `${RoadType[t]} (${x},${y}) mask ${m}`;
    if (m === (DIR_BIT[0] | DIR_BIT[2]) || m === (DIR_BIT[1] | DIR_BIT[3])) {
      const ns = m === (DIR_BIT[0] | DIR_BIT[2]);
      for (const lo of laneOffsets(t))
        for (const side of [-1, 1])
          for (let k = 0; k <= 16; k++) {
            const along = Math.min(15.99, Math.max(0.01, k));
            const lat = 8 + side * lo;
            check(kind, ns ? ox + lat : ox + along, ns ? oz + along : oz + lat, label);
          }
    } else if (popcount(m) >= 3) {
      for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) check(kind, ox + 5 + i * 1.5, oz + 5 + j * 1.5, label);
    }
  }
console.log('rendered carriageway vs RoadHeightField (m):');
for (const [k, s] of Object.entries(stats)) console.log(`  ${k.padEnd(9)} samples ${String(s.n).padStart(5)}  max ${s.max.toFixed(4)}  mean ${(s.sum / Math.max(1, s.n)).toFixed(4)}  missing ${s.missing}${s.max > 0.01 ? '\n    worst: ' + s.worst : ''}`);

// continuity of the model across cell borders along every connected road edge
let maxStep = 0, stepAt = '';
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    if (!world.roadAt(x, y)) continue;
    const m = world.roadMask(x, y);
    if (m & DIR_BIT[1] && x + 1 < SIZE) {
      const ex = (x + 1) * CELL;
      for (let k = 4; k <= 12; k += 2) {
        const z = y * CELL + k;
        const d = Math.abs(hf.cellSurface(x, y, ex, z) - hf.cellSurface(x + 1, y, ex, z));
        if (d > maxStep) { maxStep = d; stepAt = `E edge of (${x},${y})`; }
      }
    }
    if (m & DIR_BIT[2] && y + 1 < SIZE) {
      const ez = (y + 1) * CELL;
      for (let k = 4; k <= 12; k += 2) {
        const xx = x * CELL + k;
        const d = Math.abs(hf.cellSurface(x, y, xx, ez) - hf.cellSurface(x, y + 1, xx, ez));
        if (d > maxStep) { maxStep = d; stepAt = `S edge of (${x},${y})`; }
      }
    }
  }
console.log(`max height step across connected cell borders: ${maxStep.toFixed(4)} m ${stepAt}`);
// steepest drivable grade of the model along bridges / ramps
let maxGrade = 0, gradeAt = '';
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    if (!world.roadAt(x, y) || !hf.isRaised(x, y)) continue;
    for (let k = 0; k < 16; k++) {
      const cx = x * CELL + 8, cz = y * CELL + 8;
      const gx = Math.abs(hf.heightAt(x * CELL + k + 1, cz) - hf.heightAt(x * CELL + k, cz));
      const gz = Math.abs(hf.heightAt(cx, y * CELL + k + 1) - hf.heightAt(cx, y * CELL + k));
      const g = Math.max(world.roadMask(x, y) & 10 ? gx : 0, world.roadMask(x, y) & 5 ? gz : 0);
      if (g > maxGrade) { maxGrade = g; gradeAt = `(${x},${y})`; }
    }
  }
console.log(`steepest grade on bridges / ramps: ${(maxGrade * 100).toFixed(1)} % at ${gradeAt}`);
