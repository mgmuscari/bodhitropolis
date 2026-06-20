// Ambient sprite loader (IO — touches Image/DOM, so NOT on the pure-ui allowlist). Fetches the
// committed ambient sprite PNGs (tools/tileset/ambient.mjs output) and hands the renderer decoded
// images to draw over the live layer: smog plumes over polluted tiles, flora on green parcels, cars,
// props. Resilient like the tileset loader — any sprite that fails to load is skipped, so a partial
// set still runs (the renderer just draws fewer).
const FILES: Readonly<Record<keyof AmbientSprites, readonly string[]>> = {
  cars: ['sedan-red', 'hatchback-blue', 'pickup-white', 'taxi-yellow', 'suv-green', 'van-silver', 'bus-city', 'boxtruck'],
  // Walkers (a 4-frame walk cycle) + cyclists — drawn like the cars (rotated to heading), so the modal
  // shift the player engineers reads on the street (Maddy: "cars look GREAT, now do peds + cyclists").
  peds: ['walk-1', 'walk-2', 'walk-3', 'walk-4'],
  cyclists: ['cyclist-1', 'cyclist-2'],
  flora: ['tree-oak', 'tree-pine', 'shrub', 'flowerbed', 'palm', 'hedge'],
  smog: ['smoke-gray', 'exhaust', 'smog-cloud'],
  props: ['bench', 'hydrant', 'dumpster', 'planter', 'picnic-table', 'bus-shelter'],
};

export interface AmbientSprites {
  cars: CanvasImageSource[];
  peds: CanvasImageSource[];
  cyclists: CanvasImageSource[];
  flora: CanvasImageSource[];
  smog: CanvasImageSource[];
  props: CanvasImageSource[];
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
  const out: AmbientSprites = { cars: [], peds: [], cyclists: [], flora: [], smog: [], props: [] };
  await Promise.all(
    (Object.keys(FILES) as (keyof AmbientSprites)[]).map(async (cat) => {
      const imgs = await Promise.all(FILES[cat].map((n) => loadImage(`${base}sprites/ambient/${cat}/${n}.png`)));
      out[cat] = imgs.filter((i): i is CanvasImageSource => i !== null);
    }),
  );
  return out;
}
