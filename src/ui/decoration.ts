// Pure render-decoration predicates: the DECISION half of the renderer's wide-body
// slab + power-line decoration pass. Each is a deterministic function of (map, x, y)
// alone — DOM-free and transcendental-Math-free, so the renderer shell (renderer.ts)
// holds ZERO branching of its own and these can be headless-tested over GameMap
// fixtures. On the architecture pure-ui allowlist (tests/architecture.test.ts).

import type { GameMap } from '../engine/map';
import { isRoadKind, BuiltKind } from '../engine/fabric';

/** Power poles fall every Nth tile along a street/avenue run. */
const POLE_SPACING = 4;

/** True iff (x, y) is in-bounds and holds a road kind (street/avenue/highway). */
function roadAt(map: GameMap, x: number, y: number): boolean {
  return map.inBounds(x, y) && isRoadKind(map.getBuilt(x, y));
}

/**
 * True iff the tile at (x, y) is a road (isRoadKind) AND is a member of at least
 * one 2×2 block of all-road tiles. Checks the four 2×2 squares that include (x, y)
 * — the four diagonal sign combos — counting a square only if all four cells are
 * in-bounds road tiles. Orientation-free: true for interior/edge tiles of a 2-row
 * or 3-row corridor, false for a 1-wide road and for a `+` of two 1-wide roads (the
 * diagonal cell is not road). Mixed road kinds count (it is a 2×2 of road tiles
 * regardless of which road kind each cell holds).
 */
export function wideRoadAt(map: GameMap, x: number, y: number): boolean {
  if (!roadAt(map, x, y)) return false;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      if (roadAt(map, x + sx, y) && roadAt(map, x, y + sy) && roadAt(map, x + sx, y + sy)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True iff a power pole falls on the tile at (x, y): the tile must be a RoadStreet
 * or RoadAvenue (NOT highway, NOT rail/transit, NOT building/empty/water), and the
 * pole spacing must land here. A tile with an E or W road neighbour runs
 * horizontally → pole iff x % POLE_SPACING === 0; else a tile with an N or S road
 * neighbour runs vertically → pole iff y % POLE_SPACING === 0; an isolated road
 * tile carries no pole. Deterministic in (map, x, y) only.
 */
export function powerPoleAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const self = map.getBuilt(x, y);
  if (self !== BuiltKind.RoadStreet && self !== BuiltKind.RoadAvenue) return false;
  if (roadAt(map, x + 1, y) || roadAt(map, x - 1, y)) return x % POLE_SPACING === 0;
  if (roadAt(map, x, y + 1) || roadAt(map, x, y - 1)) return y % POLE_SPACING === 0;
  return false; // isolated road tile
}

/**
 * The wire segments to draw from a pole at (x, y): the subset of {[1,0], [0,1]}
 * (E, S) whose neighbour is a road tile of the same run. The renderer shell just
 * draws a segment toward each returned offset — this is the ONLY wire decision, so
 * the shell holds no branching logic. Empty when {@link powerPoleAt} is false.
 */
export function poleWireDirs(map: GameMap, x: number, y: number): ReadonlyArray<readonly [number, number]> {
  if (!powerPoleAt(map, x, y)) return [];
  const out: Array<readonly [number, number]> = [];
  if (roadAt(map, x + 1, y)) out.push([1, 0]);
  if (roadAt(map, x, y + 1)) out.push([0, 1]);
  return out;
}
