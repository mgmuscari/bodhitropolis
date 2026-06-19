import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { createAmbientState, setHouseholds } from '../../src/ui/ambientContent';
import { sampleUnhoused, unhousedSuffix } from '../../src/ui/unhousedContent';

describe('sampleUnhoused — displacement = per-home shortfall vs the census baseline', () => {
  const W = 16;

  it('counts residents displaced from homes that lost population', () => {
    const state = createAmbientState();
    setHouseholds(state, [
      { x: 1, y: 1, count: 5 },
      { x: 2, y: 2, count: 5 },
    ]);
    state.occupancy.set(1 * W + 1, 2); // home A lost 3
    state.occupancy.set(2 * W + 2, 5); // home B full
    const s = sampleUnhoused(state, W);
    expect(s.baseline).toBe(10);
    expect(s.housed).toBe(7);
    expect(s.unhoused).toBe(3);
  });

  it('a thriving home OVER baseline does not offset another home’s loss', () => {
    const state = createAmbientState();
    setHouseholds(state, [
      { x: 1, y: 1, count: 4 },
      { x: 2, y: 2, count: 4 },
    ]);
    state.occupancy.set(1 * W + 1, 0); // home A fully emptied → 4 displaced
    state.occupancy.set(2 * W + 2, 9); // home B over capacity (in-migration) → capped, no offset
    const s = sampleUnhoused(state, W);
    expect(s.unhoused).toBe(4); // the 5 extra at B do NOT re-house A's displaced
  });

  it('a home with no live occupancy yet is assumed housed at baseline (no phantom unhoused)', () => {
    const state = createAmbientState();
    setHouseholds(state, [{ x: 3, y: 3, count: 6 }]); // never sampled into occupancy
    expect(sampleUnhoused(state, W).unhoused).toBe(0);
  });

  it('no households published → zero (empty city, no NaN)', () => {
    expect(sampleUnhoused(createAmbientState(), W).unhoused).toBe(0);
  });
});

describe('unhousedSuffix — down-is-good indicator', () => {
  it('no prior sample → bare count, no arrow', () => {
    expect(unhousedSuffix(12, null)).toBe('Unhoused 12');
  });
  it('fewer unhoused reads ↓ (housing is working)', () => {
    expect(unhousedSuffix(8, 12)).toBe('Unhoused 8 ↓');
  });
  it('more unhoused reads ↑ (displacement worsening)', () => {
    expect(unhousedSuffix(15, 12)).toBe('Unhoused 15 ↑');
  });
  it('unchanged → no arrow', () => {
    expect(unhousedSuffix(12, 12)).toBe('Unhoused 12');
  });
});

// guard: the module must be headless (used on the pure-ui allowlist) — a smoke import with a real map.
describe('sampleUnhoused integration smoke', () => {
  it('runs against a fresh ambient state + map width', () => {
    const map = new GameMap(8, 8);
    const s = sampleUnhoused(createAmbientState(), map.width);
    expect(s.unhoused).toBe(0);
  });
});
