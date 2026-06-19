// Unhoused residents (FIRST CUT — flagged for Maddy's design review): the pure derivation + indicator
// for residents displaced from housing. The seeded census (`households`) is the city's housing
// CAPACITY; live `occupancy` is who actually lives there now. As homes decay / empty / are demolished
// (the decline spiral, arrests, abandonment), occupancy falls below capacity — those people are the
// DISPLACED / unhoused. The count is loop-coupled: decline raises it, revival (healing + new housing)
// lowers it, so "build housing / heal homes" is the legible counter-move.
//
// SCOPE of this first cut: a derived COUNT + a down-is-good indicator only. The deeper mechanics Maddy
// left open — visible sheltering agents (encampments in parks/streets), civic-voice / police-harm ties,
// explicit displacement transitions — are intentionally NOT modelled here; see
// docs/design/unhoused-residents.md. Pure: no DOM, no transcendental Math (pure-ui allowlist).

import type { AmbientState } from './ambientContent';

export interface UnhousedSample {
  /** Total housing capacity — the seeded census population (sum of household counts). */
  baseline: number;
  /** Residents currently housed (per-home occupancy, capped at each home's capacity). */
  housed: number;
  /** Residents displaced from housing: the per-home shortfall, summed. A home OVER capacity (in-
   *  migration) does NOT offset another home's loss — displacement is local, not netted away. */
  unhoused: number;
}

/**
 * Derive the displacement sample from the published census vs the live occupancy. Per home:
 * `min(occupancy, capacity)` are housed; `max(0, capacity − occupancy)` are displaced. A home with no
 * live occupancy entry yet (not sampled) is assumed housed at capacity, so a just-loaded city reads
 * zero unhoused rather than a phantom full deficit. `mapWidth` keys occupancy (y·width + x).
 */
export function sampleUnhoused(state: AmbientState, mapWidth: number): UnhousedSample {
  let baseline = 0;
  let housed = 0;
  for (const h of state.households ?? []) {
    baseline += h.count;
    const occ = state.occupancy.get(h.y * mapWidth + h.x);
    const here = occ === undefined ? h.count : Math.round(occ);
    housed += here < h.count ? here : h.count; // capped at capacity — no over-capacity offset
  }
  return { baseline, housed, unhoused: baseline - housed > 0 ? baseline - housed : 0 };
}

/** The always-on indicator suffix: `Unhoused N` with a DOWN-is-good arrow vs the previous sample
 *  (↓ = fewer displaced, your housing is working; ↑ = more, displacement worsening; none = flat/no
 *  prior). Down-is-good because for a COUNT of harm, falling is the improvement. */
export function unhousedSuffix(count: number, prev: number | null): string {
  let arrow = '';
  if (prev !== null && count !== prev) arrow = count < prev ? ' ↓' : ' ↑';
  return `Unhoused ${count}${arrow}`;
}
