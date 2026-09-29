// Chunk geometry builder: turns the road cells of one 32×32 chunk into a
// single merged mesh (one draw call, one material) plus furniture instances.
//
// Every road cell becomes one of a few piece shapes derived from its
// geometric connection mask:
//   straight (2 opposite)   – row-based cross-section, width tapers between types
//   curve    (2 adjacent)   – the same section swept along a 90° arc
//   dead end (1)            – straight stem + round cul-de-sac bulb
//   isolated (0)            – round plaza
//   junction (3–4)          – four corner quadrants (rounded curbs) + open box
// Rail uses its own ballast section; bridges swap verges for parapets, add a
// deck underside, piers, abutments and railings; everything samples heights
// from RoadHeightField so decks, ramps and terrain-following surfaces match
// the drivable surface exactly.
import type * as THREE from 'three';
import { CELL } from '../../core/constants';
import { hash2 } from '../../core/rng';
import { DIR_BIT, DIR_DX, DIR_DY, RoadType, type Rect } from '../../core/types';
import { ROAD_LIFT } from '../../world/roadHeight';
import type { World } from '../../world/World';
import { FT, FurnitureBuilder, type FurnitureChunk } from './furniture';
import { GeoBuf, Frame, box, code, emitRows, extrude, prism, type Mapper, type Row, type Section, type V2 } from './geo';
import { GAUGE_HALF, JF, Kind, MF, profileOf, STYLE_JUNCTION, type Profile } from './profiles';
import { DECK_THICKNESS, type RoadHeightField } from './surface';

const ROAD = ROAD_LIFT;
/** lift of guard-rail posts etc. standing on the terrain beside the road */
const VERGE = 0.04;
/** outer edge of gravel fringes / ballast shoulders: slightly below the terrain so they meet it without a gap */
const SINK = -0.04;
const CURB = 0.16;
/** bridge parapet width */
const PW = 0.4;
export const BALLAST_TOP = 0.24;
const SLEEPER_TOP = BALLAST_TOP + 0.09;
/** rail head height above the terrain-equivalent base (trains: heightAt + RAIL_TOP − ROAD_LIFT) */
export const RAIL_TOP = SLEEPER_TOP + 0.14;

const HALF_PI = Math.PI / 2;
const straightMap: Mapper = (s, tau, o) => {
  o.u = 8 - s;
  o.v = tau;
};
const curveMap: Mapper = (s, tau, o) => {
  const th = (tau / 16) * HALF_PI;
  const r = 8 + s;
  o.u = 16 - r * Math.cos(th);
  o.v = r * Math.sin(th);
};
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const popcount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const isCar = (t: RoadType): boolean => t !== RoadType.None && t !== RoadType.Rail && t !== RoadType.Pedestrian;

interface IP {
  hw: number;
  sw: number;
  ch: number;
  fringe: number;
}

interface SideInfo {
  a: number;
  sw: number;
  ch: number;
  /** gravel fringe width beyond the sidewalk back */
  f: number;
  conn: boolean;
}

export interface ChunkResult {
  geometry: THREE.BufferGeometry | null;
  furniture: FurnitureChunk;
  /** chunk contains elevated structures worth casting shadows */
  shadow: boolean;
  roadCells: number;
}

export class ChunkBuilder {
  private buf = new GeoBuf();
  private fr: Frame;
  private fb = new FurnitureBuilder();
  private gmCache = new Map<number, number>();
  private secCache = new Map<number, Section>();
  private rowPool: Row[] = [];
  private rowN = 0;
  private lod = 0;
  private shadow = false;
  private leftHand = false;
  private tmp: V2 = { u: 0, v: 0 };

  constructor(readonly world: World, readonly hf: RoadHeightField) {
    this.fr = new Frame(world, hf);
  }

  /** build all road cells of `rect`; lod 0 = full detail, 1 = simplified far geometry */
  build(rect: Rect, lod: number): ChunkResult {
    const w = this.world;
    this.buf.reset();
    this.fr.invalidate();
    this.fb.reset(lod === 0);
    this.gmCache.clear();
    this.lod = lod;
    this.shadow = false;
    this.leftHand = !!w.settings.leftHandTraffic;
    let cells = 0;
    for (let y = rect.y0; y <= rect.y1; y++)
      for (let x = rect.x0; x <= rect.x1; x++) {
        const t = w.road[y * w.size + x] as RoadType;
        if (t === RoadType.None) continue;
        cells++;
        if (t === RoadType.Rail) this.railCell(x, y);
        else this.roadCell(x, y, t);
      }
    return { geometry: this.buf.toGeometry(), furniture: this.fb.finish(), shadow: this.shadow, roadCells: cells };
  }

  // ── connectivity ────────────────────────────────────────────────────────
  private carOnlyMask(x: number, y: number): number {
    const w = this.world;
    let m = 0;
    for (let d = 0; d < 4; d++) if (isCar(w.roadAt(x + DIR_DX[d], y + DIR_DY[d]))) m |= DIR_BIT[d];
    return m;
  }

  /** symmetric geometric connection between (x,y) and its neighbour toward d */
  private conn(x: number, y: number, d: number): boolean {
    const w = this.world;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    const t = w.roadAt(x, y), nt = w.roadAt(nx, ny);
    if (t === RoadType.None || nt === RoadType.None) return false;
    const rail = t === RoadType.Rail, nrail = nt === RoadType.Rail;
    if (rail || nrail) return rail && nrail;
    const ped = t === RoadType.Pedestrian, nped = nt === RoadType.Pedestrian;
    if (ped === nped) return true;
    // car ↔ pedestrian: only where the car road runs straight into the pedestrian street
    const cx = ped ? nx : x, cy = ped ? ny : y;
    const toPed = ped ? (d + 2) & 3 : d;
    return (this.carOnlyMask(cx, cy) & ~DIR_BIT[(toPed + 2) & 3]) === 0;
  }

  /** geometric mask incl. virtual connections off the map edge for border dead ends */
  gmask(x: number, y: number): number {
    const w = this.world;
    const key = y * w.size + x;
    const c = this.gmCache.get(key);
    if (c !== undefined) return c;
    let m = 0;
    for (let d = 0; d < 4; d++) if (this.conn(x, y, d)) m |= DIR_BIT[d];
    if (popcount(m) === 1) {
      const d = [0, 1, 2, 3].find((i) => m & DIR_BIT[i])!;
      const o = (d + 2) & 3;
      if (!w.inBounds(x + DIR_DX[o], y + DIR_DY[o])) m |= DIR_BIT[o];
    }
    this.gmCache.set(key, m);
    return m;
  }

  private typeToward(x: number, y: number, d: number, own: RoadType): RoadType {
    const w = this.world;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    return w.inBounds(nx, ny) ? w.roadAt(nx, ny) : own;
  }

  /** profile at the shared edge of two connected cells (symmetric) */
  private edgeProfile(t: RoadType, nt: RoadType): Profile {
    if (t === nt) return profileOf(t);
    if (t === RoadType.Pedestrian) return profileOf(nt);
    if (nt === RoadType.Pedestrian) return profileOf(t);
    const a = profileOf(t), b = profileOf(nt);
    return a.rank <= b.rank ? a : b;
  }

  private isJunction(x: number, y: number): boolean {
    const w = this.world;
    if (!w.inBounds(x, y)) return false;
    const t = w.roadAt(x, y);
    if (t === RoadType.None || t === RoadType.Rail) return false;
    return popcount(this.gmask(x, y)) >= 3;
  }

  // ── car / pedestrian roads ──────────────────────────────────────────────
  private roadCell(x: number, y: number, t: RoadType): void {
    const own = profileOf(t);
    const gm = this.gmask(x, y);
    const arms: (Profile | null)[] = [null, null, null, null];
    for (let d = 0; d < 4; d++) if (gm & DIR_BIT[d]) arms[d] = this.edgeProfile(t, this.typeToward(x, y, d, t));
    const n = popcount(gm);
    if (n === 2 && (gm === 5 || gm === 10)) return this.straight(x, y, t, own, gm === 5 ? 0 : 1, arms);
    if (n === 2) {
      const k = gm === 3 ? 0 : gm === 6 ? 1 : gm === 12 ? 2 : 3;
      return this.curve(x, y, t, own, k, arms);
    }
    if (n >= 3) return this.junction(x, y, t, own, arms);
    if (t === RoadType.Pedestrian || this.world.isBridge(x, y)) {
      // pedestrian dead ends are just paved; bridge dead ends stay straight
      const d = n === 1 ? [0, 1, 2, 3].find((i) => gm & DIR_BIT[i])! : 0;
      const a2 = arms.slice();
      a2[(d + 2) & 3] = a2[d] ?? own;
      a2[d] = a2[d] ?? own;
      return this.straight(x, y, t, own, d & 1, a2);
    }
    if (n === 1) return this.deadEnd(x, y, t, own, [0, 1, 2, 3].find((i) => gm & DIR_BIT[i])!, arms);
    return this.deadEnd(x, y, t, own, -1, arms);
  }

  /** bridge-clamped carriageway half width (the carriageway keeps its width; sidewalks give way) */
  private hwOf(p: Profile | IP, bridge: boolean): number {
    return bridge ? Math.min(p.hw, 8 - PW) : p.hw;
  }

  /** bridge-clamped sidewalk width */
  private swOf(p: Profile | IP, bridge: boolean): number {
    return bridge ? Math.max(0, Math.min(p.sw, 8 - this.hwOf(p, true) - PW)) : p.sw;
  }

  /** half width of a deck (parapet outer edge) */
  private deckHalf(p: Profile | IP): number {
    return this.hwOf(p, true) + this.swOf(p, true) + PW;
  }

  private carSection(own: Profile, style: number, flags: number, bridge: boolean, pavedL: boolean, pavedR: boolean): Section {
    const key = own.type + style * 16 + flags * 256 + ((bridge ? 1 : 0) + (pavedL ? 2 : 0) + (pavedR ? 4 : 0) + this.lod * 8) * 65536;
    let sec = this.secCache.get(key);
    if (!sec) this.secCache.set(key, (sec = this.makeCarSection(own, style, flags, bridge, pavedL, pavedR)));
    return sec;
  }

  private makeCarSection(own: Profile, style: number, flags: number, bridge: boolean, pavedL: boolean, pavedR: boolean): Section {
    const cs = this.lod === 0 ? 2 : 1;
    // outer layers: bridge parapet deck, pavers toward a pedestrian street, the
    // ragged gravel fringe of unpaved roads — otherwise zero width (the real
    // terrain shows beside the sidewalk, so verges always match the ground)
    const vk = (paved: boolean): Kind => (bridge ? Kind.Concrete : paved ? Kind.Pavers : own.kind === Kind.Gravel ? Kind.Gravel : Kind.Grass);
    const wk = bridge ? Kind.Concrete : Kind.Curb;
    return {
      kind: [vk(pavedL), Kind.Sidewalk, Kind.Curb, own.kind, Kind.Grass, own.kind, Kind.Curb, Kind.Sidewalk, vk(pavedR)],
      style: [own.type, own.type, 0, style, own.type, style, 0, own.type, own.type],
      flags: [0, 0, 0, flags, 0, flags, 0, 0, 0],
      split: [1, 1, 1, cs, 1, cs, 1, 1, 1],
      wall: [Kind.Curb, wk, Kind.Curb, Kind.Curb, Kind.Curb, Kind.Curb, Kind.Curb, Kind.Curb, wk],
    };
  }

  /**
   * One cross-section row of a car / pedestrian piece. eL / eR are the outer
   * extents used on bridges (parapet) and toward pedestrian streets (pavers);
   * on land the section ends at the sidewalk back (or the gravel fringe).
   */
  private carRow(tau: number, p: IP, eL: number, eR: number, bridge: boolean, pavedL: boolean, pavedR: boolean, mi: number, mask: number, barrier = false): Row {
    const hw = this.hwOf(p, bridge);
    const sw = this.swOf(p, bridge);
    const ct = Math.min(0.15, sw);
    const sl = ROAD + p.ch;
    const back = hw + sw;
    const fr = bridge ? 0 : p.fringe;
    const outL = bridge || (pavedL && !bridge) ? eL : back + fr;
    const outR = bridge || (pavedR && !bridge) ? eR : back + fr;
    const row = this.nextRow();
    const b = row.b;
    b[0] = -outL;
    b[1] = -back;
    b[2] = -(hw + ct);
    b[3] = -hw;
    b[4] = -mi;
    b[5] = mi;
    b[6] = hw;
    b[7] = hw + ct;
    b[8] = back;
    b[9] = outR;
    for (let i = 1; i < 10; i++) if (b[i] < b[i - 1]) b[i] = b[i - 1];
    let vin: number, vout: number;
    if (bridge) vin = vout = barrier ? ROAD + 0.85 : sl + 0.14;
    else if (fr > 0.01) {
      vin = sl;
      vout = SINK;
    } else vin = vout = sl;
    const vL = pavedL && !bridge ? ROAD : NaN, vR = pavedR && !bridge ? ROAD : NaN;
    const la = row.la, lb = row.lb;
    la[0] = Number.isNaN(vL) ? vout : vL;
    lb[0] = Number.isNaN(vL) ? vin : vL;
    la[1] = lb[1] = la[2] = lb[2] = sl;
    la[3] = lb[3] = ROAD;
    la[4] = lb[4] = ROAD + CURB;
    la[5] = lb[5] = ROAD;
    la[6] = lb[6] = la[7] = lb[7] = sl;
    la[8] = Number.isNaN(vR) ? vin : vR;
    lb[8] = Number.isNaN(vR) ? vout : vR;
    row.tau = tau;
    row.hw = hw;
    row.mask = mask;
    return row;
  }

  /** pooled car-section row (valid until the next piece starts: see resetRows) */
  private nextRow(): Row {
    let r = this.rowPool[this.rowN];
    if (!r) this.rowPool[this.rowN] = r = { tau: 0, b: new Array<number>(10).fill(0), la: new Array<number>(9).fill(0), lb: new Array<number>(9).fill(0), hw: 0, mask: 0 };
    this.rowN++;
    return r;
  }

  /** interpolated profile along a piece (smoothstep between the end profiles) */
  private ip(a: Profile, b: Profile, t: number, out: IP): IP {
    const f = smooth(t);
    out.hw = a.hw + (b.hw - a.hw) * f;
    out.sw = a.sw + (b.sw - a.sw) * f;
    out.ch = a.ch + (b.ch - a.ch) * f;
    out.fringe = a.fringe + (b.fringe - a.fringe) * f;
    return out;
  }

  /** marking style + flags for a car piece with end profiles a, b */
  private markStyle(own: Profile, a: Profile, b: Profile): { style: number; flags: number } {
    let style: number = own.type;
    if (a.type !== own.type && b.type !== own.type) style = a.type;
    let flags = 0;
    const s = style as RoadType;
    if (s === RoadType.Street || s === RoadType.Avenue || s === RoadType.Boulevard || s === RoadType.Highway || s === RoadType.TramAvenue) flags |= MF.Mark;
    if (a.type !== b.type || Math.abs(a.hw - b.hw) > 0.01) flags |= MF.Taper;
    if (own.type === RoadType.TramAvenue) flags |= MF.Tracks;
    return { style, flags };
  }

  /** median half width along tau for a boulevard piece */
  private medianAt(tau: number, m: number, tip0: number, tip1: number): number {
    const shape = (d: number) => (d <= 0 ? 0 : d >= m ? 1 : Math.sqrt(1 - (1 - d / m) * (1 - d / m)));
    return m * shape(tau - tip0) * shape(tip1 - tau);
  }

  private crossAt(x: number, y: number, d: number, own: Profile): boolean {
    if (!own.cars || own.sw <= 0) return false;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    return this.isJunction(nx, ny) && isCar(this.world.roadAt(nx, ny));
  }

  private straight(x: number, y: number, t: RoadType, own: Profile, axis: number, arms: (Profile | null)[]): void {
    const w = this.world;
    this.rowN = 0;
    const k = axis; // N-S: k=0, E-W: k=1 (canonical N = actual N / E)
    const fr = this.fr.set(x, y, k);
    const dN = k, dS = (k + 2) & 3, dE = (k + 1) & 3, dW = (k + 3) & 3;
    const p0 = arms[dN] ?? own, p1 = arms[dS] ?? own;
    const bridge = fr.bridge;
    if (bridge) this.shadow = true;
    const { style, flags: mf } = this.markStyle(own, p0, p1);
    let flags = mf;
    const x0 = this.crossAt(x, y, dN, own), x1 = this.crossAt(x, y, dS, own);
    if (x0) flags |= MF.X0;
    if (x1) flags |= MF.X1;
    // pedestrian street alongside (not connected): paved side + mid-block zebra
    const pedE = !bridge && own.cars && w.roadAt(x + DIR_DX[dE], y + DIR_DY[dE]) === RoadType.Pedestrian;
    const pedW = !bridge && own.cars && w.roadAt(x + DIR_DX[dW], y + DIR_DY[dW]) === RoadType.Pedestrian;
    if ((pedE || pedW) && own.sw > 0) flags |= MF.Mid;
    if (bridge) flags |= MF.Bridge;
    // median extent (boulevard)
    const M = own.median;
    const tip0 = p0.median > 0 && !x0 ? -1e3 : x0 ? 4.3 : 2.5;
    const tip1 = p1.median > 0 && !x1 ? 1e3 : x1 ? 11.7 : 13.5;
    // rows
    const taus = new Set<number>([0, 16]);
    const taper = (mf & MF.Taper) !== 0;
    if (fr.raised && !bridge) for (let v = this.lod === 0 ? 2 : 4; v < 16; v += this.lod === 0 ? 2 : 4) taus.add(v); // eased approach ramp
    else if (taper || fr.raised) for (const v of this.lod === 0 ? [4, 8, 12] : [8]) taus.add(v);
    if (bridge) taus.add(8);
    if (M > 0) {
      for (const tp of [tip0, tip1]) {
        if (Math.abs(tp) > 100) continue;
        const dir = tp === tip0 ? 1 : -1;
        const steps = this.lod === 0 ? 4 : 2;
        for (let i = 0; i <= steps; i++) {
          const v = tp + dir * M * (1 - Math.cos((i / steps) * HALF_PI));
          if (v > 0 && v < 16) taus.add(v);
        }
      }
    }
    const tl = [...taus].sort((a, b) => a - b);
    const sec = this.carSection(own, style, flags, bridge, pedE, pedW);
    const ipv: IP = { hw: 0, sw: 0, ch: 0, fringe: 0 };
    const rows: Row[] = tl.map((tau) => {
      this.ip(p0, p1, tau / 16, ipv);
      const mi = M > 0 ? this.medianAt(tau, M, tip0, tip1) : 0;
      const e = bridge ? this.deckHalf(ipv) : 8;
      return this.carRow(tau, ipv, e, e, bridge, pedE, pedW, mi, 0xffff, own.sw <= 0.01 && own.type !== RoadType.Pedestrian);
    });
    const outerHigh = bridge || fr.raised || pedE || pedW || rows.some((r) => r.la[0] > 0.06 || r.lb[8] > 0.06);
    emitRows(this.buf, fr, sec, rows, straightMap, { skirtL: outerHigh, skirtR: outerHigh, bottom: bridge, skirtKind: Kind.Concrete, walls: this.lod === 0 || bridge });

    // ── structures & furniture ──
    const lights = (w.roadFlags[w.idx(x, y)] & 4) === 0;
    const par = (x + y) & 1;
    if (t === RoadType.Highway) this.highwayExtras(straightMap, bridge, x0 || this.isJunction(x + DIR_DX[dN], y + DIR_DY[dN]), x1 || this.isJunction(x + DIR_DX[dS], y + DIR_DY[dS]), p0, p1);
    if (bridge) {
      this.railingsAlong(straightMap, rows, own);
      this.bridgeExtras(x, y, rows, dN, dS);
    }
    if (t === RoadType.Pedestrian) this.pedBollards(x, y, arms);
    if (!lights) return;
    this.ip(p0, p1, 0.5, ipv);
    const hw = this.hwOf(ipv, bridge);
    if (t === RoadType.Pedestrian) {
      this.pedFurniture(x, y, par);
      return;
    }
    if (t === RoadType.Boulevard && M > 0 && this.medianAt(8, M, tip0, tip1) >= M * 0.99) {
      this.lampDouble(8, 8, ROAD + CURB, 1, 0, own);
      for (const tv of [3.6, 12.4]) if (this.medianAt(tv - 1.5, M, tip0, tip1) >= M * 0.99 && this.medianAt(tv + 1.5, M, tip0, tip1) >= M * 0.99) this.medianTree(8, tv, x, y, tv);
      return;
    }
    if (t === RoadType.Highway) {
      if (!par) this.lampDouble(8, 8, ROAD + 0.82, 1, 0, own);
      return;
    }
    if (own.lamps && ipv.sw > 0.5) {
      const side = par ? 1 : -1; // s side
      const s = side * (hw + (bridge ? this.swOf(ipv, true) + PW * 0.5 : Math.min(0.5, ipv.sw * 0.3)));
      this.lampSingleDir(8 - s, 8, bridge ? ROAD + ipv.ch + 0.14 : ROAD + ipv.ch, side, 0, own);
    }
  }

  private curve(x: number, y: number, t: RoadType, own: Profile, k: number, arms: (Profile | null)[]): void {
    const w = this.world;
    this.rowN = 0;
    const fr = this.fr.set(x, y, k);
    const dN = k, dE = (k + 1) & 3;
    const p0 = arms[dN] ?? own, p1 = arms[dE] ?? own;
    const bridge = fr.bridge;
    if (bridge) this.shadow = true;
    const { style, flags: mf } = this.markStyle(own, p0, p1);
    let flags = mf;
    if (this.crossAt(x, y, dN, own)) flags |= MF.X0;
    if (this.crossAt(x, y, dE, own)) flags |= MF.X1;
    if (bridge) flags |= MF.Bridge;
    const M = p0.median > 0 && p1.median > 0 ? own.median : 0;
    const n = this.lod === 0 ? 8 : 4;
    const sec = this.carSection(own, style, flags, bridge, false, false);
    const ipv: IP = { hw: 0, sw: 0, ch: 0, fringe: 0 };
    const rows: Row[] = [];
    for (let i = 0; i <= n; i++) {
      const tau = (i / n) * 16;
      const th = (i / n) * HALF_PI;
      this.ip(p0, p1, i / n, ipv);
      const rmax = Math.min(16 / Math.max(1e-6, Math.cos(th)), 16 / Math.max(1e-6, Math.sin(th)));
      const eo = bridge ? this.deckHalf(ipv) : rmax - 8;
      const ei = bridge ? this.deckHalf(ipv) : 8;
      rows.push(this.carRow(tau, ipv, ei, eo, bridge, false, false, M, 0xffff, own.sw <= 0.01 && own.type !== RoadType.Pedestrian));
    }
    const outerHigh = bridge || fr.raised || rows.some((r) => r.la[0] > 0.06 || r.lb[8] > 0.06);
    emitRows(this.buf, fr, sec, rows, curveMap, { skirtL: outerHigh, skirtR: outerHigh, bottom: bridge, skirtKind: Kind.Concrete, walls: this.lod === 0 || bridge });
    if (t === RoadType.Highway) this.highwayExtras(curveMap, bridge, false, false, p0, p1);
    if (t === RoadType.Pedestrian) this.pedBollards(x, y, arms);
    if (bridge) this.railingsAlong(curveMap, rows, own);
    if ((w.roadFlags[w.idx(x, y)] & 4) !== 0) return;
    this.ip(p0, p1, 0.5, ipv);
    const hw = this.hwOf(ipv, bridge);
    const o = this.tmp;
    if (t === RoadType.Pedestrian) {
      curveMap(4.8, 8, o);
      this.lampPed(o.u, o.v);
      return;
    }
    if (t === RoadType.Boulevard && M > 0) {
      curveMap(0, 8, o);
      const th = HALF_PI / 2;
      this.lampDouble(o.u, o.v, ROAD + CURB, -Math.cos(th), Math.sin(th), own);
      return;
    }
    if (t === RoadType.Highway) {
      curveMap(0, 8, o);
      this.lampDouble(o.u, o.v, ROAD + 0.82, -Math.cos(HALF_PI / 2), Math.sin(HALF_PI / 2), own);
      return;
    }
    if (own.lamps && ipv.sw > 0.5) {
      const s = hw + (bridge ? this.swOf(ipv, true) + PW * 0.5 : Math.min(0.5, ipv.sw * 0.3));
      curveMap(s, 8, o);
      // arm points toward the curve center (−s direction = toward corner (16,0))
      const du = 16 - o.u, dv = -o.v;
      const l = Math.hypot(du, dv);
      this.lampSingleDir(o.u, o.v, bridge ? ROAD + ipv.ch + 0.14 : ROAD + ipv.ch, du / l, dv / l, own);
    }
  }

  private deadEnd(x: number, y: number, t: RoadType, own: Profile, dir: number, arms: (Profile | null)[]): void {
    const w = this.world;
    const k = dir < 0 ? 0 : dir;
    const fr = this.fr.set(x, y, k);
    const p = dir < 0 ? own : arms[dir] ?? own;
    const stem = dir >= 0;
    const hw = stem ? p.hw : 0;
    const sw = p.sw || own.sw;
    const ch = p.ch || own.ch;
    const ct = Math.min(0.15, sw);
    const F = p.fringe || own.fringe;
    const Rb = Math.max(own.hw, Math.min(own.hw + 1.8, 8 - sw - F - 0.3));
    const Rc = Rb + ct, Rs = Rb + sw, Rf = Rs + F;
    const zc = stem ? Math.min(8.5, 16 - Rf - 0.25) : 8;
    const circ = (R: number, v: number) => {
      const d = v - zc;
      return Math.abs(d) <= R ? Math.sqrt(R * R - d * d) : 0;
    };
    // the piece ends at the far rim of the bulb (terrain beyond); isolated cells are a round plaza
    const vEnd = Math.min(16, zc + Rf), vStart = stem ? 0 : zc - Rf;
    const vs = new Set<number>([vStart, vEnd]);
    const na = this.lod === 0 ? 7 : 4;
    const starts: number[] = [];
    const rings: [number, number][] = [[Rb, hw], [Rc, hw + ct], [Rs, hw + sw]];
    if (F > 0) rings.push([Rf, hw + sw + F]);
    for (const [R, wd] of rings) {
      const v0 = stem && R > wd ? zc - Math.sqrt(R * R - wd * wd) : stem ? zc : zc - R;
      starts.push(v0);
      const phi0 = Math.acos(Math.max(-1, Math.min(1, (zc - v0) / R)));
      for (let i = 0; i <= na; i++) {
        const ph = phi0 + ((Math.PI - phi0) * i) / na;
        const v = zc - R * Math.cos(ph);
        if (v > vStart + 0.01 && v < vEnd - 0.01) vs.add(v);
      }
      if (stem && zc - v0 > 0.01) vs.add(Math.max(0.02, v0 - 0.02));
    }
    const bulbStart = starts[0];
    const x0 = stem && this.crossAt(x, y, dir, own);
    const { style, flags: mf } = this.markStyle(own, p, own);
    let flags = (mf & ~MF.Taper) | (x0 ? MF.X0 : 0);
    if (!stem) flags = 0;
    const markEnd = bulbStart - 1.2;
    if (stem && markEnd > 0.2) vs.add(markEnd);
    const M = own.median && p.median ? own.median : 0;
    const tip0 = x0 ? 4.3 : -1e3, tip1 = bulbStart - 2.2;
    if (M > 0) for (let i = 0; i <= 3; i++) {
      const v = tip1 - M * (1 - Math.cos((i / 3) * HALF_PI));
      if (v > 0) vs.add(v);
    }
    const vl = [...vs].filter((v) => v >= vStart && v <= vEnd).sort((a, b) => a - b);
    const sec = this.carSection(own, style, flags, false, false, false);
    const sl = ROAD + ch;
    const vo = F > 0 ? SINK : sl;
    const rows: Row[] = vl.map((v) => {
      const inStem = stem && v <= zc;
      const asph = inStem ? Math.max(hw, circ(Rb, v)) : circ(Rb, v);
      const ctop = Math.max(asph, inStem ? Math.max(hw + ct, circ(Rc, v)) : circ(Rc, v));
      const side = Math.max(ctop, inStem ? Math.max(hw + sw, circ(Rs, v)) : circ(Rs, v));
      const outer = F > 0 ? Math.max(side, inStem ? Math.max(hw + sw + F, circ(Rf, v)) : circ(Rf, v)) : side;
      const mi = M > 0 ? this.medianAt(v, M, tip0, tip1) : 0;
      const b = [-outer, -side, -ctop, -asph, -mi, mi, asph, ctop, side, outer];
      const la = [vo, sl, sl, ROAD, ROAD + CURB, ROAD, sl, sl, sl];
      const lb = [sl, sl, sl, ROAD, ROAD + CURB, ROAD, sl, sl, vo];
      // gravel fringe fades by (|s| − hw): past the bulb rim a negative hw keeps that distance ≈ radial
      const rim = zc + Rb;
      const hwr = F > 0 && v > rim ? rim - v : Math.max(asph, 0.01);
      return { tau: v, b, la, lb, hw: hwr, mask: v < markEnd ? 0xffff : 0 };
    });
    const skirt = fr.raised || rows.some((r) => r.la[0] > 0.06);
    emitRows(this.buf, fr, sec, rows, straightMap, { skirtL: skirt, skirtR: skirt, bottom: false, skirtKind: Kind.Concrete, walls: this.lod === 0 });
    if ((w.roadFlags[w.idx(x, y)] & 4) !== 0 || !own.lamps || sw < 0.5) return;
    if (t === RoadType.Highway) return;
    const lv = Math.min(15.6, zc + Rb + Math.min(0.5, sw * 0.3));
    this.lampSingleDir(8, lv, ROAD + ch, 0, -1, own);
  }

  // ── junctions ───────────────────────────────────────────────────────────
  private junction(x: number, y: number, t: RoadType, own: Profile, arms: (Profile | null)[]): void {
    const w = this.world;
    const fr = this.fr.set(x, y, 0);
    const bridge = fr.bridge;
    if (bridge) this.shadow = true;
    const sides: SideInfo[] = [];
    for (let d = 0; d < 4; d++) {
      const p = arms[d];
      if (p) sides[d] = { a: this.hwOf(p, bridge), sw: this.swOf(p, bridge), ch: p.ch, f: bridge ? 0 : p.fringe, conn: true };
    }
    for (let d = 0; d < 4; d++) {
      if (sides[d]) continue;
      const a = arms[(d + 1) & 3] ?? own, b = arms[(d + 3) & 3] ?? own;
      sides[d] = { a: (this.hwOf(a, bridge) + this.hwOf(b, bridge)) / 2, sw: (this.swOf(a, bridge) + this.swOf(b, bridge)) / 2, ch: (a.ch + b.ch) / 2, f: bridge ? 0 : (a.fringe + b.fringe) / 2, conn: false };
    }
    // embedded tram tracks between tram arms
    const tram = [0, 1, 2, 3].map((d) => !!arms[d] && this.typeToward(x, y, d, t) === RoadType.TramAvenue);
    let jf = 0;
    if (tram[0] && tram[2]) jf |= JF.NS;
    if (tram[1] && tram[3]) jf |= JF.EW;
    for (let q = 0; q < 4; q++) {
      const a = q, b = (q + 1) & 3;
      if (tram[a] && tram[b] && (!tram[(a + 2) & 3] || !tram[(b + 2) & 3])) jf |= [JF.NE, JF.SE, JF.SW, JF.NW][q];
    }
    if (jf) jf |= JF.Tram;
    const radii: number[] = [];
    for (let q = 0; q < 4; q++) {
      fr.set(x, y, q);
      radii[q] = this.quadrant(own, sides[q], sides[(q + 1) & 3], jf, bridge);
    }
    if (bridge) this.bridgeJunctionShell(x, y, sides);
    // traffic signals at avenue-or-larger car junctions; otherwise a corner lamp
    const lights = (w.roadFlags[w.idx(x, y)] & 4) === 0;
    if (!own.cars) {
      if (t === RoadType.Pedestrian) this.pedJunctionFurniture(x, y, arms, lights);
      return;
    }
    let maxRank = own.rank;
    let carArms = 0;
    for (let d = 0; d < 4; d++) {
      const nt = arms[d] ? this.typeToward(x, y, d, t) : RoadType.None;
      if (isCar(nt)) {
        carArms++;
        maxRank = Math.max(maxRank, profileOf(nt).rank);
      }
    }
    if (maxRank >= 3 && carArms >= 3 && t !== RoadType.Highway) {
      this.signals(x, y, sides, radii, own);
      return;
    }
    if (!lights || !own.lamps || own.type === RoadType.Highway) return;
    // one lamp on a rounded corner (deterministic pick)
    const cand: number[] = [];
    for (let q = 0; q < 4; q++) if (sides[q].conn && sides[(q + 1) & 3].conn && sides[q].sw > 0.5) cand.push(q);
    if (!cand.length) return;
    const q = cand[hash2(x, y) % cand.length];
    const A = sides[q], B = sides[(q + 1) & 3];
    const r = radii[q];
    const cu = 8 + A.a + r, cv = 8 - B.a - r;
    const inset = Math.max(0, r - 0.55);
    const u = cu - inset * Math.SQRT1_2, v = cv + inset * Math.SQRT1_2;
    fr.set(x, y, q);
    const du = 8 - u, dv = 8 - v, l = Math.hypot(du, dv) || 1;
    this.lampSingleDir(u, v, ROAD + (A.ch + B.ch) / 2, du / l, dv / l, own);
  }

  /** fillet path: straight along u = xl from the N edge, arc of radius rad, straight along v = zl to the E edge */
  private fillet(xl: number, zl: number, rad: number, n: number): V2[] {
    rad = Math.max(0, Math.min(rad, zl, 16 - xl));
    const pts: V2[] = [{ u: xl, v: 0 }];
    const cu = xl + rad, cv = zl - rad;
    for (let i = 0; i <= n; i++) {
      const ph = Math.PI - (i / n) * HALF_PI;
      pts.push({ u: cu + rad * Math.cos(ph), v: cv + rad * Math.sin(ph) });
    }
    pts.push({ u: 16, v: zl });
    return pts;
  }

  /** one junction corner in canonical NE orientation (frame already rotated); returns the curb radius */
  private quadrant(own: Profile, A: SideInfo, B: SideInfo, jf: number, bridge: boolean, rail = false): number {
    const fr = this.fr, buf = this.buf;
    const n = this.lod === 0 ? 6 : 3;
    const ctA = Math.min(0.15, A.sw), ctB = Math.min(0.15, B.sw);
    let inner: V2[], ctop: V2[], outer: V2[];
    let r = 0;
    let fan = true;
    let vergeEdge: V2[] = [];
    if (A.conn && B.conn) {
      r = Math.max(0, Math.min(rail ? 3.5 : own.radius, 8 - A.a, 8 - B.a));
      inner = this.fillet(8 + A.a, 8 - B.a, r, n);
      ctop = this.fillet(8 + A.a + ctA, 8 - B.a - ctB, Math.max(0, r - Math.max(ctA, ctB)), n);
      outer = this.fillet(8 + A.a + A.sw, 8 - B.a - B.sw, Math.max(0, r - Math.max(A.sw, B.sw)), n);
    } else if (A.conn) {
      inner = [{ u: 8 + A.a, v: 0 }, { u: 8 + B.a, v: 8 }];
      ctop = [{ u: 8 + A.a + ctA, v: 0 }, { u: 8 + B.a + ctB, v: 8 }];
      outer = [{ u: 8 + A.a + A.sw, v: 0 }, { u: 8 + B.a + B.sw, v: 8 }];
      vergeEdge = [{ u: 16, v: 0 }, { u: 16, v: 8 }];
      fan = false;
    } else {
      inner = [{ u: 8, v: 8 - A.a }, { u: 16, v: 8 - B.a }];
      ctop = [{ u: 8, v: 8 - A.a - ctA }, { u: 16, v: 8 - B.a - ctB }];
      outer = [{ u: 8, v: 8 - A.a - A.sw }, { u: 16, v: 8 - B.a - B.sw }];
      vergeEdge = [{ u: 8, v: 0 }, { u: 16, v: 0 }];
      fan = false;
    }
    const np = inner.length;
    const chAt = (i: number) => A.ch + (B.ch - A.ch) * (np > 1 ? i / (np - 1) : 0);
    const cAsph = code(own.kind, STYLE_JUNCTION, jf);
    const cCurb = code(Kind.Curb, 0, 0);
    const cSide = code(Kind.Sidewalk, STYLE_JUNCTION, 0);
    const cVerge = code(Kind.Concrete, STYLE_JUNCTION, 0);
    const carLift = rail ? BALLAST_TOP : ROAD;
    const P = (p: V2, lift: number, c: number, s = 0, hw = 8): number => {
      fr.w(p.u, p.v);
      const X = fr.X, Z = fr.Z;
      const nn = fr.normal(X, Z);
      return buf.vtx(X, fr.base(X, Z) + lift, Z, nn.x, nn.y, nn.z, s, 0, hw, c);
    };
    // asphalt: fan from the center with a mid ring
    const bnd: V2[] = [];
    if (A.conn) bnd.push({ u: 8, v: 0 });
    for (const p of inner) bnd.push(p);
    if (B.conn) bnd.push({ u: 16, v: 8 });
    const O = { u: 8, v: 8 };
    const o = P(O, carLift, cAsph);
    const mid: V2 = { u: 0, v: 0 };
    let pr = -1, pm = -1;
    for (let i = 0; i < bnd.length; i++) {
      const b = bnd[i];
      mid.u = (O.u + b.u) / 2;
      mid.v = (O.v + b.v) / 2;
      const m = P(mid, carLift, cAsph);
      const e = P(b, carLift, cAsph);
      if (i > 0) {
        buf.tri(o, pm, m, 0, 1, 0);
        buf.quadUp(pm, pr, e, m);
      }
      pr = e;
      pm = m;
    }
    // curb top + sidewalk bands (optional per-vertex s coordinates for the shader)
    const band = (a: V2[], b: V2[], liftA: (i: number) => number, liftB: (i: number) => number, c: number, sB?: (i: number) => number) => {
      let pa = -1, pb = -1;
      for (let i = 0; i < a.length; i++) {
        const ia = P(a[i], liftA(i), c, 0, sB ? 0 : 8), ib = P(b[i], liftB(i), c, sB ? sB(i) : 0, sB ? 0 : 8);
        if (i > 0) buf.quadUp(pa, ia, ib, pb);
        pa = ia;
        pb = ib;
      }
    };
    if (rail) {
      // sloped ballast shoulders down into the terrain
      band(inner, outer, () => BALLAST_TOP, () => SINK, code(Kind.Ballast, RoadType.Rail, 0));
      return r;
    }
    const sideLift = (i: number) => ROAD + chAt(i);
    if (A.sw + B.sw > 0.01) {
      band(inner, ctop, sideLift, sideLift, cCurb);
      band(ctop, outer, sideLift, sideLift, cSide);
    }
    // walls: curb faces toward the asphalt; the outer edge drops into the terrain (lo = null)
    const wall = (path: V2[], lo: ((i: number) => number) | null, hi: (i: number) => number, towardCenter: boolean, kind: Kind) => {
      const c = code(kind, 0, 0);
      let pa = -1, pb = -1, pnx = 0, pnz = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const q0 = path[Math.max(0, i - 1)], q1 = path[Math.min(path.length - 1, i + 1)];
        let tu = q1.u - q0.u, tv = q1.v - q0.v;
        const tl = Math.hypot(tu, tv) || 1;
        tu /= tl;
        tv /= tl;
        let nu = -tv, nv = tu;
        if ((O.u - p.u) * nu + (O.v - p.v) * nv < 0 === towardCenter) {
          nu = -nu;
          nv = -nv;
        }
        fr.d(nu, nv);
        const nx = fr.DX, nz = fr.DZ;
        fr.w(p.u, p.v);
        const X = fr.X, Z = fr.Z, bh = fr.base(X, Z);
        const top = bh + hi(i);
        const bot = lo ? bh + lo(i) : Math.min(fr.skirt(X, Z, bh), top - 0.02);
        const ia = buf.vtx(X, Math.min(bot, top), Z, nx, 0, nz, 0, 0, 0, c);
        const ib = buf.vtx(X, Math.max(bot, top), Z, nx, 0, nz, 0, 0, 0, c);
        if (i > 0) buf.quad(pa, ia, ib, pb, (pnx + nx) / 2, 0, (pnz + nz) / 2);
        pa = ia;
        pb = ib;
        pnx = nx;
        pnz = nz;
      }
    };
    if (A.ch + B.ch > 0.01 && (this.lod === 0 || bridge)) wall(inner, () => ROAD, sideLift, true, Kind.Curb);
    if (bridge) {
      // deck surface out to the fascia: fan from the cell corner or band to the closed edge
      const vLift = (i: number) => ROAD + chAt(i);
      if (fan) {
        const K = P({ u: 16, v: 0 }, vLift(np - 1), cVerge);
        let prev = -1;
        for (let i = 0; i < outer.length; i++) {
          const e = P(outer[i], vLift(i), cVerge);
          if (i > 0) buf.tri(K, prev, e, 0, 1, 0);
          prev = e;
        }
      } else band(outer, vergeEdge, vLift, vLift, cVerge);
      return r;
    }
    if (A.f + B.f > 0.01) {
      // unpaved: a ragged gravel fringe sloping into the terrain
      const ow = (S: SideInfo) => S.sw + S.f;
      const edge = fan
        ? this.fillet(8 + A.a + ow(A), 8 - B.a - ow(B), Math.max(0, r - Math.max(ow(A), ow(B))), n)
        : A.conn
          ? [{ u: 8 + A.a + ow(A), v: 0 }, { u: 8 + B.a + ow(B), v: 8 }]
          : [{ u: 8, v: 8 - A.a - ow(A) }, { u: 16, v: 8 - B.a - ow(B) }];
      const fAt = (i: number) => A.f + (B.f - A.f) * (np > 1 ? i / (np - 1) : 0);
      band(outer, edge, sideLift, () => SINK, code(Kind.Gravel, RoadType.Dirt, 0), fAt);
    } else wall(outer, null, sideLift, false, Kind.Concrete);
    return r;
  }

  /** deck fascia on all four edges, underside, railings on closed sides */
  private bridgeJunctionShell(x: number, y: number, sides: SideInfo[]): void {
    const fr = this.fr.set(x, y, 0);
    const buf = this.buf;
    const c = code(Kind.Concrete, 0, 0);
    const corners: V2[] = [{ u: 0, v: 0 }, { u: 16, v: 0 }, { u: 16, v: 16 }, { u: 0, v: 16 }];
    const bot: number[] = [];
    for (const p of corners) {
      fr.w(p.u, p.v);
      bot.push(buf.vtx(fr.X, fr.base(fr.X, fr.Z) - DECK_THICKNESS, fr.Z, 0, -1, 0, 0, 0, 0, c));
    }
    buf.quad(bot[0], bot[1], bot[2], bot[3], 0, -1, 0);
    // edges in actual orientation: N (v=0), E (u=16), S (v=16), W (u=0)
    for (let d = 0; d < 4; d++) {
      const a = corners[d], b = corners[(d + 1) & 3];
      const nx = DIR_DX[d], nz = DIR_DY[d];
      const ids: number[] = [];
      for (const p of [a, b]) {
        fr.w(p.u, p.v);
        const bh = fr.base(fr.X, fr.Z);
        ids.push(buf.vtx(fr.X, bh - DECK_THICKNESS, fr.Z, nx, 0, nz, 0, 0, 0, c));
        ids.push(buf.vtx(fr.X, bh + ROAD + sides[d].ch, fr.Z, nx, 0, nz, 0, 0, 0, c));
      }
      buf.quad(ids[0], ids[2], ids[3], ids[1], nx, 0, nz);
      if (!sides[d].conn) {
        const map: Mapper = (s, tau, o) => {
          const f = tau / 16;
          o.u = a.u + (b.u - a.u) * f + nx * (s - 0.2);
          o.v = a.v + (b.v - a.v) * f + nz * (s - 0.2);
        };
        this.railing(map, 0, 0, 16, ROAD + sides[d].ch);
      }
    }
  }

  // ── signals & furniture helpers ─────────────────────────────────────────
  private signals(x: number, y: number, sides: SideInfo[], radii: number[], own: Profile): void {
    const fr = this.fr;
    const phase = hash2(x * 7 + 1, y * 13 + 5) % 26;
    for (let d = 0; d < 4; d++) {
      if (!sides[d].conn) continue;
      const nt = this.typeToward(x, y, d, own.type);
      if (!isCar(nt)) continue;
      fr.set(x, y, d); // canonical N = arrival arm
      const a = sides[d].a;
      const west = sides[(d + 3) & 3], east = sides[(d + 1) & 3];
      const perp = this.leftHand ? east : west;
      const r = this.leftHand ? radii[d] : radii[(d + 3) & 3];
      const e = perp.a;
      const lh = this.leftHand ? -1 : 1;
      let u = 8 - lh * (a + Math.min(0.75, sides[d].sw * 0.45 + 0.1));
      let v = 8 - e - (perp.conn ? r : 0) - 0.5;
      v = Math.max(0.55, Math.min(15, v));
      u = Math.max(0.3, Math.min(15.7, u));
      fr.w(u, v);
      const X = fr.X, Z = fr.Z;
      const gy = fr.base(X, Z) + ROAD + sides[d].ch;
      const [fx, fz] = fr.dir(0, -1); // face toward arriving traffic (north in canonical)
      const [ax, az] = fr.dir(lh, 0); // mast across incoming lanes
      const faceYaw = Math.atan2(-fz, fx), armYaw = Math.atan2(-az, ax);
      const L = Math.max(1.5, a + 0.2);
      const group = d & 1;
      this.fb.add(FT.SigPole, X, gy, Z, faceYaw);
      this.fb.add(FT.SigArm, X, gy, Z, armYaw, L, 1, 1);
      const hx = X + ax * (L - 0.35), hz = Z + az * (L - 0.35), hy = gy + 5.3;
      this.fb.add(FT.SigHead, hx, hy, hz, faceYaw);
      const lens = (cx: number, cy: number, cz: number) => {
        for (let c = 0; c < 3; c++) this.fb.lens(cx + fx * 0.17, cy + 0.32 - c * 0.32, cz + fz * 0.17, group, c, phase);
      };
      lens(hx, hy, hz);
      lens(X + fx * 0.22, gy + 3.1, Z + fz * 0.22);
      // luminaire glow on top of the mast
      this.fb.glow(X + ax * 0.3, gy + 6.4, Z + az * 0.3, 1.5);
    }
  }

  /** single-arm lamp at canonical (u, v), arm pointing along canonical (du, dv) */
  private lampSingleDir(u: number, v: number, lift: number, du: number, dv: number, own: Profile): void {
    const fr = this.fr;
    fr.w(u, v);
    const X = fr.X, Z = fr.Z;
    const y = fr.base(X, Z) + lift;
    const [dx, dz] = fr.dir(du, dv);
    const yaw = Math.atan2(-dz, dx);
    this.fb.add(FT.LampPole, X, y, Z, yaw);
    const hx = X + dx * 1.75, hz = Z + dz * 1.75;
    this.fb.glow(hx, y + 7.3, hz, 1.2);
    this.pool(hx, hz, own.hw > 5 ? 12 : 11, 1);
  }

  private lampDouble(u: number, v: number, lift: number, du: number, dv: number, own: Profile): void {
    const fr = this.fr;
    fr.w(u, v);
    const X = fr.X, Z = fr.Z;
    const y = fr.base(X, Z) + lift;
    const [dx, dz] = fr.dir(du, dv);
    this.fb.add(FT.LampDouble, X, y, Z, Math.atan2(-dz, dx));
    for (const s of [1, -1]) {
      const hx = X + dx * 2.05 * s, hz = Z + dz * 2.05 * s;
      this.fb.glow(hx, y + 8.6, hz, 1.35);
      const off = own.type === RoadType.Highway ? 3.6 : 3.4;
      this.pool(X + dx * off * s, Z + dz * off * s, 13, 1);
    }
  }

  private lampPed(u: number, v: number): void {
    const fr = this.fr;
    fr.w(u, v);
    const X = fr.X, Z = fr.Z;
    const y = fr.base(X, Z) + ROAD;
    this.fb.add(FT.LampPed, X, y, Z, 0);
    this.fb.glow(X, y + 3.93, Z, 0.8);
    this.pool(X, Z, 6.5, 0.9);
  }

  private pool(wx: number, wz: number, radius: number, strength: number): void {
    const fr = this.fr;
    const y = this.hf.heightAt(wx, wz);
    const n = fr.normal(wx, wz);
    this.fb.pool(wx, y, wz, radius, n.x / n.y, n.z / n.y, strength);
  }

  private medianTree(u: number, v: number, x: number, y: number, salt: number): void {
    const fr = this.fr;
    fr.w(u, v);
    const h = hash2(x * 31 + (salt | 0), y * 17 + 3);
    this.fb.tree(fr.X, fr.base(fr.X, fr.Z) + ROAD + CURB, fr.Z, 0.75 + (h % 100) / 400, h);
  }

  private pedFurniture(x: number, y: number, par: number): void {
    const fr = this.fr;
    const s = par ? 1 : -1;
    this.lampPed(8 - s * 5.4, 8);
    // benches facing the center line, bin beside them, planter opposite
    for (const [tv, ss] of [[4, -s], [12, s]] as [number, number][]) {
      const u = 8 - ss * 3.6;
      fr.w(u, tv);
      const X = fr.X, Z = fr.Z, gy = fr.base(X, Z) + ROAD;
      const [dx, dz] = fr.dir(ss > 0 ? 1 : -1, 0);
      this.fb.add(FT.Bench, X, gy, Z, Math.atan2(-dz, dx));
      fr.w(u - ss * 0.1, tv + 1.35);
      this.fb.add(FT.Bin, fr.X, fr.base(fr.X, fr.Z) + ROAD, fr.Z, 0);
      fr.w(8 + ss * 5.6, tv);
      this.fb.add(FT.Planter, fr.X, fr.base(fr.X, fr.Z) + ROAD, fr.Z, (hash2(x, y) % 4) * HALF_PI);
    }
    if (((x * 3 + y) & 1) === 0) {
      fr.w(8, 8);
      const h = hash2(x * 11, y * 5);
      this.fb.tree(fr.X, fr.base(fr.X, fr.Z) + ROAD, fr.Z, 0.85 + (h % 100) / 500, h);
    }
  }

  private pedJunctionFurniture(x: number, y: number, arms: (Profile | null)[], lights: boolean): void {
    const fr = this.fr.set(x, y, 0);
    for (const [u, v] of [[3.2, 3.2], [12.8, 3.2], [12.8, 12.8], [3.2, 12.8]]) {
      fr.w(u, v);
      this.fb.add(FT.Planter, fr.X, fr.base(fr.X, fr.Z) + ROAD, fr.Z, 0);
    }
    if (lights) this.lampPed(8, 8);
    this.pedBollards(x, y, arms);
  }

  /** bollards where a pedestrian cell opens onto a car road */
  private pedBollards(x: number, y: number, arms: (Profile | null)[]): void {
    const w = this.world;
    if (w.roadAt(x, y) !== RoadType.Pedestrian) return;
    for (let d = 0; d < 4; d++) {
      if (!arms[d] || !isCar(this.typeToward(x, y, d, RoadType.Pedestrian))) continue;
      const fr = this.fr.set(x, y, d);
      for (const s of [-3, -1.5, 0, 1.5, 3]) {
        fr.w(8 - s, 0.7);
        this.fb.add(FT.Bollard, fr.X, fr.base(fr.X, fr.Z) + ROAD, fr.Z, 0);
      }
    }
  }

  // ── highway & bridge structures ─────────────────────────────────────────
  private highwayExtras(map: Mapper, bridge: boolean, endJ0: boolean, endJ1: boolean, p0: Profile, p1: Profile): void {
    const seg = this.lod === 0 ? (map === curveMap ? 8 : 2) : map === curveMap ? 4 : 1;
    const t0 = endJ0 ? 2.5 : p0.barrier ? 0 : 5;
    const t1 = endJ1 ? 13.5 : p1.barrier ? 16 : 11;
    const jersey: [number, number][] = [[0.3, 0], [0.26, 0.08], [0.12, 0.34], [0.1, 0.82], [-0.1, 0.82], [-0.12, 0.34], [-0.26, 0.08], [-0.3, 0]];
    if (t1 > t0) extrude(this.buf, this.fr, map, 0, t0, t1, seg, jersey, ROAD, Kind.Concrete);
    if (bridge) return;
    // guardrails on the shoulders
    const beam: [number, number][] = [[0.03, 0.45], [0.03, 0.78], [-0.03, 0.78], [-0.03, 0.45]];
    for (const s of [-7.86, 7.86]) {
      extrude(this.buf, this.fr, map, s, 0, 16, seg, beam, VERGE + 0.02, Kind.Galvanized, true);
      if (this.lod === 0) {
        for (let tv = 1; tv < 16; tv += 2) {
          map(s + (s > 0 ? 0.08 : -0.08), tv, this.tmp);
          this.fr.w(this.tmp.u, this.tmp.v);
          const X = this.fr.X, Z = this.fr.Z;
          const b = this.fr.base(X, Z);
          box(this.buf, X, Z, 0, 0.05, 0.05, b - 0.1, b + 0.76, Kind.Galvanized);
        }
      }
    }
  }

  /** piers, abutments and railings for a straight bridge cell */
  private bridgeExtras(x: number, y: number, rows: Row[], dN: number, dS: number): void {
    const w = this.world, fr = this.fr, buf = this.buf;
    const r8 = rows.find((r) => r.tau === 8) ?? rows[0];
    const W = r8.b[r8.b.length - 1];
    // piers every other cell along the run
    if (((x + y) & 1) === 0) {
      const o = this.tmp;
      straightMap(0, 8, o);
      fr.w(o.u, o.v);
      const top = fr.base(fr.X, fr.Z) - DECK_THICKNESS;
      const cols = W > 5 ? [-(W - 1.7), W - 1.7] : [0];
      let lowest = Infinity;
      const pos: [number, number][] = [];
      for (const s of cols) {
        straightMap(s, 8, o);
        fr.w(o.u, o.v);
        const g = Math.min(w.heightAt(fr.X - 1, fr.Z - 1), w.heightAt(fr.X + 1, fr.Z + 1), w.heightAt(fr.X - 1, fr.Z + 1), w.heightAt(fr.X + 1, fr.Z - 1));
        lowest = Math.min(lowest, g);
        pos.push([fr.X, fr.Z]);
      }
      if (top - lowest > 0.6) {
        for (const [X, Z] of pos) prism(buf, X, Z, W > 5 ? 0.75 : 1.0, lowest - 1.5, top - 0.8, this.lod === 0 ? 12 : 6, Kind.Concrete);
        straightMap(0, 8, o);
        fr.w(o.u, o.v);
        const [ax, az] = fr.dir(1, 0);
        box(buf, fr.X, fr.Z, Math.atan2(-az, ax), W - 0.4, 0.85, top - 0.9, top, Kind.Concrete, true);
      }
    }
    // abutments where the deck meets land
    for (const [d, tau] of [[dN, 0.45], [dS, 15.55]] as [number, number][]) {
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (!w.inBounds(nx, ny) || w.isBridge(nx, ny)) continue;
      const o = this.tmp;
      straightMap(0, tau, o);
      fr.w(o.u, o.v);
      const top = fr.base(fr.X, fr.Z) - DECK_THICKNESS;
      const g = Math.min(w.heightAt(fr.X, fr.Z), top - 0.2);
      const [ax, az] = fr.dir(1, 0);
      box(buf, fr.X, fr.Z, Math.atan2(-az, ax), W, 0.45, g - 2, top, Kind.Concrete);
    }
  }

  /** railings along both parapets of a row-based bridge piece (tall concrete barriers get none) */
  private railingsAlong(map: Mapper, rows: Row[], own: Profile): void {
    if (own.sw <= 0.01 && own.type !== RoadType.Pedestrian && own.type !== RoadType.Rail) return;
    const lift = rows[0].la[0];
    for (const side of [-1, 1]) {
      const edge = (tau: number): number => {
        let best = rows[0];
        for (const r of rows) if (Math.abs(r.tau - tau) < Math.abs(best.tau - tau)) best = r;
        return (side < 0 ? -best.b[0] : best.b[best.b.length - 1]) - PW * 0.5;
      };
      const m: Mapper = (s, tau, o) => map(side * edge(tau) + s, tau, o);
      this.railing(m, 0, 0, 16, lift, map === curveMap);
    }
  }

  /** metal railing (posts + two rails) along s = s0 of a mapper, on top of `lift` */
  private railing(map: Mapper, s0: number, t0: number, t1: number, lift: number, curved = false): void {
    const seg = curved ? (this.lod === 0 ? 8 : 4) : 2;
    const rail: [number, number][] = [[0.035, 0.98], [0.035, 1.06], [-0.035, 1.06], [-0.035, 0.98]];
    extrude(this.buf, this.fr, map, s0, t0, t1, seg, rail, lift, Kind.DarkMetal, true);
    if (this.lod > 0) return;
    const mid: [number, number][] = [[0.02, 0.5], [0.02, 0.55], [-0.02, 0.55], [-0.02, 0.5]];
    extrude(this.buf, this.fr, map, s0, t0, t1, seg, mid, lift, Kind.DarkMetal, true);
    for (let tv = t0 + 0.8; tv < t1; tv += 1.6) {
      map(s0, tv, this.tmp);
      this.fr.w(this.tmp.u, this.tmp.v);
      const X = this.fr.X, Z = this.fr.Z;
      const b = this.fr.base(X, Z) + lift;
      box(this.buf, X, Z, 0, 0.03, 0.03, b, b + 1.0, Kind.DarkMetal);
    }
  }

  // ── rail ────────────────────────────────────────────────────────────────
  private railCell(x: number, y: number): void {
    const w = this.world;
    const own = profileOf(RoadType.Rail);
    let m = 0;
    for (let d = 0; d < 4; d++) if (this.conn(x, y, d)) m |= DIR_BIT[d];
    const n = popcount(m);
    if (n === 1) {
      const d = [0, 1, 2, 3].find((i) => m & DIR_BIT[i])!;
      const o = (d + 2) & 3;
      if (!w.inBounds(x + DIR_DX[o], y + DIR_DY[o])) m |= DIR_BIT[o];
    }
    const nn = popcount(m);
    if (nn === 2 && (m === 5 || m === 10)) return this.railRows(x, y, m === 5 ? 0 : 1, false, own, -1);
    if (nn === 2) return this.railRows(x, y, m === 3 ? 0 : m === 6 ? 1 : m === 12 ? 2 : 3, true, own, -1);
    if (nn <= 1) {
      const d = nn === 1 ? [0, 1, 2, 3].find((i) => m & DIR_BIT[i])! : 0;
      return this.railRows(x, y, d, false, own, nn === 1 ? 1 : 2);
    }
    this.railJunction(x, y, m);
  }

  private railSection(bridge: boolean, painted: boolean): Section {
    const f = painted ? MF.Tracks : 0;
    if (bridge)
      return { kind: [Kind.Concrete, Kind.Ballast, Kind.Concrete], style: [RoadType.Rail, RoadType.Rail, RoadType.Rail], flags: [0, f, 0], split: [1, 2, 1], wall: [Kind.Concrete, Kind.Concrete, Kind.Concrete] };
    return {
      kind: [Kind.Grass, Kind.Ballast, Kind.Ballast, Kind.Ballast, Kind.Grass],
      style: [RoadType.Rail, RoadType.Rail, RoadType.Rail, RoadType.Rail, RoadType.Rail],
      flags: [0, 0, f, 0, 0],
      split: [1, 1, 2, 1, 1],
      wall: [Kind.Concrete, Kind.Concrete, Kind.Concrete, Kind.Concrete, Kind.Concrete],
    };
  }

  /** straight / curve / dead-end rail piece; buffers: 1 = stop at the S end, 2 = both ends */
  private railRows(x: number, y: number, k: number, curved: boolean, own: Profile, buffers: number): void {
    const fr = this.fr.set(x, y, k);
    const bridge = fr.bridge;
    if (bridge) this.shadow = true;
    const map = curved ? curveMap : straightMap;
    const painted = this.lod > 0;
    const sec = this.railSection(bridge, painted);
    const n = curved ? (this.lod === 0 ? 8 : 4) : fr.raised || bridge ? (this.lod === 0 ? 4 : 2) : 1;
    const rows: Row[] = [];
    for (let i = 0; i <= n; i++) {
      const tau = (i / n) * 16;
      if (bridge) {
        const e = 5.0;
        rows.push({ tau, b: [-e, -4.6, 4.6, e], la: [BALLAST_TOP + 0.35, BALLAST_TOP, BALLAST_TOP + 0.35], lb: [BALLAST_TOP + 0.35, BALLAST_TOP, BALLAST_TOP + 0.35], hw: own.hw, mask: 0xffff });
        continue;
      }
      const bt = own.ballast;
      rows.push({
        tau,
        b: [-own.hw, -own.hw, -bt, bt, own.hw, own.hw],
        la: [SINK, SINK, BALLAST_TOP, BALLAST_TOP, SINK],
        lb: [SINK, BALLAST_TOP, BALLAST_TOP, SINK, SINK],
        hw: own.hw,
        mask: 0xffff,
      });
    }
    emitRows(this.buf, fr, sec, rows, map, { skirtL: bridge || fr.raised, skirtR: bridge || fr.raised, bottom: bridge, skirtKind: Kind.Concrete });
    if (!painted) {
      const t1 = buffers >= 1 ? 14.2 : 16, t0 = buffers === 2 ? 1.8 : 0;
      for (const c of own.tracks) this.track(map, c, t0, t1, curved);
      if (buffers >= 1) this.bufferStop(map, 14.6, own);
      if (buffers === 2) this.bufferStop(map, 1.4, own);
    }
    if (bridge) {
      this.railingsAlong(map, rows, own);
      if (!curved) this.bridgeExtras(x, y, rows, k, (k + 2) & 3);
    }
  }

  private railJunction(x: number, y: number, m: number): void {
    const fr = this.fr.set(x, y, 0);
    const buf = this.buf;
    const bridge = fr.bridge;
    const painted = this.lod > 0;
    const own = profileOf(RoadType.Rail);
    const arm = [0, 1, 2, 3].map((d) => (m & DIR_BIT[d]) !== 0);
    let jf = 0;
    if (arm[0] && arm[2]) jf |= JF.NS;
    if (arm[1] && arm[3]) jf |= JF.EW;
    for (let q = 0; q < 4; q++) {
      const a = q, b = (q + 1) & 3;
      if (arm[a] && arm[b] && (!arm[(a + 2) & 3] || !arm[(b + 2) & 3])) jf |= [JF.NE, JF.SE, JF.SW, JF.NW][q];
    }
    const pflags = painted ? jf | MF.Tracks : 0;
    if (!bridge) {
      const sides: SideInfo[] = arm.map((c) => ({ a: own.ballast, sw: own.hw - own.ballast, ch: 0, f: 0, conn: c }));
      for (let q = 0; q < 4; q++) {
        fr.set(x, y, q);
        this.quadrant(own, sides[q], sides[(q + 1) & 3], pflags, false, true);
      }
    } else {
      this.shadow = true;
      const c = code(Kind.Ballast, STYLE_JUNCTION, pflags);
      const G = this.lod === 0 ? 4 : 2;
      const ids: number[] = [];
      for (let j = 0; j <= G; j++)
        for (let i = 0; i <= G; i++) {
          fr.w((i / G) * 16, (j / G) * 16);
          const nn = fr.normal(fr.X, fr.Z);
          ids.push(buf.vtx(fr.X, fr.base(fr.X, fr.Z) + BALLAST_TOP, fr.Z, nn.x, nn.y, nn.z, 0, 0, 8, c));
        }
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) buf.quadUp(ids[j * (G + 1) + i], ids[j * (G + 1) + i + 1], ids[(j + 1) * (G + 1) + i + 1], ids[(j + 1) * (G + 1) + i]);
      this.bridgeJunctionShell(x, y, [0, 1, 2, 3].map((d) => ({ a: 4.6, sw: 0, ch: BALLAST_TOP - ROAD, f: 0, conn: arm[d] })));
    }
    if (painted) return;
    fr.set(x, y, 0);
    if (jf & JF.NS) for (const c2 of own.tracks) this.track(straightMap, c2, 0, 16, false, 0);
    if (jf & JF.EW) for (const c2 of own.tracks) this.track(straightMap, c2, 0, 16, false, 1);
    for (let q = 0; q < 4; q++) if (jf & [JF.NE, JF.SE, JF.SW, JF.NW][q]) for (const c2 of own.tracks) this.track(curveMap, c2, 0, 16, true, q);
  }

  /** sleepers + two rails along lateral offset c of a mapper (frame rotation optional) */
  private track(map: Mapper, c: number, t0: number, t1: number, curved: boolean, k = -1): void {
    const fr = this.fr;
    if (k >= 0) fr.set(fr.cx, fr.cy, k);
    const buf = this.buf;
    const o = this.tmp;
    // arc length along this track
    const scale = curved ? ((8 + c) * HALF_PI) / 16 : 1;
    const len = (t1 - t0) * scale;
    const nS = Math.max(1, Math.round(len / 0.62));
    for (let i = 0; i < nS; i++) {
      const tau = t0 + ((i + 0.5) / nS) * (t1 - t0);
      map(c, tau, o);
      fr.w(o.u, o.v);
      const X = fr.X, Z = fr.Z;
      map(c + 0.1, tau, this.tmp2);
      fr.d(this.tmp2.u - o.u, this.tmp2.v - o.v);
      const lx = fr.DX, lz = fr.DZ;
      const n = fr.normal(X, Z);
      // instanced concrete sleeper, tilted with the bed, base 4 cm inside the ballast
      this.fb.addOriented(FT.Sleeper, X, fr.base(X, Z) + BALLAST_TOP - 0.04, Z, lx, lz, n.x, n.y, n.z);
    }
    const seg = curved ? (this.lod === 0 ? 8 : 4) : fr.raised || fr.bridge ? 4 : 1;
    const prof: [number, number][] = [[0.036, 0], [0.036, 0.14], [-0.036, 0.14], [-0.036, 0]];
    for (const g of [-GAUGE_HALF, GAUGE_HALF]) extrude(buf, fr, map, c + g, t0, t1, seg, prof, SLEEPER_TOP, Kind.Rail);
  }
  private tmp2: V2 = { u: 0, v: 0 };

  private bufferStop(map: Mapper, tau: number, own: Profile): void {
    const fr = this.fr;
    for (const c of own.tracks) {
      map(c, tau, this.tmp);
      fr.w(this.tmp.u, this.tmp.v);
      const X = fr.X, Z = fr.Z;
      const [lx, lz] = fr.dir(-1, 0);
      const bh = fr.base(X, Z);
      box(this.buf, X, Z, Math.atan2(-lz, lx), 1.1, 0.35, bh + SLEEPER_TOP, bh + SLEEPER_TOP + 1.05, Kind.Hazard);
    }
  }
}

/** cell size helper for callers */
export const CELL_M = CELL;
