// Night Ledger — the hand-in program (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files a desktop
// browser loads offline (game/index.html and its ES modules, no library and
// no network request). This program copies game/ and screenshots/ from beside
// this file to /output and writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The entry itself: five heists in the city of Tarn. Rook Ashford, thief,
// steals the Tide Ledger, the Meridian Chip, the Sovereign Plate, the Widow's
// Pearl and the Nightingale Diamond — one named prize a heist, eighteen
// guards with raycast vision cones, two cameras, two laser grids, thirty-three
// treasures, four gadgets, and a green hatch that only opens once the prize
// is in hand. Screenshots are real frames of the running game.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Pre-flight: the gate refuses more than 4 screenshots or one over 256 KiB,
// so refuse here instead of handing in an entry the scorer would refuse.
const shotDir = join(here, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => !f.startsWith('.')) : [];
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`night-ledger: expected 3-4 screenshots, found ${shots.length}`);
}
for (const shot of shots) {
  const size = statSync(join(shotDir, shot)).size;
  if (size > 262144) throw new Error(`night-ledger: screenshot ${shot} is ${size} bytes, over the 256 KiB cap`);
}

// The grader runs this program twice and both runs must write the same bytes,
// so a second run starts from a clean output directory, never a merge.
rmSync(join(out, 'game'), { recursive: true, force: true });
rmSync(join(out, 'screenshots'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all, or a path under game/ over 1000 bytes: game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// A one-line receipt on stdout: the dossier's size and what was handed in.
const dossierBytes = readFileSync(join(out, 'dossier.json')).byteLength;
console.log(`night-ledger: dossier ${dossierBytes} bytes, ${shots.length} screenshots, game/ + screenshots/ copied to ${out}`);
