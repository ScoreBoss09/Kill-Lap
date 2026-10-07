// Kill Lap server: static files + zero-dependency WebSocket relay + leaderboards + map workshop.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const DATA = process.env.KILLLAP_DATA || path.join(ROOT, 'data');
const PORT = +process.env.PORT || 3000;
fs.mkdirSync(path.join(DATA, 'tracks'), { recursive: true });

/* ------------------------------------------------------------------ persistence */
const LB_FILE = path.join(DATA, 'leaderboard.json');
let LB = { tracks: {}, players: {} };
try { LB = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch {}
LB.tracks ||= {}; LB.players ||= {};
let lbDirty = false;
setInterval(() => { if (lbDirty) { lbDirty = false; fs.writeFile(LB_FILE, JSON.stringify(LB), () => {}); } }, 5000).unref();
const clean = (s, n = 16) => String(s ?? '').replace(/[^\w .\-!?#@$*]/g, '').trim().slice(0, n) || 'Racer';

function trackBoard(id) {
  if (!LB.tracks[id]) {
    if (Object.keys(LB.tracks).length > 600) return null;
    LB.tracks[id] = { laps: [], races: [] };
  }
  return LB.tracks[id];
}
function insertBest(list, entry, max = 30) {
  const i = list.findIndex(e => e.name === entry.name);
  if (i >= 0) { if (list[i].time <= entry.time) return false; list.splice(i, 1); }
  list.push(entry); list.sort((a, b) => a.time - b.time);
  if (list.length > max) list.length = max;
  return true;
}
function player(name) {
  return (LB.players[name] ||= { name, wins: 0, races: 0, kills: 0, deaths: 0, podiums: 0, laps: 0, dist: 0 });
}

/* ------------------------------------------------------------------ HTTP */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const AUDIO_EXT = /\.(ogg|mp3|wav|m4a|flac)$/i;

function sendJSON(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(b);
}
function readBody(req, limit = 120000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function validTrack(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.pts) || t.pts.length < 4 || t.pts.length > 160) return false;
  for (const p of t.pts) if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 20000 || Math.abs(p[1]) > 20000) return false;
  return true;
}
const rate = new Map();
function limited(ip, key, per, max) {
  const k = ip + key, now = Date.now(); const r = rate.get(k) || [];
  const rr = r.filter(t => now - t < per); rr.push(now); rate.set(k, rr);
  return rr.length > max;
}
setInterval(() => rate.clear(), 600000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress;
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      if (url.pathname === '/api/ping') return sendJSON(res, 200, { ok: true, name: 'Kill Lap', time: Date.now(), players: clients.size });
      if (url.pathname === '/api/audio') {
        const dir = path.join(PUB, 'assets', 'audio');
        let files = []; try { files = fs.readdirSync(dir).filter(f => AUDIO_EXT.test(f)); } catch {}
        return sendJSON(res, 200, { files });
      }
      if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
        const id = url.searchParams.get('track');
        if (id) return sendJSON(res, 200, LB.tracks[id] || { laps: [], races: [] });
        return sendJSON(res, 200, { tracks: Object.fromEntries(Object.entries(LB.tracks).map(([k, v]) => [k, { lap: v.laps[0] || null, race: v.races[0] || null }])) });
      }
      if (url.pathname === '/api/players' && req.method === 'GET') {
        const by = ['wins', 'kills', 'races', 'podiums', 'laps'].includes(url.searchParams.get('by')) ? url.searchParams.get('by') : 'wins';
        const list = Object.values(LB.players).sort((a, b) => b[by] - a[by]).slice(0, 50);
        return sendJSON(res, 200, { by, players: list });
      }
      if (url.pathname === '/api/submit' && req.method === 'POST') {
        if (limited(ip, 'submit', 60000, 40)) return sendJSON(res, 429, { error: 'slow down' });
        const b = await readBody(req, 8000);
        const id = String(b.track || '').slice(0, 64);
        if (!id) return sendJSON(res, 400, { error: 'track' });
        const len = Math.max(500, +b.trackLen || 0);
        const name = clean(b.name);
        const board = trackBoard(id);
        if (!board) return sendJSON(res, 400, { error: 'full' });
        const out = {};
        const minLap = len / 760; // nothing in the game can sustain more than this
        if (isFinite(b.lap) && b.lap > Math.max(5, minLap) && b.lap < 900) {
          out.lapRecord = insertBest(board.laps, { name, time: +(+b.lap).toFixed(3), car: clean(b.car, 12), date: Date.now() });
          out.lapRank = board.laps.findIndex(e => e.name === name) + 1;
        }
        if (isFinite(b.race) && b.race > Math.max(10, minLap * (+b.laps || 3)) && b.race < 3600 && (+b.laps || 3) >= 3) {
          out.raceRecord = insertBest(board.races, { name, time: +(+b.race).toFixed(3), car: clean(b.car, 12), laps: +b.laps || 3, date: Date.now() });
        }
        lbDirty = true;
        return sendJSON(res, 200, out);
      }
      if (url.pathname === '/api/tracks' && req.method === 'GET') {
        const list = [];
        for (const f of fs.readdirSync(path.join(DATA, 'tracks'))) {
          if (!f.endsWith('.json')) continue;
          try { const t = JSON.parse(fs.readFileSync(path.join(DATA, 'tracks', f), 'utf8')); list.push({ id: t.id, name: t.name, author: t.author, theme: t.theme, date: t.published, plays: t.plays || 0 }); } catch {}
        }
        list.sort((a, b) => b.date - a.date);
        return sendJSON(res, 200, { tracks: list.slice(0, 200) });
      }
      let m;
      if ((m = url.pathname.match(/^\/api\/tracks\/([\w-]{6,40})$/)) && req.method === 'GET') {
        const f = path.join(DATA, 'tracks', m[1] + '.json');
        if (!fs.existsSync(f)) return sendJSON(res, 404, { error: 'not found' });
        return sendJSON(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (url.pathname === '/api/tracks' && req.method === 'POST') {
        if (limited(ip, 'pub', 3600000, 20)) return sendJSON(res, 429, { error: 'publish limit reached, try later' });
        const b = await readBody(req);
        if (!validTrack(b)) return sendJSON(res, 400, { error: 'invalid track' });
        const body = JSON.stringify(b.pts) + JSON.stringify(b.items || []);
        const id = 'w' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 10);
        const t = { ...b, id, name: clean(b.name, 28), author: clean(b.author), published: Date.now() };
        fs.writeFileSync(path.join(DATA, 'tracks', id + '.json'), JSON.stringify(t));
        return sendJSON(res, 200, { id });
      }
      return sendJSON(res, 404, { error: 'unknown endpoint' });
    }
    // static
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(PUB, p));
    if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.stat(f, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
    });
  } catch (e) {
    try { sendJSON(res, 400, { error: String(e.message || e) }); } catch {}
  }
});

/* ------------------------------------------------------------------ minimal RFC6455 WebSocket */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 400 * 1024;
class WS {
  constructor(socket) {
    this.s = socket; this.buf = Buffer.alloc(0); this.open = true; this.frag = null;
    this.onmessage = null; this.onclose = null;
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); try { this.parse(); } catch { this.close(); } });
    socket.on('close', () => this.dead()); socket.on('error', () => this.dead());
    socket.setNoDelay(true);
  }
  dead() { if (this.open) { this.open = false; this.onclose && this.onclose(); } }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0xf, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD) return this.close();
      const need = off + (masked ? 4 : 0) + len; if (b.length < need) return;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const k = b.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= k[i & 3]; }
      this.buf = b.subarray(need);
      if (op === 8) return this.close();
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) { this.frag = { op, parts: [payload] }; } else if (op === 0 && this.frag) this.frag.parts.push(payload);
      if (fin && this.frag) { const m = Buffer.concat(this.frag.parts); this.frag = null; this.onmessage && this.onmessage(m.toString('utf8')); }
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length; let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    if (this.s.writableLength > 2e6) return; // drop for slow clients
    this.s.write(Buffer.concat([h, payload]));
  }
  send(str) { this.frame(1, Buffer.from(str)); }
  close() { if (this.open) { try { this.frame(8, Buffer.alloc(0)); this.s.end(); } catch {} this.dead(); } }
}
server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  onConnect(new WS(socket), req);
});

/* ------------------------------------------------------------------ lobby / rooms */
const clients = new Map(); // id -> client
const rooms = new Map();   // id -> room
let nextId = 1, nextRoom = 1;
const BOT_NAMES = ['Rusty', 'Viper', 'Mad Dog', 'Sledge', 'Hex', 'Blitz', 'Havoc', 'Grim', 'Nitro Nancy', 'Scrap', 'Bones', 'Vandal'];

const send = (c, o) => c.ws.open && c.ws.send(JSON.stringify(o));
function roomInfo(r) {
  return { id: r.id, name: r.name, track: r.track, trackName: r.trackName, laps: r.laps, host: r.host, state: r.state, max: r.max, bots: r.bots, upg: r.upg, diff: r.diff, pw: !!r.pw, weapons: r.weapons,
    players: r.members.map(c => ({ id: c.id, name: c.name, car: c.car, ready: c.ready, ping: c.ping })) };
}
function lobbyList() {
  return [...rooms.values()].filter(r => !r.hidden).map(r => ({ id: r.id, name: r.name, trackName: r.trackName, laps: r.laps, state: r.state, n: r.members.length, max: r.max, bots: r.bots, pw: !!r.pw }));
}
function broadcastLobby() {
  const l = lobbyList();
  for (const c of clients.values()) if (!c.room) send(c, { t: 'rooms', rooms: l, online: clients.size });
}
function toRoom(r, o, except) { const s = JSON.stringify(o); for (const c of r.members) if (c !== except && c.ws.open) c.ws.send(s); }
function pushRoom(r) { toRoom(r, { t: 'room', room: roomInfo(r) }); broadcastLobby(); }
function leaveRoom(c) {
  const r = c.room; if (!r) return;
  c.room = null; c.ready = false;
  r.members = r.members.filter(m => m !== c);
  if (!r.members.length) { rooms.delete(r.id); }
  else {
    if (r.host === c.id) r.host = r.members[0].id;
    toRoom(r, { t: 'left', id: c.id });
    if (r.state === 'racing') { r.results = r.results.filter(x => x.id !== c.id); checkRaceEnd(r); }
    pushRoom(r);
  }
  broadcastLobby();
}
function checkRaceEnd(r) {
  if (r.state !== 'racing') return;
  const racers = r.members.length;
  if (r.results.length >= racers || (r.firstFinish && Date.now() - r.firstFinish > 45000 && r.results.length > 0)) endRace(r);
}
function endRace(r) {
  if (r.state !== 'racing') return;
  r.state = 'lobby';
  clearTimeout(r.timer);
  const res = r.results.slice().sort((a, b) => a.time - b.time);
  // anyone who did not finish is appended using their reported progress
  const lastKnown = r.members.filter(m => !res.find(x => x.id === m.id)).map(m => ({ id: m.id, name: m.name, time: null, prog: m.prog || 0, kills: m.kills || 0, dnf: true })).sort((a, b) => b.prog - a.prog);
  const final = res.concat(lastKnown);
  final.forEach((x, i) => { x.place = i + 1; });
  const humans = final.length;
  for (const x of final) {
    const p = player(x.name); p.races++; p.kills += x.kills || 0;
    if (!x.dnf && humans > 1) { if (x.place === 1) p.wins++; if (x.place <= 3) p.podiums++; }
  }
  if (r.trackId && !r.custom) {
    const board = trackBoard(r.trackId);
    if (board && r.laps >= 3) for (const x of final) if (!x.dnf && x.time > 10) insertBest(board.races, { name: x.name, time: x.time, car: x.car || '', laps: r.laps, date: Date.now() });
  }
  lbDirty = true;
  for (const m of r.members) m.ready = false;
  toRoom(r, { t: 'results', results: final });
  pushRoom(r);
}

function onConnect(ws, req) {
  const c = { id: 'p' + nextId++, ws, name: 'Racer', car: 'scrapper', room: null, ready: false, ping: 0, ip: req.socket.remoteAddress, lastChat: 0, upg: {} };
  clients.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, rooms: lobbyList(), online: clients.size });
  ws.onclose = () => { leaveRoom(c); clients.delete(c.id); broadcastLobby(); };
  let bucket = 0, bucketT = Date.now();
  ws.onmessage = raw => {
    const now0 = Date.now(); if (now0 - bucketT > 1000) { bucket = 0; bucketT = now0; } if (++bucket > 150) { if (bucket === 151) ws.close(); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    const r = c.room;
    switch (m.t) {
      case 'hello': c.name = clean(m.name); c.car = clean(m.car, 16); c.upg = m.upg && typeof m.upg === 'object' ? m.upg : {}; break;
      case 'ping': send(c, { t: 'pong', s: m.s }); c.ping = +m.p || 0; break;
      case 'create': {
        if (c.room) leaveRoom(c);
        const id = 'r' + nextRoom++;
        const room = { id, name: clean(m.name, 24) || c.name + "'s race", track: String(m.track || 'dustbowl').slice(0, 64), trackName: clean(m.trackName, 28), trackData: validTrack(m.trackData) ? m.trackData : null, trackId: String(m.trackId || m.track || '').slice(0, 64),
          custom: !!m.trackData, laps: Math.max(1, Math.min(20, m.laps | 0 || 3)), max: Math.max(2, Math.min(12, m.max | 0 || 8)), bots: Math.max(0, Math.min(11, m.bots | 0)),
          upg: !!m.upg, diff: Math.max(0, Math.min(3, m.diff | 0)), weapons: m.weapons !== false, pw: String(m.pw || '').slice(0, 16), host: c.id, members: [], state: 'lobby', results: [], hidden: !!m.hidden };
        rooms.set(id, room); room.members.push(c); c.room = room; c.ready = false;
        send(c, { t: 'joined', room: roomInfo(room), trackData: room.trackData });
        broadcastLobby();
        break;
      }
      case 'join': {
        const room = rooms.get(m.room);
        if (!room) return send(c, { t: 'error', msg: 'Room no longer exists' });
        if (room.state !== 'lobby') return send(c, { t: 'error', msg: 'Race already in progress' });
        if (room.members.length + 0 >= room.max) return send(c, { t: 'error', msg: 'Room is full' });
        if (room.pw && room.pw !== String(m.pw || '')) return send(c, { t: 'error', msg: 'Wrong password' });
        if (c.room) leaveRoom(c);
        room.members.push(c); c.room = room; c.ready = false;
        send(c, { t: 'joined', room: roomInfo(room), trackData: room.trackData });
        toRoom(room, { t: 'chat', from: '*', text: c.name + ' joined' });
        pushRoom(room);
        break;
      }
      case 'leave': leaveRoom(c); send(c, { t: 'rooms', rooms: lobbyList(), online: clients.size }); break;
      case 'ready': if (r && r.state === 'lobby') { c.ready = !!m.v; pushRoom(r); } break;
      case 'car': c.car = clean(m.car, 16); c.upg = m.upg && typeof m.upg === 'object' ? m.upg : {}; if (r) pushRoom(r); break;
      case 'cfg': // host changes settings
        if (r && r.host === c.id && r.state === 'lobby') {
          if (m.track) { r.track = String(m.track).slice(0, 64); r.trackId = r.track; r.trackName = clean(m.trackName, 28); r.trackData = validTrack(m.trackData) ? m.trackData : null; r.custom = !!r.trackData; }
          if (m.laps) r.laps = Math.max(1, Math.min(20, m.laps | 0));
          if (m.bots != null) r.bots = Math.max(0, Math.min(r.max - 1, m.bots | 0));
          if (m.upg != null) r.upg = !!m.upg;
          if (m.diff != null) r.diff = Math.max(0, Math.min(3, m.diff | 0));
          if (m.weapons != null) r.weapons = !!m.weapons;
          for (const x of r.members) x.ready = false;
          toRoom(r, { t: 'trackData', trackData: r.trackData });
          pushRoom(r);
        }
        break;
      case 'chat': {
        const now = Date.now(); if (now - c.lastChat < 400) break; c.lastChat = now;
        const text = String(m.text || '').slice(0, 160).replace(/[\u0000-\u001f]/g, '');
        if (text) { if (r) toRoom(r, { t: 'chat', from: c.name, text }); else for (const o of clients.values()) if (!o.room) send(o, { t: 'chat', from: c.name, text }); }
        break;
      }
      case 'start':
        if (r && r.host === c.id && r.state === 'lobby') {
          if (r.members.some(x => x.id !== c.id && !x.ready)) return send(c, { t: 'error', msg: 'Not everyone is ready' });
          r.state = 'racing'; r.results = []; r.firstFinish = 0;
          const bots = []; for (let i = 0; i < r.bots; i++) bots.push({ id: 'b' + i, name: BOT_NAMES[i % BOT_NAMES.length], car: ['scrapper', 'hornet', 'bruiser', 'phantom', 'reaper', 'warlord'][(i + r.diff * 2) % 6] });
          const roster = r.members.map(x => ({ id: x.id, name: x.name, car: x.car, upg: r.upg ? x.upg : {} }));
          for (const x of r.members) { x.prog = 0; x.kills = 0; }
          toRoom(r, { t: 'start', roster, bots, seed: (Math.random() * 1e9) | 0, room: roomInfo(r) });
          clearTimeout(r.timer); r.timer = setTimeout(() => endRace(r), 25 * 60 * 1000);
          broadcastLobby();
        }
        break;
      case 'st': // car state relay (unreliable-ish)
        if (r && r.state === 'racing') { c.prog = +m.prog || c.prog; c.kills = m.kills != null ? m.kills | 0 : c.kills; toRoom(r, { t: 'st', f: c.id, cars: m.cars }, c); }
        break;
      case 'ev': if (r && r.state === 'racing') toRoom(r, { t: 'ev', f: c.id, e: m.e }, c); break;
      case 'fin':
        if (r && r.state === 'racing' && !r.results.find(x => x.id === c.id) && isFinite(m.time)) {
          r.results.push({ id: c.id, name: c.name, car: clean(m.car, 12), time: +m.time, best: +m.best || 0, kills: m.kills | 0 });
          if (!r.firstFinish) r.firstFinish = Date.now();
          toRoom(r, { t: 'fin', id: c.id, name: c.name, time: +m.time });
          if (m.best > 5 && r.trackId && !r.custom) { const b = trackBoard(r.trackId); if (b) { insertBest(b.laps, { name: c.name, time: +(+m.best).toFixed(3), car: clean(m.car, 12), date: Date.now() }); lbDirty = true; } }
          checkRaceEnd(r);
        }
        break;
      case 'racedone': break;
    }
  };
}
setInterval(() => { for (const r of rooms.values()) if (r.state === 'racing') checkRaceEnd(r); }, 3000).unref();

server.listen(PORT, () => {
  console.log(`\n  KILL LAP server running\n  -> open http://localhost:${PORT}\n  Friends on your network: http://<your-ip>:${PORT}\n`);
});
