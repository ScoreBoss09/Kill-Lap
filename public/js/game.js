// Kill Lap race simulation + world rendering.
import { clamp, angDiff, lerp, TAU, mulberry32, rgba, hashStr } from './util.js';
import { compileTrack, nearest, pointAt, VERGE } from './tracks.js';
import { carStats, CAR_BY_ID, WEAPONS, DIFFICULTIES, AI_NAMES } from './cars.js';
import { Ground, gridPos, makeMinimap } from './ground.js';
import { View, drawProp, drawProp2Glow, drawItem, drawCar, drawProjectile, drawMine, Particles } from './sprites.js';
import Audio from './audio.js';
import Input from './input.js';

const FIXED = 1 / 60;
const PICKUP_R = 30, RESPAWN_ITEM = 14;

export class Game {
  /**
   * opts: { track, laps, roster:[{id,name,carId,upg,color,ai,local,human,remote}], mode:'race'|'tt'|'attract', diff, net, isHost, localId, weapons, ghost, quality, settings }
   */
  constructor(opts) {
    this.opts = opts; this.mode = opts.mode || 'race'; this.net = opts.net || null; this.isHost = opts.isHost !== false;
    this.T = compileTrack(opts.track); this.T.laps = opts.laps || this.T.laps;
    this.laps = this.T.laps; this.weapons = opts.weapons !== false && this.mode !== 'tt';
    this.diff = DIFFICULTIES[clamp(opts.diff ?? 1, 0, 3)]; this.diffIdx = clamp(opts.diff ?? 1, 0, 3);
    this.settings = opts.settings || {}; this.quality = this.settings.quality ?? 2;
    this.ground = new Ground(this.T, this.quality); this.mini = makeMinimap(this.T);
    this.view = new View(); this.view.quality = this.quality; this.fx = new Particles(); this.fx.max = [180, 380, 650][this.quality] ?? 650;
    this.time = 0; this.raceTime = 0; this.acc = 0; this.state = 'countdown'; this.cd = this.mode === 'attract' ? 0.5 : 3.6; this.lastCdBeep = 4;
    this.cars = []; this.byId = {}; this.proj = []; this.mines = []; this.feed = []; this.msgs = [];
    this.rng = mulberry32(opts.seed || 1); this.nextId = 1; this.netT = 0; this.over = false; this.results = null; this.overT = 0;
    this.items = this.T.items.map(it => ({ ...it, active: true, respawn: 0 }));
    this.shake = 0; this.rumbleT = 0; this.skidAcc = 0;
    this.camTarget = null; this.cam = { x: this.T.start.x, y: this.T.start.y };
    this.night = this.T.th.night; this.hudFlash = 0; this.ghost = opts.ghost || null; this.ghostRec = []; this.ghostRecT = 0; this.bestGhost = null;
    this.sortedProps = this.T.props.slice().sort((a, b) => a.y - b.y);
    this.stats = { kills: 0, deaths: 0, cash: 0, topSpeed: 0, dmgDealt: 0, pickups: 0, cleanLaps: 0 };
    (opts.roster || []).forEach((r, i) => this.addCar(r, i));
    this.human = this.cars.find(c => c.human) || null; this.camTarget = this.human || this.cars[0];
    if (this.camTarget) { this.cam.x = this.camTarget.x; this.cam.y = this.camTarget.y; }
    this.view.x = this.cam.x; this.view.y = this.cam.y;
    this.msg('GET READY', 1.2);
  }

  /* ---------------------------------------------------------------- cars */
  addCar(spec, slot) {
    const st = carStats(spec.carId, spec.upg), T = this.T, pos = gridPos(T, slot);
    const near = nearest(T, pos.x, pos.y, -1);
    const c = {
      id: spec.id, name: spec.name, human: !!spec.human, ai: !!spec.ai, remote: !!spec.remote, local: !spec.remote, stats: st, slot,
      color: spec.color || st.color, len: st.len, wid: st.wid, shape: st.shape, mass: st.mass,
      x: pos.x, y: pos.y, a: pos.a, vx: 0, vy: 0, w: 0, steerVis: 0, hp: st.hp, maxHp: st.hp,
      ammo: { mg: st.mgAmmo, rocket: st.rocketAmmo, mine: st.mineAmmo }, nitro: st.nitroCharges - 1, nitroT: 0, nitroOn: false, cool: { mg: 0, rocket: 0, mine: 0 },
      accF: near.f - T.N, prevF: near.f, pos: near.f, p: (near.f - T.N) / T.N, lap: 0, lapStart: 0, lapTimes: [], best: null, finished: false, finishTime: null, finishPlace: 0,
      kills: 0, deaths: 0, cash: 0, lat: 0, dead: false, respawnT: 0, invuln: 0, braking: false, boostT: 0, oilT: 0, wrongWay: 0, surface: 'road', lapDamage: 0, maxSpeed: 0,
      input: { steer: 0, throttle: 0, brake: 0, hb: false, fire: false, rocket: false, mine: false, nitro: false },
      aiLane: (Math.random() - 0.5) * 0.8, aiLaneT: Math.random() * 3, aiSkill: 0.94 + Math.random() * 0.08, stuckT: 0, revT: 0, mgHeld: false,
      tx: pos.x, ty: pos.y, ta: pos.a, slip: 0, lastHitBy: null, voice: null, resetHold: 0, lastScrape: 0, ping: 0, netAge: 0,
    };
    c.state = 'grid';
    this.cars.push(c); this.byId[c.id] = c; return c;
  }
  get playerCar() { return this.human; }

  msg(text, dur = 2, color = '#fff') { this.msgs.push({ text, t: dur, max: dur, color }); if (this.msgs.length > 3) this.msgs.shift(); }
  feedAdd(text, color = '#fff') { this.feed.push({ text, t: 6, color }); if (this.feed.length > 6) this.feed.shift(); }
  snd(name, x, y, vol = 1, rate) { Audio.sfxAt(name, x, y, this.cam, { vol, rate }); }

  /* ---------------------------------------------------------------- main frame */
  frame(dt, drive) {
    dt = Math.min(dt, 0.1); this.acc += dt; let n = 0;
    while (this.acc >= FIXED && n < 6) { this.step(FIXED, drive); this.acc -= FIXED; n++; }
    if (n === 6) this.acc = 0;
  }

  step(dt, drive) {
    this.time += dt;
    if (this.state === 'countdown') {
      this.cd -= dt; const sec = Math.ceil(this.cd);
      if (sec !== this.lastCdBeep && this.cd > 0) { this.lastCdBeep = sec; if (this.mode !== 'attract') { Audio.sfx('beep', { vol: 0.9 }); } }
      if (this.cd <= 0) { this.state = 'racing'; this.raceTime = 0; for (const c of this.cars) c.lapStart = 0; if (this.mode !== 'attract') { Audio.sfx('go'); this.msg('GO!', 1, '#7dff3a'); } }
    } else if (this.state === 'racing') this.raceTime += dt;
    const racing = this.state === 'racing';

    for (const c of this.cars) {
      if (c.remote) { this.stepRemote(c, dt); continue; }
      c.invuln = Math.max(0, c.invuln - dt);
      if (c.dead) { c.respawnT -= dt; if (c.respawnT <= 0) this.respawn(c); continue; }
      // inputs
      if (c.human && !c.finished && !c.auto) { Object.assign(c.input, drive || {}); }
      else this.aiThink(c, dt, racing);
      if (!racing && this.state === 'countdown') { c.input.hb = c.human ? false : false; }
      this.drive(c, dt, racing);
      if (racing || this.state === 'over') this.track(c, dt);
      if (this.weapons && racing && !c.finished) this.weaponInput(c, dt);
      c.cool.mg -= dt; c.cool.rocket -= dt; c.cool.mine -= dt;
      this.pickups(c, dt);
      // manual respawn
      if (c.human && drive && drive.reset && racing) { c.resetHold += dt; if (c.resetHold > 0.8) { c.resetHold = 0; this.respawn(c, true); } } else c.resetHold = 0;
    }
    this.collideAll(dt);
    if (this.weapons) { this.stepProjectiles(dt); this.stepMines(dt); }
    for (const it of this.items) if (!it.active && (it.respawn -= dt) <= 0) it.active = true;
    this.fx.update(dt);
    this.feed.forEach(f => f.t -= dt); this.feed = this.feed.filter(f => f.t > 0);
    this.msgs.forEach(m => m.t -= dt); this.msgs = this.msgs.filter(m => m.t > 0);
    this.shake = Math.max(0, this.shake - dt * 22);
    this.ranking(); this.rubber(); this.recordGhost(dt);
    if (this.net && this.state !== 'countdown') { this.netT -= dt; if (this.netT <= 0) { this.netT = 0.05; this.sendState(); } }
    this.checkOver(dt);
  }

  /* ---------------------------------------------------------------- physics */
  drive(c, dt, racing) {
    const st = c.stats, T = this.T, inp = c.input;
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    let vf = c.vx * cs + c.vy * sn;
    const vf0 = vf;
    const nr = nearest(T, c.x, c.y, c.pos);
    c.pos = nr.f; c.lat = nr.lat; const alat = Math.abs(nr.lat), off = alat > nr.hw;
    c.surface = off ? 'grass' : 'road';
    let thr = racing || this.state === 'countdown' ? inp.throttle : 0, brk = racing ? inp.brake : (this.state === 'countdown' ? 0 : inp.brake);
    if (this.state === 'countdown') { thr = 0; brk = 0; }
    if (c.finished && !c.human) { /* AI continues */ }
    // nitro
    if (c.nitroT > 0) { c.nitroT -= dt; c.nitroOn = true; if (c.nitroT <= 0) c.nitroOn = false; } else c.nitroOn = false;
    if (inp.nitro && c.nitroT <= 0 && c.nitro > 0 && racing && !c.nitroLatch) { c.nitro--; c.nitroT = 2.0; c.nitroOn = true; this.snd('nitro', c.x, c.y, 0.9); c.nitroLatch = true; if (c.human) this.hudFlash = 0.3; }
    if (!inp.nitro) c.nitroLatch = false;
    c.boostT = Math.max(0, c.boostT - dt); c.oilT = Math.max(0, c.oilT - dt);
    const nb = c.nitroOn ? 1 + 0.32 * st.nitroPower : 1, bb = c.boostT > 0 ? 1.22 : 1;
    const topV = st.top * nb * bb * (off ? 0.62 : 1) * (c.hp < c.maxHp * 0.25 ? 0.93 : 1);
    let force = 0;
    if (thr > 0) force += st.accel * thr * (c.nitroOn ? 1.9 * st.nitroPower : 1) * (c.boostT > 0 ? 2.2 : 1) * clamp(1.05 - vf / topV, -0.3, 1.1);
    if (brk > 0) { if (vf > 15) force -= st.brake * brk; else force -= st.accel * 0.5 * brk * clamp(1 + vf / 160, 0, 1); }
    c.braking = brk > 0 && vf > 10;
    if (thr === 0 && brk === 0) vf -= vf * 0.35 * dt;
    vf -= vf * (off ? 1.6 : 0.12) * dt;
    if (vf > topV) vf -= (vf - topV) * 1.5 * dt;
    vf += force * dt;
    // steering
    const spd = Math.abs(vf), sgn = vf >= -3 ? 1 : -1;
    const maxW = st.steer * (3.35 - 1.7 * clamp(spd / st.top, 0, 1.2)) * (inp.hb ? 1.3 : 1);
    const lowSpeed = clamp(spd / 70, 0, 1);
    const wT = -inp.steer * -1 * maxW * lowSpeed * sgn;
    c.w += (wT - c.w) * Math.min(1, 10 * dt);
    if (c.oilT > 0) c.w += Math.sin(this.time * 17 + c.slot) * 5 * dt * 10;
    c.a += c.w * dt; c.steerVis += (inp.steer - c.steerVis) * Math.min(1, 12 * dt);
    // The heading has rotated but the car's momentum has not: project the world-space velocity into the new
    // frame, apply the longitudinal forces, then let tyre grip drag the sideways component back (this is what lets
    // the car slide when it is turned hard, overloaded by nitro, on grass, on oil, or on the handbrake).
    const cs2 = Math.cos(c.a), sn2 = Math.sin(c.a);
    let vf2 = c.vx * cs2 + c.vy * sn2 + (vf - vf0), vl = -c.vx * sn2 + c.vy * cs2;
    const G = 1000 * st.grip * (inp.hb ? 0.3 : 1) * (off ? 0.7 : 1) * (c.oilT > 0 ? 0.15 : 1) * (c.nitroOn ? 0.92 : 1);
    const dv = clamp(-vl * 9, -G, G) * dt;
    vl += Math.abs(dv) > Math.abs(vl) ? -vl : dv;
    if (inp.hb) vf2 -= vf2 * 0.3 * dt;
    c.slip = Math.abs(vl); vf = vf2;
    c.vx = cs2 * vf2 - sn2 * vl; c.vy = sn2 * vf2 + cs2 * vl;
    c.x += c.vx * dt; c.y += c.vy * dt;
    const sp = Math.hypot(c.vx, c.vy); c.maxSpeed = Math.max(c.maxSpeed, sp);
    if (c.human) this.stats.topSpeed = Math.max(this.stats.topSpeed, sp);
    // skid marks & surface effects
    if ((c.slip > 95 || (inp.hb && sp > 120) || (brk > 0.5 && vf > 200)) && !off) {
      const back = c.len * 0.36, wy = c.wid * 0.42;
      for (const s of [-1, 1]) { const x = c.x - cs2 * back - sn2 * wy * s, y = c.y - sn2 * back + cs2 * wy * s; if (c.lsx) this.ground.line(c['lx' + s], c['ly' + s], x, y, 4.5, '#050505', clamp(c.slip / 260, 0.25, 0.6)); c['lx' + s] = x; c['ly' + s] = y; }
      c.lsx = true; if (Math.random() < 0.35 && this.quality > 0) this.fx.smoke(c.x - cs2 * back, c.y - sn2 * back, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 6, 0.6, '210,210,210', 0.28);
    } else c.lsx = false;
    if (off && sp > 90 && Math.random() < 0.5 && this.quality > 0) this.fx.smoke(c.x - cs2 * 14, c.y - sn2 * 14, -c.vx * 0.1 + (Math.random() - 0.5) * 30, -c.vy * 0.1 + (Math.random() - 0.5) * 30, 7, 0.7, this.T.theme === 'snow' ? '240,245,250' : '160,140,100', 0.42);
    if (c.nitroOn && this.quality > 0) { this.fx.fire(c.x - cs2 * c.len * 0.5, c.y - sn2 * c.len * 0.5, -cs2 * 140 + (Math.random() - 0.5) * 40, -sn2 * 140 + (Math.random() - 0.5) * 40, 7, 0.25); }
    // damage smoke / fire
    const hpf = c.hp / c.maxHp;
    if (hpf < 0.4 && Math.random() < (0.5 - hpf)) this.fx.smoke(c.x + cs2 * 8, c.y + sn2 * 8, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20 - 10, 8, 1, hpf < 0.2 ? '25,25,25' : '110,110,110', 0.55);
    if (hpf < 0.2 && Math.random() < 0.35) this.fx.fire(c.x + cs2 * 8, c.y + sn2 * 8, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30 - 20, 7, 0.3);
    // wall
    const lim = nr.hw + VERGE - 2;
    if (alat > lim) {
      const side = nr.lat > 0 ? 1 : -1, nx = nr.nx * side, ny = nr.ny * side; // outward normal
      const push = alat - lim; c.x -= nx * push; c.y -= ny * push;
      const vn = c.vx * nx + c.vy * ny;
      if (vn > 0) {
        c.vx -= (1.35) * vn * nx; c.vy -= 1.35 * vn * ny;
        c.vx *= 0.93; c.vy *= 0.93;
        const tvx = -ny, tvy = nx; const tang = c.vx * tvx + c.vy * tvy; // dampen rotation to align along wall
        c.w += clamp(angDiff(c.a, Math.atan2(c.vy, c.vx)), -1, 1) * 2.0;
        if (vn > 60) this.hitWall(c, vn, c.x + nx * c.wid * 0.5, c.y + ny * c.wid * 0.5, nx, ny);
      }
    }
  }
  hitWall(c, vn, x, y, nx, ny) {
    const now = this.time; const dmg = Math.max(0, (vn - 150)) * 0.045 / Math.sqrt(c.mass);
    if (dmg > 0) this.damage(c, dmg, null, 'wall');
    const n = clamp(vn / 40, 2, 12) | 0; for (let i = 0; i < n; i++) this.fx.spark(x, y, -nx * 80 + (Math.random() - 0.5) * 220, -ny * 80 + (Math.random() - 0.5) * 220, 0.3);
    if (now - c.lastScrape > 0.2) { c.lastScrape = now; this.snd(vn > 220 ? 'crash' : 'scrape', x, y, clamp(vn / 300, 0.3, 1)); if (c.human) { Input.rumble(clamp(vn / 400, 0.2, 1), 0.5, 140); this.shake = Math.max(this.shake, clamp(vn / 60, 1, 7)); } }
  }

  /* progress / laps */
  track(c, dt) {
    const N = this.T.N; let d = c.pos - c.prevF; if (d < -N / 2) d += N; else if (d > N / 2) d -= N;
    c.prevF = c.pos; c.accF += d; c.p = c.accF / N;
    // wrong way
    const tv = c.vx * this.T.tx[c.pos | 0] + c.vy * this.T.ty[c.pos | 0];
    c.wrongWay = tv < -60 ? c.wrongWay + dt : Math.max(0, c.wrongWay - dt * 2);
    if (c.finished) return;
    if (c.p >= c.lap + 1 && this.state === 'racing') {
      c.lap++; const t = this.raceTime - c.lapStart; c.lapTimes.push(t); c.lapStart = this.raceTime;
      const isBest = c.best == null || t < c.best; if (isBest) c.best = t;
      if (c.human) {
        if (c.lapDamage === 0) this.stats.cleanLaps++; c.lapDamage = 0;
        Audio.sfx(isBest && c.lap > 1 ? 'bestlap' : 'lap'); this.msg(c.lap >= this.laps ? 'FINAL LAP DONE' : `LAP ${c.lap} / ${this.laps}`, 1.6, '#ffd23a');
        if (this.opts.onLap) this.opts.onLap(c, t, isBest);
        if (this.mode === 'tt' && isBest && this.ghostRec.length > 5) { this.bestGhost = { lap: t, pts: this.ghostRec }; }
        this.ghostRec = []; this.ghostRecT = 0;
        if (c.lap === this.laps - 1 && this.laps > 1) this.msg('FINAL LAP', 1.6, '#ff5a3a');
      }
      if (c.lap >= this.laps) this.finish(c);
    }
  }
  finish(c) {
    c.finished = true; c.finishTime = this.raceTime; c.finishPlace = this.cars.filter(o => o.finished).length;
    if (c.human) {
      Audio.sfx(c.finishPlace <= 3 ? 'win' : 'lose'); this.msg(c.finishPlace === 1 ? 'YOU WIN!' : 'FINISHED  P' + c.finishPlace, 3, c.finishPlace === 1 ? '#ffd23a' : '#fff');
      if (this.net) this.net.send({ t: 'fin', time: c.finishTime, best: c.best || 0, kills: c.kills, car: c.stats.id });
      if (this.opts.onFinish) this.opts.onFinish(c);
      this.finishedAt = this.time;
    } else this.feedAdd(`${c.name} finished P${c.finishPlace}`, '#bbb');
    if (c.local && !c.human) c.input = { steer: 0, throttle: 0, brake: 0, hb: false, fire: false, rocket: false, mine: false, nitro: false };
  }
  ranking() {
    const arr = this.cars.slice().sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.p - a.p);
    arr.forEach((c, i) => { c.place = i + 1; }); this.order = arr;
  }
  rubber() { // gentle catch-up for single-player AI
    if (this.net || this.mode === 'attract' || !this.human) return;
    const hp = this.human.p; for (const c of this.cars) if (c.ai) { const d = c.p - hp; c.rubber = d > 0.12 ? 0.94 : d < -0.15 ? 1.05 : 1; }
  }
  recordGhost(dt) {
    if (this.mode !== 'tt' || !this.human || this.state !== 'racing') return;
    this.ghostRecT -= dt; if (this.ghostRecT <= 0) { this.ghostRecT = 1 / 15; this.ghostRec.push([Math.round(this.human.x), Math.round(this.human.y), +this.human.a.toFixed(2)]); }
  }
  checkOver(dt) {
    if (this.over) return;
    const h = this.human;
    if (this.mode === 'attract') {
      if (this.cars.some(c => c.finished)) { this.over = true; this.overAttract = true; }
      return;
    }
    if (h && h.finished) {
      this.overT += dt;
      const others = this.cars.filter(c => !c.finished);
      if (!this.net && (others.length === 0 || this.overT > 3.2) && this.mode !== 'tt') this.endRace();
      else if (!this.net && this.mode === 'tt' && this.overT > 1.2) this.endRace();
    } else if (!h && !this.net) { /* no human (spectate) */ }
  }
  endRace(serverResults) {
    if (this.over) return; this.over = true;
    const total = this.laps;
    const rows = this.cars.map(c => {
      let time = c.finishTime; let est = false;
      if (time == null && !serverResults) { const prog = Math.max(0.02, c.p + 0.02); time = this.raceTime + (total - c.p) * (this.raceTime / prog) * 0.98; est = true; }
      return { id: c.id, name: c.name, car: c.stats.id, color: c.color, human: c.human, local: c.local, finished: c.finished, time, est, best: c.best, kills: c.kills, deaths: c.deaths, p: c.p, cash: c.cash };
    });
    if (serverResults) for (const r of rows) { const s = serverResults.find(x => x.id === r.id); if (s) { r.time = s.time; r.finished = !s.dnf; r.est = false; r.kills = s.kills ?? r.kills; if (s.best) r.best = s.best; } else if (!r.finished) r.time = null; }
    rows.sort((a, b) => (a.time == null) - (b.time == null) || (a.time ?? 0) - (b.time ?? 0) || b.p - a.p);
    rows.forEach((r, i) => { r.place = i + 1; });
    this.results = rows;
    if (this.opts.onEnd) this.opts.onEnd(rows, this);
  }

  /* ---------------------------------------------------------------- damage / death */
  damage(c, amt, by, kind) {
    if (c.dead || c.invuln > 0 || c.remote) return;
    c.hp -= amt; c.lapDamage += amt; c.lastHitBy = by || c.lastHitBy;
    if (c.human) { this.stats.dmgTaken = (this.stats.dmgTaken || 0) + amt; if (amt > 4) { this.shake = Math.max(this.shake, clamp(amt / 4, 1, 8)); Input.rumble(clamp(amt / 25, 0.15, 1), 0.4, 160); this.hudFlash = Math.max(this.hudFlash, 0.25); } }
    if (c.hp <= 0) this.wreck(c, by);
  }
  wreck(c, by) {
    c.hp = 0; c.dead = true; c.respawnT = 3.0; c.deaths++;
    this.fx.explosion(c.x, c.y, 1.6); this.snd('explosion', c.x, c.y, 1);
    this.ground.blot(c.x, c.y, 38, '#000000', 0.28);
    for (let i = 0; i < 6; i++) { const a = Math.random() * TAU; this.fx.debris(c.x, c.y, Math.cos(a) * 200, Math.sin(a) * 200, c.color); }
    c.vx = c.vy = 0;
    const killer = by && this.byId[by] && by !== c.id ? this.byId[by] : null;
    if (c.human) { this.stats.deaths++; Input.rumble(1, 1, 400); this.shake = 14; }
    if (killer) { killer.kills++; killer.cash += 500; if (killer.human) { this.stats.kills++; this.stats.cash += 500; this.msg('WRECKED ' + c.name.toUpperCase(), 1.6, '#ff5a3a'); Audio.sfx('cash'); } }
    this.feedAdd(killer ? `${killer.name}  ✖  ${c.name}` : `${c.name} crashed out`, killer && killer.human ? '#ffd23a' : '#ff8a6a');
    if (this.net) this.net.send({ t: 'ev', e: { k: 'die', c: c.id, by: killer ? killer.id : null } });
  }
  respawn(c, manual = false) {
    const T = this.T; const f = c.pos - (manual ? 1 : 3); const p = pointAt(T, f, 0);
    c.x = p.x; c.y = p.y; c.a = p.a; c.vx = c.vy = c.w = 0; c.pos = ((f % T.N) + T.N) % T.N; c.prevF = c.pos;
    if (!manual) { c.hp = c.maxHp * 0.6; c.dead = false; } c.invuln = 2; c.oilT = 0;
    if (!manual) { c.ammo.mg = Math.max(c.ammo.mg, 30); c.ammo.rocket = Math.max(c.ammo.rocket, 1); }
    this.snd('respawn', c.x, c.y, 0.7);
    this.fx.ring(c.x, c.y, 50, 0.5, '120,200,255');
  }

  /* ---------------------------------------------------------------- collisions between cars */
  collideAll(dt) {
    const L = this.cars;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (a.dead || b.dead) continue;
      if (a.remote && b.remote) continue;
      const dx = b.x - a.x, dy = b.y - a.y, r = (a.len + b.len) * 0.5 + 4; if (dx * dx + dy * dy > r * r) continue;
      const ac = Math.cos(a.a), as = Math.sin(a.a), bc = Math.cos(b.a), bs = Math.sin(b.a);
      let best = null;
      for (const ka of [-0.28, 0.28, 0]) for (const kb of [-0.28, 0.28, 0]) {
        const ax = a.x + ac * a.len * ka, ay = a.y + as * a.len * ka, bx = b.x + bc * b.len * kb, by = b.y + bs * b.len * kb;
        const rr = a.wid * 0.54 + b.wid * 0.54 + 2, ddx = bx - ax, ddy = by - ay, d2 = ddx * ddx + ddy * ddy;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01, pen = rr - d; if (!best || pen > best.pen) best = { pen, nx: ddx / d, ny: ddy / d, x: (ax + bx) / 2, y: (ay + by) / 2 }; }
      }
      if (!best) continue;
      const { pen, nx, ny } = best;
      const ma = a.mass, mb = b.mass, tot = ma + mb;
      const aMove = a.local, bMove = b.local;
      const sa = aMove ? (bMove ? mb / tot : 1) : 0, sb = bMove ? (aMove ? ma / tot : 1) : 0;
      a.x -= nx * pen * sa; a.y -= ny * pen * sa; b.x += nx * pen * sb; b.y += ny * pen * sb;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const e = 0.38, jn = -(1 + e) * vn / (1 / ma + 1 / mb);
        if (aMove) { a.vx -= (jn / ma) * nx; a.vy -= (jn / ma) * ny; a.w += (Math.random() - 0.5) * 1.5; }
        if (bMove) { b.vx += (jn / mb) * nx; b.vy += (jn / mb) * ny; b.w += (Math.random() - 0.5) * 1.5; }
        const speed = -vn;
        if (speed > 50) {
          const hit = Math.max(0, speed - 70) * 0.04;
          if (aMove) this.damage(a, hit * (mb / ma) ** 0.6, b.id, 'ram');
          if (bMove) this.damage(b, hit * (ma / mb) ** 0.6, a.id, 'ram');
          if (this.time - (a.lastBump || 0) > 0.15) {
            a.lastBump = this.time; for (let k = 0; k < 6; k++) this.fx.spark(best.x, best.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.3);
            this.snd('crash', best.x, best.y, clamp(speed / 250, 0.3, 1));
            if (a.human || b.human) { Input.rumble(clamp(speed / 300, 0.2, 1), 0.6, 150); this.shake = Math.max(this.shake, clamp(speed / 50, 1, 6)); }
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- pickups & hazards */
  pickups(c, dt) {
    if (c.finished && !c.human) return;
    for (const it of this.items) {
      const dx = it.x - c.x, dy = it.y - c.y;
      if (it.t === 'boost') { if (dx * dx + dy * dy < 34 * 34 && c.boostT < 0.3) { c.boostT = 0.9; this.snd('boost', it.x, it.y, 0.8); if (c.human) this.hudFlash = 0.2; } continue; }
      if (it.t === 'oil') { if (dx * dx + dy * dy < 34 * 34 && c.oilT < 0.2 && c.nitroT <= 0) { c.oilT = 1.3; c.w += (Math.random() - 0.5) * 4; this.snd('oil', it.x, it.y, 0.6); } continue; }
      if (!it.active || dx * dx + dy * dy > PICKUP_R * PICKUP_R) continue;
      if (it.t !== 'repair' || c.hp < c.maxHp) { if (it.t === 'ammo' && !this.weapons) continue; }
      else if (it.t === 'repair') continue;
      this.takeItem(c, it, true);
    }
  }
  takeItem(c, it, broadcast) {
    it.active = false; it.respawn = RESPAWN_ITEM;
    const st = c.stats;
    if (it.t === 'repair') c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.4);
    else if (it.t === 'ammo') { c.ammo.mg = Math.min(st.mgAmmo, c.ammo.mg + 50); c.ammo.rocket = Math.min(st.rocketAmmo, c.ammo.rocket + 2); c.ammo.mine = Math.min(st.mineAmmo, c.ammo.mine + 1); }
    else if (it.t === 'cash') { const v = 100 + Math.floor(Math.random() * 4) * 50; c.cash += v; if (c.human) { this.stats.cash += v; this.feedAdd('+$' + v, '#7dff3a'); } }
    else if (it.t === 'nitro') c.nitro = Math.min(st.nitroCharges + 2, c.nitro + 1);
    if (c.human) { this.stats.pickups++; this.snd(it.t === 'cash' ? 'cash' : 'pickup', it.x, it.y, 0.9); }
    else this.snd('pickup', it.x, it.y, 0.4);
    this.fx.ring(it.x, it.y, 36, 0.4, '255,255,255');
    if (broadcast && this.net) this.net.send({ t: 'ev', e: { k: 'pk', i: it.id, c: c.id } });
  }

  /* ---------------------------------------------------------------- weapons */
  weaponInput(c, dt) {
    const inp = c.input; if (c.dead) return;
    if (inp.fire && c.cool.mg <= 0) { if (c.ammo.mg > 0) this.fire(c, 'mg'); else if (c.human && c.cool.mg < -0.2) { Audio.sfx('empty'); c.cool.mg = 0.3; } }
    if (inp.rocket && c.cool.rocket <= 0) { if (c.ammo.rocket > 0) this.fire(c, 'rocket'); else if (c.human) { Audio.sfx('empty'); c.cool.rocket = 0.5; } }
    if (inp.mine && c.cool.mine <= 0) { if (c.ammo.mine > 0) this.fire(c, 'mine'); else if (c.human) { Audio.sfx('empty'); c.cool.mine = 0.5; } }
  }
  fire(c, type) {
    const W = WEAPONS[type], cs = Math.cos(c.a), sn = Math.sin(c.a);
    if (type === 'mg') {
      c.cool.mg = W.cool; c.ammo.mg--; c.mgSide = -(c.mgSide || 1);
      const a = c.a + (Math.random() - 0.5) * 0.05, ox = c.x + cs * c.len * 0.5 - sn * 5 * c.mgSide, oy = c.y + sn * c.len * 0.5 + cs * 5 * c.mgSide;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'mg', x: ox, y: oy, vx: Math.cos(a) * W.speed + c.vx * 0.5, vy: Math.sin(a) * W.speed + c.vy * 0.5, life: W.life, dmg: W.dmg * c.stats.mgDmg, idx: c.pos };
      this.proj.push(p); this.snd('gun', ox, oy, 0.55, 0.9 + Math.random() * 0.2); this.fx.spark(ox, oy, cs * 200, sn * 200, 0.12, '255,230,120');
      if (this.net) this.net.send({ t: 'ev', e: { k: 'fire', w: 'mg', p: this.packProj(p) } });
    } else if (type === 'rocket') {
      c.cool.rocket = W.cool; c.ammo.rocket--;
      let target = null, bd = 1e9;
      for (const o of this.cars) { if (o === c || o.dead || o.finished) continue; const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy); if (d > W.range || d < 40) continue; const ang = Math.abs(angDiff(c.a, Math.atan2(dy, dx))); if (ang < 0.55 && d + ang * 300 < bd) { bd = d + ang * 300; target = o; } }
      const ox = c.x + cs * c.len * 0.55, oy = c.y + sn * c.len * 0.55, sp0 = 380;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'rocket', x: ox, y: oy, vx: cs * sp0 + c.vx * 0.6, vy: sn * sp0 + c.vy * 0.6, life: W.life, dmg: W.dmg * c.stats.rocketDmg, tgt: target ? target.id : null, age: 0, idx: c.pos };
      this.proj.push(p); this.snd('rocket', ox, oy, 0.9); if (c.human) Input.rumble(0.3, 0.6, 120);
      if (this.net) this.net.send({ t: 'ev', e: { k: 'fire', w: 'rocket', p: this.packProj(p) } });
    } else if (type === 'mine') {
      c.cool.mine = W.cool; c.ammo.mine--;
      const m = { id: c.id + ':' + this.nextId++, owner: c.id, x: c.x - cs * (c.len * 0.65), y: c.y - sn * (c.len * 0.65), arm: W.arm, life: W.life, dmg: W.dmg * (1 + (c.stats.rocketDmg - 1) * 0.5) };
      this.mines.push(m); this.snd('mine', m.x, m.y, 0.8);
      if (this.net) this.net.send({ t: 'ev', e: { k: 'mine', m: { id: m.id, o: m.owner, x: Math.round(m.x), y: Math.round(m.y), d: m.dmg } } });
    }
  }
  packProj(p) { return { id: p.id, o: p.owner, t: p.type, x: +p.x.toFixed(1), y: +p.y.toFixed(1), vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1), l: p.life, d: +p.dmg.toFixed(2), g: p.tgt || null }; }
  stepProjectiles(dt) {
    const T = this.T;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i]; let dead = false, hit = null;
      p.life -= dt;
      if (p.type === 'rocket') {
        p.age = (p.age || 0) + dt;
        const tgt = p.tgt && this.byId[p.tgt];
        let spd = Math.hypot(p.vx, p.vy), want = Math.min(WEAPONS.rocket.speed, 380 + p.age * 650);
        let ang = Math.atan2(p.vy, p.vx);
        if (tgt && !tgt.dead && p.age > 0.12) { const da = angDiff(ang, Math.atan2(tgt.y - p.y, tgt.x - p.x)); ang += clamp(da, -WEAPONS.rocket.turn * dt, WEAPONS.rocket.turn * dt); }
        p.vx = Math.cos(ang) * want; p.vy = Math.sin(ang) * want;
        if (Math.random() < 0.9) { this.fx.smoke(p.x, p.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 5, 0.6, '200,200,200', 0.4); this.fx.fire(p.x - Math.cos(ang) * 6, p.y - Math.sin(ang) * 6, -Math.cos(ang) * 60, -Math.sin(ang) * 60, 6, 0.2); }
      }
      // sub-step to avoid tunnelling
      const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 14) || 1;
      for (let s = 0; s < steps && !dead; s++) {
        p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
        for (const c of this.cars) {
          if (c.id === p.owner || c.dead || c.finished && false) continue;
          const dx = p.x - c.x, dy = p.y - c.y, r = c.len * 0.55;
          if (dx * dx + dy * dy < r * r) { // refine with oriented box
            const cs = Math.cos(c.a), sn = Math.sin(c.a), lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
            if (Math.abs(lx) < c.len * 0.52 && Math.abs(ly) < c.wid * 0.6) { hit = c; dead = true; break; }
          }
        }
        if (!dead) { const nr = nearest(T, p.x, p.y, p.idx, 8); p.idx = nr.f; if (Math.abs(nr.lat) > nr.hw + VERGE) { dead = true; p.wall = true; } }
      }
      if (p.life <= 0) dead = true;
      if (dead) {
        this.proj.splice(i, 1);
        if (p.type === 'mg') {
          if (hit) { this.fx.spark(p.x, p.y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.25); if (hit.local) this.damage(hit, p.dmg, p.owner, 'mg'); const ow = this.byId[p.owner]; if (ow && ow.human) { this.stats.dmgDealt += p.dmg; if (Math.random() < 0.5) this.snd('hit', p.x, p.y, 0.4); } }
          else if (p.wall) for (let k = 0; k < 3; k++) this.fx.spark(p.x, p.y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2);
        } else if (p.type === 'rocket') {
          this.explode(p.x, p.y, p.owner, p.dmg, hit);
        }
      }
    }
  }
  explode(x, y, owner, directDmg, hit) {
    const R = WEAPONS.rocket.splash; this.fx.explosion(x, y, 0.8); this.snd('smallboom', x, y, 1); this.ground.blot(x, y, 26, '#000000', 0.2);
    this.shake = Math.max(this.shake, clamp(9 - Math.hypot(x - this.cam.x, y - this.cam.y) / 100, 0, 8));
    for (const c of this.cars) {
      if (c.dead || !c.local) continue; const d = Math.hypot(c.x - x, c.y - y);
      if (c === hit) { this.damage(c, directDmg, owner, 'rocket'); const k = 220; c.vx += ((c.x - x) / (d || 1)) * k * 0.3; c.vy += ((c.y - y) / (d || 1)) * k * 0.3; }
      else if (d < R + c.len * 0.4) { this.damage(c, WEAPONS.rocket.splashDmg * (owner === c.id ? 0.5 : 1) * (1 - d / (R + c.len * 0.4)) * 1.1, owner, 'rocket'); c.vx += ((c.x - x) / (d || 1)) * 200; c.vy += ((c.y - y) / (d || 1)) * 200; c.w += (Math.random() - 0.5) * 6; }
    }
    const ow = this.byId[owner]; if (ow && ow.human && hit) { this.stats.dmgDealt += directDmg; }
  }
  stepMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.life -= dt; m.arm -= dt; let trig = null;
      if (m.arm <= 0) for (const c of this.cars) {
        if (c.dead || c.remote && false) continue; if (c.id === m.owner && m.arm > -1.5) continue;
        const dx = c.x - m.x, dy = c.y - m.y, r = WEAPONS.mine.r + c.wid * 0.3; if (dx * dx + dy * dy < r * r) { trig = c; break; }
      }
      if (trig || m.life <= 0) {
        this.mines.splice(i, 1);
        if (trig) {
          this.fx.explosion(m.x, m.y, 0.9); this.snd('explosion', m.x, m.y, 0.9); this.ground.blot(m.x, m.y, 30, '#000000', 0.25);
          for (const c of this.cars) { if (!c.local || c.dead) continue; const d = Math.hypot(c.x - m.x, c.y - m.y); if (d < 70) { this.damage(c, m.dmg * (1 - d / 100), m.owner, 'mine'); c.vx += ((c.x - m.x) / (d || 1)) * 240; c.vy += ((c.y - m.y) / (d || 1)) * 240; c.w += (Math.random() - 0.5) * 8; } }
          this.shake = Math.max(this.shake, 7);
          if (this.net && trig.local) this.net.send({ t: 'ev', e: { k: 'mineHit', id: m.id } });
        }
      }
    }
  }

  /* ---------------------------------------------------------------- AI */
  aiThink(c, dt, racing) {
    const T = this.T, N = T.N, inp = c.input, st = c.stats; const sp = Math.hypot(c.vx, c.vy);
    const idle = () => { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.hb = false; inp.fire = inp.rocket = inp.mine = inp.nitro = false; };
    if (!racing) { idle(); return; }
    if (c.finished) { // roll gently round the track after crossing the line so we don't block others
      idle(); inp.throttle = sp < 170 ? 0.6 : 0; inp.brake = sp > 260 ? 0.5 : 0; inp.steer = clamp(angDiff(c.a, pointAt(T, c.pos + 8, 0).a) * 2, -1, 1); return;
    }
    c.aiMineT = (c.aiMineT || 0) - dt;
    const diff = this.diff, skill = (this.mode === 'attract' ? 0.95 : diff.speed) * c.aiSkill * (c.rubber || 1);
    c.aiLaneT -= dt; if (c.aiLaneT <= 0) { c.aiLaneT = 1.5 + Math.random() * 3; c.aiLane = clamp(c.aiLane + (Math.random() - 0.5) * 0.7, -0.62, 0.62); }
    const f = c.pos, la = 5 + sp / 26, fi = (f + la) | 0;
    // pickup attraction
    let lane = c.aiLane;
    for (const it of this.items) { if (!it.active || it.t === 'boost' || it.t === 'oil') continue; if (it.t === 'repair' && c.hp > c.maxHp * 0.8) continue; if (it.t === 'ammo' && c.ammo.mg > c.stats.mgAmmo * 0.7) continue; const dx = it.x - c.x, dy = it.y - c.y; if (dx * dx + dy * dy > 420 * 420) continue; const ln = nearest(T, it.x, it.y, f, 40); const ahead = ln.f - f; if (ahead > 2 && ahead < 28 && Math.abs(ln.lat) < T.hw[ln.i] * 0.85) { lane = ln.lat / T.hw[ln.i]; break; } }
    // car avoidance
    let avoid = 0;
    for (const o of this.cars) { if (o === c || o.dead) continue; const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy; if (d2 > 170 * 170) continue; const cs = Math.cos(c.a), sn = Math.sin(c.a), lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs; if (lx > 0 && lx < 150 && Math.abs(ly) < 38) avoid += ly > 0 ? -1 : 1; }
    const tgtHW = T.hw[((fi % N) + N) % N];
    const tgt = pointAt(T, f + la, clamp(lane + avoid * 0.35, -0.8, 0.8) * tgtHW * 0.85);
    const want = Math.atan2(tgt.y - c.y, tgt.x - c.x), err = angDiff(c.a, want);
    inp.steer = clamp(err * 2.6, -1, 1);
    // wall recovery
    const edge = T.hw[(f | 0) % N] * 0.82; if (Math.abs(c.lat) > edge && Math.abs(c.lat) > 1) { const toC = c.lat > 0 ? -1 : 1; const cH = pointAt(T, f + 6, 0); const e2 = angDiff(c.a, cH.a); inp.steer = clamp(inp.steer * 0.5 + e2 * 1.5, -1, 1); }
    // speed
    let kmax = 0; const look = 8 + (sp / 12) | 0; for (let k = 0; k < look; k++) { const kk = Math.abs(T.curv[(((f | 0) + k) % N)]); if (kk > kmax) kmax = kk; }
    const mul = st.steer * 0.85; let vmax = 2.75 * mul / (kmax + 1.4 * mul / st.top); vmax = Math.min(vmax, st.top * skill * (c.nitroOn ? 1.3 : 1));
    if (Math.abs(c.lat) > T.hw[(f | 0) % N]) vmax *= 0.75;
    inp.throttle = sp < vmax ? 1 : 0; inp.brake = sp > vmax * 1.1 ? clamp((sp - vmax) / 90, 0.2, 1) : 0;
    inp.hb = Math.abs(err) > 1.0 && sp > 160;
    // stuck / reverse
    if (c.revT > 0) { c.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer || 0.7; inp.hb = false; }
    else { if (sp < 28 && racing) c.stuckT += dt; else c.stuckT = Math.max(0, c.stuckT - dt * 2); if (c.stuckT > 1.2) { c.stuckT = 0; c.revT = 0.9; } }
    // weapons & nitro
    inp.fire = inp.rocket = inp.mine = false;
    if (this.weapons && this.raceTime > 4) {
      const cs = Math.cos(c.a), sn = Math.sin(c.a); const aim = diff.aim;
      for (const o of this.cars) {
        if (o === c || o.dead || o.finished) continue; const dx = o.x - c.x, dy = o.y - c.y, lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
        if (lx > 30 && lx < 520 && Math.abs(ly) < 34 + (1 - aim) * 20 && c.ammo.mg > 0 && Math.random() < 0.3 + 0.5 * diff.aggression) inp.fire = true;
        if (lx > 120 && lx < 700 && Math.abs(ly) < 90 && c.ammo.rocket > 0 && Math.random() < 0.02 * diff.aggression * (aim + 0.3)) inp.rocket = true;
        if (lx < -50 && lx > -240 && Math.abs(ly) < 40 && c.ammo.mine > 0 && sp > 200 && (c.aiMineT || 0) <= 0 && Math.random() < 0.02 * diff.aggression) { inp.mine = true; c.aiMineT = 5 + Math.random() * 4; }
      }
    }
    let straight = true; for (let k = 0; k < 40; k += 4) if (Math.abs(T.curv[(((f | 0) + k) % N)]) > 0.0009) { straight = false; break; }
    inp.nitro = straight && c.nitro > 0 && c.nitroT <= 0 && sp > 250 && Math.random() < 0.01 * (0.4 + diff.aggression);
  }

  /* ---------------------------------------------------------------- networking */
  sendState() {
    const out = [];
    for (const c of this.cars) if (c.local) out.push({ i: c.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), a: +c.a.toFixed(3), vx: +c.vx.toFixed(1), vy: +c.vy.toFixed(1), hp: Math.round(c.hp), mh: Math.round(c.maxHp), p: +c.p.toFixed(4), l: c.lap, f: c.finished ? 1 : 0, ft: c.finishTime, k: c.kills, d: c.dead ? 1 : 0, n: c.nitroOn ? 1 : 0, br: c.braking ? 1 : 0, sv: +c.steerVis.toFixed(2), sl: Math.round(c.slip), b: c.best, iv: c.invuln > 0 ? 1 : 0 });
    const human = this.human; this.net.send({ t: 'st', prog: human ? human.p : 0, kills: human ? human.kills : 0, cars: out });
  }
  onNet(m) {
    if (m.t === 'st') {
      for (const s of m.cars || []) {
        const c = this.byId[s.i]; if (!c || !c.remote) continue;
        const first = c.netAge === 0; c.netAge = this.time;
        c.tx = s.x; c.ty = s.y; c.ta = s.a; c.vx = s.vx; c.vy = s.vy; c.hp = s.hp; c.maxHp = s.mh || c.maxHp; c.p = s.p; c.lap = s.l; c.finished = !!s.f; c.finishTime = s.ft; c.kills = s.k; c.nitroOn = !!s.n; c.braking = !!s.br; c.steerVis = s.sv; c.slip = s.sl; c.best = s.b; c.invuln = s.iv ? 1 : 0;
        if (s.d && !c.dead) { c.dead = true; this.fx.explosion(c.x, c.y, 1.4); this.snd('explosion', c.x, c.y, 1); } else if (!s.d && c.dead) { c.dead = false; c.x = s.x; c.y = s.y; }
        if (first) { c.x = s.x; c.y = s.y; c.a = s.a; }
        c.ping = 0;
      }
    } else if (m.t === 'ev') this.onNetEvent(m.e, m.f);
  }
  onNetEvent(e, from) {
    if (e.k === 'fire') {
      const q = e.p, p = { id: q.id, owner: q.o, type: q.t, x: q.x, y: q.y, vx: q.vx, vy: q.vy, life: q.l, dmg: q.d, tgt: q.g, age: 0, idx: -1 };
      const nr = nearest(this.T, p.x, p.y, -1); p.idx = nr.f; this.proj.push(p);
      if (q.t === 'rocket') this.snd('rocket', p.x, p.y, 0.8); else this.snd('gun', p.x, p.y, 0.4, 0.9 + Math.random() * 0.2);
    } else if (e.k === 'mine') { this.mines.push({ id: e.m.id, owner: e.m.o, x: e.m.x, y: e.m.y, arm: WEAPONS.mine.arm, life: WEAPONS.mine.life, dmg: e.m.d }); this.snd('mine', e.m.x, e.m.y, 0.6); }
    else if (e.k === 'mineHit') { const i = this.mines.findIndex(m => m.id === e.id); if (i >= 0) { const m = this.mines[i]; this.mines.splice(i, 1); this.fx.explosion(m.x, m.y, 0.9); this.snd('explosion', m.x, m.y, 0.9); } }
    else if (e.k === 'pk') { const it = this.items.find(q => q.id === e.i); if (it && it.active) { it.active = false; it.respawn = RESPAWN_ITEM; this.fx.ring(it.x, it.y, 36, 0.4, '255,255,255'); } }
    else if (e.k === 'die') {
      const v = this.byId[e.c], k = e.by && this.byId[e.by];
      if (v && v.remote) { v.dead = true; v.deaths++; }
      if (k) { if (k.remote) k.kills++; }
      if (k && k.human && v) { k.kills = k.kills; }
      this.feedAdd(k ? `${k.name}  ✖  ${v ? v.name : '?'}` : `${v ? v.name : '?'} crashed out`, k && k.human ? '#ffd23a' : '#ff8a6a');
    }
  }
  stepRemote(c, dt) {
    c.tx += c.vx * dt; c.ty += c.vy * dt; const k = Math.min(1, 14 * dt);
    c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; c.a += angDiff(c.a, c.ta) * k;
    if (Math.hypot(c.tx - c.x, c.ty - c.y) > 300) { c.x = c.tx; c.y = c.ty; }
    c.invuln = c.invuln; c.ping += dt;
    const nr = nearest(this.T, c.x, c.y, c.pos < 0 ? -1 : c.pos, 40); c.pos = nr.f; c.lat = nr.lat;
    const sp = Math.hypot(c.vx, c.vy); if (c.nitroOn && this.quality > 0) this.fx.fire(c.x - Math.cos(c.a) * c.len * 0.5, c.y - Math.sin(c.a) * c.len * 0.5, 0, 0, 7, 0.25);
    const hpf = c.hp / (c.maxHp || 1); if (hpf < 0.4 && Math.random() < 0.3 && !c.dead) this.fx.smoke(c.x, c.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20 - 10, 8, 1, '70,70,70', 0.5);
    if (c.slip > 95 && Math.random() < 0.4 && !c.dead) this.fx.smoke(c.x, c.y, 0, 0, 6, 0.5, '210,210,210', 0.25);
  }

  /* ---------------------------------------------------------------- audio each frame */
  updateAudio(dt) {
    if (!Audio.ready || this.mode === 'attract') return;
    let skid = 0;
    for (const c of this.cars) {
      if (c.dead) { if (c.voice) c.voice.update(0, 0, 0, 0); continue; }
      if (!c.voice) c.voice = Audio.engine();
      if (!c.voice) continue;
      const dx = c.x - this.cam.x, dy = c.y - this.cam.y, d = Math.hypot(dx, dy), vol = clamp(1 - d / 1300, 0, 1) * (c.human ? 1.2 : 0.8);
      const sp = Math.hypot(c.vx, c.vy) / c.stats.top;
      c.voice.update(clamp(sp, 0, 1.1), c.input.throttle > 0.1 || (c.remote && sp > 0.2), vol * vol, clamp(dx / 700, -0.9, 0.9), c.nitroOn);
      if (c.slip > 95 && c.surface === 'road') skid = Math.max(skid, (c.slip - 80) / 220 * vol);
    }
    Audio.setSkid(skid);
  }
  destroy() { for (const c of this.cars) if (c.voice) { c.voice.stop(); c.voice = null; } Audio.setSkid(0); }

  /* ---------------------------------------------------------------- render */
  render(g, W, H, dt) {
    const v = this.view, T = this.T, th = T.th;
    v.W = W; v.H = H; v.t = this.time;
    // camera
    const tg = this.camTarget && !this.camTarget.dead ? this.camTarget : (this.camTarget || this.cars[0]); if (!tg) return;
    if (this.mode === 'attract') { const lead = this.order && this.order[0]; if (lead) this.camTarget = lead; }
    const sp = Math.hypot(tg.vx, tg.vy), look = 0.42;
    const tx = tg.x + tg.vx * look, ty = tg.y + tg.vy * look; const k = Math.min(1, 5 * dt);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    if (Math.hypot(tx - this.cam.x, ty - this.cam.y) > 900) { this.cam.x = tx; this.cam.y = ty; }
    const baseZoom = H / (this.settings.zoomH || 780); const zt = baseZoom * (1 - 0.13 * clamp(sp / 500, 0, 1));
    v.zoom += (zt - v.zoom) * Math.min(1, 2 * dt) || zt; if (!v.zoom) v.zoom = zt;
    v.x = this.cam.x; v.y = this.cam.y;
    const sh = this.shake; v.shakeX = (Math.random() - 0.5) * sh * v.zoom * 2; v.shakeY = (Math.random() - 0.5) * sh * v.zoom * 2;
    const vw = W / v.zoom, vh = H / v.zoom;
    // bake terrain around the view (budgeted)
    this.ground.ensure(v.x - vw / 2 - 256, v.y - vh / 2 - 256, v.x + vw / 2 + 256, v.y + vh / 2 + 256, 2);
    this.ground.draw(g, v.x - 0 + v.shakeX / v.zoom, v.y + v.shakeY / v.zoom, v.zoom, W, H);
    // night
    if (this.night) {
      g.fillStyle = 'rgba(4,6,22,0.55)'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of this.T.props) if ((p.type === 'lamp' || p.type === 'spire' || p.type === 'lava') && v.visible(p.x, p.y, 200)) drawProp2Glow(g, v, p, this.time);
      g.globalCompositeOperation = 'source-over';
    }
    // flat items & mines
    for (const it of this.items) if ((it.t === 'boost' || it.t === 'oil') && v.visible(it.x, it.y, 60)) drawItem(g, v, it, this.time);
    for (const m of this.mines) if (v.visible(m.x, m.y, 30)) drawMine(g, v, m, this.time);
    // ghost
    if (this.ghost && this.state === 'racing') this.drawGhost(g);
    // sorted objects
    const list = [];
    const P = this.sortedProps;
    for (let i = 0; i < P.length; i++) { const p = P[i]; if (v.visible(p.x, p.y, p.w ? 220 : 60)) list.push({ y: p.y + (p.type === 'dune' || p.type === 'lava' ? -200 : 0), k: 0, o: p }); }
    for (const it of this.items) if (it.active && it.t !== 'boost' && it.t !== 'oil' && v.visible(it.x, it.y, 40)) list.push({ y: it.y, k: 1, o: it });
    for (const c of this.cars) if (!c.dead && v.visible(c.x, c.y, 60)) list.push({ y: c.y + 4, k: 2, o: c });
    list.sort((a, b) => a.y - b.y);
    for (const e of list) {
      if (e.k === 0) drawProp(g, v, e.o, th, this.time);
      else if (e.k === 1) drawItem(g, v, e.o, this.time);
      else {
        const c = e.o; const showTag = c !== this.human && this.mode !== 'attract';
        drawCar(g, v, c, this.time, { night: this.night, tag: showTag, tagColor: c.remote ? '#9fe3ff' : '#ffd0a0' });
      }
    }
    this.drawGantry(g);
    for (const p of this.proj) if (v.visible(p.x, p.y, 40)) drawProjectile(g, v, p, this.time);
    this.fx.draw(g, v);
    if (this.night) { // headlight bloom over cars
      g.globalCompositeOperation = 'lighter';
      for (const c of this.cars) if (!c.dead && c.nitroOn) { const X = v.sx(c.x), Y = v.sy(c.y); const gr = g.createRadialGradient(X, Y, 0, X, Y, 90 * v.zoom); gr.addColorStop(0, 'rgba(80,170,255,0.3)'); gr.addColorStop(1, 'rgba(80,170,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 90 * v.zoom, 0, TAU); g.fill(); }
      g.globalCompositeOperation = 'source-over';
    }
    this.cam.zoom = v.zoom;
  }
  drawGhost(g) {
    const gh = this.ghost; if (!gh || !gh.pts.length) return; const v = this.view;
    const tl = this.raceTime - (this.human ? this.human.lapStart : 0), i = Math.floor(tl * 15); if (i < 0 || i >= gh.pts.length - 1) return; const f = tl * 15 - i; const a = gh.pts[i], b = gh.pts[i + 1];
    const car = { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), a: a[2] + angDiff(a[2], b[2]) * f, len: 40, wid: 21, color: '#9be2ff', shape: 'sport', hp: 1, maxHp: 1, steerVis: 0, name: 'Ghost', invuln: 0 };
    g.globalAlpha = 0.5; drawCar(g, v, car, this.time, {}); g.globalAlpha = 1;
  }
  drawGantry(g) {
    const T = this.T, v = this.view, s = T.start; if (!v.visible(s.x, s.y, 300)) return;
    const hw = T.hw[0] + 20, nx = -Math.sin(s.a), ny = Math.cos(s.a), H1 = 120;
    const ax = s.x + nx * hw, ay = s.y + ny * hw, bx = s.x - nx * hw, by = s.y - ny * hw;
    g.lineCap = 'round';
    for (const [x, y] of [[ax, ay], [bx, by]]) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(v.sx(x) + 12 * v.zoom, v.sy(y) + 9 * v.zoom, 10 * v.zoom, 7 * v.zoom, 0, 0, TAU); g.fill(); g.strokeStyle = '#2a2d36'; g.lineWidth = 9 * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, H1), v.py(x, y, H1)); g.stroke(); }
    const A = [v.px(ax, ay, H1), v.py(ax, ay, H1)], B = [v.px(bx, by, H1), v.py(bx, by, H1)], A2 = [v.px(ax, ay, H1 - 36), v.py(ax, ay, H1 - 36)], B2 = [v.px(bx, by, H1 - 36), v.py(bx, by, H1 - 36)];
    g.fillStyle = '#1a1c22'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(B2[0], B2[1]); g.lineTo(A2[0], A2[1]); g.closePath(); g.fill();
    g.strokeStyle = '#ff5a1f'; g.lineWidth = 3 * v.zoom; g.stroke();
    const mx = (A[0] + B[0] + A2[0] + B2[0]) / 4, my = (A[1] + B[1] + A2[1] + B2[1]) / 4, ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    g.save(); g.translate(mx, my); g.rotate(ang > Math.PI / 2 ? ang - Math.PI : ang < -Math.PI / 2 ? ang + Math.PI : ang); g.font = `900 ${Math.max(14, 30 * v.zoom * (1 + H1 * 0.0011))}px Impact, "Arial Black", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd23a'; g.shadowColor = '#ff5a1f'; g.shadowBlur = 10; g.fillText('KILL LAP', 0, 0); g.shadowBlur = 0; g.restore();
  }
}
