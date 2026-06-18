// Redline overlay content: pure presentation for the R-cycled HOLC grade heatmap
// — the four discrete grade bands, their colours and legend. No DOM, no
// transcendental Math (the architecture guard's pure-ui allowlist scans this
// file). This shows the apparatus's discriminatory map CRITICALLY, so the player
// can see WHAT produced the decay. Redlining was the denial of housing: Black
// families were barred from the green/blue (A/B) neighborhoods and segregated into
// the red (D), which were THEN made dumping grounds — the dirty power, industry,
// highways, and disinvestment all follow the red. The map IS the segregation.
//
// The continuous 0..255 grade is bucketed into the four HOLC grades for legibility
// (the historical maps were discrete A/B/C/D, four flat colours). The exclusivity
// composite that walks eco/civic/redline lives in civicOverlayContent; this file
// owns only the redline ramp + legend + view list. UI-layer: no engine/worldgen
// import (the guard forbids it), so the band thresholds live here, not shared with
// worldgen's gradeBucket — a deliberate, tiny duplication that keeps layering clean.

import type { OverlayLegend } from './overlayLegend';

/** The single redline heatmap view (the grade). */
export type RedlineOverlayView = 'grade';
export const REDLINE_VIEWS: readonly RedlineOverlayView[] = ['grade'];

/** Fixed translucency for the redline overlay (matches eco/civic). */
export const REDLINE_OVERLAY_ALPHA = 0.55;

type RGBA = [number, number, number, number];

// HOLC band colours: A "Best" green → B "Still Desirable" blue → C "Definitely
// Declining" yellow → D "Hazardous"/redlined red. Even quarters of 0..255.
const A_GREEN: readonly [number, number, number] = [106, 153, 78];
const B_BLUE: readonly [number, number, number] = [74, 123, 183];
const C_YELLOW: readonly [number, number, number] = [214, 193, 86];
const D_RED: readonly [number, number, number] = [192, 64, 64];

/**
 * The translucent RGBA tint for a Uint8 grade `value` (0..255), bucketed into the
 * four HOLC bands. Clamped + deterministic; alpha is fixed.
 */
export function redlineOverlayTint(value: number): RGBA {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  const band = v < 64 ? A_GREEN : v < 128 ? B_BLUE : v < 192 ? C_YELLOW : D_RED;
  return [band[0], band[1], band[2], REDLINE_OVERLAY_ALPHA];
}

/** The dock legend line for the redline overlay. */
export function redlineLegendLine(_view: RedlineOverlayView): string {
  return 'Redline grade — A greenlined (best) to D redlined (HOLC)';
}

/** The structured colour KEY for the redline overlay: the four HOLC bands as labelled swatches. */
export function redlineLegend(): OverlayLegend {
  return {
    title: 'Redline grade (HOLC)',
    stops: [
      { color: A_GREEN, label: 'A best' },
      { color: B_BLUE, label: 'B' },
      { color: C_YELLOW, label: 'C' },
      { color: D_RED, label: 'D redlined' },
    ],
  };
}
