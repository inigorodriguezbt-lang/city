// How to Play cheat sheet, Credits and Photo tips dialogs.
import { h } from '../dom';
import type { ActionId } from '../../settings/types';
import type { MenuCtx } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { comboParts } from './format';
import { btn, dialog, kbd } from './widgets';
import { URBIS_VERSION } from './mainMenu';

function keysFor(ctx: MenuCtx, a: ActionId): HTMLElement {
  const list = ctx.game.settings.value.controls.keybinds[a] ?? [];
  if (!list.length) return h('span', { class: 'mn-unbound' }, 'unbound');
  return h('span', { class: 'mn-keys' }, ...list.slice(0, 2).map((k, i) =>
    h('span', { class: 'mn-kcombo' + (i ? ' alt' : '') }, ...comboParts(k).map((p) => kbd(p)))));
}

function keyRow(ctx: MenuCtx, a: ActionId, label: string): HTMLElement {
  return h('div', { class: 'mn-kv' }, h('span', { class: 'mn-kv-label' }, label), keysFor(ctx, a));
}

function literalRow(label: string, ...keys: string[][]): HTMLElement {
  return h('div', { class: 'mn-kv' }, h('span', { class: 'mn-kv-label' }, label),
    h('span', { class: 'mn-keys' }, ...keys.map((combo, i) => h('span', { class: 'mn-kcombo' + (i ? ' alt' : '') }, ...combo.map((p) => kbd(p))))));
}

function mouseRow(icon: MenuIcon, gesture: string, label: string): HTMLElement {
  return h('div', { class: 'mn-kv' }, h('span', { class: 'mn-kv-label' }, label), h('span', { class: 'mn-gesture' }, mIcon(icon, 14), gesture));
}

// ═════════════════════════════════════════════════════════════════════════

export function openHelpDialog(ctx: MenuCtx): void {
  const steps: { icon: MenuIcon; title: string; text: string; key?: ActionId }[] = [
    { icon: 'road', title: 'Connect to the highway', text: 'Open Roads and drag a street from the highway exit into your valley. Everything starts with access.', key: 'tool.roads' },
    { icon: 'grid', title: 'Zone some land', text: 'Paint residential, commercial and industrial zones next to roads. Buildings grow on their own.', key: 'tool.zoning' },
    { icon: 'zap', title: 'Power & water', text: 'Place a power plant and a water pump by the shore. Utilities travel along your roads.', key: 'tool.services' },
    { icon: 'gauge', title: 'Read the demand', text: 'The RCIO bars in the top bar show what citizens want next. Zone accordingly.' },
    { icon: 'heart', title: 'Keep citizens happy', text: 'Add health, fire, police, schools, parks and garbage collection as the population grows.' },
    { icon: 'coin', title: 'Balance the budget', text: 'Tune taxes and service budgets. Loans help early, but interest adds up.', key: 'ui.budget' },
  ];
  const stepsEl = h('ol', { class: 'mn-steps' }, ...steps.map((s, i) =>
    h('li', { class: 'mn-step', style: `--d:${i}` },
      h('span', { class: 'mn-step-num' }, String(i + 1)),
      h('span', { class: 'mn-step-ico' }, mIcon(s.icon, 18)),
      h('div', { class: 'mn-step-txt' },
        h('b', null, s.title, s.key && ctx.key(s.key) ? kbd(ctx.key(s.key), 'mn-step-key') : null),
        h('span', null, s.text)))));

  const mouse = h('div', { class: 'mn-cheat' },
    h('h4', null, mIcon('mouse', 15), 'Mouse'),
    mouseRow('mouse', 'Left click / drag', 'Build, zone, select'),
    mouseRow('mouse', 'Right drag', 'Rotate & tilt camera'),
    mouseRow('mouse', 'Middle drag', 'Pan camera'),
    mouseRow('mouse', 'Wheel', 'Zoom in / out'),
    mouseRow('mouse', 'Right click', 'Cancel current tool'),
    h('h4', null, mIcon('hand', 15), 'Touch'),
    mouseRow('hand', 'One finger', 'Use the current tool'),
    mouseRow('hand', 'Two-finger drag', 'Pan the camera'),
    mouseRow('hand', 'Pinch / twist', 'Zoom & rotate'),
    mouseRow('hand', 'Two fingers up/down', 'Tilt the camera'));

  const keys = h('div', { class: 'mn-cheat' },
    h('h4', null, mIcon('keyboard', 15), 'Keyboard'),
    literalRow('Move camera', ...[
      (ctx.game.settings.value.controls.keybinds['camera.forward'] ?? []).slice(0, 1),
      (ctx.game.settings.value.controls.keybinds['camera.left'] ?? []).slice(0, 1),
      (ctx.game.settings.value.controls.keybinds['camera.back'] ?? []).slice(0, 1),
      (ctx.game.settings.value.controls.keybinds['camera.right'] ?? []).slice(0, 1),
    ].filter((x) => x.length).map((x) => comboParts(x[0]))),
    keyRow(ctx, 'camera.rotateLeft', 'Rotate left'),
    keyRow(ctx, 'camera.rotateRight', 'Rotate right'),
    keyRow(ctx, 'game.pause', 'Pause / resume'),
    literalRow('Game speed', ...(['game.speed1', 'game.speed2', 'game.speed3', 'game.speed4'] as ActionId[])
      .map((a) => ctx.game.settings.value.controls.keybinds[a]?.[0]).filter((k): k is string => !!k).map((k) => comboParts(k))),
    keyRow(ctx, 'edit.undo', 'Undo'),
    keyRow(ctx, 'edit.redo', 'Redo'),
    keyRow(ctx, 'tool.rotate', 'Rotate building'),
    keyRow(ctx, 'tool.bulldoze', 'Bulldozer'),
    keyRow(ctx, 'tool.eyedropper', 'Pick building'),
    keyRow(ctx, 'ui.overlays', 'Info views'),
    keyRow(ctx, 'ui.search', 'Search buildings'),
    keyRow(ctx, 'ui.chat', 'Command chat'),
    keyRow(ctx, 'game.quicksave', 'Quick save'),
    keyRow(ctx, 'ui.toggleHud', 'Hide interface'),
    literalRow('Menu / cancel', ['Esc']));

  const tips = [
    'Hold Shift while dragging roads for straight lines; Ctrl finds a path automatically.',
    'Zones need a road within four cells. Deeper lots grow bigger buildings.',
    'Keep heavy industry downwind and away from homes — pollution lowers land value.',
    'Parks, water views and services raise land value, which lets buildings level up.',
    'Use the info views to diagnose power, water, traffic, crime and pollution problems.',
    'Education unlocks offices and high-tech industry, so build schools early.',
    'Type /help in the chat for commands like /time, /weather and /locate.',
  ];

  const footer = [
    btn(ctx, 'Key bindings', { icon: 'keyboard', kind: 'ghost', onClick: () => { d.close(); ctx.nav.options('controls'); } }),
    h('span', { class: 'mn-grow' }),
    btn(ctx, 'Got it', { icon: 'check', kind: 'primary', onClick: () => d.close() }),
  ];
  const d = dialog(ctx, {
    id: 'help',
    title: 'How to Play',
    subtitle: 'Everything you need for your first city — and a few tricks for your tenth.',
    icon: 'help',
    width: 1060,
    cls: 'mn-help',
    body: h('div', { class: 'mn-help-grid' },
      h('section', { class: 'mn-help-col' }, h('h3', { class: 'mn-sec-title' }, 'First steps'), stepsEl,
        h('h3', { class: 'mn-sec-title' }, 'Tips'),
        h('ul', { class: 'mn-tips' }, ...tips.map((t) => h('li', null, mIcon('sparkle', 13), h('span', null, t))))),
      h('section', { class: 'mn-help-col' }, h('h3', { class: 'mn-sec-title' }, 'Controls'), h('div', { class: 'mn-cheats' }, keys, mouse))),
    footer,
  });
  ctx.sfx('open', 0.7);
  ctx.push(d);
}

// ═════════════════════════════════════════════════════════════════════════

export function openCreditsDialog(ctx: MenuCtx): void {
  const block = (title: string, ...lines: (string | [string, string])[]) =>
    h('div', { class: 'mn-cred' }, h('h4', null, title), ...lines.map((l) =>
      Array.isArray(l) ? h('div', { class: 'mn-cred-line' }, h('b', null, l[0]), h('span', null, l[1])) : h('div', { class: 'mn-cred-line' }, h('span', null, l))));
  const d = dialog(ctx, {
    id: 'credits',
    title: 'Credits',
    icon: 'heart',
    width: 640,
    cls: 'mn-credits',
    body: [
      h('div', { class: 'mn-cred-hero' },
        h('div', { class: 'mn-logo small', 'aria-label': 'URBIS' }, ...'URBIS'.split('').map((c, i) => h('span', { style: `--i:${i}` }, c))),
        h('div', { class: 'mn-cred-tag' }, `Version ${URBIS_VERSION} · A procedural city builder for the web`)),
      h('div', { class: 'mn-cred-grid' },
        block('Created by', ['Design & code', 'The URBIS team'], ['Simulation', 'Agent-based traffic, field-driven growth'], ['World', 'Procedural terrain, rivers & coastlines']),
        block('Built with', ['Three.js', 'WebGL 2 rendering'], ['TypeScript', 'Every line of it'], ['Vite', 'Build tooling'], ['Web Workers', 'Pathfinding & fields']),
        block('Typefaces', ['Inter', 'Rasmus Andersson'], ['Outfit', 'Rodrigo Fuenzalida'], ['JetBrains Mono', 'JetBrains']),
        block('Art & sound', 'Every building, tree and texture is generated at runtime.', 'Every sound is synthesized live with WebAudio.', 'No downloaded assets — the whole city fits in one file.')),
      h('div', { class: 'mn-cred-thanks' }, mIcon('heart', 14), h('span', null, 'Thank you to every mayor who ever untangled a traffic jam at 3 am.')),
    ],
    footer: [h('span', { class: 'mn-grow' }), btn(ctx, 'Close', { kind: 'primary', onClick: () => d.close() })],
  });
  ctx.sfx('open', 0.7);
  ctx.push(d);
}

// ═════════════════════════════════════════════════════════════════════════

export function openPhotoTipsDialog(ctx: MenuCtx): void {
  const tip = (icon: MenuIcon, title: string, text: string, key?: HTMLElement | null) =>
    h('div', { class: 'mn-photo-tip' },
      h('span', { class: 'mn-photo-ico' }, mIcon(icon, 18)),
      h('div', { class: 'mn-photo-txt' }, h('b', null, title, key ?? null), h('span', null, text)));
  const cmd = (s: string) => h('code', { class: 'mn-cmd' }, s);
  const d = dialog(ctx, {
    id: 'photo',
    title: 'Photo Tips',
    subtitle: 'Make your city look its absolute best.',
    icon: 'camera',
    width: 720,
    cls: 'mn-photo',
    body: h('div', { class: 'mn-photo-grid' },
      tip('camera', 'Photo mode', 'Hides the interface and gives you free camera controls with depth of field.', keysFor(ctx, 'ui.photoMode')),
      tip('image', 'Screenshot', 'Saves a full-resolution JPEG of the current view.', keysFor(ctx, 'ui.screenshot')),
      tip('eye', 'Hide the interface', 'Toggle every panel off for a clean frame.', keysFor(ctx, 'ui.toggleHud')),
      tip('sun', 'Golden hour', 'Long shadows and warm light make everything glow.', h('span', { class: 'mn-keys' }, cmd('/time set dusk'))),
      tip('sparkle', 'Night skyline', 'Windows, street lights and neon come alive after dark — bloom makes them sparkle.', h('span', { class: 'mn-keys' }, cmd('/time set night'))),
      tip('droplet', 'Moody weather', 'Rain, fog and snow add atmosphere and reflections.', h('span', { class: 'mn-keys' }, cmd('/weather fog'))),
      tip('layout', 'Tilt-shift miniature', 'Enable Tilt-shift under Options → Graphics and zoom in close.'),
      tip('compass', 'Low angles', 'Tilt the camera toward the horizon and lower the field of view for dramatic telephoto shots.', keysFor(ctx, 'camera.tiltDown'))),
    footer: [
      btn(ctx, 'Graphics options', { icon: 'monitor', kind: 'ghost', onClick: () => { d.close(); ctx.nav.options('graphics'); } }),
      h('span', { class: 'mn-grow' }),
      btn(ctx, 'Close', { kind: 'primary', onClick: () => d.close() }),
    ],
  });
  ctx.sfx('open', 0.7);
  ctx.push(d);
}
