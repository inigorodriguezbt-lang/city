// Headless screenshot helper for agents & CI.
// usage: node scripts/shot.cjs <url> <out.png> [waitMs=4000] [WxH=1280x800] [--eval "js"] [--eval-file f.js] [--log]
// Prints console errors/page errors. `--eval` runs after waiting (can be async), then waits 1.5s and shoots.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const args = process.argv.slice(2);
  const url = args[0], out = args[1];
  const wait = Number(args[2] ?? 4000);
  const [W, H] = (args[3] ?? '1280x800').split('x').map(Number);
  const evalIdx = args.indexOf('--eval');
  const evalFileIdx = args.indexOf('--eval-file');
  let code = evalIdx >= 0 ? args[evalIdx + 1] : null;
  if (evalFileIdx >= 0) code = require('fs').readFileSync(args[evalFileIdx + 1], 'utf8');
  const log = args.includes('--log');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (log || m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  if (code) {
    try {
      const r = await page.evaluate(`(async () => { ${code} })()`);
      if (r !== undefined) console.log('[eval result]', typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { console.log('[eval error]', e.message); }
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: out });
  console.log('saved', out);
  await browser.close();
})();
