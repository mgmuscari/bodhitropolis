# Plan Review: urban-density

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-15
## Mode: Agent Team (concurrent review + revision)

> Six yield points (1 Structural, 3 Moderate, 2 Minor), all resolved in one
> revision round. The headline is what *held*: the interlocutor pressure-tested
> every load-bearing risk this feature's correctness rests on — the era-3
> demolition balance equation under a 3-row carve, road single-component
> monotonicity under parallel-row widening, the `-w` keyspace guard,
> rng fork-independence, and Apartments wiring — and verified each SOUND at the
> line level, with every PRP §2 file/symbol/line citation confirmed accurate.
> The defects it found were underspecification and test-gap, not redesign; the
> proposer closed all six with substantive edits (not hand-waves), and the team
> lead independently validated every closure against the revised PRP.

## Yield Points Found

### 1. Era-5 crater FIELDS break the exact balance equation
**Severity:** Structural
**Evidence:** `moses.test.ts:574` asserts
`aliveCount() === preEra5Alive − abandoned + craters`; the crater loop
(`moses.ts:1009-1020`) counts one `ParkingLot` per crater event today. Task 7's
multi-parcel crater *field* counted as a single event under-counts `craters` by
N−1, breaking the equation.
**Proposer Response:** Accepted. `placeParkingField` now returns its placed
parcel count; Task 7 sums **all** field parcels into the chronicled `craters`;
a new non-vacuous test asserts a ≥2-tile field forms AND the balance holds.
**PRP Updated:** Yes (Tasks 5, 7).

### 2. The era-5 ≥10% abandonment mitigation aimed at the wrong knob
**Severity:** Moderate
**Evidence:** `moses.test.ts:572` requires `abandoned ≥ 10%` of the standing
city. The dominant *diluter* is the far-suburb budget `era4Houses` (25→90 in
the draft): far houses at highway-distance `d ≥ 16` lose only
`floor(200/(1+0.15·16)) = 58` condition (`moses.ts:998-999`), survive, and pad
the denominator. The draft's mitigation capped the small inner-core fill while
keeping 90 — the wrong lever — and leaned on a 3-seed sweep (overfit).
**Proposer Response:** Accepted. `era4Houses` held **MODERATE (25→55, not 90)**;
the abandonment *numerator* is steered into the carved core via core-weighted
`fillFrontage`, so the ratio is robust **by construction** (near-fill scales
with the same core era-3 carves through), not by the far budget happening not to
outrun it. Added an explicit lever ladder if a seed dips (fill core-weighting →
lower `era4Houses` → `craterChance`/`abandonThreshold`) and an absolute rule:
**never touch the decay formula.** The seed-sweep is the empirical *check* on
the structural argument, not the mitigation itself.
**PRP Updated:** Yes (Task 7, Uncertainty Log). *Lead note:* widening the sweep
beyond the 3 canonical seeds at execute time is recommended defense-in-depth;
the structural argument is the primary close.

### 3. A 4×4 parking field cannot fit the grid's 3×3 block interiors
**Severity:** Moderate
**Evidence:** `blockSpacing = 4` (`moses.ts:89`) leaves 3-wide buildable block
interiors; `canPlaceParcel` refuses roads/occupied tiles (`fabric.ts:294-308`);
the denser `era2Parcels = 90` consumes remaining interior tiles. Task 5's
"`ParkingLot` component ≥ 16" would be unsatisfiable inside the grid.
**Proposer Response:** Accepted. Parking-field placement is **pinned to the open
fringe** (outside the dense grid, where free rectangles exist) and is
**all-or-nothing**: it verifies a fully-free `cols×rows` rectangle before
placing any lot. A `new GameMap(w,h)` fixture test places `cols*rows` lots on a
fully-free region and asserts the component size; the worldgen call site targets
the fringe.
**PRP Updated:** Yes (Task 5).

### 4. Task 3's render wide/decoration integration was wholly untested
**Severity:** Moderate
**Evidence:** `render()` (`renderer.ts:449-459`) would gain wide-flag
computation + a pole pass, but the keyspace⊆paintable guard
(`renderKey.test.ts:88`) only proves keys are *paintable* — not that `render()`
passes `wide` correctly or places poles/wires correctly. The draft left this an
untested "thin shell."
**Proposer Response:** Accepted — and the fix strengthens the design to the
project's pure-seam discipline (the same move ui-revival used). The
per-tile **decisions** are extracted into pure `decoration.ts`: `wideRoadAt`,
`powerPoleAt`, **and** `poleWireDirs` (the wire-segment decision). Task 2 adds
an **exact-set integration test** over a worldgen-shaped fixture (1-wide grid +
a 2-row avenue band + a 3-row highway band): it asserts the *complete* set of
`{(x,y) : wideRoadAt}` equals exactly the band tiles and excludes every grid `+`
intersection, and the *complete* `powerPoleAt` set matches. The render shell is
reduced to literal `drawImage`/`fillRect` with zero branching of its own.
**PRP Updated:** Yes (Tasks 2, 3).

### 5. Dead `road-7-*-w` keys + imprecise "max() fuses rows" wording
**Severity:** Minor
**Evidence:** (a) `QuietStreet`(7) is in `ROAD_RENDER_KINDS`
(`renderKey.ts:23-28`) but `wideRoadAt` is `isRoadKind` (1–3) only, so any
`road-7-*-w` key would be painted-but-never-requested. (b) "the `max()`
junction merge fuses parallel rows" (draft PRD §2.2 / PRP §2) is imprecise:
`max()` is same-tile only (`fabric.ts:367`); parallel rows are distinct tiles
that connect via 4-adjacency + `transportMask`.
**Proposer Response:** Accepted both. `renderKeyspace()` enumerates `-w` only
for kinds 1–3 (a test pins that `road-7-*-w` is empty while plain `road-7-{m}`
remains); the wording now reads "parallel rows are DISTINCT 4-adjacent tiles;
they join into one component via 4-adjacency (the `roadNetwork` BFS) and
autotile via `transportMask` — NOT via `max()`."
**PRP Updated:** Yes (Task 1 test, §2 prose).

### 6. Empirical floor / chronicle under-count / Apartments density
**Severity:** Minor
**Evidence:** (a) the era-1 `≥ 80` alive floor under `era1Parcels = 150` is an
empirical bound (frontage is grid-limited; budget is a cap, not a guarantee).
(b) the era-2 `${avenues}` chronicle (`moses.ts:613-614`) would under-report the
new `widenAvenue` tiles. (c) `Apartments` placed at `HEALTHY_ATTRS` density 1–2
despite being the "dense" near-core kind.
**Proposer Response:** Accepted all three. (a) GREEN measures the *realized*
density and sets the asserted floor defensibly below the realized minimum (AC #4
intent = "materially denser, ≥ 2× old budgets"); the budget-as-cap caveat is
documented. (b) `widenAvenue` returns its tile count, folded into the `avenues`
tally before the chronicle line (chronicle honesty — no test parses it). (c) a
new `DENSE_ATTRS` gen gives `Apartments` density 2–3 while keeping the **same
two-`nextInt` draw shape**, so the `'fill'` rng stream structure — and
determinism — is unchanged.
**PRP Updated:** Yes (Tasks 4, 5).

## What Holds Well

The interlocutor verified — at the line level — that every risk this feature's
correctness depends on is SOUND. These are strengths, not absences:

- **Era-3 demolition balance under widening:** SOUND and *more* robust.
  `demolishParcel` is per-parcel and `aliveCount` per-parcel; a footprint
  spanning rows is demolished once (`fabric.ts:410-423`). Task 6's aggregation
  is correct; widening only raises `demolished`/`inMask`.
- **Road single-component (strict `===`):** SOUND and monotone. Carve/widen only
  ADD road tiles (demolition hits parcels + rail only); each parallel tile
  attaches to a gap-free spine, so nothing can be stranded —
  `moses.test.ts:152/272/635` hold.
- **`wideRoadAt` (2×2-block predicate):** SOUND for all stated cases — true for
  2-row and 3-row bands, false for a 1-wide road and a `+` of two 1-wide roads
  (diagonal not road).
- **`renderKeyspace` `-w` variant:** SOUND. The guard parses kind from
  `split('-')[1]`, unaffected by the `-w` suffix; `buildAtlas` paints
  `road-*-w` without throwing; Task-1-before-Task-3 ordering doesn't crash.
- **rng discipline:** SOUND. `'fill'`/`'widen'`/`'parkfield'` are
  fork-independent (`rng.ts:112-114`); the stage is a pure function of seed, so
  the triple-snapshot determinism AC is achievable.
- **Apartments(17):** SOUND and fully wired (`moses.ts:812`,
  `moses.test.ts:423`, `renderKey.ts:44`, `renderer.ts:131`); era-4 decline +
  era-5 decay handle it, cohorts hold.
- **Citation grounding:** every §2 file/symbol/line accurate — an unusually
  well-grounded PRP, which is what let the exchange converge in one round.

## Summary

6 yield points (1 Structural, 3 Moderate, 2 Minor), all resolved; no remaining
structural or moderate weakness. The Structural defect (era-5 crater-field
balance) and all three Moderates (the abandonment lever, the parking-field fit,
the untested render integration) were closed with substantive PRP revisions
that the team lead independently re-validated against the file. The era-5
abandonment ratio remains the single empirical unknown — now addressed by a
*structural* robustness argument (numerator→core, diluter held moderate) plus a
named lever ladder, with the seed-sweep as the execute-time check (widening
beyond 3 seeds recommended). Two new `src/ui/decoration.ts` pure helpers join
`PURE_UI_ALLOWLIST`; the wide/pole/wire decisions are headless-tested by an
exact-set fixture.

**APPROVED** — proceed to `/execute-team`. The team lead owns the live browser
pass in **both Chromium and WebKit** (filled blocks, slab avenues/freeways,
parking fields, power lines), the era-5 seed-sweep at execute time, and the
`.dialectic-tier` strip before merge.
