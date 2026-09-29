// Grows a real city through the public APIs (creative mode), fast-forwards the
// simulation and captures beauty shots at several times of day.
// usage: node scripts/showcase.cjs <baseUrl> <outDir> [--days 720] [--seed 42] [--theme temperate]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const base = args[0] ?? 'http://localhost:8080/';
const out = args[1] ?? 'screenshots/showcase';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const days = Number(opt('days', '720'));
const seed = opt('seed', '42');
const theme = opt('theme', 'temperate');
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log('[showcase]', ...a);
const errors = [];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' && !/CERT|fonts/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  const shot = async (name) => { const p = path.join(out, name + '.png'); await page.screenshot({ path: p, timeout: 240000 }); log('shot', p); };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(base + `?autostart=1&size=small&seed=${seed}&theme=${theme}&creative=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.world && !window.__game.menus.isOpen(), null, { timeout: 240000 });
  log('world ready');

  const plan = await ev(() => {
    const g = window.__game, w = g.world, A = g.actions;
    const R = { Street: 2, Avenue: 3, Boulevard: 4, Highway: 5 };
    const Z = { ResLow: 1, ResMed: 2, ResHigh: 3, ComLow: 4, ComHigh: 5, Office: 6, Industry: 7 };
    let best = null, bd = 1e9;
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) if (w.road[y * w.size + x] === R.Highway) {
      const d = (x - w.home.x) ** 2 + (y - w.home.y) ** 2; if (d < bd) { bd = d; best = { x, y }; }
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let dir = null, score = -1;
    for (const [dx, dy] of dirs) {
      let s = 0;
      for (let i = 1; i <= 40; i++) { const x = best.x + dx * i, y = best.y + dy * i; if (!w.inBounds(x, y) || w.isWater(x, y) || w.cellSlope(x, y) > 0.15) break; if (!w.road[w.idx(x, y)]) s++; }
      if (s > score) { score = s; dir = [dx, dy]; }
    }
    const [dx, dy] = dir, px = -dy, py = dx;
    const L = Math.min(40, score);
    const at = (i, s) => ({ x: best.x + dx * i + px * s, y: best.y + dy * i + py * s });
    const res = { L, placed: 0, failed: [] };
    const road = (a, b, t) => { const r = A.placeRoad(A.planRoad(a, b, t, 'straight'), t); if (r.ok) res.placed++; else res.failed.push(r.reason); };
    road(at(1, 0), at(L, 0), R.Boulevard);
    for (let i = 4; i <= L; i += 6) for (const s of [1, -1]) road(at(i, s), at(i, 16 * s), i % 12 === 4 ? R.Avenue : R.Street);
    for (const s of [8, -8, 16, -16]) road(at(4, s), at(Math.floor((L - 4) / 6) * 6 + 4, s), R.Street);
    const zr = (i0, s0, i1, s1, z) => { const a = at(i0, s0), b = at(i1, s1); return A.zoneRect({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, z).ok; };
    zr(2, 1, 16, 7, Z.ComHigh); zr(2, -1, 16, -7, Z.Office);
    zr(17, 1, L - 10, 7, Z.ResHigh); zr(17, -1, L - 10, -7, Z.ComLow);
    zr(2, 9, L - 10, 15, Z.ResMed); zr(2, -9, L - 10, -15, Z.ResLow);
    zr(2, 17, L - 10, 20, Z.ResLow); zr(2, -17, L - 10, -20, Z.ResLow);
    zr(L - 9, -16, L, 16, Z.Industry);
    const tryPlace = window.__scPlace = (defId) => {
      for (let i = 2; i <= L; i++) for (const s of [2, -2, 3, -3, 4, -4, 5, -5, 9, -9, 10, -10]) for (let rot = 0; rot < 4; rot++) {
        const p = at(i, s);
        if (A.checkBuilding(defId, p.x, p.y, rot).ok && A.placeBuilding(defId, p.x, p.y, rot).ok) return true;
      }
      res.failed.push('svc ' + defId); return false;
    };
    for (const id of ['city_hall', 'coal_plant', 'water_tower', 'water_tower', 'water_tower', 'water_tower', 'fire_station', 'police_station', 'hospital', 'clinic', 'elementary_school', 'high_school', 'city_park', 'small_park', 'small_park', 'landfill', 'bus_depot']) tryPlace(id);
    // sewage: reach the nearest shore with an auto-routed street
    let shore = null, sd = 1e9;
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) if (w.isShore(x, y)) { const c = at(L >> 1, 0); const d = (x - c.x) ** 2 + (y - c.y) ** 2; if (d < sd) { sd = d; shore = { x, y }; } }
    if (shore) {
      const r = A.placeRoad(A.planRoad(at(L >> 1, 16), shore, R.Street, 'auto'), R.Street);
      res.shoreRoad = r.ok;
      let ok = false;
      for (let dy2 = -3; dy2 <= 3 && !ok; dy2++) for (let dx2 = -3; dx2 <= 3 && !ok; dx2++) for (let rot = 0; rot < 4 && !ok; rot++) {
        const x = shore.x + dx2, y = shore.y + dy2;
        if (A.checkBuilding('sewage_outlet', x, y, rot).ok) ok = A.placeBuilding('sewage_outlet', x, y, rot).ok;
      }
      res.sewage = ok;
      window.__scShore = shore;
    }
    res.center = at(10, 0);
    return res;
  });
  log('plan', JSON.stringify(plan));

  for (let d = 0; d < days; d += 60) {
    const t = Date.now();
    await ev(() => window.__game.sim.advanceDays(60));
    // play the city manager: add capacity when utilities run short
    const added = await ev(() => {
      const g = window.__game, s = g.world.stats, A = g.actions, out = [];
      if (s.power.consumed > s.power.produced * 0.85) { if (window.__scPlace('coal_plant')) out.push('coal'); }
      if (s.water.consumed > s.water.produced * 0.85) { if (window.__scPlace('water_tower')) out.push('water'); if (window.__scPlace('water_tower')) out.push('water'); }
      if (s.sewage.produced > s.sewage.capacity * 0.85 && window.__scShore) {
        const sh = window.__scShore; let ok = false;
        for (let r = 1; r <= 6 && !ok; r++) for (let dy = -r; dy <= r && !ok; dy++) for (let dx = -r; dx <= r && !ok; dx++) for (let rot = 0; rot < 4 && !ok; rot++) {
          if (A.checkBuilding('sewage_outlet', sh.x + dx, sh.y + dy, rot).ok) ok = A.placeBuilding('sewage_outlet', sh.x + dx, sh.y + dy, rot).ok;
        }
        if (ok) out.push('sewage');
      }
      return out;
    });
    if (added.length) log('added', added.join(','));
    const s = await ev(() => { const w = window.__game.world; return { day: Math.round(w.time.day), pop: w.stats.population, bld: w.buildings.size, happy: Math.round(w.stats.happiness), demand: w.stats.demand, jobs: w.stats.jobs, unemp: w.stats.unemployed, ms: 0 }; });
    s.ms = Date.now() - t;
    log('grow', JSON.stringify(s));
  }

  const diag = await ev(() => {
    const g = window.__game, w = g.world;
    const P = ['NoPower','NoWater','NoSewage','NoRoad','Garbage','Crime','Sick','Fire','NoWorkers','NoCustomers','NoGoods','Pollution','Noise','Abandoned','Dead','NoEducated','HighRent','Flooded','Traffic','LowHappiness'];
    const hist = {}; let zoned = 0, lv = [0,0,0,0,0,0], full = 0, cap = 0, res = 0, abandoned = 0;
    for (const b of w.buildings.values()) {
      for (let i = 0; i < P.length; i++) if (b.problems & (1 << i)) hist[P[i]] = (hist[P[i]] || 0) + 1;
      if (b.kind === 'zoned') { zoned++; lv[b.level]++; cap += b.maxResidents; res += b.residents; if (b.flags & 32) abandoned++; }
    }
    let emptyZoned = 0;
    for (let i = 0; i < w.zone.length; i++) if (w.zone[i] && !w.bldg[i]) emptyZoned++;
    const s = w.stats;
    const byZone = {}; let withRoad = 0;
    const acc = (t) => t && t !== 5 && t !== 7;
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
      const i = y * w.size + x;
      if (!w.zone[i] || w.bldg[i]) continue;
      byZone[w.zone[i]] = (byZone[w.zone[i]] || 0) + 1;
      if (acc(w.roadAt(x + 1, y)) || acc(w.roadAt(x - 1, y)) || acc(w.roadAt(x, y + 1)) || acc(w.roadAt(x, y - 1))) withRoad++;
    }
    const cs = g.sim.ctx && g.sim.ctx.candidates;
    const probe = [];
    const gr = g.sim.growth;
    for (let y = 0; y < w.size && probe.length < 14; y++) for (let x = 0; x < w.size && probe.length < 14; x++) {
      const i = y * w.size + x;
      if (!w.zone[i] || w.bldg[i]) continue;
      if (!(acc(w.roadAt(x + 1, y)) || acc(w.roadAt(x - 1, y)) || acc(w.roadAt(x, y + 1)) || acc(w.roadAt(x, y - 1)))) continue;
      let lot = null; try { lot = gr.findLot(x, y, w.zone[i]); } catch (e) { lot = 'ERR ' + e.message; }
      const nb = []; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) nb.push((w.zone[w.idx(x+dx,y+dy)]||0) + '/' + (w.road[w.idx(x+dx,y+dy)]||0) + '/' + (w.bldg[w.idx(x+dx,y+dy)]?1:0));
      probe.push({ x, y, z: w.zone[i], unfit: cs.unfit[i], today: Math.floor(w.time.day), elig: cs.eligible(x, y, i), slope: +w.cellSlope(x, y).toFixed(2), lot, nb: nb.join(' ') });
    }
    const cand = cs ? [0, 1, 2, 3].map((c) => cs.count(c)) : null;
    const acc2 = g.sim.ctx && g.sim.ctx.state && g.sim.ctx.state.spawnAcc;
    return { probe, byZone, withRoad, cand, spawnAcc: acc2, hist, zoned, levels: lv, residents: res, capacity: cap, abandoned, emptyZoned, power: s.power, water: s.water, sewage: s.sewage, garbage: s.garbage, health: s.health_, edu: s.education_, dead: s.deathcare, factors: g.sim.demandFactors?.() };
  });
  log('diag', JSON.stringify(diag));

  await ev(() => { try { window.__game.eventSystem.setWeather('clear', 0, 30); } catch (e) {} });
  if (args.includes('--noshots')) { log('errors', errors.length); for (const e of errors.slice(0, 30)) console.log('  ', e.slice(0, 400)); await browser.close(); return; }
  const views = [
    ['golden', 18.3, 260, 0.9, 0.42],
    ['noon', 12.5, 420, 2.4, 0.62],
    ['dusk', 19.6, 300, 4.0, 0.38],
    ['night', 23.0, 320, 0.9, 0.5],
    ['street', 17.2, 60, 1.6, 0.16],
    ['overview', 10.0, 1400, 0.8, 0.85],
  ];
  await ev(() => { const g = window.__game; g.ui.setHudVisible(false); g.sim.setSpeed(1); });
  for (const [name, hour, dist, yaw, pitch] of views) {
    await ev(({ hour, dist, yaw, pitch, c }) => {
      const g = window.__game;
      g.sim.setHour(hour);
      g.renderer.snapTransitions?.();
      g.renderer.cameraCtl.setPose(c.x, c.y, dist, yaw, pitch);
    }, { hour, dist, yaw, pitch, c: plan.center });
    // wait until every detailed building chunk near the camera is built
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await page.waitForTimeout(4000);
      const st = await ev(() => { const b = window.__game.buildings; return { pend: (b.pendingDetail || []).length, refine: b.stats().pending }; });
      if (st.pend === 0 && Date.now() - t0 > 8000) break;
    }
    log(name, 'ready after', Math.round((Date.now() - t0) / 1000), 's');
    await shot(name);
  }
  await ev(() => window.__game.ui.setHudVisible(true));
  await page.waitForTimeout(3000);
  await shot('hud');
  log('errors', errors.length);
  for (const e of errors.slice(0, 30)) console.log('  ', e.slice(0, 400));
  await browser.close();
})().catch((e) => { console.error('SHOWCASE CRASH', e); process.exit(1); });
