// Coverage overlay content: pure presentation for the V-cycled fire/health SERVICE COVERAGE map —
// developed plots tinted green where a fire station / healing commons is in reach, red where they
// are UNDER-SERVED. The redlined districts (which worldgen left without stations) read red until the
// player extends coverage. No DOM, no transcendental Math (the architecture guard's allowlist scans
// this file). The renderer reads ambient.coverage; this module owns the colours + legend + view.

import type { OverlayLegend } from './overlayLegend';

/** The single coverage view. */
export type CoverageOverlayView = 'coverage';
export const COVERAGE_VIEWS: readonly CoverageOverlayView[] = ['coverage'];

/** Fixed translucency for the coverage overlay (matches the others). */
export const COVERAGE_OVERLAY_ALPHA = 0.5;

type RGBA = [number, number, number, number];

const SERVED: readonly [number, number, number] = [70, 170, 90]; // a station is in reach
const UNDER: readonly [number, number, number] = [200, 70, 60]; // under-served (no station near)

/** The tint for a developed plot: green if `served`, red if under-served. Fixed alpha. */
export function coverageTint(served: boolean): RGBA {
  const c = served ? SERVED : UNDER;
  return [c[0], c[1], c[2], COVERAGE_OVERLAY_ALPHA];
}

/** The dock legend line for the coverage overlay. */
export function coverageLegendLine(_view: CoverageOverlayView): string {
  return 'Service coverage — served (green) vs under-served (red)';
}

/** The structured colour KEY for the coverage overlay. */
export function coverageLegend(): OverlayLegend {
  return {
    title: 'Fire/health coverage',
    stops: [
      { color: SERVED, label: 'served' },
      { color: UNDER, label: 'under-served' },
    ],
  };
}
