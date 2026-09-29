// Vehicle paint palettes (sRGB hex). Private cars follow real-world color
// statistics (whites, blacks, greys and silvers dominate, then blues and reds,
// with the occasional bright color); commercial and service fleets get their
// own liveries. Deterministic per vehicle seed.
import { hashFloat } from '../../core/rng';
import { Model } from './types';

const CAR_PAINT: [number, number][] = [
  // [color, weight]
  [0xf2f2ef, 14], [0xe9ebe8, 7], [0xdcdcd6, 3], // whites / pearl
  [0x17181b, 10], [0x0d0e10, 5], [0x2a2b2f, 4], // blacks
  [0xa9adb2, 8], [0xc3c7cb, 5], [0x8c9095, 4], // silvers
  [0x5b5f64, 6], [0x44484d, 5], [0x6f7277, 3], // greys
  [0x1f3e6e, 4], [0x2c5aa0, 3], [0x0f2240, 2], [0x5d86b8, 1.5], // blues
  [0x9c1b1f, 3], [0xc42a22, 2.5], [0x6a1216, 1.5], // reds
  [0x2c4a33, 1.2], [0x51603f, 0.8], // greens
  [0x7a5a3c, 0.8], [0xb49c78, 0.9], [0x4a3426, 0.6], // browns / beige
  [0xe0b21c, 0.5], [0xe86a1a, 0.5], [0x2a9d8f, 0.4], [0x7d3c98, 0.3], [0xd9e021, 0.2], // bright
];
const CAR_TOTAL = CAR_PAINT.reduce((s, c) => s + c[1], 0);

const VAN_PAINT = [0xf4f4f1, 0xf4f4f1, 0xf4f4f1, 0xe8e9e6, 0x2d5ea8, 0xc62d25, 0xf0c419, 0x3a3d42, 0x1c7c54];
const TRUCK_PAINT = [0xf4f4f1, 0xf4f4f1, 0xe3e5e2, 0x1f4e8c, 0xb81d18, 0xe8b10f, 0x2f7d44, 0x2b2e33, 0xe86a1a];
const PICKUP_PAINT = [0xf2f2ef, 0x17181b, 0x9c1b1f, 0x1f3e6e, 0x5b5f64, 0xa9adb2, 0x2c4a33, 0x7a5a3c];
const SPORTS_PAINT = [0xc42a22, 0xe0b21c, 0x17181b, 0xf2f2ef, 0x2c5aa0, 0xe86a1a, 0x2a9d8f, 0xa9adb2];
const BIKE_PAINT = [0x1d6fb8, 0xc0392b, 0x27ae60, 0x2c3e50, 0xf1c40f, 0xecf0f1, 0x8e44ad, 0xe67e22];
const GARBAGE_PAINT = [0x2f7d44, 0xf2f2ef, 0xe86a1a, 0x5a6a2c];

function vary(c: number, seed: number): number {
  // tiny brightness jitter so identical paints are not perfectly uniform
  const k = 0.94 + hashFloat(seed, 91) * 0.1;
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function paintFor(model: Model, seed: number): number {
  const h = hashFloat(seed, 17);
  const pick = (arr: number[]) => arr[Math.floor(h * arr.length) % arr.length];
  switch (model) {
    case Model.Taxi:
      return 0xf2c21b;
    case Model.Police:
      return 0xf4f5f7;
    case Model.FireTruck:
      return 0xb8141a;
    case Model.Ambulance:
      return 0xf6f6f2;
    case Model.Hearse:
      return 0x101113;
    case Model.PostVan:
      return 0xf2c230;
    case Model.Utility:
      return 0xe8a317;
    case Model.Garbage:
      return pick(GARBAGE_PAINT);
    case Model.DeliveryVan:
      return vary(pick(VAN_PAINT), seed);
    case Model.BoxTruck:
    case Model.SemiTractor:
    case Model.SemiTrailer:
      return vary(pick(TRUCK_PAINT), seed);
    case Model.Pickup:
      return vary(pick(PICKUP_PAINT), seed);
    case Model.Sports:
      return pick(SPORTS_PAINT);
    case Model.Bicycle:
      return pick(BIKE_PAINT);
    default: {
      let r = h * CAR_TOTAL;
      for (const [c, w] of CAR_PAINT) {
        r -= w;
        if (r <= 0) return vary(c, seed);
      }
      return 0xa9adb2;
    }
  }
}

/** Nice, distinguishable transit line colors (assigned in order, skipping ones in use). */
export const LINE_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#fdd835', '#d81b60',
  '#3949ab', '#7cb342', '#6d4c41', '#00897b', '#f4511e', '#5e35b1', '#c0ca33', '#546e7a',
];
