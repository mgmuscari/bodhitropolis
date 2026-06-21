// DIFFUSION-BASED LIGHTING MAPS for game assets (Maddy 2026-06-20 — "our prototype for
// diffusion-based lighting"; "you missed ALL THE BUILDINGS"). Emission map LAYERS the renderer draws
// additively, evading day/night shading. Covers ambient SPRITES (vehicles, cruiser, encampments) AND
// every relevant BUILDING (lit windows night-gated; aviation beacons + glow on power plants), so the
// city lights up at night instead of reading as a dark grid.
//
// LAYERS, not one combined map: each is its OWN diffusion pass with its OWN prompt → a clean map.
//   • out:'lights' → STATIC glow (furnace, windows, headlights). Windows are night-gated by the renderer.
//   • out:'blink'  → HAZARD beacons (red aviation/emergency). Renderer blinks per-instance.
//
// METHOD per layer — the inpaint reframe: albedo alpha → black-init INPAINT of ONLY this layer's lights
// → PixelOE to the grid → isolate by MAX-channel brightness. JUDGE the PixelOE output, not the raw.
// Buildings auto-scan the atlas (1×1 `b-K-c` + multitile `b-K-WxH`); a manifest lists what was baked.
//
//   node tools/tileset/lights.mjs [--slug coal|cruiser|...] [--only buildings|sprites] [--force]
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { uploadImage, submit, awaitOutput, fetchImage, LORA, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRITES = resolve(HERE, '../..', 'public/sprites/ambient');
const BUILDINGS = resolve(HERE, '../..', 'public/tilesets/satellite/buildings');
const mg = (args, input) => execFileSync('magick', args, { input, maxBuffer: 64 * 1024 * 1024 });

const EMIT = ' Emission map at night on a pure solid black background: ONLY the named lights glow, ' +
  'everything else is pure black. High-contrast points of colored light with soft glow halos. isometric';
const TOPDOWN_CAR = 'seen from directly above, top-down, orthographic. The FRONT of the vehicle points UP.';
const TOPDOWN_GEN = 'seen from directly above, top-down, orthographic.';
const WINDOWS = `A building ${TOPDOWN_GEN} BRIGHT glowing warm-yellow and pale-white lit windows in rows across the whole rooftop and facade, many lights, strongly lit.${EMIT}`;
const POWER_GLOW = `An industrial power plant ${TOPDOWN_GEN} A warm orange machinery glow and a few dim lit windows, NO red lights.${EMIT}`;
const POWER_BLINK = `An industrial power plant with tall structures ${TOPDOWN_GEN} Two or more bright glowing RED aviation warning lights on the tall structures, NOTHING else lit (no orange, no windows).${EMIT}`;

// ── Sprite catalog (16px, gen 512 / PixelOE 32) ──────────────────────────────────────────────────
const SPRITE_LIGHTS = [
  { slug: 'cruiser', cat: 'police', layers: [{ out: 'lights', seed: 70077, prompt: `A police car ${TOPDOWN_CAR} One glowing RED light and one glowing BLUE light on the rooftop light bar, small warm white headlights at the front.${EMIT}` }] },
  ...['sedan-red', 'hatchback-blue', 'pickup-white', 'taxi-yellow', 'suv-green', 'van-silver', 'boxtruck'].map((slug, i) => ({
    slug, cat: 'cars', layers: [{ out: 'lights', seed: 31000 + i * 131, prompt: `A car ${TOPDOWN_CAR} Two small warm white headlights at the FRONT (top) edge and two small red taillights at the REAR (bottom) edge.${EMIT}` }],
  })),
  { slug: 'bus-city', cat: 'cars', layers: [{ out: 'lights', seed: 32100, prompt: `A long city transit bus ${TOPDOWN_CAR} A row of small lit warm-yellow windows down each side, two warm white headlights at the FRONT (top) edge, red taillights at the REAR.${EMIT}` }] },
  ...['cyclist-1', 'cyclist-2'].map((slug, i) => ({ slug, cat: 'cyclists', layers: [{ out: 'lights', seed: 33000 + i * 211, prompt: `A bicycle ${TOPDOWN_CAR} One small white headlight at the FRONT and one small red tail light at the REAR.${EMIT}` }] })),
  ...['tent-1', 'tent-2', 'tent-3'].map((slug, i) => ({ slug, cat: 'encampments', layers: [{ out: 'lights', seed: 34000 + i * 151, prompt: `A small camping tent ${TOPDOWN_GEN} A warm glowing orange campfire and a small lantern light beside the tent entrance.${EMIT}` }] })),
  { slug: 'bus-shelter', cat: 'props', layers: [{ out: 'lights', seed: 35000, prompt: `A bus stop shelter ${TOPDOWN_GEN} A dim warm-white interior ceiling light.${EMIT}` }] },
].map((j) => ({ type: 'sprite', ...j }));

// ── Building archetypes ──────────────────────────────────────────────────────────────────────────
const POWER_BEACON = new Set([24, 25, 27, 30]); // coal/gas/nuclear/fusion → glow + red aviation beacons
// Lit windows (residential/commercial/civic/services/industrial/eco-with-structure + minor power).
const WINDOW_KINDS = new Set([16, 17, 18, 19, 20, 21, 23, 26, 28, 29, 31, 32, 33, 34, 35, 51, 54, 55, 56, 57, 58, 59, 60]);

// Scan the atlas → one job per distinct build FORM (1×1 `b-K-c` + multitile `b-K-WxH`), tier 0.
function buildingJobs() {
  const files = readdirSync(BUILDINGS);
  const forms = new Map(); // stem → { kind, w, h, oneByOne }
  for (const f of files) {
    let m;
    if ((m = /^b-(\d+)-(\d+)x(\d+)-c0-r0-0\.png$/.exec(f))) {
      forms.set(`b-${m[1]}-${m[2]}x${m[3]}`, { kind: +m[1], w: +m[2], h: +m[3] });
    } else if ((m = /^b-(\d+)-c-0(?:-v1)?\.png$/.exec(f))) {
      const stem = `b-${m[1]}-c`;
      if (!forms.has(stem)) forms.set(stem, { kind: +m[1], w: 1, h: 1, oneByOne: true });
    }
  }
  const jobs = [];
  for (const [stem, fp] of forms) {
    const power = POWER_BEACON.has(fp.kind);
    if (!power && !WINDOW_KINDS.has(fp.kind)) continue; // open/green/no-light kinds skipped
    const layers = power
      ? [{ out: 'lights', seed: hashSeed(stem) + 1, prompt: POWER_GLOW }, { out: 'blink', seed: hashSeed(stem) + 2, prompt: POWER_BLINK }]
      : [{ out: 'lights', seed: hashSeed(stem) + 1, prompt: WINDOWS }];
    jobs.push({ type: 'building', slug: stem, stem, ...fp, layers });
  }
  return jobs;
}
function hashSeed(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

// Stitch a building's tier-0 footprint cells (multitile) or read the single 1×1 cell (prefer v1).
function buildingAlbedo(fp, stem) {
  if (fp.oneByOne) {
    const v1 = join(BUILDINGS, `b-${fp.kind}-c-0-v1.png`);
    return readFileSync(existsSync(v1) ? v1 : join(BUILDINGS, `b-${fp.kind}-c-0.png`));
  }
  const rows = [];
  for (let r = 0; r < fp.h; r++) {
    const cols = [];
    for (let c = 0; c < fp.w; c++) cols.push(join(BUILDINGS, `${stem}-c${c}-r${r}-0.png`));
    rows.push(['(', ...cols, '+append', ')']);
  }
  return mg([...rows.flat(), '-append', '-background', 'none', 'png:-']);
}

// White-on-black shape mask from the albedo's alpha (the inpaint region).
const shapeMask = (albedoBuf, gw, gh) => mg(['png:-', '-alpha', 'extract', '-resize', `${gw}x${gh}!`, '-threshold', '20%', 'png:-'], albedoBuf);
// Emission → alpha: saturation boost, then alpha from MAX-channel brightness with a level black-point.
// `black` is the level black-point — lower keeps DIMMER lights (small 1×1 buildings need this or their
// tiny windows get keyed away to nothing).
const emissionToAlpha = (buf, black = '22%') => mg(['png:-', '-modulate', '100,140,100',
  '(', '+clone', '-separate', '-evaluate-sequence', 'max', '-level', `${black},90%`, ')',
  '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', 'png:-'], buf);

function lightGraph({ initName, maskName, prompt, seed, pixel }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'ZImageLoraAutoLoader', inputs: { lora_name: 'pixel_art_style_z_image_turbo.safetensors', global_strength: LORA, model: ['1', 0] } },
    4: { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: ['2', 0] } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
    17: { class_type: 'LoadImage', inputs: { image: initName } },
    19: { class_type: 'LoadImageMask', inputs: { image: maskName, channel: 'red' } },
    21: { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['17', 0], vae: ['6', 0], mask: ['19', 0], grow_mask_by: 6 } },
    10: { class_type: 'KSampler', inputs: { seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['21', 0] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'PixelOE', inputs: { pixel_size: pixel, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'lightmap', images: ['12', 0] } },
  };
}

// Resolve a job → albedo buffer + base path (no suffix) + generation res + pixel size.
function resolveJob(job) {
  if (job.type === 'building') {
    if (job.oneByOne) return { albedo: buildingAlbedo(job, job.stem), base: join(BUILDINGS, job.stem), gw: 512, gh: 512, pixel: 32, label: job.stem };
    return { albedo: buildingAlbedo(job, job.stem), base: join(BUILDINGS, job.stem), gw: job.w * 256, gh: job.h * 256, pixel: 16, label: job.stem };
  }
  return { albedo: readFileSync(join(SPRITES, job.cat, `${job.slug}.png`)), base: join(SPRITES, job.cat, job.slug), gw: 512, gh: 512, pixel: 32, label: `${job.cat}/${job.slug}` };
}

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const onlySlug = arg('slug', '');
const only = arg('only', ''); // 'buildings' | 'sprites'

let LIGHTS = [...SPRITE_LIGHTS, ...buildingJobs()];
if (only === 'sprites') LIGHTS = LIGHTS.filter((j) => j.type === 'sprite');
if (only === 'buildings') LIGHTS = LIGHTS.filter((j) => j.type === 'building');
if (onlySlug) LIGHTS = LIGHTS.filter((j) => j.slug === onlySlug);

console.log(`ComfyUI: ${COMFY_URL}\n${LIGHTS.length} assets`);
let done = 0, failed = 0;
for (const job of LIGHTS) {
  let r;
  try { r = resolveJob(job); } catch (e) { console.error(`✗ ${job.slug}: ${e.message}`); failed++; continue; }
  const layers = job.layers.filter((l) => force || !existsSync(`${r.base}-${l.out}.png`));
  if (layers.length === 0) { console.log(`· ${r.label} (exists)`); continue; }
  try {
    mkdirSync(dirname(r.base), { recursive: true });
    const maskName = await uploadImage(shapeMask(r.albedo, r.gw, r.gh), `lm-${job.slug}-mask.png`);
    const initName = await uploadImage(mg(['-size', `${r.gw}x${r.gh}`, 'xc:black', 'png:-']), `lm-${job.slug}-init.png`);
    const black = job.type === 'building' ? '9%' : '22%'; // buildings: keep dim windows (esp. tiny 1×1)
    for (const layer of layers) {
      const out = await awaitOutput(await submit(lightGraph({ initName, maskName, prompt: layer.prompt, seed: layer.seed, pixel: r.pixel })), { timeoutMs: 180000 });
      writeFileSync(`${r.base}-${layer.out}.png`, emissionToAlpha(await fetchImage(out), black));
      console.log(`✓ ${r.label}-${layer.out}`);
      done++;
    }
  } catch (e) { failed++; console.error(`✗ ${job.slug}: ${e.message}`); }
}

// Manifest of building light maps (the browser loader can't readdir) — scan ALL committed `-lights`.
const manifest = {};
for (const f of readdirSync(BUILDINGS)) {
  const m = /^(b-\d+-(?:c|\d+x\d+))-lights\.png$/.exec(f);
  if (m) manifest[m[1]] = { blink: existsSync(join(BUILDINGS, `${m[1]}-blink.png`)) };
}
writeFileSync(join(BUILDINGS, 'lights-manifest.json'), JSON.stringify(manifest));
console.log(`\ndone: ${done} layers, ${failed} failed · manifest: ${Object.keys(manifest).length} buildings`);
process.exit(failed > 0 ? 1 : 0);
