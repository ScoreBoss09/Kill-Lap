import { clamp, fmtTime, TAU } from './util.js';
import Input from './input.js';

const FONT = 'Impact, "Arial Black", "Haettenschweiler", sans-serif';
const F2 = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
const ACC = '#ff6a1a';

function panel(g, x, y, w, h, a = 0.55) {
  g.fillStyle = `rgba(8,10,14,${a})`; g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.stroke();
  g.fillStyle = ACC; g.fillRect(x, y + 5, 3, h - 10);
}
function text(g, s, x, y, size, color = '#fff', align = 'left', font = FONT, stroke = true) {
  g.font = `${size}px ${font}`; g.textAlign = align; g.textBaseline = 'alphabetic';
  if (stroke) { g.lineWidth = Math.max(2, size / 8); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round'; g.strokeText(s, x, y); }
  g.fillStyle = color; g.fillText(s, x, y);
}

export function drawHUD(g, game, W, H, opts = {}) {
  const car = game.human; if (!car || game.mode === 'attract') return;
  const u = clamp(Math.min(W, H * 1.6) / 1280, 0.62, 1.5), pad = 18 * u;
  const pad_ = Input.lastDevice === 'pad';
  // damage/boost vignette
  if (game.hudFlash > 0) { game.hudFlash -= 0.016; }
  const hpf = car.hp / car.maxHp;
  if (hpf < 0.3 && !car.dead) { const gr = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85); gr.addColorStop(0, 'rgba(180,0,0,0)'); gr.addColorStop(1, `rgba(180,0,0,${0.35 + Math.sin(game.time * 6) * 0.1})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  if (car.nitroOn || car.boostT > 0) { const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.9); gr.addColorStop(0, 'rgba(60,160,255,0)'); gr.addColorStop(1, 'rgba(60,160,255,0.28)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  // speed lines for nitro
  if (car.nitroOn) { g.strokeStyle = 'rgba(180,220,255,0.25)'; g.lineWidth = 2; for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + game.time * 0.2, r0 = H * 0.42, r1 = H * 0.6 + Math.random() * 40; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); g.stroke(); } }

  // ---- position / lap / times (top-left)
  const lapT = game.state === 'racing' ? game.raceTime - car.lapStart : 0;
  const pw = 270 * u, ph = 118 * u;
  panel(g, pad, pad, pw, ph);
  const place = car.finished ? car.finishPlace : car.place || 1;
  text(g, String(place), pad + 14 * u, pad + 70 * u, 74 * u, place === 1 ? '#ffd23a' : '#fff');
  const pw2 = g.measureText(String(place)).width;
  text(g, ORD(place).slice(String(place).length), pad + 18 * u + pw2, pad + 38 * u, 26 * u, '#ccc');
  text(g, '/ ' + game.cars.length, pad + 18 * u + pw2, pad + 70 * u, 24 * u, '#999');
  text(g, `LAP ${Math.min(car.lap + 1, game.laps)}/${game.laps}`, pad + pw - 14 * u, pad + 38 * u, 30 * u, '#fff', 'right');
  text(g, fmtTime(lapT), pad + pw - 14 * u, pad + 70 * u, 28 * u, '#ffe08a', 'right', F2);
  text(g, 'BEST ' + (car.best != null ? fmtTime(car.best) : '--:--.---'), pad + 14 * u, pad + 100 * u, 17 * u, '#9fe3ff', 'left', F2);
  text(g, 'TOTAL ' + fmtTime(game.raceTime, true), pad + pw - 14 * u, pad + 100 * u, 17 * u, '#bbb', 'right', F2);
  if (opts.recordTime) text(g, 'RECORD ' + fmtTime(opts.recordTime), pad, pad + ph + 22 * u, 16 * u, '#ffd23a', 'left', F2);

  // ---- minimap (top-right)
  const ms = 190 * u, mx = W - pad - ms, my = pad;
  panel(g, mx, my, ms, ms, 0.5);
  const mini = game.mini;
  g.save(); g.beginPath(); g.rect(mx, my, ms, ms); g.clip();
  g.drawImage(mini.canvas, mx, my, ms, ms);
  const k = ms / mini.canvas.width;
  for (const c of game.cars) {
    if (c.dead) continue; const px = mx + (mini.offx + c.x * mini.s) * k, py = my + (mini.offy + c.y * mini.s) * k;
    g.fillStyle = c === car ? '#ffffff' : c.remote ? '#4fc3ff' : '#ff4a3a'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(px, py, (c === car ? 5 : 3.6) * u, 0, TAU); g.fill(); g.stroke();
  }
  g.restore();
  // pickups on the minimap are too noisy; just show mines of ours
  // ---- standings (right, below minimap)
  const rows = (game.order || game.cars).slice(0, 6), rh = 24 * u; let sy = my + ms + 12 * u;
  panel(g, mx, sy, ms, rows.length * rh + 12 * u, 0.45);
  rows.forEach((c, i) => {
    const y = sy + 6 * u + (i + 1) * rh - 7 * u; const me = c === car;
    if (me) { g.fillStyle = 'rgba(255,106,26,0.25)'; g.fillRect(mx + 5, y - rh + 7 * u, ms - 5, rh - 2); }
    text(g, String(i + 1), mx + 14 * u, y, 15 * u, '#aaa', 'left', F2, false);
    g.fillStyle = c.color; g.fillRect(mx + 30 * u, y - 11 * u, 9 * u, 11 * u);
    text(g, c.name.slice(0, 11), mx + 46 * u, y, 15 * u, me ? '#fff' : '#ddd', 'left', F2, false);
    const right = c.finished ? '✓' : c.dead ? '✖' : c.kills ? c.kills + '☠' : '';
    text(g, right, mx + ms - 8 * u, y, 14 * u, c.dead ? '#ff6a5a' : '#ffd23a', 'right', F2, false);
  });
  // ---- feed
  let fy = sy + rows.length * rh + 36 * u;
  for (const f of game.feed.slice(-5)) { g.globalAlpha = clamp(f.t, 0, 1); text(g, f.text, W - pad, fy, 15 * u, f.color, 'right', F2); fy += 20 * u; } g.globalAlpha = 1;

  // ---- speedometer (bottom-left)
  const sp = Math.hypot(car.vx, car.vy), kmh = Math.round(sp * 0.36), maxS = car.stats.top * 1.3;
  const cx = pad + 100 * u, cy = H - pad - 78 * u, R = 88 * u;
  g.fillStyle = 'rgba(8,10,14,0.6)'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 2; g.stroke();
  const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22; const fr = clamp(sp / maxS, 0, 1);
  g.lineCap = 'round'; g.lineWidth = 11 * u; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(cx, cy, R - 12 * u, a0, a1); g.stroke();
  const gr = g.createLinearGradient(cx - R, cy, cx + R, cy); gr.addColorStop(0, '#31d8ff'); gr.addColorStop(0.6, '#ffd23a'); gr.addColorStop(1, '#ff3a2a');
  g.strokeStyle = car.nitroOn ? '#5fd2ff' : gr; g.beginPath(); g.arc(cx, cy, R - 12 * u, a0, a0 + (a1 - a0) * fr); g.stroke();
  text(g, String(kmh), cx, cy + 14 * u, 50 * u, '#fff', 'center'); text(g, 'KM/H', cx, cy + 36 * u, 14 * u, '#aaa', 'center', F2, false);
  // nitro pips
  for (let i = 0; i < car.stats.nitroCharges + 2; i++) { if (i >= Math.max(car.nitro, 0) && i >= car.stats.nitroCharges - 1 + 0) break; g.fillStyle = i < car.nitro ? '#46b7ff' : '#333'; g.beginPath(); g.arc(cx - (car.nitro - 1) * 7 * u + i * 14 * u, cy - 36 * u, 4.5 * u, 0, TAU); g.fill(); }
  if (car.nitroT > 0) { g.fillStyle = '#46b7ff'; g.fillRect(cx - 34 * u, cy - 56 * u, 68 * u * (car.nitroT / 2), 5 * u); }
  // health bar + weapons
  const hx = cx + R + 14 * u, hy = H - pad - 74 * u, hw = 230 * u, hh = 20 * u;
  panel(g, hx - 8 * u, hy - 30 * u, hw + 16 * u, (game.weapons ? 108 : 66) * u, 0.5);
  text(g, 'ARMOUR', hx, hy - 10 * u, 15 * u, '#aaa', 'left', F2, false); text(g, Math.ceil(Math.max(0, car.hp)) + ' / ' + Math.round(car.maxHp), hx + hw, hy - 10 * u, 15 * u, '#ddd', 'right', F2, false);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(hx, hy, hw, hh);
  g.fillStyle = hpf > 0.5 ? '#46d16a' : hpf > 0.25 ? '#f2c230' : '#ee4b35'; g.fillRect(hx, hy, hw * clamp(hpf, 0, 1), hh);
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(hx + hw * i / 10, hy); g.lineTo(hx + hw * i / 10, hy + hh); g.stroke(); }
  if (game.weapons) {
    const bw = hw / 3, wy = hy + hh + 12 * u, st = car.stats;
    const slot = (i, label, key, n, max, color) => {
      const x = hx + i * bw; text(g, label, x, wy + 12 * u, 12 * u, color, 'left', F2, false); text(g, String(n), x + bw - 12 * u, wy + 12 * u, 14 * u, n > 0 ? '#fff' : '#777', 'right', F2, false);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, wy + 18 * u, bw - 12 * u, 6 * u); g.fillStyle = n > 0 ? color : '#555'; g.fillRect(x, wy + 18 * u, (bw - 12 * u) * clamp(n / max, 0, 1), 6 * u);
      text(g, '[' + key + ']', x, wy + 40 * u, 11 * u, '#777', 'left', F2, false);
    };
    const kb = !pad_;
    slot(0, 'GUN', kb ? 'SPACE' : 'A', car.ammo.mg, st.mgAmmo, '#ffd23a'); slot(1, 'ROCKET', kb ? 'E' : 'X', car.ammo.rocket, st.rocketAmmo, '#ff6a3a'); slot(2, 'MINES', kb ? 'F' : 'B', car.ammo.mine, st.mineAmmo, '#a0e060');
  }
  // ---- messages / countdown
  if (game.state === 'countdown') {
    const n = Math.ceil(game.cd); if (n >= 1 && n <= 3) { const f = 1 - (game.cd - Math.floor(game.cd)); g.globalAlpha = 1 - f * 0.6; text(g, String(n), W / 2, H * 0.38 + 80 * u, (200 + f * 60) * u, n === 1 ? '#ffd23a' : '#fff', 'center'); g.globalAlpha = 1; }
  }
  if (game.msgs.length) { const m = game.msgs[game.msgs.length - 1]; const f = clamp(m.t / m.max, 0, 1); g.globalAlpha = Math.min(1, f * 3); text(g, m.text, W / 2, H * 0.28, (58 + (1 - f) * 10) * u, m.color, 'center'); g.globalAlpha = 1; }
  if (car.wrongWay > 1 && !car.finished) text(g, 'WRONG WAY', W / 2, H * 0.2, 54 * u, Math.floor(game.time * 4) % 2 ? '#ff3a2a' : '#fff', 'center');
  if (car.dead) { text(g, 'WRECKED', W / 2, H * 0.42, 90 * u, '#ff3a2a', 'center'); text(g, 'Respawning in ' + Math.max(0, car.respawnT).toFixed(1) + 's', W / 2, H * 0.42 + 36 * u, 24 * u, '#fff', 'center', F2); }
  if (car.finished && game.net && !game.over) text(g, 'FINISHED - waiting for other racers...', W / 2, H * 0.62, 26 * u, '#fff', 'center', F2);
  if (car.resetHold > 0.05) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(W / 2 - 60 * u, H * 0.7, 120 * u * (car.resetHold / 0.8), 6 * u); text(g, 'RESETTING', W / 2, H * 0.7 - 6 * u, 16 * u, '#fff', 'center', F2); }
  if (game.mode === 'tt' && game.ghost && game.state === 'racing') text(g, 'GHOST ACTIVE', W / 2, H - pad, 14 * u, '#9fe3ff', 'center', F2);
  if (opts.fps) text(g, opts.fps + ' fps', W - pad, H - pad, 13 * u, '#7f7', 'right', F2, false);
  if (opts.ping != null) text(g, 'ping ' + opts.ping + ' ms', W - pad, H - pad - (opts.fps ? 16 * u : 0), 13 * u, '#9cf', 'right', F2, false);
  // controls hint at the start
  if (game.time < 8 && game.state !== 'over') {
    g.globalAlpha = clamp((8 - game.time) / 2, 0, 1) * 0.9;
    const hint = pad_ ? 'RT accelerate · LT brake · A gun · X rocket · B mine · Y nitro · RB handbrake' : 'W/S accelerate/brake · A/D steer · SPACE gun · E rocket · F mine · SHIFT nitro · C handbrake · R reset';
    text(g, hint, W / 2, H - 20 * u - 120 * u, 15 * u, '#fff', 'center', F2); g.globalAlpha = 1;
  }
  // scoreboard
  if (Input.drive.scores) drawScoreboard(g, game, W, H, u);
}

function drawScoreboard(g, game, W, H, u) {
  const rows = game.order || game.cars, w = 560 * u, rh = 30 * u, h = (rows.length + 2) * rh + 20 * u, x = (W - w) / 2, y = (H - h) / 2;
  g.fillStyle = 'rgba(6,8,12,0.88)'; g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill(); g.strokeStyle = ACC; g.lineWidth = 2; g.stroke();
  text(g, 'STANDINGS', x + 20 * u, y + 34 * u, 28 * u, ACC);
  const cols = [x + 24 * u, x + 70 * u, x + 280 * u, x + 360 * u, x + 440 * u, x + w - 20 * u];
  ['#', 'DRIVER', 'LAP', 'BEST', 'KILLS'].forEach((t, i) => text(g, t, cols[i], y + 56 * u + 10 * u, 13 * u, '#888', i === 4 ? 'left' : 'left', F2, false));
  rows.forEach((c, i) => {
    const yy = y + 56 * u + (i + 1) * rh + 18 * u; if (c.human) { g.fillStyle = 'rgba(255,106,26,0.18)'; g.fillRect(x + 8, yy - 20 * u, w - 16, rh - 2); }
    text(g, String(i + 1), cols[0], yy, 17 * u, '#fff', 'left', F2, false);
    g.fillStyle = c.color; g.fillRect(cols[1], yy - 13 * u, 10 * u, 13 * u); text(g, c.name + (c.remote && !String(c.id).startsWith('b') ? '' : ''), cols[1] + 18 * u, yy, 17 * u, '#fff', 'left', F2, false);
    text(g, c.finished ? 'FIN' : String(Math.min(c.lap + 1, game.laps)), cols[2], yy, 17 * u, c.finished ? '#7dff3a' : '#ddd', 'left', F2, false);
    text(g, c.best != null ? fmtTime(c.best) : '-', cols[3], yy, 17 * u, '#9fe3ff', 'left', F2, false);
    text(g, String(c.kills), cols[4], yy, 17 * u, '#ffd23a', 'left', F2, false);
  });
}
