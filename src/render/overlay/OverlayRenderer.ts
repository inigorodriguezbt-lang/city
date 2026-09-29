// Info-view overlays: a heatmap of world.fields[field] draped over the
// terrain (it reuses the terrain LOD meshes, lifted to the true surface height
// in the vertex shader). Colours come from the shared OVERLAYS ramps; the rest
// of the scene is desaturated by the post pass while the drape pre-compensates
// so its own colours stay true. Road-only fields colour just the road cells.
import * as THREE from 'three';
import { CELL } from '../../core/constants';
import { RoadType, type FieldId } from '../../core/types';
import { overlayInfo, type OverlayInfo } from '../../data/overlays';
import type { World } from '../../world/World';
import type { SharedUniforms } from '../sky/SharedUniforms';
import { createRampTexture } from '../textures/procedural';
import type { TerrainRenderer } from '../terrain/TerrainRenderer';

/** desaturation applied to the world while an info view is open */
export const INFO_VIEW_DESAT = 0.55;

export class OverlayRenderer {
  readonly material: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;
  private data: Uint8Array;
  private ramps = new Map<string, THREE.DataTexture>();
  private field: FieldId | null = null;
  private info: OverlayInfo | null = null;
  private strength = 0;
  private refreshTimer = 0;
  private pending = false;

  constructor(readonly world: World, private readonly shared: SharedUniforms, private readonly terrain: TerrainRenderer) {
    const s = world.size;
    this.data = new Uint8Array(s * s * 4);
    this.tex = new THREE.DataTexture(this.data, s, s, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.material = new THREE.ShaderMaterial({
      name: 'OverlayDrape',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uData: { value: this.tex },
        uRamp: { value: null },
        uHTex: { value: terrain.data.hTex },
        uCells: { value: s },
        uRoadsOnly: { value: 0 },
        uAlpha: { value: 0 },
        uDesat: { value: INFO_VIEW_DESAT },
        uBright: { value: 1 },
      }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        uniform highp sampler2D uHTex;
        uniform float uCells;
        varying vec3 vWPos;
        void main() {
          vec3 p = position;
          // snap to the true surface (coarse LOD meshes are biased downward)
          ivec2 v = ivec2(floor(p.xz / ${CELL.toFixed(1)} + 0.5));
          int m = int(uCells);
          if (v.x >= 0 && v.y >= 0 && v.x <= m && v.y <= m) {
            float h = texelFetch(uHTex, v, 0).r;
            if (p.y > h - 2.0) p.y = h;
          }
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          p.y += 0.35 + d * 0.0012;
          vWPos = p;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uData;
        uniform sampler2D uRamp;
        uniform float uCells;
        uniform float uRoadsOnly;
        uniform float uAlpha;
        uniform float uDesat;
        uniform float uBright;
        varying vec3 vWPos;
        void main() {
          vec2 cf = vWPos.xz / ${CELL.toFixed(1)};
          ivec2 cell = clamp(ivec2(floor(cf)), ivec2(0), ivec2(int(uCells) - 1));
          vec4 raw = texelFetch(uData, cell, 0);
          vec4 smoothV = texture2D(uData, cf / uCells);
          float isRoad = raw.g;
          float isWater = raw.b;
          float v = uRoadsOnly > 0.5 ? raw.r : smoothV.r;
          vec3 col = texture2D(uRamp, vec2(clamp(v, 0.0, 1.0), 0.5)).rgb;
          // contour bands and a faint cell grid for readability
          float band = fract(v * 8.0);
          col *= 0.93 + 0.07 * smoothstep(0.0, 0.08, band);
          vec2 g = abs(fract(cf) - 0.5);
          float gw = fwidth(cf.x) * 1.2;
          float grid = smoothstep(0.5 - gw, 0.5, max(g.x, g.y));
          col *= 1.0 - grid * 0.12 * (1.0 - smoothstep(0.08, 0.3, gw));
          float a = uAlpha * 0.8;
          if (uRoadsOnly > 0.5) {
            a = isRoad > 0.5 ? uAlpha * 0.95 : 0.0;
          }
          a *= mix(1.0, 0.35, isWater);
          if (a <= 0.003) discard;
          // pre-compensate the post-process desaturation so colours stay true
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = l + (col - l) / max(1e-3, 1.0 - uDesat);
          gl_FragColor = vec4(col * uBright, a);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
  }

  get active(): FieldId | null {
    return this.field;
  }

  /** 0..1 current fade of the info view */
  get fade(): number {
    return this.strength;
  }

  setField(field: FieldId | null): void {
    this.field = field;
    this.info = field ? overlayInfo(field) ?? null : null;
    if (this.info) {
      let ramp = this.ramps.get(this.info.id);
      if (!ramp) {
        ramp = createRampTexture(this.info.ramp);
        this.ramps.set(this.info.id, ramp);
      }
      this.material.uniforms.uRamp.value = ramp;
      this.material.uniforms.uRoadsOnly.value = this.info.roadsOnly ? 1 : 0;
      this.refresh();
    }
  }

  /** a field recompute finished (or roads changed) — refresh if relevant */
  onFieldsUpdated(ids: FieldId[] | null): void {
    if (!this.field) return;
    if (ids && !ids.includes(this.field)) return;
    this.pending = true;
  }

  private refresh(): void {
    const w = this.world;
    const f = this.field;
    if (!f) return;
    const src = w.fields[f];
    const d = this.data;
    const n = w.size * w.size;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const road = w.road[i];
      d[o] = src[i];
      d[o + 1] = road !== RoadType.None && road !== RoadType.Rail ? 255 : 0;
      const x = i % w.size, y = (i / w.size) | 0;
      d[o + 2] = w.isWater(x, y) ? 255 : 0;
      d[o + 3] = 255;
    }
    this.tex.needsUpdate = true;
    this.pending = false;
    this.refreshTimer = 0.3;
  }

  update(dt: number, night: number): void {
    const target = this.field ? 1 : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * 8);
    if (Math.abs(this.strength - target) < 0.002) this.strength = target;
    this.shared.uInfoView.value = this.strength;
    this.material.uniforms.uAlpha.value = this.strength;
    this.material.uniforms.uBright.value = 0.62 * (1 - 0.55 * night);
    this.terrain.setOverlayMaterial(this.strength > 0.001 ? this.material : null);
    this.refreshTimer -= dt;
    if (this.pending && this.refreshTimer <= 0) this.refresh();
  }

  dispose(): void {
    this.tex.dispose();
    for (const r of this.ramps.values()) r.dispose();
    this.material.dispose();
    this.terrain.setOverlayMaterial(null);
  }
}
