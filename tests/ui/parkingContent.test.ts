import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { parkingLots, parkingStalls, lotOccupancy, LOT_CAPACITY } from '../../src/ui/parkingContent';

describe('parkingLots (connected ParkingLot components)', () => {
  it('finds one component for a contiguous block, with its bounding box', () => {
    const m = new GameMap(16, 12);
    for (let y = 3; y <= 4; y++) for (let x = 5; x <= 6; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    const lots = parkingLots(m);
    expect(lots.length).toBe(1);
    expect(lots[0]).toMatchObject({ x0: 5, y0: 3, x1: 6, y1: 4 });
    expect(lots[0]!.tiles.length).toBe(4);
  });

  it('separates two disconnected lots', () => {
    const m = new GameMap(20, 12);
    for (let y = 2; y <= 3; y++) for (let x = 2; x <= 3; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    for (let y = 8; y <= 9; y++) for (let x = 14; x <= 15; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    expect(parkingLots(m).length).toBe(2);
  });
});

describe('parkingStalls (capacity-9 grid layout)', () => {
  it('returns 9 stall centres in a 3x3 grid inside the lot bbox', () => {
    const lot = { x0: 4, y0: 4, x1: 7, y1: 7, tiles: [] };
    const stalls = parkingStalls(lot);
    expect(stalls.length).toBe(LOT_CAPACITY);
    expect(LOT_CAPACITY).toBe(9);
    for (const s of stalls) {
      expect(s.x).toBeGreaterThanOrEqual(lot.x0);
      expect(s.x).toBeLessThanOrEqual(lot.x1 + 1);
      expect(s.y).toBeGreaterThanOrEqual(lot.y0);
      expect(s.y).toBeLessThanOrEqual(lot.y1 + 1);
    }
    // distinct positions laid out in a grid (3 unique x, 3 unique y)
    expect(new Set(stalls.map((s) => s.x)).size).toBe(3);
    expect(new Set(stalls.map((s) => s.y)).size).toBe(3);
  });
});

describe('lotOccupancy (how full a lot reads, from local demand)', () => {
  it('is zero for a lot with no neighbouring buildings', () => {
    const m = new GameMap(16, 12);
    for (let y = 5; y <= 6; y++) for (let x = 5; x <= 6; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    const lot = parkingLots(m)[0]!;
    expect(lotOccupancy(m, lot)).toBe(0);
  });

  it('fills (capped at capacity) when ringed by buildings', () => {
    const m = new GameMap(16, 12);
    for (let y = 5; y <= 6; y++) for (let x = 5; x <= 6; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    // ring the 2x2 lot with apartments
    for (let x = 4; x <= 7; x++) {
      m.built[m.idx(x, 4)] = BuiltKind.Apartments;
      m.built[m.idx(x, 7)] = BuiltKind.Apartments;
    }
    for (let y = 5; y <= 6; y++) {
      m.built[m.idx(4, y)] = BuiltKind.Apartments;
      m.built[m.idx(7, y)] = BuiltKind.Apartments;
    }
    const lot = parkingLots(m)[0]!;
    const occ = lotOccupancy(m, lot);
    expect(occ).toBeGreaterThan(0);
    expect(occ).toBeLessThanOrEqual(LOT_CAPACITY);
  });
});
