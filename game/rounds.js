/* ============================================================================
   DUSTLINE // Sector 7 — rounds.js
   Match flow: rounds, sides, the spike, the economy. A round ends by
   elimination, by detonation, by defusal or by the clock; the first crew
   to 5 rounds takes the match. Sides alternate each round, so the player
   attacks (plants) on even rounds and defends on odd ones.
   ========================================================================== */
import { $, fmtMoney, pick } from './util.js';
import { CONFIG, WEAPONS, BOT_NAMES_CT, BOT_NAMES_T } from './data.js';
import { Game, playerVel } from './state.js';
import { newFighter, botBuy, equipWeapon, setViewmodelWeapon } from './actors.js';
import { sites, spawns, camera, scene } from './world.js';
import { kill } from './combat.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';

export function plantBomb(by, site) {
  Game.bomb.state = 'planted'; Game.bomb.site = site; Game.bomb.timer = CONFIG.bombTimer;
  Game.bomb.planter = by;
  if (by.isPlayer) { Game.money = Math.min(CONFIG.maxMoney, Game.money + CONFIG.plantReward); Game.player.money = Game.money; }
  Game.spikeMesh.visible = true;
  Game.spikeMesh.position.copy(sites[site].center);
  Game.ui?.radio(by, 'Spike planted on ' + site + '! Hold it!');
  AudioSys.plant();
  Game.ui?.updateHUD();
}
export function defuseBomb(by) {
  Game.bomb.state = 'defused';
  endRound('CT', by.isPlayer ? 'Spike defused — site secure.' : 'Spike defused by ' + by.name + '.');
}
export function explodeBomb() {
  Game.bomb.state = 'exploded';
  AudioSys.explosion();
  Game.shake = 1;
  if (Game.spikeMesh) Game.spikeMesh.visible = false;
  const p = Game.player;
  if (p.alive && p.pos.distanceTo(sites[Game.bomb.site].center) < 14) kill(p, null, false);
  for (const b of Game.bots) if (b.alive && b.pos.distanceTo(sites[Game.bomb.site].center) < 14) kill(b, null, false);
  endRound('T', 'The spike detonated — site lost.');
}
export function updateBomb(dt) {
  const bomb = Game.bomb;
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt;
  const interval = bomb.timer < 10 ? 0.5 : bomb.timer < 20 ? 0.75 : 1;
  if (!bomb._beepAt || Game.time >= bomb._beepAt) { bomb._beepAt = Game.time + interval; AudioSys.beep(bomb.timer < 10); }
  if (bomb.timer <= 0) explodeBomb();
  Game.ui?.updateHUD();
}

export function startMatch() {
  Game.score = { CT: 0, T: 0 }; Game.round = 1;
  Game.kills = 0; Game.deaths = 0; Game.shotsFired = 0; Game.shotsHit = 0; Game.headshots = 0;
  // fresh crews are (re)built every round by startRound() — sides alternate
  // each round so the player attacks (plants) on even rounds, defends on odd.
  for (const b of Game.bots) if (b.mesh) scene.remove(b.mesh);
  Game.bots = [];
  Game.botBank = {}; // bot cash persists across rounds, keyed by name
  Game.player = newFighter('CT', 'You', true);
  Game.player.money = CONFIG.startMoney; Game.money = CONFIG.startMoney;
  startRound();
}

export function startRound() {
  Game.phase = 'buy'; Game.buyTimer = CONFIG.buyTime; Game.roundTime = CONFIG.roundTime;
  Game.roundKills = 0;
  Game.bomb = { state: 'idle', site: null, timer: 0, planter: null, defuser: null, progress: 0 };
  Game.spikeDropped = null;
  if (Game.spikeMesh) Game.spikeMesh.visible = false;
  $('bomb-status').textContent = '';
  // --- sides alternate every round: odd rounds the player defends (CT),
  // even rounds the player attacks (T) and carries the spike. ---
  const playerTeam = Game.round % 2 === 1 ? 'CT' : 'T';
  Game.player.team = playerTeam;
  for (const b of Game.bots) {
    if (b.money !== undefined) Game.botBank[b.name] = b.money;
    if (b.mesh) scene.remove(b.mesh);
  }
  Game.bots = [];
  const mateNames = playerTeam === 'CT' ? BOT_NAMES_CT : BOT_NAMES_T;
  const foeNames = playerTeam === 'CT' ? BOT_NAMES_T : BOT_NAMES_CT;
  for (const n of mateNames) { const b = newFighter(playerTeam, n, false); b.money = Game.botBank[n] ?? CONFIG.startMoney; Game.bots.push(b); }
  for (const n of foeNames) { const b = newFighter(playerTeam === 'CT' ? 'T' : 'CT', n, false); b.money = Game.botBank[n] ?? CONFIG.startMoney; Game.bots.push(b); }
  if (playerTeam === 'T') { Game.player.hasSpike = true; Game.spikeCarrier = Game.player; }
  else {
    const carrier = pick(Game.bots.filter((b) => b.team === 'T'));
    carrier.hasSpike = true; Game.spikeCarrier = carrier; Game.player.hasSpike = false;
  }
  // respawn everyone
  const all = [Game.player, ...Game.bots];
  for (const f of all) {
    f.alive = true; f.hp = 100; f.planting = 0; f.defusing = 0; f.path = []; f.pathI = 0; f.stateT = 0;
    f.reloading = 0; f.target = null; f.burstLeft = 0; f.reactAt = 0;
    const s = pick(spawns[f.team]); f.pos.copy(s); f.vel.set(0, 0, 0);
    if (f.isPlayer) playerVel.set(0, 0, 0); // no inherited slide into the round
    f.yaw = f.team === 'CT' ? Math.PI : 0;
    if (f.mesh) { f.mesh.visible = true; f.mesh.position.copy(f.pos); }
    // keep owned weapons, refill ammo; money persists across rounds
    for (const id of Object.keys(f.weapons)) { f.weapons[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve }; }
    equipWeapon(f, f.weapon);
    if (!f.isPlayer) botBuy(f);
  }
  Game.player.pos.copy(pick(spawns[Game.player.team]));
  Game.player.yaw = Game.player.team === 'CT' ? Math.PI / 2 : -Math.PI / 2; Game.player.pitch = 0;
  camera.position.set(Game.player.pos.x, CONFIG.eyeHeight, Game.player.pos.z);
  camera.rotation.set(0, Game.player.yaw, 0);
  // carry money into HUD (player money is the source of truth)
  Game.money = Game.player.money;
  setViewmodelWeapon(Game.player.weapon);
  Game.ui?.updateHUD(); Game.ui?.renderShop();
  Game.ui?.showBanner('ROUND ' + Game.round, 'Buy phase — ' + CONFIG.buyTime + 's. Press B for the supply crate.', 'draw');
  $('buy').classList.remove('hidden');
}
export function endRound(winner, reason) {
  if (Game.phase !== 'live' && Game.phase !== 'buy') return;
  Game.phase = 'roundEnd';
  Game.score[winner]++;
  const playerWon = winner === Game.player.team;
  const reward = playerWon ? CONFIG.winReward : CONFIG.lossReward;
  Game.player.money = Math.min(CONFIG.maxMoney, Game.player.money + reward);
  Game.money = Game.player.money;
  for (const b of Game.bots) {
    b.money = Math.min(CONFIG.maxMoney, b.money + (b.team === winner ? CONFIG.winReward : CONFIG.lossReward));
  }
  $('bomb-status').textContent = '';
  Game.ui?.showBanner(playerWon ? 'ROUND WON' : 'ROUND LOST', reason + '  ·  +' + fmtMoney(reward), playerWon ? 'win' : 'lose');
  if (playerWon) AudioSys.roundWin(); else AudioSys.roundLose();
  Game.ui?.updateHUD();
  setTimeout(() => {
    if (Game.phase !== 'roundEnd') return; // player left for the menu meanwhile
    if (Game.score.CT >= CONFIG.matchWinRounds || Game.score.T >= CONFIG.matchWinRounds ||
        Game.round >= CONFIG.matchWinRounds * 2 - 1) endMatch();
    else { Game.round++; startRound(); }
  }, 3800);
}
export function endMatch() {
  Game.phase = 'matchEnd';
  const ctWon = Game.score.CT > Game.score.T;
  document.exitPointerLock?.();
  const acc = Game.shotsFired ? Math.round(100 * Game.shotsHit / Game.shotsFired) : 0;
  Game.ui?.showMatchEnd({
    ctWon,
    title: ctWon ? 'WARDENS WIN' : 'JACKALS WIN',
    sub: `Final score — Wardens ${Game.score.CT} : ${Game.score.T} Jackals`,
    stats: `Your kills <b>${Game.kills}</b> · deaths <b>${Game.deaths}</b> · accuracy <b>${acc}%</b> · headshots <b>${Game.headshots}</b><br>` +
      `Cash banked <b>${fmtMoney(Game.money)}</b>`,
  });
  if (ctWon) AudioSys.roundWin(); else AudioSys.roundLose();
}
export function checkRoundEnd() {
  if (Game.phase !== 'live') return;
  if (Game.bomb.state === 'planted' || Game.bomb.state === 'defused' || Game.bomb.state === 'exploded') return;
  // both teams count the player too: the old code counted only bots for
  // the Jackals, so a round could end "won" while the player (a Jackal
  // on even rounds) was still alive.
  const ctAlive = [Game.player, ...Game.bots].filter((f) => f.team === 'CT' && f.alive).length;
  const tAlive = [Game.player, ...Game.bots].filter((f) => f.team === 'T' && f.alive).length;
  if (tAlive === 0) endRound('CT', 'All Jackals eliminated.');
  else if (ctAlive === 0) endRound('T', 'All Wardens eliminated.');
}

/* player planting / defusing (hold E near the site / spike) */
export function playerInteract(dt) {
  const p = Game.player;
  if (!p || !p.alive || Game.phase !== 'live') { Game.ui?.hideInteract(); return; }
  const bomb = Game.bomb;
  // pick up a dropped spike by walking over it (attackers only) — the old
  // code only let bots do this, so a Jackal player could never recover
  // the spike after the carrier died.
  if (bomb.state === 'idle' && p.team === 'T' && !p.hasSpike && Game.spikeDropped &&
      p.pos.distanceTo(Game.spikeDropped) < 1.6) {
    p.hasSpike = true; Game.spikeCarrier = p; Game.spikeDropped = null;
    if (Game.spikeMesh) Game.spikeMesh.visible = false;
    Game.ui?.radio(p, 'Got the spike — plant it on A or B!');
  }
  let action = null, dur = 0, prog = 0;
  if (bomb.state === 'idle' && p.hasSpike) {
    for (const key of ['A', 'B']) {
      if (p.pos.distanceTo(sites[key].center) < sites[key].r) { action = 'PLANT THE SPIKE — ' + key; dur = CONFIG.plantTime; prog = p.planting; }
    }
  }
  if (bomb.state === 'planted' && p.team === 'CT') {
    if (p.pos.distanceTo(sites[bomb.site].center) < 2.4) { action = 'DEFUSE THE SPIKE'; dur = CONFIG.defuseTime; prog = p.defusing; }
  }
  if (!action) { Game.ui?.hideInteract(); p.planting = 0; p.defusing = 0; return; }
  Game.ui?.showInteract(action, prog, dur);
  if (Input.keys.KeyE) {
    if (bomb.state === 'idle') {
      p.planting += dt;
      if (p.planting >= CONFIG.plantTime) { const site = p.pos.distanceTo(sites.A.center) < sites.A.r ? 'A' : 'B'; plantBomb(p, site); p.planting = 0; }
    } else {
      p.defusing += dt;
      if (p.defusing >= CONFIG.defuseTime) { defuseBomb(p); p.defusing = 0; }
      if (Math.random() < dt * 8) AudioSys.beep(true);
    }
  } else { p.planting = 0; p.defusing = 0; }
}
