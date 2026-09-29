// Robust sandbox screenshots under SwiftShader: waits for the sandbox to finish
// building, renders one frame and grabs the canvas directly (no compositor wait).
// usage: node sandbox/roads/shot.cjs <out.png> <query> [WxH] [out2.png query2 ...]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const args = process.argv.slice(2);
  let size = '1280x800';
  const jobs = [];
  for (let i = 0; i < args.length; i++) {
    if (/^\d+x\d+$/.test(args[i])) size = args[i];
    else jobs.push([args[i], args[++i]]);
  }
  const [W, H] = size.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  for (const [out, query] of jobs) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:5208/sandbox/roads/?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 300 });
    const data = await page.evaluate(() => {
      const sb = window.__sb;
      sb.renderer.render(sb.scene, sb.camera);
      return sb.renderer.domElement.toDataURL('image/png');
    });
    fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
    const stats = await page.evaluate(() => document.getElementById('stats').textContent);
    console.log('saved', out, `${((Date.now() - t0) / 1000).toFixed(1)}s`, stats);
    await page.close();
  }
  await browser.close();
})();
