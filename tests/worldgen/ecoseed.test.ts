import { describe, it, expect } from 'vitest';
import { GameMap, Water, LandCover } from '../../src/engine/map';
import { runPipeline, type WorldState } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage, ECO_SEED_WOUND } from '../../src/worldgen/ecoseed';
import { hashWorld, BuiltKind, ParcelStore } from '../../src/engine/fabric';
import { distanceField } from '../../src/worldgen/fields';
import { parseChronicle } from '../../src/worldgen/chronicle';
import { eraHeadline } from '../../src/ui/openingContent';
import { createRng } from '../../src/engine/rng';

// ecoSeedStage seeds the three ecology layers as deterministic functions of the
// terrain + Moses-century state (soil = f(moisture, landCover) − corridor wound,
// flora = f(landCover, soil), fauna = f(flora, water-adjacency, periphery)) and
// appends the era5 wound line as a durable RECORD. The tests pin: determinism,
// the corridor/periphery ring orderings (TILE means binned by highway distance),
// flora's vegetation/water contract, the recorded-but-unshown chronicle line
// (eraHeadline(era5) stays the Moses disinvestment headline), clean all-water
// degeneration, and layer isolation (eco-seed writes ONLY the ecology layers +
// the log line).

const SEEDS = ['moses-1', 'moses-2', 'moses-3'];

function runFull(seed: string): WorldState {
  return runPipeline({ seed, width: 128, height: 128 }, [
    terrainStage(),
    mosesCenturyStage(),
    ecoSeedStage(),
  ]);
}

interface RingMeans {
  coreN: number;
  periN: number;
  coreSoil: number;
  periSoil: number;
  coreFauna: number;
  periFauna: number;
}

// TILE means over LAND, binned by highway distanceField: core d<=8, periphery
// d>=16 OR unreachable (-1, infinitely far from any highway).
function ringMeans(world: WorldState): RingMeans {
  const { map } = world;
  const hwy = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);
  let coreN = 0;
  let periN = 0;
  let coreSoil = 0;
  let periSoil = 0;
  let coreFauna = 0;
  let periFauna = 0;
  for (let i = 0; i < map.soilHealth.length; i++) {
    if (map.water[i] !== Water.None) continue;
    const d = hwy[i]!;
    if (d >= 0 && d <= 8) {
      coreN++;
      coreSoil += map.soilHealth[i]!;
      coreFauna += map.faunaPresence[i]!;
    } else if (d < 0 || d >= 16) {
      periN++;
      periSoil += map.soilHealth[i]!;
      periFauna += map.faunaPresence[i]!;
    }
  }
  return {
    coreN,
    periN,
    coreSoil: coreN ? coreSoil / coreN : 0,
    periSoil: periN ? periSoil / periN : 0,
    coreFauna: coreN ? coreFauna / coreN : 0,
    periFauna: periN ? periFauna / periN : 0,
  };
}

describe('ecoSeedStage: determinism', () => {
  it('two runs of the same seed produce a byte-identical world (covers ecology layers)', () => {
    for (const seed of SEEDS) {
      expect(hashWorld(runFull(seed))).toBe(hashWorld(runFull(seed)));
    }
  });
});

describe('ecoSeedStage: corridor / periphery ring orderings', () => {
  it('soil is broken along the corridors: core soil mean < periphery soil mean', () => {
    for (const seed of SEEDS) {
      const r = ringMeans(runFull(seed));
      expect(r.coreN, `${seed} has a core cohort`).toBeGreaterThan(0);
      expect(r.periN, `${seed} has a periphery cohort`).toBeGreaterThan(0);
      expect(r.coreSoil, `${seed} corridor soil < periphery soil`).toBeLessThan(r.periSoil);
    }
  });

  it('the wild is pushed to the edges: core fauna mean < periphery fauna mean', () => {
    for (const seed of SEEDS) {
      const r = ringMeans(runFull(seed));
      expect(r.coreFauna, `${seed} core fauna < periphery fauna`).toBeLessThan(r.periFauna);
    }
  });
});

describe('ecoSeedStage: flora vegetation/water contract', () => {
  it('flora is positive on every vegetated land tile and 0 on every water tile', () => {
    const world = runFull('moses-1');
    const { map } = world;
    let checkedVeg = false;
    let checkedWater = false;
    for (let i = 0; i < map.floraVitality.length; i++) {
      if (map.water[i] !== Water.None) {
        expect(map.floraVitality[i], 'flora 0 on water').toBe(0);
        checkedWater = true;
      } else if (
        map.landCover[i] === LandCover.Forest ||
        map.landCover[i] === LandCover.Grass ||
        map.landCover[i] === LandCover.Meadow
      ) {
        expect(map.floraVitality[i], 'flora > 0 on vegetated land').toBeGreaterThan(0);
        checkedVeg = true;
      }
    }
    expect(checkedVeg && checkedWater).toBe(true);
  });
});

describe('ecoSeedStage: era5 wound is RECORDED but not the headline', () => {
  it('records the wound line and groups it into era 5, leaving the headline the Moses disinvestment line', () => {
    const world = runFull('moses-1');
    // RECORD: the wound line is in the log.
    expect(world.log).toContain(ECO_SEED_WOUND);

    const chronicle = parseChronicle(world.log);
    const era5 = chronicle.entries.find((e) => e.era === 5);
    expect(era5, 'era 5 entry exists').toBeDefined();
    // The wound is grouped into era 5 (post-prefix remainder), but at events[1+].
    const woundText = ECO_SEED_WOUND.replace(/^era5:\s*/, '');
    expect(era5!.events).toContain(woundText);
    expect(era5!.events[0], 'headline event is NOT the wound').not.toBe(woundText);

    // DISPLAY guard: the one rendered headline for era 5 stays the Moses
    // disinvestment line — the wound is recorded, never shown here.
    const headline = eraHeadline(era5!);
    expect(headline).toContain('disinvestment');
    expect(headline).not.toContain('the land kept the bill');
  });
});

describe('ecoSeedStage: degenerate all-water seed', () => {
  it('seeds cleanly with no throw and zero flora/fauna on an all-water map', () => {
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
    for (let i = 0; i < world.map.floraVitality.length; i++) {
      expect(world.map.floraVitality[i]).toBe(0);
      expect(world.map.faunaPresence[i]).toBe(0);
    }
    // The record line is still appended (durable record), but it is harmless here.
    expect(world.log).toContain(ECO_SEED_WOUND);
  });
});

describe('ecoSeedStage: layer isolation', () => {
  it('writes ONLY the three ecology layers (+ the log line) — fabric byte-identical', () => {
    const world = runPipeline({ seed: 'moses-2', width: 128, height: 128 }, [
      terrainStage(),
      mosesCenturyStage(),
    ]);
    const fingerprint = (m: GameMap, p: ParcelStore) => ({
      elevation: Array.from(m.elevation),
      water: Array.from(m.water),
      moisture: Array.from(m.moisture),
      landCover: Array.from(m.landCover),
      built: Array.from(m.built),
      parcel: Array.from(m.parcel),
      parcelBytes: Array.from(p.snapshotBytes()),
    });
    const before = fingerprint(world.map, world.parcels);
    const soilBefore = Array.from(world.map.soilHealth);
    const logLenBefore = world.log.length;

    ecoSeedStage().apply(world, createRng('moses-2').fork('eco-seed'));

    expect(fingerprint(world.map, world.parcels)).toEqual(before); // fabric untouched
    expect(Array.from(world.map.soilHealth)).not.toEqual(soilBefore); // ecology seeded
    expect(world.log.length).toBe(logLenBefore + 1); // exactly the record line
    expect(world.log).toContain(ECO_SEED_WOUND);
  });
});
