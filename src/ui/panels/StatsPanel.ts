// City statistics: population, jobs, wellbeing, utilities (produced vs
// consumed), traffic and building counts.
import { h } from '../dom';
import { BFlag } from '../../core/types';
import { formatNumber } from '../../core/util';
import { zoneDef } from '../../data/zones';
import { Panel } from './Panel';
import { statRow } from './widgets';
import { setClass, setText, type HudContext } from '../hud/context';

type Row = ReturnType<typeof statRow>;

interface UtilRow {
  el: HTMLElement;
  val: HTMLElement;
  used: HTMLElement;
  over: HTMLElement;
  sub: HTMLElement;
}

export class StatsPanel extends Panel {
  private rows = new Map<string, Row>();
  private big = new Map<string, HTMLElement>();
  private utils = new Map<string, UtilRow>();
  private demand: { pos: HTMLElement; neg: HTMLElement }[] = [];
  private demandVals: HTMLElement[] = [];
  private bAcc = 10;
  private counts = new Map<string, HTMLElement>();

  constructor(ctx: HudContext) {
    super(ctx, { id: 'stats', title: 'City Statistics', icon: 'stats', width: 820, anchor: 'center', key: 'ui.stats', rate: 2, cls: 'hud-panel-stats' });
  }

  private card(title: string, ic: string, ...children: (HTMLElement | null)[]): HTMLElement {
    return h('div', { class: 'hud-card-box' }, h('div', { class: 'hud-card-box-title' }, h('span', null, ic), title), ...children);
  }

  private row(key: string, label: string, meter = false, kind: Parameters<typeof statRow>[2] = 'accent'): HTMLElement {
    const r = statRow(label, meter, kind);
    this.rows.set(key, r);
    return r.el;
  }

  private bigNum(key: string, label: string): HTMLElement {
    const v = h('div', { class: 'hud-big-val' }, '—');
    this.big.set(key, v);
    return h('div', { class: 'hud-big' }, v, h('div', { class: 'hud-big-label' }, label));
  }

  private util(key: string, label: string, ic: string): HTMLElement {
    const val = h('span', { class: 'hud-util-val' });
    const used = h('span', { class: 'hud-util-used' });
    const over = h('span', { class: 'hud-util-over' });
    const sub = h('span', { class: 'hud-util-sub' });
    const el = h('div', { class: 'hud-util' },
      h('div', { class: 'hud-util-top' }, h('span', { class: 'hud-util-icon' }, ic), h('span', { class: 'hud-util-label' }, label), val),
      h('div', { class: 'hud-util-bar' }, used, over),
      sub);
    this.utils.set(key, { el, val, used, over, sub });
    return el;
  }

  protected build(body: HTMLElement): void {
    const dem = h('div', { class: 'hud-dem-big' });
    for (const [l, c, name] of [['R', 'res', 'Residential'], ['C', 'com', 'Commercial'], ['I', 'ind', 'Industrial'], ['O', 'off', 'Office']] as const) {
      const pos = h('span', { class: 'hud-bipolar-pos' });
      const neg = h('span', { class: 'hud-bipolar-neg' });
      const v = h('b', null, '0');
      this.demand.push({ pos, neg });
      this.demandVals.push(v);
      dem.appendChild(h('div', { class: `hud-dem-row ${c}` }, h('span', { class: 'hud-dem-letter' }, l), h('span', { class: 'hud-dem-name' }, name), h('div', { class: 'hud-bipolar' }, neg, pos), v));
    }
    const bgrid = h('div', { class: 'hud-count-grid' });
    for (const [k, label, ic] of [
      ['res', 'Residential', '🏡'], ['com', 'Commercial', '🏪'], ['ind', 'Industrial', '🏭'], ['off', 'Office', '🏙️'],
      ['svc', 'Services', '🏛️'], ['build', 'Under construction', '🏗️'], ['aband', 'Abandoned', '🏚️'], ['fire', 'On fire', '🔥'],
    ] as const) {
      const v = h('b', null, '0');
      this.counts.set(k, v);
      bgrid.appendChild(h('div', { class: 'hud-count' }, h('span', null, ic), h('div', null, v, h('small', null, label))));
    }
    body.appendChild(h('div', { class: 'hud-stats-grid' },
      this.card('Population', '👥',
        h('div', { class: 'hud-bigs' }, this.bigNum('pop', 'Citizens'), this.bigNum('hh', 'Households'), this.bigNum('tour', 'Tourists')),
        this.row('students', 'Students'),
        this.row('births', 'Births / deaths (month)'),
        this.row('moves', 'Moved in / out (month)')),
      this.card('Work', '💼',
        h('div', { class: 'hud-bigs' }, this.bigNum('jobs', 'Jobs'), this.bigNum('workforce', 'Workforce'), this.bigNum('unemp', 'Unemployed')),
        this.row('employed', 'Employed', true, 'good'),
        this.row('jobfill', 'Jobs filled', true, 'accent')),
      this.card('Wellbeing', '💚',
        this.row('happiness', 'Happiness', true, 'auto'),
        this.row('health', 'Health', true, 'auto'),
        this.row('education', 'Education', true, 'auto'),
        this.row('landValue', 'Land value', true, 'auto'),
        this.row('crime', 'Crime rate', true, 'bad'),
        this.row('pollution', 'Pollution', true, 'bad')),
      this.card('Zone demand', '📶', dem),
      h('div', { class: 'hud-card-box wide' },
        h('div', { class: 'hud-card-box-title' }, h('span', null, '🔌'), 'Utilities & services', h('small', null, 'used vs. capacity')),
        h('div', { class: 'hud-util-grid' },
          this.util('power', 'Electricity', '⚡'), this.util('water', 'Water', '💧'), this.util('sewage', 'Sewage', '🚽'),
          this.util('garbage', 'Garbage', '🗑️'), this.util('health', 'Healthcare', '🏥'), this.util('education', 'Education', '🎓'),
          this.util('deathcare', 'Deathcare', '⚱️'))),
      this.card('Traffic', '🚦',
        this.row('flow', 'Traffic flow', true, 'auto'),
        this.row('vehicles', 'Vehicles on the road'),
        this.row('lines', 'Transit lines'),
        this.row('riders', 'Transit riders (month)')),
      this.card('Buildings', '🏙️', bgrid)));
  }

  override refresh(): void {
    const w = this.ctx.world();
    if (!w || !this.rows.size) return;
    const st = w.stats;
    const n = (v: number) => formatNumber(v, v >= 100_000);
    this.setSubtitle(`${w.settings.cityName} · ${formatNumber(st.population)} citizens`);
    setText(this.big.get('pop')!, n(st.population));
    setText(this.big.get('hh')!, n(st.households));
    setText(this.big.get('tour')!, n(st.tourists));
    this.rows.get('students')!.set(formatNumber(st.students));
    this.rows.get('births')!.set(`${formatNumber(st.births)} / ${formatNumber(st.deaths)}`);
    this.rows.get('moves')!.set(`${formatNumber(st.movedIn)} / ${formatNumber(st.movedOut)}`, undefined, st.movedIn >= st.movedOut ? 'good' : 'bad');
    setText(this.big.get('jobs')!, n(st.jobs));
    setText(this.big.get('workforce')!, n(st.workforce));
    const unemp = st.workforce > 0 ? st.unemployed / st.workforce : 0;
    setText(this.big.get('unemp')!, `${(unemp * 100).toFixed(1)}%`);
    setClass(this.big.get('unemp')!, 'bad', unemp > 0.12);
    setClass(this.big.get('unemp')!, 'good', unemp < 0.06 && st.workforce > 0);
    this.rows.get('employed')!.set(formatNumber(st.employed), st.workforce > 0 ? st.employed / st.workforce : 0);
    this.rows.get('jobfill')!.set(st.jobs > 0 ? `${Math.round((st.employed / st.jobs) * 100)}%` : '—', st.jobs > 0 ? Math.min(1, st.employed / st.jobs) : 0);
    const pct = (v: number) => `${Math.round(v)}%`;
    this.rows.get('happiness')!.set(pct(st.happiness), st.happiness / 100);
    this.rows.get('health')!.set(pct(st.health), st.health / 100);
    this.rows.get('education')!.set(pct(st.education), st.education / 100);
    this.rows.get('landValue')!.set(pct(st.landValue), st.landValue / 100);
    this.rows.get('crime')!.set(pct(st.crimeRate), st.crimeRate / 100, st.crimeRate > 50 ? 'bad' : '');
    this.rows.get('pollution')!.set(pct(st.pollution), st.pollution / 100, st.pollution > 50 ? 'bad' : '');
    const d = [st.demand.res, st.demand.com, st.demand.ind, st.demand.off];
    d.forEach((v, i) => {
      const cv = Math.max(-1, Math.min(1, v || 0));
      this.demand[i].pos.style.width = `${(Math.max(0, cv) * 50).toFixed(1)}%`;
      this.demand[i].neg.style.width = `${(Math.max(0, -cv) * 50).toFixed(1)}%`;
      setText(this.demandVals[i], `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);
    });
    this.setUtil('power', st.power.consumed, st.power.produced, 'MW', 'consumed', 'produced');
    this.setUtil('water', st.water.consumed, st.water.produced, 'm³', 'used', 'pumped');
    this.setUtil('sewage', st.sewage.produced, st.sewage.capacity, 'm³', 'produced', 'treated');
    this.setUtil('garbage', st.garbage.produced, st.garbage.capacity, 't', 'produced', 'capacity', st.garbage.stored ? `${formatNumber(st.garbage.stored)} t stored` : '');
    this.setUtil('health', st.health_.sick, st.health_.capacity, '', 'sick', 'beds');
    this.setUtil('education', st.education_.students, st.education_.capacity, '', 'students', 'seats');
    this.setUtil('deathcare', st.deathcare.dead, st.deathcare.capacity, '', 'awaiting', 'capacity');
    this.rows.get('flow')!.set(pct(st.trafficFlow), st.trafficFlow / 100);
    let veh = st.vehicles;
    try {
      veh = this.ctx.game.traffic.vehicleCount || st.vehicles;
    } catch {
      /* keep stats value */
    }
    this.rows.get('vehicles')!.set(formatNumber(veh));
    const active = w.transitLines.filter((l) => l.active).length;
    this.rows.get('lines')!.set(w.transitLines.length ? `${active} active / ${w.transitLines.length}` : 'None');
    this.rows.get('riders')!.set(formatNumber(w.transitLines.reduce((s, l) => s + l.ridership, 0)));
    // building census (throttled: iterates every building)
    this.bAcc += 0.5;
    if (this.bAcc >= 2) {
      this.bAcc = 0;
      const c = { res: 0, com: 0, ind: 0, off: 0, svc: 0, build: 0, aband: 0, fire: 0 };
      for (const b of w.buildings.values()) {
        if (b.kind === 'service') c.svc++;
        else {
          const cat = zoneDef(b.zone)?.category;
          if (cat) c[cat]++;
        }
        if (b.flags & BFlag.UnderConstruction) c.build++;
        if (b.flags & BFlag.Abandoned) c.aband++;
        if (b.flags & BFlag.OnFire) c.fire++;
      }
      for (const [k, v] of Object.entries(c)) setText(this.counts.get(k)!, formatNumber(v));
    }
  }

  protected override onOpen(): void {
    this.bAcc = 10;
    this.refresh();
  }

  private setUtil(key: string, used: number, cap: number, unit: string, usedLabel: string, capLabel: string, extra = ''): void {
    const u = this.utils.get(key)!;
    const max = Math.max(used, cap, 1e-6);
    const over = used > cap && used > 0;
    const f = (v: number) => formatNumber(v, v >= 100_000) + (unit ? ` ${unit}` : '');
    const ratio = cap > 0 ? used / cap : 0;
    u.used.style.width = `${((Math.min(used, cap) / max) * 100).toFixed(1)}%`;
    u.over.style.width = `${(over ? ((used - cap) / max) * 100 : 0).toFixed(1)}%`;
    setClass(u.el, 'over', over);
    setClass(u.el, 'tight', !over && ratio > 0.85);
    if (used === 0 && cap === 0) {
      setText(u.val, '—');
      setText(u.sub, 'Nothing built yet');
      return;
    }
    setText(u.val, over ? `Short ${f(used - cap)}` : `${Math.round(ratio * 100)}%`);
    setText(u.sub, `${f(used)} ${usedLabel} · ${f(cap)} ${capLabel}${extra ? ' · ' + extra : ''}`);
  }
}
