// Sandbox world shared by the visual sandbox (main.ts) and the node checks
// (verify.ts): a synthetic valley (hills, a river with water) and a hand-built
// network exercising every road type, junction shape, bridges, rail, tram,
// dead ends and slopes; zoned lots, a few buildings, districts, woods.
import { Noise } from '../../src/core/noise';
import { hash2 } from '../../src/core/rng';
import { Dir, RoadType, ZoneType, type MapSettings } from '../../src/core/types';
import { World } from '../../src/world/World';

export const SIZE = 96;

export function buildSandboxWorld(TIME: string): { world: World; noise: Noise; bcolors: number[] } {
  // ── world ───────────────────────────────────────────────────────────────────
  const settings: MapSettings = {
    cityName: 'Sandbox', mapSize: 'small', theme: 'temperate', seed: 7, style: 'european', difficulty: 'normal',
    creative: true, disasters: false, mountains: 0.5, water: 0.5, forests: 0.3,
  };
  const world = new World(settings, SIZE);
  const noise = new Noise(11);
  const RIVER_X = 48;
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let vy = 0; vy <= SIZE; vy++)
    for (let vx = 0; vx <= SIZE; vx++) {
      let h = 20 + 3 * noise.noise2(vx / 30, vy / 30) + 1.2 * noise.noise2(vx / 9, vy / 9);
      h += 16 * smoothstep(56, 92, vx) * (0.65 + 0.35 * noise.noise2(vx / 22 + 3, vy / 22));
      h += 5 * smoothstep(60, 95, vy) * smoothstep(40, 10, vx);
      const d = Math.abs(vx - RIVER_X);
      h -= 12 * (1 - smoothstep(2.5, 10, d));
      world.heights[vy * (SIZE + 1) + vx] = h;
    }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (Math.abs(x + 0.5 - RIVER_X) < 4.2) world.water[y * SIZE + x] = 12.2;

  // ── roads ───────────────────────────────────────────────────────────────────
  type Seg = [RoadType, number, number, number, number];
  const H = RoadType.Highway, A = RoadType.Avenue, S = RoadType.Street, B = RoadType.Boulevard, T = RoadType.TramAvenue;
  const P = RoadType.Pedestrian, R = RoadType.Rail, D = RoadType.Dirt;
  const segs: Seg[] = [
    [H, 0, 6, 95, 6],
    [S, 12, 16, 12, 84], [S, 21, 16, 21, 84],
    [S, 4, 16, 29, 16], [S, 4, 28, 29, 28], [S, 4, 68, 29, 68], [S, 4, 78, 29, 78],
    [T, 4, 38, 88, 38],
    [B, 4, 58, 40, 58],
    [S, 40, 44, 40, 84],
    [S, 40, 70, 64, 70],
    [P, 13, 48, 20, 48], [P, 16, 39, 16, 47], [P, 16, 49, 16, 57],
    [A, 30, 6, 30, 88],
    [S, 64, 39, 64, 80], [S, 64, 80, 80, 80], [S, 80, 60, 80, 79],
    [S, 65, 50, 74, 50], [S, 65, 62, 72, 62], [S, 72, 55, 72, 61],
    [S, 56, 7, 56, 20], [S, 56, 20, 70, 20], [S, 70, 21, 70, 30],
    [D, 88, 39, 88, 50], [D, 89, 50, 93, 50], [D, 93, 51, 93, 72], [D, 89, 60, 92, 60],
    [R, 0, 90, 95, 90], [R, 70, 84, 70, 89], [R, 71, 84, 79, 84],
    [S, 4, 17, 4, 27],
  ];
  const order: RoadType[] = [R, D, S, P, B, T, A, H];
  const cellsOf = ([, x0, y0, x1, y1]: Seg): [number, number][] => {
    const out: [number, number][] = [];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / Math.max(1, n)), Math.round(y0 + ((y1 - y0) * i) / Math.max(1, n))]);
    return out;
  };
  // grade the terrain under roads (smooth corner heights) before placing them
  const onRoad = new Uint8Array((SIZE + 1) * (SIZE + 1));
  for (const s of segs) for (const [x, y] of cellsOf(s)) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) onRoad[(y + dy) * (SIZE + 1) + x + dx] = 1;
  for (let pass = 0; pass < 6; pass++) {
    const src = world.heights.slice();
    for (let vy = 0; vy <= SIZE; vy++)
      for (let vx = 0; vx <= SIZE; vx++) {
        const i = vy * (SIZE + 1) + vx;
        if (!onRoad[i]) continue;
        let sum = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = vx + dx, yy = vy + dy;
            if (xx < 0 || yy < 0 || xx > SIZE || yy > SIZE) continue;
            sum += src[yy * (SIZE + 1) + xx];
            n++;
          }
        world.heights[i] = sum / n;
      }
  }
  for (const t of order)
    for (const s of segs) {
      if (s[0] !== t) continue;
      for (const [x, y] of cellsOf(s)) world.setRoad(x, y, t, world.isWater(x, y) ? 1 : 0);
    }
  // bridges also over the low banks next to water so decks span the valley floor
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (!world.road[i] || world.roadFlags[i] & 1) continue;
      const wet = (xx: number) => world.isWater(xx, y);
      if ((wet(x - 1) || wet(x + 1)) && world.cellHeight(x, y) < 14.5) world.roadFlags[i] |= 1;
    }

  // ── zones, buildings, districts ───────────────────────────────────────────────
  const zoneRect = (z: ZoneType, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!world.roadAt(x, y) && !world.isWater(x, y)) world.setZone(x, y, z);
  };
  zoneRect(ZoneType.ResLow, 5, 17, 11, 27);
  zoneRect(ZoneType.ResLow, 13, 17, 20, 27);
  zoneRect(ZoneType.ResMed, 5, 29, 11, 37);
  zoneRect(ZoneType.ComLow, 13, 29, 20, 37);
  zoneRect(ZoneType.ComHigh, 22, 39, 29, 57);
  zoneRect(ZoneType.Office, 31, 39, 39, 57);
  zoneRect(ZoneType.MixedUse, 5, 59, 11, 67);
  zoneRect(ZoneType.ResHigh, 22, 59, 29, 67);
  zoneRect(ZoneType.Industry, 57, 7, 69, 19);
  zoneRect(ZoneType.ResMed, 65, 39, 74, 49);
  zoneRect(ZoneType.ResLow, 65, 51, 79, 61);
  zoneRect(ZoneType.Farming, 89, 51, 92, 70);
  const bcolors: number[] = [];
  const addB = (x: number, y: number, w: number, h: number, rot: Dir, zone: ZoneType) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (world.roadAt(xx, yy) || world.bldg[world.idx(xx, yy)]) return;
    world.addBuilding({ kind: 'zoned', defId: 'zoned:x', x, y, w, h, rot, zone, built: 1 });
    bcolors.push(hash2(x, y));
  };
  for (let y = 17; y < 27; y += 3) { addB(9, y, 2, 2, Dir.E, ZoneType.ResLow); addB(13, y, 2, 2, Dir.W, ZoneType.ResLow); }
  for (let y = 39; y < 56; y += 4) { addB(26, y, 4, 3, Dir.E, ZoneType.ComHigh); addB(31, y + 2, 3, 3, Dir.W, ZoneType.Office); }
  addB(58, 8, 4, 4, Dir.N, ZoneType.Industry);
  addB(65, 40, 2, 2, Dir.W, ZoneType.ResMed);
  addB(66, 44, 3, 3, Dir.W, ZoneType.ResMed);
  world.districts.push({ id: 1, name: 'Old Town', color: '#ff9f43', style: null, policies: [] }, { id: 2, name: 'Riverside', color: '#54a0ff', style: null, policies: [] });
  for (let y = 10; y < 60; y++) for (let x = 0; x < 30; x++) world.setDistrict(x, y, 1);
  for (let y = 30; y < 80; y++) for (let x = 36; x < 62; x++) world.setDistrict(x, y, 2);

  // scattered woods on untouched land (drawn by the real renderer's TreeRenderer)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (world.road[i] || world.zone[i] || world.bldg[i] || world.isWater(x, y)) continue;
      const n = noise.noise2(x / 7 + 40, y / 7 - 13);
      if (n > 0.25) world.trees[i] = n > 0.55 ? 3 : n > 0.4 ? 2 : 1;
    }

  // weather & time
  if (TIME === 'rain') world.weather = { ...world.weather, type: 'rain', intensity: 0.9 };
  if (TIME === 'snow') { world.weather = { ...world.weather, type: 'snow', intensity: 0.6, snowCover: 0.85 }; world.time.day = 20; }
  else world.time.day = 150;
  if (TIME === 'autumn') world.time.day = 290;

  return { world, noise, bcolors };
}
