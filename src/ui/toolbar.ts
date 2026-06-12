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
  /** Show (or clear with null) the minimal status line — e.g. the inspect readout. */
  setStatus(text: string | null): void;
}

/**
 * Build and mount the bottom tool dock into `container`. Returns a handle so the
 * host can refresh it (selection changes, effort accrual flipping affordability)
 * and set a status line (the inspect readout). Clicking a row calls
 * deps.onSelect(id); the host re-derives and calls refresh(). The status line is a
 * sibling of the tool row, so refresh() (which only rebuilds the row) never wipes it.
 */
export function mountToolbar(container: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const dock = document.createElement('div');
  dock.className = 'toolbar';

  const tools = document.createElement('div');
  tools.className = 'toolbar-tools';

  const status = document.createElement('div');
  status.className = 'toolbar-status';
  status.hidden = true;

  dock.append(tools, status);
  container.appendChild(dock);

  function render(): void {
    tools.replaceChildren();
    for (const row of deps.getRows()) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-tool';
      if (row.selected) btn.classList.add('toolbar-tool-selected');
      if (!row.affordable) btn.classList.add('toolbar-tool-unaffordable');
      btn.textContent = row.label;
      btn.addEventListener('click', () => deps.onSelect(row.id));
      tools.appendChild(btn);
    }
  }

  function setStatus(text: string | null): void {
    if (text === null) {
      status.hidden = true;
      status.textContent = '';
    } else {
      status.textContent = text;
      status.hidden = false;
    }
  }

  render();

  return {
    refresh: render,
    setStatus,
  };
}
