// Kill Lap race simulation + world rendering.
import { clamp, angDiff, lerp, TAU, mulberry32, rgba, hashStr } from './util.js';
import { compileTrack, nearest, pointAt, VERGE, ELEV_T } from './tracks.js';
import { Hazards } from './hazards.js';
import { Peds } from './peds.js';
import { Traffic } from './traffic.js';
import { makeVis, tunnelRuns, TUN_H } from './structures.js';
import { DYNAMIC } from './ground.js';
import { carStats, CAR_BY_ID, WEAPONS, DIFFICULTIES, AI_NAMES } from './cars.js';
import { Ground, gridPos, makeMinimap } from './ground.js';
import { View, drawProp, drawProp2Glow, drawItem, drawCar, drawProjectile, drawMine, Particles, glow } from './sprites.js';
import Audio from './audio.js';
import Input from './input.js';

const FIXED = 1 / 60;
export const AQUAPLANE = 330; // px/s (about 119 km/h): above this, water has no effect
const PICKUP_R = 30, RESPAWN_ITEM = 14, FIN_OFF = 22; // FIN_OFF: lap counts once the car centre clears the far edge of the checkered band

const CLOUDS = [];
/** soft irregular cloud shadow (two variants, built once) */
function cloudSprite(k) {
  if (CLOUDS[k]) return CLOUDS[k]; const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), r = mulberry32(77 + k * 13);
  for (let i = 0; i < 9; i++) { const cx = 70 + r() * 116, cy = 70 + r() * 116, rad = 40 + r() * 60, gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad); gr.addColorStop(0, 'rgba(10,20,30,0.55)'); gr.addColorStop(1, 'rgba(10,20,30,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); }
  return (CLOUDS[k] = c);
}

/** per-sample lookups used to pick each car's draw layer (built once per track) */
function buildLayerInfo(T) {
  const N = T.N, elevNear = new Uint8Array(N), tnNear = new Uint8Array(N), tnDepth = new Uint8Array(N);
  for (let i = 0; i < N; i++) { if (T.elev[i]) for (let k = -3; k <= 3; k++) elevNear[(i + k + N) % N] = 1; if (T.tn[i]) for (let k = -9; k <= 9; k++) tnNear[(i + k + N) % N] = 1; }
  if (T.hasTun) for (let i = 0; i < N; i++) if (T.tn[i]) { let d = 0; while (d < 60 && T.tn[(i + d) % N] && T.tn[(i - d + N) % N]) d++; tnDepth[i] = d; }
  const cell = 128, grid = new Map(); for (let i = 0; i < N; i++) if (T.z[i] >= 30) { const k = Math.floor(T.x[i] / cell) + ',' + Math.floor(T.y[i] / cell); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const underDeck = (x, y) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grid.get((cx + a) + ',' + (cy + b)); if (l) for (const i of l) if (Math.hypot(T.x[i] - x, T.y[i] - y) < T.hw[i] + T.wl[i] + 8) return true; } return false; };
  const runId = new Int16Array(N).fill(-1); { let r = -1; for (let i = 0; i < N; i++) if (T.tn[i] && !T.tn[(i - 1 + N) % N]) { r++; for (let k = i; T.tn[k % N] && k < i + N; k++) runId[k % N] = r; } }
  const runOf = f => { for (let d = 0; d < 24; d++) { if (runId[(f + d) % N] >= 0) return runId[(f + d) % N]; if (runId[(f - d + N) % N] >= 0) return runId[(f - d + N) % N]; } return -1; };
  // footprint of each tunnel hill (at ground and at the top of the hill) - the see-through window when you drive in
  const polys = []; const runPoly = r => { if (polys[r]) return polys[r]; const idx = tunnelRuns(T)[r] || []; const L = [], R = [];
    for (let k = 0; k < idx.length; k += 2) { const i = idx[k], w = T.hw[i] + 66; L.push([T.x[i] + T.ty[i] * w, T.y[i] - T.tx[i] * w]); R.push([T.x[i] - T.ty[i] * w, T.y[i] + T.tx[i] * w]); }
    const ring = h => [...L.map(p => [p[0], p[1], h]), ...R.reverse().map(p => [p[0], p[1], h])]; R.reverse(); return (polys[r] = [ring(0), ring(TUN_H)]); };
  return { elevNear, tnNear, tnDepth, underDeck, runOf, runPoly };
}

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
    this.view = new View(); this.view.quality = this.quality; this.fx = new Particles(); this.fx.max = [160, 320, 480][this.quality] ?? 480;
    this.time = 0; this.raceTime = 0; this.acc = 0; this.state = 'countdown'; this.cd = this.mode === 'attract' ? 0.5 : 3.6; this.lastCdBeep = 4;
    this.cars = []; this.byId = {}; this.proj = []; this.mines = []; this.feed = []; this.msgs = [];
    this.rng = mulberry32(opts.seed || 1); this.nextId = 1; this.netT = 0; this.over = false; this.results = null; this.overT = 0;
    this.items = this.T.items.map(it => ({ ...it, active: true, respawn: 0 }));
    this.shake = 0; this.rumbleT = 0; this.skidAcc = 0;
    this.camTarget = null; this.cam = { x: this.T.start.x, y: this.T.start.y };
    this.night = this.T.th.night; this.hudFlash = 0; this.ghost = opts.ghost || null; this.ghostRec = []; this.ghostRecT = 0; this.bestGhost = null;
    this.sortedProps = this.T.props.slice().sort((a, b) => a.y - b.y);
    this.dynProps = this.T.props.filter(p => DYNAMIC.has(p.type)); this.glowProps = this.T.props.filter(p => p.type === 'lamp' || p.type === 'spire' || p.type === 'lava');
    this.hazards = (this.T.hazards.length || this.T.bomber) ? new Hazards(this) : null; this.warn = null;
    this.peds = new Peds(this);
    this.traffic = new Traffic(this); if (!this.traffic.active) this.traffic = null;
    this.stats = { kills: 0, deaths: 0, cash: 0, topSpeed: 0, dmgDealt: 0, pickups: 0, cleanLaps: 0 };
    (opts.roster || []).forEach((r, i) => this.addCar(r, i));
    this.human = this.cars.find(c => c.human) || null; this.camTarget = this.human || this.cars[0];
    if (this.camTarget) { this.cam.x = this.camTarget.x; this.cam.y = this.camTarget.y; }
    this.view.x = this.cam.x; this.view.y = this.cam.y;
    this.msg('GET READY', 1.2); if (this.weapons && this.mode !== 'attract') this.feedAdd('Weapons unlock after lap 1', '#ffb347');
  }

  /* ---------------------------------------------------------------- cars */
  addCar(spec, slot) {
    const st = carStats(spec.carId, spec.upg), T = this.T, pos = gridPos(T, slot);
    const near = nearest(T, pos.x, pos.y, -1);
    const c = {
      id: spec.id, name: spec.name, human: !!spec.human, ai: !!spec.ai, remote: !!spec.remote, local: !spec.remote, stats: st, slot,
      color: spec.color || st.color, len: st.len, wid: st.wid, shape: st.shape, mass: st.mass,
      x: pos.x, y: pos.y, a: pos.a, vx: 0, vy: 0, w: 0, steerVis: 0, hp: st.hp, maxHp: st.hp,
      ammo: { mg: st.mgAmmo, rocket: st.rocketAmmo, mine: st.mineAmmo, homing: st.homingAmmo, cluster: st.clusterAmmo }, nitro: st.nitroCharges - 1, nitroT: 0, nitroOn: false, cool: { mg: 0, rocket: 0, mine: 0, special: 0 },
      special: st.mods.homing ? 'homing' : st.mods.cluster ? 'cluster' : null, guard: st.guardCharges, turA: pos.a, turCool: 0.5, mods: st.mods, zRoad: 0, z: 0, zAir: 0,
      accF: near.f - T.N, prevF: near.f, pos: near.f, p: (near.f - T.N) / T.N, lap: 0, lapStart: 0, lapTimes: [], best: null, finished: false, finishTime: null, finishPlace: 0,
      kills: 0, deaths: 0, cash: 0, lat: 0, dead: false, respawnT: 0, invuln: 0, braking: false, boostT: 0, oilT: 0, wrongWay: 0, surface: 'road', lapDamage: 0, maxSpeed: 0,
      input: { steer: 0, throttle: 0, brake: 0, hb: false, fire: false, rocket: false, mine: false, nitro: false },
      aiLane: (Math.random() - 0.5) * 0.8, aiLaneT: Math.random() * 3, aiSkill: (spec.skill || 1) * (0.97 + Math.random() * 0.05), aggr: spec.aggr || 1, stuckT: 0, revT: 0, mgHeld: false,
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
      if (c.human && !c.finished && !c.auto) { Object.assign(c.input, drive || {}); if (drive && drive.cycleEdge) drive.cycleEdge = false; }
      else this.aiThink(c, dt, racing);
      if (!racing && this.state === 'countdown') { c.input.hb = c.human ? false : false; }
      this.drive(c, dt, racing);
      if (racing || this.state === 'over') this.track(c, dt);
      if (this.weapons && racing && !c.finished) this.weaponInput(c, dt);
      c.cool.mg -= dt; c.cool.rocket -= dt; c.cool.mine -= dt; c.cool.special -= dt; c.guardFlash = Math.max(0, (c.guardFlash || 0) - dt);
      if (this.weapons && racing && !c.finished) this.stepTurret(c, dt);
      this.pickups(c, dt);
      // manual respawn
      if (c.human && drive && drive.reset && racing) { c.resetHold += dt; if (c.resetHold > 0.8) { c.resetHold = 0; this.respawn(c, true); } } else c.resetHold = 0;
    }
    if (this.hazards && racing) this.hazards.update(dt);
    if (this.peds) this.peds.update(dt);
    if (this.traffic) this.traffic.update(dt);
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
    // airborne (jump ramps): simple ballistic height, no tyre grip or engine until we land
    if ((c.zAir || 0) > 0 || (c.vz || 0) > 0) { c.vz = (c.vz || 0) - 560 * dt; c.zAir = (c.zAir || 0) + c.vz * dt; if (c.zAir <= 0) { const imp = -c.vz; c.zAir = 0; c.vz = 0; this.landed(c, imp); } }
    const air = (c.zAir || 0) > 1; c.waterT = Math.max(0, (c.waterT || 0) - dt);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    let vf = c.vx * cs + c.vy * sn;
    const vf0 = vf;
    const nr = nearest(T, c.x, c.y, c.pos);
    c.pos = nr.f; c.lat = nr.lat; c.zRoad = nr.zl; c.z = nr.zl + (c.zAir || 0); const alat = Math.abs(nr.lat), off = alat > nr.hw;
    // road grade slows climbs and speeds descents; a banked road pulls you towards its low (inside) edge and gives extra grip
    { const along = c.vx * T.tx[nr.i] + c.vy * T.ty[nr.i]; vf -= T.grade[nr.i] * (along >= 0 ? 1 : -1) * 620 * dt; const slope = nr.tilt / (2 * nr.hw); if (Math.abs(slope) > 0.01 && !((c.zAir || 0) > 1)) { c.vx += nr.nx * slope * 380 * dt; c.vy += nr.ny * slope * 380 * dt; } c.bankGrip = 1 + Math.min(0.3, Math.abs(nr.tilt) / 200); }
    c.surface = off ? 'grass' : 'road';
    let thr = racing || this.state === 'countdown' ? inp.throttle : 0, brk = racing ? inp.brake : (this.state === 'countdown' ? 0 : inp.brake);
    if (air) { thr = 0; brk = 0; }
    if (this.state === 'countdown') { thr = 0; brk = 0; }
    if (c.finished && !c.human) { /* AI continues */ }
    // nitro
    if (c.nitroT > 0) { c.nitroT -= dt; c.nitroOn = true; if (c.nitroT <= 0) c.nitroOn = false; } else c.nitroOn = false;
    if (inp.nitro && c.nitroT <= 0 && c.nitro > 0 && racing && !c.nitroLatch) { c.nitro--; c.nitroT = 2.0; c.nitroOn = true; this.snd('nitro', c.x, c.y, 0.9); c.nitroLatch = true; if (c.human) this.hudFlash = 0.3; }
    if (!inp.nitro) c.nitroLatch = false;
    c.boostT = Math.max(0, c.boostT - dt); c.oilT = Math.max(0, c.oilT - dt);
    const nb = c.nitroOn ? 1 + 0.32 * st.nitroPower : 1, bb = c.boostT > 0 ? 1.22 : 1;
    const boosting = c.nitroOn || c.boostT > 0;
    const topV = st.top * nb * bb * (off ? (boosting ? 0.9 : 0.62) : 1) * (c.hp < c.maxHp * 0.25 ? 0.93 : 1);
    let force = 0;
    if (thr > 0) force += st.accel * thr * (c.nitroOn ? 1.9 * st.nitroPower : 1) * (c.boostT > 0 ? 2.2 : 1) * clamp(1.05 - vf / topV, -0.3, 1.1);
    if (brk > 0) { if (vf > 15) force -= st.brake * brk; else force -= st.accel * 0.5 * brk * clamp(1 + vf / 160, 0, 1); }
    c.braking = brk > 0 && vf > 10;
    if (thr === 0 && brk === 0) vf -= vf * 0.35 * dt;
    vf -= vf * (off ? (boosting ? 0.5 : 1.6) : 0.12) * dt;
    if (vf > topV) vf -= (vf - topV) * 1.5 * dt;
    vf += force * dt;
    // steering
    const spd = Math.abs(vf), sgn = vf >= -3 ? 1 : -1;
    const maxW = st.steer * (3.35 - 1.7 * clamp(spd / st.top, 0, 1.2)) * (inp.hb ? 1.3 : 1) * (air ? 0.25 : 1);
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
    // aquaplaning: hit water fast enough and the car skims straight across it with no drag or grip loss
    const wet = c.waterT > 0 && !air, aqua = wet && Math.abs(vf2) >= AQUAPLANE;
    if (aqua) { c.aquaT = 0.25; if (c.human && !this.seenAqua) { this.seenAqua = true; this.msg('AQUAPLANING!', 1.2, '#7fe6ff'); } if (this.quality > 0 && Math.random() < 0.3) for (const s of [-1, 1]) this.fx.smoke(c.x - cs2 * c.len * 0.45 - sn2 * s * c.wid * 0.45, c.y - sn2 * c.len * 0.45 + cs2 * s * c.wid * 0.45, -c.vx * 0.25 - sn2 * s * 90, -c.vy * 0.25 + cs2 * s * 90, 6, 0.45, '225,245,255', 0.6); }
    const G = 1000 * st.grip * (inp.hb ? 0.3 : 1) * (off ? 0.7 : 1) * (c.oilT > 0 ? 0.15 : 1) * (c.nitroOn ? 0.92 : 1) * (air ? 0 : 1) * (wet && !aqua ? 0.55 : 1) * (c.bankGrip || 1);
    if (wet && !aqua) vf2 -= vf2 * 1.15 * dt;
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
    const lim = nr.hw + nr.wl - 2;
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
  landed(c, imp) {
    const dust = clamp(imp / 80, 2, 10) | 0; for (let i = 0; i < dust; i++) this.fx.smoke(c.x, c.y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 7, 0.7, '200,190,170', 0.5);
    if (imp > 120) { this.snd('crash', c.x, c.y, clamp(imp / 350, 0.3, 0.9)); for (let i = 0; i < 6; i++) this.fx.spark(c.x, c.y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.3); }
    if (imp > 260) this.damage(c, (imp - 260) * 0.05, null, 'landing');
    if (c.human) { this.shake = Math.max(this.shake, clamp(imp / 60, 1, 6)); Input.rumble(clamp(imp / 400, 0.2, 0.8), 0.3, 120); }
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
    if (c.accF >= (c.lap + 1) * N + FIN_OFF / this.T.step && this.state === 'racing') {
      c.lap++; const t = this.raceTime - c.lapStart; c.lapTimes.push(t); c.lapStart = this.raceTime;
      const isBest = c.best == null || t < c.best; if (isBest) c.best = t;
      if (c.human) {
        if (c.lapDamage === 0) this.stats.cleanLaps++; c.lapDamage = 0;
        Audio.sfx(isBest && c.lap > 1 ? 'bestlap' : 'lap'); this.msg(c.lap >= this.laps ? 'FINAL LAP DONE' : `LAP ${c.lap} / ${this.laps}`, 1.6, '#ffd23a');
        if (c.lap === 1 && this.weapons) { this.feedAdd('WEAPONS ONLINE!', '#ff9a4a'); Audio.sfx('pickup'); }
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
      if (Math.abs((a.z || 0) - (b.z || 0)) > 28) continue; // different road levels
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
          const hit = Math.max(0, speed - 70) * 0.04, sf = Math.min(1, speed / 180);
          // spikes: where on each car the contact happened decides which spikes bite
          const sp = (k, o) => { const dx = best.x - k.x, dy = best.y - k.y, fr = (dx * Math.cos(k.a) + dy * Math.sin(k.a)) / (k.len / 2), m = k.mods || {}; let dealt = 0, taken = 1;
            if (fr > 0.45 && m.fs) { dealt = 3.4 * m.fs * sf; } else if (fr < -0.45 && m.rs) { dealt = 3.2 * m.rs * sf; } else if (Math.abs(fr) <= 0.45 && m.ws) { dealt = 2.8 * m.ws * sf; }
            if (fr > 0.45 && m.fs) taken = 1 - 0.12 * m.fs; if (dealt > 0) for (let q = 0; q < 4; q++) this.fx.spark(best.x, best.y, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.3, '255,240,200'); return { dealt, taken }; };
          const A = sp(a, b), B = sp(b, a);
          if (aMove) this.damage(a, hit * (mb / ma) ** 0.6 * A.taken + B.dealt, b.id, 'ram');
          if (bMove) this.damage(b, hit * (ma / mb) ** 0.6 * B.taken + A.dealt, a.id, 'ram');
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
      const dx = it.x - c.x, dy = it.y - c.y; if (Math.abs((it.z || 0) - (c.z || 0)) > 30) continue;
      if (it.t === 'boost') { if (dx * dx + dy * dy < 34 * 34 && c.boostT < 0.3) { c.boostT = 0.9; this.snd('boost', it.x, it.y, 0.8); if (c.human) this.hudFlash = 0.2; } continue; }
      if (it.t === 'oil') { if (dx * dx + dy * dy < 34 * 34 && c.oilT < 0.2 && c.nitroT <= 0) { c.oilT = 1.3; c.w += (Math.random() - 0.5) * 4; this.snd('oil', it.x, it.y, 0.6); if (c.human && !this.seenOil) { this.seenOil = true; this.msg('OIL - NO GRIP', 1.5, '#ffb347'); } } continue; }
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
    else if (it.t === 'ammo') { c.ammo.mg = Math.min(st.mgAmmo, c.ammo.mg + 50); c.ammo.rocket = Math.min(st.rocketAmmo, c.ammo.rocket + 2); c.ammo.mine = Math.min(st.mineAmmo, c.ammo.mine + 1); if (st.homingAmmo) c.ammo.homing = Math.min(st.homingAmmo, c.ammo.homing + 1); if (st.clusterAmmo) c.ammo.cluster = Math.min(st.clusterAmmo, c.ammo.cluster + 1); if (st.guardCharges) c.guard = Math.min(st.guardCharges, c.guard + 1); }
    else if (it.t === 'cash') { const v = 100 + Math.floor(Math.random() * 4) * 50; c.cash += v; if (c.human) { this.stats.cash += v; this.feedAdd('+$' + v, '#7dff3a'); } }
    else if (it.t === 'nitro') c.nitro = Math.min(st.nitroCharges + 2, c.nitro + 1);
    if (c.human) { this.stats.pickups++; this.snd(it.t === 'cash' ? 'cash' : 'pickup', it.x, it.y, 0.9); }
    else this.snd('pickup', it.x, it.y, 0.4);
    this.fx.ring(it.x, it.y, 36, 0.4, '255,255,255');
    if (broadcast && this.net) this.net.send({ t: 'ev', e: { k: 'pk', i: it.id, c: c.id } });
  }

  /* ---------------------------------------------------------------- weapons */
  weaponInput(c, dt) {
    const inp = c.input; if (c.dead || c.lap < 1) return;
    if (inp.fire && c.cool.mg <= 0) { if (c.ammo.mg > 0) this.fire(c, 'mg'); else if (c.human && c.cool.mg < -0.2) { Audio.sfx('empty'); c.cool.mg = 0.3; } }
    if (inp.rocket && c.cool.rocket <= 0) { if (c.ammo.rocket > 0) this.fire(c, 'rocket'); else if (c.human) { Audio.sfx('empty'); c.cool.rocket = 0.5; } }
    if (inp.mine && c.cool.mine <= 0) { if (c.ammo.mine > 0) this.fire(c, 'mine'); else if (c.human) { Audio.sfx('empty'); c.cool.mine = 0.5; } }
    if (inp.cycleEdge) { inp.cycleEdge = false; this.cycleSpecial(c); }
    if (inp.special && c.special && c.cool.special <= 0) { if (c.ammo[c.special] > 0) this.fire(c, c.special); else if (c.human) { Audio.sfx('empty'); c.cool.special = 0.5; } }
  }
  cycleSpecial(c) {
    const owned = ['homing', 'cluster'].filter(k => c.stats.mods[k] > 0); if (owned.length < 2) return;
    c.special = owned[(owned.indexOf(c.special) + 1) % owned.length]; if (c.human) { Audio.sfx('select', { vol: 0.5 }); this.msg(WEAPONS[c.special].name.toUpperCase(), 0.9, '#9fe3ff'); }
  }
  /** nearest rival in front of a car (for homing lock-on) */
  lockTarget(c, range, cone) {
    let target = null, bd = 1e9;
    for (const o of this.cars) { if (o === c || o.dead || o.finished || Math.abs((o.z || 0) - (c.z || 0)) > 30) continue; const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy); if (d > range || d < 40) continue; const ang = Math.abs(angDiff(c.a, Math.atan2(dy, dx))); if (ang < cone && d + ang * 300 < bd) { bd = d + ang * 300; target = o; } }
    return target;
  }
  fire(c, type) {
    const W = WEAPONS[type], cs = Math.cos(c.a), sn = Math.sin(c.a), z = (c.z || 0) + 9;
    const send = (w, p) => { if (this.net) this.net.send({ t: 'ev', e: { k: 'fire', w, p: this.packProj(p) } }); };
    if (type === 'mg') {
      c.cool.mg = W.cool; c.ammo.mg--; c.mgSide = -(c.mgSide || 1);
      const a = c.a + (Math.random() - 0.5) * 0.05, ox = c.x + cs * c.len * 0.5 - sn * 5 * c.mgSide, oy = c.y + sn * c.len * 0.5 + cs * 5 * c.mgSide;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'mg', x: ox, y: oy, vx: Math.cos(a) * W.speed + c.vx * 0.5, vy: Math.sin(a) * W.speed + c.vy * 0.5, life: W.life, dmg: W.dmg * c.stats.mgDmg, idx: c.pos, z };
      this.proj.push(p); this.snd('gun', ox, oy, 0.55, 0.9 + Math.random() * 0.2); this.fx.spark(ox, oy, cs * 200, sn * 200, 0.12, '255,230,120'); send('mg', p);
    } else if (type === 'rocket') {
      c.cool.rocket = W.cool; c.ammo.rocket--;
      const ox = c.x + cs * c.len * 0.55, oy = c.y + sn * c.len * 0.55, sp0 = 420;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'rocket', x: ox, y: oy, vx: cs * sp0 + c.vx * 0.5, vy: sn * sp0 + c.vy * 0.5, life: W.life, dmg: W.dmg * c.stats.rocketDmg, tgt: null, age: 0, idx: c.pos, z };
      this.proj.push(p); this.snd('rocket', ox, oy, 0.9); if (c.human) Input.rumble(0.3, 0.6, 120); send('rocket', p);
    } else if (type === 'homing') {
      c.cool.special = W.cool; c.ammo.homing--; const target = this.lockTarget(c, W.range, 0.6);
      const side = (c.homSide = -(c.homSide || 1)), ox = c.x + cs * c.len * 0.3 - sn * 9 * side, oy = c.y + sn * c.len * 0.3 + cs * 9 * side;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'homing', x: ox, y: oy, vx: cs * 380 + c.vx * 0.5, vy: sn * 380 + c.vy * 0.5, life: W.life, dmg: W.dmg * c.stats.homingDmg, tgt: target ? target.id : null, age: 0, idx: c.pos, z };
      this.proj.push(p); this.snd('rocket', ox, oy, 0.8, 1.2); send('homing', p);
      if (c.human && !target) this.msg('NO LOCK', 0.6, '#ffb347');
    } else if (type === 'cluster') {
      c.cool.special = W.cool; c.ammo.cluster--;
      const ox = c.x + cs * c.len * 0.4, oy = c.y + sn * c.len * 0.4;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'cluster', x: ox, y: oy, vx: cs * W.speed + c.vx * 0.5, vy: sn * W.speed + c.vy * 0.5, life: W.life, dmg: 0, age: 0, idx: c.pos, z, z0: z };
      this.proj.push(p); this.snd('mine', ox, oy, 0.9); send('cluster', p);
    } else if (type === 'mine') {
      c.cool.mine = W.cool; c.ammo.mine--;
      const m = { id: c.id + ':' + this.nextId++, owner: c.id, z: c.z || 0, x: c.x - cs * (c.len * 0.65), y: c.y - sn * (c.len * 0.65), arm: W.arm, life: W.life, dmg: W.dmg * (1 + (c.stats.rocketDmg - 1) * 0.5) };
      this.mines.push(m); this.snd('mine', m.x, m.y, 0.8);
      if (this.net) this.net.send({ t: 'ev', e: { k: 'mine', m: { id: m.id, o: m.owner, x: Math.round(m.x), y: Math.round(m.y), d: m.dmg, z: Math.round(m.z || 0) } } });
    }
  }
  packProj(p) { return { id: p.id, o: p.owner, t: p.type, x: +p.x.toFixed(1), y: +p.y.toFixed(1), vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1), l: p.life, d: +p.dmg.toFixed(2), g: p.tgt || null, z: Math.round(p.z || 0), u: p.turret ? 1 : 0 }; }
  /** roof turret: tracks and shoots the nearest rival automatically */
  stepTurret(c, dt) {
    const lv = c.stats.mods.turret; if (!lv || c.dead || c.lap < 1) { return; }
    c.turCool -= dt; let target = null, bd = WEAPONS.turret.range;
    for (const o of this.cars) { if (o === c || o.dead || o.finished || Math.abs((o.z || 0) - (c.z || 0)) > 30) continue; const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < bd) { bd = d; target = o; } }
    const want = target ? Math.atan2(target.y - c.y + target.vy * 0.12, target.x - c.x + target.vx * 0.12) : c.a;
    c.turA += clamp(angDiff(c.turA, want), -7 * dt, 7 * dt);
    if (target && c.turCool <= 0 && Math.abs(angDiff(c.turA, want)) < 0.2) {
      c.turCool = c.stats.turretCool; const a = c.turA + (Math.random() - 0.5) * 0.06, ox = c.x + Math.cos(a) * 16, oy = c.y + Math.sin(a) * 16;
      const p = { id: c.id + ':' + this.nextId++, owner: c.id, type: 'mg', turret: true, x: ox, y: oy, vx: Math.cos(a) * 900 + c.vx * 0.5, vy: Math.sin(a) * 900 + c.vy * 0.5, life: 0.5, dmg: WEAPONS.turret.dmg * c.stats.turretDmg, idx: c.pos, z: (c.z || 0) + 22 };
      this.proj.push(p); this.snd('gun', ox, oy, 0.3, 1.25);
      if (this.net) this.net.send({ t: 'ev', e: { k: 'fire', w: 'mg', p: this.packProj(p) } });
    }
  }
  stepProjectiles(dt) {
    const T = this.T;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i]; let dead = false, hit = null, shielded = null;
      p.life -= dt; p.age = (p.age || 0) + dt;
      if (p.type === 'rocket') { // unguided: accelerates straight ahead
        const sp = Math.hypot(p.vx, p.vy) || 1, want = Math.min(WEAPONS.rocket.speed, 420 + p.age * 1200);
        p.vx *= want / sp; p.vy *= want / sp;
        if (Math.random() < 0.9) { const a = Math.atan2(p.vy, p.vx); this.fx.smoke(p.x, p.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 5, 0.6, '200,200,200', 0.4); this.fx.fire(p.x - Math.cos(a) * 6, p.y - Math.sin(a) * 6, -Math.cos(a) * 60, -Math.sin(a) * 60, 6, 0.2); }
      } else if (p.type === 'homing') {
        const W = WEAPONS.homing, tgt = p.tgt && this.byId[p.tgt]; let ang = Math.atan2(p.vy, p.vx); const want = Math.min(W.speed, 380 + p.age * 520);
        if (tgt && !tgt.dead && p.age > 0.15) { const da = angDiff(ang, Math.atan2(tgt.y - p.y, tgt.x - p.x)); ang += clamp(da, -W.turn * dt, W.turn * dt); }
        p.vx = Math.cos(ang) * want; p.vy = Math.sin(ang) * want;
        this.fx.smoke(p.x, p.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 4.5, 0.55, '190,225,255', 0.4); if (Math.random() < 0.7) this.fx.fire(p.x - Math.cos(ang) * 6, p.y - Math.sin(ang) * 6, -Math.cos(ang) * 60, -Math.sin(ang) * 60, 5, 0.18);
      } else if (p.type === 'cluster') {
        p.z = (p.z0 || 9) + Math.sin(Math.min(1, p.age / WEAPONS.cluster.life) * Math.PI) * 26; if (Math.random() < 0.5) this.fx.smoke(p.x, p.y, 0, 0, 4, 0.4, '170,170,150', 0.35);
      } else if (p.type === 'bomblet') { p.vx *= Math.pow(0.05, dt); p.vy *= Math.pow(0.05, dt); }
      // sub-step to avoid tunnelling
      const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 14) || 1;
      for (let s = 0; s < steps && !dead; s++) {
        p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
        if (p.type === 'bomblet') continue;
        for (const c of this.cars) {
          if (c.id === p.owner || c.dead || Math.abs((p.z || 0) - 9 - (c.z || 0)) > 30) continue;
          const dx = p.x - c.x, dy = p.y - c.y, r = c.len * 0.55;
          if (dx * dx + dy * dy < r * r) {
            const cs = Math.cos(c.a), sn = Math.sin(c.a), lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
            if (Math.abs(lx) < c.len * 0.52 && Math.abs(ly) < c.wid * 0.6) { hit = c; dead = true; break; }
          }
        }
        if (!dead && this.traffic && this.traffic.shot(p.x, p.y, (p.z || 9) - 9, p.type === 'rocket' || p.type === 'homing' ? 200 : p.type === 'cluster' || p.type === 'bomblet' ? 120 : 12, this.byId[p.owner])) dead = true;
        if (!dead) { const nr = nearest(T, p.x, p.y, p.idx, 8); p.idx = nr.f; if (Math.abs(nr.lat) > nr.hw + nr.wl && Math.abs(nr.z - ((p.z || 9) - 9)) < 30) { dead = true; p.wall = true; } }
      }
      // rear guard: shoots down incoming missiles that approach from behind
      if (!dead && (p.type === 'rocket' || p.type === 'homing' || p.type === 'cluster')) {
        for (const c of this.cars) {
          if (!c.local || c.dead || c.id === p.owner || !(c.guard > 0) || Math.abs((p.z || 0) - 9 - (c.z || 0)) > 30) continue;
          const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy; if (d2 > 130 * 130) continue;
          if (dx * Math.cos(c.a) + dy * Math.sin(c.a) < -4) { shielded = c; break; }
        }
        if (shielded) { shielded.guard--; shielded.guardFlash = 0.35; this.fx.explosion(p.x, p.y, 0.35); this.fx.ring(p.x, p.y, 40, 0.3, '120,220,255'); this.snd('hit', p.x, p.y, 0.8, 0.7); this.proj.splice(i, 1); if (shielded.human) this.msg('MISSILE INTERCEPTED', 1.2, '#9fe3ff'); if (this.net) this.net.send({ t: 'ev', e: { k: 'shield', id: p.id } }); continue; }
      }
      if (p.life <= 0) dead = true;
      if (dead) {
        this.proj.splice(i, 1);
        if (p.type === 'mg') {
          if (hit) { this.fx.spark(p.x, p.y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.25); if (hit.local) this.damage(hit, p.dmg, p.owner, 'mg'); const ow = this.byId[p.owner]; if (ow && ow.human) { this.stats.dmgDealt += p.dmg; if (Math.random() < 0.5) this.snd('hit', p.x, p.y, 0.4); } }
          else if (p.wall) for (let k = 0; k < 3; k++) this.fx.spark(p.x, p.y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2);
        } else if (p.type === 'rocket' || p.type === 'homing') this.explode(p.x, p.y, p.owner, p.dmg, hit, WEAPONS[p.type], p.z);
        else if (p.type === 'cluster') this.burstCluster(p);
        else if (p.type === 'bomblet') this.explode(p.x, p.y, p.owner, 0, null, WEAPONS.bomblet, p.z, 0.45);
      }
    }
  }
  burstCluster(p) {
    this.fx.ring(p.x, p.y, 36, 0.3, '255,230,150'); this.snd('smallboom', p.x, p.y, 0.7, 1.3);
    const seed = mulberry32(hashStr(p.id)); // deterministic so every client spawns identical bomblets
    for (let k = 0; k < WEAPONS.cluster.bomblets; k++) { const a = seed() * TAU, sp = 90 + seed() * 230; this.proj.push({ id: p.id + 'b' + k, owner: p.owner, type: 'bomblet', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + seed() * 0.6, dmg: 0, z: (p.z0 || 9) , age: 0, idx: p.idx }); }
  }
  explode(x, y, owner, directDmg, hit, W = WEAPONS.rocket, z = 9, size = 0.8) {
    const R = W.splash; this.fx.explosion(x, y, size); this.snd('smallboom', x, y, 1); this.ground.blot(x, y, 26, '#000000', 0.2);
    this.shake = Math.max(this.shake, clamp(9 - Math.hypot(x - this.cam.x, y - this.cam.y) / 100, 0, 8) * (size < 0.6 ? 0.4 : 1));
    for (const c of this.cars) {
      if (c.dead || !c.local || Math.abs((z || 9) - 9 - (c.z || 0)) > 40) continue; const d = Math.hypot(c.x - x, c.y - y);
      if (c === hit && directDmg > 0) { this.damage(c, directDmg, owner, 'rocket'); const k = 220; c.vx += ((c.x - x) / (d || 1)) * k * 0.3; c.vy += ((c.y - y) / (d || 1)) * k * 0.3; }
      else if (d < R + c.len * 0.4) { this.damage(c, W.splashDmg * (owner === c.id ? 0.5 : 1) * (1 - d / (R + c.len * 0.4)) * 1.1, owner, 'rocket'); c.vx += ((c.x - x) / (d || 1)) * 200; c.vy += ((c.y - y) / (d || 1)) * 200; c.w += (Math.random() - 0.5) * 6; }
    }
    const ow = this.byId[owner]; if (ow && ow.human && hit && directDmg > 0) { this.stats.dmgDealt += directDmg; }
  }
  stepMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.life -= dt; m.arm -= dt; let trig = null;
      if (m.arm <= 0) for (const c of this.cars) {
        if (c.dead || Math.abs((m.z || 0) - (c.z || 0)) > 25) continue; if (c.id === m.owner && m.arm > -1.5) continue;
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
    if (this.traffic) avoid += this.traffic.avoid(c);
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
    if (this.hazards && this.hazards.slowFor(c)) vmax = Math.min(vmax, 230);
    inp.throttle = sp < vmax ? 1 : 0; inp.brake = sp > vmax * 1.1 ? clamp((sp - vmax) / 90, 0.2, 1) : 0;
    c.holding = false; if (this.hazards) { const cap = this.hazards.trainCap(c, st.top); if (cap < vmax) { vmax = cap; c.holding = cap < 60; inp.throttle = sp < vmax ? 1 : 0; inp.brake = sp > vmax * 1.1 ? clamp((sp - vmax) / 90, 0.2, 1) : 0; } }
    inp.hb = Math.abs(err) > 1.0 && sp > 160;
    // stuck / reverse
    if (c.revT > 0) { c.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer || 0.7; inp.hb = false; }
    else { if (sp < 28 && racing && !c.holding) c.stuckT += dt; else c.stuckT = Math.max(0, c.stuckT - dt * 2); if (c.stuckT > 1.2) { c.stuckT = 0; c.revT = 0.9; } }
    // weapons & nitro (personality scales how trigger-happy each driver is)
    inp.fire = inp.rocket = inp.mine = inp.special = false;
    if (this.weapons && c.lap >= 1) {
      const cs = Math.cos(c.a), sn = Math.sin(c.a); const aim = diff.aim, ag = (c.aggr || 1);
      for (const o of this.cars) {
        if (o === c || o.dead || o.finished || Math.abs((o.z || 0) - (c.z || 0)) > 30) continue; const dx = o.x - c.x, dy = o.y - c.y, lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
        if (lx > 30 && lx < 520 && Math.abs(ly) < 34 + (1 - aim) * 20 && c.ammo.mg > 0 && Math.random() < (0.3 + 0.5 * diff.aggression) * Math.min(1.3, ag)) inp.fire = true;
        if (lx > 150 && lx < 650 && Math.abs(ly) < 30 && c.ammo.rocket > 0 && Math.random() < 0.03 * diff.aggression * ag * (aim + 0.3)) inp.rocket = true;
        if (c.special === 'homing' && c.ammo.homing > 0 && lx > 100 && lx < 700 && Math.abs(ly) < 160 && Math.random() < 0.02 * diff.aggression * ag) inp.special = true;
        if (c.special === 'cluster' && c.ammo.cluster > 0 && lx > 140 && lx < 380 && Math.abs(ly) < 90 && Math.random() < 0.025 * diff.aggression * ag) inp.special = true;
        if (lx < -50 && lx > -240 && Math.abs(ly) < 40 && c.ammo.mine > 0 && sp > 200 && (c.aiMineT || 0) <= 0 && Math.random() < 0.02 * diff.aggression * ag) { inp.mine = true; c.aiMineT = 5 + Math.random() * 4; }
      }
      if (c.special && !(c.ammo[c.special] > 0)) { const other = c.special === 'homing' ? 'cluster' : 'homing'; if (c.ammo[other] > 0) c.special = other; }
    }
    let straight = true; for (let k = 0; k < 40; k += 4) if (Math.abs(T.curv[(((f | 0) + k) % N)]) > 0.0009) { straight = false; break; }
    inp.nitro = straight && c.nitro > 0 && c.nitroT <= 0 && sp > 250 && Math.random() < 0.01 * (0.4 + diff.aggression);
  }

  /* ---------------------------------------------------------------- networking */
  sendState() {
    const out = [];
    for (const c of this.cars) if (c.local) out.push({ i: c.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), a: +c.a.toFixed(3), vx: +c.vx.toFixed(1), vy: +c.vy.toFixed(1), hp: Math.round(c.hp), mh: Math.round(c.maxHp), p: +c.p.toFixed(4), l: c.lap, f: c.finished ? 1 : 0, ft: c.finishTime, k: c.kills, d: c.dead ? 1 : 0, n: c.nitroOn ? 1 : 0, br: c.braking ? 1 : 0, sv: +c.steerVis.toFixed(2), sl: Math.round(c.slip), b: c.best, iv: c.invuln > 0 ? 1 : 0, z: Math.round(c.z || 0) });
    const human = this.human; this.net.send({ t: 'st', prog: human ? human.p : 0, kills: human ? human.kills : 0, cars: out });
  }
  onNet(m) {
    if (m.t === 'st') {
      for (const s of m.cars || []) {
        const c = this.byId[s.i]; if (!c || !c.remote) continue;
        const first = c.netAge === 0; c.netAge = this.time;
        c.tx = s.x; c.ty = s.y; c.ta = s.a; c.vx = s.vx; c.vy = s.vy; c.hp = s.hp; c.maxHp = s.mh || c.maxHp; c.p = s.p; c.lap = s.l; c.finished = !!s.f; c.finishTime = s.ft; c.kills = s.k; c.nitroOn = !!s.n; c.braking = !!s.br; c.steerVis = s.sv; c.slip = s.sl; c.best = s.b; c.invuln = s.iv ? 1 : 0; c.tz = s.z || 0;
        if (s.d && !c.dead) { c.dead = true; this.fx.explosion(c.x, c.y, 1.4); this.snd('explosion', c.x, c.y, 1); } else if (!s.d && c.dead) { c.dead = false; c.x = s.x; c.y = s.y; }
        if (first) { c.x = s.x; c.y = s.y; c.a = s.a; }
        c.ping = 0;
      }
    } else if (m.t === 'ev') this.onNetEvent(m.e, m.f);
  }
  onNetEvent(e, from) {
    if (e.k === 'fire') {
      const q = e.p, p = { id: q.id, owner: q.o, type: q.t, x: q.x, y: q.y, vx: q.vx, vy: q.vy, life: q.l, dmg: q.d, tgt: q.g, age: 0, idx: -1, z: q.z || 0, turret: !!q.u, z0: q.z || 9 };
      const nr = nearest(this.T, p.x, p.y, -1); p.idx = nr.f; this.proj.push(p);
      const ow = this.byId[q.o]; if (q.u && ow) ow.turA = Math.atan2(q.vy, q.vx);
      if (q.t === 'rocket' || q.t === 'homing') this.snd('rocket', p.x, p.y, 0.8); else if (q.t === 'cluster') this.snd('mine', p.x, p.y, 0.8); else this.snd('gun', p.x, p.y, q.u ? 0.25 : 0.4, 0.9 + Math.random() * 0.2);
    } else if (e.k === 'mine') { this.mines.push({ id: e.m.id, owner: e.m.o, z: e.m.z || 0, x: e.m.x, y: e.m.y, arm: WEAPONS.mine.arm, life: WEAPONS.mine.life, dmg: e.m.d }); this.snd('mine', e.m.x, e.m.y, 0.6); }
    else if (e.k === 'mineHit') { const i = this.mines.findIndex(m => m.id === e.id); if (i >= 0) { const m = this.mines[i]; this.mines.splice(i, 1); this.fx.explosion(m.x, m.y, 0.9); this.snd('explosion', m.x, m.y, 0.9); } }
    else if (e.k === 'shield') { const i = this.proj.findIndex(q => q.id === e.id); if (i >= 0) { const q = this.proj[i]; this.proj.splice(i, 1); this.fx.explosion(q.x, q.y, 0.35); this.fx.ring(q.x, q.y, 40, 0.3, '120,220,255'); } }
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
    const nr = nearest(this.T, c.x, c.y, c.pos < 0 ? -1 : c.pos, 40); c.pos = nr.f; c.lat = nr.lat; c.zRoad = nr.zl; c.zAir = Math.max(0, (c.tz || 0) - nr.zl); c.z = nr.zl + c.zAir;
    const sp = Math.hypot(c.vx, c.vy); if (c.nitroOn && this.quality > 0) this.fx.fire(c.x - Math.cos(c.a) * c.len * 0.5, c.y - Math.sin(c.a) * c.len * 0.5, 0, 0, 7, 0.25);
    const hpf = c.hp / (c.maxHp || 1); if (hpf < 0.4 && Math.random() < 0.3 && !c.dead) this.fx.smoke(c.x, c.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20 - 10, 8, 1, '70,70,70', 0.5);
    if (c.slip > 95 && Math.random() < 0.4 && !c.dead) this.fx.smoke(c.x, c.y, 0, 0, 6, 0.5, '210,210,210', 0.25);
  }

  /* ---------------------------------------------------------------- audio each frame */
  updateAudio(dt) {
    if (!Audio.ready || this.mode === 'attract' || this.silenced) return;
    let skid = 0; const target = this.quiet ? 0 : 1; this.engVol = this.engVol == null ? 1 : this.engVol + (target - this.engVol) * Math.min(1, dt * 3); // engines fade out once the race is over
    // only the nearest few cars get an engine voice, and parameters are refreshed ~20 times a second (not every frame)
    this.audT = (this.audT || 0) + dt; const tick = this.audT >= 0.05; if (tick) this.audT = 0;
    const MAXV = 5, ranked = this.cars.filter(c => !c.dead).map(c => [c, Math.hypot(c.x - this.cam.x, c.y - this.cam.y)]).sort((a, b) => a[1] - b[1]);
    const rank = new Map(ranked.map(([c, d], i) => [c, d < 1300 ? i : 99]));
    for (const c of this.cars) {
      const r = rank.has(c) ? rank.get(c) : 99; // hysteresis: a voice starts in the top 5 and is only dropped past the top 7
      if (r > MAXV + 1 || this.engVol < 0.01) { if (c.voice) { c.voice.stop(); c.voice = null; } continue; }
      if (!c.voice && r < MAXV) c.voice = Audio.engine();
      if (!c.voice || !tick) continue;
      const dx = c.x - this.cam.x, dy = c.y - this.cam.y, d = Math.hypot(dx, dy), vol = clamp(1 - d / 1300, 0, 1) * (c.human ? 1.2 : 0.8) * this.engVol;
      const sp = Math.hypot(c.vx, c.vy) / c.stats.top;
      c.voice.update(clamp(sp, 0, 1.1), c.input.throttle > 0.1 || (c.remote && sp > 0.2), vol * vol, clamp(dx / 700, -0.9, 0.9), c.nitroOn);
      if (c.slip > 95 && c.surface === 'road') skid = Math.max(skid, (c.slip - 80) / 220 * vol);
    }
    if (!tick) return;
    Audio.setSkid(skid * this.engVol);
  }
  destroy() { this.silenced = true; for (const c of this.cars) if (c.voice) { c.voice.stop(); c.voice = null; } Audio.setSkid(0); }

  /* ---------------------------------------------------------------- render */
  render(g, W, H, dt) {
    const v = this.view, T = this.T, th = T.th;
    v.W = W; v.H = H; v.t = this.time;
    const PF = this.prof, mk = PF ? n => { g.getImageData(0, 0, 1, 1); const t = performance.now(); PF[n] = (PF[n] || 0) + t - this._pt; this._pt = t; } : null; if (PF) { g.getImageData(0, 0, 1, 1); this._pt = performance.now(); }
    // camera
    const tg = this.camTarget && !this.camTarget.dead ? this.camTarget : (this.camTarget || this.cars[0]); if (!tg) return;
    if (this.mode === 'attract') { const lead = this.order && this.order[0]; if (lead) this.camTarget = lead; }
    const sp = Math.hypot(tg.vx, tg.vy), look = 0.42;
    const tx = tg.x + tg.vx * look, ty = tg.y + tg.vy * look; const k = Math.min(1, 5 * dt);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    if (Math.hypot(tx - this.cam.x, ty - this.cam.y) > 900) { this.cam.x = tx; this.cam.y = ty; }
    const baseZoom = H / (this.settings.zoomH || 780); const zt = baseZoom * (1 - 0.13 * clamp(sp / 500, 0, 1)) / (1 + (tg.zRoad || 0) * 0.0008);
    v.zoom += (zt - v.zoom) * Math.min(1, 2 * dt) || zt; if (!v.zoom) v.zoom = zt;
    v.x = this.cam.x; v.y = this.cam.y;
    const sh = this.shake; v.shakeX = (Math.random() - 0.5) * sh * v.zoom * 2; v.shakeY = (Math.random() - 0.5) * sh * v.zoom * 2;
    const vw = W / v.zoom, vh = H / v.zoom;
    // bake terrain around the view (budgeted)
    { const lx = tg.vx * 0.9, ly = tg.vy * 0.9; // look ahead in the direction of travel so new terrain is ready before it scrolls in
      this.ground.ensure(v.x - vw / 2 - 64 + Math.min(0, lx), v.y - vh / 2 - 64 + Math.min(0, ly), v.x + vw / 2 + 64 + Math.max(0, lx), v.y + vh / 2 + 64 + Math.max(0, ly), 1);
      this.frameN = (this.frameN || 0) + 1; if (this.frameN % 8 === 0) this.ground.flush(); // queued skid marks
      if (this.state === 'countdown') this.ground.prebake(14); else if (this.frameN % 8 === 4) this.ground.prebake(1); }
    this.ground.draw(g, v.x - v.shakeX / v.zoom, v.y - v.shakeY / v.zoom, v.zoom, W, H);
    if (T.ocean) this.ground.drawSea(g, v, this.time);
    mk && mk('ground');
    // night
    if (this.night) {
      g.fillStyle = 'rgba(4,6,22,0.55)'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of this.glowProps) if (v.visible(p.x, p.y, 200)) drawProp2Glow(g, v, p, this.time);
      g.globalCompositeOperation = 'source-over';
    }
    // ---- layered scene: ground -> barriers -> ground-level objects -> raised decks -> objects on decks -> tunnel roofs
    const vis = this.vis = makeVis(T, v), N = T.N, idx = o => (((o.pos | 0) % N) + N) % N;
    if (!T.layerInfo) T.layerInfo = buildLayerInfo(T);
    const LI = T.layerInfo;
    // which layer a car is drawn in is decided by the road it is on (not just its height), so it never pops behind a deck on a ramp
    const inTun = o => T.hasTun && LI.tnNear[idx(o)] && (o.z || 0) < 12 && Math.abs(o.lat || 0) < T.hw[idx(o)] + 70;
    const onDeck = o => (o.z || 0) >= ELEV_T || (LI.elevNear[idx(o)] && Math.abs(o.lat || 0) < T.hw[idx(o)] + T.wl[idx(o)] + 24 && !inTun(o));
    const high = o => (o.z || 0) >= ELEV_T;
    mk && mk('shadows');
    for (const it of this.items) if ((it.t === 'boost' || it.t === 'oil') && !high(it) && v.visible(it.x, it.y, 60)) drawItem(g, v, it, this.time);
    for (const m of this.mines) if (!high(m) && v.visible(m.x, m.y, 30)) drawMine(g, v, m, this.time);
    if (this.hazards) this.hazards.drawGround(g, v, this.time);
    if (this.traffic) this.traffic.drawRoads(g, v, this.time);
    if (this.ghost && this.state === 'racing') this.drawGhost(g);
    mk && mk('walls+haz');
    // pickups hover under the cars (cars drive over them, never under)
    for (const it of this.items) if (it.active && it.t !== 'boost' && it.t !== 'oil' && !high(it) && v.visible(it.x, it.y, 40)) drawItem(g, v, it, this.time);
    if (this.peds) this.peds.draw(g, v);
    const list = [], lowQ = this.quality < 1;
    for (const p of this.dynProps) if (v.visible(p.x, p.y, 80)) list.push({ y: p.y - 200, k: 0, o: p }); // only animated scenery is drawn live; the rest is baked
    const vcars = this.cars.filter(c => !c.dead && v.visible(c.x, c.y, 60));
    for (const c of vcars) { c._L = inTun(c) ? 2 : onDeck(c) ? 1 : 0; if (c._L === 0) list.push({ y: c.y + 4, k: 2, o: c }); }
    if (this.hazards) this.hazards.collect(list, v);
    if (this.traffic) this.traffic.collect(list, v, LI);
    list.sort((a, b) => a.y - b.y);
    const carOpts = (c, alpha) => ({ night: this.night && !lowQ, alpha, tag: c !== this.human && this.mode !== 'attract', tagColor: c.remote ? '#9fe3ff' : '#ffd0a0' });
    for (const e of list) { if (e.k === 0) drawProp(g, v, e.o, th, this.time); else if (e.k === 3) e.fn(g, v, this.time); else drawCar(g, v, e.o, this.time, carOpts(e.o)); }
    mk && mk('props+cars');
    // baked scenery / flyovers / tunnel hills, drawn over ground-level cars; the tunnel you are in turns see-through
    const ft = this.camTarget || this.human, focus = T.hasTun && ft && LI.tnNear[idx(ft)] ? idx(ft) : -1;
    let holes = null; if (focus >= 0) { const r = LI.runOf(focus); if (r >= 0) { holes = new Path2D(); for (const ring of LI.runPoly(r)) ring.forEach(([x, y, h], k) => { const X = v.px(x, y, h), Y = v.py(x, y, h); k ? holes.lineTo(X, Y) : holes.moveTo(X, Y); }); holes.closePath(); } }
    this.ground.drawOverlay(g, v.x - v.shakeX / v.zoom, v.y - v.shakeY / v.zoom, v.zoom, W, H, holes);
    mk && mk('decks');
    // cars passing underneath a flyover show through it as a faint silhouette instead of vanishing
    if (T.hasElev && !lowQ) for (const c of vcars) { const t = c._L === 0 && LI.underDeck(c.x, c.y) ? 0.4 : 0; c.xA = (c.xA || 0) + (t - (c.xA || 0)) * Math.min(1, dt * 10); if (c.xA > 0.03) drawCar(g, v, c, this.time, carOpts(c, c.xA)); }
    // anything on a deck or airborne is drawn after the decks - on every map, not only ones with flyovers
    for (const it of this.items) if (high(it) && v.visible(it.x, it.y, 60)) { if (it.t === 'boost' || it.t === 'oil' || it.active) drawItem(g, v, it, this.time); }
    for (const m of this.mines) if (high(m) && v.visible(m.x, m.y, 30)) drawMine(g, v, m, this.time);
    if (this.traffic) this.traffic.drawLayer(g, v, 1);
    vcars.filter(c => c._L === 1).sort((a, b) => (a.z * 1000 + a.y) - (b.z * 1000 + b.y)).forEach(c => drawCar(g, v, c, this.time, carOpts(c)));
    if (T.hasTun) {
      // everything underground is drawn over the hill (which is see-through when you're inside) so it never flickers out of sight
      for (const it of this.items) if ((it.active || it.t === 'boost' || it.t === 'oil') && it.tn && v.visible(it.x, it.y, 60)) drawItem(g, v, it, this.time);
      if (this.traffic) this.traffic.drawLayer(g, v, 2);
      for (const c of vcars.filter(c => c._L === 2).sort((a, b) => a.y - b.y)) {
        const near = focus >= 0 && Math.min(Math.abs(c.pos - focus), N - Math.abs(c.pos - focus)) < 90, t = near ? 1 : 1 - 0.55 * clamp(LI.tnDepth[idx(c)] / 10, 0, 1);
        c.tunA = c.tunA == null ? t : c.tunA + (t - c.tunA) * Math.min(1, dt * 6); drawCar(g, v, c, this.time, carOpts(c, c.tunA));
      }
    }
    if (this.hazards) this.hazards.drawTop(g, v, this.time);
    this.drawGantry(g);
    for (const p of this.proj) if (v.visible(p.x, p.y, 40)) drawProjectile(g, v, p, this.time);
    this.fx.draw(g, v);
    mk && mk('fx+top');
    if (this.night) { // headlight bloom over cars
      g.globalCompositeOperation = 'lighter';
      for (const c of this.cars) if (!c.dead && c.nitroOn) glow(g, v.sx(c.x), v.sy(c.y), 90 * v.zoom, '80,170,255', 0.3);
      g.globalCompositeOperation = 'source-over';
    }
    this.drawAtmosphere(g, W, H, dt);
    mk && mk('atmos');
    this.cam.zoom = v.zoom;
  }
  /** weather / ambience in screen space (parallax follows the camera) + colour grade + vignette */
  drawAtmosphere(g, W, H, dt) {
    const T = this.T, th = T.theme, q = this.quality; if (q < 1) return; const v = this.view;
    const kind = { snow: 'snow', volcano: 'ember', desert: 'dust', mesa: 'dust', warzone: 'ash', forest: 'leaf', coast: 'spray', city: 'rain', industrial: 'ash' }[th];
    if (!this.amb) { this.amb = []; const n = q >= 2 ? 90 : 45; for (let i = 0; i < n; i++) this.amb.push({ x: Math.random(), y: Math.random(), z: 0.4 + Math.random() * 0.9, r: Math.random() * 6.28 }); this.lastCam = { x: this.cam.x, y: this.cam.y }; }
    const dx = (this.cam.x - this.lastCam.x) * v.zoom / W, dy = (this.cam.y - this.lastCam.y) * v.zoom / H; this.lastCam.x = this.cam.x; this.lastCam.y = this.cam.y; const tm = this.time;
    for (const p of this.amb) {
      p.x -= dx * p.z; p.y -= dy * p.z;
      if (kind === 'snow') { p.y += dt * (0.05 + p.z * 0.05); p.x += Math.sin(tm * 0.8 + p.r) * dt * 0.02; }
      else if (kind === 'ember') { p.y -= dt * (0.04 + p.z * 0.06); p.x += Math.sin(tm * 1.5 + p.r) * dt * 0.03; }
      else if (kind === 'rain') { p.y += dt * (0.9 + p.z * 0.5); p.x -= dt * 0.12; }
      else if (kind === 'dust' || kind === 'ash') { p.x += dt * (0.05 + p.z * 0.06); p.y += Math.sin(tm * 0.6 + p.r) * dt * 0.01; }
      else if (kind === 'leaf') { p.y += dt * 0.035 * p.z; p.x += dt * 0.04 + Math.sin(tm * 1.7 + p.r) * dt * 0.03; }
      else if (kind === 'spray') { p.x += dt * 0.07 * p.z; p.y -= dt * 0.01; }
      p.x = ((p.x % 1) + 1) % 1; p.y = ((p.y % 1) + 1) % 1; const X = p.x * W, Y = p.y * H, s = p.z * v.zoom;
      if (kind === 'snow') { g.fillStyle = `rgba(255,255,255,${0.35 + p.z * 0.4})`; g.beginPath(); g.arc(X, Y, 2.3 * s * 1.4, 0, TAU); g.fill(); }
      else if (kind === 'ember') { g.fillStyle = `rgba(255,${120 + p.z * 90 | 0},40,${0.4 + p.z * 0.4})`; g.fillRect(X, Y, 2.5 * s, 2.5 * s); }
      else if (kind === 'rain') { g.strokeStyle = `rgba(190,215,255,${0.14 + p.z * 0.16})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X, Y); g.lineTo(X - 5 * p.z, Y + 26 * p.z); g.stroke(); }
      else if (kind === 'dust') { g.fillStyle = `rgba(235,205,150,${0.1 + p.z * 0.1})`; g.beginPath(); g.ellipse(X, Y, 14 * s, 2.4 * s, 0, 0, TAU); g.fill(); }
      else if (kind === 'ash') { g.fillStyle = `rgba(170,165,150,${0.14 + p.z * 0.14})`; g.beginPath(); g.arc(X, Y, 1.8 * s, 0, TAU); g.fill(); }
      else if (kind === 'leaf') { g.fillStyle = `rgba(${p.r > 3 ? '200,150,50' : '120,170,60'},${0.5})`; g.save(); g.translate(X, Y); g.rotate(p.r + tm); g.fillRect(-3 * s, -1.5 * s, 6 * s, 3 * s); g.restore(); }
      else if (kind === 'spray') { g.fillStyle = `rgba(255,255,255,${0.1 + p.z * 0.1})`; g.beginPath(); g.arc(X, Y, 2 * s, 0, TAU); g.fill(); }
    }
    // drifting cloud shadows (daytime): a few big soft blobs moving over the whole map
    if (!this.night && th !== 'city' && q >= 2) {
      if (!this.clouds) { const r = mulberry32(T.seed ^ 0xc10d); this.clouds = []; const n = Math.max(4, Math.round(T.W * T.H / 4e6)); for (let i = 0; i < n; i++) this.clouds.push({ x: r() * T.W, y: r() * T.H, s: 380 + r() * 320, k: i % 2 }); }
      g.globalAlpha = th === 'snow' ? 0.1 : 0.14;
      for (const c of this.clouds) {
        c.x += 16 * dt; c.y += 5 * dt; if (c.x > T.W + c.s) c.x = -c.s; if (c.y > T.H + c.s) c.y = -c.s;
        const X = v.sx(c.x), Y = v.sy(c.y), R = c.s * v.zoom; if (X + R < 0 || Y + R < 0 || X - R > W || Y - R > H) continue;
        g.drawImage(cloudSprite(c.k), X - R, Y - R * 0.7, R * 2, R * 1.4);
      }
      g.globalAlpha = 1;
    }
    // colour grade + vignette
    const tint = { desert: '255,170,70', mesa: '255,120,50', snow: '120,170,255', city: '200,70,255', volcano: '255,90,20', coast: '255,230,160', forest: '60,140,60', warzone: '200,190,120', industrial: '150,160,170' }[th] || '255,255,255';
    const vk = W + 'x' + H + this.night + th; if (!this.vig || this.vig.k !== vk) { // vignette is rendered once per screen size, then just blitted
      const c = document.createElement('canvas'); c.width = Math.ceil(W / 4); c.height = Math.ceil(H / 4); const x = c.getContext('2d'), w = c.width, h = c.height;
      const vg = x.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${this.night ? 0.5 : 0.34})`); x.fillStyle = `rgba(${tint},${this.night ? 0.035 : 0.05})`; x.fillRect(0, 0, w, h); x.fillStyle = vg; x.fillRect(0, 0, w, h); this.vig = { k: vk, c }; // colour grade baked in with the vignette
    }
    g.drawImage(this.vig.c, 0, 0, W, H);
  }
  drawGhost(g) {
    const gh = this.ghost; if (!gh || !gh.pts.length) return; const v = this.view;
    const tl = this.raceTime - (this.human ? this.human.lapStart : 0), i = Math.floor(tl * 15); if (i < 0 || i >= gh.pts.length - 1) return; const f = tl * 15 - i; const a = gh.pts[i], b = gh.pts[i + 1];
    const car = { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), a: a[2] + angDiff(a[2], b[2]) * f, len: 40, wid: 21, color: '#9be2ff', shape: 'sport', hp: 1, maxHp: 1, steerVis: 0, name: 'Ghost', invuln: 0 };
    g.globalAlpha = 0.5; drawCar(g, v, car, this.time, {}); g.globalAlpha = 1;
  }
  drawGantry(g) {
    const T = this.T, v = this.view, s = T.start; if (!v.visible(s.x, s.y, 300)) return;
    const hw = T.hw[0] + 20, nx = -Math.sin(s.a), ny = Math.cos(s.a), H1 = 78;
    const ax = s.x + nx * hw, ay = s.y + ny * hw, bx = s.x - nx * hw, by = s.y - ny * hw;
    g.lineCap = 'round';
    for (const [x, y] of [[ax, ay], [bx, by]]) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(v.sx(x) + 12 * v.zoom, v.sy(y) + 9 * v.zoom, 10 * v.zoom, 7 * v.zoom, 0, 0, TAU); g.fill(); g.strokeStyle = '#2a2d36'; g.lineWidth = 9 * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, H1), v.py(x, y, H1)); g.stroke(); }
    const A = [v.px(ax, ay, H1), v.py(ax, ay, H1)], B = [v.px(bx, by, H1), v.py(bx, by, H1)], A2 = [v.px(ax, ay, H1 - 28), v.py(ax, ay, H1 - 28)], B2 = [v.px(bx, by, H1 - 28), v.py(bx, by, H1 - 28)];
    g.fillStyle = '#1a1c22'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(B2[0], B2[1]); g.lineTo(A2[0], A2[1]); g.closePath(); g.fill();
    g.strokeStyle = '#ff5a1f'; g.lineWidth = 3 * v.zoom; g.stroke();
    const mx = (A[0] + B[0] + A2[0] + B2[0]) / 4, my = (A[1] + B[1] + A2[1] + B2[1]) / 4, ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    g.save(); g.translate(mx, my); g.rotate(ang > Math.PI / 2 ? ang - Math.PI : ang < -Math.PI / 2 ? ang + Math.PI : ang); g.font = `900 ${Math.max(14, 30 * v.zoom * (1 + H1 * 0.0011))}px Impact, "Arial Black", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = 'rgba(255,90,31,0.55)'; g.strokeText('KILL LAP', 0, 0); g.fillStyle = '#ffd23a'; g.fillText('KILL LAP', 0, 0); g.restore();
  }
}
