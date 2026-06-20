// Bake the satellite tileset: run procedural control tiles through the Z-Image Tile-ControlNet
// graph and write styled PNGs to public/tilesets/satellite/<cat>/<key>.png. Resumable (skips
// existing outputs unless --force). Roads/transport are deliberately EXCLUDED — Maddy's design is
// procedural lane lines over a diffused asphalt SURFACE, not per-mask diffusion (docs §5.5).
//
//   node tools/tileset/generate.mjs [--cat terrain,building] [--keys k1,k2] [--limit N]
//                                   [--concurrency N] [--force] [--dry]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTile, COMFY_URL, CN_STRENGTH_BUILDING, CN_STRENGTH_TERRAIN, LORA } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CONTROL = join(HERE, 'control');
const OUT_ROOT = join(REPO, 'public/tilesets/satellite');
const OUT_DIR = { terrain: join(OUT_ROOT, 'terrain'), building: join(OUT_ROOT, 'buildings') };

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const cats = arg('cat', 'terrain,building').split(',');
const onlyKeys = arg('keys', '')?.split(',').filter(Boolean);
const limit = Number(arg('limit', '0'));
const concurrency = Number(arg('concurrency', '2'));
const force = has('force');
const dry = has('dry');

const manifest = JSON.parse(readFileSync(join(CONTROL, 'manifest.json'), 'utf8'));
const outPath = (m) => join(OUT_DIR[m.category], m.file);

let targets = manifest.filter((m) => OUT_DIR[m.category]); // only diffusable categories
if (onlyKeys.length) targets = targets.filter((m) => onlyKeys.includes(m.key));
else targets = targets.filter((m) => cats.includes(m.category));
if (!force) targets = targets.filter((m) => !existsSync(outPath(m)));
if (limit > 0) targets = targets.slice(0, limit);

for (const d of Object.values(OUT_DIR)) mkdirSync(d, { recursive: true });

console.log(`ComfyUI: ${COMFY_URL}`);
console.log(`config: structure-only CN  LoRA=${LORA}  CN_strength building=${CN_STRENGTH_BUILDING} terrain=${CN_STRENGTH_TERRAIN}`);
console.log(`baking ${targets.length} tiles (cat=${cats.join(',')}${onlyKeys.length ? ` keys=${onlyKeys.join(',')}` : ''}, concurrency=${concurrency}${dry ? ', DRY' : ''})`);
if (dry) { for (const m of targets) console.log(`  would bake ${m.category}/${m.file}`); process.exit(0); }

let done = 0, failed = 0;
const t0 = Date.now();

async function worker(queue) {
  for (;;) {
    const m = queue.shift();
    if (!m) return;
    const label = `${m.category}/${m.key}`;
    try {
      const controlBuf = readFileSync(join(CONTROL, m.file));
      const png = await generateTile({ key: m.key, category: m.category, tiling: m.tiling, controlBuf, controlName: m.file });
      writeFileSync(outPath(m), png);
      done++;
      const rate = (Date.now() - t0) / 1000 / done;
      console.log(`✓ ${label}  [${done}/${targets.length}]  ~${rate.toFixed(1)}s/tile`);
    } catch (e) {
      failed++;
      console.error(`✗ ${label}: ${e.message}`);
    }
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker(queue)));
console.log(`\ndone: ${done} baked, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
process.exit(failed > 0 ? 1 : 0);
