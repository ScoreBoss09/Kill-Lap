// DOM menu system with keyboard / mouse / gamepad navigation.
import { BUILD } from './build.js';
import Audio from './audio.js';
import Input, { ACTIONS } from './input.js';
import Store, { SERIES, POINTS, ACHIEVEMENTS } from './storage.js';
import Net, { api, serverBase } from './net.js';
import { BUILTIN_TRACKS, TRACK_BY_ID, THEMES, compileTrack, generateTrack } from './tracks.js';
import { makeMinimap } from './ground.js';
import { CARS, CAR_BY_ID, UPGRADES, UPG_KEYS, PERF_KEYS, MOD_KEYS, PAINTS, carStats, carValue, DIFFICULTIES } from './cars.js';
import { fmtTime, fmtMoney, clamp, shade } from './util.js';
import { portrait, driverFor, DRIVERS } from './drivers.js';

const root = () => document.getElementById('ui');
export const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) { const v = attrs[k]; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
};

const UI = { app: null, stack: [], cur: null, modals: [], screens: {}, hidden: false };
export default UI;

/* ------------------------------------------------------------------ framework */
UI.init = function (app) {
  this.app = app;
  document.addEventListener('keydown', e => this.onKey(e));
  Input.navListeners.add(k => this.onPad(k));
  document.addEventListener('click', e => { Audio.init(); }, { once: true });
};
UI.go = function (name, params, opts = {}) {
  if (this.cur && !opts.replace && !opts.noPush) this.stack.push({ name: this.cur.name, params: this.cur.params });
  this.clearModals();
  this.render(name, params); Audio.sfx('select');
};
UI.back = function () {
  if (this.modals.length) { this.closeModal(); return; }
  if (!this.cur) return;
  if (this.cur.onBack && this.cur.onBack() === false) return;
  const p = this.stack.pop(); if (p) { this.render(p.name, p.params); Audio.sfx('back'); }
};
UI.home = function () { this.stack = []; this.clearModals(); this.render('title'); };
UI.render = function (name, params) {
  const r = root(); r.innerHTML = ''; r.classList.remove('hide'); this.hidden = false;
  if (this.cur && this.cur.cleanup) this.cur.cleanup();
  const fn = this.screens[name]; if (!fn) { console.error('no screen', name); return; }
  const ctx = { name, params, cleanup: null, onBack: null };
  this.cur = ctx;
  const el = fn(ctx, params || {}); el.classList.add('screen', 'screen-' + name); r.append(el);
  this.focusFirst();
};
UI.hide = function () { root().classList.add('hide'); this.hidden = true; document.activeElement && document.activeElement.blur && document.activeElement.blur(); };
UI.show = function () { root().classList.remove('hide'); this.hidden = false; };
UI.scope = function () { return this.modals.length ? this.modals[this.modals.length - 1].el : (this.editorScope || root()); };
UI.navs = function () { return [...this.scope().querySelectorAll('.nv')].filter(e => !e.disabled && !e.hasAttribute('data-disabled') && e.offsetParent !== null); };
UI.focusFirst = function () { const n = this.navs(); const pre = this.scope().querySelector('.nv[data-autofocus]'); (pre || n[0]) && this.focus(pre || n[0], true); };
UI.focus = function (el, silent) {
  const old = this.scope().querySelector('.nv.focus'); if (old) old.classList.remove('focus');
  el.classList.add('focus'); el.focus && el.focus({ preventScroll: true }); el.scrollIntoView && el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (!silent) Audio.sfx('move');
};
UI.move = function (dir) {
  const items = this.navs(); if (!items.length) return;
  let cur = this.scope().querySelector('.nv.focus'); if (!cur || !items.includes(cur)) { this.focus(items[0], true); return; }
  const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bs = 1e12;
  for (const el of items) {
    if (el === cur) continue; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    let prim, sec;
    if (dir === 'up') { if (dy >= -4) continue; prim = -dy; sec = Math.abs(dx); } else if (dir === 'down') { if (dy <= 4) continue; prim = dy; sec = Math.abs(dx); }
    else if (dir === 'left') { if (dx >= -4) continue; prim = -dx; sec = Math.abs(dy); } else { if (dx <= 4) continue; prim = dx; sec = Math.abs(dy); }
    const s = prim + sec * 2.5; if (s < bs) { bs = s; best = el; }
  }
  if (best) this.focus(best);
};
UI.activate = function () { const cur = this.scope().querySelector('.nv.focus'); if (cur) cur.click(); };
UI.onKey = function (e) {
  if (this.app.inRace() || (!this.modals.length && (this.hidden || this.app.inEditor()))) return;
  const typing = Input.isTyping();
  if ((e.code === 'Escape' || e.code === 'KeyP') && this.cur && this.cur.name === 'pause' && !this.modals.length) return; // the main loop toggles pause
  if (typing) { if (e.code === 'Escape') { document.activeElement.blur(); } else if (e.code === 'Enter' && document.activeElement.dataset.enter) { document.activeElement.dispatchEvent(new CustomEvent('submit')); } if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp' || document.activeElement.tagName === 'TEXTAREA') return; }
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  if (map[e.code]) { e.preventDefault(); this.dir(map[e.code]); }
  else if (e.code === 'Enter' || e.code === 'Space') { if (!typing) { e.preventDefault(); this.activate(); } }
  else if (e.code === 'Escape' || e.code === 'Backspace') { if (!typing) { e.preventDefault(); this.back(); } }
  else if (this.cur && this.cur.onKey) this.cur.onKey(e);
};
UI.onPad = function (k) {
  if (this.app.inRace() || (!this.modals.length && (this.hidden || this.app.inEditor()))) return; Audio.init();
  if (['up', 'down', 'left', 'right'].includes(k)) this.dir(k); else if (k === 'ok') this.activate(); else if (k === 'back') this.back();
  else if (this.cur && this.cur.onPad) this.cur.onPad(k);
};
UI.dir = function (d) {
  const cur = this.scope().querySelector('.nv.focus');
  if (cur && cur._step && (d === 'left' || d === 'right')) { cur._step(d === 'right' ? 1 : -1); return; }
  this.move(d);
};
UI.modal = function (title, content, buttons = [{ t: 'Close', fn: null }], opts = {}) {
  const el = h('div', { class: 'modal-wrap' }, h('div', { class: 'modal ' + (opts.cls || '') }, h('h2', null, title), h('div', { class: 'modal-body' }, content), h('div', { class: 'row end' }, buttons.map(b => h('button', { class: 'btn nv' + (b.primary ? ' primary' : ''), onclick: () => { if (b.fn && b.fn() === false) return; this.closeModal(); } }, b.t)))));
  document.getElementById('modals').append(el); this.modals.push({ el, onClose: opts.onClose }); this.focusFirst(); Audio.sfx('select'); return el;
};
UI.closeModal = function () { const m = this.modals.pop(); if (m) { m.el.remove(); m.onClose && m.onClose(); this.focusFirst(); Audio.sfx('back'); } };
UI.clearModals = function () { while (this.modals.length) this.modals.pop().el.remove(); };
UI.toast = function (text, kind = '') {
  const box = document.getElementById('toasts'); while (box.children.length >= 3) box.firstChild.remove(); const t = h('div', { class: 'toast ' + kind }, text); box.append(t); setTimeout(() => t.classList.add('out'), 3600); setTimeout(() => t.remove(), 4200);
};
UI.refreshChips = () => { const c = document.querySelector('.frame-head .chip'); if (c) c.textContent = '$ ' + Store.d.cash.toLocaleString('en-US'); };
UI.achievement = a => { UI.toast(h('div', null, h('b', null, '🏆 ' + a.name), h('div', { class: 'small' }, a.desc)), 'ach'); Audio.sfx('bestlap'); };

/* widgets */
export const btn = (text, fn, cls = '') => h('button', { class: 'btn nv ' + cls, onclick: fn }, text);
export function cycle(label, options, value, onChange, opts = {}) {
  let i = Math.max(0, options.findIndex(o => o.v === value)); const valEl = h('span', { class: 'cv' }, options[i].t);
  const el = h('div', { class: 'cycle nv', tabindex: 0 }, h('span', { class: 'cl' }, label), h('span', { class: 'ca', onclick: ev => { ev.stopPropagation(); el._step(-1); } }, '◀'), valEl, h('span', { class: 'ca', onclick: ev => { ev.stopPropagation(); el._step(1); } }, '▶'));
  el._step = d => { i = (i + d + options.length) % options.length; valEl.textContent = options[i].t; onChange(options[i].v); Audio.sfx('move'); };
  el.addEventListener('click', () => { if (opts.click) opts.click(); else el._step(1); });
  el.setOptions = (opts2, v) => { options = opts2; i = Math.max(0, options.findIndex(o => o.v === v)); valEl.textContent = options[i].t; };
  return el;
}
export function slider(label, min, max, step, value, onChange, fmt = v => Math.round(v * 100) + '%') {
  let v = value; const bar = h('div', { class: 'sbar' }, h('div', { class: 'sfill' })), val = h('span', { class: 'sv' });
  const upd = () => { bar.firstChild.style.width = ((v - min) / (max - min)) * 100 + '%'; val.textContent = fmt(v); };
  const el = h('div', { class: 'slider nv', tabindex: 0 }, h('span', { class: 'cl' }, label), bar, val);
  el._step = d => { v = clamp(Math.round((v + d * step) / step) * step, min, max); upd(); onChange(v); Audio.sfx('move'); };
  bar.addEventListener('click', ev => { const r = bar.getBoundingClientRect(); v = clamp(Math.round((min + ((ev.clientX - r.left) / r.width) * (max - min)) / step) * step, min, max); upd(); onChange(v); Audio.sfx('move'); });
  upd(); return el;
}
export function toggle(label, value, onChange) { return cycle(label, [{ v: false, t: 'OFF' }, { v: true, t: 'ON' }], !!value, onChange); }
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
export const screenFrame = (title, ...kids) => h('div', { class: 'frame' }, h('div', { class: 'frame-head' }, h('h1', null, title), h('div', { class: 'chips' }, h('span', { class: 'chip' }, '$ ' + Store.d.cash.toLocaleString('en-US')), h('span', { class: 'chip' }, Store.d.name))), ...kids);
/** small portrait + name, used in tables */
export function avatarCell(name, size = 28) { const c = portrait(name, size * 2); const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; cv.getContext('2d').drawImage(c, 0, 0); cv.style.width = cv.style.height = size + 'px'; cv.className = 'avatar'; return h('span', { class: 'avcell' }, cv, h('span', null, name)); }
const standingOf = (a, name) => { const rows = Object.entries(a.points).sort((x, y) => y[1] - x[1]); return { pos: rows.findIndex(([n]) => n === name) + 1, of: rows.length, pts: a.points[name] || 0 }; };
const MEDAL = ['🥇', '🥈', '🥉'];
const backBtn = (label = '◀ BACK') => btn(label, () => UI.back(), 'ghost');
const hint = () => h('div', { class: 'hint' }, Input.lastDevice === 'pad' ? 'D-Pad / Stick: navigate    A: select    B: back' : '↑↓←→ / mouse: navigate    Enter: select    Esc: back');

/* ------------------------------------------------------------------ track thumbnails */
const thumbCache = {};
export function trackThumb(data, size = 150) {
  const key = (data.id || '') + size + (data.pts.length) + (data.width || '') + (data.theme || '');
  if (thumbCache[key]) return thumbCache[key].cloneNode ? cloneCanvas(thumbCache[key]) : null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  try {
    const T = compileTrack(data, { light: true }); const mini = makeMinimap(T, size);
    const g = c.getContext('2d'); const th = THEMES[T.theme] || THEMES.desert;
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.75); gr.addColorStop(0, th.ground); gr.addColorStop(1, th.ground2);
    g.fillStyle = gr; g.fillRect(0, 0, size, size); g.drawImage(mini.canvas, 0, 0);
    c.dataset.len = Math.round(T.length);
  } catch (e) { console.warn('thumb', e); }
  thumbCache[key] = c; return cloneCanvas(c);
}
function cloneCanvas(c) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); n.dataset.len = c.dataset.len; return n; }
export function trackLength(data) { try { return Math.round(compileTrack(data, { light: true }).length); } catch { return 0; } }

export function allTracks() {
  const list = BUILTIN_TRACKS.map(t => ({ ...t, src: 'builtin' }));
  for (const t of Object.values(Store.d.customTracks)) list.push({ ...t, src: 'custom' });
  return list;
}
export function findTrack(id) { return TRACK_BY_ID[id] || Store.d.customTracks[id] || null; }
export function dailyTrack() {
  const day = Math.floor(Date.now() / 86400000); const t = generateTrack(day * 7919 + 13); t.id = 'daily' + day; t.name = 'Daily: ' + t.name; t.laps = 3; return t;
}

/** Track picker used for setup + multiplayer. tabs: Built-in, My Maps, Workshop */
function trackPicker(selectedId, onPick, { allowWorkshop = true } = {}) {
  const wrap = h('div', { class: 'picker' }); const grid = h('div', { class: 'tgrid' });
  let tab = 'builtin'; let workshop = null;
  const tabs = h('div', { class: 'tabs' });
  const render = async () => {
    grid.innerHTML = ''; tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === tab));
    let list = [];
    if (tab === 'builtin') list = BUILTIN_TRACKS; else if (tab === 'custom') list = Object.values(Store.d.customTracks);
    else {
      grid.append(h('div', { class: 'muted' }, 'Loading workshop...'));
      try { workshop = (await api('/api/tracks')).tracks; } catch { grid.innerHTML = ''; grid.append(h('div', { class: 'muted' }, 'Workshop unavailable (is the server running?).')); return; }
      grid.innerHTML = '';
      list = workshop.map(w => ({ id: w.id, name: w.name, author: w.author, theme: w.theme, pts: null, workshop: true }));
      if (!list.length) grid.append(h('div', { class: 'muted' }, 'No maps published yet. Build one in the Map Editor!'));
    }
    if (tab === 'custom' && !list.length) grid.append(h('div', { class: 'muted' }, 'No custom maps yet. Create one in the Map Editor, or import a JSON file there.'));
    list.forEach((t, i) => {
      const card = h('button', { class: 'tcard nv' + (t.id === selectedId ? ' sel' : ''), onclick: async () => {
        let data = t; if (t.workshop) { try { data = await api('/api/tracks/' + t.id); } catch { UI.toast('Could not download map', 'bad'); return; } }
        selectedId = data.id; onPick(data); grid.querySelectorAll('.tcard').forEach(c => c.classList.remove('sel')); card.classList.add('sel');
      } });
      if (t.pts) { const cv = trackThumb(t, 128); card.append(cv); } else card.append(h('div', { class: 'tph', style: `background:${(THEMES[t.theme] || THEMES.desert).ground}` }, '🌐'));
      card.append(h('div', { class: 'tn' }, t.name), h('div', { class: 'ts' }, (THEMES[t.theme] || {}).name || '', t.author && t.author !== 'Kill Lap' ? ' · ' + t.author : ''));
      if (t.diff) card.append(h('div', { class: 'tstars' }, stars(Math.min(5, t.diff + 1))));
      grid.append(card);
    });
    UI.focusFirst();
  };
  const tabEl = (id, text) => h('button', { class: 'tab nv', 'data-t': id, onclick: () => { tab = id; render(); } }, text);
  tabs.append(tabEl('builtin', 'BUILT-IN'), tabEl('custom', 'MY MAPS'), allowWorkshop ? tabEl('workshop', 'WORKSHOP') : null);
  wrap.append(tabs, grid); render(); return wrap;
}

/* ------------------------------------------------------------------ screens */
const S = UI.screens;

const careerLine = d => { const a = d.career.active; if (!a) return null; const sr = SERIES.find(x => x.id === a.id), st = standingOf(a, d.name); return h('div', { class: 'careerline' }, '🏁 ' + sr.name, h('br'), `Overall: P${st.pos} of ${st.of} · ${st.pts} pts · race ${a.race}/${sr.tracks.length}`); };
S.title = (ctx) => {
  const d = Store.d, items = [
    ['QUICK RACE', () => UI.go('setup', { mode: 'race' })],
    ['CAREER', () => UI.go('career')],
    ['MULTIPLAYER', () => UI.go('mp')],
    ['TIME TRIAL', () => UI.go('setup', { mode: 'tt' })],
    ['DAILY CHALLENGE', () => UI.app.startDaily()],
    ['GARAGE', () => UI.go('garage')],
    ['MAP EDITOR', () => UI.app.openEditor()],
    ['LEADERBOARDS', () => UI.go('boards')],
    ['SETTINGS', () => UI.go('settings')],
  ];
  const el = h('div', { class: 'title-screen' },
    h('div', { class: 'logo' }, h('div', { class: 'logo-top' }, 'TOP-DOWN VEHICULAR COMBAT RACING'), h('div', { class: 'logo-main', 'data-t': 'KILL LAP' }, 'KILL LAP'), h('div', { class: 'logo-sub' }, 'DRIVE FAST · SHOOT FIRST · FINISH FIRST')),
    h('div', { class: 'menu' }, items.map(([t, fn]) => btn(t, fn, 'big'))),
    h('div', { class: 'side' },
      h('div', { class: 'panel' }, h('div', { class: 'pname' }, d.name), h('div', { class: 'pcash' }, fmtMoney(d.cash)), h('div', { class: 'small' }, `${d.stats.races} races · ${d.stats.wins} wins · ${d.stats.kills} kills`), careerLine(d)),
      btn('🏆 ACHIEVEMENTS', () => UI.go('achievements'), 'ghost'), btn('🎮 CONTROLS', () => UI.go('controls'), 'ghost'), btn('ℹ CREDITS', () => UI.go('credits'), 'ghost')),
    h('div', { class: 'build-tag' }, 'build ' + BUILD + (d.freshBuild ? ' · new build - progress reset' : '')),
    hint());
  return el;
};

/* ---- race setup */
S.setup = (ctx, p) => {
  const mode = p.mode, tt = mode === 'tt'; const d = Store.d;
  const cfg = ctx.cfg = Object.assign({ track: findTrack(d.lastTrack) || BUILTIN_TRACKS[0], laps: 3, opp: 5, diff: 1, weapons: true }, p.cfg || {});
  const info = h('div', { class: 'tinfo' });
  const refresh = () => {
    info.innerHTML = ''; const t = cfg.track; const rec = d.records[t.id] || {};
    info.append(trackThumb(t, 220), h('h3', null, t.name), h('div', { class: 'small' }, `${(THEMES[t.theme] || {}).name} · ${(trackLength(t) * 0.11 / 1000).toFixed(2)} km lap · by ${t.author || 'unknown'}`),
      h('div', { class: 'recs' }, h('div', null, 'Your best lap: ', h('b', null, rec.lap ? fmtTime(rec.lap.time) : '--'), rec.lap ? h('span', { class: 'small' }, ' (' + (CAR_BY_ID[rec.lap.car] || {}).name + ')') : ''), h('div', null, 'Your best race: ', h('b', null, rec.race ? fmtTime(rec.race.time, true) : '--'))));
  };
  refresh();
  const car = d.car; const owned = d.owned.map(id => ({ v: id, t: CAR_BY_ID[id].name }));
  const left = h('div', { class: 'col grow' }, trackPicker(cfg.track.id, t => { cfg.track = t; cfg.laps = t.laps || 3; d.lastTrack = t.id; lapsEl.setOptions(lapOpts(), cfg.laps); refresh(); }));
  const lapOpts = () => [1, 2, 3, 4, 5, 6, 8, 10].map(v => ({ v, t: v + (v === 1 ? ' lap' : ' laps') }));
  const lapsEl = cycle('Laps', lapOpts(), cfg.laps, v => cfg.laps = v);
  const right = h('div', { class: 'col side-col' }, info,
    lapsEl,
    tt ? null : cycle('Opponents', Array.from({ length: 11 }, (_, i) => ({ v: i, t: String(i) })), cfg.opp, v => cfg.opp = v),
    tt ? null : cycle('Difficulty', DIFFICULTIES.map((x, i) => ({ v: i, t: x.name })), cfg.diff, v => cfg.diff = v),
    tt ? null : toggle('Weapons & pickups', cfg.weapons, v => cfg.weapons = v),
    btn('🎲 RANDOM TRACK', () => { const t = generateTrack((Math.random() * 1e9) | 0); cfg.track = t; cfg.laps = 3; lapsEl.setOptions(lapOpts(), 3); refresh(); UI.toast('Generated: ' + t.name); }, 'ghost'),
    cycle('Car', owned, car, v => { d.car = v; Store.save(); }),
    btn(tt ? 'START TIME TRIAL' : 'START RACE', () => { Store.save(); UI.app.startRace({ mode, ...cfg, carId: Store.d.car }); }, 'primary big'), );
  return screenFrame(tt ? 'TIME TRIAL' : 'QUICK RACE', h('div', { class: 'row grow gap' }, left, right), h('div', { class: 'row' }, backBtn(), hint()));
};

/* ---- career */
S.career = (ctx) => {
  const d = Store.d, done = d.career.done, active = d.career.active;
  const cards = SERIES.map(s => {
    const locked = s.need && !done[s.need], fin = done[s.id], fl = d.career.final[s.id], act = active && active.id === s.id;
    let tag = locked ? '🔒 LOCKED' : act ? (() => { const st = standingOf(active, d.name); return `▶ IN PROGRESS - race ${active.race}/${s.tracks.length} · overall P${st.pos}/${st.of} (${st.pts} pts)`; })() : fin ? `${MEDAL[fin - 1] || '🏁'} FINISHED - best overall P${fin}` : 'READY';
    return h('button', { class: 'scard nv' + (locked ? ' locked' : '') + (act ? ' active' : ''), 'data-disabled': locked ? '1' : null, onclick: () => { if (locked) { UI.toast('Finish the ' + SERIES.find(x => x.id === s.need).name + ' first', 'bad'); return; } UI.go('series', { id: s.id }); } },
      h('div', { class: 'sn' }, s.name), h('div', { class: 'small' }, s.blurb), h('div', { class: 'meta' }, `${s.tracks.length} races · ${DIFFICULTIES[s.diff].name} bots · ${s.laps} laps`),
      h('div', { class: 'meta' }, '🔓 Unlocks: ' + (Object.values(UPGRADES).filter(u => u.need === s.id).map(u => u.name).join(', ') || (SERIES.find(x => x.need === s.id) || {}).name || '-')), h('div', { class: 'tag' }, tag));
  });
  return screenFrame('CAREER', h('p', { class: 'muted' }, 'Win cash, buy faster cars, and earn new gear: finish each series to unlock spikes, turrets, rear guards, homing missiles and cluster bombs. Races cannot be re-run - quitting a race forfeits it.'), h('div', { class: 'cards' }, cards), h('div', { class: 'row' }, backBtn(), btn('GARAGE', () => UI.go('garage'), 'ghost'), hint()));
};
S.series = (ctx, p) => {
  const s = SERIES.find(x => x.id === p.id), d = Store.d; let a = d.career.active && d.career.active.id === s.id ? d.career.active : null; const fin = !a && d.career.final[s.id];
  const standingsTbl = (rows) => h('table', { class: 'tbl' }, h('tr', null, h('th', null, '#'), h('th', null, 'Driver'), h('th', null, 'Pts')), rows.map(([n, pts], i) => h('tr', { class: n === d.name ? 'me' : '' }, h('td', null, MEDAL[i] || i + 1), h('td', null, avatarCell(n)), h('td', null, pts))));
  const trk = h('div', { class: 'tracklist' }, s.tracks.map((id, i) => { const t = findTrack(id); const doneRace = fin || (a && i < a.race); return h('div', { class: 'tl' + (doneRace ? ' done' : a && i === a.race ? ' now' : '') }, h('span', null, (i + 1) + '.'), trackThumb(t, 64), h('div', null, h('b', null, t.name), h('div', { class: 'small' }, (THEMES[t.theme] || {}).name)), doneRace ? h('span', { class: 'small' }, '✔ done') : null); }));
  const start = () => {
    if (!a) { const roster = DRIVERS.map(dr => dr.name).sort(() => Math.random() - 0.5).slice(0, 7); a = d.career.active = { id: s.id, race: 0, points: { [d.name]: 0 }, cash: 0, roster }; roster.forEach(n => a.points[n] = 0); delete d.career.final[s.id]; Store.save(); }
    UI.app.startRace({ mode: 'race', track: findTrack(s.tracks[a.race]), laps: s.laps, opp: 7, diff: s.diff, weapons: true, carId: d.car, roster: a.roster, career: { id: s.id, idx: a.race } });
  };
  let panel;
  if (a) { const st = standingOf(a, d.name); panel = h('div', { class: 'panel' }, h('h3', null, 'CHAMPIONSHIP'), h('div', { class: 'standing' }, `You are P${st.pos} of ${st.of}`, h('span', null, ` · ${st.pts} pts`)), standingsTbl(Object.entries(a.points).sort((x, y) => y[1] - x[1]))); }
  else if (fin) panel = h('div', { class: 'panel' }, h('h3', null, 'FINAL STANDINGS'), h('div', { class: 'standing' }, `${MEDAL[fin.place - 1] || '🏁'} You finished P${fin.place} of ${fin.standings.length}`), standingsTbl(fin.standings));
  else panel = h('div', { class: 'panel' }, h('h3', null, 'PRIZE MONEY'), s.prize.map((v, i) => h('div', null, `P${i + 1}: ${fmtMoney(v)}`)));
  const over = a && a.race >= s.tracks.length;
  return screenFrame(s.name.toUpperCase(), h('div', { class: 'row grow gap' }, h('div', { class: 'col grow' }, h('p', { class: 'muted' }, s.blurb), trk),
    h('div', { class: 'col side-col' }, panel,
      cycle('Car', d.owned.map(id => ({ v: id, t: CAR_BY_ID[id].name })), d.car, v => { d.car = v; Store.save(); }),
      (() => { const b = fin ? btn('NEW CHAMPIONSHIP', start, 'primary big') : over ? null : btn(a ? `NEXT RACE (${a.race + 1}/${s.tracks.length})` : 'START SERIES', start, 'primary big'); if (b) b.dataset.autofocus = '1'; return b; })(),
      a && !over ? btn('ABANDON SERIES', () => UI.modal('Abandon the series?', 'Your championship progress will be lost.', [{ t: 'Keep it' }, { t: 'ABANDON', primary: true, fn: () => { d.career.active = null; Store.save(); UI.back(); } }]), 'ghost danger') : null, btn('GARAGE', () => UI.go('garage'), 'ghost'))),
    h('div', { class: 'row' }, backBtn(), hint()));
};

/* ---- garage */
S.garage = (ctx, p) => {
  const d = Store.d; let sel = (p && p.sel) || d.car;
  const cv = h('canvas', { width: 420, height: 260, class: 'gcar' }), detail = h('div', { class: 'col grow' }), side = h('div', { class: 'col side-col' });
  const list = h('div', { class: 'carlist' });
  const cards = {};
  const stat = (label, v, m, col) => h('div', { class: 'bar' }, h('span', null, label), h('div', { class: 'bg' }, h('div', { class: 'fg', style: `width:${clamp(v / m, 0, 1) * 100}%;background:${col}` })), h('span', { class: 'bv' }, Math.round(v * (m < 3 ? 100 : 1)) + (m < 3 ? '%' : '')));
  const draw = () => UI.app.drawCarPreview(cv, sel, d.paints[sel], Store.owns(sel) ? Store.upgOf(sel) : {});
  const refocus = key => { if (!key) return; const el = UI.scope().querySelector(`[data-k="${key}"]`); if (el) UI.focus(el, true); };
  const lbl = key => { const u = UPGRADES[key], lv = Store.upgOf(sel)[key] | 0, ok = Store.unlocked(key), cost = lv < u.max ? u.cost[lv] : null; const need = u.need && SERIES.find(x => x.id === u.need);
    return h('div', { class: 'up' + (ok ? '' : ' locked') }, h('div', { class: 'un' }, h('b', null, (ok ? '' : '🔒 ') + u.name), h('span', { class: 'small' }, ok ? u.desc : 'Finish the ' + need.name + ' in Career to unlock')),
      h('div', { class: 'pips' }, Array.from({ length: u.max }, (_, i) => h('i', { class: i < lv ? 'on' : '' }))),
      !ok ? h('span', { class: 'maxed' }, 'LOCKED') : cost != null ? h('button', { class: 'btn nv mini' + (d.cash < cost ? ' dim' : ''), 'data-k': 'up-' + key, onclick: () => { if (Store.buyUpgrade(sel, key)) { Audio.sfx('cash'); build('up-' + key); UI.refreshChips(); draw(); } else UI.toast('Not enough cash', 'bad'); } }, fmtMoney(cost)) : h('span', { class: 'maxed' }, 'MAX')); };
  const build = keep => {
    const c = CAR_BY_ID[sel], own = Store.owns(sel), upg = own ? Store.upgOf(sel) : {}, st = carStats(sel, upg), max = { top: 640, accel: 520, grip: 1.6, steer: 1.5, hp: 400 };
    Object.entries(cards).forEach(([id, el]) => { el.classList.toggle('sel', id === sel); el.querySelector('.cp').textContent = Store.owns(id) ? (d.car === id ? 'ACTIVE' : 'OWNED') : fmtMoney(CAR_BY_ID[id].price); el.querySelector('.cdot').style.background = d.paints[id] || CAR_BY_ID[id].color; });
    detail.innerHTML = ''; side.innerHTML = '';
    const paints = own ? h('div', { class: 'paints' }, PAINTS.map(col => h('button', { class: 'pt nv', 'data-k': 'paint-' + col, style: `background:${col}`, onclick: () => { d.paints[sel] = col; Store.save(); build('paint-' + col); draw(); } }))) : null;
    detail.append(cv, h('h2', null, c.name), h('p', { class: 'muted' }, c.desc), stat('Top speed', st.top, max.top, '#ff6a1a'), stat('Acceleration', st.accel, max.accel, '#ffd23a'), stat('Grip', st.grip, max.grip, '#46d16a'), stat('Handling', st.steer, max.steer, '#46b7ff'), stat('Armour', st.hp, max.hp, '#ee4b35'), paints);
    if (own) {
      side.append(d.car === sel ? h('div', { class: 'tag' }, '✔ ACTIVE CAR') : btn('USE THIS CAR', () => { d.car = sel; Store.save(); build('use'); }, 'primary'),
        h('h3', null, 'Performance'), h('div', { class: 'ups' }, PERF_KEYS.map(lbl)), h('h3', null, 'Equipment · earned in Career'), h('div', { class: 'ups' }, MOD_KEYS.map(lbl)),
        sel !== 'scrapper' ? btn('SELL (' + fmtMoney(carValue(sel, upg) * 0.5) + ')', () => { UI.modal('Sell ' + c.name + '?', 'You will get ' + fmtMoney(carValue(sel, upg) * 0.5) + ' back.', [{ t: 'Cancel' }, { t: 'SELL', primary: true, fn: () => { Store.sellCar(sel); sel = d.car; build(); draw(); UI.refreshChips(); } }]); }, 'ghost danger') : null);
      side.firstChild.setAttribute && side.firstChild.setAttribute('data-k', 'use');
    } else side.append(h('div', { class: 'price' }, fmtMoney(c.price)), btn('BUY', () => { if (Store.buyCar(sel)) { d.car = sel; Store.save(); Audio.sfx('cash'); UI.toast('Bought the ' + c.name + '!'); build('use'); UI.refreshChips(); draw(); } else UI.toast('Not enough cash - go win some races!', 'bad'); }, 'primary big' + (d.cash < c.price ? ' dim' : '')));
    refocus(keep);
  };
  let ready = false; const choose = id => { if (!ready || id === sel) return; sel = id; build(); draw(); };
  for (const x of CARS) {
    const el = h('button', { class: 'ccard nv', 'data-k': 'car-' + x.id, onclick: () => choose(x.id) }, h('span', { class: 'cdot' }), h('span', null, x.name), h('span', { class: 'cp' }));
    el.addEventListener('focus', () => choose(x.id)); cards[x.id] = el; list.append(el);
  }
  build(); setTimeout(() => { draw(); const el = cards[sel]; if (el) UI.focus(el, true); setTimeout(() => { ready = true; }, 40); }, 30);
  return screenFrame('GARAGE', h('div', { class: 'row gap grow' }, list, detail, side), h('div', { class: 'row' }, backBtn(), hint()));
};

/* ---- multiplayer */
S.mp = (ctx) => {
  const d = Store.d; const list = h('div', { class: 'rooms' }), status = h('div', { class: 'status' }, 'Connecting...'); let rooms = [];
  const chatBox = h('div', { class: 'chat' }), chatIn = h('input', { type: 'text', maxlength: 140, placeholder: 'Say something to the lobby...', class: 'inp', 'data-enter': '1' });
  const doRooms = () => {
    list.innerHTML = '';
    if (!rooms.length) list.append(h('div', { class: 'muted' }, 'No rooms yet - create the first one!'));
    for (const r of rooms) list.append(h('button', { class: 'room nv', onclick: () => join(r) }, h('b', null, (r.pw ? '🔒 ' : '') + r.name), h('span', null, r.trackName), h('span', null, `${r.laps} laps`), h('span', null, `${r.n}/${r.max}` + (r.bots ? ` +${r.bots} bots` : '')), h('span', { class: 'tag ' + r.state }, r.state === 'lobby' ? 'OPEN' : 'RACING')));
  };
  const join = r => {
    const go = pw => { Net.send({ t: 'hello', name: d.name, car: d.car, upg: Store.upgOf(d.car) }); Net.send({ t: 'join', room: r.id, pw }); };
    if (r.pw) { const inp = h('input', { class: 'inp', type: 'password', placeholder: 'Password' }); UI.modal('Password', inp, [{ t: 'Cancel' }, { t: 'Join', primary: true, fn: () => go(inp.value) }]); } else go('');
  };
  const connect = async () => {
    status.textContent = 'Connecting to ' + serverBase().ws + ' ...'; status.className = 'status';
    try {
      await Net.connect(); Net.send({ t: 'hello', name: d.name, car: d.car, upg: Store.upgOf(d.car) });
      status.textContent = '● Online'; status.className = 'status ok';
    } catch (e) { status.textContent = '✖ ' + e.message + ' - check the server address in Settings'; status.className = 'status bad'; }
  };
  Net.on('welcome', m => { rooms = m.rooms; doRooms(); }).on('rooms', m => { rooms = m.rooms; doRooms(); status.textContent = `● Online - ${m.online} connected`; })
    .on('joined', m => { UI.app.mpRoom = m.room; UI.app.mpTrackData = m.trackData || null; UI.go('room', {}, { replace: false }); })
    .on('error', m => UI.toast(m.msg, 'bad')).on('chat', m => { chatBox.append(h('div', null, h('b', null, m.from + ': '), m.text)); chatBox.scrollTop = 1e9; Audio.sfx('chat', { vol: 0.5 }); })
    .on('_close', () => { status.textContent = '✖ Disconnected'; status.className = 'status bad'; });
  const create = () => {
    const cfg = { name: d.name + "'s race", track: findTrack(d.lastTrack) || BUILTIN_TRACKS[0], laps: 3, max: 8, bots: 0, diff: 1, upg: false, weapons: true, pw: '' };
    const body = h('div', { class: 'col gap' });
    const nm = h('input', { class: 'inp', value: cfg.name, maxlength: 24 }); const pw = h('input', { class: 'inp', placeholder: 'Password (optional)', maxlength: 16 });
    const tn = h('div', { class: 'muted' }, 'Track: ' + cfg.track.name);
    body.append(h('label', null, 'Room name', nm), pw, tn, btn('CHOOSE TRACK', () => UI.modal('Choose track', trackPicker(cfg.track.id, t => { cfg.track = t; tn.textContent = 'Track: ' + t.name; d.lastTrack = t.id; }), [{ t: 'Done', primary: true }], { cls: 'wide' }), 'ghost'),
      cycle('Laps', [1, 2, 3, 5, 8, 10].map(v => ({ v, t: String(v) })), 3, v => cfg.laps = v), cycle('Max players', [2, 3, 4, 6, 8, 10, 12].map(v => ({ v, t: String(v) })), 8, v => cfg.max = v),
      cycle('AI bots', Array.from({ length: 8 }, (_, i) => ({ v: i, t: String(i) })), 0, v => cfg.bots = v), cycle('Bot difficulty', DIFFICULTIES.map((x, i) => ({ v: i, t: x.name })), 1, v => cfg.diff = v),
      toggle('Use garage upgrades', cfg.upg, v => cfg.upg = v), toggle('Weapons', true, v => cfg.weapons = v));
    UI.modal('Create room', body, [{ t: 'Cancel' }, { t: 'CREATE', primary: true, fn: () => {
      Net.send({ t: 'hello', name: d.name, car: d.car, upg: Store.upgOf(d.car) });
      const isBuiltin = !!TRACK_BY_ID[cfg.track.id];
      Net.send({ t: 'create', name: nm.value, pw: pw.value, track: cfg.track.id, trackName: cfg.track.name, trackData: isBuiltin ? null : cfg.track, laps: cfg.laps, max: cfg.max, bots: cfg.bots, diff: cfg.diff, upg: cfg.upg, weapons: cfg.weapons });
    } }], { cls: 'wide' });
  };
  chatIn.addEventListener('submit', () => { if (chatIn.value.trim()) { Net.send({ t: 'chat', text: chatIn.value }); chatIn.value = ''; } });
  const nameIn = h('input', { class: 'inp', value: d.name, maxlength: 16, onchange: e => { d.name = e.target.value.replace(/[^\w .\-!?#@$*]/g, '').trim() || 'Racer'; e.target.value = d.name; Store.save(); Net.send({ t: 'hello', name: d.name, car: d.car, upg: Store.upgOf(d.car) }); } });
  connect(); ctx.cleanup = () => { Net.off('welcome'); Net.off('rooms'); Net.off('error'); Net.off('chat'); if (!UI.app.mpRoom) { Net.off('joined'); } };
  ctx.onBack = () => { if (!UI.app.mpRoom) Net.close(); };
  return screenFrame('MULTIPLAYER', status, h('div', { class: 'row grow gap' }, h('div', { class: 'col grow' }, h('div', { class: 'row' }, h('h3', null, 'ROOMS'), btn('⟳ REFRESH', () => { Net.send({ t: 'leave' }); }, 'mini')), list),
    h('div', { class: 'col side-col' }, h('label', null, 'Your name', nameIn), btn('CREATE ROOM', create, 'primary big'), btn('RECONNECT', connect, 'ghost'), cycle('Car', d.owned.map(id => ({ v: id, t: CAR_BY_ID[id].name })), d.car, v => { d.car = v; Store.save(); Net.send({ t: 'car', car: v, upg: Store.upgOf(v) }); }), h('div', { class: 'chatwrap' }, chatBox, chatIn))),
    h('div', { class: 'row' }, backBtn(), hint()));
};

S.room = (ctx) => {
  const app = UI.app, d = Store.d; let room = app.mpRoom; const plist = h('div', { class: 'plist' }), info = h('div', { class: 'rinfo' }); const chatBox = h('div', { class: 'chat' }), chatIn = h('input', { type: 'text', maxlength: 140, class: 'inp', placeholder: 'Chat...', 'data-enter': '1' });
  const controls = h('div', { class: 'col' });
  const isHost = () => room.host === Net.id;
  const upd = () => {
    plist.innerHTML = ''; room.players.forEach(p => plist.append(h('div', { class: 'pl' + (p.id === Net.id ? ' me' : '') }, h('span', { class: 'cdot', style: `background:${(CAR_BY_ID[p.car] || CARS[0]).color}` }), h('b', null, p.name + (p.id === room.host ? '  👑' : '')), h('span', { class: 'small' }, (CAR_BY_ID[p.car] || {}).name || ''), h('span', { class: 'tag ' + (p.ready || p.id === room.host ? 'ok' : '') }, p.id === room.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'))));
    for (let i = 0; i < room.bots; i++) plist.append(h('div', { class: 'pl bot' }, h('span', { class: 'cdot', style: 'background:#666' }), h('b', null, 'Bot ' + (i + 1)), h('span', { class: 'small' }, DIFFICULTIES[room.diff].name), h('span', { class: 'tag' }, 'AI')));
    info.innerHTML = ''; const tdata = app.mpTrackData || TRACK_BY_ID[room.track];
    if (tdata) info.append(trackThumb(tdata, 200)); info.append(h('h3', null, room.name), h('div', { class: 'small' }, `${room.trackName} · ${room.laps} laps · ${room.players.length}/${room.max} players · ${DIFFICULTIES[room.diff].name} bots · ${room.upg ? 'upgrades ON' : 'stock cars'} · weapons ${room.weapons ? 'ON' : 'OFF'}`));
    controls.innerHTML = '';
    if (isHost()) {
      controls.append(btn('CHANGE TRACK', () => { let pick = null; UI.modal('Choose track', trackPicker(room.track, t => pick = t), [{ t: 'Cancel' }, { t: 'SELECT', primary: true, fn: () => { if (pick) Net.send({ t: 'cfg', track: pick.id, trackName: pick.name, trackData: TRACK_BY_ID[pick.id] ? null : pick, laps: pick.laps || room.laps }); } }], { cls: 'wide' }); }, 'ghost'),
        cycle('Laps', [1, 2, 3, 5, 8, 10].map(v => ({ v, t: String(v) })), room.laps, v => Net.send({ t: 'cfg', laps: v })),
        cycle('AI bots', Array.from({ length: 8 }, (_, i) => ({ v: i, t: String(i) })), room.bots, v => Net.send({ t: 'cfg', bots: v })),
        cycle('Bot difficulty', DIFFICULTIES.map((x, i) => ({ v: i, t: x.name })), room.diff, v => Net.send({ t: 'cfg', diff: v })),
        toggle('Garage upgrades', room.upg, v => Net.send({ t: 'cfg', upg: v })), toggle('Weapons', room.weapons, v => Net.send({ t: 'cfg', weapons: v })),
        btn('START RACE', () => Net.send({ t: 'start' }), 'primary big'));
    } else {
      const me = room.players.find(p => p.id === Net.id);
      controls.append(btn(me && me.ready ? '✔ READY (click to cancel)' : 'READY UP', () => Net.send({ t: 'ready', v: !(me && me.ready) }), 'primary big'));
    }
    controls.append(cycle('Car', d.owned.map(id => ({ v: id, t: CAR_BY_ID[id].name })), d.car, v => { d.car = v; Store.save(); Net.send({ t: 'car', car: v, upg: Store.upgOf(v) }); }));
  };
  upd();
  Net.on('room', m => { const keep = UI.scope().querySelector('.nv.focus'); const idx = keep ? UI.navs().indexOf(keep) : -1; room = m.room; app.mpRoom = room; upd(); if (idx >= 0) { const n = UI.navs(); n[Math.min(idx, n.length - 1)] && UI.focus(n[Math.min(idx, n.length - 1)], true); } })
    .on('trackData', m => { app.mpTrackData = m.trackData; })
    .on('chat', m => { chatBox.append(h('div', { class: m.from === '*' ? 'sys' : '' }, m.from === '*' ? m.text : [h('b', null, m.from + ': '), m.text])); chatBox.scrollTop = 1e9; Audio.sfx('chat', { vol: 0.5 }); })
    .on('start', m => { app.startMultiplayer(m); })
    .on('error', m => UI.toast(m.msg, 'bad')).on('rooms', () => {});
  chatIn.addEventListener('submit', () => { if (chatIn.value.trim()) { Net.send({ t: 'chat', text: chatIn.value }); chatIn.value = ''; } });
  ctx.onBack = () => { Net.send({ t: 'leave' }); app.mpRoom = null; Net.off('room'); Net.off('start'); Net.off('trackData'); return true; };
  return screenFrame('ROOM', h('div', { class: 'row grow gap' }, h('div', { class: 'col grow' }, info, plist, h('div', { class: 'chatwrap' }, chatBox, chatIn)), h('div', { class: 'col side-col' }, controls)), h('div', { class: 'row' }, backBtn('◀ LEAVE ROOM'), hint()));
};

/* ---- leaderboards */
S.boards = (ctx, p) => {
  const d = Store.d; let tab = p && p.tab || 'laps'; let trackId = p && p.track || d.lastTrack || BUILTIN_TRACKS[0].id; let scope = 'global';
  const body = h('div', { class: 'boardbody' }), head = h('div', { class: 'row gap' });
  const tracks = [...BUILTIN_TRACKS.map(t => ({ v: t.id, t: t.name })), ...Object.values(d.customTracks).map(t => ({ v: t.id, t: '★ ' + t.name }))]; const dt = dailyTrack(); tracks.push({ v: dt.id, t: '📅 ' + dt.name });
  if (!tracks.find(t => t.v === trackId)) trackId = tracks[0].v;
  const row = (i, e, me) => h('tr', { class: me ? 'me' : '' }, h('td', null, i + 1), h('td', null, e.name), h('td', null, fmtTime(e.time, e.laps != null && false)), h('td', { class: 'small' }, e.car || ''), h('td', { class: 'small' }, e.date ? new Date(e.date).toLocaleDateString() : ''));
  const load = async () => {
    body.innerHTML = ''; body.append(h('div', { class: 'muted' }, 'Loading...'));
    if (tab === 'players') {
      try { const j = await api('/api/players?by=' + (ctx.by || 'wins')); body.innerHTML = ''; body.append(h('div', { class: 'tabs' }, ['wins', 'kills', 'races', 'podiums'].map(k => h('button', { class: 'tab nv' + ((ctx.by || 'wins') === k ? ' on' : ''), onclick: () => { ctx.by = k; load(); } }, k.toUpperCase()))), h('table', { class: 'tbl' }, h('tr', null, h('th', null, '#'), h('th', null, 'Driver'), h('th', null, 'Wins'), h('th', null, 'Podiums'), h('th', null, 'Kills'), h('th', null, 'Races')), j.players.map((q, i) => h('tr', { class: q.name === d.name ? 'me' : '' }, h('td', null, i + 1), h('td', null, q.name), h('td', null, q.wins), h('td', null, q.podiums), h('td', null, q.kills), h('td', null, q.races))))); }
      catch { body.innerHTML = ''; body.append(h('div', { class: 'muted' }, 'Server offline - global stats unavailable.')); }
      return;
    }
    const rec = d.records[trackId] || {}; const local = [];
    if (tab === 'laps' && rec.lap) local.push({ name: d.name + ' (you)', time: rec.lap.time, car: (CAR_BY_ID[rec.lap.car] || {}).name, date: rec.lap.date });
    if (tab === 'races' && rec.race) local.push({ name: d.name + ' (you)', time: rec.race.time, car: (CAR_BY_ID[rec.race.car] || {}).name, date: rec.race.date, laps: rec.race.laps });
    let glob = null; try { glob = await api('/api/leaderboard?track=' + encodeURIComponent(trackId)); } catch {}
    body.innerHTML = '';
    body.append(h('h3', null, 'YOUR PERSONAL BEST'), local.length ? h('table', { class: 'tbl' }, local.map((e, i) => row(i, e, true))) : h('div', { class: 'muted' }, 'No time set yet.'));
    body.append(h('h3', null, 'GLOBAL TOP 30 - ' + (tab === 'laps' ? 'FASTEST LAPS' : 'BEST RACE TIMES')));
    if (!glob) body.append(h('div', { class: 'muted' }, 'Server offline - global times unavailable. (Start the server with npm start.)'));
    else { const L = tab === 'laps' ? glob.laps : glob.races; body.append(L.length ? h('table', { class: 'tbl' }, h('tr', null, h('th', null, '#'), h('th', null, 'Driver'), h('th', null, 'Time'), h('th', null, 'Car'), h('th', null, 'Date')), L.map((e, i) => row(i, e, e.name === d.name))) : h('div', { class: 'muted' }, 'Nobody has set a time here yet. Be the first!')); }
    UI.focusFirst();
  };
  const tabBtn = (id, t) => h('button', { class: 'tab nv' + (tab === id ? ' on' : ''), onclick: () => { tab = id; ctx.rerender(); } }, t);
  ctx.rerender = () => UI.render('boards', { tab, track: trackId });
  const sel = cycle('Track', tracks, trackId, v => { trackId = v; d.lastTrack = v; load(); });
  head.append(tabBtn('laps', 'FASTEST LAPS'), tabBtn('races', 'RACE TIMES'), tabBtn('players', 'DRIVERS'));
  load();
  return screenFrame('LEADERBOARDS', head, tab !== 'players' ? sel : null, body, h('div', { class: 'row' }, backBtn(), hint()));
};

/* ---- settings */
S.settings = (ctx) => {
  const s = Store.s, d = Store.d;
  const apply = () => { Audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx }); Input.deadzone = s.deadzone; Input.sens = s.sens; Input.rumbleOn = s.rumble; Store.save(); };
  const nameIn = h('input', { class: 'inp', value: d.name, maxlength: 16, onchange: e => { d.name = e.target.value.replace(/[^\w .\-!?#@$*]/g, '').trim() || 'Racer'; e.target.value = d.name; Store.save(); } });
  const srv = h('input', { class: 'inp', value: d.server, placeholder: 'blank = this server (e.g. 192.168.1.20:3000)', onchange: e => { d.server = e.target.value.trim(); Store.save(); } });
  return screenFrame('SETTINGS', h('div', { class: 'row gap grow' }, h('div', { class: 'col grow' },
    h('h3', null, 'AUDIO'), slider('Master volume', 0, 1, 0.05, s.master, v => { s.master = v; apply(); }), slider('Music volume', 0, 1, 0.05, s.music, v => { s.music = v; apply(); }), slider('Effects volume', 0, 1, 0.05, s.sfx, v => { s.sfx = v; apply(); Audio.sfx('pickup'); }),
    h('h3', null, 'DISPLAY'), cycle('Graphics quality', [{ v: 0, t: 'Low' }, { v: 1, t: 'Medium' }, { v: 2, t: 'High' }], s.quality, v => { s.quality = v; apply(); }),
    cycle('Camera zoom', [{ v: 540, t: 'Close' }, { v: 660, t: 'Normal' }, { v: 820, t: 'Far' }, { v: 1000, t: 'Very far' }], s.zoom, v => { s.zoom = v; apply(); }),
    toggle('Screen shake', s.shake, v => { s.shake = v; apply(); }), toggle('Show FPS', s.fps, v => { s.fps = v; apply(); }), btn('TOGGLE FULLSCREEN', () => UI.app.toggleFullscreen(), 'ghost')),
    h('div', { class: 'col grow' }, h('h3', null, 'CONTROLLER'), slider('Stick dead-zone', 0.02, 0.4, 0.02, s.deadzone, v => { s.deadzone = v; apply(); }, v => v.toFixed(2)), slider('Steering sensitivity', 0.5, 1.6, 0.1, s.sens, v => { s.sens = v; apply(); }, v => v.toFixed(1) + 'x'), toggle('Rumble', s.rumble, v => { s.rumble = v; apply(); }),
      h('div', { class: 'small' }, Input.getPad() ? '🎮 Detected: ' + Input.padName : '🎮 No controller detected - plug one in and press a button.'),
      h('h3', null, 'ONLINE'), h('label', null, 'Driver name', nameIn), h('label', null, 'Server address', srv), toggle('Submit times to leaderboards', s.online, v => { s.online = v; apply(); }),
      h('h3', null, 'DATA'), btn('RESET ALL PROGRESS', () => UI.modal('Reset everything?', 'This deletes your cash, cars, records, ghosts and custom maps.', [{ t: 'Cancel' }, { t: 'DELETE', primary: true, fn: () => { localStorage.removeItem('killlap.v1'); location.reload(); } }]), 'ghost danger'))),
    h('div', { class: 'row' }, backBtn(), btn('CONTROLS', () => UI.go('controls'), 'ghost'), hint()));
};
S.controls = (ctx) => {
  const s = Store.s; const tbl = h('table', { class: 'tbl keys' });
  const nice = c => c.replace('Key', '').replace('Arrow', '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE').replace('Control', 'CTRL');
  const rebuild = () => {
    tbl.innerHTML = ''; tbl.append(h('tr', null, h('th', null, 'Action'), h('th', null, 'Keyboard (click to rebind)'), h('th', null, 'Gamepad')));
    for (const a of ACTIONS) {
      const keys = Input.keysFor(a.id);
      const bind = h('button', { class: 'btn nv mini', onclick: ev => {
        ev.target.textContent = 'press a key...';
        const fn = e => { e.preventDefault(); e.stopPropagation(); document.removeEventListener('keydown', fn, true); if (e.code !== 'Escape') { s.binds[a.id] = e.code; Input.setBinds(s.binds); Store.save(); } rebuild(); UI.focusFirst(); };
        document.addEventListener('keydown', fn, true);
      } }, keys.map(nice).join(' / '));
      tbl.append(h('tr', null, h('td', null, a.label), h('td', null, bind), h('td', null, a.pad)));
    }
  };
  rebuild();
  return screenFrame('CONTROLS', h('div', { class: 'scroll grow' }, tbl, h('p', { class: 'muted' }, 'Menus: arrow keys / D-pad to move, Enter / A to select, Esc / B to go back. Weapons need ammo - grab yellow ammo crates. Hold R (or LB) to respawn if stuck.')), h('div', { class: 'row' }, backBtn(), btn('RESET KEYS', () => { s.binds = {}; Input.setBinds({}); Store.save(); rebuild(); }, 'ghost'), hint()));
};
S.achievements = () => {
  const have = Store.d.achievements;
  return screenFrame('ACHIEVEMENTS', h('div', { class: 'cards ach' }, ACHIEVEMENTS.map(a => h('div', { class: 'acard' + (have[a.id] ? ' got' : '') }, h('b', null, (have[a.id] ? '🏆 ' : '🔒 ') + a.name), h('div', { class: 'small' }, a.desc)))), h('div', { class: 'row' }, backBtn(), btn('STATISTICS', () => UI.go('stats'), 'ghost'), hint()));
};
S.stats = () => {
  const s = Store.d.stats; const rows = [['Races finished', s.races], ['Wins', s.wins], ['Podiums', s.podiums], ['Opponents wrecked', s.kills], ['Times wrecked', s.deaths], ['Laps driven', s.laps], ['Pickups collected', s.pickups], ['Total earnings', fmtMoney(s.earned)], ['Top speed', Math.round(s.topSpeed * 0.36) + ' km/h'], ['Damage dealt', Math.round(s.dmgDealt)], ['Time played', Math.round(s.playTime / 60) + ' min']];
  return screenFrame('STATISTICS', h('table', { class: 'tbl' }, rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b)))), h('div', { class: 'row' }, backBtn(), hint()));
};
S.credits = () => screenFrame('CREDITS', h('div', { class: 'scroll grow' }, h('p', null, 'KILL LAP - an homage to the golden age of top-down vehicular combat racing.'), h('p', { class: 'muted' }, 'All graphics are drawn procedurally. All sound effects and the soundtrack are synthesised live in your browser with WebAudio.'),
  h('p', null, 'Want your own music or sound effects? Drop files into  public/assets/audio/  - see the README in that folder.'), h('p', { class: 'muted' }, 'Zero-dependency Node server · HTML5 canvas · Gamepad API')), h('div', { class: 'row' }, backBtn(), hint()));

/* ---- pause / results (overlays, shown by main) */
S.pause = (ctx, p) => {
  ctx.onBack = () => { p.resume(); return false; };
  return h('div', { class: 'overlay-menu' }, h('h1', null, 'PAUSED'), h('div', { class: 'menu' },
    btn('RESUME', p.resume, 'primary big'), p.restart ? btn('RESTART RACE', p.restart, 'big') : null, btn('SETTINGS', () => UI.go('settings'), 'big'), btn('CONTROLS', () => UI.go('controls'), 'big'), btn('QUIT TO MENU', p.quit, 'big danger')));
};
S.results = (ctx, p) => {
  const r = p.results, me = r.find(x => x.human) || r[0]; const rows = r.map(x => h('tr', { class: x.human ? 'me' : '' }, h('td', null, x.place), h('td', null, h('span', { class: 'cdot', style: `background:${x.color}` }), ' ', avatarCell(x.name)), h('td', null, x.time != null ? (x.est ? '~' : '') + fmtTime(x.time) : 'DNF'), h('td', null, x.best != null ? fmtTime(x.best) : '-'), h('td', null, x.kills), h('td', null, x.place <= 3 ? ['🥇', '🥈', '🥉'][x.place - 1] : '')));
  const notes = (p.notes || []).map(n => h('div', { class: 'note ' + (n.cls || '') }, n.text));
  return h('div', { class: 'frame results' }, h('div', { class: 'frame-head' }, h('h1', null, p.title || (me.place === 1 ? 'VICTORY!' : 'RACE OVER')), h('div', { class: 'chips' }, h('span', { class: 'chip' }, p.track))),
    h('div', { class: 'row grow gap' }, h('div', { class: 'col grow' }, h('table', { class: 'tbl' }, h('tr', null, h('th', null, '#'), h('th', null, 'Driver'), h('th', null, 'Time'), h('th', null, 'Best lap'), h('th', null, 'Kills'), h('th')), rows)), h('div', { class: 'col side-col' }, notes, p.extra || null)),
    h('div', { class: 'row end gap' }, p.buttons.map(b => btn(b.t, b.fn, b.cls || ''))));
};
S.lineup = (ctx, p) => {
  let left = 9, done = false; const go = () => { if (done) return; done = true; clearInterval(tm); p.go(); };
  const timer = h('span', { class: 'small' }, ''); const tm = setInterval(() => { left--; timer.textContent = left > 0 ? `Starting in ${left}s...` : ''; if (left <= 0) go(); }, 1000); timer.textContent = `Starting in ${left}s...`;
  ctx.cleanup = () => clearInterval(tm); ctx.onBack = () => { go(); return false; };
  const cards = p.drivers.map(dv => { const dr = driverFor(dv.name), st = carStats(dv.carId, dv.upg || {}); const cv = document.createElement('canvas'); cv.width = cv.height = 192; cv.getContext('2d').drawImage(portrait(dv.name, 192), 0, 0);
    const mods = ['fs', 'rs', 'ws', 'turret', 'guard', 'homing', 'cluster'].filter(k => st.mods[k] > 0).map(k => ({ fs: 'front spikes', rs: 'rear spikes', ws: 'wheel spikes', turret: 'turret', guard: 'rear guard', homing: 'homing', cluster: 'cluster bombs' }[k]));
    return h('div', { class: 'dcard' }, cv, h('div', { class: 'dinfo' }, h('b', null, dr.name), h('div', { class: 'nick' }, '"' + dr.nick + '"'), h('div', { class: 'small' }, dr.bio), h('div', { class: 'meta' }, `${dr.style} · ${st.name}`), mods.length ? h('div', { class: 'small gold' }, '⚙ ' + mods.join(', ')) : null,
      h('div', { class: 'dstats' }, h('span', null, 'SPEED ', '★'.repeat(Math.round((dr.skill - 0.9) * 25)).padEnd(3, '☆')), h('span', null, 'AGGRESSION ', '★'.repeat(clamp(Math.round(dr.aggr * 2.2), 1, 3)).padEnd(3, '☆'))))); });
  return h('div', { class: 'frame lineup' }, h('div', { class: 'frame-head' }, h('h1', null, 'MEET THE FIELD'), h('div', { class: 'chips' }, h('span', { class: 'chip' }, p.track))), h('div', { class: 'dgrid' }, cards), h('div', { class: 'row' }, timer, (() => { const b = btn('START RACE ▶', go, 'primary big'); b.setAttribute('data-autofocus', '1'); return b; })(), h('span', { class: 'hint' }, 'Weapons unlock after the first lap')));
};
S.loading = (ctx, p) => h('div', { class: 'loading' }, h('div', { class: 'spin' }), h('div', null, p.text || 'LOADING...'));
