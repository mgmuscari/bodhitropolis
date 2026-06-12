# Plan Review: moses-century

## Verdict: REQUESTS CHANGES
## Reviewer Stance: Interlocutor
## Date: 2026-06-12

> **Mode note:** sequential review; team mode environmentally unavailable
> this session (per the foundation review's mode note).

## Yield Points Found

### 1. Era-1 streetcar rails are geometrically impossible as specified
**Severity:** Structural
**Evidence:** Task 3 step 3: rail "laid in the lane adjacent to the road"
along both founding arterials, through a grid with "parallel streets every 4
tiles" (step 2). `canPlaceTransport` rejects rail on road tiles
(src/engine/fabric.ts:259 — no crossings in v1), so a rail lane parallel to
one arterial is severed at *every* cross street: the "lines" become
disconnected ≤3-tile fragments. The era-1 test ("rail tiles ≥ 20") passes
on confetti; the era-3 chronicle then solemnly reports ripping out rail
that never formed lines. The plan's own constraint defeats its own scene.
**Pressure applied:** "Draw the rail lane through the grid, tile by tile,
under the no-crossings rule."
**Recommendation:** Make the historically-honest simplification explicit:
in-grid streetcar track ran *in the street* — represent it implicitly
(chronicle the lines; no rail tiles inside the grid). Lay `Rail` tiles only
where lines extend *beyond* the grid into undeveloped land (radial
extensions, one per line, length budgeted), where no cross streets exist.
Era-1 tests then assert: ≥2 rail extensions, each a connected run of ≥6
tiles, each starting adjacent to an arterial end, zero rail tiles inside
the grid bounding box. Era 3 demolishes these tiles (count still
chronicled); the drama survives, the geometry becomes coherent.

### 2. `distanceField` cannot express the road-network distance Task 6 needs
**Severity:** Moderate
**Evidence:** Task 2 defines `distanceField(map, isSource)` — a free BFS
over all tiles. Task 6 step 1 requires "road-network `distanceField` from
the crossroads" (suburb ring = distance along roads), and Task 6's test
asserts houses "at ring distance > p.suburbRadius". A free BFS measures
geometric distance, not network distance; with no passability parameter the
API cannot do what Task 6 asks.
**Pressure applied:** "Write Task 6's first line of code against Task 2's
signature."
**Recommendation:** `distanceField(map, isSource, isPassable?)` — BFS
expands only through passable tiles (default: all). Add a fixture test
(corridor of passable tiles vs. the unreachable far side). Task 6 then uses
`isPassable = isRoad`; specify that "ring distance" in era-4 tests means
this road-network distance.

### 3. Blight-gradient test has survivorship bias
**Severity:** Moderate
**Evidence:** Task 7 test: mean condition of *alive* parcels near highways
(d ≤ 8) < mean far (d ≥ 16). But era 5 demolishes the worst near-highway
parcels (abandonment threshold 40) before the test measures — the surviving
near cohort is upward-biased, and with strong decay + aggressive
abandonment the assertion can flip or flake per seed while the city is
visibly *more* blighted.
**Pressure applied:** "Who is missing from the near-cohort mean? Exactly
the parcels that proved the blight."
**Recommendation:** Define cohorts over era-5 *outcomes*: abandoned parcels
count in their cohort at condition 0 (their absence is the blight). The
test partitions pre-era-5 alive parcels by highway distance, then compares
mean(post condition, demolished → 0). Deterministic, bias-free, and it
strengthens rather than weakens the claim.

### 4. MosesState threading is signature-ambiguous
**Severity:** Moderate
**Evidence:** Task 3 defines `era1Founding(world, rng, p)`; Task 4 says
arterials are "recorded in a small `MosesState` carried between eras inside
the stage closure — era functions accept/return it". Accept *and* return?
Created by whom? The tests run eras individually (that is the design's
selling point), so the state's shape and ownership are part of the public
test surface, not an internal detail to improvise.
**Pressure applied:** "Write the era-2 test's setup lines."
**Recommendation:** Specify uniformly: `createMosesState(): MosesState`
exported; every era is `eraN(world, rng, p, state): void`, era 1 fills
founding fields (site, arterial row/col, grid bounds, rail peak), later
eras read/extend. Document the fields in the PRP.

### 5. Era-3 verification arithmetic is underspecified
**Severity:** Minor
**Evidence:** (a) "corridor overlaps the pre-era-3 top-density quartile" —
overlap undefined (one tile? a fraction?). (b) "chronicle demolition count
…equals the actual alive-count drop from corridor demolitions" — not
independently observable: the era also rips rail (not parcels) and *adds*
Projects/Civic, so post-minus-pre alive count conflates adds and removals.
(c) Second corridor trigger "≥ p.minSecondCorridor density" has no units.
**Pressure applied:** "Compute each asserted number from observables only."
**Recommendation:** (a) overlap = ≥5 corridor tiles inside the top-quartile
density mask. (b) assert the balance equation: `aliveAfter = aliveBefore −
chronicledDemolitions + placedProjects + placedCivic` (placements
observable by kind-count deltas). (c) second corridor iff best
perpendicular run's density-sum ≥ 50% of the first corridor's.

### 6. Era-5 abandonment mutates aliveness while iterating it
**Severity:** Minor
**Evidence:** Task 7: per-parcel decay then "parcels ending below
p.abandonThreshold: demolished" — if the loop iterates `aliveIndices()`
while demolishing, the iteration set changes mid-pass (still deterministic
with index-ascending arrays, but fragile under refactor).
**Pressure applied:** "What does the loop iterate after the first
demolition?"
**Recommendation:** Specify two passes: decay all (collect candidates),
then demolish the collected list.

## What Holds Well

- **Verified against the merged code, accurately**: every cited fabric.ts /
  terrain.ts / pipeline.ts line checks out, including the insight that
  street→avenue upgrades and highway carving are *already implemented* by
  the junction-merge max-kind rule (fabric.ts:273) — the plan reuses
  mechanics instead of inventing parallel ones.
- **Demolition design is right**: inverse-of-placement in the same
  single-writer module, tombstones (not index compaction — the `parcel`
  layer holds baked indices), agreement extended to flag dead-entry
  references, snapshotBytes covering the alive flag. Task 1's test list
  includes the corruption-detection case.
- **Exported per-era functions** make the historical invariants measurable
  *between* eras — the same move that made the terrain stage testable.
- **Terrain-integrity invariant** (all four terrain layers byte-identical
  across the stage) is strong, cheap, and verified-feasible: placement
  writes only `built`/`parcel` (fabric.ts:230-242).
- The uncertainty log's "tune params, never thresholds; swap a starving
  test seed only with documentation" keeps the non-vacuity discipline.

## Summary

The plan is well-grounded and the era decomposition is the right shape; the
engine addition (demolition) is correctly scoped and risk-aware. But the
streetcar geometry contradicts the no-crossings rule the codebase actually
enforces (yield point 1), one helper API can't serve its consumer (2), and
the climactic blight assertion measures survivors instead of damage (3).
All have small, concrete fixes that make the history *more* legible, not
less ambitious.

**Path forward:** revise the PRP per yield points 1-6 (targeted edits),
then headless-proposer execution per the established pattern.

## Resolution Addendum (same day)

All six yield points folded into the PRP (see its `Revised:` header):

1. Streetcar rails respecified as radial extensions beyond the grid
   (in-grid track implicit/chronicled); era-1 tests assert connected ≥6-tile
   extensions, arterial-end adjacency, zero in-grid rail — **resolved**
2. `distanceField` gains `isPassable`; passability fixture test added;
   era-4 "ring distance" defined as road-network distance — **resolved**
3. Blight gradient measured over era-5 outcomes with abandoned parcels at
   condition 0, cohorts fixed at era-5 start — **resolved**
4. `MosesState` interface + `createMosesState` specified; uniform
   `eraN(world, rng, p, state)` signatures; founded=false no-op rule —
   **resolved**
5. Era-3 arithmetic: ≥5 corridor tiles in top-quartile mask; alive-count
   balance equation; second-corridor 50% rule — **resolved**
6. Era-5 split into decay-then-abandon passes over a pre-collected
   snapshot — **resolved**

**Post-revision verdict: APPROVED** — proceed to execution.
