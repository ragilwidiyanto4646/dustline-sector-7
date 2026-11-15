// ============================================================================
// DUSTLINE // Sector 7 — make.fun entry program (threejs-fps-02)
// Node 22+, standard library only. No dependencies. Deterministic: two runs
// write identical bytes.
//
// The grader runs `node main.ts` in a fresh container with a read-only
// repository and a writable /output, and runs it twice requiring identical
// output. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output
// (as the kit starter's main.ts does); --out <dir> and $OUTPUT_DIR are local
// conveniences that override it.
//
//   node main.ts                              (writes /output)
//   MAKEFUN_OUTPUT_DIR=out node main.ts       (writes ./out)
//   node main.ts --out <dir>
//
// What it hands in: game/ (the playable game as static files) and
// screenshots/ (4 real renders) copied to the output directory, plus
// dossier.json written with buildDossier from vendor/makefun-threejs.ts —
// the kit's copy, unchanged. The gate rebuilds the dossier with the same
// library and compares byte for byte, so the caps passed here are the
// scorer's own (reference/gate.json).
// ============================================================================
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : process.env.MAKEFUN_OUTPUT_DIR ?? process.env.OUTPUT_DIR ?? "/output";

async function copyTree(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isDirectory()) await copyTree(join(src, e.name), join(dest, e.name));
    else await cp(join(src, e.name), join(dest, e.name));
  }
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1. The playable game, as static files with no build step.
  await copyTree(join(ROOT, "game"), join(OUT, "game"));
  // 2. Real renders of the game's own code (1280x480, each <= 256 KiB).
  await copyTree(join(ROOT, "screenshots"), join(OUT, "screenshots"));

  // 3. The dossier the AI judge reads (screenshots + up to 160 KiB of
  // source). buildDossier returns canonical JSON bytes; writing them
  // unchanged is what the gate's dossier_matches row checks.
  const dossier = buildDossier(OUT, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  await writeFile(join(OUT, "dossier.json"), dossier);

  // Sanity print (stdout only; never part of the output bytes).
  const gameFiles = await readdir(join(OUT, "game"));
  const shots = await readdir(join(OUT, "screenshots"));
  console.log(`wrote ${OUT}/`);
  console.log(`  game/: ${gameFiles.join(", ")}`);
  console.log(`  screenshots/: ${shots.join(", ")}`);
  console.log(`  dossier.json: ${dossier.length} bytes`);
}

await main();
