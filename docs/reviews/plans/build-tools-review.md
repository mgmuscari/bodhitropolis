# Plan Review: build-tools

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-12
## Mode: Agent Team (concurrent review + revision)

> Five yield points (2 Structural, 3 Moderate) plus one round-2 refinement
> — all accepted and revised, with the interlocutor verifying each landed
> in the artifact rather than trusting the claim. The proposer's grounding
> pass independently caught two of the structural issues and the stale
> line numbers before the interlocutor raised them. The tech-tree coupling
> contract (conversion table + renderer dispatch + frontage swap land
> together) is honored.

## Yield Points Found

### 1. Conversion-tool gating unsatisfiable for classic targets
**Severity:** Structural
**Evidence:** "Tool appears when target kind granted" — but the tree
grants only kinds 5-9/48-60, never classic 1-4, so convert-1
(avenue→street) and convert-2 (highway→avenue) — the PRD's "thematic
heart" road diet and boulevard reversal — could never appear.
**Proposer Response:** Accepted. Two-branch gating: tech targets via
`grantedKinds()`; classic targets via `hasCapability('road-diets')`. RED
test pins both tools appearing exactly at the capability unlock.
**PRP Updated:** Yes.

### 2. `builtRenderKey` seam underspecified in three ways
**Severity:** Structural
**Evidence:** QuietStreet(7) is category-road → `road-7-{mask}` keys, but
the atlas builds road-1/2/3 only and `ROAD_STYLES` has no [7] —
`makeRoadTile(7)` throws on a placeable kind; the signature lacked the
`pos` argument building keys require; totality testing needed a pure
keyspace but `buildAtlas` is DOM-coupled.
**Proposer Response:** Accepted all. Signature now `(kind, mask, pos,
condTier)`; `renderKeyspace()` exported pure and `buildAtlas` iterates it
(one source of truth, headless ⊆-membership test); ROAD_STYLES[7] + road-7
set added.
**PRP Updated:** Yes.

### 3. Merge-predicate framing invited the capacity hazard; the first guard test was vacuous
**Severity:** Moderate (+ round-2 refinement)
**Evidence:** Prose said "same-category merge check" while safe code uses
`isRoadKind` — a category rewrite would merge Street↔QuietStreet to
max=7. Round 2: the added RED guard ("built never >4") was false on green
and blind to the regression (max(7,street)=7 under both predicates — only
the return value differs).
**Proposer Response:** Accepted twice. Predicate stated concretely with an
explicit do-not-generalize warning; guard reworded to the only observable
tell: placing classic road onto QuietStreet returns FALSE and the tile
stays 7.
**PRP Updated:** Yes.

### 4. `spendEffort` split TechState's invariant; determinism test blind to effort
**Severity:** Moderate
**Evidence:** An external mutator beside `unlock`'s guarded writes splits
enforcement of the u32-snapshot invariant; `hashWorld` folds {map,
parcels} only, so apply-determinism couldn't see effort corruption.
**Proposer Response:** Accepted. Guarded `TechState.spend(n): boolean`
single-writer beside `unlock`; determinism and cost-debit tests assert
`tech.snapshotBytes` alongside `hashWorld`.
**PRP Updated:** Yes.

### 5. Input model contradicted AC#8 and buried pure logic in the shell
**Severity:** Moderate
**Evidence:** "Drag still pans" vs "transport drag paints" unresolved;
movement threshold ambiguous (net vs summed); axis-major line enumeration
is determinism-sensitive pure logic slated for manual QA — against the
established pure-seam precedent.
**Proposer Response:** Accepted. Explicit precedence (non-transport tool →
drag pans; transport tool → drag paints, pan via Escape/middle-button);
NET Euclidean threshold; pure `src/tools/inputGeometry.ts`
(classifyPointer, lineTiles) guard-scanned with RED tests including the
jitter case and the deterministic prefix under effort exhaustion.
**PRP Updated:** Yes.

## Also Corrected During Grounding

Stale FROZEN-suite line numbers inherited from the tech-tree PRP's
pre-merge file (now :357/:369/:459/:491 + the transit-category suite :511
added to the frozen list), fence-test refs, `parcelTouchesRoad` location,
and a documented frontage-swap regression-safety analysis (the only delta
vs `isRoadKind` is QuietStreet; rail frontage stays false).

## What Holds Well

- **Single-writer discipline extends cleanly**: `convertTransport` joins
  the fabric block; `TechState.spend` joins `unlock` — both sides of the
  economy guarded where their invariants live.
- **The FROZEN/REQUIRED contract carried forward correctly**, including
  recognizing that the tech-tree fence tests are this feature's REQUIRED
  rewrites while their no-merge/no-crossing properties must survive.
- **Pure-seam pattern now systematic**: renderKey, inputGeometry,
  toolbarContent follow openingContent/techContent/shouldTogglePanel —
  the riskiest UI change gets a tested core.
- **Both stances independently converged** on the gating and renderer
  flaws — the overlap signal that the dialectic found the real faults.

## Summary

6 points (counting the round-2 refinement), all accepted; no PRD-level
flaws — the PRD's intent was sound, the PRP under-specified mechanisms.
Residual risk correctly scoped to the lead's live browser pass
(pan-with-transport-tool ergonomics flagged for explicit attention).

**APPROVED** — proceed to `/execute-team`.
