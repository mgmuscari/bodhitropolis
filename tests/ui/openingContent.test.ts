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
});
