# Code Review: tech-tree

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-12
## Mode: Agent Team (message-gated incremental review)

> Full team pipeline: `/review-plan-team` (12 yield points + a topology
> design ruling) → `/execute-team` (this artifact). Nine commits, every one
> SHA-pinned-reviewed and approved; the reviewer verified chain-wide
> invariants (frozen-file byte identity, deferral discipline, no tier file)
> across the whole chain, not just per commit. The team lead ran the live
> browser pass the sandboxes cannot.

## PRP Compliance

All 7 tasks as specified (9 commits: 7 task + 2 nit-fix), suite 315 →
**388** tests (20 files), `tsc` clean, build ✓ (27 modules):

| Task | Commit | Verdict |
|---|---|---|
| 1 Kinds + fence | `de8f166` | ✅ FROZEN suites byte-identical (per-test shasum); REQUIRED predicate rewrites exact; fence rejects each kind 5-9; transportCategory exported + table-tested |
| 2 Tree + guard | `bb95af8` (+`778ef2f`) | ✅ 34 nodes node-for-node vs PRP; 11 cross-branch edges programmatically counted; all 3 RJ load-bearing edges present; validateTree self-checked; fail-closed temp-file guard probe, self-cleaning |
| 3 TechState | `90627a2` (+`3f27bd5`) | ✅ canUnlock precedence tested; set-permutation snapshot semantics exactly per the corrected PRP; kebab/ASCII id invariant promoted to runtime enforcement |
| 4 Effort + tick | `941ab73` | ✅ zero-parcel NaN guard (exactly 1); non-decreasing + within-bucket-equal + strict-across-step monotonicity hand-recomputed by the reviewer; PLACEHOLDER banner; structural typing keeps tech worldgen-free |
| 5 Panel content | `f4ae31d` | ✅ clean — 7-column philosophy order, missing-prereqs by name, shouldTogglePanel full truth table |
| 6 Panel shell | `abb2943` | ✅ panelDirty distinct from canvas dirty with full status re-derive; zero game imports; overlay suppression via the pure gate; opening.ts/renderer.ts untouched |
| 7 Docs | `7d69552` | ✅ formula disclosed verbatim; fence note correctly scoped |

**Deviations (all flagged in-flight, all accepted):** renderer.ts +
`parcelTouchesRoad` untouched (plan-review deferral — discipline held
perfectly across the chain); panelDirty landed with its reader in Task 6
(`noUnusedLocals` forbids a write-only flag); `charCodeAt & 0xff` over
TextEncoder (byte-identical on kebab-ASCII ids, hardened by runtime
enforcement in `3f27bd5`).

## Issues Found

### 1. Copy nits in two flavor lines
**Severity:** Nit — fixed in `778ef2f`. Resolved.

### 2. Kebab/ASCII id invariant was test-enforced, not runtime-enforced
**Severity:** Nit — `validateTree` now rejects non-kebab ids (`3f27bd5`),
making the snapshot byte-encoding's precondition self-defending. Resolved.

### 3. panelDirty deferral (Task 4 → Task 6)
**Severity:** Minor — accepted rationale (write-only local rejected by
tsconfig), tracked across commits, verified resolved in `abb2943` with all
three panelDirty requirements. Resolved.

### 4. Spare transport codes 10-15 uncategorized
**Severity:** Nit (FYI) — "honest range" design; the fence rejects them and
no kind occupies them. The transit feature that claims a spare code must
add its category then. Open by design.

### 5. Per-tick panel rebuild (reviewer nit for the live pass)
**Severity:** Nit — full `replaceChildren` rebuild each ~100ms tick while
open. **Empirically cleared in the team lead's browser pass**: an unlock
click landed first-try during active accrual; no flicker observed at 34
nodes. Revisit only if the tree grows order-of-magnitude. Closed.

## Team-Lead Live Browser Verification

Playwright against `npm run dev` (seed `bodhi-1`): `T` correctly ignored
while the opening overlay is up; Enter dismisses; `T` opens the panel —
all seven branches, all 34 nodes with flavor text, prereqs by name, the
RJ ruling visible in the data ("Communes · Needs: Collective Ownership,
Healing Commons"; "Community AI Nodes · Needs: Mutual Aid, Local Grids,
Participatory Budgeting"); effort accrues live (the panel re-render even
staled my element refs mid-pass — the dirty path observably works);
clicking Walkable Streets unlocked it and **Road Diets flipped
locked→affordable in place** (its Needs line vanished, pointer appeared);
`T` closes the panel. Console: only the known favicon 404.

## What's Done Well

- **The frozen-tests contract worked exactly as designed**: the reviewer
  shasum'd the four frozen suites per commit and verified the file was
  touched only by the one commit allowed to touch it — the plan review's
  executor-deadlock fix, proven in execution.
- **Deferral discipline held across nine commits** — renderer, frontage,
  and capacity-merge wait for build-tools, with the coupling note carried
  in the PRP rather than half-landed code.
- **The dharmapunk register survived 34 flavor lines** ("Harm is met with
  a circle, not a cage"; "rent becomes stewardship, not extraction"; "the
  model answers to the assembly") without doctrine-dumping.
- **Monotonicity testing matured**: non-decreasing globally, equal within
  a floor bucket, strict across the boundary — the quantization-honest
  property set, hand-recomputed by the reviewer.
- Nit-fix turnaround inside the gated loop kept the chain clean without
  ever blocking forward progress.

## Summary

9/9 commits approved; 0 Blocking, 0 Significant; 1 Minor and 4 Nits — all
resolved or closed-by-design. 388 tests green, gates clean, browser
checklist passed. The game now has its seven-branch path of growth; the
next feature (build-tools) lets the player walk it.
