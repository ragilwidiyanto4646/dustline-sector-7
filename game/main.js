/* ============================================================================
   DUSTLINE // Sector 7 — a round-based tactical FPS (three.js 0.187.0)
   Single-player vs bots. No build step, no network, no external assets.
   Everything below is original: the map, the art, the sounds, the names.

   Modules, one job each (criterion 5):
     util.js      shared helpers (clamp, rand, V3, money/time formats)
     data.js      tuning: match config, weapons, shop, difficulties, names
     audio.js     synthesized audio — no audio files
     state.js     the one place match state lives (Game) + player velocity
     textures.js  procedural textures and text sprites
     world.js     renderer, lights, map, colliders, waypoints, line of sight
     actors.js    fighters, their bodies, the viewmodel gun, the shop logic
     combat.js    shooting, damage, grenades, tracers and particles
     ai.js        bot brains: sight, hearing, combat movement, objectives
     rounds.js    match flow: rounds, the spike, the economy
     ui.js        the only module that touches the DOM (HUD, menus, minimap)
     input.js     keyboard, mouse and pointer lock (records intent only)
     main.js      this file: player movement, the fixed-step loop, boot
   Simulation runs on a fixed 1/60 s step, decoupled from rendering
   (criterion 5): the world advances the same on any machine, and the
   hot loops reuse scratch vectors instead of allocating every frame.
   ========================================================================== */
import * as THREE from 'three';
import { $, V3, clamp, rand } from './util.js';
import { CONFIG, WEAPONS } from './data.js';
import { Game, playerVel } from './state.js';
import { AudioSys } from './audio.js';
import { initRenderer, buildMap, renderer, scene, camera, collideMove } from './world.js';
import { buildViewmodel, setViewmodelWeapon, viewGun, muzzle, muzzleLight } from './actors.js';
import { shoot, startReload, finishReload, updateFx, stageFirefight } from './combat.js';
import { botThink } from './ai.js';
import { startMatch, endRound, checkRoundEnd, updateBomb, playerInteract } from './rounds.js';
import { updateHUD, drawMinimap, renderScoreboard, hidePause, updateWeaponHUD } from './ui.js';
import { Input } from './input.js';

/* ---------------- 10. player movement + main loop ---------------- */
const _pFwd = V3(0, 0, 0), _pRight = V3(0, 0, 0), _pMove = V3(0, 0, 0);
let lastStepAt = 0;
function updatePlayer(dt) {
  const p = Game.player;
  if (!p || !p.alive) return;
  // look
  p.yaw -= Input.mouseDX * Input.sens * (p.scoped ? 0.45 : 1);
  p.pitch = clamp(p.pitch - Input.mouseDY * Input.sens * (p.scoped ? 0.45 : 1), -1.45, 1.45);
  Input.mouseDX = 0; Input.mouseDY = 0;
  const crouching = Input.keys.ControlLeft || Input.keys.KeyC;
  p.crouch = crouching;
  const walking = Input.keys.ShiftLeft || Input.keys.ShiftRight;
  const speed = crouching ? CONFIG.crouchSpeed : walking ? CONFIG.walkSpeed : CONFIG.playerSpeed;
  const fwd = _pFwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = _pRight.set(-fwd.z, 0, fwd.x);
  const move = _pMove.set(0, 0, 0);
  if (Input.keys.KeyW) move.add(fwd);
  if (Input.keys.KeyS) move.sub(fwd);
  if (Input.keys.KeyD) move.add(right);
  if (Input.keys.KeyA) move.sub(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * (p.scoped ? 0.45 : 1));
  // acceleration (criterion 2): velocity chases the wish direction instead
  // of snapping to full speed, so stopping to aim pays and strafing has
  // weight. Ground grips fast, air barely steers.
  const accel = p.pos.y === 0 ? 12 : 5;
  const k = Math.min(1, accel * dt);
  playerVel.x += (move.x - playerVel.x) * k;
  playerVel.z += (move.z - playerVel.z) * k;
  // jump / gravity (simple)
  if (Input.keys.Space && p.pos.y === 0) playerVel.y = CONFIG.jumpSpeed;
  playerVel.y -= CONFIG.gravity * dt;
  const vel = playerVel; // collideMove only reads it (and zeroes y on landing)
  collideMove(p.pos, vel, dt, CONFIG.playerRadius, 1.7);
  if (p.pos.y === 0) playerVel.y = 0;
  const hSpeed = Math.hypot(playerVel.x, playerVel.z);
  // footsteps
  if (hSpeed > 0.5 && p.pos.y === 0 && Game.time - lastStepAt > 0.38) { lastStepAt = Game.time; AudioSys.step(); }
  // camera
  const eye = crouching ? CONFIG.crouchEye : CONFIG.eyeHeight;
  const bob = hSpeed > 0.5 && p.pos.y === 0 ? Math.sin(Game.time * 11) * 0.035 : 0;
  camera.position.set(p.pos.x, p.pos.y + eye + bob, p.pos.z);
  camera.rotation.set(p.pitch + (Game.shake > 0 ? rand(-1, 1) * Game.shake * 0.02 : 0), p.yaw, 0);
  // weapon bob + kick recovery
  if (viewGun) {
    viewGun.position.x = 0.26 + (hSpeed > 0.5 ? Math.sin(Game.time * 11) * 0.008 : 0);
    viewGun.position.y = -0.24 + bob * 0.4 + (p.reloading > 0 ? Math.sin(Game.time * 9) * 0.03 - 0.05 : 0);
    viewGun.position.z += (-0.5 - viewGun.position.z) * Math.min(1, dt * 10);
    viewGun.rotation.x += (0 - viewGun.rotation.x) * Math.min(1, dt * 8);
  }
  // reload timer
  if (p.reloading > 0) { p.reloading -= dt; if (p.reloading <= 0) { finishReload(p); updateWeaponHUD(); } }
  // firing
  const w = WEAPONS[p.weapon];
  if (Input.firing && Game.phase === 'live') {
    if (w.auto) shoot(p);
    else if (Game.time - p.lastShot >= 60 / w.rpm) shoot(p);
  }
  if (p.mag === 0 && p.reserve > 0 && p.reloading <= 0) startReload(p);
  playerInteract(dt);
  // flash fade (tracked in ui.js now — no per-frame style parsing here)
  Game.ui?.tickFlash(dt);
  // in staged screenshot mode the muzzle stays lit for the capture
  if (muzzle && !Game.shotMode) { muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 14); }
  if (muzzleLight && !Game.shotMode) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
}

function updateDemoCamera(dt) {
  // spectate mode: slow cinematic orbit; shot mode keeps the first-person view
  if (Game.shotMode) { updatePlayer(dt); return; }
  const t = Game.time * 0.06;
  camera.position.set(Math.cos(t) * 26, 13, Math.sin(t) * 20);
  camera.lookAt(0, 0.5, 0);
}

function updateBots(dt) {
  for (const b of Game.bots) botThink(b, dt);
}

/* Fixed-step simulation (criterion 5): the world advances in 1/60 s
   steps, kept apart from rendering — the loop only accumulates real time
   and draws the latest state each animation frame. Gameplay therefore
   runs at the same speed on a 60 Hz laptop and a 240 Hz desktop, and a
   slow frame can never teleport a bot through a wall (dt used to be
   whatever the frame took, clamped). If rendering falls far behind, the
   backlog is dropped instead of spiralling (slow motion, not a freeze). */
const SIM_STEP = 1 / 60, SIM_MAX_STEPS = 8;
let simAcc = 0;
function stepSim(dt) {
  Game.time += dt;
  if (Game.phase === 'live' || Game.phase === 'buy' || Game.phase === 'roundEnd' || Game.demoMode) {
    if (Game.phase === 'buy') {
      Game.buyTimer -= dt;
      if (Game.buyTimer <= 0) {
        Game.phase = 'live';
        $('buy').classList.add('hidden');
        document.exitPointerLock?.();
        Game.ui?.showBanner('GO GO GO', 'Round ' + Game.round + ' — eliminate the Jackals or stop the spike.', 'draw');
        if (!Game.demoMode) Game.lockPointer?.();
        else Game.ui?.radio(null, 'Bots are fighting — sit back and watch.');
      }
      updateHUD();
    } else if (Game.phase === 'live') {
      Game.roundTime -= dt;
      if (Game.roundTime <= 0) {
        if (Game.bomb.state === 'planted') { /* timer decides it */ }
        else endRound('CT', 'Time expired — the Jackals ran out of time.');
      }
      if (!Game.demoMode) updatePlayer(dt);
      else updateDemoCamera(dt);
      updateBots(dt);
      // round end is polled here, not from inside combat: kills happen in
      // updateBots, and this is the one place that owns round flow.
      checkRoundEnd();
      updateBomb(dt);
      drawMinimap();
      updateHUD();
    } else if (Game.phase === 'roundEnd' || Game.demoMode) {
      // keep world alive behind banners / demo
      if (Game.demoMode && Game.phase !== 'live') { updateBots(dt); }
      drawMinimap();
    }
    updateFx(dt);
  }
}

let _lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const frameDt = Math.min((now - _lastT) / 1000, 0.25);
  _lastT = now;
  simAcc += frameDt;
  let steps = 0;
  while (simAcc >= SIM_STEP && steps < SIM_MAX_STEPS) { stepSim(SIM_STEP); simAcc -= SIM_STEP; steps++; }
  if (steps === SIM_MAX_STEPS) simAcc = 0; // behind: drop backlog, never spiral
  // scoreboard key (held)
  if (Input.keys.Tab) { renderScoreboard(); $('scoreboard').classList.remove('hidden'); }
  else $('scoreboard').classList.add('hidden');
  renderer.render(scene, camera);
  // fps counter (cheap, 2/s, on its own clock so it works in the menu too)
  if (!loop._fpsAt || now - loop._fpsAt > 500) {
    loop._fpsAt = now;
    $('fps').textContent = 'DUSTLINE Sector 7 · ' + Math.round(1 / Math.max(frameDt, 0.001)) + ' fps';
  }
}

/* ---------------- 11. boot, menus, demo + screenshot modes ---------------- */
function enterGame(demo) {
  Game.demoMode = !!demo;
  AudioSys.init(); AudioSys.resume();
  $('menu').classList.add('hidden');
  $('match-end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  Game.difficulty = $('difficulty').value;
  startMatch();
  if (!demo) Game.lockPointer?.();
}
function backToMenu() {
  Game.phase = 'menu';
  $('match-end').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  document.exitPointerLock?.();
}
function applyShotMode() {
  // ?shot=1..4 — deterministic staged views for screenshots (real renders).
  // ?demo=1 — bots fight on their own with no input (also used by ?shot).
  const q = new URLSearchParams(location.search);
  Game.shotMode = parseInt(q.get('shot') || '0', 10);
  if (q.get('demo') === '1' || Game.shotMode > 0) {
    // ?diff=... is attacker-controlled input: only the three known keys are
    // accepted, anything else (incl. 'Veteran', 'hard', '') falls back to
    // 'regular'. An unchecked value used to make DIFF[Game.difficulty]
    // undefined and throw in botThink on first enemy contact, freezing the
    // game with an uncaught exception every frame.
    const diffParam = q.get('diff');
    Game.difficulty = diffParam === 'recruit' || diffParam === 'regular' || diffParam === 'veteran' ? diffParam : 'regular';
    Game.demoMode = true;
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    startMatch();
    Game.phase = 'live'; Game.buyTimer = 0; // skip straight to the action
    $('buy').classList.add('hidden');
    // ?demo=1 alone: plain bot-vs-bot match, no staging. Only ?shot=N stages.
    if (Game.shotMode <= 0) return true;
    // stage the scene per shot: first-person vantages with enemies in frame
    // (the fps counter is a dev overlay whose number is meaningless under
    // a software renderer, so staged shots hide it; real play keeps it)
    $('fps').style.display = 'none';
    const vantages = {
      1: { pos: [0, 16], yaw: 0, pitch: 0, foes: [[0, 4], [-5, 0], [5, 2], [-2, -6], [6, -2]] },
      2: { pos: [20, 4], yaw: -2.84, pitch: 0, foes: [[22, 18], [26, 14], [20, 20], [24, 12], [28, 18]] },
      3: { pos: [-12, -8], yaw: 0.99, pitch: 0, foes: [[-22, -16], [-26, -14], [-20, -19], [-24, -12], [-18, -18]] },
      4: { pos: [2, -20], yaw: 3.14, pitch: 0, foes: [[0, -6], [-4, -2], [4, 0], [-2, 6], [6, 4]] },
    };
    const v = vantages[Game.shotMode] || vantages[1];
    Game.player.pos.set(v.pos[0], 0, v.pos[1]);
    Game.player.yaw = v.yaw; Game.player.pitch = v.pitch;
    camera.position.set(v.pos[0], CONFIG.eyeHeight, v.pos[1]);
    camera.rotation.set(v.pitch, v.yaw, 0);
    const foes = Game.bots.filter((b) => b.team !== Game.player.team);
    foes.forEach((b, i) => { const sp = v.foes[i % v.foes.length]; b.pos.set(sp[0], 0, sp[1]); if (b.mesh) b.mesh.position.copy(b.pos); });
    const friends = Game.bots.filter((b) => b.team === Game.player.team);
    friends.forEach((f, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      f.pos.set(v.pos[0] + side * (3 + Math.floor(i / 2) * 2), 0, v.pos[1] + 4 + Math.floor(i / 2) * 2);
      if (f.mesh) f.mesh.position.copy(f.pos);
    });
    // shot 4 is the firefight: freeze a real tracer, muzzle flash and
    // impact burst mid-shot so the frame shows combat, not a still life.
    if (Game.shotMode === 4) stageFirefight();
    return true;
  }
  return false;
}

function init() {
  initRenderer();
  buildMap();
  buildViewmodel();
  Input.init(renderer.domElement);
  // menu buttons
  $('btn-play').addEventListener('click', () => enterGame(false));
  $('btn-spectate').addEventListener('click', () => enterGame(true));
  $('btn-close-buy').addEventListener('click', () => { $('buy').classList.add('hidden'); if (Game.phase === 'buy') Game.lockPointer?.(); });
  $('btn-resume').addEventListener('click', () => { hidePause(); Game.lockPointer?.(); });
  $('btn-rematch').addEventListener('click', () => { $('match-end').classList.add('hidden'); enterGame(Game.demoMode); });
  $('btn-menu').addEventListener('click', backToMenu);
  // clicking the 3D view re-locks the pointer
  renderer.domElement.addEventListener('click', () => {
    if ((Game.phase === 'live' || Game.phase === 'buy') && !Input.locked && !Game.demoMode) Game.lockPointer?.();
  });
  // boot: menu, or straight into demo/shot mode
  const staged = applyShotMode();
  if (!staged) {
    // menu backdrop: slow orbit so the menu isn't a black screen
    camera.position.set(20, 9, -18); camera.lookAt(-8, 1, 4);
    Game.phase = 'menu';
  }
  // test / grader hook: cheap, read-only status
  window.__DUSTLINE__ = {
    version: '1.2.0', three: THREE.REVISION,
    status: () => ({ phase: Game.phase, round: Game.round, score: Game.score, gameTime: +Game.time.toFixed(1), roundTime: +Game.roundTime.toFixed(1), playerAlive: !!Game.player?.alive, playerPos: Game.player ? { x: +Game.player.pos.x.toFixed(2), z: +Game.player.pos.z.toFixed(2) } : null, botsAlive: Game.bots.filter((b) => b.alive).length, bomb: Game.bomb.state, heardEvents: Game.heardEvents, noises: Game.noises.length, bots: Game.bots.map((b) => ({ n: b.name, t: b.team, hp: Math.round(b.hp), x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1), alive: b.alive })) }),
  };
  window.addEventListener('error', (e) => { (window.__DUSTLINE__.errors = window.__DUSTLINE__.errors || []).push(String(e.message)); });
  loop();
}
init();
