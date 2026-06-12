# Plan Review: urban-fabric

## Verdict: REQUESTS CHANGES
## Reviewer Stance: Interlocutor
## Date: 2026-06-12

> **Mode note:** sequential review; team mode remains environmentally
> unavailable this session (see the foundation plan review's mode note).

## Yield Points Found

### 1. The crossroads is impossible under the plan's own placement rules
**Severity:** Structural
**Evidence:** Task 3 defines `canPlaceTransport(map, x, y)` as requiring
`built == 0` ("v1: no road/rail overlap, no crossings"). Task 5 lays "a
crossroads through the site center — `RoadAvenue` E-W, `RoadStreet` N-S".
The junction tile must be occupied by both roads: whichever is laid second
fails `canPlaceTransport` at the crossing, leaving either a gap in the
second road or two disconnected half-streets. PRD acceptance criterion 7
("roads render with correct junction connections") cannot be met. The PRD's
open question 2 forbade road/*rail* overlap; the PRP over-generalized it to
all transport overlap, including road/road junctions.
**Pressure applied:** "Walk Task 5's layout through Task 3's placement
rules tile by tile." The center tile fails.
**Recommendation:** Specify junction merge semantics in Task 3:
`placeTransport` succeeds when the target tile already holds a transport
kind of a *connectable category* (road onto road), resolving the tile
deterministically to the higher-capacity kind (`max` of the two kind codes —
street < avenue < highway, so the bigger road wins the junction tile).
Road-onto-rail and rail-onto-road still fail (no crossings in v1). Add mask
tests for a 4-way junction tile and add an explicit junction case to the
Task 5 tests.

### 2. Two determinism currencies: `map.snapshot()` vs `hashWorld`
**Severity:** Moderate
**Evidence:** Task 1 folds the new `parcel` layer into `GameMap.snapshot()`,
but parcel *attributes* (kind, density, condition) live outside the map in
`ParcelStore`, covered only by the separate `hashWorld(map, store)`
(Task 2). Existing determinism tests (terrain.test.ts:32-36) use
`map.snapshot()`. Once stages mutate store attributes, a future stage's
determinism test that habitually uses `map.snapshot()` passes even if
condition/density assignment is nondeterministic — the exact "invariant
satisfiable by absence" failure family the foundation reviews caught twice.
The PRP also leaves the store's home ambiguous ("Task 2 or 5, whichever
lands the dependency first — executor's choice"), which is the kind of
ambiguity PRPs exist to eliminate.
**Pressure applied:** "Which hash must a Moses-century determinism test
use, and what stops it from using the wrong one?"
**Recommendation:** (a) Decide now: `WorldState.parcels: ParcelStore`,
created by `runPipeline`, lands in Task 2 (pipeline + WorldState touched
once, early). (b) Make `hashWorld(world)` take the WorldState and document
it in pipeline.ts as THE canonical world hash for all stage determinism
tests from now on. (c) Task 5's determinism tests use it (already planned);
add a fabric test asserting `setCondition` changes `hashWorld` while
`map.snapshot()` alone does not — pinning the asymmetry as documented,
intended behavior.

### 3. Tile↔store agreement sweep is one-directional
**Severity:** Minor
**Evidence:** Task 3's tests assert `built[i]` is a building kind ⇒
`parcel[i] != 0` and the store kind matches. The converse is unasserted: a
stray `parcel[i] != 0` over a road or empty tile (e.g. a future bulldoze
bug) passes the sweep.
**Pressure applied:** "What corruption does the sweep not see?"
**Recommendation:** Make the shared agreement helper bidirectional:
`parcel[i] != 0` ⇒ `isBuildingKind(built[i])` AND tile (x,y) lies inside
that store entry's footprint.

### 4. Demo site selection "first few candidates" is unquantified
**Severity:** Minor
**Evidence:** Task 5 site sub-step: "rng tie-break among the first few
candidates" — "few" is executor ambiguity in an otherwise deterministic
spec.
**Pressure applied:** "Two executors implement this; do they produce the
same worlds?" (They need not match each other — but the spec should not
make the executor decide a constant silently.)
**Recommendation:** Specify: collect the first K=8 valid windows in spiral
order, choose `rng.nextInt(K)` (fewer than 8 found → `rng.nextInt(found)`).

### 5. Renderer per-tile `store.get()` churn
**Severity:** Minor (nit)
**Evidence:** Task 6 draw pass does a store lookup per built tile;
`get(i)` materializes an object. Rendering is dirty-flag-gated
(main.ts:36-39, 58-61), so churn occurs only on pan/zoom frames — not a
real perf issue at 128×128, but the allocation is avoidable.
**Pressure applied:** "What allocates per frame while dragging?"
**Recommendation:** Renderer reads scalar accessors (e.g.
`store.conditionAt(index)`) instead of materializing `get()` views; or
explicitly accept the churn in a comment. Executor's discretion.

## What Holds Well

- **Verified references are accurate** (checked against the merged
  foundation): map.ts:12-16 enum pattern, :48-60 constructor, :111-119
  snapshot; pipeline.ts:19-23/:37 stage contract + fork-by-name;
  terrain.ts:343-348 sub-stream forking; renderer.ts:39-58/:60-71/:129-136
  atlas machinery; terrain.test.ts:32-36/:71-90/:143-147 test conventions.
  The PRP builds on what actually exists.
- **Single-writer placement** (placement functions as the only built/parcel
  writers) directly addresses the dual-source-of-truth risk the PRD named.
- **The kind taxonomy with explicit reserved ranges** (transport 1-15,
  Moses 16-47, tech-tree 48+) is the right cheap bet before any save format
  exists.
- **The placeholder stage is properly fenced**: named, banner-commented,
  with a no-throw all-water fallback and a successor feature scoped to
  delete it.
- **Test discipline carries forward**: existence asserted alongside
  invariants (every kind placed ≥1), exhaustive 16-mask coverage, rejection
  paths enumerated per cause.

## Summary

The plan is well-grounded in the real codebase and keeps the foundation's
determinism discipline. One structural contradiction must be fixed before
execution — the placement rules forbid the very crossroads the demo stage
must lay (yield point 1); the fix (junction merge with deterministic
max-kind resolution) is small and well-contained. The determinism-currency
split (yield point 2) needs a decision now, not at execution time. Minors
3-5 should ride along.

**Path forward:** revise the PRP per yield points 1-5 (targeted edits),
then proceed to headless-proposer execution per the established pattern.
