// Shared material library for every procedural model (buildings, props, roads
// may reuse). All materials are MeshStandardMaterials extended through
// onBeforeCompile with procedural detail:
//  - wall_* materials draw windows in the shader from meter UVs (bays × floors)
//    with frames, sills, shutters, muntins, reflective glass, parallax
//    interiors (rooms with furniture), curtains and blinds, and at night lit
//    windows chosen per window from a hash + an occupancy schedule per use.
//  - roofs, ground and misc materials get procedural textures (tiles, seams,
//    gravel, pavers, grass, crop rows, PV cells…), bump via screen-space
//    height derivatives, and all multiply the geometry's vertex color.
// Optional per-vertex attributes (added by BuildingRenderer when merging):
//   aInfo (u8×4): building seed lo/hi, schedule|style|lit bits, condition bits
//   aFac  (u8×4): facade code for wall_* (window kind, width, height, flags)
// Geometry without them falls back to sensible defaults.
import * as THREE from 'three';
import { MAT_KEYS, type MatKey } from './types';

// ── shared uniforms (one object per uniform, referenced by every program) ──
const U = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  uHour: { value: 12 },
  uAnimTime: { value: 0 },
  uSkyZenith: { value: new THREE.Color(0.22, 0.42, 0.78) },
  uSkyHorizon: { value: new THREE.Color(0.72, 0.8, 0.9) },
  uSkyGround: { value: new THREE.Color(0.28, 0.27, 0.25) },
};

/** Default aInfo when geometry has none: seed 0x8080, generic schedule, lit level 2. */
const DEFAULT_INFO = [128 / 255, 128 / 255, (2 << 6) / 255, 0];

interface MatSpec {
  type: number;
  rough: number;
  metal: number;
}

const SPECS: Record<MatKey, MatSpec> = {
  wall_plaster: { type: 1, rough: 0.9, metal: 0 },
  wall_brick: { type: 2, rough: 0.92, metal: 0 },
  wall_wood: { type: 3, rough: 0.85, metal: 0 },
  wall_concrete: { type: 4, rough: 0.9, metal: 0 },
  wall_stone: { type: 5, rough: 0.88, metal: 0 },
  wall_glass: { type: 6, rough: 0.1, metal: 0 },
  wall_office: { type: 7, rough: 0.8, metal: 0 },
  wall_shop: { type: 8, rough: 0.8, metal: 0 },
  wall_industrial: { type: 9, rough: 0.55, metal: 0.35 },
  roof_tile: { type: 10, rough: 0.78, metal: 0 },
  roof_metal: { type: 11, rough: 0.38, metal: 0.55 },
  roof_flat: { type: 12, rough: 0.95, metal: 0 },
  roof_shingle: { type: 13, rough: 0.92, metal: 0 },
  plain: { type: 20, rough: 0.82, metal: 0 },
  glass: { type: 21, rough: 0.06, metal: 1 },
  metal: { type: 22, rough: 0.38, metal: 0.75 },
  wood: { type: 23, rough: 0.82, metal: 0 },
  concrete: { type: 24, rough: 0.92, metal: 0 },
  asphalt: { type: 25, rough: 0.93, metal: 0 },
  paving: { type: 26, rough: 0.88, metal: 0 },
  grass: { type: 27, rough: 0.97, metal: 0 },
  foliage: { type: 28, rough: 0.9, metal: 0 },
  bark: { type: 29, rough: 0.95, metal: 0 },
  water: { type: 30, rough: 0.04, metal: 0.1 },
  sand: { type: 31, rough: 0.96, metal: 0 },
  dirt: { type: 32, rough: 0.98, metal: 0 },
  crop: { type: 33, rough: 0.95, metal: 0 },
  emissive: { type: 34, rough: 0.55, metal: 0 },
  neon: { type: 35, rough: 0.4, metal: 0 },
  solar: { type: 36, rough: 0.14, metal: 0.55 },
};

const LOD_TYPE = 40;

// ── GLSL ────────────────────────────────────────────────────────────────────
const VERT_PARS = /* glsl */ `
attribute vec4 aInfo;
#ifdef B_UBER
attribute float aMat;
flat varying float vBMat;
#endif
varying vec3 vBWPos;
varying vec3 vBWNrm;
varying vec2 vBUv;
flat varying vec4 vBInfo;
#ifdef B_FAC
attribute vec4 aFac;
flat varying vec4 vBFac;
#endif
#ifdef B_ANIM
attribute vec3 aPivot;
attribute vec3 aAxis;
attribute vec3 aAnim;
uniform float uAnimTime;
vec3 bRot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
float bAngle() { return aAnim.y > 0.0 ? aAnim.y * sin(uAnimTime * aAnim.x + aAnim.z) : uAnimTime * aAnim.x + aAnim.z; }
#endif
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
#ifdef B_ANIM
objectNormal = bRot(objectNormal, normalize(aAxis), bAngle());
#endif
`;

const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
#ifdef B_ANIM
transformed = aPivot + bRot(transformed - aPivot, normalize(aAxis), bAngle());
#endif
`;

const VERT_MAIN = /* glsl */ `
#include <worldpos_vertex>
{
  vec4 bwp = modelMatrix * vec4(transformed, 1.0);
  vBWPos = bwp.xyz;
  vBWNrm = normalize(mat3(modelMatrix) * objectNormal);
  vBUv = uv;
  vBInfo = aInfo;
#ifdef B_UBER
  vBMat = aMat;
#endif
#ifdef B_FAC
  vBFac = aFac;
#endif
}
`;

const FRAG_PARS = /* glsl */ `
uniform float uNight;
uniform float uTime;
uniform float uHour;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
varying vec3 vBWPos;
varying vec3 vBWNrm;
varying vec2 vBUv;
flat varying vec4 vBInfo;
#ifdef B_FAC
flat varying vec4 vBFac;
#endif
#ifdef B_UBER
flat varying float vBMat;
#endif

uint bHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
float bHashF(uint a, uint b, uint c) {
  return float(bHash(a ^ bHash((b + 0x9e3779b9u) ^ bHash(c))) >> 8u) * (1.0 / 16777216.0);
}
uint bU(float f) { return uint(int(floor(f)) + 1048576); }
float bN2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bVN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bN2(i), bN2(i + vec2(1.0, 0.0)), u.x), mix(bN2(i + vec2(0.0, 1.0)), bN2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bFbm(vec2 p) { return bVN(p) * 0.5 + bVN(p * 2.03 + 17.1) * 0.3 + bVN(p * 4.07 + 31.7) * 0.2; }
float bLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float bBox(vec2 p, vec2 c, vec2 hs) { vec2 d = abs(p - c) - hs; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float bFill(float sd, float aa) { return 1.0 - smoothstep(-aa, aa, sd); }
vec3 bHue(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }

const float B_SCHED[192] = float[192](
  0.30,0.20,0.14,0.10,0.10,0.14,0.30,0.40,0.40,0.40,0.40,0.40,0.40,0.40,0.40,0.40,0.45,0.50,0.55,0.60,0.60,0.55,0.48,0.38,
  0.34,0.20,0.10,0.06,0.05,0.10,0.30,0.42,0.25,0.12,0.10,0.10,0.12,0.12,0.12,0.14,0.22,0.38,0.56,0.68,0.72,0.68,0.58,0.46,
  0.14,0.10,0.08,0.08,0.08,0.10,0.20,0.45,0.75,0.90,0.92,0.92,0.92,0.92,0.92,0.92,0.92,0.92,0.90,0.88,0.80,0.60,0.35,0.20,
  0.12,0.10,0.08,0.08,0.08,0.12,0.25,0.55,0.85,0.90,0.90,0.90,0.90,0.90,0.90,0.90,0.88,0.80,0.62,0.45,0.32,0.24,0.18,0.14,
  0.45,0.42,0.40,0.40,0.42,0.50,0.62,0.70,0.72,0.72,0.72,0.72,0.72,0.72,0.72,0.72,0.72,0.70,0.62,0.55,0.50,0.48,0.46,0.45,
  0.55,0.50,0.50,0.50,0.50,0.55,0.65,0.80,0.85,0.85,0.85,0.85,0.85,0.85,0.85,0.85,0.85,0.80,0.75,0.70,0.65,0.62,0.60,0.58,
  0.40,0.28,0.18,0.14,0.12,0.16,0.30,0.40,0.30,0.20,0.18,0.18,0.18,0.18,0.20,0.24,0.30,0.40,0.50,0.60,0.66,0.66,0.60,0.50,
  0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0
);
float bSched(int s, float h) {
  float hh = mod(h, 24.0);
  int i0 = int(floor(hh));
  int i1 = (i0 + 1) % 24;
  return mix(B_SCHED[s * 24 + i0], B_SCHED[s * 24 + i1], fract(hh));
}
vec3 bLightCol(float r, int s) {
  vec3 warm = vec3(1.0, 0.56, 0.24), soft = vec3(1.0, 0.7, 0.4), neut = vec3(1.0, 0.85, 0.64), cool = vec3(0.78, 0.88, 1.0);
  if (s == 3 || s == 5) return r < 0.55 ? cool : r < 0.85 ? neut : soft;
  if (s == 2) return r < 0.4 ? neut : r < 0.75 ? cool : soft;
  if (s == 4) return r < 0.55 ? vec3(1.0, 0.6, 0.26) : cool;
  return r < 0.45 ? warm : r < 0.8 ? soft : r < 0.93 ? neut : cool;
}
float bLitInten(int s) { return s == 3 ? 2.1 : s == 2 ? 2.4 : s == 4 ? 1.8 : 1.7; }
vec3 bSky(vec3 d) {
  vec3 up = mix(uSkyHorizon, uSkyZenith, pow(clamp(d.y, 0.0, 1.0), 0.45));
  vec3 dn = mix(uSkyHorizon * 0.55, uSkyGround, clamp(-d.y * 4.0, 0.0, 1.0));
  return d.y >= 0.0 ? up : dn;
}

// Output of the procedural surface pass
struct BOut { vec3 alb; float rough; float metal; vec3 emit; float h; float refl; float f0; };

// Parallax interior of a room behind a window (bay × storey × depth).
vec3 bInterior(vec2 lp, float bay, float fh, vec3 rd, float rInt, float lit, vec3 lcol, float inten, float dayL, int sched) {
  float D = (sched == 3 || sched == 2 ? 5.5 : 3.4) + rInt * 1.8;
  vec3 r = rd;
  r.z = min(r.z, -0.04);
  if (abs(r.x) < 1e-4) r.x = 1e-4;
  if (abs(r.y) < 1e-4) r.y = 1e-4;
  float fy1 = fh - 0.3;
  float tx = ((r.x > 0.0 ? bay : 0.0) - lp.x) / r.x;
  float ty = ((r.y > 0.0 ? fy1 : 0.0) - lp.y) / r.y;
  float tz = -D / r.z;
  float t = max(0.0, min(min(tx, ty), tz));
  vec3 hp = vec3(lp, 0.0) + r * t;
  vec3 hue = bHue(rInt * 3.7);
  vec3 paint = mix(vec3(0.86, 0.82, 0.75), hue, 0.22);
  vec3 c;
  if (t == tz) {
    c = paint;
    float fx = hp.x / bay;
    float a = 0.25 + 0.5 * fract(rInt * 7.31);
    if (sched == 3) {
      // office: desks + partitions + monitors
      if (hp.y < 1.1 && fract(fx * 2.0 + rInt) < 0.7) c = vec3(0.32, 0.33, 0.35);
      if (hp.y > 0.75 && hp.y < 1.05 && fract(fx * 4.0 + rInt * 3.0) < 0.3) c = vec3(0.08, 0.09, 0.1);
    } else if (sched == 2) {
      // shelves with goods
      if (hp.y < 2.1) c = mix(vec3(0.35), bHue(floor(hp.y * 3.0) * 0.37 + rInt), 0.45) * (0.7 + 0.3 * step(0.5, fract(hp.y * 3.0)));
    } else {
      if (hp.y < 0.9 && abs(fx - a) < 0.2 + 0.1 * fract(rInt * 3.1)) c = mix(vec3(0.25, 0.2, 0.18), hue * 0.5, 0.4);
      else if (hp.y < 2.0 && abs(fx - fract(a + 0.5)) < 0.1) c = vec3(0.3, 0.22, 0.15) * (0.8 + 0.4 * step(0.5, fract(hp.y * 3.0)));
      else if (hp.y > 1.3 && hp.y < 1.9 && abs(fx - a) < 0.12) c = hue * 0.7 + 0.1;
    }
  } else if (t == tx) {
    c = paint * 0.85;
  } else if (r.y > 0.0) {
    c = vec3(0.93, 0.92, 0.9);
  } else {
    c = rInt > 0.5 ? vec3(0.42, 0.3, 0.2) : vec3(0.5, 0.48, 0.45);
  }
  float depth = clamp(-hp.z / D, 0.0, 1.0);
  vec3 day = c * dayL * mix(0.16, 0.035, depth);
  vec3 L = vec3(bay * 0.5, fy1 - 0.05, -D * 0.45);
  float dl = length(hp - L);
  float fall = 1.0 / (1.0 + dl * dl * 0.3);
  vec3 nightC = c * lcol * inten * (0.22 + 1.3 * fall);
  if (r.y > 0.0 && t == ty) nightC += lcol * inten * 0.9 * exp(-dl * dl * 1.2);
  return day + nightC * lit;
}

// Shutter palettes per style (building-constant choice)
vec3 bShutterCol(uint style, float r) {
  if (style == 0u) return r < 0.3 ? vec3(0.05) : r < 0.55 ? vec3(0.08, 0.16, 0.1) : r < 0.8 ? vec3(0.08, 0.11, 0.2) : vec3(0.3, 0.06, 0.06);
  if (style == 1u) return r < 0.3 ? vec3(0.33, 0.42, 0.32) : r < 0.55 ? vec3(0.38, 0.45, 0.52) : r < 0.8 ? vec3(0.33, 0.22, 0.13) : vec3(0.78, 0.76, 0.7);
  if (style == 2u) return r < 0.4 ? vec3(0.1, 0.3, 0.55) : r < 0.7 ? vec3(0.14, 0.4, 0.26) : vec3(0.08, 0.4, 0.42);
  if (style == 3u) return vec3(0.9, 0.9, 0.88);
  if (style == 4u) return r < 0.5 ? vec3(0.45, 0.1, 0.08) : vec3(0.16);
  return vec3(0.12);
}

// Punched windows on a masonry/timber/concrete facade.
void bWindows(inout BOut o, vec2 uv, float bay, float fh, float ww, float wh, float sill, int kind, uint flags,
              uint seed, uint face, int sched, float litLvl, uint cond, uint style, vec3 rdT, float ndv, float mpp, int wt) {
  if (kind == 6 || uv.y < 0.0) return;
  vec2 cf = uv / vec2(bay, fh);
  vec2 ci = floor(cf);
  vec2 lp = (cf - ci) * vec2(bay, fh);
  if ((flags & 16u) != 0u && ci.y < 0.5) return;
  bool balc = (flags & 128u) != 0u && ci.y > 0.5;
  float cx = bay * 0.5, hw = ww * 0.5, y0 = sill, y1 = sill + wh;
  uint sub = 0u;
  if (kind == 4) { hw = bay * 0.5 - 0.07; }
  else if (kind == 5 || balc) { y0 = 0.06; y1 = min(fh - 0.42, 2.5); hw = min(max(hw, 0.55), bay * 0.5 - 0.25); }
  else if (kind == 7) { hw = min(hw, 0.42); y0 = sill + 0.3; y1 = y0 + min(wh, 0.85); }
  else if (kind == 9) { y0 = -0.05; y1 = fh + 0.05; }
  if (kind == 2 && !balc) {
    float g = 0.32;
    float w2 = max(0.3, (ww - g) * 0.5);
    sub = lp.x < cx ? 0u : 1u;
    cx = cx + (sub == 0u ? -1.0 : 1.0) * (g + w2) * 0.5;
    hw = w2 * 0.5;
  }
  vec2 wc = vec2(cx, (y0 + y1) * 0.5);
  vec2 hs = vec2(hw, (y1 - y0) * 0.5);
  float pxBay = bay / max(mpp, 1e-4);
  float det = smoothstep(3.5, 9.0, pxBay);

  // per-window randomness
  uint key = seed * 16u + face;
  uint wx = bU(ci.x) * 2u + sub, wy = bU(ci.y);
  float rLit = bHashF(wx, wy, key);
  float rCol = bHashF(wx + 101u, wy, key);
  float rInt = bHashF(wx, wy + 211u, key);
  float rCur = bHashF(wx + 307u, wy + 53u, key);
  float rB = bHashF(seed, 77u, 3u);

  float nightOn = smoothstep(0.05, 0.65, uNight);
  float occ = bSched(sched, uHour) * litLvl;
  float lit = step(rLit, occ * nightOn);
  vec3 lcol = bLightCol(rCol, sched);
  float inten = bLitInten(sched);
  if (rCol > 0.965 && sched == 1) { lcol = vec3(0.45, 0.6, 1.0); inten *= 0.45 + 0.35 * bVN(vec2(uTime * 7.0, rInt * 91.0)); }
  if (rInt > 0.993) inten *= step(0.35, bVN(vec2(uTime * 13.0, rLit * 57.0)));
  bool broken = (cond & 1u) != 0u;
  bool burned = (cond & 2u) != 0u;
  bool fire = (cond & 8u) != 0u;
  bool building = (cond & 16u) != 0u;
  if (broken || burned || building) lit = 0.0;

  float area = 4.0 * hs.x * hs.y * (kind == 2 && !balc ? 2.0 : 1.0) / (bay * fh);
  float dayL = 1.0 - uNight * 0.97;
  vec3 glassTint = mix(vec3(0.07, 0.09, 0.1), vec3(0.1, 0.13, 0.13), rInt);
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);

  // far: flat cells averaged (stable at a distance)
  if (det < 0.999) {
    float litAvg = mix(lit, occ * nightOn * (broken || burned || building ? 0.0 : 1.0), smoothstep(3.0, 1.2, pxBay));
    vec3 e = lcol * inten * litAvg * area * 0.55 + vec3(0.08, 0.07, 0.06) * dayL * area * 0.3;
    if (fire && rInt < 0.8) e += vec3(1.0, 0.36, 0.08) * 2.5 * area;
    float k = (1.0 - det) * min(1.0, area * 1.6);
    o.alb = mix(o.alb, mix(o.alb, glassTint * 1.6, 0.8), k);
    o.rough = mix(o.rough, 0.25, k);
    o.metal = mix(o.metal, 0.5, k * 0.7);
    o.emit += e * (1.0 - det);
    o.refl = max(o.refl, k * 0.6);
    o.f0 = 0.1;
  }
  if (det <= 0.001) return;

  float aa = mpp * 0.75 + 1e-4;
  float sd = bBox(lp, wc, hs);
  bool arched = (flags & 2u) != 0u && kind != 4 && kind != 9;
  if (arched) { vec2 ac = vec2(cx, y1 - hw); if (lp.y > ac.y) sd = max(sd, length(lp - ac) - hw); }
  if (kind == 8) sd = length(lp - wc) - min(hw, hs.y);
  bool dark = (flags & 8u) != 0u;
  float fwid = kind == 9 ? 0.05 : 0.075;
  float mOpen = bFill(sd, aa);
  float mGlass = bFill(sd + fwid, aa);
  float mFrame = mOpen - mGlass;
  bool noSill = kind == 4 || kind == 9 || kind == 5 || balc || wt == 3 && style >= 6u;
  float mSill = noSill ? 0.0 : bFill(bBox(lp, vec2(cx, y0 - 0.05), vec2(hw + 0.08, 0.05)), aa) * (1.0 - mOpen);
  float mSur = (flags & 64u) != 0u ? bFill(sd - 0.14, aa) * (1.0 - mOpen) * (1.0 - mSill) : 0.0;
  float mLint = 0.0;
  if (wt == 2 && kind != 4 && kind != 9 && !arched) mLint = bFill(bBox(lp, vec2(cx, y1 + 0.11), vec2(hw + 0.1, 0.11)), aa) * (1.0 - mOpen);
  if (wt == 2 && arched) mLint = bFill(sd - 0.2, aa) * (1.0 - mOpen) * step(y1 - hw, lp.y);
  float mShut = 0.0;
  bool closed = false;
  if ((flags & 1u) != 0u && kind != 4 && kind != 9) {
    float sw = hw * 0.95;
    float sl = bBox(lp, vec2(cx - hw - sw * 0.5 - 0.03, wc.y), vec2(sw * 0.5, hs.y));
    float sr = bBox(lp, vec2(cx + hw + sw * 0.5 + 0.03, wc.y), vec2(sw * 0.5, hs.y));
    closed = rCur < (style == 2u ? 0.35 : 0.14);
    mShut = closed ? mOpen : bFill(min(sl, sr), aa) * (1.0 - mOpen);
  }
  // muntins (divided lites) / door split / tripartite mullions
  float mMun = 0.0;
  if ((flags & 4u) != 0u) {
    float vy = y0 + (y1 - y0) * 0.58;
    mMun = max(bFill(abs(lp.x - cx) - 0.022, aa), bFill(abs(lp.y - vy) - 0.022, aa));
    if (hw > 0.7) mMun = max(mMun, bFill(abs(abs(lp.x - cx) - hw * 0.5) - 0.02, aa));
  } else if (kind == 5 || balc) {
    mMun = bFill(abs(lp.x - cx) - 0.035, aa);
  } else if (kind == 3) {
    mMun = bFill(abs(abs(lp.x - cx) - hw / 3.0) - 0.035, aa);
  }
  mMun *= mGlass;

  vec3 frameCol = dark ? vec3(0.06, 0.065, 0.07) : (style == 1u && rB < 0.4 ? vec3(0.36, 0.24, 0.15) : vec3(0.9, 0.89, 0.86));
  vec3 sillCol = mix(vec3(0.8, 0.78, 0.74), o.alb, 0.25);
  vec3 surCol = wt == 2 ? mix(vec3(0.82, 0.79, 0.72), o.alb, 0.15) : mix(o.alb * 1.12, vec3(0.9, 0.88, 0.84), 0.45);
  vec3 lintCol = wt == 2 ? o.alb * 0.82 : surCol;

  // interior + curtains / blinds
  vec2 wl = (lp - (wc - hs)) / max(2.0 * hs, vec2(1e-3));
  vec3 ie = vec3(0.0);
  float glassDirt = 1.0;
  if (mGlass > 0.002) {
    ie = bInterior(lp, bay, fh, rdT, rInt, lit, lcol, inten, dayL, sched);
    int cmode = 0; // 0 open, 1 curtains, 2 blinds
    if (sched == 3) cmode = rCur < 0.5 ? 2 : 0;
    else if (sched == 1 || sched == 6 || sched == 0) cmode = rCur < 0.42 ? 1 : rCur < 0.62 ? 2 : 0;
    if (cmode == 1) {
      float cw = 0.14 + fract(rCur * 13.7) * 0.32;
      float m = step(wl.x, cw) + step(1.0 - cw, wl.x);
      if (fract(rCur * 5.3) < 0.25) m = max(m, step(0.25, wl.y) * 0.0 + 1.0) * step(0.4, fract(rInt * 9.1)); // drawn closed
      vec3 cc = mix(vec3(0.86, 0.8, 0.68), bHue(rCur * 5.1) * 0.6 + 0.2, step(0.6, fract(rCur * 3.3)));
      float fold = 0.82 + 0.18 * sin(wl.x * 70.0);
      vec3 cE = cc * fold * (dayL * 0.24 + lit * lcol * inten * 0.7);
      ie = mix(ie, cE, clamp(m, 0.0, 1.0));
    } else if (cmode == 2) {
      float bl = 1.0 - (0.15 + fract(rCur * 7.9) * 0.7);
      float m = step(bl, wl.y);
      float slat = 0.75 + 0.25 * step(0.35, fract(lp.y / 0.045));
      vec3 bc = sched == 3 ? vec3(0.72, 0.72, 0.7) : vec3(0.8, 0.74, 0.62);
      vec3 bE = bc * slat * (dayL * 0.3 + lit * lcol * inten * 0.55);
      ie = mix(ie, bE, m);
    }
    // store windows glow brighter at night
    if (wt == 3 && style == 3u) ie *= 1.1;
  }
  if (fire && rInt < 0.85) {
    float fl = 0.6 + 0.4 * bVN(vec2(uTime * 9.0 + rLit * 40.0, wl.y * 3.0 - uTime * 4.0));
    ie = vec3(1.0, 0.33, 0.07) * (2.2 + 2.8 * fl) * (0.6 + 0.4 * (1.0 - wl.y));
  }

  vec3 glassAlb = glassTint;
  float gRough = 0.05, gF0 = 0.09;
  if (broken) {
    if (rInt < 0.42) { glassAlb = vec3(0.015); gRough = 0.95; gF0 = 0.0; ie = vec3(0.004); }
    else if (rInt < 0.72) {
      float plank = step(0.12, fract(wl.y * 4.0 + fract(rInt * 11.0) * 0.3));
      glassAlb = vec3(0.4, 0.31, 0.2) * (0.6 + 0.4 * plank); gRough = 0.9; gF0 = 0.0; ie = vec3(0.0);
    } else { glassAlb = glassTint * 1.6; gRough = 0.5; gF0 = 0.04; ie *= 0.3; }
  }
  if (burned) { glassAlb = vec3(0.012); gRough = 0.95; gF0 = 0.0; if (!fire) ie = vec3(0.0); frameCol = vec3(0.03); }
  if (building) { glassAlb = vec3(0.05); gRough = 0.95; gF0 = 0.0; ie = vec3(0.01) * dayL; }

  // top reveal shadow inside the recess
  float rev = mix(0.55, 1.0, smoothstep(0.0, 0.22, y1 - lp.y)) * mix(0.75, 1.0, smoothstep(0.0, 0.12, lp.x - (cx - hw)));

  float mG = mGlass * (1.0 - mMun) * det;
  if (closed) mG = 0.0;
  // compose (outer to inner)
  o.alb = mix(o.alb, sillCol, mSill * det);
  o.h += 0.03 * mSill * det;
  o.alb = mix(o.alb, surCol, mSur * det);
  o.h += 0.02 * mSur * det;
  float lintMortar = step(0.5, fract(lp.x / 0.075)) * 0.12;
  o.alb = mix(o.alb, lintCol * (1.0 - lintMortar), mLint * det);
  if (mShut > 0.0) {
    vec3 sc = bShutterCol(style, rB);
    float louver = 0.82 + 0.18 * step(0.45, fract(lp.y / 0.065));
    o.alb = mix(o.alb, sc * louver, mShut * det);
    o.rough = mix(o.rough, 0.7, mShut * det);
    o.h += (0.025 + louver * 0.006) * mShut * det;
    if (closed) o.emit += lcol * inten * lit * 0.12 * (1.0 - louver) * 4.0 * mShut * det;
  }
  o.alb = mix(o.alb, frameCol, (mFrame + mMun * mGlass) * det * (closed ? 0.0 : 1.0));
  o.rough = mix(o.rough, 0.45, mFrame * det);
  o.h += (0.015 * mFrame - 0.07 * mGlass) * det;
  o.alb = mix(o.alb, glassAlb * rev, mG);
  o.rough = mix(o.rough, gRough, mG);
  o.metal = mix(o.metal, gF0 > 0.0 ? 1.0 : 0.0, mG);
  o.emit += ie * rev * (1.0 - fres) * mG;
  o.refl = max(o.refl, mG * step(0.001, gF0));
  o.f0 = mix(o.f0, gF0, mG);
  if (burned) {
    float soot = bFill(bBox(lp, vec2(cx, y1 + 0.9), vec2(hw * 1.3, 0.9)), 0.5) * smoothstep(y1 + 1.8, y1, lp.y);
    o.alb *= 1.0 - 0.75 * soot * det;
  }
}

// ── wall base textures ──
vec3 bPlaster(vec2 uv, vec3 c, float mpp, bool alt, inout float h) {
  float det = 1.0 - smoothstep(0.015, 0.06, mpp);
  float n = bFbm(uv * 0.9);
  float fine = bVN(uv * (alt ? 9.0 : 16.0));
  vec3 col = c * (0.94 + 0.1 * n) * (1.0 + (fine - 0.5) * (alt ? 0.1 : 0.05) * det);
  float streak = bVN(vec2(uv.x * 2.3, uv.y * 0.07));
  col *= 1.0 - 0.07 * smoothstep(0.62, 0.92, streak);
  col *= mix(0.84, 1.0, smoothstep(0.0, 0.9, uv.y));
  h += (fine - 0.5) * (alt ? 0.006 : 0.003) * det;
  return col;
}
vec3 bBrick(vec2 uv, vec3 c, float mpp, bool alt, inout float h) {
  float ch = 0.075, bl = alt ? 0.2 : 0.225;
  float row = floor(uv.y / ch);
  float off = alt ? mod(row, 2.0) * 0.25 : mod(row, 2.0) * 0.5;
  float bx = uv.x / bl + off;
  float col = floor(bx);
  vec2 f = vec2(fract(bx) * bl, fract(uv.y / ch) * ch);
  float det = 1.0 - smoothstep(0.008, 0.03, mpp);
  float aa = mpp * 0.6;
  float mw = 0.0105;
  float m = 1.0 - smoothstep(mw - aa, mw + aa, f.x) * smoothstep(mw - aa, mw + aa, f.y);
  float rnd = bN2(vec2(col, row));
  vec3 bc = c * (0.8 + 0.32 * rnd);
  bc = mix(bc, bc * vec3(1.1, 0.9, 0.82), bN2(vec2(row, col) + 3.1) * 0.6);
  bc *= 0.93 + 0.14 * bVN(uv * 11.0);
  vec3 mortar = mix(vec3(0.72, 0.69, 0.64), c, 0.18);
  vec3 near = mix(bc, mortar, m);
  vec3 avg = mix(c * 0.98, mortar, 0.14);
  float stain = bFbm(uv * 0.35);
  vec3 res = mix(avg, near, det) * (0.9 + 0.14 * stain);
  res *= mix(0.86, 1.0, smoothstep(0.0, 0.8, uv.y));
  h -= 0.006 * m * det;
  return res;
}
vec3 bWood(vec2 uv, vec3 c, float mpp, bool vert, inout float h) {
  float det = 1.0 - smoothstep(0.012, 0.05, mpp);
  vec3 col;
  if (vert) {
    float bw = 0.3;
    float fx = fract(uv.x / bw) * bw;
    float bat = 1.0 - smoothstep(0.035, 0.045 + mpp, abs(fx - bw * 0.5));
    float board = floor(uv.x / bw);
    col = c * (0.9 + 0.14 * bN2(vec2(board, 3.0))) * (0.95 + 0.08 * bVN(vec2(uv.x * 40.0, uv.y * 1.3)));
    col = mix(col, col * 1.06, bat * det);
    col *= mix(1.0, 0.72, (1.0 - smoothstep(0.0, 0.02 + mpp, abs(fx - bw * 0.5 + 0.047))) * det);
    h += bat * 0.015 * det;
  } else {
    float bh = 0.2;
    float t = fract(uv.y / bh);
    float board = floor(uv.y / bh);
    float sh = 1.0 - 0.3 * smoothstep(0.78, 1.0, t);
    col = c * mix(1.0, sh, det) * (0.95 + 0.07 * bN2(vec2(board, floor(uv.x / 3.7 + board * 0.37))));
    col *= 0.96 + 0.06 * bVN(vec2(uv.x * 1.5, board * 7.3 + t * 3.0));
    h += t * 0.014 * det;
  }
  col *= mix(0.85, 1.0, smoothstep(0.0, 0.7, uv.y));
  return col;
}
vec3 bConcrete(vec2 uv, vec3 c, float mpp, float bay, float fh, inout float h) {
  float det = 1.0 - smoothstep(0.015, 0.07, mpp);
  vec2 cell = floor(uv / vec2(bay, fh * 0.5));
  vec2 f = fract(uv / vec2(bay, fh * 0.5)) * vec2(bay, fh * 0.5);
  float aa = mpp * 0.7;
  float joint = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, min(min(f.x, bay - f.x), min(f.y, fh * 0.5 - f.y)));
  vec3 col = c * (0.92 + 0.1 * bN2(cell)) * (0.94 + 0.1 * bFbm(uv * 1.7));
  float streak = bVN(vec2(uv.x * 3.1, uv.y * 0.12));
  col *= 1.0 - 0.1 * smoothstep(0.55, 0.95, streak) * smoothstep(0.0, 6.0, uv.y);
  vec2 tie = fract(uv / vec2(0.8, 0.6)) - 0.5;
  float tieM = (1.0 - smoothstep(0.018, 0.028 + aa, length(tie * vec2(0.8, 0.6)))) * det;
  col *= 1.0 - 0.25 * tieM;
  col = mix(col, col * 0.55, joint * det);
  h -= (joint * 0.01 + tieM * 0.005) * det;
  return col;
}
vec3 bStone(vec2 uv, vec3 c, float mpp, bool alt, inout float h) {
  float det = 1.0 - smoothstep(0.012, 0.06, mpp);
  float ch = alt ? 0.42 : 0.55;
  float row = floor(uv.y / ch);
  float L = 0.9 + 0.5 * bN2(vec2(row, 1.7));
  float off = bN2(vec2(row, 9.1)) * L;
  float bx = (uv.x + off) / L;
  float col = floor(bx);
  vec2 f = vec2(fract(bx) * L, fract(uv.y / ch) * ch);
  float aa = mpp * 0.7;
  float jw = uv.y < 3.3 && alt ? 0.03 : 0.012;
  float edge = min(min(f.x, L - f.x), min(f.y, ch - f.y));
  float j = 1.0 - smoothstep(jw - aa, jw + aa, edge);
  vec3 sc = c * (0.88 + 0.2 * bN2(vec2(col, row))) * (0.93 + 0.12 * bFbm(uv * 3.0));
  vec3 res = mix(c * 0.97, mix(sc, c * 0.7, j), det);
  res *= mix(0.85, 1.0, smoothstep(0.0, 1.0, uv.y));
  h += (smoothstep(0.0, 0.06, edge) * 0.012 - j * 0.004) * det;
  return res;
}
`;

// Main surface pass (after <color_fragment>): fills bO from the vertex color.
const FRAG_MAIN = /* glsl */ `
#include <color_fragment>
#ifdef B_UBER
int bType = int(vBMat + 0.5);
#endif
vec3 bN = normalize(vBWNrm);
vec3 bV = normalize(vBWPos - cameraPosition);
float bNdV = clamp(dot(-bV, bN), 0.0, 1.0);
vec2 bUv = vBUv;
vec2 bDx = dFdx(bUv), bDy = dFdy(bUv);
float bMpp = max(max(length(vec2(bDx.x, bDy.x)), length(vec2(bDx.y, bDy.y))), 1e-5);
vec3 bDpx = dFdx(vBWPos), bDpy = dFdy(vBWPos);
uvec4 bInf = uvec4(vBInfo * 255.0 + 0.5);
uint bSeed = bInf.x | (bInf.y << 8u);
int bSchedId = int(bInf.z & 7u);
uint bStyle = (bInf.z >> 3u) & 7u;
uint bLitB = bInf.z >> 6u;
float bLitLvl = bLitB == 0u ? 0.0 : bLitB == 1u ? 0.45 : bLitB == 2u ? 1.0 : 1.2;
uint bCond = bInf.w;
float bNightOn = smoothstep(0.05, 0.65, uNight);
float bLitOn = (bLitB == 0u || (bCond & 19u) != 0u) ? 0.0 : 1.0;
vec3 bTw = abs(bN.y) < 0.97 ? normalize(cross(vec3(0.0, 1.0, 0.0), bN)) : vec3(1.0, 0.0, 0.0);
vec3 bBw = normalize(cross(bN, bTw));
float bSgn = dot(bDpx, bTw) * bDx.x + dot(bDpy, bTw) * bDy.x;
vec3 bTu = bSgn < 0.0 ? -bTw : bTw;
vec3 bRdT = vec3(dot(bV, bTu), dot(bV, bBw), dot(bV, bN));
uint bFace = uint(int(floor(atan(bN.z, bN.x) * 1.27324 + 4.5)) & 7);
BOut bO;
bO.alb = diffuseColor.rgb;
#ifdef B_UBER
bO.rough = B_ROUGH[bType];
bO.metal = B_METAL[bType];
#else
bO.rough = roughness;
bO.metal = metalness;
#endif
bO.emit = vec3(0.0);
bO.h = 0.0;
bO.refl = 0.0;
bO.f0 = 0.04;

#if BTYPE >= 1 && BTYPE <= 9
{
  float bay = 3.2, fh = 3.3, ww = 1.2, wh = 1.6, sill = 0.9;
  int kind = 1;
  uint flags = 0u;
  float rs = bHashF(bSeed, 11u, 5u);
  // style defaults (used by models that do not provide facade codes)
  if (bStyle == 1u) { ww = 1.12; wh = 1.9; sill = 0.8; flags = rs < 0.5 ? 1u : 64u; }
  else if (bStyle == 2u) { ww = 1.0; wh = 1.55; flags = rs < 0.5 ? 3u : 1u; }
  else if (bStyle == 3u) { ww = 1.05; wh = 1.35; flags = 4u; }
  else if (bStyle == 4u) { ww = 1.5; wh = 1.45; kind = 1; }
  else if (bStyle == 5u) { ww = 0.9; wh = 2.2; kind = 9; flags = 8u; }
  else if (bStyle == 6u) { ww = 2.4; wh = 2.1; sill = 0.5; flags = 8u; }
  else if (bStyle == 7u) { ww = 2.9; wh = 2.3; sill = 0.4; kind = 4; flags = 8u; }
  else { ww = 1.05; wh = 1.6; flags = rs < 0.35 ? 5u : 4u; }
#if BTYPE == 7
  ww = 2.5; wh = 2.0; sill = 0.8; kind = 1; flags = 8u;
#endif
#if BTYPE == 4
  if (bStyle < 5u) { ww = 1.7; wh = 1.5; kind = 1; flags = 8u; }
#endif
#ifdef B_FAC
  uvec4 fac = uvec4(vBFac * 255.0 + 0.5);
  if (fac.x != 0u) kind = int(fac.x);
  if (fac.y != 0u) ww = float(fac.y) / 64.0;
  if (fac.z != 0u) wh = float(fac.z) / 64.0;
  if (fac.x != 0u || fac.w != 0u) flags = fac.w;
  if (fac.z != 0u && kind != 5) sill = clamp((fh - wh) * 0.55, 0.12, 1.0);
#endif
  bool alt = (flags & 32u) != 0u;
#if BTYPE == 1
  bO.alb = bPlaster(bUv, bO.alb, bMpp, alt, bO.h);
#elif BTYPE == 2
  bO.alb = bBrick(bUv, bO.alb, bMpp, alt, bO.h);
#elif BTYPE == 3
  bO.alb = bWood(bUv, bO.alb, bMpp, alt, bO.h);
#elif BTYPE == 4
  bO.alb = bConcrete(bUv, bO.alb, bMpp, bay, fh, bO.h);
#elif BTYPE == 5
  bO.alb = bStone(bUv, bO.alb, bMpp, alt, bO.h);
#elif BTYPE == 7
  {
    // precast spandrels + piers
    float det = 1.0 - smoothstep(0.015, 0.06, bMpp);
    vec3 c = bO.alb * (0.95 + 0.07 * bFbm(bUv * 1.3));
    float fy = fract(bUv.y / fh) * fh;
    float band = 1.0 - smoothstep(0.0, 0.02 + bMpp, abs(fy - 0.02));
    c = mix(c, c * 0.8, band * det);
    bO.alb = c * mix(0.88, 1.0, smoothstep(0.0, 1.0, bUv.y));
    bO.h -= band * 0.008 * det;
  }
#endif

#if BTYPE == 1 || BTYPE == 2 || BTYPE == 3 || BTYPE == 4 || BTYPE == 5 || BTYPE == 7
  bWindows(bO, bUv, bay, fh, ww, wh, sill, kind, flags, bSeed, bFace, bSchedId == 0 && BTYPE == 7 ? 3 : bSchedId, bLitLvl, bCond, bStyle, bRdT, bNdV, bMpp, BTYPE);
#endif

#if BTYPE == 6
  {
    // glass curtain wall: panels, mullions, spandrels, per-panel distortion, interiors
    float panel = 1.6;
    float pu = bUv.x / panel;
    float pi = floor(pu);
    float px = fract(pu) * panel;
    float fl = floor(bUv.y / fh);
    float py = fract(bUv.y / fh) * fh;
    float aa = bMpp * 0.75 + 1e-4;
    float det = smoothstep(2.0, 7.0, panel / bMpp);
    float mull = bFill(min(px, panel - px) - 0.035, aa);
    float spH = 0.9;
    bool ribbon = false;
#ifdef B_FAC
    if (fac.x == 4u) ribbon = true;
    if (fac.z != 0u) spH = max(0.1, fh - wh);
#endif
    float trans = bFill(min(py, fh - py) - 0.04, aa);
    float spand = smoothstep(fh - spH - aa, fh - spH + aa, py);
    vec3 tint = bO.alb;
    vec3 mullCol = (flags & 8u) != 0u ? vec3(0.08, 0.085, 0.09) : bStyle == 7u ? vec3(0.85, 0.88, 0.9) : vec3(0.42, 0.44, 0.46);
    uint key = bSeed * 16u + bFace;
    float rLit = bHashF(bU(bUv.x / 3.2), bU(fl), key);
    float rCol = bHashF(bU(bUv.x / 3.2) + 7u, bU(fl), key);
    float rInt = bHashF(bU(bUv.x / 3.2), bU(fl) + 3u, key);
    int sched = bSchedId == 0 ? 3 : bSchedId;
    float occ = bSched(sched, uHour) * bLitLvl;
    float lit = step(rLit, occ * bNightOn) * bLitOn;
    vec3 lcol = bLightCol(rCol, sched);
    float inten = bLitInten(sched) * 0.85;
    float dayL = 1.0 - uNight * 0.97;
    float fres = 0.05 + 0.95 * pow(1.0 - bNdV, 5.0);
    vec2 rlp = vec2(mod(bUv.x, 3.2), py);
    vec3 ie = vec3(0.0);
    if (det > 0.001) ie = bInterior(rlp, 3.2, fh, bRdT, rInt, lit, lcol, inten, dayL, sched);
    float litAvg = mix(lit, occ * bNightOn * bLitOn, smoothstep(0.5, 0.15, 3.2 / (bMpp * 8.0)));
    ie = mix(lcol * inten * litAvg * 0.45 + tint * 0.05 * dayL, ie, det);
    if (sched == 3 && fract(rInt * 17.0) < 0.5 && det > 0.0) {
      float bl = 1.0 - (0.1 + fract(rInt * 7.0) * 0.5);
      float m = step(bl, (py - 0.0) / (fh - spH));
      ie = mix(ie, vec3(0.7) * (dayL * 0.25 + lit * lcol * inten * 0.5) * (0.8 + 0.2 * step(0.4, fract(py / 0.05))), m * det);
    }
    if ((bCond & 8u) != 0u && rInt < 0.8) ie = vec3(1.0, 0.35, 0.08) * (3.0 + 2.0 * bVN(vec2(uTime * 8.0 + rLit * 30.0, py)));
    bool broken = (bCond & 3u) != 0u;
    vec3 gAlb = tint * 0.55 + 0.03;
    float gRough = 0.035 + 0.05 * bN2(vec2(pi, fl));
    if (broken && bN2(vec2(pi, fl) + 5.0) < 0.45) { gAlb = vec3(0.01); gRough = 0.95; ie = vec3(0.0); }
    if ((bCond & 2u) != 0u) { gAlb *= 0.15; ie *= (bCond & 8u) != 0u ? 1.0 : 0.0; }
    float mS = ribbon ? spand : spand;
    vec3 sAlb = tint * 0.3 + 0.02;
    float mM = max(mull, trans) * det;
    bO.alb = mix(mix(gAlb, sAlb, mS), mullCol, mM);
    bO.rough = mix(mix(gRough, 0.25, mS), 0.35, mM);
    bO.metal = mix(1.0, 0.8, mM);
    bO.emit += ie * (1.0 - fres) * (1.0 - mS) * (1.0 - mM) * 0.9;
    bO.refl = 1.0 - mM * 0.8;
    bO.f0 = 0.3;
    float wob = (bN2(vec2(pi, fl)) - 0.5) * (px / panel - 0.5) + (bN2(vec2(fl, pi) + 7.0) - 0.5) * (py / fh - 0.5);
    bO.h += (wob * 0.05 + mM * 0.04) * det;
  }
#endif

#if BTYPE == 8
  {
    // storefront band: bulkhead, display glazing, doors, fascia sign, cornice
    bay = 4.5; fh = 4.5;
    vec2 cf = bUv / vec2(bay, fh);
    vec2 ci = floor(cf);
    vec2 lp = (cf - ci) * vec2(bay, fh);
    float aa = bMpp * 0.75 + 1e-4;
    float det = smoothstep(2.5, 8.0, bay / bMpp);
    uint key = bSeed * 16u + bFace;
    float grp = floor(ci.x / (1.0 + float(bSeed % 2u)));
    float rS = bHashF(bU(grp), 5u, key);
    float rD = bHashF(bU(ci.x), bU(ci.y), key);
    float rL = bHashF(bU(ci.x), 17u, key);
    vec3 wallC = bPlaster(bUv, bO.alb, bMpp, false, bO.h);
    bool ground = ci.y < 0.5;
    float pier = 0.22;
    float mBulk = step(lp.y, 0.45) * step(pier, lp.x) * step(lp.x, bay - pier);
    float mGl = bFill(bBox(lp, vec2(bay * 0.5, 1.85), vec2(bay * 0.5 - pier, 1.38)), aa);
    bool door = rD < 0.45 && ground;
    float mDoor = door ? bFill(bBox(lp, vec2(bay * 0.5, 1.25), vec2(0.55, 1.25)), aa) : 0.0;
    float mFr = mGl - bFill(bBox(lp, vec2(bay * 0.5, 1.85), vec2(bay * 0.5 - pier - 0.06, 1.32)), aa);
    mFr = max(mFr, bFill(abs(lp.x - bay * 0.5) - 0.03, aa) * mGl * (door ? 0.0 : 1.0));
    mFr = max(mFr, (mDoor - bFill(bBox(lp, vec2(bay * 0.5, 1.25), vec2(0.49, 1.19)), aa)));
    float mSign = ground ? bFill(bBox(lp, vec2(bay * 0.5, 3.87), vec2(bay * 0.5 - 0.05, 0.38)), aa) : 0.0;
    float mCorn = bFill(abs(lp.y - 4.38) - 0.12, aa);
    vec3 signCol = bHue(rS * 5.3) * 0.75 + 0.08;
    if (fract(rS * 3.1) < 0.3) signCol = vec3(0.06, 0.07, 0.08);
    vec3 letterCol = fract(rS * 3.1) < 0.3 ? bHue(rS * 2.1) * 0.5 + 0.5 : vec3(0.97);
    float lx = lp.x + ci.x * bay - grp * bay * (1.0 + float(bSeed % 2u));
    float letters = step(0.35, bN2(vec2(floor(lp.x * 3.2), grp * 13.0 + rS * 7.0))) * step(abs(lp.y - 3.87), 0.2) * step(abs(lp.x - bay * 0.5), bay * 0.36);
    letters *= step(0.18, fract(lp.x * 3.2));
    vec3 frameC = (bSeed & 4u) != 0u ? vec3(0.08, 0.08, 0.085) : vec3(0.55, 0.56, 0.58);
    // interior display
    int sched = 2;
    float nightOn = bNightOn;
    float occ = bSched(sched, uHour) * bLitLvl;
    float lit = max(step(rL, occ * nightOn), 0.35 * nightOn * step(rL, 0.8)) * bLitOn;
    vec3 lcol = bLightCol(rL, sched);
    float dayL = 1.0 - uNight * 0.97;
    vec3 ie = vec3(0.0);
    if (det > 0.001) ie = bInterior(lp - vec2(0.0, 0.0), bay, 3.4, bRdT, rD, lit, lcol, 2.6, dayL, 2);
    ie = mix(lcol * 2.2 * lit * 0.5 + vec3(0.05) * dayL, ie, det);
    if ((bCond & 8u) != 0u) ie = vec3(1.0, 0.35, 0.08) * (3.0 + 2.0 * bVN(vec2(uTime * 8.0 + rL * 30.0, lp.y)));
    float fres = 0.05 + 0.95 * pow(1.0 - bNdV, 5.0);
    vec3 gAlb = vec3(0.08, 0.1, 0.1);
    bool broken = (bCond & 3u) != 0u;
    if (broken) { gAlb = rD < 0.5 ? vec3(0.35, 0.27, 0.17) : vec3(0.01); ie = vec3(0.0); }
    vec3 c = wallC;
    c = mix(c, vec3(0.2, 0.2, 0.21) * (0.9 + 0.2 * bN2(floor(lp * 6.0))), mBulk);
    float mG = clamp(mGl - mFr, 0.0, 1.0);
    c = mix(c, gAlb, mG);
    c = mix(c, frameC, mFr);
    c = mix(c, mix(signCol, letterCol, letters), mSign * (broken ? 0.4 : 1.0));
    c = mix(c, wallC * 1.12 + 0.04, mCorn);
    bO.alb = mix(wallC * 0.7 + vec3(0.02, 0.025, 0.03), c, det);
    bO.rough = mix(bO.rough, 0.05, mG * det);
    bO.metal = mix(0.0, 1.0, mG * det * (broken ? 0.0 : 1.0));
    bO.refl = mG * det * (broken ? 0.0 : 1.0);
    bO.f0 = 0.08;
    bO.emit += ie * (1.0 - fres) * mG * det + ie * (1.0 - det) * 0.6;
    float signGlow = (0.12 + 2.6 * nightOn) * bLitOn * (broken ? 0.0 : 1.0);
    bO.emit += (letterCol * letters * 1.3 + signCol * 0.25) * signGlow * mSign * det;
    bO.h += (0.03 * mCorn + 0.015 * mSign + 0.02 * mFr - 0.06 * mG) * det;
  }
#endif

#if BTYPE == 9
  {
    // industrial cladding: corrugated ribs, seams, clerestory glazing, roll-up doors
    bay = 6.0; fh = 6.0;
    vec2 cf = bUv / vec2(bay, fh);
    vec2 ci = floor(cf);
    vec2 lp = (cf - ci) * vec2(bay, fh);
    float aa = bMpp * 0.75 + 1e-4;
    float det = 1.0 - smoothstep(0.02, 0.07, bMpp);
    uint key = bSeed * 16u + bFace;
    float rb = bHashF(bU(ci.x), bU(ci.y), key);
    float rib = 0.5 + 0.5 * sin(bUv.x * 34.9);
    vec3 c = bO.alb * mix(1.0, 0.9 + 0.12 * rib, det);
    c *= 0.9 + 0.16 * bFbm(vec2(bUv.x * 0.9, bUv.y * 0.12));
    float rust = smoothstep(0.62, 0.85, bFbm(vec2(bUv.x * 1.3, bUv.y * 0.35) + 3.0)) * smoothstep(3.0, 0.0, lp.y);
    c = mix(c, c * vec3(0.8, 0.62, 0.45), rust * 0.5);
    float seam = bFill(abs(lp.y - 0.02) - 0.03, aa);
    c = mix(c, c * 0.7, seam * det);
    bO.h += rib * 0.012 * det - seam * 0.01 * det;
    bool noWin = false;
#ifdef B_FAC
    noWin = fac.x == 6u;
#endif
    float mWin = (!noWin && rb < 0.7) ? bFill(bBox(lp, vec2(bay * 0.5, fh * 0.77), vec2(bay * 0.4, 0.55)), aa) : 0.0;
    float mWinF = mWin - ((!noWin && rb < 0.7) ? bFill(bBox(lp, vec2(bay * 0.5, fh * 0.77), vec2(bay * 0.4 - 0.06, 0.49)), aa) : 0.0);
    bool doorBay = ci.y < 0.5 && rb < 0.32 && !noWin;
    float mDoor = doorBay ? bFill(bBox(lp, vec2(bay * 0.5, 2.25), vec2(2.1, 2.25)), aa) : 0.0;
    float mDoorF = doorBay ? mDoor - bFill(bBox(lp, vec2(bay * 0.5, 2.2), vec2(1.95, 2.1)), aa) : 0.0;
    bool pDoor = ci.y < 0.5 && rb >= 0.32 && rb < 0.42 && !noWin;
    float mPD = pDoor ? bFill(bBox(lp, vec2(1.6, 1.1), vec2(0.5, 1.1)), aa) : 0.0;
    vec3 doorCol = fract(rb * 7.3) < 0.5 ? vec3(0.62, 0.64, 0.66) : fract(rb * 7.3) < 0.75 ? vec3(0.2, 0.32, 0.5) : vec3(0.85, 0.55, 0.12);
    float slat = 0.85 + 0.15 * step(0.5, fract(lp.y / 0.11));
    float occ = bSched(4, uHour) * bLitLvl;
    float lit = step(rb * 1.2, occ * bNightOn + 0.05 * bNightOn) * bLitOn;
    vec3 lcol = bLightCol(fract(rb * 13.0), 4);
    vec3 win = vec3(0.62, 0.7, 0.72);
    c = mix(c, win, (mWin - mWinF) * det);
    c = mix(c, vec3(0.3, 0.31, 0.32), mWinF * det);
    c = mix(c, doorCol * slat, (mDoor - mDoorF) * det);
    c = mix(c, vec3(0.9, 0.7, 0.1), mDoorF * det);
    c = mix(c, vec3(0.2, 0.22, 0.24), mPD * det);
    bO.alb = c;
    bO.rough = mix(bO.rough, 0.3, mWin * det);
    bO.metal = mix(bO.metal, 0.0, mWin * det);
    float lw = mix(mWin - mWinF, 0.12, 1.0 - det);
    bO.emit += lcol * 1.8 * lit * lw + lcol * 0.02 * bNightOn * lw * bLitOn;
    if ((bCond & 8u) != 0u) bO.emit += vec3(1.0, 0.35, 0.08) * 3.0 * lw * (0.6 + 0.4 * bVN(vec2(uTime * 7.0, rb * 10.0)));
    bO.h += (-0.05 * mDoor + slat * 0.004 * mDoor - 0.03 * mWin) * det;
  }
#endif
  // flood line / wet band near the ground
  if ((bCond & 4u) != 0u) {
    float wet = 1.0 - smoothstep(1.05, 1.15, bUv.y);
    bO.alb *= mix(1.0, 0.45, wet);
    bO.alb = mix(bO.alb, vec3(0.35, 0.3, 0.22), (1.0 - smoothstep(0.0, 0.05, abs(bUv.y - 1.1))) * 0.8);
    bO.rough = mix(bO.rough, 0.25, wet);
  }
}
#endif

#if BTYPE == 10
{
  float det = 1.0 - smoothstep(0.012, 0.045, bMpp);
  float rowH = 0.3;
  float row = floor(bUv.y / rowH);
  float fy = fract(bUv.y / rowH);
  float tw = 0.24;
  float tu = bUv.x / tw + mod(row, 2.0) * 0.5;
  float col = floor(tu);
  float fx = fract(tu);
  float prof = sin(fx * 3.14159);
  float var = bN2(vec2(col, row));
  vec3 c = bO.alb * mix(1.0, 0.8 + 0.34 * var, det);
  c *= mix(1.0, (0.78 + 0.22 * prof) * (1.0 - 0.32 * smoothstep(0.72, 1.0, fy)), det);
  c *= 0.84 + 0.26 * bFbm(bUv * 0.3);
  float moss = smoothstep(0.64, 0.82, bFbm(bUv * 0.7 + 5.0));
  c = mix(c, vec3(0.24, 0.27, 0.16), moss * 0.35);
  bO.alb = c;
  bO.h += (prof * 0.02 + fy * 0.018) * det;
}
#endif
#if BTYPE == 11
{
  float det = 1.0 - smoothstep(0.012, 0.05, bMpp);
  float sp = 0.45;
  float su = fract(bUv.x / sp) * sp;
  float aa = bMpp * 0.7 + 1e-4;
  float seam = bFill(min(su, sp - su) - 0.016, aa);
  float pnl = bN2(vec2(floor(bUv.x / sp), 3.0));
  vec3 c = bO.alb * (0.94 + 0.1 * pnl) * (0.95 + 0.08 * bFbm(bUv * vec2(0.3, 0.05)));
  c = mix(c, c * 1.18, seam * det);
  bO.alb = c;
  bO.h += seam * 0.03 * det;
  bO.rough = 0.32 + 0.1 * pnl;
}
#endif
#if BTYPE == 12
{
  float det = 1.0 - smoothstep(0.01, 0.04, bMpp);
  float grav = bVN(bUv * 22.0);
  float sheet = floor(bUv.x / 1.0);
  float aa = bMpp * 0.7 + 1e-4;
  float seam = bFill(abs(fract(bUv.x) - 0.5) - 0.49, aa);
  vec3 c = bO.alb * (0.9 + 0.12 * bFbm(bUv * 0.25)) * mix(1.0, 0.86 + 0.28 * grav, det);
  c *= 0.97 + 0.05 * bN2(vec2(sheet, 1.0));
  c = mix(c, c * 0.8, seam * det * 0.6);
  float stain = smoothstep(0.6, 0.8, bFbm(bUv * 0.18 + 9.0));
  c *= 1.0 - 0.18 * stain;
  bO.alb = c;
  bO.h += (grav - 0.5) * 0.004 * det;
}
#endif
#if BTYPE == 13
{
  float det = 1.0 - smoothstep(0.008, 0.035, bMpp);
  float rowH = 0.14;
  float row = floor(bUv.y / rowH);
  float fy = fract(bUv.y / rowH);
  float tu = bUv.x / 0.33 + mod(row, 2.0) * 0.5;
  float col = floor(tu);
  float fx = fract(tu);
  float aa = bMpp * 3.0 + 1e-3;
  float slot = 1.0 - smoothstep(0.0, 0.04 + aa, min(fx, 1.0 - fx));
  float var = bN2(vec2(col, row));
  vec3 c = bO.alb * mix(1.0, 0.72 + 0.5 * var, det);
  c *= mix(1.0, 1.0 - 0.35 * smoothstep(0.7, 1.0, fy) - 0.4 * slot * step(0.25, fy), det);
  c *= 0.9 + 0.16 * bVN(bUv * 40.0) * det + 0.1 * bFbm(bUv * 0.4);
  bO.alb = c;
  bO.h += fy * 0.01 * det;
}
#endif
#if BTYPE == 20
bO.alb *= 0.97 + 0.06 * bVN(bUv * 2.0);
#endif
#if BTYPE == 21
{
  bO.alb = bO.alb * 0.4 + 0.02;
  bO.refl = 1.0;
  bO.f0 = 0.12;
  float nightOn = bNightOn;
  bO.emit += bO.alb * 0.0 * nightOn;
}
#endif
#if BTYPE == 22
bO.alb *= 0.9 + 0.1 * bVN(vec2(bUv.x * 0.5, bUv.y * 24.0));
bO.refl = 0.35;
bO.f0 = 0.5;
#endif
#if BTYPE == 23
{
  float det = 1.0 - smoothstep(0.01, 0.04, bMpp);
  float pl = floor(bUv.y / 0.14);
  float fy = fract(bUv.y / 0.14);
  vec3 c = bO.alb * (0.86 + 0.2 * bN2(vec2(pl, floor(bUv.x / 2.3 + pl * 0.41))));
  c *= 0.9 + 0.14 * bVN(vec2(bUv.x * 2.0, pl * 5.0 + fy * 2.0));
  c *= mix(1.0, 1.0 - 0.3 * smoothstep(0.88, 1.0, fy), det);
  bO.alb = c;
  bO.h -= smoothstep(0.88, 1.0, fy) * 0.004 * det;
}
#endif
#if BTYPE == 24
{
  float det = 1.0 - smoothstep(0.01, 0.05, bMpp);
  bO.alb *= (0.9 + 0.14 * bFbm(bUv * 0.8)) * mix(1.0, 0.95 + 0.1 * bVN(bUv * 14.0), det);
  bO.alb *= 1.0 - 0.12 * smoothstep(0.6, 0.9, bVN(vec2(bUv.x * 2.5, bUv.y * 0.15)));
  bO.h += (bVN(bUv * 14.0) - 0.5) * 0.003 * det;
}
#endif
#if BTYPE == 25
{
  float det = 1.0 - smoothstep(0.01, 0.04, bMpp);
  vec2 p = vBWPos.xz;
  float sp = bVN(p * 9.0);
  bO.alb *= (0.9 + 0.16 * bFbm(p * 0.3)) * mix(1.0, 0.8 + 0.4 * sp, det);
  bO.alb *= 1.0 - 0.2 * smoothstep(0.66, 0.85, bFbm(p * 0.21 + 4.0));
  bO.h += (sp - 0.5) * 0.004 * det;
}
#endif
#if BTYPE == 26
{
  float det = 1.0 - smoothstep(0.008, 0.035, bMpp);
  vec2 p = vBWPos.xz;
  float row = floor(p.y / 0.3);
  float bx = p.x / 0.6 + mod(row, 2.0) * 0.5;
  vec2 f = vec2(fract(bx) * 0.6, fract(p.y / 0.3) * 0.3);
  float aa = bMpp * 0.7 + 1e-4;
  float j = 1.0 - smoothstep(0.008 - aa, 0.008 + aa, min(min(f.x, 0.6 - f.x), min(f.y, 0.3 - f.y)));
  vec3 c = bO.alb * (0.88 + 0.2 * bN2(vec2(floor(bx), row)));
  c = mix(c, c * 0.62, j);
  bO.alb = mix(bO.alb * 0.95, c, det) * (0.92 + 0.12 * bFbm(p * 0.2));
  bO.h -= j * 0.004 * det;
}
#endif
#if BTYPE == 27
{
  vec2 p = vBWPos.xz;
  float det = 1.0 - smoothstep(0.01, 0.05, bMpp);
  float n = bFbm(p * 0.25);
  vec3 c = bO.alb * (0.78 + 0.38 * n);
  c = mix(c, c * vec3(1.12, 1.05, 0.72), smoothstep(0.55, 0.8, bFbm(p * 0.09 + 11.0)) * 0.45);
  c *= mix(1.0, 0.85 + 0.3 * bVN(p * 18.0), det);
  c *= 0.97 + 0.05 * step(0.5, fract(dot(p, vec2(0.7, 0.7)) / 2.4));
  bO.alb = c;
  bO.h += (bVN(p * 18.0) - 0.5) * 0.006 * det;
}
#endif
#if BTYPE == 28
{
  vec3 wp = vBWPos;
  float n = bFbm(wp.xz * 0.9 + wp.y * 0.73);
  float n2 = bVN(wp.xz * 4.1 - wp.y * 3.3);
  vec3 c = bO.alb * (0.6 + 0.6 * n) * (0.88 + 0.24 * n2);
  c *= 0.8 + 0.35 * clamp(bN.y * 0.5 + 0.5, 0.0, 1.0);
  bO.alb = c;
  bO.h += (n2 - 0.5) * 0.05;
}
#endif
#if BTYPE == 29
bO.alb *= 0.75 + 0.4 * bVN(vec2(atan(bN.z, bN.x) * 4.0, vBWPos.y * 6.0));
#endif
#if BTYPE == 30
{
  vec2 p = vBWPos.xz;
  float t = uTime * 0.7;
  float ca = sin(p.x * 3.1 + sin(p.y * 2.3 + t) + t) * sin(p.y * 2.9 + sin(p.x * 1.7 - t * 1.1) - t);
  float caus = pow(abs(ca), 3.0);
  vec3 c = bO.alb * (0.75 + 0.5 * caus);
  bO.alb = c * 0.6;
  bO.refl = 1.0;
  bO.f0 = 0.02;
  bO.emit += bO.alb * (0.25 + 0.6 * caus) * bNightOn * bLitOn * 1.2 + c * 0.05 * (1.0 - uNight);
  bO.h += ca * 0.01;
}
#endif
#if BTYPE == 31
{
  vec2 p = vBWPos.xz;
  bO.alb *= (0.9 + 0.12 * bFbm(p * 0.4)) * (0.95 + 0.1 * bVN(p * 30.0));
  bO.h += sin(p.x * 3.0 + bVN(p * 0.5) * 6.0) * 0.004;
}
#endif
#if BTYPE == 32
{
  vec2 p = vBWPos.xz;
  float n = bFbm(p * 0.5);
  bO.alb *= (0.8 + 0.35 * n) * (0.9 + 0.2 * bVN(p * 12.0));
  float peb = step(0.82, bN2(floor(p * 7.0)));
  bO.alb = mix(bO.alb, bO.alb * 1.35, peb * 0.4);
  bO.h += (bVN(p * 12.0) - 0.5) * 0.01 + peb * 0.004;
}
#endif
#if BTYPE == 33
{
  float det = 1.0 - smoothstep(0.04, 0.2, bMpp);
  float sp = 0.8;
  float fx = fract(bUv.x / sp);
  float rowM = smoothstep(0.08, 0.2, fx) * (1.0 - smoothstep(0.62, 0.74, fx));
  vec2 p = vBWPos.xz;
  float leaves = bVN(vec2(bUv.x * 9.0, bUv.y * 5.0));
  vec3 plant = bO.alb * (0.75 + 0.45 * leaves) * (0.85 + 0.3 * bFbm(p * 0.05));
  vec3 soil = vec3(0.3, 0.22, 0.15) * (0.85 + 0.25 * bVN(p * 3.0));
  vec3 c = mix(soil, plant, rowM);
  bO.alb = mix(mix(soil, plant, 0.62), c, det);
  bO.h += rowM * 0.08 * det;
}
#endif
#if BTYPE == 34
{
  float on = bLitOn;
  bO.emit += bO.alb * (0.12 + 2.3 * bNightOn) * on;
}
#endif
#if BTYPE == 35
{
  uint k = bSeed * 16u + bFace;
  float r = bHashF(k, 3u, bU(vBWPos.y * 0.2));
  float fl = r < 0.08 ? step(0.25, bVN(vec2(uTime * 11.0, r * 40.0))) : 1.0;
  bO.emit += bO.alb * (0.7 + 3.1 * bNightOn) * fl * bLitOn;
  bO.alb *= 0.55;
}
#endif
#if BTYPE == 36
{
  float det = 1.0 - smoothstep(0.006, 0.03, bMpp);
  vec2 cell = fract(bUv / vec2(0.165, 0.165));
  float aa = bMpp * 6.0 + 0.02;
  float grid = 1.0 - smoothstep(0.03, 0.03 + aa, min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y)));
  vec2 pc = fract(bUv / vec2(1.0, 1.7));
  float frame = 1.0 - smoothstep(0.015, 0.015 + bMpp * 2.0, min(min(pc.x, 1.0 - pc.x) * 1.0, min(pc.y, 1.0 - pc.y) * 1.7));
  vec3 cellC = vec3(0.04, 0.07, 0.16) * (0.85 + 0.3 * bN2(floor(bUv / vec2(1.0, 1.7))));
  vec3 c = mix(cellC, vec3(0.5, 0.52, 0.55), grid * 0.35 * det);
  c = mix(c, vec3(0.75, 0.76, 0.78), frame * det);
  bO.alb = mix(vec3(0.07, 0.09, 0.16), c, det);
  bO.refl = 1.0 - frame * 0.5;
  bO.f0 = 0.1;
  bO.metal = 1.0 - frame;
  bO.rough = 0.12 + frame * 0.3;
}
#endif

#if BTYPE == 40
{
  // LOD boxes: roofs keep vertex color, walls get a simplified window grid
  if (abs(bN.y) < 0.5) {
    uint ft = 0u;
#ifdef B_FAC
    ft = uint(vBFac.x * 255.0 + 0.5);
#endif
    if (ft != 0u) {
      float bay = 3.2, fh = 3.3, ww = 1.3, wh = 1.6, sill = 0.9;
      int sched = bSchedId;
      if (ft == 2u) { ww = 2.5; wh = 2.0; sched = sched == 0 ? 3 : sched; }
      else if (ft == 3u) { ww = 3.0; wh = 2.4; sill = 0.1; sched = sched == 0 ? 3 : sched; }
      else if (ft == 5u) { bay = 6.0; fh = 6.0; ww = 4.8; wh = 1.1; sill = 4.1; }
      else if (ft == 6u) { ww = 1.1; wh = 1.3; }
      bool shopRow = ft == 4u && bUv.y < 4.5;
      if (shopRow) { bay = 4.5; fh = 4.5; ww = 4.0; wh = 2.8; sill = 0.45; sched = 2; }
      vec2 cf = bUv / vec2(bay, fh);
      vec2 ci = floor(cf);
      vec2 lp = (cf - ci) * vec2(bay, fh);
      float aa = bMpp * 0.75 + 1e-4;
      float m = bFill(bBox(lp, vec2(bay * 0.5, sill + wh * 0.5), vec2(ww * 0.5, wh * 0.5)), aa);
      float area = ww * wh / (bay * fh);
      float px = bay / bMpp;
      float cellMode = smoothstep(5.0, 2.0, px);
      m = mix(m, area, cellMode);
      uint key = bSeed * 16u + bFace;
      float rl = bHashF(bU(ci.x), bU(ci.y), key);
      float rc = bHashF(bU(ci.x) + 9u, bU(ci.y), key);
      float occ = bSched(sched, uHour) * bLitLvl;
      float lit = step(rl, occ * bNightOn);
      lit = mix(lit, occ * bNightOn, smoothstep(2.5, 0.8, px));
      lit *= bLitOn;
      if (ci.y < 0.0) lit = 0.0;
      vec3 lcol = bLightCol(rc, sched);
      vec3 gl = ft == 3u ? bO.alb * 0.5 : vec3(0.08, 0.1, 0.11);
      if (ft == 3u) {
        m = mix(0.85, m, 0.3);
        bO.alb = mix(bO.alb * 0.4, gl, 0.6);
      } else {
        bO.alb = mix(bO.alb, gl, m);
      }
      bO.metal = mix(0.0, 0.8, m);
      bO.rough = mix(0.8, 0.12, m);
      bO.refl = m;
      bO.f0 = ft == 3u ? 0.25 : 0.08;
      float inten = shopRow ? 2.4 : bLitInten(sched);
      bO.emit += lcol * inten * lit * m * 0.85 + vec3(0.05, 0.045, 0.04) * m * (1.0 - uNight);
      if ((bCond & 8u) != 0u) bO.emit += vec3(1.0, 0.35, 0.08) * 2.5 * m;
    }
    if ((bCond & 3u) != 0u) bO.alb *= 0.55;
  }
}
#endif
// ── building state tints (all materials) ──
if ((bCond & 1u) != 0u) {
  // abandoned: grime, desaturation, dead signage
  float g = bFbm(vBWPos.xz * 0.21 + vec2(vBWPos.y * 0.37));
  float l = bLum(bO.alb);
  bO.alb = mix(bO.alb, vec3(l), 0.4) * (0.7 + 0.16 * g);
  float streaks = smoothstep(0.45, 0.85, bVN(vec2(dot(vBWPos.xz, vec2(0.7, 0.7)) * 1.7, vBWPos.y * 0.25)));
  bO.alb = mix(bO.alb, vec3(0.2, 0.18, 0.14), 0.22 * streaks);
  bO.emit *= 0.15;
  bO.refl *= 0.5;
}
if ((bCond & 2u) != 0u) {
  // burned: charred, sooty, matte
  float s = bFbm(vBWPos.xz * 0.35 + vec2(vBWPos.y * 0.45));
  bO.alb = mix(bO.alb * 0.2, vec3(0.025, 0.022, 0.02), smoothstep(0.3, 0.7, s));
  bO.rough = 0.95;
  bO.metal = 0.0;
  bO.refl *= 0.05;
  if ((bCond & 8u) == 0u) bO.emit *= 0.0;
  else bO.emit += vec3(1.0, 0.28, 0.05) * 0.8 * smoothstep(0.55, 0.8, s) * (0.6 + 0.4 * bVN(vec2(uTime * 5.0, vBWPos.y)));
}
if ((bCond & 4u) != 0u) {
  // flooded: soaked dark band under a ragged waterline, silt stain above,
  // wet sheen; lot surfaces get puddles
  float wob = bVN(vec2(dot(vBWPos.xz, vec2(0.6, 0.8)) * 0.9, 3.7));
#if BTYPE >= 1 && BTYPE <= 9
  float wl = 1.15 + 0.12 * wob;
  float aaw = 0.015 + bMpp;
  float below = 1.0 - smoothstep(wl - aaw, wl + aaw, bUv.y);
  float stain = (1.0 - smoothstep(wl, wl + 0.55, bUv.y)) * (1.0 - below);
  float line = (1.0 - smoothstep(0.0, 0.03 + bMpp, abs(bUv.y - wl - 0.04)));
  bO.alb = mix(bO.alb, bO.alb * vec3(0.3, 0.29, 0.25), below);
  bO.alb = mix(bO.alb, bO.alb * vec3(0.74, 0.67, 0.55), stain * 0.55);
  bO.alb = mix(bO.alb, vec3(0.28, 0.24, 0.18), line * 0.6);
  bO.rough = mix(bO.rough, 0.22, below);
  bO.refl = max(bO.refl, 0.3 * below);
  bO.emit *= 1.0 - below;
#elif (BTYPE >= 25 && BTYPE <= 27) || BTYPE == 32
  if (bN.y > 0.9) {
    float pud = smoothstep(0.42, 0.6, bFbm(vBWPos.xz * 0.12));
    bO.alb = mix(bO.alb * 0.62, vec3(0.16, 0.15, 0.12), pud * 0.7);
    bO.rough = mix(bO.rough, 0.08, pud);
    bO.refl = max(bO.refl, 0.55 * pud);
    bO.f0 = mix(bO.f0, 0.03, pud);
  }
#endif
}
if ((bCond & 8u) != 0u) {
  // on fire: flickering orange glow washing over the surfaces
  float fl = 0.55 + 0.45 * bVN(vec2(uTime * 6.0 + vBWPos.x * 0.2, vBWPos.y * 0.4 - uTime * 2.0));
  bO.emit += vec3(1.0, 0.36, 0.08) * 0.22 * fl * max(0.2, 1.0 - abs(bN.y));
}
diffuseColor.rgb = bO.alb;
`;

const FRAG_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = bO.rough;
`;
const FRAG_METAL = /* glsl */ `
#include <metalnessmap_fragment>
metalnessFactor = bO.metal;
`;
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
vec3 bNW = bN;
{
  float dhx = dFdx(bO.h), dhy = dFdy(bO.h);
  vec3 r1 = cross(bDpy, bN), r2 = cross(bN, bDpx);
  float det = dot(bDpx, r1);
  if (abs(det) > 1e-12) {
    vec3 grad = (det < 0.0 ? -1.0 : 1.0) * (dhx * r1 + dhy * r2);
    bNW = normalize(abs(det) * bN - grad);
  }
  normal = normalize((viewMatrix * vec4(bNW, 0.0)).xyz);
}
`;
const FRAG_EMIT = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += bO.emit;
#ifndef USE_ENVMAP
if (bO.refl > 0.001) {
  vec3 rdir = reflect(bV, bNW);
  float nv = clamp(dot(-bV, bNW), 0.0, 1.0);
  float F = bO.f0 + (1.0 - bO.f0) * pow(1.0 - nv, 5.0);
  totalEmissiveRadiance += bSky(rdir) * F * bO.refl * (1.0 - bO.rough) * 0.85;
}
#endif
`;

// ── material construction ───────────────────────────────────────────────────
interface Variant {
  anim: boolean;
}

/** material type id of the chunk "uber" material (type chosen per vertex via aMat) */
const UBER = -1;

/** Convert the compile-time `#if BTYPE …` dispatch of FRAG_MAIN into runtime
 *  branches on `bType` (flat per-triangle, so branches stay coherent). */
function toRuntime(src: string): string {
  const out: string[] = [];
  const stack: boolean[] = [];
  const cond = (l: string) => l.replace(/^#(el)?if\s+/, '').replace(/\bBTYPE\b/g, 'bType');
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (/^#if\s.*\bBTYPE\b/.test(l)) {
      stack.push(true);
      out.push(`if (${cond(l)}) {`);
    } else if (/^#elif\s.*\bBTYPE\b/.test(l)) {
      out.push(`} else if (${cond(l)}) {`);
    } else if (/^#else\b/.test(l) && stack[stack.length - 1]) {
      out.push('} else {');
    } else if (/^#if(n?def)?\b/.test(l)) {
      stack.push(false);
      out.push(raw);
    } else if (/^#endif\b/.test(l)) {
      out.push(stack.pop() ? '}' : raw);
    } else out.push(raw.replace(/\bBTYPE\b/g, 'bType'));
  }
  return out.join('\n');
}

let FRAG_MAIN_RT: string | null = null;
let RM_TABLES: string | null = null;
function roughMetalTables(): string {
  if (RM_TABLES) return RM_TABLES;
  const n = LOD_TYPE + 1;
  const r = new Array<number>(n).fill(0.8), m = new Array<number>(n).fill(0);
  for (const k of MAT_KEYS) {
    const sp = SPECS[k];
    r[sp.type] = sp.rough;
    m[sp.type] = sp.metal;
  }
  const f = (v: number) => v.toFixed(3);
  RM_TABLES = `const float B_ROUGH[${n}] = float[${n}](${r.map(f).join(',')});\nconst float B_METAL[${n}] = float[${n}](${m.map(f).join(',')});\n`;
  return RM_TABLES;
}

function patchShader(shader: THREE.WebGLProgramParametersWithUniforms, type: number, fac: boolean, v: Variant): void {
  Object.assign(shader.uniforms, U);
  shader.defines = shader.defines ?? {};
  const uber = type === UBER;
  if (uber) {
    shader.defines.B_UBER = '';
    shader.defines.B_FAC = '';
  } else {
    shader.defines.BTYPE = type;
    if (fac) shader.defines.B_FAC = '';
  }
  if (v.anim) shader.defines.B_ANIM = '';
  if (uber && !FRAG_MAIN_RT) FRAG_MAIN_RT = toRuntime(FRAG_MAIN);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <begin_vertex>', VERT_BEGIN)
    .replace('#include <worldpos_vertex>', VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS + (uber ? roughMetalTables() : ''))
    .replace('#include <color_fragment>', uber ? FRAG_MAIN_RT! : FRAG_MAIN)
    .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
    .replace('#include <metalnessmap_fragment>', FRAG_METAL)
    .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
    .replace('#include <emissivemap_fragment>', FRAG_EMIT);
}

function makeMaterial(name: string, type: number, rough: number, metal: number, v: Variant): THREE.MeshStandardMaterial {
  const fac = (type >= 1 && type <= 9) || type === LOD_TYPE || type === UBER;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
  m.name = `bld:${name}${v.anim ? ':anim' : ''}`;
  const defaults: Record<string, number[]> = { aInfo: DEFAULT_INFO };
  if (fac) defaults.aFac = [0, 0, 0, 0];
  if (type === UBER) defaults.aMat = [SPECS.plain.type];
  if (v.anim) {
    defaults.aPivot = [0, 0, 0];
    defaults.aAxis = [0, 1, 0];
    defaults.aAnim = [0, 0, 0];
  }
  (m as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = defaults;
  m.onBeforeCompile = (shader) => patchShader(shader, type, fac, v);
  m.customProgramCacheKey = () => `bld-${type}-${fac ? 1 : 0}-${v.anim ? 1 : 0}`;
  return m;
}

function makeDepthMaterial(dist: boolean): THREE.Material {
  const base = dist ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uAnimTime = U.uAnimTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aPivot;
attribute vec3 aAxis;
attribute vec3 aAnim;
uniform float uAnimTime;
vec3 bRot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float a = aAnim.y > 0.0 ? aAnim.y * sin(uAnimTime * aAnim.x + aAnim.z) : uAnimTime * aAnim.x + aAnim.z;
  transformed = aPivot + bRot(transformed - aPivot, normalize(aAxis), a);
}`);
  };
  base.customProgramCacheKey = () => `bld-depth-anim-${dist ? 1 : 0}`;
  return base;
}

const cache = new Map<MatKey, THREE.Material>();
const animCache = new Map<MatKey, THREE.Material>();
let lodMat: THREE.MeshStandardMaterial | null = null;
let depthAnim: THREE.Material | null = null;
let distAnim: THREE.Material | null = null;
const ghosts: THREE.ShaderMaterial[] = [];

/** Get the shared material for a key (vertex colors enabled). */
export function getMaterial(key: MatKey): THREE.Material {
  let m = cache.get(key);
  if (!m) {
    const s = SPECS[key] ?? SPECS.plain;
    m = makeMaterial(key, s.type, s.rough, s.metal, { anim: false });
    cache.set(key, m);
  }
  return m;
}

/** Variant of a material whose vertices rotate about per-vertex pivots
 *  (attributes aPivot, aAxis, aAnim = [speed rad/s, rock amplitude (0 = spin), phase]). */
export function getAnimMaterial(key: MatKey): THREE.Material {
  let m = animCache.get(key);
  if (!m) {
    const s = SPECS[key] ?? SPECS.plain;
    m = makeMaterial(key, s.type, s.rough, s.metal, { anim: true });
    animCache.set(key, m);
  }
  return m;
}

/** Shadow depth materials matching getAnimMaterial vertex motion. */
export function getAnimDepthMaterials(): { depth: THREE.Material; distance: THREE.Material } {
  if (!depthAnim) depthAnim = makeDepthMaterial(false);
  if (!distAnim) distAnim = makeDepthMaterial(true);
  return { depth: depthAnim, distance: distAnim };
}

let uberMat: THREE.MeshStandardMaterial | null = null;
let uberAnimMat: THREE.MeshStandardMaterial | null = null;

/** Numeric shader type of a material key (the per-vertex `aMat` value for chunk meshes). */
export function matTypeId(key: MatKey): number {
  return (SPECS[key] ?? SPECS.plain).type;
}
/** aMat value for far-LOD box geometry drawn with the chunk material. */
export const LOD_MAT_ID = LOD_TYPE;

/** Single "uber" material used by merged building chunks: the surface type is
 *  chosen per vertex (attribute `aMat`, see matTypeId) so a whole chunk — any
 *  mix of walls, roofs, glass, ground and LOD boxes — renders in ONE draw call.
 *  `anim` adds the vertex-rotation attributes of getAnimMaterial. */
export function getChunkMaterial(anim = false): THREE.Material {
  if (anim) return (uberAnimMat ??= makeMaterial('chunk', UBER, 0.8, 0, { anim: true }));
  return (uberMat ??= makeMaterial('chunk', UBER, 0.8, 0, { anim: false }));
}

/** Material for merged far-LOD boxes (vertex color walls/roofs + simplified lit window grid from aFac.x). */
export function getLodMaterial(): THREE.Material {
  if (!lodMat) lodMat = makeMaterial('lod', LOD_TYPE, 0.8, 0, { anim: false });
  return lodMat;
}

function skyColors(night: number, hour: number): void {
  const day = 1 - night;
  // warm tint near sunrise/sunset
  const dusk = Math.max(0, 1 - Math.min(Math.abs(hour - 6.5), Math.abs(hour - 19)) / 1.6) * (1 - night * 0.6);
  U.uSkyZenith.value.setRGB(0.012 + 0.2 * day, 0.018 + 0.38 * day, 0.04 + 0.72 * day);
  U.uSkyHorizon.value.setRGB(0.02 + 0.7 * day + 0.35 * dusk, 0.025 + 0.78 * day + 0.1 * dusk, 0.05 + 0.88 * day - 0.2 * dusk);
  U.uSkyGround.value.setRGB(0.01 + 0.26 * day, 0.012 + 0.25 * day, 0.012 + 0.23 * day);
}

/** Called every frame by BuildingRenderer: night 0..1 drives lit windows/emissives.
 *  `hour` (0..24) drives the per-use occupancy schedules; `animTime` drives
 *  vertex-animated parts (defaults to timeSec). */
export function updateMaterials(night: number, timeSec: number, hour?: number, animTime?: number): void {
  U.uNight.value = night;
  U.uTime.value = timeSec % 3600;
  const h = hour ?? (night > 0.5 ? 22 : 12);
  U.uHour.value = h;
  U.uAnimTime.value = (animTime ?? timeSec) % 36000;
  skyColors(night, h);
  const pulse = 0.5 + 0.5 * Math.sin(timeSec * 4);
  for (const g of ghosts) g.uniforms.uPulse.value = pulse;
  for (const g of ghosts) g.uniforms.uTime.value = timeSec % 1000;
}

/** Current values of the shared building uniforms (read-only use). */
export function materialUniforms(): { night: number; hour: number; time: number } {
  return { night: U.uNight.value, hour: U.uHour.value, time: U.uTime.value };
}

// ── ghost (placement preview) ───────────────────────────────────────────────
const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;
const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPulse;
uniform float uTime;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vW;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float lamb = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.4, 0.8, 0.3))), 0.0);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.5);
  float scan = smoothstep(0.85, 1.0, fract(vW.y * 0.25 - uTime * 0.6)) * 0.35;
  vec3 c = uColor * lamb + uColor * rim * 1.2 + vec3(scan) * uColor;
  gl_FragColor = vec4(c, uOpacity * (0.75 + 0.25 * uPulse) + rim * 0.25);
}
`;

function makeGhost(valid: boolean): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(valid ? 0x5cc8ff : 0xff4a4a) },
      uPulse: { value: 0.5 },
      uTime: { value: 0 },
      uOpacity: { value: 0.42 },
    },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  m.name = valid ? 'bld:ghost-valid' : 'bld:ghost-invalid';
  return m;
}

/** Translucent ghost material for placement previews (valid = green/blue, invalid = red). Shared instances. */
export function ghostMaterial(valid: boolean): THREE.Material {
  const i = valid ? 0 : 1;
  if (!ghosts[i]) ghosts[i] = makeGhost(valid);
  return ghosts[i];
}

/** Depth-only pre-pass material so ghosts show only their front-most surface. */
let ghostDepth: THREE.MeshBasicMaterial | null = null;
export function ghostDepthMaterial(): THREE.Material {
  if (!ghostDepth) {
    ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    ghostDepth.name = 'bld:ghost-depth';
  }
  return ghostDepth;
}

/** Release GPU programs of every cached material (world teardown keeps them; call on full shutdown). */
export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  for (const m of animCache.values()) m.dispose();
  cache.clear();
  animCache.clear();
  lodMat?.dispose();
  lodMat = null;
  uberMat?.dispose();
  uberAnimMat?.dispose();
  uberMat = uberAnimMat = null;
  depthAnim?.dispose();
  distAnim?.dispose();
  depthAnim = distAnim = null;
  for (const g of ghosts) g?.dispose();
  ghosts.length = 0;
  ghostDepth?.dispose();
  ghostDepth = null;
}
