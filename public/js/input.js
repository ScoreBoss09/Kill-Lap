// Keyboard + gamepad input. Drive state is polled each frame; menu navigation emits events (works with both devices).
import { clamp } from './util.js';

export const ACTIONS = [
  { id: 'throttle', label: 'Accelerate',   keys: ['KeyW', 'ArrowUp'],    pad: 'RT / A-stick up' },
  { id: 'brake',    label: 'Brake / Reverse', keys: ['KeyS', 'ArrowDown'], pad: 'LT' },
  { id: 'left',     label: 'Steer left',   keys: ['KeyA', 'ArrowLeft'],  pad: 'Left stick / D-pad' },
  { id: 'right',    label: 'Steer right',  keys: ['KeyD', 'ArrowRight'], pad: 'Left stick / D-pad' },
  { id: 'fire',     label: 'Machine gun',  keys: ['Space'],              pad: 'A' },
  { id: 'rocket',   label: 'Rocket',       keys: ['KeyE', 'ControlLeft'], pad: 'X' },
  { id: 'mine',     label: 'Drop mine',    keys: ['KeyF', 'AltLeft'],    pad: 'B' },
  { id: 'nitro',    label: 'Nitro boost',  keys: ['ShiftLeft', 'ShiftRight'], pad: 'Y' },
  { id: 'special',  label: 'Special weapon (missiles / cluster)', keys: ['KeyG', 'ControlRight'], pad: 'D-pad up' },
  { id: 'cycle',    label: 'Switch special weapon', keys: ['KeyQ'], pad: 'D-pad down' },
  { id: 'hb',       label: 'Handbrake',    keys: ['KeyC', 'KeyX'],       pad: 'RB' },
  { id: 'reset',    label: 'Respawn on track', keys: ['KeyR'],           pad: 'LB (hold)' },
  { id: 'scores',   label: 'Scoreboard',   keys: ['Tab'],                pad: 'Back / View' },
  { id: 'pause',    label: 'Pause',        keys: ['Escape', 'KeyP'],     pad: 'Start' },
];

const Input = {
  keys: new Set(), pressedEdge: new Set(), binds: {}, deadzone: 0.14, sens: 1.0, lastDevice: 'kb', pad: null, padName: '',
  drive: { steer: 0, throttle: 0, brake: 0, hb: false, fire: false, rocket: false, mine: false, nitro: false, special: false, cycleEdge: false, reset: false, scores: false },
  navListeners: new Set(), padPrev: {}, repeat: {}, rumbleOn: true, enabled: true,
};
export default Input;

Input.setBinds = function (b) { this.binds = b || {}; };
Input.keysFor = function (id) { const a = ACTIONS.find(x => x.id === id); return this.binds[id] ? [this.binds[id], ...a.keys.slice(1)] : a.keys; };
Input.down = function (id) { for (const k of this.keysFor(id)) if (this.keys.has(k)) return true; return false; };
Input.isTyping = () => { const e = document.activeElement; return e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT'); };

window.addEventListener('keydown', e => {
  if (Input.isTyping() && e.code !== 'Escape') return;
  Input.lastDevice = 'kb';
  if (!e.repeat) Input.pressedEdge.add(e.code);
  Input.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && Input.enabled && !Input.isTyping()) e.preventDefault();
});
window.addEventListener('keyup', e => Input.keys.delete(e.code));
window.addEventListener('blur', () => Input.keys.clear());
window.addEventListener('gamepadconnected', e => { Input.lastDevice = 'pad'; Input.padName = e.gamepad.id; });

Input.edge = function (id) { for (const k of this.keysFor(id)) if (this.pressedEdge.has(k)) return true; return false; };
Input.getPad = function () {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; let best = null;
  for (const p of pads) if (p && p.connected) { if (!best || p.mapping === 'standard') best = p; }
  this.pad = best; if (best) this.padName = best.id; return best;
};
const dz = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d));

/** Call once per frame (before game update). */
Input.update = function (dt) {
  const p = this.getPad(), d = this.drive, K = id => this.down(id);
  let steer = (K('right') ? 1 : 0) - (K('left') ? 1 : 0), thr = K('throttle') ? 1 : 0, brk = K('brake') ? 1 : 0;
  let hb = K('hb'), fire = K('fire'), rocket = K('rocket'), mine = K('mine'), nitro = K('nitro'), reset = K('reset'), scores = K('scores'), special = K('special');
  // smooth keyboard steering
  d._ks = d._ks || 0; const target = steer; d._ks += clamp(target - d._ks, -dt * (target === 0 ? 9 : 6.5), dt * (target === 0 ? 9 : 6.5)); steer = d._ks;
  const btn = i => !!(p && p.buttons[i] && p.buttons[i].pressed), val = i => (p && p.buttons[i] ? p.buttons[i].value : 0);
  const edges = {};
  if (p) {
    const ax = dz(p.axes[0] || 0, this.deadzone), ay = dz(p.axes[1] || 0, this.deadzone);
    const padSteer = Math.sign(ax) * Math.pow(Math.abs(ax), 1.35) * this.sens + (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
    const padThr = Math.max(val(7), btn(0) && false ? 1 : 0, ay < -0.5 ? 1 : 0), padBrk = Math.max(val(6), ay > 0.5 ? 1 : 0);
    let used = false;
    if (Math.abs(padSteer) > 0.01 || padThr > 0.05 || padBrk > 0.05 || btn(0) || btn(1) || btn(2) || btn(3) || btn(4) || btn(5)) { used = true; if (this.lastDevice !== 'pad') this.lastDevice = 'pad'; }
    if (used) {
      steer = clamp(Math.abs(padSteer) > Math.abs(steer) ? padSteer : steer, -1, 1);
      thr = Math.max(thr, padThr); brk = Math.max(brk, padBrk);
      special = special || btn(12); fire = fire || btn(0); mine = mine || btn(1); rocket = rocket || btn(2); nitro = nitro || btn(3); hb = hb || btn(5); reset = reset || btn(4); scores = scores || btn(8);
    }
    // button edges for menus
    const now = { ok: btn(0), back: btn(1), x: btn(2), y: btn(3), start: btn(9), up: btn(12) || ay < -0.6, down: btn(13) || ay > 0.6, left: btn(14) || ax < -0.6, right: btn(15) || ax > 0.6, lb: btn(4), rb: btn(5), dpadDown: btn(13) };
    for (const k in now) {
      const was = this.padPrev[k]; let fireEv = false;
      if (now[k] && !was) { fireEv = true; this.repeat[k] = 0.4; }
      else if (now[k] && ['up', 'down', 'left', 'right'].includes(k)) { this.repeat[k] -= dt; if (this.repeat[k] <= 0) { fireEv = true; this.repeat[k] = 0.11; } }
      if (fireEv) { this.lastDevice = 'pad'; edges[k] = true; }
      this.padPrev[k] = now[k];
    }
  }
  d.steer = steer; d.throttle = thr; d.brake = brk; d.hb = hb; d.fire = fire; d.rocket = rocket; d.mine = mine; d.nitro = nitro; d.reset = reset; d.scores = scores;
  d.special = special; d.cycleEdge = this.edge('cycle') || !!edges.dpadDown;
  d.pauseEdge = this.edge('pause') || !!edges.start;
  d.nitroEdge = this.edge('nitro') || !!(p && edges.y);
  for (const k in edges) for (const f of this.navListeners) f(k);
};
Input.endFrame = function () { this.pressedEdge.clear(); };
Input.rumble = function (strong, weak, ms = 120) {
  if (!this.rumbleOn || !this.pad) return;
  const a = this.pad.vibrationActuator; if (a && a.playEffect) { try { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }); } catch {} }
};
