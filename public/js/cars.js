import { clamp } from './util.js';

export const CARS = [
  { id: 'scrapper', name: 'Scrapper', price: 0,     color: '#d2552b', len: 40, wid: 21, mass: 1.0, top: 400, accel: 330, grip: 1.0,  steer: 1.0,  hp: 100, shape: 'hatch',  desc: 'Duct tape and bad decisions. Handles fine, dies easily.' },
  { id: 'hornet',   name: 'Hornet',   price: 5000,  color: '#e6c229', len: 38, wid: 20, mass: 0.9, top: 425, accel: 370, grip: 1.1,  steer: 1.12, hp: 90,  shape: 'buggy',  desc: 'Light and twitchy. Stings through the corners.' },
  { id: 'bruiser',  name: 'Bruiser',  price: 11000, color: '#3b6fd1', len: 46, wid: 25, mass: 1.5, top: 410, accel: 320, grip: 0.95, steer: 0.92, hp: 160, shape: 'truck',  desc: 'A tank with wheels. Wins every shoving match.' },
  { id: 'phantom',  name: 'Phantom',  price: 20000, color: '#6a4bc4', len: 43, wid: 21, mass: 1.0, top: 485, accel: 400, grip: 1.18, steer: 1.08, hp: 110, shape: 'sport',  desc: 'Quiet, fast and mean. A driver\'s car.' },
  { id: 'reaper',   name: 'Reaper',   price: 34000, color: '#b11f2c', len: 45, wid: 23, mass: 1.25, top: 520, accel: 430, grip: 1.12, steer: 1.0, hp: 140, shape: 'muscle', desc: 'Raw horsepower. Collects souls and lap records.' },
  { id: 'warlord',  name: 'Warlord',  price: 52000, color: '#2f8f5a', len: 49, wid: 26, mass: 1.7, top: 545, accel: 420, grip: 1.06, steer: 0.95, hp: 200, shape: 'tank',   desc: 'Armoured, fast, and furious. The end of the road.' },
];
export const CAR_BY_ID = Object.fromEntries(CARS.map(c => [c.id, c]));
export const PAINTS = ['#d2552b', '#e6c229', '#3b6fd1', '#6a4bc4', '#b11f2c', '#2f8f5a', '#e8e8e8', '#222428', '#ff7ab8', '#22b8c9', '#ff9a1f', '#9be22d'];

export const UPGRADES = {
  engine: { name: 'Engine',   icon: 'E', desc: '+Top speed and acceleration', max: 4, cost: [1500, 3000, 6000, 11000] },
  tires:  { name: 'Tyres',    icon: 'T', desc: '+Grip and steering', max: 4, cost: [1200, 2500, 5000, 9000] },
  armor:  { name: 'Armour',   icon: 'A', desc: '+Hit points', max: 4, cost: [1500, 3000, 6000, 11000] },
  guns:   { name: 'Guns',     icon: 'G', desc: '+Machine-gun damage and ammo', max: 4, cost: [1000, 2200, 4500, 8000] },
  rockets:{ name: 'Rockets',  icon: 'R', desc: '+Rocket damage and capacity', max: 4, cost: [1400, 2800, 5500, 10000] },
  nitro:  { name: 'Nitro',    icon: 'N', desc: '+Extra nitro charges and power', max: 3, cost: [1500, 3500, 7000] },
};
export const UPG_KEYS = Object.keys(UPGRADES);

export const WEAPONS = {
  mg:     { name: 'Machine Gun', cool: 0.085, speed: 1000, life: 0.62, dmg: 2.6, ammo: 140 },
  rocket: { name: 'Rocket',      cool: 0.85,  speed: 640,  life: 2.0,  dmg: 24, splash: 85, splashDmg: 20, ammo: 5, turn: 2.0, range: 800 },
  mine:   { name: 'Mine',        cool: 0.55,  life: 45,    dmg: 40, r: 40, ammo: 4, arm: 0.9 },
};

/** Combine a base car with upgrade levels into final physical stats. */
export function carStats(carId, upg = {}) {
  const b = CAR_BY_ID[carId] || CARS[0];
  const L = k => clamp(upg[k] | 0, 0, UPGRADES[k].max);
  const e = L('engine'), t = L('tires'), a = L('armor'), g = L('guns'), r = L('rockets'), n = L('nitro');
  return {
    id: b.id, name: b.name, color: b.color, len: b.len, wid: b.wid, shape: b.shape, mass: b.mass,
    top: b.top * (1 + e * 0.035), accel: b.accel * (1 + e * 0.06), brake: 620,
    grip: b.grip * (1 + t * 0.045), steer: b.steer * (1 + t * 0.03),
    hp: b.hp * (1 + a * 0.16),
    mgDmg: 1 + g * 0.18, mgAmmo: WEAPONS.mg.ammo + g * 30,
    rocketDmg: 1 + r * 0.14, rocketAmmo: WEAPONS.rocket.ammo + r, mineAmmo: WEAPONS.mine.ammo + (r >> 1),
    nitroCharges: 3 + n, nitroPower: 1 + n * 0.06,
  };
}
export const upgradeTotal = u => UPG_KEYS.reduce((s, k) => s + ((u && u[k]) | 0), 0);
export function carValue(carId, upg) { let v = (CAR_BY_ID[carId] || CARS[0]).price; for (const k of UPG_KEYS) for (let i = 0; i < ((upg && upg[k]) | 0); i++) v += UPGRADES[k].cost[i]; return v; }

export const AI_NAMES = ['Rusty', 'Viper', 'Mad Dog', 'Sledge', 'Hex', 'Blitz', 'Havoc', 'Grim', 'Nitro Nancy', 'Scrap', 'Bones', 'Vandal', 'Ghost', 'Razor', 'Cinder', 'Wrecker'];
export const DIFFICULTIES = [
  { name: 'Rookie', speed: 0.80, aim: 0.45, aggression: 0.35, upgrades: 0 },
  { name: 'Pro',    speed: 0.89, aim: 0.65, aggression: 0.6,  upgrades: 1 },
  { name: 'Elite',  speed: 0.96, aim: 0.82, aggression: 0.8,  upgrades: 2 },
  { name: 'Legend', speed: 1.03, aim: 0.95, aggression: 1.0,  upgrades: 3 },
];
