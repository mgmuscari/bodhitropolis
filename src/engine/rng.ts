// Seeded pseudo-random number generator.
//
// Determinism is load-bearing for Bodhitropolis: "same seed -> same world"
// must hold across JS engines and browsers (DF-style worldgen reproducibility,
// the future historical sim). This module therefore uses only integer bit ops
// and `Math.imul` (a spec-defined exact 32-bit multiply) — no transcendental
// `Math` functions whose rounding varies across engines. Float results come
// only from dividing a uint32 by 2^32 (exactly-rounded).
//
// Core generator: sfc32 (Chris Doty-Humphrey's "Small Fast Counting" PRNG,
// public domain, 128-bit state). Seeding: a 32-bit FNV-1a hash of the seed,
// expanded into the four state words via splitmix32.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). Throws on non-positive or non-integer n. */
  nextInt(n: number): number;
  /** True with probability p. chance(0) is never true; chance(1) always is. */
  chance(p: number): boolean;
  /**
   * An independent child stream derived deterministically from this Rng's
   * seed plus `label`. Independent of how many times the parent has been
   * drawn, so inserting/removing a sibling stream never perturbs others.
   */
  fork(label: string): Rng;
}

const UINT32 = 4294967296; // 2^32

/** 32-bit FNV-1a hash of a string. Deterministic across engines. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Avalanche-mix a 32-bit base seed with a label into a fresh 32-bit seed. */
function combineSeed(base: number, label: string): number {
  let h = base >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // splitmix32 finalizer for good avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Reduce any accepted seed to a single 32-bit value. */
function hashSeed(seed: string | number): number {
  // Hashing the canonical string form keeps both paths deterministic and
  // unifies number/string seeds (Number->string conversion is spec-defined).
  return fnv1a(typeof seed === 'number' ? `#${seed}` : seed);
}

/** splitmix32 step generator, used to expand one seed into N state words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function makeRng(baseSeed: number): Rng {
  const seedGen = splitmix32(baseSeed);
  let a = seedGen() | 0;
  let b = seedGen() | 0;
  let c = seedGen() | 0;
  let d = seedGen() | 0;

  function nextUint32(): number {
    // sfc32
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  }

  // Warm up to mix the seeded state before any output is consumed.
  for (let i = 0; i < 12; i++) nextUint32();

  const rng: Rng = {
    next() {
      return nextUint32() / UINT32;
    },
    nextInt(n: number) {
      if (!Number.isInteger(n) || n <= 0) {
        throw new RangeError(`nextInt requires a positive integer, got ${n}`);
      }
      return Math.floor((nextUint32() / UINT32) * n);
    },
    chance(p: number) {
      return nextUint32() / UINT32 < p;
    },
    fork(label: string) {
      return makeRng(combineSeed(baseSeed, label));
    },
  };
  return rng;
}

export function createRng(seed: string | number): Rng {
  return makeRng(hashSeed(seed));
}
