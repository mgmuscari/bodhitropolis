import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, hashWorld } from '../../src/engine/fabric';
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
import { parkingLots, parkingStalls } from '../../src/ui/parkingContent';
import { StopCategory } from '../../src/citizens/itinerary';
import {
  createAmbientState,
  stepAmbient,
  ingestTrips,
  setParkingLots,
  setHouseholds,
  curbParkOffset,
  isWearable,
  seedBlight,
  carWeightForRoad,
  isCarRoad,
  isPedSubstrate,
  birdSpawnAt,
  nextRoadStep,
  laneOffset,
  freewayLane,
  AMBIENT_MAX_FRAME_MS,
} from '../../src/ui/ambientContent';

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

describe('freewayLane (divided multi-lane roads — outer one-way, middle median)', () => {
  // Maddy playtest: "each tile is bidirectional in the length of the freeway. the two
  // outer tiles should be unidirectional, and turns should only be possible at a true
  // junction." A widened road is a divided highway: two one-way outer carriageways
  // (right-hand traffic) and a median (no traffic) in the middle of a 3+-wide road.
  it('classifies the two outer lanes one-way (opposite) and the middle as median', () => {
    const m = freewayH();
    // outward edge is the non-road side; dir is the right-hand-traffic heading.
    expect(freewayLane(m, 10, 5)).toEqual({ role: 'outer', dir: 3, outward: 0 }); // north lane → West
    expect(freewayLane(m, 10, 6)).toEqual({ role: 'median' });
    expect(freewayLane(m, 10, 7)).toEqual({ role: 'outer', dir: 1, outward: 2 }); // south lane → East
  });

  it('classifies a vertical freeway: west lane south, east lane north', () => {
    const m = new GameMap(14, 20);
    for (let y = 0; y < 20; y++) {
      m.built[m.idx(5, y)] = BuiltKind.RoadHighway;
      m.built[m.idx(6, y)] = BuiltKind.RoadHighway;
      m.built[m.idx(7, y)] = BuiltKind.RoadHighway;
    }
    expect(freewayLane(m, 5, 10)).toEqual({ role: 'outer', dir: 2, outward: 3 }); // west lane → South
    expect(freewayLane(m, 6, 10)).toEqual({ role: 'median' });
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

  it('respects lot capacity: never stores more LOT cars than the lot has stalls', () => {
    const { map, path } = roadWithLot();
    const lots = lotInfo(map);
    const capacity = lots[0]!.stalls.length; // per-tile grid → scales with lot size
    const state = createAmbientState();
    setParkingLots(state, lots);
    ingestTrips(state, Array.from({ length: capacity + 8 }, () => ({ path })), map);
    const rng = ambientFork('cap');
    let maxLotParked = 0;
    for (let i = 0; i < 200; i++) {
      stepAmbient(state, map, rng, 50);
      const lotParked = state.cars.filter((c) => c.parked && c.lotIdx !== undefined).length;
      maxLotParked = Math.max(maxLotParked, lotParked);
    }
    expect(maxLotParked).toBeGreaterThan(0);
    expect(maxLotParked).toBeLessThanOrEqual(capacity); // one car per stall; extras street-park
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

  it('crowding: a second car to the same destination parks at a different (farther) curb', () => {
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
    const tiles = new Set(parked.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`));
    expect(tiles.size).toBe(2); // the crowded-out car parked on a different curb tile
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

  it('seedBlight starts the city degraded — trampled urban ground + polluted shores', () => {
    const map = new GameMap(16, 16);
    for (let x = 4; x <= 8; x++) map.built[map.idx(x, 6)] = BuiltKind.RoadStreet; // a street pair
    for (let x = 4; x <= 8; x++) map.built[map.idx(x, 8)] = BuiltKind.RoadStreet; // with an empty gap at y=7
    for (let y = 0; y < 16; y++) map.water[map.idx(12, y)] = 1; // a shoreline
    map.built[map.idx(11, 6)] = BuiltKind.RoadStreet; // urban tile on the shore
    const state = createAmbientState();
    seedBlight(state, map);
    expect(state.wear.get(map.idx(6, 7)) ?? 0).toBeGreaterThan(0); // hemmed-in gap is pre-trampled
    expect(state.waterPollution.get(map.idx(12, 6)) ?? 0).toBeGreaterThan(0); // shore pre-polluted
    expect(state.wear.get(map.idx(0, 0)) ?? 0).toBe(0); // open wild ground starts clean/green
  });

  it('seedBlight precomputes home wellbeing from nearby plots (good → positive, industry → negative)', () => {
    const map = new GameMap(24, 16);
    map.built[map.idx(5, 5)] = BuiltKind.HouseSingle; // a home by a healing commons
    map.built[map.idx(5, 7)] = BuiltKind.HealingCommons;
    map.built[map.idx(16, 5)] = BuiltKind.HouseSingle; // a home by heavy industry
    map.built[map.idx(16, 7)] = BuiltKind.Industrial;
    const state = createAmbientState();
    seedBlight(state, map);
    expect(state.buildingHealth.get(map.idx(5, 5))!).toBeGreaterThan(0); // starts healthy
    expect(state.buildingHealth.get(map.idx(16, 5))!).toBeLessThan(0); // starts blighted
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
});
