// New City dialog: name (+ random generator), map size, climate, architecture
// style, seed, terrain sliders, difficulty and toggles → game.newGame().
import { h } from '../dom';
import { MAP_SIZES, CELL, type MapSizeId } from '../../core/constants';
import type { Difficulty, MapSettings, StyleId, ThemeId } from '../../core/types';
import { THEMES, themeDef } from '../../data/themes';
import { STYLES } from '../../data/styles';
import { MILESTONES } from '../../data/milestones';
import { START_MONEY } from '../../world/World';
import { formatMoney } from '../../core/util';
import type { MenuCtx } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { btn, dialog, section, slider, toggle } from './widgets';
import { randomCityName } from './cityNames';
import { paintThemePreview } from './themePreview';

const LAST_KEY = 'urbis.newgame.v1';

const SIZE_INFO: Record<MapSizeId, { label: string; hint: string; perf: 'ok' | 'good' | 'warn' | 'bad'; perfText: string }> = {
  small: { label: 'Small', hint: 'A cosy valley. Quick to fill, great for a first city.', perf: 'ok', perfText: 'Runs anywhere' },
  medium: { label: 'Medium', hint: 'Room for a real metropolis with suburbs and industry.', perf: 'good', perfText: 'Recommended' },
  large: { label: 'Large', hint: 'A whole region: several towns and long highways.', perf: 'warn', perfText: 'Strong PC' },
  huge: { label: 'Huge', hint: 'Endless horizons for megaproject builders.', perf: 'bad', perfText: 'High-end only' },
};

const DIFFICULTY: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Generous budget and forgiving citizens.' },
  { id: 'normal', label: 'Normal', hint: 'The intended balance.' },
  { id: 'hard', label: 'Hard', hint: 'Tight budget, demanding citizens.' },
  { id: 'expert', label: 'Expert', hint: 'Every coin counts. For veteran mayors.' },
];

function kmLabel(size: MapSizeId): string {
  const km = (MAP_SIZES[size] * CELL) / 1000;
  return `${km.toFixed(1)} × ${km.toFixed(1)} km`;
}

function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999_998);
}

/** any text works as a seed: numbers are used as-is, words are hashed */
function parseSeed(s: string): number {
  const t = s.trim();
  if (!t) return randomSeed();
  if (/^\d{1,10}$/.test(t)) return Number(t) % 4_294_967_295;
  let x = 2166136261;
  for (let i = 0; i < t.length; i++) {
    x ^= t.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x || 1;
}

interface Remembered {
  mapSize?: MapSizeId;
  theme?: ThemeId;
  difficulty?: Difficulty;
  disasters?: boolean;
  leftHandTraffic?: boolean;
  mountains?: number;
  water?: number;
  forests?: number;
}

function readLast(): Remembered {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as Remembered) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeLast(s: MapSettings): void {
  try {
    const r: Remembered = {
      mapSize: s.mapSize, theme: s.theme, difficulty: s.difficulty, disasters: s.disasters,
      leftHandTraffic: !!s.leftHandTraffic, mountains: s.mountains, water: s.water, forests: s.forests,
    };
    localStorage.setItem(LAST_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
}

export function openNewGameDialog(ctx: MenuCtx): void {
  const last = readLast();
  const theme0: ThemeId = last.theme && THEMES.some((t) => t.id === last.theme) ? last.theme : 'temperate';
  const s: MapSettings = {
    cityName: randomCityName(theme0),
    mapSize: last.mapSize && last.mapSize in MAP_SIZES ? last.mapSize : 'medium',
    theme: theme0,
    seed: randomSeed(),
    style: themeDef(theme0).defaultStyle,
    difficulty: last.difficulty && DIFFICULTY.some((d) => d.id === last.difficulty) ? last.difficulty : 'normal',
    creative: false,
    disasters: last.disasters ?? true,
    mountains: typeof last.mountains === 'number' ? last.mountains : 0.5,
    water: typeof last.water === 'number' ? last.water : 0.5,
    forests: typeof last.forests === 'number' ? last.forests : 0.5,
    leftHandTraffic: !!last.leftHandTraffic,
  };
  let styleTouched = false;
  let busy = false;

  // ── name ──────────────────────────────────────────────────────────────
  const nameInput = h('input', {
    type: 'text', class: 'mn-input lg', value: s.cityName, maxLength: 32, spellcheck: 'false', autocomplete: 'off',
    'aria-label': 'City name', placeholder: 'Name your city', autofocus: true,
  }) as HTMLInputElement;
  nameInput.addEventListener('input', () => {
    s.cityName = nameInput.value;
    paintSummary();
  });
  const dice = btn(ctx, null, {
    icon: 'dice', kind: 'soft', title: 'Suggest a name',
    onClick: () => {
      s.cityName = randomCityName(s.theme, s.cityName);
      nameInput.value = s.cityName;
      dice.classList.remove('spin');
      void dice.offsetWidth;
      dice.classList.add('spin');
      paintSummary();
    },
  });
  const nameRow = h('div', { class: 'mn-ng-name' }, h('span', { class: 'mn-ng-name-ico' }, mIcon('building', 20)), nameInput, dice);

  // ── map size ──────────────────────────────────────────────────────────
  const sizeCards = new Map<MapSizeId, HTMLButtonElement>();
  const sizeGrid = h('div', { class: 'mn-size-grid', role: 'radiogroup', 'aria-label': 'Map size', 'data-nav': 'h' });
  (Object.keys(MAP_SIZES) as MapSizeId[]).forEach((id, i) => {
    const info = SIZE_INFO[id];
    const frac = [0.42, 0.6, 0.78, 1][i];
    const card = h('button', { class: 'mn-size', type: 'button', role: 'radio' },
      h('span', { class: 'mn-size-vis' }, h('i', { style: `--f:${frac}` })),
      h('span', { class: 'mn-size-name' }, info.label),
      h('span', { class: 'mn-size-km' }, kmLabel(id)),
      h('span', { class: `mn-size-perf ${info.perf}` }, h('i'), info.perfText));
    ctx.tip(card, `${info.hint} ${MAP_SIZES[id]}×${MAP_SIZES[id]} cells.`);
    card.addEventListener('click', () => {
      if (s.mapSize === id) return;
      s.mapSize = id;
      ctx.sfx('click', 0.7);
      paintSizes();
      paintSummary();
    });
    sizeCards.set(id, card);
    sizeGrid.append(card);
  });
  const paintSizes = () => {
    for (const [id, c] of sizeCards) {
      c.classList.toggle('on', id === s.mapSize);
      c.setAttribute('aria-checked', String(id === s.mapSize));
    }
  };

  // ── climate ───────────────────────────────────────────────────────────
  const themeCards = new Map<ThemeId, HTMLButtonElement>();
  const themeGrid = h('div', { class: 'mn-theme-grid', role: 'radiogroup', 'aria-label': 'Climate', 'data-nav': 'grid' });
  THEMES.forEach((t, i) => {
    const cv = h('canvas', { class: 'mn-theme-cv', width: 240, height: 120 });
    const tags: string[] = [];
    if (t.hasCoast) tags.push('Coast');
    if (t.snowiness > 0.5) tags.push('Snowy winters');
    else if (t.tempMean > 20) tags.push('Hot');
    if (t.mountainousness > 0.7) tags.push('Mountains');
    if (t.waterAmount < 0.3) tags.push('Scarce water');
    const swatches = h('span', { class: 'mn-theme-sw' },
      ...[t.grass, t.sand, t.rock, t.waterShallow, t.waterDeep].map((c) => h('i', { style: `background:${c}` })));
    const card = h('button', { class: 'mn-theme', type: 'button', role: 'radio', style: `--d:${i}` },
      h('span', { class: 'mn-theme-art' }, cv, swatches),
      h('span', { class: 'mn-theme-txt' },
        h('span', { class: 'mn-theme-name' }, t.name),
        h('span', { class: 'mn-theme-desc' }, t.description),
        h('span', { class: 'mn-theme-tags' }, ...tags.slice(0, 3).map((x) => h('em', null, x)))),
      h('span', { class: 'mn-check' }, mIcon('check', 14)));
    card.addEventListener('click', () => {
      if (s.theme === t.id) return;
      s.theme = t.id;
      if (!styleTouched) s.style = t.defaultStyle;
      ctx.sfx('click', 0.7);
      paintThemes();
      paintStyles();
      paintSummary();
    });
    themeCards.set(t.id, card);
    themeGrid.append(card);
    // paint after layout so the canvas matches its css size
    requestAnimationFrame(() => paintThemePreview(cv, t, 240, 120, i + 1));
  });
  const paintThemes = () => {
    for (const [id, c] of themeCards) {
      c.classList.toggle('on', id === s.theme);
      c.setAttribute('aria-checked', String(id === s.theme));
    }
  };

  // ── architecture ──────────────────────────────────────────────────────
  const styleBtns = new Map<StyleId, HTMLButtonElement>();
  const styleGrid = h('div', { class: 'mn-style-grid', role: 'radiogroup', 'aria-label': 'Architecture style', 'data-nav': 'grid' });
  for (const st of STYLES) {
    const sw = h('span', { class: 'mn-style-sw' },
      ...[...st.wallColors.slice(0, 3), st.roofColors[0], st.trimColors[0]].map((c) => h('i', { style: `background:${c}` })));
    const lockTxt = st.unlock > 0 ? MILESTONES[st.unlock]?.name ?? `Milestone ${st.unlock}` : '';
    const b = h('button', { class: 'mn-style', type: 'button', role: 'radio' },
      sw,
      h('span', { class: 'mn-style-name' }, st.name),
      st.unlock > 0 ? h('span', { class: 'mn-style-lock', 'aria-label': 'Normally unlocked later' }, mIcon('star', 11)) : null);
    ctx.tip(b, st.description + (lockTxt ? ` Normally unlocked at “${lockTxt}” — available now as your founding style.` : ''));
    b.addEventListener('click', () => {
      styleTouched = true;
      if (s.style === st.id) return;
      s.style = st.id;
      ctx.sfx('click', 0.7);
      paintStyles();
      paintSummary();
    });
    styleBtns.set(st.id, b);
    styleGrid.append(b);
  }
  const styleNote = h('div', { class: 'mn-note' });
  const paintStyles = () => {
    for (const [id, b] of styleBtns) {
      b.classList.toggle('on', id === s.style);
      b.setAttribute('aria-checked', String(id === s.style));
      b.classList.toggle('rec', id === themeDef(s.theme).defaultStyle);
    }
    const st = STYLES.find((x) => x.id === s.style);
    styleNote.replaceChildren(mIcon('info', 14), h('span', null, st ? st.description : ''));
  };

  // ── terrain ───────────────────────────────────────────────────────────
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const terrainRow = (icon: MenuIcon, label: string, key: 'mountains' | 'water' | 'forests') =>
    h('div', { class: 'mn-terrain' },
      h('span', { class: 'mn-terrain-ico' }, mIcon(icon, 17)),
      h('span', { class: 'mn-terrain-label' }, label),
      slider(ctx, { min: 0, max: 1, step: 0.05, value: s[key], format: pct, label, onInput: (v) => (s[key] = v), marks: [0.5] }));
  const seedInput = h('input', {
    type: 'text', class: 'mn-input mono', value: String(s.seed), maxLength: 24, spellcheck: 'false', autocomplete: 'off', inputMode: 'text',
    'aria-label': 'Map seed',
  }) as HTMLInputElement;
  seedInput.addEventListener('change', () => {
    s.seed = parseSeed(seedInput.value);
    if (/^\d+$/.test(seedInput.value.trim()) || !seedInput.value.trim()) seedInput.value = String(s.seed);
  });
  const seedDice = btn(ctx, null, {
    icon: 'dice', kind: 'soft', title: 'Random seed',
    onClick: () => {
      s.seed = randomSeed();
      seedInput.value = String(s.seed);
      seedDice.classList.remove('spin');
      void seedDice.offsetWidth;
      seedDice.classList.add('spin');
    },
  });
  ctx.tip(seedInput, 'The same seed and settings always generate the same landscape. Words work too.');
  const seedRow = h('div', { class: 'mn-seed' }, h('span', { class: 'mn-seed-label' }, mIcon('globe', 16), 'Seed'), seedInput, seedDice);

  // ── difficulty ────────────────────────────────────────────────────────
  const diffBtns = new Map<Difficulty, HTMLButtonElement>();
  const diffGrid = h('div', { class: 'mn-diff-grid', role: 'radiogroup', 'aria-label': 'Difficulty', 'data-nav': 'h' });
  DIFFICULTY.forEach((d, i) => {
    const b = h('button', { class: 'mn-diff', type: 'button', role: 'radio', style: `--lvl:${i}` },
      h('span', { class: 'mn-diff-bars' }, h('i'), h('i'), h('i'), h('i')),
      h('span', { class: 'mn-diff-name' }, d.label),
      h('span', { class: 'mn-diff-money' }, formatMoney(START_MONEY[d.id] ?? 70_000)));
    ctx.tip(b, `${d.hint} Starting funds ${formatMoney(START_MONEY[d.id] ?? 70_000)}.`);
    b.addEventListener('click', () => {
      if (s.difficulty === d.id) return;
      s.difficulty = d.id;
      ctx.sfx('click', 0.7);
      paintDiff();
      paintSummary();
    });
    diffBtns.set(d.id, b);
    diffGrid.append(b);
  });
  const paintDiff = () => {
    for (const [id, b] of diffBtns) {
      b.classList.toggle('on', id === s.difficulty);
      b.setAttribute('aria-checked', String(id === s.difficulty));
    }
    diffGrid.classList.toggle('muted', s.creative);
  };

  // ── toggles ───────────────────────────────────────────────────────────
  const toggleRow = (icon: MenuIcon, label: string, desc: string, value: boolean, set: (v: boolean) => void) => {
    const t = toggle(ctx, value, (v) => {
      set(v);
      paintDiff();
      paintSummary();
    }, label);
    const row = h('label', { class: 'mn-opt' },
      h('span', { class: 'mn-opt-ico' }, mIcon(icon, 17)),
      h('span', { class: 'mn-opt-txt' }, h('span', { class: 'mn-opt-label' }, label), h('span', { class: 'mn-opt-desc' }, desc)),
      t);
    row.addEventListener('click', (e) => {
      if (e.target !== t && !t.contains(e.target as Node)) {
        e.preventDefault();
        t.click();
      }
    });
    return row;
  };
  const toggles = h('div', { class: 'mn-opts' },
    toggleRow('infinity', 'Creative mode', 'Unlimited money and every building unlocked.', s.creative, (v) => (s.creative = v)),
    toggleRow('flame', 'Disasters', 'Fires, storms, floods, earthquakes and rarer surprises.', s.disasters, (v) => (s.disasters = v)),
    toggleRow('car', 'Left-hand traffic', 'Vehicles drive on the left side of the road.', !!s.leftHandTraffic, (v) => (s.leftHandTraffic = v)));

  // ── footer ────────────────────────────────────────────────────────────
  const summary = h('div', { class: 'mn-ng-summary' });
  const paintSummary = () => {
    const t = themeDef(s.theme);
    const st = STYLES.find((x) => x.id === s.style);
    summary.replaceChildren(
      h('span', { class: 'mn-ng-sum-name' }, s.cityName.trim() || 'Unnamed city'),
      h('span', { class: 'mn-ng-sum-meta' },
        [t.name, SIZE_INFO[s.mapSize].label + ' map', st?.name ?? s.style, s.creative ? 'Creative' : DIFFICULTY.find((d) => d.id === s.difficulty)?.label ?? ''].join(' · ')));
  };
  const found = btn(ctx, 'Found City', { icon: 'flag', kind: 'primary', size: 'lg', onClick: () => void start() });
  const cancel = btn(ctx, 'Cancel', { kind: 'ghost', onClick: () => d.close() });

  const left = h('div', { class: 'mn-ng-col' },
    section('City name', nameRow),
    section('Map size', sizeGrid),
    section('Climate & landscape', themeGrid));
  const right = h('div', { class: 'mn-ng-col' },
    section('Architecture', styleGrid, styleNote),
    section('Terrain', h('div', { class: 'mn-terrain-list' },
      terrainRow('mountain', 'Mountains', 'mountains'),
      terrainRow('droplet', 'Water', 'water'),
      terrainRow('tree', 'Forests', 'forests')), seedRow),
    section('Difficulty', diffGrid),
    section('Rules', toggles));

  const d = dialog(ctx, {
    id: 'newgame',
    title: 'Found a New City',
    subtitle: 'Choose a landscape, a style and a name. Everything is generated just for you.',
    icon: 'sparkle',
    width: 1160,
    cls: 'mn-newgame',
    body: h('div', { class: 'mn-ng-grid' }, left, right),
    footer: [summary, h('span', { class: 'mn-grow' }), cancel, found],
  });
  d.focus = () => {
    nameInput.focus({ preventScroll: true });
    nameInput.select();
  };
  d.onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && (document.activeElement === nameInput || document.activeElement === seedInput)) {
      if (document.activeElement === seedInput) seedInput.dispatchEvent(new Event('change'));
      void start();
      return true;
    }
    return false;
  };

  async function start(): Promise<void> {
    if (busy) return;
    const name = s.cityName.trim();
    if (!name) {
      nameInput.focus();
      nameRow.classList.remove('shake');
      void nameRow.offsetWidth;
      nameRow.classList.add('shake');
      ctx.sfx('error', 0.6);
      ctx.notify('Give your city a name first.', 'bad');
      return;
    }
    s.cityName = name.slice(0, 32);
    s.seed = parseSeed(seedInput.value);
    busy = true;
    found.disabled = true;
    writeLast(s);
    ctx.sfx('milestone', 0.6);
    const settings: MapSettings = { ...s };
    try {
      await ctx.game.newGame(settings);
    } catch (err) {
      console.error('[menus] new game failed', err);
      ctx.hideLoading();
      if (!ctx.game.world) {
        ctx.game.menus.showMainMenu();
        ctx.notify('Could not create the city: ' + String((err as Error)?.message ?? err), 'bad');
      }
    } finally {
      busy = false;
      found.disabled = false;
    }
  }

  paintSizes();
  paintThemes();
  paintStyles();
  paintDiff();
  paintSummary();
  ctx.push(d);
}
