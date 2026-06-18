import { describe, it, expect } from 'vitest';
import { metaButtons } from '../../src/ui/dockContent';

describe('metaButtons', () => {
  it('has fixed labels in tech/eco/civic/redline/police/life order', () => {
    const bs = metaButtons(false, null, false);
    expect(bs.map((b) => b.id)).toEqual(['tech', 'eco', 'civic', 'redline', 'police', 'life']);
    expect(bs.map((b) => b.label)).toEqual([
      'Tech (T)',
      'Eco (E)',
      'Civic (C)',
      'Redline (R)',
      'Police (P)',
      'Life (L)',
    ]);
  });

  it('marks Redline active iff the redline overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'redline' }, false);
    expect(bs.find((b) => b.id === 'redline')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(false);
  });

  it('marks Police active iff the police overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'police' }, false);
    expect(bs.find((b) => b.id === 'police')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'redline')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'life')!.active).toBe(false);
  });

  it('marks none active when the panel is closed, no overlay is up, and ambient is off', () => {
    expect(metaButtons(false, null, false).every((b) => !b.active)).toBe(true);
  });

  it('marks Tech active iff the panel is open', () => {
    const open = metaButtons(true, null, false);
    expect(open.find((b) => b.id === 'tech')!.active).toBe(true);
    expect(open.find((b) => b.id === 'eco')!.active).toBe(false);
    expect(open.find((b) => b.id === 'civic')!.active).toBe(false);
  });

  it('marks Eco active iff the eco overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'eco' }, false);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(false);
  });

  it('marks Civic active iff the civic overlay is up (others not)', () => {
    const bs = metaButtons(false, { kind: 'civic' }, false);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(false);
  });

  it('tracks panel-open and an overlay independently (both can be active)', () => {
    const bs = metaButtons(true, { kind: 'civic' }, false);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(false);
  });

  it('appends Life last and marks it active iff ambient is on', () => {
    const on = metaButtons(false, null, true);
    expect(on[on.length - 1]!.id).toBe('life'); // always last
    expect(on.find((b) => b.id === 'life')!.active).toBe(true);
    const off = metaButtons(false, null, false);
    expect(off.find((b) => b.id === 'life')!.active).toBe(false);
  });

  it('Life active tracks the ambientOn arg independently of tech/eco/civic', () => {
    const bs = metaButtons(true, { kind: 'eco' }, true);
    expect(bs.find((b) => b.id === 'tech')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'eco')!.active).toBe(true);
    expect(bs.find((b) => b.id === 'civic')!.active).toBe(false);
    expect(bs.find((b) => b.id === 'life')!.active).toBe(true);
  });

  it('is a deterministic pure function of its inputs', () => {
    expect(metaButtons(true, { kind: 'eco' }, true)).toEqual(metaButtons(true, { kind: 'eco' }, true));
  });
});
