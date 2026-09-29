// Deterministic display names for buildings (zoned buildings get plausible
// names from their seed; services use their catalog name).
import { ZoneType, type Building } from '../core/types';
import {
  FARM_KINDS, FOREST_KINDS, IND_KINDS, LAST_NAMES, MALL_KINDS, MINE_KINDS, OFFICE_KINDS, OFFICE_WORDS, OIL_KINDS, RES_SUFFIX_HIGH,
  RES_SUFFIX_LOW, RES_SUFFIX_MED, SHOP_KINDS, STREET_WORDS, pickName,
} from '../data/names';
import { zoneDef } from '../data/zones';
import { defOf } from './catalog';

export function buildingTitle(b: Building): string {
  if (b.name) return b.name;
  if (b.kind === 'service') return defOf(b.defId)?.name ?? 'Building';
  const s = b.seed;
  const family = pickName(LAST_NAMES, s, 11);
  const word = pickName(STREET_WORDS, s, 12);
  switch (b.zone) {
    case ZoneType.ResLow: {
      const v = pickName([0, 1, 2], s, 13);
      const pre = v === 0 ? `The ${family}` : v === 1 ? word : family;
      return `${pre} ${pickName(RES_SUFFIX_LOW, s, 14)}`;
    }
    case ZoneType.ResMed:
      return `${word} ${pickName(RES_SUFFIX_MED, s, 14)}`;
    case ZoneType.ResHigh:
      return `${word} ${pickName(RES_SUFFIX_HIGH, s, 14)}`;
    case ZoneType.MixedUse:
      return `${word} ${pickName(['Lofts', 'Arcade', 'Block', 'Galleries', 'Commons', 'Market Flats'], s, 14)}`;
    case ZoneType.ComLow:
      return `${family}'s ${pickName(SHOP_KINDS, s, 15)}`;
    case ZoneType.ComHigh:
      return `${word} ${pickName(MALL_KINDS, s, 15)}`;
    case ZoneType.Office:
      return `${pickName(OFFICE_WORDS, s, 16)} ${pickName(OFFICE_KINDS, s, 17)}`;
    case ZoneType.Industry:
      return `${family} ${pickName(IND_KINDS, s, 18)}`;
    case ZoneType.Farming:
      return `${family} ${pickName(FARM_KINDS, s, 19)}`;
    case ZoneType.Forestry:
      return `${word} ${pickName(FOREST_KINDS, s, 19)}`;
    case ZoneType.Mining:
      return `${word} ${pickName(MINE_KINDS, s, 19)}`;
    case ZoneType.Oil:
      return `${word} ${pickName(OIL_KINDS, s, 19)}`;
  }
  return zoneDef(b.zone)?.name ?? 'Building';
}
