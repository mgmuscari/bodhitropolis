import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { wideRoadAt, powerPoleAt, poleWireDirs } from '../../src/ui/decoration';

// --- Fixture helpers: write tiles directly into a bare GameMap. ---
function hline(map: GameMap, kind: number, y: number, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x++) map.built[map.idx(x, y)] = kind;
}
function vline(map: GameMap, kind: number, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) map.built[map.idx(x, y)] = kind;
}
function band(map: GameMap, kind: number, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.built[map.idx(x, y)] = kind;
}

describe('wideRoadAt: 2x2-block road predicate', () => {
  it('is true for every tile of a 2-row avenue band', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 10, 5, 6); // rows 5,6
    for (let y = 5; y <= 6; y++) {
      for (let x = 2; x <= 10; x++) {
        expect(wideRoadAt(map, x, y), `(${x},${y}) should be wide`).toBe(true);
      }
    }
  });

  it('is false for every tile of a single 1-wide row', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 2, 12);
    for (let x = 2; x <= 12; x++) expect(wideRoadAt(map, x, 5)).toBe(false);
  });

  it('is false at the center of a + of two 1-wide roads (diagonal not road)', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 8, 2, 14);
    vline(map, BuiltKind.RoadAvenue, 8, 2, 14);
    expect(wideRoadAt(map, 8, 8)).toBe(false); // intersection center
    expect(wideRoadAt(map, 7, 8)).toBe(false); // arm tile
  });

  it('is true for middle and edge rows of a 3-row band', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadHighway, 2, 12, 5, 7); // rows 5,6,7
    expect(wideRoadAt(map, 7, 6)).toBe(true); // middle row interior
    expect(wideRoadAt(map, 7, 5)).toBe(true); // edge row
    expect(wideRoadAt(map, 7, 7)).toBe(true); // far edge row
    expect(wideRoadAt(map, 2, 5)).toBe(true); // band corner
  });

  it('is false for a non-road tile and out of bounds', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 10, 5, 6);
    map.built[map.idx(4, 9)] = BuiltKind.HouseSingle; // a building tile
    expect(wideRoadAt(map, 4, 9)).toBe(false);
    expect(wideRoadAt(map, 0, 0)).toBe(false); // empty tile
    expect(wideRoadAt(map, -1, 5)).toBe(false); // out of bounds
  });
});

describe('powerPoleAt: street/avenue poles at spacing 4', () => {
  it('is true at x%4==0 along a horizontal avenue, false elsewhere on the row', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 0, 12);
    for (let x = 0; x <= 12; x++) {
      const expected = x % 4 === 0;
      expect(powerPoleAt(map, x, 5), `(${x},5) pole=${expected}`).toBe(expected);
    }
  });

  it('is false on a RoadHighway tile (highway carries no street poles)', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadHighway, 5, 0, 12);
    for (let x = 0; x <= 12; x++) expect(powerPoleAt(map, x, 5)).toBe(false);
  });

  it('is false on empty land, water, rail, and building tiles', () => {
    const map = new GameMap(16, 16);
    map.built[map.idx(4, 4)] = BuiltKind.Rail;
    map.built[map.idx(8, 4)] = BuiltKind.HouseSingle;
    map.water[map.idx(0, 8)] = Water.Ocean;
    expect(powerPoleAt(map, 0, 0)).toBe(false); // empty
    expect(powerPoleAt(map, 0, 8)).toBe(false); // water
    expect(powerPoleAt(map, 4, 4)).toBe(false); // rail
    expect(powerPoleAt(map, 8, 4)).toBe(false); // building
  });

  it('uses the vertical rule (y%4==0) for a vertical street run', () => {
    const map = new GameMap(16, 16);
    vline(map, BuiltKind.RoadStreet, 5, 0, 12);
    for (let y = 0; y <= 12; y++) {
      const expected = y % 4 === 0;
      expect(powerPoleAt(map, 5, y), `(5,${y}) pole=${expected}`).toBe(expected);
    }
  });

  it('is false on an isolated road tile (no road neighbour)', () => {
    const map = new GameMap(16, 16);
    map.built[map.idx(4, 4)] = BuiltKind.RoadAvenue; // (4,4): would be x%4==0 but isolated
    expect(powerPoleAt(map, 4, 4)).toBe(false);
  });

  it('is deterministic (two calls equal)', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 0, 12);
    expect(powerPoleAt(map, 4, 5)).toBe(powerPoleAt(map, 4, 5));
  });
});

describe('poleWireDirs: E/S wire segments toward same-run neighbours', () => {
  it('returns [[1,0]] for a pole on a horizontal run with no S neighbour', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 0, 12);
    expect(poleWireDirs(map, 4, 5)).toEqual([[1, 0]]);
  });

  it('returns [[1,0],[0,1]] at a junction with both an E and an S road run', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 4, 0, 12); // horizontal run through y=4
    vline(map, BuiltKind.RoadAvenue, 4, 4, 12); // vertical run going S from (4,4)
    // (4,4) is a pole: horizontal rule, x=4%4==0; has E neighbour (5,4) and S (4,5).
    expect(poleWireDirs(map, 4, 4)).toEqual([[1, 0], [0, 1]]);
  });

  it('returns [] where powerPoleAt is false', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 0, 12);
    expect(poleWireDirs(map, 3, 5)).toEqual([]); // not a pole (3%4!=0)
    expect(poleWireDirs(map, 0, 0)).toEqual([]); // empty tile
  });
});

// --- Exact-set integration over a worldgen-shaped fixture (YP4). ---
// A straight 1-wide street grid (one + intersection), an isolated 2-row avenue
// band, and an isolated 3-row highway band — separated by gaps so the asserted
// sets stay clean (the PRP-sanctioned "isolate the bands" option; the mixed-kind
// boundary is covered separately below). Asserts the COMPLETE wideRoadAt set ==
// exactly the band tiles (every grid + intersection excluded) and the COMPLETE
// powerPoleAt set == exactly the expected street/avenue poles (highway excluded).
describe('decoration predicates compose over a worldgen-shaped fixture (exact sets)', () => {
  function makeFixture(): GameMap {
    const map = new GameMap(24, 24);
    hline(map, BuiltKind.RoadStreet, 2, 2, 14); // H1
    vline(map, BuiltKind.RoadStreet, 8, 2, 6); // V1 (crosses H1 at (8,2))
    band(map, BuiltKind.RoadAvenue, 2, 14, 10, 11); // 2-row avenue band
    band(map, BuiltKind.RoadHighway, 2, 14, 15, 17); // 3-row highway band
    return map;
  }
  const key = (x: number, y: number): string => `${x},${y}`;

  it('wideRoadAt set is exactly the avenue + highway band tiles', () => {
    const map = makeFixture();
    const expected = new Set<string>();
    for (let y = 10; y <= 11; y++) for (let x = 2; x <= 14; x++) expected.add(key(x, y));
    for (let y = 15; y <= 17; y++) for (let x = 2; x <= 14; x++) expected.add(key(x, y));

    const actual = new Set<string>();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (wideRoadAt(map, x, y)) actual.add(key(x, y));
    }
    expect(actual).toEqual(expected);
    // Explicit: the grid + intersection at (8,2) is NOT wide.
    expect(wideRoadAt(map, 8, 2)).toBe(false);
  });

  it('powerPoleAt set is exactly the expected street/avenue poles (highway excluded)', () => {
    const map = makeFixture();
    const expected = new Set<string>([
      // H1 (y=2): x=4,8,12
      key(4, 2), key(8, 2), key(12, 2),
      // V1 (x=8): the vertical-rule pole at y=4
      key(8, 4),
      // Avenue band rows 10,11: x=4,8,12
      key(4, 10), key(8, 10), key(12, 10),
      key(4, 11), key(8, 11), key(12, 11),
    ]);

    const actual = new Set<string>();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (powerPoleAt(map, x, y)) actual.add(key(x, y));
    }
    expect(actual).toEqual(expected);
    // Explicit: no pole anywhere on the highway band.
    for (let y = 15; y <= 17; y++) for (let x = 2; x <= 14; x++) expect(powerPoleAt(map, x, y)).toBe(false);
  });
});

// --- Deliberate mixed-kind boundary case (YP4 residual). ---
// A 1-wide street running parallel-adjacent to a 2-row avenue band completes a
// 2x2 of road tiles and so legitimately reads `wide` — correct isRoadKind-based
// behaviour (a 2x2 of road tiles regardless of kind mix), NOT a bug. Pinned here
// so a future reader does not mistake the isolated-band fixture above for full
// mixed-kind-boundary coverage. The cosmetic visual is left to the live pass.
describe('wideRoadAt mixed-kind boundary (street abutting an avenue band reads wide)', () => {
  it('a street tile adjacent to a 2-row avenue band is wide (correct, not a bug)', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 8, 5, 6); // avenue band rows 5,6
    hline(map, BuiltKind.RoadStreet, 4, 2, 8); // street row 4, directly above row 5
    // (3,4) completes 2x2 {(3,4),(4,4),(3,5),(4,5)} = street,street,avenue,avenue.
    expect(wideRoadAt(map, 3, 4)).toBe(true);
  });
});
