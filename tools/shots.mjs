// Screenshot each theme mid-race: node tools/shots.mjs id1,id2,...
import { chromium } from './_pw.mjs';
const ids = (process.argv[2] || 'dustbowl,pinewood,frostbite,neon,foundry,inferno,seaside,canyon').split(',');
const out = process.env.SHOTS || '/tmp/shots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
for (const id of ids) {
  await p.evaluate(async id => { const { findTrack } = await import('/js/ui.js'); await KL.startRace({ mode: 'race', track: findTrack(id), laps: 3, opp: 6, diff: 1, weapons: true, carId: 'scrapper' }); (KL.state === 'lineup') && KL.beginRace(KL.game.opts.track); KL.game.human.auto = true; for (let i = 0; i < 60 * 14; i++) KL.game.frame(1 / 60, {}); }, id);
  await p.waitForTimeout(700); await p.screenshot({ path: `${out}/theme-${id}.png` });
}
console.log(errs.length ? errs.slice(0, 8).join('\n') : 'no errors'); await b.close();
