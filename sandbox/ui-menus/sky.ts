import '../../src/ui/theme.css';
import { SkylineBackground } from '../../src/ui/menus/skyline';
const q = new URLSearchParams(location.search);
const s = new SkylineBackground();
if (q.get('phase')) s.fixedPhase = Number(q.get('phase'));
s.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
document.body.append(s.canvas);
s.start();
