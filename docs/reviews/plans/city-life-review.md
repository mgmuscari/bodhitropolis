# Plan Review: city-life

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-15
## Mode: Agent Team (concurrent review + revision)

> ~11 distinct findings (2 Structural, 6 Moderate, 3 Minor), all resolved. This
> was the most productive plan review of the four: the dialectic surfaced **two
> deep architectural flaws in the draft PRP** — the hover preview baked into the
> cached base (which would defeat the cache on every hover) and a camera-blind
> stepper that can't spawn "by visible tiles" — plus the stealth sim-coupling
> bug (a shared-`last` reset that would suppress sim catch-up ticks on resume).
> The architecture's spine (read-only/stream isolation; no-trig feasibility via
> `Math.sqrt`) held throughout. Process note: the interlocutor was slow to
> surface; the team lead spawned a replacement critic, which serendipitously
> found the two structural items the interlocutor's ledger missed before standing
> down — so both ledgers' union became the spec.

## Yield Points Found

### 1. Base-cache invalidation — onHotkey omission AND preview-in-base (the cache-defeating flaw)
**Severity:** Structural
**Evidence:** (a) the draft's "full enumeration" of dirty triggers missed
`onHotkey` (`main.ts:368`, i/x/Escape), which clears the preview that lived in
the base pass → a stale tint under sprites. (b) Deeper: the draft drew the hover
**preview into the cached base** (`drawBase`), so every hover tile-change would
invalidate the base → a full O(visible-tiles) rebuild during tool use, defeating
the cache's entire purpose (raised by the replacement critic).
**Resolution:** Accepted — and re-architected. Preview moves OUT of `drawBase`
(now terrain+built+overlay only) INTO a per-frame `composite()` helper called by
both `render()` and `renderFrame()`. The dirty triggers split into **two named
chokepoints**: 7 base triggers (`markDirty` → `dirty` + `invalidateBase`) and 4
preview/selection triggers (`markPreviewDirty` → `dirty` only, no base rebuild).
`onHotkey` is now correctly in the preview-only set, and the stale-base hazard is
*dissolved* (preview is never in the base). The helpers are the guarantee; the
list is documentation; a headless test pins that a preview-only `dirty` does NOT
invalidate the base, for both paths.
**PRP/PRD Updated:** Yes (§2, Task 2/3, §6; PRD §2.2/AC#8).

### 2. Camera-blind stepper vs. "spawn by visible tiles" + the perf claim
**Severity:** Structural
**Evidence:** the pure stepper is camera-free (no viewport, for determinism), so
PRD Q1's "cars proportional to *visible* busy-road tiles" is unsatisfiable, and
the "O(visible sprites) per frame" claim conflated step and draw.
**Resolution:** Accepted — `stepAmbient` spawns **map-wide**, road-class/
substrate/fauna-weighted, to a **global per-kind cap** via rng rejection-sampling
(no O(65k) full-map scan); the **renderer culls to the viewport** at draw. Perf
claim corrected: STEP O(capped total ~hundreds), DRAW O(visible).
**PRP/PRD Updated:** Yes (§2 perf, Task 1, §6; PRD Q1/§2.2/AC#3).

### 3. visibilitychange `last` reset silently suppresses sim catch-up ticks
**Severity:** Moderate (stealth sim-coupling)
**Evidence:** the draft reset the **shared** `last` (consumed by
`sim.advance(now-last)`, `main.ts:411`); FixedTickLoop clamps a resume delta to
`maxFrameMs=1000` (`loop.ts:36,58`) → ~10 catch-up ticks fire on resume today,
which the reset would suppress — a silent sim-behavior change violating AC#7
("sim identical with/without ambient").
**Resolution:** Accepted — a **separate `lastAmbient`** clock; the sim path is
verbatim today's; visibilitychange/toggle reset ONLY `lastAmbient`. Surgical
two-clock isolation.
**PRP/PRD Updated:** Yes (Task 3, §6).

### 4. Cars could drive onto quiet streets (spawn-vs-traversal gap)
**Severity:** Moderate
**Evidence:** spawn weight 0 ≠ absence; `transportCategory(QuietStreet)=1`
(road) would admit a car moving from an adjacent avenue, while `isRoadKind`
excludes it (`fabric.ts:69`).
**Resolution:** Accepted — car traversability pinned to `isRoadKind` (1–3) via a
distinct `isCarRoad` helper (separate from the `carWeightForRoad` spawn weight);
`transportCategory` dropped; a "car never enters a quiet street" movement test.
**PRP Updated:** Yes (Task 1/5).

### 5. stepAmbient accumulator had no spiral-of-death clamp
**Severity:** Moderate
**Evidence:** the fixed-step loop reimplemented without FixedTickLoop's
`maxFrameMs` guard → a huge dt (post-pause/GC) → unbounded substeps → frame hang.
**Resolution:** Accepted — `Math.min(dtMs, AMBIENT_MAX_FRAME_MS=1000)` (≤20
substeps/call) + a `step(10_000_000) ≡ step(1000)` test; correctness no longer
depends on the resume reset.
**PRP Updated:** Yes (Task 1).

### 6. Car/ped motion model underspecified (would oscillate, not flow)
**Severity:** Moderate
**Evidence:** "step along the grid" alone yields A→B→A vibration, not motion that
"flows" (AC#10).
**Resolution:** Accepted — each car carries a heading + committed target tile;
at a junction it recommits to a connected road tile excluding the U-turn
`fromDir` (unless dead-end); peds the same on substrate. A `nextRoadStep` seam +
a monotonic-advance / no-immediate-reversal test.
**PRP Updated:** Yes (Task 1).

### 7. Render-split parity (AC#8) untested + DPR/smoothing unspecified
**Severity:** Moderate
**Evidence:** Task 2 shipped no test; two regression traps — `imageSmoothing
Enabled=false` on BOTH base+visible ctx (`renderer.ts:457-458`), and the
DPR transform (drawBase@dpr → identity 1:1 blit → dpr sprite pass).
**Resolution:** Accepted (honestly scoped) — both traps spelled out; a
recording-ctx/`drawBase`-spy headless test pins the **invalidation control-flow**
and base-dims; pixel parity stays the **live pass** *by environmental necessity*
(node env, no jsdom — `Renderer` is never instantiated in tests because
`buildAtlas` derefs `document`). Inherent, not a plan defect.
**PRP Updated:** Yes (Task 2, §6).

### 8. AC#7's second pin (stream isolation) missing from Task 1 tests
**Severity:** Moderate
**Evidence:** AC#7 = two pins; Task 1 had only the hashWorld (no-map-write) pin.
**Resolution:** Accepted — added the stream-isolation pin: a worldgen+sim run
with vs without an interleaved `stepAmbient` yields the IDENTICAL hash (ambient
forks `createRng(seed).fork('ambient')`, never the worldgen rootRng,
`pipeline.ts:42,45`). Pin (a) = no map writes; pin (b) = no rng-stream advance.
**PRP Updated:** Yes (Task 1).

### 9–11. Minors
- **Dock call-site churn (Task 4):** the `metaButtons` 3rd param (`ambientOn`)
  breaks all 2-arg callers (`main.ts:173` + `dockContent.test.ts:6/11/15/22/29/
  36/44`) and the exact-array assertions (now a 4-button list) — Task 4 corrected
  to "must update," not "still hold." (Minor)
- **Determinism test:** two independently-constructed, identically-seeded forks,
  never one shared stateful `Rng`. (Minor)
- **Car-ratio contract:** `carWeightForRoad` exact (3/2/1/0) is THE pure
  contract; the emergent fixture is fixed-seed exact counts + the ordering
  inequality (not a tolerance-banded "~ratio"). (Minor)

## What Holds Well

- **Read-only / stream isolation is real and now doubly-pinned** —
  `fork('ambient')` is independent of the worldgen rootRng; `hashWorld` covers
  map+parcels; YP3 removes the one sim-coupling path; AC#7 pins both axes.
- **No-trig determinism bet is sound** — `FORBIDDEN_MATH` bans
  exp/pow/log/sin/cos/tan/random but PERMITS `Math.sqrt` (self-check) → boids
  (sqrt-normalize) + integer grid motion need no trig; cross-engine
  deterministic.
- **Scope discipline** — additive, flag-gated, renderer-side-only `AmbientState`,
  no save/migration/engine-logic surface; `ambientOn=false` restores today's path.
- **The split is now a net architecture win even with ambient off** — a hover is
  a cheap base-blit + preview, not a full map redraw.

## Summary

~11 distinct findings (2 Structural, 6 Moderate, 3 Minor), all resolved across
two revision rounds; no residual blockers. The two Structural fixes
(preview→composite with a 7+4 invalidation split; camera-free global-cap spawn +
viewport-cull) and the stealth sim-coupling fix (separate `lastAmbient`) are the
substantive wins; the rest tightened tests/specs and right-sized the AC claims
to the node-no-jsdom env. The plan is read-only, deterministic, flag-gated, and
pure-where-it-counts; only the new `ambientContent.ts` joins the allowlist; no
engine/worldgen/ecology/civic/tech/tools logic changes.

**APPROVED** — proceed to `/execute-team`. The team lead owns the live browser
pass in **both Chromium and WebKit** (cars thick on freeways/avenues and absent
from quiet streets; pedestrians on calm/green streets; bird flocks over the
healed edges; ~60fps composite at zoom 1; [Life] toggle; tab-hidden pause; no
stale base under sprites) and the `.dialectic-tier` strip before merge.
