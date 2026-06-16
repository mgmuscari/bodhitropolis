// The origin→destination trip: the heart of the traffic sim, adapted from Micropolis's
// TrafficGen (makeTraffic → tryDrive → tryGo → driveDone). A zone finds a drivable tile
// on its frontage, then drives — choosing a non-reversing adjacent drivable tile each
// step (rng-seeded) up to MAX_TRAFFIC_DISTANCE — until a destination zone of the type it
// needs sits adjacent. The committed `path` is the deterministic datum the renderer
// animates (cars ARE trips) and the density layer is laid along.
//
// Headless + deterministic: the only randomness is the seeded `rng` direction choice;
// same map + same rng → identical path. No DOM, no transcendental Math.

import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';

/** Max road tiles a trip will traverse before giving up (Micropolis MAX_TRAFFIC_DISTANCE). */
export const MAX_TRAFFIC_DISTANCE = 30;

/** A committed origin→destination trip. `path` is road tile indices, origin-first;
 *  `origin` is -1 when the footprint has no frontage road (Micropolis "no road"). */
export interface Trip {
  origin: number;
  destination: number;
  path: number[];
  found: boolean;
}

// 4-neighbour directions, 0=N 1=E 2=S 3=W.
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** Cars cut through parking, so a trip may traverse roads (1..3) OR parking lots. */
function isDrivable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.built[map.idx(x, y)]!;
  return isRoadKind(k) || k === BuiltKind.ParkingLot;
}

/** The destination zone classes a `source` zone's trips seek (adapted: R→C|I, C→I|Civic,
 *  I→R|Civic — Civic stands in for Micropolis's Power as the third leg). */
function isDestination(source: ZoneType, target: ZoneType): boolean {
  switch (source) {
    case ZoneType.Residential:
      return target === ZoneType.Commercial || target === ZoneType.Industrial;
    case ZoneType.Commercial:
      return target === ZoneType.Industrial || target === ZoneType.Civic;
    case ZoneType.Industrial:
      return target === ZoneType.Residential || target === ZoneType.Civic;
    default:
      return false;
  }
}

/** A destination zone for `source` is 4-adjacent to (x, y)? */
function driveDone(map: GameMap, x: number, y: number, source: ZoneType): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    if (isDestination(source, zoneTypeOf(map.built[map.idx(nx, ny)]!))) return true;
  }
  return false;
}

/** First drivable tile on the frontage ring around the w×h footprint at (x0, y0), in a
 *  deterministic scan order, or -1 if the zone fronts no road/parking. */
export function findFrontageRoad(map: GameMap, x0: number, y0: number, w: number, h: number): number {
  for (let x = x0 - 1; x <= x0 + w; x++) {
    if (isDrivable(map, x, y0 - 1)) return map.idx(x, y0 - 1); // top edge
    if (isDrivable(map, x, y0 + h)) return map.idx(x, y0 + h); // bottom edge
  }
  for (let y = y0; y < y0 + h; y++) {
    if (isDrivable(map, x0 - 1, y)) return map.idx(x0 - 1, y); // left edge
    if (isDrivable(map, x0 + w, y)) return map.idx(x0 + w, y); // right edge
  }
  return -1;
}

/**
 * Generate an O-D trip for a `source`-zone parcel with footprint (x0,y0,w,h). Returns a
 * Trip: `origin < 0` = no frontage road (Micropolis -1); `found` = reached a destination
 * (+1); else not found within MAX_TRAFFIC_DISTANCE (0). Deterministic in `rng`.
 */
export function makeTrip(
  map: GameMap,
  x0: number,
  y0: number,
  w: number,
  h: number,
  source: ZoneType,
  rng: Rng,
): Trip {
  const start = findFrontageRoad(map, x0, y0, w, h);
  if (start < 0) return { origin: -1, destination: -1, path: [], found: false };
  const path = [start];
  let cx = start % map.width;
  let cy = (start - cx) / map.width;
  let lastDir = -1;
  for (let dist = 0; dist < MAX_TRAFFIC_DISTANCE; dist++) {
    if (driveDone(map, cx, cy, source)) {
      return { origin: start, destination: map.idx(cx, cy), path, found: true };
    }
    let moved = false;
    // On a FREEWAY, hold a long straight line: keep going in lastDir while it stays drivable,
    // rather than zig-zagging across the lanes (cars were "doing donuts"). No rng on a straight.
    if (lastDir >= 0 && map.built[map.idx(cx, cy)] === BuiltKind.RoadHighway) {
      const nx = cx + DX[lastDir]!;
      const ny = cy + DY[lastDir]!;
      if (isDrivable(map, nx, ny)) {
        cx = nx;
        cy = ny;
        path.push(map.idx(cx, cy)); // lastDir unchanged — straight
        moved = true;
      }
    }
    // tryGo: otherwise a non-reversing adjacent drivable tile, scanning from a random direction.
    if (!moved) {
      const startDir = rng.nextInt(4);
      const reverse = lastDir < 0 ? -1 : (lastDir + 2) % 4;
      for (let k = 0; k < 4; k++) {
        const d = (startDir + k) % 4;
        if (d === reverse) continue;
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        if (isDrivable(map, nx, ny)) {
          cx = nx;
          cy = ny;
          lastDir = d;
          path.push(map.idx(cx, cy));
          moved = true;
          break;
        }
      }
    }
    if (!moved) break; // dead end
  }
  return { origin: start, destination: -1, path, found: false };
}
