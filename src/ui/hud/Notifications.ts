// Toast stack (top-right) for world notices, chirps (citizen social posts),
// achievement toasts, plain UI toasts and the big milestone celebration.
import { h } from '../dom';
import { formatDate } from '../../core/time';
import { formatMoney, formatNumber } from '../../core/util';
import { MILESTONES } from '../../data/milestones';
import type { AchievementDef, MilestoneDef, Notice, NoticeKind } from '../../core/types';
import type { SfxId } from '../../audio/AudioManager';
import { icon } from './icons';
import { handleOf, initials, nameColor, strHash, type HudContext } from './context';

export type ToastKind = 'info' | 'good' | 'warning' | 'danger';

interface Live {
  el: HTMLElement;
  ttl: number;
  total: number;
  hover: boolean;
  bar: HTMLElement | null;
  notice?: Notice;
  closing: boolean;
}

const KIND_ICON: Record<NoticeKind, string> = {
  info: 'ℹ️', good: '✅', warning: '⚠️', danger: '🚨', chirp: '🐦', milestone: '🏆', achievement: '🏅', event: '✨',
};

const KIND_TTL: Record<NoticeKind, number> = {
  info: 6, good: 6, warning: 9, danger: 12, chirp: 7, milestone: 10, achievement: 8, event: 9,
};

const KIND_SFX: Partial<Record<NoticeKind, SfxId>> = {
  warning: 'warning', danger: 'warning', chirp: 'chirp', event: 'notice', good: 'notice', info: 'notice',
};

const MAX_VISIBLE = 5;
const CONFETTI = ['#ffd76a', '#ff6b8b', '#4cc2ff', '#3ddc84', '#b98cff', '#ff9f43', '#ffffff'];

export class Notifications {
  readonly stack: HTMLElement;
  readonly celebration: HTMLElement;
  private live: Live[] = [];
  private lastMilestoneAt = -1e9;
  private lastAchievementAt = -1e9;
  private bannerTimer = 0;
  private sfxAt = 0;

  constructor(private ctx: HudContext) {
    this.stack = h('div', { class: 'hud-toasts', 'aria-live': 'polite' });
    this.celebration = h('div', { class: 'hud-celebrate' });
  }

  clear(): void {
    for (const l of this.live) l.el.remove();
    this.live = [];
    this.hideCelebration(true);
  }

  // ── entry points ───────────────────────────────────────────────────────
  /** world notice (from the 'notice' event) */
  notice(n: Notice): void {
    const s = this.ctx.game.settings.value;
    if (n.kind === 'chirp' && !s.ui.chirps) return;
    const now = performance.now();
    if (n.kind === 'milestone') {
      // the 'milestone' event already celebrates; plain notice only as fallback
      if (now - this.lastMilestoneAt < 2500) return;
      window.setTimeout(() => {
        if (performance.now() - this.lastMilestoneAt < 2500) return;
        this.add(this.noticeToast(n), KIND_TTL[n.kind], n);
      }, 400);
      return;
    }
    if (n.kind === 'achievement') {
      if (now - this.lastAchievementAt < 2500) return;
      window.setTimeout(() => {
        if (performance.now() - this.lastAchievementAt < 2500) return;
        this.add(this.noticeToast(n), KIND_TTL[n.kind], n);
      }, 400);
      return;
    }
    this.add(n.kind === 'chirp' ? this.chirpToast(n) : this.noticeToast(n), KIND_TTL[n.kind] ?? 7, n);
    const sfx = KIND_SFX[n.kind];
    if (sfx) this.sfx(sfx, n.kind === 'chirp' ? 0.5 : 0.7);
  }

  /** plain UI toast */
  toast(text: string, kind: ToastKind = 'info'): void {
    const el = h('div', { class: `hud-toast mini ${kind}`, role: 'status' },
      h('span', { class: 'hud-toast-mini-icon' }, icon(kind === 'good' ? 'check' : kind === 'info' ? 'info' : 'alert', 15)),
      h('span', { class: 'hud-toast-mini-text' }, text));
    this.add(el, kind === 'danger' ? 6 : 3.6);
  }

  achievement(a: AchievementDef): void {
    this.lastAchievementAt = performance.now();
    const el = h('div', { class: 'hud-toast achievement', role: 'status' },
      h('div', { class: 'hud-ach-medal' }, h('span', null, a.icon || '🏅'), h('i', { class: 'hud-ach-shine' })),
      h('div', { class: 'hud-toast-main' },
        h('div', { class: 'hud-toast-eyebrow' }, 'Achievement unlocked'),
        h('div', { class: 'hud-toast-title' }, a.name),
        h('div', { class: 'hud-toast-text' }, a.description)));
    el.onclick = () => this.ctx.ui.openPanel('milestones', 'achievements');
    this.add(el, 8);
    this.sfx('achievement', 0.9);
  }

  milestone(m: MilestoneDef): void {
    this.lastMilestoneAt = performance.now();
    this.hideCelebration(true);
    const next = MILESTONES[m.index + 1];
    const reduced = this.ctx.game.settings.value.ui.reducedMotion;
    const confetti = h('div', { class: 'hud-confetti' });
    if (!reduced) {
      for (let i = 0; i < 70; i++) {
        const r = strHash(`${m.index}:${i}`);
        const left = (r % 1000) / 10;
        const delay = ((r >>> 10) % 1200) / 1000;
        const dur = 2.6 + ((r >>> 4) % 1600) / 1000;
        const rot = (r >>> 7) % 360;
        const drift = ((r >>> 12) % 200) - 100;
        const color = CONFETTI[(r >>> 3) % CONFETTI.length];
        const shape = (r >>> 5) % 3;
        confetti.appendChild(h('i', {
          class: 'hud-conf s' + shape,
          style: `left:${left}%;--d:${delay}s;--t:${dur}s;--r:${rot}deg;--x:${drift}px;background:${color}`,
        }));
      }
    }
    const card = h('div', { class: 'hud-cel-card hud-pe' },
      h('div', { class: 'hud-cel-rays' }),
      h('div', { class: 'hud-cel-eyebrow' }, h('span', null), 'Milestone reached', h('span', null)),
      h('div', { class: 'hud-cel-title' }, m.name),
      h('div', { class: 'hud-cel-sub' },
        `${formatNumber(m.population)} citizens`,
        m.reward ? h('b', { class: 'hud-cel-reward' }, `+${formatMoney(m.reward)} reward`) : null),
      m.unlocksText.length
        ? h('div', { class: 'hud-cel-unlocks' },
          h('div', { class: 'hud-cel-unlocks-title' }, 'Now available'),
          h('div', { class: 'hud-cel-chips' }, m.unlocksText.map((t) => h('span', { class: 'hud-cel-chip' }, icon('sparkle', 13), t))))
        : null,
      next ? h('div', { class: 'hud-cel-next' }, `Next: ${next.name} at ${formatNumber(next.population)} citizens`) : h('div', { class: 'hud-cel-next' }, 'The final milestone. Eternal glory is yours.'),
      h('div', { class: 'hud-cel-actions' },
        h('button', { class: 'btn', onclick: () => this.hideCelebration() }, 'Continue'),
        h('button', { class: 'btn primary', onclick: () => { this.hideCelebration(); this.ctx.ui.openPanel('milestones'); } }, 'See unlocks')));
    this.celebration.replaceChildren(confetti, card);
    this.celebration.classList.remove('hide');
    requestAnimationFrame(() => this.celebration.classList.add('show'));
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.hideCelebration(), 11000);
    this.sfx('milestone', 1);
  }

  hideCelebration(instant = false): boolean {
    if (!this.celebration.classList.contains('show')) return false;
    window.clearTimeout(this.bannerTimer);
    this.celebration.classList.remove('show');
    if (instant) {
      this.celebration.replaceChildren();
      return true;
    }
    this.celebration.classList.add('hide');
    window.setTimeout(() => {
      if (!this.celebration.classList.contains('show')) {
        this.celebration.replaceChildren();
        this.celebration.classList.remove('hide');
      }
    }, 420);
    return true;
  }

  isCelebrating(): boolean {
    return this.celebration.classList.contains('show');
  }

  update(dt: number): void {
    for (const l of this.live) {
      if (l.closing || l.hover) continue;
      l.ttl -= dt;
      if (l.bar) l.bar.style.transform = `scaleX(${Math.max(0, l.ttl / l.total).toFixed(3)})`;
      if (l.ttl <= 0) this.dismiss(l);
    }
  }

  // ── builders ───────────────────────────────────────────────────────────
  private jumpable(n: Notice): boolean {
    return n.buildingId !== undefined || (n.x !== undefined && n.y !== undefined);
  }

  private noticeToast(n: Notice): HTMLElement {
    const jump = this.jumpable(n);
    const el = h('div', { class: `hud-toast notice k-${n.kind}` + (jump ? ' jump' : ''), role: 'status' },
      h('div', { class: 'hud-toast-icon' }, n.icon || KIND_ICON[n.kind]),
      h('div', { class: 'hud-toast-main' },
        h('div', { class: 'hud-toast-top' },
          h('span', { class: 'hud-toast-title' }, n.title),
          h('span', { class: 'hud-toast-time' }, formatDate(n.day))),
        n.text ? h('div', { class: 'hud-toast-text' }, n.text) : null,
        jump ? h('div', { class: 'hud-toast-jump' }, icon('crosshair', 12), n.buildingId !== undefined ? 'Click to inspect' : 'Click to jump there') : null));
    el.onclick = () => this.activate(n);
    return el;
  }

  private chirpToast(n: Notice): HTMLElement {
    const author = n.author || 'Citizen';
    const likes = 3 + (strHash(`${n.id}:${author}`) % 240);
    const jump = this.jumpable(n);
    const el = h('div', { class: 'hud-toast chirp' + (jump ? ' jump' : ''), role: 'status' },
      h('div', { class: 'hud-avatar', style: `--av:${nameColor(author)}` }, initials(author)),
      h('div', { class: 'hud-toast-main' },
        h('div', { class: 'hud-chirp-head' },
          h('b', null, author),
          h('span', { class: 'hud-chirp-handle' }, handleOf(author)),
          h('span', { class: 'hud-chirp-bird' }, '🐦')),
        h('div', { class: 'hud-chirp-text' }, n.title && n.text ? `${n.text}` : n.text || n.title),
        h('div', { class: 'hud-chirp-foot' },
          h('span', null, '♥ ', String(likes)),
          h('span', null, '↻ ', String(Math.floor(likes / 7))),
          h('span', { class: 'hud-chirp-date' }, formatDate(n.day)))));
    el.onclick = () => this.activate(n);
    return el;
  }

  private activate(n: Notice): void {
    n.read = true;
    if (n.buildingId !== undefined && this.ctx.world()?.getBuilding(n.buildingId)) {
      this.ctx.ui.openBuildingInfo(n.buildingId);
      const b = this.ctx.world()!.getBuilding(n.buildingId)!;
      this.ctx.flyTo(b.x + b.w / 2, b.y + b.h / 2);
    } else if (n.x !== undefined && n.y !== undefined) {
      this.ctx.flyTo(n.x + 0.5, n.y + 0.5);
    }
    this.ctx.sfx('click', 0.6);
    this.ctx.ui.refreshUnread();
    const l = this.live.find((x) => x.notice === n);
    if (l) this.dismiss(l);
  }

  private add(el: HTMLElement, ttl: number, notice?: Notice): void {
    const close = h('button', { class: 'hud-toast-x', 'aria-label': 'Dismiss' }, icon('close', 13));
    const bar = h('i', { class: 'hud-toast-bar' });
    el.append(close, bar);
    el.classList.add('hud-pe');
    const l: Live = { el, ttl, total: ttl, hover: false, bar, notice, closing: false };
    close.onclick = (e) => {
      e.stopPropagation();
      if (notice) notice.read = true;
      this.ctx.ui.refreshUnread();
      this.dismiss(l);
    };
    el.addEventListener('pointerenter', () => (l.hover = true));
    el.addEventListener('pointerleave', () => (l.hover = false));
    // swipe right to dismiss (touch)
    let sx = 0, dx = 0, pid = -1;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      sx = e.clientX;
      dx = 0;
      pid = e.pointerId;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      dx = Math.max(0, e.clientX - sx);
      el.style.transform = `translateX(${dx / this.ctx.scale()}px)`;
      el.style.opacity = String(Math.max(0.2, 1 - dx / 240));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      if (dx > 90) this.dismiss(l);
      else {
        el.style.transform = '';
        el.style.opacity = '';
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.stack.prepend(el);
    this.live.unshift(l);
    requestAnimationFrame(() => el.classList.add('in'));
    // overflow: fade out the oldest
    const open = this.live.filter((x) => !x.closing);
    for (let i = MAX_VISIBLE; i < open.length; i++) this.dismiss(open[i]);
  }

  private dismiss(l: Live): void {
    if (l.closing) return;
    l.closing = true;
    l.el.style.height = `${l.el.offsetHeight}px`;
    l.el.classList.add('out');
    requestAnimationFrame(() => {
      l.el.style.height = '0px';
    });
    window.setTimeout(() => {
      l.el.remove();
      this.live = this.live.filter((x) => x !== l);
    }, 320);
  }

  private sfx(id: SfxId, v: number): void {
    const now = performance.now();
    if (now - this.sfxAt < 250 && id !== 'milestone' && id !== 'achievement') return;
    this.sfxAt = now;
    this.ctx.sfx(id, v);
  }
}
