// Key rebinding table for Options → Controls: every ACTIONS entry grouped by
// category with two binding slots rendered as keycaps. Clicking a slot waits
// for the next key through game.input.captureNextKey(); Escape cancels,
// Backspace/Delete clears, conflicts offer Swap / Keep both / Cancel.
import { h } from '../dom';
import { ACTIONS, DEFAULT_KEYBINDS, type ActionId, type Settings } from '../../settings/types';
import type { MenuCtx } from './ctx';
import { mIcon, type MenuIcon } from './icons';
import { canonicalCombo, comboConflicts, comboLabel, comboParts } from './format';
import { btn, kbd } from './widgets';

interface Group {
  id: string;
  title: string;
  icon: MenuIcon;
  prefix: string;
}

const GROUPS: Group[] = [
  { id: 'camera', title: 'Camera', icon: 'camera', prefix: 'camera.' },
  { id: 'game', title: 'Simulation', icon: 'clock', prefix: 'game.' },
  { id: 'tool', title: 'Tools', icon: 'hand', prefix: 'tool.' },
  { id: 'edit', title: 'Editing', icon: 'reset', prefix: 'edit.' },
  { id: 'ui', title: 'Interface', icon: 'layout', prefix: 'ui.' },
];

const SLOTS = 2;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => canonicalCombo(x) === canonicalCombo(b[i]));
}

export interface KeybindTable {
  el: HTMLElement;
  sync(s: Settings): void;
  /** cancel a pending capture (dialog closing) */
  dispose(): void;
}

export function buildKeybindTable(ctx: MenuCtx): KeybindTable {
  const store = ctx.game.settings;
  const binds = () => store.value.controls.keybinds;
  const rows = new Map<ActionId, { el: HTMLElement; slots: HTMLButtonElement[]; reset: HTMLButtonElement; panel: HTMLElement }>();
  let capturing: { action: ActionId; slot: number } | null = null;
  let captureSeq = 0;
  let filter = '';

  const filterInput = h('input', { type: 'search', placeholder: 'Filter actions or keys…', 'aria-label': 'Filter key bindings', spellcheck: 'false' }) as HTMLInputElement;
  filterInput.addEventListener('input', () => {
    filter = filterInput.value.trim().toLowerCase();
    applyFilter();
  });
  const resetAll = btn(ctx, 'Reset all keys', {
    icon: 'reset', kind: 'ghost', size: 'sm',
    onClick: () => void (async () => {
      const ok = await ctx.confirm('Reset every key binding?', 'All actions go back to their default keys.', { ok: 'Reset keys', danger: true, icon: 'keyboard' });
      if (ok) {
        store.setKeybinds(structuredClone(DEFAULT_KEYBINDS));
        ctx.notify('Key bindings reset to defaults.', 'good');
      }
    })(),
  });

  const table = h('div', { class: 'mn-kb' });
  for (const g of GROUPS) {
    const actions = (Object.keys(ACTIONS) as ActionId[]).filter((a) => a.startsWith(g.prefix));
    if (!actions.length) continue;
    const body = h('div', { class: 'mn-kb-rows', 'data-nav': 'grid' });
    for (const a of actions) body.append(buildRow(a));
    table.append(h('div', { class: 'mn-kb-group', 'data-group': g.id },
      h('div', { class: 'mn-kb-head' },
        h('span', { class: 'mn-kb-title' }, mIcon(g.icon, 15), h('span', null, g.title)),
        h('span', { class: 'mn-kb-col' }, 'Primary'), h('span', { class: 'mn-kb-col' }, 'Secondary'), h('span')),
      body));
  }
  const empty = h('div', { class: 'mn-empty small', hidden: true }, mIcon('search', 22), h('span', null, 'No action matches this filter.'));

  const el = h('div', { class: 'mn-kb-wrap' },
    h('div', { class: 'mn-kb-tools' },
      h('label', { class: 'mn-search' }, mIcon('search', 15), filterInput),
      h('span', { class: 'mn-grow' }),
      resetAll),
    h('div', { class: 'mn-kb-legend' },
      h('span', null, 'Click a key to rebind'), h('span', { class: 'mn-dot' }),
      kbd('Esc'), h('span', null, 'cancel'), h('span', { class: 'mn-dot' }),
      kbd('Backspace'), h('span', null, 'clear')),
    table, empty);

  function buildRow(a: ActionId): HTMLElement {
    const slots: HTMLButtonElement[] = [];
    for (let i = 0; i < SLOTS; i++) {
      const b = h('button', { class: 'mn-kslot', type: 'button', 'aria-label': `${ACTIONS[a]} — ${i === 0 ? 'primary' : 'secondary'} key` });
      b.addEventListener('click', () => void capture(a, i));
      b.addEventListener('keydown', (e) => {
        if ((e.key === 'Backspace' || e.key === 'Delete') && !capturing) {
          e.preventDefault();
          e.stopPropagation();
          clearSlot(a, i);
        }
      });
      slots.push(b);
    }
    const reset = btn(ctx, null, { icon: 'reset', kind: 'ghost', size: 'sm', title: 'Reset to default', onClick: () => {
      store.resetKeybind(a);
      ctx.notify(`“${ACTIONS[a]}” reset to default.`, 'info');
    } });
    reset.classList.add('mn-kb-reset');
    const panel = h('div', { class: 'mn-kb-conflict', hidden: true });
    const el = h('div', { class: 'mn-kb-row' },
      h('span', { class: 'mn-kb-label' }, ACTIONS[a]),
      slots[0], slots[1], reset, panel);
    el.dataset.action = a;
    rows.set(a, { el, slots, reset, panel });
    paintRow(a);
    return el;
  }

  function paintRow(a: ActionId): void {
    const r = rows.get(a);
    if (!r) return;
    const list = binds()[a] ?? [];
    r.slots.forEach((b, i) => {
      const combo = list[i];
      b.classList.remove('capturing', 'conflict');
      b.replaceChildren();
      if (capturing && capturing.action === a && capturing.slot === i) {
        b.classList.add('capturing');
        b.append(h('span', { class: 'mn-kslot-wait' }, h('i'), 'Press a key…'));
        return;
      }
      if (!combo) {
        b.classList.add('empty');
        b.append(h('span', { class: 'mn-kslot-empty' }, mIcon('plus', 12), 'Add'));
        return;
      }
      b.classList.remove('empty');
      b.append(h('span', { class: 'mn-kcombo' }, ...comboParts(combo).map((p) => kbd(p))));
      const others = comboConflicts(binds(), combo, a);
      if (others.length) {
        b.classList.add('conflict');
        b.title = `Also bound to: ${others.map((o) => ACTIONS[o]).join(', ')}`;
      } else b.removeAttribute('title');
    });
    const def = DEFAULT_KEYBINDS[a] ?? [];
    const modified = !sameList(list, def);
    r.el.classList.toggle('mod', modified);
    r.reset.disabled = !modified;
    r.reset.style.visibility = modified ? 'visible' : 'hidden';
  }

  function paintAll(): void {
    for (const a of rows.keys()) paintRow(a);
  }

  function applyFilter(): void {
    let any = false;
    for (const g of Array.from(table.children) as HTMLElement[]) {
      let groupAny = false;
      for (const rowEl of Array.from(g.querySelectorAll<HTMLElement>('.mn-kb-row'))) {
        const a = rowEl.dataset.action as ActionId;
        const keys = (binds()[a] ?? []).map((k) => comboLabel(k)).join(' ').toLowerCase();
        const show = !filter || ACTIONS[a].toLowerCase().includes(filter) || a.includes(filter) || keys.includes(filter);
        rowEl.hidden = !show;
        if (show) groupAny = true;
      }
      g.hidden = !groupAny;
      if (groupAny) any = true;
    }
    empty.hidden = any;
  }

  function hidePanel(a: ActionId): void {
    const r = rows.get(a);
    if (!r) return;
    r.panel.hidden = true;
    r.panel.replaceChildren();
    r.el.classList.remove('has-conflict');
  }

  function write(a: ActionId, list: string[], extra: Partial<Record<ActionId, string[]>> = {}): void {
    const clean: string[] = [];
    for (const k of list) if (k && !clean.some((c) => canonicalCombo(c) === canonicalCombo(k))) clean.push(k);
    store.setKeybinds({ ...extra, [a]: clean.slice(0, SLOTS) });
  }

  function clearSlot(a: ActionId, slot: number): void {
    const list = [...(binds()[a] ?? [])];
    if (!list[slot]) return;
    list.splice(slot, 1);
    ctx.sfx('bulldoze', 0.35);
    write(a, list);
  }

  async function capture(a: ActionId, slot: number): Promise<void> {
    const input = ctx.game.input;
    for (const k of rows.keys()) hidePanel(k);
    capturing = { action: a, slot };
    const seq = ++captureSeq;
    paintAll();
    ctx.sfx('open', 0.5);
    let combo: string | null = null;
    try {
      combo = await input.captureNextKey();
    } catch {
      combo = null;
    }
    if (seq !== captureSeq) return; // superseded by another capture
    capturing = null;
    paintAll();
    rows.get(a)?.slots[slot]?.focus({ preventScroll: true });
    if (!combo) {
      ctx.sfx('close', 0.5);
      return;
    }
    if (combo === 'Backspace' || combo === 'Delete') {
      clearSlot(a, slot);
      return;
    }
    const list = [...(binds()[a] ?? [])];
    const cur = list[slot];
    if (cur && canonicalCombo(cur) === canonicalCombo(combo)) return;
    const otherIdx = list.findIndex((k, i) => i !== slot && canonicalCombo(k) === canonicalCombo(combo!));
    if (otherIdx >= 0) {
      // already the other slot of this action: swap the two slots
      [list[slot], list[otherIdx]] = [list[otherIdx], list[slot]];
      write(a, list.filter(Boolean));
      ctx.sfx('click', 0.6);
      return;
    }
    const conflicts = comboConflicts(binds(), combo, a);
    const assign = () => {
      const next = [...(binds()[a] ?? [])];
      if (slot < next.length) next[slot] = combo!;
      else next.push(combo!);
      return next;
    };
    if (!conflicts.length) {
      write(a, assign());
      ctx.sfx('place', 0.5);
      return;
    }
    // conflict: offer Swap / Keep both / Cancel inline
    const r = rows.get(a)!;
    const names = conflicts.map((c) => `“${ACTIONS[c]}”`).join(', ');
    const swapLabel = !cur ? 'Move key here' : conflicts.length === 1 ? `Swap — ${ACTIONS[conflicts[0]]} gets ${comboLabel(cur)}` : `Swap — they get ${comboLabel(cur)}`;
    const swap = btn(ctx, swapLabel, {
      icon: 'swap', kind: 'primary', size: 'sm',
      onClick: () => {
        const extra: Partial<Record<ActionId, string[]>> = {};
        for (const c of conflicts) {
          const theirs = [...(binds()[c] ?? [])];
          const idx = theirs.findIndex((k) => canonicalCombo(k) === canonicalCombo(combo!));
          if (idx < 0) continue;
          if (cur && !theirs.some((k) => canonicalCombo(k) === canonicalCombo(cur))) theirs[idx] = cur;
          else theirs.splice(idx, 1);
          extra[c] = theirs;
        }
        hidePanel(a);
        write(a, assign(), extra);
        ctx.sfx('place', 0.5);
      },
    });
    const both = btn(ctx, 'Keep both', { kind: 'soft', size: 'sm', onClick: () => {
      hidePanel(a);
      write(a, assign());
    } });
    const cancel = btn(ctx, 'Cancel', { kind: 'ghost', size: 'sm', onClick: () => hidePanel(a) });
    r.panel.replaceChildren(
      h('span', { class: 'mn-kb-conflict-msg' }, mIcon('alert', 15),
        h('span', null, h('b', null, comboLabel(combo)), ` is already used by ${names}.`)),
      h('span', { class: 'mn-kb-conflict-actions' }, swap, both, cancel));
    r.panel.hidden = false;
    r.el.classList.add('has-conflict');
    ctx.sfx('warning', 0.5);
    swap.focus({ preventScroll: true });
  }

  return {
    el,
    sync: () => {
      paintAll();
      if (filter) applyFilter();
    },
    dispose: () => {
      if (!capturing) return;
      captureSeq++;
      capturing = null;
      paintAll();
      // resolve the pending capture: InputManager treats Escape as "cancel" and
      // swallows the event, so nothing else reacts to this synthetic key
      const input = ctx.game.input as unknown as { capturing?: boolean };
      if (input.capturing !== false) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      }
    },
  };
}
