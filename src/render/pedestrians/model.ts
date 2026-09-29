// Tiny low-poly person (≈1.75 m): legs, torso, arms, hands, head, hair and a
// folded umbrella that opens in the rain. Attributes: aPart (animation group:
// 0 body, 1/2 left/right leg, 3/4 left/right arm, 5 umbrella) and aMatP (color
// slot: 0 shirt, 1 pants, 2 skin, 3 hair, 4 shoes, 5 umbrella, 6 bag).
import * as THREE from 'three';

export const HIP_Y = 0.9;
export const SHOULDER_Y = 1.42;

class PB {
  pos: number[] = [];
  nrm: number[] = [];
  part: number[] = [];
  mat: number[] = [];
  private face(a: number[], b: number[], c: number[], d: number[], n: number[], part: number, mat: number): void {
    for (const v of [a, b, c, a, c, d]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.part.push(part);
      this.mat.push(mat);
    }
  }
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, part: number, mat: number, bottom = false, topInset = 0): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const X0 = x0 + topInset, X1 = x1 - topInset;
    this.face([x0, y0, z1], [x1, y0, z1], [X1, y1, z1], [X0, y1, z1], [0, 0, 1], part, mat);
    this.face([x1, y0, z0], [x0, y0, z0], [X0, y1, z0], [X1, y1, z0], [0, 0, -1], part, mat);
    this.face([x1, y0, z1], [x1, y0, z0], [X1, y1, z0], [X1, y1, z1], [1, 0, 0], part, mat);
    this.face([x0, y0, z0], [x0, y0, z1], [X0, y1, z1], [X0, y1, z0], [-1, 0, 0], part, mat);
    this.face([X0, y1, z1], [X1, y1, z1], [X1, y1, z0], [X0, y1, z0], [0, 1, 0], part, mat);
    if (bottom) this.face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], part, mat);
  }
  cone(cx: number, y0: number, cz: number, r: number, h: number, segs: number, part: number, mat: number): void {
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], ap = [cx, y0 + h, cz];
      const am = (a0 + a1) / 2;
      const n = new THREE.Vector3(Math.cos(am) * h, r, Math.sin(am) * h).normalize();
      for (const v of [p0, ap, p1]) {
        this.pos.push(v[0], v[1], v[2]);
        this.nrm.push(n.x, n.y, n.z);
        this.part.push(part);
        this.mat.push(mat);
      }
      // underside
      for (const v of [p0, p1, [cx, y0 + h * 0.3, cz]]) {
        this.pos.push(v[0], v[1], v[2]);
        this.nrm.push(0, -1, 0);
        this.part.push(part);
        this.mat.push(mat);
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aMatP', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.pos.length).fill(1), 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function personGeometry(): THREE.BufferGeometry {
  const b = new PB();
  // legs + shoes
  for (const [s, part] of [[1, 1], [-1, 2]] as const) {
    b.box(s * 0.08, 0.08, 0, 0.12, HIP_Y - 0.08, 0.15, part, 1);
    b.box(s * 0.08, 0.0, 0.03, 0.12, 0.08, 0.23, part, 4, true);
  }
  // torso (shirt), hips (pants)
  b.box(0, HIP_Y - 0.08, 0, 0.3, 0.14, 0.19, 0, 1);
  b.box(0, HIP_Y + 0.04, 0, 0.32, 0.5, 0.2, 0, 0, false, 0.015);
  // arms + hands
  for (const [s, part] of [[1, 3], [-1, 4]] as const) {
    b.box(s * 0.205, SHOULDER_Y - 0.52, 0, 0.08, 0.52, 0.09, part, 0);
    b.box(s * 0.205, SHOULDER_Y - 0.64, 0, 0.07, 0.12, 0.08, part, 2);
  }
  // neck, head, hair
  b.box(0, SHOULDER_Y + 0.08, 0, 0.1, 0.06, 0.1, 0, 2);
  b.box(0, SHOULDER_Y + 0.12, 0.01, 0.2, 0.24, 0.22, 0, 2);
  b.box(0, SHOULDER_Y + 0.33, -0.01, 0.22, 0.07, 0.25, 0, 3);
  b.box(0, SHOULDER_Y + 0.18, -0.1, 0.22, 0.17, 0.06, 0, 3);
  // shoulder bag
  b.box(-0.2, HIP_Y - 0.05, 0.02, 0.06, 0.22, 0.25, 0, 6);
  // umbrella (shown only while it rains): stick + canopy held by the right hand
  b.box(0.205, SHOULDER_Y - 0.62, 0.05, 0.03, 1.2, 0.03, 5, 4);
  b.cone(0.18, SHOULDER_Y + 0.52, 0.02, 0.55, 0.22, 8, 5, 5);
  return b.build();
}
