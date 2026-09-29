// Synthetic test city for the field-system sandbox and benchmark.
// Terrain: sea along the west edge, a river that runs south then west into the
// sea, gentle hills. City: street grid with avenues, bridges, residential /
// commercial / office / industrial blocks, utilities and services, plus two
// deliberately broken networks: an island suburb without any plant (no power)
// and an under-supplied suburb fed by a single wind turbine (brownout).
import { WATER_EPS } from '../../src/core/constants';
import { Noise } from '../../src/core/noise';
import { RNG } from '../../src/core/rng';
import { BFlag, Dir, RoadType, ZoneType, type Building, type MapSettings } from '../../src/core/types';
import { buildingDef } from '../../src/data/buildings';
import { LEVEL_CAPACITY, zoneDef } from '../../src/data/zones';
import { World } from '../../src/world/World';

export interface SceneInfo {
  world: World;
  /** labelled probe cells for assertions / annotations */
  probes: Record<string, { x: number; y: number }>;
}

export function buildWorld(size = 256, seed = 7): SceneInfo {
  const settings: MapSettings = {
    cityName: 'Fieldtown', mapSize: size >= 768 ? 'huge' : size >= 512 ? 'large' : size >= 384 ? 'medium' : 'small',
    theme: 'temperate', seed, style: 'european', difficulty: 'normal', creative: false, disasters: false,
    mountains: 0.4, water: 0.5, forests: 0.5,
  };
  const w = new World(settings, size);
  const noise = new Noise(seed);
  const rng = new RNG(seed);
  const s1 = size + 1;
  const seaX = Math.round(size * 0.1);
  // river centre line: x as a function of y (north part), then a westward leg at yMouth
  const riverX = (y: number): number => size * 0.43 + Math.sin(y / 23) * 5;
  const yMouth = Math.round(size * 0.56);
  const riverDist = (x: number, y: number): number => {
    const dNorth = y <= yMouth ? Math.abs(x - riverX(y)) : 1e9;
    const dWest = x <= riverX(yMouth) ? Math.abs(y - (yMouth + Math.sin(x / 17) * 3)) : 1e9;
    return Math.min(dNorth, dWest);
  };
  // river surface: descends from 14 m at the north edge to the sea at 0
  const riverSurf = (x: number, y: number): number => {
    const lenNorth = yMouth, lenWest = riverX(yMouth) - seaX;
    const total = lenNorth + lenWest;
    const along = y <= yMouth && Math.abs(x - riverX(y)) < Math.abs(y - yMouth) + 3 ? y : lenNorth + (riverX(yMouth) - x);
    return Math.max(0, 14 * (1 - along / total));
  };
  for (let vy = 0; vy <= size; vy++)
    for (let vx = 0; vx <= size; vx++) {
      let h = 16 + noise.noise2(vx / 90, vy / 90) * 7 + noise.noise2(vx / 23, vy / 23) * 1.5 + (vx / size) * 10;
      // coast
      const coast = (vx - seaX) / 8;
      if (coast < 1) h = Math.min(h, -4 + Math.max(0, coast) * 10);
      // river valley
      const d = riverDist(vx, vy);
      if (d < 14) {
        const surf = riverSurf(vx, vy);
        const bank = surf + 1.2 + Math.max(0, d - 2) * 0.9;
        const bed = surf - 2.5;
        h = d < 2 ? Math.min(h, bed) : Math.min(h, bank);
      }
      w.heights[vy * s1 + vx] = h;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hc = w.cellHeight(x, y);
      if (x < seaX + 2 && hc < -0.2) w.water[i] = 0;
      else if (riverDist(x + 0.5, y + 0.5) < 2 && hc < riverSurf(x, y)) w.water[i] = riverSurf(x, y);
      // forests on the eastern hills
      if (!(w.water[i] > hc + WATER_EPS)) {
        const f = noise.noise2(x / 30 + 40, y / 30);
        if (f > 0.25 && x > size * 0.7) w.trees[i] = f > 0.55 ? 3 : f > 0.4 ? 2 : 1;
      }
      const wv = 150 + noise.noise2(x / 50 + 7, y / 50) * 90 + (x / size) * 20;
      w.fields.wind[i] = Math.max(0, Math.min(255, Math.round(wv)));
    }
  w.seaLevel = 0;

  const probes: SceneInfo['probes'] = {};
  const tiles = Math.max(1, Math.floor(size / 256));
  for (let ty = 0; ty < tiles; ty++)
    for (let tx = 0; tx < tiles; tx++) layoutTile(w, rng, tx * 256, ty * 256, tx === 0 && ty === 0 ? probes : null);
  // weather: moderate westerly wind blowing east (+x)
  w.weather = { type: 'clear', intensity: 0.1, temperature: 18, windDir: 0.15, windSpeed: 6, snowCover: 0, nextChange: 10 };
  w.time = { day: 120, hour: 13, speed: 1 };
  return { world: w, probes };
}

function place(w: World, defId: string, x: number, y: number, rot: Dir = Dir.S, extra: Partial<Building> = {}): Building | null {
  const def = buildingDef(defId);
  if (!def) throw new Error('unknown def ' + defId);
  const bw = rot === Dir.N || rot === Dir.S ? def.w : def.h;
  const bh = rot === Dir.N || rot === Dir.S ? def.h : def.w;
  for (let yy = y; yy < y + bh; yy++)
    for (let xx = x; xx < x + bw; xx++) if (!w.inBounds(xx, yy) || w.bldg[w.idx(xx, yy)] || w.road[w.idx(xx, yy)]) return null;
  return w.addBuilding({ kind: 'service', defId, x, y, w: bw, h: bh, rot, built: 1, efficiency: 1, jobs: def.jobs ?? 0, workers: def.jobs ?? 0, ...extra });
}

/** Place a service somewhere in [x0,x1)×[y0,y1): free dry footprint, road access, optional shoreline. */
function placeNear(w: World, defId: string, x0: number, y0: number, x1: number, y1: number, shore = false): Building | null {
  const def = buildingDef(defId);
  if (!def) throw new Error('unknown def ' + defId);
  for (const rot of [Dir.S, Dir.E, Dir.N, Dir.W]) {
    const bw = rot === Dir.N || rot === Dir.S ? def.w : def.h;
    const bh = rot === Dir.N || rot === Dir.S ? def.h : def.w;
    for (let y = y0; y + bh <= y1; y++)
      for (let x = x0; x + bw <= x1; x++) {
        let ok = true, wet = false, roadAdj = false;
        for (let yy = y - 1; yy <= y + bh && ok; yy++)
          for (let xx = x - 1; xx <= x + bw; xx++) {
            const inside = xx >= x && xx < x + bw && yy >= y && yy < y + bh;
            const corner = (xx === x - 1 || xx === x + bw) && (yy === y - 1 || yy === y + bh);
            if (!w.inBounds(xx, yy)) { if (inside) { ok = false; break; } continue; }
            const i = w.idx(xx, yy);
            if (inside) {
              if (w.bldg[i] || w.road[i] || w.isWater(xx, yy)) { ok = false; break; }
            } else if (!corner) {
              if (w.isWater(xx, yy)) wet = true;
              const t = w.road[i];
              if (t && t !== RoadType.Rail && t !== RoadType.Highway) roadAdj = true;
            }
          }
        if (ok && roadAdj && (!shore || wet)) return w.addBuilding({ kind: 'service', defId, x, y, w: bw, h: bh, rot, built: 1, efficiency: 1, jobs: def.jobs ?? 0, workers: def.jobs ?? 0 });
      }
  }
  return null;
}

function zoned(w: World, zone: ZoneType, x: number, y: number, bw: number, bh: number, level: number, rot: Dir, extra: Partial<Building> = {}): Building | null {
  for (let yy = y; yy < y + bh; yy++)
    for (let xx = x; xx < x + bw; xx++) {
      if (!w.inBounds(xx, yy)) return null;
      const i = w.idx(xx, yy);
      if (w.bldg[i] || w.road[i] || w.isWater(xx, yy)) return null;
    }
  const z = zoneDef(zone);
  const cap = Math.round(z.capacityPerCell * bw * bh * LEVEL_CAPACITY[level]);
  const res = z.category === 'res';
  for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) w.setZone(xx, yy, zone);
  return w.addBuilding({
    kind: 'zoned', defId: 'zoned:' + z.id, zone, x, y, w: bw, h: bh, rot, level, built: 1,
    residents: res ? Math.round(cap * 0.9) : zone === ZoneType.MixedUse ? Math.round(cap * 0.6) : 0,
    maxResidents: res ? cap : 0,
    jobs: res ? (zone === ZoneType.MixedUse ? Math.round(cap * 0.3) : 0) : cap,
    workers: res ? 0 : Math.round(cap * 0.85),
    ...extra,
  });
}

function road(w: World, x0: number, y0: number, x1: number, y1: number, t: RoadType): void {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  for (;;) {
    if (w.inBounds(x, y) && !w.bldg[w.idx(x, y)]) w.setRoad(x, y, t, w.isWater(x, y) ? 1 : 0);
    if (x === x1 && y === y1) break;
    x += dx;
    y += dy;
  }
}

/** Lay out one 256×256 city tile at (ox, oy). */
function layoutTile(w: World, rng: RNG, ox: number, oy: number, probes: SceneInfo['probes'] | null): void {
  const X = (x: number) => ox + x, Y = (y: number) => oy + y;
  const step = 7;
  const gx0 = 36, gx1 = 204, gy0 = 18, gy1 = 222;
  // streets + avenues (every third line) — a big connected grid
  for (let x = gx0; x <= gx1; x += step) road(w, X(x), Y(gy0), X(x), Y(gy1), (x - gx0) % (step * 3) === 0 ? RoadType.Avenue : RoadType.Street);
  for (let y = gy0; y <= gy1; y += step) road(w, X(gx0), Y(y), X(gx1), Y(y), (y - gy0) % (step * 3) === 0 ? RoadType.Avenue : RoadType.Street);
  // a boulevard and a pedestrian street downtown
  road(w, X(gx0 + step * 9), Y(gy0), X(gx0 + step * 9), Y(gy1), RoadType.Boulevard);
  road(w, X(gx0 + step * 4), Y(gy0 + step * 12), X(gx0 + step * 7), Y(gy0 + step * 12), RoadType.Pedestrian);
  // highway on the east edge + link, rail on the south edge
  road(w, X(236), Y(0), X(236), Y(255), RoadType.Highway);
  road(w, X(gx1), Y(gy0 + step * 15), X(236), Y(gy0 + step * 15), RoadType.Avenue);
  road(w, X(0), Y(246), X(255), Y(246), RoadType.Rail);

  // the eastern outskirts: island suburb (no plant) and brownout suburb (one turbine)
  const islandX = 212, islandY = 150;
  for (let k = 0; k < 3; k++) road(w, X(islandX), Y(islandY + k * 7), X(islandX + 16), Y(islandY + k * 7), RoadType.Street);
  road(w, X(islandX), Y(islandY), X(islandX), Y(islandY + 14), RoadType.Street);
  const brownX = 212, brownY = 20;
  for (let k = 0; k < 4; k++) road(w, X(brownX), Y(brownY + k * 7), X(brownX + 16), Y(brownY + k * 7), RoadType.Street);
  road(w, X(brownX), Y(brownY), X(brownX), Y(brownY + 21), RoadType.Street);

  // ── services & utilities ──────────────────────────────────────────────
  const svc = (id: string, x: number, y: number, rot: Dir = Dir.S, extra: Partial<Building> = {}) => place(w, id, X(x), Y(y), rot, extra);
  // power: coal plant in the industrial south-east, wind on the hills, solar field
  const coal = svc('coal_plant', gx0 + step * 20 + 1, gy0 + step * 24 + 1);
  svc('wind_turbine', gx0 + step * 23 + 1, gy0 + 1);
  svc('wind_turbine', gx0 + step * 23 + 3, gy0 + 1);
  svc('solar_farm', gx0 + step * 22 + 1, gy0 + step * 2 + 1);
  // water: pumps + purification on the upper river, towers; sewage outlet + treatment at the river mouth
  const mouthY = Math.round(256 * 0.56);
  const pump = placeNear(w, 'water_pump_large', X(84), Y(24), X(140), Y(80), true);
  placeNear(w, 'water_pump_large', X(84), Y(60), X(140), Y(120), true);
  placeNear(w, 'water_treatment', X(84), Y(24), X(140), Y(130), true);
  const outlet = placeNear(w, 'sewage_outlet', X(36), Y(mouthY - 10), X(80), Y(mouthY + 10), true);
  placeNear(w, 'sewage_treatment', X(60), Y(mouthY - 12), X(110), Y(mouthY + 12), true);
  placeNear(w, 'sewage_treatment', X(90), Y(mouthY - 60), X(120), Y(mouthY + 12), true);
  // bulk power for the main grid
  placeNear(w, 'nuclear_plant', X(150), Y(150), X(204), Y(222));
  placeNear(w, 'nuclear_plant', X(120), Y(150), X(204), Y(222));
  placeNear(w, 'gas_plant', X(150), Y(150), X(204), Y(222));
  placeNear(w, 'fusion_plant', X(150), Y(120), X(204), Y(222));
  placeNear(w, 'water_treatment', X(84), Y(40), X(140), Y(140), true);
  placeNear(w, 'water_pump_large', X(36), Y(60), X(90), Y(140), true);
  svc('water_tower', gx0 + step * 18 + 1, gy0 + step * 5 + 1);
  svc('water_tower', gx0 + step * 18 + 3, gy0 + step * 5 + 1);
  // road services
  const police = svc('police_station', gx0 + step * 5 + 1, gy0 + step * 5 + 1);
  svc('fire_station', gx0 + step * 12 + 1, gy0 + step * 10 + 1);
  svc('clinic', gx0 + step * 8 + 1, gy0 + step * 16 + 1);
  svc('elementary_school', gx0 + step * 3 + 1, gy0 + step * 14 + 1);
  svc('landfill', gx0 + step * 22 + 1, gy0 + step * 27 + 1);
  svc('cemetery', gx0 + step * 15 + 1, gy0 + step * 26 + 1);
  const park = svc('city_park', gx0 + step * 6 + 1, gy0 + step * 9 + 1);
  svc('small_park', gx0 + step * 2 + 1, gy0 + step * 3 + 1);
  svc('playground', gx0 + step * 10 + 1, gy0 + step * 4 + 1);
  svc('metro_station', gx0 + step * 9 + 2, gy0 + step * 12 + 1);
  svc('clock_tower', gx0 + step * 7 + 1, gy0 + step * 7 + 1);

  // ── zoned blocks ──────────────────────────────────────────────────────
  for (let by = gy0; by < gy1; by += step)
    for (let bx = gx0; bx < gx1; bx += step) {
      const cx = (bx - gx0) / step, cy = (by - gy0) / step;
      let zone: ZoneType;
      if (cy >= 22 && cx >= 12) zone = cx >= 20 ? (cx === 23 ? ZoneType.Oil : ZoneType.Industry) : ZoneType.Industry;
      else if (cy <= 6 && cx >= 14) zone = ZoneType.Office;
      else if (cx >= 7 && cx <= 11 && cy >= 8 && cy <= 16) zone = (cx + cy) % 3 === 0 ? ZoneType.ComHigh : ZoneType.ResHigh;
      else if (cy % 5 === 2) zone = ZoneType.ComLow;
      else if (cx <= 4) zone = ZoneType.ResLow;
      else zone = ZoneType.ResMed;
      const lvl = zone === ZoneType.ResLow ? 1 + rng.int(0, 2) : 1 + rng.int(0, 4);
      // 2×3 lots facing north and south streets
      for (let lx = bx + 1; lx + 2 <= bx + step; lx += 2) {
        zoned(w, zone, X(lx), Y(by + 1), 2, 3, lvl, Dir.N);
        zoned(w, zone, X(lx), Y(by + 4), 2, 3, lvl, Dir.S);
      }
    }
  // abandoned pocket (blight + crime)
  for (const b of w.buildings.values())
    if (b.kind === 'zoned' && b.x >= X(gx0 + step * 1) && b.x < X(gx0 + step * 3) && b.y >= Y(gy0 + step * 20) && b.y < Y(gy0 + step * 22)) {
      b.flags |= BFlag.Abandoned;
      b.residents = 0;
      b.workers = 0;
    }
  // island suburb houses (no plant) and brownout suburb (one turbine, many houses)
  for (let k = 0; k < 2; k++) for (let lx = islandX + 1; lx + 2 <= islandX + 16; lx += 2) {
    zoned(w, ZoneType.ResLow, X(lx), Y(islandY + k * 7 + 1), 2, 3, 2, Dir.N);
    zoned(w, ZoneType.ResMed, X(lx), Y(islandY + k * 7 + 4), 2, 3, 3, Dir.S);
  }
  svc('wind_turbine', brownX + 17, brownY + 7);
  for (let k = 0; k < 3; k++) for (let lx = brownX + 1; lx + 2 <= brownX + 16; lx += 2) {
    zoned(w, ZoneType.ResMed, X(lx), Y(brownY + k * 7 + 1), 2, 3, 3, Dir.N);
    zoned(w, ZoneType.ResMed, X(lx), Y(brownY + k * 7 + 4), 2, 3, 3, Dir.S);
  }
  // a transit line through downtown
  w.transitLines.push({
    id: w.transitLines.length + 1, mode: 'bus', name: 'Line ' + (w.transitLines.length + 1), color: '#e44', vehicles: 4, active: true, ridership: 0,
    stops: [0, 3, 6, 9, 12].map((k) => ({ x: X(gx0 + step * (4 + k)), y: Y(gy0 + step * 18) })),
  });
  if (probes) {
    const c = (b: Building | null) => (b ? { x: b.x, y: b.y } : { x: -1, y: -1 });
    probes.coal = c(coal);
    probes.pump = c(pump);
    probes.outlet = c(outlet);
    probes.police = c(police);
    probes.park = c(park);
    // snap probe points onto the nearest zoned building (its footprint centre)
    const snap = (x: number, y: number) => {
      let best: Building | null = null, bd = Infinity;
      for (const b of w.buildings.values()) {
        if (b.kind !== 'zoned') continue;
        const d = (b.x + b.w / 2 - x) ** 2 + (b.y + b.h / 2 - y) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      return best ? { x: best.x + (best.w >> 1), y: best.y + (best.h >> 1) } : { x, y };
    };
    probes.island = snap(X(islandX + 3), Y(islandY + 2));
    probes.brownNear = snap(X(brownX + 14), Y(brownY + 9));
    probes.brownFar = snap(X(brownX + 1), Y(brownY + 16));
    probes.downtown = snap(X(gx0 + step * 9 + 5), Y(gy0 + step * 12 + 3));
    probes.suburbWest = snap(X(gx0 + 3), Y(gy0 + step * 10 + 2));
    probes.industry = snap(X(gx0 + step * 18 + 3), Y(gy0 + step * 25 + 2));
    probes.abandoned = snap(X(gx0 + step * 2), Y(gy0 + step * 21 + 2));
  }
}
