// Toolbar content: pure presentation turning (tools, selection, effort) into the
// row view models the dock shell renders. No DOM, no transcendental Math — on the
// architecture pure-ui allowlist (tests/architecture.test.ts). Keeping the
// label/selected/affordable derivation here, not in the shell, lets it be
// unit-tested rather than left to manual QA (the techContent precedent).

import type { ToolDef, ToolId } from '../tools/tools';

/** One dock entry: a tool, its `Name · cost` label, and its selected/afford state. */
export interface ToolbarRow {
  id: ToolId;
  /** Display label `Name · cost` (e.g. "Parklet · 8"). */
  label: string;
  /** Whether this tool is the currently selected one. */
  selected: boolean;
  /** Whether the current effort can pay for this tool. */
  affordable: boolean;
}

/**
 * Build the dock rows from the available tools, the selected tool id (or null),
 * and the current communal effort. Order mirrors `tools` (availableTools' stable
 * order). A tool is affordable iff effort covers its cost — so free tools
 * (inspect) are always affordable and tools price out as effort runs low.
 */
export function toolbarRows(
  tools: readonly ToolDef[],
  selectedId: ToolId | null,
  effort: number,
): ToolbarRow[] {
  return tools.map((t) => ({
    id: t.id,
    label: `${t.name} · ${t.cost}`,
    selected: t.id === selectedId,
    affordable: effort >= t.cost,
  }));
}
