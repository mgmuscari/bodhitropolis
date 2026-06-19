import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  CAP_PRESETS,
  MAP_SIZES,
  clampSettings,
  type Settings,
} from '../../src/ui/settings';

describe('settings defaults reproduce today’s game', () => {
  it('default live caps match the historical module consts (medium preset)', () => {
    // These ARE the values the game ships today (ambientContent consts). The default
    // settings must reproduce them exactly so a fresh player gets the same game.
    expect(DEFAULT_SETTINGS.live).toEqual({
      carCap: 200,
      pedCap: 1200,
      flockCap: 32,
      citizenOutDivisor: 3,
      spawnPerSubstep: 4,
    });
    expect(DEFAULT_SETTINGS.live).toEqual(CAP_PRESETS.medium);
  });

  it('default world size is the current 128² (so the seeded world is byte-identical)', () => {
    expect(DEFAULT_SETTINGS.world).toEqual({ mapWidth: 128, mapHeight: 128 });
    expect(MAP_SIZES.medium).toBe(128);
  });

  it('default tileset is the permanent procedural look', () => {
    expect(DEFAULT_SETTINGS.tileset).toBe('procedural');
  });
});

describe('CAP_PRESETS order from slow→fast machine', () => {
  it('low ⩽ medium ⩽ high in agent volume; low keeps FEWER citizens out (bigger divisor)', () => {
    expect(CAP_PRESETS.low.pedCap).toBeLessThan(CAP_PRESETS.medium.pedCap);
    expect(CAP_PRESETS.medium.pedCap).toBeLessThan(CAP_PRESETS.high.pedCap);
    expect(CAP_PRESETS.low.carCap).toBeLessThan(CAP_PRESETS.high.carCap);
    // a bigger divisor → fewer citizens out at once (lighter machine)
    expect(CAP_PRESETS.low.citizenOutDivisor).toBeGreaterThan(CAP_PRESETS.high.citizenOutDivisor);
  });
});

describe('clampSettings (tolerates partial / corrupt persisted data)', () => {
  it('undefined → the full defaults', () => {
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('a partial merges over defaults (untouched fields keep their default)', () => {
    const s = clampSettings({ live: { pedCap: 600 } });
    expect(s.live.pedCap).toBe(600);
    expect(s.live.carCap).toBe(DEFAULT_SETTINGS.live.carCap); // unchanged
    expect(s.world).toEqual(DEFAULT_SETTINGS.world);
  });

  it('clamps out-of-range numbers into the safe band', () => {
    const hi = clampSettings({ live: { pedCap: 9_999_999 }, world: { mapWidth: 9000 } });
    expect(hi.live.pedCap).toBeLessThanOrEqual(8000);
    expect(hi.world.mapWidth).toBeLessThanOrEqual(384);
    const lo = clampSettings({ live: { pedCap: -5, flockCap: -1 }, world: { mapHeight: 4 } });
    expect(lo.live.pedCap).toBeGreaterThanOrEqual(50);
    expect(lo.live.flockCap).toBeGreaterThanOrEqual(0);
    expect(lo.world.mapHeight).toBeGreaterThanOrEqual(64);
  });

  it('coerces non-finite / wrong-type to the default (corrupt JSON)', () => {
    const s = clampSettings({ live: { carCap: NaN }, world: { mapWidth: Infinity } } as unknown as Partial<Settings>);
    expect(s.live.carCap).toBe(DEFAULT_SETTINGS.live.carCap);
    expect(s.world.mapWidth).toBe(DEFAULT_SETTINGS.world.mapWidth);
  });

  it('rounds fractional caps/sizes to integers (GameMap requires integer dims)', () => {
    const s = clampSettings({ world: { mapWidth: 128.7, mapHeight: 159.2 }, live: { spawnPerSubstep: 3.6 } });
    expect(s.world.mapWidth).toBe(129);
    expect(s.world.mapHeight).toBe(159);
    expect(s.live.spawnPerSubstep).toBe(4);
    expect(Number.isInteger(s.live.pedCap)).toBe(true);
  });
});
