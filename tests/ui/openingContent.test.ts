import { describe, it, expect } from 'vitest';
import type { BlightReport } from '../../src/worldgen/report';
import type { Chronicle, ChronicleEntry } from '../../src/worldgen/chronicle';
import { statLines, eraHeadline, challengeText } from '../../src/ui/openingContent';

// openingContent is pure presentation: data in, strings out. It must embed the
// exact report numbers, omit lines whose chronicle-sourced field is null,
// tolerate an empty-events era entry without emitting "undefined", and (in the
// challenge copy) cite both a real number and a verbatim chronicle event.

const FOUNDED_REPORT: BlightReport = {
  parcelsTotal: 588,
  parcelsAlive: 412,
  preEra5Standing: 469,
  abandoned: 57,
  craters: 9,
  conditionMean: 137.4,
  conditionMedian: 150,
  shareDerelict: 0.2,
  shareStruggling: 0.45,
  projectsStanding: 16,
  railLost: { removed: 143, peak: 269 },
  coreMean: 90,
  peripheryMean: 180,
  coreAbandonedShare: 0.3,
  peripheryAbandonedShare: 0.05,
  byKind: {},
};

const SPARSE_REPORT: BlightReport = {
  ...FOUNDED_REPORT,
  preEra5Standing: null,
  abandoned: null,
  craters: null,
  railLost: null,
};

const CHRONICLE: Chronicle = {
  entries: [
    { era: 1, years: '1900-1920', events: ['founded at (6, 6)', 'streetcar — 2 lines, 30 rail tiles'] },
    { era: 3, years: '1945-1965', events: ['rails removed 143 (peak 269)'] },
  ],
  unparsed: [],
};

// The REALISTIC all-water shape the pipeline actually produces (cf. the Task-2
// all-water chronicle test and the Task-3 all-water report): zero parcels and a
// single era-1 "no viable site" entry. firstEvent() returns 'no viable site', so
// the challenge takes the verbatim-fact branch (not the no-events fallback).
const ALL_WATER_REPORT: BlightReport = {
  parcelsTotal: 0,
  parcelsAlive: 0,
  preEra5Standing: null,
  abandoned: null,
  craters: null,
  conditionMean: 0,
  conditionMedian: 0,
  shareDerelict: 0,
  shareStruggling: 0,
  projectsStanding: 0,
  railLost: null,
  coreMean: null,
  peripheryMean: null,
  coreAbandonedShare: null,
  peripheryAbandonedShare: null,
  byKind: {},
};
const ALL_WATER_CHRONICLE: Chronicle = {
  entries: [{ era: 1, years: '1900-1920', events: ['no viable site'] }],
  unparsed: [],
};

describe('statLines', () => {
  it('emits 4-6 lines embedding the exact report numbers, none over 90 chars', () => {
    const lines = statLines(FOUNDED_REPORT);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(6);
    const joined = lines.join('\n');
    for (const n of [412, 588, 57, 143, 16, 137, 20, 45]) {
      expect(joined).toContain(String(n));
    }
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
  });

  it('omits the line for each null chronicle-sourced field', () => {
    const lines = statLines(SPARSE_REPORT);
    expect(lines).toHaveLength(4); // base lines only
    const joined = lines.join('\n');
    expect(joined).not.toContain('disinvestment');
    expect(joined).not.toContain('rail tiles');
  });

  it('is deterministic (same report -> same lines)', () => {
    expect(statLines(FOUNDED_REPORT)).toEqual(statLines(FOUNDED_REPORT));
  });

  it('uses a zero-aware towers line when projectsStanding is 0 (founded city, towers abandoned)', () => {
    const lines = statLines({ ...FOUNDED_REPORT, projectsStanding: 0 });
    const joined = lines.join('\n');
    expect(joined).not.toContain('0 towers'); // never "0 towers... still loom"
    expect(joined).toContain('Not one tower-in-the-park is left standing over the core.');
    // The rest of the founded stats still render normally.
    expect(joined).toContain('412 parcels still stand');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
  });
});

describe('eraHeadline', () => {
  it('renders the year range and first event verbatim', () => {
    const entry: ChronicleEntry = { era: 1, years: '1900-1920', events: ['founded at (6, 6)'] };
    expect(eraHeadline(entry)).toBe('1900-1920: founded at (6, 6)');
  });

  it('falls back to the year range alone for an empty-events entry (no "undefined")', () => {
    const entry: ChronicleEntry = { era: 3, years: '1945-1965', events: [] };
    const headline = eraHeadline(entry);
    expect(headline).toBe('1945-1965');
    expect(headline).not.toContain('undefined');
  });
});

describe('challengeText', () => {
  it('cites the city name, a real report number, and a verbatim chronicle event', () => {
    const paras = challengeText('Marrowfield', FOUNDED_REPORT, CHRONICLE);
    const joined = paras.join('\n');
    expect(joined).toContain('Marrowfield');
    expect(joined).toMatch(/\d/);
    expect(joined).toContain(String(FOUNDED_REPORT.parcelsAlive)); // a real report number
    // The era fact must be a VERBATIM chronicle event, not paraphrase.
    expect(joined).toContain(CHRONICLE.entries[0]!.events[0]!);
  });

  it('ends with the imperative to begin and never emits "undefined"', () => {
    const paras = challengeText('Marrowfield', FOUNDED_REPORT, CHRONICLE);
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras.length).toBeLessThanOrEqual(3);
    expect(paras[paras.length - 1]).toMatch(/begin/i);
    expect(paras.join('\n')).not.toContain('undefined');
  });

  it('keeps every paragraph within 90 chars', () => {
    for (const para of challengeText('Marrowfield', FOUNDED_REPORT, CHRONICLE)) {
      expect(para.length).toBeLessThanOrEqual(90);
    }
  });

  it('tolerates an empty chronicle (no events) without "undefined"', () => {
    const paras = challengeText('Nowhere', SPARSE_REPORT, { entries: [], unparsed: [] });
    const joined = paras.join('\n');
    expect(joined).toContain('Nowhere');
    expect(joined).not.toContain('undefined');
    expect(paras[paras.length - 1]).toMatch(/begin/i);
  });

  it('is deterministic (same inputs -> same paragraphs)', () => {
    expect(challengeText('Marrowfield', FOUNDED_REPORT, CHRONICLE)).toEqual(
      challengeText('Marrowfield', FOUNDED_REPORT, CHRONICLE),
    );
  });

  it('holds the invariants on the realistic all-water path (0 parcels, "no viable site")', () => {
    const paras = challengeText('Tidehollow', ALL_WATER_REPORT, ALL_WATER_CHRONICLE);
    const joined = paras.join('\n');
    expect(joined).toContain('Tidehollow');
    expect(joined).toContain('no viable site'); // verbatim era fact, not the fallback
    expect(joined).not.toContain('undefined');
    expect(paras[paras.length - 1]).toMatch(/begin/i);
    for (const para of paras) expect(para.length).toBeLessThanOrEqual(90);
  });
});

describe('statLines: realistic all-water path', () => {
  it('is zero-aware (four base lines, no absurd "0 ..." copy)', () => {
    const lines = statLines(ALL_WATER_REPORT);
    expect(lines).toHaveLength(4);
    const joined = lines.join('\n');
    // No stat line reads as a bug at zero.
    expect(joined).not.toContain('0 parcels still stand');
    expect(joined).not.toContain('0 ever raised');
    expect(joined).not.toContain('0 towers');
    expect(joined).not.toContain('0%');
    expect(joined).not.toContain('weary 0');
    // Zero-aware variants present.
    expect(joined).toContain('No ground was ever built here — only open water.');
    expect(joined).toContain('Not one tower-in-the-park is left standing over the core.');
    // Still free of chronicle-sourced lines and artifacts.
    expect(joined).not.toContain('disinvestment');
    expect(joined).not.toContain('rail tiles');
    expect(joined).not.toContain('undefined');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
  });
});
