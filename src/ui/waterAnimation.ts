// Animated water (CPU dynamics — a permanent path for no-WebGL machines, not a stopgap). A water
// tile is mutated into a FLIPBOOK of frames: a moving wave swell (brightness) + whitecap foam, so
// water reads as waves/whitecaps instead of a static tile (Maddy 2026-06-20). The spatial pattern
// uses integer wave numbers so it TILES seamlessly (the whole sea is one continuous animated surface
// when every water tile draws the same current frame), and the time terms are integer multiples of
// the phase so frame `count` == frame 0 (a seamless loop). The pure mutation is unit-tested; the
// frame baking is browser IO.
const TAU = 6.283185307179586;

/**
 * Mutate a water tile's RGBA buffer into animation frame `frameIdx` of `frameCount`: a tileable wave
 * swell modulating brightness, plus whitecap foam at the crests. Pure; alpha preserved.
 */
export function mutateWaterFrame(
  base: Uint8ClampedArray,
  frameIdx: number,
  frameCount: number,
  size: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length);
  const phase = (frameIdx / frameCount) * TAU;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // DOMAIN WARP for a "sloshy" liquid look: bend the sample coords by crossing waves so the swell
      // is curvy/organic, not straight sine bands. The warp waves use integer spatial freqs (wrap at
      // `size`) and integer time multiples → the whole field stays seamlessly tileable AND loops.
      const warp = size * 0.14;
      const u = x + Math.sin(((y * 2) / size) * TAU + phase) * warp;
      const v = y + Math.sin(((x * 2) / size) * TAU - 2 * phase) * warp;
      // Two crossing wave trains over the warped coords. INTEGER spatial freqs + integer time multiples
      // (1×, 2×) → seamless tiling + frame `count` loops back to frame 0.
      const w =
        Math.sin(((u * 1 + v * 2) / size) * TAU + phase) +
        0.7 * Math.sin(((u * 2 - v * 1) / size) * TAU - 2 * phase);
      const bright = 1 + w * 0.15; // strong, visible swell — this IS the water surface, not an overlay
      let r = base[i]! * bright;
      let g = base[i + 1]! * bright;
      let b = base[i + 2]! * bright;
      // Whitecaps: FIXED foam sites (spatial speckle, no frameIdx) that LIGHT UP smoothly as the
      // moving wave crest sweeps over them — a twinkle that fades in/out with the wave, NOT a per-frame
      // random flicker (the previous flash bug). Foam tracks `w`, which loops, so the loop stays clean.
      const crest = w - 0.85;
      if (crest > 0 && (x * 7 + y * 13) % 5 === 0) {
        const foam = Math.min(1, crest * 1.5) * 0.6;
        r += (255 - r) * foam;
        g += (255 - g) * foam;
        b += (255 - b) * foam;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = base[i + 3]!;
    }
  }
  return out;
}

/** Fallback deep satellite-water colour if no baked tile is supplied (muted blue-teal). */
const WATER_BASE: readonly [number, number, number] = [30, 60, 82];

/**
 * A tileable soft light-streak texture (pale warm highlights on transparency) — the renderer scrolls
 * it with the prevailing wind over grass/forest at low alpha for a subtle wavy-grass / canopy sheen
 * (the wind catching the blades). Integer wave numbers → seamless tiling. Browser IO; null headless.
 */
export function makeGrassSheen(size: number): CanvasImageSource | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const id = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // crossing streaks; only the crests (s>0) show as light wind gusts, troughs are transparent
      const s =
        Math.sin(((x * 2 + y * 1) / size) * TAU) + 0.6 * Math.sin(((x * 1 - y * 3) / size) * TAU);
      id.data[i] = 232;
      id.data[i + 1] = 244;
      id.data[i + 2] = 206; // pale warm green-white
      id.data[i + 3] = Math.max(0, s) * 100; // soft alpha, only on crests
    }
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

// NON-periodic value noise over continuous coords — the cloud field is evaluated in WORLD space and
// upscaled, so it never tiles/tessellates (Maddy: a scrolled tiled texture always repeats; need a
// chaotic non-repeating function). Hash at each integer lattice point (no wrap), smoothstep-interp.
function hash2(ix: number, iy: number): number {
  let h = Math.imul((ix ^ 0x9e3779b1) >>> 0, 0x85ebca6b);
  h = Math.imul((h ^ (iy + 0x27d4eb2f)) >>> 0, 0xc2b2ae35);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vnoise2(fx: number, fy: number): number {
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/**
 * The cloud-shadow field at continuous world coords `(x, y)` → 0 (clear sky) .. ~1 (dense cloud). Three
 * octaves of NON-periodic fBm + a threshold so most of the sky is clear with sparse organic clouds. The
 * renderer evaluates this over the visible world (offset by wind·time) into a low-res buffer it upscales,
 * so the cloud layer drifts with the wind and NEVER repeats.
 */
export function cloudFbm(x: number, y: number): number {
  const n = vnoise2(x, y) * 0.6 + vnoise2(x * 2 + 5.1, y * 2 + 9.3) * 0.3 + vnoise2(x * 4 + 1.7, y * 4 + 3.3) * 0.1;
  return Math.max(0, n - 0.52) * 2.4; // threshold + gain → mostly clear, soft sparse clouds
}

/**
 * Bake `frameCount` sloshy water frames by mutating the BAKED water tile (hybrid: the baked texture
 * carries the identity, the warp/foam adds the slosh). The renderer cycles these in a low-alpha
 * overlay over the baked base, so the surface undulates. Falls back to {@link WATER_BASE} if no baked
 * tile. Returns [] headless. Browser IO.
 */
export function makeWaterFrames(
  base: CanvasImageSource | null,
  frameCount: number,
  size: number,
): CanvasImageSource[] {
  if (typeof document === 'undefined') return [];
  const src = document.createElement('canvas');
  src.width = size;
  src.height = size;
  const sctx = src.getContext('2d');
  if (!sctx) return [];
  sctx.imageSmoothingEnabled = false;
  if (base) {
    sctx.drawImage(base, 0, 0, size, size);
  } else {
    sctx.fillStyle = `rgb(${WATER_BASE[0]}, ${WATER_BASE[1]}, ${WATER_BASE[2]})`;
    sctx.fillRect(0, 0, size, size);
  }
  const baseData = sctx.getImageData(0, 0, size, size).data;

  const frames: CanvasImageSource[] = [];
  for (let f = 0; f < frameCount; f++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const id = ctx.createImageData(size, size);
    id.data.set(mutateWaterFrame(baseData, f, frameCount, size));
    ctx.putImageData(id, 0, 0);
    frames.push(canvas);
  }
  return frames;
}
