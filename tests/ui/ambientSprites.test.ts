import { describe, it, expect } from 'vitest';
import { loadAmbientSprites, type AmbientSprites } from '../../src/ui/ambientSprites';

// A stub image loader: resolves a marker object per URL (no real decode), so we can assert which
// categories/files the loader fetches without a DOM. Mirrors the tilesetLoader injection pattern.
function stubLoader(seen: string[]) {
  return (url: string): Promise<CanvasImageSource | null> => {
    seen.push(url);
    return Promise.resolve({ url } as unknown as CanvasImageSource);
  };
}

describe('loadAmbientSprites (peds + cyclists wired in — Maddy: cars look GREAT, do peds + cyclists)', () => {
  it('loads pedestrians and cyclists alongside cars/flora/smog/props', async () => {
    const seen: string[] = [];
    const sprites = await loadAmbientSprites('/', stubLoader(seen));
    expect(sprites.peds.length).toBeGreaterThan(0);
    expect(sprites.cyclists.length).toBeGreaterThan(0);
    // fetched from the committed sprite paths
    expect(seen.some((u) => u.includes('sprites/ambient/peds/'))).toBe(true);
    expect(seen.some((u) => u.includes('sprites/ambient/cyclists/'))).toBe(true);
  });

  it('drops only the categories that fail to load (resilient)', async () => {
    const sprites: AmbientSprites = await loadAmbientSprites('/', (url) =>
      Promise.resolve(url.includes('/peds/') ? null : ({ url } as unknown as CanvasImageSource)),
    );
    expect(sprites.peds.length).toBe(0); // all peds failed → empty, not a throw
    expect(sprites.cyclists.length).toBeGreaterThan(0); // others still load
  });
});
