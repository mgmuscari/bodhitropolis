import { describe, it, expect } from 'vitest';
import { mutateWaterFrame } from '../../src/ui/waterAnimation';

// Animated water: mutate a water tile's color mapping into a flipbook of frames — a moving wave
// swell (brightness) + whitecap foam — so water reads as waves/whitecaps, not a static tile
// (Maddy 2026-06-20). Pure pixel transform; the renderer cycles the frames over water tiles.
const SIZE = 8;
function tealTile(size: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 30;
    d[i + 1] = 80;
    d[i + 2] = 96;
    d[i + 3] = 255;
  }
  return d;
}

describe('mutateWaterFrame', () => {
  it('returns a buffer of the same length and preserves alpha', () => {
    const base = tealTile(SIZE);
    const out = mutateWaterFrame(base, 0, 8, SIZE);
    expect(out.length).toBe(base.length);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it('is deterministic for equal args', () => {
    const base = tealTile(SIZE);
    expect([...mutateWaterFrame(base, 2, 8, SIZE)]).toEqual([...mutateWaterFrame(base, 2, 8, SIZE)]);
  });

  it('animates — different frames differ', () => {
    const base = tealTile(SIZE);
    const f0 = mutateWaterFrame(base, 0, 8, SIZE);
    const f3 = mutateWaterFrame(base, 3, 8, SIZE);
    expect([...f0]).not.toEqual([...f3]);
  });

  it('produces whitecap foam — some pixel brightens well above the base tone', () => {
    const base = tealTile(SIZE);
    let maxR = 0;
    for (let f = 0; f < 8; f++) {
      const out = mutateWaterFrame(base, f, 8, SIZE);
      for (let i = 0; i < out.length; i += 4) maxR = Math.max(maxR, out[i]!);
    }
    expect(maxR).toBeGreaterThan(30 + 45); // foam pushes RGB toward white, well above base R=30
  });

  it('loops seamlessly in time — frame `count` ≈ frame 0 within rounding (1/255)', () => {
    const base = tealTile(SIZE);
    const a = mutateWaterFrame(base, 8, 8, SIZE);
    const b = mutateWaterFrame(base, 0, 8, SIZE);
    // sin(x+2π) differs from sin(x) by a float epsilon, so allow ±1/255 (imperceptible); the loop
    // is otherwise seamless. (The renderer cycles 0..count-1 and never draws frame `count` anyway.)
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(1);
  });
});
