# Plan Review: ui-revival

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-15
## Mode: Agent Team (concurrent review + revision)

> Eight yield points (3 Structural, 3 Moderate, 2 Minor), all resolved in
> two rounds. The headline exchange was a genuine architecture fork — the
> proposer's grounding caught that the PRP assumed jsdom (the test env is
> node-only), and the resolution converged, through three independent
> arrivals, on something better than any starting point: a pure
> node-testable reconcile contract that is *honest about the WebKit gap*
> rather than papering over it.

## Yield Points Found

### 1. PRP assumed jsdom was available (it is not)
**Severity:** Structural
**Evidence:** `vite.config.ts` pins `environment: 'node'`; jsdom/happy-dom
are absent from `package.json` and `node_modules`; the PRP (and PRD AC#3 /
Open Q#3) claimed "vitest's environment" / "jsdom-capable." A jsdom mount
would throw, not assert.
**Proposer Response:** Accepted. Per team-lead ruling, **dissolved, not
patched** — no jsdom added.
**PRP Updated:** Yes (every jsdom mention is now a negation).

### 2. The defining click-survival regression had no automated lock
**Severity:** Structural
**Evidence:** Tasks said "Tests: none"; the reconcile-identity test was
"optional" and droppable; the only gate was a manual Safari pass the
project had failed once already — against the repo's non-vacuity discipline.
**Proposer Response + team-lead ruling:** the reconcile *decision* is now a
pure node-tested module `src/ui/reconcile.ts` (`reconcilePlan(prevIds,
rows) → {order, insert, remove}`); stale classes are made impossible by
construction via pure `toolbarToolClass`/`techNodeClass` that the shell
applies wholesale (`el.className = pureClass(...)`); the inherently
browser-specific delegated-click-survival is named as the **Safari +
Chromium live-pass** gate. **jsdom was deliberately rejected** because it is
not WebKit — a jsdom "click survives `replaceChildren`" test would pass on
code that drops the click in Safari, i.e. false confidence about the exact
axis the bug hid on. Decision tested in node; browser behavior gated live.
**PRP Updated:** Yes (Tasks 1-5, §2, §4, §6).

### 3. Tech meta-button active-state went stale on the T *key*
**Severity:** Structural
**Evidence:** `techPanel.ts:122` owns its own keydown and never notifies
main, so "refresh meta after any toggle" silently omitted the key path
(asymmetric with E/C).
**Proposer Response:** Accepted — `onToggle?(open)` added to
`TechPanelDeps`, fired inside `setOpen` (covers key + button + dismiss) →
`toolbar.refreshMeta()`; the per-frame poll alternative dropped (it would
have reintroduced the Y5 work). 
**PRP Updated:** Yes (Tasks 5, 7).

### 4. Safari pan justification was a non-sequitur
**Severity:** Moderate — accepted. Pan now uses capture-stable `clientX/Y`
deltas (origin cancels in the subtraction); `offsetX/Y` kept only for the
non-captured tile-under/click path; the false "hover precedent" rationale
removed; Safari drag-under-capture named in the live check.

### 5. Signature gate recomputed heavy derives at 60Hz
**Severity:** Moderate — accepted. The sim tick sets a `simChanged` flag;
the rAF frame recomputes `branchColumns`/`availableTools` + signatures only
when set (~10Hz), discrete events refresh directly. Matches the dirty-flag
discipline.

### 6. Meta-row placement and interface were ambiguous
**Severity:** Moderate — accepted. Single design: the meta row lives in the
toolbar shell; `ToolbarDeps` gains `getMetaButtons()`/`onMeta(id)`,
`ToolbarHandle` gains `refreshMeta()`/`flash()`, a second delegated
listener via `closest('[data-meta-id]')`.

### 7. prevToolIds init unspecified (startup flash)
**Severity:** Minor — accepted. Seeded from the initial `getRows()` id set
at mount → first diff empty → no spurious unlock flash on load.

### 8. "Needs:" sub-element could ghost on node reuse
**Severity:** Minor (raised round 2) — accepted and pulled **in-scope** by
the team lead (not left as optional polish): it is the stale-on-reuse class
one level below the className fix. Task 5 now reconciles a reused node's
full sub-structure (name/flavor/missing/clickable) to the current NodeView
every apply — creating/updating/**removing** the `tech-node-missing` line
when a multi-prereq node's missing list empties (community-gardens,
community-ai-nodes). Mirrors the wholesale-className principle.

## What Holds Well

- **The dialectic produced a better design than any input.** The proposer's
  grounding caught the jsdom error; the interlocutor independently reached
  the same no-jsdom conclusion *and* contributed the pure-className
  refinement (wholesale `el.className`) that closes the one gap in the
  reconcile-plan approach; the team lead's WebKit-false-confidence point
  made the rejection principled. Three arrivals, one stronger resolution.
- **Pure-seam discipline held throughout**: signatures, addedIds,
  metaButtons, reconcilePlan, and the class strings are all node-testable;
  only genuinely browser behavior (delegated-click survival, pan under
  capture) is left to the live pass — where it belongs.
- The shared `cycleOverlay` closure (one body for E/C keys *and* buttons)
  structurally prevents key/button divergence; the static-node-set insight
  keeps the tech panel updating in place; rollback is additive, no engine.

## Summary

8 yield points (3 Structural, 3 Moderate, 2 Minor), all resolved; no
remaining structural or moderate weakness. The defining click-survival
regression is locked by a deterministic node-env contract that is honest
about the WebKit gap, with the live pass (Safari + Chromium) as the named
browser gate. Two allowlist appends (`reconcile.ts`, `dockContent.ts`) are
flagged mandatory.

**APPROVED** — proceed to `/execute-team`. The team lead owns the live
browser pass in **both Safari and Chromium** and the `.dialectic-tier`
strip before merge.
