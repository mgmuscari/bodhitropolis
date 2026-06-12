// Seeded value noise + fractional Brownian motion (fBm).
//
// These are pure functions of (seed, x, y) with no internal state, so the
// order in which a worldgen pass samples them can never affect the result.
// Per the determinism design rule, only integer bit ops, Math.imul (exact
// 32-bit multiply), Math.floor, and exactly-rounded float arithmetic are
// used — no transcendental Math, whose rounding varies across JS engines.

export interface FbmParams {
  /** Number of summed octaves (>= 1). */
  octaves: number;
  /** Frequency multiplier between successive octaves (e.g. 2). */
  lacunarity: number;
  /** Amplitude multiplier between successive octaves (e.g. 0.5). */
  gain: number;
  /** Base frequency applied to the input coordinates. Defaults to 1. */
  frequency?: number;
}

const UINT32 = 4294967296;

/** Hash an integer lattice point + seed to a uniform value in [0, 1). */
function latticeValue(seed: number, ix: number, iy: number): number {
  let h = seed >>> 0;
  h ^= Math.imul(ix | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= Math.imul(iy | 0, 0x27d4eb2f);
  // splitmix32 finalizer for avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / UINT32;
}

/** Smoothstep easing: 3t^2 - 2t^3, C1-continuous on [0, 1]. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinearly interpolated, smoothstep-eased lattice value noise in [0, 1). */
export function valueNoise2D(seed: number, x: number, y: number): number {
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  const fx = x - ix0;
  const fy = y - iy0;

  const v00 = latticeValue(seed, ix0, iy0);
  const v10 = latticeValue(seed, ix0 + 1, iy0);
  const v01 = latticeValue(seed, ix0, iy0 + 1);
  const v11 = latticeValue(seed, ix0 + 1, iy0 + 1);

  const u = smoothstep(fx);
  const v = smoothstep(fy);

  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/**
 * Fractional Brownian motion: sum of `octaves` value-noise layers at rising
 * frequency and falling amplitude, normalized to [0, 1]. Each octave uses a
 * decorrelated seed so the layers do not align.
 */
export function fbm(seed: number, x: number, y: number, params: FbmParams): number {
  const { octaves, lacunarity, gain } = params;
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`fbm octaves must be an integer >= 1, got ${octaves}`);
  }
  let freq = params.frequency ?? 1;
  let amp = 1;
  let sum = 0;
  let ampSum = 0;
  for (let o = 0; o < octaves; o++) {
    const octaveSeed = (seed + Math.imul(o, 0x9e3779b9)) | 0;
    sum += amp * valueNoise2D(octaveSeed, x * freq, y * freq);
    ampSum += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / ampSum;
}
