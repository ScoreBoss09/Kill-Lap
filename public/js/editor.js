// Kill Lap map editor: edit the road spline, width, scenery, pickups & hazards; test-drive, save, export, publish.
import { h, btn, cycle, slider, toggle } from './ui.js';
import UI from './ui.js';
import Store from './storage.js';
import { api } from './net.js';
import Audio from './audio.js';
import Input from './input.js';
import { THEMES, compileTrack, validateTrack, generateTrack, nearest, catmull, VERGE } from './tracks.js';
import { clamp, TAU, hashStr } from './util.js';

const ITEM_TYPES = [['repair', '#ff4d4d', '+'], ['ammo', '#ffd23a', 'A'], ['cash', '#4cff7a', '$'], ['nitro', '#3ab8ff', 'N'], ['boost', '#31e2ff', '»'], ['oil', '#666', 'O'], ['jump', '#c8a050', 'J'], ['ford', '#3a9bd5', '~'], ['train', '#ff8844', 'T'], ['cross', '#ffffff', 'X'], ['lava', '#ff4a10', 'L'], ['wave', '#2d8fb5', 'W'], ['bomber', '#c8d060', 'B']];
const ITEM_HELP = { jump: 'Ramp: launches cars that hit it at speed.', ford: 'Water: slows cars and soaks the brakes.', train: 'Level crossing: a train runs across the road now and then. Place it ON the road.', cross: 'Pedestrian crossing: people walk across (and get hit).', lava: 'Lava vent: erupts on a timer. Place beside the road.', wave: 'Tidal wave: sweeps across the road. Place beside the road.', bomber: 'Air raid: a bomber drops bombs along the track (one marker is enough).' };
const PROP_TYPES = { desert: ['cactus', 'rock', 'adobe', 'dune', 'tyres'], forest: ['pine', 'oak', 'rock', 'log', 'cabin'], snow: ['snowpine', 'rock', 'cabin', 'snowman'], city: ['tower', 'building', 'lamp', 'billboard', 'tyres'], industrial: ['container', 'tank', 'building', 'barrels', 'crane'], volcano: ['spire', 'rock', 'lava'], coast: ['palm', 'umbrella', 'rock', 'hut'], mesa: ['mesa', 'rock', 'cactus'] };
const ALL_PROPS = [...new Set(Object.values(PROP_TYPES).flat())];

export function newTrack(theme = 'desert') {
  const pts = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; pts.push([Math.round(2000 + Math.cos(a) * 1500 * (1 + 0.15 * Math.cos(2 * a))), Math.round(1400 + Math.sin(a) * 950 * (1 + 0.1 * Math.cos(3 * a)))]); }
  return { id: 'my' + Date.now().toString(36), name: 'My Track', theme, width: 160, laps: 3, seed: (Math.random() * 1e6) | 0, author: Store.d.name, pts, items: [], props: [], auto: true, dens: null };
}

export const Editor = {
  active: false, t: null, T: null, cam: { x: 2000, y: 1400, z: 0.28 }, tool: 'points', sel: -1, drag: null, hover: null, undo: [], dirty: false, itemType: 'repair', propType: 'pine', cursor: { x: 0, y: 0, vis: false }, issues: [], stale: true, panning: null, msgTimer: 0,

  open(app, track, opts = {}) {
    this.app = app; this.active = true; this.t = JSON.parse(JSON.stringify(track || newTrack())); this.onTest = opts.onTest; this.onExit = opts.onExit;
    this.undo = []; this.sel = -1; this.dirty = false;
    const root = document.getElementById('editor'); root.innerHTML = ''; root.classList.remove('hide');
    this.cv = h('canvas', { id: 'edcv' }); this.ctx = this.cv.getContext('2d');
    this.panel = h('div', { class: 'edpanel' }); this.status = h('div', { class: 'edstatus' }); this.toolbar = h('div', { class: 'edbar' });
    root.append(this.cv, this.toolbar, this.panel, this.status);
    this.buildBar(); this.buildPanel(); this.resize(); this.fit();
    this._h = {
      down: e => this.onDown(e), move: e => this.onMove(e), up: e => this.onUp(e), wheel: e => this.onWheel(e), key: e => this.onKey(e), ctx: e => e.preventDefault(), resize: () => this.resize(),
    };
    this.cv.addEventListener('mousedown', this._h.down); window.addEventListener('mousemove', this._h.move); window.addEventListener('mouseup', this._h.up);
    this.cv.addEventListener('wheel', this._h.wheel, { passive: false }); window.addEventListener('keydown', this._h.key); this.cv.addEventListener('contextmenu', this._h.ctx); window.addEventListener('resize', this._h.resize);
    this._nav = k => { if (!this.active || !this.menuMode || UI.modals.length) return; if (k === 'back') this.setMenuMode(false); else if (k === 'ok') UI.activate(); else if (['up', 'down', 'left', 'right'].includes(k)) UI.dir(k); };
    Input.navListeners.add(this._nav); this.menuMode = false; UI.editorScope = null;
    this.recompile(); this.say('Click the map to add road points. Drag points to move them. Right-click deletes.  (Gamepad: View button toggles the menus)');
  },
  close() {
    this.active = false; Input.navListeners.delete(this._nav); UI.editorScope = null; const root = document.getElementById('editor'); root.classList.remove('menumode'); root.classList.add('hide'); root.innerHTML = '';
    window.removeEventListener('mousemove', this._h.move); window.removeEventListener('mouseup', this._h.up); window.removeEventListener('keydown', this._h.key); window.removeEventListener('resize', this._h.resize);
  },
  say(t) { this.status.textContent = t; },
  resize() { this.cv.width = this.cv.clientWidth * devicePixelRatio; this.cv.height = this.cv.clientHeight * devicePixelRatio; this.stale = true; },
  fit() {
    const xs = this.t.pts.map(p => p[0]), ys = this.t.pts.map(p => p[1]); const w = Math.max(...xs) - Math.min(...xs) + 600, hh = Math.max(...ys) - Math.min(...ys) + 600;
    this.cam.x = (Math.max(...xs) + Math.min(...xs)) / 2; this.cam.y = (Math.max(...ys) + Math.min(...ys)) / 2; this.cam.z = Math.min(this.cv.width / w, this.cv.height / hh) / devicePixelRatio;
  },
  snapshot() { this.undo.push(JSON.stringify(this.t)); if (this.undo.length > 60) this.undo.shift(); this.dirty = true; },
  doUndo() { const s = this.undo.pop(); if (s) { this.t = JSON.parse(s); this.sel = -1; this.recompile(); this.say('Undone'); } },
  recompile() {
    this.stale = true;
    try { this.T = this.t.pts.length >= 4 ? compileTrack(this.t, { light: true }) : null; } catch (e) { this.T = null; }
    this.issues = this.T ? validateTrack(this.T).issues : ['Add at least 4 road points.'];
    this.panelStatus && this.panelStatus();
  },

  /* ---- coordinate helpers */
  toWorld(sx, sy) { const z = this.cam.z * devicePixelRatio; return [(sx * devicePixelRatio - this.cv.width / 2) / z + this.cam.x, (sy * devicePixelRatio - this.cv.height / 2) / z + this.cam.y]; },
  mouse(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
  pickPoint(wx, wy) { const rad = 22 / this.cam.z; let b = -1, bd = rad * rad; this.t.pts.forEach((p, i) => { const d = (p[0] - wx) ** 2 + (p[1] - wy) ** 2; if (d < bd) { bd = d; b = i; } }); return b; },
  nearestIdx(list, wx, wy, rad = 26) { let b = -1, bd = (rad / this.cam.z) ** 2; list.forEach((p, i) => { const d = (p.x - wx) ** 2 + (p.y - wy) ** 2; if (d < bd) { bd = d; b = i; } }); return b; },
  insertIndex(wx, wy) { // best control segment to insert into
    const P = this.t.pts, n = P.length; let bi = n, bd = 1e18;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1]; let t = ((wx - a[0]) * ex + (wy - a[1]) * ey) / (ex * ex + ey * ey || 1); t = clamp(t, 0, 1); const d = (wx - a[0] - ex * t) ** 2 + (wy - a[1] - ey * t) ** 2; if (d < bd) { bd = d; bi = i + 1; } }
    return { index: bi, d: Math.sqrt(bd) };
  },
  nearRoad(wx, wy) { if (!this.T) return false; const n = nearest(this.T, wx + this.T.ox, wy + this.T.oy, -1); return Math.abs(n.lat) < n.hw + 40; },

  /* ---- input */
  onDown(e) {
    Audio.init(); const [sx, sy] = this.mouse(e), [wx, wy] = this.toWorld(sx, sy);
    if (e.button === 1 || (e.button === 0 && Input.keys.has('Space'))) { this.panning = { sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y }; return; }
    this.act(wx, wy, e.button === 2, e.shiftKey);
  },
  act(wx, wy, right, shift) {
    const t = this.t;
    if (this.tool === 'points') {
      const i = this.pickPoint(wx, wy);
      if (right) { if (i >= 0 && t.pts.length > 4) { this.snapshot(); t.pts.splice(i, 1); this.sel = -1; this.recompile(); } else if (i >= 0) this.say('A track needs at least 4 points.'); return; }
      if (i >= 0) { this.sel = i; this.snapshot(); this.drag = { i }; this.buildPanel(); }
      else {
        this.snapshot(); const near = this.insertIndex(wx, wy);
        const idx = near.d < 140 / this.cam.z * 0.5 || true ? near.index : t.pts.length;
        t.pts.splice(idx, 0, [Math.round(wx), Math.round(wy)]); this.sel = idx; this.drag = { i: idx }; this.recompile(); this.buildPanel();
      }
    } else if (this.tool === 'items') {
      const list = t.items; const i = this.nearestIdx(list, wx, wy);
      if (right) { if (i >= 0) { this.snapshot(); list.splice(i, 1); this.stale = true; } return; }
      this.snapshot(); const it = { t: this.itemType, x: Math.round(wx), y: Math.round(wy) };
      if (this.itemType === 'boost' && this.T) { const n = nearest(this.T, wx + this.T.ox, wy + this.T.oy, -1); it.a = +this.T.ang[n.i].toFixed(3); }
      list.push(it); this.stale = true; Audio.sfx('pickup', { vol: 0.4 }); this.dirty = true;
    } else if (this.tool === 'props') {
      const list = t.props; const i = this.nearestIdx(list, wx, wy, 34);
      if (right) { if (i >= 0) { this.snapshot(); list.splice(i, 1); this.stale = true; } return; }
      if (this.nearRoad(wx, wy)) { this.say('Too close to the road - props sit outside the barriers.'); Audio.sfx('empty'); return; }
      this.snapshot(); list.push({ type: this.propType, x: Math.round(wx), y: Math.round(wy), s: +(0.8 + Math.random() * 0.5).toFixed(2), r: +(Math.random() * 6.28).toFixed(2) }); this.stale = true;
    }
  },
  onMove(e) {
    if (!this.active) return;
    const [sx, sy] = this.mouse(e), [wx, wy] = this.toWorld(sx, sy); this.hover = [wx, wy]; this.stale = true;
    if (this.panning) { const z = this.cam.z; this.cam.x = this.panning.cx - (e.clientX - this.panning.sx) / z; this.cam.y = this.panning.cy - (e.clientY - this.panning.sy) / z; return; }
    if (this.drag) { const p = this.t.pts[this.drag.i]; if (p) { p[0] = Math.round(wx); p[1] = Math.round(wy); this.recompile(); } }
  },
  onUp() { this.panning = null; if (this.drag) { this.drag = null; this.recompile(); } },
  onWheel(e) {
    e.preventDefault();
    if (e.shiftKey && this.sel >= 0 && this.tool === 'points') { this.adjustWidth(e.deltaY < 0 ? 10 : -10); return; }
    const [sx, sy] = this.mouse(e), [bx, by] = this.toWorld(sx, sy); this.cam.z = clamp(this.cam.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.06, 1.5);
    const [ax, ay] = this.toWorld(sx, sy); this.cam.x += bx - ax; this.cam.y += by - ay; this.stale = true;
  },
  adjustWidth(d) {
    const p = this.t.pts[this.sel]; if (!p) return; this.snapshot(); p[2] = clamp(Math.round((p[2] || this.t.width) + d), 90, 300); this.recompile(); this.say('Width at this point: ' + p[2]);
  },
  onKey(e) {
    if (!this.active || Input.isTyping() || UI.modals.length) return;
    const k = e.code, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'KeyZ') { e.preventDefault(); this.doUndo(); }
    else if (k === 'Digit1') this.setTool('points'); else if (k === 'Digit2') this.setTool('items'); else if (k === 'Digit3') this.setTool('props');
    else if ((k === 'Delete' || k === 'Backspace') && this.sel >= 0 && this.t.pts.length > 4) { this.snapshot(); this.t.pts.splice(this.sel, 1); this.sel = -1; this.recompile(); this.buildPanel(); }
    else if (k === 'BracketRight') this.adjustWidth(10); else if (k === 'BracketLeft') this.adjustWidth(-10);
    else if (k === 'KeyT') this.test(); else if (k === 'Escape') this.exit();
    else if (k === 'KeyF') { this.fit(); this.stale = true; }
    const pan = 60 / this.cam.z;
    if (k === 'ArrowLeft') this.cam.x -= pan; if (k === 'ArrowRight') this.cam.x += pan; if (k === 'ArrowUp') this.cam.y -= pan; if (k === 'ArrowDown') this.cam.y += pan;
    if (k === 'Equal') this.cam.z = clamp(this.cam.z * 1.15, 0.06, 1.5); if (k === 'Minus') this.cam.z = clamp(this.cam.z / 1.15, 0.06, 1.5); this.stale = true;
  },
  setTool(t) { this.tool = t; this.sel = t === 'points' ? this.sel : -1; this.buildPanel(); this.buildBar(); this.say({ points: 'Points: click to add/insert, drag to move, right-click to delete, Shift+wheel or [ ] for width.', items: 'Items: click to place, right-click to remove.', props: 'Scenery: click to place (outside the barriers), right-click to remove.' }[t]); },

  /* gamepad cursor (call each frame) */
  setMenuMode(on) {
    this.menuMode = on; document.getElementById('editor').classList.toggle('menumode', on); UI.editorScope = on ? document.getElementById('editor') : null;
    if (on) { UI.focusFirst(); this.say('MENU MODE - D-pad/stick: move, A: press, left/right: change values, B or View: back to the map'); } else { const f = document.querySelector('#editor .nv.focus'); if (f) f.classList.remove('focus'); this.say('MAP MODE - stick: cursor, A: place/grab, X: delete, Y: tool, View: menus'); }
  },
  pad(dt) {
    const p = Input.getPad(); if (!p || UI.modals.length) { if (!p) this.cursor.vis = false; return; }
    const vw = p.buttons[8] && p.buttons[8].pressed; if (vw && !this._vw) this.setMenuMode(!this.menuMode); this._vw = vw;
    if (this.menuMode) return;
    const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0, ay = Math.abs(p.axes[1]) > 0.15 ? p.axes[1] : 0;
    const bx = Math.abs(p.axes[2] || 0) > 0.15 ? p.axes[2] : 0, by = Math.abs(p.axes[3] || 0) > 0.15 ? p.axes[3] : 0;
    if (!this.cursor.vis) { this.cursor.x = this.cam.x; this.cursor.y = this.cam.y; }
    if (ax || ay || bx || by || p.buttons.some(b => b.pressed)) this.cursor.vis = true; if (!this.cursor.vis) return;
    this.cursor.x += ax * 600 * dt / this.cam.z; this.cursor.y += ay * 600 * dt / this.cam.z; this.cam.x += bx * 700 * dt / this.cam.z; this.cam.y += by * 700 * dt / this.cam.z;
    const z = (p.buttons[7] ? p.buttons[7].value : 0) - (p.buttons[6] ? p.buttons[6].value : 0); if (z) this.cam.z = clamp(this.cam.z * (1 + z * dt * 1.6), 0.06, 1.5);
    this.hover = [this.cursor.x, this.cursor.y]; this.stale = true;
    const prev = this._pp || {}; const now = { a: p.buttons[0].pressed, b: p.buttons[1].pressed, x: p.buttons[2].pressed, y: p.buttons[3].pressed, st: p.buttons[9].pressed, lb: p.buttons[4].pressed, rb: p.buttons[5].pressed };
    if (now.a && !prev.a) { if (this.tool === 'points') { const i = this.pickPoint(this.cursor.x, this.cursor.y); if (i >= 0 && this.sel === i && this.drag == null) { this.drag = { i }; this.snapshot(); this.say('Moving point - press A again to drop'); } else if (this.drag) { this.drag = null; this.recompile(); } else this.act(this.cursor.x, this.cursor.y, false); if (this.drag && this.drag.i !== this.sel) this.drag = null; } else this.act(this.cursor.x, this.cursor.y, false); }
    if (this.drag && this.t.pts[this.drag.i]) { const q = this.t.pts[this.drag.i]; q[0] = Math.round(this.cursor.x); q[1] = Math.round(this.cursor.y); this.recompile(); }
    if (now.x && !prev.x) this.act(this.cursor.x, this.cursor.y, true);
    if (now.y && !prev.y) { const order = ['points', 'items', 'props']; this.setTool(order[(order.indexOf(this.tool) + 1) % 3]); }
    if (now.rb && !prev.rb) this.adjustWidth(10); if (now.lb && !prev.lb) this.adjustWidth(-10);
    if (now.st && !prev.st) this.test(); if (now.b && !prev.b && !this.drag && !this.menuMode) this.exit();
    this._pp = now;
  },

  /* ---- actions */
  save(silent) {
    const t = this.t; t.author = Store.d.name; const copy = JSON.parse(JSON.stringify(t)); copy.builtin = false; Store.saveCustom(copy); this.dirty = false; if (!silent) UI.toast('Saved "' + t.name + '" to My Maps'); return copy;
  },
  test() {
    if (!this.T) { UI.toast('Add at least 4 points first', 'bad'); return; }
    const v = validateTrack(this.T); if (!v.ok) UI.toast('Warning: ' + v.issues[0], 'bad');
    this.save(true); const t = JSON.parse(JSON.stringify(this.t)); this.close(); this.app.testTrack(t, () => this.app.openEditor(t));
  },
  exit() {
    const go = () => { this.close(); this.app.closeEditor(); };
    if (this.dirty) UI.modal('Leave editor?', 'You have unsaved changes.', [{ t: 'Keep editing' }, { t: 'Save & exit', primary: true, fn: () => { this.save(); go(); } }, { t: 'Discard', fn: () => go() }]);
    else go();
  },
  exportJson() {
    const blob = new Blob([JSON.stringify(this.t, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: (this.t.name || 'track').replace(/\W+/g, '_') + '.killlap.json' }); document.body.append(a); a.click(); a.remove();
  },
  importJson() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => { try { const j = JSON.parse(await inp.files[0].text()); if (!Array.isArray(j.pts) || j.pts.length < 4) throw new Error('not a track'); j.id = 'my' + Date.now().toString(36); j.items ||= []; j.props ||= []; this.snapshot(); this.t = j; this.sel = -1; this.recompile(); this.fit(); this.buildPanel(); UI.toast('Imported "' + j.name + '"'); } catch (e) { UI.toast('Could not import: ' + e.message, 'bad'); } };
    inp.click();
  },
  async publish() {
    const v = this.T && validateTrack(this.T); if (!v || !v.ok) { UI.toast('Fix the track warnings before publishing', 'bad'); return; }
    this.save(true);
    try { const r = await api('/api/tracks', { ...this.t, author: Store.d.name }); Store._published = true; Store.d._published = true; Store.save(); UI.toast('Published to the Workshop! id ' + r.id); this.app.achCheck(); } catch (e) { UI.toast('Publish failed: ' + e.message, 'bad'); }
  },
  loadMine() {
    const list = Object.values(Store.d.customTracks); if (!list.length) { UI.toast('No saved maps yet'); return; }
    const body = h('div', { class: 'col gap' }, list.map(t => h('div', { class: 'row gap' }, btn(t.name, () => { UI.closeModal(); this.snapshot(); this.t = JSON.parse(JSON.stringify(t)); this.sel = -1; this.recompile(); this.fit(); this.buildPanel(); }, 'grow'), btn('✖', () => { Store.deleteCustom(t.id); UI.closeModal(); this.loadMine(); }, 'mini danger'))));
    UI.modal('My maps', body, [{ t: 'Close' }]);
  },
  randomise() {
    this.snapshot(); const g = generateTrack((Math.random() * 1e6) | 0, {}); const keep = { id: this.t.id, name: this.t.name };
    this.t = { ...g, ...keep, builtin: false, generated: false, items: [], props: [], author: Store.d.name, auto: true }; this.sel = -1; this.recompile(); this.fit(); this.buildPanel(); this.buildBar();
  },

  /* ---- UI */
  buildBar() {
    const b = this.toolbar; b.innerHTML = '';
    const tool = (id, t) => h('button', { class: 'btn nv mini' + (this.tool === id ? ' primary' : ''), onclick: () => this.setTool(id) }, t);
    b.append(btn('◀ EXIT', () => this.exit(), 'mini ghost'), tool('points', '1 ROAD'), tool('items', '2 PICKUPS'), tool('props', '3 SCENERY'), btn('↶ UNDO', () => this.doUndo(), 'mini ghost'), btn('▶ TEST DRIVE (T)', () => this.test(), 'mini primary'), btn('💾 SAVE', () => this.save(), 'mini'), btn('📂 MY MAPS', () => this.loadMine(), 'mini ghost'), btn('⬇ EXPORT', () => this.exportJson(), 'mini ghost'), btn('⬆ IMPORT', () => this.importJson(), 'mini ghost'), btn('🌐 PUBLISH', () => this.publish(), 'mini ghost'), btn('🎲 RANDOM', () => this.randomise(), 'mini ghost'), btn('NEW', () => { this.snapshot(); this.t = newTrack(this.t.theme); this.sel = -1; this.recompile(); this.fit(); this.buildPanel(); }, 'mini ghost'));
  },
  buildPanel() {
    const t = this.t, p = this.panel; p.innerHTML = '';
    const name = h('input', { class: 'inp', value: t.name, maxlength: 28, oninput: e => { t.name = e.target.value; this.dirty = true; } });
    p.append(h('label', null, 'Map name', name),
      cycle('Theme', Object.keys(THEMES).map(k => ({ v: k, t: THEMES[k].name })), t.theme, v => { t.theme = v; this.dirty = true; this.propType = PROP_TYPES[v][0]; this.recompile(); this.buildPanel(); }),
      slider('Road width', 100, 260, 10, t.width, v => { this.snapshot(); t.width = v; this.recompile(); }, v => v + ' px'),
      cycle('Laps', [1, 2, 3, 4, 5, 6, 8, 10].map(v => ({ v, t: String(v) })), t.laps || 3, v => { t.laps = v; this.dirty = true; }),
      slider('Scenery density', 0, 2, 0.1, t.dens == null ? THEMES[t.theme].dens : t.dens, v => { t.dens = v; this.dirty = true; }, v => v.toFixed(1) + 'x'),
      toggle('Auto-placed pickups', t.auto !== false, v => { t.auto = v; this.dirty = true; }),
      toggle('Auto hazards (trains, wave...)', t.hazards !== false, v => { t.hazards = v; this.dirty = true; }));
    if (this.tool === 'points') {
      if (this.sel >= 0 && t.pts[this.sel]) { const pt = t.pts[this.sel]; p.append(h('div', { class: 'panel' }, h('b', null, 'Point ' + (this.sel + 1)), slider('Width here', 90, 300, 10, pt[2] || t.width, v => { this.snapshot(); pt[2] = v; this.recompile(); }, v => v + ' px'),
        slider('Road height', 0, 110, 10, pt[3] || 0, v => { this.snapshot(); pt[2] = pt[2] ?? null; pt[3] = v; this.recompile(); }, v => (v ? v + ' (raised)' : 'ground')),
        toggle('Tunnel here', !!pt[4], v => { this.snapshot(); pt[2] = pt[2] ?? null; pt[3] = pt[3] || 0; pt[4] = v ? 1 : 0; this.recompile(); }),
        btn('Reset point', () => { this.snapshot(); pt.length = 2; this.recompile(); this.buildPanel(); }, 'mini ghost'), h('div', { class: 'small' }, 'Raise 2+ neighbouring points to build a flyover. Where roads cross, one must be 50+ higher.'))); }
      p.append(btn('REVERSE DIRECTION', () => { this.snapshot(); t.pts.reverse(); this.recompile(); }, 'mini ghost'), btn('SCALE ×1.15', () => { this.snapshot(); const cx = this.cam.x, cy = this.cam.y; t.pts.forEach(q => { q[0] = Math.round(cx + (q[0] - cx) * 1.15); q[1] = Math.round(cy + (q[1] - cy) * 1.15); }); this.recompile(); }, 'mini ghost'), btn('SCALE ×0.87', () => { this.snapshot(); const cx = this.cam.x, cy = this.cam.y; t.pts.forEach(q => { q[0] = Math.round(cx + (q[0] - cx) * 0.87); q[1] = Math.round(cy + (q[1] - cy) * 0.87); }); this.recompile(); }, 'mini ghost'), btn('SUBDIVIDE (more points)', () => {
        const P = t.pts, n = P.length; if (n > 60) { UI.toast('Already plenty of points', 'bad'); return; } this.snapshot(); const out = [];
        for (let i = 0; i < n; i++) { const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n]; out.push(b); out.push([Math.round(catmull(a[0], b[0], c[0], d[0], 0.5)), Math.round(catmull(a[1], b[1], c[1], d[1], 0.5))]); }
        t.pts = out; this.sel = -1; this.recompile(); this.buildPanel();
      }, 'mini ghost'));
    } else if (this.tool === 'items') {
      p.append(h('div', { class: 'palette' }, ITEM_TYPES.map(([id, col, ch]) => h('button', { class: 'btn nv mini' + (this.itemType === id ? ' primary' : ''), onclick: () => { this.itemType = id; this.buildPanel(); } }, h('span', { style: `color:${col}` }, '● '), id))), h('div', { class: 'small' }, ITEM_HELP[this.itemType] || 'Boost pads face along the road direction. Oil slicks make cars slide.'));
    } else {
      const types = [...new Set([...PROP_TYPES[t.theme], ...ALL_PROPS])];
      p.append(h('div', { class: 'palette' }, types.map(id => h('button', { class: 'btn nv mini' + (this.propType === id ? ' primary' : ''), onclick: () => { this.propType = id; this.buildPanel(); } }, id))));
    }
    this.issuesEl = h('div', { class: 'issues' }); p.append(this.issuesEl);
    this.panelStatus = () => { this.issuesEl.innerHTML = ''; if (this.issues.length) this.issues.forEach(i => this.issuesEl.append(h('div', { class: 'warn' }, '⚠ ' + i))); else this.issuesEl.append(h('div', { class: 'okmsg' }, '✔ Track is valid · ' + (this.T ? (this.T.length * 0.11 / 1000).toFixed(2) + ' km lap' : ''))); };
    this.panelStatus();
    p.append(h('div', { class: 'small muted' }, 'Mouse: wheel = zoom · middle-drag / Space-drag = pan · Shift+wheel = width.  Pad: stick = cursor, R-stick = pan, A = place/grab, X = delete, Y = tool, LB/RB = width, Start = test.'));
  },

  /* ---- drawing */
  draw() {
    if (!this.active) return; const g = this.ctx, W = this.cv.width, H = this.cv.height, z = this.cam.z * devicePixelRatio, th = THEMES[this.t.theme] || THEMES.desert;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = th.ground; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-this.cam.x, -this.cam.y);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1 / z; const step = 200; const x0 = Math.floor((this.cam.x - W / 2 / z) / step) * step, y0 = Math.floor((this.cam.y - H / 2 / z) / step) * step;
    g.beginPath(); for (let x = x0; x < this.cam.x + W / 2 / z; x += step) { g.moveTo(x, y0); g.lineTo(x, this.cam.y + H / 2 / z); } for (let y = y0; y < this.cam.y + H / 2 / z; y += step) { g.moveTo(x0, y); g.lineTo(this.cam.x + W / 2 / z, y); } g.stroke();
    const T = this.T;
    if (T) {
      const N = T.N, ox = T.ox, oy = T.oy;
      const edge = (side, e) => { for (let i = 0; i <= N; i++) { const j = i % N, lat = side * (T.hw[j] + e); const px = T.x[j] - T.ty[j] * lat - ox, py = T.y[j] + T.tx[j] * lat - oy; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.closePath(); };
      g.beginPath(); edge(1, VERGE); edge(-1, VERGE); g.fillStyle = th.verge; g.fill('evenodd');
      g.beginPath(); edge(1, 0); edge(-1, 0); g.fillStyle = th.road; g.fill('evenodd');
      if (T.hasElev || T.hasTun) { g.lineCap = 'round'; for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (!T.elev[i] && !T.tn[i]) continue; g.strokeStyle = T.tn[i] ? 'rgba(122,84,52,0.75)' : `rgba(170,200,240,${0.35 + Math.min(0.4, T.z[i] / 200)})`; g.lineWidth = 2 * (T.hw[i] + 10); g.beginPath(); g.moveTo(T.x[i] - ox, T.y[i] - oy); g.lineTo(T.x[j] - ox, T.y[j] - oy); g.stroke(); } g.lineCap = 'butt'; }
      g.lineWidth = 9; g.strokeStyle = th.wallTop; for (const s of [-1, 1]) { g.beginPath(); for (let i = 0; i <= N; i++) { const j = i % N, lat = s * (T.hw[j] + VERGE + 5); const px = T.x[j] - T.ty[j] * lat - ox, py = T.y[j] + T.tx[j] * lat - oy; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.setLineDash([22, 26]); g.beginPath(); for (let i = 0; i <= N; i++) { const j = i % N; if (i === 0) g.moveTo(T.x[j] - ox, T.y[j] - oy); else g.lineTo(T.x[j] - ox, T.y[j] - oy); } g.stroke(); g.setLineDash([]);
      // start line + direction arrows
      const sx = T.x[0] - ox, sy = T.y[0] - oy, nx = -T.ty[0], ny = T.tx[0]; g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.moveTo(sx + nx * T.hw[0], sy + ny * T.hw[0]); g.lineTo(sx - nx * T.hw[0], sy - ny * T.hw[0]); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 20; i < N; i += 40) { const j = i % N, x = T.x[j] - ox, y = T.y[j] - oy, a = T.ang[j]; g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(26, 0); g.lineTo(-10, -16); g.lineTo(-10, 16); g.fill(); g.restore(); }
    }
    // props & items
    for (const p of this.t.props) { g.fillStyle = ({ pine: '#2f6b33', oak: '#3f7a33', snowpine: '#e8f0f5', palm: '#2f8a3e', cactus: '#3f8a43', rock: '#888', tower: '#566078', building: '#8a8d9b', container: '#c0392b', tank: '#bbb', lamp: '#ffe9a0', mesa: '#c47c50', spire: '#ff7a30' }[p.type]) || '#999'; g.beginPath(); g.arc(p.x, p.y, 24 * (p.s || 1), 0, TAU); g.fill(); g.fillStyle = '#000'; g.font = '700 22px sans-serif'; g.textAlign = 'center'; g.fillText(p.type.slice(0, 3), p.x, p.y + 8); }
    for (const it of this.t.items) { const d = ITEM_TYPES.find(x => x[0] === it.t) || ITEM_TYPES[0]; g.fillStyle = d[1]; g.beginPath(); g.arc(it.x, it.y, 20, 0, TAU); g.fill(); g.fillStyle = '#000'; g.font = '700 24px sans-serif'; g.textAlign = 'center'; g.fillText(d[2], it.x, it.y + 8); }
    // control points
    if (this.tool === 'points' || true) { const P = this.t.pts; g.lineWidth = 3 / z * 1.4; g.strokeStyle = 'rgba(255,200,0,0.35)'; g.beginPath(); P.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.stroke();
      P.forEach((q, i) => { const sel = i === this.sel; g.fillStyle = sel ? '#ff6a1a' : i === 0 ? '#7dff3a' : '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3 / z; g.beginPath(); g.arc(q[0], q[1], (sel ? 15 : 11) / Math.min(z, 1) * Math.min(1, 0.6 + z), 0, TAU); g.fill(); g.stroke(); if (this.cam.z > 0.15) { g.fillStyle = '#000'; g.font = '700 ' + 14 / z * 0.9 + 'px sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 1), q[0], q[1] + 5 / z); } }); }
    // hover ghost
    if (this.hover) { g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2 / z; g.beginPath(); g.arc(this.hover[0], this.hover[1], 18 / z * 0.8, 0, TAU); g.stroke(); }
    if (this.cursor.vis) { g.strokeStyle = '#ff6a1a'; g.lineWidth = 4 / z; const c = this.cursor, r = 30 / z; g.beginPath(); g.moveTo(c.x - r, c.y); g.lineTo(c.x + r, c.y); g.moveTo(c.x, c.y - r); g.lineTo(c.x, c.y + r); g.stroke(); }
    g.restore(); this.stale = false;
  },
};
