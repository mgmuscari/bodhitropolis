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
import {
  createAmbientState,
  stepAmbient,
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

// Four isolated, equal-length rows — one per road class — for the spawn-ratio pin.
function classRowsMap(): GameMap {
  const map = new GameMap(32, 16);
  for (let x = 1; x < 31; x++) {
    map.built[map.idx(x, 2)] = BuiltKind.RoadHighway;
    map.built[map.idx(x, 5)] = BuiltKind.RoadAvenue;
    map.built[map.idx(x, 8)] = BuiltKind.RoadStreet;
    map.built[map.idx(x, 11)] = BuiltKind.QuietStreet;
  }
  return map;
}

const ambientFork = (seed: string): ReturnType<typeof createRng> =>
  createRng(seed).fork('ambient');

// Fixed-seed characterization of the emergent spawn ordering (seed 'cars-order',
// 60 substeps). Locked at GREEN so a future motion/spawn tweak that changes the
// realized mix is a conscious update, not a silent drift. The load-bearing contract
// is carWeightForRoad (exact 3/2/1/0, above); this pins the integration. Droppable
// if it proves brittle — never weakened to pass.
// Re-characterized 2026-06-16: anti-loop routing (recent-tile avoidance + despawn-
// when-boxed) makes a car despawn at a dead-end row's far side instead of bouncing
// back, shifting the realized mix (was 35/12/5). The ordering contract is unchanged.
const EXPECTED_CAR_COUNTS = { hwy: 28, ave: 14, st: 5, quiet: 0 };

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

describe('car class spawn ordering (emergent, fixed-seed)', () => {
  it('realizes hwy > avenue > street > quiet = 0', () => {
    const map = classRowsMap();
    const state = createAmbientState();
    const rng = ambientFork('cars-order');
    for (let i = 0; i < 60; i++) stepAmbient(state, map, rng, 50);
    const counts = { hwy: 0, ave: 0, st: 0, quiet: 0 };
    for (const c of state.cars) {
      const k = map.built[map.idx(Math.round(c.x), Math.round(c.y))];
      if (k === BuiltKind.RoadHighway) counts.hwy++;
      else if (k === BuiltKind.RoadAvenue) counts.ave++;
      else if (k === BuiltKind.RoadStreet) counts.st++;
      else if (k === BuiltKind.QuietStreet) counts.quiet++;
    }
    expect(counts.quiet).toBe(0);
    expect(counts.hwy).toBeGreaterThan(counts.ave);
    expect(counts.ave).toBeGreaterThan(counts.st);
    expect(counts.st).toBeGreaterThan(0);
    // Characterization lock (fixed seed 'cars-order', 60 substeps) — added at GREEN.
    expect(counts).toEqual(EXPECTED_CAR_COUNTS);
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

  it('never spawns or routes a car onto the median; each lane is unidirectional', () => {
    const m = freewayH();
    const state = createAmbientState();
    const rng = ambientFork('fw-spawn');
    for (let i = 0; i < 300; i++) stepAmbient(state, m, rng, 50);
    expect(state.cars.length).toBeGreaterThan(0);
    for (const c of state.cars) {
      const row = Math.round(c.y);
      expect(row).not.toBe(6); // never on the median row
      if (row === 5) expect(c.dir).toBe(3); // north lane westbound
      if (row === 7) expect(c.dir).toBe(1); // south lane eastbound
    }
  });
});

describe('cars never enter quiet streets (movement, not just spawn)', () => {
  it('a car on a street adjacent to a quiet street never occupies the quiet tile', () => {
    const map = new GameMap(16, 8);
    for (let x = 0; x < 16; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    map.built[map.idx(8, 3)] = BuiltKind.QuietStreet; // quiet branch above the street row
    const state = createAmbientState();
    const rng = ambientFork('quiet');
    for (let i = 0; i < 200; i++) stepAmbient(state, map, rng, 50);
    for (const c of state.cars) {
      expect(Math.round(c.y)).not.toBe(3); // never on the quiet row
      const k = map.built[map.idx(Math.round(c.x), Math.round(c.y))];
      expect(k).not.toBe(BuiltKind.QuietStreet);
    }
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
