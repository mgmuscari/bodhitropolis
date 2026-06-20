// Generate MULTI-TILE buildings as ONE image per (kind,w,h,tier) at footprint resolution (w·16)×(h·16),
// then slice into 16×16 cells named by footprintCellKey — so a coal plant is one big plant across its
// 3×3 plot, a civic center one building across its 3×3, a commercial strip one building across its 2×1
// — NOT a tiny building repeated per cell (Maddy 2026-06-19/20). The renderer prefers the cell key.
//
// PLOTS lists every (kind, w, h) that actually appears in-game — worldgen + tool + growth footprints,
// including NON-SQUARE (commercial 2×1) and multiple sizes per kind (civic is 2×2 by tool AND 3×3 by
// worldgen). Resumable: skips complete plots (run without --force to bake only the missing ones).
//
//   node tools/tileset/generate-multitile.mjs [--kinds 23,19] [--concurrency 2] [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { submit, awaitOutput, fetchImage, promptFor, seedFor, whiteToAlpha, buildBuildingGraph, uploadFootprint, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../..', 'public/tilesets/satellite/buildings');
mkdirSync(OUT, { recursive: true });

// Every multi-tile plot the game can place. {k: kind, w, h}. Square civic/services/plants + the
// non-square / extra-size R/C/I and worldgen sizes (civic 3×3, offices 2×2, projects/industrial 3×3,
// commercial 2×1) that were missing → had rendered as repeated singles.
const PLOTS = [
  // civic + services (tool places civic 2×2; worldgen places it 3×3 — bake both)
  { k: 23, w: 2, h: 2 }, { k: 23, w: 3, h: 3 },
  { k: 31, w: 2, h: 2 }, { k: 32, w: 2, h: 2 }, { k: 33, w: 2, h: 2 }, { k: 34, w: 2, h: 2 }, { k: 35, w: 2, h: 2 },
  // eco / service buildings (2×2)
  { k: 26, w: 2, h: 2 }, { k: 49, w: 2, h: 2 }, { k: 51, w: 2, h: 2 }, { k: 52, w: 2, h: 2 }, { k: 56, w: 2, h: 2 }, { k: 58, w: 2, h: 2 }, { k: 59, w: 2, h: 2 },
  // power plants (3×3 / 4×4)
  { k: 24, w: 3, h: 3 }, { k: 25, w: 3, h: 3 }, { k: 29, w: 3, h: 3 }, { k: 57, w: 3, h: 3 }, { k: 60, w: 3, h: 3 }, { k: 27, w: 4, h: 4 }, { k: 30, w: 4, h: 4 },
  // R/C/I grown footprints (the new gap)
  { k: 18, w: 3, h: 3 }, { k: 19, w: 2, h: 1 }, { k: 20, w: 2, h: 2 }, { k: 21, w: 3, h: 3 },
];

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const concurrency = Number(arg('concurrency', '2'));
const onlyKinds = arg('kinds', '').split(',').filter(Boolean).map(Number);

const cellFile = (kind, w, h, col, row, tier) => `b-${kind}-${w}x${h}-c${col}-r${row}-${tier}.png`;

// One plot job per (kind, w, h, tier).
const jobs = [];
for (const { k, w, h } of PLOTS) {
  if (onlyKinds.length && !onlyKinds.includes(k)) continue;
  for (const tier of [0, 1]) jobs.push({ kind: k, w, h, tier });
}

let targets = jobs;
if (!force) {
  targets = jobs.filter(({ kind, w, h, tier }) => {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (!existsSync(join(OUT, cellFile(kind, w, h, c, r, tier)))) return true;
    return false;
  });
}

console.log(`ComfyUI: ${COMFY_URL}`);
console.log(`multi-tile bake: ${targets.length}/${jobs.length} plots (concurrency ${concurrency})`);

let done = 0, failed = 0;
async function worker(queue) {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const { kind, w, h, tier } = job;
    try {
      const repKey = `b-${kind}-c-${tier}`; // representative key for prompt/seed (per kind,tier)
      const seed = seedFor(repKey, 'building');
      const initName = await uploadFootprint(kind, seed, w * 256, h * 256); // creative footprint at plot res
      const graph = buildBuildingGraph({ initName, prompt: promptFor(repKey, 'building'), seed, genW: w * 256, genH: h * 256, pixel: 16 });
      const out = await awaitOutput(await submit(graph), { timeoutMs: 240000 });
      const big = whiteToAlpha(await fetchImage(out), w * 16, h * 16); // alpha the whole plot, then slice
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const cell = execFileSync('magick', ['png:-', '-crop', `16x16+${c * 16}+${r * 16}`, '+repage', 'png:-'], { input: big, maxBuffer: 32 * 1024 * 1024 });
          writeFileSync(join(OUT, cellFile(kind, w, h, c, r, tier)), cell);
        }
      }
      done++;
      console.log(`✓ kind ${kind} ${w}x${h} tier ${tier} → ${w * h} cells  [${done}/${targets.length}]`);
    } catch (e) {
      failed++;
      console.error(`✗ kind ${kind} ${w}x${h} tier ${tier}: ${e.message}`);
    }
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker(queue)));
console.log(`\ndone: ${done} plots, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
