// Civilian traffic: cars and lorries driving the circuit in both directions, plus side roads whose traffic crosses the
// racing line when its lights turn green. Normal motion is a pure function of the race clock (same on every client);
// knocks and wrecks are local. Racers bounce off them, can shoot them up, and bots steer round them.
import { mulberry32, clamp, TAU, shade } from './util.js';
import { pointAt } from './tracks.js';
import { drawCar } from './sprites.js';
import Input from './input.js';

const COLS = ['#c8ccd2', '#2f3b52', '#8b1e1e', '#e8e8e8', '#1f5f8b', '#6b6f75', '#d4b483', '#2e5e3a', '#4a3a6a', '#9a9da3', '#b5562b', '#f0f0e8'];
const KINDS = [ // len, wid, shape, speed factor
  { len: 40, wid: 21, shape: 'hatch', v: 1 }, { len: 42, wid: 21, shape: 'sport', v: 1.05 }, { len: 44, wid: 22, shape: 'hatch', v: 0.95 },
  { len: 58, wid: 25, shape: 'truck', v: 0.8, lorry: true }, { len: 76, wid: 27, shape: 'truck', v: 0.72, lorry: true, bus: true },
];
const LIGHT = { P: 16, green: 6.5 }; // side-road lights: cross traffic gets green for 6.5s every 16s
const XV = 210, GAP = 54; // side-road speed and queue spacing

export class Traffic {
  constructor(game) {
    this.game = game; const T = game.T, r = mulberry32((T.seed ^ 0x7a11c) >>> 0), cfg = T.data.traffic || {};
    this.cars = []; this.x = []; this.wrecks = new Map(); this.knock = new Map();
    const mk = (dir, k) => { const kind = KINDS[r() < 0.18 ? 3 + (r() < 0.35 ? 1 : 0) : Math.floor(r() * 3)], lanes = [0.25, 0.72];
      return { id: 'a' + k, dir, f0: r() * T.N, v: (dir > 0 ? 150 : 175) * kind.v * (0.85 + r() * 0.3), lat: dir * T.hw[0] * lanes[kind.lorry ? 1 : Math.floor(r() * 2)], ...kind, color: kind.bus ? '#e6b422' : COLS[Math.floor(r() * COLS.length)], hp: kind.lorry ? 160 : 70 }; };
    let k = 0; for (let i = 0; i < (cfg.along || 0); i++) this.cars.push(mk(1, k++)); for (let i = 0; i < (cfg.oncoming || 0); i++) this.cars.push(mk(-1, k++));
    for (const h of T.hazards) if (h.t === 'xroad') { h.off = (h.seed % 97) / 97 * LIGHT.P; h.wave = []; const rr = mulberry32(h.seed); for (let w = 0; w < 64; w++) h.wave.push([1 + Math.floor(rr() * 4), 1 + Math.floor(rr() * 4), rr(), rr()]); this.x.push(h); }
    this.active = this.cars.length > 0 || this.x.length > 0;
  }
  t() { return this.game.raceTime; }
  /** current pose of a circuit car (null while wrecked) */
  pose(c, t) {
    const T = this.game.T, f = (((c.f0 + c.dir * c.v * t / T.step) % T.N) + T.N) % T.N, q = pointAt(T, f, c.lat), kn = this.knock.get(c.id);
    const o = { x: q.x, y: q.y, a: q.a + (c.dir < 0 ? Math.PI : 0), f, z: q.z };
    if (kn) { o.x += kn.dx; o.y += kn.dy; o.a += kn.da; }
    return o;
  }
  /** side-road cars visible at time t: [{key,x,y,a,...kind}] */
  crossCars(h, t) {
    const out = [], c = h.cr[0], stop = Math.abs((c.hw + 60) / Math.max(0.5, Math.abs(h.rx * c.nx + h.ry * c.ny)));
    const tt = t + h.off, k0 = Math.floor(tt / LIGHT.P);
    for (let k = k0 - 1; k <= k0 + 1; k++) { if (k < 0) continue; const wv = h.wave[k % h.wave.length];
      for (const dir of [1, -1]) { const n = dir > 0 ? wv[0] : wv[1];
        for (let j = 0; j < n; j++) {
          const G = k * LIGHT.P, D = G + j * 0.85, Q = c.u - dir * (stop + j * GAP), wait = j * 0.85 + 0.6 + wv[2 + (dir > 0 ? 0 : 1)] * (LIGHT.P - LIGHT.green) * 0.8, A = D - wait;
          let u; if (tt < A) u = Q - dir * XV * (A - tt); else if (tt < D) u = Q; else u = Q + dir * XV * (tt - D);
          if (u < h.u0 - 10 || u > h.u1 + 10) continue;
          const key = h.id + ':' + k + ':' + dir + ':' + j; if (this.wrecks.has(key)) continue;
          const kind = KINDS[(k * 7 + j * 3 + (dir > 0 ? 0 : 1)) % 4], lane = dir * 15;
          out.push({ key, x: h.x + h.rx * u - h.ry * lane, y: h.y + h.ry * u + h.rx * lane, a: Math.atan2(h.ry * dir, h.rx * dir), ...kind, color: COLS[(k * 5 + j * 7 + (dir > 0 ? 3 : 0)) % COLS.length], moving: tt >= D || tt < A, hp: 70 });
        }
      }
    }
    return out;
  }
  lightGreen(h, t) { return ((t + h.off) % LIGHT.P) < LIGHT.green + 0.6; }
  /** everything that can be hit right now */
  all(t) {
    const out = [];
    for (const c of this.cars) { if (this.wrecks.has(c.id)) continue; const p = this.pose(c, t); out.push({ key: c.id, ...c, ...p, src: c }); }
    for (const h of this.x) out.push(...this.crossCars(h, t));
    for (const [key, w] of this.wrecks) out.push({ ...w, key, wreck: true });
    return out;
  }

  update(dt) {
    const g = this.game, t = this.t(); this.list = this.all(t);
    for (const [k, kn] of this.knock) { kn.dx *= Math.pow(0.4, dt); kn.dy *= Math.pow(0.4, dt); kn.da *= Math.pow(0.4, dt); if (Math.abs(kn.dx) + Math.abs(kn.dy) < 0.5) this.knock.delete(k); }
    for (const [k, w] of this.wrecks) { w.t -= dt; if (w.t < 6 && Math.random() < 0.3) g.fx.smoke(w.x, w.y, (Math.random() - 0.5) * 20, -20, 9, 1.2, '50,50,50', 0.5); if (w.t <= 0) this.wrecks.delete(k); }
    for (const c of g.cars) {
      if (!c.local || c.dead || (c.z || 0) > 14) continue;
      for (const o of this.list) {
        const dx = c.x - o.x, dy = c.y - o.y, R = (o.len + c.len) * 0.5; if (dx * dx + dy * dy > R * R) continue;
        // oriented-box overlap (traffic box in its own frame, racer approximated by a circle)
        const ca = Math.cos(o.a), sa = Math.sin(o.a), lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca, ex = o.len / 2 + c.wid * 0.45, ey = o.wid / 2 + c.wid * 0.45;
        if (Math.abs(lx) > ex || Math.abs(ly) > ey) continue;
        const px = ex - Math.abs(lx), py = ey - Math.abs(ly); let nx, ny, pen;
        if (px < py) { nx = ca * Math.sign(lx); ny = sa * Math.sign(lx); pen = px; } else { nx = -sa * Math.sign(ly); ny = ca * Math.sign(ly); pen = py; }
        c.x += nx * pen; c.y += ny * pen;
        const ov = o.moving === false || o.wreck ? 0 : (o.v || XV) * (o.dir || 1), ovx = Math.cos(o.a) * Math.abs(ov), ovy = Math.sin(o.a) * Math.abs(ov);
        const rvx = c.vx - ovx, rvy = c.vy - ovy, vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const heavy = o.lorry ? 1.7 : 1.25; c.vx -= heavy * vn * nx; c.vy -= heavy * vn * ny; c.w += (Math.random() - 0.5) * Math.min(8, -vn / 60);
          const imp = -vn; if (imp > 90) { g.damage(c, imp * (o.lorry ? 0.06 : 0.04), null, 'traffic'); g.snd('crash', c.x, c.y, Math.min(1, imp / 400)); g.fx.debris(o.x, o.y, -nx * 120, -ny * 120, o.color); if (c.human) { g.shake = Math.max(g.shake, Math.min(10, imp / 50)); Input.rumble(0.5, 0.6, 120); } }
          if (!o.wreck) { const kn = this.knock.get(o.key) || { dx: 0, dy: 0, da: 0 }; kn.dx -= nx * Math.min(26, imp * 0.05); kn.dy -= ny * Math.min(26, imp * 0.05); kn.da += (Math.random() - 0.5) * Math.min(0.9, imp / 400); this.knock.set(o.key, kn);
            if (imp > (o.lorry ? 420 : 300)) this.wreck(o, c); }
        }
      }
    }
  }
  /** a hit from a weapon: returns true if something was hit */
  shot(x, y, z, dmg, by) {
    if (!this.list || z > 30) return false;
    for (const o of this.list) { if (o.wreck) continue; const dx = x - o.x, dy = y - o.y, ca = Math.cos(o.a), sa = Math.sin(o.a); if (Math.abs(dx * ca + dy * sa) < o.len / 2 + 2 && Math.abs(-dx * sa + dy * ca) < o.wid / 2 + 2) {
      const hp = (this.hp || (this.hp = new Map())); const left = (hp.get(o.key) ?? o.hp) - dmg; hp.set(o.key, left); if (left <= 0) this.wreck(o, by); return true; } }
    return false;
  }
  wreck(o, by) {
    const g = this.game; this.wrecks.set(o.key, { x: o.x, y: o.y, a: o.a, len: o.len, wid: o.wid, shape: o.shape, color: shade(o.color, -0.55), lorry: o.lorry, t: 9 });
    g.fx.explosion(o.x, o.y, o.lorry ? 1 : 0.7); g.snd('explosion', o.x, o.y, 0.9); g.ground.blot(o.x, o.y, 40, '#000000', 0.45);
    if (by && by.human) { by.cash += 75; g.stats.cash += 75; g.msg('TRAFFIC WRECKED +$75', 1, '#ffb347'); }
  }
  /** steering hint for bots: -1/+1 to move left/right round traffic ahead, plus a speed cap if boxed in */
  avoid(c) {
    let s = 0; if (!this.list) return 0; const ca = Math.cos(c.a), sa = Math.sin(c.a);
    for (const o of this.list) { const dx = o.x - c.x, dy = o.y - c.y; if (dx * dx + dy * dy > 300 * 300) continue; const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca; if (lx > 0 && lx < 260 && Math.abs(ly) < 44) s += ly > 0 ? -1.4 : 1.4; }
    return s;
  }

  /* ---------------------------------------------------------------- drawing */
  drawRoads(g, v, time) { // side roads, car parks, stop lines (ground level)
    for (const h of this.x) {
      const d = (u, w) => [v.sx(h.x + h.rx * u - h.ry * w), v.sy(h.y + h.ry * u + h.rx * w)], c = h.cr[0];
      const cu = (v.x - h.x) * h.rx + (v.y - h.y) * h.ry, R = Math.hypot(v.W, v.H) / v.zoom / 2 + 200; const ua = Math.max(h.u0, cu - R), ub = Math.min(h.u1, cu + R); if (ub <= ua || Math.abs(-(v.x - h.x) * h.ry + (v.y - h.y) * h.rx) > R) continue;
      const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([u, w], i) => { const [x, y] = d(u, w); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); };
      poly([[ua, -46], [ub, -46], [ub, 46], [ua, 46]], '#5e5e58'); poly([[ua, -38], [ub, -38], [ub, 38], [ua, 38]], '#34353a');
      for (const [end, u] of [[h.ends[0], h.u0], [h.ends[1], h.u1]]) if (end === 'park') { const s = u < c.u ? -1 : 1; poly([[u - 10 * s, -110], [u + 150 * s, -110], [u + 150 * s, 110], [u - 10 * s, 110]], '#3d3e43'); g.strokeStyle = 'rgba(240,240,240,0.6)'; g.lineWidth = 2 * v.zoom; g.beginPath(); for (let k = -3; k <= 3; k++) { const a = d(u + 40 * s, k * 30), b = d(u + 130 * s, k * 30); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke(); }
      const stop = Math.abs((c.hw + 60) / Math.max(0.5, Math.abs(h.rx * c.nx + h.ry * c.ny))), segs = [[ua, Math.min(ub, c.u - stop + 20)], [Math.max(ua, c.u + stop - 20), ub]].filter(([a, b]) => b > a); // no markings across the junction
      g.strokeStyle = 'rgba(240,240,240,0.75)'; g.lineWidth = 2.5 * v.zoom; g.beginPath(); for (const [s0, s1] of segs) for (const w of [-34, 34]) { const a = d(s0, w), b = d(s1, w); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
      g.strokeStyle = 'rgba(242,197,0,0.85)'; g.setLineDash([16 * v.zoom, 14 * v.zoom]); g.beginPath(); for (const [s0, s1] of segs) { const a = d(s0, 0), b = d(s1, 0); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#f2f2f2'; g.lineWidth = 5 * v.zoom; g.beginPath(); for (const s of [-1, 1]) { const a = d(c.u - s * stop + s * 22, 0), b = d(c.u - s * stop + s * 22, s * -36); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    }
  }
  collect(list, v, LI) { // ground-level cars and the traffic lights join the depth-sorted list; deck / tunnel ones are drawn later
    const t = this.t(); if (!this.list) this.list = this.all(t); const N = this.game.T.N; this.layer = [[], [], []];
    for (const o of this.list) { if (!v.visible(o.x, o.y, 90)) continue; const i = o.f != null ? ((Math.floor(o.f) % N) + N) % N : -1; const L = i >= 0 && LI && LI.tnNear[i] && this.game.T.tn[i] ? 2 : i >= 0 && LI && (LI.elevNear[i] || (o.z || 0) >= 6) ? 1 : 0;
      if (L) this.layer[L].push(o); else list.push({ y: o.y + 4, k: 3, fn: (g, vv, tm) => this.drawVehicle(g, vv, o, tm) }); }
    for (const h of this.x) { const c = h.cr[0], stop = Math.abs((c.hw + 60) / Math.max(0.5, Math.abs(h.rx * c.nx + h.ry * c.ny))); for (const s of [-1, 1]) { const u = c.u - s * stop + s * 10, w = s * -48, x = h.x + h.rx * u - h.ry * w, y = h.y + h.ry * u + h.rx * w; if (v.visible(x, y, 120)) list.push({ y, k: 3, fn: (g, vv) => this.drawLight(g, vv, x, y, this.lightGreen(h, t)) }); } }
  }
  drawLayer(g, v, L) { if (!this.layer) return; const tm = this.game.time; for (const o of this.layer[L].sort((a, b) => a.y - b.y)) { if (L === 2) g.globalAlpha = 0.6; this.drawVehicle(g, v, o, tm); g.globalAlpha = 1; } }
  drawVehicle(g, v, o, t) {
    const car = { x: o.x, y: o.y, a: o.a, len: o.len, wid: o.wid, color: o.color, shape: o.shape, hp: o.wreck ? 0.1 : 1, maxHp: 1, steerVis: 0, name: '', invuln: 0, z: o.z || 0, zRoad: o.z || 0, braking: o.moving === false };
    drawCar(g, v, car, t, { night: this.game.night && this.game.quality > 0 });
    if (o.bus && !o.wreck) { const X = v.px(o.x, o.y, 26), Y = v.py(o.x, o.y, 26); g.save(); g.translate(X, Y); g.rotate(o.a); g.scale(v.zoom, v.zoom); g.fillStyle = 'rgba(255,255,255,0.18)'; for (let k = -2; k <= 2; k++) g.fillRect(k * 12 - 4, -o.wid / 2 + 2, 8, o.wid - 4); g.restore(); }
    if (o.wreck && Math.random() < 0.5) { const X = v.px(o.x, o.y, 20), Y = v.py(o.x, o.y, 20); g.fillStyle = `rgba(255,${120 + Math.random() * 80 | 0},30,0.6)`; g.beginPath(); g.arc(X + (Math.random() - 0.5) * 10, Y + (Math.random() - 0.5) * 10, (6 + Math.random() * 6) * v.zoom, 0, TAU); g.fill(); }
  }
  drawLight(g, v, x, y, green) {
    const z = v.zoom; g.strokeStyle = '#2a2d36'; g.lineWidth = 4 * z; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, 56), v.py(x, y, 56)); g.stroke();
    const X = v.px(x, y, 60), Y = v.py(x, y, 60); g.fillStyle = '#16171c'; g.fillRect(X - 6 * z, Y - 13 * z, 12 * z, 26 * z);
    g.fillStyle = green ? '#3a0d0d' : '#ff2a2a'; g.beginPath(); g.arc(X, Y - 6 * z, 4 * z, 0, TAU); g.fill();
    g.fillStyle = green ? '#2aff6a' : '#0d3a1a'; g.beginPath(); g.arc(X, Y + 6 * z, 4 * z, 0, TAU); g.fill();
  }
}
