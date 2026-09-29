// Astronomy + analytic sky model shared by the sky shader (GLSL mirror in
// skyShader.ts) and the CPU lighting code (fog / hemisphere / sun colors).
// The daytime sky is the Preetham model (as in three's Sky addon) with a soft
// dynamic-range compression, plus our own twilight and night terms.
import * as THREE from 'three';
import type { ThemeId } from '../../core/types';

const DEG = Math.PI / 180;

/** Approximate latitude per biome (drives day length and sun height by season). */
export const THEME_LATITUDE: Record<ThemeId, number> = {
  temperate: 46,
  boreal: 57,
  desert: 29,
  tropical: 14,
  alpine: 46,
  mediterranean: 38,
};

/**
 * Direction toward the sun in world space (x = east, y = up, z = south).
 * @param hour local solar time 0..24
 * @param yearProgress 0..1 (0 = 1 January)
 */
export function sunDirection(hour: number, yearProgress: number, latitudeDeg: number, out: THREE.Vector3): THREE.Vector3 {
  // declination: min at the December solstice (~10 days before year start)
  const decl = -23.44 * 0.9 * DEG * Math.cos(Math.PI * 2 * (yearProgress + 10 / 360));
  return celestialDirection((hour - 12) * 15 * DEG, decl, latitudeDeg * DEG, out);
}

/** Moon direction + phase. Phase 0 = new, 0.5 = full (30-day in-game lunar month). */
export function moonDirection(hour: number, day: number, yearProgress: number, latitudeDeg: number, out: THREE.Vector3): number {
  const phase = (((day / 29.5) % 1) + 1) % 1;
  const sunDecl = -23.44 * 0.9 * DEG * Math.cos(Math.PI * 2 * (yearProgress + 10 / 360));
  const decl = sunDecl * Math.cos(phase * Math.PI * 2) + 5.1 * DEG * Math.sin(day * 0.23);
  const hourAngle = (hour - 12) * 15 * DEG - phase * Math.PI * 2;
  celestialDirection(hourAngle, decl, latitudeDeg * DEG, out);
  return phase;
}

function celestialDirection(hourAngle: number, decl: number, lat: number, out: THREE.Vector3): THREE.Vector3 {
  const sd = Math.sin(decl), cd = Math.cos(decl), sl = Math.sin(lat), cl = Math.cos(lat);
  const ch = Math.cos(hourAngle), sh = Math.sin(hourAngle);
  const east = -cd * sh;
  const north = sd * cl - cd * ch * sl;
  const up = sd * sl + cd * ch * cl;
  return out.set(east, up, -north).normalize();
}

// ── Preetham sky (CPU mirror of the GLSL) ───────────────────────────────────
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

export class SkyModel {
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  sunE = 0;
  readonly betaR = new THREE.Vector3();
  readonly betaM = new THREE.Vector3();
  mieG = 0.8;
  /** multiplier applied after compression (matches uSkyScale) */
  scale = 1;

  update(sunDir: THREE.Vector3, p: SkyParams, scale: number): void {
    this.sunDir.copy(sunDir);
    const zc = Math.max(-1, Math.min(1, sunDir.y));
    this.sunE = EE * Math.max(0, 1 - Math.exp(-(CUTOFF - Math.acos(zc)) / STEEPNESS));
    const rc = p.rayleigh; // sunfade ≈ 1 for a unit sun vector
    this.betaR.set(TOTAL_RAYLEIGH[0] * rc, TOTAL_RAYLEIGH[1] * rc, TOTAL_RAYLEIGH[2] * rc);
    const c = 0.2 * p.turbidity * 10e-18;
    this.betaM.set(0.434 * c * MIE_CONST[0] * p.mieCoefficient, 0.434 * c * MIE_CONST[1] * p.mieCoefficient, 0.434 * c * MIE_CONST[2] * p.mieCoefficient);
    this.mieG = p.mieDirectionalG;
    this.scale = scale;
  }

  /** Transmittance (Fex) along a direction – used for the sun light color. */
  extinction(dir: THREE.Vector3, out: THREE.Color): THREE.Color {
    const zenith = Math.acos(Math.max(0, dir.y));
    const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(Math.max(1e-3, 93.885 - zenith / DEG), -1.253));
    const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
    return out.setRGB(
      Math.exp(-(this.betaR.x * sR + this.betaM.x * sM)),
      Math.exp(-(this.betaR.y * sR + this.betaM.y * sM)),
      Math.exp(-(this.betaR.z * sR + this.betaM.z * sM)),
    );
  }

  /** Compressed daytime sky radiance toward `dir` (no sun disc, no night terms). */
  radiance(dir: THREE.Vector3, out: THREE.Color, dayAmbient: number): THREE.Color {
    const zenith = Math.acos(Math.max(0, dir.y));
    const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(Math.max(1e-3, 93.885 - zenith / DEG), -1.253));
    const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
    const cosT = dir.dot(this.sunDir);
    const rp = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
    const g = this.mieG, g2 = g * g;
    const mp = (0.07957747154594767 * (1 - g2)) / Math.pow(1 - 2 * g * cosT + g2, 1.5);
    const horizonMix = Math.min(1, Math.max(0, Math.pow(1 - this.sunDir.y, 5)));
    const br = [this.betaR.x, this.betaR.y, this.betaR.z];
    const bm = [this.betaM.x, this.betaM.y, this.betaM.z];
    const res = [0, 0, 0];
    const base = [0, 0.0003, 0.00075];
    for (let i = 0; i < 3; i++) {
      const fex = Math.exp(-(br[i] * sR + bm[i] * sM));
      const ratio = (br[i] * rp + bm[i] * mp) / (br[i] + bm[i]);
      let lin = Math.pow(this.sunE * ratio * (1 - fex), 1.5);
      const m2 = Math.pow(this.sunE * ratio * fex, 0.5);
      lin *= 1 + (m2 - 1) * horizonMix;
      const l0 = 0.1 * fex * dayAmbient;
      res[i] = Math.pow((lin + l0) * 0.04 + base[i] * dayAmbient, 1 / 2.4) * this.scale;
    }
    return out.setRGB(res[0], res[1], res[2]);
  }
}

/** Kelvin → linear RGB (approximate, normalized to max 1). */
export function kelvinToRGB(k: number, out: THREE.Color): THREE.Color {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  out.setRGB(Math.min(255, Math.max(0, r)) / 255, Math.min(255, Math.max(0, g)) / 255, Math.min(255, Math.max(0, b)) / 255, THREE.SRGBColorSpace);
  return out;
}
