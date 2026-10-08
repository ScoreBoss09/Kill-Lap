// Editor test: height/tunnel controls, hazard items, controller menu mode.
import { chromium } from './_pw.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { const mk = () => ({ pressed: false, touched: false, value: 0 }); window.__pad = { id: 'Fake (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk), timestamp: 0 }; navigator.getGamepads = () => [window.__pad]; window.__press = (i, v = 1) => { window.__pad.buttons[i] = { pressed: !!v, touched: !!v, value: v }; }; });
await p.goto('http://localhost:3000/'); await p.waitForTimeout(1200);
await p.evaluate(() => KL.openEditor()); await p.waitForTimeout(700);
const tap = async i => { await p.evaluate(i => __press(i, 1), i); await p.waitForTimeout(130); await p.evaluate(i => __press(i, 0), i); await p.waitForTimeout(160); };
const focused = () => p.evaluate(() => (document.querySelector('#editor .nv.focus') || {}).textContent);
const compile = async () => p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); return { elev: !!Editor.T.hasElev, tun: !!Editor.T.hasTun, issues: Editor.issues, pts: Editor.t.pts.length, items: Editor.t.items.map(i => i.t) }; });
// -- click a point, raise it + neighbours, make a tunnel
await p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); Editor.sel = 2; Editor.buildPanel(); });
await p.waitForTimeout(300);
await p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); for (const i of [2, 3, 4]) { Editor.t.pts[i][2] = null; Editor.t.pts[i][3] = 80; } for (const i of [6, 7]) { Editor.t.pts[i][2] = null; Editor.t.pts[i][3] = 0; Editor.t.pts[i][4] = 1; } Editor.recompile(); });
console.log('after raise/tunnel:', JSON.stringify(await compile()));
// -- the real controls exist in the panel
console.log('panel has Road height + Tunnel here:', await p.evaluate(() => { const t = document.querySelector('.edpanel').textContent; return t.includes('Road height') && t.includes('Tunnel here'); }));
// -- hazard palette + placing through the same path a click uses
await p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); Editor.setTool('items'); });
console.log('palette hazards:', await p.evaluate(() => [...document.querySelectorAll('.palette .btn')].map(b => b.textContent.trim().replace('● ', '')).join(',')));
await p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); for (const t of ['train', 'jump', 'bomber']) { Editor.itemType = t; Editor.act(Editor.t.pts[5][0], Editor.t.pts[5][1], false); } Editor.recompile(); });
console.log('items:', JSON.stringify(await compile()));
// -- controller menu mode
await tap(8); console.log('menu mode on:', await p.evaluate(() => document.getElementById('editor').classList.contains('menumode')), 'focus:', await focused());
await tap(15); console.log('right ->', await focused()); await tap(15); console.log('right ->', await focused()); await tap(13); console.log('down ->', await focused());
await tap(0); await p.waitForTimeout(300); console.log('A pressed, tool is now:', await p.evaluate(async () => (await import('/js/editor.js')).Editor.tool));
await tap(1); console.log('B -> back to map mode:', await p.evaluate(() => !document.getElementById('editor').classList.contains('menumode')));
await tap(8); await tap(13); await tap(13); await tap(13); await tap(14); console.log('in panel, focus:', await focused());
await p.screenshot({ path: '/tmp/shots/ed-menumode.png' });
// -- test drive the edited track (raised + tunnel + hazards must run)
await p.evaluate(async () => { const { Editor } = await import('/js/editor.js'); Editor.menuMode && Editor.setMenuMode(false); Editor.test(); }); await p.waitForTimeout(2500);
console.log('test drive state:', await p.evaluate(() => KL.state), await p.evaluate(() => KL.game && JSON.stringify({ hz: KL.game.T.hazards.map(h => h.t), bomber: KL.game.T.bomber, elev: KL.game.T.hasElev })));
console.log(errs.length ? [...new Set(errs)].join('\n') : 'no errors'); await b.close();
