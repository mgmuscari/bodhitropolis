import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { parseChronicle } from '../../src/worldgen/chronicle';

// The chronicle parser turns the raw worldgen `log` into structured era
// entries. It must: group era-prefixed events under their era with fixed year
// ranges; silently skip the bare stage names runPipeline pushes
// (pipeline.ts:46); route era-prefixed lines with out-of-range numbers to
// `unparsed`; preserve a valid era line with no event text as an entry whose
// events array is empty; and never rewrite event text.

const FOUNDED_SEEDS = ['moses-1', 'moses-2', 'moses-3'];
const ERA_YEARS: Record<number, string> = {
  1: '1900-1920',
  2: '1920-1945',
  3: '1945-1965',
  4: '1965-1985',
  5: '1985-2000',
};

function realLog(seed: string): string[] {
  return runPipeline({ seed, width: 128, height: 128 }, [
    terrainStage(),
    mosesCenturyStage(),
  ]).log;
}

describe('parseChronicle: real pipeline (terrain + moses)', () => {
  for (const seed of FOUNDED_SEEDS) {
    it(`seed "${seed}": one entry per era, each non-empty, years correct`, () => {
      const chron = parseChronicle(realLog(seed));
      expect(chron.entries.map((e) => e.era)).toEqual([1, 2, 3, 4, 5]);
      for (const entry of chron.entries) {
        expect(entry.events.length).toBeGreaterThanOrEqual(1);
        expect(entry.years).toBe(ERA_YEARS[entry.era]);
      }
      expect(chron.unparsed).toEqual([]);
    });

    it(`seed "${seed}": exactly one "rails removed" line in era 3`, () => {
      const chron = parseChronicle(realLog(seed));
      const era3 = chron.entries.find((e) => e.era === 3)!;
      const railLines = era3.events.filter((ev) => /^rails removed /.test(ev));
      expect(railLines.length).toBe(1);
    });

    it(`seed "${seed}": bare stage names never appear in the chronicle`, () => {
      const chron = parseChronicle(realLog(seed));
      const allEvents = chron.entries.flatMap((e) => e.events);
      expect(allEvents).not.toContain('terrain');
      expect(allEvents).not.toContain('moses-century');
      expect(chron.unparsed).not.toContain('terrain');
      expect(chron.unparsed).not.toContain('moses-century');
    });

    it(`seed "${seed}": event text is the verbatim remainder after the eraN: prefix`, () => {
      const chron = parseChronicle(realLog(seed));
      const era1 = chron.entries.find((e) => e.era === 1)!;
      // era1Founding logs `era1: founded at (x, y)` (moses.ts:369).
      expect(era1.events.some((ev) => /^founded at \(\d+, \d+\)$/.test(ev))).toBe(true);
    });
  }
});

describe('parseChronicle: hand fixtures', () => {
  it('routes an out-of-range era prefix to unparsed', () => {
    const chron = parseChronicle(['era9: secret history', 'era1: founded at (1, 2)']);
    expect(chron.unparsed).toEqual(['era9: secret history']);
    expect(chron.entries.map((e) => e.era)).toEqual([1]);
    expect(chron.entries[0]!.events).toEqual(['founded at (1, 2)']);
  });

  it('keeps a valid era line with no event text as an empty-events entry', () => {
    const chron = parseChronicle(['era3:']);
    expect(chron.entries).toHaveLength(1);
    expect(chron.entries[0]!.era).toBe(3);
    expect(chron.entries[0]!.events).toEqual([]);
    expect(chron.entries[0]!.years).toBe('1945-1965');
    expect(chron.unparsed).toEqual([]);
  });

  it('returns an empty chronicle for an empty log', () => {
    const chron = parseChronicle([]);
    expect(chron.entries).toEqual([]);
    expect(chron.unparsed).toEqual([]);
  });

  it('preserves event order within an era and skips interleaved stage names', () => {
    const chron = parseChronicle([
      'terrain',
      'era1: founded at (3, 4)',
      'era1: streetcar — 2 lines, 30 rail tiles',
      'moses-century',
      'era1: fabric — 12 parcels (3 commercial)',
    ]);
    expect(chron.entries).toHaveLength(1);
    expect(chron.entries[0]!.events).toEqual([
      'founded at (3, 4)',
      'streetcar — 2 lines, 30 rail tiles',
      'fabric — 12 parcels (3 commercial)',
    ]);
    expect(chron.unparsed).toEqual([]);
  });

  it('yields a single era-1 entry for an all-water (no viable site) log', () => {
    const chron = parseChronicle(['terrain', 'era1: no viable site', 'moses-century']);
    expect(chron.entries).toHaveLength(1);
    expect(chron.entries[0]!.era).toBe(1);
    expect(chron.entries[0]!.events).toEqual(['no viable site']);
  });
});
