// Seeded city-name generator. A pure Rng consumer: it assembles a pronounceable
// core from consonant/vowel/coda tables, optionally appends a weighted American
// place-name suffix, then title-cases and clamps the result to 4..16 chars.
//
// Engine layer: the architecture guard scans this file, so it stays DOM-free and
// uses no transcendental Math — all randomness comes from the seeded Rng, all
// arithmetic is integer/exactly-rounded. Determinism contract: the same
// (seed, fork) always yields the same name, forever (pinned in tests). The name
// generator forks 'city-name' from the world seed, independent of the worldgen
// stage streams by the fork-label contract (see engine/rng.ts).

import type { Rng } from './rng';

// Syllable building blocks — all lowercase ASCII so the title-cased output
// matches /^[A-Z][a-z]+$/. Empty codas are repeated to bias toward open,
// easily-pronounced syllables.
const ONSETS = [
  'b', 'br', 'c', 'ch', 'd', 'dr', 'f', 'fl', 'g', 'gr', 'h', 'k', 'l', 'm',
  'n', 'p', 'pr', 'r', 's', 'sh', 'st', 't', 'tr', 'v', 'w',
] as const;
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'ee', 'oo', 'ou'] as const;
const CODAS = [
  '', '', '', 'n', 'r', 'l', 'm', 's', 'd', 't', 'th', 'nd', 'rk', 'ck', 'st',
  'll', 'sh', 'nt',
] as const;

// Weighted American place-name suffixes (earlier = more common). The shortest
// suffix is 4 chars, which keeps the min-length guarantee below intact.
const SUFFIXES: ReadonlyArray<readonly [string, number]> = [
  ['ford', 5],
  ['haven', 4],
  ['field', 4],
  ['ridge', 3],
  ['port', 3],
  ['mills', 2],
  ['crossing', 2],
  ['falls', 2],
];

const MIN_LEN = 4;
const MAX_LEN = 16;

function pick<T>(rng: Rng, table: readonly T[]): T {
  return table[rng.nextInt(table.length)]!;
}

/** Weighted choice over SUFFIXES (deterministic, single rng draw). */
function weightedSuffix(rng: Rng): string {
  let total = 0;
  for (const [, w] of SUFFIXES) total += w;
  let r = rng.nextInt(total);
  for (const [s, w] of SUFFIXES) {
    if (r < w) return s;
    r -= w;
  }
  return SUFFIXES[0]![0]; // unreachable: r < total guarantees a hit above
}

/**
 * Generate one city name from `rng`. 1-2 pronounceable syllables plus an
 * optional weighted suffix; a suffix is forced when the bare core would fall
 * under MIN_LEN, so the output is always 4..16 title-cased letters.
 */
export function cityName(rng: Rng): string {
  const syllables = 1 + rng.nextInt(2); // 1 or 2
  let core = '';
  for (let s = 0; s < syllables; s++) {
    core += pick(rng, ONSETS) + pick(rng, VOWELS) + pick(rng, CODAS);
  }

  const wantSuffix = rng.nextInt(10) < 6; // ~60% carry a suffix
  let name = core;
  if (wantSuffix || name.length < MIN_LEN) {
    name += weightedSuffix(rng);
  }
  if (name.length > MAX_LEN) name = name.slice(0, MAX_LEN);

  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
