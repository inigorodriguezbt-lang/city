// eval-file for scripts/shot.cjs against the real game (/?autostart=1&size=small&seed=42):
// spawns a block of zoned buildings near home, sets the hour and poses the camera.
// window.__bzHour / __bzState may be set via a prefix eval.
let g = window.__game;
for (let i = 0; i < 240 && !(g && g.world); i++) { await new Promise((r) => setTimeout(r, 500)); g = window.__game; }
if (!g || !g.world) return 'no world';
const w = g.world;
const hour = window.__bzHour ?? 15;
w.time.hour = hour;
w.time.speed = 0;
const zones = [
  ['res_low', 1, 1, 2], ['res_low', 2, 1, 2], ['res_med', 2, 2, 2], ['res_med', 3, 2, 3], ['res_high', 3, 2, 3], ['res_high', 5, 3, 3],
  ['com_low', 2, 1, 2], ['com_high', 4, 2, 3], ['office', 4, 2, 3], ['office', 5, 3, 3], ['mixed', 3, 2, 2], ['industry', 3, 3, 3],
];
const zmap = { res_low: 1, res_med: 2, res_high: 3, com_low: 4, com_high: 5, office: 6, industry: 7, farming: 8, forestry: 9, mining: 10, oil: 11, mixed: 12 };
const hx = w.home.x, hy = w.home.y;
let x = hx - 20, y = hy - 6, rowH = 0, n = 0;
const styles = ['american', 'european', 'mediterranean', 'nordic', 'asian', 'artdeco', 'modern', 'futuristic'];
const style = window.__bzStyle ?? 'european';
for (let rep = 0; rep < 2; rep++)
  for (const [zid, level, fw, fd] of zones) {
    if (x + fw > hx + 22) { x = hx - 20; y += rowH + 1; rowH = 0; }
    try {
      w.addBuilding({ kind: 'zoned', defId: 'zoned:' + zid, x, y, w: fw, h: fd, rot: 2, zone: zmap[zid], level, style: rep ? styles[(n * 3) % 8] : style, seed: 1000 + n * 7919, built: 1, residents: 5, maxResidents: 10, jobs: 10, workers: 8, flags: 1 | 2 | 4 | 8 });
    } catch (e) { return 'add failed ' + e.message; }
    n++;
    x += fw + 1;
    rowH = Math.max(rowH, fd);
  }
g.renderer.cameraCtl.setPose(hx, hy + 2, window.__bzDist ?? 520, window.__bzYaw ?? 0.6, window.__bzPitch ?? 0.75);
await new Promise((r) => setTimeout(r, window.__bzWait ?? 15000));
return JSON.stringify(g.buildings.stats());
