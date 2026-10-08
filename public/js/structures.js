// Road structures drawn as real (perspective-projected) 3D geometry: barriers, raised decks, pillars, tunnels.
import { shade, rgba, clamp, TAU } from './util.js';
import { box } from './sprites.js';

export const WALL_H = 15, DECK_T = 12, TUN_H = 84;
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
    const j = (i + 1) % N; if (!T.elev[i] && !T.elev[j]) continue; any = true;
    const hi = T.hw[i] + T.wl[i] + 11, hj = T.hw[j] + T.wl[j] + 11, zi = T.z[i], zj = T.z[j];
    const q = [[i, -hi, zi], [i, hi, zi], [j, hj, zj], [j, -hj, zj]];
    q.forEach(([k, lat, z], n) => { const [x, y] = pt(T, k, lat); const X = v.sx(x) + z * 0.6 * v.zoom, Y = v.sy(y) + z * 0.45 * v.zoom; n ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath();
  }
  if (any) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill(p); }
}

/** pillars first (so decks cover their tops), then deck segments from low to high */
export function drawDecks(g, v, T, vis) {
  const N = T.N, th = T.th, segs = [];
  for (const i of vis) { const j = (i + 1) % N; if (T.elev[i] || T.elev[j]) segs.push(i); }
  if (!segs.length) return;
  const conc = shade(th.wall, -0.1), concTop = shade(th.wallTop, 0.05);
  for (const i of segs) if (i % 6 === 0 && T.z[i] >= 18) for (const s of [-0.55, 0.55]) { const [x, y] = pt(T, i, s * T.hw[i]); box(g, v, x, y, 15, 20, T.z[i] - DECK_T, T.ang[i], conc, concTop); }
  segs.sort((a, b) => (T.z[a] + T.z[(a + 1) % N]) - (T.z[b] + T.z[(b + 1) % N]) || a - b);
  for (const i of segs) {
    const j = (i + 1) % N, zi = T.z[i], zj = T.z[j];
    const hi = T.hw[i], hj = T.hw[j], oi = hi + T.wl[i] + 11, oj = hj + T.wl[j] + 11;
    const P = (k, lat, z) => { const [x, y] = pt(T, k, lat); return [v.px(x, y, z), v.py(x, y, z)]; };
    const quad = (a, b, c, d, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); };
    const cx = (T.x[i] + T.x[j]) / 2, cy = (T.y[i] + T.y[j]) / 2, nx = -T.ty[i], ny = T.tx[i], camLat = (v.x - cx) * nx + (v.y - cy) * ny;
    // outer side faces (visible when the camera is beside the deck)
    if (camLat > oi) quad(P(i, oi, zi), P(j, oj, zj), P(j, oj, zj - DECK_T), P(i, oi, zi - DECK_T), shade(th.wall, -0.3));
    if (camLat < -oi) quad(P(i, -oi, zi), P(j, -oj, zj), P(j, -oj, zj - DECK_T), P(i, -oi, zi - DECK_T), shade(th.wall, -0.3));
    // deck surface: shoulders + road
    quad(P(i, -oi, zi), P(j, -oj, zj), P(j, -hj, zj), P(i, -hi, zi), shade(th.wall, 0.05));
    quad(P(i, hi, zi), P(j, hj, zj), P(j, oj, zj), P(i, oi, zi), shade(th.wall, 0.05));
    quad(P(i, -hi, zi), P(j, -hj, zj), P(j, hj, zj), P(i, hi, zi), (i >> 3) & 1 ? th.road : shade(th.road, 0.03));
    g.strokeStyle = th.line; g.globalAlpha = 0.8; g.lineWidth = Math.max(1, 3.2 * v.scale(zi)); g.beginPath();
    for (const s of [-1, 1]) { const a = P(i, s * (hi - 9), zi), b = P(j, s * (hj - 9), zj); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    if (i % 4 < 2) { const a = P(i, 0, zi), b = P(j, 0, zj); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke(); g.globalAlpha = 1;
    // parapets (inner face + top)
    for (const s of [-1, 1]) {
      const li = s * (hi + T.wl[i] - 1), lj = s * (hj + T.wl[j] - 1);
      const camSide = camLat * s > hi * 0.2; // inner face is visible when the camera is on the road side of the parapet
      if (camLat * s < hi + T.wl[i] + 40) quad(P(i, li, zi), P(j, lj, zj), P(j, lj, zj + WALL_H), P(i, li, zi + WALL_H), (i >> 2) & 1 ? shade(th.wall, -0.2) : shade(th.wall, -0.32));
      quad(P(i, li, zi + WALL_H), P(j, lj, zj + WALL_H), P(j, lj + s * 11, zj + WALL_H), P(i, li + s * 11, zi + WALL_H), (i >> 2) & 1 ? th.wallTop : shade(th.wallTop, -0.12));
      void camSide;
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
export function drawTunnels(g, v, T, vis) {
  const runs = tunnelRuns(T); if (!runs.length) return; const th = T.th, N = T.N, near = new Set(vis);
  const rock = [shade(th.wall, -0.2), shade(th.wall, -0.27), shade(th.wall, -0.14), shade(th.wall, -0.23)];
  g.save(); g.globalAlpha = 0.93;
  for (const idx of runs) {
    for (let k = 0; k < idx.length - 1; k++) {
      const i = idx[k], j = idx[k + 1]; if (!near.has(i) && !near.has(j)) continue;
      const hi = T.hw[i] + 56, hj = T.hw[j] + 56; const P = (q, lat, z) => { const [x, y] = pt(T, q, lat); return [v.px(x, y, z), v.py(x, y, z)]; };
      const quad = (a, b, c, d, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); };
      const cx = (T.x[i] + T.x[j]) / 2, cy = (T.y[i] + T.y[j]) / 2, camLat = (v.x - cx) * -T.ty[i] + (v.y - cy) * T.tx[i];
      if (camLat > hi) quad(P(i, hi, 0), P(j, hj, 0), P(j, hj, TUN_H * 0.8), P(i, hi, TUN_H * 0.8), shade(th.wall, -0.45));
      if (camLat < -hi) quad(P(i, -hi, 0), P(j, -hj, 0), P(j, -hj, TUN_H * 0.8), P(i, -hi, TUN_H * 0.8), shade(th.wall, -0.45));
      // hill profile: rounded top built from lit strips (light from the top-left)
      const strip = (l0, l1, h0, h1, col) => quad(P(i, l0 * hi, h0), P(j, l0 * hj, h0), P(j, l1 * hj, h1), P(i, l1 * hi, h1), col);
      const prof = [[-1, 0.8], [-0.82, 0.93], [-0.5, 0.99], [0, 1], [0.5, 0.99], [0.82, 0.93], [1, 0.8]], lit = [-0.24, -0.12, 0.02, 0.1, -0.02, -0.14, -0.28];
      const base = rock[((i >> 4) * 3) % rock.length];
      for (let q = 0; q < prof.length - 1; q++) strip(prof[q][0], prof[q + 1][0], TUN_H * prof[q][1], TUN_H * prof[q + 1][1], shade(base, (lit[q] + lit[q + 1]) / 2 + 0.02 + (((i * 2654435761) >>> 28) / 15 - 0.5) * 0.03));
      if (((i >> 1) & 3) === 0) { g.fillStyle = rgba(th.speck, 0.18); const m = P(i, (((i * 13) % 9) - 4) * hi / 6, TUN_H); g.beginPath(); g.arc(m[0], m[1], 9 * v.zoom, 0, TAU); g.fill(); }
      if (i % 5 === 0) { const m = P(i, (((i * 29) % 11) - 5) * hi / 7, TUN_H); g.fillStyle = th.night ? '#3a3040' : shade(th.ground, -0.3); g.beginPath(); g.arc(m[0], m[1], (5 + (i % 4)) * v.zoom, 0, TAU); g.fill(); g.fillStyle = shade(th.ground, 0.08); g.beginPath(); g.arc(m[0] - 2 * v.zoom, m[1] - 2 * v.zoom, 3 * v.zoom, 0, TAU); g.fill(); }
    }
    // portals (entrance faces the camera when approaching, exit when leaving)
    for (const [i, dir] of [[idx[0], -1], [idx[idx.length - 1], 1]]) {
      if (!near.has(i)) continue; const x = T.x[i], y = T.y[i], tx = T.tx[i] * dir, ty = T.ty[i] * dir;
      if ((v.x - x) * tx + (v.y - y) * ty <= 0) continue; // camera behind the face
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
