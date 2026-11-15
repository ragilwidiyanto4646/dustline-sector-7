/* ============================================================================
   DUSTLINE // Sector 7 — state.js
   The one place state lives (criterion 5): the match object, the team
   tables, the player's velocity, and the hooks other modules fill in.
   Systems never keep their own copy of match state — they read Game.

   Hooks: ui.js assigns Game.ui (HUD / menu / feedback helpers) and
   input.js assigns Game.lockPointer at boot, so low-level modules
   (combat, ai, rounds) can show feedback without importing the UI,
   which would make the import graph circular.
   ========================================================================== */
import { V3 } from './util.js';
import { CONFIG } from './data.js';

export const TEAM_COLOR = { CT: 0x3f8cff, T: 0xff9040 };
export const TEAM_NAME = { CT: 'WARDENS', T: 'JACKALS' };

export const Game = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1, score: { CT: 0, T: 0 }, roundTime: CONFIG.roundTime,
  buyTimer: CONFIG.buyTime, bomb: { state: 'idle', site: null, timer: 0, planter: null, defuser: null, progress: 0 },
  player: null, bots: [], difficulty: 'regular', spectate: false,
  money: CONFIG.startMoney, kills: 0, deaths: 0, shotsFired: 0, shotsHit: 0, headshots: 0,
  roundKills: 0, spikeCarrier: null, time: 0, shake: 0, flashUntil: 0, smokeZones: [],
  muted: false, spikeMesh: null, demoMode: false, shotMode: 0,
  // gunshot noise log for bot hearing (ai.js): {x, z, t, team}, capped.
  noises: [], heardEvents: 0,
  // filled in by ui.js / input.js at boot; null until then.
  ui: null, lockPointer: null,
};

/* The player's velocity, shared by movement (main.js) and round resets
   (rounds.js) so a round never starts with an inherited slide. */
export const playerVel = V3(0, 0, 0);
