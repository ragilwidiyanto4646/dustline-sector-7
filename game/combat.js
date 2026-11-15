/* ============================================================================
   DUSTLINE // Sector 7 — combat.js
   Shooting, damage, grenades and battle effects. Hits are resolved against
   the nearest thing the ray meets — an enemy hit volume, a solid map
   collider (walls stop bullets: no shooting through them), or the player's
   capsule — never against whatever mesh happens to sit behind the target.

   Gunfire is also heard: every shot logs a noise event on Game.noises so
   bots can investigate what they hear, not only what they see (ai.js).
   ========================================================================== */
import * as THREE from 'three';
import { V3, rand, clamp, lerp } from './util.js';
import { WEAPONS, CONFIG, DIFF } from './data.js';
import { Game, playerVel } from './state.js';
import { scene, camera, colliders, shootables, losBlocked, rayIntersectBox, dustPoints } from './world.js';
import { muzzle, muzzleLight, viewGun } from './actors.js';
import { AudioSys } from './audio.js';

const raycaster = new THREE.Raycaster();
export const tracers = [], particles = [], smokes = [];
export function spawnTracer(a, b, color, life = 0.09) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line); tracers.push({ line, life });
}
export function spawnImpact(point, normal, color = 0xffd27d) {
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: i % 2 ? color : 0xffffff }));
    m.position.copy(point);
    particles.push({ mesh: m, vel: V3(rand(-2, 2), rand(0.5, 3), rand(-2, 2)).add(normal.clone().multiplyScalar(2)), life: rand(0.15, 0.4) });
    scene.add(m);
  }
}
export function spawnBlood(point) {
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xaa1111 }));
    m.position.copy(point);
    particles.push({ mesh: m, vel: V3(rand(-2.5, 2.5), rand(0, 2.5), rand(-2.5, 2.5)), life: rand(0.2, 0.5) });
    scene.add(m);
  }
}
export function spawnSmoke(pos) {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rand(1.1, 1.8), 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.85, roughness: 1 }));
    s.position.set(rand(-1.4, 1.4), rand(0.6, 1.8), rand(-1.4, 1.4)); g.add(s);
  }
  g.position.copy(pos); scene.add(g);
  smokes.push({ group: g, pos: pos.clone(), until: Game.time + 12 });
  Game.smokeZones.push({ pos: pos.clone(), r: 3.2, until: Game.time + 12 });
}
export function inSmoke(pos) {
  return Game.smokeZones.some((s) => Game.time < s.until && s.pos.distanceTo(pos) < s.r);
}
export function throwUtility(kind) {
  const p = Game.player;
  if (!p || !p.alive || Game.phase !== 'live' || p.util[kind] <= 0) return;
  p.util[kind]--;
  const dir = V3(0, 0, -1).applyEuler(camera.rotation);
  const target = p.pos.clone().add(V3(0, 1.4, 0)).add(dir.clone().multiplyScalar(9));
  target.y = Math.max(0.6, target.y + dir.y * 6);
  if (kind === 'smoke') { spawnSmoke(target); Game.ui?.radio(p, 'Smoke out!'); }
  else {
    // flash: anyone facing the burst within 22m and LOS gets flashed
    for (const f of [Game.player, ...Game.bots]) {
      if (!f.alive) continue;
      const d = f.pos.distanceTo(target);
      if (d > 24) continue;
      const toBurst = target.clone().sub(f.pos.clone().add(V3(0, 1.5, 0))).normalize();
      const facing = V3(0, 0, -1).applyEuler(new THREE.Euler(0, f.yaw, 0));
      if (f.isPlayer || facing.dot(toBurst) > -0.2) {
        if (!losBlocked(target, f.pos.clone().add(V3(0, 1.5, 0)))) {
          if (f.isPlayer) { Game.flashUntil = Game.time + clamp(2.4 - d * 0.08, 0.4, 2.4); Game.ui?.flashPlayer(); }
          else { f.flashUntil = Game.time + clamp(2 - d * 0.07, 0.4, 2); }
        }
      }
    }
    Game.ui?.radio(p, 'Flash out!');
  }
  Game.ui?.updateHUD();
}

/* Fire one (hitscan) shot from fighter f toward their aim direction. */
export function shoot(f) {
  const w = WEAPONS[f.weapon];
  const now = Game.time;
  if (f.reloading > 0 || f.mag <= 0) { if (f.isPlayer && f.mag <= 0) AudioSys.dryFire(); return; }
  if (now - f.lastShot < 60 / w.rpm) return;
  f.lastShot = now;
  f.mag--;
  if (f.isPlayer) { f.weapons[f.weapon].mag = f.mag; Game.shotsFired++; }
  // gunfire is heard: log a noise event bots can investigate (ai.js).
  // Capped so a long firefight cannot grow the log without bound.
  Game.noises.push({ x: f.pos.x, z: f.pos.z, t: Game.time, team: f.team });
  if (Game.noises.length > 32) Game.noises.shift();
  const spread = (w.spread + (f.isPlayer ? (moving(f) ? w.moveSpread : 0) : f.aimErr || 0)) * (f.scoped ? 0.35 : 1);
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const dir = aimDir(f).add(V3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
    fireRay(f, dir, w);
  }
  AudioSys.shot(f.weapon, f.isPlayer ? 0 : f.pos.distanceTo(Game.player.pos));
  // muzzle flash + recoil (player)
  if (f.isPlayer) {
    muzzle.material.opacity = 1; muzzle.rotation.z = rand(0, 6);
    muzzleLight.intensity = 6;
    Game.player.pitch = clamp(Game.player.pitch + w.kick * rand(0.7, 1.2), -1.45, 1.45);
    Game.shake = Math.min(0.35, Game.shake + w.kick * 0.5);
    if (viewGun) viewGun.position.z = -0.5 + 0.09; // kick back, eases back in loop
  }
  if (f.mag <= 0) startReload(f);
  Game.ui?.updateWeaponHUD();
}
export function moving(f) {
  // spread punishes actual motion: the player's velocity, the bots' own.
  return f.isPlayer ? playerVel.lengthSq() > 0.4 : f.vel.lengthSq() > 0.4;
}
export function aimDir(f) {
  if (f.isPlayer) return V3(0, 0, -1).applyEuler(camera.rotation);
  const eye = f.pos.clone(); eye.y += 1.5;
  const tgt = f.aimPoint || f.pos.clone().add(V3(0, 0, -1).applyEuler(new THREE.Euler(0, f.yaw, 0)));
  return tgt.clone().sub(eye).normalize();
}
/* Fire one ray and resolve the NEAREST thing it meets: an enemy hit mesh,
   a solid map collider (walls stop bullets — no shooting through them),
   or the player's capsule (the player has no hit mesh). The old code only
   raycast the meshes, so a shot at the player could "hit" a crate behind
   them instead, and a shot through a wall could still wound them. */
export function fireRay(f, dir, w) {
  const origin = f.isPlayer ? camera.position.clone() : f.pos.clone().add(V3(0, 1.5, 0));
  const maxDist = w.range * 2.2;
  raycaster.set(origin, dir); raycaster.far = maxDist;
  // targets: enemy hit meshes + world props
  const targets = [];
  const victims = [Game.player, ...Game.bots].filter((o) => o !== f && o.alive && o.team !== f.team);
  for (const v of victims) if (v.mesh) for (const hm of v.mesh.userData.hitMeshes) { hm.userData.fighter = v; targets.push(hm); }
  const hits = raycaster.intersectObjects([...targets, ...shootables], false);
  let bestD = Infinity, bestKind = null, bestHit = null;
  if (hits.length) { bestD = hits[0].distance; bestKind = 'mesh'; bestHit = hits[0]; }
  // solid map geometry: nearest AABB slab the ray enters, if any
  for (const c of colliders) {
    const t = rayIntersectBox(origin, dir, c);
    if (t !== null && t < bestD && t <= maxDist) { bestD = t; bestKind = 'wall'; bestHit = null; }
  }
  // the player has no mesh; approximate with a capsule test along the ray
  const p = Game.player;
  if (!f.isPlayer && p.alive) {
    const center = p.pos.clone().add(V3(0, 1.1, 0));
    const toP = center.clone().sub(origin);
    const t = clamp(toP.dot(dir), 0, maxDist);
    const closest = origin.clone().add(dir.clone().multiplyScalar(t));
    const d = closest.distanceTo(center);
    const headD = closest.distanceTo(p.pos.clone().add(V3(0, 1.55, 0)));
    if ((d < 0.55 || headD < 0.3) && t < bestD) {
      bestD = t; bestKind = 'player'; bestHit = { point: closest, head: headD < 0.3 };
    }
  }
  const end = origin.clone().add(dir.clone().multiplyScalar(maxDist));
  if (bestKind === 'mesh') {
    const h = bestHit;
    spawnTracer(origin, h.point, w.tracer);
    const victim = h.object.userData.fighter;
    if (victim) {
      const dist = origin.distanceTo(h.point);
      const dmg = w.dmg * (h.object.userData.part === 'head' ? w.hsMult : 1) * lerp(1, w.falloff, clamp(dist / w.range, 0, 1));
      damage(victim, dmg, f, h.object.userData.part === 'head', h.point);
    } else {
      spawnImpact(h.point, h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V3(0, 1, 0));
    }
    return;
  }
  if (bestKind === 'player') {
    spawnTracer(origin, bestHit.point, w.tracer);
    damage(p, w.dmg * (bestHit.head ? w.hsMult : 1) * (DIFF[Game.difficulty].dmg), f, bestHit.head, bestHit.point);
    return;
  }
  if (bestKind === 'wall') {
    const point = origin.clone().add(dir.clone().multiplyScalar(bestD));
    spawnTracer(origin, point, w.tracer);
    spawnImpact(point, V3(0, 1, 0));
    return;
  }
  spawnTracer(origin, end, w.tracer);
}
export function damage(victim, amount, attacker, head, point) {
  if (!victim.alive || Game.phase !== 'live') return;
  if (victim.isPlayer && Game.shotMode) return; // staging mode: keep the camera alive
  let dmg = amount;
  if (victim.armor > 0) { const absorbed = Math.min(victim.armor, dmg * 0.5); victim.armor -= absorbed; dmg -= absorbed; }
  victim.hp -= dmg;
  if (point) spawnBlood(point);
  if (victim.isPlayer) {
    Game.shotsHit += attacker === Game.player ? 1 : 0;
    Game.ui?.damageFlash();
    AudioSys.hurt();
    Game.shake = Math.min(0.5, Game.shake + 0.12);
  } else if (attacker?.isPlayer) {
    Game.shotsHit++;
    if (head) Game.headshots++;
    AudioSys.hit(head);
    Game.ui?.showHitmarker(head, false);
  }
  if (victim.hp <= 0) kill(victim, attacker, head);
  Game.ui?.updateHUD();
}
export function kill(victim, attacker, head) {
  victim.alive = false; victim.hp = 0; victim.deaths++;
  if (victim.mesh) victim.mesh.visible = false;
  if (attacker) {
    attacker.kills++;
    if (attacker.isPlayer) {
      Game.kills++; Game.roundKills++;
      Game.money = Math.min(CONFIG.maxMoney, Game.money + CONFIG.killReward);
      Game.player.money = Game.money;
      AudioSys.kill();
      Game.ui?.showHitmarker(head, true);
    }
    Game.ui?.addKillfeed(attacker, victim, head);
  }
  if (victim.hasSpike) { victim.hasSpike = false; dropSpike(victim.pos); }
  if (victim.isPlayer) {
    Game.deaths++;
    Game.ui?.setScope(false);
    document.exitPointerLock?.();
  }
  // round end is decided by main.js polling checkRoundEnd() each step,
  // not from inside combat: combat never owns round flow.
}
export function dropSpike(pos) {
  Game.spikeDropped = pos.clone();
  // mark the drop on the ground: the planted-spike prop doubles as the
  // marker (hidden again on pickup, plant, or the next round).
  if (Game.spikeMesh) { Game.spikeMesh.position.copy(pos); Game.spikeMesh.visible = true; }
  Game.ui?.radio(null, 'Spike dropped — pick it up!');
}
export function startReload(f) {
  if (!f || !f.alive || f.reloading > 0 || f.mag >= WEAPONS[f.weapon].mag || f.reserve <= 0) return;
  f.reloading = WEAPONS[f.weapon].reload;
  if (f.isPlayer) AudioSys.reload();
}
export function finishReload(f) {
  const w = WEAPONS[f.weapon];
  const need = w.mag - f.mag, take = Math.min(need, f.reserve);
  f.mag += take; f.reserve -= take;
  if (f.isPlayer) { f.weapons[f.weapon] = { mag: f.mag, reserve: f.reserve }; }
}

/* Stage a firefight frame for ?shot=4 screenshots: a tracer that stays
   up for the capture, a lit muzzle and an impact burst on the nearest
   foe — the real combat code, frozen mid-shot, never a composited image. */
export function stageFirefight() {
  const p = Game.player;
  if (!p) return;
  const foes = Game.bots.filter((b) => b.alive && b.team !== p.team);
  if (!foes.length) return;
  let foe = foes[0], bd = 1e9;
  for (const b of foes) { const d = b.pos.distanceToSquared(p.pos); if (d < bd) { bd = d; foe = b; } }
  const origin = camera.position.clone();
  const target = foe.pos.clone(); target.y += 1.2;
  spawnTracer(origin, target, 0xffe9a8, 60);
  spawnImpact(target, V3(0, 1, 0));
  spawnBlood(target);
  if (muzzle) { muzzle.material.opacity = 1; muzzle.rotation.z = 1.2; }
  if (muzzleLight) muzzleLight.intensity = 6;
}

export function updateFx(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt; pt.mesh.position.addScaledVector(pt.vel, dt); pt.vel.y -= 9 * dt;
    if (pt.life <= 0) { scene.remove(pt.mesh); particles.splice(i, 1); }
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    if (Game.time > smokes[i].until) { scene.remove(smokes[i].group); smokes.splice(i, 1); Game.smokeZones = Game.smokeZones.filter((s) => Game.time < s.until); }
  }
  if (dustPoints) { dustPoints.rotation.y += dt * 0.004; }
  if (Game.spikeMesh?.visible) {
    Game.spikeMesh.rotation.y += dt * 1.5;
    const s = 1 + Math.sin(Game.time * 6) * 0.08;
    Game.spikeMesh.scale.setScalar(s);
  }
  Game.shake = Math.max(0, Game.shake - dt * 1.6);
}
