import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, isRoadKind } from '../../src/engine/fabric';
import { ZoneType } from '../../src/engine/zone';
import { createRng } from '../../src/engine/rng';
import { findFrontageRoad, makeTrip, MAX_TRAFFIC_DISTANCE } from '../../src/traffic/trip';

const fork = () => createRng('trip-seed').fork('traffic');
const drivable = (m: GameMap, i: number) => isRoadKind(m.built[i]!) || m.built[i] === BuiltKind.ParkingLot;

describe('findFrontageRoad', () => {
  it('returns a drivable frontage tile around a footprint, or -1', () => {
    const m = new GameMap(12, 8);
    // a 1x1 R at (3,3) with a road on its south frontage
    m.built[m.idx(3, 4)] = BuiltKind.RoadStreet;
    expect(findFrontageRoad(m, 3, 3, 1, 1)).toBe(m.idx(3, 4));
    // a footprint with no adjacent drivable tile
    expect(findFrontageRoad(m, 8, 1, 1, 1)).toBe(-1);
  });
});

describe('makeTrip (origin→destination)', () => {
  function corridor(): GameMap {
    // R at (2,3); road row y=4 from x2..10; C at (10,3) fronting the road
    const m = new GameMap(16, 8);
    m.built[m.idx(2, 3)] = BuiltKind.HouseSingle;
    for (let x = 2; x <= 10; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(10, 3)] = BuiltKind.CommercialStrip;
    return m;
  }

  it('a residential zone reaches a commercial destination over a road', () => {
    const m = corridor();
    const trip = makeTrip(m, 2, 3, 1, 1, ZoneType.Residential, fork());
    expect(trip.found).toBe(true);
    expect(trip.origin).toBe(m.idx(2, 4));
    expect(trip.path.length).toBeGreaterThan(1);
    for (const i of trip.path) expect(drivable(m, i)).toBe(true); // every path tile is drivable
    // the destination tile is adjacent to the commercial parcel
    expect(trip.destination).toBe(m.idx(10, 4));
  });

  it('returns no-road (origin -1, not found) when the footprint has no frontage road', () => {
    const m = corridor();
    const trip = makeTrip(m, 13, 1, 1, 1, ZoneType.Residential, fork()); // isolated, no road
    expect(trip.origin).toBe(-1);
    expect(trip.found).toBe(false);
  });

  it('returns not-found (origin set, found false) when no destination is reachable', () => {
    // R on a road that connects only to more residential — no valid destination
    const m = new GameMap(16, 8);
    m.built[m.idx(2, 3)] = BuiltKind.HouseSingle;
    for (let x = 2; x <= 10; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(10, 3)] = BuiltKind.HouseSingle; // another R, NOT a destination for R
    const trip = makeTrip(m, 2, 3, 1, 1, ZoneType.Residential, fork());
    expect(trip.origin).toBeGreaterThanOrEqual(0);
    expect(trip.found).toBe(false);
  });

  it('respects destination mapping: residential seeks C|I, never another R', () => {
    const m = new GameMap(16, 8);
    m.built[m.idx(2, 3)] = BuiltKind.HouseSingle;
    for (let x = 2; x <= 10; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet;
    m.built[m.idx(6, 3)] = BuiltKind.HouseSingle; // R passed on the way — not a destination
    m.built[m.idx(10, 3)] = BuiltKind.Industrial; // I — a valid destination
    const trip = makeTrip(m, 2, 3, 1, 1, ZoneType.Residential, fork());
    expect(trip.found).toBe(true);
    expect(trip.destination).toBe(m.idx(10, 4)); // completed at the I, not the R
  });

  it('is deterministic: same rng → identical path through a junction', () => {
    // a +-junction so direction choice (rng) actually matters
    const m = new GameMap(16, 16);
    m.built[m.idx(2, 8)] = BuiltKind.HouseSingle;
    for (let x = 2; x <= 8; x++) m.built[m.idx(x, 9)] = BuiltKind.RoadStreet; // west arm
    for (let y = 2; y <= 14; y++) m.built[m.idx(8, y)] = BuiltKind.RoadStreet; // cross street
    m.built[m.idx(8, 2)] = BuiltKind.CommercialStrip;
    m.built[m.idx(8, 14)] = BuiltKind.Industrial;
    const a = makeTrip(m, 2, 8, 1, 1, ZoneType.Residential, fork());
    const b = makeTrip(m, 2, 8, 1, 1, ZoneType.Residential, fork());
    expect(a.path).toEqual(b.path);
    expect(a.found).toBe(b.found);
  });

  it('never drives further than MAX_TRAFFIC_DISTANCE', () => {
    const m = new GameMap(64, 8);
    m.built[m.idx(2, 3)] = BuiltKind.HouseSingle;
    for (let x = 2; x < 60; x++) m.built[m.idx(x, 4)] = BuiltKind.RoadStreet; // long dead-straight road, no dest
    const trip = makeTrip(m, 2, 3, 1, 1, ZoneType.Residential, fork());
    expect(trip.found).toBe(false);
    expect(trip.path.length).toBeLessThanOrEqual(MAX_TRAFFIC_DISTANCE + 1);
  });
});

describe('freeway pathing bias (long straight movements, no donuts)', () => {
  it('a trip across a wide freeway holds a long straight run instead of zig-zagging lanes', () => {
    const map = new GameMap(28, 9);
    for (let y = 3; y <= 5; y++) for (let x = 2; x <= 20; x++) map.built[map.idx(x, y)] = BuiltKind.RoadHighway; // 3-wide freeway
    map.built[map.idx(1, 4)] = BuiltKind.HouseSingle; // origin
    map.built[map.idx(21, 4)] = BuiltKind.CommercialStrip; // destination at the far end
    const trip = makeTrip(map, 1, 4, 1, 1, ZoneType.Residential, createRng('fw').fork('t'));
    expect(trip.found).toBe(true);
    let maxRun = 1;
    let run = 1;
    let prevDir = -1;
    for (let i = 1; i < trip.path.length; i++) {
      const px = trip.path[i - 1]! % map.width;
      const py = Math.floor(trip.path[i - 1]! / map.width);
      const cx = trip.path[i]! % map.width;
      const cy = Math.floor(trip.path[i]! / map.width);
      const dir = cx > px ? 1 : cx < px ? 3 : cy > py ? 2 : 0;
      if (dir === prevDir) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 1;
      }
      prevDir = dir;
    }
    expect(maxRun).toBeGreaterThanOrEqual(12); // a long straight freeway run, not lane donuts
  });
});
