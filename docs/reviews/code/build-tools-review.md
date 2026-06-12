# Code Review: build-tools

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-12
## Mode: Agent Team (message-gated incremental review)

> Full team pipeline: `/review-plan-team` (6 yield points) →
> `/execute-team` (this artifact). Eight commits, all CLEAR — never a
> Blocking or Significant finding. A teammate-to-teammate message channel
> glitch dropped per-task verdicts mid-run; the verdict record was intact
> at the lead and the loop recovered via timeout-pipelining with zero
> unreviewed commits in the final state. The reviewer pre-built a
> block-level byte-verifier for the five FROZEN suites and probed its own
> added guard for non-vacuity. The team lead ran two live browser passes.

## PRP Compliance

All 6 tasks + 2 review-driven hardening commits, suite 388 → **488**
tests (24 files), `tsc` clean, build green, FROZEN suites byte-unmodified
in all 8 commits:

| Commit | What | Verdict |
|---|---|---|
| `d3a2da3` | Conversion table + transit placement rule (fence removed; junction predicate untouched; non-vacuous merge-hazard guard) | ✅ CLEAR |
| `478123f` | Category-road frontage (QuietStreet counts; classic tests untouched) | ✅ CLEAR |
| `d5b11da` | Tool system + guarded `TechState.spend` (negative-spend exploit blocked); two-branch conversion gating | ✅ CLEAR |
| `5a9cfae` | `builtRenderKey(kind,mask,pos,tier)` + `renderKeyspace()` + atlas 48-60/transit + preview tints | ✅ CLEAR |
| `553e7f8` | Toolbar dock + pure `inputGeometry` (NET-displacement clicks, axis-major lines) + pan-vs-tool precedence | ✅ CLEAR |
| `43477e4` | README (claims cross-checked against code) | ✅ CLEAR |
| `ad977d6` | Headless renderKeyspace ⊆ renderer-styles guard (closes the crash-on-load advisory; reviewer probed non-vacuity by deleting style entries) | ✅ CLEAR |
| `62237f0` | Inspect readout in dock (lead's "wire it" ruling) + lineTiles floor hardening | ✅ CLEAR |

**Deviations:** placeholder economy values (PRP-sanctioned);
`MERGEABLE_TRANSPORT_MAX` removed with its only consumer; preview includes
the effort check so tints reflect true would-succeed validity.

## Issues Found

### 1. Inspect computed a readout nothing displayed
**Severity:** Minor → fixed in `62237f0` per team-lead ruling (a visibly
inert tool is worse than a small status surface). Verified live: dock
shows `(18, 2) empty` on click; clears on tool switch. Resolved.

### 2. Paint-side renderKey↔style coupling unguarded
**Severity:** Minor (advisory) → proposer self-hardened in `ad977d6`; a
future renderKey kind without a renderer style now fails a headless test
instead of crashing at load. Resolved.

### 3. Declined nits (rationale accepted)
Writer-boolean refund branch (unreachable — validation and writers share
predicates), `grantedKinds` hoist (negligible), "Inspect · 0" label
(literal spec). Open-by-choice, on record.

### 4. Live-pass findings (team lead, non-blocking follow-ups)
Preview tint persists at a stale tile after a drag-pan until the next
pointer move; the architecture guard's temp-file probe triggers Vite HMR
full-reloads when vitest runs beside `npm run dev` (consider ignoring
`__guard_probe__` in `server.watch`); trivial README wording on the
inspect readout. All recorded for the follow-up ledger.

## Team-Lead Live Browser Verification (two passes)

Pass 1: unlock chain → dock grew **Parklet · 8** plus **Convert to
Street · 3** and **Convert to Avenue · 4** (the capability-gated road
diet and boulevard reversal — the plan review's unreachable-tools fix
verified live); parklet placed on grass and rendered; bulldozed clean;
red tint on ocean, green on meadow; drag-pan with parcel tool selected
panned (AC#8). Pass 2 (post-62237f0): Inspect readout live in the dock;
unlocking bike-paths produced both build and convert tools; **a
transport-tool drag painted a 5-tile connected bike-path line and did not
pan** — both sides of the input precedence confirmed. The mid-pass
state-reset mystery was diagnosed to the guard probe's HMR reload, not a
product bug.

## What's Done Well

- **Every plan-review fix held under execution**: the junction predicate
  stayed concrete, the merge-hazard guard asserts the only observable
  tell, the conversion table is exact with both-direction rejection, and
  the unreachable-tools fix produced working capability-gated tools on
  screen.
- **Reviewer tooling matured again**: block-level byte-verification of
  frozen suites robust to line shifts, and a non-vacuity probe of the
  guard the proposer added — reviewing the review.
- **The proposer hardened beyond findings**: `ad977d6` turned an advisory
  into a fail-closed guard unprompted; declines came with engineering
  rationale, not deflection.
- **The thematic mechanics landed**: road diets are conversions —
  a street becomes a quiet street in place; nothing is demolished to
  heal. The Moses century's mechanical opposite, as designed.

## Summary

8/8 commits clear; 2 Minors fixed in-flight, advisory self-hardened,
nits dispositioned with rationale; 488 tests, gates green, two live
browser passes covering the full acceptance walk. The player can now
build, convert, bulldoze, and inspect — the healing is a verb.
