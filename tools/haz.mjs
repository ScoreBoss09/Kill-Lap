// Show a hazard mid-cycle: node tools/haz.mjs trackId type phaseSeconds [outfile]
import { chromium } from './_pw.mjs';
const [id, type, ph = '8', out = `/tmp/shots/haz-${process.argv[3]}.png`] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
const info = await p.evaluate(async ([id, type, ph]) => {
  const { findTrack } = await import('/js/ui.js'); const { pointAt } = await import('/js/tracks.js');
  await KL.startRace({ mode: 'tt', track: findTrack(id), laps: 3, opp: 0, diff: 1, weapons: false, carId: 'scrapper' });
  const g = KL.game, H = g.hazards; for (let i = 0; i < 60 * 4; i++) g.frame(1 / 60, {});
  const list = H ? H.list.filter(h => h.t === type) : []; const h = list[0];
  if (!h && type !== 'bomber') return { none: true, all: H ? H.list.map(x => x.t) : [] };
  const T = g.T; let cx, cy;
  if (type === 'bomber') { const run = H.runs[0]; g.raceTime = run.t0 + (+ph); cx = run.c.x; cy = run.c.y; } else { g.raceTime = (+ph) - h.off + h.P * (Math.ceil(h.off / h.P) + 2); cx = h.x; cy = h.y; }
  if (type === 'bomber') { const run = H.runs[0]; const q0 = pointAt(T, 0, 0); } const f = h ? h.f : 0; const q = pointAt(T, f - 10, -h?.hw * 0.3 || 0); const hm = g.human; if (h) { hm.x = q.x; hm.y = q.y; hm.a = q.a; hm.vx = Math.cos(q.a) * 280; hm.vy = Math.sin(q.a) * 280; hm.pos = f - 10; hm.prevF = hm.pos; }
  hm.auto = true; if (type === 'bomber') { const { nearest } = await import('/js/tracks.js'); const nr = nearest(T, cx, cy, -1); const q2 = pointAt(T, nr.f - 6, 0); hm.x = q2.x; hm.y = q2.y; hm.a = q2.a; hm.vx = Math.cos(q2.a) * 250; hm.vy = Math.sin(q2.a) * 250; hm.pos = nr.f - 6; hm.prevF = hm.pos; cx = hm.x; cy = hm.y; } g.cam.x = cx; g.cam.y = cy; for (let i = 0; i < 4; i++) g.frame(1 / 60, {}); g.raceTime = g.raceTime; return { ok: 1, n: list.length, t: g.raceTime.toFixed(1), kinds: H.list.map(x => x.t) };
}, [id, type, ph]);
console.log(JSON.stringify(info)); await p.waitForTimeout(500); await p.screenshot({ path: out });
console.log(errs.length ? errs.slice(0, 6).join('\n') : 'no errors'); await b.close();
