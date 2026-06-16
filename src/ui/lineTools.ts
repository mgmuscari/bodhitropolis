// Line-tool classification: the pure predicate over a ToolDef that the drag
// wiring in main.ts consumes. A LINE tool drag-paints a stroke (every crossed
// tile is applied); everything else is point-apply (a single click = one plop,
// a drag = pan). A tool is a line tool iff it produces a TRANSPORT kind — the
// classic/transit roads (build-5..9, convert-1..9) that read as corridors. A
// building build OR a building convert (the rezoning greens convert-61/62) is a
// per-parcel plop, NOT a stroke, so it stays point-apply. Pure module — no DOM,
// no transcendental Math (the architecture guard's pure-ui allowlist scans this
// file) — so the classification is unit-tested rather than left to main.ts wiring.
// Classifiable from `def` alone (its kind).

import type { ToolDef } from '../tools/tools';
import { isTransportKind } from '../engine/fabric';

/**
 * True iff applying `tool` is a "line" (drag-paint) action rather than a point
 * plop: the tool produces a transport kind (`tool.kind` set and transport).
 * Inspect/bulldoze (no kind), every building build, and the building converts
 * (rezoning greens) are all point tools — false.
 */
export function isLineTool(tool: ToolDef): boolean {
  return tool.kind !== undefined && isTransportKind(tool.kind);
}
