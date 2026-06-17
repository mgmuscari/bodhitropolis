/**
 * A live SCALAR FIELD over the map: a sparse `Map<tileIndex, value>` that agents LAY into
 * (accumulating, capped at a max) and that DECAYS toward zero when unfed (an entry at/under
 * zero is deleted so the map stays sparse and a cleared tile reads as a clean default 0).
 *
 * This is the ONE shape behind the live agent layers — desire-path wear, water pollution,
 * agent-driven traffic, air pollution — none of which are part of the deterministic world hash.
 * Extracting it keeps each layer a thin lay/decay/read over the same primitive instead of a
 * hand-rolled copy per field.
 */
export type ScalarField = Map<number, number>;

/**
 * Add `amount` to tile `i`, clamped at `max`. Returns the resulting value so callers can key a
 * threshold off it (e.g. wear crossing the "degraded path" mark) without a second lookup.
 */
export function layField(field: ScalarField, i: number, amount: number, max: number): number {
  const v = (field.get(i) ?? 0) + amount;
  const capped = v > max ? max : v;
  field.set(i, capped);
  return capped;
}

/**
 * Ease every tile back toward zero by `rate`; an entry that reaches (or passes) zero is deleted
 * so the field stays sparse — a cleared tile reads as the default 0 via {@link sampleField}.
 */
export function decayField(field: ScalarField, rate: number): void {
  if (field.size === 0) return;
  for (const [k, v] of [...field]) {
    const nv = v - rate;
    if (nv <= 0) field.delete(k);
    else field.set(k, nv);
  }
}

/** Read tile `i`, defaulting to 0 for a tile that was never laid (or has decayed away). */
export function sampleField(field: ReadonlyMap<number, number>, i: number): number {
  return field.get(i) ?? 0;
}
