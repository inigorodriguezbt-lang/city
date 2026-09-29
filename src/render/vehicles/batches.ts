// Instanced batches shared by the vehicle, transit and pedestrian renderers:
// growable InstancedMesh wrappers with per-instance color + state (aState) and
// additive instanced sprites. Update ranges cover only the written instances.
import * as THREE from 'three';

/** sRGB byte → linear */
export const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export class Batch {
  mesh: THREE.InstancedMesh;
  cap = 0;
  count = 0;
  private geo: THREE.BufferGeometry;
  private state!: THREE.InstancedBufferAttribute;

  constructor(private src: THREE.BufferGeometry, private material: THREE.Material, private shadow: boolean, private parent: THREE.Object3D, cap = 16) {
    this.geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'aMat']) this.geo.setAttribute(name, src.getAttribute(name));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mesh = this.make(cap);
  }

  private make(cap: number): THREE.InstancedMesh {
    this.cap = cap;
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.state.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aState', this.state);
    const m = new THREE.InstancedMesh(this.geo, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = this.shadow;
    m.receiveShadow = true;
    m.count = 0;
    m.visible = false;
    this.parent.add(m);
    return m;
  }

  /** make room for at least n instances (keeps written data) */
  ensure(n: number): void {
    if (n <= this.cap) return;
    let cap = this.cap;
    while (cap < n) cap *= 2;
    const oldM = this.mesh, oldS = this.state;
    const mat = oldM.instanceMatrix.array as Float32Array, col = oldM.instanceColor!.array as Float32Array, st = oldS.array as Float32Array;
    this.mesh = this.make(cap);
    (this.mesh.instanceMatrix.array as Float32Array).set(mat);
    (this.mesh.instanceColor!.array as Float32Array).set(col);
    (this.state.array as Float32Array).set(st);
    oldM.removeFromParent();
    oldM.dispose();
  }

  write(x: number, y: number, z: number, yaw: number, pitch: number, scale: number, color: number, brake: number, siren: number, lights: number, phase: number): void {
    const k = this.count;
    if (k >= this.cap) this.ensure(k + 1);
    this.count++;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = k * 16;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // columns: right, up, forward (local X, Y, Z), position
    m[o] = cy * scale;
    m[o + 1] = 0;
    m[o + 2] = -sy * scale;
    m[o + 3] = 0;
    m[o + 4] = -sp * sy * scale;
    m[o + 5] = cp * scale;
    m[o + 6] = -sp * cy * scale;
    m[o + 7] = 0;
    m[o + 8] = sy * cp * scale;
    m[o + 9] = sp * scale;
    m[o + 10] = cy * cp * scale;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[k * 3] = LIN[(color >> 16) & 255];
    c[k * 3 + 1] = LIN[(color >> 8) & 255];
    c[k * 3 + 2] = LIN[color & 255];
    const s = this.state.array as Float32Array;
    s[k * 4] = brake;
    s[k * 4 + 1] = siren;
    s[k * 4 + 2] = lights;
    s[k * 4 + 3] = phase;
  }

  commit(): void {
    const m = this.mesh;
    const n = this.count;
    m.count = n;
    m.visible = n > 0;
    if (!n) return;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, n * 16);
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.clearUpdateRanges();
    m.instanceColor!.addUpdateRange(0, n * 3);
    m.instanceColor!.needsUpdate = true;
    this.state.clearUpdateRanges();
    this.state.addUpdateRange(0, n * 4);
    this.state.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

/** instanced additive sprites: aGlow (xyz, size) + aCol (rgb, intensity) */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  cap = 0;
  count = 0;
  private geo = new THREE.InstancedBufferGeometry();
  private a!: THREE.InstancedBufferAttribute;
  private b!: THREE.InstancedBufferAttribute;

  constructor(material: THREE.Material, private names: [string, string], quad: THREE.BufferGeometry, cap = 256) {
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.alloc(cap);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  private alloc(cap: number): void {
    const oa = this.a, ob = this.b;
    this.cap = cap;
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.a.setUsage(THREE.DynamicDrawUsage);
    this.b.setUsage(THREE.DynamicDrawUsage);
    if (oa) (this.a.array as Float32Array).set(oa.array as Float32Array);
    if (ob) (this.b.array as Float32Array).set(ob.array as Float32Array);
    this.geo.setAttribute(this.names[0], this.a);
    this.geo.setAttribute(this.names[1], this.b);
  }

  push(x: number, y: number, z: number, w: number, r: number, g: number, b: number, i: number): void {
    if (this.count >= this.cap) this.alloc(this.cap * 2);
    const k = this.count++;
    const a = this.a.array as Float32Array, c = this.b.array as Float32Array;
    a[k * 4] = x;
    a[k * 4 + 1] = y;
    a[k * 4 + 2] = z;
    a[k * 4 + 3] = w;
    c[k * 4] = r;
    c[k * 4 + 1] = g;
    c[k * 4 + 2] = b;
    c[k * 4 + 3] = i;
  }

  commit(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    this.a.clearUpdateRanges();
    this.a.addUpdateRange(0, this.count * 4);
    this.a.needsUpdate = true;
    this.b.clearUpdateRanges();
    this.b.addUpdateRange(0, this.count * 4);
    this.b.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}
