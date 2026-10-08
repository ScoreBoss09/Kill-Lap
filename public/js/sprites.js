// Pseudo-3D sprite drawing with a fixed 3/4 (oblique) projection: anything with height is drawn shifted straight up
// the screen by LEAN * height. Because the projection does not depend on where the camera is, all static scenery,
// barriers, flyovers and tunnel hills can be baked once into the terrain tiles - nothing wobbles or re-stitches.
import { shade, rgba, TAU, mulberry32, clamp } from './util.js';
import Tex from './textures.js';

export const LEAN = 0.42;
export const PERSP = 0; // (kept for compatibility: the old camera-relative perspective is gone)

export class View {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; this.W = 800; this.H = 600; this.shakeX = 0; this.shakeY = 0; this.t = 0; this.quality = 2; }
  sx(wx) { return (wx - this.x) * this.zoom + this.W / 2 + this.shakeX; }
  sy(wy) { return (wy - this.y) * this.zoom + this.H / 2 + this.shakeY; }
  /** projected screen position of world point at height h */
  px(wx, wy, h) { return this.sx(wx); }
  py(wx, wy, h) { return this.sy(wy) - h * LEAN * this.zoom; }
  scale(h) { return this.zoom; }
  /** the viewer sits far to the south: faces whose normal points +y are the visible ones */
  get cx() { return 0; } get cy() { return 1e9; }
  visible(wx, wy, r) { const m = r * this.zoom + 200 * this.zoom; return Math.abs(this.sx(wx) - this.W / 2) < this.W / 2 + m && Math.abs(this.sy(wy) - this.H / 2) < this.H / 2 + m; }
}

const BIG = new Set(['tower', 'building', 'container', 'tank', 'adobe', 'mesa', 'cabin', 'crane', 'billboard', 'hut']);

function shadowEllipse(g, v, x, y, rx, ry, a = 0.28) {
  g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(v.sx(x) + 10 * v.zoom, v.sy(y) + 8 * v.zoom, rx * v.zoom, ry * v.zoom, 0.5, 0, TAU); g.fill();
}
function disc(g, v, x, y, h, r, fill) {
  const s = v.scale(h); g.fillStyle = fill; g.beginPath(); g.arc(v.px(x, y, h), v.py(x, y, h), r * s, 0, TAU); g.fill();
}
const WPAT = new Map();
/** 8x10 tile: one window (3x2) per tile, so a wall shows 5 rows of windows spaced like the old dashed strips */
function windowPattern(g, col) {
  let p = WPAT.get(col); if (p !== undefined) return p;
  const c = document.createElement('canvas'); c.width = 8; c.height = 10; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 9, 3, 2); x.fillRect(0, 0, 3, 1);
  p = g.createPattern(c, 'repeat'); if (p && !p.setTransform) p = null; WPAT.set(col, p); return p;
}
export function box(g, v, cx, cy, w, d, h, rot, colWall, colRoof, opts = {}) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [cx + a * c - b * s, cy + a * s + b * c]);
  // shadow polygon
  if (!opts.noShadow) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath();
  corners.forEach(([x, y], i) => { const X = v.sx(x) + h * 0.55 * v.zoom, Y = v.sy(y) + h * 0.4 * v.zoom; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
  corners.forEach(([x, y]) => g.lineTo(v.sx(x), v.sy(y))); g.fill(); }
  const base = corners.map(([x, y]) => [v.px(x, y, 0), v.py(x, y, 0)]);
  const top = corners.map(([x, y]) => [v.px(x, y, h), v.py(x, y, h)]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // outward normal of the wall; skip walls facing away from the camera (they are hidden behind the roof)
    const mx = (corners[i][0] + corners[j][0]) / 2 - cx, my = (corners[i][1] + corners[j][1]) / 2 - cy;
    const ml = Math.hypot(mx, my) || 1;
    if (((v.cx - (cx + mx)) * mx + (v.cy - (cy + my)) * my) / ml < -2) continue;
    const light = clamp(0.5 - (mx * 0.5 + my * 0.8) / ml * 0.28, 0.2, 0.9);
    g.fillStyle = shade(colWall, (light - 0.55) * 0.9);
    g.beginPath(); g.moveTo(base[i][0], base[i][1]); g.lineTo(base[j][0], base[j][1]); g.lineTo(top[j][0], top[j][1]); g.lineTo(top[i][0], top[i][1]); g.closePath(); g.fill();
    if (opts.windows && v.quality > 0) { // rows of windows: one pattern fill mapped onto the wall (much cheaper than dashed strokes)
      const pat = windowPattern(g, opts.windows); if (pat) {
        const ux = base[j][0] - base[i][0], uy = base[j][1] - base[i][1], ul = Math.hypot(ux, uy) || 1, vx = top[i][0] - base[i][0], vy = top[i][1] - base[i][1];
        pat.setTransform(new DOMMatrix([ux / ul * v.zoom, uy / ul * v.zoom, vx / 50, vy / 50, base[i][0], base[i][1]])); g.fillStyle = pat; g.fill();
      }
    }
  }
  const pat = opts.roof && v.quality > 0 ? Tex.world(v, 'roof', opts.roof) : null;
  const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); if (pat) { g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = opts.roofA ?? 0.8; g.fillStyle = pat; g.fill(); g.restore(); } };
  if (opts.gable) { // pitched roof: two lit slopes meeting at a ridge along the long side, gable ends in the wall colour
    const rise = Math.min(w, d) * 0.4, alongW = w >= d, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [ra, rb] = alongW ? [m(corners[0], corners[3]), m(corners[1], corners[2])] : [m(corners[0], corners[1]), m(corners[3], corners[2])];
    const R = p => [v.px(p[0], p[1], h + rise), v.py(p[0], p[1], h + rise)], RA = R(ra), RB = R(rb);
    const slopes = alongW ? [[[top[0], top[1], RB, RA], [-s, c]], [[top[3], top[2], RB, RA], [s, -c]]] : [[[top[0], top[3], RB, RA], [-c, -s]], [[top[1], top[2], RB, RA], [c, s]]];
    const ends = alongW ? [[top[0], RA, top[3]], [top[1], RB, top[2]]] : [[top[0], RA, top[1]], [top[3], RB, top[2]]];
    g.fillStyle = shade(colWall, -0.12); for (const e of ends) { g.beginPath(); e.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); }
    const wall = sl => { const n = sl[1]; return (v.cx - cx) * n[0] + (v.cy - cy) * n[1]; }; slopes.sort((a, b) => wall(a) - wall(b)); // far slope first
    for (const sl of slopes) { const n = sl[1], light = clamp(0.5 + (n[0] * -0.5 + n[1] * -0.8) * 0.32, 0.15, 0.9); sl[1] = n; poly(sl[0], shade(colRoof, (light - 0.5) * 0.7)); }
    g.strokeStyle = shade(colRoof, -0.35); g.lineWidth = Math.max(1, 1.6 * v.zoom); g.beginPath(); g.moveTo(RA[0], RA[1]); g.lineTo(RB[0], RB[1]); g.stroke();
    return top;
  }
  poly(top, colRoof);
  g.strokeStyle = shade(colRoof, -0.3); g.lineWidth = Math.max(1, v.zoom); g.beginPath(); top.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
  if (opts.flat) { // flat roof: inner parapet rim + a couple of rooftop units
    const inset = top.map(([x, y]) => { const mx = top.reduce((a, p) => a + p[0], 0) / 4, my = top.reduce((a, p) => a + p[1], 0) / 4; return [mx + (x - mx) * 0.86, my + (y - my) * 0.86]; });
    g.strokeStyle = shade(colRoof, -0.22); g.lineWidth = Math.max(1, 2 * v.zoom); g.beginPath(); inset.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
    const r = opts.seed || 0.5; for (let k = 0; k < 2; k++) { const u = (((r * 7 + k * 0.37) % 1) - 0.5) * w * 0.5, q = (((r * 13 + k * 0.61) % 1) - 0.5) * d * 0.5; box(g, v, cx + u * c - q * s, cy + u * s + q * c, 16 + k * 8, 14, h + 8 + k * 4, rot, shade(colRoof, -0.15), shade(colRoof, 0.12), { noShadow: true }); }
  }
  return top;
}

const WALLCOL = { ruin: ['#7d7a70', '#5e5b52'], adobe: ['#c79a62', '#d9b07a'], cabin: ['#7a4e2d', '#e6edf2'], building: ['#6c6f7d', '#8a8d9b'], tower: ['#3d4558', '#566078'], container: null, hut: ['#c8a165', '#a1472f'], billboard: ['#555', '#777'] };

export function drawProp(g, v, p, th, t) {
  const x = p.x, y = p.y, s = p.s, r = mulberry32((p.v * 1e9) | 0), wind = Math.sin(t * 1.4 + p.v * 30) * 1.7;
  switch (p.type) {
    case 'cactus': {
      shadowEllipse(g, v, x, y, 10 * s, 6 * s);
      const h = 44 * s; g.lineCap = 'round';
      g.strokeStyle = '#2f6b33'; g.lineWidth = 9 * s * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, h), v.py(x, y, h)); g.stroke();
      g.strokeStyle = '#3f8a43'; g.lineWidth = 5 * s * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, h * 0.1), v.py(x, y, h * 0.1)); g.lineTo(v.px(x, y, h), v.py(x, y, h)); g.stroke();
      for (const sd of [-1, 1]) { if ((p.v * 7 + sd) % 1 < 0.3) continue; const ah = h * (0.4 + 0.2 * ((p.v * 13 * sd) % 1 + 1) % 1); g.strokeStyle = '#2f6b33'; g.lineWidth = 6 * s * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, ah), v.py(x, y, ah)); g.lineTo(v.px(x + sd * 12 * s, y, ah), v.py(x + sd * 12 * s, y, ah)); g.lineTo(v.px(x + sd * 12 * s, y, ah + 16 * s), v.py(x + sd * 12 * s, y, ah + 16 * s)); g.stroke(); }
      break;
    }
    case 'rock': case 'mesa_small': {
      shadowEllipse(g, v, x, y, 20 * s, 12 * s);
      const col = th.wall, n = 7, rad = 15 * s;
      for (let L = 0; L < 3; L++) {
        const h = L * 7 * s, rr = rad * (1 - L * 0.22); g.fillStyle = shade(col, -0.35 + L * 0.2); g.beginPath();
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU + p.r, d = rr * (0.8 + ((p.v * (k + 3) * 17) % 1) * 0.4); const X = v.px(x + Math.cos(a) * d, y + Math.sin(a) * d, h), Y = v.py(x + Math.cos(a) * d, y + Math.sin(a) * d, h); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
        g.closePath(); g.fill();
      }
      break;
    }
    case 'dune': { g.fillStyle = rgba(th.speck, 0.35); g.beginPath(); g.ellipse(v.sx(x), v.sy(y), 90 * s * v.zoom, 28 * s * v.zoom, p.r, 0, TAU); g.fill(); break; }
    case 'pine': case 'snowpine': {
      shadowEllipse(g, v, x, y, 20 * s, 12 * s, 0.3);
      g.strokeStyle = '#4a3220'; g.lineWidth = 5 * s * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, 28 * s), v.py(x, y, 28 * s)); g.stroke();
      const snow = p.type === 'snowpine';
      for (let L = 0; L < 4; L++) { const h = (18 + L * 17) * s, rr = (28 - L * 6.5) * s, wx = x + wind * L * 0.5; disc(g, v, wx, y, h, rr, snow ? shade('#2f5f45', L * 0.08) : shade('#27552a', -0.1 + L * 0.1)); if (snow) disc(g, v, wx, y, h + 3, rr * 0.72, rgba('#ffffff', 0.85)); }
      break;
    }
    case 'oak': {
      shadowEllipse(g, v, x, y, 26 * s, 15 * s, 0.3);
      g.strokeStyle = '#5a3d25'; g.lineWidth = 7 * s * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, 32 * s), v.py(x, y, 32 * s)); g.stroke();
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + p.r, d = k ? 13 * s : 0; disc(g, v, x + Math.cos(a) * d + wind * 0.7, y + Math.sin(a) * d, 40 * s + (k % 2) * 8, 18 * s, shade('#3f7a33', -0.2 + (k % 3) * 0.12)); }
      disc(g, v, x - 4 + wind, y - 4, 60 * s, 12 * s, shade('#5da24a', 0.05));
      break;
    }
    case 'palm': {
      shadowEllipse(g, v, x, y, 26 * s, 12 * s, 0.25);
      g.strokeStyle = '#8c6a3f'; g.lineWidth = 6 * s * v.zoom; g.lineCap = 'round'; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.quadraticCurveTo(v.px(x + 6, y, 35 * s), v.py(x + 6, y, 35 * s), v.px(x + 3, y, 70 * s), v.py(x + 3, y, 70 * s)); g.stroke();
      const hx = x + 3, hy = y, hh = 72 * s;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + p.r; g.strokeStyle = shade('#2f8a3e', (k % 2) * 0.15); g.lineWidth = 5 * s * v.zoom; g.beginPath(); g.moveTo(v.px(hx, hy, hh), v.py(hx, hy, hh)); g.quadraticCurveTo(v.px(hx + Math.cos(a) * 18 * s, hy + Math.sin(a) * 18 * s, hh + 6), v.py(hx + Math.cos(a) * 18 * s, hy + Math.sin(a) * 18 * s, hh + 6), v.px(hx + Math.cos(a) * 34 * s, hy + Math.sin(a) * 34 * s, hh - 8), v.py(hx + Math.cos(a) * 34 * s, hy + Math.sin(a) * 34 * s, hh - 8)); g.stroke(); }
      break;
    }
    case 'umbrella': { shadowEllipse(g, v, x, y, 22, 12, 0.2); g.strokeStyle = '#ddd'; g.lineWidth = 2 * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, 34), v.py(x, y, 34)); g.stroke(); for (let k = 0; k < 6; k++) { g.fillStyle = k & 1 ? '#f4f4f4' : ['#e53935', '#1e88e5', '#fdd835'][(p.v * 3) | 0]; g.beginPath(); g.moveTo(v.px(x, y, 38), v.py(x, y, 38)); const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU; g.lineTo(v.px(x + Math.cos(a0) * 24, y + Math.sin(a0) * 24, 28), v.py(x + Math.cos(a0) * 24, y + Math.sin(a0) * 24, 28)); g.lineTo(v.px(x + Math.cos(a1) * 24, y + Math.sin(a1) * 24, 28), v.py(x + Math.cos(a1) * 24, y + Math.sin(a1) * 24, 28)); g.fill(); } break; }
    case 'log': { g.save(); g.translate(v.sx(x), v.sy(y)); g.rotate(p.r); g.scale(v.zoom, v.zoom); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-26, -5, 54, 14); g.fillStyle = '#6a4a2e'; g.fillRect(-28, -7, 56, 13); g.fillStyle = '#8a6540'; g.fillRect(-28, -7, 56, 5); g.fillStyle = '#c9a272'; g.beginPath(); g.ellipse(28, -1, 3, 6, 0, 0, TAU); g.fill(); g.restore(); break; }
    case 'snowman': { shadowEllipse(g, v, x, y, 14, 8); disc(g, v, x, y, 0, 13, '#e8f0f5'); disc(g, v, x, y, 14, 9.5, '#f4f9fc'); disc(g, v, x, y, 26, 6.5, '#ffffff'); disc(g, v, x + 1, y, 30, 1.5, '#e8761f'); break; }
    case 'lava': { const f = 0.7 + Math.sin(t * 2 + p.v * 20) * 0.3, R = 60 * s * v.zoom; glow(g, v.sx(x), v.sy(y), R, '255,90,20', 0.95); g.globalAlpha = f; glow(g, v.sx(x), v.sy(y), R * 0.55, '255,200,60', 0.9); g.globalAlpha = 1; break; }
    case 'spire': {
      shadowEllipse(g, v, x, y, 20 * s, 12 * s, 0.35);
      for (let L = 0; L < 5; L++) { const h = L * 14 * s, rr = (20 - L * 3.8) * s; disc(g, v, x, y, h, rr, shade('#3a2724', -0.1 + L * 0.12)); }
      disc(g, v, x, y, 72 * s, 3 * s, '#ff7a30');
      break;
    }
    case 'mesa': {
      const w = p.w, d = p.d, rot = p.r; const lv = [[1, 0.5], [0.8, 0.9], [0.62, 1.2]];
      shadowEllipse(g, v, x, y, w * 0.6, d * 0.45, 0.3);
      for (let L = 0; L < 3; L++) { const hh = [0, 40 * s, 70 * s, 92 * s]; const [sc] = lv[L]; box(g, v, x, y, w * sc, d * sc, hh[L + 1] || 90, rot, shade('#a4552a', -0.1 + L * 0.1), shade('#cf8456', L * 0.06)); }
      break;
    }
    case 'ruin': {
      const rot = p.al ? p.r + (p.v - 0.5) * 0.1 : Math.round(p.r / (Math.PI / 2)) * (Math.PI / 2) + (p.v - 0.5) * 0.25, c = Math.cos(rot), sn = Math.sin(rot);
      box(g, v, x, y, p.w, p.d, p.h, rot, shade('#7d7a70', ((p.v * 7) % 1 - 0.5) * 0.2), '#5e5b52', { windows: 'rgba(15,15,15,0.85)' });
      box(g, v, x + c * p.w * 0.28, y + sn * p.w * 0.28, p.w * 0.4, p.d * 0.9, p.h * 1.5, rot, '#6d6a60', '#4e4b43', { windows: 'rgba(15,15,15,0.85)' });
      for (let k = 0; k < 6; k++) { const a = k * 1.1 + p.r, d = Math.max(p.w, p.d) * 0.62 + (k % 3) * 8; disc(g, v, x + Math.cos(a) * d, y + Math.sin(a) * d, 2, 7 + (k % 3) * 3, shade('#6f6b60', (k % 2) * 0.15 - 0.1)); }
      break;
    }
    case 'sandbags': {
      const c = Math.cos(p.r), sn = Math.sin(p.r);
      for (let row = 0; row < 2; row++) for (let k = 0; k < 5 - row; k++) { const u = (k - 2 + row * 0.5) * 16; shadowEllipse(g, v, x + c * u, y + sn * u, 9, 6, 0.2); disc(g, v, x + c * u, y + sn * u, row * 7, 9.5, shade('#b79b66', row * 0.1 - 0.12)); disc(g, v, x + c * u - 1, y + sn * u - 1, row * 7 + 3, 6, shade('#c9ad77', row * 0.08)); }
      break;
    }
    case 'tankwreck': {
      const rot = p.r; box(g, v, x, y, 74, 40, 16, rot, '#4a3f30', '#5a4d3a', {});
      shadowEllipse(g, v, x, y, 26, 18, 0.25); disc(g, v, x, y, 26, 14, '#3d352a'); disc(g, v, x, y, 30, 10, '#4e4436');
      g.strokeStyle = '#2a251d'; g.lineWidth = 5 * v.zoom; g.lineCap = 'round'; g.beginPath(); g.moveTo(v.px(x, y, 30), v.py(x, y, 30)); g.lineTo(v.px(x + Math.cos(rot + 0.5) * 42, y + Math.sin(rot + 0.5) * 42, 24), v.py(x + Math.cos(rot + 0.5) * 42, y + Math.sin(rot + 0.5) * 42, 24)); g.stroke();
      if (Math.sin(t * 2 + p.v * 20) > -0.3) disc(g, v, x + 6, y - 4, 36 + Math.sin(t * 3 + p.v * 9) * 3, 6, 'rgba(255,120,30,0.35)');
      break;
    }
    case 'crater': { const X = v.sx(x), Y = v.sy(y), R = 38 * s * v.zoom; g.save(); g.translate(X, Y); g.rotate(p.r); g.scale(1, 0.82); g.drawImage(craterSprite(), -R, -R, R * 2, R * 2); g.restore(); break; }
    case 'adobe': case 'cabin': case 'building': case 'hut': case 'tower': {
      const [wc, rc] = WALLCOL[p.type]; const night = th.night;
      const rot = p.al ? p.r : Math.round(p.r / (Math.PI / 2)) * (Math.PI / 2) + (p.v - 0.5) * 0.2;
      const ty = p.type, small = !p.al && (ty === 'hut') ? 0.6 : 1, wcol = shade(wc, ((p.v * 7) % 1 - 0.5) * 0.3);
      const o = ty === 'cabin' ? { gable: true, roof: 'grey', roofA: 0.22 } : ty === 'hut' ? { gable: true } : ty === 'adobe' ? { flat: true, seed: p.v } : { flat: true, seed: p.v };
      o.windows = night ? (ty === 'hut' || ty === 'adobe' || ty === 'cabin' ? null : '#ffe9a0') : (ty === 'building' || ty === 'tower' ? 'rgba(160,200,230,0.65)' : null);
      box(g, v, x, y, p.w * small, p.d * small, ty === 'hut' ? Math.min(p.h || 38, 38) : p.h, rot, wcol, ty === 'hut' ? '#c9a24f' : rc, o);
      break;
    }
    case 'container': {
      const cols = ['#c0392b', '#2e86c1', '#d68910', '#27ae60', '#7d3c98', '#cfd8dc'];
      const c = cols[Math.floor(p.v * 6)]; const rot = p.al ? p.r : Math.round(p.r / (Math.PI / 2)) * (Math.PI / 2);
      box(g, v, x, y, 100, 36, 34, rot, c, shade(c, 0.12));
      if (p.v > 0.5) box(g, v, x + Math.cos(rot + Math.PI / 2) * 0, y, 100, 36, 34, rot, c, shade(c, 0.12));
      break;
    }
    case 'tank': {
      shadowEllipse(g, v, x, y, 70, 44, 0.3);
      for (let L = 0; L <= 10; L++) { const h = L * 8, ss = v.scale(h); g.fillStyle = shade('#aeb4bb', -0.35 + L * 0.03); g.beginPath(); g.arc(v.px(x, y, h), v.py(x, y, h), 54 * ss, 0, TAU); g.fill(); }
      const h = 88; disc(g, v, x, y, h, 54, '#cbd1d8'); disc(g, v, x, y, h + 2, 40, '#b4bbc3'); disc(g, v, x + 10, y - 8, h + 6, 8, '#6d737a');
      break;
    }
    case 'barrels': { for (let k = 0; k < 4; k++) { const bx = x + (k % 2) * 18 - 9, by = y + ((k >> 1) * 18) - 9; shadowEllipse(g, v, bx, by, 9, 6, 0.25); for (let L = 0; L < 3; L++) disc(g, v, bx, by, L * 6, 8, shade(k % 2 ? '#c0392b' : '#2e6f9e', -0.25 + L * 0.15)); disc(g, v, bx, by, 19, 6, '#555'); } break; }
    case 'crane': {
      const h = 210; shadowEllipse(g, v, x, y, 30, 12, 0.2);
      g.strokeStyle = '#d6a21a'; g.lineWidth = 6 * v.zoom;
      for (const [dx, dy] of [[-12, -12], [12, -12], [12, 12], [-12, 12]]) { g.beginPath(); g.moveTo(v.px(x + dx, y + dy, 0), v.py(x + dx, y + dy, 0)); g.lineTo(v.px(x + dx * 0.4, y + dy * 0.4, h), v.py(x + dx * 0.4, y + dy * 0.4, h)); g.stroke(); }
      g.lineWidth = 8 * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, h), v.py(x, y, h)); g.lineTo(v.px(x + Math.cos(p.r) * 150, y + Math.sin(p.r) * 150, h), v.py(x + Math.cos(p.r) * 150, y + Math.sin(p.r) * 150, h)); g.stroke();
      g.beginPath(); g.moveTo(v.px(x, y, h), v.py(x, y, h)); g.lineTo(v.px(x - Math.cos(p.r) * 60, y - Math.sin(p.r) * 60, h), v.py(x - Math.cos(p.r) * 60, y - Math.sin(p.r) * 60, h)); g.stroke();
      disc(g, v, x - Math.cos(p.r) * 60, y - Math.sin(p.r) * 60, h, 12, '#555'); break;
    }
    case 'billboard': {
      shadowEllipse(g, v, x, y, 50, 10, 0.2);
      const rot = p.r, c = Math.cos(rot), s2 = Math.sin(rot);
      g.strokeStyle = '#444'; g.lineWidth = 5 * v.zoom;
      for (const sd of [-30, 30]) { g.beginPath(); g.moveTo(v.px(x + c * sd, y + s2 * sd, 0), v.py(x + c * sd, y + s2 * sd, 0)); g.lineTo(v.px(x + c * sd, y + s2 * sd, 85), v.py(x + c * sd, y + s2 * sd, 85)); g.stroke(); }
      const cols = ['#ff2d95', '#18e0ff', '#ffe600', '#7dff3a'], col = cols[Math.floor(p.v * 4)];
      g.fillStyle = '#111'; g.beginPath(); for (const [a, b] of [[-42, 85], [42, 85], [42, 128], [-42, 128]]) { const X = v.px(x + c * a, y + s2 * a, b), Y = v.py(x + c * a, y + s2 * a, b); g.lineTo(X, Y); } g.closePath(); g.fill();
      g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 9 * v.zoom; g.stroke(); g.globalAlpha = 1; g.lineWidth = 3 * v.zoom; g.stroke(); // neon edge (no shadowBlur: very slow on the GPU)
      break;
    }
    case 'tyres': {
      for (let k = 0; k < 3; k++) { const ox2 = Math.cos(p.r) * (k - 1) * 14, oy2 = Math.sin(p.r) * (k - 1) * 14; shadowEllipse(g, v, x + ox2, y + oy2, 8, 5, 0.25); disc(g, v, x + ox2, y + oy2, 0, 8, '#1b1b1b'); disc(g, v, x + ox2, y + oy2, 7, 8, '#262626'); disc(g, v, x + ox2, y + oy2, 7.5, 3.5, k % 2 ? '#c0392b' : '#ddd'); }
      break;
    }
    case 'lamp': {
      g.strokeStyle = '#333'; g.lineWidth = 3 * v.zoom; g.beginPath(); g.moveTo(v.px(x, y, 0), v.py(x, y, 0)); g.lineTo(v.px(x, y, 80), v.py(x, y, 80)); g.stroke();
      disc(g, v, x, y, 82, 4, '#fff6c0'); break;
    }
    default: shadowEllipse(g, v, x, y, 10, 6); disc(g, v, x, y, 10, 8, '#777');
  }
}
/** additive glow passes for lamps / lava / spires (night themes) */
const GLOWS = new Map();
/** pre-rendered soft radial glow (drawn scaled with drawImage instead of building a gradient every frame) */
export function glowSprite(rgb, a0) {
  const k = rgb + a0; let c = GLOWS.get(k); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const C = a => rgb[0] === '#' ? rgba(rgb, a) : `rgba(${rgb},${a})`; gr.addColorStop(0, C(a0)); gr.addColorStop(0.5, C(a0 * 0.38)); gr.addColorStop(1, C(0)); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); GLOWS.set(k, c); return c;
}
let CRATER = null;
function craterSprite() {
  if (CRATER) return CRATER; const c = CRATER = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'), gr = x.createRadialGradient(48, 48, 7, 48, 48, 48);
  gr.addColorStop(0, 'rgba(10,8,6,0.85)'); gr.addColorStop(0.7, 'rgba(30,24,18,0.7)'); gr.addColorStop(0.9, 'rgba(120,105,80,0.5)'); gr.addColorStop(1, 'rgba(120,105,80,0)'); x.fillStyle = gr; x.fillRect(0, 0, 96, 96); return c;
}
export const glow = (g, X, Y, r, rgb, a0) => g.drawImage(glowSprite(rgb, a0), X - r, Y - r, r * 2, r * 2);
export function drawProp2Glow(g, v, p, t) {
  if (p.type === 'lamp') {
    glow(g, v.sx(p.x), v.sy(p.y), 190 * v.zoom, '255,230,160', 0.38);
    glow(g, v.px(p.x, p.y, 82), v.py(p.x, p.y, 82), 16 * v.zoom, '255,240,190', 0.8);
  } else if (p.type === 'spire') glow(g, v.sx(p.x), v.sy(p.y), 90 * v.zoom, '255,100,20', 0.35);
  else if (p.type === 'lava') glow(g, v.sx(p.x), v.sy(p.y), 140 * v.zoom, '255,100,20', 0.28);
}

/* ------------------------------------------------------------------ pickups & hazards */
export const ITEM_COL = { repair: '#ff4d4d', ammo: '#ffd23a', cash: '#4cff7a', nitro: '#3ab8ff' };
export function drawItem(g, v, it, t) {
  const x = it.x, y = it.y, iz = it.z || 0, SX = v.px(x, y, iz), SY = v.py(x, y, iz);
  if (it.t === 'boost') {
    g.save(); g.translate(SX, SY); g.rotate(it.a); g.scale(v.zoom, v.zoom);
    g.fillStyle = 'rgba(0,10,30,0.55)'; g.fillRect(-34, -28, 68, 56);
    for (let k = 0; k < 3; k++) { const o = ((t * 2 + k * 0.33) % 1); g.globalAlpha = Math.sin(o * Math.PI); g.fillStyle = '#31e2ff'; const px = -26 + o * 52; g.beginPath(); g.moveTo(px + 12, 0); g.lineTo(px - 4, -20); g.lineTo(px - 12, -20); g.lineTo(px + 4, 0); g.lineTo(px - 12, 20); g.lineTo(px - 4, 20); g.closePath(); g.fill(); }
    g.restore(); return;
  }
  if (it.t === 'oil') {
    g.save(); g.translate(SX, SY); g.scale(v.zoom, v.zoom * 0.85);
    const gr = g.createRadialGradient(-6, -6, 2, 0, 0, 40); gr.addColorStop(0, 'rgba(60,70,90,0.95)'); gr.addColorStop(0.6, 'rgba(10,10,14,0.92)'); gr.addColorStop(1, 'rgba(10,10,14,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 42, 30, 0.4, 0, TAU); g.fill();
    g.strokeStyle = `hsla(${(t * 60) % 360},80%,60%,0.35)`; g.lineWidth = 2; g.beginPath(); g.ellipse(-4, -3, 22, 14, 0.4, 0, TAU); g.stroke(); g.restore(); return;
  }
  const col = ITEM_COL[it.t] || '#fff', bob = iz + 9 + Math.sin(t * 3 + it.id) * 2.5;
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(SX + 6 * v.zoom, SY + 6 * v.zoom, 14 * v.zoom, 8 * v.zoom, 0, 0, TAU); g.fill();
  glow(g, SX, SY, 34 * v.zoom, col, 0.5);
  const X = v.px(x, y, bob), Y = v.py(x, y, bob), s = v.scale(bob);
  g.save(); g.translate(X, Y); g.scale(s, s); g.rotate(Math.sin(t * 2 + it.id) * 0.2);
  g.fillStyle = '#10131a'; g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.roundRect(-12, -12, 24, 24, 5); g.fill(); g.stroke();
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
  if (it.t === 'repair') { g.fillRect(-2.5, -8, 5, 16); g.fillRect(-8, -2.5, 16, 5); }
  else if (it.t === 'ammo') { for (const dx of [-5, 0, 5]) { g.fillRect(dx - 1.5, -7, 3, 11); g.beginPath(); g.moveTo(dx - 1.5, -7); g.lineTo(dx, -10); g.lineTo(dx + 1.5, -7); g.fill(); } }
  else if (it.t === 'cash') { g.font = 'bold 17px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 1); }
  else if (it.t === 'nitro') { g.beginPath(); g.moveTo(0, -9); g.quadraticCurveTo(8, -1, 4, 6); g.quadraticCurveTo(0, 10, -4, 6); g.quadraticCurveTo(-8, -1, 0, -9); g.fill(); }
  g.restore();
}

/* ------------------------------------------------------------------ cars */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
/** draw one layer of a car in local space at height h (car faces +x) */
function layer(g, v, c, h, fn) {
  h += (c.z || 0) + (c.rampZ || 0);
  const s = v.scale(h), cs = Math.cos(c.a), sn = Math.sin(c.a);
  g.save(); g.setTransform(s * cs, s * sn, -s * sn, s * cs, v.px(c.x, c.y, h), v.py(c.x, c.y, h)); fn(); g.restore();
}

/** visible equipment: armour plating, spikes, turret, rear guard, missile pods */
function drawMods(g, v, c, t) {
  const m = c.mods; if (!m) return; const L = c.len, Wd = c.wid, hl = L / 2, hwid = Wd / 2;
  const steel = '#9aa4b2', dark = '#5c6573', bolt = '#d7dde6';
  if (m.armor > 0) layer(g, v, c, 11, () => {
    g.fillStyle = steel; g.fillRect(-hl * 0.66, -hwid - 0.6, L * 0.62, 3.6); g.fillRect(-hl * 0.66, hwid - 3, L * 0.62, 3.6);
    g.fillStyle = dark; g.fillRect(-hl * 0.66, -hwid + 2.3, L * 0.62, 0.9); g.fillRect(-hl * 0.66, hwid - 3.2, L * 0.62, 0.9);
    if (m.armor >= 2) { g.fillStyle = steel; rr(g, hl * 0.12, -hwid * 0.58, hl * 0.78, hwid * 1.16, 3); g.fill(); g.strokeStyle = dark; g.lineWidth = 1; g.beginPath(); for (let k = 0; k < 3; k++) { g.moveTo(hl * 0.2 + k * 5, -hwid * 0.5); g.lineTo(hl * 0.3 + k * 5, 0); g.lineTo(hl * 0.2 + k * 5, hwid * 0.5); } g.stroke(); }
    if (m.armor >= 3) { g.fillStyle = dark; g.fillRect(-hl * 0.7, -hwid * 0.62, 2.4, hwid * 1.24); g.fillRect(-hl * 0.1, -hwid * 0.7, 2.4, hwid * 1.4); g.fillStyle = steel; g.fillRect(-hl * 0.66, -hwid * 0.7, 1.8, hwid * 1.4); }
    if (m.armor >= 4) { g.fillStyle = bolt; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(-hl * 0.6 + k * (L * 0.58 / 5), -hwid + 1.2, 0.8, 0, TAU); g.arc(-hl * 0.6 + k * (L * 0.58 / 5), hwid - 1.2, 0.8, 0, TAU); g.fill(); } g.strokeStyle = '#ffd23a'; g.lineWidth = 1; g.strokeRect(-hl * 0.64, -hwid + 0.2, L * 0.58, Wd - 0.4); }
  });
  const spikeRow = (x, dir, lv) => layer(g, v, c, 7, () => {
    const n = 2 + lv * 2, len = 4.5 + lv * 2.4; g.fillStyle = '#cfd6df'; g.strokeStyle = '#6b7380'; g.lineWidth = 0.6;
    g.fillStyle = dark; g.fillRect(x - (dir > 0 ? 1.5 : 0.5), -hwid + 1, 2, Wd - 2); g.fillStyle = '#cfd6df';
    for (let k = 0; k < n; k++) { const y = -hwid + 2.5 + (k + 0.5) * (Wd - 5) / n; g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x + dir * len, y); g.lineTo(x, y + 2); g.closePath(); g.fill(); g.stroke(); }
  });
  if (m.fs) spikeRow(hl, 1, m.fs); if (m.rs) spikeRow(-hl, -1, m.rs);
  if (m.ws) { const sp = Math.hypot(c.vx || 0, c.vy || 0); for (const [wx, wy] of [[hl * 0.62, -1], [hl * 0.62, 1], [-hl * 0.62, -1], [-hl * 0.62, 1]]) layer(g, v, c, 4, () => {
    g.translate(wx, wy * (hwid + 0.5)); g.rotate(t * (2 + sp / 90) * wy); const len = 3.6 + m.ws * 1.7; g.fillStyle = '#d5dae0'; g.strokeStyle = '#6b7380'; g.lineWidth = 0.5;
    for (let k = 0; k < 6; k++) { g.save(); g.rotate(k * Math.PI / 3); g.beginPath(); g.moveTo(1.2, -1.4); g.lineTo(1.2 + len, 0); g.lineTo(1.2, 1.4); g.closePath(); g.fill(); g.stroke(); g.restore(); } g.fillStyle = '#333'; g.beginPath(); g.arc(0, 0, 1.8, 0, TAU); g.fill(); }); }
  if (m.homing) layer(g, v, c, 16, () => { for (const s of [-1, 1]) { g.fillStyle = '#2d3340'; rr(g, hl * 0.12, s * hwid * 0.62 - 2.4, hl * 0.62, 4.8, 1.4); g.fill(); g.fillStyle = '#cfe8ff'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(hl * 0.68 - k * 4.2, s * hwid * 0.62, 1.3, 0, TAU); g.fill(); } } });
  if (m.cluster) layer(g, v, c, 17, () => { g.fillStyle = '#4a5a3a'; g.beginPath(); g.arc(-hl * 0.72, 0, 4.6, 0, TAU); g.fill(); g.strokeStyle = '#d8c64a'; g.lineWidth = 1.4; g.beginPath(); g.arc(-hl * 0.72, 0, 3, 0, TAU); g.stroke(); });
  if (m.guard) layer(g, v, c, 24, () => {
    g.translate(-hl * 0.52, 0); g.fillStyle = '#2d3340'; rr(g, -4, -4, 8, 8, 2); g.fill(); g.save(); g.rotate(t * 3); g.strokeStyle = '#9fe3ff'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 6, -0.7, 0.7); g.stroke(); g.restore();
    for (let k = 0; k < m.guard; k++) { g.fillStyle = k < (c.guard ?? m.guard) ? '#46ff7a' : '#444'; g.beginPath(); g.arc(-3 + k * 3, 4.8, 0.95, 0, TAU); g.fill(); }
    if (c.guardFlash > 0) { g.strokeStyle = `rgba(120,220,255,${c.guardFlash * 2})`; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 14 + (0.35 - c.guardFlash) * 40, 0, TAU); g.stroke(); }
  });
  if (m.turret) layer(g, v, c, 24, () => {
    g.fillStyle = '#2b303b'; g.beginPath(); g.arc(hl * 0.02, 0, 5.4, 0, TAU); g.fill(); g.strokeStyle = '#7f8999'; g.lineWidth = 1; g.stroke();
    g.save(); g.translate(hl * 0.02, 0); g.rotate((c.turA ?? c.a) - c.a); g.fillStyle = '#4f5868'; g.fillRect(0, -1.5, 9 + m.turret * 1.5, 3); g.fillStyle = '#20242c'; g.fillRect(8 + m.turret * 1.5, -1.9, 2.6, 3.8); g.fillStyle = '#7dffe8'; g.beginPath(); g.arc(-1, 0, 1.4, 0, TAU); g.fill(); g.restore();
  });
}

let FLAME = null, BEAM = null; const TAGS = new Map();
/** name tags are rendered once (text drawing every frame is surprisingly expensive) */
function tagSprite(name, col) {
  const k = name + col; let c = TAGS.get(k); if (c) return c; c = document.createElement('canvas'); const x = c.getContext('2d'); x.font = 'bold 24px "Trebuchet MS", sans-serif';
  c.width = Math.ceil(x.measureText(name).width) + 12; c.height = 30; x.font = 'bold 24px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.lineJoin = 'round'; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.strokeText(name, c.width / 2, 24); x.fillStyle = col; x.fillText(name, c.width / 2, 24); TAGS.set(k, c); return c;
}
function flameSprite() { if (FLAME) return FLAME; const c = FLAME = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d'), gr = x.createLinearGradient(64, 0, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, 'rgba(80,190,255,0.85)'); gr.addColorStop(1, 'rgba(40,80,255,0)'); x.fillStyle = gr; x.beginPath(); x.moveTo(64, 0); x.lineTo(0, 8); x.lineTo(64, 16); x.fill(); return c; }
function beamSprite() { if (BEAM) return BEAM; const c = BEAM = document.createElement('canvas'); c.width = 117; c.height = 75; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 117, 0);
  gr.addColorStop(0, 'rgba(255,245,200,0.45)'); gr.addColorStop(1, 'rgba(255,245,200,0)'); x.fillStyle = gr; x.beginPath(); x.moveTo(0, 34); x.lineTo(117, 0); x.lineTo(117, 75); x.lineTo(0, 41); x.closePath(); x.fill(); return c; }
export function drawCar(g, v, c, t, opts = {}) {
  const L = c.len, Wd = c.wid, col = c.color, hl = L / 2, hwid = Wd / 2;
  if (c.dead) return;
  const flash = c.invuln > 0 && Math.floor(t * 14) % 2 === 0;
  if (flash) g.globalAlpha = 0.45; else if (opts.alpha != null) g.globalAlpha = opts.alpha;
  // shadow
  { const zr = c.zRoad || 0, air = c.zAir || 0, sc = v.scale(zr); g.save(); g.setTransform(sc * Math.cos(c.a), sc * Math.sin(c.a), -sc * Math.sin(c.a), sc * Math.cos(c.a), v.px(c.x, c.y, zr) + (7 + air * 0.35) * v.zoom, v.py(c.x, c.y, zr) + (9 + air * 0.3) * v.zoom); g.fillStyle = `rgba(0,0,0,${0.34 / (1 + air / 60)})`; rr(g, -hl - 1, -hwid - 1, L + 2, Wd + 2, 7); g.fill(); g.restore(); }
  // night headlights
  if (opts.night) {
    g.save(); g.globalCompositeOperation = 'lighter'; g.setTransform(v.zoom * Math.cos(c.a), v.zoom * Math.sin(c.a), -v.zoom * Math.sin(c.a), v.zoom * Math.cos(c.a), v.px(c.x, c.y, c.z || 0), v.py(c.x, c.y, c.z || 0));
    g.drawImage(beamSprite(), hl - 4, -75, 234, 150); g.restore();
  }
  // nitro flame
  if (c.nitroOn) {
    g.save(); g.globalCompositeOperation = 'lighter'; const fl = 26 + Math.random() * 16;
    layer(g, v, c, 5, () => g.drawImage(flameSprite(), -hl - fl, -5, fl, 10));
    g.restore();
  }
  // wheels
  const steer = (c.steerVis || 0) * 0.45;
  const wheel = (wx, wy, a) => layer(g, v, c, 3, () => { g.translate(wx, wy); g.rotate(a); g.fillStyle = '#0c0c0c'; rr(g, -5.2, -2.6, 10.4, 5.2, 1.6); g.fill(); });
  const wx = hl * 0.62, wy = hwid + 0.5;
  wheel(wx, -wy, steer); wheel(wx, wy, steer); wheel(-wx, -wy, 0); wheel(-wx, wy, 0);
  const dark = shade(col, -0.45), mid = shade(col, -0.2), light = shade(col, 0.2);
  const shape = c.shape;
  // lower body
  layer(g, v, c, 5, () => {
    g.fillStyle = dark; rr(g, -hl, -hwid, L, Wd, shape === 'buggy' ? 4 : 7); g.fill();
    if (shape === 'buggy') { g.fillStyle = '#222'; g.fillRect(-hl * 0.5, -hwid, hl, Wd); }
  });
  layer(g, v, c, 9, () => {
    g.fillStyle = mid; rr(g, -hl + 1, -hwid + 1, L - 2, Wd - 2, shape === 'sport' ? 9 : 6); g.fill();
    // brake lights
    g.fillStyle = c.braking ? '#ff3a3a' : '#7a1212'; g.fillRect(-hl + 1, -hwid + 2, 3, 4); g.fillRect(-hl + 1, hwid - 6, 3, 4);
    g.fillStyle = '#fff2b8'; g.fillRect(hl - 3, -hwid + 2, 3, 4); g.fillRect(hl - 3, hwid - 6, 3, 4);
  });
  layer(g, v, c, 13, () => { // hood / top
    g.fillStyle = col; rr(g, -hl + 3, -hwid + 2, L - 6, Wd - 4, shape === 'sport' ? 9 : 5); g.fill();
    g.fillStyle = light; g.globalAlpha *= 0.55; g.fillRect(hl * 0.05, -1.4, hl * 0.85, 2.8); g.globalAlpha = flash ? 0.45 : 1;
    if (shape === 'muscle') { g.fillStyle = '#10101099'; g.fillRect(hl * 0.35, -3, hl * 0.4, 6); }
    if (shape === 'truck') { g.fillStyle = shade(col, -0.3); g.fillRect(-hl + 4, -hwid + 4, L * 0.38, Wd - 8); }
  });
  // cabin
  layer(g, v, c, 19, () => {
    const cw = shape === 'truck' ? L * 0.3 : L * 0.38, off = shape === 'sport' ? -hl * 0.08 : shape === 'truck' ? hl * 0.12 : -hl * 0.12;
    if (shape === 'tank') { g.fillStyle = shade(col, -0.1); g.beginPath(); g.arc(-1, 0, hwid * 0.72, 0, TAU); g.fill(); g.fillStyle = '#222'; g.fillRect(0, -1.8, hl + 6, 3.6); return; }
    if (shape === 'buggy') { g.strokeStyle = '#ddd'; g.lineWidth = 1.8; g.strokeRect(off - cw / 2, -hwid + 4, cw, Wd - 8); g.fillStyle = '#1d2230'; g.fillRect(off - 4, -3.5, 8, 7); return; }
    g.fillStyle = '#12161f'; rr(g, off - cw / 2, -hwid + 3.5, cw, Wd - 7, 4); g.fill();
    g.fillStyle = 'rgba(140,190,255,0.35)'; rr(g, off - cw / 2 + 1, -hwid + 4.5, cw * 0.45, Wd - 9, 3); g.fill();
    g.fillStyle = shade(col, 0.05); rr(g, off - cw / 2 + cw * 0.28, -hwid + 5, cw * 0.5, Wd - 10, 3); g.fill();
  });
  if (shape === 'sport' || shape === 'muscle') layer(g, v, c, 21, () => { g.fillStyle = shade(col, -0.35); g.fillRect(-hl - 1, -hwid + 1, 4, Wd - 2); });
  if (c.braking) layer(g, v, c, 9, () => { g.globalCompositeOperation = 'lighter'; const spr = glowSprite('255,40,30', 0.8); for (const sy of [-1, 1]) g.drawImage(spr, -hl - 16, sy * (hwid - 4) - 16, 32, 32); });
  drawMods(g, v, c, t);
  // damage overlay
  const hpf = c.hp / c.maxHp;
  if (hpf < 0.6) layer(g, v, c, 14, () => { g.fillStyle = `rgba(20,10,5,${(0.6 - hpf) * 0.8})`; g.beginPath(); g.ellipse(hl * 0.25, 3, hl * 0.4, hwid * 0.5, 0.4, 0, TAU); g.fill(); g.beginPath(); g.ellipse(-hl * 0.4, -4, hl * 0.28, hwid * 0.4, 0, 0, TAU); g.fill(); });
  g.globalAlpha = 1;
  if (opts.tag) { // name tag
    const X = v.px(c.x, c.y, 34), Y = v.py(c.x, c.y, 34) - 14 * v.zoom;
    const tg = tagSprite(c.name, opts.tagColor || '#fff'), sc = Math.max(10, 12 * v.zoom) / 24; g.drawImage(tg, X - tg.width * sc / 2, Y - 19 * sc, tg.width * sc, tg.height * sc);
    const w = 34 * v.zoom; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(X - w / 2, Y + 3, w, 4 * v.zoom); g.fillStyle = hpf > 0.5 ? '#46d16a' : hpf > 0.25 ? '#f2c230' : '#e8402f'; g.fillRect(X - w / 2, Y + 3, w * clamp(hpf, 0, 1), 4 * v.zoom);
  }
}

/* ------------------------------------------------------------------ projectiles */
export function drawProjectile(g, v, p, t) {
  const pz = p.z || 9;
  if (p.type === 'mg') {
    const X = v.px(p.x, p.y, pz), Y = v.py(p.x, p.y, pz), l = 16 * v.zoom, a = Math.atan2(p.vy, p.vx);
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = p.turret ? 'rgba(120,255,230,0.95)' : 'rgba(255,200,80,0.95)'; g.lineWidth = 2.4 * v.zoom; g.lineCap = 'round'; g.beginPath(); g.moveTo(X, Y); g.lineTo(X - Math.cos(a) * l, Y - Math.sin(a) * l); g.stroke(); g.restore();
  } else if (p.type === 'rocket' || p.type === 'homing') {
    const hm = p.type === 'homing', a = Math.atan2(p.vy, p.vx), X = v.px(p.x, p.y, pz + 5), Y = v.py(p.x, p.y, pz + 5), L = (hm ? 70 : 60) * v.zoom;
    g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(X, Y, X - Math.cos(a) * L, Y - Math.sin(a) * L); gr.addColorStop(0, hm ? 'rgba(160,255,255,0.95)' : 'rgba(255,220,120,0.9)'); gr.addColorStop(1, hm ? 'rgba(40,160,255,0)' : 'rgba(255,80,20,0)');
    g.strokeStyle = gr; g.lineWidth = (hm ? 7 : 9) * v.zoom; g.lineCap = 'round'; g.beginPath(); g.moveTo(X, Y); g.lineTo(X - Math.cos(a) * L, Y - Math.sin(a) * L); g.stroke(); g.restore();
    g.save(); g.translate(X, Y); g.rotate(a); g.scale(v.zoom, v.zoom); g.fillStyle = hm ? '#cfe8ff' : '#d8d8d8'; rr(g, -9, -3, 18, 6, 2); g.fill(); g.fillStyle = hm ? '#1e88e5' : '#c0392b'; g.beginPath(); g.moveTo(9, -3); g.lineTo(15, 0); g.lineTo(9, 3); g.fill(); g.fillStyle = '#555'; g.fillRect(-9, -6, 4, 3); g.fillRect(-9, 3, 4, 3); g.restore();
  } else if (p.type === 'cluster') {
    const X = v.px(p.x, p.y, pz + 10), Y = v.py(p.x, p.y, pz + 10);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(v.px(p.x, p.y, 0) + 5, v.py(p.x, p.y, 0) + 6, 7 * v.zoom, 5 * v.zoom, 0, 0, TAU); g.fill();
    g.save(); g.translate(X, Y); g.scale(v.zoom, v.zoom); g.rotate(t * 9); g.fillStyle = '#4a5a3a'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.fillStyle = '#c8d86a'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(Math.cos(k) * 4.2, Math.sin(k) * 4.2, 1.6, 0, TAU); g.fill(); } g.restore();
  } else if (p.type === 'bomblet') {
    const X = v.px(p.x, p.y, pz + 4), Y = v.py(p.x, p.y, pz + 4);
    g.fillStyle = '#2a2d22'; g.beginPath(); g.arc(X, Y, 4.2 * v.zoom, 0, TAU); g.fill(); g.fillStyle = Math.floor(t * 14) % 2 ? '#ff4a2a' : '#661a10'; g.beginPath(); g.arc(X, Y, 1.8 * v.zoom, 0, TAU); g.fill();
  }
}
/** mines: hazard-striped, with a pulsing warning ring and a flashing light so they read clearly at speed */
export function drawMine(g, v, m, t) {
  const armed = m.arm <= 0, X = v.px(m.x, m.y, 3 + (m.z || 0)), Y = v.py(m.x, m.y, 3 + (m.z || 0)), z = v.zoom, ph = (t * 1.6 + (m.x + m.y) * 0.01) % 1, flash = Math.floor(t * 4) % 2;
  // warning ring on the ground (grows and fades) + glow
  if (armed) { g.strokeStyle = `rgba(255,60,40,${0.75 * (1 - ph)})`; g.lineWidth = 3 * z; g.beginPath(); g.arc(X, Y, (16 + ph * 30) * z, 0, TAU); g.stroke(); g.globalCompositeOperation = 'lighter'; glow(g, X, Y - 1 * z, (flash ? 30 : 20) * z, '255,50,30', flash ? 0.7 : 0.35); g.globalCompositeOperation = 'source-over'; }
  g.save(); g.translate(X, Y); g.scale(z, z);
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(3, 3, 15, 10, 0, 0, TAU); g.fill();
  g.fillStyle = '#f2c500'; g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill(); // yellow/black hazard rim
  g.fillStyle = '#111'; for (let k = 0; k < 6; k++) { const a0 = k * TAU / 6 + t * 0.6; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 14, a0, a0 + TAU / 12); g.closePath(); g.fill(); }
  g.fillStyle = '#2b2d33'; g.beginPath(); g.arc(0, 0, 9.5, 0, TAU); g.fill(); g.fillStyle = '#4a4d57'; g.beginPath(); g.arc(-1, -2, 6.5, 0, TAU); g.fill();
  g.fillStyle = armed ? (flash ? '#ff3b2b' : '#8a1a1a') : '#3a7a3a'; g.beginPath(); g.arc(0, -1, 4, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(-1.4, -2.4, 1.3, 0, TAU); g.fill();
  g.restore();
}

/* ------------------------------------------------------------------ particles */
let _glow = null;
function fireSprite() {
  if (_glow) return _glow; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,80,0.9)'); gr.addColorStop(0.6, 'rgba(255,90,10,0.45)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (_glow = c);
}
const PUFFS = new Map();
/** soft round puff for smoke/spray, one per colour (drawImage is far cheaper than a path fill per particle) */
function puffSprite(col) {
  let c = PUFFS.get(col); if (c) return c; c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d'), gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.55, `rgba(${col},0.85)`); gr.addColorStop(1, `rgba(${col},0)`); x.fillStyle = gr; x.fillRect(0, 0, 48, 48); PUFFS.set(col, c); return c;
}
export class Particles {
  constructor() { this.list = []; this.max = 700; }
  add(p) { if (this.list.length < this.max) this.list.push(p); }
  smoke(x, y, vx, vy, size = 10, life = 0.8, col = '90,90,90', a = 0.5) { this.add({ k: 's', x, y, vx, vy, life, max: life, size, col, a }); }
  fire(x, y, vx, vy, size = 10, life = 0.5) { this.add({ k: 'f', x, y, vx, vy, life, max: life, size }); }
  spark(x, y, vx, vy, life = 0.35, col = '255,210,90') { this.add({ k: 'p', x, y, vx, vy, life, max: life, col }); }
  debris(x, y, vx, vy, col = '#333') { this.add({ k: 'd', x, y, vx, vy, life: 0.9 + Math.random() * 0.6, max: 1.4, col, a: Math.random() * 6, w: (Math.random() - 0.5) * 18, size: 2 + Math.random() * 3 }); }
  ring(x, y, r, life = 0.35, col = '255,200,120') { this.add({ k: 'r', x, y, vx: 0, vy: 0, life, max: life, size: r, col }); }
  explosion(x, y, big = 1) {
    this.ring(x, y, 70 * big);
    for (let i = 0; i < 18 * big; i++) { const a = Math.random() * TAU, s = (60 + Math.random() * 280) * big; this.fire(x, y, Math.cos(a) * s, Math.sin(a) * s, 14 + Math.random() * 16, 0.4 + Math.random() * 0.5); }
    for (let i = 0; i < 14 * big; i++) { const a = Math.random() * TAU, s = 30 + Math.random() * 140; this.smoke(x, y, Math.cos(a) * s, Math.sin(a) * s - 20, 16 + Math.random() * 18, 1 + Math.random() * 1.2, '40,40,40', 0.65); }
    for (let i = 0; i < 16 * big; i++) { const a = Math.random() * TAU, s = 100 + Math.random() * 380; this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.4 + Math.random() * 0.5); }
    for (let i = 0; i < 8 * big; i++) { const a = Math.random() * TAU, s = 80 + Math.random() * 260; this.debris(x, y, Math.cos(a) * s, Math.sin(a) * s, Math.random() < 0.5 ? '#2a2a2a' : '#6b3a22'); }
  }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]; p.life -= dt; if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 's') { p.vx *= 0.97; p.vy *= 0.97; p.size += 14 * dt; }
      else if (p.k === 'f') { p.vx *= 0.93; p.vy *= 0.93; p.size *= 0.985; }
      else if (p.k === 'p') { p.vx *= 0.96; p.vy *= 0.96; }
      else if (p.k === 'd') { p.vx *= 0.96; p.vy *= 0.96; p.a += p.w * dt; }
    }
  }
  draw(g, v) {
    const z = v.zoom, L = this.list;
    // pass 1: normal blending (smoke, debris)
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (p.k !== 's' && p.k !== 'd') continue; if (!v.visible(p.x, p.y, 60)) continue;
      const X = v.sx(p.x), Y = v.sy(p.y), f = p.life / p.max;
      if (p.k === 's') { const r = p.size * z * 1.35; g.globalAlpha = p.a * f; g.drawImage(puffSprite(p.col), X - r, Y - (1 - f) * 20 * z - r, r * 2, r * 2); }
      else { g.save(); g.translate(X, Y - (1 - f) * 8 * z); g.rotate(p.a); g.fillStyle = p.col; g.globalAlpha = Math.min(1, f * 2); g.fillRect(-p.size * z, -p.size * z * 0.6, p.size * 2 * z, p.size * 1.2 * z); g.restore(); }
    }
    g.globalAlpha = 1;
    // pass 2: additive (fire, sparks, rings)
    g.globalCompositeOperation = 'lighter'; const spr = fireSprite();
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (p.k === 's' || p.k === 'd') continue; if (!v.visible(p.x, p.y, 60)) continue;
      const X = v.sx(p.x), Y = v.sy(p.y), f = p.life / p.max;
      if (p.k === 'f') { const r = p.size * z * 1.15; g.globalAlpha = Math.min(1, f * 1.3); g.drawImage(spr, X - r, Y - r, r * 2, r * 2); }
      else if (p.k === 'p') { g.globalAlpha = 1; g.strokeStyle = `rgba(${p.col},${f.toFixed(2)})`; g.lineWidth = 2 * z; g.beginPath(); g.moveTo(X, Y); g.lineTo(X - p.vx * 0.04 * z, Y - p.vy * 0.04 * z); g.stroke(); }
      else if (p.k === 'r') { g.globalAlpha = 1; g.strokeStyle = `rgba(${p.col},${(f * 0.8).toFixed(2)})`; g.lineWidth = 6 * f * z; g.beginPath(); g.arc(X, Y, p.size * (1 - f * 0.8) * z, 0, TAU); g.stroke(); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
}
