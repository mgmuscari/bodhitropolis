// DIFFUSION-BASED LIGHTING MAPS for game assets (Maddy 2026-06-20 — "our prototype for
// diffusion-based lighting"). For each light-bearing asset we generate EMISSION map LAYERS the
// renderer draws additively, evading day/night shading.
//
// LAYERS, not one combined map (Maddy: a single bake split by color leaves the glow entangled with
// the hazard beacons). Each layer is its OWN diffusion pass with its OWN prompt → a clean map:
//   • out:'lights' → STATIC glow (furnace, windows, headlights) — renderer draws it steady.
//   • out:'blink'  → HAZARD beacons (red aviation/emergency) — renderer blinks it per-instance.
//
// METHOD per layer — the inpaint reframe that killed the "keep the albedo" bias:
//   1. SHAPE: the baked albedo's own alpha → a white-on-black silhouette MASK (shared by all layers).
//   2. INIT: a pure-black canvas → outside the mask stays black → transparent in the map.
//   3. INPAINT: diffuse ONLY this layer's lights into the masked region. Pixel-art LoRA + `isometric`
//      positive (the LoRA is iso-trained; naming it stabilizes the render) + PixelOE to the grid —
//      JUDGE the PixelOE output, not the raw.
//   4. ISOLATE: saturation boost → alpha from MAX-channel brightness (not luminance — saturated red has
//      low luminance) → level black-point drops the dark body, leaving the glowing lights.
//
//   node tools/tileset/lights.mjs [--slug cruiser|coal|...] [--force]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
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

// Each entry has `layers: [{ out, seed, prompt }]`. `out` ∈ {'lights' (static), 'blink' (hazard)} →
// the `<base>-<out>.png` filename + the renderer's draw mode. type 'sprite' (16px, gen 512 / PixelOE 32)
// or 'building' (footprint² atlas cells stitched, gen footprint·256 / PixelOE 16).
const LIGHTS = [
  // Police cruiser keeps a SINGLE map (the renderer's red/blue half-split alternation drives the bar).
  { type: 'sprite', slug: 'cruiser', cat: 'police', layers: [
    { out: 'lights', seed: 70077, prompt: `A police car ${TOPDOWN_CAR} One glowing RED light and one glowing BLUE light on the rooftop light bar, small warm white headlights at the front.${EMIT}` },
  ] },
  // Coal plant: SEPARATE passes — static orange furnace/window glow + blinking red aviation beacons.
  { type: 'building', slug: 'coal', build: 'b-24-3x3', footprint: 3, tier: 0, layers: [
    { out: 'lights', seed: 24024, prompt: 'A coal power plant with two tall smokestacks seen from directly above, orthographic top-down. A hot glowing ORANGE furnace glow in the centre and a few tiny dim warm-yellow lit windows, NO red lights.' + EMIT },
    { out: 'blink', seed: 24090, prompt: 'A coal power plant with two tall smokestacks seen from directly above, orthographic top-down. Two bright glowing RED aviation warning lights, one on top of each tall smokestack, and NOTHING else lit (no orange, no windows).' + EMIT },
  ] },
  // ── Vehicles: warm white headlights at the front, red taillights at the rear (STATIC, night-only). ──
  ...['sedan-red', 'hatchback-blue', 'pickup-white', 'taxi-yellow', 'suv-green', 'van-silver', 'boxtruck'].map((slug, i) => ({
    type: 'sprite', slug, cat: 'cars', layers: [
      { out: 'lights', seed: 31000 + i * 131, prompt: `A car ${TOPDOWN_CAR} Two small warm white headlights at the FRONT (top) edge and two small red taillights at the REAR (bottom) edge.${EMIT}` },
    ],
  })),
  { type: 'sprite', slug: 'bus-city', cat: 'cars', layers: [
    { out: 'lights', seed: 32100, prompt: `A long city transit bus ${TOPDOWN_CAR} A row of small lit warm-yellow windows down each side, two warm white headlights at the FRONT (top) edge, red taillights at the REAR.${EMIT}` },
  ] },
  ...['cyclist-1', 'cyclist-2'].map((slug, i) => ({
    type: 'sprite', slug, cat: 'cyclists', layers: [
      { out: 'lights', seed: 33000 + i * 211, prompt: `A bicycle ${TOPDOWN_CAR} One small white headlight at the FRONT and one small red tail light at the REAR.${EMIT}` },
    ],
  })),
];

// Stitch a building's tier-0 footprint² atlas cells into one albedo (row-major append).
function stitchBuilding(build, footprint, tier) {
  const rows = [];
  for (let r = 0; r < footprint; r++) {
    const cols = [];
    for (let c = 0; c < footprint; c++) cols.push(join(BUILDINGS, `${build}-c${c}-r${r}-${tier}.png`));
    rows.push(['(', ...cols, '+append', ')']);
  }
  return mg([...rows.flat(), '-append', '-background', 'none', 'png:-']);
}
// White-on-black shape mask from the albedo's alpha (the inpaint region).
const shapeMask = (albedoBuf, g) => mg(['png:-', '-alpha', 'extract', '-resize', `${g}x${g}`, '-threshold', '20%', 'png:-'], albedoBuf);
// Emission → alpha: saturation boost, then alpha from MAX-channel brightness with a level black-point.
const emissionToAlpha = (buf) => mg(['png:-', '-modulate', '100,140,100',
  '(', '+clone', '-separate', '-evaluate-sequence', 'max', '-level', '22%,88%', ')',
  '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', 'png:-'], buf);

// Inpaint graph: black init + shape mask → diffuse the prompt into the shape; PixelOE to the grid.
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

// Resolve a job → albedo buffer + base path (no suffix) + generation res, for sprite or building.
function resolveJob(job) {
  if (job.type === 'building') {
    return { albedo: stitchBuilding(job.build, job.footprint, job.tier), base: join(BUILDINGS, job.build), gen: job.footprint * 256, pixel: 16, label: job.build };
  }
  return { albedo: readFileSync(join(SPRITES, job.cat, `${job.slug}.png`)), base: join(SPRITES, job.cat, job.slug), gen: 512, pixel: 32, label: `${job.cat}/${job.slug}` };
}

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const onlySlug = arg('slug', '');

console.log(`ComfyUI: ${COMFY_URL}`);
let done = 0, failed = 0;
for (const job of LIGHTS) {
  if (onlySlug && job.slug !== onlySlug) continue;
  let r;
  try { r = resolveJob(job); } catch (e) { console.error(`✗ ${job.slug}: ${e.message}`); failed++; continue; }
  const layers = job.layers.filter((l) => force || !existsSync(`${r.base}-${l.out}.png`));
  if (layers.length === 0) { console.log(`· ${r.label} (all layers exist, skip)`); continue; }
  try {
    mkdirSync(dirname(r.base), { recursive: true });
    const maskName = await uploadImage(shapeMask(r.albedo, r.gen), `lm-${job.slug}-mask.png`);
    const initName = await uploadImage(mg(['-size', `${r.gen}x${r.gen}`, 'xc:black', 'png:-']), `lm-${job.slug}-init.png`);
    for (const layer of layers) {
      const out = await awaitOutput(await submit(lightGraph({ initName, maskName, prompt: layer.prompt, seed: layer.seed, pixel: r.pixel })), { timeoutMs: 180000 });
      writeFileSync(`${r.base}-${layer.out}.png`, emissionToAlpha(await fetchImage(out)));
      console.log(`✓ ${r.label}-${layer.out}`);
      done++;
    }
  } catch (e) {
    failed++;
    console.error(`✗ ${job.slug}: ${e.message}`);
  }
}
console.log(`\ndone: ${done} layers, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
