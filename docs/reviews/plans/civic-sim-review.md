# Plan Review: civic-sim

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-12
## Mode: Agent Team (concurrent review + revision)

> The final pillar's gate. Six yield points (2 Structural, 3 Moderate, 1
> round-2 Minor) — all accepted with no fix-later shims; one
> load-bearing claim pressure-tested and verified SOUND by both stances
> independently; the proposer's grounding pre-resolved the three flagged
> risk items and self-found a wrong dependency edge before the exchange
> began.

## Yield Points Found

### 1. Repair-forwarding rested on a false return-shape assumption
**Severity:** Structural
**Evidence:** PRP §2 claimed "applyTool RETURNS an action descriptor";
the real `ApplyResult` is `{ok, reason?, info?}` — no kind, no position
(tools.ts:68-73). Plus a `recordRepair` signature inconsistency
(§2's `(x,y,tick)` vs Task 2's `(neighborhoodId,tick)`) and an
unimplementable "bulldoze-of-blight" (unclassifiable after the tile is
cleared).
**Proposer Response:** Accepted — forwarding moved to main.ts's
`applyAt` scope (the caller already holds x, y, tool); resolution via
the live partition's `tileToNeighborhood`; `recordRepair(neighborhoodId,
tick)` pinned with id-0 as a safe no-op ("trust rises only where
there's a community to hold it"); bulldoze excluded; REPAIR_KINDS
pure-tested; multi-tile builds credit the anchor's neighborhood
(documented intent).
**PRP Updated:** Yes (5 edits).

### 2. Remap carryover was self-contradictory and undefined at genesis
**Severity:** Structural
**Evidence:** "Tile-count-weighted mean" vs "merges average" conflicted;
a zero-parent (all-fresh) neighborhood divided by zero; fresh tiles in
mixed neighborhoods were unhandled.
**Proposer Response:** Accepted — one rule: `floor(Σwᵢvᵢ/Σwᵢ)` over
prior-neighborhood tiles only (worked example pinned), genesis seeds to
80/40/90, fresh tiles excluded from both sides of the ratio,
deterministic ring tie-break. All four cases RED-tested.
**PRP Updated:** Yes.

### 3. The partition fixture contradicted the fragmenting table
**Severity:** Moderate
**Evidence:** The PRP's own fixture said parcel clusters "joined by a
street" form one neighborhood — but RoadStreet IS fragmenting
(influence.ts:65-67); and halo-tile assignment near fragmenting tiles
risked anchor-id nondeterminism.
**Proposer Response:** Accepted — partition redefined as connected
components of member tiles with fragmenting tiles as excluded barriers
(no assignment, no tiebreak class at all); fixtures rewritten with
explicit kinds including RoadStreet→TWO neighborhoods.
**PRP Updated:** Yes.

### 4. Report-cache lifecycle unspecified across cadence boundaries
**Severity:** Moderate — accepted; `simTick` now owns the post-tick
report recompute, making the N=120 composite determinism test genuinely
cover cache coherence.

### 5. Pulse line conflated metrics and clobbered the shared dock slot
**Severity:** Moderate — accepted; shared exported `wellbeing(world)`
used by effort and pulse alike; `pulseLine(wellbeing, prev|null)` with
null→flat at t=0; a dedicated always-on `pulseDock` element instead of
the latest-action-wins status slot it would have fought.

### 6. New guard matchers could pass vacuously green (round 2)
**Severity:** Minor — accepted; CIVIC_IMPORT/ECOLOGY_IMPORT matchers
ship positive-fire + benign-negative self-checks per the guard's
established pattern; tech↛ecology made explicit.

## Pressure-Tested and Verified Sound

The backwards-degradation identity: `max(1, floor(alive/8 + cond/32 +
0 + 0))` is byte-identical to the legacy formula — ONE outer floor over
summed terms, verified independently by both stances; wording hardened
to forbid a per-term-floor implementation, and the float-input caveat
(EcologyReport means are floats) pinned with widened strict-step test
spans. The riskiest claim in the plan, and it held.

## What Holds Well

- **Every cited symbol verified at HEAD** by both stances — including
  the exact capability id strings the sim finally consumes.
- **The dependency graph stays a DAG**: civic → {ecology, engine, tech};
  nothing imports civic back; the one new edge carries one predicate
  and is guard-asserted with non-vacuous matchers.
- **The Moses thesis made spatial**: fragmenting roads as civic
  boundaries fell out of reusing the ecology table rather than
  inventing parallel semantics.
- The proposer's grounding pass pre-resolved all three lead-flagged
  risk items and self-found the spurious worldgen dep edge — eighth
  cycle running, the grounding discipline is now load-bearing.

## Summary

Two structural gaps that would have stalled one-pass execution, three
ambiguities that would have encoded wrong contracts silently, one
vacuity risk in the new guards — all closed against HEAD in two rounds.
Remaining uncertainty is tuning data per the PRP's own log.

**APPROVED** — proceed to `/execute-team`.
