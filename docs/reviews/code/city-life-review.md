# Code Review: city-life

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-15
## Mode: Agent Team (message-gated incremental review)

> Four PRP tasks + two nit fixes, all APPROVED. Suite **790 → 815** tests
> (+25, 44 files), `tsc` clean, `build` clean, determinism byte-stable. The
> final playtest feature: the map is alive — cars run the freeways, bird flocks
> drift over the healed/wild edges, all read-only and deterministic, drawn by a
> split renderer whose cached base survives both hovers and continuous animation.
> Live-passed in **both Chromium and WebKit**.

## PRP Compliance

All 4 tasks implemented as specified (the union of both plan-review ledgers).
Scope held to **one new pure module** (`src/ui/ambientContent.ts`) +
`src/ui/renderer.ts` (split) + `src/main.ts` (wiring) + `src/ui/dockContent.ts`
([Life]) + tests + the `PURE_UI_ALLOWLIST` append. **Zero engine/worldgen/
ecology/civic/tech/tools logic changes; no new mechanics; `AmbientState` is
renderer-side only (never serialized, never in `hashWorld`).**

| Commit | Task | Verdict |
|---|---|---|
| `de520a9` | 1 pure ambient stepper (stepAmbient @50ms + spiral clamp; map-wide global-cap rejection-sampling spawn; heading/no-reversal motion; despawn; decision helpers) | ✅ APPROVED — 2 Nits |
| `75c0888` | nit — tidy flock despawn + characterization const | ✅ APPROVED |
| `2a8e4a0` | 2 renderer split (cached base + composite; preview in composite; imageSmoothing both ctx; dpr/identity transform) | ✅ APPROVED |
| `c4e2670` | nit — centre bird sprite on tile (+0.5) | ✅ APPROVED |
| `d00e905` | 3 main wiring (continuous loop; markDirty[7]/markPreviewDirty[4]; separate lastAmbient; visibility pause; [Life] key) | ✅ APPROVED |
| `6a48229` | 4 [Life] dock toggle (metaButtons +life; dockContent.test + all call sites updated) | ✅ APPROVED |

## Issues Found

No Blocking/Significant/Minor across the four tasks; 2 Nits, both fixed in-flight
(`75c0888`, `c4e2670`). The hard thinking happened in the plan review (below),
so execution was clean.

## Plan-Review Lineage (~11 findings, resolved before code)

The plan review (docs/reviews/plans/city-life-review.md) was the most productive
of the four — two independent critics surfaced **two architecture flaws in the
draft PRP** that this implementation never had to discover at code time:
- **Preview-in-base would have defeated the cache** on every hover → preview
  moved to a per-frame `composite()`; the dirty triggers split into **7 base
  (`markDirty`) + 4 preview/selection (`markPreviewDirty`)**, so a hover never
  rebuilds the base. The interlocutor further proved the base survives
  **continuous render**: the sim path only *reads* `map.built` (never writes
  built/condition/kind), so no tick can stale the base under the sprites.
- **Camera-blind stepper** can't spawn "by visible tiles" → spawns map-wide to a
  **global per-kind cap via rng rejection-sampling**; the renderer culls to the
  viewport (step O(capped), draw O(visible)).
- Plus the stealth sim-coupling fix: a **separate `lastAmbient` clock** (the
  visibility reset never touches the sim's `last`, so resume catch-up ticks
  aren't suppressed — AC#7).

## Invariants Held (reviewer- + lead-verified)

- **READ-ONLY** — `stepAmbient` writes only `AmbientState`; `hashWorld(world)` is
  byte-unchanged across N steps (pinned + live-verified).
- **STREAM ISOLATION** — `createRng(seed).fork('ambient')` only; a worldgen+sim
  run is identical with vs without an interleaved stepper (pin b).
- **PURE / NO-TRANSCENDENTAL** — `ambientContent.ts` on `PURE_UI_ALLOWLIST`;
  `Math.min`/`Math.sqrt`/integer only (no sin/cos/exp/pow/log/random); boids
  sqrt-normalize, cars/peds grid-follow.
- **BASE-INVALIDATION** — two named chokepoints (7 + 4); preview in composite;
  ambient-OFF render output-identical to today (no regression).
- **50ms FIXED substeps + spiral clamp** (`AMBIENT_MAX_FRAME_MS=1000`, ≤20
  substeps/call); **determinism via two fresh forks**.
- **Cars follow road class** (carWeightForRoad 3/2/1/0) and **never enter quiet
  streets** (traversal pinned to `isCarRoad`=`isRoadKind`) + no-oscillation
  motion; **birds** flock 3–7 by `faunaPresence`.

## Team-Lead Live Browser Verification (Chromium + WebKit)

In-page over the real seed-`bodhitropolis` map (both engines): cars 17 / peds 0 /
birds 32 — **identical across engines**; read-only hashWorld unchanged;
deterministic (two fresh forks); exact car weights 3/2/1/0. **Peds 0 is correct
at the blighted start** — there are no calm/green substrates yet (quiet streets/
promenades/parklets/gardens/parks are all player-created), so traffic clots the
roads and birds haunt the wild edges while pedestrians await the walkable places
the player will build — "follows the impacts" exactly.
- **Chromium (visible):** the canvas-region hash changes across frames
  (`3202… → 3506… → 3938…`) — **continuous motion**; the screenshot shows cars on
  the freeway slabs/avenues and bird flocks over the green; the **[Life (L)]
  dock toggle** stops the motion cleanly (three identical frame hashes when off,
  reverting to the static dirty-driven path); **0 console errors**.
- **WebKit:** logic byte-identical; a direct `renderFrame` confirms **sprites are
  composited over the base** (baseOnly ≠ withSprites); the static-when-headless
  result confirmed the **`document.hidden` pause** works; **0 console errors**.

## What's Done Well

- **The dialectic earned its keep** — two critics caught two real architecture
  flaws (preview-in-base, camera-blind spawn) and the stealth sim-coupling before
  any code; the split is now a net win even with ambient off (a hover is a cheap
  blit, not a full redraw).
- **The "lifeless map" is answered** while the read-only/determinism contract is
  airtight — the sim is byte-identical whether the city is animating or frozen.
- **Clean execution** — 4 tasks + 2 nits, no Blocking/Significant, the proposer
  recovered from a slow spawn-start and then flowed task-to-task.

## Summary

4/4 tasks APPROVED; 0 Blocking/Significant/Minor; 2 Nits fixed. 815 tests, gates
green, determinism byte-stable and live-verified cross-engine. The city moves —
traffic on the roads, flocks over the wild — and signals its state through that
motion, exactly the playtest ask, with zero sim/world-state involvement.

**APPROVED** — proceed to PR after the `.dialectic-tier` strip (standard tier;
no security audit required). Deferred follow-ups (all non-blocking): a sprite
art pass (cars/birds are placeholder dark shapes now), and the two plan-review
minors (the ≤50ms self-healing road-conversion race; the shared Renderer
`document`-shim for both Task-2 headless backstops).
