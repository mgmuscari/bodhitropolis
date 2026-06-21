// DIFFUSION-BASED LIGHTING MAPS for game assets (Maddy 2026-06-20 — "our prototype for
// diffusion-based lighting"). For each light-bearing asset we generate an EMISSION map the renderer
// draws additively, evading day/night shading (full-bright at night), with always-on blink for
// emergency/aviation lights (cruiser bar, smokestack aviation beacons).
//
// METHOD — the inpaint reframe that killed the "keep the albedo" bias:
//   1. SHAPE: take the baked albedo's own alpha → a white-on-black silhouette MASK.
//   2. INIT: a pure-black canvas. Outside the mask stays black → transparent in the map.
//   3. INPAINT: diffuse the asset's subject + an emission clause into the masked region. Pixel-art
//      LoRA + `isometric` positive conditioning (Maddy: the LoRA was trained on iso game assets, so
//      naming it stabilizes the render) + PixelOE downscale to the asset grid — JUDGE the PixelOE
//      output, not the raw (the raw can look perspective; PixelOE + the pipeline is what ships).
//   4. ISOLATE (emissionToAlpha): saturation boost → alpha from MAX-channel brightness (NOT luminance —
//      saturated red/blue have low luminance and would be keyed away) → level black-point drops the
//      dark body, leaving only the glowing lights.
//
//   node tools/tileset/lights.mjs [--slug cruiser|coal] [--force]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { uploadImage, submit, awaitOutput, fetchImage, LORA, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRITES = resolve(HERE, '../..', 'public/sprites/ambient');
const BUILDINGS = resolve(HERE, '../..', 'public/tilesets/satellite/buildings');
const mg = (args, input) => execFileSync('magick', args, { input, maxBuffer: 64 * 1024 * 1024 });

const EMISSION =
  ' Emission map at night: ONLY the lights emit; the body, roof and everything else are pure solid ' +
  'black background. High-contrast points of colored light glowing in darkness with soft glow halos.';
const ISO = ' isometric'; // Maddy: the pixel-art LoRA is iso-trained; naming it stabilizes the render.

// type 'sprite': a 16px ambient sprite (gen 512, PixelOE 32). type 'building': a footprint² atlas
// building (stitch tier-0 cells → gen footprint·256, PixelOE 16 → footprint·16 px). `slug` is the
// CLI selector. `blink` is a renderer hint ('beacon' = red lights blink; default whole-map pulse).
const LIGHTS = [
  {
    type: 'sprite', slug: 'cruiser', cat: 'police', seed: 70077,
    prompt:
      'A black police car sedan seen from directly above, roof visible, one bright glowing RED light ' +
      'and one bright glowing BLUE light on the rooftop light bar, small warm white headlights at the ' +
      'FRONT (top) edge.' + EMISSION,
  },
  {
    type: 'building', slug: 'coal', build: 'b-24-3x3', footprint: 3, tier: 0, seed: 24024,
    prompt:
      'A coal power plant with two tall smokestacks seen from directly above, orthographic top-down. ' +
      'Bright glowing RED aviation warning lights on top of each of the two tall smokestacks, and a ' +
      'hot glowing ORANGE furnace glow in the centre.' + EMISSION + ISO,
  },
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
function shapeMask(albedoBuf, g) {
  return mg(['png:-', '-alpha', 'extract', '-resize', `${g}x${g}`, '-threshold', '20%', 'png:-'], albedoBuf);
}
// Emission → alpha: saturation boost, then alpha from MAX-channel brightness with a level black-point.
function emissionToAlpha(buf) {
  return mg(['png:-', '-modulate', '100,140,100',
    '(', '+clone', '-separate', '-evaluate-sequence', 'max', '-level', '22%,88%', ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', 'png:-'], buf);
}

// Inpaint graph: black init + shape mask → diffuse the prompt into the shape; PixelOE to the grid.
function lightGraph({ initName, maskName, prompt, seed, pixel }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'ZImageLoraAutoLoader', inputs: { lora_name: 'pixel_art_style_z_image_turbo.safetensors', global_strength: LORA, model: ['1', 0] } },
    4: { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: ['2', 0] } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } }, // cfg=1 turbo → neg unused
    17: { class_type: 'LoadImage', inputs: { image: initName } },
    19: { class_type: 'LoadImageMask', inputs: { image: maskName, channel: 'red' } },
    21: { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['17', 0], vae: ['6', 0], mask: ['19', 0], grow_mask_by: 6 } },
    10: { class_type: 'KSampler', inputs: { seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['21', 0] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'PixelOE', inputs: { pixel_size: pixel, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'lightmap', images: ['12', 0] } },
  };
}

// Resolve a job's albedo buffer + destination path + generation res, for sprite or building.
function resolveJob(job) {
  if (job.type === 'building') {
    const gen = job.footprint * 256, pixel = 16; // → footprint·16 px (matches the atlas cell grid)
    return { albedo: stitchBuilding(job.build, job.footprint, job.tier), dst: join(BUILDINGS, `${job.build}-lights.png`), gen, pixel, label: job.build };
  }
  return { albedo: readFileSync(join(SPRITES, job.cat, `${job.slug}.png`)), dst: join(SPRITES, job.cat, `${job.slug}-lights.png`), gen: 512, pixel: 32, label: `${job.cat}/${job.slug}` };
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
  if (existsSync(r.dst) && !force) { console.log(`· ${r.label}-lights exists (skip)`); continue; }
  try {
    const maskName = await uploadImage(shapeMask(r.albedo, r.gen), `${job.slug}-mask.png`);
    const initName = await uploadImage(mg(['-size', `${r.gen}x${r.gen}`, 'xc:black', 'png:-']), `${job.slug}-init.png`);
    const out = await awaitOutput(await submit(lightGraph({ initName, maskName, prompt: job.prompt, seed: job.seed, pixel: r.pixel })), { timeoutMs: 180000 });
    const lit = emissionToAlpha(await fetchImage(out));
    mkdirSync(dirname(r.dst), { recursive: true });
    writeFileSync(r.dst, lit);
    done++;
    console.log(`✓ ${r.label}-lights`);
  } catch (e) {
    failed++;
    console.error(`✗ ${job.slug}: ${e.message}`);
  }
}
console.log(`\ndone: ${done} light maps, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
