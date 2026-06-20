// Creative building / SITE footprint silhouettes (Maddy 2026-06-19: "be more creative with
// building/site footprints… not all buildings are in the center of the plot, or rectangular, some may
// be a few rectangles together. all are oriented to the cardinal directions").
//
// The black-on-white silhouette is the img2img init: the building diffuses into the BLACK region
// (flat, top-down — no iso platform), white is kept → alpha (open lot → terrain shows through). So an
// off-center / compound footprint reads as a building sitting in its lot. Drives per-kind / per-variant
// VARIETY (different silhouette → different structure). All rects are AXIS-ALIGNED (cardinal); no
// diagonals or rotations. Rendered with ImageMagick, black fill on white, at any size.
import { execFileSync } from 'node:child_process';

// Each shape = a list of [x0,y0,x1,y1] rectangles in [0,1] canvas fractions. A 5th element 'w' carves
// white (courtyard / gap between blocks). Mix of centered, off-center, and multi-rect compounds.
const SHAPES = {
  block: [[0.12, 0.12, 0.88, 0.88]], // simple centered block
  ell: [[0.12, 0.12, 0.55, 0.88], [0.12, 0.5, 0.88, 0.88]], // L wing
  tee: [[0.12, 0.12, 0.88, 0.42], [0.36, 0.12, 0.66, 0.88]], // T
  courtyard: [[0.12, 0.12, 0.88, 0.88], [0.34, 0.4, 0.66, 0.92, 'w']], // U / open courtyard
  cross: [[0.36, 0.1, 0.64, 0.9], [0.1, 0.36, 0.9, 0.64]], // plus
  twin: [[0.12, 0.16, 0.45, 0.84], [0.55, 0.16, 0.88, 0.84]], // duplex, two blocks
  stepped: [[0.12, 0.3, 0.6, 0.88], [0.4, 0.12, 0.88, 0.66]], // offset wings
  corner: [[0.1, 0.1, 0.6, 0.6]], // off-center: NW block, big open lot
  sideWing: [[0.12, 0.12, 0.88, 0.46], [0.12, 0.46, 0.46, 0.86]], // along N edge + W wing
  compound: [[0.3, 0.2, 0.72, 0.8], [0.14, 0.34, 0.34, 0.66], [0.72, 0.42, 0.86, 0.72]], // main + 2 wings
  splitLot: [[0.14, 0.14, 0.5, 0.52], [0.56, 0.52, 0.86, 0.86]], // two separate structures (house + outbuilding)
};

export const SHAPE_NAMES = Object.keys(SHAPES);

/** Render shape `name` as a black-on-white silhouette PNG buffer at `size`px. */
export function footprintPng(name, size = 512) {
  const rects = SHAPES[name] ?? SHAPES.block;
  const args = ['-size', `${size}x${size}`, 'xc:white', '-fill', 'black'];
  let fill = 'black';
  const px = (f) => Math.round(f * (size - 1));
  for (const [x0, y0, x1, y1, w] of rects) {
    const want = w ? 'white' : 'black';
    if (want !== fill) { args.push('-fill', want); fill = want; }
    args.push('-draw', `rectangle ${px(x0)},${px(y0)},${px(x1)},${px(y1)}`);
  }
  args.push('png:-');
  return execFileSync('magick', args, { maxBuffer: 16 * 1024 * 1024 });
}

// Deterministic shape pick by a 32-bit hash (kind+tier+variant) — direction-neutral spread so a kind's
// variants get distinct silhouettes. Optionally restrict to a kind's allowed shapes.
export function pickShape(seed, allowed = SHAPE_NAMES) {
  return allowed[(seed >>> 0) % allowed.length];
}
