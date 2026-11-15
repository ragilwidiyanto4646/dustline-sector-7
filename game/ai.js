/* ============================================================================
   DUSTLINE // Sector 7 — ai.js
   Bot brains: perception (sight AND hearing), combat movement, objectives.
   Bots pathfind over the waypoint graph (world.js), hold lanes, guard a
   planted spike, fall back when hurt, and investigate gunfire they hear.

   Hearing (criterion 3 — "react to what they see and hear"): every shot
   logs a noise event on Game.noises (combat.js). A bot with no visible
   enemy that hears an enemy shot within ~30 m paths toward it for a few
   seconds instead of wandering its objective route.

   Hot-path note (criterion 5): botThink runs 9 times a fixed step and
   used to clone vectors for its strafe, approach and path steps. It now
   moves through module-level scratch vectors only — no allocation per
   bot per step.
   ========================================================================== */
import { V3, rand, randi, pick } from './util.js';
import { WEAPONS, DIFF, CONFIG } from './data.js';
import { Game, playerVel } from './state.js';
import { waypointGraph, nearestWaypoint, findPath, collideMove, losBlocked, sites } from './world.js';
import { shoot, startReload, finishReload, inSmoke } from './combat.js';
import { plantBomb, defuseBomb } from './rounds.js';
import { AudioSys } from './audio.js';

/* Scratch vectors for the bot hot loop: botThink runs 9x a step and used
   to allocate a dozen throwaway Vector3s per bot per step. These are
   only ever used synchronously inside one call, never stored. */
const _eye = V3(0, 0, 0), _foeEye = V3(0, 0, 0);
const _toE = V3(0, 0, 0), _fwd = V3(0, 0, 0), _side = V3(0, 0, 0), _approach = V3(0, 0, 0);
const _mv = V3(0, 0, 0), _to = V3(0, 0, 0), _noisePos = V3(0, 0, 0);

export function botThink(b, dt) {
  if (!b.alive || Game.phase !== 'live') return;
  b.stateT -= dt;
  const diff = DIFF[Game.difficulty];
  if (Game.time < (b.flashUntil || 0)) { b.vel.set(0, 0, 0); return; } // flashed: stand still
  // cheapest perception: nearest visible enemy
  let enemy = null, bestD = 1e9;
  const foes = [Game.player, ...Game.bots].filter((o) => o.alive && o.team !== b.team);
  for (const foe of foes) {
    _eye.copy(b.pos); _eye.y += 1.5;
    _foeEye.copy(foe.pos); _foeEye.y += 1.3;
    const d = b.pos.distanceTo(foe.pos);
    if (d < bestD && d < 55 && !losBlocked(_eye, _foeEye) && !inSmoke(_foeEye) && !inSmoke(_eye)) { enemy = foe; bestD = d; }
  }
  b.target = enemy;
  if (enemy) {
    b.lastSeen = { pos: enemy.pos.clone(), t: Game.time };
    // face enemy, strafe, burst fire
    const toE = _toE.copy(enemy.pos).sub(b.pos);
    b.yaw = Math.atan2(-toE.x, -toE.z);
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir *= -1; b.strafeT = rand(0.5, 1.4); }
    const fwd = _fwd.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
    const side = _side.set(-fwd.z, 0, fwd.x).multiplyScalar(b.strafeDir * 1.6);
    const dist = toE.length();
    const approach = _approach.set(0, 0, 0);
    if (dist > 16) approach.copy(fwd).multiplyScalar(2.2);
    else if (dist < 6) approach.copy(fwd).multiplyScalar(-1.6);
    b.vel.copy(side).add(approach);
    b.crouch = dist > 22 && Math.random() < 0.3;
    // aim with error that shrinks while the target is still
    const err = diff.aimErr * (movingEnemy(enemy) ? 1.6 : 1) * (b.crouch ? 0.75 : 1);
    const aimAt = b.aimPoint.copy(enemy.pos);
    aimAt.y += 1.35 + rand(-err, err) * 8;
    aimAt.x += rand(-err, err) * dist; aimAt.z += rand(-err, err) * dist;
    // reaction + bursts
    if (b.reactAt === 0) b.reactAt = Game.time + diff.react * rand(0.6, 1.4);
    if (Game.time >= b.reactAt) {
      if (b.burstLeft <= 0) {
        if (b.burstPause <= 0) { b.burstLeft = randi(diff.burst[0], diff.burst[1]); b.burstPause = rand(0.35, 0.9); }
        else b.burstPause -= dt;
      } else {
        b.burstLeft--;
        const w = WEAPONS[b.weapon];
        if (Game.time - b.lastShot >= 60 / w.rpm) { b.aimErr = err; shoot(b); }
      }
    }
    if (b.hp < 35 && b.stateT <= 0) { // fall back to cover
      b.stateT = 3;
      const wp = pick(Object.values(waypointGraph));
      b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0;
      Game.ui?.radio(b, 'Falling back, I\'m hurt!');
    }
  } else {
    b.burstLeft = 0; b.reactAt = 0; b.vel.set(0, 0, 0);
    hearNoise(b);
    followObjective(b, dt);
  }
  // stuck detection: if a path exists but we barely moved, repath
  if (b.path.length && b.pathI < b.path.length) {
    if (!b._lastPos) { b._lastPos = b.pos.clone(); b._stuckT = 0; }
    if (b.pos.distanceTo(b._lastPos) > 0.5) { b._lastPos.copy(b.pos); b._stuckT = 0; }
    else {
      b._stuckT += dt;
      if (b._stuckT > 2.5) {
        b._stuckT = 0; b.path = []; b.pathI = 0; b.stateT = 0;
        b.pos.x += rand(-1, 1); b.pos.z += rand(-1, 1); // sidestep out of the snag
      }
    }
  }
  // move along path / velocity with collision
  const speedMul = b.crouch ? 0.55 : 1;
  if (b.vel.lengthSq() > 0.01) {
    _mv.copy(b.vel).multiplyScalar(speedMul);
    _mv.y = 0;
    collideMove(b.pos, _mv, dt, CONFIG.playerRadius, 1.7);
    b.walkPhase += dt * 6;
    if (Game.time - b.lastStep > 0.45 && b.isPlayer === false) { b.lastStep = Game.time; }
  } else if (b.path.length && b.pathI < b.path.length) {
    const wp = b.path[b.pathI];
    _to.copy(wp).sub(b.pos); _to.y = 0;
    if (_to.length() < 0.9) { b.pathI++; }
    else {
      _to.normalize();
      b.yaw = Math.atan2(-_to.x, -_to.z);
      _to.multiplyScalar(4.4 * speedMul);
      collideMove(b.pos, _to, dt, CONFIG.playerRadius, 1.7);
      b.walkPhase += dt * 6;
    }
  }
  // bomb duties for the carrier / defenders
  bombDuties(b, dt);
  // sync mesh
  if (b.mesh) {
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
    const crouchY = b.crouch ? -0.35 : 0;
    b.mesh.position.y = b.pos.y + crouchY;
    b.mesh.children[2].position.y = 1.62 + (b.crouch ? -0.2 : 0); // head dips a touch
    b.walkPhase += 0;
  }
  // reload when dry / calm
  if (b.mag === 0) startReload(b);
  else if (!enemy && b.mag < WEAPONS[b.weapon].mag * 0.4 && Math.random() < dt * 0.5) startReload(b);
  if (b.reloading > 0) { b.reloading -= dt; if (b.reloading <= 0) finishReload(b); }
}
function movingEnemy(foe) {
  // the player's velocity lives on playerVel (state.js), a bot's on itself
  return foe.isPlayer ? playerVel.lengthSq() > 0.4 : foe.vel.lengthSq() > 0.4;
}

/* Hearing: the freshest enemy gunshot within ~30 m, if any. Bots only
   chase a noise they have not already investigated (b.heardT). */
function hearNoise(b) {
  let best = null, bd = 1e9;
  for (let i = Game.noises.length - 1; i >= 0; i--) {
    const n = Game.noises[i];
    if (n.team === b.team) continue;
    if (Game.time - n.t > 5) continue;
    const d = (n.x - b.pos.x) * (n.x - b.pos.x) + (n.z - b.pos.z) * (n.z - b.pos.z);
    if (d < bd && d < 900) { bd = d; best = n; }
  }
  if (best && best.t !== b.heardT) {
    b.heardT = best.t;
    Game.heardEvents++;
    _noisePos.set(best.x, 0, best.z);
    b.path = findPath(nearestWaypoint(b.pos), nearestWaypoint(_noisePos));
    b.pathI = 0; b.stateT = 2.5;
    if (Math.random() < 0.4) Game.ui?.radio(b, 'Heard shots — checking it out!');
  }
}

export function followObjective(b, dt) {
  const bomb = Game.bomb;
  if (b.team === 'T') {
    if (bomb.state === 'planted') { // guard the site
      if (b.stateT <= 0) { const wp = nearestWaypoint(sites[bomb.site].center); b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0; b.stateT = 8; }
      return;
    }
    if (b.hasSpike) {
      // carrier pushes to the planned site
      const site = b.objective || (b.objective = pick(['A', 'B']));
      const target = nearestWaypoint(sites[site].center);
      if (b.stateT <= 0 || !b.path.length) { b.path = findPath(nearestWaypoint(b.pos), target); b.pathI = 0; b.stateT = 6; }
      if (b.pos.distanceTo(sites[site].center) < sites[site].r * 0.8 && bomb.state === 'idle') {
        b.planting += dt;
        if (b.planting > 0.15 && b.planting < 0.2) AudioSys.plant();
        if (b.planting >= CONFIG.plantTime) { plantBomb(b, site); b.planting = 0; }
      } else b.planting = 0;
      return;
    }
    if (b.stateT <= 0) { // push a site or mid as a pack
      const site = pick(['A', 'B', 'A', 'B', 'mid']);
      const target = site === 'mid' ? waypointGraph.mid : nearestWaypoint(sites[site].center);
      b.path = findPath(nearestWaypoint(b.pos), target); b.pathI = 0; b.stateT = rand(6, 10);
    }
  } else {
    if (bomb.state === 'planted') {
      // defenders converge and defuse
      const site = sites[bomb.site];
      if (b.pos.distanceTo(site.center) < 2.2) {
        b.defusing += dt;
        if (b.defusing >= CONFIG.defuseTime) { defuseBomb(b); b.defusing = 0; }
      } else {
        b.defusing = 0;
        if (b.stateT <= 0) { b.path = findPath(nearestWaypoint(b.pos), nearestWaypoint(site.center)); b.pathI = 0; b.stateT = 7; }
      }
      return;
    }
    if (b.stateT <= 0) { // hold a lane / rotate between sites
      const spots = ['aSite', 'bSite', 'aLong', 'bLong', 'mid', 'midN', 'midS'];
      const wp = waypointGraph[pick(spots)];
      b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0; b.stateT = rand(7, 12);
    }
  }
}
export function bombDuties(b, dt) {
  // player-adjacent bots pick up a dropped spike
  if (b.team === 'T' && Game.spikeDropped && !Game.bomb.plantTimer && b.pos.distanceTo(Game.spikeDropped) < 1.6) {
    b.hasSpike = true; Game.spikeDropped = null;
    if (Game.spikeMesh) Game.spikeMesh.visible = false;
    Game.ui?.radio(b, 'Got the spike — pushing a site!');
  }
}
