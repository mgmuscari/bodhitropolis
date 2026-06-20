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
      const bright = 1 + w * 0.06;
      let r = base[i]! * bright;
      let g = base[i + 1]! * bright;
      let b = base[i + 2]! * bright;
      // Whitecaps: FIXED foam sites (spatial speckle, no frameIdx) that LIGHT UP smoothly as the
      // moving wave crest sweeps over them — a twinkle that fades in/out with the wave, NOT a per-frame
      // random flicker (the previous flash bug). Foam tracks `w`, which loops, so the loop stays clean.
      const crest = w - 1.0;
      if (crest > 0 && (x * 7 + y * 13) % 5 === 0) {
        const foam = Math.min(1, crest * 1.6) * 0.55;
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

/**
 * Bake `frameCount` animated water frames from a base water tile. Returns [] in a headless context or
 * with no base (the renderer then falls back to the static graded water tile). Browser IO.
 */
export function makeWaterFrames(
  base: CanvasImageSource | null,
  frameCount: number,
  size: number,
): CanvasImageSource[] {
  if (!base || typeof document === 'undefined') return [];
  const src = document.createElement('canvas');
  src.width = size;
  src.height = size;
  const sctx = src.getContext('2d');
  if (!sctx) return [];
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(base, 0, 0, size, size);
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
