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
import { footprintPng, pickShape } from './footprint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = JSON.parse(readFileSync(join(HERE, 'workflow.api.json'), 'utf8'));

export const COMFY_URL = (process.env.COMFYUI_URL ?? 'https://comfyui.tailea7e08.ts.net').replace(/\/$/, '');
export const CLIENT_ID = 'bodhi-tileset-gen';

// Tile-ControlNet shape-lock strength, per category. Buildings have real structure to hold (0.55);
// terrain's de-dithered shape map is near-flat, so a light lock keeps it prompt-driven + tileable.
export const CN_STRENGTH_BUILDING = Number(process.env.TS_CN ?? 0.55);
export const CN_STRENGTH_TERRAIN = Number(process.env.TS_CN_TERRAIN ?? 0.3);
export const LORA = Number(process.env.TS_LORA ?? 1.0); // pixel-art LoRA global strength (node 2)

// Building generation (img2img from a black-footprint silhouette; the full convergence of Maddy's
// guidance 2026-06-19): low LoRA (kills iso bias), cfg>1 + a REAL negative (suppress iso/perspective
// in the negative, not the positive), high denoise (paint into the black footprint region).
export const BUILDING_LORA = Number(process.env.TS_BLORA ?? 0.35);
// cfg MUST stay 1.0: Z-Image turbo is guidance-distilled for cfg=1; cfg>1 breaks its color (probed
// 2026-06-19 — blue/muted, footprint stays dark). So the negative node (node 8) is mathematically
// cancelled and unused; the positive roof/site prompt + black footprint + low LoRA carry it.
export const BUILDING_CFG = Number(process.env.TS_CFG ?? 1.0);
export const BUILDING_DENOISE = Number(process.env.TS_DENOISE ?? 0.92);
export const NEGATIVE_PROMPT = process.env.TS_NEG ??
  'isometric, 3/4 view, side view, profile, perspective, elevation, walls, facade, building sides, ' +
  '3d render, photorealistic, smooth shading, gradient, blurry, anti-aliasing, drop shadow, horizon, ' +
  'low contrast, watermark, signature, jpeg artifacts';

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
// TRUE orthographic top-down (Maddy 2026-06-19: "it's a profile… not straight down the stacks on the
// roof"). POSITIVE-ONLY framing: negations in the positive prompt ("no walls, not isometric") invoke
// what they name (diffusion paradox — Maddy), so we describe ONLY the desired overhead imagery and let
// real negatives live in a proper negative-conditioning node (cfg>1, pending from the comfy agent).
// Frame as aerial/satellite photo + low LoRA so the base model's top-down wins (on-vision Google-Maps).
const BUILDING_SUFFIX =
  'aerial photograph, satellite imagery, overhead drone photo straight down, orthographic top-down ' +
  'map tile, flat rooftop viewed from directly above, centered, filling most of the frame, isolated ' +
  'on a plain white background, crisp pixels, Oakland California';

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

// Building kind → ROOF / SITE subject, named top-down features (Maddy 2026-06-19: "name items that
// might be on the roof: terra cotta tile roof, HVAC machinery, smokestacks and piping"; "house with
// pool, tennis court, junk cars — be creative"). An ARRAY is a variety pool (a craftsman house should
// not look like every other); promptFor picks one per seed. All described as seen from straight above.
const BUILDING_SUBJECT = {
  16: [ // residential variety
    'a craftsman house with a terra cotta tile roof, a backyard swimming pool, and a garden',
    'a Victorian house with a grey shingle roof, a tennis court, and a driveway with a parked car',
    'a bungalow with a gabled roof, a vegetable garden, a detached garage, and hedges',
    'a two-story house with rooftop solar panels, a back patio, and a lawn with a tree',
    'a cottage with a small kidney-shaped pool, a paved path, and shrubs',
  ],
  55: [ // accessory dwelling
    'a small backyard cottage with a shingle roof beside a garden and a parked car',
    'a tiny house with a green roof, a deck, and potted plants',
  ],
  17: 'an apartment block, tar-and-gravel roof with rooftop water tanks, vents, and a stair hatch',
  18: 'a concrete housing project roof, flat with vents, stairwell hatches, and a courtyard',
  19: 'a strip of shop rooftops, flat with skylights, rooftop signage, and ducting',
  20: 'an office building roof with HVAC machinery, ductwork, and rooftop units',
  21: [ // industrial variety
    'a warehouse with a corrugated metal roof, skylights, roof vents, and loading docks',
    'an industrial yard with shipping containers, junk cars, storage tanks, and piping',
    'a factory roof with exhaust stacks and ducting beside a lot full of junk cars',
  ],
  23: 'a civic hall roof with a central cupola, skylights, and a paved plaza',
  31: 'a police precinct roof with rooftop antennas, HVAC units, and a parking lot of cruisers',
  32: 'a fire station with a red roof, a hose-drying tower, and an apron with a fire truck',
  33: 'a medical clinic with a slate-grey roof, rooftop HVAC units, and a painted red cross marking', // not white — white floodfills to alpha
  34: 'a library roof with skylights, a small cupola, and rooftop vents',
  35: 'a school roof, flat with vents, beside a yard with a basketball court',
  24: 'a coal power plant roof with tall smokestacks, piping, conveyors, and exhaust vents',
  25: 'a gas power plant with cylindrical storage tanks, piping, and flare stacks',
  26: 'a hydroelectric plant with turbine housings, water intakes, and penstocks',
  27: 'a nuclear plant with a domed containment, cooling structures, and piping',
  28: 'a wind turbine from directly above, a white nacelle and three long blades',
  29: 'a solar plant, neat rows of dark blue photovoltaic panels',
  30: 'a fusion plant with a sleek reactor dome, cooling fins, and conduits',
  48: 'a parklet with benches, planters, and a paved path',
  49: 'a community garden with raised planting beds, green plots, and a tool shed',
  50: 'a compost hub with rows of compost bins, bays, and a wheelbarrow',
  51: 'a vertical farm with glass greenhouse roofs and rooftop solar panels',
  52: 'a wastewater works with round settling tanks and pipework',
  53: 'a clean-energy substation with transformers and switchgear',
  54: 'an AI data center roof, dense rows of cooling units and ductwork',
  56: 'a co-op housing block with rooftop solar around a shared garden courtyard',
  57: 'communal housing roofs around a green courtyard with garden beds',
  58: 'an open-air market, rows of colorful striped stall awnings',
  59: 'a maker-space with sawtooth skylight roofs and rooftop vents',
  60: 'a healing-commons green garden roof with skylights and a meditation court',
  61: 'a city park with lawn, tree canopies, winding paths, and a pond',
  62: 'rewilded land, wild grasses, shrubs, a pond, and fallen logs',
};

const PIXEL_PREFIX = 'Pixel art style. ';

// SURFACE building kinds: flat tiling textures (asphalt parking lots), NOT framed alpha objects.
// A multi-cell parking lot must tile seamlessly and sit on asphalt (Maddy 2026-06-19: "parking lots
// should always overlay on asphalt… they should tile better… [no] yellow border"). So they render
// like terrain — controlnet, SeamlessTile enable, opaque (no alpha) — not like a building object.
export const SURFACE_KINDS = new Set([22, 11]); // ParkingLot, PlantedMedian (edge-to-edge, not a building)

const SURFACE_SUBJECT = {
  22: 'a seamless asphalt parking lot, neat white parking stall stripes, a few parked cars',
  11: 'a lush planted median strip of colorful wildflowers, meadow grasses and low groundcover',
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

/**
 * The positive prompt for an atlas key (terrain or building). Throws on unsupported category.
 * `salt` (default 0) varies the variety-pool pick for building VARIANTS — salt 0 is the committed
 * tile (unchanged), salt 1..N pick different roof/site subjects so the same kind reads distinctly.
 */
export function promptFor(key, category, salt = 0) {
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
    const entry = BUILDING_SUBJECT[b.kind] ?? 'a small city building';
    const pick = hash32(salt ? `${key}#${salt}` : key) % (Array.isArray(entry) ? entry.length : 1);
    const subj = Array.isArray(entry) ? entry[pick] : entry; // variety pool pick (salted per variant)
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
export function seedFor(key, category, salt = 0) {
  if (category === 'building') {
    const b = parseBuildingKey(key);
    if (b) return hash32(salt ? `b-${b.kind}-${b.tier}#${salt}` : `b-${b.kind}-${b.tier}`);
  }
  return hash32(salt ? `${key}#${salt}` : key);
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

/**
 * Building graph: img2img from a black-footprint silhouette init, with a REAL negative prompt (node 8
 * CLIPTextEncode) at cfg>1 to suppress iso/perspective. The building diffuses into the black footprint
 * region (flat, top-down); white is kept → alpha. `gen` = latent px (512 single tile, w·256 plot),
 * `pixel` = PixelOE size (gen/pixel = output px). Low BUILDING_LORA kills the iso game-sprite bias.
 */
export function buildBuildingGraph({ initName, prompt, seed, gen = 512, genW = gen, genH = gen, pixel = 32 }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'ZImageLoraAutoLoader', inputs: { lora_name: 'pixel_art_style_z_image_turbo.safetensors', global_strength: BUILDING_LORA, model: ['1', 0] } },
    4: { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: ['2', 0] } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['5', 0] } }, // real negative (cfg>1)
    17: { class_type: 'LoadImage', inputs: { image: initName } },
    18: { class_type: 'ImageScale', inputs: { upscale_method: 'bilinear', width: genW, height: genH, crop: 'disabled', image: ['17', 0] } },
    21: { class_type: 'VAEEncode', inputs: { pixels: ['18', 0], vae: ['6', 0] } },
    10: { class_type: 'KSampler', inputs: { seed, steps: 8, cfg: BUILDING_CFG, sampler_name: 'res_multistep', scheduler: 'simple', denoise: BUILDING_DENOISE, model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['21', 0] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'PixelOE', inputs: { pixel_size: pixel, thickness: 2, mode: 'k_centroid', color_quant: true, no_post_upscale: true, num_colors: 32, quant_mode: 'kmeans', dither_mode: 'ordered', weight_mapping: 'current', device: 'default', img: ['11', 0] } },
    14: { class_type: 'SaveImage', inputs: { filename_prefix: 'bodhitile', images: ['12', 0] } },
  };
}

/** Render + upload a creative black-footprint silhouette init for a building (kind,tier) at `w`×`h`px
 *  (h defaults to w — square; non-square for plots like a 2×1 commercial strip). */
export async function uploadFootprint(kind, seed, w, h = w) {
  const shape = pickShape(seed);
  return uploadImage(footprintPng(shape, w, h), `fp-${kind}-${w}x${h}.png`);
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
    const b = parseBuildingKey(key);
    const initName = await uploadFootprint(b.kind, seed, 512); // creative black-footprint silhouette
    graph = buildBuildingGraph({ initName, prompt, seed, gen: 512, pixel: 32 });
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
 * White background → transparent alpha, flood-filled from the 4 corners of a `size`×`size` tile so
 * only the background-connected white is cleared (interior white survives). Lets a building composite
 * over the ground tile (asphalt / grass / whatever — Maddy 2026-06-19). Original on any magick error.
 */
export function whiteToAlpha(buf, w = 16, h = w) {
  const ex = w - 1;
  const ey = h - 1;
  const fuzz = `${process.env.TS_FUZZ ?? 12}%`; // lower fuzz = less of the building eaten away
  try {
    return execFileSync(
      'magick',
      ['png:-', '-alpha', 'set', '-fuzz', fuzz, '-fill', 'none',
        '-draw', 'alpha 0,0 floodfill', '-draw', `alpha ${ex},0 floodfill`,
        '-draw', `alpha 0,${ey} floodfill`, '-draw', `alpha ${ex},${ey} floodfill`, 'png:-'],
      { input: buf, maxBuffer: 32 * 1024 * 1024 },
    );
  } catch {
    return buf;
  }
}

// Multi-tile building footprints (square, w=h) from src/tools/tools.ts. A multi-tile plot is rendered
// as ONE image at (w·16)² then SLICED into 16×16 cells (footprintCellKey), so a coal plant is one big
// plant across its 3×3 plot, not nine tiny plants (Maddy 2026-06-19). Kinds absent here are 1×1 →
// the single-tile object path. (Zoned R/C/I that grow to dynamic sizes are not handled yet.)
export const FOOTPRINTS = {
  23: 2, 31: 2, 32: 2, 33: 2, 34: 2, 35: 2, 26: 2, 49: 2, 51: 2, 52: 2, 56: 2, 58: 2, 59: 2, // 2×2 civic/service/eco (31=precinct)
  24: 3, 25: 3, 29: 3, 57: 3, 60: 3, // 3×3 coal/gas/solar/commune/healing
  27: 4, 30: 4, // 4×4 nuclear/fusion
};

/**
 * Txt2img graph for a multi-tile building at footprint resolution: latent = w·256 (so PixelOE
 * pixel_size 16 → a clean (w·16)² pixel tile, divisible into 16×16 cells). No controlnet — the prompt
 * paints the whole building filling the plot.
 */
export function buildMultiTileGraph({ prompt, seed, footprint }) {
  const px = footprint * 256;
  const g = buildTxt2imgGraph({ prompt, seed });
  g[9].inputs.width = px;
  g[9].inputs.height = px;
  g[12].inputs.pixel_size = 16; // px / 16 = footprint·16 output
  return g;
}
