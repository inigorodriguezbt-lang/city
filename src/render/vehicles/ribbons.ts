// Screen-aware overlay ribbons for transit lines (renderer overlays and the
// transit tool preview). Vertices carry their centerline position plus an
// offset (aOff, meters at nominal size); the vertex shader scales the offset
// up with camera distance so lines, stop discs and rings keep a minimum
// on-screen width when zoomed far out, and stay true to size up close.
import * as THREE from 'three';

const VS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec3 aOff;
attribute vec3 color;
uniform float uPixel; // meters per pixel at distance 1
uniform float uMinPx; // minimum half width in pixels
uniform float uRef; // nominal half width (m) the offsets were built for
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  float dist = distance( wp.xyz, cameraPosition );
  float k = max( 1.0, dist * uPixel * uMinPx / uRef );
  wp.xyz += aOff * k;
  wp.y += ( k - 1.0 ) * 0.35;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4( vColor, uOpacity );
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createRibbonMaterial(opacity = 0.9, minPx = 2.2, ref = 1.25): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPixel: { value: 0.001 }, uMinPx: { value: minPx }, uRef: { value: ref }, uOpacity: { value: opacity } }]),
    vertexShader: VS,
    fragmentShader: FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  return m;
}

/** meters-per-pixel factor for the current camera / canvas */
export function pixelFactor(camera: THREE.PerspectiveCamera, canvasHeight: number): number {
  return (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, canvasHeight);
}

/** growable buffers for ribbon geometry */
export class RibbonBuilder {
  pos: number[] = [];
  off: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  private v(x: number, y: number, z: number, ox: number, oz: number): void {
    this.pos.push(x, y, z);
    this.off.push(ox, 0, oz);
    this.col.push(this.c.r, this.c.g, this.c.b);
  }

  /** flat strip segment a→b of half width `half` */
  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, half: number, color: number | THREE.Color): void {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    if (color instanceof THREE.Color) this.c.copy(color);
    else this.c.setHex(color);
    const px = (-dz / l) * half, pz = (dx / l) * half;
    this.v(ax, ay, az, -px, -pz);
    this.v(bx, by, bz, -px, -pz);
    this.v(bx, by, bz, px, pz);
    this.v(ax, ay, az, -px, -pz);
    this.v(bx, by, bz, px, pz);
    this.v(ax, ay, az, px, pz);
  }

  /** filled disc */
  disc(x: number, y: number, z: number, r: number, color: number | THREE.Color, segs = 18): void {
    if (color instanceof THREE.Color) this.c.copy(color);
    else this.c.setHex(color);
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      this.v(x, y, z, 0, 0);
      this.v(x, y, z, Math.cos(a0) * r, Math.sin(a0) * r);
      this.v(x, y, z, Math.cos(a1) * r, Math.sin(a1) * r);
    }
  }

  /** ring between radii */
  ring(x: number, y: number, z: number, r0: number, r1: number, color: number | THREE.Color, segs = 24): void {
    if (color instanceof THREE.Color) this.c.copy(color);
    else this.c.setHex(color);
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.v(x, y, z, c0 * r0, s0 * r0);
      this.v(x, y, z, c0 * r1, s0 * r1);
      this.v(x, y, z, c1 * r1, s1 * r1);
      this.v(x, y, z, c0 * r0, s0 * r0);
      this.v(x, y, z, c1 * r1, s1 * r1);
      this.v(x, y, z, c1 * r0, s1 * r0);
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aOff', new THREE.Float32BufferAttribute(this.off, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}
