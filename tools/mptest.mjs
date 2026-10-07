// Two-client multiplayer test through the real UI + server.
import { chromium } from './_pw.mjs';
const out = process.env.SHOTS || '/tmp/shots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const mk = async name => { const ctx = await b.newContext({ viewport: { width: 1100, height: 650 } }); const p = await ctx.newPage(); p._errs = []; p.on('console', m => { if (m.type() === 'error') p._errs.push(name + ': ' + m.text()); }); p.on('pageerror', e => p._errs.push(name + ' PAGEERROR ' + e.message)); await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200); await p.evaluate(n => { const s = JSON.parse(localStorage.getItem('killlap.v1') || '{}'); s.name = n; localStorage.setItem('killlap.v1', JSON.stringify(s)); }, name); await p.reload(); await p.waitForTimeout(1200); return p; };
const A = await mk('Alice'), B = await mk('Bob');
const clickText = (p, sel, text) => p.evaluate(([sel, text]) => { const e = [...document.querySelectorAll(sel)].find(x => x.textContent.trim().toUpperCase().includes(text)); if (!e) throw new Error('no ' + text); e.click(); }, [sel, text]);
await clickText(A, '.menu .btn', 'MULTIPLAYER'); await A.waitForTimeout(1500);
await clickText(A, '.btn', 'CREATE ROOM'); await A.waitForTimeout(400);
await clickText(A, '.modal .btn', 'CREATE'); await A.waitForTimeout(800);
await clickText(B, '.menu .btn', 'MULTIPLAYER'); await B.waitForTimeout(1500);
await B.screenshot({ path: out + '/mp-lobby.png' });
await clickText(B, '.room', 'RACE'); await B.waitForTimeout(800);
await clickText(B, '.btn', 'READY'); await B.waitForTimeout(600);
await A.screenshot({ path: out + '/mp-room.png' });
// shorten the race for the test: host config via net
await A.evaluate(async () => { const N = (await import('/js/net.js')).default; N.send({ t: 'cfg', laps: 1, bots: 2 }); }); await A.waitForTimeout(500);
await B.waitForTimeout(300); await clickText(B, '.btn', 'READY'); await B.waitForTimeout(500);
await clickText(A, '.btn', 'START RACE'); await A.waitForTimeout(3000);
for (const p of [A, B]) await p.evaluate(() => { KL.game.human.auto = true; });
await A.waitForTimeout(15000);
await A.screenshot({ path: out + '/mp-race-A.png' }); await B.screenshot({ path: out + '/mp-race-B.png' });
const info = p => p.evaluate(() => KL.game && { t: KL.game.raceTime.toFixed(1), cars: KL.game.cars.map(c => `${c.name}${c.remote ? '(r)' : ''} p${c.p.toFixed(2)} hp${Math.round(c.hp)}`) });
console.log('A', JSON.stringify(await info(A))); console.log('B', JSON.stringify(await info(B)));
// wait for results
for (let i = 0; i < 60; i++) { const done = await A.evaluate(() => KL.state === 'results') && await B.evaluate(() => KL.state === 'results'); if (done) break; await A.waitForTimeout(2000); }
console.log('A state', await A.evaluate(() => KL.state), 'B state', await B.evaluate(() => KL.state));
await A.screenshot({ path: out + '/mp-results-A.png' });
console.log(await A.evaluate(() => [...document.querySelectorAll('.results .tbl tr')].map(r => r.textContent.replace(/\s+/g, ' ')).join('\n')));
const lb = await (await fetch('http://localhost:3000/api/leaderboard')).json(); console.log('LB', JSON.stringify(lb).slice(0, 300));
console.log([...A._errs, ...B._errs].join('\n') || 'no errors'); await b.close();
