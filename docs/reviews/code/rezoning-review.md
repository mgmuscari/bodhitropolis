# Code Review: rezoning

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-15
## Mode: Agent Team (message-gated incremental review)

> Seven PRP tasks, seven commits, all APPROVED. Suite **752 → 790** tests
> (+38, 42 files), `tsc` clean, `build` clean, determinism byte-stable.
> Zero Blocking/Significant/Minor findings; two non-blocking Nits. The feature
> gives the player their first restorative counter-move — convert a derelict,
> over-paved parcel in place into green, soil-healing land — reusing the
> convert/tool/tech/repair/civic machinery throughout, with one new pure module
> (`lineTools.ts`) and no worldgen change. Live-passed end-to-end in **both
> Chromium and WebKit — byte/pixel-identical.**

## PRP Compliance

All 7 tasks implemented as specified (convert-only scope per the plan review).
Scope held to `src/engine/fabric.ts` + `src/ecology/{tick,influence}.ts` +
`src/tech/tree.ts` + `src/tools/tools.ts` + `src/ui/{renderKey,renderer}.ts` +
new `src/ui/lineTools.ts` + `src/civic/dynamics.ts` + tests + the
`PURE_UI_ALLOWLIST` append. **No worldgen change; only kinds 61/62; no new
tech/trust mechanism.**

| Commit | Task | Verdict |
|---|---|---|
| `b0eb34e` | 1 Park(61)+RewildedLand(62) kinds + render | ✅ APPROVED — 1 Nit (Park vs Parklet green proximity) |
| `fdaab83` | 2 convertParcel single-writer + ParcelStore.setKind | ✅ APPROVED — exemplary, no findings |
| `5487dcc` | 3 depave cap exemption + Park/RewildedLand influence (soil<6) | ✅ APPROVED — load-bearing depave traced non-vacuous |
| `929b000` | 4 pocket-parks + rewilding tech nodes | ✅ APPROVED — tree-test manifest updates clean, validateTree untouched |
| `bc50fd5` | 5 convert-61/62 tools (table, 3-way gate, dispatch) | ✅ APPROVED — road-diets not loosened; bidirectional dispatch proven |
| `e9c490d` | 6 point-plop via pure `isLineTool` (new lineTools.ts) | ✅ APPROVED — 1 Nit (call-site `!` vs sibling guard) |
| `f9c919c` | 7 Park ∈ GATHERING_KINDS + civic/wellbeing tests | ✅ APPROVED — YP6 fix verified, trade-off scoped |

## Issues Found

No Blocking/Significant/Minor across all seven. Two Nits, both non-blocking:

### 1. Park green is close to Parklet green (Task 1)
**Category:** Render aesthetics **Severity:** Nit
Park base `[96,162,92]` is near Parklet `[88,148,84]`; rendered tile-center
samples are Park `[118,186,110]` vs Parklet `[104,168,98]` (Δ ~14–18/channel —
perceptibly different but both bright-green amenities). RewildedLand
`[78,140,80]` is clearly distinct (Δ ~40). **Resolution:** accepted as-is — the
two are thematically similar (a parklet is a tiny park), distinguishable in the
live pass, and the value is trivially tunable. Flagged for Maddy as an optional
aesthetic nudge (a path/bench mark or hue shift on Park) if she wants more
separation.

### 2. `isLineTool` call-site uses `!` vs sibling defensive guard (Task 6)
**Category:** Convention **Severity:** Nit
The new `main.ts` call site uses `toolDef(selectedToolId)!` while
`previewAt`/`applyAt` use `if (!def) return`. **Resolution:** left as-is — the
`!` is provably safe (`selectedToolId` only ever comes from `availableTools`),
and folding a guard-consistency tweak into Task 7's civic commit would break
atomic-commit scope. An optional standalone cleanup commit is available; not
required.

## Plan-Review Lineage (6 yield points, all resolved before code)

The plan review (docs/reviews/plans/rezoning-review.md) landed two real defects
this implementation never had to discover at code time: the
motivation-vs-mechanism gap (YP1 — converged on convert-only scope; build-on-
empty deferred to Open Q5) and a genuine civic kind-miscount (YP6 — a
CommunityGarden→Park rezone would have dropped a gathering belonging bonus →
**Park joined `GATHERING_KINDS`**, the fix shipped in Task 7). Plus point-plop
(YP2), tree-test manifest naming (YP3), the < 6 soil ceiling (YP4), and a
concrete civic test (YP5).

## Invariants Held (reviewer-verified per commit)

- **`convertParcel` single-writer** — rewrites `built` + store kind + condition
  across the existing footprint with the parcel-id layer unchanged;
  `checkParcelAgreement` stays empty; rejects empty/transport/dead/same-kind/
  non-REZONE-target (writes nothing); `hashWorld` moves on convert and is stable
  across a repeat sequence.
- **No direct ecology writes** — Task 3 is the one-line `sealed`-cap exemption
  (`& !isUnsealed(built[i])`); the tick still writes only the three ecology
  layers (layer-isolation byte-tests green). `isUnsealed` lives in
  `influence.ts` (no reverse import). Soil influence **< 6** (CommunityGarden
  stays the strongest soil boost).
- **Task 3 is load-bearing for the convert tools** — a converted park has
  `parcel ≠ 0`, so without the exemption it would seal its own soil at 40; the
  Task 3 soil-40→>40 convert test enforces this (and the §5 rollback coupling
  note documents it).
- **3-way `availableTools` gate** doesn't loosen road-diets; the `convert-*`
  dispatch keeps `convert-1/2/6/7` → `convertTransport`, building → `convertParcel`.
- **`isRepairTool` unchanged** (convert-prefix credits trust — no repairTools.ts edit).
- **point-plop** — `isLineTool` extracted pure to `lineTools.ts` (allowlisted):
  building build/convert are point, transport build/convert stay drag-paint.
- **Park ∈ GATHERING_KINDS, RewildedLand ∉** (a gathering→RewildedLand convert
  is a documented belonging trade-off; "wellbeing rises-or-holds" scoped to
  →Park / non-gathering→RewildedLand).

## Team-Lead Live Browser Verification (Chromium + WebKit — byte/pixel-identical)

In-page end-to-end (both engines): a derelict HouseSingle (condition 30) →
`convertParcel` → **Park** (condition reset 255); over 20 ecology ticks its soil
**recovers 40 → 60** (the depave payoff), while a ParkingLot control stays
suppressed (40 → 0). `influenceOf` Park soil +2 / RewildedLand +3 (< garden 6),
`isUnsealed(Park)` true. Tech gating: the `walkable-streets → road-diets →
parklets → pocket-parks` chain grants Park and `availableTools` surfaces
`convert-61`. Render: Park/Parklet/RewildedLand/CommunityGarden all paint green
(`buildAtlas` paints `b-61/b-62` in-browser — no crash); RewildedLand is
distinctly wilder/darker. **WebKit returned identical integration values and
pixel-identical render samples; 0 console errors in both engines.** A labeled
demo strip (the five green/paved kinds) was screenshotted for human review.

## What's Done Well

- **The plan review did the hard thinking; execution was nearly frictionless** —
  7/7 clean, the only items two Nits. The two real defects (empty-land scope,
  gathering miscount) were caught and resolved before any code.
- **Maximal reuse, minimal surface** — the entire feature rides the existing
  `convert-*` family, `isRepairTool`, `grantedKinds`, `placeParcel`/single-writer
  block, and the influence/gathering per-kind tables. One new pure module
  (`lineTools.ts`); the `tick.ts` change is a single clause.
- **The ecology coupling is honest and tested** — depaving heals via the cap
  exemption only (no direct layer writes), and the exemption is proven
  load-bearing for the convert tools, not just the depave AC.

## Summary

7/7 commits APPROVED; 0 Blocking/Significant/Minor; 2 non-blocking Nits
(Park/Parklet green proximity — tunable; an `!` call-site — provably safe). 790
tests, gates green, determinism byte-stable and live-verified cross-engine. The
player can now rezone the century's blight into healing green land, the soil
recovers above the paved cap, and parks build community.

**APPROVED** — proceed to PR after the `.dialectic-tier` strip (standard tier;
no security audit required). Optional follow-ups: a Park-vs-Parklet render
nudge, the `isLineTool` call-site guard, and the build-on-empty Park/RewildedLand
path (Open Q5) — none blocking.
