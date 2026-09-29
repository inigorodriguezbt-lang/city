// events sandbox screenshot helper: waits, prints HUD + frame count, pauses the loop, shoots.
// usage: node sandbox/events/shot.cjs "<query>" out.png [waitMs=15000] [WxH=1280x720]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [q, out, waitArg, size] = process.argv.slice(2);
  const wait = Number(waitArg ?? 15000);
  const [W, H] = (size ?? '1280x720').split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:5206/sandbox/events/?${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  const info = await page.evaluate(() => { window.__pause = true; return { frames: window.__frames, hud: document.getElementById('hud')?.textContent }; });
  console.log(JSON.stringify(info));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, timeout: 120000 });
  console.log('saved', out);
  await browser.close();
})();
