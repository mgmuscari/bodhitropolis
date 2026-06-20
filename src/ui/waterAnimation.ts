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
      // Two crossing wave trains. Spatial frequencies are INTEGER (wrap at `size` → seamless tiling);
      // time advances by integer multiples of phase (1×, 2×) → frame count loops back to frame 0.
      const w =
        Math.sin(((x * 1 + y * 2) / size) * TAU + phase) +
        0.7 * Math.sin(((x * 2 - y * 1) / size) * TAU - 2 * phase);
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

/** A good deep satellite-water base colour (muted blue-teal) — the frames are generated FROM this, so
 *  the bad baked ocean/river tiles are never used (they read cyan / striped). Tunable. */
const WATER_BASE: readonly [number, number, number] = [30, 60, 82];

/**
 * Bake `frameCount` animated water frames procedurally from {@link WATER_BASE} (NOT the baked tile,
 * which is no good). Frame 0 is the renderer's static water tile; the set is the flipbook for the
 * (low-alpha) animated twinkle. Returns [] headless. Browser IO.
 */
export function makeWaterFrames(frameCount: number, size: number): CanvasImageSource[] {
  if (typeof document === 'undefined') return [];
  const baseData = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < baseData.length; i += 4) {
    baseData[i] = WATER_BASE[0];
    baseData[i + 1] = WATER_BASE[1];
    baseData[i + 2] = WATER_BASE[2];
    baseData[i + 3] = 255;
  }

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
