import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, isRoadKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { distanceField, boxDensity, landRun } from '../../src/worldgen/fields';

describe('distanceField', () => {
  it('measures 4-connected distance from a single source', () => {
    const map = new GameMap(7, 7);
    const src = map.idx(3, 3);
    const df = distanceField(map, (i) => i === src);
    expect(df[src]).toBe(0);
    expect(df[map.idx(4, 3)]).toBe(1);
    expect(df[map.idx(3, 5)]).toBe(2);
    expect(df[map.idx(0, 0)]).toBe(6); // |3| + |3|
  });

  it('takes the minimum over multiple sources', () => {
    const map = new GameMap(9, 1);
    const s0 = map.idx(0, 0);
    const s1 = map.idx(8, 0);
    const df = distanceField(map, (i) => i === s0 || i === s1);
    expect(df[map.idx(4, 0)]).toBe(4); // min(4, 4)
    expect(df[map.idx(3, 0)]).toBe(3); // min(3, 5)
    expect(df[map.idx(5, 0)]).toBe(3); // min(5, 3)
  });

  it('leaves a fully-walled pocket unreachable (-1) under isPassable', () => {
    const map = new GameMap(5, 5);
    const src = map.idx(0, 0);
    // (4,4) is a corner; wall its only two neighbours so nothing passable reaches it.
    const blocked = new Set([map.idx(3, 4), map.idx(4, 3)]);
    const df = distanceField(map, (i) => i === src, (i) => !blocked.has(i));
    expect(df[map.idx(4, 4)]).toBe(-1); // pocket: no passable neighbour
    expect(df[map.idx(0, 4)]).toBeGreaterThan(0); // reachable elsewhere
    expect(df[map.idx(3, 4)]).toBeGreaterThan(0); // wall tile is reached but not expanded
  });

  it('reaches a passable corridor but not the far side of a wall', () => {
    const map = new GameMap(5, 5);
    const src = map.idx(0, 2);
    const wallX = 3; // entire column x=3 is non-passable, with no gap
    const df = distanceField(map, (i) => i === src, (i) => i % map.width !== wallX);
    expect(df[map.idx(2, 2)]).toBe(2); // corridor reachable
    expect(df[map.idx(3, 2)]).toBe(3); // wall tile reached (not expanded from)
    expect(df[map.idx(4, 2)]).toBe(-1); // far side only reachable through the wall
    expect(df[map.idx(4, 0)]).toBe(-1);
  });

  it('expresses road-network distance (yield point 2): road-adjacent tiles get a finite distance, off-network tiles -1', () => {
    const map = new GameMap(10, 5);
    for (let x = 0; x < 8; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
    const src = map.idx(0, 2);
    const isRoad = (i: number) => isRoadKind(map.built[i]!);
    const df = distanceField(map, (i) => i === src, isRoad);
    expect(df[map.idx(7, 2)]).toBe(7); // along the network
    expect(df[map.idx(5, 1)]).toBe(6); // road-adjacent endpoint: dist(5,2)=5, +1
    expect(df[map.idx(5, 0)]).toBe(-1); // two steps off the network, only reachable through non-road
  });
});

describe('boxDensity', () => {
  it('matches a brute-force box count on a seeded random fixture (radius 2)', () => {
    const map = new GameMap(12, 9);
    const rng = createRng('density-fixture');
    const counted = new Uint8Array(map.width * map.height);
    let total = 0;
    for (let i = 0; i < counted.length; i++) {
      counted[i] = rng.chance(0.4) ? 1 : 0;
      total += counted[i]!;
    }
    expect(total).toBeGreaterThan(0); // non-vacuous fixture

    const radius = 2;
    const sat = boxDensity(map, (i) => counted[i] === 1, radius);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        let c = 0;
        for (let yy = Math.max(0, y - radius); yy <= Math.min(map.height - 1, y + radius); yy++) {
          for (let xx = Math.max(0, x - radius); xx <= Math.min(map.width - 1, x + radius); xx++) {
            if (counted[map.idx(xx, yy)] === 1) c++;
          }
        }
        expect(sat[map.idx(x, y)]).toBe(c);
      }
    }
  });

  it('radius 0 reduces to the predicate itself', () => {
    const map = new GameMap(5, 5);
    const counted = new Set([map.idx(1, 1), map.idx(3, 4)]);
    const d = boxDensity(map, (i) => counted.has(i), 0);
    expect(d[map.idx(1, 1)]).toBe(1);
    expect(d[map.idx(3, 4)]).toBe(1);
    expect(d[map.idx(2, 2)]).toBe(0);
  });
});

describe('landRun', () => {
  it('returns the longest contiguous land run along a row with water gaps', () => {
    const map = new GameMap(13, 3);
    for (let x = 4; x <= 5; x++) map.setWater(x, 1, Water.River); // splits 0..3 and 6..12
    expect(landRun(map, 'row', 1)).toEqual([6, 12]); // 7 tiles beats 4
  });

  it('returns the full span on an all-land row', () => {
    const map = new GameMap(13, 3);
    expect(landRun(map, 'row', 0)).toEqual([0, 12]);
  });

  it('returns [-1, -1] on an all-water row', () => {
    const map = new GameMap(13, 3);
    for (let x = 0; x < 13; x++) map.setWater(x, 2, Water.Ocean);
    expect(landRun(map, 'row', 2)).toEqual([-1, -1]);
  });

  it('scans columns too', () => {
    const map = new GameMap(3, 10);
    for (let y = 0; y <= 1; y++) map.setWater(1, y, Water.Lake); // col 1: water 0..1, land 2..9
    expect(landRun(map, 'col', 1)).toEqual([2, 9]);
  });

  it('breaks ties toward the earlier run', () => {
    const map = new GameMap(7, 1);
    map.setWater(3, 0, Water.Lake); // land 0..2 and 4..6, both length 3
    expect(landRun(map, 'row', 0)).toEqual([0, 2]);
  });
});
