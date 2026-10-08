// Local profile, settings, records, ghosts and custom tracks (localStorage). Everything is wrapped in try/catch so the game still runs without storage.
import { CARS, UPG_KEYS, PERF_KEYS, UPGRADES, carValue } from './cars.js';

const KEY = 'killlap.v1';
const DEFAULTS = () => ({
  name: 'Racer' + Math.floor(Math.random() * 900 + 100), cash: 2500, owned: ['scrapper'], car: 'scrapper', paints: {}, upg: { scrapper: {} },
  career: { done: {}, active: null, final: {} }, records: {}, ghosts: {}, stats: { races: 0, wins: 0, podiums: 0, kills: 0, deaths: 0, laps: 0, pickups: 0, crashes: 0, playTime: 0, earned: 0, topSpeed: 0, dmgDealt: 0, roadkill: 0, trainHits: 0 },
  achievements: {}, customTracks: {}, server: '', daily: {},
  settings: { master: 0.8, music: 0.5, sfx: 0.85, quality: 2, fps: false, shake: true, rumble: true, deadzone: 0.14, sens: 1.0, online: true, fullscreen: false, zoom: 660, binds: {}, mapRes: 1 },
});
let data = null;
function load() {
  const d = DEFAULTS();
  try { const raw = localStorage.getItem(KEY); if (raw) { const j = JSON.parse(raw); Object.assign(d, j); d.settings = Object.assign(DEFAULTS().settings, j.settings || {}); d.stats = Object.assign(DEFAULTS().stats, j.stats || {}); } } catch {}
  return d;
}
const Store = {
  get d() { return data || (data = load()); },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { console.warn('save failed', e); } },
  get s() { return this.d.settings; },
  upgOf(carId) { return (this.d.upg[carId] ||= {}); },
  owns(id) { return this.d.owned.includes(id); },
  buyCar(id) { const c = CARS.find(x => x.id === id); if (!c || this.owns(id) || this.d.cash < c.price) return false; this.d.cash -= c.price; this.d.owned.push(id); this.d.upg[id] ||= {}; this.save(); return true; },
  /** equipment ("mods") is earned by finishing career series; performance parts are always available */
  unlocked(key) { const n = UPGRADES[key].need; return !n || !!this.d.career.done[n]; },
  buyUpgrade(carId, key) {
    const lv = this.upgOf(carId)[key] | 0, u = UPGRADES[key]; if (lv >= u.max || !this.unlocked(key)) return false; const cost = u.cost[lv]; if (this.d.cash < cost) return false;
    this.d.cash -= cost; this.upgOf(carId)[key] = lv + 1; this.save(); return true;
  },
  sellCar(id) { if (id === 'scrapper' || !this.owns(id)) return false; const v = Math.floor(carValue(id, this.upgOf(id)) * 0.5); this.d.cash += v; this.d.owned = this.d.owned.filter(x => x !== id); delete this.d.upg[id]; if (this.d.car === id) this.d.car = 'scrapper'; this.save(); return v; },
  /** record a lap / race result for a track; returns { lap:boolean, race:boolean } for new personal bests */
  record(trackId, lap, race, carId, laps) {
    const r = (this.d.records[trackId] ||= {}); const out = {};
    if (lap != null && (!r.lap || lap < r.lap.time)) { r.lap = { time: lap, car: carId, date: Date.now() }; out.lap = true; }
    if (race != null && laps >= 3 && (!r.race || race < r.race.time)) { r.race = { time: race, car: carId, laps, date: Date.now() }; out.race = true; }
    this.save(); return out;
  },
  ghost(trackId) { return this.d.ghosts[trackId] || null; },
  saveGhost(trackId, g) { this.d.ghosts[trackId] = g; this.save(); },
  saveCustom(t) { this.d.customTracks[t.id] = t; this.save(); },
  deleteCustom(id) { delete this.d.customTracks[id]; delete this.d.records[id]; delete this.d.ghosts[id]; this.save(); },
};
export default Store;

/* ------------------------------------------------------------------ career */
export const SERIES = [
  { id: 'rookie', name: 'Rookie Cup',  diff: 0, laps: 3, tracks: ['dustbowl', 'pinewood', 'seaside'],            prize: [4000, 2500, 1500, 800, 500, 300], need: null,     blurb: 'Learn the ropes. The bots are gentle. Mostly.' },
  { id: 'pro',    name: 'Pro Circuit', diff: 1, laps: 3, tracks: ['frostbite', 'neon', 'foundry', 'glacier'],     prize: [8000, 5000, 3000, 1500, 900, 500], need: 'rookie', blurb: 'Proper opposition and proper weapons. Upgrade or die.' },
  { id: 'elite',  name: 'Elite League', diff: 2, laps: 4, tracks: ['inferno', 'canyon', 'midnight', 'timberline', 'serpent'], prize: [16000, 10000, 6000, 3000, 1800, 1000], need: 'pro', blurb: 'Armoured, nitro-fuelled and merciless.' },
  { id: 'legend', name: 'Legend Run',  diff: 3, laps: 5, tracks: ['kingpin', 'lavaflow', 'serpent', 'inferno', 'neon', 'canyon'], prize: [30000, 18000, 11000, 6000, 3500, 2000], need: 'elite', blurb: 'The Kill Lap grand finale. Survivors get paid.' },
];
export const POINTS = [10, 7, 5, 4, 3, 2, 1, 0];

/* ------------------------------------------------------------------ achievements */
export const ACHIEVEMENTS = [
  { id: 'first', name: 'First Blood', desc: 'Wreck an opponent.', test: (s, r) => r.kills >= 1 },
  { id: 'win', name: 'Winner', desc: 'Win a race.', test: (s, r) => r.place === 1 },
  { id: 'wrecker', name: 'Wrecking Ball', desc: 'Wreck 3 cars in one race.', test: (s, r) => r.kills >= 3 },
  { id: 'clean', name: 'Clean Sweep', desc: 'Win a race without taking damage.', test: (s, r) => r.place === 1 && (r.dmgTaken || 0) < 1 },
  { id: 'veteran', name: 'Road Warrior', desc: 'Finish 25 races.', test: s => s.stats.races >= 25 },
  { id: 'killer', name: 'Serial Killer', desc: 'Wreck 50 cars in total.', test: s => s.stats.kills >= 50 },
  { id: 'rich', name: 'Fat Cat', desc: 'Hold $50,000 at once.', test: s => s.cash >= 50000 },
  { id: 'garage', name: 'Collector', desc: 'Own 4 cars.', test: s => s.owned.length >= 4 },
  { id: 'maxed', name: 'Fully Loaded', desc: 'Max out any upgrade.', test: s => Object.values(s.upg).some(u => UPG_KEYS.some(k => (u[k] | 0) >= UPGRADES[k].max)) },
  { id: 'roadkill', name: 'Road Rage', desc: 'Run over 5 pedestrians.', test: s => s.stats.roadkill >= 5 },
  { id: 'train', name: 'Wrong Place, Wrong Time', desc: 'Get hit by a train.', test: s => s.stats.trainHits >= 1 },
  { id: 'armed', name: 'Armed to the Teeth', desc: 'Fit spikes, a turret and homing missiles on one car.', test: s => Object.values(s.upg).some(u => (u.fspikes | 0) && (u.turret | 0) && (u.homing | 0)) },
  { id: 'rookie', name: 'Rookie of the Year', desc: 'Finish the Rookie Cup.', test: s => !!s.career.done.rookie },
  { id: 'legend', name: 'Living Legend', desc: 'Win the Legend Run.', test: s => s.career.done.legend === 1 },
  { id: 'mp', name: 'Social Menace', desc: 'Win an online race.', test: (s, r) => r.online && r.place === 1 && r.humans > 1 },
  { id: 'speed', name: 'Need For Speed', desc: 'Exceed 200 km/h.', test: (s, r) => (r.topSpeed || 0) * 0.36 > 200 },
  { id: 'pb', name: 'Personal Best', desc: 'Set a new personal best lap.', test: (s, r) => r.newLap },
  { id: 'designer', name: 'Track Designer', desc: 'Publish a custom track.', test: s => !!s._published },
];
export function checkAchievements(r) {
  const s = Store.d, got = [];
  for (const a of ACHIEVEMENTS) if (!s.achievements[a.id]) { let ok = false; try { ok = a.test(s, r || {}); } catch {} if (ok) { s.achievements[a.id] = Date.now(); got.push(a); } }
  if (got.length) Store.save(); return got;
}
