// Civic overlay content: pure presentation for the C-cycled neighborhood heatmap
// — the three views, their value→colour ramps and legends — AND the E/C
// exclusivity composite (cycleComposite + the shared key gate). No DOM, no
// transcendental Math (the architecture guard's pure-ui allowlist scans this
// file). It imports the ecology view list (OVERLAY_VIEWS) so the composite cycle
// can walk both dimensions; ecoOverlayContent never imports civic, so there is no
// cycle. The renderer/main shell consumes these; keeping the cycle/ramps/gate
// here lets them be unit-tested rather than left to manual QA.

import { OVERLAY_VIEWS } from './ecoOverlayContent';
import { REDLINE_VIEWS } from './redlineOverlayContent';

/** The three civic heatmap views, in cycle order. */
export type CivicOverlayView = 'belonging' | 'voice' | 'trust';
export const CIVIC_VIEWS: readonly CivicOverlayView[] = ['belonging', 'voice', 'trust'];

/** Fixed translucency for every civic overlay tint (matches the ecology overlay). */
export const CIVIC_OVERLAY_ALPHA = 0.55;

type RGB = readonly [number, number, number];

// Pinned value→colour ramps (Uint8 input domain). Value 0 → lo, 255 → hi; the
// renderer reads each tile's neighborhood value per frame, so the tint tracks
// the civic cadence.
const RAMPS: Record<CivicOverlayView, { lo: RGB; hi: RGB }> = {
  belonging: { lo: [70, 54, 64], hi: [245, 185, 70] }, // muted → warm amber (held)
  voice: { lo: [120, 60, 180], hi: [56, 200, 210] }, // violet (quiet) → cyan (heard)
  trust: { lo: [78, 92, 112], hi: [226, 190, 78] }, // slate (wary) → gold (trusting)
};

/** Integer lerp from a to b over the Uint8 domain (floor — value 0→a, 255→b). */
function lerp(a: number, b: number, value: number): number {
  return a + Math.floor(((b - a) * value) / 255);
}

/**
 * The translucent RGBA tint for `view` at a Uint8 `value` (0..255). Endpoints are
 * exact (0 → lo, 255 → hi); alpha is fixed. Integer-only, deterministic.
 */
export function civicOverlayTint(
  view: CivicOverlayView,
  value: number,
): [number, number, number, number] {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  const { lo, hi } = RAMPS[view];
  return [lerp(lo[0], hi[0], v), lerp(lo[1], hi[1], v), lerp(lo[2], hi[2], v), CIVIC_OVERLAY_ALPHA];
}

const LEGENDS: Record<CivicOverlayView, string> = {
  belonging: 'Belonging — adrift to held',
  voice: 'Voice — unheard to heard',
  trust: 'Trust — wary to trusting',
};

/** The dock legend line for an active civic overlay view. */
export function civicLegendLine(view: CivicOverlayView): string {
  return LEGENDS[view];
}

// --- E/C exclusivity composite -------------------------------------------
//
// A single composite overlay state replaces the two independent overlay states:
// at most ONE of eco / civic is active at a time. Pressing a kind's key cycles
// WITHIN that kind (off → first → … → last → off); pressing the OTHER kind's key
// replaces the active overlay at the other kind's first view (exclusivity).

/** Which overlay dimension is active. */
export type OverlayKind = 'eco' | 'civic' | 'redline';

/** The single active overlay (kind + view), or null (both off). */
export interface CompositeOverlay {
  kind: OverlayKind;
  /** A view of the active kind (an OverlayView or a CivicOverlayView). */
  view: string;
}
export type CompositeState = CompositeOverlay | null;

function viewsFor(kind: OverlayKind): readonly string[] {
  return kind === 'eco' ? OVERLAY_VIEWS : kind === 'civic' ? CIVIC_VIEWS : REDLINE_VIEWS;
}

/**
 * Cycle the composite overlay on a key press for `pressed` (eco / civic):
 *  - off, or the OTHER kind active ⇒ switch to `pressed` at its FIRST view
 *    (exclusivity — the other kind is cleared);
 *  - the same kind active ⇒ advance to its next view, or off past the last.
 * Pure; the shell calls this and re-points the renderer overlay source.
 */
export function cycleComposite(current: CompositeState, pressed: OverlayKind): CompositeState {
  const views = viewsFor(pressed);
  if (current === null || current.kind !== pressed) {
    return { kind: pressed, view: views[0]! };
  }
  const i = views.indexOf(current.view);
  if (i === views.length - 1) return null; // off-wrap
  return { kind: pressed, view: views[i + 1]! };
}

/**
 * The shared input gate: which overlay dimension a key press targets, suppressed
 * while the opening overlay is up (it owns its own keydown). `e`/`E` → eco,
 * `c`/`C` → civic, `r`/`R` → redline, anything else → null.
 */
export function compositeKeyFor(key: string, openingActive: boolean): OverlayKind | null {
  if (openingActive) return null;
  if (key === 'e' || key === 'E') return 'eco';
  if (key === 'c' || key === 'C') return 'civic';
  if (key === 'r' || key === 'R') return 'redline';
  return null;
}
