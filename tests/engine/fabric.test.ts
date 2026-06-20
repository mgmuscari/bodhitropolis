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
  placeBridge,
  checkParcelAgreement,
  transportMask,
  transportCategory,
  roadDividerMask,
  isLimitedAccessBoundary,
  roadCurbMask,
  railCrossingMask,
  depaveAsphalt,
  rampMarkingMask,
  freewayMedianAxis,
  freewayAxis,
  freewayLaneBoundaryMask,
  freewayCenterLaneAxis,
  parcelTouchesRoad,
  demolishParcel,
  demolishTransportAt,
  TRANSPORT_CONVERSIONS,
  canConvertTransport,
  convertTransport,
  isOverpassKind,
  canPlaceOverpass,
  placeOverpass,
  removeOverpassAt,
  overpassAt,
  deckMask,
  REZONE_TARGETS,
  canConvertParcel,
  convertParcel,
} from '../../src/engine/fabric';
import { GameMap, Water } from '../../src/engine/map';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';

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

  it('accepts a 4x4 footprint on clear land (Maddy: nuclear/fusion plants are 4x4)', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceParcel(map, 1, 1, 4, 4)).toBe(true);
  });

  it('rejects footprint sizes outside 1..4', () => {
    const map = new GameMap(8, 8);
    expect(canPlaceParcel(map, 0, 0, 5, 1)).toBe(false);
    expect(canPlaceParcel(map, 0, 0, 1, 5)).toBe(false);
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
    [BuiltKind.RoadHighway, BuiltKind.PlantedMedian],
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
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.RoadHighway)!]).toEqual([
      BuiltKind.RoadAvenue,
      BuiltKind.PlantedMedian, // the road-diet planted median (tool-gated to interior lanes)
    ]);
    expect([...TRANSPORT_CONVERSIONS.get(BuiltKind.Rail)!]).toEqual([BuiltKind.Streetcar]);
  });

  it('a planted median converts BACK to highway (the road diet is reversible)', () => {
    const map = new GameMap(8, 8);
    expect(placeTransport(map, 3, 3, BuiltKind.RoadHighway)).toBe(true);
    expect(convertTransport(map, 3, 3, BuiltKind.PlantedMedian)).toBe(true);
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.PlantedMedian);
    expect(canConvertTransport(map, 3, 3, BuiltKind.RoadHighway)).toBe(true);
    expect(convertTransport(map, 3, 3, BuiltKind.RoadHighway)).toBe(true);
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.RoadHighway);
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

describe('REZONE_TARGETS + canConvertParcel / convertParcel', () => {
  it('exposes exactly the two rezoning greens', () => {
    expect(REZONE_TARGETS.has(BuiltKind.Park)).toBe(true);
    expect(REZONE_TARGETS.has(BuiltKind.RewildedLand)).toBe(true);
    expect(REZONE_TARGETS.has(BuiltKind.Parklet)).toBe(false);
    expect(REZONE_TARGETS.size).toBe(2);
  });

  it('converts a 3×3 building parcel in place: every tile new kind, same pid', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const idx = placeParcel(map, store, {
      x: 2, y: 2, width: 3, height: 3, kind: BuiltKind.Projects, condition: 50,
    });
    expect(idx).toBe(0);
    // Click a non-anchor tile (the SE corner) — conversion resolves via the parcel id.
    expect(canConvertParcel(map, store, 4, 4, BuiltKind.Park)).toBe(true);
    expect(convertParcel(map, store, 4, 4, BuiltKind.Park)).toBe(true);

    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(map.getBuilt(2 + dx, 2 + dy)).toBe(BuiltKind.Park); // kind swapped in built
        expect(map.getParcel(2 + dx, 2 + dy)).toBe(idx + 1); // parcel-id layer unchanged
      }
    }
    expect(store.kindAt(idx)).toBe(BuiltKind.Park); // kind swapped in store too
    expect(store.conditionAt(idx)).toBe(255); // condition reset to pristine
    expect(store.isAlive(idx)).toBe(true); // parcel stays alive
    expect(checkParcelAgreement(map, store)).toEqual([]); // bidirectional sweep clean
  });

  it('converts to RewildedLand as well', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.ParkingLot });
    expect(convertParcel(map, store, 1, 1, BuiltKind.RewildedLand)).toBe(true);
    expect(map.getBuilt(1, 1)).toBe(BuiltKind.RewildedLand);
    expect(store.kindAt(i)).toBe(BuiltKind.RewildedLand);
    expect(checkParcelAgreement(map, store)).toEqual([]);
  });

  it('rejects an empty tile (writes nothing, returns false)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const snap = map.snapshot();
    expect(canConvertParcel(map, store, 3, 3, BuiltKind.Park)).toBe(false);
    expect(convertParcel(map, store, 3, 3, BuiltKind.Park)).toBe(false);
    expect(map.snapshot()).toBe(snap);
  });

  it('rejects a transport tile', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeTransport(map, 2, 2, BuiltKind.RoadStreet);
    expect(canConvertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.RoadStreet);
  });

  it('rejects a non-REZONE target (writes nothing)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(canConvertParcel(map, store, 2, 2, BuiltKind.Offices)).toBe(false);
    expect(convertParcel(map, store, 2, 2, BuiltKind.Offices)).toBe(false);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.HouseSingle);
  });

  it('rejects same-kind (Park → Park no-op)', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(true); // first convert
    expect(canConvertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false); // already Park
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
  });

  it('rejects a dead (tombstoned) parcel even when a tile still references it', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.Projects });
    expect(demolishParcel(map, store, i)).toBe(true);
    // Hand-corruption: re-stamp the tile to reference the now-dead store entry.
    map.setBuilt(2, 2, BuiltKind.Projects);
    map.setParcel(2, 2, i + 1);
    expect(canConvertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
    expect(map.getBuilt(2, 2)).toBe(BuiltKind.Projects); // unchanged
  });

  it('rejects out of bounds', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    expect(canConvertParcel(map, store, -1, 0, BuiltKind.Park)).toBe(false);
    expect(convertParcel(map, store, 8, 8, BuiltKind.Park)).toBe(false);
  });

  it('hashWorld moves on a convert and is stable on a repeated (no-op) convert', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.HouseSingle });
    const world = { map, parcels: store, seed: 'x', log: [] as string[] };
    const before = hashWorld(world);
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(true);
    const afterConvert = hashWorld(world);
    expect(afterConvert).not.toBe(before); // kind 16→61 moves the hash
    // Repeat (same-kind no-op writes nothing): hash unchanged.
    expect(convertParcel(map, store, 2, 2, BuiltKind.Park)).toBe(false);
    expect(hashWorld(world)).toBe(afterConvert);
  });

  it('is deterministic: the same convert sequence yields identical hashes', () => {
    const build = () => {
      const map = new GameMap(8, 8);
      const store = new ParcelStore();
      placeParcel(map, store, { x: 1, y: 1, width: 2, height: 2, kind: BuiltKind.Projects, condition: 30 });
      convertParcel(map, store, 1, 1, BuiltKind.RewildedLand);
      const world = { map, parcels: store, seed: 's', log: [] as string[] };
      return hashWorld(world);
    };
    expect(build()).toBe(build());
  });

  it('ParcelStore.setKind swaps the stored kind', () => {
    const store = new ParcelStore();
    const i = store.add({ x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    store.setKind(i, BuiltKind.Park);
    expect(store.kindAt(i)).toBe(BuiltKind.Park);
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

describe('isLimitedAccessBoundary (freeway ↔ surface-road divider rule)', () => {
  it('is true between a freeway and a surface road (avenue/street), either order', () => {
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.RoadAvenue)).toBe(true);
    expect(isLimitedAccessBoundary(BuiltKind.RoadStreet, BuiltKind.RoadHighway)).toBe(true);
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.QuietStreet)).toBe(true);
  });

  it('is false freeway↔freeway and surface↔surface (no barrier where they truly merge)', () => {
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.RoadHighway)).toBe(false);
    expect(isLimitedAccessBoundary(BuiltKind.RoadAvenue, BuiltKind.RoadStreet)).toBe(false);
  });

  it('is false at a ramp — the ramp IS the legal crossing, not a barrier', () => {
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.RoadRamp)).toBe(false);
    expect(isLimitedAccessBoundary(BuiltKind.RoadRamp, BuiltKind.RoadAvenue)).toBe(false);
  });

  it('is false against non-road tiles (that edge is a curb, not a divider)', () => {
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.None)).toBe(false);
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.HouseSingle)).toBe(false);
    expect(isLimitedAccessBoundary(BuiltKind.RoadHighway, BuiltKind.Rail)).toBe(false);
  });
});

describe('roadDividerMask', () => {
  it('is 0 on a non-road tile', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.Rail);
    expect(roadDividerMask(map, 2, 2)).toBe(0);
  });

  it('marks the edge where a freeway abuts a frontage avenue, from BOTH sides', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadHighway);
    map.setBuilt(3, 2, BuiltKind.RoadAvenue); // east frontage road
    expect(roadDividerMask(map, 2, 2)).toBe(E); // freeway sees the barrier east
    expect(roadDividerMask(map, 3, 2)).toBe(W); // avenue sees it west (symmetric)
  });

  it('does NOT mark freeway↔freeway or surface↔surface edges', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadHighway);
    map.setBuilt(2, 1, BuiltKind.RoadHighway); // north: another freeway lane — merges
    map.setBuilt(1, 2, BuiltKind.RoadAvenue); // west: frontage road — barrier
    map.setBuilt(2, 3, BuiltKind.None); // south: open land — curb, not divider
    expect(roadDividerMask(map, 2, 2)).toBe(W);
  });

  it('leaves a ramp edge open (no barrier — it is the on/off crossing)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadHighway);
    map.setBuilt(2, 1, BuiltKind.RoadRamp); // north ramp — the gap
    map.setBuilt(3, 2, BuiltKind.RoadAvenue); // east frontage — barrier
    expect(roadDividerMask(map, 2, 2)).toBe(E);
  });

  it('ignores out-of-bounds neighbours', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(0, 0, BuiltKind.RoadHighway);
    map.setBuilt(1, 0, BuiltKind.RoadAvenue); // east frontage
    map.setBuilt(0, 1, BuiltKind.RoadStreet); // south frontage
    expect(roadDividerMask(map, 0, 0)).toBe(E | S);
  });

  // Run-length filter (minRun): a 1-tile freeway/street contact is a CROSSING (onramp), not a
  // frontage — it should NOT get a barrier. Only a sustained parallel boundary does.
  it('with minRun=3, suppresses an isolated 1-tile freeway/street contact (a crossing)', () => {
    const map = new GameMap(7, 7);
    // A vertical freeway column, with a single avenue tile touching it on the east at one row.
    for (let y = 0; y < 7; y++) map.setBuilt(3, y, BuiltKind.RoadHighway);
    map.setBuilt(4, 3, BuiltKind.RoadAvenue); // lone east contact at y=3
    expect(roadDividerMask(map, 3, 3, 1)).toBe(E); // raw rule still sees it
    expect(roadDividerMask(map, 3, 3, 3)).toBe(0); // but a 1-long run is filtered out
  });

  it('with minRun=3, KEEPS a sustained (≥3-tile) freeway/frontage stretch on every tile of the run', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(3, y, BuiltKind.RoadHighway); // freeway column
      map.setBuilt(4, y, BuiltKind.RoadAvenue); // avenue frontage alongside, full height
    }
    // Each freeway tile sees the barrier east; each avenue tile sees it west — the whole run.
    for (let y = 1; y < 6; y++) {
      expect(roadDividerMask(map, 3, y, 3)).toBe(E);
      expect(roadDividerMask(map, 4, y, 3)).toBe(W);
    }
  });

  it('with minRun=3, a 2-tile stretch is still too short (filtered)', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) map.setBuilt(3, y, BuiltKind.RoadHighway);
    map.setBuilt(4, 2, BuiltKind.RoadAvenue); // 2-tile frontage at y=2,3
    map.setBuilt(4, 3, BuiltKind.RoadAvenue);
    expect(roadDividerMask(map, 3, 2, 3)).toBe(0);
    expect(roadDividerMask(map, 3, 3, 3)).toBe(0);
  });
});

describe('freewayMedianAxis (jersey barrier down the centre tile, lengthwise)', () => {
  it('is null on a non-freeway tile', () => {
    const map = new GameMap(7, 7);
    map.setBuilt(3, 3, BuiltKind.RoadAvenue);
    expect(freewayMedianAxis(map, 3, 3)).toBe(null);
  });

  it('marks the CENTRE spine of a 3-wide vertical freeway, running vertical; not the flanks', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(2, y, BuiltKind.RoadHighway); // west flank
      map.setBuilt(3, y, BuiltKind.RoadHighway); // centre spine
      map.setBuilt(4, y, BuiltKind.RoadHighway); // east flank
    }
    expect(freewayMedianAxis(map, 3, 3)).toBe('v'); // centre → vertical median
    expect(freewayMedianAxis(map, 2, 3)).toBe(null); // flank → none
    expect(freewayMedianAxis(map, 4, 3)).toBe(null);
  });

  it('marks the centre spine of a 3-wide horizontal freeway, running horizontal', () => {
    const map = new GameMap(7, 7);
    for (let x = 0; x < 7; x++) {
      map.setBuilt(x, 2, BuiltKind.RoadHighway);
      map.setBuilt(x, 3, BuiltKind.RoadHighway);
      map.setBuilt(x, 4, BuiltKind.RoadHighway);
    }
    expect(freewayMedianAxis(map, 3, 3)).toBe('h');
    expect(freewayMedianAxis(map, 3, 2)).toBe(null);
  });

  it('draws no median on an even-width (2-wide) freeway — no single centre tile', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(2, y, BuiltKind.RoadHighway);
      map.setBuilt(3, y, BuiltKind.RoadHighway);
    }
    expect(freewayMedianAxis(map, 2, 3)).toBe(null);
    expect(freewayMedianAxis(map, 3, 3)).toBe(null);
  });

  it('draws NO median through a freeway interchange (the band widens at the cross)', () => {
    const map = new GameMap(9, 9);
    for (let i = 0; i < 9; i++) {
      map.setBuilt(3, i, BuiltKind.RoadHighway); // vertical freeway cols 3,4,5
      map.setBuilt(4, i, BuiltKind.RoadHighway);
      map.setBuilt(5, i, BuiltKind.RoadHighway);
      map.setBuilt(i, 3, BuiltKind.RoadHighway); // horizontal freeway rows 3,4,5
      map.setBuilt(i, 4, BuiltKind.RoadHighway);
      map.setBuilt(i, 5, BuiltKind.RoadHighway);
    }
    expect(freewayMedianAxis(map, 4, 4)).toBe(null); // interchange centre — both runs wide → none
    expect(freewayMedianAxis(map, 4, 7)).toBe('v'); // clean 3-wide corridor below the cross → median
  });

  it('opens the median at a ramp (the spine tile is a RoadRamp, not highway)', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(2, y, BuiltKind.RoadHighway);
      map.setBuilt(3, y, BuiltKind.RoadHighway);
      map.setBuilt(4, y, BuiltKind.RoadHighway);
    }
    map.setBuilt(3, 3, BuiltKind.RoadRamp); // a crossing on the spine
    expect(freewayMedianAxis(map, 3, 3)).toBe(null); // no median at the ramp itself
  });
});

describe('freewayAxis (lengthwise axis for freeway lane lines)', () => {
  it('is null on a non-freeway tile and on a lone 1×1 highway tile', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadStreet);
    expect(freewayAxis(map, 2, 2)).toBe(null);
    const lone = new GameMap(5, 5);
    lone.setBuilt(2, 2, BuiltKind.RoadHighway); // no run either way
    expect(freewayAxis(lone, 2, 2)).toBe(null);
  });

  it('is vertical on a flank of a vertical freeway, horizontal on a horizontal one', () => {
    const v = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      v.setBuilt(2, y, BuiltKind.RoadHighway);
      v.setBuilt(3, y, BuiltKind.RoadHighway);
      v.setBuilt(4, y, BuiltKind.RoadHighway);
    }
    expect(freewayAxis(v, 2, 3)).toBe('v'); // a flank lane → runs vertical
    const h = new GameMap(7, 7);
    for (let x = 0; x < 7; x++) {
      h.setBuilt(x, 2, BuiltKind.RoadHighway);
      h.setBuilt(x, 3, BuiltKind.RoadHighway);
      h.setBuilt(x, 4, BuiltKind.RoadHighway);
    }
    expect(freewayAxis(h, 3, 2)).toBe('h');
  });
});

describe('freewayCenterLaneAxis (street through the freeway = two-way turn lane)', () => {
  it('is null for a freeway tile or a road not flanked by freeway both sides', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadHighway);
    expect(freewayCenterLaneAxis(map, 2, 2)).toBe(null); // a freeway, not a centre lane
    const lone = new GameMap(5, 5);
    lone.setBuilt(2, 2, BuiltKind.RoadStreet);
    lone.setBuilt(1, 2, BuiltKind.RoadHighway); // only one freeway flank
    expect(freewayCenterLaneAxis(lone, 2, 2)).toBe(null);
  });

  it('detects a street flanked by freeway on both perpendicular sides', () => {
    const v = new GameMap(5, 5);
    v.setBuilt(2, 2, BuiltKind.RoadStreet);
    v.setBuilt(1, 2, BuiltKind.RoadHighway); // freeway west
    v.setBuilt(3, 2, BuiltKind.RoadHighway); // freeway east → lane runs N-S
    expect(freewayCenterLaneAxis(v, 2, 2)).toBe('v');
    const h = new GameMap(5, 5);
    h.setBuilt(2, 2, BuiltKind.RoadAvenue);
    h.setBuilt(2, 1, BuiltKind.RoadHighway);
    h.setBuilt(2, 3, BuiltKind.RoadHighway);
    expect(freewayCenterLaneAxis(h, 2, 2)).toBe('h');
  });
});

describe('freewayLaneBoundaryMask (lane line between adjacent freeway tiles)', () => {
  it('is 0 on a non-freeway and on a single-lane freeway (no parallel lane)', () => {
    const map = new GameMap(7, 7);
    map.setBuilt(3, 3, BuiltKind.RoadAvenue);
    expect(freewayLaneBoundaryMask(map, 3, 3)).toBe(0);
    const single = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) single.setBuilt(3, y, BuiltKind.RoadHighway); // 1-wide column
    expect(freewayLaneBoundaryMask(single, 3, 3)).toBe(0); // no perpendicular lane → no boundary
  });

  it('marks the perpendicular edges that abut a parallel lane on a 3-wide freeway', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(2, y, BuiltKind.RoadHighway);
      map.setBuilt(3, y, BuiltKind.RoadHighway);
      map.setBuilt(4, y, BuiltKind.RoadHighway);
    }
    expect(freewayLaneBoundaryMask(map, 3, 3)).toBe(W | E); // spine: a lane on each side
    expect(freewayLaneBoundaryMask(map, 2, 3)).toBe(E); // west flank: lane only to the east
    expect(freewayLaneBoundaryMask(map, 4, 3)).toBe(W);
  });
});

describe('rampMarkingMask (straight-through dashed line at freeway ramps)', () => {
  it('is 0 on a non-ramp tile', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadStreet);
    expect(rampMarkingMask(map, 2, 2)).toBe(0);
  });

  it('marks only the freeway axis (highway neighbours), not the surface-street arms', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadRamp);
    map.setBuilt(2, 1, BuiltKind.RoadHighway); // north: freeway
    map.setBuilt(2, 3, BuiltKind.RoadHighway); // south: freeway
    map.setBuilt(1, 2, BuiltKind.RoadStreet); // west: surface street (NOT drawn)
    map.setBuilt(3, 2, BuiltKind.RoadAvenue); // east: surface avenue (NOT drawn)
    expect(rampMarkingMask(map, 2, 2)).toBe(N | S); // straight through, no cross
  });

  // Regression for the freeway-crossing GRID (Maddy 2026-06-19): at a 3-wide crossing the band is
  // converted to a row of ramp tiles; the PERPENDICULAR neighbours are also ramps, so counting ramps
  // re-introduced the cross. Keying on the HIGHWAY axis keeps every tile straight.
  it('keeps every tile of a 3-wide freeway crossing straight (no grid)', () => {
    const map = new GameMap(7, 7);
    for (let y = 0; y < 7; y++) {
      map.setBuilt(1, y, BuiltKind.RoadHighway);
      map.setBuilt(2, y, BuiltKind.RoadHighway);
      map.setBuilt(3, y, BuiltKind.RoadHighway);
    }
    // a surface street crosses the band at row 2 → those 3 tiles become ramps
    map.setBuilt(1, 2, BuiltKind.RoadRamp);
    map.setBuilt(2, 2, BuiltKind.RoadRamp);
    map.setBuilt(3, 2, BuiltKind.RoadRamp);
    map.setBuilt(0, 2, BuiltKind.RoadStreet);
    map.setBuilt(4, 2, BuiltKind.RoadStreet);
    expect(rampMarkingMask(map, 1, 2)).toBe(N | S); // each ramp tile: highway N&S → straight
    expect(rampMarkingMask(map, 2, 2)).toBe(N | S); // ramps E/W are perpendicular, NOT counted
    expect(rampMarkingMask(map, 3, 2)).toBe(N | S);
  });

  // Regression for the orthogonal markings (Maddy 2026-06-19): a ramp in the MIDDLE of a HORIZONTAL
  // freeway has highways N & S (the flank lanes), but the freeway TRAVELS E-W — keying on the highway
  // neighbours drew the line orthogonal. The longer BAND run (highway+ramp) gives the right axis.
  it('a ramp mid-HORIZONTAL-freeway draws E-W (along travel), not orthogonal N-S', () => {
    const map = new GameMap(9, 9);
    for (let x = 0; x < 9; x++) {
      map.setBuilt(x, 2, BuiltKind.RoadHighway); // 3-wide horizontal freeway rows 2,3,4
      map.setBuilt(x, 3, BuiltKind.RoadHighway);
      map.setBuilt(x, 4, BuiltKind.RoadHighway);
    }
    map.setBuilt(3, 2, BuiltKind.RoadRamp); // a vertical street crosses at col 3 → ramps in the band
    map.setBuilt(3, 3, BuiltKind.RoadRamp);
    map.setBuilt(3, 4, BuiltKind.RoadRamp);
    map.setBuilt(3, 1, BuiltKind.RoadStreet);
    map.setBuilt(3, 5, BuiltKind.RoadStreet);
    expect(rampMarkingMask(map, 3, 3)).toBe(E | W); // band runs E-W (9) >> N-S (3) → along travel
    expect(rampMarkingMask(map, 3, 2)).toBe(E | W);
    expect(rampMarkingMask(map, 3, 4)).toBe(E | W);
  });

  it('returns 0 for a ramp that flanks no freeway (no through-line)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadRamp);
    map.setBuilt(2, 1, BuiltKind.RoadRamp); // a ramp neighbour, but NO highway anywhere
    expect(rampMarkingMask(map, 2, 2)).toBe(0);
  });
});

describe('roadCurbMask (curb/sidewalk where a surface road meets non-road)', () => {
  it('is 0 on a non-road tile', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.HouseSingle);
    expect(roadCurbMask(map, 2, 2)).toBe(0);
  });

  it('is 0 on a freeway (it gets a barrier, not a sidewalk)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadHighway);
    map.setBuilt(2, 1, BuiltKind.None); // open land north
    expect(roadCurbMask(map, 2, 2)).toBe(0);
  });

  it('marks edges where a street faces non-road, not edges facing another road', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadStreet);
    map.setBuilt(2, 1, BuiltKind.RoadStreet); // north: road — connects, no curb
    map.setBuilt(3, 2, BuiltKind.HouseSingle); // east: building — curb
    map.setBuilt(2, 3, BuiltKind.None); // south: open land — curb
    // west neighbour stays empty land — curb
    expect(roadCurbMask(map, 2, 2)).toBe(E | S | W);
  });

  it('does not curb against another road, only against land (roads on 3 sides, land east)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadAvenue);
    map.setBuilt(2, 1, BuiltKind.RoadStreet); // north road — no curb
    map.setBuilt(2, 3, BuiltKind.RoadStreet); // south road — no curb
    map.setBuilt(1, 2, BuiltKind.RoadStreet); // west road — no curb
    map.setBuilt(3, 2, BuiltKind.None); // east land — curb
    expect(roadCurbMask(map, 2, 2)).toBe(E);
  });
});

describe('railCrossingMask (level crossing where a road meets a rail/tram tile)', () => {
  it('is 0 on a non-rail tile', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.RoadStreet);
    map.setBuilt(2, 1, BuiltKind.Rail);
    expect(railCrossingMask(map, 2, 2)).toBe(0); // the ROAD tile carries no crossing mark; the rail does
  });

  it('marks the road-approach edges of a rail tile a road crosses', () => {
    const map = new GameMap(5, 5);
    // A horizontal rail line with a vertical street crossing it at (2,2).
    map.setBuilt(1, 2, BuiltKind.Rail);
    map.setBuilt(2, 2, BuiltKind.Rail);
    map.setBuilt(3, 2, BuiltKind.Rail);
    map.setBuilt(2, 1, BuiltKind.RoadStreet); // road approaches from the north
    map.setBuilt(2, 3, BuiltKind.RoadStreet); // ...and the south → the crossing
    expect(railCrossingMask(map, 2, 2)).toBe(N | S);
  });

  it('is 0 for a rail tile with no road neighbour (open track)', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(1, 2, BuiltKind.Rail);
    map.setBuilt(2, 2, BuiltKind.Rail);
    map.setBuilt(3, 2, BuiltKind.Rail);
    expect(railCrossingMask(map, 2, 2)).toBe(0);
  });

  it('also marks a streetcar (tram) crossing', () => {
    const map = new GameMap(5, 5);
    map.setBuilt(2, 2, BuiltKind.Streetcar);
    map.setBuilt(1, 2, BuiltKind.RoadAvenue); // a cross avenue to the west
    expect(railCrossingMask(map, 2, 2)).toBe(W);
  });
});

describe('depaveAsphalt (redlined open ground reads as asphalt; player greens de-pave it)', () => {
  it('is the redline grade on open redlined ground, 0 on greenlined/built/water', () => {
    const map = new GameMap(9, 9);
    map.redline[map.idx(4, 4)] = 200; // redlined open land
    map.redline[map.idx(4, 6)] = 10; // greenlined open land (below the min)
    expect(depaveAsphalt(map, 4, 4)).toBe(200); // paved-over disinvestment
    expect(depaveAsphalt(map, 4, 6)).toBe(0); // greenlined → no asphalt
    map.setBuilt(4, 4, BuiltKind.HouseSingle); // a building covers its own ground
    expect(depaveAsphalt(map, 4, 4)).toBe(0);
    map.setBuilt(4, 4, BuiltKind.None);
    map.water[map.idx(4, 4)] = Water.Ocean;
    expect(depaveAsphalt(map, 4, 4)).toBe(0); // water isn't ground
  });

  it('is reduced toward 0 by a nearby player GREEN (the player de-paves by rewilding)', () => {
    const map = new GameMap(11, 11);
    map.redline[map.idx(5, 5)] = 240;
    const bare = depaveAsphalt(map, 5, 5);
    map.setBuilt(5, 6, BuiltKind.RewildedLand); // a rewilded green right next to it
    const greened = depaveAsphalt(map, 5, 5);
    expect(greened).toBeLessThan(bare); // de-paved by the adjacent green
    // a green ON the tile-adjacent ring de-paves most; far away leaves it paved
    map.setBuilt(5, 6, BuiltKind.None);
    map.setBuilt(5, 5 - 0, BuiltKind.None);
    expect(depaveAsphalt(map, 5, 5)).toBe(240); // green removed → fully paved again
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

describe('parcelTouchesRoad: quiet-street frontage (transportCategory road)', () => {
  // build-tools widens road frontage from isRoadKind (1..3) to connection-category
  // road (transportCategory === 1), so QuietStreet(7) now counts. The ONLY
  // behavioral delta is QuietStreet: rail (cat 2), bike (cat 3) and pedestrian
  // (cat 4) kinds are still NOT road frontage, which is why every existing
  // frontage test above stays green unchanged.
  it('counts a quiet street along a footprint edge as road frontage', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Apartments });
    placeTransport(map, 1, 2, BuiltKind.QuietStreet); // west edge, category road
    expect(parcelTouchesRoad(map, store, i)).toBe(true);
  });

  it('does not count a promenade (pedestrian) as road frontage', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Offices });
    placeTransport(map, 1, 2, BuiltKind.Promenade); // category pedestrian
    expect(parcelTouchesRoad(map, store, i)).toBe(false);
  });

  it('does not count a bike path as road frontage', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Offices });
    placeTransport(map, 1, 2, BuiltKind.BikePath); // category bike
    expect(parcelTouchesRoad(map, store, i)).toBe(false);
  });

  it('stays fronted after a street frontage is converted to a quiet street', () => {
    const map = new GameMap(8, 8);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.Apartments });
    placeTransport(map, 1, 2, BuiltKind.RoadStreet); // west frontage
    expect(parcelTouchesRoad(map, store, i)).toBe(true);
    expect(convertTransport(map, 1, 2, BuiltKind.QuietStreet)).toBe(true);
    expect(parcelTouchesRoad(map, store, i)).toBe(true); // quiet street still fronts
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

describe('placeBridge (transport spans water — freeways/roads cross inlets, Maddy 2026-06-18)', () => {
  it('decks a road/highway OVER water and keeps the water underneath (a bridge, not a causeway)', () => {
    const m = new GameMap(8, 8);
    m.water[m.idx(3, 3)] = Water.Ocean;
    expect(placeBridge(m, 3, 3, BuiltKind.RoadHighway)).toBe(true);
    expect(m.built[m.idx(3, 3)]).toBe(BuiltKind.RoadHighway); // the deck is built
    expect(m.water[m.idx(3, 3)]).toBe(Water.Ocean); // water stays — it's a bridge
  });

  it('on land behaves exactly like placeTransport', () => {
    const bridge = new GameMap(8, 8);
    const plain = new GameMap(8, 8);
    expect(placeBridge(bridge, 2, 2, BuiltKind.RoadHighway)).toBe(placeTransport(plain, 2, 2, BuiltKind.RoadHighway));
    expect(bridge.built[bridge.idx(2, 2)]).toBe(plain.built[plain.idx(2, 2)]);
    expect(bridge.water[bridge.idx(2, 2)]).toBe(Water.None);
  });

  it('merges road-over-road at a bridge junction (max kind)', () => {
    const m = new GameMap(8, 8);
    m.water[m.idx(5, 5)] = Water.Ocean;
    m.built[m.idx(5, 5)] = BuiltKind.RoadStreet;
    expect(placeBridge(m, 5, 5, BuiltKind.RoadHighway)).toBe(true);
    expect(m.built[m.idx(5, 5)]).toBe(BuiltKind.RoadHighway); // max(street, highway)
    expect(m.water[m.idx(5, 5)]).toBe(Water.Ocean);
  });

  it('refuses to deck a building tile (no bridge over a structure)', () => {
    const m = new GameMap(8, 8);
    m.water[m.idx(4, 4)] = Water.Ocean;
    m.built[m.idx(4, 4)] = BuiltKind.HouseSingle;
    expect(placeBridge(m, 4, 4, BuiltKind.RoadHighway)).toBe(false);
    expect(m.built[m.idx(4, 4)]).toBe(BuiltKind.HouseSingle); // unchanged
  });
});

describe('freeway corridors bridge water (Maddy 2026-06-18: freeway at 85,86 skipped for water)', () => {
  it('a full-century world decks RoadHighway OVER water where a corridor crosses an inlet', () => {
    // The era3 highway carve used to skip water tiles, leaving gaps in the freeway; with placeBridge
    // it spans them. On the game's default seed the central corridor crosses a small inlet — assert
    // at least one RoadHighway tile now sits over water (a bridge), and the water layer is preserved.
    const world = runPipeline({ seed: 'bodhitropolis', width: 128, height: 128 }, [
      terrainStage(),
      mosesCenturyStage(),
    ]);
    const m = world.map;
    let bridges = 0;
    for (let i = 0; i < m.width * m.height; i++) {
      if (m.built[i] === BuiltKind.RoadHighway && m.water[i] !== Water.None) bridges++;
    }
    expect(bridges).toBeGreaterThan(0);
  });
});

describe('overpasses (the elevated deck layer — grade-separated transit over roads)', () => {
  it('isOverpassKind is the elevated transit set (ElevatedRail, Promenade)', () => {
    expect(isOverpassKind(BuiltKind.ElevatedRail)).toBe(true);
    expect(isOverpassKind(BuiltKind.Promenade)).toBe(true);
    expect(isOverpassKind(BuiltKind.RoadStreet)).toBe(false);
    expect(isOverpassKind(BuiltKind.HouseSingle)).toBe(false);
  });

  it('decks an overpass OVER a road/freeway/rail, leaving the road below intact', () => {
    const m = new GameMap(8, 8);
    placeTransport(m, 3, 3, BuiltKind.RoadHighway);
    expect(canPlaceOverpass(m, 3, 3, BuiltKind.Promenade)).toBe(true);
    expect(placeOverpass(m, 3, 3, BuiltKind.Promenade)).toBe(true);
    expect(overpassAt(m, 3, 3)).toBe(BuiltKind.Promenade); // the deck
    expect(m.getBuilt(3, 3)).toBe(BuiltKind.RoadHighway); // the road UNDER it survives (grade-separated)
  });

  it('refuses an overpass over open land (nothing to grade-separate) or a building', () => {
    const m = new GameMap(8, 8);
    expect(canPlaceOverpass(m, 2, 2, BuiltKind.Promenade)).toBe(false); // open land
    m.built[m.idx(4, 4)] = BuiltKind.HouseSingle;
    expect(canPlaceOverpass(m, 4, 4, BuiltKind.ElevatedRail)).toBe(false); // a building, not a road
  });

  it('refuses a second deck on an already-decked tile, and a non-overpass kind', () => {
    const m = new GameMap(8, 8);
    placeTransport(m, 5, 5, BuiltKind.RoadAvenue);
    expect(placeOverpass(m, 5, 5, BuiltKind.ElevatedRail)).toBe(true);
    expect(canPlaceOverpass(m, 5, 5, BuiltKind.Promenade)).toBe(false); // deck occupied
    expect(canPlaceOverpass(m, 5, 5, BuiltKind.RoadStreet)).toBe(false); // not an overpass kind
  });

  it('removeOverpassAt clears the deck and leaves the road below', () => {
    const m = new GameMap(8, 8);
    placeTransport(m, 6, 6, BuiltKind.RoadStreet);
    placeOverpass(m, 6, 6, BuiltKind.Promenade);
    expect(removeOverpassAt(m, 6, 6)).toBe(true);
    expect(overpassAt(m, 6, 6)).toBe(0); // deck cleared
    expect(m.getBuilt(6, 6)).toBe(BuiltKind.RoadStreet); // road below remains
    expect(removeOverpassAt(m, 6, 6)).toBe(false); // nothing left to remove
  });

  it('the deck layer is HASHED: an overpass changes the snapshot; equal content is equal', () => {
    const a = new GameMap(8, 8);
    const b = new GameMap(8, 8);
    placeTransport(a, 3, 3, BuiltKind.RoadHighway);
    placeTransport(b, 3, 3, BuiltKind.RoadHighway);
    expect(a.snapshot()).toBe(b.snapshot()); // identical so far
    placeOverpass(a, 3, 3, BuiltKind.Promenade);
    expect(a.snapshot()).not.toBe(b.snapshot()); // the deck is part of the world hash
    placeOverpass(b, 3, 3, BuiltKind.Promenade);
    expect(a.snapshot()).toBe(b.snapshot()); // equal content → equal snapshot
  });

  it('deckMask connects same-category decks (a continuous elevated line)', () => {
    const m = new GameMap(8, 8);
    for (let x = 2; x <= 5; x++) {
      placeTransport(m, x, 4, BuiltKind.RoadHighway);
      placeOverpass(m, x, 4, BuiltKind.Promenade);
    }
    // a mid-deck tile connects E+W to its deck neighbours (bits 2 + 8 = 10)
    expect(deckMask(m, 3, 4)).toBe(0b1010);
    // a bare road tile (no deck) has no deck mask
    expect(deckMask(m, 6, 4)).toBe(0);
  });
});
