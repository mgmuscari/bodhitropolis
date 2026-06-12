# Code Review: moses-century

## Verdict: APPROVED
## Reviewer Stance: Team — Code Reviewer + Implementation Defender
## Date: 2026-06-12
## Mode: Agent Team (message-gated code review)

> **Mode note:** this is the first team-mode gate since split-pane spawning
> was repaired (the plan gates for this feature ran sequential during the
> outage; implementation ran via the headless proposer, whose final report
> was lost when the repair restarted iTerm — work was complete and
> committed). Teammates: `code-reviewer` + `defender`, message-gated
> finding-by-finding, team lead arbitrating. Defender scope verified by
> `scripts/check-defender-scope.sh` (OK).

## PRP Compliance

All 8 PRP tasks implemented, one atomic commit each (`fa846b4`..`8d4905e`),
gates green at review end: **253/253** tests (12 files; +3 added in review),
`tsc` clean, build OK. The reviewer verified all six plan-review yield
points in code and tests: radial-only rail (zero in-grid, asserted),
`distanceField` passability with road-network distance in era 4,
survivorship-bias-free blight gradient (abandoned at condition 0, cohorts
fixed pre-era-5), pinned `MosesState` + uniform era signatures +
founded=false no-ops, era-3 arithmetic (top-quartile overlap ≥5 tiles,
alive-count balance equation, 50% second-corridor rule), era-5 two-pass
decay/abandon. `fabricdemo.ts` deleted cleanly, no dangling references.
The reviewer additionally ran an independent 13-seed empirical sweep: the
final road network is exactly one connected component on every seed.

## Issues Found

### 1. Orphaned/stale JSDoc for `placeAdjacent`
**Category:** Doc hygiene **Severity:** Minor → Minor
**Location:** src/worldgen/moses.ts:217-222 (function at :230)
**Details:** Doc block stranded above `AttrGen`/`HEALTHY_ATTRS`/
`PROJECT_ATTRS`; its density/condition ranges are wrong for the
`PROJECT_ATTRS` path.
**Defender Response:** acknowledged valid; doc-only, follow-up relocation.
**Resolution:** acknowledged (follow-up).

### 2. Post-stage road-network connectivity unguarded
**Category:** Test quality **Severity:** Minor → **Significant** (team-lead
re-grade: PRD §1 "blighted-but-coherent city" outranks the PRP task list)
**Location:** tests/worldgen/moses.test.ts (full-assembly suite)
**Details:** Eras 1-2 asserted single-component roads; the end state did
not. Correct today, unguarded against regression.
**Defender Response:** **fixed in c4eab57** — full-assembly guard per seed,
non-vacuity `total >= 100`.
**Resolution:** resolved (fixed; tightened by finding 5).

### 3. Era-2 industry drops the "(boxDensity low)" siting hint
**Category:** Spec mismatch **Severity:** Nit → Nit
**Location:** src/worldgen/moses.ts:575-589
**Details:** Rail/water frontage + beyond-core honored; the parenthetical
low-density tiebreaker unimplemented. Substantive outcome achieved
structurally (rail is beyond-grid by construction; waterfront industry is
historically authentic).
**Defender Response:** acknowledged; tiebreaker or PRP Uncertainty-Log note
as non-blocking follow-up (PRP edit outside defender scope).
**Resolution:** acknowledged (follow-up; PRP-owner reconcile).

### 4. `nearestRoadIndex` cubic worst case
**Category:** Performance **Severity:** Nit → Nit
**Location:** src/worldgen/moses.ts:815-829
**Details:** Ring scan is O((w+h)³) if no road exists anywhere.
**Defender Response:** defended — call sites are all post-`founded` guard;
the era-1 crossroads is never demolished, so every real call returns at
r≈0 (O(1)). Latent-bound notes accepted on record.
**Resolution:** resolved (defended; reviewer concurred).

### 5. Finding-2 guard used ≥95% where 100% holds exactly
**Category:** Test quality **Severity:** Minor → Minor
**Location:** tests/worldgen/moses.test.ts (the c4eab57 guard)
**Details:** The 95% bar (team lead's own initial spec) contradicted its
single-component rationale and was weaker than the era-1/2 siblings;
reviewer's 13-seed sweep showed exact connectivity everywhere.
**Defender Response:** **fixed in fea0551** — `largestComponent === total`;
team lead concurred, overruling his own earlier threshold.
**Resolution:** resolved (fixed).

### 6. `.dialectic-tier` must not reach `main`
**Category:** Convention (merge gate) **Severity:** Nit → Nit
**Location:** `.dialectic-tier` (branch root)
**Details:** Correct on the branch; forbidden on `main` per CLAUDE.md.
**Defender Response:** routed to team lead (hooks read it mid-branch;
removal is the lead's final pre-PR commit, precedent af1c8fd/c5693f4).
**Resolution:** acknowledged-with-owner (team lead, pre-PR checklist).

## What's Done Well

- **All six plan-review yield points landed intact** — the rail-geometry
  fix, the passable BFS, the outcome-based blight gradient, the pinned
  state interface, the observable era-3 arithmetic, and the two-pass
  era 5 are each verifiable in tests, not just claimed.
- **Determinism discipline held across 1,000+ new worldgen lines**: no
  forbidden Math, rational falloffs, double-run hash + seed-divergence
  tests, demolition tombstones folded into the canonical hash.
- **The dialectic sharpened the suite during review**: two fixes added in
  exchange (+3 tests), ending stronger than the PRP demanded — end-state
  road coherence now guarded at the exact bar, grounded by the reviewer's
  own 13-seed empirical sweep rather than assertion.
- **Era commits are honestly atomic** (implementation + tests per era,
  verified per-commit), and the fenced placeholder was deleted on schedule
  with zero residue.

## Summary

6 findings: 0 Blocking, 1 Significant (fixed), 5 Minor/Nit (1 fixed, 3
acknowledged as follow-ups, 1 defended). All exchanges closed within the
two-round rule; both teammates delivered consistent self-contained
summaries. Defender commits (`c4eab57`, `fea0551`) touched only
allowed-scope files (scope check OK) and strengthened tests — none
weakened. Open follow-ups are non-blocking: doc relocation (1), industry
tiebreaker/PRP note (3), optional ring-walk tidy (4).

**APPROVED** — proceed to PR after the team lead's `.dialectic-tier`
removal (finding 6).
