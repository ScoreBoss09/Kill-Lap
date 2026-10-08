// Road structures drawn as real (perspective-projected) 3D geometry: barriers, raised decks, pillars, tunnels.
import { shade, rgba, clamp, TAU } from './util.js';
import { box, View } from './sprites.js';
import Tex from './textures.js';

export const WALL_H = 15, DECK_T = 12, TUN_H = 84;
/** fill a quad with a world-anchored texture (if available) tinted towards `col`; otherwise a flat colour */
function texQuad(g, a, b, c, d, pat, col, alpha) {
  g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  if (!pat) { g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1.2; g.lineJoin = 'round'; g.fill(); g.stroke(); return; }
  g.imageSmoothingEnabled = false; g.fillStyle = pat; g.strokeStyle = pat; g.lineWidth = 1.2; g.lineJoin = 'round'; g.fill(); g.stroke(); g.imageSmoothingEnabled = true;
  g.globalAlpha = alpha; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
}
const pt = (T, i, lat) => [T.x[i] - T.ty[i] * lat, T.y[i] + T.tx[i] * lat];

/** indices of samples near the view (ascending); recomputed once per frame */
export function makeVis(T, v) {
  const out = []; const hx = v.W / v.zoom / 2 + 240, hy = v.H / v.zoom / 2 + 240;
  for (let i = 0; i < T.N; i++) if (Math.abs(T.x[i] - v.x) < hx && Math.abs(T.y[i] - v.y) < hy) out.push(i);
  return out;
}

/** 3D barriers along ground-level road (inner face + top), batched by colour */
export function drawWalls(g, v, T, vis) {
  const th = T.th, N = T.N, faces = new Map(), tops = new Map();
  const add = (m, c, a, b, cc, d) => { let p = m.get(c); if (!p) m.set(c, p = new Path2D()); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(cc[0], cc[1]); p.lineTo(d[0], d[1]); p.closePath(); };
  const fA = shade(th.wall, -0.22), fB = shade(th.wall, -0.36), tA = th.wallTop, tB = shade(th.wallTop, -0.13);
  for (const i of vis) {
    const j = (i + 1) % N; if (T.elev[i] || T.elev[j]) continue;
    for (const s of [-1, 1]) {
      if (T.wallGap && (T.wallGap[i] | T.wallGap[j]) & (s < 0 ? 1 : 2)) continue; // level crossing
      const li = s * (T.hw[i] + T.wl[i] - 1), lj = s * (T.hw[j] + T.wl[j] - 1);
      const [xi, yi] = pt(T, i, li), [xj, yj] = pt(T, j, lj), [oi, pi] = pt(T, i, li + s * 11), [oj, pj] = pt(T, j, lj + s * 11);
      const bi = [v.px(xi, yi, 0), v.py(xi, yi, 0)], bj = [v.px(xj, yj, 0), v.py(xj, yj, 0)], ti = [v.px(xi, yi, WALL_H), v.py(xi, yi, WALL_H)], tj = [v.px(xj, yj, WALL_H), v.py(xj, yj, WALL_H)];
      add(faces, (i >> 2) & 1 ? fA : fB, bi, bj, tj, ti);
      const curvy = Math.abs(T.curv[i]) > 0.0012; const tc = curvy ? ((i >> 1) & 1 ? '#f2c500' : '#262626') : ((i >> 2) & 1 ? tA : tB);
      add(tops, tc, ti, tj, [v.px(oj, pj, WALL_H), v.py(oj, pj, WALL_H)], [v.px(oi, pi, WALL_H), v.py(oi, pi, WALL_H)]);
    }
  }
  for (const [c, p] of faces) { g.fillStyle = c; g.fill(p); }
  for (const [c, p] of tops) { g.fillStyle = c; g.fill(p); }
}

export function drawDeckShadows(g, v, T, vis) {
  const N = T.N, p = new Path2D(); let any = false;
  if (T.hasTun) { const near = new Set(vis); for (const idx of tunnelRuns(T)) for (let k = 0; k < idx.length - 1; k++) { const i = idx[k], j = idx[k + 1]; if (!near.has(i)) continue; any = true; const hi = T.hw[i] + 56, hj = T.hw[j] + 56; [[i, -hi], [i, hi], [j, hj], [j, -hj]].forEach(([q, lat], n) => { const [x, y] = pt(T, q, lat); const X = v.sx(x) + 52 * v.zoom, Y = v.sy(y) + 40 * v.zoom; n ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath(); } }
  for (const i of vis) {
    const j = (i + 1) % N; if (!T.elev[i] && !T.elev[j]) continue; if (T.z[i] < 22 && T.z[j] < 22) continue; any = true; // low banked road casts no visible shadow
    const hi = T.hw[i] + T.wl[i] + 11, hj = T.hw[j] + T.wl[j] + 11, zi = T.z[i], zj = T.z[j];
    const q = [[i, -hi, zi], [i, hi, zi], [j, hj, zj], [j, -hj, zj]];
    q.forEach(([k, lat, z], n) => { const [x, y] = pt(T, k, lat); const X = v.sx(x) + z * 0.6 * v.zoom, Y = v.sy(y) + z * 0.45 * v.zoom; n ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath();
  }
  if (any) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill(p); }
}

/** raised / banked road: earthworks on tall sections, pillars on low bridges, tilted surface, parapets.
 *  Segments are grouped into height bands (drawn low to high so flyovers cover what they cross) and every band is
 *  drawn as a handful of batched paths - one fill per colour/texture - instead of a dozen draw calls per segment. */
export function drawDecks(g, v, T, vis, part = 0, parts = 1) {
  const N = T.N, th = T.th, segs = [];
  for (const i of vis) { const j = (i + 1) % N; if (T.elev[i] || T.elev[j]) segs.push(i); }
  if (!segs.length) return;
  const conc = shade(th.wall, -0.1), concTop = shade(th.wallTop, 0.05);
  const tx = v.quality > 0, pats = tx ? { rock: Tex.world(v, 'rock', T.theme), road: Tex.world(v, 'road', T.theme), wall: Tex.world(v, 'wall', T.theme), ground: Tex.world(v, 'ground', T.theme) } : {}; // lowest quality: flat colours
  if (part === 0) for (const i of segs) if (i % 6 === 0 && T.z[i] >= 18 && T.z[i] < 60 && Math.abs(T.tilt[i]) < 10) for (const s of [-0.55, 0.55]) { const [x, y] = pt(T, i, s * T.hw[i]); box(g, v, x, y, 15, 20, T.z[i] - DECK_T, T.ang[i], conc, concTop); }
  const zs = i => Math.max(T.z[i], T.z[(i + 1) % N]);
  segs.sort((a, b) => zs(a) - zs(b) || a - b);
  const mine = slice(segs, part, parts); // low-to-high order is kept across the slices
  const bands = []; for (const i of mine) { const B = bands[bands.length - 1]; if (!B || zs(i) - B.z0 > 26) bands.push({ z0: zs(i), segs: [i] }); else B.segs.push(i); }
  const C = { side: shade(th.wall, -0.3), shoulder: shade(th.wall, 0.05), roadA: th.road, roadB: shade(th.road, 0.03), parA: shade(th.wall, -0.2), parB: shade(th.wall, -0.32), topA: th.wallTop, topB: shade(th.wallTop, -0.12) };
  const rockC = [-0.24, -0.2, -0.16].map(k => shade(th.wall, k)), grdC = [-0.38, -0.34, -0.3].map(k => shade(th.ground, k));
  for (const band of bands) {
    const layers = [[], [], [], [], [], []], ent = new Map();
    const path = (L, key, o) => { let e = ent.get(L + key); if (!e) { e = { p: new Path2D(), ...o }; ent.set(L + key, e); layers[L].push(e); } return e.p; };
    const quad = (p, a, b, c, d) => { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c[0], c[1]); p.lineTo(d[0], d[1]); p.closePath(); };
    const tex = (L, pat, col, alpha, a, b, c, d) => { const tp = pats[pat] && Tex.worldTinted(v, pat, T.theme, col, alpha); quad(tp ? path(L, 'p' + pat + col, { pat: tp }) : path(L, 't' + col, { fill: col }), a, b, c, d); };
    const line = (L, key, o, a, b) => { const p = path(L, key, o); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); };
    const zb = band.segs.reduce((s, i) => s + T.z[i], 0) / band.segs.length, lw = v.scale(zb);
    for (const i of band.segs) {
      const j = (i + 1) % N, zi = T.z[i], zj = T.z[j];
      const hi = T.hw[i], hj = T.hw[j], oi = hi + T.wl[i] + 11, oj = hj + T.wl[j] + 11;
      const zl = (k, lat, extra = 0) => T.z[k] - T.tilt[k] * clamp(lat / (2 * T.hw[k]), -0.65, 0.65) + extra;
      const P = (k, lat, extra = 0) => { const [x, y] = pt(T, k, lat); const z = zl(k, lat, extra); return [v.px(x, y, z), v.py(x, y, z)]; };
      const G = (k, lat) => { const [x, y] = pt(T, k, lat); return [v.px(x, y, 0), v.py(x, y, 0)]; };
      const cx = (T.x[i] + T.x[j]) / 2, cy = (T.y[i] + T.y[j]) / 2, camLat = (v.cx - cx) * -T.ty[i] + (v.cy - cy) * T.tx[i];
      const jq = ((i * 2654435761) >>> 30) % 3;
      if (Math.max(zi, zj) >= 40) { // mountain earthworks: rock shoulder sloping down to the valley floor
        for (const s of [-1, 1]) {
          const ri = clamp(zi * 0.55, 20, 150), rj = clamp(zj * 0.55, 20, 150), eI = s * oi, eJ = s * oj;
          const mI = [pt(T, i, eI + s * ri * 0.4), zl(i, eI) * 0.6], mJ = [pt(T, j, eJ + s * rj * 0.4), zl(j, eJ) * 0.6];
          const PM = m => [v.px(m[0][0], m[0][1], m[1]), v.py(m[0][0], m[0][1], m[1])];
          const a1 = PM(mI), b1 = PM(mJ), f1 = G(i, eI + s * ri), f2 = G(j, eJ + s * rj), e1 = P(i, eI), e2 = P(j, eJ);
          tex(0, 'rock', rockC[jq], 0.42, e1, e2, b1, a1); tex(0, 'ground', grdC[jq], 0.5, a1, b1, f2, f1);
          const st = { stroke: 'rgba(0,0,0,0.22)', width: 1.4 }; line(1, 'strata', st, a1, b1); line(1, 'strata', st, [(e1[0] + a1[0]) / 2, (e1[1] + a1[1]) / 2], [(e2[0] + b1[0]) / 2, (e2[1] + b1[1]) / 2]); line(1, 'strata', st, f1, f2);
        }
      } else {
        if (camLat > oi) quad(path(1, 'side', { fill: C.side }), P(i, oi), P(j, oj), P(j, oj, -DECK_T), P(i, oi, -DECK_T));
        if (camLat < -oi) quad(path(1, 'side', { fill: C.side }), P(i, -oi), P(j, -oj), P(j, -oj, -DECK_T), P(i, -oi, -DECK_T));
      }
      // road surface: shoulders + tilted tarmac
      tex(2, 'wall', C.shoulder, 0.3, P(i, -oi), P(j, -oj), P(j, -hj), P(i, -hi));
      tex(2, 'wall', C.shoulder, 0.3, P(i, hi), P(j, hj), P(j, oj), P(i, oi));
      tex(2, 'road', C.roadA, 0.38, P(i, -hi), P(j, -hj), P(j, hj), P(i, hi));
      const ln = { stroke: th.line, width: Math.max(1, 3.2 * lw), alpha: 0.8 };
      for (const s of [-1, 1]) line(3, 'line', ln, P(i, s * (hi - 9)), P(j, s * (hj - 9)));
      if (i % 4 < 2) line(3, 'line', ln, P(i, 0), P(j, 0));
      if (Math.abs(T.tilt[i]) > 12) { const s = T.tilt[i] > 0 ? -1 : 1, red = (i >> 1) & 1; line(4, 'kerb' + red, { stroke: red ? '#d8302b' : '#f2f2f2', width: Math.max(1.5, 5 * lw) }, P(i, s * (hi - 3)), P(j, s * (hj - 3))); }
      for (const s of [-1, 1]) { // parapets (inner face + top)
        const li = s * (hi + T.wl[i] - 1), lj = s * (hj + T.wl[j] - 1), alt = (i >> 2) & 1;
        if (camLat * s < hi + T.wl[i] + 40) quad(path(5, 'par' + alt, { fill: alt ? C.parA : C.parB }), P(i, li), P(j, lj), P(j, lj, WALL_H), P(i, li, WALL_H));
        quad(path(5, 'top' + alt, { fill: alt ? C.topA : C.topB }), P(i, li, WALL_H), P(j, lj, WALL_H), P(j, lj + s * 11, WALL_H), P(i, li + s * 11, WALL_H));
      }
    }
    for (const L of layers) for (const e of L) {
      if (e.pat) { g.imageSmoothingEnabled = false; g.fillStyle = e.pat; g.fill(e.p); g.imageSmoothingEnabled = true; }
      else if (e.fill) { g.globalAlpha = e.alpha ?? 1; g.fillStyle = e.fill; g.fill(e.p); g.globalAlpha = 1; }
      else { g.globalAlpha = e.alpha ?? 1; g.strokeStyle = e.stroke; g.lineWidth = e.width; g.lineCap = 'butt'; g.stroke(e.p); g.globalAlpha = 1; }
    }
  }
}

/** tunnels: a rocky hill over the road with arched portals. Drawn after the cars so they disappear inside. */
export function tunnelRuns(T) {
  if (T._tun) return T._tun; const N = T.N, runs = []; T._tun = runs; if (!T.hasTun) return runs;
  let st = -1; for (let i = 0; i < N; i++) if (T.tn[i] && !T.tn[(i - 1 + N) % N]) { st = i; break; } if (st < 0) return runs;
  let i = st, cnt = 0; while (cnt < N) { if (T.tn[i]) { const idx = []; while (cnt < N && T.tn[i]) { idx.push(i); i = (i + 1) % N; cnt++; } runs.push(idx); } else { i = (i + 1) % N; cnt++; } }
  return runs;
}
export function drawTunnels(g, v, T, vis, focus = -1) {
  const runs = tunnelRuns(T); if (!runs.length) return; const th = T.th, N = T.N, near = new Set(vis);
  const base = shade(th.wall, -0.2), grassy = ['forest', 'snow', 'coast', 'desert', 'warzone'].includes(T.theme), tx = v.quality > 0;
  const prof = [[-1, 0.8], [-0.82, 0.93], [-0.5, 0.99], [0, 1], [0.5, 0.99], [0.82, 0.93], [1, 0.8]], lit = [-0.24, -0.12, 0.02, 0.1, -0.02, -0.14, -0.28];
  // one colour (pre-tinted texture) per strip of the hill profile, so the whole hill is ~8 fills instead of ~20 per road sample
  const strips = prof.slice(0, -1).map((_, q) => { const top = grassy && q >= 1 && q <= 4, k = (lit[q] + lit[q + 1]) / 2 + 0.02, col = top ? shade(th.ground, k * 0.8 - 0.06) : shade(base, k);
    return { col, pat: tx ? Tex.worldTinted(v, top ? 'ground' : 'rock', T.theme, col, 0.45) : null }; });
  g.save();
  for (const idx of runs) {
    // the hill turns see-through while you are inside it, so the road and every car underneath stay visible
    let runA = 0.94; if (focus >= 0 && idx.some(q => Math.min(Math.abs(q - focus), N - Math.abs(q - focus)) < 20)) runA = 0.34;
    const paths = strips.map(() => new Path2D()), side = new Path2D(), dots = new Path2D(); let any = false;
    const quad = (p, a, b, c, d) => { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c[0], c[1]); p.lineTo(d[0], d[1]); p.closePath(); };
    for (let k = 0; k < idx.length - 1; k++) {
      const i = idx[k], j = idx[k + 1]; if (!near.has(i)) continue; any = true;
      const hi = T.hw[i] + 56, hj = T.hw[j] + 56; const P = (q, lat, z) => { const [x, y] = pt(T, q, lat); return [v.px(x, y, z), v.py(x, y, z)]; };
      const cx = (T.x[i] + T.x[j]) / 2, cy = (T.y[i] + T.y[j]) / 2, camLat = (v.cx - cx) * -T.ty[i] + (v.cy - cy) * T.tx[i];
      if (camLat > hi) quad(side, P(i, hi, 0), P(j, hj, 0), P(j, hj, TUN_H * 0.8), P(i, hi, TUN_H * 0.8));
      if (camLat < -hi) quad(side, P(i, -hi, 0), P(j, -hj, 0), P(j, -hj, TUN_H * 0.8), P(i, -hi, TUN_H * 0.8));
      for (let q = 0; q < prof.length - 1; q++) { const l0 = prof[q][0], l1 = prof[q + 1][0], h0 = TUN_H * prof[q][1], h1 = TUN_H * prof[q + 1][1]; quad(paths[q], P(i, l0 * hi, h0), P(j, l0 * hj, h0), P(j, l1 * hj, h1), P(i, l1 * hi, h1)); }
      if (i % 5 === 0) { const m = P(i, (((i * 29) % 11) - 5) * hi / 7, TUN_H); dots.moveTo(m[0] + 6 * v.zoom, m[1]); dots.arc(m[0], m[1], (5 + (i % 4)) * v.zoom, 0, TAU); }
    }
    if (!any) continue;
    g.globalAlpha = runA; g.fillStyle = shade(th.wall, -0.45); g.fill(side);
    if (tx) g.imageSmoothingEnabled = false;
    strips.forEach((s, q) => { g.fillStyle = s.pat || s.col; g.fill(paths[q]); });
    g.imageSmoothingEnabled = true; g.fillStyle = th.night ? '#3a3040' : shade(th.ground, -0.3); g.fill(dots);
    // portals (entrance faces the camera when approaching, exit when leaving)
    for (const [i, dir] of [[idx[0], -1], [idx[idx.length - 1], 1]]) {
      if (!near.has(i)) continue; const x = T.x[i], y = T.y[i], tx = T.tx[i] * dir, ty = T.ty[i] * dir;
      if ((v.cx - x) * tx + (v.cy - y) * ty <= 0) continue; // viewer behind the face
      const R = T.hw[i] + 56, Ho = T.hw[i] + 20; const P = (lat, h) => { const [px, py] = pt(T, i, lat); return [v.px(px + tx * 2, py + ty * 2, h), v.py(px + tx * 2, py + ty * 2, h)]; };
      g.fillStyle = shade(th.wall, 0.0); g.beginPath(); const a = [P(-R, 0), P(R, 0), P(R, TUN_H * 0.8), P(0.62 * R, TUN_H), P(-0.62 * R, TUN_H), P(-R, TUN_H * 0.8)]; a.forEach((q, n) => n ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill();
      g.strokeStyle = shade(th.wallTop, -0.1); g.lineWidth = 4 * v.zoom; g.stroke();
      g.fillStyle = '#05060a'; g.beginPath(); const b0 = P(-Ho, 0), b1 = P(Ho, 0), a1 = P(Ho, TUN_H * 0.5), top = P(0, TUN_H * 0.78), a0 = P(-Ho, TUN_H * 0.5);
      g.moveTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.lineTo(a1[0], a1[1]); g.quadraticCurveTo(top[0] * 1.0 + (top[0] - (a0[0] + a1[0]) / 2), top[1] * 1.0 + (top[1] - (a0[1] + a1[1]) / 2), a0[0], a0[1]); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,200,90,0.5)'; for (let k = -1; k <= 1; k += 2) { const l = P(k * Ho * 0.9, TUN_H * 0.45); g.beginPath(); g.arc(l[0], l[1], 3.2 * v.zoom, 0, TAU); g.fill(); }
    }
  }
  g.restore();
}

/** A cached screen-space layer for static 3D structures (barriers, flyovers, tunnel hills), double-buffered.
 *  The visible copy is blitted with an offset/scale every frame; once the camera has moved far enough for the
 *  perspective lean to start drifting, a fresh copy is rebuilt in the background a slice at a time over the next few
 *  frames and swapped in - so no single frame ever pays for redrawing the whole layer. */
export class LayerCache {
  constructor(thresh = 34, parts = 3) { this.thresh = thresh; this.parts = parts; this.front = this.mk(); this.back = this.mk(); this.valid = false; this.job = null; }
  mk() { const cv = document.createElement('canvas'); return { cv, g: cv.getContext('2d'), vc: new View(), x: 0, y: 0, zoom: 1, key: null }; }
  start(buf, v, cw, ch, key) {
    if (buf.cv.width !== cw || buf.cv.height !== ch) { buf.cv.width = cw; buf.cv.height = ch; } else buf.g.clearRect(0, 0, cw, ch);
    Object.assign(buf.vc, { x: v.x, y: v.y, zoom: v.zoom, W: cw, H: ch, shakeX: 0, shakeY: 0, t: v.t, quality: v.quality }); buf.x = v.x; buf.y = v.y; buf.zoom = v.zoom; buf.key = key;
  }
  draw(g, v, key, render) {
    const m = 0.16, cw = Math.ceil(v.W * (1 + 2 * m)), ch = Math.ceil(v.H * (1 + 2 * m)), F = this.front;
    const moved = this.valid ? Math.hypot(v.x - F.x, v.y - F.y) * v.zoom : 1e9, zr = this.valid ? v.zoom / F.zoom : 1;
    const hard = !this.valid || F.cv.width !== cw || F.cv.height !== ch || key !== F.key || moved > this.thresh * 2.2 || zr > 1.12 || zr < 0.89;
    if (hard) { this.job = null; this.start(F, v, cw, ch, key); for (let p = 0; p < this.parts; p++) render(F.g, F.vc, p, this.parts); this.valid = true; }
    else {
      if (!this.job && (moved > this.thresh * 0.55 || zr > 1.035 || zr < 0.966)) { this.start(this.back, v, cw, ch, key); this.job = { p: 0 }; }
      if (this.job) { render(this.back.g, this.back.vc, this.job.p, this.parts); if (++this.job.p >= this.parts) { this.job = null; [this.front, this.back] = [this.back, this.front]; } }
    }
    const B = this.front, k = v.zoom / B.zoom, dx = (B.x - v.x) * v.zoom + v.W / 2 + v.shakeX - cw / 2 * k, dy = (B.y - v.y) * v.zoom + v.H / 2 + v.shakeY - ch / 2 * k;
    if (Math.abs(k - 1) < 0.002) g.drawImage(B.cv, Math.round(dx), Math.round(dy)); else g.drawImage(B.cv, dx, dy, B.cv.width * k, B.cv.height * k);
  }
}
/** the p-th of n contiguous slices of an array */
export const slice = (arr, p, n) => arr.slice(Math.floor(arr.length * p / n), Math.floor(arr.length * (p + 1) / n));
