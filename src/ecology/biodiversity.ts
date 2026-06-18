// Biodiversity: ecological RICHNESS per tile — high where both flora AND fauna thrive (a living
// web), low in sealed urban or barren ground, smoothed over a 7×7 window. Pure module: no DOM, no
// rng, no transcendental Math (the architecture guard scans src/ecology; integer multiply + one
// division, FLOOR pinned).
//
// This replaces the old Simpson's-index-over-habitat-classes measure, which perversely scored mixed
// URBAN/edge patchwork highest (many classes = high heterogeneity) and uniform wilds lowest — the
// inverse of ecological biodiversity. Richness reads correctly: thriving wild/healed land is high,
// the sealed city low.

import { GameMap, Water } from '../engine/map';

/** Inclusive radius of the smoothing window (a (2·R+1)² = 7×7 box). */
const R = 3;

/**
 * Per-tile life richness: flora × fauna / 255 (0..255). A rich habitat needs BOTH plants and
 * animals — a tile with flora but no fauna (or vice versa, or sealed urban) reads low; lush wild
 * (both high) reads high. Water carries no terrestrial richness → 0. Integer-only, FLOOR pinned.
 */
export function richnessOf(map: GameMap, i: number): number {
  if (map.water[i] !== Water.None) return 0;
  return Math.floor((map.floraVitality[i]! * map.faunaPresence[i]!) / 255);
}

/**
 * Per-tile biodiversity as a Uint8 field: the mean life richness over the clamped 7×7 window centred
 * on each tile (high in thriving wilds, low in the sealed city). The window is clamped at map edges
 * (fewer tiles) but always includes the centre, so the divisor is ≥ 1.
 */
export function biodiversityField(map: GameMap): Uint8Array {
  const { width, height } = map;
  const n = width * height;

  const per = new Uint8Array(n);
  for (let i = 0; i < n; i++) per[i] = richnessOf(map, i);

  const out = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const y0 = y - R < 0 ? 0 : y - R;
    const y1 = y + R >= height ? height - 1 : y + R;
    for (let x = 0; x < width; x++) {
      const x0 = x - R < 0 ? 0 : x - R;
      const x1 = x + R >= width ? width - 1 : x + R;
      let sum = 0;
      let cnt = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          sum += per[row + xx]!;
          cnt++;
        }
      }
      out[map.idx(x, y)] = Math.floor(sum / cnt);
    }
  }
  return out;
}
