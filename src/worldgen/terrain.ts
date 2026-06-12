// Worldgen stage 1: terrain.
//
// Elevation-first generation modernizing the Micropolis MapGenerator feel
// (meandering water, organic forest edges) with deterministic, reproducible
// output. Pipeline of sub-steps, each a pure-ish function over the map:
//   1. elevation  — fBm height field, normalized to [0, 1]
//   2. water       — below-sea cells; flood-fill from edges => Ocean, else Lake
//   3. rivers      — springs from the top elevation quartile walk steepest-
//                    descent with momentum, carving River, until they reach
//                    water / the map edge / a local minimum (filled to Lake)
//   4. moisture    — rational distance-to-water falloff, blended with fBm
//   5. land cover  — moisture thresholds with rng dithering for organic edges
//
// Determinism design rule (load-bearing): only integer math, Math.imul/floor/
// min/max/abs/sqrt and exactly-rounded float ops. No transcendental Math —
// the moisture falloff is rational (1/(1+k*d)), not exponential.

import { GameMap, Water, LandCover } from '../engine/map';
import type { Rng } from '../engine/rng';
import { fbm, type FbmParams } from './noise';
import type { WorldgenStage } from './pipeline';

export interface TerrainParams {
  /** Elevation below this (normalized) is water. */
  seaLevel: number;
  /** Number of river springs drawn from the top elevation quartile. */
  springCount: number;
  /** Moisture at/above this becomes Forest. */
  forestMoisture: number;
  /** Moisture at/above this (but below forest) becomes Grass; below is Meadow. */
  grassMoisture: number;
  /** Tiles per noise unit for the elevation field (larger => smoother). */
  elevationScale: number;
  /** Tiles per noise unit for the moisture blend field. */
  moistureScale: number;
  /** k in the rational moisture falloff 1/(1 + k*d). */
  moistureFalloffK: number;
  /** Elevation removed from each carved river cell. */
  erosion: number;
  /** Tie-break bonus favouring continuing the river's current direction. */
  momentum: number;
  noise: FbmParams;
  moistureNoise: FbmParams;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  seaLevel: 0.36,
  springCount: 4,
  forestMoisture: 0.5,
  grassMoisture: 0.3,
  elevationScale: 40,
  moistureScale: 28,
  moistureFalloffK: 0.25,
  erosion: 0.01,
  momentum: 0.004,
  noise: { octaves: 5, lacunarity: 2, gain: 0.5 },
  moistureNoise: { octaves: 4, lacunarity: 2, gain: 0.5 },
};

const MAX_SEED = 0x7fffffff;

/** Fill the elevation layer with normalized fBm, spanning [0, 1]. */
export function generateElevation(
  map: GameMap,
  rng: Rng,
  scale: number,
  noise: FbmParams,
): void {
  const seed = rng.nextInt(MAX_SEED);
  const { width, height, elevation } = map;
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = fbm(seed, x / scale, y / scale, noise);
      elevation[map.idx(x, y)] = e;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  const range = max - min || 1;
  for (let i = 0; i < elevation.length; i++) {
    elevation[i] = (elevation[i]! - min) / range;
  }
}

/**
 * Classify water: cells below seaLevel are water. Those connected (4-dir) to
 * a map edge are Ocean; the rest are interior Lakes.
 */
export function classifyWater(map: GameMap, seaLevel: number): void {
  const { width, height, water, elevation } = map;
  for (let i = 0; i < water.length; i++) {
    water[i] = elevation[i]! < seaLevel ? Water.Lake : Water.None;
  }

  const queue: number[] = [];
  const floodFrom = (x: number, y: number): void => {
    if (!map.inBounds(x, y)) return;
    const i = map.idx(x, y);
    if (water[i] === Water.Lake) {
      water[i] = Water.Ocean;
      queue.push(i);
    }
  };

  for (let x = 0; x < width; x++) {
    floodFrom(x, 0);
    floodFrom(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    floodFrom(0, y);
    floodFrom(width - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const x = i % width;
    const y = (i - x) / width;
    floodFrom(x - 1, y);
    floodFrom(x + 1, y);
    floodFrom(x, y - 1);
    floodFrom(x, y + 1);
  }
}

/**
 * Pick `springCount` distinct land cells from the top elevation quartile.
 * Returned cells are always above seaLevel and not already water.
 */
export function selectSprings(
  map: GameMap,
  rng: Rng,
  springCount: number,
  seaLevel: number,
): number[] {
  const { elevation, water } = map;
  const n = elevation.length;

  const sorted = Float32Array.from(elevation);
  sorted.sort();
  const q75 = sorted[Math.floor(0.75 * n)]!;
  const threshold = q75 > seaLevel ? q75 : seaLevel;

  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    if (water[i] === Water.None && elevation[i]! > seaLevel && elevation[i]! >= threshold) {
      candidates.push(i);
    }
  }

  const springs: number[] = [];
  for (let s = 0; s < springCount && candidates.length > 0; s++) {
    const j = rng.nextInt(candidates.length);
    springs.push(candidates[j]!);
    candidates.splice(j, 1);
  }
  return springs;
}

const RIVER_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Carve a river from each spring, walking steepest-descent with directional
 * momentum (4-connected, so every terminal river cell is 4-adjacent to the
 * water / edge it drained into — the connectivity contract). Stops at standing
 * water, an existing river, the map edge, or a local minimum (filled to Lake).
 *
 * Routing reads the elevation field but never mutates it during a walk: the
 * field is static, so each step is strictly downhill and the walk cannot
 * revisit a cell or bounce back into an eroded valley. Erosion is applied to
 * the carved path *after* the walk completes (deferred), keeping the
 * connectivity guarantee intact.
 */
export function carveRivers(
  map: GameMap,
  springs: number[],
  erosion: number,
  momentum: number,
): void {
  const { width, height, water, elevation } = map;
  const onEdge = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1;

  for (const start of springs) {
    let x = start % width;
    let y = (start - x) / width;
    let pdx = 0;
    let pdy = 0;
    const carved: number[] = [];

    for (;;) {
      const ci = map.idx(x, y);
      const w = water[ci];
      if (w === Water.Ocean || w === Water.Lake) break; // reached standing water
      const alreadyRiver = w === Water.River;
      water[ci] = Water.River;
      if (!alreadyRiver) carved.push(ci);

      if (onEdge(x, y)) break; // drained off the map edge
      if (alreadyRiver) break; // merged into an existing river network

      const curE = elevation[ci]!;
      let chosen = -1;
      let chosenScore = Infinity;
      for (let k = 0; k < RIVER_DIRS.length; k++) {
        const dx = RIVER_DIRS[k]![0];
        const dy = RIVER_DIRS[k]![1];
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        const ne = elevation[map.idx(nx, ny)]!;
        if (ne < curE) {
          // strictly downhill; momentum nudges a near-tie toward continuing
          const score = dx === pdx && dy === pdy ? ne - momentum : ne;
          if (score < chosenScore) {
            chosenScore = score;
            chosen = k;
          }
        }
      }

      if (chosen === -1) {
        // local minimum: pool into a Lake and stop (the prior river cell is
        // 4-adjacent to it, so the component still drains).
        water[ci] = Water.Lake;
        carved.pop();
        break;
      }

      const dx = RIVER_DIRS[chosen]![0];
      const dy = RIVER_DIRS[chosen]![1];
      x += dx;
      y += dy;
      pdx = dx;
      pdy = dy;
    }

    // Deferred erosion: carve river valleys without perturbing the routing
    // field of this (or any later) river walk.
    for (const i of carved) {
      elevation[i] = Math.max(0, elevation[i]! - erosion);
    }
  }
}

/**
 * Moisture = 0.7 * rational-distance-to-water falloff + 0.3 * fBm. Distance is
 * a 4-connected BFS from every water cell. Falloff 1/(1 + k*d) keeps the math
 * exactly-rounded (no Math.exp), so it reproduces across JS engines.
 */
export function computeMoisture(
  map: GameMap,
  rng: Rng,
  scale: number,
  k: number,
  noise: FbmParams,
): void {
  const { width, height, water, moisture } = map;
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (water[i] !== Water.None) {
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
    for (let kk = 0; kk < RIVER_DIRS.length; kk++) {
      const nx = x + RIVER_DIRS[kk]![0];
      const ny = y + RIVER_DIRS[kk]![1];
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (dist[ni] === -1) {
        dist[ni] = nd;
        queue.push(ni);
      }
    }
  }

  const seed = rng.nextInt(MAX_SEED);
  const farDist = width + height; // for maps with no water at all
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      const d = dist[i]! >= 0 ? dist[i]! : farDist;
      const falloff = 1 / (1 + k * d);
      const noiseV = fbm(seed, x / scale, y / scale, noise);
      moisture[i] = 0.7 * falloff + 0.3 * noiseV;
    }
  }
}

/**
 * Assign land cover. Water cells are Bare; land cells threshold on moisture
 * (plus a +/-0.05 rng dither band) into Forest / Grass / Meadow for organic
 * edges.
 */
export function assignLandCover(
  map: GameMap,
  rng: Rng,
  forestMoisture: number,
  grassMoisture: number,
): void {
  const { water, moisture, landCover } = map;
  for (let i = 0; i < landCover.length; i++) {
    if (water[i] !== Water.None) {
      landCover[i] = LandCover.Bare;
      continue;
    }
    const dither = (rng.next() - 0.5) * 0.1; // +/-0.05
    const m = moisture[i]! + dither;
    if (m >= forestMoisture) {
      landCover[i] = LandCover.Forest;
    } else if (m >= grassMoisture) {
      landCover[i] = LandCover.Grass;
    } else {
      landCover[i] = LandCover.Meadow;
    }
  }
}

export function terrainStage(params: Partial<TerrainParams> = {}): WorldgenStage {
  const p: TerrainParams = { ...DEFAULT_TERRAIN_PARAMS, ...params };
  return {
    name: 'terrain',
    apply(world, rng) {
      const { map } = world;
      generateElevation(map, rng.fork('elevation'), p.elevationScale, p.noise);
      classifyWater(map, p.seaLevel);
      const springs = selectSprings(map, rng.fork('springs'), p.springCount, p.seaLevel);
      carveRivers(map, springs, p.erosion, p.momentum);
      computeMoisture(map, rng.fork('moisture'), p.moistureScale, p.moistureFalloffK, p.moistureNoise);
      assignLandCover(map, rng.fork('landcover'), p.forestMoisture, p.grassMoisture);
    },
  };
}
