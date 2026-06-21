// DIFFUSION-BASED LIGHTING MAPS for sprite assets (Maddy 2026-06-20 — "our prototype for
// diffusion-based lighting"). For each light-bearing sprite we generate a `<slug>-lights.png`
// EMISSION map the renderer draws additively, evading day/night shading (full-bright at night),
// with optional blink cycling (the cruiser's red/blue bar, aviation lights).
//
// METHOD — the inpaint reframe that killed the "keep the albedo" bias:
//   1. SHAPE: take the baked albedo's own alpha → a white-on-black silhouette MASK (512²).
//   2. INIT: a pure-black canvas. Outside the mask stays black → transparent in the map.
//   3. INPAINT: diffuse the asset's OWN subject + top-down orientation + an emission clause into the
//      masked region (so lights land in the right place, facing the same way as the albedo — which
//      matters because directional sprites are rotated to heading). LoRA + PixelOE match the grid.
//   4. ISOLATE (emissionToAlpha): saturation boost → alpha from MAX-channel brightness (NOT luminance —
//      saturated red/blue have low luminance and would be keyed away) → level black-point drops the
//      dark body, leaving only the glowing lights.
//
//   node tools/tileset/lights.mjs [--slug cruiser] [--force]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { uploadImage, submit, awaitOutput, fetchImage, LORA, COMFY_URL } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../..', 'public/sprites/ambient');
const mg = (args, input) => execFileSync('magick', args, { input, maxBuffer: 64 * 1024 * 1024 });

// Each entry: where the albedo lives + the FULL light-map prompt (the asset's own subject + top-down
// orientation so the lights match the albedo, then the emission clause). `blink` is a renderer hint.
const EMISSION =
  ' Emission map at night: ONLY the lights emit; the body, roof and everything else are pure solid ' +
  'black background. High-contrast points of colored light glowing in darkness with soft glow halos.';
const LIGHTS = [
  {
    cat: 'police', slug: 'cruiser', seed: 70077,
    prompt:
      'A black police car sedan seen from directly above, roof visible, one bright glowing RED light ' +
      'and one bright glowing BLUE light on the rooftop light bar, small warm white headlights at the ' +
      'FRONT (top) edge.' + EMISSION,
  },
];

// Build the white-on-black shape mask from the albedo's alpha (the region to inpaint).
function shapeMask(albedoBuf, g = 512) {
  return mg(['png:-', '-alpha', 'extract', '-resize', `${g}x${g}`, '-threshold', '20%', 'png:-'], albedoBuf);
}
// Emission → alpha: saturation boost, then alpha from MAX-channel brightness with a level black-point.
function emissionToAlpha(buf) {
  return mg(['png:-', '-modulate', '100,140,100',
    '(', '+clone', '-separate', '-evaluate-sequence', 'max', '-level', '22%,88%', ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', 'png:-'], buf);
}

// Inpaint graph: black init + shape mask → diffuse the prompt into the shape (LoRA + PixelOE 32→16px).
function lightGraph({ initName, maskName, prompt, seed }) {
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
    12: { class_type: 'PixelOE', inputs: { pixel_size: 32, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'lightmap', images: ['12', 0] } },
  };
}

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const onlySlug = arg('slug', '');
const init512 = mg(['-size', '512x512', 'xc:black', 'png:-']);

console.log(`ComfyUI: ${COMFY_URL}`);
let done = 0, failed = 0;
for (const job of LIGHTS) {
  if (onlySlug && job.slug !== onlySlug) continue;
  const albedo = join(OUT, job.cat, `${job.slug}.png`);
  const dst = join(OUT, job.cat, `${job.slug}-lights.png`);
  if (!existsSync(albedo)) { console.error(`✗ ${job.cat}/${job.slug}: no albedo`); failed++; continue; }
  if (existsSync(dst) && !force) { console.log(`· ${job.cat}/${job.slug}-lights exists (skip)`); continue; }
  try {
    const maskName = await uploadImage(shapeMask(readFileSync(albedo)), `${job.slug}-mask.png`);
    const initName = await uploadImage(init512, `${job.slug}-init.png`);
    const out = await awaitOutput(await submit(lightGraph({ initName, maskName, prompt: job.prompt, seed: job.seed })), { timeoutMs: 180000 });
    const lit = emissionToAlpha(await fetchImage(out));
    mkdirSync(join(OUT, job.cat), { recursive: true });
    writeFileSync(dst, lit);
    done++;
    console.log(`✓ ${job.cat}/${job.slug}-lights`);
  } catch (e) {
    failed++;
    console.error(`✗ ${job.cat}/${job.slug}: ${e.message}`);
  }
}
console.log(`\ndone: ${done} light maps, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
