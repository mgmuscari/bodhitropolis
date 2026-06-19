import { describe, it, expect } from 'vitest';
import { loadTileset, loadTilesetAssets, type ImageLoader } from '../../src/ui/tilesetLoader';
import { PROCEDURAL, type TilesetDef } from '../../src/ui/tileset';

// Sentinel "images" — the loader is source-agnostic (Map<key, CanvasImageSource>), so the test
// returns tagged objects and asserts by identity. No DOM / no real decoding needed.
const img = (tag: string): CanvasImageSource => ({ tag } as unknown as CanvasImageSource);

/** A loader that returns a per-url sentinel image, or null for urls in `missing`. */
function stubLoader(missing: readonly string[] = []): { load: ImageLoader; urls: string[] } {
  const urls: string[] = [];
  const load: ImageLoader = async (url) => {
    urls.push(url);
    return missing.includes(url) ? null : img(url);
  };
  return { load, urls };
}

describe('loadTileset (registry-resolved)', () => {
  it('procedural loads nothing (empty override map → pure painters)', async () => {
    const { load, urls } = stubLoader();
    const overrides = await loadTileset(PROCEDURAL, load);
    expect(overrides.size).toBe(0);
    expect(urls).toEqual([]); // no fetches at all
  });

  it('an unknown id falls back to procedural → empty map, no fetches', async () => {
    const { load, urls } = stubLoader();
    const overrides = await loadTileset('does-not-exist', load);
    expect(overrides.size).toBe(0);
    expect(urls).toEqual([]);
  });
});

describe('loadTilesetAssets (the core)', () => {
  const def: TilesetDef = {
    id: 'fixture',
    label: 'Fixture',
    description: 'test',
    assets: [
      { file: 'terrain/grass.png', keys: ['grass-0', 'grass-1'] },
      { file: 'buildings/house.png', keys: ['b-16-c-0', 'b-16-e-0'] },
      { file: 'buildings/missing.png', keys: ['b-16-k-0'] },
    ],
  };

  it('assigns each loaded image to ALL its atlas keys', async () => {
    const { load } = stubLoader();
    const overrides = await loadTilesetAssets(def, load, '/');
    // Both grass band keys point at the SAME loaded image (one fetch, fanned out).
    expect(overrides.get('grass-0')).toBe(overrides.get('grass-1'));
    expect(overrides.get('b-16-c-0')).toBe(overrides.get('b-16-e-0'));
    // The two distinct files produced two distinct images.
    expect(overrides.get('grass-0')).not.toBe(overrides.get('b-16-c-0'));
  });

  it('SKIPS a failed asset — its keys fall back to procedural (partial tileset still runs)', async () => {
    const { load } = stubLoader(['/tilesets/fixture/buildings/missing.png']);
    const overrides = await loadTilesetAssets(def, load, '/');
    expect(overrides.has('b-16-k-0')).toBe(false); // dropped, not crashed
    expect(overrides.has('grass-0')).toBe(true); // siblings unaffected
    expect(overrides.has('b-16-c-0')).toBe(true);
  });

  it('builds asset urls under public/tilesets/<id>/ from the base', async () => {
    const { load, urls } = stubLoader();
    await loadTilesetAssets(def, load, '/');
    expect(urls).toContain('/tilesets/fixture/terrain/grass.png');
    expect(urls).toContain('/tilesets/fixture/buildings/house.png');
  });

  it('an empty asset list yields an empty override map', async () => {
    const { load } = stubLoader();
    const overrides = await loadTilesetAssets({ ...def, assets: [] }, load);
    expect(overrides.size).toBe(0);
  });
});
