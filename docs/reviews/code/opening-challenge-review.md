# Code Review: opening-challenge

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-12
## Mode: Agent Team (message-gated incremental review)

> Full team pipeline for this feature: `/review-plan-team` (5 yield points
> folded into the PRP) → `/execute-team` (this artifact) — the first feature
> to run team mode end-to-end since the split-pane repair. Each commit was
> review-gated before the next task began; deep reviews on the two heavy
> commits ran past the 2-minute window, so the proposer pipelined ahead per
> protocol and both retroactive reviews returned clean. The team lead ran
> the in-browser verification the teammates' sandbox could not.

## PRP Compliance

All 6 PRP tasks implemented as specified (7 commits, `9a5d4fd`..`0737ed5`);
suite 253 → **315** tests (16 files), `tsc` clean, `npm run build` clean.
The reviewer independently re-ran all gates and verified each plan-review
yield-point fix landed **non-vacuously**:

| Task | Commit | Verdict |
|---|---|---|
| 1 Name generator | `9a5d4fd` | ✅ clean — contract proven on all paths; pinned `'Hirwu'` |
| 2 Chronicle parser | `6ce39b3` | ✅ clean — YP4's exactly-one rails-line asserted; the PRP's suggested regex had a latent self-contradiction the implementer caught and fixed (reviewer ran both to confirm) |
| 3 Blight report | `670ffb1` | ✅ clean — YP1 (survivorship-free shares, -1→∞→periphery) and YP2 (chronicle-sourced nullable wounds; hand fixture proves the divergences) verified by independent re-derivation |
| 4 Content + pure-ui guard | `aa07873` + fix `2a51513` | ✅ — YP3 allowlist with self-check; YP5a verbatim-event test; one Minor (impossible test fixture shape) raised → resolved with realistic all-water coverage |
| 5 Overlay + wiring | `c0a948b` | ✅ — AC#5 renders chronicle-recorded eras; zero-import shell; headless-safe; dismiss/unbind logic verified by inspection |
| 6 README + verification | `b887327` | ✅ docs-only; verification deviation disclosed (headless content pipeline; no browser in sandbox) |
| Lead-commissioned fix | `0737ed5` | ✅ — zero-aware stat lines; non-zero branches byte-identical; RED-credible negative assertions |

**Deviations (all justified, all disclosed):** parser regex generalized to
satisfy the PRP's own behavioral spec; era-5 regex made encoding-tolerant
with a real-pipeline non-null guard; Task 5 thin-shell exception
(PRP-sanctioned, renderer precedent); browser verification replaced by
headless content verification in the teammate sandbox (closed by the team
lead's live pass, below).

## Issues Found

### 1. Empty-chronicle content test used an impossible input shape
**Category:** Test Quality **Severity:** Minor
**Location:** tests/ui/openingContent.test.ts (Task 4)
**Details:** `parcelsAlive 412` paired with `entries: []` cannot occur; the
realistic all-water path (0 alive + single era-1 entry, taking the
verbatim-fact branch) was uncovered.
**Resolution:** Fixed in `2a51513` — realistic fixtures added, both
branches exercised. Resolved.

### 2. `"0 towers-in-the-park still loom"` on zero-projects cities
**Category:** Logic (user-facing copy) **Severity:** Minor (promoted from
deferred-voice to fix-now by the team lead — it fires on ordinary seeds and
reads as a bug; confirmed live in the browser on `bodhi-1`)
**Location:** src/ui/openingContent.ts statLines
**Details:** Correct count, absurd phrasing at zero; sibling lines had the
same zero-form risk on all-water seeds.
**Resolution:** Fixed in `0737ed5` — zero-aware variants ("Not one
tower-in-the-park is left standing over the core."), non-zero branches
byte-identical, negative assertions pin the old copy out. Resolved.

### 3. Deferred (non-gating) voice items
**Category:** Voice/register **Severity:** Nit
**Details:** Occasional awkward generated names ("Taindpoomills" —
deterministic and contract-passing; tuning invalidates the pinned test);
broader all-water register polish. Team-lead ruling: future polish
feature, does not gate this PR. Open (tracked).

## Team-Lead Browser Verification (closing the reviewer's stated gap)

Live pass via Playwright against `npm run dev`, seed `bodhi-1`:
overlay renders fully (name **Hirwu**, all five era headlines, six stat
lines, three challenge paragraphs, Begin button); **Escape dismisses** and
the map is interactive after (arrow-key pan verified by viewport shift);
**`?nointro=1` skips** the overlay entirely; **reload reproduces** the
identical name, chronicle, and numbers (determinism). Only console entry: a
harmless favicon 404 (no favicon exists — polish nit). The pixel-art map
renders crisp. The pre-fix "0 towers" line was observed live, grounding
issue 2's promotion.

## What's Done Well

- **The challenge voice lands.** "Hirwu remembers it all — founded at
  (40, 72) — and wastes none of it. 72 blocks still stand; 30 lots lie
  open for something kinder. Pick up the keys, planner. Begin." — hopeful,
  specific, weaving a verbatim chronicle fact and real numbers, exactly
  the register the PRD pinned.
- **Plan-review fixes proved real**: the reviewer didn't take the yield
  points on faith — it re-derived fixture arithmetic, ran both regexes,
  and verified the rejected biased invariant is *absent*, not just that
  the new one is present.
- **The implementer reviewed the spec, not just the code**: catching the
  PRP's self-contradictory suggested regex and grounding the fix in the
  PRP's own behavioral requirements.
- **Message-gated pipelining worked under load**: deep reviews exceeded
  the timeout twice; the protocol's proceed-and-review-retroactively path
  kept throughput without ever landing an unreviewed commit in the final
  state.

## Summary

7/7 commits approved; 0 Blocking, 0 Significant, 2 Minors (both resolved
in-flight), nits dispositioned. 315 tests green, tsc and build clean,
browser checklist passed. Merge gates: `.dialectic-tier` strip (team
lead, at PR time) — then ship.
