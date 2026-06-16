// The traffic-density field: a smeared, decaying load laid along origin→destination
// trip paths and read by zone growth (busy/quiet) and (later) by ecology suppression.
// Stored full-resolution on `GameMap.traffic` (0..255) so it folds into the world
// snapshot/hash automatically. Headless + deterministic: integer adds, stepped decay,
// no rng, no transcendental Math.

import type { GameMap } from '../engine/map';

/** Cap on a cell's traffic density (Micropolis trfDensity caps ~240). */
export const TRAFFIC_MAX = 240;
/** Density added to each tile of a successful trip's path. */
export const TRAFFIC_LAY = 50;

/** Add `amount` of traffic to every tile index in `path`, saturating at TRAFFIC_MAX.
 *  `path` tiles are road tiles produced by the O-D pathfinder. */
export function layTraffic(map: GameMap, path: readonly number[], amount: number = TRAFFIC_LAY): void {
  const t = map.traffic;
  for (const i of path) {
    const z = t[i]! + amount;
    t[i] = z > TRAFFIC_MAX ? TRAFFIC_MAX : z;
  }
}

/** Decay all traffic one cycle toward zero (Micropolis stepped decay: a heavy band
 *  sheds faster, a light band clears to zero). Integer, deterministic. */
export function decayTraffic(map: GameMap): void {
  const t = map.traffic;
  for (let i = 0; i < t.length; i++) {
    const z = t[i]!;
    if (z === 0) continue;
    if (z > 200) t[i] = z - 34;
    else if (z > 24) t[i] = z - 24;
    else t[i] = 0;
  }
}
