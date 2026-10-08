// Roadside pedestrians: people strolling along the verges and jaywalking across the road. Their movement is a pure
// function of the race clock (cheap, and the same on every client); getting hit sends them flying with a lot of blood.
import { mulberry32, clamp, TAU, shade } from './util.js';
import { pointAt, VERGE } from './tracks.js';
import Input from './input.js';

const SHIRTS = ['#d94a4a', '#3a7bd5', '#e6c229', '#3aa86a', '#9b59b6', '#e67e22', '#ecf0f1', '#16a085', '#34495e', '#c0392b', '#f39c12', '#7f8c8d'];
const SKIN = ['#f0d0b0', '#d8a070', '#a8714a', '#7a4f33'];
const DENSITY = { city: 7, industrial: 2.6, coast: 3.4, desert: 1.7, forest: 1.3, snow: 1.5, mesa: 1.3, warzone: 1.8, volcano: 0.5 }; // per 1000px of track
const RESPAWN = 25;

export function drawPedFigure(g, v, p, flat, alpha = 1) {
  const X = v.px(p.x, p.y, flat ? 2 : 6), Y = v.py(p.x, p.y, flat ? 2 : 6), z = v.zoom, sw = Math.sin((p.walk || 0) * 9) * 3.2;
  if (alpha < 1) g.globalAlpha = alpha;
  if (!flat) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(v.sx(p.x) + 3 * z, v.sy(p.y) + 3 * z, 6 * z, 4 * z, 0, 0, TAU); g.fill(); }
  g.save(); g.translate(X, Y); g.rotate(p.a || 0); g.scale(z, z);
  if (!flat) { g.fillStyle = '#2a2a34'; g.fillRect(-2 + sw, -5, 3.4, 5); g.fillRect(-2 - sw, 0, 3.4, 5); }
  g.fillStyle = p.shirt; g.beginPath(); g.ellipse(0, 0, 5.2, 7.2, 0, 0, TAU); g.fill();
  g.fillStyle = shade(p.shirt, -0.25); g.fillRect(-1, -7, 2, 14);
  g.fillStyle = p.skin; g.beginPath(); g.arc(0, 0, 3.6, 0, TAU); g.fill(); g.fillStyle = '#2b1d12'; g.beginPath(); g.arc(-0.6, 0.4, 3.4, 0, Math.PI); g.fill();
  g.strokeStyle = p.shirt; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath();
  if (!flat) { g.moveTo(0, -6); g.lineTo(sw, -9); g.moveTo(0, 6); g.lineTo(-sw, 9); } else { g.moveTo(-5, -4); g.lineTo(-9, -9); g.moveTo(5, 4); g.lineTo(9, 9); g.moveTo(-2, 6); g.lineTo(-6, 12); }
  g.stroke(); g.restore(); if (alpha < 1) g.globalAlpha = 1;
}

export class Peds {
  constructor(game) {
    this.game = game; const T = game.T, N = T.N, r = mulberry32((T.seed ^ 0x9ed5) >>> 0);
    const dens = (DENSITY[T.theme] ?? 1.4) * (T.data.peds ?? 1), n = Math.min(140, Math.round(dens * T.length / 1000));
    const rails = T.hazards.filter(h => h.t === 'train');
    this.list = []; this.flying = []; this.corpses = [];
    for (let tries = 0; this.list.length < n && tries < n * 8; tries++) {
      const i = Math.floor(r() * N); if (i < 30 || i > N - 30) continue;
      let ok = true; for (let k = -30; k <= 30 && ok; k += 3) { const q = (i + k + N) % N; if (T.z[q] >= 20 || T.tn[q]) ok = false; }
      if (!ok || rails.some(h => Math.abs((T.x[i] - h.x) * -h.ry + (T.y[i] - h.y) * h.rx) < 220)) continue;
      const span = 8 + Math.floor(r() * 26);
      this.list.push({ id: this.list.length, i0: i, side: r() < 0.5 ? -1 : 1, span, w: 26 + r() * 24, ph: r() * 1000, off: VERGE * (0.3 + r() * 0.55),
        shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], skin: SKIN[Math.floor(r() * SKIN.length)], jay: r() < (T.theme === 'city' ? 0.4 : 0.22), jp: 10 + r() * 16, jo: r() * 30,
        hx: T.x[i], hy: T.y[i], R: span * T.step + 160, deadUntil: -1 });
    }
  }
  /** where pedestrian p is at race time t */
  pos(p, t) {
    const T = this.game.T, N = T.N, L = p.span * T.step * 2, d = (((t * p.w + p.ph) % L) + L) % L, along = d < L / 2 ? d : L - d, fwd = d < L / 2;
    const f = p.i0 + along / T.step - p.span / 2, i = ((Math.floor(f) % N) + N) % N, edge = T.hw[i] + p.off;
    let lat = p.side * edge, cross = false, k = 0;
    if (p.jay) { // jaywalker: once a period, wanders across the road and stays on the far side until the next one
      k = Math.floor((t + p.jo) / p.jp); const ph = (t + p.jo) - k * p.jp, dur = (2 * edge) / (p.w * 0.85), sideAt = q => p.side * ((q & 1) ? -1 : 1);
      if (ph < dur) { const s0 = sideAt(k - 1), s1 = sideAt(k); lat = s0 * edge + (s1 - s0) * edge * (ph / dur); cross = s1 > s0 ? 1 : -1; } else lat = sideAt(k) * edge;
    }
    const q = pointAt(T, f, lat), a = cross ? q.a + cross * Math.PI / 2 : q.a + (fwd ? 0 : Math.PI);
    return { x: q.x, y: q.y, a: a + Math.PI / 2, walk: t * p.w / 18, shirt: p.shirt, skin: p.skin, onRoad: Math.abs(lat) < T.hw[i] + 4 };
  }
  update(dt) {
    const g = this.game, t = g.raceTime;
    for (const c of g.cars) {
      if (!c.local || c.dead || (c.z || 0) > 10) continue; const sp = Math.hypot(c.vx, c.vy); if (sp < 45) continue;
      for (const p of this.list) {
        if (p.deadUntil > t || Math.abs(c.x - p.hx) > p.R || Math.abs(c.y - p.hy) > p.R) continue;
        const q = this.pos(p, t), dx = q.x - c.x, dy = q.y - c.y; if (dx * dx + dy * dy > 40 * 40) continue;
        const ca = Math.cos(c.a), sa = Math.sin(c.a), u = dx * ca + dy * sa, w = -dx * sa + dy * ca;
        if (Math.abs(u) < c.len * 0.55 + 5 && Math.abs(w) < c.wid * 0.55 + 5) this.hit(p, q, c, sp);
      }
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i]; b.t -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.94; b.vy *= 0.94; b.a += b.w * dt; b.h = Math.max(0, b.h + b.vz * dt); b.vz -= 900 * dt;
      if (b.t <= 0) { this.flying.splice(i, 1); this.splat(b.x, b.y, 1.2); this.corpses.push({ x: b.x, y: b.y, a: b.a, shirt: b.shirt, skin: b.skin, t: 22 }); if (this.corpses.length > 40) this.corpses.shift(); }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) if ((this.corpses[i].t -= dt) <= 0) this.corpses.splice(i, 1);
  }
  splat(x, y, s = 1) { // blood pool + spatter baked into the terrain
    const gr = this.game.ground; gr.blot(x, y, 20 * s, '#5c0606', 0.75); const r = Math.random;
    for (let k = 0; k < 7; k++) { const a = r() * TAU, d = (12 + r() * 34) * s; gr.blot(x + Math.cos(a) * d, y + Math.sin(a) * d, (3 + r() * 7) * s, '#6e0808', 0.7); }
  }
  hit(p, q, c, sp, shot) {
    const g = this.game; p.deadUntil = g.raceTime + RESPAWN;
    this.flying.push({ x: q.x, y: q.y, vx: c.vx * 0.9 + (Math.random() - 0.5) * 120, vy: c.vy * 0.9 + (Math.random() - 0.5) * 120, vz: 160 + sp * 0.3, h: 4, a: Math.random() * TAU, w: (Math.random() - 0.5) * 24, t: 0.9, shirt: p.shirt, skin: p.skin });
    this.splat(q.x, q.y, 0.8);
    for (let k = 0; k < 14; k++) { const a = Math.random() * TAU, s = 60 + Math.random() * 220; g.fx.smoke(q.x, q.y, Math.cos(a) * s + c.vx * 0.3, Math.sin(a) * s + c.vy * 0.3, 2.5 + Math.random() * 3, 0.5 + Math.random() * 0.4, '150,8,8', 0.9); }
    for (let k = 0; k < 5; k++) g.fx.debris(q.x, q.y, c.vx * 0.4 + (Math.random() - 0.5) * 200, c.vy * 0.4 + (Math.random() - 0.5) * 200, Math.random() < 0.5 ? '#7a0a0a' : p.shirt);
    g.snd('thud', q.x, q.y, 1); g.snd('scream', q.x, q.y, 0.7, 0.9 + Math.random() * 0.3); if (!shot) { c.vx *= 0.96; c.vy *= 0.96; }
    g.feedAdd(c.name + (shot ? ' gunned someone down' : ' ran someone over'), '#ffb0a0');
    if (c.human) { g.stats.roadkill = (g.stats.roadkill || 0) + 1; if (!shot) c.cash += 25; g.stats.cash += 25; g.msg('ROADKILL +$25', 0.9, '#ff6a5a'); if (!shot) { Input.rumble(0.4, 0.9, 140); g.shake = Math.max(g.shake, 3); } }
  }
  /** a bullet or rocket at (x,y): returns true if it hit someone */
  shot(x, y, vx, vy, by) {
    const t = this.game.raceTime;
    for (const p of this.list) { if (p.deadUntil > t || Math.abs(x - p.hx) > p.R || Math.abs(y - p.hy) > p.R) continue; const q = this.pos(p, t); if ((q.x - x) ** 2 + (q.y - y) ** 2 < 11 * 11) { this.hit(p, q, { x, y, vx: vx * 0.25, vy: vy * 0.25, name: by ? by.name : 'Someone', human: by && by.human, local: true, cash: 0 }, 260, true); if (by && by.human) { by.cash += 25; } return true; } }
    return false;
  }
  draw(g, v) {
    const t = this.game.raceTime;
    for (const b of this.corpses) if (v.visible(b.x, b.y, 30)) drawPedFigure(g, v, b, true, clamp(b.t / 3, 0, 1));
    for (const p of this.list) {
      if (p.deadUntil > t || !v.visible(p.hx, p.hy, p.R)) continue; const q = this.pos(p, t); if (v.visible(q.x, q.y, 20)) drawPedFigure(g, v, q, false);
    }
    for (const b of this.flying) { const s = { ...b, x: b.x, y: b.y }; g.save(); drawPedFigure(g, v, s, true); g.restore(); }
  }
}
