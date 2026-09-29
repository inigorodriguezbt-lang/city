// Multi-view screenshot helper for the render-core sandbox: loads the page
// once (map generation is slow under SwiftShader), then applies a list of
// views and captures each.
// usage: node sandbox/render-core/shots.cjs "<query>" <outPrefix> <views.json|inline JSON> [WxH]
// a view: { "name": "noon", "hour": 12, "cam": [x,y,dist,yawDeg,pitchDeg], "weather": "rain",
//           "intensity": 0.8, "snow": 0, "month": 5, "overlay": "landValue", "settings": {...}, "frames": 3 }
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [query, prefix, viewsArg, size] = process.argv.slice(2);
  const views = JSON.parse(fs.existsSync(viewsArg) ? fs.readFileSync(viewsArg, 'utf8') : viewsArg);
  const [W, H] = (size ?? '1280x720').split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:5207/sandbox/render-core/?clean=1&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__frames ?? 0) > 2, null, { timeout: 240000, polling: 500 });
  for (const v of views) {
    await page.evaluate((v) => {
      const r = window.__r, w = window.__world;
      if (v.hour !== undefined) w.time.hour = v.hour;
      if (v.month !== undefined) w.time.day = v.month * 30 + 12;
      if (v.weather !== undefined) w.weather.type = v.weather;
      if (v.intensity !== undefined) w.weather.intensity = v.intensity;
      if (v.snow !== undefined) w.weather.snowCover = v.snow;
      if (v.wind !== undefined) w.weather.windSpeed = v.wind;
      if (v.flood !== undefined) w.floodOffset = v.flood;
      if (v.overlay !== undefined) r.setOverlay(v.overlay);
      if (v.settings) {
        const s = window.__game.settings.value;
        Object.assign(s.graphics, v.settings);
        r.applySettings(s);
      }
      if (v.cam) r.cameraCtl.setPose(v.cam[0] < 0 ? w.home.x : v.cam[0], v.cam[1] < 0 ? w.home.y : v.cam[1], v.cam[2], (v.cam[3] * Math.PI) / 180, (v.cam[4] * Math.PI) / 180);
      if (!v.blend) r.snapTransitions();
      if (v.eval) new Function('r', 'w', v.eval)(r, w);
      window.__mark = window.__frames;
      window.__pause = false;
    }, v);
    const frames = v.frames ?? 3;
    await page.waitForFunction((n) => window.__frames - window.__mark >= n, frames, { timeout: 240000, polling: 300 });
    const info = await page.evaluate(() => {
      window.__pause = true;
      const r = window.__r;
      return `upd ${(window.__upd ?? 0).toFixed(2)}ms calls ${r.stats.drawCalls} tris ${(r.stats.triangles / 1000) | 0}k trees ${r.trees ? r.trees.instanceCount : 0} leaves ${r.terrain ? r.terrain.leafCount : 0}`;
    });
    const out = `${prefix}-${v.name}.png`;
    await page.waitForTimeout(300);
    await page.screenshot({ path: out, timeout: 120000 });
    console.log('saved', out, info);
  }
  await browser.close();
})();
