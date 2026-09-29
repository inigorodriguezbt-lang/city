// Astronomy + physically based single-scattering atmosphere.
//
// The same scattering model exists twice: as GLSL (ATMOSPHERE_GLSL, used to
// bake the sky-view LUT on the GPU) and as a TypeScript mirror (Atmosphere,
// used on the CPU for fog colour, sun/moon light colour and ambient light).
// Keep both in sync. Units: kilometres for geometry, radiance in "scene
// units" (linear, pre-exposure) after multiplication by SKY_RADIANCE_SCALE.
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

/** Solar declination (radians) for a year progress (0 = 1 January). */
export function solarDeclination(yearProgress: number): number {
  return -23.44 * 0.9 * DEG * Math.cos(Math.PI * 2 * (yearProgress + 10 / 360));
}

/**
 * Direction toward the sun in world space (x = east, y = up, z = south).
 * @param hour local solar time 0..24
 * @param yearProgress 0..1 (0 = 1 January)
 */
export function sunDirection(hour: number, yearProgress: number, latitudeDeg: number, out: THREE.Vector3): THREE.Vector3 {
  return celestialDirection((hour - 12) * 15 * DEG, solarDeclination(yearProgress), latitudeDeg * DEG, out);
}

/** Moon direction + phase. Phase 0 = new, 0.5 = full (29.5-day lunar month). */
export function moonDirection(hour: number, day: number, yearProgress: number, latitudeDeg: number, out: THREE.Vector3): number {
  const phase = (((day / 29.5) % 1) + 1) % 1;
  const sunDecl = solarDeclination(yearProgress);
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

// ── Atmosphere constants ────────────────────────────────────────────────────
export const R_GROUND = 6360.0;
export const R_TOP = 6420.0;
/** observer altitude above the planet surface (km) */
export const OBSERVER_ALT = 0.25;
/** multiplies raw scattering output into scene radiance units */
export const SKY_RADIANCE_SCALE = 26.0;
const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3];
const BETA_O = [0.65e-3, 1.881e-3, 0.085e-3];
const BETA_M = 3.996e-3;
const H_R = 8.0;
const H_M = 1.2;
const VIEW_STEPS = 20;
const LIGHT_STEPS = 6;

export interface AtmosphereParams {
  /** mie (haze) multiplier: 1 = clear, 3+ = hazy/overcast */
  turbidity: number;
  /** mie anisotropy */
  mieG: number;
  /** multiple-scattering approximation strength */
  msScale: number;
}

/** GLSL implementation of the atmosphere (uniforms: uSunDir, uTurbidity, uMieG, uMsScale). */
export const ATMOSPHERE_GLSL = /* glsl */ `
const float ATM_RG = ${R_GROUND.toFixed(1)};
const float ATM_RT = ${R_TOP.toFixed(1)};
const float ATM_OBS = ${OBSERVER_ALT.toFixed(3)};
const vec3 ATM_BETA_R = vec3(${BETA_R.map((v) => v.toExponential(4)).join(', ')});
const vec3 ATM_BETA_O = vec3(${BETA_O.map((v) => v.toExponential(4)).join(', ')});
const float ATM_BETA_M = ${BETA_M.toExponential(4)};
const float ATM_PI = 3.14159265;
uniform vec3 uSunDir;
uniform float uTurbidity;
uniform float uMieG;
uniform float uMsScale;

float atmRayTop(vec3 ro, vec3 rd) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - ATM_RT * ATM_RT;
  float d = max(b * b - c, 0.0);
  return -b + sqrt(d);
}
vec3 atmDensity(float h) {
  return vec3(exp(-h / ${H_R.toFixed(1)}), exp(-h / ${H_M.toFixed(1)}), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 atmExtinction(vec3 d) {
  return ATM_BETA_R * d.x + vec3(ATM_BETA_M * 1.11 * uTurbidity * d.y) + ATM_BETA_O * d.z;
}
// transmittance from p toward the sun, softly occluded by the planet (band = horizon softness)
vec3 atmSunTransmittance(vec3 p, vec3 s, float band) {
  float r = length(p);
  float mu = dot(p / r, s);
  float muH = -sqrt(max(0.0, 1.0 - (ATM_RG / r) * (ATM_RG / r)));
  float vis = smoothstep(muH - band, muH + band, mu);
  if (vis <= 0.0) return vec3(0.0);
  float L = atmRayTop(p, s);
  float dt = L / ${LIGHT_STEPS}.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < ${LIGHT_STEPS}; i++) {
    vec3 q = p + s * ((float(i) + 0.5) * dt);
    od += atmExtinction(atmDensity(length(q) - ATM_RG)) * dt;
  }
  return exp(-od) * vis;
}
float atmPhaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float atmPhaseM(float mu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
}
// in-scattered radiance toward the observer along dir (dir.y >= 0), raw units
vec3 atmSkyRadiance(vec3 dir) {
  vec3 ro = vec3(0.0, ATM_RG + ATM_OBS, 0.0);
  dir = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z));
  float L = atmRayTop(ro, dir);
  float mu = dot(dir, uSunDir);
  float pR = atmPhaseR(mu), pM = atmPhaseM(mu, uMieG);
  vec3 sum = vec3(0.0), ms = vec3(0.0), od = vec3(0.0);
  for (int i = 0; i < ${VIEW_STEPS}; i++) {
    float u0 = float(i) / ${VIEW_STEPS}.0, u1 = float(i + 1) / ${VIEW_STEPS}.0;
    float t0 = L * u0 * u0, t1 = L * u1 * u1, dt = t1 - t0;
    vec3 p = ro + dir * (0.5 * (t0 + t1));
    vec3 d = atmDensity(length(p) - ATM_RG);
    vec3 ext = atmExtinction(d);
    vec3 tv = exp(-(od + ext * (0.5 * dt)));
    od += ext * dt;
    vec3 sR = ATM_BETA_R * d.x, sM = vec3(ATM_BETA_M * uTurbidity * d.y);
    vec3 ts = atmSunTransmittance(p, uSunDir, 0.004);
    vec3 tms = atmSunTransmittance(p, uSunDir, 0.06);
    sum += tv * ts * (sR * pR + sM * pM) * dt;
    ms += tv * tms * (sR + sM) * dt;
  }
  return sum + ms * (uMsScale / (4.0 * ATM_PI));
}
`;

/** CPU mirror of ATMOSPHERE_GLSL. All vectors are plain tuples to avoid allocations. */
export class Atmosphere {
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  params: AtmosphereParams = { turbidity: 1, mieG: 0.78, msScale: 0.55 };
  private od = [0, 0, 0];
  private tmp = [0, 0, 0];
  private tmp2 = [0, 0, 0];

  private density(h: number, out: number[]): number[] {
    out[0] = Math.exp(-h / H_R);
    out[1] = Math.exp(-h / H_M);
    out[2] = Math.max(0, 1 - Math.abs(h - 25) / 15);
    return out;
  }

  private static rayTop(px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
    const b = px * dx + py * dy + pz * dz;
    const c = px * px + py * py + pz * pz - R_TOP * R_TOP;
    return -b + Math.sqrt(Math.max(b * b - c, 0));
  }

  /** transmittance from point p (km, planet-centred) toward direction s; writes into out */
  sunTransmittance(px: number, py: number, pz: number, s: THREE.Vector3, band: number, out: number[]): number[] {
    const r = Math.hypot(px, py, pz);
    const mu = (px * s.x + py * s.y + pz * s.z) / r;
    const muH = -Math.sqrt(Math.max(0, 1 - (R_GROUND / r) ** 2));
    const t = Math.min(1, Math.max(0, (mu - (muH - band)) / (2 * band)));
    const vis = t * t * (3 - 2 * t);
    if (vis <= 0) {
      out[0] = out[1] = out[2] = 0;
      return out;
    }
    const L = Atmosphere.rayTop(px, py, pz, s.x, s.y, s.z);
    const dt = L / LIGHT_STEPS;
    let o0 = 0, o1 = 0, o2 = 0;
    const d = this.tmp2;
    const tm = this.params.turbidity;
    for (let i = 0; i < LIGHT_STEPS; i++) {
      const k = (i + 0.5) * dt;
      const qx = px + s.x * k, qy = py + s.y * k, qz = pz + s.z * k;
      this.density(Math.hypot(qx, qy, qz) - R_GROUND, d);
      o0 += (BETA_R[0] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[0] * d[2]) * dt;
      o1 += (BETA_R[1] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[1] * d[2]) * dt;
      o2 += (BETA_R[2] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[2] * d[2]) * dt;
    }
    out[0] = Math.exp(-o0) * vis;
    out[1] = Math.exp(-o1) * vis;
    out[2] = Math.exp(-o2) * vis;
    return out;
  }

  /** Transmittance for light arriving at an observer at altitude `altKm` from direction s. */
  transmittanceAt(s: THREE.Vector3, altKm: number, out: THREE.Color): THREE.Color {
    const t = this.sunTransmittance(0, R_GROUND + altKm, 0, s, 0.004, this.tmp);
    return out.setRGB(t[0], t[1], t[2]);
  }

  /** Sky radiance toward dir (dir.y clamped to horizon), in scene units. */
  radiance(dir: THREE.Vector3, out: THREE.Color): THREE.Color {
    const s = this.sunDir;
    const oy = R_GROUND + OBSERVER_ALT;
    let dx = dir.x, dy = Math.max(dir.y, 0), dz = dir.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const L = Atmosphere.rayTop(0, oy, 0, dx, dy, dz);
    const mu = dx * s.x + dy * s.y + dz * s.z;
    const pR = 0.0596831 * (1 + mu * mu);
    const g = this.params.mieG, g2 = g * g;
    const pM = (0.1193662 * (1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * mu), 1.5));
    const tm = this.params.turbidity;
    const od = this.od;
    od[0] = od[1] = od[2] = 0;
    let s0 = 0, s1 = 0, s2 = 0, m0 = 0, m1 = 0, m2 = 0;
    const d = [0, 0, 0];
    const ts = [0, 0, 0], tms = [0, 0, 0];
    for (let i = 0; i < VIEW_STEPS; i++) {
      const u0 = i / VIEW_STEPS, u1 = (i + 1) / VIEW_STEPS;
      const t0 = L * u0 * u0, t1 = L * u1 * u1, dt = t1 - t0, tc = 0.5 * (t0 + t1);
      const px = dx * tc, py = oy + dy * tc, pz = dz * tc;
      this.density(Math.hypot(px, py, pz) - R_GROUND, d);
      const e0 = BETA_R[0] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[0] * d[2];
      const e1 = BETA_R[1] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[1] * d[2];
      const e2 = BETA_R[2] * d[0] + BETA_M * 1.11 * tm * d[1] + BETA_O[2] * d[2];
      const tv0 = Math.exp(-(od[0] + e0 * 0.5 * dt)), tv1 = Math.exp(-(od[1] + e1 * 0.5 * dt)), tv2 = Math.exp(-(od[2] + e2 * 0.5 * dt));
      od[0] += e0 * dt; od[1] += e1 * dt; od[2] += e2 * dt;
      const sM = BETA_M * tm * d[1];
      this.sunTransmittance(px, py, pz, s, 0.004, ts);
      this.sunTransmittance(px, py, pz, s, 0.06, tms);
      s0 += tv0 * ts[0] * (BETA_R[0] * d[0] * pR + sM * pM) * dt;
      s1 += tv1 * ts[1] * (BETA_R[1] * d[0] * pR + sM * pM) * dt;
      s2 += tv2 * ts[2] * (BETA_R[2] * d[0] * pR + sM * pM) * dt;
      m0 += tv0 * tms[0] * (BETA_R[0] * d[0] + sM) * dt;
      m1 += tv1 * tms[1] * (BETA_R[1] * d[0] + sM) * dt;
      m2 += tv2 * tms[2] * (BETA_R[2] * d[0] + sM) * dt;
    }
    const k = this.params.msScale / (4 * Math.PI);
    return out.setRGB((s0 + m0 * k) * SKY_RADIANCE_SCALE, (s1 + m1 * k) * SKY_RADIANCE_SCALE, (s2 + m2 * k) * SKY_RADIANCE_SCALE);
  }
}
