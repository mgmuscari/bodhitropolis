import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { parkingLots, parkingStalls, STALLS_PER_AXIS } from '../../src/ui/parkingContent';

describe('parkingLots (one 1x1 lot per ParkingLot tile)', () => {
  it('makes each ParkingLot tile its own 1x1 lot (a contiguous block = many 1x1 lots)', () => {
    const m = new GameMap(16, 12);
    for (let y = 3; y <= 4; y++) for (let x = 5; x <= 6; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    const lots = parkingLots(m);
    expect(lots.length).toBe(4); // a 2x2 block of lot tiles = four 1x1 lots
    for (const lot of lots) {
      expect(lot.x0).toBe(lot.x1); // each lot is a single tile (box can never spill onto a non-lot tile)
      expect(lot.y0).toBe(lot.y1);
      expect(lot.tiles.length).toBe(1);
    }
  });

  it('makes a lot only on actual ParkingLot tiles — a road between lots is never a lot', () => {
    const m = new GameMap(12, 8);
    m.built[m.idx(3, 3)] = BuiltKind.ParkingLot;
    m.built[m.idx(5, 3)] = BuiltKind.ParkingLot; // a lot on each side of a road at x=4
    m.built[m.idx(4, 3)] = BuiltKind.RoadStreet;
    const lots = parkingLots(m);
    expect(lots.length).toBe(2);
    expect(lots.some((l) => l.x0 === 4)).toBe(false); // the road tile is NOT a lot → no stalls there
  });
});

describe('parkingStalls (per-tile, tile-aligned grid)', () => {
  it('places a clean sub-grid in each lot tile, aligned within the tile (never on a boundary)', () => {
    const m = new GameMap(16, 12);
    for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    const lots = parkingLots(m); // four 1x1 lots
    const per = STALLS_PER_AXIS * STALLS_PER_AXIS;
    const stalls = lots.flatMap((l) => parkingStalls(l));
    expect(lots.length).toBe(4);
    lots.forEach((l) => expect(parkingStalls(l).length).toBe(per)); // 9 stalls per lot tile
    const fracs = Array.from({ length: STALLS_PER_AXIS }, (_, c) => (c + 0.5) / STALLS_PER_AXIS);
    const isFrac = (v: number): boolean => fracs.some((f) => Math.abs(v - f) < 1e-9);
    for (const s of stalls) {
      expect(isFrac(s.x - Math.floor(s.x))).toBe(true); // a clean sub-cell offset, never a tile boundary
      expect(isFrac(s.y - Math.floor(s.y))).toBe(true);
    }
    expect(new Set(stalls.map((s) => `${s.x},${s.y}`)).size).toBe(4 * per); // all distinct across the block
  });

  it('never places a stall on a non-lot tile near a lot arm (Maddy: lot-flanked street)', () => {
    // Three lot tiles forming an L around a road at (3,3). With per-tile lots, the gap is simply not a
    // lot, so NO lot's stalls can ever land on it (the old bbox-spill class is gone by construction).
    const m = new GameMap(12, 12);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3]] as const) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    m.built[m.idx(3, 3)] = BuiltKind.RoadStreet; // the gap tile
    const lots = parkingLots(m);
    expect(lots.length).toBe(3); // three 1x1 lots
    const allStalls = lots.flatMap((l) => parkingStalls(l));
    expect(allStalls.length).toBe(3 * STALLS_PER_AXIS * STALLS_PER_AXIS);
    expect(allStalls.some((s) => Math.floor(s.x) === 3 && Math.floor(s.y) === 3)).toBe(false);
  });
});

