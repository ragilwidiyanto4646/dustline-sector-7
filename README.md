# dustline-sector-7

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/ragilwidiyanto4646/dustline-sector-7/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/ragilwidiyanto4646/dustline-sector-7/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

DUSTLINE // Sector 7: a round-based tactical FPS in three.js — 5v5 with bots, bomb plant/defuse, a buy economy, and gunplay where accuracy beats speed.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
python3 -m http.server 8901 --directory game
```

`node main.ts` (Node ≥ 22.18, no dependencies) writes `out/game`,
`out/screenshots` and `out/dossier.json` — the entry the grader runs. Then
open http://127.0.0.1:8901/ in a desktop browser with WebGL 2 and click
DEPLOY. No build step, no network requests, no external assets.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ztnjpsw2&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## Details

- Bounty: **Make the best three.js tactical FPS** — $1,000
  (`threejs-fps-02`, https://make.fun/bounty/threejs-fps-02)
- Deadline: **2026-11-16 21:30 UTC** (Mon 17 Nov 2026, 04:30 WIB)
- Prizes: $400 / $200 / $120 / $40×7 (10 places, $1,000 total)

## The game

Two crews fight over a desert freight yard. **Wardens** hold the sites,
**Jackals** push in to plant the spike — or wipe the other crew out.
**First crew to 5 rounds takes the match** (best of 9). Sides alternate
every round, so you both defend (defuse) and attack (plant).

- **5v5 + bots** — you + 4 friendly bots vs 5 enemy bots, with waypoint
  pathfinding, site pushes, plant/defuse runs, burst fire, strafing, falling
  back when hurt, and radio callouts
- **Bomb objective** — plant on Site A (Foundry) or B (Depot), 35 s
  detonation timer with accelerating beeps; defuse to save the site
- **Buy economy** — $800 start, $300/kill, $3,250 round win / $1,900 loss,
  $300 plant bonus. Rifle VK-47, SMG RS-12, marksman LW-308 (scoped),
  shotgun SG-12, kevlar, smoke and flashbang
- **Gunfeel** — hitscan with spread bloom, recoil, tracers, muzzle flash,
  impact sparks, headshots (2×), armor, scope zoom
- **Full HUD** — health, armor, ammo, money, round timer, round score, live
  minimap, killfeed, radio log, hitmarker, damage vignette
- **Synthesized sound** — WebAudio gunshots, reloads, footsteps, bomb
  beeps, round stingers. No audio files.
- **Original map “Sector 7”** — desert freight yard, mid crossroads,
  containers, crates, barrels, furnace and silo

### Controls

| Input | Action |
|---|---|
| Mouse / Click | Look, aim / fire (hold for auto) |
| Right click | Scope (marksman rifle) |
| W A S D / Shift / Space / Ctrl | Move / walk / jump / crouch |
| R / Q / Scroll | Reload / last weapon / swap weapon |
| E (hold) | Plant / defuse the spike |
| B | Buy menu (freeze time) |
| 4 / 5 | Smoke grenade / flashbang |
| Tab (hold) / Esc | Scoreboard / pause |

## How it works

- `main.ts` — the entry program (Node 22, standard library only). Copies
  `game/` and `screenshots/` to the output directory and writes
  `dossier.json` with `buildDossier` from `vendor/makefun-threejs.ts`
  (the kit's copy, unchanged). Two runs write identical bytes.
- `game/index.html` + `game/main.js` — the whole game: three.js 0.187.0
  (vendored `three.module.min.js` / `three.core.min.js`, byte for byte the
  kit's files) via an import map, one ES module, no build step.
- `game/main.js` — renderer, fixed-step simulation, bot AI (waypoints,
  bursts, reactions, callouts), weapons, economy, HUD and minimap.
- `screenshots/` — 4 real renders of the game's own code (`?shot=1..4`
  staged first-person views), 1280×480 JPEG, each under the 256 KiB gate.

## Checks

- `main.ts` run twice → byte-identical output (`diff -r` clean);
  dossier 540,330 bytes (< 1.5 MiB), source text 93,421 bytes (< 160 KiB)
- Screenshots: 4 files, 1280×480, 79–89 KB each (limit 256 KiB)
- three.js files byte-identical to the kit's 0.187.0 files; import map maps
  `"three"` to `./three.module.min.js`; no network reference anywhere in
  `game/` (no fetch, no external URL, no dynamic import)
- Headless play-test (Chrome + SwiftShader): boots with no page errors,
  bots fight and kill each other, rounds progress, HUD/minimap render
- `node --check game/main.js && node --check main.ts` → OK
- Note: `makefun grade-local` refuses this competition by design — its
  scorer and reference data stay on the server, so the house grades it
  after submission. No local sealed score exists.
