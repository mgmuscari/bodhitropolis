# Code Review: bodhitropolis-foundation

## Verdict: REQUESTS CHANGES
## Reviewer Stance: Code Review Partner
## Date: 2026-06-12

> **Mode note:** sequential `/review-code` (team mode environmentally
> unavailable this session — see the plan review's mode note). Implementation
> was executed by a headless proposer agent (`DIALECTIC_TEAM_AGENT=1`), per
> the PRP's execution-mechanics note; this review is the independent check on
> that work.

## PRP Compliance

All 10 tasks implemented as specified, one atomic commit each
(`45acf1b`..`7a5f61c`), 94 tests, gates independently re-verified by the team
lead (`tsc` clean, 94/94 vitest, `vite build` 11.88 kB). Task-by-task:

| Task | Status |
|---|---|
| 1 Scaffold + hook conversion | ✅ as specified; hooks guard `node_modules` (yield pt 3); `.gitignore` untouched (yield pt 7) |
| 2 Seeded PRNG | ✅ sfc32 + splitmix32 + FNV-1a, `Math.imul`-only; pinned-output tests |
| 3 Fixed-tick loop | ✅ accumulator + spiral-of-death clamp + `alpha` |
| 4 Layered map | ✅ 5 typed-array layers; `as const` unions (yield pt 5); FNV snapshot |
| 5 Value noise + fBm | ✅ stateless, transcendental-free |
| 6 Pipeline | ✅ fork-by-stage-name; "remove stage B, stage C unperturbed" tested |
| 7 Terrain stage | ✅ with two justified deviations (below) |
| 8 Architecture guard | ✅ DOM + transcendental-Math + dep-direction; comment-stripping; self-checked |
| 9 Camera/renderer/input | ✅ camera math pure + tested; integer zoom; smoothing off |
| 10 README | ✅ Bodhitropolis section prepended, upstream content preserved |

**Deviations (all justified, all documented by the implementer):**
1. River erosion deferred to post-walk — *required* to keep the strictly-
   descending routing guarantee that the connectivity contract (plan-review
   yield point 1) depends on. Sound engineering judgment.
2. Terrain params tuned (`seaLevel .36, springCount 4, forestMoisture .5`) —
   explicitly sanctioned by the PRP Uncertainty Log ("tune params, not
   bounds"); bounds were not widened. ✅
3. `@types/node` added — required by the Task-8 guard's `node:fs` usage. ✅
4. Guard strips comments before scanning — more robust, self-checked. ✅
5. Stricter tsconfig than PRP minimum — consistent with intent. ✅

## Issues Found

### 1. Rivers' existence is never asserted — connectivity tests can pass vacuously
**Category:** Test Quality
**Severity:** Significant
**Location:** tests/worldgen/terrain.test.ts:98-147
**Details:** `assertRiversDrain` computes and *returns* `componentCount`, but
no caller asserts it is ≥ 1. If a regression caused terrain to produce zero
river cells (e.g. springs all pooling immediately), all five per-seed
connectivity tests would pass vacuously and the plausibility bounds would
still pass via ocean/lake coverage. This is the same failure family the plan
review's yield point 1 fixed once already — an invariant test that can be
satisfied by absence. Rivers were verified manually in the browser, but CI
would not catch their disappearance.
**Suggestion:** In each per-seed connectivity test, capture the return value
and `expect(componentCount).toBeGreaterThanOrEqual(1)`.

### 2. Camera position not re-clamped when the viewport changes
**Category:** Logic
**Severity:** Minor
**Location:** src/main.ts:43-50, src/ui/camera.ts:39-40
**Details:** The resize handler mutates `camera.viewportWidth/Height`
directly; `clampPosition()` only runs on pan/zoom. Shrinking…growing the
window while panned to the map's far edge leaves the camera out of bounds
until the next pan/zoom — a transient dark band past the map edge.
**Suggestion:** Add `setViewport(w, h)` on `Camera` that re-clamps, use it in
the resize handler, cover with a camera unit test.

### 3. Misleading comment on deferred erosion
**Category:** Convention (comment accuracy)
**Severity:** Nit
**Location:** src/worldgen/terrain.ts:245-246
**Details:** "Deferred erosion: carve river valleys without perturbing the
routing field of this (or any later) river walk" — later walks *do* see
earlier rivers' erosion (which is desirable: it encourages confluence). The
actual invariant is that the field is static *during* any single walk.
**Suggestion:** Reword to state the static-during-each-walk invariant.

## What's Done Well

- **The determinism discipline is genuinely engine-portable**: integer-only
  hashing/PRNG, exactly-rounded float ops, rational falloff instead of
  `Math.exp`, and an architecture guard that enforces the rule mechanically —
  with a self-check that the guard itself fires. This is the foundation the
  whole DF-style reproducibility promise rests on, done right.
- **carveRivers handles every termination case against the connectivity
  contract**: standing water (break before marking — predecessor adjacency),
  edge (mark then break), merge (break on already-river), local minimum
  (pool to Lake, pop the carved cell). The reasoning is visible in the code.
- **Test quality is high**: pinned PRNG vectors, the fork-independence
  contract ("removing stage B doesn't perturb stage C"), hand-crafted
  elevation fixtures for spring selection, bounded plausibility windows that
  pin parameters honestly rather than widening bounds.
- **Renderer avoids the classic pixel-art traps**: per-tile `floor` with
  integer tile sizes (no seams), `imageSmoothingEnabled = false` +
  `image-rendering: pixelated`, DPR-aware backing store.
- Commit hygiene: 10 atomic conventional commits exactly matching PRP tasks.

## Summary

Excellent foundation work — the implementation is faithful to the PRP, the
deviations are the kind a good engineer makes (and documents), and the
determinism rule is enforced structurally rather than by convention. One
Significant test gap blocks approval: river existence must be asserted so
the connectivity invariant cannot pass vacuously. Two smaller items (resize
re-clamp, comment wording) should ride along in the same fix.

**Required before approval:** Issue 1. **Should also fix:** Issues 2-3.
