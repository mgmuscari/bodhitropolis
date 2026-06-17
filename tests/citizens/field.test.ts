import { describe, it, expect } from 'vitest';
import { layField, decayField, sampleField, type ScalarField } from '../../src/citizens/field';

describe('ScalarField: layField (accumulate, capped)', () => {
  it('adds to an empty tile from a default of 0', () => {
    const f: ScalarField = new Map();
    expect(layField(f, 5, 10, 255)).toBe(10);
    expect(f.get(5)).toBe(10);
  });

  it('accumulates across repeated lays on the same tile', () => {
    const f: ScalarField = new Map();
    layField(f, 5, 10, 255);
    expect(layField(f, 5, 10, 255)).toBe(20);
    expect(f.get(5)).toBe(20);
  });

  it('caps at max and returns the capped value', () => {
    const f: ScalarField = new Map();
    layField(f, 5, 250, 255);
    expect(layField(f, 5, 50, 255)).toBe(255); // 300 clamped
    expect(f.get(5)).toBe(255);
  });

  it('keeps tiles independent', () => {
    const f: ScalarField = new Map();
    layField(f, 1, 10, 255);
    layField(f, 2, 30, 255);
    expect(f.get(1)).toBe(10);
    expect(f.get(2)).toBe(30);
  });
});

describe('ScalarField: decayField (ease toward zero, sparse)', () => {
  it('eases every tile down by the rate', () => {
    const f: ScalarField = new Map([[1, 10], [2, 5]]);
    decayField(f, 2);
    expect(f.get(1)).toBe(8);
    expect(f.get(2)).toBe(3);
  });

  it('deletes a tile that reaches zero (stays sparse)', () => {
    const f: ScalarField = new Map([[1, 2]]);
    decayField(f, 2);
    expect(f.has(1)).toBe(false);
    expect(f.size).toBe(0);
  });

  it('deletes a tile that would go below zero (floors at delete)', () => {
    const f: ScalarField = new Map([[1, 1]]);
    decayField(f, 5);
    expect(f.has(1)).toBe(false);
  });

  it('is a no-op on an empty field', () => {
    const f: ScalarField = new Map();
    decayField(f, 1);
    expect(f.size).toBe(0);
  });
});

describe('ScalarField: sampleField (default 0)', () => {
  it('returns the value at a laid tile', () => {
    const f: ScalarField = new Map([[7, 42]]);
    expect(sampleField(f, 7)).toBe(42);
  });

  it('returns 0 for a tile that was never laid or has decayed away', () => {
    const f: ScalarField = new Map();
    expect(sampleField(f, 7)).toBe(0);
  });
});
