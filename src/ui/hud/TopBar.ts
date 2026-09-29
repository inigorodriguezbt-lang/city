// Top HUD bar: city identity + calendar/clock + speed control (left),
// population / money / happiness / RCIO demand / weather (center),
// panel shortcuts (right). DOM writes only happen when values change.
import { h } from '../dom';
import { formatDate, formatHour, calendar, isNight } from '../../core/time';
import { formatMoney, formatNumber } from '../../core/util';
import { MILESTONES } from '../../data/milestones';
import type { WeatherType } from '../../core/types';
import type { ActionId } from '../../settings/types';
import type { PanelId } from '../UIManager';
import { faceIcon, icon, speedGlyph, type IconName } from './icons';
import { richTip } from './Tooltip';
import { flowLabel, formatSpeed, formatTemp, setClass, setText, setVar, sumValues, type HudContext } from './context';

const SPEED_LABELS = ['Pause', 'Normal speed', 'Fast', 'Faster', 'Ultra fast'];
const SPEED_TEXT = ['', '1×', '2×', '4×', '10×'];
const SPEED_ACTIONS: ActionId[] = ['game.pause', 'game.speed1', 'game.speed2', 'game.speed3', 'game.speed4'];

const WEATHER: Record<WeatherType, { name: string; icon: IconName }> = {
  clear: { name: 'Clear skies', icon: 'sun' },
  cloudy: { name: 'Overcast', icon: 'cloud' },
  rain: { name: 'Rain', icon: 'rain' },
  storm: { name: 'Thunderstorm', icon: 'storm' },
  snow: { name: 'Snowfall', icon: 'snow' },
  fog: { name: 'Fog', icon: 'fog' },
  heatwave: { name: 'Heat wave', icon: 'heat' },
  blizzard: { name: 'Blizzard', icon: 'blizzard' },
};

const SEASON_NAMES = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' } as const;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface MenuButton {
  id: PanelId | 'photo' | 'menu' | 'more';
  icon: IconName;
  label: string;
  key?: ActionId;
  keyText?: string;
  el?: HTMLButtonElement;
}

export class TopBar {
  readonly el: HTMLElement;
  private cityName: HTMLElement;
  private dateEl: HTMLElement;
  private clockEl: HTMLElement;
  private dayIcon: HTMLElement;
  private dayIconKind = '';
  private speedBtns: HTMLButtonElement[] = [];
  private speedInd: HTMLElement;
  private speedSeg: HTMLElement;
  private popVal: HTMLElement;
  private popTrend: HTMLElement;
  private trendKind = '';
  private msName: HTMLElement;
  private msFill: HTMLElement;
  private moneyVal: HTMLElement;
  private moneyNet: HTMLElement;
  private moneyBox: HTMLElement;
  private happyVal: HTMLElement;
  private happyBox: HTMLElement;
  private face = faceIcon(20);
  private demand: { pos: HTMLElement; neg: HTMLElement; col: HTMLElement }[] = [];
  private weatherIcon: HTMLElement;
  private weatherKind = '';
  private weatherTemp: HTMLElement;
  private menu: MenuButton[] = [];
  private badge: HTMLElement;
  private acc = 1;
  private projAcc = 10;
  private net = 0;
  private proj: { income: Record<string, number>; expense: Record<string, number> } = { income: {}, expense: {} };
  private popSamples: { day: number; pop: number }[] = [];
  private lastSpeed = -1;

  constructor(private ctx: HudContext) {
    const t = ctx.tips;
    // ── left: city + calendar + speed ────────────────────────────────────
    this.cityName = h('button', { class: 'hud-city-name' }, 'City');
    t.attach(this.cityName, 'Rename your city');
    this.cityName.onclick = () => void this.rename();
    this.dateEl = h('span', { class: 'hud-date' });
    this.clockEl = h('span', { class: 'hud-clock' });
    this.dayIcon = h('span', { class: 'hud-dayicon' });
    const calendarRow = h('div', { class: 'hud-cal' }, this.dayIcon, this.dateEl, h('span', { class: 'hud-dot' }), this.clockEl);
    t.attach(calendarRow, () => this.calendarTip(), { rich: true });

    this.speedInd = h('span', { class: 'hud-speed-ind' });
    this.speedSeg = h('div', { class: 'hud-speed', role: 'radiogroup', 'aria-label': 'Game speed' }, this.speedInd);
    for (let i = 0; i < 5; i++) {
      const b = h('button', { class: 'hud-speed-btn', role: 'radio', 'aria-label': SPEED_LABELS[i] },
        speedGlyph(i, i === 0 ? 15 : 14),
        SPEED_TEXT[i] ? h('span', { class: 'hud-speed-txt' }, SPEED_TEXT[i]) : null);
      b.onclick = () => this.setSpeed(i);
      t.attach(b, SPEED_LABELS[i], { key: () => ctx.key(SPEED_ACTIONS[i]) });
      this.speedBtns.push(b);
      this.speedSeg.appendChild(b);
    }
    const left = h('div', { class: 'hud-pill hud-pe hud-top-left' },
      h('div', { class: 'hud-city' }, this.cityName, calendarRow),
      h('div', { class: 'hud-sep' }),
      this.speedSeg);

    // ── center: city vitals ──────────────────────────────────────────────
    this.popVal = h('span', { class: 'hud-stat-val' }, '0');
    this.popTrend = h('span', { class: 'hud-trend' });
    this.msName = h('span', { class: 'hud-ms-name' });
    this.msFill = h('span', { class: 'hud-ms-fill' });
    const pop = h('button', { class: 'hud-stat hud-pop', onclick: () => ctx.ui.togglePanel('milestones') },
      h('span', { class: 'hud-stat-icon' }, icon('users', 18)),
      h('span', { class: 'hud-stat-main' },
        h('span', { class: 'hud-stat-line' }, this.popVal, this.popTrend),
        h('span', { class: 'hud-ms' }, h('span', { class: 'hud-ms-bar' }, this.msFill), this.msName)));
    t.attach(pop, () => this.popTip(), { rich: true });

    this.moneyVal = h('span', { class: 'hud-stat-val' }, '$0');
    this.moneyNet = h('span', { class: 'hud-stat-sub' });
    this.moneyBox = h('button', { class: 'hud-stat hud-money', onclick: () => ctx.ui.togglePanel('budget') },
      h('span', { class: 'hud-stat-icon' }, icon('budget', 18)),
      h('span', { class: 'hud-stat-main' }, this.moneyVal, this.moneyNet));
    t.attach(this.moneyBox, () => this.moneyTip(), { rich: true, key: () => ctx.key('ui.budget') });

    this.happyVal = h('span', { class: 'hud-stat-val' }, '0%');
    this.happyBox = h('button', { class: 'hud-stat hud-happy', onclick: () => ctx.ui.togglePanel('stats') },
      h('span', { class: 'hud-stat-icon hud-face' }, this.face.el),
      h('span', { class: 'hud-stat-main' }, this.happyVal, h('span', { class: 'hud-stat-sub dim' }, 'Happiness')));
    t.attach(this.happyBox, () => this.happyTip(), { rich: true, key: () => ctx.key('ui.stats') });

    const dem = h('button', { class: 'hud-demand', 'aria-label': 'Zone demand', onclick: () => ctx.ui.toolbar.open('zoning') });
    const cats: [string, string][] = [['R', 'res'], ['C', 'com'], ['I', 'ind'], ['O', 'off']];
    for (const [letter, key] of cats) {
      const pos = h('span', { class: 'hud-dem-pos' });
      const neg = h('span', { class: 'hud-dem-neg' });
      const col = h('span', { class: `hud-dem-col ${key}` }, h('span', { class: 'hud-dem-track' }, pos, neg), h('span', { class: 'hud-dem-l' }, letter));
      this.demand.push({ pos, neg, col });
      dem.appendChild(col);
    }
    t.attach(dem, () => this.demandTip(), { rich: true });

    this.weatherIcon = h('span', { class: 'hud-weather-icon' });
    this.weatherTemp = h('span', { class: 'hud-stat-val' });
    const weather = h('div', { class: 'hud-stat hud-weather' }, this.weatherIcon, this.weatherTemp);
    t.attach(weather, () => this.weatherTip(), { rich: true });

    const center = h('div', { class: 'hud-pill hud-pe hud-top-center' },
      pop, h('div', { class: 'hud-sep' }), this.moneyBox, h('div', { class: 'hud-sep' }), this.happyBox,
      h('div', { class: 'hud-sep' }), dem, h('div', { class: 'hud-sep' }), weather);

    // ── right: panels ────────────────────────────────────────────────────
    this.menu = [
      { id: 'overlays', icon: 'layers', label: 'Info views', key: 'ui.overlays' },
      { id: 'budget', icon: 'budget', label: 'Budget & taxes', key: 'ui.budget' },
      { id: 'stats', icon: 'stats', label: 'City statistics', key: 'ui.stats' },
      { id: 'graphs', icon: 'graph', label: 'Graphs & trends' },
      { id: 'policies', icon: 'policy', label: 'Policies', key: 'ui.policies' },
      { id: 'milestones', icon: 'trophy', label: 'Milestones & achievements', key: 'ui.milestones' },
      { id: 'districts', icon: 'map', label: 'Districts' },
      { id: 'transit', icon: 'bus', label: 'Transit lines' },
      { id: 'notices', icon: 'bell', label: 'Notifications' },
      { id: 'search', icon: 'search', label: 'Search buildings & tools', key: 'ui.search' },
      { id: 'photo', icon: 'aperture', label: 'Photo mode', key: 'ui.photoMode' },
      { id: 'more', icon: 'grip', label: 'More' },
      { id: 'menu', icon: 'menu', label: 'Game menu', keyText: 'Esc' },
    ];
    this.badge = h('span', { class: 'hud-badge' });
    const right = h('div', { class: 'hud-pill hud-pe hud-top-right' });
    for (const m of this.menu) {
      const b = h('button', { class: 'hud-mbtn', 'aria-label': m.label, 'data-id': m.id }, icon(m.icon, 19));
      if (m.id === 'notices') b.appendChild(this.badge);
      if (m.id === 'overlays') b.classList.add('hud-mbtn-accent');
      b.onclick = () => {
        if (m.id === 'photo') ctx.ui.setPhotoMode(true);
        else if (m.id === 'more') ctx.ui.toggleMore();
        else if (m.id === 'menu') {
          ctx.sfx('open');
          ctx.game.menus.openPause();
        } else ctx.ui.togglePanel(m.id);
      };
      t.attach(b, m.label, { key: () => (m.key ? ctx.key(m.key) : m.keyText ?? '') });
      m.el = b;
      right.appendChild(b);
      if (m.id === 'overlays' || m.id === 'transit' || m.id === 'search') right.appendChild(h('div', { class: 'hud-sep slim', 'data-after': m.id }));
    }

    this.el = h('header', { class: 'hud-top' }, left, center, right);
  }

  /** reset per-world caches */
  onWorld(): void {
    this.popSamples = [];
    this.acc = 1;
    this.projAcc = 10;
    this.lastSpeed = -1;
    this.trendKind = '';
    this.weatherKind = '';
    this.dayIconKind = '';
  }

  setPanelOpen(id: PanelId | null): void {
    for (const m of this.menu) m.el?.classList.toggle('active', m.id === id);
  }

  setUnread(n: number): void {
    setText(this.badge, n > 99 ? '99+' : String(n));
    setClass(this.badge, 'show', n > 0);
  }

  update(dt: number): void {
    const w = this.ctx.world();
    if (!w) return;
    // speed reflects immediately (cheap)
    if (w.time.speed !== this.lastSpeed) this.reflectSpeed(w.time.speed);
    this.acc += dt;
    this.projAcc += dt;
    if (this.acc < 0.125) return;
    this.acc = 0;
    const settings = this.ctx.game.settings.value;
    const st = w.stats;

    setText(this.cityName, w.settings.cityName);
    setText(this.dateEl, formatDate(w.time.day));
    setText(this.clockEl, formatHour(w.time.hour, settings.ui.clock24h));
    const night = isNight(w.time.hour) ? 'moon' : 'sun';
    if (night !== this.dayIconKind) {
      this.dayIconKind = night;
      this.dayIcon.replaceChildren(icon(night, 14));
      setClass(this.dayIcon, 'night', night === 'moon');
    }

    // population + trend (vs ~30 days ago)
    const pop = st.population;
    setText(this.popVal, formatNumber(pop, pop >= 100_000));
    const day = Math.floor(w.time.day);
    const last = this.popSamples[this.popSamples.length - 1];
    if (!last || last.day !== day) {
      this.popSamples.push({ day, pop });
      while (this.popSamples.length > 40) this.popSamples.shift();
    } else last.pop = pop;
    const ref = this.popSamples.find((s) => s.day >= day - 30) ?? this.popSamples[0];
    const delta = pop - (ref?.pop ?? pop);
    const kind = Math.abs(delta) < Math.max(2, pop * 0.004) ? 'flat' : delta > 0 ? 'up' : 'down';
    if (kind !== this.trendKind) {
      this.trendKind = kind;
      this.popTrend.className = 'hud-trend ' + kind;
      this.popTrend.replaceChildren(icon(kind === 'up' ? 'trendUp' : kind === 'down' ? 'trendDown' : 'trendFlat', 13));
    }

    // milestone progress
    const cur = MILESTONES[Math.min(w.milestone, MILESTONES.length - 1)];
    const next = MILESTONES[w.milestone + 1];
    if (next) {
      const p = Math.max(0, Math.min(1, (pop - cur.population) / Math.max(1, next.population - cur.population)));
      setVar(this.msFill, '--p', p.toFixed(3));
      setText(this.msName, `${Math.floor(p * 100)}% to ${next.name}`);
    } else {
      setVar(this.msFill, '--p', '1');
      setText(this.msName, cur.name);
    }

    // money
    const creative = w.creative;
    if (this.projAcc >= 1) {
      this.projAcc = 0;
      this.proj = this.safeProjection();
      const inc = sumValues(this.proj.income), exp = sumValues(this.proj.expense);
      if (inc !== 0 || exp !== 0) this.net = inc - exp;
      else if (st.netIncome) this.net = st.netIncome;
      else this.net = sumValues(w.economy.lastIncome) - sumValues(w.economy.lastExpense);
    }
    const money = w.economy.money;
    setText(this.moneyVal, creative ? '∞' : formatMoney(money, Math.abs(money) >= 10_000_000));
    setClass(this.moneyBox, 'negative', !creative && money < 0);
    setClass(this.moneyBox, 'creative', creative);
    if (creative) setText(this.moneyNet, 'Creative mode');
    else setText(this.moneyNet, `${this.net >= 0 ? '+' : ''}${formatMoney(this.net, Math.abs(this.net) >= 100_000)}/mo`);
    setClass(this.moneyNet, 'good', !creative && this.net > 0);
    setClass(this.moneyNet, 'bad', !creative && this.net < 0);

    // happiness
    const hp = Math.round(st.happiness);
    setText(this.happyVal, `${hp}%`);
    this.face.set(hp);
    setClass(this.happyBox, 'good', hp >= 65);
    setClass(this.happyBox, 'warn', hp >= 40 && hp < 65);
    setClass(this.happyBox, 'bad', hp < 40);

    // demand bars (CSS transitions animate)
    const d = st.demand;
    const vals = [d.res, d.com, d.ind, d.off];
    for (let i = 0; i < 4; i++) {
      const v = Math.max(-1, Math.min(1, vals[i] || 0));
      setVar(this.demand[i].pos, '--v', Math.max(0, v).toFixed(3));
      setVar(this.demand[i].neg, '--v', Math.max(0, -v).toFixed(3));
      setClass(this.demand[i].col, 'hot', v > 0.66);
    }

    // weather
    const wt = w.weather;
    const wk = wt.type === 'clear' && isNight(w.time.hour) ? 'moon' : WEATHER[wt.type]?.icon ?? 'sun';
    if (wk !== this.weatherKind) {
      this.weatherKind = wk;
      this.weatherIcon.replaceChildren(icon(wk, 19));
      this.weatherIcon.dataset.kind = wt.type;
    }
    setText(this.weatherTemp, formatTemp(wt.temperature, settings.ui.units));
  }

  // ── actions ──────────────────────────────────────────────────────────────
  private setSpeed(i: number): void {
    const sim = this.ctx.game.sim;
    const w = this.ctx.world();
    if (!w) return;
    // the pause segment toggles (click again to resume)
    if (i === 0) sim.togglePause();
    else sim.setSpeed(i);
    this.ctx.sfx('click', 0.7);
    this.reflectSpeed(w.time.speed);
  }

  reflectSpeed(level: number): void {
    this.lastSpeed = level;
    this.speedBtns.forEach((b, i) => {
      b.classList.toggle('active', i === level);
      b.setAttribute('aria-checked', String(i === level));
    });
    const b = this.speedBtns[level];
    if (b) {
      requestAnimationFrame(() => {
        this.speedInd.style.width = `${b.offsetWidth}px`;
        this.speedInd.style.transform = `translateX(${b.offsetLeft}px)`;
      });
    }
    this.speedSeg.classList.toggle('paused', level === 0);
  }

  private async rename(): Promise<void> {
    const w = this.ctx.world();
    if (!w) return;
    const name = await this.ctx.ui.prompt('Rename city', w.settings.cityName);
    if (name && this.ctx.world() === w) {
      w.settings.cityName = name.slice(0, 40);
      setText(this.cityName, w.settings.cityName);
      this.ctx.ui.toast(`Welcome to ${w.settings.cityName}!`, 'good');
    }
  }

  private safeProjection(): { income: Record<string, number>; expense: Record<string, number> } {
    try {
      return this.ctx.game.sim.projection() ?? { income: {}, expense: {} };
    } catch {
      return { income: {}, expense: {} };
    }
  }

  // ── tooltips ─────────────────────────────────────────────────────────────
  private calendarTip(): HTMLElement | string {
    const w = this.ctx.world();
    if (!w) return '';
    const c = calendar(w.time.day);
    const years = Math.floor(w.time.day / 360), months = Math.floor((w.time.day % 360) / 30);
    return richTip({
      title: formatDate(w.time.day),
      subtitle: `${SEASON_NAMES[c.season]} · ${formatHour(w.time.hour, this.ctx.game.settings.value.ui.clock24h)}`,
      rows: [
        ['City age', years ? `${years}y ${months}m` : `${months} months`],
        ['Day of month', `${c.dayOfMonth} / 30`],
        ['Year progress', `${Math.round(c.yearProgress * 100)}%`],
      ],
    });
  }

  private popTip(): HTMLElement | string {
    const w = this.ctx.world();
    if (!w) return '';
    const st = w.stats;
    const cur = MILESTONES[Math.min(w.milestone, MILESTONES.length - 1)];
    const next = MILESTONES[w.milestone + 1];
    const ref = this.popSamples.find((s) => s.day >= Math.floor(w.time.day) - 30) ?? this.popSamples[0];
    const delta = st.population - (ref?.pop ?? st.population);
    return richTip({
      title: `${formatNumber(st.population)} citizens`,
      subtitle: `${cur.name}${next ? ` → ${next.name} at ${formatNumber(next.population)}` : ' · final milestone'}`,
      rows: [
        ['Last 30 days', `${delta >= 0 ? '+' : ''}${formatNumber(delta)}`, delta > 0 ? 'good' : delta < 0 ? 'bad' : ''],
        ['Households', formatNumber(st.households)],
        ['Workforce', formatNumber(st.workforce)],
        ['Students', formatNumber(st.students)],
        ['Tourists', formatNumber(st.tourists)],
        ['Births / deaths', `${formatNumber(st.births)} / ${formatNumber(st.deaths)}`],
        ['Moved in / out', `${formatNumber(st.movedIn)} / ${formatNumber(st.movedOut)}`],
      ],
      footer: 'Click for milestones & achievements',
    });
  }

  private moneyTip(): HTMLElement | string {
    const w = this.ctx.world();
    if (!w) return '';
    if (w.creative) return richTip({ title: 'Unlimited funds', subtitle: 'Creative mode', text: 'Money is no object. Build anything, anywhere.' });
    const top = (r: Record<string, number>) => Object.entries(r).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const inc = top(this.proj.income), exp = top(this.proj.expense);
    const rows: [string, string, ('good' | 'bad' | '')?][] = [];
    for (const [k, v] of inc) rows.push([flowLabel(k), '+' + formatMoney(v), 'good']);
    for (const [k, v] of exp) rows.push([flowLabel(k, true), '-' + formatMoney(v), 'bad']);
    const loans = w.economy.loans.reduce((s, l) => s + l.remaining, 0);
    if (loans > 0) rows.push(['Outstanding loans', formatMoney(loans)]);
    return richTip({
      title: formatMoney(w.economy.money),
      subtitle: `${this.net >= 0 ? '+' : ''}${formatMoney(this.net)} per month (projected)`,
      rows: rows.length ? rows : [['Income', 'No data yet']],
      footer: w.economy.money < 0 ? 'In debt: construction is blocked after 3 months in the red.' : 'Click to open the budget',
      footerKind: w.economy.money < 0 ? 'bad' : '',
    });
  }

  private happyTip(): HTMLElement | string {
    const w = this.ctx.world();
    if (!w) return '';
    const st = w.stats;
    const pct = (v: number) => `${Math.round(v)}%`;
    const kind = (v: number, inverse = false): 'good' | 'bad' | '' => {
      const g = inverse ? v < 25 : v >= 65;
      const b = inverse ? v > 55 : v < 35;
      return g ? 'good' : b ? 'bad' : '';
    };
    const unemp = st.workforce > 0 ? (st.unemployed / st.workforce) * 100 : 0;
    return richTip({
      title: `Happiness ${Math.round(st.happiness)}%`,
      subtitle: st.happiness >= 65 ? 'Citizens love it here' : st.happiness >= 40 ? 'Citizens are getting by' : 'Citizens are unhappy',
      rows: [
        ['Health', pct(st.health), kind(st.health)],
        ['Education', pct(st.education), kind(st.education)],
        ['Crime rate', pct(st.crimeRate), kind(st.crimeRate, true)],
        ['Pollution', pct(st.pollution), kind(st.pollution, true)],
        ['Land value', pct(st.landValue), kind(st.landValue)],
        ['Unemployment', `${unemp.toFixed(1)}%`, unemp > 12 ? 'bad' : unemp < 6 ? 'good' : ''],
      ],
      footer: 'Click for city statistics',
    });
  }

  private demandTip(): HTMLElement {
    const w = this.ctx.world();
    const d = w?.stats.demand ?? { res: 0, com: 0, ind: 0, off: 0 };
    const f = (v: number): [string, 'good' | 'bad' | ''] => {
      const p = Math.round(v * 100);
      const word = v > 0.66 ? 'Very high' : v > 0.3 ? 'High' : v > 0.05 ? 'Moderate' : v > -0.05 ? 'Balanced' : 'Oversupplied';
      return [`${word} (${p > 0 ? '+' : ''}${p}%)`, v > 0.3 ? 'good' : v < -0.05 ? 'bad' : ''];
    };
    const r = f(d.res), c = f(d.com), i = f(d.ind), o = f(d.off);
    return richTip({
      title: 'Zone demand',
      subtitle: 'What your city wants to grow next',
      rows: [['Residential', r[0], r[1]], ['Commercial', c[0], c[1]], ['Industrial', i[0], i[1]], ['Office', o[0], o[1]]],
      footer: 'Click to open the zoning tools',
    });
  }

  private weatherTip(): HTMLElement | string {
    const w = this.ctx.world();
    if (!w) return '';
    const wt = w.weather;
    const units = this.ctx.game.settings.value.ui.units;
    const c = calendar(w.time.day);
    const dirIdx = Math.round((((wt.windDir % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    return richTip({
      title: WEATHER[wt.type]?.name ?? wt.type,
      subtitle: `${SEASON_NAMES[c.season]} · ${formatTemp(wt.temperature, units)}`,
      rows: [
        ['Intensity', `${Math.round(wt.intensity * 100)}%`],
        ['Wind', `${formatSpeed(wt.windSpeed, units)} ${COMPASS[dirIdx]}`],
        ['Snow cover', `${Math.round(wt.snowCover * 100)}%`],
        ['Next change', wt.nextChange <= 1 ? 'Within a day' : `~${Math.round(wt.nextChange)} days`],
      ],
    });
  }
}
