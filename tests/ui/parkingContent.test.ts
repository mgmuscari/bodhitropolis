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
    const m = new GameMap(16, 12);
    for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) m.built[m.idx(x, y)] = BuiltKind.ParkingLot; // 2x2 lot
    const lot = parkingLots(m)[0]!;
    const stalls = parkingStalls(lot);
    const per = STALLS_PER_AXIS * STALLS_PER_AXIS;
    expect(stalls.length).toBe(4 * per); // one sub-grid per tile, capacity scales with size
    const fracs = Array.from({ length: STALLS_PER_AXIS }, (_, c) => (c + 0.5) / STALLS_PER_AXIS);
    const isFrac = (v: number): boolean => fracs.some((f) => Math.abs(v - f) < 1e-9);
    for (const s of stalls) {
      expect(isFrac(s.x - Math.floor(s.x))).toBe(true);
      expect(isFrac(s.y - Math.floor(s.y))).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(lot.x0);
      expect(s.x).toBeLessThan(lot.x1 + 1);
    }
    expect(stalls.some((s) => s.x === lot.x0 + 1.0)).toBe(false); // never on a tile boundary
    expect(new Set(stalls.map((s) => `${s.x},${s.y}`)).size).toBe(4 * per); // all distinct
  });

  it('does NOT place stalls on a non-lot tile inside the bbox (Maddy: lot-flanked street)', () => {
    // An L-shaped lot whose bounding box (x2-3, y2-3) includes a NON-lot tile (3,3) — e.g. a road
    // running between two lot arms. Stalls must cover only the three real lot tiles, never (3,3).
    const m = new GameMap(12, 12);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3]] as const) m.built[m.idx(x, y)] = BuiltKind.ParkingLot;
    m.built[m.idx(3, 3)] = BuiltKind.RoadStreet; // the gap tile inside the bbox
    const lot = parkingLots(m)[0]!;
    expect(lot.tiles.length).toBe(3);
    const stalls = parkingStalls(lot);
    expect(stalls.length).toBe(3 * STALLS_PER_AXIS * STALLS_PER_AXIS); // only the 3 real tiles
    // NO stall lands in the gap tile (3,3) — cars would otherwise park in the middle of that road
    expect(stalls.some((s) => Math.floor(s.x) === 3 && Math.floor(s.y) === 3)).toBe(false);
  });
});

