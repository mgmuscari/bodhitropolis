import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { richnessOf, biodiversityField } from '../../src/ecology/biodiversity';

// Biodiversity = ecological RICHNESS (flora × fauna), smoothed over a 7×7 window: high where both
// plants and animals thrive (wilds), low in sealed urban or barren ground. (Replaces the old
// Simpson class-heterogeneity measure, which scored mixed urban edges highest — the inverse.)

describe('richnessOf: a living web needs both flora AND fauna', () => {
  it('is high only when both flora and fauna are present', () => {
    const map = new GameMap(4, 1);
    map.setFloraVitality(0, 0, 255);
    map.setFaunaPresence(0, 0, 255); // lush + teeming → rich
    map.setFloraVitality(1, 0, 255); // flora only (monoculture) → poor
    map.setFaunaPresence(2, 0, 255); // fauna only → poor
    // tile 3: bare → poor
    expect(richnessOf(map, map.idx(0, 0))).toBe(255);
    expect(richnessOf(map, map.idx(1, 0))).toBe(0);
    expect(richnessOf(map, map.idx(2, 0))).toBe(0);
    expect(richnessOf(map, map.idx(3, 0))).toBe(0);
  });

  it('is 0 on water (no terrestrial richness)', () => {
    const map = new GameMap(2, 1);
    map.setFloraVitality(0, 0, 255);
    map.setFaunaPresence(0, 0, 255);
    map.setWater(0, 0, Water.Lake);
    expect(richnessOf(map, map.idx(0, 0))).toBe(0);
  });
});

describe('biodiversityField: high in wilds, low in urban (NOT inverted)', () => {
  it('a barren / sealed map reads 0 everywhere', () => {
    const map = new GameMap(8, 8); // default: flora 0, fauna 0
    const f = biodiversityField(map);
    for (let i = 0; i < f.length; i++) expect(f[i]).toBe(0);
  });

  it('a lush wild block reads far higher than a barren urban block', () => {
    const map = new GameMap(16, 16);
    // left half: lush wild (flora + fauna high). right half: barren (urban) — both 0.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 8; x++) {
        map.setFloraVitality(x, y, 240);
        map.setFaunaPresence(x, y, 240);
      }
    }
    const f = biodiversityField(map);
    expect(f[map.idx(3, 8)]!).toBeGreaterThan(150); // deep in the wild → rich
    expect(f[map.idx(13, 8)]!).toBe(0); // deep in the barren/urban → none
    expect(f[map.idx(3, 8)]!).toBeGreaterThan(f[map.idx(13, 8)]!); // the fix: wild > urban
  });

  it('stays in 0..255 and is deterministic on a varied map', () => {
    const make = (): GameMap => {
      const m = new GameMap(16, 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          m.setFloraVitality(x, y, (x * 16) & 0xff);
          m.setFaunaPresence(x, y, (y * 16) & 0xff);
          if ((x * y) % 7 === 0) m.setWater(x, y, Water.Lake);
        }
      }
      return m;
    };
    const a = biodiversityField(make());
    const b = biodiversityField(make());
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(0);
      expect(a[i]).toBeLessThanOrEqual(255);
      expect(a[i]).toBe(b[i]); // determinism
    }
  });
});
