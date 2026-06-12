import { describe, it, expect } from 'vitest';
import { pulseLine } from '../../src/ui/pulseContent';

// pulseContent is pure presentation (allowlisted, DOM-free): the always-on dock
// pulse line over the effort-composite wellbeing scalar, with a trend glyph
// comparing the current wellbeing to the previous civic-cadence wellbeing.

describe('pulseLine', () => {
  it('shows the wellbeing scalar with a flat arrow when there is no prior (null)', () => {
    expect(pulseLine(42, null)).toBe('Wellbeing 42 →');
  });

  it('is flat when wellbeing is unchanged', () => {
    expect(pulseLine(42, 42)).toBe('Wellbeing 42 →');
  });

  it('rises (↗) when the current wellbeing exceeds the previous', () => {
    expect(pulseLine(45, 42)).toBe('Wellbeing 45 ↗');
  });

  it('falls (↘) when the current wellbeing is below the previous', () => {
    expect(pulseLine(38, 42)).toBe('Wellbeing 38 ↘');
  });

  it('labels N with the composite wellbeing passed in (not a civic mean)', () => {
    expect(pulseLine(7, null)).toContain('Wellbeing 7');
    expect(pulseLine(123, 100)).toContain('Wellbeing 123');
  });

  it('never shows a spurious arrow on the first cadence (null → flat, not ↗)', () => {
    expect(pulseLine(0, null)).toBe('Wellbeing 0 →');
    expect(pulseLine(99, null)).not.toContain('↗');
    expect(pulseLine(99, null)).not.toContain('↘');
  });
});
