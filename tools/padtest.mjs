import { chromium } from './_pw.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.addInitScript(() => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id: 'Fake Xbox 360 Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk), timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  window.__press = (i, v = 1) => { window.__pad.buttons[i] = { pressed: !!v, touched: !!v, value: v }; };
});
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1500);
const focused = () => p.evaluate(() => (document.querySelector('.nv.focus') || {}).textContent);
console.log('initial focus:', await focused());
const tap = async i => { await p.evaluate(i => __press(i, 1), i); await p.waitForTimeout(120); await p.evaluate(i => __press(i, 0), i); await p.waitForTimeout(150); };
await tap(13); await tap(13); console.log('after 2x dpad-down:', await focused());
await tap(12); console.log('after dpad-up:', await focused());
await tap(0); await p.waitForTimeout(600); console.log('A pressed ->', await p.evaluate(() => document.querySelector('.frame-head h1')?.textContent));
await tap(1); await p.waitForTimeout(400); console.log('B (back) ->', await p.evaluate(() => document.querySelector('.logo-main') ? 'title' : 'other'));
// race with the pad
await p.evaluate(async () => { const { findTrack } = await import('/js/ui.js'); await KL.startRace({ mode: 'race', track: findTrack('dustbowl'), laps: 2, opp: 3, diff: 1, weapons: true, carId: 'scrapper' }); });
await p.waitForTimeout(5200);
await p.evaluate(() => { __press(7, 1); });   // RT accelerate
const a0 = await p.evaluate(() => KL.game.human.a);
await p.waitForTimeout(2500);
await p.evaluate(() => { __pad.axes[0] = 0.8; });
await p.waitForTimeout(1200);
const st = await p.evaluate(() => { const h = KL.game.human; return { speed: Math.hypot(h.vx, h.vy) | 0, steer: h.input.steer.toFixed(2), a: h.a.toFixed(2), thr: h.input.throttle }; });
console.log('driving with pad:', JSON.stringify(st), 'start angle', a0.toFixed(2));
await p.evaluate(() => { __press(0, 1); __press(2, 1); }); await p.waitForTimeout(600); // gun + rocket
console.log('ammo after A+X:', await p.evaluate(() => JSON.stringify(KL.game.human.ammo)));
await p.evaluate(() => { __press(0, 0); __press(2, 0); __press(9, 1); }); await p.waitForTimeout(150); await p.evaluate(() => __press(9, 0)); await p.waitForTimeout(500);
console.log('Start -> paused:', await p.evaluate(() => KL.paused));
console.log(errs.length ? errs.join('\n') : 'no errors'); await b.close();
