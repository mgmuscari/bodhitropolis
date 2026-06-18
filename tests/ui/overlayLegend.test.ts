import { describe, it, expect } from 'vitest';
import { ecoLegend } from '../../src/ui/ecoOverlayContent';
import { civicLegend } from '../../src/ui/civicOverlayContent';
import { redlineLegend } from '../../src/ui/redlineOverlayContent';
import { policeLegend } from '../../src/ui/policeViolenceOverlayContent';

// Every overlay exposes a structured colour KEY (title + labelled swatches) so the shell can draw
// a visible legend. Continuous overlays give two stops (lo→hi); redline gives its four HOLC bands.

describe('overlay legends — structured colour keys', () => {
  it('eco legend has a title and a low→high pair matching the ramp endpoints', () => {
    const lg = ecoLegend('soil');
    expect(lg.title).toBe('Soil health');
    expect(lg.stops).toHaveLength(2);
    expect(lg.stops[0]!.color).toEqual([120, 82, 48]); // lo (broken brown)
    expect(lg.stops[1]!.color).toEqual([80, 170, 80]); // hi (living green)
    expect(lg.stops[0]!.label).toBe('broken');
    expect(lg.stops[1]!.label).toBe('living');
  });

  it('civic legend gives a labelled low→high pair', () => {
    const lg = civicLegend('belonging');
    expect(lg.title).toBe('Belonging');
    expect(lg.stops.map((s) => s.label)).toEqual(['adrift', 'held']);
  });

  it('redline legend gives the four HOLC bands A→D', () => {
    const lg = redlineLegend();
    expect(lg.stops).toHaveLength(4);
    expect(lg.stops.map((s) => s.label)).toEqual(['A best', 'B', 'C', 'D redlined']);
    expect(lg.stops[3]!.color).toEqual([192, 64, 64]); // D = red
  });

  it('police legend names the inverse of a crime map with a less→more pair', () => {
    const lg = policeLegend();
    expect(lg.title.toLowerCase()).toContain('crime map');
    expect(lg.stops).toHaveLength(2);
  });
});
