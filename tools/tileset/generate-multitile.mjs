// Generate MULTI-TILE buildings as ONE image per (kind,tier) at footprint resolution (w·16)², then
// slice into 16×16 cells named by footprintCellKey — so a coal plant is one big plant across its 3×3
// plot, not nine tiny ones (Maddy 2026-06-19: "police/plants are tiny on 4/9-tile plots… render at
// W·16 × H·16"). The renderer already prefers the cell key. Resumable (skips complete plots).
//
//   node tools/tileset/generate-multitile.mjs [--kinds 24,27] [--concurrency 2] [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { submit, awaitOutput, fetchImage, promptFor, seedFor, whiteToAlpha, buildBuildingGraph, uploadFootprint, FOOTPRINTS, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../..', 'public/tilesets/satellite/buildings');
mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const concurrency = Number(arg('concurrency', '2'));
const onlyKinds = arg('kinds', '').split(',').filter(Boolean).map(Number);

const cellFile = (kind, w, col, row, tier) => `b-${kind}-${w}x${w}-c${col}-r${row}-${tier}.png`;

// One plot job per (kind, tier).
const jobs = [];
for (const kind of Object.keys(FOOTPRINTS).map(Number)) {
  if (onlyKinds.length && !onlyKinds.includes(kind)) continue;
  for (const tier of [0, 1]) jobs.push({ kind, tier, w: FOOTPRINTS[kind] });
}

let targets = jobs;
if (!force) {
  targets = jobs.filter(({ kind, w, tier }) => {
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) if (!existsSync(join(OUT, cellFile(kind, w, c, r, tier)))) return true;
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
    const { kind, tier, w } = job;
    try {
      const repKey = `b-${kind}-c-${tier}`; // representative key for prompt/seed (per kind,tier)
      const seed = seedFor(repKey, 'building');
      const initName = await uploadFootprint(kind, seed, w * 256); // creative footprint silhouette at plot res
      const graph = buildBuildingGraph({ initName, prompt: promptFor(repKey, 'building'), seed, gen: w * 256, pixel: 16 });
      const out = await awaitOutput(await submit(graph), { timeoutMs: 240000 });
      const big = whiteToAlpha(await fetchImage(out), w * 16); // alpha the whole plot, then slice
      for (let r = 0; r < w; r++) {
        for (let c = 0; c < w; c++) {
          const cell = execFileSync('magick', ['png:-', '-crop', `16x16+${c * 16}+${r * 16}`, '+repage', 'png:-'], { input: big, maxBuffer: 32 * 1024 * 1024 });
          writeFileSync(join(OUT, cellFile(kind, w, c, r, tier)), cell);
        }
      }
      done++;
      console.log(`✓ kind ${kind} ${w}x${w} tier ${tier} → ${w * w} cells  [${done}/${targets.length}]`);
    } catch (e) {
      failed++;
      console.error(`✗ kind ${kind} tier ${tier}: ${e.message}`);
    }
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker(queue)));
console.log(`\ndone: ${done} plots, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
