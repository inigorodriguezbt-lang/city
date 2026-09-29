// Districts: list with rename, colour, architectural style, specialisation,
// policies, paint and delete. Shows district colours on the map while open.
import { h } from '../dom';
import type { District, StyleId } from '../../core/types';
import { formatNumber } from '../../core/util';
import { STYLES } from '../../data/styles';
import { Panel } from './Panel';
import { colorPicker, emptyState } from './widgets';
import { setText, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';
import { unlockText } from '../hud/catalog';

const SPECIALIZATIONS: { id: string; name: string; icon: string }[] = [
  { id: '', name: 'No specialisation', icon: '—' },
  { id: 'tourism', name: 'Tourism', icon: '📸' },
  { id: 'leisure', name: 'Leisure & nightlife', icon: '🎭' },
  { id: 'hightech', name: 'High-tech', icon: '💾' },
  { id: 'selfsufficient', name: 'Self-sufficient homes', icon: '🌱' },
  { id: 'organic', name: 'Organic & local produce', icon: '🥕' },
];

const DISTRICTS_UNLOCK = 4;

interface Stat {
  cells: number;
  residents: number;
  jobs: number;
  buildings: number;
}

export class DistrictsPanel extends Panel {
  private list!: HTMLElement;
  private stats = new Map<number, Stat>();
  private statAcc = 10;
  private sig = '';
  private picker: HTMLElement | null = null;

  constructor(ctx: HudContext) {
    super(ctx, { id: 'districts', title: 'Districts', icon: 'map', width: 680, anchor: 'center', rate: 1, cls: 'hud-panel-districts' });
  }

  protected build(body: HTMLElement): void {
    const add = h('button', { class: 'btn primary', onclick: () => this.create() }, icon('plus', 16), 'New district');
    this.toolsEl.appendChild(h('div', { class: 'hud-tools-row' }, h('span', { class: 'dim' }, 'Paint neighbourhoods, then give each its own character.'), h('span', { class: 'hud-fly-spacer' }), add));
    this.list = h('div', { class: 'hud-dist-list' });
    body.appendChild(this.list);
    body.addEventListener('pointerdown', (e) => {
      if (this.picker && !(e.target as HTMLElement).closest('.hud-colors, .hud-dist-swatch')) this.closePicker();
    });
  }

  protected override onOpen(): void {
    this.statAcc = 10;
    this.sig = '';
    this.refresh();
    try {
      this.ctx.game.zones.setDistrictsVisible(true);
    } catch {
      /* renderer not ready */
    }
  }

  protected override onClose(): void {
    this.closePicker();
    if (this.ctx.game.tools.current?.id === 'district') return;
    try {
      this.ctx.game.zones.setDistrictsVisible(false);
    } catch {
      /* renderer not ready */
    }
  }

  override reset(): void {
    this.sig = '';
    this.stats.clear();
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.list) return;
    this.statAcc += 1;
    if (this.statAcc >= 3) {
      this.statAcc = 0;
      this.computeStats();
    }
    const locked = !w.isUnlocked(DISTRICTS_UNLOCK);
    this.setSubtitle(locked ? unlockText(DISTRICTS_UNLOCK) : `${w.districts.length} district${w.districts.length === 1 ? '' : 's'}`);
    const sig = `${locked}|` + w.districts.map((d) => `${d.id}:${d.name}:${d.color}:${d.style}:${d.specialization ?? ''}:${d.policies.length}`).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.render(locked);
    }
    for (const d of w.districts) {
      const s = this.stats.get(d.id);
      const el = this.list.querySelector<HTMLElement>(`[data-did="${d.id}"] .hud-dist-stats`);
      if (el) setText(el, s ? `${formatNumber(s.cells)} cells · ${formatNumber(s.residents)} residents · ${formatNumber(s.jobs)} jobs · ${formatNumber(s.buildings)} buildings` : 'Not painted yet');
    }
  }

  private computeStats(): void {
    const w = this.ctx.world()!;
    this.stats.clear();
    if (!w.districts.length) return;
    const arr = w.district;
    const cells = new Map<number, number>();
    for (let i = 0; i < arr.length; i++) {
      const id = arr[i];
      if (id) cells.set(id, (cells.get(id) ?? 0) + 1);
    }
    for (const [id, n] of cells) this.stats.set(id, { cells: n, residents: 0, jobs: 0, buildings: 0 });
    for (const b of w.buildings.values()) {
      const s = this.stats.get(arr[w.idx(b.x, b.y)]);
      if (!s) continue;
      s.residents += b.residents;
      s.jobs += b.jobs;
      s.buildings++;
    }
  }

  private render(locked: boolean): void {
    const w = this.ctx.world()!;
    if (locked) {
      this.list.replaceChildren(emptyState('🗺️', 'Districts are locked', `${unlockText(DISTRICTS_UNLOCK)}. Districts let you name neighbourhoods and set their own policies.`));
      return;
    }
    if (!w.districts.length) {
      this.list.replaceChildren(emptyState('🗺️', 'No districts yet', 'Create a district and paint it onto the map to give an area its own name, style and policies.',
        h('button', { class: 'btn primary', onclick: () => this.create() }, icon('plus', 16), 'Create the first district')));
      return;
    }
    this.list.replaceChildren(...w.districts.map((d) => this.row(d)));
  }

  private row(d: District): HTMLElement {
    const g = this.ctx.game;
    const swatch = h('button', { class: 'hud-dist-swatch', style: `--c:${d.color}`, 'aria-label': 'Colour' });
    swatch.onclick = (e) => {
      e.stopPropagation();
      this.openPicker(d, swatch);
    };
    this.ctx.tips.attach(swatch, 'Change colour');
    const name = h('button', { class: 'hud-dist-name', onclick: () => void this.rename(d) }, d.name, icon('pencil', 12));
    this.ctx.tips.attach(name, 'Rename');
    const style = h('select', { class: 'hud-select sm', 'aria-label': 'Style' },
      h('option', { value: '' }, 'City style'),
      ...STYLES.map((s) => {
        const ok = this.ctx.world()!.isUnlocked(s.unlock, s.id);
        return h('option', { value: s.id, disabled: !ok, selected: d.style === s.id }, ok ? s.name : `${s.name} 🔒`);
      }));
    style.value = d.style ?? '';
    style.addEventListener('change', () => {
      g.actions.updateDistrict(d.id, { style: (style.value || null) as StyleId | null });
      this.ctx.sfx('click', 0.5);
    });
    const spec = h('select', { class: 'hud-select sm', 'aria-label': 'Specialisation' },
      ...SPECIALIZATIONS.map((s) => h('option', { value: s.id, selected: (d.specialization ?? '') === s.id }, s.id ? `${s.icon} ${s.name}` : s.name)));
    spec.value = d.specialization ?? '';
    spec.addEventListener('change', () => {
      g.actions.updateDistrict(d.id, { specialization: spec.value || undefined });
      this.ctx.sfx('click', 0.5);
    });
    const policies = h('button', { class: 'hud-mini-btn', onclick: () => this.ctx.ui.openPanel('policies', d.id) }, icon('policy', 14), `${d.policies.length} ${d.policies.length === 1 ? 'policy' : 'policies'}`);
    this.ctx.tips.attach(policies, 'District policies');
    const paint = h('button', { class: 'hud-mini-btn accent', onclick: () => {
      g.tools.setTool('district', { districtId: d.id });
      this.ctx.sfx('click');
      this.ctx.ui.closePanel('districts');
    } }, icon('brush', 14), 'Paint');
    this.ctx.tips.attach(paint, 'Paint this district onto the map');
    const locate = h('button', { class: 'hud-icon-btn', 'aria-label': 'Locate', onclick: () => this.locate(d) }, icon('crosshair', 15));
    this.ctx.tips.attach(locate, 'Fly to district');
    const del = h('button', { class: 'hud-icon-btn danger', 'aria-label': 'Delete', onclick: () => void this.remove(d) }, icon('trash', 15));
    this.ctx.tips.attach(del, 'Delete district');
    return h('div', { class: 'hud-dist', 'data-did': String(d.id), style: `--c:${d.color}` },
      h('div', { class: 'hud-dist-top' }, swatch, h('div', { class: 'hud-dist-titles' }, name, h('span', { class: 'hud-dist-stats' }, '…')), paint, locate, del),
      h('div', { class: 'hud-dist-ctl' },
        h('label', null, h('span', null, 'Style'), style),
        h('label', null, h('span', null, 'Specialisation'), spec),
        policies));
  }

  private openPicker(d: District, anchor: HTMLElement): void {
    this.closePicker();
    const p = colorPicker(d.color, (c) => {
      this.ctx.game.actions.updateDistrict(d.id, { color: c });
      this.closePicker();
      this.ctx.sfx('click', 0.5);
    });
    p.classList.add('pop');
    anchor.parentElement!.appendChild(p);
    this.picker = p;
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = null;
  }

  private create(): void {
    const w = this.ctx.world();
    if (!w) return;
    if (!w.isUnlocked(DISTRICTS_UNLOCK)) {
      this.ctx.sfx('error');
      return;
    }
    try {
      const d = this.ctx.game.actions.createDistrict();
      this.ctx.sfx('click');
      this.sig = '';
      this.refresh();
      this.ctx.ui.toast(`${d.name} created — press Paint to draw it`, 'good');
    } catch (e) {
      this.ctx.ui.toast(String((e as Error).message ?? e), 'danger');
    }
  }

  private async rename(d: District): Promise<void> {
    const name = await this.ctx.ui.prompt('Rename district', d.name);
    if (!name) return;
    this.ctx.game.actions.updateDistrict(d.id, { name: name.slice(0, 32) });
    this.sig = '';
    this.refresh();
  }

  private async remove(d: District): Promise<void> {
    const ok = await this.ctx.ui.confirmEx(`Delete ${d.name}?`, 'The area keeps its buildings and zoning; only the district, its name and its policies are removed.', { danger: true, ok: 'Delete', icon: '🗺️' });
    if (!ok) return;
    this.ctx.game.actions.deleteDistrict(d.id);
    this.ctx.sfx('bulldoze', 0.6);
    this.sig = '';
    this.refresh();
  }

  private locate(d: District): void {
    const w = this.ctx.world();
    if (!w) return;
    let sx = 0, sy = 0, n = 0;
    const s = w.size;
    for (let i = 0; i < w.district.length; i += 3) if (w.district[i] === d.id) {
      sx += i % s;
      sy += (i / s) | 0;
      n++;
    }
    if (n) this.ctx.flyTo(sx / n, sy / n, 700);
    else this.ctx.ui.toast(`${d.name} has not been painted yet`, 'info');
  }
}
