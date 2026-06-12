// Chronicle parser: turns the raw worldgen `log` (WorldState.log) into a
// structured, era-grouped narrative for the opening overlay.
//
// The log interleaves two kinds of line: era-prefixed event lines the Moses
// eras push (`era1: founded at (x, y)`, `era3: rails removed N (peak M)`, …)
// and bare stage names runPipeline appends after each stage (`terrain`,
// `moses-century`; pipeline.ts:46). This parser groups the former under their
// era — with fixed year ranges — and silently drops the latter. Event text is
// preserved verbatim (the remainder after the `eraN:` prefix); nothing is
// rewritten, so the overlay can quote the chronicle exactly.
//
// Worldgen layer: no DOM, no transcendental Math (architecture guard scans it).

export type Era = 1 | 2 | 3 | 4 | 5;

export interface ChronicleEntry {
  era: Era;
  /** Fixed historical year range for the era, e.g. '1900-1920'. */
  years: string;
  /** Verbatim event texts (post-`eraN:` remainder) in log order. */
  events: string[];
}

export interface Chronicle {
  entries: ChronicleEntry[];
  unparsed: string[];
}

// Fixed era → year-range mapping (PRD/PRP Task 2).
const ERA_YEARS: Record<Era, string> = {
  1: '1900-1920',
  2: '1920-1945',
  3: '1945-1965',
  4: '1965-1985',
  5: '1985-2000',
};

// An era-prefixed line: `eraN:` followed by optional whitespace and an optional
// event body. N is captured loosely (any digits) so out-of-range eras can be
// routed to `unparsed` rather than silently dropped as non-era lines.
const ERA_LINE = /^era(\d+):\s*(.*)$/;

function isEra(n: number): n is Era {
  return n >= 1 && n <= 5;
}

/**
 * Parse the worldgen log into an era-grouped chronicle. Entries appear in
 * first-appearance order; events within an era are kept in log order. Lines
 * that are not era-prefixed (stage names) are skipped; era-prefixed lines whose
 * number is outside 1..5 go to `unparsed`. A valid era line with no event body
 * yields an entry with an empty `events` array.
 */
export function parseChronicle(log: readonly string[]): Chronicle {
  const entries: ChronicleEntry[] = [];
  const byEra = new Map<Era, ChronicleEntry>();
  const unparsed: string[] = [];

  for (const line of log) {
    const m = ERA_LINE.exec(line);
    if (!m) continue; // non-era line (stage name etc.) — silently skipped
    const era = Number(m[1]);
    if (!isEra(era)) {
      unparsed.push(line);
      continue;
    }
    let entry = byEra.get(era);
    if (!entry) {
      entry = { era, years: ERA_YEARS[era], events: [] };
      byEra.set(era, entry);
      entries.push(entry);
    }
    const text = m[2]!;
    if (text.length > 0) entry.events.push(text);
  }

  return { entries, unparsed };
}
