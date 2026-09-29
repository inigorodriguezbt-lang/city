// Robust screenshot for the service gallery on a loaded machine:
// waits until the page reports window.__done (sheet rendered once), then shoots.
// usage: node sandbox/buildings-service/shot.cjs "<query>" out.png [WxH] [maxWaitMs]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [query, out, size = '1600x900', maxWait = '240000'] = process.argv.slice(2);
  const [W, H] = size.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(Number(maxWait));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:5210/sandbox/buildings-service/?${query}&once=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__done === true, null, { timeout: Number(maxWait), polling: 500 });
  const rep = await page.evaluate(() => window.__summary);
  if (rep) console.log(rep);
  await page.screenshot({ path: out, timeout: Number(maxWait) });
  console.log('saved', out, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await browser.close();
})().catch((e) => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
