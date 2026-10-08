// Moving track hazards. Everything is a pure function of the race clock, so every client in an online race sees the same train / wave / bombs.
import { clamp, mulberry32, hashStr, TAU, rgba, shade } from './util.js';
import { box } from './sprites.js';
import { pointAt, VERGE } from './tracks.js';
import Audio from './audio.js';
import Tex from './textures.js';
import Input from './input.js';

const TRAIN_SPEED = 780, TRAIN_LEN = 650, WAVE_SPEED = 330;
const SHIRTS = ['#d94a4a', '#3a7bd5', '#e6c229', '#3aa86a', '#9b59b6', '#e67e22', '#ecf0f1', '#16a085'];
const SKIN = ['#f0d0b0', '#d8a070', '#a8714a', '#7a4f33'];
const seg = (a, b, t) => a + (b - a) * t;

export class Hazards {
  constructor(game) {
    this.game = game; this.T = game.T; this.t = 0; this.peds = []; this.killed = new Set(); this.deadPeds = []; this.bombs = []; this.plane = null; this.runIdx = -1; this.warnText = null;
    this.list = this.T.hazards.map(h => {
      const o = { ...h, tx: Math.cos(h.a), ty: Math.sin(h.a) }; o.nx = -o.ty; o.ny = o.tx;
      if (h.t === 'train') { o.s0 = h.u0 - TRAIN_LEN - 60; o.s1 = h.u1 + 60; o.trans = (o.s1 - o.s0 + TRAIN_LEN) / TRAIN_SPEED; o.cr = h.cr.map(c => ({ ...c, arms: 0, warn: false })); }
      o.P = h.t === 'train' ? Math.ceil(2 + o.trans + 12) + (h.seed % 7) : h.t === 'cross' ? 15 + (h.seed % 5) : h.t === 'lava' ? 10 + (h.seed % 5) : h.t === 'wave' ? 46 + (h.seed % 12) : 1;
      o.off = (h.seed % 13) * 1.7;
      if (h.t === 'lava') { const side = h.side || 1; o.x = h.x + o.nx * side * h.hw * 0.78; o.y = h.y + o.ny * side * h.hw * 0.78; o.r = 64; }
      if (h.t === 'jump' || h.t === 'ford') { o.dx = o.tx; o.dy = o.ty; }
      return o;
    });
    this.hasBomber = !!this.T.bomber; this.runs = []; this.nextRun = 0;
    if (this.hasBomber) this.planRuns();
  }

  /* ---------------------------------------------------------------- bomber schedule (deterministic from the track seed) */
  planRuns() {
    const T = this.T, rng = mulberry32(T.seed ^ 0xb0b3);
    let t = 16 + rng() * 6;
    for (let k = 0; k < 40; k++) {
      const f = (((t * 410 / T.length) + 0.05 + (rng() - 0.5) * 0.06) % 1 + 1) % 1 * T.N, c = pointAt(T, f, 0);
      const along = rng() < 0.4, dir = c.a + (along ? 0 : (rng() < 0.5 ? 1 : -1) * (0.45 + rng() * 0.6));
      const bombs = []; const n = 7;
      for (let i = 0; i < n; i++) { const s = (i - (n - 1) / 2) * 88, j = (rng() - 0.5) * (along ? 90 : 50); bombs.push({ x: c.x + Math.cos(dir) * s - Math.sin(dir) * j, y: c.y + Math.sin(dir) * s + Math.cos(dir) * j, s, done: false, fx: false }); }
      this.runs.push({ t0: t, c, dir, bombs, shown: false }); t += 17 + rng() * 9;
    }
  }

  /* ---------------------------------------------------------------- update */
  update(dt) {
    const g = this.game, T = this.T; this.t = g.state === 'racing' ? g.raceTime : 0; const t = this.t, cam = g.cam; let warn = null;
    const near = (x, y, r) => Math.hypot(x - cam.x, y - cam.y) < r;
    for (const h of this.list) {
      if (h.t === 'train') { this.updateTrain(h, t, near, dt); if (h.anyWarn && h.cr.some(c => c.warn && near(c.x, c.y, 1700))) warn = warn || { text: 'TRAIN APPROACHING', c: '#ffb347' }; }
      else if (h.t === 'cross') this.updatePeds(h, t, dt);
      else if (h.t === 'ford') this.updateFord(h);
      else if (h.t === 'jump') this.updateJump(h);
      else if (h.t === 'lava') { const w = this.updateLava(h, t, near, dt); if (w && near(h.x, h.y, 1000)) warn = warn || { text: 'LAVA ERUPTING', c: '#ff6a2a' }; }
      else if (h.t === 'wave') { const w = this.updateWave(h, t, near, dt); if (w) warn = warn || { text: 'TIDAL WAVE', c: '#5fd0ff' }; }
    }
    if (this.hasBomber) { const w = this.updateBomber(t, dt, near); if (w) warn = warn || { text: 'AIR RAID', c: '#ff5a3a' }; }
    // dead pedestrians
    for (let i = this.deadPeds.length - 1; i >= 0; i--) { const p = this.deadPeds[i]; p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; p.a += p.w * dt; if (p.t <= 0) this.deadPeds.splice(i, 1); }
    g.warn = warn ? { ...warn, t: 0.3 } : null;
  }

  /* ---------------------------------------------------------------- train: one railway spanning the whole map, a level crossing wherever it meets the road */
  trainState(h, t) {
    const ph = (t + h.off) % h.P, head = ph >= 2 ? h.s0 + TRAIN_SPEED * (ph - 2) : null, tail = head == null ? null : head - TRAIN_LEN;
    return { ph, head, tail, active: head != null && tail < h.s1 };
  }
  updateTrain(h, t, near, dt) {
    const s = this.trainState(h, t), g = this.game; h.s = s; let anyWarn = false;
    for (const c of h.cr) { // every crossing warns on its own schedule: lights + bell as the train approaches, arms down until it has passed
      const arrive = 2 + (c.u - h.s0) / TRAIN_SPEED, clear = arrive + (TRAIN_LEN + 120) / TRAIN_SPEED;
      c.warn = s.ph >= arrive - 6 && s.ph < clear + 1.2; c.arms = s.ph >= arrive - 5 && s.ph < clear + 0.6 ? clamp(Math.min(s.ph - (arrive - 5), clear + 0.6 - s.ph) * 1.4, 0, 1) : 0; anyWarn = anyWarn || c.warn;
      if (c.warn) { const b = Math.floor(s.ph * 2); if (b !== c.lastBell) { c.lastBell = b; if (near(c.x, c.y, 1400)) g.snd('bell', c.x, c.y, 0.8); } }
      if (s.head != null && !c.horned && s.head > c.u - 1500 && s.head < c.u) { c.horned = true; if (near(c.x, c.y, 2400)) g.snd('horn', c.x, c.y, 1); }
      if (s.ph < 2) c.horned = false;
    }
    h.anyWarn = anyWarn; if (!s.active) return;
    for (const c of g.cars) { // the train hits anything on the rails, anywhere on the map
      if (!c.local || c.dead || (c.z || 0) > 12) continue;
      const rx = c.x - h.x, ry = c.y - h.y, u = rx * h.rx + ry * h.ry, w = -rx * h.ry + ry * h.rx;
      if (Math.abs(w) < 26 && u < s.head + 14 && u > s.tail - 14) {
        g.damage(c, 140, null, 'train'); const sp = 650; c.vx = h.rx * sp + (Math.random() - 0.5) * 100; c.vy = h.ry * sp + (Math.random() - 0.5) * 100; c.w += (Math.random() - 0.5) * 12; c.invuln = 0;
        g.fx.explosion(c.x, c.y, 0.9); g.snd('crash', c.x, c.y, 1); g.feedAdd(c.name + ' was hit by the train!', '#ff8a6a');
        if (c.human) { g.stats.trainHits = (g.stats.trainHits || 0) + 1; g.shake = 14; Input.rumble(1, 1, 300); }
      }
    }
  }

  /* ---------------------------------------------------------------- pedestrians */
  pedList(h, t) {
    const out = [], ph = (t + h.off) % h.P, k = Math.floor((t + h.off) / h.P), rng = mulberry32(h.seed * 977 + k);
    const dir = k % 2 ? 1 : -1, n = 3 + Math.floor(rng() * 3), span = h.hw + VERGE * 0.8 + 6;
    for (let i = 0; i < n; i++) {
      const delay = rng() * 1.6, sp = 56 + rng() * 22, along = (rng() - 0.5) * 70, key = h.id + ':' + k + ':' + i, walk = ph - delay; if (walk < 0) continue;
      const lat = dir * (-span + sp * walk); if (Math.abs(lat) > span + 4 && ((lat * dir) > 0)) continue; // arrived
      if (this.killed.has(key)) continue;
      out.push({ key, x: h.x + h.nx * lat + h.tx * along, y: h.y + h.ny * lat + h.ty * along, a: Math.atan2(h.ny * dir, h.nx * dir), walk, shirt: SHIRTS[(h.seed + i * 3 + k) % SHIRTS.length], skin: SKIN[(i + k) % SKIN.length], dir });
    }
    return out;
  }
  updatePeds(h, t, dt) {
    const g = this.game; h.peds = this.pedList(h, t);
    for (const p of h.peds) {
      for (const c of g.cars) {
        if (!c.local || c.dead || (c.z || 0) > 10) continue; const sp = Math.hypot(c.vx, c.vy); if (sp < 25) continue;
        if (Math.hypot(p.x - c.x, p.y - c.y) < c.wid * 0.62 + 7 && Math.abs((p.x - c.x) * Math.cos(c.a) + (p.y - c.y) * Math.sin(c.a)) < c.len * 0.6) {
          this.killed.add(p.key); this.deadPeds.push({ x: p.x, y: p.y, vx: c.vx * 0.8 + (Math.random() - 0.5) * 80, vy: c.vy * 0.8 + (Math.random() - 0.5) * 80, a: Math.random() * TAU, w: (Math.random() - 0.5) * 22, t: 1.1, shirt: p.shirt, skin: p.skin });
          g.ground.blot(p.x, p.y, 15, '#5a0f0f', 0.5); for (let k = 0; k < 6; k++) g.fx.debris(p.x, p.y, c.vx * 0.3 + (Math.random() - 0.5) * 160, c.vy * 0.3 + (Math.random() - 0.5) * 160, p.shirt);
          g.snd('thud', p.x, p.y, 0.9); c.vx *= 0.93; c.vy *= 0.93; g.feedAdd(c.name + ' hit a pedestrian', '#ffb0a0');
          if (c.human) { g.stats.roadkill = (g.stats.roadkill || 0) + 1; g.msg('ROADKILL', 0.9, '#ff6a5a'); Input.rumble(0.4, 0.8, 120); }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- ford, jump */
  updateFord(h) {
    const g = this.game;
    for (const c of g.cars) {
      if (!c.local || c.dead || c.zAir > 2) continue; const rx = c.x - h.x, ry = c.y - h.y, u = rx * h.tx + ry * h.ty, w = rx * h.nx + ry * h.ny;
      if (Math.abs(u) < 76 && Math.abs(w) < h.hw + 6) {
        if (c.human && !g.seenFord) { g.seenFord = true; g.msg('WATER - SLOWS YOU DOWN', 1.6, '#7fd0ff'); }
        if (!(c.waterT > 0)) { g.snd('splash', c.x, c.y, 0.7); for (let k = 0; k < 8; k++) g.fx.smoke(c.x, c.y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 6, 0.6, '170,210,240', 0.5); }
        c.waterT = 0.18; if (Math.random() < 0.6) g.fx.smoke(c.x - Math.cos(c.a) * 12, c.y - Math.sin(c.a) * 12, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 5, 0.5, '190,225,250', 0.55);
      }
    }
  }
  updateJump(h) {
    const g = this.game;
    for (const c of g.cars) {
      if (!c.local || c.dead || c.zAir > 1) continue; const rx = c.x - h.x, ry = c.y - h.y, u = rx * h.tx + ry * h.ty, w = rx * h.nx + ry * h.ny, sp = Math.hypot(c.vx, c.vy);
      if (u > -34 && u < 40 && Math.abs(w) < 62 && sp > 150 && (c.vx * h.tx + c.vy * h.ty) / (sp || 1) > 0.45) { c.vz = 90 + sp * 0.34; c.zAir = 0.5; g.snd('boost', c.x, c.y, 0.6, 1.4); if (c.human) { g.hudFlash = 0.2; Input.rumble(0.5, 0.2, 100); } }
    }
  }

  /* ---------------------------------------------------------------- lava */
  lavaState(h, t) { const ph = (t + h.off) % h.P; return ph < 4.5 ? 0 : ph < 6 ? 1 : ph < 7.8 ? 2 : 0; }
  updateLava(h, t, near, dt) {
    const g = this.game, st = this.lavaState(h, t); const prev = h.st || 0; h.st = st; const ph = (t + h.off) % h.P;
    if (st === 1 && prev === 0 && near(h.x, h.y, 1200)) g.snd('rumble', h.x, h.y, 0.9);
    if (st === 2 && prev !== 2) { g.snd('explosion', h.x, h.y, 1); if (near(h.x, h.y, 700)) g.shake = Math.max(g.shake, 6); }
    if (st >= 1 && Math.random() < 0.5) g.fx.fire(h.x + (Math.random() - 0.5) * 30, h.y + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40, -60 - Math.random() * 90 * st, 7 + st * 5, 0.5);
    if (st === 2) {
      const r = h.r * clamp((ph - 6) / 0.3, 0.5, 1);
      for (const c of g.cars) { if (!c.local || c.dead || (c.z || 0) > 12) continue; const d = Math.hypot(c.x - h.x, c.y - h.y); if (d < r + c.len * 0.3) { g.damage(c, 30 * dt, null, 'lava'); c.vx += ((c.x - h.x) / (d || 1)) * 380 * dt; c.vy += ((c.y - h.y) / (d || 1)) * 380 * dt; if (Math.random() < 0.4) g.fx.fire(c.x, c.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 8, 0.4); } }
    }
    return st >= 1;
  }

  /* ---------------------------------------------------------------- tidal wave */
  waveFront(h, t) { const ph = (t + h.off) % h.P; if (ph < 4) return null; const R = h.hw + 46 + 700, s = -R + WAVE_SPEED * (ph - 4); return s > R + 200 ? null : s; }
  updateWave(h, t, near, dt) {
    const g = this.game, ph = (t + h.off) % h.P, s = this.waveFront(h, t), side = h.side || 1; const dx = h.nx * side, dy = h.ny * side;
    if (ph < 4 && ph + dt > 0 && Math.floor((t + h.off) / h.P) !== h.lastK) { h.lastK = Math.floor((t + h.off) / h.P); if (this.game.human && near(h.x, h.y, 2600)) { g.msg('TIDAL WAVE!', 2, '#5fd0ff'); Audio.sfx('siren', { vol: 0.6 }); } }
    if (s == null) return ph < 4 && near(h.x, h.y, 1500);
    for (const c of g.cars) {
      if (!c.local || c.dead || (c.z || 0) > 12) continue; const rx = c.x - h.x, ry = c.y - h.y, u = rx * h.tx + ry * h.ty, w = rx * dx + ry * dy;
      if (Math.abs(u) > 400) continue;
      if (w > s - 75 && w < s + 75) { c.waterT = 0.25; c.vx += dx * 520 * dt; c.vy += dy * 520 * dt; if (Math.random() < 0.7) g.fx.smoke(c.x, c.y, dx * 120 + (Math.random() - 0.5) * 120, dy * 120 + (Math.random() - 0.5) * 120, 7, 0.6, '210,235,250', 0.6); if (!c.wetHit) { c.wetHit = true; g.snd('splash', c.x, c.y, 0.9); } }
      else if (w <= s - 75 && w > s - 280) { c.waterT = 0.2; if (Math.random() < 0.2) g.fx.smoke(c.x, c.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 5, 0.5, '190,225,245', 0.4); } else c.wetHit = false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- bomber */
  updateBomber(t, dt, near) {
    const g = this.game; let warn = false;
    for (const run of this.runs) {
      const dtr = t - run.t0; if (dtr < -1 || dtr > 11) continue; warn = warn || (dtr < 3);
      if (!run.shown && dtr >= 0) { run.shown = true; if (g.human) { g.msg('AIR RAID!', 2, '#ff5a3a'); Audio.sfx('siren', { vol: 0.7 }); } }
      if (dtr >= 0.2 && !run.whoosh && near(run.c.x, run.c.y, 2500)) { run.whoosh = true; g.snd('whoosh', run.c.x, run.c.y, 0.8, 0.7); }
      for (const b of run.bombs) {
        const drop = run.t0 + (1500 + b.s) / 1000, hit = drop + 1.1;
        if (t >= hit && !b.done) {
          b.done = true; g.fx.explosion(b.x, b.y, 1.2); g.snd('explosion', b.x, b.y, 1); g.ground.blot(b.x, b.y, 34, '#000000', 0.5); g.ground.blot(b.x, b.y, 55, '#2a2018', 0.35);
          g.shake = Math.max(g.shake, clamp(10 - Math.hypot(b.x - g.cam.x, b.y - g.cam.y) / 90, 0, 9));
          for (const c of g.cars) { if (!c.local || c.dead || (c.z || 0) > 30) continue; const d = Math.hypot(c.x - b.x, c.y - b.y); if (d < 110) { g.damage(c, 42 * (1 - d / 125), null, 'bomb'); c.vx += ((c.x - b.x) / (d || 1)) * 320; c.vy += ((c.y - b.y) / (d || 1)) * 320; c.w += (Math.random() - 0.5) * 8; } }
        }
      }
    }
    return warn;
  }

  /* ---------------------------------------------------------------- AI hooks */
  /** true if a bot should hold (stop short of a crossing with a train coming) */
  holdFor(c) {
    for (const h of this.list) if (h.t === 'train' && h.cr) for (const x of h.cr) if (x.warn) { const d = (x.f - c.pos + this.T.N) % this.T.N; if (d > 1 && d < 34) return true; }
    return false;
  }
  slowFor(c) { for (const h of this.list) if (h.t === 'cross' && h.peds && h.peds.length) { const d = (h.f - c.pos + this.T.N) % this.T.N; if (d > 0 && d < 24) return true; } return false; }

  /* ---------------------------------------------------------------- drawing: ground level */
  drawGround(g, v, time) {
    for (const h of this.list) {
      if (h.t === 'train') { this.drawRails(g, v, h, time); continue; }
      if (!v.visible(h.x, h.y, h.t === 'wave' ? 1400 : 220)) continue;
      if (false) 0; else if (h.t === 'cross') this.drawCrosswalk(g, v, h); else if (h.t === 'ford') this.drawFord(g, v, h, time);
      else if (h.t === 'lava') this.drawLavaGlow(g, v, h, time); else if (h.t === 'wave') this.drawWave(g, v, h, time);
    }
    if (this.hasBomber) this.drawBombMarkers(g, v, time);
    // flattened pedestrians' bodies in flight
    for (const p of this.deadPeds) if (v.visible(p.x, p.y, 40)) this.drawPed(g, v, p, 0, true);
  }
  drawRails(g, v, h, time) {
    // the railway runs across the whole map; only the part near the view is drawn
    const cam = this.game.cam, R = Math.hypot(v.W, v.H) / v.zoom / 2 + 260, wc = -(cam.x - h.x) * h.ry + (cam.y - h.y) * h.rx; if (Math.abs(wc) > R) return;
    const uc = (cam.x - h.x) * h.rx + (cam.y - h.y) * h.ry, ua = Math.max(h.u0, uc - R), ub = Math.min(h.u1, uc + R); if (ub <= ua) return;
    const d = (u, w) => [v.sx(h.x + h.rx * u - h.ry * w), v.sy(h.y + h.ry * u + h.rx * w)];
    g.fillStyle = 'rgba(52,48,44,0.92)'; g.beginPath(); for (const [u, w] of [[ua, -34], [ub, -34], [ub, 34], [ua, 34]]) { const [x, y] = d(u, w); g.lineTo(x, y); } g.closePath(); g.fill();
    g.strokeStyle = '#5a3d26'; g.lineWidth = 5 * v.zoom; g.beginPath(); for (let u = Math.ceil(ua / 17) * 17; u <= ub; u += 17) { const a = d(u, -30), b = d(u, 30); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    g.strokeStyle = '#c9ced6'; g.lineWidth = 3 * v.zoom; g.beginPath(); for (const w of [-14, 14]) { const a = d(ua, w), b = d(ub, w); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1 * v.zoom; g.beginPath(); for (const w of [-15, 13]) { const a = d(ua, w), b = d(ub, w); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    // road planks + hazard stripes at every crossing
    for (const c of h.cr) {
      if (c.u < ua - 200 || c.u > ub + 200) continue; const cosA = Math.max(0.35, Math.abs(h.rx * c.nx + h.ry * c.ny)), half = Math.min(c.hw * 2, (c.hw + 4) / cosA);
      g.fillStyle = 'rgba(70,64,58,0.9)'; g.beginPath(); for (const [u, w] of [[c.u - half, -40], [c.u + half, -40], [c.u + half, 40], [c.u - half, 40]]) { const [x, y] = d(u, w); g.lineTo(x, y); } g.closePath(); g.fill();
      g.strokeStyle = '#f2c500'; g.lineWidth = 3 * v.zoom; g.setLineDash([9 * v.zoom, 9 * v.zoom]); for (const w of [-46, 46]) { g.beginPath(); const a = d(c.u - half, w), b = d(c.u + half, w); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } g.setLineDash([]);
    }
  }
  drawCrosswalk(g, v, h) {
    const d = (lat, a) => [v.sx(h.x + h.nx * lat + h.tx * a), v.sy(h.y + h.ny * lat + h.ty * a)];
    g.fillStyle = 'rgba(245,245,245,0.88)';
    for (let lat = -h.hw + 10; lat < h.hw - 6; lat += 30) { g.beginPath(); for (const [l, a] of [[lat, -26], [lat + 16, -26], [lat + 16, 26], [lat, 26]]) { const [x, y] = d(l, a); g.lineTo(x, y); } g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(245,245,245,0.8)'; g.lineWidth = 5 * v.zoom; for (const a of [-46, 46]) { g.beginPath(); const p = d(-h.hw, a), q = d(h.hw, a); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
  }
  drawFord(g, v, h, time) {
    // a shallow water crossing running edge to edge, with foam where you drive in and out
    const X = v.sx(h.x), Y = v.sy(h.y); g.save(); g.translate(X, Y); g.rotate(h.a); g.scale(v.zoom, v.zoom);
    const L = 78, Wd = h.hw + 6; const gr = g.createLinearGradient(0, -Wd, 0, Wd); gr.addColorStop(0, 'rgba(60,130,190,0.15)'); gr.addColorStop(0.12, 'rgba(60,135,195,0.7)'); gr.addColorStop(0.88, 'rgba(60,135,195,0.7)'); gr.addColorStop(1, 'rgba(60,130,190,0.15)');
    g.fillStyle = gr; g.beginPath(); g.roundRect(-L, -Wd, L * 2, Wd * 2, 18); g.fill();
    const wp = Tex.get('water'); if (wp) { g.save(); g.clip(); g.imageSmoothingEnabled = false; g.globalAlpha = 0.55; g.translate(((time * 14) % 192), 0); g.fillStyle = wp; g.fillRect(-L - 200, -Wd, L * 2 + 400, Wd * 2); g.restore(); }
    g.strokeStyle = 'rgba(235,248,255,0.5)'; g.lineWidth = 1.6; for (let k = 0; k < 5; k++) { g.beginPath(); for (let y = -Wd + 6; y <= Wd - 6; y += 6) { const x = -L + 14 + ((time * 22 + k * 32) % (L * 2 - 28)) + Math.sin(y * 0.09 + time * 3) * 4; y === -Wd + 6 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4; g.lineJoin = 'round'; for (const sx of [-L, L]) { g.beginPath(); for (let y = -Wd + 8; y <= Wd - 8; y += 6) { const x = sx + Math.sin(y * 0.2 + time * 5) * 3; y === -Wd + 8 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.ellipse(-24, -Wd * 0.35, 30, 6, 0.2, 0, TAU); g.fill(); g.restore();
  }
  drawWarnSign(g, v, x, y, sym) {
    const X = v.px(x, y, 34), Y = v.py(x, y, 34), z = v.zoom;
    g.strokeStyle = '#3a3d44'; g.lineWidth = 3 * z; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(X, Y + 6 * z); g.stroke();
    g.save(); g.translate(X, Y - 4 * z); g.scale(z, z); g.fillStyle = '#f2c500'; g.strokeStyle = '#111'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, -13); g.lineTo(12, 9); g.lineTo(-12, 9); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText(sym, 0, 7); g.restore();
  }
  drawLavaGlow(g, v, h, time) {
    const st = h.st || 0, X = v.sx(h.x), Y = v.sy(h.y), r = (st === 2 ? 130 : st === 1 ? 90 : 60) * v.zoom; g.save(); g.globalCompositeOperation = 'lighter';
    const f = 0.55 + 0.25 * Math.sin(time * 5 + h.seed); const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, `rgba(255,${st === 2 ? 190 : 110},40,${0.75 * f + (st === 2 ? 0.25 : 0)})`); gr.addColorStop(1, 'rgba(255,60,10,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); g.restore();
    g.fillStyle = '#1a0d0a'; g.beginPath(); g.arc(X, Y, 20 * v.zoom, 0, TAU); g.fill(); g.fillStyle = st ? '#ff8a1f' : '#a33a10'; g.beginPath(); g.arc(X, Y, 13 * v.zoom, 0, TAU); g.fill();
  }
  drawWave(g, v, h, time) {
    const s = this.waveFront(h, this.t); const ph = (this.t + h.off) % h.P; const side = h.side || 1, dx = h.nx * side, dy = h.ny * side;
    const P = (u, w) => [v.sx(h.x + dx * u + h.tx * w), v.sy(h.y + dy * u + h.ty * w)];
    if (s == null) { if (ph < 4) { // calm warning: a foamy line far out at sea
        const R = h.hw + 46 + 700; g.strokeStyle = `rgba(230,245,255,${0.25 + 0.2 * Math.sin(time * 6)})`; g.lineWidth = 4 * v.zoom; g.beginPath(); for (let w = -400; w <= 400; w += 40) { const [x, y] = P(-R, w); w === -400 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); } return; }
    const back = 280, front = 80;
    const grad = g.createLinearGradient(...P(s - back, 0), ...P(s + front, 0)); grad.addColorStop(0, 'rgba(60,150,190,0)'); grad.addColorStop(0.35, 'rgba(60,150,195,0.4)'); grad.addColorStop(0.9, 'rgba(40,130,185,0.72)'); grad.addColorStop(1, 'rgba(200,235,250,0.85)');
    g.fillStyle = grad; g.beginPath(); for (const [u, w] of [[s - back, -420], [s + front, -420]]) { const [x, y] = P(u, w); g.lineTo(x, y); } for (const [u, w] of [[s + front, 420], [s - back, 420]]) { const [x, y] = P(u, w); g.lineTo(x, y); } g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6 * v.zoom; g.lineJoin = 'round'; g.beginPath(); for (let w = -420; w <= 420; w += 18) { const [x, y] = P(s + front - 8 + Math.sin(w * 0.07 + time * 8) * 9, w); w === -420 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3 * v.zoom; for (let k = 1; k < 4; k++) { g.beginPath(); for (let w = -420; w <= 420; w += 24) { const [x, y] = P(s + front - 40 * k + Math.sin(w * 0.05 + time * 6 + k) * 8, w); w === -420 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
  }
  drawBombMarkers(g, v, time) {
    for (const run of this.runs) {
      const dtr = this.t - run.t0; if (dtr < -0.1 || dtr > 10) continue;
      for (const b of run.bombs) { if (b.done || !v.visible(b.x, b.y, 130)) continue; const drop = run.t0 + (1500 + b.s) / 1000, left = Math.max(0, drop + 1.1 - this.t), X = v.sx(b.x), Y = v.sy(b.y), pulse = 0.55 + 0.45 * Math.sin(time * 14);
        g.strokeStyle = `rgba(255,70,50,${pulse})`; g.lineWidth = 3 * v.zoom; g.beginPath(); g.arc(X, Y, 100 * v.zoom * (0.55 + clamp(left, 0, 2) * 0.22), 0, TAU); g.stroke(); g.fillStyle = `rgba(255,70,50,${pulse * 0.35})`; g.beginPath(); g.arc(X, Y, 100 * v.zoom * 0.5, 0, TAU); g.fill(); g.strokeStyle = `rgba(255,120,90,${pulse})`; g.lineWidth = 2 * v.zoom; g.beginPath(); g.moveTo(X - 10 * v.zoom, Y); g.lineTo(X + 10 * v.zoom, Y); g.moveTo(X, Y - 10 * v.zoom); g.lineTo(X, Y + 10 * v.zoom); g.stroke(); }
    }
  }

  /* ---------------------------------------------------------------- tall objects: added to the depth-sorted list */
  collect(list, v) {
    for (const h of this.list) {
      if (h.t === 'train') { for (const c of h.cr) { if (!v.visible(c.x, c.y, 260)) continue; c.s = { warn: c.warn, arms: c.arms }; for (const s of [-1, 1]) { const py = c.y + c.ty * s * 34 + c.ny * s * (c.hw + 24); list.push({ y: py + 6, k: 3, fn: (g, vv, t) => this.drawSignal(g, vv, c, s, t) }); } } continue; }
      if (!v.visible(h.x, h.y, 260)) continue;
      if (h.t === 'cross') { for (const s of [-1, 1]) list.push({ y: h.y + h.ny * s * (h.hw + 34), k: 3, fn: (g, vv, t) => this.drawPedLight(g, vv, h, s, t) }); for (const p of h.peds || []) list.push({ y: p.y, k: 3, fn: (g, vv, t) => this.drawPed(g, vv, p, t, false) }); }
      else if (h.t === 'jump') list.push({ y: h.y + 20, k: 3, fn: (g, vv) => this.drawRamp(g, vv, h) });
      else if (h.t === 'ford') { for (const sd of [-1, 1]) { const px = h.x + h.tx * -105 + h.nx * sd * (h.hw + 26), py = h.y + h.ty * -105 + h.ny * sd * (h.hw + 26); list.push({ y: py, k: 3, fn: (g, vv) => this.drawWarnSign(g, vv, px, py, '≈') }); } }
    }
  }
  drawSignal(g, v, h, s, t) {
    // post stands just beside the road, 34px before/after the rails; its arm swings across half the carriageway
    const L = s * (h.hw + 24), px = h.x + h.tx * s * 34 + h.nx * L, py = h.y + h.ty * s * 34 + h.ny * L;
    const st = h.s || { warn: false, arms: 0 }, flash = Math.floor(t * 3) % 2, down = st.arms;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(v.sx(px) + 8 * v.zoom, v.sy(py) + 6 * v.zoom, 8 * v.zoom, 5 * v.zoom, 0, 0, TAU); g.fill();
    g.strokeStyle = '#3a3d44'; g.lineWidth = 4 * v.zoom; g.beginPath(); g.moveTo(v.px(px, py, 0), v.py(px, py, 0)); g.lineTo(v.px(px, py, 58), v.py(px, py, 58)); g.stroke();
    g.fillStyle = '#e8e8e8'; g.save(); g.translate(v.px(px, py, 42), v.py(px, py, 42)); g.rotate(h.a); g.scale(v.zoom, v.zoom); g.fillRect(-13, -2, 26, 4); g.rotate(1.57); g.fillRect(-13, -2, 26, 4); g.restore();
    for (const [k, ox] of [[0, -6], [1, 6]]) {
      const lx = px + h.nx * ox, ly = py + h.ny * ox, X = v.px(lx, ly, 60), Y = v.py(lx, ly, 60), on = st.warn && flash === k;
      g.fillStyle = on ? '#ff2a2a' : '#4a1212'; g.beginPath(); g.arc(X, Y, 4.2 * v.zoom, 0, TAU); g.fill();
      if (on) { g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(X, Y, 0, X, Y, 26 * v.zoom); gr.addColorStop(0, 'rgba(255,60,40,0.8)'); gr.addColorStop(1, 'rgba(255,60,40,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 26 * v.zoom, 0, TAU); g.fill(); g.restore(); }
    }
    const reach = h.hw + 24, a0 = [v.px(px, py, 22), v.py(px, py, 22)];
    const tx = px - h.nx * s * reach * down, ty = py - h.ny * s * reach * down, th = 22 + (1 - down) * 40;
    const tip = down > 0.02 ? [v.px(tx, ty, th), v.py(tx, ty, th)] : [v.px(px, py, 62), v.py(px, py, 62)];
    g.lineCap = 'butt'; g.lineWidth = 5 * v.zoom; g.strokeStyle = '#f2f2f2'; g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    g.strokeStyle = '#d82020'; g.setLineDash([8 * v.zoom, 8 * v.zoom]); g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(tip[0], tip[1]); g.stroke(); g.setLineDash([]);
  }
  drawPedLight(g, v, h, s, t) {
    const lat = s * (h.hw + 32), px = h.x + h.nx * lat + h.tx * 40, py = h.y + h.ny * lat + h.ty * 40, walking = (h.peds || []).length > 0;
    g.strokeStyle = '#2d3036'; g.lineWidth = 3.5 * v.zoom; g.beginPath(); g.moveTo(v.px(px, py, 0), v.py(px, py, 0)); g.lineTo(v.px(px, py, 52), v.py(px, py, 52)); g.stroke();
    g.fillStyle = '#15171b'; g.beginPath(); g.roundRect(v.px(px, py, 56) - 5 * v.zoom, v.py(px, py, 56) - 8 * v.zoom, 10 * v.zoom, 16 * v.zoom, 2 * v.zoom); g.fill();
    g.fillStyle = walking ? '#3a1111' : '#ff3a3a'; g.beginPath(); g.arc(v.px(px, py, 56), v.py(px, py, 56) - 3.5 * v.zoom, 2.6 * v.zoom, 0, TAU); g.fill(); g.fillStyle = walking ? '#46ff7a' : '#113a1e'; g.beginPath(); g.arc(v.px(px, py, 56), v.py(px, py, 56) + 3.5 * v.zoom, 2.6 * v.zoom, 0, TAU); g.fill();
  }
  drawPed(g, v, p, t, flat) {
    const X = v.px(p.x, p.y, flat ? 4 : 6), Y = v.py(p.x, p.y, flat ? 4 : 6), z = v.zoom, sw = Math.sin((p.walk || 0) * 9) * 3.2;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(v.sx(p.x) + 3 * z, v.sy(p.y) + 3 * z, 6 * z, 4 * z, 0, 0, TAU); g.fill();
    g.save(); g.translate(X, Y); g.rotate(flat ? p.a : (p.a || 0)); g.scale(z, z);
    if (!flat) { g.fillStyle = '#2a2a34'; g.fillRect(-2 + sw, -5, 3.4, 5); g.fillRect(-2 - sw, 0, 3.4, 5); } // legs (stride)
    g.fillStyle = p.shirt; g.beginPath(); g.ellipse(0, 0, 5.2, 7.2, 0, 0, TAU); g.fill();
    g.fillStyle = shade(p.shirt, -0.25); g.fillRect(-1, -7, 2, 14);
    g.fillStyle = p.skin; g.beginPath(); g.arc(0, 0, 3.6, 0, TAU); g.fill(); g.fillStyle = '#2b1d12'; g.beginPath(); g.arc(-0.6, 0.4, 3.4, 0, Math.PI); g.fill();
    if (!flat) { g.strokeStyle = p.shirt; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -6); g.lineTo(sw, -9); g.moveTo(0, 6); g.lineTo(-sw, 9); g.stroke(); } else { g.strokeStyle = p.shirt; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-5, -4); g.lineTo(-9, -9); g.moveTo(5, 4); g.lineTo(10, 9); g.stroke(); }
    g.restore();
  }
  drawRamp(g, v, h) {
    const L = 90, Wd = 112, H = 24, c = Math.cos(h.a), s = Math.sin(h.a), pt = (u, w, z) => [v.px(h.x + c * u - s * w, h.y + s * u + c * w, z), v.py(h.x + c * u - s * w, h.y + s * u + c * w, z)];
    const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); for (const [u, w] of [[-L / 2, -Wd / 2], [L / 2, -Wd / 2], [L / 2, Wd / 2], [-L / 2, Wd / 2]]) g.lineTo(v.sx(h.x + c * u - s * w) + 10 * v.zoom, v.sy(h.y + s * u + c * w) + 8 * v.zoom); g.closePath(); g.fill();
    for (const sd of [-1, 1]) poly([pt(-L / 2, sd * Wd / 2, 0), pt(L / 2, sd * Wd / 2, 0), pt(L / 2, sd * Wd / 2, H)], sd > 0 ? '#7a5a30' : '#6a4d28'); // side wedges
    poly([pt(L / 2, -Wd / 2, 0), pt(L / 2, Wd / 2, 0), pt(L / 2, Wd / 2, H), pt(L / 2, -Wd / 2, H)], '#52391d'); // back wall
    poly([pt(-L / 2, -Wd / 2, 0), pt(L / 2, -Wd / 2, H), pt(L / 2, Wd / 2, H), pt(-L / 2, Wd / 2, 0)], '#b88a45'); // ramp surface
    g.strokeStyle = '#5a3d1c'; g.lineWidth = 2 * v.zoom; g.beginPath(); for (let k = 1; k < 6; k++) { const u = -L / 2 + (L * k) / 6, z = H * k / 6, a = pt(u, -Wd / 2, z), b = pt(u, Wd / 2, z); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    g.strokeStyle = '#f2c500'; g.lineWidth = 4 * v.zoom; g.beginPath(); for (const sd of [-1, 1]) { const a = pt(-L / 2, sd * (Wd / 2 - 4), 0), b = pt(L / 2, sd * (Wd / 2 - 4), H); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
  }

  /* ---------------------------------------------------------------- drawing: above everything (train, plane, falling bombs) */
  drawTop(g, v, time) {
    for (const h of this.list) if (h.t === 'train' && h.s && h.s.active) this.drawTrain(g, v, h);
    if (this.hasBomber) this.drawPlane(g, v, time);
    for (const h of this.list) if (h.t === 'lava' && (h.st || 0) === 2 && v.visible(h.x, h.y, 200)) { const X = v.px(h.x, h.y, 50), Y = v.py(h.x, h.y, 50); g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(X, Y, 0, X, Y, 70 * v.zoom); gr.addColorStop(0, 'rgba(255,230,120,0.65)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 70 * v.zoom, 0, TAU); g.fill(); g.restore(); }
  }
  drawTrain(g, v, h) {
    const s = h.s, parts = [{ len: 112, h: 42, w: 40, c: '#2b3a55', r: '#4a5f88', loco: true }]; for (let k = 0; k < 5; k++) parts.push({ len: 100, h: 34, w: 38, c: ['#8a3a2a', '#3a5a8a', '#7a6a2a', '#4a6a4a', '#6a3a6a'][k], r: ['#a85a4a', '#5a7aaa', '#9a8a4a', '#6a8a6a', '#8a5a8a'][k] });
    const items = []; let off = s.head;
    for (const p of parts) { const u = off - p.len / 2; items.push({ x: h.x + h.nx * u, y: h.y + h.ny * u, p }); off -= p.len + 8; }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (!v.visible(it.x, it.y, 130)) continue; const rot = Math.atan2(h.ny, h.nx);
      box(g, v, it.x, it.y, it.p.len, it.p.w, it.p.h, rot, it.p.c, it.p.r, {});
      if (it.p.loco) { const hx = it.x + h.nx * (it.p.len / 2), hy = it.y + h.ny * (it.p.len / 2); g.save(); g.globalCompositeOperation = 'lighter'; const X = v.px(hx, hy, 24), Y = v.py(hx, hy, 24), gr = g.createRadialGradient(X, Y, 0, X, Y, 50 * v.zoom); gr.addColorStop(0, 'rgba(255,245,200,0.9)'); gr.addColorStop(1, 'rgba(255,245,200,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 50 * v.zoom, 0, TAU); g.fill(); g.restore(); }
    }
  }
  drawPlane(g, v, time) {
    for (const run of this.runs) {
      const dtr = this.t - run.t0; if (dtr < -0.5 || dtr > 4.2) { this.drawBombsFalling(g, v, run); continue; }
      const along = -1500 + 1000 * dtr, c = Math.cos(run.dir), s = Math.sin(run.dir), px = run.c.x + c * along, py = run.c.y + s * along, H = 170;
      if (v.visible(px, py, 260)) {
        const P = (u, w, z) => { const x = px + c * u - s * w, y = py + s * u + c * w; return [v.px(x, y, z), v.py(x, y, z)]; }, poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); for (const [u, w] of [[-60, 0], [-25, -6], [40, -5], [75, 0], [40, 5], [-25, 6], [-10, 70], [-24, 70], [-18, 6], [-10, -70], [-24, -70]]) { const x = px + c * u - s * w + 60, y = py + s * u + c * w + 45; g.lineTo(v.sx(x), v.sy(y)); } g.fill();
        const wingCol = '#5a6350', bodyCol = '#6f7a62', dark = '#434a3b';
        poly([P(12, -6, H), P(-10, -78, H), P(-26, -78, H), P(-20, -6, H)], wingCol); poly([P(12, 6, H), P(-10, 78, H), P(-26, 78, H), P(-20, 6, H)], wingCol);
        poly([P(-48, -3, H), P(-60, -26, H), P(-68, -26, H), P(-62, -3, H)], dark); poly([P(-48, 3, H), P(-60, 26, H), P(-68, 26, H), P(-62, 3, H)], dark);
        poly([P(-66, 0, H), P(-34, -7, H), P(44, -6, H), P(78, 0, H), P(44, 6, H), P(-34, 7, H)], bodyCol); poly([P(10, -3, H + 3), P(30, -3, H + 3), P(34, 0, H + 3), P(30, 3, H + 3), P(10, 3, H + 3)], 'rgba(150,200,230,0.8)');
        g.fillStyle = '#b02a22'; for (const w of [-52, 52]) { const q = P(-16, w, H + 1); g.beginPath(); g.arc(q[0], q[1], 4 * v.zoom, 0, TAU); g.fill(); }
        const sp = (time * 40) % TAU; g.strokeStyle = 'rgba(30,30,30,0.5)'; g.lineWidth = 2 * v.zoom; const q = P(80, 0, H); g.beginPath(); g.moveTo(q[0] + Math.cos(sp) * 12 * v.zoom, q[1] + Math.sin(sp) * 12 * v.zoom); g.lineTo(q[0] - Math.cos(sp) * 12 * v.zoom, q[1] - Math.sin(sp) * 12 * v.zoom); g.stroke();
      }
      this.drawBombsFalling(g, v, run);
    }
  }
  drawBombsFalling(g, v, run) {
    for (const b of run.bombs) {
      const drop = run.t0 + (1500 + b.s) / 1000, f = (this.t - drop) / 1.1; if (f < 0 || f > 1 || b.done) continue; const z = 170 * (1 - f * f), px = b.x - (Math.cos(run.dir) * 60) * (1 - f), py = b.y - (Math.sin(run.dir) * 60) * (1 - f);
      if (!v.visible(px, py, 60)) continue; g.fillStyle = `rgba(0,0,0,${0.15 + 0.2 * f})`; g.beginPath(); g.ellipse(v.sx(b.x), v.sy(b.y), (4 + 6 * f) * v.zoom, (3 + 4 * f) * v.zoom, 0, 0, TAU); g.fill();
      const X = v.px(px, py, z), Y = v.py(px, py, z), a = Math.atan2(1, 0.3 * (1 - f)) ; g.save(); g.translate(X, Y); g.rotate(run.dir + 1.2); g.scale(v.zoom, v.zoom); g.fillStyle = '#3a3f33'; g.beginPath(); g.ellipse(0, 0, 9, 4.2, 0, 0, TAU); g.fill(); g.fillStyle = '#c0392b'; g.fillRect(6, -2.5, 3, 5); g.fillStyle = '#555'; g.fillRect(-11, -4, 3, 8); g.restore(); void a;
    }
  }
}
