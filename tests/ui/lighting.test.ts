import { describe, it, expect } from 'vitest';
import { dayNightBrightness, cloudShadow, lightingAt } from '../../src/ui/lighting';

// Shared scene lighting — the single definition the GPU shader (base) and the renderer (sprites) both
// use, so a sprite is lit to the same level as the tile it's on (Maddy 2026-06-20).
describe('lighting (shared GPU/sprite scene lighting)', () => {
  it('day/night brightness stays in [0.45, 1] and is deterministic', () => {
    for (let k = 0; k < 40; k++) {
      const b = dayNightBrightness(k * 3.1);
      expect(b).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(b).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(dayNightBrightness(12.34)).toBe(dayNightBrightness(12.34));
    // noon-ish (alt≈1) is brighter than midnight-ish (alt≈-1)
    const noon = dayNightBrightness(Math.PI / 2 / 0.04);
    const night = dayNightBrightness((3 * Math.PI) / 2 / 0.04);
    expect(noon).toBeGreaterThan(night);
  });

  it('cloud shadow stays in [0, 0.2] and varies across space', () => {
    let min = 1;
    let max = 0;
    for (let x = 0; x < 30; x++) {
      const c = cloudShadow(x * 2.3, x * 1.7, 5);
      min = Math.min(min, c);
      max = Math.max(max, c);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    expect(max).toBeGreaterThan(min); // not constant
  });

  it('lightingAt combines day×cloud×smog, monotonic in smog', () => {
    const clear = lightingAt(10, 10, 4, 0);
    const smoggy = lightingAt(10, 10, 4, 1);
    expect(smoggy).toBeLessThan(clear); // smog darkens
    expect(lightingAt(10, 10, 4, 0)).toBeLessThanOrEqual(dayNightBrightness(4) + 1e-9);
  });
});
