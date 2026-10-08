// Tiled, lazily-baked terrain renderer. Tiles are drawn from the vector track description on demand,
// so very large worlds cost only the memory of tiles the cars actually visit. Skid marks / scorch marks
// are stamped straight into the tiles.
import { VERGE, pointAt, shoreWob } from './tracks.js';
import { View, drawProp } from './sprites.js';
import { makeVis, drawWalls, drawDecks, drawDeckShadows, drawTunnels } from './structures.js';
import { mulberry32, shade, rgba, TAU, hashStr } from './util.js';
import Tex from './textures.js';

export const TS = 512;
/** props that animate (drawn every frame) or lie flat on the ground (baked into the ground layer, under the cars) */
export const DYNAMIC = new Set(['lava']);
const FLAT = new Set(['crater', 'dune']);
const noiseCache = {};
function noisePattern(ctx, kind) {
  let c = noiseCache[kind];
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const id = g.createImageData(256, 256); const r = mulberry32(kind === 'dark' ? 7 : kind === 'light' ? 13 : 29);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = r();
      if (kind === 'dark') { id.data[i] = id.data[i + 1] = id.data[i + 2] = 0; id.data[i + 3] = v < 0.5 ? 0 : v * 46; }
      else if (kind === 'light') { id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v < 0.6 ? 0 : v * 34; }
      else { const g2 = 120 + r() * 100; id.data[i] = id.data[i + 1] = id.data[i + 2] = g2; id.data[i + 3] = v > 0.93 ? 70 : 0; }
    }
    g.putImageData(id, 0, 0); noiseCache[kind] = c;
  }
  return ctx.createPattern(c, 'repeat');
}

export class Ground {
  constructor(T, quality = 2) {
    this.T = T; this.q = quality; this.tiles = new Map(); this.queue = []; this.pend = new Map();
    this.res = quality >= 2 ? 1 : quality >= 1 ? 0.75 : 0.5; // lower quality bakes the terrain at lower resolution (less memory and fill)
    this.maxTiles = quality >= 2 ? 150 : 200; this.cx = 0; this.cy = 0; // keep the whole map baked so nothing is rebuilt mid-race (rebuilding while flying along on nitro caused stutters)
    this.cols = Math.ceil(T.W / TS); this.rows = Math.ceil(T.H / TS);
    this.px = null; this.over = new Map(); // second, transparent tile layer: flyovers, tunnel hills and scenery (drawn above ground-level cars)
    this.pgrid = new Map(); for (const p of T.props) { if (DYNAMIC.has(p.type)) continue; const k = this.key(Math.floor(p.x / TS), Math.floor(p.y / TS)); (this.pgrid.get(k) || this.pgrid.set(k, []).get(k)).push(p); }
  }
  key(tx, ty) { return tx + ty * 1000; }
  /** drop the baked tiles farthest from the camera */
  evict() {
    const arr = [...this.tiles.keys()].map(k => { const tx = k % 1000, ty = Math.floor(k / 1000); return [k, Math.hypot((tx + 0.5) * TS - this.cx, (ty + 0.5) * TS - this.cy)]; }).sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < arr.length && this.tiles.size > this.maxTiles - 8; i++) if (arr[i][1] > 2200) { this.tiles.delete(arr[i][0]); this.over.delete(arr[i][0]); this.pend.delete(arr[i][0]); }
  }
  has(tx, ty) { return this.tiles.has(this.key(tx, ty)); }
  /** returns tile canvas, baking it if needed */
  tile(tx, ty) {
    const k = this.key(tx, ty); let t = this.tiles.get(k);
    if (!t) { t = document.createElement('canvas'); t.width = t.height = Math.round(TS * this.res); this.bake(t, tx * TS, ty * TS); this.tiles.set(k, t); this.over.set(k, this.bakeOverlay(tx, ty)); if (this.tiles.size > this.maxTiles) this.evict(); }
    return t;
  }
  /** background baking: tiles along the track first (from the start line), then the rest; stops after `budgetMs` */
  prebake(budgetMs) {
    if (this.allBaked || this.tiles.size >= this.maxTiles - 10) return; const T = this.T;
    if (!this.order) { const seen = new Set(), o = []; const addT = (tx, ty) => { if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return; const k = this.key(tx, ty); if (!seen.has(k)) { seen.add(k); o.push([tx, ty]); } };
      for (let i = 0; i < T.N; i += 6) { const tx = Math.floor(T.x[i] / TS), ty = Math.floor(T.y[i] / TS); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) addT(tx + a, ty + b); }
      for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.cols; tx++) addT(tx, ty); this.order = o; this.oi = 0; }
    const t0 = performance.now();
    while (this.oi < this.order.length && performance.now() - t0 < budgetMs) { const [tx, ty] = this.order[this.oi++]; if (!this.has(tx, ty)) this.tile(tx, ty); }
    if (this.oi >= this.order.length) this.allBaked = true;
  }
  /** bake at most `max` missing tiles overlapping [x0..x1]x[y0..y1] */
  ensure(x0, y0, x1, y1, max = 2) {
    let n = 0;
    const tx0 = Math.max(0, Math.floor(x0 / TS)), tx1 = Math.min(this.cols - 1, Math.floor(x1 / TS)), ty0 = Math.max(0, Math.floor(y0 / TS)), ty1 = Math.min(this.rows - 1, Math.floor(y1 / TS));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!this.has(tx, ty)) { if (n >= max) return false; this.tile(tx, ty); n++; }
    return true;
  }
  draw(ctx, camX, camY, zoom, W, H) {
    this.cx = camX; this.cy = camY; const th = this.T.th; ctx.fillStyle = th.ground2; ctx.fillRect(0, 0, W, H);
    this.blit(ctx, camX, camY, zoom, W, H, (tx, ty) => this.tile(tx, ty));
  }
  /** draw the scenery/flyover layer; `holes` (screen-space Path2D) are drawn see-through (the tunnel you're in) */
  drawOverlay(ctx, camX, camY, zoom, W, H, holes) {
    const get = (tx, ty) => { const k = this.key(tx, ty); if (!this.over.has(k)) this.tile(tx, ty); return this.over.get(k); };
    if (!holes) { this.blit(ctx, camX, camY, zoom, W, H, get); return; }
    ctx.save(); const outside = new Path2D(); outside.rect(0, 0, W, H); outside.addPath(holes); ctx.clip(outside, 'evenodd'); this.blit(ctx, camX, camY, zoom, W, H, get); ctx.restore();
    ctx.save(); ctx.clip(holes); ctx.globalAlpha = 0.32; this.blit(ctx, camX, camY, zoom, W, H, get); ctx.restore();
  }
  /** tiles are placed on a shared integer grid so neighbours always meet exactly (no seams, no 1px jitter) */
  blit(ctx, camX, camY, zoom, W, H, get) {
    const vw = W / zoom, vh = H / zoom, x0 = camX - vw / 2, y0 = camY - vh / 2;
    const tx0 = Math.max(0, Math.floor(x0 / TS)), tx1 = Math.min(this.cols - 1, Math.floor((x0 + vw) / TS)), ty0 = Math.max(0, Math.floor(y0 / TS)), ty1 = Math.min(this.rows - 1, Math.floor((y0 + vh) / TS));
    const X = tx => Math.round((tx * TS - x0) * zoom), Y = ty => Math.round((ty * TS - y0) * zoom);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const t = get(tx, ty); if (!t) continue; const x = X(tx), y = Y(ty); ctx.drawImage(t, x, y, X(tx + 1) - x, Y(ty + 1) - y); }
  }
  /** a View that maps world coordinates onto one tile's canvas (same projection as the screen, so baked 3D lines up) */
  tileView(ox, oy) { const v = new View(); v.x = ox + TS / 2; v.y = oy + TS / 2; v.zoom = this.res; v.W = v.H = TS * this.res; v.quality = this.q; v.t = 0; return v; }
  propsNear(ox, oy, pad, padS) {
    const out = []; for (let ty = Math.floor((oy - pad) / TS); ty <= Math.floor((oy + TS + padS) / TS); ty++) for (let tx = Math.floor((ox - pad) / TS); tx <= Math.floor((ox + TS + pad) / TS); tx++) { const l = this.pgrid.get(this.key(tx, ty)); if (l) for (const p of l) if (p.x > ox - pad && p.x < ox + TS + pad && p.y > oy - pad && p.y < oy + TS + padS) out.push(p); }
    return out.sort((a, b) => a.y - b.y);
  }
  bakeOverlay(tx, ty) {
    const T = this.T, ox = tx * TS, oy = ty * TS, tv = this.tileView(ox, oy), vis = makeVis(T, tv);
    const props = this.propsNear(ox, oy, 280, 280 + 360).filter(p => !FLAT.has(p.type)), deck = T.hasElev && vis.some(i => T.elev[i]), tun = T.hasTun && vis.some(i => T.tn[i]);
    if (!props.length && !deck && !tun) return null;
    const c = document.createElement('canvas'); c.width = c.height = Math.round(TS * this.res); const g = c.getContext('2d');
    if (deck) drawDecks(g, tv, T, vis); if (tun) drawTunnels(g, tv, T, vis, -1);
    for (const p of props) drawProp(g, tv, p, T.th, 0);
    if (T.th.night) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(4,6,22,0.5)'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; }
    return c;
  }
  /* ---- decals ---- */
  /** skid marks are queued and painted into the terrain a few times a second in one batched stroke per tile
   *  (painting into a tile every physics step forces the GPU to re-upload it, which was a big slowdown) */
  line(x0, y0, x1, y1, width, color, alpha) {
    const minx = Math.min(x0, x1) - width, maxx = Math.max(x0, x1) + width, miny = Math.min(y0, y1) - width, maxy = Math.max(y0, y1) + width;
    for (let ty = Math.floor(miny / TS); ty <= Math.floor(maxy / TS); ty++) for (let tx = Math.floor(minx / TS); tx <= Math.floor(maxx / TS); tx++) {
      const k = this.key(tx, ty); if (!this.tiles.has(k)) continue;
      let p = this.pend.get(k); if (!p) this.pend.set(k, p = new Map()); const sk = color + '|' + width + '|' + (Math.round(alpha * 10) / 10);
      let l = p.get(sk); if (!l) p.set(sk, l = []); l.push(x0 - tx * TS, y0 - ty * TS, x1 - tx * TS, y1 - ty * TS);
    }
  }
  flush() {
    for (const [k, p] of this.pend) {
      const t = this.tiles.get(k); if (!t) continue; const g = t.getContext('2d'); g.lineCap = 'round';
      for (const [sk, l] of p) { const [color, width, alpha] = sk.split('|'); g.globalAlpha = +alpha; g.strokeStyle = color; g.lineWidth = +width * this.res; g.beginPath(); for (let i = 0; i < l.length; i += 4) { g.moveTo(l[i] * this.res, l[i + 1] * this.res); g.lineTo(l[i + 2] * this.res, l[i + 3] * this.res); } g.stroke(); }
      g.globalAlpha = 1;
    }
    this.pend.clear();
  }
  blot(x, y, r, color, alpha) {
    for (let ty = Math.floor((y - r) / TS); ty <= Math.floor((y + r) / TS); ty++) for (let tx = Math.floor((x - r) / TS); tx <= Math.floor((x + r) / TS); tx++) {
      const t = this.tiles.get(this.key(tx, ty)); if (!t) continue;
      const g = t.getContext('2d'); g.setTransform(this.res, 0, 0, this.res, 0, 0); const gr = g.createRadialGradient(x - tx * TS, y - ty * TS, 0, x - tx * TS, y - ty * TS, r);
      gr.addColorStop(0, rgba(color, alpha)); gr.addColorStop(1, rgba(color, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x - tx * TS, y - ty * TS, r, 0, TAU); g.fill(); g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /* ---- baking ---- */
  /** cyclic runs of consecutive ground-level samples (raised decks are drawn dynamically instead) */
  get runs() {
    if (this._runs) return this._runs; const T = this.T, N = T.N;
    if (!T.hasElev) return (this._runs = [{ closed: true, idx: null }]);
    let st = -1; for (let i = 0; i < N; i++) if (!T.elev[i] && T.elev[(i - 1 + N) % N]) { st = i; break; }
    const runs = []; let i = st, cnt = 0;
    while (cnt < N) { if (!T.elev[i]) { const idx = []; while (cnt < N && !T.elev[i]) { idx.push(i); i = (i + 1) % N; cnt++; } runs.push({ closed: false, idx }); } else { i = (i + 1) % N; cnt++; } }
    return (this._runs = runs);
  }
  off(j, e) { return e === 'v' ? this.T.wl[j] + 6 : e === 'w' ? this.T.wl[j] + 5 : e; }
  pt(j, lat) { const T = this.T; return [T.x[j] - T.ty[j] * lat, T.y[j] + T.tx[j] * lat]; }
  ringPath(g, inner, outer) { // road / verge area as one path (even-odd for a full loop, nonzero polygons per run otherwise)
    const T = this.T, N = T.N; g.beginPath();
    for (const r of this.runs) {
      if (r.closed) { for (let s = 1; s >= -1; s -= 2) { for (let i = 0; i <= N; i++) { const j = i % N, [px, py] = this.pt(j, s * (T.hw[j] + this.off(j, outer))); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.closePath(); } }
      else { const idx = r.idx; if (idx.length < 2) continue; idx.forEach((j, k) => { const [px, py] = this.pt(j, T.hw[j] + this.off(j, outer)); k ? g.lineTo(px, py) : g.moveTo(px, py); }); for (let k = idx.length - 1; k >= 0; k--) { const j = idx[k], [px, py] = this.pt(j, -(T.hw[j] + this.off(j, outer))); g.lineTo(px, py); } g.closePath(); }
    }
  }
  get fillRule() { return this.T.hasElev ? 'nonzero' : 'evenodd'; }
  edge(g, side, extra) { // polyline(s) along one side of the road
    const T = this.T, N = T.N;
    for (const r of this.runs) {
      if (r.closed) { for (let i = 0; i <= N; i++) { const j = i % N, [px, py] = this.pt(j, side * (T.hw[j] + this.off(j, extra))); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } }
      else r.idx.forEach((j, k) => { const [px, py] = this.pt(j, side * (T.hw[j] + this.off(j, extra))); k ? g.lineTo(px, py) : g.moveTo(px, py); });
    }
  }
  /** polyline(s) at a fraction of the half-width (racing-line rubber) */
  edgeFrac(g, f) {
    const T = this.T, N = T.N;
    for (const r of this.runs) {
      if (r.closed) { for (let i = 0; i <= N; i++) { const j = i % N, [px, py] = this.pt(j, f * T.hw[j]); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } }
      else r.idx.forEach((j, k) => { const [px, py] = this.pt(j, f * T.hw[j]); k ? g.lineTo(px, py) : g.moveTo(px, py); });
    }
  }
  bake(cv, ox, oy) {
    const T = this.T, th = T.th, g = cv.getContext('2d'), N = T.N, q = this.q;
    g.save(); g.scale(this.res, this.res); g.translate(-ox, -oy);
    g.beginPath(); g.rect(ox, oy, TS, TS); g.clip();
    // base + noise
    g.fillStyle = th.ground; g.fillRect(ox, oy, TS, TS);
    g.imageSmoothingEnabled = false; // keep pixel-art textures crisp
    const gt = Tex.get('ground', T.theme); if (gt) { g.fillStyle = gt; g.fillRect(ox, oy, TS, TS); }
    // large soft blotches (deterministic per 256px cell => seamless across tiles)
    const C = 256;
    for (let cy = Math.floor((oy - 200) / C); cy <= Math.floor((oy + TS + 200) / C); cy++) for (let cx = Math.floor((ox - 200) / C); cx <= Math.floor((ox + TS + 200) / C); cx++) {
      const r = mulberry32(hashStr(cx + ',' + cy) ^ T.seed);
      for (let k = 0; k < 3; k++) {
        const bx = (cx + r()) * C, by = (cy + r()) * C, br = 70 + r() * 150, col = r() < 0.5 ? th.ground2 : th.speck;
        const gr = g.createRadialGradient(bx, by, 0, bx, by, br); gr.addColorStop(0, rgba(col, gt ? 0.16 : 0.45)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
      }
    }
    if (q >= 1) { g.fillStyle = noisePattern(g, 'light'); g.fillRect(ox, oy, TS, TS); g.fillStyle = noisePattern(g, 'dark'); g.fillRect(ox, oy, TS, TS); }
    this.terrainFeatures(g, ox, oy, C);
    if (T.ocean) this.paintSea(g, ox, oy);
    // verge
    this.ringPath(g, 0, 'v'); g.fillStyle = th.verge; g.fill(this.fillRule);
    { const vt = Tex.get('verge', T.theme); if (vt) { g.globalAlpha = 0.9; g.fillStyle = vt; g.fill(this.fillRule); g.globalAlpha = 1; } }
    if (q >= 1) { g.fillStyle = noisePattern(g, 'dark'); g.fill(this.fillRule); }
    // soft shoulder fade
    g.save(); g.lineJoin = 'round'; g.globalAlpha = 0.35; g.strokeStyle = th.ground2; g.lineWidth = 6; g.beginPath(); this.edge(g, 1, 'v'); this.edge(g, -1, 'v'); g.stroke(); g.restore();
    // tarmac
    this.ringPath(g, 0, 0); g.fillStyle = th.road; g.fill(this.fillRule);
    g.save(); this.ringPath(g, 0, 0); g.clip(this.fillRule);
    { const rt = Tex.get('road', T.theme); if (rt) { g.globalAlpha = 0.95; g.fillStyle = rt; g.fillRect(ox, oy, TS, TS); g.globalAlpha = 1; } }
    if (q >= 1) { g.fillStyle = noisePattern(g, 'dark'); g.fillRect(ox, oy, TS, TS); g.fillStyle = noisePattern(g, 'light'); g.fillRect(ox, oy, TS, TS); g.fillStyle = noisePattern(g, 'grit'); g.fillRect(ox, oy, TS, TS); }
    // patches + wear
    const R = 200;
    for (let cy = Math.floor(oy / R); cy <= Math.floor((oy + TS) / R); cy++) for (let cx = Math.floor(ox / R); cx <= Math.floor((ox + TS) / R); cx++) {
      const r = mulberry32(hashStr('p' + cx + ',' + cy) ^ T.seed);
      for (let k = 0; k < 4; k++) { g.fillStyle = r() < 0.5 ? rgba('#000000', 0.07 + r() * 0.06) : rgba('#ffffff', 0.03 + r() * 0.03); const w = 20 + r() * 70, h = 14 + r() * 50; g.save(); g.translate((cx + r()) * R, (cy + r()) * R); g.rotate(r() * TAU); g.fillRect(-w / 2, -h / 2, w, h); g.restore(); }
      if (r() < 0.45) { g.strokeStyle = rgba('#000000', 0.25); g.lineWidth = 1.2; g.beginPath(); let x = (cx + r()) * R, y = (cy + r()) * R; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    }
    // racing-line rubber
    g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 34;
    for (const s of [-0.38, 0.38]) { g.beginPath(); this.edgeFrac(g, s); g.stroke(); }
    g.restore();
    // kerbs on corners
    for (let i = 0; i < N; i++) {
      const c = T.curv[i]; if (Math.abs(c) < 0.0007 || T.elev[i] || T.elev[(i + 1) % N]) continue;
      const j = (i + 1) % N, inside = c > 0 ? -1 : 1;      // positive curvature = turning right => inside is +1? (screen coords) handle both sides lightly
      for (const side of [-inside, inside]) {
        const a0 = T.hw[i], a1 = T.hw[j];
        const x0 = T.x[i] - T.ty[i] * side * a0, y0 = T.y[i] + T.tx[i] * side * a0, x1 = T.x[j] - T.ty[j] * side * a1, y1 = T.y[j] + T.tx[j] * side * a1;
        const x2 = T.x[j] - T.ty[j] * side * (a1 + 9), y2 = T.y[j] + T.tx[j] * side * (a1 + 9), x3 = T.x[i] - T.ty[i] * side * (a0 + 9), y3 = T.y[i] + T.tx[i] * side * (a0 + 9);
        if (Math.max(x0, x2) < ox - 20 || Math.min(x0, x2) > ox + TS + 20 || Math.max(y0, y2) < oy - 20 || Math.min(y0, y2) > oy + TS + 20) continue;
        g.fillStyle = (i & 1) ? '#d8302b' : '#f2f2f2'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fill();
      }
    }
    // edge lines
    g.lineJoin = 'round'; g.strokeStyle = th.line; g.globalAlpha = 0.85; g.lineWidth = 4; g.beginPath(); this.edge(g, 1, -9); this.edge(g, -1, -9); g.stroke(); g.globalAlpha = 1;
    if (T.data.lanes) { // two-way road: double yellow centre line, dashed lane dividers each side
      g.strokeStyle = '#f2c500'; g.globalAlpha = 0.85; g.lineWidth = 3; g.beginPath(); this.edgeFrac(g, 0.025); this.edgeFrac(g, -0.025); g.stroke();
      g.strokeStyle = th.line; g.globalAlpha = 0.6; g.lineWidth = 3; g.beginPath();
      for (const fr of [-0.5, 0.5]) for (let i = 0; i < N; i += 4) { const j = (i + 2) % N; if (T.elev[i] || T.elev[j]) continue; const a = this.pt(i, fr * T.hw[i]), b = this.pt(j, fr * T.hw[j]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      g.stroke(); g.globalAlpha = 1;
    } else {
    // centre dashes
    g.strokeStyle = th.line; g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i < N; i += 4) { const j = (i + 1) % N, k = (i + 2) % N; if (T.elev[i] || T.elev[j] || T.elev[k]) continue; g.moveTo(T.x[i], T.y[i]); g.lineTo(T.x[j], T.y[j]); g.lineTo(T.x[k], T.y[k]); }
    g.stroke(); g.globalAlpha = 1;
    }
    // start / finish
    const hw0 = T.hw[0], sq = 14, nx = -T.ty[0], ny = T.tx[0], tx = T.tx[0], ty = T.ty[0];
    if (Math.abs(T.x[0] - ox - TS / 2) < TS / 2 + hw0 + 30 && Math.abs(T.y[0] - oy - TS / 2) < TS / 2 + hw0 + 30) {
      const cols = Math.ceil(hw0 * 2 / sq);
      for (let r = 0; r < 3; r++) for (let c = 0; c < cols; c++) {
        const lat = -hw0 + c * sq, lon = (r - 1.5) * sq;
        g.fillStyle = (r + c) & 1 ? '#f5f5f5' : '#151515';
        g.beginPath(); g.moveTo(T.x[0] + nx * lat + tx * lon, T.y[0] + ny * lat + ty * lon); g.lineTo(T.x[0] + nx * (lat + sq) + tx * lon, T.y[0] + ny * (lat + sq) + ty * lon);
        g.lineTo(T.x[0] + nx * (lat + sq) + tx * (lon + sq), T.y[0] + ny * (lat + sq) + ty * (lon + sq)); g.lineTo(T.x[0] + nx * lat + tx * (lon + sq), T.y[0] + ny * lat + ty * (lon + sq)); g.closePath(); g.fill();
      }
      // grid slots
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      for (let r = 0; r < 6; r++) for (const side of [-0.5, 0.5]) { const p = gridPos(T, r * 2 + (side > 0 ? 1 : 0)); g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.strokeRect(-22, -12, 44, 24); g.restore(); }
    }
    // barrier shadows are baked; the barriers themselves are drawn as real 3D geometry by structures.js (baked here only on Low quality)
    g.lineJoin = 'round'; g.lineCap = 'butt';
    for (const side of [-1, 1]) {
      g.save(); g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 14; g.translate(6, 9); g.beginPath(); this.edge(g, side, 'w'); g.stroke(); g.restore();
      if (q >= 1) continue;
      g.strokeStyle = shade(th.wall, -0.35); g.lineWidth = 12; g.save(); g.translate(0, 5); g.beginPath(); this.edge(g, side, 'w'); g.stroke(); g.restore();
      g.strokeStyle = th.wall; g.lineWidth = 11; g.beginPath(); this.edge(g, side, 'w'); g.stroke();
      g.strokeStyle = th.wallTop; g.lineWidth = 7; g.beginPath(); this.edge(g, side, 'w'); g.stroke();
    }
    g.restore();
    // 3D barriers, flyover shadows and flat scenery (craters, dunes) are baked into the ground layer with the screen's projection
    g.save(); const tv = this.tileView(ox, oy), vis = makeVis(T, tv);
    if (T.hasElev || T.hasTun) drawDeckShadows(g, tv, T, vis);
    if (q >= 1) drawWalls(g, tv, T, vis);
    for (const p of this.propsNear(ox, oy, 200, 200)) if (FLAT.has(p.type)) drawProp(g, tv, p, th, 0);
    g.restore();
  }

  /** shoreline point for lateral coordinate c, pushed `off` px inland (negative = out to sea) */
  shoreXY(c, off = 0) { const o = this.T.ocean, p = o.s + shoreWob(c) + (o.side === 'N' || o.side === 'W' ? 1 : -1) * off; return o.side === 'N' || o.side === 'S' ? [c, p] : [p, c]; }
  paintSea(g, ox, oy) {
    const T = this.T, o = T.ocean, th = T.th, horiz = o.side === 'N' || o.side === 'S', lo = (horiz ? ox : oy) - 40, hi = (horiz ? ox + TS : oy + TS) + 40;
    const a0 = horiz ? oy : ox; const inl = o.side === 'N' || o.side === 'W'; // water lies on the low side for N/W
    if (inl ? a0 > o.s + 140 : a0 + TS < o.s - 140) return;
    const line = (off, from, to, st = 24) => { const out = []; for (let c = from; c <= to; c += st) out.push(this.shoreXY(c, off)); return out; };
    const trace = (pts, close) => { g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); };
    const shore = line(0, lo, hi); const far = shore.map(([x, y]) => [x - o.ix * 3000, y - o.iy * 3000]).reverse();
    g.save(); trace(shore.concat(far)); g.closePath(); g.clip();
    g.fillStyle = '#0f4468'; g.fillRect(ox - 40, oy - 40, TS + 80, TS + 80);
    const cols = ['#185a82', '#1f6d96', '#2582a9', '#2d8fb5', '#3aa5c8', '#5cc4d6', '#8fe3e0']; g.lineJoin = 'round'; g.lineCap = 'round';
    for (let k = 0; k < cols.length; k++) { const off = -(cols.length - 1 - k) * 80 - 24; g.strokeStyle = cols[k]; g.lineWidth = 110; trace(line(off, lo - 150, hi + 150)); g.globalAlpha = 0.9; g.stroke(); }
    g.globalAlpha = 1; const wt = Tex.get('water', T.theme); if (wt) { g.imageSmoothingEnabled = false; g.globalAlpha = 0.28; g.fillStyle = wt; g.fillRect(ox - 40, oy - 40, TS + 80, TS + 80); g.globalAlpha = 1; }
    g.restore();
    g.save(); g.lineJoin = 'round'; trace(line(26, lo, hi)); g.strokeStyle = rgba('#8a7440', 0.3); g.lineWidth = 46; g.stroke(); // wet sand
    trace(line(0, lo, hi)); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5; g.stroke(); g.restore();
  }
  /** animated surf and swell, drawn over the baked sea every frame */
  drawSea(g, v, time) {
    const T = this.T, o = T.ocean; if (!o) return; const W = v.W, H = v.H, vw = W / v.zoom, vh = H / v.zoom, horiz = o.side === 'N' || o.side === 'S';
    const a = horiz ? v.y : v.x, ext = (horiz ? vh : vw) / 2 + 160; const water = o.side === 'N' || o.side === 'W' ? a - ext < o.s + 120 : a + ext > o.s - 120; if (!water) return;
    const from = (horiz ? v.x - vw / 2 : v.y - vh / 2) - 100, to = (horiz ? v.x + vw / 2 : v.y + vh / 2) + 100;
    const path = (off, wig, ph) => { g.beginPath(); let k = 0; for (let c = Math.floor(from / 36) * 36; c <= to; c += 36, k++) { const [x, y] = this.shoreXY(c, off + Math.sin(c * 0.03 + ph) * wig); k ? g.lineTo(v.sx(x), v.sy(y)) : g.moveTo(v.sx(x), v.sy(y)); } };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) { const ph = (time * 0.2 + k / 4) % 1, off = -(12 + (1 - ph) * 210); path(off, 6, time * 1.5 + k); g.strokeStyle = `rgba(235,250,255,${Math.sin(ph * Math.PI) * 0.45})`; g.lineWidth = (2 + ph * 3) * v.zoom; g.stroke(); }
    const wash = Math.sin(time * 1.3) * 10; path(wash - 4, 8, time * 0.8); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 7 * v.zoom; g.stroke();
    path(wash + 8, 5, time * 0.6 + 2); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 12 * v.zoom; g.stroke(); g.restore();
  }

  terrainFeatures(g, ox, oy, C) {
    const T = this.T, th = T.th, theme = T.theme;
    if (this.q < 1) return;
    const r0 = (cx, cy, s) => mulberry32(hashStr(s + cx + ',' + cy) ^ T.seed);
    for (let cy = Math.floor((oy - 200) / C); cy <= Math.floor((oy + TS + 200) / C); cy++) for (let cx = Math.floor((ox - 200) / C); cx <= Math.floor((ox + TS + 200) / C); cx++) {
      const r = r0(cx, cy, 'f');
      if (theme === 'coast') { // water pools beyond the walls
        if (r() < 0.45) { const x = (cx + r()) * C, y = (cy + r()) * C, rad = 60 + r() * 130; if (T.clearDist(x, y) > rad + 90) { const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad); gr.addColorStop(0, rgba(th.water, 0.95)); gr.addColorStop(0.8, rgba(th.water, 0.9)); gr.addColorStop(1, rgba('#f7ecc6', 0.9)); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad * 1.3, rad, r() * 3, 0, TAU); g.fill(); } }
      } else if (theme === 'volcano') {
        if (r() < 0.5) { const x = (cx + r()) * C, y = (cy + r()) * C, rad = 30 + r() * 70; if (T.clearDist(x, y) > rad + 80) { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, '#ffd23a'); gr.addColorStop(0.35, '#ff6a10'); gr.addColorStop(0.8, '#a82a08'); gr.addColorStop(1, 'rgba(60,20,10,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad * 1.4, rad, r() * 3, 0, TAU); g.fill(); } }
        g.strokeStyle = 'rgba(255,100,20,0.35)'; g.lineWidth = 2; for (let k = 0; k < 2; k++) { let x = (cx + r()) * C, y = (cy + r()) * C; if (T.clearDist(x, y) < 70) continue; g.beginPath(); g.moveTo(x, y); for (let n = 0; n < 7; n++) { x += (r() - 0.4) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      } else if (theme === 'snow') {
        if (r() < 0.5) { const x = (cx + r()) * C, y = (cy + r()) * C, rad = 50 + r() * 110; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      } else if (theme === 'forest') {
        for (let k = 0; k < 5; k++) { const x = (cx + r()) * C, y = (cy + r()) * C, rad = 10 + r() * 30; g.fillStyle = rgba(r() < 0.5 ? '#2c4d20' : '#527f3a', 0.4); g.beginPath(); g.ellipse(x, y, rad * 1.5, rad, r() * 3, 0, TAU); g.fill(); }
      } else if (theme === 'desert' || theme === 'mesa') {
        g.strokeStyle = rgba(th.ground2, 0.5); g.lineWidth = 2; for (let k = 0; k < 4; k++) { const x = (cx + r()) * C, y = (cy + r()) * C; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 20, y - 10, x + 50, y + 10, x + 80, y); g.stroke(); }
      } else if (theme === 'city' || theme === 'industrial') {
        g.strokeStyle = rgba('#000000', 0.25); g.lineWidth = 1.5; const sx = Math.floor(cx * C / 128) * 128, sy = Math.floor(cy * C / 128) * 128;
        if (r() < 0.6) { g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 128, sy); g.moveTo(sx, sy); g.lineTo(sx, sy + 128); g.stroke(); }
      }
    }
  }
}

/** Start grid slot n (0 = pole). */
export function gridPos(T, n) {
  const row = n >> 1, col = n & 1; const back = 34 + row * 58 + col * 18;
  const f = -back / T.step; const p = pointAt(T, f, (col ? 1 : -1) * T.hw[0] * 0.42);
  return p;
}

export function makeMinimap(T, size = 180) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const s = (size - 16) / Math.max(T.W, T.H), offx = (size - T.W * s) / 2, offy = (size - T.H * s) / 2;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i <= T.N; i++) { const j = i % T.N; const x = offx + T.x[j] * s, y = offy + T.y[j] * s; if (i) g.lineTo(x, y); else g.moveTo(x, y); } };
  path(); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 8; g.stroke();
  path(); g.strokeStyle = '#8b8f99'; g.lineWidth = 5; g.stroke();
  path(); g.strokeStyle = '#d9dde6'; g.lineWidth = 1.5; g.setLineDash([3, 5]); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#fff'; g.fillRect(offx + T.x[0] * s - 4, offy + T.y[0] * s - 1.5, 8, 3);
  return { canvas: c, s, offx, offy };
}
