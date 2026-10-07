// WebSocket client + REST helpers for the Kill Lap server.
import Store from './storage.js';

export function serverBase() {
  const custom = (Store.d.server || '').trim();
  if (!custom) return { http: location.origin, ws: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws' };
  let h = custom.replace(/\/+$/, ''); if (!/^(https?|wss?):\/\//.test(h)) h = 'http://' + h;
  const u = new URL(h.replace(/^ws/, 'http'));
  return { http: u.origin, ws: (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws' };
}
export async function api(path, body, timeout = 5000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(serverBase().http + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
  } finally { clearTimeout(t); }
}

class Net {
  constructor() { this.ws = null; this.handlers = new Map(); this.id = null; this.state = 'closed'; this.ping = 0; this._pt = null; this.queue = []; }
  on(type, fn) { this.handlers.set(type, fn); return this; }
  off(type) { this.handlers.delete(type); }
  get open() { return this.ws && this.ws.readyState === 1; }
  connect() {
    return new Promise((resolve, reject) => {
      this.close(); const url = serverBase().ws; this.state = 'connecting';
      let ws; try { ws = new WebSocket(url); } catch (e) { this.state = 'closed'; return reject(e); }
      this.ws = ws; const timer = setTimeout(() => { if (ws.readyState !== 1) { try { ws.close(); } catch {} reject(new Error('Connection timed out')); } }, 6000);
      ws.onopen = () => { clearTimeout(timer); this.state = 'open'; this._startPing(); };
      ws.onerror = () => { clearTimeout(timer); if (this.state === 'connecting') { this.state = 'closed'; reject(new Error('Could not reach server')); } };
      ws.onclose = () => { clearTimeout(timer); const was = this.state; this.state = 'closed'; clearInterval(this._pt); this.id = null; const h = this.handlers.get('_close'); if (h) h(was); };
      let first = true;
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.id = m.id; if (first) { first = false; resolve(m); } }
        if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.s); return; }
        const h = this.handlers.get(m.t); if (h) h(m); const all = this.handlers.get('*'); if (all) all(m);
      };
    });
  }
  _startPing() { clearInterval(this._pt); this._pt = setInterval(() => this.send({ t: 'ping', s: performance.now(), p: this.ping }), 2000); }
  send(o) { if (this.open) this.ws.send(JSON.stringify(o)); }
  close() { clearInterval(this._pt); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch {} } this.state = 'closed'; this.id = null; }
}
export default new Net();
