// Shared traffic constants: vehicle render models, compositions (multi-section
// vehicles), flags, trip purposes and per-type driving parameters. Used by the
// simulation (TrafficSystem) and the renderer (VehicleRenderer). No THREE here.
import type { TransitMode, VehicleType } from '../../core/types';

/** Procedural render models (one InstancedMesh family per model). */
export const enum Model {
  Sedan = 0,
  Hatchback,
  SUV,
  Pickup,
  Minivan,
  Sports,
  Taxi,
  DeliveryVan,
  BoxTruck,
  SemiTractor,
  SemiTrailer,
  Bus,
  TramHead,
  TramMid,
  Locomotive,
  Carriage,
  Metro,
  FireTruck,
  Police,
  Ambulance,
  Garbage,
  Hearse,
  Bicycle,
  Utility,
  Ferry,
  MonorailHead,
  MonorailMid,
  CargoWagon,
  PostVan,
  COUNT,
}
export const MODEL_COUNT = Model.COUNT as number;

export const MODEL_NAMES: string[] = [
  'Sedan', 'Hatchback', 'SUV', 'Pickup', 'Minivan', 'Sports car', 'Taxi', 'Delivery van', 'Box truck', 'Semi truck', 'Semi trailer',
  'Bus', 'Tram', 'Tram', 'Locomotive', 'Carriage', 'Metro', 'Fire engine', 'Police car', 'Ambulance', 'Garbage truck', 'Hearse',
  'Bicycle', 'Utility truck', 'Ferry', 'Monorail', 'Monorail', 'Freight wagon', 'Mail van',
];

/** Body length (m) of each model along its local +Z axis (front = +Z). */
export const MODEL_LEN: number[] = [
  4.6, 4.0, 4.7, 5.3, 4.9, 4.4, 4.6, 5.6, 7.6, 6.2, 12.4,
  12.0, 10.4, 8.6, 18.6, 20.0, 17.0, 8.8, 4.7, 6.2, 8.4, 5.6,
  1.8, 5.4, 26.0, 11.0, 9.0, 16.0, 5.0,
];
/** Half body width (m). */
export const MODEL_HALF_W: number[] = [
  0.9, 0.86, 0.95, 0.97, 0.95, 0.92, 0.9, 1.0, 1.2, 1.25, 1.25,
  1.28, 1.2, 1.2, 1.5, 1.5, 1.45, 1.25, 0.9, 1.05, 1.25, 0.95,
  0.3, 1.0, 4.2, 1.35, 1.35, 1.45, 0.98,
];

/** Vehicle type string ↔ index (for typed arrays). */
export const VTYPES: VehicleType[] = ['car', 'taxi', 'truck', 'van', 'bus', 'tram', 'metro', 'train', 'firetruck', 'police', 'ambulance', 'garbage', 'hearse', 'service', 'bike'];
export const VT: Record<VehicleType, number> = Object.fromEntries(VTYPES.map((t, i) => [t, i])) as Record<VehicleType, number>;

/** Vehicle flags (Uint16). */
export const enum VF {
  Siren = 1, // emergency light bar flashing
  Service = 2,
  Transit = 4,
  Bike = 8,
  Free = 16, // follows a world-space polyline (metro, ferry, monorail)
  Beacon = 32, // amber roof beacon (utility, garbage)
  NoFollow = 64, // not a leader for car following (bikes, parked service)
  Long = 128, // multi-section vehicle
  Underground = 256, // metro: simulated, never drawn
  Return = 512, // service vehicle heading back to its depot
  Elevated = 1024, // monorail
  Water = 2048, // ferry
  Outside = 4096, // trip starts or ends outside the map
}

/** Vehicle life states. */
export const enum VS {
  Free = 0, // slot unused
  Pending = 1, // reserved id, waiting for a path
  Drive = 2,
  Dwell = 3, // transit stop
  OnScene = 4, // service vehicle parked at its target
  Waiting = 5, // parked, waiting for a new path (service return)
}

/** Trip purposes (labels + statistics). */
export const enum Purpose {
  Commute = 0,
  Home,
  Shop,
  Leisure,
  Freight,
  Export,
  Import,
  Tourist,
  Visitor,
  Taxi,
  Service,
  Transit,
  Cargo,
  Patrol,
  Mail,
}
export const PURPOSE_LABEL: string[] = [
  'Commuting to work', 'Heading home', 'Going shopping', 'Out for leisure', 'Delivering goods', 'Exporting goods', 'Importing goods',
  'Tourist visiting', 'Visiting from out of town', 'Taxi fare', 'Responding', 'In service', 'Freight train', 'On patrol', 'Delivering mail',
];

/** Path search modes (shared with the path worker). */
export const enum PMode {
  Car = 0,
  Service = 1, // cars + pedestrian streets
  Rail = 2,
  Tram = 3,
  Water = 4,
  Monorail = 5,
}
export const PMODE_COUNT = 6;

/** Composition of a (possibly multi-section) vehicle. */
export const enum Comp {
  Single = 0,
  Semi, // tractor + trailer
  Tram, // head + mid + head reversed
  Train, // loco + n carriages + loco reversed (push-pull)
  Cargo, // loco + n wagons
  Monorail, // head + mid + head reversed
}

/** gap between consecutive sections (m) */
export const SECTION_GAP: number[] = [0, 0.4, 0.35, 0.9, 0.9, 0.3];

export function sectionModel(comp: number, k: number, n: number, head: Model): Model {
  switch (comp) {
    case Comp.Semi:
      return k === 0 ? Model.SemiTractor : Model.SemiTrailer;
    case Comp.Tram:
      return k === 0 || k === n - 1 ? Model.TramHead : Model.TramMid;
    case Comp.Train:
      return k === 0 || k === n - 1 ? Model.Locomotive : Model.Carriage;
    case Comp.Cargo:
      return k === 0 ? Model.Locomotive : Model.CargoWagon;
    case Comp.Monorail:
      return k === 0 || k === n - 1 ? Model.MonorailHead : Model.MonorailMid;
    default:
      return head;
  }
}
/** true when section k is drawn facing backwards (rear cab of push-pull units) */
export function sectionReversed(comp: number, k: number, n: number): boolean {
  return k > 0 && k === n - 1 && (comp === Comp.Tram || comp === Comp.Train || comp === Comp.Monorail);
}
export function sectionLen(comp: number, k: number, n: number, head: Model): number {
  return MODEL_LEN[sectionModel(comp, k, n, head)];
}
export function compositionLength(comp: number, n: number, head: Model): number {
  let L = 0;
  for (let k = 0; k < n; k++) L += sectionLen(comp, k, n, head);
  return L + SECTION_GAP[comp] * Math.max(0, n - 1);
}

/** IDM driving parameters per vehicle type: [max accel, comfortable decel, speed factor] */
export const DRIVE: Record<VehicleType, [number, number, number]> = {
  car: [2.2, 3.0, 1.0],
  taxi: [2.3, 3.2, 1.03],
  truck: [1.1, 2.5, 0.85],
  van: [1.7, 2.8, 0.95],
  bus: [1.2, 2.2, 0.82],
  tram: [1.0, 1.8, 0.8],
  metro: [1.1, 1.3, 1.0],
  train: [0.7, 1.1, 0.62],
  firetruck: [1.6, 3.2, 1.1],
  police: [2.8, 3.8, 1.18],
  ambulance: [2.2, 3.4, 1.14],
  garbage: [1.0, 2.4, 0.78],
  hearse: [1.6, 2.6, 0.9],
  service: [1.4, 2.6, 0.9],
  bike: [1.0, 2.0, 1.0],
};

/** transit line vehicles */
export const TRANSIT_TYPE: Record<TransitMode, VehicleType> = { bus: 'bus', tram: 'tram', metro: 'metro', train: 'train', ferry: 'service', monorail: 'train' };
export const TRANSIT_CAPACITY: Record<TransitMode, number> = { bus: 30, tram: 90, metro: 180, train: 240, ferry: 60, monorail: 150 };
/** cruise speed (m/s) of free-path transit */
export const FREE_SPEED: Record<TransitMode, number> = { bus: 12, tram: 12, metro: 21, train: 24, ferry: 7.5, monorail: 17 };
/** seconds a line vehicle dwells at a stop */
export const DWELL: Record<TransitMode, number> = { bus: 4.5, tram: 5.5, metro: 6, train: 9, ferry: 10, monorail: 6 };

/** Height of the monorail running surface above the road (m). */
export const MONORAIL_HEIGHT = 9.2;
/** Depth of metro tunnels below the terrain (m). */
export const METRO_DEPTH = 14;
