// Milestones (progress + unlock lists) and achievements grid.
import { h } from '../dom';
import { formatMoney, formatNumber } from '../../core/util';
import { MILESTONES } from '../../data/milestones';
import { Panel } from './Panel';
import { Tabs, emptyState } from './widgets';
import { setText, type HudContext } from '../hud/context';
import { icon } from '../hud/icons';
import { achievementDefs } from '../hud/optional';

type Page = 'milestones' | 'achievements';

export class MilestonesPanel extends Panel {
  private page: Page = 'milestones';
  private tabs!: Tabs<Page>;
  private pages = {} as Record<Page, HTMLElement>;
  private hero!: HTMLElement;
  private heroName!: HTMLElement;
  private heroNext!: HTMLElement;
  private heroFill!: HTMLElement;
  private heroPct!: HTMLElement;
  private heroTo!: HTMLElement;
  private timeline!: HTMLElement;
  private achGrid!: HTMLElement;
  private achHead!: HTMLElement;
  private sigM = '';
  private sigA = '';

  constructor(ctx: HudContext) {
    super(ctx, { id: 'milestones', title: 'Milestones & Achievements', icon: 'trophy', width: 760, anchor: 'center', key: 'ui.milestones', rate: 1, cls: 'hud-panel-milestones' });
    ctx.game.events.on('achievement', () => (this.sigA = ''));
    ctx.game.events.on('milestone', () => (this.sigM = ''));
  }

  setPage(p: Page): void {
    this.page = p;
    if (this.tabs) {
      this.tabs.select(p, false);
      this.show();
    }
  }

  protected build(body: HTMLElement): void {
    this.tabs = new Tabs<Page>([
      { id: 'milestones', label: 'Milestones', icon: '🏆' },
      { id: 'achievements', label: 'Achievements', icon: '🏅' },
    ], this.page, (p) => {
      this.page = p;
      this.show();
    });
    this.toolsEl.appendChild(this.tabs.el);
    this.heroName = h('div', { class: 'hud-ms-hero-name' });
    this.heroNext = h('div', { class: 'hud-ms-hero-next' });
    this.heroFill = h('span', { class: 'hud-ms-hero-fill' });
    this.heroPct = h('b', null);
    this.heroTo = h('span', { class: 'dim' });
    this.hero = h('div', { class: 'hud-ms-hero' },
      h('div', { class: 'hud-ms-hero-badge' }, '🏆'),
      h('div', { class: 'hud-ms-hero-main' },
        h('div', { class: 'hud-ms-hero-eyebrow' }, 'Current milestone'),
        this.heroName, this.heroNext,
        h('div', { class: 'hud-ms-hero-bar' }, this.heroFill),
        h('div', { class: 'hud-ms-hero-foot' }, this.heroPct, this.heroTo)));
    this.timeline = h('ol', { class: 'hud-timeline' });
    this.pages.milestones = h('div', { class: 'hud-page' }, this.hero, this.timeline);
    this.achHead = h('div', { class: 'hud-ach-head' });
    this.achGrid = h('div', { class: 'hud-ach-grid' });
    this.pages.achievements = h('div', { class: 'hud-page' }, this.achHead, this.achGrid);
    body.append(this.pages.milestones, this.pages.achievements);
    this.show();
  }

  protected override onOpen(): void {
    this.sigM = '';
    this.sigA = '';
    this.tabs.placeIndicator();
    this.refresh();
  }

  override reset(): void {
    this.sigM = '';
    this.sigA = '';
  }

  private show(): void {
    for (const [k, el] of Object.entries(this.pages)) el.style.display = k === this.page ? '' : 'none';
    this.refresh();
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.timeline) return;
    const pop = w.stats.population;
    const cur = MILESTONES[Math.min(w.milestone, MILESTONES.length - 1)];
    const next = MILESTONES[w.milestone + 1];
    this.setSubtitle(`${cur.name} · ${formatNumber(pop)} citizens · ${w.achievements.length} achievements`);
    if (this.page === 'milestones') {
      setText(this.heroName, cur.name);
      if (next) {
        const p = Math.max(0, Math.min(1, (pop - cur.population) / Math.max(1, next.population - cur.population)));
        setText(this.heroNext, `Next: ${next.name} at ${formatNumber(next.population)} citizens · ${formatMoney(next.reward)} reward`);
        this.heroFill.style.width = `${(p * 100).toFixed(1)}%`;
        setText(this.heroPct, `${Math.floor(p * 100)}%`);
        setText(this.heroTo, ` · ${formatNumber(Math.max(0, next.population - pop))} citizens to go`);
      } else {
        setText(this.heroNext, 'Every milestone reached. A true Ecumenopolis.');
        this.heroFill.style.width = '100%';
        setText(this.heroPct, '100%');
        setText(this.heroTo, '');
      }
      const sig = `${w.milestone}|${w.creative}|${w.unlockAll}`;
      if (sig !== this.sigM) {
        this.sigM = sig;
        this.timeline.replaceChildren(...MILESTONES.map((m) => {
          const reached = m.index <= w.milestone;
          const isNext = m.index === w.milestone + 1;
          return h('li', { class: 'hud-tl' + (reached ? ' reached' : '') + (isNext ? ' current' : '') + (m.index === w.milestone ? ' here' : '') },
            h('span', { class: 'hud-tl-dot' }, reached ? icon('check', 13) : isNext ? icon('flag', 12) : icon('lock', 11)),
            h('div', { class: 'hud-tl-main' },
              h('div', { class: 'hud-tl-top' },
                h('b', null, m.name),
                h('span', { class: 'hud-tl-pop' }, m.population ? `${formatNumber(m.population)} citizens` : 'Founding'),
                m.reward ? h('span', { class: 'hud-tl-reward' }, `+${formatMoney(m.reward, m.reward >= 1e6)}`) : null),
              h('div', { class: 'hud-tl-unlocks' }, m.unlocksText.map((t) => h('span', { class: 'hud-tl-chip' }, t)))));
        }));
      }
    } else this.refreshAchievements();
  }

  private refreshAchievements(): void {
    const w = this.ctx.world()!;
    const defs = achievementDefs();
    const sig = `${w.achievements.length}|${defs.length}|${w.ext.cheated ? 1 : 0}`;
    if (sig === this.sigA) return;
    this.sigA = sig;
    const got = new Set(w.achievements);
    const n = defs.filter((d) => got.has(d.id)).length;
    this.achHead.replaceChildren(
      h('div', { class: 'hud-ach-sum' },
        h('div', { class: 'hud-ach-big' }, `${n}`, h('small', null, ` / ${defs.length || w.achievements.length}`)),
        h('div', { class: 'hud-ach-sumtxt' }, h('b', null, 'Achievements unlocked'),
          h('div', { class: 'hud-meter good' }, h('span', { class: 'hud-meter-fill', style: `width:${defs.length ? ((n / defs.length) * 100).toFixed(1) : 0}%` })))),
      ...(w.ext.cheated ? [h('div', { class: 'hud-banner warn show' }, '⚠ Cheats were used in this city — new achievements are disabled.')] : []));
    if (!defs.length) {
      this.achGrid.replaceChildren(emptyState('🏅', 'Achievements are on their way', w.achievements.length ? `You have earned ${w.achievements.length} so far.` : 'Keep building — feats of city-making will be recorded here.'));
      return;
    }
    const sorted = [...defs].sort((a, b) => Number(got.has(b.id)) - Number(got.has(a.id)));
    this.achGrid.replaceChildren(...sorted.map((a) => {
      const has = got.has(a.id);
      const secret = !has && a.hidden;
      return h('div', { class: 'hud-ach' + (has ? ' got' : '') + (secret ? ' secret' : '') },
        h('div', { class: 'hud-ach-icon' }, secret ? '❔' : a.icon),
        h('div', { class: 'hud-ach-txt' },
          h('b', null, secret ? 'Hidden achievement' : a.name),
          h('span', null, secret ? 'Keep playing to discover it.' : a.description)),
        has ? h('span', { class: 'hud-ach-tick' }, icon('check', 13)) : h('span', { class: 'hud-ach-lock' }, icon('lock', 12)));
    }));
  }
}
