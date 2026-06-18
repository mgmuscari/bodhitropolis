import { describe, it, expect } from 'vitest';
import {
  POLICE_VIEWS,
  POLICE_OVERLAY_ALPHA,
  policeViolenceTint,
  policeLegendLine,
} from '../../src/ui/policeViolenceOverlayContent';

// The Police Violence map — the inverse of a crime map. Pure presentation (allowlisted, DOM-free,
// no transcendental Math): a blood-red ramp over the live policeViolence field. Drawn per-frame by
// the renderer; only the ramp + legend + view live here.

describe('POLICE_VIEWS', () => {
  it('is the single violence view', () => {
    expect(POLICE_VIEWS).toEqual(['violence']);
  });
});

describe('policeViolenceTint', () => {
  it('deepens from faint maroon to vivid crimson as violence accumulates, fixed alpha', () => {
    const lo = policeViolenceTint(20);
    const hi = policeViolenceTint(255);
    expect(hi[0]).toBeGreaterThan(lo[0]); // brighter red with more violence
    expect(hi[3]).toBe(POLICE_OVERLAY_ALPHA);
    expect(lo[3]).toBe(POLICE_OVERLAY_ALPHA);
    // It is red-dominant (a crime-map colour, turned on the police).
    expect(hi[0]).toBeGreaterThan(hi[1]);
    expect(hi[0]).toBeGreaterThan(hi[2]);
  });

  it('clamps out-of-domain values and is deterministic', () => {
    expect(policeViolenceTint(-5)).toEqual(policeViolenceTint(0));
    expect(policeViolenceTint(999)).toEqual(policeViolenceTint(255));
    expect(policeViolenceTint(120)).toEqual(policeViolenceTint(120));
  });
});

describe('policeLegendLine', () => {
  it('names the state as the source of the harm', () => {
    const line = policeLegendLine('violence');
    expect(line.toLowerCase()).toContain('police violence');
    expect(line.toLowerCase()).toContain('state does harm');
    expect(line.toLowerCase()).not.toContain('crime map'); // Maddy: drop the parenthetical
  });
});
