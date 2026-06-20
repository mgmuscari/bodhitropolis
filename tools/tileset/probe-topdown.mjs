// Decisive probe: can a DESATURATED flat init latent force TOP-DOWN buildings without color bleed?
// txt2img → isometric (LoRA bias). Structural conditioning on a FLAT init forces flat/top-down;
// desaturating it removes the color bleed that broke it before. img2img from the grayscale procedural
// tile, denoise ~0.72 → top-down geometry (flat init) + color from prompt (gray init = no hue).
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { submit, awaitOutput, fetchImage, uploadImage, promptFor, seedFor, LORA } from './lib.mjs';

const OUT = '/tmp/ts_topdown';
mkdirSync(OUT, { recursive: true });
const DENOISE = Number(process.env.D ?? 0.72);

function img2img({ initName, prompt, seed }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'ZImageLoraAutoLoader', inputs: { lora_name: 'pixel_art_style_z_image_turbo.safetensors', global_strength: LORA, model: ['1', 0] } },
    4: { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: ['2', 0] } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
    17: { class_type: 'LoadImage', inputs: { image: initName } },
    18: { class_type: 'ImageScale', inputs: { upscale_method: 'bilinear', width: 512, height: 512, crop: 'disabled', image: ['17', 0] } },
    21: { class_type: 'VAEEncode', inputs: { pixels: ['18', 0], vae: ['6', 0] } },
    10: { class_type: 'KSampler', inputs: { seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: DENOISE, model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['21', 0] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'PixelOE', inputs: { pixel_size: 32, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'bodhitop', images: ['12', 0] } },
  };
}

for (const key of process.argv.slice(2)) {
  // BLACK footprint on white (Maddy: "empty means black in initial latent — leave parts you want
  // diffused black"). The building diffuses into the black region (flat, constrained — no iso
  // platform); the white surround is kept → floodfilled to alpha. Outline gives a footprint edge.
  const init = execFileSync('magick', ['-size', '512x512', 'xc:white', '-fill', 'black', '-draw',
    'roundrectangle 56,56,456,456,24,24', 'png:-'], { maxBuffer: 16 * 1024 * 1024 });
  const initName = await uploadImage(init, `blackfp-${key}.png`);
  const graph = img2img({ initName, prompt: promptFor(key, 'building'), seed: seedFor(key, 'building') });
  const out = await awaitOutput(await submit(graph));
  writeFileSync(`${OUT}/${key}.png`, await fetchImage(out));
  console.log(`✓ ${key} (denoise ${DENOISE})`);
}
