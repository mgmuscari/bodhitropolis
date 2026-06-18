import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { parkingLots, parkingStalls, STALLS_PER_AXIS } from '../../src/ui/parkingContent';

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

describe('parkingStalls (per-tile, tile-aligned grid)', () => {
  it('places a clean sub-grid in EVERY tile, aligned within each tile (no offset on multi-tile lots)', () => {
    const lot = { x0: 4, y0: 4, x1: 5, y1: 5, tiles: [] }; // a 2x2 lot — the buggy case
    const stalls = parkingStalls(lot);
    const per = STALLS_PER_AXIS * STALLS_PER_AXIS;
    expect(stalls.length).toBe(4 * per); // one sub-grid per tile, capacity scales with size
    // Valid tile-relative sub-positions: (c + 0.5) / STALLS_PER_AXIS for each axis cell.
    const fracs = Array.from({ length: STALLS_PER_AXIS }, (_, c) => (c + 0.5) / STALLS_PER_AXIS);
    const isFrac = (v: number): boolean => fracs.some((f) => Math.abs(v - f) < 1e-9);
    for (const s of stalls) {
      const fx = s.x - Math.floor(s.x);
      const fy = s.y - Math.floor(s.y);
      expect(isFrac(fx)).toBe(true);
      expect(isFrac(fy)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(lot.x0);
      expect(s.x).toBeLessThan(lot.x1 + 1);
      expect(s.y).toBeGreaterThanOrEqual(lot.y0);
      expect(s.y).toBeLessThan(lot.y1 + 1);
    }
    // the offset bug: stalls used to land on 1.0 (a tile boundary) for a 2-wide lot
    expect(stalls.some((s) => s.x === lot.x0 + 1.0)).toBe(false);
    expect(new Set(stalls.map((s) => `${s.x},${s.y}`)).size).toBe(4 * per); // all distinct
  });
});

