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

/**
 * A compact signature of the dock's VISIBLE state — id set, selection, and
 * affordability per row, order-sensitive. The host compares it against the last
 * value to skip refreshing the shell on idle ticks (effort accrues every tick but
 * the dock only changes when one of these flips). Ids are included, so unlock
 * growth (a new id appearing) changes the signature too.
 */
export function refreshSignature(rows: readonly ToolbarRow[]): string {
  return rows.map((r) => `${r.id}:${r.selected ? 1 : 0}:${r.affordable ? 1 : 0}`).join('|');
}

/**
 * The ids present in `next` but not in `prev`, in `next` order. Drives the dock
 * unlock flash: when the tech tree grants a new tool, its id appears in the rows
 * and `addedIds` reports it. Removals are ignored — only additions matter.
 */
export function addedIds(prev: readonly string[], next: readonly string[]): string[] {
  const prevSet = new Set(prev);
  return next.filter((id) => !prevSet.has(id));
}

/**
 * The FULL className for a tool button — the shell sets it wholesale
 * (`el.className = toolbarToolClass(row)`) so stale state classes drop by
 * construction (no `classList.toggle` flip footgun): base `toolbar-tool`, plus
 * `toolbar-tool-selected` iff selected, plus `toolbar-tool-unaffordable` iff not
 * affordable.
 */
export function toolbarToolClass(row: ToolbarRow): string {
  let cls = 'toolbar-tool';
  if (row.selected) cls += ' toolbar-tool-selected';
  if (!row.affordable) cls += ' toolbar-tool-unaffordable';
  return cls;
}
