import './ui/theme.css';
import { Game } from './game/Game';
import type { MapSettings } from './core/types';

function fatal(msg: string): void {
  const el = document.getElementById('boot');
  if (el) el.innerHTML = `<div style="max-width:520px;text-align:center;letter-spacing:0"><b style="letter-spacing:.2em">URBIS</b>${msg}</div>`;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!hasWebGL2()) {
    fatal('Your browser does not support WebGL 2, which URBIS needs to render the city. Try a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  const game = new Game(document.getElementById('viewport')!, document.getElementById('ui')!);
  (window as unknown as { __game: Game }).__game = game;
  await game.init();
  document.getElementById('boot')?.remove();

  // ?autostart=1&size=small&seed=42&theme=temperate&creative=1 — skip the menu (dev/testing)
  const q = new URLSearchParams(location.search);
  if (q.get('autostart')) {
    const opts: Partial<MapSettings> = {};
    if (q.get('size')) opts.mapSize = q.get('size') as MapSettings['mapSize'];
    if (q.get('seed')) opts.seed = Number(q.get('seed'));
    if (q.get('theme')) opts.theme = q.get('theme') as MapSettings['theme'];
    if (q.get('creative')) opts.creative = q.get('creative') === '1';
    await game.newGame(opts);
  }
}

boot().catch((err) => {
  console.error(err);
  fatal('Something went wrong while starting: ' + String((err as Error)?.message ?? err));
});
