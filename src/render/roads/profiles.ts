// Road cross-section profiles shared by the road renderer (geometry + shader
// markings) and — through `laneOffsets` — by anything that needs to place
// vehicles or props on a lane. All distances are meters measured laterally
// from the road center line. A cell is 16 m wide, so every profile satisfies
// hw + sw + fringe <= 8.
import { RoadType } from '../../core/types';

/** Surface kinds understood by the road material shader (fits in 4 bits). */
export const enum Kind {
  Asphalt = 0,
  Gravel = 1,
  Pavers = 2,
  Sidewalk = 3,
  Curb = 4,
  Grass = 5,
  Ballast = 6,
  Concrete = 7,
  Rail = 8,
  Galvanized = 9,
  Sleeper = 10,
  DarkMetal = 11,
  Hazard = 12,
}

/** Marking styles (RoadType values 1..8 plus the two specials below). */
export const STYLE_JUNCTION = 9;
export const STYLE_NONE = 10;

/** Per-vertex marking flags (row-based pieces). */
export const enum MF {
  Mark = 1, // lane markings enabled
  X0 = 2, // crosswalk + stop line at the t≈0 end
  X1 = 4, // crosswalk + stop line at the t≈16 end
  Mid = 8, // mid-block crosswalk (pedestrian street crossing)
  Taper = 16, // width transition: only center + edge lines
  Bridge = 32, // on a deck (no gutter puddles)
  Tracks = 64, // painted rail tracks (ballast far LOD) / tram rails
}

/** Junction flags: embedded track pieces in world orientation. */
export const enum JF {
  NS = 1,
  EW = 2,
  NE = 4,
  SE = 8,
  SW = 16,
  NW = 32,
  Tram = 64, // tracks are tram rails (else painted heavy rail on ballast)
}

export interface Profile {
  type: RoadType;
  /** edge-profile precedence: the lower rank wins at a mixed edge */
  rank: number;
  /** carriageway half width (asphalt / gravel / pavers) */
  hw: number;
  /** sidewalk width (0 = none) */
  sw: number;
  /** sidewalk lift above the carriageway (curb height) */
  ch: number;
  /** carriageway surface kind */
  kind: Kind;
  /** raised median island half width (boulevard) */
  median: number;
  /** concrete jersey barrier on the center line (highway) */
  barrier: boolean;
  /** desired curb radius at junction corners */
  radius: number;
  /** has sidewalk street lamps */
  lamps: boolean;
  /** half width of the rail ballast top (rail only) */
  ballast: number;
  /** lateral offset of each track center (rail) or tram track center */
  tracks: number[];
  /** car-carrying road (for signals, crosswalks) */
  cars: boolean;
  /** width of the ragged unpaved fringe that blends the surface into the terrain (gravel) */
  fringe: number;
}

const CURB = 0.16; // SIDEWALK_LIFT - ROAD_LIFT

function P(p: Partial<Profile> & Pick<Profile, 'type' | 'rank' | 'hw'>): Profile {
  return {
    sw: 0, ch: 0, kind: Kind.Asphalt, median: 0, barrier: false, radius: 3, lamps: false, ballast: 0, tracks: [], cars: true, fringe: 0,
    ...p,
  };
}

export const PROFILES: Profile[] = [];
PROFILES[RoadType.Dirt] = P({ type: RoadType.Dirt, rank: 1, hw: 3.3, kind: Kind.Gravel, radius: 2.5, fringe: 1.1 });
PROFILES[RoadType.Street] = P({ type: RoadType.Street, rank: 2, hw: 4.25, sw: 1.75, ch: CURB, radius: 3.2, lamps: true });
PROFILES[RoadType.Avenue] = P({ type: RoadType.Avenue, rank: 3, hw: 5.75, sw: 2.25, ch: CURB, radius: 3.5, lamps: true });
PROFILES[RoadType.TramAvenue] = P({ type: RoadType.TramAvenue, rank: 3, hw: 5.75, sw: 2.25, ch: CURB, radius: 3.5, lamps: true, tracks: [-1.53, 1.53] });
PROFILES[RoadType.Boulevard] = P({ type: RoadType.Boulevard, rank: 4, hw: 6.4, sw: 1.6, ch: CURB, radius: 3.5, median: 1.0, lamps: true });
PROFILES[RoadType.Highway] = P({ type: RoadType.Highway, rank: 5, hw: 7.7, radius: 4, barrier: true, lamps: true });
PROFILES[RoadType.Pedestrian] = P({ type: RoadType.Pedestrian, rank: 0, hw: 8, kind: Kind.Pavers, radius: 0, lamps: true, cars: false });
PROFILES[RoadType.Rail] = P({ type: RoadType.Rail, rank: 0, hw: 5.3, kind: Kind.Ballast, ballast: 4.2, tracks: [-2.0, 2.0], radius: 0, cars: false });

export function profileOf(t: RoadType): Profile {
  return PROFILES[t] ?? PROFILES[RoadType.Street];
}

/** Standard track gauge half width (m). */
export const GAUGE_HALF = 0.7175;
/** Boulevard median / highway barrier half widths used by the marking shader. */
export const BOULEVARD_MEDIAN = 1.0;
export const HIGHWAY_BARRIER = 0.35;

/**
 * Lane center offsets (m) for ONE travel direction, measured to the right of
 * the direction of travel (right-hand traffic; mirror for left-hand). Ordered
 * from the innermost (fast) lane to the curb lane. Matches the painted lines.
 */
export function laneOffsets(t: RoadType): number[] {
  const p = profileOf(t);
  switch (t) {
    case RoadType.Dirt:
      return [1.6];
    case RoadType.Street:
      return [p.hw * 0.5 - 0.1];
    case RoadType.Avenue:
    case RoadType.TramAvenue: {
      const inner = 0.23, outer = p.hw - 0.35, div = inner + (outer - inner) / 2;
      return [(inner + div) / 2, (div + outer) / 2];
    }
    case RoadType.Boulevard: {
      const inner = BOULEVARD_MEDIAN + 0.25, outer = p.hw - 0.35, lw = (outer - inner) / 3;
      return [inner + lw * 0.5, inner + lw * 1.5, inner + lw * 2.5];
    }
    case RoadType.Highway: {
      const inner = 0.8, outer = p.hw - 0.7, lw = (outer - inner) / 3;
      return [inner + lw * 0.5, inner + lw * 1.5, inner + lw * 2.5];
    }
    case RoadType.Pedestrian:
      return [1.5];
    case RoadType.Rail:
      return [2.0];
    default:
      return [2];
  }
}
