import { describe, it, expect } from 'vitest';
import {
  COVERAGE_VIEWS,
  COVERAGE_OVERLAY_ALPHA,
  coverageTint,
  coverageLegend,
} from '../../src/ui/coverageOverlayContent';

describe('coverage overlay content', () => {
  it('is the single coverage view', () => {
    expect(COVERAGE_VIEWS).toEqual(['coverage']);
  });

  it('tints served green and under-served red, fixed alpha', () => {
    const served = coverageTint(true);
    const under = coverageTint(false);
    expect(served[1]).toBeGreaterThan(served[0]); // green-dominant
    expect(under[0]).toBeGreaterThan(under[1]); // red-dominant
    expect(served[3]).toBe(COVERAGE_OVERLAY_ALPHA);
  });

  it('legend names served vs under-served', () => {
    const lg = coverageLegend();
    expect(lg.stops.map((s) => s.label)).toEqual(['served', 'under-served']);
  });
});
