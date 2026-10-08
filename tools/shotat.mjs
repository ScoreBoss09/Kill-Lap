// Screenshot a track at given fractions of its length: node tools/shotat.mjs trackId frac[,frac...] [outprefix]
import { chromium } from './_pw.mjs';
const [id, fr = '0.5', pre = '/tmp/shots/at'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
await p.evaluate(async id => { const { findTrack } = await import('/js/ui.js'); await KL.startRace({ mode: 'race', track: findTrack(id), laps: 3, opp: 5, diff: 1, weapons: true, carId: 'scrapper' }); (KL.state === 'lineup') && KL.beginRace(KL.game.opts.track); KL.game.human.auto = true; for (let i = 0; i < 60 * 5; i++) KL.game.frame(1 / 60, {}); }, id);
for (const f of fr.split(',')) {
  await p.evaluate(async f => { const g = KL.game, T = g.T; const { pointAt } = await import('/js/tracks.js'); const idx = +f * T.N; const pt = pointAt(T, idx, 0);
    // line up every car just behind the point so traffic shows up
    g.cars.forEach((c, k) => { const q = pointAt(T, idx - 4 - k * 5, (k % 2 - 0.5) * T.hw[0] * 0.8); c.x = q.x; c.y = q.y; c.a = q.a; c.vx = Math.cos(q.a) * 300; c.vy = Math.sin(q.a) * 300; c.pos = idx - 4 - k * 5; c.prevF = c.pos; c.accF = c.pos + T.N * c.lap; });
    g.cam.x = pt.x; g.cam.y = pt.y; for (let i = 0; i < 30; i++) g.frame(1 / 60, {}); }, f);
  await p.waitForTimeout(500); await p.screenshot({ path: `${pre}-${id}-${f}.png` });
}
console.log(errs.length ? errs.slice(0, 8).join('\n') : 'no errors'); await b.close();
