# Code Review: ui-revival

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-15
## Mode: Agent Team (message-gated incremental review)

> Full team pipeline: `/review-plan-team` (8 yield points) →
> `/execute-team` (this artifact). Ten commits, 10/10 APPROVED, zero
> Blocking/Significant. The feature that makes the game playable: the
> dock and tech panel no longer eat clicks, and the keyboard-only depth is
> now discoverable from the dock. Verified live in **both Chromium and
> Safari's actual WebKit engine** (installed for this pass).

## PRP Compliance

All 9 PRP tasks + 1 in-scope follow-up, suite 666 → **702** tests (40
files), `tsc` clean, build green; scope held to `src/ui` + `main.ts` +
`index.html` + `tests/architecture.test.ts` (two allowlist appends) +
`README.md` — **zero game-logic source changes**.

| Commit | Task | Verdict |
|---|---|---|
| `bf9907d` | 1 pure toolbar helpers (refreshSignature/addedIds/toolbarToolClass) | ✅ RED-first, +11 |
| `e4d2619` | 2 pure tech helpers (panelSignature/techNodeClass) | ✅ RED-first, +8 |
| `e5cb529` | 3 **reconcilePlan** pure module + allowlist — the click-eating fix's decision contract | ✅ RED-first, +8, "strongest commit" |
| `10dd15f` | 4 toolbar apply-shell + delegated click (bound once) + meta row + flash | ✅ 2 Minors → resolved in 6/7 |
| `d113cc8` | 5 tech-panel apply-shell + delegated click + toggle + onToggle + Y8 "Needs:" removal | ✅ Y8+Y3 nailed |
| `b4a803d` | 6 metaButtons pure + allowlist | ✅ RED-first, +7 |
| `200a5db` | 7 main.ts sim-gated wiring + shared cycleOverlay + onToggle→refreshMeta + seeded flash | ✅ both carry-forwards resolved |
| `7db0af5` | 8 Safari-proof pan (clientX/Y deltas + guarded capture) | ✅ |
| `3bc4fe8` | 8-followup captured-pointerup click/tile from clientX/Y not offset | ✅ trap avoided |
| `905a0dc` | 9 dock meta-row + flash CSS + README | ✅ |

**Deviations (documented, reviewer-accepted):** optional meta/onToggle
deps for atomic task scope; forward-declared `MetaButton` type;
`getEffort` dep resolving a Task-5 Minor; `.toolbar-meta-button` base
class (keeps the wholesale-className discipline).

## Issues Found

All resolved in-flight; none Blocking/Significant. The notable two:

### 1. Captured-pointerup offset reads (wrong-tile in Safari)
**Category:** Logic (browser compat) **Severity:** Minor → fixed in
`3bc4fe8`. At pointerup, `e.offsetX/Y` is computed at event dispatch —
while capture is still active — so click-vs-drag classification AND the
apply-tile were captured-offset reads; in WebKit a click could place a
parcel on the wrong tile. The team lead promoted this from a "watch item"
to an in-scope fix (only Chromium was installable for the MCP, so closing
it in code beats gating on a browser that can't be driven there). Now:
classification from raw `clientX/Y` deltas (origin-invariant), apply-tile
via `getBoundingClientRect()`; offset retained only in the non-captured
hover + wheel paths. **Empirically verified in WebKit** (below).

### 2. Pan-misclassification trap (reviewer-prevented)
**Category:** Logic **Severity:** would-be Significant — caught at review
time. The reviewer pre-flagged that classification must anchor on an
*immutable* `downClientX/Y` set only at pointerdown, NOT the
`lastClientX/Y` the pan branch mutates each move — else a real pan-drag
classifies as a click and drops a tool at the pan-end tile. Verified
avoided: separate anchors. A bug prevented before it was written.

## Team-Lead Live Browser Verification (Chromium + WebKit)

**Chromium (MCP):** 12/12 dock clicks registered during active effort
accrual — the click-eating regression is gone; [Tech] opens the 34-node
panel with the meta button showing active; Walkable Streets unlocked via
click; [Eco] activates the soil overlay.

**WebKit — Safari's actual engine** (Playwright webkit installed for this
pass): 12/12 click survival; Begin + [Tech] buttons work; and the
decisive offset-fix check — an Inspect click at canvas (600, 400)
reported tile **(18, 12)**, exactly the camera math (600/32→18,
400/32→12). The clientX/Y fix makes click-to-place accurate under capture
in the engine where the bug lived. Screenshot confirmed the dock, the
[Tech][Eco][Civic] meta row, the inspect readout, and the pulse all
rendering and functional.

## What's Done Well

- **The dialectic produced a better design than any input**, twice: the
  plan review converged (proposer grounding + interlocutor + lead) on a
  no-jsdom pure-reconcile contract *honest about the WebKit gap* a jsdom
  test would have papered over; and at execution the reviewer prevented
  the pan-misclassification bug pre-emptively.
- **The defining regression is locked deterministically** — listeners
  bound once on never-replaced containers + a node-tested reconcile plan +
  wholesale pure-className — and then *confirmed in the actual failing
  engine*, not just reasoned about.
- Scope discipline absolute: not one game-logic file touched; the whole
  drag/click coordinate path is now engine-independent.

## Summary

10/10 commits APPROVED; 0 Blocking, 0 Significant; the two logic risks
(captured-offset wrong-tile, pan-misclassification) closed and verified.
702 tests, gates green, live-passed in both Chromium and WebKit. The dock
clicks, the tech tree and overlays are reachable by button, and the
unlocks announce themselves. The game is playable.

**APPROVED** — proceed to PR after the `.dialectic-tier` strip (standard
tier; no security audit required).
