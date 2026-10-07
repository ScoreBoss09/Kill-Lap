import { chromium } from './_pw.mjs';
const out = process.env.SHOTS || '/tmp/shots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1500);
const click = (sel, text) => p.evaluate(([sel, text]) => { const e = [...document.querySelectorAll(sel)].find(x => x.textContent.trim().toUpperCase().includes(text)); if (!e) throw new Error('no ' + text); e.click(); }, [sel, text]);
const run = (cfgJs, secs = 400) => p.evaluate(async ([cfgJs, secs]) => {
  const { findTrack, dailyTrack } = await import('/js/ui.js'); const cfg = eval('(' + cfgJs + ')'); await KL.startRace(cfg); const g = KL.game; g.human.auto = true;
  let t = 0; while (t < secs && !g.over) { g.frame(1 / 60, {}); t += 1 / 60; } await new Promise(r => setTimeout(r, 400)); return { over: g.over, t: t.toFixed(0), state: KL.state };
}, [cfgJs, secs]);
// ---- career: rookie cup
await click('.menu .btn', 'CAREER'); await click('.scard', 'ROOKIE'); await p.waitForTimeout(300); await click('.btn', 'START SERIES'); await p.waitForTimeout(800);
for (let i = 0; i < 3; i++) {
  const r = await p.evaluate(async () => { const g = KL.game; g.human.auto = true; let t = 0; while (t < 400 && !g.over) { g.frame(1 / 60, {}); t += 1 / 60; } await new Promise(r => setTimeout(r, 500)); return { t: t.toFixed(0), state: KL.state, track: g.opts.track.name }; });
  console.log('career race', i + 1, JSON.stringify(r));
  console.log('  notes:', await p.evaluate(() => [...document.querySelectorAll('.note')].map(n => n.textContent).join(' | ')));
  if (i === 0) await p.screenshot({ path: out + '/flow-career-results.png' });
  if (i < 2) { await click('.btn', 'NEXT RACE'); await p.waitForTimeout(900); }
}
await p.screenshot({ path: out + '/flow-career-final.png' });

console.log('saved career:', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('killlap.v1')); return JSON.stringify({ done: s.career.done, active: !!s.career.active, cash: s.cash, races: s.stats.races }); }));
// ---- time trial + ghost
const tt = await run("{ mode: 'tt', track: findTrack('pinewood'), laps: 2, opp: 0, diff: 1, weapons: false, carId: 'scrapper' }", 200);
console.log('TT', JSON.stringify(tt)); console.log('  ghost saved:', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('killlap.v1')); const g = s.ghosts.pinewood; return g ? g.pts.length + ' pts, lap ' + g.lap.toFixed(2) : 'none'; }));
await click('.btn', 'RACE AGAIN'); await p.waitForTimeout(1500); console.log('  ghost loaded in rerun:', await p.evaluate(() => !!KL.game.ghost && KL.game.ghost.pts.length));
await p.evaluate(() => { KL.game.human.auto = true; for (let i = 0; i < 60 * 12; i++) KL.game.frame(1 / 60, {}); }); await p.waitForTimeout(500); await p.screenshot({ path: out + '/flow-ghost.png' });
// ---- pause with keyboard
await p.keyboard.press('Escape'); await p.waitForTimeout(500); console.log('paused:', await p.evaluate(() => KL.paused));
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); console.log('  focus:', await p.evaluate(() => document.querySelector('.nv.focus')?.textContent));
await p.keyboard.press('Escape'); await p.waitForTimeout(500); console.log('  resumed via Esc:', await p.evaluate(() => !KL.paused && KL.state));
await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(500); console.log('  Enter on RESUME:', await p.evaluate(() => !KL.paused));
// ---- daily
const d = await run("{ mode: 'tt', track: dailyTrack(), laps: 3, opp: 0, diff: 1, weapons: false, carId: 'scrapper', daily: true }", 300);
console.log('daily', JSON.stringify(d), 'track', await p.evaluate(() => KL.cfg.track.name + ' / ' + KL.cfg.track.id));
// ---- publish + workshop
await p.evaluate(() => KL.toMenu()); await p.waitForTimeout(600);
const lb = await (await fetch('http://localhost:3000/api/leaderboard')).json(); console.log('server boards:', Object.keys(lb.tracks).join(','));
const pub = await p.evaluate(async () => { const { newTrack } = await import('/js/editor.js'); const t = newTrack('snow'); t.name = 'Test Pub'; const r = await fetch('/api/tracks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }); return r.json(); });
console.log('publish:', JSON.stringify(pub)); const list = await (await fetch('http://localhost:3000/api/tracks')).json(); console.log('workshop:', list.tracks.map(t => t.name + ' by ' + t.author).join(', '));
await click('.menu .btn', 'QUICK RACE'); await p.waitForTimeout(500); await click('.tab', 'WORKSHOP'); await p.waitForTimeout(1200); await p.screenshot({ path: out + '/flow-workshop.png' });
console.log(errs.length ? errs.slice(0, 10).join('\n') : 'no errors'); await b.close();
