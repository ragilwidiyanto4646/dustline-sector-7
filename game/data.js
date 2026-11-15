/* ============================================================================
   DUSTLINE // Sector 7 — data.js
   All tuning in one place: match config, the weapon table, the shop, the
   difficulty curves and the bot names. No code, no state — editing a number
   here never touches a system.
   ========================================================================== */

export const CONFIG = {
  matchWinRounds: 5, roundTime: 100, buyTime: 12,
  playerSpeed: 5.4, walkSpeed: 2.7, crouchSpeed: 2.6, jumpSpeed: 5.6,
  gravity: 16, eyeHeight: 1.62, crouchEye: 1.12, playerRadius: 0.42,
  plantTime: 3.5, defuseTime: 5.0, bombTimer: 35,
  killReward: 300, winReward: 3250, lossReward: 1900, plantReward: 300,
  startMoney: 800, maxMoney: 16000,
};

/* Weapons. dmg = chest damage at close range; falloff shrinks it with distance. */
export const WEAPONS = {
  p9:   { id: 'p9',   name: 'P9 SIDEARM',  short: 'P9',    price: 0,    slot: 'side', auto: false, rpm: 320, mag: 12, reserve: 36,  reload: 1.15, dmg: 34, hsMult: 2.0, spread: 0.011, moveSpread: 0.020, range: 26, falloff: 0.55, zoom: 1,    kick: 0.011, tracer: 0xffd27d },
  vk47: { id: 'vk47', name: 'VK-47 RIFLE', short: 'VK-47', price: 2700, slot: 'main', auto: true,  rpm: 600, mag: 30, reserve: 90,  reload: 2.2,  dmg: 33, hsMult: 2.2, spread: 0.009, moveSpread: 0.030, range: 55, falloff: 0.70, zoom: 1,    kick: 0.020, tracer: 0xffe9a8 },
  rs12: { id: 'rs12', name: 'RS-12 SMG',   short: 'RS-12', price: 1500, slot: 'main', auto: true,  rpm: 780, mag: 28, reserve: 84,  reload: 1.9,  dmg: 24, hsMult: 2.0, spread: 0.014, moveSpread: 0.026, range: 30, falloff: 0.50, zoom: 1,    kick: 0.013, tracer: 0xffd27d },
  lw308:{ id: 'lw308',name: 'LW-308 MARKSMAN', short:'LW-308', price: 4750, slot: 'main', auto: false, rpm: 55,  mag: 5,  reserve: 15,  reload: 3.0,  dmg: 105, hsMult: 2.0, spread: 0.001, moveSpread: 0.045, range: 90, falloff: 0.95, zoom: 2.6,  kick: 0.055, tracer: 0xfff2c0 },
  sg12: { id: 'sg12', name: 'SG-12 BREACHER', short:'SG-12', price: 1200, slot: 'main', auto: false, rpm: 75,  mag: 7,  reserve: 28,  reload: 2.6,  dmg: 13, hsMult: 1.8, spread: 0.035, moveSpread: 0.045, range: 18, falloff: 0.35, zoom: 1,    kick: 0.040, pellets: 8, tracer: 0xffc46b },
};
export const SHOP = [
  { key: '1', w: 'vk47', tag: 'The workhorse. Accurate bursts, big mag.' },
  { key: '2', w: 'rs12', tag: 'Fast, cheap, deadly up close.' },
  { key: '3', w: 'lw308', tag: 'One tap through helmets. Right-click to scope.' },
  { key: '4', w: 'sg12', tag: 'Clears corners. Eight pellets per shell.' },
  { key: '5', w: 'armor', tag: 'Kevlar vest — halves bullet damage.' },
  { key: '6', w: 'smoke', tag: 'Smoke grenade — blocks sight for 12s.' },
  { key: '7', w: 'flash', tag: 'Flashbang — whites out anyone looking.' },
];
export const ARMOR_PRICE = 650, SMOKE_PRICE = 300, FLASH_PRICE = 200;
export const DIFF = {
  recruit: { aimErr: 0.055, react: 0.75, burst: [2, 4], hp: 100, dmg: 0.7 },
  regular: { aimErr: 0.034, react: 0.5,  burst: [3, 6], hp: 100, dmg: 0.9 },
  veteran: { aimErr: 0.020, react: 0.32, burst: [4, 8], hp: 100, dmg: 1.1 },
};
export const BOT_NAMES_CT = ['Sable', 'Irons', 'Pip', 'Doc'];
export const BOT_NAMES_T = ['Vex', 'Rook', 'Havoc', 'Mira', 'Dagger'];
