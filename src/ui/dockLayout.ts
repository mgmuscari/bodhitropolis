// Dock layout: the pure geometry decision behind the relocatable tool dock. The
// dock's fixed bottom-center position blocks the lower map once techs unlock, so
// the player can drag it anywhere — this clamps the dragged position so the dock
// never leaves the viewport. No DOM, no transcendental Math — on the architecture
// pure-ui allowlist. The drag wiring (pointer events) lives in the shell; this is
// just the math, so it can be unit-tested.

export interface DockPosition {
  x: number;
  y: number;
}

/**
 * Clamp a desired top-left (x, y) for a dock of (dockW × dockH) so it stays fully
 * within a (vpW × vpH) viewport: x into [0, vpW - dockW], y into [0, vpH - dockH].
 * When the dock is larger than the viewport the upper bound floors at 0 (pinned to
 * the top-left rather than allowing a negative position). Pure + deterministic.
 */
export function clampDockPosition(
  x: number,
  y: number,
  dockW: number,
  dockH: number,
  vpW: number,
  vpH: number,
): DockPosition {
  const maxX = Math.max(0, vpW - dockW);
  const maxY = Math.max(0, vpH - dockH);
  const cx = x < 0 ? 0 : x > maxX ? maxX : x;
  const cy = y < 0 ? 0 : y > maxY ? maxY : y;
  return { x: cx, y: cy };
}
