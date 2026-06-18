// Parking-lot geometry (cosmetic, pure, allowlisted): the connected ParkingLot components
// and the per-tile stall grid the ambient layer stores parked cars on. Reads the map only —
// no DOM, no rng, no transcendental Math; stable per map so parked cars don't flicker.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';

/** Stalls per lot TILE per axis: a STALLS_PER_AXIS×STALLS_PER_AXIS grid in every tile, so
 *  cars pack cleanly and tile-aligned on lots of ANY size (capacity = this² × tile count).
 *  3 → a 3×3 = 9-car grid per tile (a single-tile lot holds + shows up to 9, not 4). */
export const STALLS_PER_AXIS = 3;

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

/** Stall centres in WORLD tile coordinates (pass straight to camera.worldToScreen): a
 *  STALLS_PER_AXIS×STALLS_PER_AXIS sub-grid inside EVERY tile of the lot's bounding box,
 *  each stall at the same fractional offset within its tile so cars pack cleanly and
 *  tile-aligned regardless of lot size. Row-major over tiles, then over each tile's grid. */
export function parkingStalls(lot: Lot): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let ty = lot.y0; ty <= lot.y1; ty++) {
    for (let tx = lot.x0; tx <= lot.x1; tx++) {
      for (let r = 0; r < STALLS_PER_AXIS; r++) {
        for (let c = 0; c < STALLS_PER_AXIS; c++) {
          out.push({ x: tx + (c + 0.5) / STALLS_PER_AXIS, y: ty + (r + 0.5) / STALLS_PER_AXIS });
        }
      }
    }
  }
  return out;
}
