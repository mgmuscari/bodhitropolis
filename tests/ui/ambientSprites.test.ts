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

  // Diffusion light maps (Maddy 2026-06-20): a parallel EMISSION layer keyed `cat/slug`, drawn
  // additively over the albedo to evade day/night shading. Index-free so it scales as assets gain maps.
  it('loads emission light-maps keyed by cat/slug, dropping any that 404', async () => {
    const seen: string[] = [];
    const sprites = await loadAmbientSprites('/', stubLoader(seen));
    expect(sprites.emission['police/cruiser']).toBeTruthy();
    expect(seen.some((u) => u.includes('sprites/ambient/police/cruiser-lights.png'))).toBe(true);

    const missing: AmbientSprites = await loadAmbientSprites('/', (url) =>
      Promise.resolve(url.includes('-lights.png') ? null : ({ url } as unknown as CanvasImageSource)),
    );
    expect(missing.emission['police/cruiser']).toBeUndefined(); // 404 → absent, not a throw
  });
});
