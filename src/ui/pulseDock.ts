// Pulse dock: the thin always-on DOM shell that mounts the wellbeing pulse line.
// A renderer-style shell mirroring mountToolbar — no logic worth unit-testing
// (the line text is derived by the pure pulseContent.pulseLine and tested there),
// and ZERO game imports: the line arrives as a plain string via set(). It touches
// the DOM only inside mountPulseDock, which main() calls only when `document`
// exists.
//
// It is its OWN dedicated dock element (not the shared toolbar.setStatus
// transient, which inspect/legend already clobber) so the always-on pulse never
// flickers — main.ts refreshes it on the civic cadence only.

export interface PulseDockHandle {
  /** Replace the pulse line text. */
  set(line: string): void;
}

/** Build and mount the always-on pulse dock into `container`. */
export function mountPulseDock(container: HTMLElement): PulseDockHandle {
  const dock = document.createElement('div');
  dock.className = 'pulse-dock';
  container.appendChild(dock);
  return {
    set(line: string): void {
      dock.textContent = line;
    },
  };
}
