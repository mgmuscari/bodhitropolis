import { describe, it, expect } from 'vitest';
import { metaButtons } from '../../src/ui/dockContent';

describe('metaButtons', () => {
  it('has fixed labels in tech/eco/civic order', () => {
    const bs = metaButtons(false, null);
    expect(bs.map((b) => b.id)).toEqual(['tech', 'eco', 'civic']);
    expect(bs.map((b) => b.label)).toEqual(['Tech (T)', 'Eco (E)', 'Civic (C)']);
  });

  it('marks none active when the panel is closed and no overlay is up', () => {
    expect(metaButtons(false, null).every((b) => !b.active)).toBe(true);
  });

  it('marks Tech active iff the panel is open', () => {
    const open = metaButtons(true, null);
    expect(open.find((b) => b.id === 'tech')!.active).toBe(true);
    expect(open.find((b) => b.id === 'eco')!.active).toBe(false);
    expect(open.find((b) => b.id === 'civic')!.active).toBe(false);
  });

  it('marks Eco active iff the eco overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'eco' });
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(false);
  });

  it('marks Civic active iff the civic overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'civic' });
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(false);
  });

  it('tracks panel-open and an overlay independently (both can be active)', () => {
    const bs = metaButtons(true, { kind: 'civic' });
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(false);
  });

  it('is a deterministic pure function of its inputs', () => {
    expect(metaButtons(true, { kind: 'eco' })).toEqual(metaButtons(true, { kind: 'eco' }));
  });
});
