// Shared driver lib for the satellite-tileset GENERATOR (docs/art/satellite-tileset.md §5.6).
// Drives the remote ComfyUI **structure-only** Z-Image Tile-ControlNet graph (validated server-side
// as `z_image_tile_struct.json`, mirrored locally as `workflow.api.json`): each procedural atlas
// tile is de-dithered + DESATURATED into a grayscale SHAPE map, the Tile-ControlNet locks that
// shape, and the prompt supplies ALL color/texture from an EMPTY latent. Procedural owns STRUCTURE +
// game semantics; diffusion owns STYLE (Maddy 2026-06-19: "controlnet for structure only" — the
// color was bleeding through, the house was "the same red square scrambled").
//
// The MCP enqueue_workflow tool is broken for arbitrary graphs, so we load the API graph and POST it
// straight to /prompt, patching the documented node IDs per tile:
//   node 7  CLIPTextEncode.text  (prompt → all color)   node 17 LoadImage.image  (control reference)
//   node 3  SeamlessTile.tiling  (enable terrain / disable buildings)
//   node 22 ZImageFunControlnet.strength  (shape-lock)   node 10 KSampler.seed
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = JSON.parse(readFileSync(join(HERE, 'workflow.api.json'), 'utf8'));

export const COMFY_URL = (process.env.COMFYUI_URL ?? 'https://comfyui.tailea7e08.ts.net').replace(/\/$/, '');
export const CLIENT_ID = 'bodhi-tileset-gen';

// Tile-ControlNet shape-lock strength, per category. Buildings have real structure to hold (0.55);
// terrain's de-dithered shape map is near-flat, so a light lock keeps it prompt-driven + tileable.
export const CN_STRENGTH_BUILDING = Number(process.env.TS_CN ?? 0.55);
export const CN_STRENGTH_TERRAIN = Number(process.env.TS_CN_TERRAIN ?? 0.3);
export const LORA = Number(process.env.TS_LORA ?? 1.0); // pixel-art LoRA global strength (node 2)

// ── Prompt table ────────────────────────────────────────────────────────────────────────────
// Style is built from a category suffix; the subject comes from the terrain kind or building kind.
// Oakland architectural cues; top-down orthographic; pixel-art LoRA trigger leads. Negative is
// unused (cfg=1 turbo zeroes it), so only the positive matters.

const TERRAIN_SUFFIX =
  'seamless tileable texture, no border, fills edge to edge, top-down aerial map tile, flat overhead, ' +
  'no perspective, slightly cartoonish, flat even lighting, no shadows, vibrant 16-bit city-builder, Oakland California';

// Buildings are transparent OBJECTS composited over the ground tile (white background → alpha, so
// they sit on asphalt / grass / whatever is beneath — Maddy 2026-06-19). So prompt them ISOLATED on
// plain white, centered and filling most of the tile — NOT painting their own ground (the terrain
// supplies that). The flat white background is what whiteToAlpha() floodfills away.
const BUILDING_SUFFIX =
  'seen from directly straight above, top-down, the building centered and filling most of the frame, ' +
  'isolated on a plain solid white background, bold black outline, slightly cartoonish, flat even ' +
  'lighting, no drop shadow, no perspective, pixel art, 16-bit city-builder, Oakland California';

// Terrain kind (the `${kind}` of `${kind}-${band}`) → subject.
const TERRAIN_SUBJECT = {
  ocean: 'deep ocean bay water, blue-green, gentle ripples',
  lake: 'calm freshwater lake, still blue surface',
  river: 'flowing river water, blue-green current',
  bare: 'bare dry dirt ground, packed soil, sparse gravel',
  meadow: 'wild meadow, tall golden grass, scattered wildflowers',
  grass: 'lush green grass lawn, healthy parkland turf',
  forest: 'dense green tree canopy treetops, forest from above',
};

// Building kind code → subject (Oakland cues; roof-from-above framing comes from the suffix).
const BUILDING_SUBJECT = {
  16: 'a single Victorian craftsman bungalow with a gabled roof and small yard',
  17: 'a stucco apartment block with a flat roof and rooftop vents',
  18: 'a mid-century concrete housing project block with a flat roof',
  19: 'a low commercial strip of storefronts with flat roofs',
  20: 'a downtown office building, flat roof with rooftop HVAC units',
  21: 'an industrial warehouse, corrugated metal roof with vents',
  22: 'an asphalt parking lot with painted stalls and a few cars',
  23: 'a civic hall building with a formal roof and plaza',
  31: 'a police precinct building roof',
  32: 'a fire station with a red roof and apparatus bay',
  33: 'a small medical clinic building roof',
  34: 'a public library building roof',
  35: 'a school building with a yard',
  24: 'a coal power plant with dark smokestacks',
  25: 'a gas power plant with storage tanks and pipes',
  26: 'a hydroelectric plant with water channels and turbines',
  27: 'a nuclear power plant with a cooling tower',
  28: 'a white wind turbine over a green field',
  29: 'a blue solar panel array',
  30: 'a sleek futuristic fusion power plant',
  48: 'a tiny urban parklet with benches and planters',
  49: 'a community garden with raised beds and green plots',
  50: 'a compost hub with bins and organic material',
  51: 'a vertical farm building with a green roof and greenhouses',
  52: 'a wastewater treatment works with round settling tanks',
  53: 'a small clean-energy substation',
  54: 'a sleek AI data center building roof',
  55: 'a small backyard accessory dwelling unit roof',
  56: 'a co-op housing block around a garden courtyard',
  57: 'communal housing around a shared garden courtyard',
  58: 'an open-air market bazaar with colorful stalls and awnings',
  59: 'a maker-space workshop building roof',
  60: 'a serene healing-commons garden building',
  61: 'a green city park with lawn, trees, and paths',
  62: 'rewilded native land, wild grasses and restored nature',
};

const PIXEL_PREFIX = 'Pixel art style. ';

// SURFACE building kinds: flat tiling textures (asphalt parking lots), NOT framed alpha objects.
// A multi-cell parking lot must tile seamlessly and sit on asphalt (Maddy 2026-06-19: "parking lots
// should always overlay on asphalt… they should tile better… [no] yellow border"). So they render
// like terrain — controlnet, SeamlessTile enable, opaque (no alpha) — not like a building object.
export const SURFACE_KINDS = new Set([22]); // ParkingLot

const SURFACE_SUBJECT = {
  22: 'a seamless asphalt parking lot, neat white parking stall stripes, a few parked cars',
};
const SURFACE_SUFFIX =
  'seamless tileable texture, fills the frame edge to edge, no border, no frame, no yellow lines, ' +
  'top-down aerial map tile, flat overhead, no perspective, slightly cartoonish, flat even lighting, ' +
  'no shadows, 16-bit city-builder, Oakland California';

/** Parse a building key `b-{kind}-{pos}-{tier}` → { kind, pos, tier }, else null. */
export function parseBuildingKey(key) {
  const m = /^b-(\d+)-([cek])-(\d+)$/.exec(key);
  return m ? { kind: Number(m[1]), pos: m[2], tier: Number(m[3]) } : null;
}

/** Is this atlas key a SURFACE building (tiling texture, not an alpha object)? */
export function isSurfaceKey(key) {
  const b = parseBuildingKey(key);
  return !!b && SURFACE_KINDS.has(b.kind);
}

/** The positive prompt for an atlas key (terrain or building). Throws on unsupported category. */
export function promptFor(key, category) {
  if (category === 'terrain') {
    const kind = key.replace(/-\d+$/, '');
    const subj = TERRAIN_SUBJECT[kind];
    if (!subj) throw new Error(`no terrain subject for kind "${kind}" (key ${key})`);
    return `${PIXEL_PREFIX}${subj}. ${TERRAIN_SUFFIX}`;
  }
  if (category === 'building') {
    const b = parseBuildingKey(key);
    if (!b) throw new Error(`bad building key ${key}`);
    if (SURFACE_KINDS.has(b.kind)) {
      return `${PIXEL_PREFIX}${SURFACE_SUBJECT[b.kind]}. ${SURFACE_SUFFIX}`;
    }
    const subj = BUILDING_SUBJECT[b.kind] ?? 'a small city building';
    const decay = b.tier >= 1 ? ', weathered and decayed, faded peeling paint, overgrown' : '';
    return `${PIXEL_PREFIX}${subj}${decay}. ${BUILDING_SUFFIX}`;
  }
  throw new Error(`unsupported category for diffusion: ${category} (${key})`);
}

// Style-consistency seed: terrain varies per key; building cells share a seed per (kind,tier) so
// all c/e/k cells of one building diffuse in a matching style and abut cleanly. Deterministic.
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function seedFor(key, category) {
  if (category === 'building') {
    const b = parseBuildingKey(key);
    if (b) return hash32(`b-${b.kind}-${b.tier}`);
  }
  return hash32(key);
}

// ── ComfyUI graph ───────────────────────────────────────────────────────────────────────────
/** The tile-controlnet shape-lock strength for a category. */
export function cnStrengthFor(category) {
  return category === 'building' ? CN_STRENGTH_BUILDING : CN_STRENGTH_TERRAIN;
}

/**
 * Clone the validated structure-only workflow and patch the per-tile node inputs. Structure +
 * desaturation + empty-latent are baked into workflow.api.json; we only vary prompt / control /
 * tiling / cn-strength / seed (+ the LoRA knob).
 */
export function buildGraph({ imageName, prompt, tiling, strength, seed }) {
  const g = structuredClone(WORKFLOW);
  g['7'].inputs.text = prompt; // all color comes from here
  g['17'].inputs.image = imageName; // control structure reference
  g['3'].inputs.tiling = tiling ? 'enable' : 'disable'; // seamless terrain / framed buildings
  g['22'].inputs.strength = strength; // shape-lock
  g['10'].inputs.seed = seed;
  g['2'].inputs.global_strength = LORA;
  return g;
}

/**
 * Pure txt2img graph (NO controlnet) — for BUILDINGS (Maddy 2026-06-19: "drop controlnet for
 * buildings"). A procedural footprint cell is a flat color square with no structure to condition on,
 * so the tile-controlnet produced noise/characters; instead the prompt + pixel LoRA paint a whole
 * top-down roof from an empty latent. SeamlessTile disabled (a building is a framed object).
 */
export function buildTxt2imgGraph({ prompt, seed, tiling = false }) {
  // Surface tiles (parking) tile 4-way via SeamlessTile; building objects don't.
  const modelSrc = tiling ? ['3', 0] : ['2', 0];
  const g = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'ZImageLoraAutoLoader', inputs: { lora_name: 'pixel_art_style_z_image_turbo.safetensors', global_strength: LORA, model: ['1', 0] } },
    4: { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: modelSrc } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
    9: { class_type: 'EmptySD3LatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    10: { class_type: 'KSampler', inputs: { seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['9', 0] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'PixelOE', inputs: { pixel_size: 32, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'bodhitile', images: ['12', 0] } },
  };
  if (tiling) g[3] = { class_type: 'SeamlessTile', inputs: { tiling: 'enable', copy_model: 'Make a copy', model: ['2', 0] } };
  return g;
}

// ── ComfyUI REST helpers ──────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Upload a PNG buffer to ComfyUI's input dir; returns the LoadImage-referencable name. */
export async function uploadImage(buf, filename) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), filename);
  fd.append('overwrite', 'true');
  fd.append('subfolder', 'bodhi_control');
  const res = await fetch(`${COMFY_URL}/upload/image`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload ${filename}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

/** Submit a graph; returns prompt_id. */
export async function submit(graph) {
  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, prompt: graph }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`submit: ${res.status} ${text}`);
  return JSON.parse(text).prompt_id;
}

/** Poll /history/<id> until the prompt finishes; returns the first SaveImage output {filename,subfolder,type}. */
export async function awaitOutput(promptId, { timeoutMs = 180000, pollMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${COMFY_URL}/history/${promptId}`);
    if (res.ok) {
      const hist = await res.json();
      const entry = hist[promptId];
      if (entry?.status?.completed) {
        for (const node of Object.values(entry.outputs ?? {})) {
          if (node.images?.length) return node.images[0];
        }
        throw new Error(`prompt ${promptId} completed with no image output`);
      }
      if (entry?.status?.status_str === 'error') {
        throw new Error(`prompt ${promptId} errored: ${JSON.stringify(entry.status)}`);
      }
    }
    if (Date.now() > deadline) throw new Error(`prompt ${promptId} timed out`);
    await sleep(pollMs);
  }
}

/** Fetch a rendered output image as a Buffer. */
export async function fetchImage({ filename, subfolder, type }) {
  const q = new URLSearchParams({ filename, subfolder: subfolder ?? '', type: type ?? 'output' });
  const res = await fetch(`${COMFY_URL}/view?${q}`);
  if (!res.ok) throw new Error(`view ${filename}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Full one-tile pipeline → styled PNG buffer. Category picks the method:
 *   • terrain  → structure-only Tile-ControlNet (upload the de-dithered/desaturated control tile).
 *   • building → pure txt2img, NO controlnet (a flat footprint cell has no structure to condition on).
 */
export async function generateTile({ key, category, tiling, controlBuf, controlName }) {
  const prompt = promptFor(key, category);
  const seed = seedFor(key, category);
  const surface = category === 'building' && isSurfaceKey(key); // parking → tiling asphalt, not an object
  const object = category === 'building' && !surface; // houses/etc → alpha sprite over the ground
  let graph;
  if (object) {
    graph = buildTxt2imgGraph({ prompt, seed }); // no controlnet, framed object
  } else if (surface) {
    graph = buildTxt2imgGraph({ prompt, seed, tiling: true }); // seamless opaque asphalt
  } else {
    const imageName = await uploadImage(controlBuf, controlName ?? `${key}.png`);
    graph = buildGraph({ imageName, prompt, tiling, strength: cnStrengthFor(category), seed }); // terrain structure-CN
  }
  const promptId = await submit(graph);
  const out = await awaitOutput(promptId);
  const png = await fetchImage(out);
  // Object buildings get a transparent background (floodfill white→alpha) so they sit on the ground
  // tile; terrain and surfaces (parking asphalt) stay opaque and fill the frame.
  return object ? whiteToAlpha(png) : png;
}

/**
 * White background → transparent alpha, flood-filled from the 4 corners of a 16×16 tile so only the
 * background-connected white is cleared (interior white survives). Lets a building composite over the
 * ground tile (asphalt / grass / whatever — Maddy 2026-06-19). Returns the original on any magick error.
 */
export function whiteToAlpha(buf) {
  try {
    return execFileSync(
      'magick',
      ['png:-', '-alpha', 'set', '-fuzz', '22%', '-fill', 'none',
        '-draw', 'alpha 0,0 floodfill', '-draw', 'alpha 15,0 floodfill',
        '-draw', 'alpha 0,15 floodfill', '-draw', 'alpha 15,15 floodfill', 'png:-'],
      { input: buf, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return buf;
  }
}
