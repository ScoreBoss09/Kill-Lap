// Tiled, lazily-baked terrain renderer. Tiles are drawn from the vector track description on demand,
// so very large worlds cost only the memory of tiles the cars actually visit. Skid marks / scorch marks
// are stamped straight into the tiles.
import { VERGE, pointAt } from './tracks.js';
import { mulberry32, shade, rgba, TAU, hashStr } from './util.js';

export const TS = 512;
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
    this.T = T; this.q = quality; this.tiles = new Map(); this.queue = [];
    this.cols = Math.ceil(T.W / TS); this.rows = Math.ceil(T.H / TS);
    this.px = null;
  }
  key(tx, ty) { return tx + ty * 1000; }
  has(tx, ty) { return this.tiles.has(this.key(tx, ty)); }
  /** returns tile canvas, baking it if needed */
  tile(tx, ty) {
    const k = this.key(tx, ty); let t = this.tiles.get(k);
    if (!t) { t = document.createElement('canvas'); t.width = t.height = TS; this.bake(t, tx * TS, ty * TS); this.tiles.set(k, t); }
    return t;
  }
  /** bake at most `max` missing tiles overlapping [x0..x1]x[y0..y1] */
  ensure(x0, y0, x1, y1, max = 2) {
    let n = 0;
    const tx0 = Math.max(0, Math.floor(x0 / TS)), tx1 = Math.min(this.cols - 1, Math.floor(x1 / TS)), ty0 = Math.max(0, Math.floor(y0 / TS)), ty1 = Math.min(this.rows - 1, Math.floor(y1 / TS));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!this.has(tx, ty)) { if (n >= max) return false; this.tile(tx, ty); n++; }
    return true;
  }
  draw(ctx, camX, camY, zoom, W, H) {
    const vw = W / zoom, vh = H / zoom, x0 = camX - vw / 2, y0 = camY - vh / 2;
    const tx0 = Math.max(0, Math.floor(x0 / TS)), tx1 = Math.min(this.cols - 1, Math.floor((x0 + vw) / TS)), ty0 = Math.max(0, Math.floor(y0 / TS)), ty1 = Math.min(this.rows - 1, Math.floor((y0 + vh) / TS));
    const th = this.T.th; ctx.fillStyle = th.ground2; ctx.fillRect(0, 0, W, H);
    const sz = Math.ceil(TS * zoom) + 1;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = this.tile(tx, ty);
      ctx.drawImage(t, Math.floor((tx * TS - x0) * zoom), Math.floor((ty * TS - y0) * zoom), sz, sz);
    }
  }

  /* ---- decals ---- */
  line(x0, y0, x1, y1, width, color, alpha) {
    const minx = Math.min(x0, x1) - width, maxx = Math.max(x0, x1) + width, miny = Math.min(y0, y1) - width, maxy = Math.max(y0, y1) + width;
    for (let ty = Math.floor(miny / TS); ty <= Math.floor(maxy / TS); ty++) for (let tx = Math.floor(minx / TS); tx <= Math.floor(maxx / TS); tx++) {
      const t = this.tiles.get(this.key(tx, ty)); if (!t) continue;
      const g = t.getContext('2d'); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0 - tx * TS, y0 - ty * TS); g.lineTo(x1 - tx * TS, y1 - ty * TS); g.stroke(); g.globalAlpha = 1;
    }
  }
  blot(x, y, r, color, alpha) {
    for (let ty = Math.floor((y - r) / TS); ty <= Math.floor((y + r) / TS); ty++) for (let tx = Math.floor((x - r) / TS); tx <= Math.floor((x + r) / TS); tx++) {
      const t = this.tiles.get(this.key(tx, ty)); if (!t) continue;
      const g = t.getContext('2d'); const gr = g.createRadialGradient(x - tx * TS, y - ty * TS, 0, x - tx * TS, y - ty * TS, r);
      gr.addColorStop(0, rgba(color, alpha)); gr.addColorStop(1, rgba(color, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x - tx * TS, y - ty * TS, r, 0, TAU); g.fill();
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
    g.save(); g.translate(-ox, -oy);
    g.beginPath(); g.rect(ox, oy, TS, TS); g.clip();
    // base + noise
    g.fillStyle = th.ground; g.fillRect(ox, oy, TS, TS);
    // large soft blotches (deterministic per 256px cell => seamless across tiles)
    const C = 256;
    for (let cy = Math.floor((oy - 200) / C); cy <= Math.floor((oy + TS + 200) / C); cy++) for (let cx = Math.floor((ox - 200) / C); cx <= Math.floor((ox + TS + 200) / C); cx++) {
      const r = mulberry32(hashStr(cx + ',' + cy) ^ T.seed);
      for (let k = 0; k < 3; k++) {
        const bx = (cx + r()) * C, by = (cy + r()) * C, br = 70 + r() * 150, col = r() < 0.5 ? th.ground2 : th.speck;
        const gr = g.createRadialGradient(bx, by, 0, bx, by, br); gr.addColorStop(0, rgba(col, 0.45)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
      }
    }
    if (q >= 1) { g.fillStyle = noisePattern(g, 'light'); g.fillRect(ox, oy, TS, TS); g.fillStyle = noisePattern(g, 'dark'); g.fillRect(ox, oy, TS, TS); }
    this.terrainFeatures(g, ox, oy, C);
    // verge
    this.ringPath(g, 0, 'v'); g.fillStyle = th.verge; g.fill(this.fillRule);
    if (q >= 1) { g.fillStyle = noisePattern(g, 'dark'); g.fill(this.fillRule); }
    // soft shoulder fade
    g.save(); g.lineJoin = 'round'; g.globalAlpha = 0.35; g.strokeStyle = th.ground2; g.lineWidth = 6; g.beginPath(); this.edge(g, 1, 'v'); this.edge(g, -1, 'v'); g.stroke(); g.restore();
    // tarmac
    this.ringPath(g, 0, 0); g.fillStyle = th.road; g.fill(this.fillRule);
    g.save(); this.ringPath(g, 0, 0); g.clip(this.fillRule);
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
    // centre dashes
    g.strokeStyle = th.line; g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i < N; i += 4) { const j = (i + 1) % N, k = (i + 2) % N; if (T.elev[i] || T.elev[j] || T.elev[k]) continue; g.moveTo(T.x[i], T.y[i]); g.lineTo(T.x[j], T.y[j]); g.lineTo(T.x[k], T.y[k]); }
    g.stroke(); g.globalAlpha = 1;
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
