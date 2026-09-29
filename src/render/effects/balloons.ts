// Hot-air balloon parade + the runaway dinosaur parade balloon.
// Balloon envelopes are lathe meshes with crisp gore patterns computed in the
// fragment shader (stripes, chevrons, spirals, bands) on a standard PBR
// material; burners flare now and then and light the envelope from inside.
import * as THREE from 'three';
import { disposeTree } from './fxShared';

const PALETTES: [number, number, number][] = [
  [0xd7263d, 0xf6c33b, 0x1b1b3a],
  [0x2e86ab, 0xf5f5f5, 0xf18f01],
  [0x6a4c93, 0xffca3a, 0x8ac926],
  [0xff595e, 0xffffff, 0x1982c4],
  [0x0f9d58, 0xf4b400, 0xdb4437],
  [0xf72585, 0x4cc9f0, 0x3a0ca3],
  [0xffb703, 0x023047, 0xfb8500],
  [0xe63946, 0xf1faee, 0x457b9d],
  [0x3d9970, 0xfff3b0, 0xe09f3e],
  [0x9d0208, 0xffba08, 0x370617],
];

function envelopeGeometry(): THREE.LatheGeometry {
  const prof: [number, number][] = [
    [1.9, 0], [2.6, 1.8], [4.2, 3.6], [5.9, 5.6], [7.5, 8], [8.8, 10.8], [9.5, 13.6], [9.6, 15.4], [9.2, 17.4], [8.1, 19.4], [6.2, 21.1], [3.6, 22.3], [0.01, 22.8],
  ];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32);
}

function balloonMaterial(pal: [number, number, number], pattern: number): { mat: THREE.MeshStandardMaterial; burn: { value: number } } {
  const burn = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '' };
  const cA = new THREE.Color(pal[0]), cB = new THREE.Color(pal[1]), cC = new THREE.Color(pal[2]);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uColA = { value: cA };
    sh.uniforms.uColB = { value: cB };
    sh.uniforms.uColC = { value: cC };
    sh.uniforms.uBurn = burn;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC; uniform float uBurn;
vec3 balloonColor(vec2 uv) {
  float gores = 16.0;
  float g = uv.x * gores;
  float gi = floor(g);
  float gf = fract(g);
  vec3 c;
  ${pattern === 0 ? 'c = mod(gi, 2.0) < 0.5 ? uColA : uColB; if (uv.y > 0.46 && uv.y < 0.56) c = uColC;' : ''}
  ${pattern === 1 ? 'float z = abs(fract(uv.x * 8.0) - 0.5) * 0.5; float k = fract((uv.y + z) * 5.0); c = k < 0.34 ? uColA : k < 0.67 ? uColB : uColC;' : ''}
  ${pattern === 2 ? 'float s = fract(uv.x * 3.0 + uv.y * 2.2); c = s < 0.5 ? uColA : uColB; if (uv.y > 0.86) c = uColC;' : ''}
  ${pattern === 3 ? 'float b = floor(uv.y * 7.0); c = mod(b, 3.0) < 0.5 ? uColA : mod(b, 3.0) < 1.5 ? uColB : uColC; if (mod(gi, 4.0) < 0.5) c = mix(c, vec3(1.0), 0.8);' : ''}
  // seams between gores
  c *= 0.82 + 0.18 * smoothstep(0.0, 0.04, gf) * smoothstep(1.0, 0.96, gf);
  // skirt / scoop near the mouth
  if (uv.y < 0.1) c = uColC * 0.6;
  return c;
}`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= balloonColor(vUv);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += balloonColor(vUv) * uBurn * (1.6 - vUv.y) * 1.4;`,
      );
  };
  mat.customProgramCacheKey = () => `balloon-${pattern}`;
  return { mat, burn };
}

interface Balloon {
  group: THREE.Group;
  burn: { value: number };
  /** offset from parade centre (m), altitude, phase, drift speed factor */
  ox: number;
  oz: number;
  alt: number;
  phase: number;
  speed: number;
  burner: number;
  burnerTimer: number;
}

export class BalloonParade {
  readonly group = new THREE.Group();
  readonly balloons: Balloon[] = [];
  private drift = new THREE.Vector2();
  /** burner flame positions for the particle system (world), refreshed per frame */
  readonly flames: THREE.Vector3[] = [];

  constructor(count: number, seed: number) {
    this.group.name = 'effects.balloons';
    const env = envelopeGeometry();
    const basket = new THREE.BoxGeometry(1.8, 1.3, 1.8);
    basket.translate(0, -4.6, 0);
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.9 });
    const ropeMat = new THREE.LineBasicMaterial({ color: 0x2a2520 });
    const ropePts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ropePts.push(Math.cos(a) * 0.8, -3.95, Math.sin(a) * 0.8, Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9);
    }
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ropePts, 3));
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const { mat, burn } = balloonMaterial(PALETTES[(i + (seed % PALETTES.length)) % PALETTES.length], Math.floor(rnd() * 4));
      const e = new THREE.Mesh(env, mat);
      e.castShadow = true;
      g.add(e);
      const b = new THREE.Mesh(basket, basketMat);
      b.castShadow = true;
      g.add(b);
      g.add(new THREE.LineSegments(ropeGeo, ropeMat));
      const sc = 0.9 + rnd() * 0.3;
      g.scale.setScalar(sc);
      this.group.add(g);
      const a = rnd() * Math.PI * 2, d = 40 + Math.sqrt(rnd()) * 420;
      this.balloons.push({ group: g, burn, ox: Math.cos(a) * d, oz: Math.sin(a) * d, alt: 110 + rnd() * 260, phase: rnd() * 100, speed: 0.7 + rnd() * 0.6, burner: 0, burnerTimer: rnd() * 6 });
      this.flames.push(new THREE.Vector3());
    }
  }

  /** cx, cz parade centre; ground(x,z) terrain height; wind (m/s, xz); t real time; dt real dt */
  update(cx: number, cz: number, ground: (x: number, z: number) => number, windX: number, windZ: number, t: number, dt: number): void {
    // the whole parade drifts slowly downwind, wrapping inside a 1.6 km window
    this.drift.x = (this.drift.x + windX * 0.5 * dt + 800) % 1600 - 800;
    this.drift.y = (this.drift.y + windZ * 0.5 * dt + 800) % 1600 - 800;
    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      const x = cx + b.ox + this.drift.x * b.speed + Math.sin(t * 0.05 + b.phase) * 25;
      const z = cz + b.oz + this.drift.y * b.speed + Math.cos(t * 0.04 + b.phase) * 25;
      // burners fire in bursts; balloons rise a little while burning and sink between burns
      b.burnerTimer -= dt;
      if (b.burnerTimer <= 0) {
        b.burner = b.burner > 0 ? 0 : 1;
        b.burnerTimer = b.burner ? 0.8 + Math.random() * 1.6 : 3 + Math.random() * 7;
      }
      b.burn.value += ((b.burner ? 1 : 0) - b.burn.value) * Math.min(1, dt * 6);
      const y = Math.max(ground(x, z) + 40, b.alt + Math.sin(t * 0.13 + b.phase) * 9);
      b.group.position.set(x, y, z);
      b.group.rotation.set(Math.sin(t * 0.3 + b.phase) * 0.03, t * 0.02 + b.phase, Math.cos(t * 0.27 + b.phase) * 0.03);
      this.flames[i].set(x, y - 3.2 * b.group.scale.y, z);
    }
  }

  dispose(): void {
    disposeTree(this.group);
  }
}

// ── the lost dinosaur balloon ───────────────────────────────────────────────
function taperedTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, r0: number, r1: number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, p);
    const r = r0 + (r1 - r0) * Math.pow(u, 1.2);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(p.x + r * (c * N.x + s * B.x), p.y + r * (c * N.y + s * B.y), p.z + r * (c * N.z + s * B.z));
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function colorize(g: THREE.BufferGeometry, top: THREE.Color, belly: THREE.Color, spot: THREE.Color, bellyY: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    c.copy(top).lerp(belly, THREE.MathUtils.smoothstep(bellyY - y, -1.5, 2.5));
    const sp = Math.sin(x * 0.55 + 1.3) * Math.sin(z * 0.8 + 0.4) * Math.sin(y * 0.6 + 2.2);
    if (sp > 0.45 && y > bellyY) c.lerp(spot, 0.75);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

export class DinoBalloon {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly tether: THREE.Line;
  private readonly tetherPos: Float32Array;

  constructor() {
    this.group.name = 'effects.dino';
    const top = new THREE.Color(0x4fae3c), belly = new THREE.Color(0xd8e88a), spot = new THREE.Color(0x2f7a2a);
    const parts: THREE.BufferGeometry[] = [];
    const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => {
      const g = new THREE.SphereGeometry(1, 28, 18);
      g.scale(rx, ry, rz);
      g.translate(x, y, z);
      return g;
    };
    // body along +x (head forward)
    parts.push(colorize(ell(15, 9.5, 8.5, 0, 0, 0), top, belly, spot, -3));
    // neck rising forward to the head
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(10, 3, 0), new THREE.Vector3(18, 10, 0), new THREE.Vector3(22, 20, 0), new THREE.Vector3(24.5, 28, 0)]);
    parts.push(colorize(taperedTube(neck, 24, 16, 5.6, 2.4), top, belly, spot, -999));
    parts.push(colorize(ell(4.6, 2.8, 2.9, 27, 29.5, 0), top, belly, spot, 28.2));
    // tail sweeping back and slightly up
    const tail = new THREE.CatmullRomCurve3([new THREE.Vector3(-11, 1, 0), new THREE.Vector3(-20, 2, 1), new THREE.Vector3(-29, 5, 3), new THREE.Vector3(-37, 9, 6)]);
    parts.push(colorize(taperedTube(tail, 24, 16, 5.2, 0.5), top, belly, spot, -999));
    // four stumpy legs
    for (const [x, z] of [[8, 5], [8, -5], [-7, 5], [-7, -5]]) {
      const leg = new THREE.CylinderGeometry(2.6, 2.3, 10, 16);
      leg.translate(x, -9, z);
      parts.push(colorize(leg, top, belly, spot, -999));
      parts.push(colorize(ell(2.6, 1.2, 2.6, x, -14, z), belly, belly, belly, -999));
    }
    // eyes
    for (const z of [2.6, -2.6]) {
      parts.push(colorize(ell(0.9, 0.9, 0.5, 29, 30.8, z), new THREE.Color(0xffffff), new THREE.Color(0xffffff), new THREE.Color(0xffffff), -999));
      parts.push(colorize(ell(0.5, 0.55, 0.3, 29.5, 30.8, z * 1.12), new THREE.Color(0x111111), new THREE.Color(0x111111), new THREE.Color(0x111111), -999));
    }
    const geo = mergeGeos(parts);
    for (const p of parts) p.dispose();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0 });
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;
    this.group.add(this.body);
    // dangling tether rope
    this.tetherPos = new Float32Array(16 * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tetherPos, 3));
    this.tether = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0x2a2520 }));
    this.tether.frustumCulled = false;
    this.group.add(this.tether);
  }

  update(x: number, y: number, z: number, heading: number, t: number): void {
    const g = this.group;
    g.position.set(x, y, z);
    g.rotation.set(Math.sin(t * 0.21) * 0.08, heading + Math.sin(t * 0.05) * 0.4, Math.sin(t * 0.17 + 1) * 0.1, 'YXZ');
    // the tether hangs from the belly and swings
    const p = this.tetherPos;
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      p[i * 3] = Math.sin(t * 0.8 + u * 2) * 3 * u * u;
      p[i * 3 + 1] = -9 - u * 45;
      p[i * 3 + 2] = Math.cos(t * 0.6 + u * 1.5) * 3 * u * u;
    }
    (this.tether.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
