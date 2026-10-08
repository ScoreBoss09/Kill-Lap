// Rival drivers: personalities (which tweak the AI) and procedurally drawn portraits.
import { mulberry32, hashStr, shade, TAU } from './util.js';

// aggr: how eagerly they shoot/ram (multiplies the difficulty setting); skill: pace multiplier; style: label shown on the line-up
export const DRIVERS = [
  { name: 'Rusty',       nick: 'The Scrapyard King', bio: 'Built his first car from a washing machine. Hates paint, loves dents.', style: 'Reckless', aggr: 1.1, skill: 0.97, face: { skin: '#d9a273', hair: '#6b3a1e', hs: 'short', beard: 'stubble', acc: 'cap', eyes: '#3a5a2a', mouth: 'grin', col: '#a8582b' } },
  { name: 'Viper',       nick: 'Venom',              bio: 'Cold, calculating, never brakes early. Strikes when you least expect it.', style: 'Precise', aggr: 1.0, skill: 1.05, face: { skin: '#c68b5e', hair: '#111111', hs: 'slick', beard: 'none', acc: 'shades', eyes: '#222', mouth: 'smirk', col: '#2c8a4a' } },
  { name: 'Mad Dog',     nick: 'Barks Before He Bites', bio: 'Lost a bet, won a car, never looked back. Will ram you for fun.', style: 'Aggressive', aggr: 1.4, skill: 0.96, face: { skin: '#e0b48a', hair: '#8a5a2a', hs: 'mohawk', beard: 'full', acc: 'scar', eyes: '#8a2222', mouth: 'grin', col: '#c44a2a' } },
  { name: 'Sledge',      nick: 'Hammer',             bio: 'Ex-demolition derby champion. Subtle as a brick, twice as heavy.', style: 'Bruiser', aggr: 1.3, skill: 0.94, face: { skin: '#b57a52', hair: '#222', hs: 'bald', beard: 'goatee', acc: 'none', eyes: '#2a2a2a', mouth: 'frown', col: '#3b6fd1' } },
  { name: 'Hex',         nick: 'The Witch',          bio: 'Rumoured to curse rivals\' engines. Actually just a brilliant mechanic.', style: 'Smooth', aggr: 0.8, skill: 1.04, face: { skin: '#e8c7a8', hair: '#6a2a8a', hs: 'long', beard: 'none', acc: 'goggles', eyes: '#7a2aaa', mouth: 'smirk', col: '#6a4bc4' } },
  { name: 'Blitz',       nick: 'Lightning',          bio: 'Fastest off the line, worst in the corners. Pure speed, zero patience.', style: 'Flat-out', aggr: 0.9, skill: 1.02, face: { skin: '#f0d0b0', hair: '#f2d23a', hs: 'spiky', beard: 'none', acc: 'headband', eyes: '#2a6ac0', mouth: 'grin', col: '#e6c229' } },
  { name: 'Havoc',       nick: 'Pocket Chaos',       bio: 'Small, loud and terrifying. Fires everything at everyone, constantly.', style: 'Chaotic', aggr: 1.5, skill: 0.95, face: { skin: '#d8a070', hair: '#c0392b', hs: 'afro', beard: 'none', acc: 'goggles', eyes: '#222', mouth: 'grin', col: '#b11f2c' } },
  { name: 'Grim',        nick: 'The Undertaker',     bio: 'Never speaks. Leaves a trail of wrecks and a lingering sense of dread.', style: 'Dirty', aggr: 1.2, skill: 1.0, face: { skin: '#cfc2b0', hair: '#1a1a1a', hs: 'buzz', beard: 'stubble', acc: 'mask', eyes: '#111', mouth: 'frown', col: '#444a55' } },
  { name: 'Nitro Nancy', nick: 'Granny Boost',       bio: 'Retired at 70, back at 71. Hoards nitro canisters like fine china.', style: 'Defensive', aggr: 0.7, skill: 1.03, face: { skin: '#eac8a8', hair: '#d8d8d8', hs: 'bun', beard: 'none', acc: 'glasses', eyes: '#2a6a8a', mouth: 'smile', col: '#22b8c9' } },
  { name: 'Scrap',       nick: 'Junkyard Joe',       bio: 'Drives whatever is left over. Surprisingly hard to kill.', style: 'Tough', aggr: 1.0, skill: 0.93, face: { skin: '#c89468', hair: '#5a3a1a', hs: 'short', beard: 'full', acc: 'eyepatch', eyes: '#3a3a3a', mouth: 'frown', col: '#8a6a3a' } },
  { name: 'Bones',       nick: 'Skeleton Crew',      bio: 'Has broken everything twice. Races with a grin and a cast.', style: 'Fearless', aggr: 1.15, skill: 0.98, face: { skin: '#e8dcc8', hair: '#222', hs: 'bald', beard: 'none', acc: 'skull', eyes: '#111', mouth: 'grin', col: '#e8e8e8' } },
  { name: 'Vandal',      nick: 'Spray Can',          bio: 'Tags every wall he scrapes. Style over lap times.', style: 'Showboat', aggr: 1.0, skill: 0.97, face: { skin: '#d6a07a', hair: '#22c0a0', hs: 'mohawk', beard: 'none', acc: 'bandana', eyes: '#222', mouth: 'smirk', col: '#ff7ab8' } },
  { name: 'Ghost',       nick: 'Now You See Me',     bio: 'Appears from nowhere, passes without a sound, vanishes ahead.', style: 'Silent', aggr: 0.9, skill: 1.06, face: { skin: '#f0eae0', hair: '#ffffff', hs: 'slick', beard: 'none', acc: 'visor', eyes: '#88c8ff', mouth: 'flat', col: '#9be2ff' } },
  { name: 'Razor',       nick: 'Sharp Edges',        bio: 'Corners like a blade, argues like a lawyer. Always has a plan.', style: 'Tactical', aggr: 1.05, skill: 1.03, face: { skin: '#b8825a', hair: '#111', hs: 'fade', beard: 'mustache', acc: 'shades', eyes: '#111', mouth: 'smirk', col: '#2f8f5a' } },
  { name: 'Cinder',      nick: 'Burn Notice',        bio: 'Survived a pit fire and came back angrier. Loves flamethrowers.', style: 'Vengeful', aggr: 1.3, skill: 0.99, face: { skin: '#d49a78', hair: '#c04a1a', hs: 'short', beard: 'stubble', acc: 'scar', eyes: '#c04a1a', mouth: 'frown', col: '#ff9a1f' } },
  { name: 'Wrecker',     nick: 'Last Rites',         bio: 'Scores kills, not laps. Rivals pull over when they see him.', style: 'Brutal', aggr: 1.45, skill: 1.0, face: { skin: '#a8714a', hair: '#1a1a1a', hs: 'long', beard: 'full', acc: 'shades', eyes: '#111', mouth: 'frown', col: '#2a2d36' } },
];
export const DRIVER_BY_NAME = Object.fromEntries(DRIVERS.map(d => [d.name, d]));

const SKINS = ['#f0d0b0', '#e0b48a', '#c68b5e', '#a8714a', '#8a5a3a', '#6b4429'];
const HAIRS = ['#111111', '#3a2414', '#6b3a1e', '#a8702a', '#d8c070', '#c0392b', '#d8d8d8', '#3a6ac0'];
const HS = ['short', 'long', 'spiky', 'mohawk', 'buzz', 'bald', 'afro', 'slick', 'bun'];
const ACCS = ['none', 'none', 'shades', 'goggles', 'cap', 'bandana', 'glasses', 'scar', 'headband'];
const BEARDS = ['none', 'none', 'stubble', 'full', 'goatee', 'mustache'];

/** Any name (including other human players) gets a stable procedurally generated driver. */
export function driverFor(name) {
  if (DRIVER_BY_NAME[name]) return DRIVER_BY_NAME[name];
  const r = mulberry32(hashStr(name || 'x')), pick = a => a[Math.floor(r() * a.length)];
  const cols = ['#d2552b', '#3b6fd1', '#2f8f5a', '#6a4bc4', '#b11f2c', '#e6c229', '#22b8c9'];
  return { name, nick: 'Racer', bio: 'A fresh face on the circuit.', style: 'Unknown', aggr: 1, skill: 1, face: { skin: pick(SKINS), hair: pick(HAIRS), hs: pick(HS), beard: pick(BEARDS), acc: pick(ACCS), eyes: '#222', mouth: pick(['grin', 'smirk', 'smile', 'flat']), col: pick(cols) } };
}

const cache = new Map();
/** Returns a canvas with the driver's portrait (cached). size is the pixel size of the (square) canvas. */
export function portrait(name, size = 96) {
  const key = name + '|' + size; let c = cache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = size; drawPortrait(c.getContext('2d'), driverFor(name), size); cache.set(key, c); return c;
}

function drawPortrait(g, d, S) {
  const f = d.face, u = S / 100; g.save(); g.scale(u, u);
  // backdrop
  const bg = g.createLinearGradient(0, 0, 0, 100); bg.addColorStop(0, shade(f.col, 0.25)); bg.addColorStop(1, shade(f.col, -0.55)); g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
  g.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(i * 24 - 20, 100); g.lineTo(i * 24 + 6, 0); g.lineTo(i * 24 + 14, 0); g.lineTo(i * 24 - 12, 100); g.fill(); }
  // shoulders / jacket
  g.fillStyle = shade(f.col, -0.1); g.beginPath(); g.moveTo(8, 100); g.quadraticCurveTo(14, 70, 38, 66); g.lineTo(62, 66); g.quadraticCurveTo(86, 70, 92, 100); g.fill();
  g.fillStyle = shade(f.col, -0.4); g.beginPath(); g.moveTo(40, 66); g.lineTo(50, 82); g.lineTo(60, 66); g.fill(); g.fillStyle = '#e8e8e8'; g.fillRect(30, 90, 8, 10); g.fillRect(62, 90, 8, 10);
  // neck
  g.fillStyle = shade(f.skin, -0.18); g.fillRect(42, 56, 16, 14);
  const hair = (draw) => { g.fillStyle = f.hair; draw(); };
  // hair behind head
  if (f.hs === 'long') hair(() => { g.beginPath(); g.ellipse(50, 48, 27, 30, 0, 0, TAU); g.fill(); g.fillRect(23, 48, 54, 34); });
  if (f.hs === 'afro') hair(() => { g.beginPath(); g.arc(50, 36, 31, 0, TAU); g.fill(); });
  if (f.hs === 'bun') hair(() => { g.beginPath(); g.arc(50, 12, 10, 0, TAU); g.fill(); });
  // ears + head
  g.fillStyle = shade(f.skin, -0.08); g.beginPath(); g.ellipse(26, 46, 4, 7, 0, 0, TAU); g.ellipse(74, 46, 4, 7, 0, 0, TAU); g.fill();
  g.fillStyle = f.skin; g.beginPath(); g.ellipse(50, 45, 23, 27, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.ellipse(58, 52, 14, 20, 0.2, 0, TAU); g.fill();
  // beard
  g.fillStyle = f.hair;
  if (f.beard === 'full') { g.beginPath(); g.moveTo(28, 50); g.quadraticCurveTo(30, 78, 50, 78); g.quadraticCurveTo(70, 78, 72, 50); g.quadraticCurveTo(62, 62, 50, 60); g.quadraticCurveTo(38, 62, 28, 50); g.fill(); }
  else if (f.beard === 'goatee') { g.beginPath(); g.ellipse(50, 70, 7, 8, 0, 0, TAU); g.fill(); }
  else if (f.beard === 'stubble') { g.globalAlpha = 0.28; g.beginPath(); g.moveTo(28, 52); g.quadraticCurveTo(32, 76, 50, 76); g.quadraticCurveTo(68, 76, 72, 52); g.quadraticCurveTo(62, 62, 50, 60); g.quadraticCurveTo(38, 62, 28, 52); g.fill(); g.globalAlpha = 1; }
  if (f.beard === 'mustache') { g.beginPath(); g.moveTo(38, 60); g.quadraticCurveTo(50, 55, 62, 60); g.quadraticCurveTo(50, 65, 38, 60); g.fill(); }
  // mouth
  g.strokeStyle = '#4a1a1a'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
  const m = f.mouth; if (m === 'grin') { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(40, 62); g.quadraticCurveTo(50, 72, 60, 62); g.closePath(); g.fill(); g.stroke(); }
  else if (m === 'smirk') { g.moveTo(42, 64); g.quadraticCurveTo(52, 66, 60, 60); g.stroke(); } else if (m === 'frown') { g.moveTo(42, 66); g.quadraticCurveTo(50, 60, 58, 66); g.stroke(); }
  else if (m === 'smile') { g.moveTo(42, 62); g.quadraticCurveTo(50, 70, 58, 62); g.stroke(); } else { g.moveTo(43, 64); g.lineTo(57, 64); g.stroke(); }
  // nose
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(50, 46); g.lineTo(47, 56); g.lineTo(52, 57); g.stroke();
  // eyes
  const eye = (x) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 44, 5.5, 3.6, 0, 0, TAU); g.fill(); g.fillStyle = f.eyes; g.beginPath(); g.arc(x, 44, 2.4, 0, TAU); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(x, 44, 1.1, 0, TAU); g.fill(); };
  eye(39); eye(61); g.strokeStyle = f.hair; g.lineWidth = 2.6; g.beginPath(); g.moveTo(32, 37); g.lineTo(45, 38); g.moveTo(55, 38); g.lineTo(68, 37); g.stroke();
  // hair on top
  if (f.hs === 'short') hair(() => { g.beginPath(); g.ellipse(50, 28, 24, 15, 0, Math.PI, TAU); g.fill(); g.fillRect(26, 26, 48, 6); });
  if (f.hs === 'buzz' || f.hs === 'fade') { g.globalAlpha = 0.55; hair(() => { g.beginPath(); g.ellipse(50, 28, 23, 13, 0, Math.PI, TAU); g.fill(); }); g.globalAlpha = 1; }
  if (f.hs === 'slick') hair(() => { g.beginPath(); g.ellipse(50, 26, 24, 14, 0, Math.PI, TAU); g.fill(); g.fillRect(26, 24, 48, 8); });
  if (f.hs === 'spiky') hair(() => { g.beginPath(); g.moveTo(26, 34); for (let i = 0; i < 7; i++) { g.lineTo(26 + i * 8 + 4, 8 + (i % 2) * 8); g.lineTo(26 + i * 8 + 8, 30); } g.lineTo(74, 34); g.fill(); });
  if (f.hs === 'mohawk') hair(() => { g.beginPath(); g.moveTo(42, 32); g.lineTo(44, 4); g.lineTo(50, 12); g.lineTo(56, 2); g.lineTo(58, 32); g.fill(); });
  if (f.hs === 'afro') hair(() => { g.beginPath(); g.ellipse(50, 24, 30, 16, 0, Math.PI, TAU); g.fill(); });
  if (f.hs === 'long' || f.hs === 'bun') hair(() => { g.beginPath(); g.ellipse(50, 28, 25, 15, 0, Math.PI, TAU); g.fill(); });
  // accessories
  const a = f.acc;
  if (a === 'shades') { g.fillStyle = '#0b0b0b'; g.fillRect(29, 39, 18, 9); g.fillRect(53, 39, 18, 9); g.fillRect(46, 41, 8, 3); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(31, 40, 6, 2); g.fillRect(55, 40, 6, 2); }
  if (a === 'goggles') { g.strokeStyle = '#2a2a2a'; g.lineWidth = 4; g.fillStyle = 'rgba(255,170,60,0.55)'; g.beginPath(); g.arc(39, 43, 8, 0, TAU); g.arc(61, 43, 8, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.moveTo(47, 43); g.lineTo(53, 43); g.stroke(); g.fillStyle = '#3a3a3a'; g.fillRect(24, 40, 6, 6); g.fillRect(70, 40, 6, 6); }
  if (a === 'glasses') { g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.arc(39, 44, 8, 0, TAU); g.arc(61, 44, 8, 0, TAU); g.moveTo(47, 44); g.lineTo(53, 44); g.stroke(); }
  if (a === 'eyepatch') { g.fillStyle = '#111'; g.beginPath(); g.ellipse(61, 44, 8, 7, 0, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 30); g.lineTo(72, 40); g.stroke(); }
  if (a === 'cap') { g.fillStyle = shade(f.col, -0.1); g.beginPath(); g.ellipse(50, 28, 25, 13, 0, Math.PI, TAU); g.fill(); g.fillRect(24, 26, 58, 5); g.fillStyle = shade(f.col, -0.35); g.fillRect(26, 29, 54, 3); }
  if (a === 'bandana') { g.fillStyle = '#c0392b'; g.fillRect(25, 26, 50, 9); g.beginPath(); g.moveTo(74, 28); g.lineTo(88, 24); g.lineTo(82, 38); g.fill(); g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) g.fillRect(30 + i * 9, 29, 3, 3); }
  if (a === 'headband') { g.fillStyle = '#e8e8e8'; g.fillRect(25, 29, 50, 6); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(50, 32, 3, 0, TAU); g.fill(); }
  if (a === 'scar') { g.strokeStyle = '#a04a3a'; g.lineWidth = 2; g.beginPath(); g.moveTo(64, 32); g.lineTo(58, 56); g.stroke(); g.strokeStyle = '#e8c0b0'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(60 + i * -1.2 + 3, 38 + i * 5); g.lineTo(57 + i * -1.2, 40 + i * 5); g.stroke(); } }
  if (a === 'mask') { g.fillStyle = '#1c1f26'; g.beginPath(); g.moveTo(26, 52); g.quadraticCurveTo(50, 90, 74, 52); g.lineTo(74, 66); g.quadraticCurveTo(50, 90, 26, 66); g.fill(); g.fillStyle = '#3a3f4a'; for (let i = 0; i < 4; i++) g.fillRect(38 + i * 7, 62, 3, 10); }
  if (a === 'skull') { g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(50, 66, 14, 8, 0, 0, TAU); g.fill(); g.fillStyle = '#111'; for (let i = 0; i < 5; i++) g.fillRect(40 + i * 5, 62, 2, 8); g.beginPath(); g.ellipse(39, 44, 6, 7, 0, 0, TAU); g.ellipse(61, 44, 6, 7, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill(); }
  if (a === 'visor') { g.fillStyle = 'rgba(120,200,255,0.65)'; g.fillRect(26, 37, 48, 12); g.strokeStyle = '#223'; g.lineWidth = 2; g.strokeRect(26, 37, 48, 12); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(30, 39, 14, 2); }
  // vignette frame
  g.restore(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = Math.max(2, S / 24); g.strokeRect(0, 0, S, S);
}
