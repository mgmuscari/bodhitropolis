# Plan Review: ecology-layers

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-12
## Mode: Agent Team (concurrent review + revision)

> Two structural, two moderate, and a batch of minor yield points — all
> resolved in two rounds, with three team-lead rulings (one backed by a
> PRD amendment) and both stances independently catching the same false
> premise before exchanging a word about it. The interlocutor's
> re-verification caught a latent unit bug (tile vs. parcel cohorts) in
> the revision itself.

## Yield Points Found

### 1. The era5 chronicle line was invisible in the opening — a false display premise
**Severity:** Structural
**Evidence:** The opening renders exactly one headline per era
(`events[0]`, openingContent.ts:58-61); moses-century owns
era5.events[0], so the eco-seed line lands at events[1] and never shows —
under EITHER prefix choice the PRP offered. The Task 4 test asserted
"parsed into era 5" (green) while the design goal (visible) failed —
the vacuous-test family again, caught at plan time.
**Proposer Response:** Accepted — found independently during grounding
and routed the scope question up.
**Team-Lead Ruling + PRD Amendment:** the wound MUST surface in the
player's first read; PRD AC#2 amended to require it ("recording alone is
not enough"). Mechanism: `ecologyReport` exposes nullable corridor-soil /
periphery-fauna scalars (Task 5); `ecologyStatLine(report): string|null`
in openingContent with omit-when-null (Task 6); the era5: line stays as
the durable RECORD with all display claims excised and a regression
guard pinning `eraHeadline(era5)` unchanged.
**PRP Updated:** Yes (both halves verified in-file by the interlocutor).

### 2. "Ecology writes only its own layers" was enforced by review, not test
**Severity:** Structural
**Evidence:** The PRD names dual-source drift as a top risk and AC7
demands tools-then-tick isolation, but no automated assertion existed.
**Proposer Response:** Accepted — byte-isolation tests added to Tasks 3
and 4 (six non-ecology layers + `parcels.snapshotBytes()` byte-identical
across `ecologyTick`/`ecoSeedStage`; `world.log` deliberately excluded —
the seed stage legitimately appends the record line).
**Team-Lead Ruling (TechState):** unit tests stay signature-honest
(tech is unreachable by construction — asserting it would be the vacuous
family), but the AC7 integration test (place-garden-via-tools → ticks)
adds the one-line `tech.snapshotBytes()` guard — placed at exactly the
seam a future civic-sim ecology→wellbeing coupling would tempt someone
to thread tech into the tick. Structural argument recorded in the PRP so
the omission reads as deliberate.
**PRP Updated:** Yes.

### 3. Fauna dynamics underspecified in three load-bearing ways
**Severity:** Moderate
**Evidence:** Habitat was computed but absent from the update formula
(saturation-flood risk); "best neighbor" ambiguous; sub-step
prev/next ordering and scratch allocation unpinned.
**Proposer Response:** Accepted — habitat is now a carrying-capacity CAP
(`min(habitat, max(prev.fauna, bestNbr − LOSS))`); best-neighbor ranks
on prev fauna; strict double-buffering with the 1-tick lag pinned by
fixtures; persistent scratch buffers; and a self-caught follow-on hazard
fixed (CORRIDOR_FLOOR so quiet streets can relay fauna while fragmenting
tiles stay impassable — the road-diet bridge made mechanically real).
**PRP Updated:** Yes.

### 4. Simpson's rationals can't live in a Uint8 field (overflow fear was a non-issue)
**Severity:** Moderate
**Evidence:** The interlocutor cleared the overflow concern numerically
(7×7 windows: Σcount² ≤ 2401 — doubles exact to 2^53) but the pinned
exact values (1/2, 3/4) were type-impossible against a Uint8 layer.
**Proposer Response:** Accepted — split into a pure exact-rational
`simpsonIndex(counts) → {num, den}` (cross-multiplication tests incl.
non-dyadic 6/9) and `biodiversityField → Uint8` via pinned
`floor((255·num)/den)`; window clamped, total ≥ 1 (no 0/0); tint ramps
decoupled at input values.
**PRP Updated:** Yes.

### 5. Minors
Cadence phase pinned (`tick > 0` — no tick-0 firing); biodiversity
overlay recomputes on each ecology tick for that view; "reads tech
state" misstatement dropped; `ecologyTick(map)` signature unified; stale
line-cites corrected. All folded.

### 6. Factual corrections from the proposer's grounding
The PRP's "T is bound in main.ts" was false (techPanel self-binds via
its own keydown + pure gate — the E-key plan now mirrors the real
pattern); the ring split made explicitly TILE-mean-based (the blight
report's parcel-cohort MIN_COHORT guard is the wrong unit for tile
layers — caught in the interlocutor's round-2 re-verification).

## What Holds Well

- **Both stances independently found the structural display flaw** before
  exchanging messages — the convergence signal at its strongest.
- **The no-transcendentals biodiversity design** (Simpson over Shannon)
  survived scrutiny and got *more* exact (rational pins, floor
  convention) rather than weaker.
- **The influence table keys on KIND, not category — verified necessary**
  (QuietStreet shares the road category but must not fragment; the
  road-diet payoff exists precisely in that distinction).
- **Per-tick cost arithmetic checked honestly** (~410K integer ops per
  ecology tick at K=10 — genuinely cheap).
- The ruling pattern matured: scope disagreements settled by amending
  the source contract (PRD) rather than negotiating around it.

## Summary

5 yield-point families + 2 grounding corrections + 3 team-lead rulings
(display required + PRD amendment; integration-seam TechState guard;
record/display split). Converged in two rounds, nothing rejected,
nothing open. The plan entered with a false-premised display design, an
untested core invariant, an unbuildable fauna formula, and a
type-mismatched biodiversity contract — it leaves with all four closed
under tests that pin honest contracts.

**APPROVED** — proceed to `/execute-team`.
