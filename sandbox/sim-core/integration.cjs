// sim-core integration check: boots the real game headless (dev server with
// HMR off, see vite.config.ts here), builds a small city through the public
// APIs, runs the simulation at high speed and reports sim stats, perf,
// notices and any runtime errors (no screenshots, so it stays fast under
// SwiftShader).
// usage: node sandbox/sim-core/integration.cjs [baseUrl] [seconds]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const base = process.argv[2] ?? 'http://localhost:5203/';
const seconds = Number(process.argv[3] ?? 60);
const log = (...a) => console.log('[sim-core]', ...a);

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const t0 = Date.now();
  await page.goto(base + '?autostart=1&size=small&seed=42', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.world && !window.__game.menus.isOpen(), null, { timeout: 240000 });
  log('world ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const build = await ev(() => {
    const g = window.__game, w = g.world, A = g.actions;
    g.setCreative(true);
    const R = { Street: 2, Avenue: 3, Highway: 5 };
    // highway cell nearest home
    let best = null, bd = 1e9;
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) if (w.road[y * w.size + x] === R.Highway) {
      const d = (x - w.home.x) ** 2 + (y - w.home.y) ** 2; if (d < bd) { bd = d; best = { x, y }; }
    }
    const res = { highwayEnd: best, placed: [], errors: [] };
    if (!best) { res.errors.push('no highway'); return res; }
    // find a dry buildable direction from the highway end
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let bestDir = null, bestScore = -1;
    for (const [dx, dy] of dirs) {
      let s = 0;
      for (let i = 1; i <= 24; i++) { const x = best.x + dx * i, y = best.y + dy * i; if (!w.inBounds(x, y) || w.isWater(x, y) || w.cellSlope(x, y) > 0.15) break; if (!w.road[w.idx(x, y)]) s++; }
      if (s > bestScore) { bestScore = s; bestDir = [dx, dy]; }
    }
    const [dx, dy] = bestDir;
    const L = Math.min(24, bestScore);
    const a = { x: best.x + dx, y: best.y + dy }, b = { x: best.x + dx * L, y: best.y + dy * L };
    const main = A.placeRoad(A.planRoad(a, b, R.Avenue, 'straight'), R.Avenue);
    res.placed.push(['main', main]);
    // cross streets every 6 cells
    const px = -dy, py = dx;
    for (let i = 4; i <= L; i += 6) {
      const c = { x: best.x + dx * i, y: best.y + dy * i };
      for (const s of [1, -1]) {
        const e = { x: c.x + px * 12 * s, y: c.y + py * 12 * s };
        const r = A.placeRoad(A.planRoad({ x: c.x + px * s, y: c.y + py * s }, e, R.Street, 'straight'), R.Street);
        res.placed.push(['cross', r.ok, r.reason]);
      }
    }
    // zone a block on each side: residential near, commercial along main, industry far end
    const zr = (x0, y0, x1, y1, z) => A.zoneRect({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }, z);
    const far = { x: best.x + dx * L, y: best.y + dy * L };
    res.placed.push(['zoneRes', zr(best.x + dx * 2 + px * 1, best.y + dy * 2 + py * 1, best.x + dx * (L - 8) + px * 12, best.y + dy * (L - 8) + py * 12, 1).ok]);
    res.placed.push(['zoneCom', zr(best.x + dx * 2 - px * 1, best.y + dy * 2 - py * 1, best.x + dx * (L - 8) - px * 4, best.y + dy * (L - 8) - py * 4, 4).ok]);
    res.placed.push(['zoneInd', zr(far.x - dx * 6 - px * 12, far.y - dy * 6 - py * 12, far.x - px * 2, far.y - py * 2, 7).ok]);
    // services: try placing near road cells until one succeeds
    const tryPlace = (defId) => {
      for (let i = 2; i <= L; i++) for (const s of [3, -3, 4, -4, 5, -5]) for (let rot = 0; rot < 4; rot++) {
        const x = best.x + dx * i + px * s, y = best.y + dy * i + py * s;
        const c = A.checkBuilding(defId, x, y, rot);
        if (c.ok) { const r = A.placeBuilding(defId, x, y, rot); if (r.ok) return { defId, x, y, rot }; }
      }
      return { defId, failed: true };
    };
    for (const id of ['coal_plant', 'wind_turbine', 'water_tower', 'fire_station', 'police_station', 'clinic', 'elementary_school', 'small_park', 'landfill']) res.placed.push(['svc', tryPlace(id)]);
    // water pump + sewage on a shore if any near
    g.renderer.cameraCtl.flyTo(best.x + dx * L / 2, best.y + dy * L / 2, 700, true);
    g.setCreative(false);
    g.world.economy.money = 500000;
    return res;
  });
  log('build', JSON.stringify(build).slice(0, 600));
  await ev(() => window.__game.sim.setSpeed(4));
  const steps = Math.max(2, Math.round(seconds / 10));
  for (let i = 0; i < steps; i++) {
    await page.waitForTimeout(10000);
    const s = await ev(() => {
      const g = window.__game, w = g.world, st = w.stats, p = g.sim.perf;
      return { day: Math.round(w.time.day), pop: st.population, jobs: st.jobs, bld: w.buildings.size, money: Math.round(w.economy.money), net: st.netIncome,
        d: Object.values(st.demand).map((v) => v.toFixed(2)).join('/'), happy: st.happiness, power: st.power, fps: Math.round(g.fps), tick: p.avgTickMs.toFixed(3) };
    });
    log('sample', JSON.stringify(s));
  }
  const report = await ev(() => {
    const g = window.__game, w = g.world, sim = g.sim;
    const zoned = [...w.buildings.values()].find((b) => b.kind === 'zoned' && b.built >= 1);
    const svc = [...w.buildings.values()].find((b) => b.kind === 'service' && b.built >= 1);
    const t = performance.now();
    sim.advanceDays(60);
    const ff = performance.now() - t;
    return {
      ff: Math.round(ff), day: Math.round(w.time.day), pop: w.stats.population,
      notices: w.notices.slice(-12).map((n) => `${n.kind} ${n.title}: ${n.text}`.slice(0, 140)),
      zoned: zoned ? JSON.stringify(sim.buildingInfo(zoned.id)).slice(0, 700) : null,
      svc: svc ? JSON.stringify(sim.buildingInfo(svc.id)).slice(0, 500) : null,
      projection: JSON.stringify(sim.projection()).slice(0, 600),
      tips: sim.advisorTips().slice(0, 4).map((t) => t.title),
      stats: JSON.stringify(w.stats).slice(0, 900),
    };
  });
  log('report', JSON.stringify(report, null, 1));
  const simErrors = errors.filter((e) => /\/sim\/|Simulation|sim-core/.test(e));
  log('errors total', errors.length, 'sim-related', simErrors.length);
  for (const e of simErrors.slice(0, 10)) log('  ', e.slice(0, 400));
  for (const e of errors.slice(0, 8)) log('  (all)', e.slice(0, 200));
  await browser.close();
})().catch((e) => { console.error('INTEGRATION CRASH', e); process.exit(1); });
