# Plan Review: tech-tree

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-12
## Mode: Agent Team (concurrent review + revision)

> Largest review haul of the project so far: 12 yield points (3 Structural,
> 5 Moderate, 4 Minor), all accepted and revised live; four PRD-level items
> routed to and ruled by the team lead, including one design ruling that
> changed the tree's topology. The interlocutor hand-audited all 34 nodes'
> DAG; the proposer independently caught several defects (citation drift,
> the NaN, the edge miscount) during its own grounding before they were
> raised.

## Yield Points Found

### 1. Predicate widening contradicted the frozen-tests rule
**Severity:** Structural
**Evidence:** Widening `isTransportKind`→1..15 / `isBuildingKind`→16..127
flips two existing boundary tests (fabric.test.ts:52-58, :60-68) red, while
the PRP said "tests pass UNMODIFIED" and the PRD calls test edits a red
flag — an executor deadlock at the first predicate change.
**Proposer Response:** Accepted — §2 now splits FROZEN (mask/junction/merge
suites, kinds 1-4 only) from REQUIRED edits (the two boundary tests,
expected rewrite, titles renamed off "…only").
**PRP Updated:** Yes.

### 2. "T ignored while overlay up" was unimplementable with the given deps
**Severity:** Structural
**Evidence:** The opening overlay binds its own global keydown and exposes
no active-state; the panel's `{getContent, onUnlock}` deps gave it no way
to know — a second listener would toggle the panel under the overlay.
**Proposer Response:** Accepted — pure `shouldTogglePanel(key,
overlayActive)` seam (unit-testable), `isOverlayActive()` dep, flag owned
by the main.ts composition root; opening.ts untouched.
**PRP Updated:** Yes.

### 3. `effortPerTick` returned NaN on an empty world
**Severity:** Structural
**Evidence:** conditionMean = 0/0 on zero parcels; `max(1, floor(NaN))` is
NaN, failing the PRP's own "empty world → 1" test and poisoning the u32
snapshot.
**Proposer Response:** Accepted — zero-parcel guard; RED test pins exactly
1 and integer-ness.
**PRP Updated:** Yes.

### 4. Strict effort monotonicity is false under floor quantization
**Severity:** Moderate — accepted; tests restated as non-decreasing plus a
boundary-crossing strict case. PRD AC#5 reworded by the team lead.

### 5. Cross-branch edge count wrong
**Severity:** Moderate — accepted; audited 8→9 (→11 after the design
ruling); tests assert ≥3 without pinning the exact count.

### 6. Branch-root reachability semantics ambiguous
**Severity:** Moderate — accepted; `validateTree` = closure terminates at
no-prereq roots, cross-branch allowed; `drone-deliveries` named as the
accept-fixture. PRD AC#2 reworded by the team lead.

### 7. Snapshot set-semantics test conflated order- with cost-independence
**Severity:** Moderate — accepted; rewritten: permuting one fixed unlock
set → byte-equal; a different equal-cost set → different bytes.

### 8. Renderer palette-only work was unreachable, untestable, and wouldn't render
**Severity:** Moderate — accepted **and extended by the proposer**: the
binary rail/road dispatch would mis-key the new kinds anyway, and nothing
can place fenced kinds, so all renderer work (and the speculative
`parcelTouchesRoad` change) deferred to build-tools behind a pure
`builtRenderKey` seam, with a coupling note that build-tools must un-defer
renderer + frontage + capacity-merge together. PRD §3 marked deferred by
the team lead.

### 9-12 (Minor)
Stale line cites corrected (plus: `transportCategory` is private and must
be exported to be testable); rollback claim corrected (transit 5-9 fenced;
buildings 48-60 merely un-placed); guard test switched to a behavioral
temp-file probe; panel refresh split onto its own `panelDirty` flag with
full status re-derivation. All accepted and revised.

## Team-Lead Rulings

1. **PRD AC#5** → non-decreasing + strict-across-quantization-step. Done.
2. **PRD AC#2** → prereq-closure-terminates-at-roots (cross-branch
   allowed). Done.
3. **Restorative Justice load-bearing (design ruling):** rather than
   soften the PRD's claim, the tree was changed to make it true —
   `communes` now requires `healing-commons` (a commune needs a commons)
   and `community-ai-nodes` now requires `participatory-budgeting`
   (community AI is democratically governed or it isn't community AI).
   All three non-root RJ nodes are load-bearing; edges 9→11; re-audited
   acyclic. RJ as the structural thesis of the tree.
4. **PRD §3** renderer work marked deferred with the dead-code rationale.
   Done.

## What Holds Well

- **The placement fence survived adversarial scrutiny**: `max(kind)`
  junction merging genuinely is not capacity-ordered once codes 5-9 exist;
  fencing `canPlaceTransport` keeps every map this feature can produce
  free of new kinds, making rollback strand-proof.
- **The 34-node tree is sound**: hand-audited DAG (no cycles through the
  deep cross-branch chains), unique kind grants, every design-brief path
  present, every branch ≥2 nodes.
- **Determinism discipline extends cleanly to the first mutable game
  state**: no rng, no Date, byte-stable sorted-set snapshots,
  tick-count-keyed accrual.
- **Scope discipline ran both directions**: the proposer cut its own
  speculative work (renderer, frontage) beyond what was asked — the
  YAGNI judgment the interlocutor explicitly endorsed.

## Summary

12/12 yield points accepted and revised within two rounds; 4 PRD items
ruled; topology changed to encode the game's thesis structurally. Two
cosmetic residuals noted by the proposer were tidied by the lead at
commit. No open structural concerns.

**APPROVED** — proceed to `/execute-team`.
