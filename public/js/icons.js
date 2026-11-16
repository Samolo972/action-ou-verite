// Icônes SVG en trait, reprises de la maquette.
import { svg } from './dom.js';

const P = (d) => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];

const ICONS = {
  plus: [P('M12 5v14M5 12h14')],
  minus: [P('M5 12h14')],
  back: [P('M15 18l-6-6 6-6')],
  arrow: [P('M5 12h14M13 6l6 6-6 6')],
  close: [P('M6 6l12 12M18 6L6 18')],
  check: [P('M5 12l5 5L20 7')],
  users: [P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'), C(9, 7, 4), P('M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8')],
  sliders: [P('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0'), C(16, 6, 2), C(10, 12, 2), C(18, 18, 2)],
  info: [C(12, 12, 9), P('M12 8v5M12 16.5v.01')],
  share: [C(18, 5, 3), C(6, 12, 3), C(18, 19, 3), P('M8.6 13.5l6.8 4M15.4 6.5l-6.8 4')],
  bolt: [P('M13 2L4 14h7l-1 8 9-12h-7l1-8z')],
  bubble: [P('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z')],
  bubbleQ: [P('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'), P('M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2V13M12 15.8v.01')],
  reroll: [P('M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5')],
  skip: [P('M5 4l10 8-10 8V4zM19 5v14')],
  tv: [['rect', { x: 2, y: 4, width: 20, height: 13, rx: 2 }], P('M8 21h8M12 17v4')],
  qr: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], P('M14 14h3v3M21 14v.01M14 21h7v-4M17 21v0')],
  link: [P('M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1'), P('M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1')],
  fullscreen: [P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')],
  sound: [P('M11 5L6 9H3v6h3l5 4V5z'), P('M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13')],
  mute: [P('M11 5L6 9H3v6h3l5 4V5z'), P('M17 9l5 6M22 9l-5 6')],
  logout: [P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')],
  replay: [P('M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5')],
  flag: [P('M5 21V4M5 4h11l-2 4 2 4H5')],
  lock: [['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }], P('M8 11V7a4 4 0 0 1 8 0v4')],
  wifiOff: [P('M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.6a10 10 0 0 1 5.2-2.5M16.8 11.1A10 10 0 0 1 19 12.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18')],
  search: [C(11, 11, 7), P('M21 21l-4.3-4.3')],
};

/** Crée l'icône `name`. */
export function icon(name, opts) {
  return svg(ICONS[name], opts);
}
