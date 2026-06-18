import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import {
  ParcelStore,
  BuiltKind,
  placeParcel,
  placeTransport,
  demolishParcel,
} from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { buildReport } from '../../src/worldgen/report';

// The blight report is a pure read over the final WorldState. Its wound counts
// (abandoned / craters / preEra5Standing) are sourced from the era-5 chronicle
// line so the overlay numbers match the prose; the core/periphery gradient is
// measured by the survivorship-FREE abandonment share, not by survivor means.

const FOUNDED_SEEDS = ['moses-1', 'moses-2', 'moses-3'];

function runFull(seed: string) {
  return runPipeline({ seed, width: 128, height: 128 }, [
    terrainStage(),
    mosesCenturyStage(),
  ]);
}

// A hand-built world: a highway on row 5, four core parcels (dist <= 8), four
// far parcels (dist >= 16; two of them demolished), plus a hand-written era-5
// line whose crater count (1) deliberately differs from the alive ParkingLot
// count (2) and whose abandoned count (5) differs from count - aliveCount (2) —
// proving both numbers are chronicle-sourced, not store-derived.
function handFixture() {
  const map = new GameMap(24, 30);
  const parcels = new ParcelStore();
  for (let x = 0; x < 24; x++) placeTransport(map, x, 5, BuiltKind.RoadHighway);

  // Core cohort (dist 1 from the highway).
  placeParcel(map, parcels, { x: 6, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 200 });
  placeParcel(map, parcels, { x: 8, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 100 });
  placeParcel(map, parcels, { x: 10, y: 6, width: 1, height: 1, kind: BuiltKind.Apartments, condition: 50 });
  placeParcel(map, parcels, { x: 12, y: 6, width: 3, height: 3, kind: BuiltKind.Projects, condition: 180 });

  // Far cohort (dist 19): two healthy era-2-style parking lots + two doomed homes.
  placeParcel(map, parcels, { x: 6, y: 24, width: 1, height: 1, kind: BuiltKind.ParkingLot, condition: 255 });
  placeParcel(map, parcels, { x: 8, y: 24, width: 1, height: 1, kind: BuiltKind.ParkingLot, condition: 235 });
  const d1 = placeParcel(map, parcels, { x: 10, y: 24, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 30 });
  const d2 = placeParcel(map, parcels, { x: 12, y: 24, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 40 });
  demolishParcel(map, parcels, d1);
  demolishParcel(map, parcels, d2);

  const log = [
    'terrain',
    'era1: founded at (6, 6)',
    'era3: rails removed 14 (peak 21)',
    'era5: disinvestment — 9 decayed, 5 abandoned, 1 craters (of 10 standing)',
    'moses-century',
  ];
  return { map, parcels, log };
}

describe('buildReport: hand fixture (exact numbers)', () => {
  it('reports store totals and chronicle-sourced wound counts exactly', () => {
    const r = buildReport(handFixture());
    expect(r.parcelsTotal).toBe(8);
    expect(r.parcelsAlive).toBe(6);
    // Chronicle-sourced, nullable — parsed from the era-5 line, not store deltas.
    expect(r.preEra5Standing).toBe(10);
    expect(r.abandoned).toBe(5);
    expect(r.craters).toBe(1);
    expect(r.railLost).toEqual({ removed: 14, peak: 21 });
  });

  it('craters tracks the chronicle C, NOT the alive ParkingLot count', () => {
    const r = buildReport(handFixture());
    expect(r.craters).toBe(1);
    expect(r.byKind[BuiltKind.ParkingLot]).toBe(2); // two healthy lots survive
    // abandoned is the era-5 number (5), NOT count - aliveCount (8 - 6 = 2).
    expect(r.abandoned).toBe(5);
    expect(r.parcelsTotal - r.parcelsAlive).toBe(2);
  });

  it('computes condition stats and shares over alive parcels', () => {
    const r = buildReport(handFixture());
    // conditions [200,100,50,180,255,235] -> sum 1020 / 6 = 170; median (180+200)/2.
    expect(r.conditionMean).toBe(170);
    expect(r.conditionMedian).toBe(190);
    expect(r.shareDerelict).toBe(1 / 6); // one < 64 (the 50)
    expect(r.shareStruggling).toBe(2 / 6); // two < 128 (50, 100)
    expect(r.shareDerelict).toBeLessThanOrEqual(r.shareStruggling);
  });

  it('counts projects standing and alive parcels per kind (sum = parcelsAlive)', () => {
    const r = buildReport(handFixture());
    expect(r.projectsStanding).toBe(1);
    expect(r.byKind).toEqual({
      [BuiltKind.HouseSingle]: 2,
      [BuiltKind.Apartments]: 1,
      [BuiltKind.Projects]: 1,
      [BuiltKind.ParkingLot]: 2,
    });
    const kindSum = Object.values(r.byKind).reduce((a, b) => a + b, 0);
    expect(kindSum).toBe(r.parcelsAlive);
  });

  it('nulls every cohort field when each cohort has < 5 members', () => {
    const r = buildReport(handFixture()); // core = 4, periphery = 4
    expect(r.coreMean).toBeNull();
    expect(r.peripheryMean).toBeNull();
    expect(r.coreAbandonedShare).toBeNull();
    expect(r.peripheryAbandonedShare).toBeNull();
  });

  it('satisfies the store<->chronicle identity (alive = standing - abandoned + craters)', () => {
    const r = buildReport(handFixture());
    expect(r.parcelsAlive).toBe(r.preEra5Standing! - r.abandoned! + r.craters!);
  });
});

describe('buildReport: redlinedShare (share of LAND graded D, by area)', () => {
  it('counts D-graded land tiles by area, not by survivors', () => {
    const map = new GameMap(10, 10); // 100 land tiles, no water
    const parcels = new ParcelStore();
    for (let i = 0; i < 25; i++) map.redline[i] = 255; // a quarter graded D
    const r = buildReport({ map, parcels, log: [] });
    expect(r.redlinedShare).toBeCloseTo(0.25);
  });

  it('excludes water tiles from the land denominator', () => {
    const map = new GameMap(10, 10);
    const parcels = new ParcelStore();
    for (let i = 0; i < 50; i++) map.water[i] = Water.Ocean; // half the map is water
    for (let i = 50; i < 75; i++) map.redline[i] = 255; // half the LAND graded D
    const r = buildReport({ map, parcels, log: [] });
    expect(r.redlinedShare).toBeCloseTo(0.5);
  });

  it('is 0 when no ground is redlined', () => {
    const r = buildReport(handFixture()); // fixture sets no redline grade
    expect(r.redlinedShare).toBe(0);
  });
});

describe('buildReport: all-water / empty world (NaN guard + nulls)', () => {
  it('guards the divide to exactly 0 and nulls every chronicle/cohort field', () => {
    const map = new GameMap(16, 16);
    const parcels = new ParcelStore();
    const log = ['terrain', 'era1: no viable site', 'moses-century'];
    const r = buildReport({ map, parcels, log });

    expect(r.parcelsTotal).toBe(0);
    expect(r.parcelsAlive).toBe(0);
    // The NaN guard fired: 0/0 would be NaN, which is a number and would poison
    // the report silently. Assert exact 0, not merely "no throw".
    expect(Number.isNaN(r.conditionMean)).toBe(false);
    expect(r.conditionMean).toBe(0);
    expect(r.conditionMedian).toBe(0);
    expect(r.shareDerelict).toBe(0);
    expect(r.shareStruggling).toBe(0);
    expect(r.projectsStanding).toBe(0);
    expect(r.byKind).toEqual({});

    expect(r.preEra5Standing).toBeNull();
    expect(r.abandoned).toBeNull();
    expect(r.craters).toBeNull();
    expect(r.railLost).toBeNull();
    expect(r.coreMean).toBeNull();
    expect(r.peripheryMean).toBeNull();
    expect(r.coreAbandonedShare).toBeNull();
    expect(r.peripheryAbandonedShare).toBeNull();
  });
});

describe('buildReport: real pipeline (terrain + moses)', () => {
  for (const seed of FOUNDED_SEEDS) {
    it(`seed "${seed}": deterministic (two builds deep-equal)`, () => {
      expect(buildReport(runFull(seed))).toEqual(buildReport(runFull(seed)));
    });

    it(`seed "${seed}": era-5 numbers parsed (non-null) and identity holds`, () => {
      const r = buildReport(runFull(seed));
      // Loud failure if the era-5 regex (em-dash etc.) ever stops matching.
      expect(r.preEra5Standing).not.toBeNull();
      expect(r.abandoned).not.toBeNull();
      expect(r.craters).not.toBeNull();
      // Non-vacuous store<->chronicle identity (guarded to founded seeds).
      expect(r.parcelsAlive).toBe(r.preEra5Standing! - r.abandoned! + r.craters!);
    });

    it(`seed "${seed}": shares are bounded and ordered; byKind sums to alive`, () => {
      const r = buildReport(runFull(seed));
      for (const s of [r.shareDerelict, r.shareStruggling]) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
      expect(r.shareDerelict).toBeLessThanOrEqual(r.shareStruggling);
      const kindSum = Object.values(r.byKind).reduce((a, b) => a + b, 0);
      expect(kindSum).toBe(r.parcelsAlive);
    });

    it(`seed "${seed}": redlinedShare is bounded and the city has D ground`, () => {
      const r = buildReport(runFull(seed));
      expect(r.redlinedShare).toBeGreaterThan(0);
      expect(r.redlinedShare).toBeLessThanOrEqual(1);
    });

    it(`seed "${seed}": survivorship-free abandonment-share gradient holds`, () => {
      const r = buildReport(runFull(seed));
      // Both cohorts are populous at final state (>= 5 each) -> non-null.
      expect(r.coreAbandonedShare).not.toBeNull();
      expect(r.peripheryAbandonedShare).not.toBeNull();
      // Non-vacuous: the highway core loses parcels...
      expect(r.coreAbandonedShare!).toBeGreaterThan(0);
      // ...at least as fast as the far suburbs (era-3 carving + era-5 near decay).
      expect(r.coreAbandonedShare!).toBeGreaterThanOrEqual(r.peripheryAbandonedShare!);
    });

    it(`seed "${seed}": survivor means are bounded display values (no ordering)`, () => {
      const r = buildReport(runFull(seed));
      for (const m of [r.coreMean, r.peripheryMean]) {
        expect(m).not.toBeNull();
        expect(m!).toBeGreaterThanOrEqual(0);
        expect(m!).toBeLessThanOrEqual(255);
      }
    });
  }
});
