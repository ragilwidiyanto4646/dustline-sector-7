/* ============================================================================
   DUSTLINE // Sector 7 — ui.js
   Everything the player reads: the HUD, the minimap, the killfeed, the
   radio chatter, the buy menu, the scoreboard, the banners and the scope
   overlay. This is the only module that touches the DOM, and it is the
   module other systems call through the Game.ui hooks (state.js).

   Perf note (criterion 5): updateHUD() and drawMinimap() used to run on
   every fixed step — 60 DOM rewrites and a full canvas redraw a second.
   Both now run at most 10 times a second, and text is only rewritten
   when its value actually changed.
   ========================================================================== */
import { $, fmtMoney, fmtTime, clamp } from './util.js';
import { WEAPONS, SHOP, ARMOR_PRICE, SMOKE_PRICE, FLASH_PRICE, CONFIG } from './data.js';
import { Game, TEAM_NAME, playerVel } from './state.js';
import { WORLD, sites, colliders, camera } from './world.js';
import { buyItem } from './actors.js';
import { AudioSys } from './audio.js';

/* ---------------- HUD ---------------- */
let lastHudAt = -1;
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setBar(id, pct, color) {
  const key = id + ':' + Math.round(pct) + ':' + (color || '');
  if (hudCache[key]) return;
  hudCache[key] = true;
  $(id).style.width = clamp(pct, 0, 100) + '%';
  if (color) $(id).style.background = color;
}
export function updateHUD() {
  // at most 10 refreshes a second; values are also cached, so a call
  // that changes nothing writes nothing.
  if (Game.time - lastHudAt < 0.1) return;
  lastHudAt = Game.time;
  const p = Game.player; if (!p) return;
  const hp = Math.max(0, Math.ceil(p.hp));
  if (hudCache.hp !== hp) { hudCache.hp = hp; $('hp').innerHTML = hp + ' <small>HP</small>'; }
  setBar('hp-fill', p.hp, p.hp > 50 ? '#7ddc7d' : p.hp > 25 ? '#ffb454' : '#ff5d5d');
  setBar('armor-fill', p.armor);
  setText('money', fmtMoney(p.money));
  setText('score-ct', String(Game.score.CT));
  setText('score-t', String(Game.score.T));
  setText('round-label', 'ROUND ' + Game.round + ' / ' + (CONFIG.matchWinRounds * 2 - 1));
  const t = Game.phase === 'buy' ? Game.buyTimer : Game.roundTime;
  setText('timer', fmtTime(t));
  $('timer').classList.toggle('low', t <= 10 && Game.phase === 'live');
  if (Game.bomb.state === 'planted') {
    setText('bomb-status', 'SPIKE ' + Game.bomb.site + ' · ' + fmtTime(Game.bomb.timer));
  } else if (hudCache['bomb-status']) { setText('bomb-status', ''); }
  updateWeaponHUD();
}
export function updateWeaponHUD() {
  const p = Game.player; if (!p) return;
  const w = WEAPONS[p.weapon];
  const ammo = (p.reloading > 0 ? '--' : p.mag) + ' <small>/ ' + p.reserve + '</small>';
  if (hudCache.ammo !== ammo) { hudCache.ammo = ammo; $('ammo').innerHTML = ammo; }
  const name = w.name + (p.reloading > 0 ? ' — RELOADING' : '');
  setText('weapon-name', name);
  setText('firemode', (w.auto ? 'AUTO' : 'SEMI') + ' · SMOKE ' + p.util.smoke + ' · FLASH ' + p.util.flash);
  const gap = 6 + (playerVel.lengthSq() > 0.4 ? 10 : 0) + (p.scoped ? -4 : 0);
  document.querySelector('#crosshair .t').style.top = (-gap) + 'px';
  document.querySelector('#crosshair .b').style.bottom = (-gap) + 'px';
  document.querySelector('#crosshair .lf').style.left = (-gap) + 'px';
  document.querySelector('#crosshair .rt').style.right = (-gap) + 'px';
}

/* ---------------- feedback: hitmarker, damage, flash ---------------- */
export function damageFlash() {
  $('dmg-vignette').style.opacity = '1';
  setTimeout(() => { $('dmg-vignette').style.opacity = '0'; }, 260);
}
export function showHitmarker(head, isKill) {
  const hm = $('hitmarker');
  hm.style.opacity = '1'; hm.classList.toggle('kill', !!isKill);
  setTimeout(() => { hm.style.opacity = '0'; }, isKill ? 220 : 140);
}
let flashLevel = 0;
export function flashPlayer() { flashLevel = 1; $('flash').style.opacity = '1'; }
export function tickFlash(dt) {
  if (flashLevel > 0 && Game.time > Game.flashUntil) {
    flashLevel = Math.max(0, flashLevel - dt * 1.5);
    $('flash').style.opacity = String(flashLevel);
  }
}
export function setScope(on) {
  const p = Game.player; if (!p || !p.alive) return;
  const w = WEAPONS[p.weapon];
  if (w.zoom <= 1) return;
  p.scoped = on && Game.phase === 'live';
  $('scope').style.opacity = p.scoped ? '1' : '0';
  camera.fov = p.scoped ? 74 / w.zoom : 74;
  camera.updateProjectionMatrix();
}

/* ---------------- killfeed / radio / banners ---------------- */
export function addKillfeed(att, vic, head) {
  const el = document.createElement('div');
  el.innerHTML = `<b style="color:${att.team === 'CT' ? '#7fd4ff' : '#ffb454'}">${att.name}</b> ` +
    `<span class="wpn">[${WEAPONS[att.weapon].short}]</span> ` +
    (head ? '<span class="hs">HEADSHOT</span> ' : '') +
    `<b style="color:${vic.team === 'CT' ? '#7fd4ff' : '#ffb454'}">${vic.name}</b>`;
  const feed = $('killfeed'); feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
export function radio(who, text) {
  const el = document.createElement('div');
  el.innerHTML = `<b>${who ? who.name : 'RADIO'}</b> — ${text}`;
  const box = $('radio'); box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), 7000);
}
export function showBanner(title, sub, kind) {
  $('banner-title').textContent = title;
  $('banner-title').className = kind || '';
  $('banner-sub').textContent = sub || '';
  $('banner').classList.add('show');
  setTimeout(() => $('banner').classList.remove('show'), 3400);
}
export function showInteract(action, prog, dur) {
  const boxEl = $('interact');
  boxEl.classList.remove('hidden');
  $('interact-text').textContent = action;
  $('interact-fill').style.width = Math.round(100 * prog / dur) + '%';
}
export function hideInteract() { $('interact').classList.add('hidden'); }

/* ---------------- minimap ---------------- */
let lastMapAt = -1;
export function drawMinimap() {
  if (Game.time - lastMapAt < 0.1) return; // 10 Hz is plenty for a minimap
  lastMapAt = Game.time;
  const cv = $('minimap'), x = cv.getContext('2d');
  const sx = cv.width / (WORLD.w + 8), sz = cv.height / (WORLD.d + 8);
  const X = (wx) => (wx + WORLD.w / 2 + 4) * sx, Z = (wz) => (wz + WORLD.d / 2 + 4) * sz;
  x.clearRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#1a2229'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#2c3843'; x.fillRect(X(-WORLD.w / 2), Z(-WORLD.d / 2), WORLD.w * sx, WORLD.d * sz);
  for (const c of colliders) {
    if (c.max.y > 3.5) continue;
    x.fillStyle = '#4a5a66';
    x.fillRect(X(c.min.x), Z(c.min.z), (c.max.x - c.min.x) * sx, (c.max.z - c.min.z) * sz);
  }
  for (const [key, s] of Object.entries(sites)) {
    x.strokeStyle = key === 'A' ? '#ffb454' : '#7fd4ff'; x.lineWidth = 3;
    x.beginPath(); x.arc(X(s.center.x), Z(s.center.z), s.r * sx, 0, 7); x.stroke();
    x.fillStyle = x.strokeStyle; x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
    x.fillText(key, X(s.center.x), Z(s.center.z) + 8);
    if (Game.bomb.state === 'planted' && Game.bomb.site === key) {
      x.fillStyle = '#ff4040'; x.beginPath(); x.arc(X(s.center.x), Z(s.center.z), 7, 0, 7); x.fill();
    }
  }
  const dot = (f, color, r = 7) => {
    x.fillStyle = color; x.beginPath(); x.arc(X(f.pos.x), Z(f.pos.z), r, 0, 7); x.fill();
    x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke();
  };
  for (const b of Game.bots) if (b.alive) dot(b, b.team === Game.player.team ? '#7fd4ff' : '#ff9040', 6);
  if (Game.player?.alive) dot(Game.player, '#ffffff', 8);
}

/* ---------------- menus: buy / scoreboard / pause / match end ---------------- */
export function renderShop() {
  const p = Game.player; if (!p) return;
  $('buy-money').textContent = fmtMoney(p.money);
  const rows = SHOP.map((s) => {
    let name, price;
    if (s.w === 'armor') { name = 'KEVLAR VEST'; price = ARMOR_PRICE; }
    else if (s.w === 'smoke') { name = 'SMOKE GRENADE'; price = SMOKE_PRICE; }
    else if (s.w === 'flash') { name = 'FLASHBANG'; price = FLASH_PRICE; }
    else { name = WEAPONS[s.w].name; price = WEAPONS[s.w].price; }
    const afford = p.money >= price;
    const owned = s.w in WEAPONS && p.weapons[s.w];
    return `<tr data-key="${s.key}" class="${p.weapon === s.w ? 'sel' : ''}" style="${afford ? '' : 'opacity:.45'}">
      <td><b>[${s.key}]</b> ${name} ${owned ? '<span class="muted">· owned</span>' : ''}</td>
      <td class="muted">${s.tag}</td><td class="price">${fmtMoney(price)}</td></tr>`;
  }).join('');
  $('shop-table').innerHTML = `<tr><th>Item</th><th></th><th style="text-align:right">Price</th></tr>` + rows;
  $('shop-table').querySelectorAll('tr[data-key]').forEach((tr) => tr.addEventListener('click', () => {
    if (buyItem(p, tr.dataset.key)) { renderShop(); updateHUD(); AudioSys.reload(); }
  }));
}
export function toggleBuy() {
  const el = $('buy');
  if (Game.phase !== 'buy' && Game.phase !== 'live') return;
  if (Game.phase === 'live') { radio(null, 'Buy phase is over — win the round to shop again.'); return; }
  el.classList.toggle('hidden');
  if (el.classList.contains('hidden')) Game.lockPointer?.(); else document.exitPointerLock?.();
  renderShop();
}
export function renderScoreboard() {
  const rows = [Game.player, ...Game.bots].map((f) =>
    `<tr><td class="${f.team.toLowerCase()}"><b>${f.name}</b> ${f.isPlayer ? '(you)' : ''}</td>
     <td>${TEAM_NAME[f.team]}</td><td>${f.kills}</td><td>${f.deaths}</td>
     <td>${f.alive ? 'ALIVE' : 'DEAD'}</td><td>${fmtMoney(f.money)}</td></tr>`).join('');
  $('sb-body').innerHTML = `<table class="score"><tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>Status</th><th>Cash</th></tr>${rows}</table>`;
  $('sb-title').textContent = `Scoreboard — Wardens ${Game.score.CT} : ${Game.score.T} Jackals · Round ${Game.round}`;
}
export function showPause() { if (Game.phase === 'live' || Game.phase === 'buy') $('pause').classList.remove('hidden'); }
export function hidePause() { $('pause').classList.add('hidden'); }
export function showMatchEnd({ ctWon, title, sub, stats }) {
  $('match-end').classList.remove('hidden');
  $('end-title').textContent = title;
  $('end-title').style.color = ctWon ? '#9fe870' : '#ff6b6b';
  $('end-sub').textContent = sub;
  $('end-stats').innerHTML = stats;
}

/* The hook table other modules call: assigned here, at import time, so
   combat / ai / rounds can show feedback without importing this module. */
Game.ui = {
  updateHUD, updateWeaponHUD, addKillfeed, radio, showBanner, renderShop,
  toggleBuy, renderScoreboard, showPause, hidePause, setScope,
  damageFlash, showHitmarker, flashPlayer, tickFlash,
  showInteract, hideInteract, showMatchEnd,
};
