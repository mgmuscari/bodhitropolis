import { describe, it, expect } from 'vitest';
import { FixedTickLoop } from '../../src/engine/loop';

describe('FixedTickLoop', () => {
  it('advancing 100ms at tickMs=50 fires exactly 2 ticks', () => {
    let count = 0;
    const loop = new FixedTickLoop(50, () => count++);
    loop.advance(100);
    expect(count).toBe(2);
    expect(loop.tickCount).toBe(2);
  });

  it('fires floor(total/tickMs) ticks over irregular deltas', () => {
    let count = 0;
    const loop = new FixedTickLoop(10, () => count++);
    const deltas = [7, 13, 30, 4, 6, 11, 9];
    const total = deltas.reduce((a, b) => a + b, 0); // 80
    for (const d of deltas) loop.advance(d);
    expect(count).toBe(Math.floor(total / 10)); // 8
  });

  it('carries the accumulator remainder across advances', () => {
    let count = 0;
    const loop = new FixedTickLoop(10, () => count++);
    loop.advance(7); // acc 7, 0 ticks
    expect(count).toBe(0);
    loop.advance(7); // acc 14 -> 1 tick, acc 4
    expect(count).toBe(1);
  });

  it('passes sequential zero-based tick indices to onTick', () => {
    const indices: number[] = [];
    const loop = new FixedTickLoop(20, (tick) => indices.push(tick));
    loop.advance(85); // 4 ticks
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('clamps a pathological elapsed to cap ticks per advance', () => {
    let count = 0;
    const loop = new FixedTickLoop(50, () => count++, { maxFrameMs: 1000 });
    loop.advance(5000); // clamped to 1000 -> 20 ticks, not 100
    expect(count).toBe(20);
  });

  it('fires nothing for zero or negative elapsed', () => {
    let count = 0;
    const loop = new FixedTickLoop(10, () => count++);
    loop.advance(0);
    loop.advance(-50);
    expect(count).toBe(0);
    expect(loop.tickCount).toBe(0);
  });

  it('exposes alpha as the accumulator fraction in [0, 1)', () => {
    const loop = new FixedTickLoop(10, () => {});
    loop.advance(13); // 1 tick, acc 3
    expect(loop.alpha).toBeCloseTo(0.3, 10);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('rejects a non-positive tickMs', () => {
    expect(() => new FixedTickLoop(0, () => {})).toThrow();
    expect(() => new FixedTickLoop(-5, () => {})).toThrow();
  });
});
