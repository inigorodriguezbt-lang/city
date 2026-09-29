// Loading overlay: full-screen skyline backdrop, compact logotype, smooth
// eased progress bar with percentage, the current step label and rotating
// gameplay tips. hide() fades the whole overlay out to reveal the city.
import { h } from '../dom';
import type { MenuCtx } from './ctx';
import { mIcon } from './icons';

export const LOADING_TIPS = [
  'Zones only grow next to roads — connect your first street to the highway before painting.',
  'Power and water travel along roads. A building touching a serviced road is connected.',
  'Hold Shift while dragging roads for straight lines, Ctrl for automatic path-finding.',
  'Residential demand follows jobs. Balance housing with shops, offices and industry.',
  'Industry pollutes. Keep it downwind and away from homes, or use it as a buffer with parks.',
  'Land value rises with parks, services, transit and water views — and so do building levels.',
  'Buildings level up from 1 to 5. Education unlocks offices and high-tech jobs.',
  'Open the info views (O) to see power, water, pollution, crime and more at a glance.',
  'Budget sliders trade cost for effectiveness. 100% is a sensible default for most services.',
  'Traffic jams? Add avenues, roundabout-free grids and public transit lines.',
  'Pause with Space, then plan calmly. Speeds 1–4 fast-forward the calendar.',
  'Press Ctrl+Z to undo almost anything — up to 100 steps back.',
  'Open the command chat with T or / — try /help for a list of commands.',
  'Photo mode (P) hides the interface and unlocks tilt-shift and golden-hour shots.',
  'Autosave keeps your latest cities safe. Configure it under Options → Gameplay.',
  'Specialised industry needs natural resources: farmland, forests, ore or oil.',
  'Unlock new architecture styles as your population grows and give each district its own look.',
  'Garbage, sick citizens and fires all cause distress. Watch the problem icons over buildings.',
  'Disasters can be switched off when founding a city, or later with /disasters off.',
  'Mixed-use zones put shops on the ground floor and apartments above — great for walkable streets.',
  'Education takes years to spread. Build schools early so your workforce is ready for offices.',
  'Parks near homes raise happiness and land value; plazas do the same for commercial streets.',
];

export class LoadingOverlay {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private bar: HTMLElement;
  private pct: HTMLElement;
  private label: HTMLElement;
  private tip: HTMLElement;
  private tipText: HTMLElement;
  private shown = false;
  private target = 0;
  private cur = 0;
  private raf = 0;
  private last = 0;
  private tipTimer = 0;
  private tipIndex = Math.floor(Math.random() * LOADING_TIPS.length);
  private hideTimer = 0;

  constructor(private ctx: MenuCtx) {
    this.bar = h('div', { class: 'mn-load-fill' });
    this.pct = h('div', { class: 'mn-load-pct' }, '0%');
    this.label = h('div', { class: 'mn-load-label' }, 'Loading…');
    this.tipText = h('div', { class: 'mn-load-tip-text' });
    this.tip = h('div', { class: 'mn-load-tip' },
      h('div', { class: 'mn-load-tip-head' }, mIcon('sparkle', 14), h('span', null, 'Tip')), this.tipText);
    this.stage = h('div', { class: 'mn-load-stage' });
    this.el = h('div', { class: 'mn-loading', 'aria-live': 'polite', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      this.stage,
      h('div', { class: 'mn-load-shade' }),
      h('div', { class: 'mn-load-center' },
        h('div', { class: 'mn-load-logo' }, 'URBIS'),
        h('div', { class: 'mn-load-spinner' }, h('i'), h('i'), h('i'))),
      h('div', { class: 'mn-load-bottom' },
        this.tip,
        h('div', { class: 'mn-load-row' }, this.label, this.pct),
        h('div', { class: 'mn-load-track' }, this.bar)));
  }

  get visible(): boolean {
    return this.shown;
  }

  show(text: string, progress: number): void {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    window.clearTimeout(this.hideTimer);
    if (text) this.label.textContent = text;
    if (!this.shown) {
      this.shown = true;
      this.cur = p < 0.05 ? 0 : p;
      this.target = p;
      this.el.classList.remove('out');
      this.el.classList.add('show');
      // the skyline canvas lives wherever it is currently needed
      const sky = this.ctx.sky();
      this.stage.append(sky.canvas);
      sky.setReduced(this.ctx.reduced());
      sky.start();
      this.nextTip(true);
      window.clearInterval(this.tipTimer);
      this.tipTimer = window.setInterval(() => this.nextTip(false), 6500);
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    }
    // progress never runs backwards within one loading session
    this.target = Math.max(this.target, p);
    this.paint();
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.target = 1;
    window.clearInterval(this.tipTimer);
    this.el.classList.add('out');
    const done = () => {
      this.el.classList.remove('show', 'out');
      cancelAnimationFrame(this.raf);
      this.cur = this.target = 0;
      this.paint();
    };
    if (this.ctx.reduced()) done();
    else this.hideTimer = window.setTimeout(done, 520);
  }

  private tick = (t: number): void => {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    // critically damped approach + a tiny creep so the bar never looks stuck
    const k = 1 - Math.exp(-dt * 7);
    this.cur += (this.target - this.cur) * k;
    if (this.shown && this.cur >= this.target - 0.002 && this.cur < 0.985) this.cur = Math.min(this.target + 0.03, this.cur + dt * 0.004);
    this.paint();
    if (this.shown || this.el.classList.contains('out')) this.raf = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    const v = Math.max(0, Math.min(1, this.cur));
    this.bar.style.transform = `scaleX(${v.toFixed(4)})`;
    const n = Math.round(Math.min(1, this.target >= 1 ? v : Math.min(v, 0.99)) * 100);
    this.pct.textContent = `${n}%`;
    this.el.setAttribute('aria-valuenow', String(n));
  }

  private nextTip(immediate: boolean): void {
    this.tipIndex = (this.tipIndex + 1) % LOADING_TIPS.length;
    const text = LOADING_TIPS[this.tipIndex];
    if (immediate || this.ctx.reduced()) {
      this.tipText.textContent = text;
      return;
    }
    this.tip.classList.add('swap');
    window.setTimeout(() => {
      this.tipText.textContent = text;
      this.tip.classList.remove('swap');
    }, 260);
  }
}
