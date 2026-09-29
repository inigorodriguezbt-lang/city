// Ctrl+F search over every road, zone, building and tool with fuzzy matching
// and keyboard navigation. Enter activates the highlighted tool.
import { h } from '../dom';
import { formatMoney } from '../../core/util';
import { Panel } from './Panel';
import { categoryDef, isItemUnlocked, milestoneLabel, type PaletteItem } from '../hud/catalog';
import { setClass, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';

interface Hit {
  it: PaletteItem;
  score: number;
  marks: number[];
}

/** subsequence fuzzy match on `text`; returns score + matched indices */
function fuzzy(q: string, text: string): { score: number; marks: number[] } | null {
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const marks = Array.from({ length: q.length }, (_, i) => direct + i);
    const wordStart = direct === 0 || /[\s\-(&]/.test(t[direct - 1]);
    return { score: 100 - direct + (wordStart ? 40 : 0) + (direct === 0 ? 30 : 0), marks };
  }
  const marks: number[] = [];
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 4 + streak * 3 - Math.min(6, found - ti) * 0.5;
    if (found === 0 || /[\s\-(&]/.test(t[found - 1])) score += 6;
    marks.push(found);
    ti = found + 1;
  }
  return { score, marks };
}

export class SearchPanel extends Panel {
  private input!: HTMLInputElement;
  private results!: HTMLElement;
  private hits: Hit[] = [];
  private sel = 0;
  private rows: HTMLElement[] = [];
  private recent: string[] = [];
  private items: PaletteItem[] = [];

  constructor(ctx: HudContext) {
    super(ctx, { id: 'search', title: 'Search', icon: 'search', width: 580, anchor: 'top', key: 'ui.search', rate: 0, cls: 'hud-panel-search' });
    this.setSubtitle('Roads, zones, buildings and tools');
  }

  protected build(body: HTMLElement): void {
    this.input = h('input', { type: 'search', class: 'hud-search-input', placeholder: 'Try “school”, “wind”, “bus”, “park”…', spellcheck: false, autocomplete: 'off' });
    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    // typing must not trigger game hotkeys
    let prev = true;
    this.input.addEventListener('focus', () => {
      prev = this.ctx.game.input.enabled;
      this.ctx.game.input.enabled = false;
    });
    this.input.addEventListener('blur', () => {
      this.ctx.game.input.enabled = prev;
    });
    this.results = h('div', { class: 'hud-search-results', role: 'listbox' });
    body.append(
      h('div', { class: 'hud-search-box' }, icon('search', 18), this.input,
        h('span', { class: 'hud-search-keys' }, h('kbd', { class: 'hud-kbd' }, '↑↓'), h('kbd', { class: 'hud-kbd' }, '↵'))),
      this.results);
  }

  protected override onOpen(): void {
    this.items = this.ctx.ui.toolbar.items();
    this.input.value = '';
    this.run();
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  protected override onClose(): void {
    if (document.activeElement === this.input) this.input.blur();
  }

  private run(): void {
    const q = this.input.value.trim().toLowerCase();
    const w = this.ctx.world();
    if (!q) {
      // recent picks first, then a few friendly suggestions
      const byKey = new Map(this.items.map((i) => [i.key, i]));
      const rec = this.recent.map((k) => byKey.get(k)).filter((x): x is PaletteItem => !!x);
      const sugg = this.items.filter((i) => i.kind === 'building' && isItemUnlocked(w, i) && !rec.includes(i)).slice(0, 8 - Math.min(rec.length, 6));
      this.hits = [...rec.slice(0, 6), ...sugg].map((it) => ({ it, score: 0, marks: [] }));
      this.render(rec.length ? 'Recent' : 'Suggestions');
      return;
    }
    const hits: Hit[] = [];
    for (const it of this.items) {
      const m = fuzzy(q, it.name);
      let score = m ? m.score + 20 : -1;
      const marks = m ? m.marks : [];
      if (score < 0) {
        const hay = `${it.description} ${it.search} ${categoryDef(it.cat).label}`.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        if (words.every((wd) => hay.includes(wd))) score = 12;
        else continue;
      }
      if (isItemUnlocked(w, it)) score += 8;
      hits.push({ it, score, marks });
    }
    hits.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
    this.hits = hits.slice(0, 40);
    this.render(this.hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : '');
  }

  private render(label: string): void {
    this.sel = 0;
    this.rows = [];
    const w = this.ctx.world();
    if (!this.hits.length) {
      this.results.replaceChildren(h('div', { class: 'hud-search-empty' }, h('div', { class: 'hud-empty-glyph' }, '🔎'), 'No matches. Try a different word.'));
      return;
    }
    const frag = document.createDocumentFragment();
    if (label) frag.appendChild(h('div', { class: 'hud-search-label' }, label));
    this.hits.forEach((hit, i) => {
      const it = hit.it;
      const unlocked = isItemUnlocked(w, it);
      const cat = categoryDef(it.cat);
      const cost = it.cost !== undefined ? `${formatMoney(it.cost, it.cost >= 100_000)}${it.costUnit ?? ''}` : it.costText ?? '';
      const row = h('button', { class: 'hud-search-row' + (unlocked ? '' : ' locked'), role: 'option', style: `--c:${cat.color}` },
        h('span', { class: 'hud-search-icon' }, it.icon),
        h('span', { class: 'hud-search-main' },
          h('span', { class: 'hud-search-name' }, highlight(it.name, hit.marks)),
          h('span', { class: 'hud-search-cat' }, icon(cat.icon, 12), cat.label)),
        unlocked ? h('span', { class: 'hud-search-cost' }, cost) : h('span', { class: 'hud-search-lock' }, icon('lock', 12), milestoneLabel(it.unlock)));
      row.onclick = () => this.choose(i);
      row.onpointermove = () => this.setSel(i, false);
      this.rows.push(row);
      frag.appendChild(row);
    });
    this.results.replaceChildren(frag);
    this.setSel(0, false);
  }

  private setSel(i: number, scroll: boolean): void {
    if (!this.rows.length) return;
    this.sel = (i + this.rows.length) % this.rows.length;
    this.rows.forEach((r, k) => setClass(r, 'sel', k === this.sel));
    if (scroll) this.rows[this.sel].scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const hit = this.hits[i];
    if (!hit) return;
    if (this.ctx.ui.toolbar.select(hit.it)) {
      this.recent = [hit.it.key, ...this.recent.filter((k) => k !== hit.it.key)].slice(0, 6);
      if (hit.it.kind !== 'action') this.ctx.ui.toolbar.open(hit.it.cat);
      this.ctx.ui.closePanel('search');
    }
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setSel(this.sel + 1, true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setSel(this.sel - 1, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.choose(this.sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.ctx.ui.closePanel('search');
    }
  }
}

function highlight(name: string, marks: number[]): (HTMLElement | string)[] {
  if (!marks.length) return [name];
  const set = new Set(marks);
  const out: (HTMLElement | string)[] = [];
  let buf = '', inMark = false;
  const flush = () => {
    if (!buf) return;
    out.push(inMark ? h('mark', null, buf) : buf);
    buf = '';
  };
  for (let i = 0; i < name.length; i++) {
    const m = set.has(i);
    if (m !== inMark) {
      flush();
      inMark = m;
    }
    buf += name[i];
  }
  flush();
  return out;
}
