// Parked-car visualization (cosmetic, pure, allowlisted): connected ParkingLot
// components, their capacity-9 stall grid, and how full each reads from local demand.
// The renderer draws `lotOccupancy` parked cars at the first stalls, so the over-paved
// city's accumulated parking is visibly USED (stalls fill where buildings cluster).
// Reads the map only — no DOM, no rng, no transcendental Math; stable per map (a 3x3
// grid + a building-adjacency count) so parked cars don't flicker.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';

/** A parking lot stalls up to this many cars, laid out as a 3x3 grid. */
export const LOT_CAPACITY = 9;

/** A connected ParkingLot component and its bounding box. */
export interface Lot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: number[];
}

/** All 4-connected ParkingLot components on the map, each with its bounding box. */
export function parkingLots(map: GameMap): Lot[] {
  const lots: Lot[] = [];
  const seen = new Uint8Array(map.width * map.height);
  const isPark = (x: number, y: number): boolean =>
    map.inBounds(x, y) && map.built[map.idx(x, y)] === BuiltKind.ParkingLot;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i0 = map.idx(x, y);
      if (seen[i0] || map.built[i0] !== BuiltKind.ParkingLot) continue;
      const tiles: number[] = [];
      const stack: Array<[number, number]> = [[x, y]];
      seen[i0] = 1;
      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        tiles.push(map.idx(cx, cy));
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (isPark(nx, ny) && !seen[map.idx(nx, ny)]) {
            seen[map.idx(nx, ny)] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      lots.push({ x0, y0, x1, y1, tiles });
    }
  }
  return lots;
}

/** Up to LOT_CAPACITY stall centres, a 3x3 grid evenly spaced over the lot's bounding
 *  box, in WORLD tile coordinates (pass straight to camera.worldToScreen). Row-major,
 *  so the first N fill top-left first. */
export function parkingStalls(lot: Lot): Array<{ x: number; y: number }> {
  const w = lot.x1 - lot.x0 + 1;
  const h = lot.y1 - lot.y0 + 1;
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({ x: lot.x0 + ((c + 0.5) * w) / 3, y: lot.y0 + ((r + 0.5) * h) / 3 });
    }
  }
  return out;
}

/** Radius (Chebyshev) around a lot's bbox over which nearby demand is counted. */
const DEMAND_RADIUS = 2;

/** How many stalls read as occupied (0..LOT_CAPACITY), from the demand the lot serves:
 *  the count of DEMAND-zone tiles (R/C/I/Civic, via zoneTypeOf — NOT parking/greens/
 *  roads) within DEMAND_RADIUS of the lot's bounding box, capped at capacity. A lot in
 *  a built block fills; an isolated fringe lot stays empty. Stable per map — no flicker. */
export function lotOccupancy(map: GameMap, lot: Lot): number {
  let demand = 0;
  for (let y = lot.y0 - DEMAND_RADIUS; y <= lot.y1 + DEMAND_RADIUS; y++) {
    for (let x = lot.x0 - DEMAND_RADIUS; x <= lot.x1 + DEMAND_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (zoneTypeOf(map.built[map.idx(x, y)]!) !== ZoneType.None) demand++;
    }
  }
  return demand > LOT_CAPACITY ? LOT_CAPACITY : demand;
}
