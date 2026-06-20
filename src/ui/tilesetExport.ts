// Pure seam for the build-time tileset GENERATOR (docs/art/satellite-tileset.md §5.6):
// classify a procedural atlas key for diffusion and name the control PNG the export
// harness dumps for it. DOM-free and transcendental-Math-free → on the architecture
// pure-ui allowlist, so it's shared by the in-app harness (which labels each exported
// tile) and asserted headlessly without a canvas.
//
// The pipeline: render each procedural atlas tile → PNG, feed it as the Z-Image Tile
// ControlNet's structural guide → a STYLED tile guaranteed key-aligned. Category drives
// the diffusion prompt + whether SeamlessTile tiles the result.

export type TileCategory = 'terrain' | 'road' | 'transport' | 'building';

// Non-road transport ribbon prefixes (rail/streetcar/elevated/bike/promenade) — the
// `${prefix}-${mask}` keys from renderKey.ts. Kept in sync with TRANSPORT_PREFIX there.
const TRANSPORT_PREFIXES = ['rail-', 'streetcar-', 'elev-', 'bike-', 'ped-'];

/**
 * The diffusion category of a procedural atlas key, off its prefix:
 * `b-…` → building, `road-…` → road, a transport ribbon prefix → transport, else the
 * `${kind}-${band}` ground tiles → terrain. Total over the procedural keyspace
 * (renderKeyspace() built keys + the terrain keys proceduralAtlas() adds).
 */
export function tileCategory(key: string): TileCategory {
  if (key.startsWith('b-')) return 'building';
  if (key.startsWith('road-')) return 'road';
  for (const prefix of TRANSPORT_PREFIXES) {
    if (key.startsWith(prefix)) return 'transport';
  }
  return 'terrain';
}

/**
 * Whether SeamlessTile should tile this tile's diffusion. Tesselable categories
 * (ground, road surface, transport ribbons) tile 4-way; buildings are framed objects
 * and must NOT tile (tiling would smear the roof/footprint across the seam).
 */
export function tileTiling(key: string): boolean {
  return tileCategory(key) !== 'building';
}

// Procedural atlas keys are filesystem-safe: lowercase alphanumerics joined by '-'
// (terrain `grass-0`, road `road-3-15-w`, building `b-16-c-0`). The tileset-only keys
// that AREN'T painted procedurally — `@surface/…` ingredients and `#`-variant keys —
// carry unsafe chars and are never in the procedural atlas; reject them so a stray one
// trips here instead of silently colliding on disk.
const SAFE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The control-image filename for an atlas key: the key itself + `.png` (keys are unique). */
export function exportTileName(key: string): string {
  if (!SAFE_KEY.test(key)) throw new Error(`unsafe atlas key for export: ${key}`);
  return `${key}.png`;
}
