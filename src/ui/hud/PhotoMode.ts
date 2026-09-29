// Photo mode: hides the HUD and shows a compact photo toolbar
// (time of day, tilt-shift, field of view, screenshot, exit).
import { h, isolate } from '../dom';
import { formatHour } from '../../core/time';
import { icon } from './icons';
import { toggle } from '../panels/widgets';
import { setText, type HudContext } from './context';

export class PhotoMode {
  readonly el: HTMLElement;
  active = false;
  private hour: HTMLInputElement;
  private hourVal: HTMLElement;
  private fov: HTMLInputElement;
  private fovVal: HTMLElement;
  private tilt: ReturnType<typeof toggle>;
  private idle = 0;
  private dragging = false;

  constructor(private ctx: HudContext) {
    this.hour = h('input', { type: 'range', min: '0', max: '24', step: '0.05', class: 'hud-range' });
    this.hourVal = h('span', { class: 'hud-photo-val' });
    this.hour.addEventListener('input', () => {
      const v = Number(this.hour.value);
      ctx.game.sim.setHour(v);
      this.paint();
    });
    this.fov = h('input', { type: 'range', min: '30', max: '100', step: '1', class: 'hud-range' });
    this.fovVal = h('span', { class: 'hud-photo-val' });
    this.fov.addEventListener('input', () => {
      ctx.game.settings.set({ graphics: { fov: Number(this.fov.value) } });
      this.paint();
    });
    for (const r of [this.hour, this.fov]) {
      r.addEventListener('pointerdown', () => (this.dragging = true));
      r.addEventListener('keydown', (e) => e.stopPropagation());
    }
    window.addEventListener('pointerup', () => (this.dragging = false));
    this.tilt = toggle(false, (v) => ctx.game.settings.set({ graphics: { tiltShift: v } }), 'Tilt-shift');

    const shot = h('button', { class: 'hud-photo-shot', 'aria-label': 'Take screenshot', onclick: () => void this.capture() }, icon('camera', 22));
    ctx.tips.attach(shot, 'Take screenshot', { key: () => ctx.key('ui.screenshot') });
    const exit = h('button', { class: 'hud-photo-exit', onclick: () => ctx.ui.setPhotoMode(false) }, icon('close', 16), h('span', null, 'Exit'));
    ctx.tips.attach(exit, 'Leave photo mode', { key: () => ctx.key('ui.photoMode') || 'P' });
    const hide = h('button', { class: 'hud-photo-hide', 'aria-label': 'Hide controls', onclick: () => this.el.classList.add('ghost') }, icon('eye', 16));
    ctx.tips.attach(hide, 'Hide these controls (move the mouse to bring them back)');

    this.el = isolate(h('div', { class: 'hud-photo hud-pe', 'aria-label': 'Photo mode' },
      h('div', { class: 'hud-photo-brand' }, icon('aperture', 18), h('span', null, 'Photo mode')),
      h('label', { class: 'hud-photo-ctl wide' }, h('span', { class: 'hud-photo-lab' }, icon('clock', 14), 'Time'), this.hour, this.hourVal),
      h('label', { class: 'hud-photo-ctl' }, h('span', { class: 'hud-photo-lab' }, icon('fov', 14), 'FOV'), this.fov, this.fovVal),
      h('div', { class: 'hud-photo-ctl tilt' }, h('span', { class: 'hud-photo-lab' }, icon('tiltshift', 14), 'Tilt-shift'), this.tilt.el),
      shot, hide, exit));
    window.addEventListener('pointermove', () => {
      if (!this.active) return;
      this.idle = 0;
      this.el.classList.remove('ghost', 'idle');
    });
  }

  enter(): void {
    const w = this.ctx.world();
    if (!w || this.active) return;
    this.active = true;
    this.idle = 0;
    this.sync();
    this.el.classList.remove('ghost', 'idle');
    this.el.classList.add('show');
    this.ctx.game.tools.cancel();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove('show');
  }

  update(dt: number): void {
    if (!this.active) return;
    this.idle += dt;
    if (this.idle > 4 && !this.dragging) this.el.classList.add('idle');
    if (!this.dragging && document.activeElement !== this.hour) {
      const w = this.ctx.world();
      if (w && Math.abs(Number(this.hour.value) - w.time.hour) > 0.04) {
        this.hour.value = String(w.time.hour);
        this.paint();
      }
    }
  }

  sync(): void {
    const w = this.ctx.world();
    const s = this.ctx.game.settings.value;
    if (w) this.hour.value = String(w.time.hour);
    this.fov.value = String(s.graphics.fov);
    this.tilt.set(s.graphics.tiltShift);
    this.paint();
  }

  private paint(): void {
    const s = this.ctx.game.settings.value;
    const hv = Number(this.hour.value);
    setText(this.hourVal, formatHour(hv, s.ui.clock24h));
    setText(this.fovVal, `${this.fov.value}°`);
    this.hour.style.setProperty('--fill', `${((hv / 24) * 100).toFixed(1)}%`);
    this.fov.style.setProperty('--fill', `${(((Number(this.fov.value) - 30) / 70) * 100).toFixed(1)}%`);
  }

  private async capture(): Promise<void> {
    this.el.classList.add('flash-hide');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await this.ctx.game.downloadScreenshot();
    } finally {
      this.el.classList.remove('flash-hide');
      this.ctx.ui.flash();
    }
  }
}
