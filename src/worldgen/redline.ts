// The redline grade — Bodhitropolis's discriminatory social geography.
//
// "Redlining" is named here CRITICALLY, scoped to the oppressive-planning history
// this worldgen models. Be precise about what it WAS: redlining was the DENIAL OF
// HOUSING. The HOLC (1930s) and the FHA graded neighborhoods A–D and marked Black
// and immigrant districts "D / hazardous" (red); the government and banks then
// refused mortgages and federal backing in the red — and in any neighborhood that
// might integrate. So Black families were BARRED from the "good" (A/B) neighborhoods
// and SEGREGATED into the red zones (racial covenants + FHA underwriting enforced
// it). The grade was dressed up with pseudo-objective pretexts ("flood-prone",
// "declining"), but its function was racial confinement. The red zones were THEN
// made dumping grounds: starved of investment and loans, they got the industry, the
// highways, the pollution — the burdens follow the segregation. West Oakland was
// graded red and razed under the apparatus.
//
// This module reproduces the MOVE in order to indict it: the grade is drawn FIRST
// as seeded discrimination (terrain-independent) — the segregation map — and terrain
// is layered on only as COVER, the pretext. The grade DETERMINES later burdens
// (dirty power, industry, decay, highways are sited by it); burdens are NOT emergent
// from geography, which would launder the discrimination as nature. The neutral live
// result the player inherits and repairs is "decay"; only this apparatus is named
// "redlining".
//
// Worldgen layer: no DOM, no transcendental Math (the architecture guard scans it);
// the field uses seeded value noise (rng lattice + polynomial smoothstep) only.

import { Water, type GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { distanceField } from './fields';

/** HOLC grades over the continuous redline field: A (best) .. D (redlined/worst). */
export const RedlineGrade = { A: 0, B: 1, C: 2, D: 3 } as const;
export type RedlineGrade = (typeof RedlineGrade)[keyof typeof RedlineGrade];

export interface RedlineParams {
  /** Lattice spacing (tiles) for the discriminatory value noise. */
  cellSize: number;
  /** 0..255 weight of the seeded social geography — the DOMINANT term. */
  baseAmplitude: number;
  /** Max grade added at the lowest-elevation tiles (the terrain pretext). */
  terrainNudge: number;
  /** Max grade added right at the waterline (the "flood-prone" pretext). */
  waterNudge: number;
  /** Water-proximity nudge reaches this many tiles inland. */
  waterRadius: number;
}

export const DEFAULT_REDLINE_PARAMS: RedlineParams = {
  cellSize: 16,
  baseAmplitude: 212,
  terrainNudge: 40,
  waterNudge: 20,
  waterRadius: 4,
};

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Bucket the continuous 0..255 grade into the four HOLC grades for legibility.
 * Even quarters: A < 64 ≤ B < 128 ≤ C < 192 ≤ D. Monotonic — a worse continuous
 * grade never buckets to a better letter.
 */
export function gradeBucket(v: number): RedlineGrade {
  if (v < 64) return RedlineGrade.A;
  if (v < 128) return RedlineGrade.B;
  if (v < 192) return RedlineGrade.C;
  return RedlineGrade.D;
}

const GRADE_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** The HOLC letter (A..D) for a continuous 0..255 grade value. */
export function gradeLetter(value: number): string {
  return GRADE_LETTERS[gradeBucket(value)]!;
}

/** Smoothstep on [0,1] — a polynomial fade (no transcendental Math). */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Draw the redline grade into `map.redline` (0 = greenlined .. 255 = redlined).
 *
 * Discrimination FIRST: a seeded, terrain-independent value-noise field is the
 * dominant term — the redlining board's social map of who is "desirable". Terrain
 * is only COVER: a low-elevation + near-water nudge layered on top supplies the
 * pseudo-objective pretext that laundered the grade. Deterministic in `rng`.
 */
export function gradeRedline(
  map: GameMap,
  rng: Rng,
  p: RedlineParams = DEFAULT_REDLINE_PARAMS,
): void {
  const { width, height } = map;

  // --- Dominant term: seeded discriminatory value noise -------------------
  // A coarse lattice of random values, bilinearly interpolated with a smoothstep
  // fade, paints organic "desirable" / "redlined" districts independent of land.
  const cs = p.cellSize;
  const cols = Math.floor(width / cs) + 2;
  const rows = Math.floor(height / cs) + 2;
  const noiseRng = rng.fork('social');
  const lattice = new Float64Array(cols * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = noiseRng.next();

  // --- Cover term: water proximity (distance to the nearest water tile) ----
  const waterDist = distanceField(map, (i) => map.water[i] !== Water.None);

  for (let y = 0; y < height; y++) {
    const gy = y / cs;
    const gy0 = Math.floor(gy);
    const sy = smooth(gy - gy0);
    for (let x = 0; x < width; x++) {
      const gx = x / cs;
      const gx0 = Math.floor(gx);
      const sx = smooth(gx - gx0);
      const v00 = lattice[gy0 * cols + gx0]!;
      const v10 = lattice[gy0 * cols + gx0 + 1]!;
      const v01 = lattice[(gy0 + 1) * cols + gx0]!;
      const v11 = lattice[(gy0 + 1) * cols + gx0 + 1]!;
      const top = v00 + (v10 - v00) * sx;
      const bot = v01 + (v11 - v01) * sx;
      const social = top + (bot - top) * sy; // 0..1
      let grade = social * p.baseAmplitude;

      // Cover: lower ground reads "worse"; tiles near water read "flood-prone".
      const i = map.idx(x, y);
      grade += p.terrainNudge * (1 - map.elevation[i]!);
      const wd = waterDist[i]!;
      if (wd >= 0 && wd <= p.waterRadius) {
        grade += (p.waterNudge * (p.waterRadius - wd)) / p.waterRadius;
      }

      map.redline[i] = clampByte(Math.floor(grade));
    }
  }
}
