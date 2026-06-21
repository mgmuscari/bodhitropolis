// Ambient sprite loader (IO — touches Image/DOM, so NOT on the pure-ui allowlist). Fetches the
// committed ambient sprite PNGs (tools/tileset/ambient.mjs output) and hands the renderer decoded
// images to draw over the live layer: smog plumes over polluted tiles, flora on green parcels, cars,
// props. Resilient like the tileset loader — any sprite that fails to load is skipped, so a partial
// set still runs (the renderer just draws fewer).
const FILES: Readonly<Record<Exclude<keyof AmbientSprites, 'emission' | 'carLights' | 'cyclistLights'>, readonly string[]>> = {
  cars: ['sedan-red', 'hatchback-blue', 'pickup-white', 'taxi-yellow', 'suv-green', 'van-silver', 'bus-city', 'boxtruck'],
  // Walkers (a 4-frame walk cycle) + cyclists — drawn like the cars (rotated to heading), so the modal
  // shift the player engineers reads on the street (Maddy: "cars look GREAT, now do peds + cyclists").
  peds: ['walk-1', 'walk-2', 'walk-3', 'walk-4'],
  cyclists: ['cyclist-1', 'cyclist-2'],
  flora: ['tree-oak', 'tree-pine', 'shrub', 'flowerbed', 'palm', 'hedge'],
  smog: ['smoke-gray', 'exhaust', 'smog-cloud'],
  props: ['bench', 'hydrant', 'dumpster', 'planter', 'picnic-table', 'bus-shelter'],
  // Encampments (tents) on heavily demand-pathed empty tiles + discarded junk on worn ground — the
  // displacement + neglect made visible (Maddy). Drawn over high-wear tiles in the desire-path render.
  encampments: ['tent-1', 'tent-2', 'tent-3'],
  junk: ['mattress', 'junk-pile', 'old-couch', 'debris'],
  police: ['cruiser'],
};

// Diffusion EMISSION maps (tools/tileset/lights.mjs) — a parallel light layer drawn ADDITIVELY over
// the albedo to evade day/night shading (Maddy 2026-06-20: "diffusion-based lighting"). Keyed
// `cat/slug` (index-free, so it scales as more assets get a `<slug>-lights.png`). Each fetches
// `sprites/ambient/<cat>/<slug>-lights.png`; a 404 just leaves the key absent.
const EMISSION_FILES: Readonly<Record<string, string>> = {
  'police/cruiser': 'sprites/ambient/police/cruiser-lights.png',
  // Buildings are NOT listed here — there are ~45 forms; the loader fetches them from a generated
  // manifest (lights.mjs writes it). Keyed `building/<stem>` (e.g. 'building/b-24-3x3') + a `…/blink`
  // hazard sibling for power plants. The renderer derives the stem from each parcel's kind+footprint.
};
const BUILDING_LIGHTS_DIR = 'tilesets/satellite/buildings/';

export interface AmbientSprites {
  cars: CanvasImageSource[];
  peds: CanvasImageSource[];
  cyclists: CanvasImageSource[];
  flora: CanvasImageSource[];
  smog: CanvasImageSource[];
  props: CanvasImageSource[];
  encampments: CanvasImageSource[];
  junk: CanvasImageSource[];
  police: CanvasImageSource[];
  /** Emission light-maps keyed `cat/slug` (e.g. 'police/cruiser') or `building/<kind>[/blink]`; absent
   *  if the map 404s. For singleton/keyed overlays (cruiser, building footprints). */
  emission: Record<string, CanvasImageSource>;
  /** Per-vehicle emission maps, index-ALIGNED with `cars`/`cyclists` (null where no `-lights` map).
   *  Drawn night-gated over the moving sprite (warm headlights / red taillights / lit bus windows). */
  carLights: (CanvasImageSource | null)[];
  cyclistLights: (CanvasImageSource | null)[];
}

/** Loads one sprite URL, resolving to the decoded image or null on any failure (never rejects). */
export type SpriteLoader = (url: string) => Promise<CanvasImageSource | null>;

/** Default browser loader: a decoded <img>, or null on any failure (404/decode). */
const domImageLoader: SpriteLoader = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => resolve(null);
    img.src = url;
  });

/** Fetch every ambient sprite category concurrently; missing files are dropped from their list.
 *  The image loader is injectable (tests stub it; default is a DOM <img>). */
export async function loadAmbientSprites(
  base = '/',
  loadImage: SpriteLoader = domImageLoader,
): Promise<AmbientSprites> {
  const out: AmbientSprites = { cars: [], peds: [], cyclists: [], flora: [], smog: [], props: [], encampments: [], junk: [], police: [], emission: {}, carLights: [], cyclistLights: [] };
  // Vehicle categories load sprite + `-lights` as PAIRS so the light arrays stay index-aligned with
  // the sprite arrays after null-filtering (the renderer picks `cars[tint % len]` and the matching light).
  const ALIGNED = new Set<keyof typeof FILES>(['cars', 'cyclists']);
  await Promise.all([
    ...(Object.keys(FILES) as (keyof typeof FILES)[]).filter((c) => !ALIGNED.has(c)).map(async (cat) => {
      const imgs = await Promise.all(FILES[cat].map((n) => loadImage(`${base}sprites/ambient/${cat}/${n}.png`)));
      out[cat] = imgs.filter((i): i is CanvasImageSource => i !== null);
    }),
    ...([...ALIGNED] as ('cars' | 'cyclists')[]).map(async (cat) => {
      const pairs = await Promise.all(FILES[cat].map(async (n) => ({
        sprite: await loadImage(`${base}sprites/ambient/${cat}/${n}.png`),
        light: await loadImage(`${base}sprites/ambient/${cat}/${n}-lights.png`),
      })));
      const kept = pairs.filter((p) => p.sprite !== null);
      out[cat] = kept.map((p) => p.sprite as CanvasImageSource);
      const lights = kept.map((p) => p.light); // aligned; null where no -lights map
      if (cat === 'cars') out.carLights = lights;
      else out.cyclistLights = lights;
    }),
    ...Object.entries(EMISSION_FILES).map(async ([key, path]) => {
      const img = await loadImage(`${base}${path}`);
      if (img) out.emission[key] = img; // a 404 leaves the key absent (resilient like the base loader)
    }),
    // Building emission maps from the manifest (the browser can't readdir the atlas). Each stem gets a
    // `building/<stem>` static map + an optional `…/blink` hazard layer. No manifest → no building lights.
    loadBuildingEmission(base, loadImage, out.emission),
  ]);
  return out;
}

/** Fetch the building light-map manifest and load each listed map into `emission`. Resilient: any
 *  fetch/parse failure (e.g. tests with no server) just leaves buildings unlit. */
async function loadBuildingEmission(
  base: string,
  loadImage: SpriteLoader,
  emission: Record<string, CanvasImageSource>,
): Promise<void> {
  try {
    if (typeof fetch !== 'function') return;
    const res = await fetch(`${base}${BUILDING_LIGHTS_DIR}lights-manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as Record<string, { blink?: boolean }>;
    await Promise.all(
      Object.entries(manifest).map(async ([stem, info]) => {
        const lit = await loadImage(`${base}${BUILDING_LIGHTS_DIR}${stem}-lights.png`);
        if (lit) emission[`building/${stem}`] = lit;
        if (info.blink) {
          const bl = await loadImage(`${base}${BUILDING_LIGHTS_DIR}${stem}-blink.png`);
          if (bl) emission[`building/${stem}/blink`] = bl;
        }
      }),
    );
  } catch {
    /* no manifest / offline → buildings stay unlit (graceful) */
  }
}
