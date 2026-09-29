// Map generator sandbox: generates maps through the real worker-based
// generateMap() and shows them as 2D layers, an all-theme gallery, or a 3D mesh.
// URL params: ?theme=&size=&seed=&mountains=&water=&forests=&view=2d|3d|gallery&layer=
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateMap } from '../../src/world/mapgen';
import { THEMES, themeDef } from '../../src/data/themes';
import type { GeneratedMap, MapSettings, ThemeId } from '../../src/core/types';
import type { MapSizeId } from '../../src/core/constants';
import { CELL } from '../../src/core/constants';
import { renderMap, type Layer } from './render';
import { stats } from './stats';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qs = new URLSearchParams(location.search);
const themeSel = $<HTMLSelectElement>('theme');
for (const t of THEMES) themeSel.add(new Option(t.name, t.id));
themeSel.value = qs.get('theme') ?? 'temperate';
$<HTMLSelectElement>('size').value = qs.get('size') ?? 'medium';
$<HTMLInputElement>('seed').value = qs.get('seed') ?? '42';
for (const k of ['mountains', 'water', 'forests']) if (qs.get(k)) $<HTMLInputElement>(k).value = qs.get(k) as string;

const LAYERS: Layer[] = ['terrain', 'height', 'slope', 'fertility', 'forest', 'ore', 'oil', 'wind'];
let layer: Layer = (qs.get('layer') as Layer) ?? 'terrain';
const layerBox = $('layers');
for (const l of LAYERS) {
  const b = document.createElement('button');
  b.textContent = l;
  b.onclick = () => {
    layer = l;
    syncLayers();
    draw();
  };
  b.dataset.layer = l;
  layerBox.appendChild(b);
}
const syncLayers = () => layerBox.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.layer === layer));
syncLayers();

const status = $('status');
const bar = $('bar').firstElementChild as HTMLElement;
const view = $<HTMLCanvasElement>('view');
const gallery = $('gallery');
const glBox = $('gl');
let current: { map: GeneratedMap; theme: ThemeId } | null = null;
let busy = false;

function settings(theme?: ThemeId, size?: MapSizeId): MapSettings {
  const num = (id: string) => Number($<HTMLInputElement>(id).value);
  $('mv').textContent = String(num('mountains'));
  $('wv').textContent = String(num('water'));
  $('fv').textContent = String(num('forests'));
  return {
    cityName: 'Sandbox',
    mapSize: size ?? ($<HTMLSelectElement>('size').value as MapSizeId),
    theme: theme ?? (themeSel.value as ThemeId),
    seed: num('seed') | 0,
    style: 'european',
    difficulty: 'normal',
    creative: false,
    disasters: true,
    mountains: num('mountains'),
    water: num('water'),
    forests: num('forests'),
  };
}

function toCanvas(c: HTMLCanvasElement, img: { data: Uint8ClampedArray; w: number; h: number }): void {
  c.width = img.w;
  c.height = img.h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
}

function opts(theme: ThemeId, scale: number) {
  return {
    theme: themeDef(theme),
    layer,
    trees: $<HTMLInputElement>('cTrees').checked,
    routes: $<HTMLInputElement>('cRoutes').checked,
    water: $<HTMLInputElement>('cWater').checked,
    scale,
  };
}

function draw(): void {
  if (!current) return;
  const avail = Math.min(innerWidth - 290, innerHeight - 20);
  const scale = Math.max(1, Math.floor(avail / current.map.size));
  toCanvas(view, renderMap(current.map, opts(current.theme, scale)));
}

function showMode(mode: '2d' | '3d' | 'gallery'): void {
  view.style.display = mode === '2d' ? 'block' : 'none';
  gallery.style.display = mode === 'gallery' ? 'grid' : 'none';
  glBox.style.display = mode === '3d' ? 'block' : 'none';
}

async function run(s: MapSettings): Promise<GeneratedMap> {
  const t0 = performance.now();
  const map = await generateMap(s, (p, label) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    status.textContent = `${label}… ${Math.round(p * 100)}%`;
  });
  const ms = Math.round(performance.now() - t0);
  status.textContent = `${s.theme} ${s.mapSize} seed ${s.seed}: ${ms} ms\n${JSON.stringify(stats(map), null, 1)}`;
  return map;
}

async function generate(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const s = settings();
    const map = await run(s);
    current = { map, theme: s.theme };
    showMode('2d');
    draw();
    (window as unknown as { __map: GeneratedMap }).__map = map;
  } finally {
    busy = false;
  }
}

async function galleryAll(): Promise<void> {
  if (busy) return;
  busy = true;
  showMode('gallery');
  gallery.innerHTML = '';
  try {
    for (const t of THEMES) {
      const s = settings(t.id);
      const map = await run(s);
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      toCanvas(c, renderMap(map, opts(t.id, map.size <= 256 ? 2 : 1)));
      const st = stats(map);
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<b>${t.name}</b> · gentle ${st.gentle}% · water ${st.water}% · trees ${st.trees}%<br>highway ${st.hw.len} (max slope ${st.hw.maxSlope}) · rail ${st.rail.len} · ${st.conn}`;
      fig.append(c, cap);
      gallery.appendChild(fig);
    }
    status.textContent += '\ngallery done';
    document.body.dataset.done = '1';
  } finally {
    busy = false;
  }
}

// ── 3D view ─────────────────────────────────────────────────────────────────
let renderer: THREE.WebGLRenderer | null = null;
let raf = 0;
function show3D(): void {
  if (!current) return;
  showMode('3d');
  const { map, theme } = current;
  const W = glBox.clientWidth || innerWidth - 250, H = glBox.clientHeight || innerHeight;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    glBox.appendChild(renderer.domElement);
  }
  renderer.setSize(W, H);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9cc2e6');
  scene.fog = new THREE.Fog('#9cc2e6', map.size * CELL * 0.8, map.size * CELL * 2.2);
  const camera = new THREE.PerspectiveCamera(45, W / H, 10, map.size * CELL * 6);
  const ext = map.size * CELL;
  camera.position.set(ext * 0.5, ext * 0.55, ext * 1.25);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(ext * 0.5, 0, ext * 0.5);
  controls.update();
  scene.add(new THREE.HemisphereLight('#dfefff', '#4a4030', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(-ext * 0.4, ext * 0.6, -ext * 0.2);
  scene.add(sun);
  // terrain: downsample to ≤ 256 segments, vertex colours from the 2D render (no hillshade needed: lit)
  const step = Math.max(1, Math.round(map.size / 256));
  const seg = Math.floor(map.size / step);
  const V = map.size + 1;
  const img = renderMap(map, { ...opts(theme, 1), water: false, routes: true });
  const pos = new Float32Array((seg + 1) * (seg + 1) * 3);
  const col = new Float32Array((seg + 1) * (seg + 1) * 3);
  const exag = 1.6;
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const vx = Math.min(map.size, i * step), vy = Math.min(map.size, j * step);
      const k = (j * (seg + 1) + i) * 3;
      pos[k] = vx * CELL;
      pos[k + 1] = map.heights[vy * V + vx] * exag;
      pos[k + 2] = vy * CELL;
      const px = Math.min(map.size - 1, vx), py = Math.min(map.size - 1, vy);
      const o = (py * map.size + px) * 4;
      col[k] = (img.data[o] / 255) ** 2.2;
      col[k + 1] = (img.data[o + 1] / 255) ** 2.2;
      col[k + 2] = (img.data[o + 2] / 255) ** 2.2;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  scene.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  // water: per-vertex surface = max of adjacent cells' surfaces (incl. fringe), drawn where any adjacent cell is wet
  const wv = new Float32Array(V * V).fill(-1e4);
  for (let y = 0; y < map.size; y++) {
    for (let x = 0; x < map.size; x++) {
      const w = map.water[y * map.size + x];
      if (w <= -1e3) continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const vi = (y + dy) * V + x + dx;
        if (w > wv[vi]) wv[vi] = w;
      }
    }
  }
  const wpos: number[] = [];
  for (let y = 0; y < map.size; y += step) {
    for (let x = 0; x < map.size; x += step) {
      let any = false;
      for (let yy = y; yy < Math.min(map.size, y + step) && !any; yy++) for (let xx = x; xx < Math.min(map.size, x + step) && !any; xx++) if (map.water[yy * map.size + xx] > -1e3) any = true;
      if (!any) continue;
      const x1 = Math.min(map.size, x + step), y1 = Math.min(map.size, y + step);
      const h = (vx: number, vy: number) => {
        const w = wv[vy * V + vx];
        return (w > -1e3 ? w : map.heights[vy * V + vx] - 1) * exag + 0.3;
      };
      const p = [[x, y], [x1, y], [x, y1], [x1, y1]].map(([vx, vy]) => [vx * CELL, h(vx, vy), vy * CELL]);
      wpos.push(...p[0], ...p[2], ...p[1], ...p[1], ...p[2], ...p[3]);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpos), 3));
  wg.computeVertexNormals();
  const th = themeDef(theme);
  scene.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: th.waterShallow, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 })));
  cancelAnimationFrame(raf);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer?.render(scene, camera);
  };
  loop();
  document.body.dataset.done = '1';
}

$('gen').onclick = () => void generate();
$('rand').onclick = () => {
  $<HTMLInputElement>('seed').value = String((Math.random() * 1e6) | 0);
  void generate();
};
$('gal').onclick = () => void galleryAll();
$('three').onclick = () => show3D();
for (const id of ['cTrees', 'cRoutes', 'cWater']) $(id).onchange = () => draw();
addEventListener('resize', () => draw());

const mode = qs.get('view') ?? '2d';
if (mode === 'gallery') void galleryAll();
else
  void generate().then(() => {
    if (mode === '3d') show3D();
    else document.body.dataset.done = '1';
  });
