// Track definitions, spline compilation, collision queries, scenery placement. Pure logic (no DOM) so it can be unit-tested in Node.
import { clamp, angDiff, mulberry32, hashStr, TAU } from './util.js';

export const STEP = 14;      // centre-line sample spacing (px)
export const VERGE = 46;     // grass/dirt shoulder between the tarmac and the barrier
export const MARGIN = 360;   // world padding around the track
export const ELEV_T = 6;     // road height above which a sample is drawn as a raised deck instead of baked on the ground
export const BRIDGE_WALL = 14, TUN_WALL = 22; // barrier offset from the road edge on decks / in tunnels

export const THEMES = {
  desert:   { name: 'Desert',    ground: '#c9a05a', ground2: '#b98d46', speck: '#e0be7a', verge: '#a98048', road: '#3e3b3a', roadHi: '#4b4846', line: '#efe3c0', wall: '#9b8466', wallTop: '#cdb58f', props: ['cactus', 'rock', 'rock', 'dune', 'adobe', 'cactus'], dens: 0.5, night: false, cars: 1 },
  forest:   { name: 'Forest',    ground: '#3e6a2c', ground2: '#34592a', speck: '#5f9446', verge: '#6a5a3a', road: '#3a3a3d', roadHi: '#46464a', line: '#f2f2f2', wall: '#7b7468', wallTop: '#aaa293', props: ['pine', 'oak', 'oak', 'pine', 'rock', 'log', 'pine'], dens: 1.2, night: false },
  snow:     { name: 'Alpine',    ground: '#e4ecf1', ground2: '#cfdce5', speck: '#ffffff', verge: '#b9c6cf', road: '#454a52', roadHi: '#545a63', line: '#ffd23f', wall: '#8794a0', wallTop: '#dfe8ee', props: ['snowpine', 'snowpine', 'snowpine', 'rock', 'cabin', 'snowman'], dens: 0.9, night: false },
  city:     { name: 'Neon City', ground: '#2c2e36', ground2: '#25272e', speck: '#3b3e48', verge: '#3a3c45', road: '#1f2024', roadHi: '#2a2b31', line: '#ff4fd8', wall: '#4b4d58', wallTop: '#8b8fa3', props: ['tower', 'tower', 'lamp', 'building', 'building', 'billboard'], dens: 0.65, night: true },
  industrial:{ name: 'Foundry',  ground: '#5d5953', ground2: '#504c47', speck: '#76726b', verge: '#4a4640', road: '#34353a', roadHi: '#404147', line: '#ffcf1f', wall: '#6d6a66', wallTop: '#b3aea6', props: ['container', 'tank', 'building', 'barrels', 'container', 'crane'], dens: 0.7, night: false },
  volcano:  { name: 'Inferno',   ground: '#2a1c19', ground2: '#221512', speck: '#43302b', verge: '#3b2621', road: '#2c2b2d', roadHi: '#38373a', line: '#ff8a1f', wall: '#4d3a34', wallTop: '#85645a', props: ['spire', 'rock', 'spire', 'lava', 'rock'], dens: 0.8, night: true, glow: '#ff5a14' },
  coast:    { name: 'Coastal',   ground: '#e3cf98', ground2: '#d4bd80', speck: '#f4e6b8', verge: '#c4ab6c', road: '#3b3e44', roadHi: '#484c53', line: '#ffffff', wall: '#8d98a3', wallTop: '#d4dde4', props: ['palm', 'palm', 'rock', 'umbrella', 'palm', 'hut'], dens: 0.6, night: false, water: '#2d8fb5' },
  warzone:  { name: 'Warzone',   ground: '#6b6850', ground2: '#5a5742', speck: '#8c8866', verge: '#4d4936', road: '#34353a', roadHi: '#43444a', line: '#d8d0a0', wall: '#7a7358', wallTop: '#b4ab82', props: ['ruin', 'sandbags', 'tankwreck', 'crater', 'rock', 'barrels', 'tyres', 'ruin'], dens: 0.75, night: false, bomber: true },
  mesa:     { name: 'Red Canyon', ground: '#b4602f', ground2: '#9d5128', speck: '#cf7d49', verge: '#8a4524', road: '#3d3a3b', roadHi: '#4a4647', line: '#f3e6cc', wall: '#7d4527', wallTop: '#c47c50', props: ['mesa', 'rock', 'rock', 'cactus', 'mesa'], dens: 0.6, night: false },
};

/* ------------------------------------------------------------------ built-in tracks */
function loop(id, name, theme, o) {
  const n = o.n || 26, pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU + (o.rot || 0);
    let r = 1; for (const [k, amp, ph] of o.h) r += amp * Math.cos(k * th + ph);
    pts.push([Math.round(o.rx * r * Math.cos(th)), Math.round(o.ry * r * Math.sin(th))]);
  }
  return finish(id, name, theme, pts, o);
}
/** tag point ranges with elevation / tunnel flags (point format: [x, y, width|null, height, tunnel]) */
function finish(id, name, theme, pts, o) {
  const n = pts.length;
  for (const [a, b, Z] of o.elev || []) {
    for (let i = a; i <= b; i++) { const p = pts[((i % n) + n) % n]; p[2] = p[2] ?? null; p[3] = Z; }
    for (const [i, f] of [[a - 1, 0.45], [b + 1, 0.45]]) { const p = pts[((i % n) + n) % n]; if (!p[3]) { p[2] = p[2] ?? null; p[3] = Z * f; } }
  }
  for (const [a, b] of o.tun || []) for (let i = a; i <= b; i++) { const p = pts[((i % n) + n) % n]; p[2] = p[2] ?? null; p[3] = p[3] || 0; p[4] = 1; }
  return { id, name, theme, pts, width: o.width || 150, laps: o.laps || 3, seed: o.seed || hashStr(id), author: 'Kill Lap', dens: o.dens, wv: o.wv, builtin: true, diff: o.diff || 2, bomber: !!o.bomber, tags: o.tags };
}
/** figure-of-eight with a flyover where the two halves cross */
function figure8(id, name, theme, o) {
  const n = o.n || 30, pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU + (o.rot ?? Math.PI / 2), z = o.bridge || 70;
    const d = Math.abs(angDiff(t, 0)); const f = d < 0.5 ? 1 : d < 1.0 ? 1 - (d - 0.5) / 0.5 : 0;
    const w = 1 + (o.wob || 0) * Math.sin(3 * t + 1);
    pts.push([Math.round(o.A * Math.sin(t) * w), Math.round((o.B / 2) * Math.sin(2 * t) * w), null, Math.round(z * f * f * (3 - 2 * f))]);
  }
  return finish(id, name, theme, pts, o);
}
function pts(id, name, theme, p, o = {}) { return finish(id, name, theme, p, o); }

export const BUILTIN_TRACKS = [
  loop('dustbowl', 'Dust Bowl', 'desert', { rx: 1900, ry: 1250, h: [[2, 0.08, 0.4], [3, 0.1, 1.2], [5, 0.04, 2]], width: 170, diff: 1, seed: 11 }),
  loop('pinewood', 'Pinewood Run', 'forest', { rx: 1850, ry: 1300, h: [[3, 0.12, 0], [2, 0.1, 2.2], [6, 0.03, 1]], n: 30, width: 160, diff: 1, seed: 21 }),
  pts('frostbite', 'Frostbite Pass', 'snow', [[0, 0], [700, -120], [1400, 120], [2100, -60], [2800, 200], [3200, 800], [2900, 1400], [2300, 1500], [1900, 1050], [1400, 1250], [1500, 1850], [2100, 2200], [1500, 2600], [700, 2400], [200, 1900], [500, 1300], [100, 800]], { width: 150, diff: 2 }),
  loop('neon', 'Neon Nights', 'city', { rx: 1800, ry: 1100, h: [[2, 0.18, 0.3], [4, 0.09, 1.6], [7, 0.025, 0.5]], n: 32, width: 150, diff: 2, seed: 31 }),
  pts('foundry', 'The Foundry', 'industrial', [[0, 0], [800, 0], [1500, -200], [2300, 0], [2900, 450], [2800, 1100], [2100, 1300], [1800, 1800], [2300, 2300], [1700, 2800], [900, 2650], [500, 2100], [900, 1650], [400, 1250], [-200, 900], [-300, 400]], { width: 150, diff: 2 }),
  loop('inferno', 'Inferno Ring', 'volcano', { rx: 1700, ry: 1500, h: [[3, 0.14, 0.6], [5, 0.08, 0], [2, 0.12, 2.8]], n: 34, width: 150, diff: 3, seed: 41 }),
  pts('seaside', 'Seaside Sprint', 'coast', [[0, 600], [500, 150], [1300, 100], [2100, 350], [2900, 250], [3500, 650], [3600, 1250], [3100, 1700], [2400, 1600], [1900, 1950], [2200, 2500], [1600, 2800], [800, 2600], [300, 2000], [500, 1400]], { width: 170, diff: 1 }),
  loop('canyon', 'Canyon Carnage', 'mesa', { rx: 2000, ry: 1200, h: [[2, 0.2, 1], [4, 0.1, 0.2], [7, 0.035, 2.5]], n: 36, width: 145, diff: 3, seed: 51 }),
  pts('serpent', 'Serpent', 'desert', [[600, 500], [1300, 380], [2000, 520], [2700, 420], [3300, 700], [3500, 1300], [3100, 1700], [2550, 1550], [2100, 1850], [2250, 2300], [2800, 2550], [3000, 2850], [2400, 3050], [1600, 2800], [1000, 3000], [500, 2600], [700, 2000], [1300, 1700], [900, 1300], [400, 1000]], { width: 150, diff: 3 }),
  loop('timberline', 'Timberline Twist', 'forest', { rx: 1700, ry: 1450, h: [[5, 0.12, 0.3], [3, 0.13, 2], [2, 0.08, 1]], n: 40, width: 145, diff: 3, seed: 61 }),
  loop('glacier', 'Glacier Gauntlet', 'snow', { rx: 2100, ry: 1100, h: [[4, 0.14, 1.1], [3, 0.1, 0], [6, 0.04, 2]], n: 36, width: 150, diff: 2, seed: 71 }),
  loop('midnight', 'Midnight Docks', 'industrial', { rx: 1750, ry: 1400, h: [[2, 0.16, 2.4], [5, 0.1, 1.1], [3, 0.07, 0.4]], n: 34, width: 150, diff: 2, seed: 81 }),
  loop('kingpin', 'Kingpin Circuit', 'city', { rx: 2100, ry: 1500, h: [[3, 0.11, 0.5], [5, 0.09, 2.2], [8, 0.02, 1]], n: 40, width: 155, diff: 4, seed: 91 }),
  loop('lavaflow', 'Lava Flow', 'volcano', { rx: 2200, ry: 1250, h: [[2, 0.14, 0.2], [4, 0.1, 2.1], [6, 0.05, 0.9]], n: 38, width: 150, diff: 3, seed: 101 }),
  // ---- tracks with raised roads, crossovers, tunnels and hazards
  figure8('overpass', 'Overpass Chaos', 'city', { A: 1750, B: 1560, n: 30, width: 150, diff: 3, seed: 111, bridge: 72, tags: ['flyover'] }),
  figure8('crossfire', 'Crossfire', 'warzone', { A: 1850, B: 1500, n: 30, width: 155, diff: 3, seed: 121, bridge: 70, bomber: true, tags: ['flyover', 'air raid'] }),
  loop('tunnelvision', 'Tunnel Vision', 'mesa', { rx: 2050, ry: 1280, h: [[2, 0.14, 0.6], [3, 0.1, 2.0], [5, 0.04, 1]], n: 36, width: 150, diff: 3, seed: 131, tun: [[4, 8], [22, 25]], tags: ['tunnels'] }),
  loop('skyline', 'Skyline Highway', 'city', { rx: 1900, ry: 1350, h: [[3, 0.11, 0.2], [5, 0.07, 1.5], [2, 0.1, 2.5]], n: 38, width: 160, diff: 3, seed: 141, elev: [[3, 9, 74], [24, 29, 74]], tun: [[16, 18]], tags: ['raised', 'tunnel'] }),
  loop('groundzero', 'Ground Zero', 'warzone', { rx: 1800, ry: 1300, h: [[3, 0.12, 0.9], [2, 0.1, 2.2], [6, 0.03, 0.5]], n: 34, width: 150, diff: 3, seed: 151, bomber: true, tags: ['air raid'] }),
  figure8('foundrycross', 'Foundry Crossing', 'industrial', { A: 1800, B: 1480, n: 30, width: 150, diff: 2, seed: 161, bridge: 66, wob: 0.06, tags: ['flyover', 'trains'] }),
  loop('moltenpass', 'Molten Pass', 'volcano', { rx: 2000, ry: 1250, h: [[2, 0.13, 1.2], [4, 0.1, 0.4], [7, 0.03, 2]], n: 36, width: 150, diff: 4, seed: 171, elev: [[12, 17, 70]], tun: [[26, 29]], tags: ['raised', 'tunnel', 'lava'] }),
];
export const TRACK_BY_ID = Object.fromEntries(BUILTIN_TRACKS.map(t => [t.id, t]));

/* ------------------------------------------------------------------ random generator (daily challenge, editor "randomise") */
export function generateTrack(seed, opts = {}) {
  const rng = mulberry32(seed);
  const themes = Object.keys(THEMES);
  const theme = opts.theme || themes[Math.floor(rng() * themes.length)];
  const h = [];
  const ks = [2, 3, 4, 5, 6, 7]; 
  const nh = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < nh; i++) { const k = ks.splice(Math.floor(rng() * ks.length), 1)[0]; h.push([k, (0.18 / Math.sqrt(k)) * (0.5 + rng() * 0.7), rng() * TAU]); }
  const NAMES_A = ['Savage', 'Rusted', 'Broken', 'Burning', 'Howling', 'Screaming', 'Cursed', 'Rotten', 'Iron', 'Crimson', 'Wicked', 'Hollow'];
  const NAMES_B = ['Gulch', 'Mile', 'Loop', 'Basin', 'Ridge', 'Ring', 'Pit', 'Crossing', 'Run', 'Mesa', 'Speedway', 'Hollow'];
  const t = loop('gen' + seed, `${NAMES_A[Math.floor(rng() * 12)]} ${NAMES_B[Math.floor(rng() * 12)]}`, theme, { rx: 1700 + rng() * 500, ry: 1100 + rng() * 450, h, n: 34, width: 140 + Math.floor(rng() * 30), seed, rot: rng() * TAU });
  t.builtin = false; t.generated = true;
  return t;
}

/* ------------------------------------------------------------------ compilation */
export function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function compileTrack(data, opts = {}) {
  const P = data.pts, n = P.length;
  const baseW = data.width || 150;
  const wAt = i => (P[i][2] != null ? P[i][2] : baseW);
  // dense sampling
  const dx = [], dy = [], dw = [], dz = [], dtn = [];
  const zP = i => P[i][3] || 0, tP = i => (P[i][4] ? 1 : 0);
  const sub = 20;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      dx.push(catmull(a[0], b[0], c[0], d[0], t)); dy.push(catmull(a[1], b[1], c[1], d[1], t));
      dw.push(catmull(wAt((i - 1 + n) % n), wAt(i), wAt((i + 1) % n), wAt((i + 2) % n), t));
      const i0 = (i - 1 + n) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
      dz.push(Math.max(0, catmull(zP(i0), zP(i), zP(i2), zP(i3), t))); dtn.push(tP(i) + (tP(i2) - tP(i)) * t);
    }
  }
  const M = dx.length; const cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) cum[i + 1] = cum[i] + Math.hypot(dx[(i + 1) % M] - dx[i], dy[(i + 1) % M] - dy[i]);
  const total = cum[M];
  const N = Math.max(40, Math.round(total / STEP)); const step = total / N;
  const x = new Float32Array(N), y = new Float32Array(N), hw = new Float32Array(N), z = new Float32Array(N), tn = new Uint8Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * step;
    while (j < M - 1 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1, f = clamp((s - cum[j]) / seg, 0, 1), k = (j + 1) % M;
    x[i] = dx[j] + (dx[k] - dx[j]) * f; y[i] = dy[j] + (dy[k] - dy[j]) * f; hw[i] = (dw[j] + (dw[k] - dw[j]) * f) / 2;
    z[i] = dz[j] + (dz[k] - dz[j]) * f; tn[i] = dtn[j] + (dtn[k] - dtn[j]) * f > 0.5 ? 1 : 0;
  }
  // keep the start/finish straight flat and on the ground
  for (let i = -16; i <= 16; i++) { const q = ((i % N) + N) % N, f = Math.abs(i) / 16; z[q] *= f * f * (3 - 2 * f); if (Math.abs(i) < 10) tn[q] = 0; }
  // optional width variation
  const wv = data.wv != null ? data.wv : 0;
  if (wv) for (let i = 0; i < N; i++) hw[i] *= 1 + wv * Math.sin((i / N) * TAU * 3 + (data.seed || 0));
  // shift into positive space
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < N; i++) { const e = hw[i] + VERGE + 20; minX = Math.min(minX, x[i] - e); maxX = Math.max(maxX, x[i] + e); minY = Math.min(minY, y[i] - e); maxY = Math.max(maxY, y[i] + e); }
  const items0 = data.items || [];
  for (const it of items0) { minX = Math.min(minX, it.x - 60); maxX = Math.max(maxX, it.x + 60); minY = Math.min(minY, it.y - 60); maxY = Math.max(maxY, it.y + 60); }
  const ox = MARGIN - minX, oy = MARGIN - minY;
  for (let i = 0; i < N; i++) { x[i] += ox; y[i] += oy; }
  const W = Math.ceil(maxX - minX + MARGIN * 2), H = Math.ceil(maxY - minY + MARGIN * 2);
  // tangents / normals / curvature
  const tx = new Float32Array(N), ty = new Float32Array(N), ang = new Float32Array(N), curv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N; let ex = x[b] - x[a], ey = y[b] - y[a]; const l = Math.hypot(ex, ey) || 1;
    tx[i] = ex / l; ty[i] = ey / l; ang[i] = Math.atan2(ey, ex);
  }
  for (let i = 0; i < N; i++) { const a = (i - 2 + N) % N, b = (i + 2) % N; curv[i] = angDiff(ang[a], ang[b]) / (4 * step); }
  const sm = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += curv[(i + k + N) % N]; sm[i] = s / 7; }
  curv.set(sm);

  // barrier offset per sample: wide grass verge on the ground, tight parapets on decks and in tunnels
  const tnS = new Float32Array(N); for (let i = 0; i < N; i++) { let a = 0; for (let k = -8; k <= 8; k++) a += tn[(i + k + N) % N]; tnS[i] = a / 17; }
  const wl = new Float32Array(N), elev = new Uint8Array(N); let hasElev = false, hasTun = false;
  for (let i = 0; i < N; i++) {
    const g = clamp(z[i] / 20, 0, 1); let w = VERGE - (VERGE - BRIDGE_WALL) * g; w = Math.min(w, VERGE - (VERGE - TUN_WALL) * tnS[i]); wl[i] = w;
    elev[i] = z[i] >= ELEV_T ? 1 : 0; if (elev[i]) hasElev = true; if (tn[i]) hasTun = true;
  }
  const T = {
    z, tn, wl, elev, hasElev, hasTun, hazards: [], bomber: false,
    data, id: data.id, name: data.name, theme: data.theme in THEMES ? data.theme : 'desert', th: null, N, step, length: total, x, y, hw, tx, ty, ang, curv, W, H, ox, oy,
    laps: data.laps || 3, seed: data.seed || hashStr(data.id || 'x'), start: null, props: [], items: [],
  };
  T.th = THEMES[T.theme];
  const sa = ang[0];
  T.start = { x: x[0], y: y[0], a: sa };
  T.maxHW = 0; for (let i = 0; i < N; i++) T.maxHW = Math.max(T.maxHW, hw[i]);
  if (opts.light) return T;
  T.clearDist = makeClear(T);
  const itemsAll = items0.map(it => ({ ...it, x: it.x + ox, y: it.y + oy }));
  placeItems(T, itemsAll.filter(it => !HAZ_TYPES.includes(it.t)));
  placeHazards(T, itemsAll.filter(it => HAZ_TYPES.includes(it.t)));
  placeProps(T, (data.props || []).map(p => ({ ...p, x: p.x + ox, y: p.y + oy })));
  return T;
}

/** Nearest centre-line point. hint>=0 searches a window (robust on tracks that pass close to themselves). */
const _near = { i: 0, f: 0, d: 0, lat: 0, px: 0, py: 0, nx: 0, ny: 0 };
export function nearest(T, px, py, hint = -1, win = 36, out = _near) {
  const { N, x, y } = T; let bd = 1e18, bi = 0, bt = 0;
  const lo = hint < 0 ? 0 : -win, hi = hint < 0 ? N - 1 : win;
  for (let k = lo; k <= hi; k++) {
    const i = hint < 0 ? k : ((Math.floor(hint) + k) % N + N) % N; const j = i + 1 === N ? 0 : i + 1;
    const ax = x[i], ay = y[i], ex = x[j] - ax, ey = y[j] - ay;
    let t = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t, cy = ay + ey * t, d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  const j = bi + 1 === N ? 0 : bi + 1;
  const cx = x[bi] + (x[j] - x[bi]) * bt, cy = y[bi] + (y[j] - y[bi]) * bt;
  const tx = T.tx[bi], ty = T.ty[bi]; // right normal = (-ty, tx) with y pointing down
  out.i = bi; out.f = bi + bt; out.px = cx; out.py = cy; out.nx = -ty; out.ny = tx;
  out.lat = (px - cx) * out.nx + (py - cy) * out.ny; out.d = Math.sqrt(bd);
  out.hw = T.hw[bi] + (T.hw[j] - T.hw[bi]) * bt; out.wl = T.wl[bi] + (T.wl[j] - T.wl[bi]) * bt; out.z = T.z[bi] + (T.z[j] - T.z[bi]) * bt;
  return out;
}
export function pointAt(T, f, lat = 0) {
  f = ((f % T.N) + T.N) % T.N; const i = Math.floor(f), j = (i + 1) % T.N, t = f - i;
  const cx = T.x[i] + (T.x[j] - T.x[i]) * t, cy = T.y[i] + (T.y[j] - T.y[i]) * t;
  const tx = T.tx[i] + (T.tx[j] - T.tx[i]) * t, ty = T.ty[i] + (T.ty[j] - T.ty[i]) * t; const l = Math.hypot(tx, ty) || 1;
  return { x: cx - (ty / l) * lat, y: cy + (tx / l) * lat, a: Math.atan2(ty, tx), hw: T.hw[i], z: T.z[i] + (T.z[j] - T.z[i]) * t };
}
/** road height at fractional sample index */
export function zAt(T, f) { f = ((f % T.N) + T.N) % T.N; const i = Math.floor(f), j = (i + 1) % T.N; return T.z[i] + (T.z[j] - T.z[i]) * (f - i); }

/* ------------------------------------------------------------------ items and props */
function placeItems(T, custom) {
  const rng = mulberry32(T.seed ^ 0x9e3779b9);
  const N = T.N, items = [];
  const auto = T.data.auto !== false;
  if (auto) {
    const count = Math.max(6, Math.round(T.length / 1500));
    const types = ['repair', 'ammo', 'cash', 'nitro', 'cash', 'ammo'];
    for (let k = 0; k < count; k++) {
      const i = Math.floor(((k + 0.5) / count) * N + (rng() - 0.5) * 6);
      const lat = (rng() - 0.5) * T.hw[i] * 1.1;
      const p = pointAt(T, i, lat);
      items.push({ t: types[k % types.length], x: p.x, y: p.y, z: p.z });
      if (k % 2 === 0) { const p2 = pointAt(T, i, -lat * 0.9 + (rng() - 0.5) * 20); items.push({ t: types[(k + 3) % types.length], x: p2.x, y: p2.y, z: p2.z }); }
    }
    // boost pads on straights
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < 4; tries++) {
      const i = Math.floor(rng() * N); let straight = true;
      for (let q = -10; q <= 10; q++) if (Math.abs(T.curv[(i + q + N) % N]) > 0.0007) { straight = false; break; }
      if (straight && (i > 14 && i < N - 14) && !items.some(o => o.t === 'boost' && Math.hypot(o.x - T.x[i], o.y - T.y[i]) < 700)) {
        const p = pointAt(T, i, (rng() - 0.5) * T.hw[i]); if (p.z < ELEV_T) { items.push({ t: 'boost', x: p.x, y: p.y, a: p.a, z: 0 }); placed++; }
      }
    }
    for (let tries = 0, placedO = 0; tries < 200 && placedO < 3; tries++) {
      const i = Math.floor(rng() * N);
      if (i > 20 && i < N - 20 && !items.some(o => o.t === 'oil' && Math.hypot(o.x - T.x[i], o.y - T.y[i]) < 800)) {
        const p = pointAt(T, i, (rng() - 0.5) * T.hw[i] * 0.8); if (p.z < ELEV_T) { items.push({ t: 'oil', x: p.x, y: p.y, z: 0 }); placedO++; }
      }
    }
  }
  for (const c of custom) {
    const it = { t: c.t, x: c.x, y: c.y }; if (c.a != null) it.a = c.a;
    if (['repair', 'ammo', 'cash', 'nitro', 'boost', 'oil'].includes(it.t)) {
      if (it.t === 'boost' && it.a == null) { const n = nearest(T, it.x, it.y); it.a = T.ang[n.i]; }
      { const n = nearest(T, it.x, it.y, -1); it.z = Math.abs(n.lat) < n.hw + 10 ? n.z : 0; }
      items.push(it);
    }
  }
  T.items = items.map((it, k) => ({ ...it, id: k }));
}


/* ------------------------------------------------------------------ hazards */
export const HAZ_TYPES = ['train', 'cross', 'ford', 'jump', 'lava', 'wave', 'bomber'];
const THEME_HAZ = { desert: { jump: 2, train: 1 }, forest: { ford: 2, jump: 1, train: 1 }, snow: { jump: 1 }, city: { cross: 2 }, industrial: { train: 1, jump: 1 }, volcano: { lava: 4, jump: 1 }, coast: { wave: 1, ford: 1, jump: 1 }, mesa: { jump: 2, train: 1 }, warzone: { jump: 1 } };
function placeHazards(T, custom) {
  const rng = mulberry32(T.seed ^ 0x2545f491), N = T.N, out = [];
  const th = THEME_HAZ[T.theme] || {};
  const flat = (i, span, lim) => { for (let q = -span; q <= span; q++) { const k = (i + q + N) % N; if (Math.abs(T.curv[k]) > lim || T.z[k] >= ELEV_T || T.tn[k]) return false; } return true; };
  const far = (x, y, d) => !out.some(h => Math.hypot(h.x - x, h.y - y) < d) && !T.items.some(it => (it.t === 'boost' || it.t === 'oil') && Math.hypot(it.x - x, it.y - y) < 160);
  if (T.data.hazards !== false) for (const [type, count] of Object.entries(th)) {
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < count; tries++) {
      const i = Math.floor(N * (0.09 + rng() * 0.82));
      const span = type === 'wave' ? 9 : type === 'train' ? 14 : type === 'lava' ? 3 : 10, lim = type === 'lava' ? 0.01 : type === 'wave' ? 0.0011 : 0.0007;
      if (!flat(i, span, lim) || !far(T.x[i], T.y[i], type === 'cross' ? 2400 : 1100)) continue;
      const p = pointAt(T, i, 0); out.push({ t: type, x: p.x, y: p.y, a: p.a, hw: T.hw[i], f: i, seed: Math.floor(rng() * 1e6), side: rng() < 0.5 ? 1 : -1 }); placed++;
    }
  }
  for (const c of custom) {
    if (c.t === 'bomber') { T.bomber = true; continue; }
    const n = nearest(T, c.x, c.y, -1), p = pointAt(T, n.f, 0);
    const onRoad = Math.abs(n.lat) < n.hw + 60;
    out.push({ t: c.t, x: onRoad && c.t !== 'lava' && c.t !== 'wave' ? p.x : c.x, y: onRoad && c.t !== 'lava' && c.t !== 'wave' ? p.y : c.y, a: p.a, hw: n.hw, f: Math.floor(n.f), seed: ((c.x * 31 + c.y * 17) | 0) & 0xffff, side: n.lat >= 0 ? 1 : -1 });
  }
  if (T.data.bomber || (T.th.bomber && T.data.hazards !== false)) T.bomber = true;
  T.hazards = out.map((h, k) => ({ ...h, id: k }));
}

/** Distance from a world point to the nearest road edge (negative on tarmac). Uses a coarse spatial hash. */
function makeClear(T) {
  const cell = 160, gw = Math.ceil(T.W / cell) + 1, grid = new Map();
  for (let i = 0; i < T.N; i += 2) { const key = Math.floor(T.x[i] / cell) + Math.floor(T.y[i] / cell) * gw; (grid.get(key) || grid.set(key, []).get(key)).push(i); }
  return (px, py) => {
    const gx = Math.floor(px / cell), gy = Math.floor(py / cell); let best = 1e9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const l = grid.get(gx + a + (gy + b) * gw); if (l) for (const i of l) { const d = Math.hypot(px - T.x[i], py - T.y[i]) - T.hw[i]; if (d < best) best = d; } }
    return best;
  };
}

function placeProps(T, custom) {
  const rng = mulberry32(T.seed ^ 0x51ed270b);
  const th = T.th, list = th.props, props = [];
  const clearDist = T.clearDist;
  const dens = (T.data.dens != null ? T.data.dens : th.dens) * 1.0;
  const area = T.W * T.H, target = Math.min(1100, Math.round((area / 90000) * 12 * dens));
  const placedGrid = new Map();
  for (let tries = 0; props.length < target && tries < target * 12; tries++) {
    const px = rng() * T.W, py = rng() * T.H;
    const type = list[Math.floor(rng() * list.length)];
    const big = ['tower', 'building', 'container', 'tank', 'adobe', 'mesa', 'cabin', 'crane', 'billboard', 'hut', 'ruin'].includes(type);
    const need = VERGE + 36 + (big ? 70 : 0);
    if (clearDist(px, py) < need) continue;
    const pk = Math.floor(px / 70) + Math.floor(py / 70) * 400; const q = placedGrid.get(pk);
    if (q && Math.hypot(q.x - px, q.y - py) < (big ? 120 : 34)) continue;
    const pr = { type, x: px, y: py, s: 0.75 + rng() * 0.7, r: rng() * TAU, v: rng() };
    if (big) { pr.w = 90 + rng() * 140; pr.d = 80 + rng() * 120; pr.h = type === 'ruin' ? 40 + rng() * 50 : 70 + rng() * (type === 'tower' ? 220 : 90); }
    props.push(pr); placedGrid.set(pk, pr);
  }
  // trackside dressing: tyre stacks / lamps on outer verge near fast corners
  for (let i = 0; i < T.N; i += 1) {
    const c = Math.abs(T.curv[i]); if (T.elev[i] || T.tn[i]) continue;
    if (c > 0.0011 && i % 5 === 0) {
      const side = T.curv[i] > 0 ? -1 : 1; // outside of the corner
      const p = pointAt(T, i, side * (T.hw[i] + VERGE + 14));
      props.push({ type: 'tyres', x: p.x, y: p.y, s: 1, r: p.a, v: rng() });
    } else if (th.night && i % 22 === 0) {
      const p = pointAt(T, i, (i % 44 ? 1 : -1) * (T.hw[i] + VERGE + 30));
      props.push({ type: 'lamp', x: p.x, y: p.y, s: 1, r: 0, v: rng() });
    }
  }
  for (const c of custom) props.push({ type: c.type || c.t, x: c.x, y: c.y, s: c.s || 1, r: c.r || 0, v: rng(), w: c.w, d: c.d, h: c.h, custom: true });
  // fill missing sizes
  for (const p of props) if (['tower', 'building', 'container', 'tank', 'adobe', 'mesa', 'cabin', 'crane', 'billboard', 'hut', 'ruin'].includes(p.type) && !p.w) { p.w = 110; p.d = 100; p.h = 110; }
  T.props = props;
}

/** Sanity check used by the editor and tests: returns { ok, issues[], minGap } */
export function validateTrack(T) {
  const issues = [];
  const N = T.N, skip = Math.ceil((T.maxHW * 4 + 200) / T.step);
  let worst = 1e9;
  for (let i = 0; i < N; i += 2) for (let j = i + skip; j < N; j += 2) {
    if (N - (j - i) < skip) continue;
    if (Math.abs(T.z[i] - T.z[j]) >= 45) continue; // one road passes over the other
    const d = Math.hypot(T.x[i] - T.x[j], T.y[i] - T.y[j]) - (T.hw[i] + T.hw[j]) - 2 * VERGE;
    if (d < worst) worst = d;
  }
  if (worst < 20) issues.push('The road comes too close to (or crosses) itself. Raise one section by 50+ to make a flyover, or move the points apart.');
  let maxK = 0; for (let i = 0; i < N; i++) { const lim = Math.abs(T.curv[i]) * T.hw[i]; if (lim > maxK) maxK = lim; }
  if (maxK > 0.92) issues.push('A corner is tighter than the road is wide. Smooth it out.');
  if (T.length < 4000) issues.push('Track is very short (' + Math.round(T.length) + ' px).');
  if (T.W * T.H > 45e6) issues.push('Track is huge; it will be rendered at reduced detail.');
  return { ok: issues.length === 0, issues, minGap: worst, maxK };
}

export function trackSig(data) { // stable id for custom tracks
  return 'c' + hashStr(JSON.stringify(data.pts) + (data.width || '') + (data.theme || '')).toString(36);
}
