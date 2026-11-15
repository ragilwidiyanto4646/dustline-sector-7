/* ============================================================================
   DUSTLINE // Sector 7 — input.js
   Keyboard, mouse and pointer lock. Input only records intent — keys,
   mouse deltas, firing — and the simulation (main.js) reads it on the
   fixed step, so a held key never depends on frame rate.
   ========================================================================== */
import { $ } from './util.js';
import { Game } from './state.js';
import { renderer } from './world.js';
import { toggleBuy, setScope, showPause, hidePause, renderShop, updateHUD } from './ui.js';
import { startReload, throwUtility } from './combat.js';
import { buyItem, swapToLastWeapon, cycleWeapon } from './actors.js';
import { AudioSys } from './audio.js';

export const Input = {
  keys: {}, mouseDX: 0, mouseDY: 0, firing: false, locked: false, sens: 0.0022,
  init(canvas) {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyB' && (Game.phase === 'buy' || Game.phase === 'live')) toggleBuy();
      if (e.code === 'KeyR') startReload(Game.player);
      if (e.code === 'KeyQ') swapToLastWeapon();
      if (e.code === 'Digit4') throwUtility('smoke');
      if (e.code === 'Digit5') throwUtility('flash');
      if (e.code.startsWith('Digit') && !$('buy').classList.contains('hidden')) {
        const k = e.code.replace('Digit', '');
        if (buyItem(Game.player, k)) { renderShop(); updateHUD(); AudioSys.reload(); }
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) setScope(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) setScope(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (Game.phase !== 'live' || !Game.player?.alive) return;
      cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === renderer.domElement;
      if (!this.locked && (Game.phase === 'live' || Game.phase === 'buy') && !Game.demoMode) showPause();
      else if (this.locked) hidePause();
    });
    Game.lockPointer = () => this.lock();
  },
  lock() { renderer.domElement.requestPointerLock(); },
};
