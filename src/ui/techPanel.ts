// Tech panel: the thin DOM shell that mounts the tech tree over the live map,
// toggled by `T` or the dock's [Tech] meta button. A renderer-style shell — no
// logic worth unit-testing (the status/ordering derivation, the toggle gate, the
// panelSignature, and the wholesale node className are all pure and tested in
// ui/techContent.ts), and deliberately ZERO game imports: content arrives as plain
// data via deps. It touches the DOM only inside mountTechPanel, which main() calls
// only when `document` exists.
//
// APPLY, don't rebuild: the tech tree's node SET is STATIC (branchColumns maps
// every node regardless of status — only status/missing flip), so the columns +
// nodes are built ONCE into a Map<nodeId, …> and every refresh REUSES that Map,
// setting el.className = techNodeClass(node) wholesale (dropping the stale
// tech-node-${old} + tech-node-clickable) and bringing each node's full
// sub-structure (name / flavor / the conditional "Needs:" line) into line with the
// current NodeView — so no stale child ghosts on reuse. Node identity is preserved
// by construction (no replaceChildren), and ONE delegated click listener bound at
// mount routes unlocks via closest('[data-node-id]'), so clicks are never lost.
//
// Overlay coordination: the panel binds its own global keydown but routes every
// `T` through the pure shouldTogglePanel(key, overlayActive) gate, asking
// deps.isOverlayActive() each press — so it never toggles underneath the opening
// overlay. main owns the overlayActive flag and (via onToggle) keeps the dock's
// [Tech] active-state in sync whether the panel was toggled by key OR button.

import { shouldTogglePanel, techNodeClass, type BranchColumn } from './techContent';

/** Plain-data content for the panel (assembled in main.ts from pure modules). */
export interface TechPanelContent {
  /** Header line, e.g. "Communal effort: 42". */
  effort: string;
  columns: BranchColumn[];
}

export interface TechPanelDeps {
  getContent(): TechPanelContent;
  /**
   * Cheap header source: JUST the effort line, with no column derive. refreshHeader
   * uses it each tick so the live effort number stays current without recomputing
   * branchColumns. Optional: falls back to getContent().effort when absent.
   */
  getEffort?(): string;
  /** Attempt to unlock a node; returns true if it succeeded (state changed). */
  onUnlock(id: string): boolean;
  /** Whether the opening overlay is currently up (suppresses the `T` toggle). */
  isOverlayActive(): boolean;
  /**
   * Fired INSIDE setOpen for EVERY toggle — key, button, or future dismiss — with
   * the new open state, so the host keeps the dock's [Tech] active-state in sync
   * from one callback (no per-path bookkeeping, no per-frame poll). Optional: main
   * wires it in the wiring task; the panel works without it.
   */
  onToggle?(open: boolean): void;
}

export interface TechPanelHandle {
  /** Whether the panel is currently open (visible). */
  isOpen(): boolean;
  /** Re-derive and re-apply the FULL panel from getContent(), if open. */
  refresh(): void;
  /** Toggle the panel open/closed (the dock [Tech] button); shares setOpen with the `T` key. */
  toggle(): void;
  /** Cheap per-tick header update (effort text only, no column re-apply), if open. */
  refreshHeader(): void;
}

/** The reused DOM for one node — the build-once Map's values. */
interface NodeEls {
  nodeEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  flavorEl: HTMLDivElement;
  /** The conditional "Needs: …" line: created on demand, removed when missing empties. */
  missingEl: HTMLDivElement | null;
}

/**
 * Build and mount the tech panel into `container`, hidden until toggled. Returns a
 * handle so the host can ask whether it is open, refresh it (full re-apply on a
 * status change), toggle it (the dock button), and cheaply refresh its header each
 * tick. Clicking an affordable node calls deps.onUnlock then re-applies so status
 * flips live.
 */
export function mountTechPanel(container: HTMLElement, deps: TechPanelDeps): TechPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'tech-panel';
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'tech-panel-header';
  panel.appendChild(header);

  const columnsEl = document.createElement('div');
  columnsEl.className = 'tech-panel-columns';
  panel.appendChild(columnsEl);

  container.appendChild(panel);

  let open = false;
  let built = false;
  const nodeMap = new Map<string, NodeEls>();

  // Build the static column/node skeleton ONCE (titles + node containers). Class
  // and text are set by applyColumns immediately after, so they are not set here.
  function buildColumns(columns: readonly BranchColumn[]): void {
    for (const col of columns) {
      const colEl = document.createElement('div');
      colEl.className = 'tech-column';

      const title = document.createElement('h3');
      title.className = 'tech-column-title';
      title.textContent = col.title;
      colEl.appendChild(title);

      for (const n of col.nodes) {
        const nodeEl = document.createElement('div');
        nodeEl.dataset.nodeId = n.id;

        const nameEl = document.createElement('div');
        nameEl.className = 'tech-node-name';

        const flavorEl = document.createElement('div');
        flavorEl.className = 'tech-node-flavor';

        nodeEl.append(nameEl, flavorEl);
        colEl.appendChild(nodeEl);
        nodeMap.set(n.id, { nodeEl, nameEl, flavorEl, missingEl: null });
      }
      columnsEl.appendChild(colEl);
    }
    built = true;
  }

  // Reuse the Map and bring every node's full sub-structure into line with the
  // current NodeView — wholesale className (drops stale status/clickable), name,
  // flavor, and the conditional "Needs:" line (create / update / REMOVE when the
  // missing list empties, so no ghost survives a multi-prereq unlock).
  function applyColumns(columns: readonly BranchColumn[]): void {
    if (!built) buildColumns(columns);
    for (const col of columns) {
      for (const n of col.nodes) {
        const els = nodeMap.get(n.id)!;
        els.nodeEl.className = techNodeClass(n);
        els.nameEl.textContent = `${n.name} · ${n.cost}`;
        els.flavorEl.textContent = n.flavor;
        if (n.missing.length > 0) {
          if (!els.missingEl) {
            const missEl = document.createElement('div');
            missEl.className = 'tech-node-missing';
            els.missingEl = missEl;
            els.nodeEl.appendChild(missEl);
          }
          els.missingEl.textContent = `Needs: ${n.missing.join(', ')}`;
        } else if (els.missingEl) {
          els.missingEl.remove();
          els.missingEl = null;
        }
      }
    }
  }

  function render(): void {
    const content = deps.getContent();
    header.textContent = content.effort;
    applyColumns(content.columns);
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !open;
    if (open) render();
    // Fire for EVERY path (key + button + dismiss) so the host's [Tech] active-state
    // can't drift — this is what closes the key/button divergence at the source.
    deps.onToggle?.(open);
  }

  function onKey(event: KeyboardEvent): void {
    if (shouldTogglePanel(event.key, deps.isOverlayActive())) {
      event.preventDefault();
      setOpen(!open);
    }
  }

  // ONE delegated click listener, bound ONCE at mount. onUnlock guards non-
  // affordable nodes, so a locked/unlocked click is a safe no-op; a successful
  // unlock spent effort and flipped status, so re-render the header + columns.
  columnsEl.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
    const id = el?.dataset.nodeId;
    if (id !== undefined && deps.onUnlock(id)) render();
  });

  window.addEventListener('keydown', onKey);

  return {
    isOpen: () => open,
    refresh: () => {
      if (open) render();
    },
    toggle: () => setOpen(!open),
    refreshHeader: () => {
      if (open) header.textContent = deps.getEffort ? deps.getEffort() : deps.getContent().effort;
    },
  };
}
