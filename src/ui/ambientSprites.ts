// Ambient sprite loader (IO — touches Image/DOM, so NOT on the pure-ui allowlist). Fetches the
// committed ambient sprite PNGs (tools/tileset/ambient.mjs output) and hands the renderer decoded
// images to draw over the live layer: smog plumes over polluted tiles, flora on green parcels, cars,
// props. Resilient like the tileset loader — any sprite that fails to load is skipped, so a partial
// set still runs (the renderer just draws fewer).
const FILES: Readonly<Record<keyof AmbientSprites, readonly string[]>> = {
  cars: ['sedan-red', 'hatchback-blue', 'pickup-white', 'taxi-yellow', 'suv-green', 'van-silver', 'bus-city', 'boxtruck'],
  flora: ['tree-oak', 'tree-pine', 'shrub', 'flowerbed', 'palm', 'hedge'],
  smog: ['smoke-gray', 'exhaust', 'smog-cloud'],
  props: ['bench', 'hydrant', 'dumpster', 'planter', 'picnic-table', 'bus-shelter'],
};

export interface AmbientSprites {
  cars: CanvasImageSource[];
  flora: CanvasImageSource[];
  smog: CanvasImageSource[];
  props: CanvasImageSource[];
}

/** Load one sprite URL, resolving to the decoded image or null on any failure (never rejects). */
function loadImage(url: string): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => resolve(null);
    img.src = url;
  });
}

/** Fetch every ambient sprite category concurrently; missing files are dropped from their list. */
export async function loadAmbientSprites(base = '/'): Promise<AmbientSprites> {
  const out: AmbientSprites = { cars: [], flora: [], smog: [], props: [] };
  await Promise.all(
    (Object.keys(FILES) as (keyof AmbientSprites)[]).map(async (cat) => {
      const imgs = await Promise.all(FILES[cat].map((n) => loadImage(`${base}sprites/ambient/${cat}/${n}.png`)));
      out[cat] = imgs.filter((i): i is CanvasImageSource => i !== null);
    }),
  );
  return out;
}
