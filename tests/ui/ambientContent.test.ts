import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore, BuiltKind, hashWorld, placeTransport, placeOverpass } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { simTick, type SimDeps } from '../../src/civic/compose';
import { parkingLots, parkingStalls, STALLS_PER_AXIS } from '../../src/ui/parkingContent';
import { layField, decayField } from '../../src/citizens/field';
import { StopCategory } from '../../src/citizens/itinerary';
import { TravelMode } from '../../src/citizens/modes';
import {
  createAmbientState,
  stepAmbient,
  ingestTrips,
  setParkingLots,
  setHouseholds,
  setPlantEmitters,
  chooseMode,
  roadPath,
  curbParkOffset,
  isWearable,
  seedDecay,
  carWeightForRoad,
  isCarRoad,
  isPedSubstrate,
  birdSpawnAt,
  nextRoadStep,
  reachedPlot,
  congestionSpeedMult,
  congestionCount,
  walkPath,
  stopReachable,
  usesCommittedPath,
  laneOffset,
  freewayLane,
  pollutionEmit,
  pedCost,
  landValueAt,
  recomputeLandValue,
  nearestOfCategory,
  capacityOf,
  occupancySignal,
  occupancyStep,
  spawnTargetFor,
  FUEL_TANK,
  stepOccupancy,
  liveInspectLine,
  accumulateWaterRunoff,
  accumulateGroundPollution,
  driftPollution,
  prevailingWind,
  flowWaterPollution,
  treatWaterPollution,
  stepRoadDecay,
  spawnCruisers,
  stepCruisers,
  nextPatrolStep,
  huntTarget,
  policePhase,
  stepArrests,
  arrestChance,
  buildSafeZones,
  computeCoverage,
  parkOwnedCarSomewhere,
  curbStallOffsets,
  routeToParking,
  sendOwnedCarHome,
  abandonOwnedCar,
  degradeAbandonedCar,
  carOffNetwork,
  type Car,
  type Ped,
  pedDespawns,
  isParkable,
  nearestWalkable,
  canDrive,
  AMBIENT_MAX_FRAME_MS,
  liveCaps,
  applyLiveCaps,
} from '../../src/ui/ambientContent';
import { CAP_PRESETS } from '../../src/ui/settings';

// A small grid of mixed roads so the stepper has somewhere to spawn/move.
function gridMap(): GameMap {
  const map = new GameMap(32, 24);
  for (let x = 1; x < 31; x++) {
    map.built[map.idx(x, 4)] = BuiltKind.RoadHighway;
    map.built[map.idx(x, 8)] = BuiltKind.RoadAvenue;
    map.built[map.idx(x, 12)] = BuiltKind.RoadStreet;
  }
  for (let y = 4; y < 13; y++) map.built[map.idx(6, y)] = BuiltKind.RoadStreet;
  map.faunaPresence.fill(160);
  return map;
}

const ambientFork = (seed: string): ReturnType<typeof createRng> =>
  createRng(seed).fork('ambient');


describe('ambient determinism', () => {
  it('is identical across two independently-constructed, identically-seeded forks', () => {
    const map = gridMap();
    const a = createAmbientState();
    const b = createAmbientState();
    // TWO fresh forks — never one shared stateful Rng (would advance the second).
    const ra = ambientFork('determinism');
    const rb = ambientFork('determinism');
    for (const dt of [50, 50, 30, 70, 120, 50, 200, 50]) {
      stepAmbient(a, map, ra, dt);
      stepAmbient(b, map, rb, dt);
    }
    expect(a).toEqual(b);
  });
});

describe('ambient fixed 50ms substep accumulator', () => {
  it('one 100ms step equals two 50ms steps', () => {
    const map = gridMap();
    const a = createAmbientState();
    const b = createAmbientState();
    const ra = ambientFork('sub');
    const rb = ambientFork('sub');
    stepAmbient(a, map, ra, 100);
    stepAmbient(b, map, rb, 50);
    stepAmbient(b, map, rb, 50);
    expect(a).toEqual(b);
  });

  it('30ms then 70ms equals two 50ms substeps with the accumulator drained', () => {
    const map = gridMap();
    const a = createAmbientState();
    const b = createAmbientState();
    const ra = ambientFork('sub2');
    const rb = ambientFork('sub2');
    stepAmbient(a, map, ra, 30); // < 50 → no substep yet
    stepAmbient(a, map, ra, 70); // 30+70=100 → two substeps
    stepAmbient(b, map, rb, 50);
    stepAmbient(b, map, rb, 50);
    expect(a.accMs).toBe(0);
    expect(a).toEqual(b);
  });
});

describe('ambient spiral-of-death clamp', () => {
  it('clamps a pathological dt to AMBIENT_MAX_FRAME_MS and returns synchronously', () => {
    const map = gridMap();
    const a = createAmbientState();
    const b = createAmbientState();
    const ra = ambientFork('spiral');
    const rb = ambientFork('spiral');
    stepAmbient(a, map, ra, 10_000_000); // clamped to AMBIENT_MAX_FRAME_MS
    stepAmbient(b, map, rb, AMBIENT_MAX_FRAME_MS);
    expect(a.accMs).toBe(0);
    expect(a).toEqual(b);
  });
});

describe('carWeightForRoad (the pure load-bearing ratio contract)', () => {
  it('weights highway 3 / avenue 2 / street 1 / quiet 0 / non-road 0 exactly', () => {
    expect(carWeightForRoad(BuiltKind.RoadHighway)).toBe(3);
    expect(carWeightForRoad(BuiltKind.RoadAvenue)).toBe(2);
    expect(carWeightForRoad(BuiltKind.RoadStreet)).toBe(1);
    expect(carWeightForRoad(BuiltKind.QuietStreet)).toBe(0);
    expect(carWeightForRoad(BuiltKind.None)).toBe(0);
    expect(carWeightForRoad(BuiltKind.HouseSingle)).toBe(0);
    expect(carWeightForRoad(BuiltKind.Rail)).toBe(0);
  });
});

describe('isCarRoad (the traversability predicate — closes the spawn-vs-move gap)', () => {
  it('admits roads 1..3 and excludes quiet streets, rail, and empty', () => {
    expect(isCarRoad(BuiltKind.RoadStreet)).toBe(true);
    expect(isCarRoad(BuiltKind.RoadAvenue)).toBe(true);
    expect(isCarRoad(BuiltKind.RoadHighway)).toBe(true);
    expect(isCarRoad(BuiltKind.QuietStreet)).toBe(false);
    expect(isCarRoad(BuiltKind.Rail)).toBe(false);
    expect(isCarRoad(BuiltKind.None)).toBe(false);
  });
});

describe('ingestTrips (cars ARE the sim O-D trips)', () => {
  it('spawns a car per trip that follows its committed path and parks on arrival', () => {
    const map = new GameMap(16, 8);
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    const path = [map.idx(2, 4), map.idx(3, 4), map.idx(4, 4), map.idx(5, 4)];
    ingestTrips(state, [{ path }], map);
    expect(state.cars.length).toBe(1);
    const car = state.cars[0]!;
    expect(car.x).toBe(2); // starts at the path origin
    const rng = ambientFork('trip');
    let maxX = car.x;
    for (let i = 0; i < 100 && !car.parked; i++) {
      maxX = Math.max(maxX, car.x);
      stepAmbient(state, map, rng, 50);
    }
    expect(maxX).toBeGreaterThanOrEqual(4); // drove along the path toward the destination
    expect(car.parked).toBe(true); // parked at the destination (street curb), did NOT despawn
    expect(car.lotIdx).toBeUndefined(); // no lots on this map → street-parked
  });

  it('ignores degenerate trips and respects CAR_CAP, deterministically', () => {
    const map = new GameMap(16, 8);
    for (let x = 0; x < 16; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    const trip = { path: [map.idx(2, 4), map.idx(3, 4), map.idx(4, 4)] };
    const a = createAmbientState();
    const b = createAmbientState();
    ingestTrips(a, [{ path: [map.idx(1, 4)] }, trip], map); // first trip too short → skipped
    ingestTrips(b, [{ path: [map.idx(1, 4)] }, trip], map);
    expect(a.cars.length).toBe(1);
    expect(a.cars).toEqual(b.cars); // deterministic
  });
});

describe('car motion: no oscillation (CRITIC-YP6)', () => {
  it('advances monotonically along a straight open road and never reverses', () => {
    const map = new GameMap(48, 8);
    for (let x = 0; x < 48; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    const car = { x: 2, y: 4, dir: 1, tx: 3, ty: 4 }; // dir 1 = East
    state.cars.push(car);
    const rng = ambientFork('mono');
    let prevX = car.x;
    for (let i = 0; i < 40; i++) {
      stepAmbient(state, map, rng, 50);
      expect(car.y).toBe(4); // never leaves its 1-wide row
      expect(car.x).toBeGreaterThanOrEqual(prevX); // monotonic — never reverses
      prevX = car.x;
    }
    expect(car.x).toBeGreaterThan(2); // actually moved
  });

  it('nextRoadStep never returns the U-turn at a junction with other roads', () => {
    const map = new GameMap(12, 12);
    // cross centered at (6,5): W, E, N, S neighbours all road
    map.built[map.idx(6, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(7, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(6, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(6, 6)] = BuiltKind.RoadStreet;
    const rng = ambientFork('junction');
    for (let i = 0; i < 50; i++) {
      const d = nextRoadStep(map, 6, 5, 3, rng); // came from West (dir 3)
      expect(d).not.toBe(3);
      expect([0, 1, 2]).toContain(d);
    }
  });

  it('nextRoadStep returns the U-turn only at a dead-end', () => {
    const map = new GameMap(12, 12);
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(6, 5)] = BuiltKind.RoadStreet; // (6,5) dead-ends west to (5,5)
    const rng = ambientFork('deadend');
    expect(nextRoadStep(map, 6, 5, 3, rng)).toBe(3); // only road neighbour is the U-turn
  });
});

describe('anti-loop routing: recent-tile avoidance (Maddy playtest — tight loops)', () => {
  function cross(): GameMap {
    const map = new GameMap(12, 12);
    map.built[map.idx(6, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet; // W
    map.built[map.idx(7, 5)] = BuiltKind.RoadStreet; // E
    map.built[map.idx(6, 4)] = BuiltKind.RoadStreet; // N
    map.built[map.idx(6, 6)] = BuiltKind.RoadStreet; // S
    return map;
  }

  it('avoids a recently-visited neighbour when a fresh option exists', () => {
    const map = cross();
    const rng = ambientFork('avoid');
    const recent = [map.idx(7, 5)]; // East tile was just visited
    for (let i = 0; i < 40; i++) {
      // came from West (fromDir 3); straight-ahead East is recent → must turn to a fresh option
      const d = nextRoadStep(map, 6, 5, 3, rng, recent);
      expect(d).not.toBe(1); // never East (recently visited)
      expect(d).not.toBe(3); // never the U-turn
      expect([0, 2]).toContain(d); // a fresh option (North or South)
    }
  });

  it('returns -1 when every non-U-turn option is recently visited (boxed in → despawn)', () => {
    const map = cross();
    const rng = ambientFork('boxed');
    const recent = [map.idx(7, 5), map.idx(6, 4), map.idx(6, 6)]; // E, N, S all recent; W is the U-turn
    expect(nextRoadStep(map, 6, 5, 3, rng, recent)).toBe(-1);
  });

  it('a car on an isolated 2x2 ring despawns instead of circling forever', () => {
    const map = new GameMap(12, 12);
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]] as const) {
      map.built[map.idx(x, y)] = BuiltKind.RoadStreet; // a 4-tile ring with no exit
    }
    const state = createAmbientState();
    state.cars.push({ x: 5, y: 5, dir: 1, tx: 6, ty: 5 });
    const rng = ambientFork('ring');
    let steps = 0;
    while (state.cars.length > 0 && steps < 400) {
      stepAmbient(state, map, rng, 50);
      steps++;
    }
    expect(state.cars.length).toBe(0); // boxed in by its own path → despawned, not an infinite loop
    expect(steps).toBeLessThan(400);
  });
});

describe('parking lots fill to capacity (Maddy: lots should accept up to 9, not one)', () => {
  it('owned cars take distinct stalls — a lot holds many, not one', () => {
    const map = new GameMap(16, 16);
    // a 2x2 parking lot the cars will pull into
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]] as const) map.built[map.idx(x, y)] = BuiltKind.ParkingLot;
    const state = createAmbientState();
    setParkingLots(
      state,
      parkingLots(map).map((lot) => ({
        cx: (lot.x0 + lot.x1) / 2,
        cy: (lot.y0 + lot.y1) / 2,
        x0: lot.x0,
        y0: lot.y0,
        x1: lot.x1,
        y1: lot.y1,
        stalls: parkingStalls(lot),
      })),
    );
    const cars: Array<{ x: number; y: number; dir: number; tx: number; ty: number; owned: boolean; stallIdx?: number }> = [];
    for (let n = 0; n < 6; n++) {
      const car = { x: 7, y: 7, dir: 1, tx: 7, ty: 7, owned: true };
      state.cars.push(car);
      parkOwnedCarSomewhere(state, map, car);
      cars.push(car);
    }
    const stalls = new Set(cars.map((c) => c.stallIdx));
    expect(stalls.size).toBe(6); // six cars → six distinct stalls (the lot holds many)
    expect(cars.every((c) => c.stallIdx !== undefined)).toBe(true); // all parked in the lot, none curbed
  });
});

describe('agent substrate invariants (Maddy: cars park on freeways, peds cross water)', () => {
  it('isParkable: streets/avenues/parking on land, never a freeway or over water', () => {
    const m = new GameMap(8, 8);
    m.built[m.idx(1, 1)] = BuiltKind.RoadStreet;
    m.built[m.idx(2, 1)] = BuiltKind.RoadAvenue;
    m.built[m.idx(3, 1)] = BuiltKind.ParkingLot;
    m.built[m.idx(4, 1)] = BuiltKind.RoadHighway; // a freeway — no parking
    m.built[m.idx(5, 1)] = BuiltKind.RoadStreet; // a road over water (a bridge) — not a kerb
    m.water[m.idx(5, 1)] = Water.Ocean;
    m.water[m.idx(6, 1)] = Water.Ocean; // open water, no road
    expect(isParkable(m, 1, 1)).toBe(true);
    expect(isParkable(m, 2, 1)).toBe(true);
    expect(isParkable(m, 3, 1)).toBe(true);
    expect(isParkable(m, 4, 1)).toBe(false); // freeway
    expect(isParkable(m, 5, 1)).toBe(false); // bridge over water
    expect(isParkable(m, 6, 1)).toBe(false); // open water
    expect(isParkable(m, 0, 0)).toBe(false); // empty land
  });

  it('nearestWalkable: returns a walkable tile itself, the nearest land off water, or null', () => {
    const m = new GameMap(8, 8);
    for (let x = 0; x < 8; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet; // a walkable street row
    m.water[m.idx(3, 1)] = Water.Ocean; // a water tile near the street
    expect(nearestWalkable(m, 2, 4)).toEqual({ x: 2, y: 4 }); // already walkable → itself
    const off = nearestWalkable(m, 3, 1); // on water → snapped to the nearest walkable tile
    expect(off).not.toBeNull();
    expect(m.water[m.idx(off!.x, off!.y)]).toBe(0); // never water
    expect(off).not.toEqual({ x: 3, y: 1 }); // moved off the water tile
    const isolated = new GameMap(4, 4);
    for (let i = 0; i < 16; i++) isolated.water[i] = Water.Ocean; // all water
    expect(nearestWalkable(isolated, 2, 2)).toBeNull();
  });

  it('reachedPlot: visiting a multi-tile plot counts as entering ANY of its tiles (Maddy)', () => {
    const m = new GameMap(16, 16);
    // a 2x2 industrial plot at (6-7, 6-7), parcel id 9
    for (const [x, y] of [[6, 6], [7, 6], [6, 7], [7, 7]] as const) {
      m.built[m.idx(x, y)] = BuiltKind.Industrial;
      m.parcel[m.idx(x, y)] = 9;
    }
    // target the FAR anchor (7,7); a ped at (5,6) is adjacent to the NEAR plot tile (6,6) → arrived
    expect(reachedPlot(m, 5, 6, 7, 7)).toBe(true); // entered a different tile of the same plot
    expect(reachedPlot(m, 6, 6, 7, 7)).toBe(true); // standing on a plot tile
    expect(reachedPlot(m, 8, 7, 7, 7)).toBe(true); // adjacent to the exact target tile
    expect(reachedPlot(m, 2, 2, 7, 7)).toBe(false); // nowhere near the plot
    // a non-parcel target (a road tile) has no footprint → only the exact-tile door counts
    m.built[m.idx(3, 3)] = BuiltKind.RoadStreet;
    expect(reachedPlot(m, 3, 4, 3, 3)).toBe(true); // adjacent
    expect(reachedPlot(m, 3, 6, 3, 3)).toBe(false); // 3 tiles off, no footprint
  });

  it('a planted median is a BARRIER — peds never route through it, cars never drive onto it (Maddy: travelers path through dividers/medians)', () => {
    const m = new GameMap(8, 8);
    // A vertical water wall at x=3 splits the map; the ONLY land bridge is the tile (3,4).
    for (let y = 0; y < 8; y++) m.water[m.idx(3, y)] = Water.Ocean;
    m.water[m.idx(3, 4)] = Water.None; // open the single gap
    // With the gap as plain land, a ped can cross (control).
    expect(walkPath(m, 2, 4, 4, 4)).not.toBeNull();
    // Plant a median in the gap: now the only crossing is a no-traffic green BARRIER → no foot route.
    m.built[m.idx(3, 4)] = BuiltKind.PlantedMedian;
    expect(walkPath(m, 2, 4, 4, 4)).toBeNull(); // peds must NOT cut across the median
    // Cars were already blocked (carTraversable/canDrive exclude the median) — lock it in.
    m.built[m.idx(2, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 4)] = BuiltKind.RoadStreet;
    expect(canDrive(m, 2, 4, 3, 4)).toBe(false); // can't drive onto the median
    expect(canDrive(m, 4, 4, 3, 4)).toBe(false);
  });

  it('curbStallOffsets: <=4 discrete kerb stalls; a no-shoulder lane interior offers NONE', () => {
    const m = new GameMap(12, 12);
    for (let x = 1; x <= 10; x++) m.built[m.idx(x, 6)] = BuiltKind.RoadStreet; // a 1-wide street, land both sides
    const s = curbStallOffsets(m, 5, 6);
    expect(s.length).toBe(4); // 2 stalls on each kerb (N + S)
    for (const st of s) {
      expect(Math.abs(st.dx)).toBeLessThan(0.5); // each offset stays within the tile (rounds to the road tile)
      expect(Math.abs(st.dy)).toBeLessThan(0.5);
    }
    // widen to a 3-lane road: the middle lane has drivable neighbours all round → no kerb → no stalls
    for (let y = 5; y <= 7; y++) for (let x = 1; x <= 10; x++) m.built[m.idx(x, y)] = BuiltKind.RoadStreet;
    expect(curbStallOffsets(m, 5, 6).length).toBe(0); // lane interior → no double-parking in the middle
  });

  it('cars curb-park in DISTINCT kerb stalls (<=4 per road tile), never the lane centre (Maddy: (51,102))', () => {
    const m = new GameMap(20, 12);
    for (let x = 2; x <= 17; x++) m.built[m.idx(x, 6)] = BuiltKind.RoadStreet; // a street, land both sides
    const state = createAmbientState(); // no lots → kerb stalls only
    const cars: Array<{ x: number; y: number; curbSlot?: number; parked?: boolean }> = [];
    for (let i = 0; i < 6; i++) {
      const c = { x: 9, y: 6, dir: 1, tx: 9, ty: 6, owned: true, parked: false };
      state.cars.push(c);
      cars.push(c);
      parkOwnedCarSomewhere(state, m, c);
    }
    const parked = cars.filter((c) => c.parked && state.cars.includes(c as never));
    expect(parked.length).toBeGreaterThanOrEqual(4);
    for (const c of parked) expect(c.curbSlot).not.toBeUndefined(); // a discrete stall, not a warp
    // no two cars share the same (road tile, slot)
    const keys = parked.map((c) => `${Math.round(c.x)},${Math.round(c.y)},${c.curbSlot}`);
    expect(new Set(keys).size).toBe(keys.length);
    // at most 4 cars per road tile
    const perTile = new Map<string, number>();
    for (const c of parked) {
      const t = `${Math.round(c.x)},${Math.round(c.y)}`;
      perTile.set(t, (perTile.get(t) ?? 0) + 1);
    }
    for (const n of perTile.values()) expect(n).toBeLessThanOrEqual(4);
  });

  it('a curb-parking car pulls onto a SHOULDER, never the middle of a wide road (Maddy: (51,100))', () => {
    const m = new GameMap(16, 16);
    for (let y = 3; y <= 11; y++) for (let x = 3; x <= 11; x++) m.built[m.idx(x, y)] = BuiltKind.RoadStreet; // a wide road slab, no lots
    const state = createAmbientState(); // no parking lots → must curb-park on a shoulder
    const car = { x: 7, y: 7, dir: 1, tx: 7, ty: 7, owned: true, parked: false }; // ended deep in the slab
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    expect(car.parked).toBe(true);
    // The parked tile must touch a NON-road tile (a kerb to pull onto) — never buried in the road.
    const px = Math.round(car.x);
    const py = Math.round(car.y);
    let hasShoulder = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = px + dx;
      const ny = py + dy;
      if (!m.inBounds(nx, ny) || m.built[m.idx(nx, ny)] === BuiltKind.None) hasShoulder = true;
    }
    expect(hasShoulder).toBe(true);
  });

  it('parkOwnedCarSomewhere never leaves a car resting on a freeway', () => {
    const m = new GameMap(16, 8);
    for (let x = 0; x < 16; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadHighway; // a freeway strip
    m.built[m.idx(8, 5)] = BuiltKind.RoadStreet; // one valid kerb beside it
    const state = createAmbientState();
    const car = { x: 8, y: 4, dir: 1, tx: 8, ty: 4, owned: true }; // drive ended ON the freeway
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    // It must not come to rest on a freeway tile — it pulls onto the kerb instead.
    const still = state.cars.includes(car);
    if (still) expect(m.built[m.idx(Math.round(car.x), Math.round(car.y))]).not.toBe(BuiltKind.RoadHighway);
  });

  it('parkOwnedCarSomewhere removes a car with nowhere valid to park (no freeway dump)', () => {
    const m = new GameMap(12, 8);
    for (let x = 0; x < 12; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadHighway; // freeway only — no kerb anywhere
    const state = createAmbientState();
    const car = { x: 6, y: 4, dir: 1, tx: 6, ty: 4, owned: true, parked: false };
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    // No valid spot exists → the car must not be left parked on the freeway.
    const onFreeway =
      state.cars.includes(car) &&
      car.parked &&
      m.built[m.idx(Math.round(car.x), Math.round(car.y))] === BuiltKind.RoadHighway;
    expect(onFreeway).toBe(false);
  });

  it('a pedestrian placed on water is snapped off it (or respawned), never left crossing', () => {
    const m = new GameMap(12, 12);
    for (let x = 0; x < 12; x++) m.built[m.idx(x, 6)] = BuiltKind.QuietStreet; // a walkable promenade row
    m.water[m.idx(3, 2)] = Water.Ocean; // a water tile away from the street
    const state = createAmbientState();
    const home = m.idx(5, 6);
    state.peds.push({ x: 3, y: 2, dir: 0, tx: 3, ty: 2, phase: 'to-home', walkTo: { x: 5, y: 6 }, homeTile: home });
    const rng = ambientFork('snap');
    stepAmbient(state, m, rng, 50);
    const ped = state.peds[0];
    if (ped) expect(m.water[m.idx(Math.round(ped.x), Math.round(ped.y))]).toBe(0); // no longer on water
  });
});

describe('accumulateGroundPollution (Maddy: live land contamination; litter feeds in)', () => {
  it('industry, dirty plants, and demand-path litter poison the ground; clean land + water stay clean', () => {
    const m = new GameMap(12, 12);
    m.built[m.idx(3, 3)] = BuiltKind.Industrial; // a toxic industrial tile
    m.water[m.idx(9, 9)] = Water.Ocean; // water keeps its own runoff field, not ground pollution
    const state = createAmbientState();
    setPlantEmitters(state, [{ tile: m.idx(6, 6), amount: 10 }]); // a dirty power plant
    state.wear.set(m.idx(2, 8), 200); // a heavily trampled, littered demand path
    accumulateGroundPollution(state, m);
    expect(state.groundPollution.get(m.idx(3, 3)) ?? 0).toBeGreaterThan(0); // industry poisons the ground
    expect(state.groundPollution.get(m.idx(6, 6)) ?? 0).toBeGreaterThan(0); // the dirty plant does too
    expect(state.groundPollution.get(m.idx(2, 8)) ?? 0).toBeGreaterThan(0); // litter from the path feeds in
    expect(state.groundPollution.get(m.idx(11, 0)) ?? 0).toBe(0); // clean empty land stays clean
    expect(state.groundPollution.get(m.idx(9, 9)) ?? 0).toBe(0); // a water tile never collects ground pollution
  });

  it('redlined industry contaminates the ground MORE than greenlined (grade-scaled)', () => {
    const lo = new GameMap(8, 8);
    const hi = new GameMap(8, 8);
    lo.built[lo.idx(4, 4)] = BuiltKind.Industrial;
    hi.built[hi.idx(4, 4)] = BuiltKind.Industrial;
    hi.redline[hi.idx(4, 4)] = 255; // fully redlined (lo stays grade 0)
    const a = createAmbientState();
    const b = createAmbientState();
    accumulateGroundPollution(a, lo);
    accumulateGroundPollution(b, hi);
    expect(b.groundPollution.get(hi.idx(4, 4))!).toBeGreaterThan(a.groundPollution.get(lo.idx(4, 4))!);
  });

  it('the contamination clears once the source is removed (lingering but reparable)', () => {
    const m = new GameMap(8, 8);
    m.built[m.idx(4, 4)] = BuiltKind.Industrial;
    const state = createAmbientState();
    for (let i = 0; i < 80; i++) accumulateGroundPollution(state, m); // builds up over the cadence
    expect(state.groundPollution.get(m.idx(4, 4)) ?? 0).toBeGreaterThan(100);
    m.built[m.idx(4, 4)] = BuiltKind.None; // the player bulldozes / rewilds the source
    for (let i = 0; i < 2000; i++) accumulateGroundPollution(state, m);
    expect(state.groundPollution.get(m.idx(4, 4)) ?? 0).toBe(0); // the land recovers
  });
});

describe('driftPollution (Maddy: prevailing wind carries smog downwind into plumes)', () => {
  it('carries a fraction of a tile\'s smog one tile downwind, conserving the rest', () => {
    const m = new GameMap(12, 12);
    const state = createAmbientState();
    state.wind = { dx: 1, dy: 0 }; // a westerly: smog blows due east
    const src = m.idx(4, 4);
    state.pollution.set(src, 100);
    driftPollution(state, m);
    const here = state.pollution.get(src) ?? 0;
    const downwind = state.pollution.get(m.idx(5, 4)) ?? 0;
    expect(downwind).toBeGreaterThan(0); // smog moved downwind
    expect(here).toBeLessThan(100); // and the source dropped
    expect(here + downwind).toBeCloseTo(100, 5); // conservative transfer inside the map
    expect(downwind).toBeLessThan(here); // only a fraction moves per pass (a gradient, not teleport)
  });

  it('drifts toward the wind vector, not the opposite or perpendicular tiles', () => {
    const m = new GameMap(12, 12);
    const state = createAmbientState();
    state.wind = { dx: 0, dy: 1 }; // blows due south
    const src = m.idx(6, 6);
    state.pollution.set(src, 80);
    driftPollution(state, m);
    expect(state.pollution.get(m.idx(6, 7)) ?? 0).toBeGreaterThan(0); // south (downwind) gets smog
    expect(state.pollution.get(m.idx(6, 5)) ?? 0).toBe(0); // north (upwind) gets none
    expect(state.pollution.get(m.idx(5, 6)) ?? 0).toBe(0); // west gets none
    expect(state.pollution.get(m.idx(7, 6)) ?? 0).toBe(0); // east gets none
  });

  it('builds a streaking plume: repeated drift+decay spreads smog downwind from a steady source', () => {
    const m = new GameMap(20, 8);
    const state = createAmbientState();
    state.wind = { dx: 1, dy: 0 };
    const sx = 2;
    const sy = 4;
    const src = m.idx(sx, sy);
    for (let i = 0; i < 30; i++) {
      layField(state.pollution, src, 60, 255); // a steady source re-emitting each pass
      driftPollution(state, m);
      decayField(state.pollution, 0.4);
    }
    expect(state.pollution.get(m.idx(sx + 4, sy)) ?? 0).toBeGreaterThan(0); // plume reaches well downwind
    expect(state.pollution.get(m.idx(sx - 1, sy)) ?? 0).toBe(0); // nothing upwind of the source
  });

  it('smog blowing off the map edge leaves the system (no wrap, no throw)', () => {
    const m = new GameMap(6, 6);
    const state = createAmbientState();
    state.wind = { dx: 1, dy: 0 };
    state.pollution.set(m.idx(5, 3), 50); // rightmost column
    expect(() => driftPollution(state, m)).not.toThrow();
    expect(state.pollution.get(m.idx(0, 3)) ?? 0).toBe(0); // did NOT wrap to the left edge
  });

  it('is a no-op when there is no wind (dx=dy=0)', () => {
    const m = new GameMap(8, 8);
    const state = createAmbientState();
    state.wind = { dx: 0, dy: 0 };
    state.pollution.set(m.idx(4, 4), 70);
    driftPollution(state, m);
    expect(state.pollution.get(m.idx(4, 4))).toBe(70); // unchanged
  });
});

describe('prevailingWind (seeded per world, never both-zero)', () => {
  it('returns an integer unit vector that is never (0,0)', () => {
    for (let s = 0; s < 12; s++) {
      const w = prevailingWind(ambientFork(`seed-${s}`));
      expect(Number.isInteger(w.dx)).toBe(true);
      expect(Number.isInteger(w.dy)).toBe(true);
      expect(w.dx === 0 && w.dy === 0).toBe(false);
      expect(Math.abs(w.dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(w.dy)).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic per seed (same world → same prevailing wind)', () => {
    expect(prevailingWind(ambientFork('repeat'))).toEqual(prevailingWind(ambientFork('repeat')));
  });

  it('createAmbientState seeds the wind from the rng when given one', () => {
    const state = createAmbientState(ambientFork('windy'));
    expect(state.wind.dx === 0 && state.wind.dy === 0).toBe(false);
  });
});

describe('big parking lots fill nearest-tile-first (Maddy: blocks hold one car per lot)', () => {
  // Build the ambient lot records (centre + bbox + stalls) the way main.ts does.
  const lotInfos = (map: GameMap) =>
    parkingLots(map).map((lot) => ({
      cx: (lot.x0 + lot.x1) / 2,
      cy: (lot.y0 + lot.y1) / 2,
      x0: lot.x0,
      y0: lot.y0,
      x1: lot.x1,
      y1: lot.y1,
      stalls: parkingStalls(lot),
    }));

  it('a car parks in the lot stall NEAREST its arrival, not the row-major first stall', () => {
    const m = new GameMap(16, 8);
    for (let x = 1; x <= 8; x++) m.built[m.idx(x, 2)] = BuiltKind.ParkingLot; // an 8-tile strip
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const car = { x: 8, y: 3, dir: 0, tx: 8, ty: 3, owned: true, parked: false, lotIdx: undefined as number | undefined };
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    expect(car.lotIdx).not.toBeUndefined(); // parked IN the lot
    expect(Math.round(car.x)).toBeGreaterThanOrEqual(6); // near the east end it arrived at, not x~1
  });

  it('many cars fill a big lot to many distinct stalls (not one per lot)', () => {
    const m = new GameMap(16, 8);
    for (let x = 1; x <= 8; x++) m.built[m.idx(x, 2)] = BuiltKind.ParkingLot;
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const parked: Array<{ lotIdx?: number; stallIdx?: number }> = [];
    for (let n = 0; n < 20; n++) {
      const car = { x: 8, y: 3, dir: 0, tx: 8, ty: 3, owned: true, parked: false } as {
        x: number; y: number; dir: number; tx: number; ty: number; owned: boolean; parked: boolean;
        lotIdx?: number; stallIdx?: number;
      };
      state.cars.push(car);
      parkOwnedCarSomewhere(state, m, car);
      parked.push({ lotIdx: car.lotIdx, stallIdx: car.stallIdx });
    }
    expect(parked.every((c) => c.lotIdx !== undefined)).toBe(true); // all in lots, none curbed
    // 20 distinct STALLS across the per-tile lots (lotIdx,stallIdx pairs) — fills the block, not one each.
    expect(new Set(parked.map((c) => `${c.lotIdx},${c.stallIdx}`)).size).toBe(20);
  });

  it('prefers a near STREET curb over a farther lot stall (Maddy: a stall the next tile over)', () => {
    const m = new GameMap(24, 10);
    for (let x = 2; x <= 20; x++) m.built[m.idx(x, 5)] = BuiltKind.RoadStreet; // a street, land both sides → kerb stalls
    m.built[m.idx(14, 4)] = BuiltKind.ParkingLot; // a FREE lot stall ~5 tiles off (within PARK_RADIUS)
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const car = { x: 10, y: 5, dir: 1, tx: 10, ty: 5, owned: true, parked: false } as {
      x: number; y: number; dir: number; tx: number; ty: number; owned: boolean; parked: boolean;
      lotIdx?: number; curbSlot?: number;
    };
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    expect(car.parked).toBe(true);
    expect(car.curbSlot).not.toBeUndefined(); // took the kerb stall right here...
    expect(car.lotIdx).toBeUndefined(); // ...not the lot 5 tiles away
  });

  it('a car reaches a big lot from its EDGE even when the lot CENTRE is out of park range', () => {
    const m = new GameMap(32, 8);
    for (let x = 1; x <= 24; x++) m.built[m.idx(x, 2)] = BuiltKind.ParkingLot; // centre at x=12.5
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const car = { x: 1, y: 3, dir: 0, tx: 1, ty: 3, owned: true, parked: false, lotIdx: undefined as number | undefined };
    state.cars.push(car); // at the WEST edge; the centre (x~12.5) is far out of PARK_RADIUS
    parkOwnedCarSomewhere(state, m, car);
    expect(car.lotIdx).not.toBeUndefined(); // still parks in the big lot (via its edge), not curb/removed
    expect(Math.round(car.x)).toBeLessThanOrEqual(8); // near the west edge it arrived at
  });
});

describe('parking lots are drivable — cars cut through (Maddy: cars cut through parking)', () => {
  it('a car cuts through a parking lot in its path instead of being blocked', () => {
    const m = new GameMap(16, 8);
    for (let x = 0; x < 16; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(7, 4)] = BuiltKind.ParkingLot; // a parking segment across the road
    m.built[m.idx(8, 4)] = BuiltKind.ParkingLot;
    const state = createAmbientState();
    const car = { x: 2, y: 4, dir: 1, tx: 3, ty: 4 }; // heading East toward the parking
    state.cars.push(car);
    const rng = ambientFork('cut');
    let maxX = 2;
    for (let i = 0; i < 200 && state.cars.includes(car); i++) {
      maxX = Math.max(maxX, car.x);
      stepAmbient(state, m, rng, 50);
    }
    expect(maxX).toBeGreaterThan(9); // drove through the parking (x7,8) out the far side, not blocked
  });

  it('a car on a parking tile is not despawned (parking is drivable)', () => {
    const m = new GameMap(8, 8);
    for (let x = 0; x < 8; x++) m.built[m.idx(x, 4)] = BuiltKind.ParkingLot;
    const state = createAmbientState();
    state.cars.push({ x: 2, y: 4, dir: 1, tx: 3, ty: 4 });
    const rng = ambientFork('pk');
    stepAmbient(state, m, rng, 50);
    expect(state.cars.length).toBe(1); // survived a step on the lot
  });
});

describe('laneOffset (lane math — opposing traffic on opposite sides of a road block)', () => {
  // Maddy playtest: "the roads need lane math" + "a road block should run either
  // vertical or horizontal and have bidirectional flow." A mover is drawn offset to
  // the RIGHT of its heading (right-hand traffic), so on any vertical/horizontal road
  // the two travel directions ride opposite sides. 0=N, 1=E, 2=S, 3=W; screen coords
  // are y-down, so "right of heading" is heading rotated 90° clockwise.
  it('offsets each heading perpendicular-right (right-hand traffic)', () => {
    const n = laneOffset(0);
    const e = laneOffset(1);
    const s = laneOffset(2);
    const w = laneOffset(3);
    // North → east side; East → south side; South → west side; West → north side.
    // (The off-axis component is exactly zero, ±0 — toBeCloseTo treats both as 0.)
    expect(n.dx).toBeGreaterThan(0);
    expect(n.dy).toBeCloseTo(0);
    expect(e.dy).toBeGreaterThan(0);
    expect(e.dx).toBeCloseTo(0);
    expect(s.dx).toBeLessThan(0);
    expect(s.dy).toBeCloseTo(0);
    expect(w.dy).toBeLessThan(0);
    expect(w.dx).toBeCloseTo(0);
  });

  it('puts opposing directions on opposite sides (equal and opposite) — bidirectional flow', () => {
    const n = laneOffset(0);
    const s = laneOffset(2);
    const e = laneOffset(1);
    const w = laneOffset(3);
    expect(n.dx).toBeCloseTo(-s.dx);
    expect(n.dy).toBeCloseTo(-s.dy);
    expect(e.dx).toBeCloseTo(-w.dx);
    expect(e.dy).toBeCloseTo(-w.dy);
  });

  it('uses one consistent, nonzero lane width for every heading', () => {
    const mags = [0, 1, 2, 3].map((d) => {
      const { dx, dy } = laneOffset(d);
      return Math.sqrt(dx * dx + dy * dy);
    });
    for (const m of mags) expect(m).toBeGreaterThan(0);
    for (const m of mags) expect(m).toBeCloseTo(mags[0]!);
  });
});

describe('car routing prefers straight — runs a road block, does not loop (Maddy playtest)', () => {
  // "cars can run in loops through 4-blocks of road ... all road gives all adjacent
  // roads as valid destination tiles." Under uniform choice a car turns 2/3 of the
  // time at a 4-way, so it circles small blocks. Cars should read as through-traffic:
  // heavily prefer continuing straight, turn only occasionally (and never U-turn).
  it('crosses a 4-way junction straight far more often than it turns, never U-turns', () => {
    const map = new GameMap(12, 12);
    // cross centred at (6,5): all four neighbours are road.
    map.built[map.idx(6, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(7, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(6, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(6, 6)] = BuiltKind.RoadStreet;
    const rng = ambientFork('straight-bias');
    const counts = [0, 0, 0, 0];
    const N = 600;
    for (let i = 0; i < N; i++) {
      // came from West (dir 3) → straight ahead is East (dir 1).
      const d = nextRoadStep(map, 6, 5, 3, rng);
      counts[d] = counts[d]! + 1;
    }
    expect(counts[3]).toBe(0); // never the U-turn
    expect(counts[1]).toBeGreaterThan(N * 0.6); // strongly prefers straight (East)
    expect(counts[1]).toBeGreaterThan(counts[0]! + counts[2]!); // straight beats both turns
    expect(counts[0]).toBeGreaterThan(0); // ...but turns still happen — a bias, not a rail
    expect(counts[2]).toBeGreaterThan(0);
  });

  it('still turns when straight is not a road (follows an L-bend, no U-turn)', () => {
    const map = new GameMap(12, 12);
    // L-bend: road comes in from the West and turns North at (6,5). Straight (East)
    // is NOT a road, so the car must turn North rather than reverse.
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet; // west (the U-turn)
    map.built[map.idx(6, 5)] = BuiltKind.RoadStreet; // the corner
    map.built[map.idx(6, 4)] = BuiltKind.RoadStreet; // north
    const rng = ambientFork('lbend');
    for (let i = 0; i < 20; i++) {
      expect(nextRoadStep(map, 6, 5, 3, rng)).toBe(0); // came from West → turns North
    }
  });
});

// A 3-wide horizontal freeway: rows 5,6,7 all RoadHighway across the map.
function freewayH(): GameMap {
  const m = new GameMap(20, 14);
  for (let x = 0; x < 20; x++) {
    m.built[m.idx(x, 5)] = BuiltKind.RoadHighway;
    m.built[m.idx(x, 6)] = BuiltKind.RoadHighway;
    m.built[m.idx(x, 7)] = BuiltKind.RoadHighway;
  }
  return m;
}

describe('freewayLane (divided multi-lane roads — outer one-way, middle two-way through)', () => {
  // Maddy playtest: "south goes east, north goes west, middle goes both." A widened road is a
  // divided highway: two one-way outer carriageways (right-hand traffic) and a two-way `through`
  // lane in the middle of a 3+-wide road (the planted median is a future road-diet upgrade).
  it('classifies the two outer lanes one-way (opposite) and the middle as a two-way through lane', () => {
    const m = freewayH();
    // outward edge is the non-road side; dir is the right-hand-traffic heading.
    expect(freewayLane(m, 10, 5)).toEqual({ role: 'outer', dir: 3, outward: 0 }); // north lane → West
    expect(freewayLane(m, 10, 6)).toEqual({ role: 'through', horizontal: true }); // middle → both
    expect(freewayLane(m, 10, 7)).toEqual({ role: 'outer', dir: 1, outward: 2 }); // south lane → East
  });

  it('classifies a vertical freeway: west lane south, east lane north, middle two-way', () => {
    const m = new GameMap(14, 20);
    for (let y = 0; y < 20; y++) {
      m.built[m.idx(5, y)] = BuiltKind.RoadHighway;
      m.built[m.idx(6, y)] = BuiltKind.RoadHighway;
      m.built[m.idx(7, y)] = BuiltKind.RoadHighway;
    }
    expect(freewayLane(m, 5, 10)).toEqual({ role: 'outer', dir: 2, outward: 3 }); // west lane → South
    expect(freewayLane(m, 6, 10)).toEqual({ role: 'through', horizontal: false }); // middle → both
    expect(freewayLane(m, 7, 10)).toEqual({ role: 'outer', dir: 0, outward: 1 }); // east lane → North
  });

  it('splits a 2-wide avenue into two opposite one-way lanes (no median)', () => {
    const m = new GameMap(20, 14);
    for (let x = 0; x < 20; x++) {
      m.built[m.idx(x, 6)] = BuiltKind.RoadAvenue;
      m.built[m.idx(x, 7)] = BuiltKind.RoadAvenue;
    }
    expect(freewayLane(m, 10, 6)).toEqual({ role: 'outer', dir: 3, outward: 0 }); // north → West
    expect(freewayLane(m, 10, 7)).toEqual({ role: 'outer', dir: 1, outward: 2 }); // south → East
  });

  it('classifies a PlantedMedian tile as the (no-traffic) median role', () => {
    const m = freewayH();
    m.built[m.idx(10, 6)] = BuiltKind.PlantedMedian; // road-diet: the middle through-lane is planted
    expect(freewayLane(m, 10, 6)).toEqual({ role: 'median' });
  });

  it('keeps the carriageways one-way when the middle is a planted median (band preserved)', () => {
    const m = freewayH();
    for (let x = 0; x < 20; x++) m.built[m.idx(x, 6)] = BuiltKind.PlantedMedian; // whole middle planted
    // The outer carriageways must STILL read one-way (the median counts as part of the road's width
    // band for orientation), or the divided road would collapse into two bidirectional 1-wide roads.
    expect(freewayLane(m, 10, 5)).toEqual({ role: 'outer', dir: 3, outward: 0 }); // north → West
    expect(freewayLane(m, 10, 7)).toEqual({ role: 'outer', dir: 1, outward: 2 }); // south → East
  });
});

describe('canDrive (limited-access freeways — Maddy: no cross traffic except interchanges/ends)', () => {
  it('travels ALONG an outer lane in its one-way dir, never against it', () => {
    const m = freewayH(); // rows 5 (N→West), 6 (through), 7 (S→East)
    expect(canDrive(m, 11, 5, 10, 5)).toBe(true); // West along the north lane ✓
    expect(canDrive(m, 10, 5, 11, 5)).toBe(false); // East = wrong-way on the north lane ✗
    expect(canDrive(m, 10, 7, 11, 7)).toBe(true); // East along the south lane ✓
    expect(canDrive(m, 11, 7, 10, 7)).toBe(false); // West = wrong-way on the south lane ✗
  });

  it('carries the through middle BOTH ways along the axis, but not perpendicular', () => {
    const m = freewayH();
    expect(canDrive(m, 11, 6, 10, 6)).toBe(true); // West along the middle ✓
    expect(canDrive(m, 10, 6, 11, 6)).toBe(true); // East along the middle ✓ (two-way)
    expect(canDrive(m, 10, 5, 10, 6)).toBe(false); // N outer → middle (perpendicular lane change) ✗
  });

  it('blocks a cross street from entering the freeway mid-span (limited access)', () => {
    const m = freewayH();
    m.built[m.idx(10, 4)] = BuiltKind.RoadStreet; // a street touching the freeway's north edge
    m.built[m.idx(10, 8)] = BuiltKind.RoadStreet; // and resuming on the south edge
    expect(canDrive(m, 10, 4, 10, 5)).toBe(false); // street can't cut INTO the freeway perpendicular ✗
    expect(canDrive(m, 10, 5, 10, 4)).toBe(true); // but the freeway CAN ramp off via its outward edge ✓
  });

  it('allows free crossing/turning at a freeway END/interchange (a null lane tile)', () => {
    const m = new GameMap(10, 10);
    m.built[m.idx(5, 5)] = BuiltKind.RoadHighway; // a lone 1-wide highway stub → freewayLane null
    m.built[m.idx(5, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 5)] = BuiltKind.RoadStreet;
    expect(canDrive(m, 5, 4, 5, 5)).toBe(true); // enter the stub from the north ✓
    expect(canDrive(m, 5, 5, 4, 5)).toBe(true); // and turn off it westward ✓
  });

  it('leaves at-grade streets/avenues fully permissive (cross traffic unchanged)', () => {
    const m = new GameMap(10, 10);
    for (let x = 0; x < 10; x++) m.built[m.idx(x, 5)] = BuiltKind.RoadStreet;
    for (let y = 0; y < 10; y++) m.built[m.idx(5, y)] = BuiltKind.RoadStreet;
    expect(canDrive(m, 4, 5, 5, 5)).toBe(true); // East through the crossing
    expect(canDrive(m, 5, 4, 5, 5)).toBe(true); // South through the crossing (cross traffic OK)
  });
});

describe('freewayLane — 1-wide roads + staggered junctions stay null', () => {
  it('returns null for a 1-wide road (general routing applies)', () => {
    const m = new GameMap(20, 14);
    for (let x = 0; x < 20; x++) m.built[m.idx(x, 6)] = BuiltKind.RoadStreet;
    expect(freewayLane(m, 10, 6)).toBeNull();
  });

  it('never treats 1-wide STREETS as divided lanes, even at a staggered junction', () => {
    // Maddy's degenerate case (real tiles 52,112 / 52,113): a vertical street with an
    // east arm one row, a street block the next row (off-by-one). The band heuristic
    // would read these single-lane junction tiles as OPPOSING divided lanes (one South,
    // one North) and oscillate. Streets are 1-wide by construction — only widened
    // avenues/highways are divided — so a street is never a lane.
    const m = new GameMap(12, 12);
    for (let y = 3; y <= 6; y++) m.built[m.idx(5, y)] = BuiltKind.RoadStreet; // vertical column
    m.built[m.idx(6, 4)] = BuiltKind.RoadStreet; // east arm at y4
    m.built[m.idx(7, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 5)] = BuiltKind.RoadStreet; // west block at y5/y6 (off-by-one)
    m.built[m.idx(3, 5)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 6)] = BuiltKind.RoadStreet;
    m.built[m.idx(3, 6)] = BuiltKind.RoadStreet;
    expect(freewayLane(m, 5, 4)).toBeNull();
    expect(freewayLane(m, 5, 5)).toBeNull();
  });

  it('a car at a staggered street junction does not oscillate between two tiles', () => {
    const m = new GameMap(12, 12);
    for (let y = 3; y <= 6; y++) m.built[m.idx(5, y)] = BuiltKind.RoadStreet;
    m.built[m.idx(6, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(7, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 5)] = BuiltKind.RoadStreet;
    m.built[m.idx(3, 5)] = BuiltKind.RoadStreet;
    m.built[m.idx(4, 6)] = BuiltKind.RoadStreet;
    m.built[m.idx(3, 6)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    const car = { x: 5, y: 4, dir: 2, tx: 5, ty: 5 }; // heading South toward (5,5)
    state.cars.push(car);
    const rng = ambientFork('stagger');
    const visited = new Set<string>();
    let steps = 0;
    while (state.cars.includes(car) && steps < 400) {
      visited.add(`${Math.round(car.x)},${Math.round(car.y)}`);
      stepAmbient(state, m, rng, 50);
      steps++;
    }
    expect(visited.size).toBeGreaterThan(2); // escaped the 2-tile pair — not a forever bounce
    expect(steps).toBeLessThan(400); // and eventually left/despawned
  });
});

describe('freeway routing (outer one-way, no weaving, turn only at a true junction)', () => {
  it('an outer-lane car always travels its one-way dir — never weaves or reverses, even at spawn', () => {
    const m = freewayH();
    const rng = ambientFork('fw-route');
    for (const fromDir of [-1, 0, 1, 2, 3]) {
      expect(nextRoadStep(m, 10, 7, fromDir, rng)).toBe(1); // south lane → East, always
      expect(nextRoadStep(m, 10, 5, fromDir, rng)).toBe(3); // north lane → West, always
    }
  });

  it('turns off only where a cross-road meets the outer edge (true junction)', () => {
    const m = freewayH();
    m.built[m.idx(10, 8)] = BuiltKind.RoadStreet; // off-ramp touching the south edge
    const rng = ambientFork('fw-exit');
    const counts = { east: 0, ramp: 0, other: 0 };
    for (let i = 0; i < 600; i++) {
      const d = nextRoadStep(m, 10, 7, 3, rng); // on the south lane, came from west
      if (d === 1) counts.east++;
      else if (d === 2) counts.ramp++; // ramp = South (the outward edge)
      else counts.other++;
    }
    expect(counts.other).toBe(0); // never the median (North) or a reversal (West)
    expect(counts.ramp).toBeGreaterThan(0); // exits DO happen at the junction
    expect(counts.east).toBeGreaterThan(counts.ramp); // but mostly stays on the freeway
  });

});

describe('isPedSubstrate', () => {
  it('matches quiet/promenade/parklet/green-adjacent and excludes roads/empty', () => {
    const map = new GameMap(12, 12);
    map.built[map.idx(1, 1)] = BuiltKind.QuietStreet;
    map.built[map.idx(2, 1)] = BuiltKind.Promenade;
    map.built[map.idx(3, 1)] = BuiltKind.Parklet;
    map.built[map.idx(5, 5)] = BuiltKind.CommunityGarden; // (5,4) is adjacent
    map.built[map.idx(8, 8)] = BuiltKind.Park; // (8,7) adjacent
    map.built[map.idx(7, 1)] = BuiltKind.RoadStreet;
    expect(isPedSubstrate(map, 1, 1)).toBe(true);
    expect(isPedSubstrate(map, 2, 1)).toBe(true);
    expect(isPedSubstrate(map, 3, 1)).toBe(true);
    expect(isPedSubstrate(map, 5, 4)).toBe(true); // garden-adjacent
    expect(isPedSubstrate(map, 8, 7)).toBe(true); // park-adjacent
    expect(isPedSubstrate(map, 7, 1)).toBe(false); // road
    expect(isPedSubstrate(map, 11, 11)).toBe(false); // empty, not adjacent
  });
});

describe('birdSpawnAt + flock sizing', () => {
  it('requires fauna >= threshold (dead zones excluded)', () => {
    const map = new GameMap(8, 8);
    map.faunaPresence[map.idx(3, 3)] = 200;
    map.faunaPresence[map.idx(4, 4)] = 10;
    expect(birdSpawnAt(map, 3, 3)).toBe(true);
    expect(birdSpawnAt(map, 4, 4)).toBe(false);
    expect(birdSpawnAt(map, 0, 0)).toBe(false); // 0 fauna = dead zone
  });

  it('spawns flocks of size 3..7 over fauna-rich land', () => {
    const map = new GameMap(24, 24);
    map.faunaPresence.fill(220);
    const state = createAmbientState();
    const rng = ambientFork('flocks');
    for (let i = 0; i < 80; i++) stepAmbient(state, map, rng, 50);
    expect(state.birds.length).toBeGreaterThan(0);
    for (const f of state.birds) {
      expect(f.birds.length).toBeGreaterThanOrEqual(3);
      expect(f.birds.length).toBeLessThanOrEqual(7);
    }
  });
});

describe('ambient despawn: driving-ped exemption is explicit (no stale-walkTo reliance)', () => {
  it('exempts a driving ped off the ped network; despawns an idle one', () => {
    const map = new GameMap(8, 8);
    for (let x = 0; x < 8; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadHighway; // freeway: NOT ped substrate
    const driving = { x: 3, y: 4, dir: 1, tx: 3, ty: 4, phase: 'driving' as const }; // hidden in its car, no walkTo
    const idle = { x: 3, y: 4, dir: 1, tx: 3, ty: 4 }; // not driving, no walkTo, off the ped network
    expect(pedDespawns(map, driving)).toBe(false); // explicitly exempt by phase
    expect(pedDespawns(map, idle)).toBe(true); // substrate gone → despawns
  });
});

describe('ambient despawn', () => {
  it('despawns a car whose tile is converted to non-road', () => {
    const map = new GameMap(4, 4);
    map.built[map.idx(1, 1)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    state.cars.push({ x: 1, y: 1, dir: 1, tx: 2, ty: 1 });
    const rng = ambientFork('despawn-car');
    map.built[map.idx(1, 1)] = BuiltKind.None; // road removed under the car
    stepAmbient(state, map, rng, 50);
    expect(state.cars.length).toBe(0);
  });

  it('despawns a ped that leaves its substrate', () => {
    const map = new GameMap(4, 4);
    map.built[map.idx(1, 1)] = BuiltKind.Promenade;
    const state = createAmbientState();
    state.peds.push({ x: 1, y: 1, dir: 1, tx: 2, ty: 1 });
    const rng = ambientFork('despawn-ped');
    map.built[map.idx(1, 1)] = BuiltKind.None;
    stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(0);
  });

  it('thins a flock when its tile fauna drops to zero', () => {
    const map = new GameMap(8, 8);
    map.faunaPresence.fill(220);
    const state = createAmbientState();
    state.birds.push({
      birds: [
        { x: 4, y: 4, vx: 0, vy: 0 },
        { x: 4, y: 4, vx: 0, vy: 0 },
        { x: 4, y: 4, vx: 0, vy: 0 },
        { x: 4, y: 4, vx: 0, vy: 0 },
        { x: 4, y: 4, vx: 0, vy: 0 },
      ],
    });
    const rng = ambientFork('thin');
    map.faunaPresence.fill(0); // dead zone everywhere
    const before = state.birds[0]!.birds.length;
    stepAmbient(state, map, rng, 50);
    const after = state.birds.length === 0 ? 0 : state.birds[0]!.birds.length;
    expect(after).toBeLessThan(before);
  });
});

describe('pollution: cars emit on the tiles they drive (agent-driven air layer)', () => {
  // The EMISSION contract (pure decision seam): a car emits base pollution on a surface road,
  // more on a freeway (higher throughput/speed), and more where it idles in congestion.
  it('emits a positive base amount on a surface road', () => {
    expect(pollutionEmit(false, 0)).toBeGreaterThan(0);
  });

  it('emits more on a freeway than a surface road', () => {
    expect(pollutionEmit(true, 0)).toBeGreaterThan(pollutionEmit(false, 0));
  });

  it('emits more in heavy congestion than free-flow', () => {
    expect(pollutionEmit(false, 1)).toBeGreaterThan(pollutionEmit(false, 0));
  });

  // The WIRING: a driving owned car actually lays the field along its route.
  it('lays a live pollution field along a driven route', () => {
    const map = new GameMap(20, 6);
    for (let x = 2; x <= 14; x++) map.built[map.idx(x, 3)] = BuiltKind.RoadStreet;
    const path: number[] = [];
    for (let x = 2; x <= 14; x++) path.push(map.idx(x, 3));
    const state = createAmbientState();
    state.cars.push({ x: 2, y: 3, dir: 1, tx: 3, ty: 3, owned: true, id: 1, path, leg: 1 });
    // A driving ped rides hidden; real boarding leaves walkTo set (its substrate-despawn exemption).
    state.peds.push({ x: 2, y: 3, dir: 1, tx: 2, ty: 3, phase: 'driving', carId: 1, walkTo: { x: 2, y: 3 } });
    const rng = ambientFork('pollution-emit');
    for (let i = 0; i < 30; i++) stepAmbient(state, map, rng, 50);
    let total = 0;
    for (const v of state.pollution.values()) total += v;
    expect(state.pollution.size).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
  });

  it('decays the pollution field back toward zero when driving stops', () => {
    const map = new GameMap(8, 8);
    const state = createAmbientState();
    state.pollution.set(map.idx(3, 3), 50);
    const rng = ambientFork('pollution-decay');
    for (let i = 0; i < 5; i++) stepAmbient(state, map, rng, 50);
    expect(state.pollution.get(map.idx(3, 3)) ?? 0).toBeLessThan(50);
  });
});

describe('pollution: pedestrians shun smoggy tiles (pedCost feedback)', () => {
  it('costs more to walk a polluted tile than the same clean tile', () => {
    const map = new GameMap(8, 8); // (3,3) is empty ground — walkable
    const i = map.idx(3, 3);
    const clean = pedCost(map, 3, 3, undefined, undefined, undefined);
    const smoggy = pedCost(map, 3, 3, undefined, undefined, new Map([[i, 255]]));
    expect(smoggy).toBeGreaterThan(clean);
  });
});

describe('land value: derived from amenities minus live nuisances', () => {
  it('is higher next to an amenity than far from one', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.built[map.idx(3, 4)] = BuiltKind.Park; // amenity neighbour
    const withPark = landValueAt(map, 3, 3);
    map.built[map.idx(3, 4)] = BuiltKind.None;
    const without = landValueAt(map, 3, 3);
    expect(withPark).toBeGreaterThan(without);
  });

  it('is lower under heavy pollution', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const i = map.idx(3, 3);
    const clean = landValueAt(map, 3, 3);
    const smoggy = landValueAt(map, 3, 3, new Map([[i, 255]]));
    expect(smoggy).toBeLessThan(clean);
  });

  it('is lower under heavy traffic', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const i = map.idx(3, 3);
    const quiet = landValueAt(map, 3, 3);
    const busy = landValueAt(map, 3, 3, undefined, new Map([[i, 255]]));
    expect(busy).toBeLessThan(quiet);
  });

  it('is lower beside a crumbling road (disinvested infrastructure)', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.built[map.idx(3, 4)] = BuiltKind.RoadStreet; // the road it fronts
    const i = map.idx(3, 4);
    const sound = landValueAt(map, 3, 3, undefined, undefined, undefined, undefined, new Map());
    const crumbling = landValueAt(map, 3, 3, undefined, undefined, undefined, undefined, new Map([[i, 255]]));
    expect(crumbling).toBeLessThan(sound);
  });

  it('is lower beside contaminated water (the dingy creek hurts the banks)', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.water[map.idx(3, 5)] = Water.River; // a creek two tiles south
    const clean = landValueAt(map, 3, 3, undefined, undefined, undefined, new Map());
    const poisoned = landValueAt(map, 3, 3, undefined, undefined, undefined, new Map([[map.idx(3, 5), 255]]));
    expect(poisoned).toBeLessThan(clean);
  });

  it('clamps to [0, 255]', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.floraVitality.fill(255);
    map.faunaPresence.fill(255);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      map.built[map.idx(3 + dx, 3 + dy)] = BuiltKind.Park;
    }
    expect(landValueAt(map, 3, 3)).toBeLessThanOrEqual(255);
    const i = map.idx(3, 3);
    const bad = landValueAt(map, 3, 3, new Map([[i, 255]]), new Map([[i, 255]]), new Map([[i, 255]]));
    expect(bad).toBeGreaterThanOrEqual(0);
  });
});

describe('water contamination: industry is the toxic source, redlined most of all', () => {
  // A water tile with one ground neighbour; vary that neighbour and read the
  // runoff it sheds into the water after one accumulate pass.
  const shedInto = (neighbourKind: number, grade: number): number => {
    const map = new GameMap(6, 6);
    map.water[map.idx(2, 2)] = Water.River;
    map.built[map.idx(2, 3)] = neighbourKind; // the one ground neighbour (south)
    map.redline[map.idx(2, 3)] = grade;
    const state = createAmbientState();
    accumulateWaterRunoff(state, map);
    return state.waterPollution.get(map.idx(2, 2)) ?? 0;
  };

  it('industry sheds more than ordinary urban ground', () => {
    expect(shedInto(BuiltKind.Industrial, 0)).toBeGreaterThan(shedInto(BuiltKind.RoadStreet, 0));
  });

  it('redlined industry sheds the most toxic runoff (grade-scaled)', () => {
    expect(shedInto(BuiltKind.Industrial, 255)).toBeGreaterThan(shedInto(BuiltKind.Industrial, 0));
  });

  it('redlined ground sheds more than greenlined ground (the disinvested district)', () => {
    // Not just industry: any redlined built ground sheds heavier toxic runoff, so
    // the mechanic holds even where the worldgen gutted the industry to nothing.
    expect(shedInto(BuiltKind.RoadStreet, 255)).toBeGreaterThan(shedInto(BuiltKind.RoadStreet, 0));
  });

  it('a wastewater works cleans nearby contaminated water (the player heals it)', () => {
    const map = new GameMap(12, 12);
    for (let y = 0; y < 12; y++) map.water[map.idx(2, y)] = Water.River; // a polluted river
    const state = createAmbientState();
    for (let y = 0; y < 12; y++) state.waterPollution.set(map.idx(2, y), 200);
    map.built[map.idx(3, 6)] = BuiltKind.WastewaterWorks; // a works on the bank, mid-river
    treatWaterPollution(state, map);
    const near = state.waterPollution.get(map.idx(2, 6)) ?? 0;
    const far = state.waterPollution.get(map.idx(2, 0)) ?? 0;
    expect(near).toBeLessThan(200); // cleaned
    expect(near).toBeLessThan(far); // more cleaning closer to the works
  });

  it('flows downstream: a clean tile below the source is contaminated by it', () => {
    // A 1-wide river running down a slope; pollute only the top (upstream) tile.
    const map = new GameMap(3, 6);
    for (let y = 0; y < 6; y++) {
      map.water[map.idx(1, y)] = Water.River;
      map.setElevation(1, y, (5 - y) / 5); // y=0 highest (upstream) → y=5 lowest (the mouth)
    }
    const state = createAmbientState();
    const top = map.idx(1, 0);
    const downstream = map.idx(1, 4);
    state.waterPollution.set(top, 255);
    for (let n = 0; n < 8; n++) flowWaterPollution(state, map);
    // The downstream community, with no polluting neighbour of its own, is poisoned.
    expect(state.waterPollution.get(downstream) ?? 0).toBeGreaterThan(0);
    // Flow conserves direction: pollution never climbs back to a higher tile that started clean.
    // (top was the only source; everything below it carries the contamination.)
    expect(state.waterPollution.get(downstream) ?? 0).toBeLessThanOrEqual(255);
  });
});

describe('police cruisers (over-policing made visible)', () => {
  it('spawns a cruiser out of a precinct onto an adjacent road', () => {
    const map = new GameMap(8, 8);
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as const) map.built[map.idx(x, y)] = BuiltKind.Precinct;
    map.built[map.idx(5, 3)] = BuiltKind.RoadStreet; // a road beside the precinct
    map.built[map.idx(5, 4)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    spawnCruisers(state, map, ambientFork('cr'));
    expect(state.cruisers.length).toBeGreaterThan(0);
  });

  it('spawns no cruisers where there is no precinct', () => {
    const state = createAmbientState();
    spawnCruisers(state, gridMap(), ambientFork('cr')); // roads, no precinct
    expect(state.cruisers.length).toBe(0);
  });

  // A + junction at (5,5) on an 11x11 grid (horizontal y=5, vertical x=5).
  const crossMap = (): GameMap => {
    const map = new GameMap(11, 11);
    for (let x = 0; x < 11; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    for (let y = 0; y < 11; y++) map.built[map.idx(5, y)] = BuiltKind.RoadStreet;
    return map;
  };

  it('patrol seeks redlined ground at a junction (no target)', () => {
    const map = crossMap();
    map.redline.fill(20);
    map.redline[map.idx(5, 4)] = 240; // the NORTH branch is the redlined one
    // Coming from the west (fromDir=West=3); options N/E/S — picks the redlined branch.
    expect(nextPatrolStep(map, 5, 5, 3, ambientFork('seek'), [], null)).toBe(0); // 0 = North
  });

  it('patrol heads for the target, overriding the grade preference', () => {
    const map = crossMap();
    map.redline.fill(20);
    map.redline[map.idx(5, 4)] = 240; // north is the most redlined...
    // ...but the target sits to the EAST — the cruiser closes on it, not the grade.
    expect(nextPatrolStep(map, 5, 5, 3, ambientFork('hunt'), [], { x: 9, y: 5 })).toBe(1); // 1 = East
  });

  it('scatter/chase phase cycles (the ghost cadence)', () => {
    expect(policePhase(0)).toBe('scatter'); // opens calm
    expect(policePhase(300)).toBe('chase'); // then sweeps
    expect(policePhase(0)).toBe(policePhase(540)); // periodic (SCATTER_LEN + CHASE_LEN = 540)
  });

  it('chase personalities aim differently (direct / ambush / shy)', () => {
    const peds = [{ x: 10, y: 5, dir: 1, tx: 10, ty: 5, phase: 'to-building' as const }]; // citizen heading East (1)
    const aim = (personality: number, cx: number) =>
      huntTarget({ x: cx, y: 5, dir: 1, tx: cx, ty: 5, personality }, peds);
    expect(aim(0, 4)).toEqual({ x: 10, y: 5 }); // direct (Blinky): the citizen's tile
    expect(aim(1, 4)).toEqual({ x: 14, y: 5 }); // ambush (Pinky): 4 tiles AHEAD of its heading
    expect(aim(2, 4)).toBeNull(); // shy (Clyde): too far → patrols
    expect(aim(2, 8)).toEqual({ x: 10, y: 5 }); // shy: close enough → pounces
  });

  it('community safe-zones repel cruisers: refuge tiles are avoided and never swept', () => {
    const map = crossMap();
    map.redline.fill(255); // redlined everywhere
    map.built[map.idx(5, 4)] = BuiltKind.HealingCommons; // community power on the NORTH branch
    const safe = buildSafeZones(map);
    expect(safe.has(map.idx(5, 4))).toBe(true); // the commons + its bubble is refuge
    // At the junction with a target NORTH (into the refuge), the cruiser refuses north and takes a
    // non-refuge branch instead (or reverses) — it will not enter the community's bubble.
    const dir = nextPatrolStep(map, 5, 5, 3, ambientFork('safe'), [], { x: 5, y: 1 }, safe);
    expect(dir).not.toBe(0); // 0 = North, into the refuge — refused
    // And a cruiser standing inside a refuge makes no arrest, even redlined + with a citizen present.
    const state = createAmbientState();
    state.cruisers.push({ x: 5, y: 4, dir: 0, tx: 5, ty: 4, recent: [] }); // on the commons (refuge)
    state.peds.push({ x: 5, y: 4, dir: 0, tx: 5, ty: 4, homeTile: map.idx(5, 4), phase: 'to-building' });
    const rng = ambientFork('safe2');
    for (let n = 0; n < 40; n++) stepArrests(state, map, rng, safe);
    expect(state.peds.length).toBe(1); // never arrested inside the community refuge
  });

  it('patrols the road grid and recycles when its shift ends', () => {
    const map = new GameMap(12, 12);
    for (let x = 1; x < 11; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    state.cruisers.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, dwell: 2, recent: [] });
    const rng = ambientFork('cr');
    stepCruisers(state, map, rng); // dwell 2 -> 1
    expect(state.cruisers.length).toBe(1);
    stepCruisers(state, map, rng); // dwell 1 -> 0
    stepCruisers(state, map, rng); // dwell 0 -> recycle (despawn)
    expect(state.cruisers.length).toBe(0);
  });
});

describe('arrests: cruisers drain the redlined community for nothing', () => {
  function policedStreet(grade: number) {
    const map = new GameMap(10, 10);
    map.redline.fill(grade);
    for (let x = 0; x < 10; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    const home = map.idx(5, 6);
    map.built[home] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    state.occupancy.set(home, 5);
    state.cruisers.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, recent: [] });
    state.peds.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, homeTile: home, phase: 'to-building' });
    return { map, state, home };
  }

  it('a cruiser in a redlined zone seizes a citizen and drains the household', () => {
    const { map, state, home } = policedStreet(255);
    const rng = ambientFork('arrest');
    for (let n = 0; n < 40 && state.peds.length > 0; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(0); // taken off the street
    expect(state.occupancy.get(home)).toBe(4); // a person removed from the household
  });

  it('arrest probability scales with the redline grade (0 at greenlined, max at redlined)', () => {
    expect(arrestChance(0)).toBe(0); // greenlined ground: no over-policing
    expect(arrestChance(255)).toBeGreaterThan(arrestChance(128)); // monotonic in grade
    expect(arrestChance(128)).toBeGreaterThan(arrestChance(0));
    expect(arrestChance(255)).toBeGreaterThan(0);
  });

  it('never sweeps grade-0 ground (the disparity floor)', () => {
    const { map, state } = policedStreet(0); // not redlined → arrestChance 0
    const rng = ambientFork('arrest');
    for (let n = 0; n < 40; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(1); // never arrested where there's no redlining
  });

  it('craters the household wellbeing (the trauma of an arrest)', () => {
    const { map, state, home } = policedStreet(255);
    const rng = ambientFork('arrest');
    for (let n = 0; n < 40 && state.peds.length > 0; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(0); // someone was taken
    expect(state.buildingHealth.get(home) ?? 0).toBeLessThan(-40); // wellbeing devastated, not nudged
  });

  it('makes no arrests once the precinct is defunded (no cruisers)', () => {
    const { map, state } = policedStreet(255);
    state.cruisers = []; // defunded — the cruisers are gone
    const rng = ambientFork('arrest');
    for (let n = 0; n < 40; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(1); // no cruiser, no arrest
  });

  it('stains the spot with police violence (the data behind the anti-crime-map)', () => {
    const { map, state } = policedStreet(255);
    const rng = ambientFork('arrest');
    for (let n = 0; n < 40 && state.peds.length > 0; n++) stepArrests(state, map, rng);
    let total = 0;
    for (const v of state.policeViolence.values()) total += v;
    expect(total).toBeGreaterThan(0); // the arrest left a record
  });
});

describe('service coverage (fire/health): under-served redlined zones, player repairs', () => {
  it('a station covers nearby tiles, not far ones', () => {
    const map = new GameMap(20, 20);
    map.built[map.idx(10, 10)] = BuiltKind.FireStation;
    const cov = computeCoverage(map);
    expect(cov.has(map.idx(10, 10))).toBe(true);
    expect(cov.has(map.idx(14, 10))).toBe(true); // within radius 6
    expect(cov.has(map.idx(19, 19))).toBe(false); // out of reach
  });

  it('a Healing Commons also provides coverage', () => {
    const map = new GameMap(20, 20);
    map.built[map.idx(5, 5)] = BuiltKind.HealingCommons;
    expect(computeCoverage(map).has(map.idx(5, 8))).toBe(true);
  });

  it('an under-served plot loses land value vs a covered one', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const i = map.idx(3, 3);
    const covered = landValueAt(map, 3, 3, undefined, undefined, undefined, undefined, undefined, new Set([i]));
    const under = landValueAt(map, 3, 3, undefined, undefined, undefined, undefined, undefined, new Set());
    expect(under).toBeLessThan(covered);
  });
});

describe('road decay: redlined roads crumble, cared-for roads recover', () => {
  it('a redlined road in a disinvested block crumbles over time', () => {
    const map = new GameMap(8, 8);
    const i = map.idx(4, 4);
    map.built[i] = BuiltKind.RoadStreet;
    map.redline[i] = 255; // redlined
    const state = createAmbientState();
    for (let n = 0; n < 5; n++) stepRoadDecay(state, map);
    expect(state.roadDecay.get(i) ?? 0).toBeGreaterThan(0);
  });

  it('a greenlined road stays sound (grade scales crumbling to ~0)', () => {
    const map = new GameMap(8, 8);
    const i = map.idx(4, 4);
    map.built[i] = BuiltKind.RoadStreet;
    map.redline[i] = 0; // greenlined
    const state = createAmbientState();
    for (let n = 0; n < 5; n++) stepRoadDecay(state, map);
    expect(state.roadDecay.get(i) ?? 0).toBe(0);
  });

  it('a cared-for road (prized plot next door) recovers — the heal fixes the roads', () => {
    const map = new GameMap(8, 8);
    const i = map.idx(4, 4);
    map.built[i] = BuiltKind.RoadStreet;
    map.redline[i] = 255;
    map.built[map.idx(4, 5)] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    state.roadDecay.set(i, 200); // already crumbled
    state.landValue.set(map.idx(4, 5), 200); // the neighborhood is now cared-for
    stepRoadDecay(state, map);
    expect(state.roadDecay.get(i) ?? 0).toBeLessThan(200);
  });
});

describe('land value: recomputed over inhabited plots on a cadence', () => {
  it('values each zone plot, reflects amenities, and skips non-zone tiles', () => {
    const map = new GameMap(12, 12);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.built[map.idx(3, 4)] = BuiltKind.Park; // good neighbour for (3,3)
    map.built[map.idx(8, 8)] = BuiltKind.HouseSingle; // plain
    const state = createAmbientState();
    const rng = ambientFork('lv');
    for (let i = 0; i < 40; i++) stepAmbient(state, map, rng, 50); // > LV_CADENCE
    const good = state.landValue.get(map.idx(3, 3)) ?? -1;
    const plain = state.landValue.get(map.idx(8, 8)) ?? -1;
    expect(good).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(0);
    expect(good).toBeGreaterThan(plain);
    expect(state.landValue.has(map.idx(3, 4))).toBe(false); // the park is not a zone plot
  });

  it('drops a demolished plot on the next recompute (rebuilt fresh)', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    recomputeLandValue(state, map);
    expect(state.landValue.has(map.idx(3, 3))).toBe(true);
    map.built[map.idx(3, 3)] = BuiltKind.None;
    recomputeLandValue(state, map);
    expect(state.landValue.has(map.idx(3, 3))).toBe(false);
  });
});

describe('land value steers citizen destination choice', () => {
  it('prefers a higher-value plot over a nearer drab one within the pull margin', () => {
    const map = new GameMap(40, 12);
    map.built[map.idx(10, 5)] = BuiltKind.CommercialStrip; // near, drab
    map.built[map.idx(16, 5)] = BuiltKind.CommercialStrip; // far, prized
    const lv = new Map([[map.idx(10, 5), 10], [map.idx(16, 5), 255]]);
    expect(nearestOfCategory(map, 8, 5, StopCategory.Shop, lv)).toEqual({ x: 16, y: 5 });
    expect(nearestOfCategory(map, 8, 5, StopCategory.Shop)).toEqual({ x: 10, y: 5 }); // no LV → nearest
  });


  it('does NOT bias destinations upper-left on ties (Maddy: row-major trip-generation bias)', () => {
    // For each searcher centre, two EQUIDISTANT same-category plots — one NW, one SE (Manhattan d=2
    // each, uniform land value → a true score tie). The old row-major strict-`<` picker ALWAYS chose
    // the NW (first-scanned) tile; the direction-neutral hash tie-break must scatter — picking SE on
    // some centres and NW on others.
    let seChosen = 0;
    let nwChosen = 0;
    for (let c = 6; c <= 33; c++) {
      const m = new GameMap(40, 40);
      m.built[m.idx(c - 1, c - 1)] = BuiltKind.CommercialStrip; // NW of the searcher
      m.built[m.idx(c + 1, c + 1)] = BuiltKind.CommercialStrip; // SE of the searcher (equidistant)
      const pick = nearestOfCategory(m, c, c, StopCategory.Shop);
      if (pick && pick.x === c + 1) seChosen++;
      else if (pick && pick.x === c - 1) nwChosen++;
    }
    expect(seChosen).toBeGreaterThan(0); // SE is sometimes chosen — NOT always the upper-left one
    expect(nwChosen).toBeGreaterThan(0); // and NW sometimes too — scattered, not a new fixed bias
  });
});

describe('population: building capacity (the seeded ceiling)', () => {
  it('lets a denser building hold more than a single house at the same baseline', () => {
    expect(capacityOf(BuiltKind.Apartments, 9)).toBeGreaterThan(capacityOf(BuiltKind.HouseSingle, 9));
  });
  it('is at least the seeded baseline (room for the residents already there)', () => {
    expect(capacityOf(BuiltKind.HouseSingle, 9)).toBeGreaterThanOrEqual(9);
  });
  it('scales with the baseline (denser seed → bigger ceiling)', () => {
    expect(capacityOf(BuiltKind.Apartments, 18)).toBeGreaterThan(capacityOf(BuiltKind.Apartments, 9));
  });
  it('a derelict (zero) home holds nobody', () => {
    expect(capacityOf(BuiltKind.HouseSingle, 0)).toBe(0);
  });
});

describe('population: occupancy signal (attract vs decline)', () => {
  it('is positive in a prized, clean, healthy spot', () => {
    expect(occupancySignal(220, 0, 40)).toBeGreaterThan(0);
  });
  it('is negative in a decayed, smoggy, unhealthy spot', () => {
    expect(occupancySignal(10, 255, -40)).toBeLessThan(0);
  });
  it('falls as pollution rises (smog repels residents)', () => {
    expect(occupancySignal(150, 255, 0)).toBeLessThan(occupancySignal(150, 0, 0));
  });
});

describe('population: occupancy step (bounded drift, never empties)', () => {
  it('grows toward capacity on a positive signal, clamped at the ceiling', () => {
    expect(occupancyStep(9, 0, 27, 1)).toBeGreaterThan(9);
    expect(occupancyStep(27, 0, 27, 1)).toBe(27);
  });
  it('shrinks on a negative signal but never below the floor (no ghost town)', () => {
    expect(occupancyStep(9, 4, 27, -1)).toBeLessThan(9);
    expect(occupancyStep(4, 4, 27, -1)).toBe(4); // at the floor it holds
    expect(occupancyStep(5, 4, 27, -100)).toBe(4); // a big negative signal clamps up to the floor
  });
});

describe('population: spawn target tracks live occupancy', () => {
  it('is a THIRD of the residents — scales with the city, no flat ceiling (Maddy: sum/3)', () => {
    expect(spawnTargetFor(3000)).toBe(1000); // a third are out
    expect(spawnTargetFor(900)).toBe(300);
    expect(spawnTargetFor(200000)).toBeGreaterThan(spawnTargetFor(100000)); // keeps scaling, NOT flat-capped
  });
  it('scales down as the population falls, and zero when nobody lives here', () => {
    expect(spawnTargetFor(60)).toBeLessThan(spawnTargetFor(100000));
    expect(spawnTargetFor(0)).toBe(0);
  });
  it('is monotonic non-decreasing', () => {
    expect(spawnTargetFor(300)).toBeGreaterThanOrEqual(spawnTargetFor(120));
  });
});

describe('liveCaps (settings move the live perf ceilings at runtime)', () => {
  it('default caps match the medium preset (today’s shipped values)', () => {
    expect(liveCaps).toEqual(CAP_PRESETS.medium);
  });
  it('applyLiveCaps shifts the spawn target via the citizen-out divisor', () => {
    const before = { ...liveCaps };
    try {
      expect(spawnTargetFor(30)).toBe(10); // /3 at default
      applyLiveCaps({ citizenOutDivisor: 6 });
      expect(spawnTargetFor(30)).toBe(5); // /6 after applying
      applyLiveCaps({ pedCap: 5000 });
      expect(liveCaps.pedCap).toBe(5000);
      expect(liveCaps.citizenOutDivisor).toBe(6); // partial apply leaves others
    } finally {
      applyLiveCaps(before); // never leak mutated caps into sibling tests
    }
  });
});

describe('traveler fuel budget (Maddy: extend it 250% so travelers reach farther)', () => {
  it('the full tank is extended ~3.5x (a traveler covers a much longer round before burning out)', () => {
    expect(FUEL_TANK).toBeGreaterThanOrEqual(2100); // was 600 → +250% = 3.5x
  });
});

describe('population: occupancy evolves with conditions (agent-emergent)', () => {
  it('grows above baseline for a home in a prized, healthy spot', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.Apartments;
    const t = map.idx(3, 3);
    const state = createAmbientState();
    setHouseholds(state, [{ x: 3, y: 3, count: 9 }]);
    state.landValue.set(t, 255);
    state.buildingHealth.set(t, 60);
    for (let i = 0; i < 80; i++) stepOccupancy(state, map);
    expect(state.occupancy.get(t)!).toBeGreaterThan(9);
    expect(state.occupancy.get(t)!).toBeLessThanOrEqual(capacityOf(BuiltKind.Apartments, 9));
  });

  it('shrinks below baseline for a home in a decayed, smoggy spot', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const t = map.idx(3, 3);
    const state = createAmbientState();
    setHouseholds(state, [{ x: 3, y: 3, count: 9 }]);
    state.landValue.set(t, 10);
    state.pollution.set(t, 255);
    for (let i = 0; i < 80; i++) stepOccupancy(state, map);
    expect(state.occupancy.get(t)!).toBeLessThan(9);
    expect(state.occupancy.get(t)!).toBeGreaterThan(0); // floored — a decayed home thins but never empties
  });
});

describe('ambient is read-only over the world (AC#7 pin a)', () => {
  it('leaves hashWorld byte-identical after many steps', () => {
    const map = new GameMap(24, 24);
    const parcels = new ParcelStore();
    for (let x = 1; x < 23; x++) {
      map.built[map.idx(x, 6)] = BuiltKind.RoadHighway;
      map.built[map.idx(x, 12)] = BuiltKind.QuietStreet;
    }
    map.faunaPresence.fill(180);
    const world = { map, parcels };
    const before = hashWorld(world);
    const state = createAmbientState();
    const rng = ambientFork('readonly');
    for (let i = 0; i < 100; i++) stepAmbient(state, map, rng, 50);
    expect(hashWorld(world)).toBe(before);
  });
});

describe('ambient stream isolation (AC#7 pin b)', () => {
  it('does not advance the worldgen/sim rng stream', () => {
    const buildWorld = () =>
      runPipeline({ seed: 'iso' }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
    const runSim = (withAmbient: boolean): string => {
      const world = buildWorld();
      const partition = computeNeighborhoods(world.map);
      const deps: SimDeps = {
        world,
        tech: createTechState(TECH_TREE),
        civic: createCivicState(partition),
        partition,
        seed: 'iso',
      };
      const state = createAmbientState();
      const arng = ambientFork('iso');
      for (let tick = 1; tick <= 120; tick++) {
        simTick(deps, tick);
        if (withAmbient) stepAmbient(state, world.map, arng, 50);
      }
      return hashWorld(world);
    };
    expect(runSim(true)).toBe(runSim(false));
  });
});

describe('cars park in lots (the lot is storage for the moving cars)', () => {
  // A short road ending next to a 2x2 parking lot, with a house by the lot so a parked
  // car's occupant has somewhere to walk. The trip path runs the road to its end (8,5),
  // one tile from the lot at (9..10, 5..6).
  function roadWithLot(): { map: GameMap; path: number[] } {
    const map = new GameMap(20, 12);
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    for (let y = 5; y <= 6; y++) for (let x = 9; x <= 10; x++) map.built[map.idx(x, y)] = BuiltKind.ParkingLot;
    map.built[map.idx(9, 7)] = BuiltKind.HouseSingle; // demand → a last-mile ped on park
    const path: number[] = [];
    for (let x = 2; x <= 8; x++) path.push(map.idx(x, 5));
    return { map, path };
  }

  const lotInfo = (map: GameMap) =>
    parkingLots(map).map((l) => ({
      cx: (l.x0 + l.x1) / 2,
      cy: (l.y0 + l.y1) / 2,
      x0: l.x0,
      y0: l.y0,
      x1: l.x1,
      y1: l.y1,
      stalls: parkingStalls(l),
    }));

  it('a trip-car parks in the nearby lot at the end of its trip, then leaves after dwelling', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, [{ path }], map);
    const rng = ambientFork('park');
    let parked = false;
    for (let i = 0; i < 120 && !parked; i++) {
      stepAmbient(state, map, rng, 50);
      parked = state.cars.some((c) => c.parked);
    }
    expect(parked).toBe(true); // drove to the end and pulled into the lot
    expect(state.cars.find((c) => c.parked)!.dwell).toBeGreaterThan(0);
    // dwell out — the car leaves the lot (storage frees up)
    for (let i = 0; i < 500 && state.cars.length > 0; i++) stepAmbient(state, map, rng, 50);
    expect(state.cars.length).toBe(0);
  });

  it('with no lots, a trip-car street-parks at its destination (does not despawn)', () => {
    const { map, path } = roadWithLot(); // lots NOT published to the ambient state
    const state = createAmbientState();
    ingestTrips(state, [{ path }], map);
    const rng = ambientFork('nolot');
    const car = state.cars[0]!;
    for (let i = 0; i < 120 && !car.parked; i++) stepAmbient(state, map, rng, 50);
    expect(car.parked).toBe(true); // parked at a street curb, did NOT vanish at the building
    expect(car.lotIdx).toBeUndefined(); // on the street (no lot was available)
  });

  it('a parked car puts a last-mile pedestrian on the street (to/from the car)', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, [{ path }], map);
    const rng = ambientFork('parkped');
    for (let i = 0; i < 120 && !state.cars.some((c) => c.parked); i++) stepAmbient(state, map, rng, 50);
    expect(state.cars.some((c) => c.parked)).toBe(true);
    expect(state.peds.length).toBeGreaterThanOrEqual(1);
    expect(state.peds.every((p) => p.walkTo !== undefined)).toBe(true); // last-mile walkers
  });

  it('respects lot capacity: never stores more cars in a lot TILE than it has stalls', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, Array.from({ length: 17 }, () => ({ path })), map); // more cars than one tile holds
    const rng = ambientFork('cap');
    // Budget is generous: 17 cars ingested onto ONE tile at once lockstep under the strong traffic
    // pileup and take a while to filter to the lots. Each per-tile lot must hold at most its 3x3 stalls.
    let maxPerLot = 0;
    let anyLot = false;
    for (let i = 0; i < 600; i++) {
      stepAmbient(state, map, rng, 50);
      const perLot = new Map<number, number>();
      for (const c of state.cars) {
        if (c.parked && c.lotIdx !== undefined) {
          perLot.set(c.lotIdx, (perLot.get(c.lotIdx) ?? 0) + 1);
          anyLot = true;
        }
      }
      for (const n of perLot.values()) maxPerLot = Math.max(maxPerLot, n);
    }
    expect(anyLot).toBe(true);
    expect(maxPerLot).toBeLessThanOrEqual(STALLS_PER_AXIS * STALLS_PER_AXIS); // <= 9 per 1x1 lot tile
  });

  it('binds a pedestrian to the parked car that walks to the destination building', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, [{ path }], map);
    const rng = ambientFork('bound');
    const car = state.cars[0]!;
    for (let i = 0; i < 120 && !car.parked; i++) stepAmbient(state, map, rng, 50);
    expect(car.parked).toBe(true);
    expect(car.id).toBeDefined();
    const ped = state.peds.find((p) => p.carId === car.id);
    expect(ped).toBeDefined(); // a ped is bound to THIS car
    expect(ped!.building).toEqual({ x: 9, y: 7 }); // and walks to the destination building
  });

  it('the car waits for its pedestrian, then leaves only after the ped returns', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, [{ path }], map);
    const rng = ambientFork('wait');
    const car = state.cars[0]!;
    for (let i = 0; i < 120 && !car.parked; i++) stepAmbient(state, map, rng, 50);
    const id = car.id!;
    // while the ped is inside the building the car is still parked (waiting for it)
    let sawInside = false;
    for (let i = 0; i < 250 && !sawInside; i++) {
      stepAmbient(state, map, rng, 50);
      sawInside = state.peds.some((p) => p.carId === id && p.phase === 'inside');
    }
    expect(sawInside).toBe(true);
    expect(state.cars.some((c) => c.id === id)).toBe(true); // still there, waiting for its ped
    // the ped returns and releases the car, which then leaves
    for (let i = 0; i < 500 && state.cars.some((c) => c.id === id); i++) stepAmbient(state, map, rng, 50);
    expect(state.cars.some((c) => c.id === id)).toBe(false);
  });

  it('curbParkOffset pushes a street-parked car off the lane centre, toward the curb', () => {
    const north = curbParkOffset(0); // 0=N
    expect(north.dx).toBe(0);
    expect(north.dy).toBeLessThan(0); // north is -y
    const east = curbParkOffset(1); // 1=E
    expect(east.dy).toBe(0);
    expect(east.dx).toBeGreaterThan(0);
    // bigger than the in-lane laneOffset, so a parked car clears the lane and hugs the edge
    expect(Math.abs(north.dy)).toBeGreaterThan(Math.abs(laneOffset(1).dy));
    expect(Math.abs(north.dy)).toBeLessThan(0.5); // but stays within its tile
  });

  it('a street-parked car records the curb side (toward a non-road neighbour, not the lane)', () => {
    const map = new GameMap(16, 10); // a 1-wide street with grass on both sides
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    const path: number[] = [];
    for (let x = 2; x <= 6; x++) path.push(map.idx(x, 5));
    ingestTrips(state, [{ path }], map); // no lots → street-park
    const rng = ambientFork('curbdir');
    const car = state.cars[0]!;
    for (let i = 0; i < 120 && !car.parked; i++) stepAmbient(state, map, rng, 50);
    expect(car.parked).toBe(true);
    expect(car.lotIdx).toBeUndefined();
    expect(car.curbDir).toBeDefined(); // it recorded which way the curb is
    const dx = [0, 1, 0, -1][car.curbDir!]!;
    const dy = [-1, 0, 1, 0][car.curbDir!]!;
    const k = map.built[map.idx(Math.round(car.x) + dx, Math.round(car.y) + dy)];
    expect(k).not.toBe(BuiltKind.RoadStreet); // curb points off the road, not down the lane
  });

  it('crowding: a second car to the same destination takes a DIFFERENT kerb stall', () => {
    const map = new GameMap(20, 12); // a road + a building, NO lot → both cars street-park
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(8, 6)] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    const path: number[] = [];
    for (let x = 2; x <= 8; x++) path.push(map.idx(x, 5));
    ingestTrips(state, [{ path }, { path }], map); // two cars, same destination
    const rng = ambientFork('crowd');
    for (let i = 0; i < 150 && state.cars.filter((c) => c.parked).length < 2; i++) {
      stepAmbient(state, map, rng, 50);
    }
    const parked = state.cars.filter((c) => c.parked);
    expect(parked.length).toBe(2);
    // They take DISTINCT (tile, slot) kerb stalls — never the same spot — whether on the same road
    // tile (different slots) or a neighbouring one once a tile's 4 slots fill.
    const stalls = new Set(parked.map((c) => `${Math.round(c.x)},${Math.round(c.y)},${c.curbSlot}`));
    expect(stalls.size).toBe(2);
    for (const c of parked) expect(c.curbSlot).not.toBeUndefined();
  });

  it('parking is deterministic for the same seed', () => {
    const { map, path } = roadWithLot();
    const a = createAmbientState();
    const b = createAmbientState();
    setParkingLots(a, lotInfo(map));
    setParkingLots(b, lotInfo(map));
    ingestTrips(a, [{ path }], map);
    ingestTrips(b, [{ path }], map);
    const ra = ambientFork('det');
    const rb = ambientFork('det');
    for (let i = 0; i < 150; i++) {
      stepAmbient(a, map, ra, 50);
      stepAmbient(b, map, rb, 50);
    }
    expect(a.cars).toEqual(b.cars);
    expect(a.peds).toEqual(b.peds);
  });

  it('a routed ped is exempt from the ped-substrate despawn and walks the grid toward its target', () => {
    const map = new GameMap(16, 16); // all empty: walkable everywhere, no ped substrate
    const state = createAmbientState();
    state.peds.push({ x: 3, y: 3, dir: 0, tx: 3, ty: 3, walkTo: { x: 8, y: 3 } });
    const rng = ambientFork('walk');
    for (let i = 0; i < 10; i++) stepAmbient(state, map, rng, 50); // grid movers recommit then move
    expect(state.peds.length).toBe(1); // survived despite (3,3) not being ped substrate
    expect(state.peds[0]!.x).toBeGreaterThan(3); // walked east toward (8,3)
    expect(state.peds[0]!.y).toBe(3); // axis-aligned — no diagonal drift off the row
  });

  it('routes AROUND a building plot instead of cutting through it', () => {
    const map = new GameMap(16, 16); // empty = walkable everywhere
    map.built[map.idx(5, 3)] = BuiltKind.CommercialStrip; // a plot blocking the straight line
    const state = createAmbientState();
    state.peds.push({ x: 3, y: 3, dir: 0, tx: 3, ty: 3, walkTo: { x: 7, y: 3 } });
    const rng = ambientFork('around');
    const visited = new Set<string>();
    for (let i = 0; i < 200 && state.peds.length > 0; i++) {
      stepAmbient(state, map, rng, 50);
      const p = state.peds[0];
      if (p) visited.add(`${Math.round(p.x)},${Math.round(p.y)}`);
    }
    expect(visited.has('5,3')).toBe(false); // never trespassed the building plot
    expect([...visited].some((k) => Number(k.split(',')[0]!) >= 5)).toBe(true); // got past it (around)
  });

  it('a walk-ped despawns once it reaches its target', () => {
    const map = new GameMap(16, 16);
    const state = createAmbientState();
    state.peds.push({ x: 3, y: 3, dir: 0, tx: 3, ty: 3, walkTo: { x: 4, y: 3 } });
    const rng = ambientFork('arrive');
    for (let i = 0; i < 60 && state.peds.length > 0; i++) stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(0); // walked the one tile and despawned on arrival
  });

  it('each car carries a stable colour tint, kept while moving and after parking', () => {
    const { map, path } = roadWithLot();
    const state = createAmbientState();
    setParkingLots(state, lotInfo(map));
    ingestTrips(state, [{ path }], map);
    const car = state.cars[0]!;
    expect(typeof car.tint).toBe('number'); // a colour is bound to the car at spawn
    const spawnTint = car.tint;
    const rng = ambientFork('tint');
    for (let i = 0; i < 120 && !car.parked; i++) stepAmbient(state, map, rng, 50);
    expect(car.parked).toBe(true);
    expect(car.tint).toBe(spawnTint); // same car, same colour — moving → parked
  });

  it('gives cars from different trips different tints (spread, not all one colour)', () => {
    const map = new GameMap(20, 12);
    for (let x = 1; x <= 18; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    const trips = [
      { path: [map.idx(1, 5), map.idx(2, 5), map.idx(3, 5)] },
      { path: [map.idx(10, 5), map.idx(11, 5), map.idx(12, 5)] },
      { path: [map.idx(15, 5), map.idx(16, 5), map.idx(17, 5)] },
    ];
    ingestTrips(state, trips, map);
    const tints = new Set(state.cars.map((c) => c.tint));
    expect(tints.size).toBeGreaterThan(1); // not all the same colour
  });
});

describe('building health from citizen trips (plot-use wellbeing carried home)', () => {
  // A home fronting the origin road, a road to a destination plot by the path end; the
  // citizen drives there, visits, returns, and deposits the plot's wellbeing at home.
  function citizenTrip(destKind: number): { map: GameMap; path: number[]; home: number } {
    const map = new GameMap(20, 10);
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(2, 3)] = BuiltKind.HouseSingle; // home, fronts the origin road (2,4)
    map.built[map.idx(8, 3)] = destKind; // destination plot, by the path end (8,4)
    const path: number[] = [];
    for (let x = 2; x <= 8; x++) path.push(map.idx(x, 4));
    return { map, path, home: map.idx(2, 3) };
  }

  function runUntilDeposit(map: GameMap, path: number[], home: number, state: ReturnType<typeof createAmbientState>): boolean {
    const rng = ambientFork('health');
    ingestTrips(state, [{ path }], map);
    for (let i = 0; i < 800; i++) {
      stepAmbient(state, map, rng, 50);
      if ((state.buildingHealth.get(home) ?? 0) !== 0) return true;
    }
    return false;
  }

  it('a short residential trip WALKS and carries POSITIVE health home via a pleasant route', () => {
    const map = new GameMap(16, 12);
    map.built[map.idx(2, 3)] = BuiltKind.HouseSingle; // home
    map.built[map.idx(8, 3)] = BuiltKind.CommercialStrip; // a shop to visit
    for (let x = 2; x <= 8; x++) map.built[map.idx(x, 4)] = BuiltKind.Promenade; // promenade (no road-walk toll)
    const home = map.idx(2, 3);
    const path: number[] = [];
    for (let x = 2; x <= 8; x++) path.push(map.idx(x, 4));
    const probe = createAmbientState();
    ingestTrips(probe, [{ path }], map);
    expect(probe.cars.length).toBe(0); // short → walks
    const ped = probe.peds.find((p) => p.homeTile === home);
    expect(ped).toBeDefined(); // a walking citizen tagged with its home
    expect(ped!.phase).toBe('to-building');
    const state = createAmbientState();
    expect(runUntilDeposit(map, path, home, state)).toBe(true);
    expect(state.buildingHealth.get(home)!).toBeGreaterThan(0); // commercial visit on a promenade → positive
  });

  it('a road-walk taxes wellbeing: a commercial visit nets ≤ 0 by road but > 0 by promenade', () => {
    const make = (corridor: number) => {
      const map = new GameMap(16, 12);
      map.built[map.idx(2, 3)] = BuiltKind.HouseSingle;
      map.built[map.idx(8, 3)] = BuiltKind.CommercialStrip;
      for (let x = 2; x <= 8; x++) map.built[map.idx(x, 4)] = corridor; // 7-tile walk corridor
      const path: number[] = [];
      for (let x = 2; x <= 8; x++) path.push(map.idx(x, 4));
      return { map, path, home: map.idx(2, 3) };
    };
    const prom = make(BuiltKind.Promenade);
    const ps = createAmbientState();
    runUntilDeposit(prom.map, prom.path, prom.home, ps);
    expect(ps.buildingHealth.get(prom.home)!).toBeGreaterThan(0); // pleasant route → positive

    const road = make(BuiltKind.RoadStreet);
    const rs = createAmbientState();
    const rng = ambientFork('roadwalk');
    ingestTrips(rs, [{ path: road.path }], road.map);
    for (let i = 0; i < 800 && rs.peds.some((p) => p.phase !== undefined); i++) stepAmbient(rs, road.map, rng, 50);
    // the road-walk toll cancels the small commercial value → no positive deposit
    expect(rs.buildingHealth.get(road.home) ?? 0).toBeLessThanOrEqual(0);
  });

  it('mode choice: a long residential trip DRIVES (car), a short one WALKS (ped)', () => {
    const short = citizenTrip(BuiltKind.CommercialStrip); // 7-tile path
    const s = createAmbientState();
    ingestTrips(s, [{ path: short.path }], short.map);
    expect(s.cars.length).toBe(0);
    expect(s.peds.length).toBe(1);

    const map = new GameMap(40, 10); // a long corridor: 19-tile path > WALK_RANGE
    for (let x = 2; x <= 20; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(2, 3)] = BuiltKind.HouseSingle;
    map.built[map.idx(20, 3)] = BuiltKind.CommercialStrip;
    const longPath: number[] = [];
    for (let x = 2; x <= 20; x++) longPath.push(map.idx(x, 4));
    const l = createAmbientState();
    ingestTrips(l, [{ path: longPath }], map);
    expect(l.peds.length).toBe(0);
    expect(l.cars.length).toBe(1);
    expect(l.cars[0]!.homeTile).toBe(map.idx(2, 3)); // long trip drives, still a tagged citizen
  });

  it('deposits NEGATIVE health for an industrial visit', () => {
    const { map, path, home } = citizenTrip(BuiltKind.Industrial);
    const state = createAmbientState();
    expect(runUntilDeposit(map, path, home, state)).toBe(true);
    expect(state.buildingHealth.get(home)!).toBeLessThan(0);
  });

  it('a non-residential (freight) origin deposits no building health', () => {
    const { map, path } = citizenTrip(BuiltKind.CommercialStrip);
    map.built[map.idx(2, 3)] = BuiltKind.Offices; // origin is commercial now, not a home
    const state = createAmbientState();
    const rng = ambientFork('freight');
    ingestTrips(state, [{ path }], map);
    expect(state.cars[0]!.homeTile).toBeUndefined(); // freight — no home
    for (let i = 0; i < 500; i++) stepAmbient(state, map, rng, 50);
    expect(state.buildingHealth.size).toBe(0);
  });

  it('health eases back toward neutral after the visit (decay)', () => {
    const { map, path, home } = citizenTrip(BuiltKind.HealingCommons);
    const state = createAmbientState();
    expect(runUntilDeposit(map, path, home, state)).toBe(true);
    const peak = Math.abs(state.buildingHealth.get(home)!);
    const rng = ambientFork('decay');
    for (let i = 0; i < 400; i++) stepAmbient(state, map, rng, 50);
    expect(Math.abs(state.buildingHealth.get(home) ?? 0)).toBeLessThan(peak);
  });
});

describe('desire-path wear (pedestrians trample wild green into brown + trash)', () => {
  it('isWearable: ANY empty land (even bare) — not roads, buildings, or water', () => {
    const map = new GameMap(8, 8);
    expect(isWearable(map, 3, 3)).toBe(true); // bare empty ground IS wild green now
    map.floraVitality[map.idx(2, 2)] = 200;
    expect(isWearable(map, 2, 2)).toBe(true); // green empty too
    map.built[map.idx(3, 3)] = BuiltKind.RoadStreet;
    expect(isWearable(map, 3, 3)).toBe(false); // a road is paved
    map.built[map.idx(4, 4)] = BuiltKind.HouseSingle;
    expect(isWearable(map, 4, 4)).toBe(false); // a building, not ground
    map.water[map.idx(5, 5)] = 1;
    expect(isWearable(map, 5, 5)).toBe(false); // water is impassable, not walked
  });

  it('pedestrians beat a desire PATH (multiple worn tiles) through wild green', () => {
    const map = new GameMap(20, 12);
    map.floraVitality.fill(200); // open wild field (all empty land)
    const state = createAmbientState();
    state.peds.push({ x: 2, y: 5, dir: 0, tx: 2, ty: 5, walkTo: { x: 14, y: 5 } });
    const rng = ambientFork('wear');
    for (let i = 0; i < 120; i++) stepAmbient(state, map, rng, 50);
    let total = 0;
    for (const [, v] of state.wear) total += v;
    expect(total).toBeGreaterThan(0);
    expect(state.wear.size).toBeGreaterThan(1); // a line of worn tiles, not a single spot
  });

  it('wear decays when the foot traffic stops (the path regrows)', () => {
    const map = new GameMap(8, 8);
    map.floraVitality.fill(200);
    const state = createAmbientState();
    state.wear.set(map.idx(4, 4), 60); // a pre-worn tile, nobody walking it now
    const rng = ambientFork('regrow');
    for (let i = 0; i < 80; i++) stepAmbient(state, map, rng, 50);
    expect(state.wear.get(map.idx(4, 4)) ?? 0).toBeLessThan(60); // eased back toward green
  });

  it('seedDecay starts the city degraded — trampled urban ground + polluted shores', () => {
    const map = new GameMap(16, 16);
    for (let x = 4; x <= 8; x++) map.built[map.idx(x, 6)] = BuiltKind.RoadStreet; // a street pair
    for (let x = 4; x <= 8; x++) map.built[map.idx(x, 8)] = BuiltKind.RoadStreet; // with an empty gap at y=7
    for (let y = 0; y < 16; y++) map.water[map.idx(12, y)] = 1; // a shoreline
    map.built[map.idx(11, 6)] = BuiltKind.RoadStreet; // urban tile on the shore
    const state = createAmbientState();
    seedDecay(state, map);
    expect(state.wear.get(map.idx(6, 7)) ?? 0).toBeGreaterThan(0); // hemmed-in gap is pre-trampled
    expect(state.waterPollution.get(map.idx(12, 6)) ?? 0).toBeGreaterThan(0); // shore pre-polluted
    expect(state.wear.get(map.idx(0, 0)) ?? 0).toBe(0); // open wild ground starts clean/green
  });

  it('seedDecay precomputes home wellbeing from nearby plots (good → positive, industry → negative)', () => {
    const map = new GameMap(24, 16);
    map.built[map.idx(5, 5)] = BuiltKind.HouseSingle; // a home by a healing commons
    map.built[map.idx(5, 7)] = BuiltKind.HealingCommons;
    map.built[map.idx(16, 5)] = BuiltKind.HouseSingle; // a home by heavy industry
    map.built[map.idx(16, 7)] = BuiltKind.Industrial;
    const state = createAmbientState();
    seedDecay(state, map);
    expect(state.buildingHealth.get(map.idx(5, 5))!).toBeGreaterThan(0); // starts healthy
    expect(state.buildingHealth.get(map.idx(16, 5))!).toBeLessThan(0); // starts decayed
  });

  it('a short trip whose route uses a freeway DRIVES (a pedestrian cannot cross a freeway)', () => {
    const map = new GameMap(16, 8);
    map.built[map.idx(2, 3)] = BuiltKind.HouseSingle; // home
    map.built[map.idx(2, 4)] = BuiltKind.RoadStreet; // origin frontage road
    for (let x = 3; x <= 6; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadHighway; // a freeway in the path
    map.built[map.idx(7, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(7, 3)] = BuiltKind.CommercialStrip; // destination
    const state = createAmbientState();
    const path = [2, 3, 4, 5, 6, 7].map((x) => map.idx(x, 4));
    ingestTrips(state, [{ path }], map);
    expect(state.peds.length).toBe(0); // short, but the freeway forces it to drive
    expect(state.cars.length).toBe(1);
  });

  it('coastal water collects runoff pollution from nearby ground; open water stays clean', () => {
    const map = new GameMap(12, 12);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) map.water[map.idx(x, y)] = 1; // water block
    for (let y = 4; y <= 7; y++) map.built[map.idx(3, y)] = BuiltKind.RoadStreet; // urban shore to the west
    const state = createAmbientState();
    const rng = ambientFork('runoff');
    for (let i = 0; i < 60; i++) stepAmbient(state, map, rng, 50); // several runoff cadences
    expect(state.waterPollution.get(map.idx(4, 5)) ?? 0).toBeGreaterThan(0); // shore water, runoff from the road
    expect(state.waterPollution.get(map.idx(5, 5)) ?? 0).toBe(0); // interior water, all-water neighbours → clean
  });
});

describe('failed trips + freeway speed', () => {
  it('a citizen whose pathing dead-ends respawns at home and docks its wellbeing', () => {
    const map = new GameMap(12, 12);
    map.built[map.idx(2, 2)] = BuiltKind.HouseSingle; // home
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      map.built[map.idx(5 + dx, 5 + dy)] = BuiltKind.HouseSingle; // box the ped in at (5,5)
    }
    const state = createAmbientState();
    state.peds.push({
      x: 5, y: 5, dir: 0, tx: 5, ty: 5,
      walkTo: { x: 10, y: 10 }, phase: 'to-building',
      homeTile: map.idx(2, 2), building: { x: 10, y: 10 },
    });
    const rng = ambientFork('giveup');
    stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(1); // boxed in → respawned at home (household persists)
    const p = state.peds[0]!;
    expect(Math.abs(Math.round(p.x) - 2) + Math.abs(Math.round(p.y) - 2)).toBeLessThanOrEqual(1); // back beside home
    expect(state.buildingHealth.get(map.idx(2, 2))!).toBeLessThan(0); // home docked for the lost trip
  });

  it('congestionCount: same-dir + orthogonal cars pile up; OPPOSITE-direction cars pass freely (Maddy)', () => {
    // dir order [N,E,S,W] = 0,1,2,3. Cars heading the OPPOSITE way are just passing — they must not
    // count toward a car's congestion (oncoming traffic on a two-way road doesn't make a jam).
    expect(congestionCount([0, 3, 0, 2], 1)).toBe(3); // an EAST car ignores the 2 WEST → its queue of 3
    expect(congestionCount([0, 3, 0, 2], 3)).toBe(2); // a WEST car ignores the 3 EAST → its 2
    expect(congestionCount([0, 1, 0, 1], 1)).toBe(1); // pure opposite pair: each sees only itself (full speed)
    expect(congestionCount([0, 1, 0, 1], 3)).toBe(1);
    expect(congestionCount([1, 1, 0, 0], 1)).toBe(2); // ORTHOGONAL (a crossing) DOES pile up: north + self
  });

  it('congestionSpeedMult: lone car full speed; congestion bites HARD and a jam crawls (floored, >0)', () => {
    expect(congestionSpeedMult(0)).toBe(1); // no neighbours
    expect(congestionSpeedMult(1)).toBe(1); // just itself
    expect(congestionSpeedMult(2)).toBeLessThan(0.65); // even two cars share-and-slow noticeably
    expect(congestionSpeedMult(3)).toBeLessThan(congestionSpeedMult(2)); // denser → slower still
    expect(congestionSpeedMult(6)).toBeLessThanOrEqual(0.25); // a real pile-up is a STRONG drag (Maddy)
    expect(congestionSpeedMult(20)).toBeGreaterThan(0); // a jam crawls, it never deadlocks (floored)
    expect(congestionSpeedMult(20)).toBeLessThan(congestionSpeedMult(3));
  });

  it('traffic pileup: a packed tile crawls — the lone car travels FAR more than the jammed pack', () => {
    const make = (n: number) => {
      const map = new GameMap(40, 8);
      for (let x = 0; x < 40; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
      const path = [];
      for (let x = 2; x <= 36; x++) path.push(map.idx(x, 4));
      const state = createAmbientState();
      for (let k = 0; k < n; k++) state.cars.push({ x: 2, y: 4, dir: 1, tx: 3, ty: 4, path: [...path], leg: 2 });
      const rng = ambientFork(`pileup${n}`);
      for (let i = 0; i < 25; i++) stepAmbient(state, map, rng, 50);
      const lead = state.cars.length > 0 ? Math.max(...state.cars.map((c) => c.x)) : 40;
      return lead - 2; // distance travelled from the start tile
    };
    expect(make(1)).toBeGreaterThan(make(6) * 2.5); // the jam is a STRONG drag, not a token slowdown
  });

  it('a citizen that DROVE to a walled-off building enters it (no give-up/respawn churn)', () => {
    // (75,106) churn (Maddy): a job hemmed in by industry/buildings has no walkable foot approach, so
    // walkPath to it is NULL. A citizen who DROVE there parks nearby and must still ARRIVE — it enters
    // the building it visited — rather than give up + respawn in a tight loop (rapid spawn/despawn).
    const map = new GameMap(16, 12);
    map.built[map.idx(5, 5)] = BuiltKind.RoadStreet; // where it parked (walkable)
    map.built[map.idx(8, 5)] = BuiltKind.Industrial; // the destination job...
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      map.built[map.idx(8 + dx, 5 + dy)] = BuiltKind.Industrial; // ...walled off → no foot approach
    }
    map.built[map.idx(0, 0)] = BuiltKind.HouseSingle; // home
    const state = createAmbientState();
    state.cars.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, parked: true, owned: true, id: 1 });
    const ped = {
      x: 5, y: 5, dir: 1, tx: 5, ty: 5,
      walkTo: { x: 8, y: 5 }, phase: 'to-building' as const, building: { x: 8, y: 5 },
      homeTile: map.idx(0, 0), carId: 1, mode: TravelMode.Walk, fuel: 2000,
    };
    state.peds.push(ped);
    const rng = ambientFork('walled-visit');
    stepAmbient(state, map, rng, 50);
    expect(state.peds.includes(ped)).toBe(true); // did NOT respawn/teleport away
    expect(ped.phase).toBe('inside'); // it arrived by car and entered the building
    expect(Math.round(ped.x)).toBe(5); // still at where it parked (it didn't get teleported home)
  });

  it('cars travel faster on a freeway than on a street', () => {
    const hwMap = new GameMap(40, 8);
    const stMap = new GameMap(40, 8);
    for (let x = 0; x < 40; x++) {
      hwMap.built[hwMap.idx(x, 4)] = BuiltKind.RoadHighway;
      stMap.built[stMap.idx(x, 4)] = BuiltKind.RoadStreet;
    }
    const path = [];
    for (let x = 2; x <= 36; x++) path.push(hwMap.idx(x, 4));
    const hw = createAmbientState();
    const st = createAmbientState();
    hw.cars.push({ x: 2, y: 4, dir: 1, tx: 3, ty: 4, path, leg: 2 });
    st.cars.push({ x: 2, y: 4, dir: 1, tx: 3, ty: 4, path, leg: 2 });
    const r1 = ambientFork('hw');
    const r2 = ambientFork('st');
    for (let i = 0; i < 20; i++) {
      stepAmbient(hw, hwMap, r1, 50);
      stepAmbient(st, stMap, r2, 50);
    }
    expect(hw.cars[0]!.x).toBeGreaterThan(st.cars[0]!.x); // freeway car got further
  });
});

describe('pedestrian fuel (give up / die when a destination is unreachable — Maddy playtest)', () => {
  it('out of fuel mid-trip: a walk citizen turns back home and loses some wellbeing', () => {
    const map = new GameMap(16, 16); // empty = walkable everywhere
    map.built[map.idx(2, 8)] = BuiltKind.HouseSingle; // home
    const state = createAmbientState();
    state.peds.push({
      x: 8, y: 8, dir: 0, tx: 8, ty: 8,
      walkTo: { x: 15, y: 8 }, phase: 'to-building',
      homeTile: map.idx(2, 8), building: { x: 15, y: 8 },
      fuel: 1, // burns out on the next substep, before it can reach (15,8)
    });
    const rng = ambientFork('fuel-giveup');
    stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(1); // still alive — it gave up, it did not die
    const p = state.peds[0]!;
    expect(p.phase).toBe('to-home'); // turned back toward home
    expect(p.walkTo).toEqual({ x: 2, y: 8 }); // heading to its home tile
    expect(p.building).toBeUndefined(); // never visited the plot → carries no visit wellbeing
    expect(state.buildingHealth.get(map.idx(2, 8))!).toBeLessThan(0); // home docked for the wasted trip
  });

  it('out of fuel on the way home: the citizen respawns at home; home takes the failed-trip hit', () => {
    const map = new GameMap(16, 16);
    map.built[map.idx(2, 8)] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    state.peds.push({
      x: 12, y: 8, dir: 0, tx: 12, ty: 8,
      walkTo: { x: 2, y: 8 }, phase: 'to-home',
      homeTile: map.idx(2, 8),
      fuel: 1, // can't even make it home
    });
    const rng = ambientFork('fuel-die');
    stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(1); // not annihilated mid-field — respawned at home (household persists)
    const p = state.peds[0]!;
    expect(Math.abs(Math.round(p.x) - 2) + Math.abs(Math.round(p.y) - 8)).toBeLessThanOrEqual(1); // beside home
    expect(p.walkTo).toBeUndefined(); // trip state cleared — it rejoins the neighbourhood
    expect(p.phase).toBeUndefined();
    // ≈-10 is the full FAILED_TRIP_PENALTY (module-private; eased ~0.02 by one health-decay tick).
    expect(state.buildingHealth.get(map.idx(2, 8))!).toBeCloseTo(-10, 0);
  });

  it('a homeless/bound ped that cannot path home despawns (nowhere to respawn)', () => {
    const map = new GameMap(16, 16);
    const state = createAmbientState();
    state.peds.push({
      x: 8, y: 8, dir: 0, tx: 8, ty: 8,
      walkTo: { x: 15, y: 8 }, phase: 'to-home', // no homeTile (a freight/bound stand-in)
      fuel: 1,
    });
    const rng = ambientFork('fuel-homeless');
    stepAmbient(state, map, rng, 50);
    expect(state.peds.length).toBe(0); // no home to return to → it just vanishes
  });

  it('an unreachable destination no longer loops forever — the citizen eventually gives up and goes', () => {
    const map = new GameMap(20, 16); // open ground, with a wall of water the ped can never cross
    for (let y = 0; y < 16; y++) map.water[map.idx(10, y)] = 1; // impassable column at x=10
    map.built[map.idx(2, 8)] = BuiltKind.HouseSingle; // home, on the reachable (west) side
    const state = createAmbientState();
    state.peds.push({
      x: 3, y: 8, dir: 0, tx: 3, ty: 8,
      walkTo: { x: 17, y: 8 }, phase: 'to-building', // east of the water — never reachable on foot
      homeTile: map.idx(2, 8), building: { x: 17, y: 8 },
    });
    const rng = ambientFork('fuel-loop');
    let alive = 1;
    for (let i = 0; i < 4000 && state.peds.length > 0; i++) {
      stepAmbient(state, map, rng, 50);
      alive = state.peds.length;
    }
    expect(alive).toBe(0); // it did not oscillate forever — fuel ran out, it gave up and walked home, despawned
    expect(state.buildingHealth.get(map.idx(2, 8))!).toBeLessThan(0); // home felt the wasted trip
  });
});

describe('terrain-aware ped pathing (lush is dear, the beaten path is cheap — Maddy playtest)', () => {
  it('routes onto a beaten desire path and shuns lush wild ground at equal distance', () => {
    const map = new GameMap(16, 16); // empty = walkable everywhere
    map.floraVitality[map.idx(3, 4)] = 255; // lush wild ground to the NORTH — hard to push through
    const state = createAmbientState();
    state.wear.set(map.idx(4, 5), 255); // a beaten desire path to the EAST — easy going
    // (3,5) -> (6,2): NORTH (3,4) and EAST (4,5) both cut the Manhattan distance equally; cost decides.
    state.peds.push({ x: 3, y: 5, dir: 0, tx: 3, ty: 5, walkTo: { x: 6, y: 2 } });
    const rng = ambientFork('beaten');
    const visited = new Set<string>();
    for (let i = 0; i < 30; i++) {
      stepAmbient(state, map, rng, 50);
      const p = state.peds[0];
      if (p) visited.add(`${Math.round(p.x)},${Math.round(p.y)}`);
    }
    expect(visited.has('4,5')).toBe(true); // took the beaten path east
    expect(visited.has('3,4')).toBe(false); // avoided the lush wild ground north
  });

  it('walking a worn desire path saps the wellbeing carried home (vs fresh ground)', () => {
    const build = (worn: boolean): number => {
      const map = new GameMap(16, 16);
      map.built[map.idx(2, 8)] = BuiltKind.HouseSingle; // home
      map.built[map.idx(13, 8)] = BuiltKind.HealingCommons; // the restorative plot just visited (+6)
      const state = createAmbientState();
      if (worn) for (let x = 3; x <= 11; x++) state.wear.set(map.idx(x, 8), 255); // a beaten corridor home
      state.peds.push({
        x: 11, y: 8, dir: 0, tx: 11, ty: 8,
        walkTo: { x: 2, y: 8 }, phase: 'to-home',
        homeTile: map.idx(2, 8), building: { x: 13, y: 8 },
      });
      const rng = ambientFork(worn ? 'worn' : 'fresh');
      for (let i = 0; i < 600; i++) {
        stepAmbient(state, map, rng, 50);
        if (state.peds.length === 0) break; // arrived home + deposited (read before decay erodes it)
      }
      return state.buildingHealth.get(map.idx(2, 8)) ?? 0;
    };
    const fresh = build(false);
    const worn = build(true);
    expect(fresh).toBeGreaterThan(0); // a restorative visit, pleasant walk → positive at home
    expect(worn).toBeLessThan(fresh); // the SAME visit over a beaten/degraded path brings home less
  });
});

describe('citizen fuel economy (spend on terrain, refuel at good plots — Maddy playtest)', () => {
  it('a beaten path costs less fuel to walk than lush wild ground (same distance)', () => {
    const walk = (lush: boolean): number => {
      const map = new GameMap(24, 8);
      const state = createAmbientState();
      for (let x = 2; x <= 20; x++) {
        const i = map.idx(x, 4);
        if (lush) map.floraVitality[i] = 255; // lush wild — tiring
        else state.wear.set(i, 255); // a beaten path — easy underfoot
      }
      state.peds.push({ x: 2, y: 4, dir: 1, tx: 2, ty: 4, walkTo: { x: 22, y: 4 }, fuel: 100000 });
      const rng = ambientFork(lush ? 'lushwalk' : 'beatenwalk');
      for (let i = 0; i < 120; i++) stepAmbient(state, map, rng, 50);
      return state.peds[0]!.fuel!; // fuel remaining after the same walk
    };
    expect(walk(false)).toBeGreaterThan(walk(true)); // beaten path → more fuel left → spent less
  });

  it('a successful visit refuels a citizen by the plot status/use (healing >> industrial)', () => {
    const reachInside = (plotKind: number): number => {
      const map = new GameMap(16, 16);
      map.built[map.idx(2, 8)] = BuiltKind.HouseSingle; // home
      map.built[map.idx(6, 8)] = plotKind; // the plot to visit
      const state = createAmbientState();
      state.peds.push({
        x: 4, y: 8, dir: 0, tx: 4, ty: 8,
        walkTo: { x: 6, y: 8 }, phase: 'to-building',
        homeTile: map.idx(2, 8), building: { x: 6, y: 8 },
        fuel: 100, // a low tank so the refuel is visible
      });
      const rng = ambientFork('refuel');
      for (let i = 0; i < 200 && state.peds[0]?.phase !== 'inside'; i++) stepAmbient(state, map, rng, 50);
      return state.peds[0]!.fuel!;
    };
    const healing = reachInside(BuiltKind.HealingCommons); // visitValue +6 → a big refuel
    const industrial = reachInside(BuiltKind.Industrial); // visitValue −4 → ~no refuel
    expect(healing).toBeGreaterThan(100); // restorative plot tops the tank up past where it started
    expect(healing).toBeGreaterThan(industrial); // refuel scales with plot status/use
  });
});

describe('citizen daily itinerary (home → work → shop → lifestyle → home — Maddy directive)', () => {
  it('a citizen with its car out RETURNS TO THE CAR for the next leg, not walks off (Maddy droveHere)', () => {
    const map = new GameMap(20, 10);
    for (let x = 1; x <= 16; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet; // a street to drive
    map.built[map.idx(6, 5)] = BuiltKind.Industrial; // work it just visited
    map.built[map.idx(9, 5)] = BuiltKind.CommercialStrip; // a SHORT next leg — chooseMode alone would WALK
    map.built[map.idx(2, 5)] = BuiltKind.HouseSingle; // home
    map.built[map.idx(6, 3)] = BuiltKind.Park; // keep the just-visited ped on the ped network (substrate)
    const state = createAmbientState();
    state.cars.push({ x: 5, y: 4, dir: 1, tx: 5, ty: 4, owned: true, parked: true, id: 7, curbSlot: 0 });
    const ped = {
      x: 6, y: 4, dir: 1, tx: 6, ty: 4, phase: 'inside' as const, dwellInside: 1,
      carId: 7, homeTile: map.idx(2, 5), building: { x: 6, y: 5 },
      itinerary: [StopCategory.Work, StopCategory.Shop], itinStep: 0,
    };
    state.peds.push(ped);
    const rng = ambientFork('drovehere');
    for (let i = 0; i < 5 && ped.phase === 'inside'; i++) stepAmbient(state, map, rng, 50);
    // It returns to its car (walks to it, then drives) — NOT walking the leg directly on foot.
    expect(['to-vehicle', 'driving']).toContain(ped.phase);
  });

  it('walks the full round in order, banks each stop at home, then returns home', () => {
    const map = new GameMap(24, 8); // empty = walkable everywhere
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle; // home
    map.built[map.idx(6, 4)] = BuiltKind.Industrial; // work
    map.built[map.idx(10, 4)] = BuiltKind.CommercialStrip; // shop
    map.built[map.idx(14, 4)] = BuiltKind.HealingCommons; // lifestyle
    const state = createAmbientState();
    state.peds.push({
      x: 3, y: 4, dir: 1, tx: 3, ty: 4,
      walkTo: { x: 6, y: 4 }, phase: 'to-building', building: { x: 6, y: 4 },
      homeTile: map.idx(2, 4),
      itinerary: [StopCategory.Work, StopCategory.Shop, StopCategory.Lifestyle], itinStep: 0,
    });
    const rng = ambientFork('round');
    const visited: string[] = [];
    let last = '';
    let peakHome = 0;
    for (let i = 0; i < 4000 && state.peds.length > 0; i++) {
      stepAmbient(state, map, rng, 50);
      const p = state.peds[0];
      if (p && p.phase === 'inside' && p.building) {
        const key = `${p.building.x},${p.building.y}`;
        if (key !== last) { visited.push(key); last = key; }
      }
      peakHome = Math.max(peakHome, state.buildingHealth.get(map.idx(2, 4)) ?? 0);
    }
    expect(visited).toEqual(['6,4', '10,4', '14,4']); // work, then shop, then lifestyle, in order
    expect(peakHome).toBeGreaterThan(0); // the round's good stops banked wellbeing at home
    expect(state.peds.length).toBe(0); // round done → walked home → despawned
  });

  it('skips a stop category that has no reachable plot, keeping the rest of the round', () => {
    const map = new GameMap(24, 8);
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle; // home
    map.built[map.idx(6, 4)] = BuiltKind.Industrial; // work — present
    // no shop anywhere
    map.built[map.idx(12, 4)] = BuiltKind.HealingCommons; // lifestyle — present
    const state = createAmbientState();
    state.peds.push({
      x: 3, y: 4, dir: 1, tx: 3, ty: 4,
      walkTo: { x: 6, y: 4 }, phase: 'to-building', building: { x: 6, y: 4 },
      homeTile: map.idx(2, 4),
      itinerary: [StopCategory.Work, StopCategory.Shop, StopCategory.Lifestyle], itinStep: 0,
    });
    const rng = ambientFork('skip');
    const visited: string[] = [];
    let last = '';
    for (let i = 0; i < 4000 && state.peds.length > 0; i++) {
      stepAmbient(state, map, rng, 50);
      const p = state.peds[0];
      if (p && p.phase === 'inside' && p.building) {
        const key = `${p.building.x},${p.building.y}`;
        if (key !== last) { visited.push(key); last = key; }
      }
    }
    expect(visited).toEqual(['6,4', '12,4']); // work then lifestyle — the absent shop was skipped
    expect(state.peds.length).toBe(0);
  });

  it('census citizens spawn from homes and set off on their daily round', () => {
    const map = new GameMap(24, 8);
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle; // a home
    map.built[map.idx(8, 4)] = BuiltKind.Industrial; // a workplace in range
    const state = createAmbientState();
    setHouseholds(state, [{ x: 2, y: 4, count: 3 }]); // published from the residential census
    const rng = ambientFork('census');
    for (let i = 0; i < 30; i++) stepAmbient(state, map, rng, 50);
    const citizens = state.peds.filter((p) => p.itinerary !== undefined);
    expect(citizens.length).toBeGreaterThan(0); // the census produced walking citizens
    expect(citizens.every((p) => p.homeTile === map.idx(2, 4))).toBe(true); // tagged with their home
    expect(citizens.some((p) => p.phase === 'to-building' && p.building)).toBe(true); // off toward a stop
  });

  it('does not spawn census citizens when no household is published', () => {
    const map = new GameMap(24, 8);
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle;
    map.built[map.idx(8, 4)] = BuiltKind.Industrial;
    const state = createAmbientState(); // no setHouseholds
    const rng = ambientFork('nocensus');
    for (let i = 0; i < 30; i++) stepAmbient(state, map, rng, 50);
    expect(state.peds.every((p) => p.itinerary === undefined)).toBe(true); // only ambient wanderers, no citizens
  });

  it('a citizen that gives up GOES HOME (despawns) — it does not become a park-loitering wanderer', () => {
    // Maddy: "citizens not commuting home; peds roam parks/rewilded, may never go home." A failed trip
    // routed the citizen through respawnAtHome, which repositioned it next to home but cleared its
    // itinerary/phase/walkTo and KEPT it — so it fell to the ambient-wander branch and loitered on the
    // green substrate forever. A give-up must end like a success: the citizen is home (despawned).
    const map = new GameMap(16, 16);
    map.built[map.idx(2, 8)] = BuiltKind.HouseSingle; // home, on the WEST side
    for (let y = 0; y < 16; y++) map.water[map.idx(9, y)] = Water.River; // a full water wall: no foot route east<->west
    // a park blob near home so a wandering ped would STAY on ped substrate (never despawn) — the bug
    for (let y = 6; y <= 10; y++) for (let x = 3; x <= 6; x++) map.built[map.idx(x, y)] = BuiltKind.Park;
    const state = createAmbientState();
    const citizen = {
      x: 13, y: 8, dir: 3, tx: 13, ty: 8,
      walkTo: { x: 2, y: 8 }, phase: 'to-home' as const, // east of the wall, can never walk home
      homeTile: map.idx(2, 8), fuel: 1e9, mode: TravelMode.Walk,
    };
    state.peds.push(citizen);
    const rng = ambientFork('giveup-home');
    // The give-up fires on the first step (walkPath home fails immediately). A clean "go home" despawns
    // it at once; the bug instead repositions + keeps it, so it loiters on the park substrate for many
    // steps. Track THIS citizen by reference (the park also spawns ambient wanderers — peds.length is noisy).
    for (let i = 0; i < 5; i++) stepAmbient(state, map, rng, 50);
    expect(state.peds.includes(citizen)).toBe(false); // gave up → went home → despawned promptly (not loitering)
    expect(state.buildingHealth.get(map.idx(2, 8))!).toBeLessThan(0); // home felt the failed trip
  });
});

describe('multimodal travel (mode sets a citizen’s route + speed — Maddy /goal)', () => {
  it('a streetcar rider covers more ground along a line than a walker', () => {
    const make = (mode: TravelMode) => {
      const map = new GameMap(40, 8);
      for (let x = 0; x < 40; x++) map.built[map.idx(x, 4)] = BuiltKind.Streetcar; // a tram line
      const state = createAmbientState();
      state.peds.push({ x: 2, y: 4, dir: 1, tx: 2, ty: 4, walkTo: { x: 38, y: 4 }, fuel: 1e9, mode });
      const rng = ambientFork('tram' + mode);
      for (let i = 0; i < 60; i++) stepAmbient(state, map, rng, 50);
      return state.peds[0]!.x;
    };
    expect(make(TravelMode.Streetcar)).toBeGreaterThan(make(TravelMode.Walk)); // rode the line faster
  });

  it('a driver cannot cross wild ground to an unroaded destination (a walker can)', () => {
    const reaches = (mode: TravelMode): boolean => {
      const map = new GameMap(16, 8);
      map.built[map.idx(2, 4)] = BuiltKind.RoadStreet; // a 2-tile road stub at the start...
      map.built[map.idx(3, 4)] = BuiltKind.RoadStreet;
      map.built[map.idx(12, 4)] = BuiltKind.CommercialStrip; // ...the dest plot is out in the green
      const state = createAmbientState();
      state.peds.push({
        x: 3, y: 4, dir: 1, tx: 3, ty: 4,
        walkTo: { x: 12, y: 4 }, phase: 'to-building', building: { x: 12, y: 4 },
        homeTile: map.idx(2, 4), mode,
      });
      const rng = ambientFork('cross' + mode);
      for (let i = 0; i < 1500 && state.peds.length > 0; i++) {
        stepAmbient(state, map, rng, 50);
        if (state.peds[0]?.phase === 'inside') return true;
      }
      return false;
    };
    expect(reaches(TravelMode.Walk)).toBe(true); // a walker crosses the green and arrives
    expect(reaches(TravelMode.Drive)).toBe(false); // a driver is stuck on the road stub — pavement-only
  });
});

describe('mode choice (close → walk; car-dependent until calm/transit infra; then it shifts)', () => {
  it('walks a short leg', () => {
    const map = new GameMap(40, 40);
    expect(chooseMode(map, 5, 5, 12, 5)).toBe(TravelMode.Walk); // d=7, within walking range
  });

  it('BIKES a medium leg (cyclists appear from the start; bike infra just makes it nicer)', () => {
    const map = new GameMap(40, 10);
    for (let x = 0; x < 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    expect(chooseMode(map, 5, 5, 20, 5)).toBe(TravelMode.Bike); // d=15, beyond walking, within biking
  });

  it('DRIVES a leg beyond biking range when no transit serves it (a mix: some drive)', () => {
    const map = new GameMap(40, 10);
    for (let x = 0; x < 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    expect(chooseMode(map, 3, 5, 28, 5)).toBe(TravelMode.Drive); // d=25, beyond biking → drive
  });

  it('drives a long leg when only roads connect it (beyond biking, no transit)', () => {
    const map = new GameMap(60, 10);
    for (let x = 0; x < 60; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    expect(chooseMode(map, 3, 5, 50, 5)).toBe(TravelMode.Drive); // d=47 (beyond biking), roads at both ends
  });

  it('rides elevated rail when a line serves both ends — even far (transit beats driving)', () => {
    const map = new GameMap(60, 10);
    for (let x = 0; x < 60; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet; // roads exist too
    map.built[map.idx(4, 5)] = BuiltKind.ElevatedRail; // a stop near the origin
    map.built[map.idx(50, 5)] = BuiltKind.ElevatedRail; // and near the destination
    expect(chooseMode(map, 3, 6, 50, 6)).toBe(TravelMode.ElevatedRail);
  });

  it('rides a streetcar when a line serves both ends and there is no rail', () => {
    const map = new GameMap(60, 10);
    map.built[map.idx(4, 5)] = BuiltKind.Streetcar;
    map.built[map.idx(49, 5)] = BuiltKind.Streetcar;
    expect(chooseMode(map, 3, 6, 50, 6)).toBe(TravelMode.Streetcar);
  });
});

describe('citizen vehicle ownership (a driver parks a persistent car — Maddy: cars must not vanish)', () => {
  it('a driving citizen parks a real car at its destination and banks the visit home', () => {
    const map = new GameMap(50, 10);
    for (let x = 2; x <= 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet; // a long arterial
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle; // home, fronts the road
    map.built[map.idx(38, 4)] = BuiltKind.Industrial; // a FAR workplace → a car commute (no bike/transit)
    const state = createAmbientState();
    setHouseholds(state, [{ x: 2, y: 4, count: 3 }]);
    const rng = ambientFork('owncar');
    let parkedNearWork = false;
    let banked = false;
    for (let i = 0; i < 1500; i++) {
      stepAmbient(state, map, rng, 50);
      // a persistent car PARKS at the plot (it does not vanish on arrival)
      if (state.cars.some((c) => c.parked && Math.abs(Math.round(c.x) - 38) <= 3 && Math.abs(Math.round(c.y) - 5) <= 3)) {
        parkedNearWork = true;
      }
      if ((state.buildingHealth.get(map.idx(2, 4)) ?? 0) !== 0) banked = true;
      if (parkedNearWork && banked) break;
    }
    expect(parkedNearWork).toBe(true); // the car parked at the workplace — it didn't disappear
    expect(banked).toBe(true);
    expect(state.buildingHealth.get(map.idx(2, 4))!).toBeLessThan(0); // industrial visit → negative at home
  });

  it('a driver is a ped that OWNS a distinct persistent car, not a ped rendered as a car', () => {
    const map = new GameMap(50, 10);
    for (let x = 2; x <= 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle;
    map.built[map.idx(38, 4)] = BuiltKind.Industrial;
    const state = createAmbientState();
    setHouseholds(state, [{ x: 2, y: 4, count: 3 }]);
    const rng = ambientFork('owncar2');
    let sawOwnedCar = false;
    let sawOwnerPed = false;
    for (let i = 0; i < 400; i++) {
      stepAmbient(state, map, rng, 50);
      if (state.cars.some((c) => c.owned)) sawOwnedCar = true;
      if (state.peds.some((p) => p.carId !== undefined && state.cars.some((c) => c.id === p.carId))) {
        sawOwnerPed = true;
      }
    }
    expect(sawOwnedCar).toBe(true); // the vehicle is a distinct, persistent OWNED Car entity
    expect(sawOwnerPed).toBe(true); // a citizen PED owns it — it walks to and from it
    expect(state.peds.every((p) => p.mode !== TravelMode.Drive)).toBe(true); // a ped is never itself "a car"
  });

  it('an owned car persists (does not despawn) while its owner is away visiting on foot', () => {
    const map = new GameMap(50, 10);
    for (let x = 2; x <= 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    map.built[map.idx(2, 4)] = BuiltKind.HouseSingle;
    map.built[map.idx(38, 4)] = BuiltKind.Industrial;
    const state = createAmbientState();
    setHouseholds(state, [{ x: 2, y: 4, count: 3 }]);
    const rng = ambientFork('persist');
    // step until a citizen is INSIDE a plot with an owned car parked outside, then keep stepping
    // through the whole visit and assert the car never vanishes.
    let survivedVisit = false;
    for (let i = 0; i < 1500 && !survivedVisit; i++) {
      stepAmbient(state, map, rng, 50);
      const visitor = state.peds.find((p) => p.phase === 'inside' && p.carId !== undefined);
      if (visitor && state.cars.some((c) => c.id === visitor.carId)) {
        // its car exists right now; verify it's still there after a stretch of the visit
        let stillThere = true;
        for (let j = 0; j < 40; j++) {
          stepAmbient(state, map, rng, 50);
          if (!state.cars.some((c) => c.id === visitor.carId)) { stillThere = false; break; }
        }
        survivedVisit = stillThere;
      }
    }
    expect(survivedVisit).toBe(true); // the parked car waited for its owner — it did not despawn
  });
});

describe('roadPath (A* agent road routing — committed least-cost paths, no greedy circling)', () => {
  it('finds a contiguous committed route along the road network, start- and goal-inclusive', () => {
    const map = new GameMap(12, 6);
    for (let x = 1; x <= 10; x++) map.built[map.idx(x, 3)] = BuiltKind.RoadStreet;
    const path = roadPath(map, 1, 3, 10, 3);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(map.idx(1, 3));
    expect(path![path!.length - 1]).toBe(map.idx(10, 3));
    for (let i = 1; i < path!.length; i++) {
      const a = path![i - 1]!;
      const b = path![i]!;
      const ax = a % 12;
      const ay = (a - ax) / 12;
      const bx = b % 12;
      const by = (b - bx) / 12;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1); // adjacent tiles, no jumps
    }
  });

  it('returns null when the goal is not road-reachable from the start', () => {
    const map = new GameMap(12, 6);
    map.built[map.idx(1, 3)] = BuiltKind.RoadStreet;
    map.built[map.idx(10, 3)] = BuiltKind.RoadStreet; // two disconnected road tiles
    expect(roadPath(map, 1, 3, 10, 3)).toBeNull();
  });

  it('routes around a congested tile when an alternative exists (agent-driven avoidance)', () => {
    // a grid with two parallel corridors between the same ends; congest the direct one.
    const map = new GameMap(9, 7);
    for (let x = 1; x <= 7; x++) { map.built[map.idx(x, 2)] = BuiltKind.RoadStreet; map.built[map.idx(x, 4)] = BuiltKind.RoadStreet; }
    for (let y = 2; y <= 4; y++) { map.built[map.idx(1, y)] = BuiltKind.RoadStreet; map.built[map.idx(7, y)] = BuiltKind.RoadStreet; }
    const jam = new Map<number, number>();
    for (let x = 2; x <= 6; x++) jam.set(map.idx(x, 2), 255); // top corridor fully congested
    const path = roadPath(map, 1, 3, 7, 3, jam)!;
    const usedTop = path.some((i) => { const x = i % 9; const y = (i - x) / 9; return y === 2 && x >= 2 && x <= 6; });
    expect(usedTop).toBe(false); // avoided the jam, took the clear bottom corridor
  });
});

describe('liveInspectLine (inspect live-sample formatting)', () => {
  it('formats a home: population, land value, health', () => {
    expect(liveInspectLine({ occupancy: 12.4, landValue: 64.6, health: 30.2 })).toBe(
      'pop 12 · land value 65 · health 30',
    );
  });

  it('formats a road: traffic and smog only', () => {
    expect(liveInspectLine({ traffic: 30, pollution: 8 })).toBe('traffic 30 · smog 8');
  });

  it('formats a contaminated water tile', () => {
    expect(liveInspectLine({ water: 180 })).toBe('water 180 contaminated');
  });

  it('formats a crumbling road tile', () => {
    expect(liveInspectLine({ traffic: 12, road: 140 })).toBe('traffic 12 · road 140 crumbling');
  });

  it('formats a police-violence tile', () => {
    expect(liveInspectLine({ violence: 90 })).toBe('police violence 90');
  });

  it('formats service coverage (served / under-served)', () => {
    expect(liveInspectLine({ served: true })).toBe('served');
    expect(liveInspectLine({ served: false })).toBe('under-served');
  });

  it('omits absent fields and returns empty when nothing is present', () => {
    expect(liveInspectLine({ landValue: 50 })).toBe('land value 50');
    expect(liveInspectLine({})).toBe('');
  });

  it('keeps a fixed field order regardless of object key order', () => {
    expect(liveInspectLine({ pollution: 1, occupancy: 2, traffic: 3 })).toBe(
      'pop 2 · traffic 3 · smog 1',
    );
  });
});

describe('setPlantEmitters (dirty-plant smog into the live pollution field)', () => {
  it('lays pollution at an emitter tile on a stepAmbient pass', () => {
    const map = gridMap();
    const state = createAmbientState();
    const rng = createRng('plant').fork('ambient');
    const tile = map.idx(4, 3);
    setPlantEmitters(state, [{ tile, amount: 6 }]);
    stepAmbient(state, map, rng, 50);
    expect(state.pollution.get(tile) ?? 0).toBeGreaterThan(0);
  });

  it('lays nothing with no emitters published', () => {
    const map = gridMap();
    const state = createAmbientState();
    const rng = createRng('plant2').fork('ambient');
    const tile = map.idx(4, 3);
    stepAmbient(state, map, rng, 50);
    expect(state.pollution.get(tile) ?? 0).toBe(0);
  });
});

describe('freeway ramps (RoadRamp — the limited-access interchange, Maddy 2026-06-18)', () => {
  // A ramp cross-section: convert one column of the 3-wide freeway to RoadRamp, with streets flanking
  // it on both perpendicular sides (the crossing) — and a plain street touching a non-ramp column.
  function rampedFreeway(): GameMap {
    const m = freewayH(); // rows 5 (N→West), 6 (through), 7 (S→East), full width
    for (const y of [5, 6, 7]) m.built[m.idx(10, y)] = BuiltKind.RoadRamp; // ramp cross-section at x=10
    m.built[m.idx(10, 4)] = BuiltKind.RoadStreet; // cross street north of the ramp
    m.built[m.idx(10, 8)] = BuiltKind.RoadStreet; // and south of it
    m.built[m.idx(13, 4)] = BuiltKind.RoadStreet; // a street touching a NON-ramp freeway column
    return m;
  }

  it('a ramp tile is a free interchange (cross traffic crosses the freeway here)', () => {
    const m = rampedFreeway();
    expect(canDrive(m, 10, 4, 10, 5)).toBe(true); // street enters the ramp from the north ✓
    expect(canDrive(m, 10, 5, 10, 6)).toBe(true); // crosses through the ramp cross-section ✓
    expect(canDrive(m, 10, 6, 10, 7)).toBe(true);
    expect(canDrive(m, 10, 7, 10, 8)).toBe(true); // exits to the street on the south side ✓
  });

  it('still blocks cross traffic where the freeway is NOT a ramp (limited access holds)', () => {
    const m = rampedFreeway();
    expect(canDrive(m, 13, 4, 13, 5)).toBe(false); // a street can't cut into a non-ramp freeway column ✗
  });

  it('the freeway flows ALONG itself through a ramp (the corridor stays continuous)', () => {
    const m = rampedFreeway();
    expect(canDrive(m, 11, 5, 10, 5)).toBe(true); // westbound north lane → onto the ramp ✓
    expect(canDrive(m, 10, 5, 9, 5)).toBe(true); // → off the ramp, continuing west along the lane ✓
  });

  it('a ramp tile classifies as null (free), and the lanes around it stay classified', () => {
    const m = rampedFreeway();
    expect(freewayLane(m, 10, 5)).toBeNull(); // the ramp itself is a free interchange tile
    expect(freewayLane(m, 9, 5)).toEqual({ role: 'outer', dir: 3, outward: 0 }); // lane intact past the ramp
    expect(freewayLane(m, 11, 7)).toEqual({ role: 'outer', dir: 1, outward: 2 });
  });
});

describe('canDrive level crossings (Maddy: streetcars must not block cross traffic at intersections)', () => {
  it('a car CROSSES a streetcar line straight-through to the road beyond', () => {
    const m = new GameMap(12, 8);
    for (const x of [4, 5, 7, 8]) m.built[m.idx(x, 5)] = BuiltKind.RoadStreet; // road…gap…road
    m.built[m.idx(6, 5)] = BuiltKind.Streetcar; // a tram line crossing the street
    expect(canDrive(m, 5, 5, 6, 5)).toBe(true); // enter the tram crossing eastbound (road beyond) ✓
    expect(canDrive(m, 6, 5, 7, 5)).toBe(true); // …and out the far side ✓
  });

  it('a car may NOT drive ALONG a tram line (no road straight beyond)', () => {
    const m = new GameMap(12, 8);
    m.built[m.idx(5, 5)] = BuiltKind.RoadStreet;
    m.built[m.idx(6, 5)] = BuiltKind.Streetcar;
    m.built[m.idx(7, 5)] = BuiltKind.Streetcar; // the tram continues — not a crossing, a line
    expect(canDrive(m, 5, 5, 6, 5)).toBe(false); // can't enter: the tile beyond is more tram, not road
  });

  it('a cross street crosses an avenue/streetcar/avenue median (the reported case)', () => {
    const m = new GameMap(14, 14);
    for (let x = 0; x < 14; x++) {
      m.built[m.idx(x, 5)] = BuiltKind.RoadAvenue; // north flanking avenue
      m.built[m.idx(x, 6)] = BuiltKind.Streetcar; // streetcar median
      m.built[m.idx(x, 7)] = BuiltKind.RoadAvenue; // south flanking avenue
    }
    for (let y = 0; y < 14; y++) if (y < 5 || y > 7) m.built[m.idx(8, y)] = BuiltKind.RoadStreet; // cross street
    expect(canDrive(m, 8, 4, 8, 5)).toBe(true); // street → north avenue
    expect(canDrive(m, 8, 5, 8, 6)).toBe(true); // avenue → streetcar median (level crossing)
    expect(canDrive(m, 8, 6, 8, 7)).toBe(true); // streetcar → south avenue
    expect(canDrive(m, 8, 7, 8, 8)).toBe(true); // south avenue → street (crossed it)
  });
});

describe('canDrive on divided avenues (Maddy: avenues had the same lane-math problem as freeways)', () => {
  function avenue(): GameMap {
    const m = new GameMap(20, 12);
    for (let x = 0; x < 20; x++) {
      m.built[m.idx(x, 5)] = BuiltKind.RoadAvenue; // north lane → West
      m.built[m.idx(x, 6)] = BuiltKind.RoadAvenue; // south lane → East
    }
    return m;
  }

  it('a divided avenue lane is one-way — committed routes cannot drive the wrong way', () => {
    const m = avenue();
    expect(canDrive(m, 11, 5, 10, 5)).toBe(true); // West along the north lane ✓
    expect(canDrive(m, 10, 5, 11, 5)).toBe(false); // East = wrong-way on the north lane ✗
    expect(canDrive(m, 10, 6, 11, 6)).toBe(true); // East along the south lane ✓
    expect(canDrive(m, 11, 6, 10, 6)).toBe(false); // West = wrong-way on the south lane ✗
  });

  it('but a cross street still CROSSES the avenue perpendicular (at-grade, unlike a freeway)', () => {
    const m = avenue();
    m.built[m.idx(8, 4)] = BuiltKind.RoadStreet; // cross street north of the avenue
    m.built[m.idx(8, 7)] = BuiltKind.RoadStreet; // and south of it
    expect(canDrive(m, 8, 4, 8, 5)).toBe(true); // street → north lane (crossing)
    expect(canDrive(m, 8, 5, 8, 6)).toBe(true); // across to the south lane
    expect(canDrive(m, 8, 6, 8, 7)).toBe(true); // out to the street on the far side
  });
});

describe('promenade overpass lets peds traverse (incl. across a freeway)', () => {
  it('an elevated promenade deck is ped substrate even over a freeway', () => {
    const m = new GameMap(10, 10);
    placeTransport(m, 5, 5, BuiltKind.RoadHighway);
    expect(isPedSubstrate(m, 5, 5)).toBe(false); // a bare freeway is NOT walkable
    placeOverpass(m, 5, 5, BuiltKind.Promenade);
    expect(isPedSubstrate(m, 5, 5)).toBe(true); // the promenade overpass IS walkable across the freeway
  });

  it('an elevated RAIL deck is not a ped substrate (trains, not walkers)', () => {
    const m = new GameMap(10, 10);
    placeTransport(m, 5, 5, BuiltKind.RoadHighway);
    placeOverpass(m, 5, 5, BuiltKind.ElevatedRail);
    expect(isPedSubstrate(m, 5, 5)).toBe(false);
  });
});

describe('walkPath (committed foot routing around barriers — Maddy: peds dithering at a wall)', () => {
  it('routes AROUND a freeway wall to the door, where a greedy step dead-ends', () => {
    const m = new GameMap(12, 12);
    for (let y = 0; y <= 8; y++) m.built[m.idx(5, y)] = BuiltKind.RoadHighway; // a wall; gap at y>=9
    m.built[m.idx(7, 4)] = BuiltKind.HouseSingle; // the destination (not walkable; door at 6,4)
    const path = walkPath(m, 3, 4, 7, 4);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    const ex = end % 12;
    const ey = (end - ex) / 12;
    expect(Math.abs(ex - 7) + Math.abs(ey - 4)).toBeLessThanOrEqual(1); // ends at the door
    for (const i of path!) expect(m.built[i]).not.toBe(BuiltKind.RoadHighway); // never on the freeway
    expect(path!.some((i) => Math.floor(i / 12) >= 9)).toBe(true); // detours through the south gap
  });

  it('returns null when the destination is fully walled off on foot', () => {
    const m = new GameMap(9, 9);
    for (let y = 0; y < 9; y++) m.built[m.idx(4, y)] = BuiltKind.RoadHighway; // full wall, no gap
    m.built[m.idx(6, 4)] = BuiltKind.HouseSingle;
    expect(walkPath(m, 1, 4, 6, 4)).toBeNull();
  });

  it('returns the start alone when already at the door (<=1 from the target)', () => {
    const m = new GameMap(8, 8);
    m.built[m.idx(4, 4)] = BuiltKind.HouseSingle;
    expect(walkPath(m, 4, 5, 4, 4)).toEqual([m.idx(4, 5)]); // adjacent → already arrived
  });

  it('every step is a 4-adjacent walkable tile (a followable committed route)', () => {
    const m = new GameMap(12, 12);
    for (let y = 0; y <= 8; y++) m.built[m.idx(5, y)] = BuiltKind.RoadHighway;
    m.built[m.idx(7, 4)] = BuiltKind.HouseSingle;
    const path = walkPath(m, 3, 4, 7, 4)!;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      const ax = a % 12;
      const ay = (a - ax) / 12;
      const bx = b % 12;
      const by = (b - bx) / 12;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1); // adjacent
    }
  });
});

describe('owned cars follow their citizen home, never despawn on the spot (Maddy)', () => {
  function ownedCar(id: number, x: number, y: number): import('../../src/ui/ambientContent').Car {
    return { id, x, y, tx: x, ty: y, dir: 0, owned: true, parked: true, tint: 0 } as never;
  }

  it("warps a sent-home citizen's parked car to park NEAR HOME (does not vanish it where it sat)", () => {
    const m = new GameMap(40, 40);
    for (let x = 2; x < 38; x++) m.built[m.idx(x, 20)] = BuiltKind.RoadStreet; // a road row
    m.built[m.idx(5, 19)] = BuiltKind.HouseSingle; // home at (5,19); kerb at (5,20)
    const state = createAmbientState();
    const homeTile = m.idx(5, 19);
    const car = ownedCar(1, 30, 20); // parked far from home (~25 tiles east)
    state.cars.push(car);
    const p = { x: 30, y: 21, carId: 1, homeTile, phase: 'to-building' } as never as import('../../src/ui/ambientContent').Ped;
    sendOwnedCarHome(state, m, p, homeTile);
    expect(state.cars.includes(car)).toBe(true); // the car did NOT despawn
    expect(car.owned).toBe(false); // it's a put-away car now (clears on its dwell, like any parked car)
    expect(Math.abs(car.x - 5) + Math.abs(car.y - 19)).toBeLessThan(8); // warped to near home (was ~25 away)
    expect(p.carId).toBeUndefined(); // the ped→car link is released
  });

  it('removes the car only when home has no reachable parking (never strands it mid-map)', () => {
    const m = new GameMap(20, 20);
    m.built[m.idx(5, 5)] = BuiltKind.HouseSingle; // home with NO roads/parking anywhere
    const state = createAmbientState();
    const car = ownedCar(2, 10, 10);
    state.cars.push(car);
    const p = { x: 10, y: 11, carId: 2, homeTile: m.idx(5, 5) } as never as import('../../src/ui/ambientContent').Ped;
    sendOwnedCarHome(state, m, p, m.idx(5, 5));
    expect(state.cars.includes(car)).toBe(false); // nowhere to park → removed, not stranded
  });

  it('is a no-op for a ped that owns no car', () => {
    const m = new GameMap(12, 12);
    const state = createAmbientState();
    const p = { x: 3, y: 3, homeTile: m.idx(2, 2) } as never as import('../../src/ui/ambientContent').Ped;
    expect(() => sendOwnedCarHome(state, m, p, m.idx(2, 2))).not.toThrow();
  });
});

describe('arrested citizens leave ABANDONED cars that rust into ground pollution (Maddy)', () => {
  it('abandons an owned car on a nearby EMPTY tile (a derelict — not warped home, not despawned)', () => {
    const m = new GameMap(20, 20);
    for (let x = 2; x < 18; x++) m.built[m.idx(x, 10)] = BuiltKind.RoadStreet; // a road; open land around
    const state = createAmbientState();
    const car = { id: 1, x: 9, y: 10, tx: 9, ty: 10, dir: 0, owned: true, parked: true, tint: 0 } as never as Car;
    state.cars.push(car);
    const p = { x: 9, y: 11, carId: 1, homeTile: m.idx(2, 2) } as never as Ped;
    abandonOwnedCar(state, m, p);
    expect(state.cars.includes(car)).toBe(true); // did NOT despawn
    expect(car.abandoned).toBe(true);
    expect(car.owned).toBe(false);
    expect(p.carId).toBeUndefined();
    // it sits on an EMPTY tile (open land), not on the road
    expect(m.built[m.idx(Math.round(car.x), Math.round(car.y))]).toBe(BuiltKind.None);
    expect(m.water[m.idx(Math.round(car.x), Math.round(car.y))]).toBe(0);
  });

  it('degrades into ground pollution at its tile, then rusts away (despawns), leaving the contamination', () => {
    const m = new GameMap(12, 12);
    const state = createAmbientState();
    const car = { id: 2, x: 6, y: 6, tx: 6, ty: 6, dir: 0, abandoned: true, parked: true, owned: false, tint: 0, dwell: 3 } as never as Car;
    state.cars.push(car);
    const tile = m.idx(6, 6);
    expect(degradeAbandonedCar(state, m, car)).toBe(true); // dwell 3 -> 2
    expect(degradeAbandonedCar(state, m, car)).toBe(true); // 2 -> 1
    expect(state.groundPollution.get(tile) ?? 0).toBeGreaterThan(0); // poisoned its tile
    expect(degradeAbandonedCar(state, m, car)).toBe(false); // 1 -> 0 -> rusted away (despawn)
    expect(state.groundPollution.get(tile) ?? 0).toBeGreaterThan(0); // contamination LINGERS after the wreck
  });

  it('carOffNetwork exempts an abandoned car sitting on an empty tile', () => {
    const m = new GameMap(8, 8);
    const derelict = { x: 4, y: 4, abandoned: true } as never as Car;
    expect(carOffNetwork(m, derelict)).toBe(false); // a derelict is allowed to sit off the road
    const stray = { x: 4, y: 4 } as never as Car;
    expect(carOffNetwork(m, stray)).toBe(true); // a normal car on empty land is still off-network
  });
});

describe('stopReachable (Maddy: NE region spawns + immediately despawns travelers)', () => {
  // An isolated landmass whose citizens can reach NO mainland stop should not be sent on trips there
  // (they would spawn, fail to route, give up, and churn). stopReachable gates trip-stop selection.
  function islandWorld(): GameMap {
    const m = new GameMap(34, 12);
    for (let x = 1; x <= 10; x++) m.built[m.idx(x, 6)] = BuiltKind.RoadStreet; // mainland road
    m.built[m.idx(5, 5)] = BuiltKind.CommercialStrip; // mainland shop (door at 5,6)
    for (let x = 11; x <= 17; x++) for (let y = 0; y < 12; y++) m.water[m.idx(x, y)] = Water.Ocean; // moat
    for (let x = 20; x <= 26; x++) m.built[m.idx(x, 6)] = BuiltKind.RoadStreet; // island road (land)
    return m;
  }

  it('a citizen on an isolated island cannot reach a mainland stop (no walk OR drive route)', () => {
    const m = islandWorld();
    const state = createAmbientState();
    expect(stopReachable(state, m, 23, 5, { x: 5, y: 5 })).toBe(false); // island → mainland: across the moat
  });

  it('a mainland citizen CAN reach a mainland stop', () => {
    const m = islandWorld();
    const state = createAmbientState();
    expect(stopReachable(state, m, 9, 6, { x: 5, y: 5 })).toBe(true); // walkable along the road
  });
});

describe('parking seek: nearby lot -> side-street curb -> farther lot (Maddy: full-lot pile + reroute)', () => {
  const lotInfos = (map: GameMap) =>
    parkingLots(map).map((lot) => ({
      cx: (lot.x0 + lot.x1) / 2, cy: (lot.y0 + lot.y1) / 2,
      x0: lot.x0, y0: lot.y0, x1: lot.x1, y1: lot.y1, stalls: parkingStalls(lot),
    }));
  const fillNearLot = (state: ReturnType<typeof createAmbientState>, m: GameMap) => {
    for (let n = 0; n < 9; n++) {
      const c = { x: 4, y: 4, dir: 0, tx: 4, ty: 4, owned: true, parked: false } as never as Car;
      state.cars.push(c);
      parkOwnedCarSomewhere(state, m, c);
    }
  };

  it('parks in a nearby LOT when one has a free stall', () => {
    const m = new GameMap(40, 8);
    m.built[m.idx(4, 3)] = BuiltKind.ParkingLot;
    for (let x = 1; x < 39; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const car = { x: 4, y: 4, dir: 0, tx: 4, ty: 4, owned: true, parked: false } as never as Car;
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    expect(car.lotIdx).not.toBeUndefined(); // claimed a lot stall
  });

  it('when the nearby lot is FULL, pulls over to a visible SIDE-STREET curb (not piled in the lot)', () => {
    const m = new GameMap(40, 8);
    m.built[m.idx(4, 3)] = BuiltKind.ParkingLot; // near lot
    m.built[m.idx(34, 3)] = BuiltKind.ParkingLot; // a far lot also exists
    for (let x = 1; x < 39; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet; // side street with curbs
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    fillNearLot(state, m);
    const car = { x: 6, y: 4, dir: 0, tx: 6, ty: 4, owned: true, parked: false } as never as Car;
    state.cars.push(car);
    parkOwnedCarSomewhere(state, m, car);
    expect(car.lotIdx).toBeUndefined(); // a curb, not a far lot — the nearby side street is preferred
    expect(car.curbDir).not.toBeUndefined(); // pulled to the kerb (drawn there → visible nearby)
    expect(Math.abs(Math.round(car.x) - 6)).toBeLessThanOrEqual(2); // it's RIGHT HERE, not teleported far
  });

  it('routeToParking does NOT drive when a spot is already at hand (claims in place)', () => {
    const m = new GameMap(20, 8);
    m.built[m.idx(4, 3)] = BuiltKind.ParkingLot; // a free near lot at hand
    for (let x = 1; x < 19; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    const state = createAmbientState();
    setParkingLots(state, lotInfos(m));
    const car = { x: 4, y: 4, dir: 0, tx: 4, ty: 4, owned: true, parked: false } as never as Car;
    expect(routeToParking(state, m, car)).toBe(false); // free stall adjacent → park now, don't circle
    expect(car.path).toBeUndefined();
  });
});

describe('usesCommittedPath (Maddy: looping cyclists — bike legs need committed routes too)', () => {
  it('Walk and Bike follow committed paths; transit + drive do not', () => {
    expect(usesCommittedPath(TravelMode.Walk)).toBe(true);
    expect(usesCommittedPath(TravelMode.Bike)).toBe(true); // the fix: cyclists route around barriers
    expect(usesCommittedPath(TravelMode.Streetcar)).toBe(false);
    expect(usesCommittedPath(TravelMode.ElevatedRail)).toBe(false);
    expect(usesCommittedPath(TravelMode.Drive)).toBe(false); // Drive uses the road A* (roadPath)
  });
});
