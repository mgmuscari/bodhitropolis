import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore, BuiltKind } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { applyTool, toolDef } from '../../src/tools/tools';
import { ecologyTick } from '../../src/ecology/tick';

// ecologyTick(map) is the composite ecology step: a STRICT double-buffered pass
// (every sub-step reads the tick-entry "prev" layers, writes persistent scratch,
// copies back only at the end) that moves ONLY soil/flora/fauna. The tests pin
// directional invariants + determinism + the carrying-capacity cap + the
// road-diet fauna bridge + strict-buffer behaviour + layer isolation — never the
// placeholder magnitudes.

// A blank GameMap is all land (Water.None), unbuilt, unowned — the default.
function landMap(w: number, h: number): GameMap {
  return new GameMap(w, h);
}

function fabricFingerprint(map: GameMap, parcels: ParcelStore) {
  return {
    elevation: Array.from(map.elevation),
    water: Array.from(map.water),
    moisture: Array.from(map.moisture),
    landCover: Array.from(map.landCover),
    built: Array.from(map.built),
    parcel: Array.from(map.parcel),
    parcelBytes: Array.from(parcels.snapshotBytes()),
  };
}

describe('ecologyTick: soil', () => {
  it('recovers open land toward health each tick', () => {
    const map = landMap(8, 8);
    map.setSoilHealth(4, 4, 100);
    ecologyTick(map);
    expect(map.getSoilHealth(4, 4)).toBeGreaterThan(100);
  });

  it('rises FASTER beside a CommunityGarden than on baseline open land', () => {
    const map = landMap(16, 16);
    map.setBuilt(5, 5, BuiltKind.CommunityGarden);
    map.setSoilHealth(6, 5, 100); // within RADIUS of the garden
    map.setSoilHealth(12, 12, 100); // far baseline
    ecologyTick(map);
    const nearGain = map.getSoilHealth(6, 5) - 100;
    const baseGain = map.getSoilHealth(12, 12) - 100;
    expect(nearGain).toBeGreaterThan(baseGain);
    expect(baseGain).toBeGreaterThan(0);
  });

  it('falls toward PAVED_CAP under fresh pavement (parcel-covered)', () => {
    const map = landMap(8, 8);
    map.setBuilt(3, 3, BuiltKind.ParkingLot);
    map.setParcel(3, 3, 1); // parcel-covered ⇒ sealed
    map.setSoilHealth(3, 3, 200);
    ecologyTick(map);
    expect(map.getSoilHealth(3, 3)).toBeLessThan(200);
    expect(map.getSoilHealth(3, 3)).toBeLessThanOrEqual(40);
  });

  it('keeps soil within 0..255 (no wraparound) under extreme influence', () => {
    const map = landMap(8, 8);
    map.setBuilt(4, 4, BuiltKind.CommunityGarden);
    map.setSoilHealth(4, 4, 255);
    map.setSoilHealth(2, 2, 0);
    for (let t = 0; t < 50; t++) ecologyTick(map);
    for (let i = 0; i < map.soilHealth.length; i++) {
      expect(map.soilHealth[i]!).toBeGreaterThanOrEqual(0);
      expect(map.soilHealth[i]!).toBeLessThanOrEqual(255);
    }
  });
});

describe('ecologyTick: depave exemption (rezoned greens heal their own soil)', () => {
  // The load-bearing convert payoff: a converted park has parcel != 0, so without
  // the isUnsealed exemption it would seal its OWN soil at PAVED_CAP (the perverse
  // inverse of depaving). A ParkingLot with the same parcel cover is the control —
  // it stays sealed and capped. Non-vacuous: drop the exemption and the Park stays
  // pinned <= 40 and the final assertion fails.
  it('a Park parcel rises above the paved cap; a ParkingLot control stays capped', () => {
    const park = landMap(8, 8);
    park.setBuilt(3, 3, BuiltKind.Park);
    park.setParcel(3, 3, 1); // parcel-covered, exactly like a converted parcel
    park.setSoilHealth(3, 3, 40);

    const lot = landMap(8, 8);
    lot.setBuilt(3, 3, BuiltKind.ParkingLot);
    lot.setParcel(3, 3, 1);
    lot.setSoilHealth(3, 3, 40);

    for (let t = 0; t < 8; t++) {
      ecologyTick(park);
      ecologyTick(lot);
      expect(lot.getSoilHealth(3, 3)).toBeLessThanOrEqual(40); // sealed: capped throughout
    }
    expect(park.getSoilHealth(3, 3)).toBeGreaterThan(40); // unsealed: healed past the cap
  });
});

describe('ecologyTick: flora', () => {
  it('grows where prev soil is healthy, stays flat on poor soil', () => {
    const map = landMap(8, 8);
    map.setSoilHealth(2, 2, 200); // healthy
    map.setSoilHealth(5, 5, 50); // poor
    ecologyTick(map);
    expect(map.getFloraVitality(2, 2)).toBeGreaterThan(0);
    expect(map.getFloraVitality(5, 5)).toBe(0);
  });

  it('grows under a positive (boosting) influence even on sub-threshold soil', () => {
    // floraInf is applied SYMMETRICALLY: a boosting neighbour (garden, +flora)
    // lifts flora even where the soil is below the growth threshold. Pinned so
    // the superset of the PRP's "decays under net-negative influence" is itself a
    // contract, not incidental (code-review Task 3 Minor).
    const map = landMap(12, 12);
    map.setBuilt(6, 6, BuiltKind.CommunityGarden); // +flora influence over RADIUS
    map.setSoilHealth(7, 6, 50); // poor soil ⇒ no soil-gated growth
    map.setFloraVitality(7, 6, 30); // no rich neighbours ⇒ no spread
    ecologyTick(map);
    expect(map.getFloraVitality(7, 6)).toBeGreaterThan(30);
  });

  it('decays under a suppressor (highway) influence', () => {
    const map = landMap(12, 12);
    map.setBuilt(6, 6, BuiltKind.RoadHighway);
    map.setFloraVitality(7, 6, 100); // adjacent, within RADIUS
    ecologyTick(map);
    expect(map.getFloraVitality(7, 6)).toBeLessThan(100);
  });

  it('spreads onto a low-flora tile with >=2 rich neighbours, not with <2', () => {
    const map = landMap(8, 8);
    // Target M=(3,3): two rich 4-neighbours.
    map.setFloraVitality(2, 3, 200);
    map.setFloraVitality(4, 3, 200);
    // Control C=(6,6): one rich 4-neighbour.
    map.setFloraVitality(5, 6, 200);
    ecologyTick(map);
    expect(map.getFloraVitality(3, 3)).toBeGreaterThan(0); // spread
    expect(map.getFloraVitality(6, 6)).toBe(0); // no spread (only 1 rich nbr)
  });

  it('keeps water tiles at flora 0', () => {
    const map = landMap(8, 8);
    map.setWater(4, 4, Water.Lake);
    map.setFloraVitality(4, 4, 150);
    ecologyTick(map);
    expect(map.getFloraVitality(4, 4)).toBe(0);
  });
});

describe('ecologyTick: fauna carrying-capacity cap (anti-flood)', () => {
  it('a low-habitat tile between two rich patches stays bounded by its own habitat', () => {
    const map = landMap(5, 1);
    // Rich patches at both ends; M=(2,0) has a low, STABLE habitat: flora 64 sits
    // exactly at SPREAD_MIN so neighbour spread does not raise it, isolating the
    // carrying-capacity cap (habitat == flora == 64 here, no water/corridor).
    for (const x of [0, 1, 3, 4]) {
      map.setFloraVitality(x, 0, 200);
      map.setFaunaPresence(x, 0, 200);
    }
    map.setFloraVitality(2, 0, 64);
    for (let t = 0; t < 16; t++) {
      ecologyTick(map);
      // Never floods toward the neighbours' 200 — capped by its own habitat (64).
      expect(map.getFaunaPresence(2, 0)).toBeLessThanOrEqual(64);
      expect(map.getFloraVitality(2, 0)).toBe(64); // habitat stayed put
    }
    expect(map.getFaunaPresence(2, 0)).toBe(64); // colonised up to its small habitat
  });

  it('grows fauna toward habitat on a rich tile but never beyond 255', () => {
    const map = landMap(6, 6);
    for (let i = 0; i < map.floraVitality.length; i++) map.floraVitality[i] = 255;
    map.setFaunaPresence(3, 3, 200);
    for (let t = 0; t < 40; t++) ecologyTick(map);
    for (let i = 0; i < map.faunaPresence.length; i++) {
      expect(map.faunaPresence[i]!).toBeLessThanOrEqual(255);
      expect(map.faunaPresence[i]!).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ecologyTick: road-diet fauna bridge (mirrored fixtures)', () => {
  // A 1-wide column: patch A at top, a single transport tile in the middle, patch
  // B at the bottom. The ONLY path A→B is through the middle tile. A quiet street
  // relays fauna across it; a highway is impassable and isolates B.
  function bridgeMap(middle: BuiltKind): GameMap {
    const map = landMap(1, 3);
    map.setFloraVitality(0, 0, 200);
    map.setFaunaPresence(0, 0, 200);
    map.setFloraVitality(0, 2, 200); // B has habitat but no fauna yet
    map.setBuilt(0, 1, middle);
    return map;
  }

  it('fauna relays across a QuietStreet but NOT across a RoadHighway', () => {
    const quiet = bridgeMap(BuiltKind.QuietStreet);
    const highway = bridgeMap(BuiltKind.RoadHighway);
    for (let t = 0; t < 30; t++) {
      ecologyTick(quiet);
      ecologyTick(highway);
    }
    expect(quiet.getFaunaPresence(0, 2)).toBeGreaterThan(0); // bridged
    expect(highway.getFaunaPresence(0, 2)).toBe(0); // isolated
    expect(highway.getFaunaPresence(0, 1)).toBe(0); // the busy road itself holds no fauna
  });
});

describe('ecologyTick: determinism', () => {
  it('two identical maps yield identical layers after N ticks', () => {
    const seed = (m: GameMap): void => {
      m.setBuilt(3, 3, BuiltKind.CommunityGarden);
      m.setBuilt(8, 8, BuiltKind.RoadHighway);
      m.setBuilt(5, 9, BuiltKind.QuietStreet);
      m.setSoilHealth(4, 4, 180);
      m.setFloraVitality(2, 2, 150);
      m.setFaunaPresence(4, 4, 120);
    };
    const a = landMap(16, 16);
    const b = landMap(16, 16);
    seed(a);
    seed(b);
    for (let t = 0; t < 25; t++) {
      ecologyTick(a);
      ecologyTick(b);
    }
    expect(a.snapshot()).toBe(b.snapshot());
  });
});

describe('ecologyTick: STRICT double-buffering', () => {
  it('flora reads PREV soil (1-tick soil→flora lag), not the just-written soil', () => {
    // No built tiles: BASE_RECOVERY alone crosses soil over the flora threshold.
    const map = landMap(6, 6);
    map.setSoilHealth(3, 3, 127); // one below SOIL_THRESH (128)
    expect(map.getFloraVitality(3, 3)).toBe(0);
    ecologyTick(map);
    // Soil crossed 128 THIS tick, but flora read prev soil (127) — so flora stayed
    // 0. A pipelined impl reading the just-written soil would already have grown it.
    expect(map.getSoilHealth(3, 3)).toBe(128);
    expect(map.getFloraVitality(3, 3)).toBe(0);
    ecologyTick(map);
    // Next tick flora sees prev soil (128 ≥ threshold) and grows.
    expect(map.getFloraVitality(3, 3)).toBeGreaterThan(0);
  });

  it('fauna diffusion stays symmetric — a row-major pipelined read would skew it', () => {
    const map = landMap(9, 9);
    for (let i = 0; i < map.floraVitality.length; i++) map.floraVitality[i] = 200;
    map.setFaunaPresence(4, 4, 200); // single symmetric seed
    for (let t = 0; t < 3; t++) ecologyTick(map);
    for (let d = 1; d <= 3; d++) {
      const left = map.getFaunaPresence(4 - d, 4);
      const right = map.getFaunaPresence(4 + d, 4);
      const up = map.getFaunaPresence(4, 4 - d);
      const down = map.getFaunaPresence(4, 4 + d);
      expect(right).toBe(left);
      expect(up).toBe(left);
      expect(down).toBe(left);
    }
  });
});

describe('ecologyTick: layer isolation (ecology writes ONLY soil/flora/fauna)', () => {
  it('leaves the six non-ecology layers + parcels byte-identical', () => {
    const map = landMap(12, 12);
    const parcels = new ParcelStore();
    // Seed terrain-ish + built content so the tick has fabric to read.
    map.setWater(0, 0, Water.Ocean);
    map.setElevation(1, 1, 0.5);
    map.setMoisture(2, 2, 0.25);
    map.setLandCover(3, 3, 2);
    map.setBuilt(5, 5, BuiltKind.CommunityGarden);
    map.setSoilHealth(6, 6, 100);

    const before = fabricFingerprint(map, parcels);
    const soilBefore = Array.from(map.soilHealth);
    for (let t = 0; t < 5; t++) ecologyTick(map);
    const after = fabricFingerprint(map, parcels);

    expect(after).toEqual(before); // non-ecology layers untouched
    expect(Array.from(map.soilHealth)).not.toEqual(soilBefore); // ecology DID move
  });

  it('AC7: placing a garden via the TOOLS layer then ticking leaves fabric AND tech bytes stable', () => {
    const map = landMap(16, 16);
    const parcels = new ParcelStore();
    const world = { map, parcels };
    const tech = createTechState(TECH_TREE);
    tech.effort = 100;

    // Place through the tools layer — this spends communal effort from TechState.
    const r = applyTool(world, tech, toolDef('build-49')!, 4, 4); // build-49 = CommunityGarden
    expect(r.ok).toBe(true);

    // Capture fabric + tech bytes AFTER the placement spend.
    const fabricBefore = fabricFingerprint(map, parcels);
    const techBefore = Array.from(tech.snapshotBytes());
    const soilBefore = Array.from(map.soilHealth);

    for (let t = 0; t < 20; t++) ecologyTick(map);

    // The ticks move ecology but teleport nothing: fabric unchanged BY THE TICKS,
    // and tech byte-identical (the seam a future ecology→wellbeing coupling would
    // tempt threading tech into the tick — the guard lives HERE).
    expect(fabricFingerprint(map, parcels)).toEqual(fabricBefore);
    expect(Array.from(tech.snapshotBytes())).toEqual(techBefore);
    expect(Array.from(map.soilHealth)).not.toEqual(soilBefore);
  });
});
