import { describe, it, expect } from 'vitest';
import { tileCategory, tileTiling, exportTileName } from '../../src/ui/tilesetExport';
import { renderKeyspace } from '../../src/ui/renderKey';

// A representative slice of the terrain keyspace (`${kind}-${band}`), which the
// procedural atlas adds outside renderKeyspace() — see proceduralAtlas() in renderer.ts.
const TERRAIN_KEYS = [
  'ocean-0',
  'lake-1',
  'river-2',
  'forest-0',
  'grass-1',
  'meadow-2',
  'bare-0',
];

describe('tileset export seam: category', () => {
  it('keys the four diffusion categories off the atlas key prefix', () => {
    expect(tileCategory('grass-1')).toBe('terrain');
    expect(tileCategory('ocean-0')).toBe('terrain');
    expect(tileCategory('bare-0')).toBe('terrain'); // starts with 'b' but NOT 'b-'
    expect(tileCategory('road-1-5')).toBe('road');
    expect(tileCategory('road-3-15-w')).toBe('road');
    expect(tileCategory('rail-7')).toBe('transport');
    expect(tileCategory('streetcar-0')).toBe('transport');
    expect(tileCategory('elev-12')).toBe('transport');
    expect(tileCategory('bike-3')).toBe('transport');
    expect(tileCategory('ped-9')).toBe('transport');
    expect(tileCategory('b-16-c-0')).toBe('building');
    expect(tileCategory('b-18-k-1')).toBe('building');
  });

  it('classifies every procedural built key (renderKeyspace is total)', () => {
    for (const key of renderKeyspace()) {
      expect(['terrain', 'road', 'transport', 'building']).toContain(tileCategory(key));
    }
  });
});

describe('tileset export seam: tiling (SeamlessTile during diffusion)', () => {
  it('tesselates ground + road + transport ribbons, never buildings', () => {
    expect(tileTiling('grass-1')).toBe(true);
    expect(tileTiling('road-1-5')).toBe(true);
    expect(tileTiling('rail-7')).toBe(true);
    expect(tileTiling('b-16-c-0')).toBe(false);
  });
});

describe('tileset export seam: filename', () => {
  it('appends .png to a filesystem-safe atlas key', () => {
    expect(exportTileName('grass-1')).toBe('grass-1.png');
    expect(exportTileName('b-16-c-0')).toBe('b-16-c-0.png');
    expect(exportTileName('road-3-15-w')).toBe('road-3-15-w.png');
  });

  it('rejects unsafe keys (variant # / @surface ingredients are not atlas tiles)', () => {
    expect(() => exportTileName('@surface/road')).toThrow();
    expect(() => exportTileName('road-1-5#2')).toThrow();
  });

  it('is injective and safe over the whole procedural keyspace', () => {
    const keys = [...renderKeyspace(), ...TERRAIN_KEYS];
    const names = new Set<string>();
    for (const key of keys) {
      const name = exportTileName(key); // throws if unsafe
      expect(names.has(name)).toBe(false); // no collision
      names.add(name);
    }
    expect(names.size).toBe(keys.length);
  });
});
