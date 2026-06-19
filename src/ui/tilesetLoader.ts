// Tileset asset loader (IO — touches Image/DOM, so NOT on the pure-ui allowlist; the manifest it
// reads lives in the pure tileset.ts). Fetches a tileset's committed PNGs and returns the atlas
// OVERRIDE map the renderer layers over its procedural painters: Map<atlasKey, image>.
//
// Resilience is the whole point of the "optional skin" model: any asset that fails to load
// (404, decode error) is SKIPPED, so a partial tileset still runs (its missing keys fall back to
// the procedural painter). `procedural` (and any def with no assets) loads nothing → empty map.

import { tilesetDef, type TilesetDef } from './tileset';
import { BASE_TILE } from './camera';

/** Loads one image URL, resolving to the decoded image or `null` on any failure (never rejects). */
export type ImageLoader = (url: string) => Promise<CanvasImageSource | null>;

/**
 * Default browser image loader: fetch the PNG, then DECODE it ONCE into a BASE_TILE×BASE_TILE
 * offscreen canvas. This is deliberate for rendering efficiency:
 *   • the atlas stays uniformly canvas-typed (the fastest drawImage source) with NO lazy
 *     image-decode hitch on the first base-rebuild after a tileset swap;
 *   • every asset is normalized to the atlas tile size, so an off-size PNG can't silently change
 *     the base-texture resolution — the cached single-base-texture bake + 1:1 blit are unchanged.
 * imageSmoothing is off so a normalized source stays crisp. Resolves null on any failure.
 */
const domImageLoader: ImageLoader = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = (): void => {
      const canvas = document.createElement('canvas');
      canvas.width = BASE_TILE;
      canvas.height = BASE_TILE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(img); // degrade to the raw image rather than dropping the asset
        return;
      }
      ctx.imageSmoothingEnabled = false; // crisp if the source isn't exactly BASE_TILE
      ctx.drawImage(img, 0, 0, BASE_TILE, BASE_TILE);
      resolve(canvas);
    };
    img.onerror = (): void => resolve(null); // skip → procedural fallback for this key
    img.src = url;
  });

/** Where a tileset's files live (Vite serves public/ at the site root). */
function assetUrl(def: TilesetDef, file: string, base: string): string {
  return `${base}tilesets/${def.id}/${file}`;
}

/**
 * Build the renderer's atlas-override map for a resolved def. Each committed asset is loaded once
 * and assigned to ALL the atlas keys it fills (terrain bands, building pos/tier cells, …). Loads
 * run concurrently; a failed load drops only its own keys. No assets → empty map. (The testable
 * core — {@link loadTileset} just resolves the id to a def first.)
 */
export async function loadTilesetAssets(
  def: TilesetDef,
  loadImage: ImageLoader = domImageLoader,
  base = '/',
): Promise<Map<string, CanvasImageSource>> {
  const overrides = new Map<string, CanvasImageSource>();
  await Promise.all(
    def.assets.map(async (asset) => {
      const img = await loadImage(assetUrl(def, asset.file, base));
      if (!img) return; // skip — this asset's keys fall back to procedural
      for (const key of asset.keys) overrides.set(key, img);
    }),
  );
  return overrides;
}

/**
 * Build the renderer's atlas-override map for tileset `id` (resolved through the registry; an
 * unknown id falls back to `procedural` → empty map). Default loader = a DOM <img>; tests inject
 * a stub.
 */
export function loadTileset(
  id: string,
  loadImage: ImageLoader = domImageLoader,
  base = '/',
): Promise<Map<string, CanvasImageSource>> {
  return loadTilesetAssets(tilesetDef(id), loadImage, base);
}
