// Biodiversity: Simpson's index over per-tile habitat classes — the deliberate
// no-transcendentals choice (Simpson, not Shannon, so no log). Pure module: no
// DOM, no rng, no transcendental Math (the architecture guard scans src/ecology;
// integer squares via n*n, one division, FLOOR pinned).
//
// TWO distinct exports, because a Uint8 field cannot carry an exact 1/2 or 2/3:
//   - simpsonIndex(counts) → {num, den}: the PURE index as an exact rational.
//   - biodiversityField(map) → Uint8Array: that index scaled per tile via
//     floor((255·num)/den) over a clamped 7×7 window. NOT a stored layer —
//     recomputed for the overlay/report.

import { GameMap, Water } from '../engine/map';

/** Inclusive radius of the biodiversity window (a (2·R+1)² = 7×7 box). */
const R = 3;
// Habitat class ids: 0 = water; land = 1 + landCover(0..3)*16 + floraBand(0..3)*4
// + faunaBand(0..3), where band = value >> 6. So 0..64 — bucket count below.
const NUM_CLASSES = 65;

/**
 * Simpson's diversity index of a multiset given its per-class `counts`, as an
 * EXACT rational `{num: total² − Σcount², den: total²}` ∈ [0, 1). Integer squares
 * (n*n), no division, no transcendentals. total = Σcounts; an empty multiset
 * returns `{num: 0, den: 1}` (= 0), guarding 0/0. A real window always counts its
 * own centre, so total ≥ 1 and den ≥ 1 there.
 */
export function simpsonIndex(counts: readonly number[]): { num: number; den: number } {
  let total = 0;
  let sumSq = 0;
  for (const c of counts) {
    total += c;
    sumSq += c * c;
  }
  if (total === 0) return { num: 0, den: 1 };
  return { num: total * total - sumSq, den: total * total };
}

/** The habitat class of tile `i`: a small integer over (water | landCover, flora band, fauna band). */
function classOf(map: GameMap, i: number): number {
  if (map.water[i] !== Water.None) return 0;
  const lc = map.landCover[i]!; // 0..3
  const fb = map.floraVitality[i]! >> 6; // 0..3
  const ab = map.faunaPresence[i]! >> 6; // 0..3
  return 1 + lc * 16 + fb * 4 + ab;
}

/**
 * Per-tile biodiversity as a Uint8 field: Simpson's index over the habitat-class
 * counts in the clamped 7×7 window centred on each tile, scaled by
 * `floor((255·num)/den)` (one integer division; FLOOR pinned, matching
 * clampByte/bandOf elsewhere). The window is clamped at map edges (fewer tiles)
 * but always includes the centre, so total ≥ 1 and there is never a 0/0.
 */
export function biodiversityField(map: GameMap): Uint8Array {
  const { width, height } = map;
  const n = width * height;

  // Precompute the class of every tile once.
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) cls[i] = classOf(map, i);

  const out = new Uint8Array(n);
  const counts = new Int32Array(NUM_CLASSES); // reused; only touched buckets are reset
  for (let y = 0; y < height; y++) {
    const y0 = y - R < 0 ? 0 : y - R;
    const y1 = y + R >= height ? height - 1 : y + R;
    for (let x = 0; x < width; x++) {
      const x0 = x - R < 0 ? 0 : x - R;
      const x1 = x + R >= width ? width - 1 : x + R;

      const touched: number[] = [];
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          const c = cls[row + xx]!;
          if (counts[c] === 0) touched.push(c);
          counts[c]!++;
        }
      }
      const windowCounts = touched.map((c) => counts[c]!);
      const { num, den } = simpsonIndex(windowCounts);
      out[map.idx(x, y)] = Math.floor((255 * num) / den);
      for (const c of touched) counts[c] = 0; // reset for the next tile
    }
  }
  return out;
}
