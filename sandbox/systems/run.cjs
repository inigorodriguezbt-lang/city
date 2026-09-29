// Headless runner for the Systems Lab: waits for the automated suites, then
// exercises the LIVE AudioManager (real AudioContext, autoplay allowed) and
// measures the mixed output. Usage:
//   node sandbox/systems/run.cjs [url] [out.png] [WxH]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:5213/sandbox/systems/';
  const out = process.argv[3] ?? 'systems.png';
  const [W, H] = (process.argv[4] ?? '1440x1500').split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => {
    const t = m.text();
    if (/^(PASS|FAIL|SUMMARY)/.test(t) || m.type() === 'error') console.log(t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__systemsDone, null, { timeout: 240000, polling: 500 });
  // live audio: a real gesture, then sample the mix in several scenes
  await page.click('text=Start audio');
  const live = await page.evaluate(async () => {
    const g = window.__lab;
    const a = g.audio;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const level = async (ms) => { let m = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { m = Math.max(m, a.outputLevel()); await wait(8); } return m; };
    const res = {};
    res.state = a.context && a.context.state;
    g.settings.set({ audio: { music: 0, ambience: 0 } });
    await wait(1500);
    res.silence = await level(400);
    g.settings.set({ audio: { music: 0.6 } });
    a.forceMood = 'day';
    res.music = await level(4000);
    g.settings.set({ audio: { music: 0, ambience: 0.8 } });
    a.debugScene = { ...a.debugScene, active: true, weather: 'storm', intensity: 0.9, altitude: 1800, vehicles: 2000, hour: 23, daylight: 0.05, season: 'summer', temperature: 24 };
    res.storm = await level(2500);
    res.layers = a.ambienceLevels();
    a.debugScene = { ...a.debugScene, weather: 'clear', altitude: 200, hour: 7, daylight: 0.7, trees: 0.9 };
    res.day = await level(2500);
    g.settings.set({ audio: { ambience: 0 } });
    await wait(1200);
    const sfx = {};
    for (const id of ['click', 'place', 'money', 'milestone', 'explosion']) {
      a.play(id);
      sfx[id] = await level(700);
      await wait(300);
    }
    res.sfx = sfx;
    g.settings.set({ audio: { muted: true } });
    await wait(600);
    a.play('explosion');
    res.muted = await level(500);
    g.settings.set({ audio: { muted: false, music: 0.5, ambience: 0.7 } });
    a.forceMood = null;
    a.debugScene = { ...a.debugScene, weather: 'rain', intensity: 0.6, altitude: 400, hour: 17, daylight: 0.7 };
    return res;
  });
  const ok = (name, cond, detail) => console.log(`${cond ? 'PASS' : 'FAIL'} [live-audio] ${name}${detail ? ' — ' + detail : ''}`);
  const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) + ' dB' : '-inf');
  ok('AudioContext running after a gesture', live.state === 'running', live.state);
  ok('silence when buses are at zero', live.silence < 0.002, db(live.silence));
  ok('generative music is audible', live.music > 0.005, db(live.music));
  ok('storm-night ambience is audible', live.storm > 0.005, `${db(live.storm)} ${JSON.stringify(live.layers)}`);
  ok('daytime ambience (birds, wind, city) is audible', live.day > 0.003, db(live.day));
  for (const [id, v] of Object.entries(live.sfx)) ok(`sfx ${id} reaches the output`, v > 0.002, db(v));
  ok('mute silences everything', live.muted < 0.002, db(live.muted));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: true });
  console.log('saved', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
