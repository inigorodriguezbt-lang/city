// ─────────────────────────────────────────────────────────────────────────────
// VehicleRenderer: draws every simulated vehicle with one InstancedMesh per
// model and LOD band (near: casts shadows, mid, far: low-poly proxy), culled to
// the view radius (≤ ~1.5 km) and the camera frustum. Multi-section vehicles
// (semis, articulated trams, push-pull trains, cargo trains, monorails) place
// each section on the chord between two points of the path so they bend
// through curves. Height follows the road surface (bridge decks, terrain) with
// pitch from the slope. At night head / tail lights glow (emissive + additive
// sprites, headlight pools on the road), brake lights flare when slowing and
// emergency light bars flash. Also owns the pedestrian and transit-stop
// renderers. No per-frame allocations.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { CELL } from '../../core/constants';
import type { TrafficSystem } from '../../sim/traffic/TrafficSystem';
import { Model, MODEL_COUNT, MODEL_LEN, SECTION_GAP, sectionModel, sectionReversed, VF, VS } from '../../sim/traffic/types';
import { Batch, SpriteBatch } from './batches';
import { createBeamMaterial, createBodyMaterial, createGlowMaterial, type VehicleUniforms } from './material';
import { vehicleModels, type VehicleModel } from './models';
import { PedestrianRenderer } from '../pedestrians/PedestrianRenderer';
import { TransitRenderer } from './TransitRenderer';

const NEAR = 230;
const MID = 700;
const MAX_VIEW = 1550;
const GLOW_DIST = 1300;
const BEAM_DIST = 420;

export class VehicleRenderer {
  protected world: World | null = null;
  /** everything vehicles draw lives here */
  readonly group = new THREE.Group();
  readonly pedestrians: PedestrianRenderer;
  readonly transit: TransitRenderer;
  readonly stats = { drawn: 0, sections: 0, glows: 0, ms: 0 };

  private uniforms: VehicleUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  private body: THREE.MeshStandardMaterial | null = null;
  private glowMat: THREE.ShaderMaterial | null = null;
  private beamMat: THREE.ShaderMaterial | null = null;
  private models: VehicleModel[] = [];
  private near: Batch[] = [];
  private mid: Batch[] = [];
  private far: Batch[] = [];
  private glows: SpriteBatch | null = null;
  private beams: SpriteBatch | null = null;
  private time = 0;
  // scratch (no per-frame allocation)
  private readonly sphere = new THREE.Sphere();
  private readonly backs = new Float32Array(32);
  private readonly pts = new Float32Array(32 * 4);
  private readonly lp = new THREE.Vector3();

  constructor(protected game: Game) {
    this.group.name = 'vehicles';
    this.pedestrians = new PedestrianRenderer(game);
    this.transit = new TransitRenderer(game);
  }

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.models = vehicleModels();
    this.body = createBodyMaterial(this.uniforms);
    this.glowMat = createGlowMaterial();
    this.beamMat = createBeamMaterial();
    for (let m = 0; m < MODEL_COUNT; m++) {
      const md = this.models[m];
      this.near.push(new Batch(md.geo, this.body, true, this.group));
      this.mid.push(new Batch(md.geo, this.body, false, this.group));
      this.far.push(new Batch(md.far, this.body, false, this.group));
    }
    const quad = new THREE.PlaneGeometry(2, 2);
    this.glows = new SpriteBatch(this.glowMat, ['aGlow', 'aCol'], quad, 512);
    const strip = new THREE.BufferGeometry();
    strip.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    strip.setIndex([0, 1, 2, 0, 2, 3]);
    this.beams = new SpriteBatch(this.beamMat, ['aBeam', 'aBeam2'], strip, 256);
    this.group.add(this.glows.mesh, this.beams.mesh);
    this.game.renderer.scene.add(this.group);
    this.pedestrians.onWorldLoaded(world);
    this.transit.onWorldLoaded(world);
  }

  onWorldUnloaded(): void {
    this.pedestrians.onWorldUnloaded();
    this.transit.onWorldUnloaded();
    for (const b of [...this.near, ...this.mid, ...this.far]) b.dispose();
    this.near = [];
    this.mid = [];
    this.far = [];
    this.glows?.dispose();
    this.beams?.dispose();
    this.glows = this.beams = null;
    this.group.clear();
    this.body?.dispose();
    this.glowMat?.dispose();
    this.beamMat?.dispose();
    this.body = this.glowMat = this.beamMat = null;
    this.group.removeFromParent();
    this.world = null;
  }

  private get traffic(): TrafficSystem | null {
    return (this.game as { traffic?: TrafficSystem }).traffic ?? null;
  }

  update(dt: number): void {
    const w = this.world, ts = this.traffic;
    if (!w || !ts || !this.body || !this.glows || !this.beams) return;
    const t0 = performance.now();
    const r = this.game.renderer;
    this.time += dt;
    const night = r.lighting.night;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uNight.value = night;
    const cam = r.camera;
    const view = r.getViewInfo();
    const cp = view.cameraPos;
    const fr = view.frustum;
    const maxD = Math.min(MAX_VIEW, Math.max(600, view.radiusCells * CELL));
    const maxD2 = maxD * maxD;
    // pixel size at distance 1 for sprites
    const h = r.renderer.domElement.height || 800;
    (this.glowMat!.uniforms.uPixel as { value: number }).value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
    const weather = w.weather.type;
    const gloomy = weather === 'rain' || weather === 'storm' || weather === 'fog' || weather === 'blizzard' || weather === 'snow';
    const lights = Math.min(1, Math.max(0, (night - 0.18) * 2.2) + (gloomy ? 0.6 : 0));
    for (const b of this.near) b.count = 0;
    for (const b of this.mid) b.count = 0;
    for (const b of this.far) b.count = 0;
    this.glows.count = 0;
    this.beams.count = 0;
    const st = ts.store;
    const sph = this.sphere;
    let drawn = 0, sections = 0;
    const glowOn = night > 0.02;
    for (let a = 0; a < st.activeN; a++) {
      const i = st.active[a];
      const state = st.state[i];
      if (state < VS.Drive) continue;
      const f = st.flags[i];
      if (f & VF.Underground) continue;
      const x = st.x[i], z = st.z[i];
      const dx = x - cp.x, dz = z - cp.z;
      const dh2 = dx * dx + dz * dz;
      if (dh2 > maxD2) continue;
      const yaw = st.yaw[i];
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const L = st.len[i], half = st.half[i];
      const back = L * 0.5 - half;
      const y = ts.heightOf(i, x, z);
      sph.center.set(x - sy * back, y + 1.5, z - cy * back);
      sph.radius = L * 0.5 + 3;
      if (!fr.intersectsSphere(sph)) continue;
      const dy = y - cp.y;
      const d2 = dh2 + dy * dy;
      const lod = d2 < NEAR * NEAR ? 0 : d2 < MID * MID ? 1 : 2;
      const set = lod === 0 ? this.near : lod === 1 ? this.mid : this.far;
      const scale = Math.max(0.001, st.fade[i]);
      const color = st.color[i];
      const moving = state === VS.Drive;
      const brake = moving && (st.acc[i] < -1.1 || st.v[i] < 0.25) ? 1 : state === VS.Dwell ? 0.4 : 0;
      const siren = f & (VF.Siren | VF.Beacon) ? 1 : 0;
      const lit = f & VF.Transit ? Math.max(lights, night > 0.08 ? 0.5 : 0) : lights;
      const phase = ((st.seed[i] >>> 4) & 1023) / 1024;
      const n = st.nsec[i];
      const head = st.model[i];
      drawn++;
      const doGlow = (glowOn || siren) && d2 < GLOW_DIST * GLOW_DIST;
      if (n <= 1) {
        let pitch = 0;
        let yy = y;
        if (f & VF.Water) {
          yy += Math.sin(this.time * 0.9 + phase * 6.28) * 0.18;
          pitch = Math.sin(this.time * 0.6 + phase * 3.1) * 0.012;
        } else if (lod < 2 && !(f & VF.Free)) {
          const hl = MODEL_LEN[head] * 0.5;
          const hf = ts.heightOf(i, x + sy * hl, z + cy * hl), hb = ts.heightOf(i, x - sy * hl, z - cy * hl);
          pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(hf - hb, hl * 2)));
          yy = (hf + hb) * 0.5 * 0.5 + y * 0.5;
        }
        set[head].write(x, yy, z, yaw, pitch, scale, color, brake, siren, lit, phase);
        sections++;
        if (doGlow) this.glowFor(head, x, yy, z, yaw, pitch, scale, false, true, true, brake, f, lit, night, phase);
        if (lit > 0.3 && d2 < BEAM_DIST * BEAM_DIST && this.models[head].meta.hz && !(f & VF.Water)) {
          const m = this.models[head].meta;
          const bl = head === Model.Bicycle ? 6 : L > 7 ? 18 : 14;
          this.beams.push(x + sy * m.hz, yy + 0.05, z + cy * m.hz, yaw, bl, head === Model.Bicycle ? 1.6 : 4.2, lit * scale * (0.35 + 0.65 * Math.min(1, st.v[i] / 6)), 0);
        }
        continue;
      }
      // multi-section: chord between front and rear points of every trailing section
      const comp = st.comp[i];
      set[head].write(x, y, z, yaw, 0, scale, color, brake, siren, lit, phase);
      sections++;
      if (doGlow) this.glowFor(head, x, y, z, yaw, 0, scale, false, true, false, brake, f, lit, night, phase);
      if (lit > 0.3 && d2 < BEAM_DIST * BEAM_DIST && this.models[head].meta.hz && !(f & (VF.Elevated | VF.Water))) {
        const m = this.models[head].meta;
        this.beams.push(x + sy * m.hz, y + 0.05, z + cy * m.hz, yaw, 20, 4.4, lit * scale * (0.35 + 0.65 * Math.min(1, st.v[i] / 6)), 0);
      }
      const gap = SECTION_GAP[comp];
      let fk = MODEL_LEN[sectionModel(comp, 0, n, head)] + gap;
      let q = 0;
      for (let k = 1; k < n && q < 30; k++) {
        const lk = MODEL_LEN[sectionModel(comp, k, n, head)];
        this.backs[q++] = fk - half;
        this.backs[q++] = fk + lk - half;
        fk += lk + gap;
      }
      ts.sectionPoints(i, this.backs, q, this.pts);
      const pts = this.pts;
      for (let k = 1, j = 0; k < n && j < q; k++, j += 2) {
        const fx = pts[j * 4], fz = pts[j * 4 + 1], rx = pts[j * 4 + 4], rz = pts[j * 4 + 5];
        const mx = (fx + rx) * 0.5, mz = (fz + rz) * 0.5;
        let syaw = Math.atan2(fx - rx, fz - rz);
        let spitch = 0;
        let sy2 = ts.heightOf(i, mx, mz);
        if (lod < 2 && !(f & VF.Free)) {
          const hf = ts.heightOf(i, fx, fz), hr = ts.heightOf(i, rx, rz);
          spitch = Math.max(-0.3, Math.min(0.3, Math.atan2(hf - hr, Math.hypot(fx - rx, fz - rz))));
          sy2 = (hf + hr) * 0.5;
        }
        const rev = sectionReversed(comp, k, n);
        if (rev) {
          syaw += Math.PI;
          spitch = -spitch;
        }
        const sm = sectionModel(comp, k, n, head);
        const last = k === n - 1;
        set[sm].write(mx, sy2, mz, syaw, spitch, scale, color, rev ? 0 : brake, siren, lit, phase + (rev ? 2 : 0));
        sections++;
        if (doGlow && last) this.glowFor(sm, mx, sy2, mz, syaw, spitch, scale, rev, false, true, brake, f, lit, night, phase);
      }
    }
    for (const b of this.near) b.commit();
    for (const b of this.mid) b.commit();
    for (const b of this.far) b.commit();
    this.glows.commit();
    this.beams.commit();
    this.stats.drawn = drawn;
    this.stats.sections = sections;
    this.stats.glows = this.glows.count;
    this.pedestrians.update(dt);
    this.transit.update(dt);
    this.stats.ms = performance.now() - t0;
  }

  /** local model point → world (into this.lp) */
  private toWorld(lx: number, ly: number, lz: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number): THREE.Vector3 {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const X = lx * scale, Y = ly * scale, Z = lz * scale;
    return this.lp.set(x + cy * X - sp * sy * Y + sy * cp * Z, y + cp * Y + sp * Z, z - sy * X - sp * cy * Y + cy * cp * Z);
  }

  private glowFor(model: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number, reversed: boolean, front: boolean, rear: boolean, brake: number, flags: number, lit: number, night: number, phase: number): void {
    const m = this.models[model].meta;
    const g = this.glows!;
    const nightK = Math.min(1, night * 1.6);
    if (lit > 0.05) {
      if (front && m.hz && !reversed) {
        const I = lit * 0.95;
        for (let s = 1; s >= -1; s -= 2) {
          const p = this.toWorld(s * m.hx, m.hy, m.hz + 0.08, x, y, z, yaw, pitch, scale);
          g.push(p.x, p.y, p.z, model === Model.Bicycle ? 0.32 : 0.5, 1.0, 0.9, 0.72, I);
        }
      }
      if (rear) {
        const I = (0.5 + 1.1 * brake) * Math.max(lit, brake * nightK);
        if (reversed && m.hz) {
          for (let s = 1; s >= -1; s -= 2) {
            const p = this.toWorld(s * m.tx, m.ty, m.hz + 0.08, x, y, z, yaw, pitch, scale);
            g.push(p.x, p.y, p.z, 0.45, 1.0, 0.06, 0.03, lit * 0.8);
          }
        } else if (m.tz && I > 0.02) {
          for (let s = 1; s >= -1; s -= 2) {
            const p = this.toWorld(s * m.tx, m.ty, m.tz - 0.08, x, y, z, yaw, pitch, scale);
            g.push(p.x, p.y, p.z, model === Model.Bicycle ? 0.28 : 0.5, 1.0, 0.07, 0.03, I);
          }
        }
      }
      if (m.ay && !(flags & VF.Beacon)) {
        const p = this.toWorld(0, m.ay, m.az, x, y, z, yaw, pitch, scale);
        g.push(p.x, p.y, p.z, 0.5, 1.0, 0.62, 0.15, lit * 0.8);
      }
    }
    if (flags & VF.Siren && m.by && front) {
      const t = (this.time * 1.7 + phase) % 1;
      const strobe = (t * 6) % 1 < 0.5 ? 0.55 : 1;
      const I = strobe * (0.8 + 2.2 * nightK);
      const pl = this.toWorld(m.bx, m.by, m.bz, x, y, z, yaw, pitch, scale);
      if (t < 0.5) g.push(pl.x, pl.y, pl.z, 1.1, 1.0, 0.08, 0.05, I);
      const pr = this.toWorld(-m.bx, m.by, m.bz, x, y, z, yaw, pitch, scale);
      if (t >= 0.5) g.push(pr.x, pr.y, pr.z, 1.1, 0.12, 0.3, 1.0, I * 1.2);
    }
    if (flags & VF.Beacon && m.ay) {
      const on = (this.time * 1.25 + phase) % 1 < 0.4;
      if (on) {
        const p = this.toWorld(0, m.ay, m.az, x, y, z, yaw, pitch, scale);
        g.push(p.x, p.y, p.z, 0.8, 1.0, 0.55, 0.1, 0.6 + 1.6 * nightK);
      }
    }
  }
}

