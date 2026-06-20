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
import { isTopDown } from './validate.mjs';

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
    ['pickup-white', 'a teal pickup truck with an open cargo bed'], // not white — white floodfills to alpha
    ['taxi-yellow', 'a yellow taxi cab'],
    ['suv-green', 'a dark green SUV'],
    ['van-silver', 'a dark blue delivery van'], // not silver/white — light tones floodfill to alpha
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
  peds: [
    ['walk-1', 'a single person walking, just the head and shoulders from directly above'],
    ['walk-2', 'a single pedestrian in a red coat, head and shoulders from directly above'],
    ['walk-3', 'a single person in a blue jacket, head and shoulders from directly above'],
    ['walk-4', 'a single person in a yellow shirt, head and shoulders from directly above'],
  ],
  cyclists: [
    ['cyclist-1', 'a person riding a bicycle, rider and bike frame from directly above'],
    ['cyclist-2', 'a cyclist on a bicycle in a green jersey, from directly above'],
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
const validate = process.argv.includes('--validate'); // gate each sprite on the vision-model geometry check
const attempts = Number(arg('attempts', '5')); // seed retries when validation fails

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
      // With --validate, retry different seeds until the LMStudio vision model agrees the sprite is a
      // strict top-down view (smog is exempt — it has no orientation). Keeps the last attempt if none
      // pass (best-effort, logged), so a bake never hard-fails on geometry.
      const tries = validate && !isSmog ? attempts : 1;
      let raw, ok = !validate || isSmog, note = '';
      for (let a = 0; a < tries; a++) {
        const out = await awaitOutput(await submit(buildTxt2imgGraph({ prompt, seed: seed + a * 7919 })), { timeoutMs: 180000 });
        raw = await fetchImage(out);
        if (!validate || isSmog) break;
        const v = await isTopDown(raw, subject);
        ok = v.ok;
        note = v.text.split('\n')[0];
        if (ok) break;
      }
      const png = isSmog ? luminanceToAlpha(raw) : whiteToAlpha(raw, 16);
      mkdirSync(join(OUT, cat), { recursive: true });
      writeFileSync(join(OUT, cat, `${slug}.png`), png);
      done++;
      const tag = validate && !isSmog ? (ok ? '✓valid' : '⚠best-effort') : '';
      console.log(`✓ ${cat}/${slug} ${tag} [${done}/${targets.length}]${note ? ` — ${note}` : ''}`);
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
