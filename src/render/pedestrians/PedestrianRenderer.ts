// Pedestrians: purely visual walkers on sidewalks (and pedestrian streets)
// around the camera, denser near homes, shops and parks. Count follows the
// population and the time of day (busy days, empty nights, fewer in the rain
// — those who are out carry umbrellas), only while the camera is low enough
// to see them; nobody is drawn beyond ~600 m. Walkers move between sidewalk
// corner nodes of road cells: along a block, around corners, across
// crosswalks at junctions and occasionally mid-block. One instanced draw call;
// legs / arms swing and the body bobs in the vertex shader.
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { CELL } from '../../core/constants';
import { RNG } from '../../core/rng';
import { DIR_DX, DIR_DY, RoadType, ZoneType } from '../../core/types';
import { SIDEWALK_OFFSET } from '../../sim/traffic/lanes';
import { activityAt } from '../../sim/traffic/trips';
import { ROAD_LIFT, SIDEWALK_LIFT } from '../../world/roadHeight';
import { HIP_Y, personGeometry, SHOULDER_Y } from './model';

const MAX_PEDS = 1500;
const VIEW = 600;

const SHIRTS = [0xc0392b, 0x2e86de, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400, 0x7f8c8d, 0xf8c9d4, 0x1abc9c, 0x2c3e50, 0xa04000, 0xfdfefe];
const LIN = (hex: number) => new THREE.Color(hex);

const PED_VS_COMMON = /* glsl */ `
attribute float aPart;
attribute float aMatP;
attribute vec4 aLook; // pants, skin, hair, umbrella indices
attribute vec4 aWalk; // phase, amplitude, -, -
uniform float uRain;
const vec3 PANTS[6] = vec3[6]( vec3(0.05,0.07,0.13), vec3(0.2,0.2,0.22), vec3(0.03,0.03,0.035), vec3(0.28,0.22,0.14), vec3(0.12,0.16,0.3), vec3(0.4,0.37,0.3) );
const vec3 SKIN[5] = vec3[5]( vec3(0.9,0.62,0.48), vec3(0.72,0.47,0.33), vec3(0.47,0.29,0.18), vec3(0.26,0.15,0.09), vec3(0.95,0.72,0.58) );
const vec3 HAIR[5] = vec3[5]( vec3(0.03,0.02,0.015), vec3(0.18,0.1,0.05), vec3(0.55,0.4,0.18), vec3(0.4,0.4,0.4), vec3(0.3,0.08,0.03) );
const vec3 UMB[6] = vec3[6]( vec3(0.02,0.02,0.025), vec3(0.6,0.02,0.02), vec3(0.03,0.15,0.5), vec3(0.8,0.6,0.02), vec3(0.05,0.3,0.1), vec3(0.5,0.1,0.35) );
`;

function createPedMaterial(uRain: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRain = uRain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PED_VS_COMMON)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
  float ph = aWalk.x, amp = aWalk.y;
  int part = int( aPart + 0.5 );
  if ( part == 1 || part == 2 ) {
    float a = sin( ph ) * 0.5 * amp * ( part == 1 ? 1.0 : -1.0 );
    float y = transformed.y - ${HIP_Y.toFixed(3)};
    float z = transformed.z;
    transformed.y = ${HIP_Y.toFixed(3)} + y * cos( a ) - z * sin( a );
    transformed.z = y * sin( a ) + z * cos( a );
  } else if ( part == 3 || part == 4 ) {
    float a = -sin( ph ) * 0.42 * amp * ( part == 3 ? 1.0 : -1.0 );
    if ( part == 3 && uRain > 0.5 ) a = -0.9; // right arm holds the umbrella
    float y = transformed.y - ${SHOULDER_Y.toFixed(3)};
    float z = transformed.z;
    transformed.y = ${SHOULDER_Y.toFixed(3)} + y * cos( a ) - z * sin( a );
    transformed.z = y * sin( a ) + z * cos( a );
  } else if ( part == 5 ) {
    transformed *= step( 0.5, uRain );
    transformed.z += 0.25 * step( 0.5, uRain );
  }
  transformed.y += abs( sin( ph ) ) * 0.035 * amp;`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( 1.0 );
  int mt = int( aMatP + 0.5 );
  if ( mt == 0 ) {
#ifdef USE_INSTANCING_COLOR
    vColor.rgb = instanceColor.rgb;
#endif
  } else if ( mt == 1 ) vColor.rgb = PANTS[ int( aLook.x ) % 6 ];
  else if ( mt == 2 ) vColor.rgb = SKIN[ int( aLook.y ) % 5 ];
  else if ( mt == 3 ) vColor.rgb = HAIR[ int( aLook.z ) % 5 ];
  else if ( mt == 4 ) vColor.rgb = vec3( 0.04 );
  else if ( mt == 5 ) vColor.rgb = UMB[ int( aLook.w ) % 6 ];
  else vColor.rgb = vec3( 0.12, 0.08, 0.05 ) + PANTS[ int( aLook.w ) % 6 ] * 0.5;`,
      );
  };
  m.customProgramCacheKey = () => 'urbis-pedestrian-v1';
  return m;
}

export class PedestrianRenderer {
  private world: World | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private uRain = { value: 0 };
  private look!: THREE.InstancedBufferAttribute;
  private walk!: THREE.InstancedBufferAttribute;
  private rng = new RNG(0x51ed);
  // walker state (SoA)
  private n = 0;
  private cell = new Int32Array(MAX_PEDS);
  private sx = new Int8Array(MAX_PEDS);
  private sz = new Int8Array(MAX_PEDS);
  private ax = new Float32Array(MAX_PEDS);
  private az = new Float32Array(MAX_PEDS);
  private bx = new Float32Array(MAX_PEDS);
  private bz = new Float32Array(MAX_PEDS);
  private seg = new Float32Array(MAX_PEDS);
  private t = new Float32Array(MAX_PEDS);
  private dir = new Int8Array(MAX_PEDS);
  private cross = new Uint8Array(MAX_PEDS);
  /** pending waypoints (crosswalk detours): count, x/z pairs, crossing bits */
  private wpN = new Uint8Array(MAX_PEDS);
  private wpX = new Float32Array(MAX_PEDS * 2);
  private wpZ = new Float32Array(MAX_PEDS * 2);
  private wpC = new Uint8Array(MAX_PEDS);
  private speed = new Float32Array(MAX_PEDS);
  private phase = new Float32Array(MAX_PEDS);
  private life = new Float32Array(MAX_PEDS);
  private fade = new Float32Array(MAX_PEDS);
  private yaw = new Float32Array(MAX_PEDS);
  private shirt = new Uint32Array(MAX_PEDS);
  private lk = new Float32Array(MAX_PEDS * 4);
  private spawnAcc = 0;
  readonly stats = { count: 0, drawn: 0 };

  constructor(private game: Game) {}

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.geo = personGeometry();
    this.material = createPedMaterial(this.uRain);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PEDS * 4), 4);
    this.walk = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PEDS * 4), 4);
    this.look.setUsage(THREE.DynamicDrawUsage);
    this.walk.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aLook', this.look);
    this.geo.setAttribute('aWalk', this.walk);
    const m = new THREE.InstancedMesh(this.geo, this.material, MAX_PEDS);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PEDS * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.count = 0;
    m.name = 'pedestrians';
    this.mesh = m;
    this.game.renderer.scene.add(m);
    this.n = 0;
  }

  onWorldUnloaded(): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.dispose();
    }
    this.geo?.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.geo = null;
    this.material = null;
    this.world = null;
    this.n = 0;
  }

  private enabled(): boolean {
    try {
      return this.game.settings.value.graphics.pedestrians !== false;
    } catch {
      return true;
    }
  }

  private offsetAt(cell: number): number {
    const w = this.world!;
    const t = w.road[cell] as RoadType;
    if (t === RoadType.Pedestrian) return 4.2;
    return SIDEWALK_OFFSET[t] ?? 0;
  }

  private walkable(cell: number): boolean {
    return this.offsetAt(cell) > 0;
  }

  /** world position of corner node (cell, sx, sz) */
  private node(cell: number, sx: number, sz: number, out: Float32Array, k: number): void {
    const w = this.world!;
    const off = this.offsetAt(cell);
    const x = cell % w.size, y = (cell / w.size) | 0;
    out[k] = (x + 0.5) * CELL + sx * off;
    out[k + 1] = (y + 0.5) * CELL + sz * off;
  }
  private tmp = new Float32Array(2);

  /** spawn weight near homes / shops / parks */
  private attraction(x: number, y: number): number {
    const w = this.world!;
    let a = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const b = w.buildingAt(x + dx, y + dy);
        if (!b) continue;
        if (b.kind === 'service') a += 1.2;
        else if (b.zone === ZoneType.ComLow || b.zone === ZoneType.ComHigh || b.zone === ZoneType.MixedUse) a += 1.5;
        else if (b.zone === ZoneType.ResLow || b.zone === ZoneType.ResMed || b.zone === ZoneType.ResHigh || b.zone === ZoneType.Office) a += 0.8;
        else a += 0.15;
      }
    if (w.road[w.idx(x, y)] === RoadType.Pedestrian) a += 4;
    return a;
  }

  private spawn(fx: number, fz: number, radius: number): boolean {
    const w = this.world!;
    const k = this.n;
    if (k >= MAX_PEDS) return false;
    for (let tries = 0; tries < 16; tries++) {
      const ang = this.rng.next() * Math.PI * 2, r = Math.sqrt(this.rng.next()) * radius;
      const cx = Math.floor((fx + Math.cos(ang) * r) / CELL), cy = Math.floor((fz + Math.sin(ang) * r) / CELL);
      if (!w.inBounds(cx, cy)) continue;
      const cell = w.idx(cx, cy);
      if (!this.walkable(cell)) continue;
      const a = this.attraction(cx, cy);
      if (this.rng.next() * 8 > a + 0.3) continue;
      this.cell[k] = cell;
      this.sx[k] = this.rng.next() < 0.5 ? -1 : 1;
      this.sz[k] = this.rng.next() < 0.5 ? -1 : 1;
      this.node(cell, this.sx[k], this.sz[k], this.tmp, 0);
      this.ax[k] = this.bx[k] = this.tmp[0];
      this.az[k] = this.bz[k] = this.tmp[1];
      this.seg[k] = 0;
      this.t[k] = 0;
      this.dir[k] = Math.floor(this.rng.next() * 4);
      this.cross[k] = 0;
      this.wpN[k] = 0;
      this.speed[k] = 1.15 + this.rng.next() * 0.45;
      this.phase[k] = this.rng.next() * 6.28;
      this.life[k] = 40 + this.rng.next() * 120;
      this.fade[k] = 0;
      this.shirt[k] = SHIRTS[Math.floor(this.rng.next() * SHIRTS.length)];
      this.lk[k * 4] = Math.floor(this.rng.next() * 6);
      this.lk[k * 4 + 1] = Math.floor(this.rng.next() * 5);
      this.lk[k * 4 + 2] = Math.floor(this.rng.next() * 5);
      this.lk[k * 4 + 3] = Math.floor(this.rng.next() * 6);
      this.n++;
      this.pickNext(k);
      return true;
    }
    return false;
  }

  private remove(k: number): void {
    const last = --this.n;
    if (k === last) return;
    this.cell[k] = this.cell[last];
    this.sx[k] = this.sx[last];
    this.sz[k] = this.sz[last];
    this.ax[k] = this.ax[last];
    this.az[k] = this.az[last];
    this.bx[k] = this.bx[last];
    this.bz[k] = this.bz[last];
    this.seg[k] = this.seg[last];
    this.t[k] = this.t[last];
    this.dir[k] = this.dir[last];
    this.cross[k] = this.cross[last];
    this.wpN[k] = this.wpN[last];
    this.wpC[k] = this.wpC[last];
    for (let j = 0; j < 2; j++) {
      this.wpX[k * 2 + j] = this.wpX[last * 2 + j];
      this.wpZ[k * 2 + j] = this.wpZ[last * 2 + j];
    }
    this.speed[k] = this.speed[last];
    this.phase[k] = this.phase[last];
    this.life[k] = this.life[last];
    this.fade[k] = this.fade[last];
    this.yaw[k] = this.yaw[last];
    this.shirt[k] = this.shirt[last];
    for (let j = 0; j < 4; j++) this.lk[k * 4 + j] = this.lk[last * 4 + j];
  }

  /** choose the next corner node from the current one */
  private pickNext(k: number): void {
    const w = this.world!, s = w.size;
    const cell = this.cell[k], sx = this.sx[k], sz = this.sz[k];
    const x = cell % s, y = (cell / s) | 0;
    const mask = w.roadMask(x, y);
    const ped = w.road[cell] === RoadType.Pedestrian;
    let best = -1, bestW = 0, total = 0;
    const cand = this.cand;
    for (let d = 0; d < 4; d++) {
      const dx = DIR_DX[d], dy = DIR_DY[d];
      let wgt = 0, ncell = cell, nsx = sx, nsz = sz, crossing = 0;
      const outward = dx !== 0 ? dx === sx : dy === sz;
      if (outward) {
        // leave the cell through this side
        if (!(mask & (1 << d))) continue;
        const nx = x + dx, ny = y + dy;
        if (!w.inBounds(nx, ny)) continue;
        ncell = ny * s + nx;
        if (!this.walkable(ncell)) continue;
        if (dx !== 0) nsx = -sx as -1 | 1;
        else nsz = -sz as -1 | 1;
        wgt = 1;
      } else {
        // move across this cell along its side: crosses a road arm if one exits on our side
        if (dx !== 0) nsx = -sx as -1 | 1;
        else nsz = -sz as -1 | 1;
        const armDir = dx !== 0 ? (sz < 0 ? 0 : 2) : sx > 0 ? 1 : 3;
        crossing = mask & (1 << armDir) ? 1 : 0;
        if (!crossing) {
          // walking along the block: only valid if the road runs this way
          const along = dx !== 0 ? (mask & 10) !== 0 || (mask & 5) === 0 : (mask & 5) !== 0 || (mask & 10) === 0;
          wgt = along ? 1 : 0.35;
        } else {
          const junction = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) >= 3;
          wgt = ped ? 0.8 : junction ? 0.55 : 0.06;
        }
      }
      // keep walking the same way; rarely turn back
      if (d === this.dir[k]) wgt *= 4;
      else if (d === ((this.dir[k] + 2) & 3)) wgt *= 0.08;
      if (wgt <= 0) continue;
      cand[d * 4] = ncell;
      cand[d * 4 + 1] = nsx;
      cand[d * 4 + 2] = nsz;
      cand[d * 4 + 3] = crossing;
      total += wgt;
      this.candW[d] = wgt;
      if (wgt > bestW) {
        bestW = wgt;
        best = d;
      }
    }
    if (best < 0) {
      // isolated: turn around in place
      this.life[k] = Math.min(this.life[k], 2);
      this.dir[k] = (this.dir[k] + 2) & 3;
      this.seg[k] = 0;
      this.t[k] = 0;
      return;
    }
    let r = this.rng.next() * total, pick = best;
    for (let d = 0; d < 4; d++) {
      if (!this.candW[d]) continue;
      r -= this.candW[d];
      if (r <= 0) {
        pick = d;
        break;
      }
    }
    for (let d = 0; d < 4; d++) this.candW[d] = 0;
    this.ax[k] = this.bx[k];
    this.az[k] = this.bz[k];
    this.cell[k] = cand[pick * 4];
    this.sx[k] = cand[pick * 4 + 1];
    this.sz[k] = cand[pick * 4 + 2];
    this.cross[k] = cand[pick * 4 + 3];
    this.dir[k] = pick;
    this.node(this.cell[k], this.sx[k], this.sz[k], this.tmp, 0);
    // a little lateral jitter so crowds do not walk in single file
    const jit = (this.lk[k * 4 + 3] - 2.5) * 0.12;
    const bx = this.tmp[0] + (DIR_DY[pick] !== 0 ? jit : 0);
    const bz = this.tmp[1] + (DIR_DX[pick] !== 0 ? jit : 0);
    this.wpN[k] = 0;
    const junction = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) >= 3;
    if (this.cross[k] && junction && !ped) {
      // use the zebra crossing in the arm: walk into the arm, cross, come back
      const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
      const into = CELL / 2 + 2.4;
      let a1x = this.ax[k], a1z = this.az[k], b1x = bx, b1z = bz;
      if (DIR_DX[pick] !== 0) {
        a1z = cz + sz * into;
        b1z = a1z;
      } else {
        a1x = cx + sx * into;
        b1x = a1x;
      }
      this.bx[k] = a1x;
      this.bz[k] = a1z;
      this.cross[k] = 0;
      this.wpX[k * 2] = b1x;
      this.wpZ[k * 2] = b1z;
      this.wpX[k * 2 + 1] = bx;
      this.wpZ[k * 2 + 1] = bz;
      this.wpC[k] = 1; // bit0: next segment crosses the road
      this.wpN[k] = 2;
    } else {
      this.bx[k] = bx;
      this.bz[k] = bz;
    }
    this.seg[k] = Math.max(0.01, Math.hypot(this.bx[k] - this.ax[k], this.bz[k] - this.az[k]));
    this.t[k] = 0;
  }

  /** advance to the next queued waypoint */
  private nextWaypoint(k: number): void {
    const j = 2 - this.wpN[k];
    this.ax[k] = this.bx[k];
    this.az[k] = this.bz[k];
    this.bx[k] = this.wpX[k * 2 + j];
    this.bz[k] = this.wpZ[k * 2 + j];
    this.cross[k] = (this.wpC[k] >> j) & 1;
    this.wpN[k]--;
    this.seg[k] = Math.max(0.01, Math.hypot(this.bx[k] - this.ax[k], this.bz[k] - this.az[k]));
  }
  private cand = new Int32Array(16);
  private candW = new Float32Array(4);

  update(dt: number): void {
    const w = this.world, mesh = this.mesh;
    if (!w || !mesh) return;
    if (!this.enabled()) {
      mesh.visible = false;
      this.n = 0;
      return;
    }
    const r = this.game.renderer;
    const view = r.getViewInfo();
    const cp = view.cameraPos;
    const fx = view.focusX * CELL, fz = view.focusY * CELL;
    const alt = view.altitude;
    const weather = w.weather.type;
    const raining = weather === 'rain' || weather === 'storm';
    this.uRain.value = raining ? 1 : 0;
    // how many people should be out
    const zoom = alt < 260 ? 1 : alt > 720 ? 0 : 1 - (alt - 260) / 460;
    const hour = w.time.hour;
    const tod = Math.min(1, 0.08 + activityAt(hour) * 0.95);
    const wx = raining ? 0.45 : weather === 'blizzard' || weather === 'snow' ? 0.5 : weather === 'heatwave' ? 0.7 : 1;
    const pop = w.stats.population;
    const target = Math.min(MAX_PEDS, Math.round(Math.min(1, pop / 40000 + 0.12) * MAX_PEDS * tod * wx * zoom)) * (pop > 0 ? 1 : 0);
    const radius = Math.min(VIEW - 60, 200 + alt * 0.8);
    const sdt = Math.min(this.game.simDt, dt * 3);
    // spawn toward the target (a few per frame)
    this.spawnAcc += dt * Math.max(0, target - this.n) * 0.8;
    let spawns = Math.min(24, Math.floor(this.spawnAcc));
    this.spawnAcc -= spawns;
    while (spawns-- > 0 && this.n < target) if (!this.spawn(fx, fz, radius)) break;
    // walk
    const rs = this.game.roadSurface;
    const mat = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    const look = this.look.array as Float32Array, walk = this.walk.array as Float32Array;
    const fr = view.frustum;
    let drawn = 0;
    const excess = this.n - target;
    for (let k = this.n - 1; k >= 0; k--) {
      // leave when far from the camera focus, when too many or when their stroll ends
      const dfx = this.bx[k] - fx, dfz = this.bz[k] - fz;
      const far = dfx * dfx + dfz * dfz > (radius + 90) * (radius + 90);
      this.life[k] -= sdt;
      const leaving = far || this.life[k] <= 0 || (excess > 0 && k >= target);
      this.fade[k] = leaving ? this.fade[k] - dt * 1.5 : Math.min(1, this.fade[k] + dt * 1.5);
      if (this.fade[k] <= 0 && leaving) {
        this.remove(k);
        continue;
      }
      if (sdt > 0) {
        this.t[k] += this.speed[k] * sdt * (this.cross[k] ? 1.25 : 1);
        this.phase[k] += this.speed[k] * sdt * 4.6;
        let guard = 0;
        while (this.t[k] >= this.seg[k] && guard++ < 4) {
          const extra = this.t[k] - this.seg[k];
          if (this.wpN[k] > 0) this.nextWaypoint(k);
          else this.pickNext(k);
          this.t[k] = extra;
        }
      }
    }
    const dt2 = VIEW * VIEW;
    const tmpV = this.tmpV;
    for (let k = 0; k < this.n; k++) {
      const u = Math.min(1, this.t[k] / this.seg[k]);
      const x = this.ax[k] + (this.bx[k] - this.ax[k]) * u, z = this.az[k] + (this.bz[k] - this.az[k]) * u;
      const dx = x - cp.x, dz = z - cp.z;
      const ground = rs ? rs.heightAt(x, z) : w.heightAt(x, z);
      const y = ground + (this.cross[k] ? 0.01 : SIDEWALK_LIFT - ROAD_LIFT);
      const dy = y - cp.y;
      if (dx * dx + dz * dz + dy * dy > dt2) continue;
      tmpV.center.set(x, y + 1, z);
      if (!fr.intersectsSphere(tmpV)) continue;
      const hx = this.bx[k] - this.ax[k], hz = this.bz[k] - this.az[k];
      if (hx * hx + hz * hz > 1e-4) {
        const target = Math.atan2(hx, hz);
        let d = target - this.yaw[k];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw[k] += d * Math.min(1, dt * 8);
      }
      const s = Math.max(0.001, this.fade[k]) * 0.97;
      const cy = Math.cos(this.yaw[k]), sy = Math.sin(this.yaw[k]);
      const o = drawn * 16;
      mat[o] = cy * s;
      mat[o + 1] = 0;
      mat[o + 2] = -sy * s;
      mat[o + 3] = 0;
      mat[o + 4] = 0;
      mat[o + 5] = s;
      mat[o + 6] = 0;
      mat[o + 7] = 0;
      mat[o + 8] = sy * s;
      mat[o + 9] = 0;
      mat[o + 10] = cy * s;
      mat[o + 11] = 0;
      mat[o + 12] = x;
      mat[o + 13] = y;
      mat[o + 14] = z;
      mat[o + 15] = 1;
      const c = this.shirt[k];
      col[drawn * 3] = SRGB[(c >> 16) & 255];
      col[drawn * 3 + 1] = SRGB[(c >> 8) & 255];
      col[drawn * 3 + 2] = SRGB[c & 255];
      for (let j = 0; j < 4; j++) look[drawn * 4 + j] = this.lk[k * 4 + j];
      walk[drawn * 4] = this.phase[k];
      walk[drawn * 4 + 1] = sdt > 0 ? 1 : 0;
      drawn++;
    }
    mesh.count = drawn;
    mesh.visible = drawn > 0;
    if (drawn) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, drawn * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, drawn * 3);
      mesh.instanceColor!.needsUpdate = true;
      this.look.clearUpdateRanges();
      this.look.addUpdateRange(0, drawn * 4);
      this.look.needsUpdate = true;
      this.walk.clearUpdateRanges();
      this.walk.addUpdateRange(0, drawn * 4);
      this.walk.needsUpdate = true;
    }
    this.stats.count = this.n;
    this.stats.drawn = drawn;
  }
  private tmpV = new THREE.Sphere(new THREE.Vector3(), 1.2);
}

const SRGB = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB[i] = LIN(0).setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r;
