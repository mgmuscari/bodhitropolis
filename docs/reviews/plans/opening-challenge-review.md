# Plan Review: opening-challenge

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-12
## Mode: Agent Team (concurrent review + revision)

> First team-mode plan review since split panes were repaired. Interlocutor
> raised yield points as separate messages; the proposer verified each
> against source and revised the PRP live; the team lead made the two PRD
> edits the proposer correctly routed up rather than editing the source
> contract unilaterally. Converged in 2 rounds, nothing rejected, nothing
> left open.

## Yield Points Found

### 1. Report's core/periphery invariant reintroduced survivorship bias
**Severity:** Structural
**Evidence:** Task 3 asserted `coreMean ≤ peripheryMean` citing the merged
gradient test — but that test (tests/worldgen/moses.test.ts:546-564) fixes
cohorts *pre-era-5* and scores demolished parcels as 0, while the report
sees only final-state survivors (the worst near-highway parcels are
precisely the ones abandoned). The cited warrant was unachievable from the
report's inputs. Sub-point: `distanceField` returns -1 for unreachable,
so naive `d ≤ 8` would classify a no-highway city's parcels as "core."
**Proposer Response:** Accepted. Added survivorship-free
`coreAbandonedShare`/`peripheryAbandonedShare` (computable from final
state because tombstones keep geometry); the tested invariant is now
`coreShare > 0 ∧ coreShare ≥ peripheryShare`; survivor means demoted to
descriptive fields with no ordering assertion; -1 handled via
min-over-footprint ignoring unreachable (→ periphery, never core).
Round-2 residuals (warrant prose, attrs range) also fixed.
**PRP Updated:** Yes (§2, Task 3, §6).

### 2. `craters`/`abandoned` semantics diverged from the chronicle beside them
**Severity:** Moderate
**Evidence:** "Alive ParkingLot" counts era-2 parking (moses.ts:599) as
craters; `count − aliveCount` counts era-3 corridor demolitions
(moses.ts:657) as abandonment — both contradict the era-5 line the overlay
displays next to them; and `abandoned === count − aliveCount` was a
tautological test.
**Proposer Response:** Accepted. Both fields (plus `preEra5Standing`) now
chronicle-sourced and nullable; tautology replaced with the non-vacuous
store↔chronicle identity `parcelsAlive === preEra5Standing − abandoned +
craters`, guarded to founded seeds.
**PRP Updated:** Yes (Task 3, §2).

### 3. The "architecture guard" mitigation didn't cover the pure-ui module
**Severity:** Moderate
**Evidence:** architecture.test.ts scans only `src/engine` + `src/worldgen`
(:15-16, :52); `src/ui/openingContent.ts` — the module the PRD's purity
mitigation names — was unscanned, leaving purity convention-only.
**Proposer Response:** Accepted. Task 4 extends the guard with an explicit
pure-ui allowlist (DOM-free + transcendental-free + self-check), chosen
over relocating presentation copy into worldgen (layer smell). Fail-open
caveat documented with a `src/ui/pure/` fail-closed migration trigger.
**PRP Updated:** Yes (§2, Task 4, §6).

### 4. "Era-3 rail line may appear twice" was a control-flow misread
**Severity:** Minor
**Evidence:** moses.ts:696-701 is an early-return branch, mutually
exclusive with :760 — the line appears exactly once per founded city; the
PRP's "take the last occurrence" mitigation risked a vacuous test.
**Proposer Response:** Accepted (independently caught during grounding).
§6 corrected; Task 2 asserts `count === 1`.
**PRP Updated:** Yes (§6, Task 2).

### 5. Content-signature and degenerate-seed gaps (three parts)
**Severity:** Minor
**Evidence:** (a) `challengeText(name, report)` couldn't reference the
promised era fact (no chronicle in signature); (b) "all five era entries"
over-promised — all-water seeds log only `era1: no viable site`; (c) stale
PALETTE line cite; mean/median NaN on zero alive parcels.
**Proposer Response:** Accepted. (a) signature now `(name, report,
chronicle)` with a verbatim-substring test; (b) era-list renders what the
chronicle records, `eraHeadline` falls back to the year range; (c) cite
fixed, NaN guarded with an exact `=== 0` all-water assertion. Follow-up
naming question (projects standing vs built) resolved as
`projectsStanding` with the semantic documented in the interface.
**PRP Updated:** Yes (Tasks 2/3/4/5).

## Team-Lead Actions (PRD edits routed by the proposer)

The proposer correctly declined to edit the source PRD. The team lead
restated: **AC#2** — now the chronicle identity + survivorship-free
abandonment-share gradient (replacing both the biased mean ordering and
the `count − aliveCount` tautology); **AC#5** — overlay renders "the eras
the chronicle records (all five on viable seeds)."

## What Holds Well

- Every code citation in the PRP ground-truthed by *both* agents
  independently — moses.ts log formats (all 11 cited lines), fabric.ts
  accessors, fields.ts signature, rng fork contract, main.ts headless
  guard, pipeline stage-name logging, palette/ground colors.
- The proposer pre-spotted YP1 during its own grounding pass before the
  interlocutor raised it — the stances converged on the plan's weakest
  point from opposite directions, which is the dialectic doing exactly
  what it is for.
- Discipline on artifact ownership: PRD flaws were routed to the lead, not
  patched unilaterally by the implementing stance.
- The revised report design (chronicle-sourced numbers, nullable
  degenerate paths, named-for-semantics fields) is more honest than what
  either stance started with.

## Summary

5 yield points (1 Structural, 2 Moderate, 2 Minor): all accepted, all
revised into the PRP within the 2-round limit; two PRD acceptance criteria
restated by the team lead. No open items.

**APPROVED** — proceed to `/execute-team`.
