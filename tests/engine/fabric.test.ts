import { describe, it, expect } from 'vitest';
import {
  BuiltKind,
  isRoadKind,
  isTransportKind,
  isBuildingKind,
  ParcelStore,
  hashWorld,
  canPlaceParcel,
  placeParcel,
  canPlaceTransport,
  placeTransport,
  checkParcelAgreement,
  transportMask,
  transportCategory,
  parcelTouchesRoad,
  demolishParcel,
  demolishTransportAt,
  TRANSPORT_CONVERSIONS,
  canConvertTransport,
  convertTransport,
} from '../../src/engine/fabric';
import { GameMap, Water } from '../../src/engine/map';
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

  it('packs tech-tree transit kinds into 5..9', () => {
    expect(BuiltKind.BikePath).toBe(5);
    expect(BuiltKind.Streetcar).toBe(6);
    expect(BuiltKind.QuietStreet).toBe(7);
    expect(BuiltKind.ElevatedRail).toBe(8);
    expect(BuiltKind.Promenade).toBe(9);
  });

  it('packs tech-tree-era buildings into 48..60', () => {
    expect(BuiltKind.Parklet).toBe(48);
    expect(BuiltKind.CommunityGarden).toBe(49);
    expect(BuiltKind.CompostHub).toBe(50);
    expect(BuiltKind.VerticalFarm).toBe(51);
    expect(BuiltKind.WastewaterWorks).toBe(52);
    expect(BuiltKind.EnergyNode).toBe(53);
    expect(BuiltKind.AINode).toBe(54);
    expect(BuiltKind.ADU).toBe(55);
    expect(BuiltKind.CoopHousing).toBe(56);
    expect(BuiltKind.Commune).toBe(57);
    expect(BuiltKind.Bazaar).toBe(58);
    expect(BuiltKind.MakerSpace).toBe(59);
    expect(BuiltKind.HealingCommons).toBe(60);
  });

  it('assigns a unique code to every BuiltKind (no collisions)', () => {
    const values = Object.values(BuiltKind);
    expect(new Set(values).size).toBe(values.length);
    // Every code sits in an honest band: 0, transport 1..15, buildings 16..127.
    for (const v of values) {
      const inBand = v === 0 || (v >= 1 && v <= 15) || (v >= 16 && v <= 127);
      expect(inBand, `code ${v} is outside the reserved bands`).toBe(true);
    }
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

  it('isTransportKind is true across the widened transport band 1..15', () => {
    expect(isTransportKind(0)).toBe(false);
    expect(isTransportKind(1)).toBe(true);
    expect(isTransportKind(4)).toBe(true); // Rail
    expect(isTransportKind(5)).toBe(true); // BikePath — now a transport kind
    expect(isTransportKind(9)).toBe(true); // Promenade
    expect(isTransportKind(15)).toBe(true); // top of the reserved transport band
    expect(isTransportKind(16)).toBe(false); // building
  });

  it('isBuildingKind is true across the widened building band 16..127', () => {
    expect(isBuildingKind(15)).toBe(false);
    expect(isBuildingKind(16)).toBe(true); // first building
    expect(isBuildingKind(23)).toBe(true); // last defined Moses building
    expect(isBuildingKind(47)).toBe(true); // old top of reserved range
    expect(isBuildingKind(48)).toBe(true); // Parklet — now a building kind
    expect(isBuildingKind(60)).toBe(true); // HealingCommons
    expect(isBuildingKind(127)).toBe(true); // top of the widened building band
    expect(isBuildingKind(128)).toBe(false); // past the band
    expect(isBuildingKind(0)).toBe(false);
    expect(isBuildingKind(4)).toBe(false); // transport
  });
});

describe('transportCategory (connection table)', () => {
  // 0 = not transport, 1 = road, 2 = rail, 3 = bike, 4 = pedestrian.
  it('classifies classic transport: roads share road, rail is rail', () => {
    expect(transportCategory(BuiltKind.RoadStreet)).toBe(1);
    expect(transportCategory(BuiltKind.RoadAvenue)).toBe(1);
    expect(transportCategory(BuiltKind.RoadHighway)).toBe(1);
    expect(transportCategory(BuiltKind.Rail)).toBe(2);
  });

  it('classifies each transit kind by its connection category', () => {
    expect(transportCategory(BuiltKind.BikePath)).toBe(3); // bike
    expect(transportCategory(BuiltKind.Streetcar)).toBe(2); // shares rail
    expect(transportCategory(BuiltKind.QuietStreet)).toBe(1); // reads as road (masks)
    expect(transportCategory(BuiltKind.ElevatedRail)).toBe(2); // shares rail
    expect(transportCategory(BuiltKind.Promenade)).toBe(4); // pedestrian
  });

  it('returns 0 for non-transport kinds (None, buildings)', () => {
    expect(transportCategory(BuiltKind.None)).toBe(0);
    expect(transportCategory(BuiltKind.HouseSingle)).toBe(0);
    expect(transportCategory(BuiltKind.Parklet)).toBe(0);
    expect(transportCategory(99)).toBe(0);
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

describe('canPlaceParcel', () => {
  it('accepts an in-bounds, empty, all-land footprint', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceParcel(map, 1, 1, 3, 3)).toBe(true);
  });

  it('rejects an out-of-bounds footprint', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceParcel(map, 7, 7, 2, 2)).toBe(false); // spills off east/south edge
    expect(canPlaceParcel(map, -1, 0, 1, 1)).toBe(false);
  });

  it('rejects a footprint containing any water tile', () => {
    const map = new GameMap(8, 8);
    map.setWater(2, 2, Water.River); // one tile inside the 2x2 at (1,1)
    expect(canPlaceParcel(map, 1, 1, 2, 2)).toBe(false);
  });

  it('rejects overlap with an existing built tile (road)', () => {
    const map = new GameMap(8, 8);
    placeTransport(map, 2, 2, BuiltKind.RoadStreet);
    expect(canPlaceParcel(map, 1, 1, 2, 2)).toBe(false);
  });

  it('rejects overlap with an existing parcel', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(canPlaceParcel(map, 1, 1, 2, 2)).toBe(false);
  });

  it('rejects footprint sizes outside 1..3', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceParcel(map, 0, 0, 4, 1)).toBe(false);
    expect(canPlaceParcel(map, 0, 0, 1, 4)).toBe(false);
    expect(canPlaceParcel(map, 0, 0, 0, 1)).toBe(false);
  });
});

describe('placeParcel', () => {
  it('writes kind + parcel id to every footprint tile, store agrees', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const idx = placeParcel(map, store, { x: 2, y: 3, width: 2, height: 2, kind: BuiltKind.Offices, density: 4, condition: 200 });
    expect(idx).toBe(0);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(map.getBuilt(2 + dx, 3 + dy)).toBe(BuiltKind.Offices);
        expect(map.getParcel(2 + dx, 3 + dy)).toBe(idx + 1);
      }
    }
    // tile outside footprint untouched
    expect(map.getBuilt(2, 5)).toBe(0);
    expect(checkParcelAgreement(map, store)).toEqual([]);
  });

  it('returns -1 and writes nothing on an invalid placement', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    map.setWater(0, 0, Water.Ocean);
    const idx = placeParcel(map, store, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(idx).toBe(-1);
    expect(store.count()).toBe(0);
    expect(map.getBuilt(0, 0)).toBe(0);
    expect(map.getParcel(0, 0)).toBe(0);
  });
});

describe('canPlaceTransport / placeTransport', () => {
  it('places a road on empty land and rejects water/building tiles', () => {
    const map = new GameMap(8, 8);
    expect(placeTransport(map, 1, 1, BuiltKind.RoadStreet)).toBe(true);
    expect(map.getBuilt(1, 1)).toBe(BuiltKind.RoadStreet);

    map.setWater(3, 3, Water.Lake);
    expect(canPlaceTransport(map, 3, 3, BuiltKind.RoadStreet)).toBe(false);
    expect(placeTransport(map, 3, 3, BuiltKind.RoadStreet)).toBe(false);

    const store = new ParcelStore();
    placeParcel(map, store, { x: 5, y: 5, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(canPlaceTransport(map, 5, 5, BuiltKind.RoadStreet)).toBe(false);
  });

  it('merges a road junction to the higher-capacity kind, order-independent', () => {
    const a = new GameMap(8, 8);
    placeTransport(a, 4, 4, BuiltKind.RoadStreet);
    expect(placeTransport(a, 4, 4, BuiltKind.RoadAvenue)).toBe(true);
    expect(a.getBuilt(4, 4)).toBe(BuiltKind.RoadAvenue); // max(street, avenue)

    const b = new GameMap(8, 8);
    placeTransport(b, 4, 4, BuiltKind.RoadAvenue);
    expect(placeTransport(b, 4, 4, BuiltKind.RoadStreet)).toBe(true);
    expect(b.getBuilt(4, 4)).toBe(BuiltKind.RoadAvenue); // same result, order-independent
  });

  it('allows rail-on-rail but rejects road<->rail crossings', () => {
    const map = new GameMap(8, 8);
    placeTransport(map, 2, 2, BuiltKind.Rail);
    expect(placeTransport(map, 2, 2, BuiltKind.Rail)).toBe(true);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.Rail);

    // road onto rail rejected
    expect(canPlaceTransport(map, 2, 2, BuiltKind.RoadStreet)).toBe(false);
    expect(placeTransport(map, 2, 2, BuiltKind.RoadStreet)).toBe(false);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.Rail); // unchanged

    // rail onto road rejected
    placeTransport(map, 5, 5, BuiltKind.RoadAvenue);
    expect(canPlaceTransport(map, 5, 5, BuiltKind.Rail)).toBe(false);
    expect(placeTransport(map, 5, 5, BuiltKind.Rail)).toBe(false);
    expect(map.getBuilt(5, 5)).toBe(BuiltKind.RoadAvenue);
  });

  it('rejects non-transport kinds', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceTransport(map, 1, 1, BuiltKind.HouseSingle)).toBe(false);
  });
});

describe('canPlaceTransport transit-kind placement rule (5..9 on empty land only)', () => {
  // build-tools replaces the old blanket fence: transit kinds 5..9 are now
  // placeable, but ONLY on empty land. They never merge and never cross — the
  // junction-merge predicate (isRoadKind && isRoadKind / Rail===Rail) is
  // unchanged, and isRoadKind(7..9) is false, so every >4 kind is excluded from
  // merging on both sides. (This is the REQUIRED rewrite of the old fence test;
  // the no-merge / no-crossing property it carried is preserved below.)
  const TRANSIT_KINDS = [
    BuiltKind.BikePath,
    BuiltKind.Streetcar,
    BuiltKind.QuietStreet,
    BuiltKind.ElevatedRail,
    BuiltKind.Promenade,
  ];

  for (const kind of TRANSIT_KINDS) {
    it(`places transit kind ${kind} on empty land`, () => {
      const map = new GameMap(8, 8);
      expect(canPlaceTransport(map, 1, 1, kind)).toBe(true);
      expect(placeTransport(map, 1, 1, kind)).toBe(true);
      expect(map.getBuilt(1, 1)).toBe(kind);
    });

    it(`refuses transit kind ${kind} onto an occupied tile (no merge / no crossing)`, () => {
      // Onto a road, a rail, the same transit kind, and a building: all refused,
      // tile left intact. Transit kinds reach a tile only via the empty-land branch.
      for (const occupant of [BuiltKind.RoadStreet, BuiltKind.Rail, kind]) {
        const map = new GameMap(8, 8);
        expect(placeTransport(map, 2, 2, occupant)).toBe(true);
        expect(canPlaceTransport(map, 2, 2, kind)).toBe(false);
        expect(placeTransport(map, 2, 2, kind)).toBe(false);
        expect(map.getBuilt(2, 2)).toBe(occupant);
      }

      const map = new GameMap(8, 8);
      const store = new ParcelStore();
      placeParcel(map, store, { x: 4, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
      expect(canPlaceTransport(map, 4, 4, kind)).toBe(false);
      expect(placeTransport(map, 4, 4, kind)).toBe(false);
      expect(map.getBuilt(4, 4)).toBe(BuiltKind.HouseSingle);
    });
  }
});

describe('transport merge-hazard guard (the predicate stays isRoadKind, not category)', () => {
  // QuietStreet(7) is connection-category road, so a transportCategory-based merge
  // test would admit Street(1)<->QuietStreet(7) and resolve max(1,7)=7 — the exact
  // capacity-unsafe regression. Because the predicate stays isRoadKind (false for 7),
  // placing a classic road onto a QuietStreet must be REFUSED. The tile already
  // holds 7, and max(7, 1..3)=7 no-ops it either way, so the RETURN VALUE is the
  // ONLY observable tell of the regression — asserting `built` alone would pass
  // under the bug.
  const ROADS = [BuiltKind.RoadStreet, BuiltKind.RoadAvenue, BuiltKind.RoadHighway];

  for (const road of ROADS) {
    it(`refuses road kind ${road} onto a QuietStreet (return value is the only tell)`, () => {
      const map = new GameMap(8, 8);
      expect(placeTransport(map, 3, 3, BuiltKind.QuietStreet)).toBe(true);
      expect(map.getBuilt(3, 3)).toBe(BuiltKind.QuietStreet); // 7
      expect(placeTransport(map, 3, 3, road)).toBe(false); // the tell
      expect(map.getBuilt(3, 3)).toBe(BuiltKind.QuietStreet); // unchanged, still 7
    });

    it(`refuses a QuietStreet onto road kind ${road} (empty-only fence)`, () => {
      const map = new GameMap(8, 8);
      expect(placeTransport(map, 3, 3, road)).toBe(true);
      expect(placeTransport(map, 3, 3, BuiltKind.QuietStreet)).toBe(false);
      expect(map.getBuilt(3, 3)).toBe(road); // unchanged
    });
  }
});

describe('TRANSPORT_CONVERSIONS table + canConvertTransport / convertTransport', () => {
  // Every designed (from -> to) entry. `from` kinds are all classic 1..4 OR
  // empty-land-placeable transit kinds, so each fixture can be placed directly.
  const CONVERSION_CASES: ReadonlyArray<readonly [number, number]> = [
    [BuiltKind.RoadStreet, BuiltKind.QuietStreet],
    [BuiltKind.RoadStreet, BuiltKind.Promenade],
    [BuiltKind.RoadStreet, BuiltKind.BikePath],
    [BuiltKind.RoadAvenue, BuiltKind.RoadStreet],
    [BuiltKind.RoadAvenue, BuiltKind.QuietStreet],
    [BuiltKind.RoadHighway, BuiltKind.RoadAvenue],
    [BuiltKind.Rail, BuiltKind.Streetcar],
  ];

  it('exposes the designed conversion entries in order', () => {
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.RoadStreet)!]).toEqual([
      BuiltKind.QuietStreet,
      BuiltKind.Promenade,
      BuiltKind.BikePath,
    ]);
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.RoadAvenue)!]).toEqual([
      BuiltKind.RoadStreet,
      BuiltKind.QuietStreet,
    ]);
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.RoadHighway)!]).toEqual([BuiltKind.RoadAvenue]);
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.Rail)!]).toEqual([BuiltKind.Streetcar]);
  });

  for (const [from, to] of CONVERSION_CASES) {
    it(`converts ${from} -> ${to} in place, touching only that tile`, () => {
      const map = new GameMap(8, 8);
      expect(placeTransport(map, 3, 3, from)).toBe(true);
      placeTransport(map, 5, 5, BuiltKind.RoadStreet); // witness tile, must survive
      expect(canConvertTransport(map, 3, 3, to)).toBe(true);
      expect(convertTransport(map, 3, 3, to)).toBe(true);
      expect(map.getBuilt(3, 3)).toBe(to);
      expect(map.getParcel(3, 3)).toBe(0); // never touches the parcel layer
      expect(map.getBuilt(5, 5)).toBe(BuiltKind.RoadStreet); // map otherwise stable
    });
  }

  // Non-entries: reverse directions, off-table classic targets, empty/building
  // tiles. Each rejected by BOTH canConvertTransport and convertTransport, with no
  // mutation.
  const REJECT_CASES: ReadonlyArray<readonly [number, number]> = [
    [BuiltKind.RoadStreet, BuiltKind.RoadAvenue], // Street has no avenue entry
    [BuiltKind.RoadStreet, BuiltKind.RoadHighway],
    [BuiltKind.RoadStreet, BuiltKind.Rail],
    [BuiltKind.RoadAvenue, BuiltKind.RoadHighway],
    [BuiltKind.RoadHighway, BuiltKind.RoadStreet],
    [BuiltKind.QuietStreet, BuiltKind.RoadStreet], // reverse of a real entry
    [BuiltKind.Streetcar, BuiltKind.Rail], // reverse of Rail -> Streetcar
    [BuiltKind.Rail, BuiltKind.ElevatedRail], // Rail only converts to Streetcar
  ];

  for (const [from, to] of REJECT_CASES) {
    it(`rejects non-entry ${from} -> ${to} without mutation`, () => {
      const map = new GameMap(8, 8);
      expect(placeTransport(map, 2, 2, from)).toBe(true);
      expect(canConvertTransport(map, 2, 2, to)).toBe(false);
      expect(convertTransport(map, 2, 2, to)).toBe(false);
      expect(map.getBuilt(2, 2)).toBe(from);
    });
  }

  it('rejects converting an empty tile', () => {
    const map = new GameMap(8, 8);
    expect(canConvertTransport(map, 1, 1, BuiltKind.QuietStreet)).toBe(false);
    expect(convertTransport(map, 1, 1, BuiltKind.QuietStreet)).toBe(false);
    expect(map.getBuilt(1, 1)).toBe(0);
  });

  it('rejects converting a building tile without mutation', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(canConvertTransport(map, 2, 2, BuiltKind.QuietStreet)).toBe(false);
    expect(convertTransport(map, 2, 2, BuiltKind.QuietStreet)).toBe(false);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.HouseSingle);
    expect(map.getParcel(2, 2)).toBe(1);
  });

  it('rejects an out-of-bounds conversion', () => {
    const map = new GameMap(8, 8);
    expect(canConvertTransport(map, -1, 0, BuiltKind.QuietStreet)).toBe(false);
    expect(convertTransport(map, 8, 8, BuiltKind.QuietStreet)).toBe(false);
  });

  it('leaves the bidirectional agreement sweep clean after a frontage conversion', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Apartments });
    placeTransport(map, 1, 2, BuiltKind.RoadStreet); // west frontage
    expect(convertTransport(map, 1, 2, BuiltKind.QuietStreet)).toBe(true);
    expect(checkParcelAgreement(map, store)).toEqual([]);
  });
});

describe('checkParcelAgreement (bidirectional sweep)', () => {
  it('passes a clean placement and is non-vacuous (catches corruption)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 1, y: 1, width: 2, height: 2, kind: BuiltKind.Apartments });
    placeTransport(map, 4, 1, BuiltKind.RoadStreet);
    expect(checkParcelAgreement(map, store)).toEqual([]);

    // Reverse direction: a stray parcel id over a road tile is a violation.
    const stray = new GameMap(8, 8);
    const s2 = new ParcelStore();
    placeTransport(stray, 3, 3, BuiltKind.RoadStreet);
    stray.setParcel(3, 3, 1); // corruption: parcel id on a non-building tile
    expect(checkParcelAgreement(stray, s2).length).toBeGreaterThan(0);
  });

  it('flags a building tile with no parcel id (forward direction)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    map.setBuilt(2, 2, BuiltKind.HouseSingle); // building kind, but no parcel id
    expect(checkParcelAgreement(map, store).length).toBeGreaterThan(0);
  });

  it('flags a parcel id whose store kind disagrees with the tile', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    map.setBuilt(1, 1, BuiltKind.Offices); // tile kind no longer matches store kind
    expect(checkParcelAgreement(map, store).length).toBeGreaterThan(0);
  });
});

const N = 1;
const E = 2;
const S = 4;
const W = 8;

describe('transportMask', () => {
  it('returns 0 on a non-transport tile', () => {
    const map = new GameMap(5, 5);
    expect(transportMask(map, 2, 2)).toBe(0);
  });

  it('sets bits for all 16 N/E/S/W road-neighbour configurations', () => {
    for (let config = 0; config < 16; config++) {
      const map = new GameMap(5, 5);
      placeTransport(map, 2, 2, BuiltKind.RoadStreet); // center road
      if (config & N) placeTransport(map, 2, 1, BuiltKind.RoadStreet);
      if (config & E) placeTransport(map, 3, 2, BuiltKind.RoadStreet);
      if (config & S) placeTransport(map, 2, 3, BuiltKind.RoadStreet);
      if (config & W) placeTransport(map, 1, 2, BuiltKind.RoadStreet);
      expect(transportMask(map, 2, 2)).toBe(config);
    }
  });

  it('does not connect a road tile to a rail neighbour (different category)', () => {
    const road = new GameMap(5, 5);
    placeTransport(road, 2, 2, BuiltKind.RoadStreet);
    placeTransport(road, 2, 1, BuiltKind.Rail); // north neighbour is rail
    expect(transportMask(road, 2, 2)).toBe(0);

    const rail = new GameMap(5, 5);
    placeTransport(rail, 2, 2, BuiltKind.Rail);
    placeTransport(rail, 2, 1, BuiltKind.RoadStreet); // north neighbour is road
    expect(transportMask(rail, 2, 2)).toBe(0);
  });

  it('connects rail to rail neighbours', () => {
    const map = new GameMap(5, 5);
    placeTransport(map, 2, 2, BuiltKind.Rail);
    placeTransport(map, 2, 1, BuiltKind.Rail);
    placeTransport(map, 3, 2, BuiltKind.Rail);
    expect(transportMask(map, 2, 2)).toBe(N | E);
  });

  it('sets all four bits at a 4-way junction (merged street/avenue crossing)', () => {
    const map = new GameMap(5, 5);
    // Avenue E-W across row 2, Street N-S down col 2: the center merges and all
    // four neighbours are roads.
    for (let x = 0; x < 5; x++) placeTransport(map, x, 2, BuiltKind.RoadAvenue);
    for (let y = 0; y < 5; y++) placeTransport(map, 2, y, BuiltKind.RoadStreet);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.RoadAvenue); // merged to max
    expect(transportMask(map, 2, 2)).toBe(N | E | S | W);
  });

  it('treats out-of-bounds neighbours as unset at corners', () => {
    const map = new GameMap(5, 5);
    placeTransport(map, 0, 0, BuiltKind.RoadStreet); // NW corner
    placeTransport(map, 1, 0, BuiltKind.RoadStreet); // east neighbour
    placeTransport(map, 0, 1, BuiltKind.RoadStreet); // south neighbour
    // N and W are off-map => unset; only E and S set.
    expect(transportMask(map, 0, 0)).toBe(E | S);
  });
});

describe('transportMask: transit category connections', () => {
  // The placement fence blocks placeTransport for kinds 5..9, so these category
  // fixtures are injected directly via map.setBuilt — the mask only reads the
  // built layer through transportCategory and must connect by shared category.
  it('connects a streetcar to a rail neighbour (shared rail category)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.Streetcar); // category rail
    map.setBuilt(2, 1, BuiltKind.Rail); // north rail — connects
    map.setBuilt(3, 2, BuiltKind.RoadStreet); // east road — different category
    expect(transportMask(map, 2, 2)).toBe(N);
  });

  it('connects a bike path only to another bike path', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.BikePath); // category bike
    map.setBuilt(2, 1, BuiltKind.BikePath); // north bike — connects
    map.setBuilt(1, 2, BuiltKind.RoadStreet); // west road — no connect
    map.setBuilt(3, 2, BuiltKind.Rail); // east rail — no connect
    expect(transportMask(map, 2, 2)).toBe(N);
  });

  it('connects a quiet street to a road neighbour (reads as road for masks)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.QuietStreet); // category road
    map.setBuilt(1, 2, BuiltKind.RoadStreet); // west road — connects
    map.setBuilt(2, 1, BuiltKind.Rail); // north rail — no connect
    expect(transportMask(map, 2, 2)).toBe(W);
  });

  it('connects a promenade only to another promenade (pedestrian category)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.Promenade); // category pedestrian
    map.setBuilt(2, 3, BuiltKind.Promenade); // south promenade — connects
    map.setBuilt(1, 2, BuiltKind.RoadStreet); // west road — no connect
    expect(transportMask(map, 2, 2)).toBe(S);
  });
});

describe('parcelTouchesRoad', () => {
  it('is true when a road runs along one footprint edge', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Apartments });
    placeTransport(map, 1, 2, BuiltKind.RoadStreet); // west of (2,2): 4-adjacent
    expect(parcelTouchesRoad(map, store, i)).toBe(true);
  });

  it('is false for an isolated parcel', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.Offices });
    expect(parcelTouchesRoad(map, store, i)).toBe(false);
  });

  it('is false when the only road is diagonal to a corner (diagonals do not count)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 1, y: 1, width: 3, height: 3, kind: BuiltKind.Projects });
    placeTransport(map, 0, 0, BuiltKind.RoadStreet); // diagonal to corner (1,1)
    expect(parcelTouchesRoad(map, store, i)).toBe(false);
  });

  it('does not count rail as road frontage', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Industrial });
    placeTransport(map, 1, 2, BuiltKind.Rail); // rail along the west edge
    expect(parcelTouchesRoad(map, store, i)).toBe(false);
  });
});

describe('ParcelStore aliveness (tombstones)', () => {
  it('add marks a parcel alive; aliveCount and aliveIndices track it', () => {
    const map = new GameMap(16, 16);
    const store = new ParcelStore();
    const a = placeParcel(map, store, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const b = placeParcel(map, store, { x: 4, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const c = placeParcel(map, store, { x: 7, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(store.isAlive(a)).toBe(true);
    expect(store.isAlive(b)).toBe(true);
    expect(store.isAlive(c)).toBe(true);
    expect(store.aliveCount()).toBe(3);
    expect(store.aliveIndices()).toEqual([a, b, c]);
  });

  it('aliveIndices skips dead entries and stays ascending', () => {
    const map = new GameMap(16, 16);
    const store = new ParcelStore();
    const a = placeParcel(map, store, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const b = placeParcel(map, store, { x: 4, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const c = placeParcel(map, store, { x: 7, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(demolishParcel(map, store, b)).toBe(true);
    expect(store.isAlive(b)).toBe(false);
    expect(store.aliveCount()).toBe(2);
    expect(store.aliveIndices()).toEqual([a, c]);
  });
});

describe('demolishParcel', () => {
  it('clears every footprint tile and only those tiles; neighbours untouched', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.Apartments });
    const j = placeParcel(map, store, { x: 7, y: 7, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeTransport(map, 2, 3, BuiltKind.RoadStreet); // west frontage, must survive

    expect(demolishParcel(map, store, i)).toBe(true);

    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(map.getBuilt(3 + dx, 3 + dy)).toBe(0);
        expect(map.getParcel(3 + dx, 3 + dy)).toBe(0);
      }
    }
    // Neighbouring parcel, the frontage road, and an empty tile are all untouched.
    expect(map.getBuilt(7, 7)).toBe(BuiltKind.HouseSingle);
    expect(store.isAlive(j)).toBe(true);
    expect(map.getBuilt(2, 3)).toBe(BuiltKind.RoadStreet);
    expect(map.getBuilt(5, 3)).toBe(0);
    expect(store.isAlive(i)).toBe(false);
  });

  it('leaves the bidirectional agreement sweep clean', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 3, width: 3, height: 3, kind: BuiltKind.Projects });
    placeParcel(map, store, { x: 8, y: 8, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(demolishParcel(map, store, i)).toBe(true);
    expect(checkParcelAgreement(map, store)).toEqual([]);
  });

  it('changes the canonical world hash (tombstone + cleared tiles)', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.Offices });
    const world = { map, parcels: store, seed: 'x', log: [] as string[] };
    const before = hashWorld(world);
    expect(demolishParcel(map, store, i)).toBe(true);
    expect(hashWorld(world)).not.toBe(before);
  });

  it('double-demolish returns false and changes nothing', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.Civic });
    expect(demolishParcel(map, store, i)).toBe(true);
    const snap = map.snapshot();
    const bytes = store.snapshotBytes();
    expect(demolishParcel(map, store, i)).toBe(false);
    expect(map.snapshot()).toBe(snap);
    expect(store.snapshotBytes()).toEqual(bytes);
  });

  it('returns false on an out-of-range index, writing nothing', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 3, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const snap = map.snapshot();
    expect(demolishParcel(map, store, -1)).toBe(false);
    expect(demolishParcel(map, store, 999)).toBe(false);
    expect(map.snapshot()).toBe(snap);
  });
});

describe('demolishTransportAt', () => {
  it('clears a road or rail tile, refuses empty and building tiles', () => {
    const map = new GameMap(12, 12);
    const store = new ParcelStore();
    placeTransport(map, 1, 1, BuiltKind.RoadStreet);
    expect(demolishTransportAt(map, 1, 1)).toBe(true);
    expect(map.getBuilt(1, 1)).toBe(0);

    placeTransport(map, 2, 2, BuiltKind.Rail);
    expect(demolishTransportAt(map, 2, 2)).toBe(true);
    expect(map.getBuilt(2, 2)).toBe(0);

    // Empty tile: nothing to demolish.
    expect(demolishTransportAt(map, 4, 4)).toBe(false);

    // Building tile: not transport, so refused and left intact.
    placeParcel(map, store, { x: 6, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(demolishTransportAt(map, 6, 6)).toBe(false);
    expect(map.getBuilt(6, 6)).toBe(BuiltKind.HouseSingle);
  });

  it('returns false out of bounds', () => {
    const map = new GameMap(8, 8);
    expect(demolishTransportAt(map, -1, 0)).toBe(false);
    expect(demolishTransportAt(map, 8, 8)).toBe(false);
  });
});

describe('checkParcelAgreement detects dead-entry references', () => {
  it('flags a tile pointing at a demolished (tombstoned) parcel', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.Civic });
    expect(demolishParcel(map, store, i)).toBe(true);
    // Hand-corruption: re-stamp a tile to reference the now-dead store entry.
    map.setBuilt(2, 2, BuiltKind.Civic);
    map.setParcel(2, 2, i + 1);
    const violations = checkParcelAgreement(map, store);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => /demolished/.test(v))).toBe(true);
  });
});
