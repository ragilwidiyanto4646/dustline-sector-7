/* ============================================================================
   DUSTLINE // Sector 7 — actors.js
   Fighters: the player and the bots, their bodies, their viewmodel gun,
   and the shop that equips them. A fighter is plain data plus a mesh;
   behaviour lives in ai.js (bots) and main.js (the player).
   ========================================================================== */
import * as THREE from 'three';
import { V3, pick } from './util.js';
import { CONFIG, WEAPONS, SHOP, ARMOR_PRICE, SMOKE_PRICE, FLASH_PRICE } from './data.js';
import { Game, TEAM_COLOR } from './state.js';
import { makeTextSprite } from './textures.js';
import { scene, camera, spawns } from './world.js';
import { AudioSys } from './audio.js';

export function makeSoldier(team, name) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2e4a66 : 0x6b4a2e, roughness: .85 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: .8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9976b, roughness: .9 });
  const accent = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: .5, emissive: TEAM_COLOR[team], emissiveIntensity: .25 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit); torso.position.y = 1.12; g.add(torso);
  const vestM = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.36), vest); vestM.position.y = 1.14; g.add(vestM);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin); head.position.y = 1.62; g.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.36), team === 'CT' ? accent : vest); helm.position.y = 1.8; g.add(helm);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: .2, metalness: .6 }));
  visor.position.set(0, 1.62, 0.17); g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), suit); legL.position.set(-0.14, 0.36, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.18), suit); armL.position.set(-0.35, 1.12, 0.1); armL.rotation.x = -1.1; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.35; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), vest); gun.position.set(0.18, 1.22, 0.35); g.add(gun);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.07, 0.32), accent); stripe.position.y = 0.92; g.add(stripe);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  // name tag
  const tag = makeTextSprite(name, team === 'CT' ? '#7fd4ff' : '#ffb454');
  tag.scale.set(2.4, 0.6, 1); tag.position.y = 2.15; g.add(tag);
  // hit volumes (invisible, raycast targets)
  const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  bodyHit.position.y = 1.05; bodyHit.userData.part = 'body'; g.add(bodyHit);
  const headHit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
  headHit.position.y = 1.62; headHit.userData.part = 'head'; g.add(headHit);
  g.userData.hitMeshes = [bodyHit, headHit];
  scene.add(g);
  return g;
}

export function newFighter(team, name, isPlayer) {
  const spawn = pick(spawns[team]);
  const f = {
    team, name, isPlayer: !!isPlayer, alive: true, hp: 100, armor: 0,
    pos: spawn.clone(), vel: V3(0, 0, 0), yaw: team === 'CT' ? Math.PI / 2 : -Math.PI / 2, pitch: 0,
    money: CONFIG.startMoney, weapon: 'p9', mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
    weapons: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
    reloading: 0, lastShot: 0, burstLeft: 0, burstPause: 0, reactAt: 0, aimErr: 0,
    aimPoint: V3(0, 0, 0), // persistent aim target: reused, never re-allocated
    path: [], pathI: 0, objective: null, state: 'idle', stateT: 0,
    target: null, lastSeen: null, strafeDir: 1, strafeT: 0, crouch: false,
    kills: 0, deaths: 0, hasSpike: false, planting: 0, defusing: 0, mesh: null,
    walkPhase: 0, lastStep: 0, util: { smoke: 1, flash: 1 },
  };
  if (!isPlayer) f.mesh = makeSoldier(team, name);
  return f;
}

export function equipWeapon(f, id) {
  const w = WEAPONS[id];
  if (!w) return;
  if (!f.weapons[id]) f.weapons[id] = { mag: w.mag, reserve: w.reserve };
  f.weapon = id; f.mag = f.weapons[id].mag; f.reserve = f.weapons[id].reserve;
  f.reloading = 0;
  if (f.isPlayer) Game.ui?.updateWeaponHUD();
}
export function buyItem(f, key) {
  const entry = SHOP.find((s) => s.key === key);
  if (!entry) return false;
  if (entry.w === 'armor') {
    if (f.money < ARMOR_PRICE || f.armor >= 100) return false;
    f.money -= ARMOR_PRICE; f.armor = 100; return true;
  }
  if (entry.w === 'smoke') {
    if (f.money < SMOKE_PRICE || f.util.smoke >= 2) return false;
    f.money -= SMOKE_PRICE; f.util.smoke++; return true;
  }
  if (entry.w === 'flash') {
    if (f.money < FLASH_PRICE || f.util.flash >= 2) return false;
    f.money -= FLASH_PRICE; f.util.flash++; return true;
  }
  const w = WEAPONS[entry.w];
  if (f.money < w.price) return false;
  f.money -= w.price;
  f.weapons[entry.w] = { mag: w.mag, reserve: w.reserve };
  equipWeapon(f, entry.w);
  return true;
}
export function botBuy(b) {
  // bots spend sensibly: marksman if rich, rifle if comfortable, SMG mid,
  // save if poor; armor when affordable
  if (b.money >= 5350 && Math.random() < 0.35) buyItem(b, '3');
  else if (b.money >= 3350 && Math.random() < 0.8) buyItem(b, '1');
  else if (b.money >= 2150 && Math.random() < 0.6) buyItem(b, '2');
  if (b.money >= ARMOR_PRICE + 300 && Math.random() < 0.6) buyItem(b, '5');
  if (b.money >= SMOKE_PRICE + 200 && Math.random() < 0.4) buyItem(b, '6');
}
export function swapToLastWeapon() {
  const p = Game.player; if (!p || Game.phase !== 'live') return;
  const owned = Object.keys(p.weapons);
  if (owned.length < 2) return;
  const other = owned.find((id) => id !== p.weapon);
  if (other) { equipWeapon(p, other); setViewmodelWeapon(p.weapon); AudioSys.reload(); }
}
export function cycleWeapon(dir) {
  const p = Game.player; if (!p) return;
  const owned = Object.keys(p.weapons);
  if (owned.length < 2) return;
  const i = owned.indexOf(p.weapon);
  equipWeapon(p, owned[(i + dir + owned.length) % owned.length]);
  setViewmodelWeapon(p.weapon); AudioSys.reload();
}

/* ---------------- viewmodel gun ---------------- */
/* The gun the player sees: a proper rifle silhouette — receiver, railed
   handguard, barrel with muzzle brake, curved magazine, stock, sights and
   a scope tube on the marksman rifle — instead of the old single black
   wedge, which read as a placeholder slab in every screenshot. */
export let viewGun, muzzle, muzzleLight, scopeMesh;
export function buildViewmodel() {
  viewGun = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: .42, metalness: .7 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: .45, metalness: .6 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x8a6b42, roughness: .75, metalness: .05 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x5a5c40, roughness: .8, metalness: .05 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2e2118, roughness: .9 });
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); if (rx) m.rotation.x = rx;
    viewGun.add(m); return m;
  };
  // receiver + top rail
  add(new THREE.BoxGeometry(0.085, 0.12, 0.5), dark, 0, 0, 0.05);
  add(new THREE.BoxGeometry(0.06, 0.035, 0.42), mid, 0, 0.078, 0.02);
  // railed handguard (front) + barrel + muzzle brake
  add(new THREE.BoxGeometry(0.075, 0.09, 0.34), olive, 0, 0.005, -0.42);
  add(new THREE.CylinderGeometry(0.021, 0.021, 0.3, 10), mid, 0, 0.015, -0.68).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.07, 10), dark, 0, 0.015, -0.83).rotation.x = Math.PI / 2;
  // curved magazine, pistol grip, stock
  add(new THREE.BoxGeometry(0.065, 0.19, 0.1), tan, 0, -0.15, -0.02, 0.22);
  add(new THREE.BoxGeometry(0.06, 0.13, 0.08), grip, 0, -0.11, 0.24, 0.35);
  add(new THREE.BoxGeometry(0.075, 0.11, 0.24), tan, 0, -0.015, 0.4);
  add(new THREE.BoxGeometry(0.07, 0.13, 0.05), grip, 0, -0.02, 0.53);
  // iron sights: rear notch + front post
  add(new THREE.BoxGeometry(0.02, 0.05, 0.06), mid, 0, 0.115, -0.1);
  add(new THREE.BoxGeometry(0.016, 0.055, 0.016), mid, 0, 0.11, -0.55);
  // scope tube (marksman rifle only; hidden otherwise)
  scopeMesh = add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), dark, 0, 0.13, -0.08);
  scopeMesh.rotation.x = Math.PI / 2; scopeMesh.visible = false;
  // trigger hand
  add(new THREE.BoxGeometry(0.11, 0.1, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2e4a66, roughness: .9 }), 0.02, -0.12, -0.28);
  muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  muzzle.position.set(0, 0.015, -0.9); viewGun.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffc46b, 0, 7); muzzleLight.position.set(0, 0, -0.8);
  viewGun.add(muzzleLight);
  viewGun.position.set(0.26, -0.24, -0.5);
  const fill = new THREE.PointLight(0xfff2dd, 1.2, 3);
  fill.position.set(0.1, 0.1, -0.4);
  camera.add(fill);
  camera.add(viewGun);
  scene.add(camera);
}
export function setViewmodelWeapon(id) {
  if (!viewGun) return;
  const s = id === 'lw308' ? 1.35 : id === 'sg12' ? 1.1 : id === 'rs12' ? 0.85 : id === 'p9' ? 0.7 : 1;
  viewGun.scale.setScalar(s);
  if (scopeMesh) scopeMesh.visible = id === 'lw308';
}
