// GameRenderer — three.js core for URBIS: renderer + depth strategy, camera,
// sky & lighting, terrain, water, trees, overlays, post-processing, picking.
//
// Depth precision (12 km world, 1 m details):
//  • When EXT_clip_control is available the renderer runs with a REVERSED
//    depth buffer and the scene renders into a 32-bit float depth texture —
//    near-uniform precision from 0.25 m to the horizon.
//  • Otherwise the near plane follows the camera altitude (0.8–60 m) so a
//    standard 24-bit buffer keeps road/terrain separation at every zoom.
//  Other renderers: lift decals (roads, zones) by ROAD_LIFT and use
//  polygonOffset (factor -1..-2, units -1..-4); never write gl_FragDepth;
//  include three's fog chunks (`fog: true`) so aerial perspective matches.
//
// Terrain surface: the drawn terrain equals world.heights everywhere except
// free shoreline vertices (no road / zone / building on the adjacent cells),
// which are smoothed so banks do not show the cell staircase. Anything placed
// on free banks should use groundHeight(); lots and roads keep true heights.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { World } from '../world/World';
import type { Cell, FieldId } from '../core/types';
import { Layer } from '../core/types';
import type { Settings } from '../settings/types';
import { CELL, CHUNK } from '../core/constants';
import { calendar } from '../core/time';
import { CameraController } from './CameraController';
import { createSharedUniforms, type SharedUniforms } from './sky/SharedUniforms';
import { SkySystem } from './sky/SkySystem';
import { createTextureSet, type TextureSet } from './textures/procedural';
import { TerrainRenderer } from './terrain/TerrainRenderer';
import { pickHeightfield } from './terrain/pick';
import { WaterRenderer } from './water/WaterRenderer';
import { TreeRenderer } from './props/TreeRenderer';
import { OverlayRenderer, INFO_VIEW_DESAT } from './overlay/OverlayRenderer';
import { PostFX } from './post/PostFX';

export interface PickResult {
  cell: Cell;
  /** world-space hit point on terrain (or water surface) */
  point: THREE.Vector3;
  onWater: boolean;
}

export interface ViewInfo {
  /** camera focus in cell coords */
  focusX: number;
  focusY: number;
  /** render radius in cells (from settings.graphics.renderDistance) */
  radiusCells: number;
  cameraPos: THREE.Vector3;
  /** camera height above ground (m) — used for LOD */
  altitude: number;
  frustum: THREE.Frustum;
}

export interface LightingInfo {
  /** normalized direction TOWARD the sun */
  sunDir: THREE.Vector3;
  /** 0 = full night, 1 = full day */
  daylight: number;
  /** 0 = day, 1 = night (drives window/street lights) */
  night: number;
  sunColor: THREE.Color;
  ambientColor: THREE.Color;
}

const SHADOW_RADIUS_BY_QUALITY: Record<Settings['graphics']['shadows'], number> = { off: 0, low: 650, medium: 1000, high: 1500 };

const _SPRING_CANOPY = new THREE.Color().setRGB(0.07, 0.12, 0.04);
const _AUTUMN_CANOPY = new THREE.Color().setRGB(0.19, 0.08, 0.028);
const _BARE_CANOPY = new THREE.Color().setRGB(0.075, 0.062, 0.05);
const _CONIFER_CANOPY = new THREE.Color().setRGB(0.028, 0.058, 0.034);
const _EVERGREEN_CANOPY = new THREE.Color().setRGB(0.07, 0.083, 0.045);

function smooth01(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraCtl: CameraController;
  readonly canvas: HTMLCanvasElement;
  readonly lighting: LightingInfo = {
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(), daylight: 1, night: 0,
    sunColor: new THREE.Color(1, 1, 1), ambientColor: new THREE.Color(0.5, 0.55, 0.6),
  };
  stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  overlay: FieldId | null = null;
  protected world: World | null = null;

  // ── additive public API ────────────────────────────────────────────────
  /** live uniforms (time, wind, sun, weather, noise) any material may share */
  readonly shared: SharedUniforms = createSharedUniforms();
  /** procedural textures (noise, water normals, detail normals) */
  readonly textures: TextureSet;
  readonly sky: SkySystem;
  readonly post: PostFX;
  /** true when the reversed float depth buffer is active */
  readonly reversedDepth: boolean;
  terrain: TerrainRenderer | null = null;
  water: WaterRenderer | null = null;
  trees: TreeRenderer | null = null;
  overlays: OverlayRenderer | null = null;
  /** current render radius in meters (renderDistance × CHUNK × CELL) */
  renderRadius = 10 * CHUNK * CELL;

  private container: HTMLElement;
  private settingsCache: Settings['graphics'] | null = null;
  private time = 0;
  private frameStart = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private worldUnsub: (() => void)[] = [];
  private viewInfo: ViewInfo;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private resizeObserver: ResizeObserver | null = null;
  private fogEnabled = true;
  private cloudsEnabled = true;
  private treeDensity = 1;
  private shadowRadius = 1000;
  private lastSize = new THREE.Vector2(-1, -1);
  private whiteBalance = new THREE.Color(1, 1, 1);
  private readonly _canopy = new THREE.Color();
  private readonly _ndc = new THREE.Vector2();
  private readonly _rc = new THREE.Raycaster();
  private readonly _v = new THREE.Vector3();

  constructor(protected game: Game, container: HTMLElement) {
    this.container = container;
    const params = {
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
      alpha: false,
      reversedDepthBuffer: true,
    } as THREE.WebGLRendererParameters;
    this.renderer = new THREE.WebGLRenderer(params);
    const r = this.renderer;
    this.reversedDepth = !!(r.capabilities as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.setClearColor(0x000000, 1);
    this.canvas = r.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
    this.camera.position.set(0, 400, 400);
    this.cameraCtl = new CameraController(game, this.camera);
    this.scene.matrixWorldAutoUpdate = true;

    this.textures = createTextureSet();
    this.shared.uNoise.value = this.textures.noise;
    this.sky = new SkySystem(r, this.scene, this.shared, this.lighting, this.textures.noise);
    this.post = new PostFX(r, this.scene, this.camera, this.shared);

    this.viewInfo = { focusX: 0, focusY: 0, radiusCells: 320, cameraPos: this.camera.position, altitude: 200, frustum: this.frustum };

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(onResize);
      this.resizeObserver.observe(container);
    }
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const s = this.settingsCache;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * (s ? s.resolutionScale : 1);
    const key = w * 10000 + h + pr * 1e9;
    if (this.lastSize.x === key) return;
    this.lastSize.x = key;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    const buf = this.renderer.getDrawingBufferSize(this._ndc);
    this.post.setSize(buf.x, buf.y);
  }

  async init(): Promise<void> {
    // compile the always-present programs up front (sky)
    this.renderer.compile(this.scene, this.camera);
  }

  onWorldLoaded(world: World): void {
    this.onWorldUnloaded();
    this.world = world;
    this.shared.uMapSize.value = world.size * CELL;
    this.shared.uSeaLevel.value = world.seaLevel;
    this.shared.uFlood.value = world.floodOffset;
    this.cameraCtl.onWorldLoaded(world);
    const terrain = (this.terrain = new TerrainRenderer(world, this.shared, this.textures.detailNormal));
    const water = (this.water = new WaterRenderer(world, this.shared, terrain, this.textures.waterNormal));
    const trees = (this.trees = new TreeRenderer(world, this.shared));
    trees.minHeight = terrain.minHeight;
    trees.maxHeight = terrain.maxHeight;
    trees.groundAt = (wx, wz) => terrain.data.heightAt(wx, wz);
    this.overlays = new OverlayRenderer(world, this.shared, terrain);
    this.scene.add(terrain.group, water.group, trees.group);
    const ev = this.game.events;
    this.worldUnsub.push(
      ev.on('world:changed', ({ rect, layers }) => {
        this.terrain?.onWorldChanged(rect, layers);
        this.water?.onWorldChanged(rect, layers);
        this.trees?.onWorldChanged(rect, layers);
        if (layers & (Layer.Road | Layer.Water)) this.overlays?.onFieldsUpdated(null);
        if (this.trees && this.terrain) {
          this.trees.minHeight = this.terrain.minHeight;
          this.trees.maxHeight = this.terrain.maxHeight;
        }
      }),
      ev.on('fields:updated', (ids) => this.overlays?.onFieldsUpdated(ids)),
      ev.on('weather:changed', () => this.sky.invalidateEnvironment()),
    );
    if (this.overlay) this.overlays.setField(this.overlay);
    this.sky.snap();
  }

  /** skip weather / lighting transitions: the next frame shows the current state directly */
  snapTransitions(): void {
    this.sky.snap();
  }

  onWorldUnloaded(): void {
    for (const u of this.worldUnsub) u();
    this.worldUnsub.length = 0;
    if (this.terrain) this.scene.remove(this.terrain.group);
    if (this.water) this.scene.remove(this.water.group);
    if (this.trees) this.scene.remove(this.trees.group);
    this.overlays?.dispose();
    this.trees?.dispose();
    this.water?.dispose();
    this.terrain?.dispose();
    this.overlays = null;
    this.trees = null;
    this.water = null;
    this.terrain = null;
    this.cameraCtl.onWorldUnloaded();
    this.world = null;
  }

  update(dt: number): void {
    this.resize();
    this.time += dt;
    this.shared.uTime.value = this.time;
    const ctl = this.cameraCtl;
    ctl.update(dt);
    const cam = this.camera;
    const w = this.world;

    // dynamic near / far planes
    const alt = Math.max(1, Math.min(ctl.altitude, ctl.distance));
    cam.near = this.reversedDepth ? THREE.MathUtils.clamp(alt * 0.04, 0.25, 8) : THREE.MathUtils.clamp(alt * 0.22, 0.8, 60);
    const density = Math.max(this.sky.fog.density, 1e-6);
    cam.far = THREE.MathUtils.clamp(Math.max(3.2 / density, this.renderRadius * 1.5, 9000), 9000, 90000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // world-dependent systems
    if (w && this.terrain) {
      this.updateSeason(w);
      this.terrain.update(cam);
      this.water?.update(ctl.focus.x, ctl.focus.y);
      this.trees?.update({ camera: cam, radius: this.renderRadius, shadowRadius: this.shadowRadius, density: this.treeDensity });
    }
    this.overlays?.update(dt, this.lighting.night);

    // sky, lights, fog
    const focusW = this._v.set(ctl.focus.x * CELL, ctl.focusHeight, ctl.focus.y * CELL);
    this.sky.update({
      world: w,
      camera: cam,
      focus: focusW,
      distance: ctl.distance,
      renderRadius: this.renderRadius,
      fogEnabled: this.fogEnabled,
      cloudsEnabled: this.cloudsEnabled,
      viewportHeight: this.renderer.getDrawingBufferSize(this._ndc).y,
      dt,
      time: this.time,
    });

    // water reflects the sky at full strength (scene.environmentIntensity only dims diffuse IBL)
    const env = this.scene.environment;
    if (this.water && env && this.water.seaMaterial.envMap !== env) {
      for (const m of [this.water.seaMaterial, this.water.inlandMaterial]) {
        m.envMap = env;
        m.envMapIntensity = 1;
        m.needsUpdate = true;
      }
    }

    // view info for other renderers
    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, cam.coordinateSystem, (cam as unknown as { reversedDepth?: boolean }).reversedDepth ?? false);
    const vi = this.viewInfo;
    vi.focusX = ctl.focus.x;
    vi.focusY = ctl.focus.y;
    vi.radiusCells = Math.round(this.renderRadius / CELL);
    vi.cameraPos = cam.position;
    vi.altitude = ctl.altitude;
    vi.frustum = this.frustum;
  }

  /** seasonal parameters for terrain + vegetation (continuous through the year) */
  private updateSeason(w: World): void {
    const theme = w.theme;
    const cal = calendar(w.time.day);
    const yp = cal.yearProgress;
    const tc = Math.cos(2 * Math.PI * (yp - 0.55)); // +1 mid-July, -1 mid-January
    const summer = smooth01(tc, 0.2, 0.9);
    const winter = smooth01(-tc, 0.2, 0.9);
    const seasonal = Math.min(1, theme.tempSwing / 11);
    const tropical = theme.tempMean > 21;
    let leaf = 1, spring = 0, autumn = 0, blossom = 0;
    if (!tropical) {
      const bud = smooth01(yp, 0.19, 0.3);
      const fall = 1 - smooth01(yp, 0.84, 0.95);
      leaf = Math.min(bud, fall);
      leaf = 1 - (1 - leaf) * seasonal;
      if (theme.id === 'mediterranean') leaf = Math.max(leaf, 0.35);
      spring = smooth01(yp, 0.19, 0.28) * (1 - smooth01(yp, 0.32, 0.46));
      autumn = smooth01(yp, 0.69, 0.83) * seasonal;
      blossom = smooth01(yp, 0.21, 0.26) * (1 - smooth01(yp, 0.29, 0.36));
    } else {
      spring = 0.25;
      blossom = smooth01(yp, 0.2, 0.25) * (1 - smooth01(yp, 0.3, 0.38)) * 0.8;
    }
    this.trees?.setSeason(leaf, spring, autumn, blossom);
    const tu = this.terrain!.uniforms;
    // distant forest canopy colour: theme species mix × season
    let conifer = 0, evergreen = 0, decid = 0;
    for (const sp of theme.trees) {
      if (sp === 'pine' || sp === 'spruce' || sp === 'cypress') conifer++;
      else if (sp === 'olive' || sp === 'palm' || sp === 'cactus' || sp === 'acacia') evergreen++;
      else decid++;
    }
    const tot = Math.max(1, conifer + evergreen + decid);
    const dc = this._canopy.setRGB(0.045, 0.085, 0.032).lerp(_SPRING_CANOPY, spring * 0.6).lerp(_AUTUMN_CANOPY, autumn * 0.85);
    dc.lerp(_BARE_CANOPY, 1 - leaf);
    const kd = decid / tot, kc = conifer / tot, ke = evergreen / tot;
    tu.uCanopyCol.value.setRGB(
      dc.r * kd + _CONIFER_CANOPY.r * kc + _EVERGREEN_CANOPY.r * ke,
      dc.g * kd + _CONIFER_CANOPY.g * kc + _EVERGREEN_CANOPY.g * ke,
      dc.b * kd + _CONIFER_CANOPY.b * kc + _EVERGREEN_CANOPY.b * ke,
    );
    const dryness = 1 - theme.rainfall;
    tu.uDry.value = THREE.MathUtils.clamp(dryness * 0.3 + summer * (0.04 + dryness * 0.34) + winter * 0.38 * seasonal - spring * 0.15, 0, 1);
    tu.uLush.value = spring * 0.9 + (1 - summer) * (1 - winter) * 0.2;
    tu.uAutumn.value = autumn * 0.65;
    const t = this.terrain!;
    const range = t.maxHeight - t.minHeight;
    if (theme.snowiness > 0.5 && range > 40) {
      // permanent snow caps on high ground, reaching lower in winter
      tu.uSnowLine.value = t.minHeight + range * (0.88 - 0.4 * winter * theme.snowiness + 0.06 * summer);
    } else if (theme.snowiness > 0 && range > 40 && winter > 0.05) {
      tu.uSnowLine.value = t.minHeight + range * (1.25 - 0.9 * winter * theme.snowiness);
    } else {
      tu.uSnowLine.value = 1e5;
    }
  }

  render(): void {
    const t0 = performance.now();
    const r = this.renderer;
    r.info.reset();
    const sky = this.sky;
    const s = this.settingsCache;
    const night = this.lighting.night;
    // subtle warm/cool grading with time of day
    const golden = (1 - night) * (1 - smooth01(this.lighting.sunDir.y, 0.05, 0.45));
    this.whiteBalance.setRGB(1 + 0.04 * golden - 0.03 * night, 1, 1 - 0.05 * golden + 0.05 * night);
    const overlayK = this.overlays ? this.overlays.fade : 0;
    this.post.render({
      exposure: sky.exposure,
      bloomThreshold: sky.bloomThreshold,
      bloomStrength: 0.2 + 0.3 * night,
      desaturate: overlayK * INFO_VIEW_DESAT,
      sunDir: sky.keyDir,
      cloudShadow: s && !s.clouds ? 0 : THREE.MathUtils.clamp(this.shared.uCloudCover.value * 0.9, 0, 0.42) * (1 - sky.overcast) * (1 - night) * THREE.MathUtils.smoothstep(sky.keyDir.y, 0.02, 0.2),
      distance: this.cameraCtl.distance,
      pitch: this.cameraCtl.effectivePitch,
      whiteBalance: this.whiteBalance,
      saturation: 1.06 - 0.12 * sky.overcast,
      contrast: 1.05,
      vignette: 0.32,
      nightLift: night * (1 - 0.5 * sky.overcast),
    });
    const now = performance.now();
    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    this.stats.frameMs = now - t0;
    if (this.frameStart) {
      this.fpsAcc += (now - this.frameStart) / 1000;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.stats.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    this.frameStart = now;
  }

  pick(clientX: number, clientY: number): PickResult | null {
    const w = this.world;
    if (!w || !this.terrain) return null;
    const ray = this.screenToRay(clientX, clientY);
    const hit = pickHeightfield(w, ray, this.terrain.minHeight, this.terrain.maxHeight);
    if (!hit) return null;
    const cell = { x: Math.min(w.size - 1, Math.max(0, Math.floor(hit.point.x / CELL))), y: Math.min(w.size - 1, Math.max(0, Math.floor(hit.point.z / CELL))) };
    return { cell, point: hit.point, onWater: hit.onWater };
  }

  screenToRay(clientX: number, clientY: number): THREE.Ray {
    const r = this.canvas.getBoundingClientRect();
    const ndc = this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._rc.setFromCamera(ndc, this.camera);
    return this._rc.ray.clone();
  }

  worldToScreen(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = this._v.copy(v).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const inFront = this.reversedDepth ? p.z > 0 && p.z < 1 : p.z < 1 && p.z > -1;
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: inFront };
  }

  getViewInfo(): ViewInfo {
    return this.viewInfo;
  }

  /** rendered terrain height (m) at world meters (see header: smoothed free shorelines) */
  groundHeight(wx: number, wz: number): number {
    if (this.terrain) return this.terrain.data.heightAt(wx, wz);
    return this.world ? this.world.heightAt(wx, wz) : 0;
  }

  setOverlay(field: FieldId | null): void {
    this.overlay = field;
    this.overlays?.setField(field);
    this.game.events.emit('overlay:changed', field);
  }

  applySettings(s: Settings): void {
    const g = s.graphics;
    const prev = this.settingsCache;
    this.settingsCache = { ...g };
    if (!prev || prev.fov !== g.fov) {
      this.camera.fov = THREE.MathUtils.clamp(g.fov, 30, 100);
      this.camera.updateProjectionMatrix();
    }
    this.renderRadius = THREE.MathUtils.clamp(g.renderDistance, 2, 24) * CHUNK * CELL;
    this.sky.setShadowQuality(g.shadows);
    this.shadowRadius = SHADOW_RADIUS_BY_QUALITY[g.shadows] || 600;
    this.post.settings = { bloom: g.bloom, ambientOcclusion: g.ambientOcclusion, tiltShift: g.tiltShift, antialias: g.antialias && g.resolutionScale < 1.5 };
    this.fogEnabled = g.fog;
    this.cloudsEnabled = g.clouds;
    this.treeDensity = THREE.MathUtils.clamp(g.treeDensity, 0.2, 1);
    if (!prev || prev.resolutionScale !== g.resolutionScale) {
      this.lastSize.set(-1, -1);
      this.resize();
    }
  }

  /** capture the current frame as a data URL (optionally resized) */
  async screenshot(width?: number, height?: number): Promise<string> {
    this.render();
    const src = this.canvas;
    if (!width) return src.toDataURL('image/jpeg', 0.9);
    const h = height ?? Math.round((width * src.height) / Math.max(1, src.width));
    const c = document.createElement('canvas');
    c.width = width;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return src.toDataURL('image/jpeg', 0.9);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // cover-fit the requested size
    const sa = src.width / src.height, da = width / h;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sa > da) { sw = src.height * da; sx = (src.width - sw) / 2; } else { sh = src.width / da; sy = (src.height - sh) / 2; }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, h);
    return c.toDataURL('image/jpeg', 0.9);
  }

  /** release every GPU resource (renderer teardown) */
  dispose(): void {
    this.onWorldUnloaded();
    this.resizeObserver?.disconnect();
    this.cameraCtl.dispose();
    this.sky.dispose();
    this.post.dispose();
    this.textures.dispose();
    this.renderer.dispose();
  }
}
