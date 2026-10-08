// Simulate a full bots-only race on every built-in track: node tools/sweep.mjs [diff] [trackIds...]
import { chromium } from './_pw.mjs';
const diff = +(process.argv[2] ?? 2), only = process.argv.slice(3);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
const ids = await p.evaluate(async () => (await import('/js/tracks.js')).BUILTIN_TRACKS.map(t => t.id));
for (const id of ids.filter(i => !only.length || only.includes(i))) {
  const r = await p.evaluate(async ([id, diff]) => {
    const { findTrack } = await import('/js/ui.js'); await KL.startRace({ mode: 'race', track: findTrack(id), laps: 3, opp: 7, diff, weapons: true, carId: 'scrapper' });
    const g = KL.game; KL.beginRace && 0; g.human.auto = true; let t = 0; const stuck = new Map(); let maxStuck = 0, who = '';
    while (t < 420 && !g.over) { g.frame(1 / 60, {}); t += 1 / 60;
      for (const c of g.cars) if (g.state === 'racing' && !c.dead && !c.finished && Math.hypot(c.vx, c.vy) < 15 && !c.holding) { const s = (stuck.get(c.id) || 0) + 1 / 60; stuck.set(c.id, s); if (s > maxStuck) { maxStuck = s; who = c.name; } } else stuck.set(c.id, 0); }
    const T = g.T; return { id, t: +t.toFixed(0), over: g.over, fin: g.cars.filter(c => c.finished).length, maxStuck: +maxStuck.toFixed(1), who, wrecks: g.cars.reduce((a, c) => a + c.deaths, 0), haz: T.hazards.map(h => h.t).join(',') + (T.bomber ? ',bomber' : ''), el: T.hasElev ? 'raised' : '', tun: T.hasTun ? 'tunnel' : '' };
  }, [id, diff]);
  console.log(JSON.stringify(r));
}
console.log(errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : 'no errors'); await b.close();
