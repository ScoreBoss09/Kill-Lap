// Kill Lap - application shell: boot, main loop, race lifecycle, results & rewards.
import Audio from './audio.js';
import { RACE_SONGS } from './audio.js';
import Input from './input.js';
import Store, { SERIES, POINTS, checkAchievements } from './storage.js';
import Net, { api } from './net.js';
import UI, { h, btn, findTrack, dailyTrack, trackLength } from './ui.js';
import { Editor } from './editor.js';
import { Game } from './game.js';
import { drawHUD } from './hud.js';
import { View, drawCar } from './sprites.js';
import { BUILTIN_TRACKS, TRACK_BY_ID } from './tracks.js';
import { CARS, CAR_BY_ID, AI_NAMES, PAINTS, DIFFICULTIES, PERF_KEYS, carStats } from './cars.js';
import { DRIVER_BY_NAME, DRIVERS } from './drivers.js';
import Tex from './textures.js';
import { UPGRADES } from './cars.js';
import { avatarCell } from './ui.js';
import { fmtTime, fmtMoney, clamp, hashStr, mulberry32 } from './util.js';

const canvas = document.getElementById('game'), ctx = canvas.getContext('2d', { alpha: false }); // opaque canvas: cheaper to composite
let W = 0, H = 0;
const hudCv = document.createElement('canvas'), hudCtx = hudCv.getContext('2d'); let hudTick = 0;
let resScale = 1, lowFps = 0; // adaptive resolution: only ever lowered, never saved
function resize() {
  const q = Store.s.quality, scale = ([0.7, 0.85, 1][q] ?? 1) * resScale, dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale;
  W = Math.max(320, Math.floor(window.innerWidth * dpr)); H = Math.max(240, Math.floor(window.innerHeight * dpr));
  // cap the internal resolution: big / high-DPI screens otherwise render up to 4K internally, which no setting could save
  const cap = ([0.92e6, 1.6e6, 2.4e6][q] ?? 2.4e6) * resScale * resScale; if (W * H > cap) { const k = Math.sqrt(cap / (W * H)); W = Math.floor(W * k); H = Math.floor(H * k); }
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
}
window.addEventListener('resize', resize);

const app = {
  state: 'menu', game: null, attract: null, paused: false, cfg: null, mpRoom: null, mpTrackData: null, onTestExit: null, lastResults: null, fps: 0,
  inRace() { return this.state === 'race' && !this.paused; }, inEditor() { return this.state === 'editor'; },

  /* -------- attract mode (menu background) */
  startAttract() {
    this.stopGame();
    const tracks = BUILTIN_TRACKS; const track = tracks[(Math.random() * tracks.length) | 0];
    const roster = []; const used = new Set();
    for (let i = 0; i < 7; i++) { const car = CARS[(Math.random() * CARS.length) | 0]; roster.push({ id: 'a' + i, name: AI_NAMES[i], carId: car.id, upg: { engine: 2, tires: 2, armor: 2 }, color: PAINTS[(i * 3) % PAINTS.length], ai: true }); }
    try { this.attract = new Game({ track, laps: 2, roster, mode: 'attract', diff: 2, weapons: true, settings: Store.s, seed: (Math.random() * 1e6) | 0 }); } catch (e) { console.error(e); }
    this.state = 'menu';
  },
  stopGame() { if (this.game) { this.game.destroy(); this.game = null; } if (this.attract) { this.attract.destroy(); this.attract = null; } },

  /* -------- race setup */
  async loading(text) { UI.render('loading', { text }); await new Promise(r => setTimeout(r, 40)); },
  buildOpponents(cfg) {
    const diff = DIFFICULTIES[cfg.diff], rng = mulberry32(hashStr(cfg.track.id) ^ (Math.random() * 1e9) >>> 0); const out = []; const names = cfg.roster && cfg.roster.length ? cfg.roster.slice() : DRIVERS.map(d => d.name).sort(() => rng() - 0.5);
    // Bots are matched to the player: similar car tier and upgrade level (career series use fixed tiers), so a stock car is never hopeless.
    const upg = Store.upgOf(cfg.carId), lvls = PERF_KEYS.map(k => upg[k] | 0), avg = Math.round(lvls.reduce((a, b) => a + b, 0) / PERF_KEYS.length);
    const myTier = Math.max(0, CARS.findIndex(c => c.id === cfg.carId));
    let lo, hi, lvBase;
    if (cfg.career) { [lo, hi] = [[0, 1], [1, 3], [2, 4], [3, 5]][cfg.diff]; lvBase = [0, 1, 2, 3][cfg.diff]; }
    else { lo = Math.max(0, myTier - 1 + (cfg.diff >= 2 ? 1 : 0)); hi = Math.min(5, myTier + (cfg.diff >= 1 ? 1 : 0) + (cfg.diff >= 3 ? 1 : 0)); lvBase = clamp(avg + cfg.diff - 1, 0, 3); }
    const dv = cfg.diff, careerTier = cfg.career ? dv : -1;
    for (let i = 0; i < cfg.opp; i++) {
      const car = CARS[lo + Math.floor(rng() * (hi - lo + 1))]; const lv = clamp(lvBase + (rng() < 0.35 ? 1 : 0) - (rng() < 0.2 ? 1 : 0), 0, 4);
      let col = PAINTS[(i * 5 + 1) % PAINTS.length]; if (col === Store.d.paints[cfg.carId] || col === CAR_BY_ID[cfg.carId].color) col = PAINTS[(i * 5 + 2) % PAINTS.length];
      const name = names[i % names.length], dr = DRIVER_BY_NAME[name] || { skill: 1, aggr: 1 };
      // equipment grows with difficulty / career tier (and with each driver's temperament)
      const m = (base, chance) => (rng() < chance ? clamp(base, 0, 3) : 0);
      const upgs = { engine: lv, tires: lv, armor: lv, guns: lv, rockets: lv, nitro: Math.min(3, lv),
        fspikes: dv >= 1 ? m(dv, 0.6) : 0, rspikes: dv >= 2 ? m(dv - 1, 0.5) : 0, wspikes: dv >= 2 ? m(dv - 1, 0.45) : 0,
        turret: dv >= 2 ? m(dv - 1, 0.5) : 0, rearguard: dv >= 2 ? m(dv - 1, 0.5) : 0, homing: dv >= 2 ? m(dv - 1, 0.55) : 0, cluster: dv >= 3 ? m(dv - 2, 0.5) : 0 };
      out.push({ id: 'b' + i, name, carId: car.id, upg: upgs, color: col, ai: true, skill: dr.skill, aggr: dr.aggr });
    }
    return out;
  },
  async startRace(cfg) {
    Audio.init(); this.cfg = cfg; this.mpMode = false; this.pbThisRace = false;
    const tt = cfg.mode === 'tt';
    await this.loading('PREPARING TRACK...'); this.stopGame();
    const d = Store.d, carId = Store.owns(cfg.carId) ? cfg.carId : 'scrapper';
    const me = { id: 'me', name: d.name, carId, upg: Store.upgOf(carId), color: d.paints[carId] || CAR_BY_ID[carId].color, human: true };
    const opp = tt ? [] : this.buildOpponents({ ...cfg, carId });
    const roster = [...opp]; const slot = tt ? 0 : Math.min(roster.length, roster.length - Math.floor(Math.random() * Math.min(3, roster.length + 1)));
    roster.splice(Math.max(0, slot), 0, me);
    const ghostRec = tt ? Store.ghost(cfg.track.id) : null;
    try {
      this.game = new Game({ track: cfg.track, laps: cfg.laps, roster, mode: cfg.mode, diff: cfg.diff, weapons: tt ? false : cfg.weapons, settings: Store.s, ghost: ghostRec && ghostRec.pts ? ghostRec : null, seed: (Math.random() * 1e6) | 0,
        onLap: (c, t, best) => this.onLap(c, t, best), onEnd: (rows, g) => this.onEnd(rows, g) });
    } catch (e) { console.error(e); UI.toast('Failed to build track: ' + e.message, 'bad'); UI.home(); this.startAttract(); return; }
    if (!tt && cfg.opp > 0 && !cfg.test) {
      this.state = 'lineup';
      UI.render('lineup', { drivers: opp, track: cfg.track.name, go: () => { if (this.state === 'lineup' && this.game) this.beginRace(cfg.track); } });
      UI.stack = []; Audio.playMusic('menu');
      return;
    }
    this.beginRace(cfg.track);
  },
  beginRace(track) {
    const g = this.game; this.state = 'race'; this.paused = false; UI.hide();
    const s = g.T.start; g.ground.ensure(s.x - 900, s.y - 700, s.x + 900, s.y + 700, 40);
    Audio.playMusic(RACE_SONGS[hashStr(track.id) % RACE_SONGS.length]);
    canvas.focus && canvas.focus();
  },
  startDaily() { this.startRace({ mode: 'tt', track: dailyTrack(), laps: 3, opp: 0, diff: 1, weapons: false, carId: Store.d.car, daily: true }); },
  testTrack(track, onExit) { this.onTestExit = onExit; Editor.active = false; this.startRace({ mode: 'tt', track, laps: Math.min(track.laps || 3, 3), opp: 0, diff: 1, weapons: false, carId: Store.d.car, test: true }); },

  /* -------- multiplayer */
  async startMultiplayer(m) {
    Audio.init(); this.mpMode = true; const room = m.room; this.mpRoom = room; this.pbThisRace = false;
    const track = TRACK_BY_ID[room.track] || this.mpTrackData; if (!track) { UI.toast('Track data missing', 'bad'); return; }
    await this.loading('SYNCING RACE...'); this.stopGame();
    const myId = Net.id, isHost = room.host === myId, roster = [];
    m.roster.forEach((p, i) => { roster.push({ id: p.id, name: p.name, carId: CAR_BY_ID[p.car] ? p.car : 'scrapper', upg: p.upg || {}, color: PAINTS[i % PAINTS.length], human: p.id === myId, remote: p.id !== myId }); });
    m.bots.forEach((b, i) => roster.push({ id: b.id, name: b.name, carId: b.car, upg: { engine: DIFFICULTIES[room.diff].upgrades, tires: DIFFICULTIES[room.diff].upgrades, armor: DIFFICULTIES[room.diff].upgrades }, color: PAINTS[(m.roster.length + i + 3) % PAINTS.length], ai: true, remote: !isHost }));
    const me = roster.find(r => r.human); if (me && Store.d.paints[me.carId]) me.color = Store.d.paints[me.carId];
    try {
      this.game = new Game({ track, laps: room.laps, roster, mode: 'race', diff: room.diff, weapons: room.weapons, net: Net, isHost, settings: Store.s, seed: m.seed,
        onLap: (c, t, best) => this.onLap(c, t, best), onEnd: (rows, g) => this.onEnd(rows, g) });
    } catch (e) { UI.toast('Failed to build track', 'bad'); return; }
    this.cfg = { mode: 'race', track, laps: room.laps, diff: room.diff, mp: true };
    Net.on('st', msg => this.game && this.game.onNet(msg)).on('ev', msg => this.game && this.game.onNet(msg))
      .on('left', msg => { const c = this.game && this.game.byId[msg.id]; if (c) { c.dead = true; c.finished = c.finished; c.remote = true; c.x = -9999; if (c.voice) { c.voice.stop(); c.voice = null; } this.game.feedAdd(c.name + ' left the race', '#aaa'); this.game.cars = this.game.cars.filter(x => x !== c); delete this.game.byId[msg.id]; } })
      .on('fin', msg => { if (this.game) this.game.feedAdd(msg.name + ' finished (' + fmtTime(msg.time) + ')', '#9fe3ff'); })
      .on('results', msg => { if (this.game) this.game.endRace(msg.results); })
      .on('room', msg => {
        this.mpRoom = msg.room; const g = this.game;
        if (g && msg.room.host === Net.id && !g.isHost) { // host left: take over the AI cars
          g.isHost = true; for (const c of g.cars) if (String(c.id).startsWith('b')) { c.remote = false; c.local = true; c.ai = true; c.stuckT = 0; }
          g.feedAdd('You are now the host', '#9fe3ff');
        }
      });
    this.beginRace(track);
  },
  leaveMp() { Net.off('st'); Net.off('ev'); Net.off('left'); Net.off('fin'); Net.off('results'); },

  /* -------- callbacks */
  onLap(c, t, best) {
    const T = this.cfg.track; if (!c.human) return;
    const pb = Store.record(T.id, t, null, c.stats.id, this.cfg.laps);
    if (pb.lap) { this.pbThisRace = true; this.game.msg('PERSONAL BEST!  ' + fmtTime(t), 2.4, '#9fe3ff'); this.newLap = true; }
    Store.d.stats.laps++;
  },
  async onEnd(rows, game) {
    const cfg = this.cfg, d = Store.d, me = rows.find(r => r.human); if (!me) return;
    const humans = rows.filter(r => !String(r.id).startsWith('b') && r.id !== undefined && (r.human || this.mpMode && !String(r.id).startsWith('b'))).length;
    const notes = []; const T = cfg.track; const st = game.stats;
    const stats = d.stats; stats.races++; stats.kills += st.kills; stats.deaths += st.deaths; stats.pickups += st.pickups; stats.topSpeed = Math.max(stats.topSpeed, st.topSpeed); stats.dmgDealt += st.dmgDealt; stats.playTime += game.raceTime;
    let prize = 0; const tt = cfg.mode === 'tt';
    if (!tt) {
      const n = rows.length;
      if (cfg.career) { const s = SERIES.find(x => x.id === cfg.career.id); prize = s.prize[Math.min(me.place - 1, s.prize.length - 1)]; }
      else if (cfg.mp) prize = Math.round([1500, 900, 600, 400, 250][Math.min(me.place - 1, 4)] * Math.min(1.5, 0.5 + n * 0.12));
      else prize = Math.round([2000, 1200, 800, 500, 300, 200][Math.min(me.place - 1, 5)] * (0.5 + cfg.diff * 0.45) * (cfg.opp < 2 ? 0.3 : 1) * (cfg.laps >= 3 ? 1 : 0.5));
      if (me.place <= 3 && n > 1) stats.podiums++; if (me.place === 1 && n > 1) stats.wins++;
    }
    const bonus = st.cash; const total = prize + bonus; d.cash += total; stats.earned += total;
    if (total) notes.push({ text: `Prize money: ${fmtMoney(prize)}${bonus ? `   Bonus (kills/cash): ${fmtMoney(bonus)}` : ''}`, cls: 'gold' });
    // race record
    let recRace = false;
    const allDone = me.finished && me.time != null;
    if (allDone && game.state !== 'bad') { const r = Store.record(T.id, null, me.time, me.car, cfg.laps); recRace = r.race; if (r.race) notes.push({ text: '★ NEW PERSONAL BEST RACE TIME', cls: 'gold' }); }
    if (this.pbThisRace) notes.push({ text: '★ New personal best lap: ' + fmtTime(me.best), cls: 'gold' });
    if (this.pbThisRace && cfg.mode === 'tt' && game.bestGhost) { Store.saveGhost(T.id, { lap: game.bestGhost.lap, pts: game.bestGhost.pts, car: me.car }); notes.push({ text: 'Ghost saved - race it next time!' }); }
    // career
    let extra = null, nextBtn = null;
    if (cfg.career) { const r = this.careerAdvance(cfg, rows, me); notes.push(...r.notes); extra = r.extra; nextBtn = r.nextBtn; }
    Store.save();
    // online submission
    const sub = Store.s.online && !cfg.test && (T.builtin || /^(daily|w)/.test(T.id)) ? { track: T.id, trackLen: trackLength(T), name: d.name, car: CAR_BY_ID[me.car] ? me.car : '', lap: me.best, race: allDone ? me.time : null, laps: cfg.laps } : null;
    if (sub && sub.lap && !cfg.mp) api('/api/submit', sub).then(r => { if (r.lapRecord) UI.toast(`Global lap rank #${r.lapRank}!`, 'ach'); }).catch(() => {});
    else if (cfg.mp && me.best && T.builtin) api('/api/submit', { ...sub, race: null }).catch(() => {});
    const got = checkAchievements({ kills: st.kills, place: me.place, dmgTaken: st.dmgTaken || 0, topSpeed: st.topSpeed, newLap: this.pbThisRace, online: !!cfg.mp, humans: cfg.mp ? Math.max(2, humans) : 1 });
    got.forEach((a, i) => setTimeout(() => UI.achievement(a), 800 + i * 900));
    this.newLap = false;
    // show
    Audio.playMusic('results');
    const again = () => { if (cfg.test) { this.endRace(); const f = this.onTestExit; this.onTestExit = null; f && f(); } else this.startRace(cfg); };
    const buttons = [];
    if (cfg.mp) buttons.push({ t: 'BACK TO ROOM', cls: 'primary', fn: () => this.backToRoom() });
    else { if (nextBtn) buttons.push(nextBtn); if (cfg.career) buttons.push({ t: 'CAREER MENU', cls: nextBtn ? '' : 'primary', fn: () => { this.toMenu(); UI.go('career'); } }); else buttons.push({ t: cfg.test ? 'BACK TO EDITOR' : 'RACE AGAIN', cls: nextBtn ? '' : 'primary', fn: again }); if (!cfg.test) buttons.push({ t: 'GARAGE', fn: () => { this.toMenu(); UI.go('garage'); } }); buttons.push({ t: 'MAIN MENU', fn: () => this.toMenu() }); }
    if (this.game) { this.game.quiet = true; this.game.destroy(); } // no engine drone behind the results screen
    this.state = 'results'; UI.render('results', { results: rows, notes, extra, buttons, track: T.name, title: tt ? 'TIME TRIAL COMPLETE' : undefined });
    UI.stack = [];
    if (this.pendingFinale) { const f = this.pendingFinale; this.pendingFinale = null; setTimeout(() => UI.finale(f), 600); }
  },


  /** Applies one finished career race (places by driver name); handles series completion and unlocks. */
  careerAdvance(cfg, rows, me) {
    const d = Store.d, s = SERIES.find(x => x.id === cfg.career.id), a = d.career.active, notes = []; let extra = null, nextBtn = null;
    if (!a || a.id !== s.id || a.race !== cfg.career.idx) return { notes, extra, nextBtn };
    rows.forEach(r => { a.points[r.name] = (a.points[r.name] || 0) + POINTS[Math.min(r.place - 1, 7)]; });
    a.race++; const standings = Object.entries(a.points).sort((x, y) => y[1] - x[1]); const pos = standings.findIndex(([n]) => n === d.name) + 1;
    notes.push({ text: `Championship points: +${me ? POINTS[Math.min(me.place - 1, 7)] : 0}  -  you are P${pos} of ${standings.length} overall (${a.points[d.name]} pts)`, cls: 'gold' });
    extra = h('div', null, h('h3', null, 'Championship standings'), h('table', { class: 'tbl' }, h('tr', null, h('th', null, '#'), h('th', null, 'Driver'), h('th', null, 'Pts')), standings.slice(0, 8).map(([n, p], i) => h('tr', { class: n === d.name ? 'me' : '' }, h('td', null, i + 1), h('td', null, avatarCell(n)), h('td', null, p)))));
    if (a.race >= s.tracks.length) {
      const bonusC = [s.prize[0], s.prize[1], s.prize[2]][pos - 1] || 0;
      d.career.done[s.id] = Math.min(d.career.done[s.id] || 99, pos); d.career.final[s.id] = { place: pos, standings, at: Date.now() }; d.career.active = null; d.cash += bonusC; d.stats.earned += bonusC;
      notes.push({ text: pos === 1 ? `🏆 YOU WON THE ${s.name.toUpperCase()}!  Bonus ${fmtMoney(bonusC)}` : `Series finished: P${pos}${bonusC ? '  Bonus ' + fmtMoney(bonusC) : ''}`, cls: 'gold' });
      const unlocks = Object.entries(UPGRADES).filter(([k, u]) => u.need === s.id).map(([k, u]) => u.name); if (unlocks.length) notes.push({ text: '🔓 New equipment in the garage: ' + unlocks.join(', '), cls: 'gold' });
      const nxt = SERIES.find(x => x.need === s.id); if (nxt) notes.push({ text: '🔓 Unlocked series: ' + nxt.name, cls: 'gold' });
      this.pendingFinale = { series: s.name, pos, of: standings.length, standings, me: d.name, bonus: bonusC, unlocks: [...(unlocks.length ? ['New equipment: ' + unlocks.join(', ')] : []), ...(nxt ? ['Unlocked series: ' + nxt.name] : [])] };
    } else nextBtn = { t: 'NEXT RACE ▶', cls: 'primary', fn: () => this.startRace({ mode: 'race', track: findTrack(s.tracks[a.race]), laps: s.laps, opp: 7, diff: s.diff, weapons: true, carId: d.car, roster: a.roster, career: { id: s.id, idx: a.race } }) };
    return { notes, extra, nextBtn };
  },
  /** quitting a career race counts as a forfeit: last place, no prize */
  careerForfeit() {
    const cfg = this.cfg, d = Store.d, a = d.career.active; if (!cfg || !cfg.career || !a) return;
    const names = Object.keys(a.points).filter(n => n !== d.name).sort(() => Math.random() - 0.5); const rows = names.map((n, i) => ({ name: n, place: i + 1 })); rows.push({ name: d.name, place: names.length + 1 });
    this.careerAdvance(cfg, rows, { place: rows.length }); Store.save();
  },

  /* -------- navigation */
  endRace() { this.stopGame(); this.leaveMp(); },
  toMenu() {
    const wasMp = this.mpMode; if (this.state === 'lineup') UI.clearModals(); this.endRace(); this.state = 'menu'; this.paused = false;
    if (wasMp) { this.mpRoom = null; Net.send({ t: 'leave' }); Net.close(); this.mpMode = false; }
    this.startAttract(); UI.stack = []; UI.render('title'); Audio.playMusic('menu');
  },
  backToRoom() {
    this.endRace(); this.state = 'menu'; this.startAttract(); UI.stack = [{ name: 'title', params: {} }, { name: 'mp', params: {} }]; UI.render('room'); Audio.playMusic('menu');
  },
  pause() {
    if (this.state !== 'race' || this.paused || !this.game || this.game.over) return;
    this.paused = true; UI.show();
    const g = this.game, mp = !!g.net;
    UI.render('pause', { resume: () => this.resume(), restart: mp || this.cfg.test || this.cfg.career ? null : () => { UI.hide(); this.startRace(this.cfg); }, quit: () => { if (this.cfg.career) { UI.modal('Forfeit this race?', 'Quitting a career race counts as a forfeit: last place, no points, no prize money. Races cannot be re-run.', [{ t: 'Keep racing' }, { t: 'FORFEIT', primary: true, fn: () => { this.careerForfeit(); this.paused = false; this.toMenu(); UI.go('career'); } }]); return; } if (this.cfg.test && this.onTestExit) { this.endRace(); const f = this.onTestExit; this.onTestExit = null; this.paused = false; f(); } else { this.paused = false; this.toMenu(); } } });
    UI.stack = [];
  },
  resume() { this.paused = false; UI.hide(); UI.clearModals(); },
  openEditor(track) {
    this.stopGame(); this.leaveMp(); this.state = 'editor'; UI.hide(); Audio.playMusic('menu');
    Editor.open(this, track || (Store.d.lastEdit && Store.d.customTracks[Store.d.lastEdit]) || null);
  },
  closeEditor() { this.state = 'menu'; this.startAttract(); UI.show(); UI.home(); },
  achCheck() { checkAchievements({}).forEach(a => UI.achievement(a)); },
  toggleFullscreen() { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen && document.exitFullscreen(); },
  drawCarPreview(cv, carId, paint, upg = {}) {
    const g = cv.getContext('2d'), w = cv.width, hh = cv.height; const gr = g.createRadialGradient(w / 2, hh / 2, 10, w / 2, hh / 2, w * 0.6); gr.addColorStop(0, '#3a3f4b'); gr.addColorStop(1, '#14161c'); g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < w; i += 30) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, hh); g.stroke(); }
    const v = new View(); v.W = w; v.H = hh; v.zoom = 3.3; v.x = 0; v.y = 0; const st = carStats(carId, upg);
    const car = { ...st, x: 22, y: -8, a: -0.4, color: paint || st.color, hp: 1, maxHp: 1, steerVis: 0.2, name: '', invuln: 0, dead: false, braking: false, vx: 0, vy: 0, turA: -0.4 + Math.sin(performance.now() / 700) * 0.8, guard: st.guardCharges };
    drawCar(g, v, car, 0, { live: true });
  },
};
window.KL = app; // debugging / automated tests

/* -------------------------------------------------------------- main loop */
let last = performance.now(), fpsAcc = 0, fpsN = 0; const NO_INPUT = { steer: 0, throttle: 0, brake: 0, hb: false, fire: false, rocket: false, mine: false, nitro: false, reset: false, scores: false };
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now; if (dt > 0.25) dt = 0.25; if (dt <= 0) return;
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) {
    app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    if (app.state === 'race' && !app.paused && document.hasFocus()) { lowFps = app.fps < 40 ? lowFps + 1 : 0; if (lowFps >= 6 && resScale > 0.56) { resScale = Math.max(0.55, resScale - 0.15); lowFps = 0; resize(); UI.toast('Low frame rate - lowering render resolution', ''); } } else lowFps = 0;
  }
  Input.update(dt);
  try {
    if (app.state === 'lineup' && app.game) app.game.ground.prebake(12); // build the terrain while the line-up is on screen
    if (app.state === 'editor') { Editor.pad(dt); Editor.draw(); }
    else if (app.state === 'race' && app.game) {
      const g = app.game;
      if (Input.drive.pauseEdge && !app.paused) app.pause();
      else if (Input.drive.pauseEdge && app.paused && UI.cur && UI.cur.name === 'pause' && !UI.modals.length) app.resume();
      g.quiet = app.paused && !g.net; // engines fade while the pause menu is up
      if (!app.paused || g.net) g.frame(dt, app.paused ? NO_INPUT : Input.drive);
      if (app.state === 'race') g.updateAudio(dt);
      g.render(ctx, W, H, dt);
      if (!g.over) { // the HUD (lots of text) is redrawn at 30 Hz into its own layer and blitted every frame
        if (hudCv.width !== W || hudCv.height !== H) { hudCv.width = W; hudCv.height = H; hudTick = 0; }
        if ((hudTick++ & 1) === 0) { hudCtx.clearRect(0, 0, W, H); drawHUD(hudCtx, g, W, H, { fps: Store.s.fps ? app.fps : null, ping: g.net ? Net.ping : null, recordTime: (Store.d.records[g.opts.track.id] || {}).lap && g.mode === 'tt' ? Store.d.records[g.opts.track.id].lap.time : null }); }
        ctx.drawImage(hudCv, 0, 0);
      }
      if (g.net && g.over === false && app.paused) { /* menu overlay while sim continues */ }
    } else {
      const a = app.attract;
      if (a) { a.frame(dt, null); a.render(ctx, W, H, dt); if (a.over && a.overAttract) app.startAttract(); }
      else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); }
    }
  } catch (e) { console.error(e); if (!app._err) { app._err = true; UI.toast('Error: ' + e.message, 'bad'); } }
  Input.endFrame();
}

/* -------------------------------------------------------------- boot */
async function boot() {
  resize(); try { await Promise.race([Tex.load(), new Promise(r => setTimeout(r, 2500))]); } catch {} const s = Store.s;
  Input.setBinds(s.binds); Input.deadzone = s.deadzone; Input.sens = s.sens; Input.rumbleOn = s.rumble;
  UI.init(app);
  const start = () => { Audio.init(); Audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx }); if (app.state === 'menu') Audio.playMusic('menu'); };
  window.addEventListener('pointerdown', start, { once: true }); window.addEventListener('keydown', start, { once: true });
  window.addEventListener('gamepadconnected', () => { UI.toast('🎮 Controller connected'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.state === 'race' && !(app.game && app.game.net)) app.pause(); });
  window.addEventListener('error', e => console.error(e.error || e.message));
  app.startAttract(); UI.render('title');
  document.getElementById('boot').classList.add('gone'); setTimeout(() => document.getElementById('boot').remove(), 700);
  requestAnimationFrame(loop);
  if (new URLSearchParams(location.search).has('play')) { /* test hook: ?play=trackId */ const id = new URLSearchParams(location.search).get('play'); app.startRace({ mode: 'race', track: findTrack(id) || BUILTIN_TRACKS[0], laps: 2, opp: 5, diff: 1, weapons: true, carId: 'scrapper' }); }
}
boot();
