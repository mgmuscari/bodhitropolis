import { describe, it, expect } from 'vitest';
import { valueNoise2D, fbm } from '../../src/worldgen/noise';

// A scattered set of non-integer sample coordinates exercising interpolation.
function* samples(): Generator<[number, number]> {
  for (let x = 0; x < 20; x += 0.737) {
    for (let y = 0; y < 20; y += 0.911) {
      yield [x, y];
    }
  }
}

describe('valueNoise2D', () => {
  it('is deterministic across two separate calls', () => {
    for (const [x, y] of samples()) {
      expect(valueNoise2D(42, x, y)).toBe(valueNoise2D(42, x, y));
    }
  });

  it('outputs within [0, 1)', () => {
    for (const [x, y] of samples()) {
      const v = valueNoise2D(7, x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // also at exact lattice points and negative coords
    expect(valueNoise2D(7, 3, 3)).toBeGreaterThanOrEqual(0);
    expect(valueNoise2D(7, -4.2, -9.8)).toBeGreaterThanOrEqual(0);
    expect(valueNoise2D(7, -4.2, -9.8)).toBeLessThan(1);
  });

  it('produces different fields for different seeds (<5 collisions in 100)', () => {
    let collisions = 0;
    let n = 0;
    for (const [x, y] of samples()) {
      if (n >= 100) break;
      if (valueNoise2D(1, x, y) === valueNoise2D(2, x, y)) collisions++;
      n++;
    }
    expect(collisions).toBeLessThan(5);
  });

  it('is continuous: a 0.01 step changes the value by < 0.05', () => {
    for (const [x, y] of samples()) {
      const delta = Math.abs(valueNoise2D(5, x, y) - valueNoise2D(5, x + 0.01, y));
      expect(delta).toBeLessThan(0.05);
    }
  });
});

describe('fbm', () => {
  const params = { octaves: 4, lacunarity: 2, gain: 0.5 };

  it('is deterministic across two separate calls', () => {
    for (const [x, y] of samples()) {
      expect(fbm(99, x, y, params)).toBe(fbm(99, x, y, params));
    }
  });

  it('outputs within [0, 1]', () => {
    for (const [x, y] of samples()) {
      const v = fbm(99, x, y, params);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('has more high-frequency variance with more octaves', () => {
    const totalVariation = (octaves: number): number => {
      let tv = 0;
      const h = 0.01;
      for (let x = 0; x < 20; x += 0.05) {
        const a = fbm(3, x, 5, { octaves, lacunarity: 2, gain: 0.5 });
        const b = fbm(3, x + h, 5, { octaves, lacunarity: 2, gain: 0.5 });
        tv += Math.abs(b - a);
      }
      return tv;
    };
    expect(totalVariation(5)).toBeGreaterThan(totalVariation(1));
  });

  it('rejects an octave count below 1', () => {
    expect(() => fbm(1, 0, 0, { octaves: 0, lacunarity: 2, gain: 0.5 })).toThrow();
  });
});
