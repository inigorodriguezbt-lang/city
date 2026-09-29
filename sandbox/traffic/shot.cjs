// Traffic sandbox screenshots under SwiftShader: waits until the sandbox has
// warmed up the simulation (window.__ready), renders one frame and grabs the
// canvas. usage: node sandbox/traffic/shot.cjs [WxH] <out.png> <query> [out2.png query2 ...]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const args = process.argv.slice(2);
  let size = '1280x800';
  const jobs = [];
  for (let i = 0; i < args.length; i++) {
    if (/^\d+x\d+$/.test(args[i])) size = args[i];
    else jobs.push([args[i], args[++i] ?? '']);
  }
  const [W, H] = size.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  for (const [out, query] of jobs) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[sb]')) console.log(`[${m.type()}]`, m.text()); });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:5205/sandbox/traffic/?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000, polling: 500 });
    const data = await page.evaluate(() => {
      const sb = window.__sb;
      sb.render();
      return sb.renderer.domElement.toDataURL('image/png');
    });
    fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
    const stats = await page.evaluate(() => document.getElementById('stats').textContent);
    console.log('saved', out, `${((Date.now() - t0) / 1000).toFixed(1)}s`, stats);
    await page.close();
  }
  await browser.close();
})();
