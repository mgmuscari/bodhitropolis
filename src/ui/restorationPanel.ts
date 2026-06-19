// Restoration readout panel: the thin, toggleable DOM shell that shows the "is my renewal helping?"
// readout. A renderer-style shell mirroring mountPulseDock — NO logic worth unit-testing (the lines
// are derived by the pure restorationContent and tested there); it just owns a panel element, a
// title, and visibility. It touches the DOM only inside mountRestorationPanel, which main() calls
// only when `document` exists. Hidden by default; the host toggles it with the G key.

export interface RestorationPanelHandle {
  /** Replace the readout lines (one `Label: value ↗` per metric). */
  set(lines: string[]): void;
  /** Show/hide the panel; returns the new visibility. */
  toggle(): boolean;
  /** Whether the panel is currently shown (the host refreshes it only while visible). */
  visible(): boolean;
}

/** Build and mount the (hidden) restoration readout panel into `container`. */
export function mountRestorationPanel(container: HTMLElement): RestorationPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'restoration-panel';
  panel.style.display = 'none';

  const title = document.createElement('div');
  title.className = 'restoration-panel__title';
  title.textContent = 'Restoration';
  panel.appendChild(title);

  const body = document.createElement('div');
  body.className = 'restoration-panel__body';
  panel.appendChild(body);

  container.appendChild(panel);

  let shown = false;
  return {
    set(lines: string[]): void {
      body.textContent = lines.join('\n');
    },
    toggle(): boolean {
      shown = !shown;
      panel.style.display = shown ? 'block' : 'none';
      return shown;
    },
    visible(): boolean {
      return shown;
    },
  };
}
