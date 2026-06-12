// Toolbar dock: the thin DOM shell that renders the always-on bottom tool dock.
// A renderer-style shell mirroring mountTechPanel — no logic worth unit-testing
// (the label/selected/affordable derivation is pure and tested in
// ui/toolbarContent.ts), and ZERO game imports: rows arrive as plain data via
// deps, and selection is reported back as a plain id string. It touches the DOM
// only inside mountToolbar, which main() calls only when `document` exists.

import type { ToolbarRow } from './toolbarContent';

export interface ToolbarDeps {
  /** Re-derive the current dock rows (assembled in main.ts from pure modules). */
  getRows(): ToolbarRow[];
  /** A tool row was clicked; the host updates selection then refreshes. */
  onSelect(id: string): void;
}

export interface ToolbarHandle {
  /** Re-derive and re-render the dock from getRows(). */
  refresh(): void;
}

/**
 * Build and mount the bottom tool dock into `container`. Returns a handle so the
 * host can refresh it (selection changes, effort accrual flipping affordability).
 * Clicking a row calls deps.onSelect(id); the host re-derives and calls refresh().
 */
export function mountToolbar(container: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const dock = document.createElement('div');
  dock.className = 'toolbar';
  container.appendChild(dock);

  function render(): void {
    dock.replaceChildren();
    for (const row of deps.getRows()) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-tool';
      if (row.selected) btn.classList.add('toolbar-tool-selected');
      if (!row.affordable) btn.classList.add('toolbar-tool-unaffordable');
      btn.textContent = row.label;
      btn.addEventListener('click', () => deps.onSelect(row.id));
      dock.appendChild(btn);
    }
  }

  render();

  return {
    refresh: render,
  };
}
