// Police-violence overlay content: pure presentation for the P-cycled "Police Violence" map —
// the INVERSE of a crime map. A traditional city-builder paints neighborhoods red to mark
// RESIDENTS as dangerous (justifying more police); this map paints where the STATE inflicts
// violence (arrests), so the gaze falls on the apparatus, not the policed. The stain concentrates
// in the redlined districts, because that is where the cruisers hunt. No DOM, no transcendental
// Math (the architecture guard's pure-ui allowlist scans this file).
//
// The field is live (laid on arrest, decays slowly), so the renderer draws this PER FRAME from
// ambient.policeViolence rather than baking it into the cached base — this module owns only the
// value→colour ramp + legend + the single view, unit-tested rather than left to manual QA.

/** The single police-violence view. */
export type PoliceOverlayView = 'violence';
export const POLICE_VIEWS: readonly PoliceOverlayView[] = ['violence'];

/** Translucency for the police-violence stain (a touch heavier than the eco/civic overlays). */
export const POLICE_OVERLAY_ALPHA = 0.6;

type RGBA = [number, number, number, number];

// Blood-red ramp: faint maroon where a single arrest fell, vivid crimson where the violence is
// concentrated. (Red — the crime-map colour — turned back on the police.)
const LO: readonly [number, number, number] = [96, 8, 16];
const HI: readonly [number, number, number] = [255, 40, 40];

const lerp = (a: number, b: number, t: number): number => a + Math.floor(((b - a) * t) / 255);

/**
 * The translucent RGBA stain for a 0..255 police-violence `value`. Clamped + deterministic; alpha
 * is fixed. The renderer skips tiles with value 0 (the field is sparse), so this only colours where
 * the state has done harm.
 */
export function policeViolenceTint(value: number): RGBA {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  return [lerp(LO[0], HI[0], v), lerp(LO[1], HI[1], v), lerp(LO[2], HI[2], v), POLICE_OVERLAY_ALPHA];
}

/** The dock legend line for the police-violence overlay. */
export function policeLegendLine(_view: PoliceOverlayView): string {
  return 'Police violence — where the state does harm (not a crime map)';
}
