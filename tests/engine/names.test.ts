import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { cityName } from '../../src/engine/names';

// The name generator is a pure Rng consumer forked 'city-name' from the world
// seed. These tests pin determinism (an exact value, captured at first GREEN
// and asserted forever), the legibility contract (title-case, letters only,
// 4..16 chars), and enough entropy that distinct seeds yield distinct names.

describe('cityName', () => {
  it('produces a stable pinned name for createRng("bodhi-1").fork("city-name")', () => {
    const name = cityName(createRng('bodhi-1').fork('city-name'));
    // Pinned after first GREEN — a regression guard on the generator + tables.
    expect(name).toBe('Hirwu');
  });

  it('is title-case, letters only, length 4..16 across many seeds', () => {
    for (let i = 0; i < 64; i++) {
      const name = cityName(createRng(`legibility-${i}`).fork('city-name'));
      expect(name).toMatch(/^[A-Z][a-z]+$/);
      expect(name.length).toBeGreaterThanOrEqual(4);
      expect(name.length).toBeLessThanOrEqual(16);
    }
  });

  it('yields >= 8 distinct names across 10 seeds', () => {
    const names = new Set<string>();
    for (let i = 0; i < 10; i++) {
      names.add(cityName(createRng(`distinct-${i}`).fork('city-name')));
    }
    expect(names.size).toBeGreaterThanOrEqual(8);
  });

  it('is deterministic: same seed + fork -> same name (fresh forks)', () => {
    const a = cityName(createRng('dharma').fork('city-name'));
    const b = cityName(createRng('dharma').fork('city-name'));
    expect(a).toBe(b);
  });
});
