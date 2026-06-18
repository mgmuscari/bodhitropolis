import { describe, it, expect } from 'vitest';
import {
  REDLINE_VIEWS,
  REDLINE_OVERLAY_ALPHA,
  redlineOverlayTint,
  redlineLegendLine,
} from '../../src/ui/redlineOverlayContent';

// redlineOverlayContent is pure presentation (allowlisted, DOM-free, no
// transcendental Math): the HOLC grade heatmap. The grade is the apparatus's
// discriminatory map, shown CRITICALLY so the player can see what produced the
// decay. Four discrete HOLC bands over the continuous 0..255 grade: A green
// (best) → B blue → C yellow → D red (redlined). The renderer reads each tile's
// map.redline value per frame; main wires it into the composite overlay.

// Expected HOLC band colours (greenlined → redlined).
const A_GREEN = [106, 153, 78];
const B_BLUE = [74, 123, 183];
const C_YELLOW = [214, 193, 86];
const D_RED = [192, 64, 64];

describe('REDLINE_VIEWS', () => {
  it('is the single grade view', () => {
    expect(REDLINE_VIEWS).toEqual(['grade']);
  });
});

describe('redlineOverlayTint — discrete HOLC bands', () => {
  it('maps each quarter of the grade to its HOLC band colour, fixed alpha', () => {
    const rgb = (v: number) => {
      const t = redlineOverlayTint(v);
      return [t[0], t[1], t[2]];
    };
    expect(rgb(30)).toEqual(A_GREEN); // A: best
    expect(rgb(96)).toEqual(B_BLUE); // B: still desirable
    expect(rgb(160)).toEqual(C_YELLOW); // C: declining
    expect(rgb(240)).toEqual(D_RED); // D: redlined
    expect(redlineOverlayTint(240)[3]).toBe(REDLINE_OVERLAY_ALPHA);
  });

  it('places the band boundaries at the even quarters (64/128/192)', () => {
    const rgb = (v: number) => {
      const t = redlineOverlayTint(v);
      return [t[0], t[1], t[2]];
    };
    expect(rgb(63)).toEqual(A_GREEN);
    expect(rgb(64)).toEqual(B_BLUE);
    expect(rgb(127)).toEqual(B_BLUE);
    expect(rgb(128)).toEqual(C_YELLOW);
    expect(rgb(191)).toEqual(C_YELLOW);
    expect(rgb(192)).toEqual(D_RED);
  });

  it('clamps out-of-domain values and is deterministic', () => {
    expect(redlineOverlayTint(-5)).toEqual(redlineOverlayTint(0));
    expect(redlineOverlayTint(999)).toEqual(redlineOverlayTint(255));
    expect(redlineOverlayTint(150)).toEqual(redlineOverlayTint(150));
  });
});

describe('redlineLegendLine', () => {
  it('returns a non-empty line naming the grade', () => {
    const line = redlineLegendLine('grade');
    expect(line.length).toBeGreaterThan(0);
    expect(line.toLowerCase()).toContain('redline');
  });
});
