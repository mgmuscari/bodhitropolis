// Ecology overlay content: pure presentation for the E-cycled heatmap overlay —
// the view cycle, the E-key gate, the value→colour ramps, and the legend copy.
// No DOM, no transcendental Math (the architecture guard's pure-ui allowlist
// scans this file). The renderer/main shell consumes these; keeping them here
// lets the cycle/gate/ramps be unit-tested rather than left to manual QA.

/** The four ecology heatmap views, in cycle order. */
export type OverlayView = 'soil' | 'flora' | 'fauna' | 'biodiversity';
export const OVERLAY_VIEWS: readonly OverlayView[] = ['soil', 'flora', 'fauna', 'biodiversity'];

/** Overlay state: an active view, or null (overlay off). */
export type OverlayState = OverlayView | null;

/** Fixed translucency for every overlay tint (the tint sits under the preview). */
export const OVERLAY_ALPHA = 0.55;

/**
 * Cycle the overlay: off → soil → flora → fauna → biodiversity → off. Pure; the
 * shell calls this on each E press and re-points the renderer overlay source.
 */
export function cycleOverlay(current: OverlayState): OverlayState {
  if (current === null) return OVERLAY_VIEWS[0]!;
  const i = OVERLAY_VIEWS.indexOf(current);
  return i === OVERLAY_VIEWS.length - 1 ? null : OVERLAY_VIEWS[i + 1]!;
}

/**
 * Pure input gate for the overlay's `E` cycle — true iff `key` is `e`/`E` AND no
 * opening overlay is active (which owns its own keydown). Mirrors
 * shouldTogglePanel so the suppression-under-opening rule is unit-tested.
 */
export function shouldCycleOverlay(key: string, openingActive: boolean): boolean {
  return (key === 'e' || key === 'E') && !openingActive;
}

type RGB = readonly [number, number, number];

// Pinned value→colour ramps (Uint8 input domain). Value 0 → lo, 255 → hi; the
// renderer reads the LIVE layer (or biodiversity field) per tile, so the tint
// tracks each ecology tick.
const RAMPS: Record<OverlayView, { lo: RGB; hi: RGB }> = {
  soil: { lo: [120, 82, 48], hi: [80, 170, 80] }, // broken brown → living green
  flora: { lo: [210, 216, 180], hi: [28, 120, 44] }, // bare → deep canopy
  fauna: { lo: [228, 214, 176], hi: [210, 120, 40] }, // quiet → teeming amber
  biodiversity: { lo: [120, 72, 176], hi: [226, 200, 64] }, // violet → gold
};

/** Integer lerp from a to b over the Uint8 domain (floor — value 0→a, 255→b). */
function lerp(a: number, b: number, value: number): number {
  return a + Math.floor(((b - a) * value) / 255);
}

/**
 * The translucent RGBA tint for `view` at a Uint8 `value` (0..255). Endpoints are
 * exact (0 → lo, 255 → hi); alpha is fixed. Integer-only, deterministic.
 */
export function overlayTint(view: OverlayView, value: number): [number, number, number, number] {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  const { lo, hi } = RAMPS[view];
  return [lerp(lo[0], hi[0], v), lerp(lo[1], hi[1], v), lerp(lo[2], hi[2], v), OVERLAY_ALPHA];
}

const LEGENDS: Record<OverlayView, string> = {
  soil: 'Soil health — broken brown to living green',
  flora: 'Flora vitality — bare ground to deep canopy',
  fauna: 'Fauna presence — quiet to teeming',
  biodiversity: 'Biodiversity — Simpson index, violet to gold',
};

/** The dock legend line for an active overlay view. */
export function legendLine(view: OverlayView): string {
  return LEGENDS[view];
}
