// Power overlay content: pure presentation for the U-cycled power-grid map — consumer plots tinted
// green where the grid powers them, red where they sit dark (a plantless component, or browned out
// past capacity). No DOM, no transcendental Math (the architecture guard's allowlist scans this
// file). The renderer/main shell reads the live power grid; this module owns the colours + legend.

import type { OverlayLegend } from './overlayLegend';

/** The single power view. */
export type PowerOverlayView = 'power';
export const POWER_VIEWS: readonly PowerOverlayView[] = ['power'];

/** Strong translucency: power tints only sparse consumer plots, so they pop OVER the dimmed
 *  (scrimmed) base rather than washing into the terrain (see OverlaySource.dimBase / OVERLAY_DIM). */
export const POWER_OVERLAY_ALPHA = 0.92;

type RGBA = [number, number, number, number];

const POWERED: readonly [number, number, number] = [90, 180, 110]; // on the grid
const DARK: readonly [number, number, number] = [200, 90, 60]; // unpowered / dark

/** The tint for a consumer plot: green if `powered`, red if dark. Fixed alpha. */
export function powerTint(powered: boolean): RGBA {
  const c = powered ? POWERED : DARK;
  return [c[0], c[1], c[2], POWER_OVERLAY_ALPHA];
}

/** The dock legend line for the power overlay. */
export function powerLegendLine(_view: PowerOverlayView): string {
  return 'Power grid — powered (green) vs dark (red)';
}

/** The structured colour KEY for the power overlay. */
export function powerLegend(): OverlayLegend {
  return {
    title: 'Power grid',
    stops: [
      { color: POWERED, label: 'powered' },
      { color: DARK, label: 'dark' },
    ],
  };
}
