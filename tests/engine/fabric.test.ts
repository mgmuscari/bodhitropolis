import { describe, it, expect } from 'vitest';
import {
  BuiltKind,
  isRoadKind,
  isTransportKind,
  isBuildingKind,
  ParcelStore,
  hashWorld,
} from '../../src/engine/fabric';
import { GameMap } from '../../src/engine/map';
import { runPipeline } from '../../src/worldgen/pipeline';

describe('BuiltKind taxonomy', () => {
  it('reserves 0 for None and packs transport into 1..4', () => {
    expect(BuiltKind.None).toBe(0);
    expect(BuiltKind.RoadStreet).toBe(1);
    expect(BuiltKind.RoadAvenue).toBe(2);
    expect(BuiltKind.RoadHighway).toBe(3);
    expect(BuiltKind.Rail).toBe(4);
  });

  it('packs Moses-era buildings into 16..23', () => {
    expect(BuiltKind.HouseSingle).toBe(16);
    expect(BuiltKind.Apartments).toBe(17);
    expect(BuiltKind.Projects).toBe(18);
    expect(BuiltKind.CommercialStrip).toBe(19);
    expect(BuiltKind.Offices).toBe(20);
    expect(BuiltKind.Industrial).toBe(21);
    expect(BuiltKind.ParkingLot).toBe(22);
    expect(BuiltKind.Civic).toBe(23);
  });
});

describe('BuiltKind predicates (boundaries)', () => {
  it('isRoadKind is true on 1..3 only', () => {
    expect(isRoadKind(0)).toBe(false); // None
    expect(isRoadKind(1)).toBe(true); // RoadStreet
    expect(isRoadKind(3)).toBe(true); // RoadHighway
    expect(isRoadKind(4)).toBe(false); // Rail is transport, not road
    expect(isRoadKind(16)).toBe(false); // building
  });

  it('isTransportKind is true on 1..4 only', () => {
    expect(isTransportKind(0)).toBe(false);
    expect(isTransportKind(1)).toBe(true);
    expect(isTransportKind(4)).toBe(true); // Rail
    expect(isTransportKind(5)).toBe(false);
    expect(isTransportKind(16)).toBe(false);
  });

  it('isBuildingKind is true on 16..47 only', () => {
    expect(isBuildingKind(15)).toBe(false);
    expect(isBuildingKind(16)).toBe(true); // first building
    expect(isBuildingKind(23)).toBe(true); // last defined Moses building
    expect(isBuildingKind(47)).toBe(true); // top of reserved range
    expect(isBuildingKind(48)).toBe(false); // tech-tree era reserved, not a building yet
    expect(isBuildingKind(0)).toBe(false);
    expect(isBuildingKind(4)).toBe(false); // transport
  });
});

describe('ParcelStore add/get', () => {
  it('roundtrips a parcel and applies defaults (density 1, condition 255)', () => {
    const store = new ParcelStore();
    const i = store.add({ x: 3, y: 4, width: 2, height: 3, kind: BuiltKind.Apartments });
    expect(i).toBe(0);
    const p = store.get(i);
    expect(p.x).toBe(3);
    expect(p.y).toBe(4);
    expect(p.width).toBe(2);
    expect(p.height).toBe(3);
    expect(p.kind).toBe(BuiltKind.Apartments);
    expect(p.density).toBe(1); // default
    expect(p.condition).toBe(255); // default
  });

  it('honours explicit density/condition and increments index/count', () => {
    const store = new ParcelStore();
    expect(store.count()).toBe(0);
    const a = store.add({ x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 5, condition: 120 });
    const b = store.add({ x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.Offices });
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(store.count()).toBe(2);
    expect(store.get(a).density).toBe(5);
    expect(store.get(a).condition).toBe(120);
    expect(store.get(b).kind).toBe(BuiltKind.Offices);
  });

  it('exposes scalar accessors matching get()', () => {
    const store = new ParcelStore();
    const i = store.add({ x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial, density: 3, condition: 200 });
    expect(store.kindAt(i)).toBe(BuiltKind.Industrial);
    expect(store.densityAt(i)).toBe(3);
    expect(store.conditionAt(i)).toBe(200);
  });
});

describe('ParcelStore setCondition / setDensity', () => {
  it('setCondition clamps to 0..255', () => {
    const store = new ParcelStore();
    const i = store.add({ x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.Civic });
    store.setCondition(i, 300);
    expect(store.conditionAt(i)).toBe(255);
    store.setCondition(i, -5);
    expect(store.conditionAt(i)).toBe(0);
    store.setCondition(i, 128);
    expect(store.conditionAt(i)).toBe(128);
  });

  it('setDensity updates the stored density', () => {
    const store = new ParcelStore();
    const i = store.add({ x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.Projects });
    store.setDensity(i, 7);
    expect(store.densityAt(i)).toBe(7);
  });
});

describe('ParcelStore snapshotBytes', () => {
  function filled(): ParcelStore {
    const s = new ParcelStore();
    s.add({ x: 1, y: 2, width: 2, height: 2, kind: BuiltKind.Apartments, density: 3, condition: 200 });
    s.add({ x: 5, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    return s;
  }

  it('is byte-identical for two stores built the same way', () => {
    expect(filled().snapshotBytes()).toEqual(filled().snapshotBytes());
  });

  it('differs when condition changes', () => {
    const a = filled();
    const b = filled();
    b.setCondition(0, 199);
    expect(a.snapshotBytes()).not.toEqual(b.snapshotBytes());
  });

  it('differs when density changes', () => {
    const a = filled();
    const b = filled();
    b.setDensity(1, 9);
    expect(a.snapshotBytes()).not.toEqual(b.snapshotBytes());
  });

  it('differs when footprint or kind changes', () => {
    const base = filled().snapshotBytes();

    const k = filled();
    k.add({ x: 8, y: 8, width: 1, height: 1, kind: BuiltKind.Offices });
    expect(k.snapshotBytes()).not.toEqual(base);

    const f = new ParcelStore();
    f.add({ x: 1, y: 2, width: 3, height: 2, kind: BuiltKind.Apartments, density: 3, condition: 200 });
    f.add({ x: 5, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(f.snapshotBytes()).not.toEqual(base);

    const kind = new ParcelStore();
    kind.add({ x: 1, y: 2, width: 2, height: 2, kind: BuiltKind.Projects, density: 3, condition: 200 });
    kind.add({ x: 5, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(kind.snapshotBytes()).not.toEqual(base);
  });
});

describe('runPipeline parcel integration', () => {
  it('provides an empty ParcelStore on the WorldState', () => {
    const world = runPipeline({ seed: 'fabric', width: 8, height: 8 }, []);
    expect(world.parcels).toBeInstanceOf(ParcelStore);
    expect(world.parcels.count()).toBe(0);
  });
});

describe('hashWorld asymmetry pin', () => {
  it('setCondition changes hashWorld but not map.snapshot()', () => {
    const map = new GameMap(8, 8);
    const parcels = new ParcelStore();
    const world = { map, parcels, seed: 'x', log: [] as string[] };
    const i = parcels.add({ x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });

    const hashBefore = hashWorld(world);
    const mapBefore = map.snapshot();

    parcels.setCondition(i, 100);

    // Parcel attributes live in the store, not the map: the canonical world
    // hash must move, the map snapshot must not. This pins the intended split.
    expect(hashWorld(world)).not.toBe(hashBefore);
    expect(map.snapshot()).toBe(mapBefore);
  });

  it('is identical for two empty worlds of the same size and differs from a populated one', () => {
    const empty = () => ({ map: new GameMap(8, 8), parcels: new ParcelStore(), seed: 's', log: [] as string[] });
    expect(hashWorld(empty())).toBe(hashWorld(empty()));

    const populated = empty();
    populated.parcels.add({ x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(hashWorld(populated)).not.toBe(hashWorld(empty()));
  });
});
