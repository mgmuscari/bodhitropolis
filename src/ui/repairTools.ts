// Repair-tool classification: the pure predicate over a ToolDef that the
// repair-forwarding wiring in main.ts consumes. A REPAIR is every conversion
// (road diets reverse the Moses geometry) plus every ecology-BOOST build (the
// kinds whose influence is positive — gardens, compost, parklets, calm
// corridors). Bulldoze, inspect, and non-boost builds are NOT repairs. Pure
// module — no DOM, no transcendental Math (the architecture guard's pure-ui
// allowlist scans this file) — so the classification is unit-tested rather than
// left to main.ts wiring. Classifiable from `def` alone (id + kind).

import type { ToolDef } from '../tools/tools';
import { influenceOf } from '../ecology/influence';

/**
 * True iff applying `tool` is a "repair" that should credit a neighborhood's
 * trust: any conversion tool, or a build whose kind is an ecology boost
 * (`influenceOf(kind).soil > 0` — boosts are strictly positive, suppressors
 * negative, neutral 0). Bulldoze is EXCLUDED (the demolished kind is
 * unrecoverable post-apply); inspect and non-boost builds are not repairs.
 */
export function isRepairTool(tool: ToolDef): boolean {
  if (tool.id.startsWith('convert-')) return true;
  if (tool.id.startsWith('build-') && tool.kind !== undefined) {
    return influenceOf(tool.kind).soil > 0;
  }
  return false;
}
