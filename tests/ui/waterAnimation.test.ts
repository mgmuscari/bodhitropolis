import { describe, it, expect } from 'vitest';
import { mutateWaterFrame, waterSloshAt, WATER_SLOSH_AMP, WATER_SLOSH_SHEAR } from '../../src/ui/waterAnimation';

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

// Per-tile AFFINE slosh (Maddy 2026-06-20): the water BASE tiles should themselves slosh, not just
// a low-alpha overlay scroll. waterSloshAt gives a per-tile, per-frame oscillating affine — a small
// wind-aligned translation (fraction of a tile) + a shear — wind-aligned with a slow angular drift.
describe('waterSloshAt (per-tile oscillating affine for the water base tiles)', () => {
  it('is deterministic in (tx, ty, t, wind)', () => {
    const a = waterSloshAt(3, 5, 2.0, 1, 0);
    const b = waterSloshAt(3, 5, 2.0, 1, 0);
    expect(a).toEqual(b);
  });

  it('stays bounded — translation ≤ amp, shear ≤ shear cap (so a sheared tile still covers its square)', () => {
    for (let k = 0; k < 50; k++) {
      const s = waterSloshAt(k % 7, (k * 3) % 11, k * 0.37, 0.6, -0.8);
      expect(Math.hypot(s.ox, s.oy)).toBeLessThanOrEqual(WATER_SLOSH_AMP + 1e-9);
      expect(Math.abs(s.shA)).toBeLessThanOrEqual(WATER_SLOSH_SHEAR + 1e-9);
      expect(Math.abs(s.shB)).toBeLessThanOrEqual(WATER_SLOSH_SHEAR + 1e-9);
    }
  });

  it('oscillates over time (it is not static)', () => {
    const a = waterSloshAt(4, 4, 0, 1, 0);
    const b = waterSloshAt(4, 4, 1.6, 1, 0);
    expect(a.ox !== b.ox || a.oy !== b.oy || a.shA !== b.shA).toBe(true);
  });

  it('neighbouring tiles are out of phase (waves travel, not a rigid sheet)', () => {
    const a = waterSloshAt(4, 4, 1.0, 1, 0);
    const b = waterSloshAt(5, 4, 1.0, 1, 0);
    expect(a.ox !== b.ox || a.shA !== b.shA).toBe(true);
  });

  it('zero wind is finite (no NaN) — wlen guards the divide', () => {
    const s = waterSloshAt(2, 2, 1.0, 0, 0);
    expect(Number.isFinite(s.ox) && Number.isFinite(s.oy)).toBe(true);
    expect(Number.isFinite(s.shA) && Number.isFinite(s.shB)).toBe(true);
  });
});
