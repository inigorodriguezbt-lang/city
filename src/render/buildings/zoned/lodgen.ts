// LOD mass extraction for arbitrary models (service / landmark generators
// that do not record masses): rasterize the triangles of non-ground parts
// into a coarse height grid, then greedily merge cells of similar height
// into a handful of boxes coloured with the average wall / roof colour.
import * as THREE from 'three';
import type { MatKey, ModelPart } from '../types';
import { LodFacade } from './constants';
import { type LodMass, lodFacadeOf } from './fab';

const GROUNDISH = new Set<MatKey>(['grass', 'paving', 'asphalt', 'water', 'sand', 'dirt', 'crop', 'concrete']);

export function massesFromParts(parts: ModelPart[], width: number, depth: number, maxBoxes = 10): LodMass[] {
  const cs = Math.max(2, Math.min(width, depth) / 10);
  const nx = Math.max(1, Math.ceil(width / cs)), nz = Math.max(1, Math.ceil(depth / cs));
  const hgt = new Float32Array(nx * nz);
  const roof = new Float32Array(nx * nz * 3);
  const wallSum = [0, 0, 0, 0];
  const facVotes = new Map<LodFacade, number>();
  const x0 = -width / 2, z0 = -depth / 2;
  for (const p of parts) {
    const ground = GROUNDISH.has(p.mat);
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = p.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const nrm = p.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const fac = lodFacadeOf(p.mat);
    for (let t = 0; t < pos.count; t += 3) {
      let maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let k = 0; k < 3; k++) {
        const y = pos.getY(t + k), x = pos.getX(t + k), z = pos.getZ(t + k);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      // concrete counts as building mass when it rises well above the lot
      if (ground && (p.mat !== 'concrete' || maxY < 1.5)) continue;
      if (maxY < 0.8) continue;
      const ny = Math.abs(nrm.getY(t));
      const r = col ? col.getX(t) : 0.7, g = col ? col.getY(t) : 0.7, b = col ? col.getZ(t) : 0.7;
      if (ny < 0.5) {
        const area = (maxY - Math.min(pos.getY(t), pos.getY(t + 1), pos.getY(t + 2))) * Math.hypot(maxX - minX, maxZ - minZ);
        wallSum[0] += r * area; wallSum[1] += g * area; wallSum[2] += b * area; wallSum[3] += area;
        if (fac !== LodFacade.None) facVotes.set(fac, (facVotes.get(fac) ?? 0) + area);
      }
      const i0 = Math.max(0, Math.floor((minX - x0) / cs)), i1 = Math.min(nx - 1, Math.floor((maxX - x0) / cs));
      const j0 = Math.max(0, Math.floor((minZ - z0) / cs)), j1 = Math.min(nz - 1, Math.floor((maxZ - z0) / cs));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = j * nx + i;
          if (maxY > hgt[c]) {
            hgt[c] = maxY;
            if (ny >= 0.3) {
              roof[c * 3] = r; roof[c * 3 + 1] = g; roof[c * 3 + 2] = b;
            }
          }
        }
    }
  }
  const wall: [number, number, number] = wallSum[3] > 0 ? [wallSum[0] / wallSum[3], wallSum[1] / wallSum[3], wallSum[2] / wallSum[3]] : [0.6, 0.6, 0.6];
  let fac = LodFacade.None, best = 0;
  for (const [k, v] of facVotes) if (v > best) { best = v; fac = k; }
  // quantize heights, then greedy rectangle merge
  let q = 2;
  let boxes: LodMass[] = [];
  for (let pass = 0; pass < 4; pass++) {
    boxes = [];
    const used = new Uint8Array(nx * nz);
    const qh = (c: number) => Math.round(hgt[c] / q);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (used[c] || hgt[c] < 0.8) continue;
        const h0 = qh(c);
        let w = 1;
        while (i + w < nx && !used[j * nx + i + w] && hgt[j * nx + i + w] >= 0.8 && qh(j * nx + i + w) === h0) w++;
        let d = 1;
        outer: while (j + d < nz) {
          for (let k = 0; k < w; k++) {
            const cc = (j + d) * nx + i + k;
            if (used[cc] || hgt[cc] < 0.8 || qh(cc) !== h0) break outer;
          }
          d++;
        }
        let rs = 0, gs = 0, bs = 0, hs = 0;
        for (let jj = 0; jj < d; jj++)
          for (let ii = 0; ii < w; ii++) {
            const cc = (j + jj) * nx + i + ii;
            used[cc] = 1;
            rs += roof[cc * 3]; gs += roof[cc * 3 + 1]; bs += roof[cc * 3 + 2]; hs = Math.max(hs, hgt[cc]);
          }
        const n = w * d;
        const rc: [number, number, number] = rs + gs + bs > 0 ? [rs / n, gs / n, bs / n] : wall;
        boxes.push({ cx: x0 + (i + w / 2) * cs, cz: z0 + (j + d / 2) * cs, w: w * cs * 0.96, d: d * cs * 0.96, y0: 0, h: Math.max(1, hs * 0.94), rot: 0, wall, roof: rc, fac });
      }
    if (boxes.length <= maxBoxes) break;
    q *= 2.5;
  }
  boxes.sort((a, b) => b.w * b.d * b.h - a.w * a.d * a.h);
  return boxes.slice(0, maxBoxes);
}
