import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport, convertParcel } from '../../src/engine/fabric';
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

describe('civicTick: gathering places (Park is one, RewildedLand is not)', () => {
  it('a Park gives the gathering belonging bonus; RewildedLand does not', () => {
    const park = oneParcel(BuiltKind.Park, 10); // gathering, low cond, eco 0
    const pPart = computeNeighborhoods(park.map);
    const pCivic = createCivicState(pPart);
    const pBefore = pCivic.getValues(1).belonging;
    civicTick(park.map, park.parcels, pPart, pCivic, NO_CAPS, 10);
    expect(pCivic.getValues(1).belonging).toBeGreaterThan(pBefore); // Park is a gathering place

    const wild = oneParcel(BuiltKind.RewildedLand, 10); // wild, not social
    const wPart = computeNeighborhoods(wild.map);
    const wCivic = createCivicState(wPart);
    const wBefore = wCivic.getValues(1).belonging;
    civicTick(wild.map, wild.parcels, wPart, wCivic, NO_CAPS, 10);
    expect(wCivic.getValues(1).belonging).toBe(wBefore); // no gathering bonus — flat
  });

  it('a CommunityGarden→Park rezone is belonging-neutral (gathering bonus preserved)', () => {
    // Hold condition at 255 so convertParcel's condition reset is a no-op and the
    // test isolates the gathering bonus: both are gathering kinds, so belonging must
    // land identically (Park ∈ GATHERING_KINDS, exactly like the CommunityGarden).
    const garden = oneParcel(BuiltKind.CommunityGarden, 255);
    const gPart = computeNeighborhoods(garden.map);
    const gCivic = createCivicState(gPart);
    civicTick(garden.map, garden.parcels, gPart, gCivic, NO_CAPS, 10);
    const gardenBelonging = gCivic.getValues(1).belonging;

    const park = oneParcel(BuiltKind.CommunityGarden, 255);
    expect(convertParcel(park.map, park.parcels, 2, 2, BuiltKind.Park)).toBe(true);
    const pPart = computeNeighborhoods(park.map);
    const pCivic = createCivicState(pPart);
    civicTick(park.map, park.parcels, pPart, pCivic, NO_CAPS, 10);
    expect(pCivic.getValues(1).belonging).toBe(gardenBelonging); // gathering preserved → neutral
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

describe('civicTick: over-policing (precinct suppresses voice & trust in redlined zones)', () => {
  function hood(withPrecinct: boolean, grade: number) {
    const { map, parcels } = blank(5, 5);
    map.redline.fill(grade);
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 200 });
    if (withPrecinct) {
      placeParcel(map, parcels, { x: 2, y: 3, width: 1, height: 1, kind: BuiltKind.Precinct, condition: 200 });
    }
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const nid = partition.tileToNeighborhood[map.idx(2, 2)]!;
    return { map, parcels, partition, civic, nid };
  }

  it('a precinct in a redlined neighborhood suppresses voice & trust vs an unpoliced control', () => {
    const policed = hood(true, 255);
    const control = hood(false, 255);
    civicTick(policed.map, policed.parcels, policed.partition, policed.civic, NO_CAPS, 10);
    civicTick(control.map, control.parcels, control.partition, control.civic, NO_CAPS, 10);
    expect(policed.civic.getValues(policed.nid).voice).toBeLessThan(control.civic.getValues(control.nid).voice);
    expect(policed.civic.getValues(policed.nid).trust).toBeLessThan(control.civic.getValues(control.nid).trust);
  });

  it('a precinct in a GREENLINED neighborhood does not suppress (intensity scales with grade)', () => {
    const greenPoliced = hood(true, 0);
    const control = hood(false, 0);
    civicTick(greenPoliced.map, greenPoliced.parcels, greenPoliced.partition, greenPoliced.civic, NO_CAPS, 10);
    civicTick(control.map, control.parcels, control.partition, control.civic, NO_CAPS, 10);
    expect(greenPoliced.civic.getValues(greenPoliced.nid).voice).toBe(control.civic.getValues(control.nid).voice);
  });

  it('community alternatives (caps) recover the voice the precinct silences', () => {
    const all: CivicCaps = { circles: true, participatoryBudgeting: true, giftCircles: true };
    const organized = hood(true, 255);
    const silenced = hood(true, 255);
    civicTick(organized.map, organized.parcels, organized.partition, organized.civic, all, 10);
    civicTick(silenced.map, silenced.parcels, silenced.partition, silenced.civic, NO_CAPS, 10);
    expect(organized.civic.getValues(organized.nid).voice).toBeGreaterThan(
      silenced.civic.getValues(silenced.nid).voice,
    );
  });

  it('honors the trust floor even under sustained over-policing', () => {
    const policed = hood(true, 255);
    for (let t = 1; t <= 120; t++) {
      civicTick(policed.map, policed.parcels, policed.partition, policed.civic, NO_CAPS, t);
    }
    expect(policed.civic.getValues(policed.nid).trust).toBe(TRUST_FLOOR);
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
