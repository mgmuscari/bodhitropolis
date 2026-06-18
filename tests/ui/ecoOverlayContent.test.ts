import { describe, it, expect } from 'vitest';
import {
  OVERLAY_VIEWS,
  cycleOverlay,
  shouldCycleOverlay,
  overlayTint,
  legendLine,
  OVERLAY_ALPHA,
  type OverlayView,
} from '../../src/ui/ecoOverlayContent';

// ecoOverlayContent is pure presentation (allowlisted, DOM-free, no transcendental
// Math): the overlay cycle, the E-key gate, the value→colour ramps, and the legend
// strings. The renderer/main wiring is shell glue (the lead's live pass), so only
// these pure pieces are unit-tested.

// Endpoint colours per view — the pinned ramp contract (value 0 → lo, 255 → hi).
const ENDPOINTS: Record<OverlayView, { lo: readonly number[]; hi: readonly number[] }> = {
  soil: { lo: [120, 82, 48], hi: [80, 170, 80] },
  flora: { lo: [210, 216, 180], hi: [28, 120, 44] },
  fauna: { lo: [228, 214, 176], hi: [210, 120, 40] },
  biodiversity: { lo: [120, 72, 176], hi: [226, 200, 64] },
  airPollution: { lo: [150, 170, 150], hi: [54, 44, 38] },
  groundPollution: { lo: [160, 165, 135], hi: [92, 56, 26] },
  waterPollution: { lo: [60, 130, 185], hi: [120, 120, 52] },
};

describe('cycleOverlay', () => {
  it('walks off → soil → flora → fauna → biodiversity → air → ground → water → off', () => {
    expect(cycleOverlay(null)).toBe('soil');
    expect(cycleOverlay('soil')).toBe('flora');
    expect(cycleOverlay('flora')).toBe('fauna');
    expect(cycleOverlay('fauna')).toBe('biodiversity');
    expect(cycleOverlay('biodiversity')).toBe('airPollution');
    expect(cycleOverlay('airPollution')).toBe('groundPollution');
    expect(cycleOverlay('groundPollution')).toBe('waterPollution');
    expect(cycleOverlay('waterPollution')).toBe(null); // off-wrap
  });

  it('OVERLAY_VIEWS is the ecology + pollution views in order', () => {
    expect(OVERLAY_VIEWS).toEqual([
      'soil',
      'flora',
      'fauna',
      'biodiversity',
      'airPollution',
      'groundPollution',
      'waterPollution',
    ]);
  });
});

describe('shouldCycleOverlay (mirrors shouldTogglePanel)', () => {
  it('fires on e/E only when no opening overlay is active', () => {
    expect(shouldCycleOverlay('e', false)).toBe(true);
    expect(shouldCycleOverlay('E', false)).toBe(true);
    expect(shouldCycleOverlay('e', true)).toBe(false); // suppressed under the opening
    expect(shouldCycleOverlay('E', true)).toBe(false);
    expect(shouldCycleOverlay('t', false)).toBe(false);
    expect(shouldCycleOverlay('x', false)).toBe(false);
    expect(shouldCycleOverlay('Enter', false)).toBe(false);
  });
});

describe('overlayTint: pinned ramps (Uint8 input domain)', () => {
  it('maps value 0 to the low endpoint and 255 to the high endpoint per view', () => {
    for (const view of OVERLAY_VIEWS) {
      const { lo, hi } = ENDPOINTS[view];
      const t0 = overlayTint(view, 0);
      const t255 = overlayTint(view, 255);
      expect([t0[0], t0[1], t0[2]]).toEqual([lo[0], lo[1], lo[2]]);
      expect([t255[0], t255[1], t255[2]]).toEqual([hi[0], hi[1], hi[2]]);
      expect(t0[3]).toBe(OVERLAY_ALPHA);
      expect(t255[3]).toBe(OVERLAY_ALPHA);
    }
  });

  it('value 128 lies strictly between the endpoints on every channel (monotonic ramp)', () => {
    for (const view of OVERLAY_VIEWS) {
      const { lo, hi } = ENDPOINTS[view];
      const t = overlayTint(view, 128);
      for (let c = 0; c < 3; c++) {
        const min = Math.min(lo[c]!, hi[c]!);
        const max = Math.max(lo[c]!, hi[c]!);
        expect(t[c]).toBeGreaterThanOrEqual(min);
        expect(t[c]).toBeLessThanOrEqual(max);
      }
      expect(t[3]).toBe(OVERLAY_ALPHA);
    }
  });

  it('stays in byte range and is deterministic across the domain', () => {
    for (const view of OVERLAY_VIEWS) {
      for (const v of [0, 1, 63, 64, 127, 128, 200, 254, 255]) {
        const a = overlayTint(view, v);
        const b = overlayTint(view, v);
        for (let c = 0; c < 3; c++) {
          expect(a[c]).toBeGreaterThanOrEqual(0);
          expect(a[c]).toBeLessThanOrEqual(255);
          expect(a[c]).toBe(b[c]);
        }
      }
    }
  });
});

describe('legendLine', () => {
  it('returns a distinct, non-empty line per view', () => {
    const seen = new Set<string>();
    for (const view of OVERLAY_VIEWS) {
      const line = legendLine(view);
      expect(line.length).toBeGreaterThan(0);
      seen.add(line);
    }
    expect(seen.size).toBe(OVERLAY_VIEWS.length);
  });

  it('pins the exact legend copy', () => {
    expect(legendLine('soil')).toBe('Soil health — broken brown to living green');
    expect(legendLine('flora')).toBe('Flora vitality — bare ground to deep canopy');
    expect(legendLine('fauna')).toBe('Fauna presence — quiet to teeming');
    expect(legendLine('biodiversity')).toBe('Biodiversity — richness, violet to gold');
    expect(legendLine('airPollution')).toBe('Air pollution — clear air to dark smog');
    expect(legendLine('groundPollution')).toBe('Ground pollution — clean land to toxic ground');
    expect(legendLine('waterPollution')).toBe('Water pollution — clear to dingy creek');
  });
});
