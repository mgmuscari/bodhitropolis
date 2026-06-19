import { describe, it, expect } from 'vitest';
import { CONTROLS, POINTER_HINTS, controlsLines } from '../../src/ui/controlsContent';

describe('controls reference (the on-screen keybinding help)', () => {
  it('lists every key binding with a key and a human label', () => {
    expect(CONTROLS.length).toBeGreaterThan(5);
    for (const b of CONTROLS) {
      expect(b.key.length).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
    }
  });

  it('documents the settings menu (the trigger for this feature) and the help key itself', () => {
    expect(CONTROLS.some((b) => b.key === ',' && /setting/i.test(b.label))).toBe(true);
    expect(CONTROLS.some((b) => b.key === '?')).toBe(true);
  });

  it('documents the mouse interactions too (pan / zoom / use tool)', () => {
    const joined = POINTER_HINTS.join(' ').toLowerCase();
    expect(joined).toMatch(/pan/);
    expect(joined).toMatch(/zoom/);
    expect(joined).toMatch(/tool/);
  });

  it('formats one aligned line per binding, key before label', () => {
    const lines = controlsLines();
    expect(lines.length).toBe(CONTROLS.length + POINTER_HINTS.length);
    const settings = lines.find((l) => /setting/i.test(l));
    expect(settings).toContain(',');
    // key column comes before the label
    expect(settings!.indexOf(',')).toBeLessThan(settings!.toLowerCase().indexOf('setting'));
  });
});
