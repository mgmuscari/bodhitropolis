// Opening-overlay copy: pure presentation that turns a BlightReport and a
// Chronicle into the strings the DOM shell will mount. No DOM, no transcendental
// Math — the architecture guard's pure-ui allowlist scans this file (see
// tests/architecture.test.ts). Keeping the voice here, not in the shell, lets it
// be unit-tested and lets the worldgen layer stay free of presentation concerns.
//
// Register: dharmapunk — hopeful and specific, never doom. The copy cites real
// numbers and quotes the chronicle verbatim so it stays honest to the world.

import type { BlightReport } from '../worldgen/report';
import type { Chronicle, ChronicleEntry } from '../worldgen/chronicle';

/** Round a fraction in [0,1] to an integer percentage (exactly-rounded). */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * 4-6 legible stat lines for the overlay. Four base lines always render; the two
 * chronicle-sourced lines (abandonment, lost rail) are omitted when their field
 * is null (e.g. an all-water seed), so the count stays in [4,6].
 *
 * Each base line is zero-aware: a count of 0 must not read as a bug. The towers
 * line in particular hits 0 on ordinary founded cities (corridor towers built in
 * era 3 are abandoned in era 5), and the all-water seed zeroes every per-parcel
 * stat — so each line carries a variant that stays honest and legible at 0.
 */
export function statLines(report: BlightReport): string[] {
  const hasParcels = report.parcelsAlive > 0;
  const lines: string[] = [
    report.parcelsTotal === 0
      ? `No ground was ever built here — only open water.`
      : `${report.parcelsAlive} parcels still stand of the ${report.parcelsTotal} ever raised.`,
    hasParcels
      ? `${pct(report.shareDerelict)}% sit derelict, ${pct(report.shareStruggling)}% are struggling.`
      : `Nothing stands yet to fall into disrepair.`,
    report.projectsStanding === 0
      ? `Not one tower-in-the-park is left standing over the core.`
      : `${report.projectsStanding} towers-in-the-park still loom over the core.`,
    hasParcels
      ? `Condition holds at a weary ${Math.round(report.conditionMean)} of 255.`
      : `There is no built condition to read — just open ground.`,
  ];
  if (report.abandoned !== null) {
    lines.push(`${report.abandoned} blocks emptied out in the disinvestment years.`);
  }
  if (report.railLost !== null) {
    lines.push(`${report.railLost.removed} rail tiles were ripped out for the expressway.`);
  }
  return lines;
}

/**
 * One headline for an era entry: `years: first event` (verbatim). An entry whose
 * events array is empty falls back to the year range alone — never the literal
 * "undefined" that `events[0]` would otherwise stringify to.
 */
export function eraHeadline(entry: ChronicleEntry): string {
  const first = entry.events[0];
  return first ? `${entry.years}: ${first}` : entry.years;
}

/** First available event across the chronicle, or null if it records none. */
function firstEvent(chronicle: Chronicle): string | null {
  for (const entry of chronicle.entries) {
    if (entry.events.length > 0) return entry.events[0]!;
  }
  return null;
}

/**
 * The challenge: 2-3 short paragraphs in the dharmapunk register, citing one
 * real report number and one verbatim chronicle event, ending on the imperative
 * to begin. Tolerates a chronicle with no events (degenerate seeds).
 */
export function challengeText(
  name: string,
  report: BlightReport,
  chronicle: Chronicle,
): string[] {
  const fact = firstEvent(chronicle);
  const paras: string[] = [];

  // Para 1 — name + the city's own first memory, quoted verbatim.
  if (fact) {
    paras.push(`${name} remembers it all — ${fact} — and wastes none of it.`);
  } else {
    paras.push(`${name} is barely a rumor on the water, and that is its whole future.`);
  }

  // Para 2 — a real number, reframed as room to build rather than ruin.
  if (report.abandoned !== null) {
    paras.push(`${report.parcelsAlive} blocks still stand; ${report.abandoned} lots lie open for something kinder.`);
  } else {
    paras.push(`${report.parcelsAlive} blocks stand ready, an open grid waiting for a gentler hand.`);
  }

  // Para 3 — the imperative.
  paras.push(`Pick up the keys, planner. Begin.`);

  return paras;
}
