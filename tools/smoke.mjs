// Headless smoke test: node tools/smoke.mjs [url]   (needs playwright; used during development)
import { chromium } from './_pw.mjs';
const url = process.argv[2] || 'http://localhost:3000/';
const out = process.env.SHOTS || '/tmp/shots';
import fs from 'node:fs'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'] }).catch(async () => chromium.launch({ args: ['--no-sandbox'] }));
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await p.goto(url); await p.waitForTimeout(2500);
await p.screenshot({ path: out + '/01-title.png' });
const step = async (name, fn, wait = 800) => { try { await fn(); } catch (e) { errs.push('STEP ' + name + ': ' + e.message); } await p.waitForTimeout(wait); await p.screenshot({ path: `${out}/${name}.png` }); };
await step('02-setup', () => p.evaluate(() => document.querySelectorAll('.menu .btn')[0].click()));
await step('03-race', () => p.evaluate(() => document.querySelector('.btn.primary.big').click()), 7000);
await p.keyboard.down('KeyW'); await p.waitForTimeout(3500); await p.keyboard.down('Space'); await p.waitForTimeout(2500);
await p.screenshot({ path: out + '/04-driving.png' });
console.log(JSON.stringify(await p.evaluate(() => { const g = KL.game; if (!g) return null; const h = g.human; return { state: g.state, t: g.raceTime.toFixed(1), speed: Math.hypot(h.vx, h.vy).toFixed(0), hp: h.hp, lap: h.lap, place: h.place, cars: g.cars.map(c => [c.name, c.place, c.p.toFixed(3), Math.hypot(c.vx, c.vy) | 0, Math.round(c.hp)].join(':')) }; })));
console.log(errs.length ? errs.slice(0, 15).join('\n') : 'no console errors');
await b.close();
