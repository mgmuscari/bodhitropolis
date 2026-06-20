// Ambient SPRITE generation — the moving/decorative layer over the tile base (Maddy: "generate
// ambient assets as well (cars, smog, props, flora, fauna, etc)"). Reuses the converged tileset
// pipeline (Z-Image turbo + pixel LoRA @ cfg 1, txt2img → PixelOE 16×16) from lib.mjs.
//
// Two alpha methods:
//   • WHITE→ALPHA (cars/flora/props/fauna): prompt forces a centered object on a plain WHITE
//     background; whiteToAlpha() floodfills the white away → a sprite on transparency. (Same trick
//     as the buildings — "white is kept → alpha".)
//   • LUMINANCE→ALPHA (smog/smoke): smoke IS white/gray, so a white-floodfill would erase it.
//     Instead prompt smoke on solid BLACK, then copy luminance → alpha (black bg → transparent,
//     the bright smoke → opaque). Soft, semi-transparent puffs.
//
//   node tools/tileset/ambient.mjs [--cat cars,flora] [--concurrency 3] [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { submit, awaitOutput, fetchImage, buildTxt2imgGraph, whiteToAlpha, seedFor, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../..', 'public/sprites/ambient');

// Strong top-down framing on a flat white field — the floodfill needs clean white to alpha away.
const TOPDOWN =
  'pixel art sprite, top-down overhead view seen straight down from directly above, orthographic map' +
  ' icon, centered, isolated on a plain solid white background, crisp clean pixels, no shadow, no ground';
// Smoke is light, so it sits on BLACK and becomes alpha by luminance.
const SMOG_FRAME =
  'pixel art, soft wispy translucent, centered on a solid pure black background, no ground, no object';

// Each entry: a slug + the subject phrase. White→alpha unless in the smog category.
const CATALOG = {
  cars: [
    ['sedan-red', 'a red sedan car, roof and windshield visible'],
    ['hatchback-blue', 'a small blue hatchback car'],
    ['pickup-white', 'a white pickup truck with an open bed'],
    ['taxi-yellow', 'a yellow taxi cab'],
    ['suv-green', 'a dark green SUV'],
    ['van-silver', 'a silver delivery van'],
    ['bus-city', 'a long city transit bus'],
    ['boxtruck', 'a brown box delivery truck'],
  ],
  flora: [
    ['tree-oak', 'a single round green oak tree canopy'],
    ['tree-pine', 'a dark green conifer pine tree'],
    ['shrub', 'a small round green shrub bush'],
    ['flowerbed', 'a bed of colorful flowers'],
    ['palm', 'a palm tree canopy'],
    ['hedge', 'a square trimmed green hedge'],
  ],
  props: [
    ['bench', 'a wooden park bench'],
    ['hydrant', 'a red fire hydrant'],
    ['dumpster', 'a green trash dumpster'],
    ['planter', 'a stone street planter with a plant'],
    ['picnic-table', 'a wooden picnic table'],
    ['bus-shelter', 'a glass bus stop shelter'],
  ],
  fauna: [
    ['pigeons', 'a small cluster of gray pigeons'],
    ['dog', 'a small brown dog'],
    ['gull', 'a white seagull'],
    ['cat', 'an orange cat'],
  ],
  smog: [
    ['smoke-gray', 'a soft puff of light gray smoke'],
    ['exhaust', 'a thin plume of dark exhaust haze'],
    ['smog-cloud', 'a hazy industrial smog cloud'],
  ],
};

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const concurrency = Number(arg('concurrency', '3'));
const onlyCats = arg('cat', '').split(',').filter(Boolean);

// Copy luminance → alpha (smoke on black → transparent black, opaque highlights).
function luminanceToAlpha(buf) {
  return execFileSync(
    'magick',
    ['png:-', '(', '+clone', '-colorspace', 'Gray', ')', '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', 'png:-'],
    { input: buf, maxBuffer: 16 * 1024 * 1024 },
  );
}

const jobs = [];
for (const [cat, items] of Object.entries(CATALOG)) {
  if (onlyCats.length && !onlyCats.includes(cat)) continue;
  for (const [slug, subject] of items) jobs.push({ cat, slug, subject });
}

let targets = jobs;
if (!force) targets = jobs.filter(({ cat, slug }) => !existsSync(join(OUT, cat, `${slug}.png`)));

console.log(`ComfyUI: ${COMFY_URL}`);
console.log(`ambient bake: ${targets.length}/${jobs.length} sprites (concurrency ${concurrency})`);

let done = 0, failed = 0;
async function worker(queue) {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const { cat, slug, subject } = job;
    try {
      const isSmog = cat === 'smog';
      const prompt = isSmog ? `${subject}, ${SMOG_FRAME}` : `${subject}, ${TOPDOWN}`;
      const seed = seedFor(`ambient-${cat}-${slug}`, 'ambient');
      const out = await awaitOutput(await submit(buildTxt2imgGraph({ prompt, seed })), { timeoutMs: 180000 });
      const raw = await fetchImage(out);
      const png = isSmog ? luminanceToAlpha(raw) : whiteToAlpha(raw, 16);
      mkdirSync(join(OUT, cat), { recursive: true });
      writeFileSync(join(OUT, cat, `${slug}.png`), png);
      done++;
      console.log(`✓ ${cat}/${slug}  [${done}/${targets.length}]`);
    } catch (e) {
      failed++;
      console.error(`✗ ${cat}/${slug}: ${e.message}`);
    }
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker(queue)));
console.log(`\ndone: ${done} sprites, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
