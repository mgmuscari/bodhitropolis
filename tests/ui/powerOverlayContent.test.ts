import { describe, it, expect } from 'vitest';
import {
  POWER_VIEWS,
  POWER_OVERLAY_ALPHA,
  powerTint,
  powerLegend,
} from '../../src/ui/powerOverlayContent';

describe('power overlay content', () => {
  it('is the single power view', () => {
    expect(POWER_VIEWS).toEqual(['power']);
  });

  it('tints powered green and dark red, fixed alpha', () => {
    const on = powerTint(true);
    const off = powerTint(false);
    expect(on[1]).toBeGreaterThan(on[0]); // green-dominant
    expect(off[0]).toBeGreaterThan(off[1]); // red-dominant
    expect(on[3]).toBe(POWER_OVERLAY_ALPHA);
  });

  it('legend names powered vs dark', () => {
    expect(powerLegend().stops.map((s) => s.label)).toEqual(['powered', 'dark']);
  });
});
