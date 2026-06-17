import { describe, it, expect } from 'vitest';
import {
  CIVIC_VIEWS,
  CIVIC_OVERLAY_ALPHA,
  civicOverlayTint,
  civicLegendLine,
  cycleComposite,
  compositeKeyFor,
  type CivicOverlayView,
  type CompositeState,
} from '../../src/ui/civicOverlayContent';

// civicOverlayContent is pure presentation (allowlisted, DOM-free, no
// transcendental Math): the C-overlay views/ramps/legends AND the E/C exclusivity
// composite. The renderer/main wiring is shell glue; only these pure pieces are
// unit-tested.

const ENDPOINTS: Record<CivicOverlayView, { lo: readonly number[]; hi: readonly number[] }> = {
  belonging: { lo: [70, 54, 64], hi: [245, 185, 70] }, // muted → warm amber
  voice: { lo: [120, 60, 180], hi: [56, 200, 210] }, // violet → cyan
  trust: { lo: [78, 92, 112], hi: [226, 190, 78] }, // slate → gold
};

describe('CIVIC_VIEWS + civicOverlayTint ramps', () => {
  it('is the three civic views in order', () => {
    expect(CIVIC_VIEWS).toEqual(['belonging', 'voice', 'trust']);
  });

  it('maps value 0 → low endpoint and 255 → high endpoint per view, fixed alpha', () => {
    for (const view of CIVIC_VIEWS) {
      const { lo, hi } = ENDPOINTS[view];
      const t0 = civicOverlayTint(view, 0);
      const t255 = civicOverlayTint(view, 255);
      expect([t0[0], t0[1], t0[2]]).toEqual([lo[0], lo[1], lo[2]]);
      expect([t255[0], t255[1], t255[2]]).toEqual([hi[0], hi[1], hi[2]]);
      expect(t0[3]).toBe(CIVIC_OVERLAY_ALPHA);
      expect(t255[3]).toBe(CIVIC_OVERLAY_ALPHA);
    }
  });

  it('value 128 lies between the endpoints on every channel and stays in byte range', () => {
    for (const view of CIVIC_VIEWS) {
      const { lo, hi } = ENDPOINTS[view];
      const t = civicOverlayTint(view, 128);
      for (let c = 0; c < 3; c++) {
        expect(t[c]).toBeGreaterThanOrEqual(Math.min(lo[c]!, hi[c]!));
        expect(t[c]).toBeLessThanOrEqual(Math.max(lo[c]!, hi[c]!));
      }
    }
  });

  it('clamps out-of-domain values and is deterministic', () => {
    for (const view of CIVIC_VIEWS) {
      expect(civicOverlayTint(view, -5)).toEqual(civicOverlayTint(view, 0));
      expect(civicOverlayTint(view, 999)).toEqual(civicOverlayTint(view, 255));
      expect(civicOverlayTint(view, 100)).toEqual(civicOverlayTint(view, 100));
    }
  });
});

describe('civicLegendLine', () => {
  it('returns a distinct, non-empty line per view', () => {
    const seen = new Set(CIVIC_VIEWS.map((v) => civicLegendLine(v)));
    expect(seen.size).toBe(CIVIC_VIEWS.length);
    for (const v of CIVIC_VIEWS) expect(civicLegendLine(v).length).toBeGreaterThan(0);
  });
});

describe('cycleComposite: E/C exclusivity truth table', () => {
  const eco = (view: string): CompositeState => ({ kind: 'eco', view });
  const civic = (view: string): CompositeState => ({ kind: 'civic', view });

  it('pressing eco from off / advances within / off-wraps', () => {
    expect(cycleComposite(null, 'eco')).toEqual(eco('soil'));
    expect(cycleComposite(eco('soil'), 'eco')).toEqual(eco('flora'));
    expect(cycleComposite(eco('fauna'), 'eco')).toEqual(eco('biodiversity'));
    expect(cycleComposite(eco('biodiversity'), 'eco')).toBeNull();
  });

  it('pressing civic from off / advances within / off-wraps', () => {
    expect(cycleComposite(null, 'civic')).toEqual(civic('belonging'));
    expect(cycleComposite(civic('belonging'), 'civic')).toEqual(civic('voice'));
    expect(cycleComposite(civic('voice'), 'civic')).toEqual(civic('trust'));
    expect(cycleComposite(civic('trust'), 'civic')).toBeNull();
  });

  it('EXCLUSIVITY: pressing the OTHER key replaces the active overlay at its first view', () => {
    // E-then-C clears eco → civic-belonging
    expect(cycleComposite(eco('flora'), 'civic')).toEqual(civic('belonging'));
    // C-then-E clears civic → eco-soil
    expect(cycleComposite(civic('voice'), 'eco')).toEqual(eco('soil'));
  });

  it('redline is a single-view kind that off-wraps and obeys exclusivity', () => {
    const redline = (view: string): CompositeState => ({ kind: 'redline', view });
    expect(cycleComposite(null, 'redline')).toEqual(redline('grade'));
    expect(cycleComposite(redline('grade'), 'redline')).toBeNull(); // one view → off-wrap
    // exclusivity both ways
    expect(cycleComposite(civic('voice'), 'redline')).toEqual(redline('grade'));
    expect(cycleComposite(redline('grade'), 'eco')).toEqual(eco('soil'));
  });
});

describe('compositeKeyFor: shared E/C/R gate', () => {
  it('maps e/E → eco, c/C → civic, r/R → redline, suppressed under the opening overlay', () => {
    expect(compositeKeyFor('e', false)).toBe('eco');
    expect(compositeKeyFor('E', false)).toBe('eco');
    expect(compositeKeyFor('c', false)).toBe('civic');
    expect(compositeKeyFor('C', false)).toBe('civic');
    expect(compositeKeyFor('r', false)).toBe('redline');
    expect(compositeKeyFor('R', false)).toBe('redline');
    expect(compositeKeyFor('t', false)).toBeNull();
    expect(compositeKeyFor('Enter', false)).toBeNull();
    expect(compositeKeyFor('e', true)).toBeNull(); // opening active suppresses all
    expect(compositeKeyFor('r', true)).toBeNull();
  });
});
