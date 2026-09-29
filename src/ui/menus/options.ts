// Options dialog: Graphics, Interface, Controls (incl. key rebinding), Audio
// and Gameplay tabs. Every control applies live through game.settings.set()
// and re-syncs from 'settings:changed' (presets, resets, other screens).
import { h } from '../dom';
import { CHUNK, CELL } from '../../core/constants';
import type { Settings } from '../../settings/types';
import type { DeepPartial, SettingsSection } from '../../settings/SettingsStore';
import type { MenuCtx } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { btn, dialog, row, section, segmented, slider, stepper, toggle, type SegOption } from './widgets';
import { buildKeybindTable, type KeybindTable } from './keybinds';

export type OptionsTab = 'graphics' | 'interface' | 'controls' | 'audio' | 'gameplay';

const TABS: { id: OptionsTab; label: string; desc: string; icon: MenuIcon }[] = [
  { id: 'graphics', label: 'Graphics', desc: 'Quality, effects & display', icon: 'monitor' },
  { id: 'interface', label: 'Interface', desc: 'GUI scale, clock & overlays', icon: 'layout' },
  { id: 'controls', label: 'Controls', desc: 'Keys, camera & mouse', icon: 'keyboard' },
  { id: 'audio', label: 'Audio', desc: 'Music, ambience & effects', icon: 'volume' },
  { id: 'gameplay', label: 'Gameplay', desc: 'Autosave, day cycle & rules', icon: 'flag' },
];

const TAB_KEY = 'urbis.options.tab';

type Sync = (s: Settings) => void;

export function openOptionsDialog(ctx: MenuCtx, initial?: OptionsTab): void {
  const store = ctx.game.settings;
  const set = (patch: DeepPartial<Settings>) => store.set(patch);
  const defaults = store.defaults();
  let tab: OptionsTab = initial ?? readTab();
  const syncs = new Map<OptionsTab, Sync[]>();
  const panes = new Map<OptionsTab, HTMLElement>();
  let keyTable: KeybindTable | null = null;

  // ── control builders (each registers a sync for the tab being built) ──
  let cur: Sync[] = [];
  const mark = (el: HTMLElement, isDefault: (s: Settings) => boolean) => cur.push((s) => el.classList.toggle('mod', !isDefault(s)));

  function tRow(label: string, desc: string | null, get: (s: Settings) => boolean, patch: (v: boolean) => DeepPartial<Settings>, icon?: MenuIcon): HTMLElement {
    const t = toggle(ctx, get(store.value), (v) => set(patch(v)), label);
    const r = row(label, desc, t);
    if (icon) r.prepend(h('span', { class: 'mn-row-ico' }, mIcon(icon, 17)));
    r.classList.add('clickable');
    r.addEventListener('click', (e) => {
      if (!t.contains(e.target as Node)) t.click();
    });
    cur.push((s) => t.set(get(s)));
    mark(r, (s) => get(s) === get(defaults));
    return r;
  }

  interface SliderRowOpts {
    min: number;
    max: number;
    step: number;
    fmt: (v: number) => string;
    /** apply continuously while dragging (otherwise on release) */
    live?: boolean;
    marks?: number[];
    icon?: MenuIcon;
    onCommit?: (v: number) => void;
  }
  function sRow(label: string, desc: string | null, get: (s: Settings) => number, patch: (v: number) => DeepPartial<Settings>, o: SliderRowOpts): HTMLElement {
    let raf = 0;
    let pending: number | null = null;
    const flush = () => {
      raf = 0;
      if (pending !== null) set(patch(pending));
      pending = null;
    };
    const sl = slider(ctx, {
      min: o.min, max: o.max, step: o.step, value: get(store.value), format: o.fmt, label, marks: o.marks,
      onInput: o.live
        ? (v) => {
          pending = v;
          if (!raf) raf = requestAnimationFrame(flush);
        }
        : undefined,
      onChange: (v) => {
        pending = null;
        set(patch(v));
        o.onCommit?.(v);
      },
    });
    const r = row(label, desc, sl, { cls: 'wide' });
    if (o.icon) r.prepend(h('span', { class: 'mn-row-ico' }, mIcon(o.icon, 17)));
    cur.push((s) => {
      if (document.activeElement !== sl.input) sl.set(get(s));
    });
    mark(r, (s) => Math.abs(get(s) - get(defaults)) < 1e-6);
    return r;
  }

  function gRow<T extends string | number>(label: string, desc: string | null, opts: SegOption<T>[], get: (s: Settings) => T, patch: (v: T) => DeepPartial<Settings>, icon?: MenuIcon): HTMLElement {
    const sg = segmented<T>(ctx, opts, get(store.value), (v) => set(patch(v)), label);
    const r = row(label, desc, sg, { cls: 'seg' });
    if (icon) r.prepend(h('span', { class: 'mn-row-ico' }, mIcon(icon, 17)));
    cur.push((s) => sg.set(get(s)));
    mark(r, (s) => get(s) === get(defaults));
    return r;
  }

  function pRow<T extends string | number>(label: string, desc: string | null, opts: SegOption<T>[], get: (s: Settings) => T, patch: (v: T) => DeepPartial<Settings>, icon?: MenuIcon): HTMLElement {
    const st = stepper<T>(ctx, opts, get(store.value), (v) => set(patch(v)), label);
    const r = row(label, desc, st, { cls: 'seg' });
    if (icon) r.prepend(h('span', { class: 'mn-row-ico' }, mIcon(icon, 17)));
    cur.push((s) => st.set(get(s)));
    mark(r, (s) => get(s) === get(defaults));
    return r;
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const mult = (v: number) => `${v.toFixed(1)}×`;

  // ── Graphics ─────────────────────────────────────────────────────────
  function buildGraphics(): HTMLElement {
    const presets: SegOption<string>[] = [
      { value: 'low', label: 'Low', hint: 'Best performance: no shadows, short view distance.' },
      { value: 'medium', label: 'Medium', hint: 'Balanced for laptops and integrated GPUs.' },
      { value: 'high', label: 'High', hint: 'Recommended for dedicated GPUs.' },
      { value: 'ultra', label: 'Ultra', hint: 'Everything maxed: long views, AO, supersampling.' },
    ];
    const presetSeg = segmented<string>(ctx, presets, store.value.graphics.preset, (v) => {
      store.applyPreset(v as 'low' | 'medium' | 'high' | 'ultra');
    }, 'Graphics preset');
    const customTag = h('span', { class: 'mn-custom-tag' }, mIcon('sliders', 13), 'Custom');
    ctx.tip(customTag, 'You changed individual options. Pick a preset to reset them.');
    cur.push((s) => {
      presetSeg.set(s.graphics.preset);
      customTag.classList.toggle('show', s.graphics.preset === 'custom');
    });
    const presetCard = h('div', { class: 'mn-preset' },
      h('div', { class: 'mn-preset-txt' },
        h('div', { class: 'mn-row-label' }, 'Quality preset', customTag),
        h('div', { class: 'mn-row-desc' }, 'Sets render distance, shadows, effects, detail and density in one go.')),
      presetSeg);
    const km = (v: number) => `${v} · ${((v * CHUNK * CELL) / 1000).toFixed(1)} km`;
    return h('div', { class: 'mn-pane-inner' },
      presetCard,
      section('Quality',
        sRow('Render distance', 'How far terrain, buildings and trees are drawn.', (s) => s.graphics.renderDistance, (v) => ({ graphics: { renderDistance: v } }), { min: 2, max: 24, step: 1, fmt: km, icon: 'eye' }),
        sRow('Resolution scale', 'Below 100% renders faster and upscales; above supersamples.', (s) => s.graphics.resolutionScale, (v) => ({ graphics: { resolutionScale: v } }), { min: 0.5, max: 2, step: 0.05, fmt: pct, marks: [1], icon: 'monitor' }),
        gRow('Shadows', 'Sun shadow quality.', [
          { value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
        ], (s) => s.graphics.shadows, (v) => ({ graphics: { shadows: v } }), 'sun'),
        gRow('Building detail', 'Facade geometry, rooftop props and interiors.', [
          { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
        ], (s) => s.graphics.buildingDetail, (v) => ({ graphics: { buildingDetail: v } }), 'building'),
        sRow('Tree density', 'Share of trees that are drawn.', (s) => s.graphics.treeDensity, (v) => ({ graphics: { treeDensity: v } }), { min: 0.2, max: 1, step: 0.05, fmt: pct, icon: 'tree' }),
        sRow('Vehicle density', 'Cars, trucks and buses on the streets.', (s) => s.graphics.vehicleDensity, (v) => ({ graphics: { vehicleDensity: v } }), { min: 0.1, max: 1, step: 0.05, fmt: pct, icon: 'car' }),
        tRow('Pedestrians', 'Citizens walking on sidewalks and plazas.', (s) => s.graphics.pedestrians, (v) => ({ graphics: { pedestrians: v } }), 'users'),
        tRow('Anti-aliasing', 'Smooths jagged edges.', (s) => s.graphics.antialias, (v) => ({ graphics: { antialias: v } }), 'grid')),
      section('Effects',
        tRow('Bloom', 'Glow around bright lights, the sun and neon at night.', (s) => s.graphics.bloom, (v) => ({ graphics: { bloom: v } }), 'sparkle'),
        tRow('Ambient occlusion', 'Soft contact shadows in corners and streets.', (s) => s.graphics.ambientOcclusion, (v) => ({ graphics: { ambientOcclusion: v } }), 'layout'),
        tRow('Tilt-shift', 'Miniature-style depth of field when zoomed in.', (s) => s.graphics.tiltShift, (v) => ({ graphics: { tiltShift: v } }), 'camera'),
        tRow('Fog & haze', 'Atmospheric depth on distant terrain.', (s) => s.graphics.fog, (v) => ({ graphics: { fog: v } }), 'eye'),
        tRow('Clouds', 'Layered clouds drifting over the city.', (s) => s.graphics.clouds, (v) => ({ graphics: { clouds: v } }), 'globe'),
        tRow('Weather effects', 'Rain, snow, lightning and wet streets.', (s) => s.graphics.weatherEffects, (v) => ({ graphics: { weatherEffects: v } }), 'droplet')),
      section('Display',
        sRow('Field of view', 'Vertical camera angle. Applied live.', (s) => s.graphics.fov, (v) => ({ graphics: { fov: v } }), { min: 30, max: 100, step: 1, fmt: (v) => `${v}°`, live: true, marks: [50], icon: 'compass' }),
        pRow('Frame rate limit', 'Cap the frame rate to save battery and reduce heat.', [
          { value: 0, label: 'Unlimited' }, { value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }, { value: 90, label: '90 FPS' },
          { value: 120, label: '120 FPS' }, { value: 144, label: '144 FPS' }, { value: 165, label: '165 FPS' }, { value: 240, label: '240 FPS' },
        ], (s) => s.graphics.fpsLimit, (v) => ({ graphics: { fpsLimit: v } }), 'gauge'),
        tRow('Show FPS counter', `Performance overlay${ctx.key('ui.debug') ? ` (${ctx.key('ui.debug')})` : ''}.`, (s) => s.graphics.showFps, (v) => ({ graphics: { showFps: v } }), 'zap')));
  }

  // ── Interface ────────────────────────────────────────────────────────
  function buildInterface(): HTMLElement {
    const preview = h('div', { class: 'mn-scale-preview', 'aria-hidden': 'true' },
      h('div', { class: 'mn-scale-sample' },
        h('span', { class: 'mn-scale-chip' }, mIcon('users', 14), '12,480'),
        h('span', { class: 'mn-scale-chip money' }, mIcon('coin', 14), '$84.2k'),
        h('span', { class: 'mn-scale-btn' }, mIcon('road', 16)),
        h('span', { class: 'mn-scale-btn on' }, mIcon('building', 16))));
    const scaleLabel = h('span', { class: 'mn-scale-val' });
    const paintPreview = (v: number) => {
      const curScale = store.value.ui.scale || 1;
      preview.style.setProperty('--k', String(v / curScale));
      scaleLabel.textContent = `Preview at ${Math.round(v * 100)}%`;
      preview.classList.toggle('changed', Math.abs(v - curScale) > 1e-3);
    };
    const scaleSlider = slider(ctx, {
      min: 0.6, max: 2, step: 0.05, value: store.value.ui.scale, label: 'GUI scale', marks: [1],
      format: pct,
      onInput: (v) => paintPreview(v),
      onChange: (v) => {
        set({ ui: { scale: v } });
        paintPreview(v);
      },
    });
    const scaleRow = h('div', { class: 'mn-row wide mn-scale-row' },
      h('span', { class: 'mn-row-ico' }, mIcon('search', 17)),
      h('div', { class: 'mn-row-txt' },
        h('div', { class: 'mn-row-label' }, 'GUI scale'),
        h('div', { class: 'mn-row-desc' }, 'Size of every panel, button and text. Applied when you release the slider.')),
      h('div', { class: 'mn-row-ctl' }, scaleSlider),
      h('div', { class: 'mn-scale-box' }, preview, scaleLabel));
    cur.push((s) => {
      if (document.activeElement !== scaleSlider.input) scaleSlider.set(s.ui.scale);
      paintPreview(Number(scaleSlider.input.value));
    });
    mark(scaleRow, (s) => s.ui.scale === defaults.ui.scale);
    paintPreview(store.value.ui.scale);

    return h('div', { class: 'mn-pane-inner' },
      section('Layout', scaleRow,
        tRow('Minimap', 'Overview map in the bottom-left corner.', (s) => s.ui.minimap, (v) => ({ ui: { minimap: v } }), 'map'),
        tRow('Tooltips', 'Explanations when hovering buttons and stats.', (s) => s.ui.tooltips, (v) => ({ ui: { tooltips: v } }), 'info'),
        tRow('Tutorial checklist', 'Step-by-step goals for new mayors.', (s) => s.ui.tutorial, (v) => ({ ui: { tutorial: v } }), 'check'),
        tRow('Reduced motion', 'Minimise interface animations and transitions.', (s) => s.ui.reducedMotion, (v) => ({ ui: { reducedMotion: v } }), 'pause')),
      section('City information',
        tRow('Problem icons', 'Floating icons above buildings with issues.', (s) => s.ui.problemIcons, (v) => ({ ui: { problemIcons: v } }), 'alert'),
        tRow('Chirps', 'Your citizens’ social feed in the notifications.', (s) => s.ui.chirps, (v) => ({ ui: { chirps: v } }), 'chat')),
      section('Format',
        gRow('Clock', 'Time format in the top bar.', [
          { value: 1, label: '24-hour · 18:30' }, { value: 0, label: '12-hour · 6:30 PM' },
        ], (s) => (s.ui.clock24h ? 1 : 0), (v) => ({ ui: { clock24h: v === 1 } }), 'clock'),
        gRow('Units', 'Distances, areas and temperatures.', [
          { value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' },
        ], (s) => s.ui.units, (v) => ({ ui: { units: v } }), 'globe')));
  }

  // ── Controls ─────────────────────────────────────────────────────────
  function buildControls(): HTMLElement {
    keyTable = buildKeybindTable(ctx);
    const kt = keyTable;
    cur.push((s) => kt.sync(s));
    return h('div', { class: 'mn-pane-inner' },
      section('Camera',
        sRow('Camera speed', 'Keyboard and edge panning speed.', (s) => s.controls.cameraSpeed, (v) => ({ controls: { cameraSpeed: v } }), { min: 0.2, max: 3, step: 0.1, fmt: mult, marks: [1], icon: 'compass' }),
        sRow('Rotate speed', 'Rotation with Q/E or the right mouse button.', (s) => s.controls.rotateSpeed, (v) => ({ controls: { rotateSpeed: v } }), { min: 0.2, max: 3, step: 0.1, fmt: mult, marks: [1], icon: 'reset' }),
        sRow('Zoom speed', 'Mouse wheel and pinch zoom speed.', (s) => s.controls.zoomSpeed, (v) => ({ controls: { zoomSpeed: v } }), { min: 0.2, max: 3, step: 0.1, fmt: mult, marks: [1], icon: 'search' }),
        tRow('Smooth camera', 'Eased, cinematic camera movement.', (s) => s.controls.smoothCamera, (v) => ({ controls: { smoothCamera: v } }), 'sparkle'),
        tRow('Edge scrolling', 'Pan when the mouse touches the screen edge.', (s) => s.controls.edgeScroll, (v) => ({ controls: { edgeScroll: v } }), 'mouse'),
        tRow('Invert vertical look', 'Flip up/down when tilting the camera.', (s) => s.controls.invertY, (v) => ({ controls: { invertY: v } }), 'swap'),
        tRow('Invert zoom', 'Flip the mouse wheel zoom direction.', (s) => s.controls.invertZoom, (v) => ({ controls: { invertZoom: v } }), 'swap')),
      section('Keyboard', kt.el));
  }

  // ── Audio ────────────────────────────────────────────────────────────
  function buildAudio(): HTMLElement {
    const vol = (label: string, desc: string, key: 'master' | 'music' | 'ambience' | 'sfx', icon: MenuIcon) =>
      sRow(label, desc, (s) => s.audio[key], (v) => ({ audio: { [key]: v } }), {
        min: 0, max: 1, step: 0.05, fmt: pct, icon, live: true,
        onCommit: () => ctx.sfx(key === 'music' || key === 'ambience' ? 'notice' : 'click'),
      });
    return h('div', { class: 'mn-pane-inner' },
      section('Volume',
        vol('Master volume', 'Overall loudness.', 'master', 'volume'),
        vol('Music', 'The adaptive soundtrack.', 'music', 'sparkle'),
        vol('Ambience', 'City hum, traffic, wind, rain and birds.', 'ambience', 'globe'),
        vol('Effects', 'Interface clicks, construction and alerts.', 'sfx', 'zap'),
        tRow('Mute all', 'Silence everything (also when the tab is in the background).', (s) => s.audio.muted, (v) => ({ audio: { muted: v } }), 'mute')));
  }

  // ── Gameplay ─────────────────────────────────────────────────────────
  function buildGameplay(): HTMLElement {
    return h('div', { class: 'mn-pane-inner' },
      section('Saving',
        gRow('Autosave', 'How often the city is saved automatically.', [
          { value: 0, label: 'Off' }, { value: 1, label: '1m' }, { value: 2, label: '2m' }, { value: 5, label: '5m' },
          { value: 10, label: '10m' }, { value: 15, label: '15m' }, { value: 30, label: '30m' },
        ], (s) => s.gameplay.autosaveMinutes, (v) => ({ gameplay: { autosaveMinutes: v } }), 'clock'),
        pRow('Autosave slots', 'Rotating autosaves kept per city.', [1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `${n} ${n === 1 ? 'slot' : 'slots'}` })),
          (s) => s.gameplay.autosaveSlots, (v) => ({ gameplay: { autosaveSlots: v } }), 'save')),
      section('World',
        pRow('Day & night cycle', 'Real minutes for a full day at normal speed.', [
          { value: 0, label: 'Always day' }, { value: 2, label: '2 minutes' }, { value: 4, label: '4 minutes' }, { value: 8, label: '8 minutes' },
          { value: 12, label: '12 minutes' }, { value: 20, label: '20 minutes' }, { value: 30, label: '30 minutes' }, { value: 60, label: '60 minutes' },
        ], (s) => s.gameplay.dayCycleMinutes, (v) => ({ gameplay: { dayCycleMinutes: v } }), 'sun'),
        tRow('Pause on disaster', 'Stop the clock when a disaster strikes.', (s) => s.gameplay.pauseOnDisaster, (v) => ({ gameplay: { pauseOnDisaster: v } }), 'flame'),
        tRow('Auto-bulldoze abandoned', 'Clear abandoned and collapsed buildings automatically.', (s) => s.gameplay.autoBulldozeAbandoned, (v) => ({ gameplay: { autoBulldozeAbandoned: v } }), 'trash'),
        tRow('Confirm expensive bulldozing', 'Ask before demolishing costly buildings.', (s) => s.gameplay.confirmBulldoze, (v) => ({ gameplay: { confirmBulldoze: v } }), 'alert'),
        tRow('Advisor hints', 'Suggestions about what your city needs next.', (s) => s.gameplay.advisor, (v) => ({ gameplay: { advisor: v } }), 'help')));
  }

  const builders: Record<OptionsTab, () => HTMLElement> = {
    graphics: buildGraphics,
    interface: buildInterface,
    controls: buildControls,
    audio: buildAudio,
    gameplay: buildGameplay,
  };

  // ── layout ───────────────────────────────────────────────────────────
  const tabBtns = new Map<OptionsTab, HTMLButtonElement>();
  const tabNav = h('nav', { class: 'mn-opt-tabs', role: 'tablist', 'aria-label': 'Options sections', 'data-nav': 'v' });
  for (const t of TABS) {
    const b = h('button', { class: 'mn-opt-tab', type: 'button', role: 'tab' },
      h('span', { class: 'mn-opt-tab-ico' }, mIcon(t.icon, 18)),
      h('span', { class: 'mn-opt-tab-txt' }, h('span', { class: 'mn-opt-tab-label' }, t.label), h('span', { class: 'mn-opt-tab-desc' }, t.desc)));
    b.addEventListener('click', () => show(t.id));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = TABS.findIndex((x) => x.id === t.id);
        const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        e.preventDefault();
        e.stopPropagation();
        show(TABS[n].id);
        tabBtns.get(TABS[n].id)?.focus();
      }
    });
    tabBtns.set(t.id, b);
    tabNav.append(b);
  }
  const paneHost = h('div', { class: 'mn-opt-pane', role: 'tabpanel' });
  const paneTitle = h('h3', { class: 'mn-opt-pane-title' });
  const resetTab = btn(ctx, 'Reset tab', {
    icon: 'reset', kind: 'ghost', title: 'Restore this tab’s defaults',
    onClick: () => void (async () => {
      const label = TABS.find((t) => t.id === tab)?.label ?? '';
      const ok = await ctx.confirm(`Reset ${label} options?`, tab === 'controls' ? 'Camera settings and every key binding go back to their defaults.' : `All ${label.toLowerCase()} options go back to their defaults.`, { ok: 'Reset', danger: true, icon: 'reset' });
      if (!ok) return;
      const section: SettingsSection = tab === 'interface' ? 'ui' : tab;
      store.resetSection(section);
      ctx.notify(`${label} options reset.`, 'good');
    })(),
  });
  const done = btn(ctx, 'Done', { icon: 'check', kind: 'primary', onClick: () => d.close() });

  const d = dialog(ctx, {
    id: 'options',
    title: 'Options',
    subtitle: 'Changes apply immediately and are saved automatically.',
    icon: 'sliders',
    width: 1060,
    cls: 'mn-options',
    body: h('div', { class: 'mn-opt-layout' }, tabNav, h('div', { class: 'mn-opt-main' }, paneTitle, paneHost)),
    footer: [resetTab, h('span', { class: 'mn-foot-hint' }, mIcon('check', 14), 'Saved automatically'), h('span', { class: 'mn-grow' }), done],
    onClose: () => {
      off();
      keyTable?.dispose();
    },
  });
  d.focus = () => tabBtns.get(tab)?.focus({ preventScroll: true });

  function show(id: OptionsTab): void {
    if (id !== tab) ctx.sfx('click', 0.6);
    if (tab === 'controls' && id !== 'controls') keyTable?.dispose();
    tab = id;
    writeTab(id);
    for (const [k, b] of tabBtns) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-selected', String(k === id));
      b.tabIndex = k === id ? 0 : -1;
    }
    // horizontal tab strip on phones: keep the active tab visible
    const tb = tabBtns.get(id);
    if (tb && tabNav.scrollWidth > tabNav.clientWidth) {
      tabNav.scrollTo({ left: tb.offsetLeft - (tabNav.clientWidth - tb.offsetWidth) / 2, behavior: ctx.reduced() ? 'auto' : 'smooth' });
    }
    let pane = panes.get(id);
    if (!pane) {
      cur = [];
      pane = builders[id]();
      syncs.set(id, cur);
      panes.set(id, pane);
    }
    for (const fn of syncs.get(id) ?? []) fn(store.value);
    const t = TABS.find((x) => x.id === id)!;
    paneTitle.replaceChildren(mIcon(t.icon, 20), h('span', null, t.label));
    paneHost.replaceChildren(pane);
    paneHost.scrollTop = 0;
    pane.classList.remove('mn-pane-in');
    void pane.offsetWidth;
    pane.classList.add('mn-pane-in');
  }

  const off = ctx.game.events.on('settings:changed', (s) => {
    const list = syncs.get(tab);
    if (list) for (const fn of list) fn(s);
    // other panes re-sync when shown
  });

  show(tab);
  ctx.sfx('open', 0.7);
  ctx.push(d);
}

function readTab(): OptionsTab {
  try {
    const t = localStorage.getItem(TAB_KEY) as OptionsTab | null;
    if (t && TABS.some((x) => x.id === t)) return t;
  } catch {
    /* storage unavailable */
  }
  return 'graphics';
}

function writeTab(t: OptionsTab): void {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* storage unavailable */
  }
}
