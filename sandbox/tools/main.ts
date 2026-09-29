// Tools sandbox: runs the WorldActions/history/input test-suite, then builds a
// small city on noisy terrain and drives the real tools with synthetic pointer
// events so their previews can be screenshotted.
//   ?scene=road|zone|zonerect|place|bulldoze|terraform|trees|district|inspect|move|eyedropper
//   ?tests=0 skips the tests
import * as THREE from 'three';
import { Noise } from '../../src/core/noise';
import { Dir, RoadType, ZoneType } from '../../src/core/types';
import { BUILDINGS } from '../../src/data/buildings';
import { World } from '../../src/world/World';
import { attach, createFakeGame, mapSettings } from './fakeGame';
import { runTests } from './tests';

const params = new URLSearchParams(location.search);
const report = document.getElementById('report')!;
const hintEl = document.getElementById('hint')!;
const toasts = document.getElementById('toasts')!;

const g = createFakeGame(document.getElementById('view')!, (t) => {
  const d = document.createElement('div');
  d.textContent = t;
  toasts.appendChild(d);
  setTimeout(() => d.remove(), 2500);
});
(window as unknown as { __g: unknown }).__g = g;

function line(html: string, cls = ''): void {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  report.appendChild(d);
}

function buildCity(): World {
  const w = new World(mapSettings({ creative: false }), 96);
  const n = new Noise(7);
  const s1 = w.size + 1;
  for (let vy = 0; vy <= w.size; vy++)
    for (let vx = 0; vx <= w.size; vx++) {
      let h = 22 + n.noise2(vx * 0.03, vy * 0.03) * 7 + n.noise2(vx * 0.09, vy * 0.09) * 1.6;
      // hills to the north-east
      const hd = Math.hypot(vx - 70, vy - 18) / 22;
      if (hd < 1) h += 40 * (0.5 + 0.5 * Math.cos(Math.PI * hd));
      // a river valley running north-south around x≈58
      const rv = Math.abs(vx - (58 + Math.sin(vy * 0.12) * 3)) / 5;
      if (rv < 1) h -= 9 * (0.5 + 0.5 * Math.cos(Math.PI * rv));
      w.heights[vy * s1 + vx] = h;
    }
  w.seaLevel = 0;
  for (let y = 0; y < w.size; y++)
    for (let x = 0; x < w.size; x++) {
      const rv = Math.abs(x + 0.5 - (58 + Math.sin((y + 0.5) * 0.12) * 3));
      if (rv < 3.2) w.water[w.idx(x, y)] = Math.min(w.cellHeight(x, y) + 2.4, 18.5 - y * 0.02);
    }
  for (let y = 0; y < w.size; y++)
    for (let x = 0; x < w.size; x++) {
      const f = n.noise2(x * 0.08 + 40, y * 0.08);
      if (f > 0.25 && !w.isWater(x, y)) w.trees[w.idx(x, y)] = f > 0.55 ? 3 : f > 0.4 ? 2 : 1;
    }
  w.milestone = 13;
  w.economy.money = 250_000;
  return w;
}

function seedCity(): void {
  const A = g.actions;
  const road = (a: [number, number], b: [number, number], t = RoadType.Street, mode: 'straight' | 'lshape' = 'straight') => {
    const r = A.placeRoad(A.planRoad({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, t, mode), t);
    if (!r.ok) console.warn('seed road failed', a, b, r.reason);
  };
  road([8, 40], [52, 40], RoadType.Avenue);
  road([20, 24], [20, 70]);
  road([36, 24], [36, 70]);
  road([8, 56], [52, 56]);
  road([20, 70], [36, 70]);
  A.zoneRect({ x0: 21, y0: 41, x1: 24, y1: 55 }, ZoneType.ResLow);
  A.zoneRect({ x0: 32, y0: 41, x1: 35, y1: 55 }, ZoneType.ResMed);
  A.zoneRect({ x0: 21, y0: 36, x1: 35, y1: 39 }, ZoneType.ComLow);
  A.zoneRect({ x0: 21, y0: 57, x1: 26, y1: 60 }, ZoneType.Office);
  const w = g.world!;
  let seed = 3;
  for (let y = 41; y <= 55; y += 2)
    for (const x of [21, 23, 32, 34]) {
      seed = (seed * 16807) % 2147483647;
      if (seed % 5 === 0) continue;
      const z = w.zoneAt(x, y);
      if (!z) continue;
      w.addBuilding({ kind: 'zoned', defId: 'zoned:x', x, y, w: 2, h: 2, rot: x < 30 ? Dir.W : Dir.E, zone: z, level: 1 + (seed % 3), built: 1, seed });
    }
  const svc = BUILDINGS.find((d) => d.w === 2 && d.h === 2 && !d.placement) ?? BUILDINGS[0];
  if (svc) A.placeBuilding(svc.id, 29, 58, Dir.N);
  A.clearHistory();
}

// ── synthetic pointer driving ────────────────────────────────────────────
const canvas = g.renderer.canvas;
function at(x: number, y: number): { x: number; y: number } {
  return g.renderer.cellToScreen(x, y);
}
function ptr(type: string, p: { x: number; y: number }, o: { button?: number; buttons?: number; shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): void {
  const e = new PointerEvent(type, {
    clientX: p.x, clientY: p.y, button: o.button ?? (type === 'pointermove' ? -1 : 0), buttons: o.buttons ?? 0, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
    shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt,
  });
  canvas.dispatchEvent(e);
}
function move(x: number, y: number, o = {}): void {
  ptr('pointermove', at(x, y), o);
}
function drag(a: [number, number], b: [number, number], release = false, o: { button?: number; shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): void {
  const btn = o.button ?? 0;
  const bits = btn === 2 ? 2 : 1;
  move(a[0], a[1], o);
  ptr('pointerdown', at(a[0], a[1]), { ...o, button: btn, buttons: bits });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps, y = a[1] + ((b[1] - a[1]) * i) / steps;
    ptr('pointermove', at(x, y), { ...o, buttons: bits });
  }
  if (release) ptr('pointerup', at(b[0], b[1]), { ...o, button: btn, buttons: 0 });
}

const scenes: Record<string, () => void> = {
  road: () => {
    g.tools.setTool('road', { type: RoadType.Street });
    drag([36, 30], [64, 34]);
  },
  roadstraight: () => {
    g.tools.setTool('road', { type: RoadType.Avenue });
    drag([20, 30], [36, 30], false, { shift: true });
  },
  zone: () => {
    g.tools.setTool('zone', { zone: ZoneType.ComHigh });
    g.tools.update(0);
    for (let i = 0; i < 1; i++) g.tools.get('zone')!.onAction!('tool.brushBigger');
    move(33, 62);
  },
  zonerect: () => {
    g.tools.setTool('zone', { zone: ZoneType.Industry, mode: 'rect' });
    drag([37, 57], [44, 69]);
  },
  place: () => {
    const def = BUILDINGS.find((d) => d.w >= 2 && d.h >= 2 && d.cost < 60_000 && d.effects?.some((e) => e.radius >= 8 && e.amount > 0) && !d.placement) ?? BUILDINGS[0];
    g.tools.setTool('place', { defId: def.id });
    move(38.6, 47.4);
  },
  placebad: () => {
    const def = BUILDINGS.find((d) => d.w >= 2 && d.h >= 2 && !d.placement) ?? BUILDINGS[0];
    g.tools.setTool('place', { defId: def.id });
    move(22.5, 46.5);
  },
  bulldoze: () => {
    g.tools.setTool('bulldoze');
    drag([19, 44], [25, 52]);
  },
  bulldozehover: () => {
    g.tools.setTool('bulldoze');
    move(21.5, 43.5);
  },
  terraform: () => {
    g.tools.setTool('terraform', { mode: 'raise' });
    move(46, 26);
  },
  trees: () => {
    g.tools.setTool('trees', { density: 3 });
    g.tools.get('trees')!.onAction!('tool.brushBigger');
    move(46, 62);
  },
  district: () => {
    g.actions.createDistrict('Old Harbor');
    g.tools.setTool('district', {});
    drag([22, 42], [34, 50], true);
    move(28, 64);
  },
  inspect: () => {
    move(34.5, 45.5);
  },
  move: () => {
    g.tools.setTool('move', {});
    const svc = [...g.world!.buildings.values()].find((b) => b.kind === 'service');
    if (svc) {
      move(svc.x + 0.5, svc.y + 0.5);
      ptr('pointerdown', at(svc.x + 0.5, svc.y + 0.5), { buttons: 1 });
      ptr('pointerup', at(svc.x + 0.5, svc.y + 0.5));
    }
    move(41.5, 60.5);
  },
  eyedropper: () => {
    g.tools.setTool('eyedropper');
    move(20, 50);
  },
};

async function main(): Promise<void> {
  if (params.get('tests') !== '0') {
    const t0 = performance.now();
    const res = await runTests(g);
    const pass = res.filter((r) => r.ok).length;
    line(`<b class="${pass === res.length ? 'ok' : 'bad'}">${pass}/${res.length} tests passed</b> <span class="dim">(${(performance.now() - t0).toFixed(0)} ms)</span>`);
    for (const r of res) line(`${r.ok ? '✔' : '✘'} ${r.name}${r.detail ? ` <span class="dim">— ${r.detail}</span>` : ''}`, r.ok ? 'ok' : 'bad');
    console.log(`TESTS ${pass}/${res.length}`);
    for (const r of res) if (!r.ok) console.log(`FAIL ${r.name}: ${r.detail}`);
    g.tools.setTool(null);
  }
  const city = buildCity();
  attach(g, city);
  seedCity();
  g.renderer.rebuild();
  const scene = params.get('scene') ?? 'road';
  const view: Record<string, [number, number, number]> = {
    road: [48, 34, 620], roadstraight: [28, 32, 420], zone: [30, 58, 380], zonerect: [36, 60, 420], place: [36, 46, 420], placebad: [26, 46, 380],
    bulldoze: [24, 48, 400], bulldozehover: [24, 46, 360], terraform: [48, 28, 560], trees: [42, 58, 420], district: [28, 52, 560], inspect: [30, 48, 420], move: [36, 56, 440], eyedropper: [24, 48, 400],
  };
  const [cx, cy, dist] = view[scene] ?? [36, 46, 700];
  g.renderer.lookAt(cx, cy, dist);
  if (params.get('report') === 'min') report.classList.add('min');

  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    g.time += dt;
    g.input.update(dt);
    g.tools.update(dt);
    g.world?.flushChanges();
    g.renderer.render();
    hintEl.textContent = g.tools.hint || 'No tool — hover to inspect, click to select';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // give the first frames a moment, then run the scenario
  setTimeout(() => {
    try {
      scenes[scene]?.();
    } catch (e) {
      console.error('scene failed', e);
    }
  }, 300);
}

void main();
void THREE;
