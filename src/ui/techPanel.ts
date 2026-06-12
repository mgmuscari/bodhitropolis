// Tech panel: the thin DOM shell that mounts the tech tree over the live map,
// toggled by `T`. A renderer-style shell mirroring mountOpening — no logic worth
// unit-testing (the status/ordering derivation and the toggle gate are pure and
// tested in ui/techContent.ts), and deliberately ZERO game imports: content
// arrives as plain data via deps, keeping the dependency direction clean and the
// module safe to import headless (it only touches the DOM inside mountTechPanel,
// which main() calls only when `document` exists).
//
// Overlay coordination: the panel binds its own global keydown but routes every
// `T` through the pure shouldTogglePanel(key, overlayActive) gate, asking
// deps.isOverlayActive() each press — so it never toggles underneath the opening
// overlay (which owns its own keydown). opening.ts stays untouched; main.ts, the
// single composition root, owns the overlayActive flag.

import { shouldTogglePanel, type BranchColumn } from './techContent';

/** Plain-data content for the panel (assembled in main.ts from pure modules). */
export interface TechPanelContent {
  /** Header line, e.g. "Communal effort: 42". */
  effort: string;
  columns: BranchColumn[];
}

export interface TechPanelDeps {
  getContent(): TechPanelContent;
  /** Attempt to unlock a node; returns true if it succeeded (state changed). */
  onUnlock(id: string): boolean;
  /** Whether the opening overlay is currently up (suppresses the `T` toggle). */
  isOverlayActive(): boolean;
}

export interface TechPanelHandle {
  /** Whether the panel is currently open (visible). */
  isOpen(): boolean;
  /** Re-derive and re-render the FULL panel from getContent(), if open. */
  refresh(): void;
}

/**
 * Build and mount the tech panel into `container`, hidden until toggled. Returns
 * a handle so the host can ask whether it is open (to flag panelDirty on a tick)
 * and refresh it (to re-derive full content as effort accrues). Clicking an
 * affordable node calls deps.onUnlock then re-renders so status flips live.
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

  function render(): void {
    const content = deps.getContent();
    header.textContent = content.effort;
    columnsEl.replaceChildren();
    for (const col of content.columns) {
      const colEl = document.createElement('div');
      colEl.className = 'tech-column';

      const title = document.createElement('h3');
      title.className = 'tech-column-title';
      title.textContent = col.title;
      colEl.appendChild(title);

      for (const n of col.nodes) {
        const nodeEl = document.createElement('div');
        nodeEl.className = `tech-node tech-node-${n.status}`;

        const nameEl = document.createElement('div');
        nameEl.className = 'tech-node-name';
        nameEl.textContent = `${n.name} · ${n.cost}`;
        nodeEl.appendChild(nameEl);

        const flavorEl = document.createElement('div');
        flavorEl.className = 'tech-node-flavor';
        flavorEl.textContent = n.flavor;
        nodeEl.appendChild(flavorEl);

        if (n.missing.length > 0) {
          const missEl = document.createElement('div');
          missEl.className = 'tech-node-missing';
          missEl.textContent = `Needs: ${n.missing.join(', ')}`;
          nodeEl.appendChild(missEl);
        }

        if (n.status === 'affordable') {
          nodeEl.classList.add('tech-node-clickable');
          nodeEl.addEventListener('click', () => {
            if (deps.onUnlock(n.id)) render();
          });
        }

        colEl.appendChild(nodeEl);
      }
      columnsEl.appendChild(colEl);
    }
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !open;
    if (open) render();
  }

  function onKey(event: KeyboardEvent): void {
    if (shouldTogglePanel(event.key, deps.isOverlayActive())) {
      event.preventDefault();
      setOpen(!open);
    }
  }

  window.addEventListener('keydown', onKey);

  return {
    isOpen: () => open,
    refresh: () => {
      if (open) render();
    },
  };
}
