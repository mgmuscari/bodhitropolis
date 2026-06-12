// Pure pointer/line geometry for the build-tools input shell. Extracted from the
// DOM so the determinism-sensitive bits — the click-vs-drag threshold and the
// axis-major line enumeration — are unit-tested rather than left to manual QA
// (the shouldTogglePanel precedent). No DOM, no transcendental Math, no imports:
// just integer/float arithmetic that the architecture guard scans in src/tools.

export type PointerKind = 'click' | 'drag';

export interface Tile {
  x: number;
  y: number;
}

/**
 * Classify a pointer gesture by its NET displacement (the straight-line distance
 * from the down point to the up point), NOT the summed path length. A jittery
 * in-place press whose pointer wandered far but returned near its origin stays a
 * 'click'. Returns 'click' when the displacement is strictly under `threshold`
 * pixels, else 'drag' (so a movement of exactly `threshold` is a drag). Compares
 * squared distances to avoid a sqrt and stay exact.
 */
export function classifyPointer(
  downSx: number,
  downSy: number,
  upSx: number,
  upSy: number,
  threshold = 5,
): PointerKind {
  const dx = upSx - downSx;
  const dy = upSy - downSy;
  const distSq = dx * dx + dy * dy;
  return distSq < threshold * threshold ? 'click' : 'drag';
}

/**
 * Enumerate the axis-major straight line of tiles from (x0, y0) to (x1, y1),
 * inclusive of both endpoints and deterministic. The dominant axis (larger
 * absolute delta; ties go horizontal) steps one tile at a time; the minor
 * coordinate is held at its start value, snapping the line straight along the
 * major axis (freeform diagonal paths are a later feature). A zero-length drag
 * (x0==x1 && y0==y1) yields the single start tile.
 */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): Tile[] {
  // Tile coords MUST be integers or the `=== x1`/`=== y1` termination never fires
  // and the loop spins forever. Callers pass floored screen→world tiles, but floor
  // defensively here so a non-integer caller can't hang the browser.
  const ax0 = Math.floor(x0);
  const ay0 = Math.floor(y0);
  const ax1 = Math.floor(x1);
  const ay1 = Math.floor(y1);
  const dx = ax1 - ax0;
  const dy = ay1 - ay0;
  const out: Tile[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const step = dx >= 0 ? 1 : -1;
    for (let x = ax0; ; x += step) {
      out.push({ x, y: ay0 });
      if (x === ax1) break;
    }
  } else {
    const step = dy >= 0 ? 1 : -1;
    for (let y = ay0; ; y += step) {
      out.push({ x: ax0, y });
      if (y === ay1) break;
    }
  }
  return out;
}
