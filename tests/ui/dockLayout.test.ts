// PR D2 — the pure clamp behind the relocatable dock.

import { describe, it, expect } from 'vitest';
import { clampDockPosition } from '../../src/ui/dockLayout';

describe('clampDockPosition', () => {
  it('leaves an in-bounds position unchanged', () => {
    expect(clampDockPosition(100, 80, 200, 60, 1000, 800)).toEqual({ x: 100, y: 80 });
  });

  it('clamps negative coordinates to 0', () => {
    expect(clampDockPosition(-50, -10, 200, 60, 1000, 800)).toEqual({ x: 0, y: 0 });
  });

  it('clamps past the right/bottom edge so the dock stays fully visible', () => {
    expect(clampDockPosition(950, 790, 200, 60, 1000, 800)).toEqual({ x: 800, y: 740 });
  });

  it('pins to the top-left when the dock is larger than the viewport', () => {
    expect(clampDockPosition(50, 50, 1200, 900, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
});
