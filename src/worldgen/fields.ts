// Spatial field helpers for worldgen settlement logic.
//
// Pure, deterministic, integer/exactly-rounded only (no transcendental Math,
// no DOM — the architecture guard enforces this). Three reusable fields:
//   - distanceField — multi-source BFS, optionally constrained by passability
//     (generalizes the moisture BFS in terrain.ts into network distances)
//   - boxDensity    — per-tile counts in a square window via an integer
//     summed-area table (exact, O(n))
//   - landRun       — the longest contiguous non-water run along a row or column

import { GameMap, Water } from '../engine/map';

// 4-neighbour offsets, fixed order for deterministic BFS expansion.
const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Multi-source 4-connected BFS distance from every source tile, returning an
 * Int32Array (-1 = unreachable). `isSource(i)` seeds distance 0; expansion
 * proceeds only *through* passable tiles (`isPassable`, default: all tiles).
 *
 * A tile is assigned a distance when first reached; it is expanded from only if
 * it is passable. So a non-passable endpoint adjacent to a passable path still
 * receives a distance (the path length to it), but does not propagate. This is
 * what makes road-network distance expressible (yield point 2): with
 * `isPassable = isRoadKind∘built`, a house tile beside the road network gets
 * its network distance + 1, while a tile two steps off the network stays -1.
 */
export function distanceField(
  map: GameMap,
  isSource: (i: number) => boolean,
  isPassable: (i: number) => boolean = () => true,
): Int32Array {
  const { width, height } = map;
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (isSource(i)) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const x = i % width;
    const y = (i - x) / width;
    const nd = dist[i]! + 1;
    for (let k = 0; k < DIRS4.length; k++) {
      const nx = x + DIRS4[k]![0];
      const ny = y + DIRS4[k]![1];
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (dist[ni] !== -1) continue;
      dist[ni] = nd;
      if (isPassable(ni)) queue.push(ni);
    }
  }
  return dist;
}

/**
 * Per-tile count of `isCounted` tiles within the (2*radius+1)² box centred on
 * each tile (clamped to map bounds), via an integer summed-area table — exact
 * and O(width*height) regardless of radius.
 */
export function boxDensity(
  map: GameMap,
  isCounted: (i: number) => boolean,
  radius: number,
): Int32Array {
  const { width, height } = map;
  const w1 = width + 1;
  // sat[(y+1)*w1 + (x+1)] = count over the rectangle [0..x] x [0..y].
  const sat = new Int32Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = isCounted(map.idx(x, y)) ? 1 : 0;
      sat[(y + 1) * w1 + (x + 1)] =
        v + sat[y * w1 + (x + 1)]! + sat[(y + 1) * w1 + x]! - sat[y * w1 + x]!;
    }
  }

  const out = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = y - radius < 0 ? 0 : y - radius;
    const y1 = y + radius > height - 1 ? height - 1 : y + radius;
    for (let x = 0; x < width; x++) {
      const x0 = x - radius < 0 ? 0 : x - radius;
      const x1 = x + radius > width - 1 ? width - 1 : x + radius;
      out[map.idx(x, y)] =
        sat[(y1 + 1) * w1 + (x1 + 1)]! -
        sat[y0 * w1 + (x1 + 1)]! -
        sat[(y1 + 1) * w1 + x0]! +
        sat[y0 * w1 + x0]!;
    }
  }
  return out;
}

export type Axis = 'row' | 'col';

/**
 * The longest contiguous non-water run along row `index` (axis 'row', varying
 * x) or column `index` (axis 'col', varying y). Returns the inclusive
 * [start, end] coordinate range along the scan axis, or [-1, -1] if the line
 * is all water. Ties resolve toward the earlier (lower-coordinate) run.
 */
export function landRun(map: GameMap, axis: Axis, index: number): [number, number] {
  const len = axis === 'row' ? map.width : map.height;
  let bestStart = -1;
  let bestEnd = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let s = 0; s <= len; s++) {
    const isLand =
      s < len &&
      (axis === 'row'
        ? map.water[map.idx(s, index)] === Water.None
        : map.water[map.idx(index, s)] === Water.None);
    if (isLand) {
      if (runStart === -1) runStart = s;
    } else if (runStart !== -1) {
      const runLen = s - runStart;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
        bestEnd = s - 1;
      }
      runStart = -1;
    }
  }
  return [bestStart, bestEnd];
}
