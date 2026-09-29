// Inline SVG icon set for menus & chat (stroke icons on a 24×24 grid).
const P: Record<string, string> = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.3h.01"/>',
  heart: '<path d="M20.4 5.1a5.1 5.1 0 0 0-7.3 0L12 6.2l-1.1-1.1a5.1 5.1 0 0 0-7.3 7.3L12 20.8l8.4-8.4a5.1 5.1 0 0 0 0-7.3z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-7H7v7M7 3v5h8"/>',
  download: '<path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M18.5 6l-.9 13.1A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.9L5.5 6M10 11v5M14 11v5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  camera: '<path d="M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.5l2-3h5l2 3H20a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.8"/>',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7-5.7-1.9L10.2 9z"/><path d="M19 3v3M17.5 4.5h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  monitor: '<rect x="2" y="3.5" width="20" height="13.5" rx="2"/><path d="M8 21h8M12 17v4"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 21V9"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12.5" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14.5h9"/>',
  volume: '<path d="M11 5 6 9H2.5v6H6l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.8 5.2a9.5 9.5 0 0 1 0 13.6"/>',
  mute: '<path d="M11 5 6 9H2.5v6H6l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3.5s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  reset: '<path d="M2.5 4v6h6"/><path d="M4.1 15a8.5 8.5 0 1 0 2-8.8L2.5 10"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7.5" r="3.8"/><path d="M22 20v-1.5a4 4 0 0 0-3-3.9M15.5 3.7a3.9 3.9 0 0 1 0 7.6"/>',
  coin: '<circle cx="12" cy="12" r="9.5"/><path d="M15 8.8c-.5-1-1.6-1.6-3-1.6-1.8 0-3 .9-3 2.3 0 3.2 6 1.6 6 4.8 0 1.4-1.3 2.4-3 2.4-1.5 0-2.7-.7-3.1-1.8M12 5.5v1.7M12 16.8v1.7"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  map: '<path d="M1.5 6v15.5l7-3.5 7 3.5 7-3.5V2.5l-7 3.5-7-3.5z"/><path d="M8.5 2.5V18M15.5 6v15.5"/>',
  sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  mountain: '<path d="m8 4 4.5 8 3-4L22 20H2z"/><path d="m6.2 8.2 1.8 2 2-1.2"/>',
  droplet: '<path d="M12 2.7 17.7 8.3a8 8 0 1 1-11.4 0z"/>',
  tree: '<path d="M12 22v-5"/><path d="M12 2 5.5 11h3.2L5 16.5h14L15.3 11h3.2z"/>',
  building: '<rect x="4" y="2.5" width="16" height="19" rx="1.5"/><path d="M9.5 21.5v-4h5v4M8.5 6.5h.01M12 6.5h.01M15.5 6.5h.01M8.5 10h.01M12 10h.01M15.5 10h.01M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  infinity: '<path d="M18.2 8c5 0 5 8 0 8-5.1 0-7.2-8-12.7-8-4.6 0-4.6 8 0 8 5.5 0 7.6-8 12.7-8z"/>',
  car: '<path d="M4.5 16.5h15M3 12.5 5 7h14l2 5.5v5H3z"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/>',
  lock: '<rect x="4" y="11" width="16" height="10.5" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 3.8 9.5 14.5 14.5 0 0 1-3.8 9.5 14.5 14.5 0 0 1-3.8-9.5A14.5 14.5 0 0 1 12 2.5z"/>',
  palette: '<path d="M12 2.5a9.5 9.5 0 0 0 0 19c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9a5.3 5.3 0 0 0 5.3-5.3C21.6 6.2 17.3 2.5 12 2.5z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="17.3" cy="11" r="1.2" fill="currentColor" stroke="none"/>',
  terminal: '<path d="m4.5 17 5.5-5-5.5-5M12 19h7.5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  mouse: '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 6.5v4"/>',
  zap: '<path d="M13 2 3.5 13.5H12L11 22l9.5-11.5H12z"/>',
  swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  file: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
  eye: '<path d="M1.5 12S5.3 4.5 12 4.5 22.5 12 22.5 12 18.7 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  hand: '<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10V4.5a1.5 1.5 0 0 0-3 0V10M12 10V5.5a1.5 1.5 0 0 0-3 0V14"/><path d="M18 8.5a1.5 1.5 0 0 1 3 0V14a8 8 0 0 1-8 8h-1.5a8 8 0 0 1-6.3-3.1L2.7 15.3a1.6 1.6 0 0 1 2.5-2L9 16.5"/>',
  road: '<path d="M4 21 8 3M20 21 16 3M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 7.8h.01"/>',
  gauge: '<path d="M12 14.5 16 9"/><path d="M3.5 18a9.5 9.5 0 1 1 17 0"/>',
  compass: '<circle cx="12" cy="12" r="9.5"/><path d="m16 8-2.2 5.8L8 16l2.2-5.8z"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z"/>',
  star: '<path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z"/>',
};

export type MenuIcon = keyof typeof P;

const NS = 'http://www.w3.org/2000/svg';

/** create an inline SVG icon (inherits currentColor) */
export function mIcon(name: MenuIcon | string, size = 18, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'mn-ico' + (cls ? ' ' + cls : ''));
  svg.innerHTML = P[name] ?? P.info;
  return svg;
}
