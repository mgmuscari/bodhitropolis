import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';

describe('createRng', () => {
  it('same seed produces identical first 16 outputs', () => {
    const a = createRng('seed-x');
    const b = createRng('seed-x');
    for (let i = 0; i < 16; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('numeric seeds are also deterministic', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 16; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different streams', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-b');
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const r = createRng('range');
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(n) stays within [0, n) over 10k draws', () => {
    const r = createRng('bounds');
    const n = 7;
    for (let i = 0; i < 10000; i++) {
      const v = r.nextInt(n);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(n);
    }
  });

  it('nextInt covers the full range [0, n)', () => {
    const r = createRng('coverage');
    const n = 6;
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) seen.add(r.nextInt(n));
    for (let k = 0; k < n; k++) expect(seen.has(k)).toBe(true);
  });

  it('nextInt rejects non-positive or non-integer n', () => {
    const r = createRng('invalid');
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(-3)).toThrow();
    expect(() => r.nextInt(2.5)).toThrow();
  });

  it('mean of 10k next() draws is within [0.48, 0.52]', () => {
    const r = createRng('mean');
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += r.next();
    const mean = sum / 10000;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('chance(p) frequency approximates p', () => {
    const r = createRng('chance');
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (r.chance(0.3)) hits++;
    const freq = hits / 10000;
    expect(freq).toBeGreaterThan(0.27);
    expect(freq).toBeLessThan(0.33);
  });

  it('chance(0) is never true, chance(1) is always true', () => {
    const r = createRng('chance-edges');
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });
});

describe('Rng.fork', () => {
  it('fork(a) and fork(b) yield different streams', () => {
    const root = createRng('root');
    const a = root.fork('a');
    const b = root.fork('b');
    const sa = Array.from({ length: 16 }, () => a.next());
    const sb = Array.from({ length: 16 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('fork is deterministic regardless of parent draw count', () => {
    // The determinism contract: a child stream depends only on the parent
    // seed + label, never on how many times the parent has been drawn. This
    // is what lets pipeline stages fork by name without perturbing siblings.
    const root1 = createRng('root');
    const child1 = root1.fork('child');

    const root2 = createRng('root');
    root2.next();
    root2.next();
    root2.next();
    const child2 = root2.fork('child');

    for (let i = 0; i < 16; i++) {
      expect(child1.next()).toBe(child2.next());
    }
  });

  it('forked child differs from its parent stream', () => {
    const root = createRng('root');
    const child = root.fork('child');
    const childSeq = Array.from({ length: 16 }, () => child.next());
    const parent = createRng('root');
    const parentSeq = Array.from({ length: 16 }, () => parent.next());
    expect(childSeq).not.toEqual(parentSeq);
  });
});

// Regression pins: exact values captured from the GREEN implementation.
// These lock the algorithm forever — if a refactor changes them, the change
// broke same-seed reproducibility. Values are filled in after first GREEN.
describe('createRng regression pins', () => {
  it('produces the pinned first 8 outputs for seed "bodhi"', () => {
    const r = createRng('bodhi');
    const got = Array.from({ length: 8 }, () => r.next());
    expect(got).toEqual(PINNED_BODHI);
  });
});

const PINNED_BODHI: number[] = [
  0.10779605084098876, 0.40893647796474397, 0.5364723496604711,
  0.8392750201746821, 0.17540757940150797, 0.06230060150846839,
  0.6522761438973248, 0.9757649495732039,
];
