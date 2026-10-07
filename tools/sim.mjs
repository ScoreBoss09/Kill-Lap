// Fast-forward a bots-only race in the browser to check lap times / AI / results flow: node tools/sim.mjs [trackId] [diff]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const track = process.argv[2] || 'dustbowl', diff = +(process.argv[3] ?? 1);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1500);
const res = await p.evaluate(async ([track, diff]) => {
  const { findTrack } = await import('/js/ui.js');
  await KL.startRace({ mode: 'race', track: findTrack(track), laps: 3, opp: 7, diff, weapons: true, carId: 'scrapper' });
  const g = KL.game; g.human.auto = true;
  let t = 0; const log = [];
  while (t < 400 && !g.over) { g.frame(1 / 60, { steer: 0 }); t += 1 / 60; if (Math.floor(t) % 20 === 0 && Math.abs(t - Math.round(t)) < 1 / 60) log.push(t.toFixed(0) + 's ' + g.order.slice(0, 3).map(c => c.name + ' p' + c.p.toFixed(2)).join(', ')); }
  return { t: t.toFixed(1), over: g.over, results: g.results && g.results.map(r => `${r.place}. ${r.name} ${r.time && r.time.toFixed(1)} best ${r.best && r.best.toFixed(2)} k${r.kills}`), human: { lap: g.human.lap, hp: g.human.hp, stuck: g.human.stuckT, best: g.human.best }, log: log.slice(0, 6), wrecks: g.cars.map(c => c.deaths) };
}, [track, diff]);
console.log(JSON.stringify(res, null, 1)); console.log(errs.length ? errs.slice(0, 8).join('\n') : 'no errors');
await p.waitForTimeout(500); await p.screenshot({ path: (process.env.SHOTS || '/tmp/shots') + '/sim-results.png' });
await b.close();
