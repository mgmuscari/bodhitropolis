import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState, SEED_VOICE } from '../../src/civic/state';
import { civicTick, TRUST_FLOOR, type CivicCaps } from '../../src/civic/dynamics';

const NO_CAPS: CivicCaps = { circles: false, participatoryBudgeting: false, giftCircles: false };

function blank(w: number, h: number): { map: GameMap; parcels: ParcelStore } {
  return { map: new GameMap(w, h), parcels: new ParcelStore() };
}

/** A single low-condition parcel of `kind` at (2,2) on a 5x5 map; ecology 0. */
function oneParcel(kind: BuiltKind, condition: number): { map: GameMap; parcels: ParcelStore } {
  const { map, parcels } = blank(5, 5);
  placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind, condition });
  return { map, parcels };
}

describe('civicTick: belonging', () => {
  it('rises when a gathering place is present and the neighborhood is not isolated', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 10); // gathering, low cond, eco 0
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const before = civic.getValues(1).belonging;
    civicTick(map, parcels, partition, civic, NO_CAPS, 10);
    expect(civic.getValues(1).belonging).toBeGreaterThan(before); // gathering bonus only
  });

  it('falls when the neighborhood is isolated by fragmenting roads on its perimeter', () => {
    const { map, parcels } = oneParcel(BuiltKind.HouseSingle, 10); // no gathering, low cond, eco 0
    // ring it with busy roads so its only frontage is fragmenting barriers
    placeTransport(map, 1, 2, BuiltKind.RoadHighway);
    placeTransport(map, 3, 2, BuiltKind.RoadHighway);
    placeTransport(map, 2, 1, BuiltKind.RoadHighway);
    placeTransport(map, 2, 3, BuiltKind.RoadHighway);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const before = civic.getValues(1).belonging;
    civicTick(map, parcels, partition, civic, NO_CAPS, 10);
    expect(civic.getValues(1).belonging).toBeLessThan(before); // Moses isolation, mechanical
  });
});

describe('civicTick: voice (consumes capabilities)', () => {
  it('is byte-FLAT across N ticks while every capability is LOCKED', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    for (let t = 1; t <= 12; t++) civicTick(map, parcels, partition, civic, NO_CAPS, t);
    expect(civic.getValues(1).voice).toBe(SEED_VOICE); // unchanged, locked → flat
  });

  it('rises strictly across a quantization step once capabilities are unlocked', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200); // belonging stays held
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const caps: CivicCaps = { circles: true, participatoryBudgeting: false, giftCircles: false };
    const before = civic.getValues(1).voice;
    for (let t = 1; t <= 4; t++) civicTick(map, parcels, partition, civic, caps, t);
    expect(civic.getValues(1).voice).toBeGreaterThan(before);
  });

  it('speaks louder (more caps → larger gain) than a single capability', () => {
    const make = (caps: CivicCaps): number => {
      const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
      const partition = computeNeighborhoods(map);
      const civic = createCivicState(partition);
      civicTick(map, parcels, partition, civic, caps, 5);
      return civic.getValues(1).voice;
    };
    const one = make({ circles: true, participatoryBudgeting: false, giftCircles: false });
    const all = make({ circles: true, participatoryBudgeting: true, giftCircles: true });
    expect(all).toBeGreaterThan(one);
  });
});

describe('civicTick: trust', () => {
  it('rises when the ring holds a repair within the recent window', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    civic.recordRepair(1, 8);
    const before = civic.getValues(1).trust;
    civicTick(map, parcels, partition, civic, NO_CAPS, 10);
    expect(civic.getValues(1).trust).toBeGreaterThan(before);
  });

  it('decays to EXACTLY TRUST_FLOOR and never below when repairs are absent', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    for (let t = 1; t <= 80; t++) civicTick(map, parcels, partition, civic, NO_CAPS, t);
    expect(civic.getValues(1).trust).toBe(TRUST_FLOOR); // floored, exactly
    for (let t = 81; t <= 90; t++) civicTick(map, parcels, partition, civic, NO_CAPS, t);
    expect(civic.getValues(1).trust).toBe(TRUST_FLOOR); // still floored, never 39
  });
});

describe('civicTick: bounds, determinism, isolation', () => {
  it('keeps every value in [0,255] and trust ≥ TRUST_FLOOR across a long run', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const caps: CivicCaps = { circles: true, participatoryBudgeting: true, giftCircles: true };
    for (let t = 1; t <= 300; t++) civicTick(map, parcels, partition, civic, caps, t);
    const v = civic.getValues(1);
    for (const x of [v.belonging, v.voice, v.trust]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(255);
    }
    expect(v.trust).toBeGreaterThanOrEqual(TRUST_FLOOR);
  });

  it('is deterministic: two identical runs yield byte-equal civic snapshots', () => {
    const run = (): Uint8Array => {
      const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
      const partition = computeNeighborhoods(map);
      const civic = createCivicState(partition);
      civic.recordRepair(1, 3);
      for (let t = 1; t <= 25; t++) civicTick(map, parcels, partition, civic, NO_CAPS, t);
      return civic.snapshotBytes();
    };
    expect(run()).toEqual(run());
  });

  it('writes ONLY CivicState: the map (all 9 layers) and parcels are byte-unchanged', () => {
    const { map, parcels } = oneParcel(BuiltKind.CommunityGarden, 200);
    placeTransport(map, 1, 2, BuiltKind.RoadHighway); // some fragmentation in the fixture
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const mapBefore = map.snapshot();
    const parcelsBefore = parcels.snapshotBytes();
    const caps: CivicCaps = { circles: true, participatoryBudgeting: true, giftCircles: true };
    for (let t = 1; t <= 20; t++) civicTick(map, parcels, partition, civic, caps, t);
    expect(map.snapshot()).toBe(mapBefore);
    expect(parcels.snapshotBytes()).toEqual(parcelsBefore);
  });
});
