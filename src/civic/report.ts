// Civic report: a pure, deterministic read over CivicState + the live partition,
// the sibling of the ecology/blight reports. It feeds the dock pulse line and any
// civic HUD, and its citywide means feed the wellbeing composition (effort.ts
// consumes them STRUCTURALLY — as plain numbers — so src/tech never imports civic).
//
// Pure module: no DOM, no rng, no transcendental Math (the architecture guard
// scans src/civic). Every divide is guarded so a no-neighborhood world yields
// exact 0 means and an empty row list, never NaN. Means are FLOATS (divided
// without flooring, mirroring EcologyReport) — the wellbeing composition floors
// them on the consuming side.

import type { CivicState } from './state';
import type { NeighborhoodMap } from './neighborhoods';

/** One neighborhood's row: its id, anchor, and the three civic scalars. */
export interface CivicNeighborhoodRow {
  id: number;
  anchor: number;
  belonging: number;
  voice: number;
  trust: number;
}

export interface CivicReport {
  /** Number of neighborhoods (rows). */
  count: number;
  /** One row per neighborhood, in id order. */
  neighborhoods: CivicNeighborhoodRow[];
  /** Citywide belonging mean (float); 0 when there are no neighborhoods. */
  belongingMean: number;
  /** Citywide voice mean (float); 0 when there are no neighborhoods. */
  voiceMean: number;
  /** Citywide trust mean (float); 0 when there are no neighborhoods. */
  trustMean: number;
}

/**
 * Build the civic report over `civic` paired with the live `partition` (for each
 * row's anchor). Rows follow neighborhood id order; citywide means are float
 * averages, divide-guarded to exact 0 on the empty world. Degenerate-safe: no
 * neighborhoods ⇒ empty rows + zero means, never NaN.
 */
export function civicReport(civic: CivicState, partition: NeighborhoodMap): CivicReport {
  const count = civic.count();
  const rows: CivicNeighborhoodRow[] = [];
  let bSum = 0;
  let vSum = 0;
  let tSum = 0;
  for (let k = 0; k < count; k++) {
    const id = k + 1;
    const { belonging, voice, trust } = civic.getValues(id);
    const anchor = partition.neighborhoods[k]?.anchor ?? 0;
    rows.push({ id, anchor, belonging, voice, trust });
    bSum += belonging;
    vSum += voice;
    tSum += trust;
  }
  return {
    count,
    neighborhoods: rows,
    belongingMean: count > 0 ? bSum / count : 0,
    voiceMean: count > 0 ? vSum / count : 0,
    trustMean: count > 0 ? tSum / count : 0,
  };
}
