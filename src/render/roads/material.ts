// The single material used by every road chunk mesh: a MeshStandardMaterial
// (so sun, shadows, environment, fog and tone mapping match the rest of the
// scene) whose albedo / roughness / metalness / normal are computed per
// fragment from a per-vertex attribute:
//
//   aRoad = (s, t, hw, code)
//     s     lateral offset (m) from the center line, + = right of +t
//     t     distance along the piece (m, 0..16 per cell)
//     hw    local carriageway half width (m)
//     code  kind + 16 * style + 256 * flags  (see profiles.ts)
//
// Lane markings, crosswalks, stop lines, tram rails and far-LOD rail tracks are
// all analytic (fwidth anti-aliased), so they stay crisp at any zoom and never
// z-fight. Weather (wet sheen, puddles, snow with plowed lanes) is driven by
// uniforms.
import * as THREE from 'three';
import { DETAIL_TILE, MACRO_TILE, roadTextures } from './textures';

export interface RoadUniforms {
  uDetail: { value: THREE.Texture };
  uMacro: { value: THREE.Texture };
  uWet: { value: number };
  uSnow: { value: number };
  uLeftHand: { value: number };
  uGrass: { value: THREE.Color };
  uGrassDry: { value: THREE.Color };
}

const PARS = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uMacro;
uniform float uWet;
uniform float uSnow;
uniform float uLeftHand;
uniform vec3 uGrass;
uniform vec3 uGrassDry;
varying vec4 vRoad;
varying vec3 vRWPos;
varying vec3 vRWNormal;

float rBit(float flags, float bit) { return mod(floor(flags / bit + 0.001), 2.0); }
float rBand(float x, float halfW) {
  float w = max(fwidth(x) * 0.75, 1e-4);
  return 1.0 - smoothstep(halfW - w, halfW + w, abs(x));
}
// dash centered on multiples of period/2 (odd), symmetric under t -> 16 - t
float rDash(float t, float period, float len) {
  float m = mod(t, period) - period * 0.5;
  float w = max(fwidth(t) * 0.75, 1e-4);
  return 1.0 - smoothstep(len * 0.5 - w, len * 0.5 + w, abs(m));
}
float rRange(float x, float a, float b) {
  float w = max(fwidth(x) * 0.5, 1e-4);
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}
// two rails of one track centered at lateral c (x = lateral coordinate)
float rRails(float x, float c, float hw) { return max(rBand(x - c - 0.7175, hw), rBand(x - c + 0.7175, hw)); }
// flangeway grooves on the gauge side of both rails of a track at c
float rGrooves(float x, float c) { return max(rBand(x - c - 0.6475, 0.028), rBand(x - c + 0.6475, 0.028)); }

// lane markings: returns (white, yellow) paint coverage
vec2 rMarks(float style, float flags, float s, float t, float hw) {
  if (rBit(flags, 1.0) < 0.5) return vec2(0.0);
  float as = abs(s);
  float side = uLeftHand > 0.5 ? -1.0 : 1.0; // incoming lanes at t=0 lie on s*side < 0
  float x0 = rBit(flags, 2.0), x1 = rBit(flags, 4.0), mid = rBit(flags, 8.0), taper = rBit(flags, 16.0);
  float lane = 1.0, edge = 1.0;
  if (x0 > 0.5) { lane *= step(4.45, t); edge *= step(3.55, t); }
  if (x1 > 0.5) { lane *= step(t, 11.55); edge *= step(t, 12.45); }
  if (mid > 0.5) { lane *= 1.0 - rRange(t, 5.75, 10.25); edge *= 1.0 - rRange(t, 6.45, 9.55); }
  float white = 0.0, yellow = 0.0;
  float inner = 0.0; // start of the zebra / stop line across the carriageway
  if (style < 2.5) { // street
    white += rBand(s, 0.06) * rDash(t, 8.0, 3.0) * lane;
    white += rBand(as - (hw - 0.35), 0.06) * edge;
  } else if (style < 3.5 || style > 7.5) { // avenue & tram avenue
    yellow += rBand(as - 0.13, 0.05) * lane;
    float dv = 0.23 + (hw - 0.58) * 0.5;
    if (taper < 0.5) white += rBand(as - dv, 0.06) * rDash(t, 8.0, 3.0) * lane;
    white += rBand(as - (hw - 0.35), 0.07) * edge;
  } else if (style < 4.5) { // boulevard (median island |s| < 1)
    inner = 1.0;
    white += rBand(as - 1.25, 0.06) * edge;
    float lw = (hw - 1.6) / 3.0;
    if (taper < 0.5) {
      white += rBand(as - 1.25 - lw, 0.06) * rDash(t, 8.0, 3.0) * lane;
      white += rBand(as - 1.25 - 2.0 * lw, 0.06) * rDash(t, 8.0, 3.0) * lane;
    }
    white += rBand(as - (hw - 0.35), 0.07) * edge;
  } else if (style < 5.5) { // highway
    inner = 0.4;
    yellow += rBand(as - 0.8, 0.075) * edge;
    float lw = (hw - 1.5) / 3.0;
    if (taper < 0.5) {
      white += rBand(as - 0.8 - lw, 0.075) * rDash(t, 16.0, 5.0) * lane;
      white += rBand(as - 0.8 - 2.0 * lw, 0.075) * rDash(t, 16.0, 5.0) * lane;
    }
    white += rBand(as - (hw - 0.7), 0.09) * edge;
  }
  // zebra crossings + stop lines (not on highways)
  if (style < 4.5 || style > 7.5) {
    float across = step(as, hw - 0.3) * step(inner, as);
    float zebra = rBand(mod(s + 0.25, 1.0) - 0.5, 0.27) * across;
    if (x0 > 0.5) {
      white += zebra * rRange(t, 0.6, 3.4);
      white += rRange(t, 3.95, 4.35) * step(s * side, -0.12) * across;
    }
    if (x1 > 0.5) {
      white += zebra * rRange(t, 12.6, 15.4);
      white += rRange(t, 11.65, 12.05) * step(0.12, s * side) * across;
    }
    if (mid > 0.5) {
      white += zebra * rRange(t, 6.6, 9.4);
      white += rRange(t, 5.95, 6.3) * step(0.12, s * side) * across;
      white += rRange(t, 9.7, 10.05) * step(s * side, -0.12) * across;
    }
  }
  return clamp(vec2(white, yellow), 0.0, 1.0);
}

// embedded track rails in a junction cell (world-local coords luv in [0,16]^2)
float rJunctionRails(vec2 luv, float jf, float c, float w) {
  float m = 0.0;
  if (rBit(jf, 1.0) > 0.5) { float x = 8.0 - luv.x; m = max(m, max(rRails(x, c, w), rRails(x, -c, w))); }
  if (rBit(jf, 2.0) > 0.5) { float x = luv.y - 8.0; m = max(m, max(rRails(x, c, w), rRails(x, -c, w))); }
  vec2 k[4];
  k[0] = vec2(16.0, 0.0); k[1] = vec2(16.0, 16.0); k[2] = vec2(0.0, 16.0); k[3] = vec2(0.0, 0.0);
  for (int q = 0; q < 4; q++) {
    float bit = pow(2.0, float(q) + 2.0);
    if (rBit(jf, bit) < 0.5) continue;
    vec2 d = luv - k[q];
    // only the quarter-disc inside the cell around that corner
    float r = length(d) - 8.0;
    m = max(m, max(rRails(r, c, w), rRails(r, -c, w)));
  }
  return m;
}

vec3 rSnowCol() { return vec3(0.80, 0.84, 0.90); }

vec3 roadPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

const SURFACE = /* glsl */ `
  float rCode = floor(vRoad.w + 0.5);
  float rKind = mod(rCode, 16.0);
  float rStyle = mod(floor(rCode / 16.0 + 0.001), 16.0);
  float rFlags = floor(rCode / 256.0 + 0.001);
  float rs = vRoad.x, rt = vRoad.y, rhw = vRoad.z;
  bool rVert = abs(vRWNormal.y) < 0.55;
  vec2 rUV = rVert ? vec2(vRWPos.x + vRWPos.z, vRWPos.y) : vRWPos.xz;
  vec4 rD = texture2D(uDetail, rUV / ${DETAIL_TILE.toFixed(1)});
  vec4 rM = texture2D(uMacro, rUV / ${MACRO_TILE.toFixed(1)});
  vec2 rLocal = mod(vRWPos.xz, 16.0);
  bool rJunc = rStyle > 8.5 && rStyle < 9.5;
  float rPix = length(fwidth(vRWPos));
  float rBumpFade = 1.0 - smoothstep(0.015, 0.06, rPix);
  vec3 rCol = vec3(0.1);
  float rRough = 0.9, rMetal = 0.0, rBumpH = 0.0, rBumpK = 0.0;
  float rPorous = 1.0;   // how much rain darkens it
  float rPuddle = 0.0;   // puddle potential
  float rSnowK = 0.0;    // snow accumulation
  float rWetGloss = 0.3; // roughness when fully wet
  if (rKind < 0.5) {
    // ── asphalt ──
    float grain = rD.r;
    rCol = vec3(0.070, 0.072, 0.077) * (0.72 + 0.62 * grain) * (0.86 + 0.28 * rM.r);
    float patchK = rM.g * (rJunc ? 0.6 : 1.0);
    rCol = mix(rCol, vec3(0.045, 0.046, 0.05) * (0.85 + 0.3 * grain), patchK * 0.85);
    rCol *= 1.0 - 0.55 * rM.b * (1.0 - patchK);
    float as = abs(rs);
    if (!rJunc && rStyle > 1.5 && rStyle < 8.5) {
      // lane wear: oil drip stripe in lane centers, polished wheel paths
      float lw = rStyle > 4.5 && rStyle < 5.5 ? (rhw - 1.5) / 3.0 : rStyle > 3.5 && rStyle < 4.5 ? (rhw - 1.6) / 3.0 : rStyle < 2.5 ? rhw - 0.35 : (rhw - 0.58) * 0.5;
      float x0 = rStyle > 4.5 && rStyle < 5.5 ? 0.8 : rStyle > 3.5 && rStyle < 4.5 ? 1.25 : rStyle < 2.5 ? 0.0 : 0.23;
      float lc = mod(as - x0, lw) - lw * 0.5;
      rCol *= 1.0 - 0.16 * (1.0 - smoothstep(0.1, 0.35, abs(lc))) * (0.4 + 0.6 * rD.a);
      rCol *= 1.0 + 0.07 * (1.0 - smoothstep(0.15, 0.3, abs(abs(lc) - 0.85)));
      // dusty gutter
      rCol = mix(rCol, vec3(0.11, 0.105, 0.1), 0.35 * smoothstep(rhw - 0.6, rhw - 0.05, as));
    }
    vec2 paint = rMarks(rStyle, rFlags, rs, rt, rhw);
    // tram tracks embedded in the inner lanes
    float rails = 0.0, bed = 0.0, groove = 0.0;
    if (!rJunc && rStyle > 7.5 && rBit(rFlags, 64.0) > 0.5) {
      rails = max(rRails(rs, 1.53, 0.04), rRails(rs, -1.53, 0.04));
      // flangeways: dark grooves on the gauge side of each rail head
      groove = max(rGrooves(rs, 1.53), rGrooves(rs, -1.53));
      // concrete track slabs with joints every 3 m
      bed = rBand(as - 1.53, 1.02) * (1.0 - rBand(mod(rt + 1.5, 3.0) - 1.5, 0.018) * 0.7);
    }
    if (rJunc && rBit(rFlags, 64.0) > 0.5) {
      rails = rJunctionRails(rLocal, rFlags, 1.53, 0.04);
    }
    if (bed > 0.0) rCol = mix(rCol, vec3(0.2, 0.195, 0.185) * (0.78 + 0.4 * rD.a) * (0.9 + 0.2 * rM.r), bed * 0.8);
    rCol = mix(rCol, vec3(0.018, 0.018, 0.02), groove * 0.85);
    float wear = smoothstep(0.18, 0.62, rD.a * 0.7 + rM.r * 0.5) * (1.0 - 0.6 * rM.b);
    paint *= mix(0.35, 1.0, wear);
    vec3 paintCol = paint.y > paint.x ? vec3(0.78, 0.52, 0.07) : vec3(0.74, 0.74, 0.72);
    float pAmt = max(paint.x, paint.y);
    rCol = mix(rCol, paintCol, pAmt);
    rRough = mix(0.86 - 0.12 * patchK, 0.62, pAmt);
    if (rails > 0.0) {
      rCol = mix(rCol, vec3(0.42, 0.43, 0.45), rails);
      rRough = mix(rRough, 0.28, rails);
      rMetal = rails * 0.85;
    }
    rBumpH = grain * 0.35 - pAmt * 0.2;
    rBumpK = 0.25;
    rPuddle = 1.0;
    rWetGloss = 0.16;
    float berm = rJunc ? 0.25 : smoothstep(rhw - 1.9, rhw - 0.5, as) + 0.18;
    rSnowK = clamp(berm, 0.0, 1.0);
  } else if (rKind < 1.5) {
    // ── gravel ──
    float pb = mix(rD.g, texture2D(uDetail, rUV / 9.0 + 0.57).g, 0.4);
    // earthy compacted gravel: tan stones in brown soil, large-scale tone drift
    vec3 soil = vec3(0.12, 0.092, 0.064) * (0.8 + 0.4 * rD.r);
    rCol = mix(soil, vec3(0.29, 0.245, 0.18), smoothstep(0.12, 0.75, pb)) * (0.8 + 0.4 * rM.r);
    if (!rJunc) {
      float as = abs(rs);
      float rut = 1.0 - smoothstep(0.3, 0.6, abs(as - 1.6));
      rCol = mix(rCol, vec3(0.105, 0.085, 0.062) * (0.85 + 0.3 * rD.r), rut * 0.5);
      float hump = 1.0 - smoothstep(0.2, 0.7, as);
      rCol = mix(rCol, uGrass * (0.7 + 0.5 * rD.r), hump * 0.55 * smoothstep(0.4, 0.65, rD.a + 0.1 * rM.r));
      float e = smoothstep(rhw - 1.0, rhw, as);
      rCol = mix(rCol, uGrass * (0.75 + 0.5 * rD.r), e * smoothstep(0.3, 0.7, rD.r + e * 0.4));
    }
    rRough = 0.95;
    rBumpH = pb;
    rBumpK = 0.6;
    rPuddle = 0.6;
    rWetGloss = 0.45;
    rSnowK = 0.7;
  } else if (rKind < 2.5) {
    // ── pavers ──
    float as = abs(rs);
    bool center = !rJunc && rStyle > 5.5 && rStyle < 6.5 && as < 2.2;
    vec4 d2 = center ? texture2D(uDetail, rUV.yx / ${DETAIL_TILE.toFixed(1)} + 0.37) : rD;
    float pv = d2.b;
    vec3 tint = center ? vec3(0.33, 0.21, 0.15) : vec3(0.27, 0.26, 0.245);
    rCol = tint * (0.55 + 0.9 * pv) * (0.9 + 0.2 * rM.r);
    if (!rJunc && rStyle > 5.5 && rStyle < 6.5) {
      float strip = rRange(as, 2.2, 2.48);
      rCol = mix(rCol, vec3(0.42, 0.41, 0.39) * (0.85 + 0.3 * rD.a), strip);
      pv = mix(pv, 0.7, strip);
    }
    rRough = 0.78;
    rBumpH = smoothstep(0.02, 0.2, pv);
    rBumpK = 0.9;
    rPuddle = 0.6;
    rWetGloss = 0.22;
    rSnowK = rJunc ? 0.75 : 0.55 + 0.35 * smoothstep(1.0, 3.0, as);
  } else if (rKind < 3.5) {
    // ── sidewalk concrete slabs ──
    rCol = vec3(0.34, 0.335, 0.325) * (0.8 + 0.4 * rD.a) * (0.9 + 0.2 * rM.r);
    float j;
    if (rJunc) {
      vec2 g = mod(vRWPos.xz + 0.75, 1.5) - 0.75;
      j = max(rBand(g.x, 0.012), rBand(g.y, 0.012));
    } else {
      j = rBand(mod(rt + 0.75, 1.5) - 0.75, 0.012);
    }
    rCol *= 1.0 - 0.45 * j;
    rCol = mix(rCol, rCol * 0.72, smoothstep(0.62, 0.8, rM.a) * 0.5);
    rRough = 0.82;
    rBumpH = 1.0 - j;
    rBumpK = 0.35;
    rPuddle = 0.35;
    rWetGloss = 0.3;
    rSnowK = 0.85;
  } else if (rKind < 4.5) {
    // ── curb stone ──
    rCol = vec3(0.40, 0.395, 0.385) * (0.82 + 0.3 * rD.g) * (0.9 + 0.2 * rD.a);
    rRough = 0.62;
    rBumpH = rD.g;
    rBumpK = 0.15;
    rWetGloss = 0.25;
    rSnowK = rVert ? 0.0 : 0.8;
  } else if (rKind < 5.5) {
    // ── grass verge / median lawn ──
    float dry = smoothstep(0.35, 0.8, rM.r);
    rCol = mix(uGrass, uGrassDry, dry * 0.55) * (0.68 + 0.6 * rD.r) * (0.9 + 0.2 * rD.a);
    if (rStyle > 6.5 && rStyle < 7.5) rCol = mix(rCol, mix(vec3(0.2, 0.18, 0.15), vec3(0.34, 0.31, 0.27), rD.g), 0.45 * smoothstep(0.3, 0.7, rD.a));
    rRough = 0.95;
    rBumpH = rD.r;
    rBumpK = 0.5;
    rPorous = 0.5;
    rWetGloss = 0.6;
    rSnowK = 1.0;
  } else if (rKind < 6.5) {
    // ── rail ballast ──
    // two pebble scales: fine stones + coarse clumps that survive minification
    float pb = mix(rD.g, texture2D(uDetail, rUV / 11.0 + 0.31).g, 0.45);
    rCol = mix(vec3(0.1, 0.096, 0.09), vec3(0.3, 0.285, 0.26), pb) * (0.85 + 0.3 * rM.r);
    // rust-stained ballast between and along the rails
    float rustZone = rJunc ? 0.0 : (1.0 - smoothstep(0.2, 1.3, abs(abs(rs) - 2.0)));
    rCol = mix(rCol, vec3(0.16, 0.1, 0.065) * (0.7 + 0.6 * pb), rustZone * 0.35);
    rRough = 0.95;
    rBumpH = pb;
    rBumpK = 0.7;
    rWetGloss = 0.5;
    rSnowK = 0.85;
    if (rBit(rFlags, 64.0) > 0.5) {
      // painted tracks (far LOD / under geometry)
      float slp = 0.0, rl = 0.0;
      if (rJunc) {
        rl = rJunctionRails(rLocal, rFlags, 2.0, 0.06);
      } else {
        for (int k = 0; k < 2; k++) {
          float c = k == 0 ? -2.0 : 2.0;
          float x = rs - c;
          slp = max(slp, step(abs(x), 1.3) * rDash(rt + 0.325, 0.65, 0.26));
          rl = max(rl, rRails(rs, c, 0.05));
        }
        float rust = (1.0 - smoothstep(0.0, 1.2, abs(abs(rs) - 2.0))) * 0.35;
        rCol = mix(rCol, vec3(0.22, 0.14, 0.09), rust * (0.5 + 0.5 * rD.r));
      }
      rCol = mix(rCol, vec3(0.30, 0.29, 0.27), slp * 0.9);
      rCol = mix(rCol, vec3(0.45, 0.45, 0.47), rl);
      rMetal = rl * 0.8;
      rRough = mix(rRough, 0.3, rl);
    }
  } else if (rKind < 7.5) {
    // ── concrete structure ──
    rCol = vec3(0.40, 0.39, 0.37) * (0.78 + 0.4 * rD.a) * (0.85 + 0.3 * rM.r);
    if (rVert) rCol *= 1.0 - 0.25 * smoothstep(0.55, 0.9, rM.a) * smoothstep(0.0, 1.5, fract(vRWPos.y * 0.25) * 4.0);
    rRough = 0.85;
    rBumpH = rD.a;
    rBumpK = 0.2;
    rWetGloss = 0.4;
    rSnowK = rVert ? 0.0 : 0.9;
  } else if (rKind < 8.5) {
    // ── steel rail ──
    bool top = vRWNormal.y > 0.7;
    rCol = top ? vec3(0.55, 0.56, 0.58) : vec3(0.20, 0.12, 0.075) * (0.7 + 0.6 * rD.r);
    rMetal = top ? 0.95 : 0.25;
    rRough = top ? 0.24 : 0.85;
    rPorous = 0.2;
    rWetGloss = 0.2;
  } else if (rKind < 9.5) {
    // ── galvanized steel ──
    rCol = vec3(0.60, 0.62, 0.64) * (0.9 + 0.2 * rD.a);
    rMetal = 0.85;
    rRough = 0.42;
    rPorous = 0.2;
    rWetGloss = 0.25;
    rSnowK = vRWNormal.y > 0.7 ? 0.6 : 0.0;
  } else if (rKind < 10.5) {
    // ── concrete sleeper ──
    rCol = vec3(0.235, 0.228, 0.215) * (0.8 + 0.35 * rD.a) * (0.9 + 0.2 * rM.r);
    rRough = 0.9;
    rSnowK = vRWNormal.y > 0.7 ? 0.6 : 0.0;
  } else if (rKind < 11.5) {
    // ── dark painted metal ──
    rCol = vec3(0.035, 0.04, 0.042);
    rMetal = 0.6;
    rRough = 0.45;
    rPorous = 0.2;
    rWetGloss = 0.2;
    rSnowK = vRWNormal.y > 0.7 ? 0.5 : 0.0;
  } else {
    // ── hazard stripes ──
    float st = step(0.5, fract((vRWPos.x + vRWPos.z + vRWPos.y) * 1.25));
    rCol = mix(vec3(0.62, 0.04, 0.03), vec3(0.75, 0.75, 0.73), st);
    rRough = 0.55;
  }
  // ── weather ──
  float rWet = clamp(uWet + uSnow * 0.55 * (1.0 - rSnowK), 0.0, 1.0);
  float rPud = rWet * rPuddle * smoothstep(0.58, 0.74, rM.a + (rKind < 0.5 && !rJunc ? 0.22 * smoothstep(rhw - 1.2, rhw - 0.2, abs(rs)) : 0.0));
  rCol *= mix(1.0, 0.58, rWet * rPorous);
  rCol *= 1.0 - 0.25 * rPud;
  rRough = mix(rRough, min(rRough, rWetGloss), rWet);
  rRough = mix(rRough, 0.04, rPud);
  float rSnow = 0.0;
  if (uSnow > 0.0 && rSnowK > 0.0) {
    float n = rD.r * 0.5 + rM.r * 0.5;
    float up = smoothstep(0.35, 0.8, vRWNormal.y);
    rSnow = smoothstep(0.0, 0.35, uSnow * rSnowK * 1.25 - (1.0 - n) * 0.45) * up;
    rCol = mix(rCol, rSnowCol() * (0.92 + 0.1 * rD.a), rSnow);
    rRough = mix(rRough, 0.62, rSnow);
    rMetal *= 1.0 - rSnow;
  }
  rBumpK *= rBumpFade * (1.0 - rPud) * (1.0 - rSnow);
  diffuseColor.rgb = rCol;
`;

export function createRoadMaterial(): { material: THREE.MeshStandardMaterial; uniforms: RoadUniforms } {
  const tex = roadTextures();
  const uniforms: RoadUniforms = {
    uDetail: { value: tex.detail },
    uMacro: { value: tex.macro },
    uWet: { value: 0 },
    uSnow: { value: 0 },
    uLeftHand: { value: 0 },
    uGrass: { value: new THREE.Color('#5f8f3e') },
    uGrassDry: { value: new THREE.Color('#8a9a4a') },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  material.name = 'RoadMaterial';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;\nvarying vec3 vRWPos;\nvarying vec3 vRWNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRoad = aRoad;\nvRWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = rMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n{ float bh = rBumpH * 0.012 * rBumpK; vec2 dh = vec2(dFdx(bh), dFdy(bh)); normal = roadPerturb(-vViewPosition, normal, dh, faceDirection); }',
      );
  };
  material.customProgramCacheKey = () => 'urbis-road-v1';
  return { material, uniforms };
}
