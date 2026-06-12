# PRD: Opening Challenge

## Status: DRAFT
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/opening-challenge

## 1. Problem Statement

The game's defining beat — *the player is challenged to fix the blight* —
doesn't happen yet. The moses-century worldgen (PR #3) produces a blighted
city and writes a per-era chronicle into `world.log`, but on load the player
just sees a map with no name, no story, and no charge. Dwarf Fortress's
worldgen lands because the game *tells you* what you've inherited. This
feature is that telling: the city gets a name, its century gets narrated,
its wounds get measured, and the player gets the challenge — in a
dharmapunk voice that is hopeful, not doom.

## 2. Proposed Solution

1. **Blight report** (pure, headless-testable): a `BlightReport` computed
   from the post-worldgen WorldState — condition distribution (mean,
   median, share below thresholds), abandonment count (tombstoned parcels),
   parking-crater and projects counts, rail lost (from chronicle numbers),
   core-vs-periphery condition split (reusing the existing distance-field
   helpers), counts by building kind.
2. **Chronicle model** (pure): parse `world.log` into structured
   `ChronicleEntry[]` — era number, year range, headline events — keyed on
   the existing `eraN:` prefixes and tolerant of interleaved non-era
   entries (the pipeline also logs bare stage names).
3. **City name generator** (pure, seeded): deterministic syllable/wordlist
   composition from an rng fork of the world seed — every seed's city feels
   owned ("same seed → same city, same name").
4. **Opening overlay** (ui, DOM, no frameworks): pixel-art-styled panel
   over the rendered city — name, era-by-era story, legible blight stats,
   the challenge ("this city can be healed — begin"), a Begin button (and
   Escape/Enter) dismissing to the live map. Palette-consistent with the
   existing renderer.
5. `?seed=` behavior unchanged; the overlay shows on every load (no
   persistence yet).

## 3. Architecture Impact

- **New (pure)**: `src/worldgen/report.ts` (BlightReport),
  `src/worldgen/chronicle.ts` (parser), `src/engine/names.ts` (generator —
  engine because it depends only on rng), with mirrored test files.
- **New (ui)**: `src/ui/opening.ts` (overlay build/show/dismiss; DOM-thin,
  all content from the pure modules).
- **Modified**: `src/main.ts` (compute report/chronicle/name after
  worldgen, mount overlay, wire dismiss), `index.html` (overlay styles —
  keep inline-CSS approach consistent with existing single-file styling).
- **Data model**: none — read-only consumers of WorldState/ParcelStore.
  ParcelStore may need read-only accessors for dead-entry counts if not
  already exposed (`count()` vs `aliveCount()` exist; verify dead = count −
  alive suffices).
- **Dependencies**: none added.

## 4. Acceptance Criteria

1. Gates green: `npx tsc --noEmit`, `npx vitest run`, `npm run build`;
   architecture guard passes (report/chronicle/names are DOM-free; names.ts
   transcendental-free).
2. `BlightReport` is deterministic (same seed → identical report, tested)
   and internally consistent on real pipelines across ≥3 seeds: shares sum
   to 1 ±ε, abandonment equals `count() − aliveCount()`, core mean ≤
   overall mean on blighted seeds (consistent with the merged blight
   gradient).
3. Chronicle parser yields ≥1 entry per era (1-5) with correct year ranges
   on real pipeline output across ≥3 seeds; interleaved non-era lines are
   ignored; unknown/malformed era lines surface in a `unparsed` bucket, not
   exceptions.
4. City names: deterministic per seed (pinned for one seed), differ across
   ≥8 of 10 test seeds, length-bounded, title-cased, pronounceable-ish
   (regex: alternating consonant/vowel clusters — asserted bounds, not
   vibes).
5. Overlay renders on load with name, all five era entries, ≥4 blight
   stats, and challenge text; Begin (click, Enter, or Escape) dismisses it
   and the map remains interactive (manual + the pure-content functions
   unit-tested; DOM shell stays thin).
6. Headless import safety preserved: importing `src/main.ts` in tests
   still no-ops without a DOM.
7. `?seed=` still selects the world; same seed reproduces identical name,
   chronicle, report (one integration test through `runPipeline`).

## 5. Risk Assessment

- **Chronicle format coupling**: the parser depends on `eraN:` string
  shapes from moses.ts. Mitigation: parse defensively (prefix + number
  extraction only), keep headline text verbatim, route unknowns to
  `unparsed`; an integration test against the real pipeline catches drift.
- **Voice risk**: the challenge copy could land preachy or doomy.
  Mitigation: PRD pins the register — direct, warm, specific ("They tore
  out the streetcars. The river still runs. Begin."); review gate reads it.
- **UI scope creep**: overlays attract chrome. The panel is one element
  with static content and one action; anything more is future work.
- **Pure/DOM boundary erosion**: stats/format logic drifting into
  opening.ts. Mitigation: all strings/numbers produced by pure modules;
  opening.ts only builds elements — the architecture guard plus review.

## 6. Open Questions

1. Name generator flavor — pure invented syllables vs. American-pattern
   compounds ("Cedar Rapids"-like)? (Assume: syllable cores with optional
   real suffixes — -ford, -haven, -mills, -ridge — reads American without
   a big wordlist.)
2. Should the blight report appear as numbers or prose? (Assume: both —
   stat lines plus one synthesized prose sentence; the pure module emits
   structured data and the UI formats.)
3. Overlay on every reload could annoy during dev. (Assume: acceptable;
   `?nointro=1` escape hatch is one line and worth it — include it.)

## 7. Out of Scope

- Gameplay, tools, tech tree, win/lose, progression
- Save/load or any persistence (overlay always reshows)
- Sound, localization, full accessibility pass (keyboard dismiss only)
- Renderer changes; chronicle/report UI beyond the single opening panel
- Rewriting moses.ts log formats (parser adapts to what exists)
