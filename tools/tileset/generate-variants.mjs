// Building VARIETY bake (Maddy: "more building variety per category especially for residential").
// 1×1 building kinds repeat a lot — every house tile is identical. This bakes N extra VARIANTS per
// (kind, tier): each variant salts the seed → a different creative footprint silhouette AND a
// different roof/site subject from the variety pool, so adjacent parcels of the same kind read
// distinctly. Variant 0 is the already-committed base tile; this generates 1..N. Files land as
// `b-{kind}-c-{tier}-v{n}.png`; manifest.mjs maps them to the variantKey `b-{kind}-c-{tier}#{n}`,
// which the renderer picks per parcel anchor (surfaceVariantIndex).
//
//   node tools/tileset/generate-variants.mjs [--variants 2] [--kinds 16,17] [--concurrency 3] [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submit, awaitOutput, fetchImage, promptFor, seedFor, whiteToAlpha, buildBuildingGraph, uploadFootprint, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../..', 'public/tilesets/satellite/buildings');
mkdirSync(OUT, { recursive: true });

// The densely-repeating 1×1 kinds worth varying (residential / commercial / industrial + ADU).
const DEFAULT_KINDS = [16, 17, 18, 19, 20, 21, 55];
const TIERS = [0, 1];

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const variants = Number(arg('variants', '2')); // extra variants beyond the base (v1..vN)
const concurrency = Number(arg('concurrency', '3'));
const kinds = arg('kinds', '').split(',').filter(Boolean).map(Number);
const KINDS = kinds.length ? kinds : DEFAULT_KINDS;

const jobs = [];
for (const kind of KINDS) for (const tier of TIERS) for (let v = 1; v <= variants; v++) {
  jobs.push({ kind, tier, v, key: `b-${kind}-c-${tier}`, file: `b-${kind}-c-${tier}-v${v}.png` });
}

let targets = jobs;
if (!force) targets = jobs.filter((j) => !existsSync(join(OUT, j.file)));

console.log(`ComfyUI: ${COMFY_URL}`);
console.log(`variant bake: ${targets.length}/${jobs.length} tiles (${variants} variants × ${KINDS.length} kinds × ${TIERS.length} tiers, concurrency ${concurrency})`);

let done = 0, failed = 0;
async function worker(queue) {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const { kind, key, v, file } = job;
    try {
      const seed = seedFor(key, 'building', v);
      const initName = await uploadFootprint(kind, seed, 512);
      const graph = buildBuildingGraph({ initName, prompt: promptFor(key, 'building', v), seed, gen: 512, pixel: 32 });
      const out = await awaitOutput(await submit(graph), { timeoutMs: 180000 });
      writeFileSync(join(OUT, file), whiteToAlpha(await fetchImage(out), 16));
      done++;
      console.log(`✓ ${file}  [${done}/${targets.length}]`);
    } catch (e) {
      failed++;
      console.error(`✗ ${file}: ${e.message}`);
    }
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker(queue)));
console.log(`\ndone: ${done} variant tiles, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
