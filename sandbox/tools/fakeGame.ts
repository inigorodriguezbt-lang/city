// Minimal Game shell for the tools sandbox: the REAL World, WorldActions,
// InputManager and ToolManager plus lightweight stand-ins for the renderer,
// UI, audio and simulation (other agents' modules are being written in
// parallel, so the sandbox only depends on the frozen core).
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CELL } from '../../src/core/constants';
import { Layer, RoadType, ZoneType, type Building, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';
import { RoadSurface } from '../../src/world/roadHeight';
import { WorldActions } from '../../src/world/actions';
import { InputManager } from '../../src/input/InputManager';
import { ToolManager } from '../../src/tools/ToolManager';
import { defaultSettings } from '../../src/settings/types';
import { zoneDef } from '../../src/data/zones';
import type { Game } from '../../src/game/Game';

export function mapSettings(over: Partial<MapSettings> = {}): MapSettings {
  return {
    cityName: 'Sandbox', mapSize: 'small', theme: 'temperate', seed: 42, style: 'european', difficulty: 'normal',
    creative: false, disasters: false, mountains: 0.4, water: 0.4, forests: 0.4, ...over,
  };
}

export interface FakeGame {
  events: EventBus<GameEvents>;
  settings: { value: ReturnType<typeof defaultSettings>; set(p: unknown): void };
  world: World | null;
  roadSurface: RoadSurface | null;
  time: number;
  renderer: SandboxRenderer;
  input: InputManager;
  actions: WorldActions;
  tools: ToolManager;
  buildings: { highlight(id: number | null, color?: number): void; createPreview(defId: string, rot: number): THREE.Object3D; buildingTop(id: number): number; highlighted: number | null };
  zones: { setGridVisible(v: boolean): void; setDistrictsVisible(v: boolean): void; grid: boolean; districts: boolean };
  ui: { toast(t: string, k?: string): void; openBuildingInfo(id: number): void; confirm(t: string, x: string): Promise<boolean>; toasts: string[] };
  audio: { play(id: string, v?: number): void; played: string[] };
  menus: { isOpen(): boolean };
  chat: { isOpen: boolean };
  traffic: { nearestVehicle(x: number, z: number, d: number): number | null };
  fields: { requestRecompute(): void };
}

/** three.js scene with a draped heightfield, water, roads, zones and boxes */
export class SandboxRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private terrain: THREE.Mesh | null = null;
  private water: THREE.Mesh | null = null;
  private roads = new THREE.Group();
  private zoneMesh: THREE.Mesh | null = null;
  private bGroup = new THREE.Group();
  private treeMesh: THREE.InstancedMesh | null = null;
  private raycaster = new THREE.Raycaster();
  world: World | null = null;
  highlightId: number | null = null;
  highlightColor = 0xffffff;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);
    this.scene.background = new THREE.Color(0x9fc3e0);
    this.scene.fog = new THREE.Fog(0x9fc3e0, 1400, 4200);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(-600, 900, -300);
    this.scene.add(sun);
    this.scene.add(this.roads, this.bGroup);
    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  lookAt(cx: number, cy: number, dist: number, yaw = 0.55, pitch = 0.92): void {
    const w = this.world;
    const fx = cx * CELL, fz = cy * CELL;
    const fy = w ? w.heightAt(fx, fz) : 0;
    this.camera.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * dist, fy + Math.sin(pitch) * dist, fz + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(fx, fy, fz);
    this.camera.updateMatrixWorld();
  }

  pick(clientX: number, clientY: number): { cell: { x: number; y: number }; point: THREE.Vector3; onWater: boolean } | null {
    const w = this.world;
    if (!w || !this.terrain) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.terrain, ...(this.water ? [this.water] : [])], false);
    if (!hits.length) return null;
    const p = hits[0].point.clone();
    const c = w.worldToCell(p.x, p.z);
    return { cell: c, point: p, onWater: hits[0].object === this.water };
  }

  worldToScreen(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: p.z < 1 && p.z > -1 };
  }

  /** screen position of a cell center */
  cellToScreen(x: number, y: number): { x: number; y: number } {
    const w = this.world!;
    const wx = (x + 0.5) * CELL, wz = (y + 0.5) * CELL;
    return this.worldToScreen(new THREE.Vector3(wx, w.heightAt(wx, wz), wz));
  }

  rebuild(layers = Layer.All): void {
    const w = this.world;
    if (!w) return;
    if (layers & (Layer.Terrain | Layer.Water | Layer.Road)) this.buildTerrain(w);
    if (layers & (Layer.Road | Layer.Terrain)) this.buildRoads(w);
    if (layers & (Layer.Zone | Layer.Terrain | Layer.Road | Layer.Building)) this.buildZones(w);
    if (layers & (Layer.Building | Layer.Terrain)) this.buildBuildings(w);
    if (layers & (Layer.Tree | Layer.Terrain | Layer.Building | Layer.Road)) this.buildTrees(w);
  }

  private buildTerrain(w: World): void {
    const s = w.size, n = s + 1;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const grass = new THREE.Color(0x6f9a4c), dry = new THREE.Color(0x9aa45f), rock = new THREE.Color(0x8a8378), sand = new THREE.Color(0xd8c89a);
    const c = new THREE.Color();
    for (let vy = 0; vy < n; vy++)
      for (let vx = 0; vx < n; vx++) {
        const i = vy * n + vx, h = w.heights[i];
        pos[i * 3] = vx * CELL;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = vy * CELL;
        const sl = Math.abs(w.vertexHeight(vx + 1, vy) - w.vertexHeight(vx - 1, vy)) + Math.abs(w.vertexHeight(vx, vy + 1) - w.vertexHeight(vx, vy - 1));
        c.copy(grass).lerp(dry, Math.min(1, Math.max(0, (h - 14) / 30)));
        if (h < w.seaLevel + 2.2) c.lerp(sand, 0.8);
        c.lerp(rock, Math.min(1, Math.max(0, (sl / (2 * CELL) - 0.25) * 2.5)));
        const jit = 0.94 + 0.06 * Math.sin(vx * 12.9898 + vy * 78.233) * Math.sin(vx * 3.1 + vy * 1.7);
        col[i * 3] = c.r * jit;
        col[i * 3 + 1] = c.g * jit;
        col[i * 3 + 2] = c.b * jit;
      }
    const idx: number[] = [];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const a = y * n + x, b = a + 1, d = a + n, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (this.terrain) {
      this.terrain.geometry.dispose();
      this.terrain.geometry = g;
    } else {
      this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
      this.terrain.name = 'terrain';
      this.scene.add(this.terrain);
    }
    // water: one quad per wet cell at its surface
    const wp: number[] = [], wi: number[] = [];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (!w.isWater(x, y)) continue;
        const h = w.waterLevel(x, y), b = wp.length / 3;
        wp.push(x * CELL, h, y * CELL, (x + 1) * CELL, h, y * CELL, x * CELL, h, (y + 1) * CELL, (x + 1) * CELL, h, (y + 1) * CELL);
        wi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wp), 3));
    wg.setIndex(wi);
    wg.computeVertexNormals();
    if (this.water) {
      this.water.geometry.dispose();
      this.water.geometry = wg;
    } else {
      this.water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x2d6f96, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86 }));
      this.water.name = 'water';
      this.scene.add(this.water);
    }
  }

  private buildRoads(w: World): void {
    for (const c of this.roads.children) (c as THREE.Mesh).geometry.dispose();
    this.roads.clear();
    const surf = new RoadSurface(w);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const cc = new THREE.Color();
    for (let y = 0; y < w.size; y++)
      for (let x = 0; x < w.size; x++) {
        const t = w.roadAt(x, y);
        if (!t) continue;
        const bridge = w.isBridge(x, y);
        cc.setHex(t === RoadType.Rail ? 0x6b5a4a : t === RoadType.Dirt ? 0x9c8566 : t === RoadType.Highway ? 0x3a3d42 : t === RoadType.Pedestrian ? 0xb9ae9c : t >= RoadType.Avenue ? 0x44474d : 0x55585e);
        const inset = 1.2;
        const hs = bridge ? [surf.deck(x, y), surf.deck(x, y), surf.deck(x, y), surf.deck(x, y)] : [w.vertexHeight(x, y), w.vertexHeight(x + 1, y), w.vertexHeight(x, y + 1), w.vertexHeight(x + 1, y + 1)].map((h) => h + 0.15);
        const b = pos.length / 3;
        const m = w.roadMask(x, y);
        const x0 = x * CELL + (m & 8 ? 0 : inset), x1 = (x + 1) * CELL - (m & 2 ? 0 : inset);
        const z0 = y * CELL + (m & 1 ? 0 : inset), z1 = (y + 1) * CELL - (m & 4 ? 0 : inset);
        pos.push(x0, hs[0], z0, x1, hs[1], z0, x0, hs[2], z1, x1, hs[3], z1);
        for (let k = 0; k < 4; k++) col.push(cc.r, cc.g, cc.b);
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.roads.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
  }

  private buildZones(w: World): void {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const cc = new THREE.Color();
    for (let y = 0; y < w.size; y++)
      for (let x = 0; x < w.size; x++) {
        const z = w.zoneAt(x, y);
        const d = w.district[w.idx(x, y)];
        if (!z && !d) continue;
        if (z) cc.set(zoneDef(z).color);
        else cc.set(w.districts.find((q) => q.id === d)?.color ?? '#ffffff');
        const b = pos.length / 3, l = 0.2, m = 1.5;
        pos.push(x * CELL + m, w.vertexHeight(x, y) + l, y * CELL + m, (x + 1) * CELL - m, w.vertexHeight(x + 1, y) + l, y * CELL + m, x * CELL + m, w.vertexHeight(x, y + 1) + l, (y + 1) * CELL - m, (x + 1) * CELL - m, w.vertexHeight(x + 1, y + 1) + l, (y + 1) * CELL - m);
        for (let k = 0; k < 4; k++) col.push(cc.r, cc.g, cc.b);
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    if (this.zoneMesh) {
      this.zoneMesh.geometry.dispose();
      this.zoneMesh.geometry = g;
    } else {
      this.zoneMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      this.scene.add(this.zoneMesh);
    }
  }

  private buildBuildings(w: World): void {
    for (const c of this.bGroup.children) {
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.bGroup.clear();
    for (const b of w.buildings.values()) this.bGroup.add(this.box(w, b));
  }

  private box(w: World, b: Building): THREE.Mesh {
    const zoned = b.kind === 'zoned';
    const hgt = zoned ? 6 + b.level * 5 + (b.seed % 7) : 10 + (b.w * b.h > 4 ? 8 : 0);
    const g = new THREE.BoxGeometry(b.w * CELL - 3, hgt, b.h * CELL - 3);
    g.translate(0, hgt / 2, 0);
    const base = zoned ? new THREE.Color(zoneDef(b.zone)?.color ?? '#cccccc').lerp(new THREE.Color(0xf2efe8), 0.55) : new THREE.Color(0xd9d4ca);
    if (b.flags & (1 << 6)) base.setHex(0x5a524a);
    const hl = this.highlightId === b.id;
    const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.8, emissive: hl ? this.highlightColor : 0x000000, emissiveIntensity: hl ? 0.55 : 0 });
    const mesh = new THREE.Mesh(g, m);
    let gh = 0;
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) gh += w.vertexHeight(x, y);
    gh /= (b.w + 1) * (b.h + 1);
    mesh.position.set((b.x + b.w / 2) * CELL, gh + (b.built < 1 ? -hgt * 0.4 : 0), (b.y + b.h / 2) * CELL);
    mesh.userData.id = b.id;
    return mesh;
  }

  private buildTrees(w: World): void {
    let n = 0;
    for (let i = 0; i < w.trees.length; i++) n += w.trees[i];
    if (this.treeMesh) {
      this.treeMesh.removeFromParent();
      this.treeMesh.dispose();
    }
    const g = new THREE.ConeGeometry(2.6, 9, 6);
    g.translate(0, 4.5, 0);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.9 }), Math.max(1, n));
    const m = new THREE.Matrix4();
    let k = 0;
    for (let y = 0; y < w.size; y++)
      for (let x = 0; x < w.size; x++) {
        const d = w.trees[w.idx(x, y)];
        for (let t = 0; t < d; t++) {
          const fx = (x + 0.2 + 0.6 * (((x * 7 + y * 13 + t * 5) % 10) / 10)) * CELL, fz = (y + 0.2 + 0.6 * (((x * 3 + y * 11 + t * 7) % 10) / 10)) * CELL;
          const s = 0.8 + 0.4 * (((x + y + t) % 5) / 5);
          m.makeScale(s, s, s).setPosition(fx, w.heightAt(fx, fz), fz);
          mesh.setMatrixAt(k++, m);
        }
      }
    mesh.count = k;
    this.treeMesh = mesh;
    this.scene.add(mesh);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

export function createFakeGame(container: HTMLElement, onToast: (t: string, k: string) => void): FakeGame {
  const events = new EventBus<GameEvents>();
  const renderer = new SandboxRenderer(container);
  const g = {
    events,
    settings: { value: defaultSettings(), set() { events.emit('settings:changed', g.settings.value); } },
    world: null as World | null,
    roadSurface: null as RoadSurface | null,
    time: 0,
    renderer,
    buildings: {
      highlighted: null as number | null,
      highlight(id: number | null, color?: number) {
        g.buildings.highlighted = id;
        renderer.highlightId = id;
        renderer.highlightColor = color ?? 0xffffff;
        renderer.rebuild(Layer.Building);
      },
      createPreview() {
        return new THREE.Group();
      },
      buildingTop() {
        return 0;
      },
    },
    zones: { grid: false, districts: false, setGridVisible(v: boolean) { g.zones.grid = v; }, setDistrictsVisible(v: boolean) { g.zones.districts = v; } },
    ui: {
      toasts: [] as string[],
      toast(t: string, k = 'info') { g.ui.toasts.push(t); onToast(t, k); },
      openBuildingInfo() {},
      confirm() { return Promise.resolve(true); },
    },
    audio: { played: [] as string[], play(id: string) { g.audio.played.push(id); } },
    menus: { isOpen: () => false },
    chat: { isOpen: false },
    traffic: { nearestVehicle: () => null },
    fields: { requestRecompute() {} },
  } as unknown as FakeGame;
  g.input = new InputManager(g as unknown as Game, renderer.canvas);
  g.actions = new WorldActions(g as unknown as Game);
  g.tools = new ToolManager(g as unknown as Game);
  g.input.init();
  events.on('world:changed', ({ layers }) => {
    if (layers & (Layer.Road | Layer.Terrain | Layer.Water)) g.roadSurface?.invalidate({ x0: 0, y0: 0, x1: (g.world?.size ?? 1) - 1, y1: (g.world?.size ?? 1) - 1 });
    renderer.rebuild(layers);
  });
  return g;
}

/** attach a world to the fake game (like Game.attachWorld) */
export function attach(g: FakeGame, w: World): void {
  g.world = w;
  w.bus = g.events;
  g.roadSurface = new RoadSurface(w);
  g.renderer.world = w;
  g.tools.onWorldLoaded(w);
  g.actions.clearHistory();
  g.renderer.rebuild(Layer.All);
}

export { ZoneType, RoadType };
