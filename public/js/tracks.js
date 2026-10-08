// Track definitions, spline compilation, collision queries, scenery placement. Pure logic (no DOM) so it can be unit-tested in Node.
import { clamp, angDiff, mulberry32, hashStr, TAU } from './util.js';

export const STEP = 14;      // centre-line sample spacing (px)
export const VERGE = 46;     // grass/dirt shoulder between the tarmac and the barrier
export const MARGIN = 360;   // world padding around the track
export const ELEV_T = 6;     // road height above which a sample is drawn as a raised deck instead of baked on the ground
export const BANK_K = 24000, BANK_MAX = 64, BANK_LIFT = 14; // banking: tilt (height difference across the road) per unit curvature, its limit, and the gentle lift curves get
export const OCEAN_D = 1150; // depth of the ocean strip added to coastal worlds
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
  for (const [a, b, Z] of o.climb || []) for (let i = a; i <= b; i++) { const p = pts[((i % n) + n) % n], t = (i - a) / (b - a); p[2] = p[2] ?? null; p[3] = Math.max(p[3] || 0, Math.round(Z * Math.pow(Math.sin(Math.PI * t), 0.9))); }
  for (const [a, b] of o.banked || []) for (let i = a; i <= b; i++) { const p = pts[((i % n) + n) % n]; p[2] = p[2] ?? null; p[3] = p[3] || 0; p[4] = p[4] || 0; p[5] = 1; }
  for (const [a, b] of o.tun || []) for (let i = a; i <= b; i++) { const p = pts[((i % n) + n) % n]; p[2] = p[2] ?? null; p[3] = p[3] || 0; p[4] = 1; }
  return { id, name, theme, pts, width: o.width || 150, laps: o.laps || 3, seed: o.seed || hashStr(id), author: 'Kill Lap', dens: o.dens, wv: o.wv, builtin: true, diff: o.diff || 2, bomber: !!o.bomber, tags: o.tags, bank: !!o.bank };
}

/** a mountain: flat start, switchbacks climbing to a summit, then a long banked descent back down to the start */
function mountain(id, name, theme, o = {}) {
  const R = o.R || 300, W = o.legW || 1400, legs = o.legs || 4, Z = o.Z || 260, m = o.mirror ? -1 : 1, x0 = 1200, pts = [], P = (x, y, z = 0, b = 1) => pts.push([Math.round(x * m), Math.round(y), null, Math.round(z), 0, b]);
  P(0, 0, 0, 0); P(600, 0, 0, 0); P(x0, 0, 0, 0);
  const climb = []; // collect climbing points first, then assign heights by progress
  for (let l = 0; l < legs; l++) {
    const east = l % 2 === 0, y = l * 2 * R, xa = east ? x0 : x0 + W, xb = east ? x0 + W : x0;
    for (let k = 1; k <= 3; k++) climb.push([xa + (xb - xa) * k / 4, y]);
    if (l < legs - 1) { const cx = xb, cy = y + R, sgn = east ? 1 : -1; for (let a = 0.25; a <= 1.0001; a += 0.25) { const th = Math.PI * a; climb.push([cx + sgn * R * Math.sin(th), cy - R * Math.cos(th)]); } }
  }
  const K = climb.length; climb.forEach(([x, y], k) => P(x, y, Z * Math.pow((k + 1) / K, 0.95)));
  const last = climb[K - 1], ret = o.ret || [[-1, 0.9], [-0.55, 0.7]]; // the return leg swings round the mountain, descending all the way
  const yEnd = last[1], pts2 = [[x0 - 450, yEnd + 130, 0.78], [x0 - 1150, yEnd - 180, 0.55], [-650, yEnd * 0.62, 0.34], [-760, yEnd * 0.28, 0.16], [-420, 140, 0.05]];
  for (const [x, y, f] of pts2) P(x, y, Z * f);
  return finish(id, name, theme, pts, { width: o.width || 150, laps: 3, seed: o.seed, diff: o.diff || 4, bank: true, tags: ['mountain', 'banked'], bomber: o.bomber });
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
/* ---- self-crossing circuits: a parametric curve that crosses itself, then bridges at every crossing and tunnels in the long gaps */
const KNOTS = {
  f8: t => [Math.sin(t), Math.sin(2 * t) / 2],                         // figure of eight: 1 crossing
  chain: t => [Math.sin(t), Math.cos(3 * t) * 0.7],                   // three lobes: 2 crossings
  tre: t => [(Math.sin(t) + 2 * Math.sin(2 * t)) / 3, (Math.cos(t) - 2 * Math.cos(2 * t)) / 3], // trefoil: 3 crossings
  lima: t => { const r = 0.35 + Math.cos(t); return [r * Math.cos(t) * 0.9 - 0.35, r * Math.sin(t) * 0.9]; }, // loop-the-loop: 1 crossing
  bean: t => [Math.sin(t) + 0.28 * Math.sin(2 * t + 0.6), Math.sin(2 * t) / 2 + 0.2 * Math.cos(t)], // lopsided eight
};
function knotPts(o, phase) {
  const n = o.n || 36, f = KNOTS[o.kind || 'f8'], c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU + phase; let [u, v] = f(t);
    for (const [k, amp, ph] of o.h || []) { const m = 1 + amp * Math.cos(k * t + ph); u *= m; v *= 2 - m; }
    u *= o.A; v *= o.B; pts.push([Math.round(u * c - v * s), Math.round(u * s + v * c), null, 0, 0, 0]);
  }
  return pts;
}
/** dense arclength-sampled spline of a point loop (matches compileTrack's Catmull-Rom) plus every place it crosses itself */
function findCrossings(pts, minGap = 1200) {
  const n = pts.length, sub = 10, X = [], Y = [];
  for (let i = 0; i < n; i++) { const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n]; for (let k = 0; k < sub; k++) { const t = k / sub; X.push(catmull(a[0], b[0], c[0], d[0], t)); Y.push(catmull(a[1], b[1], c[1], d[1], t)); } }
  const M = X.length, cum = [0]; for (let i = 0; i < M; i++) cum.push(cum[i] + Math.hypot(X[(i + 1) % M] - X[i], Y[(i + 1) % M] - Y[i])); const L = cum[M];
  const sPt = pts.map((_, i) => cum[i * sub]), out = [];
  for (let a = 0; a < M; a++) for (let b = a + 2; b < M; b++) {
    const sa = cum[a], sb = cum[b], dd = sb - sa; if (dd < minGap || L - dd < minGap) continue;
    const a2 = (a + 1) % M, b2 = (b + 1) % M, r = [X[a2] - X[a], Y[a2] - Y[a]], q = [X[b2] - X[b], Y[b2] - Y[b]], den = r[0] * q[1] - r[1] * q[0]; if (Math.abs(den) < 1e-9) continue;
    const u = ((X[b] - X[a]) * q[1] - (Y[b] - Y[a]) * q[0]) / den, w = ((X[b] - X[a]) * r[1] - (Y[b] - Y[a]) * r[0]) / den;
    if (u >= 0 && u < 1 && w >= 0 && w < 1) out.push({ sa: sa + u * (cum[a + 1] - sa), sb: sb + w * (cum[b + 1] - sb), x: X[a] + r[0] * u, y: Y[a] + r[1] * u, ang: Math.abs(Math.atan2(Math.abs(den), r[0] * q[0] + r[1] * q[1])) });
  }
  return { out, L, sPt };
}
const circ = (a, b, L) => { const d = Math.abs(a - b) % L; return Math.min(d, L - d); };
function weave(id, name, theme, o) {
  const Zb = o.bridge || 72; let best = null;
  for (let k = 0; k < 36 && !best; k++) {
    const phase = (o.ph || 0) + (k * TAU) / 36, pts = knotPts(o, phase), { out, L, sPt } = findCrossings(pts);
    if (!out.length || out.some(c => c.ang < 0.5 || circ(c.sa, 0, L) < 1500 || circ(c.sb, 0, L) < 1500)) continue;
    // choose which pass is the flyover so the road alternates over/under
    const up = [], down = [];
    for (const c of out) {
      const score = (p, q) => up.filter(s => circ(s, q, L) < 1500).length + down.filter(s => circ(s, p, L) < 1500).length;
      if (score(c.sa, c.sb) <= score(c.sb, c.sa)) { up.push(c.sa); down.push(c.sb); } else { up.push(c.sb); down.push(c.sa); }
    }
    const PL = 330, PR = 1250;
    pts.forEach((p, i) => { for (const s of up) { const d = circ(sPt[i], s, L); if (d < PR) { const f = d <= PL ? 1 : 1 - (d - PL) / (PR - PL); p[3] = Math.max(p[3], Math.round(Zb * f * f * (3 - 2 * f))); } } });
    // tunnels through the middle of the longest gaps between crossings
    const ev = [0, ...up, ...down].sort((a, b) => a - b), gaps = ev.map((s, i) => ({ s, len: i + 1 < ev.length ? ev[i + 1] - s : L - s })).sort((a, b) => b.len - a.len);
    for (const g of gaps.slice(0, o.tunnels || 0)) if (g.len > 3300) { const mid = g.s + g.len / 2; pts.forEach((p, i) => { if (circ(sPt[i], mid, L) < (o.tunLen || 560) && p[3] < 20) p[4] = 1; }); }
    best = pts;
  }
  if (!best) best = knotPts(o, 0);
  return finish(id, name, theme, best, { ...o, tags: [...(o.tags || []), 'crossover'] });
}
function pts(id, name, theme, p, o = {}) { return finish(id, name, theme, p, o); }

export const BUILTIN_TRACKS = [
  weave('dustbowl', 'Dust Bowl', 'desert', { kind: 'f8', A: 1950, B: 1500, n: 30, h: [[3, 0.06, 0.4]], width: 170, diff: 1, seed: 11, bridge: 72 }),
  weave('pinewood', 'Pinewood Run', 'forest', { kind: 'lima', A: 1800, B: 1600, n: 34, h: [[3, 0.05, 1.2]], width: 160, diff: 1, seed: 21, tunnels: 1 }),
  weave('frostbite', 'Frostbite Pass', 'snow', { kind: 'chain', A: 2500, B: 1700, n: 60, h: [[2, 0.05, 0.8]], width: 150, diff: 2, seed: 301, tunnels: 1 }),
  weave('neon', 'Neon Nights', 'city', { kind: 'bean', bank: true, A: 1900, B: 1600, n: 36, width: 150, diff: 2, seed: 31, tunnels: 1 }),
  weave('foundry', 'The Foundry', 'industrial', { kind: 'tre', A: 2300, B: 2300, n: 42, width: 150, diff: 2, seed: 311, tunnels: 1 }),
  weave('inferno', 'Inferno Ring', 'volcano', { kind: 'f8', bank: true, A: 1850, B: 1750, n: 34, rot: 0.5, h: [[2, 0.07, 2.8]], width: 150, diff: 3, seed: 41, bridge: 76 }),
  weave('seaside', 'Seaside Sprint', 'coast', { kind: 'lima', A: 2000, B: 1500, n: 36, rot: 0.3, width: 170, diff: 1, seed: 321, tunnels: 1 }),
  weave('canyon', 'Canyon Carnage', 'mesa', { kind: 'chain', bank: true, A: 2600, B: 1700, n: 64, h: [[3, 0.05, 1]], width: 145, diff: 3, seed: 51, tunnels: 2 }),
  weave('serpent', 'Serpent', 'desert', { kind: 'tre', A: 2400, B: 2000, n: 44, rot: 0.6, width: 150, diff: 3, seed: 331, tunnels: 1 }),
  weave('timberline', 'Timberline Twist', 'forest', { kind: 'bean', bank: true, A: 2000, B: 1750, n: 40, rot: 1.0, h: [[3, 0.06, 2]], width: 145, diff: 3, seed: 61, tunnels: 1 }),
  weave('glacier', 'Glacier Gauntlet', 'snow', { kind: 'chain', bank: true, A: 2700, B: 1500, n: 62, width: 150, diff: 2, seed: 71, tunnels: 1 }),
  weave('midnight', 'Midnight Docks', 'industrial', { kind: 'f8', A: 1750, B: 1750, n: 34, rot: 1.2, h: [[2, 0.08, 2.4]], width: 150, diff: 2, seed: 81, bridge: 68 }),
  weave('kingpin', 'Kingpin Circuit', 'city', { kind: 'tre', bank: true, A: 2500, B: 2200, n: 46, rot: 0.2, width: 155, diff: 4, seed: 91, tunnels: 1 }),
  weave('lavaflow', 'Lava Flow', 'volcano', { kind: 'bean', bank: true, A: 2200, B: 1700, n: 40, rot: 2.0, width: 150, diff: 3, seed: 101, tunnels: 1 }),
  // ---- tracks with raised roads, crossovers, tunnels and hazards
  figure8('overpass', 'Overpass Chaos', 'city', { bank: true, A: 1750, B: 1560, n: 30, width: 150, diff: 3, seed: 111, bridge: 72, tags: ['flyover'] }),
  figure8('crossfire', 'Crossfire', 'warzone', { bank: true, A: 1850, B: 1500, n: 30, width: 155, diff: 3, seed: 121, bridge: 70, bomber: true, tags: ['flyover', 'air raid'] }),
  loop('tunnelvision', 'Tunnel Vision', 'mesa', { rx: 2050, ry: 1280, h: [[2, 0.14, 0.6], [3, 0.1, 2.0], [5, 0.04, 1]], n: 36, width: 150, diff: 3, seed: 131, tun: [[4, 8], [22, 25]], tags: ['tunnels'] }),
  loop('skyline', 'Skyline Highway', 'city', { bank: true, rx: 1900, ry: 1350, h: [[3, 0.11, 0.2], [5, 0.07, 1.5], [2, 0.1, 2.5]], n: 38, width: 160, diff: 3, seed: 141, elev: [[3, 9, 74], [24, 29, 74]], tun: [[16, 18]], tags: ['raised', 'tunnel'] }),
  weave('groundzero', 'Ground Zero', 'warzone', { kind: 'lima', A: 1900, B: 1500, n: 36, rot: 1.0, width: 150, diff: 3, seed: 151, bomber: true, tags: ['air raid'] }),
  figure8('foundrycross', 'Foundry Crossing', 'industrial', { A: 1800, B: 1480, n: 30, width: 150, diff: 2, seed: 161, bridge: 66, wob: 0.06, tags: ['flyover', 'trains'] }),
  mountain('alpine', 'Alpine Ascent', 'snow', { Z: 260, legs: 4, R: 300, seed: 181 }),
  mountain('redsummit', 'Red Summit', 'mesa', { Z: 320, legs: 4, R: 330, legW: 1500, mirror: true, seed: 191 }),
  loop('moltenpass', 'Molten Pass', 'volcano', { bank: true, rx: 2000, ry: 1250, h: [[2, 0.13, 1.2], [4, 0.1, 0.4], [7, 0.03, 2]], n: 36, width: 150, diff: 4, seed: 171, elev: [[12, 17, 70]], tun: [[26, 29]], tags: ['raised', 'tunnel', 'lava'] }),
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
  const nm = `${NAMES_A[Math.floor(rng() * 12)]} ${NAMES_B[Math.floor(rng() * 12)]}`, rot = rng() * TAU, width = 140 + Math.floor(rng() * 30);
  let t = null;
  if (opts.plain !== true) { // most random circuits cross over themselves; fall back to a plain loop if the shape doesn't validate
    const kinds = ['f8', 'chain', 'tre', 'lima', 'bean'], kind = kinds[Math.floor(rng() * kinds.length)], A = 1900 + rng() * 500, B = (kind === 'tre' ? A : 1500 + rng() * 300);
    const c = weave('gen' + seed, nm, theme, { kind, A, B, n: kind === 'chain' ? 60 : kind === 'tre' ? 44 : 36, rot, width, seed, tunnels: rng() < 0.6 ? 1 : 0, h: [[3, 0.04 + rng() * 0.04, rng() * TAU]], bank: rng() < 0.5 });
    if (validateTrack(compileTrack(c, { light: true })).ok) t = c;
  }
  if (!t) t = loop('gen' + seed, nm, theme, { rx: 1700 + rng() * 500, ry: 1100 + rng() * 450, h, n: 34, width, seed, rot });
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
  const dx = [], dy = [], dw = [], dz = [], dtn = [], dbk = [];
  const zP = i => P[i][3] || 0, tP = i => (P[i][4] ? 1 : 0), bP = i => (P[i][5] ? 1 : 0);
  const sub = 20;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      dx.push(catmull(a[0], b[0], c[0], d[0], t)); dy.push(catmull(a[1], b[1], c[1], d[1], t));
      dw.push(catmull(wAt((i - 1 + n) % n), wAt(i), wAt((i + 1) % n), wAt((i + 2) % n), t));
      const i0 = (i - 1 + n) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
      dz.push(Math.max(0, catmull(zP(i0), zP(i), zP(i2), zP(i3), t))); dtn.push(tP(i) + (tP(i2) - tP(i)) * t); dbk.push(bP(i) + (bP(i2) - bP(i)) * t);
    }
  }
  const M = dx.length; const cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) cum[i + 1] = cum[i] + Math.hypot(dx[(i + 1) % M] - dx[i], dy[(i + 1) % M] - dy[i]);
  const total = cum[M];
  const N = Math.max(40, Math.round(total / STEP)); const step = total / N;
  const x = new Float32Array(N), y = new Float32Array(N), hw = new Float32Array(N), z = new Float32Array(N), tn = new Uint8Array(N), bkf = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * step;
    while (j < M - 1 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1, f = clamp((s - cum[j]) / seg, 0, 1), k = (j + 1) % M;
    x[i] = dx[j] + (dx[k] - dx[j]) * f; y[i] = dy[j] + (dy[k] - dy[j]) * f; hw[i] = (dw[j] + (dw[k] - dw[j]) * f) / 2;
    z[i] = dz[j] + (dz[k] - dz[j]) * f; tn[i] = dtn[j] + (dtn[k] - dtn[j]) * f > 0.5 ? 1 : 0; bkf[i] = dbk[j] + (dbk[k] - dbk[j]) * f;
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
  let ox = MARGIN - minX, oy = MARGIN - minY;
  let W = Math.ceil(maxX - minX + MARGIN * 2), H = Math.ceil(maxY - minY + MARGIN * 2);
  // coastal maps (and any map with a tidal wave) get a real ocean along one edge of the world; the wave rolls in from it
  let ocean = null;
  if (data.theme === 'coast' || items0.some(it => it.t === 'wave')) {
    const side = 'NESW'[(data.seed || hashStr(data.id || 'x')) % 4], D = OCEAN_D;
    if (side === 'N') { oy += D; H += D; ocean = { side, s: D, ix: 0, iy: 1 }; } else if (side === 'S') { H += D; ocean = { side, s: H - D, ix: 0, iy: -1 }; }
    else if (side === 'W') { ox += D; W += D; ocean = { side, s: D, ix: 1, iy: 0 }; } else { W += D; ocean = { side, s: W - D, ix: -1, iy: 0 }; }
  }
  for (let i = 0; i < N; i++) { x[i] += ox; y[i] += oy; }
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

  // banking: tilt the road across its width on curves (outer edge higher) and lift banked curves gently off the ground
  const flatW = new Float32Array(N).fill(1); for (let i = -16; i <= 16; i++) { const q = ((i % N) + N) % N, f = Math.abs(i) / 16; flatW[q] = f * f * (3 - 2 * f); }
  const bAmt = new Float32Array(N), tilt = new Float32Array(N), grade = new Float32Array(N); const allBank = !!data.bank;
  for (let i = 0; i < N; i++) { let a = 0; for (let k = -10; k <= 10; k++) a += allBank ? 1 : bkf[(i + k + N) % N]; bAmt[i] = a / 21; }
  for (let i = 0; i < N; i++) { tilt[i] = bAmt[i] * clamp(curv[i] * BANK_K, -BANK_MAX, BANK_MAX) * flatW[i]; z[i] += BANK_LIFT * clamp(Math.abs(tilt[i]) / 24, 0, 1); }
  for (let i = 0; i < N; i++) grade[i] = (z[(i + 1) % N] - z[(i - 1 + N) % N]) / (2 * step);
  // barrier offset per sample: wide grass verge on the ground, tight parapets on decks and in tunnels
  const tnS = new Float32Array(N); for (let i = 0; i < N; i++) { let a = 0; for (let k = -8; k <= 8; k++) a += tn[(i + k + N) % N]; tnS[i] = a / 17; }
  const wl = new Float32Array(N), elev = new Uint8Array(N); let hasElev = false, hasTun = false;
  for (let i = 0; i < N; i++) {
    const g = clamp(z[i] / 20, 0, 1); let w = VERGE - (VERGE - BRIDGE_WALL) * g; w = Math.min(w, VERGE - (VERGE - TUN_WALL) * tnS[i]); wl[i] = w;
    elev[i] = z[i] >= ELEV_T ? 1 : 0; if (elev[i]) hasElev = true; if (tn[i]) hasTun = true;
  }
  const T = {
    z, tn, wl, elev, hasElev, hasTun, tilt, grade, hazards: [], bomber: false, ocean,
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

/** shoreline position (along the inward axis) for lateral coordinate c; wavy so the beach looks natural */
export const shoreWob = c => 55 * Math.sin(c / 230) + 35 * Math.sin(c / 89 + 1.3);
/** how far (px) a point is into the water: positive = at sea, negative = on land */
export function oceanAt(T, x, y) {
  const o = T.ocean; if (!o) return -1e9;
  switch (o.side) { case 'N': return o.s + shoreWob(x) - y; case 'S': return y - (o.s + shoreWob(x)); case 'W': return o.s + shoreWob(y) - x; default: return x - (o.s + shoreWob(y)); }
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
  out.hw = T.hw[bi] + (T.hw[j] - T.hw[bi]) * bt; out.wl = T.wl[bi] + (T.wl[j] - T.wl[bi]) * bt; out.z = T.z[bi] + (T.z[j] - T.z[bi]) * bt; out.tilt = T.tilt[bi] + (T.tilt[j] - T.tilt[bi]) * bt; out.zl = out.z - out.tilt * clamp(out.lat / (2 * out.hw), -0.6, 0.6);
  return out;
}
export function pointAt(T, f, lat = 0) {
  f = ((f % T.N) + T.N) % T.N; const i = Math.floor(f), j = (i + 1) % T.N, t = f - i;
  const cx = T.x[i] + (T.x[j] - T.x[i]) * t, cy = T.y[i] + (T.y[j] - T.y[i]) * t;
  const tx = T.tx[i] + (T.tx[j] - T.tx[i]) * t, ty = T.ty[i] + (T.ty[j] - T.ty[i]) * t; const l = Math.hypot(tx, ty) || 1;
  return { x: cx - (ty / l) * lat, y: cy + (tx / l) * lat, a: Math.atan2(ty, tx), hw: T.hw[i], z: T.z[i] + (T.z[j] - T.z[i]) * t - (T.tilt[i] + (T.tilt[j] - T.tilt[i]) * t) * clamp(lat / (2 * T.hw[i]), -0.6, 0.6) };
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
      if (i > N * 0.15 && i < N - 20 && !items.some(o => o.t === 'oil' && Math.hypot(o.x - T.x[i], o.y - T.y[i]) < 800)) {
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
  T.items = items.map((it, k) => { const n = T.hasTun ? nearest(T, it.x, it.y, -1) : null; return { ...it, id: k, tn: !!(n && T.tn[n.i] && Math.abs(n.lat) < n.hw + 20 && (it.z || 0) < 12) }; });
}


/* ------------------------------------------------------------------ hazards */
export const HAZ_TYPES = ['train', 'cross', 'ford', 'jump', 'lava', 'wave', 'bomber'];
const THEME_HAZ = { desert: { jump: 2, train: 1 }, forest: { ford: 2, jump: 1, train: 1 }, snow: { jump: 1 }, city: { cross: 4 }, industrial: { train: 1, jump: 1 }, volcano: { lava: 4, jump: 1 }, coast: { wave: 1, ford: 1, jump: 1 }, mesa: { jump: 2, train: 1 }, warzone: { jump: 1 } };
function placeHazards(T, custom) {
  const rng = mulberry32(T.seed ^ 0x2545f491), N = T.N, out = [];
  const th = THEME_HAZ[T.theme] || {};
  const flat = (i, span, lim) => { for (let q = -span; q <= span; q++) { const k = (i + q + N) % N; if (Math.abs(T.curv[k]) > lim || T.z[k] >= ELEV_T || T.tn[k]) return false; } return true; };
  const underDeck = i => { for (let k = 0; k < N; k += 2) { const dk = Math.min(Math.abs(k - i), N - Math.abs(k - i)); if (dk > 30 && T.z[k] >= 40 && Math.hypot(T.x[k] - T.x[i], T.y[k] - T.y[i]) < 460) return true; } return false; };
  const far = (x, y, d, type) => !out.some(h => Math.hypot(h.x - x, h.y - y) < (h.t === type ? d : 520)) && !T.items.some(it => (it.t === 'boost' || it.t === 'oil') && Math.hypot(it.x - x, it.y - y) < 160);
  if (T.data.hazards !== false) for (const [type, count] of Object.entries(th)) {
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < count; tries++) {
      const i = Math.floor(N * (0.14 + rng() * 0.78));
      const span = type === 'wave' ? 9 : type === 'train' ? 9 : type === 'cross' ? 6 : type === 'lava' ? 3 : 10, lim = type === 'lava' ? 0.01 : type === 'wave' || type === 'cross' ? 0.0011 : type === 'train' ? 0.0009 : 0.0007;
      if (!flat(i, span, lim) || underDeck(i) || !far(T.x[i], T.y[i], type === 'cross' ? 1500 : type === 'train' ? 2200 : 1100, type)) continue;
      if (type === 'wave' && T.ocean) { const dist = -oceanAt(T, T.x[i], T.y[i]); if (dist < 500 || dist > 2700) continue; }
      const p = pointAt(T, i, 0); const hz = { t: type, x: p.x, y: p.y, a: p.a, hw: T.hw[i], f: i, seed: Math.floor(rng() * 1e6), side: rng() < 0.5 ? 1 : -1 }; if (type === 'train') { if (!setupRail(T, hz, true)) continue; } out.push(hz); placed++;
    }
  }
  for (const c of custom) {
    if (c.t === 'bomber') { T.bomber = true; continue; }
    const n = nearest(T, c.x, c.y, -1), p = pointAt(T, n.f, 0);
    const onRoad = Math.abs(n.lat) < n.hw + 60;
    const hzc = { t: c.t, x: onRoad && c.t !== 'lava' && c.t !== 'wave' ? p.x : c.x, y: onRoad && c.t !== 'lava' && c.t !== 'wave' ? p.y : c.y, a: p.a, hw: n.hw, f: Math.floor(n.f), seed: ((c.x * 31 + c.y * 17) | 0) & 0xffff, side: n.lat >= 0 ? 1 : -1 }; if (c.t === 'train') { setupRail(T, hzc); if (!hzc.cr.length) hzc.cr = [{ x: hzc.x, y: hzc.y, u: 0, f: n.f, a: p.a, hw: n.hw, tx: Math.cos(p.a), ty: Math.sin(p.a), nx: -Math.sin(p.a), ny: Math.cos(p.a) }]; }
    out.push(hzc);
  }
  for (const h of out) if (h.t === 'wave') { // the wave travels from the ocean strip inland, perpendicular to the shore
    if (T.ocean) { h.a = Math.atan2(-T.ocean.ix, T.ocean.iy); h.side = 1; h.R = Math.max(300, -oceanAt(T, h.x, h.y)) + 140; } else h.R = h.hw + 746;
  }
  // no oil slicks / boost pads on a level crossing
  const crs = out.filter(h => h.t === 'train').flatMap(h => h.cr || []);
  if (crs.length) T.items = T.items.filter(it => !((it.t === 'oil' || it.t === 'boost') && crs.some(c => Math.hypot(it.x - c.x, it.y - c.y) < 300))).map((it, k) => ({ ...it, id: k }));
  // level crossings: open a gap in the roadside barriers where the rails pass through
  T.wallGap = new Uint8Array(N);
  for (const h of out) if (h.t === 'train' && h.rx != null) for (let i = 0; i < N; i++) for (const [s, bit] of [[-1, 1], [1, 2]]) {
    const p = pointAt(T, i, s * (T.hw[i] + VERGE)); if (Math.abs((p.x - h.x) * -h.ry + (p.y - h.y) * h.rx) < 54) T.wallGap[i] |= bit;
  }
  if (T.data.bomber || (T.th.bomber && T.data.hazards !== false)) T.bomber = true;
  T.hazards = out.map((h, k) => ({ ...h, id: k }));
}

/** A railway crosses the whole map along a line through the hazard: find where it meets the road (each meeting becomes a level crossing). */
function setupRail(T, h, strict = false) {
  if (!strict) return railTry(T, h, 0, false);
  for (const d of [0, 0.18, -0.18, 0.36, -0.36, 0.55, -0.55]) if (railTry(T, h, d, true)) return true;
  return false;
}
function railTry(T, h, delta, strict) {
  const rx = Math.cos(h.a + Math.PI / 2 + delta), ry = Math.sin(h.a + Math.PI / 2 + delta), N = T.N; let u0 = -1e9, u1 = 1e9;
  const lim = (p, d, max) => { if (Math.abs(d) < 1e-6) return; const a = -p / d, b = (max - p) / d; u0 = Math.max(u0, Math.min(a, b)); u1 = Math.min(u1, Math.max(a, b)); };
  lim(h.x, rx, T.W); lim(h.y, ry, T.H); h.rx = rx; h.ry = ry; h.u0 = u0; h.u1 = u1;
  const cr = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, si = (T.x[i] - h.x) * -ry + (T.y[i] - h.y) * rx, sj = (T.x[j] - h.x) * -ry + (T.y[j] - h.y) * rx;
    if (!(si * sj <= 0) || (si === 0 && sj === 0)) continue;
    const t = si === sj ? 0 : si / (si - sj), px = T.x[i] + (T.x[j] - T.x[i]) * t, py = T.y[i] + (T.y[j] - T.y[i]) * t, u = (px - h.x) * rx + (py - h.y) * ry;
    if (u < u0 + 40 || u > u1 - 40 || T.elev[i] || T.elev[j] || T.tn[i] || i < 22 || i > N - 22) continue;
    const a = T.ang[i]; cr.push({ x: px, y: py, u, f: i + t, a, hw: T.hw[i], tx: Math.cos(a), ty: Math.sin(a), nx: -Math.sin(a), ny: Math.cos(a) });
  }
  cr.sort((p, q) => p.u - q.u); const out = []; for (const c of cr) if (!out.length || c.u - out[out.length - 1].u > 160) out.push(c);
  h.cr = out; if (!strict) return true;
  // a tidy railway: meets the road square-on, never runs alongside it, and stays clear of tunnels, flyovers and the start
  if (!out.length || out.length > 4) return false;
  for (const c of out) { if (Math.abs(rx * c.nx + ry * c.ny) < 0.82) return false; }
  for (let i = 0; i < N; i++) {
    const w = (T.x[i] - h.x) * -ry + (T.y[i] - h.y) * rx, reach = T.hw[i] + 170; if (Math.abs(w) > reach) continue;
    if (!out.some(c => { const d = Math.min(Math.abs(c.f - i), N - Math.abs(c.f - i)); return d <= reach / (T.step * 0.8) + 2; }) || T.tn[i] || (T.z[i] >= 30 && !out.some(c => Math.abs(c.f - i) < 6))) return false;
  }
  return true;
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
  const tunPts = [], deckPts = []; for (let i = 0; i < T.N; i += 2) { if (T.tn[i]) tunPts.push(i); if (T.z[i] >= 30) deckPts.push(i); }
  const nearDeck = (x, y, r) => deckPts.some(i => Math.hypot(T.x[i] - x, T.y[i] - y) < T.hw[i] + r);
  const nearTun = (x, y, r) => tunPts.some(i => Math.hypot(T.x[i] - x, T.y[i] - y) < T.hw[i] + r);
  const placedGrid = new Map(); const nearRail = (x, y, r = 135) => T.hazards.some(h => h.t === 'train' && Math.abs((x - h.x) * -h.ry + (y - h.y) * h.rx) < r);
  for (let tries = 0; props.length < target && tries < target * 12; tries++) {
    const px = rng() * T.W, py = rng() * T.H;
    const type = list[Math.floor(rng() * list.length)];
    const big = ['tower', 'building', 'container', 'tank', 'adobe', 'mesa', 'cabin', 'crane', 'billboard', 'hut', 'ruin'].includes(type);
    const need = VERGE + 36 + (big ? 100 : 0);
    if (clearDist(px, py) < need) continue;
    if (T.ocean && oceanAt(T, px, py) > -80) continue;
    if (tunPts.length && nearTun(px, py, 120 + (big ? 140 : 0))) continue;
    if (deckPts.length && nearDeck(px, py, 90 + (big ? 190 : 0))) continue; // keep tall scenery from leaning over flyovers
    if (T.hazards.some(h => h.t === 'train' && Math.abs((px - h.x) * -h.ry + (py - h.y) * h.rx) < 135 + (big ? 130 : 0))) continue;
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
      const p = pointAt(T, i, side * (T.hw[i] + VERGE + 14)); if (nearRail(p.x, p.y)) continue;
      props.push({ type: 'tyres', x: p.x, y: p.y, s: 1, r: p.a, v: rng() });
    } else if (th.night && i % 22 === 0) {
      const p = pointAt(T, i, (i % 44 ? 1 : -1) * (T.hw[i] + VERGE + 30)); if (nearRail(p.x, p.y)) continue;
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
