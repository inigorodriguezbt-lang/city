// Load & Save dialogs. Load: searchable/sortable list of saves with
// thumbnails and stats, load / export / delete, import via button or drag &
// drop of .urbis files. Save: name + optional overwrite of an existing save.
import { h } from '../dom';
import { formatMoney, formatNumber } from '../../core/util';
import { formatDate } from '../../core/time';
import type { ThemeId } from '../../core/types';
import { THEMES } from '../../data/themes';
import type { SaveMeta } from '../../save/SaveManager';
import type { MenuCtx } from './ctx';
import { mIcon } from './icons';
import { formatBytes, timeAgo } from './format';
import { btn, dialog, segmented } from './widgets';

type SortKey = 'recent' | 'name' | 'population';

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', huge: 'Huge' };

function themeName(id: string): string {
  return THEMES.find((t) => t.id === (id as ThemeId))?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : '');
}

function thumb(meta: SaveMeta): HTMLElement {
  const box = h('div', { class: 'mn-thumb' });
  if (meta.thumbnail) {
    const img = h('img', { src: meta.thumbnail, alt: '', draggable: false, loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  } else {
    const theme = THEMES.find((t) => t.id === (meta.theme as ThemeId));
    const a = theme?.waterDeep ?? '#123f5a';
    const b = theme?.grass ?? '#5f8f3e';
    box.style.background = `linear-gradient(135deg, ${a}, ${b})`;
    box.append(h('span', { class: 'mn-thumb-letter' }, (meta.cityName || meta.name || '?').trim().charAt(0).toUpperCase()));
  }
  if (meta.auto) box.append(h('span', { class: 'mn-badge auto' }, mIcon('clock', 11), 'Autosave'));
  return box;
}

function statChip(icon: Parameters<typeof mIcon>[0], text: string, cls = ''): HTMLElement {
  return h('span', { class: 'mn-chip' + (cls ? ' ' + cls : '') }, mIcon(icon, 13), h('span', null, text));
}

// ═════════════════════════════════════════════════════════════════════════
// Load
// ═════════════════════════════════════════════════════════════════════════

export function openLoadDialog(ctx: MenuCtx): void {
  const game = ctx.game;
  let saves: SaveMeta[] = [];
  let query = '';
  let sort: SortKey = 'recent';
  let selected: string | null = null;
  let busy = false;
  let loaded = false;

  const search = h('input', { type: 'search', placeholder: 'Search cities…', 'aria-label': 'Search saves', spellcheck: 'false' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  const sortSeg = segmented<SortKey>(ctx, [
    { value: 'recent', label: 'Recent', icon: 'clock' },
    { value: 'name', label: 'Name', icon: 'sort' },
    { value: 'population', label: 'Population', icon: 'users' },
  ], sort, (v) => {
    sort = v;
    render();
  }, 'Sort saves');

  const fileInput = h('input', { type: 'file', accept: '.urbis,application/octet-stream', multiple: true, class: 'mn-hidden-file', tabIndex: -1 }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void importFiles(files);
  });
  const importBtn = btn(ctx, 'Import', { icon: 'upload', kind: 'soft', title: 'Import a .urbis city file', onClick: () => fileInput.click() });

  const list = h('div', { class: 'mn-saves', 'data-nav': 'v', role: 'listbox', 'aria-label': 'Saved cities' });
  const count = h('span', { class: 'mn-count' });
  const loadBtn = btn(ctx, 'Load City', { icon: 'play', kind: 'primary', size: 'lg', onClick: () => void loadSelected() });
  const cancel = btn(ctx, 'Cancel', { kind: 'ghost', onClick: () => d.close() });
  const drop = h('div', { class: 'mn-drop' }, h('div', { class: 'mn-drop-inner' }, mIcon('upload', 34), h('b', null, 'Drop to import'), h('span', null, '.urbis city files')));

  const d = dialog(ctx, {
    id: 'load',
    title: 'Load City',
    subtitle: 'Pick up where you left off — or import a city from a friend.',
    icon: 'folder',
    width: 940,
    cls: 'mn-load',
    body: [
      h('div', { class: 'mn-toolbar' },
        h('label', { class: 'mn-search' }, mIcon('search', 16), search),
        sortSeg,
        h('span', { class: 'mn-grow' }),
        importBtn,
        fileInput),
      list,
      drop,
    ],
    footer: [h('span', { class: 'mn-foot-hint' }, mIcon('upload', 14), 'Drag & drop .urbis files anywhere on this window'), count, h('span', { class: 'mn-grow' }), cancel, loadBtn],
  });

  // drag & drop import
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  d.el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    d.card.classList.add('dragging');
  });
  d.el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  d.el.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) d.card.classList.remove('dragging');
  });
  d.el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    d.card.classList.remove('dragging');
    void importFiles(Array.from(e.dataTransfer?.files ?? []));
  });

  d.focus = () => {
    const sel = list.querySelector<HTMLElement>('.mn-save.on:not(.skeleton)') ?? list.querySelector<HTMLElement>('.mn-save:not(.skeleton)');
    (sel ?? search).focus({ preventScroll: true });
  };
  d.onKey = (e) => {
    const inSearch = document.activeElement === search;
    if (e.key === 'Enter' && selected && !(document.activeElement instanceof HTMLButtonElement)) {
      void loadSelected();
      return true;
    }
    if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selected && !inSearch) {
      const m = saves.find((x) => x.id === selected);
      if (m) void remove(m);
      return true;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && inSearch) {
      const first = list.querySelector<HTMLElement>('.mn-save');
      if (first) {
        first.focus();
        select(first.dataset.id ?? null);
      }
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      search.focus();
      search.select();
      return true;
    }
    return false;
  };

  function visible(): SaveMeta[] {
    let v = saves;
    if (query) {
      v = v.filter((m) => `${m.name} ${m.cityName} ${themeName(m.theme)} ${m.mapSize}`.toLowerCase().includes(query));
    }
    const out = v.slice();
    if (sort === 'recent') out.sort((a, b) => b.savedAt - a.savedAt);
    else if (sort === 'name') out.sort((a, b) => (a.cityName || a.name).localeCompare(b.cityName || b.name) || b.savedAt - a.savedAt);
    else out.sort((a, b) => b.population - a.population || b.savedAt - a.savedAt);
    return out;
  }

  function select(id: string | null): void {
    selected = id;
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const on = el.dataset.id === id;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    }
    loadBtn.disabled = !id || busy;
  }

  function render(): void {
    const v = visible();
    list.replaceChildren();
    count.textContent = saves.length ? `${saves.length} ${saves.length === 1 ? 'save' : 'saves'}` : '';
    if (!loaded) {
      for (let i = 0; i < 3; i++) list.append(h('div', { class: 'mn-save skeleton' }, h('div', { class: 'mn-thumb' }), h('div', { class: 'mn-save-main' }, h('i'), h('i'))));
      loadBtn.disabled = true;
      return;
    }
    if (!saves.length) {
      list.append(h('div', { class: 'mn-empty' },
        h('div', { class: 'mn-empty-art' }, mIcon('building', 40)),
        h('b', null, 'No saved cities yet'),
        h('span', null, 'Found your first city, or import a .urbis file shared by someone else.'),
        h('div', { class: 'mn-empty-actions' },
          btn(ctx, 'New City', { icon: 'plus', kind: 'primary', onClick: () => { d.close(); ctx.nav.newGame(); } }),
          btn(ctx, 'Import file', { icon: 'upload', kind: 'soft', onClick: () => fileInput.click() }))));
      select(null);
      return;
    }
    if (!v.length) {
      list.append(h('div', { class: 'mn-empty small' }, mIcon('search', 26), h('b', null, 'No matches'), h('span', null, `Nothing matches “${search.value}”.`)));
      select(null);
      return;
    }
    v.forEach((m, i) => list.append(row(m, i)));
    if (!selected || !v.some((m) => m.id === selected)) select(v[0].id);
    else select(selected);
  }

  function row(m: SaveMeta, i: number): HTMLElement {
    const exportB = btn(ctx, null, { icon: 'download', kind: 'ghost', size: 'sm', title: 'Export as .urbis file', onClick: (e) => { e.stopPropagation(); void exportSave(m); } });
    const delB = btn(ctx, null, { icon: 'trash', kind: 'ghost', size: 'sm', title: 'Delete save', cls: 'danger-hover', onClick: (e) => { e.stopPropagation(); void remove(m); } });
    exportB.tabIndex = -1;
    delB.tabIndex = -1;
    const title = m.cityName || m.name;
    const el = h('div', { class: 'mn-save', role: 'option', tabIndex: 0, style: `--d:${Math.min(i, 12)}` },
      thumb(m),
      h('div', { class: 'mn-save-main' },
        h('div', { class: 'mn-save-title' },
          h('b', null, title),
          m.name && m.name !== title ? h('span', { class: 'mn-save-name' }, m.name) : null),
        h('div', { class: 'mn-save-stats' },
          statChip('users', formatNumber(m.population, true)),
          statChip('coin', formatMoney(m.money, true), m.money < 0 ? 'bad' : 'money'),
          statChip('calendar', formatDate(m.day))),
        h('div', { class: 'mn-save-meta' },
          h('span', null, [SIZE_LABEL[m.mapSize] ?? m.mapSize, themeName(m.theme)].filter(Boolean).join(' · ')),
          m.bytes > 0 ? h('span', { class: 'faint' }, ' · ' + formatBytes(m.bytes)) : null)),
      h('div', { class: 'mn-save-side' },
        h('span', { class: 'mn-save-ago', title: new Date(m.savedAt).toLocaleString() }, timeAgo(m.savedAt)),
        h('div', { class: 'mn-save-actions' }, exportB, delB)));
    el.dataset.id = m.id;
    el.addEventListener('click', () => {
      if (selected !== m.id) ctx.sfx('click', 0.6);
      select(m.id);
    });
    el.addEventListener('focus', () => select(m.id));
    el.addEventListener('dblclick', () => void loadSelected());
    return el;
  }

  async function refresh(): Promise<void> {
    try {
      saves = await game.saves.list();
    } catch (err) {
      console.error('[menus] listing saves failed', err);
      saves = [];
      ctx.notify('Could not read saved cities.', 'bad');
    }
    loaded = true;
    render();
    // the list just arrived: move keyboard focus onto the selected save
    const active = document.activeElement;
    if (d.el.isConnected && !d.el.classList.contains('mn-covered') && (!active || active === document.body || active === search) && !search.value) d.focus?.();
  }

  async function loadSelected(): Promise<void> {
    if (busy || !selected) return;
    const m = saves.find((x) => x.id === selected);
    if (!m) return;
    if (game.world) {
      const ok = await ctx.confirm('Load this city?', `Unsaved progress in ${game.world.settings.cityName} will be lost.`, { ok: 'Load', icon: 'folder' });
      if (!ok) return;
    }
    busy = true;
    loadBtn.disabled = true;
    ctx.sfx('open');
    try {
      const ok = await game.saves.load(m.id);
      if (!ok) {
        ctx.hideLoading();
        ctx.notify(`Could not load “${m.name}”. The save may be damaged.`, 'bad');
      }
    } catch (err) {
      console.error('[menus] load failed', err);
      ctx.hideLoading();
      ctx.notify('Loading failed: ' + String((err as Error)?.message ?? err), 'bad');
    } finally {
      busy = false;
      if (d.el.isConnected) loadBtn.disabled = !selected;
    }
  }

  async function remove(m: SaveMeta): Promise<void> {
    const ok = await ctx.confirm('Delete this save?', `“${m.name}” (${m.cityName}, ${timeAgo(m.savedAt)}) will be permanently deleted. This cannot be undone.`, { ok: 'Delete', danger: true, icon: 'trash' });
    if (!ok) return;
    try {
      await game.saves.delete(m.id);
      ctx.sfx('bulldoze', 0.6);
      const idx = visible().findIndex((x) => x.id === m.id);
      saves = saves.filter((x) => x.id !== m.id);
      const v = visible();
      selected = v[Math.min(idx, v.length - 1)]?.id ?? null;
      render();
      ctx.notify(`Deleted “${m.name}”.`, 'info');
      list.querySelector<HTMLElement>('.mn-save.on')?.focus({ preventScroll: true });
    } catch (err) {
      console.error('[menus] delete failed', err);
      ctx.notify('Could not delete the save.', 'bad');
    }
  }

  async function exportSave(m: SaveMeta): Promise<void> {
    try {
      await game.saves.exportSave(m.id);
      ctx.notify(`Exported “${m.name}”.`, 'good');
    } catch (err) {
      console.error('[menus] export failed', err);
      ctx.notify('Export failed.', 'bad');
    }
  }

  async function importFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    let okCount = 0;
    let lastId: string | null = null;
    for (const f of files) {
      if (!/\.urbis$/i.test(f.name) && f.type && f.type !== 'application/octet-stream') {
        ctx.notify(`“${f.name}” is not a .urbis city file.`, 'bad');
        continue;
      }
      try {
        const meta = await game.saves.importFile(f);
        if (meta) {
          okCount++;
          lastId = meta.id;
        } else ctx.notify(`Could not import “${f.name}”.`, 'bad');
      } catch (err) {
        console.error('[menus] import failed', err);
        ctx.notify(`Could not import “${f.name}”: ${String((err as Error)?.message ?? err)}`, 'bad');
      }
    }
    if (!okCount) return;
    ctx.sfx('money', 0.6);
    ctx.notify(okCount === 1 ? 'City imported.' : `${okCount} cities imported.`, 'good');
    selected = lastId;
    sort = 'recent';
    sortSeg.set('recent');
    await refresh();
    list.querySelector<HTMLElement>('.mn-save.on')?.scrollIntoView({ block: 'nearest' });
  }

  render();
  ctx.sfx('open', 0.7);
  ctx.push(d);
  void refresh();
}

// ═════════════════════════════════════════════════════════════════════════
// Save
// ═════════════════════════════════════════════════════════════════════════

export function openSaveDialog(ctx: MenuCtx): void {
  const game = ctx.game;
  const world = game.world;
  if (!world) return;
  let saves: SaveMeta[] = [];
  let overwrite: SaveMeta | null = null;
  let busy = false;

  const name = h('input', {
    type: 'text', class: 'mn-input lg', value: world.settings.cityName, maxLength: 48, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Save name',
  }) as HTMLInputElement;
  const note = h('div', { class: 'mn-save-note' });
  const list = h('div', { class: 'mn-saves compact', 'data-nav': 'v', role: 'listbox', 'aria-label': 'Existing saves' });
  const saveBtn = btn(ctx, 'Save', { icon: 'save', kind: 'primary', size: 'lg', onClick: () => void doSave() });
  const cancel = btn(ctx, 'Cancel', { kind: 'ghost', onClick: () => d.close() });

  const stats = h('div', { class: 'mn-save-current' },
    h('div', { class: 'mn-save-cur-ico' }, mIcon('building', 22)),
    h('div', { class: 'mn-save-cur-main' },
      h('b', null, world.settings.cityName),
      h('div', { class: 'mn-save-stats' },
        statChip('users', formatNumber(world.stats.population, true)),
        statChip('coin', formatMoney(world.economy.money, true), world.economy.money < 0 ? 'bad' : 'money'),
        statChip('calendar', formatDate(world.time.day)))));

  const d = dialog(ctx, {
    id: 'save',
    title: 'Save City',
    subtitle: 'Saves are stored in this browser. Export them to keep a copy elsewhere.',
    icon: 'save',
    width: 620,
    cls: 'mn-savedlg',
    body: [
      stats,
      h('label', { class: 'mn-field' }, h('span', { class: 'mn-field-label' }, 'Save name'), name),
      note,
      h('div', { class: 'mn-field-label' }, 'Or overwrite an existing save'),
      list,
    ],
    footer: [h('span', { class: 'mn-grow' }), cancel, saveBtn],
  });
  d.focus = () => {
    name.focus({ preventScroll: true });
    name.select();
  };
  d.onKey = (e) => {
    if (e.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
      void doSave();
      return true;
    }
    return false;
  };

  name.addEventListener('input', () => {
    // typing the exact name of an existing manual save targets it for overwrite
    const n = name.value.trim().toLowerCase();
    overwrite = saves.find((m) => !m.auto && m.name.trim().toLowerCase() === n) ?? null;
    paint();
  });

  function paint(): void {
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const on = !!overwrite && el.dataset.id === overwrite.id;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    }
    note.replaceChildren();
    if (overwrite) {
      note.className = 'mn-save-note warn';
      note.append(mIcon('alert', 14), h('span', null, `Overwrites “${overwrite.name}”, saved ${timeAgo(overwrite.savedAt)}.`));
      saveBtn.querySelector('span')!.textContent = 'Overwrite';
    } else {
      note.className = 'mn-save-note';
      note.append(mIcon('plus', 14), h('span', null, 'Creates a new save.'));
      saveBtn.querySelector('span')!.textContent = 'Save';
    }
    saveBtn.disabled = busy || !name.value.trim();
  }

  function render(): void {
    list.replaceChildren();
    const manual = saves.filter((m) => !m.auto).sort((a, b) => b.savedAt - a.savedAt);
    if (!manual.length) {
      list.append(h('div', { class: 'mn-empty small' }, mIcon('save', 22), h('span', null, 'No manual saves yet.')));
    }
    manual.forEach((m, i) => {
      const el = h('div', { class: 'mn-save', role: 'option', tabIndex: 0, style: `--d:${Math.min(i, 10)}` },
        thumb(m),
        h('div', { class: 'mn-save-main' },
          h('div', { class: 'mn-save-title' }, h('b', null, m.name), m.cityName !== m.name ? h('span', { class: 'mn-save-name' }, m.cityName) : null),
          h('div', { class: 'mn-save-stats' }, statChip('users', formatNumber(m.population, true)), statChip('calendar', formatDate(m.day)))),
        h('div', { class: 'mn-save-side' }, h('span', { class: 'mn-save-ago' }, timeAgo(m.savedAt))));
      el.dataset.id = m.id;
      const pick = () => {
        ctx.sfx('click', 0.6);
        if (overwrite?.id === m.id) {
          overwrite = null;
        } else {
          overwrite = m;
          name.value = m.name;
        }
        paint();
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (overwrite?.id === m.id) void doSave();
          else pick();
        }
      });
      list.append(el);
    });
    paint();
  }

  async function doSave(): Promise<void> {
    const n = name.value.trim();
    if (busy || !n) return;
    busy = true;
    saveBtn.disabled = true;
    d.card.classList.add('busy');
    try {
      const meta = await game.saves.save(n, overwrite ? { overwriteId: overwrite.id } : undefined);
      if (meta) {
        ctx.sfx('money', 0.7);
        ctx.notify(`Saved “${meta.name}”.`, 'good');
        d.close();
      } else {
        ctx.notify('The city could not be saved (storage full or unavailable).', 'bad');
      }
    } catch (err) {
      console.error('[menus] save failed', err);
      ctx.notify('Saving failed: ' + String((err as Error)?.message ?? err), 'bad');
    } finally {
      busy = false;
      d.card.classList.remove('busy');
      if (d.el.isConnected) paint();
    }
  }

  render();
  ctx.sfx('open', 0.7);
  ctx.push(d);
  void (async () => {
    try {
      saves = await game.saves.list();
    } catch (err) {
      console.error('[menus] listing saves failed', err);
    }
    render();
    name.dispatchEvent(new Event('input'));
  })();
}
