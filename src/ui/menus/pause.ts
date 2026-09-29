// Pause menu (Esc in game): city summary card + Resume / Save / Load /
// Options / Export / Photo tips / Quit to Main Menu.
import { h } from '../dom';
import { formatMoney, formatNumber } from '../../core/util';
import { calendar, formatHour, MONTH_NAMES } from '../../core/time';
import { themeDef } from '../../data/themes';
import { MILESTONES } from '../../data/milestones';
import type { MenuCtx, MenuLayer } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { formatDuration } from './format';
import { countUp, kbd } from './widgets';
import { paintThemePreview } from './themePreview';

interface Item {
  icon: MenuIcon;
  label: string;
  key?: string;
  kind?: 'primary' | 'danger';
  run: () => void;
}

export function openPauseMenu(ctx: MenuCtx): void {
  const game = ctx.game;
  const world = game.world;
  if (!world) return;
  const s = game.settings.value;
  const cal = calendar(world.time.day);
  const theme = themeDef(world.settings.theme);
  const milestone = MILESTONES[Math.max(0, Math.min(MILESTONES.length - 1, world.milestone ?? 0))];

  const popEl = h('b', null, '0');
  const moneyEl = h('b', { class: world.economy.money < 0 ? 'bad' : 'money' }, '$0');
  const stat = (icon: MenuIcon, label: string, value: HTMLElement | string, sub?: string) =>
    h('div', { class: 'mn-pstat' },
      h('span', { class: 'mn-pstat-ico' }, mIcon(icon, 16)),
      h('span', { class: 'mn-pstat-txt' }, h('span', { class: 'mn-pstat-label' }, label), typeof value === 'string' ? h('b', null, value) : value, sub ? h('span', { class: 'mn-pstat-sub' }, sub) : null));

  const heroArt = h('canvas', { class: 'mn-pause-art', width: 520, height: 260 });
  requestAnimationFrame(() => paintThemePreview(heroArt, theme, 520, 260, (world.settings.seed % 97) + 3));
  const card = h('section', { class: 'mn-pause-card' },
    h('div', { class: 'mn-pause-hero', style: `--g1:${theme.waterDeep};--g2:${theme.grass};--g3:${theme.sand}` },
      heroArt,
      h('span', { class: 'mn-pause-kicker' }, mIcon('pause', 13), 'Paused'),
      h('h2', { class: 'mn-pause-city' }, world.settings.cityName),
      h('div', { class: 'mn-pause-sub' }, `${milestone?.name ?? 'Settlement'} · ${theme.name}${world.creative ? ' · Creative' : ''}`)),
    h('div', { class: 'mn-pstats' },
      stat('users', 'Population', popEl),
      stat('coin', 'Treasury', moneyEl),
      stat('calendar', 'Date', `${cal.dayOfMonth} ${MONTH_NAMES[cal.month]}`, `${cal.year} · ${formatHour(world.time.hour, s.ui.clock24h)}`),
      stat('clock', 'Play time', formatDuration(world.playTime))));

  const layerRef: { l: MenuLayer | null } = { l: null };
  const close = () => layerRef.l && ctx.pop(layerRef.l);
  const items: Item[] = [
    { icon: 'play', label: 'Resume', key: 'Esc', kind: 'primary', run: close },
    { icon: 'save', label: 'Save City', run: () => ctx.nav.save() },
    { icon: 'folder', label: 'Load City', run: () => ctx.nav.load() },
    { icon: 'sliders', label: 'Options', run: () => ctx.nav.options() },
    {
      icon: 'download', label: 'Export City', run: () => {
        void (async () => {
          try {
            await game.saves.exportCurrent();
            ctx.notify('City exported as a .urbis file.', 'good');
          } catch (err) {
            console.error('[menus] export failed', err);
            ctx.notify('Export failed.', 'bad');
          }
        })();
      },
    },
    { icon: 'camera', label: 'Photo Tips', run: () => ctx.nav.photoTips() },
    { icon: 'help', label: 'How to Play', run: () => ctx.nav.help() },
    {
      icon: 'exit', label: 'Quit to Main Menu', kind: 'danger', run: () => {
        void (async () => {
          const ok = await ctx.confirm('Quit to the main menu?', 'Any progress since your last save will be lost. Autosaves are kept.', { ok: 'Quit', danger: true, icon: 'exit' });
          if (ok) game.quitToMenu();
        })();
      },
    },
  ];

  const nav = h('nav', { class: 'mn-pause-nav', 'data-nav': 'v', 'aria-label': 'Pause menu' });
  items.forEach((it, i) => {
    const b = h('button', { class: 'mn-pi' + (it.kind ? ' ' + it.kind : ''), type: 'button', style: `--d:${i}` },
      h('span', { class: 'mn-pi-icon' }, mIcon(it.icon, 18)),
      h('span', { class: 'mn-pi-label' }, it.label),
      it.key ? kbd(it.key, 'mn-pi-key') : h('span', { class: 'mn-pi-go' }, mIcon('chevronRight', 16)));
    b.addEventListener('click', () => {
      ctx.sfx(it.kind === 'primary' ? 'close' : 'click');
      it.run();
    });
    b.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType !== 'touch') ctx.sfx('hover', 0.3);
    });
    if (i === 1 && ctx.key('game.quicksave')) ctx.tip(b, 'Save with a custom name. Quick save / load:', `${ctx.key('game.quicksave')} / ${ctx.key('game.quickload')}`);
    nav.append(b);
  });

  const el = h('div', { class: 'mn-layer mn-pause' },
    h('div', { class: 'mn-backdrop strong' }),
    h('div', { class: 'mn-pause-wrap' },
      card,
      h('div', { class: 'mn-pause-side glass' }, nav,
        h('div', { class: 'mn-pause-foot' }, mIcon('info', 13), h('span', null, 'Time stands still while this menu is open.')))));

  const layer: MenuLayer = {
    id: 'pause',
    el,
    focus: () => nav.querySelector<HTMLButtonElement>('.mn-pi')?.focus({ preventScroll: true }),
    onResume: () => {
      // money/population may change after a save/load round-trip
      const w = game.world;
      if (!w) return;
      popEl.textContent = formatNumber(w.stats.population);
      moneyEl.textContent = formatMoney(w.economy.money);
    },
  };
  layerRef.l = layer;
  el.firstElementChild!.addEventListener('pointerdown', () => {
    ctx.sfx('close', 0.8);
    ctx.pop(layer);
  });
  ctx.sfx('open', 0.8);
  ctx.push(layer);
  countUp(ctx, popEl, world.stats.population, (v) => formatNumber(v));
  countUp(ctx, moneyEl, world.economy.money, (v) => formatMoney(v));
}
