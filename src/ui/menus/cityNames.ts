// City name generator for the New City dialog: a large curated list plus
// theme-flavoured compositions (prefix/root/suffix) so names stay plausible.
import type { ThemeId } from '../../core/types';

const CURATED = [
  'New Harbor', 'Port Aurelia', 'Silverbrook', 'Ashford', 'Maple Falls', 'Riverton', 'Brightwater', 'Stonehaven',
  'Kingsbridge', 'Oakridge', 'Fairhaven', 'Lakeshore', 'Glenmoor', 'Westmere', 'Eastwick', 'Northgate', 'Southport',
  'Cedar Point', 'Pinecrest', 'Willowdale', 'Elmstead', 'Harrowfield', 'Clearwater', 'Redcliff', 'Blackwood',
  'Greenhollow', 'Highbury', 'Lowell Bay', 'Summerset', 'Winterfell Ridge', 'Autumn Vale', 'Springhill', 'Goldcrest',
  'Copperton', 'Ironvale', 'Marblehead', 'Granite Falls', 'Sandport', 'Bayview', 'Seacliff', 'Coral Bay', 'Tidewater',
  'Harborview', 'Lighthouse Point', 'Anchorage Cove', 'Saltmarsh', 'Driftwood', 'Moonlake', 'Starfield', 'Sunhaven',
  'Skyview', 'Cloudcrest', 'Thornbury', 'Rosewood', 'Lavender Hill', 'Heatherfield', 'Foxborough', 'Wolfden',
  'Bearbrook', 'Eagle Rock', 'Falcon Heights', 'Hawksmoor', 'Ravenscar', 'Swanlake', 'Kestrel Point', 'Otterburn',
  'Beaverton', 'Deerfield', 'Elkhorn', 'Bison Plains', 'Millbrook', 'Mill Valley', 'Bridgewater', 'Crossroads',
  'Junction City', 'Union Falls', 'Liberty Bay', 'Concordia', 'Harmony', 'Providence', 'Prosperity', 'Unity Point',
  'Meridian', 'Zenith', 'Horizon City', 'Aurora', 'Solace', 'Arcadia', 'Elysium Park', 'Avalon', 'Camelot Green',
  'Brookhaven', 'Fernhill', 'Mossbank', 'Birchwood', 'Alderney', 'Hazelmere', 'Hollybrook', 'Ivy Crossing', 'Juniper',
  'Larkspur', 'Magnolia', 'Nettlebed', 'Primrose', 'Quince Hill', 'Sorrel Bay', 'Tansy Fields', 'Verbena', 'Yarrow',
  'Amberley', 'Beaumont', 'Chesterfield', 'Dunmore', 'Everton', 'Fulbright', 'Grantham', 'Hartwell', 'Irvington',
  'Kensal', 'Langley', 'Montrose', 'Newbury', 'Oldham Cross', 'Pemberton', 'Queensbury', 'Rutherford', 'Stratford',
  'Thornton', 'Uxbridge', 'Vauxhall', 'Whitby', 'Yorkton', 'Belmont', 'Carlisle', 'Dorchester', 'Exeter Bay',
  'Wrenfield', 'Lanternfall', 'Cinderford', 'Emberly', 'Glimmerton', 'Starling', 'Windmere', 'Rainford', 'Mistvale',
  'Frostmere', 'Sunstone', 'Crystal Springs', 'Emerald Bay', 'Sapphire Coast', 'Opal Ridge', 'Jade Harbor', 'Ruby Falls',
];

const PREFIX = ['New', 'Port', 'Lake', 'Mount', 'Fort', 'East', 'West', 'North', 'South', 'Upper', 'Lower', 'Old', 'Saint', 'Great', 'Little', 'Glen', 'Bay'];
const ROOTS = [
  'Ash', 'Oak', 'Elm', 'Birch', 'Cedar', 'Maple', 'Pine', 'Willow', 'Stone', 'River', 'Brook', 'Mill', 'Bridge', 'King',
  'Queen', 'Red', 'Green', 'Black', 'White', 'Silver', 'Gold', 'Iron', 'Fair', 'Clear', 'Bright', 'High', 'Wolf', 'Fox',
  'Hawk', 'Raven', 'Swan', 'Deer', 'Harrow', 'Thorn', 'Rose', 'Heather', 'Marsh', 'Cliff', 'Sand', 'Salt', 'Wind',
  'Rain', 'Sun', 'Moon', 'Star', 'Frost', 'Amber', 'Copper', 'Crystal', 'Hazel', 'Holly', 'Lark', 'Wren', 'Bramble',
  'Kings', 'Hart', 'Chester', 'Dun', 'Mor', 'Lang', 'Pem', 'Ruther', 'Staf', 'Wex', 'Carl', 'Bel', 'Tam', 'Wel',
];
const SUFFIX = [
  'ton', 'ford', 'field', 'bury', 'wick', 'stead', 'haven', 'port', 'mouth', 'vale', 'dale', 'wood', 'brook', 'bridge',
  'moor', 'mere', 'ridge', 'crest', 'gate', 'ham', 'ley', 'worth', 'burg', 'ville', 'view', 'shire', 'minster', 'cliff',
  'hollow', 'land', 'hurst', 'combe', 'by', 'thorpe', 'well', 'wood', 'side', 'water', 'fall',
];
const TAIL = ['Heights', 'Springs', 'Falls', 'Harbor', 'Park', 'Hills', 'Crossing', 'Point', 'Valley', 'Landing', 'Junction', 'Bay', 'Shores', 'Gardens', 'Commons'];

const THEMED: Record<ThemeId, { names: string[]; prefix: string[]; roots: string[]; suffix: string[] }> = {
  temperate: { names: [], prefix: [], roots: [], suffix: [] },
  boreal: {
    names: ['Nordvik', 'Fjellheim', 'Isafjord', 'Kaldmark', 'Sølvberg', 'Granhavn', 'Frostvik', 'Ravnsund', 'Tallinmark', 'Birkeland', 'Nordholm', 'Vinterhavn', 'Lysefjord', 'Skjoldvik', 'Ulvsund'],
    prefix: ['Nord', 'Fjell', 'Vinter', 'Kald', 'Is', 'Ravn', 'Ulv', 'Gran', 'Birke', 'Stor', 'Lille', 'Sol', 'Mørke', 'Havn', 'Skog'],
    roots: [],
    suffix: ['vik', 'heim', 'fjord', 'sund', 'havn', 'berg', 'holm', 'dal', 'lund', 'nes', 'mark', 'by', 'stad', 'øy', 'strand'],
  },
  desert: {
    names: ['Mesa Verde', 'Oasis Springs', 'Dune Harbor', 'Sandstone', 'Red Mesa', 'Sol Vista', 'Palm Hollow', 'Mirage', 'Canyon Rim', 'Dry Creek', 'Agave Flats', 'Coyote Wells', 'Saguaro', 'Amber Dunes', 'El Oro', 'Las Piedras', 'Qasr Nour', 'Al Wadi', 'Zahra', 'Sirocco'],
    prefix: ['Mesa', 'Sol', 'Palm', 'Red', 'Dune', 'Canyon', 'Oasis', 'Coyote', 'Sand', 'Sun', 'Dry', 'El', 'Las', 'Al'],
    roots: [],
    suffix: [' Wells', ' Springs', ' Flats', ' Mesa', ' Rim', ' Vista', ' Dunes', ' Wash', ' Gulch', ' Oasis', ' Butte', ' Pueblo'],
  },
  tropical: {
    names: ['Isla Bonita', 'Coral Cove', 'Palmera', 'Laguna Azul', 'Bahía Clara', 'Turquoise Bay', 'Mango Point', 'Coconut Grove', 'Vista Mar', 'Puerto Sol', 'Kailani', 'Maru Bay', 'Hibiscus Key', 'Lagoon City', 'Monsoon Point', 'Isla Verde', 'Porto Belo', 'Sandy Key'],
    prefix: ['Isla', 'Puerto', 'Bahía', 'Porto', 'Coral', 'Palm', 'Laguna', 'Mango', 'Cay', 'Vista'],
    roots: [],
    suffix: [' Key', ' Cove', ' Bay', ' Lagoon', ' Reef', ' Grove', ' Beach', ' Point', ' Sands', ' Island'],
  },
  alpine: {
    names: ['Edelweiss', 'Hochwald', 'Bergdorf', 'Val d’Or', 'Glacier Point', 'Alpenrose', 'Schneeberg', 'Kristallsee', 'Eisental', 'Sonnalp', 'Matterhorn Vale', 'Lärchenbach', 'Gipfelstadt', 'Mont Blanchet', 'Seefeld'],
    prefix: ['Hoch', 'Berg', 'Schnee', 'Eis', 'Sonn', 'Kristall', 'Alpen', 'Stein', 'Wald', 'Val', 'Mont', 'Lärchen', 'Grün'],
    roots: [],
    suffix: ['dorf', 'berg', 'tal', 'see', 'bach', 'wald', 'stein', 'alp', 'egg', 'hof', 'kirch', 'feld', 'au', 'horn'],
  },
  mediterranean: {
    names: ['Porto Azzurro', 'Santa Lucia', 'San Marino Bay', 'Villa Serena', 'Costa Dorada', 'Marbella Nova', 'Aquila', 'Terracina', 'Olivera', 'Cala Blanca', 'Sant’Elia', 'Positano Nuovo', 'Kalamaki', 'Thessaly Bay', 'Agios Nikolas', 'Castell Mar', 'Monte Verde', 'Solaria', 'Bella Vista', 'Marina Alta'],
    prefix: ['Porto', 'Santa', 'San', 'Villa', 'Costa', 'Cala', 'Monte', 'Agios', 'Castell', 'Marina', 'Riva', 'Punta'],
    roots: [],
    suffix: [' Azzurra', ' del Mar', ' Serena', ' Bianca', ' d’Oro', ' Nuova', ' Alta', ' Bella', ' Vecchia', ' Dorada', ' Verde', ' Rossa'],
  },
};

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** a plausible random city name (theme-flavoured when a theme is given) */
export function randomCityName(theme?: ThemeId, avoid?: string): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = generate(theme);
    if (name !== avoid && name.length <= 24) return name;
  }
  return pick(CURATED);
}

function generate(theme?: ThemeId): string {
  const t = theme ? THEMED[theme] : null;
  const r = Math.random();
  if (t && t.suffix.length && r < 0.55) {
    // theme flavour: curated themed name or themed prefix + suffix
    if (t.names.length && Math.random() < 0.45) return pick(t.names);
    const pre = pick(t.prefix);
    const suf = pick(t.suffix);
    return suf.startsWith(' ') ? pre + suf : cap(pre + suf);
  }
  if (r < 0.72) return pick(CURATED);
  const root = pick(ROOTS);
  let suf = pick(SUFFIX);
  // avoid awkward doubled letters like "Ashhaven"
  if (root.slice(-1).toLowerCase() === suf.charAt(0)) suf = pick(SUFFIX);
  const base = cap(root.toLowerCase() + suf);
  const x = Math.random();
  if (x < 0.22) return `${pick(PREFIX)} ${base}`;
  if (x < 0.4) return `${base} ${pick(TAIL)}`;
  return base;
}
