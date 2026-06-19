import { describe, it, expect } from 'vitest';
import { OVERLAY_DIM } from '../../src/ui/overlayLegend';
import { POWER_OVERLAY_ALPHA, powerTint } from '../../src/ui/powerOverlayContent';
import { COVERAGE_OVERLAY_ALPHA, coverageTint } from '../../src/ui/coverageOverlayContent';
import { CIVIC_OVERLAY_ALPHA } from '../../src/ui/civicOverlayContent';
import { REDLINE_OVERLAY_ALPHA } from '../../src/ui/redlineOverlayContent';
import { OVERLAY_ALPHA } from '../../src/ui/ecoOverlayContent';

// The sparse-overlay legibility contract (Maddy: U/V "don't toggle their layer views"). Power and
// coverage tint only a few buildings; they read as a layer view ONLY if those highlights are strong
// AND the rest of the map is dimmed. So: OVERLAY_DIM is a dark, mostly-opaque scrim, and the two
// sparse overlays paint their highlights at a strong alpha that pops over it.
describe('sparse-overlay legibility (dim base + strong highlights)', () => {
  it('OVERLAY_DIM is a dark, mostly-opaque scrim', () => {
    const [r, g, b, a] = OVERLAY_DIM;
    expect(Math.max(r, g, b)).toBeLessThan(40); // near-black: it darkens the city
    expect(a).toBeGreaterThan(0.5); // mostly opaque so the dimmed map recedes
    expect(a).toBeLessThan(1); // still translucent (terrain faintly visible)
  });

  it('power + coverage highlights are strong enough to pop over the scrim', () => {
    expect(POWER_OVERLAY_ALPHA).toBeGreaterThan(0.8);
    expect(COVERAGE_OVERLAY_ALPHA).toBeGreaterThan(0.8);
    expect(powerTint(true)[3]).toBe(POWER_OVERLAY_ALPHA);
    expect(coverageTint(false)[3]).toBe(COVERAGE_OVERLAY_ALPHA);
  });

  // Maddy: "fix overlays" — civic/eco/redline washed out at 0.55. They now use the SAME dim-base +
  // strong-alpha treatment (the dim wiring lives in main.ts; here we pin the strong alpha contract).
  it('civic, eco, and redline highlights are also strong (legible over the scrim)', () => {
    expect(CIVIC_OVERLAY_ALPHA).toBeGreaterThan(0.8);
    expect(OVERLAY_ALPHA).toBeGreaterThan(0.8);
    expect(REDLINE_OVERLAY_ALPHA).toBeGreaterThan(0.8);
  });
});
