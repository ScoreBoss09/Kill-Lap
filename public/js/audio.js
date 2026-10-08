// Kill Lap audio: everything is synthesised with WebAudio (no sound files needed).
// Drop files into public/assets/audio/ to override any sound or track - see assets/audio/README.md.
import { mulberry32, clamp } from './util.js';

const A = {
  ctx: null, master: null, musicG: null, sfxG: null, comp: null, noise: null, dist: null,
  vol: { master: 0.8, music: 0.55, sfx: 0.8 }, custom: {}, buffers: {}, musicEl: null, song: null, seq: null, ready: false, current: null,
};
export default A;

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

A.init = function () {
  if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const ctx = this.ctx = new C();
  this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 6;
  this.master = ctx.createGain(); this.musicG = ctx.createGain(); this.sfxG = ctx.createGain();
  this.musicG.connect(this.master); this.sfxG.connect(this.master); this.master.connect(this.comp); this.comp.connect(ctx.destination);
  this.setVolumes();
  const len = ctx.sampleRate * 2, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
  // distortion curve for guitars
  const ws = ctx.createWaveShaper(), k = 40, n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
  ws.curve = curve; ws.oversample = '2x'; const gl = ctx.createBiquadFilter(); gl.type = 'lowpass'; gl.frequency.value = 7500; const gb = ctx.createGain(); gb.gain.value = 0.7; ws.connect(gl); gl.connect(gb); gb.connect(this.musicG); this.dist = ws;
  this.skid = this._noiseLoop(1900, 'bandpass', 3); this.wind = null;
  this.ready = true; this.loadCustom();
};
A.setVolumes = function (v) {
  if (v) Object.assign(this.vol, v); if (!this.ctx) return;
  this.master.gain.value = this.vol.master; this.musicG.gain.value = this.vol.music; this.sfxG.gain.value = this.vol.sfx * 2.4;
};
A._noiseLoop = function (freq, type, q) {
  const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxG); s.start(); return { s, f, g };
};

/* ------------------------------------------------------------ custom files */
A.loadCustom = async function () {
  let files = [];
  let viaApi = false;
  try { const r = await fetch('/api/audio'); if (r.ok) { files = (await r.json()).files || []; viaApi = true; } } catch {}
  if (!viaApi) { try { const r = await fetch('assets/audio/manifest.json'); if (r.ok) files = await r.json(); } catch {} }
  for (const f of files) {
    const name = f.replace(/\.[^.]+$/, '').toLowerCase(); const url = 'assets/audio/' + encodeURIComponent(f);
    this.custom[name] = url;
    if (name.startsWith('sfx_') || name === 'engine_loop') {
      try { const ab = await (await fetch(url)).arrayBuffer(); this.buffers[name] = await this.ctx.decodeAudioData(ab); } catch (e) { console.warn('bad audio', f); }
    }
  }
  if (files.length) console.log('[audio] custom files:', files.join(', '));
};

/* ------------------------------------------------------------ primitives */
A.out = function (pan = 0) { if (!pan || !this.ctx.createStereoPanner) return this.sfxG; const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(this.sfxG); return p; };
A.tone = function (o) {
  const ctx = this.ctx, t = o.t ?? ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t); if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.d);
  const a = o.a ?? 0.004, peak = o.g ?? 0.3; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
  let n = osc; if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + o.d); osc.connect(f); n = f; }
  n.connect(g); g.connect(o.dest || this.sfxG); osc.start(t); osc.stop(t + o.d + 0.05); return osc;
};
A.burst = function (o) {
  const ctx = this.ctx, t = o.t ?? ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass';
  f.frequency.setValueAtTime(o.f, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.d); f.Q.value = o.q || 0.7;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.g ?? 0.4, t + (o.a ?? 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
  s.connect(f); f.connect(g); g.connect(o.dest || this.sfxG); s.start(t, Math.random()); s.stop(t + o.d + 0.05);
};

export const SYN = {
  click(A, d) { A.tone({ f: 900, f2: 600, d: 0.05, type: 'square', g: 0.22, dest: d }); },
  move(A, d) { A.tone({ f: 520, d: 0.05, type: 'triangle', g: 0.3, dest: d }); },
  select(A, d) { A.tone({ f: 440, d: 0.08, type: 'square', g: 0.22, dest: d }); A.tone({ f: 880, d: 0.12, type: 'square', g: 0.2, t: A.ctx.currentTime + 0.06, dest: d }); },
  back(A, d) { A.tone({ f: 500, f2: 250, d: 0.12, type: 'square', g: 0.2, dest: d }); },
  gun(A, d) { A.burst({ f: 3200, f2: 800, d: 0.07, type: 'bandpass', g: 0.6, q: 1.2, dest: d }); A.tone({ f: 260, f2: 70, d: 0.06, type: 'square', g: 0.25, dest: d }); },
  rocket(A, d) { A.burst({ f: 500, f2: 3500, d: 0.45, type: 'bandpass', g: 0.9, q: 0.9, dest: d }); A.tone({ f: 180, f2: 90, d: 0.4, type: 'sawtooth', g: 0.3, lp: 900, dest: d }); },
  explosion(A, d) { A.burst({ f: 2400, f2: 90, d: 1.1, g: 0.8, dest: d }); A.tone({ f: 90, f2: 25, d: 0.9, type: 'sine', g: 0.8, dest: d }); A.burst({ f: 800, f2: 60, d: 0.5, g: 0.4, t: A.ctx.currentTime + 0.05, dest: d }); },
  smallboom(A, d) { A.burst({ f: 1800, f2: 150, d: 0.5, g: 0.5, dest: d }); A.tone({ f: 120, f2: 40, d: 0.4, g: 0.5, dest: d }); },
  mine(A, d) { A.tone({ f: 700, d: 0.05, type: 'square', g: 0.25, dest: d }); A.tone({ f: 500, d: 0.06, type: 'square', g: 0.22, t: A.ctx.currentTime + 0.07, dest: d }); },
  beep(A, d) { A.tone({ f: 523, d: 0.22, type: 'square', g: 0.3, lp: 3000, dest: d }); A.tone({ f: 1046, d: 0.18, type: 'triangle', g: 0.2, dest: d }); },
  pickup(A, d) { [0, 4, 7, 12].forEach((s, i) => A.tone({ f: mtof(72 + s), d: 0.12, type: 'triangle', g: 0.16, t: A.ctx.currentTime + i * 0.05, dest: d })); },
  cash(A, d) { A.tone({ f: 1318, d: 0.08, type: 'square', g: 0.1, dest: d }); A.tone({ f: 1760, d: 0.25, type: 'square', g: 0.1, t: A.ctx.currentTime + 0.07, dest: d }); },
  nitro(A, d) { A.burst({ f: 300, f2: 3000, d: 0.7, type: 'bandpass', g: 0.9, q: 1.5, dest: d }); A.tone({ f: 100, f2: 400, d: 0.6, type: 'sawtooth', g: 0.3, lp: 1500, dest: d }); },
  boost(A, d) { A.burst({ f: 500, f2: 4000, d: 0.5, type: 'bandpass', g: 0.8, q: 1.2, dest: d }); },
  crash(A, d) { A.burst({ f: 1500, f2: 200, d: 0.25, g: 0.6, dest: d }); A.tone({ f: 110, f2: 45, d: 0.2, g: 0.6, dest: d }); },
  hit(A, d) { A.burst({ f: 3000, f2: 600, d: 0.08, type: 'bandpass', g: 0.6, dest: d }); A.tone({ f: 800, f2: 300, d: 0.05, type: 'square', g: 0.18, dest: d }); },
  scrape(A, d) { A.burst({ f: 4000, f2: 1500, d: 0.15, type: 'highpass', g: 0.45, dest: d }); },
  lap(A, d) { [0, 4, 7].forEach((s, i) => A.tone({ f: mtof(76 + s), d: 0.25, type: 'triangle', g: 0.2, t: A.ctx.currentTime + i * 0.09, dest: d })); },
  bestlap(A, d) { [0, 4, 7, 12, 16].forEach((s, i) => A.tone({ f: mtof(76 + s), d: 0.3, type: 'square', g: 0.12, t: A.ctx.currentTime + i * 0.08, dest: d })); },
  go(A, d) { A.tone({ f: 1046, d: 0.7, type: 'square', g: 0.3, dest: d }); A.tone({ f: 1568, d: 0.7, type: 'triangle', g: 0.25, dest: d }); },
  win(A, d) { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => A.tone({ f: mtof(67 + s), d: 0.3, type: 'square', g: 0.14, t: A.ctx.currentTime + i * 0.13, dest: d })); },
  lose(A, d) { [7, 5, 3, 0].forEach((s, i) => A.tone({ f: mtof(60 + s), d: 0.3, type: 'sawtooth', g: 0.1, lp: 1200, t: A.ctx.currentTime + i * 0.17, dest: d })); },
  respawn(A, d) { A.tone({ f: 200, f2: 1200, d: 0.4, type: 'sawtooth', g: 0.12, lp: 2500, dest: d }); },
  oil(A, d) { A.burst({ f: 2500, f2: 800, d: 0.4, type: 'bandpass', g: 0.3, dest: d }); },
  empty(A, d) { A.tone({ f: 160, d: 0.07, type: 'square', g: 0.25, dest: d }); },
  chat(A, d) { A.tone({ f: 1100, d: 0.05, type: 'sine', g: 0.1, dest: d }); A.tone({ f: 1500, d: 0.07, type: 'sine', g: 0.1, t: A.ctx.currentTime + 0.05, dest: d }); },
  horn(A, d) { A.tone({ f: 311, d: 1.1, type: 'sawtooth', g: 0.28, lp: 1400, dest: d }); A.tone({ f: 392, d: 1.1, type: 'sawtooth', g: 0.26, lp: 1400, dest: d }); A.tone({ f: 233, d: 1.1, type: 'square', g: 0.12, lp: 900, dest: d }); },
  bell(A, d) { A.tone({ f: 1480, d: 0.35, type: 'sine', g: 0.3, dest: d }); A.tone({ f: 2220, d: 0.25, type: 'sine', g: 0.14, dest: d }); },
  siren(A, d) { A.tone({ f: 500, f2: 900, d: 1.1, type: 'sawtooth', g: 0.2, lp: 2200, dest: d }); A.tone({ f: 900, f2: 500, d: 1.1, type: 'sawtooth', g: 0.2, lp: 2200, t: A.ctx.currentTime + 1.05, dest: d }); },
  splash(A, d) { A.burst({ f: 1400, f2: 500, d: 0.35, type: 'bandpass', g: 0.7, q: 0.6, dest: d }); },
  thud(A, d) { A.tone({ f: 130, f2: 50, d: 0.18, g: 0.6, dest: d }); A.burst({ f: 900, f2: 200, d: 0.12, g: 0.35, dest: d }); },
  rumble(A, d) { A.burst({ f: 220, f2: 70, d: 1.2, g: 0.9, dest: d }); A.tone({ f: 55, f2: 35, d: 1.1, g: 0.6, dest: d }); },
  whoosh(A, d) { A.burst({ f: 300, f2: 1800, d: 1.2, type: 'bandpass', g: 0.4, q: 0.7, dest: d }); A.tone({ f: 80, f2: 60, d: 1.4, type: 'sawtooth', g: 0.12, lp: 500, dest: d }); },
  warn(A, d) { A.tone({ f: 880, d: 0.09, type: 'square', g: 0.18, dest: d }); },
};
/** play a named sound; opts: vol (0..1), pan (-1..1), rate */
A.sfx = function (name, opts = {}) {
  if (!this.ready || this.vol.sfx <= 0) return;
  const vol = opts.vol ?? 1; if (vol < 0.02) return;
  const buf = this.buffers['sfx_' + name];
  const d = this.ctx.createGain(); d.gain.value = vol; d.connect(this.out(opts.pan || 0));
  if (buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = opts.rate || 1; s.connect(d); s.start(); return; }
  const f = SYN[name]; if (f) f(this, d);
};
/** positional helper: listener is the camera */
A.sfxAt = function (name, x, y, cam, opts = {}) {
  const dx = x - cam.x, dy = y - cam.y, d = Math.hypot(dx, dy), vol = clamp(1 - d / 1400, 0, 1) * (opts.vol ?? 1);
  this.sfx(name, { vol: vol * vol * 1.2 > 1 ? 1 : vol * vol * 1.2, pan: clamp(dx / 700, -0.8, 0.8), rate: opts.rate });
};

/* ------------------------------------------------------------ engine voices */
A.engine = function () {
  if (!this.ready) return null;
  const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 2;
  let srcs = [];
  if (this.buffers['engine_loop'] || this.buffers['sfx_engine']) { const s = ctx.createBufferSource(); s.buffer = this.buffers['engine_loop'] || this.buffers['sfx_engine']; s.loop = true; s.connect(f); s.start(); srcs.push(s); var buf = s; }
  else {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sawtooth';
    const g2 = ctx.createGain(); g2.gain.value = 0.5; const g3 = ctx.createGain(); g3.gain.value = 0.25; o1.connect(f); o2.connect(g2); g2.connect(f); o3.connect(g3); g3.connect(f); o1.start(); o2.start(); o3.start(); srcs = [o1, o2, o3];
    var oscs = [o1, o2, o3];
  }
  f.connect(g); if (pan) { g.connect(pan); pan.connect(this.sfxG); } else g.connect(this.sfxG);
  let gear = 0;
  return {
    update(speed01, throttle, vol, p, nitro) {
      const t = ctx.currentTime; const gears = 5; const gf = speed01 * gears; const gi = Math.min(gears - 1, Math.floor(gf)); const rpm = clamp((gf - gi) * 0.75 + 0.25 + (throttle ? 0.08 : -0.05), 0.2, 1.05);
      const base = 38 + rpm * 85 + gi * 2 + (nitro ? 18 : 0);
      if (oscs) { oscs[0].frequency.setTargetAtTime(base, t, 0.04); oscs[1].frequency.setTargetAtTime(base * 0.5, t, 0.04); oscs[2].frequency.setTargetAtTime(base * 2.01, t, 0.04); }
      else buf.playbackRate.setTargetAtTime(0.6 + rpm * 1.2, t, 0.05);
      f.frequency.setTargetAtTime(350 + rpm * 1400 + (throttle ? 600 : 0), t, 0.05);
      g.gain.setTargetAtTime(vol * (0.05 + (throttle ? 0.09 : 0.05)), t, 0.06); if (pan) pan.pan.setTargetAtTime(p, t, 0.1);
    },
    stop() { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { srcs.forEach(s => { try { s.stop(); } catch {} }); g.disconnect(); }, 300); } catch {} },
  };
};
A.setSkid = function (v) { if (this.ready) this.skid.g.gain.setTargetAtTime(this.vol.sfx > 0 ? clamp(v, 0, 1) * 0.12 : 0, this.ctx.currentTime, 0.05); };

/* ------------------------------------------------------------ music */
export const SONGS = {
  menu:    { bpm: 96,  root: 40, prog: [0, 5, 3, 6], seed: 3,  style: 'dark',  drums: 'half' },
  race1:   { bpm: 146, root: 40, prog: [0, 5, 6, 4], seed: 11, style: 'drive', drums: 'rock' },
  race2:   { bpm: 132, root: 38, prog: [0, 3, 5, 6], seed: 22, style: 'drive', drums: 'rock' },
  race3:   { bpm: 158, root: 43, prog: [0, 6, 5, 4], seed: 33, style: 'metal', drums: 'double' },
  race4:   { bpm: 138, root: 41, prog: [0, 0, 5, 6], seed: 44, style: 'drive', drums: 'rock' },
  race5:   { bpm: 150, root: 45, prog: [0, 4, 5, 3], seed: 55, style: 'metal', drums: 'double' },
  results: { bpm: 104, root: 43, prog: [0, 5, 3, 4], seed: 66, style: 'dark',  drums: 'half' },
};
export const RACE_SONGS = ['race1', 'race2', 'race3', 'race4', 'race5'];
const MINOR = [0, 2, 3, 5, 7, 8, 10], PENTA = [0, 3, 5, 7, 10];

export function buildSong(spec) {
  const r = mulberry32(spec.seed), bars = [];
  // lead motif: 2 bars of 16 steps, penta degrees; repeated with variation
  const motifA = [], motifB = [];
  const rhythms = [[0, 3, 6, 8, 11, 14], [0, 2, 4, 6, 8, 10, 12, 14], [0, 4, 6, 8, 12, 15], [0, 3, 4, 7, 8, 11, 12]];
  const rh = rhythms[Math.floor(r() * rhythms.length)];
  let cur = 5 + Math.floor(r() * 3);
  for (let s = 0; s < 16; s++) { if (rh.includes(s)) { cur = clamp(cur + Math.floor(r() * 5) - 2, 0, 9); motifA[s] = cur; } else motifA[s] = null; }
  for (let s = 0; s < 16; s++) motifB[s] = motifA[s] != null && r() < 0.5 ? clamp(motifA[s] + (r() < 0.5 ? 1 : -1), 0, 9) : motifA[s];
  const gallop = [[1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1]][Math.floor(r() * 3)];
  for (let b = 0; b < 8; b++) {
    const deg = spec.prog[b % 4]; const rootN = spec.root + MINOR[deg];
    bars.push({ root: rootN, bass: gallop, motif: b % 2 ? motifB : motifA, lead: b >= 2, fill: b % 4 === 3 });
  }
  return { spec, bars };
}

A.playMusic = function (name, opts = {}) {
  if (!this.ready) { this._want = name; return; }
  if (this.current === name && !opts.force) return;
  this.stopMusic(); this.current = name;
  // custom music?
  const key = name.startsWith('race') ? 'music_race' : 'music_' + name;
  const list = Object.keys(this.custom).filter(k => k === key || (key === 'music_race' && /^music_race/.test(k)) || (key !== 'music_race' && k.startsWith(key)));
  if (list.length) {
    const el = new window.Audio(); el.crossOrigin = 'anonymous'; let i = Math.floor(Math.random() * list.length);
    const next = () => { el.src = this.custom[list[i++ % list.length]]; el.play().catch(() => {}); };
    el.addEventListener('ended', next); if (list.length === 1) el.loop = true; next();
    try { const src = this.ctx.createMediaElementSource(el); src.connect(this.musicG); } catch {}
    this.musicEl = el; return;
  }
  const spec = SONGS[name] || SONGS.menu; const song = buildSong(spec);
  const stepDur = 60 / spec.bpm / 4; let step = 0, next = this.ctx.currentTime + 0.1; const song0 = song;
  const sched = () => {
    const ctx = this.ctx;
    while (next < ctx.currentTime + 0.25) { this._step(song0, step, next, stepDur); step++; next += stepDur; }
  };
  this.seq = setInterval(sched, 40); sched();
};
A.stopMusic = function () {
  clearInterval(this.seq); this.seq = null; this.current = null;
  if (this.musicEl) { this.musicEl.pause(); this.musicEl = null; }
};
A._step = function (song, n, t, sd) {
  const { spec, bars } = song, bar = Math.floor(n / 16) % 8, s = n % 16, B = bars[bar], ctx = this.ctx, dest = this.musicG;
  const intense = spec.style !== 'dark';
  // drums
  const kick = (spec.drums === 'half') ? [0, 10].includes(s) : spec.drums === 'double' ? [0, 2, 4, 6, 8, 10, 12, 14, 3].includes(s) && (s % 4 === 0 || s % 4 === 2 || (bar % 2 && s === 3)) : [0, 4, 8, 12].includes(s) || (s === 10 && bar % 2);
  const snare = spec.drums === 'half' ? s === 8 : (s === 4 || s === 12);
  if (kick) { this.tone({ f: 150, f2: 45, d: 0.14, g: 0.55, t, dest }); this.burst({ f: 3500, d: 0.025, g: 0.35, t, dest, type: 'highpass' }); }
  if (snare) { this.burst({ f: 2400, d: 0.18, g: 0.6, type: 'bandpass', q: 0.5, t, dest }); this.tone({ f: 200, f2: 130, d: 0.09, type: 'triangle', g: 0.3, t, dest }); }
  if (s % 2 === 0 || spec.drums === 'double') { const open = s % 8 === 6; this.burst({ f: 8000, d: open ? 0.18 : 0.035, g: open ? 0.26 : 0.2, type: 'highpass', t, dest }); }
  if (B.fill && s >= 12) this.burst({ f: 1200 + (s - 12) * 300, d: 0.1, g: 0.25, type: 'bandpass', t, dest });
  if (s === 0 && bar === 0) this.burst({ f: 5000, d: 0.9, g: 0.22, type: 'highpass', t, dest });
  // bass
  if (B.bass[s]) { const note = B.root - 12 + ((s % 8 === 6 && intense) ? 12 : 0); this.tone({ f: mtof(note), d: sd * 1.6, type: 'sawtooth', g: 0.3, lp: 700, lp2: 200, t, dest }); this.tone({ f: mtof(note - 12), d: sd * 1.7, type: 'sine', g: 0.2, t, dest }); }
  // rhythm guitar (power chords on bass gallop, palm muted)
  if (intense && (B.bass[s] && s % 2 === 0 || s === 0)) {
    const r = B.root; const dur = sd * (s === 0 ? 3 : 1.2);
    for (const iv of [0, 7, 12]) { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = mtof(r + iv); f.type = 'lowpass'; f.frequency.value = 4200; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(f); f.connect(g); g.connect(this.dist); o.start(t); o.stop(t + dur + 0.05); }
  }
  // lead
  const lead = B.motif[s];
  if (lead != null && (B.lead || spec.style === 'dark')) {
    const deg = PENTA[lead % 5] + 12 * Math.floor(lead / 5); const note = B.root + 24 + deg;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = spec.style === 'dark' ? 'triangle' : 'sawtooth'; o.frequency.value = mtof(note); vib.frequency.value = 5.5; vg.gain.value = 6; vib.connect(vg); vg.connect(o.detune);
    f.type = 'lowpass'; f.frequency.value = 3200; const dur = sd * (spec.style === 'dark' ? 3 : 2.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(spec.style === 'dark' ? 0.2 : 0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(spec.style === 'dark' ? dest : this.dist); o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }
  // dark pad on bar start
  if (spec.style === 'dark' && s === 0) for (const iv of [0, 3, 7]) this.tone({ f: mtof(B.root + 12 + iv), d: sd * 15, a: 0.5, type: 'sawtooth', g: 0.05, lp: 800, t, dest });
};
