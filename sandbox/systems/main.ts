// URBIS · Systems Lab — runs the save/command/audio test suites and offers a
// sound board, an ambience/music mixer and a live command console.
import '../../src/ui/theme.css';
import { h } from '../../src/ui/dom';
import { SFX_IDS, type SfxId } from '../../src/audio/AudioManager';
import type { AmbienceScene } from '../../src/audio/ambience';
import type { ChatKind } from '../../src/ui/chat/ChatConsole';
import type { Season, WeatherType } from '../../src/core/types';
import { daylight } from '../../src/core/time';
import { FakeGame } from './fakeGame';
import { Reporter, randomWorld, renderMusic, testAudio, testCommands, testSaves, testSerialization, type SfxRender, type TestResult } from './tests';

const SFX_META: Record<SfxId, { icon: string; label: string }> = {
  click: { icon: '🖱️', label: 'Click' }, hover: { icon: '✨', label: 'Hover' }, open: { icon: '📂', label: 'Open' }, close: { icon: '📁', label: 'Close' },
  place: { icon: '🏗️', label: 'Place' }, road: { icon: '🛣️', label: 'Road' }, zone: { icon: '🖌️', label: 'Zone' }, bulldoze: { icon: '🚜', label: 'Bulldoze' },
  error: { icon: '⛔', label: 'Error' }, money: { icon: '💰', label: 'Money' }, milestone: { icon: '🏆', label: 'Milestone' }, achievement: { icon: '🎖️', label: 'Achievement' },
  notice: { icon: '🔔', label: 'Notice' }, warning: { icon: '⚠️', label: 'Warning' }, disaster: { icon: '🌋', label: 'Disaster' }, siren: { icon: '🚨', label: 'Siren' },
  thunder: { icon: '⛈️', label: 'Thunder' }, explosion: { icon: '💥', label: 'Explosion' }, chirp: { icon: '🐦', label: 'Chirp' }, levelup: { icon: '⬆️', label: 'Level up' },
};

const CSS = `
html, body { height: auto; min-height: 100%; overflow: auto; user-select: text; -webkit-user-select: text; touch-action: auto; }
body { background: radial-gradient(1200px 700px at 12% -10%, #1b2c4a 0%, transparent 60%), radial-gradient(900px 600px at 110% 10%, #2a1f47 0%, transparent 55%), var(--bg-0); min-height: 100%; }
.lab { zoom: var(--ui-scale); max-width: 1480px; margin: 0 auto; padding: 20px 22px 40px; display: flex; flex-direction: column; gap: 16px; }
.lab-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
.lab-logo { font-family: var(--font-display); font-weight: 800; font-size: 22px; letter-spacing: .14em; background: linear-gradient(90deg, #7fd8ff, #b9a2ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lab-sub { color: var(--text-dim); font-size: 13px; }
.lab-pills { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--glass-light); border: 1px solid var(--stroke); color: var(--text-dim); white-space: nowrap; }
.pill.ok { color: var(--good); border-color: rgba(61,220,132,.35); background: rgba(61,220,132,.08); }
.pill.bad { color: var(--bad); border-color: rgba(255,93,93,.4); background: rgba(255,93,93,.08); }
.pill.run::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1s infinite var(--ease); }
@keyframes pulse { 50% { opacity: .25; transform: scale(.7); } }
.lab-grid { display: grid; grid-template-columns: minmax(340px, 0.9fr) minmax(420px, 1.35fr); gap: 16px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.card { padding: 16px 18px 18px; animation: rise .5s var(--ease) both; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
.card-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0 0 12px; font-family: var(--font-display); font-weight: 700; font-size: 16px; letter-spacing: .02em; }
.card-title small { color: var(--text-faint); font-family: var(--font); font-weight: 500; font-size: 12px; }
.card-title .kbd-hint { margin-left: auto; }
.kbd { font-family: var(--font-mono); font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--stroke-strong); color: var(--text-dim); background: rgba(255,255,255,.04); }
.suite { margin-top: 6px; }
.suite-h { display: flex; align-items: center; gap: 8px; padding: 8px 2px 6px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--text-faint); border-bottom: 1px solid var(--stroke); }
.suite-h .count { margin-left: auto; font-family: var(--font-mono); letter-spacing: 0; }
.suite-h .count.ok { color: var(--good); } .suite-h .count.bad { color: var(--bad); }
.test { display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 5px 2px; font-size: 12.5px; line-height: 1.35; border-bottom: 1px solid rgba(255,255,255,.03); animation: fade .3s var(--ease) both; }
@keyframes fade { from { opacity: 0; } }
.test .mark { font-weight: 800; text-align: center; }
.test.ok .mark { color: var(--good); } .test.bad .mark { color: var(--bad); }
.test .detail { grid-column: 2; color: var(--bad); font-family: var(--font-mono); font-size: 11px; word-break: break-word; }
.sfx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.sfx { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 8px; border-radius: var(--radius-sm); border: 1px solid var(--stroke); background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015)); color: var(--text); cursor: pointer; text-align: left; font: inherit; transition: transform .18s var(--ease), border-color .18s, background .18s, box-shadow .18s; }
.sfx:hover { transform: translateY(-2px); border-color: rgba(76,194,255,.45); box-shadow: 0 8px 22px rgba(0,0,0,.35), 0 0 0 1px rgba(76,194,255,.15) inset; }
.sfx:active { transform: translateY(0) scale(.98); }
.sfx.playing { border-color: var(--accent); background: linear-gradient(180deg, rgba(76,194,255,.16), rgba(76,194,255,.04)); }
.sfx-top { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
.sfx-top .ico { font-size: 16px; }
.sfx-top .kbd { margin-left: auto; }
.sfx canvas { width: 100%; height: 34px; display: block; border-radius: 4px; background: rgba(0,0,0,.25); }
.sfx-meta { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
.mix { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.ctl { display: flex; flex-direction: column; gap: 6px; }
.ctl label { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-dim); }
.ctl label b { color: var(--text); font-weight: 600; font-family: var(--font-mono); font-size: 11.5px; }
input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; }
input[type=range]::-webkit-slider-runnable-track { height: 5px; border-radius: 3px; background: linear-gradient(90deg, var(--accent) var(--p, 50%), rgba(255,255,255,.1) var(--p, 50%)); }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -5px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 4px rgba(76,194,255,.25), 0 2px 6px rgba(0,0,0,.5); transition: transform .15s var(--ease); }
input[type=range]:hover::-webkit-slider-thumb { transform: scale(1.15); }
.seg { display: flex; padding: 3px; gap: 3px; border-radius: 10px; background: rgba(0,0,0,.25); border: 1px solid var(--stroke); flex-wrap: wrap; }
.seg button { flex: 1; min-width: 52px; padding: 6px 8px; border: 0; border-radius: 7px; background: transparent; color: var(--text-dim); font: 600 12px var(--font); cursor: pointer; transition: background .15s, color .15s; }
.seg button:hover { color: var(--text); background: rgba(255,255,255,.05); }
.seg button.on { background: linear-gradient(180deg, rgba(76,194,255,.35), rgba(76,194,255,.18)); color: #fff; box-shadow: 0 0 0 1px rgba(76,194,255,.45) inset; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.big-btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(76,194,255,.45); background: linear-gradient(180deg, rgba(76,194,255,.28), rgba(76,194,255,.12)); color: #fff; font: 600 13px var(--font); cursor: pointer; transition: transform .15s var(--ease), box-shadow .15s; }
.big-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(76,194,255,.25); }
.big-btn.ghost { border-color: var(--stroke-strong); background: rgba(255,255,255,.05); }
.meters { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 14px; }
.meter { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .08em; }
.meter .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,.07); overflow: hidden; }
.meter .bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, #3ddc84, #4cc2ff); transition: width .12s linear; }
.music-wave { width: 100%; height: 46px; margin-top: 12px; border-radius: 6px; background: rgba(0,0,0,.25); display: block; }
.console { display: flex; flex-direction: column; height: 330px; border-radius: var(--radius-sm); background: rgba(5,8,13,.72); border: 1px solid var(--stroke); overflow: hidden; }
.console-log { flex: 1; overflow-y: auto; padding: 10px 12px; font: 12px/1.55 var(--font-mono); white-space: pre-wrap; }
.console-log .l-info { color: var(--text); } .console-log .l-ok { color: var(--good); } .console-log .l-warn { color: var(--warn); }
.console-log .l-error { color: var(--bad); } .console-log .l-system { color: var(--accent); } .console-log .l-input { color: var(--text-faint); }
.console-in { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--stroke); background: rgba(255,255,255,.03); }
.console-in span { color: var(--accent); font: 700 13px var(--font-mono); }
.console-in input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--text); font: 13px var(--font-mono); }
.console-sugg { display: flex; gap: 6px; padding: 6px 10px 0; flex-wrap: wrap; min-height: 26px; }
.console-sugg .kbd { cursor: pointer; }
.toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 50; pointer-events: none; }
.toast { padding: 10px 14px; font-size: 13px; max-width: 380px; animation: rise .35s var(--ease) both; border-left: 3px solid var(--accent); }
.toast.good { border-left-color: var(--good); } .toast.warning { border-left-color: var(--warn); } .toast.danger { border-left-color: var(--bad); }
.hint { color: var(--text-faint); font-size: 12px; margin-top: 10px; }
@media (max-width: 980px) { .lab-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .lab { padding: 10px; } .mix { grid-template-columns: 1fr; } .meters { grid-template-columns: repeat(3, 1fr); } .lab-head { flex-wrap: wrap; } .lab-pills { margin-left: 0; } .sfx-grid { grid-template-columns: repeat(2, 1fr); } }
`;

const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

const app = document.getElementById('app')!;
app.style.position = 'static';
const uiRoot = h('div', { class: 'lab' });
app.appendChild(uiRoot);
const game = new FakeGame(uiRoot);
game.audio.init();
game.audio.uiSounds = true;
game.commands.init();

// ── header ──────────────────────────────────────────────────────────────────
const pillRun = h('span', { class: 'pill run' }, 'Running tests…');
const pillPass = h('span', { class: 'pill ok' }, '0 passed');
const pillFail = h('span', { class: 'pill' }, '0 failed');
const pillStore = h('span', { class: 'pill' }, 'storage: …');
const pillAudio = h('span', { class: 'pill' }, '🔇 audio locked — click anywhere');
uiRoot.appendChild(h('header', { class: 'glass lab-head' },
  h('div', null, h('div', { class: 'lab-logo' }, 'URBIS'), h('div', { class: 'lab-sub' }, 'Systems Lab · saves · commands · audio')),
  h('div', { class: 'lab-pills' }, pillRun, pillPass, pillFail, pillStore, pillAudio)));

const grid = h('div', { class: 'lab-grid' });
uiRoot.appendChild(grid);
const left = h('div', { class: 'col' });
const right = h('div', { class: 'col' });
grid.append(left, right);

// ── test results ────────────────────────────────────────────────────────────
const suitesEl = h('div');
const testsCard = h('section', { class: 'glass card' }, h('h2', { class: 'card-title' }, 'Test suites', h('small', null, 'round-trip · IndexedDB · commands · DSP')), suitesEl);
left.appendChild(testsCard);
const suiteEls = new Map<string, { list: HTMLElement; count: HTMLElement; pass: number; fail: number }>();
let passed = 0, failed = 0;
function addResult(r: TestResult): void {
  let s = suiteEls.get(r.group);
  if (!s) {
    const count = h('span', { class: 'count' }, '');
    const list = h('div');
    suitesEl.appendChild(h('div', { class: 'suite' }, h('div', { class: 'suite-h' }, r.group, count), list));
    s = { list, count, pass: 0, fail: 0 };
    suiteEls.set(r.group, s);
  }
  if (r.ok) { s.pass++; passed++; } else { s.fail++; failed++; }
  s.count.textContent = `${s.pass}/${s.pass + s.fail}`;
  s.count.className = `count ${s.fail ? 'bad' : 'ok'}`;
  s.list.appendChild(h('div', { class: `test ${r.ok ? 'ok' : 'bad'}` }, h('span', { class: 'mark' }, r.ok ? '✓' : '✗'), h('span', null, r.name), ...(r.detail ? [h('span', { class: 'detail' }, r.detail)] : [])));
  pillPass.textContent = `${passed} passed`;
  pillFail.textContent = `${failed} failed`;
  pillFail.className = `pill ${failed ? 'bad' : ''}`;
}

// ── console ─────────────────────────────────────────────────────────────────
const logEl = h('div', { class: 'console-log' });
const input = h('input', { type: 'text', placeholder: 'Type a command — try /help, /give money 50k, /locate abandoned', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
const sugg = h('div', { class: 'console-sugg' });
const consoleCard = h('section', { class: 'glass card' },
  h('h2', { class: 'card-title' }, 'Command console', h('small', null, 'real CommandRegistry on a fake game'), h('span', { class: 'kbd-hint' }, h('span', { class: 'kbd' }, 'Tab'), ' ', h('span', { class: 'kbd' }, '↑ ↓'))),
  h('div', { class: 'console' }, logEl, sugg, h('div', { class: 'console-in' }, h('span', null, '›'), input)));
let echo = true;
game.onChat = (text: string, kind: ChatKind) => {
  if (!echo) return;
  logEl.appendChild(h('div', { class: `l-${kind}` }, text));
  while (logEl.childElementCount > 400) logEl.firstElementChild?.remove();
  logEl.scrollTop = logEl.scrollHeight;
};
const toastsEl = h('div', { class: 'toasts' });
document.body.appendChild(toastsEl);
game.onToast = (text, kind) => {
  const t = h('div', { class: `glass toast ${kind}` }, text);
  toastsEl.appendChild(t);
  setTimeout(() => t.remove(), 3200);
};
let histIdx = -1;
let cycle: { base: string; list: string[]; i: number } | null = null;
function showSuggestions(): void {
  sugg.replaceChildren();
  const line = input.value;
  if (!line) return;
  for (const c of game.commands.complete(line).slice(0, 8)) {
    const chip = h('span', { class: 'kbd', 'data-sfx': 'none' }, c);
    chip.addEventListener('click', () => { input.value = c + ' '; input.focus(); showSuggestions(); });
    sugg.appendChild(chip);
  }
}
input.addEventListener('input', () => { cycle = null; histIdx = -1; showSuggestions(); });
input.addEventListener('keydown', async (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!cycle) cycle = { base: input.value, list: game.commands.complete(input.value), i: -1 };
    if (!cycle.list.length) return;
    cycle.i = (cycle.i + (e.shiftKey ? -1 : 1) + cycle.list.length) % cycle.list.length;
    input.value = cycle.list[cycle.i];
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const hist = game.commands.history;
    if (!hist.length) return;
    histIdx = histIdx < 0 ? hist.length : histIdx;
    histIdx = Math.max(0, Math.min(hist.length, histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
    input.value = hist[histIdx] ?? '';
  } else if (e.key === 'Enter') {
    const line = input.value.trim();
    input.value = '';
    cycle = null;
    histIdx = -1;
    sugg.replaceChildren();
    if (!line) return;
    game.chat.print(line, 'input');
    await game.commands.execute(line);
  } else cycle = null;
});

// ── sound board ─────────────────────────────────────────────────────────────
const sfxCanvas = new Map<SfxId, { canvas: HTMLCanvasElement; meta: HTMLElement; card: HTMLElement }>();
const board = h('div', { class: 'sfx-grid' });
SFX_IDS.forEach((id, i) => {
  const canvas = h('canvas', { width: '280', height: '68' }) as HTMLCanvasElement;
  const meta = h('div', { class: 'sfx-meta' }, h('span', null, '—'), h('span', null, ''));
  const key = i < 10 ? String((i + 1) % 10) : '';
  const card = h('button', { class: 'sfx', 'data-sfx': 'none', title: `Play “${id}”` },
    h('div', { class: 'sfx-top' }, h('span', { class: 'ico' }, SFX_META[id].icon), SFX_META[id].label, ...(key ? [h('span', { class: 'kbd' }, key)] : [])), canvas, meta);
  card.addEventListener('click', () => trigger(id));
  board.appendChild(card);
  sfxCanvas.set(id, { canvas, meta, card });
});
function trigger(id: SfxId): void {
  game.audio.unlock();
  game.audio.play(id);
  const c = sfxCanvas.get(id)!.card;
  c.classList.add('playing');
  setTimeout(() => c.classList.remove('playing'), 450);
}
window.addEventListener('keydown', (e) => {
  if (document.activeElement === input) return;
  const n = '1234567890'.indexOf(e.key);
  if (n >= 0) trigger(SFX_IDS[n]);
});
right.appendChild(h('section', { class: 'glass card' },
  h('h2', { class: 'card-title' }, 'Sound board', h('small', null, '20 synthesized effects · waveforms from offline renders'), h('span', { class: 'kbd-hint' }, h('span', { class: 'kbd' }, '1–0'))), board));

function drawWave(canvas: HTMLCanvasElement, data: Float32Array, color = '#4cc2ff', seconds?: number, sr = 22050): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const len = seconds ? Math.min(data.length, Math.floor(seconds * sr)) : data.length;
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#b9a2ff');
  g.fillStyle = grad;
  let peak = 1e-6;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
  const k = (H / 2 - 2) / peak;
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * len), b = Math.max(a + 1, Math.floor(((x + 1) / W) * len));
    let mn = 0, mx = 0;
    for (let i = a; i < b; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    g.fillRect(x, H / 2 - mx * k, 1, Math.max(1, (mx - mn) * k));
  }
  g.fillStyle = 'rgba(255,255,255,.08)';
  g.fillRect(0, H / 2, W, 1);
}
function onRender(r: SfxRender): void {
  const e = sfxCanvas.get(r.id);
  if (!e) return;
  drawWave(e.canvas, r.data, '#4cc2ff', Math.min(5, r.duration + 0.15));
  const [a, b] = e.meta.children as unknown as HTMLElement[];
  a.textContent = `${(20 * Math.log10(r.peak)).toFixed(1)} dB`;
  b.textContent = `${r.duration.toFixed(2)} s`;
}

// ── ambience & music mixer ──────────────────────────────────────────────────
const scene: Partial<AmbienceScene> = { active: true, altitude: 300, hour: 10, season: 'spring', weather: 'clear', intensity: 0.7, windSpeed: 5, temperature: 21, vehicles: 800, population: 40000, water: 0.3, trees: 0.6, urban: 0.5, paused: false };
function applyScene(): void {
  scene.daylight = daylight(scene.hour ?? 12);
  game.audio.debugScene = { ...scene };
}
applyScene();
function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, on: (v: number) => void): HTMLElement {
  const out = h('b', null, fmt(value));
  const r = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  const paint = () => r.style.setProperty('--p', `${((Number(r.value) - min) / (max - min)) * 100}%`);
  paint();
  r.addEventListener('input', () => { const v = Number(r.value); out.textContent = fmt(v); paint(); on(v); });
  return h('div', { class: 'ctl' }, h('label', null, label, out), r);
}
function seg<T extends string>(opts: [T, string][], value: T, on: (v: T) => void): HTMLElement {
  const el = h('div', { class: 'seg' });
  for (const [v, label] of opts) {
    const b = h('button', { class: v === value ? 'on' : '', title: v }, label);
    b.addEventListener('click', () => { for (const c of el.children) c.classList.remove('on'); b.classList.add('on'); on(v); });
    el.appendChild(b);
  }
  return el;
}
const meterEls = new Map<string, HTMLElement>();
const meters = h('div', { class: 'meters' });
for (const k of ['wind', 'city', 'rain', 'waves', 'crickets']) {
  const i = h('i');
  meterEls.set(k, i);
  meters.appendChild(h('div', { class: 'meter' }, k, h('div', { class: 'bar' }, i)));
}
const musicCanvas = h('canvas', { class: 'music-wave', width: '900', height: '92' }) as HTMLCanvasElement;
const setVol = (k: 'master' | 'music' | 'ambience' | 'sfx', v: number) => game.settings.set({ audio: { [k]: v } });
const mixCard = h('section', { class: 'glass card' },
  h('h2', { class: 'card-title' }, 'Ambience & music', h('small', null, 'layers follow the scene in real time')),
  h('div', { class: 'row', style: 'margin-bottom:14px' },
    (() => { const b = h('button', { class: 'big-btn' }, '▶ Start audio'); b.addEventListener('click', () => { game.audio.unlock(); }); return b; })(),
    (() => { const b = h('button', { class: 'big-btn ghost' }, 'City on/off'); b.addEventListener('click', () => { scene.active = !scene.active; applyScene(); }); return b; })(),
    seg<'auto' | 'menu' | 'day' | 'night'>([['auto', 'Auto'], ['menu', 'Menu'], ['day', 'Day'], ['night', 'Night']], 'auto', (v) => { game.audio.forceMood = v === 'auto' ? null : v; })),
  h('div', { class: 'mix' },
    slider('Camera altitude', 40, 4000, 10, scene.altitude!, (v) => `${v} m`, (v) => { scene.altitude = v; applyScene(); }),
    slider('Time of day', 0, 24, 0.25, scene.hour!, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, (v) => { scene.hour = v; applyScene(); }),
    slider('Vehicles', 0, 5000, 10, scene.vehicles!, (v) => String(v), (v) => { scene.vehicles = v; applyScene(); }),
    slider('Water nearby', 0, 1, 0.01, scene.water!, (v) => `${Math.round(v * 100)}%`, (v) => { scene.water = v; applyScene(); }),
    slider('Trees nearby', 0, 1, 0.01, scene.trees!, (v) => `${Math.round(v * 100)}%`, (v) => { scene.trees = v; applyScene(); }),
    slider('Wind speed', 0, 25, 0.5, scene.windSpeed!, (v) => `${v} m/s`, (v) => { scene.windSpeed = v; applyScene(); }),
    h('div', { class: 'ctl' }, h('label', null, 'Weather'), seg<WeatherType>([['clear', '☀️'], ['cloudy', '☁️'], ['rain', '🌧️'], ['storm', '⛈️'], ['snow', '🌨️'], ['blizzard', '❄️']], 'clear', (v) => { scene.weather = v; applyScene(); })),
    h('div', { class: 'ctl' }, h('label', null, 'Season'), seg<Season>([['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']], 'spring', (v) => { scene.season = v; scene.temperature = { spring: 16, summer: 24, autumn: 12, winter: -2 }[v]; applyScene(); })),
    slider('Master', 0, 1, 0.01, game.settings.value.audio.master, (v) => `${Math.round(v * 100)}%`, (v) => setVol('master', v)),
    slider('Music', 0, 1, 0.01, game.settings.value.audio.music, (v) => `${Math.round(v * 100)}%`, (v) => setVol('music', v)),
    slider('Ambience', 0, 1, 0.01, game.settings.value.audio.ambience, (v) => `${Math.round(v * 100)}%`, (v) => setVol('ambience', v)),
    slider('Effects', 0, 1, 0.01, game.settings.value.audio.sfx, (v) => `${Math.round(v * 100)}%`, (v) => setVol('sfx', v))),
  meters,
  musicCanvas,
  h('div', { class: 'hint' }, 'The strip above is 30 s of the generative day score rendered offline. Menus muffle the world path; fanfares duck the music.'));
right.appendChild(mixCard);
right.appendChild(consoleCard);

// ── frame loop ──────────────────────────────────────────────────────────────
let lastT = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  game.audio.update(dt);
  game.saves.update(dt);
  const lv = game.audio.ambienceLevels();
  for (const [k, el] of meterEls) el.style.width = `${Math.min(100, (lv[k] ?? 0) * 260)}%`;
  if (game.audio.ready) {
    pillAudio.textContent = `🔊 audio live · ${game.audio.musicMood ?? ''}`;
    pillAudio.className = 'pill ok';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pointerdown', () => game.audio.unlock(), { once: false });

// ── run the suites ──────────────────────────────────────────────────────────
async function runAll(): Promise<void> {
  const rep = new Reporter();
  rep.onResult = addResult;
  const t0 = performance.now();
  await testSerialization(rep);
  echo = false;
  await testSaves(rep, game);
  pillStore.textContent = `storage: ${game.saves.storageKind}`;
  await testCommands(rep, game);
  echo = true;
  await testAudio(rep, onRender);
  const m = await renderMusic(30, 16000, 'day');
  drawWave(musicCanvas, m.data, '#3ddc84', undefined, 16000);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  pillRun.className = `pill ${failed ? 'bad' : 'ok'}`;
  pillRun.textContent = failed ? `✗ ${failed} failing` : `✓ all green · ${secs} s`;
  console.log(`SUMMARY: ${passed} passed, ${failed} failed in ${secs} s`);
  (window as unknown as { __systemsDone: unknown }).__systemsDone = { passed, failed, results: rep.results };
  // leave a friendly world in the console for manual play
  await game.attachWorld(randomWorld(8));
  game.chat.print('Welcome to the URBIS command console. Type /help — Tab completes, ↑/↓ browses history.', 'system');
  for (const line of ['/stats', '/locate abandoned', '/give money 25k', '/tp 99999 2']) {
    game.chat.print(line, 'input');
    await game.commands.execute(line);
  }
}
void runAll();
(window as unknown as { __lab: unknown }).__lab = game;
