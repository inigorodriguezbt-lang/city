// Automated checks for the systems module: serialization round trips and
// corruption handling, IndexedDB save flows, command parsing/completion and
// execution, and offline renders of every synthesized sound.
import { FIELD_IDS, BFlag, Dir, ZoneType, type Building } from '../../src/core/types';
import { World } from '../../src/world/World';
import { BUILDINGS } from '../../src/data/buildings';
import { SAVE_VERSION } from '../../src/core/constants';
import {
  SaveFormatError, crc32, decodeSave, deserializeWorld, serializeWorld, SAVED_NOTICES,
} from '../../src/save/serialize';
import { tokenize, parseNumber, parseClock } from '../../src/commands/parse';
import { SFX_IDS, type SfxId } from '../../src/audio/AudioManager';
import { createImpulse, createNoiseBank } from '../../src/audio/dsp';
import { RECIPES, makeSfxEnv } from '../../src/audio/sfx';
import { Music } from '../../src/audio/music';
import { FakeGame, mapSettings } from './fakeGame';

export interface TestResult {
  group: string;
  name: string;
  ok: boolean;
  detail?: string;
}

export class Reporter {
  results: TestResult[] = [];
  onResult: ((r: TestResult) => void) | null = null;
  constructor(public group = '') {}
  check(name: string, ok: boolean, detail?: string): boolean {
    const r = { group: this.group, name, ok, detail };
    this.results.push(r);
    console.log(`${ok ? 'PASS' : 'FAIL'} [${this.group}] ${name}${detail ? ' — ' + detail : ''}`);
    this.onResult?.(r);
    return ok;
  }
  async guard(name: string, fn: () => Promise<boolean | string | void> | boolean | string | void): Promise<void> {
    try {
      const r = await fn();
      if (typeof r === 'string') this.check(name, false, r);
      else this.check(name, r !== false);
    } catch (e) {
      this.check(name, false, `threw ${(e as Error)?.stack ?? e}`);
    }
  }
}

// ── deterministic random world ──────────────────────────────────────────────
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function randomWorld(seed = 7, size = 64): World {
  const r = rng(seed);
  const w = new World(mapSettings({ seed, cityName: `Testville ${seed}` }), size);
  for (let i = 0; i < w.heights.length; i++) w.heights[i] = (r() - 0.3) * 180;
  for (let i = 0; i < w.water.length; i++) w.water[i] = r() < 0.2 ? r() * 20 : -1e4;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    w.road[i] = r() < 0.15 ? 1 + ((r() * 8) | 0) : 0;
    w.roadFlags[i] = w.road[i] ? (r() * 8) | 0 : 0;
    w.zone[i] = w.road[i] ? 0 : (r() * 13) | 0;
    w.trees[i] = (r() * 4) | 0;
    w.district[i] = (r() * 5) | 0;
  }
  for (const f of FIELD_IDS) {
    const a = w.fields[f];
    for (let i = 0; i < n; i++) a[i] = (r() * 256) | 0;
  }
  // buildings (direct occupancy) with awkward ext payloads
  for (let k = 0; k < 120; k++) {
    const x = (r() * (size - 4)) | 0, y = (r() * (size - 4)) | 0;
    const b = w.addBuilding({
      kind: r() < 0.5 ? 'zoned' : 'service', defId: r() < 0.5 ? 'zoned:res_low' : BUILDINGS[(r() * BUILDINGS.length) | 0].id,
      x, y, w: 1 + ((r() * 3) | 0), h: 1 + ((r() * 3) | 0), rot: ((r() * 4) | 0) as Dir,
      zone: ((r() * 13) | 0) as ZoneType, level: 1 + ((r() * 5) | 0), built: r(), age: r() * 900, flags: (r() * 8192) | 0,
      problems: (r() * 1e6) | 0, residents: (r() * 400) | 0, happiness: r() * 100, efficiency: r() * 1.5,
      name: r() < 0.2 ? `Tower “${k}” ✨` : undefined,
      ext: r() < 0.3 ? { nested: { a: [1, 2.5, -0, NaN], b: 'x' }, when: new Date(1_700_000_000_000 + k), inf: Infinity } : undefined,
    });
    b.health = r() * 100;
  }
  w.time = { day: r() * 5000, hour: r() * 24, speed: 2 };
  w.weather = { type: 'storm', intensity: r(), temperature: r() * 30 - 5, windDir: r() * 6, windSpeed: r() * 20, snowCover: r(), nextChange: r() * 9 };
  w.economy.money = r() * 1e6 - 2e5;
  w.economy.taxes.resLow = 0.123456789;
  w.economy.loans = [{ id: 1, amount: 100000, rate: 0.05, remaining: 81234.5, payment: 1450.25, takenDay: 120.5 }];
  w.economy.monthIncome = { residential: 1234.5, commercial: 99.25 };
  w.economy.lastExpense = { roads: 500, policies: 12.75 };
  w.stats.population = 12345;
  w.stats.demand = { res: 0.5, com: -0.25, ind: 0.125, off: -1 };
  for (let i = 0; i < 30; i++) {
    w.history.push({ day: i * 30, population: i * 100, money: r() * 1e5, income: r() * 1e4, expenses: r() * 1e4, happiness: r() * 100, jobs: i * 40, unemployment: r(), crime: r(), pollution: r(), landValue: r(), trafficFlow: r() * 100, demandRes: r(), demandCom: r(), demandInd: r(), demandOff: r() });
  }
  w.districts = [{ id: 1, name: 'Old Town', color: '#ff8800', style: 'european', policies: ['a', 'b'], specialization: 'tourism' }, { id: 2, name: 'Docks', color: '#0088ff', style: null, policies: [] }];
  w.transitLines = [{ id: 1, mode: 'bus', name: 'Line 1', color: '#e33', stops: [{ x: 1, y: 2 }, { x: 5, y: 9 }], vehicles: 3, active: true, ridership: 1234 }];
  w.connections = [{ kind: 'highway', x: 0, y: 10, dir: Dir.W }];
  w.home = { x: 12, y: 34 };
  w.milestone = 5;
  w.unlockAll = true;
  w.unlockedIds = ['stadium', 'opera'];
  w.policies = ['recycling'];
  w.achievements = ['first_road'];
  for (let i = 0; i < 200; i++) w.notify({ kind: 'info', title: `Notice ${i}`, text: 'Hello "world"\n', icon: '📢', x: i, y: i });
  w.activeEvents = [{ id: 3, defId: 'festival', startDay: 12.5, endDay: 15, x: 3, y: 4, data: { crowd: 1200 } }];
  w.nextEventId = 4;
  w.rngState = 0xdeadbeef | 0;
  w.playTime = 3723.25;
  w.createdAt = 1_700_000_000_123;
  w.ext = {
    cheated: true,
    sim: { lastTick: 1234, queue: [1, 2, 3], weights: new Float32Array([0.1, 0.2, NaN]) },
    tags: new Set(['a', 'b']),
    lookup: new Map<string, number>([['x', 1], ['y', -Infinity]]),
    negZero: -0,
    deep: { a: { b: { c: { d: { e: [null, true, 'z'] } } } } },
  };
  return w;
}

// ── deep comparison ─────────────────────────────────────────────────────────
const SKIP = new Set(['bus', 'dirtyLayers', 'dirtyRect']);

export function deepDiff(a: unknown, b: unknown, path = 'world', out: string[] = [], limit = 12): string[] {
  if (out.length >= limit) return out;
  if (Object.is(a, b)) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    out.push(`${path}: ${a} !== ${b}`);
    return out;
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor) {
      out.push(`${path}: typed array type mismatch`);
      return out;
    }
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) out.push(`${path}: length ${x.length} vs ${y.length}`);
    else for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) { out.push(`${path}[${i}]: ${x[i]} !== ${y[i]}`); break; }
    return out;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) { out.push(`${path}: map mismatch`); return out; }
    for (const [k, v] of a) deepDiff(v, b.get(k), `${path}<${String(k)}>`, out, limit);
    return out;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size || [...a].some((v) => !b.has(v))) out.push(`${path}: set mismatch`);
    return out;
  }
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date) || a.getTime() !== b.getTime()) out.push(`${path}: date mismatch`);
    return out;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { out.push(`${path}: array length ${Array.isArray(a) ? a.length : '-'} vs ${Array.isArray(b) ? b.length : '-'}`); return out; }
    for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (path === 'world' && SKIP.has(k)) continue;
      const va = (a as Record<string, unknown>)[k], vb = (b as Record<string, unknown>)[k];
      if (va === undefined && vb === undefined) continue;
      deepDiff(va, vb, `${path}.${k}`, out, limit);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 40)} !== ${JSON.stringify(b)?.slice(0, 40)}`);
  return out;
}

/** compare two worlds; notices of the original are trimmed to what a save keeps */
export function compareWorlds(orig: World, copy: World): string[] {
  const view = Object.create(Object.getPrototypeOf(orig));
  Object.assign(view, orig);
  view.notices = orig.notices.slice(-SAVED_NOTICES);
  return deepDiff(view, copy);
}

// ── suites ──────────────────────────────────────────────────────────────────
export async function testSerialization(rep: Reporter): Promise<void> {
  rep.group = 'serialize';
  for (const seed of [7, 99]) {
    await rep.guard(`round trip is exact (seed ${seed}, gzip)`, async () => {
      const w = randomWorld(seed);
      const bytes = await serializeWorld(w, { meta: { name: 'Round trip' } });
      const copy = await deserializeWorld(bytes);
      const diff = compareWorlds(w, copy);
      return diff.length ? diff.join(' | ') : true;
    });
  }
  await rep.guard('round trip is exact (uncompressed fallback)', async () => {
    const w = randomWorld(3);
    const bytes = await serializeWorld(w, { uncompressed: true });
    if (bytes[6] !== 0) return 'gzip flag set on uncompressed save';
    const diff = compareWorlds(w, await deserializeWorld(bytes));
    return diff.length ? diff.join(' | ') : true;
  });
  await rep.guard('re-serializing a loaded world is byte-stable', async () => {
    const w = randomWorld(11);
    const a = await serializeWorld(w, { uncompressed: true, meta: { savedAt: 1 } });
    const b = await serializeWorld(await deserializeWorld(a), { uncompressed: true, meta: { savedAt: 1 } });
    if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `byte ${i} differs`;
    return true;
  });
  await rep.guard('gzip shrinks a typical map', async () => {
    const w = randomWorld(5, 128);
    w.fields.pollution.fill(0);
    w.trees.fill(1);
    const raw = await serializeWorld(w, { uncompressed: true });
    const gz = await serializeWorld(w);
    console.log(`  size: raw ${(raw.length / 1024).toFixed(0)} KB, gzip ${(gz.length / 1024).toFixed(0)} KB`);
    return gz.length < raw.length * 0.8;
  });
  await rep.guard('header: magic, version, crc', async () => {
    const bytes = await serializeWorld(randomWorld(1));
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    const ver = bytes[4] | (bytes[5] << 8);
    return magic === 'URBS' && ver === SAVE_VERSION && crc32(new Uint8Array([1, 2, 3])) === 0x55bc801d;
  });
  const expectError = async (name: string, mutate: (b: Uint8Array) => Uint8Array, code: string, uncompressed = false) => {
    await rep.guard(name, async () => {
      const good = await serializeWorld(randomWorld(2), { uncompressed });
      try {
        await decodeSave(mutate(good.slice()));
        return 'no error thrown';
      } catch (e) {
        if (!(e instanceof SaveFormatError)) return `wrong error type: ${(e as Error).message}`;
        console.log(`  → “${e.message}”`);
        return e.code === code ? true : `code ${e.code}, expected ${code}`;
      }
    });
  };
  await expectError('rejects non-save files', () => new TextEncoder().encode('PK\u0003\u0004 definitely a zip file'), 'not-a-save');
  await expectError('rejects empty files', () => new Uint8Array(0), 'not-a-save');
  await expectError('rejects saves from a newer version', (b) => { b[4] = 99; return b; }, 'newer-version');
  await expectError('detects truncated gzip data', (b) => b.slice(0, Math.floor(b.length * 0.6)), 'corrupt');
  await expectError('detects truncated raw data', (b) => b.slice(0, Math.floor(b.length * 0.6)), 'truncated', true);
  await expectError('detects flipped bits (checksum)', (b) => { b[Math.floor(b.length * 0.7)] ^= 0x40; return b; }, 'corrupt', true);
  await expectError('detects corrupt gzip stream', (b) => { for (let i = 40; i < 80; i++) b[i] ^= 0x5a; return b; }, 'corrupt');
  await rep.guard('migration hook runs for older versions', async () => {
    // a v1 file read by a v1 build needs no migration, but the frame version is honoured
    const bytes = await serializeWorld(randomWorld(4));
    const d = await decodeSave(bytes);
    return d.fileVersion === SAVE_VERSION && d.doc.version === SAVE_VERSION;
  });
  await rep.guard('huge map serializes in reasonable time', async () => {
    const w = new World(mapSettings(), 512);
    for (let i = 0; i < w.heights.length; i++) w.heights[i] = Math.sin(i * 0.001) * 50;
    const t0 = performance.now();
    const bytes = await serializeWorld(w);
    const t1 = performance.now();
    const back = await deserializeWorld(bytes);
    const t2 = performance.now();
    console.log(`  512² map: save ${(t1 - t0).toFixed(0)} ms, load ${(t2 - t1).toFixed(0)} ms, ${(bytes.length / 1024).toFixed(0)} KB`);
    return back.size === 512 && back.heights[1234] === w.heights[1234];
  });
}

export async function testSaves(rep: Reporter, game: FakeGame): Promise<void> {
  rep.group = 'saves';
  const saves = game.saves;
  await saves.init();
  rep.check(`storage backend: ${saves.storageKind}`, saves.storageKind === 'indexeddb');
  // start clean
  for (const m of await saves.list()) await saves.delete(m.id);
  const world = randomWorld(21);
  world.ext.save = undefined;
  await game.attachWorld(world);
  let firstId = '';
  await rep.guard('save() stores meta + thumbnail and emits game:saved', async () => {
    let emitted = '';
    const off = game.events.on('game:saved', (e) => { emitted = e.id; });
    const meta = await saves.save('Before the flood');
    off();
    if (!meta) return 'save returned null';
    firstId = meta.id;
    if (emitted !== meta.id) return 'game:saved not emitted';
    if (!meta.thumbnail?.startsWith('data:image/jpeg')) return 'missing thumbnail';
    const img = new Image();
    img.src = meta.thumbnail;
    await img.decode();
    if (img.naturalWidth !== 320 || img.naturalHeight !== 180) return `thumbnail ${img.naturalWidth}×${img.naturalHeight}`;
    return meta.cityName === world.settings.cityName && meta.population === 12345 && meta.bytes > 0 && !meta.auto;
  });
  await rep.guard('list() is sorted newest first', async () => {
    await new Promise((r) => setTimeout(r, 5));
    await saves.save('Second');
    const list = await saves.list();
    return list.length === 2 && list[0].name === 'Second' && list[0].savedAt >= list[1].savedAt;
  });
  await rep.guard('load() restores the exact world', async () => {
    const snapshot = await serializeWorld(game.world!, { uncompressed: true });
    const expected = await deserializeWorld(snapshot);
    game.world!.economy.money = -1; // mutate after saving
    const ok = await saves.load(firstId);
    if (!ok) return 'load failed';
    if (game.world === world) return 'world not replaced';
    expected.ext.save = game.world!.ext.save; // bookkeeping written at save time
    const diff = compareWorlds(expected, game.world!);
    return diff.length ? diff.join(' | ') : true;
  });
  await rep.guard('overwriteId replaces a save in place', async () => {
    const before = (await saves.list()).length;
    const m = await saves.save('Before the flood (v2)', { overwriteId: firstId });
    const after = await saves.list();
    return !!m && m.id === firstId && after.length === before && after.some((x) => x.name === 'Before the flood (v2)');
  });
  await rep.guard('quicksave / quickload use one slot per city', async () => {
    await saves.quicksave();
    await saves.quicksave();
    const q = (await saves.list()).filter((m) => m.name === 'Quicksave');
    if (q.length !== 1) return `${q.length} quicksaves`;
    game.world!.economy.money = 42;
    await saves.quickload();
    return game.world!.economy.money !== 42;
  });
  await rep.guard('autosave rotates N slots per city, replacing the oldest', async () => {
    game.settings.set({ gameplay: { autosaveSlots: 2 } });
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
      game.world!.economy.money = 1000 + i;
      await saves.autosave();
    }
    const autos = (await saves.list()).filter((m) => m.auto);
    const names = autos.map((m) => m.name).sort().join(',');
    return autos.length === 2 && names === 'Autosave 1,Autosave 2' ? true : `got ${autos.length}: ${names}`;
  });
  await rep.guard('autosave timer fires after autosaveMinutes (dirty world only)', async () => {
    game.settings.set({ gameplay: { autosaveMinutes: 0.01 } }); // 0.6 s
    const before = (await saves.list()).filter((m) => m.auto).map((m) => m.savedAt).join();
    game.events.emit('money:changed', 1); // mark dirty
    for (let i = 0; i < 8; i++) saves.update(0.1);
    let after = before;
    for (let i = 0; i < 60 && after === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = (await saves.list()).filter((m) => m.auto).map((m) => m.savedAt).join();
    }
    game.settings.set({ gameplay: { autosaveMinutes: 5 } });
    return before !== after;
  });
  await rep.guard('autosave pauses while a menu is open', async () => {
    game.settings.set({ gameplay: { autosaveMinutes: 0.01 } });
    game.menusOpen = true;
    game.events.emit('money:changed', 2);
    const n0 = saves.nextAutosaveIn;
    for (let i = 0; i < 20; i++) saves.update(0.1);
    const same = saves.nextAutosaveIn === n0;
    game.menusOpen = false;
    game.settings.set({ gameplay: { autosaveMinutes: 5 } });
    return same;
  });
  let exported: { name: string; bytes: Uint8Array } | null = null;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download) {
      const name = this.download;
      void fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { exported = { name, bytes: new Uint8Array(b) }; });
      return;
    }
    origClick.call(this);
  };
  await rep.guard('exportSave() downloads a .urbis file', async () => {
    await saves.exportSave(firstId);
    for (let i = 0; i < 40 && !exported; i++) await new Promise((r) => setTimeout(r, 25));
    const ex = exported as { name: string; bytes: Uint8Array } | null;
    return !!ex && ex.name.endsWith('.urbis') && ex.bytes[0] === 0x55 ? true : `got ${ex?.name}`;
  });
  await rep.guard('importFile() validates and stores a new save', async () => {
    const ex = exported as { name: string; bytes: Uint8Array } | null;
    if (!ex) return 'nothing exported';
    const meta = await saves.importFile(new File([ex.bytes as Uint8Array<ArrayBuffer>], ex.name));
    if (!meta) return 'import failed';
    const list = await saves.list();
    return list[0].id === meta.id && meta.id !== firstId && !!meta.thumbnail && meta.cityName === 'Testville 21';
  });
  await rep.guard('importFile() rejects garbage with a friendly toast', async () => {
    const n = game.log.toasts.length;
    const meta = await saves.importFile(new File([new TextEncoder().encode('hello world, not a city')], 'notes.txt'));
    const t = game.log.toasts.slice(n).find((x) => x.kind === 'danger');
    console.log(`  → toast: ${t?.text}`);
    return meta === null && !!t && /not an URBIS save/.test(t.text);
  });
  exported = null;
  await rep.guard('exportCurrent() downloads the live city', async () => {
    await saves.exportCurrent();
    for (let i = 0; i < 40 && !exported; i++) await new Promise((r) => setTimeout(r, 25));
    const ex = exported as { name: string; bytes: Uint8Array } | null;
    if (!ex) return 'nothing downloaded';
    const back = await deserializeWorld(ex.bytes);
    return ex.name === 'Testville 21.urbis' && back.size === game.world!.size;
  });
  HTMLAnchorElement.prototype.click = origClick;
  await rep.guard('load() of a missing id fails gracefully', async () => {
    const ok = await saves.load('does-not-exist');
    return ok === false && !!game.world;
  });
  await rep.guard('rename() and delete()', async () => {
    const r = await saves.rename(firstId, 'Renamed');
    await saves.delete(firstId);
    const list = await saves.list();
    return !!r && r.name === 'Renamed' && !list.some((m) => m.id === firstId);
  });
}

export async function testCommands(rep: Reporter, game: FakeGame): Promise<void> {
  rep.group = 'parse';
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  rep.check('tokenize quotes & escapes', eq(tokenize('give "my \\"big\\" city" x').tokens, ['give', 'my "big" city', 'x']));
  rep.check('tokenize trailing space', tokenize('tp ').trailingSpace && tokenize('tp').tokens.length === 1);
  rep.check('tokenize open quote', eq(tokenize('load "Auto sa').tokens, ['load', 'Auto sa']) && tokenize('load "Auto sa').openQuote);
  rep.check('numbers: 10k, $2.5M, 1e3, -40', parseNumber('10k') === 10000 && parseNumber('$2.5M') === 2.5e6 && parseNumber('1e3') === 1000 && parseNumber('-40') === -40 && Number.isNaN(parseNumber('abc')));
  rep.check('clock: 18:30, 7pm, 24', parseClock('18:30') === 18.5 && parseClock('7pm') === 19 && parseClock('24') === 0 && Number.isNaN(parseClock('25:00')));

  rep.group = 'commands';
  const cmd = game.commands;
  cmd.init();
  const w = randomWorld(31);
  w.ext = {};
  // tidy a free area for placements
  for (let y = 16; y < 40; y++) for (let x = 16; x < 40; x++) { const i = w.idx(x, y); w.road[i] = 0; }
  for (const b of [...w.buildings.values()]) w.removeBuilding(b.id);
  const aband = w.addBuilding({ kind: 'zoned', defId: 'zoned:res_low', x: 2, y: 2, w: 1, h: 1, rot: Dir.S, zone: ZoneType.ResLow, flags: BFlag.Abandoned });
  const hall = w.addBuilding({ kind: 'service', defId: BUILDINGS[0].id, x: 50, y: 50, w: 1, h: 1, rot: Dir.S, name: 'Grand Hall' });
  await game.attachWorld(w);
  const last = () => game.log.chat[game.log.chat.length - 1]?.text ?? '';
  const printed = (re: RegExp, since: number) => game.log.chat.slice(since).some((l) => re.test(l.text));
  const run = async (line: string) => {
    const n = game.log.chat.length;
    await cmd.execute(line);
    return n;
  };

  await rep.guard('/help lists every category', async () => {
    const n = await run('/help');
    return printed(/CHEATS/, n) && printed(/\/locate/, n) && printed(/\/give/, n);
  });
  await rep.guard('/help give shows usage & examples', async () => {
    const n = await run('help give');
    return printed(/Usage/, n) && printed(/250k/, n);
  });
  await rep.guard('unknown command suggests the closest', async () => {
    const n = await run('/giv money 5');
    return printed(/Did you mean \/give/, n);
  });
  await rep.guard('/give money 10k (cheat notice once)', async () => {
    const m0 = w.economy.money;
    const n = await run('/give money 10k');
    const firstNotice = printed(/\(cheat\)/, n);
    const n2 = await run('/GIVE MONEY 5');
    return w.economy.money === m0 + 10005 && w.ext.cheated === true && firstNotice && !printed(/\(cheat\)/, n2);
  });
  await rep.guard('/give money abc → usage', async () => {
    const n = await run('/give money abc');
    return printed(/^Usage: \/give/, n);
  });
  await rep.guard('/give unlockall', async () => { await run('/give unlockall'); return w.unlockAll; });
  await rep.guard('/give milestone 4', async () => { w.milestone = 0; await run('/give milestone 4'); return w.milestone === 4; });
  await rep.guard('/give residents 500', async () => { const p = w.stats.population; await run('/give residents 500'); return w.stats.population === p + 500; });
  await rep.guard('/give building <id> x y places a finished building for free', async () => {
    const money = w.economy.money;
    const def = BUILDINGS.find((d) => d.w === 2 && d.h === 2) ?? BUILDINGS[0];
    const n = await run(`/give building ${def.id} 24 24`);
    const b = w.buildingAt(24, 24);
    return !!b && b.defId === def.id && b.built === 1 && !(b.flags & BFlag.UnderConstruction) && w.economy.money === money && printed(/placed at/, n);
  });
  await rep.guard('/give building near the camera (spiral search)', async () => {
    game.renderer.cameraCtl.flyTo(24.5, 24.5);
    const n = await run(`/give building ${BUILDINGS[1].id}`);
    return printed(/placed at/, n);
  });
  await rep.guard('/tp x y, /tp home, /tp #id, /tp name', async () => {
    await run('/tp 10 12');
    const a = game.log.flights.at(-1)!;
    await run('/tp home');
    const b = game.log.flights.at(-1)!;
    await run(`/tp ${hall.id}`);
    const c = game.log.flights.at(-1)!;
    await run('/tp grand');
    const d = game.log.flights.at(-1)!;
    await run('/tp ~5 ~-2');
    const e = game.log.flights.at(-1)!;
    return a.x === 10.5 && a.y === 12.5 && b.x === w.home.x + 0.5 && c.x === 50.5 && d.x === 50.5 && e.x === Math.floor(d.x) + 5.5 && e.y === Math.floor(d.y) - 2 + 0.5;
  });
  await rep.guard('/tp out of bounds → friendly error', async () => {
    const n = await run('/tp 9999 3');
    return printed(/outside the map/, n);
  });
  await rep.guard('/locate category + /locate next cycles', async () => {
    const n = await run('/locate abandoned');
    const ok1 = printed(/Found 1 × abandoned/, n);
    const n2 = await run('/locate next');
    return ok1 && printed(/1\/1/, n2) && game.log.flights.at(-1)!.x === aband.x + 0.5;
  });
  await rep.guard('/locate by defId', async () => {
    const n = await run(`/locate ${BUILDINGS[0].id}`);
    return printed(/Found \d+ ×/, n);
  });
  await rep.guard('/time set 18:30 · dusk · speed · add', async () => {
    await run('/time set 18:30');
    const h1 = w.time.hour;
    await run('/time set dusk');
    const h2 = w.time.hour;
    await run('/time speed 3');
    const sp = w.time.speed;
    const d0 = w.time.day;
    await run('/time add 5');
    return Math.abs(h1 - 18.5) < 1e-9 && Math.abs(h2 - 19.7) < 1e-9 && sp === 3 && Math.round(w.time.day - d0) === 5;
  });
  await rep.guard('/speed pause and 10x', async () => {
    await run('/speed pause');
    const a = w.time.speed;
    await run('/speed 10x');
    return a === 0 && w.time.speed === 4;
  });
  await rep.guard('/weather storm 2', async () => {
    await run('/weather storm 2');
    const l = game.log.weather.at(-1);
    return l?.type === 'storm' && l.days === 2;
  });
  await rep.guard('/weather sunny → error', async () => { const n = await run('/weather sunny'); return printed(/Unknown weather/, n); });
  await rep.guard('/season /stats /budget /seed /fps /where print info', async () => {
    const n = await run('/season');
    await run('/stats');
    await run('/budget');
    await run('/seed');
    await run('/fps');
    await run('/where');
    return printed(/Next season/, n) && printed(/Population/, n) && printed(/Income/, n) && printed(/Seed/, n) && printed(/FPS/, n) && printed(/Cell/, n);
  });
  await rep.guard('/summon tornado at camera, /summon ufo 5 6', async () => {
    await run('/summon tornado');
    const a = game.log.triggers.at(-1)!;
    await run('/summon ufo 5 6');
    const b = game.log.triggers.at(-1)!;
    const n = await run('/summon dragon');
    return a.id === 'tornado' && !!a.at && b.at?.x === 5 && b.at?.y === 6 && printed(/Unknown event/, n);
  });
  await rep.guard('/creative on|off, /disasters off', async () => {
    await run('/creative on');
    const c1 = w.creative;
    await run('/creative off');
    await run('/disasters off');
    return c1 && !w.creative && !w.settings.disasters;
  });
  await rep.guard('/fill res_low x0 y0 x1 y1', async () => {
    const n = await run('/fill res_low 30 30 33 33');
    return w.zoneAt(31, 31) === ZoneType.ResLow && printed(/Zoned Low Density Residential/, n);
  });
  await rep.guard('/bulldoze abandoned', async () => {
    await run('/bulldoze abandoned');
    return !w.buildings.has(aband.id);
  });
  await rep.guard('/kill vehicles', async () => { const n = await run('/kill vehicles'); return printed(/Cleared 37 vehicles/, n); });
  await rep.guard('/overlay pollution, /overlay land value, /overlay off', async () => {
    await run('/overlay pollution');
    await run('/overlay land value');
    await run('/overlay off');
    const o = game.log.overlays.slice(-3);
    return o[0] === 'pollution' && o[1] === 'landValue' && o[2] === null;
  });
  await rep.guard('/save "Cmd Save" then /load cmd', async () => {
    await run('/save "Cmd Save"');
    const saved = (await game.saves.list()).find((m) => m.name === 'Cmd Save');
    const n = await run('/load cmd');
    return !!saved && printed(/Loaded “Cmd Save”/, n);
  });
  await rep.guard('/clear empties the log', async () => { await run('/clear'); return game.log.chat.length === 0; });
  await rep.guard('history records lines', async () => cmd.history.at(-1) === '/clear' && cmd.history.includes('/give money 10k'));
  // completion
  const has = (line: string, ...want: string[]) => {
    const got = cmd.complete(line);
    const ok = want.every((x) => got.includes(x));
    if (!ok) console.log(`  complete(${JSON.stringify(line)}) → ${JSON.stringify(got.slice(0, 10))}`);
    return ok;
  };
  rep.group = 'complete';
  rep.check('command names', has('/gi', '/give') && has('/', '/help', '/tp') && cmd.complete('/gi')[0] === '/give');
  rep.check('no slash', has('wea', 'weather'));
  rep.check('sub-commands', has('/give m', '/give money', '/give milestone'));
  rep.check('building ids', cmd.complete(`/give building ${BUILDINGS[0].id.slice(0, 4)}`).includes(`/give building ${BUILDINGS[0].id}`));
  rep.check('weather types', has('/weather s', '/weather storm', '/weather snow'));
  rep.check('time keywords', has('/time set d', '/time set dusk', '/time set dawn', '/time set day'));
  rep.check('event ids', has('/summon tor', '/summon tornado'));
  rep.check('zone ids', has('/fill res', '/fill res_low', '/fill res_high'));
  rep.check('save names (quoted)', has('/load "Cmd', '/load "Cmd Save"') && has('/load Cmd', '/load "Cmd Save"'));
  rep.check('player-facing names', has('/tp Gra', '/tp "Grand Hall"'));
  rep.check('overlay ids', has('/overlay poll', '/overlay pollution'));
  rep.check('help topics', has('/help lo', '/help locate', '/help load'));
}

// ── audio (offline renders) ─────────────────────────────────────────────────
export interface SfxRender {
  id: SfxId;
  peak: number;
  rms: number;
  duration: number;
  data: Float32Array;
}

export async function renderSfx(id: SfxId, sr = 22050, seconds = 5): Promise<SfxRender> {
  const ctx = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const verb = ctx.createConvolver();
  verb.buffer = createImpulse(ctx, 1.8, { decay: 3 });
  verb.connect(ctx.destination);
  const env = makeSfxEnv({ ctx: ctx as unknown as AudioContext, dry: ctx.destination, wet: verb }, createNoiseBank(ctx));
  const end = RECIPES[id](env, 0.02, 1, {});
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const data = new Float32Array(L.length);
  let peak = 0, sum = 0, lastLoud = 0;
  for (let i = 0; i < L.length; i++) {
    const v = (L[i] + R[i]) * 0.5;
    data[i] = v;
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (!Number.isFinite(a)) return { id, peak: NaN, rms: NaN, duration: 0, data };
    if (a > peak) peak = a;
    if (a > 0.003) lastLoud = i;
    sum += v * v;
  }
  return { id, peak, rms: Math.sqrt(sum / L.length), duration: Math.max(end, lastLoud / sr), data };
}

export async function renderMusic(seconds = 40, sr = 22050, mood: 'menu' | 'day' | 'night' = 'day'): Promise<{ peak: number; rms: number; data: Float32Array }> {
  const ctx = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const verb = ctx.createConvolver();
  verb.buffer = createImpulse(ctx, 3.5, { decay: 2.6 });
  verb.connect(ctx.destination);
  const r = { ctx: ctx as unknown as AudioContext, dry: ctx.destination, wet: verb };
  const m = new Music(r, makeSfxEnv(r, createNoiseBank(ctx)));
  m.setMood(mood);
  m.start();
  m.scheduleUntil(seconds - 1);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const data = new Float32Array(L.length);
  let peak = 0, sum = 0;
  for (let i = 0; i < L.length; i++) {
    const v = (L[i] + R[i]) * 0.5;
    data[i] = v;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / L.length), data };
}

export async function testAudio(rep: Reporter, onRender?: (r: SfxRender) => void): Promise<void> {
  rep.group = 'audio';
  for (const id of SFX_IDS) {
    await rep.guard(`sfx “${id}” renders cleanly`, async () => {
      const r = await renderSfx(id);
      onRender?.(r);
      const db = 20 * Math.log10(r.peak);
      console.log(`  ${id.padEnd(12)} peak ${db.toFixed(1)} dBFS · ${r.duration.toFixed(2)} s`);
      if (!Number.isFinite(r.peak)) return 'NaN samples';
      if (r.peak < 0.01) return `too quiet (${db.toFixed(1)} dB)`;
      if (r.peak > 1.2) return `clipping (${db.toFixed(1)} dB)`;
      return true;
    });
  }
  for (const mood of ['menu', 'day', 'night'] as const) {
    await rep.guard(`music “${mood}” renders 30 s cleanly`, async () => {
      const r = await renderMusic(30, 16000, mood);
      console.log(`  music ${mood}: peak ${(20 * Math.log10(r.peak)).toFixed(1)} dBFS, rms ${(20 * Math.log10(r.rms)).toFixed(1)} dBFS`);
      return Number.isFinite(r.peak) && r.peak > 0.02 && r.peak < 1.2 && r.rms > 0.003;
    });
  }
}

export type { Building };
