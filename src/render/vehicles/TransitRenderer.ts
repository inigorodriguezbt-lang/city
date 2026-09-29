// Transit line visuals.
//  • Stop markers (always visible, instanced per kind, tinted with the line
//    color): bus / tram shelters on the sidewalk beside the stop lane, side
//    platforms with canopies for trains, metro entrances with glowing totems,
//    floating ferry piers, elevated monorail stations.
//  • Monorail guideways: concrete beams along every monorail line with
//    T-pillars on the road center line (skipping junctions).
//  • Line overlays while the transit tool is active: colored ribbons along
//    every line's path with stop discs.
// Rebuilt whenever TransitManager.version changes.
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { World } from '../../world/World';
import { CELL } from '../../core/constants';
import { DIR_DX, DIR_DY, RoadType, type TransitMode } from '../../core/types';
import { SIDEWALK_LIFT, ROAD_LIFT } from '../../world/roadHeight';
import type { TrafficSystem } from '../../sim/traffic/TrafficSystem';
import { ROAD_HALF_WIDTH, SIDEWALK_OFFSET, dirBetween } from '../../sim/traffic/lanes';
import { colorNum } from '../../sim/traffic/transit';
import { MONORAIL_HEIGHT } from '../../sim/traffic/types';
import { Batch } from './batches';
import { Ch, VB } from './builder';
import { createBodyMaterial, type VehicleUniforms } from './material';
import { createRibbonMaterial, pixelFactor, RibbonBuilder } from './ribbons';

const enum StopKind {
  Shelter = 0,
  Metro,
  Platform,
  Pier,
  Monorail,
  COUNT,
}

const GLASS = 0x2a3a48;
const SHELTER_GLASS = 0x7d93a1;
const DARK = 0x2b2d31;
const CONCRETE = 0xbdbab2;
const WOOD = 0x7b5a3c;

function shelter(): VB {
  const b = new VB();
  // local: origin on the sidewalk, +Z faces the road
  b.box(0, 0.0, 0, 3.4, 0.06, 1.7, Ch.Satin, 0x9c9a94);
  // glass back wall with a lit advertising panel at one end, glass side wings
  b.quad([-1.6, 0.25, -0.7], [0.9, 0.25, -0.7], [0.9, 2.25, -0.7], [-1.6, 2.25, -0.7], Ch.Glass, SHELTER_GLASS, [0, 0, 1]);
  b.quad([0.9, 0.25, -0.72], [-1.6, 0.25, -0.72], [-1.6, 2.25, -0.72], [0.9, 2.25, -0.72], Ch.Glass, SHELTER_GLASS, [0, 0, -1]);
  b.box(1.25, 0.2, -0.71, 0.7, 2.05, 0.12, Ch.Cabin, 0xb9c6cf);
  for (const x of [-1.6, 1.6]) {
    b.quad([x, 0.25, -0.7], [x, 0.25, 0.35], [x, 2.25, 0.35], [x, 2.25, -0.7], Ch.Glass, SHELTER_GLASS, [Math.sign(x), 0, 0]);
    b.quad([x, 0.25, 0.35], [x, 0.25, -0.7], [x, 2.25, -0.7], [x, 2.25, 0.35], Ch.Glass, SHELTER_GLASS, [-Math.sign(x), 0, 0]);
  }
  for (const x of [-1.62, 1.62]) for (const z of [-0.72, 0.36]) b.box(x, 0.06, z, 0.07, 2.2, 0.07, Ch.Chrome, 0x7c8288);
  b.box(0, 2.26, -0.12, 3.6, 0.1, 1.9, Ch.Chrome, 0x8a9096, { top: Ch.Paint, topColor: 0xffffff });
  b.box(0, 2.2, 0.83, 3.62, 0.16, 0.05, Ch.Paint, 0xffffff);
  b.box(-0.35, 0.45, -0.48, 2.2, 0.06, 0.38, Ch.Fixed, WOOD);
  b.box(-1.3, 0.06, -0.48, 0.07, 0.39, 0.3, Ch.Fixed, DARK);
  b.box(0.6, 0.06, -0.48, 0.07, 0.39, 0.3, Ch.Fixed, DARK);
  // stop totem
  b.box(2.3, 0.06, 0.55, 0.1, 2.6, 0.1, Ch.Fixed, DARK);
  b.box(2.3, 2.6, 0.55, 0.62, 0.62, 0.1, Ch.Paint, 0xffffff);
  b.lens(2.3, 2.91, 0.61, 0.46, 0.46, 1, Ch.Sign, 0xf2f2ee);
  b.lens(2.3, 2.91, 0.49, 0.46, 0.46, -1, Ch.Sign, 0xf2f2ee);
  return b;
}

function metroEntrance(): VB {
  const b = new VB();
  // stairwell: low parapet walls around a dark opening (the stairs vanish below
  // the pavement), glass canopy, totem with a lit sign in the line color
  const W = 3.2, D = 5.0;
  b.box(0, 0, -0.3, W + 0.5, 0.05, D + 0.6, Ch.Satin, 0xa9a59c);
  b.quad([-W / 2, 0.06, D / 2 - 0.3], [W / 2, 0.06, D / 2 - 0.3], [W / 2, 0.06, -D / 2 - 0.3], [-W / 2, 0.06, -D / 2 - 0.3], Ch.Fixed, 0x0c0c0e, [0, 1, 0]);
  for (let k = 0; k < 5; k++) {
    const z0 = D / 2 - 0.3 - k * 0.42;
    const shade = [0x7a7770, 0x5c5a55, 0x44423f, 0x2e2d2b, 0x1d1c1b][k];
    b.quad([-W / 2 + 0.1, 0.07, z0], [W / 2 - 0.1, 0.07, z0], [W / 2 - 0.1, 0.07, z0 - 0.2], [-W / 2 + 0.1, 0.07, z0 - 0.2], Ch.Fixed, shade, [0, 1, 0]);
  }
  for (const s of [1, -1]) b.box((s * (W + 0.25)) / 2, 0, -0.3, 0.25, 1.0, D + 0.25, Ch.Satin, CONCRETE, { top: Ch.Chrome, topColor: 0x8a9096 });
  b.box(0, 0, -D / 2 - 0.3, W + 0.5, 1.0, 0.25, Ch.Satin, CONCRETE, { top: Ch.Chrome, topColor: 0x8a9096 });
  b.box(0, 2.7, -0.6, W + 0.7, 0.08, D - 0.2, Ch.Glass, GLASS, { top: Ch.Glass });
  for (const x of [-(W + 0.25) / 2, (W + 0.25) / 2]) for (const z of [-2.6, 1.6]) b.box(x, 1.0, z, 0.1, 1.7, 0.1, Ch.Chrome, 0x7c8288);
  b.box(0, 2.72, 1.95, W + 0.8, 0.28, 0.1, Ch.Paint, 0xffffff);
  b.box(2.35, 0, 2.5, 0.18, 3.2, 0.18, Ch.Fixed, DARK);
  b.box(2.35, 3.2, 2.5, 0.72, 0.72, 0.72, Ch.Paint, 0xffffff);
  for (const f of [1, -1] as const) b.lens(2.35, 3.56, 2.5 + f * 0.365, 0.52, 0.52, f, Ch.Sign, 0xf6f4ee);
  for (const f of [1, -1]) b.quad([2.35 + f * 0.365, 3.3, 2.24], [2.35 + f * 0.365, 3.3, 2.76], [2.35 + f * 0.365, 3.82, 2.76], [2.35 + f * 0.365, 3.82, 2.24], Ch.Sign, 0xf6f4ee, [f, 0, 0]);
  return b;
}

function trainPlatform(): VB {
  const b = new VB();
  // two side platforms flanking the double track (local X across the track)
  for (const s of [1, -1]) {
    b.box(s * 5.0, -0.2, 0, 2.3, 1.1, 15.2, Ch.Satin, CONCRETE, { top: Ch.Satin, topColor: 0xc9c5bb });
    b.box(s * 3.93, 0.9, 0, 0.16, 0.012, 15.2, Ch.Satin, 0xe8c63a);
    for (const z of [-5.5, 0, 5.5]) b.box(s * 5.6, 0.9, z, 0.12, 2.6, 0.12, Ch.Fixed, DARK);
    b.box(s * 5.2, 3.5, 0, 2.6, 0.14, 13.5, Ch.Fixed, DARK, { top: Ch.Paint, topColor: 0xffffff });
    b.box(s * 4.4, 0.9, 4.0, 0.08, 1.9, 0.08, Ch.Fixed, DARK);
    b.box(s * 4.4, 2.8, 4.0, 0.1, 0.4, 1.4, Ch.Paint, 0xffffff);
    b.sidePanel(s * 4.46, 2.83, 3.17, 3.4, 4.6, Ch.Sign, 0xf2f2ee);
    b.box(s * 5.2, 0.9, -3.0, 1.4, 0.45, 0.4, Ch.Fixed, WOOD);
  }
  return b;
}

function pier(): VB {
  const b = new VB();
  b.box(0, -0.2, 0, 3.4, 0.6, 9.0, Ch.Satin, 0x8f9296, { top: Ch.Fixed, topColor: WOOD });
  for (const x of [-1.5, 1.5]) for (const z of [-4.2, 0, 4.2]) b.box(x, 0.4, z, 0.22, 0.4, 0.22, Ch.Fixed, DARK);
  for (const x of [-1.65, 1.65]) b.box(x, 0.4, 0, 0.05, 0.9, 8.6, Ch.Chrome, 0xb0b4b8, { skip: 'b' });
  b.box(1.2, 0.4, 3.6, 0.1, 2.6, 0.1, Ch.Fixed, DARK);
  b.box(1.2, 3.0, 3.6, 0.6, 0.6, 0.1, Ch.Paint, 0xffffff);
  b.lens(1.2, 3.3, 3.66, 0.44, 0.44, 1, Ch.Sign, 0xf2f2ee);
  b.box(-0.6, 0.4, -2.5, 1.6, 2.2, 2.2, Ch.Satin, 0xeeeeea, { top: Ch.Paint, topColor: 0xffffff });
  b.sidePanel(0.21, 1.2, 2.2, -3.4, -1.6, Ch.Cabin, GLASS);
  return b;
}

function monorailStation(): VB {
  const b = new VB();
  const H = MONORAIL_HEIGHT;
  // side platforms outside the two guideways (beams at ±2.1 m, cars ±1.35 m wide),
  // columns on the sidewalks, a long canopy in the line color
  for (const s of [1, -1]) {
    b.box(s * 5.0, H - 0.35, 0, 2.7, 0.55, 15, Ch.Satin, CONCRETE, { bottom: true, top: Ch.Satin, topColor: 0xc9c5bb });
    b.box(s * 3.72, H + 0.2, 0, 0.12, 0.012, 15, Ch.Satin, 0xe8c63a);
    b.box(s * 6.3, H + 0.2, 0, 0.06, 1.05, 15, Ch.Glass, GLASS);
    for (const z of [-6.5, 6.5]) b.box(s * 7.3, 0, z, 0.5, H + 3.9, 0.5, Ch.Satin, CONCRETE);
    b.box(s * 6.8, H - 0.45, 0, 1.2, 0.3, 14.4, Ch.Satin, CONCRETE, { bottom: true });
    for (const z of [-4, 0, 4]) b.box(s * 5.6, H + 0.2, z, 0.1, 3.4, 0.1, Ch.Chrome, 0x7c8288);
  }
  b.box(0, H + 3.6, 0, 15.6, 0.3, 16, Ch.Satin, 0xdcdcd8, { top: Ch.Satin, topColor: 0xcfcfca, bottom: true });
  for (const s of [1, -1]) b.box(s * 7.8, H + 3.5, 0, 0.12, 0.5, 16, Ch.Paint, 0xffffff);
  b.sidePanel(7.87, H + 3.55, H + 3.9, -4, 4, Ch.Sign, 0xf2f2ee);
  b.sidePanel(-7.87, H + 3.55, H + 3.9, 4, -4, Ch.Sign, 0xf2f2ee);
  return b;
}

const KIND_OF: Record<TransitMode, StopKind> = { bus: StopKind.Shelter, tram: StopKind.Shelter, metro: StopKind.Metro, train: StopKind.Platform, ferry: StopKind.Pier, monorail: StopKind.Monorail };

export class TransitRenderer {
  readonly group = new THREE.Group();
  private world: World | null = null;
  private version = -1;
  private uniforms: VehicleUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  private material: THREE.MeshStandardMaterial | null = null;
  private stopGeos: THREE.BufferGeometry[] = [];
  private stops: Batch[] = [];
  private beams: THREE.Mesh[] = [];
  private overlay = new THREE.Group();
  private overlayMat: THREE.ShaderMaterial | null = null;
  private beamMat: THREE.MeshStandardMaterial | null = null;
  private stopPos: { kind: StopKind; x: number; y: number; z: number; yaw: number; color: number }[] = [];
  private time = 0;

  constructor(private game: Game) {
    this.group.name = 'transit';
    this.overlay.name = 'transit-overlay';
    this.overlay.visible = false;
  }

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.material = createBodyMaterial(this.uniforms);
    this.overlayMat = createRibbonMaterial(0.9, 2.4, 1.25);
    this.beamMat = new THREE.MeshStandardMaterial({ color: 0xc4c3bd, roughness: 0.85, metalness: 0 });
    const builders = [shelter, metroEntrance, trainPlatform, pier, monorailStation];
    for (let k = 0; k < StopKind.COUNT; k++) {
      const g = builders[k]().build();
      this.stopGeos.push(g);
      this.stops.push(new Batch(g, this.material, true, this.group, 8));
    }
    this.group.add(this.overlay);
    this.game.renderer.scene.add(this.group);
    this.version = -1;
  }

  onWorldUnloaded(): void {
    for (const b of this.stops) b.dispose();
    this.stops = [];
    for (const g of this.stopGeos) g.dispose();
    this.stopGeos = [];
    this.clearBeams();
    this.clearOverlay();
    this.material?.dispose();
    this.overlayMat?.dispose();
    this.beamMat?.dispose();
    this.material = null;
    this.overlayMat = null;
    this.beamMat = null;
    this.group.clear();
    this.group.removeFromParent();
    this.world = null;
  }

  private get traffic(): TrafficSystem | null {
    return (this.game as { traffic?: TrafficSystem }).traffic ?? null;
  }

  private clearBeams(): void {
    for (const m of this.beams) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.beams = [];
  }

  private clearOverlay(): void {
    for (const c of this.overlay.children.slice()) {
      (c as THREE.Mesh).geometry?.dispose();
      c.removeFromParent();
    }
  }

  update(dt: number): void {
    const w = this.world, ts = this.traffic;
    if (!w || !ts || !this.material) return;
    this.time += dt;
    const night = this.game.renderer.lighting.night;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uNight.value = night;
    if (ts.transit.version !== this.version) {
      this.version = ts.transit.version;
      this.rebuild(ts);
    }
    // stop markers: lights follow the night
    const lights = Math.min(1, Math.max(0, (night - 0.15) * 2));
    for (const b of this.stops) b.count = 0;
    for (const s of this.stopPos) this.stops[s.kind].write(s.x, s.y, s.z, s.yaw, 0, 1, s.color, 0, 0, lights, 0);
    for (const b of this.stops) b.commit();
    let toolOn = false;
    try {
      toolOn = this.game.tools?.current?.id === 'transit';
    } catch {
      toolOn = false;
    }
    this.overlay.visible = toolOn;
    if (toolOn && this.overlayMat) {
      const r = this.game.renderer;
      (this.overlayMat.uniforms.uPixel as { value: number }).value = pixelFactor(r.camera, r.renderer.domElement.height || 800);
    }
  }

  private rebuild(ts: TrafficSystem): void {
    const w = this.world!;
    this.stopPos = [];
    const rb = new RibbonBuilder();
    this.clearBeams();
    this.clearOverlay();
    const rs = this.game.roadSurface;
    const roadY = (x: number, z: number) => (rs ? rs.heightAt(x, z) : w.heightAt(x, z));
    for (const line of w.transitLines) {
      const rt = ts.transit.rt.get(line.id);
      const color = colorNum(line.color);
      const kind = KIND_OF[line.mode];
      // stop poses
      for (let k = 0; k < line.stops.length; k++) {
        const s = line.stops[k];
        const cx = (s.x + 0.5) * CELL, cz = (s.y + 0.5) * CELL;
        let travel = -1;
        if (rt?.cells && rt.stopPi.length > k) {
          const cells = rt.cells, n = cells.length, pi = rt.stopPi[k];
          const prev = cells[(pi - 1 + n) % n], cur = cells[pi], next = cells[(pi + 1) % n];
          travel = prev !== cur ? dirBetween(w.size, prev, cur) : dirBetween(w.size, cur, next);
        }
        const rtype = w.roadAt(s.x, s.y);
        if (kind === StopKind.Shelter) {
          const d = travel >= 0 ? travel : 1;
          const right = (d + 1) & 3;
          const side = ts.hand;
          let off = SIDEWALK_OFFSET[rtype] || ROAD_HALF_WIDTH[rtype] + 1.2;
          if (rtype === RoadType.Pedestrian) off = 5.5;
          const x = cx + DIR_DX[right] * off * side, z = cz + DIR_DY[right] * off * side;
          // face the road: toward -right
          const fx = -DIR_DX[right] * side, fz = -DIR_DY[right] * side;
          this.stopPos.push({ kind, x, y: roadY(x, z) + SIDEWALK_LIFT - ROAD_LIFT, z, yaw: Math.atan2(fx, fz), color });
        } else if (kind === StopKind.Platform || kind === StopKind.Monorail) {
          const d = travel >= 0 ? travel : 1;
          const yaw = Math.atan2(DIR_DX[d], DIR_DY[d]);
          this.stopPos.push({ kind, x: cx, y: kind === StopKind.Monorail ? roadY(cx, cz) : w.cellHeight(s.x, s.y) + ROAD_LIFT, z: cz, yaw, color });
        } else if (kind === StopKind.Pier) {
          // moor toward the nearest shore
          let yaw = 0;
          for (let d = 0; d < 4; d++) if (!w.isWater(s.x + DIR_DX[d], s.y + DIR_DY[d])) yaw = Math.atan2(DIR_DX[d], DIR_DY[d]);
          const lvl = w.waterLevel(s.x, s.y);
          this.stopPos.push({ kind, x: cx, y: lvl > -1000 ? lvl : w.cellHeight(s.x, s.y), z: cz, yaw, color });
        } else {
          // metro: on a sidewalk when placed on a road, else the cell center
          let x = cx, z = cz, yaw = (k * 1.3) % (Math.PI * 2);
          if (rtype !== RoadType.None && rtype !== RoadType.Rail) {
            const m = w.roadMask(s.x, s.y);
            const alongX = (m & 10) !== 0 && (m & 5) === 0;
            const off = SIDEWALK_OFFSET[rtype] || ROAD_HALF_WIDTH[rtype] + 1.5;
            if (alongX) {
              z += off;
              yaw = Math.PI / 2;
            } else {
              x += off;
              yaw = 0;
            }
          }
          this.stopPos.push({ kind, x, y: rtype ? roadY(x, z) + SIDEWALK_LIFT - ROAD_LIFT : w.heightAt(x, z), z, yaw, color });
        }
      }
      if (!rt) continue;
      if (line.mode === 'monorail' && rt.free && rt.cells) this.buildGuideway(ts, rt.free.pts, rt.cells);
      if (rt.overlay) this.buildOverlay(rb, rt.overlay, color, line.mode);
      for (const s of line.stops) this.stopDisc(rb, s.x, s.y, color, line.mode, ts);
    }
    if (!rb.empty) {
      const m = new THREE.Mesh(rb.build(), this.overlayMat!);
      m.renderOrder = 12;
      m.frustumCulled = false;
      this.overlay.add(m);
    }
  }

  private buildOverlay(rb: RibbonBuilder, pts: Float32Array, color: number, mode: TransitMode): void {
    const n = pts.length / 3;
    if (n < 2) return;
    const w = this.world!;
    const metro = mode === 'metro';
    const lift = metro ? 1.2 : 1.1;
    for (let j = 0; j < n - 1; j++) {
      const ax = pts[j * 3], az = pts[j * 3 + 2], bx = pts[j * 3 + 3], bz = pts[j * 3 + 5];
      const ay = pts[j * 3 + 1], by = pts[j * 3 + 4];
      if (!metro) {
        rb.segment(ax, ay + lift, az, bx, by + lift, bz, 1.25, color);
        continue;
      }
      // metro: dashed line over the surface (the tunnel runs underneath)
      const l = Math.hypot(bx - ax, bz - az);
      const segs = Math.max(1, Math.round(l / 12));
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 0.6) / segs;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        rb.segment(x0, w.heightAt(x0, z0) + lift, z0, x1, w.heightAt(x1, z1) + lift, z1, 1.25, color);
      }
    }
  }

  private stopDisc(rb: RibbonBuilder, x: number, y: number, color: number, mode: TransitMode, ts: TrafficSystem): void {
    const w = this.world!;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
    const base = mode === 'ferry' ? Math.max(w.waterLevel(x, y), w.cellHeight(x, y)) : mode === 'monorail' ? ts.transit.freeHeight('monorail', cx, cz) : (this.game.roadSurface?.heightAt(cx, cz) ?? w.heightAt(cx, cz));
    rb.disc(cx, base + 1.5, cz, 3.2, color);
    rb.disc(cx, base + 1.55, cz, 2.0, 0xffffff);
  }

  /** concrete beam along the free path + T-pillars on road centers */
  private buildGuideway(ts: TrafficSystem, pts: Float32Array, cells: Int32Array): void {
    const w = this.world!;
    const pos: number[] = [], nrm: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let k = 0; k < 6; k++) nrm.push(n[0], n[1], n[2]);
    };
    const n = pts.length / 2;
    // resample the path every ~5 m
    const rx: number[] = [], rz: number[] = [];
    let acc = 0;
    rx.push(pts[0]);
    rz.push(pts[1]);
    for (let j = 1; j < n; j++) {
      const dx = pts[j * 2] - pts[j * 2 - 2], dz = pts[j * 2 + 1] - pts[j * 2 - 1];
      acc += Math.hypot(dx, dz);
      if (acc >= 5 || j === n - 1) {
        rx.push(pts[j * 2]);
        rz.push(pts[j * 2 + 1]);
        acc = 0;
      }
    }
    const top = (x: number, z: number) => ts.transit.freeHeight('monorail', x, z);
    const HW = 0.45, HH = 1.3;
    for (let j = 0; j < rx.length - 1; j++) {
      const ax = rx[j], az = rz[j], bx = rx[j + 1], bz = rz[j + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1e-3) continue;
      const px = (-dz / l) * HW, pz = (dx / l) * HW;
      const ya = top(ax, az), yb = top(bx, bz);
      // top, two sides, bottom
      quad([ax - px, ya, az - pz], [ax + px, ya, az + pz], [bx + px, yb, bz + pz], [bx - px, yb, bz - pz], [0, 1, 0]);
      quad([ax + px, ya, az + pz], [ax + px, ya - HH, az + pz], [bx + px, yb - HH, bz + pz], [bx + px, yb, bz + pz], [px / HW, 0, pz / HW]);
      quad([ax - px, ya - HH, az - pz], [ax - px, ya, az - pz], [bx - px, yb, bz - pz], [bx - px, yb - HH, bz - pz], [-px / HW, 0, -pz / HW]);
      quad([ax - px, ya - HH, az - pz], [bx - px, yb - HH, bz - pz], [bx + px, yb - HH, bz + pz], [ax + px, ya - HH, az + pz], [0, -1, 0]);
    }
    // pillars on straight road cells (every other cell), with a cross head
    const size = w.size;
    const seen = new Set<number>();
    for (let j = 0; j < cells.length; j += 2) {
      const c = cells[j];
      if (seen.has(c)) continue;
      seen.add(c);
      const x = c % size, y = (c / size) | 0;
      const m = w.roadMask(x, y);
      const ns = (m & 5) !== 0 && (m & 10) === 0, ew = (m & 10) !== 0 && (m & 5) === 0;
      if (!ns && !ew) continue;
      const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
      const g0 = this.game.roadSurface?.heightAt(cx, cz) ?? w.heightAt(cx, cz);
      const yTop = g0 + MONORAIL_HEIGHT - HH;
      const P = 0.42;
      const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
        quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
        quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
        quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
        quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
        quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
        quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
      };
      box(cx - P, cx + P, g0 - 0.5, yTop - 0.6, cz - P, cz + P);
      if (ns) box(cx - 2.8, cx + 2.8, yTop - 0.6, yTop, cz - 0.55, cz + 0.55);
      else box(cx - 0.55, cx + 0.55, yTop - 0.6, yTop, cz - 2.8, cz + 2.8);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.beamMat!);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.beams.push(mesh);
  }
}
