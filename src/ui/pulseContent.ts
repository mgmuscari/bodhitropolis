// Pulse line content: the pure, always-on dock readout of the city's wellbeing —
// the effort-composite `wellbeing(world)` scalar (NOT a civic mean: the PRD's
// "wellbeing" IS the composite, and the pulse line cannot derive it from the
// civic report alone, which lacks parcel count / condition / ecology). No DOM, no
// transcendental Math (the architecture guard's pure-ui allowlist scans this
// file). The shell computes the wellbeing scalar and feeds it here on the civic
// cadence; this module just formats it with a trend glyph.

/**
 * The dock pulse line: `Wellbeing N ↗/→/↘`, where N is the current
 * effort-composite wellbeing and the glyph compares it to the previous
 * civic-cadence wellbeing. `prevWellbeing === null` (no prior — before the first
 * civic cadence) is FLAT `→`, never a spurious arrow; equal is also flat.
 */
export function pulseLine(wellbeing: number, prevWellbeing: number | null): string {
  let trend = '→';
  if (prevWellbeing !== null) {
    if (wellbeing > prevWellbeing) trend = '↗';
    else if (wellbeing < prevWellbeing) trend = '↘';
  }
  return `Wellbeing ${wellbeing} ${trend}`;
}
