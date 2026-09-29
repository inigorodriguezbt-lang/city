// Inline SVG icon set for the HUD chrome (24×24, stroke-based, currentColor).
// Emoji from the data catalogs are used for content (buildings, overlays);
// these crisp vector glyphs are used for controls so the chrome looks
// consistent on every platform.

const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape =
  | string // path "d"
  | { c: [number, number, number]; fill?: boolean } // circle cx cy r
  | { r: [number, number, number, number, number?]; fill?: boolean }; // rect x y w h rx

const I: Record<string, Shape[]> = {
  close: ['M18 6 6 18', 'M6 6l12 12'],
  search: [{ c: [11, 11, 7] }, 'm20.5 20.5-4.2-4.2'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  layers: ['m12 2.5 9.5 4.8L12 12 2.5 7.3 12 2.5z', 'm2.5 12.2 9.5 4.8 9.5-4.8', 'm2.5 16.8 9.5 4.7 9.5-4.7'],
  budget: [{ c: [8, 8, 6] }, 'M18.09 10.37A6 6 0 1 1 10.34 18', 'M7 6h1v4', 'm16.71 13.88.7.71-2.82 2.82'],
  stats: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  graph: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  policy: ['M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4', 'M19 17V5a2 2 0 0 0-2-2H4', 'M15 8h-5', 'M15 12h-5'],
  trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
  map: ['m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z', 'M9 3v15', 'M15 6v15'],
  bus: ['M8 6v6', 'M15 6v6', 'M2 12h19.6', 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3', { c: [7, 18, 2] }, 'M9 18h5', { c: [16, 18, 2] }],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', { c: [12, 13, 3.5] }],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', { c: [12, 12, 3] }],
  crosshair: [{ c: [12, 12, 9] }, 'M21 12h-4', 'M7 12H3', 'M12 7V3', 'M12 21v-4'],
  pencil: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  move: ['m5 9-3 3 3 3', 'm9 5 3-3 3 3', 'm15 19-3 3-3-3', 'm19 9 3 3-3 3', 'M2 12h20', 'M12 2v20'],
  landmark: ['M3 22h18', 'M6 18v-7', 'M10 18v-7', 'M14 18v-7', 'M18 18v-7', 'M12 2l8 5H4z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', { c: [9, 7, 4] }, 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  trendUp: ['m22 7-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  trendDown: ['m22 17-8.5-8.5-5 5L2 7', 'M16 17h6v-6'],
  trendFlat: ['M3 12h18', 'm16 7 5 5-5 5'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronUp: ['m18 15-6-6-6 6'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M20 6 9 17l-5-5'],
  lock: [{ r: [4, 11, 16, 10, 2] }, 'M8 11V7a4 4 0 0 1 8 0v4'],
  info: [{ c: [12, 12, 9.5] }, 'M12 16v-4', 'M12 8h.01'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
  sun: [{ c: [12, 12, 4] }, 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  rain: ['M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24', 'M16 14v6', 'M8 14v6', 'M12 16v6'],
  storm: ['M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 0 9H17', 'm13 12-3 5h4l-3 5'],
  snow: ['M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24', 'M8 15h.01', 'M8 19h.01', 'M12 17h.01', 'M12 21h.01', 'M16 15h.01', 'M16 19h.01'],
  fog: ['M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24', 'M16 17H7', 'M17 21H9'],
  heat: ['M12 9a4 4 0 0 0-2 7.5', 'M12 3v2', 'm6.6 18.4-1.4 1.4', 'M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z', 'M4 13H2', 'M6.34 7.34 4.93 5.93'],
  blizzard: ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'],
  wind: ['M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2', 'M9.6 4.6A2 2 0 1 1 11 8H2', 'M12.6 19.4A2 2 0 1 0 14 16H2'],
  aperture: [{ c: [12, 12, 10] }, 'm14.31 8 5.74 9.94', 'M9.69 8h11.48', 'm7.38 12 5.74-9.94', 'M9.69 16 3.95 6.06', 'M14.31 16H2.83', 'm16.62 12-5.74 9.94'],
  home: ['m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  sparkle: ['M9.94 14.06 4 20', 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3z'],
  checkAll: ['M18 6 7 17l-5-5', 'm22 10-7.5 7.5L13 16'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  keyboard: [{ r: [2, 5, 20, 14, 2] }, 'M6 9h.01', 'M10 9h.01', 'M14 9h.01', 'M18 9h.01', 'M8 13h.01', 'M12 13h.01', 'M16 13h.01', 'M7 16h10'],
  grip: [{ c: [9, 6, 1], fill: true }, { c: [15, 6, 1], fill: true }, { c: [9, 12, 1], fill: true }, { c: [15, 12, 1], fill: true }, { c: [9, 18, 1], fill: true }, { c: [15, 18, 1], fill: true }],
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  shrink: ['m14 10 7-7', 'M20 10h-6V4', 'm3 21 7-7', 'M4 14h6v6'],
  compass: [{ c: [12, 12, 10] }, 'm16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
  tiltshift: [{ c: [12, 12, 10] }, 'M2 12h20', 'M4.5 7h15', 'M4.5 17h15'],
  fov: ['M2 12s3-7 10-7 10 7 10 7', 'M12 5v14', 'm5 8 7 4 7-4'],
  clock: [{ c: [12, 12, 10] }, 'M12 6v6l4 2'],
  cursor: ['m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z', 'm13 13 6 6'],
  brush: ['m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08', 'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z'],
  rect: [{ r: [3, 3, 18, 18, 2] }, 'M3 9h18', 'M9 21V9'],
  fill: ['m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z', 'm5 2 5 5', 'M2 13h15', 'M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z'],
  eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  gauge: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  car: ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', { c: [7, 17, 2] }, 'M9 17h6', { c: [17, 17, 2] }],
  building: [{ r: [4, 2, 16, 20, 2] }, 'M9 22v-4h6v4', 'M8 6h.01', 'M16 6h.01', 'M12 6h.01', 'M12 10h.01', 'M12 14h.01', 'M16 10h.01', 'M16 14h.01', 'M8 10h.01', 'M8 14h.01'],
  tag: ['M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', { c: [7.5, 7.5, 0.5], fill: true }],
  palette: [{ c: [13.5, 6.5, 0.5], fill: true }, { c: [17.5, 10.5, 0.5], fill: true }, { c: [8.5, 7.5, 0.5], fill: true }, { c: [6.5, 12.5, 0.5], fill: true }, 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z'],
  // ── toolbar categories ──
  roads: ['M4 21 9 3', 'M20 21 15 3', 'M12 4v2.5', 'M12 10v3', 'M12 16.5V20'],
  zoning: [{ r: [3, 3, 7.5, 7.5, 1.5] }, { r: [13.5, 3, 7.5, 7.5, 1.5] }, { r: [3, 13.5, 7.5, 7.5, 1.5] }, { r: [13.5, 13.5, 7.5, 7.5, 1.5] }],
  districts: ['M12 2.5 20.5 7v10L12 21.5 3.5 17V7z', 'M12 2.5v19', 'M3.5 7 12 12l8.5-5'],
  electricity: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  water: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  garbage: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'm9 14 1.5-2.5L12 14', 'M10.5 11.5 9 16h6l-1.5-2.5'],
  health: ['M10 3h4a1 1 0 0 1 1 1v5h5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-5v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h5V4a1 1 0 0 1 1-1z'],
  fire: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  police: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm12 8 1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 14l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z'],
  education: ['M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'],
  parks: ['m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z', 'M12 22v-3'],
  transit: [{ r: [5, 3, 14, 15, 3] }, 'M5 11h14', 'M12 3v8', 'm8 18-2.5 3.5', 'm16 18 2.5 3.5', 'M8.5 14.5h.01', 'M15.5 14.5h.01'],
  government: ['M3 22h18', 'M5 18v-7', 'M9.5 18v-7', 'M14.5 18v-7', 'M19 18v-7', 'M2 11h20', 'M12 2 3 7.5h18z'],
  tourism: [{ c: [12, 10, 7] }, { c: [12, 10, 1.6] }, 'M12 3v5.4', 'M12 11.6V17', 'M5 10h5.4', 'M13.6 10H19', 'm8 21 4-4 4 4'],
  landmarks: ['M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3l4.27-3.67a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.96-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.67a1 1 0 0 0 1.52-.3z', 'M5 21h14'],
  terrain: ['m8 3 4 8 5-5 5 15H2L8 3z', 'M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19'],
  bulldoze: ['M2 18.5A2.5 2.5 0 0 1 4.5 16h8a2.5 2.5 0 0 1 0 5h-8A2.5 2.5 0 0 1 2 18.5z', 'M4 16V9h5l2.5 7', 'M6 9V6h3', 'M15 16h2l1-7h4', 'M22 9v9h-3'],
};

export type IconName = keyof typeof I;

/** Create an inline SVG icon element. */
export function icon(name: IconName | string, size = 18, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', ('hud-ico ' + cls).trim());
  const shapes = I[name] ?? I.info;
  for (const s of shapes) {
    let el: SVGElement;
    if (typeof s === 'string') {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', s);
    } else if ('c' in s) {
      el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', String(s.c[0]));
      el.setAttribute('cy', String(s.c[1]));
      el.setAttribute('r', String(s.c[2]));
      if (s.fill) el.setAttribute('fill', 'currentColor');
    } else {
      el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', String(s.r[0]));
      el.setAttribute('y', String(s.r[1]));
      el.setAttribute('width', String(s.r[2]));
      el.setAttribute('height', String(s.r[3]));
      if (s.r[4]) el.setAttribute('rx', String(s.r[4]));
      if (s.fill) el.setAttribute('fill', 'currentColor');
    }
    svg.appendChild(el);
  }
  return svg;
}

/** Filled glyphs for the speed segmented control. */
export function speedGlyph(level: number, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'hud-ico');
  const add = (d: string) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  };
  if (level === 0) {
    add('M7 4.5h3.2a.8.8 0 0 1 .8.8v13.4a.8.8 0 0 1-.8.8H7a.8.8 0 0 1-.8-.8V5.3a.8.8 0 0 1 .8-.8z');
    add('M13.8 4.5H17a.8.8 0 0 1 .8.8v13.4a.8.8 0 0 1-.8.8h-3.2a.8.8 0 0 1-.8-.8V5.3a.8.8 0 0 1 .8-.8z');
  } else {
    const n = level === 1 ? 1 : level === 2 ? 2 : 3;
    const w = n === 1 ? 12 : n === 2 ? 9 : 7;
    const total = w * n;
    let x = 12 - total / 2 + (n === 1 ? 1.5 : 0.5);
    for (let i = 0; i < n; i++) {
      add(`M${x} 6.2v11.6a.7.7 0 0 0 1.1.6l${w - 1.2} -5.8a.7.7 0 0 0 0-1.2L${x + 1.1} 5.6a.7.7 0 0 0-1.1.6z`);
      x += w;
    }
    if (level >= 4) add('M20.2 5.5h1.6a.6.6 0 0 1 .6.6v11.8a.6.6 0 0 1-.6.6h-1.6a.6.6 0 0 1-.6-.6V6.1a.6.6 0 0 1 .6-.6z');
  }
  return svg;
}

/** Happiness face whose mouth curves with the value (0..100). */
export function faceIcon(size = 18): { el: SVGSVGElement; set(v: number): void } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('class', 'hud-ico');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9.5');
  const eyes = document.createElementNS(SVG_NS, 'path');
  eyes.setAttribute('d', 'M9 9.5h.01M15 9.5h.01');
  eyes.setAttribute('stroke-width', '2.6');
  const mouth = document.createElementNS(SVG_NS, 'path');
  svg.append(circle, eyes, mouth);
  const set = (v: number) => {
    const t = Math.max(-1, Math.min(1, (v - 50) / 35));
    const y = 15.2 - t * 0.6;
    const cy = y + t * 3.2;
    mouth.setAttribute('d', `M8 ${y.toFixed(2)}Q12 ${cy.toFixed(2)} 16 ${y.toFixed(2)}`);
  };
  set(60);
  return { el: svg, set };
}
