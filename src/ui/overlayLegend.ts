// Shared overlay-legend shape: the data a visible colour KEY needs (the ramp/band swatches with
// their labels), so each overlay can describe its own legend and the shell renders one widget for
// all of them. Pure types + nothing else — no DOM, no transcendental Math (allowlist-scanned).
//
// A continuous overlay (eco/civic/police) returns two stops (lo → hi); a discrete one (redline)
// returns its bands (A..D). The widget draws each stop's colour swatch beside its label.

export interface LegendStop {
  /** The swatch colour (RGB, 0..255). */
  color: readonly [number, number, number];
  /** The label shown beside the swatch (e.g. "broken", "living", "D redlined"). */
  label: string;
}

export interface OverlayLegend {
  /** What the map shows (e.g. "Soil health", "Redline grade (HOLC)"). */
  title: string;
  /** Ordered stops, low→high (continuous) or A→D (discrete bands). */
  stops: readonly LegendStop[];
}

/** The scrim a SPARSE overlay (power, coverage — it tints only certain buildings) lays over every
 *  OTHER tile, so its handful of strong highlights read as a layer view instead of washing into the
 *  green terrain. A near-black, mostly-opaque dim: the city goes dark and only the powered/served
 *  plots glow. (A field overlay — eco/civic/redline — fills the map already and sets no dimBase.) */
export const OVERLAY_DIM: readonly [number, number, number, number] = [6, 8, 14, 0.66];
