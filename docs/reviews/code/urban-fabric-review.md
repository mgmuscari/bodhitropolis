# Code Review: urban-fabric

## Verdict: APPROVED
## Reviewer Stance: Code Review Partner
## Date: 2026-06-12

> **Mode note:** sequential `/review-code`; implementation by headless
> proposer (`DIALECTIC_TEAM_AGENT=1`), per the established session pattern.
> Gates re-verified independently by the team lead: `tsc` clean, **160/160**
> vitest (11 files, +65 over main), `vite build` green, tree clean.

## PRP Compliance

All 7 tasks, one atomic commit each (`a78e07b`..`9f989a1`):

| Task | Status |
|---|---|
| 1 BuiltKind + parcel layer | ✅ reserved ranges documented in code; snapshot extended |
| 2 ParcelStore + hashWorld | ✅ WorldState.parcels pipeline-owned (yield pt 2); asymmetry pin test present (fabric.test.ts:180) |
| 3 Placement + junction merge | ✅ merge to max-kind, order-independence tested (fabric.test.ts:290); road↔rail rejected (:302) |
| 4 Masks + road adjacency | ✅ 16 configs exhaustive (:369), 4-way junction (:401), corners (:411), diagonal/rail-frontage negatives (:437, :445) |
| 5 fabric-demo stage | ✅ PLACEHOLDER-fenced; K=8 spiral site pick; junction existence asserted per seed (fabricdemo.test.ts:89); all-water no-throw (:111) |
| 6 Renderer v1 | ✅ scalar `conditionAt` only (yield pt 5); verified live via Playwright screenshot by the implementer |
| 7 Docs | ✅ README fabric section |

**Deviations (4, all sound):** scalar accessors moved to Task 2 where they
could be TDD'd; footprint position derived from parcel-layer neighbor
equality instead of store reads (better than the plan — zero churn, correct
at edges); `hashWorld` typed structurally (`HashableWorld`) because importing
worldgen's `WorldState` would violate the engine→worldgen ban the
architecture test enforces — the plan's signature was architecturally
impossible as written, and the executor caught it; demo roads span the site
window (makes "nothing on water" hold by construction).

## Issues Found

### 1. Renderer condition lookup silently tolerates a corrupt parcel id
**Category:** Error handling
**Severity:** Nit
**Location:** src/ui/renderer.ts:337
**Details:** For a building tile with `parcel[i] == 0` (impossible unless the
single-writer invariant is violated), `conditionAt(-1)` reads `undefined`,
the tier silently resolves to 0, and the tile renders pristine. Engine-level
integrity is properly covered by `checkParcelAgreement` tests, and the
renderer already skips unknown atlas keys defensively — but the underflow
deserves one comment line acknowledging the assumption.
**Suggestion:** Comment (or `pid !== 0` guard) noting the invariant
dependency. Fine to fold into the next feature's renderer work.

### 2. Transport predicate vs. reserved transit range
**Category:** Convention
**Severity:** Nit
**Location:** src/engine/fabric.ts:13, :42
**Details:** The header reserves codes 5..15 for future transit kinds, but
`isTransportKind` is hardcoded `k <= 4`. Correct today; when the first
transit kind (streetcar, elevated rail…) lands in the tech-tree era, the
predicates must be updated together. Single location, comment-adjacent —
acceptable.
**Suggestion:** None required now; the tech-tree feature that adds code 5
inherits this note.

## What's Done Well

- **The junction-merge implementation is exactly the structural fix the plan
  review demanded**, with order-independence proven, and the demo's
  per-seed "≥3 mask bits at some tile" test exercises it end-to-end.
- **`checkParcelAgreement` returns human-readable violations** rather than a
  boolean — corruption reports name the tile and the reason. Its own test
  proves non-vacuity by corrupting state and expecting flags.
- **The executor caught a real plan error** (`hashWorld(world: WorldState)`
  would have made engine import worldgen) and resolved it with structural
  typing — the architecture guard's dependency-direction rule did its job
  at design-time, not just test-time.
- **Determinism currency is now unambiguous**: `WorldState.parcels` doc
  comment points every future stage test at `hashWorld`, and the asymmetry
  pin makes the map-snapshot blind spot a *documented, tested* fact.
- Implementer verified rendering in a real browser (Playwright), not just
  by build success — junction arms, all 8 kinds, weathering tiers,
  footprint insets confirmed visually.

## Summary

Faithful to the revised PRP, with deviations that improved on it. The two
nits are advisory and non-blocking. The fabric model gives the Moses-century
feature exactly the substrate it needs: kinds with growth headroom, parcels
with condition (the future blight driver), single-writer placement with a
mechanical integrity check, and junction-capable roads.

**APPROVED — proceed to PR.**
