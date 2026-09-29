// End-to-end playtest: boots the real game headless, builds a small working
// city through the public APIs, runs the simulation, exercises commands,
// saves/loads, and captures screenshots + console errors.
// usage: node scripts/playtest.cjs <baseUrl> <outDir> [--size small] [--seconds 60] [--quick]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const base = args[0] ?? 'http://localhost:5173/';
const out = args[1] ?? 'screenshots/playtest';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const size = opt('size', 'small');
const seconds = Number(opt('seconds', '60'));
const quick = args.includes('--quick');
fs.mkdirSync(out, { recursive: true });

const errors = [];
const log = (...a) => console.log('[playtest]', ...a);

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  const shot = async (name) => { const p = path.join(out, name + '.png'); await page.screenshot({ path: p, timeout: 180000 }); log('shot', p); };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // 1. main menu
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await shot('01-main-menu');

  // 2. autostart a city
  const t0 = Date.now();
  await page.goto(base + `?autostart=1&size=${size}&seed=42`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.world && !window.__game.menus.isOpen(), null, { timeout: 180000 });
  log('world ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.waitForTimeout(5000);
  await shot('02-new-city');

  // 3. build a starter city through public APIs (creative to avoid money gating)
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
  log('build result', JSON.stringify(build).slice(0, 1500));
  await page.waitForTimeout(4000);
  await shot('03-built');

  // 4. grow the city: fast-forward in chunks (headless rendering is too slow for real-time growth)
  const samples = [];
  const steps = quick ? 3 : Math.max(3, Math.round(seconds / 10));
  for (let i = 0; i < steps; i++) {
    const t = Date.now();
    await ev(() => window.__game.sim.advanceDays(30));
    await page.waitForTimeout(1500);
    samples.push(await ev(() => { const w = window.__game.world; return { day: Math.round(w.time.day), pop: w.stats.population, bld: w.buildings.size, money: Math.round(w.economy.money), demand: w.stats.demand, happy: Math.round(w.stats.happiness), jobs: w.stats.jobs, unemployed: w.stats.unemployed, fps: Math.round(window.__game.fps), veh: w.stats.vehicles }; }));
    samples[samples.length - 1].ms = Date.now() - t;
    log('sample', JSON.stringify(samples[samples.length - 1]));
  }
  await ev(() => window.__game.sim.setSpeed(1));
  await page.waitForTimeout(4000);
  await shot('04-grown-day');

  // 5. commands + time of day
  const cmd = async (line) => { await ev((l) => window.__game.commands.execute(l), line); await page.waitForTimeout(600); };
  await cmd('/time set 19:10'); await page.waitForTimeout(2500); await shot('05-dusk');
  await cmd('/time set 23:00'); await page.waitForTimeout(2500); await shot('06-night');
  await cmd('/time set 11:00');
  await cmd('/weather rain 3'); await page.waitForTimeout(3000); await shot('07-rain');
  await cmd('/weather snow 3'); await page.waitForTimeout(3000); await shot('08-snow');
  await cmd('/weather clear 3');
  await ev(() => window.__game.chat.open('/lo'));
  await page.waitForTimeout(500); await shot('09-chat');
  await ev(() => window.__game.chat.close());
  await ev(() => window.__game.renderer.setOverlay('landValue')); await page.waitForTimeout(2500); await shot('10-overlay-landvalue');
  await ev(() => window.__game.renderer.setOverlay(null));
  await ev(() => window.__game.ui.openPanel('budget')); await page.waitForTimeout(800); await shot('11-budget');
  await ev(() => window.__game.ui.closePanels());
  await ev(() => window.__game.menus.openOptions()); await page.waitForTimeout(800); await shot('12-options');
  await ev(() => window.__game.menus.closeTop());

  // 6. save / load round trip
  const saveRes = await ev(async () => {
    const g = window.__game;
    const before = { pop: g.world.stats.population, bld: g.world.buildings.size, day: g.world.time.day };
    const meta = await g.saves.save('Playtest Save');
    const list = await g.saves.list();
    const ok = meta ? await g.saves.load(meta.id) : false;
    await new Promise((r) => setTimeout(r, 3000));
    const after = { pop: g.world?.stats.population, bld: g.world?.buildings.size, day: g.world?.time.day };
    return { meta: meta && { id: meta.id, bytes: meta.bytes }, count: list.length, ok, before, after };
  });
  log('save/load', JSON.stringify(saveRes));
  await page.waitForTimeout(3000);
  await shot('13-after-load');

  // 7. disaster
  await cmd('/summon tornado'); await page.waitForTimeout(5000); await shot('14-tornado');

  log('errors', errors.length);
  for (const e of errors.slice(0, 40)) console.log('  ', e.slice(0, 400));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ build, samples, saveRes, errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error('PLAYTEST CRASH', e); process.exit(1); });
