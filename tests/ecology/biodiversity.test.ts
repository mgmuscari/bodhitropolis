import { describe, it, expect } from 'vitest';
import { GameMap, Water, LandCover } from '../../src/engine/map';
import { simpsonIndex, biodiversityField } from '../../src/ecology/biodiversity';

// Simpson's index is the no-transcendentals biodiversity measure: an EXACT
// rational {num: total² − Σcount², den: total²}. The pure function is tested by
// CROSS-MULTIPLICATION (never float compare). biodiversityField scales it to a
// Uint8 via a pinned floor((255·num)/den) over a clamped 7×7 window — separate
// from the index precisely because a Uint8 field cannot carry 1/2 or 2/3.

/** a/b == c/d via cross-multiplication, no float division. */
function crossEq(a: { num: number; den: number }, c: { num: number; den: number }): boolean {
  return a.num * c.den === c.num * a.den;
}

describe('simpsonIndex: exact rationals (cross-multiplication)', () => {
  it('a monoculture is exactly 0', () => {
    const s = simpsonIndex([5]);
    expect(s.num).toBe(0);
    expect(crossEq(s, { num: 0, den: 1 })).toBe(true);
  });

  it('[2,2] = 1/2', () => {
    const s = simpsonIndex([2, 2]);
    expect(crossEq(s, { num: 8, den: 16 })).toBe(true);
    expect(crossEq(s, { num: 1, den: 2 })).toBe(true);
  });

  it('[1,1,1,1] = 3/4', () => {
    const s = simpsonIndex([1, 1, 1, 1]);
    expect(crossEq(s, { num: 12, den: 16 })).toBe(true);
    expect(crossEq(s, { num: 3, den: 4 })).toBe(true);
  });

  it('[1,1,1] = 2/3 (the non-dyadic case a float could not represent)', () => {
    const s = simpsonIndex([1, 1, 1]);
    expect(crossEq(s, { num: 6, den: 9 })).toBe(true);
    expect(crossEq(s, { num: 2, den: 3 })).toBe(true);
  });

  it('an empty window is 0/1 (guards 0/0)', () => {
    expect(simpsonIndex([])).toEqual({ num: 0, den: 1 });
  });

  it('stays in bounds 0 <= num < den (den never 0)', () => {
    for (const counts of [[1], [3, 4], [1, 1, 1], [10, 2, 5, 1], [2, 2]]) {
      const s = simpsonIndex(counts);
      expect(s.den).toBeGreaterThan(0);
      expect(s.num).toBeGreaterThanOrEqual(0);
      expect(s.num).toBeLessThan(s.den);
    }
  });
});

describe('biodiversityField: index → Uint8 (floor convention)', () => {
  it('a single-tile (monoculture) window is 0', () => {
    const map = new GameMap(1, 1);
    const f = biodiversityField(map);
    expect(f[0]).toBe(0);
  });

  it('a fully uniform map is 0 everywhere', () => {
    const map = new GameMap(8, 8); // all identical default tiles
    const f = biodiversityField(map);
    for (let i = 0; i < f.length; i++) expect(f[i]).toBe(0);
  });

  it('pins the floor convention: a 2-tile window of two distinct classes is 127', () => {
    // Two distinct habitat classes (landCover differs) ⇒ counts [1,1], total 2,
    // num 2, den 4 ⇒ floor(255·2/4) = floor(127.5) = 127 (NOT 128 — floor pinned).
    const map = new GameMap(2, 1);
    map.setLandCover(0, 0, LandCover.Bare);
    map.setLandCover(1, 0, LandCover.Forest);
    const f = biodiversityField(map);
    expect(f[0]).toBe(127);
    expect(f[1]).toBe(127);
  });

  it('stays in 0..255 and is deterministic on a varied map', () => {
    const make = (): GameMap => {
      const m = new GameMap(16, 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          m.setLandCover(x, y, ((x + y) % 4) as LandCover);
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
