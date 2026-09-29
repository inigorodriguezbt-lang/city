// Problem icons: badge billboards floating above buildings that show their
// most important problems (Problem bitmask). An emoji atlas is painted once
// on a canvas; icons are one instanced draw, gently bobbing, sized to stay
// readable at any zoom, and drawn over the city like map markers.
import * as THREE from 'three';
import { Problem } from '../../../core/types';

interface IconDef {
  bit: Problem;
  emoji: string;
  /** badge rim colour */
  rim: string;
  label: string;
}

/** Priority order: first match is the primary icon. */
export const PROBLEM_ICONS: IconDef[] = [
  { bit: Problem.Fire, emoji: '🔥', rim: '#ff3b1f', label: 'On fire' },
  { bit: Problem.Flooded, emoji: '🌊', rim: '#1f7bff', label: 'Flooded' },
  { bit: Problem.Abandoned, emoji: '🏚️', rim: '#6b6b6b', label: 'Abandoned' },
  { bit: Problem.NoPower, emoji: '⚡', rim: '#ffb800', label: 'No power' },
  { bit: Problem.NoWater, emoji: '💧', rim: '#2a9dff', label: 'No water' },
  { bit: Problem.NoRoad, emoji: '🚧', rim: '#ff8a00', label: 'No road access' },
  { bit: Problem.NoSewage, emoji: '🚽', rim: '#8a6a3a', label: 'No sewage' },
  { bit: Problem.Dead, emoji: '💀', rim: '#7a4aa8', label: 'Dead not collected' },
  { bit: Problem.Sick, emoji: '🤒', rim: '#e0405a', label: 'Sick residents' },
  { bit: Problem.Garbage, emoji: '🗑️', rim: '#6a8a3a', label: 'Garbage piling up' },
  { bit: Problem.Crime, emoji: '🦹', rim: '#3a4aa8', label: 'High crime' },
  { bit: Problem.NoWorkers, emoji: '👷', rim: '#e08a1a', label: 'Not enough workers' },
  { bit: Problem.NoCustomers, emoji: '🛍️', rim: '#d04ab0', label: 'Not enough customers' },
  { bit: Problem.NoGoods, emoji: '📦', rim: '#b0803a', label: 'Not enough goods' },
  { bit: Problem.NoEducated, emoji: '🎓', rim: '#3a6ad0', label: 'No educated workers' },
  { bit: Problem.Pollution, emoji: '☣️', rim: '#8aa01a', label: 'Polluted' },
  { bit: Problem.Noise, emoji: '🔊', rim: '#8a8aa0', label: 'Noise' },
  { bit: Problem.Traffic, emoji: '🚗', rim: '#d0402a', label: 'Traffic jams' },
  { bit: Problem.LowHappiness, emoji: '😠', rim: '#c05a2a', label: 'Unhappy' },
  { bit: Problem.HighRent, emoji: '💸', rim: '#2a9a5a', label: 'Rent too high' },
];

const COLS = 8;
const CELL = 128;

let atlas: THREE.CanvasTexture | null = null;

function buildAtlas(): THREE.CanvasTexture {
  const rows = Math.ceil(PROBLEM_ICONS.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL;
  cv.height = rows * CELL;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  PROBLEM_ICONS.forEach((ic, i) => {
    const cx = (i % COLS) * CELL + CELL / 2, cy = Math.floor(i / COLS) * CELL + CELL / 2 - 6;
    const r = CELL * 0.36;
    // pin tail
    g.fillStyle = ic.rim;
    g.beginPath();
    g.moveTo(cx - r * 0.42, cy + r * 0.78);
    g.lineTo(cx, cy + r * 1.42);
    g.lineTo(cx + r * 0.42, cy + r * 0.78);
    g.closePath();
    g.fill();
    // soft shadow
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 3;
    g.fillStyle = ic.rim;
    g.beginPath();
    g.arc(cx, cy, r + 6, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // white face with a subtle top highlight
    const grad = g.createLinearGradient(0, cy - r, 0, cy + r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#e6e9ef');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.font = `${Math.round(r * 1.18)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ic.emoji, cx, cy + r * 0.06);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** Up to `max` atlas indices for a problem mask, most important first. */
export function topProblems(mask: number, max = 2): number[] {
  const out: number[] = [];
  if (!mask) return out;
  for (let i = 0; i < PROBLEM_ICONS.length && out.length < max; i++) if (mask & PROBLEM_ICONS[i].bit) out.push(i);
  return out;
}

const VERT = /* glsl */ `
attribute vec4 iPos;   // xyz, phase
attribute vec3 iIcon;  // atlas index, scale, horizontal offset (in icon sizes)
uniform float uTime;
uniform float uViewH;
uniform vec2 uGrid;
varying vec2 vUv;
varying float vFade;
#include <common>
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float dist = max(1.0, -mv.z);
  // target ~34 px (primary) on screen, clamped in world units
  float px = 34.0 * iIcon.y;
  float world = dist * px * 2.0 / (projectionMatrix[1][1] * uViewH);
  float size = clamp(world, 2.5 * iIcon.y, 60.0);
  float bob = sin(uTime * 2.2 + iPos.w * 6.2831) * 0.12 * size;
  mv.y += bob + size * 0.5;
  mv.x += iIcon.z * size;
  mv.xy += position.xy * size * 0.5;
  gl_Position = projectionMatrix * mv;
  float col = mod(iIcon.x, uGrid.x), row = floor(iIcon.x / uGrid.x);
  vUv = (vec2(col, uGrid.y - 1.0 - row) + (position.xy * 0.5 + 0.5)) / uGrid;
  vFade = 1.0 - smoothstep(1300.0, 1500.0, dist);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uExpComp;
varying vec2 vUv;
varying float vFade;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(c.rgb * uExpComp, c.a * vFade);
  #include <colorspace_fragment>
}
`;

export interface IconInstance {
  x: number;
  y: number;
  z: number;
  icon: number;
  phase: number;
  /** 1 = primary, smaller for secondary icons */
  scale: number;
  /** horizontal screen offset in icon sizes (secondary icons sit beside the primary) */
  offset?: number;
}

export class ProblemIcons {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private cap = 0;
  private pos!: THREE.InstancedBufferAttribute;
  private icn!: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;

  constructor() {
    atlas ??= buildAtlas();
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.ensure(64);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uTime: { value: 0 },
        uViewH: { value: 800 },
        uExpComp: { value: 1 },
        uGrid: { value: new THREE.Vector2(COLS, Math.ceil(PROBLEM_ICONS.length / COLS)) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mat.name = 'bld:problem-icons';
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.name = 'bld:problem-icons';
  }

  private ensure(n: number): void {
    if (n <= this.cap) return;
    let cap = Math.max(64, this.cap);
    while (cap < n) cap *= 2;
    this.cap = cap;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.icn = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.icn.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iIcon', this.icn);
  }

  /** Replace the displayed icons. */
  set(list: IconInstance[]): void {
    this.ensure(list.length);
    const P = this.pos.array as Float32Array, I = this.icn.array as Float32Array;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      P[i * 4] = it.x; P[i * 4 + 1] = it.y; P[i * 4 + 2] = it.z; P[i * 4 + 3] = it.phase;
      I[i * 3] = it.icon; I[i * 3 + 1] = it.scale; I[i * 3 + 2] = it.offset ?? 0;
    }
    this.pos.clearUpdateRanges();
    this.icn.clearUpdateRanges();
    this.pos.addUpdateRange(0, list.length * 4);
    this.icn.addUpdateRange(0, list.length * 3);
    this.pos.needsUpdate = true;
    this.icn.needsUpdate = true;
    this.geo.instanceCount = list.length;
  }

  /** expComp = 1 / scene exposure (icons keep their look through eye adaptation) */
  update(time: number, viewH: number, expComp = 1): void {
    this.mat.uniforms.uTime.value = time % 10000;
    this.mat.uniforms.uViewH.value = viewH;
    this.mat.uniforms.uExpComp.value = expComp;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
