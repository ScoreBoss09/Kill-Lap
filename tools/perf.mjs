import { chromium } from './_pw.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
for (const id of ['dustbowl', 'neon', 'inferno']) {
  await p.evaluate(async id => { const { findTrack } = await import('/js/ui.js'); await KL.startRace({ mode: 'race', track: findTrack(id), laps: 3, opp: 11, diff: 2, weapons: true, carId: 'scrapper' }); KL.game.human.auto = true; }, id);
  await p.waitForTimeout(9000);
  console.log(id, '1080p, 12 cars:', await p.evaluate(() => ({ fps: KL.fps, tiles: KL.game.ground.tiles.size, particles: KL.game.fx.list.length, proj: KL.game.proj.length })));
  // pure frame-cost measurement (sim + render) without rAF throttling
  console.log('   ms/frame sim+render:', await p.evaluate(() => { const g = KL.game, c = document.getElementById('game').getContext('2d'); const t0 = performance.now(); for (let i = 0; i < 120; i++) { g.frame(1 / 60, {}); g.render(c, c.canvas.width, c.canvas.height, 1 / 60); } return ((performance.now() - t0) / 120).toFixed(2); }));
}
await b.close();
