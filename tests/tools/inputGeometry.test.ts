import { describe, it, expect } from 'vitest';
import { classifyPointer, lineTiles } from '../../src/tools/inputGeometry';

describe('classifyPointer (NET displacement, not summed path)', () => {
  it('treats an in-place press as a click', () => {
    expect(classifyPointer(0, 0, 0, 0)).toBe('click');
  });

  it('classifies by net displacement, ignoring the path taken (jitter case)', () => {
    // The pointer may have wandered well over 5px between down and up, but the NET
    // displacement down->up here is sqrt(2^2 + 1^2) ≈ 2.24px < 5 → still a click.
    expect(classifyPointer(10, 10, 12, 11)).toBe('click');
  });

  it('is a click just under the threshold', () => {
    expect(classifyPointer(0, 0, 3, 3)).toBe('click'); // distSq 18 < 25
  });

  it('is a drag exactly at the threshold', () => {
    expect(classifyPointer(0, 0, 5, 0)).toBe('drag'); // distSq 25, not < 25
    expect(classifyPointer(0, 0, 3, 4)).toBe('drag'); // distSq 25
  });

  it('is a drag just over the threshold', () => {
    expect(classifyPointer(0, 0, 4, 4)).toBe('drag'); // distSq 32 > 25
    expect(classifyPointer(0, 0, 5, 1)).toBe('drag'); // distSq 26 > 25
  });

  it('honours a custom threshold', () => {
    expect(classifyPointer(0, 0, 9, 0, 10)).toBe('click'); // 81 < 100
    expect(classifyPointer(0, 0, 9, 0, 8)).toBe('drag'); // 81 >= 64
  });

  it('is symmetric in direction', () => {
    expect(classifyPointer(20, 20, 17, 17)).toBe('click'); // distSq 18
    expect(classifyPointer(20, 20, 14, 20)).toBe('drag'); // distSq 36
  });
});

describe('lineTiles (axis-major straight line)', () => {
  it('returns the single start tile for a zero-length drag', () => {
    expect(lineTiles(3, 3, 3, 3)).toEqual([{ x: 3, y: 3 }]);
  });

  it('enumerates a horizontal line inclusive of both endpoints', () => {
    expect(lineTiles(2, 2, 6, 2)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
    ]);
  });

  it('snaps the minor axis on a mostly-horizontal drag (held at start row)', () => {
    const tiles = lineTiles(2, 2, 8, 4); // |dx|=6 > |dy|=2 → horizontal-major, y held at 2
    expect(tiles).toHaveLength(7);
    expect(tiles.every((t) => t.y === 2)).toBe(true);
    expect(tiles[0]).toEqual({ x: 2, y: 2 }); // start
    expect(tiles[tiles.length - 1]).toEqual({ x: 8, y: 2 }); // axis-major end
  });

  it('selects the vertical axis when |dy| dominates (held at start column)', () => {
    const tiles = lineTiles(2, 2, 3, 7); // |dy|=5 > |dx|=1 → vertical-major, x held at 2
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.x === 2)).toBe(true);
    expect(tiles[0]).toEqual({ x: 2, y: 2 });
    expect(tiles[tiles.length - 1]).toEqual({ x: 2, y: 7 });
  });

  it('enumerates in the drag direction for a negative delta', () => {
    expect(lineTiles(6, 2, 2, 2)).toEqual([
      { x: 6, y: 2 },
      { x: 5, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it('breaks an exact diagonal tie toward the horizontal axis', () => {
    const tiles = lineTiles(0, 0, 3, 3); // |dx| == |dy| → horizontal
    expect(tiles.every((t) => t.y === 0)).toBe(true);
    expect(tiles).toHaveLength(4);
  });

  it('floors non-integer coords (terminates instead of looping forever)', () => {
    // A non-integer endpoint would never satisfy `x === x1`; flooring guarantees
    // termination and matches what a floored screen→world caller intends.
    expect(lineTiles(2.7, 2.2, 6.9, 2.1)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
    ]);
  });

  it('is deterministic and contiguous on the major axis', () => {
    const a = lineTiles(1, 1, 5, 3);
    const b = lineTiles(1, 1, 5, 3);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      const stepX = Math.abs(a[i]!.x - a[i - 1]!.x);
      const stepY = Math.abs(a[i]!.y - a[i - 1]!.y);
      expect(stepX + stepY).toBe(1); // one step per tile on exactly one axis
    }
  });
});
