// End-to-end interaction check for the menus sandbox (run with the dev server on :5212):
//   node sandbox/ui-menus/flow.cjs [outDir]
// Walks main menu → New City → loading → chat (completion, history) → pause →
// options key rebinding → save dialog, asserting state along the way.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '/tmp';
const results = [];
const check = (name, ok, extra = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`;
  results.push(line);
  console.log(line);
};
process.on('unhandledRejection', (e) => {
  console.log('ABORT', e.message.split('\n')[0]);
  process.exit(1);
});
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => results.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:5212/sandbox/ui-menus/?screen=main', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const top = () => page.evaluate(() => window.__menus.topId());

  check('main menu open', (await top()) === 'main');
  check('input disabled on main menu', await page.evaluate(() => window.__game.input.enabled === false));

  // New City
  await page.click('.mn-mi[data-id="new"]');
  await page.waitForTimeout(600);
  check('new game dialog', (await top()) === 'newgame');
  await page.fill('.mn-ng-name input', 'Testopolis');
  await page.click('.mn-theme:nth-child(2)');
  const style = await page.evaluate(() => document.querySelector('.mn-style.on .mn-style-name')?.textContent);
  check('theme picks default style', style === 'Nordic', style);
  await page.focus('.mn-ng-name input');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('loading visible', await page.evaluate(() => !!document.querySelector('.mn-loading.show')));
  await page.waitForTimeout(3500);
  check('world created', await page.evaluate(() => window.__game.world?.settings.cityName) === 'Testopolis');
  check('menus closed after load', await page.evaluate(() => !window.__menus.isOpen()));
  check('input re-enabled', await page.evaluate(() => window.__game.input.enabled === true));

  // chat
  await page.keyboard.press('Slash');
  await page.waitForTimeout(300);
  check('chat open with /', await page.evaluate(() => window.__chat.isOpen && document.querySelector('.ch-input').value === '/'));
  check('input disabled while chatting', await page.evaluate(() => window.__game.input.enabled === false));
  await page.keyboard.type('ti');
  await page.keyboard.press('Tab');
  let v = await page.evaluate(() => document.querySelector('.ch-input').value);
  check('tab completes command', v === '/time ', JSON.stringify(v));
  await page.keyboard.type('s');
  await page.keyboard.press('Tab');
  v = await page.evaluate(() => document.querySelector('.ch-input').value);
  check('tab completes argument', v.startsWith('/time s'), JSON.stringify(v));
  const usage = await page.evaluate(() => document.querySelector('.ch-usage.show')?.textContent ?? '');
  check('usage shown', usage.includes('/time'), usage);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('/time set dusk');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('chat closed after enter', await page.evaluate(() => !window.__chat.isOpen));
  const lines = await page.evaluate(() => [...document.querySelectorAll('.ch-line')].map((l) => l.textContent));
  check('command echoed + result', lines.includes('/time set dusk') && lines.some((l) => l.startsWith('Done')), JSON.stringify(lines));
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowUp');
  v = await page.evaluate(() => document.querySelector('.ch-input').value);
  check('history up', v === '/time set dusk', JSON.stringify(v));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('escape closes chat', await page.evaluate(() => !window.__chat.isOpen && window.__game.input.enabled));

  // pause → options → rebind
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('escape opens pause', (await top()) === 'pause');
  await page.click('.mn-pi:nth-child(4)');
  await page.waitForTimeout(600);
  check('options open', (await top()) === 'options');
  await page.click('.mn-opt-tab:nth-child(3)');
  await page.waitForTimeout(400);
  await page.click('.mn-kb-row[data-action="camera.reset"] .mn-kslot');
  await page.waitForTimeout(200);
  check('capturing state', await page.evaluate(() => !!document.querySelector('.mn-kslot.capturing')));
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(300);
  const kb = await page.evaluate(() => window.__game.settings.value.controls.keybinds['camera.reset']);
  check('rebind applied', kb[0] === 'KeyK', JSON.stringify(kb));
  // conflict: bind camera.reset secondary to KeyW (camera.forward)
  await page.click('.mn-kb-row[data-action="camera.reset"] .mn-kslot:nth-of-type(2)');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(300);
  check('conflict panel', await page.evaluate(() => !!document.querySelector('.mn-kb-row[data-action="camera.reset"] .mn-kb-conflict:not([hidden])')));
  await page.click('.mn-kb-row[data-action="camera.reset"] .mn-kb-conflict .mn-btn.primary');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [window.__game.settings.value.controls.keybinds['camera.reset'], window.__game.settings.value.controls.keybinds['camera.forward']]);
  check('swap moved key', after[0].includes('KeyW') && !after[1].includes('KeyW'), JSON.stringify(after));
  // escape during capture cancels without closing options
  await page.click('.mn-kb-row[data-action="camera.fast"] .mn-kslot');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('escape cancels capture only', (await top()) === 'options' && await page.evaluate(() => !document.querySelector('.mn-kslot.capturing')));
  // graphics: preset → custom
  await page.click('.mn-opt-tab:nth-child(1)');
  await page.waitForTimeout(300);
  await page.click('.mn-preset .mn-seg-btn:nth-of-type(1)');
  await page.waitForTimeout(200);
  let g = await page.evaluate(() => ({ p: window.__game.settings.value.graphics.preset, s: window.__game.settings.value.graphics.shadows }));
  check('preset low applied', g.p === 'low' && g.s === 'off', JSON.stringify(g));
  await page.evaluate(() => window.__game.settings.set({ graphics: { bloom: true } }));
  g = await page.evaluate(() => window.__game.settings.value.graphics.preset);
  check('individual change → custom', g === 'custom', g);
  const customShown = await page.evaluate(() => document.querySelector('.mn-custom-tag')?.classList.contains('show'));
  check('custom tag shown', !!customShown);
  await page.screenshot({ path: out + '/flow-options.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('escape back to pause', (await top()) === 'pause');

  // save
  await page.click('.mn-pi:nth-child(2)');
  await page.waitForTimeout(700);
  check('save dialog', (await top()) === 'save');
  await page.fill('.mn-savedlg .mn-input', 'My test save');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('saved and closed', (await top()) === 'pause' && await page.evaluate(() => document.querySelector('.mn-toast')?.textContent?.includes('My test save')));

  // quit
  await page.click('.mn-pi.danger');
  await page.waitForTimeout(1200);
  check('quit confirm', (await top()) === 'confirm');
  { const f = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)); check('danger confirm focuses Cancel', f?.includes('Cancel'), f); }
  await page.click('.mn-confirm .mn-btn.danger');
  await page.waitForTimeout(800);
  check('back at main menu', (await top()) === 'main' && await page.evaluate(() => !window.__game.world));
  await page.screenshot({ path: out + '/flow-end.png' });

  await browser.close();
  const fails = results.filter((r) => !r.startsWith('PASS')).length;
  console.log(fails ? `${fails} problem(s)` : 'all passed');
})();
