import { describe, it, expect } from 'vitest';
import { Water } from '../../src/engine/map';
import { runPipeline, type WorldState } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { ecologyReport } from '../../src/ecology/report';

// ecologyReport is a pure read over the seeded ecology layers: city means +
// corridor/periphery TILE-mean ring split (same highway thresholds as the blight
// report, but tile means, not parcel cohorts) + the nullable scalars the opening
// stat line cites. Every divide is guarded so an empty ring / all-water world
// yields nulls and exact 0s, never NaN.

const SEEDS = ['moses-1', 'moses-2', 'moses-3'];

function runFull(seed: string): WorldState {
  return runPipeline({ seed, width: 128, height: 128 }, [
    terrainStage(),
    mosesCenturyStage(),
    ecoSeedStage(),
  ]);
}

describe('ecologyReport: founded cities', () => {
  it('reports bounded means and the seeded corridor/periphery orderings', () => {
    for (const seed of SEEDS) {
      const r = ecologyReport(runFull(seed));
      for (const v of [r.soilMean, r.floraMean, r.faunaMean, r.biodiversityMean]) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
      // Soil is thinner along the corridors ⇒ a positive periphery-minus-core
      // deficit; the wild is at the edges ⇒ a non-null periphery fauna mean.
      expect(r.coreSoilMean, `${seed} core soil`).not.toBeNull();
      expect(r.peripherySoilMean, `${seed} periphery soil`).not.toBeNull();
      expect(r.corridorSoilDeficit, `${seed} deficit`).not.toBeNull();
      expect(r.corridorSoilDeficit!).toBeGreaterThan(0);
      expect(r.peripheryFaunaMean, `${seed} periphery fauna`).not.toBeNull();
    }
  });

  it('is deterministic (two runs of a seed produce an equal report)', () => {
    for (const seed of SEEDS) {
      expect(ecologyReport(runFull(seed))).toEqual(ecologyReport(runFull(seed)));
    }
  });
});

describe('ecologyReport: degenerate all-water world', () => {
  it('yields exact 0 means and null ring scalars — never NaN', () => {
    const allWater = {
      name: 'all-water',
      apply(world: WorldState): void {
        world.map.water.fill(Water.Ocean);
      },
    };
    const world = runPipeline({ seed: 'drowned', width: 48, height: 48 }, [
      allWater,
      ecoSeedStage(),
    ]);
    const r = ecologyReport(world);
    expect(r.soilMean).toBe(0);
    expect(r.floraMean).toBe(0);
    expect(r.faunaMean).toBe(0);
    for (const v of [r.soilMean, r.floraMean, r.faunaMean, r.biodiversityMean]) {
      expect(Number.isNaN(v)).toBe(false);
    }
    // No highway, no land ⇒ both rings empty ⇒ nullable scalars are null.
    expect(r.coreSoilMean).toBeNull();
    expect(r.peripherySoilMean).toBeNull();
    expect(r.corridorSoilDeficit).toBeNull();
    expect(r.peripheryFaunaMean).toBeNull();
  });
});
