// Explode the export-harness dump (window.bodhitropolis.exportTiles(), pulled via
// Playwright) into one control PNG per atlas key + a manifest. These tiny native-16×16
// PNGs are the structural ControlNet guides the generator feeds to ComfyUI.
//
//   node tools/tileset/split-control.mjs [dump.json]
//
// Writes:  tools/tileset/control/<key>.png         (decoded control tiles)
//          tools/tileset/control/manifest.json      ([{ key, file, category, tiling }])
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const dumpPath = process.argv[2] ?? join(REPO, 'tileset-control-dump.json');
const outDir = join(HERE, 'control');
mkdirSync(outDir, { recursive: true });

// Playwright's browser_evaluate JSON-stringifies the result; our harness already
// returns a JSON string → the file is double-encoded. Unwrap until we hit the array.
let tiles = JSON.parse(readFileSync(dumpPath, 'utf8'));
if (typeof tiles === 'string') tiles = JSON.parse(tiles);
const manifest = [];
for (const t of tiles) {
  const b64 = t.png.replace(/^data:image\/png;base64,/, '');
  writeFileSync(join(outDir, t.file), Buffer.from(b64, 'base64'));
  manifest.push({ key: t.file.replace(/\.png$/, ''), file: t.file, category: t.category, tiling: t.tiling });
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const byCat = {};
for (const m of manifest) byCat[m.category] = (byCat[m.category] || 0) + 1;
console.log(`split ${manifest.length} control tiles → ${outDir}`);
console.log('by category:', JSON.stringify(byCat));
